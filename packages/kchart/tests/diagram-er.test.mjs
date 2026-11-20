import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createContext } from '../src/core/context.js';
import { createDiagramApi } from '../src/diagram/registry.js';
import { implementations, parseEr } from '../src/diagram/er.js';
import { checkScene } from './helpers/geometry.mjs';

const api = createDiagramApi(implementations, [{ kind: 'erDiagram', syntax: 'mermaid', aliases: [], topic: 'data-model' }]);
// 意图：真实 ER 场景输出字段、局部基数标记引用，且可选圆圈与鸦爪计入描边也不相交。
test('ER scene emits attribute rows and separate cardinality glyphs', () => {
  const { svg } = api.diagram('erDiagram\nUser { int id PK }\nUser |o--o| A\nUser ||--|| B\nUser }o--o{ C\nUser }|--|{ D', { prefix: 'slice' });
  assert.match(svg, /data-kc-kind="attribute"/);
  assert.match(svg, /data-kc-kind="attribute-key"/);
  for (const marker of ['zero-one', 'exactly-one', 'zero-many', 'one-many']) {
    assert.ok(svg.includes(`marker-start="url(#slice-er-card-${marker})"`));
    assert.ok(svg.includes(`<marker id="slice-er-card-${marker}"`));
  }
  assert.match(svg, /marker-end="url\(#slice-er-card-zero-one\)"/);
  const optionalMany = /<marker id="slice-er-card-zero-many"[^>]*>(.*?)<\/marker>/.exec(svg)[1];
  const [, center, radius] = /<circle cx="(\d+)" cy="8" r="(\d+)"/.exec(optionalMany);
  const [, tip, apex] = /<path d="M(\d+) 2 L(\d+) 8/.exec(optionalMany);
  assert.ok(Number(center) + Number(radius) + 1.4 < Number(apex));
  assert.ok(Number(apex) < Number(tip) && Number(tip) < 16);
  assert.match(svg, /<text[^>]*dominant-baseline="central"[^>]*>User<\/text>/);
  assert.doesNotMatch(svg, /class="g-|document|style=/);
});

const spelling = [
  ['||', 'exactly-one'], ['ONLY ONE', 'exactly-one'], ['one', 'exactly-one'], ['1', 'exactly-one'],
  ['|o', 'zero-one'], ['o|', 'zero-one'], ['one or zero', 'zero-one'], ['zero or one', 'zero-one'],
  ['}o', 'zero-many'], ['o{', 'zero-many'], ['many(0)', 'zero-many'], ['many', 'zero-many'],
  ['zero or more', 'zero-many'], ['zero or many', 'zero-many'], ['0+', 'zero-many'],
  ['}|', 'one-many'], ['|{', 'one-many'], ['one or more', 'one-many'], ['one or many', 'one-many'],
  ['1+', 'one-many'], ['many(1)', 'one-many'], ['u', null],
];

// 意图：完整关系矩阵独立保留左右基数，四种符号连线与两种词形连线正确区分实虚线。
test('ER parses the cardinality cross product in source order', () => {
  for (const [left, startCard] of spelling) for (const [right, endCard] of spelling) {
    for (const [connector, style] of [['--', 'solid'], ['..', 'dashed'], ['.-', 'dashed'], ['-.', 'dashed'], [' To ', 'solid'], [' Optionally To ', 'dashed']]) {
      const source = `"Left side" ${left}${connector}${right} 1 : "has: items"`;
      const { model, errors } = parseEr(source);
      assert.deepEqual(errors, [], source);
      const [{ from, to, startCard: start, endCard: end, style: stroke, label }] = model.edges;
      assert.deepEqual([from, to, start, end, stroke, label], ['Left side', '1', startCard, endCard, style, 'has: items'], source);
    }
  }
  for (const source of ['A |}--{o B : invalid', 'A one tomato many B', 'A ||--|| B :']) {
    assert.equal(parseEr(source, { firstLine: 7 }).errors[0]?.line, 7, source);
  }
});

// 意图：即使从右向左布置，起止标记也必须贴在源码所示的实体；递归关系同样保留不同基数。
test('ER attaches marker references to the correct entity outlines, including self relations', () => {
  const ctx = createContext();
  const impl = implementations.erDiagram;
  const { model } = parseEr('A |o--|{ B : links\nB }o..|| B : recurses', { header: 'erDiagram RL' });
  const geometry = impl.layout(model, { width: 800, ctx }, {});
  const [edge, loop] = geometry.edges;
  const [a, b] = ['A', 'B'].map(id => geometry.nodes.find(node => node.id === id));
  assert.ok(a.x > b.x);
  assert.equal(edge.segments[0].p0.x, a.x);
  assert.equal(edge.segments.at(-1).p1.x, b.x + b.w);
  assert.deepEqual([loop.from, loop.to], ['B', 'B']);
  const { svg } = api.diagram('erDiagram RL\nA |o--|{ B : links\nB }o..|| B : recurses', { prefix: 'test' });
  assert.match(svg, /<path[^>]*marker-start="url\(#test-er-card-zero-one\)"[^>]*marker-end="url\(#test-er-card-one-many\)"/);
  assert.match(svg, /<path[^>]*marker-start="url\(#test-er-card-zero-many\)"[^>]*marker-end="url\(#test-er-card-exactly-one\)"/);
});

// 意图：别名不改实体身份，孤立和引号实体仍可渲染，带空格的字段、键和注释不会丢失。
test('ER renders lone and quoted entities, aliases and visible annotated rows', () => {
  const source = 'erDiagram\nLONE\np[Person]\n"Customer Account" { `array type`? *name pk, FK "Visible comment }" %% trailing\nstring(99) last\n}\np 1 to many "Customer Account" : holds';
  const { model, diagnostics } = api.parse(source);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(model.nodes.map(({ id, label }) => [id, label]), [['LONE', 'LONE'], ['p', 'Person'], ['Customer Account', 'Customer Account']]);
  assert.deepEqual(model.nodes[2].fields, [
    { type: 'array type?', name: '*name', keys: ['PK', 'FK'], comment: 'Visible comment }' },
    { type: 'string(99)', name: 'last', keys: [], comment: null },
  ]);
  const { svg, scene } = api.diagram(source, { width: 360 });
  assert.match(svg, /data-kc-kind="attribute-comment"/);
  assert.deepEqual(checkScene(scene), []);
});

// 意图：前向子图引用不会造出假实体；嵌套框保留，未使用的局部方向只产生一条警告。
test('ER links to nested frames and renders with one local-direction warning', () => {
  const source = 'erDiagram\nA ||--|| Outer : links\nsubgraph Outer [Outer frame]\n  direction LR\n  subgraph Inner\n    B\n  end\nend';
  const { model } = api.parse(source);
  assert.deepEqual(model.nodes.map(({ id, parent }) => [id, parent]), [['A', null], ['B', 'Inner']]);
  assert.deepEqual(model.subgraphs.map(({ id, parent }) => [id, parent]), [['Outer', null], ['Inner', 'Outer']]);
  assert.equal(model.edges[0].toFrame, true);
  const { svg, scene, diagnostics } = api.diagram(source, { width: 360 });
  assert.deepEqual(diagnostics.map(({ code, severity }) => [code, severity]), [['DIAGRAM_HINT', 'warning']]);
  assert.match(svg, /data-kc-kind="frame"/);
  assert.deepEqual(checkScene(scene), []);
});
