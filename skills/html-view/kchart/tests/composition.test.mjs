import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render } from '../node.mjs';

const spec = (chart, values) => ({
  chart,
  data: values.map((v, i) => ({ c: `类别 ${i}`, v, i: 2 })),
  encode: { category: 'c', value: 'v', ...(chart === 'radial-share' ? { intensity: 'i' } : {}) },
  ...(chart === 'radial-share' ? { fields: { v: { unit: '次' }, i: { unit: '分' } } } : {}),
});

// 零值在饼图不占角度，在玫瑰图保留空槽；两者都不重复画同一条半径。
test('实心扇区先填色，分隔线使用同一圆心且不重复', () => {
  for (const [chart, values, rayCount] of [['pie', [0, 3, 0, 2, 0], 2], ['rose', [1, 0, 0, 4, 2], 4]]) {
    const { scene, diagnostics } = render(spec(chart, values), { width: 502 });
    assert.deepEqual(diagnostics, []);
    const wedges = scene.children.filter(({ meta }) => meta?.kind === chart);
    assert.deepEqual(Array.from(wedges, ({ meta }) => meta.value), values.filter(value => value > 0));
    assert.ok(wedges.every(({ attrs }) => attrs.stroke == null || attrs.stroke === 'none'));
    const dividers = scene.children.filter(({ tag, attrs }) => tag === 'path' && attrs.fill === 'none');
    assert.equal(dividers.length, 1);
    const lines = dividers[0].attrs.d.split(/\s+M/).map(d => d.replace(/^M/, '')).filter(d => d.includes(' L'));
    assert.equal(lines.length, rayCount);
    assert.equal(new Set(lines).size, rayCount);
    assert.deepEqual([...new Set(lines.map(line => line.split(' L')[0]))], [wedges[0].attrs.d.split(' L')[0].slice(1)]);
  }
});

// 只有一个 360° 扇区时，没有任何数据分界；圆环的内外轮廓也不能用可见的径向笔画相连。
test('整圆与整环没有假分隔线', () => {
  const cases = [spec('pie', [0, 3, 0]), spec('rose', [3]), spec('donut', [3, 0]), spec('radial-share', [3]),
    { chart: 'sunburst', data: { label: '根', children: [{ label: '唯一', value: 3 }] } }];
  for (const input of cases) {
    const { scene, diagnostics } = render(input);
    assert.deepEqual(diagnostics, []);
    const paths = scene.children.filter(({ tag }) => tag === 'path');
    assert.ok(paths.length > 0, input.chart);
    assert.ok(paths.every(({ attrs }) => attrs.d.includes(' A') && !attrs.d.includes(' L')), input.chart);
  }
});
