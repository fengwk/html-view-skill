import { test } from 'vitest';
import assert from 'node:assert/strict';
import { install as installBasic } from '../src/chart/basic.js';
import { install as installStatistics } from '../src/chart/statistics.js';
import { install as installVariants } from '../src/chart/variants.js';
import { loadChart } from './kchart-fixture.mjs';
import { themes } from '../src/core/theme.js';

const { api: K } = loadChart([installStatistics]);
const { api: KV } = loadChart([installStatistics, installBasic, installVariants]);
const plain = (value) => JSON.parse(JSON.stringify(value));

const cases = [
  { chart: 'sparkline', data: [{ d: 'A', v: 2 }, { d: 'B', v: 4 }], encode: { category: 'd', value: 'v' } },
  { chart: 'sparkline', data: [{ d: 'A', v: 2 }, { d: 'B', v: 4 }, { d: 'C', v: null }, { d: 'D', v: 8 }, { d: 'E', v: 10 }], encode: { category: 'd', value: 'v' } },
  { chart: 'small-multiples', data: [{ d: 'A', x: 2, y: 3 }, { d: 'B', x: 4, y: 5 }], encode: { category: 'd', value: ['x', 'y'] } },
  { chart: 'small-multiples', data: [{ d: 'A', x: 2, y: 3 }, { d: 'B', x: null, y: 5 }, { d: 'C', x: 4, y: 6 }], encode: { category: 'd', value: ['x', 'y'] } },
  { chart: 'small-multiples', data: [{ d: 'A', p: 'X', v: 2 }, { d: 'B', p: 'X', v: null }, { d: 'A', p: 'Y', v: 3 }, { d: 'B', p: 'Y', v: 5 }], encode: { category: 'd', panel: 'p', value: 'v' } },
  { chart: 'small-multiples', data: [{ d: 'A', p: 'X', v: 2 }, { d: 'B', p: 'X', v: 4 }, { d: 'A', p: 'Y', v: 3 }, { d: 'B', p: 'Y', v: 5 }], encode: { category: 'd', panel: 'p', value: 'v' } },
  { chart: 'bullet', data: [{ c: 'A', a: 4, t: 5 }], encode: { category: 'c', actual: 'a', target: 't' } },
  { chart: 'bullet', data: [{ c: 'A', a: 0.98, t: 0.8 }], fields: { a: { format: 'percent', decimals: 0 }, t: { format: 'percent', decimals: 2 } }, encode: { category: 'c', actual: 'a', target: 't' } },
  { chart: 'dumbbell', data: [{ c: 'A', b: 2, a: 5 }], encode: { category: 'c', before: 'b', after: 'a' } },
  { chart: 'dumbbell', data: [{ c: 'A', b: 2, a: 5 }], fields: { b: { decimals: 1 }, a: { decimals: 3 } }, encode: { category: 'c', before: 'b', after: 'a' } },
  { chart: 'slope', data: [{ c: 'A', b: 2, a: 5 }], encode: { category: 'c', before: 'b', after: 'a' } },
  { chart: 'waterfall', data: [{ c: 'A', d: 3 }], encode: { category: 'c', delta: 'd' } },
  { chart: 'histogram', data: [{ l: 0, u: 1, n: 3 }], encode: { lower: 'l', upper: 'u', count: 'n' } },
  { chart: 'histogram', data: [{ l: 0, u: 1, n: 3 }, { l: 1, u: 3, n: 4 }], fields: { l: { unit: 'kg' }, u: { unit: 'kg' }, n: { unit: 'people' } }, annotations: [{ kind: 'rule', field: 'l', value: 0.5, label: 'median' }, { kind: 'band', field: 'u', from: 1, to: 2, label: 'range' }], encode: { lower: 'l', upper: 'u', count: 'n' } },
  { chart: 'boxplot', data: [{ c: 'A', l: 1, q1: 2, m: 3, q3: 4, h: 5, o: [-1, 7] }], encode: { category: 'c', low: 'l', q1: 'q1', median: 'm', q3: 'q3', high: 'h', outliers: 'o' } },
  { chart: 'scatter', data: [{ x: 1, y: 4, s: 2, name: 'P' }, { x: 3, y: 2, s: 5, name: 'Q' }], encode: { x: 'x', y: 'y', size: 's', label: 'name' } },
  { chart: 'scatter', data: [{ id: 'p', x: 1, y: 0.5 }, { id: 'q', x: 10, y: 0.98 }], fields: { x: { unit: 'km', scale: 'log', domain: [1, 10] }, y: { format: 'percent', decimals: 0, domain: [0, 1] } }, annotations: [{ kind: 'rule', field: 'y', value: 0.75, label: 'target' }, { kind: 'band', field: 'x', from: 2, to: 5, label: 'window' }, { kind: 'note', record: 'p', field: 'y', text: 'baseline' }], encode: { x: 'x', y: 'y', id: 'id' } },
  { chart: 'heatmap', data: [{ r: 'A', c: 'X', v: 2 }, { r: 'B', c: 'X', v: 4 }], encode: { row: 'r', column: 'c', value: 'v' } },
  { chart: 'heatmap', data: [{ r: 'A', c: 'X', v: 2 }, { r: 'B', c: 'X', v: 4 }], fields: { r: { domain: ['A', 'B'] }, c: { domain: ['X', 'Y'] } }, encode: { row: 'r', column: 'c', value: 'v' } },
  { chart: 'waffle', data: [{ c: 'A', v: 2 }, { c: 'B', v: 3 }], encode: { category: 'c', value: 'v' } },
];

// 意图：长密度轴题在绘图区宽度内换行、绘图区下移，不溢出也不为它撑宽画布。
test('histogram wraps a long density-axis title inside the plot width', () => {
  const scene = K.layout({
    chart: 'histogram', encode: { lower: 'lower', upper: 'upper', count: 'count' },
    fields: { lower: { label: 'Value', format: 'percent' }, upper: { label: 'Value', format: 'percent' }, count: { label: 'Frequency' } },
    data: [{ lower: 0, upper: 0.1, count: 0 }, { lower: 0.1, upper: 1, count: 122.1 }],
  }, { width: 240, lang: 'en' });
  assert.equal(scene.overflow, undefined);
  assert.equal(scene.width, 240, 'the title wraps instead of widening the scene');
  const title = flattenNodes(scene.children).filter((node) => node.tag === 'text' && /Frequency|area represents/.test(node.text));
  assert.ok(title.length >= 2, 'the density title spans more than one line');
});

// 意图：验证11图都能由严格spec入口布局成纯SVG场景，且从不带DOM或危险属性进入scene。
test('all statistical chart layouts produce safe scene elements in a DOM-free Node environment', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(K.layouts.size, 11);
  for (const spec of cases) {
    const result = K.validate(spec);
    assert.equal(result.errors.length, 0, `${spec.chart}: ${JSON.stringify(plain(result.errors))}`);
    const scene = K.layout(spec, { width: 640 });
    assert.ok(scene.width >= 180 && scene.height > 0, spec.chart);
    assert.ok(scene.children.length > 0, spec.chart);
    assert.ok(scene.children.every((node) => node.tag && node.attrs && !('style' in node.attrs) && !('href' in node.attrs)), spec.chart);
    assert.match(K.renderScene(scene), /<svg/);
    assert.ok(scene.children.filter((node) => ['rect', 'line', 'circle', 'path'].includes(node.tag)).every((node) => node.attrs.fill !== undefined || node.attrs.stroke !== undefined), `${spec.chart}: ${JSON.stringify(scene.children.filter((node) => ['rect', 'line', 'circle', 'path'].includes(node.tag)).filter((node) => node.attrs.fill === undefined && node.attrs.stroke === undefined))}`);
  }
});

// 意图：验证SVG样式独立于宿主CSS，并且缺失值不伪造为0或跨缺口连线。
test('standalone statistical scenes carry explicit styles and preserve missing gaps', () => {
  const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children || [])]);
  const waterfall = K.layout(cases.find((spec) => spec.chart === 'waterfall'));
  const svg = K.renderScene(waterfall);
  assert.match(svg, /fill="#[0-9a-f]{6}"/i);
  assert.match(svg, /stroke="#[0-9a-f]{6}"/i);
  assert.match(svg, /font-size="12"/);
  assert.match(svg, /font-weight="(?:400|500|600|650|700)"/);
  const sparkSpec = cases.find((spec) => spec.chart === 'sparkline' && spec.data.every((row) => row.v != null));
  const spark = K.layout(sparkSpec);
  assert.equal(spark.children.filter((node) => node.tag === 'path').length, 1);
  const areas = spark.children.filter((node) => node.tag === 'path' && node.attrs.class === 'chart-area');
  assert.equal(areas.length, 1);
  assert.equal(areas[0].attrs['fill-opacity'], 0.12, 'sparkline area is a subtle flat theme-series tint beneath the line');
  assert.equal(areas[0].attrs.fill, K.util.context({ spec: sparkSpec }).palette.tone1);
  assert.ok(flatten(spark.children).some((node) => node.tag === 'path' && String(node.attrs.class).includes('chart-line') && node.attrs.stroke !== 'none'), 'trend line remains a separate foreground mark');
  const multiplesSpec = cases.find((spec) => spec.chart === 'small-multiples' && spec.encode.value.includes('x'));
  const multiples = K.layout(multiplesSpec);
  const multipleAreas = flatten(multiples.children).filter((node) => node.tag === 'path' && node.attrs.class === 'chart-area');
  assert.equal(multipleAreas.length, 2);
  assert.ok(multipleAreas.every((node) => node.attrs['fill-opacity'] === 0.12 && node.attrs.fill === K.util.context({ spec: multiplesSpec }).palette.tone1), 'each small-multiple panel uses the same subtle theme-series tint');
  const wide = K.layout(cases.find((spec) => spec.chart === 'small-multiples' && spec.data[1].x === null));
  assert.ok(wide.children.some((node) => node.tag === 'text' && node.text === 'y'));
  const heat = K.layout(cases.find((spec) => spec.chart === 'heatmap' && spec.fields));
  assert.equal(heat.children.filter((node) => node.tag === 'rect').length, 2);
  const percentBullet = K.renderScene(K.layout(cases.find((spec) => spec.chart === 'bullet' && spec.fields)));
  assert.match(percentBullet, /98%/);
  assert.match(percentBullet, /80\.00%/);
  const decimals = K.renderScene(K.layout(cases.find((spec) => spec.chart === 'dumbbell' && spec.fields)));
  assert.match(decimals, /2\.0/);
  assert.match(decimals, /5\.000/);
  const scatterSpec = cases.find((spec) => spec.chart === 'scatter' && spec.fields);
  const scatter = K.renderScene(K.layout(scatterSpec));
  assert.match(scatter, /98%/);
  assert.match(scatter, /km/);
  assert.match(scatter, /baseline/);
  const histogram = K.renderScene(K.layout(cases.find((spec) => spec.chart === 'histogram' && spec.fields)));
  assert.match(histogram, /数量 \/ kg（面积表示数量）/);
  assert.match(histogram, /stroke-dasharray="4 4"/);
  assert.match(histogram, /median/);
  assert.match(histogram, /range/);
  assert.match(scatter, /target/);
  assert.match(scatter, /window/);
  const waffle = K.layout(cases.find((spec) => spec.chart === 'waffle'));
  assert.ok(new Set(flatten(waffle.children).filter((node) => node.tag === 'circle').map((node) => node.attrs.fill)).size > 1);
  const signedHeat = K.layout({ chart: 'heatmap', data: [
    { r: 'A', c: 'P', v: 0.2 }, { r: 'A', c: 'N', v: -0.2 },
    { r: 'B', c: 'P', v: 0.8 }, { r: 'B', c: 'N', v: -0.8 },
  ], fields: { r: { domain: ['A', 'B'] }, c: { domain: ['P', 'N'] }, v: { domain: [-1, 1] } }, encode: { row: 'r', column: 'c', value: 'v' } });
  assert.ok(new Set(signedHeat.children.filter((node) => node.tag === 'rect').map((node) => node.attrs.fill)).size >= 4);
});

// 意图：锁定dumbbell端点图例、散点/直方图格式刻度和可读字段名，并确保直方网格先于柱形绘制。
test('statistical plots explain dumbbell endpoints and use formatted nice ticks and background grids', () => {
  const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children || [])]);
  const dumbbell = K.layout(cases.find((spec) => spec.chart === 'dumbbell' && !spec.fields));
  const dumbbellNodes = flatten(dumbbell.children);
  const endpointLegend = dumbbellNodes.filter((node) => node.meta?.kind === 'endpoint-legend');
  assert.deepEqual(plain(endpointLegend.map((node) => node.meta.role)), ['before', 'after']);
  assert.equal(endpointLegend[0].attrs.fill, K.util.context({ spec: cases.find((spec) => spec.chart === 'dumbbell' && !spec.fields) }).palette.bg, 'before is hollow as in the plot marks');
  assert.equal(endpointLegend[1].attrs.fill, K.util.context({ spec: cases.find((spec) => spec.chart === 'dumbbell' && !spec.fields) }).palette.tone1, 'after is filled as in the plot marks');
  assert.ok(dumbbellNodes.some((node) => node.tag === 'text' && node.text === '之前') && dumbbellNodes.some((node) => node.tag === 'text' && node.text === '之后'));
  // 声明了字段名时图例用字段名，且两项按实测宽度排开、不重叠。
  const plainDumbbell = cases.find((spec) => spec.chart === 'dumbbell' && !spec.fields);
  const namedSpec = { ...plainDumbbell, fields: { [plainDumbbell.encode.before]: { label: '换屏之前的等待' }, [plainDumbbell.encode.after]: { label: '换屏之后的等待' } } };
  const named = flatten(K.layout(namedSpec).children).filter((node) => node.tag === 'text' && /换屏/.test(node.text));
  assert.deepEqual(plain(named.map((node) => node.text)), ['换屏之前的等待', '换屏之后的等待']);
  const measureNamed = K.util.context({ spec: namedSpec }).measure;
  assert.ok(named[0].attrs.x + measureNamed(named[0].text, 12) + 8 <= named[1].attrs.x - 8, 'legend entries do not overlap');
  // 分配了宽度的类别名不再折行：宽度介于保留宽与折行宽之间的名字曾被拆成两行。
  for (const chart of ['bullet', 'dumbbell']) {
    const spec = chart === 'bullet'
      ? { chart, data: [{ c: 'Hangzhou', a: 3, t: 4 }, { c: 'Shanghai', a: 5, t: 4 }], encode: { category: 'c', actual: 'a', target: 't' } }
      : { chart, data: [{ c: 'Hangzhou', a: 3, t: 4 }, { c: 'Shanghai', a: 5, t: 4 }], encode: { category: 'c', before: 'a', after: 't' } };
    for (const width of [300, 340, 380]) {
      const texts = flatten(K.layout(spec, { width, lang: 'en' }).children).filter((node) => node.tag === 'text').map((node) => node.text);
      assert.ok(texts.includes('Hangzhou') && texts.includes('Shanghai'), `${chart} at ${width}: ${texts}`);
    }
  }
  const dumbbellReads = dumbbellNodes.filter((node) => node.meta?.kind === 'endpoint-readout');
  assert.deepEqual(plain(dumbbellReads.map((node) => node.text)), ['2', '5']);
  assert.notEqual(dumbbellReads[0].attrs.y, dumbbellReads[1].attrs.y, 'the two endpoint readouts use distinct lines rather than overlapping');
  // 图例使用独立的底部行，不能碰到首行的端点读数。
  assert.ok(Math.min(...endpointLegend.map(node => node.attrs.cy)) > Math.max(...dumbbellReads.map(node => node.attrs.y)) + 12);

  const scatterSpec = { chart: 'scatter', data: [{ x: 0.823, y: 12 }, { x: 0.991, y: 18 }],
    encode: { x: 'x', y: 'y', series: 'group', label: 'name' },
    fields: { x: { format: 'percent', label: '转化率' }, y: { unit: '元', label: '客单价' } },
  };
  scatterSpec.data[0].group = '线下'; scatterSpec.data[0].name = '甲';
  scatterSpec.data[1].group = '线上'; scatterSpec.data[1].name = '乙';
  const scatter = K.layout(scatterSpec, { width: 640 });
  const scatterTexts = flatten(scatter.children).filter((node) => node.tag === 'text').map((node) => node.text);
  assert.ok(scatterTexts.includes('转化率') && scatterTexts.includes('客单价 · 元'), 'each axis carries its own field label and unit');
  assert.ok(scatterTexts.includes('线下') && scatterTexts.includes('线上'));
  assert.ok(scatterTexts.includes('甲') && scatterTexts.includes('乙'), 'few points carry their label beside the mark');
  assert.ok(scatterTexts.some((text) => /%$/.test(text)), 'percentage ticks use the x field formatter');
  assert.ok(!scatterTexts.some((text) => /0\.820000|0\.990000/.test(text)), 'fractional inputs do not leak floating-point tails');
  const narrowScatter = K.layout(scatterSpec, { width: 324 });
  const narrowTexts = flatten(narrowScatter.children).filter((node) => node.tag === 'text');
  const yTitle = narrowTexts.find((node) => node.meta?.kind === 'axis-title' && node.meta.axis === 'y');
  const xTitle = narrowTexts.find((node) => node.meta?.kind === 'axis-title' && node.meta.axis === 'x');
  const narrowTicks = narrowTexts.filter((node) => /%$/.test(node.text));
  const narrowDots = flatten(narrowScatter.children).filter((node) => node.tag === 'circle' && Number(node.attrs.r) >= 5);
  assert.equal(yTitle.text, '客单价 · 元');
  assert.equal(xTitle.text, '转化率');
  assert.ok(narrowDots.every((node) => Number(node.attrs.cy) - Number(node.attrs.r) > yTitle.attrs.y), 'the y-axis title sits above the plot');
  assert.ok(narrowTicks.every((node) => xTitle.attrs.y > node.attrs.y + 12), 'the x-axis title sits below the x tick labels');
  assert.ok(narrowScatter.height >= xTitle.attrs.y + 4, 'the scene keeps the x-axis title');
  assert.ok(narrowTexts.some((node) => node.text === '线下') && narrowTexts.some((node) => node.text === '线上'));
  assert.ok(narrowScatter.children.some((node) => /translate\(/.test(String(node.attrs.transform || ''))), 'narrow legend has its own row above the plot');
  const wideScatter = K.layout(scatterSpec, { width: 984 });
  const wideDots = flatten(wideScatter.children).filter((node) => node.tag === 'circle' && Number(node.attrs.r) >= 5);
  assert.ok(wideScatter.height > K.layout(scatterSpec, { width: 324 }).height + 100, 'the plot grows with the available width instead of flattening the point cloud');
  assert.ok(wideDots.length === 2);
  const plotDots = flatten(narrowScatter.children).filter((node) => node.tag === 'circle' && Number(node.attrs.r) >= 5);
  assert.ok(plotDots.every((node) => Number(node.attrs.cx) - Number(node.attrs.r) > 0 && Number(node.attrs.cx) + Number(node.attrs.r) < narrowScatter.width), 'narrow scatter points keep a visible inset from chart edges');

  const histogram = K.layout({ chart: 'histogram', data: [{ l: 0, u: 1, n: 3 }, { l: 1, u: 3, n: 9 }, { l: 3, u: 6, n: 5 }],
    encode: { lower: 'l', upper: 'u', count: 'n' },
    fields: { l: { label: '区间起点', unit: '小时' }, n: { label: '人次' } },
  }, { width: 640 });
  const direct = histogram.children;
  const firstBar = direct.findIndex((node) => node.tag === 'g' && node.children?.some((child) => child.tag === 'rect'));
  const lastGrid = direct.reduce((last, node, index) => node.tag === 'line' && node.attrs.y1 === node.attrs.y2 ? index : last, -1);
  const histogramTexts = flatten(direct).filter((node) => node.tag === 'text').map((node) => node.text);
  assert.ok(lastGrid >= 0 && firstBar > lastGrid, 'grid lines are painted below every bar');
  assert.ok(histogramTexts.includes('人次 / 小时（面积表示人次）'));
  assert.ok(histogramTexts.includes('取值（小时）'));
  assert.ok(!histogramTexts.some((text) => /3\.375|1\.125/.test(text)), 'frequency axis avoids the prior non-nice tick values');
  const binTicks = K.layout({ chart: 'histogram', data: [{ l: 0, u: 1, n: 4 }, { l: 1, u: 3, n: 5 }, { l: 3, u: 6, n: 2 }], encode: { lower: 'l', upper: 'u', count: 'n' } });
  const xLabels = flatten(binTicks.children).filter((node) => node.tag === 'text' && Number(node.attrs.y) === 276).map((node) => node.text);
  assert.deepEqual(plain(xLabels), ['0', '1', '3', '6'], 'histogram labels sit at the actual bin boundaries, not equal-spacing subdivisions');

  const unequal = K.layout({ chart: 'histogram', data: [
    { l: 0, u: 30, n: 3200 }, { l: 30, u: 60, n: 6500 }, { l: 60, u: 120, n: 5700 },
    { l: 120, u: 240, n: 3100 }, { l: 240, u: 600, n: 1200 }, { l: 600, u: 1800, n: 300 },
  ], encode: { lower: 'l', upper: 'u', count: 'n' }, fields: {
    l: { label: '响应时间', unit: '秒' }, u: { label: '响应时间', unit: '秒' }, n: { label: '会话数' },
  } }, { width: 268 });
  const unequalTexts = flatten(unequal.children).filter((node) => node.tag === 'text');
  assert.equal(unequal.width, 268, 'unequal bins preserve true data-space widths without expanding the canvas');
  assert.ok(unequalTexts.some((node) => node.text === '会话数 / 秒（面积表示会话数）'), 'density axis states count-per-second and area semantics');
  assert.ok(unequalTexts.some((node) => node.text === '响应时间（秒）' && Number(node.attrs.y) > 280), 'bin axis label and unit are stated once instead of repeated on each tick');
  const edges = unequalTexts.filter((node) => Number(node.attrs.y) === 276);
  assert.ok(edges.length >= 2 && edges.length < 7, 'crowded edge labels are thinned while retaining actual boundary values');
  const measure = K.util.context({ spec: { chart: 'histogram' }, width: 268 }).measure;
  for (let i = 1; i < edges.length; i += 1) {
    const prior = edges[i - 1], current = edges[i];
    assert.ok(Number(current.attrs.x) - Number(prior.attrs.x) >= (measure(prior.text) + measure(current.text)) / 2 + 8, 'kept bin-edge labels do not overlap');
  }
});

// 意图：瀑布图可容纳时使用给定宽度，并保留每根柱子/读数的记录元数据和旧版title文案。
test('waterfall readouts and bars retain stage metadata and title semantics', () => {
  const spec = { chart: 'waterfall', start: 1208000, unit: '元/月', data: [
    { id: 'new', c: '新客', d: 98000 }, { id: 'expand', c: '扩容', d: 42000 }, { id: 'shrink', c: '收缩', d: -18000 }, { id: 'churn', c: '流失', d: -46000 },
  ], encode: { category: 'c', delta: 'd', id: 'id' } };
  const scene = K.layout(spec, { width: 268 });
  const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children || [])]);
  const nodes = flatten(scene.children);
  const texts = nodes.filter((node) => node.tag === 'text');
  const bars = nodes.filter((node) => node.tag === 'rect' && node.meta?.kind?.startsWith('waterfall-'));
  const readouts = texts.filter((node) => node.meta?.kind?.startsWith('waterfall-'));
  assert.equal(scene.width, 268, 'six waterfall stages fit the supplied mobile scene');
  assert.ok(texts.some((node) => node.text === '单位：元/月'), 'unit remains visible in the chart axis heading');
  assert.ok(texts.some((node) => node.text === '+9.8万'), 'delta readout uses a compact number without duplicating the unit');
  assert.ok(texts.filter((node) => /^[+-]?[\\d.,]/.test(node.text)).every((node) => !node.text.includes('元/月')), 'readouts do not repeat the unit already stated in the heading');
  assert.ok(texts.every((node) => Number(node.attrs['font-size']) >= 12), 'compact labels retain the minimum readable size');
  assert.equal(bars.length, 6);
  assert.deepEqual(plain(bars.map((bar) => bar.meta)), plain(readouts.map((node) => node.meta)), 'each numeric readout carries the matching stage identity');
  const measure = K.util.context({ spec, width: 268 }).measure;
  assert.ok(readouts.every((node) => Number(node.attrs.x) - measure(node.text, 12, 700) / 2 >= 0 && Number(node.attrs.x) + measure(node.text, 12, 700) / 2 <= scene.width), 'readout text stays within the original scene width');
  assert.ok(readouts.every((node) => Number(node.attrs.y) >= 36), 'unit heading stays above every readout lane');
  assert.deepEqual(plain(bars[1].meta), { kind: 'waterfall-delta', record: 0, id: 'new', label: '新客', value: 98000, before: 1208000, after: 1306000, total: false });
  assert.ok(bars[0].meta.kind === 'waterfall-total' && bars[0].meta.value === 1208000 && bars[0].meta.before === 0);

  const simpleSpec = { chart: 'waterfall', start: 100, data: [{ c: '新增', d: 20 }, { c: '退款', d: -5 }], encode: { category: 'c', delta: 'd' } };
  const simple = K.layout(simpleSpec);
  const titles = flatten(simple.children).filter((node) => node.tag === 'title').map((node) => node.text);
  assert.deepEqual(plain(titles), ['起点：100', '新增：20', '退款：-5', '终点：115'], 'bar titles retain legacy stage-label, colon, and value wording');
  const rendered = K.render(simpleSpec);
  assert.match(rendered.svg, /<title>起点：100<\/title>/);
  assert.match(rendered.svg, /data-kc-kind="waterfall-delta"/);
});

// 意图：超过当前画布可容纳的步数仍可布局，且每步保留至少26px可读槽位并启用图内滚动。
test('waterfall truncates a positive, narrow range with marked total bars and a readable axis', () => {
  const spec = { chart: 'waterfall', start: 1208000, data: [
    { c: '新客', d: 98000 }, { c: '扩容', d: 42000 }, { c: '收缩', d: -18000 },
    { c: '流失', d: -46000 },
  ], fields: { d: { label: 'MRR变化', unit: '元/月', decimals: 0 } }, encode: { category: 'c', delta: 'd' } };
  const scene = K.layout(spec, { width: 502 });
  const bars = scene.children.flatMap((node) => [node, ...(node.children || [])]).filter((node) => node.tag === 'rect' && node.meta?.kind?.startsWith('waterfall-'));
  const totals = bars.filter((node) => node.meta.total);
  const deltas = bars.filter((node) => !node.meta.total);
  const texts = scene.children.flatMap((node) => [node, ...(node.children || [])]).filter((node) => node.tag === 'text').map((node) => node.text);
  assert.equal(totals.length, 2);
  assert.ok(totals.every((node) => node.meta.truncated === true), 'start and ending totals carry the explicit truncation metadata');
  assert.ok(scene.children.filter((node) => node.tag === 'line' && node.meta?.kind === 'axis-break').length === 4, 'each total bar displays two background-backed parallel break strokes');
  assert.ok(texts.some((text) => text.startsWith('纵轴从 ')));
  assert.ok(!texts.includes('0'), 'a truncated axis does not show a zero tick');
  assert.ok(deltas.every((node) => Number(node.attrs.height) >= 8), "A2's smallest non-zero delta remains at least 8px tall");
  assert.ok(scene.children.filter((node) => node.tag === 'line' && Number(node.attrs.y1) === Number(node.attrs.y2)).length >= 4, 'range gridlines remain visible');
});

test('histogram axes and tooltips use semantic labels, measured edge thinning, and localized formatted density', () => {
  const spec = { chart: 'histogram', data: Array.from({ length: 8 }, (_, i) => ({ l: i * i, u: (i + 1) ** 2, n: i === 0 ? 1.25 : i + 1 })),
    fields: { l: { label: '单次会话时长', unit: '秒', decimals: 0 }, u: { label: '单次会话时长', unit: '秒', decimals: 0 }, n: { label: '会话数', unit: '次', decimals: 1 } },
    encode: { lower: 'l', upper: 'u', count: 'n' } };
  const scene = K.layout(spec, { width: 268, lang: 'zh' });
  const texts = scene.children.flatMap((node) => [node, ...(node.children || [])]).filter((node) => node.tag === 'text').map((node) => node.text);
  assert.ok(texts.includes('会话数 / 秒（面积表示会话数）'));
  assert.ok(texts.includes('单次会话时长（秒）'));
  // 横轴题紧跟边界标签下方一行，不再多空一行。
  const flat = scene.children.flatMap((node) => [node, ...(node.children || [])]).filter((node) => node.tag === 'text');
  const xTitle = flat.find((node) => node.text === '单次会话时长（秒）');
  const edgeY = Math.max(...flat.filter((node) => /^\d+$/.test(node.text) && node.attrs['text-anchor'] !== 'end').map((node) => Number(node.attrs.y)));
  assert.equal(Number(xTitle.attrs.y) - edgeY, 22, 'the x-axis title sits one 22px row below the edge labels');
  assert.ok(!texts.some((text) => /区间下界/.test(text)));
  const originalBoundaryLabels = K.layout({ ...spec, subtitle: '单次会话时长｜秒；纵轴为会话数', fields: {
    l: { label: '区间下界', unit: '秒', decimals: 0 }, u: { label: '区间上界', unit: '秒', decimals: 0 }, n: spec.fields.n,
  } }, { width: 268, lang: 'zh' });
  const originalBoundaryTexts = originalBoundaryLabels.children.flatMap((node) => [node, ...(node.children || [])]).filter((node) => node.tag === 'text').map((node) => node.text);
  assert.ok(originalBoundaryTexts.includes('单次会话时长（秒）'), 'generic bound labels use the meaningful chart subtitle as the axis title');
  const tips = scene.children.filter((node) => node.tag === 'g').flatMap((node) => node.children || []).filter((node) => node.tag === 'title').map((node) => node.text);
  assert.match(tips[0], /密度 1\.3 次\/秒/);
  assert.doesNotMatch(tips[0], /density|1\.25/);
  const english = K.layout(spec, { width: 268, lang: 'en' });
  const englishTips = english.children.filter((node) => node.tag === 'g').flatMap((node) => node.children || []).filter((node) => node.tag === 'title').map((node) => node.text);
  assert.match(englishTips[0], /density 1\.3 次\/秒/);
});

test('waterfall expands rather than rejecting more than sixteen narrow steps', () => {
  const spec = { chart: 'waterfall', start: 0, data: Array.from({ length: 16 }, (_, i) => ({ c: `step-${i}`, d: i % 2 ? -1 : 2 })), encode: { category: 'c', delta: 'd' } };
  const { scene, svg } = K.render(spec, { width: 268 });
  const bars = scene.children.flatMap((node) => [node, ...(node.children || [])]).filter((node) => node.tag === 'g').flatMap((node) => node.children || []).filter((node) => node.tag === 'rect' && node.meta?.kind?.startsWith('waterfall-'));
  const centers = bars.map((bar) => Number(bar.attrs.x) + Number(bar.attrs.width) / 2);
  assert.ok(scene.width > 268, 'sixteen data steps and their totals widen the scene');
  assert.match(svg, new RegExp(`<svg[^>]*width="${scene.width}"`), 'expanded scene dimensions reach serialized SVG');
  assert.equal(bars.length, 18);
  assert.ok(centers.slice(1).every((center, i) => center - centers[i] >= 26), 'each consecutive stage keeps the 26px minimum slot');
});

// 意图：waterfall在旧统计图实现中不支持rule/band注释，KChart校验必须继续明确拒绝。
test('waterfall annotations remain explicit validation errors', () => {
  const result = K.validate({ chart: 'waterfall', data: [{ c: 'increase', d: 2 }], encode: { category: 'c', delta: 'd' }, annotations: [
    { kind: 'rule', field: 'd', value: 1 }, { kind: 'band', field: 'd', from: 0, to: 2 },
  ] });
  assert.equal(result.errors.length, 2);
  assert.ok(result.errors.every((error) => /waterfall不支持annotations/.test(error.message)));
});

// 意图：十二类合法箱线数据在手机宽度下仍可按行渲染，不因分类数量拒绝布局。
test('boxplot renders twelve category rows in a narrow scene', () => {
  const data = Array.from({ length: 12 }, (_, i) => ({ c: `C${i}`, low: i, q1: i + 1, median: i + 2, q3: i + 3, high: i + 4 }));
  const scene = K.layout({ chart: 'boxplot', data, encode: { category: 'c', low: 'low', q1: 'q1', median: 'median', q3: 'q3', high: 'high' } }, { width: 268 });
  assert.equal(scene.width, 268);
  assert.ok(scene.height > 500, 'each boxplot category receives its own row in the expanded vertical scene');
});

// 意图：锁定boxplot须线之外的异常值实际进入场景；避免复用旧几何时漏掉新的 outliers 契约。
test('boxplot draws every declared outlier with inspectable value metadata', () => {
  const scene = K.layout(cases.find((spec) => spec.chart === 'boxplot'));
  const outliers = scene.children.filter((node) => node.meta?.kind === 'outlier');
  assert.deepEqual(plain(outliers.map((node) => node.meta.value)), [-1, 7]);
  assert.ok(outliers.every((node) => node.tag === 'circle'));
  assert.ok(outliers[0].attrs.cx > 56 && outliers[1].attrs.cx < scene.width - 24);
  const whisker = scene.children.find((node) => node.tag === 'line' && node.attrs.class === 'chart-whisker' && node.attrs.y1 === node.attrs.y2);
  assert.ok(whisker && outliers.every((node) => node.attrs.cy === whisker.attrs.y1));
});

// 意图：独立waffle不能只给一片无标签的灰色点阵，分类图例须与点阵同色并保留原始数值。
test('waffle includes a matching category legend and measured footnote wrapping', () => {
  const spec = cases.find(item => item.chart === 'waffle');
  const scene = K.layout(spec, { width: 268 });
  const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children || [])]);
  const nodes = flatten(scene.children);
  const legend = nodes.filter(node => node.meta?.kind === 'legend');
  const dots = nodes.filter(node => node.tag === 'circle');
  assert.equal(dots.length, 100);
  assert.deepEqual(plain(legend.map(node => node.meta.category)), ['A', 'B']);
  assert.deepEqual(plain(legend.map(node => node.meta.value)), [2, 3]);
  assert.deepEqual(plain(legend.map(node => node.children[0].attrs.fill)), [...new Set(dots.map(node => node.attrs.fill))]);
  assert.ok(nodes.some(node => node.tag === 'text' && node.text === 'A · 2'));
  assert.ok(nodes.some(node => node.tag === 'text' && node.text === 'B · 3'));
});

const hexIn = (value) => String(value).match(/#[0-9a-f]{6}/gi).at(-1);
const THEMES = Object.keys(themes);
const flattenNodes = (nodes) => nodes.flatMap((node) => [node, ...flattenNodes(node.children || [])]);

// 意图：瀑布阶段名、散点轴题与注释、小多图面板标题换行后保留全部词，布局按实际行数留高。
test('statistics labels keep every word however many lines they wrap to', () => {
  const long = 'Cross-border marketplace orders fulfilled from regional partner warehouses';
  const words = (scene) => flattenNodes(scene.children).filter((node) => node.tag === 'text').map((node) => node.text).join(' ');
  const keeps = (scene, label, what) => {
    for (const word of label.split(/[\s-]+/)) assert.ok(words(scene).includes(word), `${what} keeps "${word}"`);
  };
  const waterfall = K.layout({ chart: 'waterfall', encode: { category: 'c', delta: 'v' }, data: [
    { c: long, v: 10 }, { c: 'Returns', v: -3 }, { c: 'Other', v: 4 },
  ] }, { width: 300, lang: 'en' });
  keeps(waterfall, long, 'waterfall stage');
  const scatterNote = 'Outlier caused by a one-off bulk order placed before the price change took effect';
  const scatter = K.layout({ chart: 'scatter', encode: { x: 'x', y: 'y', id: 'id' },
    fields: { x: { label: long }, y: { label: 'Gross margin after fulfilment and returns', unit: '%' } },
    annotations: [{ kind: 'note', record: 'a', field: 'y', text: scatterNote }],
    data: [{ id: 'a', x: 1, y: 2 }, { id: 'b', x: 2, y: 3 }, { id: 'c', x: 3, y: 1 }] }, { width: 260, lang: 'en' });
  keeps(scatter, long, 'scatter axis title');
  keeps(scatter, scatterNote, 'scatter note');
  const multiples = K.layout({ chart: 'small-multiples', encode: { category: 'm', value: ['a', 'b'] },
    fields: { a: { label: long, unit: 'orders' }, b: { label: 'Other', unit: 'orders' } },
    data: ['2026-01', '2026-02', '2026-03'].map((m, i) => ({ m, a: i + 1, b: 3 - i })) }, { width: 300, lang: 'en' });
  keeps(multiples, long, 'small-multiples panel title');
});

// 意图：热力格内数字按所在格子的实际底色取色，各内置主题、正负值、有无缺格的两条布局路径都不低于 4.5:1。
test('heatmap cell readouts keep body-text contrast against their own cell fill', () => {
  const full = { chart: 'heatmap', encode: { row: 'r', column: 'c', value: 'v' }, data: ['A', 'B'].flatMap((r, i) => [1, 2, 3, 4, 5].map((step) => ({ r, c: `C${step}`, v: (i ? -1 : 1) * step * 20 }))) };
  const sparse = { ...full, data: full.data.slice(1) };
  for (const theme of THEMES) {
    for (const spec of [full, sparse]) {
      const nodes = flattenNodes(K.layout(spec, { width: 640, theme }).children);
      const cells = nodes.filter((node) => node.tag === 'rect' && node.attrs.rx === 7);
      const readouts = nodes.filter((node) => node.tag === 'text' && /^[-−]?\d+$/.test(node.text));
      assert.equal(readouts.length, spec.data.length, `${theme}: every cell keeps its readout`);
      for (const text of readouts) {
        const cell = cells.find((rect) => text.attrs.x > rect.attrs.x && text.attrs.x < rect.attrs.x + rect.attrs.width && text.attrs.y > rect.attrs.y && text.attrs.y < rect.attrs.y + rect.attrs.height);
        assert.ok(cell, `${theme}: readout ${text.text} sits inside a cell`);
        assert.ok(K.util.contrast(hexIn(text.attrs.fill), hexIn(cell.attrs.fill)) >= 4.5, `${theme}: ${text.text} on ${cell.attrs.fill}`);
      }
    }
  }
});

// 意图：分类列变窄时列头必须留在自己的列内；放不下就加宽列槽，不能靠事后平移场景来盖住邻列。
test('heatmap column headers stay inside their own column or widen the slot', () => {
  const columns = ['华北', '华东', '华南', '西部', '线上', '线下', '加盟', '直营', '小程序', '新客'];
  const spec = {
    chart: 'heatmap', encode: { row: 'r', column: 'c', value: 'v' },
    data: columns.map((column, index) => ({ r: '甲', c: column, v: index + 1 })),
  };
  const scene = K.layout(spec, { width: 360 });
  const headers = flattenNodes(scene.children).filter((node) => node.tag === 'text' && node.attrs['text-anchor'] === 'middle' && node.attrs.y < 40);
  const cells = scene.children.filter((node) => node.tag === 'rect' && node.meta?.record);
  const joined = headers.map((node) => node.text).join('');
  assert.ok(columns.filter((column) => joined.includes(column)).length >= 8, 'category headers stay available after wrapping');
  for (const text of headers) {
    const width = K.util.context({ spec, width: 360 }).measure(text.text, 12);
    const left = text.attrs.x - width / 2;
    const cell = cells.find((node) => text.attrs.x >= node.attrs.x && text.attrs.x <= node.attrs.x + node.attrs.width);
    assert.ok(cell && left >= cell.attrs.x - 1 && left + width <= cell.attrs.x + cell.attrs.width + 1, `${text.text} stays inside its column`);
  }
  assert.equal(scene.overflow, undefined, 'measured column slots do not rely on scene containment');
});

// 意图：浅色主题的最低正档与最低负档必须能靠色相分开，不能都浅成同一种灰。
test('signed heatmap lowest levels stay distinguishable on light themes', () => {
  const spec = {
    chart: 'heatmap', encode: { row: 'r', column: 'c', value: 'v' },
    fields: { v: { domain: [-5, 5] } },
    data: [{ r: '甲', c: '正', v: 1 }, { r: '甲', c: '负', v: -1 }],
  };
  const scene = K.layout(spec, { width: 320, theme: 'claude' });
  const cells = scene.children.filter((node) => node.tag === 'rect' && node.meta?.column);
  const positive = hexIn(cells.find((node) => node.meta.value > 0).attrs.fill);
  const negative = hexIn(cells.find((node) => node.meta.value < 0).attrs.fill);
  const [pr, pg, pb] = [1, 3, 5].map((index) => Number.parseInt(positive.slice(index, index + 2), 16));
  const [nr, ng, nb] = [1, 3, 5].map((index) => Number.parseInt(negative.slice(index, index + 2), 16));
  assert.ok(Math.abs(pr - nr) + Math.abs(pg - ng) + Math.abs(pb - nb) >= 24, 'lowest positive and negative fills keep a visible hue gap');
});

// 意图：色阶端点颜色须等于实际格子填色；小量级、零值和双向域都可读，且 268px 图例不撑宽。
test('cells heatmap explains signed scale endpoints without widening or changing dots', () => {
  const spec = { chart: 'heatmap', encode: { row: 'r', column: 'c', value: 'v' }, data: [
    { r: '甲', c: 'a', v: -0.01 }, { r: '甲', c: 'b', v: 0 }, { r: '甲', c: 'c', v: 0.01 },
  ], fields: { v: { domain: [-0.01, 0.01], format: 'percent', decimals: 2 } } };
  for (const theme of ['claude', 'obsidian']) {
    for (const lang of ['zh', 'en']) {
      for (const width of [268, 640]) {
        const scene = K.layout(spec, { width, theme, lang });
        const nodes = flattenNodes(scene.children);
        const cells = nodes.filter((node) => node.tag === 'rect' && node.meta?.record);
        const legend = nodes.filter((node) => node.meta?.endpoint);
        assert.equal(scene.width, width, `${theme}/${width}: legend stays inside the requested width`);
        assert.deepEqual(plain(legend.map((node) => node.meta.endpoint)), ['low', 'zero', 'high']);
        assert.deepEqual(plain(legend.map((node) => node.meta.value)), [-0.01, 0, 0.01]);
        for (const item of legend) {
          const swatch = item.children.find((child) => child.tag === 'rect');
          const cell = cells.find((candidate) => candidate.meta.value === item.meta.value);
          assert.ok(cell, 'legend endpoint corresponds to a real heatmap cell');
          assert.equal(swatch.attrs.fill, cell.attrs.fill, 'legend uses the cell’s actual endpoint color');
          const label = flattenNodes([item]).find((node) => node.tag === 'text');
          assert.equal(label.attrs['font-size'], 12);
        }
        const labels = nodes.filter((node) => node.tag === 'text').map((node) => node.text).join(' ');
        assert.match(labels, lang === 'en' ? /negative and positive/ : /负值与正值/);
        assert.match(labels, lang === 'en' ? /Low|High/ : /低|高/);
        assert.match(labels, lang === 'en' ? /Blank = missing/ : /空白表示缺失/);
      }
    }
  }
  const tiny = K.layout({ chart: 'heatmap', encode: spec.encode, data: [0.001, 0.002, 0.004, 0.008].map((v, i) => ({ r: '小', c: `c${i}`, v })) }, { width: 268 });
  const tinyColors = tiny.children.filter((node) => node.tag === 'rect' && node.meta?.record).map((node) => node.attrs.fill);
  assert.equal(new Set(tinyColors).size, 4, 'sub-unit values use their observed magnitude instead of a hard-coded scale floor');
  const dots = KV.layout({ ...spec, variant: 'dots' }, { width: 268 });
  const dotNodes = flattenNodes(dots.children);
  assert.equal(dotNodes.filter((node) => node.meta?.endpoint).length, 0, 'dots variant does not inherit the cells legend');
  assert.equal(dotNodes.filter((node) => node.meta?.kind === 'cell').length, 2, 'dots retain their existing nonzero mark geometry');
  const arcs = KV.layout({ chart: 'heatmap', variant: 'arc', encode: spec.encode, fields: { v: { format: 'percent' } }, data: [
    { r: '甲', c: 'a', v: 0 }, { r: '甲', c: 'b', v: 0.5 },
  ] }, { width: 268 });
  const arcNodes = flattenNodes(arcs.children);
  assert.equal(arcNodes.filter((node) => node.meta?.endpoint).length, 0, 'arc variant does not inherit the cells legend');
  assert.ok(arcNodes.some((node) => node.meta?.kind === 'arc-track'), 'arc keeps its original track geometry');
});

// 意图：长尾宽箱的密度很小也必须可见，不能被描边吞成空箱；零频数仍不画假柱。
test('histogram keeps sparse wide bins visible without inventing bars for empty bins', () => {
  const spec = { chart: 'histogram', encode: { lower: 'l', upper: 'u', count: 'n' }, data: [{ l: 0, u: 1, n: 400 }, { l: 1, u: 2, n: 0 }, { l: 2, u: 40, n: 1 }] };
  const bars = K.layout(spec, { width: 640 }).children.flatMap((node) => node.tag === 'g' ? node.children : [node]).filter((node) => node.tag === 'rect' && node.attrs.rx === 2);
  assert.equal(bars.length, 3);
  assert.ok(bars[2].attrs.height >= 3, 'sparse wide bin stays visible');
  assert.equal(bars[1].attrs.height, 0, 'empty bin has no bar');
  assert.equal(bars[0].attrs.y + bars[0].attrs.height, bars[2].attrs.y + bars[2].attrs.height, 'all bars share the zero baseline');
});

// 意图：华夫点阵、说明与图例共用同一左边并整体居中，点数按最大余数法分配且保留悬停读数。
test('waffle centers one shared column for dots, note and legend', () => {
  const spec = { chart: 'waffle', encode: { category: 'c', value: 'v' }, data: [{ c: 'A', v: 1 }, { c: 'B', v: 1 }, { c: 'C', v: 1 }] };
  for (const width of [324, 558, 1040]) {
    const scene = K.layout(spec, { width });
    const nodes = flattenNodes(scene.children);
    const dots = nodes.filter((node) => node.tag === 'circle' && node.meta?.kind === 'unit');
    assert.deepEqual(plain(['A', 'B', 'C'].map((c) => dots.filter((dot) => dot.meta.category === c).length)), [34, 33, 33]);
    const xs = [...new Set(dots.map((dot) => dot.attrs.cx))].sort((a, b) => a - b);
    const pitch = xs[1] - xs[0], gridLeft = xs[0] - pitch / 2;
    assert.equal(xs.length, 10);
    assert.ok(Math.abs((xs[0] + xs.at(-1)) / 2 - scene.width / 2) <= 1, `${width}: grid is centered`);
    const noteX = nodes.find((node) => node.tag === 'text' && /100/.test(node.text)).attrs.x;
    const legendX = Number(scene.children.find((node) => /translate/.test(node.attrs?.transform || '')).attrs.transform.match(/translate\(([\d.]+)/)[1]);
    assert.ok(Math.abs(noteX - gridLeft) <= 0.5 && Math.abs(legendX - gridLeft) <= 0.5, `${width}: note and legend share the grid edge`);
    assert.ok(nodes.some((node) => node.tag === 'title' && /A：33\.3%（34 点）/.test(node.text)));
  }
});

// 意图：数值跨数量级时刻度按轴长抽稀，相邻刻度文字不相交；长类别折行后行距大于字号。
test('bullet ticks separate when values span magnitudes and wrapped categories do not collide', () => {
  const spec = {
    chart: 'bullet',
    unit: '个',
    data: [
      { category: '小程序自提订单（含团购）', actual: 159, target: 150 },
      { category: '企业', actual: 10290000, target: 9267000 },
    ],
    encode: { category: 'category', actual: 'actual', target: 'target' },
  };
  const scene = K.layout(spec, { width: 360 });
  const ticks = scene.children.filter((node) => node.tag === 'text' && String(node.attrs.class || '').includes('chart-tick'));
  const ordered = ticks.map((node) => ({ x: Number(node.attrs.x), text: node.text })).sort((a, b) => a.x - b.x);
  assert.ok(ordered.every((tick, i) => i === 0 || tick.x - ordered[i - 1].x > Math.max(tick.text.length, ordered[i - 1].text.length) * 7), 'adjacent tick labels keep a gap larger than the wider label');
  const wrapped = K.layout({ ...spec, data: [{ category: 'Cross-border fulfilment from own warehouse', actual: 80, target: 100 }] }, { width: 280, lang: 'en' });
  const lines = wrapped.children.filter((node) => node.tag === 'text' && ['Cross-border', 'fulfilment', 'warehouse'].some((part) => node.text.includes(part)));
  const ys = [...new Set(lines.map((node) => Number(node.attrs.y)))].sort((a, b) => a - b);
  assert.ok(ys.length > 1 && ys[1] - ys[0] > 12, 'wrapped category lines are farther apart than the font size');
});

// 意图：斜率图两侧标签按折行后的实测高度错开，窄槽加高而不是把两行叠在同一行距上。
test('slope side labels separate by their wrapped height', () => {
  const spec = { chart: 'slope', encode: { category: 'c', before: 'b', after: 'a' }, data: [
    { c: 'North America enterprise accounts', b: 1, a: 2 },
    { c: 'Partner-led marketplace orders', b: 1.2, a: 2.2 },
  ] };
  const scene = K.layout(spec, { width: 360, lang: 'en' });
  const texts = flattenNodes(scene.children).filter((node) => node.tag === 'text' && node.attrs['text-anchor'] === 'end');
  const ys = texts.map((node) => Number(node.attrs.y)).sort((a, b) => a - b);
  assert.ok(ys.slice(1).every((y, i) => y - ys[i] >= 12), 'wrapped side lines keep at least one text line apart');
  const one = K.layout({ ...spec, data: spec.data.slice(0, 1) }, { width: 360, lang: 'en' });
  assert.ok(scene.height >= one.height, 'adding a second wrapped label never shortens the scene');
});

// 意图：瀑布柱顶读数按实测字宽分行，类别名按词折行，窄槽不再切成单字。
test('waterfall readouts dodge by measured width and category labels wrap by word', () => {
  const spec = { chart: 'waterfall', start: 0, encode: { category: 'c', delta: 'd' }, data: [
    { c: 'North America enterprise accounts', d: 120 },
    { c: 'Partner-led marketplace orders', d: -40 },
    { c: 'Self-serve annual renewals', d: 15 },
  ] };
  const scene = K.layout(spec, { width: 280, lang: 'en' });
  const texts = flattenNodes(scene.children).filter((node) => node.tag === 'text');
  const readouts = texts.filter((node) => node.meta?.kind?.startsWith('waterfall-'));
  const boxes = readouts.map((node) => ({ x: Number(node.attrs.x), y: Number(node.attrs.y), w: node.text.length * 7 }));
  for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
    const apart = Math.abs(boxes[i].y - boxes[j].y) >= 12 || Math.abs(boxes[i].x - boxes[j].x) >= (boxes[i].w + boxes[j].w) / 2;
    assert.ok(apart, 'adjacent waterfall readouts do not share both axes');
  }
  assert.ok(readouts.every((node) => node.attrs.y >= 12), 'readouts stay inside the reserved top band');
  assert.ok(texts.some((node) => node.text.split(/\s+/).every((word) => word.length > 1) && /America|Partner|Self/.test(node.text)), 'category labels wrap on a word, not a character');
});

// 意图：直方图箱边界首尾贴边，场景宽等于给定宽；注释字色随参考线底色而不是固定灰色。
test('histogram edge labels stay inside the given width and annotations follow their underlay', () => {
  const spec = { chart: 'histogram', encode: { lower: 'l', upper: 'u', count: 'n' }, annotations: [
    { kind: 'rule', field: 'l', value: 5, label: 'median' },
  ], data: [{ l: 0, u: 10, n: 4 }, { l: 10, u: 10000000, n: 1 }] };
  const scene = K.layout(spec, { width: 324, theme: 'terminal' });
  assert.equal(scene.width, 324, 'content that fits keeps the given scene width');
  const edges = flattenNodes(scene.children).filter((node) => node.tag === 'text' && Number(node.attrs.y) > 260 && Number(node.attrs.y) < 290);
  assert.ok(edges.every((node) => {
    const width = node.text.length * 7;
    const x = Number(node.attrs.x);
    const anchor = node.attrs['text-anchor'];
    const left = anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x;
    return left >= -0.5 && left + width <= scene.width + 0.5;
  }), 'terminal edge labels remain inside the scene');
  const note = flattenNodes(scene.children).find((node) => node.text === 'median');
  assert.notEqual(note.attrs.fill, K.util.context({ spec, theme: 'terminal' }).palette.muted);
});

// 意图：散点轴题、刻度和参考线标签分占不同垂直带，长注释折进绘图区。
test('scatter axis title, ticks and reference labels occupy separate bands', () => {
  const spec = { chart: 'scatter', encode: { x: 'x', y: 'y', id: 'id' }, annotations: [
    { kind: 'rule', field: 'y', value: 2, label: 'Revenue kept growing across every reported quarter' },
    { kind: 'note', record: 'a', field: 'y', text: 'North America enterprise accounts' },
  ], data: [{ id: 'a', x: 1, y: 2 }, { id: 'b', x: 8, y: 9 }] };
  const scene = K.layout(spec, { width: 320, lang: 'en' });
  const texts = flattenNodes(scene.children).filter((node) => node.tag === 'text');
  const title = texts.find((node) => node.meta?.kind === 'axis-title' && node.meta.axis === 'y');
  const ticks = texts.filter((node) => /^\d/.test(node.text) && Number(node.attrs.y) > Number(title.attrs.y));
  assert.ok(ticks.every((node) => Number(node.attrs.y) >= Number(title.attrs.y) + 16), 'axis title does not sit on a tick');
  const xTitle = texts.find((node) => node.meta?.kind === 'axis-title' && node.meta.axis === 'x');
  assert.ok(texts.filter((node) => /^\d/.test(node.text)).every((node) => Number(xTitle.attrs.y) >= Number(node.attrs.y) + 16 || Number(node.attrs.y) < Number(xTitle.attrs.y) - 16), 'x-axis title does not sit on a tick');
  assert.ok(texts.some((node) => node.text.startsWith('Revenue')) && texts.filter((node) => /Revenue|growing|quarter/.test(node.text)).every((node) => node.text.length > 1), 'long reference labels wrap by word');
  assert.ok(texts.every((node) => Number(node.attrs.x) >= 0 && Number(node.attrs.x) <= scene.width), 'wrapped notes stay inside the scene');
  // 末个刻度被拉回画布内后，不能压到前一个刻度标签；首尾刻度仍保留。
  const crowded = { chart: 'scatter', encode: { x: 'x', y: 'y', size: 'size' }, data: [[1600, 260, 4], [2400, 480, 6], [3200, 640, 8], [4100, 820, 9]].map(([x, y, size]) => ({ x, y, size })) };
  const context = K.util.context({ spec: crowded, width: 360 });
  const crowdedScene = K.layout(crowded, { width: 360 });
  const bottomTicks = flattenNodes(crowdedScene.children).filter((node) => node.tag === 'text' && /^\d,\d{3}$/.test(node.text));
  const xRow = bottomTicks.filter((node) => node.attrs.y === Math.max(...bottomTicks.map((tick) => tick.attrs.y))).sort((a, b) => a.attrs.x - b.attrs.x);
  assert.ok(xRow.length >= 3);
  for (let i = 1; i < xRow.length; i++) {
    const gap = (xRow[i].attrs.x - context.measure(xRow[i].text, 12) / 2) - (xRow[i - 1].attrs.x + context.measure(xRow[i - 1].text, 12) / 2);
    assert.ok(gap >= 8, `x tick labels ${xRow[i - 1].text} and ${xRow[i].text} keep a gap (${gap})`);
  }
});

// 意图：末点读数按测得宽度留在标记右侧，面板标题最多换两行且不截成单行。
test('sparkline and small-multiple readouts reserve measured width beside the mark', () => {
  const spark = K.layout({ chart: 'sparkline', encode: { category: 'c', value: 'v' }, data: [{ c: 'East', v: 94550000 }, { c: 'West', v: 1200 }], fields: { v: { format: 'percent' } } }, { width: 360 });
  const sparkText = flattenNodes(spark.children).find((node) => node.meta?.kind === 'value');
  const sparkDot = flattenNodes(spark.children).filter((node) => node.tag === 'circle').at(-1);
  assert.ok(Number(sparkText.attrs.x) > Number(sparkDot.attrs.cx) + Number(sparkDot.attrs.r), 'sparkline readout starts after its end dot');
  assert.ok(spark.width >= Number(sparkText.attrs.x) + [...sparkText.text].length * 7, 'scene reserves the measured readout');
  assert.equal(spark.overflow, undefined);
  const panels = K.layout({ chart: 'small-multiples', encode: { category: 'c', value: ['p1', 'p2'] }, data: [{ c: 'A', p1: 1, p2: 2 }, { c: 'B', p1: 3, p2: 4 }], fields: { p1: { label: 'First-time buyers with a completed order', unit: '件' }, p2: { label: 'University and research procurement', unit: '件' } } }, { width: 280 });
  const titles = flattenNodes(panels.children).filter((node) => node.meta?.kind === 'panel');
  assert.ok(new Set(titles.map((node) => node.meta.label)).size === 2, 'each panel keeps its own title');
  assert.ok([...titles.reduce((map, node) => map.set(node.meta.label, (map.get(node.meta.label) || 0) + 1), new Map()).values()].every((count) => count <= 2), 'panel titles wrap to at most two lines');
  const readout = flattenNodes(panels.children).find((node) => node.meta?.kind === 'value');
  const dot = flattenNodes(panels.children).filter((node) => node.tag === 'circle').at(-1);
  assert.ok(Number(readout.attrs.x) > Number(dot.attrs.cx) + Number(dot.attrs.r), 'panel readout is beside the end mark, not on it');
});

// 意图：带单位的迷你趋势在容器放得下时场景恰好等于容器宽度；风险是右侧留白与场景宽度各算各的，
// 读数宽于 28px 时场景多出 4px，容器里产生无意义的横向滚动。
test('a sparkline with a wide readout fills its container exactly', () => {
  const spec = { chart: 'sparkline', encode: { category: 'c', value: 'v' }, fields: { v: { unit: '件' } }, data: [{ c: '2026-01', v: 18 }, { c: '2026-02', v: 12 }, { c: '2026-03', v: 1600 }] };
  for (const width of [268, 502, 984]) {
    const scene = K.layout(spec, { width });
    const measure = K.util.context({ spec, width }).measure;
    const readout = flattenNodes(scene.children).find((node) => node.meta?.kind === 'value');
    assert.ok(measure(readout.text, 12, 700) >= 28, 'the readout is wide enough to exercise the reserved budget');
    assert.equal(scene.width, width, `scene width equals the ${width}px container`);
    assert.ok(Number(readout.attrs.x) + measure(readout.text, 12, 700) <= width - 8 + 0.5, 'readout keeps its right margin inside the scene');
  }
});

// 意图：boxplot与dumbbell共用横向数轴时，测量相邻标签而非只看最宽标签，窄屏抽稀仍不相交。
test('boxplot and dumbbell horizontal tick labels keep measured separation', () => {
  const examples = [
    { chart: 'dumbbell', encode: { category: 'c', before: 'b', after: 'a' }, data: [{ c: 'A', b: 1000000, a: 1200000 }] },
    { chart: 'boxplot', encode: { category: 'c', low: 'l', q1: 'q1', median: 'm', q3: 'q3', high: 'h' }, data: [{ c: 'A', l: 1000000, q1: 1100000, m: 1200000, q3: 1300000, h: 1400000 }] },
  ];
  for (const spec of examples) {
    const scene = K.layout(spec, { width: 240 });
    const measure = K.util.context({ spec, width: 240 }).measure;
    const ticks = scene.children.filter((node) => node.tag === 'text' && String(node.attrs.class || '').includes('chart-tick'))
      .map((node) => ({ x: Number(node.attrs.x), width: measure(node.text, 12, 400) })).sort((a, b) => a.x - b.x);
    assert.ok(ticks.length >= 2, `${spec.chart}: retains useful horizontal ticks`);
    assert.ok(ticks.slice(1).every((tick, index) => tick.x - ticks[index].x >= (tick.width + ticks[index].width) / 2 + 8), `${spec.chart}: adjacent ticks do not overlap`);
  }
});

// 意图：small-multiples标题预留末点读数宽度，首末长类别名换行并留在当前面板列内。
test('small-multiple titles and endpoint categories stay within their own panel', () => {
  const spec = {
    chart: 'small-multiples', encode: { category: 'c', value: ['p1', 'p2'] },
    fields: { p1: { label: 'University and research procurement' }, p2: { label: 'Self-serve annual renewals (net)' } },
    data: [
      { c: 'University and research procurement', p1: 1, p2: 2 },
      { c: 'Self-serve annual renewals (net) 120', p1: 3, p2: 4 },
    ],
  };
  const scene = K.layout(spec, { width: 768, lang: 'en' });
  const nodes = flattenNodes(scene.children).filter((node) => node.tag === 'text');
  const measure = K.util.context({ spec, width: 768, lang: 'en' }).measure;
  const panelWidth = scene.width / 2;
  const titles = nodes.filter((node) => node.attrs.class === 'chart-label');
  const readouts = nodes.filter((node) => String(node.attrs.class || '').includes('chart-value'));
  for (const title of titles) {
    const panel = Math.floor(Number(title.attrs.x) / panelWidth);
    const readout = readouts.find((node) => Math.floor((Number(node.attrs.x) - measure(node.text, 13, 700)) / panelWidth) === panel && Math.abs(Number(node.attrs.y) - Number(title.attrs.y)) < 1);
    if (readout) assert.ok(Number(title.attrs.x) + measure(title.text, 12, 400) <= Number(readout.attrs.x) - measure(readout.text, 13, 700) + 1, 'panel title ends before its value readout');
  }
  for (const node of nodes.filter((item) => /University|research|Self-serve|annual|renewals|120/.test(item.text) && item.attrs.class === 'chart-label' && Number(item.attrs.y) > 80)) {
    const width = measure(node.text, 12, 400), x = Number(node.attrs.x), anchor = node.attrs['text-anchor'];
    const left = anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x;
    const right = left + width, panel = Math.floor((left + right) / 2 / panelWidth);
    assert.ok(left >= panel * panelWidth && right <= (panel + 1) * panelWidth, `${node.text} stays within panel ${panel}`);
  }
  assert.ok(nodes.some((node) => /Self-serve/.test(node.text)), 'last category remains present after wrapping');
});

// 意图：散点笔记贴在所指点旁、参考线标签贴在线旁，归属不靠猜；两者不压在数据点或彼此上。
test('scatter annotations sit next to the point or rule they describe', () => {
  const spec = { chart: 'scatter', encode: { x: 'x', y: 'y', id: 'id' }, annotations: [
    { kind: 'rule', field: 'y', value: 5, label: 'Target' },
    { kind: 'note', record: 'b', field: 'y', text: 'Peak week' },
  ], data: [{ id: 'a', x: 1, y: 2 }, { id: 'b', x: 5, y: 8 }, { id: 'c', x: 9, y: 4 }] };
  const scene = K.layout(spec, { width: 480, lang: 'en' });
  const nodes = flattenNodes(scene.children);
  const measure = K.util.context({ spec, width: 480, lang: 'en' }).measure;
  const box = (node) => {
    const width = measure(node.text, 12, 400), x = Number(node.attrs.x), y = Number(node.attrs.y), anchor = node.attrs['text-anchor'];
    const x0 = anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x;
    return { x0, x1: x0 + width, y0: y - 12, y1: y + 4 };
  };
  const circles = nodes.filter((node) => node.tag === 'circle').map((node) => ({ cx: Number(node.attrs.cx), cy: Number(node.attrs.cy), r: Number(node.attrs.r) }));
  const peak = circles.find((circle) => circle.cy === Math.min(...circles.map((item) => item.cy)));
  const note = box(nodes.find((node) => node.text === 'Peak week'));
  const distance = Math.hypot(Math.max(note.x0 - peak.cx, 0, peak.cx - note.x1), Math.max(note.y0 - peak.cy, 0, peak.cy - note.y1));
  assert.ok(distance <= peak.r + 8, `the note is within a few pixels of its point, got ${distance}`);
  const rule = nodes.find((node) => node.tag === 'line' && node.attrs['stroke-dasharray']);
  const label = box(nodes.find((node) => node.text === 'Target'));
  assert.ok(Math.min(Math.abs(label.y1 - Number(rule.attrs.y1)), Math.abs(label.y0 - Number(rule.attrs.y1))) <= 6, 'the rule label touches its rule');
  const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  assert.ok(!hit(note, label), 'annotation labels do not overlap');
  assert.ok(circles.every((c) => ![note, label].some((b) => hit(b, { x0: c.cx - c.r, x1: c.cx + c.r, y0: c.cy - c.r, y1: c.cy + c.r }))), 'labels do not cover points');
});

// 意图：声明 label 的少量散点在静态图里就能认出是哪个点；点名贴着自己的点，不压任何点或彼此，
// 也不会离别的点更近而被认错；垂线变体的点名不压别的点的垂线。
test('labelled scatter points name themselves beside their own mark', () => {
  for (const variant of ['dots', 'plumb']) labelledScatter(variant);
});
function labelledScatter(variant) {
  const rows = [['Harbour', 18, 1720, 'inner'], ['Old Town', 15, 1850, 'inner'], ['Riverside', 22, 1580, 'inner'], ['University', 20, 1490, 'inner'], ['Station', 12, 1940, 'inner'],
    ['Hillcrest', 34, 1210, 'outer'], ['Meadowfield', 41, 1040, 'outer'], ['Northgate', 29, 1330, 'outer'], ['Lakeview', 38, 1150, 'outer'], ['Ironworks', 45, 960, 'outer']];
  const spec = { chart: 'scatter', variant, data: rows.map(([name, commute, rent, group]) => ({ name, commute, rent, group })),
    encode: { x: 'commute', y: 'rent', series: 'group', label: 'name' }, fields: { commute: { unit: 'min' }, rent: { unit: 'EUR' } } };
  for (const width of [324, 558, 984]) {
    const scene = K.layout(spec, { width, lang: 'en' });
    const measure = K.util.context({ spec, width, lang: 'en' }).measure;
    const nodes = flattenNodes(scene.children);
    const dots = nodes.filter((node) => node.tag === 'circle' && Number(node.attrs.r) >= 5).map((node) => ({ cx: Number(node.attrs.cx), cy: Number(node.attrs.cy), r: Number(node.attrs.r) }));
    const labels = nodes.filter((node) => node.meta?.kind === 'point-label').map((node) => {
      const w = measure(node.text, 12, 400), x = Number(node.attrs.x), y = Number(node.attrs.y), anchor = node.attrs['text-anchor'];
      const x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
      return { text: node.text, x0, x1: x0 + w, y0: y - 12, y1: y + 3, cx: node.meta.cx, cy: node.meta.cy };
    });
    // 垂线会挡住邻点一侧的空位；宁可只在悬停提示里给名字，也不压线或让人认错。
    if (width >= 558 && variant === 'dots') assert.equal(labels.length, rows.length, `${variant} ${width}px: every point is named`);
    else assert.ok(labels.length >= rows.length / 2, `${variant} ${width}px: most points are named`);
    const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    for (const label of labels) {
      const row = spec.data.find((item) => item.name === label.text);
      const own = dots.find((dot) => Math.abs(dot.cx - label.cx) < .01 && Math.abs(dot.cy - label.cy) < .01);
      assert.ok(row && own, `${label.text} names a drawn point`);
      const gap = Math.hypot(Math.max(label.x0 - own.cx, 0, own.cx - label.x1), Math.max(label.y0 - own.cy, 0, own.cy - label.y1));
      assert.ok(gap <= own.r + 6, `${width}px: ${label.text} sits beside its point`);
      assert.ok(dots.every((dot) => !hit(label, { x0: dot.cx - dot.r, x1: dot.cx + dot.r, y0: dot.cy - dot.r, y1: dot.cy + dot.r })), `${width}px: ${label.text} covers no point`);
      const glyphs = { x0: label.x0, x1: label.x1, y0: label.y1 - 13, y1: label.y1 - 2 };
      const gapTo = (dot) => Math.hypot(Math.max(glyphs.x0 - dot.cx, 0, dot.cx - glyphs.x1), Math.max(glyphs.y0 - dot.cy, 0, dot.cy - glyphs.y1)) - dot.r;
      for (const dot of dots) if (dot !== own) assert.ok(gapTo(dot) > gapTo(own), `${variant} ${width}px: ${label.text} is closer to another point than to its own`);
      if (variant === 'plumb') for (const dot of dots) if (dot !== own) assert.ok(!(label.x0 < dot.cx && dot.cx < label.x1 && label.y1 > dot.cy + dot.r), `${width}px: ${label.text} crosses another point's plumb line`);
    }
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) assert.ok(!hit(labels[i], labels[j]), `${width}px: ${labels[i].text} and ${labels[j].text} do not overlap`);
  }
}

// 意图：直方图参考线标签写在绘图区上方、对齐自己的参考线，虚线延伸到标签；边界刻度按实际对齐方式判断拥挤，相邻不相交。
test('histogram rule labels align with their rule and bin edges never overlap', () => {
  const spec = { chart: 'histogram', encode: { lower: 'l', upper: 'u', count: 'n' }, annotations: [
    { kind: 'rule', field: 'l', value: 20, label: 'median' },
    { kind: 'rule', field: 'l', value: 21, label: 'mean' },
  ], data: Array.from({ length: 12 }, (_, i) => ({ l: i * 3.5061, u: (i + 1) * 3.5061, n: 3 + (i % 4) })) };
  const scene = K.layout(spec, { width: 300, lang: 'en' });
  const nodes = flattenNodes(scene.children);
  const measure = K.util.context({ spec, width: 300, lang: 'en' }).measure;
  const rules = nodes.filter((node) => node.tag === 'line' && node.attrs['stroke-dasharray']);
  const labels = ['median', 'mean'].map((text) => nodes.find((node) => node.text === text));
  labels.forEach((label, i) => {
    assert.equal(label.attrs['text-anchor'], 'middle');
    assert.ok(Math.abs(Number(label.attrs.x) - Number(rules[i].attrs.x1)) <= measure(label.text, 12, 400) / 2, `${label.text} sits over its rule`);
    assert.ok(Number(rules[i].attrs.y1) - Number(label.attrs.y) <= 8, `${label.text}: the rule reaches up to its label`);
  });
  assert.notEqual(labels[0].attrs.y, labels[1].attrs.y, 'labels of nearby rules take separate lanes');
  const edges = nodes.filter((node) => node.tag === 'text' && /^\d/.test(node.text) && Number(node.attrs.y) > Math.max(...rules.map((rule) => Number(rule.attrs.y2))))
    .map((node) => {
      const width = measure(node.text, 12, 400), x = Number(node.attrs.x), anchor = node.attrs['text-anchor'];
      return anchor === 'end' ? [x - width, x] : anchor === 'middle' ? [x - width / 2, x + width / 2] : [x, x + width];
    }).sort((a, b) => a[0] - b[0]);
  assert.ok(edges.length >= 2 && edges.slice(1).every((edge, i) => edge[0] >= edges[i][1] + 8), JSON.stringify(edges));
});

// 意图：小倍数图首末时点放得下时写在基线下同一行，不无故错行。
test('small-multiples keep short first and last categories on one baseline', () => {
  const spec = { chart: 'small-multiples', encode: { category: 'm', value: ['a', 'b'] }, data: ['2026-01', '2026-02', '2026-03', '2026-04'].map((m, i) => ({ m, a: 10 + i, b: 20 - i })) };
  const scene = K.layout(spec, { width: 558 });
  const nodes = flattenNodes(scene.children).filter((node) => node.tag === 'text');
  const first = nodes.filter((node) => node.text === '2026-01'), last = nodes.filter((node) => node.text === '2026-04');
  assert.ok(first.length === 2 && last.length === 2);
  first.forEach((node, i) => assert.equal(node.attrs.y, last[i].attrs.y));
});

test('dumbbell comparison marks and readings remain legible in all themes', () => {
  // 比较线是数据标记而非网格线，端点读数按小字的对比度门槛检查。
  const spec = cases.find(item => item.chart === 'dumbbell' && !item.fields);
  for (const theme of THEMES) {
    const { palette } = K.util.context({ theme, spec });
    const nodes = flattenNodes(K.layout(spec, { theme }).children);
    const link = nodes.find(node => node.tag === 'line' && node.attrs.class === 'chart-link');
    assert.ok(K.util.contrast(link.attrs.stroke, palette.bg) >= 3, `${theme} comparison line`);
    const labels = nodes.filter(node => node.meta?.kind === 'endpoint-readout');
    assert.equal(labels.length, 2);
    assert.ok(labels.every(node => K.util.contrast(node.attrs.fill, palette.bg) >= 4.5), `${theme} endpoint labels`);
  }
});

// 意图：哑铃图端点读数居中对齐端点，靠近绘图区左端时夹在绘图区内，不伸进类别名列。
test('dumbbell endpoint readouts stay inside the plot area', () => {
  const spec = { chart: 'dumbbell', encode: { category: 'c', before: 'b', after: 'a' }, data: [
    { c: '企业客户年付续费 7', b: 22.79, a: 49.0341 }, { c: '高校与科研机构采购合同', b: 980.7, a: 1060.38 },
  ] };
  const scene = K.layout(spec, { width: 240 });
  const measure = K.util.context({ spec, width: 240 }).measure;
  const nodes = flattenNodes(scene.children);
  const plotLeft = Math.min(...nodes.filter((node) => node.tag === 'line' && node.attrs.x1 === node.attrs.x2 && Number(node.attrs.y2) > Number(node.attrs.y1)).map((node) => Number(node.attrs.x1)));
  const readouts = nodes.filter((node) => node.meta?.kind === 'endpoint-readout');
  assert.equal(readouts.length, 4);
  assert.ok(readouts.every((node) => Number(node.attrs.x) - measure(node.text, 12, 600) / 2 >= plotLeft - 0.5), 'no readout reaches into the category column');
});

// 意图：中文禁则移动标点后，长标签仍要留在自己的栏内，不能靠场景外扩容纳。
test('窄屏对比图在实际标签栏中完整排下带标点的长中文名称', () => {
  const names = [
    '高级订阅客户的月费（不含税）', '亚太区代理商的续约收入（已审计）',
    '跨境零售（含团购配送）', '线上自提订单（含团购） 4',
    '仓储与配送联合项目（试点）', '续费客户（含合作伙伴）', '企业客户的新年度规划（含培训）',
  ];
  const data = names.map((name, i) => ({ name, before: i + 12, after: i + 20 }));
  const measure = (text, size = 12) => [...text].reduce((width, ch) => (
    width + (/[^\u0020-\u007f]/.test(ch) ? size : size / 2)
  ), 0);
  for (const [chart, width] of [['bullet', 268], ['dumbbell', 268], ['slope', 300]]) {
    const roles = chart === 'bullet' ? { actual: 'after', target: 'before' } : { before: 'before', after: 'after' };
    const scene = K.layout({ chart, data, encode: { category: 'name', ...roles }, unit: '件' }, { width, measure });
    assert.equal(scene.overflow, undefined, `${chart}: 不触发事后平移和扩宽`);
    if (chart !== 'bullet') assert.equal(scene.width, width, `${chart}: 可以容纳时恰好等于容器`);
    const categoryLabels = scene.children.filter((node) => node.tag === 'text' && node.attrs.class === 'chart-label'
      && node.attrs['text-anchor'] === 'end' && node.attrs.x < scene.width / 2);
    assert.ok(categoryLabels.length > names.length, `${chart}: 标签确实折行`);
    for (const node of categoryLabels) {
      assert.ok(node.attrs.x - measure(node.text) >= 3.5, `${chart}: 左边距足够`);
      assert.equal(node.attrs['font-size'], 12);
      assert.doesNotMatch(node.text, /^[）。，]/);
    }
    const labelText = categoryLabels.map((node) => node.text).join('').replaceAll(' ', '');
    for (const name of names) assert.ok(labelText.includes(name.replaceAll(' ', '')), `${chart}: ${name} 未丢字`);
  }
});

// 意图：端点的读数可以单独占一行，但空间足够时不能把数字和单位拆开。
test('斜率图保持端点读数及其单位同一行', () => {
  const data = ['跨境配送部门（新流程）', '直营营业部及区域伙伴', '线下自提订单（含团购）', '新注册且完成首单的用户']
    .map((name) => ({ name, before: 375.1, after: 375.1 }));
  const measure = (text, size = 12) => [...text].reduce((width, ch) => (
    width + (/[^\u0020-\u007f]/.test(ch) ? size : size / 2)
  ), 0);
  const { width, children } = K.layout({
    chart: 'slope', data, unit: 'ms', encode: { category: 'name', before: 'before', after: 'after' },
  }, { width: 240, measure });
  assert.equal(width, 240);
  const labels = children.filter((node) => node.tag === 'text' && node.attrs.class === 'chart-label');
  assert.equal(labels.filter(({ text }) => text.includes('375.1 ms')).length, data.length * 2);
});

// 意图：缺失值断线后，非极值且不是末点的孤立记录也必须以点保留。
test('趋势图对缺失值断线，但保留没有相邻线段的观测', () => {
  const values = [1, 2, null, 3, null, 4, 5, 6, 7, 8, 9, 10, 11];
  const data = values.map((value, i) => ({ date: `Day ${i + 1}`, value }));
  for (const [chart, value] of [['sparkline', 'value'], ['small-multiples', ['value']]]) {
    const { children } = K.layout({ chart, data, encode: { category: 'date', value } }, { width: 268, lang: 'en' });
    const nodes = flattenNodes(children);
    const marks = nodes.filter((node) => node.tag === 'title').map((node) => node.text);
    const lines = nodes.filter((node) => node.tag === 'path' && /chart-line/.test(node.attrs.class || ''));
    assert.equal(lines.length, 2, `${chart}: 两段折线不跨过缺档`);
    assert.ok(marks.includes('Day 4: 3'), `${chart}: 单独的第 4 天保留成圆点`);
    assert.ok(!marks.some((label) => /^Day [35]:/.test(label)), `${chart}: 第 3、5 天没有观测`);
  }
});

// 意图：ESM 统计图无需宿主全局；未安装的图族返回诊断，不渲染假图。
test('statistics uses only declared modules and rejects an absent layout', () => {
  assert.equal(`${typeof globalThis.HtmlChart}:${typeof globalThis.HtmlDiagram}`, 'undefined:undefined');
  const { api } = loadChart([installBasic]);
  const { scene, svg, diagnostics } = api.render(cases[0]);
  assert.equal(scene, null);
  assert.equal(svg, null);
  assert.equal(diagnostics[0].code, 'BAD_KCHART');
  assert.match(diagnostics[0].message, /sparkline/);
});

// 意图：箱线图没有逐行读数，数值轴单位写在刻度下方右端，并计入场景高度。
test('boxplot names the unit of its value axis below the ticks', () => {
  const flat = (list) => list.flatMap((node) => [node, ...flat(node.children || [])]);
  const spec = { chart: 'boxplot', unit: 'min', data: [{ c: 'A', lo: 1, q1: 2, m: 3, q3: 4, hi: 5 }, { c: 'B', lo: 2, q1: 3, m: 4, q3: 6, hi: 8 }], encode: { category: 'c', low: 'lo', q1: 'q1', median: 'm', q3: 'q3', high: 'hi' } };
  const scene = K.layout(spec, { width: 360 });
  const unit = flat(scene.children).filter((node) => node.meta?.kind === 'axis-unit');
  assert.deepEqual(plain(unit.map((node) => node.text)), ['min']);
  const ticks = flat(scene.children).filter((node) => node.tag === 'text' && /^\d+$/.test(node.text));
  assert.ok(unit[0].attrs.y >= Math.max(...ticks.map((node) => node.attrs.y)) + 14 && unit[0].attrs.y <= scene.height - 4, 'unit row sits below the ticks inside the scene');
  const bare = K.layout({ ...spec, unit: undefined }, { width: 360 });
  assert.equal(flat(bare.children).filter((node) => node.meta?.kind === 'axis-unit').length, 0, 'no unit, no caption');
});
