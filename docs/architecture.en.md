# html-view and KChart: how they fit together

[简体中文](architecture.md) · English

`htmlview` produces offline single-file HTML. It builds and maintains reading documents, data reports and UI mockups, and it also reads, checks and exports local HTML. Data charts and diagrams come from the separate KChart library. No third-party rendering runtime is installed, and no generated browser bundle is kept in the repository.

| Boundary | Implementation |
|---|---|
| Commands and output | `scripts/htmlview` dispatches `doc`, `data`, `ui`, `viz` and the shared commands; structured failures carry a suggested next step |
| Outputs | `scripts/src/artifacts/{doc,data,ui,viz}` each own their skeleton, their specific audits and their diff units, and never import each other |
| Shared shell | `scripts/src/shared/` handles the HTML content markers, theme variables, chart validation and module selection; `scripts/src/tools/` relies on the shared browser, document parsing and print settings |
| Rendering core | `kchart/src/core` owns themes, text measurement, geometry, scenes and SVG; `chart` and `diagram` hold the data charts and the diagrams |

## Content and shell

`htmlview:kind` marks the output type and `htmlview:shell` records resource fingerprints. The only content area is the HTML between `<!-- htmlview:content -->` and `<!-- /htmlview:content -->`. For documents and reports, `style` only rebuilds the shell. A Markdown build is tied to its source path, and a data report to the hash of its content area and the evidence it carries. The hashes detect changes; they are not signatures. Reports only consume CSV/JSON that was aggregated upstream. Comparisons follow the reporting period, unknown values are never treated as zero, and no database is accessed.

Charts are stored as `pre[data-viz]` with the type `kchart`, `mermaid`, `layers`, `blocks` or `swimlane`. What is stored is the escaped declaration, not static SVG. A page without charts embeds no chart code. When charts are present, maps are inlined with the document and modules are chosen from the dependency closure of the declarations. `viz render` instead writes a standalone SVG or a static figure page with its source embedded. The page runs no script when opened; `style` re-renders it from the embedded source.

## Layout and checks

`kchart/src/modules.json` is the single source for module dependencies and the chart registry. DOM-free parsing and layout run in both Node and the browser. In the browser, text is measured with Canvas, and charts are laid out again when the width, theme or print media changes. Data charts and diagrams share one SVG serializer. Readable text and complete geometry come first: when needed, the chart canvas grows and scrolls horizontally inside its frame, rather than silently switching to a different layout on narrow screens.

`audit` checks the inputs and the integrity of the output. `check` tests real device widths, the printed page and browser errors. `shot` and `export` wait for the layout of the current media. Print checks and export share the same page measurement, and PDF export refuses to write a file when content would be clipped horizontally or a chart is taller than one page. Use `--paper a4-landscape` for wide charts and `--paper a3-portrait` for tall ones; if it still doesn't fit, deliver the full SVG or have the author rearrange the content. Automated tests don't replace looking at the output.

<a id="themes"></a>

## Themes and colors

| What to change | How |
|---|---|
| The theme of one document or report | `htmlview style report.html --theme obsidian`. `htmlview style --list` shows the built-in themes. Data and content stay the same. |
| The brand color or light/dark scheme of a UI mockup | `htmlview style prototype.html --brand '#a84624' --scheme light`. Mockups derive their theme from the brand color and don't take `--theme`. |
| Your own colors through the KChart API | Pass a `theme` object to `render()` or `diagram()`. You can spread a built-in theme and override the fields you need; no library change or CLI registration is required. |
| Apply your own theme | `htmlview style report.html --theme-file harbor.json`. Inherit a built-in theme and set only the roles you want to change. The resolved theme travels inside the HTML, with no JSON file to share. |
| Add a built-in theme | Put the reviewed `<id>.json` in [`kchart/assets/themes/`](../skills/html-view/kchart/assets/themes/). The CLI, KChart, shared tests and gallery generator find it automatically. No CSS or chart registration is needed. Regenerate the README comparison when publishing. |

Each theme has a single JSON file for colors and styling. The HTML shell generates its CSS variables from it, and KChart uses the resolved roles directly. Recoloring an existing theme needs no CSS or chart changes. `tones[1]` is the second data series and `accent` is the shell's highlight color; they are different roles. A handful of arbitrary hex values is not enough: a palette covers background, text, strokes, states and six series colors, and must pass the contrast and color-vision checks. After adding a theme, check narrow screens, real charts and printing; dark themes still print with the Paper palette.

A theme can set `frameInk` to give ordinary diagram frames their own color. Layers, swimlanes, sequence groups and mind-map branches derive pale fills and strokes from it, and the mind-map root uses the primary text color as ink. Cloud Music uses neutral gray so a group is not mistaken for a warning; this does not change data series, numbering, links or explicit status colors. Themes without `frameInk` keep their previous colors. The optional `tint: { hue, chroma }` controls OKLCH mixing for decorative tints. Claude uses `{ hue: 95, chroma: 1.4 }` to lighten terracotta toward its 95° ivory paper rather than pink.

UI mockups have [their own light and dark palettes and series candidates](../skills/html-view/scripts/src/artifacts/ui/theme.mjs), separate from the built-in reading themes.

A minimal `harbor.json` for `--theme-file`:

```json
{
  "extends": "paper",
  "accent": "#12635e",
  "frameInk": "#677471",
  "style": { "radius": 12, "numberColor": "accent" }
}
```

To ship it as a built-in theme, name it `harbor.json` and also set `id`, `name`, `en` and `desc`. See the [full field reference (Chinese)](../skills/html-view/references/guides/themes.md).

## Where to go next

These pages are in Chinese:

- [Skill entry and chart index](../skills/html-view/SKILL.md)
- [CLI, automated tests and gallery maintenance](../skills/html-view/scripts/README.md)
- [KChart API, package and license](../skills/html-view/kchart/README.md)
- [Chart coverage and counterexamples](chart-coverage.md)

[Gallery and samples](showcase/README.en.md) are available in English.
