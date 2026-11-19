# 手写 SVG

内置图族画不了时才手写 SVG，例如嵌套超过上限、关系太多或要连到框内某一项，令牌桶、缓存命中路径这类机制示意，机柜、楼层这类物理布局。数据图仍用 KChart。先试着拆成总图和分图：总图用内置图，只把放不下的分图手画。

## 取材料

- `htmlview viz palette --theme <主题>`：`structure` 列出结构图配色变量，`tokens` 给出字号、线宽、圆角、箭头和间距，`figureTemplate` 是能直接放进文档并自动编号的图卡，`svgSkeleton` 是其中的 SVG。
- `htmlview viz measure '订单服务' 'payment-callback' --size 13`：按内置图的同一套估算给出文字宽度；加 `--max-width 160` 给出换行结果。框宽取最宽一行加左右各 12px，再按 4px 取整。

## 图卡

从 `figureTemplate` 起稿，改 `id`、图题、`aria-label` 和 SVG 内容：

```html
<figure class="viz viz-figure" id="fig-topology">
  <figcaption class="fig-title">订单服务的双地域部署</figcaption>
  <div class="fig-body viz-body" tabindex="0" role="region" aria-label="双地域部署拓扑">
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420" role="img" aria-label="双地域部署拓扑" font-family="var(--viz-font)">…</svg>
  </div>
</figure>
```

- 图号由页面生成，图题不写「图 N」。正文用 `<a class="xref" href="#fig-topology"></a>` 引用。
- `width`、`height` 与 `viewBox` 同尺寸，按 1:1 绘制。宽图在 `.viz-body` 里横向滚动，不用 CSS 缩小。
- Markdown 源里可以直接写这段 HTML。

## 写法限制

- 样式只写成 SVG 属性，不用 `<style>`、`class` 或 `style=`。
- 颜色、圆角和字体只用 `var(--…)`，变量名以 `viz palette` 的输出为准，不写固定色值。变量拼错或不存在时，`audit` 报 `UNKNOWN_TOKEN`。
- `<marker>` 等元素的 `id` 在整篇文档内唯一，用图的 id 作前缀。
- 带文字的部分不用 `<use>` 复用，因为 `check` 量不到 `<use>` 里的文字。
- 不引用外部图片、字体或脚本。

## 配色

| 变量 | 用途 |
|---|---|
| `--viz-frame-1`…`--viz-frame-6`，`--viz-frame-1-fill`…`--viz-frame-6-fill` | 分组框的描边和底色。同级分组依次用 1、2、3…，嵌套层沿用外层编号 |
| `--viz-node`、`--viz-node-line` | 节点底色和描边 |
| `--viz-edge` | 普通连线，1.25px |
| `--viz-edge-strong` | 主连线和箭头，2px |
| `--viz-em-fill`、`--viz-em-line` | 要读者先看的一两个节点，浅底 |
| `--viz-em`、`--viz-on-em` | 实底强调和其上的文字，每张图最多一处 |
| `--viz-chip` | 连线标签的底框 |
| `--viz-fg`、`--viz-muted` | 主文字、次要文字 |
| `--ok`、`--warn`、`--danger`、`--info`、`--new`、`--ext` | 状态的小标记或描边，旁边写出状态文字 |
| `--viz-1`…`--viz-6` | 只在颜色代表数据类别且配有图例时使用 |

普通分组用分组框配色，不用状态色或序列色装饰。这样换主题时，手画图和内置图一起变色。例如 Cloud Music 的分组框统一为灰色，手画图也不会出现像告警的红框。

## 字号、线宽与间距

| 项 | 取值 |
|---|---|
| 字号 | 分组标题 14px、字重 600；节点文字 13px、400；连线标签 12px、400。不小于 12px |
| 行高 | 14px 文字 18px，13px 文字 20px，12px 文字 16px |
| 线宽 | 分组框和节点 1px，普通连线 1.25px，主连线 2px；异步或外部用虚线 `5 4` |
| 圆角 | 分组框 `var(--viz-radius)`，节点 `var(--viz-radius-sm)`，标签底框 4 |
| 箭头 | `viewBox="0 0 10 10"`、`refX="8"`、`refY="5"`、8×8、`orient="auto-start-reverse"`；路径 `M1 1 L9 5 L1 9 Z`，填 `var(--viz-edge-strong)` |
| 间距 | 4px 网格。单行节点高 36，每多一行加 20；节点间距 8；分组内边距 12，标题带高 36；同级分组间距 16；带标签的连线两端的框至少相隔 56 |

## 排版

- 居中文字写 `text-anchor="middle"` 和 `dominant-baseline="central"`，y 取框的垂直中心。
- 同一行的节点等宽、等高并对齐；分组按网格排列，避免零碎的错位。
- 连线用水平和竖直线段，从框边中点进出，只在终点画箭头，不穿过文字和无关的框。终点停在框边上，连线写在它连接的框之后，箭头才不会被框盖住。
- 连线标签放在线旁空白处，或放在 `--viz-chip` 底框上，并写在连线之后。
- 一张图控制在约 20 个节点内，再多就拆图。颜色代表类别时加图例。

## 检查

1. 运行 `htmlview audit`。
2. 运行 `htmlview check`。手画图会另外检查文字重叠（`SVG_TEXT_OVERLAP`）、文字超出所在图形或画布（`SVG_TEXT_OVERFLOW`）、连线穿过文字（`SVG_LINE_ON_TEXT`）、箭头引用不存在的 marker（`SVG_MARKER_MISSING`）和箭头被后画的图形盖住（`SVG_ARROW_HIDDEN`）。宽图报 `PRINT_CLIP` 时按[显示与导出](check-export.md)换纸型或拆图。
3. 复制一份，用 `htmlview style <副本> --theme obsidian` 换成深色主题。两份各截一张图，和同一文档里的内置图对照：字号、线宽、圆角和底色应一致。
4. 交付 PDF 时导出并查看实际 PDF。
