import { error, warning } from './support.js';
const quoteValue = value => {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
};
const issue = (lang, line, column, zh, en, fixZh, fixEn) => ({ ...error(lang, line, zh, en, fixZh, fixEn, column), severity: 'error' });
const tokensOf = value => {
  const tokens = [];
  let token = '', quote = '', escaped = false;
  for (const char of String(value ?? '')) {
    if (escaped) { token += char; escaped = false; continue; }
    if (char.charCodeAt(0) === 92 && quote) { token += char; escaped = true; continue; }
    if (quote) {
      token += char;
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") { quote = char; token += char; }
    else if (char.trim() === '') { if (token) tokens.push(token); token = ''; }
    else token += char;
  }
  if (token) tokens.push(token);
  return tokens;
};

function parseOptions(params, { lang, line = 1 } = {}) {
  const options = {}, errors = [];
  const tokens = Array.isArray(params) ? params : tokensOf(params);
  for (const token of tokens) {
    const match = /^([A-Za-z][\w-]*)(?:=(.*))?$/.exec(String(token));
    if (!match) {
      errors.push(issue(lang, line, 1, `无效的图选项「${token}」`, `Invalid diagram option "${token}"`, '使用 key=value 或单独的选项名', 'Use key=value or a bare option name'));
      continue;
    }
    const key = match[1];
    if (Object.hasOwn(options, key)) {
      errors.push(issue(lang, line, 1, `图选项「${key}」重复`, `Duplicate diagram option "${key}"`, '每个图选项只写一次', 'Use each diagram option once'));
      continue;
    }
    options[key] = match[2] === undefined ? true : quoteValue(match[2]);
  }
  return { options, errors };
}

const isMap = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const set = (obj, key, value) => Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
const keyOf = (obj, key) => Object.hasOwn(obj, key) ? key : Object.keys(obj).find(name => name.toLowerCase() === key.toLowerCase()) ?? key;
const pathOf = (path, key) => path ? `${path}.${key.toLowerCase()}` : key.toLowerCase();
const invalidAt = (line, column = 1) => Object.assign(new SyntaxError(), { line, column });
const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
// Mermaid's Langium grammars for these kinds also accept the keyword glued to a colon (`gitGraph:`); others reject it.
const COLON_HEADERS = new Set(['gitgraph', 'cynefin-beta', 'radar-beta']);

function yamlScalar(text) {
  if (/^(?:null|~)$/i.test(text)) return null;
  if (/^(?:true|false)$/i.test(text)) return text.toLowerCase() === 'true';
  return number.test(text) ? Number(text) : text;
}

// Flow collections share a cursor with quoted scalars; directives use JSON grammar plus single quotes.
function flow(text, firstLine, positions, json = false, firstColumn = 1, offset = 0) {
  let i = offset, line = firstLine, column = firstColumn;
  const take = () => { const char = text[i++]; if (char === '\n') { line++; column = 1; } else column++; return char; };
  const fail = () => { throw invalidAt(line, column); };
  const space = () => {
    while (i < text.length) {
      if (/\s/.test(text[i])) take();
      else if (!json && text[i] === '#') { while (i < text.length && text[i] !== '\n') take(); }
      else break;
    }
  };
  function quoted() {
    const quote = take();
    let value = '';
    while (i < text.length) {
      const char = take();
      if (char === quote) {
        if (!json && quote === "'" && text[i] === "'") { value += take(); continue; }
        return value;
      }
      if (char === '\\' && (json || quote === '"')) {
        const escape = take();
        if (escape === "'" && quote === "'") { value += escape; continue; }
        if (!json && escape === '\n') { space(); continue; }
        let code = escape;
        if (escape === 'u') for (let j = 0; j < 4; j++) code += take();
        try { value += JSON.parse(`"\\${code}"`); } catch { fail(); }
      } else if (char === '\n' && !json) {
        let breaks = 1;
        while (i < text.length && /\s/.test(text[i])) if (take() === '\n') breaks++;
        value = value.trimEnd() + (breaks === 1 ? ' ' : '\n'.repeat(breaks - 1));
      } else {
        if (json && char < ' ') fail();
        value += char;
      }
    }
    fail();
  }
  function plain(key) {
    const start = i;
    while (i < text.length && !/[\n,[\]{}]/.test(text[i]) && !(key && text[i] === ':') &&
      !(!json && text[i] === '#' && (i === start || /\s/.test(text[i - 1])))) take();
    const value = text.slice(start, i).trim();
    if (!value || (!json && /:(?:\s|$)/.test(value))) fail();
    return value;
  }
  function read(path, depth = 0) {
    if (depth > 200) fail();
    space();
    const char = text[i];
    if (char === '"' || char === "'") return quoted();
    if (char !== '{' && char !== '[') {
      const token = plain(false);
      if (!json) return yamlScalar(token);
      try { return JSON.parse(token); } catch { fail(); }
    }
    take(); space();
    const map = char === '{', end = map ? '}' : ']', result = map ? {} : [];
    while (text[i] !== end) {
      if (map) {
        const at = line, col = column;
        const key = ['"', "'"].includes(text[i]) ? quoted() : json ? fail() : plain(true);
        space();
        if (text[i] !== ':') fail();
        take(); space();
        if (Object.hasOwn(result, key)) throw invalidAt(at, col);
        const child = pathOf(path, key);
        positions.set(child, at);
        set(result, key, !json && [',', end].includes(text[i]) ? null : read(child, depth + 1));
      } else result.push(read(pathOf(path, String(result.length)), depth + 1));
      space();
      if (text[i] === end) break;
      if (text[i] !== ',') fail();
      take(); space();
      if (json && text[i] === end) fail();
    }
    take();
    return result;
  }
  const value = read('');
  if (json) { space(); if (i !== text.length) fail(); }
  else {
    const end = text.indexOf('\n', i);
    if (!/^\s*(?:#.*)?$/.test(text.slice(i, end === -1 ? text.length : end))) fail();
  }
  return { value, rows: line - firstLine + 1 };
}

function yaml(lines, firstLine) {
  const positions = new Map();
  const source = lines.join('\n');
  let offset = 0;
  const rows = lines.map((raw, i) => {
    const text = raw.trimStart(), row = { text, indent: raw.length - text.length, line: firstLine + i, offset };
    offset += raw.length + 1;
    return row;
  });
  let i = 0;
  const skip = () => { while (i < rows.length && /^(?:#|$)/.test(rows[i].text)) i++; };
  const pair = /^("(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[^"'\s[\]{},][^:]*?):(?=\s|$)\s*(.*)$/;
  const sequence = /^-(?:\s+|$)/;
  function value(text, row, path, depth, column, sameIndentSequence = false) {
    if (/^(?:#|$)/.test(text)) {
      skip();
      const next = rows[i];
      return next && (next.indent > row.indent || (sameIndentSequence && next.indent === row.indent && sequence.test(next.text)))
        ? block(next.indent, path, depth + 1) : null;
    }
    if (/^["'[{]/.test(text)) {
      const local = new Map();
      const parsed = flow(source, row.line, local, false, column, row.offset + column - 1);
      i += parsed.rows - 1;
      for (const [key, line] of local) positions.set(pathOf(path, key), line);
      return parsed.value;
    }
    const plain = text.replace(/\s+#.*$/, '').trimEnd();
    if (/:(?:\s|$)|^[>|&*!]/.test(plain)) throw invalidAt(row.line, column);
    return yamlScalar(plain);
  }
  function block(indent, path, depth) {
    const list = sequence.test(rows[i].text), result = list ? [] : {};
    if (depth > 200) throw invalidAt(rows[i].line, indent + 1);
    while (i < rows.length && rows[i].indent === indent && sequence.test(rows[i].text) === list) {
      const row = rows[i++], { text, line } = row;
      if (/^ *\t/.test(lines[line - firstLine])) throw invalidAt(line, indent + 1);
      if (list) {
        const prefix = sequence.exec(text)[0].length, rest = text.slice(prefix), child = pathOf(path, String(result.length));
        positions.set(child, line);
        if (pair.test(rest) || sequence.test(rest)) {
          rows[--i] = { ...row, text: rest, indent: indent + prefix };
          result.push(block(indent + prefix, child, depth + 1));
        } else result.push(value(rest, row, child, depth, indent + prefix + 1));
      } else {
        const match = pair.exec(text);
        if (!match) throw invalidAt(line, indent + 1);
        const rawKey = match[1].trimEnd();
        const key = /^["']/.test(rawKey) ? flow(rawKey, line, new Map()).value : rawKey;
        if (Object.hasOwn(result, key)) throw invalidAt(line, indent + 1);
        const child = pathOf(path, key);
        positions.set(child, line);
        set(result, key, value(match[2], row, child, depth, indent + text.length - match[2].length + 1, true));
      }
      skip();
    }
    return result;
  }
  skip();
  if (!rows[i]) return { value: {}, positions };
  const row = rows[i];
  const result = row.text.startsWith('{') ? value(rows[i++].text, row, '', 0, row.indent + 1) : block(row.indent, '', 0);
  skip();
  if (rows[i]) throw invalidAt(rows[i].line, rows[i].indent + 1);
  return { value: result, positions };
}

function mergeConfig(target, incoming, positions, configLines, path = '') {
  const names = new Map(Object.keys(target).map(key => [key.toLowerCase(), key]));
  for (const [name, value] of Object.entries(incoming)) {
    const lower = name.toLowerCase(), key = names.get(lower) ?? name, child = pathOf(path, name);
    names.set(lower, name);
    const before = Object.hasOwn(target, key) ? target[key] : undefined;
    if (key !== name) delete target[key];
    configLines.set(child, positions.get(child));
    if (before && typeof before === 'object' && !(isMap(before) && isMap(value))) {
      for (const nested of configLines.keys()) if (nested.startsWith(`${child}.`)) configLines.delete(nested);
    }
    if (isMap(value)) {
      const section = isMap(before) ? before : {};
      mergeConfig(section, value, positions, configLines, child);
      set(target, name, section);
    } else {
      if (Array.isArray(value)) for (const [nested, line] of positions) if (nested.startsWith(`${child}.`)) configLines.set(nested, line);
      set(target, name, value);
    }
  }
}

// Find comment markers and directive terminators without interpreting quoted text as syntax.
function marker(text, needle, quote = '') {
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = '';
    } else if (text.startsWith(needle, i)) return { index: i, quote };
    else if (char === '"' || (char === "'" && !/[\w]/.test(text[i - 1] || ''))) quote = char;
  }
  return { index: -1, quote };
}

// Collapse explicit Mermaid Markdown strings, then pad merged physical rows so later diagnostics retain source lines.
function normalizeMarkdown(source) {
  const pattern = /"`([\s\S]*?)`"/g;
  let result = '', cursor = 0, match;
  while ((match = pattern.exec(source))) {
    const lineBreaks = (match[0].match(/\n/g) || []).length;
    const text = match[1].replace(/\*\*([\s\S]*?)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
      .replaceAll('"', '&quot;').replaceAll('\n', '<br/>');
    const replacement = `"${text}"`;
    result += source.slice(cursor, match.index);
    if (!lineBreaks) {
      result += replacement;
      cursor = pattern.lastIndex;
      continue;
    }
    const lineEnd = source.indexOf('\n', pattern.lastIndex);
    const end = lineEnd < 0 ? source.length : lineEnd;
    result += replacement + source.slice(pattern.lastIndex, end) + '\n'.repeat(lineBreaks);
    cursor = end;
    pattern.lastIndex = end;
  }
  return result + source.slice(cursor);
}

// keepsTrailingComments(kind): some Mermaid grammars (gantt) lex `%%` after statement text as part of the value.
function prepareSource(source, { syntax = 'mermaid', lang, keepsTrailingComments = () => false } = {}) {
  const original = String(source ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = original.split('\n');
  const errors = [], config = {}, configLines = new Map(), ignored = new Map();
  let start = 0, title, accTitle, accDescr;
  const ignore = (subject, line) => { if (!ignored.has(subject)) ignored.set(subject, line); };
  const apply = (value, positions) => mergeConfig(config, value, positions, configLines);

  while (start < lines.length && !lines[start].trim()) start++;
  if (lines[start]?.trim() === '---') {
    const opener = start;
    const close = lines.findIndex((text, i) => i > opener && /^\s*(?:---|\.\.\.)\s*(?:#.*)?$/.test(text));
    if (close < 0) errors.push(issue(lang, opener + 1, lines[opener].indexOf('---') + 1, '前言区缺少结束标记 --- 或 ...', 'Front matter is missing closing --- or ...', '在前言区末尾添加 ---', 'Add --- at the end of the front matter'));
    else {
      try {
        const { value, positions } = yaml(lines.slice(opener + 1, close), opener + 2);
        if (!isMap(value)) throw invalidAt(opener + 2);
        for (const [key, entry] of Object.entries(value)) {
          const name = key.toLowerCase(), line = positions.get(name);
          if (name === 'title') {
            if (entry != null && typeof entry === 'object') throw invalidAt(line);
            title = entry == null ? '' : String(entry);
          } else if (name === 'config') {
            if (entry != null && !isMap(entry)) throw invalidAt(line);
            if (entry) apply(entry, new Map([...positions].filter(([path]) => path.startsWith('config.')).map(([path, at]) => [path.slice(7), at])));
          } else if (name !== 'displaymode') ignore(key, line);
        }
        const displayMode = keyOf(value, 'displayMode');
        if (Object.hasOwn(value, displayMode)) {
          const at = positions.get('displaymode');
          apply({ [keyOf(config, 'gantt')]: { displayMode: value[displayMode] } }, new Map([['gantt', configLines.get('gantt') ?? at], ['gantt.displaymode', at]]));
        }
      } catch (err) {
        if (!(err instanceof SyntaxError)) throw err;
        errors.push(issue(lang, err.line ?? opener + 2, err.column, '无效的 YAML 前言', 'Invalid YAML front matter', '检查前言的缩进、引号及键值对', 'Check front matter indentation, quotes, and key-value pairs'));
      }
      start = close + 1;
    }
  }

  const trailing = new Map();
  if (syntax === 'mermaid') {
    let quote = '';
    for (let i = start; i < lines.length; i++) {
      const raw = lines[i];
      const found = marker(raw, '%%', quote);
      quote = found.quote;
      if (found.index < 0) continue;
      lines[i] = raw.slice(0, found.index).trimEnd();
      if (!raw.startsWith('%%{', found.index)) {
        if (lines[i].trim()) trailing.set(i, raw);
        continue;
      }
      const at = i + 1;
      let end = i, text = raw.slice(found.index + 3), close = marker(text, '}%%');
      // Recover a closing delimiter even if invalid JSON leaves a quote open.
      let fallback = close.quote ? text.indexOf('}%%') : -1;
      while (close.index < 0 && fallback < 0 && end + 1 < lines.length && !/^\s*%%\{/.test(lines[end + 1])) {
        close = marker(lines[++end], '}%%', close.quote);
        if (close.quote) fallback = lines[end].indexOf('}%%');
      }
      if (close.index < 0) close.index = fallback;
      if (close.index < 0) { ignore('%%{…}%%', at); continue; }
      if (end === i) {
        const suffix = text.slice(close.index + 3);
        if (suffix.trim()) lines[i] = raw.slice(0, found.index) + suffix;
        text = text.slice(0, close.index);
      } else {
        text = [text, ...lines.slice(i + 1, end), lines[end].slice(0, close.index)].join('\n');
        lines.fill('', i + 1, end);
        lines[end] = lines[end].slice(close.index + 3);
      }
      i = end - 1;
      const name = /^\s*([\w-]+)/.exec(text)?.[1];
      const init = /^\s*(?:init|initialize)\s*:/i.exec(text);
      if (/^\s*wrap\s*$/i.test(text)) apply({ wrap: true }, new Map([['wrap', at]]));
      else if (init) {
        try {
          const positions = new Map();
          const parsed = flow(text.slice(init[0].length), at + (init[0].match(/\n/g) || []).length, positions, true).value;
          if (!isMap(parsed)) throw invalidAt(at);
          apply(parsed, positions);
        } catch (err) {
          if (!(err instanceof SyntaxError)) throw err;
          ignore(`%%{${name}}%%`, at);
        }
      } else ignore(`%%{${name || '…'}}%%`, at);
    }
  }
  while (start < lines.length && !lines[start].trim()) start++;

  let header = '', headerLine = 0, firstLine = start + 1, bodyStart = start;
  const first = lines[start] || '';
  // Split only at the first word. Keep the complete original header and raw remainder for optionMode dispatch.
  let head = /^\s*([A-Za-z][\w-]*)(?=\s|;|:|$)(.*)$/.exec(first);
  if (head?.[2].startsWith(':')) head = COLON_HEADERS.has(head[1].toLowerCase()) ? [head[0], head[1], head[2].slice(1)] : null;
  const mermaid = syntax === 'mermaid';
  const nativeType = String(syntax || '').replace(/^native(?::|-)?/i, '');
  let kind = '', params = '';
  if (mermaid && head) {
    kind = head[1]; header = first; headerLine = start + 1; bodyStart = start + 1; firstLine = bodyStart + 1;
    params = head[2].trim();
  } else if (!mermaid && head && (nativeType.toLowerCase() === head[1].toLowerCase() || (!nativeType && !/(?:-->|==>|[\[\]{}()])/.test(first)))) {
    kind = head[1]; header = first; headerLine = start + 1; bodyStart = start + 1; firstLine = bodyStart + 1;
    params = head[2].trim();
  } else {
    kind = !mermaid && nativeType && nativeType.toLowerCase() !== 'native' ? nativeType : '';
    bodyStart = start; firstLine = start + 1;
  }

  if (kind && keepsTrailingComments(kind)) for (const [i, raw] of trailing) if (i >= bodyStart) lines[i] = raw;
  const rawBody = lines.slice(bodyStart).join('\n');
  const bodyLines = (mermaid ? normalizeMarkdown(rawBody) : rawBody).split('\n');
  if (mermaid) {
    for (let i = 0; i < bodyLines.length; i++) {
      const raw = bodyLines[i];
      const single = /^\s*(accTitle|accDescr)\s*:\s*(.*)$/i.exec(raw);
      if (single) {
        if (single[1].toLowerCase() === 'acctitle') accTitle = single[2].trim();
        else accDescr = single[2].trim();
        bodyLines[i] = '';
      } else if (/^\s*accDescr\s*\{/i.test(raw)) {
        const parts = [raw.slice(raw.indexOf('{') + 1)];
        const begin = i;
        while (!parts.at(-1).includes('}') && i + 1 < bodyLines.length) parts.push(bodyLines[++i]);
        const text = parts.join('\n'), close = text.indexOf('}');
        if (close < 0) {
          errors.push(issue(lang, firstLine + begin, raw.search(/\S/) + 1, '无障碍说明缺少结束括号', 'Accessibility description is missing a closing brace', '添加 }', 'Add }'));
        } else accDescr = text.slice(0, close).trim();
        bodyLines.fill('', begin, i + 1);
      }
    }
  }
  const body = bodyLines.join('\n');
  const layout = config[keyOf(config, 'layout')];
  if (ignored.size) {
    let line = Infinity;
    for (const at of ignored.values()) line = Math.min(line, at);
    errors.push(ignoredConfigWarning(lang, line, [...ignored.keys()].join(', ')));
  }
  return { kind, header, headerLine, firstLine, body, ...(title !== undefined ? { title } : {}),
    ...(typeof layout === 'string' ? { layout } : {}), ...(accTitle !== undefined ? { accTitle } : {}),
    ...(accDescr !== undefined ? { accDescr } : {}), config, configLines: Object.fromEntries(configLines), params, errors };
}

function ignoredConfigWarning(lang, line, subjects) {
  return warning('IGNORED_CONFIG', lang, line, `已忽略配置：${subjects}`, `Ignored configuration: ${subjects}`, '移除不影响绘制的配置', 'Remove configuration that does not affect rendering');
}

export { prepareSource, parseOptions, ignoredConfigWarning };
