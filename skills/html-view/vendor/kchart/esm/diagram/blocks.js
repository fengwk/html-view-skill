import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { FONT, error, warning } from "./support.js";
import { geometry, has } from "../core/icons.js";
import { EDGE_KINDS, ITEM, STYLES, boardLook, drawCard, drawEdge, drawFrame, drawItem, drawLabel, drawLegend, drawNote, frameTitle, markers, measureCard, measureItem, measureLabel, measureLegend, measureNote, surfaceAt, titleRect } from "./board-paint.js";
import { routeBoard } from "./board-route.js";
// src/diagram/blocks.js
var blocks_exports = /* @__PURE__ */ __exportAll({ implementations: () => implementations });
var LIMITS = {
	depth: 8,
	endpoints: 400,
	items: 1e3,
	edges: 200,
	labelChars: 24,
	desc: 8
};
var GAP = 16;
var PAD = 12;
var ITEM_GAP = ITEM.gap;
var MARGIN = 16;
var HEAD = /^(row|col|grid|box|card|note|legend)(?:\s+(.*))?$/;
var LEGEND_KEYS = [
	...STYLES,
	"default",
	"db",
	...Object.keys(EDGE_KINDS)
];
var ATTR = /\{((?:"[^"\n]*"|[^{}"]|"(?=[^"\n]*\}$))*)\}$/;
var ID = /^[A-Za-z_][A-Za-z0-9_-]*$/;
var RESERVED = /[:：]|->|=>|~>/;
var count = (text) => [...text].length;
function attributes(header, kind, fail) {
	const match = header.match(ATTR), title = (match ? header.slice(0, match.index) : header).trim();
	const attrs = {};
	const allowed = `${STYLES.join(", ")}, ${kind === "box" ? "db, " : "\"tag\", "}#XX, @id`;
	const invalid = (token) => fail(`未知属性或属性位置无效：${token}`, `Unknown or misplaced attribute: ${token}`, `在标题末尾用 {...}，仅使用：${allowed}`, `Use {...} after the title with only: ${allowed}`);
	if (/[{}]/.test(title)) invalid(title);
	for (const token of match?.[1].match(/(?:"[^"]*"|[^,\s"]+)+|"/g) || []) if (STYLES.includes(token)) {
		if (attrs.style) fail("只能使用一种样式", "Only one style is allowed", "保留一个样式词", "Keep one style word");
		else attrs.style = token;
	} else if (token === "db" && kind === "box" && !attrs.db) attrs.db = true;
	else if (token.startsWith("#")) {
		if (attrs.badge || !/^#[0-9A-Za-z.-]{1,4}$/.test(token)) fail("徽章无效或重复", "Invalid or repeated badge", "只写一个 # 加 1–4 个字母、数字、点或连字符", "Use one # followed by 1–4 letters, digits, dots or hyphens");
		else attrs.badge = token.slice(1);
	} else if (token.startsWith("@")) {
		if (attrs.ref || !ID.test(token.slice(1))) fail("引用 ID 无效或重复", "Invalid or repeated reference ID", "只写一个 @id，以字母或下划线开头，后接字母、数字、下划线或连字符", "Use one @id starting with a letter or underscore, followed by letters, digits, underscores or hyphens");
		else attrs.ref = token.slice(1);
	} else if (token.startsWith("\"") && kind === "card") {
		const tag = token.slice(1, -1);
		if (attrs.tag || !/^"[^"\n]+"$/.test(token) || !tag.trim() || count(tag) > 12) fail("标签无效、重复或过长", "Invalid, repeated or overlong tag", "只写一个双引号标签，最多 12 个字符", "Use one double-quoted tag of at most 12 characters");
		else attrs.tag = tag;
	} else invalid(token);
	return {
		title,
		...attrs
	};
}
function parse(source, { lang, options = {}, firstLine = 2 }) {
	const errors = [], nodes = [], edges = [], stack = [], indents = [], endpoints = [], items = [];
	const refs = /* @__PURE__ */ new Map(), titles = /* @__PURE__ */ new Map(), nonEndpoints = /* @__PURE__ */ new Set();
	const at = (line) => (zh, en, fixZh, fixEn) => errors.push(error(lang, line, zh, en, fixZh, fixEn));
	const split = (fail, zh, en) => fail(zh, en, "拆成两张图", "Split into two diagrams");
	for (const key of Object.keys(options)) at(firstLine - 1)(`blocks 不支持选项「${key}」`, `Unsupported blocks option: ${key}`, "删除这个选项", "Remove this option");
	for (const [i, raw] of String(source).split("\n").entries()) {
		if (!raw.trim() || raw.trimStart().startsWith("%%")) continue;
		const line = firstLine + i, fail = at(line);
		if (/^ *\t/.test(raw)) {
			fail("缩进不能使用 Tab", "Tabs are not allowed in indentation", "把 Tab 换成空格", "Replace tabs with spaces");
			continue;
		}
		const indent = raw.match(/^ */)[0].length, text = raw.trim();
		while (stack.length && indent <= stack.at(-1).indent) stack.pop();
		const parent = stack.at(-1);
		if (parent?.kind === "card") {
			parent.desc.push(text);
			if (parent.desc.length === LIMITS.desc + 1) fail("卡片描述最多 8 行", "At most 8 card description lines", "合并描述行或拆成两张卡片", "Combine description lines or split into two cards");
			continue;
		}
		if (parent?.kind === "legend") {
			const entry = text.match(/^([^:：]+)[:：]\s*(.+)$/), key = entry?.[1].trim();
			if (!entry || !LEGEND_KEYS.includes(key)) fail("图例键无效或缺少说明", "Unknown legend key or missing meaning", `使用「键: 说明」；键为 ${LEGEND_KEYS.join(", ")}`, `Use "key: meaning" with one of ${LEGEND_KEYS.join(", ")}`);
			else if (parent.entries.some((item) => item.key === key)) fail(`图例键「${key}」重复`, `Repeated legend key: ${key}`, "合并同一个键的说明", "Combine the meanings for this key");
			else parent.entries.push({
				key,
				label: entry[2]
			});
			continue;
		}
		let head = text.match(HEAD);
		if (parent?.kind === "box" && head && (/^(card|note)$/.test(text) || head[1] === "legend" && head[2])) head = null;
		const edge = text.match(/^(.+?)\s*(->|=>|~>)\s*(.+?)(?:\s*[:：]\s*(.*))?$/);
		if (edge && !head && (!parent || parent.kind !== "box" || parent.inline)) {
			if (indent) fail("关系必须写在顶格", "Relations must start at column 0", "去掉这一行的缩进", "Remove the indentation from this relation");
			const label = (edge[4] || "").trim();
			if (count(label) > LIMITS.labelChars) fail("关系标签过长", "Relation label is too long", "把标签缩到 24 个字符以内", "Keep the label within 24 characters");
			edges.push({
				id: `edge-${edges.length}`,
				ends: [edge[1].trim(), edge[3].trim()],
				kind: EDGE_KINDS[edge[2]],
				label,
				line
			});
			if (edges.length === LIMITS.edges + 1) split(fail, "关系最多 200 条", "At most 200 relations");
			continue;
		}
		if (parent?.kind === "note") {
			fail("note 不能有子条目", "Notes cannot have children", "将这一行退回到与 note 同级", "Move this line to the same indentation as the note");
			continue;
		}
		const addItems = (box, value) => {
			if (box.children.length) fail("box 不能混用能力项和结构行", "A box cannot mix capabilities and structure lines", "将能力项移到单独的 box", "Move capabilities to their own box");
			for (const part of value.split(/[,，]/)) {
				const raw = part.trim(), icon = raw.match(/^\[icon:([a-z0-9][\w.-]*)\]\s*/i), value = icon ? raw.slice(icon[0].length) : raw;
				const mark = value.match(/^([+~=])\s*/)?.[1] || "", name = value.replace(/^[+~=]\s*/, "").trim();
				if (!name) {
					fail("能力项名称不能为空", "Capability labels cannot be empty", "删除空项或补上名称", "Remove the empty item or add a label");
					continue;
				}
				if (icon ? !has(icon[1]) : /\[icon:/.test(raw)) fail("未知图标或图标写法无效", "Unknown icon or invalid icon syntax", "写成 [icon:database] 名称", "Use a valid icon, e.g. [icon:database] name");
				const item = {
					name,
					label: mark ? `${mark} ${name}` : name,
					mark,
					tone: {
						"+": "new",
						"~": "info",
						"=": "ok"
					}[mark],
					icon: icon?.[1],
					line
				};
				box.items.push(item);
				items.push(item);
				nonEndpoints.add(name);
				nonEndpoints.add(item.label);
				if (items.length === LIMITS.items + 1) split(fail, "能力项最多 1000 个", "At most 1000 capabilities");
			}
		};
		if (!head && parent?.kind === "box" && !parent.inline) {
			addItems(parent, text);
			continue;
		}
		if (!head) {
			if (parent) fail("能力项只能写在 box 内", "Capabilities belong inside a box", "把这一行改成 box，或移入 box", "Change this line into a box or move it inside a box");
			else fail("无法识别这一行", "Unrecognized line", "使用结构关键字，或写成「A -> B」", "Use a structure keyword or write a relation as \"A -> B\"");
			continue;
		}
		const depth = stack.length;
		if (depth >= LIMITS.depth) {
			split(fail, "嵌套超过 8 层", "Nesting exceeds 8 levels");
			continue;
		}
		indents[depth] ??= indent;
		if (indents[depth] !== indent) {
			fail("同级条目的缩进不一致", "Inconsistent indentation at the same level", `把这一行缩进改为 ${indents[depth]} 个空格`, `Indent this line with ${indents[depth]} spaces`);
			continue;
		}
		const kind = head[1];
		let body = head[2] || "";
		const node = {
			kind,
			line,
			indent,
			parent,
			weight: 1,
			children: [],
			items: []
		};
		if (parent?.items.length) fail("box 不能混用能力项和结构行", "A box cannot mix capabilities and structure lines", "将子结构移到单独的 box", "Move the child structures to a separate box");
		if (kind === "row" || kind === "col" || kind === "box") {
			const weight = body.match(kind === "box" ? /^(\d+(?:\.\d+)?)\s+(?![:：\s])/ : /^\d+(?:\.\d+)?$/);
			if (weight) {
				const number = Number(weight[0]);
				if (number > 0 && Number.isFinite(number)) {
					node.weight = number;
					node.explicit = true;
				} else if (kind !== "box" || !Number.isFinite(number)) fail("权重必须是有限正数", "Weight must be finite and positive", "使用较小的正数，例如 3", "Use a small positive number such as 3");
				body = body.slice(weight[0].length);
			} else if (kind !== "box" && body) fail(`${kind} 后面只能写权重`, `Only a weight may follow ${kind}`, "删除多余文字，或写成正数", "Remove the extra text or use a positive number");
		}
		if (kind === "box" || kind === "card") {
			const colon = kind === "box" ? body.match(/^(?:\{[^}]*\}|[^:：\{])*([:：])/)?.[0].length : null;
			Object.assign(node, attributes(colon ? body.slice(0, colon - 1).trim() : body, kind, fail));
			if (!node.title) fail("标题不能为空", "Title cannot be empty", "在关键字后补上标题", "Add a title after the keyword");
			node.id = node.ref || `#${endpoints.length + 1}`;
			endpoints.push(node);
			if (endpoints.length === LIMITS.endpoints + 1) split(fail, "容器和卡片合计最多 400 个", "At most 400 boxes and cards combined");
			if (node.ref) {
				if (refs.has(node.ref)) fail(`引用 ID @${node.ref} 重复`, `Duplicate reference ID @${node.ref}`, "换一个未使用的 @id", "Use a different, unused @id");
				else refs.set(node.ref, node);
			}
			if (!titles.has(node.title)) titles.set(node.title, []);
			titles.get(node.title).push(node);
			if (kind === "card") node.desc = [];
			else if (colon && body.slice(colon).trim()) {
				node.inline = true;
				addItems(node, body.slice(colon));
			}
		} else if (kind === "grid") {
			node.cols = Number(body);
			if (!/^\d+$/.test(body) || node.cols < 1 || node.cols > 12) fail("grid 列数必须在 1–12 之间", "Grid column count must be between 1 and 12", "写成 grid 1 到 grid 12", "Use grid 1 through grid 12");
		} else if (kind === "note") {
			node.text = body;
			nonEndpoints.add(body);
			if (!body) fail("note 缺少正文", "Note text is missing", "在 note 后写上正文", "Add text after note");
		} else if (kind === "legend") {
			node.entries = [];
			if (body) fail("legend 说明必须缩进另写", "Legend entries must be on indented lines", "将说明移到下一行并缩进", "Move the entry to its own indented line");
		}
		(parent ? parent.children : nodes).push(node);
		stack.push(node);
	}
	for (const edge of edges) {
		const fail = at(edge.line);
		[edge.from, edge.to] = edge.ends.map((end) => {
			const named = refs.get(end.replace(/^@/, ""));
			if (named) return named;
			const matches = !RESERVED.test(end) ? titles.get(end) : null;
			if (matches?.length === 1) return matches[0];
			if (nonEndpoints.has(end) && !matches?.length) fail(`关系不能指向注释或能力项「${end}」`, `Relations cannot target a note or capability: ${end}`, "改为所属 box 或 card 的名称", "Use the containing box or a card as the endpoint");
			else fail(matches?.length ? `关系端点「${end}」不唯一` : `关系端点「${end}」不存在`, matches?.length ? `Ambiguous relation endpoint: ${end}` : `Unknown relation endpoint: ${end}`, "给目标加 {@id}，并在关系中使用该 id", "Add {@id} to the one you mean and use that id in the relation");
			return null;
		});
		if (edge.from && edge.from === edge.to) fail("关系不能指向自身", "A relation cannot target itself", "选择不同的端点或删除该关系", "Choose a different endpoint or remove the relation");
	}
	if (!nodes.length) at(firstLine)("图中没有结构", "Diagram has no structure", "添加 box 或 card", "Add a box or card");
	return {
		model: {
			nodes,
			endpoints,
			edges,
			items
		},
		errors
	};
}
var sum = (values) => values.reduce((a, b) => a + b, 0);
var lexLess = (a, b) => {
	const i = a.findIndex((v, i) => v !== b[i]);
	return i >= 0 && a[i] < b[i];
};
var offsets = (sizes, gaps) => {
	let next = 0;
	return sizes.map((size, i) => {
		const at = next;
		next += size + (gaps[i] || 0);
		return at;
	});
};
function distribute(mins, weights, space) {
	const extra = Math.max(0, space - sum(mins)), scale = Math.max(...weights) || 1;
	const scaled = weights.map((w) => w / scale), total = sum(scaled);
	const out = mins.map((min, i) => min + Math.floor(extra * scaled[i] / total));
	let rest = space - sum(out);
	for (let i = 0; rest >= 1; i = (i + 1) % out.length) if (weights[i]) {
		out[i]++;
		rest--;
	}
	return out;
}
function itemGrid(items, cell, width) {
	let best;
	for (let cols = 1; cols <= items.length; cols++) {
		const cw = Math.floor((width - ITEM_GAP * (cols - 1)) / cols);
		if (cw < cell && cols > 1) break;
		const rows = Math.ceil(items.length / cols);
		const score = [
			+(cw > 260),
			rows * cols - items.length,
			Math.abs(cols - rows),
			rows
		];
		if (!best || lexLess(score, best.score)) best = {
			cols,
			rows,
			cw: Math.max(cw, cell),
			score
		};
	}
	return best;
}
var pathTo = (node) => node ? [...pathTo(node.parent), node] : [];
var slot = (node, child, axis) => {
	const i = node.children.indexOf(child);
	return node.kind === "grid" ? axis === "x" ? i % node.cols : Math.floor(i / node.cols) : node.kind === "col" === (axis === "y") ? i : 0;
};
function corridors(root, edges) {
	const plans = /* @__PURE__ */ new Map();
	const plan = (node) => {
		if (!plans.has(node)) plans.set(node, {
			x: /* @__PURE__ */ new Map(),
			y: /* @__PURE__ */ new Map(),
			inner: []
		});
		return plans.get(node);
	};
	for (const edge of edges) {
		const a = pathTo(edge.from), b = pathTo(edge.to);
		if (root !== a[0]) {
			a.unshift(root);
			b.unshift(root);
		}
		let i = 0;
		while (a[i] && a[i] === b[i]) i++;
		const split = a[i - 1];
		if (a[i] && b[i]) for (const axis of ["x", "y"]) {
			const start = slot(split, a[i], axis), end = slot(split, b[i], axis);
			const lanes = plan(split)[axis];
			for (let j = Math.min(start, end); j < Math.max(start, end); j++) {
				if (!lanes.has(j)) lanes.set(j, []);
				lanes.get(j).push(edge);
			}
		}
		else if (split.kind === "box") plan(split).inner.push(edge);
		for (const node of [...a.slice(i, -1), ...b.slice(i, -1)]) if (node.kind === "box") plan(node).inner.push(edge);
	}
	return plans;
}
function layout(model, { width, lang, measure }) {
	const errors = [], root = model.nodes.length === 1 ? model.nodes[0] : {
		kind: "col",
		children: model.nodes,
		items: []
	};
	const metrics = /* @__PURE__ */ new Map();
	const short = (node, zh, en) => errors.push(error(lang, node.line, zh, en, "缩短文字，把说明移到图注", "Shorten the text and move details to the caption"));
	for (const node of model.endpoints) {
		const data = node.kind === "card" ? measureCard(node, measure) : frameTitle(node, measure);
		if (node.kind === "card" ? data.titleLines.length > 2 : data.lines.length > 3) short(node, node.kind === "card" ? "卡片标题最多换行成 2 行" : "容器标题最多换行成 3 行", node.kind === "card" ? "Card titles may wrap to at most 2 lines" : "Box titles may wrap to at most 3 lines");
		metrics.set(node, data);
	}
	for (const item of model.items) if (count(item.name) > 24 || measure(item.name, FONT.body) > 312) short(item, `能力项「${item.label}」过长`, `Capability label is too long: ${item.label}`);
	const edges = model.edges.map((edge) => {
		const label = measureLabel(edge.label, measure);
		if (label?.lines.length > 2) short(edge, "关系标签最多换行成 2 行", "Relation labels may wrap to at most 2 lines");
		return {
			...edge,
			label
		};
	});
	if (errors.length) return {
		width,
		height: 0,
		errors
	};
	const plans = corridors(root, edges);
	let result, routed, naturalWidth;
	for (let pass = 0; pass < (edges.length ? 3 : 1); pass++) {
		const sizes = /* @__PURE__ */ new Map();
		const gaps = (node, axis, n) => Array.from({ length: n - 1 }, (_, i) => {
			const lanes = plans.get(node)?.[axis].get(i) || [];
			return lanes.length ? Math.max(28, 16 + 12 * lanes.length, ...lanes.map((e) => e.label ? 24 + (axis === "x" ? e.label.w : e.label.h) : 0)) + pass * 16 : GAP;
		});
		function size(node) {
			const { kind, children, items } = node, data = metrics.get(node);
			let plan;
			if (kind === "card") plan = { w: data.w };
			else if (kind === "note") plan = { w: Math.max(24, measureNote(node.text, measure).w) };
			else if (kind === "legend") plan = { w: Math.max(52, measureLegend(node.entries, measure, 240).w) };
			else {
				const grid = kind === "grid", vertical = kind === "col", columns = grid ? node.cols : vertical ? 1 : Math.max(1, children.length);
				const rows = vertical ? Math.max(1, children.length) : Math.max(1, Math.ceil(children.length / columns));
				const gx = gaps(node, "x", columns), gy = gaps(node, "y", rows);
				const mins = Array(columns).fill(0);
				children.forEach((child, i) => {
					const col = i % columns;
					mins[col] = Math.max(mins[col], size(child).w);
				});
				const bare = (child) => child.kind === "box" && !child.children.length && !child.items.length;
				const explicit = children.some((child) => child.explicit);
				if (grid) mins.fill(Math.max(24, ...mins));
				else if (!vertical && !explicit) {
					const groups = /* @__PURE__ */ new Map();
					children.forEach((child, i) => {
						if (child.items.length) groups.set(child.items.length, Math.max(groups.get(child.items.length) || 0, mins[i]));
					});
					children.forEach((child, i) => {
						if (child.items.length) mins[i] = groups.get(child.items.length);
					});
				}
				const weights = grid || vertical ? mins.map(() => 1) : children.map((child, i) => explicit ? child.weight : bare(child) ? 0 : Math.max(72, mins[i]));
				if (weights.every((w) => !w)) weights.fill(1);
				const inner = plans.get(node)?.inner.length || 0;
				const pad = kind === "box" ? Math.max(PAD, inner ? 16 + Math.min(inner, 4) * 6 + pass * 12 : 0) : 0;
				const top = kind === "box" ? Math.max(36, data.band) + pad - PAD : 0;
				const cell = items.length ? Math.max(...items.map((item) => measureItem(item, measure))) : 0;
				plan = {
					w: Math.max(kind === "box" ? 48 : 72, data?.minW || 0, 2 * pad + Math.max(cell, sum(mins) + sum(gx))),
					pad,
					top,
					cell,
					columns,
					gx,
					gy,
					mins,
					weights
				};
			}
			sizes.set(node, plan);
			return plan;
		}
		const rim = MARGIN + pass * 16;
		const minimum = size(root).w + rim * 2;
		naturalWidth ??= minimum;
		const canvas = Math.max(Math.floor(width), minimum);
		function compose(node, w) {
			const plan = sizes.get(node), { kind } = node;
			if (kind === "card" || kind === "note" || kind === "legend") {
				const paint = kind === "card" ? metrics.get(node) : kind === "note" ? measureNote(node.text, measure, w) : measureLegend(node.entries, measure, w);
				return {
					node,
					w,
					h: paint.h,
					paint,
					plan
				};
			}
			const { pad, top, columns, mins, weights, gx, gy, cell } = plan;
			const inner = w - 2 * pad;
			if (node.items.length) {
				const grid = itemGrid(node.items, cell, inner);
				return {
					node,
					w,
					h: top + grid.rows * ITEM.h + (grid.rows - 1) * ITEM_GAP + pad,
					grid,
					plan
				};
			}
			const cols = !node.children.length ? [] : kind === "grid" ? mins.map(() => Math.floor((inner - sum(gx)) / columns)) : distribute(mins, weights, inner - sum(gx));
			const children = node.children.map((child, i) => compose(child, cols[i % columns]));
			const rows = Array(gy.length + 1).fill(0);
			children.forEach((child, i) => {
				const row = Math.floor(i / columns);
				rows[row] = Math.max(rows[row], child.h);
			});
			return {
				node,
				w,
				h: Math.max(kind === "box" ? 48 : 0, top + sum(rows) + sum(gy) + pad),
				cols,
				rows,
				children,
				plan
			};
		}
		const frames = [], cards = [], notes = [], legends = [], nodes = [];
		function place(tree, x, y, h, parent) {
			const { node, w, plan, paint, grid, children, cols, rows } = tree;
			const { kind, id, style, db, badge, tag } = node;
			const rect = {
				x,
				y,
				w,
				h
			};
			if (kind === "card") {
				cards.push({
					...paint,
					...rect,
					id,
					style,
					badge,
					tag,
					parent: parent?.id
				});
				return;
			}
			if (kind === "note" || kind === "legend") {
				(kind === "note" ? notes : legends).push({
					...rect,
					...paint
				});
				return;
			}
			if (kind === "box") {
				const title = metrics.get(node);
				const frame = {
					...rect,
					id,
					name: node.title,
					style,
					db,
					badge,
					title,
					parent: parent?.id
				};
				frame.titleRect = titleRect(frame, title);
				frames.push(frame);
				parent = frame;
			}
			const { pad, top, gx, gy, columns } = plan;
			if (grid) {
				const left = x + Math.floor((w - grid.cw * grid.cols - ITEM_GAP * (grid.cols - 1)) / 2);
				node.items.forEach((item, i) => nodes.push({
					...item,
					parent,
					id: `${id}/item-${i}`,
					x: left + i % grid.cols * (grid.cw + ITEM_GAP),
					y: y + top + Math.floor(i / grid.cols) * (ITEM.h + ITEM_GAP),
					w: grid.cw,
					h: ITEM.h
				}));
			} else if (children.length) {
				const heights = distribute(rows, rows.map(() => 1), h - top - pad - sum(gy));
				const xs = offsets(cols, gx), ys = offsets(heights, gy);
				const mixed = new Set(children.filter((child) => child.node.kind !== "card").map((child) => Math.floor(children.indexOf(child) / columns)));
				children.forEach((child, i) => {
					const c = i % columns, r = Math.floor(i / columns);
					const own = kind !== "col" && child.node.kind === "card" && mixed.has(r);
					place(child, x + pad + xs[c], y + top + ys[r] + (own ? (heights[r] - child.h) / 2 : 0), own ? child.h : heights[r], parent);
				});
			}
		}
		const tree = compose(root, canvas - 2 * rim);
		place(tree, rim, rim, tree.h, void 0);
		result = {
			width: canvas,
			height: tree.h + 2 * rim,
			frames,
			cards,
			notes,
			legends,
			nodes
		};
		routed = routeBoard({
			...result,
			nodes: [...cards, ...nodes.map((n) => ({
				...n,
				parent: n.parent.id
			}))],
			blockers: [...notes, ...legends],
			edges: edges.map((edge) => ({
				id: edge.id,
				from: edge.from.id,
				to: edge.to.id,
				label: edge.label
			}))
		});
		if (!routed.failed.length && routed.edges.every((route) => !route.labelRect || labelFits(route.labelRect, result))) break;
	}
	const byId = new Map(routed.edges.map((edge) => [edge.id, edge]));
	const placed = [];
	for (const edge of edges) {
		const route = byId.get(edge.id);
		if (!route || edge.label && !labelFits(route.labelRect, result)) errors.push(error(lang, edge.line, `关系「${edge.ends.join(" → ")}」没有可用通道`, `No clear route for "${edge.ends.join(" → ")}"`, "减少共享同一通道的关系，或调整 row、col、grid 的组合", "Reduce relations sharing the corridor or adjust the row, col or grid composition"));
		else placed.push({
			...route,
			from: edge.from.id,
			to: edge.to.id,
			kind: edge.kind,
			labelLines: edge.label?.lines
		});
	}
	if (model.endpoints.length > 60 || naturalWidth > width * 2) errors.push(warning("LARGE_DIAGRAM", lang, model.nodes[0].line, "图较大，可滚动查看", "Large board; scroll to view it", "可拆成总图和分图", "Consider splitting into an overview and detail boards"));
	return {
		...result,
		edges: placed,
		errors
	};
}
function labelFits(rect, { width, height }) {
	return rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= width && rect.y + rect.h <= height;
}
function scene(g, ctx) {
	const styles = [...g.cards, ...g.frames].map((box) => box.style).concat(g.nodes.map((node) => node.tone), g.legends.flatMap((legend) => legend.rows.flat().map((item) => item.key)));
	const look = boardLook(ctx, styles), marks = markers(ctx);
	const under = ({ x, y, w = 2, h = 2 }) => surfaceAt(g.frames, look, x + w / 2, y + h / 2);
	const capabilities = g.nodes.map((node) => ({
		...drawItem(ctx, {
			...node,
			icon: node.icon ? geometry(node.icon) : null,
			under: under(node)
		}, look),
		meta: {
			kind: "capability",
			label: node.name,
			container: node.parent.name,
			...node.mark ? { mark: node.mark } : {}
		}
	}));
	const paths = [], labels = [];
	for (const edge of g.edges) {
		const stroke = look.edge(edge.kind);
		paths.push(drawEdge(ctx, edge, stroke, { end: marks.url("arrow", stroke.stroke) }));
		if (edge.labelLines) {
			const rect = edge.labelRect;
			labels.push(drawLabel(ctx, {
				from: edge.from,
				to: edge.to,
				rect,
				lines: edge.labelLines,
				plate: surfaceAt(g.frames, look, rect.x + rect.w / 2, rect.y + rect.h / 2)
			}, look));
		}
	}
	const legends = g.legends.map((legend) => drawLegend(ctx, legend, look, marks, under({
		x: legend.x,
		y: legend.y
	})));
	return {
		width: g.width,
		height: g.height,
		children: [
			...marks.defs(),
			...g.frames.map((frame) => drawFrame(ctx, frame, look)),
			...capabilities,
			...g.cards.map((card) => drawCard(ctx, {
				...card,
				under: under(card)
			}, look)),
			...g.notes.map((note) => drawNote(ctx, note, look)),
			...legends,
			...paths,
			...labels
		]
	};
}
var implementations = { blocks: {
	parse,
	layout,
	scene
} };
export { blocks_exports, implementations };
