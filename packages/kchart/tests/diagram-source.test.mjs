import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as Source from '../src/diagram/source.js';
import { labelText } from '../src/diagram/support.js';

// Front matter delimiters and documented settings retain original physical lines.
test('prepareSource handles leading blanks, the legacy delimiter and mindmap config', () => {
  const result = Source.prepareSource('\n---\ntitle: "申请流程"\nconfig:\n  layout: radial\n  mindmap:\n    colorBy: branch\n...\n%%{init: {"theme": "dark"}}%%\nflowchart LR; A --> B\n  C --> D');
  assert.equal(result.title, '申请流程');
  assert.equal(result.layout, 'radial');
  assert.equal(result.header, 'flowchart LR; A --> B');
  assert.equal(result.headerLine, 10);
  assert.equal(result.firstLine, 11);
  assert.equal(result.kind, 'flowchart');
  assert.equal(result.params, 'LR; A --> B');
  assert.equal(result.body, '  C --> D');
  assert.deepEqual(result.config, { layout: 'radial', mindmap: { colorBy: 'branch' }, theme: 'dark' });
  assert.deepEqual(result.configLines, { layout: 5, mindmap: 6, 'mindmap.colorby': 7, theme: 9 });
  assert.deepEqual(result.errors, []);
});

// Malformed YAML remains blocking and reports the offending physical line and column.
test('prepareSource reports duplicate keys, bad indentation and unclosed flow collections', () => {
  for (const [yaml, line, column] of [
    ['title: one\ntitle: two', 3, 1],
    ['config:\n  layout: right\n  layout: left', 4, 3],
    ['config:\n  look: classic\n theme: default', 4, 2],
    ['config: { theme: default', 2, 25],
  ]) {
    const result = Source.prepareSource(`---\n${yaml}\n---\nflowchart TB`);
    assert.deepEqual(result.errors.map(d => [d.line, d.column, d.severity]), [[line, column, 'error']]);
  }
});

// YAML preserves original case and typed values through nested block and flow collections.
test('prepareSource reads YAML collections, scalars, comments and gantt displayMode', () => {
  const result = Source.prepareSource(`---
    title: 'It''s #literal' # ignored
    displayMode: compact
    config:
      ThemeVariables: { color: '#fff', scale: [1.5, -2e1, true, null] }
      entries:
        - label: plain item
          opts: [false, "line\\nbreak"]
        - 'x'
---
gantt`);
  assert.deepEqual(result.errors, []);
  assert.equal(result.title, "It's #literal");
  assert.deepEqual(result.config, {
    ThemeVariables: { color: '#fff', scale: [1.5, -20, true, null] },
    entries: [{ label: 'plain item', opts: [false, 'line\nbreak'] }, 'x'],
    gantt: { displayMode: 'compact' },
  });
  assert.equal(result.configLines['themevariables.scale'], 5);
  assert.equal(result.configLines['entries.0.opts'], 8);
  assert.equal(result.configLines['gantt.displaymode'], 3);
});

// Directives deep-merge in source order and warn without blocking on invalid or unknown syntax.
test('prepareSource merges init, initialize and wrap while removing directive rows', () => {
  const result = Source.prepareSource(`---
config: {sequence: {mirrorActors: true, width: 100}, theme: default}
---
%%{init: {'theme': 'dark', 'sequence': {'width': 200}}}%%
sequenceDiagram
%%{initialize: {
  'sequence': {'width': 300, 'note': 'literal }%% text'}
}}%%
%%{wrap}%%
%%{init: {notJSON: true}}%%
%%{unknown}%%
A->>B: hello`);
  assert.equal(result.headerLine, 5);
  assert.equal(result.firstLine, 6);
  assert.equal(result.body, '\n'.repeat(6) + 'A->>B: hello');
  assert.deepEqual(result.config, { sequence: { mirrorActors: true, width: 300, note: 'literal }%% text' }, theme: 'dark', wrap: true });
  assert.equal(result.configLines['sequence.width'], 7);
  assert.equal(result.configLines['sequence.mirroractors'], 2);
  assert.deepEqual(result.errors.map(d => [d.code, d.severity, d.line]), [['IGNORED_CONFIG', 'warning', 10]]);
  assert.match(result.errors[0].message, /init.*unknown/);
  const inline = Source.prepareSource(`%%{init: {'theme': 'unterminated}}%%
flowchart TB %%{wrap}%%%%{init: {'look': 'classic'}}%%
A --> B`);
  assert.equal(inline.header, 'flowchart TB');
  assert.deepEqual(inline.config, { wrap: true, look: 'classic' });
  assert.equal(inline.errors[0].line, 1);
});

// Header options remain raw for optionMode dispatch, including semicolon-separated statements.
test('prepareSource preserves the full header and raw params', () => {
  const result = Source.prepareSource('flowchart LR; A --> B\n  unknown statement\n  C --> D');
  assert.equal(result.kind, 'flowchart');
  assert.equal(result.header, 'flowchart LR; A --> B');
  assert.equal(result.params, 'LR; A --> B');
  assert.equal(result.body, '  unknown statement\n  C --> D');
  assert.deepEqual(result.errors, []);
});

// Only explicit quoted-backtick Mermaid Markdown is normalized, with physical-line padding.
test('prepareSource normalizes multiline Markdown but preserves other quoted text', () => {
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

// Presentation and class grammar both pass source preparation unchanged for registry dispatch.
test('prepareSource leaves class statements alone', () => {
  const classes = Source.prepareSource('classDiagram\n  class A {\n    +String click\n  }\n  class B');
  assert.equal(classes.body, '  class A {\n    +String click\n  }\n  class B');
  assert.deepEqual(classes.errors, []);
  const styleClass = Source.prepareSource('flowchart TB\n  class A danger');
  assert.deepEqual(styleClass.errors, []);
  assert.equal(styleClass.body, '  class A danger');
});

// Comments strip only outside quotes; accessibility statements do not move subsequent rows.
test('prepareSource strips comments and blanks accessibility rows', () => {
  const result = Source.prepareSource(`%% heading comment
flowchart TB %% header comment
  A["quoted %% content"] --> B %% trailing
  B['single %% quoted'] --> C
  accTitle: Read me %% comment
  accDescr {
First line
Second line
  } %% comment
  C --> D`);
  assert.equal(result.header, 'flowchart TB');
  assert.equal(result.firstLine, 3);
  assert.equal(result.accTitle, 'Read me');
  assert.equal(result.accDescr, 'First line\nSecond line');
  assert.deepEqual(result.body.split('\n'), ['  A["quoted %% content"] --> B', "  B['single %% quoted'] --> C", '', '', '', '', '', '  C --> D']);
  assert.equal(Source.prepareSource('flowchart LR\naccDescr: Short description').accDescr, 'Short description');
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
  assert.deepEqual(parsed.errors.map(({ line }) => line), [4, 4]);
});
