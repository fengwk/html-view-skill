import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { FONT, appearance, error, labelText, maxWidthOf, textBlock, warning, wrapText } from "./support.js";
// src/diagram/treeview.js
var treeview_exports = /* @__PURE__ */ __exportAll({ implementations: () => implementations });
var BRANCH = /^([ \t│┃]*)(?:[├└┣┗])[─━]*[ \t]*/;
var ANNOTATION = /[ \t]+(?=:::[ \t]*[A-Za-z_]|icon\(|##)/;
var MARGIN = 24;
var STEP = 24;
var columns = (str) => str.replaceAll("	", "    ").length;
function parse(body, { firstLine = 2, headerLine = 1, lang, params }) {
	const errors = [], rows = [{
		id: "root",
		label: "/",
		directory: true,
		depth: 0,
		description: ""
	}];
	const lines = String(body).split("\n").map((raw, index) => ({
		raw,
		line: firstLine + index
	})).filter(({ raw }) => raw.trim() && !raw.trimStart().startsWith("%%"));
	const unit = lines.map(({ raw }) => raw.match(BRANCH)).find((match) => match && columns(match[1]))?.[1];
	const box = lines.some(({ raw }) => BRANCH.test(raw));
	const stack = [], deferred = /* @__PURE__ */ new Map();
	let title;
	const fail = (line, zh, en) => errors.push(error(lang, line, zh, en, "检查树节点声明", "Check the tree node declaration"));
	if (params?.trim()) fail(headerLine, "树视图表头不接受参数", "Tree view header takes no parameters");
	for (const { raw, line } of lines) {
		const text = raw.trim();
		const heading = text.match(/^title(?:\s*:\s*|\s+)(.*)/i);
		if (heading) {
			title = labelText(heading[1]);
			continue;
		}
		const prefix = box ? raw.match(BRANCH) : null;
		if (box && /^[\s│┃]+$/.test(raw)) continue;
		if (box && !prefix && /^[ \t│┃]/.test(raw)) {
			fail(line, "缩进缺少树线前缀", "Unexpected indentation without box-drawing characters");
			continue;
		}
		if (prefix && !raw.slice(prefix[0].length).trim()) {
			fail(line, "树线后缺少文件或目录名", "Empty node: expected a filename or directory name after the box-drawing prefix");
			continue;
		}
		const indent = prefix ? Math.round(columns(prefix[1]) / (unit ? columns(unit) : 4)) + 1 : columns(raw.match(/^[ \t]*/)[0]);
		let value = prefix ? raw.slice(prefix[0].length).trim() : text;
		const quoted = value.match(/^(?:"([^"]*)"|'([^']*)')/);
		const boundary = value.search(ANNOTATION);
		const label = quoted ? quoted[1] ?? quoted[2] : (boundary < 0 ? value : value.slice(0, boundary)).trimEnd();
		value = quoted ? value.slice(quoted[0].length).trimStart() : boundary < 0 ? "" : value.slice(boundary).trimStart();
		let description = "", highlight = false, icon;
		while (value) {
			const cls = value.match(/^:::[ \t]*([A-Za-z_][\w-]*)/);
			const ico = value.match(/^icon\(([\w-]*(?::[\w-]+)?)\)/);
			if (value.startsWith("##")) {
				description = labelText(value.slice(2).trim());
				break;
			}
			if (cls) {
				if (cls[1] === "highlight") highlight = true;
				else {
					if (!deferred.has("IGNORED_STYLE")) deferred.set("IGNORED_STYLE", {
						line,
						names: /* @__PURE__ */ new Set()
					});
					deferred.get("IGNORED_STYLE").names.add(cls[1]);
				}
			} else if (ico) {
				icon = ico[1] || "none";
				if (icon !== "none") {
					if (!deferred.has("IGNORED_ASSET")) deferred.set("IGNORED_ASSET", {
						line,
						names: /* @__PURE__ */ new Set()
					});
					deferred.get("IGNORED_ASSET").names.add(icon);
				}
			} else {
				fail(line, "无法识别树节点注解", "Unrecognized tree node annotation");
				break;
			}
			value = value.slice((cls || ico)[0].length).trimStart();
		}
		while (stack.length && indent <= stack.at(-1).indent) stack.pop();
		const directory = label.endsWith("/");
		const row = {
			id: `row-${line}`,
			parent: stack.at(-1)?.id ?? "root",
			depth: stack.length + 1,
			indent,
			line,
			directory,
			label: labelText(directory && label !== "/" ? label.slice(0, -1) : label),
			description,
			highlight,
			icon
		};
		rows.push(row);
		stack.push(row);
		if (rows.length > 2001) {
			fail(line, "树节点最多支持 2000 个", "Tree view supports at most 2,000 entries");
			break;
		}
	}
	for (const [code, { line, names }] of deferred) {
		const list = [...names].join(", ");
		errors.push(warning(code, lang, line, `已省略树节点样式或图标：${list}`, `Omitted tree annotations: ${list}`, "移除这些标注", "Remove these annotations"));
	}
	return {
		model: {
			rows,
			title,
			headerLine
		},
		errors
	};
}
function layout(model, { width, measure, lang }) {
	const available = Math.max(120, width - 48);
	let rows, end;
	for (const cap of [
		220,
		190,
		160,
		140,
		120
	]) {
		rows = model.rows.map((row) => {
			const font = {
				...FONT.body,
				weight: row.directory ? 650 : 400
			};
			const lines = wrapText(row.label, cap, font, measure);
			const notes = row.description ? wrapText(row.description, 240, FONT.label, measure) : [];
			const x = MARGIN + STEP * row.depth;
			return {
				...row,
				font,
				lines,
				notes,
				x,
				labelEnd: x + maxWidthOf(lines, font, measure)
			};
		});
		end = Math.max(...rows.map((row) => row.labelEnd));
		if (end + MARGIN <= width) break;
	}
	const noteWidth = Math.max(0, ...rows.map((row) => maxWidthOf(row.notes, FONT.label, measure)));
	const inline = !noteWidth || end + 16 + noteWidth + MARGIN <= width + 240;
	const title = model.title ? wrapText(model.title, available, FONT.title, measure) : [];
	let y = MARGIN + (title.length ? title.length * 19 + 12 : 0);
	let right = Math.max(end, MARGIN + maxWidthOf(title, FONT.title, measure));
	for (const row of rows) {
		const labelH = row.lines.length * 17;
		const noteH = row.notes.length * 16;
		row.top = y;
		row.h = Math.max(24, (inline ? Math.max(labelH, noteH) : labelH + (noteH ? noteH + 4 : 0)) + 8);
		row.labelY = inline ? y + row.h / 2 : y + 4 + labelH / 2;
		row.noteY = inline ? row.labelY : y + 8 + labelH + noteH / 2;
		row.noteX = inline ? end + 16 : row.x;
		if (noteH) right = Math.max(right, row.noteX + maxWidthOf(row.notes, FONT.label, measure));
		y += row.h;
	}
	const naturalWidth = Math.ceil(right + MARGIN + 8);
	const errors = rows.length > 61 || naturalWidth > width * 2 ? [warning("LARGE_DIAGRAM", lang, model.headerLine, "树视图较大", "This tree view is large", "考虑拆分为多个树视图", "Consider splitting it into smaller trees")] : [];
	return {
		rows,
		title,
		width: naturalWidth,
		height: y + MARGIN,
		right,
		errors
	};
}
function scene(plan, ctx) {
	const A = appearance(ctx), { rows, right } = plan;
	const byId = new Map(rows.map((row) => [row.id, row]));
	const trunk = /* @__PURE__ */ new Map(), edges = [], labels = [];
	for (const row of rows) {
		const parent = byId.get(row.parent);
		if (parent) {
			const x = parent.x + 4, y = trunk.get(parent.id) ?? parent.top + parent.h;
			const armY = row.labelY;
			edges.push(ctx.path(`M${x} ${y} V${armY - 2} Q${x} ${armY} ${x + 2} ${armY} H${row.x - 5}`, {
				fill: "none",
				stroke: A.fg4,
				"stroke-width": 1,
				meta: {
					kind: "edge",
					from: parent.id,
					to: row.id
				}
			}));
			trunk.set(parent.id, armY);
		}
		const x = row.x - 3, y = row.top + 1, h = row.h - 2;
		labels.push(ctx.rect(x, y, (row.highlight ? right + 8 : row.labelEnd + 3) - x, h, {
			fill: row.highlight ? ctx.tint(A.bg, A.warn, .12) : "none",
			...row.highlight ? {
				stroke: ctx.frameTone(A.warn),
				rx: 3
			} : {},
			meta: {
				kind: "node",
				id: row.id
			}
		}));
		labels.push(textBlock(ctx, {
			x: row.x,
			y: row.labelY,
			lines: row.lines,
			font: row.font,
			anchor: "start",
			lineHeight: 17,
			fill: row.parent ? A.fg1 : ctx.color("muted")
		}));
		if (row.notes.length) labels.push(textBlock(ctx, {
			x: row.noteX,
			y: row.noteY,
			lines: row.notes,
			font: FONT.label,
			anchor: "start",
			lineHeight: 16,
			fill: ctx.color("muted")
		}));
	}
	if (plan.title.length) labels.push(textBlock(ctx, {
		x: MARGIN,
		y: MARGIN + plan.title.length * 19 / 2,
		lines: plan.title,
		font: FONT.title,
		anchor: "start",
		lineHeight: 19
	}));
	return {
		width: plan.width,
		height: plan.height,
		children: [...edges, ...labels]
	};
}
var implementations = { "treeView-beta": {
	optionMode: "raw",
	parse,
	layout,
	scene
} };
export { implementations, treeview_exports };
