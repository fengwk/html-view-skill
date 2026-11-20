# 地图

地图数据统一使用 `data: {map, rows}`。`map` 可为 `{asset:'world'}`、`{asset:'us-states'}`，或 `{geojson: FeatureCollection, idProperty:'字段'}`；外部 GeoJSON 仅支持带唯一字符串 join key 的 Polygon / MultiPolygon Feature。地图数据不使用表格数组形状。

## 图型 `choropleth`

- 必需角色：`region`、`value`；无可选角色。每个 `rows` 记录必须包含编码字段；region 必须匹配地图 feature 的 `properties[idProperty]`。不要假设按地区名称自动匹配。

## 图型 `geo-scatter`

- 必需角色：`longitude`、`latitude`；可选：`value`、`label`、`id`。经度范围 -180 至 180，纬度 -90 至 90；每行都要有编码字段。

内置地图使用本地边界资产，[地区键说明](../../vendor/kchart/assets/maps/REGIONS.md)列出特殊地区键及美国州界覆盖范围。外部 GeoJSON 由调用方提供准确地区键并标注来源。

## 可运行示例

```kchart
{
  "chart": "geo-scatter",
  "title": "门店位置",
  "data": {
    "map": { "asset": "world" },
    "rows": [
      { "longitude": 121.47, "latitude": 31.23, "label": "上海" },
      { "longitude": 116.4, "latitude": 39.9, "label": "北京" }
    ]
  },
  "encode": { "longitude": "longitude", "latitude": "latitude", "label": "label" }
}
```
