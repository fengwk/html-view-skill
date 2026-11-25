import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { findBrowser, launchBrowser } from '../src/shared/browser.mjs';
import { decodeEntities, innerHtml, scanElements } from '../src/shared/html-util.mjs';
import { audit, parts } from '../src/artifacts/viz/index.mjs';
import { parseShell } from '../src/shared/shell.mjs';
import { renderStaticFigure, VIZ_COPY_ID, VIZ_SOURCE_ID } from '../src/shared/static-figure.mjs';

const BIN = fileURLToPath(new URL('../htmlview', import.meta.url));
const chrome = findBrowser();
const browserSkip = chrome ? false : '未找到可执行 Chrome；设置 CHROME_PATH 后自动启用此浏览器回归';
// 逐字比对用：源码里的空格与换行都按原样保留。
const DIAGRAM = '\nflowchart LR\n  A[开始] --> B[结束]\n';

const tempDir = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'htmlview-figure-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const invoke = (argv) => {
  const result = spawnSync(process.execPath, [BIN, ...argv], { encoding: 'utf8', timeout: 120000, env: process.env });
  if (result.error) throw result.error;
  return { ...result, exitCode: result.status };
};
const sourceOf = (html) => {
  const shell = parseShell(html);
  const pres = scanElements(shell.content).filter(({ name, attrs }) => name === 'pre' && attrs.id === VIZ_SOURCE_ID);
  assert.equal(pres.length, 1, '源码元素必须唯一保留');
  return { shell, pre: pres[0], text: parts(html)[0]?.content };
};
const waitFor = async (page, expression, label, timeout = 5000) => page.evaluate(`new Promise((resolve, reject) => {
  const start = performance.now();
  const poll = () => {
    try { if (${expression}) { resolve(true); return; } }
    catch (error) { reject(error); return; }
    if (performance.now() - start > ${timeout}) { reject(new Error('等待超时：${label}')); return; }
    requestAnimationFrame(poll);
  };
  poll();
})`);

// 意图：单图页把「图形源码」折叠换成复制按钮；源码元素只为读回保留，读者看不到它。
test('单图页源码不再折叠，改为隐藏源码与复制按钮', { skip: browserSkip }, async (t) => {
  const measured = await renderStaticFigure(DIAGRAM, { theme: 'terminal', width: 350, lang: 'zh-CN' });
  assert.doesNotMatch(measured.html, /<details|<summary/, '源码折叠必须移除');
  assert.doesNotMatch(measured.html, /图形源码/);

  const { shell, pre, text } = sourceOf(measured.html);
  assert.equal(text, DIAGRAM, '源码元素必须与声明逐字一致，供 style 与 parts 读回');
  assert.equal('hidden' in pre.attrs, true, '源码元素保留但不可见');
  const buttons = scanElements(shell.content).filter(({ name, attrs }) => name === 'button' && attrs.id === VIZ_COPY_ID);
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].attrs.type, 'button');
  assert.equal(buttons[0].attrs.class, 'btn btn-sm copy');
  assert.equal(decodeEntities(innerHtml(shell.content, buttons[0])), '复制');
  // 页面脚本只有复制交互这一处，且按页面自己的脚本登记（外壳据此计算指纹）。
  assert.deepEqual(shell.scripts.map(({ role }) => role), ['page']);
  assert.deepEqual((await audit(measured.html)).failures, []);
  const modified = measured.html.replace('<script>', '<script>void 0;');
  assert.ok((await audit(modified)).failures.some(({ code }) => code === 'BAD_VIZ'));
  assert.match(measured.html.split('@media print').at(-1) ?? '', /\.viz-copy\{display:none\}/, '打印时隐藏复制按钮');
  assert.doesNotMatch(measured.html, /<link\b/i);

  // 英文读者拿到英文按钮文字。
  const english = await renderStaticFigure(DIAGRAM, { theme: 'terminal', width: 350, lang: 'en' });
  const englishContent = parseShell(english.html).content;
  const englishButton = scanElements(englishContent).find(({ name, attrs }) => name === 'button' && attrs.id === VIZ_COPY_ID);
  assert.equal(decodeEntities(innerHtml(englishContent, englishButton)), 'Copy');
});

// 意图：真实 Chrome 点按钮复制源码原文，剪贴板不可用时用隐藏文本框降级，按钮文字约 1.6 秒后恢复。
test('单图页复制按钮复制源码原文并在剪贴板不可用时降级', { skip: browserSkip }, async (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'figure.html');
  writeFileSync(file, (await renderStaticFigure(DIAGRAM, { theme: 'terminal', width: 350, lang: 'zh-CN' })).html, 'utf8');

  let browser;
  const open = async () => {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(file).href);
    return page;
  };
  try {
    browser = await launchBrowser({ chromePath: chrome });

    const clipboard = await open();
    try {
      await clipboard.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text) => { window.__copied = text; return Promise.resolve(); } } })`);
      const started = Date.now();
      await clipboard.evaluate(`document.getElementById('${VIZ_COPY_ID}').click()`);
      await waitFor(clipboard, 'typeof window.__copied === "string"', '复制源码');
      assert.equal(await clipboard.evaluate('window.__copied'), DIAGRAM, '复制的必须是声明原文');
      await waitFor(clipboard, `document.getElementById('${VIZ_COPY_ID}').textContent === '已复制'`, '复制成功提示');
      await waitFor(clipboard, `document.getElementById('${VIZ_COPY_ID}').textContent === '复制'`, '按钮文字恢复');
      const elapsed = Date.now() - started;
      assert.ok(elapsed >= 1500 && elapsed < 4000, `提示应约 1.6 秒后恢复，实际 ${elapsed}ms`);
      // 源码元素真的不可见，打印时连按钮一起隐藏。
      assert.equal(await clipboard.evaluate(`getComputedStyle(document.getElementById('${VIZ_SOURCE_ID}')).display`), 'none');
      await clipboard.setMedia('print');
      assert.equal(await clipboard.evaluate(`getComputedStyle(document.getElementById('${VIZ_COPY_ID}')).display`), 'none', '打印不输出复制按钮');
    } finally { await clipboard.close(); }

    const fallback = await open();
    try {
      await fallback.evaluate(`(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
        document.execCommand = (command) => {
          window.__fallback = { command, text: document.querySelector('textarea')?.value ?? '' };
          return true;
        };
      })()`);
      await fallback.evaluate(`document.getElementById('${VIZ_COPY_ID}').click()`);
      await waitFor(fallback, 'typeof window.__fallback === "object" && window.__fallback !== null', '文本框降级');
      assert.deepEqual(await fallback.json('JSON.stringify(window.__fallback)'), { command: 'copy', text: DIAGRAM });
      assert.equal(await fallback.evaluate("document.querySelectorAll('textarea').length"), 0, '降级用的文本框不能留在页面里');
      await waitFor(fallback, `document.getElementById('${VIZ_COPY_ID}').textContent === '已复制'`, '降级后的成功提示');
    } finally { await fallback.close(); }

    const failure = await open();
    try {
      await failure.evaluate(`(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
        document.execCommand = () => false;
      })()`);
      await failure.evaluate(`document.getElementById('${VIZ_COPY_ID}').click()`);
      await waitFor(failure, `document.getElementById('${VIZ_COPY_ID}').textContent === '复制失败'`, '复制失败提示');
      await waitFor(failure, `document.getElementById('${VIZ_COPY_ID}').textContent === '复制'`, '失败后恢复');
    } finally { await failure.close(); }
  } finally { await browser?.close(); }
});

// 意图：源码元素换到复制按钮之后，style 与 parts 仍从 pre#viz-source 读回声明并重建整页。
test('style 与 parts 仍能从单图页读回图形源码', { skip: browserSkip }, async (t) => {
  const dir = tempDir(t);
  const source = join(dir, 'flow.mmd');
  const file = join(dir, 'flow.html');
  writeFileSync(source, DIAGRAM, 'utf8');
  const rendered = invoke(['viz', 'render', source, '--out', file, '--width', '350']);
  assert.equal(rendered.exitCode, 0, `${rendered.stdout}\n${rendered.stderr}`);

  const styled = invoke(['style', file, '--theme', 'paper']);
  assert.equal(styled.exitCode, 0, `${styled.stdout}\n${styled.stderr}`);
  assert.equal(JSON.parse(styled.stdout).theme, 'paper');
  const html = readFileSync(file, 'utf8');
  const { text } = sourceOf(html);
  assert.equal(text, DIAGRAM, '换主题重建后源码必须原样保留');
  assert.match(html, new RegExp(`<button type="button" class="btn btn-sm copy" id="${VIZ_COPY_ID}">复制</button>`));
  assert.doesNotMatch(html, /<details|<summary/);

  const read = invoke(['read', file]);
  assert.equal(read.exitCode, 0, read.stdout);
  assert.match(read.stdout, /^# flowchart/m);
});
