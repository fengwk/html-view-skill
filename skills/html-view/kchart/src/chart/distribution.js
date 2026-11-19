/* KChart distribution layouts. Pure scene generation; no DOM access. */
KChart.define('chart/distribution', ({ 'chart/registry': { register } }) => {

  const RIGHT = 24, PLOT_TOP = 48, PLOT_HEIGHT = 270;
  const range = (ctx, values, field, zero = false) => ctx.ticks(values, field, { zero, count: 4 });
  const field = (spec, role) => spec.encode[role];
  const numericAnnotationValues = (spec, fields) => (spec.annotations || []).filter((item) => fields.has(item.field) && ['rule', 'band'].includes(item.kind))
    .flatMap((item) => item.kind === 'rule' ? [item.value] : [item.from, item.to]);

  function chartFrame(spec, ctx, values, valueField, zero = false, valueFields = [valueField], { thin = false } = {}) {
    const scale = range(ctx, [...values, ...numericAnnotationValues(spec, new Set(valueFields))], valueField, zero);
    const axisWidth = Math.max(0, ...scale.labels.map((label) => ctx.measure(label, 12, 400)));
    const categoryValues = ctx.table(spec).categories;
    const categoryCount = Math.max(1, categoryValues.length);
    const tokenWidth = Math.max(0, ...categoryValues.map((value) => Math.max(
      ...String(value).trim().split(/\s+/).map((token) => ctx.measure(token, 12, 400)),
    )));
    // 逐个显示类别名的图按最宽不可断词留槽；会抽稀类别名的图（thin）只需 28px 标记槽。
    const slotWidth = thin ? 28 : Math.max(28, Math.min(160, tokenWidth + 8));
    const left = Math.max(40, Math.ceil(axisWidth + 18));
    const width = Math.max(ctx.width, left + categoryCount * slotWidth + RIGHT);
    const plot = { x: left, y: PLOT_TOP, w: width - left - RIGHT, h: PLOT_HEIGHT };
    if (plot.w < 100) ctx.fit('可用绘图区过窄', '增加图表宽度');
    const y = ctx.linear(scale.min, scale.max, plot.y + plot.h, plot.y);
    const children = [];
    for (let i = 0; i < scale.ticks.length; i += 1) {
      const yy = y(scale.ticks[i]);
      children.push(ctx.line(plot.x, yy, plot.x + plot.w, yy, { stroke: ctx.color('grid'), 'stroke-width': 0.7 }));
      children.push(ctx.text(plot.x - 9, yy + 4, scale.labels[i], { anchor: 'end', size: 12, fill: ctx.color('muted') }));
    }
    children.push(ctx.line(plot.x, plot.y, plot.x, plot.y + plot.h, { stroke: ctx.color('axis'), 'stroke-width': 0.8 }));
    children.push(ctx.line(plot.x, plot.y + plot.h, plot.x + plot.w, plot.y + plot.h, { stroke: ctx.color('axis'), 'stroke-width': 0.8 }));
    // 与柱状图一致，数值轴单位写在轴顶左侧；百分比刻度已带 %，不再重复。
    const meta = ctx.field(valueField), unit = meta.format === 'percent' ? '' : String(meta.unit || '').trim();
    if (unit) children.push(ctx.text(8, PLOT_TOP - 30, unit, { anchor: 'start', size: 12, fill: ctx.color('muted'), meta: { kind: 'axis-unit', label: unit } }));
    return { plot, scale, y, children, width };
  }

  function categories(spec, ctx, plot, children, { thin = false } = {}) {
    const category = field(spec, 'category');
    const values = ctx.table(spec).categories;
    const slot = plot.w / Math.max(1, values.length);
    const positions = new Map(values.map((value, i) => [value, plot.x + slot * (i + 0.5)]));
    // 类别名在空白、连字符、斜杠后可换行（如 2026-01 → 2026- / 01）。可抽稀的类别名（如 K 线日期）
    // 在某个不可断片段放不进槽时保持单行、按实测间距抽稀，首末两个始终显示；否则逐个显示并换行。
    const pieces = (value) => String(value).split(/(?<=[\s\-/])/).map((piece) => piece.trim()).filter(Boolean);
    const thinned = thin && values.some((value) => pieces(value).some((piece) => ctx.measure(piece, 12, 400) > slot - 8));
    const wrapped = values.map((value) => thinned ? [String(value)] : ctx.wrap(String(value), Math.max(24, slot - 8), 12, 400));
    const shown = wrapped.map(() => true);
    if (thinned) {
      const widthOf = (index) => ctx.measure(wrapped[index][0], 12, 400);
      const fits = (a, b) => positions.get(values[b]) - positions.get(values[a]) >= (widthOf(a) + widthOf(b)) / 2 + 8;
      let previous = 0;
      for (let i = 1; i < values.length; i += 1) {
        shown[i] = fits(previous, i);
        if (shown[i]) previous = i;
      }
      const last = values.length - 1;
      if (last > 0 && !shown[last]) {
        while (previous > 0 && !fits(previous, last)) {
          shown[previous] = false;
          do previous -= 1; while (previous > 0 && !shown[previous]);
        }
        shown[last] = fits(previous, last);
      }
    }
    for (let i = 0; i < values.length; i += 1) {
      if (!shown[i]) continue;
      children.push(ctx.textLines(positions.get(values[i]), plot.y + plot.h + 20, wrapped[i], { anchor: 'middle', size: 12, fill: ctx.color('muted') }));
    }
    const visibleLines = wrapped.filter((_, index) => shown[index]);
    return { values, slot, positions, category, maxLabelLines: Math.max(1, ...visibleLines.map((lines) => lines.length)) };
  }

  function annotations(spec, ctx, plot, y, children, roles) {
    for (const item of spec.annotations || []) {
      if (item.kind === 'note') {
        const idField = field(spec, 'id');
        const index = spec.data.findIndex((row) => row[idField] === item.record);
        if (index < 0 || !roles.has(item.field)) continue;
        const row = spec.data[index];
        const x = plot.x + plot.w * ((ctx.table(spec).categories.indexOf(row[field(spec, 'category')]) + 0.5) / Math.max(1, ctx.table(spec).categories.length));
        const lines = ctx.wrap(item.text, Math.max(48, plot.x + plot.w - x - 12), 12, 400);
        const note = { size: 12, fill: ctx.color('fg'), meta: { kind: 'annotation-note', record: index, id: item.record, field: item.field } };
        if (lines.length === 1) children.push(ctx.text(x + 7, y(row[item.field]) - 7, lines[0], note));
        else children.push(ctx.textLines(x + 7, y(row[item.field]) - 7 - (lines.length - 1) * 16, lines, note));
        continue;
      }
      if (!roles.has(item.field)) continue;
      if (item.kind === 'band') {
        const y1 = y(item.from), y2 = y(item.to);
        children.push(ctx.rect(plot.x, Math.min(y1, y2), plot.w, Math.max(1, Math.abs(y2 - y1)), { fill: ctx.color('tone3'), 'fill-opacity': 0.12 }));
      } else if (item.kind === 'rule') {
        const yy = y(item.value);
        children.push(ctx.line(plot.x, yy, plot.x + plot.w, yy, { stroke: ctx.color('tone3'), 'stroke-width': 1, 'stroke-dasharray': '4 3' }));
      } else continue;
      if (item.label) {
        const lines = ctx.wrap(item.label, Math.max(48, Math.min(plot.w - 8, 220)), 12, 400);
        const py = y(item.value ?? item.to) - 4 - (lines.length - 1) * 16;
        children.push(ctx.textLines(plot.x + plot.w - 3, py, lines, { anchor: 'end', size: 12, fill: ctx.textColor('tone3') }));
      }
    }
  }

  function finish(ctx, children, plot, cat, width, footer = []) {
    let y = plot.y + plot.h + 40 + (cat.maxLabelLines - 1) * 16;
    const readouts = [];
    for (const item of footer) {
      const lines = ctx.wrap(item.text, width - plot.x - RIGHT, 12, 400);
      readouts.push(ctx.textLines(plot.x, y, lines, { size: 12, fill: ctx.color('muted'), meta: item.meta }));
      y += lines.length * 16 + 3;
    }
    if (readouts.length) children.push(ctx.el('g', { opacity: 0.68 }, readouts));
    return { ...ctx.scene(Math.max(plot.y + plot.h + 48 + (cat.maxLabelLines - 1) * 16, y + (footer.length ? 8 : 0)), children), width };
  }

  function interval(spec, ctx) {
    const low = field(spec, 'low'), high = field(spec, 'high'), estimate = field(spec, 'value');
    const nums = spec.data.flatMap((row) => [row[low], row[high], estimate ? row[estimate] : null]);
    const roles = new Set([low, high, estimate]);
    const f = chartFrame(spec, ctx, nums, low, false, [...roles]);
    const cat = categories(spec, ctx, f.plot, f.children);
    annotations(spec, ctx, f.plot, f.y, f.children, roles);
    const footer = [];
    for (let i = 0; i < spec.data.length; i += 1) {
      const row = spec.data[i], x = cat.positions.get(row[cat.category]);
      if (x === undefined) continue;
      const y1 = f.y(row[low]), y2 = f.y(row[high]);
      const meta = { kind: 'interval', record: i, id: row[field(spec, 'id')] ?? String(i), value: [row[low], row[high]] };
      f.children.push(ctx.line(x, y1, x, y2, { stroke: ctx.color('ink'), 'stroke-width': 1.2, meta }));
      const cap = Math.min(8, cat.slot * 0.16);
      f.children.push(ctx.line(x - cap, y1, x + cap, y1, { stroke: ctx.color('ink'), 'stroke-width': 1.2 }));
      f.children.push(ctx.line(x - cap, y2, x + cap, y2, { stroke: ctx.color('ink'), 'stroke-width': 1.2 }));
      if (estimate) f.children.push(ctx.circle(x, f.y(row[estimate]), 3.2, { fill: ctx.color('accent'), stroke: ctx.color('bg'), 'stroke-width': 1, meta: { kind: 'estimate', record: i, id: meta.id, value: row[estimate] } }));
      footer.push({
        text: `${String(row[cat.category])}: ${ctx.format(row[low], low)} – ${ctx.format(row[high], high)}${estimate ? ` · ${ctx.format(row[estimate], estimate)}` : ''}`,
        meta: { kind: 'interval-readout', record: i, id: meta.id, value: { low: row[low], high: row[high], estimate: estimate ? row[estimate] : null } },
      });
    }
    return finish(ctx, f.children, f.plot, cat, f.width, footer);
  }

  function candlestick(spec, ctx) {
    const open = field(spec, 'open'), close = field(spec, 'close'), low = field(spec, 'low'), high = field(spec, 'high');
    const values = spec.data.flatMap((row) => [row[open], row[close], row[low], row[high]]);
    const fields = [open, close, low, high];
    const f = chartFrame(spec, ctx, values, low, false, fields, { thin: true });
    const cat = categories(spec, ctx, f.plot, f.children, { thin: true });
    annotations(spec, ctx, f.plot, f.y, f.children, new Set(fields));
    for (let i = 0; i < spec.data.length; i += 1) {
      const row = spec.data[i], x = cat.positions.get(row[field(spec, 'category')]);
      if (x === undefined) continue;
      const rising = row[close] >= row[open];
      const top = f.y(Math.max(row[open], row[close]));
      const bottom = f.y(Math.min(row[open], row[close]));
      const bodyW = Math.max(3, Math.min(16, cat.slot * 0.46));
      const id = row[field(spec, 'id')] ?? String(i);
      const meta = { kind: 'candlestick', record: i, id, value: { open: row[open], close: row[close], low: row[low], high: row[high], direction: rising ? 'up' : 'down' } };
      f.children.push(ctx.line(x, f.y(row[high]), x, f.y(row[low]), { stroke: ctx.color('ink'), 'stroke-width': 1, meta: { kind: 'candle-wick', record: i, id } }));
      if (row[open] === row[close]) {
        f.children.push(ctx.line(x - bodyW / 2, top, x + bodyW / 2, top, { stroke: ctx.color('ink'), 'stroke-width': 1.5, meta }));
      } else {
        f.children.push(ctx.rect(x - bodyW / 2, top, bodyW, bottom - top, {
          fill: rising ? ctx.color('bg') : ctx.color('ink'), stroke: ctx.color('ink'), 'stroke-width': 1.1, meta,
        }));
      }
    }
    const directions = new Set(spec.data.map((row) => row[close] > row[open] ? 'up' : row[close] < row[open] ? 'down' : 'flat'));
    const english = /^en(?:-|$)/i.test(ctx.lang);
    const legendItems = [
      ...(directions.has('up') ? [{ label: english ? 'Rising · hollow' : '上涨 · 空心', color: ctx.color('ink'), mark: 'hollow' }] : []),
      ...(directions.has('down') ? [{ label: english ? 'Falling · filled' : '下跌 · 实心', color: ctx.color('ink'), mark: 'filled' }] : []),
      ...(directions.has('flat') ? [{ label: english ? 'Unchanged · line' : '持平 · 横线', color: ctx.color('ink'), mark: 'line' }] : []),
    ];
    const legend = ctx.legend(legendItems, f.plot.w);
    // Each legend entry is a group holding its swatch; restyle that swatch to match the candle it stands for.
    legend.children.forEach((group, i) => {
      const swatch = group.children.find((child) => child.tag === 'rect');
      const { mark } = legendItems[i];
      if (!swatch || mark === 'filled') return;
      if (mark === 'hollow') Object.assign(swatch.attrs, { fill: ctx.color('bg'), stroke: ctx.color('ink'), 'stroke-width': 1.1 });
      else group.children[group.children.indexOf(swatch)] = ctx.line(swatch.attrs.x, swatch.attrs.y + 5, swatch.attrs.x + 10, swatch.attrs.y + 5, { stroke: ctx.color('ink'), 'stroke-width': 1.5 });
    });
    f.children.push(ctx.el('g', { transform: `translate(${f.plot.x},${f.plot.y - 20})` }, legend.children));
    return finish(ctx, f.children, f.plot, cat, f.width);
  }

  function strip(spec, ctx) {
    const value = field(spec, 'value');
    const vals = spec.data.map((row) => row[value]);
    const f = chartFrame(spec, ctx, vals, value);
    const cat = categories(spec, ctx, f.plot, f.children);
    annotations(spec, ctx, f.plot, f.y, f.children, new Set([value]));
    const byCategory = new Map();
    spec.data.forEach((row, index) => {
      const category = row[cat.category];
      if (!byCategory.has(category)) byCategory.set(category, []);
      byCategory.get(category).push({ row, index, y: f.y(row[value]) });
    });
    for (const [category, points] of byCategory) {
      const center = cat.positions.get(category);
      if (center === undefined) continue;
      const placed = [], maxOffset = Math.max(0, cat.slot / 2 - 3);
      points.sort((a, b) => a.y - b.y || a.index - b.index);
      for (const point of points) {
        const candidates = [0, ...Array.from({ length: Math.ceil(maxOffset / 6) }, (_, i) => (i + 1) * 6).flatMap(offset => [-offset, offset])];
        const offset = candidates.find(candidate => Math.abs(candidate) <= maxOffset && placed.every(other => {
          const dx = candidate - other.offset, dy = point.y - other.y;
          return dx * dx + dy * dy >= 36;
        }));
        const safeOffset = offset ?? Math.max(-maxOffset, Math.min(maxOffset, candidates.at(-1)));
        placed.push({ y: point.y, offset: safeOffset });
        const id = point.row[field(spec, 'id')] ?? String(point.index);
        f.children.push(ctx.circle(center + safeOffset, point.y, 3, { fill: ctx.color('ink'), 'fill-opacity': 0.78, meta: { kind: 'strip', record: point.index, id, value: point.row[value] } }));
      }
    }
    return finish(ctx, f.children, f.plot, cat, f.width);
  }

  function violin(spec, ctx) {
    const category = field(spec, 'category'), density = field(spec, 'density'), median = field(spec, 'median');
    const all = spec.data.flatMap((row) => row[density].map((point) => point[0]).concat(row[median]));
    const f = chartFrame(spec, ctx, all, median);
    const cat = categories(spec, ctx, f.plot, f.children);
    const maxDensity = Math.max(...spec.data.flatMap((row) => row[density].map((point) => point[1])));
    annotations(spec, ctx, f.plot, f.y, f.children, new Set([median]));
    for (let i = 0; i < spec.data.length; i += 1) {
      const row = spec.data[i], x = cat.positions.get(row[category]);
      if (x === undefined) continue;
      const half = Math.min(28, cat.slot * 0.38);
      const left = row[density].map(([v, d]) => `${x - half * d / maxDensity},${f.y(v)}`);
      const right = [...row[density]].reverse().map(([v, d]) => `${x + half * d / maxDensity},${f.y(v)}`);
      const id = row[field(spec, 'id')] ?? String(i);
      const shape = ctx.el('polygon', { points: [...left, ...right].join(' '), fill: ctx.color('bg'), 'fill-opacity': 0.72, stroke: ctx.color('ink'), 'stroke-width': 1 });
      shape.meta = { kind: 'violin', record: i, id };
      f.children.push(shape);
      f.children.push(ctx.line(x - half * 0.48, f.y(row[median]), x + half * 0.48, f.y(row[median]), { stroke: ctx.color('ink'), 'stroke-width': 1.6, meta: { kind: 'median', record: i, id, value: row[median] } }));
    }
    return finish(ctx, f.children, f.plot, cat, f.width);
  }

  register(['interval', 'candlestick', 'strip', 'violin'], (spec, ctx) => {
    if (spec.chart === 'interval') return interval(spec, ctx);
    if (spec.chart === 'candlestick') return candlestick(spec, ctx);
    if (spec.chart === 'strip') return strip(spec, ctx);
    return violin(spec, ctx);
  });
});
