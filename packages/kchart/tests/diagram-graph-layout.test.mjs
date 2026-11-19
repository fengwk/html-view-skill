import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseGraph } from '../src/diagram/graph-parse.js';
import { layoutGraph } from '../src/diagram/graph-layout.js';

const plain = value => JSON.parse(JSON.stringify(value));
const measure = (value, { size, weight }) => [...String(value)].length * size * (weight >= 600 ? 1.04 : 1);

// 意图：真实 parser 与 layout 组合覆盖四个方向、标签、自环和分叉，并核验布局结构有效。
test('graph layout routes parsed nodes and edges in every direction', () => {
  for (const direction of ['TB', 'BT', 'LR', 'RL']) {
    const parsed = parseGraph(`A[Start] -->|go| B{Check}\nB -->|yes| C[Done]\nB -->|no| A\nC --> C`, {
      kind: 'flowchart', header: `flowchart ${direction}`, headerLine: 1, firstLine: 2, lang: 'en',
    });
    assert.equal(parsed.errors.length, 0);
    const result = layoutGraph(parsed.model, { measure });
    assert.equal(result.nodes.length, 3);
    assert.equal(result.edges.length, 4);
    assert.ok(result.width > 0 && result.height > 0);
    assert.ok(result.edges.every(edge => edge.segments.length > 0));
    assert.ok(result.edges.some(edge => edge.label === 'go'));
    assert.ok(result.edges.some(edge => edge.from === edge.to));
  }
});

// 意图：复合子图、ER 属性和状态起止节点由实际 parser 形成模型，再检查布局输出对应的几何结构。
test('graph layout preserves cluster, ER, and state geometry', () => {
  const cases = [
    ['flowchart', 'flowchart LR\nsubgraph G[Group]\nA[Alpha] --> B[Beta]\nend\nB --> C[Gamma]'],
    ['erDiagram', 'erDiagram\nCUSTOMER ||--o{ ORDER : places\nCUSTOMER {\nint id PK\nstring name\n}'],
    ['stateDiagram-v2', 'stateDiagram-v2\n[*] --> Idle\nIdle --> Busy : start\nBusy --> [*]'],
  ];
  for (const [kind, source] of cases) {
    const [header, ...body] = source.split('\n');
    const parsed = parseGraph(body.join('\n'), { kind, header, headerLine: 1, firstLine: 2, lang: 'en' });
    assert.equal(parsed.errors.length, 0, source);
    const result = plain(layoutGraph(parsed.model, { measure }));
    assert.equal(result.nodes.length, parsed.model.nodes.length, source);
    assert.ok(result.width > 0 && result.height > 0, source);
    assert.equal(result.edges.length, parsed.model.edges.length, source);
    if (kind === 'flowchart') assert.ok(result.frames.some(frame => frame.id === 'G'));
    if (kind === 'erDiagram') assert.ok(result.nodes.some(node => node.er?.rows.length === 2));
    if (kind === 'stateDiagram-v2') assert.ok(result.nodes.some(node => node.kind === 'start'));
  }
});

// 意图：判断框同一侧有出线和回边时，偏离顶点的端口要放在竖线去向一侧。曾经回边端口落在顶点上方、
// 竖线从下方上来，穿过菱形较宽的部分，被节点填色遮住，箭头看起来和线断开。
test('flowchart edges never run through a diamond when a back edge shares its side with an exit', () => {
  const source = 'A[Catalog service] --> B[(catalog_events)]\nB --> C{Indexer worker}\nC -->|valid| D[Search index]\nC -->|rejected| E[Dead-letter queue]\nE -->|replay after fix| C';
  const parsed = parseGraph(source, { kind: 'flowchart', header: 'flowchart TB', headerLine: 1, firstLine: 2, lang: 'en' });
  assert.equal(parsed.errors.length, 0);
  const result = plain(layoutGraph(parsed.model, { measure }));
  const diamond = result.nodes.find(node => node.id === 'C');
  const cx = diamond.x + diamond.w / 2, cy = diamond.y + diamond.h / 2;
  const inside = ({ x, y }) => Math.abs(x - cx) / (diamond.w / 2) + Math.abs(y - cy) / (diamond.h / 2) < 0.97;
  for (const edge of result.edges) {
    for (const segment of edge.segments) {
      for (let step = 0; step <= 20; step += 1) {
        const t = step / 20, point = { x: segment.p0.x + (segment.p1.x - segment.p0.x) * t, y: segment.p0.y + (segment.p1.y - segment.p0.y) * t };
        assert.ok(!inside(point), `${edge.from}->${edge.to} passes through the diamond at ${point.x.toFixed(1)},${point.y.toFixed(1)}`);
      }
    }
  }
});

// 意图：ER 基数标记（16px 长、12px 宽）按端点切线绘制。端点先沿法向走直线，标记才落在线上；
// 同一实体同一侧的两个端点至少隔 28px，两个鸦爪才不会叠在一起。
test('ER cardinality markers sit on straight stubs and neighbouring endpoints keep marker clearance', () => {
  const source = 'CUSTOMER ||--o{ ORDER : places\nORDER ||--|{ LINE : contains\nPRODUCT ||--o{ LINE : referenced_by';
  const parsed = parseGraph(source, { kind: 'erDiagram', header: 'erDiagram', headerLine: 1, firstLine: 2, lang: 'en' });
  assert.equal(parsed.errors.length, 0);
  const { edges } = plain(layoutGraph(parsed.model, { measure }));
  for (const edge of edges) {
    for (const [segment, port] of [[edge.segments[0], edge.start], [edge.segments.at(-1), edge.end]]) {
      const far = segment.p0.x === port.x && segment.p0.y === port.y ? segment.p1 : segment.p0;
      assert.equal(far.x, port.x, `${edge.from}->${edge.to} leaves its port perpendicular to the entity`);
      assert.ok(Math.abs(far.y - port.y) >= 18, `${edge.from}->${edge.to} stub is long enough for a 16px marker`);
      for (const control of [segment.c1, segment.c2]) assert.equal(control.x, port.x, 'stub is straight');
    }
  }
  const intoLine = edges.filter(edge => edge.to === 'LINE').map(edge => edge.end.x).sort((a, b) => a - b);
  assert.equal(intoLine.length, 2);
  assert.ok(intoLine[1] - intoLine[0] >= 28, `crow's feet into LINE are ${intoLine[1] - intoLine[0]}px apart`);
});
