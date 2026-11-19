# 样张与完整图库

README 中的图片均由当前实现生成。文档和报表的名称、内容和数据均为合成示例；界面稿没有连接业务服务。

## 复现三种 HTML

```sh
node docs/showcase/render-examples.mjs
```

在仓库根目录运行，需要 Node.js 22+ 和本机 Chrome/Chromium（可用 `CHROME_PATH` 指定）。脚本会在系统临时目录创建独占目录，打印其路径；打开输出 HTML 可使用目录、视图和交互。截图保存在该目录的 `previews/`，不会覆盖仓库文件。

| 示例 | 源 | 展示图 |
|---|---|---|
| 统一通知平台 | [Markdown](examples/notification-platform.md) | [正文与目录](previews/doc-reading.png) · [分层架构](previews/doc-architecture.png) |
| 拾光咖啡月报 | [报表声明](examples/coffee/report.json) · [叙述](examples/coffee/narrative.md) · [CSV](examples/coffee/data/) | [读数、视图与趋势](previews/data-periodic.png) |
| 留存观察台 | [原型内容](../../skills/html-view/scripts/tests/fixtures/ui/retention-dashboard.html) | [桌面经营概览](previews/ui-desktop-overview.png) · [手机筛选结果](previews/ui-mobile-filtered.png) |

## 生成可筛选的 KChart 图谱

```sh
node skills/html-view/scripts/lab/showcase/generate.mjs
# 或选择一个新的本地目录
node skills/html-view/scripts/lab/showcase/generate.mjs --out ./kchart-showcase
```

打开输出目录中的 `index.html`。默认显示 Claude，可筛选六个主题和图型，搜索关键词并查看声明。全展册共 774 张离线 SVG，含 45 种基础图、38 项受控变体、27 种 Mermaid 子集图型、3 种原生结构图与八种脑图布局。图太宽时在图框内滚动，也可直接打开原尺寸 SVG。图库生成器拒绝未知非空目录和符号链接，不覆盖仓库预览图。

- [六主题对照](previews/theme-matrix.svg) · [比较与构成](previews/comparison-composition.svg) · [趋势与时间](previews/trend-time.svg)
- [统计与分布](previews/statistical-distribution.svg) · [关系与矩阵](previews/relationships-matrix.svg) · [结构图](previews/diagram-matrix.svg)
- [脑图布局：一](previews/mindmap-layouts-a.svg) · [脑图布局：二](previews/mindmap-layouts-b.svg)
