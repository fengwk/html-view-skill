import { resolveIconRef } from '../core/icons.js';
import { normalizeLabel } from './label.js';
import { presentation } from './presentation.js';
import { FONT, blocking, error, isEn, maxWidthOf, warning, wrapText } from './support.js';
import { DAY, weekdays, compileDate, compileAxis, dateTokens, axisTokens, durationPattern, add, excludedBy, shiftEnd, intervalPattern, ticks } from './gantt-date.js';

const flags = { done: ['已完成', 'done'], active: ['进行中', 'in progress'], crit: ['关键', 'critical'], milestone: ['里程碑', 'milestone'], vert: ['竖线', 'vertical marker'] };
const dependency = /^(after|until)\s+(.+)$/i;
const iconPack = /(?<![\w:/.-])(?:fa[bsrlk]?|logos|mdi|tabler|simple-icons):[a-z\d-]+/gi;
const separator = /:::[\w-]+|::icon\([^)]+\)|(?<![\w:/.-])(?:fa[bsrlk]?|logos|mdi|tabler|simple-icons):[a-z\d-]+|(:)/gi;
const iconSlot = icon => icon ? 20 : 0;
const iso = compileDate('YYYY-MM-DD');
const timeLimit = 8640000000000000;
const valid = stamp => Number.isFinite(stamp) && Math.abs(stamp) <= timeLimit;

function parse(body, info) {
  const { lang, firstLine = 2 } = info, errors = [], items = [], sections = [{ name: '', items: [] }];
  const config = info.config?.gantt || {}, configLines = info.configLines || {};
  const look = presentation({ lang }), assets = new Set();
  const asset = diagnostic => {
    if (!assets.has(diagnostic.message)) { assets.add(diagnostic.message); errors.push(diagnostic); }
  };
  const label = (raw, line) => {
    let icon = null;
    const resolve = ref => {
      const resolved = resolveIconRef(ref);
      if (!resolved) asset(warning('IGNORED_ASSET', lang, line, `未知图标 ${ref}`, `Unknown icon ${ref}`));
      icon ??= resolved;
      return '';
    };
    const source = String(raw ?? '').replace(/::icon\(([^)]+)\)/gi, (_, ref) => resolve(ref.trim()))
      .replace(iconPack, ref => /^fa[bsrlk]?:/i.test(ref) ? ref : resolve(ref));
    const result = normalizeLabel(source, { lang, line });
    result.diagnostics.forEach(asset);
    return { name: result.text, icon: result.icon || icon };
  };
  let title = { raw: info.title, line: info.configLines?.title ?? info.headerLine ?? firstLine };
  const model = { type: 'gantt', title: '', items, sections, firstLine, compact: config.displayMode === 'compact' };
  const directives = new Map(), excludes = new Set(), includes = new Set();
  const issue = (line, zh, en, fixZh = '修正甘特图语句', fixEn = 'Correct the Gantt statement') => errors.push(error(lang, line, zh, en, fixZh, fixEn));
  const gluedTasks = line => issue(line, '此行看起来写了两个任务', 'This looks like two tasks on one line',
    '每个任务各写一行', 'Put each task on its own line');
  const notice = (line, zh, en) => errors.push(warning('DIAGRAM_HINT', lang, line, zh, en));
  if (info.params || Object.keys(info.options || {}).length) issue(info.headerLine, 'gantt 标题行不接受选项', 'The gantt header takes no options');
  if (body.length > 200000) {
    issue(firstLine, '甘特图源码超过 200000 字符，请拆分', 'Gantt source exceeds 200,000 characters; split the diagram');
    return { model, errors };
  }
  let autoId = 0;
  for (const [i, raw] of body.split('\n').entries()) {
    const line = firstLine + i;
    const text = raw.trim();
    if (!text || text.startsWith('%%')) continue;
    // Gantt can attach both commands to one task; normalize each to the shared collector's syntax.
    const both = /^click\s+(\S+)\s+(?:(href\s+"(?:\\.|[^"\\])*")\s+(call\s+[\w.$]+\s*\(.*\))|(call\s+[\w.$]+\s*\(.*\))\s+(href\s+"(?:\\.|[^"\\])*"))\s*;?$/i.exec(text);
    if (both) {
      for (const command of both.slice(2).filter(Boolean)) look.accept(`click ${both[1]} ${command.replace(/^\w+/, word => word.toLowerCase())}`, line);
      continue;
    }
    const interaction = /^(click\s+\S+\s+)(HREF|CALL)(?=\s)/i;
    if (look.accept(text.replace(interaction, (_, prefix, command) => prefix + command.toLowerCase()), line)) continue;
    const statement = /^(dateFormat|axisFormat|tickInterval|weekday|weekend|todayMarker|includes|excludes|title|section)(?:\s+(.*)|$)/i.exec(text);
    if (statement) {
      const key = statement[1].toLowerCase(), value = statement[2] || '';
      if (key === 'title') title = { raw: value, line };
      else if (key === 'section') sections.push({ ...label(value, line), items: [] });
      else if (key === 'includes' || key === 'excludes') {
        for (const token of value.toLowerCase().split(/[ ,\t]+/).filter(Boolean)) (key === 'includes' ? includes : excludes).add(token);
      } else directives.set(key, { line, value });
      continue;
    }
    if (/^(topAxis|inclusiveEndDates)$/i.test(text)) { directives.set(text.toLowerCase(), { line, value: true }); continue; }
    const colon = [...text.matchAll(separator)].find(match => match[1])?.index;
    if (colon == null) {
      issue(line, `无法识别甘特图语句：${text.slice(0, 50)}`, `Unrecognized Gantt statement: ${text.slice(0, 50)}`);
      continue;
    }
    const names = [];
    const stripClasses = text => text.replace(/:::([\w-]+)/g, (_, name) => { names.push(name); return ''; });
    const caption = label(stripClasses(text.slice(0, colon)).trim(), line);
    const fields = text.slice(colon + 1).replace(/((?:\s*:::[\w-]+)+)\s*$/, stripClasses).trim().split(',').map(x => x.trim()), tags = [];
    while (Object.hasOwn(flags, fields[0]?.toLowerCase())) tags.push(fields.shift().toLowerCase());
    if (fields.length > 3) { gluedTasks(line); continue; }
    if (fields.some(x => !x) || !fields.length) {
      issue(line, '任务需要结束值，可在前面加起点和 ID', 'Expected end, start/end, or ID/start/end'); continue;
    }
    const id = fields.length === 3 ? fields.shift() : `task${++autoId}`;
    if (names.length) look.addClasses(id, names, line);
    const record = { id, ...caption, startField: fields.length === 2 ? fields[0] : null, endField: fields.at(-1), flags: tags, line };
    sections.at(-1).items.push(record); items.push(record);
  }
  const heading = label(title.raw, title.line);
  model.title = info.title = heading.name;
  model.titleIcon = heading.icon;
  errors.push(...look.diagnostics());
  for (const task of items) { task.status = look.statusOf(task.id); task.link = look.linkOf(task.id); }
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
  const marker = option('todayMarker', '');
  const off = String(marker.value).toLowerCase() === 'off';
  if (!off && marker.value) errors.push(warning('IGNORED_STYLE', lang, marker.line, 'Today 标记使用主题样式', 'Today marker uses the theme style'));
  const today = off ? NaN : fixed;
  Object.assign(model, { axis, interval: interval && Number.isSafeInteger(+interval[1]) ? interval : null, intervalLine: intervalSpec.line,
    weekStart, monthLabels: axisSpec.value === '%Y-%m', topAxis: option('topAxis', false).value, today });
  if (errors.some(blocking)) return { model, errors };

  // A second separator is not task data, except for colons inside a date (e.g. HH:mm).
  for (const task of items) {
    if ([task.id, task.startField, task.endField].some((field, i) => {
      const value = field?.split('%%', 1)[0].trim();
      return value?.includes(':') && (i === 0 || !valid(date.parse(value)));
    })) gluedTasks(task.line);
  }
  if (errors.some(blocking)) return { model, errors };

  model.excluded = excludes.size ? excludedBy({ includes, excludes, weekend }, date.format) : null;
  const ids = new Map(), unresolved = new Set(), ignoredEnds = new Set();
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
      let end = endDependency ? relative(endDependency, false) : duration ? add(task.startTime, +duration[1], duration[2]) : date.parse(task.endField);
      if (!duration && !endDependency) {
        if (valid(end)) { if (inclusive) end += DAY; }
        else {
          // Mermaid keeps unrecognized end values (including trailing %% text) as zero duration.
          if (!ignoredEnds.has(task.endField)) notice(task.line, `无法解析结束值「${task.endField}」，任务按零时长绘制`, `Unrecognized end value “${task.endField}”; drawing a zero-duration task`);
          ignoredEnds.add(task.endField);
          end = task.startTime;
        }
      }
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

// Compact lanes reserve task marks AND captions. Try the bar interior, then its right and left.
function compactRows(items, { bounds, caption, markerXs, left, width }) {
  const rows = [], gap = 7;
  for (const item of items) {
    const [start, end] = bounds(item), label = caption(item);
    const { w } = label;
    const candidates = [];
    if (!item.flags.includes('milestone') && label.names.length === 1 && end - start >= w + 2 * gap) {
      // An interior caption may move off-centre to leave a vertical marker visible.
      let lo = start + gap;
      const middle = (start + end - w) / 2;
      for (const edge of [...markerXs.filter(x => x > start && x < end), end]) {
        if (edge - gap - lo >= w) candidates.push({ x: Math.max(lo, Math.min(middle, edge - gap - w)), inside: true });
        lo = edge + gap;
      }
      candidates.sort((a, b) => Math.abs(a.x - middle) - Math.abs(b.x - middle));
    }
    candidates.push({ x: end + gap }, { x: start - gap - w });
    const free = candidates.filter(({ x }) => x >= left && x + w <= width - 14 &&
      markerXs.every(marker => marker <= x - gap || marker >= x + w + gap));
    const available = (row, candidate) => row.every(other =>
      (item.endTime <= other.item.startTime || item.startTime >= other.item.endTime) &&
      (Math.max(end, candidate.x + w) + gap <= other.lo || Math.min(start, candidate.x) >= other.hi + gap));
    let lane, position;
    for (const row of rows) {
      const place = free.find(candidate => available(row, candidate));
      if (place) { lane = row; position = place; break; }
    }
    if (!lane) {
      lane = []; rows.push(lane);
      // A dedicated lane can grow the scene. If tightly spaced markers block both sides,
      // give the caption priority and break those marker strokes around the caption.
      position = free[0] || candidates.at(-2);
    }
    lane.push({ item, label, ...position, lo: Math.min(start, position.x), hi: Math.max(end, position.x + w) });
  }
  return rows;
}

function layout(model, { width, ctx, measure, renderOptions }) {
  const { design: d, lang } = ctx, { items, sections, today } = model;
  const errors = [], children = [], title = model.title, naked = !renderOptions?.frame && title;
  const body = FONT.body, small = FONT.label, bold = { ...body, weight: 600 };
  const texts = value => value.split('\n');
  const states = item => item.flags.map(flag => flags[flag][isEn(lang) ? 1 : 0]).join(' · ');
  const labelW = Math.max(model.compact ? 32 : 120, ...(model.compact ? [] : items.flatMap(item => [maxWidthOf(texts(item.name), body, measure) + iconSlot(item.icon), measure(states(item), small)])),
    ...sections.map(s => maxWidthOf(texts(s.name), bold, measure) + iconSlot(s.icon)));
  const addShape = (tag, attrs, meta, link) => {
    const mark = { ...ctx.el(tag, attrs), ...(meta ? { meta } : {}) };
    children.push(link ? ctx.link(link.href, [mark], link) : mark);
  };
  const drawIcon = (icon, x, y, color = d.fg1) => {
    if (!icon) return;
    const [vx, vy, iw, ih] = icon.viewBox.split(/\s+/).map(Number), scale = 14 / Math.max(iw, ih), stroke = icon.set === 'tabler';
    children.push(ctx.el('g', { transform: `translate(${x - vx * scale} ${y - ih * scale / 2 - vy * scale}) scale(${scale})`,
      fill: stroke ? 'none' : color, stroke: stroke ? color : 'none', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
    icon.elements.map(({ tag, attrs }) => ctx.shape(tag, attrs))));
  };
  const text = (value, x, y, font = body, fill = d.fg1, anchor = 'start', meta) => children.push(ctx.text(x, y, value, { ...font, fill, anchor, 'dominant-baseline': 'central', meta }));
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
  let w = Math.max(width, Math.ceil(left + plot + right));
  const markers = items.filter(item => item.flags.includes('vert'));
  const showToday = valid(today) && items.length && today >= min && today <= end;
  const markerStamp = marker => marker.today ? today : marker.startTime + (marker.endTime - marker.startTime) / 2;
  const markerXs = [...markers.map(marker => x(markerStamp(marker))), ...(showToday ? [x(today)] : [])].sort((a, b) => a - b);
  const markBounds = item => item.flags.includes('milestone') ?
    [x(markerStamp(item)) - 9, x(markerStamp(item)) + 9] :
    [x(item.startTime), Math.max(x(item.startTime) + 4, x(item.endTime))];
  const compact = new Map();
  if (model.compact) for (const section of sections) {
    const rows = compactRows(section.items.filter(item => !item.flags.includes('vert')), {
      bounds: markBounds, markerXs, left: left - 10, width: w,
      caption: item => {
        const names = texts(item.name), state = states(item);
        return { names, state, w: Math.max(maxWidthOf(names, body, measure) + iconSlot(item.icon), measure(state, small)) };
      },
    });
    compact.set(section, rows);
    for (const row of rows) for (const entry of row) w = Math.max(w, Math.ceil(entry.hi + 14));
  }
  const titleLines = naked ? wrapText(title, w - 48 - iconSlot(model.titleIcon), FONT.title, measure) : [];
  if (titleLines.length) drawIcon(model.titleIcon, 24, 24);
  titleLines.forEach((value, i) => text(value, 24 + iconSlot(model.titleIcon), 24 + i * 20, FONT.title));
  let y = titleLines.length ? 24 + titleLines.length * 20 : 24;
  if (model.topAxis) y += 22;
  const markerY = y, markerInfo = [];
  for (const marker of [...markers, ...(showToday ? [{ startTime: today, name: isEn(lang) ? 'Today' : '今天', today: true }] : [])]) {
    const stamp = markerStamp(marker);
    const name = marker.name.replace(/\s*\n\s*/g, ' ');
    const caption = marker.today ? name : [name, model.axis(stamp)].filter(Boolean).join(' · ');
    const content = wrapText(caption, w - 28 - iconSlot(marker.icon), small, measure);
    const tw = maxWidthOf(content, small, measure) + iconSlot(marker.icon), pitch = 17;
    const center = Math.max(14 + tw / 2, Math.min(w - 14 - tw / 2, x(stamp)));
    markerInfo.push({ marker, stamp, y, center, content });
    y += content.length * pitch + 8;
  }
  const top = y;
  const bands = [], bars = [];
  for (const section of sections) {
    if (!section.name && !section.icon && !section.items.length) continue;
    const top = y, names = section.name || section.icon ? texts(section.name) : [];
    if (names.length) y += 14 + 18 * names.length;
    if (model.compact) {
      for (const row of compact.get(section)) {
        const rowH = Math.max(48, ...row.map(({ label, inside }) => inside && label.state ? 58 : (label.names.length + Number(Boolean(label.state))) * 18 + 20));
        for (const entry of row) {
          const middle = y + rowH / 2;
          const lines = entry.label.names.length + Number(Boolean(entry.label.state));
          bars.push({ task: entry.item, barY: middle, caption: entry, labelY: middle - (entry.inside ? 0 : (lines - 1) * 9) });
        }
        y += rowH;
      }
    } else for (const task of section.items.filter(item => !item.flags.includes('vert'))) {
      const lines = texts(task.name).length + Number(Boolean(states(task)));
      const rowH = Math.max(48, lines * 18 + 20), labelY = y + rowH / 2 - (lines - 1) * 9;
      bars.push({ task, barY: labelY, labelY }); y += rowH;
    }
    if (names.length) bands.push({ names, icon: section.icon, top, bottom: y });
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
    const color = marker.status ? d[marker.status] : marker.today ? d.warn : ctx.color('accent');
    drawIcon(marker.icon, center - (measure(content[0] || '', small) + iconSlot(marker.icon)) / 2, y + 8, color);
    const parts = content.map((value, i) => ctx.text(center + iconSlot(marker.icon) / 2, y + 8 + i * 17, value,
      { ...small, fill: d.fg1, anchor: 'middle', 'dominant-baseline': 'central' }));
    if (marker.link) children.push(ctx.link(marker.link.href, parts, marker.link));
    else children.push(...parts);
    const markerX = x(stamp);
    if (!model.compact) line(markerX, top, bottom, color, true);
    else {
      const gaps = bars.filter(({ caption }) => markerX > caption.x - 3 && markerX < caption.x + caption.label.w + 3);
      let from = top;
      const segment = to => {
        if (to > from) addShape('line', { x1: markerX, x2: markerX, y1: from, y2: to, stroke: color,
          'stroke-width': 2, 'stroke-dasharray': '4 4' }, { kind: 'leader', id: marker.id || 'today' });
      };
      for (const { caption, labelY } of gaps) {
        segment(labelY - 10);
        from = labelY + (caption.label.names.length - 1 + Number(Boolean(caption.label.state))) * 18 + 10;
      }
      segment(bottom);
    }
  }
  bands.forEach(({ names, icon, top }) => {
    drawIcon(icon, 12, top + 15);
    names.forEach((value, i) => text(value, 12 + iconSlot(icon), top + 15 + i * 18, bold, d.fg2));
  });
  for (const { task, barY, labelY, caption } of bars) {
    const { names, state } = caption?.label ?? { names: texts(task.name), state: states(task) };
    const labelX = caption?.x ?? 12;
    if (!caption) {
      drawIcon(task.icon, labelX, labelY);
      names.forEach((name, i) => text(name, labelX + iconSlot(task.icon), labelY + i * 18));
      if (state) text(state, labelX, labelY + names.length * 18, small, d.fg2);
    }
    const x1 = x(task.startTime), x2 = x(task.endTime), meta = { kind: 'node', id: task.id, ...(task.status ? { status: task.status } : {}) };
    const critical = task.flags.includes('crit'), done = task.flags.includes('done'), active = task.flags.includes('active');
    const tone = task.status ? d[task.status] : critical ? d.accent : done ? d.ok : active ? d.info : ctx.color('tone1');
    const stroke = ctx.tint(d.bg, tone, critical || task.status ? .82 : .62);
    const fill = ctx.tint(d.bg, tone, done ? .30 : critical ? .24 : .17);
    if (task.flags.includes('milestone')) {
      const mid = (x1 + x2) / 2;
      addShape('polygon', { points: `${mid},${barY - 9} ${mid + 9},${barY} ${mid},${barY + 9} ${mid - 9},${barY}`, fill, stroke }, meta, task.link);
    } else {
      const barW = Math.max(4, x2 - x1);
      addShape('rect', { x: x1, y: barY - 11, width: barW, height: 22, fill, stroke, rx: 4 }, meta, task.link);
      if (active && barW > 8) addShape('rect', { x: x1 + 2, y: barY - 9, width: (barW - 4) * .55, height: 18, fill: ctx.tint(d.bg, tone, .38), rx: 3, 'pointer-events': 'none' });
    }
    if (caption) {
      drawIcon(task.icon, labelX, labelY);
      // An interior caption intentionally overlaps its own outline; the gate still checks its text
      // and marker clearance. Exterior captions also get the label-vs-node check.
      const labelMeta = { kind: caption.inside ? 'node-label' : 'edge-label', node: task.id };
      names.forEach((name, i) => text(name, labelX + iconSlot(task.icon), labelY + i * 18, body, d.fg1, 'start', labelMeta));
      if (state) text(state, labelX, labelY + names.length * 18, small, d.fg2, 'start', { kind: 'edge-label', node: task.id });
    }
  }
  if (items.length === 0) text(isEn(lang) ? 'No scheduled tasks' : '暂无排期任务', w / 2, top + 36, body, d.fg2, 'middle');
  if (w > 2 * width || items.length > 60) errors.push(warning('LARGE_DIAGRAM', lang, model.firstLine, '甘特图较大，可滚动查看', 'Large Gantt chart; scroll to view', '可拆成多张图', 'Consider splitting the chart'));
  const scene = { width: w, height, title, children, ...(renderOptions?.frame ? { heading: title || undefined } : {}) };
  return { width: w, height, scene, errors };
}

// Mermaid's gantt lexer reads `%%` after statement text as part of the value (axisFormat `%%` is a literal %).
const implementations = { gantt: { parse, layout, acceptsPresentation: true, trailingComments: false,
  honoredConfig: ['gantt.dateFormat', 'gantt.axisFormat', 'gantt.tickInterval', 'gantt.weekday', 'gantt.weekend', 'gantt.topAxis', 'gantt.inclusiveEndDates', 'gantt.displayMode', 'gantt.todayDate', 'gantt.todayMarker'] } };
export { implementations };
