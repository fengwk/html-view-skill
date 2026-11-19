import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSlice } from './diagram-slice.mjs';

const modules = loadSlice({ 'diagram/time': ['diagram/support'] });
const { implementations } = modules['diagram/time'];
const context = modules['core/context'].createContext;
const renderScene = modules['core/svg'].renderScene;
const info = (kind, overrides = {}) => ({ kind, lang: 'en', options: {}, firstLine: 2, headerLine: 1, ...overrides });
function render(source, kind, options = {}) {
  const [, ...body] = source.split('\n');
  const parsed = implementations[kind].parse(body.join('\n'), info(kind, options));
  assert.equal(parsed.errors.length, 0, JSON.stringify(parsed.errors));
  const width = options.width ?? 960;
  const ctx = context({ width, lang: 'en', theme: options.theme || 'claude' });
  const measure = (text, font) => ctx.measure(text, font.size, font.weight);
  const laid = implementations[kind].layout(parsed.model, { width, lang: 'en', measure, ctx }, info(kind, { title: parsed.model.title }));
  assert.ok(laid.width > 0 && laid.height > 0);
  assert.match(renderScene(laid.scene, { theme: options.theme || 'claude' }), /<svg[ >]/);
  return { parsed, laid };
}

// 每种受控语法都须解析并生成真实共享 Scene；同时覆盖完整时间、网格和流程图族。
test('all seven Mermaid time and grid subsets render scenes', () => {
  const examples = [
    ['gantt\ntitle Plan\ndateFormat YYYY-MM-DD\naxisFormat %Y-%m\nsection Build\nAPI : done, api, 2024-01-15, 2024-03-15\nUI : active, after api, 2d', 'gantt'],
    ['timeline\ntitle History\n2020 : Start : Release\n: Follow-up\n2021 : Launch', 'timeline'],
    ['journey\ntitle Checkout\nsection Cart\nOpen cart: 4: User, Shop\nPay: 2: User', 'journey'],
    ['gitGraph\ncommit id: "first"\nbranch feature\ncommit id: "feature-1"\ncheckout main\ncommit tag: "v1"\nmerge feature id: "merge-1"', 'gitGraph'],
    ['kanban\ntodo[待办]\n  task1[任务]\ndone[完成]\n  task2[发布]', 'kanban'],
    ['packet-beta\n0-7: "Source"\n8-15: "Type"', 'packet-beta'],
    ['quadrantChart\ntitle Priorities\nx-axis Low --> High\ny-axis Weak --> Strong\nquadrant-1 Urgent\nquadrant-2 Plan\nquadrant-3 Later\nquadrant-4 Delegate\nAlpha: 0.8, 0.7', 'quadrantChart'],
  ];
  for (const [source, kind] of examples) {
    const { parsed, laid } = render(source, kind);
    assert.equal(parsed.model.type, kind);
    assert.ok(laid.scene.children.length > 0, kind);
  }
});

// 接受 Mermaid 的四象限编号，而不是把相邻象限的意思互换。
test('quadrant captions are ordered TR, TL, BL, BR and points retain the axis direction', () => {
  const input = 'quadrantChart\nx-axis Low --> High\ny-axis Weak --> Strong\nquadrant-1 A\nquadrant-2 B\nquadrant-3 C\nquadrant-4 D\nPoint: 0.8, 0.7';
  const { laid } = render(input, 'quadrantChart', { width: 502 });
  const [grid] = laid.scene.children.filter(node => node.tag === 'rect');
  const caption = (name) => laid.scene.children.find(node => node.tag === 'text' && node.text === name).attrs;
  const midX = grid.attrs.x + grid.attrs.width / 2;
  const midY = grid.attrs.y + grid.attrs.height / 2;
  for (const [name, right, top] of [['A', true, true], ['B', false, true], ['C', false, false], ['D', true, false]]) {
    const label = caption(name);
    assert.equal(label.x > midX, right, name);
    assert.equal(label.y < midY, top, name);
  }
  const dot = laid.scene.children.find(node => node.tag === 'circle');
  assert.ok(dot.attrs.cx > midX && dot.attrs.cy < midY);
});

// 无左侧标签栏的结构图只为自己的内容占宽，窄位域的标签不跑入邻位域。
test('kanban, timeline and packet size their own label space', () => {
  const kanban = render('kanban\ntodo[To do]\n  task[Review]\ndone[Done]', 'kanban', { width: 502 }).laid.scene;
  const columns = kanban.children.filter(node => node.tag === 'rect' && node.attrs.fill === 'transparent');
  assert.equal(columns[0].attrs.x, kanban.width - columns.at(-1).attrs.x - columns.at(-1).attrs.width);
  const timeline = render('timeline\n2026 : Start', 'timeline', { width: 268 }).laid.scene;
  assert.equal(timeline.width, 268);
  assert.equal(timeline.children.find(node => node.tag === 'line').attrs.x1, 24);
  const packet = render('packet-beta\n0-0: "Long Bit Name"\n1-31: "Payload"', 'packet-beta', { width: 268 }).laid.scene;
  const [first, second] = packet.children.filter(node => node.tag === 'rect');
  assert.ok(first.attrs.height > 34, 'the narrow field wraps instead of overlapping the second field');
  assert.equal(first.attrs.x + first.attrs.width, second.attrs.x);
});

// 同一日期只能出现一次轴刻度；日期跨度、状态 flags 和 after 推导须保持原语义。
test('gantt retains civil dates and states without duplicate month labels', () => {
  const { parsed, laid } = render('gantt\nsection Work\nLong : done, task-a, 2024-01-01, 2024-03-31\nShort : active, after task-a, 2d', 'gantt');
  assert.equal(parsed.model.items[0].start, '2024-01-01');
  assert.equal(parsed.model.items[0].end, '2024-03-31');
  assert.deepEqual([...parsed.model.items[0].flags], ['done']);
  assert.equal(parsed.model.items[1].start, '2024-03-31');
  assert.equal(parsed.model.items[1].end, '2024-04-02');
  const ticks = [...laid.scene.children.filter(node => node.tag === 'text' && /^2024-\d\d$/.test(node.text || '')).map(node => node.text)];
  assert.deepEqual(ticks, ['2024-01', '2024-02', '2024-03', '2024-04']);
  assert.equal(new Set(ticks).size, ticks.length);
});

// 分组名单独成行，不在每个任务前重复；任务名与条形同一中线；月份刻度不画进左侧标签栏；状态词按语言写出。
test('gantt shows each section once, centres task names on bars, and keeps month ticks out of the label column', () => {
  const source = 'gantt\nsection Build\nAPI : crit, api, 2024-01-15, 2024-02-20\nUI : 2024-02-01, 2024-03-05\nsection Launch\nBeta : milestone, 2024-03-10, 0d';
  const { laid } = render(source, 'gantt');
  const texts = [...laid.scene.children.filter(node => node.tag === 'text')].map(node => ({ text: node.text, ...node.attrs }));
  assert.deepEqual([...texts.filter(node => ['Build', 'Launch'].includes(node.text)).map(node => node.text)], ['Build', 'Launch']);
  assert.ok(!texts.some(node => / · (API|UI|Beta)$/.test(node.text)), 'task names carry no section prefix');
  assert.ok(texts.some(node => node.text === 'critical') && texts.some(node => node.text === 'milestone'));
  const ui = texts.find(node => node.text === 'UI'), bars = laid.scene.children.filter(node => node.tag === 'rect' && node.attrs.height === 22);
  const uiBar = bars.find(bar => Math.abs(bar.attrs.y + 11 - ui.y) < 30);
  assert.equal(uiBar.attrs.y + uiBar.attrs.height / 2, ui.y, 'task name sits on the bar centre line');
  const measureCtx = context({ width: 960, lang: 'en', theme: 'claude' });
  const labelRight = Math.max(...texts.filter(node => node.x === 12).map(node => node.x + measureCtx.measure(node.text, node['font-size'], node['font-weight'])));
  const firstTick = Math.min(...laid.scene.children.filter(node => node.tag === 'line').map(node => node.attrs.x1));
  assert.ok(firstTick > labelRight, `first month tick at ${firstTick} must stay right of the label column ending at ${labelRight}`);
  const zh = implementations.gantt.parse('section 设计\n评审 : done, 2024-01-02, 2024-01-09', info('gantt', { lang: 'zh' }));
  const ctx = context({ width: 600, lang: 'zh', theme: 'claude' });
  const zhScene = implementations.gantt.layout(zh.model, { width: 600, lang: 'zh', measure: (text, font) => ctx.measure(text, font.size, font.weight), ctx }, info('gantt', { lang: 'zh' })).scene;
  assert.ok(zhScene.children.some(node => node.text === '已完成') && !zhScene.children.some(node => node.text === 'done'));
});

// 非法语句的诊断应指向正文实际行号，并保留受控子集的拒绝边界。
test('unsupported or invalid syntax returns source-line diagnostics', () => {
  const result = implementations.gantt.parse('section Work\nTask : 2024-02-30, 2024-03-01', info('gantt', { firstLine: 8 }));
  assert.ok(result.errors.length > 0);
  assert.ok(result.errors.some(error => error.line === 9), JSON.stringify(result.errors));
  assert.ok(implementations['packet-beta']);
  assert.ok(implementations.quadrantChart);
});

// 每个主题使用共享调色板而非固定旧色；长标签以共享 wrap/measure 留在 scene 内。
test('themes use shared colors and wrapped labels stay in the scene', () => {
  for (const theme of ['paper', 'obsidian', 'tokyo', 'kanagawa', 'terminal']) {
    const name = 'Long Label '.repeat(24);
    const { laid } = render(`kanban\ntodo[${name}]\n  task[${name}]`, 'kanban', { theme });
    assert.ok(laid.scene.width >= 960);
    assert.ok(laid.scene.children.some(node => node.tag === 'text' && node.text === 'task'));
  }
});
