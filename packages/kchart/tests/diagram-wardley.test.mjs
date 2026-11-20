import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createContext } from '../src/core/context.js';
import { createDiagramApi } from '../src/diagram/registry.js';
import { implementations } from '../src/diagram/wardley.js';
import { checkScene } from './helpers/geometry.mjs';

const kind = 'wardley-beta';
const implementation = implementations[kind];
const api = createDiagramApi(implementations, [{ kind, syntax: 'mermaid', topic: 'architecture', aliases: [] }]);
const source = (body) => `${kind}\n${body}`;
const parse = (body) => api.parse(source(body), { lang: 'en' });
const draw = (body, width = 800) => api.diagram(source(body), { lang: 'en', width });
const elements = (node) => (node.children || []).flatMap(child => [child, ...elements(child)]);
const points = (scene) => elements(scene).filter(n => n.meta?.kind === 'node');

// Visibility is the inverted Y coordinate, while evolution advances to the right; percent and fractions coincide.
test('projects Wardley coordinates and normalizes their units', () => {
  const body = 'component Low [0.2, 0.9]\ncomponent High [90.0, 20.0]';
  const { model } = parse(body);
  assert.deepEqual(model.nodes.map(n => [n.visibility, n.evolution]), [[20, 90], [90, 20]]);
  assert.deepEqual(parse('component Low [20.0, 90.0]').model.nodes[0], model.nodes[0]);
  const [low, high] = points(draw(body).scene);
  assert.ok(low.attrs.cx > high.attrs.cx && low.attrs.cy > high.attrs.cy);
});

// Coordinate tokens require a decimal, and an out-of-range value reports its source line.
test('checks Wardley number syntax and range', () => {
  for (const coordinates of ['0.5, 1', '101.0, 0.5']) {
    assert.ok(parse(`component A [${coordinates}]`).diagnostics.some(d => d.severity === 'error' && d.line === 2));
  }
});

// Multiword names survive parsing, and plain, dashed, labeled and ported dependencies stay distinct.
test('parses Wardley names and flow operators', () => {
  const { model, diagnostics } = parse(`component real-time processing [0.2, 0.3]
component "Cloud API" [0.8, 0.6]
real-time processing -.-> "Cloud API"
real-time processing +'backup'> "Cloud API" ; overridden
real-time processing +<> "Cloud API"
real-time processing "Cloud API"`);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(model.links.map(({ from, to, dashed, flow, label }) => [from, to, dashed, flow, label]), [
    ['real-time processing', 'Cloud API', true, 'none', ''],
    ['real-time processing', 'Cloud API', false, 'forward', 'backup'],
    ['real-time processing', 'Cloud API', false, 'bidirectional', ''],
    ['real-time processing', 'Cloud API', false, 'none', ''],
  ]);
  const body = 'component A [0.2, 0.3]\ncomponent B [0.7, 0.6]\nA +<> B';
  const { scene } = draw(body);
  const paths = elements(scene).filter(n => n.tag === 'path');
  assert.equal(paths.filter(n => n.meta?.kind === 'edge').length, 1);
  assert.equal(paths.filter(n => n.attrs.d.endsWith(' Z')).length, 2);
});

// Label offsets precede strategy/inertia; both forms of inertia remain available.
test('parses Wardley decorators in order', () => {
  const { model, diagnostics } = parse('component A [0.2, 0.3] label [-50, 10] (build) (inertia)\ncomponent B [0.5, 0.4] inertia');
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(model.nodes[0].labelOffset, { dx: -50, dy: 10 });
  assert.equal(model.nodes[0].strategy, 'build');
  assert.ok(model.nodes.every(node => node.inertia));
  assert.ok(parse('component A [0.2, 0.3] inertia (build)').diagnostics.some(d => d.severity === 'error'));
});

// A partial boundary list warns but draws equal bands, without dropping dual labels.
test('uses equal stage bands after a partial override', () => {
  const body = 'evolution Genesis@0.3 / Idea -> Product';
  const result = draw(body);
  assert.equal(result.diagnostics[0].code, 'DIAGRAM_HINT');
  assert.ok(result.svg.includes('Idea'));
  assert.equal(result.svg, draw('evolution Genesis / Idea -> Product').svg);
});

// A pipeline requires a component parent; valid children inherit its visibility and get a frame.
test('validates Wardley pipeline parents and lays out children', () => {
  const body = 'pipeline Parent {\n  component Child [0.25]\n}';
  assert.ok(parse(body).diagnostics.some(d => d.severity === 'error' && d.line === 2));
  const valid = `component Parent [0.4, 0.6]\n${body}`;
  assert.equal(parse(valid).model.nodes.at(-1).visibility, 40);
  assert.ok(elements(draw(valid).scene).some(n => n.meta?.kind === 'frame' && n.meta.id === 'Parent'));
});

// Duplicate placement directives preserve the first annotation box with a non-blocking diagnostic.
test('keeps the first Wardley annotation box', () => {
  const { model, diagnostics } = parse('annotations [0.1, 0.2]\nannotations [0.3, 0.4]');
  assert.deepEqual(model.annotationBox, { visibility: 10, evolution: 20 });
  assert.deepEqual(diagnostics.map(d => [d.severity, d.line]), [['warning', 3]]);
});

// Authored dimensions override config; a zero-component map still displays its coordinate frame.
test('honors Wardley size over config and handles an empty map', () => {
  const ctx = createContext({ width: 360 });
  const { model } = parse('size [1100, 650]');
  const { scene } = implementation.layout(model, { ctx, width: 360 }, { config: { wardley: { width: 800, height: 500 } } });
  assert.equal(scene.width, 1100);
  assert.ok(scene.height >= 650);
  const empty = draw('');
  assert.deepEqual(points(empty.scene), []);
  assert.match(empty.svg, />Visibility</);
  assert.match(empty.svg, />Evolution</);
  assert.deepEqual(checkScene(empty.scene), []);
});

// The shared size policy supersedes the proposed 40-node cutoff: a wider dense map still renders.
test('renders Wardley maps past the old proposed limit', () => {
  const body = 'size [1800, 600]\n' + Array.from({ length: 41 }, (_, i) => `component A${i} [${i % 2 ? '0.3' : '0.7'}, ${(i / 42).toFixed(3)}]`).join('\n');
  const { scene, diagnostics } = draw(body);
  assert.equal(points(scene).length, 41);
  assert.deepEqual(diagnostics.map(d => d.code), ['LARGE_DIAGRAM']);
  assert.deepEqual(checkScene(scene), []);
});
