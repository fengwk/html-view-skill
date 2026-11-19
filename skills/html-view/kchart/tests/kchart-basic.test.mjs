import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadChart } from './kchart-fixture.mjs';

const { api: K } = loadChart(['chart/basic']);
const { palette } = K.util.context();
const plain = (value) => JSON.parse(JSON.stringify(value));
const table = (chart, data, encode, extra = {}) => ({ chart, data, encode, ...extra });
const textOf = (scene) => {
  const values = [];
  const visit = (node) => { if (node.text != null) values.push(String(node.text)); for (const child of node.children || []) visit(child); };
  scene.children.forEach(visit);
  return values.join('\n');
};
const elements = (scene, tag) => {
  const out = [];
  const visit = (node) => { if (node.tag === tag) out.push(node); for (const child of node.children || []) visit(child); };
  scene.children.forEach(visit);
  return out;
};

// 意图：柱图左侧轴单位与刻度共用实测宽度预算，长单位文字也不越过场景边界。
test('column reserves the measured left extent of its axis unit', () => {
  const scene = K.layout(table('column', [{ category: 'A', amount: 2 }, { category: 'B', amount: 4 }], { category: 'category', value: 'amount' }, { fields: { amount: { unit: 'orders' } } }), { width: 640, lang: 'en' });
  assert.equal(scene.overflow, undefined);
});

// 意图：六个迁入图型均能从严格spec到纯场景再到SVG；可捕获注册缺失、DOM依赖或序列化错误。
test('six original chart defaults register and produce accessible SVG scenes', () => {
  const cases = [
    table('line', [{ month: 'Jan', amount: 2 }, { month: 'Feb', amount: 4 }], { category: 'month', value: 'amount' }),
    table('area', [{ month: 'Jan', amount: 2 }, { month: 'Feb', amount: 4 }], { category: 'month', value: 'amount' }),
    table('column', [{ region: 'East', amount: 2 }, { region: 'West', amount: 4 }], { category: 'region', value: 'amount' }),
    table('bar', [{ region: 'East', amount: 2 }, { region: 'West', amount: 4 }], { category: 'region', value: 'amount' }),
    table('share', [{ region: 'East', a: 2, b: 4 }, { region: 'West', a: 4, b: 2 }], { category: 'region', value: ['a', 'b'] }),
    table('funnel', [{ step: 'Visit', amount: 10 }, { step: 'Pay', amount: 4 }], { category: 'step', value: 'amount' }),
  ];
  assert.deepEqual(plain([...K.layouts.keys()].sort()), ['area', 'bar', 'column', 'funnel', 'line', 'share']);
  for (const spec of cases) {
    const { scene, svg } = K.render(spec, { width: 800 });
    assert.equal(scene.width, 800);
    assert.ok(scene.height > 0);
    assert.match(svg, /<svg[^>]+role="img"/);
    assert.match(svg, /<title id=/);
    assert.ok(elements(scene, 'text').every((node) => Number(node.attrs['font-size'] || 12) >= 12), `${spec.chart} keeps all text at least 12px`);
  }
});

// 意图：末个柱的类别名含不可断片段（如“（含团购）”）时完整保留并向内夹紧，不越出画布。
test('column keeps a long last category whole and inside the canvas', () => {
  const names = ['跨境电商平台自营仓发货', '高校与科研机构采购合同', '新注册且完成首单的用户', '华东大区直营门店合计'];
  const rows = Array.from({ length: 23 }, (_, i) => ({ category: `${names[i % names.length]} ${i}`, value: (i % 5 + 1) * 10 }));
  rows.push({ category: '小程序自提订单（含团购） 24', value: 30 });
  // 全角字符按 12px、其余按 7px 近似浏览器实测：“（含团购）”整体 60px，比末个标签的折行宽度更宽。
  const measure = (text) => [...String(text)].reduce((sum, ch) => sum + (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 12 : 7), 0);
  const scene = K.layout(table('column', rows, { category: 'category', value: 'value' }, { unit: '单' }), { width: 777, measure });
  assert.equal(scene.overflow, undefined);
  const text = elements(scene, 'text').map((node) => node.text).join('');
  assert.match(text, /（含团购）/, 'the unbreakable piece of the last label is still drawn');
});

// 意图：窄占比图保留完整读数；单条读数比条宽还宽时自己换行，不为它撑宽整张图。
test('share wraps a readout wider than the bar instead of widening the chart', () => {
  const scene = K.layout(table('share', [
    { category: 'Retail', value: 2476 }, { category: 'Direct', value: 1004 },
    { category: 'First-time buyers with a completed order', value: 1493 },
    { category: 'Self-serve annual renewals (net)', value: 2257 },
    { category: 'Desktop', value: 1396 }, { category: 'Lagos', value: 2726 },
  ], { category: 'category', value: 'value' }, { unit: 'USD' }), { width: 300, lang: 'en' });
  assert.equal(scene.overflow, undefined);
  assert.equal(scene.width, 300, 'a long readout wraps inside the requested width');
  const text = elements(scene, 'text').map((node) => node.text).join('\n');
  for (const word of ['First-time', 'buyers', 'completed', 'order']) assert.match(text, new RegExp(word), 'the wrapped readout keeps every word');
});

// 意图：保证单线保留缺口、读数使用统一root-unit格式、类别完整可引用；覆盖曲线/面积间断与字段身份风险。
test('line and area preserve null gaps, labels, units, and source record identity', () => {
  const spec = table('line', [
    { period: 'A', revenue: 12000, id: 'r1' },
    { period: 'B', revenue: null, id: 'r2' },
    { period: 'C', revenue: 24000, id: 'r3' },
  ], { category: 'period', value: 'revenue', id: 'id' }, { unit: '元' });
  const line = K.layout(spec, { width: 800 });
  const paths = elements(line, 'path');
  assert.equal(paths.filter((p) => p.attrs.fill === 'none').length, 2, 'a null splits the trend into two separate strokes');
  assert.ok(elements(line, 'circle').some((circle) => circle.meta?.record === 'r3'));
  assert.match(textOf(line), /2\.4万元/);
  assert.ok(elements(line, 'text').some((node) => node.meta?.label === 'C'));

  const area = K.layout(table('area', [
    { period: 'A', x: 2, y: 1 }, { period: 'B', x: null, y: null }, { period: 'C', x: 3, y: 2 },
  ], { category: 'period', value: ['x', 'y'] }), { width: 800 });
  assert.equal(elements(area, 'path').filter((p) => p.attrs.fill === 'none').length, 4, 'each series becomes two separate stroke segments around its null gap');
  assert.throws(() => K.layout(table('area', [{ period: 'A', x: 1, y: null }], { category: 'period', value: ['x', 'y'] }, { stack: 'absolute' })), /堆叠.*不支持缺失值/);
  const stacked = K.layout(table('area', [{ period: 'A', x: 1, y: 2 }, { period: 'B', x: 2, y: 2 }], { category: 'period', value: ['x', 'y'] }, { stack: 'percent' }), { width: 800 });
  assert.match(textOf(stacked), /100\.0%/);
});

// 意图：比较布局按0基线画正负柱，分组/堆叠语义不混淆；单位标签仅在整组能容纳时出现。
test('column and bar render grouped/stacked values with zero baselines and units', () => {
  const grouped = K.layout(table('column', [
    { team: 'A', current: 12, previous: -4 }, { team: 'B', current: 8, previous: 5 },
  ], { category: 'team', value: ['current', 'previous'] }, { unit: 'ms' }), { width: 800 });
  assert.ok(elements(grouped, 'line').some((node) => node.attrs.stroke === palette.axis));
  assert.ok(elements(grouped, 'rect').some((node) => node.meta?.value === -4));
  assert.match(textOf(grouped), /12 ms/);
  assert.ok(elements(grouped, 'text').some((node) => node.meta?.label === 'A'));

  const stacked = K.layout(table('bar', [
    { team: 'A', current: 2, previous: 3 }, { team: 'B', current: 1, previous: 4 },
  ], { category: 'team', value: ['current', 'previous'] }, { stack: 'absolute', unit: '人' }), { width: 800 });
  assert.ok(elements(stacked, 'rect').filter((node) => node.meta?.kind === 'record').length >= 4);
  assert.match(textOf(stacked), /5人/);
  assert.ok(elements(stacked, 'g').some((node) => node.meta?.kind === 'legend' && node.meta.series));
  assert.throws(() => K.layout(table('column', [{ x: 'a', a: 2, b: -1 }], { category: 'x', value: ['a', 'b'] }, { stack: 'percent' })), /图表声明校验失败/);
  assert.throws(() => K.layout(table('bar', [{ x: 'a', a: 1, b: null }], { category: 'x', value: ['a', 'b'] }, { stack: 'absolute' })), /图表声明校验失败/);
  const percent = K.layout(table('column', [{ x: 'a', a: 1, b: 3 }, { x: 'b', a: 2, b: 2 }], { category: 'x', value: ['a', 'b'] }, { stack: 'percent' }), { width: 800 });
  assert.match(textOf(percent), /100\.0%/);
  // 同一类的百分比柱必须铺满同一高度，而不是用原数加到0–1轴上。
  const parts = elements(percent, 'rect').filter(node => node.meta?.kind === 'record' && node.meta.category === 'a');
  assert.equal(parts.length, 2);
  assert.ok(Math.abs(parts[1].attrs.height / parts[0].attrs.height - 3) < 1e-8);
  assert.ok(parts.every(node => node.attrs.y >= 0 && node.attrs.y + node.attrs.height <= percent.height));
  assert.doesNotThrow(() => K.render(table('bar', [{x:'zero',v:0}], {category:'x',value:'v'})));
  const aSegments = elements(percent, 'rect').filter((node) => node.meta?.kind === 'record' && node.meta.category === 'a');
  const heights = aSegments.map((node) => Number(node.attrs.height));
  assert.equal(heights.length, 2);
  assert.ok(Math.abs(heights[0] / heights.reduce((sum, value) => sum + value, 0) - 0.25) < 0.01);
});

// 意图：验证review中发现的零值、log坐标、绝对堆叠折线和置信区间断段不会伪造图形或误读数据。
test('review fixes keep zero marks absent, log coordinates consistent, and stacked lines unfilled', () => {
  const zero = K.layout(table('column', [{ x: 'zero', amount: 0 }], { category: 'x', value: 'amount' }), { width: 800 });
  assert.equal(elements(zero, 'rect').filter((node) => node.meta?.kind === 'record' && node.meta.value === 0).length, 0);

  const mixedStack = K.layout(table('bar', [
    { x: 'A', series: 'positive-1', value: 5 }, { x: 'A', series: 'negative', value: -3 }, { x: 'A', series: 'positive-2', value: 2 },
  ], { category: 'x', series: 'series', value: 'value' }, { stack: 'absolute' }), { width: 800 });
  const baselineX = Number(elements(mixedStack, 'line').find((node) => node.attrs.stroke === palette.axis).attrs.x1);
  const negativeBar = elements(mixedStack, 'rect').find((node) => node.meta?.series === 'negative');
  const finalPositiveBar = elements(mixedStack, 'rect').find((node) => node.meta?.series === 'positive-2');
  assert.ok(Math.abs(Number(negativeBar.attrs.x) + Number(negativeBar.attrs.width) - baselineX) < 0.01, 'negative stack segment starts from zero on its own side');
  assert.ok(Number(finalPositiveBar.attrs.x) > baselineX, 'later positive segment continues the positive stack, not the negative one');

  const log = K.layout(table('line', [{ x: 'A', amount: 1 }, { x: 'B', amount: 10 }, { x: 'C', amount: 100 }], { category: 'x', value: 'amount' }, { fields: { amount: { scale: 'log' } } }), { width: 800 });
  const circles = elements(log, 'circle').sort((a, b) => a.meta.value - b.meta.value);
  assert.ok(Math.abs((Number(circles[0].attrs.cy) + Number(circles[2].attrs.cy)) / 2 - Number(circles[1].attrs.cy)) < 0.01, 'equal ratios occupy equal log-coordinate distances');
  assert.match(textOf(log), /10/);
  const logRender = K.render(table('line', [{ x: 'A', amount: 1 }, { x: 'B', amount: 10 }, { x: 'C', amount: 100 }], { category: 'x', value: 'amount' }, { fields: { amount: { scale: 'log' } } }), { width: 320 });
  assert.match(logRender.svg, /<svg[^>]+role="img"/);
  assert.doesNotMatch(logRender.svg, /NaN|Infinity/);

  const many = K.layout(table('line', Array.from({ length: 16 }, (_, i) => ({ x: `long category ${i}`, amount: i + 1 })), { category: 'x', value: 'amount' }), { width: 320 });
  const manyLabels = elements(many, 'text').filter((node) => node.meta?.kind === 'category');
  assert.ok(manyLabels.length < 16, 'labels that cannot keep a readable gap are thinned instead of forcing one slot per category');
  assert.ok(many.width < 320 + 16 * 48, 'thinned category labels do not reserve a fixed slot for every category');

  const stackedLine = K.layout(table('line', [{ x: 'A', current: 2, previous: 1 }, { x: 'B', current: 3, previous: 2 }], { category: 'x', value: ['current', 'previous'] }, { stack: 'absolute' }), { width: 800 });
  const strokes = elements(stackedLine, 'path').filter((node) => node.attrs.stroke !== 'none');
  assert.equal(strokes.length, 2);
  assert.ok(strokes.every((node) => node.attrs.fill === 'none'), 'absolute stack in line chart accumulates without drawing area fills');
  assert.match(textOf(stackedLine), /5/);

  const colliding = K.layout(table('line', [
    { x: 'A', one: 2, two: 30, three: 400 }, { x: 'B', one: 8, two: 8, three: 80 },
  ], { category: 'x', value: ['one', 'two', 'three'] }), { width: 800 });
  const lastLabels = elements(colliding, 'text').filter((node) => node.meta?.kind === 'value');
  assert.equal(lastLabels.filter((node) => node.text === '8').length, 1, 'identical end values share one label');
  assert.equal(lastLabels.length, 2);
  const baselines = lastLabels.map((node) => Number(node.attrs.y)).sort((a, b) => a - b);
  assert.ok(baselines[1] - baselines[0] >= 15);
  assert.equal(elements(colliding, 'line').filter((node) => node.meta?.kind === 'connector').length, 3);
});

// 意图：置信区间的缺失值形成分段带，不能被当成零画出跨越缺口的多边形。
test('confidence bands break at missing intervals and annotations remain visible', () => {
  const line = K.layout(table('line', [
    { x: 'A', v: 2, lo: 1, hi: 3, id: 'a' }, { x: 'B', v: 3, lo: 2, hi: 4, id: 'b' },
    { x: 'C', v: null, lo: null, hi: null, id: 'c' }, { x: 'D', v: 4, lo: 3, hi: 5, id: 'd' },
    { x: 'E', v: 5, lo: 4, hi: 6, id: 'e' },
  ], { category: 'x', value: 'v', lower: 'lo', upper: 'hi', id: 'id' }, { annotations: [{ kind: 'rule', field: 'v', value: 3, label: 'threshold' }, { kind: 'note', field: 'v', record: 'd', text: 'event' }] }), { width: 800 });
  assert.equal(elements(line, 'path').filter((node) => node.attrs['fill-opacity'] === 0.13).length, 2);
  assert.match(textOf(line), /threshold/);
  assert.match(textOf(line), /event/);
  assert.ok(elements(line, 'text').some((node) => node.meta?.kind === 'annotation'));

  const bar = K.layout(table('bar', [{ x: 'A', v: 3, id: 'a' }, { x: 'B', v: 5, id: 'b' }], { category: 'x', value: 'v', id: 'id' }, { annotations: [{ kind: 'rule', field: 'v', value: 4, label: 'bar-rule' }, { kind: 'band', field: 'v', from: 2, to: 4, label: 'bar-band' }, { kind: 'note', field: 'v', record: 'b', text: 'bar-note' }] }), { width: 800 });
  assert.match(textOf(bar), /bar-rule/);
  assert.match(textOf(bar), /bar-band/);
  assert.match(textOf(bar), /bar-note/);
  assert.ok(elements(bar, 'text').some((node) => node.meta?.kind === 'annotation' && node.meta.label === 'bar-note'));
});

// 意图：窄条形图的横轴刻度按实测文字宽度抽稀，并为两端刻度保留画布内边距，防止中英大数值相互覆盖或裁切。
test('horizontal bar value ticks thin by measured width and remain inside the scene', () => {
  const rows = [{ category: 'A', amount: -10_000_000 }, { category: 'B', amount: -7_500_000 }, { category: 'C', amount: -5_000_000 }, { category: 'D', amount: 100_000_000 }];
  for (const width of [240, 268, 520]) {
    const spec = table('bar', rows, { category: 'category', value: 'amount' });
    const scene = K.layout(spec, { width, lang: 'en-US' });
    const measure = K.util.context({ spec, width, lang: 'en-US' }).measure;
    const texts = elements(scene, 'text');
    const baseline = Math.max(...texts.map(node => Number(node.attrs.y)));
    const ticks = texts.filter(node => Number(node.attrs.y) === baseline).map(node => ({ x: Number(node.attrs.x), w: measure(node.text, 12), text: node.text })).sort((a, b) => a.x - b.x);
    const boxes = ticks.map(node => ({ left: node.x - node.w / 2, right: node.x + node.w / 2, text: node.text }));
    assert.ok(boxes.length >= 2, `width ${width} retains readable value ticks`);
    assert.ok(boxes.every((box, i) => box.left >= 0 && box.right <= scene.width && (!i || box.left >= boxes[i - 1].right + 7)), `width ${width}: ${JSON.stringify(boxes)}`);
  }
});

// 意图：确保折线/面积采用主题色淡填充、每个有效读数均有点标记，端点标签不越出类别坐标。
test('basic trends use light theme fills, mark every point, and anchor endpoint labels inward', () => {
  const values = Array.from({ length: 13 }, (_, i) => ({ category: `period-${i}`, amount: i + 1 }));
  const line = K.layout(table('line', values, { category: 'category', value: 'amount' }), { width: 800 });
  assert.equal(elements(line, 'circle').length, values.length, 'dense series keep a visible marker at every value');
  assert.ok(elements(line, 'text').some((node) => node.meta?.kind === 'category' && node.meta.index === 0 && node.attrs['text-anchor'] === 'start'));
  assert.ok(elements(line, 'text').some((node) => node.meta?.kind === 'category' && node.meta.index === values.length - 1 && node.attrs['text-anchor'] === 'end'));
  assert.equal(elements(line, 'defs').length, 0, 'line charts no longer add the dirty gray fade under the trend');

  const area = K.layout(table('area', [{ category: 'A', amount: 2 }, { category: 'B', amount: 4 }], { category: 'category', value: 'amount' }), { width: 800 });
  const fill = elements(area, 'path').find((node) => node.attrs.fill !== 'none');
  assert.ok(fill.attrs.fill === palette.tone1, 'area fill follows its theme series color');
  assert.equal(fill.attrs['fill-opacity'], 0.12, 'area fill uses a restrained 12% opacity');
});

// 意图：面积图带注释标签在主题页面底色上的文字对比度由ctx.textColor保证，不依赖特定主题色恰好可读。
test('area band annotation labels use page-background-safe text contrast', () => {
  const spec = table('area', [{ x: 'A', value: 1 }, { x: 'B', value: 5 }, { x: 'C', value: 2 }], { category: 'x', value: 'value' }, { annotations: [{ kind: 'band', field: 'value', from: 2, to: 4, label: 'target' }] });
  const scene = K.layout(spec, { width: 240, theme: 'tokyo', lang: 'en-US' });
  const annotation = elements(scene, 'text').find(node => node.text === 'target');
  const expected = K.util.context({ spec, width: 240, theme: 'tokyo', lang: 'en-US' }).textColor('fg');
  assert.equal(annotation.attrs.fill, expected);
});

// 意图：日期类刻度保持单行且在窄视口抽稀，防止ISO日期在连字符处断行。
test('date category labels remain unbroken and are thinned at narrow widths', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ period: `2026-0${i + 1}`, value: i + 1 }));
  const scene = K.layout(table('line', rows, { category: 'period', value: 'value' }), { width: 324 });
  const labels = elements(scene, 'text').filter((node) => node.meta?.kind === 'category');
  assert.ok(labels.length < rows.length, 'narrow date axis omits crowded intermediate ticks');
  assert.ok(labels.every((node) => node.text === node.meta.label && !String(node.text).includes('\n')), 'each visible ISO month remains a single unbroken label');
  const boxes = labels.map((node) => {
    const width = [...String(node.text)].length * 12 * 0.56;
    const x = Number(node.attrs.x), anchor = node.attrs['text-anchor'];
    return { left: anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2, right: anchor === 'start' ? x + width : anchor === 'end' ? x : x + width / 2 };
  }).sort((a, b) => a.left - b.left);
  assert.ok(boxes.slice(1).every((box, index) => box.left >= boxes[index].right), 'visible date labels do not collide horizontally');
  // 时间轴已经抽稀标签，不应再强制每个观测占48px，让普通月报在手机上无意义地滚动。
  const months = Array.from({ length: 13 }, (_, i) => ({ period: new Date(Date.UTC(2025, 9 + i, 1)).toISOString().slice(0, 7), value: i + 1 }));
  const compact = K.layout(table('line', months, { category: 'period', value: 'value' }), { width: 350 });
  assert.equal(compact.width, 350);
  assert.equal(elements(compact, 'circle').filter(node => node.meta?.kind === 'record').length, 13, 'thinned labels never remove observations');
});

// 意图：首尾标签贴边后，月份标签仍按统一步长抽稀；不能只删掉紧邻两端的月份，让读者以为缺了哪个月。
test('thinned month labels keep an even step; only the final interval may be shorter', () => {
  for (const count of [12, 13, 24]) for (const width of [324, 558, 864]) {
    const rows = Array.from({ length: count }, (_, i) => ({ period: new Date(Date.UTC(2025, 8 + i, 1)).toISOString().slice(0, 7), value: 100 + i * 7 }));
    const scene = K.layout(table('line', rows, { category: 'period', value: 'value' }), { width });
    const shown = elements(scene, 'text').filter((node) => node.meta?.kind === 'category').map((node) => rows.findIndex((row) => row.period === node.meta.label));
    const gaps = shown.slice(1).map((index, i) => index - shown[i]);
    assert.equal(shown[0], 0, `${count}@${width}: the first month is labelled`);
    assert.equal(shown.at(-1), count - 1, `${count}@${width}: the last month is labelled`);
    if (gaps.length < 2) continue;
    assert.equal(new Set(gaps.slice(0, -1)).size, 1, `${count}@${width}: ${shown} are evenly spaced`);
    assert.ok(gaps.at(-1) <= gaps[0] && gaps.at(-1) * 2 >= gaps[0], `${count}@${width}: the last interval ${gaps.at(-1)} stays close to the step ${gaps[0]}`);
  }
});

// 意图：柱状图类名居中对齐，放得下就全部显示（不按 48px 占位抽掉「Tue」）；抽稀时步长统一；
// 首尾类名不会独自折成两行。
test('column category labels show whenever they fit, thin evenly, and wrap alike at both ends', () => {
  const labelsOf = (scene) => elements(scene, 'text').filter((node) => node.meta?.kind === 'category');
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => ({ day, booked: 16 + i, target: 18 + i }));
  const week = K.layout(table('column', days, { category: 'day', value: ['booked', 'target'] }), { width: 330 });
  assert.deepEqual([...new Set(labelsOf(week).map((node) => node.meta.label))], days.map((row) => row.day));
  const months = Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, value: 10 + i }));
  for (const width of [324, 558, 864]) {
    const nodes = labelsOf(K.layout(table('column', months, { category: 'month', value: 'value' }), { width }));
    const shown = [...new Set(nodes.map((node) => node.meta.index))];
    assert.equal(nodes.length, shown.length, `${width}px: every month label stays on one line`);
    const gaps = shown.slice(1).map((index, i) => index - shown[i]);
    assert.ok(shown[0] === 0 && shown.at(-1) === 11 && new Set(gaps.slice(0, -1)).size <= 1 && gaps.at(-1) <= gaps[0], `${width}px: ${shown} thin with an even step`);
  }
});

test('emphasis selections alter visual treatment while preserving record identities', () => {
  const line = K.layout(table('line', [{ x: 'A', v: 2, id: 'a' }, { x: 'B', v: 3, id: 'b' }], { category: 'x', value: 'v', id: 'id' }, { emphasis: { rows: ['a'] } }), { width: 800 });
  const dots = elements(line, 'circle');
  assert.equal(dots.find((node) => node.meta.record === 'a').attrs.fill, palette.tone2);
  assert.equal(dots.find((node) => node.meta.record === 'b').attrs['fill-opacity'], 0.28);
  assert.ok(dots.every((node) => node.meta.kind === 'record' && node.meta.series && node.meta.label));
});

// 意图：确认占比条只有整体外边缘圆角、长系列名完整换行且留在viewBox内，并避免funnel读数行高被低估。
test('share seams stay square and funnel readouts reserve all rendered lines', () => {
  const share = K.layout(table('share', [{ x: 'A', amount: 1 }, { x: 'B', amount: 1 }, { x: 'C', amount: 2 }], { category: 'x', value: 'amount' }), { width: 800 });
  const segments = elements(share, 'path').filter((node) => node.meta?.kind === 'record');
  assert.equal(segments.length, 3);
  assert.equal((segments[1].attrs.d.match(/Q/g) || []).length, 0, 'internal segment has no rounded corners');

  const longShare = K.layout(table('share', [{ category: 'A', amount: 3 }, { category: 'B', amount: 2 }], { category: 'category', value: 'amount' }, { fields: { amount: { label: 'Gross merchandise value' } } }), { width: 268 });
  const labelLines = elements(longShare, 'text').filter((node) => node.meta?.kind === 'series');
  assert.ok(labelLines.length > 1, 'long row labels wrap into readable lines');
  assert.equal(labelLines.map((node) => node.text).join('').replace(/\s+/g, ''), 'Grossmerchandisevalue', 'wrapping retains every label character');
  assert.ok(labelLines.every((node) => Number(node.attrs.x) - node.text.length * 12 * 0.56 >= 0), 'right-anchored label bounds remain inside the viewBox');
  assert.equal(longShare.width, 268, 'the label column is budgeted inside the requested mobile canvas');

  const funnel = K.layout(table('funnel', [{ x: 'long category label that needs wrapping', n: 100 }, { x: 'next step', n: 40 }], { category: 'x', value: 'n' }), { width: 260 });
  const readouts = elements(funnel, 'text').filter((node) => node.meta?.kind === 'value');
  const firstRows = readouts.filter((node) => node.meta.category === 'long category label that needs wrapping');
  assert.ok(firstRows.length >= 2, 'narrow width yields separate amount and ratio readouts');
  assert.ok(new Set(firstRows.map((node) => node.attrs.y)).size === firstRows.length, 'each emitted readout line has its own baseline');
  const firstBar = elements(funnel, 'rect').find((node) => node.meta?.kind === 'record' && node.meta.category === 'long category label that needs wrapping');
  const amount = firstRows.find((node) => node.text === '100');
  assert.ok(amount && Number(amount.attrs.x) > Number(firstBar.attrs.x) + Number(firstBar.attrs.width), 'primary quantity is hierarchically placed to the right of its bar');
  assert.equal(Number(amount.attrs['font-weight']), 700);
  assert.ok(funnel.height > 2 * 52, 'wrapped label and readouts increase funnel row height');
});

// 意图：share窄屏让每个构成类别及合计都有完整读数；条目只能在条目间换行，不能在内部折行。
test('share mobile readouts include every segment and keep each readout atomic', () => {
  const scene = K.layout(table('share', [
    { category: '甲', amount: 18 }, { category: '乙', amount: 21 },
    { category: '丙', amount: 24 }, { category: '丁', amount: 5 },
  ], { category: 'category', value: 'amount' }), { width: 268 });
  const readouts = elements(scene, 'text').filter((node) => node.meta?.kind === 'value');
  const labels = readouts.map((node) => node.text);
  for (const category of ['甲', '乙', '丙', '丁']) assert.ok(labels.some((label) => label.includes(`${category} `)), `${category} percentage is present`);
  assert.ok(labels.some((label) => label.includes('合计 ')), `series total is present: ${JSON.stringify(labels)}`);
  assert.ok(labels.every((label) => !/\n/.test(label)), 'no readout node contains an internally wrapped line');
  assert.ok(new Set(readouts.map((node) => Number(node.attrs.y))).size > 1, 'complete readout entries flow across multiple lines below the bar');
});

// 意图：share显示每系列构成与类别色阶，funnel显示数量和两个比例且保持输入顺序。
test('share and funnel preserve category/step labels and display proportional readouts', () => {
  const share = K.layout(table('share', [
    { channel: 'web', search: 3, direct: 1 }, { channel: 'store', search: 1, direct: 3 },
  ], { category: 'channel', value: ['search', 'direct'] }), { width: 800 });
  assert.match(textOf(share), /search/);
  assert.match(textOf(share), /direct/);
  assert.ok(elements(share, 'path').some((node) => node.meta?.category === 'web'));
  assert.match(textOf(share), /75\.0%/);

  const funnel = K.layout(table('funnel', [
    { step: '访客', count: 100 }, { step: '加入购物车', count: 50 }, { step: '完成付款', count: 25 },
  ], { category: 'step', value: 'count' }, { unit: '人' }), { width: 800 });
  const text = textOf(funnel);
  const stepLabels = elements(funnel, 'text').filter((node) => node.meta?.kind === 'category');
  const stepGroups = [...new Set(stepLabels.map((node) => node.meta.label))];
  assert.deepEqual(plain(stepGroups), ['访客', '加入购物车', '完成付款']);
  const firstY = stepGroups.map((label) => Number(stepLabels.find((node) => node.meta.label === label).attrs.y));
  assert.ok(firstY[0] < firstY[1] && firstY[1] < firstY[2]);
  assert.match(text, /100人/);
  assert.match(text, /占首步 50\.0%/);
  assert.match(text, /占上一步 50\.0%/);
});

// 意图：系列名列按测得文字留宽。长名折行后，下一行从本行标签块之下开始，行与行不相交。
test('share series labels wrap inside a measured column and advance by their line block', () => {
  const name = 'First-time buyers with a completed order';
  const scene = K.layout(table('share', [
    { category: 'A', value: 3, series: name },
    { category: 'A', value: 2, series: `${name} again` },
  ], { category: 'category', value: 'value', series: 'series' }), { width: 300, lang: 'en' });
  const labels = elements(scene, 'text').filter((node) => node.meta?.kind === 'series');
  const groups = [...new Set(labels.map((node) => node.meta.series))].map((id) => labels.filter((node) => node.meta.series === id));
  assert.ok(groups.every((group) => group.length > 1), 'a name longer than the column wraps instead of being clipped');
  const block = (group) => {
    const ys = group.map((node) => Number(node.attrs.y)).sort((a, b) => a - b);
    return { top: ys[0] - 12, bottom: ys.at(-1) };
  };
  const blocks = groups.map(block).sort((a, b) => a.top - b.top);
  assert.ok(blocks[1].top >= blocks[0].bottom, 'the next series starts after the wrapped label block');
  const widest = Math.max(...labels.map((node) => node.text.length));
  assert.ok(labels.every((node) => Number(node.attrs.x) >= widest), 'right-aligned lines stay inside the measured column');
});

// 意图：漏斗类别列按折行后的实测宽度留白，右对齐长中文的左端不画出场景。
test('funnel category column keeps wrapped right-aligned names inside the scene', () => {
  const scene = K.layout(table('funnel', [
    { step: '小程序自提订单（含团购）', n: 50 },
    { step: '海外渠道代理商销售额', n: 20 },
  ], { category: 'step', value: 'n' }, { unit: '个' }), { width: 430 });
  const labels = elements(scene, 'text').filter((node) => node.meta?.kind === 'category');
  assert.ok(labels.length >= 2, 'long Chinese names wrap');
  assert.ok(labels.every((node) => node.attrs['text-anchor'] === 'end'));
  assert.ok(labels.every((node) => Number(node.attrs.x) >= node.text.length * 8), 'the column is at least as wide as the wrapped line');
  const readouts = elements(scene, 'text').filter((node) => node.meta?.kind === 'value');
  assert.ok(readouts.every((node) => Number(node.attrs.x) + node.text.length * 6 <= scene.width), 'quantity and share readouts stay inside the scene');
});

const boxesOf = (nodes) => nodes.map((node) => {
  const size = Number(node.attrs['font-size'] || 12);
  const width = [...String(node.text)].length * size * 0.56;
  const x = Number(node.attrs.x), y = Number(node.attrs.y), anchor = node.attrs['text-anchor'];
  const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  return { left, right: left + width, top: y - size * 0.8, bottom: y + size * 0.2, text: node.text };
});
const separated = (boxes) => boxes.every((a, i) => boxes.slice(i + 1).every((b) => a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1));

// 意图：同一坐标的相同末端读数只出现一次，不同读数按行高错开，文字框互不相交。
test('line end labels share identical values and never overlap each other', () => {
  const spec = table('line', ['A', 'B'].flatMap((x) => ['one', 'two', 'three'].map((series) => ({ x, series, v: series === 'three' ? 4 : 2 }))), { category: 'x', series: 'series', value: 'v' });
  const scene = K.layout(spec, { width: 480 });
  const labels = elements(scene, 'text').filter((node) => node.meta?.kind === 'value');
  assert.equal(labels.filter((node) => node.text === '2').length, 1, 'equal end values share one label');
  assert.equal(labels.length, 2);
  assert.ok(separated(boxesOf(labels)), 'distinct end labels do not intersect');
  assert.equal(scene.width, 480, 'short categories that fit stay inside the requested width');
});

// 意图：柱顶读数放不下单位时，单位留在绘图区上方，类别名留在基线下方，两者都不压在柱上。
test('column unit sits outside the plot and category labels stay below the baseline', () => {
  const spec = table('column', [
    { c: 'Partner-led marketplace orders', v: 2 },
    { c: 'Self-serve annual renewals', v: 4 },
  ], { category: 'c', value: 'v' }, { unit: 'ms' });
  const scene = K.layout(spec, { width: 420 });
  const texts = elements(scene, 'text');
  const unit = texts.find((node) => node.meta?.kind === 'axis-unit');
  const bars = elements(scene, 'rect').filter((node) => node.meta?.kind === 'record');
  const baseline = Math.max(...bars.map((node) => Number(node.attrs.y) + Number(node.attrs.height)));
  assert.ok(unit, 'the unit is drawn as an axis title');
  assert.ok(Number(unit.attrs.y) < Math.min(...bars.map((node) => Number(node.attrs.y))), 'the unit is above every bar');
  const categories = texts.filter((node) => node.meta?.kind === 'category');
  assert.ok(categories.every((node) => Number(node.attrs.y) > baseline), 'category labels start below the baseline');
  assert.ok(categories.every((node) => !node.text.endsWith('-') && node.text.length > 1), 'wrapped category names do not end on a dangling hyphen');
  assert.equal(scene.overflow, undefined, 'measured gutters keep text inside the scene');
});
