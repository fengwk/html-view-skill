import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRenderer } from '../../kchart/node.mjs';
import { createRenderer as createDiagramRenderer } from '../../kchart/diagram.mjs';
import { launchBrowser } from '../src/shared/browser.mjs';
import { renderShell } from '../src/shared/shell.mjs';

const runtime = readFileSync(new URL('../../kchart/src/runtime.js', import.meta.url), 'utf8');
const temp = (name) => mkdtempSync(join('/var/tmp', `htmlview-runtime-${name}-`));

// 意图：真实 Chrome 验证宽图不按已选布局缩放、滚动后仍以图锚点居中；显示空图框后由 ResizeObserver 首次排版。
test('runtime keeps wide SVG at 1:1, centers its anchor, and lays out a revealed figure', async () => {
  const spec = {
    chart: 'mindmap', layout: 'org',
    data: { label: '中心主题用于检查滚动锚点', children: Array.from({ length: 6 }, (_, i) => ({ label: `分支 ${i + 1} 的较长标题用于维持自然图宽`, children: [{ label: `详细节点 ${i + 1}` }] })) },
  };
  const renderer = createRenderer({ specs: [spec] });
  const dir = temp('wide');
  const file = join(dir, 'fixture.html');
  writeFileSync(file, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
    html,body{margin:0}#chart{width:280px;height:500px;overflow:hidden}#chart.shown{display:block}.viz-body{box-sizing:border-box;width:100%;height:450px;padding:8px;overflow-x:hidden}.viz-body.viz-scroll{overflow-x:auto}.viz-body>svg{display:block}
  </style><body><section id="chart" style="display:none"><pre data-viz="kchart">${JSON.stringify(spec)}</pre></section><script>${renderer.bundleSource()}</script><script>${runtime}</script><script>window.reveal=()=>{document.querySelector('#chart').style.display='block'}</script></body></html>`, 'utf8');
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 700, height: 700 });
    await page.goto(pathToFileURL(file).href);
    await page.evaluate('window.reveal()');
    await page.evaluate(`new Promise((resolve,reject)=>{const start=performance.now();const check=()=>{if(document.querySelector('.viz-body svg')){resolve(true);return;}if(performance.now()-start>3000){reject(new Error('visible figure was not laid out by ResizeObserver'));return;}requestAnimationFrame(check);};check();})`);
    await page.evaluate('KChart.ready()');
    const first = await page.json(`JSON.stringify((()=>{const body=document.querySelector('.viz-body'),svg=body.querySelector('svg');return {width:Number(svg.getAttribute('width')),rect:svg.getBoundingClientRect().width,client:body.clientWidth,scroll:body.scrollLeft,scrollWidth:body.scrollWidth,anchor:Number(svg.getAttribute('data-kchart-anchor-x')),offset:svg.getBoundingClientRect().left-body.getBoundingClientRect().left+body.scrollLeft,overflow:getComputedStyle(body).overflowX};})())`);
    assert.ok(first.width > first.client, JSON.stringify(first));
    assert.ok(Math.abs(first.rect - first.width) < 1, `SVG remains 1:1: ${JSON.stringify(first)}`);
    assert.ok(first.scrollWidth > first.client && first.overflow === 'auto', JSON.stringify(first));
    const target = Math.max(0, Math.min(first.scrollWidth - first.client, first.offset + first.anchor - first.client / 2));
    assert.ok(Math.abs(first.scroll - target) < 1, JSON.stringify(first));
  } finally {
    await page.close();
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// 意图：宽流程图按打印版心重排，内容放不下也不能用缩小 SVG 掩盖裁切。
test('runtime preserves 1:1 geometry for a diagram wider than the print column', async () => {
  const source = `---\ntitle: 失败按有限退避重试，30 分钟无回执只查询一次\n---\nflowchart TD\n  A[Outbox 发布任务] --> B[Kafka 消费并校验状态]\n  B --> C[调用渠道网关]\n  C --> D{渠道结果}\n  D -->|明确成功| E[等待回执]\n  D -->|明确失败| F{是否可重试且未达上限}\n  F -->|是| G[按 1、5、15 分钟计划重试]\n  G --> C\n  F -->|否| H[标记失败并告警]\n  E --> I{30 分钟内收到回执}\n  I -->|是| J[去重并更新状态]\n  I -->|否| K[主动查询一次]\n  K --> L{查询结果可确定}\n  L -->|是| J\n  L -->|否| M[保留未知状态并告警]`;
  const renderer = createDiagramRenderer({ sources: [{ syntax: 'mermaid', source }] });
  const dir = temp('mermaid-print');
  const file = join(dir, 'fixture.html');
  const css = readFileSync(new URL('../../assets/page/viz.css', import.meta.url), 'utf8');
  const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  writeFileSync(file, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>html,body{margin:0}.viz-body{box-sizing:border-box;width:688px;padding:12px 16px}.viz-body>svg{display:block;max-width:none;height:auto}</style><style>${css}</style><body><pre data-viz="mermaid">${escape(source)}</pre><script>${renderer.bundleSource()}</script><script>${runtime}</script></body></html>`, 'utf8');
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(pathToFileURL(file).href);
    await page.evaluate('KChart.ready()');
    const screen = await page.json(`JSON.stringify((()=>{const body=document.querySelector('.viz-body'),svg=body.querySelector('svg');return {width:Number(svg.getAttribute('width')),rect:svg.getBoundingClientRect().width,client:body.clientWidth,maxWidth:svg.style.maxWidth};})())`);
    assert.equal(screen.maxWidth, 'none');
    assert.ok(screen.rect > screen.client, JSON.stringify(screen));
    await page.setMedia('print');
    await page.evaluate('KChart.relayout({media:"print"})');
    const print = await page.json(`JSON.stringify((()=>{const body=document.querySelector('.viz-body'),svg=body.querySelector('svg');return {width:svg.width.baseVal.value,rect:svg.getBoundingClientRect().width,client:body.clientWidth,maxWidth:getComputedStyle(svg).maxWidth};})())`);
    assert.equal(print.maxWidth, 'none');
    assert.ok(print.rect > print.client, JSON.stringify(print));
    assert.ok(Math.abs(print.rect - print.width) < 1, JSON.stringify(print));
  } finally {
    await page.close();
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// 意图：图表表格来自 dataTable；正常 HTML 属性保留，错误文案/用户源码只作为文本而不执行。
test('runtime derives the data table and renders invalid source safely without losing HTML attributes', async () => {
  const spec = { chart: 'bar', title: 'A & B', data: [{ label: 'One', value: 2 }, { label: 'Two', value: 5 }], encode: { category: 'label', value: 'value' }, interaction: ['inspect'] };
  const renderer = createRenderer({ specs: [spec, { chart: 'bar', data: [], encode: { category: 'label', value: 'value' } }] });
  const dir = temp('safe');
  const file = join(dir, 'fixture.html');
  const bad = '{"chart":"bar","data":[<img src=x onerror=window.pwned=1>]}';
  writeFileSync(file, `<!doctype html><html lang="en"><meta charset="utf-8"><body><pre data-viz="kchart" id="good" class="source-class" title="kept" data-extra="yes" onclick="window.pwned=1">${JSON.stringify(spec)}</pre><pre data-viz="kchart" id="bad">${bad.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre><script>${renderer.bundleSource()}</script><script>window.__svgEvents={added:0,removed:0};const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener;EventTarget.prototype.addEventListener=function(...args){if(this.namespaceURI==='http://www.w3.org/2000/svg')window.__svgEvents.added++;return add.apply(this,args)};EventTarget.prototype.removeEventListener=function(...args){if(this.namespaceURI==='http://www.w3.org/2000/svg')window.__svgEvents.removed++;return remove.apply(this,args)};</script><script>${runtime}</script></body></html>`, 'utf8');
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(pathToFileURL(file).href);
    await page.evaluate('KChart.ready()');
    const repeatMount = await page.json('JSON.stringify((()=>{const first=KChart.mount(document),second=KChart.mount(document);return first===second})())');
    assert.equal(repeatMount, true, 'mounting the same root twice reuses one mounted observer set');
    const printable = await page.json('KChart.relayout({media:"print"}).then(()=>true)');
    assert.equal(printable, true, 'print relayout is awaitable until current layout work finishes');
    const result = await page.json(`JSON.stringify((()=>{const fig=document.querySelector('#good'),bad=document.querySelector('#bad');fig.querySelector('pre').click();return {title:fig.getAttribute('title'),extra:fig.getAttribute('data-extra'),className:fig.className,table:fig.querySelector('.viz-data table')?.textContent,html:fig.innerHTML,added:window.__svgEvents.added,removed:window.__svgEvents.removed,error:bad.querySelector('.viz-error')?.textContent,images:document.querySelectorAll('img').length,pwned:window.pwned,source:bad.querySelector('pre[data-viz-source],pre')?.textContent};})())`);
    assert.equal(result.title, 'kept');
    assert.equal(result.extra, 'yes');
    assert.match(result.className, /source-class/);
    assert.equal(result.pwned, undefined, 'inline event attributes are not copied or executed');
    assert.match(result.table, /One/, JSON.stringify(result));
    assert.match(result.table, /Two/);
    assert.ok(result.added > 0, JSON.stringify(result));
    await page.evaluate('KChart.relayout({media:"screen"})');
    const detached = await page.json('window.__svgEvents.removed');
    assert.ok(detached > 0, `redrawing detaches prior handlers: ${detached}`);
    assert.ok(result.error, JSON.stringify(result));
    assert.equal(result.images, 0);
    assert.equal(result.pwned, undefined);
    assert.match(result.source, /<img/);
  } finally {
    await page.close();
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// 意图：真实文件页覆盖无锚点宽图、结构图结构化标题、主题优先级/动态更新、打印介质、字体等待及重复 SVG 前缀。
test('runtime preserves natural scrolling and resolves titles, themes, print media, fonts, and unique prefixes', async () => {
  const spec = { chart: 'bar', data: [{ label: 'A', value: 1 }], encode: { category: 'label', value: 'value' } };
  const wideSpec = { ...spec, title: 'Wide' };
  const explicitSpec = { ...spec, title: 'Explicit theme' };
  const diagramSource = '---\ntitle: 结构图专属标题\n---\nflowchart LR\nA --> B';
  const renderer = createRenderer({ specs: [wideSpec, explicitSpec, { source: diagramSource, syntax: 'mermaid' }] });
  const dir = temp('runtime-contracts');
  const file = join(dir, 'fixture.html');
  const customTheme = { ...renderer.themes.paper, id: 'custom-paper' };
  writeFileSync(file, `<!doctype html><html lang="zh-CN" data-theme="claude"><meta charset="utf-8"><style>
    html,body{margin:0}main{width:320px}.viz-body{box-sizing:border-box;width:320px;overflow-x:auto}.viz-body>svg{display:block}
  </style><body><main id="wide"><pre data-viz="kchart">${JSON.stringify(wideSpec)}</pre></main>
  <main id="diagram"><pre data-viz="mermaid">${diagramSource.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre></main>
  <main id="explicit"><pre data-viz="kchart">${JSON.stringify(explicitSpec)}</pre><pre data-viz="kchart">${JSON.stringify(explicitSpec)}</pre></main>
  <script>${renderer.bundleSource()}</script>
  <script>window.themeCalls=[];const baseApi=KChart;window.noAnchorRender=()=>({svg:'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="100"><title>Wide</title></svg>',scene:{title:'Wide'},diagnostics:[]});globalThis.KChart={...baseApi,theme(value,options){window.themeCalls.push({value:typeof value==='object'?value.id:value,media:options.media});return baseApi.theme(value,options)},render(spec,options){if(spec.title==='Explicit theme')window.firstMountAsset=options.assets?.fixture?.marker;return spec.title==='Wide'?window.noAnchorRender(spec,options):baseApi.render(spec,options)}};</script>
  <script>${runtime}</script><script>const root=document.querySelector('#explicit');const first=KChart.mount(root,{theme:${JSON.stringify(customTheme)},media:'screen',assets:{fixture:{marker:'first-mount'}}});const second=KChart.mount(root,{theme:'obsidian',assets:{fixture:{marker:'second-mount'}}});window.explicitMountReused=first===second;</script></body></html>`, 'utf8');
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 900, height: 700 });
    await page.goto(pathToFileURL(file).href);
    await page.evaluate('new Promise((resolve,reject)=>{const start=performance.now();const check=()=>{if(document.querySelectorAll(".viz-body svg").length>=4){resolve();return;}if(performance.now()-start>3000){reject(new Error("runtime did not mount fixture figures"));return;}requestAnimationFrame(check)};check()})');
    await page.evaluate('Object.defineProperty(document.fonts,"ready",{configurable:true,value:new Promise(resolve=>window.releaseFonts=resolve)})');
    const notReady = await page.json('Promise.race([KChart.ready().then(()=>false),new Promise(resolve=>setTimeout(()=>resolve(true),30))])');
    assert.equal(notReady, true, 'ready waits for the document font promise before final layout');
    await page.evaluate('window.releaseFonts()');
    await page.evaluate('KChart.ready()');
    const initial = await page.json(`JSON.stringify((()=>{const body=document.querySelector('#wide .viz-body'),caption=document.querySelector('#diagram .fig-title'),figures=[...document.querySelectorAll('#explicit figure')],ids=figures.map(f=>f.querySelector('svg title')?.id);return {width:Number(body.querySelector('svg').getAttribute('width')),client:body.clientWidth,caption:caption.textContent,ids,theme:window.themeCalls.find(c=>c.value==='custom-paper')}})())`);
    assert.ok(initial.width > initial.client, JSON.stringify(initial));
    const scroll = await page.json('(()=>{const body=document.querySelector("#wide .viz-body");body.scrollLeft=75;return body.scrollLeft})()');
    assert.equal(scroll, 75);
    await page.evaluate('KChart.relayout({media:"screen"})');
    assert.equal(await page.json('document.querySelector("#wide .viz-body").scrollLeft'), 75, 'a missing data-kchart-anchor-x does not recenter a wide diagram');
    assert.equal(initial.caption, '结构图专属标题', JSON.stringify(initial));
    assert.ok(initial.ids[0] && initial.ids[1] && initial.ids[0] !== initial.ids[1], JSON.stringify(initial));
    assert.equal(initial.theme.media, 'screen');
    assert.equal(await page.json('window.explicitMountReused'), true, 'repeated mount of one root keeps its first explicit options');
    assert.equal(await page.evaluate('window.firstMountAsset'), 'first-mount', 'the explicit mount receives its resources on the initial render');

    await page.evaluate('document.documentElement.dataset.theme="obsidian"');
    await page.evaluate('new Promise(resolve=>setTimeout(resolve,50))');
    await page.evaluate('KChart.ready()');
    const dynamic = await page.json('JSON.stringify(window.themeCalls.slice(-1)[0])');
    assert.equal(dynamic.value, 'obsidian', 'data-theme changes are observed on mounted figures');

    await page.setMedia('print');
    await page.evaluate('window.dispatchEvent(new Event("beforeprint"));KChart.ready()');
    const printCall = await page.json('JSON.stringify(window.themeCalls.slice(-1)[0])');
    assert.equal(printCall.media, 'print', 'print media resolves the theme through matchMedia');
    await page.evaluate('KChart.relayout({media:"screen"})');
    const explicitScreen = await page.json('JSON.stringify(window.themeCalls.slice(-1)[0])');
    assert.equal(explicitScreen.media, 'screen', 'explicit screen media wins while the browser still matches print');
    const mountedScreen = await page.json('JSON.stringify(window.themeCalls.filter(call=>call.value==="custom-paper").slice(-1)[0])');
    assert.equal(mountedScreen.media, 'screen', 'mount media option remains explicit during print');
    await page.setMedia('');
    await page.evaluate('window.dispatchEvent(new Event("afterprint"));KChart.ready()');
    const afterPrint = await page.json('JSON.stringify(window.themeCalls.slice(-1)[0])');
    assert.equal(afterPrint.media, 'screen');
  } finally {
    await page.close();
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// 意图：通过生成的文件外壳在真实 Chrome 验证暗色主题和离线地图资源在首次 mount 即可用。
test('runtime first mount from a generated shell receives its theme and offline map assets', async () => {
  const spec = {
    chart: 'choropleth', title: '虚构国家地图',
    data: { map: { asset: 'world' }, rows: [{ region: 'KOS', value: 3 }] },
    encode: { region: 'region', value: 'value' },
  };
  const dir = temp('shell-map');
  const file = join(dir, 'fixture.html');
  const html = renderShell({
    kind: 'data', lang: 'zh-CN', theme: 'obsidian',
    content: `<pre data-viz="kchart">${JSON.stringify(spec)}</pre>`,
  });
  writeFileSync(file, html, 'utf8');
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1000, height: 800 });
    await page.goto(pathToFileURL(file).href);
    await page.evaluate('KChart.ready()');
    const result = await page.json(`JSON.stringify((()=>{const figure=document.querySelector('figure.viz');return {theme:document.documentElement.dataset.theme,caption:figure.querySelector('.fig-title')?.textContent,paths:figure.querySelectorAll('svg path').length,error:figure.querySelector('.viz-error')?.textContent}})())`);
    assert.equal(result.theme, 'obsidian');
    assert.equal(result.caption, '虚构国家地图');
    assert.ok(result.paths > 0, JSON.stringify(result));
    assert.equal(result.error, undefined, JSON.stringify(result));
  } finally {
    await page.close();
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
