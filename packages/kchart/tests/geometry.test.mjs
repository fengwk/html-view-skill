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
  expect(kinds(box(), edge('M20 38 H65'))).toEqual(['edge-hugs-node']);
});

// Reversed, shared straight runs fail, while a transverse intersection is allowed.
test('overlapping edge routes', () => {
  const horizontal = edge('M10 20 h70');
  expect(kinds(horizontal, edge('M95 20 H55', 'other'))).toEqual(['collinear-edges']);
  expect(kinds(horizontal, edge('M55 5 V50', 'other'))).toEqual([]);
  expect(kinds(horizontal, edge('M80 20 H95', 'other'))).toEqual([]);
});

// An offset parallel run is ambiguous; a short or well-separated run is not.
test('near-parallel routes', () => {
  const route = edge('M10 20 H70');
  expect(inspect(route, edge('M75 22 H30', 'other', 'different'))).toEqual([
    { kind: 'near-parallel-overlap', elements: ['route', 'other'], coordinates: [[30, 20], [70, 20]] },
  ]);
  expect(kinds(route, edge('M75 25 H30', 'other'))).toEqual([]);
  expect(kinds(route, edge('M75 22 H62', 'other'))).toEqual([]);
});

// Same-port departures may be briefly close, but sharing a source does not excuse a long run or rejoin.
test('bounded port fan-out', () => {
  const route = edge('M10 20 H75');
  expect(kinds(route, edge('M10 22 H30 V50', 'other'))).toEqual([]);
  expect(kinds(route, edge('M10 22 H65 V50', 'other'))).toEqual(['near-parallel-overlap']);
  expect(kinds(route, edge('M10 22 V40 H50 V22 H75', 'other'))).toEqual(['near-parallel-overlap']);
});

// Only a sustained pass within 6px of an unrelated border counts as hugging.
test('nearby node border clearance', () => {
  const d = 'M34.1 20 V80';
  expect(inspect(box(), edge(d))).toEqual([
    { kind: 'edge-hugs-node', elements: ['route', 'card'], coordinates: [[34.1, 40], [34.1, 70]] },
  ]);
  expect(kinds(box(), edge(d, 'route', 'card'))).toEqual([]);
  expect(kinds(box(), edge('M33.9 20 V80'))).toEqual([]);
  expect(kinds(box(), edge('M34.1 20 V52'))).toEqual([]);
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

// A route can enter its endpoint's frame, but must not cross an unrelated border or report mere contact.
test('frame borders vs. endpoint attachment and grazing', () => {
  const frame = el('g', { transform: 'translate(40 40)' }, { kind: 'group', group: 'cluster' }, [
    el('rect', { width: 30, height: 30 }),
  ]);
  expect(inspect(frame, edge('M10 55 H40 H90'))).toEqual([
    { kind: 'edge-crosses-frame', elements: ['route', 'cluster'], coordinates: [40, 55] },
  ]);
  const member = box({ x: 50, y: 45, width: 10, height: 10 });
  expect(kinds(frame, member, edge('M10 50 H50', 'route', 'card'))).toEqual([]);
  expect(kinds(frame, edge('M10 40 H90'))).toEqual([]);
  expect(kinds(frame, edge('M10 55 H30 M50 55 H60'))).toEqual([]);
});

// A package's empty tab corner is not frame interior, but entering below it is.
test('concave package frame', () => {
  const frame = el('path', { d: 'M40 70 V30 H50 V40 H70 V70 Z' }, { kind: 'frame', id: 'package' });
  expect(kinds(frame, edge('M55 35 H90'))).toEqual([]);
  expect(inspect(frame, edge('M55 35 V90'))).toEqual([
    { kind: 'edge-crosses-frame', elements: ['route', 'package'], coordinates: [55, 40] },
  ]);
});

// A lane transition may traverse intermediate background bands, but not a nested group inside one.
test('lane bands vs. nested frames', () => {
  const lane = (id, y) => el('g', {}, { lane: id }, [el('rect', { x: 10, y, width: 80, height: 20 })]);
  const lanes = [lane('start', 0), lane('middle', 30), lane('end', 60)];
  const route = edge('M50 10 V70');
  const nested = el('rect', { x: 30, y: 33, width: 40, height: 14 }, { kind: 'frame', id: 'nested' });
  expect(kinds(...lanes, route)).toEqual([]);
  expect(kinds(...lanes, nested, route)).toEqual(['edge-crosses-frame']);
});

// A route may cross its own label, but not another route's label or an ordinary label.
test('route and text ownership', () => {
  const route = edge('M10 50 H90');
  const label = { ...text('label', 40, 50, { 'dominant-baseline': 'central' }), meta: { kind: 'edge-label', from: 'start', to: 'route' } };
  expect(kinds(route, label)).toEqual([]);
  expect(kinds(edge('M10 50 H90', 'other'), label)).toEqual(['edge-crosses-text']);
  expect(kinds(route, text('label', 40, 50, { 'dominant-baseline': 'central' }))).toEqual(['edge-crosses-text']);
  expect(kinds(edge('M38 50 H42', 'other'), label)).toEqual([]);
});

// A legacy Wardley leader can overprint text, unless a later opaque plate covers the crossing.
test('visible leader stroke vs. opaque plate', () => {
  const leader = el('line', { x1: 25, x2: 75, y1: 50, y2: 50, 'stroke-dasharray': '2 3', 'stroke-width': 1 });
  const label = text('label', 35, 50, { 'dominant-baseline': 'central' });
  const plate = el('rect', { x: 30, y: 40, width: 40, height: 20, fill: '#fff' });
  expect(kinds(leader, label)).toEqual(['edge-crosses-text']);
  expect(kinds(leader, plate, label)).toEqual([]);
  expect(kinds(plate, leader, label)).toEqual(['edge-crosses-text']);
});
