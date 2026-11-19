import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function loadModule(file, dependencies = {}) {
  let result;
  const sandbox = { KChart: { define(id, factory) { result = factory(dependencies); } } };
  vm.runInNewContext(await readFile(path.join(root, 'src/core', file), 'utf8'), sandbox, { filename: file });
  return result;
}
const color = await loadModule('color.js');
const themeApi = await loadModule('theme.js', { 'core/color': color });

// 精确比较旧 CSS 的六套图表色，防止核心迁移造成可见的系列颜色变化。
test('六套主题的图表色与旧 CSS 一致，调色板映射 surface 与首个 tone', () => {
  const expected = {
    claude: ['#2a2621', '#bb5a35', '#5f5a55', '#54220e', '#847f7a', '#b67f6b'],
    paper: ['#23272c', '#2769c6', '#575b62', '#0e3163', '#7c8088', '#6e92c6'],
    obsidian: ['#e1e0e8', '#afaff6', '#98979e', '#8080b5', '#636269', '#5d58a6'],
    tokyo: ['#d9e1f6', '#81aaf7', '#9198ab', '#6686c0', '#61687a', '#3966bc'],
    kanagawa: ['#e8e1d1', '#d4b771', '#9e9889', '#99844f', '#716b5e', '#866700'],
    terminal: ['#d8e5da', '#6de18b', '#909c92', '#439b5b', '#5c675d', '#007232'],
  };
  for (const [id, tones] of Object.entries(expected)) {
    const resolved = themeApi.theme(id);
    assert.deepEqual(Array.from(resolved.tones), tones);
    const palette = themeApi.paletteOf(resolved);
    assert.equal(palette.bg, resolved.surface);
    assert.equal(palette.accent, tones[1]);
    assert.equal(palette.tone1, tones[0]);
    assert.equal(palette.ink, tones[0]);
    assert.equal(palette.muted, resolved.fg3);
    assert.equal(palette.fg, resolved.fg1);
    assert.equal(palette.grid, resolved.line);
    assert.equal(palette.axis, resolved.line2);
    for (const tone of resolved.tones) assert.ok(color.contrast(tone, resolved.surface) >= 3, `${id} tone ${tone} must contrast against surface`);
    for (let i = 0; i < 3; i += 1) for (let j = i + 1; j < 3; j += 1) {
      assert.ok(color.deltaE2000(resolved.tones[i], resolved.tones[j]) >= 15, `${id} tones must be distinct in normal vision`);
      for (const type of ['protan', 'deutan']) assert.ok(color.deltaE2000(color.simulateCvd(resolved.tones[i], type), color.simulateCvd(resolved.tones[j], type)) >= 15, `${id} tones must be distinct for ${type}`);
    }
  }
  assert.ok(Object.isFrozen(themeApi.themes) && Object.isFrozen(themeApi.themes.claude));
});

// 暗色打印采用整套 paper 色值；亮色打印只覆盖页面底色，其他字段逐项保持不变。
test('打印主题策略采用 paper 配色且保留亮色主题其余字段', () => {
  const originalDark = themeApi.theme('obsidian');
  const dark = themeApi.theme('obsidian', { media: 'print' });
  const paper = themeApi.themes.paper;
  assert.equal(dark.id, originalDark.id);
  assert.equal(dark.fontFamily, originalDark.fontFamily);
  assert.equal(dark.scheme, 'light');
  assert.deepEqual(Array.from(dark.tones), Array.from(paper.tones));
  for (const key of ['bg', 'surface', 'surface2', 'line', 'line2', 'fg1', 'fg2', 'fg3', 'fg4', 'accent', 'new', 'info', 'ok', 'warn', 'danger', 'ext']) assert.equal(dark[key], paper[key], `dark print ${key} must use paper`);

  const originalLight = themeApi.theme('claude');
  const light = themeApi.theme('claude', { media: 'print' });
  assert.equal(light.bg, '#ffffff');
  for (const key of Object.keys(originalLight)) if (key !== 'bg') assert.deepEqual(light[key], originalLight[key], `light print preserves ${key}`);
});

// 非法字符串/颜色组合要报 TypeError；自定义输入快照仅复制契约字段并保持调用者对象可变。
test('主题拒绝非法配色并快照有限字段', () => {
  const caller = { ...themeApi.themes.paper, id: undefined, tones: [...themeApi.themes.paper.tones] };
  const cyclicUnknown = {};
  cyclicUnknown.self = cyclicUnknown;
  caller.extra = cyclicUnknown;
  const resolved = themeApi.theme(caller);
  assert.ok(Object.isFrozen(resolved));
  assert.equal(themeApi.theme(resolved), resolved, '库自己的快照可直接复用');
  assert.ok(!Object.isFrozen(caller) && !Object.isFrozen(caller.tones));
  assert.equal('extra' in resolved, false);
  assert.throws(() => themeApi.theme('missing'), (error) => error.name === 'TypeError' && /未知主题/.test(error.message));
  assert.throws(() => themeApi.theme('constructor'), (error) => error.name === 'TypeError' && /未知主题/.test(error.message));
  assert.throws(() => themeApi.theme({ ...caller, bg: 'red' }), (error) => error.name === 'TypeError' && /bg/.test(error.message));
  assert.throws(() => themeApi.theme({ ...caller, tones: [caller.tones[0], caller.tones[0], ...caller.tones.slice(2)] }), (error) => error.name === 'TypeError' && /区分度/.test(error.message));
  assert.throws(() => themeApi.theme({ ...caller, accent: caller.surface }), (error) => error.name === 'TypeError' && /accent.*surface/.test(error.message));
});

// 颜色算法保留旧实现的混色量化与对比度推进语义，并支持主题校验所需 CVD 分析。
test('颜色算法提供旧视觉混色、对比度推进和色觉模拟', () => {
  assert.equal(color.mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(color.contrast('#000000', '#ffffff'), 21);
  assert.ok(color.contrast(color.pushContrast('#777777', '#000000', '#ffffff', 4.5), '#ffffff') >= 4.5);
  assert.equal(color.deltaE2000('#ffffff', '#ffffff'), 0);
  assert.notEqual(color.simulateCvd('#ff0000', 'protan'), '#ff0000');
});

// 受控图标几何在纯模块中解析，无 DOM 依赖，且拒绝任意 SVG 节点。
test('图标几何从组装器数据解析为受控元素且不访问 DOM', async () => {
  const data = JSON.parse(await readFile(path.join(root, 'assets/icons.json'), 'utf8'));
  const icons = await loadModule('icons.js', { 'core/icon-data': data });
  const geometry = icons.geometry('adjustments');
  assert.equal(geometry.set, 'tabler');
  assert.equal(geometry.viewBox, '0 0 24 24');
  assert.equal(geometry.elements[0].tag, 'path');
  assert.ok(icons.has('adjustments'));
  assert.equal(icons.geometry('not-an-icon'), null);
});
