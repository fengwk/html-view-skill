# html-view 与 KChart：实现约定

`htmlview` 生成离线单文件 HTML，维护阅读文档、数据报表和界面稿，也负责本地 HTML 的阅读、检查与导出。数据图和结构图由独立的 KChart 库输出。不安装第三方渲染运行时，不在仓库维护生成的浏览器包。

| 边界 | 实现 |
|---|---|
| 命令与输出 | `scripts/htmlview` 按 `doc`、`data`、`ui`、`viz` 及通用命令分发；结构化失败携带下一步建议 |
| 产物 | `scripts/src/artifacts/{doc,data,ui}` 各负责自己的骨架、特有审计和 diff 单元；不互相引用 |
| 共享外壳 | `scripts/src/shared/` 统一 HTML 内容标记、主题变量、图形校验及模块选择；`scripts/src/tools/` 依赖共用浏览器、文档解析和打印参数 |
| 渲染内核 | `kchart/src/core` 管主题、测字、几何、场景和 SVG；`chart` 与 `diagram` 分别管理数据图和结构图 |

## 内容和外壳

`htmlview:kind` 标记产物，`htmlview:shell` 记录资源指纹。唯一内容区是 `<!-- htmlview:content -->` 和 `<!-- /htmlview:content -->` 之间的 HTML。`style` 只重组外壳，Markdown 构建绑定源路径，数据报表绑定内容区哈希和随页证据。哈希用于发现改动，不是数字签名。报表只消费上游已经汇总的 CSV/JSON；比较遵循报告期间，未知不当作零，不访问数据库。

图形内容保存为 `pre[data-viz]`，类型为 `kchart`、`mermaid`、`layers`、`blocks` 或 `swimlane`。保存的是转义后的声明，不是静态 SVG。没有图时不嵌入图形代码；有图时地图随文档内联，模块按照声明计算依赖闭包。`viz render` 则输出独立 SVG 或带源码说明的静态浏览页，不是外壳产物。

## 布局与检查

`kchart/src/modules.json` 是模块依赖和图型登记的正本。DOM-free 解析与布局能在 Node 和浏览器使用；浏览器宿主用 Canvas 测字，宽度、主题或打印媒体变化后重排。结构图和数据图共享 SVG 序列化。可读字和完整几何优先；需要时放宽图内画布并允许图框内横向滚动，不将窄屏默默变成别的构图。

`audit` 检查输入及产物完整性，`check` 检查实际设备宽度、打印版心与浏览器错误。`shot` 和 `export` 等待当前媒体布局。打印时检查与导出共用版心测量；发现横向裁切或图高超过单页时拒绝写 PDF。宽图可用 `--paper a4-landscape`，高图可用 `--paper a3-portrait`；仍放不下时交付完整 SVG 或由作者重排。自动测试不替代样张目检。

## 使用与维护入口

- [技能入口与图型索引](../skills/html-view/SKILL.md)
- [CLI、自动测试与图库维护](../skills/html-view/scripts/README.md)
- [KChart API、程序包与许可](../skills/html-view/kchart/README.md)
- [图谱与示例](showcase/README.md) · [图型覆盖和反例](chart-coverage.md)
