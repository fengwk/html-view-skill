import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { galleryCases } from '../../../docs/showcase/gallery-cases.mjs';
import { diagram } from '../dist/esm/node.js';
import { fallbackMeasure } from '../src/core/text.js';
import { checkScene } from './helpers/geometry.mjs';

const gallery = galleryCases('en').diagrams;
const families = [
  'sequenceDiagram', 'timeline', 'journey', 'gitGraph', 'kanban', 'packet', 'swimlane-beta', 'swimlane',
  'C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment', 'eventmodeling', 'treeView-beta',
  'requirementDiagram', 'usecase-beta', 'ishikawa', 'mindmap', 'architecture-beta', 'block', 'blocks',
  'classDiagram', 'erDiagram', 'stateDiagram-v2', 'flowchart', 'agentflow-beta', 'railroad-beta',
  'railroad-ebnf-beta', 'railroad-abnf-beta', 'railroad-peg-beta', 'layers',
];
const all = shape => [shape, ...(shape.children || []).flatMap(all)];
const render = (source, options = {}) => {
  const result = diagram(source, { width: 800, frame: false, ...options });
  assert.ok(result.svg, JSON.stringify(result.diagnostics));
  return result;
};

// Wider embedding columns must not change a family's SVG (including nested chart layouts).
test.each(families)('%s is width-invariant in a wide compact host', kind => {
  const [syntax, source] = gallery[kind];
  const at = width => render(source, { syntax, width, compact: true }).svg;
  assert.equal(at(1200), at(720));
  assert.equal(at(1800), at(720));
});

// The registry already caps wide hosts; use small samples below the cap to catch actual spreading.
test.each([
  ['sequenceDiagram\nA->>B: Hello', 230],
  ['timeline\nsection Release\n2026 : Launch', 240],
  ['journey\nsection Release\nLaunch: 3: User', 320],
  ['packet\n0-31: "Payload"', 400],
  ['swimlane LR\nlane Store\n  a[Open]', 330, 'swimlane'],
  ['blocks\nbox Store\n  Open', 260, 'blocks'],
  ['layers\n- Store: Open', 260, 'layers'],
])('compact ink does not fill 720px: %j', (source, maxWidth, syntax) => {
  assert.ok(render(source, { syntax, width: 720, compact: true }).scene.width <= maxWidth);
});

// Include range endpoints and a neighboring halfwidth character so the new measure is not overbroad.
test('fallback measures fullwidth forms at one em', () => {
  for (const char of ['\uff01', '\uff60', '\uffe0', '\uffe6']) assert.equal(fallbackMeasure(char, 14), 14);
  assert.equal(fallbackMeasure('\uff61', 14), fallbackMeasure('a', 14));
});

// Check both adjacent separators against the text box, including the divider's stroke.
test.each([false, true])('class members clear dividers (compact=%s)', compact => {
  const nodes = all(render('classDiagram\nclass Model {\n+int context_length\n+train()\n}', { compact }).scene);
  const row = nodes.find(n => n.text === '+int context_length');
  const dividers = nodes.filter(n => n.tag === 'line');
  assert.equal(dividers.length, 2);
  for (const { attrs } of dividers) assert.ok(Math.abs(attrs.y1 - row.attrs.y) - 6 - attrs['stroke-width'] / 2 >= 4);
});

// This label can wrap at the blank without breaking a Chinese word.
test.each([false, true])('git labels prefer the explicit break (compact=%s)', compact => {
  const nodes = all(render('gitGraph\ncommit id: "test: 小规模端到端验证"', { compact }).scene);
  assert.ok(nodes.some(n => n.text === 'test:'));
  assert.ok(nodes.some(n => n.text === '小规模端到端验证'));
});

// Move branches for a 3–1 → 2–2 improvement, but preserve source-order sides for a 6–4 tie.
test.each([false, true])('mindmap changes sides only for strictly better balance (compact=%s)', compact => {
  const improved = 'mindmap\n Root\n  First\n  Second\n  Largest\n   A\n   B';
  const tied = 'mindmap\n Root\n  Largest\n   A\n   B\n   C\n   D\n  First\n   E\n   F\n  Second\n   G\n   H\n  Last\n   I\n   J';
  const left = source => {
    const nodes = all(render(source, { compact }).scene);
    const root = nodes.find(n => n.text === 'Root');
    return ['Largest', 'First', 'Second', 'Last'].filter(text => nodes.some(n => n.text === text && n.attrs.x < root.attrs.x));
  };
  assert.deepEqual(left(improved), ['Largest']);
  assert.deepEqual(left(tied), ['Largest', 'Last']);
});

const c4Corpus = JSON.parse(readFileSync(new URL('./conformance/mermaid-12.3.0.json', import.meta.url))).filter(r => r.type === 'c4');

// Treat dotted leaders as the only edges and the other labels as obstacles for the geometry gate.
function leaderGeometry(node) {
  const { meta } = node, id = `${meta?.from}→${meta?.to}`;
  if (meta?.kind === 'edge') return [];
  if (meta?.kind === 'leader') return [{ ...node, meta: { kind: 'edge', id, to: `plate:${id}` } }];
  if (meta?.kind === 'edge-label-group') return [{ ...node, meta: { kind: 'node', id: `plate:${id}` } }];
  return [{ ...node, ...(node.children ? { children: node.children.flatMap(leaderGeometry) } : {}) }];
}

test.each([false, true])('C4 leaders avoid corpus cards, headers and labels (compact=%s)', compact => {
  for (const { id, source } of c4Corpus) for (const width of [390, 800]) {
    const { scene } = render(source, { compact, width });
    const geometry = { ...scene, children: scene.children.flatMap(leaderGeometry) };
    const crossings = checkScene(geometry).filter(i => ['edge-crosses-node', 'edge-crosses-text'].includes(i.kind));
    assert.deepEqual(crossings, [], `${id} at ${width}`);
  }
});

// The JDBC label fits between the database and the boundary, but only between the coarse samples.
test('compact C4Dynamic places the JDBC plate by its edge, not below the diagram', () => {
  const { source } = c4Corpus.find(r => r.id === 'c4.md:312');
  const nodes = all(render(source, { compact: true }).scene);
  const plate = nodes.find(n => n.meta?.kind === 'edge-label-group' && n.meta.from === 'c3' && n.meta.to === 'c4').children[0].attrs;
  const frame = nodes.find(n => n.meta?.kind === 'frame').attrs;
  assert.ok(plate.y + plate.height < frame.y + frame.height);
});

// This dense corpus graph used to accept a plate spanning a boundary if the route score was better.
test.each([false, true])('C4 plates clear boundary borders (compact=%s)', compact => {
  const { source } = c4Corpus.find(r => r.id === 'c4.md:228');
  const nodes = all(render(source, { compact }).scene);
  const frames = nodes.filter(n => n.meta?.kind === 'frame').map(n => n.attrs);
  const plates = nodes.filter(n => n.meta?.kind === 'edge-label-group').map(n => n.children[0].attrs);
  assert.ok(frames.length && plates.length);
  for (const f of frames) for (const p of plates) {
    const outside = p.x >= f.x + f.width + 1 || p.x + p.width <= f.x - 1
      || p.y >= f.y + f.height + 1 || p.y + p.height <= f.y - 1;
    const inside = p.x >= f.x + 1 && p.x + p.width <= f.x + f.width - 1
      && p.y >= f.y + 1 && p.y + p.height <= f.y + f.height - 1;
    assert.ok(outside || inside, JSON.stringify({ f, p }));
  }
});
