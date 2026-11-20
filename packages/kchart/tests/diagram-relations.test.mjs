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
  C4Context: 'C4Context\nPerson(user, "Customer", "Uses app")\nSystem(app, "Shop", "Online shop")\nRel(user, app, "browses")',
  C4Container: 'C4Container\nPerson(user, "Customer")\nContainer(api, "API", "Node", "HTTP API")\nRel(user, api, "calls")',
  C4Component: 'C4Component\nSystem_Boundary(sys, "System") {\nComponent(ui, "UI")\n}\nComponent(api, "API")\nRel(ui, api, "calls")',
  C4Dynamic: 'C4Dynamic\nPerson(user, "Customer")\nSystem(app, "Shop")\nRel(user, app, "browses")',
  C4Deployment: 'C4Deployment\nDeployment_Node(host, "Server", "Linux")\nContainer(app, "API")\nRel(host, app, "hosts")',
  zenuml: 'zenuml\nClient\nAPI\nClient->API: request\nClient.call()',
};
const parse = (kind, body) => plain(implementations[kind].parse(body, { kind, lang: 'en', firstLine: 2, options: {} }));
const context = createContext({ width: 800, lang: 'en' });
const plain = value => JSON.parse(JSON.stringify(value));
const elements = ({ children }) => children.flatMap(node => [node, ...(node.children ? elements(node) : [])]);

// Intent: every kind still served by relations.js retains representative syntax and rejects unknown statements
// rather than silently producing partial success. Kinds that moved to their own module are tested there.
test('relation parsers preserve model identity and report unsupported syntax', () => {
  assert.ok(Object.keys(implementations).every(kind => kind in samples));
  for (const kind of Object.keys(implementations)) {
    const source = samples[kind];
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

// 意图：分组按子图参与布局，相邻两个部署节点之间留出边与标签的位置；边标签底板不跨任何分组边框。
test('relation groups reserve room so an edge label never straddles a boundary', () => {
  const source = 'C4Deployment\n  Deployment_Node(cloud, "Cloud region", "Kubernetes") {\n    Container(api, "Order API", "Node.js")\n  }\n  Deployment_Node(shop, "Store", "Tablet") {\n    Container(bar, "Bar screen", "Web")\n  }\n  Rel(api, bar, "WebSocket")';
  for (const width of [338, 760]) {
    const scene = plain(diagram(source, { width, frame: false, lang: 'en' }).scene);
    const groups = elements(scene).filter(item => item.meta?.kind === 'group');
    const label = elements(scene).find(item => item.meta?.kind === 'edge-label');
    assert.equal(groups.length, 2);
    const plate = { x0: label.attrs.x - 40, x1: label.attrs.x + 40, y0: label.attrs.y - 15, y1: label.attrs.y + 5 };
    for (const group of groups) {
      const box = { x0: group.attrs.x, x1: group.attrs.x + group.attrs.width, y0: group.attrs.y, y1: group.attrs.y + group.attrs.height };
      const inside = plate.x0 >= box.x0 && plate.x1 <= box.x1 && plate.y0 >= box.y0 && plate.y1 <= box.y1;
      const outside = plate.y1 <= box.y0 || plate.y0 >= box.y1 || plate.x1 <= box.x0 || plate.x0 >= box.x1;
      assert.ok(inside || outside, `${width}: label plate crosses the ${group.meta.group} border`);
    }
    const [a, b] = groups.map(group => group.attrs).sort((p, q) => p.y - q.y);
    assert.ok(b.y - (a.y + a.height) >= 24, `${width}: boundaries keep a gap for the edge (${b.y - (a.y + a.height)})`);
  }
});

// 意图：连线纵向进入窄分组时会穿过左对齐的分组标题；标题所在矩形必须从连线的裁剪区里挖掉，线不压字。
test('edges are cut where they cross a group title', () => {
  const source = 'C4Deployment\n  Deployment_Node(cloud, "Cloud region", "Kubernetes") {\n    Container(api, "Order API", "Node.js")\n  }\n  Deployment_Node(shop, "Store", "Tablet") {\n    Container(bar, "Bar screen", "Web")\n  }\n  Rel(api, bar, "WebSocket")';
  const scene = plain(diagram(source, { width: 760, frame: false, lang: 'en' }).scene);
  const all = elements(scene);
  const clip = all.find(item => item.tag === 'clipPath');
  const [outer, ...holes] = clip.children[0].attrs.d.split('M').filter(Boolean).map(part => part.match(/-?[\d.]+/g).map(Number));
  assert.equal(clip.children[0].attrs['clip-rule'], 'evenodd');
  assert.ok(outer.length && holes.length === 2);
  const edge = all.find(item => item.meta?.kind === 'edge');
  assert.equal(edge.attrs['clip-path'], `url(#${clip.attrs.id})`);
  const title = all.find(item => item.meta?.kind === 'group-label' && item.meta.group === 'shop');
  const width = context.measure(title.text, 12, 600);
  // 每个孔是 M x y H x1 V y1 H x Z；标题字形（基线上 10px、下 3px）必须落在某个孔内。
  const covered = holes.some(([x, y, x1, y1]) => x <= title.attrs.x && x1 >= title.attrs.x + width && y <= title.attrs.y - 10 && y1 >= title.attrs.y + 3);
  assert.ok(covered, 'the Store [Tablet] title sits inside a clip hole');
  const vertical = edge.attrs.d.match(/-?[\d.]+/g).map(Number);
  const xs = vertical.filter((_, i) => i % 2 === 0);
  assert.ok(xs.some(x => x > title.attrs.x && x < title.attrs.x + width), 'the sample edge does cross the title column, so the clip is exercised');
});
