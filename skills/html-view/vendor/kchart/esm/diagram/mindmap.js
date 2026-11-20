import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { error, labelText, warning } from "./support.js";
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
	"elk",
	"cose-bilkent"
]);
var STATUSES = new Set(Object.keys(statusMarks));
var SHAPE_FORMS = [
	[
		"((",
		"))",
		"circle"
	],
	[
		"))",
		"((",
		"bang"
	],
	[
		"{{",
		"}}",
		"hexagon"
	],
	[
		"-)",
		"(-",
		"cloud"
	],
	[
		"(-",
		"-)",
		"cloud"
	],
	[
		"[",
		"]",
		"rect"
	],
	[
		"(",
		")",
		"rounded"
	],
	[
		")",
		"(",
		"cloud"
	]
];
var BRACKETS = /[()[\]{}]|-\)|\(-/;
var unquote = (value) => value.length > 1 && value.startsWith("\"") && value.endsWith("\"") ? value.slice(1, -1) : value;
function parseNodeText(raw) {
	const value = labelText(raw).trim();
	const start = value.search(BRACKETS);
	if (start < 0) return {
		label: unquote(value).trim(),
		shape: "none"
	};
	for (const [open, close, shape] of SHAPE_FORMS) {
		if (!value.startsWith(open, start) || !value.endsWith(close) || value.length < start + open.length + close.length) continue;
		return {
			label: unquote(value.slice(start + open.length, value.length - close.length).trim()).trim(),
			shape
		};
	}
	return {
		label: value,
		shape: ""
	};
}
function readRecords(lines, firstLine, lang, errors) {
	const records = [];
	for (let [index, raw] of lines.entries()) {
		if (!raw.trim() || raw.trimStart().startsWith("%%")) continue;
		const line = firstLine + index;
		if (/^[ \t]*\t/.test(raw)) {
			errors.push(error(lang, line, "缩进不能使用 Tab", "Tabs are not allowed in indentation", "把 Tab 换成空格", "Replace tabs with spaces"));
			continue;
		}
		const indent = raw.match(/^ */)[0].length;
		records.push({
			text: raw.slice(indent).trimEnd(),
			line,
			indent
		});
	}
	return records;
}
function parse(body, info = {}) {
	const lang = info.lang || "zh";
	const firstLine = Number.isInteger(info.firstLine) ? info.firstLine : 2;
	const headerLine = info.headerLine || firstLine - 1;
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
	const records = readRecords(lines, firstLine, lang, errors);
	const roots = [], stack = [], linesByPath = /* @__PURE__ */ new Map();
	let nodeCount = 0;
	for (const record of records) {
		while (stack.length && record.indent <= stack.at(-1).indent) stack.pop();
		const parent = stack.at(-1)?.node ?? null;
		const depth = stack.length;
		const { label, shape } = parseNodeText(record.text);
		nodeCount += 1;
		if (nodeCount === 81) addError(record.line, "脑图最多 80 个节点", "A mindmap can contain at most 80 nodes", "拆分脑图，不要删除节点", "Split the mindmap without dropping nodes");
		if (depth === 5) addError(record.line, "脑图最多 5 层（含根）", "A mindmap can have at most five levels including the root", "把节点移到更浅层，或拆分脑图", "Move the node up or split the mindmap");
		if (/:::(?:[\w-]+)?|::icon\(/i.test(record.text)) addError(record.line, "不支持行内节点装饰", "Inline node decorations are unsupported", "在节点下一行使用受控 :::状态 标记", "Use a supported :::status marker on the next line");
		if (!label) addError(record.line, "节点名称不能为空", "Node label cannot be empty");
		const node = {
			label,
			children: []
		};
		if (shape) node.shape = shape;
		const status = decorationByLine.get(record.line - firstLine);
		if (status) node.status = status;
		const sibling = parent ? parent.children.length : roots.length;
		linesByPath.set(parent ? `${stack.at(-1).path}/children/${sibling}` : `/roots/${sibling}`, record.line);
		const path = parent ? `${stack.at(-1).path}/children/${sibling}` : `/roots/${sibling}`;
		if (parent) parent.children.push(node);
		else if (roots.length) {
			addError(record.line, `mindmap 只能有一个根节点：「${label}」没有父节点`, `A mindmap can have only one root: "${label}" has no parent`, "把该节点缩进到更浅一级的节点下面", "Indent this node under a shallower node");
			roots[0].children.push(node);
		} else roots.push(node);
		stack.push({
			indent: record.indent,
			node,
			path
		});
	}
	if (!roots.length) addError(firstLine, "脑图中没有节点", "Mindmap is empty", "保留一个根节点并将其他节点缩进到它下面", "Keep one root node and indent all other nodes beneath it");
	const layoutValue = typeof info.layout === "string" ? info.layout : info.layout?.config?.layout ?? info.layout?.layout;
	let layout = "bilateral";
	if (layoutValue != null && layoutValue !== "") {
		const candidate = String(layoutValue).toLowerCase();
		if (LAYOUT_ALIASES.has(candidate)) layout = "bilateral";
		else if (LAYOUTS.includes(candidate)) layout = candidate;
		else errors.push(warning("IGNORED_CONFIG", lang, headerLine, `脑图布局「${layoutValue}」不生效；按 bilateral 排版`, `Mindmap layout "${layoutValue}" is not honored; laid out as bilateral`, "改用 bilateral、right、left、radial、org、brace、fishbone 或 timeline", "Use bilateral, right, left, radial, org, brace, fishbone, or timeline"));
	}
	for (const key of Object.keys(info.options || {})) addError(headerLine, `脑图头行不支持选项「${key}」`, `Mindmap header option is unsupported: ${key}`, "移除头行选项，使用 config.layout 指定布局", "Remove the header option; use config.layout to choose a layout");
	const data = roots[0] || { label: "" };
	if (linesByPath.has("/roots/0")) linesByPath.set("/data", linesByPath.get("/roots/0"));
	const spec = {
		chart: "mindmap",
		data,
		layout
	};
	if (info.title) spec.title = info.title;
	const checked = validate(spec);
	for (const issue of checked.errors) {
		if (issue.message === "超过80节点上限" || issue.message === "超过树深度上限") continue;
		let path = "", line = firstLine;
		for (const part of issue.path.split("/").slice(1)) {
			path += `/${part}`;
			if (linesByPath.has(path)) line = linesByPath.get(path);
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
	honoredConfig: ["layout", "mindmap.colorBy"],
	parse,
	layout,
	scene: (geometry) => geometry.scene
} };
export { implementations, mindmap_exports };
