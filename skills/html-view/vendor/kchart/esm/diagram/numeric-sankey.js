import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { parseSankey as sankey } from "./numeric-parse.js";
import { render, validate } from "./numeric-common.js";
import "../chart/relations.js";
// src/diagram/numeric-sankey.js
var numeric_sankey_exports = /* @__PURE__ */ __exportAll({ implementations: () => implementations });
var implementations = { "sankey-beta": {
	parse: sankey,
	validate,
	layout: render
} };
export { implementations, numeric_sankey_exports };
