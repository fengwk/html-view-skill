import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { diagram as asyncDiagram } from '../dist/esm/index.js';
import { render as mermaidRender } from '../dist/esm/mermaid.js';
import { diagram, diagramTypes } from '../dist/esm/node.js';
import { createContext } from '../src/core/context.js';
import { cropInk, el } from '../src/core/scene.js';
import { fallbackMeasure } from '../src/core/text.js';
import { diagramExample } from './helpers/diagram-examples.mjs';
import { checkScene } from './helpers/geometry.mjs';

const options = { compact: true, frame: false };
const crop = (...children) => cropInk({ width: 500, height: 500, anchor: { x: 0, y: 0 }, children }, fallbackMeasure);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≈ ${expected}`);
const sceneBox = ({ width, height, anchor }) => [width, height, anchor.x, anchor.y];

test('ink crop follows path segments, reflected controls and swept arc extrema', () => {
  // Relative moves, implied lines and close/restart must not include the original scene origin.
  const linear = el('path', { d: 'm10 20 7 5 H30 v15 l-5 5 z m5 5 h-10 V50' });
  assert.deepEqual(sceneBox(crop(linear)), [27, 32, -4, -19]);
  // Missing smooth controls would undercount the right and lower edges of these curves.
  const curves = el('path', { d: 'M10 10 c0 0 -20-5 20 10 s10 5 15 10 Q60 10 50 25 t-10 0' });
  assert.deepEqual(sceneBox(crop(curves)), [82, 37, 11, -4]);
  // Compact arc flags and relative endpoints; the vertical axis only reaches the swept half.
  const arc = el('path', { d: 'M10 20 a10 5 0 0120 0' });
  sceneBox(crop(arc)).forEach((n, i) => close(n, [22, 7, -9, -14][i]));
});

test('ink crop includes transformed stroke and ignores hidden subtrees', () => {
  // Rotate around a pivot and apply inherited stroke at 2× scale; the anchor follows the crop.
  const drawn = el('g', { transform: 'rotate(90 10 20) scale(2)', stroke: '#000', 'stroke-width': 2 }, [
    el('rect', { x: 5, y: 10, width: 6, height: 3 }),
    el('line', { x1: 5, y1: 10, x2: 5, y2: 13 }),
  ]);
  const invisible = el('circle', { cx: 300, cy: 300, r: 100 });
  const scene = crop(drawn, el('g', { opacity: 0 }, [invisible]), el('defs', {}, [invisible]));
  sceneBox(scene).forEach((n, i) => close(n, [12, 18, -1, -17][i]));
});

test('compact layout and ink crop measure the same font that drawing uses', () => {
  // A box exactly as wide as the mapped heading exposes measuring at 16px or remapping 14px to 13px.
  const ctx = createContext({ ...options, measure: (value, size, weight) => value.length * size + weight / 100 });
  const width = ctx.measure('Title', 16, 650);
  const text = ctx.textLines(50, 80, ['Title'], { size: 16, weight: 650 });
  assert.equal(width, 76);
  assert.equal(text.children[0].attrs['font-size'], 14);
  assert.equal(text.children[0].attrs['font-weight'], 600);
  assert.equal(ctx.measure('Title', 14, 650), 71.5);
  assert.equal(ctx.text(0, 0, 'Title', { size: 14, weight: 650 }).attrs['font-weight'], 650);
  assert.deepEqual(ctx.wrap('Title', width, 16, 650), ['Title']);
  assert.deepEqual(ctx.flow(['a', 'b'], 100, 16, 650), [['a', 'b']]);
  const measured = [];
  const scene = cropInk(ctx.scene(120, [ctx.rect(50, 60, width, 30), text]), (value, size, weight) => {
    measured.push([size, weight]);
    return ctx.measureRendered(value, size, weight);
  });
  assert.deepEqual(measured, [[14, 600]]);
  assert.equal(scene.width, width + 2);
  // Fullwidth punctuation in an end-anchored mixed CJK label must not be measured as Latin.
  const fallback = createContext(options);
  assert.equal(fallback.measure('：', 13, 400), fallback.measure('字', 13, 400));
});

test('compact APIs share the width cap and keep explicit opt-out unchanged', async () => {
  // Exercise a fitting graph, a spreading sequence and a numeric family through the public APIs.
  const samples = ['flowchart LR\nA --> B', 'sequenceDiagram\nA->>B: Hello', 'pie title Mix\n"A": 30\n"B": 70'];
  for (const source of samples) {
    const capped = diagram(source, { ...options, width: 720 });
    assert.ok(capped.svg);
    for (const width of [1200, 1800]) assert.deepEqual(diagram(source, { ...options, width }), capped);
    const regular = diagram(source, { width: 1800, frame: false });
    assert.equal(regular.scene.width, 1800);
    assert.equal(diagram(source, { width: 1800, frame: false, compact: false }).svg, regular.svg);
  }
  const expected = diagram(samples[0], { ...options, width: 1800, prefix: 'compact' });
  assert.deepEqual(await asyncDiagram(samples[0], { ...options, width: 1800, prefix: 'compact' }), expected);
  const facade = await mermaidRender('compact', samples[0], { ...options, width: 1800 });
  assert.equal(facade.svg, expected.svg);
  assert.deepEqual(facade.diagnostics, expected.diagnostics);

  // Width remains a host constraint, not a hard clipping viewport for intrinsically wide content.
  const wide = diagram(`sequenceDiagram\n${Array.from({ length: 12 }, (_, i) => `participant P${i}`).join('\n')}\nP0->>P11: Hello`, { ...options, width: 360 });
  assert.ok(wide.scene.width > 360);
  assert.ok(wide.diagnostics.some(d => d.code === 'LARGE_DIAGRAM'));
});

test('one sample of every Mermaid kind is cropped on both axes without losing text', () => {
  // Re-cropping a correctly positioned scene must not move either edge; the geometry gate checks text independently.
  const { measureRendered } = createContext(options);
  for (const { kind, aliases } of diagramTypes.filter(type => type.syntax === 'mermaid')) {
    const [syntax, source] = diagramExample([kind, ...aliases]);
    const { scene } = diagram(source, { ...options, syntax, width: 1800 });
    assert.ok(scene, kind);
    const recropped = cropInk(scene, measureRendered);
    const offset = recropped.children[0].attrs.transform.match(/^translate\((\S+) (\S+)\)$/).slice(1).map(Number);
    offset.forEach(n => close(n, 0));
    assert.deepEqual(checkScene(scene, { measure: measureRendered }).filter(issue => ['text-outside', 'small-text'].includes(issue.kind)), [], kind);
  }
});

test('compact corpus text stays within the embedding type scale', () => {
  // Whole-corpus coverage catches families bypassing context text helpers, including configured fonts.
  const records = JSON.parse(readFileSync(new URL('./conformance/mermaid-12.3.0.json', import.meta.url), 'utf8'));
  for (const { id, source, mermaid } of records) {
    if (mermaid !== 'valid') continue;
    for (const width of [1800, 390]) {
      const { svg } = diagram(source, { ...options, width });
      assert.ok(svg, id);
      for (const [, size] of svg.matchAll(/font-size="([^"]+)"/g)) assert.ok(+size >= 12 && +size <= 14, `${id}: ${size}px`);
    }
  }
});
