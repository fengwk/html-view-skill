import { FONT, appearance, error, isEn, message, textBlock, warning } from './support.js';
import { mapConfig, mapIcon, mapLabels } from './map-label.js';

const DEC = String.raw`\d+\.\d+`;
const NUM = String.raw`\d+(?:\.\d+)?`;
const QUOTED = String.raw`"(?:\\.|[^"\\])*"`;
const NAME = String.raw`(?:${QUOTED}|[A-Za-z_](?:[\w()&]|-(?![-.>]))*(?:[ \t]+[A-Za-z(](?:[\w()&]|-(?![-.>]))*)*)`;
const pair = (number) => String.raw`\[\s*(${number})\s*,\s*(${number})\s*\]`;
const offset = String.raw`(?:\s+label\s*${pair('-?\\d+')})?`;
const sizePattern = new RegExp(String.raw`^size\s*${pair('\\d+')}$`);
const nodePattern = new RegExp(String.raw`^(component|anchor|note|accelerator|deaccelerator)\s+(${NAME})\s*${pair(DEC)}${offset}(?:\s+\((build|buy|outsource|market)\))?(?:\s+(inertia|\(inertia\)))?$`);
const childPattern = new RegExp(String.raw`^component\s+(${NAME})\s*\[\s*(${DEC})\s*\]${offset}$`);
const stagePattern = new RegExp(String.raw`^(${NAME})(?:\s*@\s*(${DEC}))?(?:\s*/\s*(${NAME}))?$`);
const pipelinePattern = new RegExp(String.raw`^pipeline\s+(${NAME})\s*\{$`);
const evolvePattern = new RegExp(String.raw`^evolve\s+(${NAME})\s+(${DEC})$`);
const pinPattern = new RegExp(String.raw`^annotation\s+(\d+)\s*,\s*${pair(NUM)}\s+(${QUOTED})$`);
const boxPattern = new RegExp(String.raw`^annotations\s*${pair(NUM)}$`);
const linkPattern = new RegExp(String.raw`^(${NAME})\s*(\+<>|\+>|\+<)?\s*(-->|-\.->|->|>|\+'([^']*)'(<>|<|>))?\s*(${NAME})\s*(\+<>|\+>|\+<)?\s*(?:;\s*(.+))?$`);
// Generated text follows the diagram language: [Chinese, English].
const defaults = [['起源', 'Genesis'], ['定制', 'Custom Built'], ['产品', 'Product'], ['商品', 'Commodity']];
const words = { visibility: ['可见度', 'Visibility'], evolution: ['演化', 'Evolution'], annotations: ['注释', 'Annotations'],
  build: ['自建', 'build'], buy: ['采购', 'buy'], outsource: ['外包', 'outsource'], market: ['市场', 'market'] };
const word = (lang, key) => message(lang, ...words[key]);
const strategyGlyphs = { build: 'B', buy: 'Y', outsource: 'O', market: 'M' };
const strategyTones = { build: 'tone1', buy: 'tone2', outsource: 'tone3', market: 'tone4' };
const readName = (name) => name.startsWith('"') ? name.slice(1, -1).replace(/\\(["\\])/g, '$1') : name;

function parse(body, { lang, firstLine = 2, title = '', headerLine = 1 } = {}) {
  const model = { type: 'wardley', title, size: null, stages: defaults.map(names => ({ name: names[isEn(lang) ? 1 : 0], secondName: null, boundary: null })),
    nodes: [], pipelines: [], links: [], trends: [], notes: [], annotations: [], annotationBox: null, forces: [] };
  const errors = [], hints = new Set(), nodes = new Map();
  const normalize = mapLabels(lang, item => errors.push(item));
  const readLabel = (value, line) => normalize(readName(value), line);
  if (title) ({ text: model.title, icon: model.titleIcon } = normalize(title, headerLine));
  const bad = (line, zh, en, fixZh, fixEn) => errors.push(error(lang, line, zh, en, fixZh, fixEn));
  const hint = (key, line, zh, en, fixZh, fixEn) => {
    if (hints.has(key)) return;
    hints.add(key);
    errors.push(warning('DIAGRAM_HINT', lang, line, zh, en, fixZh, fixEn));
  };
  const percent = (raw, line) => {
    const value = Number(raw);
    if (value > 100) bad(line, '坐标超出 0–100 范围', 'Coordinate is outside 0–100', '使用 0.0–1.0 的比例或 0.0–100.0 的百分数，例如 0.3', 'Use a decimal fraction from 0.0 to 1.0 or a percentage up to 100.0, such as 0.3');
    return value <= 1 ? value * 100 : value;
  };
  const coords = (v, e, line) => ({ visibility: percent(v, line), evolution: percent(e, line) });
  const labelOffset = (dx, dy) => dx == null ? null : { dx: +dx, dy: +dy };
  const add = (node) => {
    const previous = nodes.get(node.id);
    if (previous) {
      if (previous.visibility !== node.visibility || previous.evolution !== node.evolution) {
        bad(node.line, `「${node.id}」有不同的坐标`, `Conflicting coordinates for "${node.id}"`, '保留一处声明，或给不同的节点使用不同的名称', 'Keep one declaration or give distinct nodes different names');
      }
      return;
    }
    nodes.set(node.id, node);
    model.nodes.push(node);
  };
  if (body.length > 200000) {
    bad(firstLine, '地图源文本过长', 'Map source exceeds 200,000 characters', '拆成多张地图，每张最多 200,000 个字符', 'Split into maps of at most 200,000 characters each');
    return { model, errors };
  }
  const bareLinks = [];
  let pipeline = null, accessibility = false;
  for (const [index, raw] of body.split('\n').entries()) {
    const text = raw.match(/^(?:"(?:\\.|[^"\\])*"|\+'[^']*'|%(?!%)|[^"%])*/)[0].trim();
    const line = firstLine + index;
    if (!text) continue;
    let m;
    if (pipeline) {
      if (text === '}') {
        if (!pipeline.children.length) bad(line, '演进管道没有组件', 'Pipeline needs at least one component', '在 } 前添加组件，例如 component Child [0.4]', 'Add a component before }, for example component Child [0.4]');
        pipeline = null;
      } else if ((m = childPattern.exec(text))) {
        const [, name, evo, dx, dy] = m, { text: label, icon } = readLabel(name, line);
        pipeline.children.push({ id: `${pipeline.parent}_${readName(name)}`, name: readName(name), label, icon, evolution: percent(evo, line),
          labelOffset: labelOffset(dx, dy), kind: 'pipeline', parent: pipeline.parent, line });
      } else bad(line, '无效的演进管道组件', 'Invalid pipeline component', '管道内只填写演进坐标，例如 component Child [0.4]', 'Use one evolution coordinate inside a pipeline, as in component Child [0.4]');
      continue;
    }
    if (accessibility) { if (text.includes('}')) accessibility = false; continue; }
    if ((m = /^title\s*:?[ \t]+(.+)$/.exec(text))) {
      if (!title) ({ text: model.title, icon: model.titleIcon } = readLabel(m[1], line));
    } else if (/^acc(?:Title|Descr)\s*:/.test(text)) continue; // Shared source preparation owns SVG accessibility.
    else if (/^accDescr\s*\{/.test(text)) accessibility = !text.includes('}');
    else if ((m = sizePattern.exec(text))) {
      model.size = { width: Number(m[1]), height: Number(m[2]) };
      if (Object.values(model.size).some(n => n > 16000)) bad(line, '地图尺寸超过 16000 像素', 'Map size exceeds 16,000 pixels', '减小 size [宽, 高]，两项均不得超过 16000', 'Reduce both dimensions in size [width, height] to at most 16000');
    } else if (text.startsWith('evolution ')) {
      const parts = text.slice(10).match(/"(?:\\.|[^"\\])*"|->|[^"-]+|-/g) || [];
      const stages = [''];
      for (const part of parts) part === '->' ? stages.push('') : stages[stages.length - 1] += part;
      const matches = stages.map(stage => stagePattern.exec(stage.trim()));
      if (matches.length < 2 || matches.some(match => !match)) bad(line, '无效的演进阶段', 'Invalid evolution stages', '用 -> 分隔至少两个阶段，例如 evolution Genesis -> Product', 'Separate at least two stages with ->, as in evolution Genesis -> Product');
      else {
        model.stages = matches.map(([, name, end, second]) => {
          const primary = readLabel(name, line), secondary = second ? readLabel(second, line) : null;
          return { name: primary.text, icon: primary.icon, secondName: secondary?.text ?? null, secondIcon: secondary?.icon,
            boundary: end == null ? null : percent(end, line) };
        });
        const ends = model.stages.map(stage => stage.boundary);
        if (ends.some(end => end !== null) && (ends.some((end, i) => end === null || end <= (ends[i - 1] ?? 0)) || ends.at(-1) !== 100)) {
          hint('stages', line, '阶段边界不完整或未递增至 100；使用等宽阶段', 'Incomplete or unordered stage boundaries; using equal bands', '为每个阶段写递增边界，例如 evolution Genesis @ 0.4 -> Product @ 1.0', 'Give each stage an increasing boundary, as in evolution Genesis @ 0.4 -> Product @ 1.0');
          for (const stage of model.stages) stage.boundary = null;
        }
      }
    } else if ((m = nodePattern.exec(text))) {
      const [, kind, name, vis, evo, dx, dy, strategy, inertia] = m;
      const { text: label, icon } = readLabel(name, line), point = coords(vis, evo, line);
      if ((kind !== 'component' && (dx != null || strategy || inertia)) || (kind === 'note' && !name.startsWith('"'))) {
        bad(line, '无效的装饰或备注', 'Invalid decorator or note', '只给 component 添加装饰；备注使用 note "文字" [0.3, 0.2]', 'Apply decorators only to component; write notes as note "Text" [0.3, 0.2]');
      } else if (kind === 'note') model.notes.push({ text: label, icon, ...point, line });
      else if (kind.endsWith('accelerator')) model.forces.push({ kind, name: label, icon, ...point, line });
      else add({ id: readName(name), label, icon, kind, ...point, labelOffset: labelOffset(dx, dy), strategy: strategy ?? null, inertia: !!inertia, line });
    } else if ((m = pipelinePattern.exec(text))) {
      pipeline = { parent: readName(m[1]), children: [], line };
      model.pipelines.push(pipeline);
    } else if ((m = evolvePattern.exec(text))) model.trends.push({ nodeId: readName(m[1]), targetEvolution: percent(m[2], line), line });
    else if ((m = pinPattern.exec(text))) model.annotations.push({ number: m[1], ...coords(m[2], m[3], line), ...readLabel(m[4], line), line });
    else if ((m = boxPattern.exec(text))) {
      if (model.annotationBox) hint('box', line, '只使用第一个注释框', 'Only the first annotation box is used', '只保留一条 annotations [x, y] 语句', 'Keep only one annotations [x, y] statement');
      else model.annotationBox = coords(m[1], m[2], line);
    } else if ((m = linkPattern.exec(text)) && (m[2] || m[3] || m[7] || m[8] || m[1].startsWith('"') || m[6].startsWith('"'))) {
      const [, from, sourcePort, arrow, flowLabel, arrowPort, to, targetPort, label] = m;
      const port = sourcePort || targetPort || (arrowPort && `+${arrowPort}`);
      const { text: caption, icon } = readLabel(flowLabel ?? label ?? '', line);
      model.links.push({ from: readName(from), to: readName(to), dashed: arrow === '-.->',
        flow: ({ '+>': 'forward', '+<': 'backward', '+<>': 'bidirectional' })[port] || 'none',
        label: caption, icon, line });
    } else bareLinks.push({ text, line });
  }
  if (pipeline) bad(pipeline.line, '演进管道缺少结束括号', 'Unclosed pipeline', '在管道的最后一个组件之后单独写一行 }', 'Add } on its own line after the last pipeline component');
  for (const group of model.pipelines) {
    const parent = nodes.get(group.parent);
    if (parent?.kind !== 'component') bad(group.line, `管道父级「${group.parent}」不是组件`, `Pipeline parent "${group.parent}" is not a component`, '先声明同名 component，例如 component Parent [0.3, 0.2]', 'Declare a component with the same name, as in component Parent [0.3, 0.2]');
    else for (const child of group.children) add({ ...child, visibility: parent.visibility });
  }
  // Bare dependencies are ambiguous with multi-word names; resolve against declared names after parsing.
  const childNames = new Map();
  for (const node of model.nodes) if (node.parent && !childNames.has(node.name)) childNames.set(node.name, node.id);
  const resolve = (id) => nodes.has(id) ? id : childNames.get(id) ?? id;
  for (const { text, line } of bareLinks) {
    let split;
    for (const { index, 0: gap } of text.matchAll(/\s+/g)) {
      const a = text.slice(0, index), b = text.slice(index + gap.length);
      if (nodes.has(resolve(a)) && nodes.has(resolve(b))) { split = [a, b]; break; }
    }
    if (split) model.links.push({ from: split[0], to: split[1], dashed: false, flow: 'none', label: '', line });
    else bad(line, '无法识别 Wardley 地图语句', 'Unrecognized Wardley map statement',
      '用 component "需求" [0.3, 0.2] 声明组件；连线使用 "需求" --> "网关"，名称外不要加方括号',
      'Declare components as component "Demand" [0.3, 0.2]; link them as "Demand" --> "Gateway" without square brackets around names');
  }
  model.links.sort((a, b) => a.line - b.line);
  for (const link of model.links) {
    link.from = resolve(link.from); link.to = resolve(link.to);
    const missing = [link.from, link.to].find(id => !nodes.has(id));
    if (missing !== undefined) bad(link.line, `依赖引用未定义的节点「${missing}」`, `Dependency references undefined node "${missing}"`,
      '声明同名组件，例如 component Gateway [0.4, 0.3]，或更正连线端点名称', 'Declare a matching component, as in component Gateway [0.4, 0.3], or correct the endpoint name');
  }
  for (const trend of model.trends) {
    trend.nodeId = resolve(trend.nodeId);
    if (!nodes.has(trend.nodeId)) hint('trend', trend.line, '演进引用未定义的组件', 'Evolution references an undefined component', '将 evolve 后的名称改为已声明的组件，例如 evolve Gateway 0.7', 'Use a declared component name after evolve, as in evolve Gateway 0.7');
  }
  if (model.nodes.length > 300 || model.links.length + model.trends.length > 600) {
    bad(firstLine, '地图超过 300 个节点或 600 条连线，请拆分', 'Map exceeds 300 nodes or 600 connections', '按主题拆分地图，每张最多 300 个节点、600 条连线', 'Split the map by topic into maps of at most 300 nodes and 600 connections');
  }
  return { model, errors };
}

const box = (x, y, w, h) => ({ x, y, w, h });
const centerBox = (x, y, w, h) => box(x - w / 2, y - h / 2, w, h);
const collides = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const grow = (b, n) => box(b.x - n, b.y - n, b.w + n * 2, b.h + n * 2);
const length = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
// Slab intersection is shared by centerline clipping and label placement.
function boxSpan(a, b, r) {
  let lo = 0, hi = 1;
  for (const [k, d] of [['x', 'w'], ['y', 'h']]) {
    const delta = b[k] - a[k];
    if (!delta) { if (a[k] < r[k] || a[k] > r[k] + r[d]) return false; continue; }
    const p = (r[k] - a[k]) / delta, q = (r[k] + r[d] - a[k]) / delta;
    lo = Math.max(lo, Math.min(p, q)); hi = Math.min(hi, Math.max(p, q));
    if (lo > hi) return false;
  }
  return [lo, hi];
}
const crosses = (a, b, r) => Boolean(boxSpan(a, b, r));

// Clip visibility along the original centerline. Exact coincident portions are painted once.
function visibleSpans(a, b, blockers, painted) {
  const dx = b.x - a.x, dy = b.y - a.y, span = dx * dx + dy * dy;
  if (!span) return [];
  const hidden = blockers.map(rect => boxSpan(a, b, rect)).filter(Boolean);
  for (const pair of painted) {
    if (!pair.every(p => Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) < 1e-5)) continue;
    const [lo, hi] = pair.map(p => (dx * (p.x - a.x) + dy * (p.y - a.y)) / span).sort((x, y) => x - y);
    if (lo < 1 && hi > 0) hidden.push([Math.max(0, lo), Math.min(1, hi)]);
  }
  let cursor = 0;
  const visible = [];
  for (const [lo, hi] of [...hidden.sort((x, y) => x[0] - y[0]), [1, 1]]) {
    if (lo - cursor > 1e-7) visible.push([cursor, lo]);
    cursor = Math.max(cursor, hi);
  }
  return visible.map(pair => pair.map(t => ({ x: a.x + t * dx, y: a.y + t * dy })));
}
const move = (a, b, distance) => {
  const t = distance / (length(a, b) || 1);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
};
const arrowhead = (ctx, a, b, fill) => {
  const p = move(b, a, 7), dx = p.y - b.y, dy = b.x - p.x;
  return ctx.path(`M${b.x} ${b.y} L${p.x + dx * .48} ${p.y + dy * .48} L${p.x - dx * .48} ${p.y - dy * .48} Z`, { fill });
};

function layout(model, { width, lang, ctx, compact = false }, info = {}) {
  const t = appearance(ctx), edge = ctx.color('muted'), grid = ctx.color('grid'), axis = t.fg4;
  const titleFont = compact ? { ...FONT.title, size: 13 } : FONT.title;
  const config = mapConfig(info.config, 'wardley');
  const pad = 48;
  const stageParts = model.stages.map(stage => [{ text: stage.name + (stage.secondName !== null ? ' /' : ''), icons: [stage.icon].filter(Boolean) },
    ...(stage.secondName !== null ? [{ text: stage.secondName, icons: [stage.secondIcon].filter(Boolean) }] : [])]
    .flatMap(({ text, icons }) => text.split('\n').map((row, i) => ({ text: row, icons: i === 0 ? icons : [] }))));
  const iconGap = (icon) => icon ? 20 : 0;
  const stageInkWidth = ({ text, icons }) => ctx.measure(text, FONT.label.size, 400) + icons.length * 20;
  const fractions = model.stages.map((stage, i) => (stage.boundary ?? 100 * (i + 1) / stageParts.length) / 100);
  const bandFraction = i => fractions[i] - (fractions[i - 1] || 0);
  const stageWidth = Math.max(...stageParts.map((rows, i) => (Math.max(...rows.map(stageInkWidth)) + 22) / bandFraction(i)));
  const dimension = (value, fallback) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(16000, value)) : fallback;
  const compactWidth = Math.max(2 * pad + stageWidth, Math.min(720, 540 + model.nodes.length * 4 + model.links.length * 2));
  const W = compact ? compactWidth : Math.max(2 * pad + stageWidth, 420, dimension(model.size?.width ?? mapConfig(config, 'width'), 900));
  const right = W - pad, plotW = right - pad;
  const stages = stageParts.map((parts, i) => {
    if (parts.length !== 2 || model.stages[i].secondName === null || [model.stages[i].name, model.stages[i].secondName].some(text => text.includes('\n'))) return parts;
    const together = { text: parts.map(part => part.text).join(' '), icons: parts.flatMap(part => part.icons) };
    return stageInkWidth(together) + 22 <= plotW * bandFraction(i) ? [together] : parts;
  });
  const titleRows = model.title || model.titleIcon ? ctx.wrap(model.title, plotW - iconGap(model.titleIcon), titleFont.size, titleFont.weight) : [];
  const top = 48 + Math.max(0, titleRows.length - 1) * 16;
  const stagesExtra = Math.max(0, ...stages.map(rows => rows.length - 2)) * 16;
  const compactHeight = Math.max(top + 212 + stagesExtra, Math.min(540, 400 + model.nodes.length * 2 + model.links.length));
  const H = compact ? compactHeight : Math.max(top + 212 + stagesExtra, dimension(model.size?.height ?? mapConfig(config, 'height'), 600));
  const bottom = H - 86 - stagesExtra, plotH = bottom - top;
  const project = ({ evolution, visibility }) => ({ x: pad + plotW * evolution / 100, y: bottom - plotH * visibility / 100 });
  const nodes = new Map(model.nodes.map(node => [node.id, { ...node, ...project(node), r: node.strategy ? 10 : 5 }]));
  const guides = [], frames = [], lines = [], marks = [], labels = [], leaders = [];
  const obstacles = [], occupied = [], wires = [], annotations = model.annotations.slice().sort((a, b) => Number(a.number) - Number(b.number));
  const stroke = (color, extra = {}) => ({ stroke: color, 'stroke-width': 1, ...extra });
  const line = (a, b, color, extra) => ctx.line(a.x, a.y, b.x, b.y, stroke(color, extra));
  const addLeader = (a, b) => {
    leaders.push(line(a, b, t.fg4, { 'stroke-dasharray': '2 3', meta: { kind: 'leader' } }));
    wires.push([a, b]);
  };
  const label = (x, y, rows, font = FONT.label, fill = t.fg1, anchor = 'middle', meta) => textBlock(ctx, { x, y, lines: rows, font, fill, anchor, lineHeight: 16, meta });
  const caption = (x, y, rows, icon, font, fill = t.fg1, anchor = 'middle') => {
    if (!icon) return label(x, y, rows, font, fill, anchor);
    const textW = Math.max(0, ...rows.map(row => ctx.measure(row, font.size, font.weight)));
    const shift = iconGap(icon);
    return ctx.el('g', {}, [label(x + shift * (anchor === 'middle' ? .5 : 1), y, rows, font, fill, anchor),
      mapIcon(ctx, icon, x - (anchor === 'middle' ? (textW + shift) / 2 : 0) + 7, y, fill)]);
  };
  const bold = { ...FONT.label, weight: 650 };
  const pipelineEdges = [], pipelineRows = [];
  for (const pipeline of model.pipelines) {
    const parent = nodes.get(pipeline.parent);
    const children = pipeline.children.map(child => nodes.get(child.id)).filter(Boolean).sort((a, b) => a.x - b.x);
    if (!parent || !children.length) continue;
    const x = children[0].x - 16, w = children.at(-1).x - x + 16;
    parent.x = x + w / 2; parent.y -= 25; parent.square = true;
    frames.push(ctx.rect(x, children[0].y - 15, w, 30, { rx: t.smallRadius, fill: ctx.tint(t.bg, ctx.frameTone(ctx.color('tone1')), .07),
      stroke: ctx.tint(t.bg, ctx.frameTone(ctx.color('tone1')), .45), meta: { kind: 'frame', id: pipeline.parent } }));
    pipelineRows.push({ children, bottom: children[0].y + 15 });
    for (let i = 1; i < children.length; i++) pipelineEdges.push({ from: children[i - 1].id, to: children[i].id, dashed: true });
  }
  for (const node of nodes.values()) {
    obstacles.push(centerBox(node.x, node.y, node.r * 2, node.r * 2));
    if (node.inertia) obstacles.push(centerBox(node.x + node.r + 6, node.y, 3, 20));
  }
  const placeMarker = (item, radius) => {
    const p = project(item);
    // Callout marks can shift; their leaders still end at the authored points.
    const candidates = [p];
    for (const distance of [radius + 5, 22, 32, 46, 64]) for (const [dx, dy] of [[0,-1],[1,0],[-1,0],[0,1],[1,-1],[-1,-1],[1,1],[-1,1]]) {
      candidates.push({ x: p.x + dx * distance, y: p.y + dy * distance });
    }
    const blockers = [...obstacles, ...occupied];
    const { x, y } = candidates.find(q => {
      const b = grow(centerBox(q.x, q.y, radius * 2, radius * 2), 3);
      return !blockers.some(o => collides(b, o)) && !wires.some(([a, z]) => crosses(a, z, b)) &&
        (q === p || !occupied.some(o => crosses(p, q, grow(o, 2))));
    }) || p;
    obstacles.push(centerBox(x, y, radius * 2, radius * 2));
    if (x !== p.x || y !== p.y) addLeader(p, move({ x, y }, p, radius));
    return { ...item, x, y, radius };
  };
  const forces = model.forces.map(item => {
    const p = project(item);
    obstacles.push(centerBox(p.x, p.y, 40, 20));
    return { ...item, ...p };
  });
  let footerY = H;
  function place(text, p, options = {}) {
    const { font = FONT.label, fill = t.fg1, radius = 6, preferred, fixed, plate, meta, icon, clearance = 2 } = options;
    const rows = ctx.wrap(text, Math.min(260, plotW / 2) - iconGap(icon), font.size, font.weight);
    const w = Math.max(...rows.map(row => ctx.measure(row, font.size, font.weight))) + iconGap(icon) + (plate ? 14 : 4);
    const h = rows.length * 16 + (plate ? 6 : 2);
    const stepX = radius + w / 2 + 6, stepY = radius + h / 2 + 6;
    const candidates = preferred ? [preferred] : [];
    for (const gap of [0, 12, 26, 44, 68, 98, 136]) {
      const sides = [[stepX + gap, -gap / 4], [stepX + gap, -stepY - gap / 2], [-stepX - gap, 0], [0, stepY + gap], [0, -stepY - gap], [-stepX - gap, -stepY - gap / 2], [stepX + gap, stepY + gap / 2], [-stepX - gap, stepY + gap / 2]];
      if (options.above) sides.unshift(sides.splice(4, 1)[0]);
      for (const [dx, dy] of sides) candidates.push({ x: p.x + dx, y: p.y + dy });
    }
    const leaderFor = (q) => {
      if (length(p, q) <= Math.hypot(stepX, stepY) + 10) return null;
      const scale = Math.min((w / 2 + 1) / Math.abs(q.x - p.x), (h / 2 + 1) / Math.abs(q.y - p.y));
      return [move(p, q, radius + 3), move(q, p, length(p, q) * scale)];
    };
    const fits = (q) => {
      const { x, y } = q;
      const leader = leaderFor(q);
      if (leader && [...obstacles, ...occupied].some(o => crosses(...leader, grow(o, 2)))) return false;
      const b = grow(centerBox(x, y, w, h), clearance);
      return b.x > 31 && b.x + b.w < W - 8 && b.y > top - 20 && b.y + b.h < bottom + 9 &&
        !obstacles.some(o => collides(b, o)) && !occupied.some(o => collides(b, o)) && !wires.some(([a, z]) => crosses(a, z, b));
    };
    // API-compact maps can bring authored labels onto nearby nodes; preserve the fixed point when clear,
    // otherwise nudge only as far as needed to clear node and label boxes.
    const compactFixed = fixed && compact && (() => {
      const offsets = [[0,0], [0,-1], [1,0], [-1,0], [0,1], [1,-1], [-1,-1], [1,1], [-1,1]];
      const alternatives = [fixed];
      for (const distance of [12, 24, 36, 52, 72]) {
        for (const [dx, dy] of offsets.slice(1)) alternatives.push({ x: fixed.x + dx * distance, y: fixed.y + dy * distance });
      }
      return alternatives.find(({ x, y }) => {
        const b = grow(centerBox(x, y, w, h), clearance);
        return b.x > 31 && b.x + b.w < W - 8 && b.y > top - 20 && b.y + b.h < bottom + 9 &&
          !obstacles.some(o => collides(b, o)) && !occupied.some(o => collides(b, o));
      });
    })();
    let chosen = compactFixed || fixed || candidates.find(fits);
    const leader = !fixed && chosen && leaderFor(chosen);
    if (leader) addLeader(...leader);
    if (!chosen) {
      chosen = { x: pad + w / 2, y: footerY + h / 2 + 4 };
      footerY += h + 8;
    }
    const { x, y } = chosen, b = centerBox(x, y, w, h);
    occupied.push(b);
    const textNode = caption(x, y, rows, icon, font, fill);
    if (fixed && wires.some(([a, z]) => crosses(a, z, b))) {
      labels.push(ctx.rect(b.x, b.y, b.w, b.h, { fill: t.bg, rx: t.smallRadius }));
    }
    labels.push(plate ? { ...ctx.el('g', {}, [ctx.rect(b.x, b.y, b.w, b.h, { fill: t.bg, stroke: grid, rx: t.smallRadius }), textNode]), ...(meta ? { meta } : {}) } : textNode);
  }
  const pendingLabels = [], painted = [];
  const nodeBoxes = [...nodes.values()].map(node => ({ id: node.id, ...grow(centerBox(node.x, node.y, node.r * 2, node.r * 2), 2) }));
  function connect(a, b, link, trend = false) {
    const color = trend ? t.danger : edge;
    const distance = length(a, b);
    const inset = (p, q) => p.r ? Math.min(distance / 2, (p.square || p.kind === 'anchor'
      ? p.r * distance / Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y), 1e-9) : p.r) + 1) : 0;
    const start = move(a, b, inset(a, b)), end = move(b, a, inset(b, a));
    const visible = visibleSpans(start, end, nodeBoxes.filter(box => box.id !== a.id && box.id !== b.id), painted);
    painted.push(...visible);
    wires.push(...visible);
    const path = visible.map(([p, q]) => `M${p.x} ${p.y} L${q.x} ${q.y}`).join(' ');
    if (path) {
      const edgePath = ctx.path(path, { fill: 'none', ...stroke(color, { 'stroke-width': trend ? 1.5 : 1.2,
        ...(link.dashed || trend ? { 'stroke-dasharray': trend ? '5 4' : '3 4' } : {}),
        meta: { kind: 'edge', from: a.id, to: b.id ?? `trend:${a.id}` } }) });
      // A visible continuation may look like it attaches to the intervening node; retain its real endpoints on hover.
      const clipped = visible.length !== 1 || length(visible[0][0], start) > 1e-5 || length(visible[0][1], end) > 1e-5;
      lines.push(!trend && clipped ? ctx.titled(edgePath, `${a.label} → ${b.label}`) : edgePath);
    }
    if (trend || link.flow === 'forward' || link.flow === 'bidirectional') lines.push(arrowhead(ctx, start, end, color));
    if (link.flow === 'backward' || link.flow === 'bidirectional') lines.push(arrowhead(ctx, end, start, color));
    if (link.label || link.icon) {
      pendingLabels.push({ link, point: move(start, end, length(start, end) / 2) });
    }
  }
  const dependencies = [...pipelineEdges, ...model.links].map(link => ({ link, a: nodes.get(link.from), b: nodes.get(link.to) }))
    .filter(({ a, b }) => a && b && a.parent !== b.id && b.parent !== a.id);
  // Prefer short dependencies when a longer one shares their exact line of sight.
  dependencies.sort((p, q) => length(p.a, p.b) - length(q.a, q.b));
  for (const { a, b, link } of dependencies) connect(a, b, link);
  for (const { nodeId, targetEvolution } of model.trends) {
    const a = nodes.get(nodeId);
    if (!a) continue;
    const b = { x: project({ evolution: targetEvolution, visibility: a.visibility }).x, y: a.y };
    connect(a, b, {}, true);
  }
  if (titleRows.length) guides.push(caption(W / 2, 23 + (titleRows.length - 1) * 8, titleRows, model.titleIcon, titleFont));
  guides.push(ctx.line(pad, top, pad, bottom, stroke(axis)), ctx.line(pad, bottom, right, bottom, stroke(axis)));
  const axisMiddle = (top + bottom) / 2;
  guides.push(ctx.el('g', { transform: `rotate(-90 18 ${axisMiddle})` }, [label(18, axisMiddle, [word(lang, 'visibility')], bold, t.fg2)]));
  guides.push(label((pad + right) / 2, bottom + 64 + stagesExtra, [word(lang, 'evolution')], bold, t.fg2));
  stages.forEach((rows, i) => {
    const x = pad + plotW * (fractions[i - 1] || 0), end = pad + plotW * fractions[i];
    if (i) guides.push(ctx.line(x, top, x, bottom, stroke(grid)));
    const mid = (x + end) / 2; // @ boundaries are the right edges of bands, not caption anchors.
    rows.forEach(({ text, icons }, j) => {
      const y = bottom + 25 + j * 16;
      guides.push(label(mid + icons.length * 10, y, [text], FONT.label, t.fg2));
      icons.forEach((icon, k) => guides.push(mapIcon(ctx, icon, mid - stageInkWidth({ text, icons }) / 2 + k * 20 + 7, y, t.fg2)));
    });
  });
  const placeComponent = node => {
    const fixed = node.labelOffset && { x: node.x + node.labelOffset.dx, y: node.y + node.labelOffset.dy };
    const above = node.kind === 'anchor' || node.square;
    place(node.label, node, { radius: node.r, fixed, icon: node.icon, above, font: above ? bold : FONT.label });
  };
  for (const node of nodes.values()) if (node.labelOffset) placeComponent(node);
  const grouped = new Set();
  for (const row of pipelineRows) {
    const captions = row.children.filter(node => !node.labelOffset).map(node => {
      const maxWidth = Math.min(260, plotW / 2) - iconGap(node.icon);
      const rows = ctx.wrap(node.label, maxWidth, 12);
      return { node, rows, w: Math.max(...rows.map(text => ctx.measure(text, 12, 400))) + iconGap(node.icon) + 8 };
    });
    if (!captions.length) continue;
    const height = Math.max(...captions.map(item => item.rows.length)) * 16;
    const total = captions.reduce((sum, item) => sum + item.w, 0);
    let next = pad, remaining = total;
    const xs = captions.map(({ node, w }) => {
      const left = Math.max(next, Math.min(node.x - w / 2, right - remaining));
      remaining -= w;
      next = left + w;
      return left + w / 2;
    });
    const firstY = row.bottom + 8 + height / 2;
    const boxes = y => captions.map(({ w }, i) => centerBox(xs[i], y, w, height));
    let y = firstY;
    while (y + height / 2 < bottom && boxes(y).some(b => [...obstacles, ...occupied].some(o => collides(b, o)) ||
      wires.some(([a, z]) => crosses(a, z, b)))) y += 12;
    if (y + height / 2 >= bottom || total > plotW) {
      y = footerY + height / 2 + 4;
      footerY += height + 8;
    }
    occupied.push(...boxes(y));
    captions.forEach(({ node, rows }, i) => {
      grouped.add(node.id);
      labels.push(caption(xs[i], y - (height - rows.length * 16) / 2, rows, node.icon, FONT.label));
    });
  }
  const pins = annotations.map(item => placeMarker(item, Math.max(9, ctx.measure(item.number, 12, 650) / 2 + 4)));
  const notes = model.notes.map(item => placeMarker(item, 2));
  for (const { link, point } of pendingLabels) place(link.label, point, { plate: true, above: true, radius: 0, icon: link.icon,
    meta: { kind: 'edge-label-group', from: link.from, to: link.to } });
  for (const node of nodes.values()) {
    const { x, y, r, id, strategy, inertia, square } = node, anchor = node.kind === 'anchor';
    const meta = { kind: 'node', id };
    const tone = ctx.frameTone(ctx.color(strategyTones[strategy] || 'tone1'));
    const shape = { fill: anchor ? t.fg1 : strategy ? ctx.tint(t.bg, tone, .16) : t.node, stroke: ctx.frameTone(edge), 'stroke-width': 1.4, meta };
    if (square) marks.push(ctx.rect(x - r, y - r, 2 * r, 2 * r, { ...shape, rx: 2 }));
    else if (anchor) marks.push(ctx.rect(x - r, y - r, 2 * r, 2 * r, { ...shape, rx: 3 }));
    else marks.push(ctx.circle(x, y, r, shape));
    if (strategy) marks.push(ctx.titled(label(x, y, [strategyGlyphs[strategy]], bold, ctx.textOn(shape.fill)), strategy));
    if (inertia) marks.push(ctx.rect(x + r + 4.5, y - 10, 3, 20, { rx: 1, fill: edge }));
    if (!node.labelOffset && !grouped.has(id)) placeComponent(node);
  }
  for (const note of notes) {
    marks.push(ctx.circle(note.x, note.y, 2, { fill: edge }));
    place(note.text, note, { plate: true, radius: 2, clearance: 12, fill: t.fg2, icon: note.icon });
  }
  for (const f of forces) {
    const d = f.kind === 'accelerator' ? 1 : -1;
    const points = [[-20,-5],[6,-5],[6,-10],[20,0],[6,10],[6,5],[-20,5]].map(([x,y]) => `${f.x + x * d},${f.y + y}`);
    marks.push(ctx.shape('polygon', { points: points.join(' '), fill: t.node, stroke: edge, 'stroke-width': 1.3 }));
    place(f.name, f, { preferred: { x: f.x, y: f.y + 24 }, radius: 20, icon: f.icon });
  }
  for (const pin of pins) {
    marks.push(ctx.circle(pin.x, pin.y, pin.radius, { fill: t.bg, stroke: edge, 'stroke-width': 1.4 }));
    marks.push(label(pin.x, pin.y, [pin.number], bold));
  }
  if (annotations.length) {
    const rows = annotations.flatMap(({ number, text, icon }) => ctx.wrap(`${number}. ${text}`, Math.min(270, plotW / 2) - iconGap(icon), 12)
      .map((row, i) => ({ row, icon: i === 0 ? icon : null })));
    const w = Math.max(...rows.map(({ row, icon }) => ctx.measure(row, 12, 400) + iconGap(icon))) + 28, h = rows.length * 16 + 35;
    const p = model.annotationBox ? project(model.annotationBox) : { x: right, y: bottom };
    const desired = box(Math.max(34, Math.min(W - w - 10, p.x)), Math.min(bottom - h - 5, p.y), w, h);
    const floating = width >= 480 && desired.y >= top && ![...obstacles, ...occupied].some(o => collides(grow(desired, 4), o)) &&
      !wires.some(([a, b]) => crosses(a, b, grow(desired, 3)));
    const r = floating ? desired : box(pad, footerY, w, h);
    if (!floating) footerY += h + 8;
    labels.push(ctx.rect(r.x, r.y, r.w, r.h, { rx: t.radius, fill: t.node, stroke: grid, meta: { kind: 'frame', id: 'annotations' } }),
      label(r.x + 14, r.y + 14, [word(lang, 'annotations')], bold, t.fg1, 'start'),
      ...rows.map(({ row, icon }, i) => caption(r.x + 14, r.y + 35 + i * 16, [row], icon, FONT.label, t.fg2, 'start')));
  }
  const strategies = Object.keys(strategyGlyphs).filter(strategy => model.nodes.some(node => node.strategy === strategy));
  if (strategies.length) {
    const rows = ctx.wrap(strategies.map(strategy => `${strategyGlyphs[strategy]} · ${word(lang, strategy)}`).join('     /     '), plotW, 12);
    labels.push(label(pad, footerY + rows.length * 8, rows, FONT.label, t.fg2, 'start'));
    footerY += rows.length * 16 + 8;
  }
  const errors = W > width * 2 || nodes.size > 60 ? [warning('LARGE_DIAGRAM', lang, info.headerLine || 1,
    '地图较大，可在图框内滚动', 'Large map; scroll inside the frame', '按主题拆分组件及其依赖', 'Split components and their dependencies into maps by topic')] : [];
  return { scene: { width: W, height: footerY + 8, title: model.title || undefined,
    children: [...guides, ...frames, ...lines, ...leaders, ...marks, ...labels] }, errors };
}

const honoredConfig = ['wardley.width', 'wardley.height'];
const implementations = { 'wardley-beta': { parse, layout, honoredConfig } };
export { implementations };
