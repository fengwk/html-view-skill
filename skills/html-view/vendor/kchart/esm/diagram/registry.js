import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { parseOptions, prepareSource } from "./source.js";
import { blocking, measureOf } from "./support.js";
import { createContext } from "../core/context.js";
import { containText, el } from "../core/scene.js";
import { renderScene } from "../core/svg.js";
import { ExpectedDiagnostic } from "../core/diagnostics.js";
// src/diagram/registry.js
var registry_exports = /* @__PURE__ */ __exportAll({ createDiagramApi: () => createDiagramApi });
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
		const syntax = options.syntax || "mermaid";
		const prepared = prepareSource(input, {
			syntax,
			lang: options.lang
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
			lang: options.lang || "zh"
		};
		const preparedDiagnostics = normalize(merge(prepared.errors || [], optionResult.errors || []), type);
		if (!type) {
			if (preparedDiagnostics.some(blocking)) return {
				info,
				type: null,
				model: null,
				diagnostics: preparedDiagnostics
			};
			return {
				info,
				type: null,
				model: null,
				diagnostics: [...preparedDiagnostics, diagnostic({
					line: headerLineOf(prepared),
					message: `未知结构图类型「${prepared.kind || syntax}」`,
					fix: "使用已声明的结构图类型"
				})]
			};
		}
		if (String(type.syntax).toLowerCase() !== String(syntax).toLowerCase()) {
			const syntaxError = diagnostic({
				line: headerLineOf(prepared),
				message: `图类型「${prepared.kind}」不支持语法「${syntax}」`,
				fix: `使用 ${type.syntax} 语法`
			}, type);
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
		if (!implementation) return {
			info,
			type,
			model: null,
			diagnostics: [...preparedDiagnostics, diagnostic({
				line: headerLineOf(prepared),
				message: `已知图类型「${type.kind}」尚未装入`,
				fix: "重新组装并装入该图类型"
			}, type)]
		};
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
				lang: options.lang || "zh"
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
			const title = parsed.info.title || contained.title || parsed.type.kind;
			const scene = {
				...contained,
				width: sceneWidth,
				children,
				...anchor ? { anchor } : {},
				title,
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
