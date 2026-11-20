import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { findBrowser } from '../src/shared/browser.mjs';
import { renderCheck } from '../src/shared/render-audit.mjs';

const chrome = findBrowser();
const skip = !chrome && '未找到可执行 Chrome；设置 CHROME_PATH 后启用渲染检查回归';

async function check(t, content) {
  const dir = mkdtempSync(join(tmpdir(), 'htmlview-render-audit-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'fixture.html');
  writeFileSync(file, `<!doctype html><meta charset="utf-8">${content}`);
  return (await renderCheck(file, { chromePath: chrome })).failures;
}

// 段落盒没有越界；更长的两个词分别由父容器和自身容器负责滚动，均不应成为页面溢出的定位。
test('页面溢出：定位行内文字而非段落盒外的滚动内容', { skip }, async (t) => {
  const failures = await check(t, `
    <style>body { margin: 24px; font: 16px monospace; } p { width: 100%; } .scroll { overflow-x: auto; }</style>
    <h2>长文本</h2>
    <p>Offender${'x'.repeat(60)}</p>
    <h2>独立滚动</h2>
    <div class="scroll"><p>Nested${'x'.repeat(200)}</p></div>
    <p class="scroll">Own${'x'.repeat(240)}</p>`);
  const overflow = failures.filter(({ code }) => code === 'PAGE_OVERFLOW');
  assert.deepEqual(overflow.map(({ scope, where, viewports }) => ({ scope, where, viewports })), [
    { scope: 'content', where: '长文本 › p「Offenderxxxx…」', viewports: ['mobile'] },
  ]);
});

// 两个相近颜色跨过 4.5 阈值；打印时底色改变，不能用屏幕的测量值代替。
test('对比度：报告接近阈值的实测值和屏幕、打印各自的合成颜色', { skip }, async (t) => {
  const failures = await check(t, `
    <style>
      body { background: white; font: 16px sans-serif; }
      .near { color: color(srgb 0 0 0 / 0.534); }
      .pass { color: color(srgb 0 0 0 / 0.535); }
      @media print { .near { background: rgb(245 245 245 / 0.5); } }
    </style>
    <h2>对比度样本</h2>
    <p class="near">Near limit</p><p class="pass">Above limit</p>`);
  const contrast = failures.filter(({ code }) => code === 'LOW_CONTRAST');
  assert.deepEqual(contrast.map(({ where, detail, viewports }) => ({ where, detail, viewports })), [
    { where: '对比度样本 › p.near「Near limit」',
      detail: '对比度 4.489:1，要求 ≥ 4.5:1；有效前景 rgb(118.83, 118.83, 118.83)，有效背景 rgb(255, 255, 255)',
      viewports: ['desktop', 'mobile', 'export'] },
    { where: '对比度样本 › p.near「Near limit」',
      detail: '对比度 4.446:1，要求 ≥ 4.5:1；有效前景 rgb(116.5, 116.5, 116.5)，有效背景 rgb(250, 250, 250)',
      viewports: ['print'] },
  ]);
});

// 宽图仍走原有的盒溢出路径；打印改法优先调整纸型和布局，不要求丢弃数据。
test('宽图：保留盒溢出定位，打印优先建议更宽版心', { skip }, async (t) => {
  const failures = await check(t, '<h2>宽图</h2><svg width="800" height="80"></svg>');
  const overflow = failures.filter(({ code }) => code === 'PAGE_OVERFLOW');
  assert.deepEqual(overflow.map(({ where, viewports }) => ({ where, viewports })), [
    { where: '宽图 › svg', viewports: ['mobile'] },
  ]);
  const clips = failures.filter(({ code }) => code === 'PRINT_CLIP');
  assert.equal(clips.length, 1);
  assert.equal(clips[0].where, '宽图 › svg');
  assert.match(clips[0].fix, /^优先用 --paper a4-landscape 或 --paper a3-portrait.*拆图/);
  assert.doesNotMatch(clips[0].fix, /减少类别|缩短期间|日期/);
});
