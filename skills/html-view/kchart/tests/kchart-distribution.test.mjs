import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadChart } from './kchart-fixture.mjs';

const { api: K } = loadChart(['chart/distribution']);
const plain = (value) => JSON.parse(JSON.stringify(value));
const specs = {
  interval: {
    chart: 'interval', title: 'External title', subtitle: '95% CI', source: 'External source', note: 'External note',
    data: [{ group: 'B', low: 2, high: 8, point: 5, id: 'b' }, { group: 'A', low: 1, high: 6, point: 3, id: 'a' }],
    encode: { category: 'group', low: 'low', high: 'high', value: 'point', id: 'id' },
    fields: { group: { domain: ['A', 'B'] } }, unit: 'kg',
    annotations: [
      { kind: 'rule', field: 'high', value: 50, label: 'threshold' },
      { kind: 'band', field: 'high', from: 60, to: 70, label: 'range' },
      { kind: 'note', record: 'b', field: 'low', text: 'review record' },
    ],
  },
  candlestick: { chart: 'candlestick', data: [
    { day: 'Mon', open: 3, close: 7, low: 2, high: 8, id: 'up' },
    { day: 'Tue', open: 8, close: 4, low: 3, high: 9, id: 'down' },
    { day: 'Wed', open: 5, close: 5, low: 3, high: 9, id: 'flat' },
  ], encode: { category: 'day', open: 'open', close: 'close', low: 'low', high: 'high', id: 'id' } },
  strip: { chart: 'strip', data: [{ group: 'A', score: 4, id: 'x' }, { group: 'A', score: 4, id: 'y' }, { group: 'B', score: 8, id: 'z' }], encode: { category: 'group', value: 'score', id: 'id' } },
  violin: { chart: 'violin', subtitle: 'precomputed density', data: [
    { group: 'A', densityData: [[0, 1], [2, 4], [4, 2]], med: 2 },
    { group: 'B', densityData: [[1, 2], [3, 1], [5, 3]], med: 3 },
  ], encode: { category: 'group', density: 'densityData', median: 'med' }, unit: 'kg' },
};
const texts = (nodes) => nodes.flatMap((node) => [node.text, ...texts(node.children || [])].filter((value) => value != null));
const textNodes = (nodes) => nodes.flatMap((node) => [node, ...textNodes(node.children || [])]);

// 意图：每种分布图型都必须通过真实DSL校验产出纯场景；覆盖外壳文案不重复、尺寸、单位读数和身份语义。
test('distribution charts validate and produce semantic pure scenes', () => {
  for (const [chart, spec] of Object.entries(specs)) {
    assert.deepEqual(plain(K.validate(spec).errors), [], `${chart} fixture conforms to DSL`);
    const { scene, svg } = K.render(spec, { width: 640, lang: 'en' });
    assert.equal(scene.width, 640);
    assert.ok(scene.height > 300);
    assert.match(svg, /^<svg/);
    assert.match(svg, /role="img"/);
    assert.match(svg, /data-kc-/);
    assert.ok(scene.children.some((child) => ['line', 'circle', 'rect', 'polygon'].includes(child.tag)));
    const tooSmall = textNodes(scene.children).filter((child) => child.tag === 'text' && Number(child.attrs['font-size']) < 12);
    assert.equal(tooSmall.length, 0, `${chart} uses readable 12px minimum text`);
  }
  const intervals = K.layout(specs.interval);
  const intervalTexts = texts(intervals.children);
  assert.ok(intervals.children.some((child) => child.meta?.kind === 'estimate' && child.meta.value === 5));
  assert.ok(intervals.children.some((child) => child.meta?.kind === 'annotation-note' && child.meta.id === 'b'));
  assert.ok(intervalTexts.some((value) => value === 'B: 2 kg – 8 kg · 5 kg'));
  assert.ok(intervalTexts.some((value) => value === 'A: 1 kg – 6 kg · 3 kg'));
  assert.deepEqual(plain(textNodes(intervals.children).filter((child) => child.meta?.kind === 'interval-readout').map((child) => child.meta)), [
    { kind: 'interval-readout', record: 0, id: 'b', value: { low: 2, high: 8, estimate: 5 } },
    { kind: 'interval-readout', record: 1, id: 'a', value: { low: 1, high: 6, estimate: 3 } },
  ]);
  assert.ok(!intervalTexts.some((value) => ['External title', '95% CI', 'External source', 'External note'].includes(value)));
  const band = intervals.children.find((child) => child.tag === 'rect' && child.attrs['fill-opacity'] === 0.12);
  assert.ok(band && band.attrs.y >= 48 && Number(band.attrs.y) + Number(band.attrs.height) <= 318, 'annotation high bounds participate in the plotted domain');
  const intervalMarks = intervals.children.filter((child) => child.meta?.kind === 'interval');
  assert.ok(intervalMarks[0].attrs.x1 > intervalMarks[1].attrs.x1, 'explicit category domain controls order rather than data row order');

  const candles = K.layout(specs.candlestick).children.filter((child) => child.meta?.kind === 'candlestick');
  assert.deepEqual(plain(candles.map((child) => child.meta.value.direction)), ['up', 'down', 'up']);
  assert.equal(candles[0].attrs.fill, '#f5f4ed');
  assert.equal(candles[1].attrs.fill, '#2a2621');
  assert.equal(candles[2].tag, 'line', 'unchanged open/close uses a horizontal line, not a fabricated body');
  assert.equal(candles[2].attrs.y1, candles[2].attrs.y2);
  const candleLabels = texts(K.layout(specs.candlestick, { lang: 'en' }).children);
  assert.ok(candleLabels.some((value) => value.includes('Rising')) && candleLabels.some((value) => value.includes('Falling')) && candleLabels.some((value) => value.includes('Unchanged')), 'legend distinguishes each direction and flat candles use a line mark');
  const upOnly = { ...specs.candlestick, data: specs.candlestick.data.slice(0, 1) };
  const upLegendText = texts(K.layout(upOnly, { lang: 'en' }).children);
  assert.ok(upLegendText.some((value) => value.includes('Rising')) && !upLegendText.some((value) => value.includes('Falling')), 'legend does not advertise a falling style absent from the chart');
});

// 意图：公共violin密度尺度、主题对比底色、确定性strip抖动及类别cell边界须由实际几何保证。
test('violin and strip use comparable and bounded deterministic geometry', () => {
  const violin = K.layout(specs.violin);
  const shapes = violin.children.filter((child) => child.meta?.kind === 'violin');
  assert.equal(shapes.length, 2);
  const xs = shapes.map((shape) => shape.attrs.points.split(' ').map((point) => Number(point.split(',')[0])));
  const widths = xs.map((points) => Math.max(...points) - Math.min(...points));
  assert.ok(widths[0] > widths[1]);
  const smoothDensity = Array.from({ length: 17 }, (_, i) => [i / 2, Math.exp(-((i - 8) ** 2) / 18)]);
  const sampledViolin = K.layout({ ...specs.violin, data: [{ group: 'Dense', densityData: smoothDensity, med: 4 }] }).children.find((child) => child.meta?.kind === 'violin');
  assert.equal(sampledViolin.attrs.points.split(' ').length, 34, 'all 17 density samples contribute to both sides of a symmetric violin');
  assert.equal(xs[0].length, 6);
  assert.equal(shapes[0].attrs.fill, '#f5f4ed');
  assert.equal(shapes[0].attrs.stroke, '#2a2621');
  const one = K.layout(specs.strip).children.filter((child) => child.meta?.kind === 'strip');
  const two = K.layout(specs.strip).children.filter((child) => child.meta?.kind === 'strip');
  assert.deepEqual(plain(one.map((child) => child.attrs.cx)), plain(two.map((child) => child.attrs.cx)));
  assert.equal(one.length, 3, 'equal-valued observations remain separate points');
  assert.notEqual(one[0].attrs.cx, one[1].attrs.cx);
  const axis = K.layout(specs.strip).children.find((child) => child.tag === 'line' && child.attrs.x1 === child.attrs.x2);
  const baseline = K.layout(specs.strip).children.find((child) => child.tag === 'line' && child.attrs.y1 === child.attrs.y2 && child.attrs.y1 > 300);
  const slot = (baseline.attrs.x2 - axis.attrs.x1) / 2;
  const center = axis.attrs.x1 + slot / 2;
  for (const point of one.slice(0, 2)) assert.ok(Math.abs(point.attrs.cx - center) <= slot / 2 - 3, 'point radius stays within its category cell');
  const nine = { chart: 'strip', data: Array.from({ length: 9 }, (_, i) => ({ group: 'dense', score: 4, id: `point-${i}` })), encode: { category: 'group', value: 'score', id: 'id' } };
  const nineScene = K.layout(nine, { width: 320 });
  const ninePoints = nineScene.children.filter((child) => child.meta?.kind === 'strip');
  const nineAxis = nineScene.children.find((child) => child.tag === 'line' && child.attrs.x1 === child.attrs.x2);
  const nineBase = nineScene.children.find((child) => child.tag === 'line' && child.attrs.y1 === child.attrs.y2 && child.attrs.y1 > 300);
  const nineSlot = nineBase.attrs.x2 - nineAxis.attrs.x1, nineCenter = nineAxis.attrs.x1 + nineSlot / 2;
  assert.equal(new Set(ninePoints.map((child) => child.attrs.cx)).size, 9, 'nine equal-valued observations get distinct deterministic jitter positions');
  assert.ok(ninePoints.every((child) => Math.abs(child.attrs.cx - nineCenter) <= nineSlot / 2 - 3), 'dense jitter stays inside its category cell');
  assert.ok(Math.abs(ninePoints.reduce((sum, point) => sum + point.attrs.cx, 0) / ninePoints.length - nineCenter) < .01, 'beeswarm offsets remain symmetric around the category center');
  for (let i = 0; i < ninePoints.length; i++) for (let j = i + 1; j < ninePoints.length; j++) {
    const a = ninePoints[i].attrs, b = ninePoints[j].attrs;
    assert.ok(Math.hypot(a.cx - b.cx, a.cy - b.cy) >= 6, 'beeswarm points do not overlap');
  }
});

// 意图：反序时间行应按宿主表格语义排序，而不是沿用spec.data的输入顺序定位。
test('temporal category positions follow shared table ordering', () => {
  const spec = { chart: 'strip', data: [
    { month: '2024-03', score: 3, id: 'march' }, { month: '2024-01', score: 1, id: 'january' },
  ], encode: { category: 'month', value: 'score', id: 'id' }, fields: { month: { type: 'month' } } };
  const points = K.layout(spec).children.filter((child) => child.meta?.kind === 'strip');
  assert.ok(points[0].attrs.cx > points[1].attrs.cx, 'March is placed after January despite reverse input rows');
  const months = ['2026-01', '2026-02', '2026-03', '2026-04'];
  const candles = K.layout({ chart: 'candlestick', fields: { month: { type: 'month' } }, encode: { category: 'month', open: 'open', close: 'close', low: 'low', high: 'high' }, data: months.map((month) => ({ month, open: 1, close: 2, low: 0, high: 3 })) }, { width: 268 });
  const monthText = texts(candles.children).join('');
  assert.ok(months.every((month) => month.split('-').every((part) => monthText.includes(part))), 'narrow date slots keep every month readable without dropping a part');
});

// 意图：类别数量可容纳时铺满手机画布，超出最小可读槽宽时扩大场景而非挤压类别。
test('axis and category layout preserves readable minimum slots', () => {
  const longUnit = { ...specs.interval, annotations: [], fields: { group: { domain: ['A', 'B', 'C', 'D'] } }, unit: 'kg', data: ['A', 'B', 'C', 'D'].map((group, i) => ({ group, low: i + 1, high: i + 3, point: i + 2, id: String(i) })) };
  const scene = K.layout(longUnit, { width: 268, measure: (value, size) => String(value).length * size * 1.2 });
  const axis = scene.children.find((child) => child.tag === 'line' && child.attrs.x1 === child.attrs.x2);
  assert.ok(axis.attrs.x1 >= 40, 'axis margin follows measured tick labels while respecting the available plot width');
  assert.equal(scene.width, 268, 'four category slots fit the supplied mobile canvas instead of expanding it');
  const baseline = scene.children.find((child) => child.tag === 'line' && child.attrs.y1 === child.attrs.y2 && child.attrs.y1 > 300);
  assert.equal(baseline.attrs.x2, scene.width - 24);

  const groups = Array.from({ length: 12 }, (_, i) => `C${i}`);
  const twelve = K.layout({ ...longUnit, fields: { group: { domain: groups } }, data: groups.map((group, i) => ({ group, low: i, high: i + 2, point: i + 1, id: String(i) })) }, { width: 268 });
  const twelveAxis = twelve.children.find((child) => child.tag === 'line' && child.attrs.x1 === child.attrs.x2);
  const twelveBaseline = twelve.children.find((child) => child.tag === 'line' && child.attrs.y1 === child.attrs.y2 && child.attrs.y1 > 300);
  const slot = (twelveBaseline.attrs.x2 - twelveAxis.attrs.x1) / 12;
  assert.ok(slot >= 28, 'twelve categories retain the 28px minimum slot width');
  assert.ok(twelve.width > 268, 'categories that do not fit expand the scene for horizontal scrolling');

  const crowdedViolin = K.layout({ ...specs.violin, fields: { group: { domain: groups } }, data: groups.map((group) => ({ group, densityData: [[0, 1], [2, 0.5]], med: 1 })) }, { width: 268 });
  assert.equal(crowdedViolin.children.filter((child) => child.meta?.kind === 'violin').length, 12);
  assert.ok(crowdedViolin.width > 268, 'twelve violin categories also preserve their minimum slots');
});

// 意图：窄类别槽按词加宽，注释折行后仍离标记一行；K 线只在低于最小槽时抽稀日期。
test('distribution labels keep a measured slot and annotations stay off the marks', () => {
  const spec = { chart: 'interval', encode: { category: 'c', low: 'l', high: 'h', value: 'v', id: 'id' }, annotations: [
    { kind: 'rule', field: 'h', value: 3, label: 'Revenue kept growing across the reported range' },
  ], data: [
    { id: 'a', c: 'North America enterprise accounts', l: 1, h: 4, v: 2 },
    { id: 'b', c: 'Partner-led marketplace orders', l: 2, h: 5, v: 3 },
  ] };
  const scene = K.layout(spec, { width: 240, lang: 'en' });
  const labels = textNodes(scene.children).filter((node) => node.tag === 'text' && node.text === 'North');
  assert.equal(labels.length, 1, 'a category wraps by word instead of one character per line');
  assert.ok(scene.width >= 240, 'a slot that cannot hold a word widens the scene');
  const note = textNodes(scene.children).find((node) => node.tag === 'text' && node.text.startsWith('Revenue'));
  const mark = scene.children.find((node) => node.meta?.kind === 'interval');
  assert.ok(Math.abs(Number(note.attrs.y) - Number(mark.attrs.y2)) >= 12, 'annotation text stays off the interval mark');
  const months = Array.from({ length: 8 }, (_, i) => `2026-0${i + 1}`);
  const candles = K.layout({ chart: 'candlestick', encode: { category: 'm', open: 'o', close: 'c', low: 'l', high: 'h' }, data: months.map((m) => ({ m, o: 1, c: 2, l: 0, h: 3 })) }, { width: 240 });
  assert.ok(candles.width > 240, 'candles widen to the measured minimum slot');
  assert.ok(texts(candles.children).includes(months[0]) && texts(candles.children).includes(months.at(-1)), 'thinned dates still keep the ends');
});

// 意图：K 线会抽稀日期，槽宽只按 28px 标记槽计算，放得下时不为日期文字加宽场景。
test('candlestick keeps the requested width when its marker slots fit', () => {
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];
  const candles = K.layout({ chart: 'candlestick', encode: { category: 'm', open: 'o', close: 'c', low: 'l', high: 'h' }, data: months.map((m) => ({ m, o: 1, c: 2, l: 0, h: 3 })) }, { width: 268 });
  assert.equal(candles.width, 268);
});

// 意图：长类别名、参考线标签和点注释换行后保留全部词，不按行数截断。
test('distribution labels and annotations keep every word however many lines they wrap to', () => {
  const category = 'Cross-border marketplace orders fulfilled from regional partner warehouses';
  const rule = 'Target agreed with the regional finance team for the second half of the fiscal year';
  const note = 'Peak reflects a one-off bulk order placed before the price change took effect';
  const scene = K.layout({ chart: 'interval', encode: { category: 'c', low: 'l', high: 'h', id: 'id' }, annotations: [
    { kind: 'rule', field: 'h', value: 3, label: rule }, { kind: 'note', record: 'a', field: 'h', text: note },
  ], data: [{ id: 'a', c: category, l: 1, h: 4 }, { id: 'b', c: 'Other', l: 2, h: 5 }] }, { width: 320, lang: 'en' });
  const text = texts(scene.children).join(' ');
  for (const label of [category, rule, note]) {
    for (const word of label.split(/[\s-]+/)) assert.ok(text.includes(word), `"${word}" is still drawn`);
  }
});

// 意图：区间与蜡烛严格依赖校验器拒绝异常，不得在布局中钳制或拟合错误数据。
test('invalid interval and candlestick ranges stay validation errors', () => {
  const badInterval = { ...specs.interval, annotations: [], data: [{ group: 'A', low: 8, high: 2, point: 5, id: 'a' }] };
  const badCandle = { ...specs.candlestick, data: [{ day: 'Mon', open: 9, close: 4, low: 5, high: 8, id: 'x' }] };
  for (const spec of [badInterval, badCandle]) assert.ok(K.validate(spec).errors.length > 0);
  assert.throws(() => K.layout(badInterval), (error) => error.code === 'BAD_KCHART');
});
