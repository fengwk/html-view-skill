import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRenderer } from '../../vendor/kchart/esm/node.js';
import { launchBrowser } from '../src/shared/browser.mjs';
import { readAsset } from '../src/shared/assets.mjs';
import { renderShell } from '../src/shared/shell.mjs';

// The shipped page host is the skill asset, exactly as the shell embeds it.
const host = readAsset('page/viz.js');
const vizCss = readAsset('page/viz.css');
const temp = (name) => mkdtempSync(join('/var/tmp', `htmlview-viz-${name}-`));
const configScript = (config) => `<script type="application/json" data-htmlview="viz-config">${JSON.stringify(config)}</script>`;
const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const waitFor = (page, expression, label, timeout = 4000) => page.evaluate(`new Promise((resolve, reject) => {
  const start = performance.now();
  const poll = () => {
    try { if (${expression}) { resolve(true); return; } }
    catch (error) { reject(error); return; }
    if (performance.now() - start > ${timeout}) { reject(new Error('等待超时：${label}')); return; }
    requestAnimationFrame(poll);
  };
  poll();
})`);
// 无头浏览器里真实剪贴板读写不一致，只验证宿主交给剪贴板接口的文本。
const interceptClipboard = (page) => page.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text) => { window.__copied = text; return Promise.resolve(); } } })`);

// 意图：真实 Chrome 验证宽图不按已选布局缩放、滚动后仍以图锚点居中；显示空图框后由 ResizeObserver 首次排版。
test('viz host keeps wide SVG at 1:1, centers its anchor, and lays out a revealed figure', async () => {
  const spec = {
    chart: 'mindmap', layout: 'org',
    data: { label: '中心主题用于检查滚动锚点', children: Array.from({ length: 6 }, (_, i) => ({ label: `分支 ${i + 1} 的较长标题用于维持自然图宽`, children: [{ label: `详细节点 ${i + 1}` }] })) },
  };
  const renderer = createRenderer({ specs: [spec] });
  const dir = temp('wide');
  const file = join(dir, 'fixture.html');
  writeFileSync(file, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
    html,body{margin:0}#chart{width:280px;height:500px;overflow:hidden}#chart.shown{display:block}.viz-body{box-sizing:border-box;width:100%;height:450px;padding:8px;overflow-x:hidden}.viz-body.viz-scroll{overflow-x:auto}.viz-body>svg{display:block}
  </style><body><section id="chart" style="display:none"><pre data-viz="kchart">${JSON.stringify(spec)}</pre></section><script>${renderer.bundleSource()}</script>${configScript({ lang: 'zh-CN' })}<script>${host}</script><script>window.reveal=()=>{document.querySelector('#chart').style.display='block'}</script></body></html>`, 'utf8');
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 700, height: 700 });
    await page.goto(pathToFileURL(file).href);
    await page.evaluate('window.reveal()');
    await page.evaluate(`new Promise((resolve,reject)=>{const start=performance.now();const check=()=>{if(document.querySelector('.viz-body svg')){resolve(true);return;}if(performance.now()-start>3000){reject(new Error('visible figure was not laid out by ResizeObserver'));return;}requestAnimationFrame(check);};check();})`);
    await page.evaluate('HtmlViewViz.ready()');
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
// 横向排布在任何字体下都宽于版心；纵向排布在字形较窄的环境（如没有中文字体的 CI）会刚好放进版心。
test('viz host preserves 1:1 geometry for a diagram wider than the print column', async () => {
  const source = `---\ntitle: 失败按有限退避重试，30 分钟无回执只查询一次\n---\nflowchart LR\n  A[Outbox 发布任务] --> B[Kafka 消费并校验状态]\n  B --> C[调用渠道网关]\n  C --> D{渠道结果}\n  D -->|明确成功| E[等待回执]\n  D -->|明确失败| F{是否可重试且未达上限}\n  F -->|是| G[按 1、5、15 分钟计划重试]\n  G --> C\n  F -->|否| H[标记失败并告警]\n  E --> I{30 分钟内收到回执}\n  I -->|是| J[去重并更新状态]\n  I -->|否| K[主动查询一次]\n  K --> L{查询结果可确定}\n  L -->|是| J\n  L -->|否| M[保留未知状态并告警]`;
  const renderer = createRenderer({ sources: [{ syntax: 'mermaid', source }] });
  const dir = temp('mermaid-print');
  const file = join(dir, 'fixture.html');
  const css = readFileSync(new URL('../../assets/page/viz.css', import.meta.url), 'utf8');
  writeFileSync(file, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>html,body{margin:0}.viz-body{box-sizing:border-box;width:688px;padding:12px 16px}.viz-body>svg{display:block;max-width:none;height:auto}</style><style>${css}</style><body><pre data-viz="mermaid">${escape(source)}</pre><script>${renderer.bundleSource()}</script>${configScript({ lang: 'zh-CN' })}<script>${host}</script></body></html>`, 'utf8');
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(pathToFileURL(file).href);
    await page.evaluate('HtmlViewViz.ready()');
    const screen = await page.json(`JSON.stringify((()=>{const body=document.querySelector('.viz-body'),svg=body.querySelector('svg');return {width:Number(svg.getAttribute('width')),rect:svg.getBoundingClientRect().width,client:body.clientWidth,maxWidth:svg.style.maxWidth};})())`);
    assert.equal(screen.maxWidth, 'none');
    assert.ok(screen.rect > screen.client, JSON.stringify(screen));
    await page.setMedia('print');
    await page.evaluate('HtmlViewViz.relayout({media:"print"})');
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

// 意图：英文页面上每个图形都在图题行右侧拿到唯一的复制按钮，点击交出声明原文；正常 HTML 属性保留，
// 错误文案/用户源码只作为文本而不执行；交互在重排时释放。
test('viz host copies the declaration from the caption, reports safe errors, and disposes attachments on relayout', async () => {
  const spec = { chart: 'bar', title: 'A & B', source: '合成来源', note: '虚构注释', data: [{ label: 'One', value: 2 }, { label: 'Two', value: 5 }], encode: { category: 'label', value: 'value' }, interaction: ['inspect'] };
  const declaration = JSON.stringify(spec);
  const renderer = createRenderer({ specs: [spec] });
  const dir = temp('contract');
  const file = join(dir, 'fixture.html');
  const bad = '{"chart":"bar","data":[<img src=x onerror=window.pwned=1>]}';
  writeFileSync(file, `<!doctype html><html lang="en"><meta charset="utf-8"><body><pre data-viz="kchart" id="good" class="source-class" title="kept" data-extra="yes" onclick="window.pwned=1">${JSON.stringify(spec)}</pre><pre data-viz="kchart" id="bad">${escape(bad)}</pre><script>${renderer.bundleSource()}</script><script>window.__svgEvents={added:0,removed:0};const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener;EventTarget.prototype.addEventListener=function(...args){if(this.namespaceURI==='http://www.w3.org/2000/svg')window.__svgEvents.added++;return add.apply(this,args)};EventTarget.prototype.removeEventListener=function(...args){if(this.namespaceURI==='http://www.w3.org/2000/svg')window.__svgEvents.removed++;return remove.apply(this,args)};</script>${configScript({ lang: 'en' })}<script>${host}</script></body></html>`, 'utf8');
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(pathToFileURL(file).href);
    await page.evaluate('HtmlViewViz.ready()');
    await interceptClipboard(page);
    const printable = await page.json('HtmlViewViz.relayout({media:"print"}).then(()=>true)');
    assert.equal(printable, true, 'print relayout is awaitable until current layout work finishes');
    const result = await page.json(`JSON.stringify((()=>{const fig=document.querySelector('#good'),bad=document.querySelector('#bad');fig.querySelector('pre').click();const caption=fig.querySelector(':scope > figcaption'),button=caption.querySelector(':scope > button');return {title:fig.getAttribute('title'),extra:fig.getAttribute('data-extra'),className:fig.className,caption:fig.querySelector('.fig-heading')?.textContent,source:fig.querySelector('.fig-source')?.textContent,note:fig.querySelector('.fig-note')?.textContent,buttonClass:button?.className,buttonType:button?.type,buttonText:button?.textContent,buttonLabel:button?.getAttribute('aria-label'),buttonTitle:button?.title,buttonIcon:!!button?.querySelector(':scope > svg[aria-hidden="true"]'),buttonInCaption:button?.parentElement===caption,buttonCount:caption.querySelectorAll(':scope > button').length,captionCount:fig.querySelectorAll(':scope > figcaption').length,buttons:fig.querySelectorAll('button').length,details:fig.querySelectorAll('details').length,sourceText:fig.querySelector('pre[data-viz]')?.textContent,html:fig.innerHTML,added:window.__svgEvents.added,removed:window.__svgEvents.removed,error:bad.querySelector('.viz-error')?.textContent,images:document.querySelectorAll('img').length,pwned:window.pwned,sourceBlock:bad.querySelector('pre[data-viz-source],pre')?.textContent};})())`);
    assert.equal(result.title, 'kept');
    assert.equal(result.extra, 'yes');
    assert.match(result.className, /source-class/);
    assert.equal(result.caption, 'A & B', 'the figure caption comes from the declaration');
    assert.equal(result.source, 'Source: 合成来源');
    assert.equal(result.note, 'Note: 虚构注释');
    assert.equal(result.pwned, undefined, 'inline event attributes are not copied or executed');
    assert.equal(result.buttonClass, 'viz-copy');
    assert.equal(result.buttonType, 'button');
    assert.equal(result.buttonText, '', '按钮只显示图标，没有可见文字');
    assert.equal(result.buttonIcon, true);
    assert.deepEqual([result.buttonLabel, result.buttonTitle], ['Copy source', 'Copy source'], '英文页面用英文说明');
    assert.equal(result.buttonInCaption, true, '复制按钮是图题的直接子元素');
    assert.deepEqual({ count: result.buttonCount, captions: result.captionCount, buttons: result.buttons }, { count: 1, captions: 1, buttons: 1 });
    assert.equal(result.details, 0, '图形不再附带可折叠数据区');
    assert.equal(result.sourceText, declaration, '隐藏的源码元素保留声明原文');
    // 拦截剪贴板：点按钮交出的是声明原文，按钮先换成已复制状态再恢复。
    await page.evaluate(`document.querySelector('#good figcaption > button').click()`);
    await waitFor(page, 'typeof window.__copied === "string"', '复制声明原文');
    assert.equal(await page.evaluate('window.__copied'), declaration, 'the copied text is the declaration verbatim');
    await waitFor(page, `document.querySelector('#good figcaption > button').getAttribute('aria-label') === 'Copied'`, '复制成功提示');
    await waitFor(page, `document.querySelector('#good figcaption > button').getAttribute('aria-label') === 'Copy source'`, '按钮状态恢复');
    assert.ok(result.added > 0, JSON.stringify(result));
    await page.evaluate('HtmlViewViz.relayout({media:"screen"})');
    const detached = await page.json('window.__svgEvents.removed');
    assert.ok(detached > 0, `redrawing detaches prior handlers: ${detached}`);
    assert.equal(await page.json(`document.querySelectorAll('#good figcaption > button').length`), 1, '重排不会重复生成复制按钮');
    assert.ok(result.error, JSON.stringify(result));
    assert.equal(result.images, 0);
    assert.equal(result.pwned, undefined);
    assert.match(result.sourceBlock, /<img/);
  } finally {
    await page.close();
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// 意图：界面稿在配置里关掉复制按钮时，图形照常绘制，但图题行没有按钮，也没有可折叠数据区。
test('viz host omits the copy button when the shell config disables copy', async () => {
  const spec = { chart: 'bar', data: [{ label: 'A', value: 1 }], encode: { category: 'label', value: 'value' } };
  const renderer = createRenderer({ specs: [spec] });
  const dir = temp('copy-off');
  const file = join(dir, 'fixture.html');
  writeFileSync(file, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body><pre data-viz="kchart">${JSON.stringify(spec)}</pre><script>${renderer.bundleSource()}</script>${configScript({ lang: 'zh-CN', copy: false })}<script>${host}</script></body></html>`, 'utf8');
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(pathToFileURL(file).href);
    await page.evaluate('HtmlViewViz.ready()');
    const state = await page.json(`JSON.stringify({svg:!!document.querySelector('.viz-body svg'),buttons:document.querySelectorAll('figure button').length,figures:document.querySelectorAll('figure').length,details:document.querySelectorAll('details').length})`);
    assert.deepEqual(state, { svg: true, buttons: 0, figures: 1, details: 0 });
  } finally {
    await page.close();
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// 意图：五种图形都在图题行右侧生成唯一的复制按钮，点击把声明原文原样交给剪贴板；重排不会多出按钮。
test('viz host gives every syntax one copy button in the caption and copies the exact declaration', async () => {
  const spec = { chart: 'bar', title: '虚构渠道对比', data: [{ label: '自然流量', value: 3 }], encode: { category: 'label', value: 'value' } };
  const diagrams = [
    ['mermaid', '---\ntitle: 虚构提交校验\n---\nflowchart LR\n  A[提交] --> B[校验]\n'],
    ['layers', '---\ntitle: 虚构分层\n---\n- 接入层 | 统一入口\n  - 网关: 鉴权, 限流\n- 数据层\n  - 订单库 {db}: 订单, 状态\n'],
    ['blocks', '---\ntitle: 虚构总览\n---\nrow\n  box 入口\n    card 表单\n      字段校验\n  box 产出\n    card 回执\n'],
    ['swimlane', '---\ntitle: 虚构泳道\n---\nswimlane LR\nlane 客户端\n  request[提交请求]\nlane 服务端\n  validate[校验]\nrequest -->|请求| validate\n'],
  ];
  const charts = createRenderer({ specs: [spec] });
  const sources = createRenderer({ sources: diagrams.map(([syntax, source]) => ({ syntax, source })) });
  const dir = temp('copy-syntaxes');
  const renderFixture = (bundle, body) => `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body>${body}<script>${bundle}</script>${configScript({ lang: 'zh-CN' })}<script>${host}</script></body></html>`;
  const chartFile = join(dir, 'chart.html');
  const diagramFile = join(dir, 'diagrams.html');
  writeFileSync(chartFile, renderFixture(charts.bundleSource(), `<pre data-viz="kchart">${JSON.stringify(spec)}</pre>`), 'utf8');
  writeFileSync(diagramFile, renderFixture(sources.bundleSource(), diagrams.map(([syntax, source]) => `<pre data-viz="${syntax}">${escape(source)}</pre>`).join('\n')), 'utf8');
  const expected = new Map([['kchart', JSON.stringify(spec)], ...diagrams]);
  // 每个图形一条记录：按钮只能有一个、只能挂在图题下，源码元素隐藏保留。
  const collect = (view) => view.json(`JSON.stringify([...document.querySelectorAll('figure.viz-figure')].map(figure=>{
    const caption=figure.querySelector(':scope > figcaption'),button=caption.querySelector(':scope > button'),pre=figure.querySelector('pre[data-viz]');
    return {syntax:pre.getAttribute('data-viz'),source:pre.textContent,hidden:pre.hidden,svg:!!figure.querySelector('.viz-body svg'),captions:figure.querySelectorAll('figcaption').length,
      buttonCount:caption.querySelectorAll(':scope > button').length,allButtons:figure.querySelectorAll('button').length,buttonClass:button?.className,buttonType:button?.type,buttonText:button?.textContent,buttonLabel:button?.getAttribute('aria-label'),buttonInCaption:button?.parentElement===caption,details:figure.querySelectorAll('details').length};
  }))`);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 900, height: 900 });
    for (const [target, syntaxes] of [[chartFile, ['kchart']], [diagramFile, diagrams.map(([syntax]) => syntax)]]) {
      await page.goto(pathToFileURL(target).href);
      await page.evaluate('HtmlViewViz.ready()');
      await interceptClipboard(page);
      const before = await collect(page);
      assert.deepEqual(before.map(({ syntax }) => syntax), syntaxes, JSON.stringify(before));
      for (const figure of before) {
        assert.deepEqual({
          svg: figure.svg, captions: figure.captions, buttonCount: figure.buttonCount, allButtons: figure.allButtons,
          buttonClass: figure.buttonClass, buttonType: figure.buttonType, buttonText: figure.buttonText, buttonLabel: figure.buttonLabel,
          buttonInCaption: figure.buttonInCaption, details: figure.details,
        }, {
          svg: true, captions: 1, buttonCount: 1, allButtons: 1,
          buttonClass: 'viz-copy', buttonType: 'button', buttonText: '', buttonLabel: '复制源码',
          buttonInCaption: true, details: 0,
        }, figure.syntax);
        assert.equal(figure.hidden, true, `${figure.syntax} 的源码元素保留但不可见`);
        assert.equal(figure.source, expected.get(figure.syntax), `${figure.syntax} 的源码元素与声明逐字一致`);
      }
      // 点每个按钮：交出的是声明原文，按钮先换成已复制状态再恢复。
      for (const { syntax } of before) {
        const selector = `figure.viz-figure:has(pre[data-viz="${syntax}"]) figcaption > button`;
        await page.evaluate(`(()=>{window.__copied=undefined;document.querySelector(${JSON.stringify(selector)}).click()})()`);
        await waitFor(page, 'typeof window.__copied === "string"', `${syntax} 复制声明原文`);
        assert.equal(await page.evaluate('window.__copied'), expected.get(syntax), `${syntax} 复制内容必须与声明一致`);
        await waitFor(page, `document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-label') === '已复制'`, `${syntax} 复制成功提示`);
        await waitFor(page, `document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-label') === '复制源码'`, `${syntax} 按钮状态恢复`);
      }
      // 重排会重新绘制图形，但复制按钮仍然只有一个。
      await page.evaluate('HtmlViewViz.relayout({media:"screen"})');
      const after = await collect(page);
      assert.deepEqual(after.map(({ syntax, buttonCount, allButtons, buttonLabel, details }) => ({ syntax, buttonCount, allButtons, buttonLabel, details })),
        before.map(({ syntax }) => ({ syntax, buttonCount: 1, allButtons: 1, buttonLabel: '复制源码', details: 0 })));
    }
  } finally {
    await page.close();
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// 意图：剪贴板接口不可用时退回隐藏文本框加 execCommand，两种方式都失败时按钮说明复制失败。
test('viz host falls back to a hidden textarea when the clipboard API is denied', async () => {
  const spec = { chart: 'bar', title: '复制降级', data: [{ label: 'A', value: 1 }], encode: { category: 'label', value: 'value' } };
  const declaration = JSON.stringify(spec);
  const renderer = createRenderer({ specs: [spec] });
  const dir = temp('copy-fallback');
  const file = join(dir, 'fixture.html');
  writeFileSync(file, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body><pre data-viz="kchart">${declaration}</pre><script>${renderer.bundleSource()}</script>${configScript({ lang: 'zh-CN' })}<script>${host}</script></body></html>`, 'utf8');
  const button = `document.querySelector('figure.viz-figure figcaption > button')`;
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(pathToFileURL(file).href);
    await page.evaluate('HtmlViewViz.ready()');
    await page.evaluate(`(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
      document.execCommand = (command) => { window.__fallback = { command, text: document.querySelector('textarea')?.value ?? '' }; return true; };
    })()`);
    await page.evaluate(`${button}.click()`);
    await waitFor(page, 'typeof window.__fallback === "object" && window.__fallback !== null', '文本框降级');
    assert.deepEqual(await page.json('JSON.stringify(window.__fallback)'), { command: 'copy', text: declaration });
    assert.equal(await page.evaluate("document.querySelectorAll('textarea').length"), 0, '降级用的文本框不能留在页面里');
    await waitFor(page, `${button}.getAttribute('aria-label') === '已复制'`, '降级后的成功提示');

    // 两种复制方式都失败时，按钮说明复制失败，随后恢复。
    await page.goto(pathToFileURL(file).href);
    await page.evaluate('HtmlViewViz.ready()');
    await page.evaluate(`(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
      document.execCommand = () => false;
    })()`);
    await page.evaluate(`${button}.click()`);
    await waitFor(page, `${button}.getAttribute('aria-label') === '复制失败'`, '复制失败提示');
    await waitFor(page, `${button}.getAttribute('aria-label') === '复制源码'`, '失败后恢复');
  } finally {
    await page.close();
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// 意图：复制图标平时不可见也不可点，鼠标悬停图卡或键盘聚焦时出现；触屏设备（无悬停、粗指针）常显。
// headless Chrome 报告 hover:none 与 pointer:none，属于非触屏，图标保持隐藏，样张截图因此不带图标。
test('viz host reveals the copy icon on hover or focus and keeps it visible without hover support', async () => {
  const spec = { chart: 'bar', title: '悬停显示', data: [{ label: 'A', value: 1 }], encode: { category: 'label', value: 'value' } };
  const renderer = createRenderer({ specs: [spec] });
  const dir = temp('copy-hover');
  const file = join(dir, 'fixture.html');
  writeFileSync(file, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>${vizCss}</style><body style="margin:40px"><pre data-viz="kchart">${JSON.stringify(spec)}</pre><script>${renderer.bundleSource()}</script>${configScript({ lang: 'zh-CN' })}<script>${host}</script></body></html>`, 'utf8');
  const visibility = `JSON.stringify((()=>{const s=getComputedStyle(document.querySelector('.viz-copy'));return {opacity:s.opacity,pointer:s.pointerEvents};})())`;
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 900, height: 700 });
    await page.goto(pathToFileURL(file).href);
    await page.evaluate('HtmlViewViz.ready()');
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
    assert.deepEqual(await page.json(visibility), { opacity: '0', pointer: 'none' }, '未悬停时隐藏');
    const box = await page.json(`JSON.stringify((()=>{const r=document.querySelector('figure.viz-figure .viz-body').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})())`);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await waitFor(page, `getComputedStyle(document.querySelector('.viz-copy')).opacity === '1'`, '悬停图卡显示图标');
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.viz-copy')).pointerEvents`), 'auto');
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
    await waitFor(page, `getComputedStyle(document.querySelector('.viz-copy')).opacity === '0'`, '移开后隐藏');
    await page.evaluate(`document.querySelector('.viz-copy').focus()`);
    await waitFor(page, `getComputedStyle(document.querySelector('.viz-copy')).opacity === '1'`, '键盘聚焦显示图标');
    await page.evaluate(`document.activeElement.blur()`);
    await waitFor(page, `getComputedStyle(document.querySelector('.viz-copy')).opacity === '0'`, '失焦后隐藏');
    // 触屏模拟让 pointer 变为 coarse（setEmulatedMedia 模拟不了 pointer）。
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    assert.equal(await page.evaluate(`matchMedia('(hover:none) and (pointer:coarse)').matches`), true, '已进入触屏媒体条件');
    await waitFor(page, `getComputedStyle(document.querySelector('.viz-copy')).opacity === '1'`, '触屏常显');
    await page.setMedia('print');
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.viz-copy')).display`), 'none', '打印不输出复制图标');
  } finally {
    await page.close();
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// 意图：无锚点宽图不被重排挪回起点；结构图标题、字体就绪、主题变化、打印介质与唯一 SVG 前缀。
test('viz host preserves natural scrolling and resolves titles, themes, print media, fonts, and unique prefixes', async () => {
  const spec = { chart: 'bar', data: [{ label: 'A', value: 1 }], encode: { category: 'label', value: 'value' } };
  const wideSpec = { ...spec, title: 'Wide' };
  const explicitSpec = { ...spec, title: 'Explicit theme' };
  const diagramSource = '---\ntitle: 结构图专属标题\n---\nflowchart LR\nA --> B';
  const renderer = createRenderer({ specs: [wideSpec, explicitSpec, { source: diagramSource, syntax: 'mermaid' }] });
  const dir = temp('runtime-contracts');
  const file = join(dir, 'fixture.html');
  writeFileSync(file, `<!doctype html><html lang="zh-CN" data-theme="claude"><meta charset="utf-8"><style>
    html,body{margin:0}main{width:320px}.viz-body{box-sizing:border-box;width:320px;overflow-x:auto}.viz-body>svg{display:block}
  </style><body><main id="wide"><pre data-viz="kchart">${JSON.stringify(wideSpec)}</pre></main>
  <main id="diagram"><pre data-viz="mermaid">${escape(diagramSource)}</pre></main>
  <main id="explicit"><pre data-viz="kchart">${JSON.stringify(explicitSpec)}</pre><pre data-viz="kchart">${JSON.stringify(explicitSpec)}</pre></main>
  <script>${renderer.bundleSource()}</script>
  <script>window.themeCalls=[];const baseApi=KChart;window.noAnchorRender=()=>({svg:'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="100"><title>Wide</title></svg>',scene:{title:'Wide'},diagnostics:[]});globalThis.KChart={...baseApi,theme(value,options){window.themeCalls.push({value:typeof value==='object'?value.id:value,media:options.media});return baseApi.theme(value,options)},render(spec,options){return spec.title==='Wide'?window.noAnchorRender(spec,options):baseApi.render(spec,options)}};</script>
  ${configScript({ lang: 'zh-CN' })}
  <script>${host}</script></body></html>`, 'utf8');
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 900, height: 700 });
    await page.goto(pathToFileURL(file).href);
    await page.evaluate('new Promise((resolve,reject)=>{const start=performance.now();const check=()=>{if(document.querySelectorAll(".viz-body svg").length>=4){resolve();return;}if(performance.now()-start>3000){reject(new Error("host did not mount fixture figures"));return;}requestAnimationFrame(check)};check()})');
    await page.evaluate('Object.defineProperty(document.fonts,"ready",{configurable:true,value:new Promise(resolve=>window.releaseFonts=resolve)})');
    const notReady = await page.json('Promise.race([HtmlViewViz.ready().then(()=>false),new Promise(resolve=>setTimeout(()=>resolve(true),30))])');
    assert.equal(notReady, true, 'ready waits for the document font promise before final layout');
    await page.evaluate('window.releaseFonts()');
    await page.evaluate('HtmlViewViz.ready()');
    const initial = await page.json(`JSON.stringify((()=>{const body=document.querySelector('#wide .viz-body'),caption=document.querySelector('#diagram .fig-title'),figures=[...document.querySelectorAll('#explicit figure')],ids=figures.map(f=>f.querySelector('svg title')?.id);return {width:Number(body.querySelector('svg').getAttribute('width')),client:body.clientWidth,caption:caption.querySelector('.fig-heading')?.textContent,ids,theme:window.themeCalls[0]}})())`);
    assert.ok(initial.width > initial.client, JSON.stringify(initial));
    const scroll = await page.json('(()=>{const body=document.querySelector("#wide .viz-body");body.scrollLeft=75;return body.scrollLeft})()');
    assert.equal(scroll, 75);
    await page.evaluate('HtmlViewViz.relayout({media:"screen"})');
    assert.equal(await page.json('document.querySelector("#wide .viz-body").scrollLeft'), 75, 'a missing data-kchart-anchor-x does not recenter a wide diagram');
    assert.equal(initial.caption, '结构图专属标题', JSON.stringify(initial));
    assert.ok(initial.ids[0] && initial.ids[1] && initial.ids[0] !== initial.ids[1], JSON.stringify(initial));
    assert.deepEqual(initial.theme, { value: 'claude', media: 'screen' });

    await page.evaluate('document.documentElement.dataset.theme="obsidian"');
    await page.evaluate('new Promise(resolve=>setTimeout(resolve,50))');
    await page.evaluate('HtmlViewViz.ready()');
    const dynamic = await page.json('JSON.stringify(window.themeCalls.slice(-1)[0])');
    assert.equal(dynamic.value, 'obsidian', 'data-theme changes are observed on mounted figures');

    await page.setMedia('print');
    await page.evaluate('window.dispatchEvent(new Event("beforeprint"));HtmlViewViz.ready()');
    const printCall = await page.json('JSON.stringify(window.themeCalls.slice(-1)[0])');
    assert.equal(printCall.media, 'print', 'print media wins over the screen scheme while printing');
    await page.evaluate('HtmlViewViz.relayout({media:"screen"})');
    const explicitScreen = await page.json('JSON.stringify(window.themeCalls.slice(-1)[0])');
    assert.equal(explicitScreen.media, 'screen', 'explicit screen media wins while the browser still matches print');
    await page.setMedia('');
    await page.evaluate('window.dispatchEvent(new Event("afterprint"));HtmlViewViz.ready()');
    const afterPrint = await page.json('JSON.stringify(window.themeCalls.slice(-1)[0])');
    assert.equal(afterPrint.media, 'screen');
  } finally {
    await page.close();
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// 意图：自定义主题以 head 中的 htmlview:theme 快照为准，页面配置不再内联主题对象。
test('viz host reads the embedded theme snapshot as the theme object', async () => {
  const renderer = createRenderer({ specs: [{ chart: 'bar', data: [{ label: 'A', value: 1 }], encode: { category: 'label', value: 'value' } }] });
  const plain = { ...renderer.themes.paper };
  delete plain.id;
  const custom = { ...plain, id: `custom-paper-${createHash('sha256').update(JSON.stringify(plain)).digest('hex')}` };
  const spec = { chart: 'bar', title: '快照主题', data: [{ label: 'A', value: 1 }], encode: { category: 'label', value: 'value' } };
  const dir = temp('theme-meta');
  const file = join(dir, 'fixture.html');
  const html = renderShell({ kind: 'data', lang: 'zh-CN', theme: custom, content: `<pre data-viz="kchart">${JSON.stringify(spec)}</pre>` });
  const wrapper = `<script>window.themeCalls=[];const baseApi=KChart;globalThis.KChart={...baseApi,theme(value,options){window.themeCalls.push({value:typeof value==='object'?value.id:value,media:options.media});return baseApi.theme(value,options)}};</script>`;
  const injected = html.replace('</script>\n<script type="application/json"', `</script>\n${wrapper}\n<script type="application/json"`);
  assert.notEqual(injected, html, 'the wrapper sits between the bundle and the config');
  writeFileSync(file, injected, 'utf8');
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(pathToFileURL(file).href);
    await page.evaluate('HtmlViewViz.ready()');
    const calls = await page.json('JSON.stringify(window.themeCalls)');
    assert.deepEqual(calls[0], { value: custom.id, media: 'screen' });
    const state = await page.json(`JSON.stringify({svg:!!document.querySelector('.viz-body svg'),dataTheme:document.documentElement.dataset.theme,meta:document.querySelector('meta[name="htmlview:theme"]')?.getAttribute('content')?.includes(${JSON.stringify(custom.id)})})`);
    assert.deepEqual(state, { svg: true, dataTheme: custom.id, meta: true });
  } finally {
    await page.close();
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// 意图：通过生成的文件外壳在真实 Chrome 验证暗色主题和离线地图资源在首次排版即可用。
test('viz host first layout from a generated shell receives its theme and offline map assets', async () => {
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
    await page.goto(pathToFileURL(file).href);
    await page.evaluate('HtmlViewViz.ready()');
    const map = await page.json(`JSON.stringify({regions:document.querySelectorAll('.viz-body svg path').length,dark:document.documentElement.dataset.scheme,assets:document.querySelector('script[data-htmlview="viz-config"]').textContent.includes('\\"world\\"')})`);
    assert.ok(map.regions > 0, JSON.stringify(map));
    assert.equal(map.dark, 'dark');
    assert.equal(map.assets, true, 'the offline map asset travels in the shell config');
  } finally {
    await page.close();
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
