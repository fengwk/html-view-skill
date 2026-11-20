import { test } from 'vitest';
import assert from 'node:assert/strict';
import { diagram, check } from '../dist/esm/node.js';
import { createContext } from '../src/core/context.js';
import { measureOf } from '../src/diagram/support.js';
import { implementations as tree } from '../src/diagram/treeview.js';
import { implementations as venn } from '../src/diagram/venn.js';
import { implementations as cynefin } from '../src/diagram/cynefin.js';
import { checkScene } from './helpers/geometry.mjs';

const parseTree = body => tree['treeView-beta'].parse(body, { lang: 'en' });
const parseVenn = body => venn['venn-beta'].parse(body, { lang: 'en', firstLine: 2 });
function draw(source, width) {
  const result = diagram(source, { width, lang: 'en' });
  assert.ok(result.svg, JSON.stringify(result.diagnostics));
  assert.deepEqual(checkScene(result.scene), []);
  return result;
}

// Heavy branches, tabs and comments preserve relative depth and an empty directory remains a directory.
test('treeView nested paths', () => {
  const { model, errors } = parseTree('┣━━ packages/\n%% note\n┃\t┗━━ parser/src/\n┗━━ "README"');
  assert.deepEqual(errors, []);
  assert.deepEqual(model.rows.map(row => [row.label, row.depth, row.directory]), [['/', 0, true], ['packages', 1, true], ['parser/src', 2, true], ['README', 1, false]]);
  assert.equal(parseTree('root\n\tchild\n    sibling').model.rows.at(-1).depth, 2);
});

// Quoting shields annotation tokens, and a none icon remains distinct from a deferred icon reference.
test('treeView annotations and empty root', () => {
  const { model, errors } = parseTree('"🛠️ ## tools" icon(none) :::highlight ## example :::literal');
  assert.deepEqual(errors, []);
  assert.equal(model.rows[1].label, '🛠️ ## tools');
  assert.equal(model.rows[1].description, 'example :::literal');
  assert.equal(model.rows[1].icon, 'none');
  assert.equal(model.rows[1].highlight, true);
  assert.match(draw('treeView-beta', 360).svg, />\/<\/text>/);
});

// The two box-prefix errors carry the original line even after a comment is ignored.
test('treeView locates malformed box prefixes', () => {
  const { errors } = parseTree('├── one\n%% skip\n    two\n└──');
  assert.deepEqual(errors.map(({ line }) => line), [4, 5]);
  assert.match(errors[0].message, /without box-drawing/);
  assert.match(errors[1].message, /Empty node/);
});

// Readable large trees warn rather than failing at the obsolete 80-row layout limit.
test('treeView renders 81 rows', () => {
  const { diagnostics } = draw(`treeView-beta\n${Array.from({ length: 81 }, (_, i) => `file-${i}`).join('\n')}`, 360);
  assert.equal(diagnostics.filter(d => d.code === 'LARGE_DIAGRAM').length, 1);
});

// Venn set area follows declared weights, including an unlabelled set whose ID becomes its label.
test('Venn weighted rings and single Unicode set', () => {
  const { svg } = draw('venn-beta\nset A:20\nset B:12\nunion A,B["Shared"]', 360);
  const radii = [...svg.matchAll(/<circle[^>]+r="([\d.]+)"[^>]+data-kc-kind="node"/g)].map(match => Number(match[1]));
  assert.equal(radii.length, 2);
  assert.ok(Math.abs((radii[0] / radii[1]) ** 2 - 20 / 12) < .01);
  assert.match(draw('venn-beta\nset A["集合"]', 360).svg, /集合/);
});

// Three-member labels render without an explicit pair declaration and stay deterministic after widening.
test('Venn triple intersection at narrow and wide widths', () => {
  const source = 'venn-beta\nset A\nset B\nset C\nunion A,B,C["Innovation"]';
  for (const width of [360, 1200]) {
    const { svg } = draw(source, width);
    assert.match(svg, /Innovation/);
    assert.equal(svg, diagram(source, { width, lang: 'en' }).svg);
  }
});

// The region grid shows extra sets; oversized intersection labels retain a fallback instead of clipping.
test('Venn region fallbacks', () => {
  const grid = draw('venn-beta\nset A\nset B\nset C\nset D\nset E\nunion A,B', 360);
  assert.ok(grid.diagnostics.some(d => d.code === 'DIAGRAM_HINT'));
  const long = draw(`venn-beta\nset A\nset B\nunion A,B["${'LongLabel'.repeat(30)}"]`, 360);
  assert.ok(long.diagnostics.some(d => d.code === 'DIAGRAM_HINT'));
});

// Missing members and orphan labels fail; neutral multi-member styles warn without blocking.
test('Venn parser ownership, member checks and neutral style notice', () => {
  assert.ok(check('venn-beta\ntext A["Orphan"]').some(d => d.severity === 'error'));
  assert.ok(check('venn-beta\nset A\nunion A,B').some(d => d.severity === 'error'));
  const { errors } = parseVenn('set A\nset B\nstyle A,B color:#333');
  assert.deepEqual(errors.map(d => [d.code, d.line]), [['IGNORED_STYLE', 4]]);
});

// Built-in icons are on by default, an explicit `none` suppresses one, and showIcons disables all.
test('treeView default icons, branded icon override and showIcons', () => {
  const source = 'treeView-beta\nsrc/\n  app.tsx icon(logos:react)\n  notes.txt icon(none)';
  const icons = svg => [...svg.matchAll(/data-kc-kind="icon"/g)].length;
  assert.equal(icons(draw(source, 360).svg), 3);
  assert.equal(icons(draw(`---\nconfig:\n  treeView:\n    showIcons: false\n---\n${source}`, 360).svg), 0);
});

// Leading emoji replace defaults, unknown references keep defaults, and a known brand uses its own outline.
test('treeView distinguishes inline emoji, unknown icons and React', () => {
  const { model, errors } = parseTree('🚀 project/\n  🛠️ tools/\n  1.txt\n  one.txt icon(logos:no-such-icon)\n  two.txt icon(logos:no-such-icon)\n  app.tsx icon(logos:react)');
  const [, project, tools, digit, one, two, app] = model.rows;
  assert.equal(project.glyph, null);
  assert.equal(tools.glyph, null);
  assert.ok(digit.glyph);
  assert.equal(one.glyph, digit.glyph);
  assert.equal(two.glyph, digit.glyph);
  assert.equal(app.glyph.set, 'simple');
  assert.deepEqual(errors.map(issue => issue.code), ['IGNORED_ASSET']);
});

// Unequal numbers of domain items must not offset the headers of a shared row.
test('Cynefin headers align across each row', () => {
  const { svg } = draw('cynefin-beta\nchaotic\n"One"\nclear\n"One"\n"Two"', 360);
  const yOf = name => svg.match(new RegExp(`<text[^>]+ y="([^"]+)"[^>]*>${name}</text>`))[1];
  assert.equal(yOf('Complex'), yOf('Complicated'));
  assert.equal(yOf('Chaotic'), yOf('Clear'));
});

// A sorted multi-member style sets the intersection role, and links remain on the labelled set.
test('Venn applies shared presentation to set, region and item', () => {
  const source = 'set A["A &amp; B"]\n  text T["fa:fa-home Item"]\nset B\nunion A,B["Overlap"]\nstyle B, A fill:#d22\nstyle T fill:#2700cc\nclick A href "https://example.com"';
  const { errors, model } = parseVenn(source);
  assert.deepEqual(errors, []);
  assert.equal(model.unions[0].status, 'danger');
  const { svg } = draw(`venn-beta\n${source}`, 360);
  assert.match(svg, /href="https:\/\/example.com"/);
  assert.match(svg, /data-kc-kind="icon"/);
  assert.match(svg, /A &amp; B/);
});

// Cynefin keeps all central items instead of collapsing the last two into a count.
test('Cynefin confusion grows without hiding items', () => {
  const { svg } = draw('cynefin-beta\nconfusion\n"First"\n"Second"\n"Third"\n"Fourth"\n"Fifth"', 360);
  for (const item of ['First', 'Second', 'Third', 'Fourth', 'Fifth']) assert.match(svg, new RegExp(item));
});

// The public entry accepts the glued colon header and draws the four fixed quadrants.
test('Cynefin empty quadrants and colon remainder', () => {
  const { svg } = draw('cynefin-beta:', 360);
  for (const domain of ['Complex', 'Complicated', 'Chaotic', 'Clear']) assert.match(svg, new RegExp(domain));
});

// Labels must be quoted and a self-loop produces a non-blocking hint instead of a zero-length arrow.
test('Cynefin malformed items, domains and self-loop', () => {
  for (const body of ['unexpected', 'clear\nunquoted', 'clear --> complex: unquoted']) {
    assert.ok(check(`cynefin-beta\n${body}`).some(d => d.severity === 'error'));
  }
  const { diagnostics, svg } = draw('cynefin-beta\nclear --> clear', 360);
  assert.ok(diagnostics.some(d => d.code === 'DIAGRAM_HINT'));
  assert.doesNotMatch(svg, /data-kc-kind="edge"/);
});

// A diagonal transition goes around the centre and all four labeled paths remain distinct and deterministic.
test('Cynefin transition geometry', () => {
  const source = 'cynefin-beta\nchaotic --> complex: "Stabilize"\ncomplex --> clear: "Codify"\ncomplicated --> clear: "Standardize"\nclear --> chaotic: "Reassess"';
  const { svg } = draw(source, 800);
  assert.equal([...svg.matchAll(/data-kc-kind="edge"/g)].length, 4);
  assert.equal(svg, diagram(source, { width: 800, lang: 'en' }).svg);
  const impl = cynefin['cynefin-beta'];
  const { model } = impl.parse(source.split('\n').slice(1).join('\n'), { lang: 'en' });
  const ctx = createContext({ width: 800 });
  const plan = impl.layout(model, { ctx, measure: measureOf(ctx), width: 800, lang: 'en' });
  const { a, b, ctrl } = plan.arcs[1];
  const x = (a.x + 2 * ctrl.x + b.x) / 4, y = (a.y + 2 * ctrl.y + b.y) / 4;
  assert.ok(((x - plan.centre.x) / plan.rx) ** 2 + ((y - plan.centre.y) / plan.ry) ** 2 > 1);
});
