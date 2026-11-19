# HTML View

**Let your agent deliver readable HTML reliably: documents, data reports, dashboards and clickable prototypes.**

[简体中文](README.md) · English

Give your agent Markdown, pre-aggregated CSV/JSON or a product flow, and it hands back **one HTML file that works offline**. Charts, themes and interactions are embedded in the file: no server to run, nothing fetched from the network. Before handing it over, the agent opens it in a real browser to check narrow screens and the printed page, and exports PDF or PNG when you need one.

[Quick start](#quick-start) · [What you get](#showcase) · [**45 data charts and 30 diagrams**](#gallery) · [Six themes](#themes) · [Install details](#install) · [Update and uninstall](#update-uninstall)

<p align="center"><a href="docs/showcase/previews/en/dashboard-hero.png"><picture><source media="(max-width: 600px)" srcset="docs/showcase/previews/en/dashboard-mobile.png"><img src="docs/showcase/previews/en/dashboard-hero.png" width="840" alt="Fictional coffee operations dashboard in the warm Claude theme: four KPI cards, a revenue trend and a channel comparison"></picture></a></p>

*A generated dashboard: two columns on wide screens, one column on phones. Channel views switch offline; all sample data is fictional.*

<a id="quick-start"></a>

## Quick start

**1. Install.** You need Git and Node.js 22+. Download the script, read it, then run it:

```bash
# macOS / Linux / WSL
curl -fsSL --proto '=https' -o install-html-view.sh https://raw.githubusercontent.com/fengwk/html-view-skill/main/scripts/install.sh
bash ./install-html-view.sh
```

```powershell
# Windows PowerShell
Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/fengwk/html-view-skill/main/scripts/install.ps1' -OutFile '.\install-html-view.ps1'
.\install-html-view.ps1
```

**2. Restart your agent.** `html-view` shows up in the skill list of Codex, Pi and Claude Code. For other agents, see [Install details](#install).

**3. Ask for the HTML you need.** For example:

> Use HTML View to turn `proposal.md` into a technical design reviewers can comment on. Keep the decisions and risks, and draw the call chain between services. Deliver the HTML and a checked PDF.

> Turn these pre-aggregated CSV files into an offline dashboard. The first screen should show the key metrics, the revenue trend and the channel differences. Every number should open into rows I can check, and missing values must not become 0.

> Build a clickable expense-claim prototype with a list, a detail page, and failed and successful submission states. Walk through the submit flow at phone width.

After generating the HTML, the agent runs `htmlview audit` on its content and resources, then `htmlview check` to open it at desktop width, phone width and on the printed page. Screenshots, PDF export and standalone charts need Chrome or Chromium on the machine (set `CHROME_PATH` if it isn't found).

The skill's own instructions are written in Chinese. Agents follow them fine, and the pages they produce use the language of your content: English input gives English headings, chart labels, number formats and PDF footers.

<a id="showcase"></a>

## What you get

| Output | What you can do with the file |
|---|---|
| Reading document | Jump from the table of contents, match numbered figures and tables to the text, comment on any passage; check the print layout and export PDF |
| Data report | Read month-over-month and year-over-year changes, open the underlying rows, check metric definitions, sources and raw values |
| Dashboard | Scan key metrics, trends and outliers on the first screen; switch between precomputed channel or region views without querying live data |
| Clickable prototype | Walk through screen changes, form validation, filters and state changes; no backend is called |

<table>
<tr><td width="50%"><strong>Reading document · Notification platform design</strong><br><a href="docs/showcase/previews/en/doc-reading.png"><img src="docs/showcase/previews/en/doc-reading.png" alt="Technical design in the Claude theme: table of contents on the left, scope table in the body" width="100%"></a></td><td width="50%"><strong>Data report · Shiguang Coffee monthly report</strong><br><a href="docs/showcase/previews/en/data-periodic.png"><img src="docs/showcase/previews/en/data-periodic.png" alt="Monthly operations report in the Claude theme: six KPIs with month-over-month and year-over-year changes, and the revenue trend" width="100%"></a></td></tr>
</table>

**Clickable prototype · Retention Watch**

<table>
<tr><td width="72%"><a href="docs/showcase/previews/en/ui-desktop-overview.png"><img src="docs/showcase/previews/en/ui-desktop-overview.png" alt="Retention Watch desktop overview: metrics, trend and status alert" width="100%"></a></td><td width="28%"><a href="docs/showcase/previews/en/ui-mobile-filtered.png"><img src="docs/showcase/previews/en/ui-mobile-filtered.png" alt="The same prototype on a phone, after filtering by channel and date" width="100%"></a></td></tr>
</table>

One prototype: the overview on desktop, the channel and date filters on a phone. Its colors come from `--brand` and `--scheme`.

[Sample sources and how to reproduce them →](docs/showcase/README.en.md)

<a id="gallery"></a>

## KChart gallery

Charts in HTML View are drawn by its bundled KChart library: **45 data charts, 38 controlled variants, 27 Mermaid subset diagrams, 3 native diagrams and 8 mind-map layouts**. Every one of them appears below as a real render in the Claude palette. Click an image to open the full-size SVG. Wide charts get their own row instead of shrinking their text to fit a grid.

[Build the full, filterable gallery →](docs/showcase/README.en.md#full-gallery)

<!-- gallery:begin -->
<a id="charts"></a>

### Data charts

[Trends over time](#trends) · [Comparisons, targets and ranges](#comparison) · [Parts of a whole and change](#composition) · [Distributions and correlation](#distribution) · [Matrices and many measures](#matrix) · [Hierarchies](#hierarchy) · [Networks, flows and paths](#relations) · [Maps](#geography)

<a id="trends"></a>

#### Trends over time

<p align="center"><a href="docs/showcase/gallery/en/trends-1.svg"><img src="docs/showcase/gallery/en/trends-1.svg" width="360" align="top" alt="Line, Sparkline, Streamgraph, Mirrored comparison"></a> <a href="docs/showcase/gallery/en/trends-2.svg"><img src="docs/showcase/gallery/en/trends-2.svg" width="360" align="top" alt="Stacked area, Small multiples, Open, close, high, low"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/trends-wide-1.svg"><img src="docs/showcase/gallery/en/trends-wide-1.svg" width="780" align="top" alt="Dual-axis combo, Rank changes"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/trends-wide-2.svg"><img src="docs/showcase/gallery/en/trends-wide-2.svg" width="780" align="top" alt="From launch to now"></a></p>

<a id="comparison"></a>

#### Comparisons, targets and ranges

<p align="center"><a href="docs/showcase/gallery/en/comparison-1.svg"><img src="docs/showcase/gallery/en/comparison-1.svg" width="360" align="top" alt="Bars, Before and after, Actual vs target"></a> <a href="docs/showcase/gallery/en/comparison-2.svg"><img src="docs/showcase/gallery/en/comparison-2.svg" width="360" align="top" alt="Columns, Slope, Progress"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/comparison-wide-1.svg"><img src="docs/showcase/gallery/en/comparison-wide-1.svg" width="780" align="top" alt="Range and median"></a></p>

<a id="composition"></a>

#### Parts of a whole and change

<p align="center"><a href="docs/showcase/gallery/en/composition-1.svg"><img src="docs/showcase/gallery/en/composition-1.svg" width="360" align="top" alt="Share bar, Donut, Rose, Waffle"></a> <a href="docs/showcase/gallery/en/composition-2.svg"><img src="docs/showcase/gallery/en/composition-2.svg" width="360" align="top" alt="Pie, Share and intensity, Funnel, Multiple-choice shares"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/composition-wide-1.svg"><img src="docs/showcase/gallery/en/composition-wide-1.svg" width="780" align="top" alt="Waterfall"></a></p>

<a id="distribution"></a>

#### Distributions and correlation

<p align="center"><a href="docs/showcase/gallery/en/distribution-1.svg"><img src="docs/showcase/gallery/en/distribution-1.svg" width="360" align="top" alt="Histogram, Scatter"></a> <a href="docs/showcase/gallery/en/distribution-2.svg"><img src="docs/showcase/gallery/en/distribution-2.svg" width="360" align="top" alt="Box plot, Violin"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/distribution-wide-1.svg"><img src="docs/showcase/gallery/en/distribution-wide-1.svg" width="780" align="top" alt="Strip plot"></a></p>

<a id="matrix"></a>

#### Matrices and many measures

<p align="center"><a href="docs/showcase/gallery/en/matrix-1.svg"><img src="docs/showcase/gallery/en/matrix-1.svg" width="360" align="top" alt="Heatmap"></a> <a href="docs/showcase/gallery/en/matrix-2.svg"><img src="docs/showcase/gallery/en/matrix-2.svg" width="360" align="top" alt="Bubble matrix"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/matrix-wide-1.svg"><img src="docs/showcase/gallery/en/matrix-wide-1.svg" width="780" align="top" alt="Radar, Parallel coordinates"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/matrix-wide-2.svg"><img src="docs/showcase/gallery/en/matrix-wide-2.svg" width="780" align="top" alt="Calendar"></a></p>

<a id="hierarchy"></a>

#### Hierarchies

<p align="center"><a href="docs/showcase/gallery/en/hierarchy-1.svg"><img src="docs/showcase/gallery/en/hierarchy-1.svg" width="360" align="top" alt="Treemap"></a> <a href="docs/showcase/gallery/en/hierarchy-2.svg"><img src="docs/showcase/gallery/en/hierarchy-2.svg" width="360" align="top" alt="Sunburst"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/hierarchy-wide-1.svg"><img src="docs/showcase/gallery/en/hierarchy-wide-1.svg" width="780" align="top" alt="Tree, Mind map"></a></p>

<a id="relations"></a>

#### Networks, flows and paths

<p align="center"><a href="docs/showcase/gallery/en/relations-1.svg"><img src="docs/showcase/gallery/en/relations-1.svg" width="360" align="top" alt="Network"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/relations-wide-1.svg"><img src="docs/showcase/gallery/en/relations-wide-1.svg" width="780" align="top" alt="Sankey, Path threads"></a></p>

<a id="geography"></a>

#### Maps

<p align="center"><a href="docs/showcase/gallery/en/geography-wide-1.svg"><img src="docs/showcase/gallery/en/geography-wide-1.png" width="780" align="top" alt="Choropleth, Points on a map"></a></p>

<a id="diagrams"></a>

### Diagrams

[Flows, states and journeys](#process) · [Sequences and data models](#model) · [Plans, boards and protocols](#planning) · [Architecture](#architecture) · [Five C4 views](#c4) · [Mermaid charts](#mermaid-data) · [One tree, eight mind-map layouts](#mindmaps)

<a id="process"></a>

#### Flows, states and journeys

<p align="center"><a href="docs/showcase/gallery/en/process-1.svg"><img src="docs/showcase/gallery/en/process-1.svg" width="360" align="top" alt="State diagram"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/process-wide-1.svg"><img src="docs/showcase/gallery/en/process-wide-1.svg" width="780" align="top" alt="Flowchart, Customer journey"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/process-wide-2.svg"><img src="docs/showcase/gallery/en/process-wide-2.svg" width="780" align="top" alt="Swimlanes"></a></p>

<a id="model"></a>

#### Sequences and data models

<p align="center"><a href="docs/showcase/gallery/en/model-1.svg"><img src="docs/showcase/gallery/en/model-1.svg" width="360" align="top" alt="ZenUML, Requirements"></a> <a href="docs/showcase/gallery/en/model-2.svg"><img src="docs/showcase/gallery/en/model-2.svg" width="360" align="top" alt="Class diagram"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/model-wide-1.svg"><img src="docs/showcase/gallery/en/model-wide-1.svg" width="780" align="top" alt="Sequence, ER diagram"></a></p>

<a id="planning"></a>

#### Plans, boards and protocols

<p align="center"><a href="docs/showcase/gallery/en/planning-wide-1.svg"><img src="docs/showcase/gallery/en/planning-wide-1.svg" width="780" align="top" alt="Gantt, Timeline"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/planning-wide-2.svg"><img src="docs/showcase/gallery/en/planning-wide-2.svg" width="780" align="top" alt="Git graph, Kanban"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/planning-wide-3.svg"><img src="docs/showcase/gallery/en/planning-wide-3.svg" width="780" align="top" alt="Packet layout, Quadrant chart"></a></p>

<a id="architecture"></a>

#### Architecture

<p align="center"><a href="docs/showcase/gallery/en/architecture-wide-1.svg"><img src="docs/showcase/gallery/en/architecture-wide-1.svg" width="780" align="top" alt="Layers, Blocks"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/architecture-wide-2.svg"><img src="docs/showcase/gallery/en/architecture-wide-2.svg" width="780" align="top" alt="Architecture, Block diagram"></a></p>

<a id="c4"></a>

#### Five C4 views

<p align="center"><a href="docs/showcase/gallery/en/c4-1.svg"><img src="docs/showcase/gallery/en/c4-1.svg" width="360" align="top" alt="Context, Dynamic"></a> <a href="docs/showcase/gallery/en/c4-2.svg"><img src="docs/showcase/gallery/en/c4-2.svg" width="360" align="top" alt="Containers"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/c4-wide-1.svg"><img src="docs/showcase/gallery/en/c4-wide-1.svg" width="780" align="top" alt="Components, Deployment"></a></p>

<a id="mermaid-data"></a>

#### Mermaid charts

<p align="center"><a href="docs/showcase/gallery/en/mermaid-data-1.svg"><img src="docs/showcase/gallery/en/mermaid-data-1.svg" width="360" align="top" alt="Pie, Radar"></a> <a href="docs/showcase/gallery/en/mermaid-data-2.svg"><img src="docs/showcase/gallery/en/mermaid-data-2.svg" width="360" align="top" alt="XY chart, Sankey, Treemap"></a></p>

<a id="mindmaps"></a>

#### One tree, eight mind-map layouts

<p align="center"><a href="docs/showcase/gallery/en/mindmaps-wide-1.svg"><img src="docs/showcase/gallery/en/mindmaps-wide-1.svg" width="780" align="top" alt="Mermaid mind map, Bilateral"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/mindmaps-wide-2.svg"><img src="docs/showcase/gallery/en/mindmaps-wide-2.svg" width="780" align="top" alt="Right, Left"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/mindmaps-wide-3.svg"><img src="docs/showcase/gallery/en/mindmaps-wide-3.svg" width="780" align="top" alt="Radial, Org chart"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/mindmaps-wide-4.svg"><img src="docs/showcase/gallery/en/mindmaps-wide-4.svg" width="780" align="top" alt="Brace, Fishbone"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/mindmaps-wide-5.svg"><img src="docs/showcase/gallery/en/mindmaps-wide-5.svg" width="780" align="top" alt="Timeline"></a></p>

<a id="variants"></a>

### Variants

[Bars, lines and marks](#variants-marks) · [Shares and stages](#variants-part) · [Targets, gaps and distributions](#variants-value) · [Matrices, calendars and networks](#variants-pattern)

<a id="variants-marks"></a>

#### Bars, lines and marks

<p align="center"><a href="docs/showcase/gallery/en/variants-marks-1.svg"><img src="docs/showcase/gallery/en/variants-marks-1.svg" width="360" align="top" alt="Bars · Solid, Bars · Lollipop, Columns · Unit rungs, Columns · Lollipop, Line · Barcode"></a> <a href="docs/showcase/gallery/en/variants-marks-2.svg"><img src="docs/showcase/gallery/en/variants-marks-2.svg" width="360" align="top" alt="Bars · Unit rungs, Columns · Solid, Columns · Pictogram, Line · Latest value"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/variants-marks-wide-1.svg"><img src="docs/showcase/gallery/en/variants-marks-wide-1.svg" width="780" align="top" alt="Bars · Pictogram"></a></p>

<a id="variants-part"></a>

#### Shares and stages

<p align="center"><a href="docs/showcase/gallery/en/variants-part-1.svg"><img src="docs/showcase/gallery/en/variants-part-1.svg" width="360" align="top" alt="Share bar · Solid, Donut · Solid, Funnel · Bars, Waffle · Open field"></a> <a href="docs/showcase/gallery/en/variants-part-2.svg"><img src="docs/showcase/gallery/en/variants-part-2.svg" width="360" align="top" alt="Share bar · Ticks, Donut · Ticks, Waffle · Dots"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/variants-part-wide-1.svg"><img src="docs/showcase/gallery/en/variants-part-wide-1.svg" width="780" align="top" alt="Funnel · Hourglass"></a></p>

<a id="variants-value"></a>

#### Targets, gaps and distributions

<p align="center"><a href="docs/showcase/gallery/en/variants-value-1.svg"><img src="docs/showcase/gallery/en/variants-value-1.svg" width="360" align="top" alt="Progress · Bar, Progress · Ticks, Before and after · Unit rungs, Histogram · Unit rungs, Scatter · Drop lines"></a> <a href="docs/showcase/gallery/en/variants-value-2.svg"><img src="docs/showcase/gallery/en/variants-value-2.svg" width="360" align="top" alt="Progress · Arc, Before and after · Solid, Histogram · Solid, Scatter · Dots"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/variants-value-wide-1.svg"><img src="docs/showcase/gallery/en/variants-value-wide-1.svg" width="780" align="top" alt="Waterfall · Solid, Waterfall · Unit rungs"></a></p>

<a id="variants-pattern"></a>

#### Matrices, calendars and networks

<p align="center"><a href="docs/showcase/gallery/en/variants-pattern-1.svg"><img src="docs/showcase/gallery/en/variants-pattern-1.svg" width="360" align="top" alt="Heatmap · Cells, Heatmap · Arc"></a> <a href="docs/showcase/gallery/en/variants-pattern-2.svg"><img src="docs/showcase/gallery/en/variants-pattern-2.svg" width="360" align="top" alt="Heatmap · Dots, Network · Lines, Network · Membrane"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/variants-pattern-wide-1.svg"><img src="docs/showcase/gallery/en/variants-pattern-wide-1.svg" width="780" align="top" alt="Calendar · Cells, Calendar · Dots"></a></p>

<p align="center"><a href="docs/showcase/gallery/en/variants-pattern-wide-2.svg"><img src="docs/showcase/gallery/en/variants-pattern-wide-2.svg" width="780" align="top" alt="Mind map · Editorial, Mind map · Cards"></a></p>
<!-- gallery:end -->

<a id="themes"></a>

## One chart, six themes

<!-- themes:begin -->
<p align="center"><a href="docs/showcase/gallery/en/themes-1.svg"><img src="docs/showcase/gallery/en/themes-1.svg" width="360" align="top" alt="Claude, Obsidian, Kanagawa"></a> <a href="docs/showcase/gallery/en/themes-2.svg"><img src="docs/showcase/gallery/en/themes-2.svg" width="360" align="top" alt="Paper, Tokyo Night, Terminal"></a></p>
<!-- themes:end -->

Switching the theme of a document or report leaves its content alone: `htmlview style report.html --theme obsidian`. The KChart API also accepts a custom theme object directly. To give the CLI a new theme name, register a palette and add a small theme CSS file; no chart code changes. [How themes work →](docs/architecture.en.md#themes)

<a id="install"></a>

## Install details

The installer clones the repository to `~/.agents/skill-lib/html-view-skill` and links its `skills/html-view` folder into two places:

| Link | Read by |
|---|---|
| `~/.agents/skills/html-view` | [Codex](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills), [Pi](https://docs.pi.dev/latest/skills) |
| `~/.claude/skills/html-view` | [Claude Code](https://code.claude.com/docs/en/skills#where-skills-live) |

Each tool chooses its own folder; the Agent Skills specification does not define a shared location. For other agents, link or copy `skills/html-view` into the folder they load skills from.

- **Safe to rerun.** A valid existing clone is reused and never pulled automatically. A broken clone or one from another origin is reported, not replaced. Each link is checked on its own, and an existing file, folder or broken link with the same name is left untouched.
- **Manual clones work too.** Clone to the location above, then run the script to add the links.
- **Native Windows** uses directory junctions instead of symbolic links. Whether each agent picks up a junction has not been tested on native Windows yet. WSL uses the `$HOME` of its Linux environment.
- **If PowerShell blocks the script** only because it came from the internet under `RemoteSigned`, check it, run `Unblock-File -LiteralPath '.\install-html-view.ps1'`, then run it again. You don't need to change the system policy.

<a id="update-uninstall"></a>

## Update and uninstall

**Update** by pulling the clone; both links keep pointing at it.

```bash
git -C "$HOME/.agents/skill-lib/html-view-skill" pull --ff-only
```

**Uninstall** by checking that both links point at this project, then removing them. Without `-r`, `rm` only removes a link; if a real folder sits there, it fails instead of deleting it.

```bash
readlink ~/.agents/skills/html-view ~/.claude/skills/html-view   # should end in …/html-view-skill/skills/html-view
rm ~/.agents/skills/html-view ~/.claude/skills/html-view
```

On Windows, remove each junction with `cmd /c rmdir "<path>"`; without `/s` it removes only the junction. Once nothing else uses the clone, move `~/.agents/skill-lib/html-view-skill` away. If the installer skipped an existing entry with the same name, that entry isn't part of this project, so keep it.

<a id="cli"></a>

## CLI and maintenance

From the repository root, build a sample document and check it:

```sh
node skills/html-view/scripts/htmlview doc build docs/showcase/examples/en/notification-platform.md --type tech-spec --out notification-platform.html
node skills/html-view/scripts/htmlview audit notification-platform.html
node skills/html-view/scripts/htmlview check notification-platform.html --paper a3-portrait
node skills/html-view/scripts/htmlview export notification-platform.html --format pdf --paper a3-portrait --out notification-platform.pdf
```

`check` uses a real browser to test narrow screens, overflow inside charts and the printed page. PDF export stops when something would be clipped instead of shrinking charts or text. Try A4 landscape for wide charts and A3 portrait for tall ones; if it still doesn't fit, rearrange the content or attach the full SVG. Before sharing HTML, check the metadata in its source: documents may record the Markdown source path, and reports embed their sources and calculation evidence.

Further reading, in Chinese: [skill entry](skills/html-view/SKILL.md) · [CLI and regression tests](skills/html-view/scripts/README.md) · [installer tests](scripts/tests/install.test.mjs) · [KChart API](skills/html-view/kchart/README.md) · [architecture and themes](docs/architecture.md) (the architecture notes also exist [in English](docs/architecture.en.md)).

<a id="license"></a>

## License

Original code and documentation are under the [MIT License](LICENSE). Prism keeps its [upstream MIT license](skills/html-view/assets/vendor/prism.js). Terms for icons, brand marks and Natural Earth map data are in the [third-party notice](skills/html-view/kchart/NOTICE.md).
