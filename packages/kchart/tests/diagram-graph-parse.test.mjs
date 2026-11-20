import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseGraph, parseFlow } from '../src/diagram/graph-parse.js';

// 意图：flow 分组展开为笛卡尔积、子图嵌套归属与诊断行号都必须保留原源码行。
test('flowchart 解析分组、子图与绝对行号', () => {
  const { model, errors } = parseGraph('subgraph grp[组]\n A[入口] & C --> F & G\n subgraph nested[内]\n B{判断}\n end\nend\nA -->', {
    kind: 'flowchart', header: 'flowchart LR', headerLine: 5, firstLine: 6, lang: 'zh',
  });
  assert.equal(model.direction, 'LR');
  assert.equal(model.edges.length, 4);
  assert.equal(model.edges.every(edge => edge.line === 7), true);
  assert.deepEqual(Array.from(model.subgraphs, frame => [frame.id, frame.parent]), [['grp', null], ['nested', 'grp']]);
  assert.equal(model.nodes.find(node => node.id === 'A').parent, 'grp');
  assert.ok(errors.some(item => item.line === 12 && /缺少节点/.test(item.message)));
});

// 意图：state 复合状态层级、框节点边引用和超限错误需反映旧受控语义。
test('stateDiagram-v2 保留复合嵌套与非法闭合诊断', () => {
  const { model, errors } = parseGraph('state Outer {\n state Inner {\n A --> B : go\n }\n}\n}', {
    kind: 'stateDiagram-v2', header: 'stateDiagram-v2', headerLine: 1, firstLine: 2,
  });
  assert.deepEqual(Array.from(model.subgraphs, frame => frame.id), ['Outer', 'Inner']);
  assert.equal(model.nodes.find(node => node.id === 'A').parent, 'Inner');
  assert.ok(errors.some(item => item.line === 7 && /没有对应/.test(item.message)));
});

// 意图：ER 关系端点基数、虚线关系、字段键和非法基数语法须有明确解析结果。
test('erDiagram 解析基数、字段与非法关系', () => {
  const { model, errors } = parseGraph('USER {\n int id PK\n}\nORDER ||..o{ USER : owns\nA ?--o{ B', {
    kind: 'erDiagram', header: 'erDiagram', headerLine: 1, firstLine: 2,
  });
  assert.equal(model.edges.length, 1);
  assert.equal(model.edges[0].startCard, '||');
  assert.equal(model.edges[0].endCard, 'o{');
  assert.equal(model.edges[0].style, 'dashed');
  assert.deepEqual(Array.from(model.nodes.find(node => node.id === 'USER').fields[0].keys), ['PK']);
  assert.ok(errors.some(item => item.line === 6 && /无法解析/.test(item.message)));
});

// 意图：旧解析器的 30 节点与 3 层子图保护属于受控语法边界，需在第一个越界位置报告。
test('flowchart 节点数和子图深度保留上限', () => {
  const nodes = Array.from({ length: 31 }, (_, i) => `N${i}`).join('\n');
  const result = parseGraph(nodes, { kind: 'flowchart', header: 'flowchart TB', headerLine: 1, firstLine: 2 });
  assert.ok(result.errors.some(item => /节点 31 个，超过上限 30/.test(item.message)));
  const nested = parseGraph('subgraph A\nsubgraph B\nsubgraph C\nsubgraph D\nend', { kind: 'flowchart', header: 'flowchart TB', headerLine: 1, firstLine: 2 });
  assert.ok(nested.errors.some(item => /子图嵌套 4 层/.test(item.message)));
});

// 意图：覆盖合法 flow/state/ER 复杂语法及显式不支持语法，防止解析结果丢失关键结构。
test('flow/state/ER 复杂样例保留结构并报告不支持语法', () => {
  const flow = `flowchart LR
  A[入口] --> B{判断}
  B -->|是| C(处理)
  B -. 否 .-> D([结束])
  C == 重点 ==> E[(存储)]
  A & C --> F[[子程序]] & G((圆))
  F --- H{{六边形}}
  D <--> A
  A ---> B
  C -->|重试| C
  subgraph 接入 [接入层]
    A
    class A,B ok
  end
  subgraph 服务
    C:::new
  end`;
  const state = `stateDiagram-v2
  direction LR
  [*] --> 待支付
  待支付 --> 已支付 : 支付成功
  待支付 --> 已关闭 : 超时
  state "履约中" as 履约
  state 履约 {
    [*] --> 拣货
    拣货 --> 配送 : 出库
    配送 --> [*]
  }
  已支付 --> 履约 : 回调
  履约 --> 完成
  完成 --> [*]
  已支付 --> 重试 : 失败
  重试 --> 重试 : 重试
  state 结果 <<choice>>
  待支付 --> 结果 : 发起
  结果 --> 已支付 : 成功
  state 并发 <<fork>>
  状态A --> 并发
  state 汇合 <<join>>
  并发 --> 汇合
  已支付 : 已收到款项
  class 重试 danger`;
  const er = `erDiagram
  direction LR
  CUSTOMER["客户"] {
    string id PK "客户 ID"
    string name
  }
  ORDER {
    string id PK
    string customer_id FK
    decimal amount
  }
  PAYMENT {
    string id PK
    string order_id FK
  }
  AUDIT["审计"]
  CUSTOMER ||--o{ ORDER : 下单
  ORDER ||--|{ PAYMENT : 支付
  ORDER ||..o| PAYMENT : 退款
  PAYMENT ||--o{ AUDIT : 记录`;
  for (const source of [
    flow, state, er, 'flowchart TB\nA[one;two] --> B; B --> C',
    'flowchart TB\n  D{"两项条件都满足？<br>且等级明确？"}\n  C((圆))\n  R[普通矩形]\n  D --> C --> R',
  ]) {
    const [header, ...body] = source.split('\n');
    const kind = /^(flowchart|graph)\b/i.test(header) ? 'flowchart'
      : /^stateDiagram(?:-v2)?\b/i.test(header) ? 'stateDiagram-v2' : 'erDiagram';
    const result = parseGraph(body.join('\n'), { kind, header, headerLine: 1, firstLine: 2, lang: 'zh' });
    assert.equal(result.errors.length, 0, source);
    assert.ok(result.model.nodes.length > 0, source);
  }
  for (const source of [
    'flowchart TB\n  classDef x fill:#f00', 'flowchart TB\n  style A fill:#f00',
    'flowchart TB\n  linkStyle 0 stroke:#f00', 'flowchart TB\n  click A callback', 'flowchart TB\n  call foo()',
    'stateDiagram-v2\n  note right of A', 'stateDiagram-v2\n  A --> B\n  --\n  B --> C',
    'flowchart TB\n  A@{ shape: unknown-shape }', 'flowchart TB\n  A:::bad --> B',
    'flowchart TB\n  class A bad', 'erDiagram\n  A ?--o{ B',
    'erDiagram\n  A {\n    int id BAD\n  }', 'stateDiagram-v2 BAD', 'erDiagram BAD',
  ]) {
    const [header, ...body] = source.split('\n');
    const kind = /^(flowchart|graph)\b/i.test(header) ? 'flowchart'
      : /^stateDiagram(?:-v2)?\b/i.test(header) ? 'stateDiagram-v2' : 'erDiagram';
    const result = parseGraph(body.join('\n'), { kind, header, headerLine: 1, firstLine: 2 });
    assert.ok(result.errors.length > 0, source);
  }
  const cardinalities = parseGraph('A ||--|| B\nC |o--o| D\nE }o--|{ F\nG }|--o{ H', { kind: 'erDiagram', header: 'erDiagram', headerLine: 1, firstLine: 2 });
  assert.equal(cardinalities.model.edges.length, 4);
  const depth = parseGraph('subgraph a [A]\nsubgraph b [B]\nsubgraph c [C]\nsubgraph d [D]\nA', { kind: 'flowchart', header: 'flowchart TB', headerLine: 1, firstLine: 2 });
  assert.ok(depth.errors.length > 0);
  const nested = parseGraph('state A {\nstate B {\nstate C {\n[*] --> X\n}\n}\n}', { kind: 'stateDiagram-v2', header: 'stateDiagram-v2', headerLine: 1, firstLine: 2 });
  assert.deepEqual(nested.errors, []);
  assert.equal(nested.model.subgraphs.length, 3);
});


// 意图：公共 parseFlow 供跨图族复用，必须接收真实行号并对非法方向安全回退。
test('parseFlow 使用调用方绝对行号并限制方向', () => {
  const { model, errors } = parseFlow([{ text: 'A --> B', line: 42 }], { direction: 'sideways' });
  assert.equal(model.direction, 'TB');
  assert.deepEqual(Array.from(model.edges, edge => edge.line), [42]);
  assert.equal(errors.length, 0);
});
