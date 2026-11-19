import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { validate } from "./spec.js";
import { makeContext } from "./context.js";
import { containText } from "../core/scene.js";
import { renderScene } from "../core/svg.js";
import { ExpectedDiagnostic } from "../core/diagnostics.js";
// src/chart/registry.js
var registry_exports = /* @__PURE__ */ __exportAll({
	createRegistry: () => createRegistry,
	decorate: () => decorate,
	layout: () => layout,
	layouts: () => layouts,
	register: () => register,
	render: () => render
});
function createRegistry(validate) {
	const layouts = /* @__PURE__ */ new Map();
	const decorators = /* @__PURE__ */ new Map();
	const cannotMutate = () => {
		throw new TypeError("KChart.layouts is read-only");
	};
	const view = Object.freeze({
		get size() {
			return layouts.size;
		},
		get: (name) => layouts.get(name),
		has: (name) => layouts.has(name),
		keys: () => layouts.keys(),
		values: () => layouts.values(),
		entries: () => layouts.entries(),
		[Symbol.iterator]: () => layouts.entries(),
		forEach: (visit, thisArg) => layouts.forEach((fn, name) => visit.call(thisArg, fn, name, view)),
		set: cannotMutate,
		delete: cannotMutate,
		clear: cannotMutate
	});
	function register(names, layoutFn) {
		const list = Array.isArray(names) ? names : [names];
		if (!list.length || new Set(list).size !== list.length || list.some((name) => typeof name !== "string" || !name.trim()) || typeof layoutFn !== "function") throw new TypeError("Invalid KChart layout registration");
		for (const name of list) if (layouts.has(name)) throw new Error(`KChart layout already registered: ${name}`);
		for (const name of list) layouts.set(name, layoutFn);
	}
	function decorate(names, decorator) {
		const list = Array.isArray(names) ? names : [names];
		if (!list.length || new Set(list).size !== list.length || list.some((name) => !layouts.has(name)) || typeof decorator !== "function") throw new TypeError("Decorator requires an existing layout and function");
		for (const name of list) if (decorators.has(name)) throw new Error(`KChart decorator already registered: ${name}`);
		for (const name of list) decorators.set(name, decorator);
	}
	function layout(input, options = {}) {
		if (typeof validate !== "function") throw new TypeError("渲染器未绑定声明校验器");
		const { errors, data: spec } = validate(input);
		if (errors.length) throw new ExpectedDiagnostic("图表声明校验失败", errors);
		if (!spec) throw new TypeError("声明校验器未返回图表");
		const name = spec.chart;
		const base = layouts.get(name);
		if (!base) {
			const message = `未装入 ${name} 的图型模块`;
			throw new ExpectedDiagnostic(message, [{
				code: "BAD_KCHART",
				path: "/chart",
				message,
				fix: "以该图表声明重新组装渲染器"
			}]);
		}
		const ctx = makeContext({
			...options,
			spec
		});
		const decorator = decorators.get(name);
		const laid = decorator ? decorator(spec, ctx, (s = spec, c = ctx) => base(s, c)) : base(spec, ctx);
		if (!laid || !Number.isFinite(laid.width) || !Number.isFinite(laid.height) || !Array.isArray(laid.children)) throw new TypeError("Layout must return a scene");
		const contained = containText(laid, ctx.measure);
		return {
			...contained,
			title: spec.title || contained.title,
			heading: spec.title,
			subtitle: spec.subtitle,
			source: spec.source,
			note: spec.note
		};
	}
	function render(spec, options = {}) {
		try {
			const scene = layout(spec, options);
			return {
				scene,
				svg: renderScene(scene, options),
				diagnostics: []
			};
		} catch (error) {
			if (!(error instanceof ExpectedDiagnostic)) throw error;
			return {
				scene: null,
				svg: null,
				diagnostics: error.errors
			};
		}
	}
	return {
		register,
		decorate,
		layouts: view,
		layout,
		render
	};
}
var { register, decorate, layouts, layout, render } = createRegistry(validate);
export { createRegistry, decorate, layout, layouts, register, registry_exports, render };
