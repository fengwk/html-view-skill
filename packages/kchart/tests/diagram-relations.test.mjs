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
