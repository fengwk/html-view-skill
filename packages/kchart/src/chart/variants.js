/* Controlled editorial variants for KChart's existing chart registrations. */

import { decorate } from './registry.js';
import './basic.js';
import './statistics.js';
import { columnHeaders, apportion } from '../core/geometry.js';

const tone = (ctx, i) => ctx.color(`tone${i % 6 + 1}`);
const isEnglish = (ctx) => /^en(?:-|$)/i.test(String(ctx.lang || ''));
const scene = (base, width, height, children) => ({ ...base, width, height, children });
const path = (points, close = false) => points.length
  ? `${points.map(([x, y], i) => `${i ? 'L' : 'M'}${Number(x.toFixed(2))},${Number(y.toFixed(2))}`).join(' ')}${close ? ' Z' : ''}` : '';

const visit = (nodes, fn, parents = []) => {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    fn(node, nodes, i, parents);
    if (node.children) visit(node.children, fn, [...parents, node]);
  }
};

function lineVariant(spec, ctx, next) {
  if (!spec.variant) return next();
  const base = next();
  const data = ctx.table(spec);
  const series = data.series;
  if (spec.variant === 'counter') {
    const rows = [];
    series.forEach((item, seriesIndex) => {
      let last = -1;
      item.values.forEach((value, i) => { if (value != null) last = i; });
      if (last < 0) return;
      const raw = item.values[last];
      const plotted = spec.stack === 'absolute'
        ? series.slice(0, seriesIndex).reduce((sum, prior) => {
          const value = prior.values[last] ?? 0;
          return sum + (value === 0 || Math.sign(value) === (raw < 0 ? -1 : 1) ? value : 0);
        }, raw)
        : raw;
      const value = ctx.format(plotted, item.field);
      const valueWidth = ctx.measure(value, 16, 700);
      const label = `${item.label} · ${data.categories[last]}`;
      const lines = ctx.wrap(label, Math.max(40, base.width - valueWidth - 40), 12);
      const emphasis = spec.emphasis || {};
      const selected = (emphasis.series || []).includes(item.id) || (emphasis.fields || []).includes(item.field);
      const active = (emphasis.series || []).length > 0 || (emphasis.fields || []).length > 0;
      const fill = selected ? ctx.color('accent') : tone(ctx, seriesIndex);
      rows.push({ item, last, raw, plotted, value, lines, fill, opacity: active && !selected ? 0.28 : 1, height: Math.max(36, lines.length * 16 + 12) });
    });
    const readoutHeight = rows.reduce((sum, row) => sum + row.height, 0);
    const children = [];
    let y = 0;
    rows.forEach(({ item, last, raw, plotted, value, lines, fill, opacity, height }) => {
      children.push(ctx.textLines(12, y + 15, lines, { fill: ctx.color('muted'), size: 12 }));
      children.push(ctx.text(base.width - 12, y + Math.max(22, (height + 16) / 2), value, {
        anchor: 'end', size: 16, weight: 700, fill, 'fill-opacity': opacity,
        meta: { kind: 'counter', series: item.id, value: raw, plotted, label: String(data.categories[last]) },
      }));
      y += height;
    });
    children.push(ctx.el('g', { transform: `translate(0 ${readoutHeight})` }, base.children));
    return scene(base, base.width, base.height + readoutHeight, children);
  }

  // Keep the default plot, axes, domains, confidence band, annotations, records and labels.
  // Only remove the decorative trend/gradient; barcode stems reuse the exact point coordinates.
  const marks = [];
  visit(base.children, (node, siblings, index, parents) => {
    if (node.tag === 'circle' && node.meta?.kind === 'record') marks.push(node);
  });
  const yAxis = base.children.find((node) => node.tag === 'line'
    && node.attrs.stroke === ctx.color('axis')
    && Number(node.attrs.y1) === Number(node.attrs.y2));
  const baseline = yAxis ? Number(yAxis.attrs.y1) : Math.max(...marks.map((node) => Number(node.attrs.cy)));
  const children = [];
  const cleaned = (node) => {
    if (node.tag === 'defs' && (node.children || []).some((child) => child.attrs?.id === 'basic-line-gradient')) return null;
    if (node.tag === 'path' && (node.attrs.fill === 'url(#basic-line-gradient)'
      || (node.attrs.fill === 'none' && node.meta?.kind === 'series'))) return null;
    const copy = { ...node };
    if (node.children) copy.children = node.children.map(cleaned).filter(Boolean);
    return copy;
  };
  let inserted = false;
  base.children.forEach((child) => {
    const node = cleaned(child);
    if (!node) return;
    if (!inserted && child.tag === 'circle' && child.meta?.kind === 'record') {
      marks.forEach((mark) => children.push(ctx.line(mark.attrs.cx, baseline, mark.attrs.cx, mark.attrs.cy, {
        stroke: mark.attrs.fill || ctx.color('ink'), 'stroke-width': 1,
        'stroke-opacity': mark.attrs['fill-opacity'] ?? 1,
        meta: { kind: 'barcode', record: mark.meta.record, series: mark.meta.series, value: mark.meta.value, label: mark.meta.label },
      })));
      inserted = true;
    }
    children.push(node);
  });
  if (!inserted) marks.forEach((mark) => children.push(ctx.line(mark.attrs.cx, baseline, mark.attrs.cx, mark.attrs.cy, {
    stroke: mark.attrs.fill || ctx.color('ink'), 'stroke-width': 1,
    meta: { kind: 'barcode', record: mark.meta.record, series: mark.meta.series, value: mark.meta.value, label: mark.meta.label },
  })));
  return scene(base, base.width, base.height, children);
}

function shareTicks(spec, ctx, next) {
  if (spec.variant !== 'ticks') return next();
  const data = ctx.table(spec), children = [], tickCount = 24, rowH = 22;
  const categories = data.categories, colors = categories.map((_, i) => tone(ctx, i));
  const legend = ctx.legend(categories.map((label, i) => ({ label: String(label), color: colors[i], meta: { kind: 'category', label } })), ctx.width - 32);
  children.push(...legend.children);
  // 与实心占比条共用行几何：系列名列按测得文字留宽，能单行就单行，否则折行后取最宽一行。
  const labelColumn = Math.max(36, ...data.series.map((series) => {
    const full = ctx.measure(String(series.label), 12, 500);
    if (full <= ctx.width * 0.42) return full;
    const lines = ctx.wrap(series.label, Math.max(36, ctx.width * 0.42), 12, 500);
    return Math.max(...lines.map((line) => ctx.measure(line, 12, 500)));
  }));
  const left = labelColumn + 24;
  const longestReadout = Math.max(40, ...data.series.flatMap((series) => {
    const total = series.values.reduce((sum, value) => sum + (value ?? 0), 0) || 1;
    const items = series.values.map((value, i) => `${categories[i]} ${ctx.percent((value ?? 0) / total)}`);
    items.push(`${isEnglish(ctx) ? 'total' : '合计'} ${ctx.format(series.values.reduce((sum, value) => sum + (value ?? 0), 0), series.field)}`);
    return items.map((item) => ctx.measure(item, 12));
  }));
  const chartWidth = Math.max(ctx.width, left + Math.min(longestReadout, 220) + 20);
  const right = chartWidth - 10;
  let y = 8 + legend.height + (legend.height ? 8 : 0);
  data.series.forEach((series) => {
    const values = series.values.map((value) => value ?? 0);
    const total = values.reduce((sum, value) => sum + value, 0);
    if (values.some((value) => value < 0) || !(total > 0)) ctx.fit('ticks占比要求非负且总值大于0', '修正数据或使用solid占比图');
    const top = y + 20;
    const label = ctx.wrap(series.label, Math.max(18, labelColumn), 12, 500);
    children.push(ctx.textLines(left - 12, top + rowH / 2 + 4 - (label.length - 1) * 8, label, {
      anchor: 'end', fill: ctx.color('fg'), meta: { kind: 'series', series: series.id },
    }));
    const step = (right - left - 2.2) / (tickCount - 1);
    for (let i = 0; i < tickCount; i += 1) {
      const position = (i + 0.5) / tickCount * total;
      let cumulative = 0;
      let categoryIndex = values.findIndex((value) => { cumulative += value; return position < cumulative; });
      if (categoryIndex < 0) categoryIndex = values.length - 1;
      const x = left + 1.1 + i * step;
      children.push(ctx.line(x, top, x, top + rowH, {
        stroke: colors[categoryIndex], 'stroke-width': 2.2,
        meta: { kind: 'tick', series: series.id, category: categories[categoryIndex], numerator: values[categoryIndex], denominator: total, tickCount },
      }));
    }
    const readouts = values.map((value, i) => `${categories[i]} ${ctx.percent(value / total)}`);
    readouts.push(`${isEnglish(ctx) ? 'total' : '合计'} ${ctx.format(total, series.field)}`);
    const lines = ctx.flow(readouts, right - left, 12);
    lines.forEach((items, i) => children.push(ctx.text(left, top + rowH + 16 + i * 16, items.join(' · '), {
      size: 12, fill: ctx.color('muted'), meta: { kind: 'readout', series: series.id, items },
    })));
    y += Math.max(50, 28 + label.length * 16) + lines.length * 16;
  });
  const base = next();
  return scene(base, Math.max(chartWidth, base.width, right + 10), y + 4, children);
}

function hourglass(spec, ctx, next) {
  if (spec.variant !== 'hourglass') return next();
  const base = next(), data = ctx.table(spec), values = data.series[0].values, field = data.valueFields[0];
  if (values.some((value) => value == null || value < 0) || !(values[0] > 0)
    || values.some((value, i) => i > 0 && value > values[i - 1])) {
    ctx.fit('hourglass要求非负且逐级不增，首步大于0', '修正阶段数据或使用bars漏斗');
  }
  const english = isEnglish(ctx), max = values[0];
  // 左标签列按测得宽度：短名单行，长名折行后取最宽一行，不再收成最短一项。
  const labelLimit = Math.max(72, Math.min(160, ctx.width * 0.36));
  const labelWidth = Math.max(48, ...data.categories.map((label) => {
    const full = ctx.measure(String(label), 12, 600);
    if (full + 8 <= labelLimit) return full + 8;
    const lines = ctx.wrap(String(label), labelLimit, 12, 600);
    return Math.max(...lines.map((line) => ctx.measure(line, 12, 600))) + 8;
  }));
  const rows = values.map((value, i) => {
    const previous = i ? values[i - 1] : null;
    const amount = ctx.format(value, field);
    const share = `${english ? 'Of first stage' : '占首步'} ${ctx.percent(value / max)}`;
    const prior = i === 0 ? '' : previous === 0
      ? (english ? 'Previous step is 0' : '上一步为0，不可计算')
      : `${english ? 'Of previous step' : '占上一步'} ${ctx.percent(value / previous)}`;
    const labelLines = ctx.wrap(String(data.categories[i]), labelWidth, 12, 600);
    return { value, i, amount, share, prior, labelLines };
  });
  const readoutWidth = Math.max(40, ...rows.flatMap(row => [
    ctx.measure(row.amount, 14, 700), ctx.measure(row.share, 12), row.prior ? ctx.measure(row.prior, 12) : 0,
  ]));
  const requiredWidth = 8 + labelWidth + 8 + 90 + 8 + readoutWidth + 8;
  const width = Math.max(ctx.width, requiredWidth);
  const shapeX = 8 + labelWidth + 8;
  const shapeWidth = Math.min(440, width - (32 + labelWidth + readoutWidth));
  const center = shapeX + shapeWidth / 2, rightX = shapeX + shapeWidth + 8;
  const children = [], top = 12, lastIndex = rows.length - 1;
  let y = top;
  rows.forEach((row) => {
    const rowHeight = Math.max(64, row.labelLines.length * 16 + 16);
    const currentWidth = shapeWidth * row.value / max;
    const nextWidth = row.i < lastIndex ? shapeWidth * values[row.i + 1] / max : currentWidth;
    const shapeTop = y, shapeBottom = y + rowHeight - 4;
    const lowerLeft = center - nextWidth / 2, lowerRight = center + nextWidth / 2;
    const upperLeft = center - currentWidth / 2, upperRight = center + currentWidth / 2;
    const contour = `M ${upperLeft} ${shapeTop} C ${upperLeft} ${shapeTop + rowHeight * 0.42} ${lowerLeft} ${shapeTop + rowHeight * 0.58} ${lowerLeft} ${shapeBottom} L ${lowerRight} ${shapeBottom} C ${lowerRight} ${shapeTop + rowHeight * 0.58} ${upperRight} ${shapeTop + rowHeight * 0.42} ${upperRight} ${shapeTop} Z`;
    children.push(ctx.path(contour, { fill: ctx.mix(ctx.palette.tone1, ctx.palette.bg, 0.12), stroke: ctx.color('ink'), 'stroke-width': 1, meta: { kind: 'stage', label: data.categories[row.i], value: row.value, shapeWidth } }));
    const labelY = y + (rowHeight - (row.labelLines.length - 1) * 16) / 2 + 4;
    children.push(ctx.textLines(8, labelY, row.labelLines, { size: 12, weight: 600, fill: ctx.color('fg') }));
    const valueY = y + 18;
    children.push(ctx.text(rightX, valueY, row.amount, { size: 14, weight: 700, fill: ctx.color('fg') }));
    children.push(ctx.text(rightX, valueY + 18, row.share, { size: 12, fill: ctx.color('muted') }));
    if (row.prior) children.push(ctx.text(rightX, valueY + 36, row.prior, { size: 12, fill: ctx.color('muted') }));
    y += rowHeight;
  });
  return scene(base, width, y + 8, children);
}

function plumb(spec, ctx, next) {
  if (spec.variant !== 'plumb') return next();
  const base = next();
  const horizontalGrid = [];
  let marks = [];
  visit(base.children, (node, siblings, index) => {
    if (node.tag === 'line' && Number(node.attrs.y1) === Number(node.attrs.y2)
      && node.attrs.stroke === ctx.palette.grid) horizontalGrid.push(Number(node.attrs.y1));
    if (node.tag === 'circle' && Number.isFinite(Number(node.attrs.cx)) && Number.isFinite(Number(node.attrs.cy))) marks.push({ node, siblings, index });
  });
  const bottom = horizontalGrid.length ? Math.max(...horizontalGrid) : Math.max(...marks.map((mark) => Number(mark.node.attrs.cy)));
  if (!Number.isFinite(bottom)) return base;
  const stems = marks.map(({ node }) => ctx.line(Number(node.attrs.cx), bottom, Number(node.attrs.cx), Number(node.attrs.cy), {
    stroke: ctx.color('muted'), 'stroke-width': 1, meta: { kind: 'plumb', x: Number(node.attrs.cx), y: Number(node.attrs.cy) },
  }));
  let inserted = false;
  const children = [];
  base.children.forEach((child) => {
    const containsMark = (() => { let found = false; visit([child], (node) => { if (node.tag === 'circle' && marks.some((mark) => mark.node === node)) found = true; }); return found; })();
    if (!inserted && containsMark) { children.push(...stems); inserted = true; }
    children.push(child);
  });
  if (!inserted) children.unshift(...stems);
  return scene(base, base.width, base.height, children);
}

function heatmap(spec, ctx, next) {
  if (!['dots', 'arc'].includes(spec.variant)) return next();
  const base = next(), e = spec.encode, rows = spec.data;
  const rowNames = ctx.field(e.row).domain || [...new Set(rows.map((row) => row[e.row]))];
  const colNames = ctx.field(e.column).domain || [...new Set(rows.map((row) => row[e.column]))];
  const meta = ctx.field(e.value), values = rows.map((row) => row[e.value]).filter(Number.isFinite);
  const maxValue = meta.domain?.[1] ?? Math.max(1, ...values.filter((value) => value >= 0));
  const maxMagnitude = Math.max(1, ...values.map(Math.abs), ...(meta.domain || []).map(Math.abs));
  const rowLabelWidth = Math.min(Math.max(0, ...rowNames.map((label) => ctx.measure(String(label), 12, 400) + 8)), Math.max(72, ctx.width * 0.28));
  const left = rowLabelWidth + 8;
  const headers = columnHeaders(ctx, colNames, { left, right: 8 });
  const cw = headers.slot;
  const ringRadius = Math.max(5, Math.min(12, (cw - 4) * 0.34));
  const years = headers.years;
  const headerHeight = Math.max(1, ...headers.items.map((item) => item.lines.length || 1)) * 16;
  const rowLineCount = Math.max(1, ...rowNames.map((label) => ctx.wrap(String(label), rowLabelWidth, 12).length));
  const top = 20 + (years ? 16 : 0) + headerHeight, ch = Math.max(42, rowLineCount * 20 + 8), children = [];
  headers.items.forEach((item, j) => {
    if (item.year) children.push(ctx.text(left + j * cw, 12, item.year, { size: 12, fill: ctx.color('muted') }));
    if (item.lines.length) children.push(ctx.textLines(left + (j + 0.5) * cw, years ? 32 : 16, item.lines, { anchor: 'middle', size: 12, fill: ctx.color('muted') }));
  });
  rowNames.forEach((label, i) => {
    const y = top + i * ch;
    const rowLines = ctx.wrap(String(label), rowLabelWidth, 12);
    children.push(ctx.textLines(left - 8, y + (ch - (rowLines.length - 1) * 20) / 2 + 4, rowLines, { anchor: 'end', size: 12, fill: ctx.color('muted'), leading: 20 }));
    colNames.forEach((column, j) => {
      const x = left + j * cw, row = rows.find((item) => item[e.row] === label && item[e.column] === column);
      // 点与环居中于列，和列头文字共用同一中轴。
      const cx = x + cw / 2, cy = y + ch / 2;
      if (!row || row[e.value] == null) {
        children.push(ctx.circle(cx, cy, 3, { fill: 'none', stroke: ctx.color('axis'), 'stroke-width': 1, meta: { kind: 'missing', row: label, column } }));
        return;
      }
      const value = row[e.value], formatted = ctx.format(value, e.value);
      const tip = `${label} · ${column}: ${formatted}`;
      if (spec.variant === 'dots') {
        if (value === 0) {
          const dot = ctx.circle(cx, cy, 3, { fill: 'none', stroke: ctx.color('ink'), 'stroke-width': 1.5, meta: { kind: 'zero', row: label, column, value } });
          children.push(ctx.titled(dot, tip));
        } else {
          const radius = Math.sqrt(Math.abs(value) / maxMagnitude) * ringRadius;
          const dot = ctx.circle(cx, cy, radius, { fill: value < 0 ? ctx.color('accent') : ctx.color('ink'), 'fill-opacity': 0.82, meta: { kind: 'cell', row: label, column, value, area: Math.abs(value) } });
          children.push(ctx.titled(dot, tip));
        }
      } else {
        const ratio = meta.format === 'percent' ? value : value / maxValue;
        const progress = Math.max(0, Math.min(1, ratio)), endX = cx + ringRadius * Math.sin(progress * Math.PI * 2), endY = cy - ringRadius * Math.cos(progress * Math.PI * 2);
        children.push(ctx.circle(cx, cy, ringRadius, { fill: 'none', stroke: ctx.color('grid'), 'stroke-width': 3, meta: { kind: 'arc-track', row: label, column, maximum: meta.format === 'percent' ? 1 : maxValue } }));
        if (progress > 0) {
          const d = progress >= 1
            ? `M ${cx} ${cy - ringRadius} A ${ringRadius} ${ringRadius} 0 1 1 ${cx} ${cy + ringRadius} A ${ringRadius} ${ringRadius} 0 1 1 ${cx} ${cy - ringRadius}`
            : `M ${cx} ${cy - ringRadius} A ${ringRadius} ${ringRadius} 0 ${progress > 0.5 ? 1 : 0} 1 ${endX} ${endY}`;
          const arc = ctx.path(d, { fill: 'none', stroke: ctx.color('ink'), 'stroke-width': 3, 'stroke-linecap': 'round', meta: { kind: 'cell', row: label, column, value, maximum: meta.format === 'percent' ? 1 : maxValue } });
          children.push(ctx.titled(arc, tip));
        } else {
          const zero = ctx.circle(cx, cy, 1.5, { fill: 'none', stroke: ctx.color('ink'), 'stroke-width': 1, meta: { kind: 'cell', row: label, column, value, maximum: meta.format === 'percent' ? 1 : maxValue } });
          children.push(ctx.titled(zero, tip));
        }
      }
    });
  });
  const chartWidth = Math.max(ctx.width, left + colNames.length * cw + 8);
  const maximumLabel = meta.format === 'percent' ? (isEnglish(ctx) ? 'Full arc = 100%' : '整弧 = 100%')
    : `${isEnglish(ctx) ? 'Full arc' : '整弧'} = ${ctx.format(maxValue, e.value)}`;
  const hasMissing = rowNames.some((row) => colNames.some((column) => {
    const cell = rows.find((item) => item[e.row] === row && item[e.column] === column);
    return !cell || cell[e.value] == null;
  }));
  const missingNote = hasMissing ? (isEnglish(ctx) ? 'Hollow ring = missing.' : '空心环表示缺失。') : '';
  const note = spec.variant === 'arc'
    ? [isEnglish(ctx) ? `${maximumLabel}; arc fraction is measured from zero.` : `${maximumLabel}；弧长按从零起的比例表示。`, missingNote].filter(Boolean).join(' ')
    : [isEnglish(ctx) ? 'Dot area is proportional to absolute value; a hollow ring marks zero.' : '点面积与绝对值成比例；空心点表示零。', missingNote].filter(Boolean).join(' ');
  const noteLines = ctx.wrap(note, Math.max(40, chartWidth - left - 16), 12);
  children.push(ctx.textLines(left, top + rowNames.length * ch + 20, noteLines, { size: 12, fill: ctx.color('muted') }));
  return scene(base, chartWidth, top + rowNames.length * ch + 32 + (noteLines.length - 1) * 16, children);
}

function waffleField(spec, ctx, next) {
  if (spec.variant !== 'field') return next();
  const base = next(), data = ctx.table(spec), values = data.series[0].values;
  const total = values.reduce((sum, value) => sum + (value ?? 0), 0);
  if (values.some((value) => value == null || value < 0) || !(total > 0)) ctx.fit('waffle field要求非负且合计大于0', '修正数值或使用适合的比较图');
  const counts = apportion(values, 100);
  const width = Math.max(ctx.width, 260), cols = 5, pitch = 15, radius = 4, top = 24, children = [];
  const categoryLabels = data.categories.map((label, i) => `${label} · ${ctx.percent(values[i] / total)}`);
  const pointWidth = (cols - 1) * pitch + radius;
  const labelWidth = Math.max(40, Math.min(width - 32 - pointWidth - 16, ...categoryLabels.map((label) => ctx.measure(label, 12, 600))));
  const contentWidth = pointWidth + 16 + labelWidth;
  const left = Math.max(18, (width - contentWidth) / 2), labelX = left + pointWidth + 16;
  let cursorY = top;
  counts.forEach((count, category) => {
    const rows = Math.ceil(count / cols), pointHeight = Math.max(1, rows) * pitch;
    const label = categoryLabels[category];
    const labelLines = ctx.wrap(label, labelWidth, 12, 600, { bounded: true });
    const groupHeight = Math.max(pointHeight, labelLines.length * 16);
    const pointTop = cursorY + (groupHeight - pointHeight) / 2;
    for (let index = 0; index < count; index += 1) {
      const x = left + (index % cols) * pitch;
      const y = pointTop + Math.floor(index / cols) * pitch;
      children.push(ctx.circle(x, y, radius, { fill: tone(ctx, category), meta: { kind: 'unit', category: data.categories[category], percent: 1, index } }));
    }
    // 标签紧挨同色点场：用页面前景色，不用系列色。系列色在暗色主题里和点场融在一起。
    children.push(ctx.textLines(labelX, cursorY + (groupHeight - labelLines.length * 16) / 2 + 12, labelLines, {
      size: 12, weight: 600, fill: ctx.color('fg'), meta: { kind: 'category', label: data.categories[category], percent: counts[category] },
    }));
    cursorY += groupHeight + 10;
  });
  const note = isEnglish(ctx)
    ? '100 points; each point = 1 percentage point. Largest-remainder rounding; points are not individuals.'
    : '共100点，每点表示1个百分点；按最大余数法舍入，不代表真实个体。';
  // 中文禁则移动标点后，重新确认整行仍在两侧留白内。
  const noteLines = ctx.wrap(note, width - 32, 12, 400, { bounded: true });
  const noteY = cursorY + 4;
  children.push(ctx.textLines(16, noteY, noteLines, { size: 12, fill: ctx.color('muted') }));
  const height = noteY + noteLines.length * 16 + 8;
  return scene(base, width, height, children);
}

// Registers into the caller's registry so a Node build can assemble an isolated subset.
export function install({ decorate }) {
  const decorated = (name, fn) => decorate(name, (spec, ctx, next) => fn(spec, ctx, next));

  decorated('line', lineVariant);
  decorated('share', shareTicks);
  decorated('funnel', hourglass);
  decorated('scatter', plumb);
  decorated('heatmap', heatmap);
  decorated('waffle', waffleField);
}

install({ decorate });
