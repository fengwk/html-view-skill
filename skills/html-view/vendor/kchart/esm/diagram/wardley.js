import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { FONT, appearance, error, textBlock, warning } from "./support.js";
import { mapConfig, mapIcon, mapLabels } from "./map-label.js";
// src/diagram/wardley.js
var wardley_exports = /* @__PURE__ */ __exportAll({ implementations: () => implementations });
var DEC = String.raw`\d+\.\d+`;
var NUM = String.raw`\d+(?:\.\d+)?`;
var QUOTED = String.raw`"(?:\\.|[^"\\])*"`;
var NAME = String.raw`(?:${QUOTED}|[A-Za-z_](?:[\w()&]|-(?![-.>]))*(?:[ \t]+[A-Za-z(](?:[\w()&]|-(?![-.>]))*)*)`;
var pair = (number) => String.raw`\[\s*(${number})\s*,\s*(${number})\s*\]`;
var offset = String.raw`(?:\s+label\s*${pair("-?\\d+")})?`;
var sizePattern = new RegExp(String.raw`^size\s*${pair("\\d+")}$`);
var nodePattern = new RegExp(String.raw`^(component|anchor|note|accelerator|deaccelerator)\s+(${NAME})\s*${pair(DEC)}${offset}(?:\s+\((build|buy|outsource|market)\))?(?:\s+(inertia|\(inertia\)))?$`);
var childPattern = new RegExp(String.raw`^component\s+(${NAME})\s*\[\s*(${DEC})\s*\]${offset}$`);
var stagePattern = new RegExp(String.raw`^(${NAME})(?:\s*@\s*(${DEC}))?(?:\s*/\s*(${NAME}))?$`);
var pipelinePattern = new RegExp(String.raw`^pipeline\s+(${NAME})\s*\{$`);
var evolvePattern = new RegExp(String.raw`^evolve\s+(${NAME})\s+(${DEC})$`);
var pinPattern = new RegExp(String.raw`^annotation\s+(\d+)\s*,\s*${pair(NUM)}\s+(${QUOTED})$`);
var boxPattern = new RegExp(String.raw`^annotations\s*${pair(NUM)}$`);
var linkPattern = new RegExp(String.raw`^(${NAME})\s*(\+<>|\+>|\+<)?\s*(-->|-\.->|->|>|\+'([^']*)'(<>|<|>))?\s*(${NAME})\s*(\+<>|\+>|\+<)?\s*(?:;\s*(.+))?$`);
var defaults = [
	"Genesis",
	"Custom Built",
	"Product",
	"Commodity"
];
var strategyGlyphs = {
	build: "B",
	buy: "Y",
	outsource: "O",
	market: "M"
};
var strategyTones = {
	build: "tone1",
	buy: "tone2",
	outsource: "tone3",
	market: "tone4"
};
var readName = (name) => name.startsWith("\"") ? name.slice(1, -1).replace(/\\(["\\])/g, "$1") : name;
function parse(body, { lang, firstLine = 2, title = "", headerLine = 1 } = {}) {
	const model = {
		type: "wardley",
		title,
		size: null,
		stages: defaults.map((name) => ({
			name,
			secondName: null,
			boundary: null
		})),
		nodes: [],
		pipelines: [],
		links: [],
		trends: [],
		notes: [],
		annotations: [],
		annotationBox: null,
		forces: []
	};
	const errors = [], hints = /* @__PURE__ */ new Set(), nodes = /* @__PURE__ */ new Map();
	const normalize = mapLabels(lang, (item) => errors.push(item));
	const readLabel = (value, line) => normalize(readName(value), line);
	if (title) ({text: model.title, icon: model.titleIcon} = normalize(title, headerLine));
	const bad = (line, zh, en) => errors.push(error(lang, line, zh, en, "检查 Wardley 地图语法", "Check Wardley map syntax"));
	const hint = (key, line, zh, en) => {
		if (hints.has(key)) return;
		hints.add(key);
		errors.push(warning("DIAGRAM_HINT", lang, line, zh, en));
	};
	const percent = (raw, line) => {
		const value = Number(raw);
		if (value > 100) bad(line, "坐标超出 0–100 范围", "Coordinate is outside 0–100");
		return value <= 1 ? value * 100 : value;
	};
	const coords = (v, e, line) => ({
		visibility: percent(v, line),
		evolution: percent(e, line)
	});
	const labelOffset = (dx, dy) => dx == null ? null : {
		dx: +dx,
		dy: +dy
	};
	const add = (node) => {
		const previous = nodes.get(node.id);
		if (previous) {
			if (previous.visibility !== node.visibility || previous.evolution !== node.evolution) bad(node.line, `「${node.id}」有不同的坐标`, `Conflicting coordinates for "${node.id}"`);
			return;
		}
		nodes.set(node.id, node);
		model.nodes.push(node);
	};
	if (body.length > 2e5) {
		bad(firstLine, "地图源文本过长", "Map source exceeds 200,000 characters");
		return {
			model,
			errors
		};
	}
	const bareLinks = [];
	let pipeline = null, accessibility = false;
	for (const [index, raw] of body.split("\n").entries()) {
		const text = raw.match(/^(?:"(?:\\.|[^"\\])*"|\+'[^']*'|%(?!%)|[^"%])*/)[0].trim();
		const line = firstLine + index;
		if (!text) continue;
		let m;
		if (pipeline) {
			if (text === "}") {
				if (!pipeline.children.length) bad(line, "演进管道没有组件", "Pipeline needs at least one component");
				pipeline = null;
			} else if (m = childPattern.exec(text)) {
				const [, name, evo, dx, dy] = m, { text: label, icon } = readLabel(name, line);
				pipeline.children.push({
					id: `${pipeline.parent}_${readName(name)}`,
					name: readName(name),
					label,
					icon,
					evolution: percent(evo, line),
					labelOffset: labelOffset(dx, dy),
					kind: "pipeline",
					parent: pipeline.parent,
					line
				});
			} else bad(line, "无效的演进管道组件", "Invalid pipeline component");
			continue;
		}
		if (accessibility) {
			if (text.includes("}")) accessibility = false;
			continue;
		}
		if (m = /^title\s*:?[ \t]+(.+)$/.exec(text)) {
			if (!title) ({text: model.title, icon: model.titleIcon} = readLabel(m[1], line));
		} else if (/^acc(?:Title|Descr)\s*:/.test(text)) continue;
		else if (/^accDescr\s*\{/.test(text)) accessibility = !text.includes("}");
		else if (m = sizePattern.exec(text)) {
			model.size = {
				width: Number(m[1]),
				height: Number(m[2])
			};
			if (Object.values(model.size).some((n) => n > 16e3)) bad(line, "地图尺寸超过 16000 像素", "Map size exceeds 16,000 pixels");
		} else if (text.startsWith("evolution ")) {
			const parts = text.slice(10).match(/"(?:\\.|[^"\\])*"|->|[^"-]+|-/g) || [];
			const stages = [""];
			for (const part of parts) part === "->" ? stages.push("") : stages[stages.length - 1] += part;
			const matches = stages.map((stage) => stagePattern.exec(stage.trim()));
			if (matches.length < 2 || matches.some((match) => !match)) bad(line, "无效的演进阶段", "Invalid evolution stages");
			else {
				model.stages = matches.map(([, name, end, second]) => {
					const primary = readLabel(name, line), secondary = second ? readLabel(second, line) : null;
					return {
						name: primary.text,
						icon: primary.icon,
						secondName: secondary?.text ?? null,
						secondIcon: secondary?.icon,
						boundary: end == null ? null : percent(end, line)
					};
				});
				const ends = model.stages.map((stage) => stage.boundary);
				if (ends.some((end) => end !== null) && (ends.some((end, i) => end === null || end <= (ends[i - 1] ?? 0)) || ends.at(-1) !== 100)) {
					hint("stages", line, "阶段边界不完整或未递增至 100；使用等宽阶段", "Incomplete or unordered stage boundaries; using equal bands");
					for (const stage of model.stages) stage.boundary = null;
				}
			}
		} else if (m = nodePattern.exec(text)) {
			const [, kind, name, vis, evo, dx, dy, strategy, inertia] = m;
			const { text: label, icon } = readLabel(name, line), point = coords(vis, evo, line);
			if (kind !== "component" && (dx != null || strategy || inertia) || kind === "note" && !name.startsWith("\"")) bad(line, "无效的装饰或备注", "Invalid decorator or note");
			else if (kind === "note") model.notes.push({
				text: label,
				icon,
				...point,
				line
			});
			else if (kind.endsWith("accelerator")) model.forces.push({
				kind,
				name: label,
				icon,
				...point,
				line
			});
			else add({
				id: readName(name),
				label,
				icon,
				kind,
				...point,
				labelOffset: labelOffset(dx, dy),
				strategy: strategy ?? null,
				inertia: !!inertia,
				line
			});
		} else if (m = pipelinePattern.exec(text)) {
			pipeline = {
				parent: readName(m[1]),
				children: [],
				line
			};
			model.pipelines.push(pipeline);
		} else if (m = evolvePattern.exec(text)) model.trends.push({
			nodeId: readName(m[1]),
			targetEvolution: percent(m[2], line),
			line
		});
		else if (m = pinPattern.exec(text)) model.annotations.push({
			number: m[1],
			...coords(m[2], m[3], line),
			...readLabel(m[4], line),
			line
		});
		else if (m = boxPattern.exec(text)) {
			if (model.annotationBox) hint("box", line, "只使用第一个注释框", "Only the first annotation box is used");
			else model.annotationBox = coords(m[1], m[2], line);
		} else if ((m = linkPattern.exec(text)) && (m[2] || m[3] || m[7] || m[8] || m[1].startsWith("\"") || m[6].startsWith("\""))) {
			const [, from, sourcePort, arrow, flowLabel, arrowPort, to, targetPort, label] = m;
			const port = sourcePort || targetPort || arrowPort && `+${arrowPort}`;
			const { text: caption, icon } = readLabel(flowLabel ?? label ?? "", line);
			model.links.push({
				from: readName(from),
				to: readName(to),
				dashed: arrow === "-.->",
				flow: {
					"+>": "forward",
					"+<": "backward",
					"+<>": "bidirectional"
				}[port] || "none",
				label: caption,
				icon,
				line
			});
		} else bareLinks.push({
			text,
			line
		});
	}
	if (pipeline) bad(pipeline.line, "演进管道缺少结束括号", "Unclosed pipeline");
	for (const group of model.pipelines) {
		const parent = nodes.get(group.parent);
		if (parent?.kind !== "component") bad(group.line, `管道父级「${group.parent}」不是组件`, `Pipeline parent "${group.parent}" is not a component`);
		else for (const child of group.children) add({
			...child,
			visibility: parent.visibility
		});
	}
	const childNames = /* @__PURE__ */ new Map();
	for (const node of model.nodes) if (node.parent && !childNames.has(node.name)) childNames.set(node.name, node.id);
	const resolve = (id) => nodes.has(id) ? id : childNames.get(id) ?? id;
	for (const { text, line } of bareLinks) {
		let split;
		for (const { index, 0: gap } of text.matchAll(/\s+/g)) {
			const a = text.slice(0, index), b = text.slice(index + gap.length);
			if (nodes.has(resolve(a)) && nodes.has(resolve(b))) {
				split = [a, b];
				break;
			}
		}
		if (split) model.links.push({
			from: split[0],
			to: split[1],
			dashed: false,
			flow: "none",
			label: "",
			line
		});
		else bad(line, "无法识别 Wardley 地图语句", "Unrecognized Wardley map statement");
	}
	model.links.sort((a, b) => a.line - b.line);
	for (const link of model.links) {
		link.from = resolve(link.from);
		link.to = resolve(link.to);
		if (!nodes.has(link.from) || !nodes.has(link.to)) bad(link.line, "依赖引用未定义的节点", "Dependency references an undefined node");
	}
	for (const trend of model.trends) {
		trend.nodeId = resolve(trend.nodeId);
		if (!nodes.has(trend.nodeId)) hint("trend", trend.line, "演进引用未定义的组件", "Evolution references an undefined component");
	}
	if (model.nodes.length > 300 || model.links.length + model.trends.length > 600) bad(firstLine, "地图超过 300 个节点或 600 条连线，请拆分", "Split maps exceeding 300 nodes or 600 connections");
	return {
		model,
		errors
	};
}
var box = (x, y, w, h) => ({
	x,
	y,
	w,
	h
});
var centerBox = (x, y, w, h) => box(x - w / 2, y - h / 2, w, h);
var collides = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
var grow = (b, n) => box(b.x - n, b.y - n, b.w + n * 2, b.h + n * 2);
var length = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
function boxSpan(a, b, r) {
	let lo = 0, hi = 1;
	for (const [k, d] of [["x", "w"], ["y", "h"]]) {
		const delta = b[k] - a[k];
		if (!delta) {
			if (a[k] < r[k] || a[k] > r[k] + r[d]) return false;
			continue;
		}
		const p = (r[k] - a[k]) / delta, q = (r[k] + r[d] - a[k]) / delta;
		lo = Math.max(lo, Math.min(p, q));
		hi = Math.min(hi, Math.max(p, q));
		if (lo > hi) return false;
	}
	return [lo, hi];
}
var crosses = (a, b, r) => Boolean(boxSpan(a, b, r));
function visibleSpans(a, b, blockers, painted) {
	const dx = b.x - a.x, dy = b.y - a.y, span = dx * dx + dy * dy;
	if (!span) return [];
	const hidden = blockers.map((rect) => boxSpan(a, b, rect)).filter(Boolean);
	for (const pair of painted) {
		if (!pair.every((p) => Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) < 1e-5)) continue;
		const [lo, hi] = pair.map((p) => (dx * (p.x - a.x) + dy * (p.y - a.y)) / span).sort((x, y) => x - y);
		if (lo < 1 && hi > 0) hidden.push([Math.max(0, lo), Math.min(1, hi)]);
	}
	let cursor = 0;
	const visible = [];
	for (const [lo, hi] of [...hidden.sort((x, y) => x[0] - y[0]), [1, 1]]) {
		if (lo - cursor > 1e-7) visible.push([cursor, lo]);
		cursor = Math.max(cursor, hi);
	}
	return visible.map((pair) => pair.map((t) => ({
		x: a.x + t * dx,
		y: a.y + t * dy
	})));
}
var move = (a, b, distance) => {
	const t = distance / (length(a, b) || 1);
	return {
		x: a.x + (b.x - a.x) * t,
		y: a.y + (b.y - a.y) * t
	};
};
var arrowhead = (ctx, a, b, fill) => {
	const p = move(b, a, 7), dx = p.y - b.y, dy = b.x - p.x;
	return ctx.path(`M${b.x} ${b.y} L${p.x + dx * .48} ${p.y + dy * .48} L${p.x - dx * .48} ${p.y - dy * .48} Z`, { fill });
};
function layout(model, { width, lang, ctx }, info = {}) {
	const t = appearance(ctx), edge = ctx.color("muted"), grid = ctx.color("grid"), axis = t.fg4;
	const config = mapConfig(info.config, "wardley");
	const pad = 48;
	const stages = model.stages.map((stage) => [{
		text: stage.name,
		icon: stage.icon
	}, ...stage.secondName !== null ? [{
		text: stage.secondName,
		icon: stage.secondIcon
	}] : []].flatMap(({ text, icon }) => text.split("\n").map((row, i) => ({
		text: row,
		icon: i === 0 ? icon : null
	}))));
	const iconGap = (icon) => icon ? 20 : 0;
	const fractions = model.stages.map((stage, i) => (stage.boundary ?? 100 * (i + 1) / stages.length) / 100);
	const stageWidth = Math.max(...stages.map((rows, i) => (Math.max(...rows.map((row) => ctx.measure(row.text, FONT.label.size, 400) + iconGap(row.icon))) + 22) / (fractions[i] - (fractions[i - 1] || 0))));
	const dimension = (value, fallback) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(16e3, value)) : fallback;
	const W = Math.max(96 + stageWidth, 420, dimension(model.size?.width ?? mapConfig(config, "width"), 900));
	const right = W - pad, plotW = right - pad;
	const titleRows = model.title || model.titleIcon ? ctx.wrap(model.title, plotW - iconGap(model.titleIcon), FONT.title.size, FONT.title.weight) : [];
	const top = 48 + Math.max(0, titleRows.length - 1) * 16;
	const stagesExtra = Math.max(0, ...stages.map((rows) => rows.length - 2)) * 16;
	const H = Math.max(top + 212 + stagesExtra, dimension(model.size?.height ?? mapConfig(config, "height"), 600));
	const bottom = H - 86 - stagesExtra, plotH = bottom - top;
	const project = ({ evolution, visibility }) => ({
		x: pad + plotW * evolution / 100,
		y: bottom - plotH * visibility / 100
	});
	const nodes = new Map(model.nodes.map((node) => [node.id, {
		...node,
		...project(node),
		r: node.strategy ? 10 : 5
	}]));
	const guides = [], frames = [], lines = [], marks = [], labels = [], leaders = [];
	const obstacles = [], occupied = [], wires = [], annotations = model.annotations.slice().sort((a, b) => Number(a.number) - Number(b.number));
	const stroke = (color, extra = {}) => ({
		stroke: color,
		"stroke-width": 1,
		...extra
	});
	const line = (a, b, color, extra) => ctx.line(a.x, a.y, b.x, b.y, stroke(color, extra));
	const addLeader = (a, b) => {
		leaders.push(line(a, b, t.fg4, {
			"stroke-dasharray": "2 3",
			meta: { kind: "leader" }
		}));
		wires.push([a, b]);
	};
	const label = (x, y, rows, font = FONT.label, fill = t.fg1, anchor = "middle", meta) => textBlock(ctx, {
		x,
		y,
		lines: rows,
		font,
		fill,
		anchor,
		lineHeight: 16,
		meta
	});
	const caption = (x, y, rows, icon, font, fill = t.fg1, anchor = "middle") => {
		if (!icon) return label(x, y, rows, font, fill, anchor);
		const textW = Math.max(0, ...rows.map((row) => ctx.measure(row, font.size, font.weight)));
		const shift = iconGap(icon);
		return ctx.el("g", {}, [label(x + shift * (anchor === "middle" ? .5 : 1), y, rows, font, fill, anchor), mapIcon(ctx, icon, x - (anchor === "middle" ? (textW + shift) / 2 : 0) + 7, y, fill)]);
	};
	const bold = {
		...FONT.label,
		weight: 650
	};
	const pipelineEdges = [];
	for (const pipeline of model.pipelines) {
		const parent = nodes.get(pipeline.parent);
		const children = pipeline.children.map((child) => nodes.get(child.id)).filter(Boolean).sort((a, b) => a.x - b.x);
		if (!parent || !children.length) continue;
		const x = children[0].x - 16, w = children.at(-1).x - x + 16;
		parent.x = x + w / 2;
		parent.y -= 25;
		parent.square = true;
		frames.push(ctx.rect(x, children[0].y - 15, w, 30, {
			rx: t.smallRadius,
			fill: ctx.tint(t.bg, ctx.frameTone(ctx.color("tone1")), .07),
			stroke: ctx.tint(t.bg, ctx.frameTone(ctx.color("tone1")), .45),
			meta: {
				kind: "frame",
				id: pipeline.parent
			}
		}));
		for (let i = 1; i < children.length; i++) pipelineEdges.push({
			from: children[i - 1].id,
			to: children[i].id,
			dashed: true
		});
	}
	for (const node of nodes.values()) {
		obstacles.push(centerBox(node.x, node.y, node.r * 2, node.r * 2));
		if (node.inertia) obstacles.push(centerBox(node.x + node.r + 6, node.y, 3, 20));
	}
	const placeMarker = (item, radius) => {
		const p = project(item);
		const candidates = [p];
		for (const distance of [
			radius + 5,
			22,
			32,
			46,
			64
		]) for (const [dx, dy] of [
			[0, -1],
			[1, 0],
			[-1, 0],
			[0, 1],
			[1, -1],
			[-1, -1],
			[1, 1],
			[-1, 1]
		]) candidates.push({
			x: p.x + dx * distance,
			y: p.y + dy * distance
		});
		const blockers = [...obstacles, ...occupied];
		const { x, y } = candidates.find((q) => {
			const b = grow(centerBox(q.x, q.y, radius * 2, radius * 2), 3);
			return !blockers.some((o) => collides(b, o)) && !wires.some(([a, z]) => crosses(a, z, b)) && (q === p || !occupied.some((o) => crosses(p, q, grow(o, 2))));
		}) || p;
		obstacles.push(centerBox(x, y, radius * 2, radius * 2));
		if (x !== p.x || y !== p.y) addLeader(p, move({
			x,
			y
		}, p, radius));
		return {
			...item,
			x,
			y,
			radius
		};
	};
	const forces = model.forces.map((item) => {
		const p = project(item);
		obstacles.push(centerBox(p.x, p.y, 40, 20));
		return {
			...item,
			...p
		};
	});
	let footerY = H;
	function place(text, p, options = {}) {
		const { font = FONT.label, fill = t.fg1, radius = 6, preferred, fixed, plate, meta, icon } = options;
		const rows = ctx.wrap(text, Math.min(260, plotW / 2) - iconGap(icon), font.size, font.weight);
		const w = Math.max(...rows.map((row) => ctx.measure(row, font.size, font.weight))) + iconGap(icon) + (plate ? 14 : 4);
		const h = rows.length * 16 + (plate ? 6 : 2);
		const stepX = radius + w / 2 + 6, stepY = radius + h / 2 + 6;
		const candidates = preferred ? [preferred] : [];
		for (const gap of [
			0,
			12,
			26,
			44,
			68,
			98,
			136
		]) {
			const sides = [
				[stepX + gap, -gap / 4],
				[stepX + gap, -stepY - gap / 2],
				[-stepX - gap, 0],
				[0, stepY + gap],
				[0, -stepY - gap],
				[-stepX - gap, -stepY - gap / 2],
				[stepX + gap, stepY + gap / 2],
				[-stepX - gap, stepY + gap / 2]
			];
			if (options.above) sides.unshift(sides.splice(4, 1)[0]);
			for (const [dx, dy] of sides) candidates.push({
				x: p.x + dx,
				y: p.y + dy
			});
		}
		const leaderFor = (q) => {
			if (length(p, q) <= Math.hypot(stepX, stepY) + 10) return null;
			const scale = Math.min((w / 2 + 1) / Math.abs(q.x - p.x), (h / 2 + 1) / Math.abs(q.y - p.y));
			return [move(p, q, radius + 3), move(q, p, length(p, q) * scale)];
		};
		const fits = (q) => {
			const { x, y } = q;
			const leader = leaderFor(q);
			if (leader && [...obstacles, ...occupied].some((o) => crosses(...leader, grow(o, 2)))) return false;
			const b = grow(centerBox(x, y, w, h), 2);
			return b.x > 31 && b.x + b.w < W - 8 && b.y > top - 20 && b.y + b.h < bottom + 9 && !obstacles.some((o) => collides(b, o)) && !occupied.some((o) => collides(b, o)) && !wires.some(([a, z]) => crosses(a, z, b));
		};
		let chosen = fixed || candidates.find(fits);
		const leader = !fixed && chosen && leaderFor(chosen);
		if (leader) addLeader(...leader);
		if (!chosen) {
			chosen = {
				x: pad + w / 2,
				y: footerY + h / 2 + 4
			};
			footerY += h + 8;
		}
		const { x, y } = chosen, b = centerBox(x, y, w, h);
		occupied.push(b);
		const textNode = caption(x, y, rows, icon, font, fill);
		if (fixed && wires.some(([a, z]) => crosses(a, z, b))) labels.push(ctx.rect(b.x, b.y, b.w, b.h, {
			fill: t.bg,
			rx: t.smallRadius
		}));
		labels.push(plate ? {
			...ctx.el("g", {}, [ctx.rect(b.x, b.y, b.w, b.h, {
				fill: t.bg,
				stroke: grid,
				rx: t.smallRadius
			}), textNode]),
			...meta ? { meta } : {}
		} : textNode);
	}
	const pendingLabels = [], painted = [];
	const nodeBoxes = [...nodes.values()].map((node) => ({
		id: node.id,
		...grow(centerBox(node.x, node.y, node.r * 2, node.r * 2), 2)
	}));
	function connect(a, b, link, trend = false) {
		const color = trend ? t.danger : edge;
		const distance = length(a, b);
		const inset = (p, q) => p.r ? Math.min(distance / 2, (p.square || p.kind === "anchor" ? p.r * distance / Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y), 1e-9) : p.r) + 1) : 0;
		const start = move(a, b, inset(a, b)), end = move(b, a, inset(b, a));
		const visible = visibleSpans(start, end, nodeBoxes.filter((box) => box.id !== a.id && box.id !== b.id), painted);
		painted.push(...visible);
		wires.push(...visible);
		const path = visible.map(([p, q]) => `M${p.x} ${p.y} L${q.x} ${q.y}`).join(" ");
		if (path) {
			const edgePath = ctx.path(path, {
				fill: "none",
				...stroke(color, {
					"stroke-width": trend ? 1.5 : 1.2,
					...link.dashed || trend ? { "stroke-dasharray": trend ? "5 4" : "3 4" } : {},
					meta: {
						kind: "edge",
						from: a.id,
						to: b.id ?? `trend:${a.id}`
					}
				})
			});
			const clipped = visible.length !== 1 || length(visible[0][0], start) > 1e-5 || length(visible[0][1], end) > 1e-5;
			lines.push(!trend && clipped ? ctx.titled(edgePath, `${a.label} → ${b.label}`) : edgePath);
		}
		if (trend || link.flow === "forward" || link.flow === "bidirectional") lines.push(arrowhead(ctx, start, end, color));
		if (link.flow === "backward" || link.flow === "bidirectional") lines.push(arrowhead(ctx, end, start, color));
		if (link.label || link.icon) pendingLabels.push({
			link,
			point: move(start, end, length(start, end) / 2)
		});
	}
	const dependencies = [...pipelineEdges, ...model.links].map((link) => ({
		link,
		a: nodes.get(link.from),
		b: nodes.get(link.to)
	})).filter(({ a, b }) => a && b && a.parent !== b.id && b.parent !== a.id);
	dependencies.sort((p, q) => length(p.a, p.b) - length(q.a, q.b));
	for (const { a, b, link } of dependencies) connect(a, b, link);
	for (const { nodeId, targetEvolution } of model.trends) {
		const a = nodes.get(nodeId);
		if (!a) continue;
		connect(a, {
			x: project({
				evolution: targetEvolution,
				visibility: a.visibility
			}).x,
			y: a.y
		}, {}, true);
	}
	if (titleRows.length) guides.push(caption(W / 2, 23 + (titleRows.length - 1) * 8, titleRows, model.titleIcon, FONT.title));
	guides.push(ctx.line(pad, top, pad, bottom, stroke(axis)), ctx.line(pad, bottom, right, bottom, stroke(axis)));
	const axisMiddle = (top + bottom) / 2;
	guides.push(ctx.el("g", { transform: `rotate(-90 18 ${axisMiddle})` }, [label(18, axisMiddle, ["Visibility"], bold, t.fg2)]));
	guides.push(label((pad + right) / 2, bottom + 64 + stagesExtra, ["Evolution"], bold, t.fg2));
	stages.forEach((rows, i) => {
		const x = pad + plotW * (fractions[i - 1] || 0), end = pad + plotW * fractions[i];
		if (i) guides.push(ctx.line(x, top, x, bottom, stroke(grid)));
		rows.forEach(({ text, icon }, j) => guides.push(caption((x + end) / 2, bottom + 25 + j * 16, [text], icon, FONT.label, t.fg2)));
	});
	const placeComponent = (node) => {
		const fixed = node.labelOffset && {
			x: node.x + node.labelOffset.dx,
			y: node.y + node.labelOffset.dy
		};
		const above = node.kind === "anchor" || node.square;
		place(node.label, node, {
			radius: node.r,
			fixed,
			icon: node.icon,
			above,
			font: above ? bold : FONT.label
		});
	};
	for (const node of nodes.values()) if (node.labelOffset) placeComponent(node);
	const pins = annotations.map((item) => placeMarker(item, Math.max(9, ctx.measure(item.number, 12, 650) / 2 + 4)));
	const notes = model.notes.map((item) => placeMarker(item, 2));
	for (const { link, point } of pendingLabels) place(link.label, point, {
		plate: true,
		above: true,
		radius: 0,
		icon: link.icon,
		meta: {
			kind: "edge-label-group",
			from: link.from,
			to: link.to
		}
	});
	for (const node of nodes.values()) {
		const { x, y, r, id, strategy, inertia, square } = node, anchor = node.kind === "anchor";
		const meta = {
			kind: "node",
			id
		};
		const tone = ctx.frameTone(ctx.color(strategyTones[strategy] || "tone1"));
		const shape = {
			fill: anchor ? t.fg1 : strategy ? ctx.tint(t.bg, tone, .16) : t.node,
			stroke: ctx.frameTone(edge),
			"stroke-width": 1.4,
			meta
		};
		if (square) marks.push(ctx.rect(x - r, y - r, 2 * r, 2 * r, {
			...shape,
			rx: 2
		}));
		else if (anchor) marks.push(ctx.rect(x - r, y - r, 2 * r, 2 * r, {
			...shape,
			rx: 3
		}));
		else marks.push(ctx.circle(x, y, r, shape));
		if (strategy) marks.push(ctx.titled(label(x, y, [strategyGlyphs[strategy]], bold, ctx.textOn(shape.fill)), strategy));
		if (inertia) marks.push(ctx.rect(x + r + 4.5, y - 10, 3, 20, {
			rx: 1,
			fill: edge
		}));
		if (!node.labelOffset) placeComponent(node);
	}
	for (const note of notes) {
		marks.push(ctx.circle(note.x, note.y, 2, { fill: edge }));
		place(note.text, note, {
			plate: true,
			radius: 2,
			fill: t.fg2,
			icon: note.icon
		});
	}
	for (const f of forces) {
		const d = f.kind === "accelerator" ? 1 : -1;
		const points = [
			[-20, -5],
			[6, -5],
			[6, -10],
			[20, 0],
			[6, 10],
			[6, 5],
			[-20, 5]
		].map(([x, y]) => `${f.x + x * d},${f.y + y}`);
		marks.push(ctx.shape("polygon", {
			points: points.join(" "),
			fill: t.node,
			stroke: edge,
			"stroke-width": 1.3
		}));
		place(f.name, f, {
			preferred: {
				x: f.x,
				y: f.y + 24
			},
			radius: 20,
			icon: f.icon
		});
	}
	for (const pin of pins) {
		marks.push(ctx.circle(pin.x, pin.y, pin.radius, {
			fill: t.bg,
			stroke: edge,
			"stroke-width": 1.4
		}));
		marks.push(label(pin.x, pin.y, [pin.number], bold));
	}
	if (annotations.length) {
		const rows = annotations.flatMap(({ number, text, icon }) => ctx.wrap(`${number}. ${text}`, Math.min(270, plotW / 2) - iconGap(icon), 12).map((row, i) => ({
			row,
			icon: i === 0 ? icon : null
		})));
		const w = Math.max(...rows.map(({ row, icon }) => ctx.measure(row, 12, 400) + iconGap(icon))) + 28, h = rows.length * 16 + 35;
		const p = model.annotationBox ? project(model.annotationBox) : {
			x: right,
			y: bottom
		};
		const desired = box(Math.max(34, Math.min(W - w - 10, p.x)), Math.min(bottom - h - 5, p.y), w, h);
		const floating = width >= 480 && desired.y >= top && ![...obstacles, ...occupied].some((o) => collides(grow(desired, 4), o)) && !wires.some(([a, b]) => crosses(a, b, grow(desired, 3)));
		const r = floating ? desired : box(pad, footerY, w, h);
		if (!floating) footerY += h + 8;
		labels.push(ctx.rect(r.x, r.y, r.w, r.h, {
			rx: t.radius,
			fill: t.node,
			stroke: grid,
			meta: {
				kind: "frame",
				id: "annotations"
			}
		}), label(r.x + 14, r.y + 14, ["Annotations"], bold, t.fg1, "start"), ...rows.map(({ row, icon }, i) => caption(r.x + 14, r.y + 35 + i * 16, [row], icon, FONT.label, t.fg2, "start")));
	}
	const strategies = Object.keys(strategyGlyphs).filter((strategy) => model.nodes.some((node) => node.strategy === strategy));
	if (strategies.length) {
		const rows = ctx.wrap(strategies.map((strategy) => `${strategyGlyphs[strategy]} · ${strategy}`).join("     /     "), plotW, 12);
		labels.push(label(pad, footerY + rows.length * 8, rows, FONT.label, t.fg2, "start"));
		footerY += rows.length * 16 + 8;
	}
	const errors = W > width * 2 || nodes.size > 60 ? [warning("LARGE_DIAGRAM", lang, info.headerLine || 1, "地图较大，可拆成多张地图", "Large map; consider splitting it into smaller maps")] : [];
	return {
		scene: {
			width: W,
			height: footerY + 8,
			title: model.title || void 0,
			children: [
				...guides,
				...frames,
				...lines,
				...leaders,
				...marks,
				...labels
			]
		},
		errors
	};
}
var implementations = { "wardley-beta": {
	parse,
	layout,
	honoredConfig: ["wardley.width", "wardley.height"]
} };
export { implementations, wardley_exports };
