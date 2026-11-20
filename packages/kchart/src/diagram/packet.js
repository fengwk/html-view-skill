import { normalizeLabel } from './label.js';
import { presentation } from './presentation.js';
import { FONT, appearance, error, textBlock, warning } from './support.js';

const honoredConfig = ['bitsPerRow', 'bitOrder', 'showBits', 'bitWidth', 'rowHeight', 'paddingX', 'paddingY'].map(key => `packet.${key}`);
function parse(body, { lang, firstLine = 2, title = '', config, options = {} }) {
  const fields = [], errors = [], assets = new Set(), look = presentation({ lang });
  const clean = (value, line) => {
    const { text, icon, diagnostics } = normalizeLabel(value, { lang, line });
    if (icon) diagnostics.push(warning('IGNORED_ASSET', lang, line, '位域仅显示文本', 'Packet fields display text only'));
    for (const d of diagnostics) if (!assets.has(d.message)) { assets.add(d.message); errors.push(d); }
    return text;
  };
  const fail = (line, zh, en) => errors.push(error(lang, line, zh, en, '修正连续位域，或拆分图表', 'Fix the contiguous bit fields, or split the diagram'));
  if (Object.keys(options).length) fail(firstLine - 1, 'packet 不接受标题行选项', 'Unexpected packet header option');
  let next = 0;
  for (const [i, raw] of body.split('\n').entries()) {
    const line = firstLine + i, s = raw.trim();
    if (!s || s.startsWith('%%') || look.accept(s, line)) continue;
    const heading = /^title(?:\s*:\s*|\s+)(.+)/i.exec(s);
    if (heading) { title = clean(heading[1], line); continue; }
    const m = /^(?:(\d+)(?:\s*-\s*(\d+))?|\+(\d+))\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*(?:::\:([\w-]+))?\s*(?:%%.*)?$/.exec(s);
    if (!m) { fail(line, '需要位范围及带引号的名称', 'Expected a bit range and a quoted field name'); continue; }
    const start = m[3] === undefined ? Number(m[1]) : next;
    const end = m[3] === undefined ? Number(m[2] ?? m[1]) : next + Number(m[3]) - 1;
    if (start !== next) { fail(line, `位域应从第 ${next} 位开始`, `Field must start at bit ${next}`); continue; }
    if (end < start) { fail(line, '位域长度必须为正', 'Field must have positive width'); continue; }
    if (end >= 4096 || fields.length >= 2000) { fail(line, '位域超过 4096 位或 2000 个字段', 'Packet exceeds 4096 bits or 2000 fields'); break; }
    const id = m[4].slice(1, -1).replace(/\\(.)/g, '$1');
    if (m[5]) look.addClasses(id, [m[5]], line);
    fields.push({ start, end, id, label: clean(id, line) });
    next = end + 1;
  }
  if (!fields.length) fail(firstLine, '缺少位域', 'Expected at least one field');
  for (const f of fields) { f.status = look.statusOf(f.id); f.link = look.linkOf(f.id); }
  errors.push(...look.diagnostics());
  return { model: { type: 'packet', title, fields, config: config?.packet || {} }, errors };
}

function layout(model, { width, ctx, renderOptions }, info = {}) {
  const { title, fields, config } = model, t = appearance(ctx);
  const perRow = Number.isInteger(config.bitsPerRow) && config.bitsPerRow >= 1 && config.bitsPerRow <= 128 ? config.bitsPerRow : 32;
  const showBits = config.showBits !== false, descending = config.bitOrder === 'descending';
  const rows = [];
  fields.forEach((field, id) => {
    for (let start = field.start; start <= field.end;) {
      const row = Math.floor(start / perRow), end = Math.min(field.end, (row + 1) * perRow - 1);
      (rows[row] ??= []).push({ ...field, start, end, id, bits: end - start + 1 });
      start = end + 1;
    }
  });
  const dimension = (key, fallback, min, max) => Number.isFinite(config[key]) ? Math.min(max, Math.max(min, config[key])) : fallback;
  const gap = dimension('paddingX', 0, 0, 24), rowGap = dimension('paddingY', 12, 6, 60);
  const minimumRow = dimension('rowHeight', 34, 26, 240);
  const pad = 18, range = f => f.start === f.end ? String(f.start) : `${f.start}–${f.end}`;
  // Each cell reserves room for its longest word and its bit range, then wraps between words. A row that needs
  // no more than the frame shares it in whole pixels, so the scene never exceeds the requested width.
  const needed = Math.ceil(rows.flat().reduce((min, f) => Math.max(min,
    ...f.label.split(/\s+/).map(word => (ctx.measure(word, FONT.body.size) + 10 + gap) / f.bits),
    showBits ? (ctx.measure(range(f), FONT.label.size) + 6) / f.bits : 0), 12));
  const pitch = Math.max(needed, Math.floor((width - pad * 2) / perRow), dimension('bitWidth', 12, 12, 96));
  const w = Math.max(width, perRow * pitch + 2 * pad), left = (w - perRow * pitch) / 2;
  const children = [];
  let y = pad;
  if (title && !renderOptions?.frame) {
    children.push(ctx.text(w / 2, y + 8, title, { ...FONT.title, anchor: 'middle', fill: t.fg1, 'dominant-baseline': 'central' }));
    y += 30;
  }
  for (const row of rows) {
    const cells = row.map(f => ({ ...f, lines: ctx.wrap(f.label, f.bits * pitch - gap - 8, FONT.body.size) }));
    const h = Math.max(minimumRow, ...cells.map(f => f.lines.length * 17 + 14));
    for (const f of cells) {
      const x = left + (descending ? perRow - f.start % perRow - f.bits : f.start % perRow) * pitch;
      const cellWidth = f.bits * pitch - gap, cx = x + cellWidth / 2;
      const stroke = t[f.status] || t.line;
      const cell = [ctx.rect(x, y, cellWidth, h, { fill: f.status ? ctx.tint(t.bg, stroke, .1) : f.id % 2 ? t.surface : t.bg, stroke, meta: { kind: 'node', id: `${f.id}:${f.start}` } }),
        textBlock(ctx, { x: cx, y: y + h / 2, lines: f.lines, lineHeight: 17 })];
      children.push(...(f.link ? [ctx.link(f.link.href, cell, f.link)] : cell));
      if (showBits) children.push(ctx.text(cx, y + h + 12, range(f), { ...FONT.label, anchor: 'middle', 'dominant-baseline': 'central' }));
    }
    y += h + rowGap + (showBits ? 16 : 0);
  }
  const height = y + 6;
  const errors = w > width * 2 || fields.length > 60 ? [warning('LARGE_DIAGRAM', ctx.lang, info.headerLine || 1,
    '封包图较大', 'Large packet diagram', '考虑拆分图表', 'Consider splitting the diagram')] : [];
  return { width: w, height, scene: { width: w, height, children, title, heading: title }, errors };
}

const implementations = { packet: { parse, layout, honoredConfig, acceptsPresentation: true } };
export { implementations };
