# 数据报表

数据报表把已聚合数据包呈现为 KPI、KChart、表格和叙述。数字的唯一来源是 `report.json` 引用的 CSV/JSON；本工具不执行 SQL、不查询实时数据、不补造观测值，也不把空值解释为零。只改数据包后重新 `data build`，不要直接编辑生成页面。

## 工作流程

1. `htmlview data init <dir>` 创建使用虚构值的起始数据包。
2. 按 [data-package.md](data-package.md) 填写 `report.json` 与数据文件，明确上游聚合粒度、指标口径和缺失语义。
3. `htmlview data validate <dir>/report.json` 校验契约、计算、期间比较及 KChart 声明；先修复所有 error。
4. `htmlview data build <dir>/report.json --out <report.html>` 生成离线报表。目标已存在时，仅在确认覆盖目标后加 `--force`。
5. `htmlview audit <report.html>` 检查生成内容完整性；需要换主题时用 `htmlview style <report.html> --theme <id>`。`style` 在写入前执行相同的数据完整性门禁。

`layout` 只决定 `analysis`、`periodic`、`dashboard` 或 `brief` 的页面组织，不改变数值计算：`analysis`/`brief` 先叙述再 KPI；`periodic`/`dashboard` 先 KPI、图表、表格再叙述；看板图表按两列排布，手机与打印改为单列；看板放哪些数、选什么图、强调什么见[看板设计](../guides/dashboard.md)。页面保留可键盘操作的静态视图标签，导出时展开所有视图；打印时视图名称与紧随其后的内容相连，不强制另起一页。`period.current`、`compare`、`timezone` 和 `complete` 决定本期与比较期语义。`complete:false` 时保留内存中的当期结果但不生成比较；若同时请求比较，`PARTIAL_PERIOD` error 阻止 build，不能把未完整期间交付为完整报告。

## 内容块

- `kpi` 从已声明指标生成带证据绑定的数值、单位以及环比/同比文案；所有指标 kind 的 `format:"percent"` 在 KPI、表格、图表和叙述占位符共用同一 displaySpec（原始 `0.14` 显示为 `14.0%`）。百分比 `mom_delta`/`yoy_delta` 表示百分点；`unit:"%"` 与 `format:"number"` 冲突时 validate 会拒绝。

- `chart` 只写 KChart `chart` 图型名与 `encode` 角色映射；字段必须来自该数据集的维度或指标。图型从当前 KChart catalog/schema 选择并验证。不要在图块中写 `data`、`fields`、`unit` 或 `columns`；数据、字段标签、单位、格式和精度由数据集记录与指标元数据生成。
- `table` 的 `columns` 仅用于指定数据表显示哪些已声明字段，不是图表列角色协议。表只列当前期间的记录（`periodField:null` 的数据集列全部记录），默认标题是数据集 `label` 加期间，如「分馆月度汇总（2026-06）」。单元格显示带千分位的原值，不缩写成万、K；列多时表格在自己的容器里横向滚动。要展示历史走势用图块。
- `text` 引用 Markdown 文件。正文中的图形只能以 `kchart` fenced block 写 `{"ref":"图表块 id"}`，引用当前报表已有的带 id 图表；不接受其他图形语法。被引用的图只显示在引用处，图表区不再重复；没被引用的图留在图表区。叙述用 Markdown 写，小标题从 `###` 开始：一级、二级标题由页面和内容块占用，写了会报 `NARRATIVE_HEADING`。其中的 HTML 片段在 `validate` 阶段就按 `audit` 的内容规则检查：脚本、事件属性、脚本 URL、外部或未内嵌资源、行内样式和未登记的 class 都报 `BAD_TEXT`，`build` 不写文件。

## 叙述里的数字

叙述引用数据包里的数值时写占位符，不要手抄。占位符取与 KPI 相同的指标值，并记录证据；切换视图时取该视图的值。与可缩写的 KPI 不同，正文和表格中的绝对数用千分位，不用万、K、M。

```markdown
六月纸本借出 {{loans.value}} 册次，环比{{loans.mom_text}}；上半年分类合计 {{categories.loans_h1.value}} 册次。
```

- 写法是 `{{指标.字段}}`；多个数据集有同名指标时写 `{{数据集.指标.字段}}`。
- 字段：`value` 是当前期间的值（`periodField:null` 的数据集是全部记录的聚合值）；`label`、`unit`、`definition` 取指标元数据；`mom_` 或 `yoy_` 加 `text`、`value`、`baseline`、`delta`、`rate` 取比较结果，`text` 是「增长 9.1%」这样的成句。未请求的比较显示为「—」。
- 占位符只能取已声明指标的当期值和比较。半年合计、各分馆排名等另一种口径的数，由上游提供已汇总文件，作为 `periodField:null` 的数据集接入。缺少对应的上游结果时，说明口径缺口，不用手算值代替绑定。
- 引用不存在的指标或字段是 `UNKNOWN_TOKEN` error。手写数字只产生 `UNBOUND_NUMBER` 提示，不阻止 build；日期、代码和链接不提示。数据包之外的事实（如闭馆天数）可以保留提示。
- 报表末尾已经列出来源、提取时间和每个指标的 definition。不要为了消除提示在每句后加「来源：…」，那会打断阅读。

视图过滤选择上游已聚合的记录，不对明细数据分组计算新口径。图表按其 `encode` 维度组织这些记录；月份键无论映射到哪个 `encode` 角色，都会按日历顺序保留历史并在首末月份间补 `null` 空档；其他图使用当前期间。合计行只参与一次：按总计维度分组时从构成图数据中排除，其他分组则优先使用唯一合计行。指标只按所声明 kind 聚合，并保留合计一致、缺失、distinct 和时点指标保护。表格数字保存原始排序键，空值排序在末尾。

报表正文固定显示期间、比较基准、时区、完整性、来源/提取时间和指标 definition。KPI、绑定值与数据表单元格记录 evidence；表、叙述、KChart 声明及页面 header 一起处于内容区 SHA-256 门禁下。审计会核对显示绑定和表数据摘要；style 通过 `renderShell` 重新生成主题外壳，并保持解析出的内容区字节完全不变。

生成的表格、叙述、图形声明和其他报表内容作为整体受完整性校验。若内容被改动，`audit` 与 `style` 拒绝处理并要求从数据包重新 build；不要通过改 hash 或手工修补生成页面绕过门禁。
