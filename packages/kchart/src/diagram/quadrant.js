import { normalizeLabel } from './label.js';
import { presentation, roleOfColor } from './presentation.js';
import { FONT, appearance, error, warning } from './support.js';
const honoredConfig = ['chartWidth', 'chartHeight', 'pointRadius', 'pointLabelFontSize', 'xAxisPosition', 'yAxisPosition', 'quadrantPadding', 'xAxisLabelPadding', 'yAxisLabelPadding', 'quadrantTextTopPadding', 'pointTextPadding'].map(key => `quadrantChart.${key}`);

function parse(body, { lang, title = '', firstLine = 2, config, options = {} }) {
  const points = [], captions = [], axes = {}, errors = [], adapted = new Set(), classes = new Map(), assets = new Set();
  const look = presentation({ lang });
  const clean = (s, line) => {
    const { text, icon, diagnostics } = normalizeLabel(s.trim().replace(/^"(.*)"$/, '$1'), { lang, line });
    if (icon) diagnostics.push(warning('IGNORED_ASSET', lang, line, '象限图标签仅显示文本', 'Quadrant labels display text only'));
    for (const d of diagnostics) if (!assets.has(d.message)) { assets.add(d.message); errors.push(d); }
    return text.replace(/\n/g, ' ');
  };
  const fail = (line, zh, en) => errors.push(error(lang, line, zh, en, '修正坐标或图表声明', 'Fix the coordinates or chart declaration'));
  if (Object.keys(options).length) fail(firstLine - 1, '象限图不接受标题行选项', 'Unexpected quadrantChart header option');
  let styleLine;
  const pointStyle = (source, line) => {
    const style = {};
    for (const part of source ? source.split(/,(?![^()]*\))/) : []) {
      const m = /^(radius|color|stroke-color|stroke-width)\s*:\s*(.+)$/i.exec(part.trim());
      if (!m) { fail(line, '无效的点样式', 'Invalid point style'); continue; }
      const key = m[1].toLowerCase(), val = m[2];
      if (key.endsWith('color')) style[key] = roleOfColor(val);
      else {
        const n = Number(val.replace(/px$/i, ''));
        if (!Number.isFinite(n)) { fail(line, '点样式需要数值', 'Expected a numeric point style'); continue; }
        style[key] = key === 'radius' ? Math.min(12, Math.max(3, n)) : Math.min(3, Math.max(0, n));
        if (style[key] === n) continue;
      }
      styleLine ??= line;
      adapted.add(key);
    }
    return style;
  };
  for (const [i, raw] of body.split('\n').entries()) {
    const line = firstLine + i, s = raw.trim();
    if (!s || s.startsWith('%%')) continue;
    const definition = /^classDef\s+(\w+)\s+((?:radius|color|stroke-color|stroke-width)\s*:.*)$/i.exec(s);
    if (definition) { classes.set(definition[1], pointStyle(definition[2], line)); continue; }
    if (look.accept(s, line)) continue;
    const heading = /^title(?:\s*:\s*|\s+)(.+)/i.exec(s);
    if (heading) { title = clean(heading[1], line); continue; }
    const axis = /^([xy])-axis\s+(.+)/i.exec(s);
    if (axis) {
      const delimiter = /"[^"]*"|--+>/g;
      const arrow = [...axis[2].matchAll(delimiter)].find(([part]) => part.startsWith('-'));
      const pieces = arrow ? [axis[2].slice(0, arrow.index), axis[2].slice(arrow.index + arrow[0].length)] : [axis[2]];
      axes[axis[1].toLowerCase()] = pieces.map(piece => clean(piece, line));
      if (pieces.length === 1) axes[axis[1].toLowerCase()][0] += ' ⟶';
      continue;
    }
    const caption = /^quadrant-([1-4])\s+(.+)/i.exec(s);
    if (caption) { captions[Number(caption[1]) - 1] = clean(caption[2], line); continue; }
    const point = /^("[^"]*"|[^:]+?)(?:::\:(\w+))?\s*:\s*(\[)?\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\s*(\])?\s*(.*)$/.exec(s);
    if (!point || Boolean(point[3]) !== Boolean(point[6]) || (!point[3] && point[7]) || Number(point[4]) > 1 || Number(point[5]) > 1) {
      fail(line, '坐标必须在 0 到 1 之间', 'Expected a point with coordinates in [0, 1]'); continue;
    }
    if (points.length === 2000) { fail(line, '点超过 2000 个，请拆分图表', 'More than 2000 points; split the diagram'); break; }
    const id = point[1].trim().replace(/^"(.*)"$/, '$1'), className = point[2];
    if (className) look.addClasses(id, [className], line);
    points.push({ id, className, text: clean(point[1], line), x: Number(point[4]), y: Number(point[5]), style: pointStyle(point[7], line) });
  }
  for (const point of points) {
    point.style = { color: look.statusOf(point.id), ...classes.get(point.className), ...point.style };
    point.link = look.linkOf(point.id);
  }
  errors.push(...look.diagnostics());
  if (adapted.size) errors.push(warning('IGNORED_STYLE', lang, styleLine,
    `已调整点样式：${[...adapted].join(', ')}`, `Adapted point styles: ${[...adapted].join(', ')}`, '颜色随主题，尺寸有上限', 'Colors follow the theme and sizes are capped'));
  return { model: { type: 'quadrantChart', title, axes, captions, points, config: config?.quadrantChart || {} }, errors };
}

function layout(model, { ctx, width, renderOptions }, info = {}) {
  const { title, captions, axes, points, config } = model, t = appearance(ctx);
  const dimension = (key, fallback, min, max) => Number.isFinite(config[key]) ? Math.min(max, Math.max(min, config[key])) : fallback;
  const size = dimension('pointLabelFontSize', 12, 12, 24);
  const r = dimension('pointRadius', 5, 3, 12);
  const titleInline = title && !renderOptions?.frame;
  const xTop = config.xAxisPosition ? config.xAxisPosition === 'top' : !points.length;
  const yRight = config.yAxisPosition === 'right';
  const centered = { anchor: 'middle', 'dominant-baseline': 'central' };
  const W = (s, font = FONT.label) => ctx.measure(s || '', font.size, font.weight);
  const spanOf = values => (values || []).reduce((sum, text) => sum + W(text), 36);
  const pad = 18 + dimension('quadrantPadding', 5, 0, 48);
  const xGap = 11 + dimension('xAxisLabelPadding', 5, 5, 48), yGap = 11 + dimension('yAxisLabelPadding', 5, 5, 48);
  const xRoom = xGap + 10, yRoom = yGap + 10;
  const top = pad + (titleInline ? 32 : 0) + (xTop && axes.x ? xRoom : 0);
  const left = pad + (!yRight && axes.y ? yRoom : 0);
  const right = pad + (yRight && axes.y ? yRoom : 0);
  const span = Math.max(Math.min(520, width - left - right), 360, dimension('chartWidth', 0, 0, 4000), spanOf(axes.x), ...captions.map(s => 2 * W(s, FONT.title) + 44).filter(Number.isFinite));
  const h = Math.max(340, spanOf(axes.y), dimension('chartHeight', 0, 0, 4000));
  const w = left + span + right, bottom = top + h;
  const children = [], occupied = [];
  const pushText = (x, y, value, font = FONT.label, fill = t.fg1, attrs = {}) => {
    if (value) children.push(ctx.text(x, y, value, { ...font, ...centered, fill, ...attrs }));
  };
  if (titleInline) pushText(w / 2, 26, title, FONT.title);
  children.push(ctx.rect(left, top, span, h, { stroke: t.line, fill: t.bg, meta: { kind: 'frame', id: 'quadrants' } }));
  for (let i = 0; i < 4; i++) {
    const dx = (i === 0 || i === 3) ? span / 2 : 0, dy = i >= 2 ? h / 2 : 0;
    const x = left + dx, y = top + dy;
    children.push(ctx.rect(x, y, span / 2, h / 2, { fill: ctx.tint(t.bg, ctx.color(`tone${i + 1}`), .08), stroke: t.line }));
  }
  const dots = points.map(p => ({ ...p, cx: left + p.x * span, cy: bottom - p.y * h, r: p.style.radius ?? r }));
  const box = (x, y, hw, hh) => ({ x0: x - hw, x1: x + hw, y0: y - hh, y1: y + hh });
  const free = b => occupied.every(a => a.x1 + 3 < b.x0 || a.x0 - 3 > b.x1 || a.y1 + 3 < b.y0 || a.y0 - 3 > b.y1);
  dots.forEach(p => occupied.push(box(p.cx, p.cy, p.r + 2, p.r + 2)));
  captions.forEach((s, i) => {
    const x = left + (i === 0 || i === 3 ? .75 : .25) * span;
    const start = top + (i >= 2 ? h / 2 : 0), hw = W(s, FONT.title) / 2;
    let y = start + (dots.length ? 15 + dimension('quadrantTextTopPadding', 5, 3, 50) : h / 4);
    while (!free(box(x, y, hw, 7))) y += 18;
    pushText(x, y, s, FONT.title, t.fg2);
    occupied.push(box(x, y, hw, 7));
  });
  if (axes.x) {
    const y = xTop ? top - xGap : bottom + xGap;
    pushText(left, y, axes.x[0], FONT.label, t.fg2, { anchor: 'start' });
    pushText(left + span, y, axes.x[1], FONT.label, t.fg2, { anchor: 'end' });
  }
  if (axes.y) {
    const x = yRight ? left + span + yGap : left - yGap;
    [[axes.y[0], bottom, 'start'], [axes.y[1], top, 'end']].forEach(([text, y, anchor]) => {
      pushText(x, y, text, FONT.label, t.fg2, { anchor, transform: `rotate(-90 ${x} ${y})` });
    });
  }
  const overflow = [];
  dots.forEach((p, i) => {
    const dot = ctx.circle(p.cx, p.cy, p.r, { fill: t[p.style.color] || t.accent, stroke: t[p.style['stroke-color']] || t.bg,
      'stroke-width': p.style['stroke-width'] ?? 1, meta: { kind: 'node', id: i } });
    children.push(p.link ? ctx.link(p.link.href, [dot], p.link) : dot);
    const font = { ...FONT.label, size }, hw = W(p.text, font) / 2;
    const cx = Math.min(left + span - hw, Math.max(left + hw, p.cx)), offset = p.r + size / 2 + dimension('pointTextPadding', 5, 5, 40);
    const options = [[cx, p.cy + offset], [cx, p.cy - offset], [p.cx + offset + hw, p.cy], [p.cx - offset - hw, p.cy]];
    const placement = options.find(([x, y]) => x - hw >= left && x + hw <= left + span && y - size / 2 >= top && y + size / 2 <= bottom && free(box(x, y, hw, size / 2)));
    if (placement) {
      pushText(...placement, p.text, font, t.fg1, { meta: { kind: 'edge-label' } });
      occupied.push(box(...placement, hw, size / 2));
    } else overflow.push({ text: `${p.text} (${p.x}, ${p.y})`, x: p.cx });
  });
  // A dense cluster may have no safe local slot; use measured lanes with exact coordinate references.
  const lanes = ctx.labelLanes(ctx, overflow, { left, right: left + span, maxWidth: 180 });
  const start = bottom + (!xTop && axes.x ? xRoom : 0) + pad;
  for (const item of lanes.items) children.push(ctx.textLines(item.cx, start + 10 + item.offset, item.lines, { ...FONT.label, ...centered, fill: t.fg1 }));
  const height = start + lanes.height;
  const errors = w > width * 2 || points.length > 60 ? [warning('LARGE_DIAGRAM', ctx.lang, info.headerLine || 1,
    '象限图较大', 'Large quadrant chart', '考虑拆分图表', 'Consider splitting the diagram')] : [];
  return { width: w, height, scene: { width: w, height, children, title, heading: title }, errors };
}

const implementations = { quadrantChart: { parse, layout, honoredConfig, acceptsPresentation: true } };
export { implementations };
