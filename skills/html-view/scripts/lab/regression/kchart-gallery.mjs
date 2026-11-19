// 确定性 KChart 验收图库：只使用公开渲染入口和本机真实 Chrome。
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRenderer } from '../../../kchart/node.mjs';
import { launchBrowser } from '../../src/shared/browser.mjs';
import { getTheme, listThemes, readingCss } from '../../src/shared/themes.mjs';
import { KCHART_CASES } from '../../../kchart/tests/kchart-cases.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const ALL_WIDTHS = [1040, 558, 324];
const ALL_THEMES = listThemes().map(theme => theme.id);
// 默认只跑默认亮色与暗色主题；六主题验收用 --theme 显式指定。
const DEFAULT_THEMES = ['claude', 'obsidian'];
const ESC = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const safeName = value => String(value).replace(/[^a-zA-Z0-9_-]/g, '-');
const mkdir = path => mkdirSync(path, { recursive: true });
const read = path => readFileSync(path, 'utf8');
const saveJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

function themeCss(theme) {
  return `${getTheme(theme).css}\n${readingCss()}\nhtml,body{margin:0;min-height:100%;background:var(--bg);color:var(--fg-2);font:14px/1.6 var(--font-sans)}\n`;
}

export function htmlPage({ item, svg, theme, viewport, version, lang = 'zh-CN' }) {
  const css = themeCss(theme);
  const spec = JSON.stringify(item.spec, null, 2);
  const rows = Array.isArray(item.spec.data) ? item.spec.data : item.spec.data?.rows || [];
  const table = rows.length ? `<div class="data-table"><table aria-label="虚构输入记录"><tbody>${rows.map(row => `<tr>${Object.entries(row).map(([key, value]) => `<td>${ESC(`${key}: ${JSON.stringify(value)}`)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '';
  return `<!doctype html><html lang="${lang}" data-theme="${theme}" data-scheme="${getTheme(theme).scheme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${ESC(item.id)} · KChart</title><style>${css}\n*{box-sizing:border-box}main{width:min(100%,${viewport}px);margin:0 auto;padding:18px 16px 28px}h1{margin:0 0 4px;font-size:14px;color:var(--fg-3);font-weight:500}p{margin:0 0 14px;color:var(--fg-3);font-size:12px}.chart-frame{max-width:100%;overflow-x:auto;overflow-y:hidden;background:var(--surface);padding:12px;border-radius:var(--radius,10px)}.chart-frame svg{display:block;max-width:none;height:auto}details{margin-top:14px}summary{cursor:pointer;color:var(--fg-1)}pre,.data-table{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--surface);padding:12px;border-radius:var(--radius-sm,6px);max-height:32rem;overflow:auto}table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px}td,th{padding:4px 8px;border-bottom:1px solid var(--line);text-align:left;overflow-wrap:anywhere}small{display:block;margin-top:8px;color:var(--fg-3);font-size:12px;overflow-wrap:anywhere}</style></head><body><main><h1>${ESC(item.id)}</h1><p>虚构聚合输入 · ${ESC(item.spec.chart)}${item.spec.variant ? ` · variant=${ESC(item.spec.variant)}` : ''}${item.spec.layout ? ` · layout=${ESC(item.spec.layout)}` : ''} · ${viewport}px · ${theme}</p><section class="chart-frame" id="chart">${svg}</section><script>(()=>{const frame=document.querySelector('#chart');const center=()=>{const svg=frame.querySelector('svg'),x=Number(svg?.getAttribute('data-kchart-anchor-x'));if(!svg||!(frame.scrollWidth>frame.clientWidth)||!Number.isFinite(x))return;const svgLeft=svg.getBoundingClientRect().left-frame.getBoundingClientRect().left+frame.scrollLeft;frame.scrollLeft=Math.max(0,Math.min(frame.scrollWidth-frame.clientWidth,svgLeft+x-frame.clientWidth/2));};center();new ResizeObserver(center).observe(frame);})();</script><details><summary>原始 KChart 声明与数据</summary><pre id="source">${ESC(spec)}</pre>${table}</details><small>产物源版本：${ESC(version.commit)} · ${ESC(version.sourceHash)}</small></main></body></html>`;
}

const keyOf = (text, size, weight, fontFamily) => JSON.stringify([text, size, weight, fontFamily]);

export function measurementExpression(requests) {
  // Canvas 直接使用库交给 measure 的字体，页面 CSS 不再覆盖生成 SVG 的字族。
  return `JSON.stringify((() => {
    const ctx = document.createElement('canvas').getContext('2d');
    return ${JSON.stringify(requests)}.map(({ weight, size, fontFamily, text }) => {
      ctx.font = weight + ' ' + size + 'px ' + fontFamily;
      return ctx.measureText(text).width;
    });
  })())`;
}

/** 先载入同主题、同语言、同宽度的空图页，测字与随后的渲染用同一字体。 */
export async function loadMeasurementPage(page, file, pageOptions) {
  writeFileSync(file, htmlPage({ ...pageOptions, svg: '' }), 'utf8');
  await page.goto(pathToFileURL(file).href);
}
// 换行与省略号会按上一轮实测结果生成新字串，每轮批量补测；轮数上限只防止实现死循环。
const MEASURE_PASSES = 32;

/** 用真实 Chrome canvas 测字反复渲染到所有文字都有实测宽度；返回渲染结果与可复用的测字函数。 */
export async function hydrateMetrics(renderer, spec, options, page) {
  // 迁移对比沿用宿主版心的字体。通过主题显式将它交给库，SVG 脱离样式表也能显示同一字族。
  const fontFamily = await page.evaluate(`getComputedStyle(document.querySelector('.chart-frame')).fontFamily`);
  const theme = renderer.theme({ ...renderer.theme(options.theme), fontFamily });
  const resolved = { ...options, theme };
  const measured = new Map();
  for (let pass = 0; pass < MEASURE_PASSES; pass += 1) {
    const pending = new Map();
    const measure = (text, size = 12, weight = 400, font = fontFamily) => {
      const key = keyOf(String(text), size, weight, font);
      if (!measured.has(key)) pending.set(key, { text: String(text), size, weight, fontFamily: font });
      return measured.get(key) ?? Math.max(1, [...String(text)].length * size * 0.55);
    };
    const rendered = renderer.render(spec, { ...resolved, measure });
    if (rendered.diagnostics?.length) {
      if (!pending.size) throw new Error(rendered.diagnostics.map(({ message }) => message).join('；'));
    } else if (!pending.size) {
      return { ...rendered, options: { ...resolved, measure } };
    }
    const requests = [...pending.values()];
    const response = await page.json(measurementExpression(requests));
    requests.forEach((entry, i) => measured.set(keyOf(entry.text, entry.size, entry.weight, entry.fontFamily), response[i]));
  }
  throw new Error(`真实canvas字体测量未收敛：${spec.chart}`);
}

export function inspectVariantImplementation(renderer, spec, options = {}) {
  if (!spec.variant) return { supported: true, reason: 'default chart case; not a variant claim', chart: spec.chart };
  // 这些显式变体按契约等同于省略 variant；其余变体必须有可观察的场景差异。
  const defaultVariants = {
    bar: 'solid', column: 'solid', share: 'solid', donut: 'solid', funnel: 'bars', gauge: 'bar',
    dumbbell: 'solid', waterfall: 'solid', histogram: 'solid', scatter: 'dots', heatmap: 'cells',
    calendar: 'cells', waffle: 'dots', mindmap: 'editorial', network: 'lines',
  };
  const validation = renderer.validate(spec);
  if (validation.errors.length) return { supported: false, reason: `invalid variant ${spec.chart}.${spec.variant}: ${validation.errors.map(error => error.message).join('; ')}`, chart: spec.chart };
  if (!renderer.layouts.has(spec.chart)) return { supported: false, reason: `no loaded renderer for ${spec.chart}.${spec.variant}`, chart: spec.chart };

  try {
    const variant = renderer.render(spec, options).scene;
    const baselineSpec = { ...spec };
    delete baselineSpec.variant;
    const baseline = renderer.render(baselineSpec, options).scene;
    if (!isDeepStrictEqual(variant.children, baseline.children)) return { supported: true, reason: 'variant changes real renderer geometry', chart: spec.chart };
    if (defaultVariants[spec.chart] === spec.variant) return { supported: true, reason: 'validated controlled alias of the default layout', chart: spec.chart };
    return { supported: false, reason: `variant ${spec.chart}.${spec.variant} does not change renderer geometry`, chart: spec.chart };
  } catch (error) {
    return { supported: false, reason: `variant probe failed: ${error.message}`, chart: spec.chart };
  }
}

export function pageInspectionExpression() {
  return `JSON.stringify((() => {
    const svg=document.querySelector('#chart svg');
    const rect=(b,m)=>{const pts=[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(m));const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);return{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)}};
    const invalid=[],outside=[],labels=[];let viewBox={x:0,y:0,width:0,height:0};
    if(svg){const vb=svg.viewBox.baseVal;viewBox={x:vb.x,y:vb.y,width:vb.width,height:vb.height};const rootMatrix=svg.getCTM();
      for(const el of svg.querySelectorAll('*')){
        for(const a of el.attributes){const v=a.value;if(/^(?:d|points|transform)$/.test(a.name)&&/NaN|Infinity/i.test(v))invalid.push({tag:el.tagName,attribute:a.name,value:v.slice(0,120)});if(['x','y','x1','x2','y1','y2','width','height','cx','cy','r','rx','ry'].includes(a.name)&&!Number.isFinite(Number(String(v).replace(/%$/,''))))invalid.push({tag:el.tagName,attribute:a.name,value:v});}
        if(el.hasAttribute('d')||el.hasAttribute('points')){try{const b=el.getBBox();if(![b.x,b.y,b.width,b.height].every(Number.isFinite))invalid.push({tag:el.tagName,reason:'non-finite getBBox'});}catch(e){invalid.push({tag:el.tagName,reason:String(e)});}}
        if(el.tagName.toLowerCase()==='text'){try{const b=el.getBBox(),m=rootMatrix.inverse().multiply(el.getCTM()),box=rect(b,m),text=(el.textContent||'').trim();const size=parseFloat(getComputedStyle(el).fontSize)||12,em=rect({x:b.x,y:b.y+b.height/2-size/2,width:b.width,height:size},m);const label={text,bounds:box,em};labels.push(label);const eps=.5;if(box.x<viewBox.x-eps||box.y<viewBox.y-eps||box.x+box.width>viewBox.x+viewBox.width+eps||box.y+box.height>viewBox.y+viewBox.height+eps)outside.push(label);}catch(e){invalid.push({tag:'text',reason:String(e)});}}
      }
    }
    // 互盖按字号高的 em 框判断：getBBox 的行盒含字体行距，相邻换行会误报。
    const overlaps=[];for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){const a=labels[i].em,b=labels[j].em;const w=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x),h=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);if(w>1&&h>1)overlaps.push({first:labels[i].text,second:labels[j].text,intersection:{width:w,height:h}});}
    const frame=document.querySelector('.chart-frame'),r=svg?.getBoundingClientRect();
    return{viewport:{width:innerWidth,height:innerHeight},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},horizontalOverflow:document.documentElement.scrollWidth>innerWidth,svg:svg?{width:Number(svg.getAttribute('width')),height:Number(svg.getAttribute('height')),viewBox,client:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,frame:{clientWidth:frame.clientWidth,scrollWidth:frame.scrollWidth,svgWidth:Number(svg.getAttribute('width')),internalOverflow:frame.scrollWidth>frame.clientWidth}}:null,invalidGeometry:invalid,textBounds:labels,outOfViewBoxText:outside,labelOverlapCandidates:overlaps};
  })())`;
}

export function geometryFailures(inspection) {
  const failures = [];
  if (inspection.horizontalOverflow) failures.push('整页存在水平溢出');
  if (!inspection.svg) failures.push('页面中缺少SVG');
  const viewBox = inspection.svg?.viewBox;
  if (viewBox && ![viewBox.x, viewBox.y, viewBox.width, viewBox.height].every(Number.isFinite)) failures.push('viewBox含非有限几何');
  if (viewBox && (viewBox.width <= 0 || viewBox.height <= 0)) failures.push('viewBox尺寸非正数');
  if (inspection.invalidGeometry?.length) failures.push(`存在非有限/非法几何 ${inspection.invalidGeometry.length} 项`);
  if (inspection.outOfViewBoxText?.length) failures.push(`SVG text超出viewBox ${inspection.outOfViewBoxText.length} 项`);
  return failures;
}

async function inspectPage(page) { return page.json(pageInspectionExpression()); }
function geometryLog(scene, inspection) {
  return {
    rendererScene: { width: scene.width, height: scene.height },
    browser: inspection,
    svgTextBounds: inspection.textBounds,
    outOfViewBoxText: inspection.outOfViewBoxText,
    invalidGeometry: inspection.invalidGeometry,
    labelOverlapCandidates: inspection.labelOverlapCandidates,
    scrollExplanation: inspection.svg?.frame?.internalOverflow ? '超宽内容限制在图内水平滚动容器；整页无水平溢出，完整SVG另存' : null,
  };
}

function buildVersion(renderer) {
  const bundle = renderer.bundleSource();
  const sourceHash = createHash('sha256').update(bundle).update(read(fileURLToPath(import.meta.url))).update(read(new URL('../../../kchart/tests/kchart-cases.mjs', import.meta.url))).digest('hex');
  let commit = 'unknown';
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* 导出的源码树没有 git 时仍可生成，只是不记录 commit */ }
  return { commit, sourceHash };
}

export function selectGalleryCases({ caseIds = [], themes = DEFAULT_THEMES, widths = ALL_WIDTHS } = {}) {
  caseIds = [...new Set(caseIds)];
  themes = [...new Set(themes)];
  widths = [...new Set(widths)];
  const unknown = caseIds.filter(id => !KCHART_CASES.some(item => item.id === id));
  if (unknown.length) throw new TypeError(`未知case id: ${unknown.join(', ')}`);
  if (themes.some(theme => !ALL_THEMES.includes(theme))) throw new TypeError(`theme只允许: ${ALL_THEMES.join(', ')}`);
  if (widths.some(width => !ALL_WIDTHS.includes(width))) throw new TypeError(`width只允许: ${ALL_WIDTHS.join(', ')}`);
  return { cases: KCHART_CASES.filter(item => !caseIds.length || caseIds.includes(item.id)), themes, widths };
}

function clearCombination(caseDir, base) {
  for (const suffix of ['svg', 'html', 'png', 'bounds.json', 'failure.json', 'failure.svg', 'failure.html', 'failure.png']) rmSync(join(caseDir, `${base}.${suffix}`), { force: true });
}

export async function generateGallery({ out, chromePath, caseIds = [], themes = DEFAULT_THEMES, widths = ALL_WIDTHS } = {}) {
  if (!out) throw new TypeError('必须使用 --out <directory> 指定验收artifact目录');
  const selected = selectGalleryCases({ caseIds, themes, widths });
  const output = resolve(out), renderer = createRenderer(), version = buildVersion(renderer);
  mkdir(output);
  const failures = [], successes = [];
  let browser = null, browserError = null, page = null;
  try { browser = await launchBrowser(chromePath ? { chromePath } : {}); page = await browser.newPage(); } catch (error) { browserError = error; }
  try {
    for (const item of selected.cases) {
      const caseDir = join(output, safeName(item.id));
      mkdir(caseDir);
      saveJson(join(caseDir, 'input.json'), { id: item.id, referenceIds: item.referenceIds, spec: item.spec, sourceVersion: version });
      for (const theme of selected.themes) for (const viewportWidth of selected.widths) {
        const base = `${theme}-${viewportWidth}`;
        clearCombination(caseDir, base);
        const fileRecord = { id: item.id, referenceIds: item.referenceIds, chart: item.spec.chart, variant: item.spec.variant || null, layout: item.spec.layout || null, theme, viewport: viewportWidth, sourceVersion: version };
        let diagnostic = null;
        let pageLoaded = false;
        try {
          if (!page) throw browserError || new Error('浏览器不可用');
          await page.setViewport({ width: viewportWidth, height: 900, deviceScaleFactor: 1, mobile: viewportWidth < 600 });
          await loadMeasurementPage(page, join(caseDir, `${base}.html`), { item, theme, viewport: viewportWidth, version });
          const usableWidth = Math.max(240, viewportWidth - 56); // main padding 32px + frame padding 24px
          const renderOptions = { width: usableWidth, theme, lang: 'zh-CN', frame: true };
          const variantImplementation = inspectVariantImplementation(renderer, item.spec, renderOptions);
          if (!variantImplementation.supported) throw new Error(variantImplementation.reason);
          const { scene, svg } = await hydrateMetrics(renderer, item.spec, renderOptions, page);
          const html = htmlPage({ item, svg, theme, viewport: viewportWidth, version });
          diagnostic = { html, svg };
          writeFileSync(join(caseDir, `${base}.svg`), svg, 'utf8');
          writeFileSync(join(caseDir, `${base}.html`), html, 'utf8');
          await page.goto(pathToFileURL(join(caseDir, `${base}.html`)).href);
          pageLoaded = true;
          const inspection = await inspectPage(page);
          const gateFailures = geometryFailures(inspection);
          const log = geometryLog(scene, inspection);
          if (gateFailures.length) throw Object.assign(new Error(gateFailures.join('; ')), { geometryLog: log, gateFailures });
          const png = await page.screenshot({ x: 0, y: 0, width: viewportWidth, height: Math.max(1, inspection.document.height) });
          writeFileSync(join(caseDir, `${base}.png`), png);
          const report = { ...fileRecord, status: 'success', variantImplementation, geometry: log, artifacts: [`${base}.svg`, `${base}.html`, `${base}.png`, `${base}.bounds.json`] };
          saveJson(join(caseDir, `${base}.bounds.json`), report);
          rmSync(join(caseDir, `${base}.failure.json`), { force: true });
          successes.push(report);
        } catch (error) {
          clearCombination(caseDir, base); // 失败图只保留带 failure 标记的诊断产物，不能伪装成成功。
          const diagnosticArtifacts = [];
          if (diagnostic) {
            for (const extension of ['svg', 'html']) {
              const name = `${base}.failure.${extension}`;
              writeFileSync(join(caseDir, name), diagnostic[extension], 'utf8');
              diagnosticArtifacts.push(name);
            }
          }
          if (pageLoaded) {
            try {
              const height = await page.json('JSON.stringify(document.documentElement.scrollHeight)');
              const name = `${base}.failure.png`;
              writeFileSync(join(caseDir, name), await page.screenshot({ x: 0, y: 0, width: viewportWidth, height: Math.max(1, height) }));
              diagnosticArtifacts.push(name);
            } catch { /* 截图失败不覆盖原始几何或渲染诊断。 */ }
          }
          const failure = { ...fileRecord, status: 'failure', artifacts: diagnosticArtifacts, phase: !page ? 'browser' : error.gateFailures ? 'geometry-gate' : item.spec.variant ? 'variant-implementation' : 'render-or-capture', error: String(error?.stack || error), ...(error.gateFailures ? { gateFailures: error.gateFailures, geometry: error.geometryLog } : {}) };
          failures.push(failure);
          saveJson(join(caseDir, `${base}.failure.json`), failure);
        }
      }
    }
  } finally {
    if (page) await page.close();
    if (browser) await browser.close();
  }
  const index = {
    generatedAt: new Date().toISOString(),
    visualAcceptance: 'not-performed',
    renderer: 'html-view/kchart/node.mjs createRenderer; actual Chrome canvas text metrics',
    sourceVersion: version,
    viewportWidths: selected.widths,
    themes: selected.themes,
    selectedCases: selected.cases.map(item => item.id),
    availableCases: KCHART_CASES.length,
    totalCases: selected.cases.length,
    totalCaptures: selected.cases.length * selected.widths.length * selected.themes.length,
    successCount: successes.length,
    failureCount: failures.length,
    referenceIds: [...new Set(selected.cases.flatMap(item => item.referenceIds))].sort(),
    successes,
    failures,
  };
  saveJson(join(output, 'index.json'), index);
  writeFileSync(join(output, 'summary.txt'), `sourceCommit=${version.commit}\nsourceHash=${version.sourceHash}\nscenarios=${index.totalCases}\ncaptures=${index.totalCaptures}\nsuccess=${index.successCount}\nfailures=${index.failureCount}\nvisualAcceptance=${index.visualAcceptance}\n`);
  return index;
}

export function parseArgs(args) {
  const result = { caseIds: [], themes: [], widths: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i], value = args[i + 1];
    if (arg === '--out' && value) result.out = value;
    else if (arg === '--chrome' && value) result.chromePath = value;
    else if (arg === '--case' && value) result.caseIds.push(value);
    else if (arg === '--theme' && value) result.themes.push(value);
    else if (arg === '--width' && value) result.widths.push(Number(value));
    else throw new TypeError(`未知参数或缺少参数值：${arg}`);
    if (['--out', '--chrome', '--case', '--theme', '--width'].includes(arg)) i += 1;
  }
  if (!result.themes.length) delete result.themes;
  if (!result.widths.length) delete result.widths;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await generateGallery(parseArgs(process.argv.slice(2)));
    process.stdout.write(`KChart 验收生成完毕：场景 ${result.totalCases}，成功 ${result.successCount}，失败 ${result.failureCount}\n`);
    process.exitCode = result.failureCount ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 2;
  }
}
