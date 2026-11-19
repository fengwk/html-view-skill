import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { parseXy as xy } from "./numeric-parse.js";
import { render, validate } from "./numeric-common.js";
import "../chart/basic.js";
import "../chart/multivariate.js";
// src/diagram/numeric-xy.js
var numeric_xy_exports = /* @__PURE__ */ __exportAll({ implementations: () => implementations });
var parse = (body, info) => xy(body, info);
var implementations = { xychart: {
	parse,
	validate: (model, info) => validate(model, info),
	layout: (model, options, info) => render(model, options, info)
} };
export { implementations, numeric_xy_exports };
