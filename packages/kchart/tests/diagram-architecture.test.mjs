import { test } from 'vitest';
import assert from 'node:assert/strict';
import { check, diagram, diagramTypes, registerIcons, theme } from '../dist/esm/node.js';
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

// Dropping an unresolved icon slot centers the label without shifting mixed row/column centers or indenting the group title.
test('iconless services use compact centered cards on the same tracks as icon cards', () => {
  const body = 'group api(logos:missing-architecture-icon)[API]\nservice a(logos:missing-architecture-icon)[Database] in api\nservice b(server)[Server] in api\nservice c[Disk] in api\nalign row a b\nalign column a c\na:R -- L:b\na:B -- T:c';
  const { scene, diagnostics } = diagram(header + body, { width: 360 });
  assert.ok(scene, JSON.stringify(diagnostics));
  assert.deepEqual(checkScene(scene), []);
  assert.deepEqual(diagnostics.map(d => d.code), ['IGNORED_ASSET']);
  const elements = flatten(scene), box = id => elements.find(n => n.meta?.id === id).attrs;
  const [a, b, c] = ['a', 'b', 'c'].map(box);
  const centerX = ({ x, width }) => x + width / 2;
  const centerY = ({ y, height }) => y + height / 2;
  assert.equal(centerY(a), centerY(b));
  assert.equal(centerX(a), centerX(c));
  assert.ok(a.height < b.height / 2);
  assert.ok(c.width < a.width);
  for (const [label, card] of [['Database', a], ['Disk', c]]) {
    const { attrs } = elements.find(n => n.text === label);
    assert.equal(attrs.x, centerX(card));
    assert.equal(attrs.y, centerY(card));
  }
  assert.equal(elements.find(n => n.text === 'API').attrs.x - box('api').x, 12);
});

// Exact host-registered packs and shared aliases render real geometry, unknown packs warn without a placeholder.
test('resolves Iconify and label icon references', () => {
  registerIcons({ prefix: 'architecture-test', icons: { service: { body: '<path d="M2 2 L14 14" />' } } });
  const body = 'service a(architecture-test:service)[Registered]\nservice b(mdi:web)[Alias]\nservice c[<b>fa:fa-house Home</b> #35;1]\nservice d[Suffix]::icon(tabler:cloud)\nservice e(logos:no-such-architecture-icon)[Missing]';
  const { scene, diagnostics } = diagram(header + body);
  assert.ok(scene);
  assert.deepEqual(diagnostics.map(d => [d.code, d.severity, d.line]), [['IGNORED_ASSET', 'warning', 6]]);
  assert.deepEqual(checkScene(scene), []);
  const shapes = flatten(scene);
  assert.equal(shapes.filter(n => n.attrs?.transform?.includes('scale(')).length, 4);
  assert.ok(shapes.some(n => n.tag === 'path' && n.attrs.d === 'M2 2 L14 14'));
  assert.ok(shapes.some(n => n.text === 'Home #1'));
});

// Shared presentation maps node/edge style to theme roles and emits only safe links.
test('honors classes, linkStyle and safe links', () => {
  const body = `service a(server)[A]:::danger
service b[Safe]
classDef special fill:#31f
class b special
a:R --> L:b
linkStyle 0 stroke:#f00
click a href "https://example.com" "Details" _blank
click b href "javascript:void(0)"`;
  const result = diagram(header + body);
  assert.ok(result.svg);
  assert.deepEqual(checkScene(result.scene), []);
  assert.deepEqual(result.diagnostics.map(d => d.code), ['IGNORED_INTERACTION']);
  const nodes = flatten(result.scene), design = theme('claude');
  assert.equal(nodes.find(n => n.meta?.id === 'a').attrs.stroke, design.danger);
  assert.equal(nodes.find(n => n.meta?.kind === 'edge').attrs.stroke, design.danger);
  assert.notEqual(nodes.find(n => n.meta?.id === 'a').attrs.stroke, nodes.find(n => n.meta?.id === 'b').attrs.stroke);
  assert.match(result.svg, /<a [^>]*href="https:\/\/example.com"[^>]*rel="noopener noreferrer"/);
  assert.doesNotMatch(result.svg, /javascript:/);
});

// Front matter and init merge in order while unsupported fCoSE knobs warn and accessibility metadata survives.
test('honors architecture dimensions and shared accessibility', () => {
  const source = '---\nconfig:\n  architecture:\n    iconSize: 90\n    padding: 24\n    seed: 3\n---\n%%{init: {"architecture":{"fontSize":18}}}%%\narchitecture\naccTitle: Accessible\naccDescr: Network\ngroup g[Group]\nservice a(server)[Readable] in g';
  const result = diagram(source, { lang: 'en' });
  assert.ok(result.svg, JSON.stringify(result.diagnostics));
  assert.deepEqual(checkScene(result.scene), []);
  assert.equal(result.scene.title, 'Accessible');
  assert.equal(result.scene.description, 'Network');
  assert.deepEqual(result.diagnostics.map(d => d.code), ['IGNORED_CONFIG']);
  assert.match(result.diagnostics[0].message, /architecture\.seed/);
  const nodes = flatten(result.scene), card = nodes.find(n => n.meta?.kind === 'node'), frame = nodes.find(n => n.meta?.kind === 'frame');
  assert.ok(card.attrs.width >= 90);
  assert.equal(card.attrs.x - frame.attrs.x, 24);
  assert.equal(nodes.find(n => n.text === 'Readable').attrs['font-size'], 18);
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
  const body = 'service c(server)[C]\nservice b(server)[B]\nservice a(server)[A]\nservice d(server)[D]\nalign row a b c d';
  const readCards = width => render(body, width).filter(n => n.meta?.kind === 'node').toSorted((a, b) => a.attrs.x - b.attrs.x);
  const cards = readCards(360);
  assert.deepEqual(cards.map(n => n.meta.id), ['a', 'b', 'c', 'd']);
  assert.equal(new Set(cards.map(n => n.attrs.y)).size, 1);
  assert.deepEqual(cards, readCards(800));
  assert.ok(diagram(header + body, { width: 360 }).scene.width > 360);
});
