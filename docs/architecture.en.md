# html-view and KChart: how they fit together

[简体中文](architecture.md) · English

`htmlview` produces offline single-file HTML. It builds and maintains reading documents, data reports and UI mockups, and it also reads, checks and exports local HTML. Data charts and diagrams come from the separate KChart library. No third-party rendering runtime is installed, and no generated browser bundle is kept in the repository.

| Boundary | Implementation |
|---|---|
| Commands and output | `scripts/htmlview` dispatches `doc`, `data`, `ui`, `viz` and the shared commands; structured failures carry a suggested next step |
| Outputs | `scripts/src/artifacts/{doc,data,ui}` each own their skeleton, their specific audits and their diff units, and never import each other |
| Shared shell | `scripts/src/shared/` handles the HTML content markers, theme variables, chart validation and module selection; `scripts/src/tools/` relies on the shared browser, document parsing and print settings |
| Rendering core | `kchart/src/core` owns themes, text measurement, geometry, scenes and SVG; `chart` and `diagram` hold the data charts and the diagrams |

## Content and shell

`htmlview:kind` marks the output type and `htmlview:shell` records resource fingerprints. The only content area is the HTML between `<!-- htmlview:content -->` and `<!-- /htmlview:content -->`. `style` only rebuilds the shell. A Markdown build is tied to its source path, and a data report to the hash of its content area and the evidence it carries. The hashes detect changes; they are not signatures. Reports only consume CSV/JSON that was aggregated upstream. Comparisons follow the reporting period, unknown values are never treated as zero, and no database is accessed.

Charts are stored as `pre[data-viz]` with the type `kchart`, `mermaid`, `layers`, `blocks` or `swimlane`. What is stored is the escaped declaration, not static SVG. A page without charts embeds no chart code. When charts are present, maps are inlined with the document and modules are chosen from the dependency closure of the declarations. `viz render` instead writes a standalone SVG or a static viewer page with the source; that output is not a shell.

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
| A new named theme for `htmlview` | Register a complete palette in the [KChart theme table](../skills/html-view/kchart/src/core/theme.js), then add a CSS file with the same name in [`assets/themes/`](../skills/html-view/assets/themes/) for non-color variables such as corner radius and heading typeface. Chart layout code stays unchanged. |

The KChart theme table is the source of truth for colors, and the HTML shell's color variables are generated from it. Recoloring an existing theme needs no CSS or chart changes. `tones[1]` is the second data series and `accent` is the shell's highlight color; they are different roles. A handful of arbitrary hex values is not enough: a palette covers background, text, strokes, states and six series colors, and must pass the contrast and color-vision checks. After adding a theme, check narrow screens, real charts and printing; dark themes still print with the Paper palette.

## Where to go next

These pages are in Chinese:

- [Skill entry and chart index](../skills/html-view/SKILL.md)
- [CLI, automated tests and gallery maintenance](../skills/html-view/scripts/README.md)
- [KChart API, package and license](../skills/html-view/kchart/README.md)
- [Chart coverage and counterexamples](chart-coverage.md)

[Gallery and samples](showcase/README.en.md) are available in English.
