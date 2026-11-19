import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ExpectedDiagnostic } from '../src/core/diagnostics.js';
import { createDiagramApi } from '../src/diagram/registry.js';

function implementation(overrides = {}) {
  return {
    parse(body, info) {
      if (body === 'invalid') return { model: null, errors: [{ line: info.firstLine, column: 2, message: 'bad body', fix: 'repair' }] };
      return { model: { text: body.trim() }, errors: [] };
    },
    layout(model, { width, ctx, renderOptions }, info) {
      return { width: width < 80 ? 120 : 80, height: 40, model, frame: renderOptions.frame, title: info.title, scene: { width: width < 80 ? 120 : 80, height: 40, children: [ctx.text(10, 20, model.text)] } };
    },
    ...overrides,
  };
}
const types = [
  { kind: 'flowchart', syntax: 'mermaid', aliases: ['graph'], topic: 'flow' },
  { kind: 'mindmap', syntax: 'native', aliases: [], topic: 'mind' },
  { kind: 'rawmap', syntax: 'mermaid', aliases: [], topic: 'raw' },
];

// 意图：检查别名归一、原始诊断行列及主题保留；check 不应触发布局。
test('diagram check normalizes aliases and parser diagnostics without layout', () => {
  let layouts = 0;
  const api = createDiagramApi({ flowchart: implementation({ layout: () => { layouts++; throw new Error('must not layout'); } }) }, types);
  const diagnostics = api.check('graph\ninvalid');
  assert.deepEqual(JSON.parse(JSON.stringify(diagnostics)), [{ code: 'BAD_DIAGRAM', line: 2, column: 2, message: 'bad body', fix: 'repair', topic: 'flow' }]);
  assert.equal(layouts, 0);
  assert.equal(api.parse('graph\nok').info.kind, 'flowchart');
});

// 意图：共享 SVG 使用 frame/title 与请求宽度；超宽场景扩宽保留。
test('diagram renders one shared SVG with framed title and centered wide scene', () => {
  let calls = 0, frame;
  const impl = implementation({ layout(model, args, info) { calls++; frame = args.renderOptions.frame; return implementation().layout(model, args, info); } });
  const api = createDiagramApi({ flowchart: impl }, types);
  const result = api.diagram('---\ntitle: Overview\n---\ngraph\nHello', { width: 300 });
  assert.equal(calls, 1);
  assert.equal(frame, true);
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.scene.width, 300);
  assert.equal(result.scene.heading, 'Overview');
  assert.match(result.svg, /Overview/);
  assert.match(result.svg, /translate\(110 0\)/);
  const wide = api.diagram('graph\nHello', { width: 50, frame: false });
  assert.equal(wide.scene.width, 120);
  assert.doesNotMatch(api.diagram('---\ntitle: Overview\n---\ngraph\nHello', { width: 300, frame: false }).svg, /<text x="16"/);
});

// 意图：parseOptions 应写入 info.options 并使用 header 行号；raw 模式跳过通用选项解析。
test('parse options feed info at header line and raw implementations bypass them', () => {
  let observed;
  const regular = implementation({ parse(body, info) { observed = info; return { model: {}, errors: [] }; } });
  const raw = implementation({ optionMode: 'raw', parse(body, info) { observed = info; return { model: {}, errors: [] }; } });
  const api = createDiagramApi({ flowchart: regular, rawmap: raw }, types);
  assert.equal(api.check('\ngraph mode=wide\nbody').length, 0);
  assert.equal(observed.options.mode, 'wide');
  assert.deepEqual({ params: observed.params, line: observed.headerLine }, { params: 'mode=wide', line: 2 });
  const [invalid] = api.check('\ngraph ???\nbody');
  assert.equal(invalid.line, 2);
  assert.match(invalid.message, /无效的图选项「\?\?\?」/);
  assert.deepEqual(api.check('rawmap ???\nbody'), []);
  assert.equal(observed.params, '???');
  assert.deepEqual(Object.keys(observed.options), []);
});

// 意图：语义校验纳入 check；诊断位置保真；预期 geometry 错误应早于 scene 创建返回。
test('semantic validation and geometry errors avoid invalid scene creation', () => {
  let sceneCalls = 0, layoutCalls = 0;
  const impl = implementation({
    validate(model) { return [{ code: 'SEMANTIC', line: 7, column: 4, message: 'semantic problem', fix: 'repair', topic: 'semantic-topic' }]; },
    layout() { layoutCalls++; return { errors: [{ code: 'GEOMETRY', line: 8, column: 5, message: 'geometry problem', fix: 'simplify' }] }; },
    scene() { sceneCalls++; throw new Error('must not build scene'); },
  });
  const api = createDiagramApi({ flowchart: impl }, types);
  assert.deepEqual(JSON.parse(JSON.stringify(api.check('graph\nbody'))), [{ code: 'SEMANTIC', line: 7, column: 4, message: 'semantic problem', fix: 'repair', topic: 'semantic-topic' }]);
  assert.equal(api.diagram('graph\nbody').diagnostics[0].code, 'SEMANTIC');
  assert.equal(layoutCalls, 0);
  const geometryImpl = implementation({
    layout() { layoutCalls++; return { errors: [{ code: 'GEOMETRY', line: 8, column: 5, message: 'geometry problem', fix: 'simplify' }] }; },
    scene() { sceneCalls++; throw new Error('must not build scene'); },
  });
  const result = createDiagramApi({ flowchart: geometryImpl }, types).diagram('graph\nbody');
  assert.deepEqual(JSON.parse(JSON.stringify(result.diagnostics)), [{ code: 'GEOMETRY', line: 8, column: 5, message: 'geometry problem', fix: 'simplify', topic: 'flow' }]);
  assert.equal(layoutCalls, 1);
  assert.equal(sceneCalls, 0);
});

// 意图：未知、错用语法、未装入的类型报告真实首行；准备层未知 topic 才补类型 topic。
test('registry diagnostics have header lines and retain declared diagnostic topics', () => {
  const api = createDiagramApi({}, types);
  const unknown = api.check('\nnonsense\nbody')[0];
  const wrongSyntax = api.check('\nmindmap\nbody')[0];
  const missing = api.check('\ngraph\nbody')[0];
  assert.equal(unknown.line, 2);
  assert.equal(wrongSyntax.line, 2);
  assert.equal(missing.line, 2);
  const invalidOption = createDiagramApi({ flowchart: implementation() }, types).check('graph bad ???')[0];
  assert.equal(invalidOption.topic, 'flow');
  assert.equal(invalidOption.line, 1);
  assert.equal(invalidOption.column, 1);
  const providedTopic = implementation({ parse: () => ({ model: {}, errors: [{ line: 9, column: 3, message: 'custom', fix: 'x', topic: 'custom-topic' }] }) });
  assert.equal(createDiagramApi({ flowchart: providedTopic }, types).check('graph\nbody')[0].topic, 'custom-topic');
});

// 意图：居中时 anchor 坐标同步；无显式题名时只设可读标题，不重复画入图框。
test('centering adjusts anchor without inventing a visible heading', () => {
  const impl = implementation({ layout(model, { ctx }) { return { scene: { width: 80, height: 40, title: 'Scene title', anchor: { x: 20, y: 10 }, children: [ctx.text(20, 20, model.text)] } }; } });
  const result = createDiagramApi({ flowchart: impl }, types).diagram('graph\nbody', { width: 300 });
  assert.equal(result.scene.anchor.x, 130);
  assert.equal(result.scene.anchor.y, 10);
  assert.equal(result.scene.title, 'Scene title');
  assert.equal(result.scene.heading, undefined);
  assert.match(result.svg, />Scene title<\/title>/);
  assert.doesNotMatch(result.svg, />Scene title<\/text>/);
});

// 意图：不混淆未知类型、错用 syntax 与未装入类型，且无效输入不产 placeholder SVG。
test('diagram distinguishes unknown type, syntax misuse, and unloaded implementation', () => {
  const api = createDiagramApi({}, types);
  const missing = api.diagram('flowchart\nbody');
  assert.equal(missing.svg, null);
  assert.equal(missing.diagnostics[0].message, '已知图类型「flowchart」尚未装入');
  assert.equal(missing.diagnostics[0].topic, 'flow');
  assert.match(api.check('mindmap\nbody')[0].message, /不支持语法/);
  assert.match(api.check('nonsense\nbody')[0].message, /未知结构图类型/);
  assert.match(api.check('flowchart ???')[0].message, /无效的图选项「\?\?\?」/);
});

// 意图：只将 ExpectedDiagnostic 归一；内部错误应原样上抛。
test('diagram catches only expected diagnostics', () => {
  const expected = createDiagramApi({ flowchart: implementation({ layout() { throw new ExpectedDiagnostic('expected', [{ code: 'LAYOUT', line: 3, message: 'no fit', fix: 'simplify' }]); } }) }, types);
  assert.deepEqual(JSON.parse(JSON.stringify(expected.diagram('flowchart\nbody').diagnostics)), [{ code: 'LAYOUT', line: 3, column: 1, message: 'no fit', fix: 'simplify', topic: 'flow' }]);
  const unexpected = createDiagramApi({ flowchart: implementation({ layout() { throw new TypeError('bug'); } }) }, types);
  assert.throws(() => unexpected.diagram('flowchart\nbody'), /bug/);
});
