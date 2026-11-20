import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { register } from "./registry.js";
import { sizeBudget } from "./spec.js";
// src/chart/relations.js
var relations_exports = /* @__PURE__ */ __exportAll({
	install: () => install,
	sankeyCompact: () => sankeyCompact,
	sankeyPresentation: () => sankeyPresentation
});
var clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
var idOf = (record, fallback) => String(record.id ?? fallback);
var textOf = (record) => String(record.label ?? record.id ?? "");
var stable = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
var num = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
var pair = (x, y) => `${x.toFixed(2)},${y.toFixed(2)}`;
var withDescription = (ctx, height, children, spec, width = ctx.width) => ({
	...ctx.scene(height, children),
	width,
	description: spec.note || void 0
});
function stackLabels(items, heightOf, gap, floor, ceiling) {
	const ordered = [...items].sort((a, b) => a.target - b.target || stable(a.id, b.id));
	let cursor = floor;
	for (const item of ordered) {
		item.top = Math.max(item.target, cursor);
		cursor = item.top + heightOf(item) + gap;
	}
	if (cursor - gap - ceiling > 0) for (let i = ordered.length - 1; i >= 0; i--) {
		const item = ordered[i];
		const nextLimit = i < ordered.length - 1 ? ordered[i + 1].top - gap - heightOf(item) : ceiling - heightOf(item);
		item.top = Math.min(item.top, nextLimit);
	}
	if (ordered.length && ordered[0].top < floor) {
		const shift = floor - ordered[0].top;
		for (const item of ordered) item.top += shift;
	}
	return ordered;
}
var paletteColor = (ctx, group) => {
	if (group == null || group === "") return ctx.color("tone1");
	const tones = [
		"tone1",
		"tone2",
		"tone3",
		"tone4",
		"tone5",
		"tone6"
	];
	const hash = parseInt(ctx.hash(String(group)), 36) || 0;
	return ctx.color(tones[hash % tones.length]);
};
function forcePositions(nodes, edges, box, radiusFor) {
	const ordered = [...nodes].sort((a, b) => stable(a.id, b.id));
	const positions = /* @__PURE__ */ new Map();
	const ideal = Math.sqrt(box.w * box.h / Math.max(1, nodes.length));
	const goldenAngle = Math.PI * (3 - Math.sqrt(5));
	ordered.forEach((node, index) => {
		const angle = index * goldenAngle;
		const radius = Math.sqrt((index + .5) / ordered.length) * Math.min(box.w, box.h) * .42;
		positions.set(node.id, {
			x: Math.cos(angle) * radius,
			y: Math.sin(angle) * radius
		});
	});
	for (let iteration = 0; iteration < 240; iteration++) {
		const forces = new Map(ordered.map((node) => [node.id, {
			x: 0,
			y: 0
		}]));
		for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) {
			const a = positions.get(ordered[i].id), b = positions.get(ordered[j].id);
			const dx = a.x - b.x, dy = a.y - b.y;
			const distance = Math.max(.1, Math.hypot(dx, dy));
			const strength = ideal * ideal / distance;
			const fx = dx / distance * strength, fy = dy / distance * strength;
			forces.get(ordered[i].id).x += fx;
			forces.get(ordered[i].id).y += fy;
			forces.get(ordered[j].id).x -= fx;
			forces.get(ordered[j].id).y -= fy;
		}
		for (const edge of edges) {
			if (edge.source === edge.target) continue;
			const a = positions.get(edge.source), b = positions.get(edge.target);
			const dx = b.x - a.x, dy = b.y - a.y;
			const distance = Math.max(.1, Math.hypot(dx, dy));
			const strength = distance * distance / ideal;
			const fx = dx / distance * strength, fy = dy / distance * strength;
			forces.get(edge.source).x += fx;
			forces.get(edge.source).y += fy;
			forces.get(edge.target).x -= fx;
			forces.get(edge.target).y -= fy;
		}
		const temperature = Math.min(box.w, box.h) * .08 * (1 - iteration / 240) ** 2 + .08;
		for (const node of ordered) {
			const point = positions.get(node.id), force = forces.get(node.id);
			force.x -= point.x * .35;
			force.y -= point.y * .35;
			const length = Math.max(.1, Math.hypot(force.x, force.y));
			const step = Math.min(length, temperature) / length;
			point.x += force.x * step;
			point.y += force.y * step;
		}
	}
	const xs = [...positions.values()].map((point) => point.x);
	const ys = [...positions.values()].map((point) => point.y);
	const minX = Math.min(...xs), maxX = Math.max(...xs);
	const minY = Math.min(...ys), maxY = Math.max(...ys);
	const scale = Math.min(box.w / Math.max(1, maxX - minX), box.h / Math.max(1, maxY - minY));
	for (const point of positions.values()) {
		point.x = box.x + box.w / 2 + (point.x - (minX + maxX) / 2) * scale;
		point.y = box.y + box.h / 2 + (point.y - (minY + maxY) / 2) * scale;
	}
	for (let iteration = 0; iteration < 40; iteration++) {
		for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) {
			const a = positions.get(ordered[i].id), b = positions.get(ordered[j].id);
			const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(.01, Math.hypot(dx, dy));
			const required = radiusFor(ordered[i]) + radiusFor(ordered[j]) + 2;
			if (distance >= required) continue;
			const shift = (required - distance) / 2;
			a.x -= dx / distance * shift;
			a.y -= dy / distance * shift;
			b.x += dx / distance * shift;
			b.y += dy / distance * shift;
		}
		for (const point of positions.values()) {
			point.x = clamp(point.x, box.x, box.x + box.w);
			point.y = clamp(point.y, box.y, box.y + box.h);
		}
	}
	return positions;
}
function network(spec, ctx) {
	const data = spec.data;
	const nodes = data.nodes, edges = data.edges;
	if (nodes.length > 200 || edges.length > 500) ctx.fit("network超过200个节点或500条边", "缩小数据范围后重试");
	const force = (spec.layout || "circular") === "force";
	const labelExtent = Math.max(72, ...nodes.map((node) => ctx.measure(textOf(node), 12, 400)));
	const sidePad = Math.min(168, labelExtent + 24);
	const maxLabelLines = Math.max(1, ...nodes.map((n) => ctx.wrap(textOf(n), force && nodes.length > 80 ? 150 : 96, 12, 400).length));
	const denseForce = force && nodes.length > 80;
	let W = ctx.width;
	const labelStackHeight = Math.ceil(nodes.length / 2) * (maxLabelLines * 14 + 4);
	const narrowCircular = !force && W <= 360;
	const narrowRadius = Math.min(W * .32, 90) * .77;
	const H = denseForce ? Math.max(240, Math.round(W * .82)) : narrowCircular ? Math.ceil(2 * (narrowRadius + 17) + labelStackHeight + 64) : Math.max(440, 330 + Math.sqrt(nodes.length) * 24, 180 + (force ? labelStackHeight : nodes.length * (maxLabelLines * 14 + 4)));
	const nodeDegrees = new Map(nodes.map((node) => [node.id, 0]));
	for (const edge of edges) {
		nodeDegrees.set(edge.source, nodeDegrees.get(edge.source) + 1);
		nodeDegrees.set(edge.target, nodeDegrees.get(edge.target) + 1);
	}
	const denseLabelLimit = W <= 360 ? 4 : W <= 600 ? 8 : 12;
	const labelledNodes = denseForce ? new Set([...nodes].sort((a, b) => nodeDegrees.get(b.id) - nodeDegrees.get(a.id) || stable(a.id, b.id)).slice(0, denseLabelLimit).map((node) => node.id)) : null;
	const unvaluedRadius = denseForce ? Math.min(4, Math.max(2.5, W / 160)) : 5.5;
	const maxV = Math.max(0, ...nodes.map((n) => Math.max(0, num(n.value))));
	const radiusFor = (node) => node.value == null ? unvaluedRadius : maxV ? 17 * Math.sqrt(Math.max(0, num(node.value)) / maxV) : 0;
	const labelWeight = (node) => node.value != null && node.value > 0 ? 600 : 400;
	const minLabelWidth = Math.max(0, ...nodes.flatMap((node) => ctx.wrap(textOf(node), 72, 12, labelWeight(node)).map((line) => ctx.measure(line, 12, labelWeight(node)))));
	const labelRoom = Math.max(0, ...nodes.map(radiusFor)) + 10 + minLabelWidth;
	const minRadius = 48;
	let horizontalPadding = sidePad;
	if (denseForce) horizontalPadding = Math.max(28, W * .06);
	else if (force) {
		horizontalPadding = Math.max(sidePad, labelRoom);
		if (W - 2 * horizontalPadding < 96) horizontalPadding = Math.max(labelRoom, W / 2 - minRadius);
		if (W - 2 * horizontalPadding < 96) W = Math.ceil(2 * (horizontalPadding + minRadius));
	} else if (W / 2 - labelRoom < minRadius) W = Math.ceil(2 * (minRadius + labelRoom));
	const cx = W / 2, cy = H / 2;
	const rx = Math.min(W * .32, Math.max(90, H * .36), cx - labelRoom), ry = Math.min(H * .34, rx * .77);
	const positions = force ? forcePositions(nodes, edges, {
		x: horizontalPadding,
		y: 36,
		w: Math.max(1, W - 2 * horizontalPadding),
		h: H - 84
	}, radiusFor) : /* @__PURE__ */ new Map();
	if (!force) nodes.forEach((n, i) => {
		const angle = -Math.PI / 2 + 2 * Math.PI * i / Math.max(1, nodes.length);
		positions.set(n.id, {
			x: cx + rx * Math.cos(angle),
			y: cy + ry * Math.sin(angle)
		});
	});
	const maxEdge = Math.max(0, ...edges.map((e) => Math.abs(num(e.value))));
	const children = [];
	const incident = new Map(nodes.map((n) => [n.id, edges.filter((e) => e.source === n.id || e.target === n.id)]));
	const arrows = [];
	for (const [i, e] of edges.entries()) {
		const a = positions.get(e.source), b = positions.get(e.target);
		if (!a || !b) continue;
		const dx = b.x - a.x, dy = b.y - a.y, d = Math.max(1, Math.hypot(dx, dy));
		const bend = (parseInt(ctx.hash(idOf(e, i)), 36) % 17 - 8) * 2.2;
		const mx = (a.x + b.x) / 2 - dy / d * bend, my = (a.y + b.y) / 2 + dx / d * bend;
		const width = e.value == null ? 1.4 : 1 + 3 * Math.sqrt(Math.abs(e.value) / Math.max(1e-12, maxEdge));
		const ident = {
			kind: "edge",
			edge: idOf(e, `edge-${i}`),
			source: String(e.source),
			target: String(e.target),
			value: e.value
		};
		children.push(ctx.path(`M${pair(a.x, a.y)} Q${pair(mx, my)} ${pair(b.x, b.y)}`, {
			fill: "none",
			stroke: ctx.color("tone3"),
			"stroke-width": spec.variant === "membrane" ? Math.max(3, width * 3) : width,
			"stroke-opacity": spec.variant === "membrane" ? ".24" : ".58",
			"stroke-linecap": "round",
			meta: ident
		}));
		if (spec.directed) {
			const ux = (b.x - mx) / Math.max(1, Math.hypot(b.x - mx, b.y - my)), uy = (b.y - my) / Math.max(1, Math.hypot(b.x - mx, b.y - my));
			const radius = radiusFor(nodes.find((n) => n.id === e.target));
			const tipX = b.x - ux * radius, tipY = b.y - uy * radius, baseX = tipX - ux * 8, baseY = tipY - uy * 8;
			arrows.push(ctx.path(`M${pair(tipX, tipY)} L${pair(baseX - uy * 3.5, baseY + ux * 3.5)} L${pair(baseX + uy * 3.5, baseY - ux * 3.5)} Z`, {
				fill: ctx.color("tone3"),
				stroke: "none",
				meta: {
					...ident,
					kind: "arrow"
				}
			}));
		}
	}
	const labelGroups = {
		start: [],
		end: []
	};
	const labelFill = spec.variant === "membrane" ? ctx.textOn("tone3", {
		opacity: .24,
		over: "bg"
	}) : ctx.textOn("tone3", {
		opacity: .58,
		over: "bg"
	});
	for (const n of nodes) {
		const p = positions.get(n.id), radius = radiusFor(n);
		children.push(ctx.circle(p.x, p.y, radius, {
			fill: paletteColor(ctx, n.group),
			stroke: ctx.color("bg"),
			"stroke-width": radius ? 2 : 0,
			meta: {
				kind: "node",
				node: String(n.id),
				value: n.value,
				related: incident.get(n.id).map((e) => idOf(e, `edge-${edges.indexOf(e)}`))
			}
		}));
		if (denseForce && !labelledNodes.has(n.id)) continue;
		const weight = labelWeight(n);
		const leftRoom = Math.max(72, p.x - radius - 20);
		const rightRoom = Math.max(72, W - p.x - radius - 20);
		const side = denseForce ? leftRoom >= rightRoom ? "start" : "end" : p.x < cx ? "start" : "end";
		const maxWidth = Math.max(48, Math.min(160, side === "start" ? leftRoom : rightRoom));
		const lines = ctx.wrap(textOf(n), maxWidth, 12, weight);
		labelGroups[side].push({
			n,
			p,
			radius,
			lines,
			weight,
			top: p.y - (lines.length - 1) * 7
		});
	}
	const occupiedLabels = [];
	let labelFloor = 0;
	for (const side of ["start", "end"]) {
		const labels = labelGroups[side].sort((a, b) => a.top - b.top || stable(a.n.id, b.n.id));
		let previousBottom = 16;
		for (const item of labels) {
			const weight = item.weight;
			const measured = Math.max(12, ...item.lines.map((line) => ctx.measure(line, 12, weight)));
			const x = item.p.x + (side === "start" ? -item.radius - 8 : item.radius + 8);
			const anchor = side === "start" ? "end" : "start";
			const w = measured + 8;
			const h = item.lines.length * 14 + 4;
			let y0 = Math.max(item.top, previousBottom + 4);
			const left = anchor === "end" ? x - w + 3 : x - 3;
			const intersects = (y) => occupiedLabels.some((box) => left < box.x + box.w && left + w > box.x && y - 12 < box.y + box.h && y - 12 + h > box.y);
			while (intersects(y0)) y0 += 16;
			const box = {
				x: left,
				y: y0 - 12,
				w,
				h
			};
			occupiedLabels.push(box);
			labelFloor = Math.max(labelFloor, box.y + box.h);
			if (denseForce && Math.abs(y0 - item.top) > 8) children.push(ctx.line(item.p.x, item.p.y, anchor === "end" ? x + 3 : x - 3, box.y + h / 2, {
				stroke: ctx.color("tone3"),
				"stroke-width": .8
			}));
			children.push(ctx.rect(box.x, box.y, w, h, {
				fill: ctx.color("bg"),
				"fill-opacity": .92,
				rx: 2
			}));
			item.lines.forEach((line, i) => children.push(ctx.text(x, y0 + i * 14, line, {
				anchor,
				size: 12,
				weight,
				fill: labelFill,
				meta: {
					kind: "label",
					node: String(item.n.id)
				}
			})));
			previousBottom = y0 + (item.lines.length - 1) * 14;
		}
	}
	children.push(...arrows);
	let outputHeight = Math.max(H, labelFloor + 20);
	if (nodes.some((node) => node.value != null)) {
		const legend = ctx.lang.startsWith("en") ? "Node area ∝ value" : "节点面积 ∝ 数值";
		const circles = children.filter((child) => child.tag === "circle");
		const labels = children.filter((child) => child.tag === "text" && child.meta?.kind === "label");
		const nodeBottom = Math.max(0, ...circles.map((child) => child.attrs.cy + child.attrs.r));
		const labelBottom = Math.max(0, ...labels.map((child) => child.attrs.y + 3));
		const legendY = Math.max(nodeBottom, labelBottom) + 16;
		children.push(ctx.text(16, legendY, legend, {
			size: 12,
			fill: ctx.color("muted"),
			meta: { kind: "size-legend" }
		}));
		outputHeight = legendY + 12;
	}
	return withDescription(ctx, outputHeight, children, spec, W);
}
function networkStages(data) {
	const indegree = new Map(data.nodes.map((n) => [n.id, 0]));
	const next = new Map(data.nodes.map((n) => [n.id, []]));
	for (const e of data.edges) {
		next.get(e.source)?.push(e.target);
		if (indegree.has(e.target)) indegree.set(e.target, indegree.get(e.target) + 1);
	}
	const queue = data.nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id).sort(stable);
	const stage = new Map(data.nodes.map((n) => [n.id, 0]));
	while (queue.length) {
		const from = queue.shift();
		for (const to of next.get(from) || []) {
			stage.set(to, Math.max(stage.get(to), stage.get(from) + 1));
			indegree.set(to, indegree.get(to) - 1);
			if (indegree.get(to) === 0) {
				queue.push(to);
				queue.sort(stable);
			}
		}
	}
	return stage;
}
function sankeyCrossings(stages, order, edges, stageMap) {
	const rank = /* @__PURE__ */ new Map();
	for (const s of stages) order.get(s).forEach((n, i) => rank.set(n.id, i));
	let total = 0;
	for (let k = 0; k + 1 < stages.length; k++) {
		const list = edges.filter((e) => stageMap.get(e.source) === stages[k] && stageMap.get(e.target) === stages[k + 1]);
		for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
			const a = list[i], b = list[j];
			if ((rank.get(a.source) - rank.get(b.source)) * (rank.get(a.target) - rank.get(b.target)) < 0) total += a.value * b.value;
		}
	}
	return total;
}
function orderSankeyStages(stages, grouped, edges, stageMap) {
	const copy = (order) => new Map([...order].map(([s, list]) => [s, [...list]]));
	const cost = (order) => sankeyCrossings(stages, order, edges, stageMap);
	let best = copy(grouped), bestCost = cost(best);
	if (bestCost === 0) return best;
	const relative = (order) => {
		const at = /* @__PURE__ */ new Map();
		for (const s of stages) order.get(s).forEach((n, i, list) => at.set(n.id, (i + .5) / list.length));
		return at;
	};
	let current = copy(grouped);
	for (let sweep = 0; sweep < 8; sweep++) {
		const forward = sweep % 2 === 0;
		const sequence = forward ? stages.slice(1) : stages.slice(0, -1).reverse();
		for (const s of sequence) {
			const at = relative(current);
			const keyed = current.get(s).map((n, i) => {
				const linked = edges.filter((e) => forward ? e.target === n.id && stageMap.get(e.source) < s : e.source === n.id && stageMap.get(e.target) > s);
				const weight = linked.reduce((sum, e) => sum + e.value, 0);
				return {
					n,
					i,
					mean: weight ? linked.reduce((sum, e) => sum + e.value * at.get(forward ? e.source : e.target), 0) / weight : at.get(n.id)
				};
			});
			current.set(s, keyed.sort((a, b) => a.mean - b.mean || a.i - b.i).map((item) => item.n));
		}
		const c = cost(current);
		if (c < bestCost) {
			best = copy(current);
			bestCost = c;
		}
	}
	for (let pass = 0, improved = true; pass < 12 && improved && bestCost > 0; pass++) {
		improved = false;
		for (const s of stages) {
			const list = best.get(s);
			for (let i = 0; i + 1 < list.length; i++) {
				[list[i], list[i + 1]] = [list[i + 1], list[i]];
				const c = cost(best);
				if (c < bestCost) {
					bestCost = c;
					improved = true;
				} else [list[i], list[i + 1]] = [list[i + 1], list[i]];
			}
		}
	}
	return best;
}
var sankeyPresentation = Symbol("sankey presentation");
var sankeyCompact = Symbol("diagram sankey compact");
function sankey(spec, ctx) {
	const { nodes, edges } = spec.data;
	const budget = spec[sizeBudget] ?? {}, maxNodes = budget.nodes ?? 60, maxEdges = budget.edges ?? 120;
	if (nodes.length > maxNodes || edges.length > maxEdges) ctx.fit(`sankey超过${maxNodes}个节点或${maxEdges}条边`, "缩小数据范围后重试");
	const stageMap = nodes.every((n) => Number.isInteger(n.stage)) ? new Map(nodes.map((n) => [n.id, n.stage])) : networkStages(spec.data);
	const stages = [...new Set(nodes.map((n) => stageMap.get(n.id)))].sort((a, b) => a - b);
	const vertical = spec.layout === "down";
	const compact = spec[sankeyCompact] === true;
	const nodeSize = 18;
	const labelSize = 12;
	const labelCap = vertical ? 160 : 120;
	const showValues = spec.showValues !== false;
	const sum = (list) => list.reduce((total, e) => total + e.value, 0);
	const wrapped = new Map(nodes.map((n) => {
		const name = ctx.wrap(textOf(n), labelCap, labelSize, 400);
		const total = Math.max(sum(edges.filter((e) => e.target === n.id)), sum(edges.filter((e) => e.source === n.id)));
		const lines = showValues && name.length ? [...name, ctx.format(total, "edge.value")] : name;
		const width = Math.max(12, ...lines.map((line) => ctx.measure(line, labelSize, 400)));
		return [n.id, {
			lines,
			width,
			height: lines.length * 14,
			totalIndex: name.length ? name.length : -1
		}];
	}));
	const maxLabelLines = Math.max(1, ...[...wrapped.values()].map((item) => item.lines.length));
	const margin = vertical ? Math.max(28, (maxLabelLines - 1) * 7 + 6) : 28;
	const widestLabel = Math.max(12, ...[...wrapped.values()].map((item) => item.width));
	const lane = widestLabel + 16;
	const minSlot = vertical ? nodeSize + maxLabelLines * 14 + 16 : nodeSize + lane;
	const horizontalMinimum = stages.length === 1 ? margin * 2 + nodeSize + lane : margin * 2 + stages.length * (nodeSize + lane);
	const verticalMinimum = vertical ? Math.max(0, ...stages.map((stage) => {
		const row = nodes.filter((node) => stageMap.get(node.id) === stage);
		return row.reduce((sum, node) => sum + nodeSize + wrapped.get(node.id).width + 16, 0) + Math.max(0, row.length - 1) * 6 + margin * 2;
	})) : 0;
	const compactWidth = Math.min(720, Math.max(360, margin * 2 + widestLabel + stages.length * (nodeSize + lane)));
	const W = vertical ? Math.max(compact ? compactWidth : ctx.width, verticalMinimum) : Math.max(compact ? compactWidth : ctx.width, horizontalMinimum);
	Math.max(1, ...stages.map((stage) => nodes.filter((node) => stageMap.get(node.id) === stage).length));
	const labelStackHeight = Math.max(0, ...stages.map((stage) => nodes.filter((node) => stageMap.get(node.id) === stage).reduce((sum, node) => sum + wrapped.get(node.id).height + 4, 0)));
	const compactFlowTotal = Math.max(1, ...stages.map((stage) => edges.filter((edge) => stageMap.get(edge.source) === stage).reduce((total, edge) => total + edge.value, 0)));
	const compactHeight = Math.max(160, margin * 2 + labelStackHeight + 40, Math.min(300, 160 + Math.sqrt(compactFlowTotal) * 5));
	const H = vertical ? Math.max(compact ? 160 : 460, margin * 2 + stages.length * nodeSize + Math.max(0, stages.length - 1) * (maxLabelLines * 14 + 36) + 40) : compact ? compactHeight : Math.max(360, margin * 2 + labelStackHeight + 40);
	const axisStart = !vertical && stages.length === 1 ? Math.max(margin, lane + 8) : margin;
	const axisEnd = vertical ? H - margin - nodeSize : W - margin - nodeSize;
	const slot = stages.length > 1 ? Math.max(minSlot, (axisEnd - axisStart) / (stages.length - 1)) : 0;
	const stageAxes = vertical ? stages.map((_, index) => axisStart + index * slot) : stages.length === 1 ? [axisStart] : (() => {
		const gaps = stages.slice(1).map((_, index) => index === stages.length - 2 ? nodeSize + 2 * lane : minSlot);
		const extra = Math.max(0, (axisEnd - axisStart - gaps.reduce((sum, gap) => sum + gap, 0)) / gaps.length);
		const axes = [axisStart];
		for (const gap of gaps) axes.push(axes.at(-1) + gap + extra);
		return axes;
	})();
	const stageIndex = new Map(stages.map((s, i) => [s, i]));
	const stageOf = new Map(stageMap), routes = /* @__PURE__ */ new Map(), segments = [], lanes = [];
	edges.forEach((e, index) => {
		const chain = [e.source];
		for (let k = stageIndex.get(stageMap.get(e.source)) + 1; k < stageIndex.get(stageMap.get(e.target)); k++) {
			const id = `\u0000lane:${index}:${k}`;
			lanes.push({
				id,
				value: e.value
			});
			stageOf.set(id, stages[k]);
			chain.push(id);
		}
		chain.push(e.target);
		routes.set(e, chain.slice(1).map((target, i) => {
			const segment = {
				source: chain[i],
				target,
				value: e.value,
				edge: e
			};
			segments.push(segment);
			return segment;
		}));
	});
	const laneIds = new Set(lanes.map((lane) => lane.id));
	const incoming = new Map([...nodes, ...lanes].map((n) => [n.id, 0]));
	const outgoing = new Map([...nodes, ...lanes].map((n) => [n.id, 0]));
	for (const e of segments) {
		incoming.set(e.target, incoming.get(e.target) + e.value);
		outgoing.set(e.source, outgoing.get(e.source) + e.value);
	}
	const grouped = orderSankeyStages(stages, new Map(stages.map((s) => [s, [...nodes, ...lanes].filter((n) => stageOf.get(n.id) === s)])), segments, stageOf);
	const maxSum = Math.max(1, ...stages.map((s) => grouped.get(s).reduce((sum, n) => sum + Math.max(incoming.get(n.id), outgoing.get(n.id)), 0)));
	const maxCount = Math.max(1, ...stages.map((s) => grouped.get(s).length));
	const maxLabelled = Math.max(1, ...stages.map((s) => grouped.get(s).filter((n) => !laneIds.has(n.id)).length));
	const crossSpan = (vertical ? W : H) - margin * 2;
	const labelReserve = vertical ? widestLabel + 16 : 0;
	const unit = Math.max(0, crossSpan - labelReserve * maxLabelled - 8 * Math.max(0, maxCount - 1)) / maxSum;
	const pos = /* @__PURE__ */ new Map(), ports = /* @__PURE__ */ new Map();
	for (const s of stages) {
		const list = grouped.get(s);
		const sizes = list.map((n) => Math.max(incoming.get(n.id), outgoing.get(n.id))).map((amount) => amount * unit);
		const slots = sizes.map((size, index) => vertical && !laneIds.has(list[index].id) ? size + wrapped.get(list[index].id).width + 16 : size);
		const totalSlots = slots.reduce((sum, size) => sum + size, 0);
		const gap = list.length > 1 ? Math.max(6, Math.min(18, (crossSpan - totalSlots) / (list.length - 1))) : 0;
		let cursor = margin + (crossSpan - (totalSlots + gap * (list.length - 1))) / 2;
		list.forEach((n, i) => {
			const size = sizes[i], slotSize = slots[i];
			pos.set(n.id, vertical ? {
				x: cursor,
				y: stageAxes[stages.indexOf(s)],
				w: size,
				h: nodeSize,
				labelX: cursor + size / 2
			} : {
				x: stageAxes[stages.indexOf(s)],
				y: cursor,
				w: nodeSize,
				h: size,
				labelTop: cursor + 12
			});
			cursor += slotSize + gap;
		});
	}
	const center = (id) => {
		const p = pos.get(id);
		return vertical ? p.x + p.w / 2 : p.y + p.h / 2;
	};
	const segmentIndex = new Map(segments.map((e, i) => [e, i]));
	const offsets = new Map(segments.map((e) => [e, {
		source: 0,
		target: 0
	}]));
	for (const n of [...nodes, ...lanes]) ports.set(n.id, {
		in: 0,
		out: 0
	});
	for (const n of nodes) {
		const byOther = (side) => (a, b) => center(a[side]) - center(b[side]) || segmentIndex.get(a) - segmentIndex.get(b);
		for (const e of segments.filter((x) => x.source === n.id).sort(byOther("target"))) {
			offsets.get(e).source = ports.get(n.id).out;
			ports.get(n.id).out += e.value * unit;
		}
		for (const e of segments.filter((x) => x.target === n.id).sort(byOther("source"))) {
			offsets.get(e).target = ports.get(n.id).in;
			ports.get(n.id).in += e.value * unit;
		}
	}
	const children = [], readouts = [];
	const cubic = (a, b, c, d, t) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d;
	const at = (along, cross) => vertical ? pair(cross, along) : pair(along, cross);
	for (const e of edges) {
		const route = routes.get(e), thick = e.value * unit;
		const a = pos.get(e.source), b = pos.get(e.target);
		const stops = [vertical ? {
			a0: a.y + a.h,
			a1: a.y + a.h,
			c: a.x + offsets.get(route[0]).source
		} : {
			a0: a.x + a.w,
			a1: a.x + a.w,
			c: a.y + offsets.get(route[0]).source
		}];
		for (const segment of route.slice(0, -1)) {
			const lane = pos.get(segment.target);
			stops.push(vertical ? {
				a0: lane.y,
				a1: lane.y + lane.h,
				c: lane.x
			} : {
				a0: lane.x,
				a1: lane.x + lane.w,
				c: lane.y
			});
		}
		stops.push(vertical ? {
			a0: b.y,
			a1: b.y,
			c: b.x + offsets.get(route.at(-1)).target
		} : {
			a0: b.x,
			a1: b.x,
			c: b.y + offsets.get(route.at(-1)).target
		});
		let d = `M${at(stops[0].a1, stops[0].c)}`;
		for (let i = 1; i < stops.length; i++) {
			const prev = stops[i - 1], cur = stops[i], mid = (prev.a1 + cur.a0) / 2;
			d += ` C${at(mid, prev.c)} ${at(mid, cur.c)} ${at(cur.a0, cur.c)}`;
			if (cur.a1 > cur.a0) d += ` L${at(cur.a1, cur.c)}`;
		}
		d += ` L${at(stops.at(-1).a1, stops.at(-1).c + thick)}`;
		for (let i = stops.length - 1; i > 0; i--) {
			const prev = stops[i - 1], cur = stops[i], mid = (prev.a1 + cur.a0) / 2;
			if (cur.a1 > cur.a0) d += ` L${at(cur.a0, cur.c + thick)}`;
			d += ` C${at(mid, cur.c + thick)} ${at(mid, prev.c + thick)} ${at(prev.a1, prev.c + thick)}`;
		}
		d += " Z";
		const labelAt = (t) => {
			const i = t <= .5 ? 1 : stops.length - 1, prev = stops[i - 1], cur = stops[i], mid = (prev.a1 + cur.a0) / 2;
			const along = cubic(prev.a1, mid, mid, cur.a0, t), cross = cubic(prev.c, prev.c, cur.c, cur.c, t) + thick / 2;
			return vertical ? [cross, along + 4] : [along, cross + 4];
		};
		const ribbonColor = ctx.design[e[sankeyPresentation]] || ctx.color("tone2");
		children.push(ctx.path(d, {
			fill: ribbonColor,
			"fill-opacity": ".32",
			stroke: ribbonColor,
			"stroke-opacity": ".18",
			"stroke-width": ".6",
			meta: {
				kind: "edge",
				edge: String(e.id ?? `${e.source}-${e.target}`),
				source: String(e.source),
				target: String(e.target),
				value: e.value,
				...spec[sankeyPresentation] ? {
					from: String(e.source),
					to: String(e.target)
				} : {}
			}
		}));
		if (showValues && thick >= 16) readouts.push({
			edge: e,
			text: ctx.format(e.value, "edge.value"),
			labelAt
		});
	}
	if (!vertical) for (const stage of stages) {
		const labels = nodes.filter((node) => stageMap.get(node.id) === stage).map((node) => ({
			id: node.id,
			node,
			place: pos.get(node.id),
			box: wrapped.get(node.id),
			target: pos.get(node.id).labelTop
		}));
		for (const item of stackLabels(labels, (item) => item.box.height, 4, margin, H - margin)) item.place.labelTop = item.top;
	}
	const labelBands = nodes.map((node) => {
		const place = pos.get(node.id), box = wrapped.get(node.id);
		if (vertical) {
			const firstY = place.y + place.h / 2 - (box.lines.length - 1) * 7;
			return {
				left: place.x + place.w,
				top: firstY - 14,
				w: box.width + 16,
				h: box.height + 8
			};
		}
		return {
			left: stageMap.get(node.id) === stages.at(-1) || stages.length === 1 ? place.x - 16 - box.width : place.x + place.w,
			top: place.labelTop - 14,
			w: box.width + 16,
			h: box.height + 8
		};
	});
	const readoutFill = ctx.textOn("tone2", {
		opacity: .32,
		over: "bg"
	});
	const readoutBoxes = [];
	const nodeBoxes = nodes.map((node) => {
		const place = pos.get(node.id);
		return {
			left: place.x - 4,
			top: place.y - 4,
			w: place.w + 8,
			h: place.h + 8
		};
	});
	for (const { edge, text, labelAt } of readouts) {
		const w = ctx.measure(text, 12) + 8, h = 16;
		const hits = (candidate) => [
			...readoutBoxes,
			...labelBands,
			...nodeBoxes
		].some((box) => candidate.left < box.left + box.w && candidate.left + w > box.left && candidate.top < box.top + box.h && candidate.top + h > box.top);
		let best = null;
		for (const t of [
			.24,
			.3,
			.18,
			.36,
			.76,
			.7,
			.82,
			.64,
			.5,
			.44,
			.56
		]) {
			const [x, y] = labelAt(t);
			const candidate = {
				x,
				y,
				left: x - w / 2,
				top: y - 12,
				w,
				h
			};
			if (!hits(candidate)) {
				best = candidate;
				break;
			}
		}
		if (!best) continue;
		readoutBoxes.push(best);
		children.push(ctx.text(best.x, best.y, text, {
			anchor: "middle",
			size: 12,
			fill: readoutFill,
			meta: {
				kind: "edge-label",
				edge: String(edge.id ?? `${edge.source}-${edge.target}`),
				value: edge.value
			}
		}));
	}
	for (const n of nodes) {
		const p = pos.get(n.id), box = wrapped.get(n.id), related = edges.filter((e) => e.source === n.id || e.target === n.id).map((e) => String(e.id ?? `${e.source}-${e.target}`));
		const appearance = n[sankeyPresentation], start = children.length;
		children.push(ctx.rect(p.x, p.y, p.w, p.h, {
			rx: 3,
			fill: ctx.design[appearance?.status] || ctx.color("tone1"),
			"fill-opacity": ".85",
			meta: {
				kind: "node",
				node: String(n.id),
				stage: stageMap.get(n.id),
				related,
				...spec[sankeyPresentation] ? { id: String(n.id) } : {}
			}
		}));
		if (vertical) {
			const lines = box.lines;
			const x = p.x + p.w + 8;
			const firstY = p.y + p.h / 2 - (lines.length - 1) * 7;
			lines.forEach((line, i) => children.push(ctx.text(x, firstY + i * 14, line, {
				anchor: "start",
				size: labelSize,
				fill: ctx.color(i === box.totalIndex ? "muted" : "fg"),
				meta: {
					kind: i === box.totalIndex ? "node-total" : "label",
					node: String(n.id)
				}
			})));
		} else {
			const lastStage = stageMap.get(n.id) === stages.at(-1);
			const lines = box.lines;
			const inward = lastStage || stages.length === 1;
			const x = p.x + (inward ? -8 : p.w + 8);
			const anchor = inward ? "end" : "start";
			const firstY = p.labelTop;
			lines.forEach((line, i) => children.push(ctx.text(x, firstY + i * 14, line, {
				anchor,
				size: labelSize,
				fill: ctx.color(i === box.totalIndex ? "muted" : "fg"),
				...spec[sankeyPresentation] ? {} : {
					stroke: ctx.color("bg"),
					"stroke-width": 4,
					"stroke-linejoin": "round",
					"paint-order": "stroke"
				},
				meta: {
					kind: i === box.totalIndex ? "node-total" : "label",
					node: String(n.id)
				}
			})));
		}
		const link = appearance?.link;
		if (link) children.push(ctx.link(link.href, children.splice(start), link));
	}
	return withDescription(ctx, H, children, spec, W);
}
function threads(spec, ctx) {
	const { stages, nodes, paths } = spec.data;
	if (paths.length > 240 || nodes.length > 80 || stages.length > 8) ctx.fit("threads超过240条路径、80个节点或8个阶段", "缩小数据范围后重试");
	const vertical = spec.layout === "down";
	const stageLabelWidth = Math.max(0, ...stages.map((stage) => ctx.measure(String(stage.label ?? ""), 12, 400)));
	const margin = 64, crossMargin = vertical ? Math.max(margin, stageLabelWidth + 32) : margin;
	const stageIndex = new Map(stages.map((s, i) => [s.id, i]));
	const nodeMap = new Map(nodes.map((n) => [n.id, n]));
	const sortedPaths = [...paths].sort((a, b) => stable(a.id, b.id));
	const memberships = new Map(nodes.map((n) => [n.id, []]));
	for (const p of sortedPaths) for (const id of p.nodes) memberships.get(id)?.push(p);
	const maxStageLoad = Math.max(1, ...stages.map((stage) => paths.filter((p) => p.nodes.some((id) => nodeMap.get(id)?.stage === stage.id)).reduce((sum, p) => sum + (p.value ?? 1), 0)));
	const maxNodesPerStage = Math.max(1, ...stages.map((stage) => nodes.filter((node) => node.stage === stage.id).length));
	const laneWidth = vertical ? Math.max(96, Math.min(180, (ctx.width - 96) / Math.max(1, maxNodesPerStage))) : Math.max(96, Math.min(180, (ctx.width - 96) / Math.max(1, stages.length)));
	const labelLines = new Map(nodes.map((node) => [node.id, ctx.wrap(textOf(node), laneWidth, 12, 400)]));
	const measuredWidth = (lines) => Math.max(12, ...lines.map((line) => ctx.measure(line, 12, 400)));
	const maxLabelLines = Math.max(1, ...[...labelLines.values()].map((lines) => lines.length));
	const maxLabelWidth = Math.max(12, ...[...labelLines.values()].map(measuredWidth));
	const naturalLabelWidth = Math.max(12, ...nodes.map((node) => ctx.measure(textOf(node), 12, 400)));
	const axisLabelWidth = Math.max(maxLabelWidth, stageLabelWidth);
	const labelReserve = vertical ? Math.max(maxLabelWidth, naturalLabelWidth) * 2 + 24 : maxLabelLines * 16 + 8;
	const columnLane = vertical ? 0 : axisLabelWidth * 2 + 24;
	const flowBudget = Math.min(240, maxStageLoad * 2.5);
	const crossMinimum = 2 * crossMargin + maxNodesPerStage * labelReserve + flowBudget;
	const axisMinimum = 128 + axisLabelWidth + Math.max(0, stages.length - 1) * columnLane;
	const W = vertical ? Math.max(ctx.width, crossMinimum) : Math.max(ctx.width, axisMinimum);
	const H = vertical ? Math.max(420, stages.length * (28 + maxLabelLines * 28 + 44) + 80) : Math.max(300, crossMinimum + 32);
	const axisSpan = Math.max(columnLane, (vertical ? H : W) - 128 - (vertical ? 0 : axisLabelWidth));
	const crossSpan = (vertical ? W : H) - 2 * crossMargin;
	const axisDistance = stages.length > 1 ? axisSpan / (stages.length - 1) : axisSpan;
	const widestPath = Math.max(1, ...paths.map((path) => path.value ?? 1));
	const unit = Math.min(2.5, Math.max(0, crossSpan - maxNodesPerStage * labelReserve - 12 * (maxNodesPerStage - 1)) / maxStageLoad, axisDistance * .05 / widestPath);
	const positions = /* @__PURE__ */ new Map();
	for (const stage of stages) {
		const list = nodes.filter((node) => node.stage === stage.id).sort((a, b) => stable(a.id, b.id));
		const flowSizes = list.map((node) => memberships.get(node.id).reduce((sum, path) => sum + (path.value ?? 1) * unit, 0));
		const sizes = list.map((node, index) => (vertical ? Math.max(measuredWidth(labelLines.get(node.id)), ctx.measure(textOf(node), 12, 400)) + 16 : labelLines.get(node.id).length * 16 + 8) + flowSizes[index]);
		const gap = 8;
		let cursor = crossMargin;
		list.forEach((n, index) => {
			const pathsAtNode = memberships.get(n.id).sort((a, b) => stable(a.id, b.id)), total = sizes[index];
			const labelBand = vertical ? Math.max(measuredWidth(labelLines.get(n.id)), ctx.measure(textOf(n), 12, 400)) + 16 : labelLines.get(n.id).length * 16 + 8;
			const labelStart = cursor, flowStart = cursor + labelBand, flowTotal = flowSizes[index], cross = flowStart + flowTotal / 2;
			const axis = margin + (vertical ? 0 : axisLabelWidth / 2) + stageIndex.get(stage.id) * axisSpan / Math.max(1, stages.length - 1);
			positions.set(n.id, {
				axis,
				cross,
				paths: pathsAtNode,
				start: flowStart,
				labelStart,
				stride: Math.max(1, flowTotal / Math.max(1, pathsAtNode.length))
			});
			cursor += total + gap;
		});
	}
	const related = new Map(nodes.map((n) => [n.id, paths.filter((p) => p.nodes.includes(n.id)).map((p) => String(p.id))]));
	const pathRelated = new Map(paths.map((p) => [p.id, paths.filter((other) => other.id !== p.id && other.nodes.some((id) => p.nodes.includes(id))).map((other) => String(other.id)).sort(stable)]));
	const children = [];
	for (const p of sortedPaths) {
		const points = p.nodes.map((id) => {
			const node = positions.get(id);
			const at = node.paths.findIndex((candidate) => candidate.id === p.id);
			const precedingWidth = node.paths.slice(0, at).reduce((sum, candidate) => sum + (candidate.value ?? 1) * unit, 0);
			const cross = node.start + precedingWidth + (p.value ?? 1) * unit / 2;
			return vertical ? [cross, node.axis] : [node.axis, cross];
		});
		let d = `M${pair(...points[0])}`;
		for (let i = 1; i < points.length; i++) {
			const [x1, y1] = points[i - 1], [x2, y2] = points[i], m = vertical ? (y1 + y2) / 2 : (x1 + x2) / 2;
			d += vertical ? ` C${pair(x1, m)} ${pair(x2, m)} ${pair(x2, y2)}` : ` C${pair(m, y1)} ${pair(m, y2)} ${pair(x2, y2)}`;
		}
		children.push(ctx.path(d, {
			fill: "none",
			stroke: ctx.color("tone2"),
			"stroke-opacity": ".58",
			"stroke-width": Math.max(.8, (p.value ?? 1) * unit),
			"stroke-linecap": "round",
			"stroke-linejoin": "round",
			meta: {
				kind: "path",
				path: String(p.id),
				value: p.value ?? 1,
				related: pathRelated.get(p.id)
			}
		}));
	}
	const ordered = [...nodes].sort((a, b) => stable(nodeMap.get(a.id).stage, nodeMap.get(b.id).stage) || positions.get(a.id).labelStart - positions.get(b.id).labelStart);
	if (!vertical) for (const stage of stages) {
		const items = nodes.filter((node) => node.stage === stage.id).map((node) => ({
			id: node.id,
			place: positions.get(node.id),
			lines: labelLines.get(node.id),
			target: positions.get(node.id).labelStart + 12
		}));
		for (const item of stackLabels(items, (item) => item.lines.length * 14, 4, margin, H - margin)) item.place.labelStart = item.top - 12;
	}
	for (const n of ordered) {
		const p = positions.get(n.id);
		const x = vertical ? p.cross : p.axis, y = vertical ? p.axis : p.cross;
		children.push(ctx.circle(x, y, 3.5, {
			fill: ctx.color("tone1"),
			meta: {
				kind: "node",
				node: String(n.id),
				related: related.get(n.id)
			}
		}));
		const lines = labelLines.get(n.id);
		const textWidth = measuredWidth(lines);
		if (vertical) {
			const firstY = y - (lines.length - 1) * 7;
			children.push(ctx.rect(p.labelStart + 4, firstY - 12, textWidth + 8, lines.length * 14 + 4, {
				fill: ctx.color("bg"),
				stroke: "none",
				meta: {
					kind: "label-plate",
					node: String(n.id)
				}
			}));
			lines.forEach((line, i) => children.push(ctx.text(p.labelStart + 8, y - (lines.length - 1) * 7 + i * 14, line, {
				anchor: "start",
				size: 12,
				fill: ctx.color("fg"),
				stroke: ctx.color("bg"),
				"stroke-width": 4,
				"stroke-linejoin": "round",
				"paint-order": "stroke",
				meta: {
					kind: "label",
					node: String(n.id),
					related: related.get(n.id)
				}
			})));
		} else {
			children.push(ctx.rect(x - textWidth / 2 - 4, p.labelStart, textWidth + 8, lines.length * 14 + 4, {
				fill: ctx.color("bg"),
				stroke: "none",
				meta: {
					kind: "label-plate",
					node: String(n.id)
				}
			}));
			lines.forEach((line, i) => children.push(ctx.text(x, p.labelStart + 12 + i * 14, line, {
				anchor: "middle",
				size: 12,
				fill: ctx.color("fg"),
				stroke: ctx.color("bg"),
				"stroke-width": 4,
				"stroke-linejoin": "round",
				"paint-order": "stroke",
				meta: {
					kind: "label",
					node: String(n.id),
					related: related.get(n.id),
					width: textWidth
				}
			})));
		}
	}
	const graphEnd = Math.max(margin, ...[...positions.values()].map((p) => p.start + p.paths.reduce((sum, path) => sum + (path.value ?? 1) * unit, 0)));
	const labelBottom = vertical ? Math.max(margin, ...[...positions.values()].map((place) => place.axis + 12)) : Math.max(margin, ...nodes.map((node) => positions.get(node.id).labelStart + labelLines.get(node.id).length * 14));
	const stageLabelY = Math.max(graphEnd, labelBottom) + 24;
	stages.forEach((s, i) => {
		const axis = margin + (vertical ? 0 : axisLabelWidth / 2) + i * axisSpan / Math.max(1, stages.length - 1);
		children.push(ctx.text(vertical ? 18 : axis, vertical ? axis - 18 : stageLabelY, s.label, {
			anchor: vertical ? "start" : "middle",
			size: 12,
			fill: ctx.color("muted")
		}));
	});
	const placed = [...positions.values()];
	return withDescription(ctx, Math.max(vertical ? H : 0, vertical ? 0 : stageLabelY + 16, labelBottom, ...placed.map((place) => (vertical ? place.axis : place.cross) + 24)), children, spec, W);
}
function install({ register }) {
	register("network", network);
	register("sankey", sankey);
	register("threads", threads);
}
install({ register });
export { install, relations_exports, sankeyCompact, sankeyPresentation };
