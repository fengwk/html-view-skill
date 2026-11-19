import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { error } from "./support.js";
// src/diagram/source.js
var source_exports = /* @__PURE__ */ __exportAll({
	parseOptions: () => parseOptions,
	prepareSource: () => prepareSource
});
var SIMPLE_CONFIG = /* @__PURE__ */ new Set([
	"theme",
	"look",
	"themevariables",
	"mindmap.colorby"
]);
var quoteValue = (value) => {
	const v = value.trim();
	if (v.startsWith("\"") && v.endsWith("\"") || v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
	return v;
};
var issue = (lang, line, column, zh, en, fixZh, fixEn) => error(lang, line, zh, en, fixZh, fixEn, column);
var tokensOf = (value) => {
	const tokens = [];
	let token = "", quote = "", escaped = false;
	for (const char of String(value ?? "")) {
		if (escaped) {
			token += char;
			escaped = false;
			continue;
		}
		if (char.charCodeAt(0) === 92 && quote) {
			token += char;
			escaped = true;
			continue;
		}
		if (quote) {
			token += char;
			if (char === quote) quote = "";
		} else if (char === "\"" || char === "'") {
			quote = char;
			token += char;
		} else if (char.trim() === "") {
			if (token) tokens.push(token);
			token = "";
		} else token += char;
	}
	if (token) tokens.push(token);
	return tokens;
};
function parseOptions(params, { lang, line = 1 } = {}) {
	const options = {}, errors = [];
	const tokens = Array.isArray(params) ? params : tokensOf(params);
	for (const token of tokens) {
		const match = /^([A-Za-z][\w-]*)(?:=(.*))?$/.exec(String(token));
		if (!match) {
			errors.push(issue(lang, line, 1, `无效的图选项「${token}」`, `Invalid diagram option "${token}"`, "使用 key=value 或单独的选项名", "Use key=value or a bare option name"));
			continue;
		}
		const key = match[1];
		if (Object.hasOwn(options, key)) {
			errors.push(issue(lang, line, 1, `图选项「${key}」重复`, `Duplicate diagram option "${key}"`, "每个图选项只写一次", "Use each diagram option once"));
			continue;
		}
		options[key] = match[2] === void 0 ? true : quoteValue(match[2]);
	}
	return {
		options,
		errors
	};
}
function directiveIssue(lang, line, column) {
	return issue(lang, line, column, "不支持任何 Mermaid 指令", "Mermaid directives are not supported", "请改用前言区配置", "Use front matter configuration instead");
}
function normalizeMarkdown(source) {
	const pattern = /"`([\s\S]*?)`"/g;
	let result = "", cursor = 0, match;
	while (match = pattern.exec(source)) {
		const lineBreaks = (match[0].match(/\n/g) || []).length;
		const replacement = `"${match[1].replace(/\*\*([\s\S]*?)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replaceAll("\"", "&quot;").replaceAll("\n", "<br/>")}"`;
		result += source.slice(cursor, match.index);
		if (!lineBreaks) {
			result += replacement;
			cursor = pattern.lastIndex;
			continue;
		}
		const lineEnd = source.indexOf("\n", pattern.lastIndex);
		const end = lineEnd < 0 ? source.length : lineEnd;
		result += replacement + source.slice(pattern.lastIndex, end) + "\n".repeat(lineBreaks);
		cursor = end;
		pattern.lastIndex = end;
	}
	return result + source.slice(cursor);
}
function prepareSource(source, { syntax = "mermaid", lang } = {}) {
	const lines = String(source ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
	const errors = [];
	let start = 0, title, layout;
	let opener = 0;
	while (opener < lines.length && !lines[opener].trim()) opener++;
	if (lines[opener]?.trim() === "---") {
		let close = -1;
		for (let i = opener + 1; i < lines.length; i++) if (["---", "..."].includes(lines[i].trim())) {
			close = i;
			break;
		}
		if (close < 0) errors.push(issue(lang, opener + 1, Math.max(1, lines[opener].indexOf("---") + 1), "前言区缺少结束标记 --- 或 ...", "Front matter is missing closing --- or ...", "在前言区末尾添加 ---", "Add --- at the end of the front matter"));
		else {
			let section = "", configParent = "", configParentIndent = 0;
			const seenTop = /* @__PURE__ */ new Set(), seenConfig = /* @__PURE__ */ new Set();
			for (let i = opener + 1; i < close; i++) {
				const line = lines[i], trimmed = line.trim();
				if (!trimmed || trimmed.startsWith("#")) continue;
				const indent = line.match(/^\s*/)[0].length;
				const pair = /^([\w.-]+)\s*:\s*(.*)$/.exec(trimmed);
				if (indent === 0 && pair) {
					section = pair[1].toLowerCase();
					configParent = "";
					if (section === "title") {
						if (seenTop.has("title")) errors.push(issue(lang, i + 1, line.indexOf(pair[1]) + 1, "前言区 title 重复", "Duplicate front matter title", "只保留一个 title", "Keep only one title"));
						else {
							title = quoteValue(pair[2]);
							seenTop.add("title");
						}
					} else if (section === "config") {
						if (seenTop.has("config")) errors.push(issue(lang, i + 1, line.indexOf(pair[1]) + 1, "前言区 config 重复", "Duplicate front matter config section", "合并到一个 config 区块", "Merge settings into one config section"));
						seenTop.add("config");
					} else errors.push(issue(lang, i + 1, line.indexOf(pair[1]) + 1, `不支持前言字段「${pair[1]}」`, `Unsupported front matter field "${pair[1]}"`, "只使用 title 和 config", "Use only title and config"));
					continue;
				}
				const nested = /^\s+([\w.-]+)\s*:\s*(.*)$/.exec(line);
				if (!nested || section !== "config") {
					errors.push(issue(lang, i + 1, Math.max(1, line.search(/\S/) + 1), "无法解析前言区内容", "Invalid front matter content", "使用 title: 文本或 config 下的 key: value", "Use title: text or key: value under config"));
					continue;
				}
				const key = nested[1].toLowerCase(), value = quoteValue(nested[2]);
				const column = line.indexOf(nested[1]) + 1;
				if (configParent && indent > configParentIndent) {
					if (configParent === "themevariables") continue;
					if (configParent === "mindmap" && key === "colorby") continue;
					errors.push(issue(lang, i + 1, column, `不支持前言配置「${nested[1]}」`, `Unsupported front matter config "${nested[1]}"`, "仅使用文档列出的 config 项", "Use only documented config entries"));
					continue;
				}
				configParent = "";
				if (key === "layout") {
					if (seenConfig.has("layout")) errors.push(issue(lang, i + 1, column, "前言区 layout 重复", "Duplicate front matter layout", "只保留一个 layout", "Keep only one layout"));
					else {
						layout = value;
						seenConfig.add("layout");
					}
				} else if (key === "mindmap" && !value) {
					configParent = "mindmap";
					configParentIndent = indent;
				} else if (key === "themevariables" && !value) {
					configParent = "themevariables";
					configParentIndent = indent;
				} else if (!SIMPLE_CONFIG.has(key)) errors.push(issue(lang, i + 1, column, `不支持前言配置「${nested[1]}」`, `Unsupported front matter config "${nested[1]}"`, "仅使用文档列出的 config 项", "Use only documented config entries"));
			}
			start = close + 1;
		}
	}
	while (start < lines.length && !lines[start].trim()) start++;
	if (syntax === "mermaid") while (start < lines.length) {
		const raw = lines[start];
		if (!raw.trim() || /^\s*%%(?!\{)/.test(raw)) {
			start++;
			continue;
		}
		if (/^\s*%%\{/.test(raw)) {
			errors.push(directiveIssue(lang, start + 1, Math.max(1, raw.search(/\S/) + 1)));
			const closed = /\}%%|%%\}/.test(raw);
			start++;
			while (!closed && start < lines.length) {
				if (/\}%%|%%\}/.test(lines[start])) {
					start++;
					break;
				}
				start++;
			}
			continue;
		}
		break;
	}
	let header = "", headerLine = 0, firstLine = start + 1, bodyStart = start;
	const first = lines[start] || "";
	const head = /^\s*([A-Za-z][\w-]*)(?=\s|;|$)(.*)$/.exec(first);
	const mermaid = syntax === "mermaid";
	const nativeType = String(syntax || "").replace(/^native(?::|-)?/i, "");
	let kind = "", params = "";
	if (mermaid && head) {
		kind = head[1];
		header = first;
		headerLine = start + 1;
		bodyStart = start + 1;
		firstLine = bodyStart + 1;
		params = head[2].trim();
	} else if (!mermaid && head && (nativeType.toLowerCase() === head[1].toLowerCase() || !nativeType && !/(?:-->|==>|[\[\]{}()])/.test(first))) {
		kind = head[1];
		header = first;
		headerLine = start + 1;
		bodyStart = start + 1;
		firstLine = bodyStart + 1;
		params = head[2].trim();
	} else {
		kind = nativeType && nativeType.toLowerCase() !== "native" ? nativeType : "";
		bodyStart = start;
		firstLine = start + 1;
	}
	const rawBody = lines.slice(bodyStart).join("\n");
	const bodyLines = (mermaid ? normalizeMarkdown(rawBody) : rawBody).split("\n");
	if (mermaid) for (let i = 0; i < bodyLines.length; i++) {
		const raw = bodyLines[i];
		if (/^\s*%%(?!\{)/.test(raw)) {
			bodyLines[i] = "";
			continue;
		}
		if (/^\s*%%\{/.test(raw)) {
			errors.push(directiveIssue(lang, firstLine + i, Math.max(1, raw.search(/\S/) + 1)));
			const closed = /\}%%|%%\}/.test(raw);
			bodyLines[i] = "";
			while (!closed && i + 1 < bodyLines.length) {
				i++;
				const end = /\}%%|%%\}/.test(bodyLines[i]);
				bodyLines[i] = "";
				if (end) break;
			}
			continue;
		}
		const code = raw.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "");
		const forbidden = /^\s*(classDef|style|linkStyle|click|href|callback)\s/i.exec(code) || /.*::icon\s*\(/i.exec(code);
		if (forbidden) {
			const word = forbidden[1] || "::icon";
			errors.push(issue(lang, firstLine + i, Math.max(1, raw.toLowerCase().indexOf(word.toLowerCase()) + 1), `不支持 Mermaid 写法「${word}」`, `Unsupported Mermaid syntax "${word}"`, "移除样式、链接或回调写法；颜色由主题决定", "Remove styles, links, or callbacks; colors are controlled by the theme"));
		} else if (!kind.toLowerCase().startsWith("classdiagram") && /^\s*class\s+\S+\s+\S+/i.test(code)) errors.push(issue(lang, firstLine + i, raw.search(/\S/) + 1, "不支持 Mermaid 样式类声明", "Mermaid style-class declarations are not supported", "使用 ::: 状态分类；不要声明通用样式类", "Use ::: status classes; generic style classes are unsupported"));
	}
	const body = bodyLines.join("\n");
	return {
		kind,
		header,
		headerLine,
		firstLine,
		body,
		...title !== void 0 ? { title } : {},
		...layout !== void 0 ? { layout } : {},
		params,
		errors
	};
}
export { parseOptions, prepareSource, source_exports };
