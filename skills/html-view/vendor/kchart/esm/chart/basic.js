import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { register } from "./registry.js";
// src/chart/basic.js
var basic_exports = /* @__PURE__ */ __exportAll({ install: () => install });
var segmentsOf = (values) => {
	const segments = [];
	let current = null;
	values.forEach((value, index) => {
		if (value == null) {
			current = null;
			return;
		}
		if (!current) {
			current = [];
			segments.push(current);
		}
		current.push({
			index,
			value
		});
	});
	return segments;
};
var path = (points, close = false) => {
	if (!points.length) return "";
	return `${points.map(([x, y], i) => `${i ? "L" : "M"}${Number(x.toFixed(2))},${Number(y.toFixed(2))}`).join(" ")}${close ? " Z" : ""}`;
};
var tone = (ctx, index) => ctx.color(`tone${index % 6 + 1}`);
/**
* 按统一步长抽稀类别轴，避免零散的标签间隔被误读成数据缺失。
* 优先保留首尾；末标签与前一个整步标签相撞时去掉后者。在不超过最小可用步长 1.5 倍的范围里
* 取末段间隔最接近整步的一种。crowded(a, b) 由图族按自己的对齐方式判断两个标签是否太近。
*/
var evenLabels = (count, crowded, start = 1) => {
	const last = count - 1;
	const pick = (step) => {
		const shown = [];
		for (let index = 0; index < count; index += step) shown.push(index);
		if (shown.at(-1) !== last) {
			if (shown.length > 1 && crowded(shown.at(-1), last)) shown.pop();
			shown.push(last);
		}
		return shown;
	};
	const fits = (step) => !pick(step).some((index, i, shown) => i > 0 && crowded(shown[i - 1], index));
	const unevenness = (step) => {
		const shown = pick(step);
		return shown.length < 3 ? 0 : Math.abs(shown.at(-1) - shown.at(-2) - step) / step;
	};
	let step = Math.max(1, start);
	while (step < last && !fits(step)) step += 1;
	for (let next = step + 1, limit = Math.floor(step * 1.5); next <= limit && next < last; next += 1) if (fits(next) && unevenness(next) < unevenness(step) - 1e-9) step = next;
	return {
		step,
		shown: new Set(pick(step))
	};
};
var emphasisStyle = (ctx, spec, series, field, record, index, recolor = false) => {
	const emphasis = spec.emphasis || {};
	const selected = (emphasis.series || []).includes(series) || (emphasis.fields || []).includes(field) || record != null && (emphasis.rows || []).includes(record);
	const active = [
		"series",
		"fields",
		"rows"
	].some((key) => Array.isArray(emphasis[key]) && emphasis[key].length > 0);
	return {
		fill: selected && recolor ? ctx.color("accent") : tone(ctx, index),
		opacity: active && !selected ? .28 : 1,
		selected
	};
};
var isEnglish = (lang) => /^en(?:-|$)/i.test(String(lang || ""));
var aria = (type, data, lang = "zh") => {
	return `${(isEnglish(lang) ? {
		line: "Line chart",
		area: "Area chart",
		column: "Column chart",
		bar: "Bar chart",
		share: "Share chart",
		funnel: "Funnel chart"
	} : {
		line: "折线图",
		area: "面积图",
		column: "柱状图",
		bar: "条形图",
		share: "占比图",
		funnel: "漏斗图"
	})[type]}: ${data.categories.join(isEnglish(lang) ? ", " : "、")}`;
};
var labelWidth = (ctx, value, size = 12, weight = 400) => ctx.measure(String(value), size, weight);
var LINE_BOX = 16;
var dodgeReadouts = (items, minY, maxY) => {
	const groups = [];
	items.forEach((item) => {
		const group = groups.find((candidate) => candidate.label === item.label && Math.abs(candidate.y - item.y) < .5);
		if (group) group.items.push(item);
		else groups.push({
			label: item.label,
			y: item.y,
			items: [item]
		});
	});
	groups.sort((a, b) => a.y - b.y);
	groups.forEach((group, index) => {
		group.labelY = Math.max(minY, group.y, index ? groups[index - 1].labelY + LINE_BOX : minY);
	});
	const overflow = groups.length ? groups.at(-1).labelY - maxY : 0;
	if (overflow > 0) {
		const span = groups.at(-1).labelY - groups[0].labelY;
		const room = Math.max(0, maxY - minY);
		if (span <= room) groups.forEach((group) => {
			group.labelY -= overflow;
		});
		else groups.forEach((group, index) => {
			group.labelY = groups.length === 1 ? minY : minY + index / (groups.length - 1) * room;
		});
	}
	return groups;
};
var placeAnnotationLabels = (labels, minY, maxY) => {
	const room = Math.max(LINE_BOX, maxY - minY);
	const pack = (group) => {
		group.sort((a, b) => a.y - b.y);
		group.forEach((item, index) => {
			item.placedY = Math.max(minY, item.y, index ? group[index - 1].placedY + LINE_BOX : minY);
		});
		const overflow = group.length ? group.at(-1).placedY - maxY : 0;
		if (overflow > 0 && group.length > 1) group.forEach((item, index) => {
			item.placedY = minY + index / (group.length - 1) * (room - LINE_BOX);
		});
		else if (overflow > 0) group[0].placedY = maxY;
	};
	const start = labels.filter((item) => item.side !== "end");
	const end = labels.filter((item) => item.side === "end");
	pack(start);
	pack(end);
	const crowded = (group) => group.length > 1 && group.at(-1).placedY - group[0].placedY + LINE_BOX > room + .5;
	if (crowded(end) && start.length * 2 <= end.length) {
		end.splice(0, Math.ceil(end.length / 2)).forEach((item) => {
			item.side = "start";
			start.push(item);
		});
		pack(start);
		pack(end);
	}
};
var legendChildren = (ctx, data, type, width) => {
	if (type === "funnel" || type !== "share" && data.series.length < 2 && !(data.stack && type !== "line")) return {
		children: [],
		height: 0
	};
	const items = type === "share" ? data.categories.map((label, i) => ({
		label: String(label),
		color: tone(ctx, i),
		meta: {
			kind: "category",
			label
		}
	})) : data.series.map((s, i) => ({
		label: s.label,
		color: tone(ctx, i),
		meta: {
			kind: "series",
			series: s.id,
			label: s.label
		}
	}));
	return ctx.legend(items, width);
};
var base = (ctx, spec, data, type, top, bottom, left, right, legend) => {
	const children = legend.children.slice();
	const legendGap = legend.height ? 8 : 0;
	const plotTop = top + legend.height + legendGap;
	return {
		children,
		legendGap,
		plotTop,
		scene: (h) => ({
			width: ctx.width,
			height: h,
			children,
			title: spec.title || aria(type, data, ctx.lang),
			description: spec.subtitle || void 0
		}),
		plot: (plotHeight) => ({
			left,
			right: Math.max(left + 32, ctx.width - right),
			top: plotTop,
			bottom: plotTop + plotHeight
		}),
		totalHeight: (plotHeight) => plotTop + plotHeight + bottom
	};
};
var pointsFor = (values, x, y) => segmentsOf(values).map((segment) => segment.map(({ index, value }) => [x(index), y(value)]));
var shareSegmentPath = (x, y, width, height, roundLeft, roundRight) => {
	const radius = Math.min(height / 2, width / 2);
	const left = roundLeft ? radius : 0, right = roundRight ? radius : 0;
	return `M${x + left},${y} H${x + width - right}${roundRight ? ` Q${x + width},${y} ${x + width},${y + right}` : ""} V${y + height - right}${roundRight ? ` Q${x + width},${y + height} ${x + width - right},${y + height}` : ""} H${x + left}${roundLeft ? ` Q${x},${y + height} ${x},${y + height - left}` : ""} V${y + left}${roundLeft ? ` Q${x},${y} ${x + left},${y}` : ""} Z`;
};
var lineArea = (spec, ctx) => {
	const data = ctx.table(spec), isArea = spec.chart === "area", stacked = Boolean(spec.stack);
	if (stacked && data.series.some((series) => series.values.some((value) => value == null))) ctx.fit("堆叠折线/面积不支持缺失值", "补齐数值后再使用stack，或去掉stack");
	const stackBase = (seriesIndex, categoryIndex) => {
		if (spec.stack === "percent") return data.series.slice(0, seriesIndex).reduce((sum, series) => sum + (series.values[categoryIndex] ?? 0), 0) / data.series.reduce((sum, series) => sum + (series.values[categoryIndex] ?? 0), 0);
		const sign = (data.series[seriesIndex].values[categoryIndex] ?? 0) < 0 ? -1 : 1;
		return data.series.slice(0, seriesIndex).reduce((sum, series) => {
			const prior = series.values[categoryIndex] ?? 0;
			return sum + (prior === 0 || Math.sign(prior) === sign ? prior : 0);
		}, 0);
	};
	const stackAt = (seriesIndex, categoryIndex) => {
		const values = data.series.map((series) => series.values[categoryIndex] ?? 0);
		if (spec.stack === "percent") {
			const total = values.reduce((sum, value) => sum + value, 0);
			if (!(total > 0)) ctx.fit("百分比堆叠的每类合计必须大于0", "补充正数或改用普通堆叠");
			return values.slice(0, seriesIndex + 1).reduce((sum, value) => sum + value, 0) / total;
		}
		const sign = values[seriesIndex] < 0 ? -1 : 1;
		return values.slice(0, seriesIndex + 1).reduce((sum, value) => sum + (Math.sign(value) === sign || value === 0 ? value : 0), 0);
	};
	const all = data.series.flatMap((s) => s.values.filter((v) => v != null));
	const lowerValues = spec.encode.lower ? data.categories.map((category) => data.rows.find((row) => row[data.categoryField] === category)?.[spec.encode.lower] ?? null) : null;
	const upperValues = spec.encode.upper ? data.categories.map((category) => data.rows.find((row) => row[data.categoryField] === category)?.[spec.encode.upper] ?? null) : null;
	if (lowerValues) all.push(...lowerValues.filter((value) => value != null), ...upperValues.filter((value) => value != null));
	if (stacked) {
		if (spec.stack === "percent") all.splice(0, all.length, 0, 1);
		else data.categories.forEach((_, i) => data.series.forEach((_, si) => all.push(stackAt(si, i))));
	}
	const field = data.valueFields[0];
	const fieldMeta = ctx.field(field);
	const annotationRows = (spec.annotations || []).filter((annotation) => annotation.label || annotation.text).length;
	const layout = base(ctx, spec, data, spec.chart, 18 + (isArea ? annotationRows * 16 : 0), 28, 52, 64, legendChildren(ctx, data, spec.chart, ctx.width));
	const plot = layout.plot(Math.max(60, 206));
	let ticks, y;
	if (fieldMeta.scale === "log") {
		const vals = [
			...all,
			...fieldMeta.domain || [],
			...(spec.annotations || []).flatMap((a) => a.field === field && a.kind === "rule" ? [a.value] : a.field === field && a.kind === "band" ? [a.from, a.to] : [])
		].filter((v) => v != null);
		const min = Math.min(...vals), max = Math.max(...vals);
		if (!(min > 0 && max >= min)) ctx.fit("log坐标要求所有值大于0", "移除非正值或改用linear");
		const lo = Math.floor(Math.log10(min)), hi = Math.ceil(Math.log10(max));
		ticks = {
			min: Math.min(lo === hi ? lo - 1 : lo, Math.log10(min)),
			max: Math.max(lo === hi ? hi + 1 : hi, Math.log10(max))
		};
		ticks.ticks = Array.from({ length: Math.floor(ticks.max) - Math.ceil(ticks.min) + 1 }, (_, i) => 10 ** (Math.ceil(ticks.min) + i));
		if (!ticks.ticks.length) ticks.ticks = [10 ** ((ticks.min + ticks.max) / 2)];
		ticks.labels = ticks.ticks.map((v) => ctx.format(v, field));
		y = (value) => ctx.linear(ticks.min, ticks.max, plot.bottom, plot.top)(Math.log10(value));
	} else {
		ticks = ctx.ticks(all, field, {
			zero: isArea,
			count: 4
		});
		y = ctx.linear(ticks.min, ticks.max, plot.bottom, plot.top);
	}
	if (spec.stack === "percent" && stacked) ticks.labels = ticks.ticks.map((tick) => ctx.percent(tick));
	const tickWidth = Math.max(0, ...ticks.labels.map((label) => labelWidth(ctx, label))) + 14;
	const lastLabels = data.series.map((series) => {
		for (let i = series.values.length - 1; i >= 0; i -= 1) if (series.values[i] != null) return spec.stack === "percent" && stacked ? ctx.percent(stackAt(data.series.indexOf(series), i)) : ctx.format(stacked ? stackAt(data.series.indexOf(series), i) : series.values[i], field);
		return "";
	});
	plot.left = Math.max(36, tickWidth);
	const rightLabelWidth = Math.max(20, ...lastLabels.map((label) => labelWidth(ctx, label, 12, 700)));
	const dateCategory = (label) => /^\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?$/.test(String(label));
	const categoryCount = Math.max(1, data.categories.length);
	const axisLength = (right) => Math.max(1, right - plot.left);
	const visibleStep = (right) => {
		const spacing = axisLength(right) / Math.max(1, categoryCount - 1);
		if (data.categories.every(dateCategory)) {
			const dateLabelWidth = Math.max(0, ...data.categories.map((label) => labelWidth(ctx, label, 12)));
			return Math.max(1, Math.ceil((dateLabelWidth + 8) / spacing));
		}
		const widest = Math.max(36, ...data.categories.map((label) => labelWidth(ctx, label, 12)));
		return Math.max(1, Math.ceil(Math.min(96, Math.max(36, widest)) / spacing));
	};
	const neededRight = () => {
		let right = Math.max(plot.left + 40, ctx.width - rightLabelWidth - 14);
		for (let pass = 0; pass < 3; pass += 1) {
			const step = visibleStep(right);
			const shown = data.categories.filter((_, index) => index % step === 0 || index === categoryCount - 1);
			const widest = Math.max(36, ...shown.map((label) => Math.min(labelWidth(ctx, label, 12), 120)));
			const gaps = Math.max(1, Math.ceil(categoryCount / step) - 1);
			right = Math.max(right, plot.left + gaps * Math.min(96, widest + 8));
		}
		return right;
	};
	plot.right = neededRight();
	const x = (i) => data.categories.length === 1 ? (plot.left + plot.right) / 2 : plot.left + i / (data.categories.length - 1) * (plot.right - plot.left);
	const seenTickLabels = /* @__PURE__ */ new Set();
	ticks.ticks.forEach((tick, i) => {
		if (seenTickLabels.has(ticks.labels[i])) return;
		seenTickLabels.add(ticks.labels[i]);
		const py = y(tick);
		if (tick !== 0) layout.children.push(ctx.line(plot.left, py, plot.right, py, {
			stroke: ctx.color("grid"),
			"stroke-width": 1
		}));
		layout.children.push(ctx.text(plot.left - 10, py + 4, ticks.labels[i], {
			anchor: "end",
			size: 12,
			fill: ctx.color("muted")
		}));
	});
	const baseline = fieldMeta.scale !== "log" && ticks.min <= 0 && ticks.max >= 0 ? y(0) : plot.bottom;
	layout.children.push(ctx.line(plot.left, baseline, plot.right, baseline, {
		stroke: ctx.color("axis"),
		"stroke-width": 1
	}));
	const crowded = (a, b) => {
		const gap = (b - a) * axisLength(plot.right) / Math.max(1, categoryCount - 1);
		const leftWidth = labelWidth(ctx, data.categories[a], 12), rightWidth = labelWidth(ctx, data.categories[b], 12);
		return gap < (a === 0 ? leftWidth : leftWidth / 2) + (b === categoryCount - 1 ? rightWidth : rightWidth / 2) + 8;
	};
	const { step: categoryStep, shown: visibleCategoryIndices } = evenLabels(categoryCount, crowded, visibleStep(plot.right));
	const categoryGap = () => {
		let guard = data.categories.length;
		while (guard > 0) {
			guard -= 1;
			const shown = [...visibleCategoryIndices].sort((a, b) => a - b);
			let removed = false;
			for (let i = 1; i < shown.length; i += 1) if (crowded(shown[i - 1], shown[i])) {
				visibleCategoryIndices.delete(shown[i - 1] === 0 ? shown[i] : shown[i - 1]);
				removed = true;
				break;
			}
			if (!removed) break;
		}
	};
	categoryGap();
	const categoryLines = data.categories.map((label, index) => {
		if (!visibleCategoryIndices.has(index)) return [];
		if (dateCategory(label)) return [String(label)];
		const spacing = axisLength(plot.right) / Math.max(1, categoryCount - 1) * categoryStep;
		return ctx.wrap(String(label), Math.max(36, Math.min(120, spacing - 8)), 12);
	});
	data.categories.forEach((label, i) => {
		if (!visibleCategoryIndices.has(i)) return;
		const lines = categoryLines[i];
		const anchor = i === 0 ? "start" : i === categoryCount - 1 ? "end" : "middle";
		const anchorX = i === 0 ? x(i) + 2 : i === categoryCount - 1 ? x(i) - 2 : x(i);
		layout.children.push(ctx.textLines(anchorX, plot.bottom + 18, lines, {
			anchor,
			size: 12,
			fill: ctx.color("muted"),
			meta: {
				kind: "category",
				label,
				index: i
			}
		}));
	});
	if (lowerValues && upperValues) {
		const complete = lowerValues.map((lo, index) => lo != null && upperValues[index] != null);
		let start = 0;
		while (start < complete.length) {
			while (start < complete.length && !complete[start]) start += 1;
			let end = start;
			while (end < complete.length && complete[end]) end += 1;
			if (end > start) {
				const upper = Array.from({ length: end - start }, (_, j) => [x(start + j), y(upperValues[start + j])]);
				const lower = Array.from({ length: end - start }, (_, j) => [x(start + j), y(lowerValues[start + j])]).reverse();
				layout.children.push(ctx.path(path([...upper, ...lower], true), {
					fill: tone(ctx, 0),
					"fill-opacity": .13,
					stroke: "none",
					meta: {
						kind: "series",
						series: data.series[0].id
					}
				}));
			}
			start = Math.max(end, start + 1);
		}
	}
	const lastReadouts = [];
	data.series.forEach((series, si) => {
		const emphasis = spec.emphasis || {};
		const emphasizedSeries = (emphasis.series || []).includes(series.id) || (emphasis.fields || []).includes(series.field);
		const role = emphasizedSeries ? "accent" : `tone${si % 6 + 1}`, color = ctx.color(role);
		const seriesOpacity = ((emphasis.series?.length || 0) > 0 || (emphasis.fields?.length || 0) > 0) && !emphasizedSeries ? .28 : 1;
		if (stacked) {
			const topPoints = data.categories.map((_, i) => [x(i), y(stackAt(si, i))]);
			const bottomPoints = data.categories.map((_, i) => [x(i), y(stackBase(si, i))]);
			if (isArea) layout.children.push(ctx.path(path([...topPoints, ...bottomPoints.slice().reverse()], true), {
				fill: color,
				"fill-opacity": .12,
				opacity: seriesOpacity,
				stroke: "none",
				meta: {
					kind: "series",
					series: series.id,
					label: series.label
				}
			}));
			layout.children.push(ctx.path(path(topPoints), {
				fill: "none",
				stroke: color,
				"stroke-width": emphasizedSeries ? 3 : 2,
				"stroke-opacity": seriesOpacity,
				"stroke-linejoin": "round",
				meta: {
					kind: "series",
					series: series.id,
					label: series.label
				}
			}));
		} else for (const segment of pointsFor(series.values, x, y)) {
			if (isArea && segment.length > 1) layout.children.push(ctx.path(path([
				[segment[0][0], y(0)],
				...segment,
				[segment.at(-1)[0], y(0)]
			], true), {
				fill: color,
				"fill-opacity": .12,
				opacity: seriesOpacity,
				stroke: "none",
				meta: {
					kind: "series",
					series: series.id,
					label: series.label
				}
			}));
			layout.children.push(ctx.path(path(segment), {
				fill: "none",
				stroke: color,
				"stroke-width": emphasizedSeries ? 3 : 2,
				"stroke-opacity": seriesOpacity,
				"stroke-linecap": "round",
				"stroke-linejoin": "round",
				meta: {
					kind: "series",
					series: series.id,
					label: series.label
				}
			}));
		}
		const valid = series.values.map((value, index) => ({
			value,
			index
		})).filter((p) => p.value != null);
		valid.forEach(({ value, index }) => {
			const pyValue = stacked ? stackAt(si, index) : value;
			const recordId = data.rows.find((r) => r[data.categoryField] === data.categories[index] && (!spec.encode.series || String(r[spec.encode.series]) === series.id))?.[spec.encode.id] ?? `${index}`;
			const recordSelected = (spec.emphasis?.rows || []).includes(recordId);
			layout.children.push(ctx.circle(x(index), y(pyValue), recordSelected ? 5.5 : index === valid.at(-1).index ? 4 : 2.7, {
				fill: recordSelected ? ctx.color("accent") : color,
				stroke: ctx.color("bg"),
				"stroke-width": recordSelected ? 2 : 1.5,
				"fill-opacity": spec.emphasis?.rows?.length && !recordSelected ? .28 : 1,
				meta: {
					kind: "record",
					record: recordId,
					series: series.id,
					value,
					label: String(data.categories[index])
				}
			}));
		});
		if (valid.length) {
			const last = valid.at(-1), value = stacked ? stackAt(si, last.index) : last.value;
			const label = spec.stack === "percent" && stacked ? ctx.percent(value) : ctx.format(value, field);
			lastReadouts.push({
				si,
				series,
				last,
				value,
				label,
				color,
				labelColor: ctx.textColor(role),
				y: y(value)
			});
		}
	});
	(lastReadouts.length && !(spec.variant === "counter" && spec.unit) ? dodgeReadouts(lastReadouts, plot.top + 8, plot.bottom - 8) : []).forEach((group) => {
		const sample = group.items[0];
		group.items.forEach(({ series, last, value, label, color }) => {
			const record = data.rows.find((r) => r[data.categoryField] === data.categories[last.index] && (!spec.encode.series || String(r[spec.encode.series]) === series.id))?.[spec.encode.id] ?? `${last.index}`;
			layout.children.push(ctx.line(x(last.index), y(value), plot.right + 4, group.labelY, {
				stroke: color,
				"stroke-width": .75,
				"stroke-opacity": .7,
				meta: {
					kind: "connector",
					record,
					series: series.id,
					value: last.value,
					label
				}
			}));
		});
		const record = data.rows.find((r) => r[data.categoryField] === data.categories[sample.last.index] && (!spec.encode.series || String(r[spec.encode.series]) === sample.series.id))?.[spec.encode.id] ?? `${sample.last.index}`;
		layout.children.push(ctx.text(plot.right + 8, group.labelY + 4, group.label, {
			size: 12,
			weight: 700,
			fill: sample.labelColor,
			meta: {
				kind: "value",
				record,
				series: sample.series.id,
				value: sample.last.value,
				label: group.label,
				category: data.categories[sample.last.index]
			}
		}));
	});
	const annotationLabels = [];
	if (spec.annotations) spec.annotations.forEach((a) => {
		if (a.field !== field) return;
		if (a.kind === "band") {
			const topY = Math.min(y(a.from), y(a.to)), height = Math.abs(y(a.from) - y(a.to));
			const bandFill = ctx.color("accent");
			layout.children.push(ctx.rect(plot.left, topY, plot.right - plot.left, height, {
				fill: bandFill,
				"fill-opacity": .1,
				meta: {
					kind: "annotation",
					label: a.label || ""
				}
			}));
			if (a.label) annotationLabels.push({
				text: a.label,
				y: topY + 12,
				side: "end",
				fill: ctx.textColor("fg"),
				meta: {
					kind: "annotation",
					label: a.label
				}
			});
		}
		if (a.kind === "note") {
			const row = data.rows.find((r) => r[spec.encode.id] === a.record);
			const index = row ? data.categories.indexOf(row[data.categoryField]) : -1;
			const value = row?.[a.field];
			if (index >= 0 && value != null) annotationLabels.push({
				text: a.text,
				y: y(value) - 4,
				side: index > data.categories.length / 2 ? "end" : "start",
				x: x(index),
				fill: ctx.textColor(isArea ? "fg" : "accent"),
				meta: {
					kind: "annotation",
					record: a.record,
					label: a.text
				}
			});
		}
		if (a.kind === "rule") {
			const py = y(a.value);
			layout.children.push(ctx.line(plot.left, py, plot.right, py, {
				stroke: ctx.color("accent"),
				"stroke-dasharray": "4 3"
			}));
			if (a.label) annotationLabels.push({
				text: a.label,
				y: Math.max(plot.top + 12, py - 16),
				side: "start",
				fill: ctx.textColor("fg"),
				meta: {
					kind: "annotation",
					label: a.label
				}
			});
		}
	});
	placeAnnotationLabels(annotationLabels, plot.top + 4, plot.bottom - 4);
	annotationLabels.forEach((item, index) => {
		const anchor = item.side === "end" ? "end" : "start";
		const px = isArea ? anchor === "end" ? plot.right - 4 : plot.left + 4 : item.x != null ? item.x + (anchor === "end" ? -6 : 6) : anchor === "end" ? plot.right - 4 : plot.left + 4;
		const py = isArea ? plot.top - 8 - index * 16 : item.placedY;
		layout.children.push(ctx.text(px, py, item.text, {
			anchor,
			size: 12,
			fill: item.fill,
			meta: item.meta
		}));
	});
	const scene = layout.scene(layout.totalHeight(206 + Math.max(0, ...categoryLines.map((lines) => lines.length - 1)) * 16));
	scene.width = Math.max(ctx.width, plot.right + rightLabelWidth + 14);
	return scene;
};
var rounded = (ctx, x, y, w, h, color, meta, opacity = 1) => w <= 0 || h <= 0 ? null : ctx.rect(x, y, w, h, {
	rx: Math.min(10, Math.max(0, Math.min(w, h) / 2)),
	fill: color,
	opacity,
	meta
});
var bars = (spec, ctx) => {
	const data = ctx.table(spec), horizontal = spec.chart === "bar", stacked = Boolean(spec.stack);
	const legend = legendChildren(ctx, data, spec.chart, ctx.width);
	const annotationCount = (spec.annotations || []).filter((item) => item.label || item.text).length;
	const layout = base(ctx, spec, data, spec.chart, (horizontal ? 14 : 38) + Math.min(2, annotationCount) * 16, 30, 46, 14, legend);
	const categoryN = data.categories.length, seriesN = data.series.length;
	if (stacked && data.series.some((series) => series.values.some((value) => value == null))) ctx.fit("堆叠图不支持缺失值", "补齐数值后再使用stack，或去掉stack");
	const stackTotal = (categoryIndex) => data.series.reduce((sum, series) => sum + series.values[categoryIndex], 0);
	if (spec.stack === "percent" && data.categories.some((_, index) => !(stackTotal(index) > 0))) ctx.fit("百分比堆叠的每类合计必须大于0", "补充正数或改用普通堆叠");
	const stackStart = (seriesIndex, categoryIndex) => {
		if (spec.stack === "percent") return data.series.slice(0, seriesIndex).reduce((sum, series) => sum + series.values[categoryIndex], 0) / stackTotal(categoryIndex);
		const sign = (data.series[seriesIndex].values[categoryIndex] ?? 0) < 0 ? -1 : 1;
		return data.series.slice(0, seriesIndex).reduce((sum, series) => {
			const value = series.values[categoryIndex] ?? 0;
			return sum + (value === 0 || Math.sign(value) === sign ? value : 0);
		}, 0);
	};
	const stackValue = (seriesIndex, categoryIndex) => stackStart(seriesIndex, categoryIndex) + (data.series[seriesIndex].values[categoryIndex] ?? 0) / (spec.stack === "percent" ? stackTotal(categoryIndex) : 1);
	const values = stacked ? data.categories.flatMap((_, i) => spec.stack === "percent" ? [0, 1] : data.series.map((_, si) => stackValue(si, i))) : data.series.flatMap((s) => s.values.filter((v) => v != null));
	values.push(0);
	const field = data.valueFields[0];
	const sourceAt = (ci, series) => data.rows.find((row) => row[data.categoryField] === data.categories[ci] && (!spec.encode.series || String(row[spec.encode.series]) === series.id));
	let ticks = ctx.ticks(values, field, {
		zero: true,
		count: horizontal ? Math.max(2, Math.min(5, Math.floor(ctx.width / 74))) : 4
	});
	if (spec.stack === "percent") ticks.labels = ticks.ticks.map((tick) => ctx.percent(tick));
	if (horizontal) {
		const labelCap = Math.max(24, ...data.categories.map((c) => labelWidth(ctx, c, 12, 500))) + 14;
		const readoutTexts = data.categories.flatMap((_, ci) => stacked ? [spec.stack === "percent" ? ctx.percent(1) : ctx.format(stackTotal(ci), field)] : data.series.map((series) => series.values[ci] == null ? "" : ctx.format(series.values[ci], field))).filter(Boolean);
		const valueW = Math.max(20, ...readoutTexts.map((label) => labelWidth(ctx, label)));
		const negativeW = Math.max(0, ...readoutTexts.filter((label) => label.startsWith("-")).map((label) => labelWidth(ctx, label)));
		const tickGutter = Math.max(0, ...ticks.labels.map((label) => labelWidth(ctx, label))) + 8;
		const available = Math.max(1, ctx.width - labelCap - valueW - 28 - (ticks.min < 0 ? negativeW + 14 : 0) - tickGutter);
		ticks = ctx.ticks(values, field, {
			zero: true,
			count: horizontal ? Math.max(2, Math.min(5, Math.floor(ctx.width / 74))) : 4,
			length: available
		});
		if (spec.stack === "percent") ticks.labels = ticks.ticks.map((tick) => ctx.percent(tick));
		const tickHalf = Math.max(0, ...ticks.labels.map((label) => labelWidth(ctx, label))) / 2;
		const tickWidth = Math.max(0, ...ticks.labels.map((label) => labelWidth(ctx, label)));
		const minTickSpan = Math.max(0, ticks.ticks.length - 1) * (tickWidth + 8);
		const plot = {
			left: labelCap + (ticks.min < 0 ? negativeW + 14 : 0) + tickHalf,
			right: Math.max(labelCap + negativeW + 54, ctx.width - valueW - 14 - tickHalf),
			top: layout.plotTop,
			bottom: layout.plotTop + categoryN * Math.max(34, seriesN * 16 + 14)
		};
		plot.right = Math.max(plot.right, plot.left + minTickSpan);
		const x = ctx.linear(ticks.min, ticks.max, plot.left, plot.right);
		ticks.ticks.forEach((tick, i) => {
			const px = x(tick);
			if (tick !== 0) layout.children.push(ctx.line(px, plot.top, px, plot.bottom, { stroke: ctx.color("grid") }));
			layout.children.push(ctx.text(px, plot.bottom + 18, ticks.labels[i], {
				anchor: "middle",
				fill: ctx.color("muted"),
				size: 12
			}));
		});
		layout.children.push(ctx.line(x(0), plot.top, x(0), plot.bottom, { stroke: ctx.color("axis") }));
		const groupH = (plot.bottom - plot.top) / categoryN;
		data.categories.forEach((category, ci) => {
			const center = plot.top + groupH * (ci + .5);
			const lines = ctx.wrap(String(category), Math.max(16, labelCap - 8), 12, 500);
			layout.children.push(ctx.textLines(labelCap - 12, center - (lines.length - 1) * 15 / 2 + 4, lines, {
				anchor: "end",
				fill: ctx.color("fg"),
				meta: {
					kind: "category",
					label: category,
					index: ci
				}
			}));
			if (stacked) {
				data.series.forEach((series, si) => {
					const value = series.values[ci] ?? 0, start = stackStart(si, ci), end = stackValue(si, ci);
					const record = sourceAt(ci, series)?.[spec.encode.id] ?? `${ci}`, style = emphasisStyle(ctx, spec, series.id, series.field || series.id, record, si, seriesN === 1);
					if (value !== 0) layout.children.push(rounded(ctx, Math.min(x(start), x(end)), center - 10, Math.abs(x(end) - x(start)), 20, style.fill, {
						kind: "record",
						record,
						series: series.id,
						category,
						value,
						label: String(category)
					}, style.opacity));
				});
				const total = spec.stack === "percent" ? 1 : stackTotal(ci);
				if (total !== 0) layout.children.push(ctx.text(x(total) + (total >= 0 ? 6 : -6), center + 4, spec.stack === "percent" ? ctx.percent(total) : ctx.format(total, field), {
					anchor: total >= 0 ? "start" : "end",
					fill: ctx.color("fg"),
					meta: {
						kind: "value",
						category,
						value: total
					}
				}));
			} else data.series.forEach((series, si) => {
				const value = series.values[ci];
				if (value == null) return;
				const record = sourceAt(ci, series)?.[spec.encode.id] ?? `${ci}`, style = emphasisStyle(ctx, spec, series.id, series.field || series.id, record, si, seriesN === 1);
				const cy = center + (si - (seriesN - 1) / 2) * Math.max(12, (groupH - 12) / seriesN);
				const end = x(value);
				if (value !== 0) layout.children.push(rounded(ctx, Math.min(x(0), end), cy - Math.min(9, groupH / seriesN / 2), Math.abs(end - x(0)), Math.min(18, groupH / seriesN - 3), style.fill, {
					kind: "record",
					record,
					series: series.id,
					category,
					value,
					label: String(category)
				}, style.opacity));
				layout.children.push(ctx.text(end + (value >= 0 ? 6 : -6), cy + 4, ctx.format(value, field), {
					anchor: value >= 0 ? "start" : "end",
					fill: ctx.color("fg"),
					meta: {
						kind: "value",
						record,
						category,
						series: series.id,
						value,
						label: ctx.format(value, field)
					}
				}));
			});
		});
		const barAnnotations = [];
		(spec.annotations || []).forEach((a) => {
			if (a.field !== field) return;
			if (a.kind === "rule") {
				const px = x(a.value);
				layout.children.push(ctx.line(px, plot.top, px, plot.bottom, {
					stroke: ctx.color("accent"),
					"stroke-dasharray": "4 3",
					meta: {
						kind: "annotation",
						label: a.label || ""
					}
				}));
				if (a.label) barAnnotations.push({
					text: a.label,
					x: px,
					fill: ctx.textColor("fg"),
					meta: {
						kind: "annotation",
						label: a.label
					}
				});
			} else if (a.kind === "band") {
				const left = Math.min(x(a.from), x(a.to)), width = Math.abs(x(a.from) - x(a.to));
				layout.children.push(ctx.rect(left, plot.top, width, plot.bottom - plot.top, {
					fill: ctx.color("accent"),
					"fill-opacity": .1,
					meta: {
						kind: "annotation",
						label: a.label || ""
					}
				}));
				if (a.label) barAnnotations.push({
					text: a.label,
					x: left + width / 2,
					fill: ctx.textColor("fg"),
					meta: {
						kind: "annotation",
						label: a.label
					}
				});
			} else if (a.kind === "note") {
				const row = data.rows.find((item) => item[spec.encode.id] === a.record);
				if ((row ? data.categories.indexOf(row[data.categoryField]) : -1) >= 0 && row[a.field] != null) barAnnotations.push({
					text: a.text,
					x: x(row[a.field]),
					fill: ctx.textColor("fg"),
					meta: {
						kind: "annotation",
						record: a.record,
						label: a.text
					}
				});
			}
		});
		const lanes = [[], []];
		barAnnotations.sort((a, b) => a.x - b.x).forEach((item) => {
			const width = labelWidth(ctx, item.text);
			const lane = lanes.find((items) => !items.length || items.at(-1).right + 8 <= item.x - width / 2) || lanes[0];
			const previous = lane.at(-1);
			item.placedX = Math.max(item.x, previous ? previous.right + 8 + width / 2 : item.x);
			item.lane = lanes.indexOf(lane);
			lane.push({ right: item.placedX + width / 2 });
		});
		barAnnotations.forEach((item) => {
			layout.children.push(ctx.text(item.placedX, plot.top - 4 - item.lane * 16, item.text, {
				anchor: "middle",
				size: 12,
				fill: item.fill,
				meta: item.meta
			}));
		});
		const scene = layout.scene(plot.bottom + 32);
		scene.width = Math.max(ctx.width, plot.right + valueW + 14);
		return scene;
	}
	const tickLabelWidth = Math.max(0, ...ticks.labels.map((label) => labelWidth(ctx, label)));
	const axisUnit = spec.stack !== "percent" && ctx.field(field).unit ? ctx.field(field).unit : "";
	const leftLabelWidth = Math.max(tickLabelWidth, axisUnit ? labelWidth(ctx, axisUnit) : 0);
	const plot = {
		left: Math.max(42, leftLabelWidth + 16),
		right: ctx.width - 14,
		top: layout.plotTop + 16,
		bottom: layout.plotTop + Math.max(60, 256 - layout.plotTop - 30)
	};
	const minGroup = Math.max(18, seriesN * (stacked ? 10 : 8));
	plot.right = Math.max(plot.right, plot.left + categoryN * minGroup);
	const y = ctx.linear(ticks.min, ticks.max, plot.bottom, plot.top);
	if (axisUnit) layout.children.push(ctx.text(plot.left - 10, Math.max(16, plot.top - 36), axisUnit, {
		anchor: "end",
		size: 12,
		fill: ctx.color("muted"),
		meta: {
			kind: "axis-unit",
			label: axisUnit
		}
	}));
	const yShown = [];
	ticks.ticks.forEach((tick, i) => {
		const py = y(tick);
		const height = 16;
		if (yShown.some((placed) => Math.abs(placed - py) < height)) return;
		yShown.push(py);
		if (tick !== 0) layout.children.push(ctx.line(plot.left, py, plot.right, py, { stroke: ctx.color("grid") }));
		layout.children.push(ctx.text(plot.left - 10, py + 4, ticks.labels[i], {
			anchor: "end",
			fill: ctx.color("muted"),
			size: 12
		}));
	});
	layout.children.push(ctx.line(plot.left, y(0), plot.right, y(0), { stroke: ctx.color("axis") }));
	const groupW = (plot.right - plot.left) / categoryN;
	const slot = stacked ? groupW * .62 : groupW * .76 / seriesN;
	const barW = stacked ? Math.max(2, Math.min(44, slot)) : Math.max(1.5, Math.min(40, slot - (seriesN > 1 ? 3 : 0)));
	const labelValues = stacked && spec.stack === "percent" ? [1] : values.filter((v) => v !== 0);
	const withUnit = (value) => spec.stack === "percent" ? ctx.percent(value) : ctx.format(value, field, true);
	const bare = (value) => spec.stack === "percent" ? ctx.percent(value) : ctx.format(value, field, false);
	const formatLabel = labelValues.every((v) => labelWidth(ctx, withUnit(v)) <= Math.max(0, slot - 2)) ? withUnit : bare;
	const mode = labelValues.every((v) => labelWidth(ctx, formatLabel(v)) <= Math.max(0, slot - 2)) ? "value" : "none";
	const placedColumnReadouts = /* @__PURE__ */ new Map();
	data.categories.forEach((category, ci) => {
		const center = plot.left + groupW * (ci + .5);
		if (stacked) {
			data.series.forEach((series, si) => {
				const value = series.values[ci] ?? 0, start = stackStart(si, ci), end = stackValue(si, ci);
				const record = sourceAt(ci, series)?.[spec.encode.id] ?? `${ci}`, style = emphasisStyle(ctx, spec, series.id, series.field || series.id, record, si, seriesN === 1);
				if (value !== 0) layout.children.push(rounded(ctx, center - barW / 2, Math.min(y(start), y(end)), barW, Math.abs(y(end) - y(start)), style.fill, {
					kind: "record",
					record,
					series: series.id,
					category,
					value,
					label: String(category)
				}, style.opacity));
			});
			const total = spec.stack === "percent" ? 1 : stackTotal(ci);
			if (total && mode !== "none") layout.children.push(ctx.text(center, total >= 0 ? y(total) - 8 : y(0) + 16, formatLabel(total), {
				anchor: "middle",
				fill: ctx.color("fg"),
				meta: {
					kind: "value",
					category,
					value: total
				}
			}));
		} else data.series.forEach((series, si) => {
			const value = series.values[ci];
			if (value == null) return;
			const record = sourceAt(ci, series)?.[spec.encode.id] ?? `${ci}`, style = emphasisStyle(ctx, spec, series.id, series.field || series.id, record, si, seriesN === 1);
			const bx = center + (si - (seriesN - 1) / 2) * slot, end = y(value), zero = y(0);
			if (value !== 0) layout.children.push(rounded(ctx, bx - barW / 2, Math.min(zero, end), barW, Math.abs(end - zero), style.fill, {
				kind: "record",
				record,
				series: series.id,
				category,
				value,
				label: String(category)
			}, style.opacity));
			if (mode !== "none" && !(annotationCount && value === 0)) {
				const label = formatLabel(value);
				const readoutY = value >= 0 ? end - 8 : zero + 16;
				const readoutWidth = labelWidth(ctx, label, 12, 400);
				const key = `${label}@${Math.round(readoutY)}`;
				const previous = placedColumnReadouts.get(key);
				if (previous != null && Math.abs(bx - previous) < readoutWidth + 8) return;
				placedColumnReadouts.set(key, bx);
				layout.children.push(ctx.text(bx, readoutY, label, {
					anchor: "middle",
					fill: ctx.color("fg"),
					meta: {
						kind: "value",
						record,
						category,
						series: series.id,
						value,
						label
					}
				}));
			}
		});
	});
	const columnAnnotations = [];
	(spec.annotations || []).forEach((a) => {
		if (a.field !== field) return;
		if (a.kind === "rule") {
			const py = y(a.value);
			layout.children.push(ctx.line(plot.left, py, plot.right, py, {
				stroke: ctx.color("accent"),
				"stroke-dasharray": "4 3",
				meta: {
					kind: "annotation",
					label: a.label || ""
				}
			}));
			if (a.label) columnAnnotations.push({
				text: a.label,
				x: plot.left + 8,
				fill: ctx.textColor("fg"),
				meta: {
					kind: "annotation",
					label: a.label
				}
			});
		} else if (a.kind === "band") {
			const topY = Math.min(y(a.from), y(a.to)), height = Math.abs(y(a.from) - y(a.to));
			layout.children.push(ctx.rect(plot.left, topY, plot.right - plot.left, height, {
				fill: ctx.color("accent"),
				"fill-opacity": .1,
				meta: {
					kind: "annotation",
					label: a.label || ""
				}
			}));
			if (a.label) columnAnnotations.push({
				text: a.label,
				x: plot.right - 8,
				fill: ctx.textColor("fg"),
				meta: {
					kind: "annotation",
					label: a.label
				}
			});
		} else if (a.kind === "note") {
			const row = data.rows.find((item) => item[spec.encode.id] === a.record);
			if ((row ? data.categories.indexOf(row[data.categoryField]) : -1) >= 0 && row[a.field] != null) columnAnnotations.push({
				text: a.text,
				x: plot.right - 8,
				fill: ctx.textColor("fg"),
				meta: {
					kind: "annotation",
					record: a.record,
					label: a.text
				}
			});
		}
	});
	const columnLanes = [[], []];
	columnAnnotations.sort((a, b) => a.x - b.x).forEach((item) => {
		const width = labelWidth(ctx, item.text);
		const lane = columnLanes.find((items) => !items.length || items.at(-1).right + 8 <= item.x - width / 2) || columnLanes[0];
		const previous = lane.at(-1);
		item.placedX = Math.max(item.x, previous ? previous.right + 8 + width / 2 : item.x);
		item.lane = columnLanes.indexOf(lane);
		lane.push({ right: item.placedX + width / 2 });
	});
	columnAnnotations.forEach((item) => {
		layout.children.push(ctx.text(item.placedX, plot.top - 20 - item.lane * 16, item.text, {
			anchor: "middle",
			size: 12,
			fill: item.fill,
			meta: item.meta
		}));
	});
	const labelSlot = Math.max(48, Math.min(120, groupW - 4));
	const sceneWidth = Math.max(ctx.width, plot.right + 14);
	const centerOf = (i, width) => Math.min(sceneWidth - width / 2 - 2, Math.max(width / 2 + 2, plot.left + groupW * (i + .5)));
	const slotWidths = data.categories.map((label) => Math.max(...ctx.wrap(String(label), labelSlot, 12).map((line) => labelWidth(ctx, line, 12))));
	const crowded = (a, b, widths) => centerOf(b, widths[b]) - widths[b] / 2 - (centerOf(a, widths[a]) + widths[a] / 2) < 8;
	const { step, shown } = evenLabels(categoryN, (a, b) => crowded(a, b, slotWidths));
	const categoryLines = data.categories.map((category, index) => shown.has(index) ? ctx.wrap(String(category), Math.max(36, groupW * step - 8), 12) : []);
	const drawnWidths = categoryLines.map((lines) => Math.max(0, ...lines.map((line) => labelWidth(ctx, line, 12))));
	for (let guard = categoryN; guard > 0; guard -= 1) {
		const list = data.categories.map((_, index) => index).filter((index) => categoryLines[index].length);
		const position = list.findIndex((index, i) => i > 0 && crowded(list[i - 1], index, drawnWidths));
		if (position < 0) break;
		categoryLines[list[position - 1] === 0 ? list[position] : list[position - 1]] = [];
	}
	data.categories.forEach((category, i) => {
		if (!categoryLines[i].length) return;
		const cx = centerOf(i, drawnWidths[i]);
		layout.children.push(ctx.textLines(cx, plot.bottom + 18, categoryLines[i], {
			anchor: "middle",
			size: 12,
			fill: ctx.color("muted"),
			meta: {
				kind: "category",
				label: category,
				index: i
			}
		}));
	});
	const scene = layout.scene(plot.bottom + 28 + Math.max(0, ...categoryLines.map((lines) => Math.max(0, lines.length - 1))) * 16);
	scene.width = sceneWidth;
	return scene;
};
var share = (spec, ctx) => {
	const data = ctx.table(spec), legend = legendChildren(ctx, data, "share", ctx.width);
	const top = 8 + legend.height + (legend.height ? 8 : 0), barH = 22;
	const labelColumn = Math.max(36, ...data.series.map((series) => {
		const full = labelWidth(ctx, series.label, 12, 500);
		if (full <= ctx.width * .42) return full;
		const lines = ctx.wrap(series.label, Math.max(36, ctx.width * .42), 12, 500);
		return Math.max(...lines.map((line) => labelWidth(ctx, line, 12, 500)));
	}));
	const left = labelColumn + 24, right = 10;
	const longestReadout = Math.max(40, ...data.series.flatMap((series) => {
		const total = series.values.reduce((sum, value) => sum + (value ?? 0), 0) || 1;
		const items = series.values.map((value, ci) => `${data.categories[ci]} ${ctx.percent((value ?? 0) / total)}`);
		items.push(`${isEnglish(ctx.lang) ? "total" : "合计"} ${ctx.format(series.values.reduce((sum, value) => sum + (value ?? 0), 0), series.field)}`);
		return items.map((item) => labelWidth(ctx, item));
	}));
	const chartWidth = Math.max(ctx.width, left + Math.min(longestReadout, 220) + right);
	const barW = Math.max(30, chartWidth - left - right);
	const rows = data.series.map((series) => {
		const total = series.values.reduce((sum, value) => sum + (value ?? 0), 0);
		if (!(total > 0)) ctx.fit("share系列合计必须大于0", "补充正数或改用其他图型");
		const items = series.values.map((value, ci) => `${data.categories[ci]} ${ctx.percent(value / total)}`);
		items.push(`${isEnglish(ctx.lang) ? "total" : "合计"} ${ctx.format(total, series.field)}`);
		const placeBelow = series.values.some((value) => value > 0 && value / total * barW < labelWidth(ctx, ctx.percent(value / total)) + 4);
		const flow = placeBelow ? ctx.flow(items, barW, 12) : [];
		const label = ctx.wrap(series.label, Math.max(18, labelColumn), 12, 500);
		const labelHeight = label.length * 16;
		return {
			series,
			total,
			items,
			placeBelow,
			flow,
			label,
			height: Math.max(50, 28 + labelHeight) + flow.length * 16
		};
	});
	const children = legend.children.slice();
	let rowTop = top;
	rows.forEach(({ series, total, placeBelow, flow, label, height }) => {
		const y = rowTop + 20;
		const labelY = y + barH / 2 + 4 - (label.length - 1) * 8;
		children.push(ctx.textLines(left - 12, labelY, label, {
			anchor: "end",
			fill: ctx.color("fg"),
			meta: {
				kind: "series",
				series: series.id
			}
		}));
		children.push(ctx.rect(left, y, barW, barH, {
			rx: barH / 2,
			fill: ctx.color("grid")
		}));
		let cursor = left;
		series.values.forEach((value, ci) => {
			const width = total > 0 ? value / total * barW : 0;
			if (width <= 0) {
				cursor += width;
				return;
			}
			const category = data.categories[ci];
			const record = data.rows.find((item) => item[data.categoryField] === category)?.[spec.encode.id] ?? `${ci}`;
			const style = emphasisStyle(ctx, spec, series.id, series.field || series.id, record, ci);
			children.push(ctx.path(shareSegmentPath(cursor, y, width, barH, ci === 0, ci === data.categories.length - 1), {
				fill: style.fill,
				opacity: style.opacity,
				meta: {
					kind: "record",
					record,
					category,
					series: series.id,
					value,
					label: String(category)
				}
			}));
			const percent = ctx.percent(value / total);
			if (!placeBelow && value > 0) children.push(ctx.text(cursor + width / 2, y - 6, percent, {
				anchor: "middle",
				size: 12,
				fill: ctx.color("fg"),
				meta: {
					kind: "value",
					record,
					series: series.id,
					category,
					value: value / total,
					label: percent
				}
			}));
			cursor += width;
		});
		if (placeBelow) flow.forEach((items, i) => children.push(ctx.text(left, y + barH + 16 + i * 16, items.join(" · "), {
			size: 12,
			fill: ctx.color("muted"),
			meta: {
				kind: "value",
				series: series.id,
				label: items.join(" · ")
			}
		})));
		rowTop += height;
	});
	return {
		width: chartWidth,
		height: rowTop + 4,
		children,
		title: spec.title || aria("share", data, ctx.lang),
		description: spec.subtitle || void 0
	};
};
var funnel = (spec, ctx) => {
	const data = ctx.table(spec), series = data.series[0], field = data.valueFields[0], top = 8;
	const barH = 20, maxValue = Math.max(0, ...series.values), first = series.values[0];
	const labelCap = Math.max(48, ...data.categories.map((category) => {
		const full = labelWidth(ctx, category, 12, 500);
		const limit = Math.max(48, ctx.width * .42);
		if (full <= limit) return full;
		const lines = ctx.wrap(String(category), limit, 12, 500);
		return Math.max(...lines.map((line) => labelWidth(ctx, line, 12, 500)));
	}));
	const left = labelCap + 14, valueTexts = series.values.map((value) => ctx.format(value, field));
	const labels = data.categories.map((category) => ctx.wrap(String(category), labelCap, 12, 500));
	const noFirst = isEnglish(ctx.lang) ? "first step unavailable" : "首步为0，比例不可计算";
	const firstShares = series.values.map((value) => first > 0 ? `${isEnglish(ctx.lang) ? "Of first" : "占首步"} ${ctx.percent(value / first)}` : noFirst);
	const previousShares = series.values.map((value, i) => i === 0 ? "" : series.values[i - 1] > 0 ? `${isEnglish(ctx.lang) ? "Of previous" : "占上一步"} ${ctx.percent(value / series.values[i - 1])}` : noFirst);
	const readoutWidth = Math.max(32, ...valueTexts.map((text) => labelWidth(ctx, text, 14, 700)), ...firstShares.map((text) => labelWidth(ctx, text)), ...previousShares.map((text) => labelWidth(ctx, text)));
	const chartWidth = Math.max(ctx.width, left + 24 + readoutWidth + 18);
	const barW = Math.max(24, chartWidth - left - readoutWidth - 18);
	const rowH = Math.max(64, ...labels.map((lines) => lines.length * 15 + barH + 14));
	const children = [];
	data.categories.forEach((category, i) => {
		const centerY = top + i * rowH + rowH / 2 - 2;
		const label = labels[i];
		children.push(ctx.textLines(left - 12, centerY + 4 - (label.length - 1) * 8, label, {
			anchor: "end",
			fill: ctx.color("fg"),
			meta: {
				kind: "category",
				label: category,
				index: i
			}
		}));
		children.push(ctx.rect(left, centerY - barH / 2, barW, barH, {
			rx: barH / 2,
			fill: ctx.color("grid")
		}));
		const length = maxValue > 0 ? series.values[i] / maxValue * barW : 0;
		const record = data.rows[i]?.[spec.encode.id] ?? `${i}`;
		const style = emphasisStyle(ctx, spec, series.id, series.field || series.id, record, i, true);
		if (length > 0) children.push(ctx.rect(left, centerY - barH / 2, length, barH, {
			rx: barH / 2,
			fill: style.fill,
			opacity: style.opacity,
			meta: {
				kind: "record",
				record,
				series: series.id,
				category,
				value: series.values[i],
				label: String(category)
			}
		}));
		const readoutX = left + barW + 12;
		const meta = {
			kind: "value",
			record,
			series: series.id,
			category,
			value: series.values[i]
		};
		children.push(ctx.text(readoutX, centerY - 19, valueTexts[i], {
			size: 13,
			weight: 700,
			fill: ctx.color("fg"),
			meta: {
				...meta,
				label: valueTexts[i]
			}
		}));
		children.push(ctx.text(readoutX, centerY - 3, firstShares[i], {
			size: 12,
			fill: ctx.color("muted"),
			meta: {
				...meta,
				label: firstShares[i]
			}
		}));
		if (previousShares[i]) children.push(ctx.text(readoutX, centerY + 13, previousShares[i], {
			size: 12,
			fill: ctx.color("muted"),
			meta: {
				...meta,
				label: previousShares[i]
			}
		}));
	});
	return {
		width: chartWidth,
		height: top + data.categories.length * rowH + 4,
		children,
		title: spec.title || aria("funnel", data, ctx.lang),
		description: spec.subtitle || void 0
	};
};
function install({ register }) {
	register(["line", "area"], lineArea);
	register(["column", "bar"], bars);
	register("share", share);
	register("funnel", funnel);
}
install({ register });
export { basic_exports, install };
