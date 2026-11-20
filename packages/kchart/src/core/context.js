import { el, hash, link, primitive } from './scene.js';
import { FONT_FAMILY, defaultStyle, paletteOf, theme as resolveTheme } from './theme.js';
import { contrast, isHex, luminance, mix, pushContrast, tint } from './color.js';
import { fallbackMeasure, wrapText } from './text.js';
import { extent, linear } from './scale.js';
import { apportion, barPath, columnHeaders, labelLanes } from './geometry.js';
import { fit } from './diagnostics.js';

const roles = ['ink', 'accent', 'tone1', 'tone2', 'tone3', 'tone4', 'tone5', 'tone6', 'fg', 'muted', 'bg', 'grid', 'axis'];
const TEXT_CONTRAST = 4.5;

function createContext(options = {}) {
  const width = Math.max(1, Number(options.width) || 800), lang = options.lang || 'zh';
  const resolved = resolveTheme(options.theme || 'claude', { media: options.media || 'screen' });
  const theme = resolved.id || resolved.name || (typeof options.theme === 'string' ? options.theme : 'claude');
  const palette = paletteOf(resolved);
  const fontFamily = resolved.fontFamily || FONT_FAMILY;
  if (typeof fontFamily !== 'string' || !fontFamily.trim()) throw new TypeError('Invalid theme font family');
  const measure = options.measure || fallbackMeasure;
  const color = (role) => {
    if (!roles.includes(role)) throw new TypeError(`Unknown color role: ${role}`);
    const value = palette[role];
    if (typeof value !== 'string') throw new TypeError(`Unknown color role: ${role}`);
    return value;
  };
  // 普通框可单独取色；未登记结构框色的主题保留原样，根节点必要时用墨色建立层次。
  const frameTone = (value, prominent = false) => resolved.frameInk
    ? (prominent ? resolved.fg1 : resolved.frameInk) : value;
  const wrap = (value, maxWidth, size = 12, weight = 400, options) => wrapText(
    String(value ?? ''), maxWidth, { size, weight }, (text, font) => measure(text, font.size, font.weight, fontFamily), options,
  );
  const text = (x, y, value, opts = {}) => {
    const { anchor = 'start', size = 12, weight = 400, fill = color('muted'), meta, ...attrs } = opts;
    if (!['start', 'middle', 'end'].includes(anchor)) throw new TypeError('Invalid text anchor');
    return { ...primitive('text', { x, y, ...attrs, 'text-anchor': anchor, 'font-size': size, 'font-weight': weight, fill }, meta), text: String(value ?? '') };
  };
  const textLines = (x, y, lines, opts = {}) => {
    const { leading = 16, ...textOpts } = opts;
    return el('g', {}, lines.map((line, i) => text(x, y + i * leading, line, textOpts)));
  };
  const flow = (items, maxWidth, size = 12, weight = 400) => {
    const rows = []; let row = [], rowWidth = 0;
    const gap = measure(' · ', size, weight, fontFamily);
    for (const item of items || []) {
      const value = String(item), itemWidth = measure(value, size, weight, fontFamily);
      if (itemWidth > maxWidth) {
        if (row.length) rows.push(row);
        row = []; rowWidth = 0;
        rows.push(...wrap(value, maxWidth, size, weight).map((line) => [line]));
        continue;
      }
      if (row.length && rowWidth + gap + itemWidth > maxWidth) { rows.push(row); row = []; rowWidth = 0; }
      row.push(value); rowWidth += (row.length > 1 ? gap : 0) + itemWidth;
    }
    if (row.length) rows.push(row);
    return rows;
  };
  const titled = (node, tip) => tip == null || tip === '' ? node : el('g', {}, [node, { ...el('title'), text: String(tip) }]);
  const hexOf = (value) => {
    if (isHex(value)) return value;
    if (roles.includes(value)) return color(value);
    throw new TypeError(`Unknown color: ${value}`);
  };
  const textColor = (value) => {
    const hex = hexOf(value);
    if (contrast(hex, color('bg')) >= TEXT_CONTRAST) return roles.includes(value) ? color(value) : hex;
    return pushContrast(hex, color('fg'), color('bg'), TEXT_CONTRAST);
  };
  const textOn = (fill, { opacity = 1, over = 'bg' } = {}) => {
    const under = opacity >= 1 ? hexOf(fill) : mix(hexOf(over), hexOf(fill), opacity);
    const useFg = contrast(color('fg'), under) >= contrast(color('bg'), under);
    const base = color(useFg ? 'fg' : 'bg');
    if (contrast(base, under) >= TEXT_CONTRAST) return base;
    const extreme = luminance(base) > luminance(under) ? '#ffffff' : '#000000';
    return pushContrast(base, extreme, under, TEXT_CONTRAST);
  };
  const legend = (items, maxWidth, context) => {
    const gap = 10, swatch = 10, textGap = 6, lineHeight = 16;
    let x = 0, y = 0, rowHeight = 0;
    const children = [], textWidth = Math.max(1, maxWidth - swatch - textGap);
    for (const item of items || []) {
      const room = x ? textWidth - x : textWidth;
      let lines = context.wrap(item.label, Math.max(1, room), 12, 400);
      let itemWidth = swatch + textGap + Math.max(...lines.map((line) => context.measure(line, 12, 400)));
      if (x && (lines.length > 1 || x + itemWidth > maxWidth)) {
        x = 0; y += rowHeight + gap; rowHeight = 0;
        lines = context.wrap(item.label, textWidth, 12, 400);
        itemWidth = swatch + textGap + Math.max(...lines.map((line) => context.measure(line, 12, 400)));
      }
      const group = el('g', {}, [context.rect(x, y + 3, swatch, swatch, { fill: item.color }), context.textLines(x + swatch + textGap, y + 12, lines, { fill: context.color('fg') })]);
      group.meta = { ...item.meta, kind: 'legend' };
      children.push(group); x += itemWidth + gap; rowHeight = Math.max(rowHeight, lines.length * lineHeight);
    }
    return { children, height: items?.length ? y + rowHeight : 0 };
  };
  const ctx = {
    width, lang, theme, fontFamily, scheme: resolved.scheme, design: resolved, assets: options.assets || null,
    measure: (value, size, weight) => measure(value, size, weight, fontFamily),
    el: el, shape: primitive, text, titled, link, textColor, textOn,
    rect: (x, y, w, h, opts = {}) => primitive('rect', { x, y, width: w, height: h, ...opts }, opts.meta),
    line: (x1, y1, x2, y2, opts = {}) => primitive('line', { x1, y1, x2, y2, ...opts }, opts.meta),
    circle: (x, y, r, opts = {}) => primitive('circle', { cx: x, cy: y, r, ...opts }, opts.meta),
    path: (d, opts = {}) => primitive('path', { d, ...opts }, opts.meta),
    color, palette, colors: palette, frameTone, mix: mix, tint: (paper, value, ratio) => tint(paper, value, ratio, resolved.tint), extent: extent, linear: linear, hash: hash,
    columnHeaders: columnHeaders, labelLanes: labelLanes, apportion: apportion, barPath: barPath,
    wrap, textLines, flow, legend: (items, maxWidth) => legend(items, maxWidth, ctx), scene: (height, children, title) => ({ width, height, children, ...(title ? { title } : {}) }),
    fit: fit,
  };
  return ctx;
}
function structureRoles({ theme, media = 'screen', tones } = {}) {
  const ctx = createContext({ theme, media, width: 800 });
  const d = ctx.design, look = { ...defaultStyle, ...d.style, ...d.diagram };
  // 装饰色可沿用 UI 已发布的线框色，不要求达到数据序列的区分度。
  if (tones !== undefined && (!Array.isArray(tones) || tones.length !== 6 || ![...tones].every(isHex))) {
    throw new TypeError('Structure tones must contain six hex colors');
  }
  const palette = tones && media === 'screen' ? paletteOf({ ...d, tones }) : ctx.palette;
  const colors = {};
  for (let k = 1; k <= 6; k += 1) {
    const tone = ctx.frameTone(palette[`tone${k}`]);
    colors[`frame-${k}`] = ctx.tint(d.bg, tone, 0.45);
    colors[`frame-${k}-fill`] = ctx.tint(d.bg, tone, 0.07);
  }
  const em = ctx.frameTone(palette.accent, true);
  return Object.freeze({
    colors: Object.freeze({
      ...colors,
      node: d[look.nodeBackground],
      'node-line': ctx.tint(d.bg, ctx.frameTone(palette.tone1), 0.40),
      edge: d.fg4,
      'edge-strong': ctx.color('muted'),
      em,
      'on-em': ctx.textOn(em),
      'em-fill': ctx.tint(d.bg, ctx.frameTone(palette.accent), 0.12),
      'em-line': ctx.tint(d.bg, ctx.frameTone(palette.accent), 0.45),
      chip: d.bg,
    }),
    radius: look.radius, smallRadius: look.smallRadius, fontFamily: ctx.fontFamily,
  });
}

export { createContext, structureRoles };
