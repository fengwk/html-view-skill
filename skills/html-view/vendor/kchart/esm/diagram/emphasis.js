import { __exportAll } from "../_virtual/_rolldown/runtime.js";
// src/diagram/emphasis.js
var emphasis_exports = /* @__PURE__ */ __exportAll({ stripEmphasis: () => stripEmphasis });
function stripEmphasis(text) {
	return String(text).replace(/\*\*([\s\S]*?)\*\*/g, "$1").replace(/(^|[^\p{L}\p{N}_])__(?=\S)([\s\S]*?\S)__(?![\p{L}\p{N}_])/gu, "$1$2").replace(/\*([^*]+)\*/g, "$1").replace(/(^|[^\p{L}\p{N}_])_(?=\S)([^_\n]*?\S)_(?![\p{L}\p{N}_])/gu, "$1$2");
}
export { emphasis_exports, stripEmphasis };
