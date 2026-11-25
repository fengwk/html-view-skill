import { test } from 'vitest';
import assert from 'node:assert/strict';
import { theme as resolveTheme, themes as builtInThemes } from '../src/core/theme.js';
import { loadChart } from './kchart-fixture.mjs';

const { api: base } = loadChart();
const api = { ...base, validate: undefined, ...base.createRegistry((spec) => api.validate?.(spec)) };
const plain = (value) => JSON.parse(JSON.stringify(value));
// 主题类检查遍历登记表，新增主题自动纳入。
const THEMES = Object.keys(builtInThemes);

// 意图：纯核心不依赖 DOM；注册器未绑定校验器时不能直接跑布局。
test('core loads without DOM and refuses to lay out without a validator', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof api.validate, 'undefined');
  assert.throws(() => base.createRegistry().layout({ chart: 'unvalidated' }), /未绑定声明校验器/);
  assert.deepEqual(plain(api.util.extent([3, -2, null, NaN])), [-2, 3]);
  assert.deepEqual(plain(api.util.extent([null, -4])), [-4, -4]);
  assert.equal(typeof api.util.context, 'function');
  assert.equal(api.util.linear(0, 10, 0, 100)(2.5), 25);
  assert.equal(api.util.hash('stable'), api.util.hash('stable'));
  assert.equal(typeof api.renderScene, 'function');
  assert.equal(api.util.mix('#000000', '#ffffff', 0.5), '#808080');
});

// 意图：各内置主题角色直接用对应色值；变更渲染方式不能改变用户看到的颜色。
test('concrete theme roles preserve every built-in theme palette', () => {
  api.validate = (spec) => ({ errors: [], data: spec });
  api.register('palette-test', (spec, ctx) => ({ width: ctx.width, height: 1, children: [], palette: ctx.palette, roles: Object.fromEntries(['ink', 'accent', 'fg', 'muted', 'bg', 'grid', 'axis', 'tone1', 'tone2', 'tone3', 'tone4', 'tone5', 'tone6'].map((role) => [role, ctx.color(role)])) }));
  for (const theme of THEMES) {
    const colors = resolveTheme(theme);
    const ctx = api.layout({ chart: 'palette-test' }, { theme });
    const expected = { ink: colors.tones[0], accent: colors.tones[1], fg: colors.fg1, muted: colors.fg3, bg: colors.surface, grid: colors.line, axis: colors.line2 };
    for (const [role, value] of Object.entries(expected)) {
      assert.equal(ctx.palette[role], value, `${theme} ${role} palette fallback`);
      assert.equal(ctx.roles[role], value, `${theme} ${role} appears without a CSS fallback`);
    }
    for (let i = 1; i <= 6; i += 1) assert.equal(ctx.palette[`tone${i}`], colors.tones[i - 1]);
  }
});

// 意图：图族按主题明暗选择语义色时读取与主题文件一致的 scheme，而不是各自硬编码主题名单。
test('context scheme follows each theme file and titled() only wraps when a tip exists', () => {
  api.validate = (spec) => ({ errors: [], data: spec });
  api.register('scheme-test', (spec, ctx) => {
    const node = ctx.rect(0, 0, 1, 1);
    return { width: 1, height: 1, children: [], scheme: ctx.scheme, bare: ctx.titled(node, ''), tipped: ctx.titled(node, '甲：3 件') };
  });
  for (const theme of THEMES) {
    const { scheme } = resolveTheme(theme);
    assert.equal(api.layout({ chart: 'scheme-test' }, { theme }).scheme, scheme, theme);
  }
  const result = api.layout({ chart: 'scheme-test' }, { theme: 'claude' });
  assert.equal(result.bare.tag, 'rect');
  assert.equal(result.tipped.tag, 'g');
  assert.deepEqual(Array.from(result.tipped.children, (child) => `${child.tag}:${child.text ?? ''}`), ['rect:', 'title:甲：3 件']);
});

// 意图：确保场景序列化稳定、文本与meta转义，并拒绝可执行标记和不安全属性，覆盖SVG注入风险。
test('scene SVG serializer is deterministic, accessible and rejects unsafe SVG input', () => {
  const scene = { width: 120, height: 40, title: 'A <chart>', description: 'summary & detail', children: [
    { tag: 'text', attrs: { x: 2, y: 14, fill: 'currentColor' }, text: '<hello & goodbye>', meta: { id: 'row-1', related: ['a', 'b'] } },
  ] };
  const one = api.renderScene(scene);
  assert.equal(api.renderScene(scene), one);
  assert.match(one, /role="img"/);
  assert.match(one, /aria-labelledby="kc-[\w-]+-title"/);
  assert.match(one, /A &lt;chart&gt;/);
  assert.match(one, /&lt;hello &amp; goodbye&gt;/);
  assert.match(one, /data-kc-related="\[&quot;a&quot;,&quot;b&quot;\]"/);
  assert.throws(() => api.util.el('script'), /Unsafe SVG tag/);
  assert.throws(() => api.util.el('rect', { onclick: 'run()' }), /Unsafe SVG attribute/);
  assert.throws(() => api.renderScene({ width: 2, height: 2, children: [{ tag: 'rect', attrs: { fill: 'url(https://evil)' } }] }), /Unsafe SVG resource reference/);
  assert.throws(() => api.renderScene({ width: 2, height: 2, children: [{ tag: 'rect', attrs: { fill: 'url(#safe) url(https://evil)' } }] }), /Unsafe SVG resource reference/);
  assert.throws(() => api.renderScene({ width: 2, height: 2, children: [{ tag: 'image', attrs: { href: 'https://evil' } }] }), /Unsafe SVG tag/);
  const ids = api.renderScene({ width: 2, height: 2, children: [{ tag: 'defs', children: [{ tag: 'linearGradient', attrs: { id: 'fade' } }] }, { tag: 'rect', attrs: { fill: 'url(#fade)' } }] }, { prefix: 'unique' });
  assert.match(ids, /id="unique-fade"/);
  assert.match(ids, /fill="url\(#unique-fade\)"/);
});

// 意图：验证注册不可覆盖、装饰器只包装默认布局且布局验证失败可区分错误，规避图型串扰。
test('layout registry and decorator wrap a default layout without overriding it', () => {
  api.register(['bar', 'line'], (spec, ctx) => ctx.scene(20, [ctx.text(1, 12, spec.title)]));
  assert.throws(() => api.register('bar', () => ({})), /already registered/);
  assert.throws(() => api.layouts.set('evil', () => {}), /read-only/);
  assert.throws(() => api.layouts.forEach((layout, name, map) => map.set('evil', layout)), /read-only/);
  assert.throws(() => api.layouts.valueOf().set('evil', () => {}), /read-only/);
  api.decorate('bar', (spec, ctx, next) => {
    const scene = next();
    scene.children.push(ctx.text(2, 18, 'decorated'));
    return scene;
  });
  assert.throws(() => api.decorate('bar', () => ({})), /already registered/);
  api.validate = (spec) => ({ errors: [], data: spec });
  const scene = api.layout({ chart: 'bar', title: 'valid' }, { width: 200 });
  assert.equal(scene.width, 200);
  assert.equal(scene.children.length, 2);
  assert.match(api.render({ chart: 'line', title: 'line' }).svg, /<svg/);
  assert.throws(() => api.layout({ chart: 'missing' }), (error) => error.code === 'BAD_KCHART' && /未装入 missing/.test(error.message));
});

// 意图：锁定日期补档、长表系列保留原行和缺失填null；风险是公共表格助手丢业务记录或暗中聚合。
test('table helper expands dates and long rows without aggregation', () => {
  const rows = [
    { day: '2024-02-01', channel: 'web', amount: 2, detail: 'first' },
    { day: '2024-02-03', channel: 'web', amount: 5, detail: 'second' },
    { day: '2024-02-03', channel: 'store', amount: 7, detail: 'third' },
  ];
  api.register('table-test', (spec, layoutCtx) => ({ table: layoutCtx.table(spec), width: layoutCtx.width, height: 1, children: [] }));
  const result = api.layout({ chart: 'table-test', data: rows, encode: { category: 'day', value: 'amount', series: 'channel' }, fields: { day: { type: 'date' } } }, { width: 300 });
  assert.equal(result.width, 300);
  const table = plain(result.table);
  assert.deepEqual(table.rows, rows);
  assert.deepEqual(table.categories, ['2024-02-01', '2024-02-02', '2024-02-03']);
  assert.deepEqual(table.series.map((s) => [s.id, s.values]), [['web', [2, null, 5]], ['store', [null, null, 7]]]);
  const early = api.layout({ chart: 'table-test', data: [{ day: '0024-02-28', amount: 1 }, { day: '0024-03-01', amount: 2 }], encode: { category: 'day', value: 'amount' }, fields: { day: { type: 'date' } } });
  assert.deepEqual(plain(early.table.categories), ['0024-02-28', '0024-02-29', '0024-03-01']);
  const ordered = api.layout({ chart: 'table-test', data: [{ group: 'a', score: 3 }, { group: 'b', score: 9 }, { group: 'c', score: 5 }], encode: { category: 'group', value: 'score' }, sort: { field: 'score', direction: 'desc' } });
  assert.deepEqual(plain(ordered.table.categories), ['b', 'c', 'a']);
  assert.deepEqual(plain(ordered.table.series[0].values), [9, 5, 3]);
  const domain = api.layout({ chart: 'table-test', data: [{ group: 'b', score: 2 }, { group: 'a', score: 1 }], encode: { category: 'group', value: 'score' }, fields: { group: { domain: ['c', 'b', 'a'] } }, sort: { field: 'score', direction: 'desc' } });
  assert.deepEqual(plain(domain.table.categories), ['c', 'b', 'a']);
  const times = api.layout({ chart: 'table-test', data: [{ at: '2024-03-01T00:00:00Z', value: 2 }, { at: '2024-03-01T00:00:00+02:00', value: 1 }], encode: { category: 'at', value: 'value' }, fields: { at: { type: 'datetime' } } });
  assert.deepEqual(plain(times.table.categories), ['2024-03-01T00:00:00+02:00', '2024-03-01T00:00:00Z']);
  assert.throws(() => api.layout({ chart: 'table-test', data: [{ day: '0001-01-01', amount: 1 }, { day: '9999-01-01', amount: 2 }], encode: { category: 'day', value: 'amount' }, fields: { day: { type: 'date' } } }), (error) => error.code === 'CHART_FIT' && /跨度过大/.test(error.message));
});

// 意图：确保数字刻度与格式共用核心，并验证换行和图例保留注入的测字。
test('formatting, ticks, wrapping and legend use shared context behavior', () => {
  api.register('helper-test', (spec, ctx) => ({
    width: ctx.width, height: 1, children: [],
    label: ctx.format(0.981, 'rate'), ticks: ctx.ticks([0, 0.005, 0.015], 'rate'),
    raw: ctx.format(1.005, 'raw'), rounded: ctx.format(1.005, 'rounded'), precise: ctx.format(12.3456789, 'raw'), unitValue: ctx.format(12, 'position'),
    positioned: ctx.ticks([12], 'position'),
    wrapped: ctx.wrap('alpha beta', 35, 12),
    flowed: ctx.flow(['甲 26.5%', '乙 31.2%', '合计 68'], 72, 12),
    oversized: ctx.flow(['A 1%', 'First-time buyers 9%', 'B 2%'], 88, 12),
    chinese: ctx.wrap('监控告警与容量评估', 65, 13, 400),
    legend: ctx.legend([{ label: 'long label', color: '#123456' }], 100),
    palette: ctx.palette, extent: ctx.extent, linear: ctx.linear, hash: ctx.hash,
  }));
  const out = api.layout({ chart: 'helper-test', unit: 'h', encode: { value: 'position' }, annotations: [{ kind: 'rule', field: 'position', value: 40 }, { kind: 'band', field: 'position', from: 30, to: 35 }], fields: { rate: { format: 'percent' }, raw: {}, rounded: { decimals: 2 }, position: { domain: [10, 20] } } }, { theme: 'paper', measure: (text) => [...text].length * 8 });
  assert.equal(out.label, '98.1%');
  assert.equal(out.raw, '1.005');
  assert.equal(out.rounded, '1.01');
  assert.equal(out.precise, '12.345679');
  assert.equal(out.unitValue, '12 h');
  assert.ok(out.positioned.min <= 10 && out.positioned.max >= 40);
  assert.deepEqual(plain(out.ticks.ticks), [0, 0.005, 0.01, 0.015]);
  assert.deepEqual(plain(out.ticks.labels), ['0%', '0.5%', '1%', '1.5%']);
  assert.ok(out.wrapped.length > 1);
  assert.equal(out.wrapped.join('').replace(/\s/g, ''), 'alphabeta');
  assert.ok(out.wrapped.every((line) => [...line].length * 8 <= 35));
  assert.deepEqual(plain(out.flowed), [['甲 26.5%'], ['乙 31.2%'], ['合计 68']], 'flow wraps between atomic items without splitting labels');
  // 比行宽还宽的单个条目独占几行并在行宽内换行，前后条目仍完整。
  assert.deepEqual(plain(out.oversized), [['A 1%'], ['First-time'], ['buyers 9%'], ['B 2%']], 'an item wider than the row wraps on its own lines');
  assert.deepEqual(plain(out.chinese), plain(api.util.wrapText('监控告警与容量评估', 65, { size: 13, weight: 400 }, (text) => [...text].length * 8)));
  assert.equal(out.chinese.join(''), '监控告警与容量评估');
  for (const line of out.chinese.slice(1)) assert.doesNotMatch(line, /^[），、。！？：；]/);
  assert.ok(out.legend.height > 0);
  assert.equal(out.palette.ink, '#23272c');
  const histogram = api.util.context({ spec: { chart: 'histogram', unit: 'h', encode: { lower: 'lo', upper: 'hi', count: 'count' } } });
  assert.equal(histogram.field('lo').unit, 'h');
  assert.equal(histogram.field('count').unit, undefined);
  const violin = api.util.context({ spec: { chart: 'violin', unit: 'h', encode: { density: 'densityValue', median: 'medianValue' } } });
  assert.equal(violin.field('densityValue').unit, 'h⁻¹');
  assert.equal(violin.field('medianValue').unit, 'h');
  api.register('log-test', (spec, ctx) => ({ width: ctx.width, height: 1, children: [ctx.text(0, 0, ctx.ticks([1, 100], 'logValue').labels[0])] }));
  assert.throws(() => api.layout({ chart: 'log-test', fields: { logValue: { scale: 'log', domain: [1, 100] } } }), /Logarithmic ticks must be calculated by the chart layout/);
  assert.equal(typeof out.extent, 'function');
  assert.equal(out.extent([null, 2])[0], 2);
  assert.equal(out.linear(0, 2, 0, 10)(1), 5);
  assert.equal(out.hash('same'), out.hash('same'));
});

// 意图：上游合计带来的浮点误差不能变成 6 位小数；横轴刻度文字放不下时减少刻度而不是互盖。
test('formatting ignores float noise and horizontal ticks thin out to fit their labels', () => {
  api.validate = (spec) => ({ errors: [], data: spec });
  const measure = (text) => [...String(text)].length * 7;
  api.register('noise-test', (spec, ctx) => ({
    width: ctx.width, height: 1, children: [],
    noisy: ctx.format(183.1 + 0.01, 'value'),
    roomy: ctx.ticks([0, 1234567], 'value', { length: 600 }),
    tight: ctx.ticks([0, 1234567], 'value', { length: 120 }),
  }));
  const out = api.layout({ chart: 'noise-test', fields: { value: {} } }, { measure });
  assert.equal(out.noisy, '183.11');
  const spacing = (ticks, length) => length / (ticks.ticks.length - 1);
  const widest = (ticks) => Math.max(...ticks.labels.map(measure));
  assert.ok(out.roomy.ticks.length > out.tight.ticks.length, '窄轴应少于宽轴的刻度数');
  assert.ok(widest(out.tight) + 8 <= spacing(out.tight, 120), '窄轴的相邻刻度文字至少隔 8px');
  assert.ok(out.tight.ticks[0] <= 0 && out.tight.ticks.at(-1) >= 1234567, '减少刻度后仍覆盖数据范围');
});

// 意图：布局把文字排到场景外时，核心整体平移并扩大场景，文字不被画布裁掉；放得下时场景原样返回。
test('layout contains every text inside the scene and reports how far it grew', () => {
  api.validate = (spec) => ({ errors: [], data: spec });
  const measure = (text) => [...String(text)].length * 10;
  api.register('contain-test', (spec, ctx) => ctx.scene(40, spec.inside ? [ctx.text(4, 20, 'ok')] : [
    ctx.text(6, 20, 'left label', { anchor: 'end' }),
    ctx.el('g', { transform: 'translate(90 0)' }, [ctx.text(0, 8, 'edge')]),
  ]));
  const fitted = api.layout({ chart: 'contain-test', inside: true }, { width: 100, measure });
  assert.equal(fitted.overflow, undefined);
  assert.equal(fitted.width, 100);
  const grown = api.layout({ chart: 'contain-test' }, { width: 100, measure });
  // 左侧右对齐文字从 x=-94 开始；平移后的组内文字到 x=130；顶部文字上沿在 y=8-9.6。
  assert.deepEqual(plain(grown.overflow), { left: 94, top: 2, right: 30, bottom: 0 });
  assert.equal(grown.width, 224);
  assert.equal(grown.height, 42);
  assert.equal(grown.children.length, 1);
  assert.equal(grown.children[0].attrs.transform, 'translate(94 2)');
});

// 意图：独立SVG不能携带无效几何，图例需要一个稳定交互身份而非逐字焦点。
test('scene rejects invalid geometry and legend groups carry series identity', () => {
  for (const attrs of [{cx:NaN}, {r:-2}, {d:'MNaN,10 L20,30'}, {points:'0,0 Infinity,2'}]) {
    assert.throws(() => api.renderScene({width:40,height:40,children:[{tag:'path',attrs}]}), /geometry|dimension/);
  }
  const ctx=api.util.context({spec:{chart:'sankey',unit:'人'}});
  assert.equal(ctx.field('edge.value').unit,'人');
  const legend=ctx.legend([{label:'系列一',color:ctx.color('ink'),meta:{series:'s'}}],200);
  assert.equal(legend.children[0].meta.kind,'legend');
  assert.equal(legend.children[0].meta.series,'s');
  assert.match(api.renderScene(ctx.scene(40,legend.children)),/font-family="system-ui/);
});

// 主题角色色以 var(--x,#hex) 输出，测试取其中的实际色值计算对比度。
const hexIn = (value) => String(value).match(/#[0-9a-f]{6}/gi).at(-1);

// 意图：着色文字与填充上的文字在各内置主题下都达到正文 4.5:1；已达标的角色色原样保留主题变量。
test('textColor and textOn reach body-text contrast on page and filled backgrounds in every theme', () => {
  for (const theme of THEMES) {
    const ctx = api.util.context({ theme });
    for (const role of ['accent', 'ink', 'tone1', 'tone2', 'tone3', 'tone4', 'tone5', 'tone6']) {
      const color = ctx.textColor(role);
      assert.ok(api.util.contrast(hexIn(color), ctx.palette.bg) >= 4.5, `${theme} ${role} text on page`);
      if (api.util.contrast(ctx.palette[role], ctx.palette.bg) >= 4.5) assert.equal(color, ctx.color(role), `${theme} ${role} keeps theme color`);
      const solid = ctx.textOn(role);
      assert.ok(api.util.contrast(hexIn(solid), ctx.palette[role]) >= 4.5, `${theme} text on ${role}`);
      const under = api.util.mix(ctx.palette.grid, ctx.palette[role], 0.28);
      const translucent = ctx.textOn(role, { opacity: 0.28, over: 'grid' });
      assert.ok(api.util.contrast(hexIn(translucent), under) >= 4.5, `${theme} text on translucent ${role}`);
    }
    assert.throws(() => ctx.textColor('not-a-role'), /Unknown color/);
  }
});

// 意图：最大余数法总数精确、余数大者优先、同余数按原顺序，华夫与点阵变体共用此分配。
test('apportion distributes whole units by largest remainder with stable ties', () => {
  assert.deepEqual(plain(api.util.apportion([1, 1, 1], 100)), [34, 33, 33]);
  assert.deepEqual(plain(api.util.apportion([18, 12, 22, 16], 100)), [26, 18, 32, 24]);
  assert.deepEqual(plain(api.util.apportion([0, 5], 10)), [0, 10]);
  assert.deepEqual(plain(api.util.apportion([0, 0], 10)), [0, 0]);
});
