import assert from 'node:assert/strict';
import { test } from 'vitest';
import { implementations } from '../src/diagram/mindmap.js';
import { validate, schema } from '../src/chart/spec.js';
import { render } from '../src/chart/registry.js';

const implementation = implementations.mindmap;
const { parse } = implementation;

// The six statuses belong to both hierarchical chart types, but not unrelated node contracts.
test('mindmap and tree statuses are accepted, constrained, and represented in their schemas', () => {
  const mindmap = { chart: 'mindmap', data: { label: 'Root', children: [{ label: 'Leaf', status: 'danger' }] } };
  const tree = { chart: 'tree', data: { label: 'Root', children: [{ label: 'Leaf', status: 'new' }] } };
  assert.equal(validate(mindmap).errors.length, 0);
  assert.equal(validate(tree).errors.length, 0);
  assert.ok(validate({ ...mindmap, data: { label: 'Root', status: 'unknown' } }).errors.some(e => e.path === '/data/status'));
  assert.ok(validate({ chart: 'network', data: { nodes: [{ id: 'a', status: 'new' }], edges: [] } }).errors.some(e => /未知节点字段/.test(e.message)));
  for (const chart of ['mindmap', 'tree']) {
    const node = schema(chart).$defs[`${chart}Node`];
    assert.deepEqual(Array.from(node.properties.status.enum), ['new', 'info', 'ok', 'warn', 'danger', 'ext']);
  }
  const allSchema = schema();
  for (const chart of ['mindmap', 'tree']) assert.ok(allSchema.anyOf.find(branch => branch.properties.chart.const === chart).properties.data.$ref);
});

// This checks the DSL seam directly with deterministic support/spec modules, before shared manifest wiring.
test('Mermaid mindmap parses one root, shapes, Markdown breaks, statuses, aliases, and all layouts', () => {
  const body = 'root((搜索能力))\n  retrieve{{召回}}\n    vector[向量<br>召回]\n    :::new\n  rerank(排序)\n  api_v2_auth';
  const parsed = parse(body, { firstLine: 4, title: '搜索能力', layout: 'brace', lang: 'zh' });
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.model.title, '搜索能力');
  assert.equal(parsed.model.layout, 'brace');
  assert.equal(parsed.model.data.label, '搜索能力');
  assert.equal(parsed.model.data.children[0].label, '召回');
  assert.equal(parsed.model.data.children[0].children[0].label, '向量\n召回');
  assert.equal(parsed.model.data.children[0].children[0].status, 'new');
  assert.equal(parsed.model.data.children[2].label, 'api_v2_auth', '普通标签保留下划线');
  const geometry = implementation.layout(parsed.model, { renderOptions: { width: 104 } });
  assert.equal(implementation.scene(geometry).layout, 'brace');
  // Match diagram/source.prepareSource output while that independent module remains unmerged here.
  const prepared = { kind: 'mindmap', header: 'mindmap', headerLine: 6, firstLine: 7, title: '预处理标题', layout: 'radial', options: {}, body: 'root((主线<br/>分支))\n  child' };
  const sourced = parse(prepared.body, prepared);
  assert.equal(sourced.errors.length, 0);
  assert.equal(sourced.model.title, '预处理标题');
  assert.equal(sourced.model.layout, 'radial');
  assert.equal(sourced.model.data.label, '主线\n分支');
  for (const alias of ['tidy-tree', 'dagre', 'elk']) {
    assert.equal(parse('root(root)', { layout: alias }).model.layout, 'bilateral');
  }
  for (const layout of ['bilateral', 'right', 'left', 'radial', 'org', 'brace', 'fishbone', 'timeline']) {
    assert.equal(parse('root(root)', { layout }).model.layout, layout);
  }
  const unsupportedHeader = parse('root(root)', { headerLine: 3, options: { style: 'round' } });
  assert.ok(unsupportedHeader.errors.some(e => e.line === 3 && /不支持选项/.test(e.message)));
  assert.ok(parse('root(root)', { layout: 'unknown' }).errors.some(e => /不支持脑图布局/.test(e.message)));
});

// Invalid decorations must be diagnosed, and limits/errors preserve every source node and its line.
test('mindmap rejects invalid decorations and declarations without dropping source nodes', () => {
  const badDecoration = parse('root(root)\n  :::className', { firstLine: 10 });
  assert.ok(badDecoration.errors.some(e => e.line === 11 && /状态标记/.test(e.message)));
  assert.ok(badDecoration.errors.some(e => e.path === '/data/children/0' || e.line === 11));

  const many = ['root(root)', ...Array.from({ length: 80 }, (_, i) => `  node${i}`)].join('\n');
  const tooMany = parse(many, { firstLine: 2 });
  assert.equal(tooMany.model.data.children.length, 80);
  assert.ok(tooMany.errors.some(e => e.line === 82 && /80/.test(e.message)));

  const deep = parse('a(root)\n  b\n    c\n      d\n        e\n          f', { firstLine: 20 });
  assert.ok(deep.errors.some(e => e.line === 25 && /层/.test(e.message)));
  assert.equal(deep.model.data.children[0].children[0].children[0].children[0].children[0].label, 'f');
  assert.ok(parse('one\ntwo').errors.some(e => /根节点/.test(e.message)));
});

test('all eight shared layouts render narrow, state-marked diagrams while state-free nodes remain unchanged', () => {
  const layouts = ['bilateral', 'right', 'left', 'radial', 'org', 'brace', 'fishbone', 'timeline'];
  for (const layout of layouts) {
    const spec = { chart: 'mindmap', layout, data: { label: 'Root', children: [{ label: 'Long child label', status: 'new' }] } };
    const result = render(spec, { width: 104 });
    assert.equal(result.diagnostics.length, 0, layout);
    assert.equal(result.scene.layout, layout);
    assert.equal(result.scene.nodes[1].status, 'new');
    assert.match(result.svg, />\+<\/text>/);
    assert.ok(result.scene.width > 0 && result.scene.height > 0);

    const plain = render({ chart: 'mindmap', layout, data: { label: 'Root', children: [{ label: 'Long child label' }] } }, { width: 104 });
    assert.equal(plain.diagnostics.length, 0, `${layout} without status`);
    assert.equal(Object.hasOwn(plain.scene.nodes[1], 'status'), false);
    assert.doesNotMatch(plain.svg, />\+<\/text>/);
    assert.equal(render({ chart: 'mindmap', layout, data: { label: 'Root', children: [{ label: 'Long child label' }] } }, { width: 104 }).svg, plain.svg);
  }
  const marks = { new: '+', info: '~', ok: '=', warn: '!', danger: '×', ext: '↗' };
  for (const [status, mark] of Object.entries(marks)) {
    const result = render({ chart: 'mindmap', data: { label: 'Root', children: [{ label: 'State node', status }] } });
    assert.equal(result.diagnostics.length, 0, status);
    assert.equal(result.scene.nodes[1].status, status);
    assert.ok(result.svg.includes(`>${mark}</text>`), status);
  }
  const tree = render({ chart: 'tree', data: { label: 'Root', children: [{ label: 'State node', status: 'warn' }] } });
  assert.equal(tree.diagnostics.length, 0);
  assert.equal(tree.scene.nodes[1].status, 'warn');
  assert.ok(tree.svg.includes('>!</text>'));
  const plainTree = render({ chart: 'tree', data: { label: 'Root', children: [{ label: 'State node' }] } });
  assert.equal(Object.hasOwn(plainTree.scene.nodes[1], 'status'), false);
  assert.equal(render({ chart: 'tree', data: { label: 'Root', children: [{ label: 'State node' }] } }).svg, plainTree.svg);
});
