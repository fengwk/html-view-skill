# 分布

展示观测、统计分位、密度或分箱。数组字段只允许图型明确指定的统计数据。

## 图型 `histogram`

- 必需角色：`lower`、`upper`、`count`；无可选角色。分箱须递增、连续精确接壤、count 非负，最多 40 箱。
- `variant` 可为 `solid` / `rungs`。rungs 还需 `unitMark: {value, label}`，不接受 icon，并要求等宽分箱。只支持引用 lower 或 upper 的 rule / band 注释；该图没有 `encode.id`，不能用 note。

## 图型 `boxplot`

- 必需角色：`category`、`low`、`q1`、`median`、`q3`、`high`；可选：`outliers`、`id`。统计值满足 `low ≤ q1 ≤ median ≤ q3 ≤ high`；outliers 可为数组，且须在须线范围之外。最多 12 组。

## 图型 `violin`

- 必需角色：`category`、`density`、`median`；可选：`id`。每组 density 为 2–120 个 `[数值, 非负密度]` 采样点，数值严格递增、积分大于零；median 落在采样范围内。无 variant 参数。

## 图型 `strip`

- 必需角色：`category`、`value`；可选：`id`。最多 1000 条记录。不要推定 scatter 的 size、series、label 或 variant 可用于 strip。

## 图型 `scatter`

- 必需角色：`x`、`y`；可选：`size`、`series`、`label`、`id`。`variant` 可为 `dots` / `plumb`；size 非负，最多 1000 条。支持 rule / band / note 注释。
- 两条轴各自标出字段名和单位。量纲不同时用 `fields.<字段>.label` 和 `fields.<字段>.unit` 写出读者能懂的轴名。
- `encode.label` 指向点名字段。不超过 40 条记录时，点名直接标在点旁，并避开其它点、垂线、注释和点名；放不下或容易认错的点名不画在图上；超过 40 条时不画静态点名。需在文档、报表或界面稿中查读这些点名时，加 `"interaction": ["inspect"]`；`viz render` 输出的 SVG 和图页均为静态，PDF 也不依赖悬停。静态交付必须逐点读出名称时，缩短点名、分图，或改用能逐行列名的 `bar`、`dumbbell`。

## 可运行示例

```kchart
{
  "chart": "scatter",
  "title": "投放与转化",
  "data": [
    { "cost": 12, "rate": 3.1 },
    { "cost": 18, "rate": 4.2 },
    { "cost": 25, "rate": 4.8 }
  ],
  "encode": { "x": "cost", "y": "rate" }
}
```
