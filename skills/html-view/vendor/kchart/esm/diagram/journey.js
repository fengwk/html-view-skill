import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { FONT, appearance, error, labelText, warning } from "./support.js";
// src/diagram/journey.js
var journey_exports = /* @__PURE__ */ __exportAll({ implementations: () => implementations });
var TASK_ADVISORY = 60;
var TASK_CAP = 2e3;
var honoredConfig = ["journey"];
var HONORED = /* @__PURE__ */ new Map([
	["taskfontsize", "taskFontSize"],
	["maxlabelwidth", "maxLabelWidth"],
	["titlefontsize", "titleFontSize"],
	["leftmargin", "leftMargin"]
]);
var COLOR_KEYS = /* @__PURE__ */ new Set([
	"actorcolours",
	"sectionfills",
	"sectioncolours",
	"titlecolor"
]);
var configKey = (value) => String(value).toLowerCase().replace(/[-_]/g, "");
var FACE_R = 9;
var SCALE = {
	segments: 5,
	width: 4,
	gap: 2,
	height: 3,
	total: 28
};
var LAYOUT = {
	labelX: 12,
	labelPad: 12,
	plotGap: 6,
	right: 16,
	band: 10,
	bottom: 16,
	row: 48,
	chipR: 4,
	chipGap: 6
};
LAYOUT.chip = LAYOUT.chipR * 2 + LAYOUT.chipGap;
var issue = (lang, line, zh, en, fixZh, fixEn) => error(lang, line, zh, en, fixZh, fixEn);
var pixels = (value, fallback, min, max) => {
	if (value == null || value === "") return fallback;
	if (typeof value === "number") return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
	const match = /^([+-]?\d*\.?\d+)\s*(px|pt|ex|em|rem)?$/i.exec(String(value).trim());
	if (!match) return fallback;
	const factor = {
		px: 1,
		pt: 4 / 3,
		ex: 4,
		em: 12,
		rem: 12
	}[(match[2] || "px").toLowerCase()];
	return Math.min(max, Math.max(min, Number(match[1]) * factor));
};
function uncomment(value) {
	let quote = "";
	for (let i = 0; i < value.length; i += 1) {
		const ch = value[i];
		if (quote) {
			if (ch === quote) quote = "";
			continue;
		}
		if (ch === "\"" || ch === "'") {
			quote = ch;
			continue;
		}
		if (ch === "%" && value[i + 1] === "%") return value.slice(0, i).trimEnd();
		if (ch === "#" && !/^#[\w]+;/.test(value.slice(i))) return value.slice(0, i).trimEnd();
	}
	return value;
}
var hasStraySemicolon = (value) => value.replace(/#[\w]+;/g, "").includes(";");
function readConfig(info, lang, line, errors) {
	const source = info?.config?.journey;
	const settings = {};
	if (!source || typeof source !== "object" || Array.isArray(source)) return settings;
	const colors = [], ignored = [];
	for (const [key, value] of Object.entries(source)) {
		const name = configKey(key);
		if (HONORED.has(name)) {
			settings[HONORED.get(name)] = value;
			continue;
		}
		if (COLOR_KEYS.has(name)) colors.push(key);
		else ignored.push(key);
	}
	if (colors.length) errors.push(warning("IGNORED_STYLE", lang, line, `旅程图颜色由主题决定，已忽略配置：${colors.join(", ")}`, `Journey colors come from the theme; ignored: ${colors.join(", ")}`, "改用主题调色板", "Use the theme palette"));
	if (ignored.length) errors.push(warning("IGNORED_CONFIG", lang, line, `旅程图不支持这些配置，已忽略：${ignored.join(", ")}`, `Ignored journey config: ${ignored.join(", ")}`, "移除这些配置项", "Remove these config keys"));
	return settings;
}
function parse(body, info = {}) {
	const lang = info.lang || "zh";
	const firstLine = Number.isInteger(info.firstLine) ? info.firstLine : 2;
	const errors = [];
	if (body.length > 2e5) return {
		model: null,
		errors: [issue(lang, firstLine, "旅程图源码超过 200000 字符", "Journey source exceeds 200,000 characters", "拆分旅程图", "Split the journey")]
	};
	const raw = readConfig(info, lang, info.headerLine || Math.max(1, firstLine - 1), errors);
	const config = {
		taskFontSize: pixels(raw.taskFontSize, FONT.body.size, 12, 20),
		maxLabelWidth: pixels(raw.maxLabelWidth, 360, 120, 640),
		titleFontSize: pixels(raw.titleFontSize, FONT.title.size, 12, 28),
		leftMargin: pixels(raw.leftMargin, 0, 0, 480)
	};
	const tasks = [], sections = [{
		name: "",
		tasks: []
	}];
	let title = info.title || "", accTitle = "", accDescr = "", decimalWarned = false, overflow = false;
	let brace = null;
	const ignoredOptions = Object.keys(info.options || {});
	if (ignoredOptions.length) errors.push(warning("IGNORED_CONFIG", lang, info.headerLine || Math.max(1, firstLine - 1), `旅程图标题行不接受选项，已忽略：${ignoredOptions.join(", ")}`, `Journey header options are ignored: ${ignoredOptions.join(", ")}`, "只保留 journey 关键字", "Keep only the journey keyword"));
	const lines = String(body ?? "").replace(/\r\n?/g, "\n").split("\n");
	for (let index = 0; index < lines.length; index += 1) {
		const line = firstLine + index;
		const text = uncomment(String(lines[index]).trim()).trim();
		if (brace) {
			const end = text.indexOf("}");
			brace.push(end < 0 ? text : text.slice(0, end));
			if (end >= 0) {
				accDescr = brace.join(" ").replace(/\s+/g, " ").trim();
				brace = null;
			}
			continue;
		}
		if (!text || text.startsWith("%%")) continue;
		if (hasStraySemicolon(text)) {
			errors.push(issue(lang, line, "分号不能用于分隔旅程图语句", "Semicolons cannot separate journey statements", "每行只写一条语句", "Write one statement per line"));
			continue;
		}
		let match;
		if (match = /^accTitle\s*:\s*(.*)$/i.exec(text)) {
			accTitle = match[1].trim();
			continue;
		}
		if (match = /^accDescr\s*:\s*(.*)$/i.exec(text)) {
			accDescr = match[1].trim();
			continue;
		}
		if (match = /^accDescr\s*\{\s*([\s\S]*)$/i.exec(text)) {
			const rest = match[1];
			const end = rest.indexOf("}");
			if (end >= 0) accDescr = rest.slice(0, end).trim();
			else brace = [rest];
			continue;
		}
		if (match = /^title(?:\s*:|\s+)(.*)$/i.exec(text)) {
			title = match[1].trim();
			continue;
		}
		if (/^title$/i.test(text)) continue;
		if (/^section\b/i.test(text)) {
			const name = /^section\s+([^#:\n;]+)$/i.exec(text);
			if (!name || !name[1].trim()) {
				errors.push(issue(lang, line, "分组名不能包含冒号或为空", "A section name must be non-empty and cannot contain \":\"", "写成「section 名称」", "Write \"section name\""));
				continue;
			}
			sections.push({
				name: labelText(name[1].trim()),
				tasks: []
			});
			continue;
		}
		const colon = text.indexOf(":");
		const name = colon < 0 ? "" : text.slice(0, colon).trim();
		if (!name) {
			errors.push(issue(lang, line, "旅程任务需要写成「任务名: 评分: 参与者」", "A journey task reads \"task name: score: actors\"", "在冒号前写任务名", "Write the task name before the colon"));
			continue;
		}
		const pieces = text.slice(colon + 1).split(":");
		const scoreText = pieces[0].trim();
		const score = scoreText === "" ? NaN : Number(scoreText);
		const actors = [...new Set((pieces[1] || "").split(",").map((actor) => labelText(actor).trim()).filter(Boolean))];
		if (!Number.isFinite(score)) {
			errors.push(issue(lang, line, `评分「${scoreText}」不是数字`, `Score "${scoreText}" is not a number`, "用 1–5 的整数评分", "Use a whole score from 1 to 5"));
			continue;
		}
		if (score < 1 || score > 5) {
			errors.push(issue(lang, line, `评分 ${score} 超出 1–5 的范围`, `Score ${score} is outside 1–5`, "把评分改为 1 到 5", "Use a score from 1 to 5"));
			continue;
		}
		if (!Number.isInteger(score) && !decimalWarned) {
			decimalWarned = true;
			errors.push(warning("DIAGRAM_HINT", lang, line, `评分 ${score} 不是整数，已按原值绘制`, `Score ${score} is not whole; drawn as written`, "使用 1–5 的整数评分", "Use whole scores from 1 to 5"));
		}
		if (tasks.length >= TASK_CAP) {
			if (!overflow) {
				overflow = true;
				errors.push(issue(lang, line, `旅程图最多 ${TASK_CAP} 个任务`, `A journey can contain at most ${TASK_CAP} tasks`, "把旅程拆成两张图", "Split the journey into two diagrams"));
			}
			continue;
		}
		const task = {
			id: `task:${tasks.length}`,
			name: labelText(name),
			score,
			actors,
			line
		};
		tasks.push(task);
		sections.at(-1).tasks.push(task);
	}
	if (brace) accDescr = brace.join(" ").replace(/\s+/g, " ").trim();
	if (!tasks.length && !errors.some((item) => item.severity !== "warning")) errors.push(issue(lang, firstLine, "旅程图中没有任务", "Journey has no tasks", "添加「任务名: 评分: 参与者」", "Add \"task name: score: actors\""));
	const actors = [...new Set(tasks.flatMap((task) => task.actors))];
	return {
		model: {
			type: "journey",
			title,
			tasks,
			sections,
			actors,
			accTitle,
			accDescr,
			config
		},
		errors
	};
}
function layout(model, options = {}) {
	const { width = 800, ctx, renderOptions = {} } = options;
	if (!ctx) throw new TypeError("journey layout needs a theme context");
	const look = appearance(ctx);
	const measure = options.measure || ((value, font) => ctx.measure(value, font.size, font.weight));
	const paper = ctx.color("bg"), accent = ctx.color("accent"), grid = ctx.color("grid");
	const ink = ctx.color("fg"), muted = ctx.color("muted");
	const config = model.config || {};
	const bodyFont = {
		size: config.taskFontSize || FONT.body.size,
		weight: FONT.body.weight
	};
	const labelFont = {
		size: FONT.label.size,
		weight: FONT.label.weight
	};
	const titleSize = config.titleFontSize || FONT.title.size;
	const maxLabelWidth = config.maxLabelWidth || 360;
	const { tasks, actors } = model, groups = model.sections.filter((g) => g.name || g.tasks.length);
	const actorIndex = new Map(actors.map((actor, index) => [actor, index]));
	const children = [], errors = [];
	const font = (size, weight) => ({
		size,
		weight
	});
	const widthOf = (value, style) => measure(value, style);
	const toneOf = (name) => {
		const index = actorIndex.get(name);
		return ctx.tint(paper, ctx.color(`tone${index % 6 + 1}`), .8);
	};
	const names = new Map(tasks.map((task) => [task, ctx.wrap(task.name, maxLabelWidth, bodyFont.size, bodyFont.weight)]));
	const chipsOf = (task) => task.actors.length ? (task.actors.length - 1) * LAYOUT.chip + LAYOUT.chipR * 2 : 0;
	const labelWidth = Math.max(0, ...tasks.map((task) => Math.max(0, ...names.get(task).map((line) => widthOf(line, bodyFont))) + (task.actors.length ? 10 + chipsOf(task) : 0)));
	const sectionFont = font(FONT.body.size, 600);
	const sectionWidth = Math.max(0, ...groups.flatMap((group) => group.name.split("\n").map((line) => widthOf(line, sectionFont))));
	const pitch = bodyFont.size + 5;
	const left = Math.max(config.leftMargin || 0, LAYOUT.labelX + Math.max(labelWidth, sectionWidth) + LAYOUT.labelPad + FACE_R + LAYOUT.plotGap);
	const plotW = Math.max(140, width - left - LAYOUT.right);
	const x0 = left, x1 = left + plotW, step = plotW / 4;
	const sceneWidth = Math.ceil(Math.max(width, x1 + LAYOUT.right));
	const inSceneTitle = Boolean(model.title) && !renderOptions?.frame;
	if (inSceneTitle) children.push(ctx.text(LAYOUT.labelX, titleSize + 12, model.title, {
		size: titleSize,
		weight: 600,
		fill: ink
	}));
	let cursor = inSceneTitle ? 12 + titleSize + 18 : 16;
	const legendWidth = Math.max(120, x1 - LAYOUT.labelX);
	const legendRows = [];
	let row = [], used = 0, rowHeight = 0;
	for (const name of actors) {
		const lines = ctx.wrap(name, Math.max(60, legendWidth - 13), labelFont.size, labelFont.weight);
		const itemWidth = 13 + Math.max(0, ...lines.map((line) => widthOf(line, labelFont)));
		if (row.length && used + itemWidth > legendWidth) {
			legendRows.push({
				items: row,
				height: rowHeight
			});
			row = [];
			used = 0;
			rowHeight = 0;
		}
		row.push({
			name,
			lines,
			width: itemWidth
		});
		used += itemWidth + 14;
		rowHeight = Math.max(rowHeight, lines.length * 15);
	}
	if (row.length) legendRows.push({
		items: row,
		height: rowHeight
	});
	for (const legend of legendRows) {
		let x = LAYOUT.labelX;
		for (const item of legend.items) {
			children.push(ctx.titled(ctx.circle(x + LAYOUT.chipR, cursor + 8, LAYOUT.chipR, {
				fill: toneOf(item.name),
				stroke: paper,
				"stroke-width": 1
			}), item.name));
			item.lines.forEach((text, i) => children.push(ctx.text(x + 13, cursor + 8 + i * 15, text, {
				...labelFont,
				fill: muted,
				"dominant-baseline": "middle"
			})));
			x += item.width + 14;
		}
		cursor += legend.height + (legendRows.length > 1 ? 4 : 0);
	}
	if (legendRows.length) cursor += 10;
	const scaleY = cursor + 8;
	for (let score = 1; score <= SCALE.segments; score += 1) children.push(ctx.text(x0 + (score - 1) * step, scaleY, String(score), {
		...labelFont,
		fill: muted,
		anchor: "middle",
		"dominant-baseline": "middle"
	}));
	cursor = scaleY + 14;
	const bands = [];
	for (const [index, group] of groups.entries()) {
		const sectionLines = group.name ? group.name.split("\n") : [];
		const bandY = cursor;
		let y = bandY + (sectionLines.length ? 10 + 18 * sectionLines.length : 0);
		const rows = group.tasks.map((task) => {
			const lines = names.get(task);
			const height = Math.max(LAYOUT.row, lines.length * pitch + 24);
			const entry = {
				task,
				lines,
				y,
				height,
				mid: y + height / 2
			};
			y += height;
			return entry;
		});
		bands.push({
			group,
			index,
			y: bandY,
			height: y - bandY,
			sectionLines,
			rows
		});
		cursor = y + LAYOUT.band;
	}
	const contentBottom = bands.length ? cursor - LAYOUT.band : cursor;
	for (const band of bands) {
		if (!band.group.name) continue;
		children.push(ctx.rect(8, band.y, x1 + LAYOUT.labelPad - 8, band.height, {
			rx: look.radius,
			fill: ctx.tint(paper, ctx.color(`tone${band.index % 6 + 1}`), .06),
			meta: {
				kind: "frame",
				id: `section:${band.index}`
			}
		}));
	}
	for (const band of bands) {
		band.sectionLines.forEach((line, i) => children.push(ctx.text(LAYOUT.labelX, band.y + 15 + i * 18, line, {
			...sectionFont,
			fill: muted,
			"dominant-baseline": "middle"
		})));
		for (const { task, lines, mid } of band.rows) {
			lines.forEach((text, i) => children.push(ctx.text(LAYOUT.labelX, mid + (i - (lines.length - 1) / 2) * pitch, text, {
				...bodyFont,
				fill: ink,
				"dominant-baseline": "middle"
			})));
			if (task.actors.length) {
				const start = LAYOUT.labelX + Math.max(0, ...lines.map((line) => widthOf(line, bodyFont))) + 10 + LAYOUT.chipR;
				task.actors.forEach((name, i) => children.push(ctx.titled(ctx.circle(start + i * LAYOUT.chip, mid, LAYOUT.chipR, {
					fill: toneOf(name),
					stroke: paper,
					"stroke-width": 1
				}), name)));
			}
			children.push(ctx.line(x0, mid, x1, mid, {
				stroke: grid,
				"stroke-width": 1
			}));
			const faceX = x0 + (Math.min(SCALE.segments, Math.max(1, task.score)) - 1) * step;
			children.push(ctx.circle(faceX, mid, FACE_R, {
				fill: ctx.tint(paper, accent, .06),
				stroke: accent,
				"stroke-width": 1.4,
				meta: {
					kind: "node",
					id: task.id
				}
			}));
			for (const eye of [-3, 3]) children.push(ctx.circle(faceX + eye, mid - 2.5, 1.2, { fill: muted }));
			const mouth = task.score > 3 ? `M${faceX - 4} ${mid + 2} Q${faceX} ${mid + 7} ${faceX + 4} ${mid + 2}` : task.score < 3 ? `M${faceX - 4} ${mid + 5.5} Q${faceX} ${mid + .5} ${faceX + 4} ${mid + 5.5}` : `M${faceX - 4} ${mid + 3.5} L${faceX + 4} ${mid + 3.5}`;
			children.push(ctx.path(mouth, {
				fill: "none",
				stroke: accent,
				"stroke-width": 1.4,
				"stroke-linecap": "round"
			}));
			const scaleX = Math.min(Math.max(faceX - SCALE.total / 2, x0), x1 - SCALE.total);
			const filled = Math.min(SCALE.segments, Math.max(1, Math.round(task.score)));
			for (let k = 0; k < SCALE.segments; k += 1) children.push(ctx.rect(scaleX + k * (SCALE.width + SCALE.gap), mid + 12, SCALE.width, SCALE.height, {
				rx: 1.5,
				fill: k < filled ? accent : grid,
				"fill-opacity": k < filled ? .85 : .45
			}));
		}
	}
	const height = Math.ceil(Math.max(160, contentBottom + LAYOUT.bottom));
	if (tasks.length > TASK_ADVISORY) errors.push(warning("LARGE_DIAGRAM", options.lang || ctx.lang || "zh", tasks[TASK_ADVISORY].line, `旅程图有 ${tasks.length} 个任务，建议拆分`, `The journey has ${tasks.length} tasks; consider splitting it`, "按阶段拆成两张旅程图", "Split the journey by stage"));
	else if (sceneWidth > width * 2) errors.push(warning("LARGE_DIAGRAM", options.lang || ctx.lang || "zh", 1, "旅程图比给定宽度宽很多", "The journey is much wider than the requested width", "缩小任务名或拆分旅程图", "Shorten task names or split the journey"));
	return {
		width: sceneWidth,
		height,
		scene: {
			width: sceneWidth,
			height,
			children,
			...model.title ? { title: model.title } : {},
			...model.accDescr ? { description: model.accDescr } : {},
			...renderOptions?.frame && model.title ? { heading: model.title } : {}
		},
		errors
	};
}
var implementations = { journey: {
	parse,
	layout,
	honoredConfig
} };
export { implementations, journey_exports };
