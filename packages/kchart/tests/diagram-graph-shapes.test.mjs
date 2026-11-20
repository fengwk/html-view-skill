import { test } from 'vitest';
import assert from 'node:assert/strict';
import { implementations } from '../src/diagram/graph.js';
import { createContext } from '../src/core/context.js';
import { shapeNames, shapeOutline, shapeGlyphBox, outlinePort } from '../src/diagram/shapes.js';

const impl = implementations.flowchart;
const ctx = createContext({ theme: 'paper' });
const parse = (body, dir = 'TB') => impl.parse(body, { kind: 'flowchart', header: `flowchart ${dir}`, lang: 'en' });
const boundaryDistance = (outline, { x, y }) => Math.min(...outline.map(([ax, ay], i) => {
  const [bx, by] = outline[(i + 1) % outline.length];
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}));

// All Mermaid shape aliases select a drawable outline, not an unknown-shape fallback.
test('renders every public metadata shape name', () => {
  assert.equal(shapeNames.length, 146);
  for (const name of shapeNames) {
    const { model, errors } = parse(`A@{ shape: ${name}, label: "Test, } @" }`);
    assert.deepEqual(errors, [], name);
    assert.equal(model.nodes[0].label, 'Test, } @');
    const scene = impl.scene(impl.layout(model), ctx);
    const group = scene.children.find(el => el.meta?.kind === 'nodes').children[0];
    assert.equal(group.children.find(el => el?.tag === 'polygon')?.tag, 'polygon', name);
  }
});

// The same polygon closes every orthogonal approach, including off-center approaches to slanted sides.
test('ports hit the outline at eight sampled approaches per canonical shape', () => {
  for (const name of shapeNames) {
    const { model } = parse(`A@{ shape: ${name} }`);
    const outline = shapeOutline(model.nodes[0].shape, 110, 70);
    for (const side of ['top', 'right', 'bottom', 'left']) {
      for (const offset of [25, 45]) {
        assert.ok(boundaryDistance(outline, outlinePort(outline, side, offset)) < 1e-6, `${name} ${side} ${offset}`);
      }
    }
  }
});

// Asymmetric shapes stay upright and both arrow endpoints land on their visible polygon after all direction transforms.
test('routes to asymmetric outlines in all four directions', () => {
  for (const dir of ['TB', 'BT', 'LR', 'RL']) {
    const { model, errors } = parse('A@{ shape: sl-rect } --> B@{ shape: odd } --> C@{ shape: fork, label: "Split" }', dir);
    assert.deepEqual(errors, []);
    const geometry = impl.layout(model);
    for (const edge of geometry.edges) {
      for (const [id, point] of [[edge.from, edge.segments[0].p0], [edge.to, edge.segments.at(-1).p1]]) {
        const node = geometry.nodes.find(n => n.id === id);
        const outline = shapeOutline(node.shape, node.w, node.h, dir);
        assert.ok(boundaryDistance(outline, { x: point.x - node.x, y: point.y - node.y }) < .001, `${dir} ${id}`);
      }
    }
    const fork = geometry.nodes.find(n => n.id === 'C');
    const glyph = shapeGlyphBox(fork.shape, fork.w, fork.h, dir);
    assert.deepEqual([glyph.w, glyph.h], ['LR', 'RL'].includes(dir) ? [10, 70] : [70, 10]);
  }
});

// Multiline metadata and pipe text don't turn their contained punctuation into statements.
test('preserves block labels and unquoted pipe labels across statement separators', () => {
  const { model, errors } = parse('A@{ shape: doc, label: |\n  One, two\n  Line two\n}; A -->|a;b| B');
  assert.deepEqual(errors, []);
  assert.equal(model.nodes[0].label, 'One, two\nLine two');
  assert.equal(model.edges[0].label, 'a;b');
});

// Accepted bracket properties do not render as part of the label or duplicate their warning.
test('warns once for ignored bracket properties without losing node labels', () => {
  const { model, errors } = parse('A[|a:b|Shown] --> B[|a:c|Visible]');
  assert.deepEqual(errors.map(e => [e.severity, e.code]), [['warning', 'IGNORED_CONFIG']]);
  assert.deepEqual(model.nodes.map(node => node.label), ['Shown', 'Visible']);
});
