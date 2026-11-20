import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGraph } from '../src/diagram/graph-parse.js';
import { layoutGraph } from '../src/diagram/graph-layout.js';
import { prepareSource } from '../src/diagram/source.js';
import { diagram } from '../dist/esm/node.js';
import { checkScene } from './helpers/geometry.mjs';

const records = JSON.parse(readFileSync(new URL('./conformance/mermaid-12.3.0.json', import.meta.url)));
const fixture = id => records.find(record => record.id === id).source;
function layout(source, syntax = 'mermaid') {
  const info = prepareSource(source, { syntax });
  const { model, errors } = parseGraph(info.body, { ...info, syntax });
  assert.deepEqual(errors.filter(d => d.severity !== 'warning'), []);
  return layoutGraph(model);
}

// Mermaid statuses never change visible labels, while native status marks remain.
test('separates presentation color from native diff marks', () => {
  assert.deepEqual(layout(fixture('flowchart.md:1339')).nodes.map(n => n.lines.join(' ')), ['Start', 'Stop']);
  assert.equal(layout('flowchart TB\nA[Start]:::new', 'native').nodes[0].lines[0], '+ Start');
});

// Label plates stay centered on an actual straight run after all routing repairs.
test.each(['flowchart.md:945', 'flowchart.md:961'])('centers decision labels in %s', id => {
  const edges = layout(fixture(id)).edges.filter(edge => edge.label);
  assert.equal(edges.length, 2);
  for (const { labelRect: { x, y, w, h }, segments } of edges) {
    const cx = x + w / 2, cy = y + h / 2;
    const within = (a, b, p) => p >= Math.min(a,b) - .01 && p <= Math.max(a,b) + .01;
    assert.ok(segments.some(({ p0, p1 }) =>
      Math.abs(cx - p0.x) < .01 && Math.abs(cx - p1.x) < .01 && within(p0.y, p1.y, cy) ||
      Math.abs(cy - p0.y) < .01 && Math.abs(cy - p1.y) < .01 && within(p0.x, p1.x, cx)));
  }
});

// Explicit icon height changes the glyph scale; a label reference stays at text size.
test('sizes icon nodes separately from inline icons', () => {
  const { svg } = diagram('flowchart TB\nA@{ icon: "fa:user", form: square, h: 60 }\nB["fa:fa-user Inline"]', { syntax: 'mermaid' });
  assert.match(svg, /scale\(2\.5\)/);
  assert.match(svg, /scale\(0\.6666/);
});

// Named and nested states keep their display title and a full padding band.
test('retains composite display names and nested frame padding', () => {
  const named = layout(fixture('stateDiagram.md:161')).frames.find(f => f.id === 'NamedComposite');
  assert.deepEqual(named.lines, ['Another Composite']);
  assert.deepEqual(named.descLines, []);
  const frames = layout(fixture('stateDiagram.md:180')).frames;
  for (const frame of frames.filter(f => f.parent)) {
    const parent = frames.find(f => f.id === frame.parent);
    assert.ok(Math.min(frame.x - parent.x, frame.y - parent.y,
      parent.x + parent.w - frame.x - frame.w, parent.y + parent.h - frame.y - frame.h) >= 14);
  }
});

// Independent concurrent regions have aligned top borders and spaced compartments.
test('aligns concurrent regions on a single strip', () => {
  const frames = layout(fixture('stateDiagram.md:275')).frames.filter(f => f.kind === 'divider').sort((a,b) => a.x - b.x);
  assert.equal(frames.length, 3);
  assert.ok(frames.every(f => f.y === frames[0].y));
  assert.ok(frames.slice(1).every((f,i) => f.x >= frames[i].x + frames[i].w + 14));
});

// The short Crash transition uses the far side of the terminal instead of hooking across Still's lane.
test('separates terminal arrivals and clears the restored frame case', () => {
  const geometry = layout(fixture('stateDiagram.md:316'));
  const a = geometry.edges.find(e => e.from === 'Still' && e.to.startsWith('@@end'));
  const b = geometry.edges.find(e => e.from === 'Crash');
  assert.ok(b.end.x > a.end.x + 8);
  assert.ok(b.segments.every(({ p0, p1 }) => Math.min(p0.x, p1.x) > a.end.x));
  for (const width of [800, 360]) assert.deepEqual(checkScene(diagram(fixture('flowchart.md:1040'), { width }).scene), []);
});
