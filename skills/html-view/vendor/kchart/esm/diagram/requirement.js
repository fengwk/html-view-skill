import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { error, warning } from "./support.js";
import { finishCards, layoutCards } from "./class.js";
import { presentation } from "./presentation.js";
// src/diagram/requirement.js
var requirement_exports = /* @__PURE__ */ __exportAll({
	directions: () => directions,
	implementation: () => implementation,
	implementations: () => implementations,
	kind: () => kind,
	kinds: () => kinds,
	limits: () => limits,
	parse: () => parse,
	parseRequirement: () => parse,
	relationships: () => relationships,
	riskLevels: () => riskLevels,
	typeWords: () => typeWords,
	verificationMethods: () => verificationMethods
});
var kind = Object.freeze({
	kind: "requirementDiagram",
	syntax: "mermaid",
	topic: "data-model",
	aliases: Object.freeze(["requirement"])
});
var kinds = Object.freeze([kind]);
var limits = Object.freeze({
	cards: 2e3,
	edges: 5e3,
	large: 60
});
var typeWords = Object.freeze({
	requirement: "Requirement",
	functionalrequirement: "Functional Requirement",
	interfacerequirement: "Interface Requirement",
	performancerequirement: "Performance Requirement",
	physicalrequirement: "Physical Requirement",
	designconstraint: "Design Constraint",
	element: "Element"
});
var riskLevels = Object.freeze({
	low: "Low",
	medium: "Medium",
	high: "High"
});
var verificationMethods = Object.freeze({
	analysis: "Analysis",
	demonstration: "Demonstration",
	inspection: "Inspection",
	test: "Test"
});
var relationships = Object.freeze([
	"contains",
	"copies",
	"derives",
	"satisfies",
	"verifies",
	"refines",
	"traces"
]);
var requirementFields = Object.freeze({
	id: "reqId",
	text: "text",
	risk: "risk",
	verifymethod: "verifyMethod"
});
var elementFields = Object.freeze({
	type: "elementType",
	docref: "docRef"
});
var directions = Object.freeze([
	"TB",
	"BT",
	"RL",
	"LR"
]);
var NAME = "(?:\"[^\"]*\"|[^\\s:,\\r\\n{}<>=-][^:,\\r\\n{}<>=-]*)";
var BLOCK = new RegExp(`^(${Object.keys(typeWords).join("|")})\\s+(${NAME})(?:\\s*:::\\s*([\\w,\\s]*?))?\\s*\\{\\s*$`, "iu");
var FORWARD = new RegExp(`^(${NAME})\\s*-\\s*(${relationships.join("|")})\\s*->\\s*(${NAME})\\s*$`, "iu");
var REVERSE = new RegExp(`^(${NAME})\\s*<-\\s*(${relationships.join("|")})\\s*-\\s*(${NAME})\\s*$`, "iu");
var FIELD = /^([A-Za-z][\w-]*)\s*:\s*([\s\S]*)$/u;
var CLASS_ONLY = new RegExp(`^(${NAME})\\s*:::\\s*([\\w,\\s]+)$`, "u");
var DIRECTION = new RegExp(`\\bdirection\\s+(${directions.join("|")})\\b`, "iu");
var ACCESSIBILITY = /^acc(?:Title|Descr)\b/iu;
var issue = (lang, line, zh, en, fixZh, fixEn, column = 1) => error(lang, line, zh, en, fixZh, fixEn, column);
var unknownStatement = (lang, line, text) => issue(lang, line, `不支持或无效的需求图语句：「${text}」`, `Unsupported or invalid requirement-diagram statement: "${text}"`, "使用 requirement/element 块、字段行或「A - 关系 -> B」", "Use a requirement/element block, a field line, or \"A - relation -> B\"");
var unquote = (value) => {
	const text = String(value ?? "").trim(), quoted = /^"([^"]*)"$/u.exec(text);
	return quoted ? quoted[1] : text;
};
var ENTITY = /^&?#(?:x[\da-f]+|\d+|\w+);/iu;
function stripComment(raw) {
	const css = /^\s*(style|classDef|linkStyle)\s/iu.test(raw);
	let quote = false;
	for (let i = 0; i < raw.length; i += 1) {
		const ch = raw[i];
		if (ch === "\"") {
			quote = !quote;
			continue;
		}
		if (quote) continue;
		if (ch === "%" && raw[i + 1] === "%") return raw.slice(0, i);
		if (ch === "#" && !ENTITY.test(raw.slice(i))) {
			if (css && /^#[\da-f]{3,8}(?=[\s,;]|$)/iu.test(raw.slice(i))) continue;
			return raw.slice(0, i);
		}
	}
	return raw;
}
function parse(source, info = {}) {
	const lang = info.lang || "zh", firstLine = info.firstLine || 2;
	const errors = [], warnings = [];
	for (const key of Object.keys(info.options || {})) errors.push(issue(lang, firstLine - 1, `需求图不接受选项「${key}」`, `Requirement diagrams take no option: ${key}`, "把方向写成正文的 direction TB|BT|RL|LR", "Write the direction as a body statement: direction TB|BT|RL|LR"));
	const cards = [], edges = [], byId = /* @__PURE__ */ new Map();
	const duplicates = [];
	const look = presentation({ lang });
	let direction = "TB", title = "", open = null, accessibilityBlock = false;
	const create = (id, line, declared, type) => {
		const card = {
			id,
			name: id,
			type: declared ? type : "",
			declared,
			classes: [],
			line,
			fields: Object.create(null)
		};
		byId.set(id, card);
		cards.push(card);
		return card;
	};
	const reference = (id, line) => byId.get(id) || create(id, line, false, "");
	const rows = String(source ?? "").replace(/\r\n?/gu, "\n").split("\n");
	for (const [index, raw] of rows.entries()) {
		const line = firstLine + index;
		const text = stripComment(raw).trim();
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
			if (text === "}") {
				open = null;
				continue;
			}
			const field = FIELD.exec(text);
			if (!field) {
				errors.push(unknownStatement(lang, line, text));
				continue;
			}
			const key = field[1].toLowerCase(), value = unquote(field[2]);
			const word = typeWords[open.card.type];
			const allowed = open.card.type === "element" ? elementFields : requirementFields;
			if (!Object.hasOwn(allowed, key)) {
				errors.push(issue(lang, line, `${word} 块不支持字段「${field[1]}」`, `${word} blocks have no field "${field[1]}"`, `只使用 ${Object.keys(allowed).join("、")}`, `Use only ${Object.keys(allowed).join(", ")}`));
				continue;
			}
			if (!value) {
				errors.push(issue(lang, line, `字段「${field[1]}」缺少取值`, `Field "${field[1]}" needs a value`, "在冒号后写上取值，或删掉这一行", "Write a value after the colon, or remove the line"));
				continue;
			}
			if (key === "risk" || key === "verifymethod") {
				const table = key === "risk" ? riskLevels : verificationMethods, normalized = table[value.toLowerCase()];
				if (!normalized) {
					errors.push(issue(lang, line, `「${field[1]}」只接受 ${Object.keys(table).join("/")}，不能是「${value}」`, `"${field[1]}" accepts only ${Object.keys(table).join("/")}, not "${value}"`, `改成 ${Object.keys(table).join("、")} 之一`, `Use one of ${Object.keys(table).join(", ")}`));
					continue;
				}
				open.card.fields[allowed[key]] = normalized;
				continue;
			}
			open.card.fields[allowed[key]] = value;
			continue;
		}
		if (ACCESSIBILITY.test(text)) continue;
		const titleMatch = /^title\s+(.+)$/iu.exec(text);
		if (titleMatch) {
			title ||= titleMatch[1].trim();
			continue;
		}
		const block = BLOCK.exec(text);
		if (block) {
			const type = block[1].toLowerCase(), name = unquote(block[2]);
			const classes = (block[3] || "").split(",").map((entry) => entry.trim()).filter(Boolean);
			if (!name) {
				errors.push(issue(lang, line, "需求或元素名称不能为空", "A requirement or element needs a name", "在关键字后写上名称", "Write a name after the keyword"));
				continue;
			}
			if (classes.length) look.addClasses(name, classes, line);
			const existing = byId.get(name);
			if (existing?.declared) {
				duplicates.push({
					name,
					line
				});
				existing.classes.push(...classes);
				open = { card: existing };
				continue;
			}
			const card = existing || create(name, line, true, type);
			Object.assign(card, {
				type,
				declared: true,
				fields: Object.create(null)
			});
			card.classes.push(...classes);
			open = { card };
			continue;
		}
		const forward = FORWARD.exec(text), reverse = forward ? null : REVERSE.exec(text);
		if (forward || reverse) {
			const verb = (forward ? forward[2] : reverse[2]).toLowerCase();
			const from = unquote(forward ? forward[1] : reverse[3]), to = unquote(forward ? forward[3] : reverse[1]);
			if (!from || !to) {
				errors.push(issue(lang, line, "关系的两端都需要名称", "Both ends of a relation need a name", "在箭头两侧写上需求或元素名称", "Name a requirement or element on both sides of the arrow"));
				continue;
			}
			reference(from, line);
			reference(to, line);
			const contains = verb === "contains";
			edges.push({
				from,
				to,
				verb,
				label: `<<${verb}>>`,
				dashed: !contains,
				line,
				...contains ? { start: "contains" } : { end: "arrow" }
			});
			continue;
		}
		const heading = DIRECTION.exec(text);
		if (heading) {
			direction = heading[1].toUpperCase();
			continue;
		}
		if (look.accept(text, line)) continue;
		const classOnly = CLASS_ONLY.exec(text);
		if (classOnly) {
			look.addClasses(unquote(classOnly[1]), classOnly[2].split(/\s*,\s*/u), line);
			continue;
		}
		errors.push(unknownStatement(lang, line, text));
	}
	if (open) errors.push(issue(lang, open.card.line, "需求或元素块缺少结束的 }", "Requirement or element block is missing its closing }", "在块末尾补上 }", "Add } at the end of the block"));
	if (duplicates.length) warnings.push(warning("DIAGRAM_HINT", lang, duplicates[0].line, `${duplicates.map((entry) => `「${entry.name}」`).join("、")} 重复声明，只画第一张卡，后面的字段覆盖前面的取值`, `${duplicates.map((entry) => `"${entry.name}"`).join(", ")} declared more than once; one card is drawn and later fields win`, "每个需求或元素只声明一次", "Declare each requirement or element once"));
	if (cards.length > limits.large) warnings.push(warning("LARGE_DIAGRAM", lang, cards[0]?.line || firstLine, `${cards.length} 个需求或元素，图会很大，建议拆分`, `${cards.length} requirements and elements; consider splitting this diagram`, "按需求分组拆成多张图，并用文字说明它们的对应关系", "Split by requirement group and describe the mapping in prose"));
	if (cards.length > limits.cards) errors.push(issue(lang, cards[limits.cards].line, `需求与元素最多 ${limits.cards} 个`, `At most ${limits.cards} requirements and elements`, "拆成多张图", "Split into several diagrams"));
	if (edges.length > limits.edges) errors.push(issue(lang, edges[limits.edges].line, `关系最多 ${limits.edges} 条`, `At most ${limits.edges} relations`, "删掉次要关系，或拆成多张图", "Remove secondary relations, or split into several diagrams"));
	const sections = (card) => {
		if (!card.declared) return [];
		const rows = [];
		if (card.type === "element") {
			if (card.fields.elementType) rows.push({ text: `Type: ${card.fields.elementType}` });
			if (card.fields.docRef) rows.push({ text: `Doc Ref: ${card.fields.docRef}` });
		} else {
			if (card.fields.reqId) rows.push({ text: `ID: ${card.fields.reqId}` });
			if (card.fields.text) rows.push({ text: `Text: ${card.fields.text.replace(/(\*\*|\*|__|_)([^*_\n]+)\1/gu, "$2")}` });
			if (card.fields.risk) rows.push({ text: `Risk: ${card.fields.risk}` });
			if (card.fields.verifyMethod) rows.push({ text: `Verification: ${card.fields.verifyMethod}` });
		}
		const stereotype = [{
			text: `<<${typeWords[card.type]}>>`,
			fontStyle: "italic",
			role: "stereotype"
		}];
		return rows.length ? [stereotype, rows] : [stereotype];
	};
	const model = {
		type: "requirementDiagram",
		direction,
		...title ? { title } : {},
		cards: cards.map((card) => ({
			id: card.id,
			title: card.name,
			sections: sections(card),
			...card.declared ? {
				stereotype: typeWords[card.type],
				kind: card.type
			} : {
				implicit: true,
				kind: "reference"
			},
			...card.declared && card.type === "element" ? { tone: "info" } : {},
			...card.classes.length ? { classes: [...new Set(card.classes)] } : {},
			...card.declared ? { fields: { ...card.fields } } : {},
			line: card.line
		})),
		edges
	};
	errors.push(...finishCards(model, look, lang));
	return {
		errors: [...errors, ...warnings],
		warnings: [...warnings, ...errors.filter((item) => item.severity === "warning")],
		model
	};
}
var implementation = {
	parse,
	layout: layoutCards,
	acceptsPresentation: true
};
var implementations = { requirementDiagram: implementation };
export { directions, implementation, implementations, kind, kinds, limits, parse, parse as parseRequirement, relationships, requirement_exports, riskLevels, typeWords, verificationMethods };
