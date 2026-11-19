import type { DiagramDiagnostic, RenderOptions } from './index.js';

export type MermaidOptions = Omit<RenderOptions, 'assets'>;
export interface MermaidError extends Error { diagnostics: DiagramDiagnostic[] }
export interface MermaidParseResult { diagramType: string }
export interface MermaidRenderResult extends MermaidParseResult {
  svg: string;
  diagnostics: DiagramDiagnostic[];
}

export function initialize(config?: MermaidOptions): void;
export function render(id: string, text: string, options?: MermaidOptions): Promise<MermaidRenderResult>;
export function parse(text: string, options?: { suppressErrors?: false }): Promise<MermaidParseResult>;
export function parse(text: string, options: { suppressErrors?: boolean }): Promise<MermaidParseResult | false>;
export function detectType(text: string): string;
