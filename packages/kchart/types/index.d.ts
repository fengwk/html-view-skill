export type Media = 'screen' | 'print';
export type Syntax = 'mermaid' | 'layers' | 'blocks' | 'swimlane';
export type Tones = readonly [string, string, string, string, string, string];
type Background = 'bg' | 'surface' | 'surface2';
type Status = 'new' | 'info' | 'ok' | 'warn' | 'danger' | 'ext';
type TextColor = 'fg1' | 'fg2' | 'fg3' | 'fg4';
type ColorRole = TextColor | Status | 'accent' | `tone${1 | 2 | 3 | 4 | 5 | 6}`;

export interface DiagramStyle {
  radius: number;
  smallRadius: number;
  soft: number;
  nodeBackground: Background;
}

export interface ThemeStyle extends DiagramStyle {
  blockBackground: Background | 'transparent';
  codeBackground: Background | 'node';
  displayFont: string;
  displayWeight: number;
  numberFont: 'sans' | 'mono';
  numberStyle: 'decimal' | 'decimal-leading-zero';
  numberColor: ColorRole;
  listMarker: ColorRole;
}

export type Theme = Readonly<Record<Background | TextColor | Status | 'line' | 'line2' | 'accent', string> & {
  id?: string;
  scheme: 'light' | 'dark';
  fontFamily: string;
  tones: Tones;
  name?: string;
  en?: string;
  desc?: string;
  frameInk?: string;
  tint?: Readonly<{ hue: number; chroma: number }>;
  style?: Readonly<Partial<ThemeStyle>>;
  diagram?: Readonly<Partial<DiagramStyle>>;
}>;

export interface ChartSpec {
  chart: string;
  [field: string]: unknown;
}

export interface RenderOptions {
  width?: number;
  lang?: string;
  theme?: string | Theme;
  media?: Media;
  /** Draw the outer frame and its title (default true). With false the host shows the title; see Scene.heading. */
  frame?: boolean;
  prefix?: string;
  measure?: (text: string, size: number, weight: number, fontFamily: string) => number;
  assets?: Record<string, unknown>;
}

export interface CheckOptions { syntax?: Syntax; lang?: string }
export interface DiagramOptions extends RenderOptions { syntax?: Syntax; compact?: boolean }
export interface ChartDiagnostic {
  code: string;
  message: string;
  fix: string;
  path?: string;
  location?: { offset: number; line: number; column: number };
}
export interface DiagramDiagnostic {
  code: string;
  message: string;
  fix: string;
  line: number;
  column: number;
  topic: string;
  /** Errors block rendering; warnings accompany a rendered SVG. */
  severity: 'error' | 'warning';
}

export interface SceneNode {
  tag: string;
  attrs: Record<string, unknown>;
  children?: SceneNode[];
  text?: string;
  meta?: Record<string, unknown>;
}

export interface Scene {
  width: number;
  height: number;
  children: SceneNode[];
  title?: string;
  /** Visible diagram title. With frame: false (and no compact) the drawing leaves it out for the host to show. */
  heading?: string;
  subtitle?: string;
  source?: string;
  note?: string;
  overflow?: { left: number; top: number; right: number; bottom: number };
}

export type RenderResult<D = ChartDiagnostic> =
  | { svg: string; scene: Scene; diagnostics: D[] }
  | { svg: null; scene: null; diagnostics: D[] };

export interface DiagramType {
  readonly kind: string;
  readonly syntax: Syntax;
  readonly topic: string;
  readonly aliases: readonly string[];
}

export interface ChartType {
  readonly name: string;
  readonly shape: string;
  readonly required: readonly string[];
  readonly optional: readonly string[];
  readonly special: Readonly<Record<string, string | readonly string[]>>;
  readonly arrayRoles: readonly string[];
  readonly encodeForms: readonly (readonly string[])[];
  readonly requiredSpecial: readonly string[];
}

export function render(spec: ChartSpec, options?: RenderOptions): Promise<RenderResult>;
export function diagram(source: string, options?: DiagramOptions): Promise<RenderResult<DiagramDiagnostic>>;
export function check(source: string, options?: CheckOptions): Promise<DiagramDiagnostic[]>;
export function theme(idOrObject?: string | Theme, options?: { media?: Media }): Theme;
export const themes: Readonly<Record<string, Theme>>;
export const catalog: Readonly<Record<string, ChartType>>;
export const diagramTypes: readonly DiagramType[];

/** Register Iconify geometry process-wide; a later registration replaces the same prefix:name. */
export function registerIcons(iconifyJson: {
  prefix: string;
  icons: Record<string, { body: string; width?: number; height?: number }>;
  width?: number;
  height?: number;
}): void;
