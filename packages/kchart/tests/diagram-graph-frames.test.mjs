import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseGraph } from '../src/diagram/graph-parse.js';
import { layoutGraph } from '../src/diagram/graph-layout.js';

const parse = (body, kind = 'flowchart') => parseGraph(body, { kind, header: kind, lang: 'en' });

// Closed groups use their local direction; an edge to an internal member makes the group inherit.
test('applies inner direction only across closed frame boundaries', () => {
  const source = 'subgraph G\ndirection LR\nA --> B\nend';
  for (const [body, closed] of [[`${source}\nG --> C`, true], [`${source}\nB --> C`, false]]) {
    const { model, errors } = parse(body);
    assert.deepEqual(errors, []);
    const geometry = layoutGraph(model);
    const a = geometry.nodes.find(n => n.id === 'A'), b = geometry.nodes.find(n => n.id === 'B');
    assert.ok(closed ? a.x + a.w < b.x : a.y + a.h < b.y);
    assert.equal(geometry.edges.length, 2);
  }
});

// Collapsing a group removes its internal nodes and reroutes member edges to the boundary.
test('collapses nested contents into one boundary', () => {
  const { model, errors } = parse('subgraph G[Visible]\nA --> B\nend\nX --> A\nG --> Y\nG@{ view: collapsed }');
  assert.deepEqual(errors, []);
  const geometry = layoutGraph(model);
  assert.deepEqual(geometry.nodes.map(n => n.id).sort(), ['G', 'X', 'Y']);
  assert.deepEqual(geometry.edges.map(e => [e.from, e.to]), [['X', 'G'], ['G', 'Y']]);
});

// The existing three-level flow limit reports one diagnostic without leaving stray end statements.
test('enforces depth with a single diagnostic', () => {
  const three = 'subgraph G\nsubgraph H\nsubgraph I\nA\nend\nend\nend';
  assert.deepEqual(parse(three).errors, []);
  const bad = parse(three.replace('\nA\n', '\nsubgraph J\nA\nend\n'));
  assert.equal(bad.errors.length, 1);
  assert.match(bad.errors[0].message, /4.*3/);
});

// Notes remain separate nodes with preserved multiline text and unmarked directional attachments.
test('parses notes on both sides and warns only once per ignored statement', () => {
  const { model, errors } = parse('A\nnote left of A: left\nnote right of A\nline one; still text\nline two\nend note\nscale 120 width\nscale 200 width', 'stateDiagram-v2');
  assert.deepEqual(errors.map(e => [e.severity, e.code]), [['warning', 'IGNORED_CONFIG']]);
  const [left, right] = model.nodes.filter(node => node.kind === 'note');
  assert.equal(right.label, 'line one; still text\nline two');
  assert.deepEqual(model.edges.map(e => [e.from, e.to, e.style, e.endArrow]), [[left.id, 'A', 'dashed', false], ['A', right.id, 'dashed', false]]);
});

// Concurrent regions retain independent starts, have no empty trailing region, and occupy disjoint boxes.
test('packs concurrent states into non-overlapping regions', () => {
  const { model, errors } = parse('[*] --> Active\nstate Active {\n[*] --> A\n--\n[*] --> B\n--\n}', 'stateDiagram-v2');
  assert.deepEqual(errors, []);
  const geometry = layoutGraph(model);
  assert.equal(geometry.nodes.filter(n => n.kind === 'start').length, 3);
  const regions = geometry.frames.filter(f => f.kind === 'divider');
  assert.equal(regions.length, 2);
  const [a, b] = regions;
  assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
});
