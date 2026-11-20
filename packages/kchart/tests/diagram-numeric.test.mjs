import assert from 'node:assert/strict';
import { test } from 'vitest';
import { implementations as composition } from '../src/diagram/numeric-composition.js';
import { implementations as xy } from '../src/diagram/numeric-xy.js';
import { implementations as sankey } from '../src/diagram/numeric-sankey.js';
import { implementations as radar } from '../src/diagram/numeric-radar.js';
import { createContext } from '../src/core/context.js';
import { renderScene } from '../src/core/svg.js';
import { diagram } from '../dist/esm/node.js';
import { readFileSync } from 'node:fs';
import { checkScene } from './helpers/geometry.mjs';

const corpus = JSON.parse(readFileSync(new URL('./conformance/mermaid-12.3.0.json', import.meta.url)));
const reviewScene = (id, width) => {
  const { scene, diagnostics } = diagram(corpus.find(record => record.id === id).source, { width });
  assert.ok(scene, JSON.stringify(diagnostics));
  const walk = parts => parts.flatMap(part => [part, ...walk(part.children || [])]);
  return walk(scene.children);
};

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
    ['sankey', '"A, one",B,2\nB,C,2', 'sankey', {}],
    ['radar-beta', 'title 能力\naxis 速度,质量,成本\ncurve 方案甲 {3,4,2}', 'radar-beta', {}],
    ['treemap', 'title 预算\n根\n  "销售,市场"\n    销售 : 4\n    市场 : 3', 'treemap', {}],
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
  const badOption = implementations['sankey'].parse('A,B,1', info('sankey', 20, { foo: true }));
  assert.equal(badOption.errors[0].line, 19);
});

// chart/spec 校验返回全部 KChart 错误并按 sankey edge / radar curve 映射到源码行。
test('KChart 数值诊断映射回对应 Mermaid 记录', () => {
  const sankeyInfo = info('sankey', 30);
  const invalidSankey = implementations['sankey'].parse('A,B,1\nB,A,1', sankeyInfo).model;
  invalidSankey.edges[1].value = Infinity;
  const sankeyErrors = implementations['sankey'].validate(invalidSankey, sankeyInfo);
  assert.ok(sankeyErrors.length > 0);
  assert.equal(sankeyErrors[0].line, 31);
  const cycleInfo = info('sankey', 35);
  const cycleModel = implementations['sankey'].parse('A,B,1\nB,A,1', cycleInfo).model;
  assert.equal(implementations['sankey'].validate(cycleModel, cycleInfo)[0].line, 35);

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

  const treeInfo = info('treemap', 60);
  const invalidTree = implementations['treemap'].parse('Root\n  Group\n    Leaf : 1', treeInfo).model;
  invalidTree.data.children[0].children[0].value = Infinity;
  assert.equal(implementations['treemap'].validate(invalidTree, treeInfo)[0].line, 62);

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

// Inline pie titles, duplicate handling and overflow preserve the first five values and the overflow total.
test('pie titles and grouped slices', () => {
  const cfg = { ...info('pie'), params: 'showData title Inventory' };
  const body = Array.from({ length: 7 }, (_, i) => `"Item ${i}": ${i + 1}`).join('\n');
  const parsed = implementations.pie.parse(`${body}\n"Item 0": 99`, cfg);
  assert.equal(parsed.model.rows[0].value, 1);
  assert.equal(parsed.model.rows[5].value, 13);
  assert.match(parsed.model.rows[5].category, /Item 5, Item 6/);
  assert.deepEqual(parsed.errors.map(e => e.severity), ['warning', 'warning']);
  const noFlag = implementations.pie.parse(body, { ...cfg, params: 'title Inventory' });
  assert.equal(svgFor(layout('pie', parsed, cfg)), svgFor(layout('pie', noFlag, cfg)));
  const small = implementations.pie.parse('Large: 99\nSmall: 1', cfg);
  const svg = svgFor(layout('pie', small, cfg));
  assert.match(svg, />99%<\/text>/);
  assert.doesNotMatch(svg, />1%<\/text>/);
});

// Multiple top-level sections share an invisible root; grouping separators never change the asset's weight.
test('treemap multiple roots, separators and invalid leaves', () => {
  const cfg = info('treemap');
  const parsed = implementations.treemap.parse('"First"\n  "A", 1_200\n"Second"\n  "B": 2,400', cfg);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.model.data.children.map(node => node.children[0].value), [1200, 2400]);
  assert.doesNotMatch(svgFor(layout('treemap', parsed, cfg)), />Treemap<\/text>/);
  const bad = implementations.treemap.parse('"Root"\n\t"A": 1\n  "B"', cfg);
  assert.ok(bad.errors.some(e => e.line === cfg.firstLine + 1 && e.column === 1));
  assert.ok(bad.errors.some(e => e.line === cfg.firstLine + 2 && /权重/.test(e.message)));
});

// Treemap class suffixes color a leaf through the theme, and percent/currency formatting retains both symbols.
test('treemap presentation, safe link and value format', () => {
  const cfg = { ...info('treemap'), config: { treemap: { valueFormat: '$.1%' } } };
  const parsed = implementations.treemap.parse('"Root"\n  "A": .5:::hot\n  "B": .5\nclassDef hot fill:#f00\nclick A href "https://example.org"', cfg);
  assert.deepEqual(parsed.errors, []);
  const laid = layout('treemap', parsed, cfg);
  const svg = svgFor(laid);
  assert.match(svg, /<a href="https:\/\/example.org"/);
  assert.match(svg, /A · \$50\.0%/);
  const nodes = laid.scene.children.flatMap(part => part.tag === 'a' ? part.children : [part]);
  assert.equal(nodes.find(part => part.meta?.kind === 'node' && part.meta.label === 'A')?.attrs.fill, createContext().design.danger);
});

// Every numbered treemap readout can be matched to its tile; wide shallow tiles still display text.
test('treemap marks every tile and preserves its named root and total', () => {
  for (const width of [360, 800]) {
    for (const [id, rootLabel] of [['61', 'Products · 180'], ['97', 'Main · 50'], ['183', 'Budget · $1,500,000'], ['202', 'Market Share · $100.0%']]) {
      const parts = reviewScene(`treemap.md:${id}`, width);
      assert.equal(parts.filter(p => p.text === rootLabel).length, 1);
      const tiles = parts.filter(p => p.meta?.kind === 'node');
      const marks = parts.filter(p => /^treemap-tile-(index|label)$/.test(p.meta?.kind || ''));
      for (const tile of tiles) assert.ok(marks.some(mark => mark.meta.path === tile.meta.path));
      const indexes = parts.filter(p => p.meta?.kind === 'treemap-name' && p.meta.index != null).map(p => p.meta.index);
      assert.deepEqual(indexes, marks.filter(mark => mark.meta.kind === 'treemap-tile-index').map(mark => mark.meta.index));
      if (id === '183') assert.ok(marks.some(mark => mark.text.startsWith('Supplies ·')));
      if (id === '202' && width === 800) assert.ok(marks.some(mark => mark.text === 'Company C'));
    }
  }
});

// Point notes remain close to their own markers, clear of the adjacent series segments and plot edge.
test('xychart positions dense point labels within the plot', () => {
  const ctx = createContext();
  for (const width of [360, 800]) {
    const parts = reviewScene('xyChart.md:244', width);
    const points = parts.filter(p => p.tag === 'circle' && p.meta?.kind === 'record').map(p => [p.attrs.cx, p.attrs.cy]);
    const labels = parts.filter(p => ['annotation', 'value'].includes(p.meta?.kind) && p.tag === 'text');
    assert.equal(labels.length, 6);
    for (const p of labels) {
      const [px, py] = points[p.meta.kind === 'value' ? points.length - 1 : Number(p.meta.record)];
      const { x, y, 'font-weight': weight } = p.attrs;
      const right = x + ctx.measure(p.text, 12, weight);
      assert.ok(x >= points[0][0] && right <= points.at(-1)[0]);
      assert.ok(Math.abs(py - y) < 60 && px >= x - 24 && px <= right + 24, p.text);
      for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1], [bx, by] = points[i];
        if (right < ax || x > bx) continue;
        const at = xx => ay + (by - ay) * (xx - ax) / (bx - ax);
        const ys = [at(Math.max(x, ax)), at(Math.min(right, bx))];
        assert.ok(Math.max(...ys) < y - 10 || Math.min(...ys) > y + 3, p.text);
      }
    }
  }
});

// XY uses evenly spaced categories, keeps sparse line labels and warns once when horizontal is unavailable.
test('xychart numeric axis and point labels', () => {
  const cfg = info('xychart');
  const body = 'x-axis 0 --> 100\nline [25 "Launch", 45, 72, 80, 90 "Target Hit"]';
  const vertical = implementations.xychart.parse(body, cfg);
  const horizontal = implementations.xychart.parse(body, { ...cfg, params: 'horizontal' });
  assert.deepEqual(vertical.model.categories, ['0', '25', '50', '75', '100']);
  assert.deepEqual(vertical.model.datasets[0].pointLabels, ['Launch', null, null, null, 'Target Hit']);
  assert.deepEqual(horizontal.errors.map(e => e.severity), ['warning']);
  const svg = svgFor(layout('xychart', vertical, cfg));
  assert.match(svg, /Launch/);
  assert.match(svg, /Target Hit/);
  assert.equal(svgFor(layout('xychart', horizontal, cfg)), svg);
});

// A shared-axis bar/line legend omits the redundant axis name and inherits English from the source.
test('xychart one-axis legend preserves inferred language without axis suffixes', () => {
  const source = 'xychart\n  title "Sales Revenue"\n  x-axis [January, February, March]\n  bar [4, 6, 8]\n  line [3, 5, 7]';
  for (const width of [800, 360]) {
    const { svg, diagnostics } = diagram(source, { width });
    assert.deepEqual(diagnostics, []);
    assert.match(svg, />Series 1<\/text>/);
    assert.match(svg, />Series 2<\/text>/);
    assert.doesNotMatch(svg, /left axis|right axis|左轴|右轴/);
  }
});

// XY columns expand a nonzero declared baseline, and the series cap points to the twenty-fifth plot.
test('xychart baseline and series cap', () => {
  const cfg = info('xychart');
  const bar = implementations.xychart.parse('y-axis 4000 --> 11000\nbar [5500, 6100]', cfg);
  assert.deepEqual(bar.model.yDomain, [0, 11000]);
  assert.deepEqual(bar.errors.map(e => e.severity), ['warning']);
  const many = implementations.xychart.parse('line [1,2]\n'.repeat(25), cfg);
  assert.ok(many.errors.some(e => e.line === cfg.firstLine + 24 && e.severity !== 'warning'));
});

// Sankey records preserve quoted Unicode/escaped quotes, blank lines, and nonconserving middle nodes.
test('sankey CSV and nonconserving flow', () => {
  const cfg = info('sankey');
  const parsed = implementations.sankey.parse('"甲",B,1\n\nB,"a""b",1\nB,D,2', cfg);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.model.nodes.map(n => n.id), ['甲', 'B', 'a"b', 'D']);
  const laid = layout('sankey', parsed, cfg);
  assert.deepEqual(laid.errors, []);
  assert.match(svgFor(laid), />a&quot;b<\/text>/);
  assert.equal(implementations.sankey.parse('A,B,1\nB,C', cfg).errors[0].line, cfg.firstLine + 1);
});

// Numeric hard caps name their bound and provide split guidance in both diagnostic languages.
test('xychart and radar safety caps are bilingual and actionable', () => {
  const xyInfo = { ...info('xychart'), lang: 'en' };
  const xy = implementations.xychart.parse('line [1,2]\n'.repeat(25), xyInfo);
  assert.match(xy.errors[0].message, /safety cap is 24/);
  assert.match(xy.errors[0].fix, /split/i);
  const radarInfo = { ...info('radar-beta'), lang: 'en' };
  const radarSource = `axis A,B,C\n${Array.from({ length: 25 }, (_, i) => `curve R${i}{1,2,3}`).join('\n')}`;
  const radar = implementations['radar-beta'].parse(radarSource, radarInfo);
  assert.match(radar.errors[0].message, /safety cap is 24/);
  assert.match(radar.errors[0].fix, /split/i);
});

// Numeric charts above their comfortable size retain clean geometry and return a localized large-diagram advisory.
test('xychart and radar large inputs render with one actionable warning', () => {
  const xyInfo = info('xychart');
  const points = Array.from({ length: 61 }, (_, i) => i + 1).join(',');
  const xySource = `line [${points}]`;
  const xyParsed = implementations.xychart.parse(xySource, xyInfo);
  assert.deepEqual(xyParsed.errors, []);
  const xyLayout = layout('xychart', xyParsed, xyInfo, { width: 800 });
  assert.equal(xyLayout.errors.filter(item => item.code === 'LARGE_DIAGRAM').length, 1);
  assert.match(xyLayout.errors.find(item => item.code === 'LARGE_DIAGRAM').fix, /拆分/);
  assert.deepEqual(checkScene(xyLayout.scene, { source: xySource }), []);

  const radarInfo = info('radar-beta');
  const radarSource = `axis A,B,C\n${Array.from({ length: 13 }, (_, i) => `curve R${i}{1,2,3}`).join('\n')}`;
  const radarParsed = implementations['radar-beta'].parse(radarSource, radarInfo);
  assert.deepEqual(radarParsed.errors, []);
  const radarLayout = layout('radar-beta', radarParsed, radarInfo, { width: 800 });
  assert.equal(radarLayout.errors.filter(item => item.code === 'LARGE_DIAGRAM').length, 1);
  assert.match(radarLayout.errors.find(item => item.code === 'LARGE_DIAGRAM').fix, /拆分/);
  assert.deepEqual(checkScene(radarLayout.scene, { source: radarSource }), []);
});

// Radar resolves named values to declaration order and keeps valid curves when one has the wrong length.
test('radar repeated axes, named values and plot options', () => {
  const cfg = info('radar-beta');
  const body = 'axis a["Food Quality"], b, c\naxis d, e, f\ncurve good{f:6, e:5, d:4, c:3, b:2, a:1}, bad{1,2}\nmax 5\nshowLegend false\ngraticule polygon';
  const parsed = implementations['radar-beta'].parse(`${body}\nticks 40`, cfg);
  assert.equal(parsed.model.fields[0].label, 'Food Quality');
  assert.equal(parsed.model.rows.length, 1);
  assert.deepEqual(Object.values(parsed.model.rows[0]), ['good', 1, 2, 3, 4, 5, 6]);
  assert.equal(parsed.model.rings, 8);
  assert.deepEqual(parsed.errors.map(e => e.severity), ['warning', 'warning', 'warning']);
  assert.doesNotMatch(svgFor(layout('radar-beta', parsed, cfg)), />good<\/text>/);
  for (const ticks of [1, 2, 8]) {
    const low = implementations['radar-beta'].parse(`${body}\nticks ${ticks}`, cfg);
    assert.equal(low.model.rings, Math.max(2, ticks));
    assert.equal(low.errors.length, ticks === 1 ? 3 : 2);
  }
});
