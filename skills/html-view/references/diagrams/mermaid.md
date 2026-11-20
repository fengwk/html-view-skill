# Mermaid 通则

- **标题与配置**：用 YAML 前言 `title` 写图题；部分图型也接受正文标题。`accTitle: …`、`accDescr: …` 或多行 `accDescr { … }` 设置 SVG 无障碍文本。配置写在前言 `config` 下，也可用 `%%{init: …}%%` 或 `%%{initialize: …}%%` 覆盖。前言 YAML 格式错误会阻止渲染；无效指令和未采用的配置报 `IGNORED_CONFIG`。`theme: dark`、`look: handDrawn` 和 `layout: elk` 不会切换 KChart 的主题或绘图引擎（脑图布局见其专节）。默认设置及 `securityLevel`、`fontFamily` 等部分兼容键不改变外观，也不告警。
- **样式**：下文所说的「通用样式」指 `classDef`、`class`（类图用 `cssClass`）、`style`，以及在图型支持的目标上使用 `linkStyle` 或 `:::类名`。只按色相转换为主题状态色，不复刻原始 CSS；中性或无法识别的颜色、未采用的 CSS 属性报 `IGNORED_STYLE`。直接用 `new`、`info`、`ok`、`warn`、`danger`、`ext` 可指定状态，不依赖色相。无效的样式语句会报错；未定义的自定义类名则不产生样式。
- **链接**：支持通用链接的图型可用 `click ID href "https://example.com"`；接受安全的 HTTP(S)、`mailto:` 和相对地址。不安全的地址（如 `javascript:` 或 `//…`）和回调会被忽略，并报 `IGNORED_INTERACTION`。
- **标签与图标**：支持图标的标签可写 `fa:fa-…`，专用图标字段也可用 `tabler:…`、`simple-icons:…` 等名称。从内置图标集或宿主通过 `registerIcons` 注册的图标中解析；解析不到时忽略该图标并报 `IGNORED_ASSET`。支持规范化的标签会解码实体、将 `<br>` 转为换行；不加载远程图片，也不排版 KaTeX 公式（公式保留为文本）。
- **诊断与大图**：错误会阻止渲染，请按位置修正；警告不阻止渲染，`DIAGRAM_HINT` 表示可继续的输入问题。宽图保留可读字号，在图框内滚动；出现 `LARGE_DIAGRAM` 时可考虑拆为总图和分图。工作量超限或无法排出可读图形仍可能报错。

## info

`info` 只画出一行渲染器版本（如 `KChart v0.2.0`），用来确认文档由 KChart 渲染；它不承载内容，交付文档里不要用。可选的 `showInfo` 不改变输出，其他语句会报错。

```mermaid
info
```
