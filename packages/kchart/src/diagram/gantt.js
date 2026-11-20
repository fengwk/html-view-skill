import { FONT, blocking, error, isEn, labelText, maxWidthOf, warning, wrapText } from './support.js';
import { DAY, weekdays, compileDate, compileAxis, dateTokens, axisTokens, durationPattern, add, excludedBy, shiftEnd, intervalPattern, ticks } from './gantt-date.js';

const flags = { done: ['已完成', 'done'], active: ['进行中', 'in progress'], crit: ['关键', 'critical'], milestone: ['里程碑', 'milestone'], vert: ['竖线', 'vertical marker'] };
const dependency = /^(after|until)\s+(.+)$/i;
const iso = compileDate('YYYY-MM-DD');
const timeLimit = 8640000000000000;
const valid = stamp => Number.isFinite(stamp) && Math.abs(stamp) <= timeLimit;

function parse(body, info) {
  const { lang, firstLine = 2 } = info, errors = [], items = [], sections = [{ name: '', items: [] }];
  const config = info.config?.gantt || {}, configLines = info.configLines || {};
  const model = { type: 'gantt', title: labelText(info.title), items, sections, firstLine, compact: config.displayMode === 'compact' };
  const directives = new Map(), excludes = new Set(), includes = new Set();
  const issue = (line, zh, en, fixZh = '修正甘特图语句', fixEn = 'Correct the Gantt statement') => errors.push(error(lang, line, zh, en, fixZh, fixEn));
  const notice = (line, zh, en) => errors.push(warning('DIAGRAM_HINT', lang, line, zh, en));
  if (info.params || Object.keys(info.options || {}).length) issue(info.headerLine, 'gantt 标题行不接受选项', 'The gantt header takes no options');
  if (body.length > 200000) {
    issue(firstLine, '甘特图源码超过 200000 字符，请拆分', 'Gantt source exceeds 200,000 characters; split the diagram');
    return { model, errors };
  }
  let autoId = 0;
  for (const [i, raw] of body.split('\n').entries()) {
    const line = firstLine + i;
    // In an axis format %% is a literal percent, not a comment.
    const text = (/^\s*axisFormat\s/i.test(raw) ? raw : raw.split('%%')[0]).trim();
    if (!text || /^acc(?:Title|Descr)\s*:/i.test(text)) continue;
    const statement = /^(dateFormat|axisFormat|tickInterval|weekday|weekend|todayMarker|includes|excludes|title|section)(?:\s+(.*)|$)/i.exec(text);
    if (statement) {
      const key = statement[1].toLowerCase(), value = statement[2] || '';
      if (key === 'title') model.title = labelText(value);
      else if (key === 'section') sections.push({ name: labelText(value), items: [] });
      else if (key === 'includes' || key === 'excludes') {
        for (const token of value.toLowerCase().split(/[ ,\t]+/).filter(Boolean)) (key === 'includes' ? includes : excludes).add(token);
      } else directives.set(key, { line, value });
      continue;
    }
    if (/^(topAxis|inclusiveEndDates)$/i.test(text)) { directives.set(text.toLowerCase(), { line, value: true }); continue; }
    const task = /^([^:]*):(.*)$/.exec(text);
    if (!task || /^(?:click|classDef|link|href|style|linkStyle|class|callback)\s/i.test(text)) {
      issue(line, `无法识别甘特图语句：${text.slice(0, 50)}`, `Unrecognized Gantt statement: ${text.slice(0, 50)}`);
      continue;
    }
    const fields = task[2].trim().split(',').map(x => x.trim()), tags = [];
    while (Object.hasOwn(flags, fields[0]?.toLowerCase())) tags.push(fields.shift().toLowerCase());
    if (fields.length > 3 || fields.some(x => !x) || !fields.length) {
      issue(line, '任务需要结束值，可在前面加起点和 ID', 'Expected end, start/end, or ID/start/end'); continue;
    }
    const id = fields.length === 3 ? fields.shift() : `task${++autoId}`;
    const record = { id, name: labelText(task[1].trim()), startField: fields.length === 2 ? fields[0] : null, endField: fields.at(-1), flags: tags, line };
    sections.at(-1).items.push(record); items.push(record);
  }
  if (items.length > 2000) issue(firstLine, `甘特图有 ${items.length} 个任务，超过 2000，请拆分`, `Gantt has ${items.length} tasks (limit 2,000); split the diagram`);
  const option = (key, fallback) => directives.get(key.toLowerCase()) ?? { value: config[key] ?? fallback, line: configLines[`gantt.${key.toLowerCase()}`] ?? firstLine };
  const dateSpec = option('dateFormat', 'YYYY-MM-DD'), axisSpec = option('axisFormat', dateSpec.value === 'D' ? '%d' : '%Y-%m-%d');
  let date, axis;
  try { date = compileDate(String(dateSpec.value)); }
  catch (e) { issue(dateSpec.line, `不支持的 dateFormat 标记：${e.message}`, `Unsupported dateFormat token: ${e.message}`, `支持：${dateTokens.join(' ')}`, `Supported: ${dateTokens.join(' ')}`); }
  try { axis = compileAxis(String(axisSpec.value)); }
  catch (e) { issue(axisSpec.line, `不支持的 axisFormat 标记：${e.message}`, `Unsupported axisFormat token: ${e.message}`, `支持：${axisTokens.map(t => '%' + t).join(' ')}`, `Supported: ${axisTokens.map(t => '%' + t).join(' ')}`); }
  const weekdaySpec = option('weekday', 'sunday'), weekStart = weekdays.findIndex(day => day.toLowerCase() === String(weekdaySpec.value).toLowerCase());
  if (weekStart < 0) issue(weekdaySpec.line, 'weekday 需要英文星期名', 'weekday requires an English weekday name');
  const weekendSpec = option('weekend', 'saturday'), weekend = ['friday', 'saturday'].indexOf(String(weekendSpec.value).toLowerCase()) + 5;
  if (weekend < 5) issue(weekendSpec.line, 'weekend 必须是 friday 或 saturday', 'weekend must be friday or saturday');
  const intervalSpec = option('tickInterval', ''), interval = intervalPattern.exec(intervalSpec.value);
  if (intervalSpec.value && (!interval || !Number.isSafeInteger(+interval[1]))) notice(intervalSpec.line, '无效的 tickInterval，使用自动刻度', 'Invalid tickInterval; using automatic ticks');
  const fixed = config.todayDate != null ? iso.parse(String(config.todayDate)) : NaN;
  if (config.todayDate != null && !valid(fixed)) issue(configLines['gantt.todaydate'] ?? firstLine, 'todayDate 必须是 YYYY-MM-DD 日期', 'todayDate must be a YYYY-MM-DD date');
  const today = String(option('todayMarker', '').value).toLowerCase() === 'off' ? NaN : fixed;
  Object.assign(model, { axis, interval: interval && Number.isSafeInteger(+interval[1]) ? interval : null, intervalLine: intervalSpec.line,
    weekStart, monthLabels: axisSpec.value === '%Y-%m', topAxis: option('topAxis', false).value, today });
  if (errors.some(blocking)) return { model, errors };

  model.excluded = excludes.size ? excludedBy({ includes, excludes, weekend }, date.format) : null;
  const ids = new Map(), unresolved = new Set();
  for (const task of items) {
    if (ids.has(task.id)) issue(task.line, `重复的任务 ID：${task.id}`, `Duplicate task ID: ${task.id}`);
    ids.set(task.id, task);
  }
  const prior = new Map(items.map((task, i) => [task, items[i - 1]]));
  const visiting = new Set(), done = new Set(), failed = new Set();
  const parseDay = (value, task) => {
    const stamp = date.parse(value);
    if (!valid(stamp)) issue(task.line, `日期「${value}」不符合 ${dateSpec.value}`, `Date “${value}” does not match ${dateSpec.value}`);
    return stamp;
  };
  const baseline = valid(fixed) ? fixed : 0;
  const inclusive = option('inclusiveEndDates', false).value;
  function resolve(task) {
    if (done.has(task)) return !failed.has(task);
    if (visiting.has(task)) {
      const path = [...visiting].slice([...visiting].indexOf(task)).map(x => x.id).concat(task.id).join(' → ');
      issue(task.line, `任务依赖循环：${path}`, `Task dependency cycle: ${path}`);
      return false;
    }
    visiting.add(task);
    const relative = (match, useEnd) => {
      const values = [], unknown = [];
      for (const id of match[2].trim().split(/\s+/)) {
        const dep = ids.get(id);
        if (!dep) { if (!unresolved.has(id)) unknown.push(id); unresolved.add(id); continue; }
        if (!resolve(dep)) return NaN;
        values.push(useEnd ? dep.endTime : dep.startTime);
      }
      if (unknown.length) notice(task.line, `找不到任务：${unknown.join(', ')}；使用可解析的任务或固定基准日`, `Unknown task IDs: ${unknown.join(', ')}; using resolved tasks or the fixed baseline`);
      return values.length ? (useEnd ? Math.max(...values) : Math.min(...values)) : baseline;
    };
    const startDependency = /^after\s/i.test(task.startField || '') && dependency.exec(task.startField);
    const previous = prior.get(task);
    task.startTime = startDependency ? relative(startDependency, true) : task.startField ? parseDay(task.startField, task) :
      previous ? resolve(previous) ? previous.endTime : NaN : baseline;
    const endDependency = /^until\s/i.test(task.endField) && dependency.exec(task.endField);
    const duration = durationPattern.exec(task.endField);
    if (valid(task.startTime)) {
      let end = endDependency ? relative(endDependency, false) : duration ? add(task.startTime, +duration[1], duration[2]) : parseDay(task.endField, task);
      if (!duration && !endDependency && inclusive && valid(end)) end += DAY;
      if (duration && model.excluded && valid(end)) end = shiftEnd(task.startTime, end, model.excluded);
      if (end < task.startTime || (!valid(end) && (duration || Number.isFinite(end)))) issue(task.line, '任务结束日期无效或早于起点', 'Task end is invalid or before its start');
      else if (valid(end)) {
        task.endTime = end;
        task.start = iso.format(task.startTime); task.end = iso.format(end);
      }
    }
    visiting.delete(task); done.add(task);
    if (!valid(task.endTime)) failed.add(task);
    return !failed.has(task);
  }
  if (!errors.some(blocking)) items.forEach(resolve);
  return { model, errors };
}

function layout(model, { width, ctx, measure, renderOptions }) {
  const { design: d, lang } = ctx, { items, sections, today } = model;
  const errors = [], children = [], title = model.title, naked = !renderOptions?.frame && title;
  const body = FONT.body, small = FONT.label, bold = { ...body, weight: 600 };
  const texts = value => value.split('\n');
  const states = item => item.flags.map(flag => flags[flag][isEn(lang) ? 1 : 0]).join(' · ');
  const labelW = Math.max(120, ...items.flatMap(item => [maxWidthOf(texts(item.name), body, measure), measure(states(item), small)]),
    ...sections.map(s => maxWidthOf(texts(s.name), bold, measure)));
  const addShape = (tag, attrs, meta, kids) => children.push({ ...ctx.el(tag, attrs, kids), ...(meta ? { meta } : {}) });
  const text = (value, x, y, font = body, fill = d.fg1, anchor = 'start') => children.push(ctx.text(x, y, value, { ...font, fill, anchor, 'dominant-baseline': 'central' }));
  const line = (x, y1, y2, stroke, dash) => addShape('line', { x1: x, x2: x, y1, y2, stroke, ...(dash ? { 'stroke-width': 2, 'stroke-dasharray': '4 4' } : {}) });
  const left = labelW + 52, min = items.length ? Math.min(...items.map(item => item.startTime)) : 0;
  const end = items.length ? Math.max(...items.map(item => item.endTime)) : min;
  const max = Math.max(end, min + 1);
  const interval = model.interval ?? (model.monthLabels && end - min >= 31 * DAY && end - min <= 270 * DAY ? intervalPattern.exec('1month') : null);
  const tickResult = items.length ? ticks(min, end, model.weekStart, interval) : { values: [] };
  if (tickResult.dropped) errors.push(warning('DIAGRAM_HINT', lang, model.intervalLine, '刻度超过 10000 个，改用自动刻度', 'More than 10,000 ticks; using automatic ticks'));
  const tickList = [];
  const seen = new Set(), intervalStep = Math.max(1, Math.ceil(tickResult.values.length / 10));
  tickResult.values.forEach((stamp, i) => {
    if (i % intervalStep) return;
    const label = model.axis(stamp);
    if (!seen.has(label)) { seen.add(label); tickList.push({ stamp, label, w: measure(label, small) }); }
  });
  let plot = Math.max(228, width - left - 60);
  const ratio = stamp => (stamp - min) / (max - min);
  // Prefer widening before suppressing tightly clustered labels from a custom interval.
  for (let i = 1; i < tickList.length; i++) {
    const a = tickList[i - 1], b = tickList[i];
    plot = Math.max(plot, Math.min(1800, ((a.w + b.w) / 2 + 16) / (ratio(b.stamp) - ratio(a.stamp))));
  }
  const x = stamp => left + ratio(stamp) * plot;
  const range = (w, stamp) => ({ x: x(stamp), left: x(stamp) - w / 2, right: x(stamp) + w / 2 });
  const right = Math.max(30, ...tickList.map(t => t.w / 2 + 14));
  const w = Math.max(width, Math.ceil(left + plot + right));
  const titleLines = naked ? wrapText(title, w - 48, FONT.title, measure) : [];
  titleLines.forEach((value, i) => text(value, 24, 24 + i * 20, FONT.title));
  let y = titleLines.length ? 24 + titleLines.length * 20 : 24;
  if (model.topAxis) y += 22;
  const markers = items.filter(item => item.flags.includes('vert'));
  const markBounds = item => item.flags.includes('milestone') ?
    [(x(item.startTime) + x(item.endTime)) / 2 - 9, (x(item.startTime) + x(item.endTime)) / 2 + 9] :
    [x(item.startTime), Math.max(x(item.startTime) + 4, x(item.endTime))];
  const showToday = valid(today) && items.length && today >= min && today <= end;
  const markerY = y, markerInfo = [];
  for (const marker of [...markers, ...(showToday ? [{ startTime: today, name: isEn(lang) ? 'Today' : '今天', today: true }] : [])]) {
    const stamp = marker.today ? today : marker.startTime + (marker.endTime - marker.startTime) / 2;
    const content = marker.today ? [marker.name] : [...texts(marker.name), model.axis(stamp)];
    const tw = maxWidthOf(content, small, measure), pitch = 17;
    const center = Math.max(14 + tw / 2, Math.min(w - 14 - tw / 2, x(stamp)));
    markerInfo.push({ marker, stamp, y, center, content });
    y += content.length * pitch + 8;
  }
  const top = y;
  const bands = [], bars = [];
  for (const section of sections) {
    if (!section.name && !section.items.length) continue;
    const top = y, names = section.name ? texts(section.name) : [];
    if (names.length) y += 14 + 18 * names.length;
    const rows = [];
    // Allow room for the minimum-width bars and diamonds, not just the date extents.
    for (const item of section.items.filter(item => !item.flags.includes('vert'))) {
      const [left, right] = markBounds(item);
      let row = model.compact && rows.find(row => row.every(other => {
        const [a, b] = markBounds(other);
        return (item.endTime <= other.startTime && right + 4 <= a) || (item.startTime >= other.endTime && left >= b + 4);
      }));
      if (!row) { row = []; rows.push(row); }
      row.push(item);
    }
    for (const row of rows) {
      const labels = row.flatMap(item => [...texts(item.name), ...(states(item) ? [states(item)] : [])]);
      const rowH = Math.max(48, labels.length * 18 + 20);
      bars.push({ row, y: y + rowH / 2, labels }); y += rowH;
    }
    if (names.length) bands.push({ names, top, bottom: y });
  }
  const bottom = Math.max(y, top + 72), height = bottom + 46;
  bands.forEach(({ top, bottom }, i) => addShape('rect', { x: 8, y: top, width: w - 16, height: bottom - top, rx: 4,
    fill: ctx.tint(d.bg, ctx.color(`tone${1 + i % 6}`), .07) }, { kind: 'frame', id: `section:${i}` }));
  if (model.excluded && end - min <= 5 * 366 * DAY) {
    let blocked;
    for (let stamp = Math.floor(min / DAY) * DAY; stamp <= end + DAY; stamp += DAY) {
      if (stamp < end && model.excluded(stamp)) { blocked ??= Math.max(min, stamp); continue; }
      if (blocked != null) {
        const finish = Math.min(end, stamp);
        addShape('rect', { x: x(blocked), y: top, width: x(finish) - x(blocked), height: bottom - top, fill: ctx.tint(d.bg, d.fg4, .08) });
        blocked = undefined;
      }
    }
  } else if (model.excluded) errors.push(warning('DIAGRAM_HINT', lang, model.firstLine, '超过五年，不绘制排除日背景', 'Excluded-day shading omitted for ranges over five years'));
  let last = -Infinity;
  for (const tick of tickList) {
    const pos = range(tick.w, tick.stamp);
    if (pos.left < last + 12) continue;
    line(pos.x, top, bottom, ctx.color('grid'));
    text(tick.label, pos.x, bottom + 20, small, d.fg2, 'middle');
    if (model.topAxis) text(tick.label, pos.x, markerY - 14, small, d.fg2, 'middle');
    last = pos.right;
  }
  for (const { marker, stamp, y, center, content } of markerInfo) {
    const color = marker.today ? d.warn : ctx.color('accent');
    content.forEach((value, i) => text(value, center, y + 8 + i * 17, small, d.fg1, 'middle'));
    line(x(stamp), top, bottom, color, true);
  }
  bands.forEach(({ names, top }) => names.forEach((value, i) => text(value, 12, top + 15 + i * 18, bold, d.fg2)));
  for (const { row, y, labels } of bars) {
    let index = 0;
    for (const task of row) {
      const names = texts(task.name), labelY = y - (labels.length - 1) * 9 + index * 18, state = states(task);
      names.forEach((name, i) => text(name, 12, labelY + i * 18));
      if (state) text(state, 12, labelY + names.length * 18, small, d.fg2);
      index += names.length + Number(Boolean(state));
      const x1 = x(task.startTime), x2 = x(task.endTime), meta = { kind: 'node', id: task.id };
      const barY = row.length === 1 ? labelY : y;
      const fill = task.flags.includes('crit') ? ctx.color('accent') : task.flags.includes('done') ? ctx.tint(d.bg, ctx.color('tone2'), .55) : ctx.color('tone1');
      if (task.flags.includes('milestone')) {
        const mid = (x1 + x2) / 2;
        addShape('polygon', { points: `${mid},${barY - 9} ${mid + 9},${barY} ${mid},${barY + 9} ${mid - 9},${barY}`, fill }, meta);
      } else {
        const barW = Math.max(4, x2 - x1);
        addShape('rect', { x: x1, y: barY - 11, width: barW, height: 22, fill: task.flags.includes('active') ? ctx.tint(d.bg, fill, .25) : fill, rx: 4 }, meta);
        if (task.flags.includes('active')) addShape('rect', { x: x1, y: barY - 11, width: barW * .55, height: 22, fill, rx: 4 });
      }
    }
  }
  if (items.length === 0) text(isEn(lang) ? 'No scheduled tasks' : '暂无排期任务', w / 2, top + 36, body, d.fg2, 'middle');
  if (w > 2 * width || items.length > 60) errors.push(warning('LARGE_DIAGRAM', lang, model.firstLine, '甘特图较大，可滚动查看', 'Large Gantt chart; scroll to view', '可拆成多张图', 'Consider splitting the chart'));
  const scene = { width: w, height, title, children, ...(renderOptions?.frame ? { heading: title || undefined } : {}) };
  return { width: w, height, scene, errors };
}

const implementations = { gantt: { parse, layout, honoredConfig: ['gantt.axisFormat', 'gantt.tickInterval', 'gantt.weekday', 'gantt.topAxis', 'gantt.displayMode', 'gantt.todayDate'] } };
export { implementations };
