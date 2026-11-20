import { test } from 'vitest';
import assert from 'node:assert/strict';
import { check, diagram, diagramTypes } from '../dist/esm/node.js';
import { implementations } from '../src/diagram/architecture.js';
import { checkScene } from './helpers/geometry.mjs';

const header = 'architecture\n';
const parse = body => implementations.architecture.parse(body, { lang: 'en', firstLine: 2 });
const flatten = ({ children = [] }) => children.flatMap(node => [node, ...flatten(node)]);
const endsOf = edge => edge.attrs.points.split(' ').filter((_, i, points) => !i || i === points.length - 1);
const render = (body, width = 360) => {
  const { scene, diagnostics } = diagram(header + body, { width });
  assert.ok(scene, JSON.stringify(diagnostics));
  assert.deepEqual(checkScene(scene), []);
  return flatten(scene);
};

// Both public keywords dispatch to the same family.
test('architecture is canonical and architecture-beta is an alias', () => {
  assert.ok(diagramTypes.some(type => type.kind === 'architecture' && type.aliases.includes('architecture-beta')));
  const body = '\nservice a(server)[A]';
  assert.equal(diagram('architecture' + body).svg, diagram('architecture-beta' + body).svg);
});

// Nesting, built-in figures, text icons and bracketed titles survive parsing and painting.
test('nested groups contain their services and accept junctions and icon text', () => {
  const body = `group outer(cloud)[Outer]
  group inner(database)[Inner] in outer
  service disk-1(disk)["Disk [1]"] in inner %% comment
  junction j in outer
  service dock("docker")[Container] in inner
  disk-1:R -- L:j`;
  const { model, errors } = parse(body);
  assert.deepEqual(errors, []);
  assert.equal(model.items.get('disk-1').parent, 'inner');
  assert.equal(model.items.get('j').parent, 'outer');
  assert.equal(model.items.get('dock').iconText, 'docker');
  const nodes = render(body);
  const [outer, inner] = nodes.filter(n => n.meta?.kind === 'frame').map(n => n.attrs);
  assert.ok(outer.x < inner.x && outer.y < inner.y && outer.x + outer.width > inner.x + inner.width && outer.y + outer.height > inner.y + inner.height);
  for (const text of ['Disk [1]', 'docker', 'Container']) assert.ok(nodes.some(n => n.text === text));
  assert.ok(nodes.some(n => n.tag === 'path'), 'built-in icons have real geometry');
});

// Each connector keeps both port directions and the correct number of arrowheads, including a titled edge.
test.each([
  ['L -- R', 'L', 'R', 0, ''], ['T --> B', 'T', 'B', 1, ''],
  ['R <-- L', 'R', 'L', 1, ''], ['R <--> L', 'R', 'L', 2, ''],
  ['R - [sync] -> L', 'R', 'L', 1, 'sync'],
])('draws connector %s', (connector, lhs, rhs, arrows, label) => {
  const body = `service a[A]\nservice b[B]\na:${connector}:b`;
  const { model, errors } = parse(body);
  assert.deepEqual(errors, []);
  assert.deepEqual([model.edges[0].lhs, model.edges[0].rhs, model.edges[0].label], [lhs, rhs, label]);
  const nodes = render(body);
  assert.equal(nodes.filter(n => n.tag === 'polygon').length, arrows);
  if (label) assert.ok(nodes.some(n => n.meta?.kind === 'edge-label-group'));
});

// Every branch ends at the same exact point, with no painted or labelled junction node.
test('a four-way junction has one shared point instead of stubs', () => {
  const nodes = render(`service a[A]\nservice b[B]\nservice c[C]\nservice d[D]\njunction join\na:R -- L:join\njoin:R -- L:b\nc:B -- T:join\njoin:B -- T:d`);
  const endpoints = nodes.filter(n => n.meta?.kind === 'edge').map(n => endsOf(n)[n.meta.from === 'join' ? 0 : 1]);
  assert.equal(endpoints.length, 4);
  assert.equal(new Set(endpoints).size, 1);
  assert.equal(nodes.filter(n => n.meta?.kind === 'node').length, 4);
  assert.ok(!nodes.some(n => n.text === 'join'));
});

// Group endpoints land on the requested frame sides, rather than the enclosed services.
test('a cross-group edge attaches to both frame boundaries', () => {
  const nodes = render('group first[First]\ngroup second[Second]\nservice a[A] in first\nservice b[B] in second\na{group}:B --> T:b{group}');
  const [first, second] = nodes.filter(n => n.meta?.kind === 'frame').map(n => n.attrs);
  const [a, b] = endsOf(nodes.find(n => n.meta?.kind === 'edge')).map(point => point.split(',').map(Number));
  assert.equal(a[1], first.y + first.height);
  assert.equal(b[1], second.y);
});

// Bad declarations point to the source lines that introduce the conflict or invalid reference.
test.each([
  ['group g\nservice a in g\nservice b in g\na{group}:B --> T:b{group}', 5],
  ['service a\nservice b\na:L --> R:b\nalign row a b', 5],
  ['service a\nalign column a', 3],
  ['service a\nalign row a a', 3],
  ['service a\nalign row a b', 3],
  ['service a\nservice b in a', 3],
  ['service a in g\ngroup g', 2],
  ['group g\njunction g', 3],
  ['service a\na --> b', 3],
  ['service a\na -- b', 3],
  ['service a\na <-- b', 3],
  ['group g\nservice a\na:R --> L:g', 4],
])('invalid architecture statement: %s', (body, line) => {
  assert.ok(check(header + body).some(d => d.severity === 'error' && d.line === line));
});

// An unrecognized unqualified icon warns once and doesn't invent a placeholder graphic.
test('unknown icon names produce a nonblocking warning', () => {
  const { svg, scene, diagnostics } = diagram(header + 'service a(other)[A]\nservice b(other)[B]');
  assert.ok(svg);
  assert.deepEqual(diagnostics.map(d => [d.code, d.severity, d.line]), [['IGNORED_ASSET', 'warning', 2]]);
  assert.equal(flatten(scene).filter(n => n.tag === 'path').length, 0);
});

// Pack-qualified icons are deferred to the shared registration phase.
test('iconify references are not silently accepted before integration', () => {
  assert.ok(check(header + 'service a(logos:kubernetes)[K]').some(d => d.severity === 'error' && d.line === 2));
});

// Ports on a horizontal chain remain monotone across group boundaries, with labels inside the service cards.
test('a horizontal chain does not double back or paint a group as a service', () => {
  const nodes = render('group g(cloud)[Cloud]\nservice api(server)[API] in g\nservice db(database)[DB] in g\nservice app(browser)[App]\napp:R --> L:api\napi:R --> L:db');
  assert.deepEqual(nodes.filter(n => n.meta?.kind === 'node').map(n => n.meta.id).sort(), ['api', 'app', 'db']);
  assert.ok(nodes.some(n => n.meta?.kind === 'frame' && n.meta.id === 'g'));
  assert.ok(!nodes.some(n => n.text === 'service'));
  for (const edge of nodes.filter(n => n.meta?.kind === 'edge')) {
    const xs = edge.attrs.points.split(' ').map(point => Number(point.split(',')[0]));
    assert.ok(xs.every((x, i) => !i || x >= xs[i - 1]));
  }
});

// Explicit alignment remains stable and keeps its natural dimensions in a narrow viewport.
test('row alignment follows member order without shrinking or reflowing', () => {
  const body = 'service c[C]\nservice b[B]\nservice a[A]\nservice d[D]\nalign row a b c d';
  const readCards = width => render(body, width).filter(n => n.meta?.kind === 'node').toSorted((a, b) => a.attrs.x - b.attrs.x);
  const cards = readCards(360);
  assert.deepEqual(cards.map(n => n.meta.id), ['a', 'b', 'c', 'd']);
  assert.equal(new Set(cards.map(n => n.attrs.y)).size, 1);
  assert.deepEqual(cards, readCards(800));
  assert.ok(diagram(header + body, { width: 360 }).scene.width > 360);
});
