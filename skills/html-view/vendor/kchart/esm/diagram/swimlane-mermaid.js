import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { parseFlow } from "./graph-parse.js";
import { layout as layout$1, scene as scene$1 } from "./swimlane.js";
import { error, labelText, warning } from "./support.js";
// src/diagram/swimlane-mermaid.js
var swimlane_mermaid_exports = /* @__PURE__ */ __exportAll({ implementations: () => implementations });
function flowRows(text, line, hiddenLabel) {
	const rows = [];
	let quote = "", pipe = false, depth = 0, current = "";
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quote) {
			if (ch === "\\" && text[i + 1] === quote) current += ch + text[++i];
			else {
				if (ch === quote) quote = "";
				current += ch;
			}
			continue;
		}
		if (ch === "\"" || ch === "'") quote = ch;
		else if (ch === "|" && depth === 0) pipe = !pipe;
		else if (!pipe) {
			if ("[({".includes(ch)) depth++;
			else if ("])}".includes(ch)) depth--;
			else if (!depth && text.startsWith("~~~", i)) {
				current += `---|${hiddenLabel}|`;
				i += 2;
				continue;
			} else if (!depth && text.startsWith("%%", i)) break;
			else if (!depth && ch === ";") {
				if (current.trim()) rows.push({
					text: current.trim(),
					line
				});
				current = "";
				continue;
			}
		}
		current += ch;
	}
	if (current.trim()) rows.push({
		text: current.trim(),
		line
	});
	return rows;
}
function parse(body, info) {
	const { lang, firstLine, headerLine } = info;
	const errors = [], statements = [];
	const fix = ["检查泳道声明", "Check the swimlane declaration"];
	const fail = (line, zh, en) => errors.push(error(lang, line, zh, en, ...fix));
	const hint = (line, zh, en) => errors.push(warning("DIAGRAM_HINT", lang, line, zh, en, ...fix));
	let direction, accTitle = info.accTitle, accDescr = info.accDescr, description;
	function setDirection(value, line) {
		let next = value.toUpperCase();
		if (next === "TD") next = "TB";
		if ([
			"BR",
			"<",
			">",
			"^",
			"V"
		].includes(next)) {
			hint(line, `方向 ${value} 按 TB 绘制`, `Direction ${value} is drawn as TB`);
			next = "TB";
		}
		if (![
			"LR",
			"RL",
			"TB",
			"BT"
		].includes(next)) fail(line, "无效的泳道方向", "Invalid swimlane direction");
		else if (direction && direction !== next) fail(line, "泳道方向声明冲突", "Conflicting swimlane directions");
		else direction = next;
	}
	let hiddenLabel = "KCInvisibleRankLink";
	while (body.includes(hiddenLabel)) hiddenLabel += "_";
	const params = info.params.trim();
	if (params) setDirection(params, headerLine);
	for (const [i, raw] of body.split("\n").entries()) {
		const text = raw.trim(), line = firstLine + i;
		if (description) {
			const close = text.indexOf("}");
			if (close < 0) description.push(text);
			else {
				description.push(text.slice(0, close));
				accDescr = description.join("\n").trim();
				description = null;
			}
			continue;
		}
		if (!text || text.startsWith("%%")) continue;
		const dir = /^direction\s+(\S+)$/i.exec(text);
		const acc = /^acc(Title|Descr)\s*:\s*(.*)$/i.exec(text);
		const block = /^accDescr\s*\{([^}]*)(\})?$/i.exec(text);
		if (dir) setDirection(dir[1], line);
		else if (acc) {
			if (acc[1].toLowerCase() === "title") accTitle = acc[2];
			else accDescr = acc[2];
		} else if (block) {
			if (block[2]) accDescr = block[1].trim();
			else description = [block[1].trim()];
		} else statements.push(...flowRows(text, line, hiddenLabel));
	}
	if (description) fail(firstLine, "描述缺少右花括号", "Unclosed accessibility description");
	const flow = parseFlow(statements);
	errors.push(...flow.errors);
	const groups = new Map(flow.model.subgraphs.map((group) => [group.id, group]));
	const lanes = flow.model.subgraphs.filter((group) => group.parent == null).map((group) => ({
		id: group.id,
		name: labelText(group.title),
		line: group.line,
		nodes: []
	}));
	if (lanes.length > 6) fail(lanes[6].line, "最多 6 条泳道", "At most 6 lanes");
	const nested = flow.model.subgraphs.filter((group) => group.parent != null).map((group) => ({
		...group,
		title: labelText(group.title),
		nodes: []
	}));
	const nestedById = new Map(nested.map((group) => [group.id, group]));
	const byLane = new Map(lanes.map((lane) => [lane.id, lane]));
	let unassigned;
	const nodes = flow.model.nodes.map((node) => {
		let parent = groups.get(node.parent);
		const ancestors = [];
		while (parent?.parent != null) {
			ancestors.push(nestedById.get(parent.id));
			parent = groups.get(parent.parent);
		}
		for (const group of ancestors) {
			group.lane = parent.id;
			group.nodes.push(node.id);
		}
		let lane = byLane.get(parent?.id);
		if (!lane) {
			if (!unassigned) {
				let id = "@unassigned";
				while (groups.has(id)) id += "_";
				unassigned = {
					id,
					name: /^en\b/i.test(lang) ? "Unassigned" : "未分配",
					line: node.line,
					nodes: []
				};
				lanes.push(unassigned);
				hint(node.line, "未归属节点被放入独立泳道", "Unassigned nodes are drawn in a separate lane");
			}
			lane = unassigned;
		}
		lane.nodes.push(node.id);
		return {
			...node,
			lane: lane.id,
			label: labelText(node.label)
		};
	});
	const unsupported = nodes.filter((node) => ![
		"rect",
		"round",
		"stadium",
		"circle",
		"diamond"
	].includes(node.shape));
	if (unsupported.length) hint(unsupported[0].line, "其他节点形状按圆角矩形绘制", "Other node shapes are drawn as rounded rectangles");
	if (nested.length) hint(nested[0].line, "嵌套子图在所属泳道内绘制", "Nested subgraphs are drawn within their enclosing lane");
	const edges = [];
	for (const edge of flow.model.edges) if (edge.fromFrame || edge.toFrame) fail(edge.line, "连线必须连接泳道节点", "Edges must connect swimlane nodes");
	else if (edge.label === hiddenLabel) edges.push({
		...edge,
		id: `e${edge.seq}`,
		label: "",
		style: "invisible"
	});
	else edges.push({
		...edge,
		id: `e${edge.seq}`,
		label: labelText(edge.label)
	});
	return {
		model: {
			mermaid: true,
			direction: ["LR", "RL"].includes(direction) ? "LR" : "TB",
			reverse: ["RL", "BT"].includes(direction),
			lanes,
			nodes,
			edges,
			nested,
			accTitle,
			accDescr
		},
		errors
	};
}
function layout(model, options) {
	const geometry = layout$1(model, options);
	if (!geometry.errors.length && geometry.width > options.width * 2) geometry.errors.push(warning("LARGE_DIAGRAM", options.lang, model.lanes[0]?.line, "泳道图较宽，可拆成多张图", "Wide swimlane diagram; consider splitting it"));
	return geometry;
}
function scene(geometry, ctx) {
	return {
		...scene$1(geometry, ctx),
		title: geometry.model.accTitle,
		description: geometry.model.accDescr
	};
}
var implementations = { "swimlane-beta": {
	optionMode: "raw",
	parse,
	layout,
	scene
} };
export { implementations, swimlane_mermaid_exports };
