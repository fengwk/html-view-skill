import { FONT, appearance as appearanceOf, error, fallbackMeasure, maxWidthOf, snap, wrapText } from './support.js';
import { geometry, has } from '../core/icons.js';

const LIMITS = Object.freeze({ depth: 4, edges: 8, boxes: 80, items: 160, labelChars: 24, labelLines: 2, labelWidth: 312, titleLines: 3 });
const GAP = 16, ARROW = 56, PAD = 12, ITEM_GAP = 8, ITEM_H = 36, HEADER = 36, MARGIN = 4, SPARSE_CELL = 260;
const issue = (lang, line, zh, en, fixZh, fixEn) => error(lang, line, zh, en, fixZh, fixEn);

function parse(source, info) {
  const { lang, options = {}, firstLine = 2 } = info;
  const errors = Object.keys(options).map((key) => issue(lang, firstLine - 1, `blocks 不支持选项「${key}」`, `Unsupported blocks option: ${key}`, '删除这个选项', 'Remove this option'));
  const nodes = [], edges = [], stack = [], indents = [];
  for (const [i, raw] of String(source).split('\n').entries()) {
    if (!raw.trim() || raw.trimStart().startsWith('%%')) continue;
    const line = firstLine + i;
    if (/^\s*\t/.test(raw)) { errors.push(issue(lang, line, '缩进不能使用 Tab', 'Tabs are not allowed in indentation', '把 Tab 换成空格', 'Replace tabs with spaces')); continue; }
    const indent = raw.match(/^ */)[0].length, text = raw.slice(indent).trim();
    const edge = text.match(/^(.+?)\s*(->|~>)\s*(.+?)(?:\s*[:：]\s*(.*))?$/), head = /^(row|col|box)(?:\s|$)/.test(text);
    while (stack.length && indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1);
    if (edge && !head && (!parent || parent.kind !== 'box' || parent.inline)) {
      if (indent) errors.push(issue(lang, line, '关系必须写在顶格', 'Relations must start at column 0', '去掉这一行的缩进', 'Remove the indentation from this relation'));
      edges.push({ from: edge[1].trim(), to: edge[3].trim(), async: edge[2] === '~>', label: (edge[4] || '').trim(), line }); continue;
    }
    if (!head && parent?.kind === 'box' && !parent.inline) {
      parent.items.push(...parseItems(text, line, lang, errors)); continue;
    }
    const depth = stack.length;
    indents[depth] ??= indent;
    if (indents[depth] !== indent) { errors.push(issue(lang, line, '同级条目的缩进不一致', 'Inconsistent indentation at the same level', `把这一行缩进改为 ${indents[depth]} 个空格`, `Indent this line with ${indents[depth]} spaces`)); continue; }
    const boxDepth = stack.filter((entry) => entry.kind === 'box').length + (text.startsWith('box') ? 1 : 0);
    if (boxDepth > LIMITS.depth) { errors.push(issue(lang, line, `嵌套超过 ${LIMITS.depth} 层`, `Nesting exceeds ${LIMITS.depth} levels`, '把内层拆成另一张图', 'Split the inner level into another diagram')); continue; }
    const node = readNode(text, line, indent, lang, errors);
    if (!node) continue;
    (parent ? parent.children : nodes).push(node); stack.push(node);
  }
  const boxes = [], items = [];
  walk(nodes, null, (node, parent) => {
    node.parent = parent;
    if (node.kind === 'box') boxes.push(node);
    items.push(...node.items);
    if (node.kind !== 'box' && node.items.length) errors.push(issue(lang, node.line, '能力项只能写在 box 内', 'Capabilities belong inside a box', '把这一行改成 box，或移入上一个 box', 'Change this line into a box, or move it into the previous box'));
    if (node.children.length && node.items.length) errors.push(issue(lang, node.line, 'box 不能同时写行内能力项和子容器', 'A box cannot mix inline capabilities and child containers', '改成缩进的能力项，或去掉子容器', 'Use indented capabilities, or remove the child containers'));
  });
  const names = new Map();
  for (const box of boxes) { if (!box.title) errors.push(issue(lang, box.line, 'box 名称不能为空', 'Box name cannot be empty', '写上唯一名称', 'Add a unique name')); const list = names.get(box.title) || []; list.push(box); names.set(box.title, list); }
  for (const [title, list] of names) if (list.length > 1) errors.push(issue(lang, list[1].line, `容器名称「${title}」重复`, `Duplicate container name: ${title}`, '改成唯一名称；关系只能指向唯一容器', 'Use a unique name; relations can only target one container'));
  for (const edge of edges) for (const end of ['from', 'to']) if ((names.get(edge[end]) || []).length !== 1) errors.push(issue(lang, edge.line, `关系指向的容器「${edge[end]}」不存在或不唯一`, `Relation target "${edge[end]}" is missing or not unique`, '改成图中唯一的容器名称', 'Use the unique name of a container in this diagram'));
  if (edges.length > LIMITS.edges) errors.push(issue(lang, edges[LIMITS.edges].line, `关系最多 ${LIMITS.edges} 条`, `At most ${LIMITS.edges} relations`, '删掉次要关系，或改用泳道图、流程图', 'Remove secondary relations, or use a swimlane or flowchart'));
  for (const edge of edges) if ([...edge.label].length > LIMITS.labelChars) errors.push(issue(lang, edge.line, `关系标签「${edge.label}」过长`, `Relation label is too long: ${edge.label}`, `把标签缩到 ${LIMITS.labelChars} 个字符以内，或把说明移到图外`, `Keep the label within ${LIMITS.labelChars} characters, or move the description outside`));
  if (boxes.length > LIMITS.boxes) errors.push(issue(lang, boxes[LIMITS.boxes].line, `容器最多 ${LIMITS.boxes} 个`, `At most ${LIMITS.boxes} containers`, '拆成总图和分图', 'Split into an overview and detail diagrams'));
  if (items.length > LIMITS.items) errors.push(issue(lang, items[LIMITS.items].line, `能力项最多 ${LIMITS.items} 个`, `At most ${LIMITS.items} capabilities`, '把说明移到图外，或拆成两张图', 'Move descriptions outside, or split into two diagrams'));
  for (const item of items) if (item.icon && !has(item.icon)) errors.push(issue(lang, item.line, `未知图标「${item.icon}」`, `Unknown icon: ${item.icon}`, '换成图标库中的名称，例如 database', 'Use a name from the icon library'));
  if (!nodes.length) errors.push(issue(lang, firstLine, '图中没有容器', 'Diagram has no containers', '添加 row、col 或 box', 'Add a row, col, or box'));
  return { model: { type: 'blocks', nodes, edges, boxes, items }, errors };
}

function readNode(text, line, indent, lang, errors) {
  const head = text.match(/^(row|col|box)(?:\s+(.*))?$/);
  if (!head) { errors.push(issue(lang, line, '无法识别这一行', 'Unrecognized line', '使用 row、col、box，或「容器 -> 容器: 标签」', 'Use row, col, box, or "container -> container: label"')); return null; }
  const kind = head[1], rest = (head[2] || '').trim();
  if (kind !== 'box') {
    const weighted = rest.match(/^(\d+(?:\.\d+)?)(?:\s+(.*))?$/), weight = weighted ? Number(weighted[1]) : 1;
    if (weighted && !(weight > 0)) errors.push(issue(lang, line, '宽度权重必须是正数', 'Width weight must be a positive number', '写成正数，例如 col 3', 'Use a positive number, for example col 3'));
    else if (rest && !weighted) errors.push(issue(lang, line, `${kind} 后面只能写宽度权重`, `Only a width weight may follow ${kind}`, '删掉多余文字，或改成 box', 'Remove the extra text, or change this into a box'));
    return { kind, weight, explicit: Boolean(weighted), indent, line, title: '', flag: '', items: [], children: [] };
  }
  let body = rest, weight = 1, explicit = false;
  const declared = rest.match(/^(\d+(?:\.\d+)?)\s+(?![:：\s])([\s\S]*)$/);
  if (declared) { weight = Number(declared[1]); explicit = weight > 0; body = declared[2]; if (!explicit) weight = 1; }
  const colon = body.search(/[:：]/), header = (colon < 0 ? body : body.slice(0, colon)).trim(), inline = colon < 0 ? '' : body.slice(colon + 1);
  const flag = header.match(/\s*\{(db|ext)\}\s*$/)?.[1] || '', title = header.replace(/\s*\{(db|ext)\}\s*$/, '').trim();
  const badFlag = /\{(?!db\}|ext\})/.test(header) || /\}\s*\S/.test(header);
  if (badFlag || (!title && body)) errors.push(issue(lang, line, 'box 写法无效', 'Invalid box syntax', '使用「box 名称 [{db}|{ext}] [: 能力项, 能力项]」', 'Use "box Name [{db}|{ext}] [: item, item]"'));
  const items = inline ? parseItems(inline, line, lang, errors) : [];
  return { kind, weight, explicit, indent, line, title, flag: badFlag ? '' : flag, inline: items.length > 0, items, children: [] };
}
function parseItems(text, line, lang, errors) {
  return text.split(/[,，]/).map((part) => {
    const raw = part.trim(), icon = raw.match(/^\[icon:([a-z0-9][\w.-]*)\]\s*/i), value = icon ? raw.slice(icon[0].length) : raw;
    const mark = value.match(/^([+~=])\s*/)?.[1] || '', name = value.replace(/^[+~=]\s*/, '').trim();
    if (!name) errors.push(issue(lang, line, '能力项名称不能为空', 'Capability labels cannot be empty', '删除空项或补上名称', 'Remove the empty item or add a label'));
    if (/\[icon:/.test(raw) && !icon) errors.push(issue(lang, line, '图标写法无效', 'Invalid icon syntax', '写成 [icon:database] 名称', 'Write [icon:database] name'));
    return { label: mark ? `${mark} ${name}` : name, name, mark, tone: ({ '+': 'new', '~': 'info', '=': 'ok' })[mark] || '', icon: icon?.[1] || '', line };
  }).filter((item) => item.name);
}
function walk(nodes, parent, visit) { for (const node of nodes) { visit(node, parent); walk(node.children, node, visit); } }

function layout(model, { width, lang, measure }) {
  const errors = [], root = model.nodes.length === 1 ? model.nodes[0] : { kind: 'col', weight: 1, children: model.nodes, items: [], title: '', line: model.nodes[0]?.line || 1 };
  const boxes = [], items = [];
  const collect = (node) => { if (node.kind === 'box') boxes.push(node); items.push(...(node.items || [])); node.children.forEach(collect); };
  collect(root);
  for (const item of items) if ([...item.name].length > LIMITS.labelChars || measure(item.name, FONT.body) > LIMITS.labelWidth) errors.push(issue(lang, item.line, `能力项「${item.label}」过长`, `Capability label is too long: ${item.label}`, '把说明移到图外，名称缩短至约 16 个汉字', 'Move descriptions outside; shorten the label to about 16 CJK characters'));
  for (const box of boxes) if (measure(box.title, FONT.title) > LIMITS.labelWidth * 2) errors.push(issue(lang, box.line, `容器标题「${box.title}」过长`, `Container title is too long: ${box.title}`, '缩短标题，把说明放到图注', 'Shorten the title and move the description to the caption'));
  if (errors.length) return { width, height: 0, errors };
  const byTitle = new Map(boxes.map((box) => [box.title, box])), resolved = model.edges.map((edge) => ({ ...edge, fromBox: byTitle.get(edge.from), toBox: byTitle.get(edge.to) })), pairs = new Map();
  for (const edge of resolved) { const key = pairOf(edge.fromBox, edge.toBox); if (!pairs.has(key)) pairs.set(key, []); pairs.get(key).push(edge); }
  const natural = sizeOf(root, measure, pairs), canvas = Math.max(Math.floor(width), natural.w + MARGIN * 2);
  const placed = place(root, MARGIN, MARGIN, canvas - MARGIN * 2, measure, pairs), frames = [], nodes = [];
  flatten(placed, frames, nodes);
  const edges = [];
  for (const edge of resolved) { const route = routeEdge(edge, frames, nodes, measure); if (!route) errors.push(issue(lang, edge.line, `容器「${edge.from}」与「${edge.to}」之间没有可用箭头通道`, `No clear arrow lane between "${edge.from}" and "${edge.to}"`, '让两个容器只隔一条空间隙，并避开能力项；或改用泳道图、流程图', 'Leave one empty gap between the containers and clear of capability items, or use a swimlane or flowchart')); else edges.push(route); }
  if (errors.length) return { width: canvas, height: placed.h + MARGIN * 2, frames, nodes, edges, errors };
  return { type: 'blocks', width: canvas, height: snap(placed.h + MARGIN * 2), frames, nodes, edges, errors: [] };
}
const textWidth = (text, font, measure) => measure(String(text || ''), font);
function itemMin(item, measure) { return snap(Math.max(48, textWidth(item.label, FONT.body, measure) + 16 + (item.icon ? 28 : 0))); }
function cellOf(items, measure) { return items.length ? snap(Math.max(72, ...items.map((item) => itemMin(item, measure)))) : 72; }
function gridOf(items, cols, cell) {
  const used = Math.max(1, cols), rows = Math.max(1, Math.ceil(items.length / used));
  return { cols: used, rows, cell, width: used * cell + ITEM_GAP * (used - 1), height: rows * ITEM_H + ITEM_GAP * (rows - 1) };
}
function chooseGrid(items, measure, limit) {
  const cell = cellOf(items, measure), total = Math.max(1, items.length), ceiling = Math.min(total, Math.ceil(Math.sqrt(total)));
  let best = null;
  for (let cols = 1; cols <= total; cols += 1) {
    const grid = gridOf(items, cols, cell);
    if (grid.width > limit && cols !== 1) break;
    const stretched = Math.floor((limit - ITEM_GAP * (cols - 1)) / cols);
    const score = [stretched > SPARSE_CELL ? 1 : 0, grid.rows * grid.cols - total, Math.abs(grid.cols - grid.rows), grid.rows, Math.abs(grid.cols - ceiling)];
    if (!best || lexLess(score, best.score)) best = { grid, score };
  }
  return best ? best.grid : gridOf(items, 1, cell);
}
function lexLess(a, b) { for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] < b[i]; return false; }
const LABEL_WRAP = 160;
function labelPlan(text, measure) {
  if (!text) return { lines: [], w: 0, h: 0 };
  const lines = wrapText(text, LABEL_WRAP, FONT.label, measure).slice(0, LIMITS.labelLines);
  return { lines, w: snap(maxWidthOf(lines, FONT.label, measure) + 12), h: lines.length * 16 + 2 };
}
function sizeOf(node, measure, pairs) {
  if (node.kind !== 'box' && !node.children.length && !node.items?.length) return { w: 72, h: 36 };
  if (node.kind === 'box' && node.items?.length && !node.children.length) {
    const grid = gridOf(node.items, 1, cellOf(node.items, measure)), title = snap(textWidth(node.title, FONT.title, measure) + 24);
    return { w: Math.max(grid.width, title) + PAD * 2, h: HEADER + grid.height + PAD, grid };
  }
  if (node.kind === 'box' && !node.children.length) { const w = Math.max(48, snap(textWidth(node.title, FONT.title, measure)) + PAD * 2); return { w: snap(w), h: HEADER + PAD }; }
  const kids = node.children.map((child) => ({ child, size: sizeOf(child, measure, pairs) })), vertical = node.kind === 'col', gaps = gapPlan(node, kids.map((item) => item.child), pairs, measure);
  const cross = Math.max(72, ...kids.map((item) => (vertical ? item.size.w : item.size.h))), main = kids.reduce((sum, item) => sum + (vertical ? item.size.h : item.size.w), 0) + gaps.reduce((a, b) => a + b, 0);
  let w = vertical ? cross : main, h = vertical ? main : cross;
  if (node.kind === 'box') { const title = snap(textWidth(node.title, FONT.title, measure) + 24); w = Math.max(w, title) + PAD * 2; h += HEADER + PAD; }
  return { w: snap(w), h: snap(h), kids };
}
function gapPlan(node, children, pairs, measure) {
  const vertical = node.kind === 'col', gaps = [];
  for (let i = 0; i < children.length - 1; i += 1) {
    const edges = [];
    for (const a of boxesIn(children[i])) for (const b of boxesIn(children[i + 1])) edges.push(...(pairs.get(pairOf(a, b)) || []));
    const need = (edge) => { const plan = labelPlan(edge.label, measure); return vertical ? (plan.h ? plan.h + 48 : 0) : plan.w + 24; };
    gaps.push(edges.length ? Math.max(ARROW, ...edges.map(need)) : GAP);
  }
  return gaps;
}
function sharesEdge(a, b, pairs) { return boxesIn(a).some((x) => boxesIn(b).some((y) => pairs.has(pairOf(x, y)))); }
function pairOf(a, b) { return [a.title, b.title].sort().join('\0'); }
function boxesIn(node, out = []) { if (node.kind === 'box') out.push(node); for (const child of node.children || []) boxesIn(child, out); return out; }
// 旧版布局主体：行高、等宽网格、左右对称内边距及列高分配规则原样迁移。
function place(node, x, y, w, measure, pairs, minH = 0) {
  const box = { ...node, x, y, w, h: 0, children: [], itemNodes: [] }, framed = node.kind === 'box';
  const innerX = framed ? x + PAD : x, innerY = framed ? y + HEADER : y, innerW = framed ? w - PAD * 2 : w, padding = framed ? HEADER + PAD : 0;
  if (framed && node.items?.length && !node.children.length) {
    const grid = chooseGrid(node.items, measure, innerW), cols = grid.cols;
    const cw = Math.max(grid.cell, Math.floor((innerW - ITEM_GAP * (cols - 1)) / cols));
    const left = innerX + Math.max(0, Math.floor((innerW - cw * cols - ITEM_GAP * (cols - 1)) / 2));
    node.items.forEach((item, index) => box.itemNodes.push({ ...item, x: left + (index % cols) * (cw + ITEM_GAP), y: innerY + Math.floor(index / cols) * (ITEM_H + ITEM_GAP), w: cw, h: ITEM_H }));
    box.h = Math.max(minH, padding + grid.height); return box;
  }
  const kids = node.children || [];
  if (!kids.length) { box.h = Math.max(minH, padding); return box; }
  const horizontal = node.kind !== 'col', sizes = kids.map((child) => sizeOf(child, measure, pairs)), gaps = gapPlan(node, kids, pairs, measure), mins = sizes.map((size) => (horizontal ? size.w : size.h));
  const anyExplicit = kids.some((child) => child.explicit);
  if (horizontal && !anyExplicit) {
    const groups = new Map();
    kids.forEach((child, index) => { if (child.kind !== 'box' || child.children.length || !child.items?.length) return; if (!groups.has(child.items.length)) groups.set(child.items.length, []); groups.get(child.items.length).push(index); });
    for (const indexes of groups.values()) { if (indexes.length < 2) continue; const widest = Math.max(...indexes.map((index) => mins[index])); for (const index of indexes) mins[index] = widest; }
  }
  const bare = (child) => child.kind === 'box' && !child.children.length && !child.items?.length;
  const weights = kids.map((child, i) => (anyExplicit ? (child.explicit ? child.weight : 1) : bare(child) ? 0 : Math.max(72, mins[i])));
  if (weights.every((weight) => weight === 0)) weights.fill(1);
  const gapSum = gaps.reduce((a, b) => a + b, 0), share = horizontal ? distribute(mins, weights, Math.max(innerW - gapSum, mins.reduce((a, b) => a + b, 0))) : mins;
  const placed = kids.map((child, index) => ({ child, w: horizontal ? share[index] : innerW, x: horizontal ? innerX + share.slice(0, index).reduce((a, b) => a + b, 0) + gaps.slice(0, index).reduce((a, b) => a + b, 0) : innerX }));
  if (horizontal) {
    const first = placed.map((item) => place(item.child, item.x, innerY, item.w, measure, pairs));
    const rowH = Math.max(minH - padding, ...first.map((child) => child.h));
    box.children = first.map((child, index) => child.h === rowH ? child : place(kids[index], placed[index].x, innerY, placed[index].w, measure, pairs, rowH));
    box.h = padding + rowH; return box;
  }
  const natural = kids.map((child) => place(child, innerX, innerY, innerW, measure, pairs).h);
  const extra = Math.max(0, minH - padding - natural.reduce((a, b) => a + b, 0) - gaps.reduce((a, b) => a + b, 0));
  const each = Math.floor(extra / kids.length); let cursor = innerY;
  kids.forEach((child, index) => { const grow = each + (index === kids.length - 1 ? extra - each * kids.length : 0); const item = place(child, innerX, cursor, innerW, measure, pairs, natural[index] + grow); box.children.push(item); cursor += item.h + (gaps[index] || 0); });
  box.h = Math.max(minH, padding + cursor - innerY); return box;
}
function distribute(mins, weights, space) {
  const minSum = mins.reduce((a, b) => a + b, 0), extra = Math.max(0, space - minSum), weightSum = weights.reduce((a, b) => a + b, 0);
  const out = mins.map((min, i) => min + Math.floor(extra * weights[i] / weightSum)), takers = weights.map((weight, i) => weight > 0 ? i : -1).filter((i) => i >= 0);
  let rest = space - out.reduce((a, b) => a + b, 0); for (let k = 0; rest > 0; k += 1, rest -= 1) out[takers[k % takers.length]] += 1;
  return out;
}
function flatten(n, frames, nodes) { if (n.kind === 'box') frames.push(n); for (const item of n.itemNodes || []) nodes.push({ ...item, parent: n }); for (const c of n.children || []) flatten(c, frames, nodes); }
function contains(outer, inner) { return outer.x <= inner.x + .5 && outer.y <= inner.y + .5 && outer.x + outer.w + .5 >= inner.x + inner.w && outer.y + outer.h + .5 >= inner.y + inner.h; }
function inset(box, n) { return { x: box.x + n, y: box.y + n, w: box.w - n * 2, h: box.h - n * 2 }; }
function overlap(a, b) { return a.w > 0 && a.h > 0 && b.w > 0 && b.h > 0 && a.x < b.x + b.w - .5 && b.x < a.x + a.w - .5 && a.y < b.y + b.h - .5 && b.y < a.y + a.h - .5; }
function routeEdge(edge, frames, nodes = [], measure = fallbackMeasure) {
  const a = frames.find((frame) => frame.title === edge.from), b = frames.find((frame) => frame.title === edge.to);
  if (!a || !b || a === b) return null;
  const candidates = [];
  if (a.x + a.w <= b.x + .5) candidates.push({ dir: 'right', gap: { x: a.x + a.w, y: Math.max(a.y, b.y), w: b.x - (a.x + a.w), h: Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) } });
  if (b.x + b.w <= a.x + .5) candidates.push({ dir: 'left', gap: { x: b.x + b.w, y: Math.max(a.y, b.y), w: a.x - (b.x + b.w), h: Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) } });
  if (a.y + a.h <= b.y + .5) candidates.push({ dir: 'down', gap: { x: Math.max(a.x, b.x), y: a.y + a.h, w: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h: b.y - (a.y + a.h) } });
  if (b.y + b.h <= a.y + .5) candidates.push({ dir: 'up', gap: { x: Math.max(a.x, b.x), y: b.y + b.h, w: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h: a.y - (b.y + b.h) } });
  const usable = candidates.filter((item) => item.gap.w >= 24 && item.gap.h >= 24);
  const ranked = usable.map((item) => ({ ...item, lane: arrowLane(item, frames, nodes, a, b, edge.label, measure) })).filter((item) => item.lane);
  if (!ranked.length) return null;
  ranked.sort((p, q) => laneArea(q.lane) - laneArea(p.lane));
  const { dir, lane } = ranked[0], midX = lane.x + lane.w / 2, midY = lane.y + lane.h / 2, horizontal = dir === 'right' || dir === 'left';
  const path = horizontal ? (dir === 'right' ? `M${lane.x + 4} ${midY} H${lane.x + lane.w - 4}` : `M${lane.x + lane.w - 4} ${midY} H${lane.x + 4}`) : (dir === 'down' ? `M${midX} ${lane.y + 4} V${lane.y + lane.h - 4}` : `M${midX} ${lane.y + lane.h - 4} V${lane.y + 4}`);
  const plan = labelPlan(edge.label || '', measure), room = Math.max(24, (horizontal ? ranked[0].gap.w : lane.w) - 8);
  const lines = edge.label && plan.w > room ? wrapText(edge.label, Math.max(24, room - 12), FONT.label, measure).slice(0, LIMITS.labelLines) : plan.lines;
  const labelW = lines.length ? snap(maxWidthOf(lines, FONT.label, measure) + 12) : 0, labelH = lines.length ? Math.max(18, lines.length * 16 + 2) : 0;
  return { ...edge, dir, gap: lane, path, labelLines: lines, labelX: midX, labelY: midY, labelBox: { x: midX - labelW / 2, y: midY - labelH / 2, w: labelW, h: labelH } };
}
function laneArea(box) { return box.w * box.h; }
function arrowLane(item, frames, nodes, a, b, label, measure) {
  const { dir, gap } = item, horizontal = dir === 'right' || dir === 'left', span = horizontal ? gap.h : gap.w, cross = horizontal ? gap.w : gap.h;
  if (cross < 24 || span < 24) return null;
  const thickness = cross - 8, along = Math.min(Math.max(64, measure(label, FONT.label) + 20), Math.max(24, span - 12));
  if (thickness < 20 || along < 20) return null;
  const lane = horizontal ? { x: gap.x + (gap.w - thickness) / 2, y: gap.y + (gap.h - along) / 2, w: thickness, h: along } : { x: gap.x + (gap.w - along) / 2, y: gap.y + (gap.h - thickness) / 2, w: along, h: thickness };
  const blockedByFrame = frames.some((frame) => frame !== a && frame !== b && overlap(frame, lane) && !(contains(frame, a) && contains(frame, b)));
  const blockedByItem = nodes.some((node) => overlap(node, lane));
  return blockedByFrame || blockedByItem ? null : lane;
}

function scene(g, ctx) {
  const d = ctx.design, appearance = appearanceOf(ctx), frameColor = (line) => ctx.frameTone(ctx.color(`tone${(line % 6) + 1}`));
  const children = [ctx.el('defs', {}, [marker('blocks-arrow', ctx, false), marker('blocks-arrow-async', ctx, true)])];
  for (const frame of g.frames) {
    const tone = frameColor(frame.line), fill = ctx.tint(d.bg, tone, .07), stroke = ctx.tint(d.bg, tone, .45);
    const shape = frame.flag === 'db' ? cylinder(frame, ctx, fill, stroke) : ctx.rect(frame.x, frame.y, frame.w, frame.h, { rx: appearance.radius, fill, stroke, 'stroke-width': 1, ...(frame.flag === 'ext' ? { 'stroke-dasharray': '5 4' } : {}) });
    const titleLines = wrapText(frame.title, Math.max(48, frame.w - 24), FONT.title, (v, f) => ctx.measure(v, f.size, f.weight)).slice(0, LIMITS.titleLines);
    const titleY = frame.itemNodes?.length || frame.children?.length ? frame.y + 20 : frame.y + frame.h / 2;
    const frameChildren = [shape, ...titleLines.map((line, i) => ctx.text(frame.x + frame.w / 2, titleY + (i - (titleLines.length - 1) / 2) * 18, line, { anchor: 'middle', size: FONT.title.size, weight: FONT.title.weight, fill: ctx.color('fg'), 'dominant-baseline': 'central' }))];
    children.push({ ...ctx.el('g', {}, frameChildren), meta: { kind: 'container', name: frame.title, ...(frame.flag ? { flag: frame.flag } : {}) } });
  }
  for (const node of g.nodes) {
    const tone = node.tone ? d[node.tone] : frameColor(node.parent?.line || 1);
    const parts = [ctx.rect(node.x, node.y, node.w, node.h, { rx: appearance.smallRadius, fill: appearance.node, stroke: (node.tone ? ctx.mix : ctx.tint)(d.bg, tone, .40), 'stroke-width': 1 })];
    if (node.icon) { const geo = geometry(node.icon); for (const item of geo?.elements || []) parts.push(ctx.shape(item.tag, { ...item.attrs, transform: `translate(${node.x + 8} ${node.y + 8}) scale(.8)`, fill: 'none', stroke: ctx.color('muted'), 'stroke-width': 1.5 })); }
    const textX = node.x + node.w / 2 + (node.icon ? 12 : 0), textY = node.y + node.h / 2;
    if (node.mark && node.tone) {
      const width = ctx.measure(node.label, FONT.body.size, FONT.body.weight), attrs = { x: textX - width / 2, y: textY, 'text-anchor': 'start', 'dominant-baseline': 'central', 'font-size': FONT.body.size, 'font-weight': FONT.body.weight, fill: ctx.color('fg') };
      parts.push(ctx.el('text', attrs, [{ ...ctx.el('tspan', { fill: tone }), text: node.mark }, { ...ctx.el('tspan'), text: ` ${node.name}` }]));
    } else parts.push(ctx.text(textX, textY, node.label, { anchor: 'middle', size: FONT.body.size, fill: ctx.color('fg'), 'dominant-baseline': 'central' }));
    children.push({ ...ctx.el('g', {}, parts), meta: { kind: 'capability', label: node.name, container: node.parent?.title, ...(node.mark ? { mark: node.mark } : {}) } });
  }
  for (const edge of g.edges) {
    const lineAttrs = { d: edge.path, fill: 'none', stroke: ctx.color('muted'), 'stroke-width': 2, 'stroke-linecap': 'round', ...(edge.async ? { 'stroke-dasharray': '5 4' } : {}), 'marker-end': `url(#${edge.async ? 'blocks-arrow-async' : 'blocks-arrow'})` };
    const parts = [ctx.path(edge.path, lineAttrs)];
    if (edge.label) {
      const lines = edge.labelLines || wrapText(edge.label, 160, FONT.label, (v, f) => ctx.measure(v, f.size, f.weight)).slice(0, LIMITS.labelLines);
      const { x, y, w, h } = edge.labelBox;
      parts.push(ctx.rect(x, y, w, h, { rx: 4, fill: d.bg }));
      lines.forEach((line, i) => parts.push(ctx.text(edge.labelX, edge.labelY + (i - (lines.length - 1) / 2) * 16, line, { anchor: 'middle', size: FONT.label.size, fill: ctx.color('fg'), 'dominant-baseline': 'central' })));
    }
    children.push({ ...ctx.el('g', {}, parts), meta: { kind: 'relation', from: edge.from, to: edge.to, async: edge.async } });
  }
  return { width: g.width, height: g.height, children };
}
function marker(id, ctx, dashed) {
  return ctx.el('marker', { id, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse' }, [ctx.path('M1 1 L9 5 L1 9 Z', { fill: ctx.color('muted'), ...(dashed ? { 'stroke-dasharray': '5 4' } : {}) })]);
}
function cylinder(f, ctx, fill, stroke) {
  const ry = Math.min(7, Math.max(4, f.h / 8)), x = f.x, y = f.y, w = f.w, h = f.h;
  return ctx.path(`M${x} ${y + ry} A${w / 2} ${ry} 0 0 1 ${x + w} ${y + ry} V${y + h - ry} A${w / 2} ${ry} 0 0 1 ${x} ${y + h - ry} Z M${x} ${y + ry} A${w / 2} ${ry} 0 0 0 ${x + w} ${y + ry}`, { fill, stroke, 'stroke-width': 1.5 });
}

export const implementations = { blocks: { parse, layout, scene } };
