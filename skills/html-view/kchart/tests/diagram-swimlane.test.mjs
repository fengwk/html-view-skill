import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from '../modules.mjs';

const core = loadModules(['diagram/swimlane', 'core/context', 'core/svg']);
const implementation = core['diagram/swimlane'].implementations.swimlane;
const measure = (text, { size }) => [...text].length * size * .55;
const plain = (value) => JSON.parse(JSON.stringify(value));

// Direction and lane ownership are parsed before graph statements reach the shared graph parser.
test('parses TB/LR lane declarations, decision nodes, and source line ownership', () => {
  const text = 'lane Intake\n  A[Start] --> B{Approve}\nlane Review\n  B --> C[Done]';
  const tb = implementation.parse(text, { firstLine: 3, options: { TB: true }, lang: 'en' });
  assert.deepEqual(plain(tb.errors), []);
  assert.equal(tb.model.direction, 'TB');
  assert.deepEqual(plain(tb.model.lanes.map(({ id, nodes }) => [id, nodes])), [['lane-0', ['A', 'B']], ['lane-1', ['C']]]);
  assert.equal(tb.model.nodes.find(({ id }) => id === 'B').shape, 'diamond');
  assert.equal(tb.model.nodes.find(({ id }) => id === 'B').line, 4);

  const lr = implementation.parse('lane One\n  A[Start] --> B[End]', { firstLine: 1, options: { LR: true } });
  assert.equal(lr.model.direction, 'LR');
  assert.deepEqual(plain(lr.errors), []);
});

// The cycle is excluded from longest-path steps, but remains a rendered backward edge.
test('lays out back edges and decision nodes in both directions without DOM APIs', () => {
  const parsed = implementation.parse('lane A\n  A[Start]:::new\n  A -->|approved| B{Choose}\n  B --> A', { firstLine: 1, options: { TB: true } });
  assert.deepEqual(plain(parsed.model.edges.map(({ from, to, label }) => [from, to, label])), [['A', 'B', 'approved'], ['B', 'A', '']]);
  assert.equal(parsed.model.nodes.find(({ id }) => id === 'A').class, 'new');
  const geometry = implementation.layout(parsed.model, { width: 320, lang: 'en', measure, ctx: {} });
  assert.deepEqual(plain(geometry.errors), []);
  assert.equal(geometry.nodes.length, 2);
  assert.ok(geometry.width > 36);
  assert.ok(geometry.height > 36);
  assert.equal(geometry.nodes.find(({ id }) => id === 'B').diamond, true);
  assert.equal(geometry.edges.filter(({ back }) => back).length, 1);
  assert.ok(geometry.edges[0].label, 'label is attached to the edge routing geometry');
  const context = core['core/context'].createContext({ width: geometry.width });
  const scene = implementation.scene(geometry, context);
  const svg = core['core/svg'].renderScene(scene, { frame: false });
  assert.match(svg, /<svg/);
  assert.match(svg, /marker-end="url\(#kc-/);
  assert.match(svg, /data-kc-back="true"/);
  assert.match(svg, /data-kc-label="e0"/);
  assert.match(svg, /approved/);
  assert.match(svg, /data-kc-status="new"/);
  assert.match(svg, /<polygon/);
  assert.doesNotMatch(svg, /NaN|Infinity|<script|foreignObject/);
});

// Parallel labeled edges and cross-lane routing keep the original layout geometry in LR as well as TB.
test('preserves LR parallel paths and cross-lane labels', () => {
  const parsed = implementation.parse('lane Source\n  A[Start] -->|fast| B{Decision}\n  A -->|slow| B\nlane Target\n  C[Done]\n  B -->|handoff| C', { firstLine: 1, options: { LR: true } });
  assert.deepEqual(plain(parsed.errors), []);
  const geometry = implementation.layout(parsed.model, { width: 600, lang: 'en', measure, ctx: {} });
  assert.deepEqual(plain(geometry.errors), []);
  assert.equal(geometry.nodes.length, 3);
  const parallel = geometry.edges.filter(({ from, to }) => from === 'A' && to === 'B');
  assert.equal(parallel.length, 2);
  assert.notDeepEqual(plain(parallel[0].points), plain(parallel[1].points));
  assert.ok(parallel.every(({ label }) => label?.w > 0));
});

// Direction conflicts and the explicit back-edge limit produce diagnostics instead of partial scenes.
test('rejects conflicting direction declarations and excessive back edges', () => {
  const conflict = implementation.parse('direction LR\nlane A\n  A[Start]', { firstLine: 2, options: { TB: true }, lang: 'en' });
  assert.match(conflict.errors[0].message, /Conflicting/);

  const model = { direction: 'TB', lanes: [{ id: 'lane-0', name: 'A', nodes: [] }],
    nodes: ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((id) => ({ id, label: id, shape: 'rect', lane: 'lane-0', line: 1 })),
    edges: [['A', 'B'], ['B', 'A'], ['C', 'D'], ['D', 'C'], ['E', 'E'], ['G', 'G'], ['F', 'E'], ['B', 'C'], ['D', 'E']].map(([from, to], seq) => ({ id: `e${seq}`, from, to, line: 1, label: '' })) };
  const result = implementation.layout(model, { width: 300, lang: 'en', measure, ctx: {} });
  assert.match(result.errors[0].message, /At most 3 back edges/);
});
