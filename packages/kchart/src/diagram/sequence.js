import { resolveIconRef } from '../core/icons.js';
import { normalizeLabel } from './label.js';
import { presentation, roleOfColor, safeHref } from './presentation.js';
import { FONT, appearance, error, maxWidthOf, snap, warning, wrapText } from './support.js';

const LIMITS = Object.freeze({ participants: 300, messages: 500, fragmentDepth: 32, lines: 4 });
const SECTIONS = new Set(['else', 'and', 'option']);
const TYPES = new Set(['actor', 'boundary', 'collections', 'control', 'database', 'entity', 'participant', 'queue']);
const ARROWS = new Map();
for (const [stem, head, start] of [
  ['->>', 'arrow'], ['->', 'none'], ['-x', 'cross'], ['-)', 'open'], ['<<->>', 'arrow', 'arrow'],
  ['-|\\', 'top'], ['-|/', 'bottom'], ['-\\\\', 'stick-top'], ['-//', 'stick-bottom'],
  ['/|-', 'none', 'top'], ['\\|-', 'none', 'bottom'], ['//-', 'none', 'stick-top'], ['\\\\-', 'none', 'stick-bottom'],
]) {
  for (const dashed of [false, true]) {
    const token = dashed ? stem.replace('-', '--') : stem;
    const style = head === 'cross' ? 'lost' : head === 'open' ? 'async' : dashed ? 'return' : 'sync';
    ARROWS.set(token, { token, head, start, dashed, style });
  }
}
const arrowPattern = new RegExp([...ARROWS.keys()].sort((a, b) => b.length - a.length)
  .map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
const validId = id => /^[^\s<>:：,;@()+]+$/.test(id);
const issue = (lang, line, zh, en, fixZh, fixEn) => error(lang, line, zh, en, fixZh, fixEn);
const colorPattern = /^(?:rgba?|hsla?)\([^)]*\)/i;

// Keep quoted metadata and entities whole while separating statements and comments.
function splitLine(raw) {
  const parts = [];
  let start = 0;
  for (const match of raw.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|&?#(?:x[\da-f]+|\w+);|&\w+;|%%|#|;/gi)) {
    // A hash inside the URL of a single-link menu entry is a URL fragment.
    if (match[0] === '#' && /^\s*link\s+[^\s:]+\s*:[^@]*@\s*\S*$/i.test(raw.slice(start, match.index))) continue;
    if (match[0] === ';' || match[0] === '#' || match[0] === '%%') {
      parts.push(raw.slice(start, match.index));
      if (match[0] !== ';') return parts;
      start = match.index + 1;
    }
  }
  parts.push(raw.slice(start));
  return parts;
}
function metadata(raw = '') {
  const pairs = raw.matchAll(/(?:^|,)\s*["']?(type|alias|icon)["']?\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,]+)\s*(?=,|$)/g);
  return Object.fromEntries(Array.from(pairs, ([, key, value]) => {
    value = value.trim();
    if (value.startsWith('"')) {
      try { return [key, JSON.parse(value)]; } catch { /* use the literal below */ }
    }
    return [key, value.replace(/^(["'])(.*)\1$/, '$2')];
  }));
}

function parse(source, info) {
  const { lang, options = {}, firstLine } = info;
  const look = presentation({ lang });
  const menuLinks = new Map(), ignoredColors = new Map();
  const errors = [];
  for (const key of Object.keys(options)) {
    errors.push(issue(lang, firstLine - 1, `sequenceDiagram 不支持选项「${key}」`, `Unsupported sequenceDiagram option: ${key}`, '删掉第一行的选项', 'Remove the option from the first line'));
  }
  const participants = [];
  const byId = new Map();
  const statements = [];
  const stack = [];
  let messages = 0, title;
  let pendingCreate, pendingDestroy;
  const warned = new Set();
  const warnOnce = (code, line, ...messages) => {
    if (warned.has(code)) return;
    warned.add(code);
    errors.push(warning(code, lang, line, ...messages));
  };
  const recordWarning = d => {
    const key = `${d.code}:${d.message}`;
    if (!warned.has(key)) { warned.add(key); errors.push(d); }
  };
  const label = (raw, line) => {
    const { text, icon, diagnostics } = normalizeLabel(raw.replace(/^(?:no)?wrap\s*:\s*/i, ''), { lang, line });
    diagnostics.forEach(recordWarning);
    return { text, icon };
  };
  const actorRef = (source, line) => {
    const [id, ...classes] = source.split(':::');
    if (classes.length) look.addClasses(id, classes, line);
    return id;
  };
  const lifecycleError = ({ id, line }, zh, en) => errors.push(issue(lang, line, `${id}：${zh}`, `${id}: ${en}`, '修正下一条消息的参与者', 'Correct the participants in the next message'));

  function ensure(id, line, name = id) {
    if (byId.has(id)) return byId.get(id);
    if (participants.length >= LIMITS.participants) {
      errors.push(issue(lang, line, `参与者超过 ${LIMITS.participants} 个`, `More than ${LIMITS.participants} participants`, `删到 ${LIMITS.participants} 个参与者，或拆成两张图`, `Keep at most ${LIMITS.participants} participants, or split the diagram`));
      return null;
    }
    const actor = { id, name, kind: 'participant', line, index: participants.length };
    participants.push(actor);
    byId.set(id, actor);
    return actor;
  }
  function close(line) {
    const open = stack.at(-1);
    if (!open) {
      errors.push(issue(lang, line, 'end 没有对应的开始语句', 'end has no matching start', '删掉这个 end，或在它前面补上片段、rect 或 box', 'Remove this end, or add the fragment, rect, or box it closes'));
      return;
    }
    stack.pop();
    statements.push({ type: 'end', line, target: open });
  }

  const lines = String(source).split('\n');
  function statement(raw, lineNo) {
    if (!raw.trim() || raw.trimStart().startsWith('%%')) return;
    if (/^\s*\t|^\s+\t/.test(raw) || raw.includes('\t')) {
      errors.push(issue(lang, lineNo, '时序图语句不能使用 Tab', 'Tabs are not allowed in sequence statements', '把 Tab 换成空格', 'Replace tabs with spaces'));
      return;
    }
    const line = raw.trim();
    const heading = /^title(?:\s*:\s*|\s+)(.+)$/i.exec(line);
    if (heading) { title = label(heading[1], lineNo).text; return; }
    const menu = /^(link|links|properties|details)\s+([^\s:]+)\s*:\s*(.*)$/i.exec(line);
    if (menu) {
      const [, kind, id, body] = menu;
      warnOnce('IGNORED_INTERACTION', lineNo, '已省略参与者菜单和详情界面；仅保留首个安全链接', 'Participant menus and details are omitted; only the first safe URL is kept', '把其他必要链接放在图外', 'Put other essential links outside the diagram');
      if (!menuLinks.has(id)) {
        let entries = [];
        if (kind.toLowerCase() === 'link') {
          const parts = /^(.*?)@\s*(.+)$/.exec(body);
          if (parts) entries = [[parts[1].trim(), parts[2]]];
        } else if (kind.toLowerCase() === 'links') {
          try {
            const value = JSON.parse(body);
            if (value && typeof value === 'object' && !Array.isArray(value)) entries = Object.entries(value);
          } catch { /* An invalid menu has no safe link to retain. */ }
        }
        for (const [tooltip, url] of entries) {
          const href = typeof url === 'string' && safeHref(url.trim());
          if (href) { menuLinks.set(id, { href, tooltip }); break; }
        }
      }
      return;
    }
    if (look.accept(line, lineNo)) return;
    const decl = /^(?:(create)\s+)?(participant|actor)\s+([^\s@]+)(?:\s*@\{([^}]*)\})?(?:\s+as\s+(.+))?$/i.exec(line);
    if (decl) {
      const [, create, keyword, ref, rawMeta, alias] = decl;
      const [, actorId, iconRef] = /^(.*?)::icon\(([^)]+)\)$/.exec(ref) ?? [];
      const id = actorRef(actorId ?? ref, lineNo);
      const meta = metadata(rawMeta);
      if (!validId(id)) {
        errors.push(issue(lang, lineNo, '参与者 ID 无效', 'Invalid participant id', '写成 participant ID as 名称', 'Write participant ID as Name'));
        return;
      }
      if (create && (byId.has(id) || pendingCreate)) {
        lifecycleError({ id, line: lineNo }, '重复创建或已有待创建的参与者', 'Duplicate or already pending creation');
        return;
      }
      const actor = ensure(id, lineNo);
      if (!actor) return;
      const kind = meta.type || keyword.toLowerCase();
      if (!TYPES.has(kind)) warnOnce('DIAGRAM_HINT', lineNo, '未知参与者类型，使用普通方框', 'Unknown participant type; using a standard participant', '检查 type', 'Check the type value');
      const { text, icon } = label(alias || meta.alias || id, lineNo);
      const explicit = iconRef || meta.icon;
      const resolved = explicit ? resolveIconRef(explicit) : null;
      if (explicit && !resolved) recordWarning(warning('IGNORED_ASSET', lang, lineNo, `未知图标 ${explicit}`, `Unknown icon ${explicit}`, '使用内置图标', 'Use a supported icon'));
      Object.assign(actor, { name: text, icon: resolved || icon, kind: TYPES.has(kind) ? kind : 'participant', declared: true, line: lineNo });
      if (create) pendingCreate = { id, line: lineNo };
      if (stack.at(-1)?.type === 'box') stack.at(-1).members.push(id);
      statements.push({ type: 'participant', id, line: lineNo });
      return;
    }
    const destroy = /^destroy\s+(\S+)$/i.exec(line);
    if (destroy) {
      const id = destroy[1];
      if (!byId.has(id) || pendingDestroy) lifecycleError({ id, line: lineNo }, '未知参与者或已有待销毁的参与者', 'Unknown participant or already pending destruction');
      else pendingDestroy = { id, line: lineNo };
      return;
    }
    const numbering = /^autonumber(?:\s+(off|[+-]?\d+(?:\.\d+)?)(?:\s+([+-]?\d+(?:\.\d+)?))?)?$/i.exec(line);
    if (numbering) {
      statements.push({ type: 'numbering', start: numbering[1]?.toLowerCase() === 'off' ? null : Number(numbering[1] ?? 1), step: Number(numbering[2] ?? 1), line: lineNo });
      return;
    }
    if (/^activate\s+(\S+)$/i.test(line) || /^deactivate\s+(\S+)$/i.test(line)) {
      const [, word, id] = /^(activate|deactivate)\s+(\S+)$/i.exec(line);
      if (!ensure(id, lineNo)) return;
      statements.push({ type: word.toLowerCase(), id, line: lineNo });
      return;
    }
    const note = /^Note\s+(over\s+(\S+?)(?:\s*,\s*(\S+))?|left\s+of\s+(\S+)|right\s+of\s+(\S+))\s*:\s*(.*)$/i.exec(line);
    if (note) {
      const ids = note[2] ? [note[2], note[3]].filter(Boolean) : [note[4] || note[5]];
      if (ids.some((id) => !ensure(id, lineNo))) return;
      statements.push({ type: 'note', place: note[2] ? 'over' : (note[4] ? 'left' : 'right'), ids, ...label(note[6].trim(), lineNo), line: lineNo });
      return;
    }
    const block = /^(alt|opt|loop|par_over|par|critical|break|rect|box|else|and|option|end)(?:\s+(.*)|$)/i.exec(line);
    if (block) {
      const word = block[1].toLowerCase().replace('par_over', 'par');
      let rest = (block[2] || '').trim();
      let color, status;
      if (word === 'box' || word === 'rect') {
        color = colorPattern.exec(rest)?.[0] || /^transparent\b/i.exec(rest)?.[0];
        const token = rest.split(/\s/, 1)[0];
        if (!color && (roleOfColor(token) || /^(?:black|white|(?:light|dark|slate|dim)?gr[ae]y|silver)$/i.test(token))) color = token;
        if (color) {
          status = roleOfColor(color);
          if (!status && !/^transparent$/i.test(color) && !ignoredColors.has(color)) ignoredColors.set(color, lineNo);
          rest = rest.slice(color.length).trim();
        }
      }
      if (word === 'end') {
        if (rest) errors.push(issue(lang, lineNo, 'end 后面不能再写内容', 'end cannot have trailing text', '这一行只写 end', 'Leave only end on this line'));
        close(lineNo);
        return;
      }
      const { text, icon } = label(rest, lineNo);
      if (SECTIONS.has(word)) {
        const open = stack.at(-1);
        const allowed = { else: ['alt'], and: ['par'], option: ['critical'] }[word];
        if (!open || !allowed.includes(open.keyword)) {
          errors.push(issue(lang, lineNo, `「${word}」不能出现在当前片段里`, `"${word}" is not valid in the current fragment`, `把它放到对应的 ${allowed.join('/')} 片段中`, `Place it inside ${allowed.join('/')} before end`));
          return;
        }
        statements.push({ type: 'section', keyword: word, text, icon, line: lineNo, owner: open });
        open.sections.push({ keyword: word, text, icon, line: lineNo });
        return;
      }
      if (stack.length >= LIMITS.fragmentDepth) {
        errors.push(issue(lang, lineNo, `组合片段最多嵌套 ${LIMITS.fragmentDepth} 层`, `Fragments nest at most ${LIMITS.fragmentDepth} levels`, '把内层片段拆到另一张图', 'Move the inner fragment to another diagram'));
        return;
      }
      const node = { type: word === 'box' ? 'box' : (word === 'rect' ? 'rect' : 'fragment'), keyword: word, text, icon, color, status, line: lineNo, kind: word === 'box' || word === 'rect' ? word : 'fragment', sections: [], members: [] };
      statements.push(node);
      stack.push(node);
      return;
    }
    const colon = Array.from(line.matchAll(/:::[\w-]+|:/g)).find(match => match[0] === ':')?.index;
    const hasLabel = colon !== undefined;
    const address = hasLabel ? line.slice(0, colon) : line;
    const match = arrowPattern.exec(address);
    if (match?.index > 0) {
      const arrow = ARROWS.get(match[0].toLowerCase());
      const left = /^(.*?)\s*(\(\))?\s*(\+)?$/.exec(address.slice(0, match.index).trim());
      const right = /^([+-])?\s*(\(\))?\s*(.*?)\s*(\+)?$/.exec(address.slice(match.index + match[0].length).trim());
      const [, sender, centralStart, before] = left;
      const from = actorRef(sender, lineNo);
      const [, prefix, centralEnd, to, after] = right;
      const signal = prefix || before || after || (to.endsWith('-') && !byId.has(to) ? '-' : '');
      const recipient = actorRef(signal === '-' && !prefix && to.endsWith('-') ? to.slice(0, -1) : to, lineNo);
      if (!validId(from) || !validId(recipient)) {
        errors.push(issue(lang, lineNo, '消息的参与者写法无效', 'Invalid message participants', '写成 A->>B: 消息，自调用写成 A->>A: 消息', 'Write A->>B: message, or A->>A: message for a self call'));
        return;
      }
      if (!ensure(from, lineNo) || !ensure(recipient, lineNo)) return;
      let create, destroy;
      if (pendingCreate) {
        if (pendingCreate.id === recipient) create = recipient;
        else lifecycleError(pendingCreate, '下一条消息必须发给新参与者', 'The next message must target the new participant');
        pendingCreate = undefined;
      } else if (pendingDestroy) {
        if (pendingDestroy.id === from || pendingDestroy.id === recipient) destroy = pendingDestroy.id;
        else lifecycleError(pendingDestroy, '下一条消息必须涉及待销毁的参与者', 'The next message must involve the destroyed participant');
        pendingDestroy = undefined;
      }
      messages += 1;
      if (messages > LIMITS.messages) {
        errors.push(issue(lang, lineNo, `消息超过 ${LIMITS.messages} 条`, `More than ${LIMITS.messages} messages`, `删到 ${LIMITS.messages} 条，或拆成两张图`, `Keep at most ${LIMITS.messages} messages, or split the diagram`));
        return;
      }
      const activateOn = signal === '+' ? recipient : '';
      const deactivateOn = signal === '-' ? from : '';
      statements.push({
        type: 'message', from, to: recipient, style: arrow.style, arrow, centralStart: Boolean(centralStart), centralEnd: Boolean(centralEnd),
        create, destroy, ...label(hasLabel ? line.slice(colon + 1).trim() : '', lineNo), line: lineNo,
        activate: Boolean(activateOn), deactivate: Boolean(deactivateOn), activateOn, deactivateOn,
      });
      return;
    }
    errors.push(issue(lang, lineNo, `无法识别的语句「${line.slice(0, 40)}」`, `Unrecognized statement: ${line.slice(0, 40)}`, '改成 participant、消息、Note、片段、rect、box 或 end', 'Use participant, a message, Note, a fragment, rect, box, or end'));
  }
  lines.forEach((raw, index) => {
    // CSS colors and property separators belong to the shared presentation parser.
    if (/^\s*(?:style|classDef|linkStyle)\s/i.test(raw) && look.accept(raw, firstLine + index)) return;
    for (const part of splitLine(raw)) statement(part, firstLine + index);
  });
  for (const pending of [pendingCreate, pendingDestroy]) if (pending) lifecycleError(pending, '缺少后续消息', 'Missing a following message');
  for (const open of stack) {
    errors.push(issue(lang, open.line, `「${open.keyword}」缺少 end`, `"${open.keyword}" is missing end`, `在第 ${lines.length ? firstLine + lines.length - 1 : open.line} 行后补上 end`, 'Add end after the block'));
  }
  const depth = new Map();
  for (const item of statements) {
    if (item.type === 'activate') depth.set(item.id, (depth.get(item.id) || 0) + 1);
    if (item.type === 'message' && item.activateOn) depth.set(item.activateOn, (depth.get(item.activateOn) || 0) + 1);
    if (item.type === 'deactivate' || (item.type === 'message' && item.deactivateOn)) {
      const id = item.type === 'deactivate' ? item.id : item.deactivateOn;
      const next = (depth.get(id) || 0) - 1;
      if (next < 0) errors.push(issue(lang, item.line, `「${id}」的激活条没有配对的开始`, `Activation of "${id}" has no matching start`, `在这条之前写 activate ${id}，或给进入消息加 +`, `Write activate ${id} before this line, or add + to the incoming message`));
      depth.set(id, Math.max(0, next));
    }
    if (item.destroy) depth.delete(item.destroy);
  }
  if (!participants.length) errors.push(issue(lang, firstLine, '图中没有参与者', 'The diagram has no participants', '写 participant，或写一条 A->>B: 消息', 'Add a participant or a message such as A->>B: text'));
  for (const actor of participants) {
    actor.status = look.statusOf(actor.id);
    actor.link = menuLinks.get(actor.id) ?? look.linkOf(actor.id);
  }
  let edgeIndex = 0;
  for (const item of statements) if (item.type === 'message') item.status = look.edgeStatusOf(edgeIndex++);
  errors.push(...look.diagnostics());
  if (ignoredColors.size) {
    const colors = [...ignoredColors.keys()].join(', ');
    errors.push(warning('IGNORED_STYLE', lang, ignoredColors.values().next().value,
      `区段颜色使用中性色：${colors}`, `Region colors rendered as neutral: ${colors}`, '使用有彩度的颜色', 'Use chromatic colors'));
  }
  return { model: { type: 'sequence', participants, statements, title, messages }, errors };
}

const ICON_SPACE = 20;
const MESSAGE_PADDING = 36;
const MESSAGE_END_GAP = 12;
const iconSpace = item => item.icon ? ICON_SPACE : 0;

function layout(model, { measure, width, lang, compact }, info = {}) {
  const config = info.config?.sequence;
  const mirrorActors = config?.mirrorActors !== false;
  const errors = [];
  const actors = model.participants.map((item) => ({ ...item }));
  const actorAt = (id) => actors.find((item) => item.id === id);
  const labelSize = (text, font, glyph) => {
    const all = wrapText(text, 168, font, measure);
    const lines = all.slice(0, LIMITS.lines);
    return { lines, w: snap(Math.max(64, maxWidthOf(lines, font, measure) + 24)), h: snap(Math.max(32, lines.length * 18 + 14 + (glyph ? 24 : 0))) };
  };
  for (const actor of actors) {
    const glyph = actor.kind !== 'participant' || Boolean(actor.icon);
    actor.head = labelSize(actor.name, FONT.title, glyph);
    actor.foot = { ...actor.head };
    if (wrapText(actor.name, 168, FONT.title, measure).length > LIMITS.lines) {
      errors.push(issue(lang, actor.line, `参与者「${actor.name}」超过 ${LIMITS.lines} 行`, `Participant "${actor.name}" exceeds ${LIMITS.lines} lines`, '缩短名称，说明移到图外', 'Shorten the name and move the description outside'));
    }
  }
  // 标签单行上限随版心收缩：窄宽度下按列均分预算折行，宽到列距够用后再放到 200px。
  const columnBudget = (Math.max(320, width) - 16) / (actors.length + 1);
  const labelLimit = Math.round(Math.max(96, Math.min(200, columnBudget)));
  const noteLimit = Math.round(Math.max(96, Math.min(180, columnBudget)));
  const events = [];
  const open = [];
  const push = (event) => { events.push(event); };
  let number = config?.showSequenceNumbers === true ? 1 : null, step = 1;
  const sizeMessage = (event, limit) => {
    const lines = event.text || event.icon ? wrapText(event.text, Math.max(1, limit - iconSpace(event)), FONT.label, measure) : [];
    const labelH = lines.length ? lines.length * 16 + 8 : 0;
    const above = labelH + (event.ordinal ? 16 : 0);
    const createdHeight = event.create ? actorAt(event.create).head.h / 2 : 0;
    const selfReserve = event.from === event.to ? (event.ordinal ? 12 : !lines.length ? 8 : 0) : 0;
    const lineOffset = Math.max(above + (lines.length ? 2 : 10) + selfReserve, createdHeight + 8);
    const h = snap(Math.max(above + 20, lineOffset + createdHeight + 12));
    Object.assign(event, { lines, h, lineOffset, textW: Math.max(maxWidthOf(lines, FONT.label, measure) + iconSpace(event), measure(event.ordinal, FONT.label)) });
  };
  for (const item of model.statements) {
    if (item.type === 'box' || item.type === 'rect' || item.type === 'fragment') {
      const h = item.type === 'box' ? 8 : item.type === 'rect' && !item.text && !item.icon ? 8 : 28;
      push({ ...item, kind: 'open', h, depth: open.length });
      open.push(events.at(-1));
    } else if (item.type === 'section') {
      push({ ...item, host: open.at(-1), kind: 'section', h: 28 });
    } else if (item.type === 'end') {
      const started = open.pop();
      push({ ...item, kind: 'close', h: 12, depth: open.length });
      if (started) started.close = events.at(-1);
    } else if (item.type === 'note') {
      const font = FONT.label;
      const span = item.place === 'over' ? Math.abs(actorAt(item.ids[0]).index - actorAt(item.ids.at(-1)).index) : 0;
      const limit = Math.max(noteLimit, Math.min(180, span * 132));
      const wrapped = wrapText(item.text, limit, font, measure);
      if (wrapped.length > LIMITS.lines) errors.push(issue(lang, item.line, `注释超过 ${LIMITS.lines} 行`, `Note exceeds ${LIMITS.lines} lines`, '缩短注释，或拆成多条 Note', 'Shorten the note or split it into several Note lines'));
      const lines = wrapped.slice(0, LIMITS.lines);
      push({ ...item, kind: 'note', lines, h: snap(Math.max(lines.length, item.icon ? 1 : 0) * 16 + 16), textW: maxWidthOf(lines, font, measure) + iconSpace(item) });
    } else if (item.type === 'participant') {
      push({ ...item, kind: 'participant', h: 0 });
    } else if (item.type === 'activate' || item.type === 'deactivate') {
      push({ ...item, kind: item.type, h: 8 });
    } else if (item.type === 'numbering') {
      number = item.start;
      step = item.step;
    } else if (item.type === 'message') {
      const ordinal = number == null ? '' : String(Number(number.toPrecision(15)));
      if (number != null) number += step;
      const event = { ...item, kind: 'message', ordinal };
      // Seed column spacing with a bounded preferred label width. Reflow against the actual span below.
      const span = Math.abs(actorAt(item.from).index - actorAt(item.to).index);
      sizeMessage(event, span ? Math.max(labelLimit, Math.min(200, span * 132)) : Math.min(168, labelLimit));
      push(event);
    }
  }
  if (errors.length) return { width, height: 0, errors };

  const count = actors.length;
  const indexOf = new Map(events.map((event, index) => [event, index]));
  const contained = new Map();
  for (const event of events) {
    if (event.kind !== 'open' || !event.close) continue;
    const inside = [];
    for (let i = indexOf.get(event) + 1; i < indexOf.get(event.close); i += 1) inside.push(events[i]);
    contained.set(event, inside);
  }
  const rangeOf = (ids) => {
    const indexes = ids.map((id) => actorAt(id).index);
    return [Math.min(...indexes), Math.max(...indexes)];
  };
  for (const event of events) {
    if (event.kind !== 'open') continue;
    const seen = event.type === 'box' ? [...(event.members || [])] : [];
    if (event.type !== 'box') for (const inner of contained.get(event) || []) if (inner.kind === 'message' || inner.kind === 'note') seen.push(...(inner.kind === 'note' ? inner.ids : [inner.from, inner.to]));
    const ids = [...new Set(seen)];
    if (!ids.length) {
      event.lo = 0;
      event.hi = count - 1;
      continue;
    }
    [event.lo, event.hi] = rangeOf(ids);
  }
  if (errors.length) return { width, height: 0, errors };

  // 相邻生命线的最小距离由头部宽度、消息标签、自调用说明和注释决定；余宽再在列间均匀分配，每段有上限。
  const headHalf = actors.map((actor) => Math.max(actor.head.w, actor.foot.w) / 2);
  const base = new Array(count + 1).fill(0);
  const floor = new Array(count + 1).fill(0);
  const bump = (index, value) => { if (index >= 0 && index <= count) base[index] = Math.max(base[index], value); };
  const shared = (lo, hi, value) => { const parts = hi - lo; for (let i = lo + 1; i <= hi; i += 1) bump(i, value / parts); };
  actors.forEach((actor, i) => {
    bump(i, headHalf[i] + 12);
    bump(i + 1, headHalf[i] + 12);
    floor[i] = Math.max(floor[i], headHalf[i] + 12);
    floor[i + 1] = Math.max(floor[i + 1], headHalf[i] + 12);
    if (i > 0) { bump(i, headHalf[i - 1] + headHalf[i] + 16); floor[i] = Math.max(floor[i], headHalf[i - 1] + headHalf[i] + 16); }
  });
  for (let i = 1; i < count; i += 1) floor[i] = Math.max(floor[i], 24);
  const activeDepths = new Map();
  const leftExtent = [...headHalf];
  for (const event of events) {
    const start = event.activateOn || (event.type === 'activate' && event.id);
    const stop = event.deactivateOn || (event.type === 'deactivate' && event.id);
    if (start) {
      const depth = activeDepths.get(start) || 0;
      activeDepths.set(start, depth + 1);
      const i = actorAt(start).index;
      leftExtent[i] = Math.max(leftExtent[i], 5 + depth * 7);
    }
    if (stop) activeDepths.set(stop, (activeDepths.get(stop) || 1) - 1);
    if (event.destroy) activeDepths.delete(event.destroy);
  }
  for (let i = 0; i < count; i += 1) if (leftExtent[i] > headHalf[i]) {
    bump(i, leftExtent[i] + (i > 0 ? headHalf[i - 1] + 16 : 12));
  }
  for (const event of events) {
    if (event.kind === 'note') {
      if (event.place !== 'over') bump(event.place === 'left' ? actorAt(event.ids[0]).index : actorAt(event.ids.at(-1)).index + 1, event.textW + 28);
      else {
        const [lo, hi] = rangeOf(event.ids);
        if (lo === hi) bump(hi + 1, event.textW + 44);
        else shared(lo, hi, event.textW + 28);
      }
    }
  }
  const messagePadding = event => MESSAGE_PADDING + (event.create ? actorAt(event.create).head.w / 2 : 0);
  for (const event of events) if (event.kind === 'message') {
    const [lo, hi] = rangeOf([event.from, event.to]);
    if (lo === hi) bump(lo + 1, event.textW + 60);
    else {
      const span = base.slice(lo + 1, hi + 1).reduce((sum, gap) => sum + gap, 0);
      const deficit = event.textW + messagePadding(event) - span;
      if (deficit > 0) for (let i = lo + 1; i <= hi; i++) base[i] += deficit / (hi - lo);
    }
  }
  const gaps = base.map((value, i) => Math.max(value, floor[i]));
  const xsOf = () => {
    const xs = [];
    let cursor = gaps[0];
    for (let i = 0; i < count; i += 1) { xs.push(cursor); cursor += gaps[i + 1]; }
    return xs;
  };
  const noteBox = (event, xs) => {
    const a = xs[actorAt(event.ids[0]).index], b = xs[actorAt(event.ids.at(-1)).index];
    const w = snap(event.textW + 16);
    const h = event.h - 8;
    if (event.place === 'over' && a !== b) {
      const span = Math.max(w, Math.abs(a - b) + 24);
      return { x: (a + b - span) / 2, w: span, h };
    }
    return { x: event.place === 'left' ? a - w - 16 : a + 16, w, h };
  };
  const sectionLabel = event => [event.keyword, event.text].filter(Boolean).join(' ');
  const frameLabel = event => event.type !== 'fragment' ? event.text : `${event.keyword}${event.text ? ` [${event.text}]` : ''}`;
  // 片段框、rect、box 的左右范围覆盖框内标题、消息标签、自调用说明、注释和内层框；内层先算，外层再包住内层。
  const geometryOf = (xs) => {
    const notes = new Map();
    for (const event of events) if (event.kind === 'note') notes.set(event, noteBox(event, xs));
    const frames = new Map();
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event.kind !== 'open' || event.lo == null) continue;
      const pad = 18 + event.depth * 12;
      let left = xs[event.lo] - (event.type === 'box' ? headHalf[event.lo] + 4 : pad);
      let right = xs[event.hi] + (event.type === 'box' ? headHalf[event.hi] + 4 : pad);
      for (const inner of contained.get(event) || []) {
        if (inner.kind === 'message') {
          const a = xs[actorAt(inner.from).index], b = xs[actorAt(inner.to).index];
          if (inner.create) {
            const half = actorAt(inner.create).head.w / 2;
            left = Math.min(left, b - half - 8);
            right = Math.max(right, b + half + 8);
          }
          if (a === b) right = Math.max(right, a + 52 + inner.textW + 8);
          else {
            const mid = (a + b) / 2;
            left = Math.min(left, mid - inner.textW / 2 - 4);
            right = Math.max(right, mid + inner.textW / 2 + 4);
          }
        } else if (inner.kind === 'note' && notes.has(inner)) {
          const note = notes.get(inner);
          left = Math.min(left, note.x);
          right = Math.max(right, note.x + note.w);
        } else if (inner.kind === 'open' && frames.has(inner)) {
          left = Math.min(left, frames.get(inner).left - 6);
          right = Math.max(right, frames.get(inner).right + 6);
        }
      }
      // 标题与分支标题写在框内左上角，框宽必须容下最宽的一条。
      const labelWidths = [measure(frameLabel(event), FONT.label) + iconSpace(event),
        ...event.sections.map(section => measure(sectionLabel(section), FONT.label) + iconSpace(section))];
      right = Math.max(right, left + 20 + Math.max(...labelWidths));
      frames.set(event, { left, right });
    }
    let left = xs[0] - leftExtent[0], right = xs[count - 1] + headHalf[count - 1];
    for (const frame of frames.values()) { left = Math.min(left, frame.left); right = Math.max(right, frame.right); }
    for (const note of notes.values()) { left = Math.min(left, note.x); right = Math.max(right, note.x + note.w); }
    for (const event of events) {
      if (event.kind !== 'message') continue;
      const a = xs[actorAt(event.from).index], b = xs[actorAt(event.to).index];
      if (a === b) right = Math.max(right, a + 52 + event.textW + 8);
      else {
        const mid = (a + b) / 2;
        left = Math.min(left, mid - event.textW / 2 - 4);
        right = Math.max(right, mid + event.textW / 2 + 4);
      }
    }
    return { notes, frames, left, right };
  };
  let xs = xsOf();
  let geometry = geometryOf(xs);
  // 在可用宽度内补足余宽：每段列间距最多再增 128px，避免参与者很少时拉出过大的空当。
  for (let pass = 0; !compact && pass < 4; pass += 1) {
    const slack = Math.floor(width) - 16 - (geometry.right - geometry.left);
    if (slack < 1) break;
    const add = Math.min(slack / (count + 1), 128);
    if (add < 1) break;
    for (let i = 0; i <= count; i += 1) gaps[i] += add;
    xs = xsOf();
    geometry = geometryOf(xs);
  }
  for (const event of events) if (event.kind === 'message') {
    const [lo, hi] = rangeOf([event.from, event.to]);
    if (lo !== hi) sizeMessage(event, xs[hi] - xs[lo] - messagePadding(event) + 1e-6);
    if (event.lines.length > LIMITS.lines) errors.push(issue(lang, event.line, `消息「${event.text}」超过 ${LIMITS.lines} 行`, `Message "${event.text}" exceeds ${LIMITS.lines} lines`, '缩短消息，说明移到图外', 'Shorten the message and move details outside'));
  }
  if (errors.length) return { width, height: 0, errors };
  geometry = geometryOf(xs);
  // 整体左移，让最左侧内容从 8px 开始；右边界由实际内容决定。
  const shift = 8 - geometry.left;
  xs = xs.map((value) => value + shift);
  geometry = geometryOf(xs);
  actors.forEach((actor, i) => { actor.x = xs[i]; });
  for (const [event, note] of geometry.notes) event.note = note;
  for (const [event, frame] of geometry.frames) { event.left = frame.left; event.right = frame.right; }
  let contentRight = geometry.right;

  const hasBox = events.some((event) => event.type === 'box');
  const headBand = snap(8 + Math.max(36, ...actors.map((actor) => actor.head.h)) + 12);
  const top = headBand + (hasBox ? 28 : 8);
  let cursor = top;
  for (const event of events) {
    event.y = cursor;
    cursor += event.h;
  }
  const foot = mirrorActors ? snap(Math.max(...actors.map((actor) => actor.foot.h)) + 12) : 0;
  const bottom = cursor + 8;
  const height = bottom + foot + 8;
  for (const event of events) {
    if (event.kind !== 'open' || !event.close) continue;
    const boxY = event.type === 'box' ? headBand + 20 : event.y;
    const boxH = (event.type === 'box' ? bottom + 4 : event.close.y + event.close.h) - boxY;
    event.box = { x: event.left, y: boxY, w: event.right - event.left, h: boxH };
  }
  for (const event of events) if (event.note) event.note.y = event.y + 4;
  const activations = [];
  const active = new Map(actors.map((actor) => [actor.id, []]));
  const messageY = event => event.y + event.lineOffset;
  const creations = new Map(), destructions = new Map();
  const start = (id, at) => {
    const stack = active.get(id);
    const bar = { id, x: actorAt(id).x - 5 - stack.length * 7, y: at, h: 0 };
    stack.push(bar);
    activations.push(bar);
  };
  const stop = (id, at, minHeight = 16) => {
    const bar = active.get(id).pop();
    if (bar) bar.h = Math.max(minHeight, at - bar.y);
  };
  for (const event of events) {
    if (event.type === 'activate') start(event.id, event.y + 4);
    if (event.type === 'deactivate') stop(event.id, event.y + 4);
    if (event.kind !== 'message') continue;
    const y = messageY(event);
    if (event.create) creations.set(event.create, y);
    if (event.destroy) destructions.set(event.destroy, y);
    if (event.activateOn) start(event.activateOn, y + (event.create ? actorAt(event.create).head.h / 2 : 0));
    event.fromBar = active.get(event.from).at(-1);
    event.toBar = active.get(event.to).at(-1);
    if (event.deactivateOn && event.destroy !== event.deactivateOn) stop(event.deactivateOn, y + 8);
    if (event.destroy) while (active.get(event.destroy).length) stop(event.destroy, y, 0);
  }
  // 片段标题与分支标题要让开同一行的激活条：条画在框上，标题压到条上会看不清。
  const labelObstacles = model.clearFragmentLabels
    ? [...activations, ...actors.map(actor => ({ x: actor.x - 1, y: creations.get(actor.id) ?? top - 4, h: bottom }))]
    : [...activations];
  const barsByX = labelObstacles.sort((a, b) => a.x - b.x);
  const labelXOf = (box, y, width) => {
    let x = box.x + 8;
    for (const bar of barsByX) {
      if (bar.y > y + 18 || bar.y + bar.h < y) continue;
      const right = bar.x + 16;
      if (bar.x < x + width && right > x) x = right;
    }
    return x;
  };
  for (const event of events) {
    if (event.kind === 'open' && event.box && event.type !== 'box') {
      const text = frameLabel(event);
      if (!text && !event.icon) continue;
      const w = measure(text, FONT.label) + iconSpace(event);
      event.labelX = labelXOf(event.box, event.box.y, w);
      event.box.w = Math.max(event.box.w, event.labelX + w + 12 - event.box.x);
      contentRight = Math.max(contentRight, event.box.x + event.box.w);
    }
    if (event.kind === 'section') {
      const { host } = event;
      if (!host?.box) continue;
      const text = sectionLabel(event);
      const w = measure(text, FONT.label) + iconSpace(event);
      event.labelX = labelXOf(host.box, event.y, w);
      host.box.w = Math.max(host.box.w, event.labelX + w + 12 - host.box.x);
      contentRight = Math.max(contentRight, host.box.x + host.box.w);
    }
  }
  for (const actor of actors) {
    const created = creations.get(actor.id), destroyed = destructions.get(actor.id);
    actor.head.x = actor.x - actor.head.w / 2;
    actor.head.y = created == null ? 8 : created - actor.head.h / 2;
    actor.life = { x: actor.x, y1: created == null ? top - 4 : created + actor.head.h / 2, y2: destroyed ?? bottom };
    actor.destroyed = destroyed != null;
    if (actor.destroyed || !mirrorActors) actor.foot = null;
    else {
      actor.foot.x = actor.x - actor.foot.w / 2;
      actor.foot.y = bottom + 8;
    }
    for (const bar of active.get(actor.id)) bar.h = Math.max(0, actor.life.y2 - bar.y);
  }
  // 画布宽度取内容右边界与版心宽度的较小值；内容放不下时返回固有宽度，由宿主滚动。
  const naturalWidth = snap(contentRight + 8);
  const canvas = !compact && naturalWidth <= width ? Math.floor(width) : naturalWidth;
  if (naturalWidth > width * 2 || actors.length > 60 || model.messages > 200) errors.push(warning('LARGE_DIAGRAM', lang, actors[0].line, '时序图较大，可滚动查看', 'Large sequence diagram; scroll to view it', '可将时序图拆分', 'Consider splitting the diagram'));
  return {
    type: 'sequence', width: canvas, height: snap(height), actors, events, activations, errors, title: model.title,
  };
}
function scene(layout, ctx) {
  const theme = appearance(ctx), children = [];
  const drawIcon = (icon, x, y, fill) => {
    const [left, top, w, h] = icon.viewBox.split(/\s+/).map(Number), scale = 16 / Math.max(w, h);
    return ctx.el('g', { transform: `translate(${x - (left + w / 2) * scale} ${y - (top + h / 2) * scale}) scale(${scale})` },
      icon.elements.map(({ tag, attrs }) => ctx.shape(tag, { ...attrs,
        ...(icon.set === 'simple' ? { fill } : { fill: 'none', stroke: fill, 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }) })));
  };
  const addText = (parent, { x, y, lines, icon, meta, font = FONT.label, anchor = 'middle', lineHeight = 16, fill = theme.fg2, underline = false }) => {
    const rows = lines.length ? lines : [''];
    const firstY = y - (rows.length - 1) / 2 * lineHeight;
    const nodes = [];
    if (icon) {
      const middle = anchor === 'middle';
      const firstWidth = middle ? ctx.measure(rows[0], font.size, font.weight) : 0;
      nodes.push(drawIcon(icon, middle ? x - firstWidth / 2 - (rows[0] ? 2 : 0) : x + 8, firstY, fill));
      x += middle ? ICON_SPACE / 2 : ICON_SPACE;
    }
    rows.forEach((text, index) => {
      if (!text) return;
      const node = ctx.text(x, firstY + index * lineHeight, text, { anchor, size: font.size, weight: font.weight, fill, 'dominant-baseline': 'central', ...(underline ? { 'text-decoration': 'underline' } : {}) });
      nodes.push(meta ? { ...node, meta } : node);
    });
    if (nodes.length) parent.push(ctx.el('g', {}, nodes));
  };
  const line = (x1, y1, x2, y2, attrs = {}) => ctx.line(x1, y1, x2, y2, attrs);
  const heads = {
    arrow: 'M1 1 L8 5 L1 9 Z', open: 'M1 1 L8 5 L1 9', cross: 'M1 1 L9 9 M1 9 L9 1',
    top: 'M1 1 L8 5 H1 Z', bottom: 'M1 9 L8 5 H1 Z',
    'stick-top': 'M1 1 L8 5', 'stick-bottom': 'M1 9 L8 5',
  };
  const markerId = (head, status) => `seq-arrow${head === 'arrow' ? '' : `-${head}`}${status ? `-${status}` : ''}`;
  // auto-start-reverse rotates a marker by 180°, including its vertical half.
  const startHead = head => head?.replace(/top|bottom/, side => side === 'top' ? 'bottom' : 'top');
  const markers = new Map();
  for (const event of layout.events) if (event.arrow) {
    for (const head of [event.arrow.head, startHead(event.arrow.start)]) {
      if (!heads[head]) continue;
      const id = markerId(head, event.status), color = theme[event.status] ?? theme.fg3;
      if (!markers.has(id)) markers.set(id, ctx.el('marker', {
        id, viewBox: '0 0 10 10', refX: head === 'cross' ? 5 : 8, refY: 5, markerWidth: 10, markerHeight: 10,
        orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse',
      }, [ctx.path(heads[head], { fill: heads[head].endsWith('Z') ? color : 'none', stroke: color, 'stroke-width': 1.2 })]));
    }
  }
  if (markers.size) children.push(ctx.el('defs', {}, [...markers.values()]));
  const glyphs = {
    actor: 'M12 1 a3 3 0 1 0 .01 0 M12 7 v7 m-6-4 h12 m-6 4 l-5 6 m5-6 l5 6',
    boundary: 'M16 3 a7 7 0 1 0 .01 0 M9 10 H3 M3 4 v12',
    control: 'M12 4 a7 7 0 1 0 .01 0 M15 1 l-4 3 4 3',
    entity: 'M12 2 a7 7 0 1 0 .01 0 M5 17 h14',
    database: 'M4 5 a8 3 0 1 0 16 0 a8 3 0 1 0-16 0 v12 a8 3 0 0 0 16 0 V5 M4 11 a8 3 0 0 0 16 0',
    queue: 'M19 3 a3 7 0 1 0 0 14 a3 7 0 1 0 0-14 H5 a3 7 0 0 0 0 14 h14',
    collections: 'M7 4 V2 h14 v13 h-3 M3 6 h14 v13 H3 Z',
  };

  const sectionTone = ctx.frameTone(theme.accent), boxTone = ctx.frameTone(theme.tones[1]);
  const paintFrame = event => {
    if (!event.box) return;
    const { x, y, w, h } = event.box;
    const frame = [];
    const boxFrame = event.type === 'box';
    const coloredRect = event.type === 'rect' && event.color;
    const role = theme[event.status];
    const groupTone = role ? ctx.frameTone(role) : event.color ? theme.line : boxTone;
    const fill = /^transparent$/i.test(event.color) ? 'none'
      : coloredRect ? role || theme.fg4
        : event.type === 'rect' ? ctx.tint(theme.bg, sectionTone, theme.soft)
          : boxFrame ? ctx.tint(theme.bg, event.color && !role ? theme.fg4 : groupTone, .08) : ctx.mix(theme.bg, theme.fg4, .07);
    const stroke = coloredRect ? 'none' : event.type === 'rect' ? sectionTone : boxFrame ? groupTone : theme.line;
    frame.push(ctx.rect(x, y, w, h, {
      fill, stroke, ...(coloredRect ? { 'fill-opacity': .1 } : event.type === 'rect' ? { 'stroke-opacity': .45 } : {}), 'stroke-width': 1, rx: theme.smallRadius,
      ...(boxFrame ? { 'stroke-dasharray': '5 4' } : {}),
    }));
    if (boxFrame) {
      if (event.text || event.icon) addText(children, { x: x + w / 2, y: y - 10, lines: [event.text], icon: event.icon });
    } else if (event.type !== 'rect' || event.text || event.icon) {
      const label = event.type === 'rect' ? event.text : event.keyword + (event.text ? ' [' + event.text + ']' : '');
      addText(frame, { x: event.labelX ?? x + 8, y: y + 12, lines: [label], icon: event.icon, anchor: 'start' });
    }
    children.push({ ...ctx.el('g', {}, frame), meta: { kind: 'frame', id: `sequence-frame-${event.y}` } });
  };
  for (const event of layout.events) if (event.kind === 'open') paintFrame(event);
  for (const actor of layout.actors) children.push(line(actor.life.x, actor.life.y1, actor.life.x, actor.life.y2, { stroke: theme.line2, 'stroke-width': 1 }));
  for (const bar of layout.activations) if (bar.h > 0) children.push(ctx.rect(bar.x, bar.y, 10, bar.h, {
    fill: ctx.tint(theme.bg, sectionTone, .28), stroke: sectionTone, 'stroke-opacity': .45, 'stroke-width': 1,
  }));

  const actorAt = id => layout.actors.find(item => item.id === id);
  const creationRoutes = [];
  const boxes = layout.events.filter(event => event.kind === 'open' && event.type === 'box').map(event => event.box);
  for (const event of layout.events) {
    if (event.kind === 'section') {
      const { host } = event;
      if (!host?.box) continue;
      children.push(line(host.box.x, event.y + 4, host.box.x + host.box.w, event.y + 4, { stroke: theme.line, 'stroke-dasharray': '3 3' }));
      addText(children, { x: event.labelX ?? host.box.x + 8, y: event.y + 14, lines: [[event.keyword, event.text].filter(Boolean).join(' ')], icon: event.icon, anchor: 'start' });
    }
    if (event.kind === 'note') {
      const { x, y, w, h } = event.note, note = [];
      note.push(ctx.rect(x, y, w, h, { fill: theme.surface, stroke: theme.line2, 'stroke-width': 1, rx: theme.smallRadius }));
      const spans = event.place === 'over' && event.ids[0] !== event.ids.at(-1);
      addText(note, { x: spans ? x + w / 2 : x + 8, y: y + h / 2, lines: event.lines, icon: event.icon, anchor: spans ? 'middle' : 'start' });
      children.push(ctx.el('g', {}, note));
    }
    if (event.kind !== 'message') continue;
    const from = actorAt(event.from), to = actorAt(event.to);
    const y = event.y + event.lineOffset;
    const self = from === to;
    const dir = to.x >= from.x ? 1 : -1;
    const { head, start, dashed } = event.arrow;
    const color = theme[event.status] ?? theme.fg3;
    const lineAttrs = {
      stroke: color, 'stroke-width': 1.5, 'stroke-linecap': 'butt',
      ...(dashed ? { 'stroke-dasharray': '5 4' } : {}),
      ...(start ? { 'marker-start': `url(#${markerId(startHead(start), event.status)})` } : {}),
      ...(head === 'none' ? {} : { 'marker-end': `url(#${markerId(head, event.status)})` }),
    };
    const startX = event.centralStart ? from.x : event.fromBar ? event.fromBar.x + (dir > 0 ? 10 : 0) : from.x + dir * (self ? 6 : 8);
    const startY = self ? y - 14 : y, endY = self ? y + 4 : y;
    const hitsHead = event.create && endY >= to.head.y && endY <= to.head.y + to.head.h;
    const centralEnd = event.centralEnd && !event.create;
    const endX = hitsHead ? (dir > 0 ? to.head.x : to.head.x + to.head.w)
      : centralEnd || (head === 'cross' && event.destroy === to.id) ? to.x
        : !event.create && event.toBar ? event.toBar.x + (self || dir < 0 ? 10 : 0) : to.x - (self ? -1 : dir) * MESSAGE_END_GAP;
    const tipStart = startX + (event.centralStart && start ? dir * 7 : 0);
    const tipEnd = endX - (centralEnd && head !== 'none' ? (self ? -1 : dir) * 7 : 0);
    const route = self ? ctx.path(`M${tipStart} ${startY} h${40 + startX - tipStart} v18 H${tipEnd}`, { fill: 'none', ...lineAttrs })
      : line(tipStart, y, tipEnd, y, lineAttrs);
    // Paint attached arrows above the card outline so the tip stays visible at the join.
    (hitsHead ? creationRoutes : children).push({ ...route, meta: { kind: 'message', from: from.id, to: to.id } });
    const dot = (x, cy) => children.push(ctx.el('circle', { cx: x, cy, r: 3.5, fill: color }));
    if (event.centralStart) dot(startX, startY);
    if (centralEnd) dot(endX, endY);
    const x = self ? from.x + 52 : event.create ? (startX + endX) / 2 : (from.x + to.x) / 2;
    const labelY = self ? y - 20 - (event.lines.length - 1) * 8 : y - event.lines.length * 8 - 10;
    const ordinalY = y - (event.lines.length * 16 + (self ? 28 : 18));
    // Cross-group labels stay legible when they straddle a dashed box border.
    const labelLeft = self ? x : x - event.textW / 2;
    const labelRight = labelLeft + event.textW;
    const labelTop = (event.ordinal ? ordinalY : labelY - (event.lines.length - 1) * 8) - 7;
    const labelBottom = (event.lines.length ? labelY + (event.lines.length - 1) * 8 : ordinalY) + 7;
    if (event.textW && boxes.some(box => box.y < labelBottom && box.y + box.h > labelTop &&
      [box.x, box.x + box.w].some(edge => labelLeft - 2 < edge && edge < labelRight + 2))) {
      children.push(ctx.rect(labelLeft - 4, labelTop, event.textW + 8, labelBottom - labelTop, { fill: theme.bg, rx: theme.smallRadius }));
    }
    const meta = { kind: 'message-label', from: from.id, to: to.id };
    if (event.lines.length || event.icon) addText(children, { x, y: labelY, lines: event.lines, icon: event.icon, meta, anchor: self ? 'start' : 'middle' });
    if (event.ordinal) addText(children, { x, y: ordinalY, lines: [event.ordinal], meta, anchor: self ? 'start' : 'middle', fill: theme.fg3 });
    if (event.destroy && !(head === 'cross' && event.destroy === to.id)) {
      const dx = actorAt(event.destroy).x;
      children.push(ctx.path(`M${dx - 4} ${y - 4} l8 8 m0 -8 l-8 8`, { fill: 'none', stroke: theme.fg3, 'stroke-width': 1.5 }));
    }
  }
  for (const actor of layout.actors) for (const part of [actor.head, actor.foot].filter(Boolean)) {
    const group = [];
    const glyph = glyphs[actor.kind];
    const role = theme[actor.status];
    group.push(ctx.rect(part.x, part.y, part.w, part.h, { fill: role ? ctx.tint(theme.surface, role, .12) : theme.surface,
      stroke: role ? ctx.frameTone(role) : theme.line, 'stroke-width': 1, rx: theme.smallRadius }));
    if (actor.icon) group.push(drawIcon(actor.icon, actor.x, part.y + 16, theme.fg3));
    else if (glyph) group.push(ctx.path(glyph, { transform: `translate(${actor.x - 12} ${part.y + 6})`, fill: 'none', stroke: theme.fg3, 'stroke-width': 1.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    addText(group, { x: actor.x, y: part.y + part.h / 2 + (glyph || actor.icon ? 12 : 0), lines: part.lines,
      font: FONT.title, lineHeight: 18, fill: theme.fg1, underline: Boolean(actor.link) });
    const card = { ...ctx.el('g', {}, group), meta: { kind: 'participant', id: actor.id } };
    children.push(actor.link ? ctx.link(actor.link.href, [card], actor.link) : card);
  }
  children.push(...creationRoutes);
  return { width: layout.width, height: layout.height, children, title: layout.title, heading: layout.title };
}

export { LIMITS };
export const implementations = { sequenceDiagram: { parse, layout, scene, acceptsPresentation: true,
  honoredConfig: ['sequence.mirrorActors', 'sequence.showSequenceNumbers'] } };
