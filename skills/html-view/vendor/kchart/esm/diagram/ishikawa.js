import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { labelIcon } from "./tree-family-icon.js";
import { resolveIconRef } from "../core/icons.js";
import { normalizeLabel } from "./label.js";
import { presentation } from "./presentation.js";
import { FONT, appearance, error, fallbackMeasure, warning, wrapText } from "./support.js";
// src/diagram/ishikawa.js
var ishikawa_exports = /* @__PURE__ */ __exportAll({ implementations: () => implementations });
var LEAN = Math.cos(82 * Math.PI / 180) / Math.sin(82 * Math.PI / 180);
var BODY = FONT.label.size;
var LINE = 15;
var HEAD_LINE = 18;
var HEAD_PAD_X = 16;
var HEAD_MIN_W = 96;
var HEAD_MIN_H = 44;
var CHIP_PAD_X = 10;
var CHIP_MIN_W = 72;
var CHIP_MIN_H = 30;
var LABEL_GAP = 12;
var LEAF_RUN = 34;
var BRANCH_RUN = 44;
var STEP_RUN = 18;
var SPINE_CLEAR = 26;
var SIB_GAP = 18;
var CHILD_GAP = 18;
var CHIP_GAP = 14;
var MIN_BONE = 122;
var CAT_PAD = 30;
var HEAD_GAP = 24;
var MARGIN = 24;
var NODE_CAP = 2e3;
var NODE_HINT = 60;
var CAPS = [
	220,
	190,
	160,
	140,
	120
];
function parse(source, info = {}) {
	const lang = info.lang || "zh";
	const firstLine = Number.isInteger(info.firstLine) ? info.firstLine : 2;
	const headerLine = Number.isInteger(info.headerLine) ? info.headerLine : Math.max(1, firstLine - 1);
	const errors = [];
	const rows = [];
	const look = presentation({ lang }), assets = /* @__PURE__ */ new Set();
	const asset = (issue) => {
		if (!assets.has(issue.message)) {
			assets.add(issue.message);
			errors.push(issue);
		}
	};
	const normalize = (raw, line) => {
		const refs = [];
		raw = raw.replace(/(?<![\w:/.-])(?:logos|mdi|tabler|simple-icons):[a-z\d-]+/gi, (ref) => {
			refs.push(ref);
			return "";
		});
		const value = normalizeLabel(raw, {
			lang,
			line
		});
		value.diagnostics.forEach(asset);
		let icon = value.icon;
		for (const ref of refs) {
			const resolved = resolveIconRef(ref);
			icon ??= resolved;
			if (!resolved) asset(warning("IGNORED_ASSET", lang, line, `未知图标 ${ref}`, `Unknown icon ${ref}`, "使用内置图标", "Use a supported icon"));
		}
		return {
			label: value.text,
			icon
		};
	};
	if (typeof info.params === "string" && info.params.trim() && !look.accept(info.params.trim(), headerLine)) rows.push({
		indent: 0,
		text: info.params.trim(),
		line: headerLine
	});
	for (const [index, raw] of String(source ?? "").split("\n").entries()) {
		if (!raw.trim() || /^\s*%%/.test(raw)) continue;
		const line = firstLine + index;
		if (look.accept(raw.trim(), line)) continue;
		const indent = /^[^\S\n]*/.exec(raw)[0].length;
		rows.push({
			indent,
			text: raw.slice(indent).trim(),
			line
		});
	}
	const problem = rows[0];
	if (!problem) {
		errors.push(error(lang, headerLine, "鱼骨图缺少问题（第一行）", "Ishikawa diagram has no problem line", "先写问题，再逐层缩进写原因", "Write the problem first, then indent its causes"));
		return {
			model: {
				kind: "ishikawa",
				title: "",
				root: {
					id: "root",
					label: "",
					line: headerLine,
					children: []
				},
				count: 0
			},
			errors
		};
	}
	const causes = rows.slice(1);
	const root = {
		id: "root",
		...normalize(problem.text, problem.line),
		line: problem.line,
		children: []
	};
	const base = causes.length ? causes[0].indent : 0;
	const stack = [{
		level: 0,
		node: root
	}];
	let count = 1;
	for (const row of causes) {
		if (count >= NODE_CAP) {
			errors.push(error(lang, row.line, `鱼骨图最多 ${NODE_CAP} 个原因`, `An Ishikawa diagram can contain at most ${NODE_CAP} causes`, "拆分鱼骨图，不要删除原因", "Split the diagram without dropping causes"));
			break;
		}
		const level = Math.max(1, row.indent - base + 1);
		while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
		const node = {
			id: `n${count}`,
			...normalize(row.text, row.line),
			line: row.line,
			children: []
		};
		stack[stack.length - 1].node.children.push(node);
		stack.push({
			level,
			node
		});
		count += 1;
	}
	const visit = (node) => {
		node.status = look.statusOf(node.id);
		node.link = look.linkOf(node.id);
		node.children.forEach(visit);
	};
	visit(root);
	errors.push(...look.diagnostics());
	return {
		model: {
			kind: "ishikawa",
			title: root.label,
			root,
			count
		},
		errors
	};
}
function assignBands(list, start) {
	let cursor = start;
	for (const [index, node] of list.entries()) {
		node.s = cursor + node.h / 2;
		cursor += node.h;
		if (node.children.length) cursor = assignBands(node.children, cursor + CHILD_GAP);
		if (index < list.length - 1) cursor += SIB_GAP;
	}
	return cursor;
}
function build(model, { cap, lang, measure, width }) {
	const errors = [];
	const ink = (value, font) => Math.max(0, measure(value, font));
	const wrap = (value, font) => wrapText(value, cap, font, (piece, spec) => measure(piece, spec));
	const headFont = {
		size: FONT.title.size,
		weight: FONT.title.weight
	};
	const bodyFont = {
		size: BODY,
		weight: 400
	};
	const chipFont = {
		size: BODY,
		weight: 600
	};
	const headLines = wrap(model.root.label, headFont);
	const iconSpace = (icon) => icon ? 20 : 0;
	const headW = Math.max(HEAD_MIN_W, Math.ceil(Math.max(0, ...headLines.map((line) => ink(line, headFont))) + 32 + iconSpace(model.root.icon)));
	const headH = Math.max(HEAD_MIN_H, headLines.length * HEAD_LINE + 28);
	if (headLines.length > 4) errors.push(warning("DIAGRAM_HINT", lang, model.root.line, `问题换成 ${headLines.length} 行，鱼头会很高`, `The problem label wraps to ${headLines.length} lines and makes a tall head`, "缩短问题描述", "Shorten the problem statement"));
	const nodeStatus = { root: model.root.status };
	const subtree = (from, depth) => {
		const lines = wrap(from.label, bodyFont);
		nodeStatus[from.id] = from.status;
		const node = {
			id: from.id,
			line: from.line,
			depth,
			icon: from.icon,
			status: from.status,
			link: from.link,
			lines,
			children: []
		};
		node.h = lines.length * LINE;
		node.w = Math.max(0, ...lines.map((line) => ink(line, bodyFont))) + iconSpace(from.icon);
		node.children = (from.children || []).map((child) => subtree(child, depth + 1));
		return node;
	};
	const categories = model.root.children.map((from, index) => {
		nodeStatus[from.id] = from.status;
		const lines = wrap(from.label, chipFont);
		return {
			id: from.id,
			line: from.line,
			icon: from.icon,
			status: from.status,
			link: from.link,
			index,
			dir: index % 2 === 0 ? -1 : 1,
			lines,
			chipW: Math.max(CHIP_MIN_W, Math.ceil(Math.max(0, ...lines.map((line) => ink(line, chipFont))) + 20 + iconSpace(from.icon))),
			chipH: Math.max(CHIP_MIN_H, lines.length * LINE + 12),
			children: (from.children || []).map((child) => subtree(child, 2))
		};
	});
	for (const category of categories) {
		const end = assignBands(category.dir < 0 ? [...category.children].reverse() : category.children, SPINE_CLEAR);
		category.reach = Math.max(MIN_BONE, end + CHIP_GAP + category.chipH);
	}
	const sides = [categories.filter((category) => category.dir < 0), categories.filter((category) => category.dir > 0)];
	for (const side of sides) {
		if (!side.length) continue;
		const reach = Math.max(...side.map((category) => category.reach));
		for (const category of side) category.reach = reach;
	}
	for (const category of categories) {
		const place = (node, parent) => {
			if (node.depth % 2 === 0) {
				node.y0 = node.s;
				node.x0 = parent === category ? -LEAN * node.s : parent.x1 - LEAN * (node.s - parent.y1);
				node.run = node.children.length ? Math.max(BRANCH_RUN, STEP_RUN * node.children.length) : LEAF_RUN;
				node.x1 = node.x0 - node.run;
				node.y1 = node.s;
			} else {
				const count = parent.children.length, k = parent.children.indexOf(node);
				node.y0 = parent.y1;
				node.x0 = parent.x1 + (parent.x0 - parent.x1) * (k + 1) / (count + 1);
				const end = node.children.length ? Math.max(node.s, ...node.children.map(deepest)) : node.s;
				node.y1 = end;
				node.x1 = node.x0 - LEAN * (end - node.y0);
			}
			node.children.forEach((child) => place(child, node));
		};
		category.children.forEach((node) => place(node, category));
		const leftOf = (node) => Math.min(node.x1 - LABEL_GAP - node.w, node.x0, node.x1, ...node.children.map(leftOf));
		const leaves = category.children.map(leftOf);
		const chipX = -LEAN * category.reach;
		category.leftRel = Math.min(chipX - category.chipW / 2, ...leaves);
		category.rightRel = Math.max(0, chipX + category.chipW / 2);
	}
	for (const side of sides) {
		const step = Math.max(0, ...side.slice(1).map((category, index) => category.rightRel - side[index].leftRel + CAT_PAD));
		side.forEach((category, index) => {
			category.ax = index ? side[index - 1].ax - step : -(category.rightRel + HEAD_GAP);
		});
	}
	const spineLeft = categories.length ? Math.min(...categories.map((category) => category.ax + Math.min(category.leftRel, -26))) : -26;
	const minX = Math.min(spineLeft, 0, ...categories.map((category) => category.ax + category.leftRel));
	const maxX = Math.max(headW, ...categories.map((category) => category.ax + category.rightRel));
	const above = Math.max(0, ...sides[0].map((category) => category.reach));
	const below = Math.max(0, ...sides[1].map((category) => category.reach));
	const minY = Math.min(-headH / 2, -above);
	const maxY = Math.max(headH / 2, below);
	const dx = MARGIN - minX;
	const dy = MARGIN - minY;
	const point = (relX, magnitude, dir) => [dx + relX, dy + dir * magnitude];
	const bones = [], chips = [], labels = [];
	for (const category of categories) {
		bones.push({
			id: `${category.id}-bone`,
			from: category.id,
			to: "root",
			main: true,
			points: [point(category.ax - LEAN * (category.reach - category.chipH), category.reach - category.chipH, category.dir), point(category.ax, 0, 1)]
		});
		chips.push({
			id: category.id,
			line: category.line,
			tone: category.index % 6,
			lines: category.lines,
			icon: category.icon,
			status: category.status,
			link: category.link,
			x: dx + category.ax - LEAN * category.reach - category.chipW / 2,
			y: dy + (category.dir < 0 ? -category.reach : category.reach - category.chipH),
			w: category.chipW,
			h: category.chipH
		});
		const walk = (node) => {
			bones.push({
				id: `${node.id}-bone`,
				from: node.parent || category.id,
				to: node.id,
				main: false,
				points: [point(category.ax + node.x0, node.y0, category.dir), point(category.ax + node.x1, node.y1, category.dir)]
			});
			labels.push({
				id: node.id,
				line: node.line,
				lines: node.lines,
				icon: node.icon,
				side: category.dir,
				status: node.status,
				link: node.link,
				x: dx + category.ax + node.x1 - LABEL_GAP,
				y: dy + category.dir * node.s
			});
			node.children.forEach(walk);
		};
		for (const node of category.children) {
			node.parent = category.id;
			const annotate = (child, parent) => {
				child.parent = parent.id;
				child.children.forEach((grand) => annotate(grand, child));
			};
			annotate(node, category);
			walk(node);
		}
	}
	if (model.count > NODE_HINT) errors.push(warning("LARGE_DIAGRAM", lang, model.root.line, `鱼骨图有 ${model.count} 个原因，建议拆分`, `The Ishikawa diagram has ${model.count} causes; consider splitting it`, "按类别拆成多张鱼骨图", "Split the diagram by category"));
	const natural = Math.ceil(maxX - minX + 48);
	if (model.count <= NODE_HINT && natural > width * 2) errors.push(warning("LARGE_DIAGRAM", lang, model.root.line, `鱼骨图需要 ${natural}px 宽，超过图框两倍`, `The Ishikawa diagram needs ${natural}px, more than twice the frame`, "加宽图框或拆分鱼骨图", "Widen the frame or split the diagram"));
	return {
		width: natural,
		height: Math.ceil(maxY - minY + 48),
		cap,
		nodeStatus,
		errors,
		head: {
			x: dx,
			y: dy - headH / 2,
			w: headW,
			h: headH,
			lines: headLines,
			icon: model.root.icon,
			link: model.root.link
		},
		spine: {
			x1: dx + spineLeft,
			y1: dy,
			x2: dx,
			y2: dy
		},
		bones,
		chips,
		labels
	};
}
var deepest = (node) => Math.max(node.s, ...node.children.map(deepest));
function layout(model, options = {}) {
	const measure = options.measure || fallbackMeasure;
	const width = Math.max(1, Number(options.width) || 800);
	const lang = options.lang || "zh";
	let plan = null;
	for (const cap of CAPS) {
		plan = build(model, {
			cap,
			lang,
			measure,
			width
		});
		if (plan.width <= width) break;
	}
	return plan;
}
function scene(plan, ctx) {
	const look = appearance(ctx);
	const ink = ctx.frameTone(ctx.color("fg"));
	const strong = ctx.frameTone(ctx.color("accent"), true);
	const tones = Array.from({ length: 6 }, (_, index) => ctx.frameTone(ctx.color(`tone${index + 1}`)));
	const arrowId = "ishikawa-arrow";
	const arrowEnd = `url(#${arrowId})`;
	const children = [ctx.el("defs", {}, [ctx.el("marker", {
		id: arrowId,
		viewBox: "0 0 8 8",
		refX: 8,
		refY: 4,
		markerWidth: 8,
		markerHeight: 8,
		markerUnits: "userSpaceOnUse",
		orient: "auto"
	}, [ctx.path("M0 0 L8 4 L0 8 Z", { fill: ink })])])];
	children.push(...plan.bones.map((bone) => ctx.path(`M${bone.points[0][0]} ${bone.points[0][1]} L${bone.points[1][0]} ${bone.points[1][1]}`, {
		fill: "none",
		stroke: bone.main ? ink : plan.nodeStatus?.[bone.to] ? ctx.frameTone(look[plan.nodeStatus[bone.to]]) : look.fg4,
		"stroke-width": bone.main ? 2 : 1.4,
		"stroke-linecap": "round",
		...bone.main ? { "marker-end": arrowEnd } : {},
		meta: {
			kind: "edge",
			from: bone.from,
			to: bone.to
		}
	})));
	children.push(ctx.line(plan.spine.x1, plan.spine.y1, plan.spine.x2, plan.spine.y2, {
		stroke: ink,
		"stroke-width": 2,
		"stroke-linecap": "round",
		"marker-end": arrowEnd,
		meta: {
			kind: "edge",
			from: "root",
			to: "root"
		}
	}));
	for (const chip of plan.chips) {
		const tone = tones[chip.tone];
		const chipFill = chip.status ? ctx.tint(look.bg, look[chip.status], .12) : ctx.tint(look.bg, tone, .07);
		const drawing = ctx.el("g", {}, [
			ctx.rect(chip.x, chip.y, chip.w, chip.h, {
				rx: look.radius,
				fill: chipFill,
				stroke: chip.status ? look[chip.status] : ctx.tint(look.bg, tone, .45),
				"stroke-width": 1,
				meta: {
					kind: "node",
					id: chip.id,
					label: chip.id
				}
			}),
			...chip.icon ? [labelIcon(ctx, chip.icon, chip.x + CHIP_PAD_X + 7, chip.y + chip.h / 2, 14, look.fg3)] : [],
			...chip.lines.map((line, index) => ctx.text(chip.x + chip.w / 2 + (chip.icon ? 10 : 0), chip.y + chip.h / 2 + (index - (chip.lines.length - 1) / 2) * LINE, line, {
				size: BODY,
				weight: 600,
				fill: look.fg1,
				anchor: "middle",
				"dominant-baseline": "central"
			}))
		]);
		children.push(chip.link ? ctx.link(chip.link.href, [drawing], chip.link) : drawing);
	}
	for (const group of plan.labels) {
		const widest = group.icon ? Math.max(0, ...group.lines.map((line) => ctx.measure(line, BODY, 400))) : 0;
		const drawing = ctx.el("g", {}, [...group.icon ? [labelIcon(ctx, group.icon, group.x - widest - 12, group.y, 14, look.fg3)] : [], ...group.lines.map((line, index) => ctx.text(group.x, group.y + (index - (group.lines.length - 1) / 2) * LINE, line, {
			size: BODY,
			weight: 400,
			fill: group.status ? ctx.textColor(look[group.status]) : look.fg2,
			anchor: "end",
			"dominant-baseline": "central"
		}))]);
		children.push(group.link ? ctx.link(group.link.href, [drawing], group.link) : drawing);
	}
	const headTone = plan.nodeStatus?.root;
	const headFill = headTone ? ctx.tint(look.bg, look[headTone], .12) : ctx.tint(look.bg, strong, .12);
	const headDrawing = ctx.el("g", {}, [
		ctx.rect(plan.head.x, plan.head.y, plan.head.w, plan.head.h, {
			rx: Math.min(plan.head.h / 2, look.radius + 10),
			fill: headFill,
			stroke: headTone ? look[headTone] : ctx.tint(look.bg, strong, .5),
			"stroke-width": 1.5,
			meta: {
				kind: "node",
				id: "root",
				label: "root"
			}
		}),
		...plan.head.icon ? [labelIcon(ctx, plan.head.icon, plan.head.x + HEAD_PAD_X + 7, plan.head.y + plan.head.h / 2, 14, look.fg3)] : [],
		...plan.head.lines.map((line, index) => ctx.text(plan.head.x + plan.head.w / 2 + (plan.head.icon ? 10 : 0), plan.head.y + plan.head.h / 2 + (index - (plan.head.lines.length - 1) / 2) * HEAD_LINE, line, {
			size: FONT.title.size,
			weight: FONT.title.weight,
			fill: ctx.textOn(headFill),
			anchor: "middle",
			"dominant-baseline": "central"
		}))
	]);
	children.push(plan.head.link ? ctx.link(plan.head.link.href, [headDrawing], plan.head.link) : headDrawing);
	return {
		width: plan.width,
		height: plan.height,
		title: plan.head.lines.join(" "),
		children,
		anchor: {
			x: plan.head.x + plan.head.w / 2,
			y: plan.head.y + plan.head.h / 2
		}
	};
}
var implementations = { ishikawa: {
	optionMode: "raw",
	parse,
	layout,
	scene,
	acceptsPresentation: true,
	honoredConfig: []
} };
export { implementations, ishikawa_exports };
