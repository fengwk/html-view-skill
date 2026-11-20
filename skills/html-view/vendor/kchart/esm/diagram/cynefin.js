import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { labelIcon } from "./tree-family-icon.js";
import { normalizeLabel } from "./label.js";
import { presentation } from "./presentation.js";
import { FONT, appearance, error, fallbackMeasure, isEn, labelText, warning, wrapText } from "./support.js";
// src/diagram/cynefin.js
var cynefin_exports = /* @__PURE__ */ __exportAll({
	DOMAINS: () => DOMAINS,
	NOTES: () => NOTES,
	implementations: () => implementations
});
var DOMAINS = [
	"complex",
	"complicated",
	"clear",
	"chaotic",
	"confusion"
];
var QUADRANTS = [
	"complex",
	"complicated",
	"chaotic",
	"clear"
];
var CELLS = {
	complex: [0, 0],
	complicated: [1, 0],
	chaotic: [0, 1],
	clear: [1, 1]
};
var TITLES = {
	complex: "Complex",
	complicated: "Complicated",
	chaotic: "Chaotic",
	clear: "Clear",
	confusion: "Confusion"
};
var NOTES = {
	complex: ["Probe → Sense → Respond", "Emergent Practices"],
	complicated: ["Sense → Analyse → Respond", "Good Practices"],
	clear: ["Sense → Categorise → Respond", "Best Practices"],
	chaotic: ["Act → Sense → Respond", "Novel Practices"],
	confusion: ["", "Disorder"]
};
var TITLES_ZH = {
	complex: "复杂",
	complicated: "繁杂",
	chaotic: "混乱",
	clear: "清晰",
	confusion: "困惑"
};
var NOTES_ZH = {
	complex: ["探测 → 感知 → 响应", "涌现实践"],
	complicated: ["感知 → 分析 → 响应", "良好实践"],
	clear: ["感知 → 分类 → 响应", "最佳实践"],
	chaotic: ["行动 → 感知 → 响应", "新颖实践"],
	confusion: ["", "失序"]
};
var TONES = {
	complex: "tone1",
	complicated: "tone2",
	chaotic: "tone3",
	clear: "tone4",
	confusion: "tone5"
};
var MARGIN = 24;
var TITLE_LINE = 20;
var TITLE_GAP = 14;
var MIN_PLOT = 640;
var MAX_PLOT = 960;
var PANEL_PAD = 22;
var CORRIDOR = 46;
var NAME_LINE = 18;
var SUB_PITCH = 18;
var ITEM_GAP = 10;
var CHIP_PAD_X = 10;
var CHIP_MIN_H = 24;
var CHIP_LINE = 15;
var CHIP_GAP = 4;
var CHIP_CAP = 190;
var QUADRANT_HINT = 4;
var PORT_CLEAR = 16;
var BOW_RATIO = .12;
var BOW_MIN = 12;
var LABEL_LINE = 16;
var LABEL_CAP = 200;
var NODE_HINT = 60;
new Set(DOMAINS);
var STRING = /^(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/;
var DECODE = /\\(["'\\])/g;
function stripComment(line) {
	let quote = "";
	for (let i = 0; i < line.length; i += 1) {
		const char = line[i];
		if (quote) {
			if (char === quote) quote = "";
			continue;
		}
		if (char === "\"" || char === "'") {
			quote = char;
			continue;
		}
		if (char === "%" && line[i + 1] === "%") return line.slice(0, i);
	}
	return line;
}
function readStrings(text) {
	const items = [];
	let rest = String(text ?? "");
	for (;;) {
		const match = STRING.exec(rest);
		if (!match) break;
		items.push((match[1] ?? match[2] ?? "").replace(DECODE, "$1"));
		rest = rest.slice(match[0].length);
	}
	return {
		items,
		rest: rest.trim()
	};
}
function parse(source, info = {}) {
	const lang = info.lang || "zh";
	const firstLine = Number.isInteger(info.firstLine) ? info.firstLine : 2;
	const headerLine = Number.isInteger(info.headerLine) ? info.headerLine : Math.max(1, firstLine - 1);
	const errors = [];
	const domains = Object.fromEntries(DOMAINS.map((name) => [name, []]));
	const transitions = [];
	const look = presentation({ lang });
	const model = {
		kind: "cynefin-beta",
		title: "",
		accTitle: "",
		accDescr: "",
		domains,
		transitions,
		showDomainDescriptions: info.config?.cynefin?.showDomainDescriptions !== false
	};
	const assets = /* @__PURE__ */ new Set();
	const normalize = (raw, line) => {
		const value = normalizeLabel(raw, {
			lang,
			line
		});
		for (const issue of value.diagnostics) if (!assets.has(issue.message)) {
			assets.add(issue.message);
			errors.push(issue);
		}
		return {
			label: value.text,
			icon: value.icon
		};
	};
	const unknownDomain = (value, line) => error(lang, line, `未知的 Cynefin 域「${value}」`, `Unknown Cynefin domain "${value}"`, `使用 ${DOMAINS.join(" / ")}`, `Use one of ${DOMAINS.join(" / ")}`);
	const readTitle = (value, line) => {
		if (model.title) {
			errors.push(error(lang, line, "标题重复", "Duplicate title", "只保留一个 title", "Keep only one title"));
			return;
		}
		model.title = normalize(value.trim(), line).label;
	};
	const header = String(info.params ?? "").replace(/^:/, "").trim();
	if (header) {
		const inline = /^title\b\s*([\s\S]*)$/i.exec(header);
		if (inline) readTitle(inline[1], headerLine);
		else errors.push(error(lang, headerLine, `标题行之后多出「${header}」`, `Unexpected text after the header: "${header}"`, "把标题写成单独一行 title …", "Put the title on its own line"));
	}
	let current = null, block = null;
	for (const [index, raw] of String(source ?? "").split("\n").entries()) {
		const line = firstLine + index;
		const text = stripComment(raw).trim();
		if (block) {
			block.lines.push(text);
			if (/}/.test(text)) {
				model.accDescr = labelText(block.lines.join("\n").replace(/}\s*$/, "").trim());
				block = null;
			}
			continue;
		}
		if (!text) continue;
		if (look.accept(text, line)) continue;
		const accTitle = /^accTitle\s*:\s*([\s\S]*)$/i.exec(text);
		if (accTitle) {
			model.accTitle = labelText(accTitle[1].trim());
			continue;
		}
		const accDescr = /^accDescr\s*:\s*([\s\S]*)$/i.exec(text);
		if (accDescr) {
			model.accDescr = labelText(accDescr[1].trim());
			continue;
		}
		const accOpen = /^accDescr\s*\{([\s\S]*)$/i.exec(text);
		if (accOpen) {
			if (/}/.test(accOpen[1])) model.accDescr = labelText(accOpen[1].replace(/}[\s\S]*$/, "").trim());
			else block = { lines: [accOpen[1]] };
			continue;
		}
		const title = /^title\b\s*([\s\S]*)$/i.exec(text);
		if (title) {
			readTitle(title[1], line);
			continue;
		}
		if (/^[A-Za-z]+\s*[-=.][-=>=.]*\s*>/.test(text)) {
			const hop = /^([A-Za-z]+)\s*-->\s*([A-Za-z]+)\s*(?::\s*([\s\S]*))?$/.exec(text);
			if (!hop) {
				errors.push(error(lang, line, "只支持 --> 转移箭头", "Only --> transitions are supported", "把转移写成 complex --> clear", "Write the transition as complex --> clear"));
				continue;
			}
			const from = DOMAINS.find((name) => name === hop[1].toLowerCase());
			const to = DOMAINS.find((name) => name === hop[2].toLowerCase());
			if (!from) {
				errors.push(unknownDomain(hop[1], line));
				continue;
			}
			if (!to) {
				errors.push(unknownDomain(hop[2], line));
				continue;
			}
			let label = "";
			if (hop[3] !== void 0) {
				const read = readStrings(hop[3]);
				if (!read.items.length) {
					errors.push(error(lang, line, "转移标签必须使用引号", "Expected a quoted transition label", "把标签写成 : \"文本\"", "Write the label as : \"text\""));
					continue;
				}
				if (read.rest) {
					errors.push(error(lang, line, `转移标签后多出「${read.rest}」`, `Unexpected text after the transition label: "${read.rest}"`, "一个转移只写一个引号标签", "Use one quoted label per transition"));
					continue;
				}
				label = normalize(read.items[0], line).label;
			}
			if (from === to) {
				errors.push(warning("DIAGRAM_HINT", lang, line, `自环转移「${from}」已省略`, `The self-loop on "${from}" was dropped`, "删除自环；域不能转移到自身", "Remove the self-loop; a domain cannot transition to itself"));
				continue;
			}
			transitions.push({
				from,
				to,
				label,
				line
			});
			continue;
		}
		const word = /^([A-Za-z]+)([\s\S]*)$/.exec(text);
		const domain = word && DOMAINS.find((name) => name === word[1].toLowerCase());
		if (domain) {
			current = domain;
			const read = readStrings(word[2]);
			if (read.rest) errors.push(error(lang, line, `域「${domain}」之后多出「${read.rest}」`, `Unexpected text after domain "${domain}": "${read.rest}"`, "每个条目写成一行引号字符串", "Put each item on its own line as a quoted string"));
			for (const item of read.items) domains[domain].push({
				...normalize(item, line),
				line
			});
			continue;
		}
		if (!current) {
			errors.push(unknownDomain(word ? word[1] : text, line));
			continue;
		}
		const read = readStrings(text);
		if (!read.items.length) {
			errors.push(error(lang, line, "域条目必须是引号字符串", "Expected a quoted string for a domain item", "把条目写成 \"文本\"", "Wrap the item in quotes"));
			continue;
		}
		if (read.rest) {
			errors.push(error(lang, line, `条目之后多出「${read.rest}」`, `Unexpected text after the item: "${read.rest}"`, "每个条目只写一个引号字符串", "Use one quoted string per item"));
			continue;
		}
		for (const item of read.items) domains[current].push({
			...normalize(item, line),
			line
		});
	}
	if (block) {
		errors.push(error(lang, firstLine, "accDescr 缺少结束的 }", "accDescr is missing its closing }", "补齐 accDescr 的右花括号", "Close the accDescr block"));
		model.accDescr = labelText(block.lines.join("\n").trim());
	}
	errors.push(...look.diagnostics());
	transitions.forEach((transition, index) => {
		transition.status = look.edgeStatusOf(index);
	});
	for (const name of DOMAINS) domains[name].forEach((item, index) => {
		item.id = `${name}-${index}`;
		item.status = look.statusOf(item.id) ?? look.statusOf(name);
		item.link = look.linkOf(item.id) ?? look.linkOf(name);
	});
	return {
		model,
		errors
	};
}
var clamp = (value, low, high) => Math.min(high, Math.max(low, value));
var centreOf = (rect) => rect.ellipse ? {
	x: rect.cx,
	y: rect.cy
} : {
	x: rect.x + rect.w / 2,
	y: rect.y + rect.h / 2
};
function portOf(from, to) {
	const a = centreOf(from), b = centreOf(to);
	if (from.ellipse) {
		const angle = Math.atan2((b.y - from.cy) / from.ry, (b.x - from.cx) / from.rx);
		const cos = Math.cos(angle), sin = Math.sin(angle);
		return {
			x: from.cx + (from.rx + 8) * cos,
			y: from.cy + (from.ry + 8) * sin
		};
	}
	const dx = b.x - a.x, dy = b.y - a.y;
	return Math.abs(dx) >= Math.abs(dy) ? {
		x: dx >= 0 ? from.x + from.w + PORT_CLEAR : from.x - PORT_CLEAR,
		y: a.y
	} : {
		x: a.x,
		y: dy >= 0 ? from.y + from.h + PORT_CLEAR : from.y - PORT_CLEAR
	};
}
function arcOf(a, b, centre, rx, ry) {
	const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
	const nx = -dy / len, ny = dx / len;
	const mid = {
		x: (a.x + b.x) / 2,
		y: (a.y + b.y) / 2
	};
	const away = (mid.x - centre.x) * nx + (mid.y - centre.y) * ny >= 0 ? 1 : -1;
	const clear = (ctrl) => {
		for (let i = 0; i <= 20; i += 1) {
			const t = i / 20, u = 1 - t;
			const x = u * u * a.x + 2 * u * t * ctrl.x + t * t * b.x;
			const y = u * u * a.y + 2 * u * t * ctrl.y + t * t * b.y;
			if (Math.hypot((x - centre.x) / rx, (y - centre.y) / ry) < 1.12) return false;
		}
		return true;
	};
	let offset = Math.max(BOW_MIN, len * BOW_RATIO);
	let ctrl = {
		x: mid.x + nx * offset * away,
		y: mid.y + ny * offset * away
	};
	const limit = len * 1.4 + 240;
	while (!clear(ctrl) && offset < limit) {
		offset += 8;
		ctrl = {
			x: mid.x + nx * offset * away,
			y: mid.y + ny * offset * away
		};
	}
	const apex = {
		x: (a.x + 2 * ctrl.x + b.x) / 4,
		y: (a.y + 2 * ctrl.y + b.y) / 4
	};
	return {
		a,
		b,
		ctrl,
		away,
		nx,
		ny,
		apex,
		offset
	};
}
function layout(model, options = {}) {
	const measure = options.measure || fallbackMeasure;
	const width = Math.max(1, Number(options.width) || 800);
	const lang = options.lang || "zh";
	const titles = isEn(lang) ? TITLES : TITLES_ZH, notes = isEn(lang) ? NOTES : NOTES_ZH;
	const errors = [];
	const ink = (value, font) => Math.max(0, measure(value, font.size, font.weight));
	const wrap = (value, maxWidth, font) => wrapText(value, maxWidth, font, (piece, spec) => measure(piece, spec));
	const nameFont = {
		size: FONT.title.size,
		weight: FONT.title.weight
	};
	const bodyFont = {
		size: FONT.label.size,
		weight: FONT.label.weight
	};
	const widest = (lines, font) => Math.ceil(Math.max(0, ...lines.map((line) => ink(line, font))));
	const titleLines = model.title ? wrap(model.title, Math.max(160, Math.min(640, width - 48)), nameFont) : [];
	const titleHeight = titleLines.length ? titleLines.length * TITLE_LINE + TITLE_GAP : 0;
	const plotW = clamp(width - 48, MIN_PLOT, MAX_PLOT);
	const chipCap = Math.max(96, Math.min(CHIP_CAP, plotW / 2 - 44 - 8));
	const chipOf = (label, cap, icon) => {
		const lines = wrap(label, cap, bodyFont);
		return {
			lines,
			w: widest(lines, bodyFont) + 20 + (icon ? 18 : 0),
			h: Math.max(CHIP_MIN_H, lines.length * CHIP_LINE + 12)
		};
	};
	const blocks = {};
	let count = 0;
	for (const name of QUADRANTS) {
		const rows = model.domains[name];
		count += rows.length;
		const chips = rows.map((item, index) => ({
			...item,
			id: `${name}-${index}`,
			line: item.line,
			...chipOf(item.label, chipCap, item.icon)
		}));
		if (rows.length > QUADRANT_HINT) errors.push(warning("DIAGRAM_HINT", lang, rows[QUADRANT_HINT].line, `「${titles[name]}」有 ${rows.length} 个条目，面板会变高`, `"${titles[name]}" holds ${rows.length} items and makes a tall panel`, `每个域保留 ${QUADRANT_HINT} 个条目以内`, `Keep at most ${QUADRANT_HINT} items per domain`));
		const subs = model.showDomainDescriptions ? notes[name] : [notes[name][1]];
		const blockW = Math.ceil(Math.max(widest([titles[name]], nameFont), widest(subs, bodyFont), ...chips.map((chip) => chip.w), 0));
		const chipsH = chips.reduce((sum, chip) => sum + chip.h + CHIP_GAP, -4);
		blocks[name] = {
			id: name,
			subs,
			chips,
			w: blockW,
			h: 24 + subs.length * SUB_PITCH + (chips.length ? ITEM_GAP + chipsH : 0),
			tone: TONES[name],
			count: rows.length
		};
	}
	const maxBlockH = Math.max(...QUADRANTS.map((name) => blocks[name].h));
	const confusionRows = model.domains.confusion;
	count += confusionRows.length;
	const confCap = Math.max(80, plotW * .15 * 2 - 56);
	const confusionChips = confusionRows.map((item, index) => ({
		...item,
		id: `confusion-${index}`,
		line: item.line,
		...chipOf(item.label, confCap, item.icon)
	}));
	const confusionChipsH = confusionChips.reduce((sum, chip) => sum + chip.h + CHIP_GAP, -4);
	const confusionBlockH = 24 + (model.showDomainDescriptions ? SUB_PITCH : 0) + (confusionChips.length ? ITEM_GAP + confusionChipsH : 0);
	const rx = Math.max(plotW * .15, Math.ceil(Math.max(0, ...confusionChips.map((chip) => chip.w)) / 2) + 18);
	const requiredRy = confusionBlockH * .68 + 12;
	const plotH = Math.ceil(Math.max(clamp(plotW * .72, 380, 620), 2 * (PANEL_PAD + maxBlockH + CORRIDOR), 2 * (requiredRy + CORRIDOR)));
	const ry = Math.max(plotH * .15, requiredRy);
	const panelW = plotW / 2, panelH = plotH / 2;
	const plotX = MARGIN, plotY = MARGIN + titleHeight;
	const centre = {
		x: plotX + plotW / 2,
		y: plotY + plotH / 2
	};
	const bottomBlockH = Math.max(blocks.chaotic.h, blocks.clear.h);
	const quadrants = {};
	for (const name of QUADRANTS) {
		const [col, row] = CELLS[name];
		const panel = {
			x: plotX + col * panelW,
			y: plotY + row * panelH,
			w: panelW,
			h: panelH
		};
		const block = blocks[name];
		const blockX = panel.x + (panel.w - block.w) / 2;
		const blockY = row === 0 ? panel.y + PANEL_PAD : panel.y + panel.h - PANEL_PAD - bottomBlockH;
		const texts = [];
		let cursor = blockY;
		texts.push({
			kind: "name",
			text: titles[name],
			x: blockX + block.w / 2,
			y: cursor + NAME_LINE / 2,
			font: nameFont
		});
		cursor += 24;
		for (const line of block.subs) {
			texts.push({
				kind: "sub",
				text: line,
				x: blockX + block.w / 2,
				y: cursor + SUB_PITCH / 2,
				font: bodyFont
			});
			cursor += SUB_PITCH;
		}
		if (block.chips.length) cursor += ITEM_GAP;
		for (const chip of block.chips) {
			chip.x = blockX + (block.w - chip.w) / 2;
			chip.y = cursor;
			cursor += chip.h + CHIP_GAP;
		}
		quadrants[name] = {
			...block,
			...panel,
			row,
			blockX,
			blockY,
			content: {
				x: blockX,
				y: blockY,
				w: block.w,
				h: block.h
			},
			texts
		};
	}
	const confusionTexts = [];
	{
		let cursor = centre.y - confusionBlockH / 2;
		confusionTexts.push({
			kind: "name",
			text: titles.confusion,
			x: centre.x,
			y: cursor + NAME_LINE / 2,
			font: nameFont
		});
		cursor += 24;
		if (model.showDomainDescriptions) {
			confusionTexts.push({
				kind: "sub",
				text: notes.confusion[1],
				x: centre.x,
				y: cursor + SUB_PITCH / 2,
				font: bodyFont
			});
			cursor += SUB_PITCH;
		}
		cursor += ITEM_GAP;
		for (const chip of confusionChips) {
			chip.x = centre.x - chip.w / 2;
			chip.y = cursor;
			cursor += chip.h + CHIP_GAP;
		}
	}
	const shapes = {
		...Object.fromEntries(QUADRANTS.map((name) => [name, quadrants[name].content])),
		confusion: {
			ellipse: true,
			cx: centre.x,
			cy: centre.y,
			rx,
			ry
		}
	};
	const arcs = [];
	for (const transition of model.transitions) {
		const arc = arcOf(portOf(shapes[transition.from], shapes[transition.to]), portOf(shapes[transition.to], shapes[transition.from]), centre, rx, ry);
		let label = null;
		if (transition.label) {
			const lines = wrap(transition.label, Math.max(96, Math.min(LABEL_CAP, plotW - 80)), bodyFont);
			const w = widest(lines, bodyFont) + 16;
			const h = lines.length * LABEL_LINE + 6;
			label = {
				lines,
				x: clamp(arc.apex.x + arc.nx * arc.away * 16 - w / 2, 30, plotX + plotW - 6 - w),
				y: clamp(arc.apex.y + arc.ny * arc.away * 16 - h / 2, plotY + 6, plotY + plotH - 6 - h),
				w,
				h
			};
		}
		arcs.push({
			...transition,
			...arc,
			label
		});
	}
	if (count > NODE_HINT) {
		const line = model.transitions[0]?.line || confusionRows[0]?.line || 1;
		errors.push(warning("LARGE_DIAGRAM", lang, line, `Cynefin 图有 ${count} 个条目，建议拆分`, `The Cynefin map holds ${count} items; consider splitting it`, "按域拆成多张图", "Split the map by domain"));
	}
	const planWidth = Math.ceil(plotW + 48);
	const planHeight = Math.ceil(plotY + plotH + MARGIN);
	if (count <= NODE_HINT && (planWidth > width * 2 || planHeight > width * 2)) {
		const line = confusionRows[0]?.line || 1;
		errors.push(warning("LARGE_DIAGRAM", lang, line, `Cynefin 图需要 ${planWidth}×${planHeight}px，超过图框两倍`, `The Cynefin map needs ${planWidth}×${planHeight}px, more than twice the frame`, "加宽图框，或减少域条目", "Widen the frame, or trim the domain items"));
	}
	return {
		width: planWidth,
		height: planHeight,
		title: titleLines.length ? {
			lines: titleLines,
			x: plotX + plotW / 2,
			top: 34
		} : null,
		plot: {
			x: plotX,
			y: plotY,
			w: plotW,
			h: plotH
		},
		centre,
		rx,
		ry,
		quadrants: QUADRANTS.map((name) => quadrants[name]),
		confusion: {
			texts: confusionTexts,
			chips: confusionChips
		},
		arcs,
		errors,
		anchor: {
			x: centre.x,
			y: centre.y
		}
	};
}
var path = (ctx, d, attrs, meta) => ctx.path(d, {
	...attrs,
	...meta ? { meta } : {}
});
function scene(plan, ctx) {
	const look = appearance(ctx);
	const paper = ctx.color("bg");
	const ink = ctx.design;
	const tone = (name) => ctx.frameTone(ctx.color(TONES[name]));
	const children = [];
	const label = (text, font, fill, x, y, anchor = "middle") => ctx.text(x, y, text, {
		anchor,
		size: font.size,
		weight: font.weight,
		fill,
		"dominant-baseline": "central"
	});
	const arrow = {
		tag: "marker",
		attrs: {
			id: "cynefin-arrow",
			viewBox: "0 0 8 8",
			refX: 7,
			refY: 4,
			markerWidth: 8,
			markerHeight: 8,
			markerUnits: "userSpaceOnUse",
			orient: "auto"
		},
		children: [ctx.path("M0 0 L8 4 L0 8 Z", { fill: ink.fg4 })]
	};
	children.push(ctx.el("defs", {}, [arrow]));
	for (const panel of plan.quadrants) {
		const color = tone(panel.id);
		children.push(ctx.rect(panel.x, panel.y, panel.w, panel.h, {
			rx: 8,
			fill: ctx.tint(paper, color, .07),
			stroke: ctx.tint(paper, color, .35),
			"stroke-width": 1,
			meta: {
				kind: "frame",
				id: panel.id
			}
		}));
	}
	const { x: px, y: py, w: pw, h: ph } = plan.plot;
	const seamY = plan.centre.y, seamX = plan.centre.x;
	const gapX = plan.rx + 12, gapY = plan.ry + 12;
	children.push(ctx.line(px, seamY, seamX - gapX, seamY, {
		stroke: ctx.color("axis"),
		"stroke-width": 2,
		"stroke-linecap": "round"
	}));
	children.push(ctx.line(seamX + gapX, seamY, px + pw, seamY, {
		stroke: ctx.color("axis"),
		"stroke-width": 2,
		"stroke-linecap": "round"
	}));
	children.push(ctx.line(seamX, py, seamX, seamY - gapY, {
		stroke: ctx.color("axis"),
		"stroke-width": 2,
		"stroke-linecap": "round"
	}));
	children.push(ctx.line(seamX, seamY + gapY, seamX, py + ph, {
		stroke: ink.danger,
		"stroke-width": 3,
		"stroke-linecap": "round"
	}));
	children.push({
		...ctx.el("ellipse", {
			cx: plan.centre.x,
			cy: plan.centre.y,
			rx: plan.rx,
			ry: plan.ry,
			fill: ctx.tint(paper, tone("confusion"), .08),
			stroke: ink.fg4,
			"stroke-width": 1.5,
			"stroke-dasharray": "4 3"
		}),
		meta: {
			kind: "frame",
			id: "confusion"
		}
	});
	for (const panel of plan.quadrants) for (const item of panel.texts) children.push(label(item.text, item.font, item.kind === "name" ? ink.fg1 : ctx.color("muted"), item.x, item.y));
	for (const item of plan.confusion.texts) children.push(label(item.text, item.font, item.kind === "name" ? ink.fg1 : ctx.color("muted"), item.x, item.y));
	const chip = (item, extra = {}) => ctx.el("g", {}, [
		ctx.rect(item.x, item.y, item.w, item.h, {
			rx: look.smallRadius,
			fill: extra.fill || (item.status ? ctx.tint(ctx.design.surface, ink[item.status], .1) : ctx.design.surface),
			stroke: extra.dashed ? ink.line2 : item.status ? ink[item.status] : ctx.design.line2,
			"stroke-width": 1,
			...extra.dashed ? { "stroke-dasharray": "4 3" } : {},
			...extra.meta ? { meta: extra.meta } : {}
		}),
		...item.icon ? [labelIcon(ctx, item.icon, item.x + CHIP_PAD_X + 6, item.y + item.h / 2, 12, ink.fg3)] : [],
		...item.lines.map((line, index) => label(line, FONT.label, ink.fg2, item.x + item.w / 2 + (item.icon ? 9 : 0), item.y + item.h / 2 + (index - (item.lines.length - 1) / 2) * LABEL_LINE))
	]);
	const addChip = (item) => {
		const drawing = chip(item, { meta: {
			kind: "node",
			id: item.id
		} });
		children.push(item.link ? ctx.link(item.link.href, [drawing], item.link) : drawing);
	};
	for (const panel of plan.quadrants) for (const item of panel.chips) addChip(item);
	for (const item of plan.confusion.chips) addChip(item);
	for (const arc of plan.arcs) children.push(path(ctx, `M${arc.a.x} ${arc.a.y} Q${arc.ctrl.x} ${arc.ctrl.y} ${arc.b.x} ${arc.b.y}`, {
		fill: "none",
		stroke: arc.status ? ctx.frameTone(ink[arc.status]) : ink.fg4,
		"stroke-width": 1.5,
		"marker-end": "url(#cynefin-arrow)"
	}, {
		kind: "edge",
		from: arc.from,
		to: arc.to
	}));
	for (const arc of plan.arcs) {
		if (!arc.label) continue;
		children.push({
			...ctx.el("g", {}, [ctx.rect(arc.label.x, arc.label.y, arc.label.w, arc.label.h, {
				rx: look.smallRadius,
				fill: paper,
				stroke: ctx.tint(paper, ink.fg4, .35),
				"stroke-width": 1
			}), ...arc.label.lines.map((line, index) => label(line, {
				size: FONT.label.size,
				weight: 400
			}, ctx.color("muted"), arc.label.x + arc.label.w / 2, arc.label.y + arc.label.h / 2 + (index - (arc.label.lines.length - 1) / 2) * LABEL_LINE))]),
			meta: {
				kind: "edge-label-group",
				from: arc.from,
				to: arc.to
			}
		});
	}
	if (plan.title) plan.title.lines.forEach((line, index) => children.push(label(line, {
		size: FONT.title.size,
		weight: FONT.title.weight
	}, ink.fg1, plan.title.x, plan.title.top + index * TITLE_LINE)));
	return {
		width: plan.width,
		height: plan.height,
		title: plan.title ? plan.title.lines.join(" ") : void 0,
		children,
		anchor: plan.anchor
	};
}
var implementations = { "cynefin-beta": {
	optionMode: "raw",
	parse,
	layout,
	scene,
	acceptsPresentation: true,
	honoredConfig: ["cynefin.showDomainDescriptions"]
} };
export { DOMAINS, NOTES, cynefin_exports, implementations };
