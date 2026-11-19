import { themes as KTHEMES, theme as resolveTheme, DEFAULT_THEME, defaultStyle, structureRoles } from '../../../vendor/kchart/esm/node.js';
import { readAsset } from './assets.mjs';

const builtins = Object.values(KTHEMES);
const tokens = {
  bg: 'bg', surface: 'surface', surface2: 'surface-2', line: 'line', line2: 'line-2',
  fg1: 'fg-1', fg2: 'fg-2', fg3: 'fg-3', fg4: 'fg-4', accent: 'accent', new: 'new', info: 'info',
  ok: 'ok', warn: 'warn', danger: 'danger', ext: 'ext',
};
const variable = (role) => `var(--${tokens[role] ?? `viz-${role.at(-1)}`})`;
const declarations = (properties) => Object.entries(properties).map(([key, value]) => `${key}:${value}`).join(';');
const styleTokens = {
  radius: ['radius', (value) => `${value}px`], smallRadius: ['radius-sm', (value) => `${value}px`],
  soft: ['soft', (value) => `${Number((100 * value).toFixed(4))}%`],
  blockBackground: ['block-bg', (value) => value === 'transparent' ? value : variable(value)],
  nodeBackground: ['node-bg', variable], codeBackground: ['code-bg', (value) => value === 'node' ? 'var(--node-bg)' : variable(value)],
  displayFont: ['font-display', (value) => value === 'sans' ? 'var(--font-sans)' : value], displayWeight: ['display-weight', String],
  numberFont: ['font-num', (value) => `var(--font-${value})`], numberStyle: ['num-style', String],
  numberColor: ['num-color', variable], listMarker: ['accent-mark', variable],
};
const styleProperties = (style, base = {}) => Object.fromEntries(Object.entries(styleTokens)
  .filter(([key]) => style[key] !== undefined && style[key] !== base[key])
  .map(([key, [token, format]]) => [`--${token}`, format(style[key])]));

function palette(theme) {
  return {
    ...Object.fromEntries(Object.entries(tokens).map(([role, token]) => [`--${token}`, theme[role]])),
    '--viz-fg': theme.fg1, '--viz-muted': theme.fg3, '--viz-grid': theme.line,
    '--viz-axis': theme.line2, '--viz-target': theme.fg3, '--viz-bg': theme.surface,
    ...Object.fromEntries(theme.tones.map((color, index) => [`--viz-${index + 1}`, color])),
  };
}
export function structureProperties({ colors, radius, smallRadius, fontFamily }) {
  return {
    ...Object.fromEntries(Object.entries(colors).map(([role, value]) => [`--viz-${role}`, value])),
    '--viz-radius': `${radius}px`, '--viz-radius-sm': `${smallRadius}px`, '--viz-font': fontFamily,
  };
}

export function themeCss(theme, media = 'screen') {
  const value = resolveTheme(theme, { media });
  const selector = `[data-theme="${value.id}"]`;
  const colors = declarations({ 'color-scheme': value.scheme, '--font-sans': value.fontFamily, ...palette(value), ...structureProperties(structureRoles({ theme, media })) });
  // Print colors must override even a later screen rule with the same theme id.
  if (media === 'print') return `${selector}[data-theme]{${colors}}`;
  const style = declarations(styleProperties(value.style, defaultStyle));
  return `${selector}{${colors}${style ? `;${style}` : ''}}`;
}

export function getTheme(id) {
  if (!Object.hasOwn(KTHEMES, id)) return null;
  const value = KTHEMES[id];
  return Object.freeze({ ...value, css: themeCss(value), default: id === DEFAULT_THEME });
}
export function listThemes() {
  return builtins.map(({ id, scheme, name, en, desc }) => ({ id, scheme, name, en, desc, default: id === DEFAULT_THEME }));
}
const printExtras = (theme) => {
  const value = resolveTheme(theme, { media: 'print' });
  return `[data-theme="${value.id}"]{--num-color:${value.fg4};--block-bg:${value.surface};--node-bg:${value.bg};--code-bg:${value.surface2}}`;
};
export function themesCss(custom) {
  const themes = custom ? [...builtins, custom] : builtins;
  const screen = themes.map((theme) => themeCss(theme)).join('\n');
  const print = themes.map((theme) => themeCss(theme, 'print')).join('\n');
  return `[data-theme]{${declarations(styleProperties(defaultStyle))}}\n${screen}\n@media print{${print}[data-theme]{color-scheme:light}}`;
}
export function readingCss(custom) {
  const base = readAsset('page/reading.css').replace('/* @print-palette */', '');
  const themes = custom ? [...builtins, custom] : builtins;
  return `${base}\n${themesCss(custom)}\n@media print{${themes.map(printExtras).join('\n')}}`;
}
