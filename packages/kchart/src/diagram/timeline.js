import { FONT, error, labelText, warning, wrapText } from './support.js';

function parse(body, info) {
  const { lang, firstLine = 2 } = info, errors = [], items = [], sections = [{ name: '', items: [] }];
  const direction = (info.params?.trim() || 'LR').toUpperCase();
  const issue = (line, zh, en) => errors.push(error(lang, line, zh, en, '使用 timeline [LR|TD] 和「时段 : 事件」', 'Use timeline [LR|TD] and “period : event”'));
  if (!['LR', 'TD'].includes(direction)) issue(info.headerLine, '时间线方向必须是 LR 或 TD', 'Timeline direction must be LR or TD');
  const model = { type: 'timeline', title: labelText(info.title), direction, items, sections, firstLine, config: info.config?.timeline || {} };
  if (body.length > 200000) {
    issue(firstLine, '时间线源码超过 200000 字符，请拆分', 'Timeline exceeds 200,000 characters; split the diagram');
    return { model, errors };
  }
  for (const [i, raw] of body.split('\n').entries()) {
    const line = i + firstLine;
    const text = raw.split('%%')[0].trim();
    if (!text || text.startsWith('#') || /^acc(?:Title|Descr)\s*:/i.test(text)) continue;
    const heading = /^(title|section)(?:\s*:\s*|\s+)(.+)$/i.exec(text);
    if (heading) {
      const name = labelText(heading[2]);
      if (heading[1].toLowerCase() === 'title') model.title = name;
      else sections.push({ name, items: [] });
      continue;
    }
    if (/^(?:click|classDef|link|href|style|linkStyle|class|callback)\s/i.test(text)) {
      issue(line, '暂不支持时间线样式或交互语句', 'Timeline presentation statements are not supported yet');
      continue;
    }
    const [period, ...events] = text.split(/\s*:(?=\s|$)/);
    if (period.trim()) {
      const item = { id: `period:${items.length}`, label: labelText(period.trim()), events: [], line };
      item.index = items.length;
      items.push(item); sections.at(-1).items.push(item);
    }
    if (!items.length) issue(line, '事件前必须先声明时段', 'Declare a period before its events');
    else items.at(-1).events.push(...events.map(event => labelText(event.trim())).filter(Boolean));
  }
  if (!items.length) issue(firstLine, '缺少时段', 'Expected a timeline period');
  const count = items.reduce((n, item) => n + 1 + item.events.length, 0);
  if (count > 2000) issue(firstLine, `时间线有 ${count} 个条目，超过 2000，请拆分`, `Timeline has ${count} entries (limit 2,000); split the diagram`);
  model.count = count;
  return { model, errors };
}

function layout(model, { width, ctx, measure, renderOptions }) {
  const { design: d } = ctx, { items, config, sections } = model;
  const vertical = model.direction === 'TD';
  const finite = (value, fallback, floor) => Number.isFinite(Number(value)) ? Math.max(floor, Number(value)) : fallback;
  const left = finite(config.leftMargin, 24, 24), pad = finite(config.padding, 12, 12);
  const body = { ...FONT.body, size: finite(config.taskFontSize, 13, 12) }, period = { ...body, weight: 600 };
  const lh = body.size + 5;
  const occupied = sections.reduce((n, s) => n + (s.name || s.items.length ? Math.max(1, s.items.length) : 0), 0);
  const col = vertical ? Math.max(184, pad * 2 + 100) : Math.max(184, pad * 2 + 100, (width - left - 24) / occupied);
  const eventW = vertical ? Math.max(204, width - left - col - 76, pad * 2 + 100) : col - 2 * pad - 14;
  const w = vertical ? left + col + eventW + 76 : left + col * occupied + 24;
  const children = [], scene = { width: w, height: 0, title: model.title, children, ...(renderOptions?.frame ? { heading: model.title || undefined } : {}) };
  const add = (tag, attrs, meta) => children.push({ ...ctx.el(tag, attrs), ...(meta ? { meta } : {}) });
  const text = (value, x, y, font, fill, anchor = 'start') => children.push(ctx.text(x, y, value, { ...font, fill, anchor, 'dominant-baseline': 'central' }));
  const wrap = (value, max, font) => wrapText(value, max, font, measure);
  const lines = (values, x, y, font, fill, anchor, pitch = lh) => values.forEach((value, i) => text(value, x, y + i * pitch, font, fill, anchor));
  const line = (x1, y1, x2, y2, stroke, dash) => add('line', { x1, y1, x2, y2, stroke, 'stroke-width': 2, ...(dash ? { 'stroke-dasharray': '4 4' } : {}) });
  const card = (x, y, width, height, fill, stroke, meta) => add('rect', { x, y, width, height, fill, stroke, rx: 6 }, meta);
  const tone = index => ctx.color(`tone${config.disableMulticolor ? 1 : 1 + index % 6}`);
  const title = !renderOptions?.frame && model.title ? wrap(model.title, w - 48, FONT.title) : [];
  lines(title, 24, 24, FONT.title, d.fg1, 'start', 20);
  const top = title.length ? 24 + title.length * 20 : 24;
  const groups = sections.filter(group => group.name || group.items.length).map((group, index) => ({
    ...group, index, width: vertical ? w - left - 24 : Math.max(col, col * group.items.length),
  }));
  const sectionLines = group => wrap(group.name, group.width - 2 * pad, FONT.body);
  const draws = items.map(item => ({
    label: wrap(item.label, col - 2 * pad - 12, period),
    events: item.events.map(event => wrap(event, eventW - (vertical ? 2 * pad : 0), body)),
  }));
  const prepared = new Map(items.map((item, i) => [item, draws[i]]));
  if (vertical) {
    const axis = left + col + 12, axisEnd = children.length, backgrounds = [];
    let y = top;
    for (const group of groups) {
      const start = y, color = tone(group.index);
      const names = group.name ? sectionLines(group) : [];
      if (names.length) { lines(names, left + pad, y + 14, FONT.body, d.fg1); y += names.length * lh + 12; }
      for (const item of group.items) {
        const { label, events } = prepared.get(item), cardH = label.length * lh + 2 * pad;
        const eventH = events.reduce((n, e) => n + e.length * lh + 2 * pad + 8, 0);
        const center = y + cardH / 2;
        const ink = group.name ? color : tone(item.index);
        line(axis - 22, center, axis, center, ink, true);
        add('circle', { cx: axis, cy: center, r: 5, fill: ink });
        card(left, y, col - 10, cardH, d.bg, ink, { kind: 'node', id: item.id });
        lines(label, left + pad, y + pad + lh / 2, period, d.fg1);
        let ey = y;
        for (const [i, event] of events.entries()) {
          const h = event.length * lh + 2 * pad;
          line(axis + 5, ey + h / 2, axis + 24, ey + h / 2, ink, true);
          card(axis + 24, ey, eventW, h, d.bg, ctx.color('grid'), { kind: 'node', id: `${item.id}:event:${i}` });
          lines(event, axis + 24 + pad, ey + pad + lh / 2, body, d.fg1);
          ey += h + 8;
        }
        y += Math.max(cardH, eventH) + 12;
      }
      if (names.length) {
        card(left - 8, start, group.width + 8, y - start, ctx.tint(d.bg, color, .08), 'none', { kind: 'frame', id: `section:${group.index}` });
        backgrounds.push(children.pop());
      }
      y += 12;
    }
    line(axis, top, axis, y - 20, ctx.color('grid'));
    // Keep the axis above section backgrounds but behind the foreground cards and markers.
    const axisLine = children.pop();
    children.splice(axisEnd, 0, ...backgrounds, axisLine);
    scene.height = y + 8;
  } else {
    const headingH = Math.max(0, ...groups.map(group => group.name ? sectionLines(group).length * lh + 14 : 0));
    const axisY = top + headingH + 8, y = axisY + 18;
    const labelH = Math.max(...draws.map(row => row.label.length)) * lh + 2 * pad;
    const eventH = Math.max(0, ...draws.map(row => row.events.reduce((n, event) => n + lh * event.length + 8, 0)));
    scene.height = y + labelH + eventH + 32;
    let x = left;
    for (const group of groups) {
      const color = tone(group.index);
      if (group.name) {
        card(x, top - 8, group.width - 5, scene.height - top - 6, ctx.tint(d.bg, color, .08), 'none', { kind: 'frame', id: `section:${group.index}` });
        lines(sectionLines(group), x + pad, top + 6, FONT.body, d.fg1);
      }
      x += group.width;
    }
    line(left, axisY, w - 24, axisY, ctx.color('grid'));
    x = left;
    for (const group of groups) {
      if (!group.items.length) { x += col; continue; }
      for (const item of group.items) {
        const { label, events } = prepared.get(item), color = tone(group.name ? group.index : item.index);
        const center = x + col / 2;
        add('circle', { cx: center, cy: axisY, r: 5, fill: color });
        card(x + 6, y, col - 16, labelH, d.bg, color, { kind: 'node', id: item.id });
        lines(label, center - 2, y + pad + lh / 2, period, d.fg1, 'middle');
        let ey = y + labelH + 15;
        for (const event of events) {
          add('circle', { cx: x + pad + 2, cy: ey, r: 2.5, fill: color });
          lines(event, x + pad + 14, ey, body, d.fg2);
          ey += event.length * lh + 8;
        }
        x += col;
      }
    }
  }
  const errors = scene.width > 2 * width || model.count > 60 ? [warning('LARGE_DIAGRAM', ctx.lang, model.firstLine,
    '时间线较大，可滚动查看', 'Large timeline; scroll to view', '可拆成多张时间线', 'Consider splitting the timeline')] : [];
  return { width: scene.width, height: scene.height, scene, errors };
}

const implementations = { timeline: { optionMode: 'raw', parse, layout, honoredConfig: ['timeline.leftMargin', 'timeline.taskFontSize', 'timeline.padding', 'timeline.disableMulticolor'] } };
export { implementations };
