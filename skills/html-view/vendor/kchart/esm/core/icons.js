import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import icons_default from "../assets/icons.js";
// src/core/icons.js
var icons_exports = /* @__PURE__ */ __exportAll({
	geometry: () => geometry,
	has: () => has,
	registerIcons: () => registerIcons,
	resolve: () => resolve,
	resolveIconRef: () => resolveIconRef
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
var PAINT = /^(?:fill(?:-opacity|-rule)?|stroke(?:-width|-opacity|-linecap|-linejoin|-miterlimit|-dasharray|-dashoffset)?|opacity|color|paint-order)$/;
var NAME = /^[a-z\d]+(?:-[a-z\d]+)*$/;
function parseBody(body, normalize = false) {
	if (typeof body !== "string") throw new TypeError("图标几何数据非法");
	const elements = [], stack = [];
	const token = /<(\/?)([a-z]+)((?:\s(?:"[^"]*"|'[^']*'|[^<>"'])*?)?)(\/?)>/g;
	const attrPattern = /\s+([a-zA-Z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
	let end = 0;
	for (const match of body.matchAll(token)) {
		const [raw, close, tag, source, empty] = match;
		if (body.slice(end, match.index).trim() || !(TAGS.has(tag) || normalize && tag === "g")) throw new TypeError("图标包含不支持的 SVG 结构");
		end = match.index + raw.length;
		if (close) {
			if (empty || source.trim() || stack.pop() !== tag) throw new TypeError("图标包含不支持的 SVG 结构");
			continue;
		}
		if (stack.length && stack.at(-1) !== "g") throw new TypeError("图标包含不支持的 SVG 结构");
		const attrs = {};
		for (const [, key, double, single] of source.matchAll(attrPattern)) {
			if (normalize && PAINT.test(key)) continue;
			const value = double ?? single;
			if (tag === "g" || !ATTRS.has(key) || normalize && !(key === "d" ? /^[MmZzLlHhVvCcSsQqTtAaEe\d\s.,+-]+$/ : /^[Ee\d\s.,+-]+$/).test(value)) throw new TypeError(`图标包含不支持的 SVG 属性：${key}`);
			attrs[key] = value;
		}
		if (source.replace(attrPattern, "").trim()) throw new TypeError("图标属性格式非法");
		if (tag !== "g") elements.push(Object.freeze({
			tag,
			attrs: Object.freeze(attrs)
		}));
		if (!empty) stack.push(tag);
	}
	if (stack.length || body.slice(end).trim() || !elements.length) throw new TypeError("图标包含不支持的 SVG 结构");
	return Object.freeze(elements);
}
var registered = /* @__PURE__ */ new Map();
var cache = /* @__PURE__ */ new Map();
function resolve(name) {
	if (typeof name !== "string") return null;
	if (registered.has(name)) return registered.get(name);
	if (!Object.hasOwn(icons_default.icons, name)) return null;
	if (!cache.has(name)) {
		const { set, viewBox, body } = icons_default.icons[name];
		cache.set(name, Object.freeze({
			set,
			viewBox,
			elements: parseBody(body)
		}));
	}
	return cache.get(name);
}
var has = (name) => registered.has(name) || typeof name === "string" && Object.hasOwn(icons_default.icons, name);
function geometry(name) {
	return resolve(name);
}
var ALIASES = {
	"address-card": "id",
	"angle-left": "chevron-left",
	"angle-right": "chevron-right",
	bars: "list",
	"book-open": "book",
	"chart-column": "chart-bar",
	"camera-retro": "camera",
	"check-circle": "circle-check",
	"circle-info": "info-circle",
	"cloud-arrow-up": "cloud-upload",
	cog: "settings",
	cogwheel: "settings",
	"credit-card-alt": "credit-card",
	desktop: "device-desktop",
	"dots-grid": "grid-dots",
	envelope: "mail",
	"external-link": "link",
	"file-alt": "file-text",
	film: "video",
	fire: "flame",
	gear: "settings",
	"house": "home",
	"image": "photo",
	laptop: "device-desktop",
	lightbulb: "bulb",
	"magnify": "search",
	"map-marker": "map",
	"mobile-alt": "device-mobile",
	"people-group": "users-group",
	person: "user",
	"shield-alt": "shield",
	"shopping-basket": "shopping-cart",
	spinner: "refresh",
	"source-branch": "git-branch",
	"tachometer-alt": "gauge",
	"triangle-exclamation": "alert-triangle",
	"warning": "alert-triangle",
	"account": "user",
	"account-group": "users-group",
	"account-multiple": "users",
	"cellphone": "device-mobile",
	"delete": "trash",
	email: "mail",
	"file-document": "file-text",
	"monitor": "device-desktop",
	pencil: "tool",
	web: "world",
	"aws": "amazonwebservices",
	"google-cloud": "googlecloud",
	"node-js": "nodedotjs"
};
var aliasOf = (name) => Object.hasOwn(ALIASES, name) ? ALIASES[name] : name;
function resolveIconRef(ref) {
	if (typeof ref !== "string") return null;
	const value = ref.trim().toLowerCase();
	if (registered.has(value)) return registered.get(value);
	const match = /^(?:([a-z\d-]+):)?([a-z\d-]+)$/.exec(value.replace(/^fa\s+/, "fa:"));
	if (!match) return null;
	const [, prefix = "", raw] = match;
	if (/^fa[bsrlk]?$/.test(prefix)) return resolve(aliasOf(raw.replace(/^fa-/, "")));
	if (prefix === "tabler" || prefix === "simple-icons") {
		const icon = resolve(raw);
		return icon?.set === (prefix === "simple-icons" ? "simple" : prefix) ? icon : null;
	}
	return resolve(aliasOf(raw));
}
/** Register controlled Iconify geometry process-wide. A later registration replaces the same prefix:name. */
function registerIcons(iconifyJson) {
	const { prefix, icons, width = 16, height = 16 } = iconifyJson ?? {};
	if (typeof prefix !== "string" || !NAME.test(prefix) || !icons || typeof icons !== "object" || Array.isArray(icons)) throw new TypeError("Invalid Iconify icon set");
	const entries = Object.entries(icons).map(([name, icon]) => {
		const { body, width: w = width, height: h = height } = icon ?? {};
		if (!NAME.test(name) || !Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) throw new TypeError("Invalid Iconify icon dimensions or name");
		return [`${prefix}:${name}`, Object.freeze({
			set: prefix,
			viewBox: `0 0 ${w} ${h}`,
			elements: parseBody(body, true)
		})];
	});
	for (const [ref, icon] of entries) registered.set(ref, icon);
}
export { geometry, has, icons_exports, registerIcons, resolve, resolveIconRef };
