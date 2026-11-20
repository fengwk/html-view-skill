# 矩阵与多维

矩阵图用 row/column 定位单元格；多维图的维度通过字段名数组编码。重复单元格不合法。

## 图型 `heatmap`

- 必需角色：`row`、`column`、`value`；无可选角色。`variant` 可为 `cells` / `dots` / `arc`；每轴最多 24 类，单元格不可重复。
- `cells` 的图例用色块和数值标出本图色阶；正负混合时以色相区分方向、以颜色强度表示绝对值。空白不是零。
- `arc` 的值字段须用 `format: 'percent'` 或从 0 开始的数值 `domain`；值非负，比例值不超过 1。

## 图型 `bubble-matrix`

- 必需角色：`row`、`column`、`value`；无可选角色。每轴最多 24 类，单元格不可重复；气泡面积值非负。无 variant 参数。

## 图型 `calendar`

- 必需角色：`date`、`value`；无可选角色。必须声明 `period: 'YYYY'`，每个日期须属于该年份且不重复；最多 366 条。`variant` 可为 `cells` / `dots`。

## 图型 `radar`

- 必需角色：`label`、`dimensions`；可选：`id`。`dimensions` 为字段名数组，3–6 个维度；每个维度字段都必须显式写 `fields.<字段>.domain`，记录值非负。最多 24 个实体。无 variant 参数。

## 图型 `parallel`

- 必需角色：`label`、`dimensions`；可选：`id`、`series`。`dimensions` 为 3–6 个字段名数组，最多 24 个实体。与 radar 不同，不要求每个维度显式声明 domain。无 variant 参数。

## cynefin-beta

Cynefin 情境框架：`complex`、`complicated`、`clear`、`chaotic`、`confusion` 五个域下逐行写带引号的条目，`complex --> complicated: "说明"` 表示域之间的迁移；可用正文 `title`。域边界为固定几何，不随机抖动。也接受 `cynefin-beta:` 表头。前置 `config.cynefin.showDomainDescriptions: false` 可隐藏域的决策描述；默认显示。条目可使用实体、内置图标、主题状态色和安全链接；样式与链接可按域名或条目 ID（例如 `complex-0` 为该域首项）指定。中心区域保留所有条目，自环迁移省略并提示。

## 可运行示例

```kchart
{
  "chart": "heatmap",
  "title": "工单热度",
  "data": [
    { "day": "周一", "hour": "上午", "count": 12 },
    { "day": "周一", "hour": "下午", "count": 8 },
    { "day": "周二", "hour": "上午", "count": 15 }
  ],
  "encode": { "row": "day", "column": "hour", "value": "count" }
}
```
