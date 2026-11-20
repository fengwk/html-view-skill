# 架构图

系统分层、模块边界和静态依赖使用本族。只表达结构，不暗示调用先后；有消息顺序时改用 `sequenceDiagram`，强调跨角色责任时用 `swimlane`。

## layers

原生 `layers` 每层最多 6 组、每组最多 30 项，最多 8 层；层名和能力项宽度受限（层名最大 160px、能力项最大 208px），过宽会报错。每层写 `- 层名 | 说明`，其下用 `- 分组: 能力项, 能力项`；也可用 `- 分类 > 能力项, 能力项`。分组可标 `{db}` 或 `{ext}`；能力项前缀 `+`、`~`、`=` 分别表示新增、改造、复用。顶层不能混合层与分组模式，能力项不能脱离所属层；名称过宽、语法错误或超限会报错，应修正结构而非删除事实。

## blocks

原生 `blocks` 表达嵌套容器与容器间依赖。支持 `row`、`col` 布局，最多嵌套 4 层、80 个容器、160 个能力项和 8 条关系；标签最多 24 字符、2 行，容器标题最多 3 行。`box 名称` 可含 `{db}` / `{ext}` 标记，能力项可写在 box 内；关系用顶格的 `A -> B: 标签`（同步）或 `A ~> B: 标签`（异步）。容器名必须唯一，关系端点必须能唯一解析，标签和图标须符合受控范围；未知节点、图标、无通道关系和超限均报错。相邻容器之间没有可用箭头通道时，调整容器顺序或改用其他关系图，不要假定渲染器会绕过遮挡。超出上限时先拆成总图和分图；确实需要一张图表达更深的嵌套或更多关系时，按[手写 SVG](../guides/custom-svg.md) 绘制。

```blocks
---
title: 订单服务依赖支付服务
---
row
  box 订单服务 {ext}
    查询订单, 校验状态
  box 支付服务
    创建退款, 通知渠道
订单服务 -> 支付服务: RPC 调用
订单服务 ~> 支付服务: 退款事件
```

## C4Context

用 `Person`、`Person_Ext`、`System`、`System_Ext` 表达人员与系统，用 `Enterprise_Boundary` 等边界宏分组。

五种 C4 图共用 `Rel`、`BiRel`、`Rel_Back`、`RelIndex` 及方向关系宏（如 `Rel_L` / `Rel_Left`）。支持[通用样式、链接和标签图标](mermaid.md)；宏自带的 `sprite`、`tags`、`link` 等外观属性不应用并告警。`c4.c4ShapeInRow` / `c4.c4BoundaryInRow` 调整每行元素或边界数。未知语句、未声明的端点或未闭合的边界报错。

## C4Container

用 `Container`、`ContainerDb`、`ContainerQueue` 和 `System_Boundary` 表达容器及依赖。样式、配置、关系和诊断见 [C4 通用规则](#c4context)。

## C4Component

用 `Component` 与 `System_Boundary` / `Container_Boundary` 表达组件及边界，不表达执行顺序。样式、配置、关系和诊断见 [C4 通用规则](#c4context)。

## C4Dynamic

表达元素间有方向的交互。按声明顺序编号，不采用 `RelIndex` 给出的编号。样式、配置、关系和诊断见 [C4 通用规则](#c4context)。

## C4Deployment

用 `Deployment_Node`、`Node_L` 或 `Node_R` 声明部署节点，可嵌套并包含其他 C4 元素。样式、配置、关系和诊断见 [C4 通用规则](#c4context)。

## architecture

也接受 `architecture-beta`。`group id(icon)[名称]` 声明分组（可嵌套，`in 父组`），`service id(icon)[名称] in 组` 声明服务，`junction id` 声明连线交汇点（画成点，不画成框），`a:R --> L:b` 按端口 `L`/`R`/`T`/`B` 连线，`{group}` 后缀可连到分组边界。内置图标 `cloud`、`database`、`disk`、`internet`、`server`；`logos:…`、`mdi:…` 等图标名按内置图标或宿主注册的图标解析，解析不到时省略图标并告警。`align row` / `align column` 可指定对齐；`architecture.padding`、`iconSize`、`fontSize` 调整间距与尺寸（均在 `config.architecture` 下）。支持通用样式与安全链接。端点未声明或分组端口未跨越所属分组边界时会报错。

## block

也接受 `block-beta`。块图按作者给定的网格排布：`columns N` 或 `columns auto` 设列数，`id["名称"]` 等方括号写法声明块及形状，`id:2` 跨列，`space` / `space:N` 留空位，`block:id … end` 嵌套分组，`id<["标签"]>(right)` 画块状箭头，`A --> B` / `A -- 标签 --> B` 画连线。列数、顺序和跨列按源码落位；窄屏时滚动，不重排网格。`block.padding` 调整嵌套块内边距。支持通用样式、链接和标签图标；网格无法容纳关系走线时会报错。

## wardley-beta

Wardley 地图用 `anchor 名称 [可见度, 演化]` 放置锚点，用 `component 名称 [可见度, 演化]` 放置组件。可见度沿纵轴从下往上增加，演化沿横轴从左往右增加。坐标须带小数点：0–1（含 `1.0`）按比例解释，大于 1 且不超过 100 按百分数解释。复杂名称可用双引号；组件可附 `label [dx, dy]`、`(build)` / `(buy)` / `(outsource)` / `(market)` 和 `inertia`。

- `A -> B` 表示依赖，`A -.-> B` 画虚线；`A +> B`、`A +< B`、`A +<> B` 分别画正向、反向、双向箭头。行尾 `; 标签` 或 `A +'标签'> B` 可标文字。`evolve A 0.8` 表示向目标演化值移动。依赖保持在两端的直线上；经过其他组件时留空，重合部分共用一段线。显式 `label [dx, dy]` 不自动移位，压线时加底色保证文字可读。
- `evolution 阶段 -> 阶段` 自定义阶段，`阶段@0.5 / 副标题` 可标该阶段的右边界和副标题。边界不齐、未递增或未到 100% 时回退到等宽阶段并提示。`pipeline 父组件 { … }` 内逐行写 `component 名称 [演化]`，子组件继承父组件的可见度。
- `note "文本" [可见度, 演化]` 添加备注；`annotation 1,[可见度, 演化] "文本"` 画编号标记，`annotations [可见度, 演化]` 指定图例首选位置。`accelerator "名称" [可见度, 演化]` 和 `deaccelerator "名称" [可见度, 演化]` 画方向相反的作用力箭头。
- 支持正文 `title` 和共享无障碍字段 `accTitle` / `accDescr`。前言区或初始化指令可设 `config.wardley.width`、`config.wardley.height`；正文 `size [宽, 高]` 优先。画布必要时为标签留出额外空间，窄屏横向滚动。标题和显示标签支持常见实体、换行和 `fa:fa-…` 图标；未知图标只提示，不画占位。`showGrid` 不生效并给出配置警告。无效坐标、未闭合的管道或无效引用会报错；不接受通用样式或点击语句。

阅读文档须提供图题；优先使用前言 `title`，不依赖图框外的说明。
