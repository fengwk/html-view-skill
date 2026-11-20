import { test } from 'vitest';
import assert from 'node:assert/strict';
import { prepareSource } from '../src/diagram/source.js';
import { arrowMarkers, directions, implementation, kind, kinds, limits, markers, parseClass } from '../src/diagram/class.js';

// `prepareSource` mirrors what the registry hands a parser: the body rows keep absolute source line numbers.
const body = (source) => {
  const prepared = prepareSource(source.startsWith('classDiagram') ? source : `classDiagram\n${source}`, { syntax: 'mermaid', lang: 'en' });
  return {
    statements: prepared.body.split('\n').map((text, index) => ({ text, line: prepared.firstLine + index })),
    firstLine: prepared.firstLine,
  };
};
const parse = (source, info = {}) => {
  const { statements, firstLine } = body(source);
  const result = parseClass(statements, { lang: 'en', firstLine, options: {}, ...info });
  return { ...result, blocking: result.errors.filter((item) => item.severity !== 'warning') };
};
const card = (model, id) => model.cards.find((entry) => entry.id === id);
const rowsOf = (model, id) => card(model, id).sections.filter(section => section.length).map((section) => section.map((item) => item.text));
const frame = (model, id) => model.frames.find((entry) => entry.id === id);

// Intent: the canonical kind and alias both use the new parser and layout.
test('class kind spec matches the family registry shape', () => {
  assert.deepEqual(kinds, [kind]);
  assert.equal(kind.kind, 'classDiagram');
  assert.equal(kind.syntax, 'mermaid');
  assert.equal(kind.topic, 'data-model');
  assert.deepEqual([...kind.aliases], ['classDiagram-v2']);
  assert.ok(Object.isFrozen(kind) && Object.isFrozen(kind.aliases));
  assert.equal(typeof implementation.layout, 'function');
  assert.equal(implementation.parse, parseClass);
  assert.deepEqual([...directions], ['TB', 'BT', 'RL', 'LR']);
  assert.deepEqual([...markers], ['triangle', 'filledDiamond', 'hollowDiamond', 'arrow', 'circle', 'cross']);
  assert.ok(limits.cards > limits.large && limits.edges >= 1000, 'hard caps bound runtime only');
});

// Intent: the model carries exactly the requested keys, so layout can be appended without a parser change.
test('the model carries the kind, direction, cards, frames and edges contract', () => {
  const { model, blocking } = parse('class Animal\nnamespace Zoo {\nclass Cat\n}\nAnimal <|-- Cat');
  assert.deepEqual(blocking, []);
  assert.deepEqual(Object.keys(model), ['kind', 'direction', 'cards', 'frames', 'edges']);
  assert.equal(model.kind, 'classDiagram');
  assert.equal(model.direction, 'TB');
  for (const entry of model.cards) {
    assert.equal(typeof entry.id, 'string');
    assert.equal(typeof entry.title, 'string');
    assert.ok(Array.isArray(entry.sections));
    assert.equal(typeof entry.line, 'number');
    assert.deepEqual(Object.keys(entry).filter((key) => ['id', 'title', 'annotations', 'sections', 'parent', 'tone', 'note', 'hidden', 'line'].includes(key)), Object.keys(entry), 'a card only carries contract keys');
    for (const section of entry.sections) for (const item of section) assert.equal(typeof item.text, 'string');
  }
  for (const item of model.frames) assert.deepEqual(Object.keys(item), ['id', 'label', 'parent', 'depth', 'line']);
  for (const edge of model.edges) {
    assert.equal(typeof edge.from, 'string');
    assert.equal(typeof edge.to, 'string');
    assert.equal(typeof edge.label, 'string');
    assert.equal(typeof edge.line, 'number');
    for (const name of [edge.start, edge.end]) assert.ok(name === undefined || markers.includes(name), `${name} is a shared marker name`);
  }
});

// Intent: attributes and methods are two sections, a method shows `(params)` and ` : returnType` exactly as
// Mermaid prints them, and a class with no member keeps one empty member band.
test('members split into attribute and method sections with Mermaid text', () => {
  const { model, blocking } = parse(`class Order {
    +String id
    +Date placedAt
    +total() Money
    -canEat()
}
class Empty {
}
Field : +String owner`);
  assert.deepEqual(blocking, []);
  assert.deepEqual(rowsOf(model, 'Order'), [
    ['+String id', '+Date placedAt'],
    ['+total() : Money', '-canEat()'],
  ]);
  assert.deepEqual(card(model, 'Empty').sections, [[], []], 'hideEmptyMembersBox=false still draws the empty member band');
  assert.deepEqual(card(model, 'Field').sections.length, 2, 'an attribute-only class preserves an empty method band');
  assert.deepEqual(rowsOf(model, 'Field'), [['+String owner']], '`A : member` is the same statement as a body row');
  // `class A : member` is not a Mermaid production, so KChart rejects it too instead of guessing.
  assert.equal(parse('class Field : +String owner').blocking.length, 1);
});

// Intent: `*` prints italic and `$` underlined, and neither character survives in the visible text.
test('member classifiers become typography instead of text', () => {
  const { model, blocking } = parse(`class Shape {
    +area()* double
    +counter$
    +name$
}`);
  assert.deepEqual(blocking, []);
  const [attributes, methods] = card(model, 'Shape').sections;
  assert.deepEqual(methods[0], { text: '+area() : double', fontStyle: 'italic' });
  assert.deepEqual(attributes[0], { text: '+counter', decoration: 'underline' });
  assert.deepEqual(attributes[1], { text: '+name', decoration: 'underline' });
  for (const item of [...attributes, ...methods]) assert.ok(!/[$*]/u.test(item.text), 'the classifier never reaches the text');
  assert.deepEqual(card(model, 'Shape').sections[1][0].fontStyle, 'italic');
});

// Intent: `~T~` is generic syntax everywhere, so nested `List~List~int~~` prints as `List<List<int>>`.
test('generics convert to angle brackets in class names, attributes, parameters and return types', () => {
  const { model, blocking } = parse(`class Square~Shape~{
    int id
    List~int~ position
    setPoints(List~int~ points)
    getPoints() List~int~
}
Square : -List~string~ messages
Square : +getDistanceMatrix() List~List~int~~`);
  assert.deepEqual(blocking, []);
  assert.equal(card(model, 'Square').title, 'Square<Shape>', 'the generic never joins the id');
  assert.deepEqual(rowsOf(model, 'Square'), [
    ['int id', 'List<int> position', '-List<string> messages'],
    ['setPoints(List<int> points)', 'getPoints() : List<int>', '+getDistanceMatrix() : List<List<int>>'],
  ]);
  // The same id written with and without its generic is one card.
  assert.equal(model.cards.length, 1);
});

// Intent: every relation marker in the spec's table maps to its shared name, and `..` is dashed.
test('all relation arrows map to the six shared marker names', () => {
  const { model, blocking } = parse([
    'classA <|-- classB',
    'classC --|> classD',
    'classE *-- classF',
    'classG --* classH',
    'classI o-- classJ',
    'classK --o classL',
    'classM --> classN',
    'classO <-- classP',
    'classQ ..> classR',
    'classS <.. classT',
    'classU -- classV',
    'classW .. classX',
  ].join('\n'));
  assert.deepEqual(blocking, []);
  const shape = model.edges.map((edge) => [edge.from, edge.to, edge.start, edge.end, Boolean(edge.dashed)]);
  assert.deepEqual(shape, [
    ['classA', 'classB', 'triangle', undefined, false],
    ['classC', 'classD', undefined, 'triangle', false],
    ['classE', 'classF', 'filledDiamond', undefined, false],
    ['classG', 'classH', undefined, 'filledDiamond', false],
    ['classI', 'classJ', 'hollowDiamond', undefined, false],
    ['classK', 'classL', undefined, 'hollowDiamond', false],
    ['classM', 'classN', undefined, 'arrow', false],
    ['classO', 'classP', 'arrow', undefined, false],
    ['classQ', 'classR', undefined, 'arrow', true],
    ['classS', 'classT', 'arrow', undefined, true],
    ['classU', 'classV', undefined, undefined, false],
    ['classW', 'classX', undefined, undefined, true],
  ]);
  assert.deepEqual(arrowMarkers, { '<|': 'triangle', '|>': 'triangle', '*': 'filledDiamond', o: 'hollowDiamond', '>': 'arrow', '<': 'arrow', '()': 'circle' });
});

// Intent: Mermaid allows a marker on both ends, and `A <|--|> B` is the corpus test for it.
test('a bidirectional relation carries a marker on both ends', () => {
  const { model, blocking } = parse('Animal <|--|> Zebra');
  assert.deepEqual(blocking, []);
  assert.deepEqual(model.edges.map((edge) => [edge.start, edge.end, edge.dashed]), [['triangle', 'triangle', false]]);
  const both = parse('classA *--o classB').model.edges[0];
  assert.deepEqual([both.start, both.end], ['filledDiamond', 'hollowDiamond']);
});

// Intent: the cardinality sits directly after each class name, and `"1..*"` must not be read as a dotted line.
test('cardinalities keep both the quoted text and the arrow they belong to', () => {
  const { model, blocking } = parse('Customer "1" --> "*" Ticket\nStudent "1" --> "1..*" Course\nGalaxy --> "many" Star : Contains');
  assert.deepEqual(blocking, []);
  assert.deepEqual(model.edges.map((edge) => [edge.from, edge.to, edge.c1, edge.c2, edge.label, edge.end]), [
    ['Customer', 'Ticket', '1', '*', '', 'arrow'],
    ['Student', 'Course', '1', '1..*', '', 'arrow'],
    ['Galaxy', 'Star', undefined, 'many', 'Contains', 'arrow'],
  ]);
});

// Intent: labels+cardinality+marker are read in one pass, so a label never eats the arrow.
test('relation labels are read after the target class', () => {
  const { model, blocking } = parse([
    'classA --|> classB : Inheritance',
    'classC --* classD : Composition',
    'classE --o classF : Aggregation',
    'classG --> classH : Association',
    'classI -- classJ : Link(Solid)',
    'classK ..> classL : Dependency',
    'classM ..|> classN : Realization',
    'classO .. classP : Link(Dashed)',
  ].join('\n'));
  assert.deepEqual(blocking, []);
  assert.deepEqual(model.edges.map((edge) => [edge.label, edge.start, edge.end, Boolean(edge.dashed)]), [
    ['Inheritance', undefined, 'triangle', false],
    ['Composition', undefined, 'filledDiamond', false],
    ['Aggregation', undefined, 'hollowDiamond', false],
    ['Association', undefined, 'arrow', false],
    ['Link(Solid)', undefined, undefined, false],
    ['Dependency', undefined, 'arrow', true],
    ['Realization', undefined, 'triangle', true],
    ['Link(Dashed)', undefined, undefined, true],
  ]);
});

// Intent: a lollipop end becomes an invisible card carrying the circle marker, so both spellings agree.
test('lollipop relations hide the interface end and draw a circle there', () => {
  const left = parse('bar ()-- foo').model;
  assert.deepEqual(left.cards.map((entry) => [entry.id, entry.hidden]), [['bar', true], ['foo', undefined]]);
  assert.deepEqual(left.edges.map((edge) => [edge.from, edge.to, edge.start, edge.end]), [['bar', 'foo', 'circle', undefined]]);
  const right = parse('class Class01 {\n int amount\n}\nClass01 --() bar\nfoo ()-- Class01').model;
  assert.deepEqual(right.edges.map((edge) => [edge.from, edge.to, edge.start, edge.end]), [
    ['Class01', 'bar', undefined, 'circle'],
    ['foo', 'Class01', 'circle', undefined],
  ]);
  assert.equal(card(right, 'Class01').hidden, undefined, 'a real class stays visible when it is also a lollipop target');
  assert.deepEqual(card(right, 'Class01').sections, [[{ text: 'int amount' }], []], 'its members are kept');
});

// Intent: `class A["label"]` and `` `A Class!` `` both parse, and the label replaces the visible name only.
test('class labels and backtick names keep the id and replace the display text', () => {
  const { model, blocking } = parse(`class Animal["Animal with a label"]
class Car["Car with *! symbols"]
class \`Animal Class!\`
Animal --> Car`);
  assert.deepEqual(blocking, []);
  assert.equal(card(model, 'Animal').title, 'Animal with a label');
  assert.equal(card(model, 'Car').title, 'Car with *! symbols');
  assert.equal(card(model, 'Animal Class!').title, 'Animal Class!');
  const relation = parse('`Animal Class!` --> `Car Class`').model;
  assert.deepEqual(relation.edges.map((edge) => [edge.from, edge.to]), [['Animal Class!', 'Car Class']]);
  assert.deepEqual(relation.cards.map((entry) => entry.id), ['Animal Class!', 'Car Class']);
});

// Intent: `<<ann>>` reaches a class in all three Mermaid spellings and repeats are allowed.
test('the three annotation spellings produce one annotations entry each', () => {
  const { model, blocking } = parse(`class Shape <<interface>>
<<interface>> Shape2
class Shape3{
    <<interface>>
    noOfVertices
}
class Color <<enumeration>> <<service>>`);
  assert.deepEqual(blocking, []);
  for (const id of ['Shape', 'Shape2', 'Shape3']) assert.deepEqual(card(model, id).annotations, [{ text: 'interface' }], id);
  assert.deepEqual(card(model, 'Shape3').sections, [[{ text: 'noOfVertices' }], []], 'the in-body annotation is not a member');
  assert.deepEqual(card(model, 'Color').annotations, [{ text: 'enumeration' }, { text: 'service' }]);
});

// Intent: a global note stands alone; `note for` links to its class with a marker-free dotted edge.
test('notes attach with a dotted edge and resolve regardless of declaration order', () => {
  const { model, blocking } = parse(`note "From Duck till Zebra"
note for Duck "can fly<br>can swim"
note for Later "declared after"
Animal <|-- Duck
class Later`);
  assert.deepEqual(blocking, []);
  assert.deepEqual(card(model, 'note0').title, 'From Duck till Zebra');
  assert.equal(card(model, 'note0').note, true);
  assert.deepEqual(card(model, 'note0').sections, []);
  const noteEdges = model.edges.filter((edge) => edge.dashed);
  assert.deepEqual(noteEdges.map((edge) => [edge.from, edge.to, edge.start, edge.end, edge.label]), [
    ['note1', 'Duck', undefined, undefined, ''],
    ['note2', 'Later', undefined, undefined, ''],
  ]);
  const unconnected = parse('note "alone"').model.edges;
  assert.deepEqual(unconnected, [], 'a general note connects to nothing');
});

// Intent: two notes may target the same class, so nothing is deduplicated away.
test('repeated note targets keep one edge per note', () => {
  const { model } = parse('class A\nnote for A "first"\nnote for A "second"');
  assert.deepEqual(model.edges.map((edge) => [edge.from, edge.to]), [['note0', 'A'], ['note1', 'A']]);
});

// Intent: a namespace body assigns parents, and a dotted name auto-creates each ancestor as a frame.
test('dotted namespaces create one frame per segment with parents and depth', () => {
  const { model, blocking } = parse(`namespace Company.Engineering.Backend {
    class Developer {
        +writeCode()
    }
}
namespace Company.Engineering.Frontend {
    class Designer
}
TechLead --> Developer`);
  assert.deepEqual(blocking, []);
  assert.deepEqual(model.frames.map((entry) => [entry.id, entry.label, entry.parent, entry.depth]), [
    ['Company', 'Company', null, 0],
    ['Company.Engineering', 'Engineering', 'Company', 1],
    ['Company.Engineering.Backend', 'Backend', 'Company.Engineering', 2],
    ['Company.Engineering.Frontend', 'Frontend', 'Company.Engineering', 2],
  ]);
  assert.equal(card(model, 'Developer').parent, 'Company.Engineering.Backend');
  assert.equal(card(model, 'Designer').parent, 'Company.Engineering.Frontend');
  const partial = parse('namespace Company.Engineering {\n class TechLead\n}').model;
  assert.deepEqual(partial.frames.map((entry) => entry.id), ['Company', 'Company.Engineering'], 'ancestors are filled in');
  assert.equal(frame(partial, 'Company.Engineering').depth, 1);
});

// Intent: syntactic nesting prefixes the parent id, exactly like Mermaid's namespaceStack.
test('syntactically nested namespaces qualify their ids against the open frame', () => {
  const { model, blocking } = parse(`namespace Platform {
    namespace Auth {
        class UserService {
            +login()
        }
    }
    namespace Data {
        class Repository
    }
    class Gateway {
        +route()
    }
}
Gateway --> UserService : delegates`);
  assert.deepEqual(blocking, []);
  assert.deepEqual(model.frames.map((entry) => [entry.id, entry.parent, entry.depth]), [
    ['Platform', null, 0],
    ['Platform.Auth', 'Platform', 1],
    ['Platform.Data', 'Platform', 1],
  ]);
  assert.equal(card(model, 'UserService').parent, 'Platform.Auth');
  assert.equal(card(model, 'Gateway').parent, 'Platform');
  assert.deepEqual(model.edges.map((edge) => [edge.from, edge.to, edge.label]), [['Gateway', 'UserService', 'delegates']]);
});

// Intent: a namespaced label replaces the frame title while the id stays qualified.
test('a namespace label replaces the frame title only', () => {
  const { model } = parse('namespace Auth["Authentication Service"] {\n class UserService\n}');
  assert.deepEqual(model.frames, [{ id: 'Auth', label: 'Authentication Service', parent: null, depth: 0, line: 2 }]);
  assert.equal(card(model, 'UserService').parent, 'Auth');
});

// Intent: `direction` applies wherever it is written on a top-level line, and defaults to TB.
test('direction accepts all four values anywhere on a top-level line', () => {
  for (const value of ['TB', 'BT', 'RL', 'LR']) assert.equal(parse(`class A\ndirection ${value}`).model.direction, value);
  assert.equal(parse('direction RL %% the request\nclass A').model.direction, 'RL');
  assert.equal(parse('class A').model.direction, 'TB', 'the default is TB');
  // Inside a class body the whole line is a member (classDiagram.jison:86), so no direction change happens.
  const inBody = parse('class A {\n direction LR\n}');
  assert.equal(inBody.model.direction, 'TB');
  assert.deepEqual(rowsOf(inBody.model, 'A'), [['direction LR']]);
});

// Intent: `%%` is a comment wherever it starts outside quotes, and entity codes stay user text.
test('comments are stripped outside quotes while entities survive', () => {
  const { model, blocking } = parse([
    'class A %% trailing comment',
    'A : +String name %% member comment',
    'class B["a %% b"]',
    'A : +String quoted %% comment',
  ].join('\n'));
  assert.deepEqual(blocking, []);
  assert.equal(card(model, 'B').title, 'a %% b');
  assert.deepEqual(rowsOf(model, 'A'), [['+String name', '+String quoted']]);
});

// Intent: `hideEmptyMembersBox: true` removes the empty band, and false keeps it: the one config switch that
// changes what is drawn.
test('hideEmptyMembersBox drops the empty member band only when the config says so', () => {
  const source = 'class Duck\nclass Annotated <<interface>>\nclass Filled {\n +int x\n}';
  const shown = parse(source).model;
  assert.deepEqual(card(shown, 'Duck').sections, [[], []]);
  const hidden = parse(source, { config: { class: { hideEmptyMembersBox: true } } }).model;
  assert.deepEqual(card(hidden, 'Duck').sections, [], 'a name-only class draws one band');
  assert.deepEqual(card(hidden, 'Annotated').annotations, [{ text: 'interface' }]);
  assert.deepEqual(card(hidden, 'Annotated').sections, []);
  assert.deepEqual(card(hidden, 'Filled').sections, [[{ text: '+int x' }], []], 'members are never dropped');
  // A text value and a differently-cased key read the same, so a front-matter subset can hand either one over.
  assert.deepEqual(card(parse(source, { config: { Class: { hideemptymembersbox: 'true' } } }).model, 'Duck').sections, []);
  assert.deepEqual(card(parse(source, { config: { class: { hideEmptyMembersBox: 'false' } } }).model, 'Duck').sections, [[], []]);
});

// Intent: `hierarchicalNamespaces: false` keeps only the declared frames and lifts classes to their nearest
// declared ancestor, while the default draws every segment.
test('hierarchicalNamespaces picks flat versus nested frames', () => {
  const source = 'namespace Company.Engineering.Backend {\n class Developer\n}\nnamespace Company {\n class CEO\n}';
  const nested = parse(source).model;
  assert.deepEqual(nested.frames.map((entry) => entry.id), ['Company', 'Company.Engineering', 'Company.Engineering.Backend']);
  assert.equal(card(nested, 'Developer').parent, 'Company.Engineering.Backend');
  const flat = parse(source, { config: { class: { hierarchicalNamespaces: false } } }).model;
  assert.deepEqual(flat.frames, [
    { id: 'Company', label: 'Company', parent: null, depth: 0, line: 2 },
    { id: 'Company.Engineering.Backend', label: 'Company.Engineering.Backend', parent: null, depth: 0, line: 2 },
  ], 'undeclared ancestors become no frame and a declared one keeps its qualified title');
  assert.equal(card(flat, 'Developer').parent, 'Company.Engineering.Backend', 'the declared parent is itself');
  assert.equal(card(flat, 'CEO').parent, 'Company');
});

// Intent: a class whose only namespace is an auto-created ancestor is lifted to the nearest declared one.
test('compact namespaces lift a class to its nearest declared ancestor', () => {
  const { model } = parse('namespace A.B.C {\n class Deep\n}\nnamespace A {\n class Top\n}', { config: { class: { hierarchicalNamespaces: false } } });
  assert.deepEqual(model.frames.map((entry) => [entry.id, entry.parent]), [['A', null], ['A.B.C', null]]);
  assert.equal(card(model, 'Deep').parent, 'A.B.C');
  const orphan = parse('namespace A.B {\n class Deep\n}', { config: { class: { hierarchicalNamespaces: false } } }).model;
  assert.deepEqual(orphan.frames.map((entry) => entry.id), ['A.B']);
  assert.equal(card(orphan, 'Deep').parent, 'A.B');
  const unparented = parse('namespace A.B {\n class Deep\n}\nnamespace A.B {\n class Other\n}', { config: { class: { hierarchicalNamespaces: false } } }).model;
  assert.deepEqual(unparented.frames.map((entry) => entry.id), ['A.B'], 'a redeclaration promotes the ancestor and does not duplicate it');
});

// Intent: a relation endpoint that was never declared still becomes a card, so no relation is lost.
test('undeclared relation endpoints become name-only cards', () => {
  const { model, blocking } = parse('ghost <|-- phantom\nghost --> declared\nclass declared');
  assert.deepEqual(blocking, []);
  assert.deepEqual(model.cards.map((entry) => entry.id), ['ghost', 'phantom', 'declared']);
  assert.deepEqual(card(model, 'ghost').sections, [[], []]);
  assert.deepEqual(model.edges.map((edge) => [edge.from, edge.to]), [['ghost', 'phantom'], ['ghost', 'declared']]);
});

// Intent: a generic written only on a relation endpoint still titles the card, so the type is not dropped.
test('a generic on a relation endpoint reaches the card title', () => {
  const { model, blocking } = parse('class Holder\nHolder --> Wrapper~Shape~');
  assert.deepEqual(blocking, []);
  assert.equal(card(model, 'Wrapper').title, 'Wrapper<Shape>');
});

// Intent: class styles cascade, URLs stay clickable, and only unsupported assets, styles and callbacks warn.
test('class presentation honors styles, links and known icons', () => {
  const source = [
    'class Animal:::someclass {',
    ' -int sizeInFeet',
    '}',
    'class Mineral',
    'style Mineral fill:#bbf,stroke:#f66,stroke-width:4px',
    'classDef someclass fill:#f96',
    'cssClass "Animal,Mineral" someclass',
    'Animal:::extra',
    'link Animal "https://example.com" "tip"',
    'click Mineral href "https://example.com"',
    'callback Animal "notify"',
    'Animal::icon(fa fa-book)',
    'Mineral::icon(not-a-real-icon)',
  ].join('\n');
  const { model, errors, blocking } = parse(source);
  assert.deepEqual(blocking, [], 'phase 2 statements never block');
  const codes = errors.filter((item) => item.severity === 'warning').map((item) => item.code);
  assert.deepEqual(codes.sort(), ['IGNORED_ASSET', 'IGNORED_INTERACTION', 'IGNORED_STYLE'], 'one warning per subject, not per line');
  const style = errors.find((item) => item.code === 'IGNORED_STYLE');
  assert.equal(style.line, 6);
  assert.equal(card(model, 'Animal').link.href, 'https://example.com');
  assert.ok(card(model, 'Animal').icon?.elements.length);
  assert.ok(card(model, 'Mineral').tone);
  assert.equal(card(model, 'Mineral').icon, undefined);
  assert.deepEqual(model.cards.map((entry) => entry.id), ['Animal', 'Mineral'], '::: names never become cards');
  assert.deepEqual(rowsOf(model, 'Animal'), [['-int sizeInFeet']], 'the body after ::: still parses');
});

// Intent: a class that was never defined does not change the card or generate warnings.
test('an undefined style class is silently ignored', () => {
  const { model, blocking, errors } = parse('class Animal:::styleClass');
  assert.deepEqual(blocking, []);
  assert.deepEqual(model.cards.map((entry) => entry.id), ['Animal']);
  assert.deepEqual(errors, []);
});

// Intent: accessibility statements and their multi-line body belong to shared infrastructure.
test('accTitle and accDescr blocks are skipped instead of being read as statements', () => {
  const source = ['classDiagram', 'accTitle: a title', 'accDescr {', 'line one', '}', 'accDescr: single', 'class A'].join('\n');
  const { model, blocking } = parse(source);
  assert.deepEqual(blocking, []);
  assert.deepEqual(model.cards.map((entry) => entry.id), ['A']);
});

// Intent: unrecognized statements, unclosed blocks and header options fail with the source line, never silently.
test('invalid input reports the source line and keeps the partial model', () => {
  const junk = parse('class A\nthis is not a statement');
  assert.equal(junk.blocking.length, 1);
  assert.equal(junk.blocking[0].line, 3);
  const classBlock = parse('class A {\n +int x');
  assert.equal(classBlock.blocking[0].line, 2, 'an unclosed class block points at its opening line');
  assert.equal(classBlock.model.cards.length, 1, 'the partially read card is still returned');
  const namespaceBlock = parse('namespace N {\n class A');
  assert.equal(namespaceBlock.blocking[0].line, 2);
  const note = parse('note without quotes');
  assert.equal(note.blocking.length, 1);
  assert.match(note.blocking[0].message, /double quotes/);
  const options = parse('class A', { options: { direction: 'LR' } });
  assert.equal(options.blocking.length, 1);
  assert.equal(options.blocking[0].line, 1, 'header options are rejected on the header line');
});

// Intent: a stray `}` is an error where it appears, and a nested brace inside a body is reported, because
// Mermaid's lexer emits OPEN_IN_STRUCT which no production accepts (classDiagram.jison:85).
test('stray braces are reported instead of shifting the block state', () => {
  const stray = parse('class A\n}');
  assert.equal(stray.blocking.length, 1);
  assert.equal(stray.blocking[0].line, 3);
  const nested = parse('class A {\n int x {\n}');
  assert.ok(nested.blocking.some((item) => item.line === 3), 'a nested brace inside a body is reported');
  // A member on the opening line is accepted: the class-body state reads it before `}` (jison:81-87).
  const inline = parse('class A { +int x }');
  assert.deepEqual(inline.blocking, []);
  assert.deepEqual(rowsOf(inline.model, 'A'), [['+int x']]);
});

// Intent: a `note for` naming no class leaves the note visible and warns instead of inventing an edge.
test('a note for an unknown class warns without an edge', () => {
  const { model, errors, blocking } = parse('note for Nobody "text"');
  assert.deepEqual(blocking, []);
  assert.deepEqual(model.edges, []);
  const hint = errors.find((item) => item.code === 'DIAGRAM_HINT');
  assert.equal(hint.severity, 'warning');
  assert.equal(hint.line, 2);
});

// Intent: a big class set still renders but warns once; only the runtime work caps are hard errors.
test('many cards warn once with LARGE_DIAGRAM and stay under the hard cap', () => {
  const source = Array.from({ length: limits.large + 1 }, (_, index) => `class C${index}`).join('\n');
  const { model, errors, blocking } = parse(source);
  assert.deepEqual(blocking, []);
  assert.equal(model.cards.length, limits.large + 1);
  const large = errors.filter((item) => item.code === 'LARGE_DIAGRAM');
  assert.equal(large.length, 1);
  assert.equal(large[0].severity, 'warning');
  assert.equal(large[0].line, 2);
});

// Intent: the parser accepts the registry's raw-body form too, so the two call shapes cannot diverge.
test('a raw body string parses exactly like prepared statements', () => {
  const source = 'classDiagram\nclass A {\n +int x\n}\nA <|-- B';
  const prepared = prepareSource(source, { syntax: 'mermaid', lang: 'en' });
  const fromBody = parseClass(prepared.body, { lang: 'en', firstLine: prepared.firstLine, options: {} });
  const { statements, firstLine } = body(source);
  const fromStatements = parseClass(statements, { lang: 'en', firstLine, options: {} });
  assert.deepEqual(fromBody.model, fromStatements.model);
});

// Intent: source line numbers reach every card, frame and edge, so diagnostics can point at the real line.
test('cards, frames and edges carry their source lines', () => {
  const { model } = parse('class A\nnamespace N {\n class B\n}\nA --> B : uses\nnote for A "n"');
  assert.deepEqual(model.cards.map((entry) => [entry.id, entry.line]), [['A', 2], ['B', 4], ['note0', 7]].sort((a, b) => a[1] - b[1]));
  assert.equal(frame(model, 'N').line, 3);
  assert.deepEqual(model.edges.map((entry) => entry.line), [6, 7]);
});
