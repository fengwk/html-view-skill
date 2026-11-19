import type { DiagramDiagnostic, RenderOptions } from './index.js';

export type MermaidOptions = Omit<RenderOptions, 'assets'>;
export interface MermaidError extends Error { diagnostics: DiagramDiagnostic[] }
/** `diagnostics` holds only warnings: any error rejects instead. */
export interface MermaidParseResult { diagramType: string; diagnostics: DiagramDiagnostic[] }
export interface MermaidRenderResult extends MermaidParseResult { svg: string }

export function initialize(config?: MermaidOptions): void;
export function render(id: string, text: string, options?: MermaidOptions): Promise<MermaidRenderResult>;
export function parse(text: string, options?: { suppressErrors?: false }): Promise<MermaidParseResult>;
export function parse(text: string, options: { suppressErrors?: boolean }): Promise<MermaidParseResult | false>;
export function detectType(text: string): string;
