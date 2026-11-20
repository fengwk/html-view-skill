import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { diagram } from '../dist/esm/node.js';
import { checkScene } from './helpers/geometry.mjs';
import { parseGraph } from '../src/diagram/graph-parse.js';
import { layoutGraph } from '../src/diagram/graph-layout.js';

const fixtures = JSON.parse(readFileSync(new URL('./conformance/mermaid-12.3.0.json', import.meta.url)));
const render = (source, width = 800) => diagram(source, { syntax: 'mermaid', width, lang: 'en' });

function assertSeparated(route, other, gap) {
  for (const a of route) for (const b of other) for (const [along, across] of [['x', 'y'], ['y', 'x']]) {
    if (Math.abs(a.p0[across] - a.p1[across]) > .001 || Math.abs(b.p0[across] - b.p1[across]) > .001) continue;
    const [a0, a1] = [a.p0[along], a.p1[along]].sort((x, y) => x - y);
    const [b0, b1] = [b.p0[along], b.p1[along]].sort((x, y) => x - y);
    if (Math.min(a1, b1) - Math.max(a0, b0) <= 8) continue;
    assert.ok(Math.abs(a.p0[across] - b.p0[across]) >= gap - .001, `parallel ${along} runs need ${gap}px clearance`);
  }
}

// Linked LR groups follow a common band and the original labeled backlink remains attached.
test('keeps interdependent flow frames compact without replacing member edges', () => {
  const source = fixtures.find(({ id }) => id === 'flowchart.md:117').source;
  const [header, ...body] = source.split('\n');
  const { model } = parseGraph(body.join('\n'), { kind: 'flowchart', header, syntax: 'mermaid' });
  const g = layoutGraph(model);
  const [client, services, storage] = ['Client', 'Services', 'Storage'].map(id => g.frames.find(f => f.id === id));
  assert.ok(client.x + client.w < services.x && services.x + services.w < storage.x);
  assert.ok(Math.max(client.y, services.y, storage.y) < Math.min(...g.frames.map(f => f.y + f.h)));
  const token = g.edges.find(edge => edge.label === 'token');
  assert.deepEqual([token.from, token.to], ['Auth', 'UI']);
  assert.ok(token.segments.length <= 4);
  for (const edge of g.edges.filter(edge => edge !== token)) assertSeparated(token.segments, edge.segments, 12);
  for (const { x, y, w, h } of g.nodes.filter(n => n.id !== 'Auth' && n.id !== 'UI')) {
    const corners = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
    assertSeparated(token.segments, corners.map((p0, i) => ({ p0, p1: corners[(i + 1) % 4] })), 8);
  }
});

// Frame avoidance keeps actual node-to-node edges and clears unrelated group boundaries.
test.each(['flowchart.md:1012', 'flowchart.md:1082'])('does not cross unrelated frames in %s', id => {
  const source = fixtures.find(record => record.id === id).source;
  const result = render(source, 360);
  assert.ok(result.svg);
  assert.deepEqual(checkScene(result.scene), []);
});

// Shared presentation is applied after parsing, including late class definitions, safe links and real icons.
test('renders themed statuses, safe links and decoded labels', () => {
  const { svg, diagnostics } = render(`flowchart-elk LR
A["fa:fa-user <b>A #38; B</b>"]:::custom --> B
classDef custom fill:red
linkStyle 0 stroke:blue
click A href "https://example.org" "Open" _blank
click B call doThing()`);
  assert.ok(svg);
  assert.match(svg, /data-kc-status="danger"/);
  assert.match(svg, /data-kc-status="info"/);
  assert.match(svg, /A &amp; B/);
  assert.match(svg, /href="https:\/\/example.org"/);
  assert.match(svg, /rel="noopener noreferrer"/);
  assert.match(svg, /scale\(/);
  assert.deepEqual(new Set(diagnostics.map(d => d.code)), new Set(['IGNORED_CONFIG', 'IGNORED_INTERACTION']));
});

// Container and edge labels allocate room for their own icon, including an icon-only edge.
test('renders icons in frame titles and edge labels', () => {
  const { svg, scene, diagnostics } = render('flowchart TB\nsubgraph group["fa:fa-user Users"]\nA -->|fa:fa-user| B\nend');
  assert.deepEqual(diagnostics, []);
  assert.equal(svg.match(/scale\(/g)?.length, 2);
  assert.deepEqual(checkScene(scene), []);
});

// Both graph kinds retain readable geometry and warn once beyond the large-node threshold.
test.each(['flowchart', 'stateDiagram-v2'])('warns but renders 61 nodes: %s', kind => {
  const source = [kind, ...Array.from({ length: 60 }, (_, i) => `n${i} --> n${i + 1}`)].join('\n');
  const result = render(source, 360);
  assert.ok(result.svg);
  assert.equal(result.diagnostics.filter(d => d.code === 'LARGE_DIAGRAM').length, 1);
  assert.deepEqual(checkScene(result.scene), []);
});
