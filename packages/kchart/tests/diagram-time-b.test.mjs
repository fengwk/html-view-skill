import { test } from 'vitest';
import assert from 'node:assert/strict';
import { implementations as git } from '../src/diagram/gitgraph.js';
import { implementations as kanban } from '../src/diagram/kanban.js';
import { implementations as packet } from '../src/diagram/packet.js';
import { implementations as quadrant } from '../src/diagram/quadrant.js';
import { createContext } from '../src/core/context.js';
import { checkScene } from './helpers/geometry.mjs';

const types = { ...git, ...kanban, ...packet, ...quadrant };
const parse = (kind, body, options) => types[kind].parse(body, { kind, lang: 'en', ...options });
const elements = tree => [tree, ...(tree.children || []).flatMap(elements)];
function render(kind, body, options) {
  const parsed = parse(kind, body, options);
  assert.deepEqual(parsed.errors.filter(x => x.severity !== 'warning'), []);
  const width = 360, ctx = createContext({ width, lang: 'en' });
  const result = types[kind].layout(parsed.model, { ctx, width, renderOptions: { frame: true } });
  assert.deepEqual(checkScene(result.scene), []);
  return { ...result, model: parsed.model, errors: [...parsed.errors, ...result.errors], nodes: elements(result.scene) };
}

// Flexible attribute order, repeated tags, a quoted keyword and switch all affect the Git model.
test('Git commands retain data and sort explicit branch orders', () => {
  const body = 'commit msg "first" id:"root" tag:"v1" type:REVERSE tag:"v2"\nbranch "cherry-pick" order:1\ncommit msg: "second"\nswitch main\ncommit "third"';
  const { model, nodes } = render('gitGraph', body, { config: { gitGraph: { mainBranchOrder: 2, showCommitLabel: false } } });
  assert.deepEqual(model.branches.map(b => b.name), ['cherry-pick', 'main']);
  assert.deepEqual(model.commits.map(c => c.msg), ['first', 'second', 'third']);
  assert.deepEqual(model.commits[0].tags, ['v1', 'v2']);
  assert.ok(nodes.some(n => n.text === 'v2') && !nodes.some(n => n.text === 'root'));
});

// Cherry-picking a merge requires one of its immediate parents and keeps both graph links.
test('Git cherry-pick validates a merge parent and retains provenance', () => {
  const body = 'commit id:"root"\nbranch feature\ncommit id:"f"\nswitch main\nmerge feature id:"m"\nswitch feature\ncherry-pick id:"m"';
  assert.ok(parse('gitGraph', body).errors.length);
  assert.ok(parse('gitGraph', `${body} parent:"unknown"`).errors.length);
  const { model, nodes } = render('gitGraph', `${body} parent:"f"`);
  assert.deepEqual(model.commits.at(-1).parents, [1, 2]);
  assert.deepEqual(model.commits.at(-1).tags, ['cherry-pick:m|parent:f']);
  assert.deepEqual(nodes.filter(n => n.meta?.kind === 'edge' && n.meta.to === 3).map(n => n.meta.from), [1, 2]);
  assert.ok(parse('gitGraph', 'branch empty\nswitch main\ncommit\nmerge empty').errors.length);
});

// Parallel histories share a time slot and BT reverses time without reversing ancestry.
test('Git parallel BT aligns sibling commits', () => {
  const body = 'commit\nbranch side\ncommit\ncommit\nswitch main\ncommit\ncommit';
  const { nodes } = render('gitGraph', body, { params: 'BT:', config: { gitGraph: { parallelCommits: true } } });
  const cy = id => nodes.find(n => n.meta?.kind === 'node' && n.meta.id === id).attrs.cy;
  assert.equal(cy(1), cy(3));
  assert.equal(cy(2), cy(4));
  assert.ok(cy(0) > cy(1));
});

// Fifteen columns remain readable and warn about scrolling rather than blocking a wide board.
test('kanban grows past legacy column caps', () => {
  const body = Array.from({ length: 15 }, (_, i) => `  [Column ${i}]\n    [Card]`).join('\n');
  const { errors, width, nodes } = render('kanban', body);
  assert.ok(width > 720);
  assert.equal(errors[0].code, 'LARGE_DIAGRAM');
  assert.equal(nodes.filter(n => n.meta?.kind === 'frame').length, 15);
});

// Ragged deeper indentation flattens, columns may repeat IDs, and invalid priorities warn once.
test('kanban preserves metadata and validates indentation and per-column IDs', () => {
  const body = '  [One]\n    same(First)@{ ticket: ABC-1, assigned: "Doe, A", priority: High }\n      [Second]@{ priority: high }\n  [Two]\n    same{{Third}}';
  const { model, nodes } = render('kanban', body);
  assert.deepEqual(model.columns.map(c => c.cards.length), [2, 1]);
  assert.ok(nodes.some(n => n.text === 'ABC-1') && nodes.some(n => n.text === 'Doe, A'));
  assert.equal(parse('kanban', body).errors[0].code, 'DIAGRAM_HINT');
  assert.ok(parse('kanban', `${body}\n    same[Again]`).errors.some(e => /Duplicate/.test(e.message)));
  assert.ok(parse('kanban', `${body}\n [Outside]`).errors.some(e => /shallower/.test(e.message)));
});

// Status bars distinguish levels while unsafe ticket URLs leave the visible ticket unlinked.
test('kanban draws the four colored priorities and rejects unsafe links', () => {
  const body = '[Queue]\n' + ['Very High', 'High', 'Medium', 'Low', 'Very Low'].map((p, i) => `  [Card ${i}]@{ priority: '${p}', ticket: ABC-${i} }`).join('\n');
  const { nodes, errors } = render('kanban', body, { config: { kanban: { ticketBaseUrl: 'javascript:#TICKET#' } } });
  assert.equal(nodes.filter(n => n.tag === 'rect' && n.attrs.width === 4).length, 4);
  assert.ok(nodes.every(n => n.tag !== 'a'));
  assert.equal(errors[0].code, 'IGNORED_INTERACTION');
});

// Relative and single-bit fields begin at zero and split across the ruler's row boundaries.
test('packet supports repeat relative fields, row continuations and multirow ranges', () => {
  const body = '0: "Flag"\n' + Array(7).fill('+1: "x"').join('\n') + '\n8-27: "Header"\n28-35: "Split"\n+164: "Payload"';
  const { model, nodes } = render('packet', body);
  assert.equal(model.fields.at(-1).end, 199);
  assert.equal(nodes.filter(n => n.text === 'Split').length, 2);
  assert.ok(nodes.some(n => n.text === '192–199'));
});

// Descending bit order mirrors even a short final row, and showBits can remove ranges entirely.
test('packet mirrors segments and diagnoses gaps, overlaps and zero widths', () => {
  const body = '+4: "A"\n+12: "B"\n+4: "C"';
  const { nodes } = render('packet', body, { config: { packet: { bitsPerRow: 16, bitOrder: 'descending', showBits: false } } });
  const cells = nodes.filter(n => n.meta?.kind === 'node');
  assert.ok(cells[0].attrs.x > cells[1].attrs.x);
  assert.equal(cells[0].attrs.x, cells[2].attrs.x);
  assert.ok(nodes.every(n => !/\d/.test(n.text ?? '')));
  for (const invalid of ['+0: "zero"', '1: "gap"', '0: "a"\n0: "overlap"']) assert.ok(parse('packet', invalid).errors.length);
});

// Axis delimiters are not printed, quoted arrows are literal, and unpaired axes preserve direction.
test('quadrant retains axis endpoints and supports a point-free plot', () => {
  const { model, nodes } = render('quadrantChart', 'x-axis "A --> B" --> Right\ny-axis Low\nquadrant-1 First');
  assert.deepEqual(model.axes, { x: ['A --> B', 'Right'], y: ['Low ⟶'] });
  const frame = nodes.find(n => n.meta?.kind === 'frame');
  assert.ok(nodes.find(n => n.text === 'Right').attrs.y < frame.attrs.y);
  assert.equal(nodes.find(n => n.text === 'First').attrs.y, frame.attrs.y + frame.attrs.height / 4);
});

// Endpoints remain on the axes and clustered point labels stay distinct even with a clamped radius.
test('quadrant lays out endpoint and clustered labels without collisions', () => {
  const close = Array.from({ length: 6 }, (_, i) => `Cluster ${i}: [${.5 + i / 100}, .5]`).join('\n');
  const body = 'Min: [0,0]\nMax: [1,1] radius:25,color:#ff3300\n' + close;
  const { nodes, errors } = render('quadrantChart', body);
  const frame = nodes.find(n => n.meta?.kind === 'frame');
  const dots = nodes.filter(n => n.meta?.kind === 'node');
  assert.equal(dots[0].attrs.cx, frame.attrs.x);
  assert.equal(dots[1].attrs.cy, frame.attrs.y);
  assert.equal(dots[1].attrs.r, 12);
  assert.equal(errors[0].code, 'IGNORED_STYLE');
  for (let i = 0; i < 6; i++) assert.ok(nodes.some(n => n.text?.startsWith(`Cluster ${i}`)));
  assert.ok(parse('quadrantChart', 'Outside: [1.2, 0.3]').errors.length);
});
