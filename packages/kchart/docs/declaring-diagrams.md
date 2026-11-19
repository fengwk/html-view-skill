# 结构图声明

`diagram(source, options)` 解析、校验并排版，返回 `{ svg, scene, diagnostics }`。`check(source, options)` 只解析和校验。`diagramTypes` 列出规范图型、别名、`syntax` 和诊断 `topic`。KChart 支持下列受控 Mermaid 语法，不运行 Mermaid 官方运行时，也不执行图中指令或回调。

```js
import { check, diagram } from './dist/esm/node.js';

const source = `flowchart LR
  A[请求] --> B{校验}
  B -->|通过| C[响应]`;
const errors = check(source);
if (errors.length) throw new Error(errors[0].message);
const { svg, diagnostics } = diagram(source, { width: 480, theme: 'paper' });
if (diagnostics.length) throw new Error(diagnostics[0].message);
console.log(svg);
```

## 图型与输入形状

Mermaid 正文首行写图型名，默认 `syntax: 'mermaid'`。原生三类必须明确传相应的 `syntax`。

| 图族 | 类型和受控写法 |
|---|---|
| 流程 | `flowchart`（别名 `graph`）：方向、节点、边、边标签、状态类；`stateDiagram-v2`（别名 `stateDiagram`）：状态与转移；`journey`：任务、1–5 分和角色 |
| 时序 | `sequenceDiagram`：参与者、消息、注释和受控片段；`zenuml`：参与者、调用、响应及嵌套调用 |
| 数据模型 | `erDiagram`：字段和基数关系；`classDiagram`：类成员、关系、基数；`requirementDiagram`：需求、元素与关系 |
| 架构 | `C4Context`、`C4Container`、`C4Component`、`C4Dynamic`、`C4Deployment`；`architecture-beta`、`block-beta` 支持受控分组、节点与边 |
| 时间与网格 | `gantt`：日期、持续时间、依赖和里程碑；`timeline`：节、时期与事件；`gitGraph`：提交、分支、切换和合并；`kanban`：顶格列、缩进卡片；`packet-beta`：`起始位-结束位: "名称"`，不重叠，至 4095 位；`quadrantChart`：轴、象限与归一化坐标 |
| 脑图 | `mindmap`：单根、缩进层级、文本；节点下一行可写语义状态，如 `:::ok` |
| 原生 | `layers`：层、组、条目；`blocks`：嵌套能力容器及关系；`swimlane`：泳道、节点与跨道边 |
| 数值图转换 | [`pie`](#pie)、[`treemap-beta`](#treemap-beta)、[`xychart`](#xychart)、[`sankey-beta`](#sankey-beta)、[`radar-beta`](#radar-beta) |

原生限额：`layers` 最多 8 层、每层 6 组、每组 30 项；`blocks` 最多 4 层、80 容器、160 能力项、8 关系；`swimlane` 最多 6 泳道、30 节点、50 边、3 回边。`sequenceDiagram` 最多 8 参与者、40 消息、2 层片段；流程、状态与 ER 图最多 30 节点、50 边。

## 前言、文本和主题

- YAML 风格的前言由一对 `---` 包围，可声明 `title`。`frame: false` 用于已有图框的宿主；可从 `scene.heading` 读取供宿主显示的标题。
- 只有 `mindmap` 执行 `config.layout`：`bilateral`（默认）、`right`、`left`、`radial`、`org`、`brace`、`fishbone`、`timeline`。`tidy-tree`、`dagre`、`elk` 映射到默认布局。主题由 API 的 `theme` 选择。
- 支持受控状态 `new`、`info`、`ok`、`warn`、`danger`、`ext`。`flowchart` 写 `:::状态` 或受支持的 `class` 语句；脑图把 `:::状态` 单列在对应节点下一行。任意颜色、图标指令、链接和回调不受支持。
- 四象限的 `x-axis` 从左到右，`y-axis` 从下到上；`quadrant-1..4` 依次是右上、左上、左下、右下。点的 `x, y` 各在 0 至 1 之间。

## Mermaid 数值图

以下类型转换为 KChart 数据图。新建数据图时可直接用[数据图声明](declaring-charts.md)表达单位、来源、字段格式和缺失值。

### pie

单一正文 `title`、不重复的 `类别 : 非负数`。接受 `showData` 语法，但它不改变绘制。

### treemap-beta

恰有一个根；带子项的节点不能同时指定权重，叶节点必须指定权重。图题写正文 `title`。

### xychart

别名 `xychart-beta`。最多一个 `x-axis`、一个 `y-axis` 和六条 `bar` / `line` 序列。类别与数据点数量一致；y 轴范围不得裁剪数据，柱形 y 轴须包含 0 基线。图题写正文 `title`。

### sankey-beta

每行 `Source,Target,正有限 Value`。这是 CSV 输入，字段包含逗号时用双引号包住。本类型不从前言取图题。

### radar-beta

至少三个不重复维度，最多 24 条 `curve`；每条曲线与维度的值数量相同。`max` 不得裁剪数据；`ticks`、`showLegend`、非零 `min` 不支持。图题写正文 `title`。

## 诊断

`check()` 和 `diagram()` 返回的诊断包含 `code`、`line`、`column`、`message`、`fix`、`topic`；行列定位输入文本。先按 `message` 和 `fix` 修正，确认 `diagram()` 返回 SVG 和空诊断后再使用结果。画布可能比请求宽度大：内嵌时为图框提供横向滚动，不压缩文字。
