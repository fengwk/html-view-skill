import { test } from 'vitest';
import assert from 'node:assert/strict';
import { implementations } from '../src/diagram/graph.js';
import { createContext } from '../src/core/context.js';

const impl = implementations.flowchart;
const parse = body => impl.parse(body, { kind: 'flowchart', header: 'flowchart LR', lang: 'en' });

// Stroke, marker direction and minimum rank span are independent of each other.
test('decodes the Mermaid link operator matrix', () => {
  const rows = [
    ['-->', 'solid', 'none', 'point', 1], ['--->', 'solid', 'none', 'point', 2],
    ['---->', 'solid', 'none', 'point', 3], ['---', 'solid', 'none', 'none', 1],
    ['--', 'solid', 'none', 'none', 1], ['--o', 'solid', 'none', 'circle', 1],
    ['--x', 'solid', 'none', 'cross', 1], ['<-->', 'solid', 'point', 'point', 1],
    ['<--->', 'solid', 'point', 'point', 2], ['o--o', 'solid', 'circle', 'circle', 1],
    ['x--x', 'solid', 'cross', 'cross', 1], ['x--o', 'solid', 'none', 'circle', 2],
    ['o--x', 'solid', 'none', 'cross', 2], ['==>', 'bold', 'none', 'point', 1],
    ['===>', 'bold', 'none', 'point', 2], ['===', 'bold', 'none', 'none', 1],
    ['==', 'bold', 'none', 'none', 1], ['==o', 'bold', 'none', 'circle', 1],
    ['<==>', 'bold', 'point', 'point', 1], ['x==x', 'bold', 'cross', 'cross', 1],
    ['-.->', 'dashed', 'none', 'point', 1], ['-..->', 'dashed', 'none', 'point', 2],
    ['-.-', 'dashed', 'none', 'none', 1], ['o-.-o', 'dashed', 'circle', 'circle', 1],
    ['x-.-x', 'dashed', 'cross', 'cross', 1], ['<-.->', 'dashed', 'point', 'point', 1],
    ['~~~', 'invisible', 'none', 'none', 1], ['----', 'solid', 'none', 'none', 2],
  ];
  for (const [token, style, startMark, endMark, len] of rows) {
    const { model, errors } = parse(`A${token}B`);
    assert.deepEqual(errors, [], token);
    assert.equal(model.edges.length, 1, token);
    const edge = model.edges[0];
    assert.deepEqual([edge.from, edge.to, edge.style, edge.startMark, edge.endMark, edge.extra + 1], ['A', 'B', style, startMark, endMark, len], token);
  }
});

// Inline text consumes only its own link, and the edge ID belongs to exactly one Cartesian pair.
test('keeps link text, chains and Cartesian IDs distinct', () => {
  const { model, errors } = parse('A--text-->B-. dotted .->C== "a ==> b" ==>D\nA & B e1@-->|"x|y"| C & D');
  assert.deepEqual(errors, []);
  assert.deepEqual(model.edges.map(e => [e.from, e.to, e.label, e.id]), [
    ['A', 'B', 'text', null], ['B', 'C', 'dotted', null], ['C', 'D', 'a ==> b', null],
    ['A', 'C', 'x|y', null], ['A', 'D', 'x|y', null], ['B', 'C', 'x|y', 'e1'], ['B', 'D', 'x|y', null],
  ]);
});

// Invisible edges affect layout without a visible path; distinct markers survive scene conversion.
test('paints circle and cross markers but not invisible edges', () => {
  const { model, errors } = parse('Ao--oB\nBx--xC\nC~~~D');
  assert.deepEqual(errors, []);
  const geometry = impl.layout(model);
  assert.equal(geometry.edges.length, 3);
  const scene = impl.scene(geometry, createContext({ theme: 'paper' }));
  const drawn = scene.children.find(el => el.meta?.kind === 'edges').children.map(group => group.children.find(el => el.meta?.kind === 'edge').attrs);
  assert.deepEqual(drawn.map(attrs => [attrs['marker-start'], attrs['marker-end']]), [
    ['url(#graph-circle)', 'url(#graph-circle)'], ['url(#graph-cross)', 'url(#graph-cross)'],
  ]);
});
