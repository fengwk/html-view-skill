import { cubicPath } from '../core/geometry.js';
import { resolveIconRef } from '../core/icons.js';
import { normalizeLabel } from './label.js';
import { presentation } from './presentation.js';
import { layoutGraph } from './graph-layout.js';
import { appearance, DIRECTIONS, error, FONT, maxWidthOf, textBlock, warning, wrapText } from './support.js';

const quoted = /^(?:"[^"]*"|'[^']*')$/;
const bare = /^[\w]+$/;
const label = raw => quoted.test(raw.trim()) ? raw.trim().slice(1, -1) : raw.trim();
const classSuffix = /\s*:::\s*([\w-]+(?:\s*,\s*[\w-]+)*)$/;
const configKey = (source, name) => Object.entries(source ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
const iconSlot = '\uFFFC'; // Layout-only space for an edge label glyph.
const honoredConfig = ['actorFontSize', 'usecaseFontSize', 'diagramPadding'].map(key => `usecase.${key}`);

// Split only outside a quoted label, node shape, or metadata object.
function scan(text, visit) {
  let quote = '', depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\' && text[i + 1] === quote && depth && text.includes('@{')) i++;
      else if (ch === quote) quote = '';
    } else {
      if (!depth && visit?.(i) === false) break;
      if (ch === '"' || ch === "'") quote = ch;
      else if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
    }
  }
  return !quote && depth === 0;
}

function split(text, separator) {
  const parts = [];
  let start = 0;
  scan(text, i => {
    if (text[i] === separator) { parts.push(text.slice(start, i).trim()); start = i + 1; }
  });
  return [...parts, text.slice(start).trim()];
}

function metadata(raw) {
  const fields = Object.create(null);
  for (const field of split(raw, ',').filter(Boolean)) {
    const result = /^(\w+)\s*:\s*(.+)$/s.exec(field);
    if (!result || !/^(?:[\w-]+|"[^"]*"|'[^']*')$/.test(result[2].trim())) return null;
    fields[result[1]] = label(result[2]);
  }
  return fields;
}

function entity(text) {
  const suffix = classSuffix.exec(text);
  if (suffix) text = text.slice(0, suffix.index);
  const m = /^([\w]+|"[^"]*"|'[^']*')\s*(?:\(([^]*?)\)|\[([^]*?)\])?\s*(?:@\{([^]*?)\})?\s*(?:<<([^<>]+)>>)?$/.exec(text);
  if (!m) return null;
  const name = bare.test(m[1]) ? undefined : label(m[1]);
  const fields = m[4] == null ? {} : metadata(m[4]);
  if (!fields) return null;
  return { id: name == null ? m[1] : normalizeLabel(name).text.replace(/\W/g, '_'),
    label: m[2] != null || m[3] != null ? label(m[2] ?? m[3]) : name,
    shape: m[3] != null ? 'rect' : m[2] != null ? 'ellipse' : undefined, stereotype: m[5]?.trim(), fields, classes: suffix?.[1].split(/\s*,\s*/) };
}

function relation(text) {
  let result;
  scan(text, i => {
    if (!'-.<ox'.includes(text[i])) return;
    const op = /^(?:--\s+((?:"[^"]*"|'[^']*'|.+?))\s+(-{2,}>)|(-{2,}>|--\|>|<-{2,}|--[ox]|[ox]--|\.{2}>|-{2,}))/.exec(text.slice(i));
    if (!op || (!op[2] && !op[3])) return;
    let lhs = text.slice(0, i).trim();
    const edgeId = /\s+(\w+)@$/.exec(lhs);
    if (edgeId) lhs = lhs.slice(0, edgeId.index).trimEnd();
    const from = entity(lhs);
    if (!from) return;
    let rhs = text.slice(i + op[0].length).trim(), caption = op[1] ? label(op[1]) : '', dependency;
    const operator = op[2] || op[3];
    if (operator === '..>') {
      const kind = /^:\s*(include|extend)\s+/.exec(rhs);
      if (!kind) return;
      dependency = kind[1];
      caption = `«${dependency}»`;
      rhs = rhs.slice(kind[0].length);
    }
    const to = entity(rhs);
    if (!to) return;
    result = { from, to, id: edgeId?.[1], label: caption, dependency,
      extra: Math.min(40, Math.max(0, (operator.match(/-+/)?.[0].length ?? 2) - 2)),
      start: operator.startsWith('<') ? 'arrow' : operator.startsWith('o') ? 'circle' : operator.startsWith('x') ? 'cross' : null,
      end: operator === '--|>' ? 'triangle' : operator.endsWith('>') ? 'arrow' : operator.endsWith('o') ? 'circle' : operator.endsWith('x') ? 'cross' : null };
    return false;
  });
  return result;
}

function jsonRows(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SyntaxError('Expected a JSON object');
  // Read validated JSON in lexical order, including integer-like object keys.
  const tokens = raw.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g);
  const rows = [];
  let i = 0;
  function read(path, depth = 0) {
    if (depth > 128) throw new SyntaxError('JSON nesting exceeds the work limit');
    const token = tokens[i++];
    if (token !== '{' && token !== '[') {
      rows.push([path, token.startsWith('"') ? JSON.parse(token) : token]);
      return;
    }
    const close = token === '{' ? '}' : ']';
    if (tokens[i] === close) rows.push([path || '—', token + close]);
    for (let index = 0; tokens[i] !== close; index++) {
      if (index) i++;
      if (token === '[') read(`${path}[${index}]`, depth + 1);
      else {
        const key = JSON.parse(tokens[i++]);
        i++;
        read(path ? `${path}.${key}` : key, depth + 1);
      }
    }
    i++;
  }
  read('');
  return rows;
}

function parse(body, info) {
  const errors = [], symbols = new Map(), edges = [], notes = [], assignments = [];
  const look = presentation(info), seenAssets = new Set();
  const reportAsset = diagnostic => {
    if (!seenAssets.has(diagnostic.message)) errors.push(diagnostic);
    seenAssets.add(diagnostic.message);
  };
  const clean = (text, line) => {
    const result = normalizeLabel(text, { lang: info.lang, line });
    result.diagnostics.forEach(reportAsset);
    return result;
  };
  const fix = ['检查用例声明和关系两端', 'Check declarations and relation endpoints'];
  const fail = (line, en, zh = '无效或冲突的用例声明') => errors.push(error(info.lang, line, zh, en, ...fix));
  const asset = (line, ref) => reportAsset(warning('IGNORED_ASSET', info.lang, line, `未知图标 ${ref}`, `Unknown icon ${ref}`));
  let direction = 'LR', parent = null;
  const config = configKey(info.config, 'usecase');
  function fontSize(key) {
    const value = configKey(config, key);
    const size = typeof value === 'number' && Number.isFinite(value) ? Math.max(12, Math.min(16, value)) : FONT.body.size;
    if (value != null && size !== value) errors.push(warning('IGNORED_CONFIG', info.lang, info.configLines?.[`usecase.${key.toLowerCase()}`] || info.headerLine,
      `${key} 按 ${size}px 绘制`, `${key} is rendered at ${size}px`));
    return size;
  }
  const fonts = { actor: fontSize('actorFontSize'), usecase: fontSize('usecaseFontSize') };
  function declare(item, kind, line, owner = null) {
    const existing = symbols.get(item.id);
    const node = existing || { id: item.id, line, fields: Object.create(null) };
    if (existing && kind && existing.kind && existing.kind !== kind) fail(line, `Conflicting entity kind: ${item.id}`);
    if (owner && node.parent && node.parent !== owner) fail(line, `Entity belongs to two systems: ${item.id}`);
    for (const key of ['label', 'shape', 'stereotype']) {
      if (item[key] != null && node[key] != null && item[key] !== node[key]) fail(line, `Conflicting ${key}: ${item.id}`);
      if (item[key] != null) node[key] = item[key];
    }
    node.kind ||= kind;
    if (owner) node.parent = owner;
    Object.assign(node.fields, item.fields);
    if (item.classes) look.addClasses(item.id, item.classes, line);
    symbols.set(item.id, node);
    return node;
  }
  if (info.params) fail(info.headerLine, 'Unexpected usecase-beta header suffix');
  if (body.length > 200000) {
    fail(info.firstLine, 'Use case source is too long', '用例源码太长');
    return { model: null, errors };
  }
  const rows = body.split('\n');
  for (let i = 0; i < rows.length; i++) {
    let text = rows[i].trim();
    const line = info.firstLine + i;
    if (!text || text.startsWith('%%') || look.accept(text, line)) continue;
    // prepareSource normalizes Markdown string breaks; JSON may still span lines.
    if (/^json\s/i.test(text)) {
      while (!scan(text) && i + 1 < rows.length) text += `\n${rows[++i]}`;
    }
    const dir = /^direction\s+(\w+)$/i.exec(text);
    const boundary = /^systemBoundary\s+(.+)$/.exec(text);
    const actor = /^actor\s+(.+)$/.exec(text);
    const note = /^note\s+for\s+(\w+)\s+(.+)$/.exec(text);
    const suffix = /^json\s/.test(text) ? classSuffix.exec(text) : null;
    const json = /^json\s+(\w+)\s*@\{([^]*)\}$/.exec(suffix ? text.slice(0, suffix.index) : text);
    const assign = /^(\w+)\s*@\{([^]*)\}$/.exec(text);
    if (dir && !parent && [...DIRECTIONS, 'TD'].includes(dir[1].toUpperCase())) {
      direction = dir[1].toUpperCase().replace('TD', 'TB');
    } else if (text === 'end' && parent) parent = null;
    else if (boundary && !parent && entity(boundary[1])) {
      const item = entity(boundary[1]);
      delete item.shape;
      parent = declare(item, 'boundary', line).id;
    } else if (note && !parent && quoted.test(note[2])) {
      notes.push({ id: `@note${notes.length}`, kind: 'note', target: note[1], label: label(note[2]), line });
    } else if (json && !parent) {
      try { declare({ id: json[1], classes: suffix?.[1].split(/\s*,\s*/) }, 'json', line).rows = jsonRows(`{${json[2]}}`); }
      catch (cause) { if (!(cause instanceof SyntaxError)) throw cause; fail(line, 'Expected a strict JSON object', '需要合法的 JSON 对象'); }
    } else if (assign && !parent && metadata(assign[2])) {
      assignments.push({ id: assign[1], fields: metadata(assign[2]), line });
    } else {
      const expression = actor ? actor[1] : text;
      const parts = actor ? split(expression, ',') : [expression];
      const edge = parent ? null : relation(parts.at(-1));
      const items = (edge ? parts.slice(0, -1) : parts).map(entity);
      if (items.some(item => !item) || (!edge && !items.length)) { fail(line, 'Invalid use case statement'); continue; }
      for (const item of items) declare(item, actor ? 'actor' : 'usecase', line, parent);
      if (edge) {
        const from = declare(edge.from, actor ? 'actor' : null, line);
        const to = declare(edge.to, null, line);
        if (edge.id) declare({ id: edge.id }, 'edge', line);
        edges.push({ ...edge, from: from.id, to: to.id, line });
      }
    }
  }
  if (parent) fail(symbols.get(parent).line, 'Unclosed system boundary', '系统边界缺少 end');
  for (const { id, fields, line } of assignments) {
    const node = symbols.get(id);
    if (node) Object.assign(node.fields, fields);
    else fail(line, `Unknown metadata target: ${id}`);
  }
  const nodes = [], boundaries = [];
  for (const node of symbols.values()) {
    node.kind ||= 'usecase';
    const normalized = clean(node.label ?? node.id, node.line);
    node.label = normalized.text;
    node.icon = normalized.icon;
    if (node.stereotype) node.stereotype = clean(node.stereotype, node.line).text;
    node.status = look.statusOf(node.id);
    node.link = look.linkOf(node.id);
    const { type, business, icon } = node.fields;
    const allowed = { actor: ['type', 'business', 'icon'], usecase: ['business'], boundary: ['type'], json: [], edge: ['animate', 'animation'] }[node.kind];
    if (Object.keys(node.fields).some(key => !allowed.includes(key))) fail(node.line, `Invalid metadata for ${node.id}`);
    node.business = business === 'true';
    if (business != null && !['true', 'false'].includes(business)) fail(node.line, 'business requires a boolean');
    if (node.kind === 'actor') {
      node.variant = type || 'normal';
      if (!['normal', 'hollow', 'awesome'].includes(node.variant) || (icon && node.variant !== 'normal') || (node.business && (icon || node.variant === 'awesome'))) fail(node.line, `Invalid actor variant: ${node.id}`);
      if (icon) {
        node.icon = resolveIconRef(icon);
        if (!node.icon) asset(node.line, icon);
      }
    }
    if (node.kind === 'usecase' && node.business && node.shape === 'rect') fail(node.line, 'A business use case must be elliptical');
    if (node.kind === 'boundary') {
      if (type && !['rect', 'package'].includes(type)) fail(node.line, `Invalid system boundary type: ${type}`);
      boundaries.push({ ...node, package: type === 'package' });
    } else if (node.kind !== 'edge') nodes.push(node);
  }
  for (const [index, edge] of edges.entries()) {
    edge.status = look.edgeStatusOf(index) ?? (edge.id ? look.statusOf(edge.id) : null);
    edge.link = edge.id ? look.linkOf(edge.id) : null;
    const normalized = clean(edge.label, edge.line);
    edge.label = normalized.text;
    edge.icon = normalized.icon;
    const from = symbols.get(edge.from).kind, to = symbols.get(edge.to).kind;
    if (['boundary', 'edge'].includes(from) || ['boundary', 'edge'].includes(to) ||
        (edge.dependency && (from !== 'usecase' || to !== 'usecase')) ||
        (edge.end === 'triangle' && (from !== to || !['actor', 'usecase'].includes(from))) ||
        (edge.start && from === 'json') || (edge.end && edge.end !== 'arrow' && to === 'json')) fail(edge.line, 'Invalid relation endpoints');
  }
  for (const note of notes) {
    if (!['actor', 'usecase'].includes(symbols.get(note.target)?.kind)) fail(note.line, `Unknown note target: ${note.target}`);
    const normalized = clean(note.label, note.line);
    note.label = normalized.text;
    note.icon = normalized.icon;
    nodes.push(note);
    edges.push({ from: note.id, to: note.target, line: note.line, note: true });
  }
  if (nodes.length > 2000 || edges.length > 5000) fail(info.firstLine, 'Use case diagram exceeds the work limit', '用例图超过处理上限');
  errors.push(...look.diagnostics());
  return { model: { nodes, boundaries, edges, direction, fonts, padding: configKey(config, 'diagramPadding') }, errors };
}

function measureNode(node, measure, cap, fonts) {
  const isSmall = node.kind === 'note' || node.kind === 'json';
  const font = isSmall ? FONT.label : { ...FONT.body, size: fonts[node.kind] ?? FONT.body.size };
  const pitch = Math.max(17, font.size + 4);
  const iconWidth = node.kind !== 'actor' && node.icon ? 20 : 0;
  const lines = wrapText(node.label, cap, font, measure);
  const stereo = node.stereotype ? wrapText(`«${node.stereotype}»`, cap, FONT.label, measure) : [];
  const rows = node.rows?.map(row => row.map(value => wrapText(value, cap / 2, font, measure)));
  const columns = rows ? [0, 1].map(index => Math.max(26, ...rows.map(row => maxWidthOf(row[index], font, measure))) + 16) : [];
  const textHeight = pitch * (Math.max(lines.length, iconWidth ? 1 : 0) + stereo.length);
  const textWidth = Math.max(maxWidthOf(lines, font, measure), maxWidthOf(stereo, FONT.label, measure));
  const w = Math.max(node.kind === 'usecase' ? 120 : 70, textWidth + iconWidth + (node.kind === 'usecase' && node.shape !== 'rect' ? 52 : 30), columns[0] + columns[1] || 0);
  const h = node.kind === 'actor' ? 54 + textHeight : rows ? 27 + rows.reduce((n, row) => n + rowHeight(row), 0) : textHeight + 30;
  return { lines, stereo, rows, columns, w, h, font, pitch, iconWidth };
}

const rowHeight = row => 16 * Math.max(row[0].length, row[1].length) + 8;

function layout(model, options) {
  const { measure, width, lang } = options;
  const diagrams = new Map();
  let geometry;
  for (const cap of [180, 140, 100]) {
    const measures = new Map();
    // The shared layout sizes a label rectangle from its title and description rows.
    // Supply measured UML footprints through those inputs; only the real labels reach the scene.
    const nodes = model.nodes.map((node, seq) => {
      const metrics = measureNode(node, measure, cap, model.fonts);
      diagrams.set(node.id, { ...node, ...metrics });
      const key = `\uE000${seq}\uE001`;
      measures.set(key, Math.min(200, metrics.w - 28));
      return { id: node.id, seq, parent: node.parent, shape: 'rect', label: key,
        desc: Array.from({ length: Math.max(0, Math.ceil((metrics.h - 44) / 17)) }, () => '·') };
    });
    const subgraphs = model.boundaries.map((boundary, seq) => ({ id: boundary.id, title: boundary.label, seq, depth: 1 }));
    geometry = layoutGraph({ type: 'usecase-beta', direction: model.direction, nodes, subgraphs,
      edges: model.edges.map((edge, seq) => ({ ...edge, seq,
        label: edge.icon ? `${iconSlot}${edge.label ? ` ${edge.label}` : ''}` : edge.label,
        startArrow: Boolean(edge.start), endArrow: Boolean(edge.end) })) },
    { ...options, measure: (text, font) => measures.get(text) ?? (text.startsWith(iconSlot) ? 16 + measure(text.slice(1), font) : measure(text, font)) });
    if (geometry.width <= width * 1.6) break;
  }
  const errors = [];
  if (geometry.width > width * 2 || model.nodes.length > 60) errors.push(warning('LARGE_DIAGRAM', lang, model.nodes[0]?.line,
    '用例图较大，可拆成多张图', 'Large use case diagram; consider splitting it'));
  return { ...geometry, diagrams, uml: model, errors };
}

function markerDefs(ctx, a) {
  const ink = a.fg4;
  const marker = (id, refX, glyph) => ctx.el('marker', { id: `uml-${id}`, viewBox: '0 0 12 12', refX, refY: 6,
    markerWidth: 12, markerHeight: 12, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' }, [glyph]);
  return ctx.el('defs', {}, [
    marker('arrow', 10, ctx.path('M2 2 L10 6 L2 10 Z', { fill: ink })),
    marker('dependency', 10, ctx.path('M2 2 L10 6 L2 10 Z', { fill: a.info })),
    marker('triangle', 11, ctx.path('M1 1 L11 6 L1 11 Z', { fill: a.surface, stroke: ink, 'stroke-width': 1.25 })),
    marker('circle', 10, ctx.circle(7, 6, 3, { fill: a.surface, stroke: ink, 'stroke-width': 1.25 })),
    marker('cross', 9, ctx.path('M3 3 L9 9 M3 9 L9 3', { stroke: ink, 'stroke-width': 1.25 })),
  ]);
}

function iconAt(ctx, icon, x, y, size, color) {
  const [left, top, w, h] = icon.viewBox.split(/\s+/).map(Number), scale = size / Math.max(w, h);
  return ctx.el('g', { transform: `translate(${x - (left + w / 2) * scale} ${y - (top + h / 2) * scale}) scale(${scale})` },
    icon.elements.map(({ tag, attrs }) => ctx.shape(tag, { ...attrs, ...(icon.set === 'simple' ? { fill: color }
      : { fill: 'none', stroke: color, 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }) })));
}

const linked = (ctx, item, drawing) => item.link ? ctx.link(item.link.href, [drawing], item.link) : drawing;

function drawNode(ctx, box, node, a) {
  const { x, y, w, h } = box, cx = x + w / 2, cy = y + h / 2;
  const meta = { kind: 'node', id: node.id, ...(node.status ? { status: node.status } : {}) };
  const stroke = a[node.status] || ctx.tint(a.bg, ctx.frameTone(ctx.color('tone1')), .52);
  const fill = node.status ? ctx.tint(a.node, stroke, .09) : a.node;
  const shape = { fill, stroke, 'stroke-width': 1.25, meta };
  const block = (lines, px, py, font = FONT.body, fill = a.fg1, anchor = 'middle', lineHeight = 17) =>
    textBlock(ctx, { x: px, y: py, lines, font, fill, anchor, lineHeight });
  const stereoH = node.stereo.length * node.pitch;
  const labelH = node.lines.length * node.pitch;
  const centerText = (lines, px, py) => block(lines, px, py, node.font, a.fg1, 'middle', node.pitch);
  const text = center => {
    const labelY = center + stereoH / 2;
    const shift = node.iconWidth && node.lines.length ? node.iconWidth / 2 : 0;
    const iconX = shift ? cx - Math.max(...node.lines.map(line => ctx.measure(line, node.font.size, node.font.weight))) / 2 - 2 : cx;
    return [block(node.stereo, cx, center - labelH / 2, FONT.label, a.muted), centerText(node.lines, cx + shift, labelY),
      ...(node.iconWidth ? [iconAt(ctx, node.icon, iconX, labelY, 14, stroke)] : [])];
  };
  if (node.kind === 'actor') {
    const py = cy - (stereoH + labelH) / 2 - 20;
    const pen = { fill: 'none', stroke: node.status ? stroke : a.fg2, 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    const body = node.variant === 'hollow' ? 'M-13 16 H13 V22 H5 L12 34 H5 L0 27 L-5 34 H-12 L-5 22 H-13 Z'
      : node.variant === 'awesome' ? 'M-16 35 C-16 11 16 11 16 35 Z' : 'M0 14 V26 M-13 18 H13 M0 26 L-11 36 M0 26 L11 36';
    const glyph = node.icon ? ctx.el('g', {}, [ctx.rect(cx - 16, py + 2, 32, 32, { fill, stroke, rx: a.smallRadius }),
      iconAt(ctx, node.icon, cx, py + 18, 21, node.status ? stroke : a.fg2)]) : ctx.el('g', { transform: `translate(${cx} ${py})` }, [ctx.circle(0, 7, 7, { ...pen, fill: node.variant === 'awesome' ? a.surface2 : a.node }),
      ctx.path(body, { ...pen, ...(node.variant === 'awesome' ? { fill: a.surface2 } : {}) }),
      ...(node.business ? [ctx.path('M-17 36 L17 2', pen)] : [])]);
    return ctx.el('g', {}, [ctx.rect(x, y, w, h, { fill: 'none', stroke: 'none', meta }), glyph, ...text(cy + 22)]);
  }
  if (node.kind === 'note') {
    const fold = 8;
    return ctx.el('g', {}, [ctx.shape('polygon', { points: `${x},${y} ${x+w-fold},${y} ${x+w},${y+fold} ${x+w},${y+h} ${x},${y+h}`,
      ...shape, fill: a.surface2, stroke: ctx.tint(a.bg, a.warn, .48) }, meta),
    ctx.path(`M${x+w-fold} ${y} v${fold} h${fold}`, { stroke: ctx.tint(a.bg, a.warn, .48), fill: 'none' }),
    block(node.lines, x + 12 + node.iconWidth, cy, FONT.label, a.fg2, 'start'),
    ...(node.icon ? [iconAt(ctx, node.icon, x + 18, cy, 14, a.fg2)] : [])]);
  }
  if (node.kind === 'json') {
    const head = y + (h - 27 - node.rows.reduce((n, row) => n + rowHeight(row), 0)) / 2;
    const children = [ctx.rect(x, y, w, h, { ...shape, rx: a.smallRadius }),
      ctx.rect(x + 1, y + 1, w - 2, head + 25 - y, { fill: ctx.tint(a.bg, a.info, .06), rx: a.smallRadius }),
      block(node.lines, cx, head + 13, { ...FONT.label, weight: 600 })];
    let rowY = head + 27;
    for (const row of node.rows) {
      const height = rowHeight(row);
      children.push(ctx.path(`M${x} ${rowY} H${x+w}`, { stroke: a.line2 }),
        block(row[0], x + 8, rowY + height / 2, FONT.label, a.muted, 'start', 16),
        block(row[1], x + w - 8, rowY + height / 2, FONT.label, a.fg2, 'end', 16));
      rowY += height;
    }
    return ctx.el('g', {}, children);
  }
  const outline = node.shape === 'rect' ? ctx.rect(x, y, w, h, { ...shape, rx: a.radius })
    : ctx.shape('ellipse', { cx, cy, rx: w / 2, ry: h / 2, fill, stroke, 'stroke-width': 1.25 }, meta);
  return ctx.el('g', {}, [outline, ...text(cy), ...(node.business ? [ctx.path(`M${x+14} ${cy+8} l11 -15`, { stroke: a.fg2, 'stroke-width': 1.6 })] : [])]);
}

function attachEllipse(point, box) {
  const rx = box.w / 2, ry = box.h / 2;
  const x = box.x + rx, y = box.y + ry;
  const dx = (point.x - x) / rx, dy = (point.y - y) / ry;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: x + Math.sign(dx) * rx * Math.sqrt(Math.max(0, 1 - dy * dy)), y: point.y };
  return { x: point.x, y: y + Math.sign(dy) * ry * Math.sqrt(Math.max(0, 1 - dx * dx)) };
}

// A long inter-rank edge can fall back to a straight line in the shared router.
// Keep its placement and ports, but detour around intervening boxes on a clear track.
function detour(segments, edge, geometry) {
  if (segments.length !== 1 || edge.labelRect) return segments;
  const { p0, p1, c1, c2 } = segments[0];
  const axis = p0.y === p1.y ? 'x' : p0.x === p1.x ? 'y' : null;
  if (!axis) return segments;
  const cross = axis === 'x' ? 'y' : 'x', size = axis === 'x' ? 'w' : 'h', band = axis === 'x' ? 'h' : 'w';
  const low = Math.min(p0[axis], p1[axis]), high = Math.max(p0[axis], p1[axis]);
  const crosses = track => box => box[axis] < high && box[axis] + box[size] > low && track >= box[cross] - 3 && track <= box[cross] + box[band] + 3;
  if (c1[cross] !== p0[cross] || c2[cross] !== p0[cross]) return segments;
  const obstacles = geometry.nodes.filter(n => n.id !== edge.from && n.id !== edge.to);
  const blocked = obstacles.filter(crosses(p0[cross]));
  if (!blocked.length) return segments;
  const clear = 10, direction = Math.sign(p1[axis] - p0[axis]);
  const entry = direction > 0 ? Math.min(...blocked.map(n => n[axis])) : Math.max(...blocked.map(n => n[axis] + n[size]));
  const exit = direction > 0 ? Math.max(...blocked.map(n => n[axis] + n[size])) : Math.min(...blocked.map(n => n[axis]));
  if (direction * (entry - p0[axis]) < clear || direction * (p1[axis] - exit) < clear) return segments;
  const tracks = [...blocked.flatMap(n => [n[cross] + n[band] + clear, n[cross] - clear])];
  const headers = geometry.frames.map(frame => frame.titleRect).filter(Boolean);
  const track = tracks.find(value => value >= 12 && value <= (axis === 'x' ? geometry.height : geometry.width) - 12 &&
    !obstacles.some(crosses(value)) && !headers.some(crosses(value)));
  if (track === undefined) return segments;
  const points = [p0, { [axis]: entry - direction * clear, [cross]: track }, { [axis]: exit + direction * clear, [cross]: track }, p1];
  return points.slice(1).map((p1, index) => {
    const p0 = points[index], middle = (p0[axis] + p1[axis]) / 2;
    return { p0, p1, c1: { ...p0, [axis]: middle }, c2: { ...p1, [axis]: middle } };
  });
}

function scene(geometry, ctx) {
  const { uml, diagrams } = geometry, a = appearance(ctx);
  const children = [markerDefs(ctx, a)], headers = [];
  const boxes = new Map(geometry.nodes.map(box => [box.id, box]));
  for (const [index, frame] of geometry.frames.entries()) {
    const system = uml.boundaries.find(boundary => boundary.id === frame.id);
    const tone = ctx.frameTone(ctx.color(`tone${index % 6 + 1}`));
    const stroke = system.status ? a[system.status] : ctx.tint(a.bg, tone, .43), fill = ctx.tint(a.bg, system.status ? stroke : tone, .06);
    const { x, y, w, h } = frame;
    const lines = frame.lines;
    const headerWidth = Math.min(w - 12, Math.max(64, ...lines.map(line => ctx.measure(line, FONT.title.size, FONT.title.weight) + 18)));
    const th = 17 * lines.length + 6, meta = { kind: 'frame', id: frame.id };
    const tx = x + (system.package ? 0 : 7), ty = y + (system.package ? 0 : 4);
    if (system.package) {
      children.push(linked(ctx, system, ctx.path(`M${x} ${y+h} V${y} H${x+headerWidth} v${th} H${x+w} V${y+h} Z`,
        { fill, stroke, 'stroke-linejoin': 'round', meta })));
    } else {
      children.push(linked(ctx, system, ctx.rect(x, y, w, h, { fill, stroke, rx: a.radius, meta })));
      headers.push(ctx.rect(tx, ty, headerWidth, th, { fill: a.surface, stroke, rx: a.smallRadius }));
    }
    headers.push(textBlock(ctx, { x: tx + 9, y: ty + th / 2, lines, font: FONT.title, anchor: 'start', lineHeight: 17 }));
  }
  for (const edge of geometry.edges) {
    const spec = uml.edges[edge.id];
    const segments = detour(edge.segments, edge, geometry).map(segment => ({ ...segment }));
    if (!segments.length) continue;
    const first = segments[0], last = segments.at(-1);
    for (const [id, segment, pointKey, controlKey] of [[edge.from, first, 'p0', 'c1'], [edge.to, last, 'p1', 'c2']]) {
      const node = diagrams.get(id);
      if (node.kind !== 'usecase' || node.shape === 'rect') continue;
      const point = segment[pointKey], control = segment[controlKey];
      const end = attachEllipse(point, boxes.get(id));
      segment[pointKey] = end;
      segment[controlKey] = { x: control.x + end.x - point.x, y: control.y + end.y - point.y };
    }
    children.push(linked(ctx, spec, ctx.path(cubicPath(segments), { fill: 'none', stroke: a[spec.status] || (spec.dependency ? a.info : a.fg4), 'stroke-width': 1.25,
      ...(spec.dependency || spec.note ? { 'stroke-dasharray': spec.note ? '2 4' : '4 3' } : {}),
      ...(spec.start ? { 'marker-start': `url(#uml-${spec.start})` } : {}),
      ...(spec.end ? { 'marker-end': `url(#uml-${spec.dependency ? 'dependency' : spec.end})` } : {}),
      meta: { kind: 'edge', from: edge.from, to: edge.to, ...(spec.status ? { status: spec.status } : {}) } })));
  }
  children.push(...headers);
  for (const box of geometry.nodes) children.push(linked(ctx, diagrams.get(box.id), drawNode(ctx, box, diagrams.get(box.id), a)));
  for (const edge of geometry.edges) {
    if (!edge.labelRect) continue;
    const { x, y, w, h } = edge.labelRect;
    const spec = uml.edges[edge.id];
    const lines = spec.icon ? edge.labelLines.map(line => line.replace(/^\uFFFC\s*/, '')) : edge.labelLines;
    const first = lines[0] || '';
    const firstY = y + h / 2 - (lines.length - 1) * 8;
    const glyphWidth = first ? ctx.measure(first, FONT.label.size, FONT.label.weight) : 0;
    const hasText = spec.icon && first;
    const group = ctx.el('g', {}, [ctx.rect(x, y, w, h, { fill: a.surface, stroke: a.line2, rx: a.smallRadius }),
      textBlock(ctx, { x: x + w / 2 + (hasText ? 9 : 0), y: y + h / 2, lines, font: FONT.label, lineHeight: 16, fill: a.fg2 }),
      ...(spec.icon ? [iconAt(ctx, spec.icon, x + w / 2 - (hasText ? glyphWidth / 2 + 2 : 0), firstY, 12, a.fg2)] : [])]);
    group.meta = { kind: 'edge-label-group', from: edge.from, to: edge.to };
    children.push(linked(ctx, spec, group));
  }
  const pad = typeof uml.padding === 'number' && Number.isFinite(uml.padding) ? Math.max(0, Math.min(200, uml.padding)) - 16 : 0;
  return { width: Math.max(1, geometry.width + 2 * pad), height: Math.max(1, geometry.height + 2 * pad),
    children: pad ? [ctx.el('g', { transform: `translate(${pad} ${pad})` }, children)] : children };
}

export const implementations = { 'usecase-beta': { optionMode: 'raw', acceptsPresentation: true, honoredConfig, parse, layout, scene } };
