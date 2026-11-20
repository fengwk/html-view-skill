import { __exportAll } from "../_virtual/_rolldown/runtime.js";
import { FONT, appearance, error, labelText, maxWidthOf, textBlock, warning, wrapText } from "./support.js";
// src/diagram/block.js
var block_exports = /* @__PURE__ */ __exportAll({ implementations: () => implementations });
var GAP = 20;
var PAD = 12;
var MARGIN = 24;
var shapes = [
	[
		"(((",
		")))",
		"doublecircle"
	],
	[
		"((",
		"))",
		"circle"
	],
	[
		"([",
		"])",
		"stadium"
	],
	[
		"(",
		")",
		"round"
	],
	[
		"[[",
		"]]",
		"subroutine"
	],
	[
		"[(",
		")]",
		"cylinder"
	],
	[
		"[/",
		"/]",
		"leanRight"
	],
	[
		"[\\",
		"\\]",
		"leanLeft"
	],
	[
		"[/",
		"\\]",
		"trapezoid"
	],
	[
		"[\\",
		"/]",
		"inverseTrapezoid"
	],
	[
		"[",
		"]",
		"square"
	],
	[
		"{{",
		"}}",
		"hexagon"
	],
	[
		"{",
		"}",
		"diamond"
	],
	[
		">",
		"]",
		"notch"
	],
	[
		"<[",
		"]>",
		"arrow"
	]
];
var link = /^(?:[xo<]?(?:--+[-xo>]|==+[=xo>]|-?\.+-[xo>]?)|~{3,}|==|<--)/;
var arrowTypes = {
	">": "point",
	"<": "point",
	o: "circle",
	x: "cross"
};
var directions = /* @__PURE__ */ new Set([
	"left",
	"right",
	"up",
	"down",
	"x",
	"y"
]);
function parse(body, { lang, firstLine = 2, params = "", header = "block" }) {
	const root = { children: [] }, stack = [root], nodes = /* @__PURE__ */ new Map(), edges = [], errors = [];
	let anonymous = 0, reserved = 0, line = firstLine, column = 1;
	const bad = (zh, en) => errors.push(error(lang, line, zh, en, "检查 block 语法或拆分图", "Check block syntax or split the diagram", column));
	if (body.length + params.length > 2e5) {
		bad("块图源码过长", "Block source is too long");
		return {
			model: null,
			errors
		};
	}
	for (const [i, raw] of [params, ...body.split("\n")].entries()) {
		line = firstLine + i - 1;
		let rest = raw;
		const take = (n) => {
			rest = rest.slice(n);
		};
		const ws = () => take(rest.match(/^\s*/)[0].length);
		const readSpan = () => {
			const m = /^:(\d+)/.exec(rest);
			if (m) take(m[0].length);
			return m ? Number(m[1]) : 1;
		};
		const readNode = () => {
			const m = /^(?![-.])[^()[\]{}<>:=;"\s~]+?(?=$|[()[\]{}<>:=;"\s~]|--|-?\.+-|%%)/.exec(rest);
			if (!m) return null;
			const id = m[0];
			take(id.length);
			const node = {
				id,
				line
			};
			const open = shapes.find(([start]) => rest.startsWith(start))?.[0];
			if (open) {
				take(open.length);
				const quoted = /^\s*"([^"]*)"\s*/.exec(rest);
				let shape;
				if (quoted) {
					take(quoted[0].length);
					shape = shapes.find(([start, end]) => start === open && rest.startsWith(end));
					if (!shape) {
						const close = /^(?:\)\)\)|\)\)|\)\]|\]\)|\]\]|\}\}|[)\]}])/.exec(rest);
						if (close) shape = [
							open,
							close[0],
							"square"
						];
					}
					node.label = labelText(quoted[1]);
				} else {
					shape = shapes.find(([start, end]) => start === open && rest.includes(end));
					if (shape) {
						const end = rest.indexOf(shape[1]);
						node.label = labelText(rest.slice(0, end).trim());
						take(end);
					}
				}
				if (!shape) return null;
				take(shape[1].length);
				node.shape = shape[2];
				if (node.shape === "arrow") {
					const dirs = /^\s*\(([^)]*)\)/.exec(rest);
					node.directions = dirs?.[1].split(/[\s,]+/).filter(Boolean);
					if (!node.directions?.length || node.directions.some((d) => !directions.has(d))) return null;
					take(dirs[0].length);
				}
			}
			node.span = readSpan();
			return node.span > 0 && node.span <= 2e3 ? node : null;
		};
		const insert = (node, group) => {
			const old = nodes.get(node.id);
			if (old) {
				if (node.label !== void 0 && !old.children) Object.assign(old, {
					label: node.label,
					shape: node.shape,
					directions: node.directions
				});
			} else {
				nodes.set(node.id, node);
				group.children.push(node);
			}
		};
		while (rest) {
			ws();
			column = raw.length - rest.length + 1 + (i === 0 ? Math.max(0, header.indexOf(params)) : 0);
			if (!rest || /^%%(?!\{)/.test(rest)) break;
			if (rest[0] === ";") {
				take(1);
				continue;
			}
			const group = stack.at(-1);
			const cols = /^columns\s+(auto|\d+)(?=\s|;|$)/.exec(rest);
			const space = /^space(?=[:;\s]|$)/.exec(rest);
			const begin = /^block(?:-beta)?(?=[:;\s]|$)/.exec(rest);
			const end = /^end(?=[;\s]|$)/.exec(rest);
			if (cols) {
				take(cols[0].length);
				const count = cols[1] === "auto" ? 0 : Number(cols[1]);
				if (count > 2e3 || count === 0 && cols[1] !== "auto") {
					bad("无效的列数", "Invalid column count");
					break;
				}
				group.columns = count;
			} else if (space) {
				take(space[0].length);
				const span = readSpan();
				if (span > 2e3) {
					bad("占位过宽", "Space span is too large");
					break;
				}
				reserved += span;
				if (reserved > 2e4) {
					bad("占位单元格过多", "Too many space cells");
					return {
						model: null,
						errors
					};
				}
				group.children.push({
					space: true,
					span
				});
			} else if (begin) {
				take(begin[0].length);
				const named = rest[0] === ":" && !/^:\d/.test(rest);
				if (named) take(1);
				const node = named ? readNode() : {
					id: `:block${++anonymous}`,
					line,
					span: readSpan()
				};
				if (!node || !node.span || node.span > 2e3 || stack.length > 32 || nodes.has(node.id)) {
					bad("无效、重复或嵌套过深的复合块", "Invalid, duplicate or excessively nested composite block");
					break;
				}
				node.children = [];
				insert(node, group);
				stack.push(node);
			} else if (end) {
				take(end[0].length);
				if (stack.length === 1) {
					bad("end 没有对应的 block", "No matching block for end");
					break;
				}
				stack.pop();
			} else if (/^(?:classDef|class|style|linkStyle|interpolate|click|href|callback)\s|^%%\{|:::/i.test(rest.replace(/"[^"]*"/g, ""))) {
				bad("暂不支持块图样式、指令或交互", "Block styling, directives and interactions are not supported yet");
				break;
			} else {
				let from = readNode();
				if (!from) {
					bad("无法识别块图语句", "Unrecognized block statement");
					break;
				}
				insert(from, group);
				ws();
				while (rest) {
					const labeled = /^([xo<]?(?:--|==|-\.))\s*"([^"]*)"\s*/.exec(rest);
					const op = link.exec(labeled ? rest.slice(labeled[0].length) : rest);
					if (!op) break;
					take((labeled?.[0].length ?? 0) + op[0].length);
					ws();
					const to = readNode();
					if (!to) {
						bad("连线缺少终点", "Missing edge endpoint");
						break;
					}
					insert(to, group);
					const symbol = op[0];
					const legacyLabel = !labeled && /^\s+:\s+(.+)$/.exec(rest);
					if (legacyLabel) take(legacyLabel[0].length);
					edges.push({
						from: from.id,
						to: to.id,
						line,
						label: labelText(labeled?.[2] ?? legacyLabel?.[1] ?? ""),
						arrowStart: arrowTypes[symbol[0]],
						arrowEnd: arrowTypes[symbol.at(-1)],
						thickness: symbol.includes("==") ? 2.5 : 1.5,
						pattern: symbol.includes(".-") ? "dotted" : "solid"
					});
					if (nodes.size > 2e3 || edges.length > 500) {
						bad("块或连线过多", "Too many blocks or edges");
						return {
							model: null,
							errors
						};
					}
					from = to;
					ws();
				}
			}
			if (nodes.size > 2e3) {
				bad("块过多", "Too many blocks");
				return {
					model: null,
					errors
				};
			}
		}
	}
	if (stack.length > 1) {
		line = stack.at(-1).line;
		column = 1;
		bad("复合块缺少 end", "Composite block is missing end");
	}
	if (!nodes.size && !root.children.length && !errors.length) {
		line = firstLine - 1;
		column = 1;
		bad("块图为空", "Empty block diagram");
	}
	return {
		model: {
			root,
			edges,
			nodeCount: nodes.size
		},
		errors
	};
}
function grid(group, measure) {
	const rows = [], columns = group.columns || Infinity;
	let col = 0, occupied = 0, unit = 72, row;
	const currentRow = () => row ??= {
		h: 36,
		cells: []
	};
	const advance = (span) => {
		col += span;
		occupied = Math.max(occupied, col);
		if (col >= columns) {
			rows.push(row);
			row = void 0;
			col = 0;
		}
	};
	for (const node of group.children) {
		if (node.space) {
			for (let left = node.span; left > 0;) {
				currentRow();
				const step = Math.min(left, columns - col);
				advance(step);
				left -= step;
			}
			continue;
		}
		const inner = node.children ? grid(node, measure) : null;
		const font = inner ? FONT.title : FONT.body;
		const label = node.label ?? (inner ? "" : node.id);
		const lines = label.trim() ? wrapText(label, 176, font, measure) : [];
		const textW = maxWidthOf(lines, font, measure), textH = lines.length * 18;
		const title = inner && lines.length ? textH + 4 : 0;
		let w = textW + 28, h = textH + 20;
		const compact = !inner && [
			"diamond",
			"circle",
			"doublecircle"
		].includes(node.shape);
		if (compact) w = h = Math.ceil(node.shape === "diamond" ? textW + textH + 24 : Math.hypot(textW, textH) + 24);
		else if (node.shape === "arrow") {
			w += 28;
			h += 24;
		} else if (node.shape === "cylinder") h += 12;
		else if (node.shape && ![
			"square",
			"round",
			"stadium"
		].includes(node.shape)) w += 20;
		if (inner) {
			w = Math.max(w, inner.w + 24);
			h = inner.h + 24 + title;
		}
		const cell = {
			...node,
			col,
			inner,
			lines,
			font,
			title,
			...compact ? { diameter: w } : {}
		};
		currentRow().cells.push(cell);
		row.h = Math.max(row.h, h);
		unit = Math.max(unit, Math.ceil((w - (node.span - 1) * GAP) / node.span));
		occupied = Math.max(occupied, col + node.span);
		advance(Math.min(node.span, columns - col));
	}
	if (row) rows.push(row);
	const h = rows.reduce((sum, item) => sum + item.h + GAP, -20);
	return {
		rows,
		unit,
		columns: occupied,
		w: Math.max(0, occupied * (unit + GAP) - GAP),
		h: Math.max(0, h)
	};
}
function place(grid, x, y, width, nodes, frames) {
	if (!grid.columns) return;
	const pitch = (width + GAP) / grid.columns;
	for (const row of grid.rows) {
		for (const cell of row.cells) {
			const box = {
				...cell,
				x: x + cell.col * pitch,
				y,
				w: cell.span * pitch - GAP,
				h: row.h
			};
			if (cell.diameter) {
				box.x += (box.w - cell.diameter) / 2;
				box.y += (box.h - cell.diameter) / 2;
				box.w = box.h = cell.diameter;
			} else if (!cell.inner && cell.shape === "arrow" && !cell.lines.length) {
				box.x += (box.w - 28) / 2;
				box.y += (box.h - 28) / 2;
				box.w = box.h = 28;
			}
			nodes.set(box.id, box);
			if (box.inner) {
				frames.push(box);
				place(box.inner, box.x + PAD, y + PAD + box.title, box.w - 24, nodes, frames);
			}
		}
		y += row.h + GAP;
	}
}
var rectPoints = [
	[0, 0],
	[1, 0],
	[1, 1],
	[0, 1]
];
var polygons = {
	diamond: [
		[.5, 0],
		[1, .5],
		[.5, 1],
		[0, .5]
	],
	hexagon: [
		[.13, 0],
		[.87, 0],
		[1, .5],
		[.87, 1],
		[.13, 1],
		[0, .5]
	],
	notch: [
		[0, 0],
		[1, 0],
		[1, 1],
		[0, 1],
		[.13, .5]
	],
	leanRight: [
		[.13, 0],
		[1, 0],
		[.87, 1],
		[0, 1]
	],
	leanLeft: [
		[0, 0],
		[.87, 0],
		[1, 1],
		[.13, 1]
	],
	trapezoid: [
		[.13, 0],
		[.87, 0],
		[1, 1],
		[0, 1]
	],
	inverseTrapezoid: [
		[0, 0],
		[1, 0],
		[.87, 1],
		[.13, 1]
	]
};
function outline(box) {
	let points = polygons[box.shape];
	if (box.shape === "arrow") {
		const dirs = box.directions;
		const active = [
			"up",
			"right",
			"down",
			"left"
		].map((dir, i) => dirs.includes(dir) || dirs.includes(i % 2 ? "x" : "y"));
		const dx = Math.min(.22, 16 / box.w), dy = Math.min(.24, 14 / box.h);
		const [top, right, bottom, left] = active.map((on, i) => on ? [dy, dx][i % 2] : 0);
		const corners = [
			[left, top],
			[1 - right, top],
			[1 - right, 1 - bottom],
			[left, 1 - bottom]
		];
		const heads = [
			[
				[.24, top],
				[.5, 0],
				[.76, top]
			],
			[
				[1 - right, .24],
				[1, .5],
				[1 - right, .76]
			],
			[
				[.76, 1 - bottom],
				[.5, 1],
				[.24, 1 - bottom]
			],
			[
				[left, .76],
				[0, .5],
				[left, .24]
			]
		];
		const vertical = active[0] || active[2], horizontal = active[1] || active[3];
		if (vertical && !horizontal) {
			const inset = Math.min(.28, 12 / box.w);
			corners.forEach((p, i) => {
				p[0] = i === 0 || i === 3 ? inset : 1 - inset;
			});
			heads[0][0][0] = 0;
			heads[0][2][0] = 1;
			heads[2][0][0] = 1;
			heads[2][2][0] = 0;
		} else if (horizontal && !vertical) {
			const inset = Math.min(.24, 12 / box.h);
			corners.forEach((p, i) => {
				p[1] = i < 2 ? inset : 1 - inset;
			});
			heads[1][0][1] = 0;
			heads[1][2][1] = 1;
			heads[3][0][1] = 1;
			heads[3][2][1] = 0;
		}
		points = corners.flatMap((point, i) => {
			if (!active[i]) return [point];
			const next = corners[(i + 1) % 4], head = heads[i], axis = i % 2;
			if (horizontal && vertical) return [point, ...head];
			const shoulder = (p, corner) => p.map((v, k) => k === axis ? v : corner[k]);
			return [
				point,
				shoulder(head[0], point),
				...head,
				shoulder(head[2], next)
			];
		});
	}
	return points?.map(([x, y]) => [box.x + x * box.w, box.y + y * box.h]);
}
var center = (b) => [b.x + b.w / 2, b.y + b.h / 2];
var cross = (a, b) => a[0] * b[1] - a[1] * b[0];
var vector = (a, b) => [b[0] - a[0], b[1] - a[1]];
var roundShape = (b) => b.shape === "circle" || b.shape === "doublecircle";
function attach(box, toward) {
	const c = center(box), d = vector(c, toward);
	if (roundShape(box)) {
		const t = 1 / Math.hypot(d[0] / (box.w / 2), d[1] / (box.h / 2));
		return c.map((v, i) => v + d[i] * t);
	}
	const points = outline(box) || rectPoints.map(([x, y]) => [box.x + x * box.w, box.y + y * box.h]);
	let t = Infinity;
	for (const [i, p] of points.entries()) {
		const q = points[(i + 1) % points.length], side = vector(p, q), det = cross(d, side);
		if (Math.abs(det) < 1e-6) continue;
		const offset = vector(c, p), u = cross(offset, d) / det, distance = cross(offset, side) / det;
		if (u >= 0 && u <= 1 && distance > 0) t = Math.min(t, distance);
	}
	return Number.isFinite(t) ? c.map((v, i) => v + d[i] * t) : c;
}
var inside = (outer, inner) => outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.w >= inner.x + inner.w && outer.y + outer.h >= inner.y + inner.h;
var intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
function hits([a, b], box) {
	let lo = 0, hi = 1;
	for (const [i, low, high] of [[
		0,
		box.x - 2,
		box.x + box.w + 2
	], [
		1,
		box.y - 2,
		box.y + box.h + 2
	]]) {
		const d = b[i] - a[i];
		if (d === 0) {
			if (a[i] < low || a[i] > high) return false;
			continue;
		}
		const t = (low - a[i]) / d, u = (high - a[i]) / d;
		lo = Math.max(lo, Math.min(t, u));
		hi = Math.min(hi, Math.max(t, u));
	}
	return lo <= hi;
}
var segments = (points) => points.slice(1).map((b, i) => [points[i], b]);
var length = ([a, b]) => Math.hypot(...vector(a, b));
function route(edge, a, b, boxes, used, measure, budget) {
	const start = center(a), end = center(b);
	const obstacles = boxes.filter((box) => box !== a && box !== b && !(box.inner && (inside(box, a) || inside(box, b))));
	const lines = edge.label.trim() ? wrapText(edge.label, 176, FONT.label, measure) : [];
	const labelW = maxWidthOf(lines, FONT.label, measure) + 12, labelH = lines.length * 16 + 4;
	const candidates = [
		[],
		[[start[0], end[1]]],
		[[end[0], start[1]]]
	];
	for (const lane of [...new Set(boxes.flatMap((box) => [box.x - GAP / 2, box.x + box.w + GAP / 2]))]) candidates.push([[lane, start[1]], [lane, end[1]]]);
	for (const lane of [...new Set(boxes.flatMap((box) => [box.y - GAP / 2, box.y + box.h + GAP / 2]))]) candidates.push([[start[0], lane], [end[0], lane]]);
	if (a === b) candidates.unshift([
		[a.x + a.w + 8, start[1]],
		[a.x + a.w + 8, a.y - 8],
		[start[0], a.y - 8]
	]);
	let best;
	for (const via of candidates) {
		const path = [
			start,
			...via,
			end
		].filter((p, i, all) => !i || length([all[i - 1], p]) > .01);
		if (path.length < 2) continue;
		const first = attach(a, path[1]), last = attach(b, path.at(-2));
		if (length([start, first]) >= length([start, path[1]]) || length([end, last]) >= length([end, path.at(-2)])) continue;
		path[0] = first;
		path[path.length - 1] = last;
		const legs = segments(path), cost = legs.reduce((sum, leg) => sum + length(leg), via.length * 12);
		if (best && cost >= best.cost) continue;
		if ((budget.left -= legs.length * (obstacles.length + 1)) < 0) return best;
		if (legs.some((leg) => obstacles.some((box) => hits(leg, box)))) continue;
		let plate;
		if (lines.length) {
			for (const [p, q] of [...legs].sort((i, j) => length(j) - length(i))) {
				const x = (p[0] + q[0] - labelW) / 2, y = (p[1] + q[1] - labelH) / 2;
				for (const offset of [
					[0, 0],
					[0, -labelH / 2 - 4],
					[0, labelH / 2 + 4],
					[-labelW / 2 - 4, 0],
					[labelW / 2 + 4, 0]
				]) {
					const box = {
						x: x + offset[0],
						y: y + offset[1],
						w: labelW,
						h: labelH
					};
					if (!boxes.some((node) => (!node.inner || obstacles.includes(node)) && intersects(node, box)) && !used.some((other) => intersects(other, box))) {
						plate = box;
						break;
					}
				}
				if (plate) break;
			}
			if (!plate) continue;
		}
		best = {
			...edge,
			cost,
			path,
			plate,
			lines
		};
		if (!via.length) return best;
	}
	return best;
}
function layout(model, { width, lang, measure }, info) {
	const plan = grid(model.root, measure), nodes = /* @__PURE__ */ new Map(), frames = [], edges = [], plates = [], errors = [];
	place(plan, MARGIN, MARGIN, plan.w, nodes, frames);
	const boxes = [...nodes.values()], budget = { left: 2e6 };
	for (const edge of model.edges) {
		const routed = route(edge, nodes.get(edge.from), nodes.get(edge.to), boxes, plates, measure, budget);
		if (budget.left < 0) {
			errors.push(error(lang, edge.line, "块图连线过于复杂", "Block routing is too complex", "拆分图表", "Split the diagram"));
			break;
		}
		if (routed) {
			edges.push(routed);
			if (routed.plate) plates.push(routed.plate);
		} else errors.push(error(lang, edge.line, `无法为 ${edge.from} → ${edge.to} 留出连线空间`, `No clear route for ${edge.from} → ${edge.to}`, "增加 space 留出走线空间", "Add space cells to make room for the edge"));
	}
	const naturalWidth = plan.w + 48;
	if (naturalWidth > 2 * width || model.nodeCount > 60) errors.push(warning("LARGE_DIAGRAM", lang, info.headerLine || 1, "块图较大，可滚动查看", "Large block diagram; scroll to view it", "考虑拆分块图", "Consider splitting the diagram"));
	return {
		width: naturalWidth,
		height: plan.h + 48,
		nodes: boxes.filter((box) => !box.inner),
		frames,
		edges,
		errors
	};
}
function drawShape(ctx, node, style) {
	const { x, y, w, h, shape } = node, [cx, cy] = center(node);
	if (roundShape(node)) {
		const oval = (rx, ry, attrs) => ctx.el("ellipse", {
			cx,
			cy,
			rx,
			ry,
			...attrs
		});
		return [oval(w / 2, h / 2, style), ...shape === "doublecircle" ? [oval(w / 2 - 4, h / 2 - 4, {
			...style,
			fill: "none"
		})] : []];
	}
	const points = outline(node);
	if (points) return [ctx.el("polygon", {
		points: points.map((p) => p.join(",")).join(" "),
		...style
	})];
	if (shape === "cylinder") {
		const ry = 7;
		return [ctx.path(`M${x} ${y + ry} A${w / 2} ${ry} 0 0 1 ${x + w} ${y + ry} V${y + h - ry} A${w / 2} ${ry} 0 0 1 ${x} ${y + h - ry} Z`, style), ctx.path(`M${x} ${y + ry} A${w / 2} ${ry} 0 0 0 ${x + w} ${y + ry}`, {
			...style,
			fill: "none"
		})];
	}
	const rx = shape === "stadium" ? Math.min(w, h) / 2 : shape === "round" ? 10 : 0;
	return [ctx.rect(x, y, w, h, {
		...style,
		rx
	}), ...shape === "subroutine" ? [10, w - 10].map((dx) => ctx.path(`M${x + dx} ${y} V${y + h}`, {
		stroke: style.stroke,
		fill: "none"
	})) : []];
}
function scene(g, ctx) {
	const ink = ctx.color("muted"), bg = ctx.design.bg, nodeFill = appearance(ctx).node;
	const marker = (kind, child) => ctx.el("marker", {
		id: `block-${kind}`,
		viewBox: "0 0 10 10",
		refX: 9,
		refY: 5,
		markerWidth: 7,
		markerHeight: 7,
		markerUnits: "userSpaceOnUse",
		orient: "auto-start-reverse"
	}, [child]);
	const children = [ctx.el("defs", {}, [
		marker("point", ctx.path("M0 0 L10 5 L0 10 Z", { fill: ink })),
		marker("circle", ctx.el("circle", {
			cx: 5,
			cy: 5,
			r: 4,
			fill: bg,
			stroke: ink
		})),
		marker("cross", ctx.path("M1 1 L9 9 M9 1 L1 9", {
			fill: "none",
			stroke: ink,
			"stroke-width": 1.8
		}))
	])];
	for (const [i, frame] of g.frames.entries()) {
		const { x, y, w, h } = frame, tone = ctx.frameTone(ctx.color(`tone${i % 6 + 1}`));
		const shape = ctx.rect(x, y, w, h, {
			rx: 5,
			fill: ctx.tint(bg, tone, .07),
			stroke: ctx.tint(bg, tone, .45)
		});
		const text = textBlock(ctx, {
			...frame,
			x: x + w / 2,
			y: y + PAD + frame.lines.length * 9,
			lineHeight: 18
		});
		children.push({
			...ctx.el("g", {}, [shape, text]),
			meta: {
				kind: "frame",
				id: frame.id
			}
		});
	}
	for (const node of g.nodes) {
		const [x, y] = center(node);
		const parts = drawShape(ctx, node, {
			fill: nodeFill,
			stroke: ctx.tint(bg, ink, .62),
			"stroke-width": 1.25
		});
		parts.push(textBlock(ctx, {
			...node,
			x,
			y,
			lineHeight: 18
		}));
		children.push({
			...ctx.el("g", {}, parts),
			meta: {
				kind: "node",
				id: node.id
			}
		});
	}
	for (const { from, to, path, pattern, thickness, arrowStart, arrowEnd, plate, lines } of g.edges) {
		const attrs = {
			fill: "none",
			stroke: ink,
			"stroke-width": thickness,
			"stroke-linecap": "round",
			"stroke-linejoin": "round"
		};
		if (pattern === "dotted") attrs["stroke-dasharray"] = "2 4";
		if (arrowStart) attrs["marker-start"] = `url(#block-${arrowStart})`;
		if (arrowEnd) attrs["marker-end"] = `url(#block-${arrowEnd})`;
		children.push({
			...ctx.path(`M${path.map((p) => p.join(" ")).join(" L")}`, attrs),
			meta: {
				kind: "edge",
				from,
				to
			}
		});
		if (plate) {
			const { x, y, w, h } = plate;
			children.push({
				...ctx.el("g", {}, [ctx.rect(x, y, w, h, {
					fill: bg,
					rx: 4
				}), textBlock(ctx, {
					x: x + w / 2,
					y: y + h / 2,
					lines,
					font: FONT.label,
					lineHeight: 16
				})]),
				meta: {
					kind: "edge-label-group",
					from,
					to
				}
			});
		}
	}
	return {
		width: g.width,
		height: g.height,
		children
	};
}
var implementations = { block: {
	optionMode: "raw",
	parse,
	layout,
	scene
} };
export { block_exports, implementations };
