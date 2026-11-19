# KChart

[English](README.md)

KChart 将声明式图表和结构图渲染为确定性的 SVG，不依赖 DOM、运行时依赖或远程渲染服务。使用 `npm install @fengwk/kchart` 安装。Node.js 需要 22.12 或更高版本；所有入口均为 ESM，并带有 TypeScript 声明。

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

`render(spec, options?)` 和 `diagram(source, options?)` 返回 Promise，结果为 `{ svg, scene, diagnostics }`。输入无效或无法布局时，`svg` 和 `scene` 均为 `null`；意外错误会拒绝 Promise。`check(source, { syntax, lang }?)` 仅解析和校验，不执行布局，异步返回诊断数组。结构图默认使用 `mermaid` 语法，原生结构图使用 `layers`、`blocks` 或 `swimlane`。`catalog` 和 `diagramTypes` 可同步查询支持的图型及结构图别名。

渲染选项包括 `width`、`lang`、`theme`、`media`、`frame`、`prefix` 和 `measure(text, size, weight, fontFamily)`。宿主已有图框时可设置 `frame: false`。每个内联 SVG 应使用不同的 `prefix`；结构图可能宽于请求值，建议让容器可以横向滚动。

在 Vite 生产构建中，数据图和结构图的各个族通过动态导入拆分。如果也要延迟加载适配器，请动态导入 Markdown 组件（例如使用 `React.lazy`）。不同族可复用公共依赖。地图只在地图图表需要时加载相应的内置数据（`world` 或 `us-states`），也可通过 `options.assets` 注入自有地图。浏览器入口不依赖 Node 入口，也不向第三方服务请求地图数据。

## Node 同步 API

```js
import { diagram, schema } from '@fengwk/kchart/node';
console.log(diagram('flowchart LR\nA --> B').svg);
console.log(schema('bar'));
```

Node 入口提供同步的 `render`、`diagram`、`check`、`parse`、`validate`、`schema` 和 `dataTable`。使用 `createRenderer({ specs })` 按声明选取图族，或使用 `createRenderer({ sources })` 创建只含结构图的渲染器。`browserSource(specs)` 或渲染器的 `bundleSource()` 为离线页面生成暴露 `globalThis.KChart` 的普通脚本。该脚本需要通过 `options.assets` 注入地图，同步 Node 渲染器则从本地磁盘读取内置地图。`runtimeSource()` 提供可选的离线页面运行时。

## Mermaid 风格适配器

```js
const mermaid = await import('@fengwk/kchart/mermaid');
mermaid.initialize({ theme: 'paper' });
const { svg, diagramType, diagnostics } = await mermaid.render('preview-1', 'graph LR\nA --> B');
```

`initialize(config)` 替换 KChart 的默认渲染选项。`render(id, text, options?)` 默认用 `id` 作为 SVG 前缀，可通过单次调用的 `prefix` 覆盖；遇到无效图时以带 `diagnostics` 的 `Error` 拒绝。`parse(text, { suppressErrors }?)` 成功时返回 `{ diagramType }`，无效输入在启用抑制时返回 `false`，否则以带诊断的错误拒绝。同步的 `detectType(text)` 根据首行图型声明返回标准图型名，不校验正文；图型未知时抛出异常。

适配器仅支持 KChart 文档列出的 Mermaid 子集，不是完整的 Mermaid API；不执行回调，也不返回 DOM 绑定函数。

## 主题和支持的图型

`themes` 列出内置主题；`theme('paper')` 返回可复用的快照。`options.theme` 接受内置主题 ID 或快照，`media: 'print'` 使用打印配色。Node 入口还提供 `resolveThemeConfig(config)` 解析继承式自定义主题。

具体输入、支持的图型和 Mermaid 限制见[数据图声明](https://github.com/fengwk/html-view-skill/blob/main/packages/kchart/docs/declaring-charts.md)和[结构图声明](https://github.com/fengwk/html-view-skill/blob/main/packages/kchart/docs/declaring-diagrams.md)。

KChart 采用 [MIT 许可](LICENSE)，资产来源和许可见 [NOTICE](NOTICE.md)。

从源码打包时，请先在 `packages/kchart` 运行 `npm ci && npm run build`，再运行 `npm pack`。版本变更见[更新日志](CHANGELOG.md)。
