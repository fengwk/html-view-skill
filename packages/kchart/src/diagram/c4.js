import { mix } from '../core/color.js';
import { FONT, error, warning, labelText, isEn } from './support.js';

const TYPES = ['C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment'];
const ELEMENTS = new Map();
for (const [base, label, zh] of [['Person', 'Person', '人员'], ['System', 'Software System', '软件系统'], ['Container', 'Container', '容器'], ['Component', 'Component', '组件']]) {
  for (const [suffix, shape] of (base === 'Person' ? [['', 'person']] : [['', base === 'Component' ? 'component' : 'box'], ['Db', 'database'], ['Queue', 'queue']])) {
    for (const ext of ['', '_Ext']) ELEMENTS.set(base + suffix + ext, { label, zh, shape, external: Boolean(ext), tech: base === 'Container' || base === 'Component' });
  }
}
const BOUNDARIES = new Map([['Enterprise_Boundary', 'Enterprise'], ['System_Boundary', 'System'], ['Container_Boundary', 'Container'], ['Boundary', 'System']]);
const DEPLOYMENT = new Set(['Deployment_Node', 'Node', 'Node_L', 'Node_R']);
const RELS = new Map([['Rel', ''], ['BiRel', ''], ['Rel_Back', ''], ['RelIndex', ''],
  ...['Up', 'Down', 'Left', 'Right'].flatMap(dir => [[`Rel_${dir}`, dir[0]], [`Rel_${dir[0]}`, dir[0]]])]);
const SHAPES = new Map(Object.entries({ person: 'person', box: 'box', rounded: 'box', cylinder: 'database', database: 'database', db: 'database', queue: 'queue', pipe: 'queue', component: 'component' }));

function argumentsOf(raw, slots) {
  const args = [];
  let start = 0, quoted = false, depth = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quoted && c === '\\') { i++; continue; }
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === '(') depth++;
    else if (!quoted && c === ')') depth--;
    else if (!quoted && !depth && c === ',') { args.push(raw.slice(start, i)); start = i + 1; }
    if (depth < 0) return null;
  }
  if (quoted || depth) return null;
  args.push(raw.slice(start));
  const fields = Object.create(null);
  for (const [i, arg] of args.entries()) {
    const named = /^\s*\$(\w+)\s*=\s*([\s\S]*)$/.exec(arg);
    const value = (named ? named[2] : arg).trim();
    const slot = named ? named[1] : slots[i];
    if (!slot) { if (value) return null; continue; }
    fields[slot] = value.replace(/^"([\s\S]*)"$/, '$1').replace(/\\(["\\])/g, '$1');
  }
  return fields;
}

// A macro can span lines, and a boundary's opening brace can be on the next line.
function* statements(source, firstLine) {
  let text = '', line = firstLine, start = line, quoted = false, depth = 0;
  for (let i = 0; i <= source.length; i++) {
    const c = source[i] ?? '\n';
    if (!quoted && source.startsWith('%%', i)) {
      const end = source.indexOf('\n', i);
      i = (end < 0 ? source.length : end) - 1;
      continue;
    }
    if (quoted && c === '\\' && /["\\]/.test(source[i + 1] ?? '')) { text += c + source[++i]; continue; }
    const prose = /^\s*(?:title\s|accTitle\s*:|accDescr\s*:)/i.test(text);
    if (c === '"' && !prose) quoted = !quoted;
    if (!quoted && !prose && c === '(') depth++;
    if (!quoted && !prose && c === ')') depth--;
    if (!quoted && !prose && !depth && c === '{' && !/^\s*accDescr\s*$/i.test(text)) {
      yield { text: text.trim() + '{', line: start };
      text = '';
    } else if (!quoted && !prose && !depth && c === '}') {
      if (/^\s*accDescr\s*\{/i.test(text)) yield { text: text.trim() + '}', line: start };
      else {
        if (text.trim()) yield { text: text.trim(), line: start };
        yield { text: '}', line };
      }
      text = '';
    } else if ((c === '\n' || c === ';' && !prose) && !quoted && depth <= 0 && !/^\s*accDescr\s*\{/i.test(text)) {
      if (text.trim() && !(c === '\n' && /^\s*\{/.test(source.slice(i + 1)) && /\)\s*$/.test(text))) {
        yield { text: text.trim(), line: start };
        text = ''; depth = 0;
      }
    } else {
      if (!text.trim() && /\S/.test(c)) start = line;
      text += c;
    }
    if (c === '\n') line++;
  }
  if (text.trim()) yield { text: text.trim(), line: start };
}

const ASSETS = ['sprite', 'tags', 'link'];
function parse(source, { kind, lang, firstLine = 2 }) {
  const items = new Map(), rels = new Map(), errors = [], stack = [], notices = new Map();
  const config = { c4ShapeInRow: 4, c4BoundaryInRow: 2 };
  let title;
  const bad = (line, zh, en) => errors.push(error(lang, line, zh, en, '检查 C4 声明及其参数', 'Check the C4 declaration and its arguments'));
  const note = (code, line, fields) => {
    if (!fields.length) return;
    if (!notices.has(code)) notices.set(code, { line, fields: new Set() });
    for (const field of fields) notices.get(code).fields.add(field);
  };
  if (source.length > 200_000) {
    bad(firstLine, 'C4 源文本过长', 'C4 source is too long');
    return { model: null, errors };
  }
  for (const { text, line } of statements(source, firstLine)) {
    if (/^title\s+/i.test(text)) { title = labelText(text.replace(/^title\s+/i, '')); continue; }
    if (/^acc(?:Title|Descr)\s*:|^accDescr\s*\{[\s\S]*\}$/i.test(text)) continue;
    if (text === '}') {
      if (stack.length) stack.pop();
      else bad(line, '没有对应的边界起点', 'Unmatched boundary close');
      continue;
    }
    const match = /^(\w+)\s*\(([\s\S]*)\)\s*(\{)?$/.exec(text);
    const [, macro, raw, opens] = match || [];
    const element = ELEMENTS.get(macro), deploy = DEPLOYMENT.has(macro), boundary = BOUNDARIES.get(macro);
    const relation = RELS.has(macro);
    const styleFields = macro === 'UpdateElementStyle' ? ['alias', 'bgColor', 'fontColor', 'borderColor', 'shadowing', 'shape', 'sprite', 'techn', 'legendText', 'legendSprite']
      : macro === 'UpdateRelStyle' ? ['from', 'to', 'textColor', 'lineColor', 'offsetX', 'offsetY'] : null;
    const slots = element ? ['alias', 'label', ...(element.tech ? ['techn'] : []), 'descr', ...ASSETS]
      : deploy ? ['alias', 'label', 'type', 'descr', ...ASSETS]
      : boundary ? ['alias', 'label', ...(macro === 'Boundary' ? ['type'] : []), 'tags', 'link']
      : relation ? [...(macro === 'RelIndex' ? ['index'] : []), 'from', 'to', 'label', 'techn', 'descr', ...ASSETS]
      : styleFields ?? (macro === 'UpdateLayoutConfig' ? Object.keys(config) : null);
    if (!slots && /^(?:Legend|Lay_[UDLR]|Add(?:Element|Rel)Tag|\w+Shape)$/.test(macro ?? '')) {
      note('IGNORED_STYLE', line, [macro]);
      continue;
    }
    const args = slots && argumentsOf(raw, slots);
    if (!args || opens && !boundary && !deploy || boundary && !opens) {
      bad(line, '无法识别 C4 语句', 'Unrecognized C4 statement');
      continue;
    }
    const { alias, from, to } = args;
    const key = JSON.stringify([from, to]);
    if (macro === 'UpdateLayoutConfig') {
      for (const name of slots) {
        const value = Number.parseInt(args[name], 10);
        if (Number.isSafeInteger(value) && value >= 1) config[name] = value;
      }
    } else if (styleFields) {
      const target = macro === 'UpdateElementStyle' ? items.get(alias) : rels.get(key);
      const shape = SHAPES.get(args.shape?.toLowerCase());
      if (target) {
        if (shape && !target.frame) target.shape = shape;
        if (args.techn !== undefined) target.techn = args.techn;
        for (const dim of ['offsetX', 'offsetY']) {
          const value = Number.parseInt(args[dim], 10);
          if (Number.isFinite(value)) target[dim] = value;
        }
      }
      note('IGNORED_STYLE', line, styleFields.filter(field => args[field] && !['alias', 'from', 'to', 'techn', 'offsetX', 'offsetY'].includes(field) && !(field === 'shape' && shape && target && !target.frame)));
    } else if (relation) {
      if (!from || !to) { bad(line, '关系缺少端点', 'Relationship is missing an endpoint'); continue; }
      rels.set(key, { from, to, label: args.label, techn: args.techn, descr: args.descr, line,
        index: args.index, hint: RELS.get(macro), start: macro === 'BiRel' || macro === 'Rel_Back', end: macro !== 'Rel_Back' });
      note('IGNORED_STYLE', line, ASSETS.filter(field => args[field]));
    } else {
      if (!alias || items.has(alias)) { bad(line, '元素别名缺失或重复', 'Missing or duplicate element alias'); continue; }
      const taggedShape = [args.shape, args.sprite, ...(args.tags ?? '').split('+')].map(value => SHAPES.get(value?.toLowerCase())).find(Boolean);
      const item = { id: alias, label: args.label || alias, techn: args.techn, descr: args.descr,
        type: deploy ? args.type || 'Node' : boundary ? args.type || boundary : element.label,
        zh: element?.zh, external: element?.external, shape: taggedShape || element?.shape || 'box',
        parent: stack.at(-1)?.id, frame: Boolean(opens), align: macro === 'Node_R' ? 'right' : 'left', line };
      items.set(alias, item);
      if (opens) stack.push(item);
      note('IGNORED_STYLE', line, ASSETS.filter(field => args[field] && !SHAPES.has(args[field].toLowerCase())).concat(args.shape && !taggedShape ? ['shape'] : []));
    }
    // Bound routing work, independently of the available display width.
    if (items.size > 200 || rels.size > 300 || stack.length > 64) {
      bad(line, 'C4 图超出处理上限', 'C4 diagram exceeds its work limit');
      break;
    }
  }
  if (stack.length) bad(stack.at(-1).line, 'C4 边界未关闭', 'Unclosed C4 boundary');
  for (const rel of rels.values()) for (const id of [rel.from, rel.to]) {
    if (!items.has(id)) bad(rel.line, `未声明关系端点「${id}」`, `Undeclared relationship endpoint "${id}"`);
  }
  if (kind === 'C4Dynamic') {
    let order = 0;
    for (const rel of rels.values()) rel.label = `${++order}: ${rel.label ?? ''}`;
  }
  for (const [code, { line, fields }] of notices) {
    const list = [...fields].join(', ');
    errors.push(warning(code, lang, line, `以下 C4 表现属性未应用：${list}`, `C4 presentation options not applied: ${list}`, '使用主题控制外观', 'Use the theme to control appearance'));
  }
  return { model: { kind, title, items: [...items.values()], rels: [...rels.values()], config }, errors };
}

const PAD = 16, GUTTER = 64, CARD = 216, LINE = 17;
const cx = b => b.x + b.w / 2;
const cy = b => b.y + b.h / 2;
const inflate = (b, d) => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const contains = (a, b) => a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;
const point = (x, y) => ({ x, y });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a, b, t) => point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
const segments = path => path.slice(1).map((p, i) => [path[i], p]);

function makeBoxes(model, ctx, lang) {
  const children = new Map();
  for (const item of model.items) {
    if (!children.has(item.parent)) children.set(item.parent, []);
    children.get(item.parent).push(item);
  }
  const rows = (value, font, width = CARD - 40) => value ? ctx.wrap(labelText(value), width, font.size, font.weight).map(text => ({ text, font })) : [];
  function pack(parent) {
    const items = children.get(parent) ?? [];
    let w = 0, y = 0;
    const boxes = [];
    // Mermaid lays out the elements first and then the child boundaries, retaining source order within each.
    for (const [frame, limit] of [[false, model.config.c4ShapeInRow], [true, model.config.c4BoundaryInRow]]) {
      let x = 0, height = 0, count = 0;
      for (const item of items.filter(item => item.frame === frame)) {
        if (count === limit) { y += height + GUTTER; x = height = count = 0; }
        const type = `${item.external ? isEn(lang) ? 'External ' : '外部' : ''}${!isEn(lang) && item.zh ? item.zh : item.type}`;
        const lines = [...rows(item.label, FONT.title), ...rows(`[${type}${item.techn ? `: ${item.techn}` : ''}]`, FONT.label), ...rows(item.descr, FONT.body)];
        const inner = frame ? pack(item.id) : null;
        const icon = item.shape === 'person' && !frame ? 25 : item.shape === 'database' && !frame ? 8 : 0;
        const header = 2 * PAD + lines.length * LINE + icon;
        const box = { ...item, x, y, lines, icon, header, w: Math.max(CARD, (inner?.w ?? 0) + 2 * PAD), h: header + (inner ? inner.h + PAD : 0), children: inner?.boxes ?? [] };
        boxes.push(box);
        x += box.w + GUTTER;
        w = Math.max(w, x - GUTTER);
        height = Math.max(height, box.h);
        count++;
      }
      if (count) y += height + GUTTER;
    }
    return { w, h: Math.max(0, y - GUTTER), boxes };
  }
  return pack(undefined);
}

// Clip a candidate segment against an axis-aligned clearance rectangle.
function hits([a, b], box) {
  let lo = 0, hi = 1;
  for (const [key, size] of [['x', 'w'], ['y', 'h']]) {
    const delta = b[key] - a[key], min = box[key] - a[key], max = min + box[size];
    if (!delta) { if (min > 0 || max < 0) return false; continue; }
    const p = min / delta, q = max / delta;
    lo = Math.max(lo, Math.min(p, q)); hi = Math.min(hi, Math.max(p, q));
    if (lo > hi) return false;
  }
  return true;
}

function sharesLine([a, b], [c, d]) {
  const len = distance(a, b);
  if (!len) return false;
  const x = (b.x - a.x) / len, y = (b.y - a.y) / len;
  const cross = p => Math.abs(x * (p.y - a.y) - y * (p.x - a.x));
  if (cross(c) > 1.1 || cross(d) > 1.1) return false;
  const project = p => x * (p.x - a.x) + y * (p.y - a.y);
  const p = project(c), q = project(d);
  return Math.min(len, Math.max(p, q)) - Math.max(0, Math.min(p, q)) > 3;
}

function route(a, b, obstacles, existing, bounds, index) {
  const clear = path => segments(path).every(seg => !obstacles.some(box => hits(seg, box)) && !existing.some(other => sharesLine(seg, other)));
  const attach = (box, toward) => {
    const center = point(cx(box), cy(box));
    return lerp(center, toward, Math.min(box.w / 2 / Math.abs(toward.x - center.x), box.h / 2 / Math.abs(toward.y - center.y)));
  };
  if (cx(a) !== cx(b) || cy(a) !== cy(b)) {
    const direct = [attach(a, point(cx(b), cy(b))), attach(b, point(cx(a), cy(a)))];
    if (clear(direct)) return direct;
  }
  let best, cost = Infinity;
  const tryPath = path => {
    path = path.filter((p, i) => !i || distance(p, path[i - 1]) > 0.01);
    const score = segments(path).reduce((sum, [p, q]) => sum + distance(p, q), 0) + (path.length - 2) * 14;
    if (path.length >= 2 && score < cost && clear(path)) { best = path; cost = score; }
  };
  // Vary the attachment points as well as the corridor so repeated or opposing edges have separate tracks.
  const port = (box, side, f) => side === 0 ? point(box.x, box.y + box.h * f) : side === 1 ? point(box.x + box.w, box.y + box.h * f)
    : side === 2 ? point(box.x + box.w * f, box.y) : point(box.x + box.w * f, box.y + box.h);
  for (const f of [0.5, 0.36, 0.64, 0.24, 0.76]) {
    const lane = 12 + (index % 5) * 4;
    for (let s = 0; s < 4; s++) for (let t = 0; t < 4; t++) {
      if (a === b && s === t) continue;
      const p = port(a, s, f), q = port(b, t, f);
      const step = (r, side) => point(r.x + (side === 0 ? -lane : side === 1 ? lane : 0), r.y + (side === 2 ? -lane : side === 3 ? lane : 0));
      const u = step(p, s), v = step(q, t);
      tryPath([p, u, v, q]);
      tryPath([p, u, point(u.x, v.y), v, q]);
      tryPath([p, u, point(v.x, u.y), v, q]);
      for (const x of [(u.x + v.x) / 2, bounds.x, bounds.x + bounds.w, u.x, v.x]) {
        tryPath([p, u, point(x, u.y), point(x, v.y), v, q]);
      }
      for (const y of [(u.y + v.y) / 2, bounds.y, bounds.y + bounds.h, u.y, v.y]) {
        tryPath([p, u, point(u.x, y), point(v.x, y), v, q]);
      }
    }
    if (best) break;
  }
  return best;
}

function drawBox(ctx, b) {
  const { x, y, w, h } = b;
  const ink = b.external ? ctx.design.ext : ctx.frameTone(mix(ctx.design.line2, ctx.design.fg3, b.frame ? 0.48 : 0.27));
  const paint = { fill: b.frame ? 'none' : ctx.design.surface, stroke: ink, 'stroke-width': 1.25,
    ...(b.frame || b.external ? { 'stroke-dasharray': b.frame ? '5 4' : '3 3' } : {}) };
  const meta = { kind: b.frame ? 'frame' : 'node', id: b.id };
  let outline, details = [];
  if (!b.frame && b.shape === 'database') {
    outline = ctx.shape('path', { d: `M${x} ${y + 8} C${x} ${y - 3} ${x + w} ${y - 3} ${x + w} ${y + 8} V${y + h - 8} C${x + w} ${y + h + 3} ${x} ${y + h + 3} ${x} ${y + h - 8} Z`, ...paint }, meta);
    details = [ctx.path(`M${x} ${y + 8} C${x} ${y + 19} ${x + w} ${y + 19} ${x + w} ${y + 8}`, { fill: 'none', stroke: ink })];
  } else if (!b.frame && b.shape === 'queue') {
    outline = ctx.shape('path', { d: `M${x + 10} ${y} H${x + w - 10} C${x + w + 3.33} ${y} ${x + w + 3.33} ${y + h} ${x + w - 10} ${y + h} H${x + 10} C${x - 3.33} ${y + h} ${x - 3.33} ${y} ${x + 10} ${y} Z`, ...paint }, meta);
    details = [ctx.shape('ellipse', { cx: x + 10, cy: cy(b), rx: 10, ry: h / 2, fill: 'none', stroke: ink })];
  } else {
    outline = ctx.shape('rect', { x, y, width: w, height: h, rx: b.frame ? 5 : 8, ...paint }, meta);
    if (!b.frame && b.shape === 'component') details = [ctx.rect(x + 8, y + 9, 4, h - 18, { fill: ink, rx: 2 })];
    if (!b.frame && b.shape === 'person') details = [ctx.shape('circle', { cx: cx(b), cy: y + 15, r: 5, fill: ink }),
      ctx.path(`M${cx(b) - 9} ${y + 32} C${cx(b) - 9} ${y + 21} ${cx(b) + 9} ${y + 21} ${cx(b) + 9} ${y + 32} Z`, { fill: ink })];
  }
  const alignRight = b.frame && b.align === 'right';
  const labels = b.lines.map(({ text, font }, i) => ctx.text(b.frame ? alignRight ? x + w - PAD : x + PAD : cx(b), y + PAD + b.icon + (i + 0.5) * LINE, text, {
    anchor: b.frame ? alignRight ? 'end' : 'start' : 'middle', 'dominant-baseline': 'central', size: font.size, weight: font.weight,
    fill: font === FONT.title ? ctx.design.fg1 : ctx.design.fg3,
  }));
  return [outline, ...details, ...labels];
}

function layout(model, { width, ctx, lang }) {
  const root = makeBoxes(model, ctx, lang), nodes = [], frames = [], byId = new Map();
  const margin = 38;
  const sceneWidth = Math.max(width, root.w + 2 * margin);
  let height = root.h + 2 * margin;
  function place(boxes, x, y) {
    for (const box of boxes) {
      const b = { ...box, x: x + box.x, y: y + box.y };
      (b.frame ? frames : nodes).push(b);
      byId.set(b.id, b);
      place(b.children, b.x + PAD, b.y + b.header);
    }
  }
  place(root.boxes, Math.max(margin, (sceneWidth - root.w) / 2), margin);
  const headers = frames.map(b => {
    const w = Math.max(...b.lines.map(({ text, font }) => ctx.measure(text, font.size, font.weight))) + 6;
    return { x: b.align === 'right' ? b.x + b.w - PAD + 3 - w : b.x + PAD - 3, y: b.y + PAD - 3, w, h: b.lines.length * LINE + 6 };
  });
  const children = frames.flatMap(b => drawBox(ctx, b));
  const occupied = [...nodes, ...headers];
  const used = [], routes = [], errors = [], arrowBoxes = [];
  for (const [i, rel] of model.rels.entries()) {
    const a = byId.get(rel.from), b = byId.get(rel.to);
    const obstacles = occupied.filter(box => box !== a && box !== b).map(box => inflate(box, 4));
    // Endpoints are also obstacles after the first short port segment.
    const endpointInsets = [a, b].filter(box => !box.frame || a === b || !contains(box, box === a ? b : a)).map(box => inflate(box, -2));
    const path = route(a, b, [...obstacles, ...endpointInsets], used,
      { x: 10 + i % 7 * 3, y: 10 + i % 7 * 3, w: sceneWidth - 20 - i % 7 * 6, h: height - 20 - i % 7 * 6 }, i);
    if (!path) {
      errors.push(error(lang, rel.line, '找不到不穿过元素的 C4 连线', 'No clear route for this C4 relationship', '拆分图表或调整声明顺序', 'Split the diagram or reorder declarations'));
      continue;
    }
    const meta = { from: rel.from, to: rel.to };
    const ink = ctx.design.fg3;
    children.push(ctx.shape('polyline', { points: path.map(p => `${p.x},${p.y}`).join(' '), fill: 'none', stroke: ink, 'stroke-width': 1.35, 'stroke-linejoin': 'round' }, { kind: 'edge', ...meta }));
    for (const [enabled, tip, next, end] of [[rel.start, path[0], path[1], 'start'], [rel.end, path.at(-1), path.at(-2), 'end']]) {
      if (!enabled) continue;
      arrowBoxes.push({ x: tip.x - 8, y: tip.y - 8, w: 16, h: 16 });
      const base = lerp(tip, next, 8 / distance(tip, next));
      const dx = (tip.x - base.x) * 0.45, dy = (tip.y - base.y) * 0.45;
      children.push(ctx.shape('polygon', { points: `${tip.x},${tip.y} ${base.x - dy},${base.y + dx} ${base.x + dy},${base.y - dx}`, fill: ink }, { kind: 'relation-marker', ...meta, end }));
    }
    used.push(...segments(path));
    routes.push({ path, rel, meta });
  }
  children.push(...nodes.flatMap(b => drawBox(ctx, b)));
  for (const { path, rel, meta } of routes) {
    const lines = [rel.label, rel.techn && `[${rel.techn}]`, rel.descr].filter(Boolean).flatMap(value => ctx.wrap(labelText(value), 156, FONT.label.size));
    if (!lines.length) continue;
    const w = Math.max(...lines.map(line => ctx.measure(line, FONT.label.size, FONT.label.weight))) + 16;
    const h = lines.length * LINE + 8;
    const parts = segments(path), length = parts.reduce((sum, [a, b]) => sum + distance(a, b), 0);
    const along = fraction => {
      let rest = length * fraction;
      for (const [a, b] of parts) {
        const span = distance(a, b);
        if (rest <= span) return lerp(a, b, rest / span);
        rest -= span;
      }
      return path.at(-1);
    };
    const mid = along(0.5), offset = rel.hint === 'U' ? h / 2 + 6 : 0;
    const preferred = point(mid.x + (rel.offsetX ?? 0), mid.y + (rel.offsetY ?? offset));
    const plate = p => ({ x: Math.max(6, Math.min(p.x - w / 2, sceneWidth - w - 6)), y: p.y - h / 2, w, h });
    const free = box => box.y >= 6 && box.y + h <= height - 6 && !occupied.some(b => overlaps(inflate(box, 4), b))
      && !arrowBoxes.some(b => overlaps(box, b));
    const candidates = [[preferred, mid]];
    for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9]) {
      const p = along(t);
      for (const dx of [0, -w / 2 - 4, w / 2 + 4]) for (const dy of [0, -h / 2 - 4, h / 2 + 4, -h - 8, h + 8]) {
        candidates.push([point(p.x + dx, p.y + dy), p]);
      }
    }
    let box, leader, best = Infinity;
    const other = used.filter(seg => !path.includes(seg[0]) || !path.includes(seg[1]));
    for (const [p, pOnEdge] of candidates) {
      const candidate = plate(p);
      if (!free(candidate)) continue;
      const end = point(Math.max(candidate.x, Math.min(candidate.x + w, pOnEdge.x)), Math.max(candidate.y, Math.min(candidate.y + h, pOnEdge.y)));
      const connected = parts.some(seg => hits(seg, candidate));
      const tie = connected ? null : [pOnEdge, end];
      if (tie && occupied.some(b => hits(tie, b))) continue;
      const straddle = frames.some(frame => !contains(frame, inflate(candidate, 2)) && overlaps(frame, inflate(candidate, 2)));
      const score = distance(point(cx(candidate), cy(candidate)), preferred) + (tie ? distance(...tie) * 2 : 0)
        + (straddle ? 34 : 0) + 240 * other.filter(seg => hits(seg, candidate)).length;
      if (score < best) { best = score; box = candidate; leader = tie; }
    }
    if (!box) {
      box = plate(point(mid.x, height + h / 2));
      height += h + 14;
      leader = [mid, point(cx(box), box.y)];
    }
    if (leader) children.push(ctx.path(`M${leader[0].x} ${leader[0].y} L${leader[1].x} ${leader[1].y}`, { fill: 'none', stroke: ctx.design.fg3, 'stroke-dasharray': '2 3' }));
    occupied.push(box);
    children.push({ ...ctx.el('g', {}, [ctx.rect(box.x, box.y, box.w, box.h, { fill: ctx.design.bg, stroke: ctx.design.line2, rx: 5 }),
      ...lines.map((line, i) => ctx.text(cx(box), box.y + 4 + (i + 0.5) * LINE, line, { anchor: 'middle', 'dominant-baseline': 'central', size: FONT.label.size, fill: ctx.design.fg1 }))]), meta: { kind: 'edge-label-group', ...meta } });
  }
  if (sceneWidth > 2 * width || nodes.length > 60) errors.push(warning('LARGE_DIAGRAM', lang, 1, 'C4 图较大', 'Large C4 diagram', '考虑拆分图表', 'Consider splitting the diagram'));
  return { scene: { width: sceneWidth, height, children, title: model.title, heading: model.title }, errors };
}

const implementations = Object.fromEntries(TYPES.map(kind => [kind, { parse, layout }]));
export { implementations };
