---
name: html-view
description: 生成、检查和导出离线单文件 HTML 文档、数据报表和界面稿，并绘制 SVG 数据图与结构图。需要向用户交付供阅读、核对或评审的 HTML 时先加载此技能，例如 HTML 形式的技术方案、调研报告、评审材料、会议纪要、经营报表、Dashboard、界面线框或可点击原型，包括把 Markdown、CSV 或 JSON 做成 HTML。需要单独的数据图或结构图，或需要阅读、检查、截图、换主题、把本地 HTML 导出为 PDF 或 PNG 时也使用。
---

# HTML View

`node <skill-dir>/scripts/htmlview` 是跨平台命令入口；以下用 `htmlview` 简写。需 Node.js 22+；浏览器检查、截图、导出和独立图渲染还需 Chrome 或 Chromium。找不到浏览器时按 `error.next` 处理。

## 先选产物

| 用户要的结果 | 做法 | 何时展开 |
|---|---|---|
| 便于阅读和批注的技术方案、报告、说明、纪要或一页纸 | 有 Markdown 用 `doc build`；直接编辑 HTML 用 `doc new` | 先读[文档流程](references/artifacts/doc.md)；手写 HTML 组件、加交叉引用或处理评论时读[文档组件](references/artifacts/doc-components.md) |
| 要核对经营数字、口径和图表的报表或 Dashboard | 从上游汇总文件建数据包；`data validate` 后 `data build` | 先读[报表流程](references/artifacts/data.md)，改字段、指标、图或叙述时读[数据包](references/artifacts/data-package.md)；做 Dashboard 时读[看板设计](references/guides/dashboard.md) |
| 展示屏幕、状态或交互流程的线框、高保真稿或原型 | `ui new` 后填每个屏幕，用真实控件取值 | 先读[界面稿流程](references/artifacts/ui.md)，选组件或写交互时读[组件索引](references/artifacts/ui-components.md)；定版式、配色或手写组件时读[界面设计](references/guides/ui-design.md)；画数据看板时读[看板设计](references/guides/dashboard.md) |
| 单张 SVG 或离线图页 | 选下表图族，写声明，再 `viz render` | 数据图先读[声明通则](references/charts/common.md)，再读所选图族；结构图直接读对应图族 |
| 读取、检查、截图或导出本地 HTML | 使用 `read`、`check`、`shot`、`export` 或 `embed` | 参数和检查结果见[显示与导出](references/guides/check-export.md) |

- 素材不是现成的页面结构时，如零散笔记、会议记录、JSON、CSV、日志，或需要重排的 Markdown，写内容前读[从材料到页面](references/guides/from-source.md)。
- HTML 产物为单个可离线打开的文件。手写时只改标题和 `<!-- htmlview:content -->` 与 `<!-- /htmlview:content -->` 之间的内容；两条标记各保留一次，布局、主题和运行脚本由 CLI 组装。
- Markdown 构建的文档改 Markdown 源；数据报表改数据包，不直接改生成的文字、图或数字。没有来源的数据不得编造；演示数据要标明是虚构示例。
- `style` 保留内容，重组外壳。覆盖已存在的独立成果，须确认目标后才用 `--force`；同源文档更新不需要 `--force`。
- 未传 `--lang` 时，生成命令按标题和正文推断图号、目录、图例等外壳用语：英文词数至少是中日韩字数的两倍时用英文，否则用中文。其他语言或中英各半的内容显式传 `--lang`。

## 按读者要看什么选图

默认使用静态图。数据图用 KChart JSON；结构关系用 Mermaid 或原生声明。先查[配置、样式、链接和诊断通则](references/diagrams/mermaid.md)，再查对应图型；KChart 不照搬 Mermaid 的外观。仅填写数据、语义和阅读意图，不写坐标、字号、颜色或绘图脚本。图内放不下可滚动，页面本身不应横向溢出。

| 读者问题 | 图型入口 | 按需阅读 |
|---|---|---|
| 怎么变化、何时改变？ | `line`、`area`、`sparkline`、`small-multiples`、`stream`、`combo`、`bump`、`candlestick`、`launch-fan` | [趋势](references/charts/trend.md) |
| 哪个更大、差多少、离目标多远？ | `bar`、`column`、`dumbbell`、`slope`、`bullet`、`gauge`、`interval`、`split-compare` | [比较](references/charts/comparison.md) |
| 总量怎么组成、各步骤损失多少？ | `share`、`pie`、`donut`、`radial-share`、`rose`、`funnel`、`waterfall`、`waffle`、`tally`、`treemap`、`sunburst` | [构成](references/charts/composition.md) |
| 数值如何分布、有无离群或相关？ | `histogram`、`boxplot`、`violin`、`strip`、`scatter` | [分布](references/charts/distribution.md) |
| 多维矩阵或日历中哪里异常？ | `heatmap`、`bubble-matrix`、`calendar`、`radar`、`parallel` | [矩阵](references/charts/matrix.md) |
| 谁与谁连接、量如何流转？ | `network`、`sankey`、`threads` | [网络](references/charts/network.md) |
| 分布在哪里？ | `choropleth`、`geo-scatter` | [地图](references/charts/maps.md) |
| 如何分类、怎么从主题展开？ | KChart `tree`、`mindmap`；Mermaid `mindmap`、`ishikawa`、`treeView-beta` | [层级与脑图](references/diagrams/hierarchy.md) |
| 流程从谁到谁、状态如何转移？ | `flowchart`、`stateDiagram-v2`、`journey`、`swimlane-beta`、`eventmodeling`、`agentflow-beta`、原生 `swimlane` | [流程](references/diagrams/flow.md) |
| 调用先后和参与者是谁？ | `sequenceDiagram`、`usecase-beta` | [时序](references/diagrams/sequence.md) |
| 如何排期、分栏或编号？ | `gantt`、`timeline`、`gitGraph`、`kanban`、`packet`、`quadrantChart` | [时间与网格](references/diagrams/time.md) |
| 实体、类或需求怎样关联？ | `erDiagram`、`classDiagram`、`requirementDiagram` | [数据模型](references/diagrams/data-model.md) |
| 一条语法规则怎样匹配符号？ | `railroad-beta`、`railroad-ebnf-beta`、`railroad-abnf-beta`、`railroad-peg-beta` | [数据模型](references/diagrams/data-model.md) |
| 系统如何分层、容器和依赖在哪里？ | `C4Context`、`C4Container`、`C4Component`、`C4Dynamic`、`C4Deployment`、`architecture-beta`、`block`、`wardley-beta`、原生 `layers`、`blocks` | [架构](references/diagrams/architecture.md) |
| 手头已有 Mermaid 数值图？ | `pie`、`xychart`、`sankey`、`radar-beta`、`treemap` | [Mermaid 数值图](references/diagrams/time.md#mermaid-数值图)；新数据图用上方 KChart 图型 |
| 集合如何重叠、情境如何分类？ | `venn-beta`、`cynefin-beta` | [集合](references/charts/composition.md#venn-beta)、[情境](references/charts/matrix.md#cynefin-beta) |
| 旧文档中的简单调用图？ | `zenuml`（仅旧写法，不支持 ZenUML 插件） | [旧版兼容](references/diagrams/sequence.md#zenuml) |

Markdown 用 `kchart`、`mermaid`、`layers`、`blocks`、`swimlane` 围栏；手写 HTML 用 `<pre data-viz="语法">`，转义其中的 HTML 特殊字符。文档图题写在声明中：KChart `title`，结构图前言 `title:` 或该语法支持的标题语句。图题和图中文字与正文用同一种语言。内置图族放不下或表达不了时，如嵌套过深、关系过多或机制示意，先拆成总图和分图；仍需手画时读[手写 SVG](references/guides/custom-svg.md)。

## 命令速查

| 要做什么 | 命令 |
|---|---|
| 文档起稿／从源生成 | `htmlview doc new plan.html --type plan --title '容量评估计划'` 或 `htmlview doc build spec.md --out spec.html --type tech-spec` |
| 数据包和报表 | `htmlview data init example` → `htmlview data validate example/report.json` → `htmlview data build example/report.json --out report.html` |
| 界面稿骨架 | `htmlview ui new prototype.html --title '申请处理' --device mobile --screens '列表,详情'` |
| 静审、比较内容 | `htmlview audit file.html`；`htmlview diff old.html new.html` |
| 为文档或界面稿重新装入图模块 | `htmlview style file.html`（保留现有主题与内容） |
| 换主题或界面配色 | 文档／报表／单图 HTML：`htmlview style file.html --theme paper`（`htmlview style --list` 列出主题）；界面稿：`htmlview style file.html --scheme dark` |
| 显示检查、截图、导出 | `htmlview check file.html`；`htmlview shot file.html --select 'figure'`；`htmlview export file.html --format pdf`；整页长图 `htmlview export file.html --format png` |
| 读取正文、内嵌本地资源 | `htmlview read file.html [--outline 或 --section id]`；`htmlview embed file.html` |
| 独立图、字段约束、主题色、手写图量字 | `htmlview viz render spec.json --out chart.svg`；`htmlview viz schema bar`；`htmlview viz palette --theme paper`；`htmlview viz measure '订单服务' --size 13` |

用户自带配色时用 `--theme-file <JSON>`，字段和示例见[主题文件](references/guides/themes.md)。主题随 HTML 内嵌；界面稿使用独立品牌配色。

`htmlview <子命令> --help` 给出精确参数。检查类命令的 `pass:false` 是已完成检查但发现问题；按 `failures[].fix` 修。`ok:false` 是命令没能完成，按 `error.next` 处理。

## 验证再交付

1. 新建或修改产物后运行 `audit`。缺少图模块时运行 `style` 重组，再审计；报表有证据不一致时回数据包修正。
2. 对会改变显示的改动运行 `check`，再 `shot` 打开实际截图。看标题层次、文字归属、留白和手机首屏；宽图打开完整 SVG 检查。带交互的原型实际点过关键路径。
3. 交付 PDF 时打开实际 PDF，确认图题和图身同页、边缘完整。遇到打印提示，换合适的纸型或调整布局，保留可读字号；无法完整打印则说明限制。
