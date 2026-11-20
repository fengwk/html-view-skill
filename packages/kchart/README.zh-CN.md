# KChart

[English](README.md)

KChart 将声明式图表和结构图渲染为确定性的 SVG，不依赖 DOM、运行时依赖或远程渲染服务。使用 `npm install @fengwk/kchart` 安装。Node.js 需要 22.12 或更高版本；所有入口均为 ESM，并带有 TypeScript 声明。

## Mermaid 兼容性

[兼容性语料](https://github.com/fengwk/html-view-skill/tree/main/packages/kchart/tests/conformance)中 Mermaid 12.3.0 接受的 525 个核心示例，均能在 800 px 和 360 px 下无错误诊断地渲染，并通过图形几何检查。KChart 使用自己的布局与主题：可识别的样式颜色按色相映射为主题状态色，不复刻不支持的外观。安全链接会保留，回调不会执行。ZenUML 是 Mermaid 外部插件，KChart 不支持该插件；仅保留 `zenuml` 简单调用图的旧版读法。

## 浏览器和 Node 异步 API

```js
// 在懒加载的 Markdown 渲染器中导入，或在真正需要时导入。
const { diagram, render } = await import('@fengwk/kchart');
const flow = await diagram('flowchart LR\nA --> B', { width: 480, prefix: 'flow-1' });
const bars = await render({
  chart: 'bar',
  data: [{ region: '华东', orders: 120 }, { region: '华南', orders: 85 }],
  encode: { category: 'region', value: 'orders' },
}, { theme: 'paper', prefix: 'bars-1' });
```

`render(spec, options?)` 和 `diagram(source, options?)` 返回 Promise，结果为 `{ svg, scene, diagnostics }`。输入无效或无法布局时，`svg` 和 `scene` 均为 `null`；意外错误会拒绝 Promise。每条结构图诊断带 `severity`：`error` 阻止渲染；`warning` 会随 SVG 一起返回，例如跳过回调或建议拆分大图。`check(source, { syntax, lang }?)` 仅解析和校验，不执行布局，异步返回含警告在内的诊断数组。结构图默认使用 `mermaid` 语法，原生结构图使用 `layers`、`blocks` 或 `swimlane`。`catalog` 和 `diagramTypes` 可同步查询支持的图型及结构图别名。

渲染选项包括 `width`、`lang`、`theme`、`media`、`frame`、`prefix` 和 `measure(text, size, weight, fontFamily)`。宿主已有图框时可设置 `frame: false`。每个内联 SVG 应使用不同的 `prefix`；结构图可能宽于请求值，建议让容器可以横向滚动。

不传 `lang` 时，结构图会根据源码推断语言：英文词至少有一个，且数量不少于中日韩字符的两倍时用英文，否则用中文。显式指定 `lang` 可覆盖推断结果。

在 Vite 生产构建中，数据图和结构图的各个族通过动态导入拆分。如果也要延迟加载适配器，请动态导入 Markdown 组件（例如使用 `React.lazy`）。不同族可复用公共依赖。地图只在地图图表需要时加载相应的内置数据（`world` 或 `us-states`），也可通过 `options.assets` 注入自有地图。渲染不依赖在线服务；将 JavaScript 分块和地图资源放在本地即可离线使用。浏览器部署时，动态导入仍可能从宿主加载分块。

## Node 同步 API

```js
import { diagram, schema } from '@fengwk/kchart/node';
console.log(diagram('flowchart LR\nA --> B').svg);
console.log(schema('bar'));
```

Node 入口提供同步的 `render`、`diagram`、`check`、`parse`、`validate`、`schema` 和 `dataTable`。使用 `createRenderer({ specs })` 按声明选取图族，或使用 `createRenderer({ sources })` 创建只含结构图的渲染器。`browserSource(specs)` 或渲染器的 `bundleSource()` 为离线页面生成暴露 `globalThis.KChart` 的普通脚本。该脚本需要通过 `options.assets` 注入地图，同步 Node 渲染器则从本地磁盘读取内置地图。`runtimeSource()` 提供可选的离线页面运行时。

## Mermaid 风格适配器

```js
import mermaid from '@fengwk/kchart/mermaid';

mermaid.initialize({ theme: 'paper' });
const { svg, diagramType, diagnostics } = await mermaid.render('preview-1', 'graph LR\nA --> B');
```

默认导出与具名导出是同一组函数，原来写成 `import mermaid from 'mermaid'` 的代码只需改导入路径；也可以用 `await import('@fengwk/kchart/mermaid')` 按需加载。`initialize(config)` 设置之后各次调用的默认值，单次调用的选项优先。KChart 自己的选项直接控制渲染：`width`、`lang`、`media`、`frame`、`prefix`、`measure`，以及取 KChart 主题 ID（如 `paper`）或主题对象的 `theme`。其余设置都按图内前言的 `config` 检查，图内配置优先：图型支持的设置（如 `c4: { c4ShapeInRow: 1 }`）生效；`startOnLoad`、`securityLevel` 等运行设置静默接受，`fontFamily`、`fontSize` 也静默接受，字体由 KChart 主题决定；其他设置，包括 `themeVariables` 和 `dark` 等 Mermaid 主题名（此时改用 KChart 默认主题），合并报一条 `IGNORED_CONFIG` 警告；Mermaid 的 `default` 主题不报。`render(id, text, options?)` 默认用 `id` 作为 SVG 前缀，可通过单次调用的 `prefix` 覆盖；遇到无效图时以带 `diagnostics` 的 `Error` 拒绝，警告不会导致拒绝。`parse(text, { suppressErrors }?)` 成功时返回 `{ diagramType, diagnostics }`（只含警告），无效输入在启用抑制时返回 `false`，否则以带诊断的错误拒绝。同步的 `detectType(text)` 根据首行图型声明返回标准图型名，不校验正文；图型未知时抛出异常。

这是 Mermaid 风格的适配器，不是完整的 Mermaid API；不执行回调，也不返回 DOM 绑定函数。`parse` 成功不保证图可以完成布局。

## 诊断与图标

结构图诊断含 `code`、`severity`、`line`、`column`、`message`、`fix` 和 `topic`。警告码包括 `IGNORED_CONFIG`（未采用的配置）、`IGNORED_STYLE`（未采用的 CSS）、`IGNORED_INTERACTION`（回调或不安全的链接）、`IGNORED_ASSET`（如未知图标或远程图片）、`LARGE_DIAGRAM`（建议拆图）和 `DIAGRAM_HINT`（图型专用提示）。

异步入口和 Node 入口均导出 `registerIcons({ prefix, icons, width?, height? })`，用于注册 Iconify 格式的图标集。`icons` 中每项包含 SVG `body`，可选 `width` 和 `height`；KChart 会规范化图形。已注册的图标在同一进程（或浏览器上下文）的渲染间共享，在图型支持图标的位置使用 `prefix:name` 引用。内置图标无需注册；无法解析的图标只告警，不阻止渲染。

## 主题和支持的图型

`themes` 列出内置主题；`theme('paper')` 返回可复用的快照。`options.theme` 接受内置主题 ID 或快照，`media: 'print'` 使用打印配色。Node 入口还提供 `resolveThemeConfig(config)` 解析继承式自定义主题。

具体输入、支持的图型和 Mermaid 限制见[数据图声明](https://github.com/fengwk/html-view-skill/blob/main/packages/kchart/docs/declaring-charts.md)和[结构图参考](https://github.com/fengwk/html-view-skill/tree/main/skills/html-view/references/diagrams)。

KChart 采用 [MIT 许可](LICENSE)，资产来源和许可见 [NOTICE](NOTICE.md)。

从源码打包时，请先在 `packages/kchart` 运行 `npm ci && npm run build`，再运行 `npm pack`。版本变更见[更新日志](CHANGELOG.md)。
