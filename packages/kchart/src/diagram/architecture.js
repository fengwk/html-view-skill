import { resolveIconRef } from '../core/icons.js';
import { normalizeLabel } from './label.js';
import { presentation } from './presentation.js';
import { appearance, blocking, error, FONT, maxWidthOf, textBlock, warning, wrapText } from './support.js';

const ICONS = new Map(Object.entries({ cloud: 'cloud', database: 'database', disk: 'stack-2', internet: 'world', server: 'server', browser: 'browser' }));
const DIR = { L: [-1, 0], R: [1, 0], T: [0, -1], B: [0, 1] };
const ID = String.raw`\w(?:[-\w]*\w)?`;
const QUOTED = String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'`;
const TITLE = String.raw`\[(${QUOTED}|[^\[\]\r\n]+)\]`;
const DECL = new RegExp(String.raw`^(group|service)\s+(${ID})(?:\s*\(([\w:-]+)\)|\s*(${QUOTED}|\((?:${QUOTED})\)))?(?:\s*${TITLE})?(?:\s+in\s+(${ID}))?$`);
const JUNCTION = new RegExp(String.raw`^junction\s+(${ID})(?:\s+in\s+(${ID}))?$`);
const EDGE = new RegExp(String.raw`^(${ID})\s*(\{group\})?\s*:\s*([LRTB])\s*(<)?\s*(?:--|-\s*${TITLE}\s*-)\s*(>)?\s*([LRTB])\s*:\s*(${ID})\s*(\{group\})?$`);
const ALIGN = new RegExp(String.raw`^align\s+(row|column)\s+(${ID}(?:\s+${ID})*)$`);
const COMMENT = new RegExp(String.raw`(${TITLE}|${QUOTED})|%%.*`, 'g');
const unquote = raw => raw?.replace(/^("|')(.*)\1$/, '$2').replace(/\\(["'\\])/g, '$1') ?? '';
const SUFFIX = /(?:\s*:::(?<class>[\w-]+)|\s*::icon\((?<icon>[\w:-]+)\))$/;

function parse(source, info) {
  const items = new Map(), nodes = [], groups = [], edges = [], aligns = [], errors = [], seenAssets = new Set();
  const look = presentation({ lang: info.lang });
  const asset = diagnostic => {
    if (seenAssets.has(diagnostic.message)) return;
    seenAssets.add(diagnostic.message);
    errors.push(diagnostic);
  };
  const caption = (raw, line) => {
    const result = normalizeLabel(unquote(raw), { lang: info.lang, line });
    result.diagnostics.forEach(asset);
    return result;
  };
  const fail = (line, zh, en) => errors.push(error(info.lang, line, zh, en, '检查架构图声明与引用', 'Check architecture declarations and references'));
  if (source.length > 200_000) {
    fail(info.firstLine, '架构图源文本过长', 'Architecture source is too long');
    return { errors };
  }
  let title;
  for (const [i, raw] of source.split('\n').entries()) {
    // Keep comment delimiters inside quoted labels and bracketed titles literal.
    let text = raw.replace(COMMENT, (_, label) => label ?? '').trim();
    if (!text) continue;
    const line = info.firstLine + i;
    if (look.accept(text, line)) continue;
    const heading = /^title(?:\s+|:\s*)(.+)$/.exec(text);
    if (heading) { title = caption(heading[1], line).text; continue; }
    const classes = [];
    let suffixIcon, suffix;
    if (/^(?:group|service|junction)\s/.test(text)) while ((suffix = SUFFIX.exec(text))) {
      if (suffix.groups.class) classes.unshift(suffix.groups.class);
      else suffixIcon ??= suffix.groups.icon;
      text = text.slice(0, suffix.index);
    }
    const declaration = DECL.exec(text), junction = JUNCTION.exec(text), edge = EDGE.exec(text), align = ALIGN.exec(text);
    if (declaration || junction) {
      const [, kind, id, icon, iconText, label, parent] = declaration || ['', 'junction', junction[1], null, null, null, junction[2]];
      if (items.has(id) || (parent && items.get(parent)?.kind !== 'group')) {
        fail(line, `标识「${id}」重复或父组未声明`, `Duplicate id "${id}" or undeclared parent group`);
        continue;
      }
      if (kind === 'group' && iconText) fail(line, '组图标不支持纯文本', 'Group icons do not support plain text');
      if (kind === 'junction' && suffixIcon) fail(line, '接点不支持图标', 'Junctions do not support icons');
      const ref = suffixIcon ?? icon;
      const resolved = ref && ref !== 'blank' ? resolveIconRef(ICONS.get(ref) ?? ref) : null;
      if (ref && ref !== 'blank' && !resolved) asset(warning('IGNORED_ASSET', info.lang, line, `未知图标 ${ref}`, `Unknown icon ${ref}`, '使用内置架构图图标或注册图标集', 'Use a built-in icon or register its icon set'));
      const title = caption(label, line), content = caption(iconText?.replace(/^\((.*)\)$/, '$1'), line);
      if (classes.length) look.addClasses(id, classes, line);
      const item = { id, kind, parent, icon: resolved ?? content.icon ?? title.icon, iconText: content.text, label: title.text, line, depth: (items.get(parent)?.depth ?? -1) + 1 };
      items.set(id, item);
      (kind === 'group' ? groups : nodes).push(item);
    } else if (edge) {
      const [, from, lhsGroup, lhs, back, label, forward, rhs, to, rhsGroup] = edge;
      const a = items.get(from), b = items.get(to);
      if (!a || !b || a.kind === 'group' || b.kind === 'group' || (lhsGroup && !a.parent) || (rhsGroup && !b.parent) || ((lhsGroup || rhsGroup) && a.parent === b.parent)) {
        fail(line, '边需要已声明的端点；组边必须跨越组边界', 'Edges need declared endpoints; group edges must connect across group boundaries');
        continue;
      }
      const captioned = caption(label, line);
      edges.push({ from, to, lhs, rhs, lhsGroup: lhsGroup ? a.parent : null, rhsGroup: rhsGroup ? b.parent : null, back: Boolean(back), forward: Boolean(forward), label: captioned.text, icon: captioned.icon, line });
    } else if (align) {
      const [, direction, ids] = align, members = ids.split(/\s+/);
      if (members.length < 2 || new Set(members).size !== members.length || members.some(id => !items.has(id) || items.get(id).kind === 'group')) {
        fail(line, '对齐至少需要两个不同的已声明服务或接点', 'An alignment needs at least two distinct declared services or junctions');
        continue;
      }
      aligns.push({ axis: direction === 'row' ? 0 : 1, members, line });
    } else {
      fail(line, '无法识别架构图语句', 'Unrecognized architecture statement');
    }
  }
  // Work caps bound both the constraint solver and the obstacle router, not the viewport.
  if (items.size > 400 || edges.length > 600 || aligns.length > 400) fail(info.firstLine,
    '架构图超过安全上限（400 个元素、600 条边或 400 条对齐），请拆分',
    'Architecture exceeds its safety cap (400 items, 600 edges, or 400 alignments); split it into smaller diagrams');
  errors.push(...look.diagnostics());
  for (const item of items.values()) { item.status = look.statusOf(item.id); item.link = look.linkOf(item.id); }
  edges.forEach((edge, index) => { edge.status = look.edgeStatusOf(index); });
  const model = { items, nodes, groups, edges, aligns, title };
  if (!errors.some(blocking)) {
    const { xy, conflict } = place(model);
    if (conflict) fail(conflict, '架构图对齐与端口顺序冲突', 'Architecture alignment conflicts with port order');
    else model.xy = xy;
  }
  return { model, errors };
}

// Equality contracts (same row/column) collapse into one track. Directed constraints then
// give a stable topological order and the earliest available track for each component.
function solve(ids, constraints) {
  const root = new Map(ids.map(id => [id, id]));
  const find = id => {
    while (root.get(id) !== id) id = root.get(id);
    return id;
  };
  for (const [a, b, distance] of constraints) if (!distance) root.set(find(b), find(a));
  const tracks = new Map(ids.map(id => [find(id), { next: [], count: 0, index: 0 }]));
  for (const [from, to, distance] of constraints) if (distance) {
    const a = tracks.get(find(from)), b = tracks.get(find(to));
    a.next.push(b);
    b.count++;
  }
  const queue = [...tracks.values()].filter(track => !track.count);
  for (const a of queue) for (const b of a.next) {
    b.index = Math.max(b.index, a.index + 1);
    if (!--b.count) queue.push(b);
  }
  return queue.length === tracks.size ? new Map(ids.map(id => [id, tracks.get(find(id)).index])) : null;
}

function place({ items, nodes, edges, aligns }, preferStraight = true) {
  // Keep siblings consecutive when otherwise independent declarations need distinct slots.
  const children = new Map();
  for (const item of items.values()) {
    if (!children.has(item.parent)) children.set(item.parent, []);
    children.get(item.parent).push(item);
  }
  const ids = [];
  const visit = parent => {
    for (const item of children.get(parent) ?? []) {
      if (item.kind === 'group') visit(item.id);
      else ids.push(item.id);
    }
  };
  visit(undefined);
  // Large unconnected declarations all begin on the same pair of tracks. Their collision
  // resolution is exactly declaration-order rows; construct that solution directly rather
  // than repeatedly restarting the constraint solver for each shifted service.
  if (ids.length > 60 && !edges.length && !aligns.length) {
    return { xy: [new Map(ids.map(id => [id, 0])), new Map(ids.map((id, index) => [id, index]))] };
  }
  // Free-standing services impose no constraints. In a large flat map, give
  // them their own rows below the connected area rather than shifting and
  // re-solving one collision at a time. Keep grouped placement unchanged.
  if (ids.length > 60 && ids.length === items.size) {
    const pinned = new Set(edges.flatMap(({ from, to }) => [from, to]));
    for (const { members } of aligns) for (const id of members) pinned.add(id);
    const free = ids.filter(id => !pinned.has(id));
    if (free.length) {
      const active = new Map([...items].filter(([id]) => pinned.has(id)));
      const placement = place({ items: active, nodes: nodes.filter(node => pinned.has(node.id)), edges, aligns }, preferStraight);
      if (!placement.xy) return placement;
      const [columns, rows] = placement.xy;
      let row = Math.max(-1, ...rows.values()) + 1;
      for (const id of free) { columns.set(id, 0); rows.set(id, row++); }
      return placement;
    }
  }
  const constraints = [[], []], perpendicular = [[], []];
  const add = (axis, relation) => {
    const rules = constraints[axis];
    rules.push(relation);
    if (solve(ids, rules)) return true;
    rules.pop();
    return false;
  };
  for (const { from, to, lhs, rhs } of edges) for (let axis = 0; axis < 2; axis++) {
    const a = DIR[lhs][axis], b = DIR[rhs][axis];
    if (a === b) {
      if (!a) perpendicular[axis].push([from, to, 0]);
    } else {
      add(axis, a > b ? [from, to, 1] : [to, from, 1]);
    }
  }
  for (const { axis, members, line } of aligns) for (let i = 1; i < members.length; i++) {
    if (!add(axis, [members[i - 1], members[i], 1]) || !add(1 - axis, [members[0], members[i], 0])) return { conflict: line };
  }
  // Prefer straight edges. In a fan, use the median existing track so that
  // incoming edges can approach distinct sockets without crossing one another.
  for (let axis = 0; preferStraight && axis < 2; axis++) {
    const rank = solve(ids, constraints[axis]), neighbors = new Map(ids.map(id => [id, []]));
    for (const [a, b] of perpendicular[axis]) { neighbors.get(a).push(rank.get(b)); neighbors.get(b).push(rank.get(a)); }
    const median = new Map([...neighbors].map(([id, tracks]) => [id, tracks.sort((a, b) => a - b)[Math.floor(tracks.length / 2)]]));
    const penalty = ([a, b]) => Math.abs(rank.get(a) - median.get(b)) + Math.abs(rank.get(b) - median.get(a));
    for (const relation of perpendicular[axis].sort((a, b) => penalty(a) - penalty(b))) add(axis, relation);
  }
  let xy = constraints.map(rules => solve(ids, rules));
  // Shift collisions vertically in declaration order, or horizontally if the row is fixed.
  for (let i = 0; i < ids.length; i++) for (let j = 0; j < i; j++) {
    const a = ids[j], b = ids[i];
    if (!xy.every(track => track.get(a) === track.get(b))) continue;
    if (!add(1, [a, b, 1]) && !add(1, [b, a, 1]) && !add(0, [a, b, 1]) && !add(0, [b, a, 1])) {
      return preferStraight ? place({ items, nodes, edges, aligns }, false) : { conflict: items.get(b).line };
    }
    xy = constraints.map(rules => solve(ids, rules));
    // A shifted node (or its dependents) can collide with an earlier slot again.
    i = -1;
    break;
  }
  return { xy };
}

const rect = (l, t, r, b) => ({ l, t, r, b, x: (l + r) / 2, y: (t + b) / 2 });
const inflate = ({ l, t, r, b }, n) => rect(l - n, t - n, r + n, b + n);
const same = (a, b) => a.x === b.x && a.y === b.y;
const along = (a, b) => a.x === b.x || a.y === b.y;
const between = (a, b, c) => along(a, c) && dist(a, c) === dist(a, b) + dist(b, c);
const step = ({ x, y }, side, n) => ({ x: x + DIR[side][0] * n, y: y + DIR[side][1] * n });
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const overlap = (a, b, c, d) => Math.min(Math.max(a, b), Math.max(c, d)) - Math.max(Math.min(a, b), Math.min(c, d));
const inBox = (a, { l, t, r, b }) => l < a.x && a.x < r && t < a.y && a.y < b;
const intersects = (a, b, { l, t, r, b: bottom }) => a.y === b.y
  ? t < a.y && a.y < bottom && overlap(a.x, b.x, l, r) > 0
  : l < a.x && a.x < r && overlap(a.y, b.y, t, bottom) > 0;
const coincides = (a, b, c, d) => a.y === b.y
  ? c.y === d.y && Math.abs(a.y - c.y) <= 1 && overlap(a.x, b.x, c.x, d.x) > 0
  : c.x === d.x && Math.abs(a.x - c.x) <= 1 && overlap(a.y, b.y, c.y, d.y) > 0;
const segments = points => points.slice(1).map((point, i) => [points[i], point]);

function route(start, end, boxes, used) {
  const clear = (a, b) => !boxes.some(box => intersects(a, b, box)) && !used.some(([c, d]) => coincides(a, b, c, d));
  if (along(start, end) && clear(start, end)) return [start, end];
  const xs = new Set([start.x, end.x]), ys = new Set([start.y, end.y]);
  for (const { l, t, r, b } of boxes) { xs.add(l); xs.add(r); ys.add(t); ys.add(b); }
  for (const [a, b] of used) {
    if (a.x === b.x) { xs.add(a.x - 8); xs.add(a.x + 8); }
    if (a.y === b.y) { ys.add(a.y - 8); ys.add(a.y + 8); }
  }
  const x = [...xs].sort((a, b) => a - b), y = [...ys].sort((a, b) => a - b);
  // Most edges fit a direct L or a single dogleg. Rank by distance and bends.
  const candidates = [
    ...x.map(px => [start, { x: px, y: start.y }, { x: px, y: end.y }, end]),
    ...y.map(py => [start, { x: start.x, y: py }, { x: end.x, y: py }, end]),
  ].map(points => points.filter((p, i) => !i || !same(p, points[i - 1])));
  candidates.sort((a, b) => cost(a) - cost(b));
  const simple = candidates.find(points => segments(points).every(([a, b]) => clear(a, b)));
  if (simple) return simple;

  // A bounded visibility-grid search covers blocked doglegs without rasterizing the scene.
  const queue = [], best = new Map();
  function offer(i, j, dir, distance, prev) {
    const key = `${i}:${j}:${dir}`, p = { x: x[i], y: y[j] };
    if (distance >= (best.get(key) ?? Infinity) || boxes.some(box => inBox(p, box))) return;
    best.set(key, distance);
    queue.push({ i, j, dir, distance, prev, p, key, score: distance + dist(p, end) });
  }
  offer(x.indexOf(start.x), y.indexOf(start.y), -1, 0, null);
  for (let work = 0; queue.length && work < 6000; work++) {
    queue.sort((a, b) => b.score - a.score);
    const current = queue.pop();
    if (current.distance !== best.get(current.key)) continue;
    if (same(current.p, end)) {
      const points = [];
      for (let p = current; p; p = p.prev) points.push(p.p);
      return points.reverse();
    }
    for (const [di, dj] of Object.values(DIR)) {
      const i = current.i + di, j = current.j + dj, dir = di ? 0 : 1;
      if (x[i] === undefined || y[j] === undefined) continue;
      const p = { x: x[i], y: y[j] };
      if (clear(current.p, p)) offer(i, j, dir, current.distance + dist(current.p, p) + (dir === current.dir ? 0 : 12), current);
    }
  }
  return null;
}
const cost = points => segments(points).reduce((sum, [a, b]) => sum + dist(a, b) + 12, 0);

function iconShape(ctx, icon, x, y, size, ink) {
  if (!icon) return [];
  const [l, t, w, h] = icon.viewBox.split(/\s+/).map(Number);
  const scale = size / Math.max(w, h);
  const solid = icon.set === 'simple';
  return [ctx.el('g', { transform: `translate(${x - (l + w / 2) * scale} ${y - (t + h / 2) * scale}) scale(${scale})`, fill: solid ? ink : 'none', stroke: solid ? 'none' : ink, 'stroke-width': 1.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, icon.elements.map(({ tag, attrs }) => ctx.shape(tag, attrs)))];
}

function trackCenters(sizes, gap) {
  let end = 0;
  return sizes.map(size => {
    const start = end;
    end += size + gap;
    return start + size / 2;
  });
}

const honoredConfig = ['architecture.padding', 'architecture.iconSize', 'architecture.fontSize'];
const configKey = (map, name) => Object.entries(map ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];

function layout(model, { width, measure, ctx, lang }, info) {
  const { items, nodes, groups, edges, xy } = model;
  const failure = (line, zh, en) => ({ errors: [error(lang, line, zh, en, '调整对齐、端口或组的连接', 'Adjust alignment, ports, or group connections')] });
  const style = appearance(ctx), ink = ctx.frameTone(style.fg2), edgeInk = ctx.frameTone(style.fg1);
  const config = configKey(info.config, 'architecture');
  const dimension = (name, fallback, min, max) => {
    const value = configKey(config, name);
    return typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(min, Math.min(max, value))) : fallback;
  };
  const iconSize = dimension('iconSize', 32, 16, 160);
  const padding = dimension('padding', 14, 10, 80);
  const font = { ...FONT.body, size: dimension('fontSize', FONT.body.size, 12, 48) };
  const leading = Math.ceil(font.size * 1.22);
  const rows = value => value ? wrapText(value, Math.max(112, font.size * 7), font, measure) : [];
  const withLink = (item, children) => item.link ? [ctx.link(item.link.href, children, item.link)] : children;
  const sizes = [[], []], cards = new Map(), frames = new Map();
  for (const node of nodes) {
    const text = rows(node.iconText);
    const contents = node.icon ? text : [];
    const labels = [...(node.icon ? [] : text), ...rows(node.label)];
    const textWidth = maxWidthOf([...labels, ...contents], font, measure) + 20;
    const w = node.kind === 'junction' ? 0 : Math.ceil(Math.max(node.icon ? Math.max(76, iconSize + 24) : 40, textWidth));
    const contentHeight = node.icon ? Math.max(58, 20 + contents.length * leading + iconSize + (contents.length ? 8 : 0)) : 0;
    const h = !w ? 0 : node.icon
      ? contentHeight + (labels.length ? 6 + labels.length * leading : 0)
      : Math.max(36, labels.length * leading + 16);
    const card = { labels, contents, contentHeight, w, h };
    cards.set(node.id, card);
    for (const [axis, size] of [w, h].entries()) {
      const i = xy[axis].get(node.id);
      sizes[axis][i] = Math.max(size, sizes[axis][i] || 0);
    }
  }
  const depth = groups.reduce((n, group) => Math.max(n, group.depth + 1), 0);
  const labelGap = Math.max(0, ...edges.filter(e => e.label || e.icon).map(e => Math.ceil(maxWidthOf(rows(e.label), font, measure)) + (e.icon ? 24 : 0) + 24));
  const frameHeader = 30 + padding;
  const centers = [trackCenters(sizes[0], Math.max(44, labelGap, 2 * padding + 16) + padding * Math.max(0, depth - 1)), trackCenters(sizes[1], (depth ? 22 + frameHeader + padding : 50) + (frameHeader + padding) * Math.max(0, depth - 1))];
  for (const [id, card] of cards) {
    const [x, y] = centers.map((axis, i) => axis[xy[i].get(id)]);
    Object.assign(card, rect(x - card.w / 2, y - card.h / 2, x + card.w / 2, y + card.h / 2));
  }
  let emptyStart = Math.max(0, ...[...cards.values()].map(card => card.r)) + 50 + depth * 14;
  for (const group of [...groups].reverse()) {
    const children = [...items.values()].filter(item => item.parent === group.id).map(item => cards.get(item.id) ?? frames.get(item.id));
    const text = group.label.split('\n'), titleWidth = maxWidthOf(text, FONT.title, measure), headerWidth = titleWidth + (group.icon ? 26 : 0) + 24;
    const extra = (text.length - 1) * 16;
    const left = children.length ? Math.min(...children.map(child => child.l)) - padding : emptyStart;
    const top = children.length ? Math.min(...children.map(child => child.t)) - frameHeader - extra : 0;
    const right = Math.max(left + Math.max(66, headerWidth), ...children.map(child => child.r + padding));
    const bottom = Math.max(top + 56 + extra, ...children.map(child => child.b + padding));
    frames.set(group.id, { ...rect(left, top, right, bottom), header: (text || group.icon) ? rect(left - 4, top + 4, left + headerWidth - 6, top + 27 + extra) : null });
    if (!children.length) emptyStart = right + 30 + depth * 14;
  }
  const cardShapes = [], frameShapes = [], paths = [], plates = [], used = [], labelBoxes = [];
  for (const group of groups) {
    const { l, t, r, b } = frames.get(group.id);
    const stroke = style[group.status] ?? ink;
    const shapes = [ctx.rect(l, t, r - l, b - t, { rx: style.radius, fill: style.surface, stroke, meta: { kind: 'frame', id: group.id } }),
      ...iconShape(ctx, group.icon, l + 20, t + 15, 18, stroke)];
    const lines = group.label.split('\n');
    if (group.label) shapes.push(textBlock(ctx, { x: l + (group.icon ? 38 : 12), y: t + 15 + (lines.length - 1) * 8, lines, lineHeight: 16, font: FONT.title, anchor: 'start' }));
    frameShapes.push(...withLink(group, shapes));
  }
  for (const node of nodes) {
    const { l, t, w, h, x, y, labels, contents, contentHeight } = cards.get(node.id);
    if (node.kind === 'junction') {
      if (node.link) cardShapes.push(...withLink(node, [ctx.shape('circle', { cx: x, cy: y, r: 6, fill: 'transparent' })]));
      continue;
    }
    const iconY = contents.length ? t + 10 + iconSize / 2 : t + contentHeight / 2;
    const stroke = style[node.status] ?? ink;
    const shapes = [ctx.rect(l, t, w, h, { rx: style.smallRadius, fill: style.node, stroke, meta: { kind: 'node', id: node.id } }),
      ...iconShape(ctx, node.icon, x, iconY, iconSize, style[node.status] ?? edgeInk)];
    if (contents.length) shapes.push(textBlock(ctx, { x, y: t + contentHeight - 10 - contents.length * leading / 2, lines: contents, lineHeight: leading, font }));
    if (labels.length) shapes.push(textBlock(ctx, { x, y: node.icon ? t + h - 8 - labels.length * leading / 2 : y, lines: labels, lineHeight: leading, font }));
    cardShapes.push(...withLink(node, shapes));
  }

  // Repeated service ports fan out along their side, ordered by the opposite endpoint.
  const ports = new Map();
  const ends = edges.map(edge => [[edge.from, edge.lhs, edge.lhsGroup], [edge.to, edge.rhs, edge.rhsGroup]].map(([id, side, group]) => {
    const box = group ? frames.get(group) : cards.get(id);
    const end = { id, side, group, box };
    const key = `${group ?? id}:${side}`;
    if (!ports.has(key)) ports.set(key, []);
    ports.get(key).push(end);
    return end;
  }));
  for (const [a, b] of ends) { a.other = b.box; b.other = a.box; }
  for (const list of ports.values()) {
    const { side, box, group } = list[0], horizontal = side === 'L' || side === 'R';
    const coordinate = horizontal ? 'y' : 'x';
    list.sort((a, b) => a.other[coordinate] - b.other[coordinate]);
    const low = horizontal ? box.t + (group ? 34 : 10) : box.l + 10;
    const high = horizontal ? box.b - 10 : box.r - 10;
    list.forEach((end, i) => {
      const mid = Math.max(low, Math.min(high, box[coordinate]));
      const pitch = Math.min(12, (high - low) / Math.max(1, list.length - 1));
      const start = Math.max(low, Math.min(high - pitch * (list.length - 1), mid - pitch * (list.length - 1) / 2));
      const offset = high < low ? box[coordinate] : start + i * pitch;
      end.point = horizontal ? { x: side === 'L' ? box.l : box.r, y: offset } : { x: offset, y: side === 'T' ? box.t : box.b };
      end.tip = step(end.point, side, 10);
    });
  }
  const within = (id, group) => {
    for (let parent = items.get(id).parent; parent; parent = items.get(parent).parent) if (parent === group) return true;
    return false;
  };
  const portSegments = ends.map(pair => pair.map(({ point, tip }) => [point, tip]));
  for (const [i, edge] of edges.entries()) {
    const [a, b] = ends[i];
    const boxes = [];
    for (const [id, card] of cards) {
      if (card.w) boxes.push(inflate(card, 6));
      else if (id !== a.id && id !== b.id) boxes.push(inflate(card, 4));
    }
    for (const [id, frame] of frames) {
      if (id === a.group || id === b.group || (!within(a.id, id) && !within(b.id, id))) boxes.push(inflate(frame, 6));
      else if (frame.header) boxes.push(inflate(frame.header, 4));
    }
    const stubs = portSegments[i];
    const path = route(a.tip, b.tip, boxes, [...used, ...portSegments.slice(i).flat()]);
    if (!path || stubs.some(([p, q]) => used.some(([c, d]) => coincides(p, q, c, d)))) return failure(edge.line, '无法为边找到不重叠的路径', 'Could not route edge without overlapping another edge or element');
    const joints = [a.point, ...path, b.point].filter((p, j, all) => !j || !same(p, all[j - 1]));
    const points = joints.filter((p, j) => !j || j === joints.length - 1 || !between(joints[j - 1], p, joints[j + 1]));
    const parts = segments(points);
    used.push(...parts);
    const stroke = style[edge.status] ?? edgeInk;
    paths.push(ctx.shape('polyline', { points: points.map(p => `${p.x},${p.y}`).join(' '), fill: 'none', stroke, 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, { kind: 'edge', from: edge.from, to: edge.to }));
    for (const [end, arrow] of [[a, edge.back], [b, edge.forward]]) if (arrow) {
      const base = step(end.point, end.side, 8), [dx, dy] = DIR[end.side];
      paths.push(ctx.shape('polygon', { points: `${end.point.x},${end.point.y} ${base.x - dy * 4},${base.y + dx * 4} ${base.x + dy * 4},${base.y - dx * 4}`, fill: stroke }));
    }
    if (edge.label || edge.icon) plates.push({ edge, parts });
  }
  const labels = [];
  for (const { edge, parts } of plates) {
    const lines = rows(edge.label), w = Math.ceil(maxWidthOf(lines, font, measure)) + 14 + (edge.icon ? 24 : 0), h = Math.max(lines.length * leading, edge.icon ? 16 : 0) + 6;
    const candidates = [...parts].sort(([a, b], [c, d]) => dist(c, d) - dist(a, b)).flatMap(([a, b]) => {
      const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      return a.y === b.y ? [rect(x - w / 2, y - h - 5, x + w / 2, y - 5), rect(x - w / 2, y + 5, x + w / 2, y + h + 5)]
        : [rect(x + 5, y - h / 2, x + w + 5, y + h / 2), rect(x - w - 5, y - h / 2, x - 5, y + h / 2)];
    });
    const obstacles = [...cards.values(), ...labelBoxes, ...[...frames.values()].map(f => f.header).filter(Boolean)];
    const box = candidates.find(box => !obstacles.some(o => overlap(o.l, o.r, box.l, box.r) > -4 && overlap(o.t, o.b, box.t, box.b) > -4) && !used.some(([a, b]) => intersects(a, b, inflate(box, 2))));
    if (!box) return failure(edge.line, '没有空间放置边标签', 'No room for edge label');
    labelBoxes.push(box);
    labels.push({ ...ctx.el('g', {}, [ctx.rect(box.l, box.t, w, h, { rx: style.smallRadius, fill: style.surface }), ...iconShape(ctx, edge.icon, box.l + 17, box.y, 16, edgeInk), textBlock(ctx, { x: box.x + (edge.icon ? 12 : 0), y: box.y, lines, lineHeight: leading, font })]), meta: { kind: 'edge-label-group', from: edge.from, to: edge.to } });
  }
  const bounds = [...cards.values(), ...frames.values(), ...labelBoxes, ...used.flat().map(({ x, y }) => rect(x, y, x, y))];
  const l = Math.min(0, ...bounds.map(box => box.l)), t = Math.min(0, ...bounds.map(box => box.t));
  const naturalWidth = 40 + Math.max(0, ...bounds.map(box => box.r)) - l;
  const height = 40 + Math.max(0, ...bounds.map(box => box.b)) - t;
  const children = [ctx.el('g', { transform: `translate(${20 - l} ${20 - t})` }, [...frameShapes, ...paths, ...cardShapes, ...labels])];
  const errors = naturalWidth > width * 2 || nodes.length > 60
    ? [warning('LARGE_DIAGRAM', lang, 1, '架构图较大', 'Large architecture diagram', '考虑拆分架构图', 'Consider splitting the diagram')] : [];
  return { scene: { width: naturalWidth, height, children, title: model.title, heading: model.title }, errors };
}

// Mermaid 12.3.0 parses only `architecture-beta`, so that is the canonical kind; `architecture` stays an alias.
const implementations = { 'architecture-beta': { parse, layout, acceptsPresentation: true, honoredConfig } };
export { implementations };
