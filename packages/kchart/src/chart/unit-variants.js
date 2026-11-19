/* Unit-count, pictorial, and lollipop variants for existing KChart layouts. */

import { decorate as registerDecorator, layouts } from './registry.js';
import './basic.js';
import './statistics.js';
import { labelLanes } from '../core/geometry.js';
import { geometry } from '../core/icons.js';

const flatMap = (nodes, visit) => nodes.flatMap((node) => {
  const replacement = visit(node);
  if (replacement) return replacement;
  if (node.children) return [{ ...node, children: flatMap(node.children, visit) }];
  return [node];
});
const clipRect = (ctx, id, x, y, width, height) => ctx.el('clipPath', { id }, [ctx.rect(x, y, Math.max(0, width), Math.max(0, height))]);

const isEnglish = (lang) => /^en(?:-|$)/i.test(String(lang || ''));
function unitCount(value, unit, ctx) {
  const count = Math.abs(value) / unit;
  if (!Number.isFinite(count)) ctx.fit('单位数量无法稳定计算', '调整unitMark.value，使计数保持有限');
  return count;
}
function ensureSymbolBudget(values, unit, ctx) {
  let total = 0;
  for (const value of values) {
    if (!Number.isFinite(value) || value === 0) continue;
    total += Math.ceil(unitCount(value, unit, ctx));
    if (total > 2000) ctx.fit('全图单位符号总数超过2000，无法清晰呈现', '增大unitMark.value，使所有记录的符号总数不超过2000');
  }
}
function requireReadableSlot(length, thickness, minimum, ctx, fix = '增大unitMark.value或改用solid变体') {
  if (!(Number.isFinite(length) && Number.isFinite(thickness)) || length < minimum || thickness < minimum) {
    ctx.fit('单位符号在当前图幅中太密或太小，无法辨认', fix);
  }
}
function unitDescription(spec, ctx, field) {
  // The amount carries the field's unit; the mark label stands in only when the field has none,
  // so the sentence never names the unit twice (“Each ‘members’ mark represents 200 members”).
  const label = spec.unitMark.label, english = isEnglish(ctx.lang);
  const withUnit = ctx.format(spec.unitMark.value, field, true), bare = ctx.format(spec.unitMark.value, field, false);
  const amount = withUnit !== bare ? withUnit : `${bare}${english || !/^[\u3400-\u9fff]/u.test(label) ? ' ' : ''}${label}`;
  if (spec.chart === 'histogram' && spec.variant === 'rungs') {
    return english ? `Each cell represents ${amount}` : `每格表示 ${amount}`;
  }
  return english ? `Each mark represents ${amount}` : `每个符号表示 ${amount}`;
}
function headerLayout(ctx, text, width) {
  const lines = ctx.wrap(text, Math.max(24, width - 16), 12, 400);
  return { lines, height: Math.max(24, lines.length * 16 + 8) };
}
function withHeader(scene, ctx, text, options = {}) {
  const { lines, height } = headerLayout(ctx, text, scene.width);
  const header = ctx.textLines(8, 16, lines, { size: 12, fill: ctx.color('muted'), meta: options.meta });
  return { ...scene, height: scene.height + height, children: [header, ctx.el('g', { transform: `translate(0 ${height})` }, scene.children)] };
}

function symbolGeometry(iconName) {
  const iconGeometry = geometry(iconName);
  if (!iconGeometry) throw new Error(`pictorial图标不存在：${iconName}`);
  if (iconGeometry.set !== 'tabler') throw new Error('pictorial计数不支持品牌图标，请使用通用Tabler图标');
  return iconGeometry;
}

function makePictorial(ctx, geometry, x, y, width, height, color, clipId, meta) {
  const parts = geometry.viewBox.trim().split(/[ ,]+/).map(Number);
  const [vx, vy, vw, vh] = parts;
  if (parts.length !== 4 || !parts.every(Number.isFinite) || vw <= 0 || vh <= 0) throw new Error('pictorial图标viewBox无效');
  const scale = Math.min(width / vw, height / vh);
  const dx = x + (width - vw * scale) / 2 - vx * scale;
  const dy = y + (height - vh * scale) / 2 - vy * scale;
  const children = geometry.elements.map(({ tag, attrs }) => ctx.el(tag, attrs));
  const transformed = ctx.el('g', { transform: `translate(${dx} ${dy}) scale(${scale})`, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, children);
  // The outer clipping group stays in scene coordinates; only icon geometry is translated/scaled.
  const clipped = ctx.el('g', { 'clip-path': `url(#${clipId})` }, [transformed]);
  clipped.meta = meta;
  return clipped;
}

function unitMarks(spec, ctx, scene, mode) {
  if (spec.stack === 'percent') ctx.fit('单位计数不适用于百分比堆叠', '改用solid变体或绝对堆叠');
  const { value: unit, label } = spec.unitMark;
  const geometry = mode === 'pictorial' ? symbolGeometry(spec.unitMark.icon) : null;
  let clipIndex = 0;
  const additions = [];
  const offsets = new Map();
  let pictorialWidth = scene.width;
  const field = Array.isArray(spec.encode.value) ? spec.encode.value[0] : spec.encode.value;
  const unitText = unitDescription(spec, ctx, field);
  const key = (meta) => `${meta.record ?? ''}|${meta.series ?? ''}|${meta.category ?? ''}`;
  const children = flatMap(scene.children, (node) => {
    const bar = node.tag === 'rect' && node.meta?.kind === 'record' && Number.isFinite(node.meta.value) && node.meta.value > 0 && Number(node.attrs.width) > 0 && Number(node.attrs.height) > 0;
    if (!bar) return null;
    const value = node.meta.value, count = unitCount(value, unit, ctx);
    const horizontal = spec.chart === 'bar';
    const x = Number(node.attrs.x), y = Number(node.attrs.y), width = Number(node.attrs.width), height = Number(node.attrs.height);
    const marks = [], fullCount = Math.floor(count), fraction = count - fullCount;
    const actualCount = fullCount + (fraction > 0 ? 1 : 0);
    const color = node.attrs.fill || ctx.color('ink');
    let shift = 0;
    if (mode === 'pictorial') {
      const iconSize = 20, pitch = 24;
      requireReadableSlot(iconSize, iconSize, 18, ctx, '增加图表宽度或减少系列数，使图标至少为18px');
      for (let i = 0; i < actualCount; i += 1) {
        const part = i === fullCount && fraction > 0 ? fraction : 1;
        const clipWidth = horizontal ? iconSize * part : iconSize;
        const clipHeight = horizontal ? iconSize : iconSize * part;
        const slotX = horizontal ? x + i * pitch : x + (width - iconSize) / 2;
        const slotY = horizontal ? y + (height - iconSize) / 2 : y + height - iconSize - i * pitch;
        const clipX = slotX;
        const clipY = horizontal ? slotY : slotY + iconSize - clipHeight;
        if (part < 1) {
          const ghostId = `unit-clip-${clipIndex++}`;
          additions.push(clipRect(ctx, ghostId, slotX, slotY, iconSize, iconSize));
          const ghostColor = ctx.mix(ctx.palette.ink, ctx.palette.bg, 0.82);
          marks.push(makePictorial(ctx, geometry, slotX, slotY, iconSize, iconSize, ghostColor, ghostId, { ...node.meta, kind: 'pictorial-ghost', fraction: 1, unit }));
        }
        const id = `unit-clip-${clipIndex++}`;
        additions.push(clipRect(ctx, id, clipX, clipY, clipWidth, clipHeight));
        marks.push(makePictorial(ctx, geometry, slotX, slotY, iconSize, iconSize, color, id, { ...node.meta, fraction: part, unit }));
      }
      const originalEnd = horizontal ? x + width : y;
      // 部分图标仍占整格（浅色底图标出完整槽位），读数从最后一个槽位之后开始，不压在底图标上。
      const iconExtent = actualCount * pitch - (pitch - iconSize);
      const pictorialEnd = horizontal ? x + iconExtent : y + height - iconExtent;
      shift = pictorialEnd - originalEnd;
      offsets.set(key(node.meta), horizontal ? { dx: shift, dy: 0 } : { dx: 0, dy: shift });
      if (horizontal) pictorialWidth = Math.max(pictorialWidth, pictorialEnd + 48);
    } else {
      const span = (horizontal ? width : height) / count;
      requireReadableSlot(span, horizontal ? height : width, 6, ctx);
      const gap = 2.5;
      for (let i = 0; i < actualCount; i += 1) {
        const part = i === fullCount && fraction > 0 ? fraction : 1;
        const symbolSpan = span - gap;
        const visibleSpan = symbolSpan * part;
        const at = i * span;
        const id = `unit-clip-${clipIndex++}`;
        const rx = horizontal ? x + at : x;
        const ry = horizontal ? y : y + height - at - span;
        const rw = horizontal ? symbolSpan : width;
        const rh = horizontal ? Math.max(0, height - 0) : symbolSpan;
        if (part < 1) additions.push(clipRect(ctx, id, rx, horizontal ? ry : ry + symbolSpan - visibleSpan, horizontal ? visibleSpan : rw, horizontal ? rh : visibleSpan));
        const radius = Math.min(7, rw / 2, rh / 2);
        marks.push(ctx.rect(rx, ry, rw, rh, { rx: radius, fill: color, ...(part < 1 ? { 'clip-path': `url(#${id})` } : {}), meta: { ...node.meta, unit, fraction: part } }));
      }
    }
    return marks;
  });
  let finalChildren = [...additions, ...children];
  if (mode === 'pictorial') {
    finalChildren = flatMap(finalChildren, (node) => {
      if (node.tag === 'line' && !node.meta) return [];
      if (node.tag === 'text' && !node.meta) return [];
      if (node.tag === 'text' && node.meta?.kind === 'value') {
        const shift = offsets.get(key(node.meta));
        if (shift) return [{ ...node, attrs: { ...node.attrs, x: Number(node.attrs.x) + shift.dx, y: Number(node.attrs.y) + shift.dy } }];
      }
      return null;
    });
  }
  return withHeader({ ...scene, width: pictorialWidth, children: finalChildren }, ctx, unitText, { meta: { kind: 'unit-mark-label', label, value: unit } });
}

function lollipop(spec, ctx, scene) {
  const children = flatMap(scene.children, (node) => {
    if (node.tag !== 'rect' || node.meta?.kind !== 'record' || !Number.isFinite(node.meta.value)) return null;
    const value = node.meta.value;
    const x = Number(node.attrs.x), y = Number(node.attrs.y), width = Number(node.attrs.width), height = Number(node.attrs.height);
    const horizontal = spec.chart === 'bar';
    const x1 = horizontal ? (value >= 0 ? x : x + width) : x + width / 2;
    const y1 = horizontal ? y + height / 2 : (value >= 0 ? y + height : y);
    const x2 = horizontal ? (value >= 0 ? x + width : x) : x + width / 2;
    const y2 = horizontal ? y + height / 2 : (value >= 0 ? y : y + height);
    const fill = node.attrs.fill || ctx.color('ink');
    return [
      ctx.line(x1, y1, x2, y2, { stroke: fill, 'stroke-width': 2, 'stroke-linecap': 'round', meta: { ...node.meta, kind: 'connector' } }),
      ctx.circle(x2, y2, 5, { fill, stroke: ctx.color('bg'), 'stroke-width': 2, meta: node.meta }),
    ];
  });
  const shifted = children.map((node) => {
    if (node.tag !== 'text' || node.meta?.kind !== 'value') return node;
    const horizontal = spec.chart === 'bar';
    const next = { ...node, attrs: { ...node.attrs } };
    if (horizontal) next.attrs.x = Number(node.attrs.x) + (Number(node.meta.value) >= 0 ? 14 : -14);
    else if (Number(node.meta.value) < 0) next.attrs.y = Number(node.attrs.y) + 14;
    next.attrs.fill = ctx.textColor('fg');
    return next;
  });
  return { ...scene, children: shifted };
}

function dumbbellRungs(spec, ctx) {
  const e = spec.encode, rows = ctx.table(spec).rows, unit = spec.unitMark.value;
  const values = rows.flatMap((row) => [row[e.before], row[e.after]]);
  ensureSymbolBudget(values, unit, ctx);
  const categoryLines = rows.map((row) => ctx.wrap(String(row[e.category]), Math.max(32, ctx.width * 0.28), 12, 400));
  const categoryWidth = Math.max(48, ...categoryLines.flatMap((lines) => lines.map((line) => ctx.measure(line, 12, 400)))) + 14;
  const readout = (row, role, fallback) => {
    const configured = ctx.field(role).label;
    const label = configured && configured !== role ? configured : (isEnglish(ctx.lang) ? fallback : (fallback === 'before' ? '之前' : '之后'));
    return `${label} ${ctx.format(row[role], role)}`;
  };
  const right = Math.max(16, ...rows.flatMap((row) => [ctx.measure(readout(row, e.before, 'before'), 12, 600), ctx.measure(readout(row, e.after, 'after'), 12, 600)])) + 18;
  const left = Math.max(categoryWidth, ...ctx.ticks(values, e.before, { zero: true, count: 2 }).labels.map((text) => ctx.measure(text) + 14));
  const plotRight = Math.max(left + 80, ctx.width - right);
  const ticks = ctx.ticks(values, e.before, { zero: true, count: 5, length: plotRight - left });
  const rowHeight = Math.max(52, ...categoryLines.map((lines) => lines.length * 16 + 16));
  const top = 34, bottom = top + rowHeight * rows.length;
  const x = ctx.linear(ticks.min, ticks.max, left, plotRight), children = [];
  // 刻度数已由 ctx.ticks 按轴长减少，文字居中于刻度即互不重叠，且保持等距。
  ticks.ticks.forEach((tick, index) => {
    const px = x(tick);
    if (tick !== 0) children.push(ctx.line(px, top, px, bottom, { stroke: ctx.color('grid'), 'stroke-width': 1 }));
    children.push(ctx.text(px, bottom + 18, ticks.labels[index], { anchor: 'middle', size: 12, fill: ctx.color('muted') }));
  });
  rows.forEach((row, index) => {
    const cy = top + rowHeight * (index + 0.5), record = row[e.id] ?? String(index);
    const categoryMeta = { kind: 'category', record, label: String(row[e.category]) };
    categoryLines[index].forEach((line, lineIndex) => {
      children.push(ctx.text(left - 10, cy + 4 - ((categoryLines[index].length - 1) * 8) + lineIndex * 16, line, { anchor: 'end', size: 12, fill: ctx.color('fg'), meta: categoryMeta }));
    });
    const a = row[e.before], b = row[e.after];
    children.push(ctx.line(x(a), cy, x(b), cy, { stroke: ctx.color('grid'), 'stroke-width': 2, meta: { kind: 'connector', record } }));
    for (const [value, toneIndex, role] of [[a, 0, e.before], [b, 1, e.after]]) {
      const count = unitCount(value, unit, ctx), step = (plotRight - left) * unit / (ticks.max - ticks.min);
      const markY = cy + (toneIndex ? 10 : -10), color = ctx.color(toneIndex ? 'accent' : 'ink'), direction = value < 0 ? -1 : 1, zeroX = x(0);
      for (let i = 0; i < Math.ceil(count); i += 1) {
        const fraction = i === Math.floor(count) && count % 1 > 0 ? count % 1 : 1;
        const nearX = zeroX + direction * i * step, markWidth = step * 0.7;
        const markX = direction > 0 ? nearX + step * 0.15 : nearX - step * 0.85;
        const markHeight = 8, markTop = markY - markHeight / 2;
        requireReadableSlot(markWidth, markHeight, 4, ctx, '增加图表宽度或增大unitMark.value');
        const id = `dumbbell-unit-clip-${index}-${toneIndex}-${i}`;
        if (fraction < 1) {
          const clipX = direction > 0 ? markX : markX + markWidth * (1 - fraction);
          children.push(clipRect(ctx, id, clipX, markTop, markWidth * fraction, markHeight));
        }
        children.push(ctx.rect(markX, markTop, markWidth, markHeight, { rx: markHeight / 2, fill: color, ...(fraction < 1 ? { 'clip-path': `url(#${id})` } : {}), meta: { kind: 'record', record, value, field: role, category: String(row[e.category]), unit, fraction } }));
      }
      children.push(ctx.text(plotRight + 8, markY + 4, readout(row, role, toneIndex ? 'after' : 'before'), { size: 12, weight: 600, fill: ctx.textColor(toneIndex ? 'accent' : 'ink'), meta: { kind: 'value', record, value, field: role, label: readout(row, role, toneIndex ? 'after' : 'before') } }));
    }
  });
  const scene = { width: Math.max(ctx.width, plotRight + right), height: bottom + 28, children, title: spec.title || 'dumbbell chart', description: 'dumbbell chart with unit rungs' };
  return withHeader(scene, ctx, unitDescription(spec, ctx, e.before), { meta: { kind: 'unit-mark-label', label: spec.unitMark.label, value: unit } });
}

function waterfall(spec, ctx, next) {
  ensureSymbolBudget(spec.data.map((row) => row[spec.encode.delta]), spec.unitMark.value, ctx);
  const scene = next();
  // Retain cumulative totals and connectors, replacing only each actual delta bar.
  let stage = 0, clipIndex = 0;
  const clips = [];
  const children = flatMap(scene.children, (node) => {
    if (node.tag !== 'g' || !node.children?.some((child) => child.tag === 'rect')) return null;
    const stageIndex = stage++;
    if (stageIndex === 0 || stageIndex > spec.data.length) return [node];
    const bar = node.children.find((child) => child.tag === 'rect');
    const row = spec.data[stageIndex - 1], delta = row[spec.encode.delta], value = Math.abs(delta);
    if (!value) return [];
    const count = unitCount(value, spec.unitMark.value, ctx), x = Number(bar.attrs.x), y = Number(bar.attrs.y);
    const width = Number(bar.attrs.width), height = Number(bar.attrs.height), span = height / count, marks = [];
    const gap = Math.min(2.5, span * 0.16), symbolHeight = span - gap;
    for (let i = 0; i < Math.ceil(count); i += 1) {
      const fraction = i === Math.floor(count) && count % 1 > 0 ? count % 1 : 1;
      const bandY = delta >= 0 ? y + height - (i + 1) * span : y + i * span;
      const markY = bandY + gap / 2;
      const clipY = markY + (delta >= 0 ? symbolHeight * (1 - fraction) : 0);
      const visibleHeight = symbolHeight * fraction;
      requireReadableSlot(width, visibleHeight, 6, ctx, '增大图表宽度或unitMark.value，确保每档高度至少可读');
      const id = `waterfall-unit-clip-${clipIndex++}`;
      clips.push(clipRect(ctx, id, x, clipY, width, visibleHeight));
      marks.push(ctx.rect(x, markY, width, symbolHeight, { rx: Math.min(5, width / 2, symbolHeight / 2), fill: bar.attrs.fill || ctx.color(delta >= 0 ? 'accent' : 'tone5'), 'clip-path': `url(#${id})`, meta: { kind: 'record', record: row[spec.encode.id] ?? String(stageIndex - 1), category: row[spec.encode.category], value: delta, unit: spec.unitMark.value, fraction } }));
    }
    return [{ ...node, children: marks }];
  });
  const field = spec.encode.delta;
  const chart = { ...scene, children: [...clips, ...children] };
  return withHeader(chart, ctx, unitDescription(spec, ctx, field), { meta: { kind: 'unit-mark-label', label: spec.unitMark.label, value: spec.unitMark.value } });
}

function histogram(spec, ctx) {
  const e = spec.encode, rows = spec.data, widths = rows.map((r) => r[e.upper] - r[e.lower]);
  ensureSymbolBudget(rows.map((row) => row[e.count]), spec.unitMark.value, ctx);
  const densities = rows.map((r, i) => r[e.count] / widths[i]);
  const countDomain = ctx.field(e.count).domain;
  const densityDomain = Array.isArray(countDomain) ? countDomain.flatMap((value) => widths.map((width) => value / width)) : [];
  const ticks = ctx.ticks([...densities, ...densityDomain, 0], undefined, { zero: true, count: 4 });
  const left = Math.max(56, ...ticks.labels.map((text) => ctx.measure(text) + 14));
  const first = rows[0][e.lower], last = rows.at(-1)[e.upper];
  const annotations = (spec.annotations || []).filter((a) => [e.lower, e.upper].includes(a.field) && a.kind !== 'note');
  const annotationX = annotations.flatMap((a) => a.kind === 'rule' ? [a.value] : [a.from, a.to]);
  const xDomains = [ctx.field(e.lower).domain, ctx.field(e.upper).domain].filter(Array.isArray);
  const domainLow = Math.min(first, ...xDomains.map((domain) => domain[0]), ...annotationX);
  const domainHigh = Math.max(last, ...xDomains.map((domain) => domain[1]), ...annotationX);
  const boundaryLabels = [...new Set([domainLow, first, ...rows.map((row) => row[e.upper]), domainHigh])].sort((a, b) => a - b);
  const boundaryText = boundaryLabels.map((tick) => ctx.format(tick, e.lower));
  // 首尾边界分别左、右对齐，绘图区至少放得下两者并排加 8px 间隙。
  const endpointWidth = ctx.measure(boundaryText[0], 12, 400) + ctx.measure(boundaryText.at(-1), 12, 400) + 8;
  const right = Math.max(left + 120, ctx.width - 8, left + endpointWidth);
  const x = (value) => left + (value - domainLow) / (domainHigh - domainLow || 1) * (right - left);
  // 参考线与区间的标签写在绘图区上方、对齐各自的位置，不压在单位档上。
  const lanes = labelLanes(ctx, annotations.filter((a) => a.label).map((a) => ({
    a, text: a.label, x: a.kind === 'rule' ? x(a.value) : (x(a.from) + x(a.to)) / 2,
  })), { left, right });
  const annotationHeight = lanes.height ? lanes.height + 4 : 0;
  const top = 34 + annotationHeight, bottom = 254 + annotationHeight;
  const y = ctx.linear(ticks.min, ticks.max, bottom, top), children = [];
  ticks.ticks.forEach((tick, index) => {
    const py = y(tick);
    if (tick !== 0) children.push(ctx.line(left, py, right, py, { stroke: ctx.color('grid'), 'stroke-width': 1 }));
    children.push(ctx.text(left - 10, py + 4, ticks.labels[index], { anchor: 'end', size: 12, fill: ctx.color('muted') }));
  });
  const labelBottom = new Map();
  lanes.items.forEach((item) => {
    const baseline = 30 + 12 + item.offset;
    labelBottom.set(item.a, baseline + (item.lines.length - 1) * 16 + 4);
    children.push(ctx.textLines(item.cx, baseline, item.lines, { anchor: 'middle', size: 12, fill: ctx.textColor('accent'), meta: { kind: 'annotation', label: item.a.label } }));
  });
  annotations.forEach((annotation) => {
    const from = annotation.kind === 'rule' ? annotation.value : annotation.from;
    const to = annotation.kind === 'rule' ? annotation.value : annotation.to;
    // 参考线向上延伸到自己的标签下沿。
    if (annotation.kind === 'rule') children.push(ctx.line(x(from), (labelBottom.get(annotation) ?? top - 2) + 2, x(from), bottom, { stroke: ctx.color('accent'), 'stroke-width': 1.5, 'stroke-dasharray': '4 4', meta: { kind: 'annotation', label: annotation.label || '' } }));
    else children.push(ctx.rect(x(from), top, Math.max(0, x(to) - x(from)), bottom - top, { fill: ctx.color('accent'), 'fill-opacity': 0.12, meta: { kind: 'annotation', label: annotation.label || '' } }));
  });
  const unit = spec.unitMark.value, label = spec.unitMark.label; let clipIndex = 0;
  rows.forEach((row, index) => {
    const bx = x(row[e.lower]), bw = x(row[e.upper]) - bx, barHeight = y(0) - y(densities[index]);
    const count = unitCount(row[e.count], unit, ctx);
    if (row[e.count] === 0) return;
    const slotHeight = barHeight / count, gap = slotHeight * 0.1, symbolHeight = slotHeight - gap;
    for (let mark = 0; mark < Math.ceil(count); mark += 1) {
      const fraction = mark === Math.floor(count) && count % 1 > 0 ? count % 1 : 1;
      const bandY = bottom - (mark + 1) * slotHeight, markY = bandY + gap / 2;
      const visibleHeight = symbolHeight * fraction, clipY = markY + symbolHeight * (1 - fraction), id = `hist-unit-clip-${clipIndex++}`;
      requireReadableSlot(bw, visibleHeight, 8, ctx, '增大图表宽度或unitMark.value，确保分箱与单位档均可辨认');
      children.push(clipRect(ctx, id, bx, clipY, bw, visibleHeight));
      children.push(ctx.rect(bx, markY, bw, symbolHeight, { rx: Math.min(4, bw / 2, symbolHeight / 2), fill: ctx.color('tone1'), 'clip-path': `url(#${id})`, meta: { kind: 'record', record: String(index), value: row[e.count], unit, fraction, lower: row[e.lower], upper: row[e.upper] } }));
    }
  });
  const boundaryX = boundaryLabels.map(x);
  const boundaryWidth = boundaryText.map((text) => ctx.measure(text, 12, 400));
  // 文字框按实际绘制位置计算：首个左对齐、末个右对齐、其余居中并夹在绘图区内。
  const lastBoundary = boundaryLabels.length - 1;
  const boundaryLeft = (index) => {
    const width = boundaryWidth[index];
    if (index === 0) return boundaryX[index];
    if (index === lastBoundary) return boundaryX[index] - width;
    return Math.max(left + width / 2, Math.min(right - width / 2, boundaryX[index])) - width / 2;
  };
  const boundaryRight = (index) => boundaryLeft(index) + boundaryWidth[index];
  // Thin by one uniform step that keeps both ends; only the final gap may be shorter.
  let visible = lastBoundary > 0 ? [0, lastBoundary] : [0];
  for (let step = 1; step < lastBoundary; step += 1) {
    const pick = [];
    for (let index = 0; index < lastBoundary; index += step) pick.push(index);
    pick.push(lastBoundary);
    while (pick.length > 2 && boundaryLeft(lastBoundary) < boundaryRight(pick.at(-2)) + 8) pick.splice(-2, 1);
    if (pick.every((index, k) => !k || boundaryLeft(index) >= boundaryRight(pick[k - 1]) + 8)) { visible = pick; break; }
  }
  boundaryLabels.forEach((tick, index) => {
    if (!visible.includes(index)) return;
    const anchor = index === 0 ? 'start' : index === boundaryLabels.length - 1 ? 'end' : 'middle';
    const half = ctx.measure(boundaryText[index], 12, 400) / 2;
    const px = anchor === 'start' ? boundaryX[index] : anchor === 'end' ? boundaryX[index] : Math.max(left + half, Math.min(right - half, boundaryX[index]));
    children.push(ctx.text(px, bottom + 20, boundaryText[index], { anchor, size: 12, fill: ctx.color('muted') }));
  });
  children.push(ctx.line(left, bottom, right, bottom, { stroke: ctx.color('axis'), 'stroke-width': 1 }));
  const countField = ctx.field(e.count), binField = ctx.field(e.lower);
  const countLabel = countField.label && countField.label !== e.count ? countField.label : (isEnglish(ctx.lang) ? 'Frequency' : '频数');
  const areaLabel = `${countLabel} / ${binField.unit || (isEnglish(ctx.lang) ? 'bin width' : '箱宽')}`;
  const chart = { width: Math.max(ctx.width, right), height: bottom + 32, children, title: spec.title || 'histogram chart', description: 'Histogram uses actual bin widths; each rung area represents frequency.' };
  return withHeader(chart, ctx, `${unitDescription(spec, ctx, e.count)} · ${areaLabel}`, { meta: { kind: 'unit-mark-label', label, value: unit } });
}

// 变体可能移动读数；相同文本落在同一位置时只保留一个，避免装饰后的重复刻度互相覆盖。
function dedupeReadouts(scene) {
  const seen = new Set();
  const visit = (nodes) => (nodes || []).flatMap((node) => {
    if (node.tag === 'text' && node.meta?.kind === 'value') {
      const key = `${node.text}@${Math.round(Number(node.attrs.x))},${Math.round(Number(node.attrs.y))}`;
      if (seen.has(key)) return [];
      seen.add(key);
    }
    if (node.children) return [{ ...node, children: visit(node.children) }];
    return [node];
  });
  return { ...scene, children: visit(scene.children) };
}
function decorate(spec, ctx, next) {
  const variant = spec.variant;
  if (!variant || variant === 'solid') return next();
  if (['bar', 'column'].includes(spec.chart)) {
    if (!['rungs', 'pictorial', 'lollipop'].includes(variant)) return next();
    if (variant === 'lollipop') return dedupeReadouts(lollipop(spec, ctx, next()));
    if (spec.stack === 'percent') ctx.fit('单位计数不适用于百分比堆叠', '改用solid变体或绝对堆叠');
    const fields = Array.isArray(spec.encode.value) ? spec.encode.value : [spec.encode.value];
    ensureSymbolBudget(spec.data.flatMap((row) => fields.map((field) => row[field])), spec.unitMark.value, ctx);
    return dedupeReadouts(unitMarks(spec, ctx, next(), variant === 'pictorial' ? 'pictorial' : 'rungs'));
  }
  if (spec.chart === 'dumbbell' && variant === 'rungs') return dumbbellRungs(spec, ctx);
  if (spec.chart === 'waterfall' && variant === 'rungs') return waterfall(spec, ctx, next);
  if (spec.chart === 'histogram' && variant === 'rungs') return histogram(spec, ctx);
  return next();
}

// Registers into the caller's registry so a Node build can assemble an isolated subset.
export function install({ layouts, decorate: registerDecorator }) {
  const available = ['bar', 'column', 'dumbbell', 'waterfall', 'histogram'].filter((name) => layouts.has(name));
  if (available.length) registerDecorator(available, decorate);
}

install({ layouts, decorate: registerDecorator });
