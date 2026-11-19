import { appearance, DIRECTIONS, error, FONT, labelText, warning, wrapText } from './support.js';
import { layoutGraph } from './graph-layout.js';
import { cubicPath } from '../core/geometry.js';

const cards = new Map([
  ['zero-one', ['|o', 'o|', 'one or zero', 'zero or one']],
  ['exactly-one', ['||', 'only one', 'one', '1']],
  ['zero-many', ['}o', 'o{', 'zero or more', 'zero or many', 'many(0)', 'many', '0+']],
  ['one-many', ['}|', '|{', 'one or more', 'one or many', 'many(1)', '1+']],
  [null, ['u']], // Mermaid accepts MD_PARENT but draws no marker.
].flatMap(([kind, spellings]) => spellings.map(spelling => [spelling, kind])));
const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const card = [...cards.keys()].sort((a, b) => b.length - a.length).map(escaped).join('|');
const name = String.raw`(?:"[^"]+"|[\w.*\u0080-\uFFFF-]+)`;
const relation = new RegExp(String.raw`^(${name})\s+(${card})(?:\s*(--|\.\.|\.-|-\.)\s*|\s+(to|optionally to)\s+)(${card})\s+(${name})(?:\s*:\s*(.+))?$`, 'i');
const declaration = new RegExp(String.raw`^(${name})\s*(?:\[\s*("[^"]+"|[^\]]+?)\s*\])?\s*(\{.*)?$`);
const attribute = String.raw`(?:\x60[^\x60]+\x60|[^\s~]*~[^~\r\n]+~[^\s~}]*|[\p{L}_*][\p{L}\p{N}_*\[\]().,-]*)`;
const row = new RegExp(String.raw`\s*(${attribute}\??)\s+(${attribute})(?:\s+((?:PK|FK|UK)\b(?:\s*,\s*(?:PK|FK|UK)\b)*))?(?:\s*("[^"]*"))?`, 'iuy');
const unquote = value => value?.replace(/^"([\s\S]*)"$/, '$1');
const label = value => labelText(unquote(value)).replace(/(^|\s)(\*\*|__|\*|_)(\S(?:.*?\S)?)\2(?=\s|$)/g, '$1$3');
const attrText = value => value.replace(/^`([^`]+)`(\??)$/, '$1$2');
const LIMITS = { nodes: 30, edges: 50, depth: 3 };

function parseEr(body, info = {}) {
  const { header = 'erDiagram', headerLine = 1, firstLine = headerLine + 1, lang } = info;
  const model = { type: 'er', direction: 'TB', nodes: [], edges: [], subgraphs: [] };
  const errors = [], groups = new Map(), entities = new Map(), stack = [];
  let seq = 0, block = null, accessibility = false, duplicateMember = false;
  const issue = (line, zh, en) => errors.push(error(lang, line, zh, en,
    '检查 ER 实体、属性或关系语法', 'Check the ER entity, attribute or relationship syntax'));
  const setDirection = (value, line) => {
    const dir = value.toUpperCase().replace(/^TD$/, 'TB');
    if (!DIRECTIONS.includes(dir)) issue(line, `无效方向：${value}`, `Invalid direction: ${value}`);
    else if (stack.length) stack.at(-1).dir = dir;
    else model.direction = dir;
  };
  // Defer resolving relation endpoints: a referenced subgraph may be declared later.
  const mentions = [];
  const mention = (id, line, alias, fields, endpoint = false) => {
    const item = { id: unquote(id), line, alias, fields, endpoint, parent: stack.at(-1)?.id ?? null, seq: seq++ };
    mentions.push(item);
    return item;
  };
  const addFields = ({ fields, source, line }) => {
    row.lastIndex = 0;
    let offset = 0;
    const limit = source.trimEnd().length;
    while (offset < limit) {
      const field = row.exec(source);
      if (!field) {
        const start = offset + source.slice(offset).search(/\S/);
        issue(line + source.slice(0, start).split('\n').length - 1, '无效的属性行', 'Invalid attribute row');
        return;
      }
      const [, type, attr, keys, comment] = field;
      fields.push({ type: attrText(type), name: attrText(attr), keys: keys?.toUpperCase().split(/\s*,\s*/) ?? [], comment: comment ? labelText(unquote(comment)) : null });
      offset = row.lastIndex;
    }
  };
  const consume = (raw, line) => {
    let text = raw.trim();
    while (text) {
      if (block) {
        // A closing brace inside a quoted word or comment is just text.
        const stop = /"[^"]*"|`[^`]*`|~[^~]*~|(\}|%%)/g;
        const end = [...text.matchAll(stop)].find(match => match[1]);
        const closed = end?.[1] === '}';
        block.source += (end ? text.slice(0, end.index) : text) + (closed ? '' : '\n');
        if (!closed) return;
        addFields(block);
        block = null;
        text = text.slice(end.index + 1).trim();
        continue;
      }
      if (accessibility) { accessibility = !text.includes('}'); return; }
      if (/^accDescr\s*\{/i.test(text)) { accessibility = !text.includes('}'); return; }
      if (/^acc(?:Title|Descr)\s*:/i.test(text)) return;
      const comment = [...text.matchAll(/"[^"]*"|`[^`]*`|~[^~]*~|(%%)/g)].find(match => match[1]);
      if (comment) text = text.slice(0, comment.index).trimEnd();
      if (!text) return;
      const dir = /^direction\s+(.+)$/i.exec(text);
      if (dir) { setDirection(dir[1], line); return; }
      if (/^end$/i.test(text)) {
        if (!stack.pop()) issue(line, '没有对应的子图', 'No matching subgraph');
        return;
      }
      const group = /^subgraph\s+(.+)$/i.exec(text);
      if (group) {
        const decl = declaration.exec(group[1]);
        const id = unquote(decl?.[1]);
        if (!id || decl[3] || groups.has(id)) issue(line, '无效或重复的子图声明', 'Invalid or duplicate subgraph declaration');
        else {
          const item = { id, title: label(decl[2] ?? decl[1]), parent: stack.at(-1)?.id ?? null, seq: seq++, depth: stack.length + 1, dir: null, line };
          if (item.depth === LIMITS.depth + 1) issue(line, `子图嵌套 ${item.depth} 层，超过上限 ${LIMITS.depth}`, `Subgraph nesting exceeds ${LIMITS.depth} levels`);
          groups.set(id, item);
          stack.push(item);
          model.subgraphs.push(item);
        }
        return;
      }
      const rel = relation.exec(text);
      if (rel) {
        const [, from, start, symbol, word, end, to, role] = rel;
        model.edges.push({
          from: mention(from, line, null, null, true).id, to: mention(to, line, null, null, true).id,
          startCard: cards.get(start.toLowerCase()), endCard: cards.get(end.toLowerCase()),
          style: symbol === '--' || word?.toLowerCase() === 'to' ? 'solid' : 'dashed',
          label: role ? label(role.trim()) : null, seq: model.edges.length, extra: 0, line,
        });
        if (model.edges.length === LIMITS.edges + 1) issue(line, `关系超过 ${LIMITS.edges} 条`, `More than ${LIMITS.edges} relationships`);
        return;
      }
      const decl = declaration.exec(text);
      if (!decl) { issue(line, `无法解析的语句：${text}`, `Unrecognized statement: ${text}`); return; }
      const fields = [];
      mention(decl[1], line, decl[2], fields);
      if (decl[3] == null) return;
      block = { fields, source: '', line };
      text = decl[3].slice(1).trim();
      if (!text) block.source = '\n';
    }
  };
  const headerTail = header.replace(/^\s*erDiagram\b/i, '').trim();
  if (DIRECTIONS.includes(headerTail.toUpperCase()) || /^TD$/i.test(headerTail)) setDirection(headerTail, headerLine);
  else consume(headerTail, headerLine);
  body.split('\n').forEach((text, i) => {
    if (block && !text.trim()) block.source += '\n';
    else consume(text, firstLine + i);
  });
  if (block) issue(block.line, '属性块没有结束的 }', 'Unclosed attribute block');
  for (const group of stack) issue(group.line, '子图没有结束的 end', 'Unclosed subgraph');
  for (const { id, alias, fields, endpoint, parent, line, seq } of mentions) {
    if (endpoint && groups.has(id)) continue;
    if (groups.has(id)) { issue(line, '实体与子图同名', 'An entity and a subgraph share the same name'); continue; }
    let entity = entities.get(id);
    if (!entity) {
      entity = { id, label: label(`"${id}"`), kind: 'er', shape: 'er', fields: [], parent, seq, line };
      entities.set(id, entity);
      model.nodes.push(entity);
      if (model.nodes.length === LIMITS.nodes + 1) issue(line, `实体超过 ${LIMITS.nodes} 个`, `More than ${LIMITS.nodes} entities`);
    }
    if (parent && !entity.parent) entity.parent = parent;
    else if (parent && parent !== entity.parent && !duplicateMember) {
      duplicateMember = true;
      errors.push(warning('DIAGRAM_HINT', lang, line, '实体属于多个子图，仅保留首次归属', 'Entities in multiple subgraphs keep their first membership', '每个实体只放在一个子图', 'Place each entity in only one subgraph'));
    }
    if (alias) entity.label = label(alias);
    if (fields) entity.fields.push(...fields);
  }
  for (const edge of model.edges) {
    edge.fromFrame = groups.has(edge.from);
    edge.toFrame = groups.has(edge.to);
  }
  const directedGroups = model.subgraphs.filter(group => group.dir && group.dir !== model.direction);
  if (directedGroups.length) {
    const ids = directedGroups.map(group => group.id).join(', ');
    errors.push(warning('DIAGRAM_HINT', lang, directedGroups[0].line,
      `子图使用全图方向：${ids}`, `Subgraphs use the diagram direction: ${ids}`,
      '在图的顶层设置方向', 'Set the direction at the top level'));
  }
  return { model, errors };
}

function layout(model, options, info) {
  // Reserve the comment's space in the name column before routing any edges.
  const nodes = model.nodes.map(node => ({ ...node, fields: node.fields.map(field => field.comment
    ? { ...field, name: `${field.name}\n${field.comment}` } : field) }));
  const geometry = layoutGraph({ ...model, nodes }, options);
  // The shared loop router omits cardinalities from its return value.
  for (const edge of geometry.edges) if (edge.self) {
    const { startCard, endCard } = model.edges[edge.id];
    Object.assign(edge, { startCard, endCard });
  }
  if (geometry.width > options.width * 2 || nodes.length > 60) {
    geometry.errors = [...(geometry.errors ?? []), warning('LARGE_DIAGRAM', info.lang, info.headerLine,
      'ER 图较大，可横向滚动', 'This ER diagram is large and can be scrolled horizontally',
      '可拆成多个局部图', 'Consider splitting it into smaller diagrams')];
  }
  return { ...geometry, model };
}

function scene(geometry, ctx) {
  const a = appearance(ctx);
  const group = (children, meta) => ({ ...ctx.el('g', {}, children), meta });
  const text = (x, y, value, opts, meta) => ctx.text(x, y, value, { 'dominant-baseline': 'central', ...opts, meta });
  const line = (d, stroke = a.line2) => ctx.path(d, { fill: 'none', stroke });
  const minOne = 'M4 2 V14', maxOne = 'M12 2 V14', many = 'M15 2 L9 8 L15 14 M9 8 H15';
  const zero = ctx.circle(4, 8, 3, { fill: a.surface, stroke: a.fg4, 'stroke-width': 1.4 });
  const bar = d => ctx.path(d, { fill: 'none', stroke: a.fg4, 'stroke-width': 1.4 });
  const markerShapes = { 'zero-one': [zero, bar(maxOne)], 'exactly-one': [bar(minOne), bar(maxOne)], 'zero-many': [zero, bar(many)], 'one-many': [bar(minOne), bar(many)] };
  const defs = ctx.el('defs', {}, Object.entries(markerShapes).map(([kind, children]) => ctx.el('marker', {
    id: `er-card-${kind}`, viewBox: '0 0 16 16', refX: 16, refY: 8,
    markerWidth: 16, markerHeight: 16, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse',
  }, children)));
  const frames = [], edges = [], entities = [], labels = [], titles = [];
  for (const frame of geometry.frames) {
    frames.push(group([ctx.rect(frame.x, frame.y, frame.w, frame.h, { fill: a.surface, stroke: a.line2, rx: 6, 'stroke-dasharray': '5 4' })], { kind: 'frame', id: frame.id }));
    if (frame.lines?.length) {
      const { x, y, w, h } = frame.titleRect;
      titles.push(ctx.rect(x - 3, y - 3, w + 6, h + 6, { fill: a.surface, rx: 2 }));
      frame.lines.forEach((value, i) => titles.push(text(x, y + (i + .5) * 17, value, { anchor: 'start', size: FONT.body.size, weight: FONT.title.weight, fill: a.fg3 }, { kind: 'frame-title', id: frame.id })));
    }
  }
  for (const edge of geometry.edges) {
    const { from, to, startCard, endCard } = edge;
    if (edge.segments?.length) {
      edges.push({ ...ctx.path(cubicPath(edge.segments), {
        fill: 'none', stroke: a.fg4, 'stroke-width': 1.25,
        ...(edge.style === 'dashed' ? { 'stroke-dasharray': '5 4' } : {}),
        ...(startCard ? { 'marker-start': `url(#er-card-${startCard})` } : {}),
        ...(endCard ? { 'marker-end': `url(#er-card-${endCard})` } : {}),
      }), meta: { kind: 'edge', from, to } });
    }
    if (edge.labelRect && edge.labelLines?.length) {
      const { x, y, w, h } = edge.labelRect;
      labels.push(group([ctx.rect(x, y, w, h, { fill: a.surface, rx: 3 }), ...edge.labelLines.map((value, i) => text(x + w / 2, y + h / 2 + (i - (edge.labelLines.length - 1) / 2) * 16, value,
        { anchor: 'middle', size: FONT.label.size, fill: a.fg3 }, { kind: 'edge-label' }))], { kind: 'edge-label-group', from, to }));
    }
  }
  const nodes = new Map(geometry.model.nodes.map(node => [node.id, node]));
  for (const { id, x, y, w, h, er } of geometry.nodes) {
    const node = nodes.get(id);
    const children = [ctx.rect(x, y, w, h, { fill: a.node, stroke: a.line2, 'stroke-width': 1.25, rx: 3 })];
    const headY = er.rows.length ? y + er.headerH / 2 : y + h / 2;
    er.headLines.forEach((value, i) => children.push(text(x + w / 2, headY + (i - (er.headLines.length - 1) / 2) * 19, value,
      { anchor: 'middle', ...FONT.title, fill: a.fg1 }, { kind: 'node-label', id })));
    if (er.rows.length) children.push(line(`M${x + 1} ${y + er.headerH} H${x + w - 1}`));
    let rowY = y + er.headerH + 2;
    for (const [i, row] of er.rows.entries()) {
      const { name, comment } = node.fields[i];
      const nameWidth = Math.max(60, 240 - er.pad * 2 - er.typeW - 24 - er.keyW);
      const nameCount = comment ? wrapText(name, nameWidth, FONT.body, (value, font) => ctx.measure(value, font.size, font.weight)).length : row.nameLines.length;
      const cy = rowY + row.rowH / 2;
      const cell = (values, px, kind, fill, font, anchor = 'start') => values.map((value, j) => text(px, cy + (j - (values.length - 1) / 2) * 17, value,
        { anchor, ...font, fill: typeof fill === 'function' ? fill(j) : fill }, { kind: typeof kind === 'function' ? kind(j) : kind, entity: id, attribute: name }));
      children.push(group([
        ...cell(row.typeLines, x + er.pad, 'attribute-type', a.fg3, FONT.body),
        ...cell(row.nameLines, x + er.pad + er.typeW + 12, j => j < nameCount ? 'attribute' : 'attribute-comment', j => j < nameCount ? a.fg2 : a.fg3, FONT.body),
        ...(row.keyText ? cell([row.keyText], x + w - er.pad, 'attribute-key', a.fg3, FONT.label, 'end') : []),
      ], { kind: 'attribute-row', entity: id, attribute: name }));
      rowY += row.rowH;
    }
    entities.push(group(children, { kind: 'node', id }));
  }
  return { width: geometry.width, height: geometry.height, children: [defs, ...frames, ...edges, ...entities, ...labels, ...titles] };
}

const implementations = { erDiagram: { optionMode: 'raw', parse: parseEr, layout, scene } };
export { implementations, parseEr };
