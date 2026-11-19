import * as color from '../../../../vendor/kchart/esm/core/color.js';
import { FONT_FAMILY, structureRoles, theme as validateTheme } from '../../../../vendor/kchart/esm/node.js';
import { fail } from '../../shared/output.mjs';
import { structureProperties } from '../../shared/themes.mjs';

// UI has its own surfaces and text roles: a built-in reading theme can be edited without changing a prototype.
const UI_BASE = {
  light: {
    bg: '#ffffff', surface: '#f9fafc', surface2: '#f3f4f6', line: '#e5e6e8', line2: '#d2d3d5',
    fg1: '#18191d', fg2: '#35373b', fg3: '#54575b', fg4: '#686a6f',
    new: '#72579d', info: '#00738e', ok: '#307944', warn: '#905908', danger: '#a83634', ext: '#54575b',
  },
  dark: {
    bg: '#111114', surface: '#111114', surface2: '#19181b', line: '#202023', line2: '#303033',
    fg1: '#e8e7ec', fg2: '#cdcdd1', fg3: '#a6a5aa', fg4: '#8d8d91',
    new: '#c8aadb', info: '#8fbde5', ok: '#89c7ab', warn: '#d2b281', danger: '#e29c9b', ext: '#a6a5aa',
  },
};

const UI_SERIES_FALLBACKS = {
  light: ['#23272c', '#2769c6', '#575b62', '#0e3163', '#7c8088', '#6e92c6'],
  dark: ['#e1e0e8', '#afaff6', '#98979e', '#8080b5', '#636269', '#5d58a6'],
};
// 固定已发布的 UI 自动配色及同分时的候选顺序。具名文档主题的色值改动不会影响这里。
const UI_SERIES_CANDIDATES = [
  '#2a2621', '#bb5a35', '#5f5a55', '#54220e', '#847f7a', '#b67f6b',
  ...UI_SERIES_FALLBACKS.light,
  ...UI_SERIES_FALLBACKS.dark,
  '#d9e1f6', '#81aaf7', '#9198ab', '#6686c0', '#61687a', '#3966bc',
  '#e8e1d1', '#d4b771', '#9e9889', '#99844f', '#716b5e', '#866700',
  '#d8e5da', '#6de18b', '#909c92', '#439b5b', '#5c675d', '#007232',
  '#261e1e', '#cc3a2b', '#6a6160', '#6d2325', '#948b8a', '#b37a6c',
];

export const DEFAULTS = Object.freeze({
  fidelity: 'mockup', brand: '#2f6fed', scheme: 'light', radius: 8, density: 'regular',
});
export const DEVICES = Object.freeze(['mobile', 'desktop', 'responsive']);
export const FIDELITIES = Object.freeze(['wireframe', 'mockup']);
export const SCHEMES = Object.freeze(['light', 'dark']);
export const DENSITIES = Object.freeze(['compact', 'regular']);
export const LANG_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

const failValue = (name, value) => fail('BAD_VALUE', `${name} 的取值不合法：${String(value)}`, { next: `检查 ${name} 的允许值并重试。` });

export function normalizeBrand(value) {
  const raw = String(value ?? '');
  if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(raw)) return failValue('brand', value);
  const hex = raw.slice(1).length === 3 ? raw.slice(1).split('').map((c) => c + c).join('') : raw.slice(1);
  return `#${hex.toLowerCase()}`;
}
export function normalizeLang(value = 'zh') {
  const raw = String(value).trim();
  if (!LANG_RE.test(raw)) return failValue('lang', value);
  const parts = raw.split('-');
  parts[0] = parts[0].toLowerCase();
  for (let i = 1; i < parts.length; i += 1) {
    if (/^[a-z]{2}$/i.test(parts[i]) || /^\d{3}$/.test(parts[i])) parts[i] = parts[i].toUpperCase();
  }
  return parts.length === 1 && parts[0] === 'zh' ? 'zh-CN' : parts.join('-');
}
export function normalizeDevice(value) {
  if (!DEVICES.includes(value)) return failValue('device', value);
  return value;
}
export function normalizeDesign(input = {}) {
  const design = {
    fidelity: input.fidelity ?? DEFAULTS.fidelity,
    brand: normalizeBrand(input.brand ?? DEFAULTS.brand),
    scheme: input.scheme ?? DEFAULTS.scheme,
    radius: Number(input.radius ?? DEFAULTS.radius),
    density: input.density ?? DEFAULTS.density,
  };
  if (!FIDELITIES.includes(design.fidelity)) failValue('fidelity', design.fidelity);
  if (!SCHEMES.includes(design.scheme)) failValue('scheme', design.scheme);
  if (!DENSITIES.includes(design.density)) failValue('density', design.density);
  if (!Number.isInteger(design.radius) || design.radius < 0 || design.radius > 16) failValue('radius', input.radius);
  return design;
}

function toneCandidates(scheme, fidelity) {
  if (fidelity !== 'wireframe') return UI_SERIES_CANDIDATES;
  const neutral = scheme === 'light' ? '#666666' : '#aaaaaa';
  // 线框稿保留多系列区分，但不让自动配色挑到容易被误读成告警的红棕色。
  return UI_SERIES_CANDIDATES.filter((hex) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return r <= Math.max(g, b);
  }).map((hex) => color.mix(hex, neutral, 0.55));
}
function candidateScore(candidate, selected) {
  return Math.min(...selected.map((chosen) => color.deltaE2000(candidate, chosen)));
}
function seriesFor(accent, surface, scheme, fidelity) {
  const candidates = [...new Set([accent, ...toneCandidates(scheme, fidelity)])]
    .filter((hex) => color.contrast(hex, surface) >= 3);
  const chosen = [accent];
  while (chosen.length < 6) {
    let best = null;
    for (const hex of candidates) {
      if (chosen.includes(hex)) continue;
      const separation = candidateScore(hex, chosen);
      const colorBlind = chosen.slice(0, 2).every((used) => ['protan', 'deutan']
        .every((type) => color.deltaE2000(color.simulateCvd(hex, type), color.simulateCvd(used, type)) >= 15));
      const required = chosen.length < 3 ? 15 : 12;
      if (separation >= required && (chosen.length >= 3 || colorBlind)
        && (!best || separation > best.separation)) best = { hex, separation };
    }
    if (!best) return null;
    chosen.push(best.hex);
  }
  return chosen;
}

function makeTheme(scheme, design, adjusted) {
  const base = UI_BASE[scheme];
  const { surface } = base;
  const rawBrand = design.fidelity === 'wireframe' ? '#4b5563' : design.brand;
  const accent = color.pushContrast(rawBrand, scheme === 'light' ? '#111111' : '#ffffff', surface, 3);
  if (accent !== rawBrand) adjusted.push({ token: 'accent', scheme, from: rawBrand, to: accent, reason: '主色对 surface 的非文字对比度低于 3:1，按 core/color 调整' });
  const tones = seriesFor(accent, surface, scheme, design.fidelity) ?? UI_SERIES_FALLBACKS[scheme];
  const item = {
    ...base,
    id: `ui-${scheme}`,
    scheme,
    fontFamily: FONT_FAMILY,
    accent,
    danger: design.fidelity === 'wireframe' ? base.fg2 : base.danger,
    tones,
  };
  // core/theme performs the authoritative contrast, ΔE2000 and color-vision checks.
  return validateTheme(item);
}

const CSS_ROLES = Object.freeze({
  bg: 'bg', surface: 'surface', 'surface-2': 'surface2', line: 'line', 'line-strong': 'line2',
  'fg-1': 'fg1', 'fg-2': 'fg2', 'fg-3': 'fg3', 'fg-4': 'fg4', accent: 'accent',
  ok: 'ok', warn: 'warn', danger: 'danger', info: 'info',
});
// Keep the published dark-mockup print colors even if the named Paper theme is edited.
export const darkMockupPrint = validateTheme({ ...UI_BASE.light, id: 'ui-dark', scheme: 'light', fontFamily: FONT_FAMILY,
  accent: '#245fd4', tones: UI_SERIES_FALLBACKS.light });

function cssFor(theme, design, scheme, adjusted) {
  const accentSoft = color.mix(theme.surface, theme.accent, scheme === 'light' ? 0.12 : 0.2);
  const accentForeground = color.contrast('#ffffff', accentSoft) > color.contrast('#111111', accentSoft) ? '#ffffff' : '#111111';
  const accentText = color.pushContrast(theme.accent, accentForeground, accentSoft, 4.5);
  if (accentText !== theme.accent) adjusted.push({ token: 'accent-text', scheme, from: theme.accent, to: accentText, reason: '主色文字对 accent-soft 的对比度低于 4.5:1，按 core/color 调整' });
  const lines = [`:root[data-scheme="${scheme}"] {`, `  color-scheme: ${scheme};`];
  for (const [token, key] of Object.entries(CSS_ROLES)) lines.push(`  --${token}: ${theme[key]};`);
  lines.push(
    `  --on-accent: ${color.contrast('#ffffff', theme.accent) >= 4.5 ? '#ffffff' : '#111111'};`,
    `  --accent-soft: ${accentSoft};`,
    `  --accent-text: ${accentText};`,
    `  --focus: ${theme.accent};`,
    `  --ok-soft: ${color.mix(theme.surface, theme.ok, scheme === 'light' ? 0.09 : 0.14)};`,
    `  --warn-soft: ${color.mix(theme.surface, theme.warn, scheme === 'light' ? 0.09 : 0.14)};`,
    `  --danger-soft: ${color.mix(theme.surface, theme.danger, scheme === 'light' ? 0.09 : 0.14)};`,
    `  --info-soft: ${color.mix(theme.surface, theme.info, scheme === 'light' ? 0.09 : 0.14)};`,
    `  --overlay: ${scheme === 'light' ? 'rgba(15, 23, 42, 0.46)' : 'rgba(0, 0, 0, 0.62)'};`,
    `  --shadow-1: ${scheme === 'light' ? '0 1px 3px rgba(16,24,40,.1)' : '0 1px 3px rgba(0,0,0,.45)'};`,
    `  --shadow-2: ${scheme === 'light' ? '0 8px 24px rgba(16,24,40,.12)' : '0 12px 32px rgba(0,0,0,.55)'};`,
    `  --radius: ${design.radius}px;`,
    `  --control-h: ${design.density === 'compact' ? 32 : 40}px;`,
    `  --gap: ${design.density === 'compact' ? 8 : 12}px;`,
    `  --font: ${theme.fontFamily};`,
    `  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;`,
  );
  const tones = theme.tones.map((hex) => design.fidelity === 'wireframe'
    ? color.mix(hex, scheme === 'light' ? '#666666' : '#bbbbbb', 0.55) : hex);
  tones.forEach((hex, index) => lines.push(`  --viz-${index + 1}: ${hex};`));
  for (const [token, value] of Object.entries(structureProperties(structureRoles({ theme, tones })))) {
    lines.push(`  ${token}: ${value};`);
  }
  lines.push('}');
  return lines.join('\n');
}

export function generateTokens(input = {}) {
  const design = normalizeDesign(input);
  const adjusted = [];
  const light = makeTheme('light', design, adjusted);
  const dark = makeTheme('dark', design, adjusted);
  return {
    design,
    adjusted,
    themes: { light, dark },
    css: [cssFor(light, design, 'light', adjusted), cssFor(dark, design, 'dark', adjusted)].join('\n'),
  };
}
