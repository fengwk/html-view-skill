import { themes as KTHEMES, theme as resolveTheme } from '../../../kchart/node.mjs';
import { readAsset } from './assets.mjs';

const ids = Object.freeze(Object.keys(KTHEMES));
const palette = (theme) => ({
  '--bg': theme.bg, '--surface': theme.surface, '--surface-2': theme.surface2,
  '--line': theme.line, '--line-2': theme.line2,
  '--fg-1': theme.fg1, '--fg-2': theme.fg2, '--fg-3': theme.fg3, '--fg-4': theme.fg4,
  '--accent': theme.accent, '--new': theme.new, '--info': theme.info, '--ok': theme.ok,
  '--warn': theme.warn, '--danger': theme.danger, '--ext': theme.ext,
  '--viz-fg': theme.fg1, '--viz-muted': theme.fg3, '--viz-grid': theme.grid ?? theme.line,
  '--viz-axis': theme.axis ?? theme.line2, '--viz-target': theme.fg3, '--viz-bg': theme.surface,
  ...Object.fromEntries(theme.tones.map((color, index) => [`--viz-${index + 1}`, color])),
});
const declaration = (theme) => Object.entries(palette(theme)).map(([key, value]) => `${key}:${value}`).join(';');
const themeCSS = (id, media = 'screen') => {
  const resolved = resolveTheme(id, { media });
  const attrs = [`color-scheme:${resolved.scheme}`, `--font-sans:${resolved.fontFamily}`];
  // Print tokens must beat the selected theme's later screen-only CSS declaration.
  const selector = media === 'print' ? `[data-theme="${id}"][data-theme]` : `[data-theme="${id}"]`;
  return `${selector}{${attrs.join(';')};${declaration(resolved)}}`;
};

export function getTheme(id) {
  if (!Object.hasOwn(KTHEMES, id)) return null;
  const value = resolveTheme(id);
  return Object.freeze({ ...value, css: `${themeCSS(id)}${readAsset(`themes/${id}.css`)}`, default: id === 'claude' });
}

export function listThemes() {
  return ids.map((id) => {
    const { id: _id, scheme, name, en, desc } = KTHEMES[id];
    return { id, scheme, name, en, desc, default: id === 'claude' };
  });
}

/** 主题颜色和图表变量都来自 KChart core/theme；打印重新按其正式规则解析。 */
export function themesCss() {
  const screen = ids.map((id) => `${themeCSS(id)}${readAsset(`themes/${id}.css`)}`).join('\n');
  const print = ids.map((id) => themeCSS(id, 'print')).join('\n');
  return `${screen}\n@media print{${print}[data-theme]{color-scheme:light}}`;
}

function printExtras() {
  return ids.map((id) => {
    const value = resolveTheme(id, { media: 'print' });
    return `[data-theme="${id}"]{--num-color:${value.fg4};--block-bg:${value.surface};--node-bg:${value.bg};--code-bg:${value.surface2}}`;
  }).join('\n');
}

export function readingCss() {
  const base = readAsset('page/reading.css').replace('/* @print-palette */', '');
  return `${base}\n${themesCss()}\n@media print{${printExtras()}}`;
}
