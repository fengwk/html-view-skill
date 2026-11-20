import { test } from 'vitest';
import assert from 'node:assert/strict';
import { diagram } from '../dist/esm/node.js';
import { checkScene } from './helpers/geometry.mjs';

const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children || [])]);

// Intent: wrapped members survive intact and fit next to short cards without shrinking or clipping.
test('class cards reserve different heights and preserve a long member', () => {
  const member = '+veryLongMemberNameThatMustWrapAcrossMultipleVisibleRowsWithoutLosingAnyCharacters:string';
  const result = diagram(`classDiagram-v2\nclass A {\n${member}\n}\nclass A\nB --> A`, { width: 360 });
  assert.ok(result.svg, JSON.stringify(result.diagnostics));
  const items = flatten(result.scene.children);
  const rows = items.filter(item => item.tag === 'text' && member.includes(item.text) && item.text.length > 1);
  assert.ok(rows.length > 1);
  assert.equal(rows.map(row => row.text).join(''), member);
  const boxes = items.filter(item => item.meta?.kind === 'node');
  assert.equal(boxes.length, 2, 'repeated class declarations refer to the same card');
  assert.ok(boxes.find(node => node.meta.id === 'A').attrs.height > boxes.find(node => node.meta.id === 'B').attrs.height);
  assert.deepEqual(checkScene(result.scene), []);
});

// Intent: nested frame routing, cardinalities, independent lollipop endpoints, and safe links survive SVG output.
test('BT class diagram retains frames, relation endpoints and clickable cards', () => {
  const result = diagram(`classDiagram\ndirection BT\nnamespace Outer.Inner {\nclass A~B~\nclass B\n}\nA "1..*" <|--|> "*" B : owns\nB --() socket\nA --() socket\nlink A "https://example.com" "details"`, { width: 360 });
  assert.ok(result.svg, JSON.stringify(result.diagnostics));
  const items = flatten(result.scene.children);
  assert.equal(items.filter(item => item.meta?.kind === 'frame').length, 2);
  assert.equal(items.filter(item => item.meta?.kind === 'edge' && item.attrs['marker-end']?.includes('circle')).length, 2);
  assert.ok(items.some(item => item.text === 'A<B>'));
  assert.deepEqual(items.filter(item => item.meta?.kind === 'cardinality').map(item => item.text), ['1..*', '*']);
  assert.ok(items.some(item => item.tag === 'a' && item.attrs.href === 'https://example.com'));
  assert.deepEqual(checkScene(result.scene), []);
});
