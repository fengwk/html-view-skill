import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { diagram } from '../dist/esm/node.js';
import { implementations } from '../src/diagram/zenuml.js';
import { checkScene } from './helpers/geometry.mjs';

const parse = body => implementations.zenuml.parse(body, { lang: 'en', firstLine: 2 });
const modelOf = body => {
  const { model, errors } = parse(body);
  assert.deepEqual(errors, []);
  return model;
};
const descendants = ({ children = [] }) => children.flatMap(node => [node, ...descendants(node)]);

// Declarations pick real glyph kinds; unmapped annotations fall back once per diagram.
test('ZenUML titles, aliases and participant kinds', () => {
  const kinds = ['Actor', 'Boundary', 'Control', 'Entity', 'Database', 'Collections', 'Queue'];
  const { model, errors } = parse(['title Demo', ...kinds.map(kind => `@${kind} ${kind}`),
    '@EC2 A as "Alice Lee"', '@S3 B', '@EC2 C', 'Actor->Implicit: hi'].join('\n'));
  assert.equal(model.title, 'Demo');
  assert.deepEqual(model.participants.map(actor => actor.kind), [...kinds.map(kind => kind.toLowerCase()), ...Array(4).fill('participant')]);
  assert.equal(model.participants.find(actor => actor.id === 'A').name, 'Alice Lee');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].severity, 'warning');
  assert.match(errors[0].message, /@EC2, @S3$/);
});

// Check caller direction and activation stack, not just successful parsing of nested blocks.
test('ZenUML sync, async, replies and assignments use the correct endpoints', () => {
  const { statements, participants } = modelOf([
    'Client->A.method(outer("{x}")) {', 'B.inner() { return x }', 'B->A: event',
    '@return', 'A->Client: early', 'return done', '}', 'Value y = A.read',
  ].join('\n'));
  const [starter] = participants;
  assert.deepEqual([starter.name, starter.kind], ['', 'actor']);
  assert.deepEqual(statements.map(event => event.type === 'deactivate' ? ['stop', event.id] :
    [event.from, event.to, event.text, event.arrow.head, event.arrow.dashed, event.activateOn]), [
    ['Client', 'A', 'method(outer("{x}"))', 'arrow', false, 'A'],
    ['A', 'B', 'inner()', 'arrow', false, 'B'],
    ['B', 'A', 'x', 'open', true, undefined], ['stop', 'B'],
    ['B', 'A', 'event', 'open', false, undefined],
    ['A', 'Client', 'early', 'open', true, undefined],
    ['A', 'Client', 'done', 'open', true, undefined], ['stop', 'A'],
    [starter.id, 'A', 'read', 'arrow', false, 'A'],
    ['A', starter.id, 'y', 'open', true, undefined], ['stop', 'A'],
  ]);
});

// Drop participant comments and bind message comments to the message, including annotated replies.
test('ZenUML comments and creation lower to sequence notes and creation events', () => {
  const { statements } = modelOf('// Not shown\nA\n// **Creates** B\nnew B\nnew C(x, y)\n// Result\n@reply B->A: done');
  assert.deepEqual(statements.filter(event => event.type === 'note').map(event => event.text), ['Creates B', 'Result']);
  assert.deepEqual(statements.filter(event => event.create).map(event => [event.to, event.create, event.text, event.arrow.dashed]),
    [['B', 'B', '«create»', true], ['C', 'C', '«x, y»', true]]);
  assert.equal(statements.at(-1).arrow.dashed, true);
});

// Branches must belong to their own frame; nesting and semicolons in loop headers must survive.
test('ZenUML maps loops, alternatives, optional, parallel and exception blocks', () => {
  const { statements } = modelOf([
    'while(ok) { A.read() }', 'for(i=0; i<2; i++) { A.read() }', 'forEach(items) { A.read() }', 'loop { A.read() }',
    'if(a) { opt { A.read() } } else if(b) { A.read() } else { A.wait() }',
    'par { A.read(); B.read() }', 'try { A.read() } catch(Failure) { B.read() } finally { A.close() }',
  ].join('\n'));
  assert.deepEqual(statements.filter(event => event.type === 'fragment').map(event =>
    [event.keyword, event.text, event.sections.map(section => [section.keyword, section.text || ''])]), [
    ['loop', 'ok', []], ['loop', 'i=0; i<2; i++', []], ['loop', 'items', []], ['loop', '', []],
    ['alt', 'a', [['else if', 'b'], ['else', '']]], ['opt', '', []], ['par', '', [['', '']]],
    ['try', '', [['catch', 'Failure'], ['finally', '']]],
  ]);
});

// Recovery reports invalid constructs at source lines rather than silently rendering a partial diagram.
test('ZenUML rejects malformed blocks and replies', () => {
  for (const [body, match] of [['A.method() {', /missing }/], ['A\n}', /Unexpected }/],
    ['A\nelse { }', /Unrecognized/], ['A\n@return', /Expected a message/], ['A\nreturn a', /inside a ZenUML synchronous call/],
    ['A->B: hi\nnew B', /before its first message/]]) {
    const { errors } = parse(body);
    assert.equal(errors[0].line, body.includes('\n') ? 3 : 2);
    assert.match(errors[0].message, match);
  }
});

// The plugin classification is unchanged, but all sixteen fixtures must produce clean KChart scenes.
test('Mermaid 12.3.0 ZenUML plugin corpus renders separately from the core ratchet', () => {
  const records = JSON.parse(readFileSync(new URL('./conformance/mermaid-12.3.0.json', import.meta.url), 'utf8'))
    .filter(record => record.id.startsWith('zenuml.md:'));
  assert.equal(records.length, 16);
  for (const { id, mermaid, source } of records) {
    assert.equal(mermaid, 'plugin', id);
    for (const width of [360, 800]) {
      const { svg, scene, diagnostics } = diagram(source, { width });
      assert.deepEqual(diagnostics.filter(d => d.severity === 'error'), [], `${id} at ${width}`);
      assert.ok(svg, id);
      assert.deepEqual(checkScene(scene, { source }), [], `${id} at ${width}`);
    }
  }
});

// In a narrow SVG the participant cards stay fully inset, and arrowheads distinguish call and async.
test('ZenUML draws participant cards and messages inside a narrow scene', () => {
  const { scene, diagnostics } = diagram('zenuml\nClient->API: request\nClient->API.call()', { width: 268, frame: false });
  assert.deepEqual(diagnostics, []);
  const nodes = descendants(scene);
  const boxes = nodes.filter(node => node.meta?.kind === 'participant').map(node => node.children[0].attrs);
  assert.equal(boxes.length, 2);
  assert.ok(boxes.every(box => box.x >= 8 && box.x + box.width <= scene.width - 8));
  const routes = nodes.filter(node => node.meta?.kind === 'message');
  assert.equal(routes.length, 2);
  assert.notEqual(routes[0].attrs['marker-end'], routes[1].attrs['marker-end']);
});
