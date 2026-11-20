import { test } from 'vitest';
import assert from 'node:assert/strict';
import { implementations } from '../src/diagram/graph.js';
import { createContext } from '../src/core/context.js';
import { renderScene } from '../src/core/svg.js';

const ctx = createContext({ theme: 'paper' });
const render = (kind, model, nodes, edges = [], frames = []) => {
  const impl = implementations[kind];
  const result = impl.scene({ width: 240, height: 120, model, nodes, edges, frames }, ctx, { title: 'Fixture' });
  return renderScene(result, { prefix: 'slice' });
};

// 意图：实际 parser/layout 接线需识别 flowchart 结构并生成节点边几何，而不经过假转接。
test('registers canonical kinds and delegates to real parser/layout modules', () => {
  assert.deepEqual(Object.keys(implementations), ['flowchart', 'stateDiagram-v2']);
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
