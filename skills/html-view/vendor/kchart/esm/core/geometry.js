import { __exportAll } from "../_virtual/_rolldown/runtime.js";
// src/core/geometry.js
var geometry_exports = /* @__PURE__ */ __exportAll({
	apportion: () => apportion,
	barPath: () => barPath,
	columnHeaders: () => columnHeaders,
	cubicPath: () => cubicPath,
	labelLanes: () => labelLanes
});
var round2 = (value) => Math.round(value * 100) / 100;
function barPath(x, y, w, h, radius, side) {
	const width = Math.max(0, w), height = Math.max(0, h);
	let r = side === "all" ? Math.min(radius, width / 2, height / 2) : side === "top" || side === "bottom" ? Math.min(radius, width / 2, height) : Math.min(radius, height / 2, width);
	r = Math.max(0, r);
	const [x0, y0, x1, y1] = [
		round2(x),
		round2(y),
		round2(x + width),
		round2(y + height)
	];
	if (r < .5) return `M${x0},${y0}H${x1}V${y1}H${x0}Z`;
	const k = round2(r), arc = (tx, ty) => `A${k},${k} 0 0 1 ${round2(tx)},${round2(ty)}`;
	switch (side) {
		case "top": return `M${x0},${y1}V${round2(y + r)}${arc(x + r, y)}H${round2(x + width - r)}${arc(x + width, y + r)}V${y1}Z`;
		case "bottom": return `M${x0},${y0}H${x1}V${round2(y + height - r)}${arc(x + width - r, y + height)}H${round2(x + r)}${arc(x, y + height - r)}Z`;
		case "right": return `M${x0},${y0}H${round2(x + width - r)}${arc(x + width, y + r)}V${round2(y + height - r)}${arc(x + width - r, y + height)}H${x0}Z`;
		case "left": return `M${x1},${y0}V${y1}H${round2(x + r)}${arc(x, y + height - r)}V${round2(y + r)}${arc(x + r, y)}Z`;
		default: return `M${round2(x + r)},${y0}H${round2(x + width - r)}${arc(x + width, y + r)}V${round2(y + height - r)}${arc(x + width - r, y + height)}H${round2(x + r)}${arc(x, y + height - r)}V${round2(y + r)}${arc(x + r, y)}Z`;
	}
}
function apportion(values, total) {
	const sum = values.reduce((acc, value) => acc + value, 0);
	if (!(sum > 0)) return values.map(() => 0);
	const exact = values.map((value) => value / sum * total), counts = exact.map(Math.floor);
	const remaining = total - counts.reduce((acc, count) => acc + count, 0);
	exact.map((value, i) => ({
		i,
		remainder: value - Math.floor(value)
	})).sort((a, b) => b.remainder - a.remainder || a.i - b.i).slice(0, remaining).forEach(({ i }) => {
		counts[i] += 1;
	});
	return counts;
}
var LABEL_GAP = 8;
function columnHeaders(ctx, colNames, { left, right, floor = 24 }) {
	const temporal = ctx.compactTemporal(colNames), count = Math.max(1, colNames.length), inner = (slot) => Math.max(1, slot - 4);
	const widest = (slot) => {
		const lines = temporal.map((item) => ctx.wrap(item.label, inner(slot), 12));
		const label = Math.max(0, ...lines.flat().map((line) => ctx.measure(line, 12, 400)));
		const year = Math.max(0, ...temporal.map((item) => item.year ? ctx.measure(item.year, 12, 400) : 0));
		return {
			lines,
			width: Math.max(label, year)
		};
	};
	const natural = temporal.every((item, index) => !item.year && item.label === String(colNames[index])) ? Math.max(...temporal.map((item) => ctx.measure(item.label, 12, 400))) + LABEL_GAP : 0;
	let slot = Math.max(floor, natural, Math.floor((ctx.width - left - right) / count)), packed = widest(slot);
	if (packed.width + LABEL_GAP > slot) {
		slot = Math.ceil(Math.max(slot, packed.width + LABEL_GAP));
		packed = widest(slot);
	}
	const strideOf = (gap) => {
		for (let stride = 1; stride < count; stride += 1) {
			const kept = temporal.filter((_, index) => index % stride === 0);
			if (Math.max(0, ...kept.flatMap((item, order) => {
				return [...ctx.wrap(item.label, inner(slot), 12).map((line) => ctx.measure(line, 12, 400)), item.year && (order === 0 || item.year !== kept[order - 1].year) ? ctx.measure(item.year, 12, 400) : 0];
			})) + gap <= stride * slot) return stride;
		}
		return count;
	};
	const stride = strideOf(LABEL_GAP);
	const shown = temporal.map((item, index) => {
		if (index % stride !== 0) return {
			...item,
			label: "",
			year: "",
			lines: []
		};
		const previous = temporal.slice(0, index).filter((_, at) => at % stride === 0).at(-1);
		return {
			...item,
			year: item.year && item.year !== previous?.year ? item.year : "",
			lines: ctx.wrap(item.label, inner(slot), 12)
		};
	});
	return {
		slot,
		stride,
		items: shown,
		years: shown.some((item) => item.year),
		lines: packed.lines
	};
}
function labelLanes(ctx, items, { left, right, maxWidth = 160, gap = 8 }) {
	const lanes = [];
	const placed = items.map((item) => {
		const lines = ctx.wrap(item.text, Math.min(maxWidth, right - left), 12, 400);
		const width = Math.max(...lines.map((line) => ctx.measure(line, 12, 400)));
		const cx = Math.max(left + width / 2, Math.min(right - width / 2, item.x));
		const free = (boxes) => boxes.every((box) => cx - width / 2 >= box.x1 + gap || cx + width / 2 <= box.x0 - gap);
		let lane = lanes.findIndex(free);
		if (lane < 0) lane = lanes.push([]) - 1;
		lanes[lane].push({
			x0: cx - width / 2,
			x1: cx + width / 2,
			rows: lines.length
		});
		return {
			...item,
			cx,
			lines,
			lane
		};
	});
	const offsets = lanes.reduce((acc, boxes) => [...acc, acc.at(-1) + Math.max(...boxes.map((box) => box.rows)) * 16], [0]);
	return {
		items: placed.map((item) => ({
			...item,
			offset: offsets[item.lane]
		})),
		height: offsets.at(-1)
	};
}
function cubicPath(segments) {
	if (!segments.length) return "";
	const { p0 } = segments[0];
	const commands = segments.map(({ c1, c2, p1 }) => `C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p1.x} ${p1.y}`);
	return `M${p0.x} ${p0.y} ${commands.join(" ")}`;
}
export { apportion, barPath, columnHeaders, cubicPath, geometry_exports, labelLanes };
