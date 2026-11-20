import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { diagram } from '../dist/esm/node.js';
import { checkScene } from './helpers/geometry.mjs';

const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children || [])]);

// Intent: node, namespace and edge icons are resolved to geometry, not shown as icon syntax or placeholders.
test('class scene reserves icon slots in cards, frames and edge labels', () => {
  const result = diagram(`classDiagram\nnamespace Books["fa:fa-book Shelf"] {\nclass A["fa:fa-book Book"]\nclass B\nA --> B : fa:fa-book reads\n}`, { width: 360 });
  assert.ok(result.svg, JSON.stringify(result.diagnostics));
  assert.ok(!result.svg.includes('fa:fa-book') && !result.svg.includes('\ufffc'));
  const icons = flatten(result.scene.children).filter(item => item.tag === 'g' && /scale\(/.test(item.attrs?.transform || ''));
  assert.equal(icons.length, 3);
  assert.deepEqual(checkScene(result.scene), []);
});

// Intent: wrapped members survive intact and fit next to short cards without shrinking or clipping.
test('class cards reserve different heights and preserve a long member', () => {
  const member = '+publish(veryLongFirstParameter List<Notification>,veryLongSecondParameter List<Destination>) : Result';
  const result = diagram(`classDiagram-v2\nclass A {\n${member.replace(' : ', ' ')}\n}\nclass A\nB --> A`, { width: 360 });
  assert.ok(result.svg, JSON.stringify(result.diagnostics));
  const items = flatten(result.scene.children);
  const compact = value => value.replace(/\s/gu, '');
  const rows = items.filter(item => item.tag === 'text' && item.text.length > 1 && compact(member).includes(compact(item.text)));
  assert.ok(rows.length > 1);
  assert.ok(rows.slice(0, -1).every((row, i) => row.text.endsWith(',') || rows[i + 1].text.startsWith(':')));
  assert.equal(compact(rows.map(row => row.text).join('')), compact(member));
  const boxes = items.filter(item => item.meta?.kind === 'node');
  assert.equal(boxes.length, 2, 'repeated class declarations refer to the same card');
  assert.ok(boxes.find(node => node.meta.id === 'A').attrs.height > boxes.find(node => node.meta.id === 'B').attrs.height);
  assert.deepEqual(checkScene(result.scene), []);
});

const corpus = JSON.parse(readFileSync(new URL('./conformance/mermaid-12.3.0.json', import.meta.url), 'utf8'));
const example = id => corpus.find(record => record.id === `classDiagram.md:${id}`).source;

// Intent: audited generic signatures and qualified namespace names stay intact at both widths.
test.each([360, 800])('class headings and signatures use their natural width at %i px', width => {
  const tokens = id => flatten(diagram(example(id), { width }).scene.children).map(node => node.text);
  assert.ok(tokens(226).includes('setPoints(List<int> points)'));
  assert.ok(tokens(226).includes('+getMessages() : List<string>'));
  for (const namespace of ['Backend', 'Frontend']) assert.ok(tokens(475).includes(`Company.Engineering.${namespace}`));
});

// Intent: long vertical routes inside nested namespaces keep visible clearance from their side walls.
test('namespace borders do not double a parallel connector', () => {
  const nodes = flatten(diagram(example(421), { width: 800 }).scene.children);
  const { x, y, width, height } = nodes.find(node => node.meta?.id === 'Company.Engineering.Backend').attrs;
  const path = nodes.find(node => node.meta?.from === 'TechLead' && node.meta?.to === 'Developer' && node.tag === 'path');
  const [start, ...segments] = path.attrs.d.slice(1).split(/\s*C/).map(s => s.trim().split(/\s+/).map(Number));
  let [x0, y0] = start;
  let tested = 0;
  for (const [x1, , x2, , x3, y3] of segments) {
    if ([x1, x2, x3].every(p => p === x0) && Math.min(Math.max(y0, y3), y + height) - Math.max(Math.min(y0, y3), y) >= 16) {
      assert.ok(Math.min(Math.abs(x0 - x), Math.abs(x0 - x - width)) >= 8 - 1e-6);
      tested += 1;
    }
    [x0, y0] = [x3, y3];
  }
  assert.ok(tested > 0, 'the example has a vertical route running alongside this frame');
});

// Intent: class status roles come from the fill or stroke rather than copying raw Mermaid paint or CSS widths.
test('presentation maps fill first and falls back to stroke', () => {
  const source = 'classDiagram\nclass A:::painted\nclass B\nclassDef painted fill:#00f,stroke:#f00,stroke-width:5px\nstyle B fill:#aaa,stroke:#f00';
  const { scene, diagnostics } = diagram(source, { width: 360 });
  const [a, b] = flatten(scene.children).filter(node => node.meta?.kind === 'node');
  assert.notEqual(a.meta.status, b.meta.status);
  assert.equal(b.meta.status, 'danger');
  assert.equal(a.attrs['stroke-width'], 1.25);
  assert.equal(diagnostics.filter(d => d.code === 'IGNORED_STYLE').length, 1);
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
