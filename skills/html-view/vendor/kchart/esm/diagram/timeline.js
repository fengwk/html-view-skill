import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { resolveIconRef } from "../core/icons.js";
import { normalizeLabel } from "./label.js";
import { presentation } from "./presentation.js";
import { FONT, error, warning, wrapText } from "./support.js";
// src/diagram/timeline.js
var timeline_exports = /* @__PURE__ */ __exportAll({ implementations: () => implementations });
function parse(body, info) {
	const { lang, firstLine = 2 } = info, errors = [], items = [], sections = [{
		name: "",
		items: []
	}];
	const look = presentation({ lang }), assets = /* @__PURE__ */ new Set();
	const direction = (info.params?.trim() || "LR").toUpperCase();
	const issue = (line, zh, en) => errors.push(error(lang, line, zh, en, "使用 timeline [LR|TD] 和「时段 : 事件」", "Use timeline [LR|TD] and “period : event”"));
	const noteAsset = (diagnostic) => {
		if (assets.has(diagnostic.message)) return;
		assets.add(diagnostic.message);
		errors.push(diagnostic);
	};
	const label = (raw, id, line) => {
		let source = raw.replace(/:::[\w-]+/g, "").trim(), explicit;
		const iconSuffix = /\s*::icon\(([^)]+)\)\s*$/i.exec(source);
		if (iconSuffix) {
			explicit = iconSuffix[1];
			source = source.slice(0, iconSuffix.index).trimEnd();
		}
		source = source.replace(/(?<![\w:/.-])(?:logos|mdi|tabler|simple-icons):[a-z\d-]+/gi, (ref) => {
			explicit ??= ref;
			return "";
		});
		const normalized = normalizeLabel(source, {
			lang,
			line
		});
		normalized.diagnostics.forEach(noteAsset);
		const resolved = explicit ? resolveIconRef(explicit) : null;
		if (explicit && !resolved) noteAsset(warning("IGNORED_ASSET", lang, line, `未知图标 ${explicit}`, `Unknown icon ${explicit}`, "使用内置图标或注册图标集", "Use a built-in icon or register its icon set"));
		return {
			text: normalized.text,
			icon: normalized.icon ?? resolved,
			id,
			line
		};
	};
	if (!["LR", "TD"].includes(direction)) issue(info.headerLine, "时间线方向必须是 LR 或 TD", "Timeline direction must be LR or TD");
	let title = {
		text: info.title || "",
		line: info.configLines?.title ?? info.headerLine ?? firstLine
	};
	const model = {
		type: "timeline",
		title: "",
		direction,
		items,
		sections,
		firstLine,
		config: info.config?.timeline || {}
	};
	if (body.length > 2e5) {
		issue(firstLine, "时间线源码超过 200000 字符，请拆分", "Timeline exceeds 200,000 characters; split the diagram");
		return {
			model,
			errors
		};
	}
	for (const [i, raw] of body.split("\n").entries()) {
		const line = i + firstLine;
		const text = raw.trim();
		if (!text || text.startsWith("#") || text.startsWith("%%")) continue;
		if (look.accept(text, line)) continue;
		const heading = /^(title|section)(?:\s*:\s*|\s+)(.+)$/i.exec(text);
		if (heading) {
			if (heading[1].toLowerCase() === "title") title = {
				text: heading[2],
				line
			};
			else {
				const section = label(heading[2], null, line);
				sections.push({
					name: section.text,
					icon: section.icon,
					items: []
				});
			}
			continue;
		}
		const parts = text.split(/\s*:(?=\s|$)/);
		const periodRaw = parts.shift();
		if (periodRaw.trim()) {
			const id = `period:${items.length}`;
			const period = label(periodRaw, id, line);
			period.events = [];
			period.eventDetails = [];
			itemClasses(periodRaw, id, line);
			period.index = items.length;
			items.push(period);
			sections.at(-1).items.push(period);
		}
		if (!items.length) issue(line, "事件前必须先声明时段", "Declare a period before its events");
		else {
			const item = items.at(-1);
			for (const rawEvent of parts) {
				const eventRaw = rawEvent.trim();
				if (!eventRaw) continue;
				const id = `${item.id}:event:${item.events.length}`;
				const event = label(eventRaw, id, line);
				itemClasses(eventRaw, id, line);
				item.events.push(event.text);
				item.eventDetails.push(event);
			}
		}
	}
	function itemClasses(raw, id, line) {
		const classes = [...raw.matchAll(/:::([\w-]+)/g)].map((match) => match[1]);
		if (classes.length) look.addClasses(id, classes, line);
	}
	if (!items.length) issue(firstLine, "缺少时段", "Expected a timeline period");
	const count = items.reduce((n, item) => n + 1 + item.events.length, 0);
	if (count > 2e3) issue(firstLine, `时间线有 ${count} 个条目，超过 2000，请拆分`, `Timeline has ${count} entries (limit 2,000); split the diagram`);
	for (const item of items) {
		item.status = look.statusOf(item.id);
		item.link = look.linkOf(item.id);
		for (const event of item.eventDetails) {
			event.status = look.statusOf(event.id);
			event.link = look.linkOf(event.id);
		}
	}
	const heading = label(title.text, null, title.line);
	model.title = info.title = heading.text;
	model.titleIcon = heading.icon;
	errors.push(...look.diagnostics());
	model.count = count;
	return {
		model,
		errors
	};
}
function layout(model, { width, ctx, measure, renderOptions }) {
	const { design: d } = ctx, { items, config, sections } = model;
	const vertical = model.direction === "TD";
	const finite = (value, fallback, floor) => Number.isFinite(Number(value)) ? Math.max(floor, Number(value)) : fallback;
	const left = finite(config.leftMargin, 24, 24), pad = finite(config.padding, 12, 12);
	const body = {
		...FONT.body,
		size: finite(config.taskFontSize, 13, 12)
	}, period = {
		...body,
		weight: 600
	};
	const lh = body.size + 5, iconSize = 16, iconGap = 6;
	const occupied = sections.reduce((n, s) => n + (s.name || s.icon || s.items.length ? Math.max(1, s.items.length) : 0), 0);
	const col = vertical ? Math.max(184, pad * 2 + 100) : Math.max(184, pad * 2 + 100, (width - left - 24) / occupied);
	const eventW = vertical ? Math.max(204, width - left - col - 76, pad * 2 + 100) : col - 2 * pad - 14;
	const w = vertical ? left + col + eventW + 76 : left + col * occupied + 24;
	const children = [], scene = {
		width: w,
		height: 0,
		title: model.title,
		children,
		...renderOptions?.frame ? { heading: model.title || void 0 } : {}
	};
	const add = (tag, attrs, meta) => children.push({
		...ctx.el(tag, attrs),
		...meta ? { meta } : {}
	});
	const text = (value, x, y, font, fill, anchor = "start", meta) => children.push(ctx.text(x, y, value, {
		...font,
		fill,
		anchor,
		"dominant-baseline": "central"
	}, meta));
	const wrap = (value, max, font) => wrapText(value, max, font, measure);
	const lines = (values, x, y, font, fill, anchor, pitch = lh) => values.forEach((value, i) => text(value, x, y + i * pitch, font, fill, anchor));
	const line = (x1, y1, x2, y2, stroke, dash) => add("line", {
		x1,
		y1,
		x2,
		y2,
		stroke,
		"stroke-width": 2,
		...dash ? { "stroke-dasharray": "4 4" } : {}
	});
	const card = (x, y, width, height, fill, stroke, meta) => ({
		...ctx.el("rect", {
			x,
			y,
			width,
			height,
			fill,
			stroke,
			rx: 6,
			"stroke-width": 1.5
		}),
		...meta ? { meta } : {}
	});
	const tone = (index) => ctx.color(`tone${config.disableMulticolor ? 1 : 1 + index % 6}`);
	const drawIcon = (icon, x, y, color) => {
		if (!icon) return null;
		const [vx, vy, iw, ih] = icon.viewBox.split(/\s+/).map(Number), scale = iconSize / Math.max(iw, ih), solid = icon.set !== "tabler";
		return ctx.el("g", {
			transform: `translate(${x - (vx + iw / 2) * scale} ${y - (vy + ih / 2) * scale}) scale(${scale})`,
			fill: solid ? color : "none",
			stroke: solid ? "none" : color,
			"stroke-width": 1.6,
			"stroke-linecap": "round",
			"stroke-linejoin": "round"
		}, icon.elements.map(({ tag, attrs }) => ctx.shape(tag, attrs)));
	};
	const boxColor = (status, fallback) => status && d[status] || fallback;
	const titleSlot = model.titleIcon ? 22 : 0;
	const title = !renderOptions?.frame && (model.title || model.titleIcon) ? wrap(model.title, w - 48 - titleSlot, FONT.title) : [];
	if (title.length && model.titleIcon) children.push(drawIcon(model.titleIcon, 32, 24, d.fg1));
	lines(title, 24 + titleSlot, 24, FONT.title, d.fg1, "start", 20);
	const top = title.length ? 24 + title.length * 20 : 24;
	const groups = sections.filter((group) => group.name || group.icon || group.items.length).map((group, index) => ({
		...group,
		index,
		width: vertical ? w - left - 24 : Math.max(col, col * group.items.length)
	}));
	const sectionLines = (group) => wrap(group.name, group.width - 2 * pad - (group.icon ? 22 : 0), FONT.body);
	const draws = items.map((item) => ({
		label: wrap(item.text, col - 2 * pad - 12 - (item.icon ? 22 : 0), period),
		events: item.events.map((event, i) => wrap(event, eventW - (vertical ? 2 * pad : 0) - (item.eventDetails[i].icon ? 22 : 0), body))
	}));
	const prepared = new Map(items.map((item, i) => [item, draws[i]]));
	const emitNodeCard = (item, x, y, width, height, color, font, wrapped, centered = false) => {
		const fill = item.status ? ctx.tint(d.bg, color, .12) : d.bg;
		const outline = card(x, y, width, height, fill, color, {
			kind: "node",
			id: item.id
		});
		const ix = x + pad;
		const iconNode = item.icon ? drawIcon(item.icon, ix + iconSize / 2, y + pad + lh / 2, color) : null;
		const tx = item.icon ? ix + iconSize + iconGap : centered ? x + width / 2 : x + pad;
		const textNodes = wrapped.map((value, i) => ctx.text(tx, y + pad + lh / 2 + i * lh, value, {
			...font,
			fill: d.fg1,
			anchor: centered && !item.icon ? "middle" : "start",
			"dominant-baseline": "central"
		}));
		if (item.link) children.push(ctx.link(item.link.href, [
			outline,
			...iconNode ? [iconNode] : [],
			...textNodes
		], item.link));
		else children.push(outline, ...iconNode ? [iconNode] : [], ...textNodes);
	};
	if (vertical) {
		const axis = left + col + 12, axisEnd = children.length, backgrounds = [];
		let y = top;
		for (const group of groups) {
			const start = y, color = tone(group.index), names = group.name || group.icon ? sectionLines(group) : [];
			if (names.length) {
				if (group.icon) children.push(drawIcon(group.icon, left + pad + iconSize / 2, y + 14, color));
				lines(names, left + pad + (group.icon ? 22 : 0), y + 14, FONT.body, d.fg1);
				y += names.length * lh + 12;
			}
			for (const item of group.items) {
				const { label, events } = prepared.get(item), cardH = label.length * lh + 2 * pad;
				const eventH = events.reduce((n, e) => n + e.length * lh + 2 * pad + 8, 0), center = y + cardH / 2;
				const nodeInk = boxColor(item.status, group.name ? color : tone(item.index));
				line(axis - 22, center, axis, center, nodeInk, true);
				add("circle", {
					cx: axis,
					cy: center,
					r: 5,
					fill: nodeInk
				});
				emitNodeCard(item, left, y, col - 10, cardH, nodeInk, period, label);
				let ey = y;
				for (const [i] of item.events.entries()) {
					const event = item.eventDetails[i], wrapped = events[i], h = wrapped.length * lh + 2 * pad, eventInk = boxColor(event.status, ctx.color("grid"));
					line(axis + 5, ey + h / 2, axis + 24, ey + h / 2, eventInk, true);
					emitNodeCard(event, axis + 24, ey, eventW, h, eventInk, body, wrapped);
					ey += h + 8;
				}
				y += Math.max(cardH, eventH) + 12;
			}
			if (names.length) {
				const frame = card(left - 8, start, group.width + 8, y - start, ctx.tint(d.bg, color, .08), "none", {
					kind: "frame",
					id: `section:${group.index}`
				});
				backgrounds.push(frame);
			}
			y += 12;
		}
		line(axis, top, axis, y - 20, ctx.color("grid"));
		const axisLine = children.pop();
		children.splice(axisEnd, 0, ...backgrounds, axisLine);
		scene.height = y + 8;
	} else {
		const axisY = top + Math.max(0, ...groups.map((group) => group.name || group.icon ? sectionLines(group).length * lh + 14 : 0)) + 8, y = axisY + 18;
		const labelH = Math.max(...draws.map((row) => row.label.length)) * lh + 2 * pad;
		const eventH = Math.max(0, ...draws.map((row) => row.events.reduce((n, event) => n + lh * event.length + 8, 0)));
		scene.height = y + labelH + eventH + 32;
		let x = left;
		for (const group of groups) {
			const color = tone(group.index);
			if (group.name || group.icon) {
				add("rect", {
					x,
					y: top - 8,
					width: group.width - 5,
					height: scene.height - top - 6,
					fill: ctx.tint(d.bg, color, .08),
					stroke: "none"
				}, {
					kind: "frame",
					id: `section:${group.index}`
				});
				if (group.icon) children.push(drawIcon(group.icon, x + pad + iconSize / 2, top + 6, color));
				lines(sectionLines(group), x + pad + (group.icon ? 22 : 0), top + 6, FONT.body, d.fg1);
			}
			x += group.width;
		}
		line(left, axisY, w - 24, axisY, ctx.color("grid"));
		x = left;
		for (const group of groups) {
			if (!group.items.length) {
				x += col;
				continue;
			}
			for (const item of group.items) {
				const { label, events } = prepared.get(item), color = boxColor(item.status, tone(group.name ? group.index : item.index));
				add("circle", {
					cx: x + col / 2,
					cy: axisY,
					r: 5,
					fill: color
				});
				emitNodeCard(item, x + 6, y, col - 16, labelH, color, period, label, true);
				let ey = y + labelH + 15;
				for (const [i] of item.events.entries()) {
					const event = item.eventDetails[i], wrapped = events[i], eventColor = boxColor(event.status, color);
					add("circle", {
						cx: x + pad + 2,
						cy: ey,
						r: 2.5,
						fill: eventColor
					});
					const eventLines = wrapped.map((value, j) => ctx.text(x + pad + 14 + (event.icon ? 22 : 0), ey + j * lh, value, {
						...body,
						fill: d.fg2,
						"dominant-baseline": "central"
					}));
					if (event.icon) eventLines.unshift(drawIcon(event.icon, x + pad + 14 + iconSize / 2, ey, eventColor));
					children.push(...event.link ? [ctx.link(event.link.href, eventLines, event.link)] : eventLines);
					ey += wrapped.length * lh + 8;
				}
				x += col;
			}
		}
	}
	const errors = scene.width > 2 * width || model.count > 60 ? [warning("LARGE_DIAGRAM", ctx.lang, model.firstLine, "时间线较大，可滚动查看", "Large timeline; scroll to view", "可拆成多张时间线", "Consider splitting the timeline")] : [];
	return {
		width: scene.width,
		height: scene.height,
		scene,
		errors
	};
}
var implementations = { timeline: {
	optionMode: "raw",
	parse,
	layout,
	acceptsPresentation: true,
	honoredConfig: [
		"timeline.leftMargin",
		"timeline.taskFontSize",
		"timeline.padding",
		"timeline.disableMulticolor"
	]
} };
export { implementations, timeline_exports };
