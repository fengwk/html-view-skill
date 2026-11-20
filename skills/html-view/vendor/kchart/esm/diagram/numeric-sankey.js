import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { error, warning } from "./support.js";
import { numericLabel, renderWith, validateWith } from "./numeric-model.js";
import { presentation } from "./presentation.js";
import { sankeyPresentation } from "../chart/relations.js";
import { createRegistry, layouts } from "../chart/registry.js";
import { sizeBudget, validate as validate$1 } from "../chart/spec.js";
// src/diagram/numeric-sankey.js
var numeric_sankey_exports = /* @__PURE__ */ __exportAll({
	honoredConfig: () => honoredConfig,
	implementations: () => implementations
});
var MAX_NODES = 600;
var MAX_EDGES = 500;
var LARGE_NODES = 60;
var LARGE_EDGES = 120;
var issue = (info, line, zh, en, fixZh = "修正 Mermaid sankey 语法", fixEn = "Correct the Mermaid sankey syntax") => error(info.lang, line, zh, en, fixZh, fixEn);
var csv = (text) => {
	const cells = [];
	let value = "", quoted = false, after = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (quoted) {
			if (char === "\"" && text[i + 1] === "\"") {
				value += "\"";
				i += 1;
			} else if (char === "\"") {
				quoted = false;
				after = true;
			} else value += char;
		} else if (char === "\"") {
			if (value.trim() || after) return null;
			value = "";
			quoted = true;
		} else if (char === ",") {
			cells.push(value.trim());
			value = "";
			after = false;
		} else if (after && !/\s/.test(char)) return null;
		else value += char;
	}
	if (quoted) return null;
	cells.push(value.trim());
	return cells;
};
var value = (text) => {
	const parsed = Number.parseFloat(text);
	return Number.isFinite(parsed) ? parsed : null;
};
var configValue = (config, name) => {
	if (!config || typeof config !== "object" || Array.isArray(config)) return void 0;
	const key = Object.keys(config).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
	return key === void 0 ? void 0 : config[key];
};
var configFlag = (config, name) => {
	const found = configValue(config, name);
	return typeof found === "boolean" ? found : void 0;
};
function parseSankey(source, info) {
	const errors = [], rows = [], nodes = [];
	const look = presentation({ lang: info.lang });
	const header = String(info.params || Object.keys(info.options || {}).join(" ")).replace(/\s*:\s*$/, "").trim();
	if (header) errors.push(issue(info, info.headerLine || info.firstLine, `sankey 不支持头行选项「${header}」`, `sankey does not accept header options: ${header}`, "把配置写在前言区 sankey: 下", "Put options under front matter sankey:"));
	String(source).split("\n").forEach((raw, index) => {
		const text = raw.trim(), line = info.firstLine + index;
		if (!text || text.startsWith("%%") || look.accept(text, line)) return;
		const cells = csv(text);
		if (!cells) {
			errors.push(issue(info, line, "sankey CSV 引号格式错误", "Malformed sankey CSV quoting", "用成对的 \" 包住含逗号的名称，字段内引号写作 \"\"", "Wrap names that contain commas in \" and write inner quotes as \"\""));
			return;
		}
		if (cells.length !== 3) {
			errors.push(issue(info, line, `sankey 每行必须是 Source,Target,Value 三列，本行 ${cells.length} 列`, `Each sankey row needs exactly 3 columns, got ${cells.length}`, "每行只写来源、目标、数值三列", "Write source, target and value only"));
			return;
		}
		const [from, to] = [cells[0], cells[1]], amount = value(cells[2]);
		if (!from || !to) {
			errors.push(issue(info, line, "sankey 来源与目标不能为空", "Sankey source and target must not be empty"));
			return;
		}
		if (amount === null || amount <= 0) {
			errors.push(issue(info, line, `sankey 流量必须为正有限数，本行「${cells[2]}」`, `Sankey value must be a positive finite number, got "${cells[2]}"`, "把数值改为大于 0 的有限数", "Use a positive finite number"));
			return;
		}
		for (const id of [from, to]) if (!nodes.includes(id)) nodes.push(id);
		rows.push({
			id: `edge-${rows.length + 1}`,
			source: from,
			target: to,
			value: amount,
			line
		});
	});
	if (!rows.length && !errors.length) errors.push(issue(info, info.firstLine, "sankey 至少需要一条有效流量 CSV 记录", "Sankey needs at least one valid CSV flow record"));
	if (nodes.length > MAX_NODES) errors.push(issue(info, info.firstLine, `sankey 超过安全上限 ${MAX_NODES} 个节点（当前 ${nodes.length}）`, `Sankey exceeds the safety cap of ${MAX_NODES} nodes (got ${nodes.length})`, "拆分图表后重试", "Split the diagram and try again"));
	if (rows.length > MAX_EDGES) errors.push(issue(info, info.firstLine, `sankey 超过 Mermaid maxEdges 安全上限 ${MAX_EDGES} 条流量（当前 ${rows.length}）`, `Sankey exceeds the Mermaid maxEdges safety cap of ${MAX_EDGES} flows (got ${rows.length})`, "拆分图表后重试", "Split the diagram and try again"));
	const showValues = configFlag(configValue(info.config, "sankey"), "showValues") ?? true;
	return {
		model: {
			chart: "sankey",
			nodes: nodes.map((id) => ({
				id,
				label: numericLabel(id, info, rows.find((e) => e.source === id || e.target === id)?.line, errors),
				[sankeyPresentation]: {
					status: look.statusOf(id),
					link: look.linkOf(id)
				}
			})),
			edges: rows.map((edge, index) => ({
				...edge,
				[sankeyPresentation]: look.edgeStatusOf(index)
			})),
			showValues,
			unit: unitOf(info)
		},
		errors: [...errors, ...look.diagnostics()]
	};
}
function unitOf(info) {
	const config = configValue(info.config, "sankey");
	const prefix = configValue(config, "prefix"), suffix = configValue(config, "suffix");
	if (prefix === void 0 && suffix === void 0) return void 0;
	const text = (value) => value === void 0 || value === null ? "" : String(value);
	const [pre, post] = [text(prefix), text(suffix)];
	return /^[\p{L}\p{Sc}%‰°]*\p{Sc}?[\p{L}\p{Sc}%‰°]*$/u.test(`${pre}${post}`) && `${pre}${post}` ? `${pre}${post}` : void 0;
}
function toSpec(model) {
	return {
		chart: "sankey",
		tolerant: true,
		[sankeyPresentation]: true,
		[sizeBudget]: {
			nodes: MAX_NODES,
			edges: MAX_EDGES
		},
		data: {
			nodes: model.nodes,
			edges: model.edges.map(({ line, ...edge }) => edge)
		},
		layout: "right",
		showValues: model.showValues,
		...model.unit ? { unit: model.unit } : {}
	};
}
function lineFor(model, detail) {
	const path = String(detail?.path || "").split("/").slice(1).map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
	const indexAt = (key) => path[path.indexOf(key) + 1];
	const edgeIndex = Number(indexAt("edges"));
	if (Number.isInteger(edgeIndex) && model.edges[edgeIndex]) return model.edges[edgeIndex].line;
	const nodeIndex = Number(indexAt("nodes"));
	if (Number.isInteger(nodeIndex) && model.nodes[nodeIndex]) {
		const id = model.nodes[nodeIndex].id;
		return model.edges.find((edge) => edge.source === id || edge.target === id)?.line;
	}
	return model.edges[0]?.line;
}
function validate(model, info) {
	const errors = validateWith(toSpec(model), info, (detail) => lineFor(model, detail));
	if (errors.length || model.nodes.length <= LARGE_NODES && model.edges.length <= LARGE_EDGES) return errors;
	const indegree = new Map(model.nodes.map((node) => [node.id, 0]));
	const outgoing = new Map(model.nodes.map((node) => [node.id, []]));
	const stage = new Map(model.nodes.map((node) => [node.id, 0]));
	for (const { source, target } of model.edges) {
		outgoing.get(source).push(target);
		indegree.set(target, indegree.get(target) + 1);
	}
	const queue = model.nodes.map((node) => node.id).filter((id) => !indegree.get(id));
	for (const id of queue) for (const target of outgoing.get(id)) {
		stage.set(target, Math.max(stage.get(target), stage.get(id) + 1));
		indegree.set(target, indegree.get(target) - 1);
		if (!indegree.get(target)) queue.push(target);
	}
	const cap = 1e3;
	let segments = 0;
	for (const { source, target, line } of model.edges) {
		segments += stage.get(target) - stage.get(source);
		if (segments > cap) return [issue(info, line, `桑基图最多支持 ${cap} 个跨阶段流量分段`, `Sankey supports at most ${cap} flow segments across stages`, "请按阶段拆分图表", "Split the chart by stage")];
	}
	return errors;
}
var sankeyRegistry = createRegistry(validate$1);
sankeyRegistry.register("sankey", layouts.get("sankey"));
var layout = (model, options, info) => {
	const result = renderWith(toSpec(model), options, info, (detail) => lineFor(model, detail), sankeyRegistry.layout);
	if (result.scene && (result.width > options.width * 2 || model.nodes.length > LARGE_NODES || model.edges.length > LARGE_EDGES)) result.errors.push(warning("LARGE_DIAGRAM", info.lang, info.headerLine, "桑基图较大，可滚动查看", "Large Sankey diagram; scroll to view it", "考虑拆分图表", "Consider splitting the diagram"));
	return result;
};
var honoredConfig = Object.freeze([
	"sankey.showValues",
	"sankey.prefix",
	"sankey.suffix"
]);
var implementations = { sankey: {
	parse: parseSankey,
	validate,
	layout,
	optionMode: "raw",
	acceptsPresentation: true,
	honoredConfig
} };
export { honoredConfig, implementations, numeric_sankey_exports };
