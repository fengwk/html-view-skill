import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { findBrowser, launchBrowser } from '../src/shared/browser.mjs';
import { readAsset } from '../src/shared/assets.mjs';
import { renderShell } from '../src/shared/shell.mjs';
import { getTheme } from '../src/shared/themes.mjs';
import { buildDoc } from '../src/artifacts/doc/index.mjs';
import { renderCheck } from '../src/shared/render-audit.mjs';

const chrome = findBrowser();
const waitFor = (page, expression, label) => page.evaluate(`new Promise((resolve, reject) => {
  const start = performance.now();
  const poll = () => {
    try { if (${expression}) { resolve(true); return; } }
    catch (error) { reject(error); return; }
    if (performance.now() - start > 5000) { reject(new Error('等待超时：${label}')); return; }
    requestAnimationFrame(poll);
  };
  poll();
})`);

// 意图：真实 Chrome 验证 KChart 异步图题编号/交叉引用，并覆盖评论 UI、键盘操作与导出协议。
test('doc runtime renders a KChart figure and supports numbered xrefs and Review Document comments', { skip: !chrome && '未找到可执行 Chrome；设置 CHROME_PATH 后自动启用此浏览器回归' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'htmlview-doc-browser-'));
  const file = join(dir, 'document.html');
  const title = '虚构服务访问量比较';
  const selected = '选择这段虚构文字作为审阅锚点';
  const source = JSON.stringify({
    chart: 'bar', title, data: [{ name: '甲', count: 3 }, { name: '乙', count: 5 }],
    encode: { category: 'name', value: 'count' },
  });
  const content = `\n<header class="doc-head"><h1>虚构服务说明</h1></header>\n<div class="doc-body"><section><h2 id="sec-overview">服务概览</h2><p id="review-quote">${selected}。这句话用于检查选区恢复。</p><p>比较结果见 <a class="xref" href="#fig-traffic"></a>。</p><pre data-viz="kchart" id="fig-traffic">${source}</pre></section></div>\n`;
  const html = renderShell({
    kind: 'doc', lang: 'zh-CN', title: '虚构服务说明', theme: 'claude',
    attrs: { 'data-layout': 'article' }, meta: { 'doc:type': 'doc', 'doc:id': 'browser-fixture' },
    before: '<a class="skip" href="#main">跳到正文</a><div class="page"><aside class="side"><div class="side-title">目录</div><nav class="toc" id="toc"></nav></aside><main class="main" id="main"><details class="toc-mobile" id="toc-mobile"><summary>目录</summary></details>',
    after: '</main></div>', content,
    styles: [readAsset('page/doc.css')],
    scripts: [readAsset('vendor/prism.js'), readAsset('page/doc.js')],
  });
  writeFileSync(file, html, 'utf8');

  let browser;
  let page;
  try {
    browser = await launchBrowser({ chromePath: chrome });
    page = await browser.newPage();
    await page.setViewport({ width: 1500, height: 1000 });
    await page.goto(pathToFileURL(file).href);
    await page.evaluate('HtmlViewViz.ready()');
    await waitFor(page, `document.querySelector('#fig-traffic .fig-title')?.textContent.includes(${JSON.stringify(title)})`, '真实图形图题');
    await waitFor(page, `document.querySelector('a.xref')?.textContent.includes(${JSON.stringify(title)})`, '图形交叉引用');

    const rendered = await page.json(`JSON.stringify((() => ({
      figure: document.querySelector('#fig-traffic')?.classList.contains('viz-figure'),
      title: document.querySelector('#fig-traffic .fig-title')?.textContent,
      svg: Boolean(document.querySelector('#fig-traffic svg')),
      xref: document.querySelector('a.xref')?.textContent,
      toc: [...document.querySelectorAll('#toc .toc-num')].map((item) => item.textContent),
    }))())`);
    assert.equal(rendered.figure, true);
    assert.equal(rendered.svg, true);
    assert.match(rendered.title, /图 1/);
    assert.match(rendered.xref, /图 1 .*虚构服务访问量比较/);
    assert.deepEqual(rendered.toc, ['1'], JSON.stringify(rendered));

    await page.evaluate(`(() => {
      const text = document.querySelector('#review-quote').firstChild;
      const start = text.data.indexOf(${JSON.stringify(selected)});
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + ${selected.length});
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    })()`);
    await waitFor(page, `!document.querySelector('.cm-action').hidden`, '划词评论入口');
    await page.evaluate("document.querySelector('.cm-action').click()");
    await page.evaluate(`(() => {
      const input = document.querySelector('.cm-input');
      input.value = '核对这段虚构说明';
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    })()`);
    await waitFor(page, 'document.querySelectorAll(".cm-item").length === 1', '保存后的评论面板');

    const comment = await page.json(`JSON.stringify((() => ({
      quote: document.querySelector('.cm-item .cm-quote')?.textContent,
      body: document.querySelector('.cm-item .cm-text')?.textContent,
      label: document.querySelector('.cm-item .cm-jump')?.textContent,
      storage: localStorage.getItem('htmlview-comments:browser-fixture'),
    }))())`);
    assert.equal(comment.quote, selected);
    assert.equal(comment.body, '核对这段虚构说明');
    assert.match(comment.label, /^§\d+ /);
    assert.match(comment.storage, /核对这段虚构说明/);

    await page.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text) => { window.__reviewExport = text; return Promise.resolve(); } } })`);
    await page.evaluate("document.querySelector('.cm-copy').click()");
    await waitFor(page, 'typeof window.__reviewExport === "string"', 'Review Document 导出文本');
    const exported = await page.evaluate('window.__reviewExport');
    assert.match(exported, /^Review Document: 虚构服务说明\nFile: /);
    assert.match(exported, /§\d+ 服务概览\n\nSelected Text\n```\n选择这段虚构文字作为审阅锚点\n```/);
    assert.match(exported, /User Comment\n```\n核对这段虚构说明\n```/);

    // Escape 关闭未保存编辑框，保留已保存评论。
    await page.evaluate(`(() => {
      const text = document.querySelector('#review-quote').firstChild;
      const range = document.createRange();
      range.selectNodeContents(text);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    })()`);
    await waitFor(page, `!document.querySelector('.cm-action').hidden`, '第二次划词评论入口');
    await page.evaluate("document.querySelector('.cm-action').click()");
    await page.evaluate("document.querySelector('.cm-editor').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    assert.equal(await page.evaluate('document.querySelectorAll(".cm-item").length'), 1);
    assert.equal(await page.evaluate('document.querySelector(".cm-editor").hidden'), true);
  } finally {
    await page?.close();
    await browser?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// 原样保留长表名：普通段落和提示条都需在手机内换行，云音的「注意」标签在屏幕和打印上都要读得清。
test('Cloud Music report keeps long identifiers and passes rendered checks', { skip: !chrome && '未找到可执行 Chrome；设置 CHROME_PATH 后自动启用此浏览器回归' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'htmlview-doc-wrap-'));
  try {
    const source = join(dir, 'report.md');
    const file = join(dir, 'report.html');
    const tableName = 'example_warehouse_team.dim_itm_example_community_resource_long_tag_daily_archive';
    writeFileSync(source, `# 虚构报告\n\n## 数据口径\n\n来源：${tableName}（示例）。\n\n> [!NOTE]\n> 数据来源：${tableName}（示例）。\n\n> [!WARNING]\n> 首周只含四天。\n`);
    await buildDoc([source, '--out', file, '--type', 'report', '--theme', 'cloudmusic', '--lang', 'zh-CN']);
    assert.equal(readFileSync(file, 'utf8').split(tableName).length - 1, 2);
    const result = await renderCheck(file, { chromePath: chrome });
    assert.deepEqual(result.failures, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 意图：代码块复制与图形一致——只有图标，平时隐藏，悬停或聚焦显示，触屏常显，导出隐藏；点击复制代码原文。
test('doc code blocks copy through a hover-revealed icon', { skip: !chrome && '未找到可执行 Chrome；设置 CHROME_PATH 后自动启用此浏览器回归' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'htmlview-doc-code-copy-'));
  const code = 'const a = 1;\nconsole.log(a < 2);';
  let browser;
  try {
    const source = join(dir, 'code.md');
    const file = join(dir, 'code.html');
    writeFileSync(source, `# 代码复制\n\n段落。\n\n\`\`\`js\n${code}\n\`\`\`\n`);
    await buildDoc([source, '--out', file, '--theme', 'paper', '--lang', 'zh-CN']);
    browser = await launchBrowser({ chromePath: chrome });
    const page = await browser.newPage();
    await page.setViewport({ width: 1100, height: 800 });
    await page.goto(pathToFileURL(file).href);
    const button = `document.querySelector('.code .code-head > .code-copy')`;
    const opacity = `getComputedStyle(${button}).opacity`;
    assert.deepEqual(await page.json(`JSON.stringify({count:document.querySelectorAll('.code-copy').length,text:${button}.textContent,label:${button}.getAttribute('aria-label'),icon:!!${button}.querySelector(':scope > svg[aria-hidden="true"]'),old:document.querySelectorAll('.code .btn').length})`),
      { count: 1, text: '', label: '复制代码', icon: true, old: 0 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
    assert.equal(await page.evaluate(opacity), '0', '未悬停时隐藏');
    const center = await page.json(`JSON.stringify((()=>{const r=document.querySelector('.code pre').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})())`);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x, y: center.y });
    await waitFor(page, `${opacity} === '1'`, '悬停代码块显示图标');
    await page.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text) => { window.__copied = text; return Promise.resolve(); } } })`);
    await page.evaluate(`${button}.click()`);
    await waitFor(page, 'typeof window.__copied === "string"', '复制代码');
    assert.equal(await page.evaluate('window.__copied'), code);
    await waitFor(page, `${button}.getAttribute('aria-label') === '已复制'`, '复制成功提示');
    await waitFor(page, `${button}.getAttribute('aria-label') === '复制代码'`, '按钮状态恢复');
    await page.evaluate('document.activeElement?.blur()');
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
    await waitFor(page, `${opacity} === '0'`, '移开后隐藏');
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await waitFor(page, `${opacity} === '1'`, '触屏常显');
    await page.evaluate(`document.documentElement.dataset.mode = 'export'`);
    assert.equal(await page.evaluate(`getComputedStyle(${button}).display`), 'none', '导出隐藏');
    await page.evaluate(`delete document.documentElement.dataset.mode`);
    await page.setMedia('print');
    assert.equal(await page.evaluate(`getComputedStyle(${button}).display`), 'none', '打印隐藏');
  } finally {
    await browser?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// 意图：文档样式排在主题之后，不能把主题专属的编号色、编号样式与圆角重设回默认值。
test('doc pages keep each theme file\'s numbering and radius', { skip: !chrome && '未找到可执行 Chrome；设置 CHROME_PATH 后自动启用此浏览器回归' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'htmlview-doc-theme-'));
  const expected = {
    claude: { color: getTheme('claude').accent, style: 'decimal', radius: '10px' },
    terminal: { color: getTheme('terminal').accent, style: 'decimal-leading-zero', radius: '0px' },
    cloudmusic: { color: getTheme('cloudmusic').accent, style: 'decimal', radius: '12px' },
  };
  let browser;
  try {
    browser = await launchBrowser({ chromePath: chrome });
    const page = await browser.newPage();
    for (const [theme, want] of Object.entries(expected)) {
      const file = join(dir, `${theme}.html`);
      writeFileSync(file, renderShell({
        kind: 'doc', lang: 'zh-CN', title: '虚构主题样式', theme, attrs: { 'data-layout': 'single' }, meta: { 'doc:type': 'doc', 'doc:id': `theme-${theme}` },
        content: '\n<div class="doc-body"><section><h2 id="sec-a">章节</h2><p>正文</p></section></div>\n', styles: [readAsset('page/doc.css')],
      }), 'utf8');
      await page.goto(pathToFileURL(file).href);
      const got = await page.json(`JSON.stringify((() => {
        const root = getComputedStyle(document.documentElement), number = getComputedStyle(document.querySelector('.doc-body h2'), '::before');
        const swatch = document.body.appendChild(document.createElement('i'));
        swatch.style.color = ${JSON.stringify(want.color)};
        return { color: number.color, accent: getComputedStyle(swatch).color, style: root.getPropertyValue('--num-style').trim(), radius: root.getPropertyValue('--radius').trim() };
      })())`);
      assert.equal(got.color, got.accent, `${theme} heading numbers use the theme accent`);
      assert.equal(got.style, want.style, `${theme} numbering style`);
      assert.equal(got.radius, want.radius, `${theme} radius`);
    }
  } finally {
    await browser?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
