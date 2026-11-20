import assert from 'node:assert/strict';
import { test } from 'vitest';
import { diagram } from '../dist/esm/node.js';
import { checkScene } from './helpers/geometry.mjs';

const render = (source, options) => {
  const result = diagram(source, { frame: false, ...options });
  assert.ok(result.svg, JSON.stringify(result.diagnostics));
  return result;
};

// Test public SVGs, not just the registry width cap: content grows without filling a wider host.
test.each([
  ['pie', 'A: 2\nB: 3', 'C: 4\nD: 5\nE: 6', 500],
  ['xychart', 'x-axis [A,B]\nbar [1,2]', 'x-axis [A,B,C,D,E,F,G]\nbar [1,2,3,4,5,6,7]', 500, true],
  ['quadrantChart', 'A: [0.2, 0.3]', 'B: [0.5, 0.75]\nC: [0.7, 0.5]\nD: [0.9, 0.1]', 500],
  ['radar-beta', 'axis A,B,C\ncurve R{1,2,3}', 'axis A,B,C,D,E,F,G,H,I\ncurve R{1,2,3,4,5,6,7,8,9}', 530, true],
  ['sankey-beta', 'A,B,1', 'B,C,1\nC,D,1\nD,E,1\nE,F,1\nF,G,1\nG,H,1', 400],
  ['treemap-beta', 'Root\n  A: 3', '  B: 4\n  C: 2', 350],
  ['venn-beta', 'set A["A"]\nset B["B"]', 'set C["C"]\nunion A,B["Shared"]', 380],
  ['gantt', 'dateFormat YYYY-MM-DD\nA :a, 2025-01-01, 5d', 'B :b, after a, 180d', 510],
  ['wardley-beta', 'component A [0.25, 0.25]', 'component B [0.75, 0.75]\nB -> A', 650],
  ['cynefin-beta', 'clear\n"A"', '"B"\n"C"\ncomplicated\n"D"\n"E"\ncomplex\n"F"', 620],
])('%s has an intrinsic compact size', (header, small, more, maxWidth, replace) => {
  const at = (body, width) => render(`${header}\n${body}`, { width, compact: true });
  const a = at(small, 720), body = replace ? more : `${small}\n${more}`, b = at(body, 720);
  for (const width of [1200, 1800]) {
    assert.equal(at(small, width).svg, a.svg);
    assert.equal(at(body, width).svg, b.svg);
  }
  assert.ok(a.scene.width <= maxWidth, `small scene width ${a.scene.width}`);
  assert.ok(b.scene.width > a.scene.width || b.scene.height > a.scene.height, 'larger fixture must grow');
});

const walk = node => [node, ...(node.children || []).flatMap(walk)];

// The longer upper endpoint previously drew several upright glyphs above the default viewport.
test.each([false, true])('quadrant CJK y-axis fits upright (compact=%s)', compact => {
  const source = 'quadrantChart\ny-axis 风险较低 --> 通用评估风险水平\nLatin: [0.25, 0.25]';
  const { scene, svg } = render(source, { width: 720, compact });
  assert.doesNotMatch(svg, /rotate\(-90/);
  assert.deepEqual(checkScene(scene, { source }), []);
  for (const glyph of ['通', '用', '平']) assert.ok(walk(scene).some(node => node.text === glyph));
});

// The original rotation remains for Latin endpoints.
test('quadrant rotates Latin y-axis labels', () => {
  assert.match(render('quadrantChart\ny-axis Low --> High', { width: 720 }).svg, /rotate\(-90/);
});
