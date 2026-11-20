import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { ignoredConfigWarning, parseOptions, prepareSource } from "./source.js";
import { blocking, error, measureOf } from "./support.js";
import { createContext } from "../core/context.js";
import { containText, el } from "../core/scene.js";
import { renderScene } from "../core/svg.js";
import { ExpectedDiagnostic } from "../core/diagnostics.js";
// src/diagram/registry.js
var registry_exports = /* @__PURE__ */ __exportAll({ createDiagramApi: () => createDiagramApi });
var SILENT_CONFIG = /* @__PURE__ */ new Set([
	"securitylevel",
	"startonload",
	"loglevel",
	"deterministicids",
	"deterministicidseed",
	"maxtextsize",
	"maxedges",
	"suppresserrorrendering",
	"htmllabels",
	"markdownautowrap",
	"arrowmarkerabsolute",
	"secure",
	"dompurifyconfig",
	"fontfamily",
	"fontsize"
]);
var DEFAULT_CONFIG = /* @__PURE__ */ new Map([
	["look", "classic"],
	["layout", "dagre"],
	["theme", "default"]
]);
function inferLang(source) {
	const text = String(source ?? "").replace(/^\s*---[^\n]*\n[\s\S]*?\n\s*(?:---|\.\.\.)[ \t]*(?:\n|$)/, "\n").replace(/%%\{[\s\S]*?\}%%/g, " ").replace(/%%.*$/gm, " ").replace(/https?:\/\/\S+/g, " ");
	const cjk = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length;
	const latin = (text.match(/[A-Za-z]{2,}/g) || []).length;
	return latin > 0 && latin >= cjk * 2 ? "en" : "zh";
}
function configWarning(info, implementation) {
	const honored = (implementation?.honoredConfig ?? []).map((key) => key.toLowerCase());
	const ignored = [];
	function visit(config, prefix = "") {
		for (const [name, value] of Object.entries(config)) {
			const key = prefix + name, path = key.toLowerCase();
			if (SILENT_CONFIG.has(path) || honored.some((entry) => path === entry || path.startsWith(`${entry}.`))) continue;
			if (value && typeof value === "object" && !Array.isArray(value)) visit(value, `${key}.`);
			else if (typeof value !== "string" || DEFAULT_CONFIG.get(path) !== value.toLowerCase()) ignored.push([key, info.configLines[path] ?? 1]);
		}
	}
	visit(info.config);
	const previous = info.errors.find((item) => item.code === "IGNORED_CONFIG");
	if (!ignored.length) return previous;
	ignored.sort((a, b) => a[1] - b[1]);
	const subjects = ignored.map(([key]) => key).join(", ");
	if (previous) return {
		...previous,
		line: Math.min(previous.line, ignored[0][1]),
		message: `${previous.message}, ${subjects}`
	};
	return ignoredConfigWarning(info.lang, ignored[0][1], subjects);
}
function presentationErrors(info) {
	if (info.syntax !== "mermaid") return [];
	const errors = [];
	for (const [i, raw] of info.body.split("\n").entries()) {
		const code = raw.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "");
		const forbidden = /^\s*(classDef|style|linkStyle|click|href|callback)\s/i.exec(code) || /::icon\s*\(/i.exec(code);
		const line = info.firstLine + i;
		if (forbidden) {
			const word = forbidden[1] || "::icon";
			errors.push(error(info.lang, line, `不支持 Mermaid 写法「${word}」`, `Unsupported Mermaid syntax "${word}"`, "移除样式、链接或回调写法；颜色由主题决定", "Remove styles, links, or callbacks; colors are controlled by the theme", raw.toLowerCase().indexOf(word.toLowerCase()) + 1));
		} else if (!info.kind.toLowerCase().startsWith("classdiagram") && /^\s*class\s+\S+\s+\S+/i.test(code)) errors.push(error(info.lang, line, "不支持 Mermaid 样式类声明", "Mermaid style-class declarations are not supported", "使用 ::: 状态分类；不要声明通用样式类", "Use ::: status classes; generic style classes are unsupported", raw.search(/\S/) + 1));
	}
	return errors;
}
function createDiagramApi(implementations, types) {
	if (!implementations || typeof implementations !== "object" || !Array.isArray(types)) throw new TypeError("Invalid diagram registry configuration");
	const byKind = /* @__PURE__ */ new Map(), byAlias = /* @__PURE__ */ new Map();
	for (const type of types) {
		if (!type || typeof type.kind !== "string" || !type.kind || typeof type.syntax !== "string" || !type.syntax || !Array.isArray(type.aliases) || typeof type.topic !== "string") throw new TypeError("Invalid diagram type descriptor");
		const kind = type.kind.toLowerCase();
		if (byKind.has(kind)) throw new TypeError(`Duplicate diagram type: ${type.kind}`);
		byKind.set(kind, type);
		for (const alias of [type.kind, ...type.aliases]) {
			if (typeof alias !== "string" || !alias.trim()) throw new TypeError(`Invalid diagram alias: ${alias}`);
			const key = alias.toLowerCase();
			if (byAlias.has(key)) throw new TypeError(`Duplicate diagram alias: ${alias}`);
			byAlias.set(key, type);
		}
	}
	const diagnostic = (error, type, defaultCode = "BAD_DIAGRAM") => ({
		code: error.code || defaultCode,
		line: error.line ?? 1,
		column: error.column ?? 1,
		message: error.message || "无效的结构图",
		fix: error.fix || "修正结构图声明后重试",
		topic: error.topic || type?.topic || "diagram",
		severity: error.severity === "warning" ? "warning" : "error"
	});
	const normalize = (items, type) => (items || []).map((item) => diagnostic(item, type));
	const merge = (...groups) => {
		const seen = /* @__PURE__ */ new Set();
		return groups.flat().filter((item) => {
			const key = JSON.stringify([
				item.code,
				item.line,
				item.column,
				item.message,
				item.fix,
				item.topic,
				item.severity
			]);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	};
	const headerLineOf = (prepared) => prepared.headerLine || prepared.firstLine || 1;
	function parseUnchecked(input, options = {}) {
		options = {
			...options,
			lang: options.lang || inferLang(input)
		};
		const syntax = options.syntax || "mermaid";
		if (/^mermaid$/i.test(syntax) && String(input ?? "").length > 5e4) return {
			info: null,
			type: null,
			model: null,
			diagnostics: normalize([error(options.lang, 1, "Mermaid 源码最多 50000 个字符", "Mermaid source is limited to 50,000 characters", "请拆分图表", "Split the diagram")], null)
		};
		const keepsTrailingComments = (kind) => {
			return implementations[byAlias.get(kind.toLowerCase())?.kind]?.trailingComments === false;
		};
		const prepared = prepareSource(input, {
			syntax,
			lang: options.lang,
			keepsTrailingComments
		});
		const rawKind = String(prepared.kind || "").toLowerCase();
		const type = byAlias.get(rawKind) || byKind.get(rawKind);
		const implementation = type && implementations[type.kind];
		const optionResult = implementation?.optionMode === "raw" ? {
			options: prepared.options || Object.create(null),
			errors: []
		} : parseOptions(prepared.params, {
			lang: options.lang,
			line: prepared.headerLine || prepared.firstLine
		});
		const info = {
			...prepared,
			...optionResult.options ? { options: optionResult.options } : {},
			kind: type?.kind || prepared.kind,
			syntax,
			lang: options.lang
		};
		const config = configWarning(info, implementation);
		const sourceErrors = prepared.errors.filter((item) => item.code !== "IGNORED_CONFIG");
		const presentation = implementation && implementation.acceptsPresentation !== true ? presentationErrors(info) : [];
		const preparedDiagnostics = normalize(merge(sourceErrors, config ? [config] : [], presentation, optionResult.errors || []), type);
		if (!type) {
			if (preparedDiagnostics.some(blocking)) return {
				info,
				type: null,
				model: null,
				diagnostics: preparedDiagnostics
			};
			const shown = prepared.kind || prepared.body.trim().split(/\s+/)[0].slice(0, 40) || syntax;
			const unknown = error(options.lang, headerLineOf(prepared), `未知结构图类型「${shown}」`, `Unknown diagram type "${shown}"`, "使用已声明的结构图类型", "Use a supported diagram type");
			return {
				info,
				type: null,
				model: null,
				diagnostics: [...preparedDiagnostics, diagnostic(unknown)]
			};
		}
		if (String(type.syntax).toLowerCase() !== String(syntax).toLowerCase()) {
			const syntaxError = diagnostic(error(options.lang, headerLineOf(prepared), `图类型「${prepared.kind}」不支持语法「${syntax}」`, `Diagram type "${prepared.kind}" does not use ${syntax} syntax`, `使用 ${type.syntax} 语法`, `Use ${type.syntax} syntax`), type);
			return {
				info,
				type,
				model: null,
				diagnostics: merge(preparedDiagnostics, [syntaxError])
			};
		}
		if (preparedDiagnostics.some(blocking)) return {
			info,
			type,
			model: null,
			diagnostics: preparedDiagnostics
		};
		if (!implementation) {
			const unloaded = error(options.lang, headerLineOf(prepared), `已知图类型「${type.kind}」尚未装入`, `Diagram type "${type.kind}" is not loaded`, "重新组装并装入该图类型", "Load this diagram type before rendering");
			return {
				info,
				type,
				model: null,
				diagnostics: [...preparedDiagnostics, diagnostic(unloaded, type)]
			};
		}
		if (typeof implementation.parse !== "function") throw new TypeError(`Missing parser for diagram: ${type.kind}`);
		const parsed = implementation.parse(prepared.body, info);
		if (!parsed || !Array.isArray(parsed.errors)) throw new TypeError(`Invalid parser result for diagram: ${type.kind}`);
		const validation = !parsed.errors.some(blocking) && typeof implementation.validate === "function" ? implementation.validate(parsed.model, info) || [] : [];
		if (!Array.isArray(validation)) throw new TypeError(`Invalid validation result for diagram: ${type.kind}`);
		return {
			info,
			type,
			model: parsed.model,
			diagnostics: merge(preparedDiagnostics, normalize(parsed.errors, type), normalize(validation, type))
		};
	}
	function parse(input, options = {}) {
		try {
			return parseUnchecked(input, options);
		} catch (error) {
			if (!(error instanceof ExpectedDiagnostic)) throw error;
			return {
				info: null,
				type: null,
				model: null,
				diagnostics: normalize(error.errors, null)
			};
		}
	}
	function check(input, options = {}) {
		return parse(input, options).diagnostics;
	}
	function diagram(input, options = {}) {
		const parsed = parse(input, options);
		if (parsed.diagnostics.some(blocking)) return {
			svg: null,
			scene: null,
			diagnostics: parsed.diagnostics
		};
		try {
			const implementation = implementations[parsed.type.kind];
			if (typeof implementation.layout !== "function") throw new TypeError(`Missing layout for diagram: ${parsed.type.kind}`);
			const width = Math.max(1, Number(options.width) || 800);
			const ctx = createContext({
				...options,
				width,
				lang: parsed.info.lang
			});
			const measure = measureOf(ctx);
			const renderOptions = {
				...options,
				frame: options.frame ?? true
			};
			const geometry = implementation.layout(parsed.model, {
				width,
				lang: ctx.lang,
				measure,
				ctx,
				renderOptions
			}, parsed.info);
			const diagnostics = merge(parsed.diagnostics, normalize(geometry?.errors, parsed.type));
			if (diagnostics.some(blocking)) return {
				svg: null,
				scene: null,
				diagnostics
			};
			const laid = geometry?.scene || (typeof implementation.scene === "function" ? implementation.scene(geometry, ctx, parsed.info) : null);
			if (!laid || !Number.isFinite(laid.width) || !Number.isFinite(laid.height) || !Array.isArray(laid.children)) throw new TypeError(`Invalid scene for diagram: ${parsed.type.kind}`);
			const contained = containText(laid, ctx.measure, { blockPadding: 4 });
			const sceneWidth = Math.max(width, contained.width);
			const offset = Math.max(0, (sceneWidth - contained.width) / 2);
			const children = offset ? [el("g", { transform: `translate(${offset} 0)` }, contained.children)] : contained.children;
			const anchor = contained.anchor ? {
				...contained.anchor,
				x: contained.anchor.x + offset
			} : contained.anchor;
			const title = parsed.info.accTitle || parsed.info.title || contained.title || parsed.type.kind;
			const scene = {
				...contained,
				width: sceneWidth,
				children,
				...anchor ? { anchor } : {},
				title,
				...parsed.info.accDescr !== void 0 ? { description: parsed.info.accDescr } : {},
				heading: parsed.info.title || contained.heading
			};
			return {
				svg: renderScene(scene, renderOptions),
				scene,
				diagnostics
			};
		} catch (error) {
			if (!(error instanceof ExpectedDiagnostic)) throw error;
			return {
				svg: null,
				scene: null,
				diagnostics: merge(parsed.diagnostics, normalize(error.errors, parsed.type))
			};
		}
	}
	return Object.freeze({
		parse,
		check,
		diagram
	});
}
export { createDiagramApi, registry_exports };
