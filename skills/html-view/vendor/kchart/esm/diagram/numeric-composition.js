import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { parsePie, parseTreemap } from "./numeric-parse.js";
import { renderWith, validateWith } from "./numeric-model.js";
import { compositionPresentation } from "../chart/composition.js";
// src/diagram/numeric-composition.js
var numeric_composition_exports = /* @__PURE__ */ __exportAll({ implementations: () => implementations });
function bind(parse, toSpec, lineFor, options) {
	return {
		...options,
		parse,
		validate: (model, info) => validateWith(toSpec(model, info), info, (detail) => lineFor(model, detail.path)),
		layout: (model, options, info) => renderWith(toSpec(model, info), options, info, (detail) => lineFor(model, detail.path))
	};
}
var implementations = {
	pie: bind(parsePie, (model) => ({
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
		[compositionPresentation]: { labelRadius: model.labelRadius }
	}), (model, path) => path === "/title" ? model.titleLine : model.rows[Number(path?.split("/")[2])]?.line || model.rows[0]?.line, {
		optionMode: "raw",
		honoredConfig: ["pie.textPosition"]
	}),
	treemap: bind(parseTreemap, (model, info) => ({
		chart: "treemap",
		title: model.title || void 0,
		data: model.data,
		fields: model.valueField ? { value: model.valueField } : void 0,
		[compositionPresentation]: {
			showValues: info.config?.treemap?.showValues !== false,
			prefix: model.prefix,
			namedRoot: model.namedRoot
		}
	}), (model, path) => {
		if (path === "/title") return model.titleLine;
		for (let key = path; key; key = key.slice(0, key.lastIndexOf("/"))) {
			if (model.treeLines[key]) return model.treeLines[key];
			if (!key.includes("/")) break;
		}
		return null;
	}, {
		acceptsPresentation: true,
		honoredConfig: ["treemap.showValues", "treemap.valueFormat"]
	})
};
export { implementations, numeric_composition_exports };
