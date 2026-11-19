// 构成图族面向真实声明生成场景，并锁定易被误读/隐藏的数据语义。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadChart } from './kchart-fixture.mjs';

const { api: K } = loadChart(['chart/composition']);
const plain = (value) => JSON.parse(JSON.stringify(value));
const walk = (nodes, predicate, out = []) => { for (const node of nodes || []) { if (predicate(node)) out.push(node); walk(node.children, predicate, out); } return out; };

// 意图：逐图通过公开 validate/layout/render 链路确认七种真实输入均产生非空静态SVG场景。
test('all composition chart types generate validated scenes and serializable SVG', () => {
  const specs = [
    { chart: 'pie', data: [{ c: 'A', v: 3 }, { c: 'B', v: 2 }], encode: { category: 'c', value: 'v' } },
    { chart: 'donut', variant: 'ticks', data: [{ c: 'A', v: 3 }, { c: 'B', v: 2 }], encode: { category: 'c', value: 'v' } },
    { chart: 'radial-share', data: [{ c: 'A', v: 2, i: 0 }, { c: 'B', v: 3, i: 9 }], encode: { category: 'c', value: 'v', intensity: 'i' }, fields: { v: { unit: '人' }, i: { unit: '指数' } } },
    { chart: 'rose', data: [{ c: 'A', v: 1 }, { c: 'B', v: 4 }, { c: 'C', v: 2 }], encode: { category: 'c', value: 'v' } },
    { chart: 'gauge', range: [0, 100], variant: 'arc', unit: '分', data: [{ v: 68, t: 75 }], encode: { value: 'v', target: 't' } },
    { chart: 'treemap', data: { label: '总计', children: [{ label: '甲', children: [{ label: '叶一', value: 2 }, { label: '叶二', value: 1 }] }, { label: '乙', value: 3 }] } },
    { chart: 'sunburst', data: { label: '总计', children: [{ label: '甲', children: [{ label: '叶一', value: 2 }, { label: '叶二', value: 1 }] }, { label: '乙', value: 3 }] } },
  ];
  for (const spec of specs) {
    const result = K.validate(spec);
    assert.equal(result.errors.length, 0, `${spec.chart}: ${JSON.stringify(plain(result.errors))}`);
    const { scene, svg } = K.render(spec, { width: 720 });
    assert.ok(scene.children.length > 0, `${spec.chart} scene has geometry`);
    assert.match(svg, /^<svg/);
    assert.ok(svg.length > 300, `${spec.chart} emits meaningful SVG`);
  }
  const ticksScene = K.layout(specs[1]);
  assert.equal(walk(ticksScene.children, (node) => node.meta?.kind === 'donut-tick').length, 240);
  assert.equal(walk(ticksScene.children, (node) => node.tag === 'path' && node.meta?.kind === 'donut').length, 0);
});

// 意图：0强度仍保留外环份额身份与标签，且值/强度两套独立量纲不被面积编码混淆。
test('radial-share renders zero-intensity shares in an explicit outer label ring', () => {
  const { scene, svg } = K.render({ chart: 'radial-share', data: [{ c: '无强度', v: 4, i: 0 }, { c: '有强度', v: 6, i: 10 }], encode: { category: 'c', value: 'v', intensity: 'i' }, fields: { v: { unit: '件' }, i: { unit: '指数' } } });
  assert.equal(walk(scene.children, (node) => node.meta?.kind === 'legend' && node.meta.intensity != null).length, 2);
  assert.match(svg, /无强度/);
  assert.match(svg, /份额/);
  assert.match(svg, /强度/);
});

// 意图：确认 gauge 三变体均有带单位实际读数、量程端点与目标，避免只画装饰弧线。
test('gauge variants retain unit-bearing value, range and target readings', () => {
  for (const variant of ['bar', 'arc', 'ticks']) {
    const { scene, svg } = K.render({ chart: 'gauge', range: [10, 90], variant, unit: '小时', data: [{ v: 50, t: 70 }], encode: { value: 'v', target: 't' } }, { width: 324 });
    assert.ok(scene.children.some((node) => node.meta?.kind === 'gauge-value' || node.meta?.kind === 'gauge-arc' || node.meta?.kind === 'gauge-needle'));
    assert.match(svg, /小时/);
    assert.match(svg, /目标/);
    assert.match(svg, /10小时/);
    assert.match(svg, /90小时/);
    if (variant !== 'bar') {
      const reading = scene.children.find((node) => node.meta?.kind === 'gauge-reading');
      const min = scene.children.find((node) => node.meta?.kind === 'gauge-min');
      const max = scene.children.find((node) => node.meta?.kind === 'gauge-max');
      assert.equal(Number(reading.attrs.y) - Number(min.attrs.y), 30, 'endpoint labels sit close to the arc ends and above the centered reading');
      assert.equal(Number(max.attrs.y) - Number(min.attrs.y), 0, 'both endpoints share one baseline');
      assert.ok(Math.abs(Number(min.attrs.x) - Number(reading.attrs.x)) > 50, 'endpoint text is horizontally separated from the main reading');
      assert.ok(Number(max.attrs.y) < scene.height, 'endpoint labels stay inside the scene');
    }
    if (variant === 'ticks') {
      assert.ok(scene.children.findIndex((node) => node.meta?.kind === 'gauge-tick') < scene.children.findIndex((node) => node.meta?.kind === 'gauge-needle'), 'needle is painted above the tick marks');
      assert.equal(walk(scene.children, (node) => node.meta?.kind === 'gauge-tick').length, 21);
    }
  }
});

// 意图：仪表目标位于弧顶附近时按12px文字上升空间预留顶部，不产生场景溢出。
test('wide gauge reserves ascent above a target label near the arc top', () => {
  const scene = K.layout({ chart: 'gauge', variant: 'ticks', range: [0, 56.29], unit: 'orders', data: [{ value: 56.29, target: 26.3 }], encode: { value: 'value', target: 'target' } }, { width: 1130, lang: 'en' });
  assert.equal(scene.overflow, undefined);
});

// 意图：窄弧形仪表的右量程端点按标签半宽向内夹紧，不发生1px文字溢出。
test('narrow arc gauge clamps its measured right endpoint label inside', () => {
  const scene = K.layout({ chart: 'gauge', variant: 'arc', range: [0, 38.87], unit: 'users', data: [{ value: 25.76, target: 23.59 }], encode: { value: 'value', target: 'target' } }, { width: 240, lang: 'en' });
  assert.equal(scene.overflow, undefined);
});
// 意图：构成图百分比遵循共享一位小数half-up格式化，原值仍保留量纲；窄donut ticks适配可读密度并保留中心读数。
test('pie and donut round shares to one decimal and keep units and readable ticks', () => {
  const spec = { chart: 'donut', variant: 'ticks', unit: '份', data: [{ c: 'A', v: 9.5 }, { c: 'B', v: 10.5 }, { c: 'C', v: 14 }], encode: { category: 'c', value: 'v' } };
  const wide = K.render({ chart: spec.chart, variant: spec.variant, data: spec.data, encode: spec.encode, fields: { v: { label: '数量', unit: '份' } } }, { width: 720 });
  assert.match(wide.svg, /数量/);
  assert.match(wide.svg, /9\.5份 \(27\.9%\)/);
  assert.match(wide.svg, /10\.5份 \(30\.9%\)/);
  assert.match(wide.svg, /14份 \(41\.2%\)/);
  assert.match(wide.svg, /34份/);
  assert.doesNotMatch(wide.svg, /Share|构成/);
  const unlabeled = K.render(spec, { width: 720 });
  assert.match(unlabeled.svg, />合计</);
  assert.match(unlabeled.svg, /34份/);
  const narrow = K.layout(spec, { width: 324 });
  const tickCount = walk(narrow.children, (node) => node.meta?.kind === 'donut-tick').length;
  assert.ok(tickCount > 96 && tickCount < 240, `324px uses a readable adaptive tick count, got ${tickCount}`);
  assert.equal(walk(narrow.children, (node) => node.tag === 'text' && node.text === '34份').length, 1);
  const pieScene = K.layout({ chart: 'pie', data: spec.data, encode: spec.encode }, { width: 324 });
  const pieRadius = Number(walk(pieScene.children, (node) => node.meta?.kind === 'pie')[0].attrs.d.match(/A([0-9.]+),/)[1]);
  assert.ok(pieRadius * 2 / pieScene.width >= 0.55, '324px pie diameter occupies at least 55% of available chart width');
  const legendGroup = pieScene.children.find((node) => node.attrs?.transform?.startsWith('translate('));
  const legendY = legendGroup.children.map((node) => Number(node.children?.[0]?.attrs?.y));
  assert.equal(new Set(legendY).size, legendY.length, 'narrow pie legend stacks every category on its own row');
  const radialScene = K.layout({ chart: 'radial-share', data: spec.data.map((row, i) => ({ ...row, intensity: i + 1 })), encode: { category: 'c', value: 'v', intensity: 'intensity' }, fields: { v: { unit: '份' }, intensity: { unit: '级' } } }, { width: 324 });
  const radialRadii = walk(radialScene.children, (node) => node.meta?.kind === 'radial-share').map((node) => Number(node.attrs.d.match(/A([0-9.]+),/)[1]));
  assert.ok(Math.max(...radialRadii) * 2 / radialScene.width >= 0.55, '324px radial-share diameter occupies at least 55% of available chart width');
  const radialLegend = radialScene.children.find((node) => node.attrs?.transform?.startsWith('translate('));
  const radialRowYs = radialLegend.children.map((node) => Number(node.children?.[0]?.attrs?.y));
  assert.equal(new Set(radialRowYs).size, radialRowYs.length, 'narrow radial-share legend stacks every category on its own row');
});

// 意图：宽画布里的弧形仪表放大到上限为止，居中且端点标签贴近弧；未达部分仍有浅色轨道。
test('wide arc gauges scale with the viewport, stay centered and keep endpoints next to the arc', () => {
  const scene = K.layout({ chart: 'gauge', variant: 'arc', range: [0, 100], data: [{ v: 68, t: 80 }], encode: { value: 'v', target: 't' } }, { width: 1040 });
  const reading = scene.children.find((node) => node.meta?.kind === 'gauge-reading');
  const min = scene.children.find((node) => node.meta?.kind === 'gauge-min');
  const max = scene.children.find((node) => node.meta?.kind === 'gauge-max');
  const arc = walk(scene.children, (node) => node.meta?.kind === 'gauge-arc')[0];
  const radius = Number(arc.attrs.d.match(/A([0-9.]+),/)[1]);
  assert.ok(radius > 150 && radius <= 200, `1040px arc grows past the donut size but stops at the 200px cap, got ${radius}`);
  assert.ok(walk(scene.children, (node) => node.meta?.kind === 'gauge-track').length === 1, 'the unreached part of the arc keeps a light track');
  assert.equal(Number(reading.attrs.x), scene.width / 2, 'gauge reading and arc are horizontally centered');
  assert.equal(Number(max.attrs.x) + Number(min.attrs.x), scene.width, 'range endpoints are symmetric about the chart center');
  assert.equal(Number(reading.attrs.y) - Number(min.attrs.y), 30, 'endpoint labels remain close to the arc and distinct from the reading');
  assert.ok(Number(max.attrs.y) < scene.height);
});

test('rose summary uses only explicit field labels and narrow charts reserve diameter and a stacked legend', () => {
  const { scene, svg } = K.render({ chart: 'rose', unit: '件', data: [{ c: 'A', v: 1 }, { c: 'B', v: 4 }], encode: { category: 'c', value: 'v' } }, { width: 324 });
  const texts = walk(scene.children, (node) => node.tag === 'text');
  const summary = texts.find((node) => node.text.includes('合计'));
  assert.ok(summary);
  assert.ok(Number(summary.attrs.y) > 148 + Math.min(116, 324 * 0.21), 'summary baseline is below the outermost sector');
  assert.ok(scene.children.indexOf(summary) < scene.children.findIndex((node) => node.attrs?.transform?.startsWith('translate(')), 'summary precedes the legend');
  assert.match(summary.text, /^合计 5件$/);
  assert.doesNotMatch(svg, /value · 合计/);
  const roseRadii = walk(scene.children, (node) => node.meta?.kind === 'rose').map((node) => Number(node.attrs.d.match(/A([0-9.]+),/)[1]));
  assert.ok(Math.max(...roseRadii) * 2 / scene.width >= 0.55, '324px rose maximum diameter occupies at least 55% of available chart width');
  const roseLegend = scene.children.find((node) => node.attrs?.transform?.startsWith('translate('));
  const rowYs = roseLegend.children.map((node) => Number(node.children?.[0]?.attrs?.y));
  assert.equal(new Set(rowYs).size, rowYs.length, 'narrow rose legend stacks each category on its own row');
  const labeled = K.render({ chart: 'rose', fields: { v: { label: '人数', unit: '件' } }, data: [{ c: 'A', v: 5 }], encode: { category: 'c', value: 'v' } });
  assert.match(labeled.svg, /人数 5件/);
  assert.doesNotMatch(labeled.svg, /人数 · 合计/);
});

// 意图：小格名称必须可追溯到底部编号表，且层级父值按叶和计算而非重复加入面积。
test('treemap and sunburst preserve every leaf name and computed parent weight', () => {
  const data = { label: 'Root', children: [{ label: 'Group', children: [{ label: 'Alpha', value: 2 }, { label: 'Beta', value: 1 }] }, { label: 'Gamma', value: 3 }] };
  for (const chart of ['treemap', 'sunburst']) {
    const { scene, svg } = K.render({ chart, data }, { width: 720 });
    const fallback = walk(scene.children, (node) => node.meta?.kind === `${chart}-name`);
    for (const name of ['Alpha', 'Beta', 'Gamma']) assert.match(svg, new RegExp(name));
    if (chart === 'treemap') {
      const embedded = walk(scene.children, (node) => node.meta?.kind === 'treemap-tile-label');
      assert.equal(embedded.length, 3, 'all spacious tiles show name and value directly');
      assert.ok(embedded.some((node) => node.text === 'Alpha · 2'), 'large leaf tile shows its name and value in place');
      assert.equal(fallback.length, 0, 'fully labeled tiles do not repeat in a bottom legend');
      assert.ok(walk(scene.children, (node) => node.meta?.kind === 'treemap-group-label').some((node) => node.text === 'Group'), 'parent grouping remains visible');
    } else {
      const rings = walk(scene.children, (node) => node.meta?.kind === 'sunburst-ring-label');
      assert.ok(rings.some((node) => node.meta.label === 'Group'), 'wide parent arc receives an in-ring name and value');
      assert.deepEqual(rings.map((node) => node.meta.label).sort(), ['Alpha', 'Beta', 'Gamma', 'Group']);
      assert.equal(fallback.length, 0, 'fully labeled arcs do not repeat in a bottom legend');
    }
    const weighted = walk(scene.children, (node) => node.meta?.kind === (chart === 'treemap' ? 'treemap-node' : 'sunburst-node'));
    assert.ok(weighted.some((node) => node.meta.label === 'Group' && node.meta.value === 3));
  }
});

// 意图：三层以上父节点缺省值时权重仍递归聚合；零值保留名称但不获得伪造面积，几何和比例有限且准确。
test('treemap fallback legend contains only compact tiles and matches their in-tile indexes', () => {
  const data = { label: '总计', children: ['甲一', '甲二', '乙一', '乙二'].map((label) => ({ label, value: 1 })) };
  const scene = K.layout({ chart: 'treemap', unit: '件', data }, { width: 268 });
  const inlineLabels = walk(scene.children, (node) => node.meta?.kind === 'treemap-tile-label');
  const indexes = walk(scene.children, (node) => node.meta?.kind === 'treemap-tile-index');
  const names = walk(scene.children, (node) => node.meta?.kind === 'treemap-name');
  assert.equal(inlineLabels.length, 0, 'tiles too small for a name and value defer to the index list');
  assert.equal(names.length, 4, 'all and only unlabelled tiles are listed');
  assert.deepEqual(indexes.map((node) => node.meta.index), names.map((node) => node.meta.index), 'tile numbers map one-to-one to the fallback labels');
  assert.ok(names.every((node, index) => node.meta.index === index + 1));
  const baselines = names.map((node) => Number(node.attrs.y));
  assert.ok(baselines.every((y, index) => index === 0 || y - baselines[index - 1] >= 16), 'treemap fallback entries stay in one column without collisions');
});

test('narrow sunburst labels fall back to numbered single-column entries rather than collide with the root', () => {
  const data = { label: '总计', children: [{ label: '甲组', children: [{ label: '甲一', value: 4 }, { label: '甲二', value: 3 }] }, { label: '乙组', children: [{ label: '乙一', value: 5 }, { label: '乙二', value: 2 }] }] };
  const scene = K.layout({ chart: 'sunburst', unit: '件', data }, { width: 268 });
  const ringLabels = walk(scene.children, (node) => node.meta?.kind === 'sunburst-ring-label');
  const indexes = walk(scene.children, (node) => node.meta?.kind === 'sunburst-ring-index');
  const names = walk(scene.children, (node) => node.meta?.kind === 'sunburst-name');
  assert.equal(ringLabels.length, 0, 'labels that cannot clear the center hub are moved to the external index');
  assert.equal(names.length, 6, 'every unlabelled branch and leaf is listed exactly once');
  assert.deepEqual(indexes.map((node) => node.meta.index), names.map((node) => node.meta.index), 'each in-ring number maps to the matching external name and value');
  const baselines = names.map((node) => Number(node.attrs.y));
  assert.ok(baselines.every(Number.isFinite));
  assert.ok(baselines.every((y, index) => index === 0 || y - baselines[index - 1] >= 16), 'fallback entries use one non-overlapping column');
});

test('nested treemap and sunburst aggregate leaf-only weights without zero-value geometry', () => {
  const data = { label: 'Root', children: [{ label: 'Branch', children: [{ label: 'Middle', children: [{ label: 'Two', value: 2 }, { label: 'One', value: 1 }, { label: 'Zero', value: 0 }] }] }, { label: 'Three', value: 3 }] };
  const finiteGeometry = (nodes) => {
    for (const node of nodes || []) {
      for (const value of Object.values(node.attrs || {})) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${node.tag} has non-finite geometry`);
      if (node.attrs?.d) assert.doesNotMatch(node.attrs.d, /NaN|Infinity/);
      finiteGeometry(node.children);
    }
  };
  for (const chart of ['treemap', 'sunburst']) {
    const { scene } = K.render({ chart, data }, { width: 720 });
    finiteGeometry(scene.children);
    const weighted = walk(scene.children, (node) => node.meta?.kind === (chart === 'treemap' ? 'treemap-node' : 'sunburst-node'));
    assert.equal(weighted.find((node) => node.meta.label === 'Branch').meta.value, 3);
    assert.equal(weighted.find((node) => node.meta.label === 'Middle').meta.value, 3);
    assert.equal(weighted.find((node) => node.meta.label === 'Root'), undefined);
    const names = walk(scene.children, (node) => node.meta?.kind === `${chart}-name`);
    const inline = chart === 'treemap'
      ? walk(scene.children, (node) => node.meta?.kind === 'treemap-tile-label').map((node) => node.meta.label)
      : walk(scene.children, (node) => node.meta?.kind === 'sunburst-ring-label').map((node) => node.meta.label);
    const represented = new Set([...names.map((node) => node.meta.label), ...inline]);
    for (const name of ['Two', 'One', 'Three']) assert.ok(represented.has(name), `${name} is directly annotated or listed only when its area cannot fit a label`);
    for (const name of inline) assert.equal(names.some((node) => node.meta.label === name), false, `${name} is not repeated in the fallback list`);
    const zero = names.find((node) => node.meta.label === 'Zero');
    assert.equal(zero.meta.value, 0);
    if (chart === 'treemap') {
      const leaves = walk(scene.children, (node) => node.meta?.kind === 'treemap-leaf');
      assert.equal(leaves.some((node) => node.meta.label === 'Zero'), false);
      const allocationWidth = (node) => node.attrs.width + 4; // 消除矩形内缩边距，比较布局分配而非描边面积。
      const two = allocationWidth(leaves.find((node) => node.meta.label === 'Two'));
      const one = allocationWidth(leaves.find((node) => node.meta.label === 'One'));
      assert.ok(Math.abs(two / one - 2) < 1e-9);
    } else {
      const arcs = walk(scene.children, (node) => node.meta?.kind === 'sunburst-node' && node.meta.depth === 3);
      assert.equal(arcs.length, 2);
      assert.deepEqual(arcs.map((node) => node.meta.value), [2, 1]);
      const center = scene.children.find((node) => node.tag === 'circle');
      const sweep = (node) => {
        const match = node.attrs.d.match(/^M([0-9.+-]+),([0-9.+-]+) A[0-9.+-]+,[0-9.+-]+ 0 [01] [01] ([0-9.+-]+),([0-9.+-]+)/);
        assert.ok(match, `expected an annular sector path: ${node.attrs.d}`);
        const angle = (x, y) => Math.atan2(Number(y) - center.attrs.cy, Number(x) - center.attrs.cx);
        return (angle(match[3], match[4]) - angle(match[1], match[2]) + Math.PI * 2) % (Math.PI * 2);
      };
      const two = walk(scene.children, (node) => node.meta?.kind === 'sunburst-node' && node.meta.label === 'Two')[0];
      const one = walk(scene.children, (node) => node.meta?.kind === 'sunburst-node' && node.meta.label === 'One')[0];
      const three = walk(scene.children, (node) => node.meta?.kind === 'sunburst-node' && node.meta.label === 'Three')[0];
      assert.ok(Math.abs(sweep(two) / sweep(one) - 2) < 1e-9, 'sunburst sector angle follows leaf weight');
      assert.equal(two.attrs.fill, one.attrs.fill, 'leaves in a root branch share a color family');
      assert.notEqual(two.attrs.fill, three.attrs.fill, 'different root branches have distinct colors');
      const swatchFor = (label) => {
        const name = walk(scene.children, (node) => node.meta?.kind === 'sunburst-name').find((node) => node.meta.label === label);
        if (!name) return null;
        const textIndex = scene.children.findIndex((node) => node.children?.some((child) => child.meta?.kind === 'sunburst-name' && child.meta.label === label));
        return scene.children[textIndex - 1].attrs.fill;
      };
      assert.ok(swatchFor('Zero'), 'zero-weight leaf remains represented in the fallback list');
      for (const [label, sector] of [['Two', two], ['One', one], ['Three', three]]) {
        if (inline.includes(label)) assert.equal(swatchFor(label), null, `${label} has no redundant fallback swatch`);
        else assert.equal(swatchFor(label), sector.attrs.fill, `${label} fallback swatch matches its sector color`);
      }
    }
  }
});

// 意图：单一正值需要闭合整圆的双段arc，零值类别不能产生伪造扇区。
test('full-circle pie, donut and sunburst paths render a sole positive category', () => {
  for (const chart of ['pie', 'donut']) {
    const { scene } = K.render({ chart, data: [{ c: 'Positive', v: 5 }, { c: 'Zero', v: 0 }], encode: { category: 'c', value: 'v' } });
    const slices = walk(scene.children, (node) => node.tag === 'path' && node.meta?.kind === chart);
    assert.equal(slices.length, 1);
    assert.equal((slices[0].attrs.d.match(/ A/g) || []).length, chart === 'pie' ? 2 : 4);
    assert.doesNotMatch(slices[0].attrs.d, /NaN|Infinity/);
  }
  const { scene } = K.render({ chart: 'sunburst', data: { label: 'Root', children: [{ label: 'Only', value: 5 }] } });
  const only = walk(scene.children, (node) => node.meta?.kind === 'sunburst-node');
  assert.equal(only.length, 1);
  assert.equal((only[0].attrs.d.match(/ A/g) || []).length, 4);
  assert.doesNotMatch(only[0].attrs.d, /NaN|Infinity/);
});

// 意图：强度严格从0映射，最小非零强度不塌缩到内半径。
test('radial-share maps nonzero intensities from a zero baseline', () => {
  const { scene } = K.render({ chart: 'radial-share', data: [{ c: 'Low', v: 1, i: 2 }, { c: 'High', v: 1, i: 4 }], encode: { category: 'c', value: 'v', intensity: 'i' }, fields: { v: { unit: '件' }, i: { unit: '指数' } } });
  const paths = walk(scene.children, (node) => node.meta?.kind === 'radial-share');
  assert.equal(paths.length, 2);
  const radii = paths.map((node) => Number(node.attrs.d.match(/A([0-9.]+),/)[1]));
  assert.ok(radii.every((radius) => radius > 44));
  assert.ok(radii[0] < radii[1]);
  const { scene: constantScene } = K.render({ chart: 'radial-share', data: [{ c: 'Same', v: 1, i: 2 }, { c: 'Same too', v: 1, i: 2 }], encode: { category: 'c', value: 'v', intensity: 'i' }, fields: { v: { unit: '件' }, i: { unit: '指数' } } });
  const constantRadii = walk(constantScene.children, (node) => node.meta?.kind === 'radial-share').map((node) => Number(node.attrs.d.match(/A([0-9.]+),/)[1]));
  assert.ok(constantRadii.every((radius) => radius > 44), 'a nonzero hi=lo domain maps to a visible radius');
});

// 意图：图族自有说明文案遵循共享ctx.lang，而不是固定输出中文。
test('composition chart annotations follow the requested English locale', () => {
  const cases = [
    [{ chart: 'donut', data: [{ c: 'A', v: 1 }], encode: { category: 'c', value: 'v' } }, /Total/],
    [{ chart: 'radial-share', data: [{ c: 'A', v: 1, i: 2 }], encode: { category: 'c', value: 'v', intensity: 'i' }, fields: { v: { unit: '件' }, i: { unit: '指数' } } }, /Angle = share.*Radius = intensity/s],
    [{ chart: 'rose', data: [{ c: 'A', v: 1 }], encode: { category: 'c', value: 'v' } }, /Total/],
    [{ chart: 'gauge', range: [0, 10], data: [{ v: 5, t: 7 }], encode: { value: 'v', target: 't' } }, /Target/],
  ];
  for (const [spec, expected] of cases) assert.match(K.render(spec, { lang: 'en' }).svg, expected);
});

const hexIn = (value) => String(value).match(/#[0-9a-f]{6}/gi).at(-1);
const THEMES = ['claude', 'paper', 'obsidian', 'tokyo', 'kanagawa', 'terminal'];

// 意图：矩形树图和旭日图压在序列色上的名称与编号，六主题下对各自填充色都达到 4.5:1。
test('treemap and sunburst labels keep body-text contrast on every tile fill', () => {
  const data = { label: 'Root', children: Array.from({ length: 6 }, (_, i) => ({ label: `Leaf${i + 1}`, value: 6 - i })) };
  for (const theme of THEMES) {
    const tree = K.layout({ chart: 'treemap', data }, { width: 720, theme });
    const tiles = walk(tree.children, (node) => node.meta?.kind === 'treemap-leaf');
    const tileText = walk(tree.children, (node) => ['treemap-tile-label', 'treemap-tile-index'].includes(node.meta?.kind));
    assert.ok(tileText.length >= 4, `${theme}: most tiles carry inline text`);
    for (const text of tileText) {
      const tile = tiles.find((node) => node.meta.path === text.meta.path);
      assert.ok(K.util.contrast(hexIn(text.attrs.fill), hexIn(tile.attrs.fill)) >= 4.5, `${theme}: ${text.text} on ${tile.attrs.fill}`);
    }
    const sun = K.layout({ chart: 'sunburst', data }, { width: 720, theme });
    const rings = walk(sun.children, (node) => node.meta?.kind === 'sunburst-node');
    const ringText = walk(sun.children, (node) => ['sunburst-ring-label', 'sunburst-ring-index'].includes(node.meta?.kind));
    assert.ok(ringText.length >= 4, `${theme}: most rings carry inline text`);
    for (const text of ringText) {
      const ring = rings.find((node) => node.meta.path === text.meta.path);
      assert.ok(K.util.contrast(hexIn(text.attrs.fill), hexIn(ring.attrs.fill)) >= 4.5, `${theme}: ${text.text} on ${ring.attrs.fill}`);
    }
  }
});

// 意图：长根名按词换行留在中心孔内，放不下时整段移到圆外；细扇区不画字，名称只出现在索引。
test('sunburst centre wraps inside the hole and omits labels that cannot fit a segment', () => {
  const longRoot = 'North America enterprise procurement programme';
  const data = {
    label: longRoot,
    children: [
      { label: 'Alpha', value: 8 },
      { label: 'Beta', value: 0.01 },
      { label: 'Gamma', children: [{ label: 'Leaf', value: 0.02 }, { label: 'Other', value: 0.02 }] },
    ],
  };
  const scene = K.layout({ chart: 'sunburst', data }, { width: 360 });
  const centre = walk(scene.children, (node) => node.meta?.kind === 'sunburst-centre');
  assert.ok(centre.length >= 1 && centre.length <= 6, 'root name wraps by words instead of one character per line');
  assert.equal(centre.map((node) => node.text).join(' '), longRoot);
  assert.ok(centre.every((node) => node.text.length > 1 || longRoot.length === 1));
  const hub = walk(scene.children, (node) => node.tag === 'circle')[0];
  const inside = centre.every((node) => Math.hypot(node.attrs.x - hub.attrs.cx, node.attrs.y - hub.attrs.cy) < hub.attrs.r);
  const below = Math.min(...centre.map((node) => node.attrs.y)) > hub.attrs.cy + hub.attrs.r;
  assert.ok(inside || below, 'centre text stays inside the measured hole or moves wholly outside it');
  const sliver = walk(scene.children, (node) => node.meta?.kind === 'sunburst-node' && node.meta.label === 'Beta')[0];
  const sliverText = walk(scene.children, (node) => node.tag === 'text' && node.meta?.path === sliver.meta.path && node.meta.kind !== 'sunburst-name');
  assert.equal(sliverText.length, 0, 'a segment that cannot hold 12px text is left blank');
  assert.ok(walk(scene.children, (node) => node.meta?.kind === 'sunburst-name' && node.meta.label === 'Beta').length === 1);
});

// 意图：环图中心以合计数值为主读数、说明为次信息；仪表量程端点按刻度格式显示，不带读数的小数位。
test('donut centers lead with the total and gauge endpoints use tick formatting', () => {
  const donut = K.layout({ chart: 'donut', unit: '份', data: [{ c: 'A', v: 9.5 }, { c: 'B', v: 10.5 }], encode: { category: 'c', value: 'v' } }, { width: 558 });
  const caption = walk(donut.children, (node) => node.tag === 'text' && node.text === '合计')[0];
  const total = walk(donut.children, (node) => node.tag === 'text' && node.text === '20份')[0];
  assert.ok(total.attrs['font-size'] > caption.attrs['font-size'], 'total is the larger reading');
  assert.ok(total.attrs.y > caption.attrs.y, 'caption sits above the total');
  assert.equal(caption.attrs.x, total.attrs.x);
  for (const variant of ['bar', 'arc', 'ticks']) {
    const { svg } = K.render({ chart: 'gauge', variant, range: [0, 1], fields: { s: { format: 'percent' } }, data: [{ s: 0.68 }], encode: { value: 's' } }, { width: 558 });
    assert.match(svg, />0%</, `${variant}: min endpoint`);
    assert.match(svg, />100%</, `${variant}: max endpoint`);
    assert.match(svg, />68\.0%</, `${variant}: reading keeps its own precision`);
  }
});

// 意图：宽画布把图例放到饼的右侧并垂直居中；窄画布仍把图例排在下方，直径不被侧栏挤掉。
test('wide pies place a measured legend beside the chart and narrow pies keep it below', () => {
  const spec = { chart: 'pie', data: [{ c: '甲', v: 3 }, { c: '乙', v: 2 }, { c: '丙', v: 1 }], encode: { category: 'c', value: 'v' } };
  const wide = K.layout(spec, { width: 1040 });
  const legend = wide.children.find((node) => node.attrs?.transform?.startsWith('translate('));
  const [, legendX, legendY] = legend.attrs.transform.match(/translate\(([-\d.]+)[, ]+([-\d.]+)/);
  const slice = walk(wide.children, (node) => node.meta?.kind === 'pie')[0];
  const radius = Number(slice.attrs.d.match(/A([\d.]+),/)[1]);
  assert.ok(Number(legendX) > radius * 2, 'legend sits to the right of the pie');
  assert.ok(Math.abs(Number(legendY) + 24 - (radius + 36)) < radius, 'legend is vertically near the pie center');
  const narrow = K.layout(spec, { width: 324 });
  const below = narrow.children.find((node) => node.attrs?.transform?.startsWith('translate('));
  const narrowRadius = Number(walk(narrow.children, (node) => node.meta?.kind === 'pie')[0].attrs.d.match(/A([\d.]+),/)[1]);
  assert.ok(Number(below.attrs.transform.match(/[-\d.]+/g)[1]) > narrowRadius, 'narrow legend stays below the pie');
  assert.ok(narrowRadius * 2 / narrow.width >= 0.55, 'narrow diameter is not reduced by a side legend');
});

// 意图：目标靠近量程右端时，标注锚向弧内，右端不超出场景；条形读数与条对齐。
test('gauge target labels near the range end stay inside and bar readings align with the bar', () => {
  const ticks = K.layout({ chart: 'gauge', variant: 'ticks', range: [0, 1], fields: { value: { format: 'percent' }, target: { format: 'percent' } }, data: [{ value: 0.2, target: 0.99 }], encode: { value: 'value', target: 'target' } }, { width: 240, lang: 'en' });
  const target = ticks.children.find((node) => node.meta?.kind === 'gauge-target');
  const max = ticks.children.find((node) => node.meta?.kind === 'gauge-max');
  assert.equal(target.attrs['text-anchor'], 'end', 'a target near the right end anchors inward');
  assert.ok(Number(target.attrs.x) <= Number(max.attrs.x) + 24, 'the target anchor does not sit past the arc end');
  const bar = K.layout({ chart: 'gauge', variant: 'bar', range: [0, 100], unit: '单', data: [{ value: 56, target: 77 }], encode: { value: 'value', target: 'target' } }, { width: 300 });
  const track = bar.children.find((node) => node.tag === 'rect' && node.meta?.kind !== 'gauge-value');
  const reading = bar.children.find((node) => node.meta?.kind === 'gauge-reading');
  assert.equal(Number(reading.attrs.x), Number(track.attrs.x), 'a reading that fits the bar starts at the bar');
});
