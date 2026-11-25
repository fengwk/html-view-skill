# html-view 与 KChart：实现约定

简体中文 · [English](architecture.en.md)

`htmlview` 生成离线单文件 HTML，维护阅读文档、数据报表和界面稿，也负责本地 HTML 的阅读、检查与导出。数据图和结构图由独立的 KChart 库输出：库源码在 `packages/kchart`，构建物原样镜像到技能内的 `skills/html-view/vendor/kchart`。不安装第三方渲染运行时，不手工改构建物。

| 边界 | 实现 |
|---|---|
| 命令与输出 | `scripts/htmlview` 按 `doc`、`data`、`ui`、`viz` 及通用命令分发；结构化失败携带下一步建议 |
| 产物 | `scripts/src/artifacts/{doc,data,ui,viz}` 各负责自己的骨架、特有审计和 diff 单元；不互相引用 |
| 共享外壳 | `scripts/src/shared/` 统一 HTML 内容标记、主题变量、图形校验及模块选择；`scripts/src/tools/` 依赖共用浏览器、文档解析和打印参数 |
| 渲染内核 | `packages/kchart/src/core` 管主题、测字、几何、场景和 SVG；`chart` 与 `diagram` 分别管理数据图和结构图 |
| 构建与镜像 | 在 `packages/kchart` 用 `npm run build` 产出 `dist/`（ESM 入口、浏览器单元与资源），再用 `npm run vendor` 镜像到 `skills/html-view/vendor/kchart`。html-view 的渲染走镜像的 `esm/node.js`，已有辅助功能取自镜像的 `esm/core/` 模块；运行时不引用库源码 |

仓库分三层，职责不交叉：

- `packages/kchart/`：KChart 库本体，含 `src/`、`assets/`（主题、图标、地图）、`tests/`、`docs/`（声明参考）、`README.md` 和 `NOTICE.md`。在这里开发、测试和发布。
- `skills/html-view/`：技能本身，包含 CLI、参考文档和 `vendor/kchart/`。技能仍是零运行时依赖，按 git clone 安装即可用。
- `skills/html-view/vendor/kchart/`：由 `npm run vendor` 生成的构建镜像。它随仓库提交，不手改；`npm run vendor -- --check` 或 CI 在不一致时报错。

升级 KChart 时在 `packages/kchart` 改源码，构建后重新镜像；html-view 的代码、测试、`docs/showcase` 与文档都跟着镜像走，不改调用方式。

## 内容和外壳

`htmlview:kind` 标记产物，`htmlview:shell` 记录资源指纹。唯一内容区是 `<!-- htmlview:content -->` 和 `<!-- /htmlview:content -->` 之间的 HTML。文档和报表的 `style` 只重组外壳。Markdown 构建绑定源路径，数据报表绑定内容区哈希和随页证据。哈希用于发现改动，不是数字签名。报表只消费上游已经汇总的 CSV/JSON；比较遵循报告期间，未知不当作零，不访问数据库。

图形内容保存为 `pre[data-viz]`，类型为 `kchart`、`mermaid`、`layers`、`blocks` 或 `swimlane`。保存的是转义后的声明，不是静态 SVG。没有图时不嵌入图形代码；有图时地图随文档内联，模块按照声明计算依赖闭包。`viz render` 则输出独立 SVG，或带内嵌声明的静态图页。图页只运行复制源码按钮的脚本；`style` 用声明重新渲染。

## 布局与检查

`packages/kchart/src/families.json` 登记图型，源码的 `import` 决定模块依赖；`npm run build` 据此产出 ESM 入口、逐模块的浏览器单元和 `units.json` 清单，`npm run vendor` 把 `dist/` 原样镜像到技能。DOM-free 解析与布局能在 Node 和浏览器使用；图卡挂载由技能自己的 `assets/page/viz.js` 负责：它按外壳配置用 Canvas 测字、生成图题、来源和复制按钮，并在宽度、主题或打印媒体变化后重排，KChart 本身只负责 `render()`/`diagram()` 的渲染结果。结构图和数据图共享 SVG 序列化。可读字和完整几何优先；需要时放宽图内画布并允许图框内横向滚动，不将窄屏默默变成别的构图。

`audit` 检查输入及产物完整性，`check` 检查实际设备宽度、打印版心与浏览器错误。`shot` 和 `export` 等待当前媒体布局。打印时检查与导出共用版心测量；发现横向裁切或图高超过单页时拒绝写 PDF。宽图可用 `--paper a4-landscape`，高图可用 `--paper a3-portrait`；仍放不下时交付完整 SVG 或由作者重排。自动测试不替代样张目检。

<a id="themes"></a>

## 主题与换色

| 要改什么 | 做法 |
|---|---|
| 改一份文档或报表的显示主题 | `htmlview style report.html --theme obsidian`。用 `htmlview style --list` 查看内置主题。原数据和内容不变。 |
| 调整界面稿的品牌色或明暗 | `htmlview style prototype.html --brand '#a84624' --scheme light`。界面稿从品牌色派生主题，不用 `--theme`。 |
| 在 KChart 程序接口中用自己的配色 | 传 `theme` 对象给 `render()` 或 `diagram()`。可展开一套内置主题，再覆盖必要的字段；不必改库源码或注册 CLI 主题。 |
| 应用自定义主题 | `htmlview style report.html --theme-file harbor.json`。可继承内置主题，只写要改的角色。HTML 保存解析后的主题，分享时不需要原 JSON。见[完整字段和示例](../skills/html-view/references/guides/themes.md)。 |
| 添加内置主题 | 把审核通过的 `<id>.json` 放入 [`packages/kchart/assets/themes/`](../packages/kchart/assets/themes/)，然后在 `packages/kchart` 运行 `npm ci`、`npm run build` 和 `npm run vendor`，把新主题带进技能的 `vendor/kchart`。CLI、KChart、通用测试和图库生成器自动发现它，不需要再登记 CSS 或图型。发布时用生成器刷新 README 对照图。 |

主题 JSON 是配色和样式的唯一配置来源；HTML 外壳从它生成 CSS 变量，KChart 直接使用解析出的角色。已有主题只换颜色时，不需要改 CSS 文件或图型；改第 2 条数据序列用 `tones[1]`，改外壳强调色用 `accent`，两者是不同角色，但应取同一色系，否则链接和图中重点系列会是两种强调色。不要只给一组任意 HEX：调色盘要覆盖背景、文字、描边、状态和六个序列色，并通过对比度与色觉区分校验。新增主题后需验证窄屏、真实图表和打印；深色主题打印仍采用 Paper 色板。

普通结构框可以独立取色。主题有可选的 `frameInk` 时，由它派生分层框、泳道、时序分组和脑图分支的淡底、描边；脑图的根节点改用正文墨色。未设置时，这些框从数据序列色和 `accent` 取色。`blocks` 和 Mermaid `block` 的分组是中性虚线框；设了 `frameInk` 时，`blocks` 的 `accent` 卡片和主流程线改用正文墨色。当轮到的颜色容易被读成状态时（云音亮底上的鲜红），把 `frameInk` 设为中性灰；当轮到的颜色就是主题主色时（终端的绿），保留原色即可。数据序列、编号、链接和显式状态色不变。橙、陶土变浅时容易发粉，主题可用 `tint: { hue, chroma }` 调整装饰色的 OKLCH 混色；Claude 用 `{ hue: 95, chroma: 1.4 }`，95° 是它的象牙纸色相。

这些结构配色也导出为 CSS 变量，如 `--viz-frame-1`、`--viz-node`、`--viz-edge`、`--viz-em`，`htmlview viz palette` 列出全部变量。内置图族放不下、只能手写 SVG 时，图里只引用这些变量，换主题、深色和打印时就会和内置结构图一起变化。`check` 会另外检查手绘图的文字重叠、文字越界、连线压字和箭头被遮挡。

界面稿的明暗底色和自动系列色来自 [UI 自己的配色](../skills/html-view/scripts/src/artifacts/ui/theme.mjs)，不读取内置主题的系列候选。

## 使用与维护入口

- [技能入口与图型索引](../skills/html-view/SKILL.md)
- [CLI、自动测试与图库维护](../skills/html-view/scripts/README.md)
- [KChart API、程序包与许可](../packages/kchart/README.md)（第三方资产见[资产声明](../packages/kchart/NOTICE.md)，地图地区键见[REGIONS.md](../packages/kchart/assets/maps/REGIONS.md)）
- [图谱与样例](showcase/README.md) · [图型覆盖和反例](chart-coverage.md)
