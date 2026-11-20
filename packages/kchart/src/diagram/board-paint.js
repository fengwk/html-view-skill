import { contrast, pushContrast } from '../core/color.js';
import { FONT, appearance, maxWidthOf, wrapText } from './support.js';

// The shared look of boards: nested groups of cards (native blocks, Mermaid block). Groups recede
// as dashed outlines; cards carry a title/description hierarchy; color carries meaning only
// through the style words a legend can explain. Layouts measure with the same functions they paint with.
const STYLES = Object.freeze(['accent', 'new', 'info', 'ok', 'warn', 'danger', 'ext']);
const STATUS = new Set(['new', 'info', 'ok', 'warn', 'danger']);
const CARD = Object.freeze({ padX: 14, padY: 12, text: 240, min: 112, title: 20, desc: 18, gap: 4 });
const CHIP = Object.freeze({ h: 18, padX: 6, gap: 8, font: Object.freeze({ size: 12, weight: 600 }) });
const FRAME = Object.freeze({ inset: 12, top: 10, line: 17, after: 8, text: 360, cylinder: 7, font: Object.freeze({ size: 13, weight: 600 }) });
const NOTE = Object.freeze({ line: 18, font: FONT.label });
const LEGEND = Object.freeze({ swatch: 22, gap: 6, item: 18, row: 22, font: FONT.label });
const LABEL = Object.freeze({ text: 160, line: 16, padX: 6, padY: 2, font: FONT.label });
const EDGE_KINDS = Object.freeze({ '->': 'plain', '=>': 'strong', '~>': 'dashed' });
const ICON = Object.freeze({ size: 16, gap: 6 });
const DASH = '5 4';
const TEXT_CONTRAST = 4.5;
const round = value => +Number(value).toFixed(2);

const chipWidth = (text, measure) => (text ? Math.ceil(measure(String(text), CHIP.font) + CHIP.padX * 2) : 0);

// A card's natural size. Lines wrap at CARD.text; a layout may stretch the card but never re-wraps it.
function measureCard({ title, desc = [], badge, tag }, measure) {
  const badgeW = chipWidth(badge, measure), tagW = chipWidth(tag, measure);
  const lead = badgeW ? badgeW + CHIP.gap : 0, trail = tagW ? tagW + CHIP.gap : 0;
  const titleLines = wrapText(String(title ?? ''), Math.max(48, CARD.text - lead - trail), FONT.title, measure);
  const descLines = desc.flatMap(line => wrapText(String(line), CARD.text, FONT.label, measure));
  const content = Math.max(lead + maxWidthOf(titleLines, FONT.title, measure) + trail, maxWidthOf(descLines, FONT.label, measure));
  return {
    w: Math.max(CARD.min, Math.ceil(content + CARD.padX * 2)),
    h: CARD.padY * 2 + titleLines.length * CARD.title + (descLines.length ? CARD.gap + descLines.length * CARD.desc : 0),
    titleLines, descLines, badgeW, tagW,
  };
}

// A group title sits inside the top-left corner. `band` replaces the top padding of a titled group;
// `minW` is the narrowest group that shows the title on its lines.
function frameTitle({ title = '', badge, icon, db = false }, measure) {
  const badgeW = chipWidth(badge, measure), lead = (badgeW ? badgeW + CHIP.gap : 0) + (icon ? ICON.size + ICON.gap : 0);
  const lines = String(title).trim() ? wrapText(String(title), FRAME.text - lead, FRAME.font, measure) : [];
  const rows = Math.max(lines.length, badge || icon ? 1 : 0);
  const w = rows ? Math.ceil(lead + maxWidthOf(lines, FRAME.font, measure)) : 0;
  const top = FRAME.top + (db ? FRAME.cylinder : 0);
  return { lines, badgeW, w, top, rows, band: rows ? top + rows * FRAME.line + FRAME.after : 0, minW: rows ? w + FRAME.inset * 2 : 0 };
}

// The title text, not the whole band, blocks routes: relations may still enter beside it.
function titleRect(frame, title) {
  if (!title?.rows) return null;
  return { x: frame.x + FRAME.inset - 2, y: frame.y + title.top - 2, w: title.w + 4, h: title.rows * FRAME.line + 4 };
}

function measureNote(text, measure, width = CARD.text) {
  const lines = wrapText(String(text ?? ''), Math.max(24, width), NOTE.font, measure);
  return { lines, w: Math.ceil(maxWidthOf(lines, NOTE.font, measure)), h: lines.length * NOTE.line };
}

function measureLabel(text, measure, icon) {
  const lines = String(text ?? '').trim() ? wrapText(String(text), LABEL.text, LABEL.font, measure) : [];
  if (!lines.length && !icon) return null;
  const lead = icon ? ICON.size + (lines.length ? ICON.gap : 0) : 0;
  return { lines, w: Math.ceil(lead + maxWidthOf(lines, LABEL.font, measure)) + LABEL.padX * 2, h: Math.max(lines.length * LABEL.line, icon ? ICON.size : 0) + LABEL.padY * 2 };
}

// Legend entries flow in rows within `width`; each entry is a swatch plus its meaning.
function measureLegend(entries, measure, width = Infinity) {
  const rows = [];
  let row = [], x = 0, widest = 0;
  for (const entry of entries) {
    const lines = wrapText(String(entry.label), Math.max(24, Math.min(width, 480) - LEGEND.swatch - LEGEND.gap), LEGEND.font, measure);
    const w = Math.ceil(LEGEND.swatch + LEGEND.gap + maxWidthOf(lines, LEGEND.font, measure));
    if (row.length && x + LEGEND.item + w > width) { rows.push(row); row = []; x = 0; }
    const at = row.length ? x + LEGEND.item : 0;
    row.push({ ...entry, lines, x: at, w });
    x = at + w;
    widest = Math.max(widest, x);
  }
  if (row.length) rows.push(row);
  const heights = rows.map(items => Math.max(...items.map(item => item.lines.length)) * LEGEND.row);
  return { rows, heights, w: widest, h: heights.reduce((sum, h) => sum + h, 0) + Math.max(0, rows.length - 1) * 6 };
}

function boardLook(ctx) {
  const d = ctx.design, a = appearance(ctx), bg = d.bg;
  const accent = ctx.frameTone(d.accent, true);
  // Explicit styles keep their semantic hue; a theme's frameInk only replaces decoration.
  const hue = style => (style === 'accent' ? accent : STATUS.has(style) ? d[style] : null);
  const ink = (color, under) => (contrast(color, under) >= TEXT_CONTRAST ? color : pushContrast(color, d.fg1, under, TEXT_CONTRAST));
  const neutral = ctx.tint(bg, ctx.color('muted'), .62);
  const recessed = a.node === d.surface2 ? d.surface : d.surface2;
  const chip = color => { const fill = ctx.tint(bg, color, .14); return { fill, color: ink(color, fill) }; };
  return {
    bg, radius: Math.min(a.radius, 10), fg: d.fg1, muted: d.fg3,
    tag: { fill: a.node, stroke: d.line2, color: ink(d.fg3, a.node) },
    card(style) {
      if (style === 'ext') return { fill: recessed, stroke: neutral, dash: DASH, desc: ink(d.fg3, recessed), badge: chip(accent) };
      const color = hue(style);
      return { fill: a.node, stroke: color ? ctx.tint(bg, color, .72) : neutral, dash: null, desc: ink(d.fg3, a.node), badge: chip(color || accent) };
    },
    frame(style) {
      const color = style === 'ext' ? null : hue(style), fill = style === 'ext' ? d.surface2 : d.surface;
      return { fill, stroke: color ? ctx.tint(bg, color, .55) : d.line2, title: ink(color || d.fg3, fill), badge: chip(color || accent) };
    },
    // kind: 'plain' | 'strong' | 'dashed'; a status (Mermaid linkStyle) colors any kind.
    edge(kind = 'plain', status) {
      const stroke = STATUS.has(status) ? d[status] : kind === 'strong' ? accent : ctx.color('muted');
      return { stroke, width: kind === 'strong' ? 1.75 : 1.25, dash: kind === 'dashed' ? DASH : null };
    },
  };
}

function chip(ctx, x, cy, w, text, { fill, stroke, color }) {
  return ctx.el('g', {}, [
    ctx.rect(x, cy - CHIP.h / 2, w, CHIP.h, { rx: CHIP.h / 2, fill, ...(stroke ? { stroke, 'stroke-width': 1 } : {}) }),
    ctx.text(x + w / 2, cy, text, { anchor: 'middle', size: CHIP.font.size, weight: CHIP.font.weight, fill: color, 'dominant-baseline': 'central' }),
  ]);
}

// A built-in or registered icon (Tabler strokes, Simple Icons fills) centered on (x + size / 2, cy).
function iconGlyph(ctx, icon, x, cy, color, size = ICON.size) {
  const [vx, vy, w, h] = icon.viewBox.split(/\s+/).map(Number), scale = size / Math.max(w, h);
  const stroke = icon.set === 'tabler';
  return ctx.el('g', {
    transform: `translate(${round(x + (size - w * scale) / 2)} ${round(cy - h * scale / 2)}) scale(${round(scale)}) translate(${-vx} ${-vy})`,
    fill: stroke ? 'none' : color, stroke: stroke ? color : 'none', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }, icon.elements.map(({ tag, attrs }) => ctx.shape(tag, attrs)));
}

function cylinderPath({ x, y, w, h }) {
  const ry = FRAME.cylinder;
  return `M${x} ${y + ry} A${w / 2} ${ry} 0 0 1 ${x + w} ${y + ry} V${y + h - ry} A${w / 2} ${ry} 0 0 1 ${x} ${y + h - ry} Z M${x} ${y + ry} A${w / 2} ${ry} 0 0 0 ${x + w} ${y + ry}`;
}

// frame: { id, x, y, w, h, style?, db?, badge?, icon?, title: frameTitle(...) }
function drawFrame(ctx, frame, look) {
  const { id, x, y, w, h, style, db, badge, icon, title } = frame, s = look.frame(style);
  const parts = [db
    ? ctx.path(cylinderPath(frame), { fill: s.fill, stroke: s.stroke, 'stroke-width': 1 })
    : ctx.rect(x, y, w, h, { rx: look.radius, fill: s.fill, stroke: s.stroke, 'stroke-width': 1, 'stroke-dasharray': DASH })];
  if (title?.rows) {
    let tx = x + FRAME.inset;
    const ty = y + title.top + FRAME.line / 2;
    if (badge) { parts.push(chip(ctx, tx, ty, title.badgeW, badge, s.badge)); tx += title.badgeW + CHIP.gap; }
    if (icon) { parts.push(iconGlyph(ctx, icon, tx, ty, s.title)); tx += ICON.size + ICON.gap; }
    title.lines.forEach((line, i) => parts.push(ctx.text(tx, ty + i * FRAME.line, line, {
      size: FRAME.font.size, weight: FRAME.font.weight, fill: s.title, 'dominant-baseline': 'central', meta: { kind: 'frame-title', id },
    })));
  }
  return { ...ctx.el('g', {}, parts), meta: { kind: 'frame', id, ...(style ? { style } : {}) } };
}

// card: { id, x, y, w, h, style?, badge?, tag?, ...measureCard(...) }
function drawCard(ctx, card, look) {
  const { id, x, y, w, h, style, badge, tag, titleLines, descLines, badgeW, tagW } = card, s = look.card(style);
  const parts = [ctx.rect(x, y, w, h, { rx: look.radius, fill: s.fill, stroke: s.stroke, 'stroke-width': 1.25, ...(s.dash ? { 'stroke-dasharray': s.dash } : {}) })];
  let tx = x + CARD.padX;
  const ty = y + CARD.padY + CARD.title / 2;
  if (badge) { parts.push(chip(ctx, tx, ty, badgeW, badge, s.badge)); tx += badgeW + CHIP.gap; }
  titleLines.forEach((line, i) => parts.push(ctx.text(tx, ty + i * CARD.title, line, {
    size: FONT.title.size, weight: FONT.title.weight, fill: look.fg, 'dominant-baseline': 'central',
  })));
  if (tag) parts.push(chip(ctx, x + w - CARD.padX - tagW, ty, tagW, tag, look.tag));
  const top = y + CARD.padY + titleLines.length * CARD.title + CARD.gap + CARD.desc / 2;
  descLines.forEach((line, i) => parts.push(ctx.text(x + CARD.padX, top + i * CARD.desc, line, {
    size: FONT.label.size, weight: FONT.label.weight, fill: s.desc, 'dominant-baseline': 'central',
  })));
  return { ...ctx.el('g', {}, parts), meta: { kind: 'node', id, ...(style ? { style } : {}) } };
}

// note: { x, y, lines }
function drawNote(ctx, note, look) {
  return { ...ctx.el('g', {}, note.lines.map((line, i) => ctx.text(note.x, note.y + (i + .5) * NOTE.line, line, {
    size: NOTE.font.size, weight: NOTE.font.weight, fill: look.muted, 'dominant-baseline': 'central',
  }))), meta: { kind: 'note' } };
}

// Arrowheads and end marks share one definition per kind and color.
function markers(ctx) {
  const defs = new Map();
  return {
    url(kind, color) {
      const id = `board-${kind}-${String(color).replace(/[^\da-z]/gi, '')}`;
      if (!defs.has(id)) {
        const child = kind === 'circle' ? ctx.el('circle', { cx: 5, cy: 5, r: 4, fill: ctx.design.bg, stroke: color })
          : kind === 'cross' ? ctx.path('M1 1 L9 9 M9 1 L1 9', { fill: 'none', stroke: color, 'stroke-width': 1.8 })
            : ctx.path('M0 0 L10 5 L0 10 Z', { fill: color });
        defs.set(id, ctx.el('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' }, [child]));
      }
      return `url(#${id})`;
    },
    defs: () => (defs.size ? [ctx.el('defs', {}, [...defs.values()])] : []),
  };
}

// The innermost group under a point decides a label plate's fill, so the plate disappears into it.
function surfaceAt(frames, look, x, y) {
  let best = null;
  for (const f of frames) {
    if (x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h && (!best || f.w * f.h < best.w * best.h)) best = f;
  }
  return best ? look.frame(best.style).fill : look.bg;
}

// edge: { from, to, points: [{x,y}], label?: { rect, lines, plate } }; stroke: look.edge(...)
function drawEdge(ctx, edge, stroke, { start, end } = {}) {
  const d = `M${edge.points.map(p => `${round(p.x)} ${round(p.y)}`).join(' L')}`;
  const attrs = { fill: 'none', stroke: stroke.stroke, 'stroke-width': stroke.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    ...(stroke.dash ? { 'stroke-dasharray': stroke.dash } : {}), ...(start ? { 'marker-start': start } : {}), ...(end ? { 'marker-end': end } : {}) };
  return { ...ctx.path(d, attrs), meta: { kind: 'edge', from: edge.from, to: edge.to } };
}

function drawLabel(ctx, { from, to, rect, lines, icon, plate }, look) {
  const lead = icon ? ICON.size + (lines.length ? ICON.gap : 0) : 0;
  const cx = rect.x + (rect.w + lead) / 2, cy = rect.y + rect.h / 2;
  return { ...ctx.el('g', {}, [ctx.rect(rect.x, rect.y, rect.w, rect.h, { rx: 3, fill: plate }),
    ...(icon ? [iconGlyph(ctx, icon, rect.x + LABEL.padX, cy, look.muted)] : []),
    ...lines.map((line, i) => ctx.text(cx, cy + (i - (lines.length - 1) / 2) * LABEL.line, line, {
      anchor: 'middle', size: LABEL.font.size, weight: LABEL.font.weight, fill: look.muted, 'dominant-baseline': 'central',
    }))]), meta: { kind: 'edge-label-group', from, to } };
}

// legend: { x, y, ...measureLegend(entries, measure, width) }; entry.key is a style word, 'default', 'db' or an operator.
function drawLegend(ctx, legend, look, marks) {
  const items = [];
  let top = legend.y;
  legend.rows.forEach((row, r) => {
    for (const item of row) {
      const x = legend.x + item.x, cy = top + LEGEND.row / 2, parts = [];
      const kind = EDGE_KINDS[item.key];
      if (kind) {
        const stroke = look.edge(kind);
        parts.push(drawEdge(ctx, { points: [{ x: x + 1, y: cy }, { x: x + LEGEND.swatch - 1, y: cy }] }, stroke, { end: marks.url('arrow', stroke.stroke) }));
        delete parts[0].meta;
      } else if (item.key === 'db') {
        const s = look.frame();
        parts.push(ctx.path(`M${x + 2} ${cy - 4} A8 3 0 0 1 ${x + 18} ${cy - 4} V${cy + 4} A8 3 0 0 1 ${x + 2} ${cy + 4} Z M${x + 2} ${cy - 4} A8 3 0 0 0 ${x + 18} ${cy - 4}`, { fill: s.fill, stroke: look.card().stroke, 'stroke-width': 1 }));
      } else {
        const s = look.card(item.key === 'default' ? undefined : item.key);
        parts.push(ctx.rect(x + 1, cy - 6, LEGEND.swatch - 2, 12, { rx: 3, fill: s.fill, stroke: s.stroke, 'stroke-width': 1.25, ...(s.dash ? { 'stroke-dasharray': '3 2' } : {}) }));
      }
      item.lines.forEach((line, i) => parts.push(ctx.text(x + LEGEND.swatch + LEGEND.gap, cy + i * LEGEND.row, line, {
        size: LEGEND.font.size, weight: LEGEND.font.weight, fill: look.fg, 'dominant-baseline': 'central',
      })));
      items.push(ctx.el('g', {}, parts));
    }
    top += legend.heights[r] + 6;
  });
  return { ...ctx.el('g', {}, items), meta: { kind: 'legend' } };
}

export {
  STYLES, CARD, CHIP, FRAME, NOTE, LEGEND, LABEL, ICON, EDGE_KINDS,
  measureCard, frameTitle, titleRect, measureNote, measureLabel, measureLegend,
  boardLook, markers, surfaceAt, iconGlyph, drawFrame, drawCard, drawNote, drawEdge, drawLabel, drawLegend,
};
