# Changelog

## Unreleased

- Center the full content block horizontally in Event Modeling frames while keeping payload rows left-aligned within it.
- In combo charts, keep lines and points above columns, and use a thin local outline only where a line overlaps a low-contrast column.

## 0.1.1

- Center the title and payload together inside Event Modeling frames, with equal space above and below.
- Draw Venn labels directly on the set and intersection fills, without label backplates or halos. Keep text clear of ring outlines and move labels below the diagram only when they cannot fit.

## 0.1.0

- First npm release with an asynchronous browser/Node ESM API, on-demand chart and diagram families, and separately loaded built-in maps.
- Added Mermaid 12.3.0 core compatibility, verified on 525 examples at 800 px and 360 px with geometry checks. Each core diagram's canonical name is the keyword Mermaid 12.3.0 parses, such as `architecture-beta`; other accepted spellings are aliases. The external ZenUML plugin is not supported.
- Added the Mermaid-style `initialize`, `render`, `parse`, and `detectType` facade, as named exports and as a default export like Mermaid's own. Mermaid settings are checked like the diagram's front-matter config, which overrides them: supported settings such as `c4.c4ShapeInRow` apply, runtime settings such as `startOnLoad` pass silently, and the rest, such as `themeVariables` or the theme name `dark`, produce one `IGNORED_CONFIG` warning. Diagram diagnostics distinguish blocking errors from non-blocking warnings.
- Added theme-based style colors, safe links without callback execution, and support for host-registered Iconify icon sets.
- Exposed the synchronous Node API at `@fengwk/kchart/node`; all three entry points ship TypeScript declarations.
