import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { error, warning } from "./support.js";
import { normalizeLabel } from "./label.js";
import { validate } from "../chart/spec.js";
import { layout } from "../chart/registry.js";
import { ExpectedDiagnostic } from "../core/diagnostics.js";
// src/diagram/numeric-model.js
var numeric_model_exports = /* @__PURE__ */ __exportAll({
	diagnostics: () => diagnostics,
	numericLabel: () => numericLabel,
	renderWith: () => renderWith,
	validateWith: () => validateWith
});
function diagnostics(errors, info, lineFor) {
	return errors.map((detail) => error(info.lang, lineFor(detail) || info.firstLine, detail.message || "KChart 声明无效", detail.message || "Invalid KChart declaration", detail.fix || "修正图表声明", detail.fix || "Correct the chart declaration"));
}
function validateWith(spec, info, lineFor) {
	return diagnostics(validate(spec).errors, info, lineFor);
}
function addVisibleHeader(scene, options) {
	if (options.renderOptions?.frame) return scene;
	const { ctx } = options;
	const heading = options.embedHeading ? "" : scene.heading || "";
	const subtitle = scene.subtitle || "";
	if (!heading && !subtitle) return scene;
	const available = Math.max(24, scene.width - 32), children = [];
	let top = 16, requiredWidth = scene.width;
	const paragraph = (text, size, weight) => {
		if (!text) return;
		const lines = ctx.wrap(text, available, size, weight), step = size + 6;
		requiredWidth = Math.max(requiredWidth, 32 + Math.max(0, ...lines.map((line) => ctx.measure(line, size, weight))));
		children.push(ctx.textLines(16, top + size, lines, {
			leading: step,
			size,
			weight,
			fill: ctx.color(weight > 400 ? "fg" : "muted")
		}));
		top += lines.length * step + 6;
	};
	paragraph(heading, 16, 650);
	paragraph(subtitle, 12, 400);
	top += 8;
	return {
		...scene,
		width: requiredWidth,
		height: scene.height + top,
		children: [...children, ctx.el("g", { transform: `translate(0 ${top})` }, scene.children)]
	};
}
function renderWith(spec, options, info, lineFor, layoutSpec = layout) {
	const layoutOptions = {
		...options.renderOptions,
		width: options.width,
		lang: info.lang,
		...!options.renderOptions?.measure && options.measure ? { measure: (text, size = 12, weight = 400) => options.measure(text, {
			size,
			weight
		}) } : {}
	};
	try {
		const scene = addVisibleHeader(layoutSpec(spec, layoutOptions), options);
		return {
			width: scene.width,
			height: scene.height,
			scene,
			errors: []
		};
	} catch (error) {
		if (!(error instanceof ExpectedDiagnostic)) throw error;
		return {
			width: options.width,
			height: 0,
			errors: diagnostics(error.errors || [], info, lineFor)
		};
	}
}
function numericLabel(value, info, line, errors) {
	const { text, icon, diagnostics } = normalizeLabel(value, {
		lang: info.lang,
		line
	});
	if (icon) diagnostics.push(warning("IGNORED_ASSET", info.lang, line, "数值图标签仅绘制文字，不绘制图标", "Numeric chart labels show text only; icons are omitted", "改用纯文本标签", "Use a text label"));
	for (const diagnostic of diagnostics) if (!errors.some((e) => e.message === diagnostic.message)) errors.push(diagnostic);
	return text.trim() || String(value);
}
export { diagnostics, numericLabel, numeric_model_exports, renderWith, validateWith };
