import { test } from 'vitest';
import assert from 'node:assert/strict';
import { implementations } from '../src/diagram/blocks.js';
import { createContext } from '../src/core/context.js';
import { renderScene } from '../src/core/svg.js';
import { fallbackMeasure } from '../src/diagram/support.js';

const implementation = implementations.blocks;
const info = { kind: 'blocks', syntax: 'blocks', header: 'blocks', headerLine: 1, firstLine: 2, options: {}, lang: 'zh' };
const complexSource = 'col\n  row\n    box Side\n    box Knowledge\n      col\n        box Content\n          short, popular\n        box Index\n          trend, official\n    box Operations\n  row\n    box Store {db}: [icon:database] records\n    box Vector: [icon:vector-triangle] embedding\n    box Config {db}: settings\nStore -> Vector: encode\nVector -> Config: persist';
const legacyFixtures = [
  complexSource,
  `row\n  box 评论域 {ext}\n    评论查询, 评论组装\n  col 3\n    box 空降活动模块\n      活动配置, 资源位投放, 艺人互动\n    row\n      box 空降评论模块: 艺人评论索引, 用户评论索引\n      box 空降后台模块: 活动管理, 权限隔离\n评论域 -> 空降活动模块: RPC 调用\n评论域 ~> 空降评论模块: 消息同步`,
  `col\n  row\n    box 元数据: 订单, 网盘, 设备, 图片\n    box 消息数据: 通讯, 内容流, 设备, 队列\n    box 时空数据: 监控, 轨迹, 时序, 溯源\n  row\n    col\n      box 数据通道 {ext}\n        [icon:database] 业务库, [icon:app-window] 应用\n      box 计算引擎\n        [icon:table] 宽表, [icon:timeline] 时序\n    col 2\n      box 实时计算\n        [icon:activity] 流计算, [icon:function] 函数\n      box 数据湖\n        [icon:server] 批量计算, [icon:schema] 数据开发`,
  `col\n  box A: 一, 二\n  box B: 三, 四\n  box C: 五, 六\nA -> B: submit\nB ~> C: long queued job`,
];

function layoutOf(source, width = 1040) {
  const parsed = implementation.parse(source, info);
  assert.equal(parsed.errors.length, 0, JSON.stringify(parsed.errors));
  const geometry = implementation.layout(parsed.model, { width, lang: info.lang, measure: fallbackMeasure }, info);
  assert.equal(geometry.errors.length, 0, JSON.stringify(geometry.errors));
  return geometry;
}

function draw(source, width = 480) {
  const ctx = createContext({ width, theme: 'paper' });
  const parsed = implementation.parse(source, info);
  if (parsed.errors.length) return { ...parsed, ctx };
  const geometry = implementation.layout(parsed.model, {
    width, lang: info.lang, measure: (text, font) => ctx.measure(text, font.size, font.weight),
  }, info);
  return { ...parsed, geometry, scene: implementation.scene(geometry, ctx, info), ctx };
}

// 覆盖嵌套容器、能力状态、数据库/扩展标记和异步关系；纯场景可由公共 SVG 序列化器渲染。
test('blocks 保留容器与能力标记，并将异步关系输出为正交纯 SVG 场景', () => {
  const result = draw('row\n  box Store {db} : [icon:database] + ingest, = ready\n  box Worker {ext} : ~ process\nStore ~> Worker: queued');
  assert.equal(result.errors.length, 0);
  assert.equal(result.geometry.errors.length, 0);
  assert.equal(result.geometry.frames.length, 2);
  assert.deepEqual(Array.from(result.geometry.nodes, (node) => node.tone), ['new', 'ok', 'info']);
  assert.equal(result.geometry.edges[0].async, true);
  assert.match(result.geometry.edges[0].path, /[HV]\d/);
  const rendered = renderScene(result.scene, { theme: 'paper', frame: false });
  assert.match(rendered, /<marker id="kc-[^"]+-blocks-arrow-async"/);
  assert.match(rendered, /stroke-dasharray="5 4"/);
  assert.match(rendered, /data-kc-kind="container"/);
  assert.match(rendered, /data-kc-kind="capability"/);
  assert.match(rendered, /scale\(\.8\)/);
  assert.match(rendered, /<tspan fill="#[0-9a-f]{6}">\+<\/tspan>/i);
  assert.match(rendered, /data-kc-mark="\+"/);
  assert.match(rendered, /queued/);
  assert.doesNotMatch(rendered, /class=|style=|="undefined"/);
});

// 输入边界由 parser 而非布局推测：重复容器、未知图标和关系目标需给出诊断。
test('blocks 对重复目标、未知图标与缩进关系返回行级诊断', () => {
  const result = implementation.parse('row\n  box A : [icon:not-a-real-icon] run\n  box A\n  A -> Missing', info);
  assert.ok(result.errors.some((item) => item.message.includes('重复')));
  assert.ok(result.errors.some((item) => item.message.includes('未知图标')));
  assert.ok(result.errors.some((item) => item.message.includes('不存在或不唯一')));
  assert.ok(result.errors.every((item) => Number.isInteger(item.line) && item.line >= info.firstLine));
});

// 竖排容器的箭头占用关系间隙；同时锁定嵌套层数与不支持选项的输入边界。
test('blocks 竖排关系使用垂直通道并报告结构边界', () => {
  const result = draw('col\n  box A\n  box B\nA -> B: depends');
  assert.equal(result.errors.length, 0);
  assert.equal(result.geometry.errors.length, 0);
  assert.match(result.geometry.edges[0].path, /V\d/);
  const tooDeep = implementation.parse('box A\n  box B\n    box C\n      box D\n        box E', info);
  assert.ok(Array.from(tooDeep.errors, (item) => item.message).some((message) => message.includes('超过')));
  const unsupported = implementation.parse('box A', { ...info, options: { direction: 'LR' } });
  assert.ok(Array.from(unsupported.errors, (item) => item.message).some((message) => message.includes('不支持')));
});

// 关系标签占用实际预留间隙；不可相邻的目标不能穿过中间容器连线。
test('blocks 保留关系标签通道并拒绝穿框路由', () => {
  const labelled = draw('row\n  box A: one\n  box B: two\nA -> B: 客户端发起请求后由服务端完成校验', 800);
  assert.equal(labelled.geometry.errors.length, 0);
  const edge = labelled.geometry.edges[0];
  assert.equal(edge.labelLines.length, 2);
  assert.ok(edge.labelBox.x >= edge.gap.x - .5);
  assert.ok(edge.labelBox.x + edge.labelBox.w <= edge.gap.x + edge.gap.w + .5);
  const blocked = draw('row\n  box A: one\n  box B: two\n  box C: three\nA -> C: jump', 800);
  assert.equal(blocked.geometry.edges.length, 0);
  assert.ok(blocked.geometry.errors.some((item) => item.message.includes('没有可用箭头通道')));
});

// 回归旧知识库样张的嵌套框、底座及关系通道，避免只在浅层小例子上通过。
test('blocks 保持旧复杂嵌套图的边界与稳定布局', () => {
  const result = draw(complexSource, 1040);
  assert.equal(result.errors.length, 0);
  assert.equal(result.geometry.errors.length, 0);
  assert.equal(result.geometry.frames.length, 8);
  assert.equal(result.geometry.edges.length, 2);
  const frame = (name) => result.geometry.frames.find((item) => item.title === name);
  const contains = (outer, inner) => outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.w >= inner.x + inner.w && outer.y + outer.h >= inner.y + inner.h;
  assert.equal(contains(frame('Knowledge'), frame('Content')), true);
  assert.equal(contains(frame('Knowledge'), frame('Index')), true);
  assert.ok(frame('Store').y >= frame('Knowledge').y + frame('Knowledge').h);
});

// 搬迁旧解析器的行号、唯一名称、图标建议、深度/数量/标签上限断言。
test('blocks 保留旧解析边界与可操作错误建议', () => {
  const parse = (source, options = {}) => implementation.parse(source, { ...info, options });
  const indent = parse('row\n  box A: one\n box B: two');
  assert.ok(indent.errors.some((item) => item.line === 4 && item.message.includes('缩进')));
  const icon = parse('box A: [icon:databse] storage');
  assert.ok(icon.errors.some((item) => item.line === 2 && item.message.includes('未知图标') && item.fix.includes('database')));
  const duplicate = parse('row\n  box A: one\n  box A: two');
  assert.ok(duplicate.errors.some((item) => item.line === 4 && item.message.includes('重复')));
  const edgeLines = ['row', '  box A: one', '  box B: two', ...Array.from({ length: 9 }, () => 'A -> B: call')];
  const limitedEdges = parse(edgeLines.join('\n'));
  assert.ok(limitedEdges.errors.some((item) => item.line === 13 && item.message.includes('最多 8')));
  const tooDeep = parse('box a\n  box b\n    box c\n      box d\n        box e: fifth');
  assert.ok(tooDeep.errors.some((item) => item.message.includes('嵌套')));
  const tooManyBoxes = parse(['col', ...Array.from({ length: 81 }, (_, i) => `  box B${i}: item`)].join('\n'));
  assert.ok(tooManyBoxes.errors.some((item) => item.message.includes('80')));
  const tooManyItems = parse(`box Total: ${Array.from({ length: 161 }, (_, i) => `item${i}`).join(', ')}`);
  assert.ok(tooManyItems.errors.some((item) => item.message.includes('160')));
  const longEdge = parse(`row\n  box A: one\n  box B: two\nA -> B: ${'x'.repeat(25)}`);
  assert.ok(longEdge.errors.some((item) => item.line === 5 && item.message.includes('过长') && item.fix.includes('24')));
});

// 保留旧布局断言：网格等宽、对称内边距、标题侧栏、同排等高及列底边对齐。
test('blocks 保留旧能力网格、边距和兄弟高度断言', () => {
  const rowLengths = (nodes, title) => {
    const rows = new Map();
    for (const node of nodes.filter((item) => !title || item.parent.title === title)) rows.set(node.y, (rows.get(node.y) || 0) + 1);
    return [...rows.values()];
  };
  const grid = layoutOf('row\n  box A: 一, 二, 三, 四\n  box B: 一, 二, 三, 四\n  box C: 一, 二, 三, 四\n  box D: 一, 二, 三, 四');
  for (const title of ['A', 'B', 'C', 'D']) assert.deepEqual(rowLengths(grid.nodes, title), [2, 2]);
  assert.ok(Math.max(...grid.nodes.map((node) => node.w)) - Math.min(...grid.nodes.map((node) => node.w)) <= 1);
  for (const frame of grid.frames) {
    const own = grid.nodes.filter((node) => node.parent.title === frame.title);
    const left = Math.min(...own.map((node) => node.x)) - frame.x;
    const right = frame.x + frame.w - Math.max(...own.map((node) => node.x + node.w));
    assert.ok(Math.abs(left - right) <= 1, `${frame.title} ${left}/${right}`);
    assert.ok(own.every((node) => node.y >= frame.y + 36 - .5));
  }
  const wide = layoutOf('box Wide: 一, 二, 三, 四');
  assert.deepEqual(rowLengths(wide.nodes), [4]);
  assert.ok(wide.nodes.every((node) => node.w <= 260));
  const sidebars = layoutOf('row\n  box Entry\n  box Knowledge\n    col\n      box Content: short, popular, trend, official\n  box Operations');
  const getWidth = (title) => sidebars.frames.find((frame) => frame.title === title).w;
  assert.ok(getWidth('Entry') <= 120 && getWidth('Operations') <= 120);
  assert.ok(getWidth('Knowledge') >= 760);
  const titleOnly = layoutOf('row\n  box Entry\n  box Middle: one\n  box Exit');
  const bare = titleOnly.frames.filter((frame) => !frame.itemNodes.length && !frame.children.length);
  assert.equal(bare.length, 2);
  assert.ok(bare.every((frame) => frame.h >= 44 && frame.h <= 96));
  const row = layoutOf('row\n  box Short: 一\n  box Tall: 一, 二, 三, 四');
  assert.equal(row.frames[0].h, row.frames[1].h);
  const left = row.nodes.find((node) => node.parent.title === 'Short'), right = row.nodes.find((node) => node.parent.title === 'Tall');
  assert.equal(left.y, right.y);
  const columns = layoutOf('row\n  col\n    box A: 一, 二, 三, 四\n    box B: 一, 二, 三\n  col 2\n    box C: 一, 二, 三\n    box D: 一, 二, 三');
  const frame = (title) => columns.frames.find((item) => item.title === title);
  assert.equal(frame('B').y + frame('B').h, frame('D').y + frame('D').h);
  assert.equal(frame('A').y, frame('C').y);
  assert.ok(Math.abs(frame('C').h - frame('D').h) <= 1);
});

// 搬迁旧箭头的边界断言：通道避开能力节点，竖向单行标签不因文本宽度改变间距。
test('blocks 保留旧箭头通道和竖向标签布局断言', () => {
  const adjacent = layoutOf('row\n  box Left: 一, 二, 三, 四\n  box Right: 五', 280);
  assert.equal(adjacent.edges.length, 0);
  const routed = layoutOf('row\n  box Left: 一, 二, 三, 四\n  box Right: 五\nLeft -> Right: call', 280);
  assert.equal(routed.edges.length, 1);
  const lane = routed.edges[0].gap;
  const overlap = (a, b) => a.x < b.x + b.w - .5 && b.x < a.x + a.w - .5 && a.y < b.y + b.h - .5 && b.y < a.y + a.h - .5;
  assert.ok(routed.nodes.every((node) => !overlap(node, lane)));
  const vertical = layoutOf('col\n  box A: 一, 二\n  box B: 一, 二\n  box C: 一, 二\nA -> B: submit\nB -> C: 写入请求和异步任务队列', 800);
  const frame = (title) => vertical.frames.find((item) => item.title === title);
  const firstGap = frame('B').y - (frame('A').y + frame('A').h), secondGap = frame('C').y - (frame('B').y + frame('B').h);
  assert.equal(firstGap, secondGap);
  assert.ok(firstGap <= 72);
  const long = vertical.edges.find((edge) => edge.to === 'C');
  assert.deepEqual(Array.from(long.labelLines), ['写入请求和异步任务队列']);
  assert.ok(long.labelBox.y >= frame('B').y + frame('B').h + 12);
});

// 保留旧权重断言：无权重的等项兄弟最小宽度一致，显式 1:3 按剩余空间分配。
test('blocks 按旧行列权重规则分配可用宽度', () => {
  const ctx = createContext({ width: 1040, theme: 'paper' });
  const layoutOf = (source) => {
    const parsed = implementation.parse(source, info);
    assert.equal(parsed.errors.length, 0);
    return implementation.layout(parsed.model, { width: 1040, lang: 'zh', measure: (text, font) => ctx.measure(text, font.size, font.weight) }, info);
  };
  const natural = layoutOf('row\n  box A: one\n  box B: two');
  assert.ok(Math.abs(natural.frames[0].w - natural.frames[1].w) <= 4);
  const weighted = layoutOf('row\n  col 1\n    box A: one\n  col 3\n    box B: two');
  const ratio = weighted.frames.find((frame) => frame.title === 'B').w / weighted.frames.find((frame) => frame.title === 'A').w;
  assert.ok(ratio > 2 && ratio < 2.8, `ratio=${ratio}`);
});
