# 网络与流向

这些图使用结构化节点、边或阶段路径，不使用表格型 `encode`。

## 图型 `network`

- `data` 必须包含 `nodes`、`edges` 数组。节点可有 `id`、`label`、`group`、有限 `value`、非负整数 `stage`、`icon`、`note`；节点 id 必须唯一非空。
- 边用 `source`、`target` 引用已有节点，可有唯一 `id`、`label`、有限 `value`。平行边必须各自提供唯一 id。
- `layout` 可为 `circular` / `force`；`directed` 为布尔值；`variant` 可为 `lines` / `membrane`。`interaction` 支持 focus、pan-zoom；force 布局下 drag 必须与 pan-zoom 同时声明。

## 图型 `sankey`

- `data` 使用 `nodes`、`edges`；边必需 `source`、`target`、正数 `value`，不允许自环；无环且中间节点流入、流出守恒。节点不能声明 value。
- 可选 `layout`：`right` / `down`。如果一个节点声明 `stage`，所有节点都要声明；每条边必须指向更高 stage。可用 focus、pan-zoom 交互。无 variant 参数。
- 同一阶段内的节点顺序由布局按减少流带交叉来定，不保证按 `nodes` 书写顺序排列；跨过阶段的流带走阶段间的空隙，不压住中间节点。每个节点名下标出节点总量；流带读数标在两端附近，太细放不下 12px 文字的流带不标读数；需要逐条核对时，在 HTML 中加 `"interaction": ["inspect"]`，静态交付另附精确值。节点总量不一定能反推出每条流带的值。节点总量和读数都使用顶层 `unit`。

## 图型 `threads`

- `data` 必须有 `stages`、`nodes`、`paths` 数组。stage 为 `{id,label}`；节点为 `{id,label,stage}` 并引用已有 stage；路径为 `{id,nodes:[节点ID,…]}`，至少两个节点且严格按 stage 前进，可选正数 `value`、文本 `note`。
- 可选 `layout`：`right` / `down`；可用 focus、pan-zoom 交互。无 variant 参数。

## 可运行示例

```kchart
{
  "chart": "sankey",
  "title": "订单流向",
  "data": {
    "nodes": [
      { "id": "web", "label": "网站" },
      { "id": "app", "label": "应用" },
      { "id": "pay", "label": "支付" }
    ],
    "edges": [
      { "source": "web", "target": "pay", "value": 12 },
      { "source": "app", "target": "pay", "value": 8 }
    ]
  }
}
```
