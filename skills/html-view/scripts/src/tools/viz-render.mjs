import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { parseArgs } from '../shared/args.mjs';
import { emit, fail } from '../shared/output.mjs';
import { escapeHtml } from '../shared/html-util.mjs';
import { getTheme, listThemes } from '../shared/themes.mjs';
import { withBrowser } from '../shared/browser.mjs';
import { inferLang } from '../shared/locale.mjs';
import { createRenderer } from '../../../kchart/node.mjs';
import { createRenderer as createDiagramRenderer, detectSyntax } from '../../../kchart/diagram.mjs';

const USAGE = 'htmlview viz render <source> --out <file.svg|file.html> [--theme <id>] [--width <px>] [--lang <lang>] [--force]';
const FONT_STACK = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", "Microsoft YaHei", sans-serif';
const safeJson = (value) => JSON.stringify(value)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
const safeScript = (source) => source.replace(/<\/script/gi, '<\\/script');

function readInput(input) {
  if (input === '-') return readFileSync(0, 'utf8');
  const file = resolve(input);
  if (!existsSync(file)) fail('FILE_NOT_FOUND', `找不到图形源码：${file}`, { next: '确认源码文件路径后重试' });
  try { return readFileSync(file, 'utf8'); }
  catch (error) { fail('USAGE', `无法读取 ${file}：${error.message}`, { next: '检查文件权限后重试' }); }
}

function identify(source) {
  if (/^[\s\uFEFF]*[\[{]/.test(source)) return { kind: 'chart' };
  return { kind: 'diagram', syntax: detectSyntax(source), source };
}

function renderPage(bundle, kind, input, { theme, width, lang, assets, fontFamily }) {
  const payload = safeJson(input);
  const assetPayload = safeJson(assets ?? {});
  const expression = kind === 'chart'
    ? `KChart.render(${payload}, options)`
    : `KChart.diagram(${safeJson(input.source)}, { ...options, syntax: ${safeJson(input.syntax)} })`;
  const script = `window.__vizResult = (async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    const context = document.createElement('canvas').getContext('2d');
    const measure = (text, size = 12, weight = 400, font = ${safeJson(fontFamily)}) => {
      context.font = String(weight) + ' ' + String(size) + 'px ' + font;
      return context.measureText(String(text ?? '')).width;
    };
    const options = { width: ${width}, theme: ${safeJson(theme)}, lang: ${safeJson(lang)}, assets: ${assetPayload}, frame: true, measure };
    const result = ${expression};
    if (!result?.svg) throw new Error(result?.diagnostics?.map((item) => item.message).join('；') || 'KChart 未生成 SVG');
    document.getElementById('viz').innerHTML = result.svg;
    return result.svg;
  })();`;
  return `<!doctype html><html lang="${lang === 'en' ? 'en' : 'zh-CN'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0}body{font-family:${FONT_STACK}}#viz{overflow-x:auto}#viz svg{display:block;max-width:none}</style></head><body><main id="viz"></main><script>${safeScript(bundle)}\n</script><script>${safeScript(script)}</script></body></html>`;
}

async function measuredSvg(html) {
  const directory = mkdtempSync(join(tmpdir(), 'htmlview-viz-'));
  const file = join(directory, 'render.html');
  try {
    writeFileSync(file, html, 'utf8');
    return await withBrowser(async (browser) => {
      const page = await browser.newPage();
      try {
        await page.goto(pathToFileURL(file).href);
        await page.evaluate('window.__vizResult');
        const svg = await page.evaluate("document.querySelector('#viz svg')?.outerHTML || ''");
        if (!svg) throw new Error('浏览器没有生成 SVG');
        const width = Number((svg.match(/<svg\b[^>]*\bwidth=[\"']([\d.]+)/) || [])[1]);
        const height = Number((svg.match(/<svg\b[^>]*\bheight=[\"']([\d.]+)/) || [])[1]);
        if (!(width > 0 && height > 0)) throw new Error('浏览器 SVG 缺少有效宽高');
        return { svg, width, height };
      } finally { await page.close(); }
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

// 推断语言只看读者会读到的文字：KChart JSON 取标题、说明、字段标签和数据里的文字值，
// 不计入键名、图型和字段名；结构图源码整体参与，关键字很少。
function readerText(source) {
  let spec;
  try { spec = JSON.parse(source); } catch { return [source]; }
  const texts = [];
  const collect = (value) => {
    if (typeof value === 'string') texts.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  for (const key of ['title', 'subtitle', 'note', 'source', 'unit']) collect(spec?.[key]);
  for (const field of Object.values(spec?.fields || {})) collect([field?.label, field?.unit]);
  collect(spec?.data);
  return texts;
}

export async function run(argv) {
  const { values, positionals } = parseArgs(argv, {
    out: { type: 'string' },
    theme: { type: 'string', default: 'claude' },
    width: { type: 'string', default: '800' },
    lang: { type: 'string' },
    force: { type: 'boolean' },
  }, { positionals: [1, 1], usage: USAGE });
  if (!values.out) fail('USAGE', '必须提供 --out <file.svg|file.html>', { next: USAGE });
  const theme = getTheme(values.theme);
  const themes = listThemes();
  if (!theme) fail('USAGE', `未知主题：${values.theme}`, { next: `可用主题：${(Array.isArray(themes) ? themes.map((item) => typeof item === 'string' ? item : item.id) : Object.keys(themes)).join('、')}` });
  const width = Number(values.width);
  if (!Number.isFinite(width) || width < 120 || width > 4000) fail('USAGE', '--width 必须是 120 至 4000 的有限数', { next: USAGE });
  if (values.lang !== undefined && !/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(values.lang)) fail('USAGE', '--lang 必须为 BCP 47 标签', { next: USAGE });
  const out = resolve(values.out);
  const format = extname(out).toLowerCase();
  if (!['.svg', '.html'].includes(format)) fail('USAGE', '--out 扩展名必须是 .svg 或 .html', { next: USAGE });
  if (!values.force && existsSync(out)) fail('FILE_EXISTS', `目标文件已存在：${out}`, { next: '选择新文件，或明确要替换时使用 --force。' });
  const input = positionals[0];
  if (input !== '-' && resolve(input) === out) fail('USAGE', '输出不能覆盖声明输入文件', { next: USAGE });
  const source = readInput(input).replace(/^\uFEFF/, '');
  const lang = values.lang ?? inferLang(...readerText(source));
  const detected = identify(source);
  let bundle;
  let assets;
  let fallback;
  if (detected.kind === 'chart') {
    const parser = createRenderer();
    const parsed = parser.parse(source);
    if (parsed.errors?.length || !parsed.data) fail('USAGE', 'KChart JSON 不符合声明契约', {
      next: '按 errors 中的 JSON Pointer、源码位置与 fix 修正输入', details: { errors: parsed.errors },
    });
    detected.spec = parsed.data;
    const renderer = createRenderer({ specs: [parsed.data] });
    assets = renderer.assets(parsed.data);
    fallback = renderer.render(parsed.data, { width, theme: values.theme, lang, assets });
    bundle = renderer.bundleSource();
  } else {
    const renderer = createDiagramRenderer({ sources: [{ syntax: detected.syntax, source }] });
    const diagnostics = renderer.check(source, { syntax: detected.syntax, lang });
    if (diagnostics.length) fail('USAGE', '结构图源码不符合语法契约', {
      next: '按 diagnostics 中的位置与改法修正源码', details: { diagnostics },
    });
    fallback = renderer.diagram(source, { syntax: detected.syntax, width, theme: values.theme, lang });
    bundle = renderer.bundleSource();
  }
  if (!fallback?.svg) fail('USAGE', 'KChart 无法布局此图形', { next: '检查图形语法、图型数据与可用布局', details: { diagnostics: fallback?.diagnostics } });

  const measured = await measuredSvg(renderPage(bundle, detected.kind, detected.kind === 'chart' ? detected.spec : detected, {
    theme: values.theme, width, lang, assets, fontFamily: theme.fontFamily || FONT_STACK,
  }));
  const title = fallback.scene.heading ?? fallback.scene.title ?? 'KChart';
  const sourceLabel = /^zh(?:-|$)/i.test(lang) ? '图形源码' : 'Source';
  // 32px 页面内边距加图框两侧各 1px 边框。折叠源码不属于图身，打印展开后可以另页接续。
  // HTML 输出是静态成品，不冒充可重组外壳的阅读文档；仍可由通用工具检查和导出。
  const content = format === '.svg' ? measured.svg : `<!doctype html>
<html lang="${escapeHtml(lang)}" data-theme="${theme.id}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>${theme.css}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg-1);font:14px/1.6 var(--font-sans)}main{max-width:${measured.width + 34}px;margin:auto;padding:16px}.viz-shell{border:1px solid var(--line);border-radius:10px;background:var(--surface)}figure{margin:0}.viz-body{overflow:auto}svg{display:block;max-width:none}details{padding:12px 16px;border-top:1px solid var(--line)}pre{overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}@media print{figure{break-inside:avoid}}</style></head>
<body><main><div class="viz-shell"><figure class="viz-figure"><div class="viz-body">${measured.svg}</div></figure><details><summary>${sourceLabel}</summary><pre>${escapeHtml(source)}</pre></details></div></main></body></html>\n`;
  try {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, content, 'utf8');
  } catch (error) {
    fail('USAGE', `无法写入 ${out}：${error.message}`, { next: '换一个可写的 --out 路径' });
  }
  emit({ file: out, format: format.slice(1), width: measured.width, height: measured.height, bytes: Buffer.byteLength(content) });
}
