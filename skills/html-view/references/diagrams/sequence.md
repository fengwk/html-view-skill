# 时序图

参与者间调用、消息和返回有明确先后时使用时序图。模块静态依赖不代表发生顺序；不要用时序图代替架构关系图。

## sequenceDiagram

- 使用 `participant`、`actor` 声明参与者，可用 `as` 设置别名，或用 `@{ type: database, alias: 订单库 }` 设置类型与别名。类型包括 `participant`、`actor`、`boundary`、`control`、`entity`、`database`、`queue`、`collections`。支持 `create` / `destroy`；下一条消息必须发给新建参与者，或涉及即将销毁的参与者。
- 支持实线和虚线的普通、双向、无箭头、叉形、异步和半箭头，以及 `()` 中心连接与自调用。`activate` / `deactivate` 或消息箭头后的 `+` / `-` 控制激活条；结束激活必须有对应的开始，未结束的激活持续到生命线终点。`autonumber [起始值 [步长]]` 为消息编号，`autonumber off` 停止编号。
- `Note left of`、`Note right of` 和 `Note over` 可添加注释；`Note over A,B` 横跨两条生命线及其间的参与者。`alt/else`、`opt`、`loop`、`par/and`（含 `par_over`）、`critical/option`、`break`、`box` 和 `rect` 以 `end` 结束。`box` 与 `rect` 可使用 `rgb()` 等颜色，映射为主题状态色；无法映射的颜色显示为中性色并给出警告。
- 支持前言区 `title` 或正文 `title:`。可用 `config.sequence.mirrorActors: false` 隐藏底部参与者卡片，或用 `config.sequence.showSequenceNumbers: true` 默认开启编号。支持[通用样式、链接和图标](mermaid.md)；未知的参与者类型提示后按普通方框绘制。
- `link A: 文档 @ https://example.com` 与 `links A: {"文档":"/help"}` 为参与者卡片保留第一个安全 URL；省略弹出菜单并给出 `IGNORED_INTERACTION`；`properties`、`details` 也不显示弹出内容。
- 片段未闭合或激活、销毁等操作无效时会报错。图过宽时在图框内横向滚动，不缩小字号。

```mermaid
---
title: 查询订单并读取状态
---
sequenceDiagram
participant 用户
participant API
participant DB
用户->>API: 查询订单
API->>DB: 读取状态
DB-->>API: 返回状态
API-->>用户: 展示结果
```

## zenuml

ZenUML 是 Mermaid 外部插件，KChart 不支持该插件。`zenuml` 只保留旧文档兼容：参与者、`Client->API: request`、`Client.call()` 和 `Client.call() { API.handle() }` 等简单写法，可用正文 `title`。没有专用配置键；不支持的语句（含通用样式和点击）报错。新图请用 `sequenceDiagram`。

## usecase-beta

UML 用例图，默认 `LR`，可用 `direction TB` / `TD` / `BT` / `LR` / `RL`。`actor ID("显示名")` 声明参与者；`ID("名称")` 表示椭圆用例，`ID[名称]` 表示矩形用例。`systemBoundary "系统名" … end` 包住参与者和用例，不能嵌套；边界可用 `@{ type: package }` 显示页签。参与者支持 `@{ type: hollow }`、`@{ type: awesome }` 或 `@{ icon: "fa:user" }`；无法解析的图标会提示并回退为普通参与者。可加 `<<构造型>>`，普通/空心参与者与椭圆用例可加 `@{ business: true }`。

在边界外写关系：`-->`、`<--`、`--`、`--o`、`o--`、`--x`、`x--`；`A -- "标签" --> B` 是带标签的关联，`A --|> B` 是同类元素间的泛化，`A ..> : include B` / `A ..> : extend B` 是用例间的虚线依赖。`note for ID "文字"` 添加注释，`json ID@{ "key": "value" }` 将严格 JSON 对象展开为表格。

支持通用样式、链接和图标，不执行边动画。`config.usecase` 中可调 `actorFontSize` / `usecaseFontSize`（12–16 px，越界忽略并告警）和 `diagramPadding`。无效的参与者变体、业务类型或关系报错。

时序图可使用前言区 `title`；`zenuml` 也可用正文 `title`。阅读文档的图题必须来自图源码，不支持的额外标题选项应删除，不要以外部段落替代。
