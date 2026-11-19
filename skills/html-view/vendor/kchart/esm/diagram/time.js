import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { error } from "./support.js";
// src/diagram/time.js
var time_exports = /* @__PURE__ */ __exportAll({ implementations: () => implementations });
var MAX_ITEMS = 80;
var MAX_LINES = 240;
var MAX_PACKET_BIT = 4095;
var kinds = [
	"gantt",
	"timeline",
	"journey",
	"gitGraph",
	"kanban",
	"packet-beta",
	"quadrantChart"
];
var issue = (lang, line, text) => error(lang, line, `无法识别或处理语句「${String(text).slice(0, 36)}」`, `Unrecognized or invalid statement: ${String(text).slice(0, 36)}`, "修正这条语句或移除不支持的语法", "Fix this statement or remove unsupported syntax");
var date = (s) => {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN;
	const [y, m, d] = s.split("-").map(Number);
	if (y < 1) return NaN;
	const t = /* @__PURE__ */ new Date(0);
	t.setUTCHours(0, 0, 0, 0);
	t.setUTCFullYear(y, m - 1, d);
	const x = new Date(t.getTime());
	return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? t.getTime() : NaN;
};
var addDays = (value, days) => {
	if (!Number.isSafeInteger(Number(days))) return "";
	const stamp = date(value) + Number(days) * 864e5;
	if (!Number.isFinite(stamp)) return "";
	const result = new Date(stamp), year = result.getUTCFullYear();
	if (!Number.isFinite(result.getTime()) || year < 1 || year > 9999) return "";
	return `${String(year).padStart(4, "0")}-${String(result.getUTCMonth() + 1).padStart(2, "0")}-${String(result.getUTCDate()).padStart(2, "0")}`;
};
var qstr = "(?:\"(?:[^\"\\\\]|\\\\.)*\"|[\\w.-]+)";
function parse(body, info, kind) {
	const { lang, options = {}, firstLine = 2 } = info, errors = [];
	const lines = String(body).replace(/\r\n?/g, "\n").split("\n");
	for (const key of Object.keys(options)) errors.push(issue(lang, info.headerLine || firstLine - 1, `option ${key}`));
	if (lines.length > MAX_LINES) errors.push(issue(lang, firstLine + MAX_LINES, `scope exceeds ${MAX_LINES} lines`));
	const model = {
		type: kind,
		title: info.title || "",
		items: [],
		sections: [],
		branches: kind === "gitGraph" ? [{
			name: "main",
			head: ""
		}] : [],
		fields: [],
		commits: [],
		config: {}
	};
	let section = "", current = "main", indentColumn = null, itemCount = 0;
	const countItem = (line) => {
		if (itemCount >= MAX_ITEMS) {
			errors.push(issue(lang, line, `scope exceeds ${MAX_ITEMS} items`));
			return false;
		}
		itemCount += 1;
		return true;
	};
	const add = (line, item) => {
		if (countItem(line)) model.items.push({
			...item,
			line,
			section,
			branch: current
		});
	};
	const unquote = (s) => s?.startsWith("\"") ? s.slice(1, -1).replace(/\\(.)/g, "$1") : s;
	lines.slice(0, MAX_LINES).forEach((raw, i) => {
		const lineNo = firstLine + i, s = raw.trim();
		if (!s || s.startsWith("%%")) return;
		if (/^(title|accTitle|accDescr)(?:\s*:|\s+)/i.test(s)) {
			const value = s.replace(/^[^:\s]+\s*:?[ \t]*/, "");
			if (/^title/i.test(s)) model.title = value;
			else errors.push(issue(lang, lineNo, s));
			return;
		}
		if (kind === "gantt") {
			let m;
			if (m = /^dateFormat\s+(\S+)$/i.exec(s)) {
				if (m[1] !== "YYYY-MM-DD") errors.push(issue(lang, lineNo, s));
				else model.config.dateFormat = m[1];
				return;
			}
			if (m = /^axisFormat\s+(\S+)$/i.exec(s)) {
				if (m[1] !== "%Y-%m") errors.push(issue(lang, lineNo, s));
				else model.config.axisFormat = m[1];
				return;
			}
			if (/^(?:excludes|tickInterval|todayMarker)\b/i.test(s)) {
				errors.push(issue(lang, lineNo, s));
				return;
			}
			if (/^section\s+/i.test(s)) {
				section = s.replace(/^section\s+/i, "").trim();
				model.sections.push(section);
				return;
			}
			m = /^(.+?)\s*:\s*(.*?)\s*$/.exec(s);
			if (m) {
				const name = m[1].trim(), parts = m[2].split(",").map((x) => x.trim()).filter(Boolean);
				let flags = [], id = "", start = "", end = "", depends = "", duration = "";
				for (const p of parts) {
					if (/^(done|active|crit|milestone)$/i.test(p)) {
						flags.push(p.toLowerCase());
						continue;
					}
					if (/^after\s+/i.test(p)) {
						if (depends) errors.push(issue(lang, lineNo, s));
						depends = p.replace(/^after\s+/i, "").trim();
						continue;
					}
					if (/^\d+d$/i.test(p)) {
						if (duration) errors.push(issue(lang, lineNo, s));
						duration = p.toLowerCase();
						continue;
					}
					if (Number.isFinite(date(p))) {
						if (!start) start = p;
						else if (!end) end = p;
						else errors.push(issue(lang, lineNo, s));
						continue;
					}
					if (/^\d{4}/.test(p)) {
						errors.push(issue(lang, lineNo, s));
						continue;
					}
					if (!id && /^[\w.-]+$/.test(p)) {
						id = p;
						continue;
					}
					errors.push(issue(lang, lineNo, s));
				}
				if (!start && !depends) errors.push(issue(lang, lineNo, s));
				if (end && date(end) < date(start)) errors.push(issue(lang, lineNo, s));
				if (duration && !start && !depends) errors.push(issue(lang, lineNo, s));
				if (duration && start && !end) {
					end = addDays(start, Number.parseInt(duration, 10));
					if (!end) errors.push(issue(lang, lineNo, s));
				}
				add(lineNo, {
					name,
					id,
					flags,
					start,
					end: end || start,
					milestone: flags.includes("milestone"),
					depends,
					duration
				});
				return;
			}
		} else if (kind === "timeline") {
			if (/^section\s+/i.test(s)) {
				section = s.slice(8).trim();
				model.sections.push(section);
				return;
			}
			if (s.startsWith(":")) {
				if (!model.items.length) errors.push(issue(lang, lineNo, s));
				else model.items.at(-1).events.push(s.slice(1).trim());
				return;
			}
			const m = /^(.+?)\s*:\s*(.+)$/.exec(s);
			if (m) {
				add(lineNo, {
					label: m[1].trim(),
					events: m[2].split(":").map((x) => x.trim()).filter(Boolean)
				});
				return;
			}
		} else if (kind === "journey") {
			if (/^section\s+/i.test(s)) {
				section = s.slice(8).trim();
				model.sections.push(section);
				return;
			}
			const m = /^(.+?)\s*:\s*(\d+)\s*:\s*(.*)$/.exec(s);
			if (m) {
				const score = Number(m[2]);
				if (score < 1 || score > 5) errors.push(issue(lang, lineNo, s));
				else add(lineNo, {
					name: m[1].trim(),
					score,
					actors: m[3].split(",").map((x) => x.trim()).filter(Boolean)
				});
				return;
			}
		} else if (kind === "gitGraph") {
			let m;
			if (m = new RegExp(`^commit(?:\\s+id:\\s*(${qstr}))?(?:\\s+tag:\\s*(${qstr}))?(?:\\s+type:\\s*(NORMAL|REVERSE|HIGHLIGHT))?$`, "i").exec(s)) {
				const id = unquote(m[1]) || `commit-${model.commits.length + 1}`;
				const commit = {
					id,
					tag: unquote(m[2]) || "",
					commitType: (m[3] || "NORMAL").toUpperCase(),
					branch: current,
					parents: [],
					line: lineNo
				};
				const head = model.branches.find((x) => x.name === current)?.head;
				if (head) commit.parents.push(head);
				if (model.commits.some((x) => x.id === id)) errors.push(issue(lang, lineNo, `duplicate commit ${id}`));
				model.commits.push(commit);
				add(lineNo, {
					action: "commit",
					id,
					tag: commit.tag,
					commitType: commit.commitType
				});
				const branch = model.branches.find((x) => x.name === current);
				if (branch) branch.head = id;
				return;
			}
			if (m = /^branch\s+([\w.-]+)$/i.exec(s)) {
				const name = unquote(m[1]), from = current;
				if (model.branches.some((x) => x.name === name)) errors.push(issue(lang, lineNo, s));
				else {
					model.branches.push({
						name,
						head: model.branches.find((x) => x.name === current)?.head || ""
					});
					current = name;
				}
				add(lineNo, {
					action: "branch",
					name,
					from
				});
				return;
			}
			if (m = /^checkout\s+([\w.-]+)$/i.exec(s)) {
				const name = unquote(m[1]);
				if (!model.branches.some((x) => x.name === name)) errors.push(issue(lang, lineNo, s));
				else current = name;
				add(lineNo, {
					action: "checkout",
					name
				});
				return;
			}
			if (m = new RegExp("^merge\\s+([\\w.-]+)(?:\\s+id:\\s*(" + qstr + "))?$", "i").exec(s)) {
				const name = unquote(m[1]), other = model.branches.find((x) => x.name === name), own = model.branches.find((x) => x.name === current);
				if (!other || name === current || !other.head || !own?.head) errors.push(issue(lang, lineNo, s));
				else {
					const id = unquote(m[2]) || `merge-${model.commits.length + 1}`;
					if (model.commits.some((x) => x.id === id)) errors.push(issue(lang, lineNo, `duplicate commit ${id}`));
					else {
						const commit = {
							id,
							tag: "",
							commitType: "NORMAL",
							branch: current,
							parents: [own.head, other.head],
							line: lineNo,
							merge: name
						};
						model.commits.push(commit);
						own.head = id;
						add(lineNo, {
							action: "merge",
							id,
							name,
							parents: commit.parents
						});
					}
				}
				return;
			}
		} else if (kind === "kanban") {
			const indent = raw.match(/^[ ]*/)[0].length;
			if (/\t/.test(raw)) {
				errors.push(issue(lang, lineNo, s));
				return;
			}
			if (indent === 0) {
				const m = /^([\w.-]+)\[([^\]]+)\]$/.exec(s);
				if (!m || model.sections.some((x) => x.id === m[1])) {
					errors.push(issue(lang, lineNo, s));
					return;
				}
				if (!countItem(lineNo)) return;
				model.sections.push({
					id: m[1],
					name: m[2].trim(),
					line: lineNo
				});
				section = m[1];
				indentColumn = null;
				return;
			}
			if (!section) {
				errors.push(issue(lang, lineNo, s));
				return;
			}
			const m = /^([\w.-]+)\[([^\]]+)\]$/.exec(s);
			if (!m || model.items.some((x) => x.id === m[1])) {
				errors.push(issue(lang, lineNo, s));
				return;
			}
			if (indentColumn == null) indentColumn = indent;
			if (indent !== indentColumn) {
				errors.push(issue(lang, lineNo, s));
				return;
			}
			add(lineNo, {
				id: m[1],
				name: m[2].trim()
			});
			return;
		} else if (kind === "packet-beta") {
			const m = /^(\d+)-(\d+)\s*:\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(s);
			if (m) {
				const start = Number(m[1]), end = Number(m[2]);
				if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end > MAX_PACKET_BIT || model.fields.some((f) => start <= f.end && end >= f.start)) errors.push(issue(lang, lineNo, s));
				else if (countItem(lineNo)) model.fields.push({
					start,
					end,
					name: m[3].replace(/\\(.)/g, "$1"),
					line: lineNo
				});
				return;
			}
			if (/^\+\d+\s*:/.test(s)) {
				errors.push(issue(lang, lineNo, s));
				return;
			}
		} else if (kind === "quadrantChart") {
			let m;
			if (m = /^([xy])-axis\s+(.+)$/i.exec(s)) {
				const axis = `${m[1].toLowerCase()}axis`;
				if (model[axis]) errors.push(issue(lang, lineNo, s));
				else {
					const labels = m[2].split(/\s*-->\s*/);
					if (labels.length !== 2 || labels.some((x) => !x.trim())) errors.push(issue(lang, lineNo, s));
					else model[axis] = labels.map((x) => x.trim());
				}
				return;
			}
			if (m = /^quadrant-([1-4])\s+(.+)$/i.exec(s)) {
				const key = `quadrant${m[1]}`;
				if (model[key]) errors.push(issue(lang, lineNo, s));
				else model[key] = m[2].trim();
				return;
			}
			if (m = /^(.+?)\s*:\s*([\d.]+)\s*,\s*([\d.]+)\s*$/.exec(s)) {
				const x = Number(m[2]), y = Number(m[3]);
				if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) errors.push(issue(lang, lineNo, s));
				else add(lineNo, {
					name: m[1].trim(),
					x,
					y
				});
				return;
			}
		}
		errors.push(issue(lang, lineNo, s));
	});
	if (kind === "gantt") {
		const ids = /* @__PURE__ */ new Map(), names = /* @__PURE__ */ new Map();
		for (const task of model.items) {
			if (task.id && ids.has(task.id)) errors.push(issue(lang, task.line, `duplicate task ID ${task.id}`));
			if (task.id) ids.set(task.id, task);
			if (!names.has(task.name)) names.set(task.name, []);
			names.get(task.name).push(task);
		}
		const resolve = (ref) => ids.get(ref) || (names.get(ref)?.length === 1 ? names.get(ref)[0] : void 0), visiting = /* @__PURE__ */ new Set(), done = /* @__PURE__ */ new Set();
		const visit = (task) => {
			if (done.has(task)) return;
			if (visiting.has(task)) {
				errors.push(issue(lang, task.line, `dependency cycle ${task.name}`));
				return;
			}
			visiting.add(task);
			if (task.depends) {
				const prev = resolve(task.depends);
				if (!prev) errors.push(issue(lang, task.line, `after ${task.depends}`));
				else {
					visit(prev);
					if (!task.start && prev.end) task.start = prev.end;
					if (!task.start) errors.push(issue(lang, task.line, `unresolved start ${task.name}`));
					else if (task.duration && !task.end) {
						task.end = addDays(task.start, Number.parseInt(task.duration, 10));
						if (!task.end) errors.push(issue(lang, task.line, task.name));
					}
				}
			}
			if (task.start && !task.end) task.end = task.start;
			if (task.start && task.end && date(task.end) < date(task.start)) errors.push(issue(lang, task.line, task.name));
			visiting.delete(task);
			done.add(task);
		};
		model.items.forEach(visit);
	}
	if (kind === "gitGraph" && !model.commits.length) errors.push(issue(lang, firstLine, "gitGraph needs a commit"));
	if (!model.items.length && !model.fields.length && !(kind === "kanban" && model.sections.length)) errors.push(issue(lang, firstLine, "empty diagram"));
	return {
		model,
		errors
	};
}
var text = (ctx, value, x, y, size = 13, fill = ctx.color("ink"), anchor = "start", weight = 400) => ctx.text(x, y, value, {
	size,
	fill,
	anchor,
	weight,
	"dominant-baseline": "middle"
});
var wrap = (ctx, value, width, size) => ctx.wrap(String(value), Math.max(size, width), size, 400);
function layout(model, { measure, width, ctx, renderOptions }) {
	const inSceneTitle = !renderOptions?.frame && Boolean(model.title);
	const headRow = ["gantt", "journey"].includes(model.type) ? 14 : 0;
	const right = 24, top = renderOptions?.frame ? 54 : (inSceneTitle ? 54 : 24) + headRow, rowH = 54;
	const FLAG = /^en\b/i.test(ctx.lang || "zh") ? {
		done: "done",
		active: "in progress",
		crit: "critical",
		milestone: "milestone"
	} : {
		done: "已完成",
		active: "进行中",
		crit: "关键",
		milestone: "里程碑"
	};
	const flagText = (task) => (task.flags || []).map((flag) => FLAG[flag] || flag).join(" · ");
	const leftLabels = {
		gantt: () => model.items.flatMap((x) => [
			x.name,
			x.section || "",
			flagText(x)
		]),
		journey: () => model.items.flatMap((x) => [x.section || "", x.name]),
		gitGraph: () => model.branches.map((x) => x.name),
		quadrantChart: () => model.yaxis || []
	}[model.type]?.() ?? [];
	const axisLabelWidth = Math.max(0, ...leftLabels.map((s) => measure(s, {
		size: 13,
		weight: 400
	})));
	const left = Math.max(24, axisLabelWidth + 24);
	const minimum = model.type === "timeline" || model.type === "kanban" ? 0 : 300;
	const usable = Math.max(minimum, width - left - right);
	const colors = {
		ink: ctx.color("ink"),
		accent: ctx.color("accent"),
		muted: ctx.color("muted"),
		grid: ctx.color("grid"),
		bg: ctx.color("bg")
	};
	const scene = {
		width: Math.max(width, left + usable + right),
		height: 180,
		title: model.title || model.type,
		description: `Mermaid ${model.type}`,
		children: []
	};
	const el = ctx.el, label = (v, x, y, size = 13, fill = colors.ink, anchor = "start", weight = 400) => scene.children.push(text(ctx, v, x, y, size, fill, anchor, weight));
	const rect = (x, y, w, h, fill = colors.bg, stroke = colors.grid, rx = 4) => scene.children.push(el("rect", {
		x,
		y,
		width: w,
		height: h,
		fill,
		stroke,
		rx
	}));
	const line = (x1, y1, x2, y2, stroke = colors.grid, sw = 1) => scene.children.push(el("line", {
		x1,
		y1,
		x2,
		y2,
		stroke,
		"stroke-width": sw
	}));
	if (inSceneTitle) label(model.title, 22, 24, 17, colors.ink, "start", 650);
	else if (renderOptions?.frame) scene.heading = model.title || void 0;
	if (model.type === "gantt") {
		const headerH = 30, rows = [];
		let section;
		for (const task of model.items) {
			if (task.section && task.section !== section) rows.push({
				header: task.section,
				h: headerH
			});
			section = task.section;
			rows.push({
				task,
				h: rowH
			});
		}
		scene.height = top + rows.reduce((sum, row) => sum + row.h, 0) + 30;
		const items = model.items.filter((x) => x.start), stamps = items.flatMap((x) => [date(x.start), date(x.end)]);
		const first = new Date(Math.min(...stamps));
		first.setUTCDate(1);
		const min = first.getTime(), max = Math.max(...stamps), span = Math.max(864e5, max - min);
		const xdate = (d) => left + (date(d) - min) / span * usable;
		if (items.length) {
			const tick = new Date(min);
			let guard = 0;
			while (tick.getTime() <= max && guard++ < 240) {
				const x = left + (tick.getTime() - min) / span * usable;
				line(x, top - 8, x, scene.height - 18);
				label(`${String(tick.getUTCFullYear()).padStart(4, "0")}-${String(tick.getUTCMonth() + 1).padStart(2, "0")}`, x + 2, top - 18, 12, colors.muted);
				tick.setUTCMonth(tick.getUTCMonth() + 1);
			}
		}
		let y = top;
		for (const row of rows) {
			if (row.header) {
				label(row.header, 12, y + 15, 13, colors.muted, "start", 600);
				y += row.h;
				continue;
			}
			const { task } = row, flags = flagText(task);
			label(task.name, 12, y + (flags ? 8 : 14), 13);
			if (flags) label(flags, 12, y + 26, 12, colors.muted);
			if (task.start) {
				const x = xdate(task.start), x2 = xdate(task.end);
				if (task.milestone) scene.children.push(el("polygon", {
					points: `${x},${y + 5} ${x + 9},${y + 14} ${x},${y + 23} ${x - 9},${y + 14}`,
					fill: colors.accent
				}));
				else rect(x, y + 3, Math.max(4, x2 - x), 22, task.flags.includes("crit") ? colors.accent : colors.ink, "none", 4);
			}
			y += row.h;
		}
	} else if (model.type === "timeline") {
		const n = Math.max(1, model.items.length), columnW = Math.max(180, usable / n), axisY = top + 18;
		const wrapped = model.items.map((item) => ({
			title: wrap(ctx, item.label, columnW - 20, 13),
			events: wrap(ctx, item.events.join(" · "), columnW - 20, 12)
		}));
		const contentH = Math.max(82, ...wrapped.map((x) => x.title.length * 16 + x.events.length * 16 + 28));
		scene.width = Math.max(scene.width, left + n * columnW + right);
		scene.height = top + contentH + 45;
		line(left, axisY, left + n * columnW, axisY, colors.grid, 2);
		model.items.forEach((item, i) => {
			const x = left + (i + .5) * columnW, y = axisY + 18, lines = wrapped[i];
			scene.children.push(el("circle", {
				cx: x,
				cy: axisY,
				r: 5,
				fill: colors.accent
			}));
			if (item.section && item.section !== model.items[i - 1]?.section) label(item.section, x, y, 12, colors.muted, "middle");
			lines.title.forEach((str, j) => label(str, x, y + 20 + j * 16, 13, colors.ink, "middle", 600));
			lines.events.forEach((str, j) => label(str, x, y + 24 + lines.title.length * 16 + j * 16, 12, colors.muted, "middle"));
		});
	} else if (model.type === "journey") {
		const headerH = 30, taskH = 62, rows = [];
		let section;
		for (const item of model.items) {
			if (item.section && item.section !== section) rows.push({
				header: item.section,
				h: headerH
			});
			section = item.section;
			rows.push({
				item,
				h: taskH
			});
		}
		scene.height = top + rows.reduce((sum, row) => sum + row.h, 0) + 12;
		const actorW = Math.max(0, ...model.items.map((x) => measure(x.actors.join(", "), {
			size: 12,
			weight: 400
		}))) + 20;
		const chartW = Math.max(usable, actorW), x0 = left, dx = chartW / 4;
		scene.width = Math.max(scene.width, left + chartW + right);
		for (let score = 1; score <= 5; score++) label(String(score), x0 + (score - 1) * dx, top - 10, 12, colors.muted, "middle");
		let y = top;
		for (const row of rows) {
			if (row.header) {
				label(row.header, 12, y + 15, 13, colors.muted, "start", 600);
				y += row.h;
				continue;
			}
			const { item } = row;
			label(item.name, 12, y + 16, 13);
			line(x0, y + 16, x0 + chartW, y + 16, colors.grid);
			for (let score = 1; score <= 5; score++) scene.children.push(el("circle", {
				cx: x0 + (score - 1) * dx,
				cy: y + 16,
				r: 3 + (score === item.score ? 3 : 0),
				fill: score <= item.score ? colors.accent : colors.bg,
				stroke: colors.accent
			}));
			if (item.actors.length) label(item.actors.join(", "), x0, y + 39, 12, colors.muted);
			y += row.h;
		}
	} else if (model.type === "kanban") {
		const columns = model.sections;
		const headerW = Math.max(0, ...columns.map((x) => measure(x.name, {
			size: 14,
			weight: 650
		}) + 30));
		const columnGap = 10;
		const colW = Math.max(160, (usable + columnGap) / columns.length, headerW);
		scene.width = Math.max(scene.width, left + colW * columns.length - columnGap + right);
		const cardLines = new Map(model.items.map((card) => [card.id, wrap(ctx, card.name, colW - 44, 13)])), rowH = Math.max(52, ...[...cardLines.values()].map((lines) => lines.length * 17 + 30)), maxRows = Math.max(1, ...columns.map((c) => model.items.filter((x) => x.section === c.id).length));
		scene.height = top + 50 + maxRows * rowH;
		columns.forEach((col, i) => {
			const x = left + i * colW;
			rect(x, top, colW - 10, scene.height - top - 20, "transparent", colors.grid, 6);
			label(col.name, x + 10, top + 18, 14, colors.ink, "start", 650);
			model.items.filter((item) => item.section === col.id).forEach((card, row) => {
				const y = top + 38 + row * rowH, lines = cardLines.get(card.id);
				rect(x + 6, y, colW - 22, rowH - 10);
				const first = y + (rowH - 10) / 2 - (lines.length - 1) * 8.5;
				lines.forEach((str, j) => label(str, x + 16, first + j * 17, 13));
			});
		});
	} else if (model.type === "packet-beta") {
		const rows = Math.max(1, ...model.fields.map((f) => Math.floor(f.end / 32) + 1));
		const rowsOfFields = Array.from({ length: rows }, (_item, r) => model.fields.filter((f) => f.start <= r * 32 + 31 && f.end >= r * 32).map((f) => {
			const start = Math.max(f.start, r * 32), end = Math.min(f.end, r * 32 + 31);
			return {
				start,
				end,
				bits: end - start + 1,
				name: f.name
			};
		}));
		const minField = Math.ceil(Math.max(24, ...rowsOfFields.flat().map((f) => measure(String(f.end), {
			size: 12,
			weight: 400
		}) + 12)));
		const pitch = Math.max(usable / 32, ...rowsOfFields.flat().map((f) => minField / f.bits));
		const span = pitch * 32;
		scene.width = Math.max(scene.width, left + span + right);
		let y = top;
		rowsOfFields.forEach((fields, r) => {
			const cells = fields.map((f) => {
				const w = f.bits * pitch;
				return {
					x: left + (f.start - r * 32) * pitch,
					w,
					lines: wrap(ctx, `${f.name} ${f.start}-${f.end}`, w - 12, 12)
				};
			});
			const cellHeight = Math.max(34, ...cells.map((c) => 16 + c.lines.length * 16));
			for (const { x, w, lines } of cells) {
				rect(x, y, w, cellHeight, colors.bg, colors.grid, 0);
				lines.forEach((row, i) => label(row, x + 6, y + 16 + i * 16, 12));
			}
			line(left, y + cellHeight + 2, left + span, y + cellHeight + 2);
			for (const bit of [
				0,
				7,
				15,
				23,
				31
			]) label(String(r * 32 + bit), left + (bit + .5) * pitch, y + cellHeight + 23, 12, colors.muted, "middle");
			y += cellHeight + 48;
		});
		scene.height = y + 25;
	} else if (model.type === "quadrantChart") {
		const x0 = left, y0 = top, h = 270;
		const quadrants = [
			{
				name: model.quadrant1,
				right: true,
				top: true
			},
			{
				name: model.quadrant2,
				right: false,
				top: true
			},
			{
				name: model.quadrant3,
				right: false,
				top: false
			},
			{
				name: model.quadrant4,
				right: true,
				top: false
			}
		];
		const labelWidth = (value) => measure(value, {
			size: 12,
			weight: 400
		});
		const span = Math.max(usable, ...quadrants.filter((q) => q.name).map((q) => 2 * (labelWidth(q.name) + 16)), ...model.items.map((p) => (labelWidth(p.name) + 16) / Math.max(p.x, 1 - p.x)), (model.xaxis || []).reduce((sum, name) => sum + labelWidth(name), 24));
		scene.width = Math.max(scene.width, x0 + span + right);
		scene.height = y0 + h + 62;
		rect(x0, y0, span, h, "transparent", colors.grid, 0);
		line(x0 + span / 2, y0, x0 + span / 2, y0 + h);
		line(x0, y0 + h / 2, x0 + span, y0 + h / 2);
		for (const q of quadrants) if (q.name) label(q.name, q.right ? x0 + span - 8 : x0 + 8, q.top ? y0 + 16 : y0 + h - 16, 12, colors.muted, q.right ? "end" : "start");
		label(model.xaxis?.[0] || "", x0, y0 + h + 20, 12, colors.muted);
		label(model.xaxis?.[1] || "", x0 + span, y0 + h + 20, 12, colors.muted, "end");
		label(model.yaxis?.[0] || "", x0 - 8, y0 + h, 12, colors.muted, "end");
		label(model.yaxis?.[1] || "", x0 - 8, y0, 12, colors.muted, "end");
		model.items.forEach((p) => {
			const x = x0 + p.x * span, y = y0 + (1 - p.y) * h;
			const direction = p.x > .5 ? -1 : 1;
			scene.children.push(el("circle", {
				cx: x,
				cy: y,
				r: 5,
				fill: colors.accent
			}));
			label(p.name, x + direction * 8, y, 12, colors.ink, direction < 0 ? "end" : "start");
		});
	} else if (model.type === "gitGraph") {
		const commits = model.commits, branches = model.branches, lane = /* @__PURE__ */ new Map([["main", 0]]);
		branches.forEach((b) => {
			if (!lane.has(b.name)) lane.set(b.name, lane.size);
		});
		const commitStep = Math.max(90, ...commits.map((c) => measure(c.tag || c.id, {
			size: 12,
			weight: 400
		}) + 24)), maxLane = Math.max(0, lane.size - 1), yFor = (branch) => top + 22 + (lane.get(branch) || 0) * 58, xFor = (id) => left + 70 + commits.findIndex((c) => c.id === id) * commitStep;
		scene.height = top + 22 + maxLane * 58 + 40;
		scene.width = Math.max(scene.width, left + 110 + commits.length * commitStep);
		branches.forEach((b) => {
			const y = yFor(b.name);
			label(b.name, 12, y, 12, colors.muted);
			line(left, y, left + Math.max(usable, commits.length * commitStep), y, colors.grid);
		});
		commits.forEach((c) => c.parents.forEach((parent) => {
			const p = commits.find((x) => x.id === parent);
			if (p) line(xFor(parent), yFor(p.branch), xFor(c.id), yFor(c.branch), colors.accent, 2);
		}));
		commits.forEach((c) => {
			const x = xFor(c.id), y = yFor(c.branch);
			scene.children.push(el("circle", {
				cx: x,
				cy: y,
				r: 8,
				fill: c.commitType === "HIGHLIGHT" ? colors.accent : colors.bg,
				stroke: colors.accent,
				"stroke-width": 2
			}));
			label(c.tag || c.id, x, y + 20, 12, colors.ink, "middle");
		});
	} else scene.height = top + model.items.length * rowH + 30;
	return {
		width: scene.width,
		height: scene.height,
		scene,
		items: model.items,
		errors: []
	};
}
var implementations = Object.fromEntries(kinds.map((kind) => [kind, {
	parse: (body, info) => parse(body, info, kind),
	layout
}]));
export { implementations, time_exports };
