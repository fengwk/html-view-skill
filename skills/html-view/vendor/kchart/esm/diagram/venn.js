import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { FONT, appearance, error, fallbackMeasure, labelText, warning, wrapText } from "./support.js";
// src/diagram/venn.js
var venn_exports = /* @__PURE__ */ __exportAll({ implementations: () => implementations });
var MARGIN = 24;
var TITLE_LINE = 20;
var TITLE_GAP = 12;
var HEAD_LINE = 18;
var ITEM_LINE = 16;
var ITEM_GAP = 4;
var SET_CLEAR = 12;
var UNION_CLEAR = 10;
var INK_GAP = 4;
var CHIP_Y = 2;
var SHELF_GAP = 26;
var SHELF_PITCH = 28;
var LEADER = 8;
var GRID_PAD = 14;
var GRID_GAP = 16;
var GRID_MIN_W = 168;
var GRID_COLS = 3;
var ITEM_CAP = 12;
var SIZE_DEFAULT = 10;
var RING_STROKE = 1.5;
var SPREADS = 17;
var GROW = 1.12;
var MAX_GROWTH = 6;
var PLOT_H = 460;
var PARTS_HINT = 60;
var RING_MAX = 3;
var PAIR_SHARE = .55;
var TRIANGLE_MIN = .55;
var TITLE_FONT = {
	size: FONT.title.size,
	weight: FONT.title.weight
};
var SET_FONT = {
	size: FONT.title.size,
	weight: FONT.title.weight
};
var ITEM_FONT = {
	size: FONT.label.size,
	weight: FONT.label.weight
};
function stripComment(line) {
	let quote = false;
	for (let i = 0; i < line.length; i += 1) {
		if (line[i] === "\"") {
			quote = !quote;
			continue;
		}
		if (!quote && line[i] === "%" && line[i + 1] === "%") return line.slice(0, i);
	}
	return line;
}
var IDENT = /^"([^"]*)"|^([A-Za-z_][\w-]*)/;
var BLANK = /^[ \t]*/;
function readIdent(text, at) {
	const cursor = at + BLANK.exec(text.slice(at))[0].length;
	const match = IDENT.exec(text.slice(cursor));
	return match ? {
		id: match[1] ?? match[2],
		at: cursor + match[0].length
	} : null;
}
function keywordOf(text) {
	const match = /^[A-Za-z][\w-]*/.exec(text);
	return match ? {
		word: match[0].toLowerCase(),
		at: match[0].length
	} : {
		word: "",
		at: 0
	};
}
function readIdents(text, at) {
	const ids = [];
	let cursor = at;
	for (;;) {
		const ident = readIdent(text, cursor);
		if (!ident) break;
		if (/^\s*:/.test(text.slice(ident.at))) break;
		ids.push(ident.id);
		const after = ident.at + BLANK.exec(text.slice(ident.at))[0].length;
		if (text[after] !== ",") {
			cursor = ident.at;
			break;
		}
		cursor = after + 1;
	}
	const end = ids.length ? cursor : at;
	return {
		ids,
		at: end + BLANK.exec(text.slice(end))[0].length
	};
}
function readLabel(text, at) {
	const match = /^\[([^\]]*)\]/.exec(text.slice(at));
	if (!match) return {
		label: null,
		at
	};
	let value = match[1];
	if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) value = value.slice(1, -1);
	return {
		label: value.trim(),
		at: at + match[0].length
	};
}
function readSize(text, at) {
	const match = /^:\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))/.exec(text.slice(at));
	return match ? {
		size: Number(match[1]),
		at: at + match[0].length
	} : {
		size: null,
		at
	};
}
function splitProps(text) {
	const parts = [];
	let depth = 0;
	let quote = false;
	let start = 0;
	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i];
		if (ch === "\\") {
			i += 1;
			continue;
		}
		if (quote) {
			if (ch === "\"") quote = false;
			continue;
		}
		if (ch === "\"") {
			quote = true;
			continue;
		}
		if (ch === "(") depth += 1;
		else if (ch === ")") depth = Math.max(0, depth - 1);
		else if (!depth && (ch === "," || ch === ";")) {
			parts.push(text.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(text.slice(start));
	return parts.map((part) => part.trim()).filter(Boolean);
}
function parse(source, info = {}) {
	const lang = info.lang || "zh";
	const firstLine = Number.isInteger(info.firstLine) ? info.firstLine : 2;
	const headerLine = Number.isInteger(info.headerLine) ? info.headerLine : Math.max(1, firstLine - 1);
	const errors = [];
	const sets = [];
	const unions = [];
	const texts = [];
	const styles = [];
	const known = /* @__PURE__ */ new Map();
	let title = "";
	let titleLine = headerLine;
	let scope = null;
	let indentMode = false;
	const fail = (line, zh, en, fixZh, fixEn) => errors.push(error(lang, line, zh, en, fixZh, fixEn));
	const junk = (line) => fail(line, "无法识别这一行", "Unrecognized line", "使用 set、union、text、title 或 style", "Use set, union, text, title, or style");
	const orphan = (line) => fail(line, "text 前缺少 set 或 union", "A text line needs an owning set or union", "把 text 缩进到 set/union 下面，或先写集合 id", "Indent text under a set/union, or name the set first");
	const params = typeof info.params === "string" ? info.params.trim() : "";
	if (params) fail(headerLine, `venn-beta 头行不能带内容「${params}」`, `Unexpected text after "venn-beta": ${params}`, "把内容写成 set、union 或 text 行", "Move the text into set, union, or text lines");
	for (const key of Object.keys(info.options || {})) fail(headerLine, `venn-beta 不支持选项「${key}」`, `Unsupported venn-beta option: ${key}`, "删除这个选项", "Remove this option");
	const addSet = (id, label, size, line) => {
		if (!id) {
			junk(line);
			return false;
		}
		if (known.has(id)) {
			fail(line, `集合「${id}」重复定义`, `Duplicate set identifier: ${id}`, "把同一个集合合并成一行 set", "Merge the duplicate into a single set line");
			return false;
		}
		sets.push({
			id,
			label: label ? labelText(label) : "",
			size: size ?? SIZE_DEFAULT,
			tone: sets.length % 6 + 1,
			line
		});
		known.set(id, sets.at(-1));
		scope = { ids: [id] };
		return true;
	};
	const addUnion = (ids, label, size, line) => {
		const unique = ids.filter((id, index) => ids.indexOf(id) === index);
		if (unique.length < 2) {
			fail(line, "union 至少需要两个集合", "A union needs at least two sets", "写成 union A,B 或列更多集合", "Write union A,B or list more sets");
			return false;
		}
		const unknown = unique.filter((id) => !known.has(id));
		if (unknown.length) {
			fail(line, `union 引用了未定义的集合「${unknown.join("、")}」`, `Unknown set identifier: ${unknown.join(", ")}`, "先用 set 声明集合，再写 union", "Declare each set with set before the union");
			return false;
		}
		const sorted = [...unique].sort();
		unions.push({
			ids: sorted,
			label: label ? labelText(label) : "",
			size: size ?? SIZE_DEFAULT / unique.length ** 2,
			line
		});
		scope = { ids: sorted };
		return true;
	};
	const addText = (id, label, ids, line) => {
		const unique = ids.filter((value, index) => ids.indexOf(value) === index);
		if (!unique.length) {
			orphan(line);
			return;
		}
		texts.push({
			id,
			label: label ? labelText(label) : labelText(id),
			ids: [...unique].sort(),
			key: [...unique].sort().join("|"),
			line
		});
	};
	for (const [index, raw] of String(source ?? "").split("\n").entries()) {
		const line = firstLine + index;
		const body = stripComment(raw).trim();
		if (!body) continue;
		const indented = /^[ \t]/.test(raw);
		const head = keywordOf(body);
		const rest = body.slice(head.at);
		if (indentMode && indented && head.word === "text") {
			const node = readIdent(rest, 0);
			const label = readLabel(rest, node ? node.at : 0);
			if (!node || rest.slice(label.at).trim()) {
				junk(line);
				continue;
			}
			if (scope) addText(node.id, label.label, scope.ids, line);
			else orphan(line);
			continue;
		}
		if (!indented) indentMode = false;
		if (head.word === "title") {
			const value = rest.trim();
			if (!value) {
				fail(line, "title 后面缺少标题文字", "title needs a heading after it", "写成 title 标题文字", "Write title followed by the heading");
				continue;
			}
			title = labelText(value.replace(/^"(.*)"$/, "$1").trim());
			titleLine = line;
			continue;
		}
		if (head.word === "set") {
			const first = readIdent(rest, 0);
			if (!first) {
				junk(line);
				continue;
			}
			const label = readLabel(rest, first.at);
			const size = readSize(rest, label.at);
			if (rest.slice(size.at).trim()) {
				junk(line);
				continue;
			}
			if (addSet(first.id, label.label, size.size, line)) indentMode = true;
			continue;
		}
		if (head.word === "union") {
			const list = readIdents(rest, 0);
			const label = readLabel(rest, list.at);
			const size = readSize(rest, label.at);
			if (!list.ids.length || rest.slice(size.at).trim()) {
				junk(line);
				continue;
			}
			if (addUnion(list.ids, label.label, size.size, line)) indentMode = true;
			continue;
		}
		if (head.word === "text") {
			const list = readIdents(rest, 0);
			const owner = readIdent(rest, list.at);
			const label = readLabel(rest, owner ? owner.at : list.at);
			if (!list.ids.length || rest.slice(label.at).trim()) {
				junk(line);
				continue;
			}
			if (owner) addText(owner.id, label.label, list.ids, line);
			else addText(list.ids[0], label.label, scope ? scope.ids : [], line);
			continue;
		}
		if (head.word === "style") {
			const list = readIdents(rest, 0);
			if (!list.ids.length) {
				junk(line);
				continue;
			}
			const props = [];
			for (const part of splitProps(rest.slice(list.at))) {
				const prop = /^([A-Za-z][\w-]*)\s*:\s*([\s\S]+)$/.exec(part);
				if (prop) props.push([prop[1].toLowerCase(), prop[2].trim()]);
				else junk(line);
			}
			styles.push({
				targets: list.ids,
				props,
				line
			});
			continue;
		}
		junk(line);
	}
	if (styles.length) {
		const subjects = [];
		for (const style of styles) for (const target of style.targets) if (!subjects.includes(target)) subjects.push(target);
		errors.push(warning("IGNORED_STYLE", lang, styles[0].line, `已忽略样式颜色（${subjects.join("、")}）：集合配色由主题决定`, `Style colours were ignored (${subjects.join(", ")}): the theme chooses set colours`, "删除 style 行，颜色交给主题", "Remove the style lines; the theme decides colours"));
	}
	if (!sets.length) fail(firstLine, "文氏图没有任何 set", "A Venn diagram needs at least one set", "至少写一行 set", "Write at least one set line");
	return {
		model: {
			kind: "venn-beta",
			title,
			titleLine,
			sets,
			unions,
			texts,
			styles
		},
		errors
	};
}
function clearanceAt(x, y, inside, outside) {
	let value = Infinity;
	for (const ring of inside) value = Math.min(value, ring.r - Math.hypot(x - ring.cx, y - ring.cy));
	for (const ring of outside) value = Math.min(value, Math.hypot(x - ring.cx, y - ring.cy) - ring.r);
	return value;
}
function deepestPoint(inside, outside, rounds = 3, steps = 16) {
	const cx = inside.reduce((sum, ring) => sum + ring.cx, 0) / inside.length;
	const cy = inside.reduce((sum, ring) => sum + ring.cy, 0) / inside.length;
	let best = {
		x: cx,
		y: cy,
		value: clearanceAt(cx, cy, inside, outside)
	};
	let span = Math.max(...inside.map((ring) => ring.r));
	for (let round = 0; round < rounds; round += 1) {
		const from = best;
		for (let ix = -steps / 2; ix <= steps / 2; ix += 1) for (let iy = -steps / 2; iy <= steps / 2; iy += 1) {
			const x = from.x + ix * span / (steps / 2);
			const y = from.y + iy * span / (steps / 2);
			const value = clearanceAt(x, y, inside, outside);
			if (value > best.value + 1e-9 || Math.abs(value - best.value) <= 1e-9 && Math.abs(y - cy) < Math.abs(best.y - cy) - 1e-9) best = {
				x,
				y,
				value
			};
		}
		span /= steps / 4;
	}
	return best;
}
function radiiOf(sets, R) {
	const weights = sets.map((set) => Number.isFinite(set.size) ? Math.max(0, set.size) : SIZE_DEFAULT);
	const peak = Math.max(0, ...weights);
	return weights.map((weight) => R * (peak > 0 ? Math.max(.3, Math.sqrt(weight / peak)) : 1));
}
function ringsAt(sets, R, spread) {
	const radii = radiiOf(sets, R);
	const rings = sets.map((set, index) => ({
		id: set.id,
		label: set.label,
		tone: set.tone,
		line: set.line,
		r: radii[index],
		cx: 0,
		cy: 0
	}));
	if (rings.length === 1) return rings;
	if (rings.length === 2) {
		const small = Math.min(radii[0], radii[1]);
		const near = Math.abs(radii[0] - radii[1]) + .25 * small;
		const far = radii[0] + radii[1] - .1 * small;
		const gap = near + Math.min(1, Math.max(0, spread)) * (far - near);
		rings[0].cx = -gap / 2;
		rings[1].cx = gap / 2;
		return rings;
	}
	const apex = rings.map((ring, index) => ({
		index,
		r: ring.r
	})).sort((left, right) => right.r - left.r || right.index - left.index)[0].index;
	const rest = [
		0,
		1,
		2
	].filter((index) => index !== apex).sort((left, right) => left - right);
	const share = (TRIANGLE_MIN + Math.min(1, Math.max(0, spread)) * .7) * (radii.reduce((sum, r) => sum + r, 0) / 3);
	const angle = [];
	angle[apex] = -Math.PI / 2;
	angle[rest[0]] = 5 * Math.PI / 6;
	angle[rest[1]] = Math.PI / 6;
	rings.forEach((ring, index) => {
		ring.cx = Math.cos(angle[index]) * share;
		ring.cy = Math.sin(angle[index]) * share;
	});
	return rings;
}
function canonicalSpread(sets, R) {
	if (sets.length <= 1) return .5;
	const radii = radiiOf(sets, R);
	if (sets.length === 2) {
		const small = Math.min(radii[0], radii[1]);
		const near = Math.abs(radii[0] - radii[1]) + .25 * small;
		const far = radii[0] + radii[1] - .1 * small;
		return far > near ? Math.min(1, Math.max(0, (radii[0] + radii[1] - PAIR_SHARE * small - near) / (far - near))) : .5;
	}
	return .44999999999999996 / .7;
}
function boundsOf(rings) {
	const left = Math.min(...rings.map((ring) => ring.cx - ring.r));
	const right = Math.max(...rings.map((ring) => ring.cx + ring.r));
	const top = Math.min(...rings.map((ring) => ring.cy - ring.r));
	const bottom = Math.max(...rings.map((ring) => ring.cy + ring.r));
	return {
		x: left,
		y: top,
		w: right - left,
		h: bottom - top
	};
}
function planBlock(region, measure) {
	const slack = region.kind === "set" ? SET_CLEAR : UNION_CLEAR;
	const pad = region.kind === "set" ? 0 : 14;
	const texts = [...region.labels.map((label) => label.text), ...region.items];
	const font = region.kind === "set" ? SET_FONT : ITEM_FONT;
	const floor = Math.max(0, ...texts.flatMap((text) => String(text).split(/\s+/).filter(Boolean).map((word) => measure(word, font))));
	const cap = Math.max(48, floor + 2, (region.clear - slack) * 2 - 20 - pad);
	const wrap = (value, spec) => wrapText(value, cap, spec, (piece, spec2) => measure(piece, spec2));
	const labelFont = region.kind === "set" ? SET_FONT : ITEM_FONT;
	const labels = [];
	for (const label of region.labels) for (const row of wrap(label.text, labelFont)) labels.push({
		text: row,
		font: labelFont
	});
	const items = [];
	for (const item of region.items) for (const row of wrap(item, ITEM_FONT)) items.push({
		text: row,
		font: ITEM_FONT
	});
	const widest = (rows) => rows.length ? Math.max(...rows.map((row) => measure(row.text, row.font))) : 0;
	const labelW = labels.length ? widest(labels) + pad : 0;
	const labelH = labels.length * ((region.kind === "set" ? HEAD_LINE : ITEM_LINE) + 4 / labels.length);
	const itemW = widest(items);
	const itemH = items.length * ITEM_LINE;
	const w = Math.max(labelW, itemW);
	const h = labelH + (items.length ? (labels.length ? ITEM_GAP : 0) + itemH : 0);
	const block = {
		labels,
		items,
		slack,
		pad,
		labelW,
		labelH,
		itemW,
		itemH,
		w,
		h,
		chip: region.kind !== "set" && labels.length > 0
	};
	block.room = h ? borderClearance(region, w, h) - INK_GAP : Infinity;
	block.fits = block.room >= -.5;
	return block;
}
function borderClearance(region, w, h) {
	let worst = Infinity;
	for (const [sx, sy] of [
		[-1, -1],
		[1, -1],
		[1, 1],
		[-1, 1],
		[0, -1],
		[1, 0],
		[0, 1],
		[-1, 0]
	]) worst = Math.min(worst, clearanceAt(region.x + sx * w / 2, region.y + sy * h / 2, region.inside, region.outside));
	return worst;
}
function regionList(rings, model) {
	const groups = /* @__PURE__ */ new Map();
	for (const text of model.texts) {
		const list = groups.get(text.key) || [];
		list.push(text);
		groups.set(text.key, list);
	}
	const regions = [];
	for (const ring of rings) regions.push({
		key: ring.id,
		kind: "set",
		ids: [ring.id],
		line: ring.line,
		tone: ring.tone,
		labels: [{
			text: ring.label || ring.id,
			line: ring.line
		}],
		items: (groups.get(ring.id) || []).map((text) => text.label),
		texts: groups.get(ring.id) || []
	});
	const merged = /* @__PURE__ */ new Map();
	for (const union of model.unions) {
		const key = union.ids.join("|");
		const existing = merged.get(key);
		if (existing) {
			if (union.label) existing.labels.push({
				text: union.label,
				line: union.line
			});
			continue;
		}
		const region = {
			key,
			kind: "union",
			ids: union.ids,
			line: union.line,
			tone: rings.find((ring) => ring.id === union.ids[0])?.tone || 1,
			labels: union.label ? [{
				text: union.label,
				line: union.line
			}] : [],
			items: (groups.get(key) || []).map((text) => text.label),
			texts: groups.get(key) || []
		};
		merged.set(key, region);
		regions.push(region);
	}
	bindRegions(regions, rings);
	return regions;
}
function bindRegions(regions, rings) {
	for (const region of regions) {
		region.inside = region.ids.map((id) => rings.find((ring) => ring.id === id)).filter(Boolean);
		region.outside = rings.filter((ring) => !region.inside.includes(ring));
	}
}
function roomOf(regions, measure, coarse) {
	let worst = Infinity;
	for (const region of regions) {
		const point = deepestPoint(region.inside, region.outside, coarse ? 2 : 3, coarse ? 10 : 16);
		region.x = point.x;
		region.y = point.y;
		region.clear = point.value;
		region.block = planBlock(region, measure);
		worst = Math.min(worst, region.block.room);
	}
	return worst;
}
function chooseSpread(ringsFor, regions, measure, preferred) {
	const order = [];
	for (let index = 0; index < SPREADS; index += 1) order.push(index / 16);
	order.sort((left, right) => Math.abs(left - preferred) - Math.abs(right - preferred) || right - left);
	let best = null;
	for (const spread of order) {
		bindRegions(regions, ringsFor(spread));
		const worst = roomOf(regions, measure, true);
		if (!best || worst > best.worst + 1e-9) best = {
			spread,
			worst
		};
		if (worst >= 0) {
			bindRegions(regions, ringsFor(spread));
			roomOf(regions, measure, false);
			return {
				rings: ringsFor(spread),
				worst
			};
		}
	}
	bindRegions(regions, ringsFor(best.spread));
	return {
		rings: ringsFor(best.spread),
		worst: roomOf(regions, measure, false)
	};
}
function layoutBlock(region) {
	const block = region.block;
	const top = region.y - block.h / 2;
	const pitch = region.kind === "set" ? HEAD_LINE : ITEM_LINE;
	region.rows = [];
	region.chip = null;
	if (block.labels.length) {
		region.chip = {
			x: region.x - block.labelW / 2,
			y: top,
			w: block.labelW,
			h: block.labelH
		};
		block.labels.forEach((row, index) => region.rows.push({
			text: row.text,
			font: row.font,
			x: region.x,
			y: top + CHIP_Y + (index + .5) * pitch,
			anchor: "middle"
		}));
	}
	const itemTop = top + block.labelH + (block.labels.length && block.items.length ? ITEM_GAP : 0);
	block.items.forEach((row, index) => region.rows.push({
		text: row.text,
		font: row.font,
		x: region.x,
		anchor: "middle",
		y: itemTop + (index + .5) * ITEM_LINE
	}));
}
function planRings(model, { measure, width, lang }) {
	const available = Math.max(240, width - 48);
	const preferred = canonicalSpread(model.sets, 1);
	const unit = boundsOf(ringsAt(model.sets, 1, preferred));
	let R = Math.max(56, Math.min(available / Math.max(1, unit.w), PLOT_H / Math.max(1, unit.h)));
	const regions = regionList(ringsAt(model.sets, R, preferred), model);
	let chosen = null;
	for (let pass = 0; pass <= MAX_GROWTH; pass += 1) {
		chosen = chooseSpread((spread) => ringsAt(model.sets, R, spread), regions, measure, preferred);
		if (chosen.worst >= 0) break;
		const next = R * GROW;
		if (boundsOf(ringsAt(model.sets, next, preferred)).w > available * 2) break;
		R = next;
	}
	const rings = chosen.rings;
	const shelf = [];
	for (const region of regions) {
		if (region.block.fits) continue;
		shelf.push({
			region,
			rows: [...region.block.labels, ...region.block.items]
		});
		region.block = {
			...region.block,
			labels: [],
			labelW: 0,
			labelH: 0,
			chip: false
		};
	}
	const claimed = new Set(regions.map((region) => region.key));
	for (const text of model.texts) {
		if (claimed.has(text.key)) continue;
		shelf.push({
			region: {
				x: null,
				y: null,
				tone: 1,
				line: text.line,
				caption: text.ids.join(" ∩ ")
			},
			rows: [{
				text: text.label,
				font: ITEM_FONT
			}]
		});
	}
	const notes = [];
	if (shelf.length) notes.push(warning("DIAGRAM_HINT", lang, shelf[0].region.line ?? model.sets[0].line, `有 ${shelf.length} 个标签放不进所属区域，已排在图下方并用引线指向该区域`, `${shelf.length} label(s) do not fit their region and moved below the plot with a leader`, "缩短标签，或减少同一区域的 text", "Shorten the labels, or use fewer text nodes per region"));
	for (const region of regions) {
		if (region.texts.length <= ITEM_CAP) continue;
		notes.push(warning("DIAGRAM_HINT", lang, region.texts[ITEM_CAP].line, `「${region.key}」区域有 ${region.texts.length} 个 text，超过 ${ITEM_CAP} 个后很难阅读`, `Region "${region.key}" holds ${region.texts.length} text nodes; more than ${ITEM_CAP} is hard to read`, "把说明移到图外，或拆成多张图", "Move details outside, or split the diagram"));
		break;
	}
	const drawn = regions.filter((region) => region.block.h > 0 || region.block.labels.length);
	for (const region of drawn) layoutBlock(region);
	return finish({
		mode: "rings",
		rings,
		regions: drawn,
		plot: boundsOf(rings),
		rows: drawn.flatMap((region) => region.rows),
		shelf,
		notes
	}, model, {
		measure,
		width
	});
}
function planGrid(model, { measure, width, lang }) {
	const groups = /* @__PURE__ */ new Map();
	for (const text of model.texts) {
		const list = groups.get(text.key) || [];
		list.push(text);
		groups.set(text.key, list);
	}
	const panels = [];
	for (const set of model.sets) panels.push({
		kind: "set",
		key: set.id,
		tone: set.tone,
		line: set.line,
		titles: set.label ? [set.label] : [],
		caption: "",
		items: (groups.get(set.id) || []).map((text) => text.label)
	});
	const merged = /* @__PURE__ */ new Map();
	for (const union of model.unions) {
		const key = union.ids.join("|");
		const existing = merged.get(key);
		if (existing) {
			if (union.label) existing.titles.push(union.label);
			continue;
		}
		const panel = {
			kind: "union",
			key,
			tone: model.sets.find((set) => set.id === union.ids[0])?.tone || 1,
			line: union.line,
			titles: union.label ? [union.label] : [],
			caption: union.ids.join(" ∩ "),
			items: (groups.get(key) || []).map((text) => text.label)
		};
		merged.set(key, panel);
		panels.push(panel);
	}
	const claimed = new Set(panels.map((panel) => panel.key));
	for (const text of model.texts) {
		if (claimed.has(text.key)) continue;
		panels.push({
			kind: "loose",
			key: text.key,
			tone: 1,
			line: text.line,
			titles: [text.label],
			caption: text.ids.join(" ∩ "),
			items: []
		});
	}
	const wrap = (value, font) => wrapText(value, 140, font, (piece, spec) => measure(piece, spec));
	for (const panel of panels) {
		panel.header = panel.titles.flatMap((value) => wrap(labelText(value), SET_FONT));
		panel.captionLines = panel.caption ? wrap(panel.caption, ITEM_FONT) : [];
		panel.itemLines = panel.items.flatMap((value) => wrap(value, ITEM_FONT));
		const widths = [
			...panel.header.map((row) => measure(row, SET_FONT)),
			...panel.captionLines.map((row) => measure(row, ITEM_FONT)),
			...panel.itemLines.map((row) => measure(row, ITEM_FONT))
		];
		panel.w = Math.max(GRID_MIN_W, Math.ceil(Math.max(0, ...widths) + 28));
		panel.h = 28 + panel.header.length * HEAD_LINE + (panel.captionLines.length ? 4 + panel.captionLines.length * ITEM_LINE : 0) + (panel.itemLines.length ? 6 + panel.itemLines.length * ITEM_LINE : 0);
	}
	const cellW = Math.max(...panels.map((panel) => panel.w));
	const available = Math.max(240, width - 48);
	let cols = Math.min(GRID_COLS, panels.length);
	while (cols > 1 && cols * cellW + (cols - 1) * GRID_GAP > available * 2) cols -= 1;
	const rowCount = Math.ceil(panels.length / cols);
	const rowHeights = [];
	panels.forEach((panel, index) => {
		panel.column = index % cols;
		panel.row = Math.floor(index / cols);
		rowHeights[panel.row] = Math.max(rowHeights[panel.row] || 0, panel.h);
	});
	const tops = [];
	let cursor = 0;
	for (let row = 0; row < rowCount; row += 1) {
		tops[row] = cursor;
		cursor += rowHeights[row] + GRID_GAP;
	}
	panels.forEach((panel) => {
		panel.w = cellW;
		panel.x = panel.column * (cellW + GRID_GAP);
		panel.y = tops[panel.row];
		panel.rows = [];
		let y = panel.y + GRID_PAD;
		for (const row of panel.header) {
			panel.rows.push({
				text: row,
				font: SET_FONT,
				x: panel.x + GRID_PAD,
				y: y + HEAD_LINE / 2,
				anchor: "start"
			});
			y += HEAD_LINE;
		}
		if (panel.captionLines.length) {
			y += 4;
			for (const row of panel.captionLines) {
				panel.rows.push({
					text: row,
					font: ITEM_FONT,
					x: panel.x + GRID_PAD,
					y: y + ITEM_LINE / 2,
					anchor: "start"
				});
				y += ITEM_LINE;
			}
		}
		if (panel.itemLines.length) {
			y += 6;
			for (const row of panel.itemLines) {
				panel.rows.push({
					text: row,
					font: ITEM_FONT,
					x: panel.x + GRID_PAD,
					y: y + ITEM_LINE / 2,
					anchor: "start"
				});
				y += ITEM_LINE;
			}
		}
	});
	const notes = [warning("DIAGRAM_HINT", lang, model.sets[0].line, `${model.sets.length} 个集合画成圆环后重叠区无法阅读，已改用分区面板`, `${model.sets.length} sets would leave unreadable overlaps; drawn as a region grid instead`, "集合减到 3 个可获得圆环布局，或接受分区面板", "Keep three sets for rings, or accept the region grid")];
	return finish({
		mode: "grid",
		panels,
		plot: {
			x: 0,
			y: 0,
			w: cols * cellW + (cols - 1) * GRID_GAP,
			h: cursor - GRID_GAP
		},
		rows: panels.flatMap((panel) => panel.rows),
		shelf: [],
		notes
	}, model, {
		measure,
		width
	});
}
function finish(plan, model, { measure, width }) {
	const titleLines = model.title ? wrapText(model.title, Math.max(160, Math.min(width - 48, 480)), TITLE_FONT, (piece, spec) => measure(piece, spec)) : [];
	const titleH = titleLines.length ? titleLines.length * TITLE_LINE + TITLE_GAP : 0;
	const shelf = [];
	let shelfRight = plan.plot.x + plan.plot.w;
	let shelfBottom = plan.plot.y + plan.plot.h;
	if (plan.shelf.length) {
		const limit = Math.max(plan.plot.w, 240);
		let cursor = plan.plot.x;
		let top = plan.plot.y + plan.plot.h + SHELF_GAP;
		let rowH = 0;
		for (const item of plan.shelf) {
			const rows = [...item.region.caption ? [{
				text: item.region.caption,
				font: ITEM_FONT,
				kind: "caption"
			}] : [], ...item.rows.map((row) => ({
				...row,
				kind: row.font === SET_FONT ? "label" : "item"
			}))];
			const w = Math.max(0, ...rows.map((row) => measure(row.text, row.font)));
			if (cursor > plan.plot.x && cursor + w > plan.plot.x + limit) {
				cursor = plan.plot.x;
				top += rowH + GRID_GAP / 2;
				rowH = 0;
			}
			const lines = rows.map((row, index) => ({
				text: row.text,
				font: row.font,
				kind: row.kind,
				x: cursor,
				y: top + (index + .5) * ITEM_LINE
			}));
			shelf.push({
				lines,
				tone: item.region.tone,
				from: item.region.x == null ? null : {
					x: item.region.x,
					y: item.region.y
				},
				to: {
					x: cursor + w / 2,
					y: top - LEADER
				}
			});
			shelfBottom = Math.max(shelfBottom, top + rows.length * ITEM_LINE);
			shelfRight = Math.max(shelfRight, cursor + w);
			rowH = Math.max(rowH, rows.length * ITEM_LINE);
			cursor += w + SHELF_PITCH;
		}
	}
	const spanW = Math.max(plan.plot.x + plan.plot.w, shelfRight) - plan.plot.x;
	const contentW = Math.max(spanW, ...titleLines.map((row) => measure(row, TITLE_FONT)));
	const dx = MARGIN + (contentW - spanW) / 2 - plan.plot.x;
	const dy = MARGIN + titleH - plan.plot.y;
	const height = Math.ceil(shelfBottom - plan.plot.y + titleH + 48);
	const finalWidth = Math.ceil(contentW + 48);
	for (const ring of plan.rings || []) {
		ring.cx += dx;
		ring.cy += dy;
	}
	for (const panel of plan.panels || []) {
		panel.x += dx;
		panel.y += dy;
	}
	for (const row of plan.rows) {
		row.x += dx;
		row.y += dy;
	}
	for (const region of plan.regions || []) {
		region.x += dx;
		region.y += dy;
		if (region.chip) {
			region.chip.x += dx;
			region.chip.y += dy;
		}
	}
	for (const item of shelf) {
		for (const line of item.lines) {
			line.x += dx;
			line.y += dy;
		}
		if (item.from) item.from = {
			x: item.from.x + dx,
			y: item.from.y + dy
		};
		item.to = {
			x: item.to.x + dx,
			y: item.to.y + dy
		};
	}
	return {
		width: finalWidth,
		height,
		mode: plan.mode,
		title: titleLines.length ? {
			lines: titleLines,
			x: MARGIN + contentW / 2,
			top: 34
		} : null,
		rings: plan.rings || [],
		regions: plan.regions || [],
		panels: plan.panels || [],
		rows: plan.rows,
		shelf,
		notes: plan.notes,
		anchor: {
			x: MARGIN + contentW / 2,
			y: MARGIN + titleH + plan.plot.h / 2
		}
	};
}
function layout(model, options = {}) {
	const measure = options.measure || fallbackMeasure;
	const width = Math.max(1, Number(options.width) || 800);
	const lang = options.lang || "zh";
	if (!model.sets.length) return {
		width,
		height: 0,
		errors: []
	};
	const plan = model.sets.length <= RING_MAX ? planRings(model, {
		measure,
		width,
		lang
	}) : planGrid(model, {
		measure,
		width,
		lang
	});
	const errors = [...plan.notes];
	const parts = model.sets.length + model.unions.length + model.texts.length;
	if (parts > PARTS_HINT) errors.push(warning("LARGE_DIAGRAM", lang, model.sets[0].line, `文氏图有 ${parts} 个元素，建议拆分`, `The Venn diagram has ${parts} parts; consider splitting it`, "按集合拆成多张图", "Split the diagram by set"));
	else if (plan.width > width * 2) errors.push(warning("LARGE_DIAGRAM", lang, model.sets[0].line, `文氏图需要 ${plan.width}px 宽，超过图框两倍`, `The Venn diagram needs ${plan.width}px, more than twice the frame`, "加宽图框，或拆分文氏图", "Widen the frame, or split the diagram"));
	return {
		...plan,
		errors
	};
}
function scene(plan, ctx) {
	const look = appearance(ctx);
	const paper = ctx.color("bg");
	const tone = (index) => ctx.frameTone(ctx.color(`tone${(index - 1) % 6 + 1}`));
	const row = (item) => ctx.text(item.x, item.y, item.text, {
		anchor: item.anchor,
		size: item.font.size,
		weight: item.font.weight,
		"dominant-baseline": "central",
		fill: item.kind === "caption" ? look.fg3 : item.font === SET_FONT ? look.fg1 : look.fg2
	});
	const children = [];
	if (plan.mode === "rings") {
		for (const ring of plan.rings) children.push(ctx.circle(ring.cx, ring.cy, ring.r, {
			fill: tone(ring.tone),
			"fill-opacity": .1
		}));
		for (const ring of plan.rings) children.push(ctx.circle(ring.cx, ring.cy, ring.r, {
			fill: "none",
			stroke: tone(ring.tone),
			"stroke-width": RING_STROKE,
			meta: {
				kind: "node",
				id: ring.id,
				label: ring.id
			}
		}));
		for (const region of plan.regions) {
			if (!region.chip) continue;
			children.push(ctx.rect(region.chip.x, region.chip.y, region.chip.w, region.chip.h, {
				rx: look.smallRadius,
				fill: paper
			}));
		}
		for (const item of plan.rows) children.push(row(item));
		for (const item of plan.shelf) {
			if (item.from) children.push(ctx.line(item.from.x, item.from.y, item.to.x, item.to.y, {
				stroke: ctx.tint(paper, tone(item.tone), .55),
				"stroke-width": 1,
				"stroke-dasharray": "3 3"
			}));
			for (const line of item.lines) children.push(row(line));
		}
	} else for (const panel of plan.panels) {
		const color = tone(panel.tone);
		children.push(ctx.rect(panel.x, panel.y, panel.w, panel.h, {
			rx: look.radius,
			fill: ctx.tint(paper, color, panel.kind === "set" ? .07 : .04),
			stroke: ctx.tint(paper, color, .45),
			"stroke-width": 1,
			...panel.kind === "set" ? {} : { "stroke-dasharray": "5 4" },
			meta: {
				kind: panel.kind === "set" ? "node" : "frame",
				id: panel.key,
				label: panel.key
			}
		}));
		for (const item of panel.rows) children.push(row(item));
	}
	if (plan.title) plan.title.lines.forEach((line, index) => children.push(ctx.text(plan.title.x, plan.title.top + index * TITLE_LINE, line, {
		anchor: "middle",
		size: TITLE_FONT.size,
		weight: TITLE_FONT.weight,
		fill: look.fg1,
		"dominant-baseline": "central"
	})));
	return {
		width: plan.width,
		height: plan.height,
		title: plan.title ? plan.title.lines.join(" ") : void 0,
		children,
		anchor: plan.anchor
	};
}
var implementations = { "venn-beta": {
	parse,
	layout,
	scene
} };
export { implementations, venn_exports };
