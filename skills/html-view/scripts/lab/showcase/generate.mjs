#!/usr/bin/env node
// Build a static, offline showcase from the current KChart engine and synthetic fixtures.
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRenderer } from '../../../vendor/kchart/esm/node.js';
import { KCHART_CASES } from '../../../../../packages/kchart/tests/kchart-cases.mjs';
import { DIAGRAMS, MINDMAP_LAYOUTS } from './diagram-fixtures.mjs';

const GENERATOR_ID = 'html-view/scripts/lab/showcase/generate.mjs';
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out' || !args[1] || args[1].startsWith('--'))) {
  throw new Error('用法：generate.mjs [--out <目录>]');
}

function entryAt(path) {
  try { return lstatSync(path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return null;
}
function ensurePlainDirectory(path) {
  const entry = entryAt(path);
  if (!entry) {
    ensurePlainDirectory(dirname(path));
    mkdirSync(path);
  } else if (!entry.isDirectory() || realpathSync(path) !== path) {
    throw new Error(`输出必须位于普通目录，不跟随符号链接：${path}`);
  }
}
function outputDirectory(path) {
  ensurePlainDirectory(path);
  if (readdirSync(path).length) {
    const manifestFile = join(path, 'manifest.json');
    let previous;
    if (entryAt(manifestFile)?.isFile()) {
      try { previous = JSON.parse(readFileSync(manifestFile, 'utf8')); } catch { /* 无效 manifest 不视为已有图库。 */ }
    }
    if (previous?.generator !== GENERATOR_ID) throw new Error(`输出目录非空，不是本生成器创建的图库：${path}`);
  }
  return path;
}
const out = args.length ? outputDirectory(resolve(args[1])) : mkdtempSync(join(tmpdir(), 'kchart-showcase-'));
const renderer = createRenderer();
const THEMES = Object.keys(renderer.themes);
const WIDTH = 560;
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const safe = value => String(value).replace(/[^a-zA-Z0-9_-]/g, '-');
function writeOutput(relative, content) {
  const parts = relative.split('/');
  let parent = out;
  for (const part of parts.slice(0, -1)) {
    parent = join(parent, part);
    ensurePlainDirectory(parent);
  }
  const target = join(out, ...parts);
  const existing = entryAt(target);
  if (existing && (!existing.isFile() || existing.nlink !== 1)) throw new Error(`输出文件不是独立普通文件，拒绝覆盖：${target}`);
  writeFileSync(target, content, 'utf8');
}
const familyOf = chart => {
  if (['line','area','sparkline','stream','split-compare','combo','slope','launch-fan'].includes(chart)) return '趋势';
  if (['bar','column','share','pie','donut','radial-share','rose','funnel','waffle','tally'].includes(chart)) return '比较与构成';
  if (['bullet','gauge','dumbbell','interval','waterfall'].includes(chart)) return '目标与区间';
  if (['histogram','boxplot','violin','strip'].includes(chart)) return '分布';
  if (['scatter','heatmap','bubble-matrix','bump','radar','parallel'].includes(chart)) return '关系与矩阵';
  if (['candlestick','calendar'].includes(chart)) return '时间与金融';
  if (['tree','mindmap','treemap','sunburst'].includes(chart)) return '层级与脑图';
  if (['network','sankey','threads'].includes(chart)) return '网络与流向';
  if (['choropleth','geo-scatter'].includes(chart)) return '地理';
  return '结构图';
};

const chartItems = KCHART_CASES.filter(item => /^chart-/.test(item.id) || /^variant-/.test(item.id) || /^mindmap-/.test(item.id))
  .map(item => item.id.startsWith('mindmap-') ? { ...item, id: `chart-${item.id}` } : item);
const baseCharts = chartItems.filter(item => /^chart-/.test(item.id) && !item.id.startsWith('chart-mindmap-'));
if (baseCharts.length !== 45 || new Set(baseCharts.map(({ spec }) => spec.chart)).size !== 45) {
  throw new Error(`预期 45 种基础图，实际 ${baseCharts.length} 条 / ${new Set(baseCharts.map(({ spec }) => spec.chart)).size} 种`);
}
const variantItems = chartItems.filter(item => /^variant-/.test(item.id));
const declaredVariants = Object.entries(renderer.catalog).flatMap(([chart, entry]) => (entry.special.variant || []).map(variant => `${chart}:${variant}`)).sort();
const showcasedVariants = variantItems.map(({ spec }) => `${spec.chart}:${spec.variant}`).sort();
if (declaredVariants.length !== 38 || JSON.stringify(declaredVariants) !== JSON.stringify(showcasedVariants)) {
  throw new Error(`受控变体未完整覆盖：声明 ${declaredVariants.length} 项，样例 ${showcasedVariants.length} 项`);
}
const chartRecords = chartItems.map(item => ({
  id: item.id, family: familyOf(item.spec.chart), title: item.spec.title || item.spec.chart,
  chart: item.spec.chart, kind: item.id.startsWith('variant-') ? 'controlled-variant' : item.id.startsWith('chart-mindmap-') ? 'mindmap-layout' : 'chart',
  source: JSON.stringify(item.spec, null, 2), render: theme => renderer.render(item.spec, { width: WIDTH, theme, prefix: `show-${safe(item.id)}-${theme}` }),
}));
const diagramItems = [...DIAGRAMS, ...MINDMAP_LAYOUTS.map(layout => ({
  id: `diagram-mindmap-${layout}`, syntax: 'mermaid', layout,
  source: `---\nconfig:\n  layout: ${layout}\n---\nmindmap\n  root((示例计划))\n    设计\n      目标\n      约束\n    实施\n      图表\n      结构图`,
}))];
if (DIAGRAMS.length !== 30 || DIAGRAMS.filter(item => item.syntax === 'mermaid').length !== 27) {
  throw new Error(`结构图输入预期 27 种 Mermaid + 3 种原生，实际 ${DIAGRAMS.length} 条`);
}
const diagramRenderer = createRenderer({ sources: diagramItems.map(({ source, syntax }) => ({ source, syntax })) });
const diagramRecords = diagramItems.map(item => ({
  id: item.id, family: item.id.startsWith('diagram-mindmap-') ? '脑图布局' : '结构图', title: item.id,
  chart: item.id, kind: item.id.startsWith('diagram-mindmap-') ? 'mindmap-layout' : 'diagram',
  source: item.source, render: theme => diagramRenderer.diagram(item.source, { syntax: item.syntax, width: WIDTH, theme, prefix: `show-${safe(item.id)}-${theme}` }),
}));
const records = [...chartRecords, ...diagramRecords];
const cards = [];
let renders = 0;
for (const record of records) {
  for (const theme of THEMES) {
    const result = record.render(theme);
    const diagnostics = result.diagnostics || [];
    if (diagnostics.length || typeof result.svg !== 'string' || !result.svg.includes('<svg')) {
      throw new Error(`${record.id} / ${theme}: ${diagnostics.map(item => item.message).join('; ') || '没有 SVG'}`);
    }
    const relative = `svg/${theme}/${safe(record.id)}.svg`;
    writeOutput(relative, `${result.svg}\n`);
    const search = `${record.id} ${record.title} ${record.chart} ${record.family} ${theme} ${record.kind}`.toLocaleLowerCase();
    cards.push(`<article class="card" data-family="${esc(record.family)}" data-theme="${esc(theme)}" data-search="${esc(search)}"><header><div><h2>${esc(record.title)}</h2><p>${esc(record.family)} · ${esc(record.chart)} · ${esc(theme)}</p></div><a href="${relative}" target="_blank" rel="noopener">单独打开 SVG ↗</a></header><div class="preview"><img loading="lazy" src="${relative}" alt="${esc(record.title)} · ${esc(theme)}"></div><details><summary>查看合成输入</summary><pre>${esc(record.source)}</pre></details></article>`);
    renders++;
  }
}
const themeNames = THEMES.map(id => `<option value="${esc(id)}"${id === 'claude' ? ' selected' : ''}>${esc(renderer.themes[id].name)} · ${esc(id)}</option>`).join('');
const families = [...new Set(records.map(item => item.family))].sort();
const familyNames = families.map(family => `<option>${esc(family)}</option>`).join('');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KChart 图库</title><style>
:root{color-scheme:light dark;font:15px/1.55 system-ui,-apple-system,"Segoe UI","Noto Sans SC",sans-serif}*{box-sizing:border-box}body{margin:0;background:#111318;color:#e7e9ef}main{max-width:1440px;margin:auto;padding:28px 24px 56px}h1{margin:0;font-size:30px}header.intro p{max-width:75ch;color:#aeb3c0}.filters{position:sticky;top:0;z-index:2;display:flex;gap:10px;flex-wrap:wrap;padding:12px 0;background:#111318}input,select{background:#1c2029;color:inherit;border:1px solid #424755;border-radius:8px;padding:9px 12px}input{flex:1;min-width:220px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,584px),1fr));gap:16px}.card{min-width:0;background:#191c23;border:1px solid #2b303b;border-radius:12px;overflow:hidden}.card>header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:14px 16px}.card h2{margin:0;font-size:17px}.card p{margin:2px 0 0;color:#aeb3c0;font-size:12px}.card a{color:#9fbaff;font-size:12px;white-space:nowrap}.preview{padding:10px;background:#252a33;overflow:auto}.preview img{display:block;width:auto;max-width:none;height:auto}.card details{padding:10px 16px}.card summary{cursor:pointer;color:#c5c9d3}.card pre{max-height:360px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#101218;padding:12px;border-radius:6px;font-size:12px}.count{color:#aeb3c0;font-size:13px}footer{margin-top:28px;color:#aeb3c0;font-size:13px}@media(max-width:600px){main{padding:18px 12px 36px}.card>header{flex-direction:column}}
</style><main><header class="intro"><h1>KChart · 实际渲染图库</h1><p>由仓库内当前 KChart 源码即时导出。包含 45 种基础图、已登记受控变体、27 种 Mermaid 子集与 3 种原生结构图、8 种脑图布局；每个样例都可切换 ${THEMES.length} 套内置主题并单独打开 SVG。输入均为虚构合成数据，页面与图形无外网字体、脚本或资源请求。</p></header><section class="filters" aria-label="图库筛选"><input id="search" type="search" placeholder="搜索图型、分类或主题" aria-label="搜索"><select id="family" aria-label="分类"><option value="">全部分类</option>${familyNames}</select><select id="theme" aria-label="主题"><option value="">全部主题</option>${themeNames}</select></section><p class="count" id="count" aria-live="polite"></p><section class="grid">${cards.join('\n')}</section><footer>生成 ${records.length} 个场景 × ${THEMES.length} 个主题 = ${renders} 张 SVG。仅依赖 Node.js 22+ 与本地 KChart 源码。</footer><script>(()=>{const cards=[...document.querySelectorAll('.card')],q=document.querySelector('#search'),f=document.querySelector('#family'),t=document.querySelector('#theme'),count=document.querySelector('#count');function update(){let n=0;for(const card of cards){const shown=(!f.value||card.dataset.family===f.value)&&(!t.value||card.dataset.theme===t.value)&&(!q.value||card.dataset.search.includes(q.value.toLocaleLowerCase()));card.hidden=!shown;if(shown)n++}count.textContent='显示 '+n+' / '+cards.length+' 张图';}for(const control of [q,f,t])control.addEventListener('input',update);update()})();</script></main></html>`;
writeOutput('index.html', html);

// Lightweight all-theme contact sheet; actual chart geometry is reused verbatim.
const previewSpec = { chart: 'bar', title: '虚构分类比较', data: [{ category: '甲组', value: 18 }, { category: '乙组', value: 12 }, { category: '丙组', value: 22 }, { category: '丁组', value: 16 }], encode: { category: 'category', value: 'value' }, unit: '件' };
const cellW = 420, cellH = 245, cols = 2, rows = Math.ceil(THEMES.length / cols), pad = 18;
const pieces = [];
THEMES.forEach((theme, index) => {
  const { svg, diagnostics } = renderer.render(previewSpec, { width: 380, theme, prefix: `theme-preview-${theme}` });
  if (diagnostics.length) throw new Error(`主题预览 ${theme}: ${diagnostics.map(item => item.message).join('; ')}`);
  const open = svg.indexOf('>') + 1, close = svg.lastIndexOf('</svg>');
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1] || '0 0 380 200';
  const sheetX = pad + (index % cols) * cellW, sheetY = pad + Math.floor(index / cols) * cellH;
  const surface = renderer.themes[theme].surface;
  pieces.push(`<g transform="translate(${sheetX} ${sheetY})"><rect width="${cellW - pad}" height="${cellH - pad}" rx="12" fill="${surface}"/><text x="16" y="24" font-family="system-ui,sans-serif" font-size="13" fill="${renderer.themes[theme].fg1}">${esc(renderer.themes[theme].name)} · ${esc(theme)}</text><svg x="12" y="32" width="${cellW - pad - 24}" height="${cellH - pad - 44}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${svg.slice(open, close)}</svg></g>`);
});
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cellW + pad}" height="${rows * cellH + pad}" viewBox="0 0 ${cols * cellW + pad} ${rows * cellH + pad}"><rect width="100%" height="100%" fill="#f1f2f4"/>${pieces.join('')}</svg>\n`;
writeOutput('theme-matrix.svg', sheet);
const diagramSamples = ['flowchart', 'layers', 'swimlane'].map(id => DIAGRAMS.find(item => item.id === id));
const diagramCellW = 540, diagramCellH = 290, diagramPadding = 16;
const diagramPieces = diagramSamples.map((item, index) => {
  const result = diagramRenderer.diagram(item.source, { syntax: item.syntax, width: 500, theme: 'paper', prefix: `diagram-preview-${item.id}` });
  if (result.diagnostics.length) throw new Error(`结构图预览 ${item.id}: ${result.diagnostics.map(d => d.message).join('; ')}`);
  const open = result.svg.indexOf('>') + 1, close = result.svg.lastIndexOf('</svg>');
  const viewBox = /viewBox="([^"]+)"/.exec(result.svg)?.[1] || '0 0 500 250';
  return `<g transform="translate(${diagramPadding + index * diagramCellW} ${diagramPadding})"><rect width="${diagramCellW - diagramPadding}" height="${diagramCellH - diagramPadding}" rx="12" fill="#f9fafc"/><text x="16" y="24" font-family="system-ui,sans-serif" font-size="13" fill="#18191d">${esc(item.id)} · 合成示例</text><svg x="12" y="32" width="${diagramCellW - diagramPadding - 24}" height="${diagramCellH - diagramPadding - 44}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${result.svg.slice(open, close)}</svg></g>`;
});
writeOutput('diagram-matrix.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="${diagramCellW * diagramSamples.length + diagramPadding}" height="${diagramCellH + diagramPadding}" viewBox="0 0 ${diagramCellW * diagramSamples.length + diagramPadding} ${diagramCellH + diagramPadding}"><rect width="100%" height="100%" fill="#f1f2f4"/>${diagramPieces.join('')}</svg>\n`);

// Curated sheets use the same engine-rendered case records as the complete gallery.
const previewGroups = [
  { id: 'comparison-composition', title: '比较与构成', items: [['chart-bar', '分类比较 · bar'], ['chart-pie', '占比 · pie'], ['chart-donut', '环形构成 · donut'], ['chart-funnel', '阶段转化 · funnel']] },
  { id: 'trend-time', title: '趋势与时间', items: [['chart-line', '月度走势 · line'], ['chart-area', '趋势面积 · area'], ['chart-stream', '多序列走势 · stream'], ['chart-calendar', '日历分布 · calendar']] },
  { id: 'statistical-distribution', title: '统计与分布', items: [['chart-histogram', '区间频数 · histogram'], ['chart-boxplot', '分位与范围 · boxplot'], ['chart-violin', '密度分布 · violin'], ['chart-strip', '样本点 · strip']] },
  { id: 'relationships-matrix', title: '关系与矩阵', items: [['chart-scatter', '双变量关系 · scatter'], ['chart-heatmap', '热力矩阵 · heatmap'], ['chart-radar', '多维轮廓 · radar'], ['chart-parallel', '多维轨迹 · parallel']] },
  { id: 'mindmap-layouts-a', title: '脑图布局 · 一', items: [['chart-mindmap-bilateral', '双侧 · bilateral'], ['chart-mindmap-right', '向右 · right'], ['chart-mindmap-left', '向左 · left'], ['chart-mindmap-radial', '放射 · radial']] },
  { id: 'mindmap-layouts-b', title: '脑图布局 · 二', items: [['chart-mindmap-org', '组织 · org'], ['chart-mindmap-brace', '括号 · brace'], ['chart-mindmap-fishbone', '鱼骨 · fishbone'], ['chart-mindmap-timeline', '时间线 · timeline']] },
];
const contactWidth = 480, contactHeight = 320, contactPadding = 18, contactCols = 2, contactRows = 2;
for (const group of previewGroups) {
  const tiles = group.items.map(([id, label], index) => {
    const record = chartRecords.find(item => item.id === id);
    if (!record) throw new Error(`预览组 ${group.id} 缺少样例 ${id}`);
    const result = record.render('paper');
    if (result.diagnostics?.length || !result.svg) throw new Error(`${id} 预览渲染失败：${result.diagnostics?.map(d => d.message).join('; ') || '无 SVG'}`);
    const open = result.svg.indexOf('>') + 1, close = result.svg.lastIndexOf('</svg>');
    const viewBox = /viewBox="([^"]+)"/.exec(result.svg)?.[1] || '0 0 560 280';
    const x = contactPadding + (index % contactCols) * contactWidth;
    const y = contactPadding + Math.floor(index / contactCols) * contactHeight;
    return `<g transform="translate(${x} ${y})"><rect width="${contactWidth - contactPadding}" height="${contactHeight - contactPadding}" rx="12" fill="#ffffff" stroke="#e1e4ea"/><text x="16" y="24" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="#252a33">${esc(label)}</text><svg x="12" y="34" width="${contactWidth - contactPadding - 24}" height="${contactHeight - contactPadding - 44}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${result.svg.slice(open, close)}</svg></g>`;
  });
  const width = contactCols * contactWidth + contactPadding;
  const height = contactRows * contactHeight + contactPadding;
  const contactSheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f4f5f7"/>${tiles.join('')}</svg>\n`;
  writeOutput(`${group.id}.svg`, contactSheet);
}
const previewNames = ['theme-matrix.svg', 'diagram-matrix.svg', ...previewGroups.map(group => `${group.id}.svg`)];
const manifest = { generator: GENERATOR_ID, engine: 'html-view/vendor/kchart/esm/node.js', width: WIDTH, themes: THEMES, baseChartCount: baseCharts.length, controlledVariantCount: variantItems.length, mermaidCount: 27, nativeDiagramCount: 3, mindmapLayoutCount: MINDMAP_LAYOUTS.length, records: records.length, renderedSvgCount: renders, curatedPreviews: previewNames };
writeOutput('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`KChart showcase: ${baseCharts.length} base chart types, ${variantItems.length} controlled variants, ${DIAGRAMS.length} diagrams, ${MINDMAP_LAYOUTS.length} mindmap layouts; ${renders} SVGs in ${out}`);
