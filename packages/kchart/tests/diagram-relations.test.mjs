import { test } from 'vitest';
import assert from 'node:assert/strict';
import { implementations } from '../src/diagram/relations.js';
import { createContext } from '../src/core/context.js';
import { themes } from '../src/core/theme.js';
import { contrast } from '../src/core/color.js';
import { diagram } from '../dist/esm/node.js';

const samples = {
  classDiagram: 'classDiagram\nclass Animal {\n+name: string\n+eat()\n}\nAnimal <|-- Dog\nDog "1" *-- "*" Paw : owns',
  requirementDiagram: 'requirementDiagram\nfunctionalRequirement checkout {\nid: REQ-1\ntext: Finish checkout\n}\nAPI - satisfies -> checkout',
  'architecture-beta': 'architecture-beta\ngroup cloud(cloud)[Cloud]\nservice api(server)[API] in cloud\nservice db(database)[Database] in cloud\napi:R --> L:db',
  'block-beta': 'block-beta\ncolumns 2\nui["UI"]\napi["API"]\nui --> api : request',
  zenuml: 'zenuml\nClient\nAPI\nClient->API: request\nClient.call()',
};
const parse = (kind, body) => plain(implementations[kind].parse(body, { kind, lang: 'en', firstLine: 2, options: {} }));
const context = createContext({ width: 800, lang: 'en' });
const plain = value => JSON.parse(JSON.stringify(value));
const elements = ({ children }) => children.flatMap(node => [node, ...(node.children ? elements(node) : [])]);

// Intent: every migrated kind must retain representative syntax and reject unknown statements rather than silently producing partial success.
test('remaining relation and architecture parsers preserve model identity and report unsupported syntax', () => {
  assert.deepEqual(Object.keys(implementations), Object.keys(samples));
  for (const [kind, source] of Object.entries(samples)) {
    const { model, errors } = parse(kind, source.slice(source.indexOf('\n') + 1));
    assert.equal(errors.length, 0, `${kind}: ${JSON.stringify(errors)}`);
    assert.ok(model.nodes.length >= 2, kind);
    const bad = parse(kind, 'this syntax is not supported');
    assert.ok(bad.errors.length > 0, kind);
    assert.equal(bad.errors[0].line, 2, kind);
  }
  const optionError = implementations.classDiagram.parse('class A', { lang: 'en', firstLine: 2, options: { direction: 'LR' } });
  assert.ok(optionError.errors.some(error => error.line === 1), 'unsupported relation-family options are diagnosed on the source header');
  assert.ok(parse('classDiagram', 'class A\nclass A').errors.length, 'duplicate class declarations are rejected');
  assert.ok(parse('classDiagram', 'class A {\n+field: string').errors.length, 'unclosed declaration blocks are diagnosed');
  assert.ok(parse('requirementDiagram', 'requirement r {\nunknown: value\n}').errors.length, 'unsupported declaration fields are reported');
  const block = parse('block-beta', 'block:store\ncache[Cache]\nspace\ncache --> disk : connects\nend').model;
  assert.equal(block.nodes.find(node => node.id === 'cache').parent, 'store');
  assert.equal(block.nodes.find(node => node.id === 'disk').parent, 'store', 'implicit relation endpoint inherits active block group');
  assert.equal(block.nodes.find(node => node.type === 'space').parent, 'store', 'space placeholder remains in its active block group');
  assert.equal(block.edges.length, 1);
  const cls = parse('classDiagram', samples.classDiagram.slice(samples.classDiagram.indexOf('\n') + 1)).model;
  assert.deepEqual(cls.nodes.find(n => n.id === 'Animal').attrs, ['+name: string']);
  assert.equal(cls.edges[1].startCard, '1');
  assert.equal(cls.edges[1].endCard, '*');
  const architecture = parse('architecture-beta', samples['architecture-beta'].slice(samples['architecture-beta'].indexOf('\n') + 1)).model;
  assert.equal(architecture.edges[0].startPort, 'R');
  assert.equal(architecture.edges[0].endPort, 'L');
  const sequence = parse('zenuml', samples.zenuml.slice(samples.zenuml.indexOf('\n') + 1)).model;
  assert.deepEqual(sequence.sequence.map(event => event.kind), ['message', 'call']);
});

// Intent: architecture edge operators and endpoint ports are a closed supported subset; count checks detect silently omitted relations.
test('seven architecture edge cases retain direction and port identity', () => {
  const body = 'service a(server)[A]\nservice b(database)[B]\na:R --> L:b\na:T -- B:b\na:L <-- R:b\na:B <--> T:b\na --> b\na -- b\na <-- b';
  const parsed = parse('architecture-beta', body);
  assert.equal(parsed.errors.length, 0, JSON.stringify(parsed.errors));
  assert.equal(parsed.model.edges.length, 7, 'all seven supported connector forms must survive parsing');
  assert.deepEqual(parsed.model.edges.map(edge => edge.direction), ['right', 'none', 'left', 'both', 'right', 'none', 'left']);
  assert.deepEqual(parsed.model.edges.slice(0, 4).map(edge => [edge.startPort, edge.endPort]), [['R', 'L'], ['T', 'B'], ['L', 'R'], ['B', 'T']]);
  assert.ok(parse('architecture-beta', 'service a(unlisted-icon)[A]').errors.length, 'unrenderable declarations must be diagnosed');
  assert.ok(parse('architecture-beta', 'service a(server)[A]\na <-> a').errors.length, 'unsupported relation syntax must not be silently discarded');
});

// Intent: scene metadata and visible text preserve UML markers, cardinalities, group boundaries, ports and sequence lifelines across the layout seam.
test('relation layouts render semantically identified markers, groups, architecture ports and lifelines', () => {
  const classModel = parse('classDiagram', samples.classDiagram.slice(samples.classDiagram.indexOf('\n') + 1)).model;
  const classLayout = implementations.classDiagram.layout(classModel, { width: 800, measure: (s, f) => context.measure(s, f.size, f.weight), ctx: context });
  assert.ok(classLayout.geometry?.nodes?.length, 'layoutGeometry remains available to downstream diagnostics');
  const classScene = plain(classLayout.scene);
  const edges = classScene.children.filter(item => item.meta?.kind === 'edge');
  for (const { attrs } of edges) {
    const [move, ...curves] = attrs.d.split(/ (?=C)/);
    assert.equal(move.slice(1).split(' ').length, 2);
    assert.ok(curves.length && curves.every(part => part.slice(1).split(' ').length === 6), 'each cubic must have exactly six coordinates');
  }
  const types = edges.map(item => item.meta.type);
  assert.ok(types.includes('<|--'));
  assert.ok(types.includes('*--'));
  assert.equal(classScene.children.filter(item => item.meta?.kind === 'relation-marker').length, 2, JSON.stringify(classScene.children.map(item => item.meta).filter(Boolean)));
  assert.ok(classScene.children.some(item => item.meta?.kind === 'cardinality' && item.meta.endpoint === 'start'));
  const owner = classScene.children.find(item => item.meta?.kind === 'node' && item.meta.node === 'Dog');
  const card = classScene.children.find(item => item.meta?.kind === 'cardinality' && item.meta.endpoint === 'start');
  assert.ok(card.attrs.y - card.attrs['font-size'] / 2 > owner.attrs.y + owner.attrs.height, 'start cardinality of the downward edge must stay outside the source card');
  const edgeLabel = classScene.children.find(item => item.meta?.kind === 'edge-label' && item.meta.edge === card.meta.edge);
  // 基数与边标签底板在两轴上都不重叠；端点标记（菱形、三角）也不被底板盖住。
  const plateOf = (label) => { const w = context.measure(label.text, 12, 400) + 14; return { x0: label.attrs.x - w / 2, x1: label.attrs.x + w / 2, y0: label.attrs.y - 15, y1: label.attrs.y + 5 }; };
  const apart = (a, b) => a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0;
  const cardW = context.measure(card.text, 12, 400), cardX = card.attrs['text-anchor'] === 'end' ? card.attrs.x - cardW : card.attrs.x;
  assert.ok(apart({ x0: cardX, x1: cardX + cardW, y0: card.attrs.y - 7, y1: card.attrs.y + 7 }, plateOf(edgeLabel)), 'cardinality also leaves room for the edge caption');
  for (const mark of classScene.children.filter(item => item.meta?.kind === 'relation-marker')) {
    const label = classScene.children.find(item => item.meta?.kind === 'edge-label' && item.meta.edge === mark.meta.edge);
    if (!label) continue;
    const pts = mark.attrs.points.split(' ').map(pair => pair.split(',').map(Number));
    const box = { x0: Math.min(...pts.map(p => p[0])), x1: Math.max(...pts.map(p => p[0])), y0: Math.min(...pts.map(p => p[1])), y1: Math.max(...pts.map(p => p[1])) };
    assert.ok(apart(box, plateOf(label)), `edge ${mark.meta.edge}: the ${mark.meta.marker} marker is not covered by its label plate`);
  }
  assert.ok(classScene.children.some(item => item.meta?.kind === 'edge-label' && item.meta.edge === '1'));
  const allRelations = parse('classDiagram', 'A <|-- B\nA ..|> C\nA <|.. D\nA *-- E\nA o-- F\nA --* G\nA --o H\nA ..> I\nA --> J\nA -- K\nA .. L').model;
  const allRelationScene = plain(implementations.classDiagram.layout(allRelations, { width: 800, measure: (s, f) => context.measure(s, f.size, f.weight), ctx: context }).scene);
  assert.equal(allRelationScene.children.filter(child => child.meta?.kind === 'relation-marker').length, 9, 'all inherited, composition, aggregation and directed associations keep their distinct marker counts');
  assert.equal(allRelationScene.children.filter(child => child.meta?.kind === 'edge').length, 11, 'no UML edge disappears during graph routing');

  const arch = parse('architecture-beta', samples['architecture-beta'].slice(samples['architecture-beta'].indexOf('\n') + 1)).model;
  const archScene = plain(implementations['architecture-beta'].layout(arch, { width: 800, measure: (s, f) => context.measure(s, f.size, f.weight), ctx: context }).scene);
  const archEdge = elements(archScene).find(item => item.meta?.kind === 'edge');
  assert.equal(archEdge.meta.startPort, 'R');
  assert.equal(archEdge.meta.endPort, 'L');
  assert.ok(elements(archScene).some(item => item.meta?.kind === 'icon' && item.meta.icon === 'server'));
  // 分组只画成外框，不另画节点卡；左右端口按横排布局，连线一路向右、不折回；卡片不重复写 service。
  const row = parse('architecture-beta', 'group cloud(cloud)[Cloud]\nservice api(server)[API] in cloud\nservice db(database)[DB] in cloud\nservice app(browser)[App]\napp:R --> L:api\napi:R --> L:db').model;
  const rowScene = plain(implementations['architecture-beta'].layout(row, { width: 800, measure: (s, f) => context.measure(s, f.size, f.weight), ctx: context }).scene);
  const rowNodes = elements(rowScene).filter(item => item.meta?.kind === 'node');
  assert.deepEqual(rowNodes.map(item => item.meta.node).sort(), ['api', 'app', 'db']);
  assert.ok(elements(rowScene).some(item => item.meta?.kind === 'group' && item.meta.group === 'cloud'));
  assert.ok(!elements(rowScene).some(item => item.meta?.kind === 'node-detail' && item.text === 'service'));
  for (const node of rowNodes) {
    const icon = elements(rowScene).find(item => item.meta?.kind === 'icon' && item.meta.node === node.meta.node);
    const label = elements(rowScene).find(item => item.meta?.kind === 'node-label' && item.meta.node === node.meta.node);
    const iconRight = Number(/translate\(([\d.]+)/.exec(icon.attrs.transform)[1]) + 24 * .72;
    const labelLeft = label.attrs.x - context.measure(label.text, 14, 600) / 2;
    assert.ok(labelLeft >= iconRight + 6, `${node.meta.node}: icon and title keep apart`);
    assert.ok(labelLeft + context.measure(label.text, 14, 600) <= node.attrs.x + node.attrs.width - 8, `${node.meta.node}: title stays inside its card`);
    // 只有标题的卡片不画表头色带，标题垂直居中。
    assert.ok(!elements(rowScene).some(item => item.meta?.kind === 'node-header' && item.meta.node === node.meta.node), `${node.meta.node}: no header band without details`);
    assert.ok(Math.abs(label.attrs.y - 5 - (node.attrs.y + node.attrs.height / 2)) <= 1, `${node.meta.node}: title is vertically centred`);
  }
  for (const edge of elements(rowScene).filter(item => item.meta?.kind === 'edge')) {
    const xs = [...edge.attrs.d.matchAll(/[ML](-?[\d.]+) /g)].map(match => Number(match[1]));
    assert.ok(xs.every((x, i) => !i || x >= xs[i - 1]), `edge ${edge.meta.edge} never doubles back: ${edge.attrs.d}`);
  }
  assert.ok(parse('architecture-beta', 'group g(cloud)[G]\nservice a(server)[A]\na:R --> L:g').errors.length, 'edges into a group are rejected instead of drawn');

  const seq = parse('zenuml', samples.zenuml.slice(samples.zenuml.indexOf('\n') + 1)).model;
  const seqScene = plain(implementations.zenuml.layout(seq, { width: 800, measure: (s, f) => context.measure(s, f.size, f.weight), ctx: context }).scene);
  assert.equal(seqScene.children.filter(item => item.meta?.kind === 'lifeline').length, 2);
  assert.ok(seqScene.children.some(item => item.meta?.kind === 'message-label' && item.text === 'request'));

  const block = parse('block-beta', 'block:store\ncache[Cache]\nspace\ncache --> disk : connects\nend').model;
  const blockResult = implementations['block-beta'].layout(block, { width: 800, measure: (s, f) => context.measure(s, f.size, f.weight), ctx: context });
  assert.equal(blockResult.errors.length, 0, JSON.stringify(blockResult.errors));
  assert.ok(elements(blockResult.scene).some(item => item.meta?.kind === 'group' && item.meta.group === 'store'));
  assert.ok(elements(blockResult.scene).some(item => item.meta?.kind === 'node' && item.meta.node === 'disk'), 'implicit endpoint participates in graph layout');
  assert.ok(!elements(blockResult.scene).some(item => item.meta?.kind === 'node' && item.meta.type === 'space'), 'space contributes to layout but is not painted as a visible card');

  const longText = '+veryLongMemberNameThatMustWrapAcrossMultipleVisibleRowsWithoutLosingAnyCharacters:string';
  const longModel = parse('classDiagram', `class A {\n${longText}\n}`).model;
  const longScene = plain(implementations.classDiagram.layout(longModel, { width: 360, measure: (s, f) => context.measure(s, f.size, f.weight), ctx: context }).scene);
  const memberRows = longScene.children.filter(item => item.meta?.kind === 'node-detail' && item.meta.node === 'A').map(item => item.text);
  assert.ok(memberRows.length > 1, `long member is wrapped inside its allocated node box: ${JSON.stringify(memberRows)}`);
  assert.equal(memberRows.join(''), longText, 'wrapping preserves every member character');
});

// 窄宽度也不能把生命线参与者卡片的边框画到 SVG 左侧之外。
test('ZenUML fits its participant boxes inside the SVG', () => {
  const result = diagram(samples.zenuml, { width: 268, frame: false });
  assert.ok(result.svg, JSON.stringify(result.diagnostics));
  const boxes = elements(result.scene).filter(node => node.meta?.kind === 'participant');
  assert.equal(boxes.length, 2);
  assert.ok(boxes.every(({ attrs }) => attrs.x >= 12 && attrs.x + attrs.width <= result.scene.width - 12));
  for (const [theme, design] of Object.entries(themes)) {
    const rendered = diagram(samples.zenuml, { theme, width: 600, frame: false });
    assert.equal(rendered.scene.width, 600);
    const routes = elements(rendered.scene).filter(node => ['message', 'call', 'lifeline'].includes(node.meta?.kind));
    assert.equal(routes.length, 4);
    assert.ok(routes.every(({ attrs }) => contrast(attrs.stroke, design.surface) >= 3), theme);
  }
});
