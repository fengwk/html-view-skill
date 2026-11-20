import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { createContext } from "./context.js";
import { el, escapeXml, hash, validateAttribute, validateLink, validateTag } from "./scene.js";
// src/core/svg.js
var svg_exports = /* @__PURE__ */ __exportAll({ renderScene: () => renderScene });
function serializeElement(node, prefix) {
	validateTag(node?.tag);
	const attrs = { ...node.attrs || {} };
	for (const key of Object.keys(attrs)) validateAttribute(key, {
		serialize: true,
		tag: node.tag
	});
	if (node.tag === "a") validateLink(attrs);
	if (attrs.id) attrs.id = `${prefix}-${attrs.id}`;
	for (const [key, value] of Object.entries(attrs)) {
		if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError(`Invalid SVG geometry: ${key}`);
		if ([
			"d",
			"points",
			"transform"
		].includes(key) && /NaN|Infinity/.test(String(value))) throw new TypeError(`Invalid SVG geometry: ${key}`);
		if ([
			"width",
			"height",
			"r",
			"rx",
			"ry"
		].includes(key) && Number(value) < 0) throw new TypeError(`Negative SVG dimension: ${key}`);
	}
	for (const [key, value] of Object.entries(attrs)) if (typeof value === "string" && key !== "href" && key !== "target" && key !== "rel") {
		if ((value.match(/url\([^)]*\)/gi) || []).some((ref) => !/^url\(\s*#[\w.-]+\s*\)$/i.test(ref))) throw new TypeError(`Unsafe SVG resource reference: ${key}`);
		attrs[key] = value.replace(/url\(\s*#([\w.-]+)\s*\)/g, `url(#${prefix}-$1)`);
	}
	for (const [key, value] of Object.entries(node.meta || {})) attrs[`data-kc-${key}`] = Array.isArray(value) || value && typeof value === "object" ? JSON.stringify(value) : String(value);
	const attrText = Object.entries(attrs).map(([key, value]) => {
		validateAttribute(key, {
			serialize: true,
			generated: true,
			tag: node.tag
		});
		return ` ${key}="${escapeXml(value)}"`;
	}).join("");
	const children = (node.children || []).map((child) => serializeElement(child, prefix)).join("");
	const text = node.text == null ? "" : escapeXml(node.text);
	return `<${node.tag}${attrText}>${text}${children}</${node.tag}>`;
}
function renderScene(scene, options = {}) {
	if (!scene || !Number.isFinite(scene.width) || !Number.isFinite(scene.height) || scene.width <= 0 || scene.height <= 0 || !Array.isArray(scene.children)) throw new TypeError("Invalid KChart scene");
	const prefix = String(options.prefix || `kc-${hash(JSON.stringify(scene))}`).replace(/[^A-Za-z0-9_-]/g, "-");
	const title = scene.title || "Chart", titleId = `${prefix}-title`;
	const desc = scene.description ? `<desc>${escapeXml(scene.description)}</desc>` : "";
	let nodes = scene.children, height = scene.height;
	const ctx = createContext({
		...options,
		width: scene.width
	});
	if (options.frame) {
		const header = [], footer = [];
		let top = 16;
		const paragraph = (target, value, y, size, weight = 400) => {
			if (!value) return y;
			const lines = ctx.wrap(value, Math.max(24, scene.width - 32), size, weight), step = size + 6;
			lines.forEach((line, i) => target.push(ctx.text(16, y + size + i * step, line, {
				size,
				weight,
				fill: weight > 400 ? ctx.color("fg") : ctx.color("muted")
			})));
			return y + lines.length * step + 6;
		};
		top = paragraph(header, scene.heading, top, 16, 650);
		top = paragraph(header, scene.subtitle, top, 12);
		if (header.length) top += 8;
		let bottom = top + scene.height + 12;
		bottom = paragraph(footer, scene.source, bottom, 12);
		bottom = paragraph(footer, scene.note, bottom, 12);
		height = bottom + 12;
		nodes = [
			ctx.rect(0, 0, scene.width, height, { fill: ctx.color("bg") }),
			...header,
			el("g", { transform: `translate(0 ${top})` }, scene.children),
			...footer
		];
	}
	const body = nodes.map((child) => serializeElement(child, prefix)).join("");
	const anchor = scene.anchor && Number.isFinite(scene.anchor.x) && Number.isFinite(scene.anchor.y) ? ` data-kchart-anchor-x="${scene.anchor.x}" data-kchart-anchor-y="${scene.anchor.y}"` : "";
	const font = escapeXml(ctx.fontFamily);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${height}" viewBox="0 0 ${scene.width} ${height}"${anchor} font-family="${font}" role="img" aria-labelledby="${titleId}"><title id="${titleId}">${escapeXml(title)}</title>${desc}${body}</svg>`;
}
export { renderScene, svg_exports };
