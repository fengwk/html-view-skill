import { test } from 'vitest';
import assert from 'node:assert/strict';
import { check, diagram, diagramTypes } from '../dist/esm/node.js';
import { checkScene } from './helpers/geometry.mjs';

const walk = children => children.flatMap(node => [node, ...walk(node.children ?? [])]);
function render(body, width = 360, kind = 'block') {
  const result = diagram(`${kind}\n${body}`, { width, lang: 'en' });
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error'), []);
  assert.deepEqual(checkScene(result.scene), []);
  return { ...result, elements: walk(result.scene.children) };
}
const byKind = (result, kind) => result.elements.filter(node => node.meta?.kind === kind);
const rects = (result, kind = 'node') => Object.fromEntries(byKind(result, kind).map(node => [node.meta.id, node.children[0].attrs]));

// Implicit and explicit auto keep five blocks on a single row even when the viewport must scroll.
test('auto columns and the beta alias preserve composition', () => {
  assert.deepEqual(diagramTypes.find(item => item.kind === 'block').aliases, ['block-beta']);
  const auto = render('columns auto\na b c d e', 360, 'BLOCK-BETA');
  const cells = Object.values(rects(auto));
  assert.equal(auto.svg, render('a b c d e').svg);
  assert.ok(auto.scene.width > 360);
  assert.ok(cells.every((cell, i) => cell.y === cells[0].y && (!i || cell.x > cells[i - 1].x)));
});

// Explicit one-column placement does not depend on source line breaks or edge direction.
test('one column keeps author order', () => {
  const body = 'columns 1\na b c';
  const { a, b, c } = rects(render(`${body}\nc --> a`));
  assert.equal(a.x, b.x);
  assert.equal(b.x, c.x);
  assert.ok(a.y < b.y && b.y < c.y);
  assert.deepEqual({ a, b, c }, rects(render(body)));
});

// A two-column span changes the next block's column; overflow only advances to the next row.
test('colspan and row-end overflow', () => {
  const { a, b, c, d } = rects(render('columns 3\na["A"] b:2 c:2 d'));
  const pitch = b.x - a.x;
  assert.equal(b.width, a.width + pitch);
  assert.equal(c.x, a.x);
  assert.equal(d.x, a.x + 2 * pitch);
  assert.equal(d.y, c.y);
  assert.ok(c.y > a.y);
  const spill = rects(render('columns 3\na b c:2 d e'));
  assert.equal(spill.c.width, spill.a.width + pitch);
  assert.equal(spill.d.x, spill.a.x);
  assert.equal(spill.e.x, spill.b.x);
  assert.ok(spill.d.y > spill.c.y);
});

// Medium labels fit on one line; genuinely long labels wrap without changing the authored column span.
test('content sizes its tracks before wrapping at a readable maximum', () => {
  const label = 'This is the text in the box';
  const long = 'The full label stays readable without a very wide block '.repeat(3).trim();
  for (const width of [800, 360]) {
    for (const shape of [`("${label}")`, `[["${label}"]]`]) {
      const [node] = byKind(render(`a${shape}`, width), 'node');
      assert.deepEqual(walk(node.children).filter(item => item.tag === 'text').map(item => item.text), [label]);
    }
    const result = render(`columns 3\na["${long}"]:2 b\nc d e`, width);
    const { a, b, c, d, e } = rects(result);
    assert.equal(a.width, c.width + d.x - c.x);
    assert.equal(b.x, e.x);
    const lines = walk(byKind(result, 'node')[0].children).filter(item => item.tag === 'text');
    assert.ok(lines.length > 1);
    assert.equal(lines.map(item => item.text).join(' '), long);
  }
});

// Reservation consumes exact tracks, including empty row starts, row ends and wrapped space runs.
test('space is an unpainted cell, not an inter-node gap', () => {
  const { ida, idb, idc } = rects(render('ida space:3 idb idc'));
  assert.equal(idb.x - ida.x, 4 * (idc.x - idb.x));
  const { a, b, c } = rects(render('columns 3\nspace a space:2 b c'));
  assert.equal(a.x, b.x);
  assert.ok(c.x > b.x && b.y > a.y);
});

// Three explicitly nested frames maintain independent column counts and a labeled frame title.
test('nested composite subgrids', () => {
  const result = render('columns 2\nblock:g["Group"]:2\n columns 1\n a\n block:h\n  columns 2\n  b c\n  block:i:2\n   columns 1\n   d e\n  end\n end\nend\nf');
  const { g, h, i } = rects(result, 'frame');
  const { a, b, c, d, e, f } = rects(result);
  assert.ok(g.x < h.x && h.x < i.x && i.x < d.x);
  assert.equal(b.y, c.y);
  assert.ok(a.y < b.y && d.y < e.y && e.y < f.y);
  assert.equal(d.x, e.x);
  assert.ok(result.elements.some(node => node.text === 'Group'));
});

// Combined x/down yields visible tips in both horizontal directions and on the bottom.
test('compound block arrow', () => {
  const result = render('blockArrowId7<["x"]>(x, down)');
  const outline = byKind(result, 'node')[0].children[0];
  const points = outline.attrs.points.split(' ').map(pair => pair.split(',').map(Number));
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  for (const [axis, tip] of [[0, Math.min(...xs)], [0, Math.max(...xs)], [1, Math.max(...ys)]]) {
    assert.equal(points.filter(p => p[axis] === tip).length, 1);
  }
});

// Inline edge declarations preserve labels, endpoint marker types and stroke variants.
test('labeled and unlabelled edge syntax', () => {
  const result = render('columns 3\nA--"X"-->B\nC --o D\nE -.- F\nG == H\nI --- J\nK <--> L\nM --x N\nO ~~~ P');
  const [labeled, circle, dotted, thick, plain, both, cross, tilde] = byKind(result, 'edge').map(node => node.attrs);
  assert.match(labeled['marker-end'], /^url\(#board-arrow-[\da-f]+\)$/);
  assert.match(circle['marker-end'], /^url\(#board-circle-[\da-f]+\)$/);
  assert.ok(dotted['stroke-dasharray']);
  assert.ok(thick['stroke-width'] > plain['stroke-width']);
  assert.equal(plain['marker-end'], undefined);
  assert.equal(both['marker-start'], both['marker-end']);
  assert.match(cross['marker-end'], /^url\(#board-cross-[\da-f]+\)$/);
  assert.equal(tilde['marker-end'], undefined);
  assert.equal(byKind(result, 'edge-label-group').length, 1);
  assert.ok(result.elements.some(node => node.text === 'X'));
});

// Updating edge endpoint labels must not allocate duplicate cells or move an existing block.
test('repeated endpoints reuse the first grid slot', () => {
  const result = render('A space B\nA("Start")-->B("Stop")');
  assert.deepEqual(byKind(result, 'node').map(node => node.meta.id), ['A', 'B']);
  assert.ok(result.elements.some(node => node.text === 'Start'));
  assert.ok(result.elements.some(node => node.text === 'Stop'));
});

// The former beta subset still supports unquoted labels, a trailing edge label and an implicit in-group endpoint.
test('legacy beta input uses the same nested grid renderer', () => {
  const result = render('block:store\ncache[Cache]\nspace\ncache --> disk : connects\nend', 800, 'block-beta');
  const { store } = rects(result, 'frame'), { cache, disk } = rects(result);
  assert.ok(store.x < cache.x && cache.x + cache.width < disk.x && disk.x + disk.width < store.x + store.width);
  assert.deepEqual(Object.keys(rects(result)), ['cache', 'disk']);
  assert.ok(result.elements.some(node => node.text === 'connects'));
});

// Empty diagrams, unclosed groups and invalid styles still report the relevant source lines.
test('invalid statements are not interpreted as nodes', () => {
  for (const [body, line] of [['', 1], ['end', 2], ['block:g\na', 2], ['a\nstyle a foo', 3]]) {
    assert.ok(check(`block\n${body}`).some(d => d.severity === 'error' && d.line === line));
  }
});

// Styles apply in cascade order to blocks and named frames, never to an arrow glyph.
test('presentation styles use theme roles without consuming grid slots', () => {
  const body = 'block:g\nA:::warn space B C D\nend\narrow<["Next"]>(right)';
  const result = render(`${body}\nclassDef default fill:red\nclassDef healthy fill:lime\nclass B,C healthy\nstyle g,B fill:blue\nstyle arrow fill:blue`);
  // Nodes keep Mermaid's status; groups carry the same word as their board style.
  const statuses = Object.fromEntries(result.elements.filter(node => node.meta?.status || node.meta?.style).map(node => [node.meta.id, node.meta.status ?? node.meta.style]));
  assert.deepEqual(statuses, { g: 'info', A: 'warn', B: 'info', C: 'ok', D: 'danger' });
  assert.notEqual(rects(result, 'frame').g.stroke, rects(render(body), 'frame').g.stroke);
  assert.equal(byKind(result, 'node').length, 5);
  assert.ok(result.diagnostics.some(d => d.code === 'IGNORED_STYLE' && d.line === 10 && d.severity === 'warning'));
});

// Mermaid accepts the missing-colon CSS in 490 but it has no visual effect.
test('colonless hex style warns without changing the scene', () => {
  const result = render('A\nstyle A fill#969;');
  assert.equal(result.svg, render('A').svg);
  assert.equal(result.diagnostics[0].code, 'IGNORED_STYLE');
});

// Links, icon geometry and normalized text belong to the corresponding marked scene parts.
test('links, labels, icons and linkStyle use the shared contracts', () => {
  const result = render('A["<b>Save</b> #9829;<br>fa:fa-house done"] space:2 B::icon(tabler:missing-block-icon)\nA--"<i>Go</i> #35;1"-->B\nclick A "https://example.com" "Docs" _blank\nclick B href "javascript:alert(1)"\nlinkStyle 0 stroke:red');
  const anchor = result.elements.find(node => node.tag === 'a');
  assert.equal(anchor.attrs.href, 'https://example.com');
  assert.equal(anchor.attrs.rel, 'noopener noreferrer');
  assert.equal(anchor.children.find(node => node.meta?.kind === 'node').meta.id, 'A');
  assert.ok(result.elements.some(node => node.text === 'Save ♥'));
  assert.ok(result.elements.some(node => node.text === 'Go #1'));
  assert.ok(walk(anchor.children).some(node => node.tag === 'path'), 'resolved icon has vector geometry');
  assert.equal(result.elements.filter(node => node.tag === 'a').length, 1);
  const [edge] = byKind(result, 'edge');
  assert.match(edge.attrs['marker-end'], /^url\(#board-arrow-[\da-f]+\)$/);
  assert.notEqual(edge.attrs.stroke, byKind(render('A space:2 B\nA-->B'), 'edge')[0].attrs.stroke, 'linkStyle red maps to the danger hue');
  assert.ok(result.diagnostics.some(d => d.code === 'IGNORED_ASSET'));
  assert.ok(result.diagnostics.some(d => d.code === 'IGNORED_INTERACTION'));
});

// YAML and directives merge via the registry; block.padding changes the frame inset only, not its column semantics.
test('block padding honors merged configuration', () => {
  const source = '---\nconfig:\n  block:\n    padding: 20\n---\n%%{init: {"block": {"padding": 30}}}%%\nblock\nblock:g\ncolumns 2\nA B\nend';
  const result = diagram(source, { width: 360 });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(checkScene(result.scene), []);
  const shapes = { elements: walk(result.scene.children) };
  const { A, B } = rects(shapes), { g } = rects(shapes, 'frame');
  assert.equal(A.y - g.y, 30);
  assert.equal(A.x - g.x, 30);
  assert.equal(B.y, A.y);
  const invalid = diagram(source.replace('"padding": 30', '"padding": 3000'), { width: 360 });
  assert.ok(invalid.svg);
  assert.deepEqual(invalid.diagnostics.map(({ code, severity }) => [code, severity]), [['IGNORED_CONFIG', 'warning']]);
});
