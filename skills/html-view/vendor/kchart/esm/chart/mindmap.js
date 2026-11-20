import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { register } from "./registry.js";
import { statusMarks } from "../core/theme.js";
// src/chart/mindmap.js
var mindmap_exports = /* @__PURE__ */ __exportAll({
	install: () => install,
	mindmapPresentation: () => mindmapPresentation
});
var GAP_X = 44;
var COMPACT_GAP = 24;
var GAP_Y = 18;
var PAD_X = 14;
var TEXT_WIDTH = 220;
var MARGIN = 24;
var PLANS = [GAP_X, COMPACT_GAP].flatMap((gap) => [
	TEXT_WIDTH,
	190,
	160,
	140,
	120
].map((cap) => ({
	gap,
	cap
})));
var DIAGRAM_PLANS = [GAP_X, COMPACT_GAP].map((gap) => ({
	gap,
	cap: TEXT_WIDTH
}));
var mindLayouts = [
	"bilateral",
	"right",
	"left",
	"radial",
	"org",
	"brace",
	"fishbone",
	"timeline"
];
var treeLayouts = [
	"right",
	"left",
	"org",
	"brace"
];
var mindmapPresentation = Symbol("mindmap presentation");
var LEAF_LINE_GAP = 8;
var BRANCH_RADIUS = 7;
var hasFrame = (variant, depth, children) => depth === 0 || Boolean(children?.length) || variant === "cards";
var nodeTextX = (box, alignRight) => alignRight ? box.x + box.w - PAD_X : box.x + PAD_X;
var NODE_SHAPES = [
	"rounded",
	"rect",
	"circle",
	"hexagon",
	"bang",
	"cloud",
	"none"
];
var shapeOf = (source) => source.shape || "";
var OUTLINE_INSET = 9;
var frameOf = (shape, variant, depth, children) => shape === "none" ? false : shape ? true : hasFrame(variant, depth, children);
var pointsOf = (points) => points.map(([x, y]) => `${x},${y}`).join(" ");
function starPoints(x, y, w, h) {
	const ix0 = x + OUTLINE_INSET, ix1 = x + w - OUTLINE_INSET, iy0 = y + OUTLINE_INSET, iy1 = y + h - OUTLINE_INSET;
	const ox0 = x + 1, ox1 = x + w - 1, oy0 = y + 1, oy1 = y + h - 1;
	const stepsX = Math.min(6, Math.max(2, Math.round((ix1 - ix0) / 30)));
	const stepsY = Math.min(4, Math.max(2, Math.round((iy1 - iy0) / 24)));
	const zigzag = (ax, ay, bx, by, cx, cy, dx, dy, steps) => {
		const points = [];
		for (let i = 0; i <= steps; i += 1) {
			const t = i / steps;
			points.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
			if (i === steps) break;
			const u = (i + .5) / steps;
			points.push([cx + (dx - cx) * u, cy + (dy - cy) * u]);
		}
		return points;
	};
	return [
		...zigzag(ix0, iy0, ix1, iy0, ox0, oy0, ox1, oy0, stepsX),
		...zigzag(ix1, iy0, ix1, iy1, ox1, oy0, ox1, oy1, stepsY),
		...zigzag(ix1, iy1, ix0, iy1, ox1, oy1, ox0, oy1, stepsX),
		...zigzag(ix0, iy1, ix0, iy0, ox0, oy1, ox0, oy0, stepsY)
	];
}
function cloudPath(x, y, w, h) {
	const ix0 = x + OUTLINE_INSET, ix1 = x + w - OUTLINE_INSET, iy0 = y + OUTLINE_INSET, iy1 = y + h - OUTLINE_INSET;
	const ox0 = x + 1, ox1 = x + w - 1, oy0 = y + 1, oy1 = y + h - 1;
	const stepsX = Math.min(6, Math.max(2, Math.round((ix1 - ix0) / 34)));
	const stepsY = Math.min(4, Math.max(2, Math.round((iy1 - iy0) / 30)));
	const bumps = (ax, ay, bx, by, cx, cy, dx, dy, steps) => {
		let d = "";
		for (let i = 0; i < steps; i += 1) {
			const t0 = i / steps, t1 = (i + 1) / steps, mid = (t0 + t1) / 2;
			d += ` Q${cx + (dx - cx) * mid} ${cy + (dy - cy) * mid} ${ax + (bx - ax) * t1} ${ay + (by - ay) * t1}`;
		}
		return d;
	};
	return `M${ix0} ${iy0}` + bumps(ix0, iy0, ix1, iy0, ox0, oy0, ox1, oy0, stepsX) + bumps(ix1, iy0, ix1, iy1, ox1, oy0, ox1, oy1, stepsY) + bumps(ix1, iy1, ix0, iy1, ox1, oy1, ox0, oy1, stepsX) + bumps(ix0, iy1, ix0, iy0, ox0, oy1, ox0, oy0, stepsY) + " Z";
}
function circleFits(textW, textH, w, h) {
	const rx = w / 2 - 3, ry = h / 2 - 3;
	return rx > 0 && ry > 0 && (textW / 2 / rx) ** 2 + (textH / 2 / ry) ** 2 <= .95;
}
function outlineOf(ctx, node, box, style, meta) {
	const { x, y, w, h } = box, shape = node.shape;
	if (shape === "none") return [];
	if (shape === "rect") return [ctx.rect(x, y, w, h, {
		...style,
		rx: 1,
		meta
	})];
	if (shape === "circle") {
		const textH = node.lines.length * 16 + node.noteLines.length * 15;
		if (circleFits(node.contentW, textH, w, h)) return [ctx.shape("ellipse", {
			cx: x + w / 2,
			cy: y + h / 2,
			rx: w / 2,
			ry: h / 2,
			...style
		}, meta)];
		return [ctx.rect(x, y, w, h, {
			...style,
			rx: Math.min(w, h) / 2,
			meta
		})];
	}
	if (shape === "hexagon") {
		const cut = Math.min(h / 2, w / 3);
		return [ctx.shape("polygon", {
			points: pointsOf([
				[x + cut, y],
				[x + w - cut, y],
				[x + w, y + h / 2],
				[x + w - cut, y + h],
				[x + cut, y + h],
				[x, y + h / 2]
			]),
			...style
		}, meta)];
	}
	if (shape === "bang") return [ctx.shape("polygon", {
		points: pointsOf(starPoints(x, y, w, h)),
		...style
	}, meta)];
	if (shape === "cloud") return [ctx.path(cloudPath(x, y, w, h), {
		...style,
		"stroke-linejoin": "round",
		meta
	})];
	return [ctx.rect(x, y, w, h, {
		rx: node.depth === 0 ? 10 : 6,
		...style,
		meta
	})];
}
/** 按节点换行上限 cap 与层距 gap 排出整棵树，返回已平移到正坐标的节点框与内容宽度。 */
function arrange(spec, ctx, mode, { cap, gap }) {
	const nodes = [];
	const textWidth = cap - 28;
	function visit(source, parent = null, depth = 0) {
		if (source.icon) ctx.fit("此布局不支持节点图标", "删掉节点的 icon，保留文字标签");
		const shape = shapeOf(source);
		if (shape && !NODE_SHAPES.includes(shape)) ctx.fit(`不支持节点形状 ${shape}`, "选择受控形状或省略节点 shape");
		const weight = depth === 0 ? 650 : 500;
		const frame = frameOf(shape, spec.variant, depth, source.children);
		const textOnly = mode === "bilateral" && !frame;
		const decoration = source[mindmapPresentation], icon = decoration?.icon;
		const wrapOptions = { bounded: textOnly && !decoration };
		const marker = !icon && source.status ? statusMarks[source.status] : "";
		const markerWidth = icon ? 18 : marker ? ctx.measure(marker, 12, 700) + 6 : 0;
		const budget = decoration ? source.label.split(/\s+/).reduce((width, word) => /[A-Za-z]/.test(word) ? Math.max(width, Math.ceil(ctx.measure(word, 13, weight)) + 1) : width, textWidth - markerWidth) : textWidth - markerWidth;
		const lines = ctx.wrap(source.label, budget, 13, weight, wrapOptions);
		const noteLines = source.note ? ctx.wrap(source.note, textWidth, 12, 400, wrapOptions) : [];
		const widths = [...lines.map((s) => ctx.measure(s, 13, weight)), ...noteLines.map((s) => ctx.measure(s, 12, 400))];
		const measuredWidth = Math.max(...widths) + 28 + markerWidth;
		const n = {
			id: source.id || `n${nodes.length}`,
			label: source.label,
			note: source.note || "",
			status: source.status || "",
			marker,
			markerWidth,
			parent,
			depth,
			children: [],
			lines,
			noteLines,
			shape,
			frame,
			icon,
			link: decoration?.link,
			w: Math.max(70, textOnly || decoration ? measuredWidth : Math.min(cap, measuredWidth)),
			contentW: measuredWidth - 28,
			h: Math.max(34, lines.length * 17 + noteLines.length * 15 + 18)
		};
		nodes.push(n);
		n.children = (source.children || []).map((child) => visit(child, n, depth + 1));
		return n;
	}
	const root = visit(spec.data);
	const leaves = (n) => n.children.length ? n.children.reduce((sum, c) => sum + leaves(c), 0) : 1;
	const maxDepth = Math.max(...nodes.map((n) => n.depth));
	const maxH = Math.max(...nodes.map((n) => n.h));
	const pitch = maxH + GAP_Y;
	const coords = /* @__PURE__ */ new Map(), fishboneSpine = /* @__PURE__ */ new Map();
	let fishboneSpineEnd = 0;
	const place = (n, x, y) => coords.set(n, {
		x,
		y,
		cx: x + n.w / 2,
		cy: y + n.h / 2,
		w: n.w,
		h: n.h,
		contentW: n.contentW,
		frame: n.frame
	});
	const levelWidths = (group) => Array.from({ length: maxDepth + 1 }, (_, d) => Math.max(0, ...group.filter((n) => n.depth === d).map((n) => n.w)));
	const stack = (node, top, xOf) => {
		place(node, xOf(node), top + leaves(node) * pitch / 2 - node.h / 2);
		let at = top;
		for (const child of node.children) {
			stack(child, at, xOf);
			at += leaves(child) * pitch;
		}
	};
	if (mode === "right" || mode === "left" || mode === "brace") {
		const levelW = levelWidths(nodes), col = [0];
		for (let d = 0; d < maxDepth; d++) col[d + 1] = col[d] + levelW[d] + gap;
		stack(root, 0, (n) => mode === "left" ? -col[n.depth] - n.w : col[n.depth]);
	} else if (mode === "bilateral") {
		const sides = [[], []], mass = [0, 0];
		for (const child of root.children) {
			const side = mass[0] <= mass[1] ? 0 : 1;
			sides[side].push(child);
			mass[side] += leaves(child);
		}
		const subtree = (n) => [n, ...n.children.flatMap(subtree)];
		place(root, 0, -root.h / 2);
		sides.forEach((group, side) => {
			const levelW = levelWidths(group.flatMap(subtree)), start = [0, gap];
			for (let d = 1; d < maxDepth; d++) start[d + 1] = start[d] + levelW[d] + gap;
			let at = -mass[side] * pitch / 2;
			for (const node of group) {
				stack(node, at, (n) => side === 0 ? -start[n.depth] - n.w : root.w + start[n.depth]);
				at += leaves(node) * pitch;
			}
		});
	} else if (mode === "org" || mode === "timeline") {
		const subW = /* @__PURE__ */ new Map();
		const calcW = (node) => {
			const childW = node.children.reduce((sum, child) => sum + calcW(child), 0) + Math.max(0, node.children.length - 1) * gap;
			const width = Math.max(node.w, childW);
			subW.set(node, width);
			return width;
		};
		calcW(root);
		const levels = Array.from({ length: maxDepth + 1 }, (_, d) => Math.max(...nodes.filter((n) => n.depth === d).map((n) => n.h)));
		const levelY = [0];
		for (let d = 1; d <= maxDepth; d++) levelY[d] = levelY[d - 1] + levels[d - 1] + GAP_Y + (mode === "timeline" && d === 1 ? 24 : 0);
		const org = (node, left, depth, fixedY) => {
			const center = left + subW.get(node) / 2;
			place(node, center - node.w / 2, fixedY ?? levelY[depth]);
			let x = left;
			for (const child of node.children) {
				const childY = mode === "timeline" && depth === 0 ? levelY[1] + levels[1] + GAP_Y : void 0;
				org(child, x, depth + 1, childY);
				x += subW.get(child) + gap;
			}
		};
		org(root, 0, 0);
		if (mode === "timeline") {
			const stageGap = 36, baseline = maxH + 50;
			let x = root.w + (gap === GAP_X ? 100 : 28);
			for (const stage of root.children) {
				const positionStage = (node, left, depth) => {
					const center = left + subW.get(node) / 2;
					const y = depth === 1 ? baseline + (root.h - node.h) / 2 : baseline + Math.max(root.h, levels[1]) + GAP_Y + (depth - 2) * (maxH + GAP_Y);
					place(node, center - node.w / 2, y);
					let xx = left;
					for (const child of node.children) {
						positionStage(child, xx, depth + 1);
						xx += subW.get(child) + gap;
					}
				};
				positionStage(stage, x, 1);
				x += subW.get(stage) + stageGap;
			}
			place(root, 0, baseline);
		}
	} else if (mode === "radial") {
		const angleOf = /* @__PURE__ */ new Map();
		const assign = (node, lo, hi) => {
			angleOf.set(node, (lo + hi) / 2);
			const total = node.children.reduce((sum, child) => sum + leaves(child), 0) || 1;
			let cur = lo;
			for (const child of node.children) {
				const next = cur + (hi - lo) * leaves(child) / total;
				assign(child, cur, next);
				cur = next;
			}
		};
		assign(root, -Math.PI, Math.PI);
		const radiusOf = (node) => Math.hypot(node.w, node.h) / 2;
		const byDepth = Array.from({ length: maxDepth + 1 }, (_, d) => nodes.filter((n) => n.depth === d).sort((a, b) => angleOf.get(a) - angleOf.get(b)));
		const levelRadius = byDepth.map((level) => Math.max(0, ...level.map(radiusOf)));
		const radius = [0];
		place(root, -root.w / 2, -root.h / 2);
		for (let d = 1; d <= maxDepth; d++) {
			const level = byDepth[d];
			let need = radius[d - 1] + levelRadius[d - 1] + levelRadius[d] + 12;
			if (level.length > 1) level.forEach((node, index) => {
				const next = level[(index + 1) % level.length];
				const delta = (angleOf.get(next) - angleOf.get(node) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
				const chord = 2 * Math.sin(Math.min(Math.PI, delta) / 2);
				need = Math.max(need, (radiusOf(node) + radiusOf(next) + 12) / chord);
			});
			radius[d] = need;
			for (const node of level) {
				const a = angleOf.get(node);
				place(node, radius[d] * Math.cos(a) - node.w / 2, radius[d] * Math.sin(a) - node.h / 2);
			}
		}
	} else if (mode === "fishbone") {
		const baseY = 0, rootX = 0, cats = root.children;
		const column = cap + gap, pitchX = Math.max(column, ...cats.map((cat) => cat.w + gap));
		place(root, rootX, baseY - root.h / 2);
		for (let ci = 0; ci < cats.length; ci++) {
			const cat = cats[ci], sign = ci % 2 ? 1 : -1;
			const spineX = rootX + root.w + 48 + ci * pitchX;
			const branchNodes = [];
			const collectBranch = (node) => {
				for (const child of node.children) {
					branchNodes.push(child);
					collectBranch(child);
				}
			};
			collectBranch(cat);
			const branchGap = GAP_Y;
			const span = (node) => node.h + (node.children.length ? node.children.reduce((sum, child) => sum + span(child), 0) + node.children.length * branchGap : 0);
			const branchHeight = cat.children.reduce((sum, child) => sum + span(child), 0) + Math.max(0, cat.children.length - 1) * branchGap;
			const categoryY = baseY + sign * (root.h / 2 + 36 + Math.max(cat.h, branchHeight) / 2);
			fishboneSpine.set(cat, spineX);
			fishboneSpineEnd = spineX;
			place(cat, spineX + sign * 32 - cat.w / 2, categoryY - cat.h / 2);
			let cursor = sign > 0 ? categoryY + cat.h / 2 + branchGap : categoryY - cat.h / 2 - branchGap;
			const branch = (parent, depth) => {
				for (const child of parent.children) {
					const block = span(child);
					const y = sign > 0 ? cursor : cursor - child.h;
					place(child, spineX + depth * column, y);
					const next = sign > 0 ? cursor + child.h + branchGap : cursor - child.h - branchGap;
					const saved = cursor;
					cursor = next;
					branch(child, depth + 1);
					cursor = sign > 0 ? Math.max(cursor, saved + block + branchGap) : Math.min(cursor, saved - block - branchGap);
				}
			};
			branch(cat, 1);
		}
	}
	const minX = Math.min(...nodes.map((n) => coords.get(n).x)), minY = Math.min(...nodes.map((n) => coords.get(n).y));
	for (const n of nodes) {
		const p = coords.get(n);
		place(n, p.x + MARGIN - minX, p.y + MARGIN - minY);
	}
	for (const [cat, x] of fishboneSpine) fishboneSpine.set(cat, x + MARGIN - minX);
	const width = Math.ceil(Math.max(...nodes.map((n) => coords.get(n).x + n.w)) + MARGIN);
	return {
		nodes,
		root,
		coords,
		fishboneSpine,
		fishboneSpineEnd: fishboneSpineEnd + MARGIN - minX,
		gap,
		width
	};
}
function bilateralPath(a, b, parentIsRoot, gap, diagram) {
	const left = b.cx < a.cx, direction = left ? -1 : 1;
	const fromX = a.frame ? left ? a.x : a.x + a.w : parentIsRoot ? a.cx + direction * (a.contentW / 2 + LEAF_LINE_GAP) : nodeTextX(a, left) + direction * (a.contentW + LEAF_LINE_GAP);
	const childSide = left ? b.x + b.w : b.x;
	const toX = b.frame ? childSide : nodeTextX(b, left) - direction * LEAF_LINE_GAP;
	const start = `M${fromX} ${a.cy}`, end = `L${toX} ${b.cy}`;
	if (a.cy === b.cy) return `${start} ${end}`;
	if (diagram) {
		const control = childSide - direction * gap / 2;
		return `${start} C${control} ${(a.cy + b.cy) / 2} ${control} ${b.cy} ${toX} ${b.cy}`;
	}
	const turnX = childSide - direction * gap / 2;
	const dy = b.cy - a.cy, vertical = Math.sign(dy);
	const radius = Math.min(BRANCH_RADIUS, gap / 4, Math.abs(dy) / 2);
	return [
		start,
		`L${turnX - direction * radius} ${a.cy}`,
		`Q${turnX} ${a.cy} ${turnX} ${a.cy + vertical * radius}`,
		`L${turnX} ${b.cy - vertical * radius}`,
		`Q${turnX} ${b.cy} ${turnX + direction * radius} ${b.cy}`,
		end
	].join(" ");
}
function build(spec, ctx, isMindmap) {
	const mode = spec.layout || (isMindmap ? "bilateral" : "right");
	const variant = isMindmap ? spec.variant || "editorial" : "editorial";
	if (!(isMindmap ? mindLayouts : treeLayouts).includes(mode)) ctx.fit(`不支持布局 ${mode}`, "选择该图型的受控 layout");
	if (!["editorial", "cards"].includes(variant)) ctx.fit(`不支持变体 ${variant}`, "选择该图型的受控 variant");
	let plan;
	for (const option of spec[mindmapPresentation] ? DIAGRAM_PLANS : PLANS) {
		plan = arrange(spec, ctx, mode, option);
		if (plan.width <= ctx.width) break;
	}
	const { nodes, root, coords, fishboneSpine, fishboneSpineEnd } = plan;
	const rootPosition = coords.get(root);
	const edgeList = [];
	const boundary = (box, dx, dy) => {
		const sx = dx ? box.w / 2 / Math.abs(dx) : Infinity, sy = dy ? box.h / 2 / Math.abs(dy) : Infinity, t = Math.min(sx, sy);
		return {
			x: box.cx + dx * t,
			y: box.cy + dy * t
		};
	};
	for (const n of nodes) if (n.parent) {
		const a = coords.get(n.parent), b = coords.get(n);
		let d;
		if (mode === "bilateral") d = bilateralPath(a, b, n.parent === root, plan.gap, spec[mindmapPresentation]);
		else if (mode === "org") {
			const top = {
				x: a.cx,
				y: a.y + a.h
			}, bottom = {
				x: b.cx,
				y: b.y
			}, sharedY = (top.y + bottom.y) / 2;
			d = `M${top.x} ${top.y} L${top.x} ${sharedY} L${bottom.x} ${sharedY} L${bottom.x} ${bottom.y}`;
		} else if (mode === "fishbone" && n.parent === root) {
			const spineX = fishboneSpine.get(n), rootEdge = {
				x: a.x + a.w,
				y: a.cy
			}, branchEnd = boundary(b, spineX - b.cx, a.cy - b.cy);
			d = `M${rootEdge.x} ${rootEdge.y} L${spineX} ${rootEdge.y} L${branchEnd.x} ${branchEnd.y}`;
		} else {
			const dx = b.cx - a.cx, dy = b.cy - a.cy;
			const from = boundary(a, dx, dy), to = boundary(b, -dx, -dy);
			if (mode === "brace") {
				const trunk = Math.min(...n.parent.children.map((child) => coords.get(child).x)) - plan.gap / 2;
				const out = {
					x: a.x + a.w,
					y: a.cy
				}, into = {
					x: b.x,
					y: b.cy
				};
				d = `M${out.x} ${out.y} L${trunk} ${out.y} L${trunk} ${into.y} L${into.x} ${into.y}`;
			} else d = `M${from.x} ${from.y} L${to.x} ${to.y}`;
		}
		edgeList.push({
			from: n.parent.id,
			to: n.id,
			d,
			kind: mode,
			parent: n.parent,
			child: n
		});
	}
	const rootTone = ctx.frameTone(ctx.color("accent"), true), branchTone = ctx.frameTone(ctx.palette.accent);
	const svgNodes = [], rootText = ctx.textOn(rootTone);
	for (const n of nodes) {
		const p = coords.get(n), rootNode = n === root, card = variant === "cards";
		const framed = n.frame, first = svgNodes.length;
		const tone = spec[mindmapPresentation] && n.status ? ctx.design[n.status] : null;
		const nodeInk = rootNode && framed ? ctx.textOn(tone || rootTone) : ctx.color("fg");
		if (framed) {
			const fill = rootNode ? tone || rootTone : ctx.tint(ctx.palette.bg, tone || branchTone, card ? .035 : .12);
			const stroke = rootNode ? tone || rootTone : tone || (card ? ctx.color("axis") : ctx.tint(ctx.palette.bg, branchTone, .28));
			svgNodes.push(...outlineOf(ctx, n, p, {
				fill,
				stroke,
				"stroke-width": rootNode || card ? 1 : .8
			}, spec[mindmapPresentation] ? {
				kind: "node",
				id: n.id
			} : {
				kind: isMindmap ? "mindmap" : "tree",
				node: n.id,
				related: descendants(n)
			}));
		}
		const leftLeaf = mode === "bilateral" && !framed && p.cx < rootPosition.cx;
		const anchor = rootNode ? "middle" : leftLeaf ? "end" : "start";
		const tx = rootNode ? p.cx : framed ? p.x + Math.max(PAD_X, (n.w - n.contentW) / 2) : nodeTextX(p, leftLeaf);
		const labelX = rootNode ? tx + n.markerWidth / 2 : tx + (leftLeaf ? -n.markerWidth : n.markerWidth);
		const markerX = rootNode ? tx : tx + (leftLeaf ? -n.markerWidth / 2 : n.markerWidth / 2);
		const weight = rootNode ? 650 : 500;
		const labelStep = 16, total = n.lines.length * labelStep + n.noteLines.length * 15;
		const labelY = p.cy - total / 2 + 12;
		svgNodes.push(...ctx.textLines(labelX, labelY, n.lines, {
			anchor,
			size: 13,
			weight,
			fill: nodeInk,
			meta: {
				kind: isMindmap ? "mindmap" : "tree",
				node: n.id,
				related: descendants(n),
				role: "label"
			}
		}).children);
		if (n.marker) svgNodes.push(ctx.text(markerX, labelY, n.marker, {
			anchor: "middle",
			size: 12,
			weight: 700,
			fill: rootNode && framed ? rootText : ctx.textColor(ctx.design[n.status]),
			meta: {
				kind: isMindmap ? "mindmap" : "tree",
				node: n.id,
				related: descendants(n),
				role: "status",
				status: n.status
			}
		}));
		if (n.icon) {
			const [minX, minY, w, h] = String(n.icon.viewBox).split(/[\s,]+/).map(Number);
			const scale = 12 / Math.max(w, h);
			const gx = rootNode ? labelX - ctx.measure(n.lines[0], 13, weight) / 2 - 18 : leftLeaf ? tx - 12 : tx;
			svgNodes.push(ctx.el("g", { transform: `translate(${gx - minX * scale} ${labelY - 10 - minY * scale}) scale(${scale})` }, n.icon.elements.map(({ tag, attrs }) => ctx.shape(tag, {
				...attrs,
				...n.icon.set === "tabler" ? {
					fill: "none",
					stroke: nodeInk,
					"stroke-width": 2
				} : { fill: nodeInk }
			}))));
		}
		let y = labelY + n.lines.length * labelStep;
		for (const line of n.noteLines) {
			svgNodes.push(ctx.text(tx, y, line, {
				anchor,
				size: 12,
				fill: rootNode && framed ? rootText : ctx.color("muted"),
				meta: {
					kind: isMindmap ? "mindmap" : "tree",
					node: n.id,
					related: descendants(n),
					role: "note"
				}
			}));
			y += 15;
		}
		if (n.link) svgNodes.push(ctx.link(n.link.href, svgNodes.splice(first), n.link));
	}
	function descendants(n) {
		return [n.id, ...n.children.flatMap(descendants)];
	}
	const edgeTone = ctx.frameTone(ctx.color("tone5"));
	const paths = edgeList.map((e) => ctx.path(e.d, {
		fill: "none",
		stroke: edgeTone,
		"stroke-width": 1.4,
		"stroke-linecap": "round",
		"stroke-linejoin": "round",
		meta: spec[mindmapPresentation] ? {
			kind: "edge",
			from: e.from,
			to: e.to
		} : {
			kind: isMindmap ? "mindmap" : "tree",
			node: e.child.id,
			related: descendants(e.child),
			from: e.from,
			to: e.to
		}
	}));
	if (mode === "fishbone" && root.children.length) {
		const r = coords.get(root);
		const spine = `M${r.x + r.w} ${r.cy} L${Math.max(r.x + r.w, fishboneSpineEnd)} ${r.cy}`;
		paths.push(ctx.path(spine, {
			fill: "none",
			stroke: edgeTone,
			"stroke-width": 2,
			meta: {
				kind: isMindmap ? "mindmap" : "tree",
				node: root.id,
				related: descendants(root),
				role: "spine"
			}
		}));
	}
	const sceneNodes = nodes.map((n) => {
		const p = coords.get(n);
		return {
			id: n.id,
			x: p.x,
			y: p.y,
			w: n.w,
			h: n.h,
			parent: n.parent?.id || null,
			depth: n.depth,
			label: n.label,
			note: n.note,
			...n.status ? { status: n.status } : {}
		};
	});
	const pairs = mode === "bilateral" ? [] : edgeList.flatMap((e) => [...e.d.matchAll(/(?:M|L)\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]));
	return {
		width: Math.ceil(Math.max(...nodes.map((n) => coords.get(n).x + n.w), ...pairs.map((p) => p[0])) + MARGIN),
		height: Math.ceil(Math.max(...nodes.map((n) => coords.get(n).y + n.h), ...pairs.map((p) => p[1])) + MARGIN),
		title: spec.title || (isMindmap ? "Mindmap" : "Tree"),
		children: [...paths, ...svgNodes],
		nodes: sceneNodes,
		edges: edgeList.map(({ from, to, d, kind }) => ({
			from,
			to,
			d,
			kind
		})),
		layout: mode,
		variant,
		anchor: {
			x: rootPosition.cx,
			y: rootPosition.cy
		}
	};
}
function install({ register }) {
	register("mindmap", (spec, ctx) => build(spec, ctx, true));
	register("tree", (spec, ctx) => build(spec, ctx, false));
}
install({ register });
export { install, mindmapPresentation, mindmap_exports };
