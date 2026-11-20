# 流程与状态图

表达一般流程、条件分支、状态迁移、用户旅程或跨角色交接。节点归属和责任交接重要时用 `swimlane`；只表示模块依赖时不要画成流程。

## flowchart

`flowchart`（别名 `graph`）支持 `TB`/`TD`/`BT`/`LR`/`RL` 方向、节点、连线、标签及子图（最多嵌套 3 层）；最多 30 节点、50 条边。矩形 `[]`、子程序 `[[]]`、圆柱 `[( )]`、圆 `()`、stadium `([])`、菱形 `{}`、六边形 `{{}}` 可用；连线标签可写 `A -->|通过| B`。状态分类使用 `:::new`、`:::info`、`:::ok`、`:::warn`、`:::danger`、`:::ext` 或 `class A ok`。`classDef`、`style`、`linkStyle`、`click`、`call` 和 `@{ shape: ... }` 不支持；这些写法产生诊断，移除样式/回调并改用状态分类。

```mermaid
---
title: 申请经审核后归档
---
flowchart LR
  A[提交申请] --> B{审核}
  B -->|通过| C[归档]
  B -->|补充材料| A
```

## stateDiagram-v2

状态图（别名 `stateDiagram`）支持 `[*]` 起止点、状态转换及 `state "名称" as id`；最多 30 状态、50 条转换，复合状态最多嵌套 2 层。`<<choice>>`、`<<fork>>`、`<<join>>` 和转换说明可用。并发区 `--` 与 `note` 不支持；出现时会报错，改用明确状态和转换，不要当作注释忽略。

## journey

旅程图用 `section 名称` 分组，以 `任务名: 分数: 参与者, 参与者` 声明体验任务。分数必须为 1–5，最多 80 项、240 行；分值显示为五级刻度，不会按本图数据重新归一化。用虚构或来源明确的体验评分，不要把分数当百分比。

## swimlane

原生 `swimlane` 以 `lane 泳道名` 声明责任方，泳道内缩进声明节点，之后用 flowchart 连线语法连接节点；方向仅 `TB` / `LR`。最多 6 条泳道、30 个节点、50 条关系、3 条回边，节点标签最多 3 行、宽度受限（最大 208px）。每个节点须且仅须归属一条泳道，跨泳道关系引用已声明节点；缩进、归属、方向冲突或超限都会报错。

```swimlane
---
title: 客户端请求经服务端校验并查询
---
swimlane LR
lane 客户端
  request[提交请求]
  result[接收结果]
lane 服务端
  validate[校验]
  query[查询]
request -->|请求| validate
validate -->|通过| query
query -->|响应| result
```

## swimlane-beta

Mermaid 泳道图：头行可带 `LR` / `TB`，每个 `subgraph 泳道名 … end` 是一条泳道，泳道内用 flowchart 写法声明节点，之后用 flowchart 连线连接任意泳道的节点。与原生 `swimlane` 是两种写法：已有 Mermaid 源码用本类型，从头起稿可用原生写法。

## eventmodeling

Event Modeling 按源码顺序排时间帧：`tf 编号 类型 名称` 可写成 `timeframe`，`rf` 可写成 `resetframe`。编号为 1–3 位数字且不得重复；类型为 `ui`、`cmd` / `command`、`evt` / `event`、`rmo` / `readmodel`、`pcr` / `processor`。

- 泳道依次归入界面/自动化、命令/读模型、事件三组，只显示用到的泳道。两段名称 `命名空间.实体`（标识符用英文字母、数字和下划线）按命名空间细分泳道；三段及以上的名称不拆出命名空间。
- `tf` 未显式指定来源时，从最近的、位于不同泳道的前一帧连入；`rf` 不推断入边。重复写 `->> 编号` 可指定多个来源，覆盖推断。来源类型不匹配仅提示，显式连线仍绘制。连线采用正交走线。
- 帧可附 `{ 数据 }` 或带引号的内联数据，也可用 `[[名称]]` 引用多行 `data 名称 { … }`（结束 `}` 单独顶格一行）。数据按文本显示，窄屏超过四行时显示省略行数，悬停可见全文。`note`、`entity` 和 `gwt` 显示在泳道下方。
- 支持正文或前言区 `title`、`accTitle` / `accDescr` 无障碍字段。标题支持常见实体、换行和 `fa:fa-…` 图标，未知图标只提示；数据正文不解释为标签或 HTML。前言区或初始化指令中的 `eventmodeling.padding` 控制外边距（8–120 px），`rowHeight` 不生效。本语法不接受样式、类或点击语句。窄屏将泳道名放在各泳道上方，必要时在图框内横向滚动。

## agentflow-beta

智能体工作流。头行可指定 `TB` / `TD` / `BT` / `LR` / `RL`。用 `flow agent["智能体"] … end` 嵌套分组，`global … end` 声明不归入分组的共享节点，`connector api["外部服务"]` 声明连接器。节点用 `id["标签"]@{ shape: task }`，角色形状有 `task`、`tool`、`input`、`decision`、`refdoc`、`action`。`-->` 表示顺序，`-.-` 表示引用，`--x` 表示失败；边可带文字标签。

`agent@{ view: collapsed }` 将分组折成一个节点并保留与外部的连线。`instruction`、`model`、`connectorRef` 等元数据显示在提示中；适合宽度时，在节点上额外显示 `params` / `returns`。主题由 KChart 决定；ELK、间距覆盖和点击回调不执行，旧式或未知形状会提示并回退为 `task`。

Mermaid flowchart、stateDiagram-v2 与 journey 可用前言区 `title`，阅读文档必须给图题。原生泳道也可用前言 `title`；无标题不应靠源码外的文字补足图自身的阅读语境。
