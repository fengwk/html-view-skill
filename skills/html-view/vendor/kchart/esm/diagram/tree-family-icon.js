import { __exportAll } from "../_virtual/_rolldown/runtime.js";
// src/diagram/tree-family-icon.js
var tree_family_icon_exports = /* @__PURE__ */ __exportAll({ labelIcon: () => labelIcon });
function labelIcon(ctx, icon, x, y, size, ink) {
	const [l, t, w, h] = icon.viewBox.split(/\s+/).map(Number);
	const scale = size / Math.max(w, h);
	const paint = icon.set === "tabler" ? {
		fill: "none",
		stroke: ink,
		"stroke-width": 1.8,
		"stroke-linecap": "round",
		"stroke-linejoin": "round"
	} : { fill: ink };
	return {
		...ctx.el("g", { transform: `translate(${x - (l + w / 2) * scale} ${y - (t + h / 2) * scale}) scale(${scale})` }, icon.elements.map(({ tag, attrs }) => ctx.shape(tag, {
			...attrs,
			...paint
		}))),
		meta: { kind: "icon" }
	};
}
export { labelIcon, tree_family_icon_exports };
