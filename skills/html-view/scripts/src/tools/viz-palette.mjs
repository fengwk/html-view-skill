import { parseArgs } from '../shared/args.mjs';
import { emit } from '../shared/output.mjs';
import { selectTheme, themeId, themeOptions, THEME_USAGE } from '../shared/theme-file.mjs';
import { createRenderer, structureRoles } from '../../../vendor/kchart/esm/node.js';
import { structureProperties } from '../shared/themes.mjs';

const USAGE = `htmlview viz palette ${THEME_USAGE}`;
// KChart 内部把第二序列色称为 accent；对外改叫 chartAccent，避免与主题 JSON 中的页面强调色 accent 混淆。
const ROLE_META = {
  ink: ['viz-1', '首要文字与基准序列色'], chartAccent: ['viz-2', '图内强调色，同第二序列色；页面链接和编号用主题的 accent'],
  tone1: ['viz-1', '第一序列色'], tone2: ['viz-2', '第二序列色'], tone3: ['viz-3', '第三序列色'],
  tone4: ['viz-4', '第四序列色'], tone5: ['viz-5', '第五序列色'], tone6: ['viz-6', '第六序列色'],
  fg: ['viz-fg', '前景文字色'], muted: ['viz-muted', '次级文字色'], bg: ['viz-bg', '画布背景色'],
  grid: ['viz-grid', '网格线色'], axis: ['viz-axis', '坐标轴线色'],
};

const STRUCTURE_PURPOSE = {
  node: '节点底色', 'node-line': '节点描边（对应第 1 种分组框）',
  edge: '普通连线，1.25px', 'edge-strong': '主连线与箭头，2px',
  em: '强调节点实底', 'on-em': '实底强调节点上的文字', 'em-fill': '强调节点浅底', 'em-line': '浅底强调节点描边',
  chip: '连线标签底框', radius: '分组框圆角', 'radius-sm': '节点圆角', font: '图内字体族',
};
function structurePurpose(role) {
  const frame = /^frame-(\d)(-fill)?$/.exec(role);
  if (!frame) return STRUCTURE_PURPOSE[role];
  return `第 ${frame[1]} 种分组框${frame[2] ? '底色' : '描边'}；同级分组依次用 1–6，嵌套层沿用外层编号`;
}

function skeleton({ font, marker, stroke, spacing }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="188" viewBox="0 0 280 188" role="img" aria-label="请求处理与异步归档" font-family="var(--viz-font)">
  <defs><marker id="kit-arrow" viewBox="${marker.viewBox}" refX="${marker.refX}" refY="${marker.refY}" markerWidth="${marker.size}" markerHeight="${marker.size}" orient="${marker.orient}"><path d="${marker.path}" fill="var(--viz-edge-strong)"/></marker></defs>
  <rect x="8" y="8" width="264" height="80" rx="var(--viz-radius)" fill="var(--viz-frame-1-fill)" stroke="var(--viz-frame-1)" stroke-width="${stroke.frame}"/>
  <text x="140" y="28" text-anchor="middle" dominant-baseline="central" font-size="${font.title.size}" font-weight="${font.title.weight}" fill="var(--viz-fg)">请求处理</text>
  <line x1="112" y1="58" x2="166" y2="58" stroke="var(--viz-edge-strong)" stroke-width="${stroke.edgeStrong}" marker-end="url(#kit-arrow)"/>
  <line x1="214" y1="76" x2="214" y2="144" stroke="var(--viz-edge)" stroke-width="${stroke.edge}" stroke-dasharray="${stroke.dash}"/>
  <rect x="20" y="40" width="92" height="${spacing.nodeHeight}" rx="var(--viz-radius-sm)" fill="var(--viz-node)" stroke="var(--viz-node-line)" stroke-width="${stroke.node}"/>
  <rect x="168" y="40" width="92" height="${spacing.nodeHeight}" rx="var(--viz-radius-sm)" fill="var(--viz-node)" stroke="var(--viz-node-line)" stroke-width="${stroke.node}"/>
  <circle cx="32" cy="58" r="3" fill="var(--ok)"/>
  <text x="66" y="58" text-anchor="middle" dominant-baseline="central" font-size="${font.body.size}" font-weight="${font.body.weight}" fill="var(--viz-fg)">网关</text>
  <text x="214" y="58" text-anchor="middle" dominant-baseline="central" font-size="${font.body.size}" font-weight="${font.body.weight}" fill="var(--viz-fg)">订单服务</text>
  <rect x="182" y="107" width="64" height="${spacing.chipHeight}" rx="4" fill="var(--viz-chip)"/>
  <text x="214" y="116" text-anchor="middle" dominant-baseline="central" font-size="${font.label.size}" font-weight="${font.label.weight}" fill="var(--viz-fg)">异步</text>
  <rect x="168" y="144" width="92" height="${spacing.nodeHeight}" rx="var(--viz-radius-sm)" fill="var(--viz-em-fill)" stroke="var(--viz-em-line)" stroke-width="${stroke.node}"/>
  <text x="214" y="162" text-anchor="middle" dominant-baseline="central" font-size="${font.body.size}" font-weight="${font.body.weight}" fill="var(--viz-fg)">归档</text>
</svg>`;
}

export async function run(argv) {
  const { values } = parseArgs(argv, themeOptions, { positionals: [0, 0], usage: USAGE });
  const theme = selectTheme(values);
  const { accent, ...rest } = createRenderer({ specs: [] }).palette(theme);
  const palette = { ink: rest.ink, chartAccent: accent, ...rest };
  const roles = Object.entries(palette).map(([role, value]) => {
    const [variable, purpose] = ROLE_META[role];
    return { role, cssVariable: `--${variable}`, value, purpose };
  });
  const appearance = structureRoles({ theme });
  const structure = Object.entries(structureProperties(appearance)).map(([cssVariable, value]) => {
    const role = cssVariable.slice('--viz-'.length);
    return { role, cssVariable, value, purpose: structurePurpose(role) };
  });
  const tokens = {
    font: { family: appearance.fontFamily, title: { size: 14, weight: 600, lineHeight: 18 },
      body: { size: 13, weight: 400, lineHeight: 20 }, label: { size: 12, weight: 400, lineHeight: 16 } },
    stroke: { frame: 1, node: 1, edge: 1.25, edgeStrong: 2, dash: '5 4' },
    radius: { frame: appearance.radius, node: appearance.smallRadius },
    marker: { viewBox: '0 0 10 10', path: 'M1 1 L9 5 L1 9 Z', refX: 8, refY: 5, size: 8, orient: 'auto-start-reverse' },
    // blocks 的标签底框单行高 max(18, 16 + 2)。
    spacing: { grid: 4, framePadding: 12, frameHeader: 36, nodeHeight: 36, nodeGap: 8, groupGap: 16,
      connectorGap: 56, chipPaddingX: 6, chipHeight: 18, minText: 12 },
  };
  const svgSkeleton = skeleton(tokens);
  const figureTemplate = `<figure class="viz viz-figure" id="fig-sketch"><figcaption class="fig-title">请求处理与异步归档</figcaption><div class="fig-body viz-body" tabindex="0" role="region" aria-label="请求处理与异步归档">${svgSkeleton}</div></figure>`;
  emit({ theme: themeId(theme), palette, roles, structure, tokens, svgSkeleton, figureTemplate });
}
