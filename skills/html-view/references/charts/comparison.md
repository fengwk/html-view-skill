# 比较

比较类别、指标、前后值、目标或区间。角色以表格为数据形状；具体单图条件由 `validate()` 校验。

## 图型 `bar`

- 必需角色：`category`、`value`；可选：`series`、`id`。`value` 可为字段名或字段名数组。
- `stack` 可用 `absolute` / `percent`；`variant` 可用 `solid` / `rungs` / `pictorial` / `lollipop`。rungs、pictorial 要求 `unitMark: {value, label}`（pictorial 还要求受控 `icon` ID）；数值不得为负。`sort` 可按 category 或单个 value 字段排序。

## 图型 `column`

- 必需角色：`category`、`value`；可选：`series`、`id`。`value` 可为字段名或字段名数组。
- 可用 `stack`、`variant`、`unitMark`、`sort` 同 `bar`。超过 24 个类别时仅支持单系列 `solid` column，最多 60 类；bar 最多 24 类。

## 图型 `dumbbell`

- 必需角色：`category`、`before`、`after`；可选：`id`。最多 12 条记录。
- `variant` 可为 `solid` / `rungs`；rungs 不能为负。可用 `unitMark`；rungs 不允许 `unitMark.icon`。

## 图型 `slope`

- 必需角色：`category`、`before`、`after`；可选：`id`。最多 8 条记录。
- before/after 是同一尺度的数值。不要把 `dumbbell` 的 variant 或 unitMark 规则套用到 slope。

## 图型 `bullet`

- 必需角色：`category`、`actual`、`target`；可选：`id`。actual、target 非负；最多 12 条记录。

## 图型 `gauge`

- 必需角色：`value`；可选：`target`。必须声明递增有限数范围 `range: [min, max]`；恰好一条记录，value / target（若编码）都须落在范围内。
- `variant` 可为 `bar` / `arc` / `ticks`。

## 图型 `interval`

- 必需角色：`category`、`low`、`high`；可选：`value`、`id`。满足 `low ≤ value ≤ high`（有 value 时），最多 12 条记录。
- 支持引用数值角色的 `rule`、`band`、`note` 注释。

## 图型 `split-compare`

- 必需角色：`category`、`upper`、`lower`；无可选角色。upper / lower 为同轴比较值；时点最多 120。不要将其他图型的 `variant`、`unit` 或注释能力推定为可用。

## 可运行示例

```kchart
{
  "chart": "bar",
  "title": "各区域订单",
  "data": [
    { "region": "华东", "orders": 120 },
    { "region": "华南", "orders": 85 }
  ],
  "encode": { "category": "region", "value": "orders" },
  "unit": "单"
}
```
