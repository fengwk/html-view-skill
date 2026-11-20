# 构成

表达份额、阶段转化、增减或层级占比。大多数是表格数据；treemap、sunburst 使用嵌套树数据，不提供 `encode`。

## 图型 `share`

- 必需角色：`category`、`value`；可选：`series`。`variant` 可为 `solid` / `ticks`；可用 `sort`。数值非负，最多 6 条。

## 图型 `pie`

- 必需角色：`category`、`value`；可选：`id`。可用 `sort`；数值非负，最多 6 条。无 variant 参数。

## 图型 `donut`

- 必需角色：`category`、`value`；可选：`id`。`variant` 可为 `solid` / `ticks`；数值非负，最多 6 条。

## 图型 `radial-share`

- 必需角色：`category`、`value`、`intensity`；可选：`id`。份额和强度各至少有一个正数且均非负；两字段都必须通过 `fields` 声明 `unit` 或 `format: 'percent'`，不可用根级 `unit`；最多 6 条。

## 图型 `rose`

- 必需角色：`category`、`value`；可选：`id`。可用 `sort`；数值非负，最多 6 条。无 variant 参数。

## 图型 `funnel`

- 必需角色：`category`、`value`；可选：`id`。`variant` 可为 `bars` / `hourglass`；数值非负递减，首步必须大于 0，最多 6 条。

## 图型 `waterfall`

- 必需角色：`category`、`delta`；可选：`id`。必须另声明有限数 `start`；`variant` 可为 `solid` / `rungs`。rungs 要求 `unitMark: {value, label}`；可选的 unitMark 不接受 icon。最多 16 条。

## 图型 `waffle`

- 必需角色：`category`、`value`；无可选角色。`variant` 可为 `dots` / `field`；数值非负，最多 6 条。

## 图型 `tally`

- 必需角色：`category`、`value`；无可选角色。必须在 `fields.<value>` 写 `format: 'percent'`；每个值须在 0 到 1 之间，最多 6 条。可用 `sort`。

## 图型 `treemap`

- `data` 是树对象，不用 `encode`：节点必填非空 `label`，可有 `children`；每个叶节点必须给非负有限 `value`。最多 80 个节点、5 层。节点可用 `id`、`note`；父节点若声明 value，必须等于子树合计。

## 图型 `sunburst`

- `data` 与 treemap 相同：嵌套树、叶节点非负有限 `value`、最多 80 节点与 5 层。不要为树形数据添加表格 `encode`。

## venn-beta

Mermaid 维恩图：`set 名称` 或 `set id["标签"]` 声明集合，`union A,B["标签"]` 标注交集，`text` 在区域内添加文字；可用正文 `title`。

## 可运行示例

```kchart
{
  "chart": "share",
  "title": "访问来源",
  "data": [
    { "source": "搜索", "visits": 52 },
    { "source": "推荐", "visits": 31 },
    { "source": "其他", "visits": 17 }
  ],
  "encode": { "category": "source", "value": "visits" },
  "unit": "次"
}
```
