# KChart

[简体中文](README.zh-CN.md)

KChart renders declarative charts and diagrams to deterministic SVG without a DOM, a runtime dependency, or a remote rendering service. Install with `npm install @fengwk/kchart`. Node.js consumers need Node 22.12 or later; all entries are ESM and include TypeScript declarations.

## Browser and async Node API

```js
// Keep this import inside a lazy Markdown renderer (or the handler that needs it).
const { diagram, render } = await import('@fengwk/kchart');
const flow = await diagram('flowchart LR\nA --> B', { width: 480, prefix: 'flow-1' });
const bars = await render({
  chart: 'bar',
  data: [{ region: 'East', orders: 120 }, { region: 'South', orders: 85 }],
  encode: { category: 'region', value: 'orders' },
}, { theme: 'paper', prefix: 'bars-1' });
```

`render(spec, options?)` and `diagram(source, options?)` resolve to `{ svg, scene, diagnostics }`. For invalid input or a layout that cannot be rendered, `svg` and `scene` are `null`; unexpected failures reject. `check(source, { syntax, lang }?)` resolves to the parse/validation diagnostics without laying out the diagram. The diagram syntax defaults to `mermaid`; use `layers`, `blocks`, or `swimlane` for native diagrams. `catalog` and `diagramTypes` expose the supported types and diagram aliases synchronously.

Render options include `width`, `lang`, `theme`, `media`, `frame`, `prefix`, and `measure(text, size, weight, fontFamily)`. Set `frame: false` if your host already supplies a figure frame. Give each inline SVG a unique `prefix`; allow horizontal scrolling if a diagram needs more room than the requested width.

A production Vite build splits chart and diagram families at dynamic imports. Make the Markdown component itself a dynamic import (for example with `React.lazy`) to defer the facade as well. Shared dependencies can be reused between families. For a map chart, only the requested built-in map (`world` or `us-states`) is loaded; `options.assets` can supply your own map data instead. Browser imports do not use the Node entry or fetch map data from third-party services.

## Synchronous Node API

```js
import { diagram, schema } from '@fengwk/kchart/node';
console.log(diagram('flowchart LR\nA --> B').svg);
console.log(schema('bar'));
```

The Node entry provides synchronous `render`, `diagram`, `check`, `parse`, `validate`, `schema`, and `dataTable`. Use `createRenderer({ specs })` to select families for a set of declarations, or `createRenderer({ sources })` for a diagram-only renderer. `browserSource(specs)` (or a renderer's `bundleSource()`) generates a classic script for offline pages, exposing `globalThis.KChart`. For that classic script, supply map data via `options.assets`; the synchronous Node renderer reads built-in maps from disk. `runtimeSource()` supplies the optional offline page runtime.

## Mermaid-style facade

```js
const mermaid = await import('@fengwk/kchart/mermaid');
mermaid.initialize({ theme: 'paper' });
const { svg, diagramType, diagnostics } = await mermaid.render('preview-1', 'graph LR\nA --> B');
```

`initialize(config)` replaces the default KChart render options; the render ID supplies the SVG prefix unless a per-call prefix is provided. `render(id, text, options?)` rejects invalid diagrams with an `Error` carrying `diagnostics`. `parse(text, { suppressErrors }?)` resolves to `{ diagramType }`, or to `false` for invalid input when suppression is enabled; otherwise it rejects with diagnostics. Synchronous `detectType(text)` returns the canonical type for a recognized Mermaid header, without validating the body, and throws for unknown types.

This facade supports KChart's documented Mermaid subset, not the entire Mermaid API. It does not run callbacks or return DOM binding functions.

## Themes and supported types

`themes` lists the built-in palettes; `theme('paper')` returns a reusable snapshot. Pass a built-in ID or a snapshot as `options.theme`, and use `media: 'print'` for print colors. The Node entry also exposes `resolveThemeConfig(config)` for inherited custom themes.

See [chart declarations](https://github.com/fengwk/html-view-skill/blob/main/packages/kchart/docs/declaring-charts.md) and [diagram declarations](https://github.com/fengwk/html-view-skill/blob/main/packages/kchart/docs/declaring-diagrams.md) for inputs, supported types, and Mermaid limitations.

KChart is [MIT licensed](LICENSE). See [NOTICE](NOTICE.md) for asset sources and licenses.

From a source checkout, run `npm ci && npm run build` in `packages/kchart` before `npm pack`. See the [changelog](CHANGELOG.md) for release notes.
