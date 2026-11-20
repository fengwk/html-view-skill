import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { repairRoutes } from "./graph-route.js";
// src/diagram/board-route.js
var board_route_exports = /* @__PURE__ */ __exportAll({ routeBoard: () => routeBoard });
var center = (box) => ({
	x: box.x + box.w / 2,
	y: box.y + box.h / 2
});
var straight = (a, b) => ({
	p0: a,
	c1: a,
	c2: b,
	p1: b
});
var BLOCKER = "\0blocker";
function routeBoard({ width, height, nodes, frames, blockers = [], edges }) {
	const boxes = new Map([...nodes, ...frames].map((box) => [box.id, box]));
	const routed = edges.map((edge) => {
		const a = center(boxes.get(edge.from)), b = center(boxes.get(edge.to));
		const segments = [straight(a, b)];
		return {
			id: edge.id,
			from: edge.from,
			to: edge.to,
			start: a,
			end: b,
			segments,
			initial: segments,
			...edge.label ? { labelRect: {
				w: edge.label.w,
				h: edge.label.h
			} } : {}
		};
	});
	const geometry = {
		type: "board",
		width,
		height,
		labels: [],
		edges: routed,
		nodes: [...nodes.map((node) => ({ ...node })), ...blockers.map((box, i) => ({
			...box,
			id: `${BLOCKER}${i}`
		}))],
		frames: frames.map((frame) => ({ ...frame }))
	};
	repairRoutes(geometry, new Map(routed.map((edge) => [edge.id, {
		from: edge.from,
		to: edge.to
	}])), { board: true });
	return {
		failed: routed.filter((edge) => edge.segments === edge.initial).map((edge) => edge.id),
		edges: routed.filter((edge) => edge.segments !== edge.initial).map((edge) => ({
			id: edge.id,
			points: [edge.segments[0].p0, ...edge.segments.map((segment) => segment.p1)],
			...edge.labelRect ? { labelRect: edge.labelRect } : {}
		}))
	};
}
export { board_route_exports, routeBoard };
