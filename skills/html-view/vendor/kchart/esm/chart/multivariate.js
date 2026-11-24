import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { register } from "./registry.js";
import { columnHeaders } from "../core/geometry.js";
import { contrast, pushContrast } from "../core/color.js";
// src/chart/multivariate.js
var multivariate_exports = /* @__PURE__ */ __exportAll({
	compactNumeric: () => compactNumeric,
	diagramCombo: () => diagramCombo,
	install: () => install
});
var diagramCombo = Symbol("diagram combo");
var compactNumeric = Symbol("compact numeric geometry");
var finite = Number.isFinite;
var number = (ctx, field, values, zero = false) => {
	const result = ctx.ticks(values.filter(finite), field, { zero });
	const meta = ctx.field(field);
	const min = meta.domain?.[0] ?? result.min;
	const max = meta.domain?.[1] ?? result.max;
	if (zero && !(min <= 0 && max >= 0)) ctx.fit(/^en(?:-|$)/i.test(ctx.lang) ? "This measure requires a domain including zero" : "该度量必须使用包含0的基线范围", /^en(?:-|$)/i.test(ctx.lang) ? "Expand the field domain to include zero" : "扩大字段domain使其包含0后重试");
	if (values.some((v) => finite(v) && (v < min || v > max))) ctx.fit(/^en(?:-|$)/i.test(ctx.lang) ? "Values exceed the explicit domain" : "数值超出显式domain", /^en(?:-|$)/i.test(ctx.lang) ? "Expand the field domain and retry" : "扩大字段domain后重试");
	return {
		min,
		max,
		ticks: result.ticks
	};
};
var chart = (spec, ctx) => {
	const { width } = ctx, enc = spec.encode || {}, pad = {
		l: 56,
		r: 28,
		t: 48,
		b: 58
	};
	const children = [], english = /^en(?:-|$)/i.test(ctx.lang), title = spec.title || spec.chart;
	const msg = (zh, en) => english ? en : zh;
	const plot = (top = pad.t, bottom = 330, left = pad.l + 16, right = width - pad.r - 24) => ({
		x: left,
		y: top,
		w: Math.max(1, right - left),
		h: Math.max(1, bottom - top)
	});
	const bandX = (i, n, p) => p.x + (i + .5) * p.w / n;
	const reserveEdgeCategories = (categories, p) => {
		if (!categories.length) return;
		const widths = categories.map((value) => ctx.measure(String(value), 12));
		const minimum = categories.length === 1 ? widths[0] + 16 : (widths[0] + widths.at(-1) + 6) / (1 - 1 / categories.length);
		p.w = Math.max(p.w, minimum);
	};
	const catLabels = (categories, p, y = p.y + p.h + 22) => {
		const n = categories.length, centers = categories.map((_, i) => bandX(i, n, p));
		const widths = categories.map((value) => ctx.measure(String(value), 12)), shown = /* @__PURE__ */ new Set();
		const minX = 2, maxX = Math.max(width, p.x + p.w) - 2;
		const anchors = categories.map((_, i) => {
			if (n > 1 && i === 0 && centers[i] - widths[i] / 2 < minX) return "start";
			if (n > 1 && i === n - 1 && centers[i] + widths[i] / 2 > maxX) return "end";
			return "middle";
		});
		const bounds = (i) => {
			const left = centers[i] - widths[i] * (anchors[i] === "start" ? 0 : anchors[i] === "end" ? 1 : .5);
			return {
				left,
				right: left + widths[i]
			};
		};
		const fits = (i) => {
			const candidate = bounds(i);
			return candidate.left >= minX && candidate.right <= maxX && [...shown].every((j) => {
				const other = bounds(j);
				return candidate.right + 6 <= other.left || other.right + 6 <= candidate.left;
			});
		};
		for (let i = 0; i < n; i++) if (fits(i)) shown.add(i);
		if (n > 1 && !shown.has(n - 1)) {
			const last = n - 1;
			for (const i of [...shown].filter((j) => j !== 0).reverse()) {
				shown.delete(i);
				if (fits(last)) break;
				shown.add(i);
			}
			if (fits(last)) shown.add(last);
		}
		for (const i of shown) children.push(ctx.text(centers[i], y, String(categories[i]), {
			anchor: anchors[i],
			size: 12
		}));
	};
	const legend = (items, y = 350) => {
		const out = ctx.legend(items, width - pad.l - pad.r);
		children.push(ctx.el("g", { transform: `translate(${pad.l},${y})` }, out.children));
		return out.height;
	};
	const endScene = (bottom = 330) => ctx.scene(bottom + 28, children, title);
	const asPath = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
	const linePath = (values, xs, ys) => {
		let d = "", active = false;
		values.forEach((v, i) => {
			if (!finite(v)) {
				active = false;
				return;
			}
			d += `${active ? "L" : "M"}${xs[i]},${ys(v, i)}`;
			active = true;
		});
		return d;
	};
	const data = spec.data || [];
	if (spec.chart === "stream") {
		const t = ctx.table(spec), cats = t.categories, series = t.series;
		if (series.some((s) => s.values.some((v) => !finite(v)))) ctx.fit(msg("stream需要每个时点都有完整非负序列", "Stream requires complete, non-negative observations at every time"), msg("补齐有效观测或选择允许缺失的图型；不要把缺失当作0", "Provide complete observations or choose a chart that supports missing values; do not treat missing as zero"));
		const totals = cats.map((_, i) => series.reduce((s, a) => s + a.values[i], 0));
		const maximum = Math.max(1, ...totals), vertical = ctx.ticks([-maximum / 2, maximum / 2], series[0]?.field, { count: 4 });
		const offsetLabels = vertical.ticks.map((tick) => ctx.format(tick, series[0]?.field, false));
		const p = plot(72, 330, Math.max(36, ...offsetLabels.map((label) => ctx.measure(label, 12))) + 16, width - 24);
		reserveEdgeCategories(cats, p);
		const xs = cats.map((_, i) => bandX(i, cats.length, p));
		const scale = Math.max(Math.abs(vertical.min), Math.abs(vertical.max)) / (p.h / 2);
		const lower = cats.map((_, i) => -totals[i] / 2), center = p.y + p.h / 2;
		vertical.ticks.forEach((tick) => {
			const y = center - tick / scale;
			children.push(ctx.line(p.x, y, p.x + p.w, y, { stroke: tick === 0 ? ctx.color("axis") : ctx.color("grid") }));
		});
		series.forEach((s, k) => {
			const top = [], bottom = [];
			s.values.forEach((v, i) => {
				const amount = v || 0;
				bottom.push(lower[i]);
				lower[i] += amount;
				top.push(lower[i]);
			});
			const toPoint = (v, i) => [xs[i], center - v / scale];
			const points = [...top.map(toPoint), ...bottom.map(toPoint).reverse()];
			children.push(ctx.el("polygon", {
				points: points.map((q) => q.join(",")).join(" "),
				fill: ctx.color(`tone${k % 6 + 1}`),
				"fill-opacity": .82,
				stroke: ctx.color("bg"),
				"stroke-width": 1
			}));
		});
		vertical.ticks.forEach((tick, index) => {
			const y = center - tick / scale;
			children.push(ctx.text(p.x - 8, y + 4, offsetLabels[index], {
				anchor: "end",
				size: 12
			}));
		});
		children.push(ctx.textLines(p.x, 48, ctx.wrap(msg("纵轴为相对中心的厚度偏移；正值在上，负值在下", "Vertical axis is thickness offset from center; positive above, negative below"), p.w, 12), { size: 12 }));
		catLabels(cats, p);
		const h = legend(series.map((s, i) => ({
			label: s.label,
			color: ctx.color(`tone${i % 6 + 1}`)
		})), p.y + p.h + 42);
		const scene = endScene(p.y + p.h + 42 + h);
		scene.width = Math.max(width, p.x + p.w + 24);
		return scene;
	}
	if (spec.chart === "split-compare") {
		const cats = ctx.table(spec).categories, rowsByCategory = cats.map((c) => data.find((r) => r[enc.category] === c)), upper = rowsByCategory.map((r) => r?.[enc.upper]), lower = rowsByCategory.map((r) => r?.[enc.lower]);
		const upperScale = ctx.ticks(upper.filter(finite), enc.upper, {
			zero: true,
			count: 4
		});
		const lowerScale = ctx.ticks(lower.filter(finite), enc.lower, {
			zero: true,
			count: 4,
			length: 220
		});
		const leftGutter = Math.max(36, ...upperScale.labels.map((label) => ctx.measure(label, 12))) + 16;
		const rightGutter = Math.max(36, ...lowerScale.labels.map((label) => ctx.measure(label, 12))) + 16;
		const p = plot(64, 330, leftGutter, width - rightGutter);
		reserveEdgeCategories(cats, p);
		const mid = p.y + p.h * .48, gap = 28, upH = mid - p.y - gap / 2, lowY = mid + gap / 2, lowH = p.y + p.h - lowY;
		const su = {
			min: upperScale.min,
			max: upperScale.max,
			ticks: upperScale.ticks,
			labels: upperScale.labels
		};
		const sl = {
			min: lowerScale.min,
			max: lowerScale.max,
			ticks: lowerScale.ticks,
			labels: lowerScale.labels
		};
		const uy = (v) => p.y + (v - su.min) / (su.max - su.min || 1) * upH;
		const ly = (v) => lowY + lowH - (v - sl.min) / (sl.max - sl.min || 1) * lowH;
		const bw = Math.max(2, p.w / cats.length * .56);
		upper.forEach((v, i) => {
			if (!finite(v)) return;
			const y = uy(v);
			children.push(ctx.rect(bandX(i, cats.length, p) - bw / 2, p.y, bw, Math.max(1, y - p.y), { fill: ctx.color("tone2") }));
		});
		children.push(ctx.line(p.x, p.y, p.x + p.w, p.y, { stroke: ctx.color("axis") }));
		const pts = lower.map((v, i) => [bandX(i, cats.length, p), ly(finite(v) ? v : sl.min)]);
		children.push(ctx.path(`${asPath(pts)} L${pts.at(-1)[0]},${lowY + lowH} L${pts[0][0]},${lowY + lowH} Z`, {
			fill: ctx.color("tone1"),
			"fill-opacity": .18,
			stroke: "none"
		}));
		children.push(ctx.path(asPath(pts), {
			fill: "none",
			stroke: ctx.color("tone1"),
			"stroke-width": 2
		}));
		su.ticks.forEach((tick, i) => {
			const uyPos = uy(tick);
			children.push(ctx.line(p.x, uyPos, p.x + p.w, uyPos, { stroke: ctx.color("grid") }));
			children.push(ctx.text(p.x - 8, uyPos + 4, su.labels[i], {
				anchor: "end",
				size: 12
			}));
		});
		sl.ticks.forEach((tick, i) => {
			const lyPos = ly(tick);
			children.push(ctx.line(p.x, lyPos, p.x + p.w, lyPos, { stroke: ctx.color("grid") }));
			children.push(ctx.text(p.x + p.w + 8, lyPos + 4, sl.labels[i], {
				anchor: "start",
				size: 12
			}));
		});
		const axisCaption = (fieldName) => {
			const meta = ctx.field(fieldName);
			const unit = meta.unit || (meta.format === "percent" ? "%" : "");
			return [meta.label, unit].filter(Boolean).join(" · ");
		};
		children.push(ctx.text(p.x, p.y - 8, axisCaption(enc.upper), { size: 12 }));
		children.push(ctx.text(p.x, lowY - 6, axisCaption(enc.lower), { size: 12 }));
		children.push(ctx.line(p.x, lowY + lowH, p.x + p.w, lowY + lowH, { stroke: ctx.color("axis") }));
		catLabels(cats, {
			...p,
			y: lowY,
			h: lowH
		});
		const scene = endScene(p.y + p.h + 36);
		scene.width = Math.max(width, p.x + p.w + rightGutter);
		return scene;
	}
	if (spec.chart === "combo") {
		const diagramPanel = spec[diagramCombo];
		const cats = ctx.table(spec).categories, layers = spec.layers;
		const axisFields = (axis) => [...new Set(layers.filter((l) => l.axis === axis).map((l) => l.field))];
		const leftFields = axisFields("left"), rightFields = axisFields("right");
		const rowsByCategory = cats.map((c) => data.find((r) => r[enc.category] === c));
		const allValues = (f) => rowsByCategory.map((r) => r?.[f]);
		const fieldsByAxis = {
			left: leftFields,
			right: rightFields
		};
		const scales = {}, axisTicks = {};
		for (const axis of ["left", "right"]) {
			const names = fieldsByAxis[axis];
			if (!names.length) continue;
			if (new Set(names.map((f) => `${ctx.field(f).unit || ""}|${ctx.field(f).format || ""}`)).size !== 1) ctx.fit(msg(`combo ${axis}轴的多个字段单位必须一致`, `Combo fields on the ${axis} axis must use matching units`), msg("统一字段单位与格式后重试", "Use a consistent unit and format on the axis"));
			const baseline = layers.some((l) => l.axis === axis && ["area", "column"].includes(l.mark));
			const ranges = names.map((f) => number(ctx, f, allValues(f), baseline));
			const annotations = (spec.annotations || []).filter((a) => names.includes(a.field)).flatMap((a) => a.kind === "rule" ? [a.value] : a.kind === "band" ? [a.from, a.to] : []);
			const min = Math.min(...ranges.map((r) => r.min), ...annotations);
			const max = Math.max(...ranges.map((r) => r.max), ...annotations);
			const primary = Object.values(axisTicks)[0];
			const nice = ctx.ticks([min, max], names[0], {
				zero: baseline,
				length: Math.max(120, width - 160),
				percentSymbol: false,
				...primary ? { intervals: primary.ticks.length - 1 } : {}
			});
			axisTicks[axis] = nice;
			names.forEach((f) => {
				scales[f] = nice;
			});
		}
		const leftGutter = Math.max(36, ...(axisTicks.left?.labels || ["0"]).map((label) => ctx.measure(label, 12))) + 16;
		const rightGutter = Math.max(28, ...(axisTicks.right?.labels || [""]).map((label) => ctx.measure(label, 12))) + 16;
		const annotationRows = (spec.annotations || []).filter((annotation) => annotation.label || annotation.text).length;
		const p = plot(36 + annotationRows * 16, spec[compactNumeric] ? 252 : 302, leftGutter, width - rightGutter);
		reserveEdgeCategories(cats, p);
		const yFor = (field, v) => p.y + p.h - (v - scales[field].min) / (scales[field].max - scales[field].min || 1) * p.h;
		const y0 = (field) => yFor(field, Math.max(scales[field].min, Math.min(scales[field].max, 0)));
		const gridAxis = axisTicks.left || axisTicks.right;
		gridAxis.ticks.forEach((_, i) => {
			const y = p.y + p.h - i / (gridAxis.ticks.length - 1) * p.h;
			children.push(ctx.line(p.x, y, p.x + p.w, y, { stroke: ctx.color("grid") }));
			if (axisTicks.left) children.push(ctx.text(p.x - 8, y + 4, axisTicks.left.labels[i], {
				anchor: "end",
				size: 12
			}));
			if (axisTicks.right) children.push(ctx.text(p.x + p.w + 8, y + 4, axisTicks.right.labels[i], { size: 12 }));
		});
		children.push(ctx.line(p.x, p.y + p.h, p.x + p.w, p.y + p.h, { stroke: ctx.color("axis") }));
		const xs = cats.map((_, i) => bandX(i, cats.length, p));
		const traces = [], columnLayers = [];
		layers.forEach((layer, index) => {
			const vals = allValues(layer.field), ys = vals.map((v) => finite(v) ? yFor(layer.field, v) : NaN);
			const color = ctx.color(`tone${index % 6 + 1}`);
			if (layer.mark === "column") {
				columnLayers.push({
					layer,
					index,
					ys,
					color
				});
				return;
			}
			if (layer.mark === "area") {
				let segment = [];
				const close = () => {
					if (segment.length) {
						const base = y0(layer.field), pts = [
							...segment,
							[segment.at(-1)[0], base],
							[segment[0][0], base]
						];
						children.push(ctx.path(`${asPath(pts)} Z`, {
							fill: color,
							"fill-opacity": .2,
							stroke: "none"
						}));
						segment = [];
					}
				};
				ys.forEach((y, i) => {
					if (finite(y)) segment.push([xs[i], y]);
					else close();
				});
				close();
			}
			const points = ys.flatMap((y, i) => finite(y) ? [[xs[i], y]] : []);
			if (points.length) traces.push({
				d: linePath(vals, xs, (v) => yFor(layer.field, v)),
				points,
				color
			});
		});
		const traceMarks = ({ d, points }, ink, rim = false) => [ctx.path(d, {
			fill: "none",
			stroke: ink,
			"stroke-width": rim ? 4 : 2,
			...rim ? {
				"stroke-linejoin": "round",
				"stroke-linecap": "round"
			} : {}
		}), ...points.map(([x, y]) => ctx.circle(x, y, rim ? 3.6 : 2.6, { fill: ink }))];
		const markContrast = 3;
		for (const { layer, index, ys, color } of columnLayers) {
			const group = columnLayers.filter((item) => item.layer.axis === layer.axis);
			const slot = group.findIndex((item) => item.index === index), bw = p.w / cats.length * .72 / group.length;
			const base = y0(layer.field);
			const boxes = ys.flatMap((y, i) => finite(y) ? [[
				xs[i] - bw * group.length / 2 + slot * bw,
				Math.min(y, base),
				bw * .88,
				Math.max(1, Math.abs(base - y))
			]] : []);
			for (const box of boxes) children.push(ctx.rect(...box, { fill: color }));
			const lowContrast = traces.filter((trace) => contrast(trace.color, color) < markContrast);
			if (!boxes.length || !lowContrast.length) continue;
			const clip = `combo-column-${diagramPanel ? `p${diagramPanel.index}-` : ""}${index}`;
			children.push(ctx.el("defs", {}, [ctx.el("clipPath", { id: clip }, boxes.map((box) => ctx.rect(...box)))]));
			children.push(ctx.el("g", { "clip-path": `url(#${clip})` }, lowContrast.flatMap((trace) => traceMarks(trace, pushContrast(trace.color, ctx.color("bg"), trace.color, markContrast), true))));
		}
		for (const trace of traces) children.push(...traceMarks(trace, trace.color));
		const comboNotes = [];
		for (const a of spec.annotations || []) {
			const layer = layers.find((l) => l.field === a.field);
			if (a.kind === "rule" && layer) {
				const y = yFor(a.field, a.value);
				children.push(ctx.line(p.x, y, p.x + p.w, y, {
					stroke: ctx.color("tone6"),
					"stroke-dasharray": "4 3"
				}));
				if (a.label) comboNotes.push({
					text: a.label,
					y: Math.max(p.y + 12, y - 16),
					anchor: "start",
					x: p.x + 4,
					fill: ctx.textColor("fg")
				});
			}
			if (a.kind === "band" && layer) {
				const y1 = yFor(a.field, a.from), y2 = yFor(a.field, a.to);
				children.push(ctx.rect(p.x, Math.min(y1, y2), p.w, Math.max(1, Math.abs(y2 - y1)), {
					fill: ctx.color("tone6"),
					"fill-opacity": .12
				}));
				if (a.label) comboNotes.push({
					text: a.label,
					y: Math.min(y1, y2) + 14,
					anchor: "end",
					fill: ctx.textColor("fg")
				});
			}
			if (a.kind === "note" && enc.id) {
				const row = data.find((r) => r[enc.id] === a.record), rowIndex = row ? cats.indexOf(row[enc.category]) : -1, layerForField = layers.find((l) => l.field === a.field);
				if (rowIndex >= 0 && layerForField && finite(row[a.field])) comboNotes.push({
					text: a.text,
					y: yFor(a.field, row[a.field]) - 12,
					anchor: "end",
					fill: ctx.textColor("fg")
				});
			}
		}
		comboNotes.sort((a, b) => a.y - b.y).forEach((item, index) => {
			const x = item.x ?? (item.anchor === "end" ? p.x + p.w - 4 : p.x + 4);
			children.push(ctx.text(x, p.y - 8 - index * 16, item.text, {
				anchor: item.anchor,
				size: 12,
				...item.fill ? { fill: item.fill } : {}
			}));
		});
		catLabels(cats, p);
		const showAxisInLegend = !diagramPanel || leftFields.length > 0 && rightFields.length > 0;
		const lh = legend(layers.map((l, i) => {
			const meta = ctx.field(l.field), unit = meta.unit || (meta.format === "percent" ? "%" : "");
			const axis = l.axis === "right" ? msg("右轴", "right axis") : msg("左轴", "left axis");
			return {
				label: [
					meta.label,
					unit,
					showAxisInLegend ? axis : null
				].filter(Boolean).join(" · "),
				color: ctx.color(`tone${i % 6 + 1}`)
			};
		}), p.y + p.h + 36);
		const scene = endScene(p.y + p.h + 36 + lh);
		scene.width = Math.max(width, p.x + p.w + rightGutter);
		return scene;
	}
	if (spec.chart === "bubble-matrix") {
		const rows = [...new Set(data.map((r) => r[enc.row]))], cols = [...new Set(data.map((r) => r[enc.column]))];
		const rd = ctx.field(enc.row).domain, cd = ctx.field(enc.column).domain;
		const rr = rd || rows, cc = cd || cols, vals = data.map((r) => r[enc.value]), max = Math.max(0, ...vals);
		const rowCap = Math.max(72, width * .28);
		const rowLines = rr.map((label) => ctx.wrap(String(label), rowCap, 12));
		const rowWidth = Math.max(24, ...rowLines.flat().map((line) => ctx.measure(line, 12)));
		const left = Math.min(rowCap, rowWidth) + 16;
		const headers = columnHeaders(ctx, cc, {
			left,
			right: 16,
			floor: 28
		});
		const cellW = headers.slot;
		const cellH = Math.max(28, Math.floor(270 / Math.max(1, rr.length)));
		const chartWidth = Math.max(width, left + cc.length * cellW + 16);
		const gridH = rr.length * cellH;
		const p = {
			x: left,
			y: 28,
			w: cc.length * cellW,
			h: gridH
		};
		rr.forEach((label, i) => {
			const lines = ctx.wrap(String(label), rowWidth, 12);
			children.push(ctx.textLines(p.x - 8, p.y + (i + .5) * cellH + 4 - (lines.length - 1) * 8, lines, {
				anchor: "end",
				size: 12
			}));
		});
		const BUBBLE_OPACITY = .28;
		const bubbles = [];
		data.forEach((row) => {
			const i = rr.indexOf(row[enc.row]), j = cc.indexOf(row[enc.column]), value = row[enc.value];
			if (i < 0 || j < 0) return;
			const x = p.x + (j + .5) * cellW, y = p.y + (i + .5) * cellH;
			const meta = {
				row: String(row[enc.row]),
				column: String(row[enc.column]),
				value
			};
			children.push(ctx.rect(p.x + j * cellW + 1, p.y + i * cellH + 1, cellW - 2, cellH - 2, { fill: ctx.color("grid") }));
			const radius = value > 0 ? Math.min(cellW, cellH) * .43 * Math.sqrt(value / (max || 1)) : 0;
			if (value > 0) children.push(ctx.circle(x, y, radius, {
				fill: ctx.color("tone2"),
				"fill-opacity": BUBBLE_OPACITY,
				stroke: ctx.color("tone2"),
				"stroke-width": 1.5,
				meta
			}));
			bubbles.push({
				x,
				y,
				radius,
				value,
				meta
			});
		});
		const readout = (value) => ctx.format(value, enc.value, false);
		const readoutColor = ctx.textOn("tone2", {
			opacity: BUBBLE_OPACITY,
			over: "grid"
		});
		if (bubbles.every((item) => {
			if (!(item.value > 0)) return true;
			const text = readout(item.value);
			return ctx.measure(text, 12) + 4 <= item.radius * 2 && 12 <= item.radius * 1.6;
		})) bubbles.forEach((item) => {
			if (!(item.value > 0)) return;
			children.push(ctx.text(item.x, item.y + 4, readout(item.value), {
				anchor: "middle",
				size: 12,
				fill: readoutColor,
				meta: {
					...item.meta,
					kind: "cell-readout"
				}
			}));
		});
		const columnY = p.y + p.h + 18;
		const yearY = columnY + Math.max(1, ...headers.items.map((item) => item.lines.length)) * 16;
		headers.items.forEach((item, j) => {
			if (item.lines.length) children.push(ctx.textLines(p.x + (j + .5) * cellW, columnY, item.lines, {
				anchor: "middle",
				size: 12
			}));
			if (item.year) children.push(ctx.text(p.x + j * cellW, yearY, item.year, {
				size: 12,
				fill: ctx.color("muted")
			}));
		});
		const noteY = (headers.years ? yearY : yearY - 16) + 24;
		const rowLabel = ctx.field(enc.row).label, columnLabel = ctx.field(enc.column).label, valueLabel = ctx.field(enc.value).label;
		const noteLines = ctx.wrap(msg(`行：${rowLabel}；列：${columnLabel}；气泡面积 ∝ ${valueLabel}；0 = ${ctx.format(0, enc.value)}，最大 = ${ctx.format(max, enc.value)}`, `Rows: ${rowLabel}; columns: ${columnLabel}; bubble area ∝ ${valueLabel}; 0 = ${ctx.format(0, enc.value)}, max = ${ctx.format(max, enc.value)}`), Math.max(120, chartWidth - p.x - 24), 12, 400);
		children.push(ctx.textLines(p.x, noteY, noteLines, { size: 12 }));
		const noteWidth = Math.max(...noteLines.map((line) => ctx.measure(line, 12)));
		const scene = ctx.scene(noteY + noteLines.length * 16 + 12, children, title);
		scene.width = Math.max(chartWidth, p.x + noteWidth + 16);
		return scene;
	}
	if (spec.chart === "calendar") {
		const dateAt = (y, month, day) => {
			const date = /* @__PURE__ */ new Date(0);
			date.setUTCHours(0, 0, 0, 0);
			date.setUTCFullYear(y, month, day);
			return date;
		};
		const dateValues = data.map((row) => String(row[enc.date] ?? "")).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)).sort();
		if (!dateValues.length) ctx.fit(msg("日历需要有效日期", "Calendar requires valid dates"), msg("提供 YYYY-MM-DD 格式的日期", "Provide dates in YYYY-MM-DD format"));
		const [startYear, startMonth] = dateValues[0].split("-").map(Number);
		const [lastYear, lastMonth] = dateValues.at(-1).slice(0, 7).split("-").map(Number);
		const start = dateAt(startYear, startMonth - 1, 1);
		const days = (dateAt(lastYear, lastMonth, 0) - start) / 864e5 + 1;
		if (days > 1e4) ctx.fit(msg("日历日期跨度过长", "Calendar date span is too long"), msg("缩小到 10000 天以内的日期范围", "Limit the date range to 10000 days"));
		const firstDay = new Intl.Locale(ctx.lang).weekInfo?.firstDay || (/^en-US/i.test(ctx.lang) ? 7 : 1), offset = (start.getUTCDay() - firstDay + 7) % 7;
		const weeks = Math.ceil((offset + days) / 7);
		const weekDay = new Intl.DateTimeFormat(ctx.lang, {
			weekday: "narrow",
			timeZone: "UTC"
		});
		const daysLabel = Array.from({ length: 7 }, (_, i) => weekDay.format(dateAt(2023, 0, 1 + (firstDay % 7 + i) % 7)));
		const side = {
			l: Math.max(...daysLabel.map((d) => ctx.measure(d, 12))) + 16,
			r: 16
		};
		const slotWidth = (width - side.l - side.r) / weeks, gap = slotWidth >= 16 ? 3 : 2;
		const cell = Math.max(10, Math.min(22, Math.floor(slotWidth - gap))), step = cell + gap, corner = Math.min(3, cell * .2);
		const chartWidth = Math.max(width, side.l + weeks * step + side.r);
		const p = {
			x: side.l,
			y: 48,
			w: weeks * step,
			h: 7 * step
		};
		const values = new Map(data.map((r) => [r[enc.date], r[enc.value]]));
		const nums = data.map((r) => r[enc.value]);
		const negativeMax = Math.max(0, ...nums.filter((v) => v < 0).map((v) => Math.abs(v)));
		const positiveMax = Math.max(0, ...nums.filter((v) => v > 0));
		daysLabel.forEach((d, i) => {
			if ([
				0,
				2,
				4
			].includes(i)) children.push(ctx.text(p.x - 8, p.y + i * step + cell * .68, d, {
				anchor: "end",
				size: 12
			}));
		});
		for (let d = 0; d < days; d++) {
			const date = dateAt(startYear, startMonth - 1, d + 1).toISOString().slice(0, 10);
			const index = offset + d, col = Math.floor(index / 7), row = index % 7, value = values.get(date);
			const x = p.x + col * step, y = p.y + row * step;
			const sideMax = value < 0 ? negativeMax : positiveMax;
			if (value == null) children.push(ctx.rect(x, y, cell, cell, {
				rx: corner,
				fill: "none",
				stroke: ctx.color("axis"),
				"stroke-dasharray": "2 2",
				meta: {
					record: date,
					value: null
				}
			}));
			else if (spec.variant === "dots") {
				const radius = value === 0 ? 2.5 : 2.5 + (cell * .35 - 2.5) * Math.sqrt(Math.abs(value) / (sideMax || 1));
				children.push(ctx.circle(x + cell / 2, y + cell / 2, radius, {
					fill: value < 0 ? ctx.color("tone2") : ctx.color("tone1"),
					"fill-opacity": value === 0 ? .08 : .82,
					stroke: value === 0 ? ctx.color("axis") : "none",
					meta: {
						record: date,
						value
					}
				}));
			} else {
				const ratio = value === 0 ? 0 : Math.abs(value) / (sideMax || 1);
				const base = value < 0 ? ctx.palette.tone2 : ctx.palette.tone1;
				children.push(ctx.rect(x, y, cell, cell, {
					rx: corner,
					fill: ctx.mix(ctx.palette.bg, base, value === 0 ? .12 : .2 + ratio * .7),
					stroke: value === 0 ? ctx.color("axis") : "none",
					"stroke-width": value === 0 ? 1 : 0,
					meta: {
						record: date,
						value
					}
				}));
			}
		}
		const months = [];
		for (let year = startYear, month = startMonth; year < lastYear || year === lastYear && month <= lastMonth;) {
			months.push(`${year}-${String(month).padStart(2, "0")}`);
			month += 1;
			if (month > 12) {
				year += 1;
				month = 1;
			}
		}
		ctx.compactTemporal(months).forEach((item, i) => {
			const [year, month] = months[i].split("-").map(Number);
			const monthStart = dateAt(year, month - 1, 1);
			const col = Math.floor((offset + (monthStart - start) / 864e5) / 7);
			if (item.year) children.push(ctx.text(p.x + col * step, p.y - 26, item.year, {
				size: 12,
				fill: ctx.color("muted")
			}));
			children.push(ctx.text(p.x + col * step, p.y - 10, item.label, {
				size: 12,
				fill: ctx.color("muted")
			}));
		});
		const descriptionText = msg("未采集：虚线；零值：描边", "Missing: dashed; zero: outlined");
		const ramps = [...positiveMax || !negativeMax ? [{
			maximum: positiveMax,
			color: ctx.palette.tone1,
			negative: false
		}] : [], ...negativeMax ? [{
			maximum: negativeMax,
			color: ctx.palette.tone2,
			negative: true
		}] : []].map((ramp) => ({
			...ramp,
			label: spec.variant === "dots" ? msg(ramp.negative ? "负值面积小→大" : "正值面积小→大", ramp.negative ? "Negative area: small→large" : "Positive area: small→large") : ramp.negative ? msg("负值色阶", "Negative color scale") : negativeMax ? msg("正值色阶", "Positive color scale") : msg("色阶", "Color scale")
		}));
		const legendBlockWidth = Math.max(ctx.measure(descriptionText, 12), ...ramps.map((ramp) => ctx.measure(ramp.label, 12) + 16 + 106 + ctx.measure(ctx.format(ramp.negative ? -ramp.maximum : ramp.maximum, enc.value), 12)));
		const sideLegend = p.x + p.w + 32 + legendBlockWidth <= chartWidth - side.r;
		const legendX = sideLegend ? p.x + p.w + 32 : p.x;
		let legendY = sideLegend ? p.y : p.y + p.h + 24;
		const availableLegendWidth = sideLegend ? chartWidth - side.r - legendX : chartWidth - p.x - side.r;
		const description = ctx.wrap(descriptionText, availableLegendWidth, 12);
		children.push(ctx.textLines(legendX, legendY + 12, description, { size: 12 }));
		legendY += description.length * 16 + 10;
		for (const ramp of ramps) {
			const labelLines = ctx.wrap(ramp.label, availableLegendWidth, 12);
			children.push(ctx.textLines(legendX, legendY + 12, labelLines, { size: 12 }));
			legendY += labelLines.length * 16 + 4;
			for (let i = 0; i < 5; i++) {
				const x = legendX + i * 22;
				if (spec.variant === "dots") children.push(ctx.circle(x + 9, legendY + 5, 2.5 + i, {
					fill: ramp.color,
					"fill-opacity": .82
				}));
				else children.push(ctx.rect(x, legendY, 18, 10, {
					fill: ctx.mix(ctx.palette.bg, ramp.color, .2 + i / 4 * .7),
					stroke: ctx.color("axis"),
					"stroke-width": .5
				}));
			}
			children.push(ctx.text(legendX, legendY + 28, ctx.format(0, enc.value), { size: 12 }));
			children.push(ctx.text(legendX + 72, legendY + 28, ctx.format(ramp.negative ? -ramp.maximum : ramp.maximum, enc.value), { size: 12 }));
			legendY += 44;
		}
		if (sideLegend) legendY = Math.max(legendY, p.y + p.h + 24);
		const scene = ctx.scene(legendY + 8, children, title);
		scene.width = chartWidth;
		return scene;
	}
	if (spec.chart === "tally") {
		const t = ctx.table(spec), columns = 10;
		const minSlot = Math.max(64, ctx.measure("字字", 12, 600) + 16);
		const slot = width / Math.max(1, t.categories.length);
		const titleDepth = Math.max(...t.categories.map((category) => ctx.wrap(String(category), Math.max(24, slot - 12), 12, 600).length));
		const horizontal = width >= 520 && slot >= minSlot && titleDepth <= 3;
		const categoryWidth = Math.min(width * .35, Math.max(24, ...t.categories.map((c) => ctx.measure(String(c), 12, 600))));
		const valueWidth = Math.max(40, ...t.series[0].values.map((v) => ctx.measure(ctx.format(v, enc.value), 12, 600)));
		const pitch = horizontal ? Math.max(7, Math.min(12, (width - 32) / (t.categories.length * columns))) : Math.max(6, Math.min(9, (width - categoryWidth - valueWidth - 36) / columns));
		const dot = pitch * .7;
		if (horizontal) {
			const slotWidth = width / t.categories.length;
			const titles = t.categories.map((category) => ctx.wrap(String(category), Math.max(24, slotWidth - 12), 12, 600));
			const titleLines = Math.max(1, ...titles.map((lines) => lines.length));
			const gridTop = 28 + titleLines * 16;
			t.categories.forEach((category, i) => {
				const value = t.series[0].values[i], center = slotWidth * (i + .5);
				const categoryLines = titles[i];
				children.push(ctx.textLines(center, 16 + (titleLines - categoryLines.length) * 8, categoryLines, {
					anchor: "middle",
					size: 12,
					weight: 600,
					fill: ctx.color("fg")
				}));
				const dotsX = center - 9 * pitch / 2;
				for (let n = 0; n < 100; n++) {
					const x = dotsX + n % columns * pitch, cy = gridTop + Math.floor(n / columns) * pitch;
					const portion = Math.max(0, Math.min(1, value * 100 - n));
					const radius = dot * (portion > 0 && portion < 1 ? .35 : .5);
					children.push(ctx.circle(x, cy, radius, {
						fill: portion ? ctx.color("tone1") : ctx.color("axis"),
						opacity: 1,
						meta: {
							kind: "tally-mark",
							category,
							index: n,
							value,
							portion
						}
					}));
				}
				children.push(ctx.text(center, gridTop + 10 * pitch + 20, ctx.format(value, enc.value), {
					anchor: "middle",
					size: 12,
					weight: 600,
					fill: ctx.color("fg")
				}));
			});
			const note = ctx.wrap(msg("每项独立百分比；点阵总量不要求相加为100%", "Independent percentages; dot totals need not sum to 100%"), width - 32, 12);
			const noteY = gridTop + 10 * pitch + 52;
			children.push(ctx.textLines(16, noteY, note, { size: 12 }));
			return ctx.scene(noteY + note.length * 16 + 12, children, title);
		}
		const groupWidth = categoryWidth + 8 + columns * pitch + 12 + valueWidth;
		const chartWidth = Math.max(width, groupWidth + 16);
		const labelX = (chartWidth - groupWidth) / 2, dotsX = labelX + categoryWidth + 8;
		const valueX = dotsX + columns * pitch + 12 + valueWidth;
		const categoryLines = t.categories.map((category) => ctx.wrap(String(category), categoryWidth, 12, 600));
		const rowHeights = categoryLines.map((lines) => Math.max(columns * pitch + 16, lines.length * 16 + 12));
		let cursor = 24;
		t.categories.forEach((category, i) => {
			const value = t.series[0].values[i], rowH = rowHeights[i], y = cursor + rowH / 2;
			children.push(ctx.textLines(labelX, y + 4 - (categoryLines[i].length - 1) * 8, categoryLines[i], {
				size: 12,
				weight: 600,
				fill: ctx.color("fg")
			}));
			for (let n = 0; n < 100; n++) {
				const x = dotsX + n % columns * pitch, cy = y - 22 + Math.floor(n / columns) * pitch;
				const portion = Math.max(0, Math.min(1, value * 100 - n));
				const radius = dot * (portion > 0 && portion < 1 ? .35 : .5);
				children.push(ctx.circle(x, cy, radius, {
					fill: portion ? ctx.color("tone1") : ctx.color("axis"),
					opacity: 1,
					meta: {
						kind: "tally-mark",
						category,
						index: n,
						value,
						portion
					}
				}));
			}
			children.push(ctx.text(valueX, y + 4, ctx.format(value, enc.value), {
				anchor: "end",
				size: 12,
				weight: 600,
				fill: ctx.color("fg")
			}));
			cursor += rowH;
		});
		const note = ctx.wrap(msg("每项独立百分比；点阵总量不要求相加为100%", "Independent percentages; dot totals need not sum to 100%"), chartWidth - labelX - 16, 12);
		const dotBottom = cursor - rowHeights.at(-1) / 2 - 22 + 9 * pitch + dot / 2;
		const noteY = Math.max(cursor + 20, dotBottom + 28);
		children.push(ctx.textLines(labelX, noteY, note, { size: 12 }));
		const scene = ctx.scene(noteY + note.length * 16 + 12, children, title);
		scene.width = chartWidth;
		return scene;
	}
	if (spec.chart === "bump") {
		const categories = ctx.field(enc.category).domain || [...new Set(data.map((r) => r[enc.category]))];
		const series = [...new Set(data.map((r) => r[enc.series]))];
		const ranks = data.map((r) => r[enc.rank]).filter(finite), max = Math.max(...ranks);
		const LINE = 16;
		const capOf = (label) => {
			const full = ctx.measure(String(label), 12);
			const word = Math.max(0, ...(String(label).match(/[A-Za-z0-9’'.-]+/g) || []).map((part) => ctx.measure(part, 12)));
			let cap = Math.min(160, Math.max(48, Math.ceil(full / 2), Math.ceil(word)));
			let lines = ctx.wrap(String(label), cap, 12);
			while (lines.length > 2) {
				cap += 12;
				lines = ctx.wrap(String(label), cap, 12);
			}
			return lines;
		};
		const nameLines = series.map(capOf);
		const nameColumn = Math.max(24, ...nameLines.flat().map((line) => ctx.measure(line, 12)));
		const rankColumn = 28;
		const left = 8 + nameColumn + 8 + rankColumn;
		const rightReserve = nameColumn + 16;
		const minPlotWidth = Math.max(1, categories.length) * 36;
		const chartWidth = Math.max(width, left + minPlotWidth + rightReserve);
		const rowSpan = Math.max(36, ...nameLines.map((lines) => lines.length * LINE + 4));
		const p = plot(48, 48 + Math.max(220, (Math.max(1, max) - 1) * rowSpan), left, chartWidth - rightReserve);
		const xs = categories.map((_, i) => bandX(i, categories.length, p));
		const yOf = (rank) => p.y + (rank - 1) / Math.max(1, max - 1) * p.h;
		for (let rank = 1; rank <= max; rank++) {
			const y = yOf(rank);
			children.push(ctx.line(p.x, y, p.x + p.w, y, { stroke: ctx.color("grid") }));
			children.push(ctx.text(p.x - 8, y + 4, String(rank), {
				anchor: "end",
				size: 12
			}));
		}
		const placed = {
			start: [],
			end: []
		};
		const dodge = (side, y, lines) => {
			const height = lines.length * LINE;
			let top = y - 14;
			const lane = placed[side];
			for (let guard = 0; guard < series.length + 2; guard += 1) {
				const hit = lane.find((item) => top < item.bottom + 4 && top + height > item.top);
				if (!hit) break;
				top = hit.bottom + 4;
			}
			lane.push({
				top,
				bottom: top + height
			});
			return top + 12;
		};
		series.forEach((id, j) => {
			const rows = categories.map((c) => data.find((r) => r[enc.category] === c && r[enc.series] === id));
			const tone = `tone${j % 6 + 1}`, color = ctx.color(tone), labelColor = ctx.textColor(tone);
			const values = rows.map((r) => r?.[enc.rank] ?? null);
			children.push(ctx.path(linePath(values, xs, (v) => yOf(v)), {
				fill: "none",
				stroke: color,
				"stroke-width": 2
			}));
			const lines = ctx.wrap(String(id), nameColumn, 12);
			values.forEach((v, i) => {
				if (!finite(v)) return;
				const tied = data.filter((r) => r[enc.category] === categories[i] && r[enc.rank] === v);
				const tieIndex = tied.findIndex((r) => r[enc.series] === id);
				const offset = tied.length > 1 ? (tieIndex - (tied.length - 1) / 2) * 12 : 0;
				const x = xs[i] + offset, y = yOf(v) + offset;
				const meta = {
					record: rows[i]?.[enc.id] || String(id),
					series: id,
					category: categories[i],
					rank: v
				};
				children.push(ctx.circle(x, y, 5, {
					fill: color,
					stroke: ctx.color("bg"),
					"stroke-width": 1.5,
					meta
				}));
				if (i === 0) children.push(ctx.textLines(p.x - rankColumn, dodge("end", y, lines), lines, {
					anchor: "end",
					size: 12,
					fill: labelColor,
					leading: LINE,
					meta
				}));
				if (i === categories.length - 1) children.push(ctx.textLines(p.x + p.w + 8, dodge("start", y, lines), lines, {
					anchor: "start",
					size: 12,
					fill: labelColor,
					leading: LINE,
					meta
				}));
			});
		});
		const nameBottom = Math.max(p.y + p.h, ...placed.start.map((item) => item.bottom), ...placed.end.map((item) => item.bottom));
		catLabels(categories, p, nameBottom + 20);
		const scene = ctx.scene(nameBottom + 40, children, title);
		scene.width = chartWidth;
		return scene;
	}
	if (spec.chart === "radar") {
		const dimensions = enc.dimensions, domains = dimensions.map((field) => ctx.field(field).domain);
		const angles = dimensions.map((_, i) => -Math.PI / 2 + i * Math.PI * 2 / dimensions.length);
		const rangeText = (field, domain) => {
			const meta = ctx.field(field);
			const bare = ctx.format(domain[0], field, false);
			const full = ctx.format(domain[1], field, true);
			return meta.unit || meta.format === "percent" ? `${bare}–${full}` : `${ctx.format(domain[0], field)}–${full}`;
		};
		const axisLabels = dimensions.map((field, i) => ({
			name: String(ctx.field(field).label),
			range: rangeText(field, domains[i])
		}));
		const chord = 2 * Math.sin(Math.PI / dimensions.length);
		const dense = dimensions.length > 6;
		const labelRoom = dense ? 96 : dimensions.length === 6 ? Math.max(48, Math.min(96, Math.ceil(width * chord * .42))) : Math.max(84, Math.min(140, Math.ceil(Math.max(72, width * .2) * chord)));
		const wrapped = axisLabels.map((item) => ({
			name: ctx.wrap(item.name, labelRoom, 12, 600),
			range: ctx.wrap(item.range, labelRoom, 12, 400)
		}));
		const textWidth = Math.max(0, ...wrapped.flatMap((item) => [...item.name.map((line) => ctx.measure(line, 12, 600)), ...item.range.map((line) => ctx.measure(line, 12, 400))]));
		const labelDepth = Math.max(...wrapped.map((item) => (item.name.length + item.range.length) * 16));
		const positionLabel = (angle, i, radius) => {
			const cos = Math.cos(angle), sin = Math.sin(angle);
			const horizontal = Math.abs(cos) >= Math.abs(sin);
			const anchor = horizontal ? cos < 0 ? "end" : "start" : "middle";
			const tx = horizontal ? cos * (radius + 10) : cos * radius;
			const ty = horizontal ? sin * radius : sin * (radius + 10);
			const block = wrapped[i].name.length + wrapped[i].range.length;
			return {
				anchor,
				tx,
				firstY: horizontal ? ty - (block - 1) * 8 : sin < 0 ? ty - block * 16 - 4 : ty + 16,
				block
			};
		};
		let radius = Math.min(spec[compactNumeric] ? 132 : 180, Math.max(72, (width - textWidth * 2 - 24) / 2));
		if (dense) {
			const widths = wrapped.map((item) => Math.max(...item.name.map((line) => ctx.measure(line, 12, 600)), ...item.range.map((line) => ctx.measure(line, 12, 400))));
			const labelsOverlap = () => {
				const boxes = angles.map((angle, i) => {
					const { anchor, tx, firstY, block } = positionLabel(angle, i, radius);
					const x = tx - widths[i] * (anchor === "end" ? 1 : anchor === "middle" ? .5 : 0);
					return {
						l: x - 3,
						r: x + widths[i] + 3,
						t: firstY - 15,
						b: firstY + (block - 1) * 16 + 6
					};
				});
				return boxes.some((a, i) => boxes.slice(i + 1).some((b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b));
			};
			while (labelsOverlap()) radius += Math.max(8, radius * .05);
		}
		const cx = Math.max(width / 2, textWidth + radius + 12);
		const cy = radius + labelDepth + 30;
		const chartWidth = Math.max(width, cx + radius + textWidth + 12);
		const radiusAt = (axis, value) => {
			const [lo, hi] = domains[axis];
			return Math.max(0, Math.min(1, (value - lo) / (hi - lo || 1))) * radius;
		};
		const rings = Number.isInteger(spec.rings) && spec.rings > 0 ? spec.rings : 4;
		for (let ring = 1; ring <= rings; ring++) {
			if (spec.graticule === "circle") {
				children.push(ctx.circle(cx, cy, radius * ring / rings, {
					fill: "none",
					stroke: ctx.color("grid")
				}));
				continue;
			}
			const points = angles.map((angle) => [cx + Math.cos(angle) * radius * ring / rings, cy + Math.sin(angle) * radius * ring / rings]);
			if (points.length === 1) children.push(ctx.circle(...points[0], 1, { fill: ctx.color("grid") }));
			else if (points.length === 2) children.push(ctx.line(...points[0], ...points[1], { stroke: ctx.color("grid") }));
			else children.push(ctx.el("polygon", {
				points: points.map((point) => point.join(",")).join(" "),
				fill: "none",
				stroke: ctx.color("grid")
			}));
		}
		angles.forEach((angle, i) => {
			const cos = Math.cos(angle), sin = Math.sin(angle);
			children.push(ctx.line(cx, cy, cx + cos * radius, cy + sin * radius, { stroke: ctx.color("axis") }));
			const { anchor, tx, firstY } = positionLabel(angle, i, radius);
			children.push(ctx.textLines(cx + tx, cy + firstY, wrapped[i].name, {
				anchor,
				size: 12,
				weight: 600,
				fill: ctx.color("fg")
			}));
			children.push(ctx.textLines(cx + tx, cy + firstY + wrapped[i].name.length * 16, wrapped[i].range, {
				anchor,
				size: 12,
				weight: 400,
				fill: ctx.color("muted")
			}));
		});
		data.forEach((row, rowIndex) => {
			const points = dimensions.map((field, i) => [cx + Math.cos(angles[i]) * radiusAt(i, row[field]), cy + Math.sin(angles[i]) * radiusAt(i, row[field])]);
			const color = ctx.color(`tone${rowIndex % 6 + 1}`);
			if (points.length === 2) children.push(ctx.line(...points[0], ...points[1], {
				stroke: color,
				"stroke-width": 2
			}));
			else if (points.length >= 3) children.push(ctx.el("polygon", {
				points: points.map((point) => point.join(",")).join(" "),
				fill: color,
				"fill-opacity": .14,
				stroke: color,
				"stroke-width": 2
			}));
			points.forEach((point, i) => children.push(ctx.circle(point[0], point[1], 3, {
				fill: color,
				meta: {
					record: row[enc.id] || String(rowIndex),
					field: dimensions[i],
					value: row[dimensions[i]]
				}
			})));
		});
		const legendY = cy + radius + labelDepth + 12;
		const legendItems = data.map((row, i) => ({
			label: row[enc.label],
			color: ctx.color(`tone${i % 6 + 1}`),
			meta: { record: row[enc.id] || String(i) }
		}));
		const showLegend = spec.legend !== false;
		const legendBlock = showLegend ? ctx.legend(legendItems, Math.max(120, chartWidth - 32)) : {
			children: [],
			height: 0
		};
		if (showLegend) children.push(ctx.el("g", { transform: `translate(16,${legendY})` }, legendBlock.children));
		const scene = ctx.scene(showLegend ? legendY + legendBlock.height + 16 : legendY - 12, children, title);
		scene.width = chartWidth;
		return scene;
	}
	if (spec.chart === "parallel") {
		const dimensions = enc.dimensions;
		const domainFor = (f) => ctx.field(f).domain || (() => {
			const e = ctx.extent(data.map((r) => r[f]).filter(finite));
			return e[0] === e[1] ? [e[0] - 1, e[1] + 1] : e;
		})();
		const axisTitle = (f) => {
			const meta = ctx.field(f);
			const unit = meta.unit || (meta.format === "percent" ? "%" : "");
			return [meta.label, unit].filter(Boolean).join(" · ");
		};
		const titleLines = (slot) => dimensions.map((f) => ctx.wrap(axisTitle(f), Math.max(36, slot - 12), 12, 600));
		const tickLabel = (f, value) => ctx.format(value, f, false);
		const tickWidth = Math.max(0, ...dimensions.flatMap((f) => {
			const domain = domainFor(f);
			return [
				0,
				.5,
				1
			].map((step) => ctx.measure(tickLabel(f, domain[0] + (domain[1] - domain[0]) * step), 12));
		}));
		const titleWidth = Math.max(0, ...dimensions.map((f) => ctx.measure(axisTitle(f), 12, 600)));
		const side = Math.ceil(Math.max(tickWidth, titleWidth) / 2) + 8;
		const minSlot = Math.max(48, tickWidth + 8, ...titleLines(72).map((lines) => Math.max(...lines.map((line) => ctx.measure(line, 12, 600))) + 12));
		const gaps = Math.max(1, dimensions.length - 1);
		const slot = Math.max(minSlot, Math.floor((width - side * 2) / gaps));
		const chartWidth = Math.max(width, side + gaps * slot + side);
		const head = titleLines(slot);
		const headHeight = Math.max(...head.map((lines) => lines.length)) * 16 + 4;
		const p = plot(headHeight + 20, headHeight + 248, side, chartWidth - side);
		const xs = dimensions.map((_, i) => dimensions.length === 1 ? p.x + p.w / 2 : p.x + i * slot);
		dimensions.forEach((f, i) => {
			const d = domainFor(f);
			children.push(ctx.line(xs[i], p.y, xs[i], p.y + p.h, { stroke: ctx.color("axis") }));
			for (let k = 0; k <= 4; k++) {
				const v = d[0] + (d[1] - d[0]) * k / 4, y = p.y + p.h - k * p.h / 4;
				children.push(ctx.line(xs[i] - 3, y, xs[i] + 3, y, { stroke: ctx.color("axis") }));
				if (k === 0 || k === 4 || k === 2) children.push(ctx.text(xs[i], y - 4, tickLabel(f, v), {
					anchor: "middle",
					size: 12
				}));
			}
			children.push(ctx.textLines(xs[i], 16, head[i], {
				anchor: "middle",
				size: 12,
				weight: 600,
				fill: ctx.color("fg")
			}));
		});
		data.forEach((row, ri) => {
			const values = dimensions.map((f) => finite(row[f]) ? row[f] : null);
			const ys = values.map((v, i) => v === null ? NaN : p.y + p.h - (v - domainFor(dimensions[i])[0]) / (domainFor(dimensions[i])[1] - domainFor(dimensions[i])[0]) * p.h);
			const color = ctx.color(`tone${ri % 6 + 1}`);
			children.push(ctx.path(linePath(values, xs, (_, i) => ys[i]), {
				fill: "none",
				stroke: color,
				"stroke-width": 1.6,
				"stroke-opacity": .72,
				meta: {
					record: row[enc.id] || String(ri),
					series: row[enc.series]
				}
			}));
		});
		const legendY = p.y + p.h + 28;
		const legendItems = data.map((r, i) => ({
			label: String(r[enc.label]),
			color: ctx.color(`tone${i % 6 + 1}`),
			meta: { record: r[enc.id] || String(i) }
		}));
		const legendBlock = ctx.legend(legendItems, Math.max(120, chartWidth - 32));
		children.push(ctx.el("g", { transform: `translate(16,${legendY})` }, legendBlock.children));
		const scene = ctx.scene(legendY + legendBlock.height + 16, children, title);
		scene.width = chartWidth;
		return scene;
	}
	if (spec.chart === "launch-fan") {
		const starts = data.map((r) => r[enc.start]), values = data.map((r) => r[enc.value]);
		const side = 16;
		const max = Math.max(1, ...values), p = plot(78, 320, side, width - side);
		if (!starts.every((v) => typeof v === typeof starts[0])) ctx.fit(msg("launch-fan起点类型不一致", "launch-fan start types differ"), msg("统一使用数值时点或同一时间类型后重试", "Use numeric starts or a consistent date type"));
		const dates = typeof starts[0] === "string";
		const nums = starts.map((v) => dates ? Date.parse(v) : v);
		const labels = data.map((row, i) => `${row[enc.label]} · ${ctx.format(values[i], enc.value)}`);
		const labelWidth = Math.min(width * .27, Math.max(52, ...labels.map((label) => ctx.measure(label, 12, 400))));
		const labelLines = labels.map((label) => ctx.wrap(label, labelWidth, 12));
		const labelColumn = Math.max(...labelLines.map((lines) => Math.max(...lines.map((line) => ctx.measure(line, 12)))));
		const maxRadius = 28;
		const endX = Math.max(p.x + 128, Math.min(p.x + p.w * .84, width - side - labelColumn - maxRadius - 8));
		const chartWidth = Math.max(width, endX + maxRadius + 8 + labelColumn + side);
		const lo = Math.min(...nums), hi = Math.max(...nums);
		const timeEnd = endX - maxRadius - 16;
		const x = ctx.linear(lo, hi || lo + 1, p.x + 10, timeEnd);
		const sorted = data.map((row, i) => ({
			row,
			i,
			start: nums[i]
		})).sort((a, b) => a.start - b.start || a.i - b.i);
		const radiusOf = (i) => Math.sqrt(values[i] / max) * maxRadius;
		const circleGap = Math.max(0, ...sorted.slice(1).map((item, k) => radiusOf(sorted[k].i) + radiusOf(item.i) + 6));
		const rowGap = Math.max(36, circleGap, ...labelLines.map((lines) => lines.length * 16 + 8));
		const fanHeight = Math.max(p.h, 62 + Math.max(0, data.length - 1) * rowGap);
		const baseline = p.y + fanHeight;
		const bubbleTop = p.y + maxRadius, bubbleBottom = baseline - maxRadius - 6;
		children.push(ctx.line(p.x, baseline, timeEnd + 10, baseline, { stroke: ctx.color("axis") }));
		const startClusters = [];
		sorted.forEach((item) => {
			const sx = x(item.start), cluster = startClusters.at(-1);
			if (!cluster || sx - cluster.x >= 7) startClusters.push({
				x: sx,
				items: [item]
			});
			else cluster.items.push(item);
		});
		const startOffset = /* @__PURE__ */ new Map();
		startClusters.forEach((cluster) => {
			cluster.items.forEach((item, index) => {
				startOffset.set(item.i, (index - (cluster.items.length - 1) / 2) * 7);
			});
		});
		sorted.forEach(({ row, i, start }, rank) => {
			const sx = x(start), startY = baseline + startOffset.get(i);
			const ey = bubbleTop + rank * (bubbleBottom - bubbleTop) / Math.max(1, data.length - 1);
			const radius = Math.sqrt(values[i] / max) * maxRadius;
			const color = ctx.color(`tone${i % 6 + 1}`), id = row[enc.id] || String(i);
			children.push(ctx.path(`M${sx},${startY} Q${(sx + endX) / 2},${ey} ${endX - radius},${ey}`, {
				fill: "none",
				stroke: color,
				"stroke-width": Math.max(1, Math.sqrt(values[i] / max) * 3),
				"stroke-opacity": .6
			}));
			children.push(ctx.circle(sx, startY, 3, {
				fill: color,
				meta: {
					record: id,
					start
				}
			}));
			children.push(ctx.circle(endX, ey, radius, {
				fill: color,
				"fill-opacity": .32,
				stroke: color,
				"stroke-width": 1.5,
				meta: {
					record: id,
					value: values[i]
				}
			}));
			const lines = labelLines[i], labelY = ey - (lines.length - 1) * 8 + 4;
			children.push(ctx.textLines(endX + radius + 8, labelY, lines, {
				size: 12,
				fill: ctx.color("fg"),
				meta: {
					record: id,
					value: values[i]
				}
			}));
		});
		const timeLabel = (value, includeYear) => {
			if (!dates) return ctx.format(value, enc.start);
			const raw = String(starts.find((item) => (typeof item === "string" ? Date.parse(item) : item) === value));
			const monthOnly = /^\d{4}-\d{2}$/.test(raw);
			const options = {
				month: "short",
				timeZone: "UTC"
			};
			if (!monthOnly) options.day = "numeric";
			if (includeYear) options.year = "numeric";
			return new Intl.DateTimeFormat(ctx.lang, options).format(new Date(value));
		};
		const timeline = [...new Set(nums)].sort((a, b) => a - b).map((value) => ({
			value,
			year: dates ? new Date(value).getUTCFullYear() : null
		}));
		const withLabels = (items) => items.map((item, index) => ({
			...item,
			label: timeLabel(item.value, dates && (index === 0 || item.year !== items[index - 1].year))
		}));
		const labelPosition = (item) => x(item.value);
		const fitsRight = (item) => labelPosition(item) + ctx.measure(item.label, 12) <= chartWidth - side;
		const labelAnchor = (item, index, count = timeline.length) => {
			if (index === 0) return "start";
			if (index === count - 1) return fitsRight(item) ? "start" : "end";
			return "middle";
		};
		const labelBounds = (item, index, count) => {
			const center = labelPosition(item), textWidth = ctx.measure(item.label, 12), anchor = labelAnchor(item, index, count);
			return [anchor === "start" ? center : anchor === "end" ? center - textWidth : center - textWidth / 2, anchor === "start" ? center + textWidth : anchor === "end" ? center : center + textWidth / 2];
		};
		let selected = [];
		timeline.forEach((item, index) => {
			const candidate = withLabels([...selected.map((entry) => ({
				value: entry.value,
				year: entry.year
			})), item]);
			const clear = candidate.every((entry, at) => at === 0 || labelBounds(candidate[at - 1], at - 1, candidate.length)[1] + 8 <= labelBounds(entry, at, candidate.length)[0]);
			const last = index === timeline.length - 1;
			if (!clear && last && candidate.length > 2) candidate.splice(-2, 1);
			const kept = withLabels(candidate.map((entry) => ({
				value: entry.value,
				year: entry.year
			})));
			const keptClear = kept.every((entry, at) => at === 0 || labelBounds(kept[at - 1], at - 1, kept.length)[1] + 8 <= labelBounds(entry, at, kept.length)[0]);
			if ((clear || last) && keptClear) selected = kept;
		});
		selected.forEach((item, index) => {
			const at = labelPosition(item), anchor = labelAnchor(item, index, selected.length);
			children.push(ctx.line(at, baseline - 1, at, baseline + 5, { stroke: ctx.color("axis") }));
			children.push(ctx.text(at, baseline + 22, item.label, {
				anchor,
				size: 12,
				fill: ctx.color("muted"),
				meta: {
					kind: "launch-fan-time",
					value: item.value
				}
			}));
		});
		const noteY = baseline + 50;
		const noteLines = ctx.wrap(msg("起点 = 开始时点；末端圆面积 = 当前量", "Start = launch date; end-circle area = current value"), chartWidth - p.x - 16, 12);
		children.push(ctx.textLines(p.x, noteY, noteLines, { size: 12 }));
		const scene = ctx.scene(noteY + noteLines.length * 16 + 12, children, title);
		scene.width = chartWidth;
		return scene;
	}
	throw new Error(`Unsupported multivariate chart: ${spec.chart}`);
};
function install({ register }) {
	register([
		"stream",
		"split-compare",
		"combo",
		"bubble-matrix",
		"calendar",
		"tally",
		"bump",
		"radar",
		"parallel",
		"launch-fan"
	], chart);
}
install({ register });
export { compactNumeric, diagramCombo, install, multivariate_exports };
