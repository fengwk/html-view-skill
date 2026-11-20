import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { register } from "./registry.js";
// src/chart/composition.js
var composition_exports = /* @__PURE__ */ __exportAll({ install: () => install });
var TAU = Math.PI * 2;
var polar = (cx, cy, r, a) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
var words = (ctx, zh, en) => /^en(?:-|$)/i.test(String(ctx.lang || "")) ? en : zh;
function outerArc(cx, cy, r, a0, a1) {
	const span = a1 - a0, start = polar(cx, cy, r, a0);
	if (span <= 1e-12) return {
		start,
		curve: ""
	};
	if (span >= TAU - 1e-9) return {
		start,
		curve: ` A${r},${r} 0 1 1 ${polar(cx, cy, r, a0 + span / 2)} A${r},${r} 0 1 1 ${start}`,
		full: true
	};
	const large = span > Math.PI ? 1 : 0;
	return {
		start,
		curve: ` A${r},${r} 0 ${large} 1 ${polar(cx, cy, r, a1)}`,
		large
	};
}
var solidPath = (cx, cy, { start, curve, full }) => !curve ? `M${start}` : full ? `M${start}${curve} Z` : `M${cx},${cy} L${start}${curve} Z`;
function arcPath(cx, cy, r0, r1, a0, a1) {
	const arc = outerArc(cx, cy, r1, a0, a1), outer = `M${arc.start}${arc.curve}`;
	if (!arc.curve) return outer;
	if (r0 <= 0) return solidPath(cx, cy, arc);
	const innerStart = polar(cx, cy, r0, a0);
	if (arc.full) return `${outer} Z M${innerStart} A${r0},${r0} 0 1 0 ${polar(cx, cy, r0, a0 + (a1 - a0) / 2)} A${r0},${r0} 0 1 0 ${innerStart} Z`;
	return `${outer} L${polar(cx, cy, r0, a1)} A${r0},${r0} 0 ${arc.large} 0 ${innerStart} Z`;
}
function solidSectors(ctx, cx, cy, sectors) {
	const fills = [], border = [];
	const arcs = sectors.map(({ r, a0, a1 }) => r > 0 ? outerArc(cx, cy, r, a0, a1) : null);
	for (const [i, { r, a0, fill, meta }] of sectors.entries()) {
		const arc = arcs[i];
		if (arc) fills.push(ctx.path(solidPath(cx, cy, arc), {
			fill,
			meta
		}));
		if (arc?.curve) border.push(`M${arc.start}${arc.curve}${arc.full ? " Z" : ""}`);
		if (sectors.length < 2) continue;
		const previous = (i + sectors.length - 1) % sectors.length;
		const reach = Math.max(arc?.curve ? r : 0, arcs[previous]?.curve ? sectors[previous].r : 0);
		if (reach > 0) border.push(`M${cx},${cy} L${polar(cx, cy, reach, a0)}`);
	}
	if (border.length) fills.push(ctx.path(border.join(" "), {
		fill: "none",
		stroke: ctx.color("bg"),
		"stroke-width": 2,
		"stroke-linecap": "round",
		"pointer-events": "none"
	}));
	return fills;
}
var pointMeta = (row, field, value, name) => ({
	id: row.id == null ? void 0 : String(row.id),
	kind: name,
	record: row,
	value,
	label: field
});
var stackedLegendWidth = (ctx, items, maxWidth) => {
	if (items.length < 2) return maxWidth;
	const widths = items.map((item) => 16 + ctx.measure(item.label, 12, 400));
	const longest = Math.max(...widths);
	if (longest <= maxWidth) return longest;
	return maxWidth;
};
var pieSlices = (spec, ctx) => {
	const table = ctx.table(spec), field = table.valueFields[0];
	const rows = table.categories.map((category) => table.rows.find((r) => r[table.categoryField] === category)).filter(Boolean);
	const values = rows.map((row) => row[field]);
	const total = values.reduce((sum, value) => sum + value, 0);
	if (!(total > 0)) ctx.fit("构成图总值必须大于0", "为至少一个类别提供正值");
	return {
		table,
		field,
		rows,
		values,
		total
	};
};
function pieLayout(spec, ctx, isDonut = false) {
	const { table, field, rows, values, total } = pieSlices(spec, ctx);
	const width = ctx.width;
	const items = rows.map((row, i) => ({
		label: `${row[table.categoryField]}　${ctx.format(values[i], field)} (${ctx.percent(values[i] / total)})`,
		color: ctx.color(`tone${i % 6 + 1}`),
		meta: pointMeta(row, String(row[table.categoryField]), values[i], spec.chart)
	}));
	const sideLegend = width > 560;
	const legendWidth = sideLegend ? Math.min(320, Math.max(180, width * .34)) : Math.min(width - 32, 270);
	const chartSpan = sideLegend ? Math.min(width - legendWidth - 36, 460) : width;
	const groupWidth = sideLegend ? chartSpan + 28 + legendWidth : width;
	const groupX = sideLegend ? (width - groupWidth) / 2 : 0;
	const cx = sideLegend ? groupX + chartSpan / 2 : width / 2;
	const r = width <= 360 ? Math.min(112, width * .275) : Math.min(sideLegend ? 168 : 112, Math.max(60, chartSpan * .32));
	const cy = r + 36, inner = isDonut ? r * .58 : 0;
	const children = [], sectors = [], sliceLabels = [], ticksVariant = isDonut && spec.variant === "ticks";
	let a = -Math.PI / 2;
	rows.forEach((row, i) => {
		const next = a + TAU * values[i] / total;
		if (!ticksVariant && values[i] > 0) {
			const fill = ctx.color(`tone${i % 6 + 1}`);
			const meta = pointMeta(row, String(row[table.categoryField]), values[i], spec.chart);
			if (isDonut) children.push(ctx.path(arcPath(cx, cy, inner, r, a, next), {
				fill,
				stroke: ctx.color("bg"),
				"stroke-width": 2,
				meta
			}));
			else sectors.push({
				r,
				a0: a,
				a1: next,
				fill,
				meta
			});
			if (spec.sliceLabels && next - a >= 14 * Math.PI / 180 && 2 * r * .72 * Math.sin(Math.min(Math.PI, next - a) / 2) >= ctx.measure("100%", 12, 600) + 8) {
				const [x, y] = polar(cx, cy, r * .72, (a + next) / 2);
				sliceLabels.push(ctx.text(x, y + 4, `${Math.round(100 * values[i] / total)}%`, {
					anchor: "middle",
					size: 12,
					weight: 600,
					fill: ctx.textOn(fill)
				}));
			}
		}
		a = next;
	});
	if (!isDonut) children.push(...solidSectors(ctx, cx, cy, sectors), ...sliceLabels);
	if (ticksVariant) {
		const count = Math.min(240, Math.max(96, Math.floor(TAU * (r - 8.5) / 2.5)));
		for (let tick = 0; tick < count; tick += 1) {
			const fraction = (tick + .5) / count;
			let cumulative = 0, index = values.length - 1;
			for (let i = 0; i < values.length; i += 1) {
				cumulative += values[i] / total;
				if (fraction <= cumulative) {
					index = i;
					break;
				}
			}
			const angle = -Math.PI / 2 + TAU * fraction, p1 = polar(cx, cy, r - 17, angle), p2 = polar(cx, cy, r, angle);
			children.push(ctx.line(...p1, ...p2, {
				stroke: ctx.color(`tone${index % 6 + 1}`),
				"stroke-width": 2,
				"stroke-linecap": "round",
				meta: {
					kind: "donut-tick",
					category: String(rows[index][table.categoryField]),
					fraction
				}
			}));
		}
	}
	if (isDonut) {
		const caption = spec.fields?.[field]?.label || words(ctx, "合计", "Total");
		const hole = ticksVariant ? r - 17 : inner;
		const room = (dy) => 2 * Math.sqrt(Math.max(0, hole * hole - dy * dy)) - 16;
		const whole = ctx.format(total, field), unit = String(ctx.field(field).unit || "").trim();
		if (ctx.measure(whole, 20, 650) <= room(20) || !unit) children.push(ctx.text(cx, cy - 12, caption, {
			anchor: "middle",
			size: 12,
			fill: ctx.color("muted")
		}), ctx.text(cx, cy + 14, whole, {
			anchor: "middle",
			size: 20,
			weight: 650,
			fill: ctx.color("fg")
		}));
		else children.push(ctx.text(cx, cy - 20, caption, {
			anchor: "middle",
			size: 12,
			fill: ctx.color("muted")
		}), ctx.text(cx, cy + 6, ctx.format(total, field, false), {
			anchor: "middle",
			size: 20,
			weight: 650,
			fill: ctx.color("fg")
		}), ctx.text(cx, cy + 24, unit, {
			anchor: "middle",
			size: 12,
			fill: ctx.color("muted")
		}));
	}
	const actualLegendWidth = sideLegend || !(width <= 360) ? legendWidth : stackedLegendWidth(ctx, items, legendWidth);
	const legend = ctx.legend(items, actualLegendWidth);
	if (sideLegend) {
		const legendX = groupX + chartSpan + 28;
		const legendY = Math.max(16, cy - legend.height / 2);
		children.push(ctx.el("g", { transform: `translate(${legendX}, ${legendY})` }, legend.children));
		return ctx.scene(Math.max(cy + r + 24, legendY + legend.height + 8), children, spec.title);
	}
	children.push(ctx.el("g", { transform: `translate(${(width - actualLegendWidth) / 2}, ${cy + r + 24})` }, legend.children));
	return ctx.scene(cy + r + 30 + legend.height, children, spec.title);
}
function radialShare(spec, ctx) {
	const t = ctx.table(spec), valueField = t.valueFields[0], intensityField = spec.encode.intensity;
	const rows = t.categories.map((category) => t.rows.find((row) => row[t.categoryField] === category)).filter(Boolean);
	const sum = rows.reduce((n, row) => n + row[valueField], 0), [, hi] = ctx.field(intensityField).domain || ctx.extent(rows.map((r) => r[intensityField]));
	const sideLegend = ctx.width > 560;
	const legendWidth = sideLegend ? Math.min(360, Math.max(200, ctx.width * .38)) : Math.min(360, ctx.width - 32);
	const chartSpan = sideLegend ? Math.min(ctx.width - legendWidth - 36, 460) : ctx.width;
	const groupX = sideLegend ? (ctx.width - chartSpan - 28 - legendWidth) / 2 : 0;
	const cx = sideLegend ? groupX + chartSpan / 2 : ctx.width / 2;
	const maxR = ctx.width <= 360 ? Math.min(112, ctx.width * .275) : Math.min(sideLegend ? 168 : 112, chartSpan * .32);
	const cy = maxR + 42, minR = 44, children = [];
	let a = -Math.PI / 2;
	rows.forEach((row, i) => {
		const share = row[valueField] / sum, next = a + TAU * share, intensity = row[intensityField];
		const strength = hi > 0 ? Math.max(0, Math.min(1, intensity / hi)) : 0;
		const r = Math.sqrt(1936 + (maxR * maxR - 1936) * strength);
		if (share > 0) children.push(ctx.path(arcPath(cx, cy, minR, r, a, next), {
			fill: ctx.color(`tone${i % 6 + 1}`),
			stroke: ctx.color("bg"),
			"stroke-width": 2,
			meta: {
				...pointMeta(row, String(row[t.categoryField]), row[valueField], "radial-share"),
				intensity
			}
		}));
		children.push(ctx.path(arcPath(cx, cy, maxR + 6, maxR + 9, a, next), {
			fill: ctx.color(`tone${i % 6 + 1}`),
			meta: {
				kind: "share-label-ring",
				label: String(row[t.categoryField]),
				value: row[valueField]
			}
		}));
		a = next;
	});
	const key = [words(ctx, "角度＝份额", "Angle = share"), words(ctx, "半径＝强度", "Radius = intensity")];
	const room = (dy) => 2 * Math.sqrt(Math.max(0, 1936 - dy * dy)) - 12;
	const inside = ctx.measure(key[0], 12) <= room(16) && ctx.measure(key[1], 12) <= room(17);
	if (inside) children.push(ctx.text(cx, cy - 4, key[0], {
		anchor: "middle",
		size: 12,
		fill: ctx.color("fg")
	}), ctx.text(cx, cy + 14, key[1], {
		anchor: "middle",
		size: 12,
		fill: ctx.color("muted")
	}));
	const note = (x, top, w) => {
		if (inside) return 0;
		const lines = ctx.wrap(words(ctx, "角度表示份额，半径表示强度。", "Angle shows share; radius shows intensity."), w, 12);
		children.push(ctx.textLines(x, top + 12, lines, {
			fill: ctx.color("muted"),
			meta: { kind: "radial-share-key" }
		}));
		return lines.length * 16 + 8;
	};
	const items = rows.map((row, i) => ({
		label: `${row[t.categoryField]} · ${ctx.format(row[valueField], valueField)} (${ctx.percent(row[valueField] / sum)}) · ${words(ctx, "强度", "intensity")} ${ctx.format(row[intensityField], intensityField)}`,
		color: ctx.color(`tone${i % 6 + 1}`),
		meta: {
			kind: "share-label",
			label: String(row[t.categoryField]),
			value: row[valueField],
			intensity: row[intensityField]
		}
	}));
	const actualLegendWidth = sideLegend || ctx.width > 360 ? legendWidth : stackedLegendWidth(ctx, items, legendWidth);
	const legend = ctx.legend(items, actualLegendWidth);
	if (sideLegend) {
		const legendX = groupX + chartSpan + 28;
		const legendY = Math.max(16, cy - legend.height / 2);
		children.push(ctx.el("g", { transform: `translate(${legendX}, ${legendY})` }, legend.children));
		const noted = note(legendX, legendY + legend.height + 10, legendWidth);
		return ctx.scene(Math.max(cy + maxR + 24, legendY + legend.height + 8 + noted), children, spec.title);
	}
	const legendY = cy + maxR + 22, legendX = (ctx.width - actualLegendWidth) / 2;
	children.push(ctx.el("g", { transform: `translate(${legendX}, ${legendY})` }, legend.children));
	const noted = note(legendX, legendY + legend.height + 10, actualLegendWidth);
	return ctx.scene(legendY + legend.height + 8 + noted, children, spec.title);
}
function rose(spec, ctx) {
	const { table, field, rows, values, total } = pieSlices(spec, ctx);
	const sideLegend = ctx.width > 560;
	const legendWidth = sideLegend ? Math.min(320, Math.max(180, ctx.width * .34)) : Math.min(360, ctx.width - 32);
	const chartSpan = sideLegend ? Math.min(ctx.width - legendWidth - 36, 460) : ctx.width;
	const groupX = sideLegend ? (ctx.width - chartSpan - 28 - legendWidth) / 2 : 0;
	const cx = sideLegend ? groupX + chartSpan / 2 : ctx.width / 2;
	const maxR = ctx.width <= 360 ? Math.min(116, ctx.width * .275) : Math.min(sideLegend ? 168 : 116, chartSpan * .32);
	const cy = maxR + 32, maxValue = Math.max(...values);
	let a = -Math.PI / 2;
	const children = solidSectors(ctx, cx, cy, rows.map((row, i) => {
		const next = a + TAU / rows.length;
		const sector = {
			a0: a,
			a1: next,
			r: maxR * Math.sqrt(values[i] / maxValue),
			fill: ctx.color(`tone${i % 6 + 1}`),
			meta: pointMeta(row, String(row[table.categoryField]), values[i], "rose")
		};
		a = next;
		return sector;
	}));
	const items = rows.map((row, i) => ({
		label: `${row[table.categoryField]} · ${ctx.format(values[i], field)}`,
		color: ctx.color(`tone${i % 6 + 1}`),
		meta: {
			kind: "rose-label",
			label: String(row[table.categoryField]),
			value: values[i]
		}
	}));
	const actualLegendWidth = sideLegend || ctx.width > 360 ? legendWidth : stackedLegendWidth(ctx, items, legendWidth);
	const legend = ctx.legend(items, actualLegendWidth);
	const caption = spec.fields?.[field]?.label || words(ctx, "合计", "Total");
	if (sideLegend) {
		const legendX = groupX + chartSpan + 28;
		const legendY = Math.max(16, cy - legend.height / 2);
		children.push(ctx.text(cx, cy + maxR + 22, `${caption} ${ctx.format(total, field)}`, {
			anchor: "middle",
			size: 12,
			fill: ctx.color("muted")
		}));
		children.push(ctx.el("g", { transform: `translate(${legendX}, ${legendY})` }, legend.children));
		return ctx.scene(Math.max(cy + maxR + 40, legendY + legend.height + 8), children, spec.title);
	}
	const readingY = cy + maxR + 18, legendY = readingY + 20;
	children.push(ctx.text(cx, readingY, `${caption} ${ctx.format(total, field)}`, {
		anchor: "middle",
		size: 12,
		fill: ctx.color("muted")
	}));
	children.push(ctx.el("g", { transform: `translate(${(ctx.width - actualLegendWidth) / 2}, ${legendY})` }, legend.children));
	return ctx.scene(legendY + legend.height + 8, children, spec.title);
}
function gauge(spec, ctx) {
	const row = spec.data[0], field = spec.encode.value, value = row[field], target = spec.encode.target ? row[spec.encode.target] : null;
	const [min, max] = spec.range, ratio = (value - min) / (max - min), x = 64, width = Math.min(ctx.width - 128, 560), children = [];
	const unitValue = (v) => ctx.format(v, field), targetLabel = words(ctx, "目标", "Target");
	const arcRadius = Math.min(200, ctx.width * .38);
	const ends = ctx.ticks([min, max], field, { count: 2 });
	const endText = (v) => {
		const index = ends.ticks.findIndex((tick) => Math.abs(tick - v) < 1e-9);
		return index >= 0 ? ends.labels[index] : unitValue(v);
	};
	const reading = `${unitValue(value)}${target == null ? "" : `  ·  ${targetLabel} ${unitValue(target)}`}`;
	const readingWidth = ctx.measure(reading, 16, 600);
	const readingX = readingWidth <= width ? x : x + width / 2;
	const readingAnchor = readingWidth <= width ? "start" : "middle";
	const barReadingY = 34;
	if ((spec.variant || "bar") === "bar") {
		const y = 56;
		children.push(ctx.rect(x, y, width, 18, {
			rx: 9,
			fill: ctx.color("grid")
		}), ctx.rect(x, y, width * ratio, 18, {
			rx: 9,
			fill: ctx.color("accent"),
			meta: {
				kind: "gauge-value",
				value
			}
		}));
		if (target != null) {
			const tx = x + width * (target - min) / (max - min);
			children.push(ctx.line(tx, 47, tx, 83, {
				stroke: ctx.color("ink"),
				"stroke-width": 2,
				meta: {
					kind: "gauge-target",
					value: target
				}
			}));
		}
		children.push(ctx.text(x, 100, endText(min), { size: 12 }), ctx.text(x + width, 100, endText(max), {
			anchor: "end",
			size: 12
		}));
	} else {
		const cx = ctx.width / 2, r = arcRadius, cy = r + 26, start = Math.PI, end = Math.PI + Math.PI * ratio;
		const ticks = 20;
		for (let i = 0; i <= ticks; i++) {
			const a = Math.PI + Math.PI * i / ticks, p1 = polar(cx, cy, r + 4, a), p2 = polar(cx, cy, r + (i % 5 === 0 ? 15 : 10), a);
			children.push(ctx.line(...p1, ...p2, {
				stroke: ctx.color(i / ticks <= ratio ? "accent" : "axis"),
				"stroke-width": i % 5 === 0 ? 2 : 1,
				meta: {
					kind: "gauge-tick",
					major: i % 5 === 0,
					fraction: i / ticks
				}
			}));
		}
		if ((spec.variant || "bar") === "arc") {
			children.push(ctx.path(arcPath(cx, cy, r - 7, r, start, 2 * Math.PI), {
				fill: ctx.color("grid"),
				meta: { kind: "gauge-track" }
			}));
			children.push(ctx.path(arcPath(cx, cy, r - 7, r, start, end), {
				fill: ctx.color("accent"),
				meta: {
					kind: "gauge-arc",
					value
				}
			}));
		} else {
			const [x1, y1] = polar(cx, cy, 8, start);
			const [x2, y2] = polar(cx, cy, r, end);
			children.push(ctx.line(x1, y1, x2, y2, {
				stroke: ctx.color("accent"),
				"stroke-width": 3,
				"stroke-linecap": "round",
				meta: {
					kind: "gauge-needle",
					value
				}
			}), ctx.circle(cx, cy, 6, { fill: ctx.color("ink") }));
		}
		const minLabel = endText(min), maxLabel = endText(max);
		const minLabelWidth = ctx.measure(minLabel, 12, 400), maxLabelWidth = ctx.measure(maxLabel, 12, 400);
		const minLabelX = Math.max(minLabelWidth / 2, cx - r);
		const maxLabelX = Math.min(ctx.width - maxLabelWidth / 2, cx + r);
		children.push(ctx.text(cx, cy + 54, unitValue(value), {
			anchor: "middle",
			size: 20,
			weight: 600,
			fill: ctx.color("fg"),
			meta: {
				kind: "gauge-reading",
				value
			}
		}), ctx.text(minLabelX, cy + 24, minLabel, {
			anchor: "middle",
			size: 12,
			meta: {
				kind: "gauge-min",
				value: min
			}
		}), ctx.text(maxLabelX, cy + 24, maxLabel, {
			anchor: "middle",
			size: 12,
			meta: {
				kind: "gauge-max",
				value: max
			}
		}));
		if (target != null) {
			const fraction = (target - min) / (max - min);
			const angle = Math.PI + Math.PI * fraction;
			const label = `${targetLabel} ${unitValue(target)}`;
			const labelWidth = ctx.measure(label, 12, 400);
			const anchor = fraction <= .2 ? "start" : fraction >= .8 ? "end" : "middle";
			const inward = anchor === "end" ? -labelWidth / 2 : anchor === "start" ? labelWidth / 2 : 0;
			const [tx, targetY] = polar(cx, cy, r + 20, angle);
			const ty = Math.max(12, targetY);
			children.push(ctx.text(tx + inward, ty, label, {
				anchor,
				size: 12,
				fill: ctx.color("ink"),
				meta: {
					kind: "gauge-target",
					value: target
				}
			}));
		}
	}
	if ((spec.variant || "bar") === "bar") children.push(ctx.text(readingX, barReadingY, reading, {
		anchor: readingAnchor,
		size: 16,
		weight: 600,
		fill: ctx.color("fg"),
		meta: {
			kind: "gauge-reading",
			value,
			target
		}
	}));
	const scene = ctx.scene((spec.variant || "bar") === "bar" ? 122 : arcRadius + 26 + 92, children, spec.title);
	if ((spec.variant || "bar") === "bar") {
		const readingRight = readingAnchor === "middle" ? readingX + readingWidth / 2 : readingX + readingWidth;
		scene.width = Math.max(ctx.width, readingRight + 16, x + width + 16);
	}
	return scene;
}
var treeNodes = (root) => {
	const walk = (node, parent, depth, path) => {
		const item = {
			node,
			parent,
			depth,
			path,
			children: [],
			value: 0
		};
		const nodes = Array.isArray(node.children) ? node.children.filter(Boolean) : [];
		item.children = nodes.map((child, i) => walk(child, item, depth + 1, `${path}.${i + 1}`));
		item.value = nodes.length ? item.children.reduce((sum, child) => sum + child.value, 0) : Number(node.value || 0);
		return item;
	};
	const entry = walk(root, null, 0, "1"), out = [];
	const visit = (item) => {
		out.push(item);
		item.children.forEach(visit);
	};
	visit(entry);
	return out;
};
function fallbackLegend(children, entries, x, y, width, ctx, kind) {
	for (const item of entries) {
		const lines = ctx.wrap(`${item.index}. ${item.label} · ${ctx.format(item.value, "value")}`, Math.max(1, width - 28), 12);
		children.push(ctx.rect(x, y - 10, 12, 12, { fill: item.color }), ctx.textLines(x + 18, y, lines, {
			size: 12,
			fill: ctx.color("fg")
		}));
		const text = children[children.length - 1];
		if (text.children) text.children[0].meta = {
			kind,
			path: item.path,
			label: item.label,
			value: item.value,
			index: item.index
		};
		y += lines.length * 16 + 2;
	}
	return y;
}
function treemap(spec, ctx) {
	const root = spec.data, width = Math.min(ctx.width - 48, 752), top = 44, tree = treeNodes(root), leaves = tree.filter((x) => !x.children.length);
	tree[0].value;
	const tones = new Map(leaves.map((leaf, i) => [leaf, `tone${i % 6 + 1}`])), children = [], fallback = [];
	const colorOf = (leaf) => ctx.color(tones.get(leaf));
	const place = (entry, x, y, w, h, depth, hidden = []) => {
		if (depth > 0 && w > 0 && h > 0) children.push(ctx.rect(x, y, w, h, {
			fill: depth === 1 ? ctx.color("bg") : "none",
			stroke: ctx.color("axis"),
			"stroke-width": 1,
			meta: {
				kind: "treemap-node",
				label: String(entry.node.label),
				value: entry.value,
				path: entry.path
			}
		}));
		if (!entry.children.length) {
			if (entry.value > 0 && w > 0 && h > 0) {
				const i = leaves.indexOf(entry), inset = 2, label = String(entry.node.label), value = ctx.format(entry.value, "value");
				const listed = [...hidden, label].join(" / ");
				const tileW = Math.max(0, w - 4), tileH = Math.max(0, h - 4);
				const labelColor = ctx.textOn(tones.get(entry));
				children.push(ctx.rect(x + inset, y + inset, tileW, tileH, {
					fill: colorOf(entry),
					meta: {
						kind: "treemap-leaf",
						label,
						value: entry.value,
						path: entry.path
					}
				}));
				const fullLabel = `${label} · ${value}`;
				const fullWidth = ctx.measure(fullLabel, 12, 600);
				const index = i + 1;
				if (!hidden.length && tileW >= fullWidth + 12 && tileH >= 34) children.push(ctx.text(x + 7, y + 18, fullLabel, {
					size: 12,
					weight: 600,
					fill: labelColor,
					meta: {
						kind: "treemap-tile-label",
						label,
						value: entry.value,
						path: entry.path,
						mode: "name-value"
					}
				}));
				else {
					fallback.push({
						index,
						label: listed,
						value: entry.value,
						path: entry.path,
						color: colorOf(entry)
					});
					if (tileW >= ctx.measure(String(index), 12, 600) + 12 && tileH >= 22) children.push(ctx.text(x + 7, y + 16, String(index), {
						size: 12,
						weight: 600,
						fill: labelColor,
						meta: {
							kind: "treemap-tile-index",
							label,
							value: entry.value,
							path: entry.path,
							index
						}
					}));
				}
			} else if (!entry.children.length) {
				const i = leaves.indexOf(entry);
				fallback.push({
					index: i + 1,
					label: [...hidden, String(entry.node.label)].join(" / "),
					value: entry.value,
					path: entry.path,
					color: colorOf(entry)
				});
			}
			return;
		}
		const header = depth > 0 && h >= 32 && ctx.measure(String(entry.node.label), 12, 600) + 14 <= w ? 20 : 0;
		if (depth > 0 && header) children.push(ctx.text(x + 7, y + 15, String(entry.node.label), {
			size: 12,
			weight: 600,
			fill: ctx.color("fg"),
			meta: {
				kind: "treemap-group-label",
				label: String(entry.node.label),
				path: entry.path
			}
		}));
		const below = depth > 0 && !header ? [...hidden, String(entry.node.label)] : hidden;
		const contentY = y + header, contentH = Math.max(0, h - header);
		const vertical = depth % 2 === 0;
		const span = vertical ? w : contentH;
		let offset = 0;
		entry.children.forEach((child) => {
			const part = entry.value > 0 && child.value > 0 ? span * child.value / entry.value : 0;
			if (vertical) place(child, x + offset, contentY, part, contentH, depth + 1, below);
			else place(child, x, contentY + offset, w, part, depth + 1, below);
			offset += part;
		});
	};
	place(tree[0], 24, top, width, 242, 0);
	const listEnd = fallbackLegend(children, fallback, 24, 310, Math.min(width, 360), ctx, "treemap-name");
	const height = fallback.length ? listEnd + 8 : 294;
	return ctx.scene(height, children, spec.title);
}
function sunburst(spec, ctx) {
	const tree = treeNodes(spec.data), root = tree[0], nodes = tree.filter((entry) => entry.depth > 0), fallback = [];
	const indexes = new Map(nodes.map((entry, i) => [entry, i + 1]));
	const maxDepth = Math.max(1, ...tree.map((entry) => entry.depth)), outerR = Math.max(8, Math.min(ctx.width / 2 - 20, 220));
	const rootLabel = String(root.node.label);
	const rootWidth = ctx.measure(rootLabel, 12, 600);
	const hole = Math.min(Math.max(36, rootWidth + 16), Math.max(36, outerR * .42));
	const r0 = Math.min(hole, Math.max(36, outerR / (maxDepth + 1)));
	const thickness = (outerR - r0) / maxDepth, cx = ctx.width / 2, cy = outerR + 24, children = [];
	const rootBranch = (entry) => {
		let branch = entry;
		while (branch.parent && branch.parent !== root) branch = branch.parent;
		return branch;
	};
	const branchColor = new Map(root.children.map((branch, i) => [branch, ctx.palette[`tone${i % 6 + 1}`]]));
	const colorFor = (entry) => branchColor.get(rootBranch(entry)) || ctx.palette.tone1;
	const shadeFor = (entry) => ctx.mix(colorFor(entry), ctx.palette.bg, Math.min(.72, .35 + Math.max(0, entry.depth - 1) * .12));
	const walk = (entry, a0, a1) => {
		const depth = entry.depth;
		if (depth > 0 && entry.value > 0 && a1 > a0) {
			const nodeColor = shadeFor(entry);
			const innerR = r0 + (depth - 1) * thickness, outer = r0 + depth * thickness, index = indexes.get(entry);
			children.push(ctx.path(arcPath(cx, cy, innerR, outer, a0, a1), {
				fill: nodeColor,
				stroke: ctx.color("bg"),
				"stroke-width": 2,
				meta: {
					kind: "sunburst-node",
					label: String(entry.node.label),
					value: entry.value,
					path: entry.path,
					depth
				}
			}));
			const midR = (innerR + outer) / 2, midA = (a0 + a1) / 2, available = 2 * midR * Math.sin(Math.min(Math.PI, a1 - a0) / 2), radialWidth = 2 * Math.max(0, midR - innerR - 5), name = String(entry.node.label);
			const fullLabel = `${name} · ${ctx.format(entry.value, "value")}`, fullLabelWidth = ctx.measure(fullLabel, 12, 600);
			const labelOn = ctx.textOn(nodeColor);
			if (thickness >= 16 && available >= fullLabelWidth + 8 && radialWidth >= fullLabelWidth + 8) {
				const [tx, ty] = polar(cx, cy, midR, midA);
				children.push(ctx.text(tx, ty + 4, fullLabel, {
					anchor: "middle",
					size: 12,
					weight: 600,
					fill: labelOn,
					meta: {
						kind: "sunburst-ring-label",
						label: name,
						value: entry.value,
						path: entry.path,
						depth
					}
				}));
			} else {
				fallback.push({
					index,
					label: name,
					value: entry.value,
					path: entry.path,
					color: nodeColor
				});
				const indexWidth = ctx.measure(String(index), 12, 600);
				if (thickness >= 16 && available >= indexWidth + 8 && radialWidth >= indexWidth + 8) {
					const [tx, ty] = polar(cx, cy, midR, midA);
					children.push(ctx.text(tx, ty + 4, String(index), {
						anchor: "middle",
						size: 12,
						weight: 600,
						fill: labelOn,
						meta: {
							kind: "sunburst-ring-index",
							label: name,
							value: entry.value,
							path: entry.path,
							depth,
							index
						}
					}));
				}
			}
		} else if (depth > 0 && entry.value === 0) fallback.push({
			index: indexes.get(entry),
			label: String(entry.node.label),
			value: 0,
			path: entry.path,
			color: shadeFor(entry)
		});
		let angle = a0;
		entry.children.forEach((child) => {
			const next = entry.value > 0 ? angle + (a1 - a0) * child.value / entry.value : angle;
			walk(child, angle, next);
			angle = next;
		});
	};
	walk(root, -Math.PI / 2, Math.PI * 1.5);
	children.push(ctx.circle(cx, cy, Math.max(1, r0 - 2), { fill: ctx.color("bg") }));
	const holeWidth = Math.max(1, 2 * (r0 - 8));
	const holeLines = Math.max(1, Math.floor(2 * (r0 - 6) / 16));
	let rootLines = ctx.wrap(rootLabel, holeWidth, 12, 600);
	let centreOutside = false;
	if (rootLines.length > holeLines || rootLines.some((line) => ctx.measure(line, 12, 600) > holeWidth)) {
		centreOutside = true;
		rootLines = ctx.wrap(rootLabel, Math.max(80, ctx.width - 36), 12, 600);
	}
	const rootY = centreOutside ? cy + outerR + 22 : cy - (rootLines.length - 1) * 8 + 4;
	children.push(ctx.textLines(cx, rootY, rootLines, {
		anchor: "middle",
		size: 12,
		weight: 600,
		fill: ctx.color("fg"),
		meta: {
			kind: "sunburst-centre",
			label: rootLabel
		}
	}));
	const listEnd = fallbackLegend(children, fallback, 18, centreOutside ? rootY + rootLines.length * 16 + 12 : cy + outerR + 28, ctx.width - 36, ctx, "sunburst-name");
	const centreEnd = centreOutside ? rootY + rootLines.length * 16 + 8 : cy + outerR + 20;
	return ctx.scene(fallback.length ? listEnd + 8 : centreEnd, children, spec.title);
}
function install({ register }) {
	register("pie", (spec, ctx) => pieLayout(spec, ctx, false));
	register("donut", (spec, ctx) => pieLayout(spec, ctx, true));
	register("radial-share", radialShare);
	register("rose", rose);
	register("gauge", gauge);
	register("treemap", treemap);
	register("sunburst", sunburst);
}
install({ register });
export { composition_exports, install };
