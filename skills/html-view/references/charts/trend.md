# 趋势

按时间或阶段观察变化、对照、区间、走势排名与启动进度。

## 图型 `line`

- 必需角色：`category`、`value`；可选：`series`、`id`、`lower`、`upper`。`value` 可为字段名或字段名数组，最多 6 个度量系列；时点最多 120。
- `variant` 可为 `counter` / `barcode`。区间 `lower`、`upper` 必须同时声明，只能用于单度量、非堆叠、无 series 的线图，且每行满足 `lower ≤ value ≤ upper`；有缺失时三值须同时为 null。支持 rule / band / note 注释。

## 图型 `area`

- 必需角色：`category`、`value`；可选：`series`、`id`、`lower`、`upper`。`value` 可为字段名或字段名数组；时点最多 120。
- `stack` 可为 `absolute` / `percent`。区间带约束同 line（不可堆叠）；支持 rule / band / note 注释。无变体参数。

## 图型 `sparkline`

- 必需角色：`category`、`value`；无可选角色。时点最多 120。不要推定有 line 的变体或注释字段。

## 图型 `small-multiples`

- 必需角色：`category`；可选：`value`、`panel`。只接受两种编码：宽表 `value: ['字段1','字段2']`，或长表 `value: '字段'` 加 `panel: '面板字段'`。最多 6 面板，每面板最多 120 时点。

## 图型 `stream`

- 必需角色：`category`、`value`；可选：`series`。`value` 可为字段名或字段名数组；时点最多 120。无变体参数。

## 图型 `combo`

- 必需角色：`category`；可选角色：`id`，并且必须另有非空 `layers`。每层形如 `{mark:'line'|'area'|'column', field:'字段', axis:'left'|'right'}`；最多 6 层，至少一层用 left，同一轴字段单位与格式一致。时点最多 120；支持 rule / band / note 注释。

## 图型 `bump`

- 必需角色：`category`、`series`、`rank`；无可选角色。rank 为正整数或 null；最多 12 个实体、24 个时点。无变体参数。

## 图型 `candlestick`

- 必需角色：`category`、`open`、`close`、`low`、`high`；可选：`id`。每条满足 `low ≤ open/close ≤ high`，最多 120 条。支持 rule / band / note 注释。

## 图型 `launch-fan`

- 必需角色：`label`、`start`、`value`；可选：`id`。`fields.<start>.type` 必须显式为 `number` 或日期类型（`date`、`month`、`datetime`）；当前量 value 非负，最多 24 条。

## 可运行示例

```kchart
{
  "chart": "line",
  "title": "月销售额",
  "data": [
    { "month": "1月", "sales": 12 },
    { "month": "2月", "sales": 18 },
    { "month": "3月", "sales": 15 }
  ],
  "encode": { "category": "month", "value": "sales" },
  "unit": "万元"
}
```
