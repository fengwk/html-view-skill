/* Swimlane graph geometry migrated from the legacy implementation; output is a shared SVG scene. */

import { FONT, appearance as appearanceOf, error as issueAt, labelText, maxWidthOf, snap, statusMarks, wrapText } from './support.js';
import { parseFlow } from './graph-parse.js';

const LIMITS = { lanes: 6, nodes: 30, edges: 50, backEdges: 3, lines: 3, labelWidth: 208 };
const HEADER = 36;
const LANE_PAD = 6;
const STEP_PAD = 6;
const NODE_GAP = 10;
const NODE_PAD_X = 28;
const NODE_PAD_Y = 16;
const LANE_GAP = 12;
const STEP_GAP = 24;
const OUTER = 4;
const TRACK = 12;
const CLEAR = 12;
const PORT_GAP = 12;
const PORT_SPREAD = 24;
const PORT_INSET = 10;
const HOP_R = 5;
const ZONE_PAD = 4;
const LABEL_GAP = 8;
const LABEL_EDGE = 8;
const MIN_LANE_TB = 44;
const MIN_LANE_LR = 40;
const MIN_STEP = 40;
const issue = (lang, line, zh, en, fixZh, fixEn) => issueAt(lang, line, zh, en, fixZh, fixEn);

function directionOf(options, body, ctx) {
  const declared = options.LR === true ? 'LR' : options.TB === true ? 'TB' : null;
  const line = body.find((row) => /^direction\s+/i.test(row.text));
  const written = line ? line.text.replace(/^direction\s+/i, '').trim().toUpperCase() : null;
  const normalized = written === 'TD' ? 'TB' : written;
  if (declared && normalized && declared !== normalized) return { error: issue(ctx.lang, line.line, '泳道方向声明冲突', 'Conflicting swimlane directions', '只保留 swimlane LR/TB 或正文 direction 其中一种', 'Keep either swimlane LR/TB or one direction statement') };
  const direction = declared || normalized || 'TB';
  if (!['TB', 'LR'].includes(direction)) return { error: issue(ctx.lang, line?.line || ctx.firstLine - 1, '泳道只支持 TB 或 LR', 'Swimlanes only support TB or LR', '改成 swimlane、swimlane LR 或 direction TB/LR', 'Use swimlane, swimlane LR, or direction TB/LR') };
  return { direction, line };
}

function parse(source, info = {}) {
  const ctx = { ...info, lang: info.lang || 'zh', firstLine: info.firstLine || 1, options: info.options || {} };
  const errors = [];
  const { lang } = ctx;
  for (const key of Object.keys(ctx.options)) if (!['LR', 'TB'].includes(key)) errors.push(issue(lang, ctx.firstLine - 1, `swimlane 不支持选项「${key}」`, `Unsupported swimlane option: ${key}`, '只使用 swimlane、swimlane LR 或 swimlane TB', 'Use only swimlane, swimlane LR, or swimlane TB'));
  const rows = String(source).split('\n').map((raw, index) => ({ raw, line: ctx.firstLine + index })).filter((row) => row.raw.trim() && !row.raw.trimStart().startsWith('%%'));
  if (rows.some((row) => /^\s*\t/.test(row.raw))) errors.push(issue(lang, rows.find((row) => /^\s*\t/.test(row.raw)).line, '缩进不能使用 Tab', 'Tabs are not allowed in indentation', '把 Tab 换成空格', 'Replace tabs with spaces'));
  const body = rows.filter((row) => !/^\s*\t/.test(row.raw)).map((row) => ({ ...row, indent: row.raw.match(/^ */)[0].length, text: row.raw.trim() }));
  const direction = directionOf(ctx.options, body, ctx);
  if (direction.error) errors.push(direction.error);
  const lanes = [];
  const laneByName = new Map();
  const ownership = new Map();
  const statements = [];
  let current = null;
  let laneIndent = null;
  for (const row of body) {
    if (/^direction\b/i.test(row.text)) continue;
    if (/^lane\s+/i.test(row.text)) {
      if (row.indent !== 0) errors.push(issue(lang, row.line, 'lane 必须写在顶层', 'lane must be at the top level', '去掉 lane 前面的缩进', 'Remove indentation before lane'));
      const name = row.text.replace(/^lane\s+/i, '').trim();
      if (!name || laneByName.has(name)) errors.push(issue(lang, row.line, `泳道名称无效或重复：${name || '（空）'}`, `Invalid or duplicate lane: ${name || '(empty)'}`, '给每条泳道一个不重复的名称', 'Give each lane a unique name'));
      current = { id: `lane-${lanes.length}`, name, line: row.line };
      lanes.push(current);
      laneByName.set(name, current);
      laneIndent = null;
      continue;
    }
    if (current && row.indent > 0) {
      if (laneIndent == null) laneIndent = row.indent;
      if (row.indent !== laneIndent) errors.push(issue(lang, row.line, '同一泳道内的缩进不一致', 'Inconsistent indentation inside a lane', `把这一行缩进改为 ${laneIndent} 个空格`, `Indent this line with ${laneIndent} spaces`));
      statements.push(row);
      continue;
    }
    if (row.indent === 0) { current = null; statements.push(row); continue; }
    errors.push(issue(lang, row.line, '节点必须写在 lane 下面', 'A node must be indented under a lane', '先声明 lane，再缩进写节点', 'Declare a lane, then indent its nodes'));
  }
  if (!lanes.length) errors.push(issue(lang, ctx.firstLine, '图中没有泳道', 'Swimlane diagram has no lanes', '添加 lane 名称和缩进的节点', 'Add lane names and indented nodes'));
  if (lanes.length > LIMITS.lanes) errors.push(issue(lang, lanes[LIMITS.lanes].line, `最多 ${LIMITS.lanes} 条泳道`, `At most ${LIMITS.lanes} lanes`, '把流程拆成两张泳道图', 'Split the flow into two swimlane diagrams'));
  const flow = parseFlow(statements.map(({ text, line }) => ({ text, line })), { direction: direction.direction || 'TB' });
  errors.push(...flow.errors.filter((error) => !/超过上限/.test(error.message)));
  const model = flow.model;
  const defined = new Map();
  let scanLane = null;
  for (const row of body) {
    if (/^lane\s+/i.test(row.text) && row.indent === 0) { scanLane = lanes.find((lane) => lane.line === row.line); continue; }
    if (!scanLane || row.indent === 0) { scanLane = null; continue; }
    for (const match of row.text.matchAll(/(?:^|[\s&])([A-Za-z_][\w-]*)\s*[\[\(\{>]/g)) {
      const id = match[1];
      if (defined.has(id) && defined.get(id) !== scanLane.id) errors.push(issue(lang, row.line, `节点 ${id} 重复归属`, `Node ${id} belongs to more than one lane`, '只在一条泳道里定义这个节点', 'Define this node in only one lane'));
      else defined.set(id, scanLane.id);
    }
  }
  const laneStatements = new Set();
  body.forEach((row) => { if (row.indent > 0) laneStatements.add(row.line); });
  for (const node of model.nodes) {
    if (!laneStatements.has(node.line)) errors.push(issue(lang, node.line, `节点 ${node.id} 没有泳道`, `Node ${node.id} has no lane`, '把节点定义缩进到对应 lane 下面', 'Indent the node definition under its lane'));
    else if (ownership.has(node.id)) errors.push(issue(lang, node.line, `节点 ${node.id} 重复归属`, `Node ${node.id} belongs to more than one lane`, '只在一条泳道里定义这个节点', 'Define this node in only one lane'));
    else {
      const owner = [...lanes].reverse().find((lane) => lane.line < node.line);
      ownership.set(node.id, owner?.id || null);
    }
  }
  if (model.nodes.length > LIMITS.nodes) errors.push(issue(lang, model.nodes[LIMITS.nodes].line, `最多 ${LIMITS.nodes} 个节点`, `At most ${LIMITS.nodes} nodes`, '拆成总图和局部图', 'Split into an overview and a detail diagram'));
  if (model.edges.length > LIMITS.edges) errors.push(issue(lang, model.edges[LIMITS.edges].line, `最多 ${LIMITS.edges} 条连线`, `At most ${LIMITS.edges} edges`, '拆成总图和局部图', 'Split into an overview and a detail diagram'));
  return { model: { type: 'swimlane', direction: direction.direction || 'TB', lanes: lanes.map((lane) => ({ ...lane, nodes: model.nodes.filter((node) => ownership.get(node.id) === lane.id).map((node) => node.id) })), nodes: model.nodes.map((node) => ({ id: node.id, label: labelText(node.label), shape: node.shape, class: node.class || null, lane: ownership.get(node.id) || null, line: node.line })), edges: model.edges.map((edge) => ({ id: `e${edge.seq}`, from: edge.from, to: edge.to, label: labelText(edge.label), style: edge.style, line: edge.line })) }, errors };
}

function backEdgesOf(nodes, edges) {
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  edges.forEach((edge, index) => outgoing.get(edge.from)?.push({ edge, index }));
  for (const list of outgoing.values()) list.sort((a, b) => a.index - b.index);
  const seen = new Set();
  const stack = new Set();
  const back = [];
  const visit = (id) => {
    seen.add(id); stack.add(id);
    for (const item of outgoing.get(id) || []) {
      if (stack.has(item.edge.to)) back.push(item.edge);
      else if (!seen.has(item.edge.to)) visit(item.edge.to);
    }
    stack.delete(id);
  };
  for (const node of nodes) if (!seen.has(node.id)) visit(node.id);
  return back;
}

function stepsOf(nodes, edges, back) {
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) if (!back.has(edge)) { incoming.set(edge.to, incoming.get(edge.to) + 1); outgoing.get(edge.from).push(edge.to); }
  const step = new Map(nodes.map((node) => [node.id, 0]));
  const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  const seen = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of outgoing.get(id)) {
      step.set(next, Math.max(step.get(next), step.get(id) + 1));
      incoming.set(next, incoming.get(next) - 1);
      if (incoming.get(next) === 0) queue.push(next);
    }
  }
  return step;
}

function segments(points) {
  const result = [];
  for (let i = 1; i < points.length; i += 1) {
    const [a, b] = [points[i - 1], points[i]];
    if (a.x === b.x && a.y === b.y) continue;
    result.push({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
  }
  return result;
}

function simplify(points) {
  const result = [];
  for (const point of points) {
    if (result.length && result[result.length - 1].x === point.x && result[result.length - 1].y === point.y) continue;
    while (result.length > 1 && ((result[result.length - 2].x === result[result.length - 1].x && result[result.length - 1].x === point.x) || (result[result.length - 2].y === result[result.length - 1].y && result[result.length - 1].y === point.y))) result.pop();
    result.push(point);
  }
  return result;
}

// 两条连线相交时，横线在交点处拱起一个小半圆，交叉就不会被读成分叉。
function crossingsOf(edges) {
  const verticals = [];
  for (const edge of edges) for (const part of segments(edge.points)) if (part.w === 0) verticals.push({ edge, x: part.x, lo: part.y, hi: part.y + part.h });
  const result = new Map(edges.map((edge) => [edge, []]));
  for (const edge of edges) for (const part of segments(edge.points)) {
    if (part.h !== 0) continue;
    for (const upright of verticals) {
      if (upright.edge === edge) continue;
      if (!(part.x + HOP_R < upright.x && upright.x < part.x + part.w - HOP_R)) continue;
      if (!(upright.lo + HOP_R < part.y && part.y < upright.hi - HOP_R)) continue;
      result.get(edge).push({ x: upright.x, y: part.y });
    }
  }
  return result;
}

function pathData(points, hops) {
  const parts = [`M${points[0].x} ${points[0].y}`];
  for (let i = 1; i < points.length; i += 1) {
    const [from, to] = [points[i - 1], points[i]];
    if (from.y === to.y) {
      const direction = to.x > from.x ? 1 : -1;
      const list = hops.filter((hop) => hop.y === from.y && (hop.x - from.x) * direction > 0 && (to.x - hop.x) * direction > 0)
        .sort((a, b) => (a.x - b.x) * direction);
      for (const hop of list) {
        parts.push(`L${hop.x - direction * HOP_R} ${hop.y}`);
        parts.push(`A${HOP_R} ${HOP_R} 0 0 ${direction > 0 ? 1 : 0} ${hop.x + direction * HOP_R} ${hop.y}`);
      }
    }
    parts.push(`L${to.x} ${to.y}`);
  }
  return parts.join(' ');
}

// 通道宽度：n 条轨道相邻相隔 TRACK，两侧各留 CLEAR。
const capacity = (tracks, floor) => Math.max(floor, tracks ? CLEAR * 2 + (tracks - 1) * TRACK : 0);

// 走廊里的长竖线按步序区间分轨道；端点相接也算相交，免得一条线的端点落在另一条线上。
function assignTracks(runs) {
  const tracks = [];
  for (const run of [...runs].sort((a, b) => a.lo - b.lo || a.hi - b.hi || a.index - b.index)) {
    let track = 0;
    while ((tracks[track] || []).some((other) => other.lo <= run.hi && run.lo <= other.hi)) track += 1;
    (tracks[track] ||= []).push(run);
    run.track = track;
  }
  return tracks.length;
}

// 在“轨道须在前”的约束图里找一个环，返回环上的边；没有环时返回 null。
function findCycle(runs, orders) {
  const next = new Map();
  for (const order of orders) {
    if (!next.has(order.from)) next.set(order.from, []);
    next.get(order.from).push(order);
  }
  const state = new Map();
  const path = [];
  let cycle = null;
  const visit = (run) => {
    state.set(run, 1);
    for (const order of next.get(run) || []) {
      if (state.get(order.to) === 1) {
        const start = path.findIndex((item) => item.from === order.to);
        cycle = [...path.slice(start < 0 ? path.length : start), order];
        return;
      }
      if (!state.has(order.to)) {
        path.push(order);
        visit(order.to);
        path.pop();
      }
      if (cycle) return;
    }
    state.set(run, 2);
  };
  for (const run of runs) {
    if (!state.has(run)) visit(run);
    if (cycle) break;
  }
  return cycle;
}

// cross 是横跨流程的方向，along 是流程方向；两种方向共用一套几何，最后换算成 x / y。
export function layout(model, { measure, width, lang }) {
  const horizontal = model.direction === 'LR';
  const crossOf = (node) => horizontal ? node.h : node.w;
  const alongOf = (node) => horizontal ? node.w : node.h;
  const point = (cross, along) => horizontal ? { x: along, y: cross } : { x: cross, y: along };
  const fail = (line, zh, en, fixZh, fixEn) => ({ width, height: 0, errors: [issue(lang, line, zh, en, fixZh, fixEn)] });

  const backList = backEdgesOf(model.nodes, model.edges);
  if (backList.length > LIMITS.backEdges) return fail(backList[LIMITS.backEdges].line, `回边最多 ${LIMITS.backEdges} 条`, `At most ${LIMITS.backEdges} back edges`, '减少回环，或拆成两张图', 'Reduce loops or split into two diagrams');
  const back = new Set(backList);
  const stepOf = stepsOf(model.nodes, model.edges, back);
  if ([...stepOf.values()].some((value) => !Number.isFinite(value))) return fail(model.nodes[0]?.line || 1, '步序无法确定', 'Node steps cannot be resolved', '检查节点归属与连线', 'Check node ownership and edges');

  // 标签先量好：它决定同一边落点的间距，也决定通道里要为它留几条轨道。
  const labelOf = new Map(model.edges.map((edge) => {
    if (!edge.label) return [edge.id, null];
    const lines = wrapText(edge.label, 120, FONT.label, measure);
    const w = snap(maxWidthOf(lines, FONT.label, measure) + 12);
    const h = snap(lines.length * 16 + 8);
    return [edge.id, { lines, w, h, cross: horizontal ? h : w, along: horizontal ? w : h }];
  }));

  // 前进边从流程方向的一边出、对边进；回边反过来。一边上的落点越多、标签越宽，节点越宽。
  const sideLists = new Map();
  const addEnd = (id, side, edge, end) => {
    const key = `${id}|${side}`;
    if (!sideLists.has(key)) sideLists.set(key, []);
    sideLists.get(key).push({ edge, end });
  };
  for (const edge of model.edges) {
    const out = back.has(edge) ? -1 : 1;
    addEnd(edge.from, out, edge, 'out');
    addEnd(edge.to, -out, edge, 'in');
  }
  // 标签以起点落点为中心，所以相邻落点要让出半个标签宽；两个带标签的落点相邻时让出整个标签宽。
  const spacingOf = (list) => {
    if (list.length < 2) return PORT_GAP;
    const widths = list.filter((item) => item.end === 'out' && labelOf.get(item.edge.id)).map((item) => labelOf.get(item.edge.id).cross);
    if (!widths.length) return PORT_GAP;
    const widest = Math.max(...widths);
    return Math.max(PORT_GAP, widths.length > 1 ? widest + LABEL_GAP : widest / 2 + LABEL_GAP);
  };
  const portRoom = (id) => Math.max(PORT_INSET * 2 + PORT_GAP, ...[-1, 1].map((side) => {
    const list = sideLists.get(`${id}|${side}`) || [];
    return list.length < 2 ? 0 : PORT_INSET * 2 + (list.length - 1) * spacingOf(list);
  }));

  const nodes = [];
  for (const node of model.nodes) {
    const lines = wrapText(node.label, LIMITS.labelWidth, FONT.body, measure).slice(0, LIMITS.lines + 1);
    if (lines.length > LIMITS.lines) return fail(node.line, `节点「${node.label}」超过 ${LIMITS.lines} 行`, `Node label exceeds ${LIMITS.lines} lines: ${node.label}`, '缩短标签或把说明移到图外', 'Shorten the label or move the description outside');
    const textW = maxWidthOf(lines, FONT.body, measure);
    const textH = lines.length * 20;
    const diamond = node.shape === 'diamond';
    const room = portRoom(node.id);
    if (model.mermaid && node.shape === 'circle') {
      const diameter = snap(Math.max(room, Math.hypot(textW + 16, textH + 12)));
      nodes.push({ ...node, lines, diamond, step: stepOf.get(node.id), w: diameter, h: diameter });
      continue;
    }
    const cross = (diamond ? textW * 1.7 : textW) + NODE_PAD_X;
    const along = (diamond ? textH * 1.7 : textH) + NODE_PAD_Y;
    nodes.push({ id: node.id, label: node.label, shape: node.shape, class: node.class || null, lane: node.lane, line: node.line, lines, diamond, step: stepOf.get(node.id), w: snap(horizontal ? cross : Math.max(cross, room)), h: snap(horizontal ? Math.max(along, room) : along) });
  }
  if (!nodes.length) return fail(model.nodes[0]?.line || 1, '图中没有节点', 'Swimlane diagram has no nodes', '在泳道下缩进写节点', 'Indent nodes under a lane');
  const maxStep = Math.max(...nodes.map((node) => node.step));
  const laneCount = model.lanes.length;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const laneIndex = new Map(model.lanes.map((lane, index) => [lane.id, index]));

  // 泳道宽度只由泳道内最挤的一行决定；空或稀疏的泳道取放得下标题的最小宽度。
  const lanes = model.lanes.map((lane) => ({ lane, columns: Array.from({ length: maxStep + 1 }, () => []) }));
  for (const node of nodes) lanes[laneIndex.get(node.lane)]?.columns[node.step].push(node);
  for (const item of lanes) {
    item.rooms = item.columns.map((column) => column.reduce((sum, node) => sum + crossOf(node), 0) + NODE_GAP * Math.max(0, column.length - 1));
    const title = horizontal ? 0 : measure(item.lane.name, FONT.title) + LANE_PAD * 2;
    const groupHeadroom = horizontal ? 24 * (model.nested?.filter(group => group.lane === item.lane.id).length || 0) : 0;
    item.size = snap(Math.max(0, ...item.rooms, title, horizontal ? MIN_LANE_LR : MIN_LANE_TB) + LANE_PAD * 2 + groupHeadroom * 2);
  }
  let nominal = 0;
  const nominalAt = lanes.map((item, index) => {
    if (index) nominal += LANE_GAP;
    const value = nominal;
    nominal += item.size;
    return value;
  });
  const centerOf = (node) => nominalAt[laneIndex.get(node.lane)] + node.outset + crossOf(node) / 2;
  // 同一格里的节点按上游节点的平均位置从左到右排（逐行向下），连线因此少交叉；没有上游的保持书写顺序。
  const sources = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of model.edges) if (!back.has(edge)) sources.get(edge.to).push(nodeById.get(edge.from));
  const place = (item, column, index) => {
    let cursor = Math.round((item.size - item.rooms[index]) / 2);
    for (const node of column) { node.outset = cursor; cursor += crossOf(node) + NODE_GAP; }
  };
  for (let step = 0; step <= maxStep; step += 1) {
    for (const item of lanes) {
      const column = item.columns[step];
      place(item, column, step);
      if (column.length < 2) continue;
      const key = new Map(column.map((node) => {
        const list = sources.get(node.id);
        return [node, list.length ? list.reduce((sum, other) => sum + centerOf(other), 0) / list.length : centerOf(node)];
      }));
      column.sort((a, b) => key.get(a) - key.get(b) || nodes.indexOf(a) - nodes.indexOf(b));
      place(item, column, step);
    }
  }
  // 行高按行内最高的节点收紧，节点在行内居中，进出短线上下对称。
  const steps = Array.from({ length: maxStep + 1 }, (_, index) => snap(Math.max(MIN_STEP, ...nodes.filter((node) => node.step === index).map(alongOf)) + STEP_PAD * 2));

  const plans = model.edges.map((edge, index) => {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    const isBack = back.has(edge);
    return {
      edge, index, from, to, isBack, label: labelOf.get(edge.id),
      laneFrom: laneIndex.get(from.lane), laneTo: laneIndex.get(to.lane),
      outBand: isBack ? from.step - 1 : from.step,
      inBand: isBack ? to.step : to.step - 1,
      outSide: isBack ? -1 : 1,
      inSide: isBack ? 1 : -1,
      port: { out: 0, in: 0 },
    };
  });
  const broken = plans.find((plan) => plan.outBand < 0 || plan.inBand < 0);
  if (broken) return fail(broken.edge.line, `连线 ${broken.edge.from} → ${broken.edge.to} 无法在泳道网格内走线`, `Edge ${broken.edge.from} → ${broken.edge.to} cannot be routed on the lane grid`, '把首行的自环拆成两个节点，或让回边指向更晚的步骤', 'Split the self loop on the first row into two nodes, or point the back edge at a later step');
  const planOf = new Map(plans.map((plan) => [plan.edge, plan]));

  // 直连的竖线不能贴着中间步骤的节点走：节点离竖线至少一个落点间距。
  const middle = (node) => node.outset + crossOf(node) / 2;
  const blocked = (plan, at) => nodes.some((node) => node.lane === plan.from.lane && node !== plan.from && node !== plan.to
    && node.step > Math.min(plan.from.step, plan.to.step) && node.step < Math.max(plan.from.step, plan.to.step)
    && at > node.outset - PORT_GAP && at < node.outset + crossOf(node) + PORT_GAP);
  // 同泳道、两端节点中线对齐且中间没有阻挡的连线可以画成直线；它的落点占住节点中线。
  const aligned = (plan) => plan.laneFrom === plan.laneTo && middle(plan.from) === middle(plan.to) && !blocked(plan, middle(plan.from));

  // 落点：同一边按另一端的位置排序，出门就不交叉。有直连时它占中线，其余落点在两侧等距排开；
  // 没有直连时以中线为中心对称展开。
  const groups = new Map();
  for (const [key, list] of sideLists) {
    const node = nodeById.get(key.slice(0, key.lastIndexOf('|')));
    const items = list.map(({ edge, end }) => ({ plan: planOf.get(edge), end }));
    const heading = (item) => centerOf(item.end === 'out' ? item.plan.to : item.plan.from);
    items.sort((a, b) => heading(a) - heading(b) || a.plan.index - b.plan.index || (a.end === 'out' ? -1 : 1));
    const pinned = items.findIndex((item) => aligned(item.plan) && !item.plan.isBack) >= 0
      ? items.findIndex((item) => aligned(item.plan) && !item.plan.isBack)
      : items.findIndex((item) => aligned(item.plan));
    const half = crossOf(node) / 2 - PORT_INSET;
    const reach = pinned >= 0 ? Math.max(pinned, items.length - 1 - pinned) : (items.length - 1) / 2;
    const spacing = items.length < 2 ? 0 : Math.round(Math.max(spacingOf(list), Math.min(PORT_SPREAD, half / reach)));
    const anchor = pinned >= 0 ? pinned : (items.length - 1) / 2;
    const lo = node.outset + PORT_INSET / 2;
    const hi = node.outset + crossOf(node) - PORT_INSET / 2;
    let start = Math.round(middle(node) - anchor * spacing);
    // 一侧排不下时整组挪回节点内，直连随之放弃，改走横跳。
    start = Math.min(Math.max(start, Math.ceil(lo)), Math.floor(hi - (items.length - 1) * spacing));
    items.forEach((item, order) => { item.plan.port[item.end] = start + order * spacing; });
    const group = { items, lo, hi };
    for (const item of items) groups.set(`${item.plan.index}|${item.end}`, group);
  }
  const groupOf = (plan, end) => groups.get(`${plan.index}|${end}`);
  // 整组平移保持等距；含直连落点的组不动，直连才能保持笔直。已有折弯的通道里，落点不能挪到折弯竖线旁。
  let nearJog = () => false;
  const shiftGroup = (group, delta) => {
    if (!delta || group.items.some(({ plan }) => plan.kind === 'straight')) return false;
    const values = group.items.map(({ plan, end }) => plan.port[end] + delta);
    if (values.some((value) => value < group.lo || value > group.hi)) return false;
    if (group.items.some(({ plan, end }, index) => nearJog(plan, end, values[index]))) return false;
    group.items.forEach(({ plan, end }, index) => { plan.port[end] = values[index]; });
    return true;
  };

  // 直连：同泳道、落点对齐且不受阻挡。差几像素的整组挪齐，免得出现几像素的小折线。
  const straightable = (plan) => plan.laneFrom === plan.laneTo && plan.port.out === plan.port.in && !blocked(plan, plan.port.out);
  for (const plan of plans) if (straightable(plan)) plan.kind = 'straight';
  for (const plan of plans) {
    if (plan.kind || plan.laneFrom !== plan.laneTo) continue;
    const dx = plan.port.in - plan.port.out;
    if (Math.abs(dx) >= PORT_GAP || blocked(plan, plan.port.out)) continue;
    if (shiftGroup(groupOf(plan, 'in'), -dx) || shiftGroup(groupOf(plan, 'out'), dx)) plan.kind = 'straight';
  }
  for (const plan of plans) {
    if (plan.kind) continue;
    plan.kind = plan.outBand === plan.inBand ? 'jump' : 'bend';
    if (plan.kind === 'bend') {
      plan.corridor = plan.laneFrom !== plan.laneTo ? Math.max(plan.laneFrom, plan.laneTo)
        : (plan.port.out + plan.port.in) / 2 < lanes[plan.laneFrom].size / 2 ? plan.laneFrom : plan.laneFrom + 1;
    }
  }

  // 走廊：长竖线按步序区间分轨道，走廊宽度随之确定，泳道的绝对位置也就定了。
  const corridorRuns = new Map();
  for (const plan of plans) {
    if (plan.kind !== 'bend') continue;
    plan.rail = { index: plan.index, lo: Math.min(plan.outBand, plan.inBand), hi: Math.max(plan.outBand, plan.inBand) };
    if (!corridorRuns.has(plan.corridor)) corridorRuns.set(plan.corridor, []);
    corridorRuns.get(plan.corridor).push(plan.rail);
  }
  const gaps = Array.from({ length: laneCount + 1 }, (_, index) => capacity(assignTracks(corridorRuns.get(index) || []), index === 0 || index === laneCount ? OUTER : LANE_GAP));
  let crossCursor = gaps[0];
  const laneAt = lanes.map((item, index) => {
    if (index) crossCursor += gaps[index];
    const value = crossCursor;
    crossCursor += item.size;
    return value;
  });
  const crossTotal = crossCursor + gaps[laneCount];
  const gapEnd = (corridor) => corridor <= 0 ? 0 : laneAt[corridor - 1] + lanes[corridor - 1].size;
  const railAt = (plan) => gapEnd(plan.corridor) + CLEAR + plan.rail.track * TRACK;
  const at = (plan, end) => laneAt[end === 'out' ? plan.laneFrom : plan.laneTo] + plan.port[end];

  // 通道里的横线：横跳一条，转折两条（出发通道一条、到达通道一条）。横跳必要时从中间折一次，
  // 拆成上下两段（after 指向下一段），中间的竖线叫折弯（jog）。
  const bandRuns = new Map();
  const addRun = (band, run) => {
    if (!bandRuns.has(band)) bandRuns.set(band, []);
    bandRuns.get(band).push(run);
  };
  for (const plan of plans) {
    if (plan.kind === 'jump') {
      const run = { plan, index: plan.index, ends: ['out', 'in'] };
      plan.runs = { out: run, in: run };
      addRun(plan.outBand, run);
    } else if (plan.kind === 'bend') {
      plan.runs = { out: { plan, index: plan.index, ends: ['out'], rail: true }, in: { plan, index: plan.index, ends: ['in'], rail: true } };
      addRun(plan.outBand, plan.runs.out);
      addRun(plan.inBand, plan.runs.in);
    }
  }
  // 落点在节点下方的短线从通道顶部伸到自己的轨道（upper），在节点上方的从自己的轨道伸到通道底部（lower）。
  const classOf = (plan, end) => (end === 'out' ? plan.outSide : plan.inSide) > 0 ? 'upper' : 'lower';
  const throughs = (band) => plans.filter((plan) => plan.kind === 'straight' && band >= Math.min(plan.outBand, plan.inBand) && band <= Math.max(plan.outBand, plan.inBand));
  const stubsOf = (runs) => runs.flatMap((run) => run.ends.map((end) => ({ run, plan: run.plan, end, at: at(run.plan, end), cls: classOf(run.plan, end) })));
  const jogsIn = (band) => (bandRuns.get(band) || []).filter((run) => run.after).map((run) => run.jog);
  const railsIn = (band) => plans.filter((plan) => plan.kind === 'bend' && band >= plan.rail.lo && band <= plan.rail.hi).map(railAt);
  nearJog = (plan, end, value) => jogsIn(end === 'out' ? plan.outBand : plan.inBand)
    .some((jog) => Math.abs(jog - (laneAt[end === 'out' ? plan.laneFrom : plan.laneTo] + value)) < PORT_GAP);

  // 同一通道里离得不到 12px 的上下两段短线，必须让上排短线的轨道在前；
  // 约束成环或碰上直连竖线时，把其中一组落点整组挪开。
  const conflictsIn = (band) => {
    const runs = bandRuns.get(band) || [];
    const stubs = stubsOf(runs);
    const found = [];
    for (let i = 0; i < stubs.length; i += 1) for (let j = i + 1; j < stubs.length; j += 1) {
      const [a, b] = [stubs[i], stubs[j]];
      if (a.run === b.run || Math.abs(a.at - b.at) >= PORT_GAP) continue;
      if (a.cls === b.cls) found.push({ kind: 'apart', a, b });
      else found.push({ kind: 'order', upper: a.cls === 'upper' ? a : b, lower: a.cls === 'upper' ? b : a });
    }
    for (const through of throughs(band)) for (const stub of stubs) {
      if (stub.plan !== through && Math.abs(stub.at - at(through, 'out')) < PORT_GAP) found.push({ kind: 'apart', a: { at: at(through, 'out') }, b: stub });
    }
    return found;
  };
  const keyOf = (item) => item.kind === 'order'
    ? `o|${item.upper.plan.index}|${item.upper.end}|${item.lower.plan.index}|${item.lower.end}`
    : `a|${item.a.plan?.index ?? 's'}|${item.a.end ?? ''}|${item.b.plan.index}|${item.b.end}`;
  const moveAway = (stub, fixed) => {
    const right = fixed + PORT_GAP - stub.at;
    const left = fixed - PORT_GAP - stub.at;
    return (Math.abs(right) <= Math.abs(left) ? [right, left] : [left, right]).some((delta) => shiftGroup(groupOf(stub.plan, stub.end), delta));
  };
  const ignored = new Set();
  const tried = new Set();
  const orderEdges = (band) => {
    const edges = conflictsIn(band).filter((item) => item.kind === 'order' && !ignored.has(keyOf(item))).map((item) => ({ from: item.upper.run, to: item.lower.run, item }));
    for (const run of bandRuns.get(band) || []) if (run.after) edges.push({ from: run, to: run.after, item: null });
    return edges;
  };
  // 把横跳从两端之间最宽的空档折一次：折弯离所有短线、直连和走廊竖线都至少 12px。
  const dogleg = (run, band) => {
    const { plan } = run;
    const upperEnd = run.ends.find((end) => classOf(plan, end) === 'upper');
    const lowerEnd = run.ends.find((end) => classOf(plan, end) === 'lower');
    if (!upperEnd || !lowerEnd) return false;
    const [lo, hi] = [Math.min(at(plan, upperEnd), at(plan, lowerEnd)), Math.max(at(plan, upperEnd), at(plan, lowerEnd))];
    const marks = [lo, hi, ...stubsOf(bandRuns.get(band)).map((stub) => stub.at), ...throughs(band).map((other) => at(other, 'out')), ...jogsIn(band), ...railsIn(band)]
      .filter((value) => value >= lo && value <= hi).sort((a, b) => a - b);
    let best = null;
    for (let i = 1; i < marks.length; i += 1) {
      const gap = marks[i] - marks[i - 1];
      if (gap >= PORT_GAP * 2 && (!best || gap > best.gap)) best = { gap, x: Math.round((marks[i] + marks[i - 1]) / 2) };
    }
    if (!best) return false;
    const low = { plan, index: plan.index, ends: [lowerEnd], jog: best.x };
    const up = { plan, index: plan.index, ends: [upperEnd], jog: best.x, after: low };
    const list = bandRuns.get(band);
    list.splice(list.indexOf(run), 1, up, low);
    plan.runs = { [upperEnd]: up, [lowerEnd]: low };
    return true;
  };
  const spread = (run) => Math.abs(at(run.plan, 'out') - at(run.plan, 'in'));
  const bandsWithRuns = [...bandRuns.keys()].sort((a, b) => a - b);
  // 先处理只能靠挪落点解决的贴近，再解约束环：先挪落点，挪不动就把环上的一条横跳折一次。
  for (let round = 0; round < 96; round += 1) {
    let apart = null;
    let cycle = null;
    let cycleBand = null;
    for (const band of bandsWithRuns) {
      apart = conflictsIn(band).find((item) => item.kind === 'apart' && !tried.has(keyOf(item)));
      if (apart) break;
      cycle = findCycle(bandRuns.get(band), orderEdges(band));
      if (cycle) { cycleBand = band; break; }
    }
    if (apart) {
      tried.add(keyOf(apart));
      if (!moveAway(apart.b, apart.a.at) && apart.a.plan) moveAway(apart.a, apart.b.at);
      continue;
    }
    if (!cycle) break;
    const conflicts = cycle.filter((edge) => edge.item).map((edge) => edge.item);
    const shift = conflicts.find((item) => !tried.has(keyOf(item)));
    if (shift) {
      tried.add(keyOf(shift));
      moveAway(shift.lower, shift.upper.at) || moveAway(shift.upper, shift.lower.at);
      continue;
    }
    const jumps = [...new Set(cycle.flatMap((edge) => [edge.from, edge.to]))].filter((run) => run.ends.length === 2)
      .sort((a, b) => spread(b) - spread(a) || a.index - b.index);
    if (!jumps.some((run) => dogleg(run, cycleBand))) ignored.add(keyOf(conflicts[0]));
  }

  // 标签区：前进边的标签放在起点下方的通道顶部，回边的放在起点上方的通道底部，
  // 横向位置尽量避开别的短线、直连竖线、走廊竖线和其他标签。
  const zones = [];
  for (const plan of plans) {
    if (!plan.label) continue;
    const band = plan.outBand;
    const top = !plan.isBack;
    const center = at(plan, 'out');
    const span = plan.label.cross;
    const m = Math.max(1, Math.ceil((ZONE_PAD * 2 + plan.label.along - CLEAR) / TRACK));
    const avoid = [
      ...stubsOf(bandRuns.get(band) || []).filter((stub) => stub.plan !== plan && stub.cls === (top ? 'upper' : 'lower')).map((stub) => stub.at),
      ...throughs(band).filter((other) => other !== plan).map((other) => at(other, 'out')),
      ...plans.filter((other) => other.kind === 'bend' && other !== plan && band >= other.rail.lo && band <= other.rail.hi).map(railAt),
    ];
    const taken = zones.filter((zone) => zone.band === band && zone.top === top);
    const fits = (lo) => lo >= 0 && lo + span <= crossTotal
      && avoid.every((value) => value < lo - 2 || value > lo + span + 2)
      && taken.every((zone) => zone.hi + 4 <= lo || lo + span + 4 <= zone.lo);
    const base = Math.round(center - span / 2);
    const reach = Math.max(0, Math.floor(span / 2 - LABEL_EDGE));
    let lo = base;
    for (let shift = 0; shift <= reach; shift += 2) {
      if (fits(base - shift)) { lo = base - shift; break; }
      if (fits(base + shift)) { lo = base + shift; break; }
    }
    zones.push({ plan, band, top, m, lo, hi: lo + span });
  }

  // 轨道：按“上排在前”的约束拓扑排序，再按区间占用分配；标签区占住通道顶部的轨道。
  const bandTracks = new Map();
  for (let band = 0; band <= maxStep; band += 1) {
    const runs = bandRuns.get(band) || [];
    const tops = zones.filter((zone) => zone.band === band && zone.top);
    const bottoms = zones.filter((zone) => zone.band === band && !zone.top);
    if (!runs.length && !zones.some((zone) => zone.band === band)) continue;
    const before = new Map(runs.map((run) => [run, new Set()]));
    for (const order of orderEdges(band)) before.get(order.to).add(order.from);
    for (const run of runs) {
      const values = run.ends.map((end) => at(run.plan, end));
      if (run.rail) values.push(railAt(run.plan));
      if (run.jog != null) values.push(run.jog);
      run.lo = Math.min(...values);
      run.hi = Math.max(...values);
    }
    const order = [];
    const pending = new Set(runs);
    const rank = (a, b) => a.lo - b.lo || a.hi - b.hi || a.index - b.index;
    while (pending.size) {
      const ready = [...pending].filter((run) => [...before.get(run)].every((prev) => !pending.has(prev)));
      const pick = (ready.length ? ready : [...pending]).sort(rank)[0];
      order.push(pick);
      pending.delete(pick);
    }
    const tracks = [];
    const occupy = (track, lo, hi, owner) => (tracks[track] ||= []).push({ lo, hi, owner });
    for (const zone of tops) for (let track = 0; track < zone.m; track += 1) occupy(track, zone.lo, zone.hi, zone.plan);
    for (const run of order) {
      let floor = 0;
      for (const prev of before.get(run)) if (prev.track != null) floor = Math.max(floor, prev.track + 1);
      for (const zone of tops) {
        const lowerInside = run.ends.some((end) => classOf(run.plan, end) === 'lower' && at(run.plan, end) >= zone.lo - 2 && at(run.plan, end) <= zone.hi + 2);
        if (zone.plan === run.plan || lowerInside) floor = Math.max(floor, zone.m);
      }
      let track = floor;
      while ((tracks[track] || []).some((item) => item.owner !== run.plan && item.lo <= run.hi && run.lo <= item.hi)) track += 1;
      occupy(track, run.lo, run.hi, run.plan);
      run.track = track;
    }
    const used = tracks.length;
    const below = Math.max(0, ...bottoms.map((zone) => zone.m));
    bandTracks.set(band, used + below);
  }
  const bands = Array.from({ length: maxStep + 1 }, (_, band) => capacity(bandTracks.get(band) || 0, STEP_GAP));

  let alongCursor = horizontal ? snap(Math.max(HEADER, ...model.lanes.map((lane) => measure(lane.name, FONT.title) + 24))) : HEADER + 24 * (model.nested?.length || 0);
  const alongAt = Array.from({ length: maxStep + 1 }, (_, index) => {
    if (index) alongCursor += bands[index - 1] + steps[index - 1];
    return alongCursor;
  });
  const alongTotal = alongAt[maxStep] + steps[maxStep] + (bandTracks.has(maxStep) ? bands[maxStep] : 0);
  const canvasW = horizontal ? Math.max(snap(width), alongTotal) : crossTotal;
  const canvasH = horizontal ? crossTotal : alongTotal;
  const bandStart = (band) => alongAt[band] + steps[band];
  const trackAt = (band, track) => bandStart(band) + CLEAR + track * TRACK;

  for (const node of nodes) {
    node.cross = laneAt[laneIndex.get(node.lane)] + node.outset;
    node.along = alongAt[node.step] + Math.round((steps[node.step] - alongOf(node)) / 2);
    const box = point(node.cross, node.along);
    node.x = box.x;
    node.y = box.y;
  }
  // 判断节点只有斜边可用，端口按斜边求出落点，箭头才不会悬在顶点外。
  const portPoint = (node, cross, side) => {
    const shift = Math.abs(cross - (node.cross + crossOf(node) / 2));
    const r = crossOf(node) / 2;
    const curve = model.mermaid && node.shape === 'circle' ? r : 0;
    const depth = node.diamond ? Math.min(alongOf(node) / 2, shift * alongOf(node) / crossOf(node))
      : curve ? r - Math.sqrt(Math.max(0, r * r - shift * shift)) : 0;
    return point(cross, Math.round(side > 0 ? node.along + alongOf(node) - depth : node.along + depth));
  };

  const edges = plans.map((plan) => {
    const outCross = at(plan, 'out');
    const inCross = at(plan, 'in');
    const middle = [];
    if (plan.kind === 'jump' && plan.runs.out === plan.runs.in) {
      const along = trackAt(plan.outBand, plan.runs.out.track);
      middle.push(point(outCross, along), point(inCross, along));
    } else if (plan.kind === 'jump') {
      const out = trackAt(plan.outBand, plan.runs.out.track);
      const into = trackAt(plan.outBand, plan.runs.in.track);
      middle.push(point(outCross, out), point(plan.runs.out.jog, out), point(plan.runs.out.jog, into), point(inCross, into));
    } else if (plan.kind === 'bend') {
      const rail = railAt(plan);
      const out = trackAt(plan.outBand, plan.runs.out.track);
      const into = trackAt(plan.inBand, plan.runs.in.track);
      middle.push(point(outCross, out), point(rail, out), point(rail, into), point(inCross, into));
    }
    return {
      id: plan.edge.id, from: plan.edge.from, to: plan.edge.to, style: plan.edge.style,
      line: plan.edge.line, back: plan.isBack,
      points: simplify([portPoint(plan.from, outCross, plan.outSide), ...middle, portPoint(plan.to, inCross, plan.inSide)]),
      label: null,
    };
  });
  const hops = crossingsOf(edges);
  for (const edge of edges) {
    edge.hops = hops.get(edge) || [];
    edge.d = pathData(edge.points, edge.hops);
  }
  for (const zone of zones) {
    const { label } = zone.plan;
    const along = zone.top ? bandStart(zone.band) + ZONE_PAD : bandStart(zone.band) + bands[zone.band] - ZONE_PAD - label.along;
    const box = point(zone.lo, along);
    edges[zone.plan.index].label = { x: box.x, y: box.y, w: label.w, h: label.h, lines: label.lines };
  }

  const laneGeometry = model.lanes.map((lane, index) => horizontal
    ? { id: lane.id, name: lane.name, line: lane.line, nodes: lane.nodes, x: 0, y: laneAt[index], w: canvasW, h: lanes[index].size }
    : { id: lane.id, name: lane.name, line: lane.line, nodes: lane.nodes, x: laneAt[index], y: 0, w: lanes[index].size, h: canvasH });
  if (model.reverse) {
    const axis = horizontal ? 'x' : 'y', size = horizontal ? 'w' : 'h';
    const extent = horizontal ? canvasW : canvasH;
    for (const box of [...nodes, ...edges.map(edge => edge.label).filter(Boolean)]) box[axis] = extent - box[axis] - box[size];
    for (const edge of edges) {
      for (const point of [...edge.points, ...edge.hops]) point[axis] = extent - point[axis];
      edge.d = pathData(edge.points, edge.hops);
    }
  }
  return { type: 'swimlane', direction: model.direction, width: canvasW, height: canvasH, lanes: laneGeometry, nodes, edges, errors: [], model };
}

export function scene(layout, ctx) {
  const model = layout.model;
  const mermaid = model?.mermaid;
  const flowEdges = new Map(model?.edges.map(edge => [edge.id, edge]));
  const appearance = appearanceOf(ctx);
  const palette = Array.from({ length: 6 }, (_, index) => ctx.frameTone(ctx.color(`tone${index + 1}`)));
  const marker = 'swimlane-arrow';
  const children = [ctx.el('defs', {}, [ctx.el('marker', {
    id: marker, viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 8, markerHeight: 8,
    markerUnits: 'userSpaceOnUse', orient: mermaid ? 'auto-start-reverse' : 'auto',
  }, [ctx.path('M0 0 L8 4 L0 8 Z', { fill: appearance.fg4 })])])];
  for (const [index, lane] of layout.lanes.entries()) {
    const color = palette[index % palette.length];
    const group = ctx.el('g', {}, [
      ctx.rect(lane.x, lane.y, lane.w, lane.h, {
        fill: ctx.tint(appearance.bg, color, .07), stroke: ctx.tint(appearance.bg, color, .45), 'stroke-width': 1, rx: appearance.radius,
      }),
      ctx.text(layout.direction === 'LR' ? (model?.reverse ? lane.w - 12 : 12) : lane.x + lane.w / 2,
        layout.direction === 'LR' ? lane.y + lane.h / 2 : model?.reverse ? lane.h - 18 : 18, lane.name, {
          size: FONT.title.size, weight: FONT.title.weight, fill: appearance.fg1,
          anchor: layout.direction === 'LR' ? (model?.reverse ? 'end' : 'start') : 'middle', 'dominant-baseline': 'central',
        }),
    ]);
    group.meta = { lane: lane.id, ...(mermaid ? { kind: 'frame', id: lane.id } : {}) };
    children.push(group);
  }
  if (mermaid) {
    const nodes = new Map(layout.nodes.map(node => [node.id, node]));
    const groups = model.nested.filter(group => group.nodes.length);
    for (const [index, group] of groups.entries()) {
      const members = group.nodes.map(id => nodes.get(id));
      const lane = layout.lanes.find(item => item.id === group.lane);
      const x = Math.min(...members.map(node => node.x)) - 4;
      const titleY = Math.min(...members.map(node => node.y)) - 14 - (groups.slice(index + 1).filter(item => item.lane === group.lane).length * 20);
      const y = Math.max(lane.y + 2, titleY - 8);
      const titleWidth = ctx.measure(group.title, FONT.label.size, 600) + 12;
      const w = Math.min(lane.x + lane.w - x - 2, Math.max(titleWidth, ...members.map(node => node.x + node.w + 4 - x)));
      const h = Math.max(...members.map(node => node.y + node.h + 4 - y));
      children.push(ctx.rect(x, y, w, h, { fill: appearance.surface2, stroke: appearance.line2, rx: appearance.smallRadius,
        meta: { kind: 'frame', id: group.id } }));
      children.push(ctx.text(x + 6, y + 9, group.title, { size: FONT.label.size, weight: 600, anchor: 'start', 'dominant-baseline': 'central', fill: appearance.fg2 }));
    }
  }
  for (const edge of layout.edges) {
    const flow = flowEdges.get(edge.id);
    if (mermaid && edge.style === 'invisible') continue;
    children.push(ctx.path(edge.d, {
      fill: 'none', stroke: appearance.fg4, 'stroke-width': mermaid && edge.style === 'bold' ? 2.5 : 1.25, 'stroke-linejoin': 'round',
      ...(edge.style === 'dashed' ? { 'stroke-dasharray': '5 4' } : {}),
      ...(!mermaid || flow.endArrow ? { 'marker-end': `url(#${marker})` } : {}),
      ...(mermaid && flow.startArrow ? { 'marker-start': `url(#${marker})` } : {}),
      meta: { edge: edge.id, back: edge.back, ...(mermaid ? { kind: 'edge', from: edge.from, to: edge.to } : {}) },
    }));
  }
  for (const node of layout.nodes) {
    const color = palette[Math.max(0, layout.lanes.findIndex((lane) => lane.id === node.lane)) % palette.length];
    const stroke = node.class && appearance[node.class] ? appearance[node.class] : ctx.tint(appearance.bg, color, .4);
    const shape = mermaid && node.shape === 'circle'
      ? ctx.shape('circle', { cx: node.x + node.w / 2, cy: node.y + node.h / 2, r: node.w / 2, fill: appearance.node, stroke, 'stroke-width': 1 })
      : node.shape === 'diamond'
      ? ctx.shape('polygon', { points: `${node.x + node.w / 2},${node.y} ${node.x + node.w},${node.y + node.h / 2} ${node.x + node.w / 2},${node.y + node.h} ${node.x},${node.y + node.h / 2}`, fill: appearance.node, stroke, 'stroke-width': 1 }, { node: node.id, shape: node.shape, ...(node.class ? { status: node.class } : {}) })
      : ctx.rect(node.x, node.y, node.w, node.h, { fill: appearance.node, stroke, 'stroke-width': 1, rx: mermaid && node.shape === 'stadium' ? node.h / 2 : mermaid && node.shape === 'rect' ? 0 : appearance.smallRadius, meta: { node: node.id, shape: node.shape, ...(node.class ? { status: node.class } : {}) } });
    if (mermaid) shape.meta = { ...shape.meta, kind: 'node', id: node.id };
    const mark = statusMarks[node.class];
    children.push(ctx.el('g', {}, [shape, ...node.lines.map((line, index) => ctx.text(node.x + node.w / 2,
      node.y + node.h / 2 + (index - (node.lines.length - 1) / 2) * 20, line, {
        size: FONT.body.size, fill: appearance.fg1, anchor: 'middle', 'dominant-baseline': 'central', meta: { node: node.id },
      })), ...(mark ? [ctx.text(node.x + 8, node.y + 9, mark, { size: 12, weight: 600, fill: stroke, anchor: 'middle', 'dominant-baseline': 'central', meta: { node: node.id, status: node.class } })] : [])]));
  }
  for (const edge of layout.edges.filter((item) => item.label)) {
    const group = ctx.el('g', {}, [
    ctx.rect(edge.label.x, edge.label.y, edge.label.w, edge.label.h, { fill: appearance.surface }),
    ...edge.label.lines.map((line, index) => ctx.text(edge.label.x + edge.label.w / 2,
      edge.label.y + edge.label.h / 2 + (index - (edge.label.lines.length - 1) / 2) * 16, line, {
        size: FONT.label.size, fill: appearance.fg2, anchor: 'middle', 'dominant-baseline': 'central',
      })),
    ]);
    group.meta = { label: edge.id, ...(mermaid ? { kind: 'edge-label-group', from: edge.from, to: edge.to } : {}) };
    children.push(group);
  }
  return { width: layout.width, height: layout.height, children };
}

export const implementations = { swimlane: { parse, layout, scene } };
