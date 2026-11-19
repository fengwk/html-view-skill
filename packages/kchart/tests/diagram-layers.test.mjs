import { test } from 'vitest';
import assert from 'node:assert/strict';
import { implementations } from '../src/diagram/layers.js';
import { createContext } from '../src/core/context.js';
import { renderScene } from '../src/core/svg.js';
import * as support from '../src/diagram/support.js';

const implementation = implementations.layers;
const create = (source, width = 800, lang = 'zh-CN', theme = 'paper') => {
  const ctx = createContext({ width, lang, theme });
  const parsed = implementation.parse(source, { kind: 'layers', syntax: 'native', lang, firstLine: 2, options: {} });
  const geometry = implementation.layout(parsed.model, { width, lang, ctx, measure: support.measureOf(ctx) });
  return { ctx, parsed, geometry };
};
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// 目标：旧语法层/分组、状态标记、分类、数据库和外部标志都保留，并通过解析错误校验混合结构。
test('layers preserve parsed groups, labels, marks, category rows, and group flags', () => {
  const { parsed } = create('- 服务层 | 对外提供能力\n  - 接入 {ext}: +新增, ~改造, =复用\n  - 分类组\n    - 数据 > MySQL, Redis\n  - 仓库 {db}: PostgreSQL');
  assert.equal(parsed.errors.length, 0);
  const [entry, category, database] = parsed.model.layers[0].groups;
  assert.equal(JSON.stringify(entry.items.map(({ label, mark, tone }) => [label, mark, tone])), JSON.stringify([['+ 新增', '+', 'new'], ['~ 改造', '~', 'info'], ['= 复用', '=', 'ok']]));
  assert.equal(entry.flag, 'ext');
  assert.equal(category.categories[0].label, '数据');
  assert.equal(database.flag, 'db');
  const mixed = create('- Layer\n  - API: Gateway\n- Storage: Redis', 800, 'en');
  assert.ok(mixed.parsed.errors.some(error => /Do not mix layers and groups/.test(error.message)));
});

// 目标：无层的顶层分组仍能适配窄宽度并保留源码顺序，而不是强制套用层布局。
test('unlayered groups remain supported and pack into rows in source order', () => {
  const { parsed, geometry } = create('- API: Gateway, Service API\n- Storage {db}: MySQL, Redis\n- Metrics: Logs, Traces', 360);
  assert.equal(parsed.errors.length, 0);
  assert.equal(geometry.errors.length, 0);
  assert.equal(JSON.stringify(geometry.groups.map(group => group.title)), JSON.stringify(['API', 'Storage', 'Metrics']));
  assert.ok(geometry.width >= 360);
  assert.ok(geometry.nodes.some(node => node.shape === 'db'));
});

// 目标：保留 8 层/每层 6 组/每组 30 项限制和能力标签超长错误，避免迁移后放宽输入边界。
test('layers enforce the existing layer, group, item, and label limits', () => {
  const layerLimit = create(Array.from({ length: 9 }, (_, i) => `- L${i}\n  - G: x`).join('\n'));
  assert.ok(layerLimit.parsed.errors.some(error => /最多 8 层/.test(error.message)));
  const groupLimit = create(`- L\n${Array.from({ length: 7 }, (_, i) => `  - G${i}: x`).join('\n')}`);
  assert.ok(groupLimit.parsed.errors.some(error => /每层最多 6 组/.test(error.message)));
  const itemLimit = create(`- L\n  - G: ${Array.from({ length: 31 }, (_, i) => `i${i}`).join(', ')}`);
  assert.ok(itemLimit.parsed.errors.some(error => /每组最多 30 项/.test(error.message)));
  const longLabel = create(`- L\n  - G: ${'超长'.repeat(25)}`, 800, 'en');
  assert.ok(longLabel.geometry.errors.some(error => error.line === 3 && /too long/.test(error.message)));
});

// 目标：同层统一网格行数、共享底边和等权分配；窄宽度应返回可用固有宽度，不缩放紧凑布局。
test('layer geometry keeps equal-height rows and fitted minimum width across narrow inputs', () => {
  const source = '- 数据层 | 持久化\n  - 服务: A, B, C, D, E, F, G\n  - 数据库 {db}: MySQL, Redis, MQ, NOS, ES, Oracle, ClickHouse, TiDB, Doris\n- 应用层\n  - API: Gateway, Service API';
  for (const width of [800, 688, 360]) {
    const { ctx, parsed, geometry } = create(source, width);
    assert.equal(parsed.errors.length, 0);
    assert.equal(geometry.errors.length, 0);
    assert.ok(geometry.width >= width);
    assert.ok(geometry.height > 0);
    const firstLayer = geometry.layers[0];
    const row = geometry.groups.filter(group => group.y === firstLayer.y);
    assert.ok(row.every(group => group.h === row[0].h));
    assert.ok(row.every(group => group.y + group.h === firstLayer.y + firstLayer.h));
    assert.equal(row[0].rows, row[1].rows);
    for (let i = 0; i < row.length; i++) for (let j = i + 1; j < row.length; j++) assert.equal(overlap(row[i], row[j]), false);
    const nodes = geometry.nodes.filter(node => node.group === row[1].id);
    assert.ok(nodes.every(node => node.shape === 'db'));
    for (const node of geometry.nodes) assert.ok(ctx.measure(node.label, 13, 400) + 16 <= node.w + 0.01, node.label);
  }
});

// 目标：输出仅含 SVG 场景图元，主题色、状态色、虚线和数据库形态不依赖宿主 CSS。
test('layer scenes carry their own resolved theme styling in standalone SVG', () => {
  const { ctx, geometry } = create('- Backend | services\n  - API {ext}: +Added, ~Changed, =Existing, Plain\n  - Storage {db}: PostgreSQL');
  const model = implementation.scene(geometry, ctx, { kind: 'layers' });
  const rendered = renderScene(model, { theme: ctx.design });
  assert.match(rendered, /<svg/);
  assert.match(rendered, /stroke-dasharray="5 4"/);
  assert.match(rendered, /database-rim/);
  assert.match(rendered, />\+<\/text>/);
  assert.match(rendered, />~<\/text>/);
  assert.match(rendered, />=<\/text>/);
  assert.match(rendered, /text-anchor="middle"[^>]*>Backend<\/text>/);
  assert.match(rendered, /text-anchor="middle"[^>]*>API<\/text>/);
  assert.match(rendered, /text-anchor="middle"[^>]*>Plain<\/text>/);
  assert.doesNotMatch(rendered, /class=|style=/);
  for (const color of [ctx.design.fg1, ctx.design.fg2, support.appearance(ctx).node, ctx.design.new, ctx.design.info, ctx.design.ok,
    ctx.mix(ctx.design.bg, ctx.color('tone1'), .07), ctx.mix(ctx.design.bg, ctx.color('tone1'), .45)]) assert.ok(rendered.includes(color), `missing expected theme color ${color}`);
});

// 目标：Claude 的分组框与普通能力框按主题 tint 变浅（读作浅橙而非鲑粉），状态色节点仍按原色相变浅。
test('layer tints follow the theme tint while status colors keep their own hue', () => {
  const { ctx, geometry } = create('- 触达\n  - 渠道: 小程序\n- 交易\n  - 订单: +下单, 支付', 800, 'zh-CN', 'claude');
  const rendered = renderScene(implementation.scene(geometry, ctx, { kind: 'layers' }), { theme: ctx.design });
  const { bg } = ctx.design, tone2 = ctx.color('tone2');
  assert.notEqual(ctx.tint(bg, tone2, .45), ctx.mix(bg, tone2, .45));
  for (const color of [ctx.tint(bg, tone2, .07), ctx.tint(bg, tone2, .45), ctx.tint(bg, tone2, .4), ctx.mix(bg, ctx.design.new, .4)]) assert.ok(rendered.includes(color), `missing ${color}`);
  for (const color of [ctx.mix(bg, tone2, .07), ctx.mix(bg, tone2, .45), ctx.tint(bg, ctx.design.new, .4)]) assert.ok(!rendered.includes(color), `unexpected ${color}`);
});
