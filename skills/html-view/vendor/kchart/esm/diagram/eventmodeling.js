import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { FONT, appearance, error, maxWidthOf, message, snap, warning, wrapText } from "./support.js";
import { mapConfig, mapIcon, mapLabels } from "./map-label.js";
// src/diagram/eventmodeling.js
var eventmodeling_exports = /* @__PURE__ */ __exportAll({ implementations: () => implementations });
var LIMITS = Object.freeze({
	largeFrames: 60,
	dataLines: 12,
	workFrames: 600,
	chars: 2e5
});
var PAD = 20;
var COLUMN_GAP = 30;
var LANE_PAD = 12;
var LANE_GAP = 12;
var TRACK = 7;
var SLOT = 6;
var BOX_PAD = 10;
var SIDE_INSET = 12;
var MIN_LANE_H = 64;
var MIN_BOX_H = 48;
var MIN_BOX_W = 132;
var MAX_BOX_W = 420;
var NAME_STEP = 18;
var DATA_STEP = 16;
var CAPTION_STEP = 18;
var NAME_FONT = Object.freeze({
	size: 13,
	weight: 600
});
var GLYPH_FONT = Object.freeze({
	size: 12,
	weight: 650
});
var LANE_FONT = Object.freeze({
	size: 12,
	weight: 650
});
var DATA_FONT = FONT.label;
var CAPTION_FONT = FONT.label;
var TYPES = Object.freeze({
	ui: Object.freeze({
		band: 0,
		glyph: "UI",
		role: null,
		lane: "UI/Automation",
		prefix: "UI/A: "
	}),
	processor: Object.freeze({
		band: 0,
		glyph: "P",
		role: "tone4",
		lane: "UI/Automation",
		prefix: "UI/A: "
	}),
	readmodel: Object.freeze({
		band: 100,
		glyph: "R",
		role: "tone3",
		lane: "Command/Read Model",
		prefix: "C/RM: "
	}),
	command: Object.freeze({
		band: 100,
		glyph: "C",
		role: "tone1",
		lane: "Command/Read Model",
		prefix: "C/RM: "
	}),
	event: Object.freeze({
		band: 200,
		glyph: "E",
		role: "tone2",
		lane: "Events",
		prefix: "Stream: "
	})
});
var TYPE_NAMES = Object.freeze({
	ui: ["UI", "UI"],
	processor: ["处理器", "processor"],
	command: ["命令", "command"],
	readmodel: ["读模型", "read model"],
	event: ["事件", "event"]
});
var ENTITY_KEYWORDS = /* @__PURE__ */ new Map([
	["ui", "ui"],
	["pcr", "processor"],
	["processor", "processor"],
	["rmo", "readmodel"],
	["readmodel", "readmodel"],
	["cmd", "command"],
	["command", "command"],
	["evt", "event"],
	["event", "event"]
]);
var FRAME_KEYWORDS = /* @__PURE__ */ new Set([
	"tf",
	"timeframe",
	"rf",
	"resetframe"
]);
var DATA_TYPES = /* @__PURE__ */ new Set([
	"json",
	"jsobj",
	"figma",
	"salt",
	"uri",
	"md",
	"html",
	"text"
]);
var SOURCE_TYPES = Object.freeze({
	ui: Object.freeze(["readmodel"]),
	processor: Object.freeze(["readmodel"]),
	command: Object.freeze(["ui", "processor"]),
	readmodel: Object.freeze(["event"]),
	event: Object.freeze(["command"])
});
var typeName = (type, lang) => message(lang, ...TYPE_NAMES[type] || [type, type]);
var qualifier = (text) => String(text || "").split(".").map((part) => part.trim()).filter(Boolean);
function stripComments(text, state) {
	let out = "";
	for (let i = 0; i < text.length;) {
		if (state.block) {
			const end = text.indexOf("*/", i);
			if (end < 0) return out;
			i = end + 2;
			state.block = false;
			continue;
		}
		if (text.startsWith("/*", i)) {
			state.block = true;
			i += 2;
			continue;
		}
		if (text.startsWith("//", i) || text.startsWith("%%", i)) break;
		const data = /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\{.*\})/.exec(text.slice(i));
		if (data) {
			out += data[0];
			i += data[0].length;
			continue;
		}
		out += text[i];
		i += 1;
	}
	return out;
}
function blockLines(raw) {
	const lines = raw.map((line) => line.replace(/\s+$/, ""));
	while (lines.length && !lines[0].trim()) lines.shift();
	while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
	const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => line.match(/^[ \t]*/)[0].length));
	if (!Number.isFinite(indent) || indent === 0) return lines;
	return lines.map((line) => line.slice(Math.min(indent, line.length - line.trimStart().length)));
}
function readGwt(text) {
	const tokens = text.split(/\s+/).filter(Boolean);
	const sections = {
		given: [],
		when: [],
		then: []
	};
	let current = null;
	for (let i = 0; i < tokens.length; i += 1) {
		const key = tokens[i].toLowerCase();
		if (key === "given" || key === "when" || key === "then") {
			current = key;
			continue;
		}
		const type = ENTITY_KEYWORDS.get(key);
		if (!current || !type || !tokens[i + 1]) return null;
		sections[current].push({
			type,
			id: tokens[i + 1]
		});
		i += 1;
	}
	return current === "then" && sections.given.length && sections.then.length ? sections : null;
}
function parse(source, info = {}) {
	const lang = info.lang || "zh";
	const start = info.firstLine || 2;
	const raw = String(source ?? "").split("\n").map((line) => line.replace(/\r$/, ""));
	const errors = [], hints = [];
	const frames = [], dataBlocks = [], notes = [], gwt = [], entities = [];
	const normalize = mapLabels(lang, (item) => hints.push(item));
	let { text: title, icon: titleIcon } = info.title ? normalize(info.title, info.headerLine) : {};
	const issue = (line, zh, en, fixZh, fixEn) => errors.push(error(lang, line, zh, en, fixZh, fixEn));
	if (String(source ?? "").length > LIMITS.chars) {
		issue(start, `源码超过 ${LIMITS.chars} 个字符`, `Source exceeds ${LIMITS.chars} characters`, "拆成多张事件模型图", "Split the source into several event modeling diagrams");
		return {
			model: null,
			errors
		};
	}
	const comment = { block: false };
	const readBlock = (from) => {
		const body = [];
		for (let index = from; index < raw.length; index += 1) {
			if (/^}\s*$/.test(raw[index])) return {
				body,
				next: index + 1
			};
			body.push(raw[index]);
		}
		return {
			body: null,
			next: raw.length
		};
	};
	for (let i = 0; i < raw.length; i += 1) {
		const line = start + i;
		const text = stripComments(raw[i], comment).trim();
		if (!text) continue;
		const head = (/^([A-Za-z][\w-]*)/.exec(text)?.[1] || "").toLowerCase();
		if (FRAME_KEYWORDS.has(head)) {
			const match = /^(tf|timeframe|rf|resetframe)\s+(\d{1,3})\s+([A-Za-z]+)\s+([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)([\s\S]*)$/.exec(text);
			if (!match) {
				issue(line, "时间框写法无效", "Invalid time frame", "使用「tf 01 evt ItemAdded」或「timeframe 01 event ItemAdded」", "Use \"tf 01 evt ItemAdded\" or \"timeframe 01 event ItemAdded\"");
				continue;
			}
			const type = ENTITY_KEYWORDS.get(match[3].toLowerCase());
			if (!type) {
				issue(line, `不支持的时间框类型「${match[3]}」`, `Unknown time frame type: ${match[3]}`, "使用 ui、pcr/processor、cmd/command、rmo/readmodel、evt/event", "Use ui, pcr/processor, cmd/command, rmo/readmodel, or evt/event");
				continue;
			}
			let rest = match[5];
			const sources = [];
			const take = (pattern) => {
				const found = pattern.exec(rest);
				if (!found) return null;
				rest = rest.slice(found[0].length);
				return found;
			};
			let arrow;
			while (arrow = take(/^\s*->>\s*(\d{1,3})(?![\w])/)) sources.push(arrow[1]);
			const ref = take(/^\s*\[\[\s*([A-Za-z_][\w]*)\s*\]\]/);
			rest = rest.trim();
			let inline = null;
			if (rest) {
				let dataType = null, body = rest;
				const typed = /^`([A-Za-z]+)`\s*([\s\S]*)$/.exec(rest);
				if (typed) {
					dataType = typed[1].toLowerCase();
					body = typed[2].trim();
				}
				if (dataType && !DATA_TYPES.has(dataType)) hints.push(warning("DIAGRAM_HINT", lang, line, `未知的行内数据类型「${dataType}」，按文本显示`, `Unknown inline data type: ${dataType}; shown as text`, "使用 json、text 等受支持的类型", "Use a supported type such as json or text"));
				if (/^\{[\s\S]*\}$/.test(body)) body = body.slice(1, -1).trim();
				else if (/^"[\s\S]*"$/.test(body) || /^'[\s\S]*'$/.test(body)) body = body.slice(1, -1).trim();
				else {
					issue(line, "行内数据写法无效", "Invalid inline data", "用花括号或引号包住数据，例如 { description: string }", "Wrap the data in braces or quotes, for example { description: string }");
					body = "";
				}
				inline = {
					type: dataType,
					body
				};
			}
			const parts = qualifier(match[4]);
			frames.push({
				id: match[2],
				kind: /^r/.test(match[1].toLowerCase()) ? "rf" : "tf",
				type,
				identifier: match[4],
				namespace: parts.length === 2 ? parts[0] : null,
				name: parts.length === 2 ? parts[1] : parts.join("."),
				sources,
				dataRef: ref ? ref[1] : null,
				inline,
				line
			});
			continue;
		}
		if (head === "data" || head === "note") {
			const match = head === "data" ? /^data\s+([A-Za-z_][\w]*)\s*(?:`([A-Za-z]+)`)?\s*\{\s*$/.exec(text) : /^note\s+(\d{1,3})\s*(?:`([A-Za-z]+)`)?\s*\{\s*$/.exec(text);
			if (!match) {
				issue(line, `${head} 写法无效`, `Invalid ${head} block`, head === "data" ? "使用「data 名称 {」开块并在下一行起写内容" : "使用「note 01 {」开块并在下一行起写内容", head === "data" ? "Use \"data Name {\" and put the content on the following lines" : "Use \"note 01 {\" and put the content on the following lines");
				continue;
			}
			const opened = readBlock(i + 1);
			i = opened.next - 1;
			if (!opened.body) {
				issue(line, `${head} 数据块缺少结尾的 }`, `The ${head} block is missing its closing }`, "在数据块末尾补上单独一行的 }", "Add a line containing } at the end of the block");
				continue;
			}
			const dataType = match[2] ? match[2].toLowerCase() : null;
			if (dataType && !DATA_TYPES.has(dataType)) hints.push(warning("DIAGRAM_HINT", lang, line, `未知的数据类型「${dataType}」，按文本显示`, `Unknown data type: ${dataType}; shown as text`, "使用 json、text 等受支持的类型", "Use a supported type such as json or text"));
			if (head === "data") dataBlocks.push({
				id: match[1],
				type: dataType,
				lines: blockLines(opened.body),
				line
			});
			else notes.push({
				id: match[1],
				type: dataType,
				lines: blockLines(opened.body),
				line
			});
			continue;
		}
		if (head === "entity") {
			const match = /^entity\s+([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)\s*$/.exec(text);
			if (!match) issue(line, "entity 写法无效", "Invalid entity declaration", "使用「entity 名称」，不要附加其它内容", "Use \"entity Name\" without anything after it");
			else entities.push({
				name: match[1],
				line
			});
			continue;
		}
		if (head === "gwt") {
			let statement = text;
			while (i + 1 < raw.length) {
				const next = raw[i + 1].trim();
				const keyword = next.split(/\s+/, 1)[0];
				if (!next || next.startsWith("%%")) {
					i += 1;
					continue;
				}
				if (![
					"given",
					"when",
					"then"
				].includes(keyword) && !ENTITY_KEYWORDS.has(keyword)) break;
				statement += ` ${stripComments(raw[++i], comment).trim()}`;
			}
			const match = /^gwt\s+(\d{1,3})\s+(.*)$/.exec(statement);
			const sections = match && readGwt(match[2]);
			if (!sections) {
				issue(line, "gwt 写法无效", "Invalid gwt statement", "使用「gwt 01 given evt A when cmd B then rmo C」", "Use \"gwt 01 given evt A when cmd B then rmo C\"");
				continue;
			}
			gwt.push({
				id: match[1],
				sections,
				line
			});
			continue;
		}
		if (head === "title") {
			if (!info.title) ({text: title, icon: titleIcon} = normalize(text.replace(/^title\s*:?\s*/i, ""), line));
			continue;
		}
		if (head === "acctitle" || head === "accdescr") {
			if (/^accDescr\s*\{/i.test(text)) {
				while (i + 1 < raw.length && !/^\s*\}/.test(raw[i + 1])) i += 1;
				i += 1;
			}
			continue;
		}
		issue(line, `无法识别这一行「${text}」`, `Unrecognized line: ${text}`, "使用 tf/rf 时间框、data 数据块、note、entity 或 gwt", "Use tf/rf time frames, data blocks, note, entity, or gwt");
	}
	const seen = /* @__PURE__ */ new Set();
	for (const frame of frames) {
		if (seen.has(frame.id)) {
			errors.push({
				...error(lang, frame.line, `时间框编号「${frame.id}」重复`, `Duplicate event modeling frame ID "${frame.id}"`, "给每个时间框分配唯一编号", "Give every time frame a unique id"),
				code: "eventmodeling.duplicate-frame"
			});
			continue;
		}
		seen.add(frame.id);
	}
	if (frames.length > LIMITS.workFrames) issue(frames[LIMITS.workFrames].line, `时间框超过渲染上限 ${LIMITS.workFrames} 个`, `More than ${LIMITS.workFrames} time frames cannot be drawn`, "按业务阶段拆成多张图", "Split the timeline into several diagrams");
	const byId = new Map(frames.map((frame) => [frame.id, frame]));
	const blocks = new Map(dataBlocks.map((block) => [block.id, block]));
	for (const frame of frames) {
		for (const id of frame.sources) if (!byId.has(id)) issue(frame.line, `引用的时间框「${id}」不存在`, `Unknown time frame reference: ${id}`, "使用本图中已声明的时间框编号", "Use the id of a time frame declared in this diagram");
		if (frame.dataRef && !blocks.has(frame.dataRef)) issue(frame.line, `引用的数据块「${frame.dataRef}」不存在`, `Unknown data block: ${frame.dataRef}`, "先声明 data 数据块，或修正 [[…]] 中的名称", "Declare the data block, or fix the name inside [[…]]");
	}
	for (const item of gwt) if (!byId.has(item.id)) issue(item.line, `gwt 引用的时间框「${item.id}」不存在`, `gwt references an unknown time frame: ${item.id}`, "使用本图中已声明的时间框编号", "Use the id of a time frame declared in this diagram");
	const referenced = new Set(gwt.flatMap((item) => Object.values(item.sections).flat().map((entry) => entry.id)));
	const unused = entities.filter((entry) => !referenced.has(entry.name.split(".").pop()));
	if (unused.length) hints.push(warning("DIAGRAM_HINT", lang, unused[0].line, `entity 声明未在 gwt 中使用：${unused.map((entry) => entry.name).join("、")}`, `Entities not used by any gwt statement: ${unused.map((entry) => entry.name).join(", ")}`, "在 gwt 中引用这些实体，或删除声明", "Reference the entities in a gwt statement, or remove the declarations"));
	return {
		model: {
			type: "eventmodeling",
			title,
			titleIcon,
			frames,
			dataBlocks,
			notes,
			gwt,
			entities
		},
		errors: [...errors, ...hints]
	};
}
function validate(model, info = {}) {
	const lang = info.lang || "zh";
	const items = [];
	for (const frame of model.frames) {
		const allowed = SOURCE_TYPES[frame.type];
		if (!allowed || !frame.sources.length) continue;
		for (const id of frame.sources) {
			const source = model.frames.find((entry) => entry.id === id);
			if (source && source !== frame && !allowed.includes(source.type)) items.push({
				frame,
				source
			});
		}
	}
	const self = model.frames.filter((frame) => frame.sources.includes(frame.id));
	const diagnostics = [];
	if (items.length) {
		const first = items[0].frame;
		const detail = items.slice(0, 3).map(({ frame, source }) => `${source.id} ${typeName(source.type, lang)} → ${frame.id} ${typeName(frame.type, lang)}`).join("；");
		const expected = [...new Set(SOURCE_TYPES[first.type])].map((type) => typeName(type, lang)).join("/");
		diagnostics.push(warning("DIAGRAM_HINT", lang, first.line, `「${typeName(first.type, lang)}」只应接收来自「${expected}」的输入：${detail}`, `A ${typeName(first.type, "en")} should only receive input from a ${[...new Set(SOURCE_TYPES[first.type])].map((type) => typeName(type, "en")).join("/")}: ${detail}`, "调整 ->> 指向的来源时间框", "Point ->> at a matching upstream time frame"));
	}
	for (const frame of self) diagnostics.push(warning("DIAGRAM_HINT", lang, frame.line, `时间框「${frame.id}」引用了自己，已忽略`, `Time frame ${frame.id} references itself and is skipped`, "去掉指向自身的 ->>", "Remove the ->> that points at the frame itself"));
	return diagnostics;
}
function dataLinesOf(frame, block, measure, maxText, narrow) {
	const source = frame.inline || (block ? {
		type: block.type,
		body: block.lines.join("\n")
	} : null);
	if (!source) return null;
	const rows = String(source.body ?? "").split("\n").map((row) => row.replace(/\s+$/, ""));
	while (rows.length && !rows[0].trim()) rows.shift();
	while (rows.length && !rows[rows.length - 1].trim()) rows.pop();
	const lines = rows.flatMap((row) => wrapText(row, maxText, DATA_FONT, measure));
	const visible = lines.slice(0, narrow ? 4 : LIMITS.dataLines);
	if (lines.length > visible.length) {
		if (narrow) visible.push(`+${lines.length - visible.length}`);
		else visible[visible.length - 1] = "…";
	}
	return {
		type: source.type || null,
		lines: visible,
		total: lines.length,
		text: rows.join("\n")
	};
}
function layout(model, options = {}, info = {}) {
	const lang = options.lang || info.lang || "zh";
	const width = Math.max(1, Number(options.width) || 800);
	const narrow = width < 560;
	const padding = mapConfig(mapConfig(info.config, "eventmodeling"), "padding");
	const pad = typeof padding === "number" && Number.isFinite(padding) ? Math.min(120, Math.max(8, padding)) : PAD;
	const measure = options.measure || ((value, font = FONT.body) => [...String(value ?? "")].length * font.size * .56);
	const errors = [];
	if (!model.frames.length) {
		errors.push(error(lang, info.firstLine || 1, "图中没有时间框", "The diagram has no time frame", "至少写一行「tf 01 ui 名称」", "Add at least one \"tf 01 ui Name\" line"));
		return {
			width,
			height: 0,
			errors
		};
	}
	const lanes = [], laneKeys = /* @__PURE__ */ new Map();
	for (const frame of model.frames) {
		const spec = TYPES[frame.type];
		const key = `${spec.band}:${frame.namespace || ""}`;
		let lane = laneKeys.get(key);
		if (!lane) {
			const used = lanes.filter((entry) => entry.band === spec.band).map((entry) => entry.index);
			lane = {
				id: `lane-${lanes.length}`,
				band: spec.band,
				index: frame.namespace ? Math.max(spec.band, ...used) + 1 : spec.band,
				namespace: frame.namespace,
				label: frame.namespace ? spec.prefix + frame.namespace : spec.lane
			};
			lanes.push(lane);
			laneKeys.set(key, lane);
		}
		frame.lane = lane;
	}
	const rows = [...lanes].sort((a, b) => a.band - b.band || a.index - b.index);
	const maxText = 400;
	const blocks = new Map(model.dataBlocks.map((block) => [block.id, block]));
	const boxes = model.frames.map((frame, index) => {
		const spec = TYPES[frame.type];
		const glyphW = Math.ceil(measure(spec.glyph, GLYPH_FONT));
		const nameLines = wrapText(frame.name, maxText - glyphW - 6, NAME_FONT, measure);
		const data = dataLinesOf(frame, frame.dataRef ? blocks.get(frame.dataRef) : null, measure, maxText, narrow);
		const inner = Math.max(maxWidthOf(nameLines, NAME_FONT, measure) + glyphW + 6, data ? maxWidthOf(data.lines, DATA_FONT, measure) : 0);
		const w = Math.min(MAX_BOX_W, Math.max(MIN_BOX_W, snap(inner + 20)));
		const h = Math.max(MIN_BOX_H, snap(20 + nameLines.length * NAME_STEP + (data ? 4 + data.lines.length * DATA_STEP : 0)));
		return {
			frame,
			index,
			lane: frame.lane,
			glyph: spec.glyph,
			glyphW,
			nameLines,
			data,
			w,
			h,
			x: 0,
			r: 0,
			y: 0
		};
	});
	const labelWidth = Math.max(56, ...rows.map((lane) => Math.ceil(measure(lane.label, LANE_FONT))));
	const gutter = narrow ? LANE_PAD : labelWidth + 24;
	const laneX = pad, columnX = pad + gutter;
	const laneRight = /* @__PURE__ */ new Map();
	let previous = null;
	for (const box of boxes) {
		const own = laneRight.get(box.lane) ?? null;
		let x = previous === null ? columnX : previous + COLUMN_GAP;
		if (own !== null) x = Math.max(x, own + COLUMN_GAP);
		box.x = snap(x);
		box.r = box.x + box.w;
		laneRight.set(box.lane, box.r);
		previous = box.r;
	}
	const contentRight = Math.max(...boxes.map((box) => box.r));
	const laneRightX = Math.max(contentRight + LANE_PAD, pad + labelWidth + 24);
	const rowOf = new Map(rows.map((lane, index) => [lane, index]));
	const boxOf = new Map(boxes.map((box) => [box.frame.id, box]));
	const relations = [];
	for (const box of boxes) {
		const { frame } = box;
		if (frame.sources.length) {
			for (const id of frame.sources) {
				const source = boxOf.get(id);
				if (source && source !== box) relations.push({
					from: id,
					to: frame.id,
					line: frame.line
				});
			}
			continue;
		}
		if (box.index === 0 || frame.kind === "rf") continue;
		for (let k = box.index - 1; k >= 0; k -= 1) {
			if (boxes[k].lane === box.lane) continue;
			relations.push({
				from: boxes[k].frame.id,
				to: frame.id,
				line: frame.line
			});
			break;
		}
	}
	const sideUse = /* @__PURE__ */ new Map(), stripUse = /* @__PURE__ */ new Map(), gapTracks = /* @__PURE__ */ new Map();
	const takeX = (box, side, preferred) => {
		const lo = box.x + SIDE_INSET, hi = box.r - SIDE_INSET;
		const key = `${box.frame.id}:${side}`;
		const used = sideUse.get(key) || [];
		const base = Math.min(hi, Math.max(lo, preferred));
		const offsets = [0];
		for (let step = 1; step <= 24; step += 1) offsets.push(-step * 10, step * 10);
		for (const offset of offsets) {
			const x = Math.round(base + offset);
			if (x < lo - .01 || x > hi + .01 || used.some((value) => Math.abs(value - x) < 8)) continue;
			used.push(x);
			sideUse.set(key, used);
			return x;
		}
		used.push(base);
		sideUse.set(key, used);
		return base;
	};
	const takeStrip = (candidates, laneLo, laneHi) => {
		for (const index of candidates) {
			const left = Math.round(boxes[index].r), room = boxes[index + 1].x - boxes[index].r;
			const list = stripUse.get(index) || [];
			for (let slot = 1; slot * SLOT < room - 2; slot += 1) {
				const x = left + slot * SLOT;
				if (list.some((item) => item.slot === slot && item.lo <= laneHi && laneLo <= item.hi)) continue;
				list.push({
					slot,
					lo: laneLo,
					hi: laneHi
				});
				stripUse.set(index, list);
				return x;
			}
		}
		const index = candidates[0];
		const x = Math.round(boxes[index].r + SLOT);
		const list = stripUse.get(index) || [];
		list.push({
			slot: 1,
			lo: laneLo,
			hi: laneHi
		});
		stripUse.set(index, list);
		return x;
	};
	const takeTrack = (gap, lo, hi) => {
		const list = gapTracks.get(gap) || [];
		for (let track = 0; track < 12; track += 1) {
			if (list.some((item) => item.track === track && item.lo - 4 <= hi && lo <= item.hi + 4)) continue;
			list.push({
				track,
				lo,
				hi
			});
			gapTracks.set(gap, list);
			return track;
		}
		list.push({
			track: 0,
			lo,
			hi
		});
		gapTracks.set(gap, list);
		return 0;
	};
	const plans = [];
	for (const relation of relations) {
		const source = boxOf.get(relation.from), target = boxOf.get(relation.to);
		const sourceRow = rowOf.get(source.lane), targetRow = rowOf.get(target.lane);
		const plan = {
			from: relation.from,
			to: relation.to,
			line: relation.line
		};
		const middle = (Math.max(source.x, target.x) + Math.min(source.r, target.r)) / 2;
		if (sourceRow === targetRow) {
			const below = sourceRow < rows.length - 1 || rows.length === 1;
			const gap = below ? sourceRow : sourceRow - 1;
			plan.kind = "hook";
			plan.gap = gap;
			plan.side = below ? "bottom" : "top";
			plan.exitX = takeX(source, plan.side, middle);
			plan.entryX = takeX(target, plan.side, middle);
			plan.track = takeTrack(gap, Math.min(plan.exitX, plan.entryX), Math.max(plan.exitX, plan.entryX));
			plans.push(plan);
			continue;
		}
		const down = targetRow > sourceRow;
		plan.exitSide = down ? "bottom" : "top";
		plan.entrySide = down ? "top" : "bottom";
		const gapSource = down ? sourceRow : sourceRow - 1;
		const gapTarget = down ? targetRow - 1 : targetRow;
		if (gapSource === gapTarget) {
			plan.exitX = takeX(source, plan.exitSide, middle);
			plan.entryX = takeX(target, plan.entrySide, middle);
			if (Math.abs(plan.exitX - plan.entryX) < .5) {
				plan.kind = "straight";
				plans.push(plan);
				continue;
			}
			plan.kind = "elbow";
			plan.gap = gapSource;
			plan.track = takeTrack(gapSource, Math.min(plan.exitX, plan.entryX), Math.max(plan.exitX, plan.entryX));
			plans.push(plan);
			continue;
		}
		const low = Math.min(source.index, target.index), high = Math.max(source.index, target.index);
		const candidates = [];
		for (let index = low; index < high; index += 1) candidates.push(index);
		plan.stripX = takeStrip(candidates, Math.min(sourceRow, targetRow) + 1, Math.max(sourceRow, targetRow) - 1);
		plan.exitX = takeX(source, plan.exitSide, plan.stripX);
		plan.entryX = takeX(target, plan.entrySide, plan.stripX);
		plan.kind = "cross";
		plan.gapA = gapSource;
		plan.gapB = gapTarget;
		plan.trackA = takeTrack(gapSource, Math.min(plan.exitX, plan.stripX), Math.max(plan.exitX, plan.stripX));
		plan.trackB = takeTrack(gapTarget, Math.min(plan.entryX, plan.stripX), Math.max(plan.entryX, plan.stripX));
		plans.push(plan);
	}
	for (const lane of rows) {
		const own = boxes.filter((box) => box.lane === lane);
		lane.maxH = Math.max(0, ...own.map((box) => box.h));
		lane.h = Math.max(MIN_LANE_H, lane.maxH + 24 + (narrow ? 18 : 0));
		lane.w = laneRightX - laneX;
		lane.x = laneX;
		lane.labelX = lane.x + 10;
	}
	const gapH = rows.map((_, gap) => {
		const tracks = gapTracks.get(gap) || [];
		const depth = Math.max(0, ...tracks.map((item) => item.track));
		return tracks.length ? LANE_GAP + depth * TRACK : gap < rows.length - 1 ? LANE_GAP : 0;
	});
	const { title, titleIcon } = model;
	const titleLines = title || titleIcon ? wrapText(title, laneRightX - pad - (titleIcon ? 20 : 0), FONT.title, measure) : [];
	let cursor = pad + titleLines.length * 20;
	rows.forEach((lane, index) => {
		lane.y = cursor;
		lane.labelY = lane.y + (narrow ? 13 : lane.h / 2);
		cursor += lane.h + gapH[index];
	});
	const stackBottom = cursor;
	for (const box of boxes) box.y = box.lane.y + LANE_PAD + (narrow ? 18 : 0);
	const trackY = (gap, track) => rows[gap].y + rows[gap].h + 6 + track * TRACK;
	const edges = plans.map((plan) => {
		const source = boxOf.get(plan.from), target = boxOf.get(plan.to);
		const exitY = (plan.exitSide || plan.side) === "bottom" ? source.y + source.h : source.y;
		const entryY = (plan.entrySide || plan.side) === "bottom" ? target.y + target.h : target.y;
		let points;
		if (plan.kind === "straight") points = [{
			x: plan.exitX,
			y: exitY
		}, {
			x: plan.entryX,
			y: entryY
		}];
		else if (plan.kind === "elbow" || plan.kind === "hook") points = [
			{
				x: plan.exitX,
				y: exitY
			},
			{
				x: plan.exitX,
				y: trackY(plan.gap, plan.track)
			},
			{
				x: plan.entryX,
				y: trackY(plan.gap, plan.track)
			},
			{
				x: plan.entryX,
				y: entryY
			}
		];
		else points = [
			{
				x: plan.exitX,
				y: exitY
			},
			{
				x: plan.exitX,
				y: trackY(plan.gapA, plan.trackA)
			},
			{
				x: plan.stripX,
				y: trackY(plan.gapA, plan.trackA)
			},
			{
				x: plan.stripX,
				y: trackY(plan.gapB, plan.trackB)
			},
			{
				x: plan.entryX,
				y: trackY(plan.gapB, plan.trackB)
			},
			{
				x: plan.entryX,
				y: entryY
			}
		];
		const simplified = points.filter((point, index) => !index || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
		return {
			from: plan.from,
			to: plan.to,
			line: plan.line,
			points: simplified,
			d: simplified.map((point, index) => `${index ? "L" : "M"}${Math.round(point.x)} ${Math.round(point.y)}`).join(" ")
		};
	});
	const captions = [];
	const captionX = laneX + 4, captionWidth = Math.max(120, laneRightX - captionX - 12);
	let captionY = stackBottom + 18;
	const pushCaption = (text, kind, fill) => {
		captions.push({
			x: captionX,
			y: captionY,
			text,
			kind,
			fill
		});
		captionY += CAPTION_STEP;
	};
	const label = (value) => message(lang, ...value);
	for (const block of model.gwt) {
		if (captions.length) captionY += 6;
		pushCaption(`GWT ${block.id}`, "heading");
		for (const key of [
			"given",
			"when",
			"then"
		]) {
			const list = block.sections[key];
			if (!list.length) continue;
			const text = `${label({
				given: ["给定 Given", "Given"],
				when: ["当 When", "When"],
				then: ["那么 Then", "Then"]
			}[key])}: ${list.map((entry) => `${entry.type} ${entry.id}`).join(" · ")}`;
			for (const line of wrapText(text, captionWidth, CAPTION_FONT, measure)) pushCaption(line, "body");
		}
	}
	for (const note of model.notes) {
		if (captions.length) captionY += 6;
		pushCaption(`Note ${note.id}`, "heading");
		for (const line of note.lines.flatMap((row) => wrapText(row, captionWidth, CAPTION_FONT, measure))) pushCaption(line, "body");
	}
	if (model.entities.length) {
		if (captions.length) captionY += 6;
		pushCaption(label(["实体", "Entities"]), "heading");
		for (const row of wrapText(model.entities.map((entity) => entity.name).join(" · "), captionWidth, CAPTION_FONT, measure)) pushCaption(row, "body");
	}
	const height = captions.length ? captionY + pad - CAPTION_STEP + 4 : stackBottom + pad;
	const sceneWidth = laneRightX + pad, sceneHeight = snap(Math.max(1, height));
	if (model.frames.length > LIMITS.largeFrames || sceneWidth > width * 2) errors.push(warning("LARGE_DIAGRAM", lang, info.firstLine || 1, `图较大（${model.frames.length} 个时间框、宽 ${sceneWidth}px），建议拆成多张`, `Large diagram (${model.frames.length} time frames, ${sceneWidth}px wide); consider splitting it`, "按业务阶段拆分时间线", "Split the timeline by business stage"));
	return {
		type: "eventmodeling",
		width: sceneWidth,
		height: sceneHeight,
		lanes: rows,
		boxes,
		edges,
		captions,
		errors,
		title,
		titleIcon,
		titleLines,
		pad
	};
}
function scene(geometry, ctx) {
	const look = appearance(ctx);
	const children = [];
	const { pad, titleIcon, titleLines } = geometry;
	if (titleLines.length) {
		const y = Math.max(9, pad);
		children.push(ctx.textLines(pad + (titleIcon ? 20 : 0), y, titleLines, {
			...FONT.title,
			leading: 20,
			fill: look.fg1,
			"dominant-baseline": "central"
		}));
		if (titleIcon) children.push(mapIcon(ctx, titleIcon, pad + 7, y, look.fg1));
	}
	const marker = "em-arrow";
	children.push(ctx.el("defs", {}, [ctx.el("marker", {
		id: marker,
		viewBox: "0 0 8 8",
		refX: 7,
		refY: 4,
		markerWidth: 8,
		markerHeight: 8,
		markerUnits: "userSpaceOnUse",
		orient: "auto"
	}, [ctx.path("M0 0 L8 4 L0 8 Z", { fill: ctx.color("muted") })])]));
	for (const [index, lane] of geometry.lanes.entries()) {
		const band = ctx.el("g", {}, [ctx.rect(lane.x, lane.y, lane.w, lane.h, {
			fill: index % 2 ? look.surface2 : look.surface,
			stroke: look.line,
			"stroke-width": 1,
			rx: look.radius,
			meta: {
				kind: "frame",
				id: lane.id
			}
		}), ctx.text(lane.labelX, lane.labelY, lane.label, {
			size: LANE_FONT.size,
			weight: LANE_FONT.weight,
			fill: look.fg3,
			anchor: "start",
			"dominant-baseline": "central"
		})]);
		band.meta = {
			kind: "frame",
			id: lane.id
		};
		children.push(band);
	}
	for (const box of geometry.boxes) {
		const spec = TYPES[box.frame.type];
		const tone = spec.role ? ctx.frameTone(ctx.color(spec.role)) : null;
		const fill = tone ? ctx.tint(look.bg, tone, .12) : look.node;
		const stroke = tone ? ctx.tint(look.bg, tone, .45) : look.line2;
		const ink = ctx.textOn(fill);
		const glyphInk = tone ? ctx.textColor(tone) : look.fg3;
		const parts = [ctx.rect(box.x, box.y, box.w, box.h, {
			fill,
			stroke,
			"stroke-width": 1,
			rx: look.smallRadius,
			meta: {
				kind: "node",
				id: box.frame.id
			}
		}), ctx.text(box.x + BOX_PAD, box.y + BOX_PAD + NAME_STEP / 2, box.glyph, {
			size: GLYPH_FONT.size,
			weight: GLYPH_FONT.weight,
			fill: glyphInk,
			anchor: "start",
			"dominant-baseline": "central"
		})];
		for (const [index, line] of box.nameLines.entries()) parts.push(ctx.text(box.x + BOX_PAD + box.glyphW + 6, box.y + BOX_PAD + NAME_STEP / 2 + index * NAME_STEP, line, {
			size: NAME_FONT.size,
			weight: NAME_FONT.weight,
			fill: ink,
			anchor: "start",
			"dominant-baseline": "central"
		}));
		const dataTop = box.y + BOX_PAD + box.nameLines.length * NAME_STEP + 4;
		for (const [index, line] of (box.data?.lines || []).entries()) parts.push(ctx.text(box.x + BOX_PAD, dataTop + DATA_STEP / 2 + index * DATA_STEP, line, {
			size: DATA_FONT.size,
			weight: DATA_FONT.weight,
			fill: ink,
			anchor: "start",
			"dominant-baseline": "central"
		}));
		const tip = [
			box.frame.id,
			box.frame.identifier,
			box.data?.text
		].filter(Boolean).join(" · ");
		children.push(ctx.titled(ctx.el("g", {}, parts), tip));
	}
	for (const edge of geometry.edges) children.push(ctx.path(edge.d, {
		fill: "none",
		stroke: ctx.color("muted"),
		"stroke-width": 1.25,
		"stroke-linejoin": "round",
		"marker-end": `url(#${marker})`,
		meta: {
			kind: "edge",
			from: edge.from,
			to: edge.to
		}
	}));
	for (const line of geometry.captions) children.push(ctx.text(line.x, line.y, line.text, {
		size: CAPTION_FONT.size,
		weight: line.kind === "heading" ? LANE_FONT.weight : CAPTION_FONT.weight,
		fill: line.kind === "heading" ? look.fg3 : look.fg2,
		anchor: "start",
		"dominant-baseline": "central"
	}));
	return {
		width: geometry.width,
		height: geometry.height,
		title: geometry.title,
		children
	};
}
var implementations = { eventmodeling: {
	parse,
	validate,
	layout,
	scene,
	honoredConfig: ["eventmodeling.padding"]
} };
export { eventmodeling_exports, implementations };
