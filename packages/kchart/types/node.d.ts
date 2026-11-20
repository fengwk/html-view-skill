import type {
  ChartDiagnostic, ChartSpec, CheckOptions, DiagramDiagnostic, DiagramOptions, Media,
  RenderOptions, RenderResult, Scene, Syntax, Theme, ThemeStyle, Tones,
} from './index.js';
export type * from './index.js';
export { catalog, diagramTypes, registerIcons, theme, themes } from './index.js';

export function render(spec: ChartSpec, options?: RenderOptions): RenderResult;
export function diagram(source: string, options?: DiagramOptions): RenderResult<DiagramDiagnostic>;
export function check(source: string, options?: CheckOptions): DiagramDiagnostic[];
export interface Validation {
  errors: ChartDiagnostic[];
  data: Record<string, unknown> | null;
}
export function parse(text: string): Validation;
export function validate(spec: unknown): Validation;
export function schema(chart?: string): Record<string, unknown>;
export interface DataTable {
  columns: { key: string; label: string }[];
  rows: { text: string; value: unknown }[][];
}
export function dataTable(spec: ChartSpec, options?: RenderOptions): DataTable | null;

export type ThemeConfig = Partial<Theme> & { id: string; extends?: string; order?: number };
export function resolveThemeConfig(config: ThemeConfig): Theme;
export function validateThemeSnapshot(config: Theme): Theme;
export const DEFAULT_THEME: 'claude';
export const FONT_FAMILY: string;
export const defaultStyle: Readonly<ThemeStyle>;
export function structureRoles(options?: { theme?: string | Theme; media?: Media; tones?: Tones }): Readonly<{
  colors: Readonly<Record<string, string>>;
  radius: number;
  smallRadius: number;
  fontFamily: string;
}>;

export interface DiagramDeclaration { source: string; syntax?: Syntax }
export type Declaration = ChartSpec | DiagramDeclaration;
export function modulesFor(specs?: readonly Declaration[]): string[];
export function browserSource(specs?: readonly Declaration[]): string;
export function runtimeSource(): string;
export function detectSyntax(source: string): Syntax;

type ReadMap = (file: string) => string;
interface SharedRenderer {
  readonly theme: typeof import('./index.js').theme;
  readonly themes: typeof import('./index.js').themes;
  bundleSource(): string;
}
export interface DiagramRenderer extends SharedRenderer {
  diagram: typeof diagram;
  check: typeof check;
  readonly diagramTypes: typeof import('./index.js').diagramTypes;
}
export interface ChartRenderer extends SharedRenderer, Partial<Pick<DiagramRenderer, 'diagram' | 'check' | 'diagramTypes'>> {
  parse: typeof parse;
  validate: typeof validate;
  schema: typeof schema;
  render: typeof render;
  dataTable: typeof dataTable;
  palette(theme?: string | Theme): Record<string, string>;
  readonly catalog: typeof import('./index.js').catalog;
  readonly layouts: ReadonlyMap<string, (spec: ChartSpec, context: Record<string, unknown>) => Scene>;
  assets(spec: ChartSpec): Record<string, unknown> | undefined;
}
export function createRenderer(options: { sources: readonly (string | DiagramDeclaration)[]; specs?: undefined; readMap?: ReadMap }): DiagramRenderer;
export function createRenderer(options?: { specs?: readonly Declaration[]; sources?: undefined; readMap?: ReadMap }): ChartRenderer;
export function createRenderer(options: { specs: readonly Declaration[]; sources?: readonly (string | DiagramDeclaration)[]; readMap?: ReadMap }): ChartRenderer;
