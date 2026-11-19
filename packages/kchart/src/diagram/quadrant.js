import { deltaE2000, isHex } from '../core/color.js';
import { FONT, appearance, error, labelText, warning } from './support.js';

const clean = s => labelText(s.trim().replace(/^"(.*)"$/, '$1'));
const honoredConfig = ['chartWidth', 'chartHeight', 'pointRadius', 'pointLabelFontSize', 'xAxisPosition', 'yAxisPosition'].map(key => `quadrantChart.${key}`);
const colorSamples = { danger: '#e83237', warn: '#eda219', ok: '#168d55', info: '#217cd4', new: '#a93bc0' };
function colorRole(value) {
  const hex = /^#[\da-f]{3}$/i.test(value) ? value.replace(/[\da-f]/gi, c => c + c) : value;
  return isHex(hex) ? Object.keys(colorSamples).sort((a, b) => deltaE2000(hex, colorSamples[a]) - deltaE2000(hex, colorSamples[b]))[0] : null;
}

function parse(body, { lang, title = '', firstLine = 2, config, options = {} }) {
  const points = [], captions = [], axes = {}, errors = [], adapted = new Set();
  const fail = (line, zh, en) => errors.push(error(lang, line, zh, en, '修正坐标或图表声明', 'Fix the coordinates or chart declaration'));
  if (Object.keys(options).length) fail(firstLine - 1, '象限图不接受标题行选项', 'Unexpected quadrantChart header option');
  let styleLine;
  for (const [i, raw] of body.split('\n').entries()) {
    const line = firstLine + i, s = raw.trim();
    if (!s || s.startsWith('%%')) continue;
    const heading = /^title(?:\s*:\s*|\s+)(.+)/i.exec(s);
    if (heading) { title = clean(heading[1]); continue; }
    const axis = /^([xy])-axis\s+(.+)/i.exec(s);
    if (axis) {
      const pieces = axis[2].match(/(?:"[^"]*"|[^"-]|-(?!-+>))+/g) || [];
      axes[axis[1].toLowerCase()] = pieces.map(clean);
      if (pieces.length === 1) axes[axis[1].toLowerCase()][0] += ' ⟶';
      continue;
    }
    const caption = /^quadrant-([1-4])\s+(.+)/i.exec(s);
    if (caption) { captions[Number(caption[1]) - 1] = clean(caption[2]); continue; }
    const point = /^("[^"]*"|[^:]+):\s*(\[)?\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\s*(\])?\s*(.*)$/.exec(s);
    if (!point || Boolean(point[2]) !== Boolean(point[5]) || (!point[2] && point[6]) || Number(point[3]) > 1 || Number(point[4]) > 1) {
      fail(line, '坐标必须在 0 到 1 之间', 'Expected a point with coordinates in [0, 1]'); continue;
    }
    if (points.length === 2000) { fail(line, '点超过 2000 个，请拆分图表', 'More than 2000 points; split the diagram'); break; }
    const style = {};
    for (const part of point[6] ? point[6].split(',') : []) {
      const m = /^(radius|color|stroke-color|stroke-width)\s*:\s*(\S+)$/i.exec(part.trim());
      if (!m) { fail(line, '无效的点样式', 'Invalid point style'); continue; }
      const key = m[1].toLowerCase(), val = m[2];
      if (key.endsWith('color')) style[key] = colorRole(val);
      else {
        const n = Number(val.replace(/px$/i, ''));
        if (!Number.isFinite(n)) { fail(line, '点样式需要数值', 'Expected a numeric point style'); continue; }
        style[key] = key === 'radius' ? Math.min(12, Math.max(3, n)) : Math.min(3, Math.max(0, n));
        if (style[key] === n) continue;
      }
      styleLine ??= line;
      adapted.add(key);
    }
    points.push({ text: clean(point[1]), x: Number(point[3]), y: Number(point[4]), style });
  }
  if (adapted.size) errors.push(warning('IGNORED_STYLE', lang, styleLine,
    `已调整点样式：${[...adapted].join(', ')}`, `Adapted point styles: ${[...adapted].join(', ')}`, '颜色随主题，尺寸有上限', 'Colors follow the theme and sizes are capped'));
  return { model: { type: 'quadrantChart', title, axes, captions, points, config: config?.quadrantChart || {} }, errors };
}

function layout(model, { ctx, width, renderOptions }, info = {}) {
  const { title, captions, axes, points, config } = model, t = appearance(ctx);
  const size = Math.max(12, Math.min(24, Number(config.pointLabelFontSize) || 12));
  const r = Math.max(3, Math.min(12, Number(config.pointRadius) || 5));
  const titleInline = title && !renderOptions?.frame;
  const xTop = config.xAxisPosition ? config.xAxisPosition === 'top' : !points.length;
  const yRight = config.yAxisPosition === 'right';
  const centered = { anchor: 'middle', 'dominant-baseline': 'central' };
  const W = (s, font = FONT.label) => ctx.measure(s || '', font.size, font.weight);
  const spanOf = values => (values || []).reduce((sum, text) => sum + W(text), 36);
  const pad = 23, axisRoom = 26, top = pad + (titleInline ? 32 : 0) + (xTop && axes.x ? axisRoom : 0);
  const left = pad + (!yRight && axes.y ? axisRoom : 0);
  const right = pad + (yRight && axes.y ? axisRoom : 0);
  const span = Math.max(width - left - right, 360, Number(config.chartWidth) || 0, spanOf(axes.x), ...captions.map(s => 2 * W(s, FONT.title) + 44).filter(Number.isFinite));
  const h = Math.max(320, spanOf(axes.y), Number(config.chartHeight) || 0);
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
    children.push(ctx.rect(x, y, span / 2, h / 2, { fill: ctx.tint(t.bg, ctx.color(`tone${i + 1}`), .08), stroke: t.grid }));
  }
  const dots = points.map(p => ({ ...p, cx: left + p.x * span, cy: bottom - p.y * h, r: p.style.radius ?? r }));
  const box = (x, y, hw, hh) => ({ x0: x - hw, x1: x + hw, y0: y - hh, y1: y + hh });
  const free = b => occupied.every(a => a.x1 + 3 < b.x0 || a.x0 - 3 > b.x1 || a.y1 + 3 < b.y0 || a.y0 - 3 > b.y1);
  dots.forEach(p => occupied.push(box(p.cx, p.cy, p.r + 2, p.r + 2)));
  captions.forEach((s, i) => {
    const x = left + (i === 0 || i === 3 ? .75 : .25) * span;
    const start = top + (i >= 2 ? h / 2 : 0), hw = W(s, FONT.title) / 2;
    let y = start + (dots.length ? 20 : h / 4);
    while (!free(box(x, y, hw, 7))) y += 18;
    pushText(x, y, s, FONT.title, t.fg2);
    occupied.push(box(x, y, hw, 7));
  });
  if (axes.x) {
    const y = xTop ? top - 16 : bottom + 16;
    pushText(left, y, axes.x[0], FONT.label, t.fg2, { anchor: 'start' });
    pushText(left + span, y, axes.x[1], FONT.label, t.fg2, { anchor: 'end' });
  }
  if (axes.y) {
    const x = yRight ? left + span + 16 : left - 16;
    [[axes.y[0], bottom, 'start'], [axes.y[1], top, 'end']].forEach(([text, y, anchor]) => {
      pushText(x, y, text, FONT.label, t.fg2, { anchor, transform: `rotate(-90 ${x} ${y})` });
    });
  }
  const overflow = [];
  dots.forEach((p, i) => {
    children.push(ctx.circle(p.cx, p.cy, p.r, { fill: t[p.style.color] || t.accent, stroke: t[p.style['stroke-color']] || t.bg,
      'stroke-width': p.style['stroke-width'] ?? 1, meta: { kind: 'node', id: i } }));
    const font = { ...FONT.label, size }, hw = W(p.text, font) / 2;
    const cx = Math.min(left + span - hw, Math.max(left + hw, p.cx)), offset = p.r + size / 2 + 5;
    const options = [[cx, p.cy + offset], [cx, p.cy - offset], [p.cx + offset + hw, p.cy], [p.cx - offset - hw, p.cy]];
    const placement = options.find(([x, y]) => x - hw >= left && x + hw <= left + span && y - size / 2 >= top && y + size / 2 <= bottom && free(box(x, y, hw, size / 2)));
    if (placement) {
      pushText(...placement, p.text, font, t.fg1, { meta: { kind: 'edge-label' } });
      occupied.push(box(...placement, hw, size / 2));
    } else overflow.push({ text: `${p.text} (${p.x}, ${p.y})`, x: p.cx });
  });
  // A dense cluster may have no safe local slot; use measured lanes with exact coordinate references.
  const lanes = ctx.labelLanes(ctx, overflow, { left, right: left + span, maxWidth: 180 });
  const start = bottom + (!xTop && axes.x ? axisRoom : 0) + pad;
  for (const item of lanes.items) children.push(ctx.textLines(item.cx, start + 10 + item.offset, item.lines, { ...FONT.label, ...centered, fill: t.fg1 }));
  const height = start + lanes.height;
  const errors = w > width * 2 || points.length > 60 ? [warning('LARGE_DIAGRAM', ctx.lang, info.headerLine || 1,
    '象限图较大', 'Large quadrant chart', '考虑拆分图表', 'Consider splitting the diagram')] : [];
  return { width: w, height, scene: { width: w, height, children, title, heading: title }, errors };
}

const implementations = { quadrantChart: { parse, layout, honoredConfig } };
export { implementations };
