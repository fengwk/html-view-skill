import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from '../modules.mjs';

const modules = loadModules(['diagram/graph', 'core/context', 'core/svg']);
const implementations = modules['diagram/graph'].implementations;

const ctx = modules['core/context'].createContext({ theme: 'paper' });
const render = (kind, model, nodes, edges = [], frames = []) => {
  const impl = implementations[kind];
  const result = impl.scene({ width: 240, height: 120, model, nodes, edges, frames }, ctx, { title: 'Fixture' });
  return modules['core/svg'].renderScene(result, { prefix: 'slice' });
};

// 意图：实际 parser/layout 接线需识别 flowchart 结构并生成节点边几何，而不经过假转接。
test('registers canonical kinds and delegates to real parser/layout modules', () => {
  assert.deepEqual(Object.keys(implementations), ['flowchart', 'stateDiagram-v2', 'erDiagram']);
  assert.equal(implementations.flowchart.optionMode, 'raw');
  const info = { kind: 'flowchart', header: 'flowchart LR', headerLine: 1, firstLine: 2, lang: 'en', options: {} };
  const parsed = implementations.flowchart.parse('A[Start] --> B[End]', info);
  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(Array.from(parsed.model.edges, ({ from, to }) => [from, to]), [['A', 'B']]);
  const result = implementations.flowchart.layout(parsed.model, { width: 500, measure: (text, font) => text.length * font.size });
  assert.equal(result.nodes.length, 2);
  assert.equal(result.edges.length, 1);
  assert.ok(result.width > 0 && result.height > 0);
});

// Representative flow and state geometry confirms real shapes, directional markers, groups, labels, and prefixed local IDs.
test('flowchart and state scenes contain nodes, frame, edge labels, and prefixed arrow references', () => {
  const flow = render('flowchart', { nodes: [
    { id: 'A', label: 'Begin', kind: 'real', shape: 'stadium', class: 'new' },
    { id: 'B', label: 'Choose', kind: 'real', shape: 'diamond' },
  ] }, [
    { id: 'A', x: 20, y: 20, w: 70, h: 40, lines: ['+ Begin'], descLines: [] },
    { id: 'B', x: 150, y: 20, w: 70, h: 50, lines: ['Choose'], descLines: [] },
  ], [{ from: 'A', to: 'B', endArrow: true, style: 'bold', label: 'next', segments: [{ p0: { x: 90, y: 40 }, c1: { x: 110, y: 40 }, c2: { x: 130, y: 40 }, p1: { x: 150, y: 40 } }], labelRect: { x: 105, y: 25, w: 30, h: 18 }, labelLines: ['next'] }], [{ id: 'group', x: 10, y: 10, w: 220, h: 80, class: 'info', lines: ['Group'], titleRect: { x: 20, y: 5, w: 50, h: 20 } }]);
  assert.match(flow, /<rect[^>]*rx="6"/);
  assert.match(flow, /<polygon/);
  assert.match(flow, /data-kc-kind="edge"/);
  assert.match(flow, /data-kc-status="new"/);
  assert.match(flow, /id="slice-graph-arrow-bold"/);
  assert.match(flow, /marker-end="url\(#slice-graph-arrow-bold\)"/);
  assert.match(flow, /next/);

  const state = render('stateDiagram-v2', { nodes: [
    { id: '[*]', label: '[*]', kind: 'start' }, { id: 'Done', label: 'Done', kind: 'state' },
    { id: 'Final', label: '[*]', kind: 'end' },
  ] }, [
    { id: '[*]', x: 20, y: 50, w: 14, h: 14 }, { id: 'Done', x: 100, y: 35, w: 60, h: 40, lines: ['Done'], descLines: [] },
    { id: 'Final', x: 200, y: 48, w: 18, h: 18 },
  ], [{ from: '[*]', to: 'Done', endArrow: true, segments: [{ p0: { x: 34, y: 57 }, c1: { x: 60, y: 57 }, c2: { x: 74, y: 55 }, p1: { x: 100, y: 55 } }] }]);
  assert.match(state, /<circle/);
  assert.match(state, /<rect[^>]*rx="8"/);
  assert.match(state, /marker-end="url\(#slice-graph-arrow\)"/);
});

// ER shape attributes and all crow's-foot cardinality marker variants must be drawable without DOM/CSS.
test('ER scene emits attribute rows, relation markers, and local marker references', () => {
  const svg = render('erDiagram', { nodes: [
    { id: 'User', label: 'User', kind: 'er', fields: [] }, { id: 'Order', label: 'Order', kind: 'er', fields: [] },
  ] }, [
    { id: 'User', x: 20, y: 20, w: 100, h: 70, er: { pad: 12, headerH: 30, headLines: ['User'], typeW: 35, rows: [{ name: 'id', typeLines: ['int'], nameLines: ['id'], keyText: 'PK', keys: ['PK'], rowH: 26 }] } },
    { id: 'Order', x: 150, y: 20, w: 80, h: 70, er: { pad: 12, headerH: 30, headLines: ['Order'], typeW: 35, rows: [] } },
  ], ['|o', '||', '}o', '}|'].map((card, index) => ({
    from: 'User', to: 'Order', startCard: card, endCard: card,
    segments: [{ p0: { x: 120, y: 55 + index }, c1: { x: 130, y: 55 + index }, c2: { x: 140, y: 55 + index }, p1: { x: 150, y: 55 + index } }],
  })));
  assert.match(svg, /data-kc-kind="attribute"/);
  assert.match(svg, /data-kc-kind="attribute-key"/);
  for (const marker of ['zero-one', 'exactly-one', 'zero-many', 'one-many']) {
    assert.match(svg, new RegExp(`marker-start="url\\(#slice-graph-card-${marker}\\)"`));
    assert.match(svg, new RegExp(`<marker id="slice-graph-card-${marker}"`));
  }
  assert.match(svg, /marker-end="url\(#slice-graph-card-zero-one\)"/);
  // 可选关系的空心圆必须有半径；卡片内文字在已计算的槽位垂直居中。
  assert.match(svg, /<circle cx="10\.5" cy="8" r="5"/);
  assert.match(svg, /<text[^>]*dominant-baseline="central"[^>]*>User<\/text>/);
  assert.doesNotMatch(svg, /class="g-|document|style=/);
});
