# 声明与渲染 KChart 数据图

本文是 KChart 数据图声明的独立用法说明。图型字段和约束以当前 `dist/esm/node.js` 导出的 `catalog`、`schema()` 与 `validate()` 为准；字段组合不要从相似图型推测。

## 最短用法

在 KChart 库目录中用 Node.js 22.12+ 执行 `npm ci && npm run build` 后运行示例。把完整声明赋给 `spec`，`render()` 的诊断为空且 SVG 存在时才算成功：

```js
import { render } from './dist/esm/node.js';

const spec = {
  chart: 'bar',
  title: '各区域订单',
  data: [{ region: '华东', orders: 120 }, { region: '华南', orders: 85 }],
  encode: { category: 'region', value: 'orders' },
  unit: '单',
};
const { svg, diagnostics } = render(spec, { width: 480, theme: 'paper' });
if (diagnostics.length) throw new Error(diagnostics.map(({ message }) => message).join('；'));
console.log(svg);
```

`render(spec, options)` 返回 `{ svg, scene, diagnostics }`。先修复所有诊断再使用 SVG；输入不合法时 `svg`、`scene` 为空。需要单独预检可调用 `validate(spec)`（不排版），需要查询某图字段可调用 `schema('bar')`，全部图型与字段角色见 `catalog`。使用 `schema()` 和 `catalog` 的字段定义，不要自行添加参数。

## 通用写法

- 声明使用 `chart`、`data`、`encode`；表格形状为非空对象数组，`encode` 将图型角色映射到数据字段名。非表格图按该图型要求使用树、网络、路径或地图数据结构，不能套用表格行。
- `title`、`subtitle`、`source`、`note` 是可选文本。数值单位用根级 `unit`（不能写 `%`），或按字段写 `fields.<字段>.unit`；比例字段用 `fields.<字段>.format: 'percent'`，不可再给该字段写 `unit`。字段元数据还可写 `label`、`type`、`decimals`、`domain`、`scale`，但必须符合图型、角色和数据的约束。
- `variant`、`layout`、`stack`、`sort`、`emphasis`、`annotations`、`interaction` 不是通用可用参数。先用 `schema(chart)` 查询该图型字段，再由 `validate(spec)` 确认参数搭配。
- `annotations` 只支持 line、area、bar、column、scatter、combo、interval、histogram、candlestick；只可引用该图编码中的数值字段。注释为 `{kind:'rule', field, value, label?}`、`{kind:'band', field, from, to, label?}` 或 `{kind:'note', record, field, text}`。note 需要 `encode.id` 且 record 必须命中数据中的 ID。字段范围、图型和参数的实际约束由 `validate()` 判定。
- 交互须通过 `interaction` 声明且必须受该图型支持。渲染结果为 `{ svg, scene, diagnostics }`，静态 SVG 由宿主挂载；宿主可用异步入口的 `attach(svg, spec)` 把交互挂到已放置的 SVG 上，并保留其返回的 dispose 函数。
