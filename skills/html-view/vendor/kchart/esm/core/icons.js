import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import icons_default from "../assets/icons.js";
// src/core/icons.js
var icons_exports = /* @__PURE__ */ __exportAll({
	geometry: () => geometry,
	has: () => has,
	resolve: () => resolve
});
var TAGS = /* @__PURE__ */ new Set([
	"path",
	"circle",
	"ellipse",
	"rect",
	"line",
	"polyline",
	"polygon"
]);
var ATTRS = /* @__PURE__ */ new Set([
	"d",
	"cx",
	"cy",
	"r",
	"rx",
	"ry",
	"x",
	"y",
	"width",
	"height",
	"x1",
	"y1",
	"x2",
	"y2",
	"points"
]);
if (!icons_default || typeof icons_default !== "object" || !icons_default.icons || typeof icons_default.icons !== "object") throw new TypeError("缺少受控图标数据");
function parseBody(body) {
	if (typeof body !== "string") throw new TypeError("图标几何数据非法");
	const elements = [];
	const token = /<([a-z]+)(\s[^<>]*?)?\s*\/>/g;
	let end = 0;
	for (const match of body.matchAll(token)) {
		if (body.slice(end, match.index).trim()) throw new TypeError("图标包含不支持的 SVG 结构");
		const tag = match[1];
		if (!TAGS.has(tag)) throw new TypeError(`图标包含不支持的 SVG 元素：${tag}`);
		const attrs = {};
		const source = match[2] || "";
		const attrPattern = /([a-zA-Z][\w-]*)\s*=\s*"([^"]*)"/g;
		let consumed = "";
		for (const attr of source.matchAll(attrPattern)) {
			if (!ATTRS.has(attr[1])) throw new TypeError(`图标包含不支持的 SVG 属性：${attr[1]}`);
			attrs[attr[1]] = attr[2];
			consumed += attr[0];
		}
		if (source.replace(attrPattern, "").trim()) throw new TypeError("图标属性格式非法");
		elements.push({
			tag,
			attrs
		});
		end = match.index + match[0].length;
	}
	if (body.slice(end).trim()) throw new TypeError("图标包含不支持的 SVG 结构");
	if (!elements.length) throw new TypeError("图标没有几何元素");
	return elements;
}
var cache = /* @__PURE__ */ new Map();
function resolve(name) {
	if (typeof name !== "string") return null;
	const source = icons_default.icons[name];
	if (!source) return null;
	if (!cache.has(name)) cache.set(name, Object.freeze({
		set: source.set,
		viewBox: source.viewBox,
		elements: Object.freeze(parseBody(source.body).map((element) => Object.freeze({
			...element,
			attrs: Object.freeze(element.attrs)
		})))
	}));
	return cache.get(name);
}
var has = (name) => typeof name === "string" && Object.hasOwn(icons_default.icons, name);
function geometry(name) {
	return resolve(name);
}
export { geometry, has, icons_exports, resolve };
