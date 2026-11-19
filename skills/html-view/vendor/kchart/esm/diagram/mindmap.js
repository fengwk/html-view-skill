import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { error, labelText, parseIndented } from "./support.js";
import { statusMarks } from "../core/theme.js";
import { validate } from "../chart/spec.js";
import { layout as layout$1 } from "../chart/registry.js";
import "../chart/mindmap.js";
// src/diagram/mindmap.js
var mindmap_exports = /* @__PURE__ */ __exportAll({ implementations: () => implementations });
var LAYOUTS = [
	"bilateral",
	"right",
	"left",
	"radial",
	"org",
	"brace",
	"fishbone",
	"timeline"
];
var LAYOUT_ALIASES = /* @__PURE__ */ new Set([
	"tidy-tree",
	"dagre",
	"elk"
]);
var STATUSES = new Set(Object.keys(statusMarks));
var SHAPES = [
	["((", "))"],
	["{{", "}}"],
	["))", "(("],
	["[", "]"],
	["(", ")"],
	[")", "("]
];
function mindmapLabel(raw) {
	let value = labelText(raw).trim();
	for (const [open, close] of SHAPES) {
		const start = value.indexOf(open);
		if (start < 0 || !value.endsWith(close)) continue;
		const id = value.slice(0, start).trim();
		if (id && !/^[\w-]+$/.test(id)) continue;
		value = value.slice(start + open.length, -close.length).trim();
		break;
	}
	if (value.startsWith("\"") && value.endsWith("\"")) value = value.slice(1, -1);
	return value.trim();
}
function parse(body, info = {}) {
	const lang = info.lang || "zh";
	const firstLine = Number.isInteger(info.firstLine) ? info.firstLine : 2;
	const errors = [];
	const addError = (line, zh, en, fixZh = "修正脑图语法后重试", fixEn = "Correct the mindmap syntax and try again", column = 1) => {
		errors.push(error(lang, line, zh, en, fixZh, fixEn, column));
	};
	const lines = String(body ?? "").split("\n");
	const decorationByLine = /* @__PURE__ */ new Map();
	let previousNodeLine = -1;
	for (let i = 0; i < lines.length; i += 1) {
		const trimmed = lines[i].trim();
		if (!trimmed || trimmed.startsWith("%%")) continue;
		if (trimmed.startsWith(":::")) {
			const status = /^:::([\w-]+)$/.exec(trimmed)?.[1];
			lines[i] = "";
			if (previousNodeLine < 0) addError(firstLine + i, "状态标记前缺少节点", "A status marker must follow a node");
			else if (!status || !STATUSES.has(status)) addError(firstLine + i, `不支持状态标记「${trimmed}」`, `Unsupported status marker: ${trimmed}`, "只使用 :::new、:::info、:::ok、:::warn、:::danger 或 :::ext", "Use :::new, :::info, :::ok, :::warn, :::danger, or :::ext");
			else if (decorationByLine.has(previousNodeLine)) addError(firstLine + i, "一个节点只能有一个状态标记", "A node can have only one status marker");
			else decorationByLine.set(previousNodeLine, status);
			continue;
		}
		previousNodeLine = i;
	}
	const { items, errors: indentationErrors } = parseIndented(lines.join("\n"), {
		lang,
		firstLine,
		bullet: false
	});
	errors.push(...indentationErrors);
	if (items.length !== 1) addError(firstLine, items.length ? "mindmap 必须恰有一个根节点" : "脑图中没有节点", items.length ? "A mindmap must have exactly one root node" : "Mindmap is empty", "保留一个根节点并将其他节点缩进到它下面", "Keep one root node and indent all other nodes beneath it");
	const layoutValue = typeof info.layout === "string" ? info.layout : info.layout?.config?.layout ?? info.layout?.layout;
	let layout = "bilateral";
	if (layoutValue != null && layoutValue !== "") {
		const candidate = String(layoutValue).toLowerCase();
		if (LAYOUT_ALIASES.has(candidate)) layout = "bilateral";
		else if (LAYOUTS.includes(candidate)) layout = candidate;
		else addError(info.headerLine || firstLine - 1, `不支持脑图布局「${layoutValue}」`, `Unsupported mindmap layout: ${layoutValue}`, "选择 8 种受控布局之一", "Choose one of the eight supported layouts");
	}
	for (const key of Object.keys(info.options || {})) addError(info.headerLine || firstLine - 1, `脑图头行不支持选项「${key}」`, `Mindmap header option is unsupported: ${key}`, "移除头行选项，使用 config.layout 指定布局", "Remove the header option; use config.layout to choose a layout");
	const sourceLines = /* @__PURE__ */ new Map();
	let nodeCount = 0;
	function convert(item, path, depth) {
		const label = mindmapLabel(item.text);
		const node = { label };
		sourceLines.set(path, item.line);
		nodeCount += 1;
		if (nodeCount === 81) addError(item.line, "脑图最多 80 个节点", "A mindmap can contain at most 80 nodes", "拆分脑图，不要删除节点", "Split the mindmap without dropping nodes");
		if (depth === 5) addError(item.line, "脑图最多 5 层（含根）", "A mindmap can have at most five levels including the root", "把节点移到更浅层，或拆分脑图", "Move the node up or split the mindmap");
		if (/:::(?:[\w-]+)?|::icon\(/i.test(item.text)) addError(item.line, "不支持行内节点装饰", "Inline node decorations are unsupported", "在节点下一行使用受控 :::状态 标记", "Use a supported :::status marker on the next line");
		if (!label) addError(item.line, "节点名称不能为空", "Node label cannot be empty");
		const marker = decorationByLine.get(item.line - firstLine);
		if (marker) node.status = marker;
		node.children = item.children.map((child, i) => convert(child, `${path}/children/${i}`, depth + 1));
		if (!node.children.length) delete node.children;
		return node;
	}
	const spec = {
		chart: "mindmap",
		data: items[0] ? convert(items[0], "/data", 0) : { label: "" },
		layout
	};
	if (info.title) spec.title = info.title;
	const checked = validate(spec);
	for (const issue of checked.errors) {
		if (issue.message === "超过80节点上限" || issue.message === "超过树深度上限") continue;
		const parts = issue.path.split("/").slice(1);
		let path = "", line = firstLine;
		for (const part of parts) {
			path += `/${part}`;
			if (sourceLines.has(path)) line = sourceLines.get(path);
		}
		errors.push({
			...error(lang, line, issue.message, issue.message, issue.fix, issue.fix),
			code: issue.code,
			path: issue.path
		});
	}
	return {
		model: spec,
		errors
	};
}
function layout(model, options = {}) {
	const scene = layout$1(model, options.renderOptions || options);
	return {
		width: scene.width,
		height: scene.height,
		scene
	};
}
var implementations = { mindmap: {
	parse,
	layout,
	scene: (geometry) => geometry.scene
} };
export { implementations, mindmap_exports };
