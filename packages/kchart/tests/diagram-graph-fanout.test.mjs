import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseGraph } from '../src/diagram/graph-parse.js';
import { layoutGraph } from '../src/diagram/graph-layout.js';
import { diagram } from '../dist/esm/node.js';
import { checkScene } from './helpers/geometry.mjs';

const measure = (value, { size, weight }) => [...String(value)].length * size * (weight >= 600 ? 1.04 : 1);
const layout = (body, header = 'flowchart TD') => {
  const parsed = parseGraph(body, { kind: header.split(' ')[0], header, headerLine: 1, firstLine: 2, lang: 'en' });
  assert.deepEqual(parsed.errors, []);
  return layoutGraph(parsed.model, { measure });
};
// Orthogonal routes draw a two-segment hop wherever they cross another edge.
const crossings = result => result.edges.reduce((sum, edge) => sum + edge.segments.filter(s => s.kind === 'jump').length, 0) / 2;
const box = (result, id) => result.nodes.find(node => node.id === id);
const ids = count => Array.from({ length: count }, (_, i) => `S${i}`);

// 意图：一个节点连向多个同等子节点（或多个同等上游连向一个节点）时，它居中在另一端之间，
// 端口按另一端的顺序排开、外侧的线先拐弯，所以连线互不交叉；横竖两个方向都一样。
test('hubs sit centred between their fan-out or fan-in ends and their edges never cross', () => {
  for (const direction of ['TB', 'LR']) {
    const cross = node => (direction === 'TB' ? node.x + node.w / 2 : node.y + node.h / 2);
    for (const count of [3, 4, 5, 8]) {
      for (const [hub, body] of [
        ['GW', ids(count).map(id => `GW --> ${id}`).join('\n')],
        ['HUB', ids(count).map(id => `${id} --> HUB`).join('\n')],
      ]) {
        const result = layout(body, `flowchart ${direction}`);
        const ends = ids(count).map(id => cross(box(result, id))).sort((a, b) => a - b);
        // Odd: over the middle end, so its edge is straight. Even: halfway between the middle two.
        const middle = (ends[Math.floor((count - 1) / 2)] + ends[Math.ceil((count - 1) / 2)]) / 2;
        assert.ok(Math.abs(cross(box(result, hub)) - middle) <= 1, `${direction} ${hub} ${count}: hub off centre`);
        assert.equal(crossings(result), 0, `${direction} ${hub} ${count}`);
      }
    }
  }
});

// 意图：三层三叉树与基类多子类都不交叉：父节点对齐中间的子节点，其余连线在两侧嵌套。
test('balanced trees route without crossings', () => {
  const tree = ['A', 'B', 'C'].flatMap(p => [`R --> ${p}`, ...[0, 1, 2].map(i => `${p} --> ${p}${i}`)]).join('\n');
  const result = layout(tree);
  assert.equal(crossings(result), 0);
  for (const parent of ['R', 'A', 'B', 'C']) {
    const kids = parent === 'R' ? ['A', 'B', 'C'] : [0, 1, 2].map(i => `${parent}${i}`);
    const centre = node => node.x + node.w / 2;
    assert.ok(Math.abs(centre(box(result, parent)) - centre(box(result, kids[1]))) <= 1, `${parent} over its middle child`);
  }
});

// 意图：终止态这类窄节点顶部放不下的来线挂到来线所在的一侧，从端口高度水平进入（L 形）；
// 同一侧外侧的线从下方进入，不横穿内侧线，也就不会被修路改成绕大圈的路线。
test('arrivals that overflow a narrow target join the side facing their source', () => {
  const result = layout(['[*] --> Idle', ...ids(5).flatMap(id => [`Idle --> ${id}`, `${id} --> [*]`])].join('\n'), 'stateDiagram-v2');
  const hub = result.nodes.find(node => node.id.startsWith('@@end'));
  result.edges = result.edges.filter(edge => edge.to === hub.id);
  const sides = [];
  for (const edge of result.edges) {
    // A circle's side ports are not on its bounding box: read the side from the final run's direction.
    const last = edge.segments.filter(s => s.kind === 'line' && Math.hypot(s.p1.x - s.p0.x, s.p1.y - s.p0.y) > 0.5).at(-1);
    const side = Math.abs(last.p1.x - last.p0.x) < 0.01 ? (last.p1.y > last.p0.y ? 'top' : 'bottom') : last.p1.x > last.p0.x ? 'left' : 'right';
    const source = box(result, edge.from);
    if (side === 'left') assert.ok(source.x + source.w / 2 < hub.x + hub.w / 2, `${edge.from} enters the far side`);
    if (side === 'right') assert.ok(source.x + source.w / 2 > hub.x + hub.w / 2, `${edge.from} enters the far side`);
    if (side === 'left' || side === 'right') {
      const corners = edge.segments.filter(s => s.kind === 'corner').length;
      assert.equal(corners, 1, `${edge.from} enters with a single bend`);
    }
    sides.push(side);
  }
  assert.ok(sides.includes('left') && sides.includes('right'), sides.join());
  assert.equal(crossings(result), 0);
});

// 意图：跨子图的连线由修路逐条重新走线，前向连线之间至少隔 4px。此前「移动 App → API 网关」与
// 「API 网关 → 支付服务」只隔 1px，读起来像 App 直连支付服务。
test('edges rerouted across subgraphs keep clear of each other', () => {
  const source = `flowchart LR
  subgraph 客户端
    Web[Web 前端]
    App[移动 App]
  end
  subgraph 网关层
    GW[API 网关]
    Auth[认证服务]
  end
  subgraph 业务服务
    Order[订单服务]
    Pay[支付服务]
    Inv[库存服务]
  end
  subgraph 数据层
    MySQL[(MySQL)]
    Redis[(Redis 缓存)]
    MQ[[消息队列]]
  end
  Web --> GW
  App --> GW
  GW --> Auth
  GW --> Order
  GW --> Pay
  Order --> Inv
  Order --> MySQL
  Pay --> MySQL
  Inv --> Redis
  Order -.-> MQ
  MQ -.-> Inv`;
  for (const width of [800, 360]) {
    assert.deepEqual(checkScene(diagram(source, { syntax: 'mermaid', width, lang: 'zh' }).scene, { source }), [], `${width}px`);
  }
});

// 意图：层间轨道上下各留 16px：轨道多时最后一条也不会压到目标顶边，箭头仍竖直进入。
test('tracks in a crowded gap keep clear of the target top', () => {
  for (const count of [4, 6, 8]) {
    const result = layout(ids(count).map(id => `${id}[Source] --> HUB[Collector]`).join('\n'));
    const hub = box(result, 'HUB');
    for (const edge of result.edges) {
      if (Math.abs(edge.end.y - hub.y) > 0.5) continue;
      const runs = edge.segments.filter(s => s.kind === 'line' && Math.abs(s.p0.y - s.p1.y) < 0.01 && Math.abs(s.p0.x - s.p1.x) > 0.01);
      if (runs.length) assert.ok(hub.y - runs.at(-1).p0.y >= 16 - 0.01, `${count}: ${edge.from} track ${runs.at(-1).p0.y} vs top ${hub.y}`);
    }
  }
});
