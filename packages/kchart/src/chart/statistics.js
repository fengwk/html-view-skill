/* 统计图族：只消费 KChart 数据与 context，直接生成纯场景节点。 */

import { register } from './registry.js';
import { columnHeaders, labelLanes, apportion } from '../core/geometry.js';
import { compare } from './stat-compare.js';
import { sparkline, smallMultiples } from './stat-trend.js';

// 热力格底色：正值用墨色，负值在暗色主题用强调色、亮色主题用深强调色，按档位与底色混合。
// 最低档仍要带出色相：浅色主题上 8% 墨色与强调色都会浅成同一种灰，符号只能靠图例区分。
const HEAT_SHARES = [0.42, 0.56, 0.7, 0.84, 0.96];
function heatFill(level, negative, ctx) {
  const ink = negative ? (ctx.scheme === 'dark' ? ctx.palette.accent : ctx.palette.tone4) : ctx.palette.ink;
  return ctx.mix(ink, ctx.palette.bg, 1 - HEAT_SHARES[level - 1]);
}

const createScene = (spec, ctx, partial) => {
  const scene = ctx.scene(partial.height, partial.children, `${spec.chart} chart`);
  scene.width = partial.width;
  scene.description = `${spec.chart} statistics chart`;
  return scene;
};

function heatmap(spec, ctx) {
  const e = spec.encode;
  const children = [];
  const rowNames = ctx.field(e.row).domain || [...new Set(spec.data.map((row) => row[e.row]))];
  const colNames = ctx.field(e.column).domain || [...new Set(spec.data.map((row) => row[e.column]))];
  const rowWidth = Math.min(Math.max(0, ...rowNames.map((name) => ctx.measure(String(name), 12, 400) + 8)), Math.max(72, ctx.width * 0.28));
  const left = rowWidth + 8;
  const headers = columnHeaders(ctx, colNames, { left, right: 12 });
  const rowLines = rowNames.map((name) => ctx.wrap(String(name), rowWidth, 12));
  const cw = headers.slot;
  const ch = Math.max(38, Math.max(1, ...rowLines.map((lines) => lines.length)) * 20 + 8);
  const top = 34 + (headers.years ? 16 : 0);
  const values = spec.data.map((row) => row[e.value]).filter(Number.isFinite);
  const [low, high] = ctx.field(e.value).domain || [Math.min(0, ...values), Math.max(0, ...values)];
  const max = Math.max(Math.abs(low), Math.abs(high)) || 1;
  const fillOf = (value) => {
    const level = Math.max(1, Math.min(5, Math.ceil(Math.abs(value) / max * 5)));
    return heatFill(level, value < 0, ctx);
  };
  headers.items.forEach((item, j) => {
    if (item.year) children.push(ctx.text(left + j * cw, 18, item.year, { fill: ctx.palette.muted, 'font-size': 12 }));
    if (item.lines.length) children.push(ctx.textLines(left + (j + 0.5) * cw, headers.years ? 34 : 18, item.lines, { anchor: 'middle', fill: ctx.palette.muted, 'font-size': 12 }));
  });
  rowNames.forEach((name, i) => {
    const y = top + i * ch;
    const lines = rowLines[i];
    children.push(ctx.textLines(left - 8, y + ch / 2 - (lines.length - 1) * 10, lines, { anchor: 'end', fill: ctx.palette.muted, 'font-size': 12, leading: 20 }));
    colNames.forEach((col, j) => {
      const cell = spec.data.find((row) => row[e.row] === name && row[e.column] === col);
      if (!cell || cell[e.value] == null) return;
      const value = cell[e.value];
      const fill = fillOf(value);
      children.push(ctx.rect(left + j * cw + 2, y + 2, cw - 4, ch - 4, {
        rx: 7, fill, meta: { record: `${name}/${col}`, row: name, column: col, value },
      }));
      const formatted = ctx.format(value, e.value);
      if (ctx.measure(formatted, 12, 600) + 8 <= cw) {
        children.push(ctx.text(left + (j + 0.5) * cw, y + 23, formatted, { anchor: 'middle', fill: ctx.textOn(fill), 'font-size': 12, 'font-weight': 600 }));
      }
    });
  });
  const width = Math.max(ctx.width, left + colNames.length * cw + 12);
  const signed = low < 0 && high > 0;
  const english = /^en(?:-|$)/i.test(String(ctx.lang || ''));
  const labels = english ? { low: 'Low', zero: 'Zero', high: 'High' } : { low: '低', zero: '零', high: '高' };
  const endpoint = (value, kind) => ({
    label: `${labels[value === 0 ? 'zero' : kind]} · ${signed && value > 0 ? '+' : ''}${ctx.format(value, e.value)}`,
    color: fillOf(value), meta: { endpoint: kind, value },
  });
  const endpoints = [endpoint(low, 'low')];
  if (signed) endpoints.push(endpoint(0, 'zero'));
  if (high !== low) endpoints.push(endpoint(high, high === 0 ? 'zero' : 'high'));
  const budget = Math.max(48, ctx.width - 24);
  const legend = ctx.legend(endpoints, budget);
  const note = signed
    ? (english ? 'Hue separates negative and positive values. Shade shows magnitude. Blank = missing.'
      : '色相区分负值与正值；颜色强度表示绝对值。空白表示缺失。')
    : (english ? 'Color scale. Blank = missing.' : '色阶对应数值，空白表示缺失。');
  const noteLines = ctx.wrap(note, budget, 12);
  const legendY = top + rowNames.length * ch + 10;
  const noteY = legendY + legend.height + 15;
  children.push(ctx.el('g', { transform: `translate(12 ${legendY})` }, legend.children));
  children.push(ctx.textLines(12, noteY, noteLines, { size: 12, fill: ctx.palette.muted }));
  return { width, height: noteY + (noteLines.length - 1) * 16 + 8, children };
}

function annotatedScene(spec, ctx) {
  const children = [], e = spec.encode;
  const addText = (x, y, text, anchor = 'middle') => children.push(ctx.text(x, y, text, { anchor, fill: ctx.palette.muted, 'font-size': 12 }));
  if (spec.chart === 'scatter') {
    const xs = spec.data.map((r) => r[e.x]), ys = spec.data.map((r) => r[e.y]);
    const fx = ctx.field(e.x), fy = ctx.field(e.y), logX = fx.scale === 'log', logY = fy.scale === 'log';
    if (logX && (fx.domain?.[0] <= 0 || fx.domain?.[1] <= 0) || logY && (fy.domain?.[0] <= 0 || fy.domain?.[1] <= 0)) throw new Error('Log-axis domains must be positive');
    const tx = (v) => logX ? Math.log(v) : v, ty = (v) => logY ? Math.log(v) : v;
    const bounds = (values, meta, transform, fieldName) => {
      const domain = Array.isArray(meta.domain) ? meta.domain.map(transform) : [];
      const annotated = (spec.annotations || []).filter((a) => a.field === fieldName && a.kind !== 'note').flatMap((a) => a.kind === 'rule' ? [a.value] : [a.from, a.to]);
      if (logX && fieldName === e.x || logY && fieldName === e.y) if (annotated.some((value) => value <= 0)) throw new Error('Log-axis annotations must be positive');
      const vals = [...values, ...annotated].map(transform), lo = Math.min(...vals, ...domain), hi = Math.max(...vals, ...domain);
      const span = hi - lo || Math.abs(hi) * 0.1 || 1;
      return meta.domain ? [lo, hi] : [lo - span * 0.06, hi + span * 0.06];
    };
    const [xmin, xmax] = bounds(xs, fx, tx, e.x), [ymin, ymax] = bounds(ys, fy, ty, e.y);
    const xScale = logX ? null : ctx.ticks(xs, e.x, { count: 4, length: Math.max(48, ctx.width - 96) });
    const yScale = logY ? null : ctx.ticks(ys, e.y, { count: 4 });
    const xDomain = xScale ? [xScale.min, xScale.max] : [Math.exp(xmin), Math.exp(xmax)];
    const yDomain = yScale ? [yScale.min, yScale.max] : [Math.exp(ymin), Math.exp(ymax)];
    const yTickLabels = (() => {
      if (fy.scale === 'log') return null;
      return yScale.labels;
    })();
    const logYLabels = logY ? Array.from({ length: Math.max(0, Math.min(10, Math.floor(ymax / Math.LN10) - Math.ceil(ymin / Math.LN10) + 1)) }, (_, index) => ctx.format(10 ** (Math.ceil(ymin / Math.LN10) + index), e.y)) : [];
    const yTickWidth = Math.max(24, ...[...(yTickLabels || []), ...logYLabels].map((label) => ctx.measure(label, 12, 400) + 8));
    const left = Math.max(40, Math.ceil(yTickWidth + 16));
    // 右侧至少留出最大点半径和描边，落在域右端的点不会被画布切掉。
    const markMax = e.size ? 12 : 5;
    const right = ctx.width - Math.max(8, markMax + 2);
    const axisName = (fieldName) => [ctx.field(fieldName).label || fieldName, ctx.field(fieldName).unit].filter(Boolean).join(' · ');
    // 纵轴名写在绘图区左上方，横轴名写在横轴刻度下方右端，各自贴着所指的轴。
    const yTitleLines = ctx.wrap(axisName(e.y), Math.max(48, right - 8), 12, 400);
    const xTitleLines = ctx.wrap(axisName(e.x), Math.max(48, right - left), 12, 400);
    const series = e.series ? [...new Set(spec.data.map((row) => row[e.series]))] : [];
    const legendY = 16 + (series.length ? 20 : 0);
    const legend = ctx.legend(series.map((label, i) => ({ label: String(label), color: ctx.palette[`tone${i % 6 + 1}`] })), Math.max(48, right - left));
    const baseTop = series.length ? legendY + 8 + legend.height : 8;
    // 绘图区高度随宽度变化，宽屏不压扁点云；窄屏至少 200px。
    const plotHeight = Math.round(Math.max(200, Math.min(360, (right - left) * 0.6)));
    const yTitleBlock = yTitleLines.length * 16 + 8;
    let top = baseTop + yTitleBlock, bottom = top + plotHeight;
    const x = (v) => left + (tx(v) - tx(xDomain[0])) / (tx(xDomain[1]) - tx(xDomain[0]) || 1) * (right - left);
    const y = (v) => bottom - (ty(v) - ty(yDomain[0])) / (ty(yDomain[1]) - ty(yDomain[0]) || 1) * (bottom - top);
    const sizeMax = Math.max(1, ...spec.data.map((row) => e.size ? row[e.size] : 1));
    const radiusOf = (row) => e.size ? Math.sqrt(row[e.size] / sizeMax) * markMax : markMax;
    const bandFill = ctx.mix(ctx.palette.accent, ctx.palette.bg, 0.82);
    const notes = placeAnnotations();
    // 放不进绘图区的注释进入图例下方的注释带；绘图区整体下移，已放好的标签跟着平移。
    const bandHeight = notes.banded.length ? notes.banded.reduce((sum, item) => sum + item.lines.length * 16, 0) + 8 : 0;
    top += bandHeight;
    bottom += bandHeight;

    // 注释标签贴近所指的点或参考线：依次试候选位置，避开数据点和已放好的标签，全部落在绘图区内才采用。
    function placeAnnotations() {
      const boxOf = (px, py, lines, anchor) => {
        const width = Math.max(...lines.map((line) => ctx.measure(line, 12, 400)));
        const x0 = anchor === 'end' ? px - width : anchor === 'middle' ? px - width / 2 : px;
        return { x0, x1: x0 + width, y0: py - 12, y1: py + (lines.length - 1) * 16 + 4 };
      };
      const overlaps = (a, b) => a.x0 < b.x1 + 2 && b.x0 < a.x1 + 2 && a.y0 < b.y1 + 2 && b.y0 < a.y1 + 2;
      const blocked = spec.data.map((row) => {
        const cx = x(row[e.x]), cy = y(row[e.y]), r = radiusOf(row);
        return { x0: cx - r, x1: cx + r, y0: cy - r, y1: cy + r };
      });
      const bands = (spec.annotations || []).filter((a) => a.kind === 'band').map((a) => (a.field === e.x
        ? { x0: Math.min(x(a.from), x(a.to)), x1: Math.max(x(a.from), x(a.to)), y0: top, y1: bottom }
        : { x0: left, x1: right, y0: Math.min(y(a.from), y(a.to)), y1: Math.max(y(a.from), y(a.to)) }));
      // 候选位置的基线依赖折行后的行数：baseline(n) 给出首行基线。
      const option = (px, baseline, anchor, width, text) => {
        const lines = ctx.wrap(text, Math.max(48, width), 12, 400);
        const py = baseline(lines.length);
        return { px, py, anchor, lines, box: boxOf(px, py, lines, anchor) };
      };
      const above = (edge) => (n) => edge - 4 - (n - 1) * 16;
      const below = (edge) => () => edge + 14;
      const placed = [], banded = [];
      for (const a of spec.annotations || []) {
        const text = a.kind === 'note' ? a.text : a.label;
        if (!text) continue;
        let options = [];
        if (a.kind === 'note') {
          const row = spec.data.find((candidate) => candidate[e.id] === a.record);
          if (!row) continue;
          const cx = x(row[e.x]), cy = y(row[e.y]), r = radiusOf(row);
          options = [
            option(cx + r + 3, above(cy), 'start', right - cx - r - 3, text),
            option(cx + r + 3, below(cy), 'start', right - cx - r - 3, text),
            option(cx - r - 3, above(cy), 'end', cx - r - 3 - left, text),
            option(cx - r - 3, below(cy), 'end', cx - r - 3 - left, text),
            option(cx, above(cy - r - 2), 'middle', Math.min(160, right - left), text),
            option(cx, below(cy + r + 2), 'middle', Math.min(160, right - left), text),
          ];
        } else if (a.kind === 'rule' && a.field === e.y) {
          const vy = y(a.value);
          options = [[left + 4, above(vy - 1), 'start'], [right - 4, above(vy - 1), 'end'], [left + 4, below(vy + 1), 'start'], [right - 4, below(vy + 1), 'end']]
            .map(([px, baseline, anchor]) => option(px, baseline, anchor, right - left - 8, text));
        } else if (a.kind === 'rule' && a.field === e.x) {
          const vx = x(a.value);
          options = [
            option(vx + 4, () => top + 14, 'start', right - vx - 8, text),
            option(vx - 4, () => top + 14, 'end', vx - 8 - left, text),
            option(vx + 4, above(bottom - 2), 'start', right - vx - 8, text),
            option(vx - 4, above(bottom - 2), 'end', vx - 8 - left, text),
          ];
        } else if (a.kind === 'band') {
          const band = a.field === e.x
            ? { mid: (x(a.from) + x(a.to)) / 2, width: Math.abs(x(a.to) - x(a.from)) - 8 }
            : { mid: (y(a.from) + y(a.to)) / 2 };
          options = a.field === e.x
            ? [option(band.mid, () => top + 14, 'middle', band.width, text), option(band.mid, above(bottom - 2), 'middle', band.width, text)]
            : [option(right - 4, (n) => band.mid + 4 - (n - 1) * 8, 'end', right - left - 8, text), option(left + 4, (n) => band.mid + 4 - (n - 1) * 8, 'start', right - left - 8, text)];
        }
        const fits = (item) => item.box.x0 >= left && item.box.x1 <= right && item.box.y0 >= top && item.box.y1 <= bottom
          && !blocked.some((other) => overlaps(item.box, other));
        const hit = options.find(fits);
        const inBand = (box) => bands.some((band) => overlaps(box, band));
        const color = (box) => (inBand(box) ? ctx.textOn(bandFill, { opacity: 0.55 }) : ctx.textColor(a.kind === 'note' ? 'fg' : 'accent'));
        if (hit) {
          placed.push({ ...hit, fill: color(hit.box) });
          blocked.push(hit.box);
          continue;
        }
        // 注释带离开了所指对象，笔记前加上记录名，读者仍知道它说的是哪个点。
        const row = a.kind === 'note' ? spec.data.find((candidate) => candidate[e.id] === a.record) : null;
        const owner = row ? `${row[e.label] ?? a.record}${ctx.lang?.startsWith('en') ? ': ' : '：'}` : '';
        banded.push({ lines: ctx.wrap(`${owner}${text}`, Math.max(48, right - left - 8), 12, 400), fill: ctx.textColor(a.kind === 'note' ? 'fg' : 'accent') });
      }
      return { placed, banded };
    }
    const ticks = (lo, hi, meta, scale, span, horizontal) => {
      if (meta.scale === 'log') {
        const a = Math.ceil(lo / Math.LN10), b = Math.floor(hi / Math.LN10);
        const all = Array.from({ length: Math.max(0, Math.min(10, b - a + 1)) }, (_, i) => 10 ** (a + i));
        const candidates = all.length ? all : [Math.exp(lo), Math.exp(hi)];
        const widest = Math.max(...candidates.map((value) => ctx.measure(ctx.format(value, meta === fx ? e.x : e.y), 12, 400)));
        const step = Math.max(1, Math.ceil((widest + (horizontal ? 8 : 14)) / (span / Math.max(1, candidates.length - 1))));
        const selected = [];
        candidates.forEach((value, index) => {
          if (index % step !== 0 && index !== candidates.length - 1) return;
          const label = ctx.format(value, meta === fx ? e.x : e.y);
          const width = ctx.measure(label, 12, 400);
          const prior = selected.at(-1);
          const distance = prior ? (Math.log(value) - Math.log(prior.value)) / Math.max(1e-9, hi - lo) * span : Infinity;
          if (!prior || distance >= (width + prior.width) / 2 + (horizontal ? 8 : 14)) selected.push({ value, width });
        });
        return { values: selected.map((tick) => tick.value), labels: null };
      }
      return { values: scale.ticks, labels: scale.labels };
    };
    const yTicks = ticks(ymin, ymax, fy, yScale, bottom - top, false);
    const xTicks = ticks(xmin, xmax, fx, xScale, right - left, true);
    const xLabels = xTicks.values.map((t, i) => xTicks.labels?.[i] ?? ctx.format(t, e.x));
    yTicks.values.forEach((t, i) => { children.push(ctx.line(left, y(t), right, y(t), { stroke: ctx.palette.grid, 'stroke-width': 1 })); addText(left - 8, y(t) + 4, yTicks.labels?.[i] ?? ctx.format(t, e.y), 'end'); });
    // Edge labels are pulled inside the canvas; thin after that shift so a moved label never touches its
    // neighbour. The first and last labels stay, and only the final gap may end up shorter.
    const placedX = xTicks.values.map((t, i) => {
      children.push(ctx.line(x(t), top, x(t), bottom, { stroke: ctx.palette.grid, 'stroke-width': 1 }));
      const half = ctx.measure(xLabels[i], 12, 400) / 2;
      return { label: xLabels[i], half, px: Math.max(half + 8, Math.min(ctx.width - half - 8, x(t))) };
    });
    const keptX = [];
    const clashes = (prior, item) => prior.px + prior.half + 8 > item.px - item.half;
    placedX.forEach((item, i) => {
      if (i < placedX.length - 1) { if (!keptX.length || !clashes(keptX.at(-1), item)) keptX.push(item); return; }
      while (keptX.length > 1 && clashes(keptX.at(-1), item)) keptX.pop();
      if (!keptX.length || !clashes(keptX.at(-1), item)) keptX.push(item);
    });
    keptX.forEach(({ label, px }) => addText(px, bottom + 18, label));
    const colors = series.map((_, i) => ctx.palette[`tone${i % 6 + 1}`]);
    children.push(...legend.children.map((node) => ({ ...node, attrs: { ...node.attrs, transform: `translate(${left} ${legendY - 20})` } })));
    spec.data.forEach((row, i) => {
      const r = radiusOf(row);
      const seriesIndex = e.series ? series.indexOf(row[e.series]) : -1;
      const mark = ctx.circle(x(row[e.x]), y(row[e.y]), r, { fill: seriesIndex >= 0 ? colors[seriesIndex] : ctx.palette.accent, stroke: ctx.palette.bg, 'stroke-width': 2 });
      const title = `${row[e.label] ?? row[e.id] ?? i + 1}：${ctx.format(row[e.x], e.x)}，${ctx.format(row[e.y], e.y)}${e.size ? `，${ctx.format(row[e.size], e.size)}` : ''}`;
      children.push(ctx.titled(mark, title));
    });
    for (const a of spec.annotations || []) {
      if (a.kind === 'rule' && a.field === e.x) children.push(ctx.line(x(a.value), top, x(a.value), bottom, { stroke: ctx.palette.accent, 'stroke-width': 1.5, 'stroke-dasharray': '4 4' }));
      if (a.kind === 'rule' && a.field === e.y) children.push(ctx.line(left, y(a.value), right, y(a.value), { stroke: ctx.palette.accent, 'stroke-width': 1.5, 'stroke-dasharray': '4 4' }));
      if (a.kind === 'band' && a.field === e.x) children.push(ctx.rect(x(a.from), top, Math.max(0, x(a.to) - x(a.from)), bottom - top, { fill: ctx.mix(ctx.palette.accent, ctx.palette.bg, 0.82), opacity: 0.55 }));
      if (a.kind === 'band' && a.field === e.y) children.push(ctx.rect(left, y(a.to), right - left, Math.max(0, y(a.from) - y(a.to)), { fill: ctx.mix(ctx.palette.accent, ctx.palette.bg, 0.82), opacity: 0.55 }));
    }
    for (const item of notes.placed) {
      children.push(ctx.textLines(item.px, item.py + bandHeight, item.lines, { anchor: item.anchor, fill: item.fill, 'font-size': 12 }));
    }
    // 点不多时把 label 标在点旁：依次试右、左、右上、右下、左上、左下、上、下，避开所有点、注释和已放好的点名。
    // 放不下的点名只保留在悬停提示里，不压在别的点或文字上。
    if (e.label && spec.data.length <= 40) {
      // 点、注释和轴名周围留 2px；点名之间可以相接，文字框上下已各含约 4px 字形空隙。
      const hitBox = (a, b) => { const pad = b.label ? 0 : 2; return a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad; };
      const dots = spec.data.map((row) => ({ cx: x(row[e.x]), cy: y(row[e.y]), r: radiusOf(row) }));
      // 点名必须最靠近自己的点：另一个点离字形更近时，读者会把名字归到那个点上。
      // 用字形的实际范围（大写高度到基线）量距离，不用带上下留白的布局框。
      const gapTo = (dot, box) => Math.hypot(Math.max(box.x0 - dot.cx, 0, dot.cx - box.x1), Math.max(box.y0 - dot.cy, 0, dot.cy - box.y1)) - dot.r;
      const owns = (own, { box, py }) => {
        const glyphs = { x0: box.x0, x1: box.x1, y0: py - 10, y1: py + 1 };
        return dots.every((dot) => dot === own || gapTo(dot, glyphs) >= gapTo(own, glyphs) + 1);
      };
      const taken = [
        ...dots.map(({ cx, cy, r }) => ({ x0: cx - r, x1: cx + r, y0: cy - r, y1: cy + r })),
        // 垂线变体：点名不压在别的点的垂线上。
        ...(spec.variant === 'plumb' ? dots.map(({ cx, cy, r }) => ({ x0: cx - 0.5, x1: cx + 0.5, y0: cy + r, y1: bottom })) : []),
        ...notes.placed.map((item) => ({ ...item.box, y0: item.box.y0 + bandHeight, y1: item.box.y1 + bandHeight })),
        ...yTitleLines.map((line, i) => ({ x0: 8, x1: 8 + ctx.measure(line, 12, 400), y0: top - yTitleBlock + i * 16, y1: top - yTitleBlock + i * 16 + 15 })),
      ];
      spec.data.forEach((row, index) => {
        const text = row[e.label] == null ? '' : String(row[e.label]);
        if (!text) return;
        const own = dots[index], { cx, cy, r } = own, w = ctx.measure(text, 12, 400);
        const candidates = [
          [cx + r + 4, cy + 4, 'start'], [cx - r - 4, cy + 4, 'end'],
          [cx + r + 2, cy - r - 2, 'start'], [cx + r + 2, cy + r + 12, 'start'], [cx - r - 2, cy - r - 2, 'end'], [cx - r - 2, cy + r + 12, 'end'],
          [cx, cy - r - 5, 'middle'],
          ...(spec.variant === 'plumb' ? [] : [[cx, cy + r + 15, 'middle']]),
        ].map(([px, py, anchor]) => {
          const x0 = anchor === 'end' ? px - w : anchor === 'middle' ? px - w / 2 : px;
          return { px, py, anchor, box: { x0, x1: x0 + w, y0: py - 12, y1: py + 3 } };
        });
        // 顶部的点允许点名稍稍高出最上方网格线，但不碰纵轴名。
        const hit = candidates.find((candidate) => { const { box } = candidate; return box.x0 >= left && box.x1 <= right && box.y0 >= top - 8 && box.y1 <= bottom
          && !taken.some((other) => hitBox(box, other)) && owns(own, candidate); });
        if (!hit) return;
        taken.push({ ...hit.box, label: true });
        children.push(ctx.text(hit.px, hit.py, text, { anchor: hit.anchor, size: 12, fill: ctx.textColor('fg'), meta: { kind: 'point-label', label: text, cx, cy } }));
      });
    }
    let bandY = baseTop + 12;
    for (const item of notes.banded) {
      children.push(ctx.textLines(left + 4, bandY, item.lines, { fill: item.fill, 'font-size': 12 }));
      bandY += item.lines.length * 16;
    }
    children.push(ctx.textLines(8, top - yTitleBlock + 12, yTitleLines, { fill: ctx.palette.muted, 'font-size': 12, meta: { kind: 'axis-title', axis: 'y' } }));
    children.push(ctx.textLines(right, bottom + 40, xTitleLines, { anchor: 'end', fill: ctx.palette.muted, 'font-size': 12, meta: { kind: 'axis-title', axis: 'x' } }));
    return { width: ctx.width, height: bottom + 40 + (xTitleLines.length - 1) * 16 + 12, children };
  }
  if (spec.chart === 'waterfall') {
    const rows = spec.data;
    const start = spec.start ?? 0;
    const startLabel = ctx.lang?.startsWith('en') ? 'Start' : '起点';
    const endLabel = ctx.lang?.startsWith('en') ? 'End' : '终点';
    const stages = [{
      label: startLabel, before: 0, after: start, value: start, total: true,
      record: null, id: 'start',
    }];
    let current = start;
    rows.forEach((row, index) => {
      const delta = row[e.delta];
      const before = current;
      current += delta;
      stages.push({
        label: String(row[e.category]), before, after: current, value: delta, delta, total: false,
        record: index, id: e.id ? row[e.id] : String(index),
      });
    });
    stages.push({
      label: endLabel, before: 0, after: current, value: current, total: true,
      record: null, id: 'end',
    });
    const field = e.delta;
    const unit = ctx.field(field).unit || spec.unit;
    const values = stages.flatMap((stage) => stage.total ? [stage.after] : [stage.before, stage.after]);
    const minimum = Math.min(...values), maximum = Math.max(...values), span = maximum - minimum;
    const truncated = minimum > 0 && span <= 0.35 * maximum;
    let scale = ctx.ticks(values, field, { zero: !truncated, count: 4 });
    let baseline = 0;
    if (truncated) {
      const threshold = minimum - 0.08 * span;
      baseline = Math.floor((threshold + Number.EPSILON * Math.abs(threshold)) / scale.step) * scale.step;
      if (!(baseline > 0 && baseline <= threshold)) {
        scale = ctx.ticks(values, field, { zero: false, count: 4 });
        baseline = Math.floor((threshold + Number.EPSILON * Math.abs(threshold)) / scale.step) * scale.step;
      }
      if (!(baseline > 0 && baseline <= threshold)) { baseline = 0; scale = ctx.ticks(values, field, { zero: true, count: 4 }); }
      else {
        const ticks = [];
        for (let value = baseline; value <= scale.max + scale.step * 1e-8; value += scale.step) ticks.push(Number(value.toPrecision(12)));
        if (ticks.at(-1) < maximum) ticks.push(Number((ticks.at(-1) + scale.step).toPrecision(12)));
        scale = { ...scale, min: baseline, ticks, labels: ticks.map((value) => ctx.format(value, field, false)) };
      }
    }
    const axisBreak = truncated && baseline > 0;
    const left = Math.max(40, ...scale.labels.map((label) => ctx.measure(label, 12, 400) + 18));
    const rightMargin = 10;
    const number = (value) => ctx.format(value, field, false);
    const readouts = stages.map((stage) => (stage.total ? number(stage.after) : `${stage.delta > 0 ? '+' : ''}${number(stage.delta)}`));
    // 类别名按词折行，槽宽至少放下最宽的一个词或一个字（最多 160px），避免词被从中间切开；
    // 槽宽同时不小于 26px 的柱槽下限，放不下时加宽场景。
    const labelMeasure = (text) => ctx.measure(text, 12, 400);
    const widestToken = Math.max(12, ...stages.map((stage) => Math.max(
      ...String(stage.label).trim().split(/\s+/).map(labelMeasure),
    )));
    const minSlot = Math.max(26, Math.min(160, widestToken + 8));
    const width = Math.max(ctx.width, left + stages.length * minSlot + rightMargin);
    const right = width - rightMargin;
    const slot = (right - left) / stages.length;
    const labelWidth = Math.max(18, Math.min(slot - 8, widestToken));
    const labelLines = stages.map((stage) => ctx.wrap(stage.label, labelWidth, 12, 400));
    const labelDepth = Math.max(1, ...labelLines.map((lines) => lines.length));
    const readoutWidth = readouts.map((text, index) => ctx.measure(text, 12, stages[index].total ? 700 : 600));
    const readoutPitch = 16;
    const head = (unit || axisBreak ? 22 : 8) + (axisBreak && unit ? 16 : 0);
    const smallestDelta = Math.min(...rows.map((row) => Math.abs(row[e.delta])).filter((value) => value > 0));
    const bottom = axisBreak
      ? Math.max(head + 220, head + 8 * (scale.max - baseline) / (Number.isFinite(smallestDelta) ? smallestDelta : 1))
      : head + 236;
    // 先按零层留白估柱顶，再按像素错开；顶部留白随后加上实际层数。
    const yFor = ctx.linear(axisBreak ? baseline : scale.min, scale.max, bottom, head + readoutPitch);
    const barTop = stages.map((stage) => {
      const before = axisBreak && stage.total ? baseline : stage.before;
      return Math.min(yFor(before), yFor(stage.after));
    });
    const order = stages.map((_, index) => index).sort((a, b) => barTop[a] - barTop[b] || a - b);
    const lanes = [];
    const taken = [];
    order.forEach((index) => {
      const center = left + slot * (index + 0.5);
      const half = readoutWidth[index] / 2;
      const readoutX = Math.max(half + 2, Math.min(width - rightMargin - half, center));
      let lane = 0;
      const hits = (candidate) => taken.some((box) => box.lane === candidate
        && Math.abs(box.x - readoutX) < (box.width + readoutWidth[index]) / 2 + 8);
      while (hits(lane)) lane += 1;
      lanes[index] = lane;
      taken.push({ x: readoutX, width: readoutWidth[index], lane });
    });
    const readoutRows = Math.max(...lanes) + 1;
    const top = head + readoutRows * readoutPitch + 8;
    const y = ctx.linear(axisBreak ? baseline : scale.min, scale.max, bottom, top);
    const children = [];
    scale.ticks.forEach((tick, index) => {
      const py = y(tick);
      if (!(axisBreak && index === 0)) children.push(ctx.line(left, py, right, py, { stroke: ctx.palette.grid, 'stroke-width': 1 }));
      children.push(ctx.text(left - 10, py + 4, scale.labels[index], { anchor: 'end', size: 12, fill: ctx.palette.muted }));
    });
    if (unit) children.push(ctx.text(left, 18, `${ctx.lang?.startsWith('en') ? 'Unit: ' : '单位：'}${unit}`, { size: 12, fill: ctx.palette.muted }));
    if (axisBreak) children.push(ctx.text(left, unit ? 34 : 18, `${ctx.lang?.startsWith('en') ? 'Axis starts at ' : '纵轴从 '}${ctx.format(baseline, field, false)}`, { size: 12, fill: ctx.palette.muted }));
    const colon = ctx.lang?.startsWith('en') ? ': ' : '：';
    stages.forEach((stage, index) => {
      const x = left + slot * index;
      const before = axisBreak && stage.total ? baseline : stage.before;
      const yBefore = y(before);
      const yAfter = y(stage.after);
      const barWidth = Math.max(1, slot * 0.62);
      const barX = x + (slot - barWidth) / 2;
      const color = stage.total ? ctx.palette.ink : stage.delta >= 0 ? ctx.palette.accent : ctx.palette.tone5;
      const meta = {
        kind: stage.total ? 'waterfall-total' : 'waterfall-delta',
        record: stage.record,
        id: stage.id,
        label: stage.label,
        value: stage.value,
        before: stage.before,
        after: stage.after,
        total: stage.total,
        ...(axisBreak && stage.total ? { truncated: true } : {}),
      };
      const bar = ctx.rect(barX, Math.min(yBefore, yAfter), barWidth, Math.max(1, Math.abs(yBefore - yAfter)), {
        rx: 4, fill: color, stroke: ctx.palette.bg, 'stroke-width': 1, meta,
      });
      children.push(ctx.titled(bar, `${stage.label}${colon}${ctx.format(stage.value, field)}`));
      const readout = readouts[index];
      const half = readoutWidth[index] / 2;
      const readoutX = Math.max(half + 2, Math.min(width - rightMargin - half, x + slot / 2));
      const readoutY = head + 14 + lanes[index] * readoutPitch;
      children.push(ctx.text(readoutX, readoutY, readout, {
        anchor: 'middle', size: 12, weight: stage.total ? 700 : 600, fill: ctx.palette.fg, meta,
      }));
      children.push(ctx.textLines(x + slot / 2, bottom + 20, labelLines[index], { anchor: 'middle', size: 12, fill: ctx.palette.muted }));
      if (axisBreak && stage.total) {
        const baseY = y(baseline) - 10;
        for (const offset of [5, 12]) {
          children.push(ctx.line(barX + offset, baseY, barX + offset + 6, baseY - 4, { stroke: ctx.palette.bg, 'stroke-width': 4, 'stroke-linecap': 'round' }));
          children.push(ctx.line(barX + offset, baseY, barX + offset + 6, baseY - 4, { stroke: color, 'stroke-width': 1.5, 'stroke-linecap': 'round', meta: { kind: 'axis-break', id: stage.id, truncated: true } }));
        }
      }
      if (index < stages.length - 1) children.push(ctx.line(x + slot * 0.81, yAfter, x + slot * 1.19, yAfter, { stroke: ctx.palette.muted, 'stroke-width': 1, 'stroke-dasharray': '2 3', class: 'chart-connector' }));
    });
    children.push(ctx.line(left, y(axisBreak ? baseline : 0), right, y(axisBreak ? baseline : 0), { stroke: ctx.palette.axis, 'stroke-width': 1 }));
    return { width, height: Math.ceil(bottom + 28 + labelDepth * 16), children };
  }
  if (spec.chart === 'histogram') {
    const rows = spec.data;
    const density = rows.some((r) => Math.abs((r[e.upper] - r[e.lower]) - (rows[0][e.upper] - rows[0][e.lower])) > 1e-9);
    const values = rows.map((r) => density ? r[e.count] / (r[e.upper] - r[e.lower]) : r[e.count]);
    const countDomain = ctx.field(e.count).domain;
    const yScale = ctx.ticks(values, e.count, { zero: true, count: 4 });
    if (density) yScale.labels = yScale.ticks.map((value) => ctx.format(value, e.count, false));
    const english = /^en(?:-|$)/i.test(String(ctx.lang || ''));
    const countMeta = ctx.field(e.count), binMeta = ctx.field(e.lower);
    const countLabel = countMeta.label !== e.count ? countMeta.label : (english ? 'Count' : '数量');
    const yAxisTitle = density
      ? `${countLabel} / ${binMeta.unit || (english ? 'bin width' : '区间宽度')}（${english ? `area represents ${countLabel}` : `面积表示${countLabel}`}）`
      : countLabel;
    const yMin = Math.min(0, yScale.min, ...(Array.isArray(countDomain) ? [countDomain[0]] : []));
    const densityDomainMax = Array.isArray(countDomain) && density
      ? Math.max(...rows.map((row) => countDomain[1] / (row[e.upper] - row[e.lower]))) : null;
    const maxValue = Math.max(yScale.max, ...values, ...(Array.isArray(countDomain) ? [density ? densityDomainMax : countDomain[1]] : []));
    const yLabelWidth = Math.max(...yScale.labels.map((label) => ctx.measure(label, 12, 400)));
    const left = Math.max(40, Math.ceil(yLabelWidth + 18));
    const xDomains = [ctx.field(e.lower).domain, ctx.field(e.upper).domain].filter(Array.isArray);
    const binEdges = [...new Set(rows.flatMap((row) => [row[e.lower], row[e.upper]]))].sort((a, b) => a - b);
    const edgeLabels = binEdges.map((value) => ctx.format(value, e.lower, false));
    // 首尾边界分别左、右对齐，绘图区至少放得下两者并排加 8px 间隙。
    const edgeMinimum = ctx.measure(edgeLabels[0], 12, 400) + ctx.measure(edgeLabels.at(-1), 12, 400) + 8;
    const sceneWidth = Math.max(ctx.width, left + edgeMinimum + 8);
    const right = sceneWidth - 8;
    // 长纵轴题（密度说明）在绘图区宽度内换行，绘图区随行数下移，不为一行轴题撑宽整张图。
    const titleLines = ctx.wrap(yAxisTitle, Math.max(48, right - left), 12, 400);
    const titleExtra = (titleLines.length - 1) * 16;
    const xAnnotations = (spec.annotations || []).filter((a) => [e.lower, e.upper].includes(a.field) && a.kind !== 'note');
    const annotatedX = xAnnotations.flatMap((a) => a.kind === 'rule' ? [a.value] : [a.from, a.to]);
    const lo = Math.min(rows[0][e.lower], ...xDomains.map((domain) => domain[0]), ...annotatedX);
    const hi = Math.max(rows.at(-1)[e.upper], ...xDomains.map((domain) => domain[1]), ...annotatedX);
    const x = (v) => left + (v - lo) / (hi - lo || 1) * (right - left);
    // 参考线与区间的标签写在绘图区上方、对齐各自的位置，不压在柱上。
    const lanes = labelLanes(ctx, xAnnotations.filter((a) => a.label).map((a) => ({
      a, text: a.label, x: a.kind === 'rule' ? x(a.value) : (x(a.from) + x(a.to)) / 2,
    })), { left, right });
    const annotationBand = lanes.height ? lanes.height + 4 : 0;
    const top = 34 + titleExtra + annotationBand, bottom = 258 + titleExtra + annotationBand;
    const y = (v) => bottom - (v - yMin) / (maxValue - yMin || 1) * (bottom - top);
    yScale.ticks.forEach((v, i) => {
      children.push(ctx.line(left, y(v), right, y(v), { stroke: v === 0 ? ctx.palette.axis : ctx.palette.grid, 'stroke-width': 1 }));
      addText(left - 8, y(v) + 4, yScale.labels[i], 'end');
    });
    rows.forEach((row, i) => {
      const value = values[i];
      // 非零频数至少画出 3px，长尾宽箱不会被描边吞掉而像空箱；精确值见悬停提示与数据表。
      const barHeight = value > 0 ? Math.max(3, y(0) - y(value)) : Math.max(0, y(0) - y(value));
      const bar = ctx.rect(x(row[e.lower]), y(0) - barHeight, Math.max(1, x(row[e.upper]) - x(row[e.lower])), barHeight, { fill: ctx.palette.tone1, stroke: ctx.palette.bg, 'stroke-width': 1, rx: 2 });
      const interval = `[${ctx.format(row[e.lower], e.lower, false)}, ${ctx.format(row[e.upper], e.upper, false)})`;
      const count = `${ctx.format(row[e.count], e.count)}${countMeta.label && countMeta.label !== e.count ? ` ${countMeta.label}` : ''}`;
      const densityValue = ctx.format(value, e.count, false);
      const densityText = `${densityValue}${countMeta.unit ? ` ${countMeta.unit}` : ''}${binMeta.unit ? `/${binMeta.unit}` : ''}`;
      const title = english
        ? `${interval}${binMeta.unit ? ` ${binMeta.unit}` : ''} · ${count}${density ? ` · density ${densityText}` : ''}`
        : `${interval}${binMeta.unit ? ` ${binMeta.unit}` : ''} · ${count}${density ? ` · 密度 ${densityText}` : ''}`;
      children.push(ctx.titled(bar, title));
    });
    const labelBottom = new Map();
    for (const item of lanes.items) {
      const baseline = 30 + titleExtra + 12 + item.offset;
      labelBottom.set(item.a, baseline + (item.lines.length - 1) * 16 + 4);
      children.push(ctx.textLines(item.cx, baseline, item.lines, { anchor: 'middle', fill: ctx.textColor('accent'), 'font-size': 12 }));
    }
    for (const a of xAnnotations) {
      // 参考线向上延伸到自己的标签下沿，标签归属一眼可见。
      if (a.kind === 'rule') children.push(ctx.line(x(a.value), (labelBottom.get(a) ?? top - 2) + 2, x(a.value), bottom, { stroke: ctx.palette.accent, 'stroke-width': 1.5, 'stroke-dasharray': '4 4' }));
      if (a.kind === 'band') children.push(ctx.rect(x(a.from), top, Math.max(0, x(a.to) - x(a.from)), bottom - top, { fill: ctx.mix(ctx.palette.accent, ctx.palette.bg, 0.82), opacity: 0.55 }));
    }
    const rawBinLabel = binMeta.label !== e.lower ? binMeta.label : '';
    const subtitleLabel = String(spec.subtitle || '').split(/[|｜;；]/, 1)[0].trim();
    const genericBoundary = /(?:lower|upper|下界|上界|区间下|区间上|区间.*(?:起点|终点)|^起点$|^终点$)/i;
    const binLabel = rawBinLabel && !genericBoundary.test(rawBinLabel)
      ? rawBinLabel : subtitleLabel && !/^纵轴/.test(subtitleLabel) ? subtitleLabel : (english ? 'Value' : '取值');
    const xAxisTitle = `${binLabel}${binMeta.unit ? `（${binMeta.unit}）` : ''}`;
    children.push(ctx.textLines(left, 18, titleLines, { fill: ctx.palette.muted, 'font-size': 12 }));
    const edgePositions = binEdges.map((value) => x(value));
    const edgeWidth = (index) => ctx.measure(edgeLabels[index], 12, 400);
    // 文字框按实际对齐方式计算：首个左对齐、末个右对齐、其余居中。
    const edgeLeft = (index) => edgePositions[index] - edgeWidth(index) * (index === 0 ? 0 : index === binEdges.length - 1 ? 1 : 0.5);
    const edgeRight = (index) => edgeLeft(index) + edgeWidth(index);
    const edgeGap = (index, prior) => edgeLeft(index) >= edgeRight(prior) + 8;
    const shown = [0];
    for (let index = 1; index < binEdges.length - 1; index += 1) {
      if (shown.every((prior) => edgeGap(index, prior)) && edgeGap(binEdges.length - 1, index)) shown.push(index);
    }
    if (binEdges.length > 1) shown.push(binEdges.length - 1);
    binEdges.forEach((value, index) => {
      children.push(ctx.line(x(value), bottom, x(value), bottom + 4, { stroke: ctx.palette.axis, 'stroke-width': 1 }));
      if (!shown.includes(index)) return;
      const anchor = index === 0 ? 'start' : index === binEdges.length - 1 ? 'end' : 'middle';
      children.push(ctx.text(x(value), bottom + 18, edgeLabels[index], { anchor, fill: ctx.palette.muted, 'font-size': 12 }));
    });
    // 横轴题独占边界标签下方一行、右对齐绘图区；比绘图区还宽时换行。
    const xTitleLines = ctx.wrap(xAxisTitle, Math.max(48, right - left), 12, 400);
    children.push(ctx.textLines(right, bottom + 40, xTitleLines, { anchor: 'end', fill: ctx.palette.muted, 'font-size': 12 }));
    return { width: sceneWidth, height: bottom + 52 + (xTitleLines.length - 1) * 16, children };
  }
  return null;
}

function renderStatistics(spec, ctx) {
  const layout = ({
    scatter: annotatedScene, histogram: annotatedScene, waterfall: annotatedScene,
    heatmap, sparkline, 'small-multiples': smallMultiples,
    bullet: compare, dumbbell: compare, slope: compare, boxplot: compare,
  })[spec.chart];
  return createScene(spec, ctx, layout(spec, ctx));
}

// 华夫点阵：100 点按最大余数法分配给各类别，类别用序列色区分；点阵、说明和图例共用同一左边与宽度。
function waffle(spec, ctx) {
  const e = spec.encode, rows = spec.data, english = /^en(?:-|$)/i.test(String(ctx.lang || ''));
  // 缺失值不占点，图例和数据表仍显示为缺失。
  const values = rows.map((row) => row[e.value] ?? 0), total = values.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) ctx.fit(english ? 'waffle requires a positive total' : '华夫图合计必须大于0', english ? 'Provide at least one positive value' : '为至少一个类别提供正值');
  const counts = apportion(values, 100);
  const pitch = Math.max(18, Math.min(24, Math.floor((ctx.width - 16) / 10))), radius = pitch * 0.4;
  const gridSize = pitch * 10, width = Math.max(ctx.width, gridSize + 16), left = (width - gridSize) / 2;
  const children = [];
  let index = 0;
  rows.forEach((row, category) => {
    const label = String(row[e.category]), fill = ctx.palette[`tone${category % 6 + 1}`];
    const share = ctx.percent(values[category] / total, 1);
    const tip = english ? `${label}: ${share} (${counts[category]} dots)` : `${label}：${share}（${counts[category]} 点）`;
    for (let k = 0; k < counts[category]; k += 1, index += 1) {
      const cx = left + (index % 10 + 0.5) * pitch, cy = (Math.floor(index / 10) + 0.5) * pitch;
      children.push(ctx.titled(ctx.circle(cx, cy, radius, { fill, meta: { kind: 'unit', category: label, value: row[e.value] } }), tip));
    }
  });
  const note = english
    ? '100 dots make up the whole, about 1% each; dots are allocated by largest remainder, see the data table'
    : '100 点表示整体，每点约 1%；点数按最大余数法分配，原数见数据表';
  const noteLines = ctx.wrap(note, gridSize, 12);
  const noteY = gridSize + 22;
  children.push(ctx.textLines(left, noteY, noteLines, { size: 12 }));
  const legend = ctx.legend(rows.map((row, category) => ({
    label: `${row[e.category]} · ${ctx.format(row[e.value], e.value)}`,
    color: ctx.palette[`tone${category % 6 + 1}`],
    meta: { category: String(row[e.category]), value: row[e.value] },
  })), gridSize);
  const legendY = noteY + (noteLines.length - 1) * 16 + 16;
  children.push(ctx.el('g', { transform: `translate(${left},${legendY})` }, legend.children));
  return { ...ctx.scene(legendY + legend.height + 12, children, 'waffle chart'), width };
}

// Registers into the caller's registry so a Node build can assemble an isolated subset.
export function install({ register }) {
  register('waffle', waffle);
  register(['sparkline', 'small-multiples', 'bullet', 'dumbbell', 'slope', 'waterfall', 'histogram', 'boxplot', 'scatter', 'heatmap'], renderStatistics);
}

install({ register });

export { renderStatistics, waffle };
