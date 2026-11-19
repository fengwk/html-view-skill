const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const TAG = /<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>]*>/g;

export const splitList = (value) => String(value ?? '').split(/[,，]/).map((item) => item.trim()).filter(Boolean);
export const classList = (attrs = {}) => String(attrs.class ?? '').trim().split(/\s+/).filter(Boolean);

function parseAttrs(source) {
  const attrs = {};
  const body = source.replace(/^<\/?[\w:-]+/, '').replace(/\/?\s*>$/, '');
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of body.matchAll(pattern)) attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  return attrs;
}

export function elementsOf(html) {
  const source = String(html);
  const elements = [];
  const stack = [];
  let match;
  while ((match = TAG.exec(source))) {
    const token = match[0];
    if (token.startsWith('<!--') || token.startsWith('<!')) continue;
    const closing = /^<\//.test(token);
    const name = /^<\/?([\w:-]+)/.exec(token)?.[1]?.toLowerCase();
    if (!name) continue;
    if (closing) {
      let index = stack.length - 1;
      while (index >= 0 && stack[index].name !== name) index -= 1;
      if (index < 0) continue;
      const entry = stack[index];
      if (index === 0 && entry.top) {
        elements.push({ ...entry, end: TAG.lastIndex, html: source.slice(entry.start, TAG.lastIndex) });
      }
      stack.length = index;
      continue;
    }
    const attrs = parseAttrs(token);
    const top = stack.length === 0;
    if (name === 'script' || name === 'style' || name === 'textarea') {
      const close = new RegExp(`<\\/${name}\\s*>`, 'ig');
      close.lastIndex = TAG.lastIndex;
      const end = close.exec(source);
      if (end) {
        const entry = { name, attrs, start: match.index, end: close.lastIndex, html: source.slice(match.index, close.lastIndex), top };
        if (top) elements.push(entry);
        TAG.lastIndex = close.lastIndex;
      }
      continue;
    }
    if (VOID.has(name) || /\/\s*>$/.test(token)) {
      if (top) elements.push({ name, attrs, start: match.index, end: TAG.lastIndex, html: token, top });
      continue;
    }
    stack.push({ name, attrs, start: match.index, top });
  }
  TAG.lastIndex = 0;
  return elements.sort((a, b) => a.start - b.start);
}

export function tagsOf(html) {
  const source = String(html);
  const tags = [];
  const pattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>]*>/g;
  let match;
  while ((match = pattern.exec(source))) {
    const token = match[0];
    if (token.startsWith('<!--') || token.startsWith('<!')) continue;
    const closing = /^<\//.test(token);
    const name = /^<\/?([\w:-]+)/.exec(token)?.[1]?.toLowerCase();
    if (!name) continue;
    const attrs = closing ? {} : parseAttrs(token);
    tags.push({ name, attrs, start: match.index, end: pattern.lastIndex, closing, token });
    if (!closing && ['script', 'style', 'textarea'].includes(name)) {
      const close = new RegExp(`<\\/${name}\\s*>`, 'ig');
      close.lastIndex = pattern.lastIndex;
      const end = close.exec(source);
      if (end) pattern.lastIndex = close.lastIndex;
    }
  }
  return tags;
}

export const screensOf = (content) => elementsOf(content)
  .filter((entry) => entry.top && entry.name === 'section' && classList(entry.attrs).includes('screen'))
  .map((entry) => ({
    id: entry.attrs.id || null,
    title: entry.attrs['data-title'] || null,
    states: splitList(entry.attrs['data-states']),
    attrs: entry.attrs,
    start: entry.start,
    end: entry.end,
    html: entry.html,
  }));

export function partsOf(content) {
  const source = String(content);
  const screens = screensOf(source);
  if (!screens.length) return [{ part: 'content', content: source }];
  const parts = [];
  const used = new Set();
  let offset = 0;
  let extra = 0;
  for (const screen of screens) {
    if (screen.start > offset) {
      const before = source.slice(offset, screen.start);
      if (before.trim()) parts.push({ part: `content:${++extra}`, content: before });
    }
    const base = screen.id ? `screen:${screen.id}` : `screen:${screen.title || screens.indexOf(screen) + 1}`;
    let key = base;
    let suffix = 2;
    while (used.has(key)) key = `${base}#${suffix++}`;
    used.add(key);
    parts.push({ part: key, content: screen.html });
    offset = screen.end;
  }
  if (offset < source.length && source.slice(offset).trim()) parts.push({ part: `content:${++extra}`, content: source.slice(offset) });
  return parts;
}
