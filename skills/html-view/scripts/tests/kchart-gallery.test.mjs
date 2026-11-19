import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KCHART_CASES } from '../../../../packages/kchart/tests/kchart-cases.mjs';
import { catalog, createRenderer } from '../../vendor/kchart/esm/node.js';
import { geometryFailures, inspectVariantImplementation, measurementExpression, pageInspectionExpression, parseArgs, selectGalleryCases } from '../lab/regression/kchart-gallery.mjs';

const renderer = createRenderer();

// 意图：固定 coverage 表51个ID，避免ID缺项、重复映射或某catalog图型没有真实输入。
test('gallery fixtures cover all 51 exact reference IDs and every catalog chart', () => {
  const ids = KCHART_CASES.flatMap(item => item.referenceIds);
  const expected = ['G3','G4','G5','G6','G7','G8','G9','G10','G11','G12','G13','G14','G15','G16','G17','G18','G19','G20','G21','G22','L1','L2','L3','L4','L13','L14','L15','L17','L20','F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12','F13','F14','F15','F16','F17','M1','M2','B1','B2','B3'].sort();
  assert.equal(ids.length, 51);
  assert.deepEqual([...new Set(ids)].sort(), expected);
  assert.equal(KCHART_CASES.length, 101, 'the full gallery count includes the sparse full-year calendar regression fixture');
  assert.equal(new Set(KCHART_CASES.map(item => item.id)).size, KCHART_CASES.length);
  const sparseCalendar = KCHART_CASES.find(item => item.id === 'edge-calendar-sparse-year');
  assert.equal(sparseCalendar.spec.data.length, 122);
  assert.ok(sparseCalendar.spec.data.some(row => row.value === 0));
  for (const name of Object.keys(catalog)) assert.ok(KCHART_CASES.some(item => item.spec.chart === name), `${name} has an input`);
});

// 意图：变体与8脑图布局必须逐项独立呈现，避免用默认图冒充variant或跨布局复用其他输入。
test('every deterministic fixture passes the public strict KChart validator', () => {
  for (const item of KCHART_CASES) {
    const result = renderer.validate(item.spec);
    assert.deepEqual(result.errors, [], `${item.id}: ${JSON.stringify(result.errors)}`);
  }
});

test('gallery fixtures enumerate every controlled variant and all eight mind-map layouts', () => {
  for (const [chart, contract] of Object.entries(catalog)) {
    for (const variant of contract.special.variant || []) assert.ok(KCHART_CASES.some(item => item.spec.chart === chart && item.spec.variant === variant), `${chart}.${variant} has a dedicated case`);
  }
  const layouts = KCHART_CASES.filter(item => item.spec.chart === 'mindmap' && item.id.startsWith('mindmap-'));
  assert.deepEqual(layouts.map(item => item.spec.layout).sort(), ['bilateral', 'brace', 'fishbone', 'left', 'org', 'radial', 'right', 'timeline']);
  assert.equal(new Set(layouts.map(item => JSON.stringify(item.spec.data))).size, 1, 'all layouts use exactly the same source tree');
});

// 意图：运行时校验确认变体有效，实际scene差异确认变体有行为；显式默认别名除外，schema许可本身不够。
test('variant gate rejects accepted-but-unimplemented variants and recognizes loaded behavior', () => {
  const status = (chart, variant, target = renderer, options = { width: 324, theme: 'claude', frame: true }) => {
    const input = chart === 'network'
      ? { layout: 'circular', data: { nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ source: 'a', target: 'b', value: 2 }] } }
      : chart === 'mindmap'
        ? { data: { label: 'root', children: [{ label: 'leaf' }] } }
        : chart === 'gauge'
          ? { data: [{ value: 3 }], encode: { value: 'value' }, range: [0, 5] }
          : { data: [{ category: 'A', value: 2 }, { category: 'B', value: 4 }], encode: { category: 'category', value: 'value' } };
    return inspectVariantImplementation(target, { chart, variant, ...input }, options);
  };
  assert.equal(status('line', 'counter').supported, true);
  // 意图：源码不可读时运行时判定仍可独立工作，覆盖不依赖bundle字面量或源码格式的回归。
  const unavailableSourceRenderer = {
    validate: (...args) => renderer.validate(...args),
    render: (...args) => renderer.render(...args),
    layouts: renderer.layouts,
    bundleSource: () => { throw new Error('源码不可用'); },
  };
  assert.equal(status('line', 'counter', unavailableSourceRenderer).supported, true);
  // 意图：几何探测的两次渲染均沿用原始measure回调，避免改变文本度量而误判几何差异。
  const measure = () => 7;
  const passedOptions = [];
  const measuredRenderer = {
    validate: (...args) => renderer.validate(...args),
    render: (spec, options) => { passedOptions.push(options); return renderer.render(spec, options); },
    layouts: renderer.layouts,
  };
  assert.equal(status('line', 'counter', measuredRenderer, { width: 324, measure }).supported, true);
  assert.equal(passedOptions.length, 2);
  assert.ok(passedOptions.every(options => options.measure === measure));
  // 明确卸载实现模块，保留“仅通过 schema 不代表已实现”的负向门禁。
  const basicOnly = createRenderer({ specs: [{ chart: 'line' }] });
  assert.equal(status('line', 'counter', basicOnly).supported, false);
  assert.equal(status('gauge', 'ticks').supported, true);
  assert.equal(status('mindmap', 'editorial').supported, true);
  assert.equal(status('mindmap', 'cards').supported, true);
  assert.equal(status('network', 'membrane').supported, true);
  for (const item of KCHART_CASES.filter(item => item.spec.variant)) {
    assert.equal(inspectVariantImplementation(renderer, item.spec).supported, true, `${item.id} (${item.spec.chart}.${item.spec.variant})`);
  }
});

// 意图：几何门禁应把溢出、坏路径和viewBox外标签转成失败；标签互盖保持为目检候选，不误报硬失败。
test('geometry gate distinguishes hard geometry failures from overlap candidates', () => {
  assert.doesNotThrow(() => new Function(pageInspectionExpression()), 'the injected browser geometry inspector is syntactically valid');
  // 字体测量是全部成图的入口；引号和特殊文本不能使注入脚本失效。
  assert.doesNotThrow(() => new Function(measurementExpression([{ text: `引号'"\\</script>`, size: 12, weight: 400 }])));
  assert.match(pageInspectionExpression(), /getBBox\(\).*getCTM\(\)/);
  assert.deepEqual(geometryFailures({ horizontalOverflow: false, svg: {}, invalidGeometry: [], outOfViewBoxText: [], labelOverlapCandidates: [{ first: '甲', second: '乙' }] }), []);
  assert.deepEqual(geometryFailures({ horizontalOverflow: true, svg: { viewBox: { x: 0, y: 0, width: 20, height: 10 } }, invalidGeometry: [{ tag: 'path' }], outOfViewBoxText: [{ text: '超界' }] }), ['整页存在水平溢出', '存在非有限/非法几何 1 项', 'SVG text超出viewBox 1 项']);
  assert.ok(geometryFailures({ horizontalOverflow: false, svg: { viewBox: { x: 0, y: 0, width: 0, height: 10 } }, invalidGeometry: [], outOfViewBoxText: [] }).includes('viewBox尺寸非正数'));
  assert.ok(geometryFailures({ horizontalOverflow: false, invalidGeometry: [], outOfViewBoxText: [] }).includes('页面中缺少SVG'));
});

// 意图：过滤器只生成请求的有效组合，未知项和非法宽度早失败，不可能静默全量生成。
test('CLI filters select only requested cases, themes, and viewport widths', () => {
  const args = parseArgs(['--out', '/tmp/gallery', '--case', 'chart-line', '--theme', 'obsidian', '--width', '324']);
  assert.deepEqual(args, { out: '/tmp/gallery', caseIds: ['chart-line'], themes: ['obsidian'], widths: [324] });
  const selected = selectGalleryCases(args);
  assert.deepEqual(selected.cases.map(item => item.id), ['chart-line']);
  assert.deepEqual(selected.themes, ['obsidian']);
  assert.deepEqual(selected.widths, [324]);
  assert.equal(selectGalleryCases({ caseIds: ['chart-line', 'chart-line'], themes: ['obsidian', 'obsidian'], widths: [324, 324] }).cases.length, 1);
  assert.throws(() => selectGalleryCases({ caseIds: ['missing'] }), /未知case/);
  assert.throws(() => selectGalleryCases({ widths: [800] }), /width只允许/);
});

// 意图：全主题验收可以显式选择任一主题，默认仍只生成默认亮暗主题，未知主题早失败。
test('gallery accepts every shipped theme while defaulting to the light and dark defaults', () => {
  const defaults = selectGalleryCases();
  assert.equal(defaults.cases.length, 101);
  assert.deepEqual(defaults.widths, [1040, 558, 324]);
  assert.deepEqual(defaults.themes, ['claude', 'obsidian']);
  const all = Object.keys(renderer.themes);
  assert.deepEqual(selectGalleryCases({ caseIds: ['chart-line'], themes: all }).themes, all);
  assert.throws(() => selectGalleryCases({ themes: ['solarized'] }), /theme只允许/);
});

// 意图：密集输入与已知语义反例固定存在，以防gallery退化为纯轻量成功样例。
test('gallery includes compatibility, data-quality, and dense network stress cases', () => {
  const byId = new Map(KCHART_CASES.map(item => [item.id, item]));
  for (const id of ['edge-default-legacy-17', 'edge-dual-axis', 'edge-missing-month', 'edge-outlier', 'edge-long-chinese-decimals', 'edge-duplicate-labels-and-ids', 'edge-force-180-nodes', 'edge-positive-negative']) assert.ok(byId.has(id), `${id} exists`);
  assert.equal(byId.get('edge-force-180-nodes').spec.data.nodes.length, 180);
  assert.equal(byId.get('edge-force-180-nodes').spec.data.edges.length, 240);
  // 连续段、孤立点和两处缺月同时存在，才能检查断线而非补零。
  assert.deepEqual(byId.get('edge-missing-month').spec.data.map(row => row.value), [2, 4, null, 5, null, 6, 7]);
});
