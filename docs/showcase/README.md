# 样张与完整图库

简体中文 · [English](README.en.md)

README 中的图片都由当前实现生成。文档和报表的名称、内容和数据均为合成示例；界面稿没有连接业务服务。中英文样例使用同一组数字和同样的结构，只有文字不同。

<a id="examples"></a>

## 复现四种 HTML

```sh
node docs/showcase/render-examples.mjs
```

在仓库根目录运行，需要 Node.js 22+ 和本机 Chrome/Chromium（可用 `CHROME_PATH` 指定）。脚本在系统临时目录新建一个目录并打印路径，中英文分别输出到其中的 `zh-CN/` 和 `en/`。打开输出的 HTML 可以使用目录、视图和交互。截图在各语言的 `previews/` 中，脚本不会改动仓库文件；核对后复制到本目录的 `previews/zh-CN/` 和 `previews/en/`。

| 示例 | 源 | 截图 |
|---|---|---|
| 统一通知平台技术方案 | [中文](examples/zh-CN/notification-platform.md) · [English](examples/en/notification-platform.md) | 正文与目录：[中文](previews/zh-CN/doc-reading.png) · [English](previews/en/doc-reading.png)<br>分层架构：[中文](previews/zh-CN/doc-architecture.png) · [English](previews/en/doc-architecture.png) |
| 拾光咖啡月报 | 报表声明、叙述和 CSV：[中文](examples/zh-CN/coffee/) · [English](examples/en/coffee/) | 读数、视图与趋势：[中文](previews/zh-CN/data-periodic.png) · [English](previews/en/data-periodic.png) |
| 拾光咖啡 Dashboard | 从同一数据包选 4 项指标和 2 张图，设 `layout: dashboard`；衍生声明在输出目录的 `<语言>/dashboard-source/report.json` | 桌面首屏：[中文](previews/zh-CN/dashboard-hero.png) · [English](previews/en/dashboard-hero.png)<br>手机首屏：[中文](previews/zh-CN/dashboard-mobile.png) · [English](previews/en/dashboard-mobile.png) |
| 留存观察台 | [中文](../../skills/html-view/scripts/tests/fixtures/ui/retention-dashboard.html)（同时是 UI 回归测试的夹具） · [English](examples/en/retention-dashboard.html) | 桌面经营概览：[中文](previews/zh-CN/ui-desktop-overview.png) · [English](previews/en/ui-desktop-overview.png)<br>手机筛选结果：[中文](previews/zh-CN/ui-mobile-filtered.png) · [English](previews/en/ui-mobile-filtered.png) |

<a id="readme-gallery"></a>

## 复现首页图谱

```sh
node docs/showcase/render-readme-gallery.mjs
node docs/showcase/sync-readme.mjs <上一条命令打印的目录>
```

第一条命令用 Chrome 实测 SVG 字形，按最终显示宽度渲染中英文两套图谱，每个样例一张 SVG。README 用两列表格排列：普通图按 360px 占一格，放不下或竖向过高的图按 780px 占满一行，不缩小文字。同组内高度相近的图配成一行，同行两格等高，图注因此对齐；奇数组剩下的一张跨两列居中。主图谱只用 Claude，主题对照对每套内置主题复用同一份双系列数据。对照下方的完整样张由 CLI 用每套内置主题生成并审计同一份 one-pager，再由 Chrome 按 780px、2× 截成 `theme-<id>-page.png`；README 用折叠块展示，一次只展开一套。输出目录包含 `gallery/<语言>/` 图片、每种语言的 `gallery.<语言>.md` 和 `themes.<语言>.md` 片段，以及登记每张样例的 `manifest.json`。

第二条命令把图片替换到本目录的 `gallery/`，再把片段写进 `README.md` 和 `README.en.md` 中 `gallery`、`themes` 标记之间。任何一对标记缺失或重复时，它不改动任何文件。分组锚点使用与语言无关的 slug，例如 `trends`、`c4`、`variants-marks`；图片文件按样例 ID 命名，例如 `chart-line.svg`、`theme-claude.svg`、`theme-claude-page.png`，两份 README 的锚点和文件名因此一致。地图预览是 2× PNG，点击打开完整 SVG。

<a id="full-gallery"></a>

## 生成可筛选的 KChart 图谱

```sh
node skills/html-view/scripts/lab/showcase/generate.mjs
# 或选择一个新的本地目录
node skills/html-view/scripts/lab/showcase/generate.mjs --out ./kchart-showcase
```

打开输出目录中的 `index.html`。默认显示 Claude，可以按主题和图型筛选、搜索关键词并查看声明。每套内置主题均可预览，展册含 45 种基础图、38 项受控变体、27 种 Mermaid 子集图型、3 种原生结构图和 8 种脑图布局。图太宽时在图框内滚动，也可以直接打开原尺寸 SVG。生成器拒绝写入未知的非空目录和符号链接，不会覆盖仓库中的预览图。

[返回 README 图谱](../../README.md#gallery) · [主题对照](../../README.md#themes)
