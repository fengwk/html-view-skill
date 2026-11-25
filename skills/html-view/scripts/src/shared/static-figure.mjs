import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { fail } from './output.mjs';
import { escapeHtml } from './html-util.mjs';
import { renderShell } from './shell.mjs';
import { withBrowser } from './browser.mjs';
import { inferLang } from './locale.mjs';
import { createRenderer, detectSyntax, theme as resolveTheme } from '../../../vendor/kchart/esm/node.js';

export const VIZ_WIDTH = 'viz:width';
export const VIZ_SOURCE_ID = 'viz-source';
export const VIZ_COPY_ID = 'viz-copy';
export const validVizWidth = (width) => Number.isFinite(width) && width >= 120 && width <= 4000;
const safeJson = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');

function renderPage(bundle, kind, input, { theme, width, lang, assets, fontFamily, print }) {
  const expression = kind === 'chart'
    ? `KChart.render(${safeJson(input)}, options)`
    : `KChart.diagram(${safeJson(input.source)}, { ...options, syntax: ${safeJson(input.syntax)} })`;
  const script = `window.__vizResult = (async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    const context = document.createElement('canvas').getContext('2d');
    const measure = (text, size = 12, weight = 400, font = ${safeJson(fontFamily)}) => {
      context.font = String(weight) + ' ' + String(size) + 'px ' + font;
      return context.measureText(String(text ?? '')).width;
    };
    const render = (theme, prefix) => {
      const options = { width: ${width}, theme, prefix, lang: ${safeJson(lang)}, assets: ${safeJson(assets ?? {})}, frame: true, measure };
      const result = ${expression};
      if (!result?.svg) throw new Error(result?.diagnostics?.map((item) => item.message).join('；') || 'KChart 未生成 SVG');
      const template = document.createElement('template');
      template.innerHTML = result.svg;
      return template.content.querySelector('svg').outerHTML;
    };
    return { svg: render(${safeJson(theme)}, ${print ? "'kc-screen'" : 'undefined'}), printSvg: ${print ? `render(${safeJson(print)}, 'kc-print')` : "''"} };
  })();`;
  return `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"></head><body><script>${bundle}</script><script>${script}</script></body></html>`;
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
        const { svg, printSvg } = await page.json('window.__vizResult');
        const width = Number((svg.match(/<svg\b[^>]*\bwidth=[\"']([\d.]+)/) || [])[1]);
        const height = Number((svg.match(/<svg\b[^>]*\bheight=[\"']([\d.]+)/) || [])[1]);
        if (!(width > 0 && height > 0)) throw new Error('浏览器 SVG 缺少有效宽高');
        return { svg, printSvg, width, height };
      } finally { await page.close(); }
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

// 推断语言只看读者会读到的文字，不计图型和字段名。
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

export async function measureFigure(source, { theme, width, lang, standalone }) {
  if (!validVizWidth(width)) fail('USAGE', '--width 必须是 120 至 4000 的有限数', { next: '以 CSS 像素指定宽度。' });
  if (lang !== undefined && !/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(lang)) fail('USAGE', '--lang 必须为 BCP 47 标签', { next: '使用 zh-CN、en 等标签。' });
  lang ??= inferLang(...readerText(source));
  const kind = /^[\s\uFEFF]*[\[{]/.test(source) ? 'chart' : 'diagram';
  let input, bundle, assets, fallback;
  if (kind === 'chart') {
    const parser = createRenderer({ specs: [] });
    const parsed = parser.parse(source);
    if (parsed.errors?.length || !parsed.data) fail('USAGE', 'KChart JSON 不符合声明契约', {
      next: '按 errors 中的 JSON Pointer、源码位置与 fix 修正输入', details: { errors: parsed.errors },
    });
    input = parsed.data;
    const renderer = createRenderer({ specs: [input] });
    assets = renderer.assets(input);
    fallback = renderer.render(input, { width, theme, lang, assets });
    bundle = renderer.bundleSource();
  } else {
    const syntax = detectSyntax(source);
    input = { source, syntax };
    const renderer = createRenderer({ sources: [input] });
    // Warnings accompany a rendered figure; only errors stop the build.
    const diagnostics = renderer.check(source, { syntax, theme, lang }).filter((item) => item.severity !== 'warning');
    if (diagnostics.length) fail('USAGE', '结构图源码不符合语法契约', {
      next: '按 diagnostics 中的位置与改法修正源码', details: { diagnostics },
    });
    fallback = renderer.diagram(source, { syntax, width, theme, lang });
    bundle = renderer.bundleSource();
  }
  if (!fallback?.svg) fail('USAGE', 'KChart 无法布局此图形', { next: '检查图形语法、图型数据与可用布局', details: { diagnostics: fallback?.diagnostics } });
  const design = resolveTheme(theme);
  // Standalone HTML ships print colors as a second static SVG when the figure itself changes in print.
  const print = standalone && (design.scheme === 'dark' || (kind === 'diagram' && design.bg !== '#ffffff'))
    ? resolveTheme(design, { media: 'print' }) : undefined;
  const measured = await measuredSvg(renderPage(bundle, kind, input, { theme, width, lang, assets, fontFamily: design.fontFamily, print }));
  return { ...measured, lang, title: fallback.scene.heading ?? fallback.scene.title ?? 'KChart' };
}

// 单图页不加载 doc.js：复制按钮的交互自带一段页内脚本，剪贴板接口不可用时用隐藏文本框加 execCommand 降级。
export function copyButtonScript(lang) {
  const labels = /^zh(?:-|$)/i.test(lang)
    ? { copied: '已复制', failed: '复制失败' }
    : { copied: 'Copied', failed: 'Copy failed' };
  return `(() => {
  const labels = ${JSON.stringify(labels).replaceAll('<', '\\u003c')};
  const button = document.getElementById('${VIZ_COPY_ID}');
  const source = document.getElementById('${VIZ_SOURCE_ID}');
  if (!button || !source) return;
  const idle = button.textContent;
  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.append(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      area.remove();
      return ok;
    }
  };
  let timer;
  button.addEventListener('click', async () => {
    const ok = await copyText(source.textContent);
    button.textContent = ok ? labels.copied : labels.failed;
    clearTimeout(timer);
    timer = setTimeout(() => { button.textContent = idle; }, 1600);
  });
})();`;
}

export async function renderStaticFigure(source, { theme, width, lang }) {
  const measured = await measureFigure(source, { theme, width, lang, standalone: true });
  const copyLabel = /^zh(?:-|$)/i.test(measured.lang) ? '复制' : 'Copy';
  // 源码留在图外，打印可以换页；它只供 style/审计读取，读者拿到的是一行复制按钮。
  const style = `body{font:14px/1.6 var(--font-sans);text-autospace:no-autospace}
body>main{max-width:${measured.width + 34}px;margin:auto;padding:16px}
.viz-shell{border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}
.viz-shell figure{margin:0}.viz-shell .viz-body{overflow:auto}
.viz-copy{display:flex;justify-content:flex-end;padding:0 16px 12px}
.viz-shell pre[hidden]{display:none}
.viz-static-print{display:none}
@media print{.viz-figure{break-inside:avoid}.viz-static-screen{display:none}.viz-static-print{display:block}.viz-copy{display:none}}`;
  const svg = measured.printSvg
    ? `<div class="viz-static-screen">${measured.svg}</div><div class="viz-static-print">${measured.printSvg}</div>` : measured.svg;
  const button = `<div class="viz-copy"><button type="button" class="btn btn-sm copy" id="${VIZ_COPY_ID}">${copyLabel}</button></div>`;
  // code 避免 HTML 解析 pre 时丢掉源码开头的换行；字符引用保留原始 CR。
  const sourceHtml = escapeHtml(source).replaceAll('\r', '&#13;');
  const content = `<main><div class="viz-shell"><figure class="viz-figure"><div class="viz-body">${svg}</div></figure>${button}<pre id="${VIZ_SOURCE_ID}" hidden><code>${sourceHtml}</code></pre></div></main>`;
  const html = renderShell({
    kind: 'viz', lang: measured.lang, title: measured.title, theme,
    meta: { [VIZ_WIDTH]: String(width) }, content, styles: [style], scripts: [copyButtonScript(measured.lang)],
  });
  return { ...measured, html };
}
