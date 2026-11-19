import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from '../modules.mjs';
import { diagram } from '../diagram.mjs';

const core = loadModules(['diagram/relations', 'core/svg']);
const { implementations } = core['diagram/relations'];
const samples = {
  classDiagram: 'classDiagram\nclass Animal {\n+name: string\n+eat()\n}\nAnimal <|-- Dog\nDog "1" *-- "*" Paw : owns',
  requirementDiagram: 'requirementDiagram\nfunctionalRequirement checkout {\nid: REQ-1\ntext: Finish checkout\n}\nAPI - satisfies -> checkout',
  C4Context: 'C4Context\nPerson(user, "Customer", "Uses app")\nSystem(app, "Shop", "Online shop")\nRel(user, app, "browses")',
  C4Container: 'C4Container\nPerson(user, "Customer")\nContainer(api, "API", "Node", "HTTP API")\nRel(user, api, "calls")',
  C4Component: 'C4Component\nSystem_Boundary(sys, "System") {\nComponent(ui, "UI")\n}\nComponent(api, "API")\nRel(ui, api, "calls")',
  C4Dynamic: 'C4Dynamic\nPerson(user, "Customer")\nSystem(app, "Shop")\nRel(user, app, "browses")',
  C4Deployment: 'C4Deployment\nDeployment_Node(host, "Server", "Linux")\nContainer(app, "API")\nRel(host, app, "hosts")',
  'architecture-beta': 'architecture-beta\ngroup cloud(cloud)[Cloud]\nservice api(server)[API] in cloud\nservice db(database)[Database] in cloud\napi:R --> L:db',
  'block-beta': 'block-beta\ncolumns 2\nui["UI"]\napi["API"]\nui --> api : request',
  zenuml: 'zenuml\nClient\nAPI\nClient->API: request\nClient.call()',
};
const parse = (kind, body) => plain(implementations[kind].parse(body, { kind, lang: 'en', firstLine: 2, options: {} }));
const context = core['core/context'].createContext({ width: 800, lang: 'en' });
const plain = value => JSON.parse(JSON.stringify(value));
const elements = ({ children }) => children.flatMap(node => [node, ...(node.children ? elements(node) : [])]);

// Intent: every migrated kind must retain representative syntax and reject unknown statements rather than silently producing partial success.
test('ten relation and architecture parsers preserve model identity and report unsupported syntax', () => {
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
  assert.ok(parse('C4Context', 'Person(a, "A")\nRel(a, missing, "calls")').errors.length, 'relations cannot fabricate undeclared C4 endpoints');
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
  const c4 = parse('C4Context', 'Person(user, "Customer", "Uses app")\nSystem(app, "Shop", "Online shop")\nRel(user, app, "browses", "HTTPS")').model;
  assert.equal(c4.nodes.find(n => n.id === 'user').type, 'Person');
  assert.deepEqual(c4.nodes.find(n => n.id === 'user').attrs, ['Uses app']);
  assert.equal(c4.edges[0].label, 'browses');
  assert.equal(c4.edges[0].description, 'HTTPS');
  const dynamic = parse('C4Dynamic', 'Person(a, "A")\nPerson(b, "B")\nRel(a, b, "request")\nRel(b, a, "response")').model;
  assert.deepEqual(dynamic.edges.map(edge => edge.label), ['1. request', '2. response']);
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
  assert.ok(card.attrs.x < edgeLabel.attrs.x - context.measure(edgeLabel.text, 12, 400) / 2, 'cardinality also leaves room for the edge caption');
  assert.ok(classScene.children.some(item => item.meta?.kind === 'edge-label' && item.meta.edge === '1'));
  const allRelations = parse('classDiagram', 'A <|-- B\nA ..|> C\nA <|.. D\nA *-- E\nA o-- F\nA --* G\nA --o H\nA ..> I\nA --> J\nA -- K\nA .. L').model;
  const allRelationScene = plain(implementations.classDiagram.layout(allRelations, { width: 800, measure: (s, f) => context.measure(s, f.size, f.weight), ctx: context }).scene);
  assert.equal(allRelationScene.children.filter(child => child.meta?.kind === 'relation-marker').length, 9, 'all inherited, composition, aggregation and directed associations keep their distinct marker counts');
  assert.equal(allRelationScene.children.filter(child => child.meta?.kind === 'edge').length, 11, 'no UML edge disappears during graph routing');

  const grouped = parse('C4Component', samples.C4Component.slice(samples.C4Component.indexOf('\n') + 1)).model;
  const groupedScene = plain(implementations.C4Component.layout(grouped, { width: 800, measure: (s, f) => context.measure(s, f.size, f.weight), ctx: context }).scene);
  assert.ok(elements(groupedScene).some(item => item.meta?.kind === 'group' && item.meta.group === 'sys'));
  const c4WithTech = parse('C4Context', 'Person(user, "Customer", "Uses app")\nSystem(app, "Shop")\nRel(user, app, "browses", "HTTPS")').model;
  const c4Layout = plain(implementations.C4Context.layout(c4WithTech, { width: 800, measure: (s, f) => context.measure(s, f.size, f.weight), ctx: context }).scene);
  assert.ok(c4Layout.children.some(item => item.meta?.kind === 'edge-description' && item.text === 'HTTPS'), 'C4 relationship technology is visibly retained');
  assert.ok(c4Layout.children.some(item => item.meta?.kind === 'node-detail' && item.text === 'Person'), 'C4 element type remains visible');

  const arch = parse('architecture-beta', samples['architecture-beta'].slice(samples['architecture-beta'].indexOf('\n') + 1)).model;
  const archScene = plain(implementations['architecture-beta'].layout(arch, { width: 800, measure: (s, f) => context.measure(s, f.size, f.weight), ctx: context }).scene);
  const archEdge = elements(archScene).find(item => item.meta?.kind === 'edge');
  assert.equal(archEdge.meta.startPort, 'R');
  assert.equal(archEdge.meta.endPort, 'L');
  assert.ok(elements(archScene).some(item => item.meta?.kind === 'icon' && item.meta.icon === 'server'));

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
  const { themes } = core['core/theme'];
  const { contrast } = core['core/color'];
  for (const [theme, design] of Object.entries(themes)) {
    const rendered = diagram(samples.zenuml, { theme, width: 600, frame: false });
    assert.equal(rendered.scene.width, 600);
    const routes = elements(rendered.scene).filter(node => ['message', 'call', 'lifeline'].includes(node.meta?.kind));
    assert.equal(routes.length, 4);
    assert.ok(routes.every(({ attrs }) => contrast(attrs.stroke, design.surface) >= 3), theme);
  }
});
