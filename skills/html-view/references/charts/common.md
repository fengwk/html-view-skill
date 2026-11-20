# KChart 声明通则

开始写数据图时先读本页，再看对应图族。`htmlview viz schema <chart>` 的 `contract` 列出必需及可选的 `encode` 角色（`required`、`optional`）和图型专属选项（`special`）；`schema` 给出字段格式。规模限制见对应图族，不把别的图型字段套过来。

- `chart` 是图型；`data` 是源记录或该图型声明的数据形状；`encode` 把语义角色映射到源字段。多数图是对象数组；树用嵌套节点，关系图用节点与边或路径，地理图用受控地图资源。保留原字段单位、缺值和量级。
- `title` 写这张图要说明的问题或结论；需要时加 `subtitle`（口径）、`source`（可核对来源）、`note`（限制）。同一图不在声明外重复标题。
- `unit` 是单一通用单位。多量纲用 `fields.<字段>.unit`，必要时写 `label`、`format`、`decimals`；比例格式 `percent` 用 0–1。多条序列、目标和比较量必须按图族语义映射，不能让单位只出现在文件名。
- `null` 是未知，不是零。时间序列中的未知档断线；有效的单个观测仍显示。禁止把缺失替成 0 或补造趋势。
- 只用登记的 `variant`、`layout`、`sort` 与下面的强调、注释字段；不要提供坐标、颜色、任意样式或第三方选项。默认无交互无动画；仅在需要查读时声明图型支持的 `interaction`。
- `emphasis` 让读者该先看的记录或系列保持醒目，其余变淡；颜色不代表系列时（单系列柱、漏斗），选中项还会改用强调色。三种写法任选其一：`{"rows":["记录 id"]}`（须映射 `encode.id`）、`{"fields":["字段"]}`（`encode.value` 为数组时）、`{"series":["系列名"]}`。只有 `line`、`area`、`bar`、`column`、`share`、`funnel` 绘制强调，其中部分变体只支持 `rows`；其他组合 validate 直接报错。
- `annotations` 用于 `line`、`area`、`bar`、`column`、`combo`、`scatter`、`interval`、`histogram`、`candlestick`：参考线 `{"kind":"rule","field":"数值字段","value":600,"label":"目标"}`，区间 `{"kind":"band","field":"数值字段","from":80,"to":95,"label":"正常范围"}`，点注 `{"kind":"note","record":"记录 id","field":"数值字段","text":"说明"}`（须映射 `encode.id`）。目标和区间要有来源，写进 `subtitle` 或 `note`。
- 图表声明没有根级 `id`。文档的图形锚点写在 `<pre data-viz>` 元素上；数据报表的图块编号写在报表图块上。标识数据行才用 `encode.id`。
- 报表中的图由数据包绑定；完整 `data` 用于独立图、文档和界面稿，报表图块只写字段映射。

```kchart
{
  "chart": "bar",
  "title": "样例：甲组记录最多",
  "unit": "件",
  "data": [{"team":"甲组","total":18},{"team":"乙组","total":12}],
  "encode": {"category":"team","value":"total"},
  "source": "虚构演示"
}
```

首次出图检查轴和标签是否完整、比较对象是否明确、单位是否可见。过宽图独立打开 SVG 检查，避免通过缩字隐藏问题。
