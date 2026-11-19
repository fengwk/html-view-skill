import { parseArgs } from '../shared/args.mjs';
import { emit, fail } from '../shared/output.mjs';
import { listThemes } from '../shared/themes.mjs';
import { createRenderer } from '../../../kchart/node.mjs';

const USAGE = 'htmlview viz palette [--theme <id>]';
const ROLE_META = {
  ink: ['viz-1', '首要文字与基准序列色'], accent: ['viz-2', '强调色与第二序列色'],
  tone1: ['viz-1', '第一序列色'], tone2: ['viz-2', '第二序列色'], tone3: ['viz-3', '第三序列色'],
  tone4: ['viz-4', '第四序列色'], tone5: ['viz-5', '第五序列色'], tone6: ['viz-6', '第六序列色'],
  fg: ['viz-fg', '前景文字色'], muted: ['viz-muted', '次级文字色'], bg: ['viz-bg', '画布背景色'],
  grid: ['viz-grid', '网格线色'], axis: ['viz-axis', '坐标轴线色'],
};

export async function run(argv) {
  const { values } = parseArgs(argv, {
    theme: { type: 'string', default: 'claude' },
  }, { positionals: [0, 0], usage: USAGE });
  const themes = listThemes();
  const themeIds = Array.isArray(themes)
    ? themes.map((item) => typeof item === 'string' ? item : item.id)
    : Object.keys(themes);
  if (!themeIds.includes(values.theme)) fail('USAGE', `未知主题：${values.theme}`, { next: `可用主题：${themeIds.join('、')}` });
  const palette = createRenderer().palette(values.theme);
  const roles = Object.entries(palette).map(([role, value]) => {
    const [variable, purpose] = ROLE_META[role];
    return { role, cssVariable: `--${variable}`, value, purpose };
  });
  const svgSkeleton = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180" font-family="system-ui, sans-serif"><rect width="320" height="180" fill="${palette.bg}"/><text x="16" y="28" fill="${palette.fg}">Chart title</text><line x1="16" y1="48" x2="304" y2="48" stroke="${palette.grid}"/><rect x="24" y="70" width="64" height="80" fill="${palette.accent}"/><text x="104" y="110" fill="${palette.muted}">Series</text></svg>`;
  emit({ theme: values.theme, palette, roles, svgSkeleton });
}
