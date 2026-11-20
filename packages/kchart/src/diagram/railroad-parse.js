import { error, warning } from './support.js';

const terminal = value => ({ type: 'terminal', value });
const reference = (name, token) => ({ type: 'nonterminal', name, line: token.line, column: token.column });
const special = text => ({ type: 'special', text });
const optional = element => ({ type: 'optional', element });
const repetition = (element, min, max = Infinity) => ({ type: 'repetition', element, min, max });
const sequence = elements => elements.length === 1 ? elements[0] : { type: 'sequence', elements };
const choice = alternatives => alternatives.length === 1 ? alternatives[0] : { type: 'choice', alternatives };
const childrenOf = node => node.elements || node.alternatives || (node.element ? [node.element] : []);
const unescape = text => text.replace(/\\(.)/g, (_, ch) => ({ n: '\n', r: '\r', t: '\t' })[ch] ?? ch);
const CAP = 2000;
const DEPTH = 24;

class RailroadSyntax extends Error {
  constructor(diagnostic) { super(diagnostic.message); this.diagnostic = diagnostic; }
}

function reader(body, info, dialect) {
  const abnf = dialect === 'abnf';
  const patterns = [
    ['hidden', /\s+|%%[^\n]*/y],
    ...(dialect === 'ir' || dialect === 'ebnf' ? [['hidden', /\/\*[\s\S]*?\*\//y]] : []),
    ...(dialect === 'ebnf' ? [['hidden', /\(\*[\s\S]*?\*\)/y], ['special', /\?(?=[^?;]*[^?\s;][^?;]*\?)[^?;]*\?/y]] : []),
    ...(dialect === 'peg' ? [['hidden', /#[^\n]*/y]] : []),
    ['title', /title[\t ]+(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|[^\n]*?)(?=[\t ]*(?:%%|\n|$))/y],
    ['accessibility', /accTitle[\t ]*:[^\n]*|accDescr(?:[\t ]*:[^\n]*|\s*\{[^}]*\})/y],
    ['string', abnf ? /"[^"]*"/y : /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/y],
    ...(abnf ? [['numeric', /%[xXdDbB][0-9A-Fa-f]+(?:-[0-9A-Fa-f]+|\.[0-9A-Fa-f]+)*/y], ['repeat', /[0-9]*\*[0-9]*|[0-9]+/y]] : []),
    ['id', abnf ? /[A-Za-z][A-Za-z0-9-]*/y : /[A-Za-z_][\w-]*/y],
    ['punctuation', /::=|<-|[\s\S]/y],
  ];
  let offset = 0, line = info.firstLine ?? 2, column = 1, token;
  function advance(raw) {
    offset += raw.length;
    const rows = raw.split('\n');
    line += rows.length - 1;
    column = rows.length === 1 ? column + raw.length : rows.at(-1).length + 1;
  }
  function peek() {
    while (!token) {
      if (offset === body.length) return { kind: 'end', value: '', line, column };
      for (const [kind, pattern] of patterns) {
        pattern.lastIndex = offset;
        const raw = pattern.exec(body)?.[0];
        if (!raw) continue;
        const value = kind === 'string' ? (abnf ? raw.slice(1, -1) : unescape(raw.slice(1, -1))) : raw;
        if (kind !== 'hidden') token = { kind: kind === 'punctuation' ? raw : kind, value, line, column };
        advance(raw);
        break;
      }
    }
    return token;
  }
  function fail(code, zh, en, fixZh, fixEn, at = peek()) {
    throw new RailroadSyntax({ ...error(info.lang, at.line, zh, en, fixZh, fixEn, at.column), code: `railroad.${code}` });
  }
  function take(kind) {
    const next = peek();
    if (next.kind !== kind) return null;
    token = undefined;
    return next;
  }
  function expect(kind, code = 'unexpected-token') {
    const next = take(kind);
    if (next) return next;
    if (['"', "'"].includes(peek().kind) && !(abnf && peek().kind === "'")) {
      fail('unterminated-string', '字符串未闭合', 'Unterminated string', '添加对应的结束引号', 'Add the matching closing quote');
    }
    fail(code, `应为「${kind}」`, `Expected ${kind}`, `在此处使用「${kind}」`, `Use ${kind} here`);
  }
  function checkDepth(depth) {
    if (depth > DEPTH) fail('depth-limit', '语法轨道嵌套过深', 'Railroad nesting is too deep', '将嵌套部分提取为规则', 'Extract nested expressions into rules');
  }
  function commentTail() {
    // After a rule terminator another assignment can start on the same line.
    if (!/^[\t ]*[A-Za-z][A-Za-z0-9-]*[\t ]*=/.test(body.slice(offset))) advance(/^[^\n]*/.exec(body.slice(offset))[0]);
  }
  return { peek, take, expect, fail, checkDepth, commentTail };
}

function expression(r, dialect, hints) {
  const ebnf = dialect === 'ebnf', abnf = dialect === 'abnf', peg = dialect === 'peg';
  const groups = ebnf ? ['(', '[', '{'] : abnf ? ['(', '['] : ['('];
  const factorKinds = ['id', 'string', ...groups, ...(ebnf ? ['special'] : abnf ? ['numeric', 'repeat'] : ['&', '!', '.'])];
  const choiceOp = ebnf ? '|' : '/';
  function primary(depth) {
    const token = r.peek();
    if (r.take('string') || (abnf && r.take('numeric'))) return terminal(token.value);
    if (r.take('id')) return reference(token.value, token);
    if (ebnf && r.take('special')) return special(token.value.slice(1, -1).trim());
    if (peg && r.take('.')) return special('.');
    if (groups.includes(token.kind)) {
      r.take(token.kind);
      const node = alternatives(depth + 1);
      r.expect({ '(': ')', '[': ']', '{': '}' }[token.kind]);
      return token.kind === '[' ? optional(node) : token.kind === '{' ? repetition(node, 0) : node;
    }
    mismatch();
    r.expect('string');
  }
  function mismatch() {
    const kind = r.peek().kind;
    if (abnf && ['|', '+', '?', "'", '{'].includes(kind)) {
      r.fail('abnf-unsupported', '此写法不属于 ABNF', 'This syntax is not ABNF', '使用 /、双引号和前置重复次数', 'Use /, double quotes and a repeat prefix');
    }
    if (peg && ['[', '{', '-', '|'].includes(kind)) {
      r.fail('peg-unsupported', '此写法不属于 PEG', 'This syntax is not PEG', '使用 /、圆括号和后置 ?、*、+', 'Use /, parentheses and postfix ?, *, +');
    }
  }
  function factor(depth) {
    const start = r.peek();
    const count = abnf && r.take('repeat');
    const predicate = peg && (r.take('&') || r.take('!'));
    let node = primary(depth);
    if (count) {
      const [lo, hi] = count.value.split('*');
      const min = Number(lo), max = hi === undefined ? min : hi === '' ? Infinity : Number(hi);
      if (!Number.isSafeInteger(min) || (max !== Infinity && !Number.isSafeInteger(max)) || min > max) {
        r.fail('abnf-bad-repeat', '无效的 ABNF 重复次数', 'Invalid ABNF repetition bounds', '使用递增的整数范围', 'Use an ascending integer range', count);
      }
      node = min === 0 && max === 1 ? optional(node) : repetition(node, min, max);
    }
    if (ebnf || peg) {
      let postfixes = 0;
      do {
        if (r.take('?')) node = optional(node);
        else if (r.take('*')) node = repetition(node, 0);
        else if (r.take('+')) node = repetition(node, 1);
        else if (ebnf && r.take('-')) node = sequence([node, { ...terminal('-'), exception: true }, primary(depth)]);
        else break;
        r.checkDepth(depth + ++postfixes);
      } while (ebnf);
    }
    if (predicate) {
      const label = node.type === 'terminal' ? JSON.stringify(node.value) : node.name ?? node.text;
      if (label === undefined) hints.push({ type: 'predicate', ...start });
      return special(predicate.value + (label ?? '(...)'));
    }
    return node;
  }
  function alternatives(depth) {
    r.checkDepth(depth);
    const lanes = [];
    do {
      const elements = [factor(depth)];
      while ((ebnf && r.take(',')) || factorKinds.includes(r.peek().kind)) elements.push(factor(depth));
      mismatch();
      lanes.push(sequence(elements));
    } while (r.take(choiceOp));
    return choice(lanes);
  }
  return alternatives(1);
}

const constructors = new Map(Object.entries({ terminal, nonterminal: reference, special, optional, sequence, choice,
  zeroOrMore: node => repetition(node, 0), oneOrMore: node => repetition(node, 1) }));
function irExpression(r, depth = 1) {
  r.checkDepth(depth);
  const name = r.expect('id');
  const build = constructors.get(name.value);
  if (!build) r.fail('ir-unknown-constructor', `未知构造器「${name.value}」`, `Unknown constructor ${name.value}`,
    `使用 ${[...constructors.keys()].join('、')}`, `Use ${[...constructors.keys()].join(', ')}`, name);
  r.expect('(');
  if (r.peek().kind === ')') r.fail('ir-arity', '构造器缺少参数', 'Constructor has no arguments', '添加构造器参数', 'Add a constructor argument');
  let node;
  if (['terminal', 'nonterminal', 'special'].includes(name.value)) {
    const token = r.expect('string');
    node = build(token.value, token);
  } else if (['sequence', 'choice'].includes(name.value)) {
    const args = [];
    do { args.push(irExpression(r, depth + 1)); } while (r.take(','));
    node = build(args);
  } else node = build(irExpression(r, depth + 1));
  r.expect(')', 'ir-arity');
  return node;
}

function parseRules(body, info, dialect) {
  // The registry normally treats the header suffix as options; here it is grammar text.
  if (info.params) {
    body = ' '.repeat(info.header.lastIndexOf(info.params)) + info.params + '\n' + body;
    info = { ...info, firstLine: info.headerLine };
  }
  const rules = [], errors = [], hints = [];
  let title, accTitle, accDescr, count = 0;
  const r = reader(body, info, dialect);
  const abnf = dialect === 'abnf';
  const key = name => abnf ? name.toLowerCase() : name;
  try {
    if (body.length > 200000) r.fail('source-limit', '语法文本过长', 'Railroad source is too large', '拆分语法图', 'Split the grammar into diagrams');
    while (r.peek().kind !== 'end') {
      if (abnf && r.take(';')) { r.commentTail(); continue; }
      const heading = r.take('title');
      if (heading) {
        const raw = heading.value.slice(5).trim();
        title = /^["']/.test(raw) && raw.at(-1) === raw[0] ? unescape(raw.slice(1, -1)) : raw;
        continue;
      }
      const accessibility = r.take('accessibility');
      if (accessibility) {
        const raw = accessibility.value;
        if (raw.startsWith('accTitle')) accTitle = raw.slice(raw.indexOf(':') + 1).trim();
        else if (/^accDescr\s*\{/.test(raw)) accDescr = raw.slice(raw.indexOf('{') + 1, -1).trim();
        else accDescr = raw.slice(raw.indexOf(':') + 1).trim();
        continue;
      }
      const name = r.expect('id');
      if (dialect === 'peg') r.expect('<-', 'peg-bad-operator');
      else if (!(dialect === 'ebnf' && r.take('::='))) r.expect('=');
      const definition = dialect === 'ir' ? irExpression(r) : expression(r, dialect, hints);
      r.expect(';', 'rule-expected');
      if (abnf) r.commentTail();
      const stack = [[definition, 1]];
      while (stack.length) {
        const [node, depth] = stack.pop();
        if (++count > CAP) r.fail('node-limit', '语法图节点过多', 'Too many railroad nodes', '拆分语法图', 'Split the grammar into diagrams', name);
        if (depth > DEPTH) r.fail('depth-limit', '语法轨道嵌套过深', 'Railroad nesting is too deep', '将嵌套部分提取为规则', 'Extract nested expressions into rules', name);
        for (const child of childrenOf(node)) stack.push([child, depth + 1]);
      }
      rules.push({ name: name.value, line: name.line, column: name.column, definition });
    }
  } catch (cause) {
    if (!(cause instanceof RailroadSyntax)) throw cause;
    return { model: null, errors: [cause.diagnostic] };
  }
  const names = new Set(), missing = new Set(), duplicates = new Set();
  const hint = (at, zh, en, fixZh, fixEn) => errors.push(warning('DIAGRAM_HINT', info.lang, at.line, zh, en, fixZh, fixEn, at.column));
  for (const rule of rules) {
    const name = key(rule.name);
    if (names.has(name) && !duplicates.has(name)) {
      duplicates.add(name);
      hint(rule, `规则「${rule.name}」重复`, `Duplicate rule ${rule.name}`, '合并重复规则', 'Combine duplicate rules');
    }
    names.add(name);
  }
  for (const rule of rules) {
    const stack = [rule.definition];
    while (stack.length) {
      const node = stack.pop();
      if (node.type === 'nonterminal' && !names.has(key(node.name))) {
        node.undefined = true;
        if (!missing.has(key(node.name))) {
          missing.add(key(node.name));
          hint(node, `未定义规则「${node.name}」`, `Undefined rule ${node.name}`, '定义该规则或检查拼写', 'Define the rule or check its spelling');
        }
      }
      stack.push(...childrenOf(node).slice().reverse());
    }
  }
  if (hints.length) hint(hints[0], '复合前瞻显示为 (…)','Compound lookahead is shown as (...)', '用命名规则显示前瞻目标', 'Use a named rule to show the lookahead target');
  return { model: { rules, title, accTitle, accDescr, count }, errors };
}

const parseEbnf = (body, info) => parseRules(body, info, 'ebnf');
const parseAbnf = (body, info) => parseRules(body, info, 'abnf');
const parsePeg = (body, info) => parseRules(body, info, 'peg');
const parseIr = (body, info) => parseRules(body, info, 'ir');

export { childrenOf, parseEbnf, parseAbnf, parsePeg, parseIr };
