import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { parsePie as pie, parseTreemap as treemap } from "./numeric-parse.js";
import { render, validate } from "./numeric-common.js";
import "../chart/composition.js";
// src/diagram/numeric-composition.js
var numeric_composition_exports = /* @__PURE__ */ __exportAll({ implementations: () => implementations });
var bind = (parseFn) => ({
	parse: parseFn,
	validate: (model, info) => validate(model, info),
	layout: (model, options, info) => render(model, options, info)
});
var implementations = {
	pie: bind(pie),
	"treemap-beta": bind(treemap)
};
export { implementations, numeric_composition_exports };
