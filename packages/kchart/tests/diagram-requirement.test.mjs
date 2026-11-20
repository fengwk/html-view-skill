import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parse, parseRequirement, kind, kinds, limits, implementation, riskLevels, verificationMethods } from '../src/diagram/requirement.js';
import { prepareSource } from '../src/diagram/source.js';

const parseBody = (body, info = {}) => {
  const result = parse(body, { lang: 'en', firstLine: 2, options: {}, ...info });
  return { ...result, blocking: result.errors.filter(error => error.severity !== 'warning') };
};
const card = (model, id) => model.cards.find(entry => entry.id === id);
const linesOf = (model, id) => card(model, id).sections.map(section => section.map(item => item.text));
const bodyOf = (source) => {
  const prepared = prepareSource(source, { syntax: 'mermaid', lang: 'en' });
  return { ...prepared, body: prepared.body, firstLine: prepared.firstLine };
};

// Intent: the canonical kind and alias both use the new parser and layout.
test('requirement kind spec matches the family registry shape', () => {
  assert.deepEqual(kinds, [kind]);
  assert.equal(kind.kind, 'requirementDiagram');
  assert.equal(kind.syntax, 'mermaid');
  assert.equal(kind.topic, 'data-model');
  assert.deepEqual([...kind.aliases], ['requirement']);
  assert.ok(Object.isFrozen(kind) && Object.isFrozen(kind.aliases));
  assert.equal(typeof implementation.layout, 'function');
  assert.equal(implementation.parse, parse);
  assert.equal(parseRequirement, parse);
});

// Intent: every corpus-shaped statement — six requirement types, element, all seven verbs — parses without errors.
test('all requirement types, elements and relationships parse without errors', () => {
  const source = `requirementDiagram
  requirement r1 {
    id: 1
    text: the test text.
    risk: high
    verifymethod: test
  }
  functionalRequirement r2 {
    id: 1.1
  }
  performanceRequirement r3 {
    id: 1.2
  }
  interfaceRequirement r4 {
    id: 1.2.1
  }
  physicalRequirement r5 {
    id: 1.2.2
  }
  designConstraint r6 {
    id: 1.2.3
  }
  element e1 {
    type: simulation
    docRef: reqs/test_entity
  }
  r1 - contains -> r2
  r1 - traces -> r2
  r1 - copies -> r3
  r3 - derives -> r4
  r4 - satisfies -> r5
  r5 - verifies -> r6
  r6 - refines -> e1`;
  const prepared = bodyOf(source);
  const { model, blocking } = parseBody(prepared.body, prepared);
  assert.deepEqual(blocking, []);
  assert.deepEqual(model.cards.map(entry => entry.id), ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'e1']);
  assert.deepEqual(model.cards.map(entry => entry.kind), ['requirement', 'functionalrequirement', 'performancerequirement', 'interfacerequirement', 'physicalrequirement', 'designconstraint', 'element']);
  assert.deepEqual(model.cards.map(entry => entry.stereotype), ['Requirement', 'Functional Requirement', 'Performance Requirement', 'Interface Requirement', 'Physical Requirement', 'Design Constraint', 'Element']);
  assert.deepEqual(model.edges.map(edge => edge.verb), ['contains', 'traces', 'copies', 'derives', 'satisfies', 'verifies', 'refines']);
});

// Intent: `contains` is solid with a source-side marker, the other six are dashed with a target arrow labelled <<verb>>.
test('contains draws solid from the source while the other verbs draw dashed toward the target', () => {
  const { model, blocking } = parseBody('requirement a {\nid: 1\n}\nrequirement b {\nid: 2\n}\na - contains -> b\na - satisfies -> b');
  assert.deepEqual(blocking, []);
  const [contains, satisfies] = model.edges;
  assert.deepEqual({ from: contains.from, to: contains.to, dashed: contains.dashed, start: contains.start, end: contains.end }, { from: 'a', to: 'b', dashed: false, start: 'contains', end: undefined });
  assert.equal(contains.label, '<<contains>>');
  assert.deepEqual({ from: satisfies.from, to: satisfies.to, dashed: satisfies.dashed, start: satisfies.start, end: satisfies.end }, { from: 'a', to: 'b', dashed: true, start: undefined, end: 'arrow' });
  assert.equal(satisfies.label, '<<satisfies>>');
  assert.deepEqual(riskLevels, { low: 'Low', medium: 'Medium', high: 'High' });
  assert.deepEqual(Object.keys(verificationMethods), ['analysis', 'demonstration', 'inspection', 'test']);
});

// Intent: `b <- verb - a` is the same (src,dst) pair as `a - verb -> b`, not a reversed edge.
test('reverse relationships keep the source and destination in written order', () => {
  const { model, blocking } = parseBody('requirement a {\nid: 1\n}\nrequirement b {\nid: 2\n}\nb <- contains - a\nb <- copies - a');
  assert.deepEqual(blocking, []);
  assert.deepEqual(model.edges.map(edge => [edge.from, edge.to, edge.verb]), [['a', 'b', 'contains'], ['a', 'b', 'copies']]);
});

// Intent: quoted names and values keep their inner text, while punctuation that Mermaid allows unquoted still parses.
test('quoted and unquoted names, ids and values keep their exact text', () => {
  const { model, blocking } = parseBody([
    'requirement "__test_req__" {',
    'id: 1.2.3',
    'text: "*italicized text* **bold text**"',
    'risk: HIGH',
    'verifymethod: TEST',
    '}',
    'element "my entity" {',
    'type: "test suite"',
    'docref: github.com/all_the_tests',
    '}',
  ].join('\n'));
  assert.deepEqual(blocking, []);
  assert.equal(card(model, '__test_req__').title, '__test_req__');
  assert.deepEqual(linesOf(model, '__test_req__')[1], ['ID: 1.2.3', 'Text: italicized text bold text', 'Risk: High', 'Verification: Test']);
  assert.equal(card(model, 'my entity').title, 'my entity');
  assert.deepEqual(linesOf(model, 'my entity')[1], ['Type: test suite', 'Doc Ref: github.com/all_the_tests']);
});

// Intent: card rows use Mermaid's labels in Mermaid's order, and the stereotype is its own section above them.
test('card sections list the stereotype first, then the field rows with Mermaid labels', () => {
  const { model } = parseBody('requirement r {\nid: 1\ntext: t\nrisk: low\nverifymethod: inspection\n}\nelement e {\ntype: word doc\ndocref: reqs/x\n}\nrequirement bare {\n}');
  assert.deepEqual(linesOf(model, 'r'), [['<<Requirement>>'], ['ID: 1', 'Text: t', 'Risk: Low', 'Verification: Inspection']]);
  assert.deepEqual(linesOf(model, 'e'), [['<<Element>>'], ['Type: word doc', 'Doc Ref: reqs/x']]);
  assert.deepEqual(linesOf(model, 'bare'), [['<<Requirement>>']]);
  assert.deepEqual(card(model, 'r').sections[0][0].role, 'stereotype', 'the stereotype row is marked so layout can style or drop it');
  assert.equal(card(model, 'e').tone, 'info', 'elements carry a tone so they stay distinguishable from requirements');
  assert.equal(card(model, 'r').tone, undefined);
});

// Intent: printed labels, values and verbs follow the diagram language; the model keeps Mermaid's words.
test('Chinese diagrams print requirement labels, values and verbs in Chinese', () => {
  const { model } = parseBody('performanceRequirement r {\nid: "REQ-1"\ntext: t\nrisk: medium\nverifymethod: test\n}\nelement e {\ntype: doc\ndocref: x\n}\ne - satisfies -> r', { lang: 'zh-CN' });
  assert.deepEqual(linesOf(model, 'r'), [['<<性能需求>>'], ['编号：REQ-1', '内容：t', '风险：中', '验证：测试']]);
  assert.deepEqual(linesOf(model, 'e'), [['<<元素>>'], ['类型：doc', '文档：x']]);
  assert.deepEqual(model.edges.map(edge => [edge.verb, edge.label]), [['satisfies', '<<满足>>']]);
  assert.deepEqual([card(model, 'r').stereotype, card(model, 'r').fields.risk], ['Performance Requirement', 'Medium']);
});

// Intent: risk and verification are closed enums, so an out-of-range value is an error instead of free text.
test('out-of-range risk and verification values are rejected at their line', () => {
  const risk = parseBody('requirement r {\nrisk: critical\n}');
  assert.equal(risk.blocking.length, 1);
  assert.equal(risk.blocking[0].line, 3);
  assert.match(risk.blocking[0].message, /low\/medium\/high/);
  const verify = parseBody('element e {\ntype: t\nverifymethod: review\n}');
  assert.equal(verify.blocking.length, 1);
  assert.equal(verify.blocking[0].line, 4, 'an element body has no verifymethod field at all');
});

// Intent: a block accepts only its own fields, and a field always needs a value.
test('fields are validated against the block type and must carry a value', () => {
  const elementId = parseBody('element e {\nid: 3\n}');
  assert.equal(elementId.blocking.length, 1);
  assert.equal(elementId.blocking[0].line, 3);
  assert.match(elementId.blocking[0].message, /no field "id"/);
  const requirementType = parseBody('requirement r {\ndocref: x\n}');
  assert.match(requirementType.blocking[0].message, /no field "docref"/);
  const empty = parseBody('requirement r {\nid:\n}');
  assert.match(empty.blocking[0].message, /needs a value/);
  const unknown = parseBody('requirement r {\nowner: me\n}');
  assert.equal(unknown.blocking[0].line, 3);
});

// Intent: unrecognized statements and unknown verbs fail with the source line instead of vanishing.
test('unrecognized statements, relation verbs and unclosed blocks are errors with source lines', () => {
  const junk = parseBody('requirement r {\nid: 1\n}\nthis is not a statement');
  assert.equal(junk.blocking.length, 1);
  assert.equal(junk.blocking[0].line, 5);
  const verb = parseBody('a - relates -> b');
  assert.equal(verb.blocking.length, 1);
  assert.equal(verb.blocking[0].line, 2);
  const unclosed = parseBody('requirement r {\nid: 1');
  assert.equal(unclosed.blocking.length, 1);
  assert.equal(unclosed.blocking[0].line, 2, 'an unclosed block is reported where the block starts');
  assert.equal(unclosed.model.cards.length, 1, 'the partially read card is still returned');
});

// Intent: a name that a relation mentions before (or without) a declaration still becomes a card, so no edge is lost.
test('relation endpoints that were never declared become name-only cards', () => {
  const { model, blocking } = parseBody('ghost - satisfies -> phantom\nrequirement declared {\nid: 1\n}\nghost - traces -> declared');
  assert.deepEqual(blocking, []);
  assert.deepEqual(model.cards.map(entry => entry.id), ['ghost', 'phantom', 'declared']);
  assert.deepEqual(card(model, 'ghost').sections, []);
  assert.equal(card(model, 'ghost').implicit, true);
  assert.equal(card(model, 'declared').implicit, undefined);
  assert.deepEqual(model.edges.map(edge => [edge.from, edge.to]), [['ghost', 'phantom'], ['ghost', 'declared']]);
});

// Intent: Mermaid drops a second definition silently; KChart draws one card, keeps later fields and says so once.
test('a redeclared requirement is reported once and later fields win', () => {
  const { model, errors, blocking } = parseBody('requirement a {\nid: 1\n}\nrequirement a {\nid: 2\ntext: later\n}');
  assert.deepEqual(blocking, []);
  assert.equal(model.cards.length, 1);
  assert.deepEqual(linesOf(model, 'a')[1], ['ID: 2', 'Text: later']);
  const hints = errors.filter(error => error.code === 'DIAGRAM_HINT');
  assert.equal(hints.length, 1);
  assert.equal(hints[0].severity, 'warning');
  assert.equal(hints[0].line, 5);
});

// Intent: inline and list classes compose with a later style override while unsupported CSS warns once.
test('requirement presentation resolves class lists and style overrides', () => {
  const body = [
    'requirement test_req:::important {',
    'id: 1',
    '}',
    'element test_entity {',
    'type: simulation',
    '}',
    'classDef important fill:#f96,font-weight:bold',
    'class test_req,test_entity important,ok',
    'style test_entity fill:#f00,stroke:#333',
    'test_entity:::extra',
  ].join('\n');
  const { model, errors, blocking } = parseBody(body);
  assert.deepEqual(blocking, []);
  assert.equal(card(model, 'test_req').tone, 'ok');
  assert.equal(card(model, 'test_entity').tone, 'danger');
  const warnings = errors.filter(error => error.code === 'IGNORED_STYLE');
  assert.equal(warnings.length, 1, 'one warning per diagram, not one per statement');
  assert.equal(warnings[0].severity, 'warning');
  assert.equal(warnings[0].line, 8, 'style/classDef/class are shared-presentation statements, reported where the first one is');
  assert.deepEqual(model.edges, []);
});

// Intent: `#` and `%%` are comments, but entity codes inside a value stay text; direction works anywhere on a line.
test('comments and entities are told apart, and direction is read anywhere on a line', () => {
  const { model, blocking } = parseBody([
    'requirement r { # trailing comment',
    'id: 1 %% another comment',
    'text: a #quot;quoted#quot; value',
    '}',
    'direction LR   %% the request',
  ].join('\n'));
  assert.deepEqual(blocking, []);
  assert.equal(model.direction, 'LR');
  assert.deepEqual(linesOf(model, 'r')[1], ['ID: 1', 'Text: a "quoted" value']);
  assert.equal(parseBody('requirement r {\nid: 1\n}').model.direction, 'TB', 'the default direction is TB');
  for (const direction of ['TB', 'BT', 'RL', 'LR']) assert.equal(parseBody(`direction ${direction}`).model.direction, direction);
});

// Intent: accessibility statements and their multi-line body belong to shared infrastructure and never parse as fields.
test('accTitle and accDescr blocks are skipped instead of being read as statements', () => {
  const body = ['accTitle: a title', 'accDescr {', 'line one', 'line two', '}', 'accDescr: single line', 'requirement r {', 'id: 1', '}'].join('\n');
  const { model, blocking } = parseBody(body);
  assert.deepEqual(blocking, []);
  assert.deepEqual(linesOf(model, 'r')[1], ['ID: 1']);
});

// Intent: extra header options are errors on the header line, because direction is a body statement here.
test('unsupported header options are reported on the header line', () => {
  const { blocking } = parseBody('requirement r {\nid: 1\n}', { options: { direction: 'LR' } });
  assert.equal(blocking.length, 1);
  assert.equal(blocking[0].line, 1);
});

// Intent: a big requirement set still renders, but warns once; only the runtime work caps are hard errors.
test('many cards warn once with LARGE_DIAGRAM and stay under the hard cap', () => {
  const body = Array.from({ length: limits.large + 1 }, (_, index) => `requirement r${index} {\nid: ${index}\n}`).join('\n');
  const { model, errors, blocking } = parseBody(body);
  assert.deepEqual(blocking, []);
  assert.equal(model.cards.length, limits.large + 1);
  const large = errors.filter(error => error.code === 'LARGE_DIAGRAM');
  assert.equal(large.length, 1);
  assert.equal(large[0].severity, 'warning');
  assert.equal(large[0].line, 2);
  assert.ok(limits.cards > limits.large && limits.edges >= 1000, 'hard caps bound runtime only');
});

// Intent: the returned model is directly usable as the shared layoutCards model, so layout stays a separate phase.
test('the model matches the shared card-layout contract shape', () => {
  const { model } = parseBody('requirement a {\nid: 1\n}\nelement e {\ntype: t\n}\ne - contains -> a');
  assert.deepEqual(Object.keys(model).sort(), ['cards', 'direction', 'edges', 'type']);
  assert.ok(['TB', 'BT', 'RL', 'LR'].includes(model.direction));
  for (const entry of model.cards) {
    assert.equal(typeof entry.id, 'string');
    assert.equal(typeof entry.title, 'string');
    assert.ok(Array.isArray(entry.sections), 'sections are an array of row arrays');
    for (const section of entry.sections) for (const row of section) assert.equal(typeof row.text, 'string');
    assert.ok(['new', 'info', 'ok', 'warn', 'danger', 'ext', undefined].includes(entry.tone));
  }
  for (const edge of model.edges) {
    assert.equal(typeof edge.from, 'string');
    assert.equal(typeof edge.to, 'string');
    assert.equal(typeof edge.label, 'string');
    assert.ok([undefined, 'arrow', 'contains'].includes(edge.start), 'marker names are the shared arrow/contains set');
    assert.ok([undefined, 'arrow', 'contains'].includes(edge.end));
    assert.equal(typeof edge.dashed, 'boolean');
  }
});
