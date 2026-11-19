// 轻量 HTML 扫描工具：保留原文位置，不构造 HTML5 DOM。
export const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'embed', 'area', 'base', 'col', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009', mdash: '—', ndash: '–',
  hellip: '…', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™',
  laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  times: '×', divide: '÷', plusmn: '±', le: '≤', ge: '≥', ne: '≠',
  tab: '\t', newline: '\n', colon: ':', sol: '/', bsol: '\\',
  rarr: '→', larr: '←', uarr: '↑', darr: '↓', harr: '↔', deg: '°', micro: 'µ',
};

/** 解析标签属性或属性串；没有值的布尔属性记为 ''。 */
export function attrsOf(raw) {
  const attrs = new Map();
  let body = String(raw);
  if (body.startsWith('<')) body = body.replace(/^<\/?[a-zA-Z][\w:-]*/, '');
  const re = /([\w:-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(body))) {
    const name = m[1].toLowerCase();
    // HTML 以先出现的属性为准，避免审计读到浏览器不会采用的值。
    if (!attrs.has(name)) attrs.set(name, m[3] ?? m[4] ?? m[5] ?? '');
  }
  return Object.fromEntries(attrs);
}

/** 按 token 扫描；跳过注释和 script/style/textarea/title 内容，但保留 pre 原文中的标签扫描语义。 */
export function* tokens(text) {
  const source = String(text);
  const re = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
  let m;
  while ((m = re.exec(source))) {
    const raw = m[0];
    if (raw.startsWith('<!--')) {
      yield { type: 'comment', index: m.index, end: re.lastIndex, text: raw };
      continue;
    }
    if (/^<!doctype/i.test(raw)) {
      yield { type: 'doctype', index: m.index, end: re.lastIndex, text: raw };
      continue;
    }
    if (raw.startsWith('</')) {
      yield { type: 'close', name: m[1].toLowerCase(), index: m.index, end: re.lastIndex, text: raw };
      continue;
    }
    const name = m[2].toLowerCase();
    const selfClosing = /\/\s*>$/.test(raw);
    yield { type: 'open', name, attrs: attrsOf(m[3] ?? ''), index: m.index, end: re.lastIndex, text: raw, raw: m[3] ?? '', selfClosing };
    if (!selfClosing && RAW_TEXT.has(name)) {
      const closeRe = new RegExp(`</${name}\\s*>`, 'gi');
      closeRe.lastIndex = re.lastIndex;
      const close = closeRe.exec(source);
      if (close) {
        yield { type: 'close', name, index: close.index, end: closeRe.lastIndex, text: close[0] };
        re.lastIndex = closeRe.lastIndex;
      } else re.lastIndex = source.length;
    }
  }
}

/** 逐个产出开始标签；注释、结束标签与 doctype 不产出。 */
export function* tags(text) {
  for (const token of tokens(text)) {
    if (token.type === 'open') yield { index: token.index, end: token.end, name: token.name, raw: token.raw, selfClosing: token.selfClosing };
  }
}

export const stripTags = (s) => String(s).replace(/<[^>]*>/g, '');

/** 解码受支持的命名及数值实体；nbsp 默认转换为普通空格。 */
export function decodeEntities(value, { nbsp = 'space' } = {}) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (all, body) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    const key = body.toLowerCase();
    if (!Object.hasOwn(NAMED_ENTITIES, key)) return all;
    return key === 'nbsp' && nbsp === 'space' ? ' ' : NAMED_ENTITIES[key];
  });
}

export const collapse = (s) => String(s).replace(/\s+/g, ' ').trim();

// 数字连同可选空格和紧跟的第一个汉字，与 SVG 换行规则「数字不与量词拆开」一致。
const NUMBER_UNIT = /\d[\d.,%]* ?[\u3400-\u4dbf\u4e00-\u9fff]/g;

/**
 * 让标题里的数字和紧跟的中文单位不拆到两行（「2026 年」「30 分钟」）：包进 .nowrap，文字内容不变。
 * 只改标签之外的文字，code 内原样保留。
 */
export function keepNumberUnits(html) {
  let code = 0;
  return String(html).split(/(<[^>]*>)/).map((part) => {
    if (part.startsWith('<')) {
      if (/^<code\b/i.test(part)) code += 1;
      else if (/^<\/code\s*>/i.test(part)) code = Math.max(0, code - 1);
      return part;
    }
    return code ? part : part.replace(NUMBER_UNIT, '<span class="nowrap">$&</span>');
  }).join('');
}

/** 从 from（标签之后）取元素文字，供诊断位置说明使用。 */
export function elementText(text, from, name) {
  if (VOID.has(name)) return '';
  const rest = String(text).slice(from);
  const close = new RegExp(`</${name}\\s*>`, 'i').exec(rest);
  return close ? rest.slice(0, close.index) : rest.slice(0, 160);
}

/** 扫描元素并保留父子关系与原文偏移。 */
export function scanElements(text) {
  const source = String(text);
  const out = [];
  const stack = [];
  for (const token of tokens(source)) {
    if (token.type === 'open') {
      const el = { name: token.name, attrs: token.attrs, start: token.index, openEnd: token.end, end: token.end, closeStart: token.end, text: token.text, parent: stack.at(-1) ?? null };
      out.push(el);
      if (!VOID.has(token.name) && !token.selfClosing) stack.push(el);
    } else if (token.type === 'close') {
      let idx = stack.length - 1;
      while (idx >= 0 && stack[idx].name !== token.name) idx -= 1;
      if (idx < 0) continue;
      while (stack.length > idx) {
        const el = stack.pop();
        el.closeStart = token.index;
        el.end = token.end;
      }
    }
  }
  for (const el of stack) {
    el.closeStart = source.length;
    el.end = source.length;
  }
  return out;
}

export function topLevelElements(text) {
  return scanElements(text).filter((el) => el.parent === null).sort((a, b) => a.start - b.start);
}

export function innerHtml(text, el) {
  return String(text).slice(el.openEnd, el.closeStart);
}

export function elementSnippet(text, el, max = 12) {
  const value = collapse(decodeEntities(stripTags(innerHtml(text, el))));
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** 找 .doc-body、.doc-head、.summary 等 class token 内容区。 */
export function findRegion(text, tag, token) {
  const source = String(text);
  for (const candidate of tokens(source)) {
    if (candidate.type !== 'open' || candidate.name !== String(tag).toLowerCase()) continue;
    if (!String(candidate.attrs.class ?? '').split(/\s+/).includes(token)) continue;
    let depth = 0;
    for (const item of tokens(source.slice(candidate.index))) {
      if (item.type === 'open' && item.name === candidate.name && !item.selfClosing && !VOID.has(item.name)) depth += 1;
      else if (item.type === 'close' && item.name === candidate.name) {
        depth -= 1;
        if (depth <= 0) return { innerStart: candidate.end, innerEnd: candidate.index + item.index };
      }
    }
    return null;
  }
  return null;
}

/** 位置 → 行号（1 起）。 */
export const lineAt = (text, pos, base = 1) => base + (String(text).slice(0, pos).split('\n').length - 1);

/** Escape text for safe use in an HTML text or attribute value. */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}
