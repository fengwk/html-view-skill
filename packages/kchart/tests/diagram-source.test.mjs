import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as Source from '../src/diagram/source.js';
import { labelText } from '../src/diagram/support.js';

// Front matter delimiters and nested documented settings must retain original physical lines.
test('prepareSource handles leading blanks, legacy closing delimiter and nested mindmap config', () => {
  const result = Source.prepareSource('\n---\ntitle: "申请流程"\nconfig:\n  layout: radial\n  mindmap:\n    colorBy: branch\n...\n%%{init: {theme: dark}}%%\nflowchart LR; A --> B\n  C --> D');
  assert.equal(result.title, '申请流程');
  assert.equal(result.layout, 'radial');
  assert.equal(result.header, 'flowchart LR; A --> B');
  assert.equal(result.headerLine, 10);
  assert.equal(result.firstLine, 11);
  assert.equal(result.kind, 'flowchart');
  assert.equal(result.params, 'LR; A --> B');
  assert.equal(result.body, '  C --> D');
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 9);
  assert.match(result.errors[0].fix, /前言区/);
});

// Duplicate front matter keys and undocumented config must identify their actual key columns.
test('prepareSource diagnoses duplicate title/layout and unknown config at source positions', () => {
  const result = Source.prepareSource('---\ntitle: one\ntitle: two\nconfig:\n  layout: right\n  layout: left\n  unknown: value\n---\nflowchart TB');
  assert.deepEqual([...result.errors].map(({ line, column }) => [line, column]), [[3, 1], [6, 3], [7, 3]]);
  assert.equal(result.title, 'one');
  assert.equal(result.layout, 'right');
});

// A rejected leading directive is reported once and skipped so the actual graph declaration is still found.
test('prepareSource skips single- and multiline directives before the graph header', () => {
  const result = Source.prepareSource('%%{init:\n  theme: dark\n}%%\nflowchart TB\n  A --> B');
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 1);
  assert.match(result.errors[0].fix, /前言区/);
  assert.equal(result.header, 'flowchart TB');
  assert.equal(result.headerLine, 4);
  assert.equal(result.firstLine, 5);
  assert.equal(result.body, '  A --> B');

  const single = Source.prepareSource('%%{init: {theme: dark}}%%\nflowchart TB');
  assert.equal(single.errors.length, 1);
  assert.equal(single.headerLine, 2);

  const inBody = Source.prepareSource('flowchart TB\n%%{init: {theme: dark}}%%\n  A --> B\n%%{init:\n  theme: dark\n}%%\n  C --> D');
  assert.deepEqual([...inBody.errors].map(({ line }) => line), [2, 4]);
  assert.equal(inBody.body, '\n  A --> B\n\n\n\n  C --> D');
});

// Header options remain raw for optionMode dispatch; semicolon-separated Mermaid statements are not token-validated here.
test('prepareSource preserves the full header and raw params including semicolon statements', () => {
  const result = Source.prepareSource('flowchart LR; A --> B\n  unknown statement\n  C --> D');
  assert.equal(result.kind, 'flowchart');
  assert.equal(result.header, 'flowchart LR; A --> B');
  assert.equal(result.params, 'LR; A --> B');
  assert.equal(result.body, '  unknown statement\n  C --> D');
  assert.deepEqual([...result.errors], []);
});

// Only explicit quoted-backtick Mermaid Markdown is normalized; merged physical rows are padded for downstream line numbers.
test('prepareSource normalizes multiline explicit Markdown but preserves other quoted text verbatim', () => {
  const result = Source.prepareSource('flowchart TB\n  A["`**first\nsecond *word***`"] --> B\n  C --> D\n  style[标签] --> E');
  assert.equal(result.body, '  A["first<br/>second word"] --> B\n\n  C --> D\n  style[标签] --> E');
  assert.equal(result.errors.length, 0);
  assert.equal(result.firstLine, 2);
  assert.equal(result.body.split('\n').length, 4);
  assert.equal(labelText('A<br/>B'), 'A\nB');

  const ordinary = Source.prepareSource('flowchart TB\n  A["click *literal* **text**"] --> B');
  assert.equal(ordinary.body, '  A["click *literal* **text**"] --> B');
  assert.equal(ordinary.errors.length, 0);
  const native = Source.prepareSource('flowchart TB\n  A["`**native**`"]', { syntax: 'flowchart' });
  assert.equal(native.body, '  A["`**native**`"]');
});

// classDiagram owns class declarations; Mermaid style-class declarations elsewhere are forbidden, while ordinary style-like IDs remain untouched.
test('prepareSource distinguishes classDiagram grammar from generic style declarations', () => {
  const classes = Source.prepareSource('classDiagram\n  class A {\n    +String click\n  }\n  class B');
  assert.equal(classes.body, '  class A {\n    +String click\n  }\n  class B');
  assert.equal(classes.errors.length, 0);

  const styleClass = Source.prepareSource('flowchart TB\n  class A danger');
  assert.equal(styleClass.errors.length, 1);
  assert.equal(styleClass.errors[0].line, 2);
  assert.match(styleClass.errors[0].message, /样式类/);
});

// Native bare source begins at its first physical line; option parsing remains available to the dispatcher.
test('native bare source and parseOptions retain exact values and positions', () => {
  const native = Source.prepareSource('\n  A --> B\n  mystery statement\n', { syntax: 'flowchart' });
  assert.equal(native.kind, 'flowchart');
  assert.equal(native.header, '');
  assert.equal(native.headerLine, 0);
  assert.equal(native.firstLine, 2);
  assert.equal(native.body, '  A --> B\n  mystery statement\n');

  const parsed = Source.parseOptions(['layout=radial', 'debug', 'name="two words"', 'layout=left', 'bad!'], { line: 4 });
  assert.equal(parsed.options.layout, 'radial');
  assert.equal(parsed.options.debug, true);
  assert.equal(parsed.options.name, 'two words');
  const fromText = Source.parseOptions('layout=radial title="two words"', { line: 2 });
  assert.equal(fromText.options.title, 'two words');
  assert.equal(parsed.errors.length, 2);
  assert.deepEqual([...parsed.errors].map(({ line }) => line), [4, 4]);
});
