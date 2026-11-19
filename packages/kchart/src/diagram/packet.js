import { FONT, appearance, error, labelText, textBlock, warning } from './support.js';

const honoredConfig = ['packet.bitsPerRow', 'packet.bitOrder', 'packet.showBits'];
function parse(body, { lang, firstLine = 2, title = '', config, options = {} }) {
  const fields = [], errors = [];
  const fail = (line, zh, en) => errors.push(error(lang, line, zh, en, '修正连续位域，或拆分图表', 'Fix the contiguous bit fields, or split the diagram'));
  if (Object.keys(options).length) fail(firstLine - 1, 'packet 不接受标题行选项', 'Unexpected packet header option');
  let next = 0;
  for (const [i, raw] of body.split('\n').entries()) {
    const line = firstLine + i, s = raw.trim();
    if (!s || s.startsWith('%%')) continue;
    const heading = /^title(?:\s*:\s*|\s+)(.+)/i.exec(s);
    if (heading) { title = labelText(heading[1]); continue; }
    const m = /^(?:(\d+)(?:\s*-\s*(\d+))?|\+(\d+))\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*(?:%%.*)?$/.exec(s);
    if (!m) { fail(line, '需要位范围及带引号的名称', 'Expected a bit range and a quoted field name'); continue; }
    const start = m[3] === undefined ? Number(m[1]) : next;
    const end = m[3] === undefined ? Number(m[2] ?? m[1]) : next + Number(m[3]) - 1;
    if (start !== next) { fail(line, `位域应从第 ${next} 位开始`, `Field must start at bit ${next}`); continue; }
    if (end < start) { fail(line, '位域长度必须为正', 'Field must have positive width'); continue; }
    if (end >= 4096 || fields.length >= 2000) { fail(line, '位域超过 4096 位或 2000 个字段', 'Packet exceeds 4096 bits or 2000 fields'); break; }
    fields.push({ start, end, label: labelText(m[4].slice(1, -1).replace(/\\(.)/g, '$1')) });
    next = end + 1;
  }
  if (!fields.length && !errors.length) fail(firstLine, '缺少位域', 'Expected at least one field');
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
      (rows[row] ??= []).push({ start, end, id, label: field.label, bits: end - start + 1 });
      start = end + 1;
    }
  });
  const pad = 18, widestBit = ctx.measure(String(fields.at(-1).end), FONT.label.size);
  // Reserve space for unbroken words, then wrap between words inside each cell.
  const pitch = Math.ceil(rows.flat().reduce((min, f) => Math.max(min,
    ...f.label.split(/\s+/).map(word => (ctx.measure(word, FONT.body.size) + 12) / f.bits),
    showBits ? widestBit + 6 : 12), (width - pad * 2) / perRow));
  const w = Math.max(width, perRow * pitch + 2 * pad), left = (w - perRow * pitch) / 2;
  const children = [];
  let y = pad;
  if (title && !renderOptions?.frame) {
    children.push(ctx.text(w / 2, y + 8, title, { ...FONT.title, anchor: 'middle', fill: t.fg1, 'dominant-baseline': 'central' }));
    y += 30;
  }
  for (const row of rows) {
    const cells = row.map(f => ({ ...f, lines: ctx.wrap(f.label, f.bits * pitch - 10, FONT.body.size) }));
    const h = Math.max(34, ...cells.map(f => f.lines.length * 17 + 14));
    for (const f of cells) {
      const x = left + (descending ? perRow - f.start % perRow - f.bits : f.start % perRow) * pitch;
      const cellWidth = f.bits * pitch, cx = x + cellWidth / 2;
      children.push(ctx.rect(x, y, cellWidth, h, { fill: f.id % 2 ? t.surface : t.bg, stroke: t.grid, meta: { kind: 'node', id: `${f.id}:${f.start}` } }));
      children.push(textBlock(ctx, { x: cx, y: y + h / 2, lines: f.lines, lineHeight: 17 }));
      if (showBits) children.push(ctx.text(cx, y + h + 12, f.start === f.end ? f.start : `${f.start}–${f.end}`, { ...FONT.label, anchor: 'middle', 'dominant-baseline': 'central' }));
    }
    y += h + (showBits ? 28 : 12);
  }
  const height = y + 6;
  const errors = w > width * 2 || fields.length > 60 ? [warning('LARGE_DIAGRAM', ctx.lang, info.headerLine || 1,
    '封包图较大', 'Large packet diagram', '考虑拆分图表', 'Consider splitting the diagram')] : [];
  return { width: w, height, scene: { width: w, height, children, title, heading: title }, errors };
}

const implementations = { packet: { parse, layout, honoredConfig } };
export { implementations };
