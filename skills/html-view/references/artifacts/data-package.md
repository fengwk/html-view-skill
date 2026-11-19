# 数据包契约

`report.json` 是报表契约和真实数字的唯一入口。文件路径均相对 `report.json`，解析后不得越出数据包目录。只接受上游已聚合的 CSV/JSON，不执行查询或 SQL；来源中的 `query` 等内容若保留，只作为说明文字，不执行。

## 最小结构

```json
{
  "title": "虚构服务 2026 年 10 月月报",
  "layout": "periodic",
  "period": {"current":"2026-10","compare":["mom","yoy"],"timezone":"Asia/Shanghai","complete":true},
  "sources": [{"id":"warehouse","name":"虚构月度汇总","pulledAt":"2026-11-02T01:30:00Z"}],
  "datasets": [{
    "id":"monthly","file":"data/monthly.csv","source":"warehouse","periodField":"month",
    "dimensions":{"month":{"type":"month","label":"月份"},"channel":{"type":"category","label":"渠道"}},
    "measures":{
      "revenue":{"label":"收入","unit":"元","kind":"sum","definition":"已支付金额，不含退款"},
      "orders":{"label":"订单数","unit":"单","kind":"sum","definition":"已支付订单数"},
      "visits":{"label":"访问次数","unit":"次","kind":"sum","definition":"已汇总访问次数"},
      "payers":{"label":"付费用户","unit":"人","kind":"distinct","definition":"上游按月去重"},
      "conversion":{"label":"转化率","unit":"%","kind":"ratio","format":"percent","numerator":"orders","denominator":"visits","definition":"订单数除以访问次数"}
    },
    "total":{"field":"channel","value":"全部"}
  }],
  "blocks":[
    {"type":"kpi","dataset":"monthly","measures":["revenue","payers"]},
    {"type":"chart","id":"revenue-trend","dataset":"monthly","chart":"line","encode":{"category":"month","value":"revenue"},"title":"月收入"},
    {"type":"table","dataset":"monthly","columns":["month","channel","revenue"]},
    {"type":"text","file":"narrative.md"}
  ],
  "views":[{"id":"direct","label":"直接渠道","filters":{"monthly":{"channel":"直接"}}}]
}
```

顶层 `layout` 取 `analysis`、`periodic`、`dashboard` 或 `brief`。期间为公历 `YYYY-MM`，`compare` 是不重复的 `mom`/`yoy` 列表，时区必须是 IANA 名称。来源要有唯一 `id`、可读 `name` 和带时区的 `pulledAt`。数据集需声明 source、文件、维度和指标；可选 `label` 用作该数据集表格的默认标题。

指标名就是数据文件里的列名。两个数据集的同名指标各自独立，叙述里用 `{{数据集.指标.字段}}` 区分。指标字段只有这些，其他字段报 `BAD_SCHEMA`：

| 字段 | 含义 |
|---|---|
| `label`、`unit`、`definition` | 必填：可读名称、单位、口径说明 |
| `kind` | 必填：`sum`、`distinct`、`snapshot`、`ratio`、`mean`，见下文 |
| `numerator`、`denominator` | `ratio`/`mean` 必填，各指向同数据集的一个 `sum` 指标 |
| `format` | `percent` 把 0..1 的比例显示成百分数；`number`（默认）和 `currency` 显示数值加 `unit` |
| `decimals` | 0–6 的整数，固定小数位；省略时表格和叙述里整数不带小数，其余保留两位 |
| `additive` | 只用于 `snapshot`，见下文 |
| `sample` | 只用于百分比 `ratio`：声明它来自样本后，分母小于 30 时 validate 给 `SMALL_BASE` 提示 |
| `partOfWhole` | 只用于百分比 `ratio`：声明各分项合起来是整体后，四舍五入的分项合计不是 100% 时给 `SHARE_SUM` 提示 |

`periodField` 指向月份维度，省略时为 `month`。上游文件本身是整段期间的汇总、没有月份列时（如「上半年分类合计」），写 `"periodField": null`：KPI、表格和占位符使用全部记录，不生成环比、同比。覆盖的期间写进数据集 `label` 和指标 `definition`，读者才知道它不是当月数。不要给这类文件编一个月份列。

## 数据与缺失值

CSV 首行是唯一且非空字段名；支持双引号、引号转义、逗号和单元格内换行。JSON 文件是记录对象数组。空值、`null`、`—`、`–`、`-`、`n/a` 表示缺失，不表示 0。非有限数值或非数字文本报错。每个周期与维度组合只能出现一次；禁止重复键。

每行必须给出全部维度、`sum` 指标以及 `ratio`/`mean` 的分子、分母。派生指标的同名列可以省略；如果出现也不会成为计算依据。维度不能缺失。单位、标签、格式、精度均由元数据提供；所有 kind 的 `format:"percent"` 都把 0..1 原始比例值按百分比显示，KPI、表格、图表和叙述绑定共用这一 displaySpec。`unit:"%"` 且省略 format 也按百分比显示；显式写 `format:"number"` 或 `format:"currency"` 搭配 `unit:"%"` 会被拒绝，以免同一比例出现冲突显示。

`total` 可选，形如 `{ "field":"channel", "value":"全部" }`。声明后，合计行优先作为聚合结果；若合计与分项同时存在，可加指标会核对两者是否一致。没有合计行时，分项缺失使 `sum` 总量不完整，不返回部分和。缺失、错误和不完整状态不能被渲染为零。

## kind 聚合保护

- `sum`：仅加总口径完整的记录。声明 `total` 时用合计行；有合计与分项时检查差异。
- `distinct`：不可跨记录求和。只能使用一条上游聚合记录，或使用唯一合计行；不能把各分类去重人数相加成总人数。
- `snapshot`：默认不可跨记录相加；只有 `additive:true` 且记录是同一时点互斥分项时才能按 `sum` 完整性规则聚合。唯一 total 行可以独立提供结果；没有 total 时任一分项缺失都不给部分和，重复 total 键报错，空输入不造零。
- `ratio`、`mean`：从同数据集声明为 `sum` 的 `numerator`、`denominator` 重新求和后相除，不依赖用户提供的派生结果。分子/分母缺失时报不完整；分母为 0 时状态为 `zero_denominator`，不产生无穷值。

`period.complete:false` 时不生成比较；若还请求了 mom/yoy，`validate` 返回 `PARTIAL_PERIOD` error，build 不写报表。环比、同比始终按月份日历计算，不使用文件上一行。基期为零时比较模式为 `from_zero`，基期为负时为 `absolute`。

视图过滤是在已聚合行上筛选，再按以上 kind 规则计算；它不是明细查询，也不改变聚合粒度。图表分组也只组织已经聚合的记录：月份键可映射到 `encode` 的任意角色，保留历史并补 `null` 空档；没有月份键时只读当前期间。总计行若不是图表分组维度则优先使用一次，不与分项重复相加；总计维度用于构成图时排除总计行。禁止将未聚合事件行交给报表并借视图或图表生成用户口径。

## KChart 图块

图块声明的核心形式为：

```json
{"type":"chart","id":"revenue-trend","dataset":"monthly","chart":"line","encode":{"category":"month","value":"revenue"}}
```

从本地 KChart catalog/schema 选择图型，角色映射必须符合该图型 `encode` 契约。生成器由数据集中的维度/指标和值生成 KChart 的 `data`、`fields` 和单位信息，并调用 KChart 校验；用户不能把这些派生字段写进图块。表格用 `columns` 选择展示字段；图块用 `encode` 映射角色。

叙述中的图只用 KChart ref：

````markdown
```kchart
{"ref":"revenue-trend"}
```
````

引用 id 必须唯一且指向已声明的 KChart 图块。

## 视图、证据与完整性

视图为 `{id,label,filters}`；过滤键必须是所引用数据集已声明的维度，过滤值严格匹配上游记录。图表只针对过滤后的聚合数据组织 KChart 数据；时间维度使用当前数据区间，其他分类维度默认取 `period.current`。表格与 KPI 同样绑定数据包中的记录与指标。

生成 HTML 的内容区包含表格、叙述和 KChart 源码并整体计算 SHA-256。静态 `audit` 比较该内容区；发现任何更改都拒绝通过。`style` 先执行同样门禁再改主题。修复方式是修改原数据包并重新 build，而不是编辑生成的数字或重写完整性标记。

路径、JSON/CSV 解析、契约、指标和图表失败均应保留原文件路径或数据包字段路径，并给出可执行修法。常见业务诊断包括 `BAD_PATH`、`NOT_FOUND`、`JSON_PARSE`、`CSV_PARSE`、`BAD_SCHEMA`、`BAD_PERIOD`、`BAD_VALUE`、`DUPLICATE_KEY`、`BAD_KIND`、`INCOMPLETE_TOTAL`、`TOTAL_MISMATCH`、`PARTIAL_PERIOD`、`BAD_KCHART`、`DATA_INTEGRITY`。
