import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { implementations } from '../src/diagram/ishikawa.js';
import { createContext } from '../src/core/context.js';
import { renderScene } from '../src/core/svg.js';
import { measureOf } from '../src/diagram/support.js';
import { checkScene } from './helpers/geometry.mjs';

const implementation = implementations.ishikawa;
const plain = (value) => JSON.parse(JSON.stringify(value));
const corpus = JSON.parse(readFileSync(new URL('./conformance/mermaid-12.3.0.json', import.meta.url), 'utf8'));
const corpusLines = corpus.find((record) => record.id === 'ishikawa.md:14').source.split('\n');
// The registry hands the parser everything after the header, with firstLine pointing at the first body line.
const corpusBody = corpusLines.slice(1).join('\n');
const info = { kind: 'ishikawa', syntax: 'mermaid', header: 'ishikawa-beta', headerLine: 1, firstLine: 2, params: '', lang: 'en', options: Object.create(null) };
const parse = (body, overrides = {}) => implementation.parse(body, { ...info, ...overrides });

// Rendering runs the real context so measured text and the geometry gate agree pixel for pixel.
function draw(model, width, lang = 'en') {
  const ctx = createContext({ width });
  const geometry = implementation.layout(model, { width, lang, measure: measureOf(ctx), ctx, renderOptions: {} });
  const scene = implementation.scene(geometry, ctx, info);
  return { ctx, geometry, scene, issues: checkScene(scene, { measure: ctx.measure }) };
}

// 4-space steps give levels 1/5/9 while the tree stays four levels deep: the delta rule, not indent/4.
test('levels come from the indentation delta of the first cause', () => {
  const parsed = parse(corpusBody);
  assert.deepEqual(plain(parsed.errors), []);
  const root = parsed.model.root;
  assert.equal(root.label, 'Blurry Photo', 'the first content line is the problem, not the header');
  assert.equal(parsed.model.title, 'Blurry Photo', 'the problem line is also the diagram title');
  assert.deepEqual(root.children.map(category => category.label), ['Process', 'User', 'Equipment', 'Environment']);
  assert.equal(parsed.model.count, 19, 'the problem plus eighteen causes');
  assert.deepEqual(root.children[0].children.map(node => [node.label, node.line]), [
    ['Out of focus', 4], ['Shutter speed too slow', 5], ['Protective film not removed', 6], ['Beautification filter applied', 7],
  ]);
  // Four-space steps keep the tree four levels deep even though the raw indents are 4/8/12 across sub-bones.
  assert.deepEqual(root.children[2].children.map(node => node.label), ['LENS', 'SENSOR']);
  assert.deepEqual(root.children[2].children[0].children.map(node => node.label), ['Inappropriate lens', 'Damaged lens', 'Dirty lens']);
  assert.equal(parsed.model.root.children[2].children[0].children[0].children.length, 0, 'depth caps at the fourth level');
});

// Tabs count as one whitespace character of indentation and %% comment lines never become causes.
test('tabs indent and whole-line %% comments are skipped without shifting levels', () => {
  const tabs = parse('Problem\n\tTab cause\n\t\tTab child\n\tTab sibling');
  assert.deepEqual(plain(tabs.errors), []);
  assert.deepEqual(tabs.model.root.children.map(node => [node.label, node.children.map(child => child.label)]), [['Tab cause', ['Tab child']], ['Tab sibling', []]]);
  const commented = parse('Problem\n%% leading note\n    A\n        a1\n  %% indented note\n    B\nmid %% stays text');
  assert.deepEqual(plain(commented.errors), []);
  assert.deepEqual(commented.model.root.children.map(node => node.label), ['A', 'B', 'mid %% stays text']);
  assert.equal(commented.model.root.children[2].line, 8, 'kept labels still report their own source line');
  assert.equal(commented.model.root.children[1].line, 7);
});

// Both header spellings are one kind; a trailing header word is the problem line, as in Mermaid's lexer.
test('ishikawa and ishikawa-beta are equivalent, header text is the problem line', () => {
  for (const header of ['ishikawa', 'ISHIKAWA-BETA']) {
    const parsed = parse('Problem\n    Cause', { header });
    assert.equal(parsed.model.root.label, 'Problem');
    assert.deepEqual(parsed.model.root.children.map(node => node.label), ['Cause']);
  }
  const inline = parse('\n    Cause', { params: 'Inline problem' });
  assert.equal(inline.model.root.label, 'Inline problem');
  assert.equal(inline.model.root.line, 1, 'header text keeps the header line');
  assert.deepEqual(inline.model.root.children.map(node => node.label), ['Cause']);
});

// A header without a problem line is this type's only blocking diagnostic.
test('a diagram without a problem line fails on the header line', () => {
  for (const body of ['', '\n\n   \n%% only comments\n']) {
    const parsed = parse(body);
    assert.equal(parsed.errors.length, 1);
    assert.equal(parsed.errors[0].line, 1);
    assert.equal(parsed.errors[0].severity, undefined, 'plain errors block rendering');
    assert.match(parsed.errors[0].message, /no problem line/);
  }
});

// Mermaid pops to the nearest shallower cause instead of rejecting a skipped indentation level.
test('a skipped indentation level reattaches rather than erroring', () => {
  const parsed = parse('Problem\n  A\n      deep\n  B');
  assert.deepEqual(plain(parsed.errors), []);
  assert.deepEqual(parsed.model.root.children.map(node => [node.label, node.children.map(child => child.label)]), [['A', ['deep']], ['B', []]]);
});

// Depth alternates horizontal and diagonal bones; deeper levels keep hanging on their own parent.
test('depth-parity bones reach the fourth level with one edge per cause', () => {
  const parsed = parse('Problem\n  Cat\n    Sub\n      Deep\n        Deeper\n    Sub2\n  Cat2');
  assert.deepEqual(plain(parsed.errors), []);
  const { geometry } = draw(parsed.model, 800);
  assert.equal(geometry.bones.length, parsed.model.count - 1, 'one bone per cause, the spine excluded');
  const cat = parsed.model.root.children[0];
  const sub = cat.children[0];
  const deep = sub.children[0];
  const deeper = deep.children[0];
  const boneOf = (id) => geometry.bones.find(bone => bone.to === id);
  const [x0, y0] = boneOf(sub.id).points[0], [x1, y1] = boneOf(sub.id).points[1];
  const [u0, v0] = boneOf(deep.id).points[0], [u1, v1] = boneOf(deep.id).points[1];
  assert.equal(y0, y1, 'a depth-2 sub-bone is horizontal');
  assert.notEqual(u0, u1, 'a depth-3 sub-bone is diagonal');
  assert.equal(v0, y0, 'the diagonal starts on its parent bone, not in mid-air');
  assert.ok(Math.abs(x1 - x0) >= 30, 'a horizontal bone has a readable run');
  assert.ok(Math.abs(v1 - v0) > Math.abs(u1 - u0), 'a diagonal rises more than it drifts');
  assert.equal(boneOf(cat.id).from, 'root');
  assert.equal(boneOf(deeper.id).from, deep.id);
});

// Labels never touch: the geometry gate must stay clean from 320px (rewrap, then widen) to 1200px.
test('the corpus example is clean at 320, 360, 800 and 1200 px', () => {
  const parsed = parse(corpusBody);
  for (const width of [320, 360, 800, 1200]) {
    const { geometry, issues, scene } = draw(parsed.model, width);
    assert.deepEqual(issues, [], `width ${width}`);
    assert.equal(geometry.chips.length, 4);
    assert.equal(geometry.labels.length, 14);
    assert.equal(geometry.bones.length, 18);
    assert.ok(scene.width > 0 && scene.height > 0);
  }
  // A narrow frame rewraps the same labels and widens the scene instead of shrinking text.
  const narrow = draw(parsed.model, 320).geometry;
  const wide = draw(parsed.model, 1200).geometry;
  assert.ok(narrow.cap < wide.cap, 'the wrap cap tightens before the scene widens');
  assert.deepEqual(narrow.labels.map(label => label.id), wide.labels.map(label => label.id));
  assert.ok(narrow.width > 320, 'too-narrow frames widen the scene for the host to scroll');
});

// Nine causes on one side are drawn, not rejected: bone spacing, not a count, decides readability.
test('many causes on one side render without a count limit', () => {
  const body = Array.from({ length: 9 }, (_, index) => `    Cat${index + 1}\n      a${index + 1}\n        b${index + 1}`).join('\n');
  const parsed = parse(`Problem\n${body}`);
  assert.deepEqual(plain(parsed.errors), []);
  const { geometry, issues } = draw(parsed.model, 1200);
  assert.deepEqual(issues, []);
  assert.equal(geometry.labels.length, 18, 'two causes under each of the nine categories');
  const tones = geometry.chips.map(chip => chip.tone);
  assert.deepEqual(tones, [0, 1, 2, 3, 4, 5, 0, 1, 2], 'chip tones cycle through the six frame roles');
});

// Only the runtime work cap is a hard limit; its diagnostic names the first dropped line.
test('the node cap is the only hard limit and reports its line', () => {
  const parsed = parse(`Problem\n${Array.from({ length: 2001 }, () => '    cause').join('\n')}`);
  assert.equal(parsed.errors.length, 1);
  // "Problem" is line 2, so the 2000th cause is line 2002 and that is where the cap stops.
  assert.equal(parsed.errors[0].line, 2002);
  assert.match(parsed.errors[0].message, /at most 2000 causes/);
  assert.equal(parsed.model.count, 2000, 'causes before the cap are kept');
});

// A long problem line widens the head and warns above four lines, as the spec's limit requires.
test('a long problem label wraps and warns above four lines', () => {
  const short = parse('Blurry Photo');
  assert.equal(draw(short.model, 800).geometry.head.lines.length, 1);
  const long = parse('A problem statement that is long enough to need five full lines of the measured frame width when it is wrapped');
  const narrow = draw(long.model, 320);
  assert.ok(narrow.geometry.head.lines.length > 4);
  assert.deepEqual(narrow.issues, [], 'a tall head still fits the scene');
  assert.deepEqual(narrow.geometry.errors.map(item => [item.code, item.severity]), [['DIAGRAM_HINT', 'warning']]);
  // The head keeps the shared 220px text width, so the warning follows the label, not the frame width.
  assert.equal(draw(long.model, 1200).geometry.errors.length, 1);
});

// Every drawn part is marked for the geometry gate, and text never drops below 12px.
test('scene metadata and typography follow the shared contract', () => {
  const parsed = parse(corpusBody);
  const { scene } = draw(parsed.model, 800);
  const meta = [];
  const sizes = [];
  const walk = (node) => {
    if (node.meta?.kind) meta.push(node.meta);
    if (node.tag === 'text') sizes.push(Number(node.attrs['font-size']));
    for (const child of node.children || []) walk(child);
  };
  for (const child of scene.children) walk(child);
  assert.equal(meta.filter(item => item.kind === 'node').length, 5, 'four category chips and the head');
  assert.equal(meta.filter(item => item.kind === 'edge').length, 19, 'eighteen cause bones and the spine');
  for (const item of meta.filter(entry => entry.kind === 'edge')) assert.ok(item.from && item.to, 'bones carry node ids');
  assert.ok(sizes.length > 0 && Math.min(...sizes) >= 12, `smallest text ${Math.min(...sizes)}px`);
  const svg = renderScene(scene, { frame: false });
  assert.match(svg, /Blurry Photo/);
  assert.match(svg, /data-kc-kind="node"/);
  assert.doesNotMatch(svg, /NaN|Infinity|<script|foreignObject/);
  assert.doesNotMatch(svg, /handDrawn|stroke-dasharray/, 'KChart keeps its own calm look, not Mermaid effects');
});

// Same source, width and theme must serialise to the same bytes (no clocks, no randomness, no locale).
test('layout and serialisation are deterministic', () => {
  const first = draw(parse(corpusBody).model, 800);
  const second = draw(parse(corpusBody).model, 800);
  assert.equal(renderScene(first.scene, { frame: false }), renderScene(second.scene, { frame: false }));
  assert.deepEqual(plain(first.geometry), plain(second.geometry));
});
