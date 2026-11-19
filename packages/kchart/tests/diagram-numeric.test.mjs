import assert from 'node:assert/strict';
import { test } from 'vitest';
import { implementations as composition } from '../src/diagram/numeric-composition.js';
import { implementations as xy } from '../src/diagram/numeric-xy.js';
import { implementations as sankey } from '../src/diagram/numeric-sankey.js';
import { implementations as radar } from '../src/diagram/numeric-radar.js';
import { createContext } from '../src/core/context.js';
import { renderScene } from '../src/core/svg.js';

const implementations = Object.assign({}, composition, xy, sankey, radar);
const info = (kind, firstLine = 3, options = {}) => ({ kind, syntax: 'mermaid', header: kind, headerLine: firstLine - 1, firstLine, options, lang: 'zh' });
const layout = (kind, parsed, sourceInfo = info(kind), renderOptions = {}) => {
  const ctx = createContext(renderOptions);
  const measure = (text, { size = 12, weight = 400 } = {}) => ctx.measure(text, size, weight);
  return implementations[kind].layout(parsed.model, { width: renderOptions.width || 640, lang: sourceInfo.lang, measure, ctx, renderOptions }, sourceInfo);
};
const svgFor = (laid, renderOptions = {}) => renderScene(laid.scene, renderOptions);

// 所有语法都经真实图族 layout 和共享 serializer 产出 SVG，并保留标题与轴名。
test('五种 Mermaid 数值图经所属 KChart 图族排版', () => {
  const cases = [
    ['pie', 'title 分布\n甲 : 3\n乙 : 2', 'pie showData', { showData: true }],
    ['xychart', 'title 销量\nx-axis 月份 [一月, 二月]\ny-axis 件数 0 --> 10\nbar [3, 8]', 'xychart', {}],
    ['sankey-beta', '"A, one",B,2\nB,C,2', 'sankey-beta', {}],
    ['radar-beta', 'title 能力\naxis 速度,质量,成本\ncurve 方案甲 {3,4,2}', 'radar-beta', {}],
    ['treemap-beta', 'title 预算\n根\n  "销售,市场"\n    销售 : 4\n    市场 : 3', 'treemap-beta', {}],
  ];
  for (const [kind, body, header, options] of cases) {
    const sourceInfo = { ...info(kind, 11, options), header };
    const parsed = implementations[kind].parse(body, sourceInfo);
    assert.equal(parsed.errors.length, 0, kind);
    const laid = layout(kind, parsed, sourceInfo);
    assert.equal(laid.errors.length, 0, kind);
    assert.ok(laid.scene.children.length > 0, kind);
    assert.ok(laid.height > 0, kind);
    assert.match(svgFor(laid), /^<svg[ >]/, kind);
    if (kind === 'pie') {
      assert.equal(laid.scene.title, '分布');
      assert.equal((svgFor(laid).match(/<text[^>]*>分布<\/text>/g) || []).length, 1);
      assert.equal(parsed.model.showData, true);
      const aliasInfo = info('pie', 11);
      const withoutAlias = implementations.pie.parse('title 分布\n甲 : 3\n乙 : 2', aliasInfo);
      assert.equal(svgFor(layout('pie', withoutAlias, aliasInfo)), svgFor(laid));
    }
    if (kind === 'xychart') {
      assert.equal(laid.scene.subtitle, '月份 · 件数');
      assert.equal((svgFor(laid).match(/<text[^>]*>月份 · 件数<\/text>/g) || []).length, 1);
    }
    assert.equal(typeof implementations[kind].validate, 'function', `${kind} validate`);
  }
  assert.ok(implementations.xychart);
});

// 解析诊断保留 Mermaid 原始行号；showData 是有效兼容别名，不伪造布局变化。
test('原始行号与受支持的头行选项被保留', () => {
  const sourceInfo = info('pie', 17, { showData: true });
  const parsed = implementations.pie.parse('%% 注释\n标题 错误\n甲 : 1', sourceInfo);
  assert.equal(parsed.model.showData, true);
  assert.equal(parsed.errors[0].line, 18);
  const badOption = implementations['sankey-beta'].parse('A,B,1', info('sankey-beta', 20, { foo: true }));
  assert.equal(badOption.errors[0].line, 19);
});

// chart/spec 校验返回全部 KChart 错误并按 sankey edge / radar curve 映射到源码行。
test('KChart 数值诊断映射回对应 Mermaid 记录', () => {
  const sankeyInfo = info('sankey-beta', 30);
  const invalidSankey = implementations['sankey-beta'].parse('A,B,1\nB,A,1', sankeyInfo).model;
  invalidSankey.edges[1].value = Infinity;
  const sankeyErrors = implementations['sankey-beta'].validate(invalidSankey, sankeyInfo);
  assert.ok(sankeyErrors.length > 0);
  assert.equal(sankeyErrors[0].line, 31);
  const cycleInfo = info('sankey-beta', 35);
  const cycleModel = implementations['sankey-beta'].parse('A,B,1\nB,A,1', cycleInfo).model;
  assert.equal(implementations['sankey-beta'].validate(cycleModel, cycleInfo)[0].line, 35);

  const radarInfo = info('radar-beta', 40);
  const invalidRadar = implementations['radar-beta'].parse('axis A,B,C\ncurve R {1,2,3}', radarInfo).model;
  invalidRadar.rows[0].d0 = Infinity;
  const radarErrors = implementations['radar-beta'].validate(invalidRadar, radarInfo);
  assert.ok(radarErrors.length > 0);
  assert.equal(radarErrors[0].line, 41);

  const xyInfo = info('xychart', 50);
  const invalidXy = implementations['xychart'].parse('bar [1,2]', xyInfo).model;
  invalidXy.datasets[0].values[0] = Infinity;
  assert.equal(implementations['xychart'].validate(invalidXy, xyInfo)[0].line, 50);

  const treeInfo = info('treemap-beta', 60);
  const invalidTree = implementations['treemap-beta'].parse('Root\n  Group\n    Leaf : 1', treeInfo).model;
  invalidTree.data.children[0].children[0].value = Infinity;
  assert.equal(implementations['treemap-beta'].validate(invalidTree, treeInfo)[0].line, 62);

  const fitInfo = info('pie', 80);
  const zeroPie = implementations.pie.parse('Only : 0', fitInfo);
  assert.equal(zeroPie.errors.length, 0);
  assert.equal(layout('pie', zeroPie, fitInfo).errors[0].line, 80);
});

// frame:false 由图族 Scene 显示题名/轴名；frame:true 使用共享外框且不会重复绘制。
test('print、主题和 frame 由共享 KChart API 保持', () => {
  const sourceInfo = info('xychart', 10);
  const parsed = implementations['xychart'].parse('title Long sales heading\nx-axis Month [Jan,Feb]\ny-axis Revenue 0 --> 8\nbar [3,6]', sourceInfo);
  const measureContext = createContext({ theme: 'paper', media: 'print' });
  let measureCalls = 0;
  const options = { theme: 'paper', media: 'print', frame: true, measure: (text, size = 12, weight = 400) => { measureCalls += 1; return measureContext.measure(text, size, weight); } };
  const framed = layout('xychart', parsed, sourceInfo, options);
  const framedSvg = svgFor(framed, options);
  assert.equal((framedSvg.match(/<text[^>]*>Long sales heading<\/text>/g) || []).length, 1);
  assert.equal((framedSvg.match(/<text[^>]*>Month · Revenue<\/text>/g) || []).length, 1);
  const theme = createContext(options);
  assert.ok(framedSvg.includes(theme.color('tone1')));
  assert.ok(framedSvg.includes(theme.color('fg')));
  assert.ok(measureCalls > 0);

  const unframed = layout('xychart', parsed, sourceInfo, { theme: 'paper', media: 'print' });
  const unframedSvg = svgFor(unframed, { theme: 'paper', media: 'print' });
  assert.equal((unframedSvg.match(/<text[^>]*>Long sales heading<\/text>/g) || []).length, 1);
  assert.equal((unframedSvg.match(/<text[^>]*>Month · Revenue<\/text>/g) || []).length, 1);

  const longTitle = '营收分析标题'.repeat(12);
  const longInfo = info('xychart', 70);
  const longParsed = implementations.xychart.parse(`title ${longTitle}\nbar [2,4]`, longInfo);
  const wrapped = layout('xychart', longParsed, longInfo, { width: 240 });
  const titleLines = wrapped.scene.children[0].children.map(node => node.text);
  assert.ok(titleLines.length > 1);
  assert.equal(titleLines.join(''), longTitle);

  const fault = new TypeError('external measure failure');
  const ctx = createContext({ theme: 'paper' });
  const pieModel = implementations.pie.parse('title Pie\nA : 3\nB : 2', info('pie', 10)).model;
  assert.throws(() => implementations.pie.layout(
    pieModel,
    { width: 640, lang: 'zh', ctx, renderOptions: { theme: 'paper' }, measure: () => { throw fault; } },
    info('pie', 10),
  ), error => error === fault);
});
