import { __exportAll } from "../_virtual/_rolldown/runtime.js";
// src/core/color.js
var color_exports = /* @__PURE__ */ __exportAll({
	contrast: () => contrast,
	deltaE2000: () => deltaE2000,
	isHex: () => isHex,
	luminance: () => luminance,
	mix: () => mix,
	pushContrast: () => pushContrast,
	simulateCvd: () => simulateCvd,
	tint: () => tint
});
var isHex = (value) => typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
var clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function mix(colorA, colorB, ratio) {
	if (!isHex(colorA) || !isHex(colorB)) throw new TypeError("mix 需要 #RRGGBB 颜色");
	const amount = Number(ratio);
	if (!Number.isFinite(amount)) throw new TypeError("mix 比例必须是有限数");
	const t = clamp(amount, 0, 1);
	const channel = (hex, shift) => parseInt(hex.slice(1 + shift, 3 + shift), 16);
	return `#${[
		0,
		2,
		4
	].map((shift) => Math.round(channel(colorA, shift) * (1 - t) + channel(colorB, shift) * t).toString(16).padStart(2, "0")).join("")}`;
}
function luminance(hex) {
	if (!isHex(hex)) throw new TypeError("颜色必须是 #RRGGBB");
	const [r, g, b] = linearRgb(hex);
	return .2126 * r + .7152 * g + .0722 * b;
}
var contrast = (colorA, colorB) => {
	const [high, low] = [luminance(colorA), luminance(colorB)].sort((a, b) => b - a);
	return (high + .05) / (low + .05);
};
function pushContrast(color, toward, against, min) {
	if (contrast(color, against) >= min) return color;
	let low = 0;
	let high = 1;
	for (let i = 0; i < 12; i += 1) {
		const middle = (low + high) / 2;
		if (contrast(mix(color, toward, middle), against) >= min) high = middle;
		else low = middle;
	}
	return mix(color, toward, high);
}
var toLin = (c) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
var fromLin = (c) => c <= .0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - .055;
var hexToRgb = (hex) => [
	1,
	3,
	5
].map((i) => parseInt(hex.slice(i, i + 2), 16));
var linearRgb = (hex) => hexToRgb(hex).map((v) => toLin(v / 255));
var rgbToHex = (rgb) => `#${rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("")}`;
var labOf = (hex) => {
	const [r, g, b] = linearRgb(hex);
	const x = (.4124564 * r + .3575761 * g + .1804375 * b) / .95047;
	const y = .2126729 * r + .7151522 * g + .072175 * b;
	const z = (.0193339 * r + .119192 * g + .9503041 * b) / 1.08883;
	const f = (t) => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
	return [
		116 * f(y) - 16,
		500 * (f(x) - f(y)),
		200 * (f(y) - f(z))
	];
};
function deltaE2000(x, y) {
	const [L1, a1, b1] = labOf(x);
	const [L2, a2, b2] = labOf(y);
	const rad = Math.PI / 180;
	const Cbar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
	const G = .5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
	const a1p = (1 + G) * a1;
	const a2p = (1 + G) * a2;
	const C1p = Math.hypot(a1p, b1);
	const C2p = Math.hypot(a2p, b2);
	let h1p = Math.atan2(b1, a1p) / rad;
	let h2p = Math.atan2(b2, a2p) / rad;
	if (h1p < 0) h1p += 360;
	if (h2p < 0) h2p += 360;
	const dLp = L2 - L1;
	const dCp = C2p - C1p;
	let dhp = 0;
	if (C1p * C2p !== 0) {
		dhp = h2p - h1p;
		if (dhp > 180) dhp -= 360;
		else if (dhp < -180) dhp += 360;
	}
	const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * rad / 2);
	const Lbar = (L1 + L2) / 2;
	const CbarP = (C1p + C2p) / 2;
	let hbar = h1p + h2p;
	if (C1p * C2p !== 0) hbar = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + 360) / 2 : (h1p + h2p) / 2;
	const T = 1 - .17 * Math.cos((hbar - 30) * rad) + .24 * Math.cos(2 * hbar * rad) + .32 * Math.cos((3 * hbar + 6) * rad) - .2 * Math.cos((4 * hbar - 63) * rad);
	const dTheta = 30 * Math.exp(-(((hbar - 275) / 25) ** 2));
	const RC = 2 * Math.sqrt(CbarP ** 7 / (CbarP ** 7 + 25 ** 7));
	const SL = 1 + .015 * (Lbar - 50) ** 2 / Math.sqrt(20 + (Lbar - 50) ** 2);
	const SC = 1 + .045 * CbarP;
	const SH = 1 + .015 * CbarP * T;
	const RT = -Math.sin(2 * dTheta * rad) * RC;
	return Math.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH));
}
var CVD = {
	protan: [
		[
			.152286,
			1.052583,
			-.204868
		],
		[
			.114503,
			.786281,
			.099216
		],
		[
			-.003882,
			-.048116,
			1.051998
		]
	],
	deutan: [
		[
			.367322,
			.860646,
			-.227968
		],
		[
			.280085,
			.672501,
			.047413
		],
		[
			-.01182,
			.04294,
			.968881
		]
	]
};
function simulateCvd(hex, type) {
	if (!isHex(hex)) throw new TypeError("颜色必须是 #RRGGBB");
	const matrix = CVD[type];
	if (!matrix) return hex;
	const linear = linearRgb(hex);
	return rgbToHex(matrix.map((row) => fromLin(clamp(row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2], 0, 1)) * 255));
}
var toOklab = (hex) => {
	const [r, g, b] = linearRgb(hex);
	const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
	const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
	const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
	return [
		.2104542553 * l + .793617785 * m - .0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + .4505937099 * s,
		.0259040371 * l + .7827717662 * m - .808675766 * s
	];
};
var fromOklab = ([L, a, b]) => {
	const l = (L + .3963377774 * a + .2158037573 * b) ** 3;
	const m = (L - .1055613458 * a - .0638541728 * b) ** 3;
	const s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
	return rgbToHex([
		4.0767416621 * l - 3.3077115913 * m + .2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
		-.0041960863 * l - .7034186147 * m + 1.707614701 * s
	].map((v) => fromLin(clamp(v, 0, 1)) * 255));
};
var oklch = (hex) => {
	const [L, a, b] = toOklab(hex);
	return [
		L,
		Math.hypot(a, b),
		Math.atan2(b, a) * 180 / Math.PI
	];
};
function tint(paper, color, ratio, style) {
	if (!style) return mix(paper, color, ratio);
	if (!isHex(paper) || !isHex(color)) throw new TypeError("tint 需要 #RRGGBB 颜色");
	const amount = Number(ratio);
	if (!Number.isFinite(amount)) throw new TypeError("tint 比例必须是有限数");
	const t = clamp(amount, 0, 1);
	if (t === 0) return paper;
	if (t === 1) return color;
	const [L2, C2, h2] = oklch(color);
	if (C2 < .04) return mix(paper, color, t);
	const [L1, C1] = oklch(paper);
	let turn = h2 - style.hue;
	if (turn > 180) turn -= 360;
	else if (turn < -180) turn += 360;
	const L = L1 + (L2 - L1) * t, C = (C1 + (C2 - C1) * t) * style.chroma, h = (style.hue + turn * t) * Math.PI / 180;
	return fromOklab([
		L,
		C * Math.cos(h),
		C * Math.sin(h)
	]);
}
export { color_exports, contrast, deltaE2000, isHex, luminance, mix, pushContrast, simulateCvd, tint };
