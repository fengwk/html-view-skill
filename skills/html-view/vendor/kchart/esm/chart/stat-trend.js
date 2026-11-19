import { __exportAll } from "../_virtual/_rolldown/runtime.js";
// src/chart/stat-trend.js
var stat_trend_exports = /* @__PURE__ */ __exportAll({
	smallMultiples: () => smallMultiples,
	sparkline: () => sparkline
});
var pathOf = (points) => points.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
var caption = (ctx, x, y, text, anchor = "start", cls = "chart-label", fill = ctx.palette.muted, meta) => ctx.text(x, y, text, {
	anchor,
	class: cls,
	fill,
	meta
});
var grid = (ctx, x1, x2, y, axis = false) => ctx.line(x1, y, x2, y, {
	class: axis ? "chart-axis" : "chart-grid",
	fill: "none",
	stroke: axis ? ctx.palette.axis : ctx.palette.grid,
	"stroke-width": 1
});
var dot = (ctx, x, y, r, title) => ctx.titled(ctx.circle(x, y, r, {
	class: "chart-dot chart-dot-1",
	fill: ctx.palette.tone1,
	stroke: ctx.palette.bg,
	"stroke-width": 2
}), title);
var isolatedAt = (values, i) => !Number.isFinite(values[i - 1]) && !Number.isFinite(values[i + 1]);
function traces(ctx, points, floor, title) {
	const segments = [];
	let segment = [];
	for (const point of points) if (point) segment.push(point);
	else if (segment.length) {
		segments.push(segment);
		segment = [];
	}
	if (segment.length) segments.push(segment);
	const paths = segments.filter((part) => part.length > 1);
	const areas = paths.map((part) => ctx.path(`${pathOf([
		[part[0][0], floor],
		...part,
		[part.at(-1)[0], floor]
	])} Z`, {
		class: "chart-area",
		fill: ctx.palette.tone1,
		"fill-opacity": .12,
		stroke: "none"
	}));
	const lines = paths.map((part) => ctx.titled(ctx.path(pathOf(part), {
		class: "chart-line chart-stroke-1",
		fill: "none",
		stroke: ctx.palette.tone1,
		"stroke-width": 2.25,
		"stroke-linecap": "round",
		"stroke-linejoin": "round"
	}), title));
	return [...areas, ...lines];
}
function formatTitle(ctx, entries, field) {
	const lastIndex = entries.findLastIndex(Number.isFinite);
	const value = entries[lastIndex] ?? null;
	return {
		lastIndex,
		value,
		text: ctx.format(value, field)
	};
}
function sparkline(spec, ctx) {
	const { categories, series: [series] } = ctx.table(spec);
	const { values, field } = series;
	const readout = formatTitle(ctx, values, field);
	const first = String(categories[0] ?? "");
	const last = categories.length > 1 ? String(categories.at(-1)) : "";
	const gap = 10;
	const reserve = Math.max(52, ctx.measure(readout.text, 13, 700) + gap + 8);
	const x0 = 4;
	const width = Math.max(ctx.width, 52 + reserve);
	const plotW = width - x0 - reserve;
	const endSlots = !last || ctx.measure(first) + ctx.measure(last) + 12 <= plotW ? plotW : Math.max(20, (plotW - 12) / 2);
	const labels = [ctx.wrap(first, endSlots), last ? ctx.wrap(last, endSlots) : []];
	const lineCount = Math.max(...labels.map((lines) => lines.length), 1);
	const plotBottom = 39;
	const height = 56 + (lineCount - 1) * 16;
	const finite = values.filter(Number.isFinite);
	const bounds = [...finite, ...ctx.field(field).domain || []];
	const low = bounds.length ? Math.min(...bounds) : 0;
	const high = bounds.length ? Math.max(...bounds) : 0;
	const span = high - low || Math.abs(high) || 1;
	const lo = low - span * .35;
	const hi = high + span * .35;
	const x = (i) => x0 + i / Math.max(1, values.length - 1) * plotW;
	const y = (v) => plotBottom - (v - lo) / (hi - lo) * 32;
	const children = traces(ctx, values.map((value, i) => Number.isFinite(value) ? [x(i), y(value)] : null), 45, series.label);
	const titleAt = (i) => `${categories[i]}${ctx.lang?.startsWith("en") ? ": " : "："}${ctx.format(values[i], field)}`;
	const { lastIndex, value, text } = readout;
	if (lastIndex >= 0) {
		const marked = /* @__PURE__ */ new Set([values.indexOf(Math.min(...finite)), values.lastIndexOf(Math.max(...finite))]);
		values.forEach((value, i) => {
			if (Number.isFinite(value) && isolatedAt(values, i)) marked.add(i);
		});
		for (const i of marked) if (i !== lastIndex) children.push(dot(ctx, x(i), y(values[i]), 3, titleAt(i)));
		children.push(dot(ctx, x(lastIndex), y(value), 3.5, titleAt(lastIndex)));
	}
	children.push(caption(ctx, x(Math.max(0, lastIndex)) + gap, lastIndex < 0 ? 28 : y(value) + 4, text, "start", "chart-value chart-value-strong", ctx.palette.fg, {
		kind: "value",
		value,
		label: text
	}));
	labels.forEach((lines, side) => lines.forEach((line, i) => children.push(caption(ctx, side === 0 ? x0 : x(values.length - 1), 52 + 16 * i, line, side === 0 ? "start" : "end", "chart-tick"))));
	return {
		width,
		height,
		children
	};
}
function smallMultiples(spec, ctx) {
	const e = spec.encode;
	const packed = ctx.table(spec);
	const categories = packed.categories;
	const series = e.panel ? [...new Set(packed.rows.map((row) => row[e.panel]))].map((panel) => ({
		label: String(panel),
		field: e.value,
		values: categories.map((category) => packed.rows.find((row) => row[e.category] === category && row[e.panel] === panel)?.[e.value] ?? null)
	})) : packed.series;
	const cols = Math.min(series.length, ctx.width >= 470 ? 2 : 1);
	const reads = series.map(({ field, values }) => formatTitle(ctx, values, field));
	const sample = series.flatMap(({ field, values }) => [...values, ...ctx.field(field).domain || []]);
	const scale = ctx.ticks(sample, series[0].field);
	const left = Math.max(54, ...scale.labels.map((text) => ctx.measure(text) + 12));
	const right = 16;
	const readoutWidth = Math.max(28, ...reads.map(({ text }) => ctx.measure(text, 13, 700)));
	const panelW = Math.max(Math.floor(ctx.width / cols), left + right + 60, left + right + readoutWidth + 40);
	const titles = series.map(({ label }, index) => ctx.wrap(label, Math.max(40, panelW - left - 24 - ctx.measure(reads[index].text, 13, 700))));
	const titleHeight = Math.max(16, ...titles.map((lines) => lines.length * 16));
	const first = String(categories[0] ?? "");
	const last = categories.length > 1 ? String(categories.at(-1)) : "";
	const plotW = panelW - left - right;
	const endSlot = !last || ctx.measure(first) + ctx.measure(last) + 12 <= plotW ? plotW : Math.max(24, (plotW - 12) / 2);
	const ends = [ctx.wrap(first, endSlot), last ? ctx.wrap(last, endSlot) : []];
	const categoryBand = 8 + Math.max(1, ...ends.map((lines) => lines.length)) * 16;
	const panelH = 160 + titleHeight + categoryBand;
	const children = [];
	const labels = [];
	const sep = ctx.lang?.startsWith("en") ? ": " : "：";
	series.forEach(({ label, field, values }, index) => {
		const ox = index % cols * panelW;
		const oy = Math.floor(index / cols) * panelH;
		const baseline = oy + panelH - categoryBand;
		const inset = titleHeight + 18;
		const x = (i) => ox + left + i / Math.max(1, categories.length - 1) * plotW;
		const y = (v) => baseline - (v - scale.min) / (scale.max - scale.min || 1) * (panelH - inset - categoryBand);
		const end = ox + panelW - right;
		const title = titles[index];
		const read = reads[index];
		title.forEach((text, i) => labels.push(caption(ctx, ox + left, oy + 16 + i * 16, text, "start", "chart-label", ctx.palette.muted, {
			kind: "panel",
			label
		})));
		labels.push(caption(ctx, end + (title.length > 1 ? 8 : 0), oy + 16, read.text, "end", "chart-value chart-value-strong", ctx.palette.fg, {
			kind: "value",
			value: read.value,
			label: read.text
		}));
		scale.ticks.forEach((tick, i) => {
			if (tick !== scale.min) children.push(grid(ctx, ox + left, end, y(tick)));
			labels.push(caption(ctx, ox + left - 10, y(tick) + 4, scale.labels[i], "end", "chart-tick"));
		});
		children.push(grid(ctx, ox + left, end, baseline, true));
		children.push(...traces(ctx, values.map((value, i) => Number.isFinite(value) ? [x(i), y(value)] : null), baseline, label));
		values.forEach((value, i) => {
			if (!Number.isFinite(value)) return;
			if (categories.length > 12 && i !== read.lastIndex && !isolatedAt(values, i)) return;
			children.push(dot(ctx, x(i), y(value), i === read.lastIndex ? 4 : 3, `${categories[i]}${sep}${ctx.format(value, field)}`));
		});
		ends.forEach((lines, side) => lines.forEach((line, i) => labels.push(caption(ctx, side === 0 ? ox + left : end, baseline + 18 + i * 16, line, side === 0 ? "start" : "end"))));
	});
	return {
		width: Math.max(ctx.width, panelW * cols),
		height: panelH * Math.ceil(series.length / cols),
		children: [...children, ...labels]
	};
}
export { smallMultiples, sparkline, stat_trend_exports };
