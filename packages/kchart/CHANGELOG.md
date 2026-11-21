# Changelog

## 0.2.0

This release adds an opt-in compact embedding mode, one-page overview boards, native ZenUML rendering and clearer diagnostics. Apart from boards, frameless titles and the layout fixes listed below, diagrams render as in 0.1.1.

### Compact embedding

- `diagram()` and the Mermaid facade accept opt-in `compact: true` for diagrams placed inline with text. The layout is capped at 720px, the SVG is cropped to the drawing and left-aligned instead of centered, and text uses 12–14px, so output is the same for every host width of 720px or more.
- Structure diagrams keep their natural size instead of spreading to fill the host width. Mermaid charts (pie, XY, quadrant, radar, Sankey, treemap, Venn, Gantt, Wardley, Cynefin) are sized from their data; a single-leaf treemap is a small tile.
- Without an outer frame (`frame: false`), a compact diagram shows its title once, as a left-aligned heading above the drawing.
- Without a frame and without `compact`, the host shows the title. Every diagram returns it as `scene.heading` and leaves it out of the drawing; before, titled Gantt, timeline, journey, packet, Git, quadrant, pie, XY and radar diagrams also drew it, so pages that captioned the figure showed it twice. Axis names on Mermaid XY charts stay in the drawing.

### Boards

- Native `blocks` draws one-page overview boards. New `card` (a title plus description lines), `note`, `legend` and `grid N` lines join `row`, `col` and `box`. Braces at the end of a `box` or `card` line take a style word (`accent`, `new`, `info`, `ok`, `warn`, `danger`, `ext`), `db`, a `#01` badge, an `@id` reference or a `"tag"`. Relations `->`, `=>` (main flow) and `~>` (dashed) connect groups and cards by `@id` or exact title.
- Limits rise to 8 nesting levels, 400 groups and cards, 1,000 capability items and 200 relations. Larger boards still render, scroll inside the figure and warn once with `LARGE_DIAGRAM`.
- Breaking for `blocks` sources: an indented item line that starts with `card `, `note ` or `grid N`, or is exactly `legend`, is now a structure line. Groups are neutral dashed frames instead of cycling the series colors; plain cards and capability items are borderless tiles; styled cards are outlined in the style's theme color.
- Mermaid `block` and native `blocks` share one router. Relations run orthogonally around cards, group borders and titles, and leave each side through ports ordered by destination. Gaps widen to fit relations and labels, but rows, columns and spans stay as written. Mermaid `block` groups are dashed frames with the title at the top left.
- Styles used together on one board stay distinguishable in every built-in theme. `accent` follows the chart accent (`tones[1]`); if the board also uses a status color too close to it, `accent` is drawn in ink.

### Mermaid compatibility

- Render the ZenUML examples from Mermaid 12.3.0 as native KChart sequence diagrams, including participant annotations, aliases, nested calls and activations, replies, creation, comments, and fragments. No runtime plugin is required.
- Mermaid `radar-beta` supports 1–24 axes with measured label spacing and hints for degenerate or scrolling charts. Native radar remains limited to 3–6 dimensions. Mermaid `info` displays the current KChart package version.
- Header near misses suggest the supported keyword (for example `eventmodeling` for `eventmodeling-beta`), and Gantt reports tasks accidentally combined on one line.
- Block, railroad, Wardley, and ZenUML diagnostics give localized, specific fixes, including examples of valid syntax.

### Layout fixes

- Flowcharts with subgraphs stack their stages on a shared axis. Edges leave and enter nodes without hooking around the endpoint, with fewer jogs and crossings.
- Class member text keeps clear of compartment dividers. C4 relationship captions stay off boundary borders, and a caption moved aside never has a leader line crossing a card or title.
- Git commit captions prefer breaking at spaces and punctuation. Bilateral mindmaps move branches between sides only when that strictly improves the balance.
- Sankey labels lose their halo, and CJK quadrant y-axis labels stand upright. The fallback text measurer counts fullwidth forms as fullwidth glyphs.
- A map given by name alone (`"map": "world"`) is rejected with the accepted shapes in the message: `{"asset": "world"}`, `{"asset": "us-states"}` or an external GeoJSON with `idProperty`.
- A geo-scatter map without a value field lists its places by name directly below the map, instead of leaving room for a size legend and marking every place "no value".

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
