import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { FONT, appearance, error, warning } from "./support.js";
import { presentation } from "./presentation.js";
import { normalizeLabel } from "./label.js";
import { resolveIconRef } from "../core/icons.js";
import { layoutGraph } from "./graph-layout.js";
import { cubicPath } from "../core/geometry.js";
// src/diagram/class.js
var class_exports = /* @__PURE__ */ __exportAll({
	arrowMarkers: () => arrowMarkers,
	directions: () => directions,
	finishCards: () => finishCards,
	implementation: () => implementation,
	implementations: () => implementations,
	kind: () => kind,
	kinds: () => kinds,
	layoutCards: () => layoutCards,
	limits: () => limits,
	markers: () => markers,
	parse: () => parseClass,
	parseClass: () => parseClass
});
var kind = Object.freeze({
	kind: "classDiagram",
	syntax: "mermaid",
	topic: "data-model",
	aliases: Object.freeze(["classDiagram-v2"])
});
var kinds = Object.freeze([kind]);
var limits = Object.freeze({
	cards: 2e3,
	edges: 5e3,
	large: 60
});
var directions = Object.freeze([
	"TB",
	"BT",
	"RL",
	"LR"
]);
var markers = Object.freeze([
	"triangle",
	"filledDiamond",
	"hollowDiamond",
	"arrow",
	"circle",
	"cross"
]);
var arrowMarkers = Object.freeze({
	"<|": "triangle",
	"|>": "triangle",
	"*": "filledDiamond",
	o: "hollowDiamond",
	">": "arrow",
	"<": "arrow",
	"()": "circle"
});
var VISIBILITY = "#+~-";
var issue = (lang, line, zh, en, fixZh, fixEn, column = 1) => error(lang, line, zh, en, fixZh, fixEn, column);
var unknownStatement = (lang, line, text) => issue(lang, line, `不支持或无效的类图语句：「${text}」`, `Unsupported or invalid class-diagram statement: "${text}"`, "使用 class、namespace、note、direction 或「A <|-- B : 标签」", "Use class, namespace, note, direction, or \"A <|-- B : label\"");
var unquote = (value) => {
	const text = String(value ?? "").trim();
	const quoted = /^"([^"]*)"$/u.exec(text);
	if (quoted) return quoted[1];
	return /^`[^`]*`$/u.test(text) ? text.slice(1, -1) : text;
};
var ATOM = String.raw`(?:\u0060[^\u0060]*\u0060|~[^~\s]*~|[\p{L}\p{N}\p{M}_$]|[-.](?![-.]))`;
var NAME = `${ATOM}+`;
var END = String.raw`(?:<\|?|\|>|\(\s*\)|o|\*|>|<)`;
var NAME_HEAD = new RegExp(`^(?:${ATOM})+`, "u");
var RELATION = new RegExp(`^(${NAME})\\s*(?:"([^"]*)")?\\s*((?:${END})?(?:--|\\.\\.)(?:${END})?)\\s*(?:"([^"]*)")?\\s*(${NAME})(?:\\s*:\\s*(.+))?$`, "u");
var ARROW = new RegExp(`^(?:(${END}))?(--|\\.\\.)(?:(${END}))?$`, "u");
var NOTE_FOR = new RegExp(`^note\\s+for\\s+(${NAME})\\s+"([^"]*)"$`, "iu");
var NOTE = /^note\s+"([^"]*)"$/iu;
var CLASS_DECL = /^class\s+(.+)$/iu;
var NAMESPACE_DECL = /^namespace\s+(.+)$/iu;
var ANNOTATION_LINE = new RegExp(`^<<\\s*([^<>]+?)\\s*>>\\s+(${NAME})$`, "u");
var ANNOTATION_HEAD = /^<<\s*([^<>]+?)\s*>>/u;
var COLON_MEMBER = new RegExp(`^(${NAME})\\s*:\\s*([\\s\\S]+)$`, "u");
var CLASS_ONLY = new RegExp(`^(${NAME})\\s*:::\\s*([\\w-]+(?:\\s*,\\s*[\\w-]+)*)$`, "u");
var BARE_NAME = new RegExp(`^(${NAME})$`, "u");
var LABEL_SUFFIX = /^\[\s*"([^"]*)"\s*\]/u;
var STYLE_SUFFIX = /^:::\s*([\w-]+(?:\s*,\s*[\w-]+)*)/u;
var DIRECTION = new RegExp(`\\bdirection\\s+(${directions.join("|")})\\b`, "iu");
var ICON_SUFFIX = /^::icon\s*\(\s*([^()]+?)\s*\)/u;
var ACCESSIBILITY = /^acc(?:Title|Descr)\b/iu;
var METHOD = /^([#+~-])?(.+)\((.*)\)([\s$*])?(.*)([$*])?$/u;
function stripComment(raw) {
	let quote = "", backtick = false;
	for (let i = 0; i < raw.length; i += 1) {
		const ch = raw[i];
		if (backtick) {
			if (ch === "`") backtick = false;
			continue;
		}
		if (ch === "`") {
			backtick = true;
			continue;
		}
		if (quote) {
			if (ch === quote) quote = "";
			continue;
		}
		if (ch === "\"" || ch === "'") {
			quote = ch;
			continue;
		}
		if (ch === "%" && raw[i + 1] === "%") return raw.slice(0, i);
	}
	return raw;
}
function indexOutside(raw, wanted) {
	let quote = "", backtick = false;
	for (let i = 0; i < raw.length; i += 1) {
		const ch = raw[i];
		if (backtick) {
			if (ch === "`") backtick = false;
			continue;
		}
		if (ch === "`") {
			backtick = true;
			continue;
		}
		if (quote) {
			if (ch === quote) quote = "";
			continue;
		}
		if (ch === "\"" || ch === "'") {
			quote = ch;
			continue;
		}
		if (wanted === "arrow" ? (ch === "-" || ch === ".") && raw[i + 1] === ch : ch === wanted) return i;
	}
	return -1;
}
function statementsOf(input, firstLine) {
	if (Array.isArray(input)) return input.filter((item) => item && typeof item.text === "string").map((item) => ({
		text: item.text,
		line: Number.isFinite(item.line) ? item.line : firstLine
	}));
	return String(input ?? "").replace(/\r\n?/gu, "\n").split("\n").map((text, index) => ({
		text,
		line: firstLine + index
	}));
}
function takeName(text, start = 0) {
	const match = NAME_HEAD.exec(text.slice(start));
	return match ? {
		raw: match[0],
		next: start + match[0].length
	} : null;
}
function nameParts(raw) {
	const parts = (String(raw).startsWith("`") ? String(raw).slice(1, -1) : String(raw)).split("~");
	return {
		id: parts[0],
		generic: parts.length > 1 ? parts[1] : ""
	};
}
var tildeCount = (text) => Math.max(0, String(text).split("~").length - 1);
function processSet(input) {
	const count = tildeCount(input);
	if (count <= 1) return input;
	let text = input, prefixed = false;
	if (count % 2 !== 0 && text.startsWith("~")) {
		text = text.slice(1);
		prefixed = true;
	}
	const chars = [...text];
	let first = chars.indexOf("~"), last = chars.lastIndexOf("~");
	while (first !== -1 && last !== -1 && first !== last) {
		chars[first] = "&lt;";
		chars[last] = "&gt;";
		first = chars.indexOf("~");
		last = chars.lastIndexOf("~");
	}
	if (prefixed) chars.unshift("~");
	return chars.join("");
}
function parseGenericTypes(input) {
	const sets = String(input ?? "").split(/(,)/u), output = [];
	for (let i = 0; i < sets.length; i += 1) {
		let set = sets[i];
		if (set === "," && i > 0 && i + 1 < sets.length && tildeCount(sets[i - 1]) === 1 && tildeCount(sets[i + 1]) === 1) {
			set = `${sets[i - 1]},${sets[i + 1]}`;
			i += 1;
			output.pop();
		}
		output.push(processSet(set));
	}
	return output.join("");
}
function decorate(row, classifier) {
	if (classifier === "*") row.fontStyle = "italic";
	else if (classifier === "$") row.decoration = "underline";
	return row;
}
function parseMember(input) {
	const text = String(input).trim();
	const method = text.indexOf(")") > 0 ? METHOD.exec(text) : null;
	if (method) {
		const visibility = method[1] || "";
		const id = String(method[2]).trim();
		const parameters = String(method[3] || "").trim();
		let classifier = String(method[4] || "").trim();
		let returnType = String(method[5] || "").trim();
		if (!classifier && /[$*]$/u.test(returnType)) {
			classifier = returnType.slice(-1);
			returnType = returnType.slice(0, -1);
		}
		const head = `${visibility}${parseGenericTypes(id)}(${parseGenericTypes(parameters)})`;
		return {
			method: true,
			item: decorate({ text: (returnType ? `${head} : ${parseGenericTypes(returnType)}` : head).trim() }, classifier)
		};
	}
	const length = text.length;
	const visibility = VISIBILITY.includes(text[0] || "") ? text[0] : "";
	const classifier = /[$*]$/u.test(text) ? text.slice(-1) : "";
	let id = text.slice(visibility ? 1 : 0, classifier ? length - 1 : length);
	id = id.startsWith(" ") ? ` ${id.trim()}` : id.trim();
	return {
		method: false,
		item: decorate({ text: `${visibility}${parseGenericTypes(id)}`.trim() }, classifier)
	};
}
function configKey(object, key) {
	if (!object || typeof object !== "object" || Array.isArray(object)) return void 0;
	const wanted = key.toLowerCase();
	for (const [name, value] of Object.entries(object)) if (name.toLowerCase() === wanted) return value;
}
function configFlag(config, key, fallback) {
	const value = configKey(configKey(config, "class"), key);
	if (typeof value === "boolean") return value;
	if (typeof value === "string") {
		const text = value.trim().toLowerCase();
		if (text === "true") return true;
		if (text === "false") return false;
	}
	return fallback;
}
/**
* `parseClass(statements, info)` follows the registry contract: `statements` are the prepared body as
* `{ text, line }` pairs (a raw string body is accepted too) and `info` carries the language, the first body
* line, the header options and — once the shared config module lands — `info.config`.
* Returns `{ errors, warnings, model }`; warnings carry `severity: 'warning'` and never block rendering.
*/
function parseClass(statements, info = {}) {
	const lang = info.lang || "zh";
	const firstLine = info.firstLine || 2;
	const errors = [], warnings = [];
	for (const key of Object.keys(info.options || {})) errors.push(issue(lang, firstLine - 1, `类图不接受选项「${key}」`, `Class diagrams take no option: ${key}`, "把方向写成正文的 direction TB|BT|RL|LR", "Write the direction as a body statement: direction TB|BT|RL|LR"));
	const hierarchical = configFlag(info.config, "hierarchicalNamespaces", true);
	const hideEmptyMembersBox = configFlag(info.config, "hideEmptyMembersBox", false);
	const cards = [], byId = /* @__PURE__ */ new Map(), namespaces = /* @__PURE__ */ new Map(), edges = [], pendingNotes = [];
	const look = presentation({
		lang,
		classKeyword: "cssClass"
	});
	const stack = [];
	let direction = "TB", open = null, accessibilityBlock = false, interfaceCount = 0, noteCount = 0;
	const create = (id, line) => {
		const card = {
			id,
			label: id,
			generic: "",
			annotations: [],
			members: [],
			methods: [],
			parent: null,
			declared: false,
			note: false,
			hidden: false,
			interface: false,
			line
		};
		byId.set(id, card);
		cards.push(card);
		return card;
	};
	const reference = (name, line) => {
		const card = byId.get(name.id) || create(name.id, line);
		if (name.generic && !card.generic) card.generic = name.generic;
		return card;
	};
	const declare = (name, line) => {
		const card = reference(name, line);
		card.declared = true;
		if (card.interface) {
			card.interface = false;
			card.hidden = false;
		}
		if (stack.length) card.parent = stack.at(-1);
		return card;
	};
	const addMember = (card, text) => {
		const member = String(text).trim();
		if (!member || !card) return;
		if (member.startsWith("<<") && member.endsWith(">>")) {
			card.annotations.push({ text: member.slice(2, -2).trim() });
			return;
		}
		const parsed = parseMember(member);
		(parsed.method ? card.methods : card.members).push(parsed.item);
	};
	const addNamespace = (name, label, line) => {
		const qualified = stack.length ? `${stack.at(-1)}.${name}` : name;
		stack.push(qualified);
		const existing = namespaces.get(qualified);
		if (existing) {
			existing.explicit = true;
			if (label) existing.label = label;
			return;
		}
		const parts = qualified.split(".");
		for (let i = 1; i <= parts.length; i += 1) {
			const id = parts.slice(0, i).join(".");
			const leaf = i === parts.length;
			const parent = i > 1 ? parts.slice(0, i - 1).join(".") : null;
			const known = namespaces.get(id);
			if (!known) namespaces.set(id, {
				id,
				label: leaf && label ? label : parts[i - 1],
				parent,
				depth: i - 1,
				explicit: leaf,
				line
			});
			else if (leaf) {
				known.explicit = true;
				if (label) known.label = label;
			}
		}
	};
	const explicitAncestor = (id) => {
		let current = id;
		while (current) {
			const namespace = namespaces.get(current);
			if (!namespace) return null;
			if (namespace.explicit) return current;
			current = namespace.parent;
		}
		return null;
	};
	const addNote = (text, target, line) => {
		while (byId.has(`note${noteCount}`)) noteCount += 1;
		const card = create(`note${noteCount}`, line);
		noteCount += 1;
		Object.assign(card, {
			note: true,
			label: text,
			parent: stack.at(-1) || null
		});
		if (target) pendingNotes.push({
			card,
			target,
			line
		});
		return card;
	};
	const interfaceCard = (name, line) => {
		if (!byId.get(name)) {
			const card = create(name, line);
			Object.assign(card, {
				interface: true,
				hidden: true,
				parent: stack.at(-1) || null
			});
			return card;
		}
		while (byId.has(`interface${interfaceCount}`)) interfaceCount += 1;
		const card = create(`interface${interfaceCount}`, line);
		interfaceCount += 1;
		Object.assign(card, {
			interface: true,
			hidden: true,
			label: name,
			parent: stack.at(-1) || null
		});
		return card;
	};
	for (const row of statementsOf(statements, firstLine)) {
		const line = row.line;
		const text = stripComment(row.text).trim();
		if (!text) continue;
		if (accessibilityBlock) {
			if (text.includes("}")) accessibilityBlock = false;
			continue;
		}
		if (/^accDescr\s*\{/iu.test(text)) {
			accessibilityBlock = !text.slice(text.indexOf("{") + 1).includes("}");
			continue;
		}
		if (open) {
			const card = open;
			let body = text;
			if (text.endsWith("}")) {
				body = text.slice(0, -1);
				open = null;
			}
			if (body.includes("{")) {
				errors.push(issue(lang, line, "类成员里不能再写 {", "A class body has no nested {", "把成员写在 class 块内的独立行上", "Write members on their own lines inside the class block"));
				continue;
			}
			addMember(card, body);
			continue;
		}
		const heading = DIRECTION.exec(text);
		if (heading) {
			direction = heading[1].toUpperCase();
			continue;
		}
		if (text === "}") {
			if (stack.length) stack.pop();
			else errors.push(issue(lang, line, "多余的 }", "Unmatched }", "删掉这一行，或补上它对应的 namespace", "Remove this line, or add the namespace it closes"));
			continue;
		}
		const namespace = NAMESPACE_DECL.exec(text);
		if (namespace) {
			let rest = namespace[1].trim();
			const token = takeName(rest);
			if (!token) {
				errors.push(issue(lang, line, "namespace 后需要命名空间名称", "A namespace needs a name", "写成 namespace 名称 {", "Write namespace name {"));
				continue;
			}
			const name = nameParts(token.raw).id;
			rest = rest.slice(token.next).trim();
			const label = LABEL_SUFFIX.exec(rest);
			let display = null;
			if (label) {
				display = label[1];
				rest = rest.slice(label[0].length).trim();
			}
			if (rest !== "{") {
				errors.push(issue(lang, line, "命名空间后需要 {，块内容从下一行开始", "A namespace opens with { and its body starts on the next line", "写成 namespace 名称 { 再逐行写 class", "Write namespace name { and put each class on its own line"));
				continue;
			}
			addNamespace(name, display, line);
			continue;
		}
		const declaration = CLASS_DECL.exec(text);
		if (declaration) {
			let rest = declaration[1].trim();
			const token = takeName(rest);
			if (!token) {
				errors.push(issue(lang, line, "class 后需要类名", "A class needs a name", "写成 class 类名、class 类名[\"标签\"] 或 class 类名 {", "Write class Name, class Name[\"label\"] or class Name {"));
				continue;
			}
			const card = declare(nameParts(token.raw), line);
			rest = rest.slice(token.next).trim();
			const quoted = LABEL_SUFFIX.exec(rest);
			if (quoted) {
				card.label = quoted[1];
				rest = rest.slice(quoted[0].length).trim();
			} else {
				const legacy = /^as\s+([\s\S]+)$/iu.exec(rest);
				if (legacy) {
					card.label = unquote(legacy[1]);
					rest = "";
				}
			}
			let body = null, bad = null;
			for (;;) {
				rest = rest.trim();
				if (!rest) break;
				const annotation = ANNOTATION_HEAD.exec(rest);
				if (annotation) {
					card.annotations.push({ text: annotation[1].trim() });
					rest = rest.slice(annotation[0].length).trim();
					continue;
				}
				const style = STYLE_SUFFIX.exec(rest);
				if (style) {
					look.addClasses(card.id, style[1].split(/\s*,\s*/u), line);
					rest = rest.slice(style[0].length).trim();
					continue;
				}
				if (rest.startsWith("{")) {
					body = rest.slice(1);
					break;
				}
				bad = rest;
				break;
			}
			if (bad !== null) {
				errors.push(unknownStatement(lang, line, text));
				continue;
			}
			if (body === null) continue;
			const inner = body.trim();
			if (inner.endsWith("}")) {
				const member = inner.slice(0, -1);
				if (member.trim()) addMember(card, member);
			} else {
				if (inner) addMember(card, inner);
				open = card;
			}
			continue;
		}
		const annotationLine = ANNOTATION_LINE.exec(text);
		if (annotationLine) {
			declare(nameParts(annotationLine[2]), line).annotations.push({ text: annotationLine[1].trim() });
			continue;
		}
		const noteFor = NOTE_FOR.exec(text);
		if (noteFor) {
			addNote(noteFor[2], nameParts(noteFor[1]).id, line);
			continue;
		}
		const note = NOTE.exec(text);
		if (note) {
			addNote(note[1], null, line);
			continue;
		}
		if (/^note\b/iu.test(text)) {
			errors.push(issue(lang, line, "note 的文本需要写在双引号里", "A note needs its text in double quotes", "写成 note \"文本\" 或 note for 类名 \"文本\"", "Write note \"text\" or note for Name \"text\""));
			continue;
		}
		if (look.accept(text, line)) continue;
		const iconAt = text.indexOf("::icon");
		const iconSuffix = iconAt > 0 ? ICON_SUFFIX.exec(text.slice(iconAt)) : null;
		if (iconSuffix && iconAt + iconSuffix[0].length === text.length && BARE_NAME.test(text.slice(0, iconAt).trimEnd())) {
			declare(nameParts(text.slice(0, iconAt).trimEnd()), line).iconRef = iconSuffix[1];
			continue;
		}
		if (ACCESSIBILITY.test(text)) continue;
		const arrowAt = indexOutside(text, "arrow"), colonAt = indexOutside(text, ":");
		if (arrowAt >= 0 && (colonAt < 0 || arrowAt < colonAt)) {
			const relation = RELATION.exec(text);
			const arrow = relation ? ARROW.exec(relation[3]) : null;
			if (!arrow) {
				errors.push(unknownStatement(lang, line, text));
				continue;
			}
			const leftToken = arrow[1] ? String(arrow[1]).replace(/\s+/gu, "") : "";
			const rightToken = arrow[3] ? String(arrow[3]).replace(/\s+/gu, "") : "";
			const start = leftToken ? arrowMarkers[leftToken] : void 0;
			const end = rightToken ? arrowMarkers[rightToken] : void 0;
			if (leftToken && !start || rightToken && !end) {
				errors.push(unknownStatement(lang, line, text));
				continue;
			}
			const from = nameParts(relation[1]), to = nameParts(relation[5]);
			const fromCard = start === "circle" && !end ? interfaceCard(from.id, line) : reference(from, line);
			const toCard = end === "circle" && !start ? interfaceCard(to.id, line) : reference(to, line);
			edges.push({
				from: fromCard.id,
				to: toCard.id,
				label: relation[6] ? relation[6].trim() : "",
				...arrow[2] === ".." ? { dashed: true } : { dashed: false },
				...start ? { start } : {},
				...end ? { end } : {},
				...relation[2] ? { c1: relation[2].trim() } : {},
				...relation[4] ? { c2: relation[4].trim() } : {},
				line
			});
			continue;
		}
		const classOnly = CLASS_ONLY.exec(text);
		if (classOnly) {
			look.addClasses(declare(nameParts(classOnly[1]), line).id, classOnly[2].split(/\s*,\s*/u), line);
			continue;
		}
		const colonMember = COLON_MEMBER.exec(text);
		if (colonMember) {
			addMember(reference(nameParts(colonMember[1]), line), colonMember[2]);
			continue;
		}
		const bare = BARE_NAME.exec(text);
		if (bare) {
			declare(nameParts(bare[1]), line);
			continue;
		}
		errors.push(unknownStatement(lang, line, text));
	}
	if (open) errors.push(issue(lang, open.line, "class 块缺少结束的 }", "A class block is missing its closing }", "在块末尾补上 }", "Add } at the end of the block"));
	if (stack.length) errors.push(issue(lang, namespaces.get(stack.at(-1))?.line ?? firstLine, "namespace 块缺少结束的 }", "A namespace block is missing its closing }", "在块末尾补上 }", "Add } at the end of the block"));
	for (const entry of pendingNotes) {
		const target = byId.get(entry.target);
		if (!target) {
			warnings.push(warning("DIAGRAM_HINT", lang, entry.line, `note for 指向的「${entry.target}」不是任何类，这张注释没有连线`, `"${entry.target}" is not a class, so this note stays unconnected`, "把 note for 后面的类名改成图中的类", "Point note for at a class in the diagram"));
			continue;
		}
		edges.push({
			from: entry.card.id,
			to: target.id,
			label: "",
			dashed: true,
			line: entry.line
		});
	}
	edges.sort((a, b) => a.line - b.line);
	if (cards.length > limits.large) warnings.push(warning("LARGE_DIAGRAM", lang, cards[0]?.line ?? firstLine, `${cards.length} 个类或注释，图会很大，建议拆分`, `${cards.length} classes and notes; consider splitting this diagram`, "按命名空间拆成多张图，并用文字说明它们的对应关系", "Split by namespace and describe the mapping in prose"));
	if (cards.length > limits.cards) errors.push(issue(lang, cards[limits.cards].line, `类与注释最多 ${limits.cards} 个`, `At most ${limits.cards} classes and notes`, "拆成多张图", "Split into several diagrams"));
	if (edges.length > limits.edges) errors.push(issue(lang, edges[limits.edges].line, `关系最多 ${limits.edges} 条`, `At most ${limits.edges} relations`, "删掉次要关系，或拆成多张图", "Remove secondary relations, or split into several diagrams"));
	const sectionsOf = (card) => {
		if (card.note || card.hidden) return [];
		if (hideEmptyMembersBox && !card.members.length && !card.methods.length) return [];
		return [card.members, card.methods];
	};
	const titleOf = (card) => {
		const generic = card.generic ? parseGenericTypes(card.generic) : "";
		return generic ? `${card.label}&lt;${generic}&gt;` : card.label;
	};
	const frames = [];
	for (const namespace of namespaces.values()) {
		if (!hierarchical && !namespace.explicit) continue;
		frames.push({
			id: namespace.id,
			label: hierarchical ? namespace.label : namespace.id,
			parent: hierarchical ? namespace.parent : null,
			depth: hierarchical ? namespace.depth : 0,
			line: namespace.line
		});
	}
	const model = {
		kind: "classDiagram",
		direction,
		cards: cards.map((card) => {
			const parent = card.parent ? hierarchical ? card.parent : explicitAncestor(card.parent) : null;
			return {
				id: card.id,
				title: card.note ? card.label : titleOf(card),
				...card.annotations.length ? { annotations: card.annotations.map((entry) => ({ text: entry.text })) } : {},
				sections: sectionsOf(card),
				...parent ? { parent } : {},
				...card.note ? { note: true } : {},
				...card.hidden ? { hidden: true } : {},
				...card.iconRef ? { iconRef: card.iconRef } : {},
				line: card.line
			};
		}),
		frames,
		edges
	};
	errors.push(...finishCards(model, look, lang));
	return {
		errors: [...errors, ...warnings],
		warnings: [...warnings, ...errors.filter((item) => item.severity === "warning")],
		model
	};
}
function finishCards(model, look, lang) {
	const issues = /* @__PURE__ */ new Map();
	const remember = (issue) => {
		if ((issues.get(issue.message)?.line ?? Infinity) > issue.line) issues.set(issue.message, issue);
	};
	const normalize = (item, key, owner = item) => {
		if (item[key] == null) return;
		const { text, icon, diagnostics } = normalizeLabel(item[key], {
			lang,
			line: owner.line
		});
		item[key] = text;
		if (icon) owner.icon ??= icon;
		diagnostics.forEach(remember);
	};
	for (const card of model.cards) {
		const tone = look.statusOf(card.id), link = look.linkOf(card.id);
		if (tone) card.tone = tone;
		if (link) card.link = link;
		if (card.iconRef) {
			const ref = card.iconRef;
			const icon = resolveIconRef(ref);
			if (icon) card.icon = icon;
			else remember(warning("IGNORED_ASSET", lang, card.line, `未知图标 ${ref}`, `Unknown icon ${ref}`, "使用内置图标", "Use a built-in icon"));
			delete card.iconRef;
		}
		normalize(card, "title");
		for (const row of [...card.annotations || [], ...card.sections.flat()]) normalize(row, "text", card);
	}
	for (const frame of model.frames || []) normalize(frame, "label");
	for (const [index, edge] of model.edges.entries()) {
		const tone = look.edgeStatusOf(index);
		if (tone) edge.tone = tone;
		for (const key of [
			"label",
			"c1",
			"c2"
		]) normalize(edge, key);
	}
	return [...look.diagnostics(), ...issues.values()];
}
var overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
var iconSlot = "￼";
var withIconSlot = (text, icon) => icon ? `${iconSlot} ${text}` : text;
var markerId = (name, tone) => `uml-${name}${tone ? `-${tone}` : ""}`;
function drawIcon(ctx, icon, x, y, ink) {
	const [left, top, w, h] = icon.viewBox.split(/\s+/).map(Number);
	const scale = 14 / Math.max(w, h);
	return ctx.el("g", { transform: `translate(${x - (left + w / 2) * scale} ${y - (top + h / 2) * scale}) scale(${scale})` }, icon.elements.map(({ tag, attrs }) => ctx.shape(tag, {
		...attrs,
		...icon.set === "simple" ? { fill: ink } : {
			fill: "none",
			stroke: ink,
			"stroke-width": 1.6,
			"stroke-linecap": "round",
			"stroke-linejoin": "round"
		}
	})));
}
function cardMarkers(ctx, a, edges) {
	const surface = a.surface;
	const shapes = {
		triangle: ["M2 2 L13 7 L2 12 Z", surface],
		hollowDiamond: ["M1 7 L7 2 L13 7 L7 12 Z", surface],
		filledDiamond: ["M1 7 L7 2 L13 7 L7 12 Z", null],
		arrow: ["M4 3 L13 7 L4 11", "none"],
		cross: ["M5 3 L13 11 M5 11 L13 3", "none"]
	};
	const used = new Map(edges.flatMap((edge) => [edge.start, edge.end].filter(Boolean).map((name) => [markerId(name, edge.tone), {
		name,
		ink: a[edge.tone] || a.fg4
	}])));
	return ctx.el("defs", {}, [...used].map(([id, { name, ink }]) => {
		const attrs = {
			stroke: ink,
			"stroke-width": 1.25
		};
		const children = name === "contains" ? [ctx.circle(8, 7, 4, {
			...attrs,
			fill: surface
		}), ctx.path("M4 7 H12 M8 3 V11", {
			...attrs,
			fill: "none"
		})] : name === "circle" ? [ctx.circle(7, 7, 5, {
			...attrs,
			fill: surface
		})] : [ctx.path(shapes[name][0], {
			...attrs,
			fill: shapes[name][1] ?? ink
		})];
		return ctx.el("marker", {
			id,
			viewBox: "0 0 14 14",
			refX: name === "circle" ? 7 : 13,
			refY: 7,
			markerWidth: 14,
			markerHeight: 14,
			markerUnits: "userSpaceOnUse",
			orient: "auto-start-reverse"
		}, children);
	}));
}
function wrapAtSeparators(text, limit, measure, boundary) {
	return text.split("\n").flatMap((paragraph) => {
		const parts = paragraph.split(boundary);
		const lines = [];
		let row = parts.shift();
		for (const part of parts) if (row && measure(row + part) > limit) {
			lines.push(row.trimEnd());
			row = part.trimStart();
		} else row += part;
		return [...lines, row];
	});
}
function clearFrameBorders(graph) {
	const clearance = 8;
	const parentOf = new Map([...graph.nodes, ...graph.frames].map((item) => [item.id, item.parent]));
	const contains = (frame, id) => {
		for (let parent = parentOf.get(id); parent; parent = parentOf.get(parent)) if (parent === frame.id) return true;
		return false;
	};
	for (const frame of graph.frames) {
		const original = { ...frame };
		for (const edge of graph.edges.filter((edge) => contains(frame, edge.from) || contains(frame, edge.to))) for (const { p0, p1, c1, c2 } of edge.segments) for (const [axis, cross, size, span] of [[
			"x",
			"y",
			"w",
			"h"
		], [
			"y",
			"x",
			"h",
			"w"
		]]) {
			const track = p0[axis];
			if (![
				p1,
				c1,
				c2
			].every((p) => Math.abs(p[axis] - track) < .1)) continue;
			if (Math.min(Math.max(p0[cross], p1[cross]), original[cross] + original[span]) - Math.max(Math.min(p0[cross], p1[cross]), original[cross]) < 16) continue;
			const low = original[axis], high = low + original[size];
			if (Math.abs(track - low) < clearance) {
				const extra = Math.max(0, frame[axis] - track + clearance);
				frame[axis] -= extra;
				frame[size] += extra;
			}
			if (Math.abs(track - high) < clearance) frame[size] = Math.max(frame[size], track + clearance - frame[axis]);
		}
	}
}
function layoutCards(model, { ctx, width, lang, measure = (s, f) => ctx.measure(s, f.size, f.weight) }) {
	const { cards, frames = [], edges, direction } = model;
	const requirements = model.type === "requirementDiagram";
	const a = appearance(ctx);
	const cardById = new Map(cards.map((card) => [card.id, card]));
	const rowsById = /* @__PURE__ */ new Map();
	const frameById = new Map(frames.map((frame) => [frame.id, frame]));
	const titleSlots = /* @__PURE__ */ new Map();
	const frameHead = new Map(frames.map((frame, frameIndex) => {
		const title = withIconSlot(frame.label, frame.icon);
		const titleMeasure = (s) => s.startsWith(iconSlot) ? 18 + ctx.measure(s.slice(1), 13, 600) : ctx.measure(s, 13, 600);
		const lines = wrapAtSeparators(title, 332, titleMeasure, /(?<=\.)/u);
		const slots = lines.map((line, i) => {
			if (!line) return "";
			const token = `\ue000${frameIndex}.${i}\ue001`;
			titleSlots.set(token, Math.min(199, titleMeasure(line)));
			return token;
		});
		return [frame.id, {
			lines,
			slots,
			w: Math.max(...lines.map(titleMeasure))
		}];
	}));
	const frameMin = /* @__PURE__ */ new Map();
	if (direction === "TB" || direction === "BT") {
		const sized = /* @__PURE__ */ new Set();
		for (const card of cards) if (!card.hidden) for (let id = card.parent; id && !sized.has(id); id = frameById.get(id)?.parent) {
			sized.add(id);
			const { w } = frameHead.get(id);
			if (w > 199) frameMin.set(card.id, Math.max(frameMin.get(card.id) || 0, w + 2));
		}
	}
	const sectionGap = (rows, i, sections) => !requirements && rows.length && i < sections.length - 1 ? 5 : 0;
	const nodes = cards.map((card, seq) => {
		const wrap = (rows, members = false) => rows.flatMap((row) => (members ? wrapAtSeparators(row.text, 328, (s) => measure(s, FONT.label), /(?<=,)|(?<=[^\s:])(?=\s*:(?!:))/u) : ctx.wrap(row.text, 172, FONT.label.size, FONT.label.weight)).map((text) => ({
			...row,
			text
		})));
		const [first, ...rest] = card.sections;
		const typeBand = first?.[0]?.role === "stereotype";
		const annotations = wrap(typeBand ? first : (card.annotations || []).map((row) => ({
			...row,
			text: `«${row.text}»`
		})));
		const sections = (typeBand ? rest : card.sections).map((rows) => wrap(rows, !requirements));
		const label = card.title || "\xA0";
		const lines = ctx.wrap(label, 200, FONT.title.size, FONT.title.weight);
		rowsById.set(card.id, {
			annotations,
			sections,
			lines
		});
		const detail = [...annotations, ...sections.flat()];
		const w = Math.max(64, frameMin.get(card.id) || 0, 28 + Math.max(0, ...lines.map((s) => measure(s, FONT.title)), ...detail.map((row) => measure(row.text, FONT.body))));
		const rowCount = annotations.length + Number(Boolean(card.icon)) + sections.reduce((sum, rows) => sum + Math.max(1, rows.length), 0);
		const h = Math.max(40, 20 + lines.length * 19 + (rowCount ? 5 + rowCount * 17 : 0) + sections.reduce((sum, rows, i) => sum + sectionGap(rows, i, sections), 0));
		return {
			id: card.id,
			seq,
			label,
			parent: card.parent,
			...card.hidden ? { kind: "start" } : { block: {
				w,
				h
			} }
		};
	});
	const graph = layoutGraph({
		type: "flowchart",
		direction,
		nodes,
		subgraphs: frames.map((frame, seq) => ({
			...frame,
			seq,
			title: frameHead.get(frame.id).slots.join("\n")
		})),
		edges: edges.map((edge, seq) => ({
			...edge,
			seq,
			label: withIconSlot(edge.label, edge.icon),
			style: edge.dashed ? "dashed" : "solid",
			startArrow: Boolean(edge.start),
			endArrow: Boolean(edge.end)
		}))
	}, {
		lang,
		measure: (s, font) => titleSlots.get(s) ?? (s.startsWith(iconSlot) ? 18 + measure(s.slice(1), font) : measure(s, font))
	});
	for (const frame of graph.frames) {
		const head = frameHead.get(frame.id), rect = frame.titleRect;
		if (!head || !rect) continue;
		frame.lines = head.lines;
		rect.w = head.w;
		frame.w = Math.max(frame.w, rect.x - frame.x + rect.w + 14);
	}
	clearFrameBorders(graph);
	for (const frame of graph.frames) {
		graph.width = Math.max(graph.width, frame.x + frame.w + 8);
		graph.height = Math.max(graph.height, frame.y + frame.h + 8);
	}
	const text = (x, y, value, opts = {}) => ctx.text(x, y, value, {
		"dominant-baseline": "central",
		fill: a.fg3,
		...opts
	});
	const outlines = [], titles = [], paths = [], boxes = [], labels = [];
	const obstacles = [
		...graph.nodes,
		...graph.frames.map((frame) => frame.titleRect).filter(Boolean),
		...graph.edges.map((edge) => edge.labelRect).filter(Boolean)
	];
	const routeBounds = graph.edges.flatMap((edge) => edge.segments.map(({ p0, c1, c2, p1 }) => {
		const xs = [
			p0.x,
			c1.x,
			c2.x,
			p1.x
		], ys = [
			p0.y,
			c1.y,
			c2.y,
			p1.y
		];
		const x = Math.min(...xs), y = Math.min(...ys);
		return {
			x: x - 1,
			y: y - 1,
			w: Math.max(...xs) - x + 2,
			h: Math.max(...ys) - y + 2
		};
	}));
	const free = (box) => !obstacles.some((other) => overlaps(box, other)) && !routeBounds.some((other) => overlaps(box, other));
	for (const f of graph.frames) {
		outlines.push(ctx.rect(f.x, f.y, f.w, f.h, {
			rx: 7,
			fill: a.surface,
			stroke: a.line2,
			meta: {
				kind: "frame",
				id: f.id
			}
		}));
		if (!f.titleRect) continue;
		const r = f.titleRect;
		titles.push(ctx.rect(r.x - 3, r.y, r.w + 6, r.h, {
			rx: 3,
			fill: a.surface
		}));
		f.lines.forEach((line, i) => {
			const y = r.y + (i + .5) * 17, icon = frameById.get(f.id)?.icon;
			if (icon && line.startsWith(iconSlot)) {
				titles.push(drawIcon(ctx, icon, r.x + 7, y, a.fg3));
				titles.push(text(r.x + 18, y, line.slice(1).trimStart(), {
					size: 13,
					weight: 600
				}));
			} else titles.push(text(r.x, y, line, {
				size: 13,
				weight: 600
			}));
		});
	}
	for (const route of graph.edges) {
		if (!route.segments?.length) continue;
		const edge = edges[route.id];
		paths.push(ctx.path(cubicPath(route.segments), {
			fill: "none",
			stroke: a[edge.tone] || a.fg4,
			"stroke-width": 1.25,
			"stroke-dasharray": edge.dashed ? "5 4" : null,
			"marker-start": edge.start ? `url(#${markerId(edge.start, edge.tone)})` : null,
			"marker-end": edge.end ? `url(#${markerId(edge.end, edge.tone)})` : null,
			meta: {
				kind: "edge",
				from: edge.from,
				to: edge.to
			}
		}));
		const r = route.labelRect;
		if (r && route.labelLines.length) {
			const children = [ctx.rect(r.x, r.y, r.w, r.h, {
				rx: 4,
				fill: a.surface,
				stroke: a.line1,
				"stroke-width": .6
			})];
			route.labelLines.forEach((line, i) => {
				const x = r.x + r.w / 2, y = r.y + r.h / 2 + (i - (route.labelLines.length - 1) / 2) * 16;
				if (edge.icon && line.startsWith(iconSlot)) {
					const caption = line.slice(1).trimStart();
					const left = x - (ctx.measure(caption, 12, 400) + 18) / 2;
					children.push(drawIcon(ctx, edge.icon, left + 7, y, a.fg3));
					if (caption) children.push(text(left + 18, y, caption, { size: 12 }));
				} else children.push(text(x, y, line, {
					size: 12,
					anchor: "middle"
				}));
			});
			labels.push({
				...ctx.el("g", {}, children),
				meta: {
					kind: "edge-label-group",
					from: edge.from,
					to: edge.to
				}
			});
		}
		for (const [value, start] of [[edge.c1, true], [edge.c2, false]]) {
			if (!value) continue;
			const segment = start ? route.segments[0] : route.segments.at(-1);
			const p = start ? segment.p0 : segment.p1;
			const q = start ? segment.c1 || segment.p1 : segment.c2 || segment.p0;
			const vertical = Math.abs(q.y - p.y) >= Math.abs(q.x - p.x);
			const sign = Math.sign(vertical ? q.y - p.y : q.x - p.x) || 1;
			const w = ctx.measure(value, 12, 400);
			let box;
			for (const distance of [
				10,
				18,
				26,
				36,
				48
			]) {
				for (const side of start ? [-1, 1] : [1, -1]) {
					const candidate = vertical ? {
						x: p.x + (side < 0 ? -8 - w : 8),
						y: p.y + sign * distance - 7,
						w,
						h: 14
					} : {
						x: p.x + (sign < 0 ? -distance - w : distance),
						y: p.y + side * 12 - 7,
						w,
						h: 14
					};
					box = candidate;
					if (free(candidate)) break;
				}
				if (free(box)) break;
			}
			obstacles.push(box);
			labels.push(text(box.x, box.y + 7, value, {
				size: 12,
				meta: {
					kind: "cardinality",
					endpoint: start ? "start" : "end"
				}
			}));
		}
	}
	for (const n of graph.nodes) {
		const card = cardById.get(n.id);
		if (card.hidden) continue;
		const { x, y, w, h } = n;
		const { annotations, sections, lines } = rowsById.get(n.id);
		const stroke = card.tone ? a[card.tone] : a.line2;
		const fill = card.tone && card.tone !== "ext" ? ctx.mix(a.node, stroke, a.soft) : a.node;
		const anchor = requirements || card.note ? "start" : "middle";
		const tx = anchor === "start" ? x + 14 : x + w / 2;
		const header = 20 + (annotations.length + Number(Boolean(card.icon))) * 17 + lines.length * 19;
		const items = [];
		items.push(ctx.rect(x, y, w, h, {
			rx: 7,
			fill,
			stroke,
			"stroke-width": 1.25,
			"stroke-dasharray": card.tone === "ext" ? "4 3" : void 0,
			meta: {
				kind: "node",
				id: card.id,
				...card.tone ? { status: card.tone } : {}
			}
		}));
		if (sections.length) items.push(ctx.rect(x + 1, y + 1, w - 2, header - 1, {
			rx: 6,
			fill: card.tone && card.tone !== "ext" ? ctx.mix(a.node, stroke, Math.max(.2, a.soft)) : a.line1,
			"fill-opacity": card.tone && card.tone !== "ext" ? 1 : .3
		}));
		let cursor = y + 10;
		if (card.icon) {
			items.push(drawIcon(ctx, card.icon, tx + (anchor === "start" ? 7 : 0), cursor + 8.5, stroke));
			cursor += 17;
		}
		const drawRow = (row, px, baseline, opts) => items.push(text(px, baseline, row.text, {
			size: FONT.label.size,
			"font-style": row.fontStyle,
			"text-decoration": row.decoration,
			...opts
		}));
		for (const row of annotations) {
			drawRow(row, tx, cursor + 8.5, { anchor });
			cursor += 17;
		}
		for (const line of lines) {
			items.push(text(tx, cursor + 9.5, line, {
				...FONT.title,
				...card.note ? { weight: 400 } : {},
				anchor,
				fill: a.fg1
			}));
			cursor += 19;
		}
		cursor += 10;
		for (const [i, rows] of sections.entries()) {
			items.push(ctx.line(x + (i ? 9 : 0), cursor, x + w - (i ? 9 : 0), cursor, {
				stroke: a.line2,
				"stroke-width": .7
			}));
			for (const [j, row] of rows.entries()) drawRow(row, x + 14, cursor + 11 + j * 17, {});
			cursor += Math.max(1, rows.length) * 17 + sectionGap(rows, i, sections);
		}
		if (card.link) boxes.push(ctx.link(card.link.href, items, card.link));
		else boxes.push(...items);
	}
	for (const route of graph.edges) for (const [id, marker, p, q] of [[
		route.from,
		edges[route.id].start,
		route.start,
		route.end
	], [
		route.to,
		edges[route.id].end,
		route.end,
		route.start
	]]) {
		const card = cardById.get(id);
		if (marker !== "circle" || !card?.hidden || !p || !q) continue;
		const horizontal = direction === "LR" || direction === "RL";
		const sign = (horizontal ? p.x - q.x : p.y - q.y) >= 0 ? 1 : -1;
		labels.push(text(p.x + (horizontal ? sign * 11 : 0), p.y + (horizontal ? 0 : sign * 14), card.title, {
			size: 12,
			anchor: horizontal ? sign > 0 ? "start" : "end" : "middle"
		}));
	}
	const errors = graph.width > 2 * width && cards.length <= limits.large ? [warning("LARGE_DIAGRAM", lang, 1, "图较宽，将横向滚动", "This diagram is wide and will scroll horizontally", "考虑拆分成多张图", "Consider splitting it into several diagrams")] : [];
	const scene = {
		width: graph.width,
		height: graph.height,
		title: model.title || model.kind || model.type,
		heading: model.title,
		children: [
			cardMarkers(ctx, a, edges),
			...outlines,
			...paths,
			...boxes,
			...labels,
			...titles
		]
	};
	return {
		width: graph.width,
		height: graph.height,
		geometry: graph,
		scene,
		errors
	};
}
var implementation = {
	parse: parseClass,
	layout: layoutCards,
	acceptsPresentation: true,
	honoredConfig: ["class.hideEmptyMembersBox", "class.hierarchicalNamespaces"]
};
var implementations = { classDiagram: implementation };
export { arrowMarkers, class_exports, directions, finishCards, implementation, implementations, kind, kinds, layoutCards, limits, markers, parseClass as parse, parseClass };
