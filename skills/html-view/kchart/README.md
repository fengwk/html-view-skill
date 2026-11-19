# KChart

KChart 从声明生成静态 SVG。`node.mjs` 的数据图入口支持 45 种图型；`diagram.mjs` 的结构图入口支持 27 种 Mermaid 图型的受控子集和 3 种原生结构图。两个入口共用测字、主题、场景和 SVG 输出。Node.js 22+ 可直接从源码使用，不需要安装依赖或构建文件。

以下示例通过本地 `npm pack` 生成的包运行，不依赖 npm 注册表。`package.json` 保留 `private: true`，避免误发布到注册表；这不限制按 MIT 许可使用源码。若直接从源码使用，把 `kchart/chart` 与 `kchart/diagram` 分别替换为 `node.mjs` 与 `diagram.mjs` 的实际相对路径。

## 数据图

```js
import { render, schema } from 'kchart/chart';

const spec = {
  chart: 'bar',
  title: '本月订单',
  data: [{ region: '华东', orders: 120 }, { region: '华南', orders: 85 }],
  encode: { category: 'region', value: 'orders' },
  unit: '单',
};
const { svg, scene, diagnostics } = render(spec, { width: 480, theme: 'paper' });
if (diagnostics.length) throw new Error(diagnostics.map(({ message }) => message).join('；'));
console.log(svg);
```

- `parse(text)` 校验 JSON 文本，保留重复键的位置；`validate(spec)` 校验对象，不做布局。`schema(chart?)` 查看全部或单个图型的字段；`catalog` 列出图型。
- `render()` 返回 `{ svg, scene, diagnostics }`。声明不合规，或数据无法用所选图型清楚呈现时，只返回诊断。内部异常原样抛出。
- `theme(idOrObject, { media })` 返回主题快照。`render()` 接受 `width`、`lang`、`theme`、`media`、`frame`、`prefix`，以及 `measure(text, size, weight, fontFamily)`。内嵌 `<figure>` 已有标题、来源时，用 `frame: false` 避免重复。单页放多张图时，为每张图传入不同的 `prefix`。
- `browserSource(specs)` 按声明选择模块，返回可以嵌入 HTML 的脚本文本，暴露 `globalThis.KChart`。图形渲染不访问 DOM。声明了交互时，脚本才包括 `attach(svgElement, spec)`；宿主自行插入 SVG 和绑定交互。内置地图在 Node 中从本地资产读取；浏览器端由宿主提供 `options.assets`，不发网络请求。

## 结构图

```js
import { check, diagram, diagramTypes } from 'kchart/diagram';

const source = 'flowchart LR\n  A[提交申请] --> B{审核}\n  B -->|通过| C[归档]';
const options = { width: 480, theme: 'paper' };
const diagnostics = check(source); // 只解析和校验，不执行排版。
if (diagnostics.length) throw new Error(diagnostics[0].message);
console.log(diagram(source, options).svg);
```

- `diagram(source, options)` 返回 `{ svg, scene, diagnostics }`。默认 `syntax: 'mermaid'`，原生结构图使用 `layers`、`blocks` 或 `swimlane`；`diagramTypes` 列出图型、别名和诊断分组。
- 结构图接受与数据图相同的 `width`、`lang`、`theme`、`media`、`frame`、`prefix` 和 `measure`。图放不下时可以返回更宽的 SVG，宿主应让图框可滚动而不缩小字号。`frame: false` 适合已有图题的宿主图框，Mermaid 正文中的标题和轴名仍显示。
- Mermaid 仅支持受控子集，不加载官方包或远程资源。前言区可写 `title`；脑图可通过 `config.layout` 选择 `bilateral`、`right`、`left`、`radial`、`org`、`brace`、`fishbone`、`timeline`。脑图状态用独立一行 `:::new` 等表达；样式、图标指令和回调不执行，并返回定位到源码的诊断。
- `diagram.mjs` 的 `browserSource([{ source, syntax }])` 只装入所选结构图的依赖；`node.mjs` 的 `browserSource([chartSpec, { source, syntax }])` 可组装混合入口。两种脚本都暴露 `globalThis.KChart`，宿主只应选一个插入。单独调用两个入口的 `createRenderer` 可以在 Node 中复用已装入模块。

挂载浏览器宿主时，在 `browserSource()` 后加载 `src/runtime.js`，再 `KChart.mount(root, options)`；截图或导出前等待 `KChart.ready()`，媒体变更可调用 `KChart.relayout({ media: 'print' })`。

详细输入见[数据图](docs/declaring-charts.md)和[结构图](docs/declaring-diagrams.md)。`src/modules.json` 定义依赖和图型入口。[MIT License](LICENSE) 适用于 KChart 自有源码。[NOTICE](NOTICE.md) 记录上游资产来源与各自的许可。

从源码验证时，在本库目录中运行独立测试：

```sh
node --test tests/*.test.mjs
```
