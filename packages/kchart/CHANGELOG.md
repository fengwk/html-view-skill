# Changelog

## 0.1.0

- First npm release with an asynchronous browser/Node ESM API, on-demand chart and diagram families, and separately loaded built-in maps.
- Added Mermaid 12.3.0 core compatibility, verified on 525 examples at 800 px and 360 px with geometry checks. The external ZenUML plugin is not supported.
- Added the Mermaid-style `initialize`, `render`, `parse`, and `detectType` facade, as named exports and as a default export like Mermaid's own. Mermaid's settings such as `startOnLoad` are accepted and have no effect; a Mermaid theme name such as `dark` falls back to the default theme with an `IGNORED_CONFIG` warning. Diagram diagnostics distinguish blocking errors from non-blocking warnings.
- Added theme-based style colors, safe links without callback execution, and support for host-registered Iconify icon sets.
- Exposed the synchronous Node API at `@fengwk/kchart/node`; all three entry points ship TypeScript declarations.
