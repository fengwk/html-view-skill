# 主题文件

只想用现成配色时，运行 `htmlview style --list`，用 `--theme <id>` 选择。想给一份作品用自己的配色时，保存以下 JSON 为 `harbor.json`：

```json
{
  "id": "harbor",
  "extends": "paper",
  "name": "港湾",
  "en": "Harbor",
  "desc": "白底、深青链接与编号，数据系列以海青和黄铜为主，结构框用灰色。",
  "accent": "#12635e",
  "tones": ["#23272c", "#13807a", "#8c6d46", "#0e4744", "#7c8088", "#5d7fa6"],
  "frameInk": "#677471",
  "style": { "radius": 12, "smallRadius": 6, "numberColor": "accent" },
  "diagram": { "radius": 4, "smallRadius": 4 }
}
```

```sh
htmlview viz palette --theme-file harbor.json
htmlview doc build source.md --out reading.html --theme-file harbor.json
htmlview style reading.html --theme-file harbor.json
htmlview audit reading.html
```

示例把页面强调色 `accent` 和第二数据系列 `tones[1]` 设为同一色系，链接、编号和图中的重点系列才协调。只改 `accent` 时，系列色仍是继承主题的色相，同一页会出现两种强调色。

`doc new`、`doc build`、`data build`、`viz render`、`viz palette` 和 `style` 均支持该选项。`viz palette` 输出的 `chartAccent` 是图内强调色，等于 `tones[1]`，不是页面的 `accent`。`--theme` 与 `--theme-file` 二选一。界面稿仍用 `--brand` 和 `--scheme`。

HTML 内嵌解析后的主题，不保存主题文件路径。删除 JSON 或把 HTML 分享到另一台机器后，仍可审计、检查、截图、导出。`style file.html` 原位更新 htmlview 产物，不接收普通 HTML。它默认保留随页主题，也可以换成另一套；单图 HTML 会用随页声明重新渲染静态 SVG，需要 Chrome 或 Chromium。单独的 SVG 已含所选色值，换色时从声明重新运行 `viz render`。

## 可配置字段

| 字段 | 用途和取值 |
|---|---|
| `extends` | 继承一套内置主题的配色和样式，省略时用 `claude`。建议从目标明暗的主题开始。`scheme` 只能为 `light` 或 `dark`。 |
| `id`、`name`、`en`、`desc` | 外部文件可省略。`id` 如 `harbor`，以小写字母开头，可含数字和连字符，最长 48 字符；不能与内置 ID 重名，也不能用 `custom-` 或 `ui-` 开头。 |
| `bg`、`surface`、`surface2`、`line`、`line2` | 页面底、卡片底、次级表面、细线、较深边线。 |
| `fg1`–`fg4`、`accent` | 四级文字颜色；`accent` 用于链接和页面强调。 |
| `new`、`info`、`ok`、`warn`、`danger`、`ext` | 新增、信息、正常、提醒、风险、外部关系。 |
| `tones` | 按顺序填写六个数据系列色，整体替换继承的数组。`tones[1]` 也是单系列图里被强调的柱、点和参考线的颜色，应与 `accent` 同色系。 |
| `frameInk`、`tint` | `frameInk` 是分层图、能力块、泳道、时序分组和脑图分支这些普通框的基色，不影响数据系列和状态色。未设置时，这些框从 `tones` 和 `accent` 取色，分层、能力块和泳道按顺序轮换系列色。轮到的颜色容易被读成状态时（亮底上的鲜红），设一个中性的 `frameInk`；轮到的颜色就是主题主色时（终端的绿），保留原色即可。`tint` 为 `{ "hue": 95, "chroma": 1.4 }` 这样的装饰浅底混色参数：`0 ≤ hue < 360`，`1 ≤ chroma ≤ 2`。用 `null` 清除继承值。 |
| `fontFamily` | 正文和图形共用的本地字体列表，例如 `"system-ui, sans-serif"`。 |
| `style` | `radius`、`smallRadius` 为 0–24px；`soft` 为 0–0.25 的淡底混色比例。`nodeBackground`、`blockBackground`、`codeBackground` 可选 `bg`、`surface`、`surface2`；`blockBackground` 还可选 `transparent`，`codeBackground` 还可选 `node`（跟随 `nodeBackground`）。`displayFont` 选本地字体列表或 `sans`，`displayWeight` 为 100–900 的整数。`numberFont` 选 `sans` 或 `mono`；`numberStyle` 选 `decimal` 或 `decimal-leading-zero`；`numberColor`、`listMarker` 选文字、状态、`accent` 或 `tone1`–`tone6` 颜色角色。 |
| `diagram` | 覆盖结构图的 `radius`、`smallRadius`、`soft`、`nodeBackground`，未覆盖的跟随 `style`；`null` 清除继承的结构图覆盖。 |

颜色使用 `#RRGGBB`。主题文件只接受 JSON 数据，不接受 CSS、脚本、字体 URL 或外部资源。程序检查颜色角色、文字对比度、序列区分度和前 3 色的红绿弱视模拟。实际页面还需 `check` 和目检；同一个颜色混到浅底上以后，对比度可能改变。深色主题打印换用 Paper 色板，亮色主题的页面底换为白色。
