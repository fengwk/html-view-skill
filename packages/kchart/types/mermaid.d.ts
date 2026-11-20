import type { DiagramDiagnostic, RenderOptions } from './index.js';

/**
 * KChart render options, plus Mermaid settings. A Mermaid setting is checked like a `config` in the diagram's front
 * matter, which overrides it: supported settings such as `c4.c4ShapeInRow` apply, runtime settings such as
 * `startOnLoad` pass silently, and the rest, such as `themeVariables` or the theme name `dark`, produce one
 * `IGNORED_CONFIG` warning.
 */
export type MermaidOptions = Omit<RenderOptions, 'assets'> & { [setting: string]: unknown };
export interface MermaidError extends Error { diagnostics: DiagramDiagnostic[] }
/** `diagnostics` holds only warnings: any error rejects instead. */
export interface MermaidParseResult { diagramType: string; diagnostics: DiagramDiagnostic[] }
export interface MermaidRenderResult extends MermaidParseResult { svg: string }

export function initialize(config?: MermaidOptions): void;
export function render(id: string, text: string, options?: MermaidOptions): Promise<MermaidRenderResult>;
export function parse(text: string, options?: { suppressErrors?: false }): Promise<MermaidParseResult>;
export function parse(text: string, options: { suppressErrors?: boolean }): Promise<MermaidParseResult | false>;
export function detectType(text: string): string;

/** The same four functions, for `import mermaid from '@fengwk/kchart/mermaid'`. */
declare const mermaid: {
  initialize: typeof initialize;
  render: typeof render;
  parse: typeof parse;
  detectType: typeof detectType;
};
export default mermaid;
