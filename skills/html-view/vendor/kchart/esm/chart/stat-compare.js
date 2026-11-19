import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { barPath } from "../core/geometry.js";
import { isEnglish } from "../core/format.js";
// src/chart/stat-compare.js
var stat_compare_exports = /* @__PURE__ */ __exportAll({ compare: () => compare });
var lineHeight = 18;
var bounded = { bounded: true };
var sideLabels = (ctx, text, width) => ctx.wrap(text, width, 12, 400, bounded);
var paintLine = (stroke, width, name, round = false) => ({
	class: name,
	fill: "none",
	stroke,
	"stroke-width": width,
	...round ? { "stroke-linecap": "round" } : {}
});
var label = (ctx, x, y, text, anchor = "start", cls = "chart-label", fill = ctx.palette.muted, meta) => ctx.text(x, y, text, {
	anchor,
	class: cls,
	fill,
	meta
});
var centered = (ctx, x, y, lines, anchor) => lines.map((line, i) => label(ctx, x, y + (i - (lines.length - 1) / 2) * lineHeight, line, anchor));
function endpointLabel(ctx, name, value, width, valueFirst) {
	const join = (line) => valueFirst ? `${value} ${line}` : `${line} ${value}`;
	const lines = sideLabels(ctx, join(name), width);
	const edge = valueFirst ? lines[0] : lines.at(-1);
	if (edge === value || (valueFirst ? edge.startsWith(`${value} `) : edge.endsWith(` ${value}`)) || ctx.measure(value) > width) return lines;
	const nameLines = sideLabels(ctx, name, width);
	const index = valueFirst ? 0 : nameLines.length - 1;
	const joined = join(nameLines[index]);
	if (ctx.measure(joined) <= width) {
		nameLines[index] = joined;
		return nameLines;
	}
	return valueFirst ? [value, ...nameLines] : [...nameLines, value];
}
function slope(spec, ctx) {
	const { category, before, after } = spec.encode;
	const rows = spec.data;
	const colon = isEnglish(ctx.lang) ? ": " : "：";
	const fields = [before, after];
	const name = rows.map((row) => String(row[category]));
	const reads = fields.map((field) => rows.map((row) => ctx.format(row[field], field)));
	const widest = Math.max(...[...name, ...reads.flat()].map((str) => ctx.measure(str)));
	const minPlotWidth = 80;
	const pad = Math.max(64, Math.min(ctx.width * .4, (ctx.width - minPlotWidth) / 2, widest + 18));
	const width = Math.max(ctx.width, pad * 2 + minPlotWidth);
	const slot = pad - 18;
	const sided = reads.map((values, side) => values.map((value, i) => endpointLabel(ctx, name[i], value, slot, side === 1)));
	const heading = fields.map((field) => sideLabels(ctx, ctx.field(field).label, Math.max(48, width - 2 * pad - 10)));
	const headerRoom = (Math.max(...heading.map((lines) => lines.length), 1) - 1) * 16;
	const scale = ctx.ticks([...rows.flatMap((row) => fields.map((field) => row[field])), ...ctx.field(after).domain || []], before, { padding: .06 });
	const top = 36 + headerRoom;
	const span = Math.max(48, rows.length * 48 - 36);
	const y = (value) => top + (scale.max - value) / (scale.max - scale.min || 1) * span;
	const slots = fields.map((field, side) => {
		const ordered = rows.map((row, i) => ({
			i,
			y: y(row[field]),
			lines: sided[side][i].length
		})).sort((a, b) => a.y - b.y || a.i - b.i);
		let previous;
		for (const item of ordered) {
			const count = item.lines + (previous?.lines || 0);
			const separation = Math.max(8 + count * 7.5, 14 + (count - 2) * lineHeight / 2);
			item.baseline = previous ? Math.max(item.y, previous.baseline + separation) : Math.max(top, item.y);
			previous = item;
		}
		return new Map(ordered.map((item) => [item.i, item]));
	});
	const bottom = Math.max(...slots.flatMap((side) => [...side.values()].map((entry) => entry.baseline + (entry.lines - 1) * lineHeight / 2)));
	const height = Math.max(300, Math.ceil(bottom + 28));
	const right = width - pad;
	const grid = paintLine(ctx.palette.grid, 1, "chart-grid");
	const connector = paintLine(ctx.palette.grid, 3, "chart-link", true);
	const children = [ctx.line(pad, 24 + headerRoom, pad, height - 24, grid), ctx.line(right, 24 + headerRoom, right, height - 24, grid)];
	const labels = [];
	rows.forEach((row, i) => {
		const [first, last] = fields.map((field) => y(row[field]));
		const stroke = ctx.palette[`tone${i % 6 + 1}`];
		children.push(ctx.line(pad, first, right, last, {
			...paintLine(stroke, 2.25, `chart-line chart-stroke-${i % 6 + 1}`, true),
			"stroke-linejoin": "round"
		}));
		const dot = {
			class: `chart-dot chart-dot-${i % 6 + 1}`,
			fill: stroke,
			stroke: ctx.palette.bg,
			"stroke-width": 2
		};
		children.push(ctx.titled(ctx.circle(pad, first, 4, dot), `${name[i]}${colon}${ctx.field(before).label} ${reads[0][i]}`));
		children.push(ctx.titled(ctx.circle(right, last, 4, dot), `${name[i]}${colon}${ctx.field(after).label} ${reads[1][i]}`));
		const a = slots[0].get(i).baseline;
		const b = slots[1].get(i).baseline;
		if (Math.abs(a - first) > 1) children.push(ctx.line(pad - 10, a, pad - 4, first, connector));
		if (Math.abs(b - last) > 1) children.push(ctx.line(right + 4, last, right + 10, b, connector));
		labels.push(...centered(ctx, pad - 14, a + 4, sided[0][i], "end"));
		labels.push(...centered(ctx, right + 14, b + 4, sided[1][i], "start"));
	});
	heading.forEach((lines, side) => lines.forEach((line, i) => {
		labels.push(label(ctx, side === 0 ? pad : right, 14 + i * 16, line, "middle", "chart-tick"));
	}));
	return {
		width,
		height,
		children: [...children, ...labels]
	};
}
function compare(spec, ctx) {
	if (spec.chart === "slope") return slope(spec, ctx);
	const e = spec.encode;
	const bullet = spec.chart === "bullet";
	const dumbbell = spec.chart === "dumbbell";
	const fields = bullet ? [e.actual, e.target] : dumbbell ? [e.before, e.after] : [
		e.low,
		e.q1,
		e.median,
		e.q3,
		e.high
	];
	const en = isEnglish(ctx.lang);
	const names = spec.data.map((row) => String(row[e.category]));
	const rows = spec.data.map((row) => fields.map((field) => row[field]));
	const readouts = rows.map((row) => row.map((value, i) => ctx.format(value, fields[i])));
	const target = en ? "Target" : "目标";
	const colon = en ? ": " : "：";
	const values = rows.flat().concat(fields.flatMap((field) => ctx.field(field).domain || []));
	const outliers = e.outliers ? spec.data.map((row) => row[e.outliers] || []) : [];
	const left = Math.max(56, Math.min(ctx.width * .34, Math.ceil(Math.max(72, ...names.map((name) => ctx.measure(name) + 18)))));
	const namesLines = names.map((name) => sideLabels(ctx, name, left - 18));
	const readoutMax = Math.max(96, ctx.width * .42);
	const right = bullet ? Math.max(72, Math.min(readoutMax, 18 + Math.max(...readouts.flatMap(([actual, goal]) => [ctx.measure(actual, 13, 700), ctx.measure(`${target} ${goal}`)])))) : 24;
	const actualLines = bullet ? readouts.map(([actual]) => sideLabels(ctx, actual, right - 16)) : [];
	const targetLines = bullet ? readouts.map(([, goal]) => sideLabels(ctx, `${target} ${goal}`, right - 16)) : [];
	const room = Math.max(ctx.width, left + right + 120);
	const scale = ctx.ticks([...values, ...outliers.flat()], fields[0], {
		zero: bullet,
		padding: .06,
		length: room - left - right,
		adjacent: true
	});
	const widestTick = Math.max(...scale.labels.map((text) => ctx.measure(text)));
	const widestReadout = dumbbell ? Math.max(...readouts.flat().map((text) => ctx.measure(text, 12, 600))) : 0;
	const plotW = Math.max(room - left - right, Math.max(1, scale.ticks.length - 1) * (widestTick + 8), widestReadout + 8);
	const x = (value) => left + (value - scale.min) / (scale.max - scale.min || 1) * plotW;
	const width = Math.max(room, left + right + plotW);
	const rowHeights = rows.map((_, i) => Math.max(bullet ? 52 : 44, (namesLines[i].length - 1) * lineHeight + 18, bullet ? 52 + (actualLines[i].length + targetLines[i].length - 2) * 17 : 0));
	const height = rowHeights.reduce((sum, h) => sum + h, 44);
	const top = 10;
	const children = [];
	const labels = [];
	const extras = [];
	const grid = paintLine(ctx.palette.grid, 1, "chart-grid");
	scale.ticks.forEach((tick, i) => {
		children.push(ctx.line(x(tick), top, x(tick), height - 30, grid));
		labels.push(label(ctx, x(tick), height - 10, scale.labels[i], "middle", "chart-tick"));
	});
	let offset = 16;
	rows.forEach((row, i) => {
		const cy = offset + rowHeights[i] / 2;
		offset += rowHeights[i];
		labels.push(...centered(ctx, left - 14, cy + 4, namesLines[i], "end"));
		const [first, second] = row;
		const [firstLabel, secondLabel] = readouts[i];
		if (bullet) {
			const bar = (value, fill, cls) => ctx.path(barPath(x(0), cy - 8, x(value) - x(0), 16, 8, "all"), {
				class: cls,
				fill
			});
			const actualTitle = `${names[i]}${colon}${en ? "Actual" : "实际"} ${firstLabel}${en ? "; " : "；"}${target} ${secondLabel}`;
			children.push(bar(scale.max, ctx.palette.grid, "chart-track"));
			children.push(ctx.titled(bar(first, ctx.palette.ink, "chart-fill-1"), actualTitle));
			children.push(ctx.line(x(second), cy - 14, x(second), cy + 14, paintLine(ctx.palette.accent, 3, "chart-target-mark", true)));
			actualLines[i].forEach((line, index, lines) => {
				labels.push(label(ctx, width - 6, cy - 4 - (lines.length - index - 1) * 17, line, "end", "chart-value chart-value-strong", ctx.palette.fg));
			});
			targetLines[i].forEach((line, index) => labels.push(label(ctx, width - 6, cy + 13 + index * 17, line, "end")));
		} else if (dumbbell) {
			children.push(ctx.line(x(first), cy, x(second), cy, paintLine(ctx.palette.tone5, 2, "chart-link", true)));
			const firstDot = ctx.circle(x(first), cy, 5.5, {
				class: "chart-dot-hollow",
				fill: ctx.palette.bg,
				stroke: ctx.palette.tone3,
				"stroke-width": 2
			});
			const secondDot = ctx.circle(x(second), cy, 6, {
				class: "chart-dot chart-dot-1",
				fill: ctx.palette.tone1,
				stroke: ctx.palette.bg,
				"stroke-width": 2
			});
			children.push(ctx.titled(firstDot, `${ctx.field(fields[0]).label}${colon}${firstLabel}`));
			children.push(ctx.titled(secondDot, `${ctx.field(fields[1]).label}${colon}${secondLabel}`));
			for (const [role, value, y, text, fill] of [[
				"before",
				first,
				cy - 9,
				firstLabel,
				ctx.textColor("tone3")
			], [
				"after",
				second,
				cy + 17,
				secondLabel,
				ctx.textColor("tone1")
			]]) {
				const half = ctx.measure(text, 12, 600) / 2;
				const pos = Math.max(left + half, Math.min(width - 4 - half, x(value)));
				extras.push(ctx.text(pos, y, text, {
					anchor: "middle",
					fill,
					meta: {
						kind: "endpoint-readout",
						role,
						value
					}
				}));
			}
		} else {
			const [lo, q1, median, q3, hi] = row;
			const whisker = paintLine(ctx.palette.tone3, 1.5, "chart-whisker", true);
			children.push(ctx.line(x(lo), cy, x(hi), cy, whisker));
			for (const end of [lo, hi]) children.push(ctx.line(x(end), cy - 6, x(end), cy + 6, whisker));
			const box = ctx.rect(x(q1), cy - 10, Math.max(0, x(q3) - x(q1)), 20, {
				class: "chart-box",
				fill: ctx.mix(ctx.palette.ink, ctx.palette.bg, .18),
				rx: 5
			});
			children.push(ctx.titled(box, `${names[i]}${colon}${readouts[i].join(" / ")}`));
			children.push(ctx.line(x(median), cy - 7, x(median), cy + 7, paintLine(ctx.palette.bg, 2.5, "chart-median", true)));
			for (const value of outliers[i] || []) extras.push(ctx.circle(x(value), cy, 2.5, {
				class: "chart-dot chart-dot-2",
				fill: ctx.palette.accent,
				stroke: ctx.palette.bg,
				"stroke-width": 2,
				meta: {
					kind: "outlier",
					value
				}
			}));
		}
	});
	const legend = [];
	if (dumbbell) {
		const named = (field, fallback) => {
			const label = ctx.field(field).label;
			return label && label !== field ? label : fallback;
		};
		const items = [[
			"before",
			named(e.before, en ? "Before" : "之前"),
			ctx.palette.bg,
			ctx.palette.tone3
		], [
			"after",
			named(e.after, en ? "After" : "之后"),
			ctx.palette.tone1,
			ctx.palette.bg
		]].map(([role, text, fill, stroke]) => ({
			role,
			text,
			fill,
			stroke,
			w: 14 + ctx.measure(text, 12, 400)
		}));
		const y = height + 18;
		let x = width / 2 - (items[0].w + items[1].w + 18) / 2;
		for (const { role, text, fill, stroke, w } of items) {
			legend.push(ctx.circle(x + 4, y - 4, 4, {
				fill,
				stroke,
				"stroke-width": 2,
				meta: {
					kind: "endpoint-legend",
					role
				}
			}));
			legend.push(ctx.text(x + 14, y, text));
			x += w + 18;
		}
	}
	const meta = ctx.field(fields[0]), unit = bullet || dumbbell || meta.format === "percent" ? "" : String(meta.unit || "").trim();
	if (unit) labels.push(ctx.text(left + plotW, height + 10, unit, {
		anchor: "end",
		fill: ctx.palette.muted,
		meta: {
			kind: "axis-unit",
			label: unit
		}
	}));
	return {
		width,
		height: height + (dumbbell ? 32 : 0) + (unit ? 18 : 0),
		children: [
			...children,
			...labels,
			...legend,
			...extras
		]
	};
}
export { compare, stat_compare_exports };
