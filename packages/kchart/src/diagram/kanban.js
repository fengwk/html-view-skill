import { FONT, appearance, error, labelText, warning } from './support.js';

const priorities = new Map([['Very High', 'danger'], ['High', 'warn'], ['Medium', null], ['Low', 'info'], ['Very Low', 'info']]);
const shapes = [['((', '))'], ['{{', '}}'], ['))', '(('], ['-)', '(-'], ['(-', '-)'], ['[', ']'], ['(', ')'], [')', '(']];
const honoredConfig = ['kanban.sectionWidth', 'kanban.padding', 'kanban.ticketBaseUrl'];

function metadata(source) {
  const result = new Map(), pair = /\s*([\w-]+)\s*:\s*("(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[^,]+?)\s*(,|$)/y;
  let at = 0;
  while (at < source.length) {
    pair.lastIndex = at;
    const m = pair.exec(source);
    if (!m) return null;
    const raw = m[2].trim();
    result.set(m[1], raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, '$1') : raw.startsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : raw);
    at = pair.lastIndex;
  }
  return result;
}

function parse(body, { lang, firstLine = 2, title = '', config, options = {} }) {
  const columns = [], errors = [], unknownPriorities = new Map();
  const fail = (line, zh, en) => errors.push(error(lang, line, zh, en, '修正列或卡片声明', 'Fix the column or card declaration'));
  if (Object.keys(options).length) fail(firstLine - 1, 'kanban 不接受标题行选项', 'Unexpected kanban header option');
  let level, column, count = 0;
  for (const [i, raw] of body.split('\n').entries()) {
    const line = firstLine + i;
    let s = raw.trim();
    if (!s || s.startsWith('%%')) continue;
    const meta = /\s*@\{([\s\S]*)\}\s*$/.exec(s);
    const data = meta ? metadata(meta[1].trim()) : new Map();
    if (meta) s = s.slice(0, meta.index).trimEnd();
    const start = s.search(/[\[({)]|-\)/);
    const shape = shapes.find(([open, close]) => start >= 0 && s.slice(start).startsWith(open) && s.endsWith(close));
    if (!data || (!shape && (start >= 0 || !/^\S+$/.test(s))) || /:::/.test(s.slice(0, start < 0 ? s.length : start))) {
      fail(line, '无效的看板条目', 'Invalid kanban item'); continue;
    }
    const id = shape ? s.slice(0, start).trim() : s;
    const label = labelText(data.get('label') ?? (shape ? s.slice(start + shape[0].length, -shape[1].length) : id));
    const indent = raw.search(/\S/);
    // Mermaid flattens every depth below the first column level, even ragged indents.
    level ??= indent;
    if (indent < level) { fail(line, `缩进小于首列的 ${level} 个空格`, `Indentation is shallower than the first column (${level})`); continue; }
    if (++count > 2000) { fail(line, '看板超过 2000 个条目，请拆分图表', 'Board exceeds 2000 items; split the diagram'); break; }
    if (indent === level) { columns.push(column = { id, label, cards: [], ids: new Set() }); continue; }
    if (id && column.ids.has(id)) { fail(line, `本列的卡片 ID 重复：${id}`, `Duplicate card ID in this column: ${id}`); continue; }
    if (id) column.ids.add(id);
    const priority = data.get('priority');
    if (priority && !priorities.has(priority) && !unknownPriorities.has(priority)) unknownPriorities.set(priority, line);
    column.cards.push({ id, line, label, ticket: labelText(data.get('ticket')), assigned: labelText(data.get('assigned')), priority });
  }
  if (!columns.length && !errors.length) fail(firstLine, '缺少看板列', 'Expected at least one column');
  if (unknownPriorities.size) {
    const names = [...unknownPriorities.keys()].join(', ');
    errors.push(warning('DIAGRAM_HINT', lang, unknownPriorities.values().next().value, `未知优先级：${names}`, `Unknown priorities: ${names}`, '使用标准优先级', 'Use a standard priority'));
  }
  return { model: { type: 'kanban', columns, title, count, config: config?.kanban || {} }, errors };
}

function layout(model, { width, ctx, renderOptions }, info = {}) {
  const { columns, config, title, count } = model, t = appearance(ctx), gap = 14, pad = 18;
  const colWidth = Math.max(180, Math.min(560, Number(config.sectionWidth) || 220));
  const inset = Math.max(8, Math.min(28, Number(config.padding) || 10));
  const colsWidth = columns.length * (colWidth + gap) - gap;
  const w = Math.max(width, colsWidth + 2 * pad), left = (w - colsWidth) / 2;
  const titleInline = title && !renderOptions?.frame, top = titleInline ? 52 : pad;
  const cardWidth = colWidth - 2 * inset, cardPad = 12, inner = cardWidth - 2 * cardPad;
  const headers = columns.map(c => ctx.wrap(c.label, cardWidth, FONT.title.size, FONT.title.weight));
  const headerHeight = Math.max(...headers.map(lines => lines.length)) * 18 + 22;
  const children = [], errors = [];
  if (titleInline) children.push(ctx.text(left, 32, title, { ...FONT.title, fill: t.fg1 }));
  const frames = columns.map((column, i) => {
    const x = left + i * (colWidth + gap), cardX = x + inset;
    let y = top + headerHeight;
    children.push(...ctx.textLines(cardX, top + 24, headers[i], { ...FONT.title, leading: 18, fill: t.fg1 }).children ?? []);
    column.cards.forEach((card, j) => {
      const lines = ctx.wrap(card.label, inner, FONT.body.size);
      const sizes = [card.ticket, card.assigned].map(text => ctx.measure(text, FONT.label.size));
      const shared = sizes[0] + sizes[1] + 12 <= inner;
      const ticket = card.ticket ? ctx.wrap(card.ticket, inner, FONT.label.size) : [];
      const assigned = card.assigned ? ctx.wrap(card.assigned, inner, FONT.label.size) : [];
      const rows = shared ? Math.max(ticket.length, assigned.length) : ticket.length + assigned.length;
      const h = 22 + lines.length * 17 + (rows ? 5 + rows * 16 : 0);
      const metaY = y + 17 + lines.length * 17 + 5;
      children.push(ctx.rect(cardX, y, cardWidth, h, { rx: t.smallRadius, fill: t.surface, stroke: t.line, meta: { kind: 'node', id: `${i}:${j}` } }));
      const status = priorities.get(card.priority);
      if (status) children.push(ctx.rect(cardX + 1, y + 7, 4, h - 14, { rx: 2, fill: t[status], opacity: card.priority === 'Very Low' ? .4 : 1 }));
      children.push(...ctx.textLines(cardX + cardPad, y + 17, lines, { ...FONT.body, leading: 17, fill: t.fg1 }).children ?? []);
      if (ticket.length) {
        const text = ctx.textLines(cardX + cardPad, metaY, ticket, FONT.label);
        const href = typeof config.ticketBaseUrl === 'string' && config.ticketBaseUrl.replaceAll('#TICKET#', () => encodeURIComponent(card.ticket));
        if (href && /^https?:\/\/[^\s\x00-\x1f]+$/i.test(href) && ctx.link) children.push(ctx.link(href, [text]));
        else {
          children.push(text);
          if (href && !errors.length) errors.push(warning('IGNORED_INTERACTION', ctx.lang, card.line,
            '工单链接未启用', 'Ticket links are unavailable', '使用安全的 HTTP(S) 工单地址', 'Use a safe HTTP(S) ticket URL'));
        }
      }
      children.push(...ctx.textLines(cardX + cardWidth - cardPad, metaY + (shared ? 0 : ticket.length * 16), assigned, { ...FONT.label, anchor: 'end' }).children ?? []);
      y += h + 8;
    });
    return { x, h: y - top + inset - (column.cards.length ? 8 : 0) };
  });
  const h = Math.max(...frames.map(f => f.h));
  children.unshift(...frames.map(({ x }, i) => ctx.rect(x, top, colWidth, h, { rx: 6, stroke: t.grid, fill: 'transparent', meta: { kind: 'frame', id: `column:${i}` } })));
  const height = top + h + pad;
  if (w > width * 2 || count > 60) errors.push(warning('LARGE_DIAGRAM', ctx.lang, info.headerLine || 1,
    '看板较大', 'Large kanban board', '考虑拆分图表', 'Consider splitting the diagram'));
  return { width: w, height, scene: { width: w, height, children, title, heading: title }, errors };
}

const implementations = { kanban: { parse, layout, honoredConfig } };
export { implementations };
