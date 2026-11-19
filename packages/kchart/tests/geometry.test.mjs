import { expect, test } from 'vitest';
import { checkScene } from './helpers/geometry.mjs';

const el = (tag, attrs = {}, meta, children) => ({ tag, attrs, meta, children });
const text = (value, x, y, attrs = {}, kind) => ({ ...el('text', { x, y, 'font-size': 12, ...attrs }, { kind }), text: value });
const box = (attrs = {}) => el('rect', { x: 40, y: 40, width: 30, height: 30, ...attrs }, { kind: 'node', id: 'card' });
const edge = (d, id = 'route', from = 'start', kind = 'edge') => el('path', { d }, { kind, id, from, to: id });
const inspect = (...children) => checkScene({ width: 100, height: 100, children }, { measure: (s, size) => s.length * size / 2 });
const kinds = (...children) => inspect(...children).map(issue => issue.kind);

// A 12px label meets the floor; a smaller visible label fails but a definition does not.
test('minimum visible text size', () => {
  expect(inspect(text('tiny', 20, 30, { 'font-size': 11 }))).toEqual([
    { kind: 'small-text', elements: ['tiny'], coordinates: expect.objectContaining({ size: 11 }) },
  ]);
  expect(kinds(text('normal', 20, 30), el('defs', {}, {}, [text('hidden', 0, 0, { 'font-size': 1 })]))).toEqual([]);
});

// Translation, measured advance and end anchoring determine whether the text clips.
test('transformed text containment', () => {
  const child = text('abc', 0, 20, { 'text-anchor': 'end' });
  expect(kinds(el('g', { transform: 'translate(16 0)' }, {}, [child]))).toEqual(['text-outside']);
  expect(kinds(el('g', { transform: 'translate(18 0)' }, {}, [child]))).toEqual([]);
});

// Visible text overprints at the same baseline, but touching horizontal advances are fine.
test('text collision', () => {
  expect(kinds(text('abcd', 20, 30), text('ef', 36, 30))).toEqual(['text-overlap']);
  expect(kinds(text('abcd', 20, 30), text('ef', 44, 30))).toEqual([]);
});

// An actual cubic sweep crosses an unrelated card even though its endpoint chord misses it.
test('curves vs. unrelated nodes', () => {
  const curve = 'M10 20 C30 64 78 64 90 20';
  expect(inspect(box(), edge(curve))).toEqual([
    { kind: 'edge-crosses-node', elements: ['route', 'card'], coordinates: expect.any(Array) },
  ]);
  expect(kinds(box(), edge(curve, 'route', 'card'))).toEqual([]);
  expect(kinds(box(), edge('M10 55 Q55 0 90 55'))).toEqual([]);
});

// A path in a diamond's empty bounding-box corner doesn't obscure the node.
test('non-rectangular node outline', () => {
  const diamond = el('polygon', { points: '55,40 70,55 55,70 40,55' }, { kind: 'node', id: 'diamond' });
  expect(kinds(diamond, edge('M20 42 H50'))).toEqual([]);
  expect(kinds(diamond, edge('M20 50 H60'))).toEqual(['edge-crosses-node']);
});

// An endpoint exemption only covers penetration, never a route sliding along its border.
test('sustained border contact vs. a normal port', () => {
  expect(kinds(box(), edge('M20 40 H65', 'route', 'card'))).toEqual(['edge-along-border']);
  expect(kinds(box(), edge('M50 20 V40', 'route', 'card'))).toEqual([]);
  expect(kinds(box(), edge('M20 38 H65'))).toEqual([]);
});

// Reversed, shared straight runs fail, while a transverse intersection is allowed.
test('overlapping edge routes', () => {
  const horizontal = edge('M10 20 h70');
  expect(kinds(horizontal, edge('M95 20 H55', 'other'))).toEqual(['collinear-edges']);
  expect(kinds(horizontal, edge('M55 5 V50', 'other'))).toEqual([]);
  expect(kinds(horizontal, edge('M80 20 H95', 'other'))).toEqual([]);
});

// A mindmap's common trunk is intentional; a coincident rejoin after branching is not.
test('shared mindmap trunk', () => {
  const a = edge('M10 20 H55 V50 H80', 'a', 'parent', 'mindmap');
  expect(kinds(a, edge('M10 20 H45 V5', 'b', 'parent', 'mindmap'))).toEqual([]);
  expect(kinds(a, edge('M10 20 H45 V50 H85', 'b', 'parent', 'mindmap'))).toEqual(['collinear-edges']);
});

// Label text may avoid node text yet still be obscured by a node body.
test('edge label vs. node', () => {
  const label = x => text('abc', x, 55, {}, 'edge-label');
  expect(kinds(box(), label(30))).toEqual(['edge-label-node-overlap']);
  expect(kinds(box(), label(20))).toEqual([]);
});

// Separate label text runs can still have overlapping opaque plates.
test('edge label vs. another label', () => {
  const plate = (x, from) => el('g', {}, { kind: 'edge-label-group', from, to: 'dst' }, [
    el('rect', { x, y: 35, width: 22, height: 20 }), text(from, x + 4, 50),
  ]);
  expect(kinds(plate(10, 'a'), plate(28, 'b'))).toEqual(['edge-label-overlap']);
  expect(kinds(plate(10, 'a'), plate(32, 'b'))).toEqual([]);
});

// A swimlane arc can hop a crossing without the flattened path using its endpoint chord.
test('swimlane crossover arc avoids a box', () => {
  const hop = el('path', { d: 'M15 50 H30 A20 20 0 0 1 70 50 H85' }, { edge: 'hop' });
  expect(kinds(box({ x: 46, y: 42, width: 8, height: 16 }), hop)).toEqual([]);
  expect(kinds(box({ x: 46, y: 25, width: 8, height: 16 }), hop)).toEqual(['edge-crosses-node']);
});
