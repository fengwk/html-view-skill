# Changelog

## 0.2.0

Boards change visibly in this release, with additional Mermaid compatibility fixes.

- `diagram()` and the Mermaid facade accept opt-in `compact: true` for left-aligned, content-sized diagrams with a 720px layout cap and 12–14px text. Structure diagrams use their natural geometry instead of filling the host width.
- Give class member text clearance from compartment dividers, keep C4 relationship captions off boundary borders, prefer explicit word breaks in Git commit captions, and balance bilateral mindmap branches by subtree weight. The fallback text measurer now counts fullwidth forms as fullwidth glyphs.
- Native `blocks` draws one-page overview boards. New `card` (a title plus description lines), `note`, `legend` and `grid N` lines join `row`, `col` and `box`. Braces at the end of a `box` or `card` line take a style word (`accent`, `new`, `info`, `ok`, `warn`, `danger`, `ext`), `db`, a `#01` badge, an `@id` reference or a `"tag"`. Relations `->`, `=>` (main flow) and `~>` (dashed) connect groups and cards by `@id` or exact title.
- Limits rise to 8 nesting levels, 400 groups and cards, 1,000 capability items and 200 relations. Larger boards still render, scroll inside the figure and warn once with `LARGE_DIAGRAM`.
- Breaking for `blocks` sources: an indented item line that starts with `card `, `note ` or `grid N`, or is exactly `legend`, is now a structure line. Groups are neutral dashed frames instead of cycling the series colors; plain cards and capability items are borderless tiles; styled cards are outlined in the style's theme color.
- Mermaid `block` and native `blocks` share one router. Relations run orthogonally around cards, group borders and titles, and leave each side through ports ordered by destination. Gaps widen to fit relations and labels, but rows, columns and spans stay as written. Mermaid `block` groups are dashed frames with the title at the top left.
- Styles used together on one board stay distinguishable in every built-in theme. `accent` follows the chart accent (`tones[1]`); if the board also uses a status color too close to it, `accent` is drawn in ink.

- Mermaid `radar-beta` supports 1–24 axes with measured label spacing and hints for degenerate or scrolling charts. Native radar remains limited to 3–6 dimensions. Mermaid `info` displays the current KChart package version.
- Mermaid header near misses suggest the supported keyword, and Gantt reports tasks accidentally combined on one line.

## 0.1.1

- Center the title and payload together both horizontally and vertically inside Event Modeling frames. Keep the payload rows left-aligned within that block.
- Draw Venn labels directly on the set and intersection fills, without label backplates or halos. Keep text clear of ring outlines and move labels below the diagram only when they cannot fit.
- Keep lines and points above columns in combo charts and Mermaid XY charts. Add a thin outline only where a line overlaps a low-contrast column.
- Raise warning-label contrast in the Cloud Music theme.
- Report an invalid top-level chart `id` once, while continuing to support row identifiers through `encode.id`.

## 0.1.0

- First npm release with an asynchronous browser/Node ESM API, on-demand chart and diagram families, and separately loaded built-in maps.
- Added Mermaid 12.3.0 core compatibility, verified on 525 examples at 800 px and 360 px with geometry checks. Each core diagram's canonical name is the keyword Mermaid 12.3.0 parses, such as `architecture-beta`; other accepted spellings are aliases. The external ZenUML plugin is not supported.
- Added the Mermaid-style `initialize`, `render`, `parse`, and `detectType` facade, as named exports and as a default export like Mermaid's own. Mermaid settings are checked like the diagram's front-matter config, which overrides them: supported settings such as `c4.c4ShapeInRow` apply, runtime settings such as `startOnLoad` pass silently, and the rest, such as `themeVariables` or the theme name `dark`, produce one `IGNORED_CONFIG` warning. Diagram diagnostics distinguish blocking errors from non-blocking warnings.
- Added theme-based style colors, safe links without callback execution, and support for host-registered Iconify icon sets.
- Exposed the synchronous Node API at `@fengwk/kchart/node`; all three entry points ship TypeScript declarations.
