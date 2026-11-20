import { error, warning } from './support.js';
import { stripEmphasis } from './emphasis.js';
import { implementations as sequence, LIMITS } from './sequence.js';

const ID = '[\\p{L}\\p{N}_$][\\p{L}\\p{N}_$-]*';
const participant = new RegExp(`^(?:@(\\w+)\\s+)?(${ID})(?:\\s+as\\s+(.+))?$`, 'u');
const annotationCall = new RegExp(`^@(\\w+)\\s*\\(\\s*(${ID})\\s*\\)$`, 'u');
const asyncMessage = new RegExp(`^(${ID}?)\\s*(-->>|-->|->>|->|<<--|<--|<-|==>|=>|\\.\\.>)\\s*(${ID})\\s*:\\s*(.*)$`, 'u');
const call = new RegExp(`^(?:(?:[\\w.$<>\\[\\]]+\\s+)?(${ID})\\s*=\\s*)?(?:(${ID}?)\\s*->\\s*)?(${ID})\\.(${ID})(?:\\s*\\((.*)\\))?$`, 'u');
const creation = new RegExp(`^new\\s+(${ID})(?:\\s*\\((.*)\\))?$`, 'u');
const fragments = /^(while|for|foreach|loop|if|opt|par|try|else\s+if|else|catch|finally)\s*(?:\((.*)\))?$/iu;
const kinds = new Set(['actor', 'boundary', 'control', 'entity', 'database', 'collections', 'queue', 'participant']);
const STARTER = ':starter'; // Not a source-level identifier.
const MAX_LINES = 240, MAX_PARTICIPANTS = 40;

// Braces and semicolons delimit statements, except in arguments, quoted strings,
// or free-text labels. A free-text message or title runs to the end of its line.
function tokenize(lines, firstLine) {
  const tokens = [];
  for (const [index, raw] of lines.entries()) {
    const line = firstLine + index, text = raw.trim();
    let start = 0, quote = '', depth = 0;
    const push = value => { if (value.trim()) tokens.push({ text: value.trim(), line }); };
    if (/^title\s/i.test(text)) { push(text); continue; }
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = '';
      } else if (ch === '"' || (ch === "'" && depth)) quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (!depth) {
        if (ch === ':') break;
        if (ch === '/' && text[i + 1] === '/') {
          push(text.slice(start, i));
          push(text.slice(i));
          start = text.length;
          break;
        }
        if ('{};'.includes(ch)) {
          push(text.slice(start, i));
          if (ch !== ';') push(ch);
          start = i + 1;
        }
      }
    }
    push(text.slice(start));
  }
  return tokens;
}

function parse(source, info) {
  const { lang = 'zh', firstLine = 2 } = info;
  const actors = new Map(), statements = [], errors = [], stack = [], ignored = new Set();
  let title = info.title || '', comments = [], replyLine, ignoredLine, messages = 0;
  const bad = (line, zh, en, fixZh, fixEn) => errors.push(error(lang, line, zh, en, fixZh, fixEn));
  const unrecognized = (line, text) => bad(line, `无法识别 ZenUML 语句：「${text}」`, `Unrecognized ZenUML statement: "${text}"`,
    '例如：@Actor Client、Client->API: 请求 或 API.call()', 'For example: @Actor Client, Client->API: request, or API.call()');
  const touch = (id, line) => {
    if (!actors.has(id)) actors.set(id, { id, name: id === STARTER ? '' : id, kind: id === STARTER ? 'actor' : 'participant', line });
    return actors.get(id);
  };
  const caller = () => stack.findLast(item => item.call);
  const beginUnit = line => {
    const parent = stack.at(-1);
    if (parent?.keyword === 'par' && parent.units++) {
      const section = { type: 'section', keyword: '', line };
      parent.event.sections.push(section);
      statements.push(section);
    }
  };
  const addComment = (from, to, line) => {
    const text = stripEmphasis(comments.join('\n'));
    if (text) statements.push({ type: 'note', place: 'over', ids: from === to ? [from] : [from, to], text, line });
    comments = [];
  };
  const send = (from, to, text, line, extra = {}) => {
    touch(from, line).used = true;
    touch(to, line).used = true;
    messages++;
    statements.push({ type: 'message', from, to, text, line, arrow: { head: 'open', dashed: false }, ...extra });
  };
  const reply = (from, to, text, line) => send(from, to, text, line, { arrow: { head: 'open', dashed: true } });
  const finishCall = (entry, line) => {
    if (entry.assignment) reply(entry.to, entry.from, entry.assignment, line);
    statements.push({ type: 'deactivate', id: entry.to, line });
  };
  const missingBlock = line => bad(line, 'ZenUML 语句缺少花括号块', 'ZenUML statement is missing a brace block', '在语句后添加 { … }', 'Add { … } after the statement');
  const missingReply = line => bad(line, '回复注解后缺少消息', 'Expected a message after the reply annotation', '写成 @return A->B: 结果', 'Write @return A->B: result');

  for (const key of Object.keys(info.options || {})) bad(firstLine - 1, `ZenUML 头行不接受选项「${key}」`, `The ZenUML header does not accept option "${key}"`, '头行只保留 zenuml', 'Use only zenuml on the header line');
  const lines = String(source).split(/\r\n?|\n/u);
  if (lines.length > MAX_LINES) bad(firstLine + MAX_LINES, `ZenUML 正文超过 ${MAX_LINES} 行`, `ZenUML body exceeds ${MAX_LINES} lines`, '拆分为多张图', 'Split into several diagrams');
  const tokens = tokenize(lines.slice(0, MAX_LINES), firstLine);
  for (let i = 0; i < tokens.length; i++) {
    const { text, line } = tokens[i];
    if (text.startsWith('//')) { comments.push(text.slice(2).trim()); continue; }
    let syntax = text;
    const annotation = /^@(?:return|reply)(?:\s+(.*))?$/iu.exec(text);
    if (annotation) {
      if (replyLine) missingReply(replyLine);
      replyLine = line;
      if (!annotation[1]) continue;
      syntax = annotation[1];
    }
    let match = asyncMessage.exec(syntax);
    const isReply = Boolean(replyLine);
    if (replyLine && !match) missingReply(replyLine);
    replyLine = undefined;
    if (match) {
      const [, from, operator, to, label] = match;
      if (operator !== '->') {
        const example = `${from}->${to}: ${label}`;
        bad(line, `ZenUML 消息箭头写法无效：「${operator}」`, `Invalid ZenUML message arrow "${operator}"`,
          `异步消息用 ${example}；回复用 @return ${example} 或调用块内的 return`,
          `For an async message use ${example}; for a reply use @return ${example} or return inside a call block`);
      } else {
        beginUnit(line);
        addComment(from, to, line);
        if (isReply) reply(from, to, label, line);
        else send(from, to, label, line);
      }
    } else if (syntax === '}') {
      const entry = stack.at(-1);
      if (!entry) bad(line, 'ZenUML 多余的 }', 'Unexpected } in ZenUML', '删除多余的 }', 'Remove the unmatched }');
      else if (entry.call) { stack.pop(); finishCall(entry, line); }
      else {
        const next = tokens.slice(i + 1).find(token => !token.text.startsWith('//'));
        const branch = next && fragments.exec(next.text)?.[1].toLowerCase().replace(/\s+/g, ' ');
        const follows = entry.keyword === 'if' && entry.branch !== 'else' && (branch === 'else' || branch === 'else if') ||
          entry.keyword === 'try' && entry.branch !== 'finally' && (branch === 'catch' || branch === 'finally');
        if (follows) entry.awaitingBranch = true;
        else { stack.pop(); statements.push({ type: 'end', line }); }
      }
    } else if ((match = fragments.exec(syntax))) {
      const keyword = match[1].toLowerCase().replace(/\s+/g, ' '), label = match[2]?.trim() || '';
      const parent = stack.at(-1);
      const branch = /^(else|catch|finally)/u.test(keyword);
      if (tokens[i + 1]?.text !== '{') missingBlock(line);
      else if (branch && !parent?.awaitingBranch) unrecognized(line, syntax);
      else if (stack.length >= LIMITS.fragmentDepth && !branch) bad(line, 'ZenUML 块嵌套过深', 'ZenUML blocks are nested too deeply', '减少块的嵌套层数', 'Reduce block nesting');
      else {
        i++;
        if (branch) {
          const section = { type: 'section', keyword, text: label, line };
          parent.event.sections.push(section);
          statements.push(section);
          Object.assign(parent, { branch: keyword, awaitingBranch: false });
        } else {
          beginUnit(line);
          const display = keyword === 'if' ? 'alt' : /^(while|for|foreach)$/u.test(keyword) ? 'loop' : keyword;
          const event = { type: 'fragment', keyword: display, text: label, sections: [], line };
          statements.push(event);
          stack.push({ event, keyword, line, units: 0 });
        }
      }
    } else if ((match = /^return(?:\s+(.*))?$/u.exec(syntax))) {
      const entry = caller();
      if (!entry) bad(line, 'return 应放在 ZenUML 同步调用块内', 'Put return inside a ZenUML synchronous call block', '在调用的 { … } 内使用 return，或用 @return A->B: 结果', 'Use return inside the call’s { … }, or use @return A->B: result');
      else {
        beginUnit(line);
        addComment(entry.to, entry.from, line);
        reply(entry.to, entry.from, match[1] || '', line);
      }
    } else if ((match = creation.exec(syntax))) {
      const [, to, args] = match, from = caller()?.to || STARTER;
      const target = touch(to, line);
      if (target.used || from === to) bad(line, `应在首次使用「${to}」前创建它`, `Create "${to}" before its first message`, '将 new 移到该参与者的其他消息前', 'Move new before other messages involving this participant');
      else {
        beginUnit(line);
        addComment(from, to, line);
        send(from, to, args?.trim() ? `«${args.trim()}»` : '«create»', line, { create: to, activateOn: to, arrow: { head: 'open', dashed: true } });
        finishCall({ to }, line);
      }
    } else if ((match = call.exec(syntax))) {
      const [, assignment, explicit, to, method, args] = match, from = explicit || caller()?.to || STARTER;
      beginUnit(line);
      addComment(from, to, line);
      send(from, to, args === undefined ? method : `${method}(${args})`, line, { activateOn: to, arrow: { head: 'arrow', dashed: false } });
      const entry = { call: true, from, to, assignment, line };
      if (tokens[i + 1]?.text !== '{') finishCall(entry, line);
      else if (stack.length >= LIMITS.fragmentDepth) bad(line, 'ZenUML 块嵌套过深', 'ZenUML blocks are nested too deeply', '减少块的嵌套层数', 'Reduce block nesting');
      else { i++; stack.push(entry); }
    } else if ((match = /^title\s+(.+)$/iu.exec(syntax))) {
      if (title) bad(line, 'ZenUML 标题重复', 'Duplicate ZenUML title', '只保留一个 title 或前置元数据标题', 'Keep one title statement or front-matter title');
      else title = match[1];
    } else if (/^@(?:startuml|enduml)$/iu.test(syntax)) {
      // Preserve the legacy wrappers.
    } else if ((match = annotationCall.exec(syntax))) {
      const form = `@${match[1]} ${match[2]}`;
      bad(line, `ZenUML 参与者注解写法无效：「${syntax}」`, `Invalid ZenUML participant annotation "${syntax}"`, `去掉括号，写成 ${form}`, `Remove the parentheses: ${form}`);
    } else if ((match = participant.exec(syntax))) {
      const [, type, id, name] = match, actor = touch(id, line);
      const kind = type?.toLowerCase() || 'participant';
      if (actor.declared) bad(line, `ZenUML 参与者「${id}」重复声明`, `Duplicate ZenUML participant "${id}"`, '删除重复声明', 'Remove the duplicate declaration');
      else Object.assign(actor, { declared: true, name: name?.replace(/^(["'])(.*)\1$/u, '$2') || id, kind: kinds.has(kind) ? kind : 'participant', line });
      if (!kinds.has(kind)) { ignored.add(`@${type}`); ignoredLine ??= line; }
    } else unrecognized(line, syntax);
    comments = [];
  }
  if (replyLine) missingReply(replyLine);
  for (const entry of stack) bad(entry.line, 'ZenUML 块缺少 }', 'ZenUML block is missing }', '添加匹配的 }', 'Add a matching }');
  if (!actors.size && !errors.length) bad(firstLine, 'ZenUML 缺少参与者', 'ZenUML needs at least one participant', '添加参与者 Client 或消息 Client->API: 请求', 'Add a participant Client or a message Client->API: request');
  const participants = [...actors.values()];
  if (participants.length > MAX_PARTICIPANTS) bad(participants[MAX_PARTICIPANTS].line, `ZenUML 参与者超过 ${MAX_PARTICIPANTS} 个`, `ZenUML has more than ${MAX_PARTICIPANTS} participants`, '拆分为多张图', 'Split into several diagrams');
  if (ignored.size) {
    const names = [...ignored].join(', ');
    errors.push(warning('DIAGRAM_HINT', lang, ignoredLine, `以下注解使用普通参与者外观：${names}`, `Using standard participants for these annotations: ${names}`, '如需图标，使用受支持的参与者类型', 'Use a supported participant type if an icon is needed'));
  }
  // The implicit caller has its own leftmost lifeline, not a self-call on the callee.
  if (actors.has(STARTER)) participants.unshift(participants.splice(participants.indexOf(actors.get(STARTER)), 1)[0]);
  participants.forEach((actor, index) => { actor.index = index; });
  return { model: { type: 'sequence', title, participants, statements, messages, zenuml: true }, errors };
}

const shared = sequence.sequenceDiagram;
export const implementations = { zenuml: {
  parse,
  layout: (model, options, info) => shared.layout(model, { ...options, compact: true }, { ...info, config: { sequence: { mirrorActors: false } } }),
  scene: shared.scene,
} };
