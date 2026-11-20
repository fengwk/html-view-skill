import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { flowOutlineName, outlinePort, shapeOutline } from "./shapes.js";
// src/diagram/graph-route.js
var graph_route_exports = /* @__PURE__ */ __exportAll({ repairRoutes: () => repairRoutes });
var sides = [
	"top",
	"right",
	"bottom",
	"left"
];
var vertical = (side) => side === "top" || side === "bottom";
var distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
var expand = ({ x, y, w, h }, d) => ({
	x: x - d,
	y: y - d,
	w: w + d * 2,
	h: h + d * 2
});
var overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
function hits(a, b, rect) {
	let lo = 0, hi = 1;
	for (const [key, size] of [["x", "w"], ["y", "h"]]) {
		const min = rect[key], max = min + rect[size], d = b[key] - a[key];
		if (Math.abs(d) < 1e-8) {
			if (a[key] <= min || a[key] >= max) return false;
		} else {
			const p = (min - a[key]) / d, q = (max - a[key]) / d;
			lo = Math.max(lo, Math.min(p, q));
			hi = Math.min(hi, Math.max(p, q));
			if (lo >= hi) return false;
		}
	}
	return lo < hi;
}
function attachment(node, side, type, offset = 0) {
	const v = vertical(side), sign = side === "top" || side === "left" ? -1 : 1;
	const shape = !node.frame && (type === "flowchart" ? flowOutlineName(node.shape) : node.kind === "choice" ? "diam" : node.kind === "start" || node.kind === "end" ? "circle" : node.kind === "state" ? "rounded" : node.kind === "note" ? "note" : null);
	const plain = v ? {
		x: node.w / 2,
		y: sign < 0 ? 0 : node.h
	} : {
		x: sign < 0 ? 0 : node.w,
		y: node.h / 2
	};
	if (v) plain.x += node.w * offset;
	else plain.y += node.h * offset;
	const local = shape ? outlinePort(shapeOutline(shape, node.w, node.h, node.direction), side, v ? plain.x : plain.y) : plain;
	const port = {
		x: node.x + local.x,
		y: node.y + local.y
	};
	return {
		port,
		stub: v ? {
			x: port.x,
			y: node.y + (sign < 0 ? -10 : node.h + 10)
		} : {
			x: node.x + (sign < 0 ? -10 : node.w + 10),
			y: port.y
		}
	};
}
function straight(a, b) {
	return {
		p0: a,
		c1: a,
		c2: b,
		p1: b
	};
}
function sharesRun(a, b, p, q) {
	const same = (a, b) => Math.abs(a - b) < .01;
	const axis = same(a.x, b.x) && same(p.x, q.x) && Math.abs(a.x - p.x) <= 1 ? "y" : same(a.y, b.y) && same(p.y, q.y) && Math.abs(a.y - p.y) <= 1 ? "x" : null;
	return axis && Math.min(Math.max(a[axis], b[axis]), Math.max(p[axis], q[axis])) - Math.max(Math.min(a[axis], b[axis]), Math.min(p[axis], q[axis])) > 4;
}
function shortest(from, to, obstacles, occupied, type, bounds, label, original) {
	let best = null, score = Infinity;
	const candidates = (a, b, key, span) => {
		const midpoint = (a[key] + b[key]) / 2;
		return [.../* @__PURE__ */ new Set([
			midpoint,
			6,
			bounds[span] - 6,
			...obstacles.flatMap((r) => [r[key] - 1, r[key] + r[span] + 1])
		])].filter((x) => x >= 4 && x <= bounds[span] - 4).sort((x, y) => Math.abs(x - midpoint) - Math.abs(y - midpoint) || x - y).slice(0, 28);
	};
	const clear = (a, b) => !obstacles.some((r) => hits(a, b, r));
	const search = (source, target, startOffset, endOffset, detour) => {
		const { port: fromPort, stub: a } = attachment(from, source, type, startOffset);
		const { port: toPort, stub: b } = attachment(to, target, type, endOffset);
		if (!clear(fromPort, a) || !clear(b, toPort)) return;
		if (distance(fromPort, a) + distance(a, b) + distance(b, toPort) >= score) return;
		const validate = (mids) => {
			const points = [
				fromPort,
				a,
				...mids,
				b,
				toPort
			].filter((p, i, all) => !i || distance(p, all[i - 1]) > .001);
			let length = 0;
			for (let i = 1; i < points.length; i++) {
				length += distance(points[i - 1], points[i]);
				if (occupied.some((seg) => sharesRun(points[i - 1], points[i], seg.p0, seg.p1))) return;
				if (i > 1 && i < points.length - 1 && (hits(points[i - 1], points[i], expand(from, 4)) || hits(points[i - 1], points[i], expand(to, 4)))) return;
				if (i > 1 && i < points.length - 1 && !clear(points[i - 1], points[i])) return;
			}
			const compact = points.filter((p, i) => !i || i === points.length - 1 || Math.abs(distance(points[i - 1], p) + distance(p, points[i + 1]) - distance(points[i - 1], points[i + 1])) > .001 || points[i - 1].x !== points[i + 1].x && points[i - 1].y !== points[i + 1].y);
			const cost = length + (compact.length - 2) * 16;
			if (cost >= score) return;
			let labelRect = label;
			if (label) {
				const box = (p) => ({
					...label,
					x: p.x - label.w / 2,
					y: p.y - label.h / 2
				});
				const allowed = (box) => ![
					from,
					to,
					...obstacles
				].some((r) => overlaps(box, r));
				const legs = compact.slice(1).map((p, i) => [compact[i], p]).sort(([p, q], [r, s]) => distance(r, s) - distance(p, q));
				labelRect = null;
				for (const [p, q] of legs) {
					for (const f of [
						.5,
						.35,
						.65
					]) {
						const candidate = box({
							x: p.x + (q.x - p.x) * f,
							y: p.y + (q.y - p.y) * f
						});
						if (allowed(candidate)) {
							labelRect = candidate;
							break;
						}
					}
					if (labelRect) break;
				}
				if (!labelRect && original && allowed(label)) labelRect = label;
				if (!labelRect) return;
			}
			best = {
				start: fromPort,
				end: toPort,
				labelRect,
				segments: compact.slice(1).map((p, i) => straight(compact[i], p))
			};
			score = cost;
		};
		if (a.x === b.x || a.y === b.y) validate([]);
		validate([{
			x: a.x,
			y: b.y
		}]);
		validate([{
			x: b.x,
			y: a.y
		}]);
		const xs = candidates(a, b, "x", "w"), ys = candidates(a, b, "y", "h");
		for (const x of xs) validate([{
			x,
			y: a.y
		}, {
			x,
			y: b.y
		}]);
		for (const y of ys) validate([{
			x: a.x,
			y
		}, {
			x: b.x,
			y
		}]);
		if (detour && !best) {
			const near = (p, key, span) => candidates(p, p, key, span).slice(0, 7);
			const aX = near(a, "x", "w"), bX = near(b, "x", "w");
			const aY = near(a, "y", "h"), bY = near(b, "y", "h");
			for (const y of ys.slice(0, 8)) for (const x1 of aX) for (const x2 of bX) validate([
				{
					x: x1,
					y: a.y
				},
				{
					x: x1,
					y
				},
				{
					x: x2,
					y
				},
				{
					x: x2,
					y: b.y
				}
			]);
			for (const x of xs.slice(0, 8)) for (const y1 of aY) for (const y2 of bY) validate([
				{
					x: a.x,
					y: y1
				},
				{
					x,
					y: y1
				},
				{
					x,
					y: y2
				},
				{
					x: b.x,
					y: y2
				}
			]);
		}
	};
	for (const source of sides) for (const target of sides) search(source, target, 0, 0, false);
	for (const offset of [
		-.2,
		.2,
		-.35,
		.35
	]) {
		if (best) break;
		for (const source of sides) for (const target of sides) for (const [u, v] of [
			[offset, 0],
			[0, offset],
			[offset, offset]
		]) search(source, target, u, v, false);
	}
	for (const offset of [
		0,
		-.2,
		.2
	]) {
		if (best) break;
		for (const source of sides) for (const target of sides) search(source, target, offset, offset, true);
	}
	return best;
}
var curvePoint = ({ p0, c1, c2, p1 }, t) => {
	const u = 1 - t, at = (k) => u ** 3 * p0[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t ** 3 * p1[k];
	return {
		x: at("x"),
		y: at("y")
	};
};
function borders({ x, y, w, h }) {
	const a = {
		x,
		y
	}, b = {
		x: x + w,
		y
	}, c = {
		x: x + w,
		y: y + h
	}, d = {
		x,
		y: y + h
	};
	return [
		straight(a, b),
		straight(b, c),
		straight(c, d),
		straight(d, a)
	];
}
function repairRoutes(geometry, redirects = /* @__PURE__ */ new Map()) {
	const nodes = new Map(geometry.nodes.map((node) => [node.id, node]));
	const frames = new Map(geometry.frames.map((frame) => [frame.id, {
		...frame,
		frame: true
	}]));
	const endpoint = (id) => nodes.get(id) ?? frames.get(id);
	const ancestors = (node) => {
		const result = /* @__PURE__ */ new Set([node.id]);
		for (let id = node.parent; id; id = frames.get(id)?.parent) result.add(id);
		return result;
	};
	const checkTracks = nodes.size > 30;
	const pending = new Set(redirects.keys());
	const settled = [];
	for (const edge of geometry.edges) {
		if (edge.style === "invisible" || edge.self || !edge.segments?.length) continue;
		const redirect = redirects.get(edge.id);
		const from = endpoint(redirect?.from ?? edge.from), to = endpoint(redirect?.to ?? edge.to);
		if (!from || !to || from === to) continue;
		const exempt = /* @__PURE__ */ new Set([...ancestors(from), ...ancestors(to)]);
		const boxes = [...nodes.values(), ...frames.values()].filter((box) => !exempt.has(box.id));
		const obstacles = boxes.map((box) => expand(box, 5));
		const titles = [...frames.values()].flatMap((f) => f.titleRect && f.titleRect.w && f.titleRect.h ? [expand(f.titleRect, 5)] : []);
		const tight = [...boxes.map((r) => expand(r, 1.5)), ...titles];
		let collision = !!redirect;
		if (!collision) for (const seg of edge.segments) {
			let prev = seg.p0;
			for (let i = 1; i <= 5; i++) {
				const next = curvePoint(seg, i / 5);
				if (tight.some((r) => hits(prev, next, r))) {
					collision = true;
					break;
				}
				prev = next;
			}
			if (collision) break;
		}
		if (!collision && checkTracks) {
			const avoid = [
				...borders(from),
				...borders(to),
				...settled
			];
			collision = edge.segments.some((seg) => avoid.some((other) => sharesRun(seg.p0, seg.p1, other.p0, other.p1)));
		}
		if (!collision) {
			if (checkTracks) settled.push(...edge.segments);
			continue;
		}
		const labelObstacles = geometry.edges.filter((other) => other !== edge && other.labelRect).map((other) => expand(other.labelRect, 2));
		const occupied = geometry.edges.filter((other) => other !== edge && other.style !== "invisible" && !pending.has(other.id)).flatMap((other) => other.segments);
		const replacement = shortest(from, to, [
			...obstacles,
			...titles,
			...labelObstacles
		], occupied, geometry.type, {
			w: geometry.width,
			h: geometry.height
		}, edge.labelRect, !redirect);
		if (replacement) {
			pending.delete(edge.id);
			Object.assign(edge, replacement, {
				from: from.id,
				to: to.id,
				fromFrame: from.frame === true,
				toFrame: to.frame === true
			});
		}
		if (checkTracks) settled.push(...edge.segments);
	}
	return geometry;
}
export { graph_route_exports, repairRoutes };
