import { test } from 'vitest';
import corpus from './conformance/mermaid-12.3.0.json';
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

const center = ({ attrs: a }) => a.cx == null ? [a.x + a.width / 2, a.y + a.height / 2] : [a.cx, a.cy];

// Every visible dependency fragment must lie on its two authored endpoints' centerline, with no label crossings.
test('keeps every Wardley corpus dependency straight at both widths', () => {
  for (const record of corpus.filter(({ id }) => id.startsWith('wardley.md:'))) for (const width of [800, 360]) {
    const tag = `${record.id} @ ${width}`;
    const { scene } = api.diagram(record.source, { width });
    assert.deepEqual(checkScene(scene), [], tag);
    const nodes = new Map(points(scene).map(node => [node.meta.id, center(node)]));
    const edges = elements(scene).filter(node => node.meta?.kind === 'edge');
    for (const { from, to } of api.parse(record.source).model.links) {
      assert.ok(edges.some(edge => edge.meta.from === from && edge.meta.to === to), `${tag}: ${from} → ${to}`);
    }
    for (const { attrs, meta: { from, to } } of edges) {
      const values = [...attrs.d.matchAll(/[ML]([^ ]+) ([^ ]+)/g)].map(([, x, y]) => [Number(x), Number(y)]);
      const [ax, ay] = nodes.get(from), [bx, by] = nodes.get(to) ?? [ax + 1, ay];
      assert.ok(values.length >= 2 && values.every(([x, y]) => Math.abs((x - ax) * (by - ay) - (y - ay) * (bx - ax)) < 1e-6),
        `${tag}: ${from} → ${to}`);
    }
  }
});

// Dual captions keep their slash, wrapping only between the primary and secondary names when needed.
test('keeps Wardley stage pairs together when their band fits', () => {
  for (const width of [800, 360]) {
    const wide = corpus.find(record => record.id === 'wardley.md:274');
    assert.match(api.diagram(wide.source, { width }).svg, />Genesis \/ Concept</);
    const split = draw('evolution GenesisLongName@0.2 / SecondaryName -> Product@1.0', width);
    assert.match(split.svg, />GenesisLongName \/</);
    assert.match(split.svg, />SecondaryName</);
    assert.deepEqual(checkScene(split.scene), []);
  }
});

// Custom percentages delimit stage bands; their captions sit at the center of each unequal band.
test('places custom Wardley captions at the Mermaid band centers', () => {
  const { source } = corpus.find(record => record.id === 'wardley.md:290');
  const { scene } = api.diagram(source, { width: 800 });
  const parts = elements(scene);
  const x = name => parts.find(node => node.tag === 'text' && node.text === name).attrs.x;
  const axis = parts.find(node => node.tag === 'line' && node.attrs.y1 === node.attrs.y2);
  const { x1, x2 } = axis.attrs;
  for (const [name, fraction] of [['Genesis', .1], ['Custom', .3], ['Product', .575], ['Commodity', .875]]) {
    assert.ok(Math.abs(x(name) - (x1 + (x2 - x1) * fraction)) < 1e-8, name);
  }
});

// Pipeline children share a baseline beyond the frame; notes maintain clearance from component outlines.
test('keeps Wardley pipeline and note captions off adjacent marks', () => {
  for (const width of [800, 360]) {
    const get = line => api.diagram(corpus.find(record => record.id === `wardley.md:${line}`).source, { width }).scene;
    const pipeline = elements(get(243));
    const frame = pipeline.find(node => node.meta?.kind === 'frame').attrs;
    const captions = pipeline.filter(node => ['File System', 'SQL DB', 'NoSQL', 'Cloud DB'].includes(node.text));
    assert.equal(captions.length, 4);
    assert.equal(new Set(captions.map(node => node.attrs.y)).size, 1);
    assert.ok(captions[0].attrs.y - 6 >= frame.y + frame.height + 8);
    const notes = elements(get(314));
    const plates = notes.filter(node => node.tag === 'rect' && !node.meta);
    const markers = notes.filter(node => node.meta?.kind === 'node');
    assert.equal(plates.length, 2);
    for (const { attrs: b } of plates) for (const { attrs: p } of markers) {
      const dx = Math.max(b.x - p.cx, p.cx - b.x - b.width, 0);
      const dy = Math.max(b.y - p.cy, p.cy - b.y - b.height, 0);
      assert.ok(Math.hypot(dx, dy) - p.r >= 12);
    }
  }
});

// A collision does not move the authored Web App label; the note leaders still participate in geometry checks.
test('preserves the authored Wardley label offset when it crosses straight links', () => {
  const { source } = corpus.find(({ id }) => id === 'wardley.md:399');
  const { scene } = api.diagram(source, { width: 800 });
  const [x, y] = center(points(scene).find(node => node.meta.id === 'Web App'));
  const parts = elements(scene);
  const label = parts.find(node => node.tag === 'text' && node.text === 'Web App');
  assert.equal(label.attrs.x, x - 60);
  assert.equal(label.attrs.y, y + 10);
  assert.ok(parts.some(node => node.meta?.kind === 'leader'));
  assert.ok(parts.some(node => node.tag === 'title' && node.text === 'API Gateway → Database'));
});

// Label normalization leaves reference identities intact; geometry config and SVG accessibility use the shared registry.
test('normalizes Wardley labels and honors shared config', () => {
  const body = `---
config:
  Wardley: { Width: 1020, height: 650, showGrid: true }
---
wardley-beta
accTitle: Accessible map
accDescr: Service dependency
component "fa:fa-envelope <b>Mail &amp; API</b>" [0.7, 0.5]
component Other [0.2, 0.6]
"fa:fa-envelope <b>Mail &amp; API</b>" -> Other; fas:fa-no-such-icon Backup
note "fas:fa-no-such-icon Elsewhere" [0.4, 0.2]`;
  const { svg, scene, diagnostics } = api.diagram(body, { lang: 'en', width: 800 });
  assert.ok(scene.width >= 1020);
  assert.ok(scene.height >= 650);
  assert.deepEqual(diagnostics.map(d => d.code).sort(), ['IGNORED_ASSET', 'IGNORED_CONFIG']);
  assert.ok(elements(scene).some(node => node.attrs?.transform?.includes(' scale(')));
  assert.match(svg, />Mail &amp; API</);
  assert.match(svg, />Backup</);
  assert.match(svg, /<title\b[^>]*>Accessible map<\/title>/);
  assert.match(svg, /<desc>Service dependency<\/desc>/);
  assert.deepEqual(checkScene(scene), []);
});

// Neither Mermaid map grammar admits shared click or style statements; never turn on the opt-in accidentally.
test('does not extend the Wardley grammar with presentation statements', () => {
  assert.equal(draw('component A [0.5, 0.5]\nstyle A fill:red').svg, null);
});
