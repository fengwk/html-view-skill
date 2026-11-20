import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { implementations } from '../src/diagram/railroad.js';
import { createDiagramApi } from '../src/diagram/registry.js';
import { checkScene } from './helpers/geometry.mjs';

const api = createDiagramApi(implementations, Object.keys(implementations).map(kind => ({ kind, syntax: 'mermaid', topic: 'data-model', aliases: [] })));
const source = (dialect, body) => `railroad${dialect ? `-${dialect}` : ''}-beta\n${body}`;
const parse = (dialect, body) => api.parse(source(dialect, body), { lang: 'en' });
function model(dialect, body) {
  const result = parse(dialect, body);
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error'), []);
  return result.model;
}
const ebnf = expr => model('ebnf', `a = ${expr};`).rules[0].definition;
const corpus = JSON.parse(readFileSync(new URL('./conformance/mermaid-12.3.0.json', import.meta.url), 'utf8'));
const example = line => corpus.find(item => item.id === `railroad.md:${line}`).source;

// ISO and W3C syntactic sugar, transparent groups and comments produce identical tracks.
test('EBNF normalizes equivalent forms', () => {
  for (const [a, b] of [['"a" "b"', '"a", "b"'], ['["a"]', '"a"?'], ['{"a"}', '"a"*'], ['(("a"))', '"a"'], ['(* x *) "a" /* y */', '"a"']]) {
    assert.deepEqual(ebnf(a), ebnf(b));
  }
  assert.deepEqual(model('ebnf', 'a ::= "a";').rules[0].definition, ebnf('"a"'));
  assert.equal(api.diagram(source('ebnf', 'a = ["a"] {"b"};')).svg, api.diagram(source('ebnf', 'a = "a"? "b"*;')).svg);
});

// EBNF postfixes apply left-to-right and the exception preserves both operands and the operator.
test('EBNF postfix chains, specials and exceptions', () => {
  assert.equal(ebnf('"a"+').min, 1);
  const nested = ebnf('"a"?*');
  assert.equal(nested.type, 'repetition');
  assert.equal(nested.min, 0);
  assert.equal(nested.element.type, 'optional');
  assert.deepEqual(ebnf('?  scanner callback  ?'), { type: 'special', text: 'scanner callback' });
  assert.equal(ebnf('"a"? ?').element.type, 'optional');
  assert.deepEqual(ebnf('"a" - "b"').elements.map(node => node.value), ['a', '-', 'b']);
});

// Invalid separators and literals report an actionable source location instead of partial output.
test('EBNF rejects malformed rule boundaries and strings', () => {
  assert.equal(parse('ebnf', 'a = "a"').diagnostics[0].code, 'railroad.rule-expected');
  const [error] = parse('ebnf', '\n  a = "a').diagnostics;
  assert.deepEqual([error.code, error.line, error.column], ['railroad.unterminated-string', 3, 7]);
  assert.equal(parse('ebnf', 'a = "a",;').diagnostics[0].severity, 'error');
  assert.equal(parse('ebnf', 'a = ? ?;').diagnostics[0].severity, 'error');
});

// ABNF retains range and exact count bounds and normalizes both optional spellings.
test('ABNF counts, groups and verbatim numeric terminals', () => {
  const { elements } = model('abnf', 'a = 1*("a") *("a") 2*4("a") 3"a" ["a"] 0*1"a" %x30-39 %d65 %b1000001;').rules[0].definition;
  assert.deepEqual(elements.slice(0, 4).map(({ min, max }) => [min, max]), [[1, Infinity], [0, Infinity], [2, 4], [3, 3]]);
  assert.deepEqual(elements[4], elements[5]);
  assert.equal(elements[4].type, 'optional');
  assert.deepEqual(elements.slice(6).map(({ value }) => value), ['%x30-39', '%d65', '%b1000001']);
  const { svg } = api.diagram(source('abnf', 'a = 2*4"a" 3"b";'));
  assert.match(svg, />2…4<.*>×3</);
});

// A terminating semicolon may introduce a comment, but a comment alone is not a rule or a missing terminator.
test('ABNF separators and dialect diagnostics', () => {
  const { rules } = model('abnf', '; leading\na = "x;y"; trailing comment\nb = A / "b";');
  assert.deepEqual(rules.map(rule => rule.name), ['a', 'b']);
  assert.equal(rules[0].definition.value, 'x;y');
  assert.equal(rules[1].definition.alternatives[0].undefined, undefined);
  const [error] = parse('abnf', 'a = "a" | "b";').diagnostics;
  assert.equal(error.code, 'railroad.abnf-unsupported');
  assert.match(error.fix, /Use \//);
  assert.equal(parse('abnf', 'a = "a"').diagnostics[0].code, 'railroad.rule-expected');
  assert.equal(parse('abnf', 'a = 4*2"a";').diagnostics[0].code, 'railroad.abnf-bad-repeat');
});

// PEG lookahead is non-consuming, grouping is transparent, and the order of alternatives survives.
test('PEG predicates, any-character and ordered choice', () => {
  const { rules } = model('peg', '# comment\na <- !Keyword Letter Letter* / (&a ((.)) / \'text\');');
  const [first, rest] = rules[0].definition.alternatives;
  assert.deepEqual(first.elements.map(node => node.text ?? node.name ?? node.min), ['!Keyword', 'Letter', 0]);
  assert.deepEqual(rest.alternatives[0].elements.map(node => node.text), ['&a', '.']);
  assert.equal(rest.alternatives[1].value, 'text');
  const flattened = parse('peg', 'a <- &("a" / "b");');
  assert.equal(flattened.model.rules[0].definition.text, '&(...)');
  assert.equal(flattened.diagnostics[0].code, 'DIAGRAM_HINT');
});

// Wrong-dialect syntax is an error with the PEG spelling in its repair guidance.
test('PEG operator and grouping hints', () => {
  const [operator] = parse('peg', 'a = "a";').diagnostics;
  assert.equal(operator.code, 'railroad.peg-bad-operator');
  assert.match(operator.fix, /<-/);
  assert.equal(parse('peg', 'a <- [a];').diagnostics[0].code, 'railroad.peg-unsupported');
});

// All eight constructor forms reduce to the same AST, including singleton containers.
test('IR multiline constructors and arity', () => {
  const { rules } = model('', 'a = sequence(\nchoice(terminal("x")), nonterminal("a"),\noptional(zeroOrMore(terminal("y"))), oneOrMore(special("1*3")));');
  const [x, a, nested, repeated] = rules[0].definition.elements;
  assert.deepEqual(x, { type: 'terminal', value: 'x' });
  assert.equal(a.type, 'nonterminal');
  assert.deepEqual([nested.type, nested.element.min, repeated.min, repeated.element.text], ['optional', 0, 1, '1*3']);
  assert.deepEqual(model('', 'a = sequence(terminal("x"));').rules[0].definition, x);
  assert.equal(parse('', 'a = terminal("x",);').diagnostics[0].code, 'railroad.ir-arity');
  assert.equal(parse('', 'a = sequence(terminal("x"),);').diagnostics[0].severity, 'error');
  assert.equal(parse('', 'a = unknown("x");').diagnostics[0].code, 'railroad.ir-unknown-constructor');
});

// Repeated subjects warn once at their first position; duplicate rule bodies remain visible.
test('duplicate rules and undefined references are non-blocking', () => {
  const input = source('ebnf', 'a = b b;\na = b;\na = "last";');
  const diagram = api.diagram(input, { lang: 'en' });
  assert.deepEqual(diagram.diagnostics.map(d => [d.severity, d.line, d.column]), [['warning', 3, 1], ['warning', 2, 5]]);
  assert.equal((diagram.svg.match(/>a =</g) || []).length, 3);
  assert.match(diagram.svg, />last</);
});

// The header can share a line with grammar text and accessibility metadata is not a painted label.
test('railroad title and accessibility', () => {
  const input = 'railroad-ebnf-beta title "Greeting"\naccTitle: A grammar\naccDescr {\nTwo symbols\n}\na = "x" "y";';
  const { scene, svg } = api.diagram(input);
  assert.equal(scene.heading, 'Greeting');
  assert.match(svg, /<title[^>]*>A grammar<\/title><desc>Two symbols<\/desc>/);
});

// The real JSON example exercises nested bypass/return arcs, and the digit rule keeps ten separate lanes.
test('nested and ten-lane corpus layouts pass geometry', () => {
  assert.equal(api.parse(example(175)).model.rules.length, 5);
  for (const line of [164, 175]) {
    const { scene, svg } = api.diagram(example(line), { width: 360 });
    assert.deepEqual(checkScene(scene), []);
    assert.equal(api.diagram(example(line), { width: 360 }).svg, svg);
    if (line === 164) {
      const digits = [...svg.matchAll(/<text[^>]* y="(\d+(?:\.\d+)?)"[^>]*>[0-9]<\/text>/g)].map(match => Number(match[1]));
      assert.equal(digits.length, 10);
      assert.ok(digits.every((y, i) => i === 0 || y - digits[i - 1] >= 28));
    }
  }
});

// One fixture crosses the shared config, decoration and safe SVG contracts without changing grammar values.
test('shared railroad config, labels, status and links', () => {
  const input = [
    '---', 'config:', '  railroad:', '    fontSize: 8', '    terminalFill: red', '---',
    '%%{init: {"railroad": {"showMarkers": false, "compactMode": true, "arcRadius": 16}}}%%',
    'railroad-ebnf-beta',
    'phrase = word:::active::icon(plug) ["<b>hello</b> &amp; logos:github"] {"again" | "more"};',
    'word = "fa:fa-kchart-does-not-exist word";',
    'classDef active fill:#0a0,stroke-width:2;',
    'linkStyle default stroke:#00f;',
    'click word href "https://example.com" "Word reference" _blank;',
    'click phrase href "javascript:alert(1)";',
  ].join('\n');
  const parsed = api.parse(input, { lang: 'en' });
  const [ref, opt] = parsed.model.rules[0].definition.elements;
  assert.equal(ref.status, 'ok');
  assert.ok(ref.icon);
  assert.ok(opt.element.icon);
  assert.equal(opt.element.value, '<b>hello</b> &amp; logos:github');
  assert.equal(opt.element.label, 'hello &');
  const { scene, svg, diagnostics } = api.diagram(input, { width: 360, lang: 'en' });
  assert.deepEqual(diagnostics.map(item => item.code).sort(), ['IGNORED_ASSET', 'IGNORED_CONFIG', 'IGNORED_INTERACTION', 'IGNORED_STYLE']);
  assert.match(svg, /href="https:\/\/example.com"[^>]*rel="noopener noreferrer"/);
  assert.match(svg, /font-size="12"[^>]*>hello &amp;</);
  assert.doesNotMatch(svg, /<circle[^>]* r="4"|javascript:|kchart-does-not-exist/);
  assert.deepEqual(checkScene(scene), []);
});

// A literal that cannot fit is not wrapped or shrunk; width does not alter the natural rail composition.
test('wide tracks scroll and over-deep expressions are bounded', () => {
  const input = source('ebnf', `a = "${'wide'.repeat(55)}";`);
  const narrow = api.diagram(input, { width: 360 });
  const wide = api.diagram(input, { width: 800 });
  assert.ok(narrow.scene.width > 800);
  assert.equal(narrow.svg, wide.svg);
  assert.equal(narrow.diagnostics[0].code, 'LARGE_DIAGRAM');
  assert.deepEqual(checkScene(narrow.scene), []);
  assert.equal(parse('ebnf', `a = ${'('.repeat(30)}"a"${')'.repeat(30)};`).diagnostics[0].code, 'railroad.depth-limit');
});
