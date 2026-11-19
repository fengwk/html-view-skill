# 主题文件

只想用现成配色时，运行 `htmlview style --list`，用 `--theme <id>` 选择。想给一份作品用自己的配色时，保存以下 JSON 为 `harbor.json`：

```json
{
  "id": "harbor",
  "extends": "paper",
  "name": "港湾",
  "en": "Harbor",
  "desc": "白底、深青色链接、灰色结构框。",
  "accent": "#12635e",
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

`doc new`、`doc build`、`data build`、`viz render`、`viz palette` 和 `style` 均支持该选项。`--theme` 与 `--theme-file` 二选一。界面稿仍用 `--brand` 和 `--scheme`。

HTML 内嵌解析后的主题，不保存主题文件路径。删除 JSON 或把 HTML 分享到另一台机器后，仍可审计、检查、截图、导出。`style file.html` 保留随页主题，也可以换成另一套；单图 HTML 会用随页声明重新渲染静态 SVG，需要 Chrome 或 Chromium。单独的 SVG 已含所选色值，换色时从声明重新运行 `viz render`。

## 可配置字段

| 字段 | 用途和取值 |
|---|---|
| `extends` | 继承一套内置主题的配色和样式，省略时用 `claude`。建议从目标明暗的主题开始。`scheme` 只能为 `light` 或 `dark`。 |
| `id`、`name`、`en`、`desc` | 外部文件可省略。`id` 如 `harbor`，以小写字母开头，可含数字和连字符，最长 48 字符；不能与内置 ID 重名，也不能用 `custom-` 或 `ui-` 开头。 |
| `bg`、`surface`、`surface2`、`line`、`line2` | 页面底、卡片底、次级表面、细线、较深边线。 |
| `fg1`–`fg4`、`accent` | 四级文字颜色；`accent` 用于链接和页面强调。 |
| `new`、`info`、`ok`、`warn`、`danger`、`ext` | 新增、信息、正常、提醒、风险、外部关系。 |
| `tones` | 按顺序填写六个数据系列色，整体替换继承的数组；不是页面强调色。 |
| `frameInk`、`tint` | `frameInk` 是部分普通结构框的基色，不代替状态色。`tint` 为 `{ "hue": 95, "chroma": 1.4 }` 这样的装饰浅底混色参数：`0 ≤ hue < 360`，`1 ≤ chroma ≤ 2`。用 `null` 清除继承值。 |
| `fontFamily` | 正文和图形共用的本地字体列表，例如 `"system-ui, sans-serif"`。 |
| `style` | `radius`、`smallRadius` 为 0–24px；`soft` 为 0–0.25 的淡底混色比例。`nodeBackground`、`blockBackground`、`codeBackground` 可选 `bg`、`surface`、`surface2`；`blockBackground` 还可选 `transparent`，`codeBackground` 还可选 `node`（跟随 `nodeBackground`）。`displayFont` 选本地字体列表或 `sans`，`displayWeight` 为 100–900 的整数。`numberFont` 选 `sans` 或 `mono`；`numberStyle` 选 `decimal` 或 `decimal-leading-zero`；`numberColor`、`listMarker` 选文字、状态、`accent` 或 `tone1`–`tone6` 颜色角色。 |
| `diagram` | 覆盖结构图的 `radius`、`smallRadius`、`soft`、`nodeBackground`，未覆盖的跟随 `style`；`null` 清除继承的结构图覆盖。 |

颜色使用 `#RRGGBB`。主题文件只接受 JSON 数据，不接受 CSS、脚本、字体 URL 或外部资源。程序检查颜色角色、文字对比度、序列区分度和前 3 色的红绿弱视模拟。实际页面还需 `check` 和目检；同一个颜色混到浅底上以后，对比度可能改变。深色主题打印换用 Paper 色板，亮色主题的页面底换为白色。

## 新增内置主题

先用 `--theme-file` 在真实文档、数据图和结构图上预览，同一份 JSON 审查通过后放进 [`kchart/assets/themes/`](../../kchart/assets/themes/)。文件名必须是 `<id>.json`，填写 `id`、`name`、`en`、`desc`；可用非负整数 `order` 控制展示位置，省略则排在有 `order` 的主题之后。CLI、KChart、通用测试和图库生成器会自动发现它。不改 CSS、模块清单、测试主题列表或图型代码。发布仓库时重新生成 README 的主题对照图，不手改图库表格。
