import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { error, warning } from "./support.js";
// src/diagram/numeric-parse.js
var numeric_parse_exports = /* @__PURE__ */ __exportAll({
	parsePie: () => parsePie,
	parseTreemap: () => parseTreemap
});
var issue = (info, line, text, en) => error(info.lang, line, text, en, "修正图表语法", "Correct the chart syntax");
var unquote = (text) => text.replace(/^(["'])(.*)\1$/, "$2");
var numeric = (value) => /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(value) && Number.isFinite(Number(value));
var linesOf = (source, firstLine) => source.split("\n").map((raw, i) => ({
	raw,
	text: raw.trim(),
	line: firstLine + i
})).filter((x) => x.text && !x.text.startsWith("%%"));
function parsePie(source, info) {
	const errors = [], rows = [], labels = /* @__PURE__ */ new Set(), duplicates = [];
	const header = info.headerLine || info.firstLine - 1;
	const params = (info.params || "").trim();
	const showData = /^showData\b/i.test(params) || info.options?.showData === true;
	const rest = params.replace(/^showData\b\s*/i, "");
	let title = null, titleLine = null;
	const setTitle = (text, line) => {
		if (title !== null) errors.push(issue(info, line, "pie 只能有一个 title", "Pie accepts only one title"));
		else {
			title = unquote(text);
			titleLine = line;
		}
	};
	if (/^title\s+\S/i.test(rest)) setTitle(rest.replace(/^title\s+/i, ""), header);
	else if (rest) errors.push(issue(info, header, "pie 只支持 showData 和 title", "Pie only supports showData and title"));
	for (const { text, line } of linesOf(source, info.firstLine)) {
		if (/^title\s+/i.test(text)) {
			setTitle(text.replace(/^title\s+/i, ""), line);
			continue;
		}
		const m = /^(.+?)\s*:\s*(\S+)$/.exec(text);
		const label = m && unquote(m[1]);
		if (!label || !numeric(m[2]) || +m[2] < 0) errors.push(issue(info, line, "pie 数据必须是非负有限数值及非空标签", "Pie sections require a label and a finite nonnegative value"));
		else if (labels.has(label)) duplicates.push({
			label,
			line
		});
		else {
			labels.add(label);
			rows.push({
				category: label,
				value: +m[2],
				line
			});
		}
	}
	if (!rows.length) errors.push(issue(info, info.firstLine, "pie 至少需要一条数据", "Pie requires at least one section"));
	if (duplicates.length) {
		const names = [...new Set(duplicates.map((x) => x.label))].join(", ");
		errors.push(warning("DIAGRAM_HINT", info.lang, duplicates[0].line, `pie 重复标签仅保留首次值：${names}`, `Pie keeps the first value for duplicate labels: ${names}`, "删除重复条目", "Remove duplicate sections"));
	}
	if (rows.length > 6) {
		const overflow = rows.splice(5), value = overflow.reduce((sum, row) => sum + row.value, 0);
		const names = overflow.map((row) => row.category).join(", ");
		let category = `${info.lang?.startsWith("en") ? "Other" : "其他"} (${names})`;
		while (labels.has(category)) category += "*";
		if (!(value > 0)) errors.push(issue(info, overflow[0].line, "pie 合并项的总值必须大于零", "The combined pie section must have a positive total"));
		rows.push({
			category,
			value,
			line: overflow[0].line
		});
		errors.push(warning("DIAGRAM_HINT", info.lang, overflow[0].line, `pie 已将其余条目合并为其他：${names}`, `Pie combines remaining sections as Other: ${names}`, "如需分别展示，请拆分图表", "Split the chart to show these sections separately"));
	}
	return {
		model: {
			chart: "pie",
			title,
			titleLine,
			showData,
			rows
		},
		errors
	};
}
function parseTreemap(source, info) {
	const errors = [], roots = [], stack = [], levels = [];
	let title = null, titleLine = null;
	for (const key of Object.keys(info.options || {})) errors.push(issue(info, info.headerLine, `treemap 不支持选项 ${key}`, `Unsupported treemap option ${key}`));
	for (const { raw, text, line } of linesOf(source, info.firstLine)) {
		if (/^title\s+/i.test(text)) {
			if (title !== null) errors.push(issue(info, line, "treemap 只能有一个 title", "Treemap accepts only one title"));
			else {
				title = unquote(text.replace(/^title\s+/i, ""));
				titleLine = line;
			}
			continue;
		}
		const leading = raw.match(/^[ \t]*/)[0];
		if (leading.includes("	")) {
			errors.push(error(info.lang, line, "treemap 缩进不能使用 Tab", "Treemap indentation cannot use tabs", "用空格缩进", "Indent with spaces", leading.indexOf("	") + 1));
			continue;
		}
		const match = /^("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^:,]+?)(?:\s*[:,]\s*(.+))?$/.exec(text);
		const label = match && unquote(match[1].trim());
		if (!label || /:::|[{}]/.test(label)) {
			errors.push(issue(info, line, "treemap 节点名称无效", "Invalid treemap node name"));
			continue;
		}
		const node = {
			label,
			children: [],
			line
		};
		if (match[2] !== void 0) {
			const value = match[2].replace(/[_,]/g, "");
			if (!numeric(value) || Number(value) < 0 || match[2].includes(":::")) errors.push(issue(info, line, "treemap 权重必须是非负有限数", "Treemap weights must be finite and nonnegative"));
			else node.value = Number(value);
		}
		const indent = leading.length;
		while (stack.length && indent <= stack.at(-1).indent) stack.pop();
		const depth = stack.length;
		if (depth && levels[depth] !== void 0 && levels[depth] !== indent) errors.push(issue(info, line, "treemap 同级缩进不一致", "Treemap sibling indentation must match"));
		levels[depth] ??= indent;
		(depth ? stack.at(-1).node.children : roots).push(node);
		stack.push({
			indent,
			node
		});
	}
	if (!roots.length) errors.push(issue(info, info.firstLine, "treemap 需要至少一个根节点", "Treemap requires at least one root"));
	const data = roots.length === 1 ? roots[0] : {
		label: "Treemap",
		children: roots,
		line: info.firstLine
	};
	const treeLines = {};
	const clean = (node, path, depth) => {
		treeLines[path] = node.line;
		if (depth > 5) {
			errors.push(issue(info, node.line, "treemap 深度最多 5 层", "Treemap depth is limited to five levels"));
			return;
		}
		node.children.forEach((child, i) => clean(child, `${path}/children/${i}`, depth + 1));
		if (node.children.length && node.value !== void 0) errors.push(issue(info, node.line, "有子项的 treemap 节点不能同时指定权重", "Treemap sections with children cannot have weights"));
		if (!node.children.length && node.value === void 0) errors.push(issue(info, node.line, "treemap 叶节点必须指定权重", "Treemap leaves require a weight"));
		delete node.line;
	};
	if (roots.length) clean(data, "/data", 1);
	return {
		model: {
			chart: "treemap",
			title,
			titleLine,
			treeLines,
			data
		},
		errors
	};
}
export { numeric_parse_exports, parsePie, parseTreemap };
