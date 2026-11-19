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
  assert.equal(labeled['marker-end'], 'url(#block-point)');
  assert.equal(circle['marker-end'], 'url(#block-circle)');
  assert.equal(dotted['stroke-dasharray'], '2 4');
  assert.ok(thick['stroke-width'] > plain['stroke-width']);
  assert.equal(plain['marker-end'], undefined);
  assert.equal(both['marker-start'], both['marker-end']);
  assert.equal(cross['marker-end'], 'url(#block-cross)');
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

// Empty diagrams, malformed composite statements and deferred presentation syntax report source lines.
test('invalid or deferred statements are not interpreted as nodes', () => {
  for (const [body, line] of [['', 1], ['end', 2], ['block:g\na', 2], ['block:g\na\nend\nstyle g fill:#669', 5], ['a<["x"]>(down)\nstyle a fill:#669', 3]]) {
    assert.ok(check(`block\n${body}`).some(d => d.severity === 'error' && d.line === line));
  }
});
