import assert from 'node:assert/strict';
import { test } from 'vitest';
import vm from 'node:vm';
import { browserSource, catalog, createRenderer, modulesFor, parse, render, schema, validate } from '../dist/esm/node.js';

const bar = { chart: 'bar', title: '华东收入', data: [{ region: '华东', sales: 1200000 }], encode: { category: 'region', value: 'sales' }, unit: '元' };

// 入口在无 DOM 环境中运行；即使同页有其他渲染器，也不会加载或读取它们的全局变量。
test('完整入口与按声明选择的入口共用同一实现', () => {
  const roots = modulesFor([bar]);
  assert.ok(roots.includes('chart/basic'));
  for (const absent of ['chart/maps', 'chart/statistics', 'chart/unit-variants', 'core/icon-data', 'interaction']) {
    assert.ok(!roots.includes(absent), absent);
  }
  const previous = {};
  const world = vm.createContext({ HtmlChart: previous, HtmlDiagram: previous, HtmlIcons: previous });
  vm.runInContext(browserSource([bar]), world);
  assert.equal(world.HtmlChart, previous);
  assert.equal(world.HtmlDiagram, previous);
  assert.equal(world.HtmlIcons, previous);
  assert.equal(vm.runInContext('typeof document', world), 'undefined');
  assert.equal(world.KChart.attach, undefined);
  assert.equal(world.KChart.render(bar).svg, render(bar).svg);
  assert.match(render(bar).svg, /120\.0万元/);
  assert.doesNotMatch(render(bar).svg, /var\(--viz-/);
  assert.deepEqual([...createRenderer().layouts.keys()].sort(), Object.keys(catalog).sort());
  assert.equal(Object.keys(catalog).length, 45);
  const scoped = schema('bar');
  assert.deepEqual(scoped.properties.chart.enum, ['bar']);
  assert.equal(scoped.anyOf.length, 1);
  assert.equal(scoped.allOf.length, 1);
  assert.equal(scoped.anyOf[0].properties.chart.const, 'bar');
  assert.equal(scoped.allOf[0].if.properties.chart.const, 'bar');
  assert.throws(() => schema('not-a-chart'), /未知图型/);
  assert.throws(() => catalog.bar.special.variant.push('other'), /not extensible|read only/);
  assert.deepEqual(parse(JSON.stringify(bar)).data, bar);
});

// 装入变体与阅读交互时也使用相同闭包；变体不能在精简渲染器上悄悄退回默认构图。
test('图标、受控变体和阅读交互按声明装入', () => {
  const pictorial = {
    ...bar, interaction: ['inspect'], data: [{ region: '甲', sales: 5 }],
    variant: 'pictorial', unitMark: { icon: 'users', label: '件', value: 2 },
  };
  const roots = modulesFor([pictorial]);
  assert.ok(roots.includes('core/icon-data') && roots.includes('interaction'));
  assert.ok(roots.indexOf('chart/basic') < roots.indexOf('chart/unit-variants'));
  assert.ok(!roots.includes('chart/maps'));
  assert.equal(modulesFor([{ ...bar, interaction: ['inspect'] }, pictorial, { chart: 'choropleth' }]).at(-1), 'interaction');
  assert.ok(!modulesFor([{ ...bar, variant: 'solid' }]).includes('chart/unit-variants'));
  const loaded = createRenderer({ specs: [pictorial] });
  const result = loaded.render(pictorial);
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.svg, /clip-path/);
  assert.equal(result.svg, render(pictorial).svg);
  assert.match(loaded.bundleSource(), /KChart 离线渲染库/);
  assert.equal(vm.runInNewContext(`${loaded.bundleSource()} typeof KChart.attach`), 'function');
  const rejected = createRenderer({ specs: [bar] }).render(pictorial);
  assert.equal(rejected.svg, null);
  assert.equal(rejected.diagnostics[0].code, 'BAD_KCHART');
  assert.equal(rejected.diagnostics[0].path, '/variant');
  assert.equal(createRenderer({ specs: [bar] }).render({ ...bar, variant: 'solid' }).svg, render({ ...bar, variant: 'solid' }).svg);
});

// 不合法的字段要返回可定位的诊断；内置地图只读名单指定的本地文件，由宿主提供时不读盘。
test('渲染错误不产出 SVG；只解析受控地图数据', () => {
  const invalid = render({ ...bar, color: 'red' });
  assert.equal(invalid.svg, null);
  assert.equal(invalid.scene, null);
  assert.equal(invalid.diagnostics[0].path, '/color');
  const accessed = [];
  const reader = createRenderer({ readMap: (file) => {
    accessed.push(file);
    return '{"type":"FeatureCollection","features":[]}';
  } });
  const validMap = { chart: 'choropleth', data: { map: { asset: 'world' }, rows: [{ region: 'x', value: 1 }] }, encode: { region: 'region', value: 'value' } };
  assert.deepEqual(reader.assets(validMap), { world: { type: 'FeatureCollection', features: [] } });
  assert.throws(() => reader.assets({ data: { map: { asset: 'nonexistent' } } }), /不支持的内置地图/);
  reader.render({ ...validMap, data: { ...validMap.data, map: { asset: 'us-states' } } }, { assets: { 'us-states': { type: 'FeatureCollection', features: [] } } });
  assert.deepEqual(accessed, ['world.geojson']);
});

// 错误字段给出确切路径；异常不是用「坏数据」包装内部故障。
test('解析区分 JSON 错误、声明诊断和内部异常', () => {
  const syntax = parse('{"chart":');
  assert.equal(syntax.data, null);
  assert.match(syntax.errors[0].message, /JSON 语法错误/);
  const duplicate = parse('{"data":[{"a/~":1,"\\u0061/~":2}]}');
  assert.equal(duplicate.errors[0].path, '/data/0/a~1~0');
  assert.equal(duplicate.errors[0].location.offset, 18);
  const malformed = { ...bar, fields: { sales: { domain: [0, 2000000] } }, annotations: [null] };
  assert.ok(validate(malformed).errors.some(({ path }) => path === '/annotations/0'));
  const fault = new Error('无法读取内部对象');
  const record = { get region() { throw fault; }, sales: 1 };
  assert.throws(() => validate({ ...bar, data: [record] }), (error) => error === fault);
  assert.throws(() => render({ ...bar, data: [record] }), (error) => error === fault);
});
