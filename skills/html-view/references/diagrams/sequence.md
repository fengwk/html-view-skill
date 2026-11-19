# 时序图

参与者间调用、消息和返回有明确先后时使用时序图。模块静态依赖不代表发生顺序；不要用时序图代替架构关系图。

## sequenceDiagram

声明 `participant` 或 `actor`，消息使用受控箭头表达同步、返回、异步或丢失；支持自调用、激活、`Note`、`box` 分组及 `rect` 区段。组合片段 `alt/else`、`opt`、`loop`、`par/and`、`critical/option`、`break` 都以 `end` 结束，最多嵌套两层。最多 8 个参与者、40 条消息，标签最多 3 行。激活必须配对；`rect` 不接受颜色，外观由主题控制；不支持的语句会报错，不得当作已绘制。

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

受控 `zenuml` 支持参与者、`Client->API: request` 消息、`Client.call()` 调用和单行嵌套调用 `Client.call() { API.handle() }`；可用 `title` 正文语句。其他 ZenUML 语法不支持，检查会给出源码位置和改法；不要假定完整兼容。

时序图可使用前言区 `title`；`zenuml` 也可用正文 `title`。阅读文档的图题必须来自图源码，不支持的额外标题选项应删除，不要以外部段落替代。
