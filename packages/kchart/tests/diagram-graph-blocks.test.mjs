import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createContext } from '../src/core/context.js';
import { measureOf } from '../src/diagram/support.js';
import { parseGraph } from '../src/diagram/graph-parse.js';
import { layoutGraph } from '../src/diagram/graph-layout.js';

// The renderer's own text measure, so node sizes (and so the routes) match what users see.
const layout = (source) => {
  const [header, ...body] = source.split('\n');
  const parsed = parseGraph(body.join('\n'), { kind: 'flowchart', header: header.trim(), headerLine: 1, firstLine: 2, lang: 'zh' });
  assert.deepEqual(parsed.errors, []);
  const ctx = createContext({ width: 800, lang: 'zh' });
  return layoutGraph(parsed.model, { width: 800, lang: 'zh', measure: measureOf(ctx), ctx, renderOptions: { frame: true } });
};
// Re-routed links between subgraphs draw no hop marks, so crossings are counted on the runs.
const side = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
const crosses = (a, b) => side(a.p0, a.p1, b.p0) * side(a.p0, a.p1, b.p1) < -1e-6 && side(b.p0, b.p1, a.p0) * side(b.p0, b.p1, a.p1) < -1e-6;
const crossings = (result) => {
  let count = 0;
  result.edges.forEach((edge, i) => result.edges.slice(i + 1).forEach((other) => {
    for (const a of edge.segments) for (const b of other.segments) if (crosses(a, b)) count += 1;
  }));
  return count;
};

// 意图：判断框两条出线都要底部顶点时都会让出它，改按各自去向排序。「能」进右下方判断框的
// 左侧顶点，竖线要在那个顶点左侧；「不能」去更左的节点，端口就要更靠左。顺序一反两线必然交叉。
test('diamond exits that give up the shared tip keep the order of where they go', () => {
  const result = layout(`flowchart TD
  A[服务报 502] --> B{网关能连上后端吗?}
  B -- 不能 --> C[检查安全组与端口]
  B -- 能 --> D{后端进程存活?}
  D -- 否 --> E[查看 OOM 日志并重启]
  D -- 是 --> F{响应时间 > 30s?}
  F -- 是 --> G[排查慢查询与线程池]
  F -- 否 --> H[检查网关超时与 keepalive 配置]
  C --> I[恢复后观察 15 分钟]
  E --> I
  G --> I
  H --> I`);
  assert.equal(crossings(result), 0);
});

// 意图：所有节点都在子图里时，子图各自排版、再整体摆放。子图成员要按子图外邻居的位置排序：
// 数据层按声明顺序排成 MySQL、Redis、消息队列时，业务服务到数据层的连线交叉九次。
test('subgraph members follow their links to other subgraphs', () => {
  const result = layout(`flowchart LR
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
  MQ -.-> Inv`);
  assert.ok(crossings(result) <= 2, `${crossings(result)} crossings`);
});

// A loose terminal node must not flatten the stages. A skip link may reserve a side
// channel, but it must not displace the stages or cross the source's local chain.
test('a mixed compound spine stays aligned around a skip link', () => {
  const result = layout(`flowchart TD
  subgraph First
    A --> B
  end
  subgraph Middle
    C --> D
  end
  subgraph Last
    E --> F
  end
  B --> C
  D --> E
  F --> Done
  A --> E`);
  const frames = ['First', 'Middle', 'Last'].map(id => result.frames.find(frame => frame.id === id));
  const center = node => node.x + node.w / 2;
  frames.slice(1).forEach((frame, i) => {
    assert.ok(frame.y >= frames[i].y + frames[i].h);
    assert.ok(Math.abs(center(frame) - center(frames[i])) < .001);
  });
  const [f, done] = ['F', 'Done'].map(id => result.nodes.find(node => node.id === id));
  assert.ok(done.y >= frames[2].y + frames[2].h);
  assert.ok(Math.abs(center(done) - center(f)) < .001);
  const skip = result.edges.find(edge => edge.from === 'A' && edge.to === 'E');
  const local = result.edges.find(edge => edge.from === 'A' && edge.to === 'B');
  assert.ok(skip.start.y > result.nodes.find(node => node.id === 'A').y);
  assert.ok(skip.end.y < result.nodes.find(node => node.id === 'E').y + result.nodes.find(node => node.id === 'E').h);
  assert.ok(!skip.segments.some(a => local.segments.some(b => crosses(a, b))));
  const middle = frames[1];
  assert.ok(skip.segments.every(({ p0, p1 }) => Math.max(p0.y, p1.y) <= middle.y || Math.min(p0.y, p1.y) >= middle.y + middle.h
    || Math.max(p0.x, p1.x) <= middle.x || Math.min(p0.x, p1.x) >= middle.x + middle.w));
});

// 意图：隔层连线（第 0 层直连第 2 层）要绕过中间的子图。外层排版已为它在中间子图旁留了通道，
// 改走节点到节点时先试这条通道；找不到路线就会退回成子图斜向错开的阶梯排版。
test('links that skip a layer keep layered subgraphs side by side', () => {
  const result = layout(`flowchart LR
  subgraph L0[Layer 0]
    N0_0[Service 0.0]
    N0_1[Service 0.1]
    N0_2[Service 0.2]
  end
  subgraph L1[Layer 1]
    N1_0[Service 1.0]
    N1_1[Service 1.1]
    N1_2[Service 1.2]
  end
  subgraph L2[Layer 2]
    N2_0[Service 2.0]
    N2_1[Service 2.1]
    N2_2[Service 2.2]
  end
  N0_0 --> N1_1
  N0_1 --> N2_1
  N0_1 --> N1_1
  N0_2 --> N1_0
  N1_0 --> N2_2
  N1_1 --> N2_2
  N1_2 --> N2_1`);
  const frames = ['L0', 'L1', 'L2'].map(id => result.frames.find(frame => frame.id === id));
  frames.slice(1).forEach((frame, i) => {
    assert.ok(frame.x >= frames[i].x + frames[i].w, `${frame.id} right of ${frames[i].id}`);
    assert.ok(frame.y < frames[i].y + frames[i].h && frames[i].y < frame.y + frame.h, `${frame.id} level with ${frames[i].id}`);
  });
  const skip = result.edges.find(edge => edge.from === 'N0_1' && edge.to === 'N2_1');
  assert.ok(skip, 'the skip link connects the nodes, not their subgraphs');
  const middle = frames[1];
  assert.ok(skip.segments.every(({ p0, p1 }) => Math.max(p0.y, p1.y) <= middle.y || Math.min(p0.y, p1.y) >= middle.y + middle.h
    || Math.max(p0.x, p1.x) <= middle.x || Math.min(p0.x, p1.x) >= middle.x + middle.w), 'the skip link goes around Layer 1');
});
