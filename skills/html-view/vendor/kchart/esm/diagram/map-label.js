import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { normalizeLabel } from "./label.js";
// src/diagram/map-label.js
var map_label_exports = /* @__PURE__ */ __exportAll({
	mapConfig: () => mapConfig,
	mapIcon: () => mapIcon,
	mapLabels: () => mapLabels
});
function mapLabels(lang, report) {
	const seen = /* @__PURE__ */ new Set();
	return (raw, line) => {
		const { text, icon, diagnostics } = normalizeLabel(raw, {
			lang,
			line
		});
		for (const diagnostic of diagnostics) {
			const key = `${diagnostic.code}:${diagnostic.message}`;
			if (!seen.has(key)) {
				seen.add(key);
				report(diagnostic);
			}
		}
		return {
			text,
			icon
		};
	};
}
function mapIcon(ctx, icon, x, y, ink) {
	const [left, top, width, height] = icon.viewBox.split(/\s+/).map(Number);
	const scale = 14 / Math.max(width, height), solid = icon.set === "simple";
	return ctx.el("g", {
		transform: `translate(${x} ${y}) scale(${scale}) translate(${-left - width / 2} ${-top - height / 2})`,
		fill: solid ? ink : "none",
		stroke: solid ? "none" : ink,
		"stroke-width": 1.6,
		"stroke-linecap": "round",
		"stroke-linejoin": "round"
	}, icon.elements.map(({ tag, attrs }) => ctx.shape(tag, attrs)));
}
function mapConfig(config, key) {
	return Object.entries(config ?? {}).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1];
}
export { mapConfig, mapIcon, mapLabels, map_label_exports };
