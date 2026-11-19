import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadChart } from './kchart-fixture.mjs';

const { api: K, context, modules } = loadChart(['chart/unit-variants']);
const { geometry } = modules['core/icons'];
const plain = (value) => JSON.parse(JSON.stringify(value));
const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children || [])]);
const textOf = (node) => flatten([node]).filter((item) => item.tag === 'text').map((item) => item.text).join('');
const layout = (spec, options) => K.layout(spec, { width: 640, ...options });

// 意图：验证公开图标geometry API仅返回安全几何数据、不依赖DOM，并拒绝不存在的名称。
test('icon geometry exposes sanitized pure shape data', () => {
  assert.equal(vm.runInContext('typeof document', context), 'undefined');
  const icon = geometry('chart-bar');
  assert.equal(icon.set, 'tabler');
  assert.match(icon.viewBox, /^0 0 /);
  assert.ok(icon.elements.length > 0);
  assert.ok(icon.elements.every(({ tag, attrs }) => ['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'].includes(tag) && !Object.keys(attrs).some((key) => /href|on/i.test(key))));
  assert.equal(geometry('not-an-icon'), null);
});

// 意图：把固定单位的完整与部分数量转成可审查横档/竖档，并确认零值无假符号、全图超预算和不可读档位会明确拒绝。
test('bar and column rungs preserve exact unit counts, crosswise geometry, and partial clips', () => {
  for (const chart of ['bar', 'column']) {
    const scene = layout({ chart, variant: 'rungs', unitMark: { value: 2, label: '人' }, data: [{ c: 'partial', v: 5 }, { c: 'zero', v: 0 }], encode: { category: 'c', value: 'v' } });
    const nodes = flatten(scene.children);
    const marks = nodes.filter((node) => node.tag === 'rect' && node.meta?.kind === 'record');
    assert.equal(marks.length, 3, `${chart}: two full unit lanes and one partial lane, with no zero mark`);
    assert.equal(nodes.filter((node) => node.tag === 'clipPath').length, 1, 'only the partial rung requires a crop');
    const heading = nodes.find((node) => node.meta?.kind === 'unit-mark-label');
    assert.match(textOf(heading), /2/);
    assert.ok(marks.every((node) => chart === 'bar' ? Number(node.attrs.height) === Number(marks[0].attrs.height) : Number(node.attrs.width) === Number(marks[0].attrs.width)), `${chart}: unit lanes stay continuous across the full category thickness`);
    assert.ok(marks.every((node) => node.meta.value === 5));
    assert.ok(marks.every((node) => Number(node.attrs.rx) > 0), `${chart}: each rung is its own rounded shape`);
    const ordered = marks.slice().sort((a, b) => Number(chart === 'bar' ? a.attrs.x : a.attrs.y) - Number(chart === 'bar' ? b.attrs.x : b.attrs.y));
    assert.ok(ordered.slice(1).every((node, index) => {
      const previous = ordered[index], gap = chart === 'bar'
        ? Number(node.attrs.x) - Number(previous.attrs.x) - Number(previous.attrs.width)
        : Number(node.attrs.y) - Number(previous.attrs.y) - Number(previous.attrs.height);
      return gap >= 2 && gap <= 3;
    }), `${chart}: rungs use a real 2–3px gap instead of an overlaid separator`);
    assert.deepEqual(plain(marks.map((node) => node.meta.fraction)), [1, 1, 0.5]);
    const partial = marks.at(-1), clipId = partial.attrs['clip-path'].match(/#([^)]*)/)[1];
    const clip = nodes.find((node) => node.tag === 'clipPath' && node.attrs.id === clipId).children[0].attrs;
    const fullSpan = chart === 'bar' ? Number(marks[0].attrs.width) : Number(marks[0].attrs.height);
    const clippedSpan = Number(clip[chart === 'bar' ? 'width' : 'height']);
    assert.ok(Math.abs(clippedSpan / fullSpan - 0.5) < 0.001, `${chart}: partial lane is cropped to its true half-unit extent`);
  }
  assert.throws(() => layout({ chart: 'bar', variant: 'rungs', unitMark: { value: 1, label: 'x' }, data: [{ c: 'A', v: 1001 }, { c: 'B', v: 1000 }], encode: { category: 'c', value: 'v' } }), /全图单位符号总数超过2000/);
  assert.throws(() => layout({ chart: 'bar', variant: 'rungs', unitMark: { value: 1, label: 'x' }, data: [{ c: 'A', v: 2000 }], encode: { category: 'c', value: 'v' } }), /太密或太小/);
  assert.throws(() => layout({ chart: 'column', variant: 'rungs', unitMark: { value: 1, label: 'x' }, data: [{ c: 'A', v: -1 }], encode: { category: 'c', value: 'v' } }), /图表声明校验失败/);
  // 很小的余数只是裁切完整符号槽，不应单独触发“符号太小”。
  for (const chart of ['bar', 'column']) {
    const marks = flatten(layout({ chart, variant: 'rungs', unitMark: { value: 5, label: '件' }, data: [{ c: 'A', v: 16 }], encode: { category: 'c', value: 'v' } }).children).filter((node) => node.tag === 'rect' && node.meta?.kind === 'record');
    assert.ok(Math.abs(marks.at(-1).meta.fraction - 0.2) < 1e-9);
  }
  const multi = { chart: 'column', variant: 'rungs', stack: 'absolute', unitMark: { value: 1, label: 'x' }, data: [{ c: 'A', s: 'first', v: 1001 }, { c: 'A', s: 'second', v: 1000 }], encode: { category: 'c', series: 's', value: 'v' } };
  assert.throws(() => layout(multi), /全图单位符号总数超过2000/, 'budget includes every value series in a stack');
});

// 意图：说明文案依照语言本地化并按实测行数增加scene高度，原图体整体平移且默认变体仍不受影响。
test('unit descriptions localize and reserve measured scene space', () => {
  const spec = { chart: 'bar', title: 'Revenue by year', variant: 'rungs', unitMark: { value: 2, label: 'person' }, data: [{ c: 'A', s: '2024', v: 5 }, { c: 'B', s: '2025', v: 3 }], encode: { category: 'c', series: 's', value: 'v' } };
  const base = layout({ ...spec, variant: 'solid' });
  const english = layout(spec, { lang: 'en' });
  const heading = flatten(english.children).find((node) => node.meta?.kind === 'unit-mark-label');
  // 字段无单位时用符号名补上单位；单位只出现一次。
  assert.equal(textOf(heading), 'Each mark represents 2 person');
  const counted = flatten(layout({ ...spec, unit: 'people' }, { lang: 'en' }).children).find((node) => node.meta?.kind === 'unit-mark-label');
  assert.equal(textOf(counted), 'Each mark represents 2 people', 'a field unit is not repeated by the mark label');
  const chinese = flatten(layout({ ...spec, unit: '人', unitMark: { value: 2, label: '人' } }).children).find((node) => node.meta?.kind === 'unit-mark-label');
  assert.equal(textOf(chinese), '每个符号表示 2人');
  const body = english.children.find((node) => node.tag === 'g' && /translate\(0 \d+\)/.test(node.attrs.transform || ''));
  assert.ok(body && Number(english.height) > Number(base.height));
  assert.equal(Number(body.attrs.transform.match(/translate\(0 (\d+)\)/)[1]), Number(english.height) - Number(base.height), 'the measured description height moves the entire plot body');
  assert.equal(english.title, base.title, 'the original title is retained');
  assert.deepEqual(plain(flatten(body.children).find((node) => node.meta?.kind === 'legend')), plain(flatten(base.children).find((node) => node.meta?.kind === 'legend')), 'the complete legend is moved with the plot instead of overlapped');
  const solid = layout({ ...spec, variant: 'solid' });
  assert.deepEqual(plain(solid), plain(base), 'solid delegates unchanged');
});

// 意图：防止品牌标志被当作可重复计数图案，并验证通用图标每单位一枚且受裁剪。
test('pictorial counts only generic controlled icons and rejects missing or brand assets', () => {
  const spec = { chart: 'column', variant: 'pictorial', unitMark: { value: 2, label: '人', icon: 'users' }, data: [{ c: 'A', v: 5 }], encode: { category: 'c', value: 'v' } };
  const nodes = flatten(layout(spec).children);
  const pictorial = nodes.filter((node) => node.tag === 'g' && node.attrs['clip-path'] && node.meta?.kind === 'record');
  const ghosts = nodes.filter((node) => node.tag === 'g' && node.attrs['clip-path'] && node.meta?.kind === 'pictorial-ghost');
  assert.equal(pictorial.length, 3);
  assert.equal(ghosts.length, 1, 'the partial icon retains one complete low-contrast ghost underlay');
  assert.ok(pictorial.every((node) => {
    const clipId = node.attrs['clip-path'].match(/#([^)]*)/)[1];
    const clip = nodes.find((item) => item.tag === 'clipPath' && item.attrs.id === clipId).children[0].attrs;
    return Number(clip.width) === 20 && Number(clip.height) === 10 || Number(clip.width) === 20 && Number(clip.height) === 20;
  }), 'icons keep a 20px glyph size and clip the half icon to 10px');
  const partial = pictorial.find((node) => node.meta.fraction < 1);
  const partialClipId = partial.attrs['clip-path'].match(/#([^)]*)/)[1];
  const partialClip = nodes.find((item) => item.tag === 'clipPath' && item.attrs.id === partialClipId).children[0].attrs;
  const ghostClipId = ghosts[0].attrs['clip-path'].match(/#([^)]*)/)[1];
  const ghostClip = nodes.find((item) => item.tag === 'clipPath' && item.attrs.id === ghostClipId).children[0].attrs;
  assert.equal(Number(ghostClip.width), 20);
  assert.equal(Number(ghostClip.height), 20);
  assert.equal(Number(partialClip.height), 10);
  assert.equal(Number(partialClip.height), Number(ghostClip.height) * partial.meta.fraction, 'the real-color mask equals fraction × icon height');
  assert.equal(nodes.filter((node) => node.tag === 'path' && node.attrs.d).length > 0, true);
  const clipHeights = pictorial.map((node) => {
    const id = node.attrs['clip-path'].match(/#([^\)]+)/)[1];
    return Number(nodes.find((item) => item.tag === 'clipPath' && item.attrs.id === id).children[0].attrs.height);
  });
  assert.ok(clipHeights[2] < clipHeights[0] * 0.6, 'partial pictogram clips a full-size final glyph from the slot bottom upward');
  const transforms = pictorial.map((node) => flatten(node.children).find((item) => item.tag === 'g' && item.attrs.transform).attrs.transform);
  assert.equal(new Set(transforms.map((transform) => transform.match(/scale\(([^)]+)\)/)?.[1])).size, 1, 'partial pictogram is not scaled smaller');
  assert.throws(() => layout({ ...spec, unitMark: { ...spec.unitMark, icon: 'github' } }), /不支持品牌图标/);
  assert.throws(() => layout({ ...spec, unitMark: { ...spec.unitMark, icon: 'not-an-icon' } }), /图标不存在/);
});

// 意图：图标尺寸固定在视觉目标范围，单位数量×24px节距决定图长，partial沿值方向裁切。
test('pictorial icon pitch, extent, and partial crop are driven by unit count', () => {
  for (const chart of ['bar', 'column']) {
    const scene = layout({ chart, variant: 'pictorial', unitMark: { value: 2, label: '件', icon: 'package' }, data: [{ c: 'A', v: 5 }], encode: { category: 'c', value: 'v' } });
    const nodes = flatten(scene.children);
    const icons = nodes.filter((node) => node.tag === 'g' && node.attrs['clip-path'] && node.meta?.kind === 'record');
    const ghosts = nodes.filter((node) => node.tag === 'g' && node.attrs['clip-path'] && node.meta?.kind === 'pictorial-ghost');
    assert.equal(icons.length, 3);
    assert.equal(ghosts.length, 1, `${chart} retains a complete ghost below its partial icon`);
    const clips = icons.map((icon) => nodes.find((node) => node.tag === 'clipPath' && node.attrs.id === icon.attrs['clip-path'].match(/#([^)]*)/)[1]).children[0].attrs);
    const full = clips[0], partial = clips.at(-1);
    assert.equal(Number(chart === 'bar' ? partial.width : partial.height), Number(chart === 'bar' ? full.width : full.height) * icons.at(-1).meta.fraction, `${chart} colored length matches the fractional unit count`);
    assert.equal(Number(chart === 'bar' ? full.height : full.width), 20, 'full glyph measures 20px');
    assert.equal(Number(chart === 'bar' ? partial.width : partial.height), 10, 'half unit crops exactly half of the glyph along its value direction');
    const firstSlots = clips.slice(0, 2).map((clip) => Number(chart === 'bar' ? clip.x : clip.y));
    assert.ok(Math.abs(Math.abs(firstSlots[1] - firstSlots[0]) - 24) < 0.01, 'glyph slots are spaced on a 24px pitch');
    assert.ok(!nodes.some((node) => node.tag === 'line' && !node.meta), 'obsolete numeric axis/grid strokes are removed from pictorial geometry');
    // 部分图标的浅色底图标占整格，读数必须从整格之后开始，不压在底图标上。
    const slot = nodes.find((node) => node.tag === 'clipPath' && node.attrs.id === ghosts[0].attrs['clip-path'].match(/#([^)]*)/)[1]).children[0].attrs;
    const readout = nodes.find((node) => node.tag === 'text' && node.meta?.kind === 'value');
    if (chart === 'bar') assert.ok(readout.attrs.x >= slot.x + slot.width + 4, `bar readout clears the ghost slot: ${readout.attrs.x}`);
    else assert.ok(readout.attrs.y <= slot.y - 4, `column readout clears the ghost slot: ${readout.attrs.y}`);
  }
});

// 意图：棒棒糖端点严格落在原柱端，且单位计数图使用原有真实值轴、未请求变体时回退标准布局。
test('lollipop endpoints retain bar geometry and default layout remains unchanged', () => {
  const spec = { chart: 'column', data: [{ c: 'A', v: 4 }], encode: { category: 'c', value: 'v' } };
  const base = layout(spec), standard = layout({ ...spec, variant: 'solid' }), variant = layout({ ...spec, variant: 'lollipop' });
  assert.deepEqual(plain(standard), plain(base));
  const original = flatten(base.children).find((node) => node.tag === 'rect' && node.meta?.kind === 'record');
  const endpoint = flatten(variant.children).find((node) => node.tag === 'circle' && node.meta?.kind === 'record');
  assert.equal(Number(endpoint.attrs.cx), Number(original.attrs.x) + Number(original.attrs.width) / 2);
  assert.equal(Number(endpoint.attrs.cy), Number(original.attrs.y));
  assert.ok(flatten(variant.children).some((node) => node.tag === 'line' && node.meta?.kind === 'connector'));
});

// 意图：哑铃横档的右侧读数单独成列，底部刻度由共用 ctx.ticks 按轴长减少并留在场景内。
test('dumbbell rung readouts keep a measured column and ticks stay inside the scene', () => {
  const scene = layout({ chart: 'dumbbell', variant: 'rungs', unitMark: { value: 10, label: '件' }, encode: { category: 'c', before: 'b', after: 'a' }, data: [
    { c: 'East', b: 10, a: 80 }, { c: 'West', b: 20, a: 90 },
  ] }, { width: 280 });
  const nodes = flatten(scene.children);
  const readouts = nodes.filter((node) => node.meta?.kind === 'value');
  const marks = nodes.filter((node) => node.tag === 'rect' && node.meta?.kind === 'record');
  const markRight = Math.max(...marks.map((node) => Number(node.attrs.x) + Number(node.attrs.width)));
  assert.ok(readouts.every((node) => Number(node.attrs.x) >= markRight), 'readouts start after the last rung');
  const ticks = nodes.filter((node) => node.tag === 'text' && /^\d/.test(node.text) && !node.meta);
  assert.ok(ticks.every((node) => {
    const width = node.text.length * 7;
    const x = Number(node.attrs.x);
    const anchor = node.attrs['text-anchor'];
    const left = anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x;
    return left >= -0.5 && left + width <= scene.width + 0.5;
  }), 'tick labels remain inside the scene');
});

// 意图：窄图框里哑铃横档的刻度仍是等距数列且互不重叠；风险是局部抽稀只删中间刻度，
// 得到「0 5 10 25」这样看似断轴的刻度。268px 是 324px 手机图框的内容宽度。
test('narrow dumbbell rung ticks stay evenly spaced and apart', () => {
  const spec = { chart: 'dumbbell', variant: 'rungs', unitMark: { value: 5, label: '件' }, encode: { category: 'c', before: 'b', after: 'a' }, data: [
    { c: '甲', b: 18, a: 14 }, { c: '乙', b: 12, a: 16 }, { c: '丙', b: 22, a: 19 }, { c: '丁', b: 16, a: 21 },
  ] };
  const scene = layout(spec, { width: 268 });
  const measure = K.util.context({ spec, width: 268 }).measure;
  const ticks = flatten(scene.children).filter((node) => node.tag === 'text' && !node.meta && /^\d+$/.test(node.text))
    .map((node) => ({ value: Number(node.text), x: Number(node.attrs.x), width: measure(node.text, 12, 400), anchor: node.attrs['text-anchor'] }));
  const steps = ticks.slice(1).map((tick, index) => tick.value - ticks[index].value);
  assert.ok(ticks.length >= 3 && steps.every((step) => step === steps[0]), `ticks form one even step: ${JSON.stringify(ticks)}`);
  assert.ok(ticks.every((tick) => tick.anchor === 'middle'), 'labels are centred on their tick like the other horizontal value axes');
  assert.ok(ticks.slice(1).every((tick, index) => tick.x - ticks[index].x >= (tick.width + ticks[index].width) / 2 + 8), 'adjacent labels keep the shared 8px gap');
});

// 意图：验证统计族rungs仍有before/after实际刻度与身份，瀑布负增减方向/连线保留且绝对值计数。
test('dumbbell and waterfall rungs retain truthful values and cumulative connectors', () => {
  const dumbbell = layout({ chart: 'dumbbell', variant: 'rungs', unitMark: { value: 1, label: '件' }, data: [{ c: 'A', b: 0.5, a: 2.5, id: 'a' }], encode: { category: 'c', before: 'b', after: 'a', id: 'id' } });
  const dNodes = flatten(dumbbell.children);
  const dHeading = dNodes.find((node) => node.meta?.kind === 'unit-mark-label');
  assert.match(textOf(dHeading), /每个/);
  assert.ok(dNodes.some((node) => node.meta?.kind === 'category' && node.attrs['text-anchor'] === 'end'));
  assert.ok(dNodes.some((node) => node.meta?.kind === 'value' && /之前/.test(node.meta.label)));
  assert.ok(dNodes.some((node) => node.meta?.kind === 'value' && /之后/.test(node.meta.label)));
  assert.ok(dNodes.some((node) => node.meta?.kind === 'value' && node.meta.field === 'b' && node.meta.value === 0.5));
  assert.ok(dNodes.some((node) => node.meta?.kind === 'value' && node.meta.field === 'a' && node.meta.value === 2.5));
  const dumbbellMarks = dNodes.filter((node) => node.tag === 'rect' && node.meta?.kind === 'record');
  assert.equal(dumbbellMarks.length, 4);
  assert.ok(dumbbellMarks.every((node) => Number(node.attrs.height) === 8 && Number(node.attrs.rx) === 4), 'dumbbell units are independent rounded segments, not thin strokes');
  assert.deepEqual(plain(dumbbellMarks.map((node) => node.meta.fraction)), [0.5, 1, 1, 0.5]);
  const readoutY = dNodes.filter((node) => node.meta?.kind === 'value').map((node) => Number(node.attrs.y)).sort((a, b) => a - b);
  assert.ok(readoutY[1] - readoutY[0] >= 20, 'before/after readouts have separate readable baselines');
  assert.equal(dNodes.filter((node) => node.tag === 'clipPath').length, 2, 'both half-unit rungs use exact clipping rather than rounding');
  const wide = layout({ chart: 'dumbbell', variant: 'rungs', unitMark: { value: 1, label: 'piece' }, data: [{ c: 'A very long category label that wraps', b: 1.5, a: 0 }], encode: { category: 'c', before: 'b', after: 'a' } }, { width: 480, lang: 'en' });
  const wideNodes = flatten(wide.children), beforeMarks = wideNodes.filter((node) => node.tag === 'rect' && node.meta?.kind === 'record' && node.meta.field === 'b');
  assert.deepEqual(plain(beforeMarks.map((node) => node.meta.fraction)), [1, 0.5], 'the value remains an exact 1.5-unit quantity');
  assert.ok(Number(beforeMarks[0].attrs.x) < Number(beforeMarks[1].attrs.x), 'positive unit rungs extend outward from zero toward the right');
  assert.ok(wideNodes.filter((node) => node.meta?.kind === 'category').length > 1, 'long category labels are measured and wrapped instead of colliding with the axis');
  const mobileWide = layout({ chart: 'dumbbell', variant: 'rungs', unitMark: { value: 5, label: '件' }, data: [
    { c: '甲', b: 18, a: 14 }, { c: '乙', b: 12, a: 16 }, { c: '丙', b: 22, a: 19 }, { c: '丁', b: 16, a: 21 },
  ], encode: { category: 'c', before: 'b', after: 'a' } }, { width: 1040 });
  assert.equal(mobileWide.width, 1040, 'dumbbell rung readouts fit within the requested 1040px scene without the former 8px overhang');
  const waterfall = layout({ chart: 'waterfall', variant: 'rungs', unitMark: { value: 1, label: '元' }, data: [{ c: 'up', d: 2.5 }, { c: 'down', d: -1.5 }], encode: { category: 'c', delta: 'd' } });
  const wNodes = flatten(waterfall.children);
  const rungs = wNodes.filter((node) => node.tag === 'rect' && node.meta?.kind === 'record');
  assert.equal(rungs.length, 5, '2.5 and 1.5 absolute units are represented without rounding');
  assert.ok(rungs.some((node) => node.meta.value === -1.5));
  assert.deepEqual(plain(rungs.map((node) => node.meta.fraction)), [1, 1, 0.5, 1, 0.5]);
  const waterfallClips = wNodes.filter((node) => node.tag === 'clipPath' && node.attrs.id.startsWith('waterfall-unit-clip-')).map((node) => node.children[0].attrs);
  assert.ok(Math.abs(Number(waterfallClips[2].height) / Number(waterfallClips[0].height) - 0.5) < 0.001, 'the partial positive rung occupies exactly half a unit');
  assert.ok(Math.abs(Number(waterfallClips[4].height) / Number(waterfallClips[3].height) - 0.5) < 0.001, 'the partial negative rung occupies exactly half a unit');
  assert.ok(wNodes.some((node) => node.tag === 'line' && node.attrs.class === 'chart-connector'));
  assert.ok(wNodes.some((node) => node.tag === 'clipPath'));
  assert.ok(rungs.every((node) => Number(node.attrs.rx) > 0), 'waterfall units are rounded independent shapes');
  const positive = rungs.slice(0, 3).slice().sort((a, b) => Number(a.attrs.y) - Number(b.attrs.y));
  assert.ok(positive.slice(1).every((node, index) => Number(node.attrs.y) - Number(positive[index].attrs.y) - Number(positive[index].attrs.height) > 1.5), 'adjacent waterfall rungs have real empty gaps, not overlaid separator lines');
  assert.throws(() => layout({ chart: 'waterfall', variant: 'rungs', unitMark: { value: 1, label: 'x' }, data: [{ c: 'A', d: 1001 }, { c: 'B', d: -1000 }], encode: { category: 'c', delta: 'd' } }), /全图单位符号总数超过2000/);
  assert.throws(() => layout({ chart: 'dumbbell', variant: 'rungs', unitMark: { value: 1, label: 'x' }, data: [{ c: 'A', b: 1001, a: 1000 }], encode: { category: 'c', before: 'b', after: 'a' } }), /全图单位符号总数超过2000/);
});

// 意图：等宽直方图rungs按面积表示频数并裁切partial数量；不等宽分箱必须回退默认直方图。
test('histogram rungs require equal bins and keep frequency proportional to cell area', () => {
  const spec = { chart: 'histogram', variant: 'rungs', unitMark: { value: 2, label: '次' }, data: [{ l: 0, u: 1, n: 5 }, { l: 1, u: 2, n: 8 }], fields: { n: { unit: '次' } }, encode: { lower: 'l', upper: 'u', count: 'n' } };
  const scene = layout(spec);
  const nodes = flatten(scene.children), marks = nodes.filter((node) => node.tag === 'rect' && node.meta?.kind === 'record');
  assert.equal(marks.length, 7);
  assert.deepEqual(plain(marks.map((node) => node.meta.value)), [5, 5, 5, 8, 8, 8, 8]);
  assert.deepEqual(plain(marks.map((node) => node.meta.fraction)), [1, 1, 0.5, 1, 1, 1, 1]);
  const clips = nodes.filter((node) => node.tag === 'clipPath');
  assert.equal(clips.length, 7, 'every rung retains a safe crop, including full-size segments');
  assert.ok(marks.every((node) => Number(node.attrs.rx) > 0), 'histogram units are rounded independent shapes');
  const first = clips[0].children[0].attrs;
  const second = clips[3].children[0].attrs;
  const firstUnitArea = Number(first.width) * Number(first.height);
  const secondUnitArea = Number(second.width) * Number(second.height);
  const partialArea = Number(clips[2].children[0].attrs.width) * Number(clips[2].children[0].attrs.height);
  assert.ok(Math.abs(firstUnitArea - secondUnitArea) < 0.01, 'each cell represents an equal area for an equal-width bin');
  assert.ok(Math.abs(partialArea / firstUnitArea - 0.5) < 0.001, 'the partial histogram unit occupies exactly half the full unit area');
  assert.ok(marks.every((node) => node.attrs['clip-path'].startsWith('url(#')));
  assert.ok(marks.every((node) => Number(node.attrs.width) > 0 && Number(node.attrs.height) > 0), 'frequency units are filled areas so bin area represents count');
  const rejected = K.validate({ ...spec, data: [{ l: 0, u: 1, n: 5 }, { l: 1, u: 4, n: 8 }] });
  assert.ok(rejected.errors.some((error) => /等宽分箱.*默认实心直方图/.test(error.message)), 'validation explains why unequal bins need solid histogram');
});

// 意图：频数档位的轴名使用计数字段标签/横轴单位；无单位时不伪造“x”或占位文案。
test('histogram rungs label count and horizontal units without placeholder text', () => {
  const spec = { chart: 'histogram', variant: 'rungs', unitMark: { value: 2, label: '次' }, data: [{ l: 0, u: 1, n: 5 }, { l: 1, u: 2, n: 8 }], fields: { n: { unit: '次' } }, encode: { lower: 'l', upper: 'u', count: 'n' } };
  const labeled = layout({ ...spec, fields: { n: { label: '发生次数', unit: '次' }, l: { label: '月份', unit: '月' } } });
  const labeledHeader = flatten(labeled.children).find((node) => node.meta?.kind === 'unit-mark-label');
  assert.match(textOf(labeledHeader), /每格表示 2次/);
  const noUnit = layout(spec);
  const plainHeader = flatten(noUnit.children).find((node) => node.meta?.kind === 'unit-mark-label');
  assert.match(textOf(plainHeader), /每格表示/);
  assert.doesNotMatch(textOf(plainHeader), /横轴单位| \/ x/);
  const englishHeader = flatten(layout(spec, { lang: 'en' }).children).find((node) => node.meta?.kind === 'unit-mark-label');
  assert.match(textOf(englishHeader), /Each cell represents 2次/);
  // 边界刻度放不下时按统一步长抽稀：首尾保留，中间间隔相等。
  const wide = { chart: 'histogram', variant: 'rungs', unitMark: { value: 50, label: '单' }, encode: { lower: 'l', upper: 'u', count: 'n' },
    fields: { l: { unit: '分钟' }, u: { unit: '分钟' }, n: { unit: '单' } },
    data: [[0, 2, 100], [2, 4, 350], [4, 6, 400], [6, 8, 250], [8, 10, 100], [10, 12, 50]].map(([l, u, n]) => ({ l, u, n })) };
  const ticks = flatten(layout(wide, { width: 320 }).children).filter((node) => node.tag === 'text' && /^\d+分钟$/.test(node.text)).map((node) => Number(node.text.replace('分钟', '')));
  assert.equal(ticks[0], 0);
  assert.equal(ticks.at(-1), 12);
  const gaps = ticks.slice(1, -1).map((tick, i) => tick - ticks[i]);
  assert.ok(gaps.every((gap) => gap === gaps[0]), `uneven boundary labels ${ticks}`);
});

// 意图：测试真实Chromium绘制SVG与clipPath，避免仅凭scene数值误判partial mark越界或不渲染。
