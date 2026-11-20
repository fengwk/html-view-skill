import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { DIRECTIONS, FONT, appearance, error, fallbackMeasure, warning, wrapText } from "./support.js";
import { layoutGraph } from "./graph-layout.js";
import { normalizeLabel } from "./label.js";
import { presentation } from "./presentation.js";
import { cubicPath } from "../core/geometry.js";
import { resolveIconRef } from "../core/icons.js";
// src/diagram/er.js
var er_exports = /* @__PURE__ */ __exportAll({
	implementations: () => implementations,
	parseEr: () => parseEr
});
var cards = new Map([
	["zero-one", [
		"|o",
		"o|",
		"one or zero",
		"zero or one"
	]],
	["exactly-one", [
		"||",
		"only one",
		"one",
		"1"
	]],
	["zero-many", [
		"}o",
		"o{",
		"zero or more",
		"zero or many",
		"many(0)",
		"many",
		"0+"
	]],
	["one-many", [
		"}|",
		"|{",
		"one or more",
		"one or many",
		"many(1)",
		"1+"
	]],
	[null, ["u"]]
].flatMap(([kind, spellings]) => spellings.map((spelling) => [spelling, kind])));
var escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var card = [...cards.keys()].sort((a, b) => b.length - a.length).map(escaped).join("|");
var name = String.raw`(?:"[^"]+"|[\w.*\u0080-\uFFFF-]+)`;
var classes = String.raw`(?:\s*:::\s*([\w-]+(?:\s*,\s*[\w-]+)*))?`;
var relation = new RegExp(String.raw`^(${name})${classes}(?:\s+|(?=[|}]|o[|{]))(${card})(?:\s*(--|\.\.|\.-|-\.)\s*|\s+(to|optionally to)\s+)(${card})(?:\s+|(?<=[|{]|}o))(${name})${classes}(?:\s*:\s*(.+))?$`, "i");
var declaration = new RegExp(String.raw`^(${name})${classes}\s*(?:\[\s*("[^"]+"|[^\]]+?)\s*\])?${classes}\s*(\{.*)?$`);
var attribute = String.raw`(?:\x60[^\x60]+\x60|[^\s~]*~[^~\r\n]+~[^\s~}]*|[\p{L}_*][\p{L}\p{N}_*\[\]().,-]*)`;
var row = new RegExp(String.raw`\s*(${attribute}\??)\s+(${attribute})(?:\s+((?:PK|FK|UK)\b(?:\s*,\s*(?:PK|FK|UK)\b)*))?(?:\s*("[^"]*"))?`, "iuy");
var unquote = (value) => value?.replace(/^"([\s\S]*)"$/, "$1");
var markdownText = (value) => value.replace(/(^|\s)(\*\*|__|\*|_)(\S(?:.*?\S)?)\2(?=\s|$)/g, "$1$3");
var iconRow = "";
var withIconRow = (value, icon) => icon ? value ? `${iconRow}\n${value}` : iconRow : value;
var attrText = (value) => value.replace(/^`([^`]+)`(\??)$/, "$1$2");
var LIMITS = {
	nodes: 300,
	edges: 180,
	depth: 3
};
function parseEr(body, info = {}) {
	const { header = "erDiagram", headerLine = 1, firstLine = headerLine + 1, lang } = info;
	const model = {
		type: "er",
		direction: "TB",
		nodes: [],
		edges: [],
		subgraphs: []
	};
	const errors = [], groups = /* @__PURE__ */ new Map(), entities = /* @__PURE__ */ new Map(), stack = [];
	const look = presentation({ lang });
	const assets = /* @__PURE__ */ new Map();
	const addAssetIssue = (issue) => {
		const prior = assets.get(issue.message);
		if (!prior || issue.line < prior.line) assets.set(issue.message, issue);
	};
	const label = (raw, line, plain = false) => {
		let explicit = null;
		const source = unquote(raw).replace(/::icon\(\s*([\w:-]+)\s*\)|(?<![\w:-])((?:logos|mdi|tabler|simple-icons):[\w-]+)/gi, (_, call, token) => {
			const ref = call ?? token;
			const icon = resolveIconRef(ref);
			if (!icon) addAssetIssue(warning("IGNORED_ASSET", lang, line, `未知图标 ${ref}`, `Unknown icon ${ref}`, "改用内置图标", "Use a supported icon"));
			explicit ??= icon;
			return "";
		});
		const result = normalizeLabel(plain ? source : markdownText(source), {
			lang,
			line
		});
		result.diagnostics.forEach(addAssetIssue);
		return {
			text: result.text,
			icon: result.icon ?? explicit
		};
	};
	const addClasses = (id, line, ...lists) => {
		for (const list of lists) if (list) look.addClasses(id, list.split(/\s*,\s*/), line);
	};
	let seq = 0, block = null, accessibility = false, duplicateMember = false;
	const issue = (line, zh, en) => errors.push(error(lang, line, zh, en, "检查 ER 实体、属性或关系语法", "Check the ER entity, attribute or relationship syntax"));
	const setDirection = (value, line) => {
		const dir = value.toUpperCase().replace(/^TD$/, "TB");
		if (!DIRECTIONS.includes(dir)) issue(line, `无效方向：${value}`, `Invalid direction: ${value}`);
		else if (stack.length) stack.at(-1).dir = dir;
		else model.direction = dir;
	};
	const mentions = [];
	const mention = (id, line, alias, fields, endpoint = false) => {
		const item = {
			id: unquote(id),
			line,
			alias,
			fields,
			endpoint,
			parent: stack.at(-1)?.id ?? null,
			seq: seq++
		};
		mentions.push(item);
		return item;
	};
	const addFields = ({ fields, source, line }) => {
		row.lastIndex = 0;
		let offset = 0, currentLine = line;
		const limit = source.trimEnd().length;
		while (offset < limit) {
			const field = row.exec(source);
			if (!field) {
				const start = offset + source.slice(offset).search(/\S/);
				issue(line + source.slice(0, start).split("\n").length - 1, "无效的属性行", "Invalid attribute row");
				return;
			}
			const [, type, attr, keys, comment] = field;
			const fieldLine = currentLine + field[0].slice(0, field[0].search(/\S/)).split("\n").length - 1;
			const typeLabel = label(attrText(type), fieldLine, true), nameLabel = label(attrText(attr), fieldLine, true);
			const note = comment && label(comment, fieldLine, true);
			fields.push({
				type: typeLabel.text,
				name: nameLabel.text,
				keys: keys?.toUpperCase().split(/\s*,\s*/) ?? [],
				comment: note ? note.text : null,
				...typeLabel.icon ? { typeIcon: typeLabel.icon } : {},
				...nameLabel.icon ? { nameIcon: nameLabel.icon } : {},
				...note?.icon ? { commentIcon: note.icon } : {}
			});
			currentLine += field[0].split("\n").length - 1;
			offset = row.lastIndex;
		}
	};
	const consume = (raw, line) => {
		let text = raw.trim();
		while (text) {
			if (block) {
				const end = [...text.matchAll(/"[^"]*"|`[^`]*`|~[^~]*~|(\}|%%)/g)].find((match) => match[1]);
				const closed = end?.[1] === "}";
				block.source += (end ? text.slice(0, end.index) : text) + (closed ? "" : "\n");
				if (!closed) return;
				addFields(block);
				block = null;
				text = text.slice(end.index + 1).trim();
				continue;
			}
			if (accessibility) {
				accessibility = !text.includes("}");
				return;
			}
			if (/^accDescr\s*\{/i.test(text)) {
				accessibility = !text.includes("}");
				return;
			}
			if (/^acc(?:Title|Descr)\s*:/i.test(text)) return;
			const comment = [...text.matchAll(/"[^"]*"|`[^`]*`|~[^~]*~|(%%)/g)].find((match) => match[1]);
			if (comment) text = text.slice(0, comment.index).trimEnd();
			if (!text || look.accept(text, line)) return;
			const dir = /^direction\s+(.+)$/i.exec(text);
			if (dir) {
				setDirection(dir[1], line);
				return;
			}
			if (/^end$/i.test(text)) {
				if (!stack.pop()) issue(line, "没有对应的子图", "No matching subgraph");
				return;
			}
			const group = /^subgraph\s+(.+)$/i.exec(text);
			if (group) {
				const decl = declaration.exec(group[1]);
				const id = unquote(decl?.[1]);
				if (!id || decl[5] || groups.has(id)) issue(line, "无效或重复的子图声明", "Invalid or duplicate subgraph declaration");
				else {
					const title = label(decl[3] ?? decl[1], line);
					const item = {
						id,
						title: title.text,
						icon: title.icon,
						parent: stack.at(-1)?.id ?? null,
						seq: seq++,
						depth: stack.length + 1,
						dir: null,
						line
					};
					addClasses(id, line, decl[2], decl[4]);
					if (item.depth === LIMITS.depth + 1) issue(line, `子图嵌套 ${item.depth} 层，超过上限 ${LIMITS.depth}`, `Subgraph nesting exceeds ${LIMITS.depth} levels`);
					groups.set(id, item);
					stack.push(item);
					model.subgraphs.push(item);
				}
				return;
			}
			const rel = relation.exec(text);
			if (rel) {
				const [, from, fromClasses, start, symbol, word, end, to, toClasses, role] = rel;
				const a = mention(from, line, null, null, true).id, b = mention(to, line, null, null, true).id;
				addClasses(a, line, fromClasses);
				addClasses(b, line, toClasses);
				const caption = role && label(role.trim(), line);
				model.edges.push({
					from: a,
					to: b,
					startCard: cards.get(start.toLowerCase()),
					endCard: cards.get(end.toLowerCase()),
					style: symbol === "--" || word?.toLowerCase() === "to" ? "solid" : "dashed",
					label: caption ? caption.text : null,
					icon: caption?.icon ?? null,
					seq: model.edges.length,
					extra: 0,
					line
				});
				if (model.edges.length === LIMITS.edges + 1) issue(line, `关系超过 ${LIMITS.edges} 条，请拆分图表`, `More than ${LIMITS.edges} relationships; split the diagram`);
				return;
			}
			const decl = declaration.exec(text);
			if (!decl) {
				issue(line, `无法解析的语句：${text}`, `Unrecognized statement: ${text}`);
				return;
			}
			const fields = [];
			const { id } = mention(decl[1], line, decl[3], fields);
			addClasses(id, line, decl[2], decl[4]);
			if (decl[5] == null) return;
			block = {
				fields,
				source: "",
				line
			};
			text = decl[5].slice(1).trim();
			if (!text) block.source = "\n";
		}
	};
	const headerTail = header.replace(/^\s*erDiagram\b/i, "").trim();
	if (DIRECTIONS.includes(headerTail.toUpperCase()) || /^TD$/i.test(headerTail)) setDirection(headerTail, headerLine);
	else consume(headerTail, headerLine);
	body.split("\n").forEach((text, i) => {
		if (block && !text.trim()) block.source += "\n";
		else consume(text, firstLine + i);
	});
	if (block) issue(block.line, "属性块没有结束的 }", "Unclosed attribute block");
	for (const group of stack) issue(group.line, "子图没有结束的 end", "Unclosed subgraph");
	for (const { id, alias, fields, endpoint, parent, line, seq } of mentions) {
		if (endpoint && groups.has(id)) continue;
		if (groups.has(id)) {
			issue(line, "实体与子图同名", "An entity and a subgraph share the same name");
			continue;
		}
		let entity = entities.get(id);
		if (!entity) {
			entity = {
				id,
				kind: "er",
				shape: "er",
				fields: [],
				parent,
				seq,
				line
			};
			entities.set(id, entity);
			model.nodes.push(entity);
			if (model.nodes.length === LIMITS.nodes + 1) issue(line, `实体超过 ${LIMITS.nodes} 个，请拆分图表`, `More than ${LIMITS.nodes} entities; split the diagram`);
		}
		if (parent && !entity.parent) entity.parent = parent;
		else if (parent && parent !== entity.parent && !duplicateMember) {
			duplicateMember = true;
			errors.push(warning("DIAGRAM_HINT", lang, line, "实体属于多个子图，仅保留首次归属", "Entities in multiple subgraphs keep their first membership", "每个实体只放在一个子图", "Place each entity in only one subgraph"));
		}
		if (alias) entity.alias = {
			value: alias,
			line
		};
		if (fields) entity.fields.push(...fields);
	}
	for (const entity of model.nodes) {
		const { value, line } = entity.alias ?? {
			value: `"${entity.id}"`,
			line: entity.line
		};
		const caption = label(value, line);
		Object.assign(entity, {
			label: caption.text,
			icon: caption.icon
		});
		delete entity.alias;
	}
	for (const item of [...model.nodes, ...model.subgraphs]) {
		item.status = look.statusOf(item.id);
		item.link = look.linkOf(item.id);
	}
	for (const edge of model.edges) {
		edge.fromFrame = groups.has(edge.from);
		edge.toFrame = groups.has(edge.to);
		edge.status = look.edgeStatusOf(edge.seq);
	}
	if (model.nodes.length > 30 || model.edges.length > 50) {
		const degree = /* @__PURE__ */ new Map();
		const limit = 6;
		for (const edge of model.edges) {
			for (const id of /* @__PURE__ */ new Set([edge.from, edge.to])) degree.set(id, (degree.get(id) ?? 0) + 1);
			if (degree.get(edge.from) <= limit && degree.get(edge.to) <= limit) continue;
			errors.push(error(lang, edge.line, `大型 ER 图每个实体最多连接 ${limit} 条关系`, `Large ER diagrams support at most ${limit} relations per entity`, "请按关系拆分 ER 图", "Split the ER diagram by relationship"));
			break;
		}
	}
	errors.push(...look.diagnostics(), ...assets.values());
	const parentOf = (id) => (groups.get(id) ?? entities.get(id))?.parent;
	const inside = (id, group) => {
		for (let parent = parentOf(id); parent; parent = parentOf(parent)) if (parent === group) return true;
		return false;
	};
	const directedGroups = model.subgraphs.filter((group) => group.dir && model.edges.some((edge) => inside(edge.from, group.id) !== inside(edge.to, group.id)));
	if (directedGroups.length) {
		const ids = directedGroups.map((group) => group.id).join(", ");
		errors.push(warning("DIAGRAM_HINT", lang, directedGroups[0].line, `跨边界连线使子图继承外层方向：${ids}`, `Subgraphs with external member links inherit the enclosing direction: ${ids}`, "在图的顶层设置方向", "Set the direction at the top level"));
	}
	return {
		model,
		errors
	};
}
function measureEntity(node, measure) {
	const pad = 12, gap = 12;
	const headLines = node.label || node.icon ? wrapText(withIconRow(node.label, node.icon), 180, FONT.title, measure) : [];
	const headerH = headLines.length * 19 + 14;
	const rows = node.fields.map(() => []);
	const columns = [
		[
			"attribute-type",
			"fg3",
			FONT.body,
			80,
			(field) => field.type,
			(field) => field.typeIcon
		],
		[
			"attribute",
			"fg2",
			FONT.body,
			120,
			(field) => field.name,
			(field) => field.nameIcon
		],
		[
			"attribute-key",
			"fg3",
			FONT.label,
			48,
			(field) => field.keys.join(" ")
		],
		[
			"attribute-comment",
			"fg3",
			FONT.body,
			136,
			(field) => field.comment,
			(field) => field.commentIcon
		]
	];
	let right = pad;
	for (const [kind, tone, font, preferred, getText, getIcon] of columns) {
		const widthOf = (value) => value === iconRow ? 12 : measure(value, font);
		const cells = node.fields.map((field) => ({
			paragraphs: (getText(field) ?? "").split("\n").map((line) => line.split(/[ \t]+/).filter(Boolean)),
			icon: getIcon?.(field)
		}));
		let budget = preferred;
		for (const { paragraphs } of cells) for (const words of paragraphs) for (const word of words) budget = Math.max(budget, widthOf(word));
		let width = 0;
		for (const [i, { paragraphs, icon }] of cells.entries()) {
			const lines = icon ? [iconRow] : [];
			for (const words of paragraphs) {
				let line = "";
				for (const word of words) {
					const next = line ? `${line} ${word}` : word;
					if (line && widthOf(next) > budget) {
						lines.push(line);
						line = word;
					} else line = next;
				}
				if (line) lines.push(line);
			}
			for (const line of lines) width = Math.max(width, widthOf(line));
			if (lines.length) rows[i].push({
				x: right,
				kind,
				tone,
				font,
				lines,
				icon
			});
		}
		if (width) right += width + gap;
	}
	const rowHeights = rows.map((cells) => 8 + Math.max(1, ...cells.map((cell) => cell.lines.length)) * 17);
	return {
		w: Math.max(168, right - gap + pad, ...headLines.map((line) => 24 + measure(line, FONT.title))),
		h: headerH + rowHeights.reduce((sum, height) => sum + height, 0) + 6,
		rows,
		rowHeights,
		headLines,
		headerH
	};
}
function layout(model, options, info = {}) {
	const table = new Map(model.nodes.map((node) => [node.id, measureEntity(node, options.measure ?? fallbackMeasure)]));
	const nodes = model.nodes.map((node) => ({
		...node,
		fields: [],
		block: table.get(node.id)
	}));
	const subgraphs = model.subgraphs.map((frame) => ({
		...frame,
		title: withIconRow(frame.title, frame.icon)
	}));
	const edges = model.edges.map((edge) => ({
		...edge,
		label: withIconRow(edge.label, edge.icon)
	}));
	const geometry = layoutGraph({
		...model,
		nodes,
		subgraphs,
		edges
	}, options);
	for (const edge of geometry.edges) if (edge.self) {
		const { startCard, endCard } = model.edges[edge.id];
		Object.assign(edge, {
			startCard,
			endCard
		});
	}
	if (geometry.width > options.width * 2 || nodes.length > 60 || edges.length > 50 || nodes.length > 30) geometry.errors = [...geometry.errors ?? [], warning("LARGE_DIAGRAM", info.lang, info.headerLine, "ER 图较大，可横向滚动", "This ER diagram is large and can be scrolled horizontally", "可拆成多个局部图", "Consider splitting it into smaller diagrams")];
	return {
		...geometry,
		model,
		table
	};
}
function scene(geometry, ctx) {
	const a = appearance(ctx);
	const group = (children, meta) => ({
		...ctx.el("g", {}, children),
		meta
	});
	const linked = (item, drawing) => item.link ? ctx.link(item.link.href, [drawing], item.link) : drawing;
	const statusMeta = (item) => item.status ? { status: item.status } : {};
	const text = (x, y, value, opts, meta, icon) => {
		if (value !== iconRow || !icon) return ctx.text(x, y, value, {
			"dominant-baseline": "central",
			...opts,
			meta
		});
		const [left, top, w, h] = icon.viewBox.split(/\s+/).map(Number);
		const scale = 12 / Math.max(w, h), cx = x + (opts.anchor === "start" ? 6 : 0);
		return {
			...ctx.el("g", { transform: `translate(${cx - (left + w / 2) * scale} ${y - (top + h / 2) * scale}) scale(${scale})` }, icon.elements.map(({ tag, attrs }) => ctx.shape(tag, {
				...attrs,
				...icon.set === "tabler" ? {
					fill: "none",
					stroke: opts.fill,
					"stroke-width": 2,
					"stroke-linecap": "round",
					"stroke-linejoin": "round"
				} : { fill: opts.fill }
			}))),
			meta: { kind: "icon" }
		};
	};
	const line = (d, stroke = a.line2) => ctx.path(d, {
		fill: "none",
		stroke
	});
	const minOne = "M4 2 V14", maxOne = "M12 2 V14", many = "M15 2 L9 8 L15 14 M9 8 H15";
	const markerId = (kind, status) => `er-card-${kind}${status ? `-${status}` : ""}`;
	const statuses = /* @__PURE__ */ new Set([null, ...geometry.model.edges.map((edge) => edge.status).filter(Boolean)]);
	const defs = ctx.el("defs", {}, [...statuses].flatMap((status) => {
		const stroke = a[status] || a.fg4;
		const zero = ctx.circle(4, 8, 3, {
			fill: a.surface,
			stroke,
			"stroke-width": 1.4
		});
		const bar = (d) => ctx.path(d, {
			fill: "none",
			stroke,
			"stroke-width": 1.4
		});
		const markerShapes = {
			"zero-one": [zero, bar(maxOne)],
			"exactly-one": [bar(minOne), bar(maxOne)],
			"zero-many": [zero, bar(many)],
			"one-many": [bar(minOne), bar(many)]
		};
		return Object.entries(markerShapes).map(([kind, children]) => ctx.el("marker", {
			id: markerId(kind, status),
			viewBox: "0 0 16 16",
			refX: 16,
			refY: 8,
			markerWidth: 16,
			markerHeight: 16,
			markerUnits: "userSpaceOnUse",
			orient: "auto-start-reverse"
		}, children));
	}));
	const frames = [], edges = [], entities = [], labels = [], titles = [];
	const frameModel = new Map(geometry.model.subgraphs.map((frame) => [frame.id, frame]));
	for (const frame of geometry.frames) {
		const item = frameModel.get(frame.id);
		const stroke = a[item.status] || ctx.frameTone(a.line2);
		frames.push(linked(item, group([ctx.rect(frame.x, frame.y, frame.w, frame.h, {
			fill: a.surface,
			stroke,
			rx: 6,
			"stroke-dasharray": "5 4"
		})], {
			kind: "frame",
			id: frame.id,
			...statusMeta(item)
		})));
		if (frame.lines?.length) {
			const { x, y, w, h } = frame.titleRect;
			titles.push(ctx.rect(x - 3, y - 3, w + 6, h + 6, {
				fill: a.surface,
				rx: 2
			}));
			frame.lines.forEach((value, i) => titles.push(text(x, y + (i + .5) * 17, value, {
				anchor: "start",
				size: FONT.body.size,
				weight: FONT.title.weight,
				fill: a.fg3
			}, {
				kind: "frame-title",
				id: frame.id
			}, item.icon)));
		}
	}
	for (const edge of geometry.edges) {
		const { from, to, startCard, endCard } = edge;
		const { status, icon } = geometry.model.edges[edge.id];
		if (edge.segments?.length) edges.push({
			...ctx.path(cubicPath(edge.segments), {
				fill: "none",
				stroke: a[status] || a.fg4,
				"stroke-width": 1.25,
				...edge.style === "dashed" ? { "stroke-dasharray": "5 4" } : {},
				...startCard ? { "marker-start": `url(#${markerId(startCard, status)})` } : {},
				...endCard ? { "marker-end": `url(#${markerId(endCard, status)})` } : {}
			}),
			meta: {
				kind: "edge",
				from,
				to,
				...statusMeta({ status })
			}
		});
		if (edge.labelRect && edge.labelLines?.length) {
			const { x, y, w, h } = edge.labelRect;
			labels.push(group([ctx.rect(x, y, w, h, {
				fill: a.surface,
				rx: 3
			}), ...edge.labelLines.map((value, i) => text(x + w / 2, y + h / 2 + (i - (edge.labelLines.length - 1) / 2) * 16, value, {
				anchor: "middle",
				size: FONT.label.size,
				fill: a.fg3
			}, { kind: "edge-label" }, icon))], {
				kind: "edge-label-group",
				from,
				to
			}));
		}
	}
	const nodes = new Map(geometry.model.nodes.map((node) => [node.id, node]));
	for (const { id, x, y, w, h } of geometry.nodes) {
		const node = nodes.get(id), er = geometry.table.get(id);
		const color = a[node.status];
		const fill = color && node.status !== "ext" ? ctx.mix(a.node, color, a.soft) : a.node;
		const children = [ctx.rect(x, y, w, h, {
			fill,
			stroke: color || a.line2,
			"stroke-width": 1.25,
			rx: 3,
			...node.status === "ext" ? { "stroke-dasharray": "4 3" } : {}
		})];
		const headY = er.rows.length ? y + er.headerH / 2 : y + h / 2;
		er.headLines.forEach((value, i) => children.push(text(x + w / 2, headY + (i - (er.headLines.length - 1) / 2) * 19, value, {
			anchor: "middle",
			...FONT.title,
			fill: a.fg1
		}, {
			kind: "node-label",
			id
		}, node.icon)));
		if (er.rows.length) children.push(line(`M${x + 1} ${y + er.headerH} H${x + w - 1}`));
		let rowY = y + er.headerH + 2;
		for (const [i, cells] of er.rows.entries()) {
			const { name } = node.fields[i];
			const rowH = er.rowHeights[i], cy = rowY + rowH / 2;
			children.push(group(cells.flatMap((cell) => cell.lines.map((value, j) => text(x + cell.x, cy + (j - (cell.lines.length - 1) / 2) * 17, value, {
				anchor: "start",
				...cell.font,
				fill: a[cell.tone]
			}, {
				kind: cell.kind,
				entity: id,
				attribute: name
			}, cell.icon))), {
				kind: "attribute-row",
				entity: id,
				attribute: name
			}));
			rowY += rowH;
		}
		entities.push(linked(node, group(children, {
			kind: "node",
			id,
			...statusMeta(node)
		})));
	}
	return {
		width: geometry.width,
		height: geometry.height,
		children: [
			defs,
			...frames,
			...edges,
			...entities,
			...labels,
			...titles
		]
	};
}
var implementations = { erDiagram: {
	optionMode: "raw",
	acceptsPresentation: true,
	honoredConfig: [],
	parse: parseEr,
	layout,
	scene
} };
export { er_exports, implementations, parseEr };
