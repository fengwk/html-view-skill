# KChart

[简体中文](README.zh-CN.md)

KChart renders declarative charts and diagrams to deterministic SVG without a DOM, a runtime dependency, or a remote rendering service. Install with `npm install @fengwk/kchart`. Node.js consumers need Node 22.12 or later; all entries are ESM and include TypeScript declarations.

## Mermaid compatibility

All 525 core examples accepted by Mermaid 12.3.0 in the [conformance corpus](https://github.com/fengwk/html-view-skill/tree/main/packages/kchart/tests/conformance) render at both 800 px and 360 px without error diagnostics and pass the geometry checks. KChart uses its own layout and theme: supported style colors map by hue to theme status colors; unsupported presentation is not reproduced. Safe links are kept, but callbacks are not executed. ZenUML needs an external plugin in Mermaid; KChart parses it natively and draws it as a sequence diagram, covering all 16 ZenUML examples in the Mermaid 12.3.0 documentation.

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

`render(spec, options?)` and `diagram(source, options?)` both resolve to `{ svg, scene, diagnostics }`. Hosts that display data details can use `spec.data` directly. For invalid input or a layout that cannot be rendered, `svg` and `scene` are `null`; unexpected failures reject. Each diagram diagnostic has `severity`: an `error` blocks rendering, while a `warning` (for example, a skipped callback or a suggestion to split a large diagram) accompanies a rendered SVG. `check(source, { syntax, lang }?)` resolves to the parse/validation diagnostics, warnings included, without laying out the diagram. The diagram syntax defaults to `mermaid`; use `layers`, `blocks`, or `swimlane` for native diagrams. `catalog` and `diagramTypes` expose the supported types and diagram aliases synchronously.

Render options include `width`, `lang`, `theme`, `media`, `frame`, `prefix`, and `measure(text, size, weight, fontFamily)`. Set `frame: false` if your host already supplies a figure frame. The host then shows the title: a chart's comes from its spec (`title`, `subtitle`), and a diagram returns its title as `scene.heading` without drawing it (compact embedding, below, draws it once instead). Give each inline SVG a unique `prefix`; allow horizontal scrolling if a diagram needs more room than the requested width.

KChart does not mount anything: the page that owns the DOM places the SVG. For a chart whose spec declares `interaction` actions, `attach(svg, spec)` from this asynchronous entry wires them onto the SVG you placed. It loads the interaction layer on demand and resolves to a disposer that removes them.

For embedding, set `compact: true` in `diagram()` (async or sync) or in the Mermaid facade’s `render()` options. It caps layout width at 720px, crops the scene to its visible content instead of centering it, and uses 12–14px text. With `frame: false`, KChart omits the outer frame and shows any diagram title once above the drawing, left-aligned and wrapped to the layout width. The default is `compact: false`.

If `lang` is omitted, diagrams infer English or Chinese from the source: English when there are at least twice as many English words as CJK characters and at least one English word; otherwise Chinese. Set `lang` explicitly to override this.

A production Vite build splits chart and diagram families at dynamic imports. Make the Markdown component itself a dynamic import (for example with `React.lazy`) to defer the facade as well. Shared dependencies can be reused between families. For a map chart, only the requested built-in map (`world` or `us-states`) is loaded; `options.assets` can supply your own map data instead. The renderer needs no network service at runtime; serve the JavaScript chunks and map assets locally for offline use. In a hosted browser build on-demand imports may still load chunks from your own host.

## Boards

Native `blocks` draws a one-page overview board: dashed groups (`box`) holding cards, notes and a legend, laid out with `row`, `col` and `grid N`. Each line indented under a `card` is one description line. Braces at the end of a `box` or `card` line add a style word (`accent`, `new`, `info`, `ok`, `warn`, `danger`, `ext`), a `#01` badge, an `@id` reference or a `"tag"`. Relations `->`, `=>` (main flow) and `~>` (dashed) connect groups and cards by `@id` or exact title.

```js
const board = await diagram(`row
  box Inputs
    card Sessions
      Every repository
  box Weekly review {accent}
    card Collect {accent #01}
      Run the metrics
    card Diagnose {accent #02}
      Pick a fix
  col
    card Checks {ok}
    legend
      accent: Review step
      ok: Lasting fix
      =>: Main flow
Sessions => Collect
Collect => Diagnose
Diagnose -> Checks: ships`, { syntax: 'blocks', width: 720 });
```

Relations run orthogonally around cards, group borders and titles; gaps widen to fit them, but rows, columns and spans stay as written. Mermaid `block` diagrams use the same router and dashed group frames. Colors come from the theme: plain cards are borderless tiles, styled cards are outlined in the style color, and the styles used together on one board stay distinguishable in every built-in theme. See the [blocks reference (Chinese)](https://github.com/fengwk/html-view-skill/blob/main/skills/html-view/references/diagrams/architecture.md#blocks) for every option and limit.

## Synchronous Node API

```js
import { diagram, schema } from '@fengwk/kchart/node';
console.log(diagram('flowchart LR\nA --> B').svg);
console.log(schema('bar'));
```

The Node entry provides synchronous `render`, `diagram`, `check`, `parse`, `validate`, and `schema`. Use `createRenderer({ specs })` to select families for a set of declarations, or `createRenderer({ sources })` for a diagram-only renderer. A renderer's `bundleSource()` is the only way to generate a classic script for offline pages, exposing `globalThis.KChart` with the render calls only. For that classic script, supply map data via `options.assets`; the synchronous Node renderer reads built-in maps from disk.

## Mermaid-style facade

```js
import mermaid from '@fengwk/kchart/mermaid';

mermaid.initialize({ theme: 'paper' });
const { svg, diagramType, diagnostics } = await mermaid.render('preview-1', 'graph LR\nA --> B');
```

The default export holds the same functions as the named exports, so code written as `import mermaid from 'mermaid'` only needs its import changed; `await import('@fengwk/kchart/mermaid')` loads it on demand. `initialize(config)` sets the defaults for later calls, and per-call options override them. KChart's own options control the render: `width`, `lang`, `media`, `frame`, `prefix`, `measure`, and `theme` when it is a KChart theme ID such as `paper` or a theme object. Every other setting is checked like a `config` in the diagram's front matter, which overrides it. Settings the diagram type supports, such as `c4: { c4ShapeInRow: 1 }`, take effect. Runtime settings such as `startOnLoad` and `securityLevel` are accepted silently, as are `fontFamily` and `fontSize`, because fonts come from the KChart theme. Anything else, including `themeVariables` and Mermaid theme names such as `dark` (KChart then draws its default theme), is reported in one `IGNORED_CONFIG` warning; Mermaid's `default` theme needs none. The render ID supplies the SVG prefix unless a per-call prefix is provided. `render(id, text, options?)` rejects invalid diagrams with an `Error` carrying `diagnostics`; warnings never reject. `parse(text, { suppressErrors }?)` resolves to `{ diagramType, diagnostics }` (warnings only), or to `false` for invalid input when suppression is enabled; otherwise it rejects with diagnostics. Synchronous `detectType(text)` returns the canonical type for a recognized Mermaid header, without validating the body, and throws for unknown types.

This is a Mermaid-style facade, not the entire Mermaid API. It does not run callbacks or return DOM binding functions. Successful `parse` does not guarantee that a diagram can be laid out.

## Diagnostics and icons

Diagram diagnostics carry a `code`, `severity`, `line`, `column`, `message`, `fix`, and `topic`. Diagram warnings include `IGNORED_CONFIG` (unused settings), `IGNORED_STYLE` (unused CSS), `IGNORED_INTERACTION` (callbacks or unsafe links), `IGNORED_ASSET` (such as an unknown icon or a remote image), `LARGE_DIAGRAM` (consider splitting the figure), and `DIAGRAM_HINT` (type-specific advice).

Both the async and Node entries export `registerIcons({ prefix, icons, width?, height? })` for an Iconify-style icon set. Each entry in `icons` has an SVG `body` and optional `width` and `height`; KChart normalizes the geometry. Registered icons are shared across renders in the same process (or browser context) and referenced as `prefix:name` wherever the diagram accepts icons. Built-in icons work without registration; unresolved icons warn rather than blocking render.

## Themes and supported types

`themes` lists the built-in palettes; `theme('paper')` returns a reusable snapshot. Pass a built-in ID or a snapshot as `options.theme`, and use `media: 'print'` for print colors. The Node entry also exposes `resolveThemeConfig(config)` for inherited custom themes.

See [chart declarations](https://github.com/fengwk/html-view-skill/blob/main/packages/kchart/docs/declaring-charts.md) and [diagram references (Chinese)](https://github.com/fengwk/html-view-skill/tree/main/skills/html-view/references/diagrams) for inputs, supported types, and Mermaid limitations.

KChart is [MIT licensed](LICENSE). See [NOTICE](NOTICE.md) for asset sources and licenses.

From a source checkout, run `npm ci && npm run build` in `packages/kchart` before `npm pack`. See the [changelog](CHANGELOG.md) for release notes.
