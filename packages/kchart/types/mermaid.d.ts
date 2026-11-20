import type { DiagramDiagnostic, RenderOptions } from './index.js';

/**
 * KChart render options. Mermaid's own settings (`startOnLoad`, `securityLevel`, `flowchart`, ...) are accepted
 * and have no effect; a Mermaid theme name such as `dark` is replaced by the KChart default with a warning.
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
