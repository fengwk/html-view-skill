# KChart 覆盖映射与反例

本表用 51 个对照场景说明 KChart 支持的静态表现、可选交互和范围限制。它们对应[回归样例的参考 ID](../packages/kchart/tests/kchart-cases.mjs)，与当前注册的 45 个基础图型计数口径不同。字段与限制见[数据图声明](../packages/kchart/docs/declaring-charts.md)。

## 1. 图型与表现对照

图型、静态表现、交互和动画分开验收；不把静态构图纳入动态能力覆盖。

| ID | 目标声明 | 数据和受控表现 | 范围限制或需单独判断的部分 |
|---|---|---|---|
| G3 | bar | category/value，solid胶囊条 | 无 |
| G4 | waffle | category/value，100点构成 | 点阵动画排除 |
| G5 | column + pictorial | unitMark与登记图标，每符号固定数量 | 不是装饰图标堆砌 |
| G6 | network + circular | nodes/edges，邻接聚焦 | 暗卡是宿主主题，不在单图混色 |
| G7 | tree + right | 嵌套树 | 无 |
| G8 | split-compare | 同期上方倒挂短柱和下方面积，共用时点、独立单位 | 不将同期变化声明为因果 |
| G9 | scatter 或 parallel | 同一实体多维数据的静态图 | 视图变形、轮播排除，不称完整动态覆盖 |
| G10 | bar | 原生正负值 | 正负不依赖红绿 |
| G11 | network + force | 可选inspect/focus/drag/pan-zoom | 自动回弹与物理入场排除 |
| G12 | column | 25–60类单系列高密度通栏图 | 错峰入场排除 |
| G13 | radial-share | category/value/intensity，角度与半径平方双编码 | 必须分别声明量纲与静态说明 |
| G14 | bubble-matrix | row/column/value，点面积表示量 | 不误映射成普通色块热力 |
| G15 | strip | category/value，逐记录确定性抖动 | 不从汇总数据编造样本 |
| G16 | bump | 时点/实体/rank的静态排名轨迹 | 排名竞赛动画排除 |
| G17 | area | 已有时窗的静态趋势 | 实时数据流与滚动动画排除 |
| G18 | line + counter | 末值突出与趋势线同图 | 动态计数/描线排除 |
| G19 | violin | 已给density与median | 不运行时拟合样本 |
| G20 | heatmap + cells | row/column/value，每格直接读数 | 高密度不静默隐藏格内值 |
| G21 | bump | 离散排名与并列名次 | 无 |
| G22 | sankey | 聚合边流量 | 不冒充逐路径流量 |
| L1 | launch-fan | label/start/value，起始时点与当前规模 | start显式类型 |
| L2 | bar + rungs | 单位计数排名 | 原始值、单位与部分符号保留 |
| L3 | line + barcode | 日读数条码与顶点 | 不把数据改成装饰条码 |
| L4 | heatmap + arc | 明确比例或[0,max]的矩阵 | 完整弧对应什么数值可见 |
| L13 | funnel + hourglass | 单调递减各阶段数量 | 沙漏式流线须单独目检 |
| L14 | waffle + field | 疏朗点场，每点1个百分点，原值可读 | 不虚构每点代表一个真实人 |
| L15 | tally | 多选比例，各项独立0–1 | 不按总和重新归一化 |
| L17 | calendar | 一年日期与量 | 区分未采集与0 |
| L20 | parallel | 一实体一条线，3–6维 | 独立单位与范围 |
| F1 | column + rungs | category/value，真实单位 | 竖向计数柱 |
| F2 | line | 发丝线、逐点读数 | 无 |
| F3 | area | 时间趋势与淡填充 | 0基线 |
| F4 | donut + ticks | 少类别份额，刻度环 | 不是多重仪表盘 |
| F5 | bar + rungs | 横向单位计数排名 | 与F1共用算法、不同方向 |
| F6 | column + rungs | category/value[]，前后双系列 | 同单位、不隐去比较标签 |
| F7 | column + rungs + absolute stack | 堆叠单位计数 | 禁止percent stack与unitMark混用 |
| F8 | scatter + plumb | x/y，细垂线与点 | 垂线不改变尺度 |
| F9 | waterfall + rungs | 增减量及start | 起止合计、符号与部分单位 |
| F10 | heatmap + dots | 星期×小时量，明度点阵 | 点数不假扮样本数 |
| F11 | gauge + ticks | 一值、range、可选target | 比例采用0–1 |
| F12 | dumbbell + rungs | before/after单位串珠 | 仅非负、同单位可数数据 |
| F13 | treemap | 嵌套树与叶子权重 | 小格外置完整名称，不丢标签 |
| F14 | histogram + rungs | 数值区间、频数、单位档 | 不等宽箱按面积/密度表达；不可等宽当类别 |
| F15 | boxplot | 须端、四分位、中位数和outliers数组 | 不从五数编造异常点 |
| F16 | stream | 时点和2–5系列完整非负量 | 中心基线，静态总厚度可读 |
| F17 | candlestick | 时间及OHLC | 空/实标涨跌，口径可读 |
| M1 | choropleth + us-states资产 | 地区代码和值 | 仅匹配内置资产中的州代码；来源署名与政治边界说明不可省略 |
| M2 | choropleth + world资产 | 地区代码和值 | 仅匹配资产键；政治边界说明和数据口径不可省略，不模糊匹配名称 |
| B1 | network + circular + membrane | 60节点带状关系，inspect/focus | 受控弦膜表现需视觉验收，不等同桑基 |
| B2 | network + force | 180节点，inspect/focus/drag/pan-zoom | 静态收敛及性能另验；回弹动画排除 |
| B3 | threads | 原始paths，按路径/节点整束聚焦，点击钉住 | 不用聚合边猜路径；静态导出完整初始态 |

报告和演示版式属于页面编排，不计入 KChart 图表能力。

## 2. 原17种图

原 line、area、column、bar、share、funnel、sparkline、bullet、dumbbell、slope、waterfall、heatmap、histogram、boxplot、scatter、waffle、small-multiples 均有明确chart与角色，表格输入由适配器转换。boxplot原min/max位置映射到新语义的low/high须端，旧无异常点数据不额外推断外点。既有百分数表格中98.1%语义转换成协议比例0.981，不把两种数值语义混在同一核心。

小多图默认共享范围；子弹图右侧实际/目标两行；瀑布长读数按单位边界换行；百格最大余数法；热力正墨负强调色；全部是视觉回归硬约束，不因DSL更换而改变。

## 3. 脑图

同一树形data必须可用于bilateral、right、left、radial、org、brace、fishbone、timeline八个layout取值。每个布局都有不平衡、深链、中文长词、同名不同ID、单根与暗色案例。timeline表达给定阶段顺序，不用树图位置冒充真实日期轴；fishbone不从树数据推断因果。

Mermaid mindmap 转入树模型；其余 Mermaid 图种仍使用原文本，不要求改写成 KChart 节点和边。原有 flowchart、stateDiagram-v2、erDiagram、sequenceDiagram、mindmap 五类之外，新增 22 个 Mermaid 扩展入口（合计 27 个入口）；每类只支持实现和语法参考中列明的子集，不能据此宣称兼容全部 Mermaid 语法。

## 4. 反例与预期

声明示例见 [kchart-examples.json](../packages/kchart/tests/kchart-examples.json)。其中数据全部虚构，用于说明当前协议下的预期接受/拒绝语义；该文件是示例，不是校验器测试运行报告。自动验证以当前实现测试为准。

| 风险 | 必须得到的行为 |
|---|---|
| 缺失月份 | 日期补空档，断线，不补0 |
| 宽/长多系列 | 相同图模型，重复组合报错，不自动求和 |
| 相同字段用于两个编码 | 允许有意义的重复角色；冲突的元数据或坐标含义报错，不重复计算 |
| 金额与比例混轴 | 普通line拒绝；combo显式左右轴，split-compare显式上下区域 |
| 98和0.98的百分比 | percent固定表示比例，既有表格由适配器转换；不凭值范围猜 |
| 五数与异常点 | 须端有明确定义，外点须在须线外 |
| 密度和中位数 | 预计算density与median独立提供，不伪造原样本 |
| 重复树标签 | 可有同名节点，ID不混淆 |
| 网络环和平行边 | network允许，保留身份；sankey拒绝环 |
| 流入流出不守恒 | 报错，要求明确流失/补充，不制造节点 |
| 两条相同节点序列路径 | 不合并，按path.id保留原记录 |
| 未知地图键 | 报错，不模糊猜地区 |
| 25–60类柱 | 单系列solid通栏可表达，窄容器明确诊断，不缩字号 |
| 变体选错图 | 报字段/枚举错误，不静默回默认 |
| 任意颜色、引擎options、version | 非协议字段，拒绝 |
| 动态播放配置 | 不在当前协议，拒绝 |

## 5. 维护与证据

本清单是参考覆盖和真实范围的维护文档。当前图型入口、字段契约和 schema 由 KChart 注册信息提供；修改实现时同步核对本表、DSL 与示例，使文档始终反映当前能力。

能力判断应分别核对声明/语义验证、布局与静态导出、实际视觉可读性。自动化检查通过不能代替视觉目检，也不代表任意输入都具有良好审美。超出明确支持范围的动态效果、地图数据、语法和页面编排必须继续标为限制，不能计入完整覆盖。
