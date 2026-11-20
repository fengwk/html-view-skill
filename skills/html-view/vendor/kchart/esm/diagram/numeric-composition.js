import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { parsePie, parseTreemap } from "./numeric-parse.js";
import { diagnostics, renderWith, validateWith } from "./numeric-model.js";
import { compositionPresentation } from "../chart/composition.js";
import { createRegistry, layouts } from "../chart/registry.js";
import { sizeBudget, validate } from "../chart/spec.js";
import { warning } from "./support.js";
// src/diagram/numeric-composition.js
var numeric_composition_exports = /* @__PURE__ */ __exportAll({ implementations: () => implementations });
function bind(parse, toSpec, lineFor, options) {
	return {
		...options,
		parse,
		validate: (model, info) => validateWith(toSpec(model, info), info, (detail) => lineFor(model, detail.path)),
		layout(model, options, info) {
			const width = options.compact ? Math.min(560, Math.max(360, 290 + model.rows.length * 24)) : options.width;
			return renderWith(toSpec(model, info, options.compact === true), {
				...options,
				width
			}, info, (detail) => lineFor(model, detail.path));
		}
	};
}
var pie = bind(parsePie, (model, _info, compact) => ({
	chart: "pie",
	title: model.title || void 0,
	sliceLabels: true,
	data: model.rows.map(({ category, value }) => ({
		category,
		value
	})),
	encode: {
		category: "category",
		value: "value"
	},
	[compositionPresentation]: {
		labelRadius: model.labelRadius,
		...compact ? { compact: true } : {}
	}
}), (model, path) => path === "/title" ? model.titleLine : model.rows[Number(path?.split("/")[2])]?.line || model.rows[0]?.line, {
	optionMode: "raw",
	honoredConfig: ["pie.textPosition"]
});
var treemapSpec = (model, info) => ({
	chart: "treemap",
	title: model.title || void 0,
	data: model.data,
	fields: model.valueField ? { value: model.valueField } : void 0,
	[compositionPresentation]: {
		showValues: info.config?.treemap?.showValues !== false,
		prefix: model.prefix,
		namedRoot: model.namedRoot
	},
	[sizeBudget]: {
		nodes: 202,
		depth: 101
	}
});
var treemapLine = (model, path) => {
	if (path === "/title") return model.titleLine;
	for (let key = path; key; key = key.slice(0, key.lastIndexOf("/"))) {
		if (model.treeLines[key]) return model.treeLines[key];
		if (!key.includes("/")) break;
	}
	return null;
};
var treemapRegistry = createRegistry(validate);
treemapRegistry.register("treemap", layouts.get("treemap"));
var implementations = {
	pie,
	treemap: {
		parse: parseTreemap,
		acceptsPresentation: true,
		honoredConfig: ["treemap.showValues", "treemap.valueFormat"],
		validate(model, info) {
			const spec = treemapSpec(model, info);
			return diagnostics(validate(spec).errors, info, (detail) => treemapLine(model, detail.path));
		},
		layout(model, options, info) {
			const compact = options.compact === true;
			const spec = treemapSpec(model, info), lineFor = (detail) => treemapLine(model, detail.path);
			if (compact) spec[compositionPresentation] = {
				...spec[compositionPresentation],
				compact: true
			};
			const singleLeaf = model.data.children?.length === 1 && !model.data.children[0]?.children?.length;
			const width = compact ? singleLeaf ? 256 : Math.min(640, 480 + Math.max(0, model.nodeCount - 1) * 10) : options.width;
			const renderOptions = compact ? {
				...options,
				width
			} : options;
			const result = renderWith(spec, renderOptions, info, lineFor, treemapRegistry.layout);
			if (result.scene && (model.nodeCount > 60 || model.depth > 5 || result.width > options.width * 2)) result.errors.push(warning("LARGE_DIAGRAM", info.lang, info.headerLine, "矩形树图较大，可滚动查看", "Large treemap; scroll to view it", "考虑拆分图表", "Consider splitting the chart"));
			return result;
		}
	}
};
export { implementations, numeric_composition_exports };
