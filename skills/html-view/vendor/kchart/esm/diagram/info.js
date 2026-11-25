import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { error } from "./support.js";
// src/diagram/info.js
var info_exports = /* @__PURE__ */ __exportAll({ implementations: () => implementations });
function parse(body, info) {
	const errors = [];
	const issue = (line) => errors.push(error(info.lang, line, "info 只接受可选的 showInfo", "info only accepts the optional showInfo keyword", "使用 `info` 或 `info showInfo`", "Use `info` or `info showInfo`"));
	if (info.params && !/^showInfo$/i.test(info.params)) issue(info.headerLine);
	for (const [i, line] of body.split("\n").entries()) if (line.trim() && !/^showInfo$/i.test(line.trim())) issue(info.firstLine + i);
	return {
		model: null,
		errors
	};
}
function layout(_model, { ctx }) {
	const label = `KChart v0.4.0`;
	return { scene: {
		width: Math.ceil(ctx.measure(label, 13, 400)) + 24,
		height: 40,
		title: label,
		children: [ctx.text(12, 24, label, {
			size: 13,
			fill: ctx.color("muted")
		})]
	} };
}
var implementations = { info: {
	parse,
	layout,
	optionMode: "raw"
} };
export { implementations, info_exports };
