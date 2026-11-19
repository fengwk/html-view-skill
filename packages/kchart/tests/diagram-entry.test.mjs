import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { test } from 'vitest';
import * as chart from '../dist/esm/node.js';

const { check, createRenderer, diagram, diagramTypes, modulesFor } = chart;

// 清单上的每个规范图型必须有实际实现；任何额外实现都要通过同一处登记。
test('结构图目录与实际模块覆盖 29 个 Mermaid 类型和 3 个原生类型', () => {
  assert.equal(diagramTypes.filter(({ syntax }) => syntax === 'mermaid').length, 29);
  assert.deepEqual(diagramTypes.filter(({ syntax }) => syntax !== 'mermaid').map(({ kind }) => kind), ['layers', 'blocks', 'swimlane']);
  const modules = import.meta.glob('../src/diagram/*.js', { eager: true });
  const implemented = Object.values(modules).flatMap(unit => Object.keys(unit.implementations || {}));
  assert.deepEqual([...new Set(implemented)].sort(), diagramTypes.map(({ kind }) => kind).sort());
  assert.equal(implemented.length, diagramTypes.length);
});

// 实测每个数值闭包包含实际渲染模块，原生、流程与时序不引入数据图。
test('按声明组装只载入图型所需的依赖，浏览器与 Node 输出一致', () => {
  const cases = [
    { syntax: 'layers', source: '- 接入层\n  - 门户: Web, API' },
    { syntax: 'blocks', source: 'blocks\nbox 接入: 网关' },
    { syntax: 'swimlane', source: 'swimlane\nlane 接入\n  A[接入]\nlane 服务\n  B[服务]\nA --> B' },
    { source: 'graph LR; A[入口] --> B[出口]' },
    { source: 'sequenceDiagram\n  A->>B: 请求' },
    { source: 'pie\n  Web: 42\n  App: 58', chartFamily: 'chart/composition' },
    { source: 'xychart-beta\n  x-axis [Q1, Q2]\n  bar [3, 4]', chartFamily: 'chart/basic' },
    { source: 'sankey-beta\n  A,B,4\n  B,C,4', chartFamily: 'chart/relations' },
    { source: 'radar-beta\n  axis A, B, C\n  curve One{1, 2, 3}', chartFamily: 'chart/multivariate' },
    { source: 'treemap-beta\nRoot\n  A: 2\n  B: 3', chartFamily: 'chart/composition' },
    { source: 'mindmap\n  根\n    叶子', chartFamily: 'chart/mindmap' },
  ];
  // The shared browser page API always needs these chart infrastructure units, not chart families.
  const pageChartModules = new Set(['chart/catalog', 'chart/spec', 'chart/fields', 'chart/context', 'chart/registry']);
  for (const item of cases) {
    const { syntax, source, chartFamily } = item;
    const roots = modulesFor([item]);
    assert.ok(roots.includes('diagram/registry'), source);
    if (chartFamily) assert.ok(roots.includes(chartFamily), source);
    else assert.ok(!roots.some(id => id.startsWith('chart/') && !pageChartModules.has(id)), source);
    assert.ok(!roots.includes('interaction') && !roots.includes('chart/maps'), source);
    const selected = createRenderer({ sources: [item] });
    const env = {};
    runInNewContext(selected.bundleSource(), env);
    assert.equal(env.KChart.render, undefined);
    const options = { syntax, width: 360, frame: false, prefix: 'same' };
    const expected = diagram(source, options);
    assert.ok(expected.svg, JSON.stringify(expected.diagnostics));
    assert.equal(env.KChart.diagram(source, options).svg, expected.svg, source);
    assert.equal(selected.diagram(source, options).svg, expected.svg, source);
    const page = {};
    runInNewContext(chart.browserSource([item]), page);
    assert.equal(page.KChart.diagram(source, options).svg, expected.svg, source);
  }
});

test('混合浏览器入口可同时渲染数据图和结构图；只组装数据图的入口不装入结构图库', () => {
  const source = 'flowchart TD\nA --> B';
  const spec = { chart: 'bar', data: [{ key: '甲', count: 2 }], encode: { category: 'key', value: 'count' } };
  const env = {};
  runInNewContext(chart.browserSource([{ source }, spec]), env);
  assert.equal(env.KChart.diagram(source).svg, diagram(source).svg);
  assert.equal(env.KChart.render(spec).svg, chart.render(spec).svg);
  assert.ok(!chart.modulesFor([spec]).some(id => id.startsWith('diagram/')));
});

// 普通结构框不能跟随图表红；在真实 SVG 上同时检查结构图和有明确图例的数据图。
test('Cloud Music separates ordinary diagram frame colors from the red chart series', () => {
  const theme = 'cloudmusic';
  const cases = [
    ['layers', 'layers\n- 接入层\n  - 门户: Web, API\n- 服务层\n  - 订单: 下单'],
    ['blocks', 'blocks\nrow\n  box 门户: 网关\n  box 服务: API\n门户 -> 服务: 请求'],
    ['swimlane', 'swimlane LR\nlane 接入\n  A[接入]\nlane 服务\n  B[服务]\nA --> B'],
    ['mermaid', 'sequenceDiagram\n  box 入口\n  participant A\n  end\n  rect 请求阶段\n  A->>+B: 请求\n  B-->>-A: 返回\n  end'],
    ['mermaid', 'mindmap\n  根\n    分支\n      叶子'],
  ];
  for (const [syntax, source] of cases) {
    const { svg, diagnostics } = diagram(source, { syntax, theme });
    assert.deepEqual(diagnostics, [], source);
    const colors = [...svg.matchAll(/(?:fill|stroke)="#([\da-f]{6})"/gi)];
    assert.ok(colors.length > 0, source);
    for (const [, hex] of colors) {
      const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
      assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 12, `${source}: unexpected saturated paint #${hex}`);
    }
  }
  const { svg, diagnostics } = chart.render({ chart: 'bar', data: [{ name: '本期', a: 4, b: 7 }], encode: { category: 'name', value: ['a', 'b'] } }, { theme });
  assert.deepEqual(diagnostics, []);
  assert.match(svg, /fill="#d82420"/, 'the red data series is unchanged');
});

// 真入口覆盖跨行标签、行号、别名、拦截规则及窄闭包的诊断边界。
test('共用入口保留 Markdown 换行并定位未支持的写法', () => {
  const script = '---\ntitle: 方案\nconfig:\n  layout: right\n---\nmindmap\n  root["`**第一行**\n第二行`"]\n    api_v2_auth\n    :::ok';
  const rendered = diagram(script, { width: 324 });
  assert.deepEqual(rendered.diagnostics, []);
  assert.equal(rendered.scene.layout, 'right');
  assert.equal(rendered.scene.nodes[0].label, '第一行\n第二行');
  assert.equal(rendered.scene.nodes[1].label, 'api_v2_auth');
  assert.equal(rendered.scene.nodes[1].status, 'ok');
  assert.match(rendered.svg, /第一行<\/text>/);
  for (const [input, line] of [
    ['flowchart LR\n A --> B\n class A danger', 3],
    ['flowchart LR; A --> B; class A danger', 1],
    ['mindmap\n  root\n    label\n    ::icon(fa fa-book)', 4],
  ]) {
    const { svg, diagnostics } = diagram(input);
    assert.equal(svg, null);
    assert.equal(diagnostics[0].line, line);
    assert.ok(diagnostics[0].fix && diagnostics[0].topic);
  }
  assert.ok(check('sankey-beta\nA,B,5\nB,A,5').length > 0);
  const selected = createRenderer({ sources: ['mindmap\n  root'] });
  assert.match(selected.check('\n\nflowchart TD\nA --> B')[0].message, /未装入/);
  assert.equal(selected.check('\n\nflowchart TD\nA --> B')[0].line, 3);
});
