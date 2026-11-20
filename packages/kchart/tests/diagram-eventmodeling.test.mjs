import { test } from 'vitest';
import corpus from './conformance/mermaid-12.3.0.json';
import assert from 'node:assert/strict';
import { fallbackMeasure } from '../src/core/text.js';
import { createDiagramApi } from '../src/diagram/registry.js';
import { implementations } from '../src/diagram/eventmodeling.js';
import { checkScene } from './helpers/geometry.mjs';

const api = createDiagramApi(implementations, [{ kind: 'eventmodeling', syntax: 'mermaid', topic: 'flow', aliases: [] }]);
const source = (body) => `eventmodeling\n${body}`;
const parse = (body) => api.parse(source(body), { lang: 'en' });
const draw = (body, width = 800) => api.diagram(source(body), { lang: 'en', width });
const elements = (node) => (node.children || []).flatMap(child => [child, ...elements(child)]);
const edges = (scene) => elements(scene).filter(n => n.meta?.kind === 'edge').map(n => [n.meta.from, n.meta.to]);

// Check each reference's visible lanes, cards, payload fields and directed links at both review widths.
test('matches the audited Event Modeling corpus semantics', () => {
  const standard = ['UI/Automation', 'Command/Read Model', 'Events'];
  const streams = ['Stream: External', 'Stream: Cart'];
  const basic = ['CartUI', 'AddItem', 'ItemAdded'];
  const normalEdges = ['01>02', '02>03'];
  const shape = ['description: string', 'image: string', 'price: number'];
  const reference = [...basic, 'AddItem', 'ItemAdded'];
  const payloads = [[], ["description: 'john'", "image: 'avatar_john'", 'price: 20.4'], shape,
    ["description: 'jack'", "image: 'avatar_jack'", 'price: 12.5'], shape];
  const inventory = ['InventoryChanged', 'InventoryProcessor', 'ChangeInventory', 'InventoryChanged'];
  const expectations = {
    52: [standard, basic, normalEdges], 232: [standard, basic, normalEdges],
    82: [standard, basic, normalEdges, [[], [shape[0]], [shape[0]]]],
    92: [standard, basic, normalEdges, [[], [shape[0]], [shape[0]]]],
    108: [standard, reference, [...normalEdges, '03>04', '04>05'], payloads],
    138: [standard, reference, [...normalEdges, '03>04', '04>05'], payloads],
    174: [[...standard, ...streams], [...basic, ...inventory], [...normalEdges, '04>05', '05>06', '06>07']],
    189: [[...standard, ...streams], [...basic, ...inventory], [...normalEdges, '04>05', '05>06', '06>07']],
    204: [standard, ['ItemAdded', 'OtherUI', 'CartItems'], ['01>02', '01>03']],
    216: [standard.slice(1), ['CartCreated', 'ItemAdded', 'ItemRemoved', 'CartCleared', 'CartUI'], ['02>01', '03>01', '04>01', '05>01']],
    242: [standard, ['ItemAdded', 'CartItems', 'CartUI'], ['03>02', '02>04']],
    252: [[...standard.slice(0, 2), ...streams], inventory, ['03>02', '02>04', '04>05']],
    305: [['Stream: Inventory', 'Stream: External'], ['InventoryChanged', 'InventoryChanged'], []],
  };
  const records = corpus.filter(({ id }) => id.startsWith('eventmodeling.md:'));
  assert.equal(records.length, Object.keys(expectations).length);
  for (const record of records) for (const width of [800, 360]) {
    const tag = `${record.id} @ ${width}`;
    const [lanes, names, links, data = []] = expectations[record.line];
    const { scene } = api.diagram(record.source, { width });
    const parts = elements(scene);
    assert.deepEqual(checkScene(scene), [], tag);
    assert.deepEqual(parts.filter(node => node.tag === 'g' && node.meta?.kind === 'frame').map(node => node.children.find(child => child.tag === 'text').text), lanes, tag);
    const cards = parts.filter(node => node.tag === 'g' && node.children?.some(child => child.meta?.kind === 'node'));
    assert.deepEqual(cards.map(card => card.children.filter(child => child.tag === 'text').slice(1).map(child => child.text)),
      names.map((name, index) => [name, ...(data[index] || [])]), tag);
    assert.deepEqual(edges(scene).map(pair => pair.join('>')), links, tag);
  }
});

// Compact and relaxed keywords, including reset and each entity type, normalize to the same frames.
test('normalizes Event Modeling keywords', () => {
  const a = parse('tf 01 ui A\ntf 02 pcr B\ntf 03 cmd C\ntf 04 evt D\nrf 05 rmo E');
  const b = parse('timeframe 01 ui A\ntimeframe 02 processor B\ntimeframe 03 command C\ntimeframe 04 event D\nresetframe 05 readmodel E');
  assert.deepEqual(a.diagnostics, []);
  assert.deepEqual(b.diagnostics, []);
  assert.deepEqual(a.model, b.model);
  assert.deepEqual(a.model.frames.map(f => f.type), ['ui', 'processor', 'command', 'event', 'readmodel']);
});

// Namespaced lanes sort within their bands; a three-part identifier remains in the base band.
test('keeps Event Modeling namespaces in the correct bands', () => {
  const body = 'rf 01 evt External.Changed\nrf 02 evt Cart.Changed\nrf 03 rmo Cart.Items\nrf 04 ui A.B.C';
  const { model } = parse(body);
  assert.equal(model.frames.at(-1).namespace, null);
  assert.equal(model.frames.at(-1).name, 'A.B.C');
  const { scene, svg } = draw(body);
  assert.equal(scene.children.filter(node => node.meta?.kind === 'frame').length, 4);
  const labels = ['UI/Automation', 'C/RM: Cart', 'Stream: External', 'Stream: Cart'];
  const positions = labels.map(label => svg.indexOf(label));
  assert.ok(positions.every((position, index) => position > (positions[index - 1] ?? -1)));
});

// Implicit input uses the nearest earlier frame in a different lane, and reset frames have none.
test('infers Event Modeling input by source order and lane', () => {
  const { scene } = draw('tf 03 evt Added\ntf 02 rmo Items\ntf 04 rmo Count\nrf 05 ui Screen\ntf 06 cmd Send');
  assert.deepEqual(edges(scene), [['03', '02'], ['03', '04'], ['05', '06']]);
});

// Explicit inputs override inference even on reset frames, and all four edges route without crossing boxes.
test('routes explicit Event Modeling sources', () => {
  const body = 'tf 01 evt Added\ntf 02 ui Other\nrf 03 rmo Items ->> 01';
  assert.deepEqual(edges(draw(body).scene), [['01', '02'], ['01', '03']]);
  const many = 'rf 02 evt Created\nrf 03 evt Added\nrf 04 evt Removed\nrf 05 evt Cleared\ntf 01 rmo Cart ->> 02 ->> 03 ->> 04 ->> 05';
  for (const width of [800, 360]) {
    const { scene, svg } = draw(many, width);
    assert.deepEqual(edges(scene), ['02', '03', '04', '05'].map(id => [id, '01']));
    assert.deepEqual(checkScene(scene), []);
    assert.equal(svg, draw(many, width).svg);
  }
});

// A duplicate id points at the second declaration rather than conflating two nodes.
test('rejects duplicate Event Modeling ids', () => {
  const { diagnostics, svg } = draw('tf 01 ui A\nrf 01 evt B');
  assert.equal(svg, null);
  assert.deepEqual(diagnostics.map(d => [d.code, d.line]), [['eventmodeling.duplicate-frame', 3]]);
});

// Data references resolve in both declaration orders, and inline type tags do not alter the payload.
test('resolves data blocks and preserves inline text', () => {
  const block = 'data Info {\n  price: number\n}';
  const frame = 'tf 01 evt Added [[Info]]';
  assert.equal(draw(`${block}\n${frame}`).svg, draw(`${frame}\n${block}`).svg);
  assert.match(draw(`${frame}\n${block}`).svg, /price: number/);
  const { model, diagnostics } = parse('tf 01 ui A {url: "https://example.test"} %% trailing\ntf 02 ui B `json`{"url": "https://example.test"}');
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(model.frames.map(f => f.inline), [
    { type: null, body: 'url: "https://example.test"' },
    { type: 'json', body: '"url": "https://example.test"' },
  ]);
});

// Center the measured text block on both axes, even at minimum card sizes, without centering its individual data rows.
test('centers one-line titles and title-plus-payload blocks inside Event Modeling cards', () => {
  const { scene } = draw('tf 01 ui Screen\ntf 02 cmd Send\ntf 03 evt Saved [[Info]]\ndata Info {\n  first: string\n  last: number\n}');
  const card = id => {
    const group = elements(scene).find(node => node.children?.some(child => child.meta?.kind === 'node' && child.meta.id === id));
    const box = group.children.find(child => child.tag === 'rect').attrs;
    const rows = group.children.filter(child => child.tag === 'text');
    const left = Math.min(...rows.map(({ attrs }) => attrs.x)) - box.x;
    const right = box.x + box.width - Math.max(...rows.map(({ text, attrs }) =>
      attrs.x + fallbackMeasure(text, attrs['font-size'], attrs['font-weight'])));
    assert.ok(left >= 10 && Math.abs(right - left) < 1e-6, `${id}: ${left}px left, ${right}px right`);
    return { ...box, rows };
  };
  for (const id of ['01', '02']) {
    const { y, height, rows } = card(id);
    assert.deepEqual(rows.map(({ attrs }) => attrs.y), Array(2).fill(y + height / 2));
  }
  const { y, height, rows } = card('03');
  assert.equal(rows.length, 4);
  const [glyph, name, first, last] = rows.map(({ attrs }) => attrs);
  assert.equal(first.x, glyph.x);
  assert.equal(last.x, glyph.x);
  const top = name.y - 18 / 2 - y;
  const bottom = y + height - (last.y + 16 / 2);
  assert.ok(top >= 10);
  assert.equal(top, bottom);
});

// A source-type mismatch is reported without suppressing the explicit edge.
test('warns about Event Modeling source types without blocking', () => {
  const { scene, diagnostics } = draw('tf 01 ui A\ntf 02 rmo B ->> 01');
  assert.deepEqual(edges(scene), [['01', '02']]);
  assert.deepEqual(diagnostics.map(d => [d.code, d.severity]), [['DIAGRAM_HINT', 'warning']]);
});

// The shared size policy keeps the 61st frame instead of enforcing the proposed presentation cap.
test('renders large Event Modeling diagrams with a scroll hint', () => {
  const body = Array.from({ length: 61 }, (_, i) => `tf ${i} ui Frame${i}`).join('\n');
  const { scene, diagnostics } = draw(body);
  assert.ok(scene.width > 800);
  assert.deepEqual(diagnostics.map(d => [d.code, d.severity]), [['LARGE_DIAGRAM', 'warning']]);
  assert.match(draw(body).svg, />Frame60</);
});

// At narrow widths lane labels remain visible and clipped data is counted, with the full source in the tooltip.
test('keeps narrow Event Modeling data discoverable', () => {
  const body = 'tf 01 evt Added [[Info]]\ndata Info {\n  one\n  two\n  three\n  four\n  five\n  six\n}';
  const { svg, scene } = draw(body, 360);
  assert.match(svg, />\+2</);
  assert.match(svg, /six<\/title>/);
  assert.deepEqual(checkScene(scene), []);
});

// Semantic annotations that Mermaid leaves out appear below the lanes, including multiline GWT.
test('renders Event Modeling notes, entities and GWT captions', () => {
  const { svg, scene } = draw('tf 01 ui Screen\nentity Screen\nnote 01 {\n  Business rule\n}\ngwt 01\n given ui Screen\n then ui Screen');
  assert.match(svg, />Given: ui Screen</);
  assert.match(svg, />Business rule</);
  assert.match(svg, />Entities</);
  assert.deepEqual(checkScene(scene), []);
});

// Shared directives update Event Modeling padding, the title renders as a normalized label, and data stays literal.
test('honors Event Modeling padding and normalizes the title only', () => {
  const body = 'title fa:fa-envelope <b>Mail &amp; Cart</b>\ntf 01 ui Cart "&amp;"';
  const regular = draw(body, 360);
  const { svg, scene, diagnostics } = api.diagram(`%%{init: {"eventmodeling":{"padding":120,"rowHeight":99}}}%%\n${source(body)}`, { width: 360, lang: 'en' });
  assert.ok(scene.width > regular.scene.width && scene.height > regular.scene.height);
  assert.deepEqual(diagnostics.map(d => d.code), ['IGNORED_CONFIG']);
  assert.ok(elements(scene).some(node => node.attrs?.transform?.includes(' scale(')));
  assert.match(svg, />Mail &amp; Cart</);
  assert.match(svg, />&amp;amp;</);
  assert.deepEqual(checkScene(scene), []);
  assert.equal(draw('tf 01 ui Cart\nclick 01 https://example.test').svg, null);
});

// Lane names and namespace prefixes follow the diagram language; entity names stay as written.
test('generated Event Modeling lane names follow the diagram language', () => {
  const body = 'tf 01 ui Cart\ntf 02 cmd AddItem\ntf 03 evt ItemAdded\ntf 04 evt Inventory.Changed';
  const zh = api.diagram(source(body), { lang: 'zh-CN', width: 900 }).svg;
  for (const label of ['界面/自动化', '命令/读模型', '事件', '事件流：Inventory', 'AddItem']) assert.ok(zh.includes(`>${label}<`), label);
  assert.doesNotMatch(zh, />(?:UI\/Automation|Command\/Read Model|Events|Stream: Inventory)</);
  assert.match(draw(body, 900).svg, />Stream: Inventory</);
});
