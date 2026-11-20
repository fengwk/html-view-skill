import { mix } from '../core/color.js';
import { resolveIconRef } from '../core/icons.js';
import { normalizeLabel } from './label.js';
import { presentation, roleOfColor } from './presentation.js';
import { FONT, error, warning, isEn } from './support.js';

const TYPES = ['C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment'];
const ELEMENTS = new Map();
for (const [base, label, zh] of [['Person', 'Person', '人员'], ['System', 'Software System', '软件系统'], ['Container', 'Container', '容器'], ['Component', 'Component', '组件']]) {
  for (const [suffix, shape] of (base === 'Person' ? [['', 'person']] : [['', base === 'Component' ? 'component' : 'box'], ['Db', 'database'], ['Queue', 'queue']])) {
    for (const ext of ['', '_Ext']) ELEMENTS.set(base + suffix + ext, { label, zh, shape, external: Boolean(ext), tech: base === 'Container' || base === 'Component' });
  }
}
const BOUNDARIES = new Map([['Enterprise_Boundary', 'Enterprise'], ['System_Boundary', 'System'], ['Container_Boundary', 'Container'], ['Boundary', 'System']]);
// Chinese for the default frame types; a type the author writes is shown as written.
const FRAME_ZH = { Enterprise: '企业', System: '系统', Container: '容器', Node: '节点' };
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
    const style = /^\s*(?:classDef|style|linkStyle)\s/i.test(text);
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
    } else if ((c === '\n' || c === ';' && !prose && !style) && !quoted && depth <= 0 && !/^\s*accDescr\s*\{/i.test(text)) {
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
const ROWS = { c4ShapeInRow: 4, c4BoundaryInRow: 2 };
const honoredConfig = Object.keys(ROWS).map(name => `c4.${name}`);
const configKey = (map, name) => Object.entries(map ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
const setCount = (config, key, raw) => {
  const value = Number.parseInt(raw, 10);
  if (Number.isSafeInteger(value) && value >= 1) config[key] = value;
};
const inline = /\s*(?::::(?<class>[\w-]+)|::icon\(\s*(?<icon>[\w:-]+)\s*\))$/i;
const iconRef = /::icon\(\s*([\w:-]+)\s*\)|(?<![\w:-])((?:logos|mdi|tabler|simple-icons):[\w-]+)/gi;
function parse(source, { kind, lang, firstLine = 2, config: sharedConfig }) {
  const items = new Map(), rels = new Map(), errors = [], stack = [], notices = new Map();
  const config = { ...ROWS }, look = presentation({ lang }), assetWarnings = new Set();
  const c4Config = configKey(sharedConfig, 'c4');
  for (const key of Object.keys(config)) setCount(config, key, configKey(c4Config, key));
  const warnAsset = diagnostic => {
    if (!assetWarnings.has(diagnostic.message)) { assetWarnings.add(diagnostic.message); errors.push(diagnostic); }
  };
  const iconOf = (ref, line) => {
    const icon = resolveIconRef(ref);
    if (!icon) warnAsset(warning('IGNORED_ASSET', lang, line, `未知图标 ${ref}`, `Unknown icon ${ref}`, '改用内置图标', 'Use a supported icon'));
    return icon;
  };
  const normalize = (raw, line) => {
    let icon = null;
    const clean = raw.replace(iconRef, (_, call, pack) => { const resolved = iconOf(call || pack, line); icon ??= resolved; return ''; });
    const result = normalizeLabel(clean, { lang, line });
    result.diagnostics.forEach(warnAsset);
    return { text: result.text, icon: icon ?? result.icon };
  };
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
  for (const statement of statements(source, firstLine)) {
    let { text } = statement;
    const { line } = statement;
    if (look.accept(text, line)) continue;
    if (/^title\s+/i.test(text)) { title = normalize(text.replace(/^title\s+/i, ''), line).text; continue; }
    if (/^acc(?:Title|Descr)\s*:|^accDescr\s*\{[\s\S]*\}$/i.test(text)) continue;
    if (text === '}') {
      if (stack.length) stack.pop();
      else bad(line, '没有对应的边界起点', 'Unmatched boundary close');
      continue;
    }
    const opens = text.endsWith('{');
    if (opens) text = text.slice(0, -1).trimEnd();
    const suffixes = [];
    for (let part; (part = inline.exec(text)); text = text.slice(0, part.index).trimEnd()) suffixes.unshift(part.groups);
    const match = /^(\w+)\s*\(([\s\S]*)\)$/.exec(text);
    const [, macro, raw] = match || [];
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
    const { from, to } = args;
    const [alias, ...classes] = (args.alias ?? '').split(':::');
    const key = JSON.stringify([from, to]);
    if (macro === 'UpdateLayoutConfig') {
      for (const name of slots) setCount(config, name, args[name]);
    } else if (styleFields) {
      const target = macro === 'UpdateElementStyle' ? items.get(alias) : rels.get(key);
      const shape = SHAPES.get(args.shape?.toLowerCase());
      const colors = ['bgColor', 'fontColor', 'borderColor', 'textColor', 'lineColor'];
      if (target) {
        for (const field of colors) if (args[field]) target[field] = roleOfColor(args[field]);
        if (shape && !target.frame) target.shape = shape;
        if (args.techn !== undefined) target.techn = args.techn;
        for (const dim of ['offsetX', 'offsetY']) {
          const value = Number.parseInt(args[dim], 10);
          if (Number.isFinite(value)) target[dim] = value;
        }
      }
      note('IGNORED_STYLE', line, styleFields.filter(field => args[field] && !(colors.includes(field) && target?.[field]) && !['alias', 'from', 'to', 'techn', 'offsetX', 'offsetY'].includes(field) && !(field === 'shape' && shape && target && !target.frame)));
    } else if (relation) {
      if (!from || !to) { bad(line, '关系缺少端点', 'Relationship is missing an endpoint'); continue; }
      rels.set(key, { from, to, label: args.label, techn: args.techn, descr: args.descr, line,
        icon: suffixes.find(part => part.icon)?.icon, index: args.index, hint: RELS.get(macro), start: macro === 'BiRel' || macro === 'Rel_Back', end: macro !== 'Rel_Back' });
      note('IGNORED_STYLE', line, ASSETS.filter(field => args[field]));
    } else {
      if (!alias || items.has(alias)) { bad(line, '元素别名缺失或重复', 'Missing or duplicate element alias'); continue; }
      const taggedShape = [args.shape, args.sprite, ...(args.tags ?? '').split('+')].map(value => SHAPES.get(value?.toLowerCase())).find(Boolean);
      const item = { id: alias, label: args.label || alias, techn: args.techn, descr: args.descr,
        type: deploy ? args.type || 'Node' : boundary ? args.type || boundary : element.label,
        zh: element?.zh ?? (args.type ? undefined : FRAME_ZH[deploy ? 'Node' : boundary]), external: element?.external, shape: taggedShape || element?.shape || 'box',
        parent: stack.at(-1)?.id, frame: Boolean(opens), align: macro === 'Node_R' ? 'right' : 'left', line };
      look.addClasses(alias, [...classes, ...suffixes.map(part => part.class).filter(Boolean)], line);
      item.icon = suffixes.find(part => part.icon)?.icon;
      items.set(alias, item);
      if (opens) stack.push(item);
      note('IGNORED_STYLE', line, ASSETS.filter(field => args[field] && !SHAPES.has(args[field].toLowerCase())).concat(args.shape && !taggedShape ? ['shape'] : []));
    }
    // Bound routing work, independently of the available display width.
    if (items.size > 300 || rels.size > 300 || stack.length > 64) {
      errors.push(error(lang, line, 'C4 图最多 300 个元素、300 条关系、64 层边界',
        'C4 supports up to 300 elements, 300 relations and 64 boundary levels', '请拆分图表', 'Split the diagram'));
      break;
    }
  }
  if (stack.length) bad(stack.at(-1).line, 'C4 边界未关闭', 'Unclosed C4 boundary');
  for (const rel of rels.values()) for (const id of [rel.from, rel.to]) {
    if (!items.has(id)) bad(rel.line, `未声明关系端点「${id}」`, `Undeclared relationship endpoint "${id}"`);
  }
  for (const entry of [...items.values(), ...rels.values()]) {
    let icon = entry.icon ? iconOf(entry.icon, entry.line) : null;
    for (const field of ['label', 'type', 'techn', 'descr']) {
      if (!entry[field]) continue;
      const result = normalize(entry[field], entry.line);
      entry[field] = result.text;
      icon ??= result.icon;
    }
    entry.icon = icon;
  }
  for (const item of items.values()) { item.status = look.statusOf(item.id); item.link = look.linkOf(item.id); }
  [...rels.values()].forEach((rel, index) => { rel.status = look.edgeStatusOf(index); });
  errors.push(...look.diagnostics());
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

const PAD = 16, GUTTER = 64, CARD = 216, LINE = 17, LABEL_CLEAR = 10;
const cx = b => b.x + b.w / 2;
const cy = b => b.y + b.h / 2;
const inflate = (b, d) => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const contains = (a, b) => a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;
const point = (x, y) => ({ x, y });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a, b, t) => point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
const segments = path => path.slice(1).map((p, i) => [path[i], p]);

// The plate drawn on a relationship: its text lines, icon room and outer size.
function relLabel(rel, ctx) {
  const lines = [rel.label, rel.techn && `[${rel.techn}]`, rel.descr].filter(Boolean).flatMap(value => ctx.wrap(value, 156, FONT.label.size));
  const iconSpace = rel.icon ? 22 : 0;
  if (!lines.length && !iconSpace) return null;
  return { lines, iconSpace, w: Math.max(iconSpace, ...lines.map(line => ctx.measure(line, FONT.label.size, FONT.label.weight))) + 16, h: lines.length * LINE + 8 + iconSpace };
}

function makeBoxes(model, ctx, lang) {
  const children = new Map();
  for (const item of model.items) {
    if (!children.has(item.parent)) children.set(item.parent, []);
    children.get(item.parent).push(item);
  }
  const rows = (value, font, width = CARD - 40) => value ? ctx.wrap(value, width, font.size, font.weight).map(text => ({ text, font })) : [];
  const parentOf = new Map(model.items.map(item => [item.id, item.parent]));
  const lineage = id => {
    const ids = new Set();
    for (let at = id; at !== undefined && !ids.has(at); at = parentOf.get(at)) ids.add(at);
    return ids;
  };
  const labelled = model.rels.flatMap(rel => {
    const label = relLabel(rel, ctx);
    return label ? [{ from: lineage(rel.from), to: lineage(rel.to), label }] : [];
  });
  // A label sits on its relationship. When the relationship crosses the gap between boxes `as` and boxes `bs`, the gap
  // must hold the label along that axis, or the label covers a neighbour's border.
  const room = (as, bs, size) => {
    const a = new Set(as.map(box => box.id)), b = new Set(bs.map(box => box.id));
    const reaches = (ids, side) => [...ids].some(id => side.has(id));
    return Math.max(GUTTER, ...labelled
      .filter(({ from, to }) => (reaches(from, a) && reaches(to, b)) || (reaches(from, b) && reaches(to, a)))
      .map(({ label }) => label[size] + 2 * LABEL_CLEAR));
  };
  const sized = item => {
    const type = `${item.external ? isEn(lang) ? 'External ' : '外部' : ''}${!isEn(lang) && item.zh ? item.zh : item.type}`;
    const techn = item.techn ? `${isEn(lang) ? ': ' : '：'}${item.techn}` : '';
    const lines = [...rows(item.label, FONT.title), ...rows(`[${type}${techn}]`, FONT.label), ...rows(item.descr, FONT.body)];
    const inner = item.frame ? pack(item.id) : null;
    const iconSpace = item.icon || item.shape === 'person' && !item.frame ? 25 : 0;
    const topSpace = iconSpace + (item.shape === 'database' && !item.frame ? 8 : 0);
    const header = 2 * PAD + lines.length * LINE + topSpace;
    return { ...item, x: 0, y: 0, lines, topSpace, iconSpace, header, w: Math.max(CARD, (inner?.w ?? 0) + 2 * PAD), h: header + (inner ? inner.h + PAD : 0), children: inner?.boxes ?? [] };
  };
  function pack(parent) {
    const items = children.get(parent) ?? [];
    // Mermaid lays out the elements first and then the child boundaries, retaining source order within each.
    const bands = [];
    for (const [frame, limit] of [[false, model.config.c4ShapeInRow], [true, model.config.c4BoundaryInRow]]) {
      const list = items.filter(item => item.frame === frame);
      for (let i = 0; i < list.length; i += limit) bands.push(list.slice(i, i + limit));
    }
    const boxes = [];
    let w = 0, y = 0, above = null;
    for (const band of bands) {
      const placed = band.map(sized);
      if (above) y += Math.max(...above.map(box => box.h)) + room(above, placed, 'h');
      let x = 0;
      placed.forEach((box, i) => {
        if (i) x += placed[i - 1].w + room([placed[i - 1]], [box], 'w');
        Object.assign(box, { x, y });
        w = Math.max(w, x + box.w);
      });
      boxes.push(...placed);
      above = placed;
    }
    return { w, h: above ? y + Math.max(...above.map(box => box.h)) : 0, boxes };
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

const TRACK_GAP = 8;

function sharesChannel([a, b], [c, d]) {
  const len = distance(a, b);
  if (!len) return false;
  const x = (b.x - a.x) / len, y = (b.y - a.y) / len;
  const cross = p => x * (p.y - a.y) - y * (p.x - a.x);
  const project = p => x * (p.x - a.x) + y * (p.y - a.y);
  const p = project(c), q = project(d), offset = cross(c), rise = cross(d) - offset;
  if (Math.abs(rise) > Math.abs(q - p) * 0.1 || p === q) return false;
  const lo = Math.max(0, Math.min(p, q)), hi = Math.min(len, Math.max(p, q));
  // Compare only the common longitudinal run (a longer route can diverge beyond it).
  const gap = Math.max(...[lo, hi].map(u => Math.abs(offset + (u - p) * rise / (q - p))));
  return (hi - lo > 3 && gap <= 1.1) || (hi - lo > 8 && gap < TRACK_GAP);
}

function route(a, b, obstacles, existing, bounds, index) {
  const clear = path => segments(path).every(seg => !obstacles.some(box => hits(seg, box)) && !existing.some(other => sharesChannel(other, seg) || sharesChannel(seg, other)));
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

function iconShape(ctx, icon, x, y, ink) {
  if (!icon) return [];
  const [l, t, w, h] = icon.viewBox.split(/\s+/).map(Number), scale = 18 / Math.max(w, h);
  const solid = icon.set === 'simple';
  return [{ ...ctx.el('g', { transform: `translate(${x - (l + w / 2) * scale} ${y - (t + h / 2) * scale}) scale(${scale})`,
    fill: solid ? ink : 'none', stroke: solid ? 'none' : ink, 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
  icon.elements.map(({ tag, attrs }) => ctx.shape(tag, attrs))), meta: { kind: 'icon' } }];
}

function drawBox(ctx, b) {
  const { x, y, w, h } = b;
  const status = b.borderColor || b.status || b.bgColor || (b.external ? 'ext' : null);
  const ink = ctx.design[status] ?? ctx.frameTone(mix(ctx.design.line2, ctx.design.fg3, b.frame ? 0.48 : 0.27));
  const tint = b.bgColor || b.status;
  const paint = { fill: b.frame ? 'none' : tint ? mix(ctx.design.surface, ctx.design[tint], 0.08) : ctx.design.surface, stroke: ink, 'stroke-width': 1.25,
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
    if (!b.frame && b.shape === 'person' && !b.icon) details = [ctx.shape('circle', { cx: cx(b), cy: y + 15, r: 5, fill: ink }),
      ctx.path(`M${cx(b) - 9} ${y + 32} C${cx(b) - 9} ${y + 21} ${cx(b) + 9} ${y + 21} ${cx(b) + 9} ${y + 32} Z`, { fill: ink })];
  }
  const alignRight = b.frame && b.align === 'right';
  const labels = b.lines.map(({ text, font }, i) => ctx.text(b.frame ? alignRight ? x + w - PAD : x + PAD : cx(b), y + PAD + b.topSpace + (i + 0.5) * LINE, text, {
    anchor: b.frame ? alignRight ? 'end' : 'start' : 'middle', 'dominant-baseline': 'central', size: font.size, weight: font.weight,
    fill: font === FONT.title ? ctx.design[b.fontColor] ?? ctx.design.fg1 : ctx.design.fg3,
  }));
  const icons = iconShape(ctx, b.icon, b.frame ? alignRight ? x + w - PAD - 9 : x + PAD + 9 : cx(b), y + PAD + b.iconSpace - 11, ink);
  const shapes = [outline, ...details, ...icons, ...labels];
  return b.link ? [ctx.link(b.link.href, shapes, b.link)] : shapes;
}

function layout(model, { width, ctx, lang, compact }) {
  const root = makeBoxes(model, ctx, lang), nodes = [], frames = [], byId = new Map();
  const margin = 38;
  const sceneWidth = Math.max(compact ? 0 : width, root.w + 2 * margin);
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
    const w = Math.max(b.iconSpace, ...b.lines.map(({ text, font }) => ctx.measure(text, font.size, font.weight))) + 6;
    return { x: b.align === 'right' ? b.x + b.w - PAD + 3 - w : b.x + PAD - 3, y: b.y + PAD - 3, w, h: b.topSpace + b.lines.length * LINE + 6 };
  });
  const children = frames.flatMap(b => drawBox(ctx, b));
  const occupied = [...nodes, ...headers];
  const used = [], routes = [], errors = [], arrowBoxes = [];
  for (const [i, rel] of model.rels.entries()) {
    const a = byId.get(rel.from), b = byId.get(rel.to);
    const blockers = frames.filter(frame => frame !== a && frame !== b && !contains(frame, a) && !contains(frame, b));
    const obstacles = [...nodes.filter(box => box !== a && box !== b).map(box => inflate(box, TRACK_GAP)),
      ...[...headers, ...blockers].map(box => inflate(box, 4))];
    // Endpoints are also obstacles after the first short port segment.
    const endpointInsets = [a, b].filter(box => !box.frame || a === b || !contains(box, box === a ? b : a)).map(box => inflate(box, -2));
    const path = route(a, b, [...obstacles, ...endpointInsets], used,
      { x: 10 + i % 7 * 3, y: 10 + i % 7 * 3, w: sceneWidth - 20 - i % 7 * 6, h: height - 20 - i % 7 * 6 }, i);
    if (!path) {
      errors.push(error(lang, rel.line, '找不到不穿过元素的 C4 连线', 'No clear route for this C4 relationship', '拆分图表或调整声明顺序', 'Split the diagram or reorder declarations'));
      continue;
    }
    const meta = { from: rel.from, to: rel.to };
    const ink = ctx.design[rel.status || rel.lineColor] ?? ctx.design.fg3;
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
  const leaders = [];
  const coarse = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9];
  const fine = Array.from({ length: 19 }, (_, i) => i + 1).flatMap(i => [(20 - i) / 40, (20 + i) / 40])
    .filter(t => !coarse.includes(t));
  for (const { path, rel, meta } of routes) {
    const label = relLabel(rel, ctx);
    if (!label) continue;
    const { lines, iconSpace, w, h } = label;
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
    let box, leader, best = Infinity;
    const other = used.filter(seg => !path.includes(seg[0]) || !path.includes(seg[1])).concat(leaders);
    const clear = tie => !occupied.some(b => hits(tie, b));
    const consider = (p, pOnEdge) => {
      const candidate = plate(p);
      if (!free(candidate)) return;
      const end = point(Math.max(candidate.x, Math.min(candidate.x + w, pOnEdge.x)), Math.max(candidate.y, Math.min(candidate.y + h, pOnEdge.y)));
      const connected = parts.some(seg => hits(seg, candidate));
      const tie = connected ? null : [pOnEdge, end];
      if (tie && !clear(tie)) return;
      const padded = inflate(candidate, 2);
      if (frames.some(frame => overlaps(frame, padded) && !contains(frame, padded))) return;
      const score = distance(point(cx(candidate), cy(candidate)), preferred) + (tie ? distance(...tie) * 2 : 0)
        + 240 * other.filter(seg => hits(seg, candidate)).length;
      if (score < best) { best = score; box = candidate; leader = tie; }
    };
    const search = fractions => {
      for (const t of fractions) {
        const p = along(t);
        consider(point(p.x, 6 + h / 2), p);
        consider(point(p.x, height - 6 - h / 2), p);
        for (const dx of [0, -w / 2 - 4, w / 2 + 4]) for (const dy of [0, -h / 2 - 4, h / 2 + 4, -h - 8, h + 8]) {
          consider(point(p.x + dx, p.y + dy), p);
        }
      }
    };
    consider(preferred, mid);
    search(coarse);
    // Keep existing placements; only look between the coarse samples when none fits.
    if (!box) search(fine);
    if (!box) {
      // Search the free space beside the drawing before parking a label below it.
      for (const t of coarse) {
        const p = along(t);
        for (const x of [6 + w / 2, sceneWidth - 6 - w / 2]) {
          const candidate = plate(point(x, p.y));
          const padded = inflate(candidate, 2);
          if (!free(candidate) || frames.some(frame => overlaps(frame, padded) && !contains(frame, padded))) continue;
          const tie = [p, point(p.x < x ? candidate.x : candidate.x + w, p.y)];
          if (!clear(tie)) continue;
          const score = distance(...tie);
          if (score < best) { best = score; box = candidate; leader = tie; }
        }
      }
    }
    if (!box) {
      // The lowest clear vertical leader keeps the parked label attached without cutting through cards.
      const anchors = [...path, ...coarse.map(along), ...fine.map(along)].sort((a, b) => b.y - a.y);
      for (const p of anchors) {
        const candidate = plate(point(p.x, height + h / 2));
        const tie = [p, point(p.x, candidate.y)];
        if (p.x < candidate.x || p.x > candidate.x + w || !clear(tie)) continue;
        box = candidate;
        leader = tie;
        break;
      }
      if (!box) {
        box = plate(point(mid.x, height + h / 2));
        leader = [mid, point(cx(box), box.y)];
      }
      height += h + 14;
    }
    if (leader) {
      leaders.push(leader);
      children.push(ctx.path(`M${leader[0].x} ${leader[0].y} L${leader[1].x} ${leader[1].y}`, { fill: 'none', stroke: ctx.design.fg3, 'stroke-dasharray': '2 3', meta: { kind: 'leader', ...meta } }));
    }
    occupied.push(box);
    children.push({ ...ctx.el('g', {}, [ctx.rect(box.x, box.y, box.w, box.h, { fill: ctx.design.bg, stroke: ctx.design.line2, rx: 5 }),
      ...iconShape(ctx, rel.icon, cx(box), box.y + 14, ctx.design[rel.status || rel.textColor] ?? ctx.design.fg3),
      ...lines.map((line, i) => ctx.text(cx(box), box.y + 4 + iconSpace + (i + 0.5) * LINE, line, { anchor: 'middle', 'dominant-baseline': 'central', size: FONT.label.size, fill: ctx.design[rel.textColor] ?? ctx.design.fg1 }))]), meta: { kind: 'edge-label-group', ...meta } });
  }
  if (sceneWidth > 2 * width || nodes.length > 60) errors.push(warning('LARGE_DIAGRAM', lang, 1, 'C4 图较大', 'Large C4 diagram', '考虑拆分图表', 'Consider splitting the diagram'));
  return { scene: { width: sceneWidth, height, children, title: model.title, heading: model.title }, errors };
}

const implementations = Object.fromEntries(TYPES.map(kind => [kind, { parse, layout, acceptsPresentation: true, honoredConfig }]));
export { implementations };
