import { __exportAll } from "../_virtual/_rolldown/runtime.js";
// src/core/scene.js
var scene_exports = /* @__PURE__ */ __exportAll({
	allowedTags: () => allowedTags,
	containText: () => containText,
	el: () => el,
	escapeXml: () => escapeXml,
	hash: () => hash,
	primitive: () => primitive,
	safeAttrs: () => safeAttrs,
	validateAttribute: () => validateAttribute,
	validateTag: () => validateTag
});
var allowedTags = /* @__PURE__ */ new Set([
	"g",
	"rect",
	"circle",
	"ellipse",
	"line",
	"polyline",
	"polygon",
	"path",
	"text",
	"tspan",
	"defs",
	"marker",
	"linearGradient",
	"stop",
	"clipPath",
	"title",
	"desc"
]);
var safeAttrs = new Set("id class x y x1 y1 x2 y2 cx cy r rx ry width height d points dx dy rotate fill fill-opacity fill-rule clip-rule stroke stroke-width stroke-opacity stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit marker-start marker-mid marker-end markerWidth markerHeight markerUnits refX refY orient opacity transform text-anchor dominant-baseline font-family font-size font-weight font-style letter-spacing text-decoration textLength lengthAdjust paint-order viewBox preserveAspectRatio offset stop-color stop-opacity gradientUnits gradientTransform clip-path vector-effect pointer-events role aria-label aria-labelledby aria-describedby".split(" "));
var escapeXml = (value) => String(value).replace(/[&<>"']/g, (ch) => ({
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	"\"": "&quot;",
	"'": "&apos;"
})[ch]);
function hash(text) {
	let h = 2166136261;
	for (const ch of String(text)) {
		h ^= ch.codePointAt(0);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(36);
}
function validateTag(tag) {
	if (!allowedTags.has(tag)) throw new TypeError(`Unsafe SVG tag: ${tag}`);
	return tag;
}
function validateAttribute(key, { serialize = false, generated = false } = {}) {
	if (/^on/i.test(key) || !generated && !safeAttrs.has(key) || (serialize ? /^(?:href|xlink:href|style)$/i.test(key) : [
		"style",
		"href",
		"xlink:href"
	].includes(key)) || serialize && !/^(?:[a-zA-Z][\w:-]*)$/.test(key)) throw new TypeError(`Unsafe SVG attribute: ${key}`);
	return key;
}
function el(tag, attrs = {}, children = []) {
	validateTag(tag);
	const safe = {};
	for (const [key, value] of Object.entries(attrs || {})) {
		if (value == null) continue;
		validateAttribute(key);
		safe[key] = value;
	}
	return {
		tag,
		attrs: safe,
		...children?.length ? { children: [...children] } : {}
	};
}
var primitive = (tag, attrs, meta) => {
	const { meta: ignored, ...rest } = attrs || {};
	return {
		...el(tag, rest),
		...meta ? { meta } : {}
	};
};
var IDENTITY = [
	1,
	0,
	0,
	1,
	0,
	0
];
var multiply = (m, n) => [
	m[0] * n[0] + m[2] * n[1],
	m[1] * n[0] + m[3] * n[1],
	m[0] * n[2] + m[2] * n[3],
	m[1] * n[2] + m[3] * n[3],
	m[0] * n[4] + m[2] * n[5] + m[4],
	m[1] * n[4] + m[3] * n[5] + m[5]
];
function parseTransform(value) {
	let matrix = IDENTITY;
	for (const [, name, body] of String(value || "").matchAll(/(translate|scale|matrix)\(([^)]*)\)/g)) {
		const n = body.split(/[\s,]+/).filter(Boolean).map(Number);
		if (name === "translate") matrix = multiply(matrix, [
			1,
			0,
			0,
			1,
			n[0] || 0,
			n[1] || 0
		]);
		else if (name === "scale") matrix = multiply(matrix, [
			n[0] ?? 1,
			0,
			0,
			n[1] ?? n[0] ?? 1,
			0,
			0
		]);
		else if (n.length === 6) matrix = multiply(matrix, n);
	}
	return matrix;
}
var NON_RENDERED = /* @__PURE__ */ new Set([
	"defs",
	"marker",
	"clipPath",
	"title",
	"desc",
	"linearGradient"
]);
function textExtent(scene, measure, blockPadding) {
	let box = null;
	const grow = (x, y) => {
		box = box ? {
			x0: Math.min(box.x0, x),
			y0: Math.min(box.y0, y),
			x1: Math.max(box.x1, x),
			y1: Math.max(box.y1, y)
		} : {
			x0: x,
			y0: y,
			x1: x,
			y1: y
		};
	};
	const visit = (node, parent) => {
		if (!node || NON_RENDERED.has(node.tag) || Number(node.attrs?.opacity) === 0) return;
		const matrix = multiply(parent, parseTransform(node.attrs?.transform));
		if (node.tag === "text" && String(node.text ?? "").trim()) {
			const attrs = node.attrs || {}, size = Number(attrs["font-size"]) || 12;
			const width = measure(String(node.text), size, Number(attrs["font-weight"]) || 400);
			const x = (Number(attrs.x) || 0) + (Number(attrs.dx) || 0), y = (Number(attrs.y) || 0) + (Number(attrs.dy) || 0);
			const left = attrs["text-anchor"] === "middle" ? x - width / 2 : attrs["text-anchor"] === "end" ? x - width : x;
			const baseline = attrs["dominant-baseline"];
			const [top, bottom] = ["middle", "central"].includes(baseline) ? [y - size / 2, y + size / 2] : ["hanging", "text-before-edge"].includes(baseline) ? [y, y + size] : [y - size * .8, y + size * .2];
			const y0 = top - blockPadding, y1 = bottom + blockPadding;
			for (const [px, py] of [
				[left, y0],
				[left + width, y0],
				[left, y1],
				[left + width, y1]
			]) grow(matrix[0] * px + matrix[2] * py + matrix[4], matrix[1] * px + matrix[3] * py + matrix[5]);
		}
		for (const child of node.children || []) visit(child, matrix);
	};
	for (const child of scene.children) visit(child, IDENTITY);
	return box;
}
function containText(scene, measure, { blockPadding = 0 } = {}) {
	const box = textExtent(scene, measure, blockPadding);
	if (!box) return scene;
	const beyond = (value) => value > .5 ? Math.ceil(value) : 0;
	const left = beyond(-box.x0), top = beyond(-box.y0), right = beyond(box.x1 - scene.width), bottom = beyond(box.y1 - scene.height);
	if (!left && !top && !right && !bottom) return scene;
	const anchor = scene.anchor ? {
		...scene.anchor,
		x: scene.anchor.x + left,
		y: scene.anchor.y + top
	} : scene.anchor;
	return {
		...scene,
		width: scene.width + left + right,
		height: scene.height + top + bottom,
		children: left || top ? [el("g", { transform: `translate(${left} ${top})` }, scene.children)] : scene.children,
		...anchor ? { anchor } : {},
		overflow: {
			left,
			top,
			right,
			bottom
		}
	};
}
export { allowedTags, containText, el, escapeXml, hash, primitive, safeAttrs, scene_exports, validateAttribute, validateTag };
