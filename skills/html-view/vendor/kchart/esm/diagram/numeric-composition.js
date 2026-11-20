import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { parsePie, parseTreemap } from "./numeric-parse.js";
import { renderWith, validateWith } from "./numeric-model.js";
import "../chart/composition.js";
// src/diagram/numeric-composition.js
var numeric_composition_exports = /* @__PURE__ */ __exportAll({ implementations: () => implementations });
function bind(parse, toSpec, lineFor, optionMode) {
	return {
		optionMode,
		parse,
		validate: (model, info) => validateWith(toSpec(model), info, (detail) => lineFor(model, detail.path)),
		layout: (model, options, info) => renderWith(toSpec(model), options, info, (detail) => lineFor(model, detail.path))
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
		}
	}), (model, path) => path === "/title" ? model.titleLine : model.rows[Number(path?.split("/")[2])]?.line || model.rows[0]?.line, "raw"),
	treemap: bind(parseTreemap, (model) => ({
		chart: "treemap",
		title: model.title || void 0,
		data: model.data
	}), (model, path) => {
		if (path === "/title") return model.titleLine;
		for (let key = path; key; key = key.slice(0, key.lastIndexOf("/"))) {
			if (model.treeLines[key]) return model.treeLines[key];
			if (!key.includes("/")) break;
		}
		return null;
	})
};
export { implementations, numeric_composition_exports };
