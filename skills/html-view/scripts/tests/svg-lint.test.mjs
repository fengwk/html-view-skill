import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findBrowser, withBrowser } from '../src/shared/browser.mjs';
import { inspectPageExpression, renderCheck } from '../src/shared/render-audit.mjs';

const chrome = findBrowser();
const skip = !chrome && '未找到可执行 Chrome；设置 CHROME_PATH 后启用 SVG 检查回归';
const bin = fileURLToPath(new URL('../htmlview', import.meta.url));
const svgFailures = ({ failures }) => failures.filter(({ code }) => code.startsWith('SVG_'));
const svg = (content, attrs = '') => `<svg width="320" height="148" font-family="monospace" font-size="16" ${attrs}>${content}</svg>`;

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'htmlview-svg-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function check(t, content) {
  const file = join(tempDir(t), 'figure.html');
  writeFileSync(file, `<!doctype html><meta charset="utf-8"><body style="--viz-chip: #fff">${content}</body>`);
  return svgFailures(await renderCheck(file, { chromePath: chrome }));
}

// 手绘图卡没有 data-viz 源块；绕行的连线和被后画底框遮住的连线都不应误报。
test('SVG：完整手绘图和无文字的按钮图标不报错', { skip }, async (t) => {
  assert.deepEqual(await check(t, `<figure class="viz viz-figure">${svg(`
    <rect x="1" y="1" width="318" height="146" fill="#fafafa" stroke="#999"/>
    <text x="16" y="26">Frame title</text>
    <rect x="16" y="49" width="80" height="30" fill="white" stroke="#999"/>
    <text x="28" y="69">Start</text>
    <rect x="220" y="49" width="80" height="30" fill="white" stroke="#999"/>
    <text x="240" y="69">End</text>
    <path d="M56 79V116H260V79" fill="none" stroke="black"/>
    <rect x="120" y="103" width="70" height="26" rx="4" fill="var(--viz-chip)"/>
    <text x="130" y="121">route</text>
  `)}</figure><button aria-label="Close"><svg width="24" height="24"><path d="M4 4L20 20" stroke="black"/></svg></button>`), []);
});

// 三组重叠必须保留到渲染结果中，包括定位到同一个 text 的两组。
test('SVG：文字重叠按配对报告，仅在桌面视口运行', { skip }, async (t) => {
  const failures = await check(t, `<figure class="viz viz-figure">${svg(`
    <text x="20" y="40">first</text><text x="24" y="41">second</text>
    <text x="28" y="42"><tspan>third</tspan></text>
  `)}</figure>`);
  assert.equal(failures.length, 3, JSON.stringify(failures));
  assert.ok(failures.every(({ code, scope, viewports }) => code === 'SVG_TEXT_OVERLAP'
    && scope === 'content' && viewports.join() === 'desktop'));
  const details = failures.filter(({ where }) => where === 'text「third」').map(({ detail }) => detail);
  assert.equal(details.length, 2, JSON.stringify(failures));
  assert.match(details[0], /^与「first」重叠 [\d.]+×[\d.]+px$/);
  assert.match(details[1], /^与「second」重叠 [\d.]+×[\d.]+px$/);
});

// 右侧文字同时跨出容器和画布，两个诊断不能在合并时互相覆盖。
test('SVG：文字超出最后绘制的容器或 SVG 画布', { skip }, async (t) => {
  const failures = await check(t, svg(`
    <rect x="1" y="1" width="314" height="146" fill="#eee"/>
    <g transform="translate(80 0)"><rect x="-25" y="28" width="50" height="30" fill="none" stroke="black"/>
    <text x="0" y="48" text-anchor="middle">Wide label</text></g>
    <rect x="275" y="70" width="42" height="40" fill="white"/>
    <text x="296" y="94" text-anchor="middle">Off canvas</text>
  `));
  assert.equal(failures.length, 3, JSON.stringify(failures));
  assert.ok(failures.every(({ code }) => code === 'SVG_TEXT_OVERFLOW'));
  assert.ok(failures.some(({ where, detail }) => where.includes('Wide label') && /^超出容器：左侧 .*、右侧 .*px$/.test(detail)));
  assert.ok(failures.some(({ where, detail }) => where.includes('Off canvas') && /^超出容器：/.test(detail)));
  assert.ok(failures.some(({ where, detail }) => where.includes('Off canvas') && /^超出 SVG 画布：右侧 .*px$/.test(detail)));
});

// 同一路径先后绘制底框、改用半透明底框，验证遮挡与文档顺序和实际 alpha 有关。
test('SVG：穿过标签的路径仅被后画的不透明底框遮住', { skip }, async (t) => {
  const diagram = (name, chip = '', before = false) => svg(`
    ${before ? chip : ''}<path d="M10 45H290" fill="none" stroke="black"/>
    ${before ? '' : chip}<text x="130" y="50">${name}</text>
  `);
  const chip = '<rect x="110" y="30" width="110" height="28" fill="var(--viz-chip)"/>';
  const failures = await check(t, diagram('Bare') + diagram('Opaque', chip)
    + diagram('Earlier', chip, true) + diagram('Faint', `<g opacity="0.5">${chip}</g>`));
  assert.deepEqual(failures.map(({ code, where, detail }) => [code, where, detail]),
    ['Bare', 'Earlier', 'Faint'].map((name) => ['SVG_LINE_ON_TEXT', `text「${name}」`, '被连线穿过']));
});

// 检查计算值（含 CSS），并确认同名非 marker 元素不能满足引用。
test('SVG：报告找不到的 marker 引用', { skip }, async (t) => {
  const failures = await check(t, svg(`
    <style>#missing-arrow { marker-end: url(#absent); marker-start: url(#not-a-marker); }</style>
    <text id="not-a-marker" x="12" y="24">Arrows</text>
    <line id="missing-arrow" x1="12" y1="50" x2="150" y2="50" stroke="black"/>
    <polyline points="12,75 70,75 70,95" fill="none" stroke="black" marker-mid="url(#absent-mid)"/>
  `));
  assert.deepEqual(failures.map(({ code, where, detail, viewports }) => [code, where, detail, viewports]), [
    ['SVG_MARKER_MISSING', 'line', '箭头引用 #not-a-marker 不存在', ['desktop']],
    ['SVG_MARKER_MISSING', 'line', '箭头引用 #absent 不存在', ['desktop']],
    ['SVG_MARKER_MISSING', 'polyline', '箭头引用 #absent-mid 不存在', ['desktop']],
  ]);
});

// 两端都测试：后画的节点盖住箭头，改在节点之后绘制并停在框边则通过。
test('SVG：箭头被后画的节点盖住时报告', { skip }, async (t) => {
  const diagram = (id, position, covered) => {
    const line = `<line x1="${covered ? 46 : 80}" y1="60" x2="${covered ? 234 : 200}" y2="60" stroke="black" marker-${position}="url(#${id})"/>`;
    const boxes = '<rect x="12" y="40" width="68" height="40" fill="white"/><rect x="200" y="40" width="68" height="40" fill="white"/>';
    return svg(`
      <defs><marker id="${id}" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto-start-reverse">
        <path d="M0 0L8 4L0 8Z"/>
      </marker></defs>
      ${covered ? line + boxes : boxes + line}
      <text x="12" y="24">Arrows</text>
    `);
  };
  const failures = await check(t, diagram('arrow-end', 'end', true)
    + diagram('arrow-start', 'start', true) + diagram('arrow-clear', 'end', false));
  assert.deepEqual(failures.map(({ code, where, detail }) => [code, where, detail]),
    Array.from({ length: 2 }, () => ['SVG_ARROW_HIDDEN', 'line', '箭头被后面绘制的图形盖住']));
});

// 先确认 CLI 生成了真实图和源块，再移除源块做对照，证明豁免不是因为图里碰巧没有问题。
test('SVG：由 CLI 构建的 KChart 图卡不受手绘规则影响', { skip }, async (t) => {
  const dir = tempDir(t);
  const source = join(dir, 'fixture.md');
  const file = join(dir, 'fixture.html');
  const spec = JSON.stringify({
    chart: 'bar', title: 'Visits', data: [{ name: 'A', count: 3 }, { name: 'B', count: 5 }],
    encode: { category: 'name', value: 'count' },
  });
  writeFileSync(source, `# SVG lint fixture\n\n## Visits\n\n<pre data-viz="kchart" id="visits">${spec}</pre>\n`);
  execFileSync(process.execPath, [bin, 'doc', 'build', source, '--out', file]);
  await withBrowser(async (browser) => {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(pathToFileURL(file).href);
      await page.evaluate('HtmlViewViz.ready()');
      assert.equal(await page.evaluate(`Boolean(document.querySelector('.viz-figure#visits > pre[data-viz="kchart"]')
        && document.querySelector('#visits svg text'))`), true);
      const inspect = async () => svgFailures(await page.json(inspectPageExpression({ viewport: 'desktop' })));
      assert.deepEqual(await inspect(), []);
      await page.evaluate(`Boolean(document.querySelector('#visits .viz-body svg').insertAdjacentHTML('beforeend',
        '<text x="20" y="25">probe</text><text x="20" y="25">probe</text><line x2="10" marker-end="url(#chart-missing-arrow)" stroke="black"/>'))`);
      assert.deepEqual(await inspect(), []);
      await page.evaluate(`document.querySelector('#visits > pre[data-viz]').remove(); true`);
      const failures = await inspect();
      assert.ok(failures.some(({ code, detail }) => code === 'SVG_TEXT_OVERLAP' && detail.startsWith('与「probe」')));
      assert.ok(failures.some(({ code }) => code === 'SVG_MARKER_MISSING'));
    } finally {
      await page.close();
    }
  }, { chromePath: chrome });
});
