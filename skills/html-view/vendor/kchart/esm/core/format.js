import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { decimalsFor } from "./scale.js";
// src/core/format.js
var format_exports = /* @__PURE__ */ __exportAll({
	compactTemporal: () => compactTemporal,
	decimalRound: () => decimalRound,
	formatPercent: () => formatPercent,
	formatValue: () => formatValue,
	isEnglish: () => isEnglish,
	makeFormatters: () => makeFormatters,
	quantityParts: () => quantityParts,
	tickTexts: () => tickTexts
});
var isEnglish = (lang) => !/^zh\b/i.test(String(lang || "zh"));
var localeOf = (lang) => {
	const tag = String(lang || "").trim();
	return !tag || /^zh\b/i.test(tag) ? "zh-CN" : tag;
};
function compactTemporal(labels, lang = "zh") {
	let previousYear = null;
	const locale = localeOf(lang);
	const english = isEnglish(lang);
	return Array.from(labels || [], (raw) => {
		const label = String(raw ?? "");
		const match = /^(\d{4})-(\d{2})$/.exec(label);
		if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return {
			label,
			year: ""
		};
		const year = Number(match[1]), month = Number(match[2]);
		const monthLabel = new Intl.DateTimeFormat(locale, {
			month: "short",
			timeZone: "UTC"
		}).format(new Date(Date.UTC(year, month - 1, 1)));
		const yearLabel = previousYear === year ? "" : english ? String(year) : `${year}年`;
		previousYear = year;
		return {
			label: monthLabel,
			year: yearLabel
		};
	});
}
var trim = (value) => String(value ?? "").trim();
var HAN_START = /^\p{Script=Han}/u;
function decimalRound(value, digits, shift = 0) {
	const [mantissa, exponent = "0"] = Math.abs(value).toString().split("e");
	const shifted = Number(`${mantissa}e${Number(exponent) + digits + shift}`);
	if (!Number.isFinite(shifted)) return value * 10 ** shift;
	const [whole, scale = "0"] = Math.round(shifted).toString().split("e");
	const rounded = Number(`${whole}e${Number(scale) - digits}`);
	return rounded === 0 ? 0 : Math.sign(value) * rounded;
}
function makeFormatters(lang) {
	const locale = localeOf(lang), cache = /* @__PURE__ */ new Map();
	const numberFormat = (min, max) => {
		const key = `${min}|${max}`;
		if (!cache.has(key)) cache.set(key, new Intl.NumberFormat(locale, {
			minimumFractionDigits: min,
			maximumFractionDigits: max
		}));
		return cache.get(key);
	};
	const clamp = (digits) => Math.max(0, Math.min(6, Number(digits) || 0));
	return {
		lang: String(lang || "zh"),
		decimals: 0,
		percentDecimals: 1,
		fixed(value, digits) {
			const d = clamp(digits);
			return numberFormat(d, d).format(value);
		},
		atMost(value, digits) {
			return numberFormat(0, clamp(digits)).format(value);
		}
	};
}
var englishScales = [
	{
		threshold: 1e9,
		scale: 1e9,
		suffix: "B"
	},
	{
		threshold: 1e6,
		scale: 1e6,
		suffix: "M"
	},
	{
		threshold: 1e4,
		scale: 1e3,
		suffix: "K"
	}
];
var chineseScales = [{
	threshold: 1e8,
	scale: 1e8,
	suffix: "亿"
}, {
	threshold: 1e4,
	scale: 1e4,
	suffix: "万"
}];
function unitScaleOf(magnitude, lang) {
	return (isEnglish(lang) ? englishScales : chineseScales).find(({ threshold }) => magnitude >= threshold) ?? {
		scale: 1,
		suffix: ""
	};
}
function quantityParts(value, lang, digitsOf) {
	const abs = Math.abs(value);
	let unit = unitScaleOf(abs, lang);
	while (true) {
		const digits = digitsOf(unit.scale);
		const scaled = decimalRound(abs, Math.min(6, digits), -Math.log10(unit.scale));
		const next = unitScaleOf(scaled * unit.scale, lang);
		if (next.scale <= unit.scale) return {
			scaled,
			digits,
			scale: unit.scale,
			suffix: unit.suffix,
			sign: value < 0 && scaled !== 0 ? "-" : ""
		};
		unit = next;
	}
}
function formatQuantity(value, f, declared) {
	function digitsOf(scale) {
		if (declared != null) return declared;
		return scale === 1 ? Math.max(0, Math.min(4, Number(f.decimals) || 0)) : 1;
	}
	const { scaled, suffix, digits, sign } = quantityParts(value, f.lang, digitsOf);
	return `${sign}${f.fixed(scaled, digits)}${suffix}`;
}
function formatValue(value, unit, f, decimals = null) {
	if (value == null || !Number.isFinite(value)) return "—";
	const suffix = trim(unit);
	const declared = decimals == null ? null : Math.max(0, Math.min(6, Number(decimals) || 0));
	if (suffix === "%") {
		const digits = declared == null ? Math.max(0, Math.min(6, Number(f.decimals) || 0)) : declared;
		const rounded = decimalRound(Math.abs(value), digits);
		return `${value < 0 && rounded !== 0 ? "-" : ""}${f.fixed(rounded, digits)}%`;
	}
	const text = formatQuantity(value, f, declared);
	return suffix ? `${text}${suffix === "%" ? "" : `${HAN_START.test(suffix) ? "" : " "}${suffix}`}` : text;
}
function formatPercent(value, f, decimals = null) {
	if (!Number.isFinite(value)) return "—";
	const digits = Math.max(0, Math.min(2, Number(decimals == null ? f.percentDecimals == null ? 1 : f.percentDecimals : decimals) || 0));
	const threshold = 10 ** -digits;
	if (value > 0 && value < threshold) return `<${f.fixed(threshold, digits)}%`;
	const rounded = decimalRound(Math.abs(value), digits);
	return `${value < 0 && rounded !== 0 ? "-" : ""}${f.fixed(rounded, digits)}%`;
}
function tickTexts(ticks, step, f, unit = null, { percentSymbol = true } = {}) {
	if (trim(unit) === "%") {
		const digits = decimalsFor(Math.abs(step));
		const suffix = percentSymbol ? "%" : "";
		return ticks.map((tick) => `${f.atMost(Number(tick.toFixed(Math.min(6, digits))) || 0, digits)}${suffix}`);
	}
	const scale = unitScaleOf(ticks.reduce((max, tick) => Math.max(max, Math.abs(tick)), 0), f.lang);
	const digits = decimalsFor(Math.abs(step) / scale.scale);
	return ticks.map((tick) => {
		const rounded = Number((tick / scale.scale).toFixed(Math.min(6, digits)));
		return rounded === 0 ? "0" : `${f.atMost(rounded, digits)}${scale.suffix}`;
	});
}
export { compactTemporal, decimalRound, formatPercent, formatValue, format_exports, isEnglish, makeFormatters, quantityParts, tickTexts };
