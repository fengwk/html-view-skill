import { test } from 'vitest';
import assert from 'node:assert/strict';
import { diagram } from '../dist/esm/node.js';
import { checkScene } from './helpers/geometry.mjs';

// Intent: reverse containment begins at the requirement; styled elements and other arrows remain visually distinct.
test('requirement scene keeps relation direction, marks, labels and element tone', () => {
  const result = diagram(`requirement\ndirection LR\nrequirement r {\nid: 1.2.3\nrisk: HIGH\n}\nelement e {\ntype: "test suite"\ndocRef: github.com/all_the_tests\n}\ne <- contains - r\ne - verifies -> r`, { width: 360 });
  assert.ok(result.svg, JSON.stringify(result.diagnostics));
  const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children || [])]);
  const items = flatten(result.scene.children);
  const contains = items.find(item => item.meta?.kind === 'edge' && item.meta.from === 'r');
  assert.equal(contains.meta.to, 'e');
  assert.match(contains.attrs['marker-start'], /contains/);
  const marker = items.find(item => item.tag === 'marker' && item.attrs.id.includes('contains'));
  assert.deepEqual(marker.children.map(item => item.tag), ['circle', 'path'], 'containment uses a circle with a cross');
  const verifies = items.find(item => item.meta?.kind === 'edge' && item.meta.from === 'e');
  assert.ok(verifies.attrs['stroke-dasharray']);
  assert.match(verifies.attrs['marker-end'], /arrow/);
  const [r, e] = ['r', 'e'].map(id => items.find(item => item.meta?.kind === 'node' && item.meta.id === id));
  assert.notEqual(r.attrs.stroke, e.attrs.stroke);
  assert.ok(items.some(item => item.text === '<<contains>>'));
  assert.ok(items.some(item => item.text === '<<verifies>>'));
  assert.deepEqual(checkScene(result.scene), []);
});
