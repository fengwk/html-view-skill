// KChart 随机数据检查：用固定种子生成合法声明，在真实 Chrome 里检查与具体样例无关的版面规则。
// 用法：node html-view/scripts/lab/regression/kchart-fuzz.mjs --out <目录> [--seed 20261117] [--runs 24] [--sample 3]
//        [--chart <图型>]... [--case <图型-序号>]... [--chrome <路径>]
// 生成器按图族放在 lab/fuzz/*.mjs，各自导出 GENERATORS = { 图型: (h) => spec }；h 提供随机数、画像、标签与数值。
// 检查项只断言通用不变量：确定性、几何合法、文字不出画布、文字互不覆盖、字号、对比度、英文页不混入中文单位。
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRenderer } from '../../../kchart/node.mjs';
import { launchBrowser } from '../../src/shared/browser.mjs';
import { inspectPageExpression } from '../../src/shared/render-audit.mjs';
import { htmlPage, hydrateMetrics, loadMeasurementPage, pageInspectionExpression } from './kchart-gallery.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const FUZZ_DIR = join(HERE, 'fuzz');
const THEMES = ['claude', 'paper', 'obsidian', 'tokyo', 'kanagawa', 'terminal'];
// 常见版心与手机宽度占多数，其余在 240–1400 之间均匀抽取。
const WIDTHS = [240, 268, 300, 324, 360, 390, 430, 502, 558, 640, 768, 900, 1040, 1200, 1400];
const FRAME_PADDING = 56;
// 信息项不算失败，只用于复核最小槽宽扩宽、未铺满，以及核心为容纳文字而扩出的场景。
const INFO_CODES = new Set(['WIDE', 'UNDERFILL', 'TEXT_CONTAINED']);
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;

/** 32 位 FNV-1a：把种子文本变成整数。 */
function hashSeed(text) {
  let hash = 0x811c9dc5;
  for (const ch of String(text)) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** mulberry32：小而确定的伪随机数，[0, 1)。 */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LABELS = {
  zh: {
    short: ['华东', '华南', '华北', '西部', '门店', '外卖', '小程序', '新客', '老客', '直营', '加盟', '线上', '线下', '会员', '企业', '个人', '北京', '上海', '深圳', '成都'],
    long: ['华东大区直营门店合计', '小程序自提订单（含团购）', '企业客户年付续费', '海外渠道代理商销售额', '新注册且完成首单的用户', '跨境电商平台自营仓发货', '第三方配送平台外卖订单', '高校与科研机构采购合同'],
  },
  en: {
    short: ['East', 'West', 'North', 'South', 'Retail', 'Online', 'Direct', 'Partner', 'New', 'Returning', 'Mobile', 'Desktop', 'Paris', 'Tokyo', 'Austin', 'Lagos'],
    long: ['North America enterprise accounts', 'Self-serve annual renewals (net)', 'Partner-led marketplace orders', 'First-time buyers with a completed order', 'Cross-border fulfilment from own warehouse', 'University and research procurement'],
  },
};
const TEXTS = {
  zh: {
    short: { title: '本月收入继续增长', subtitle: '单位：万元', source: '来源：虚构数据', note: '说明：示例' },
    long: { title: '各渠道收入在第三季度普遍回升，但小程序与企业客户的增长来源仍需拆分核对', subtitle: '2026 年 1–10 月｜万元；按自然月汇总，缺失月份留空，不补零', source: '来源：虚构经营数据，仅用于版面检查，不代表真实业务', note: '说明：退款在发生月份冲减；跨月订单按支付时间归属；部分渠道 9 月起口径调整' },
  },
  en: {
    short: { title: 'Revenue kept growing', subtitle: 'USD thousands', source: 'Source: fictional data', note: 'Note: sample' },
    long: { title: 'Most channels recovered in the third quarter, but the drivers behind partner and enterprise growth still need a breakdown', subtitle: 'January–October 2026 | USD thousands; monthly totals, missing months stay empty', source: 'Source: fictional operating data for layout checks only; not real business figures', note: 'Note: refunds are netted in the month they occur; cross-month orders follow the payment date' },
  },
};
const UNITS = { zh: ['万元', '元', '人', '次', 'ms', '个', '单'], en: ['USD', 'users', 'ms', 'orders', 'items'] };

/** 随机画像：宽度、主题、语言，以及数据规模、标签长度、数值形态。 */
export function profileOf(rng) {
  const pick = (items) => items[Math.floor(rng() * items.length)];
  const width = rng() < 0.6 ? pick(WIDTHS) : 240 + Math.floor(rng() * 1161);
  return {
    width,
    theme: pick(THEMES),
    lang: rng() < 0.5 ? 'zh' : 'en',
    size: pick(['min', 'small', 'typical', 'large', 'max']),
    labels: pick(['short', 'long', 'mixed']),
    values: pick(['normal', 'tiny', 'huge', 'mixed', 'zeros', 'equal']),
    sign: rng() < 0.3 ? 'mixed' : 'positive',
    missing: rng() < 0.25,
    text: pick(['none', 'short', 'long']),
  };
}

/** 生成器助手：所有随机都来自同一个 rng，保证同种子同结果。 */
export function helpers(rng, profile) {
  const int = (min, max) => min + Math.floor(rng() * (max - min + 1));
  const pick = (items) => items[Math.floor(rng() * items.length)];
  const chance = (p) => rng() < p;
  const lang = profile.lang;
  const lerp = (min, max, t) => Math.round(min + (max - min) * t);
  const count = (min, max) => {
    if (max <= min) return min;
    switch (profile.size) {
      case 'min': return min;
      case 'max': return max;
      case 'small': return int(min, Math.min(max, min + 3));
      case 'large': return int(lerp(min, max, 0.7), max);
      default: return int(lerp(min, max, 0.25), lerp(min, max, 0.6));
    }
  };
  const labelOf = (length) => pick(LABELS[lang][length]);
  const labels = (n, { length } = {}) => {
    const out = [];
    const seen = new Set();
    for (let i = 0; i < n; i += 1) {
      const kind = length || (profile.labels === 'mixed' ? pick(['short', 'long']) : profile.labels);
      let label = labelOf(kind);
      if (seen.has(label)) label = `${label} ${i + 1}`;
      seen.add(label);
      out.push(label);
    }
    return out;
  };
  const magnitude = () => {
    switch (profile.values) {
      case 'tiny': return 0.001 + rng();
      case 'huge': return 10 ** (5 + rng() * 4.7);
      case 'mixed': return 10 ** (-1 + rng() * 8);
      default: return 10 + rng() * 990;
    }
  };
  const tidy = (x) => Number(Number(x).toPrecision(4));
  let equalValue = null;
  const value = ({ signed = false, missing = false, min = null, max = null } = {}) => {
    if (missing && profile.missing && chance(0.15)) return null;
    let x;
    if (profile.values === 'equal') x = equalValue ??= tidy(magnitude());
    else if (profile.values === 'zeros' && chance(0.3)) x = 0;
    else x = tidy(magnitude());
    if (signed && profile.sign === 'mixed' && chance(0.4)) x = -x;
    if (min != null) x = Math.max(min, x);
    if (max != null) x = Math.min(max, x);
    return x;
  };
  const values = (n, options = {}) => {
    const out = Array.from({ length: n }, () => value(options));
    // 至少保留两个真实数值，缺失值检查不至于退化成空图。
    for (let i = 0; i < Math.min(2, n); i += 1) if (out[i] == null) out[i] = value({ ...options, missing: false });
    return out;
  };
  const months = (n) => {
    let year = int(2018, 2026);
    let month = int(1, 12);
    return Array.from({ length: n }, () => {
      const text = `${year}-${String(month).padStart(2, '0')}`;
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
      return text;
    });
  };
  const days = (n, start = `${int(2024, 2026)}-${String(int(1, 12)).padStart(2, '0')}-01`) => {
    const base = Date.parse(`${start}T00:00:00Z`);
    return Array.from({ length: n }, (_, i) => new Date(base + i * 86400000).toISOString().slice(0, 10));
  };
  const texts = () => (profile.text === 'none' ? {} : { ...TEXTS[lang][profile.text] });
  const unit = () => pick(UNITS[lang]);
  return { rng, int, pick, chance, profile, lang, zh: lang === 'zh', count, labels, value, values, months, days, texts, unit };
}

async function loadGenerators() {
  const generators = {};
  const files = readdirSync(FUZZ_DIR).filter((name) => name.endsWith('.mjs')).sort();
  for (const name of files) {
    const module = await import(pathToFileURL(join(FUZZ_DIR, name)).href);
    for (const [chart, generate] of Object.entries(module.GENERATORS || {})) {
      if (generators[chart]) throw new Error(`图型 ${chart} 在多个生成器文件中重复定义：${name}`);
      generators[chart] = { generate, file: name };
    }
  }
  return generators;
}

function buildVersion(renderer) {
  const hash = createHash('sha256').update(renderer.bundleSource()).update(readFileSync(fileURLToPath(import.meta.url)));
  for (const name of readdirSync(FUZZ_DIR).filter((file) => file.endsWith('.mjs')).sort()) hash.update(readFileSync(join(FUZZ_DIR, name)));
  let commit = 'unknown';
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { /* 导出的源码树没有 git 时只记录 sourceHash */ }
  return { commit, sourceHash: hash.digest('hex') };
}

/** 把一次页面检查结果整理成统一的发现项。 */
function findingsOf({ profile, geometry, audit, scene }) {
  const findings = [];
  const add = (code, detail) => findings.push({ code, detail });
  if (scene.overflow) add('TEXT_CONTAINED', scene.overflow);
  if (geometry.horizontalOverflow) add('PAGE_OVERFLOW', `页面宽 ${geometry.document.width}px，视口 ${geometry.viewport.width}px`);
  const viewBox = geometry.svg?.viewBox;
  if (!geometry.svg) add('INVALID_GEOMETRY', '页面中缺少 SVG');
  else if (![viewBox.x, viewBox.y, viewBox.width, viewBox.height].every(Number.isFinite) || viewBox.width <= 0 || viewBox.height <= 0) add('INVALID_GEOMETRY', 'viewBox 非法');
  if (geometry.invalidGeometry?.length) add('INVALID_GEOMETRY', geometry.invalidGeometry.slice(0, 5));
  if (geometry.outOfViewBoxText?.length) add('TEXT_OUTSIDE', geometry.outOfViewBoxText.slice(0, 8).map((label) => label.text));
  if (geometry.labelOverlapCandidates?.length) add('TEXT_OVERLAP', geometry.labelOverlapCandidates.slice(0, 8));
  for (const failure of audit.failures.filter((item) => String(item.key).startsWith('#chart'))) {
    if (['SMALL_TEXT', 'LOW_CONTRAST'].includes(failure.code)) add(failure.code, `${failure.where}：${failure.detail}`);
  }
  if (profile.lang === 'en') {
    const leaked = geometry.textBounds.map((label) => label.text).filter((text) => CJK.test(text));
    if (leaked.length) add('LANG_LEAK', leaked.slice(0, 8));
  }
  const svgWidth = geometry.svg?.width;
  if (Number.isFinite(svgWidth) && svgWidth > profile.width + 1) add('WIDE', `场景宽 ${svgWidth}px，给定 ${profile.width}px`);
  if (Number.isFinite(svgWidth) && svgWidth < profile.width - 1) add('UNDERFILL', `场景宽 ${svgWidth}px，给定 ${profile.width}px`);
  return findings;
}

async function runCase({ renderer, page, chart, generate, run, seed, out, version, sample }) {
  const id = `${chart}-${String(run).padStart(3, '0')}`;
  const rng = mulberry32(hashSeed(`${seed}|${chart}|${run}`));
  const profile = profileOf(rng);
  const spec = generate(helpers(rng, profile));
  const record = { id, chart, run, seed, profile, spec, findings: [], artifacts: [] };
  const validation = renderer.validate(spec);
  if (validation.errors.length) {
    record.findings.push({ code: 'INVALID_SPEC', detail: validation.errors.map((error) => `${error.path || ''} ${error.message}`.trim()) });
    return record;
  }
  const options = { width: profile.width, theme: profile.theme, lang: profile.lang, frame: true };
  const viewport = profile.width + FRAME_PADDING;
  const pageOptions = { item: { id, spec }, theme: profile.theme, viewport, version, lang: profile.lang === 'en' ? 'en' : 'zh-CN' };
  const caseDir = join(out, 'cases', chart);
  mkdirSync(caseDir, { recursive: true });
  const htmlPath = join(caseDir, `${id}.html`);
  await page.setViewport({ width: viewport, height: 900, deviceScaleFactor: 1, mobile: viewport < 600 });
  await loadMeasurementPage(page, htmlPath, pageOptions);
  let rendered;
  try {
    rendered = await hydrateMetrics(renderer, spec, options, page);
  } catch (error) {
    record.findings.push({ code: 'RENDER_ERROR', detail: String(error?.message || error) });
    return record;
  }
  if (renderer.render(spec, rendered.options).svg !== rendered.svg) {
    record.findings.push({ code: 'NONDETERMINISTIC', detail: '同输入同测字两次渲染的 SVG 不一致' });
  }
  writeFileSync(htmlPath, htmlPage({ ...pageOptions, svg: rendered.svg }), 'utf8');
  await page.goto(pathToFileURL(htmlPath).href);
  const geometry = await page.json(pageInspectionExpression());
  const audit = await page.json(inspectPageExpression({ viewport: 'mobile', printWidth: viewport }));
  record.findings.push(...findingsOf({ profile, geometry, audit, scene: rendered.scene }));
  record.scene = { width: rendered.scene.width, height: rendered.scene.height };
  const failing = record.findings.some((finding) => !INFO_CODES.has(finding.code));
  if (failing || record.findings.length || run < sample) {
    writeFileSync(join(caseDir, `${id}.svg`), rendered.svg, 'utf8');
    writeFileSync(join(caseDir, `${id}.json`), `${JSON.stringify({ ...record, version }, null, 2)}\n`, 'utf8');
    const png = await page.screenshot({ x: 0, y: 0, width: viewport, height: Math.max(1, geometry.document.height) });
    writeFileSync(join(caseDir, `${id}.png`), png);
    record.artifacts = [`cases/${chart}/${id}.json`, `cases/${chart}/${id}.svg`, `cases/${chart}/${id}.html`, `cases/${chart}/${id}.png`];
  }
  return record;
}

function summarize({ records, generators, charts, version, seed, runs }) {
  const totals = {};
  const perChart = {};
  for (const record of records) {
    const entry = perChart[record.chart] ||= { runs: 0, failing: 0, codes: {} };
    entry.runs += 1;
    if (record.findings.some((finding) => !INFO_CODES.has(finding.code))) entry.failing += 1;
    for (const code of new Set(record.findings.map((finding) => finding.code))) {
      entry.codes[code] = (entry.codes[code] || 0) + 1;
      totals[code] = (totals[code] || 0) + 1;
    }
  }
  const missing = charts.filter((chart) => !generators[chart]);
  const findings = records.filter((record) => record.findings.length).map((record) => ({
    id: record.id,
    chart: record.chart,
    codes: [...new Set(record.findings.map((finding) => finding.code))],
    profile: record.profile,
    artifacts: record.artifacts,
  }));
  return { version, seed, runs, generatedAt: new Date().toISOString(), cases: records.length, missingGenerators: missing, totals, perChart, findings };
}

export async function runFuzz({ out, seed = 20261117, runs = 24, sample = 3, charts = [], cases = [], chromePath } = {}) {
  if (!out) throw new TypeError('必须用 --out <目录> 指定输出目录');
  const output = resolve(out);
  mkdirSync(output, { recursive: true });
  const renderer = createRenderer();
  const generators = await loadGenerators();
  const catalog = [...renderer.layouts.keys()];
  const selected = charts.length ? charts : catalog;
  const unknown = selected.filter((chart) => !catalog.includes(chart));
  if (unknown.length) throw new TypeError(`未知图型：${unknown.join(', ')}`);
  const wanted = cases.map((item) => {
    const match = /^(.+)-(\d{3})$/.exec(item);
    if (!match) throw new TypeError(`--case 需要「图型-三位序号」，例如 line-007：${item}`);
    return { chart: match[1], run: Number(match[2]) };
  });
  const plan = wanted.length
    ? wanted.filter((item) => generators[item.chart])
    : selected.filter((chart) => generators[chart]).flatMap((chart) => Array.from({ length: runs }, (_, run) => ({ chart, run })));
  const version = buildVersion(renderer);
  const records = [];
  const browser = await launchBrowser(chromePath ? { chromePath } : {});
  const page = await browser.newPage();
  try {
    for (const { chart, run } of plan) {
      records.push(await runCase({ renderer, page, chart, generate: generators[chart].generate, run, seed, out: output, version, sample }));
    }
  } finally {
    await page.close();
    await browser.close();
  }
  writeFileSync(join(output, 'cases.jsonl'), `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
  const summary = summarize({ records, generators, charts: selected, version, seed, runs });
  writeFileSync(join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  const lines = Object.entries(summary.perChart).map(([chart, entry]) => `${chart}\truns=${entry.runs}\tfailing=${entry.failing}\t${Object.entries(entry.codes).map(([code, n]) => `${code}=${n}`).join(' ')}`);
  writeFileSync(join(output, 'summary.txt'), `sourceCommit=${version.commit}\nsourceHash=${version.sourceHash}\nseed=${seed}\ncases=${records.length}\nmissingGenerators=${summary.missingGenerators.join(',') || '-'}\n${lines.join('\n')}\n`, 'utf8');
  return summary;
}

export function parseArgs(args) {
  const result = { charts: [], cases: [] };
  const takes = new Set(['--out', '--seed', '--runs', '--sample', '--chart', '--case', '--chrome']);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const value = args[i + 1];
    if (!takes.has(arg) || value == null) throw new TypeError(`未知参数或缺少参数值：${arg}`);
    if (arg === '--out') result.out = value;
    else if (arg === '--seed') result.seed = Number(value);
    else if (arg === '--runs') result.runs = Number(value);
    else if (arg === '--sample') result.sample = Number(value);
    else if (arg === '--chart') result.charts.push(value);
    else if (arg === '--case') result.cases.push(value);
    else result.chromePath = value;
    i += 1;
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const summary = await runFuzz(parseArgs(process.argv.slice(2)));
    const failing = Object.values(summary.perChart).reduce((sum, entry) => sum + entry.failing, 0);
    process.stdout.write(`KChart 随机检查完成：${summary.cases} 例，${failing} 例有失败项；缺生成器 ${summary.missingGenerators.length} 种\n`);
    process.exitCode = failing ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 2;
  }
}
