import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as scene from '../src/core/scene.js';
import * as svg from '../src/core/svg.js';
import * as context from '../src/core/context.js';
import * as registry from '../src/chart/registry.js';
import * as diagnostics from '../src/core/diagnostics.js';
import { makeContext } from '../src/chart/context.js';
import { theme as resolveTheme } from '../src/core/theme.js';

const fontFamily = '"System UI & Sans", monospace';
const theme = { ...resolveTheme('paper'), fontFamily };

// SVG 只接受受控图元；文本经 XML 转义，实例内的 ID 与引用一起改写。
test('场景序列化转义文本、改写引用并拒绝非法属性', () => {
  const emptyScene = { width: 120, height: 40, children: [] };
  assert.equal(scene.containText(emptyScene, () => 0), emptyScene);
  const model = { width: 120, height: 40, title: 'A <chart>', description: 'summary & detail', children: [
    scene.el('defs', {}, [
      scene.el('linearGradient', { id: 'fade' }),
      scene.el('marker', { id: 'arrow', markerWidth: 6, markerHeight: 6, refX: 5, refY: 3, orient: 'auto' }, [
        scene.el('path', { d: 'M0 0 L6 3 L0 6 Z' }),
      ]),
    ]),
    scene.el('path', { d: 'M5 25 L90 25', 'marker-end': 'url(#arrow)' }),
    { ...scene.el('text', { x: 2, y: 14, fill: 'url(#fade)' }), text: '<hello & goodbye>', meta: { related: ['a', 'b'] } },
  ] };
  const rendered = svg.renderScene(model, { prefix: 'unit' });
  assert.equal(svg.renderScene(model, { prefix: 'unit' }), rendered);
  assert.match(rendered, /id="unit-fade"/);
  assert.match(rendered, /fill="url\(#unit-fade\)"/);
  assert.match(rendered, /<marker id="unit-arrow"/);
  assert.match(rendered, /marker-end="url\(#unit-arrow\)"/);
  assert.match(rendered, /data-kc-related="\[&quot;a&quot;,&quot;b&quot;\]"/);
  assert.match(rendered, /A &lt;chart&gt;/);
  assert.match(rendered, /&lt;hello &amp; goodbye&gt;/);
  assert.match(rendered, /aria-labelledby="unit-title"/);
  assert.throws(() => scene.el('script'), /Unsafe SVG tag/);
  assert.throws(() => scene.el('rect', { onclick: 'run()' }), /Unsafe SVG attribute/);
  const external = scene.el('rect', { fill: 'url(https://example.test)' });
  assert.throws(() => svg.renderScene({ width: 2, height: 2, children: [external] }), /Unsafe SVG resource reference/);
});

// 用实际模块闭包验证通用上下文没有图表字段、单位或刻度规则。
test('只有图表上下文带字段格式、日期、刻度和表格语义', () => {
  const generic = context.createContext();
  assert.equal(generic.field, undefined);
  assert.equal(generic.format, undefined);
  assert.equal(generic.ticks, undefined);
  assert.equal(typeof generic.flow, 'function');
  assert.equal(typeof generic.legend, 'function');

  const chart = makeContext({ spec: { chart: 'bar', unit: 'kg', encode: { value: 'amount' }, fields: { rate: { format: 'percent' } } } });
  assert.equal(chart.field('amount').unit, 'kg');
  assert.equal(chart.format(0.25, 'rate'), '25.0%');
  assert.equal(chart.percent(0.25), '25.0%');
  assert.equal(chart.compactTemporal(['2026-01'])[0].year, '2026年');
  assert.equal(typeof chart.ticks, 'function');
  assert.equal(typeof chart.table, 'function');
});

// 即使内部异常碰巧带同名 code 或结构相同的 errors，也不能改报成「输入不合规」。
test('渲染仅接收预期诊断，保留原始校验数组和修法', () => {
  const validatorErrors = [{ code: 'BAD_KCHART', path: '/data', message: '数据非法', fix: '修正数据' }];
  const invalid = registry.createRegistry(() => ({ errors: validatorErrors, data: null })).render({});
  assert.equal(invalid.scene, null);
  assert.equal(invalid.svg, null);
  assert.equal(invalid.diagnostics, validatorErrors);

  const fitting = registry.createRegistry((spec) => ({ errors: [], data: spec }));
  fitting.register('does-not-fit', () => diagnostics.fit('不适用', '更换图型'));
  assert.equal(fitting.render({ chart: 'does-not-fit' }).diagnostics[0].fix, '更换图型');

  const internal = Object.assign(new Error('布局内部错误'), { code: 'CHART_FIT', errors: validatorErrors });
  fitting.register('internal', () => { throw internal; });
  assert.throws(() => fitting.render({ chart: 'internal' }), (error) => error === internal);
});

// 独立 SVG 外壳可选，主题字体与测字使用同一值；不加 frame 时不产生标题卡或额外高度。
test('独立 SVG 保留尺寸，外壳通过同一个字体测量标题和来源', () => {
  const model = { width: 160, height: 40, heading: 'Heading', subtitle: 'Subtitle', source: 'Source', note: 'Note', children: [] };
  const bare = svg.renderScene(model, { frame: false, theme });
  assert.match(bare, /width="160" height="40" viewBox="0 0 160 40"/);
  assert.match(bare, /font-family="&quot;System UI &amp; Sans&quot;, monospace"/);
  assert.doesNotMatch(bare, /Heading|Subtitle|Source|Note/);
  const measured = new Set();
  const framed = svg.renderScene(model, { frame: true, theme, measure: (text, size, weight, font) => {
    measured.add(font);
    return text.length * size;
  } });
  assert.deepEqual([...measured], [fontFamily]);
  assert.match(framed, /font-family="&quot;System UI &amp; Sans&quot;, monospace"/);
  assert.match(framed, /width="160"/);
  for (const text of ['Heading', 'Subtitle', 'Source', 'Note']) assert.ok(framed.includes(text));
  assert.ok(Number(framed.match(/height="(\d+)"/)[1]) > model.height);
});
