// 一个足够小、足够宽容的 HTML 树解析器：只服务 md / outline / embed 的静态处理，不运行页面脚本。
// 支持空元素、自闭合、常见隐式闭合（p / li / td / th / tr / option / dt / dd）以及父元素结束时关闭未闭合标签。
// 节点位置用原文件中的绝对偏移，方便把标题映射回 HTML 行号。

import { attrsOf } from './html-util.mjs';

export const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source',
  'track', 'wbr',
]);

const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes']);
const P_CLOSERS = new Set([
  'address', 'article', 'aside', 'blockquote', 'div', 'dl', 'fieldset', 'figcaption', 'figure',
  'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav', 'ol', 'p',
  'pre', 'section', 'table', 'ul',
]);
const ROW_BOUNDARY = new Set(['tr', 'table']);
const LIST_BOUNDARY = new Set(['ul', 'ol']);
const DL_BOUNDARY = new Set(['dl']);

const START_TAG = /<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/y;
const END_TAG = /<\/([a-zA-Z][\w:-]*)\s*>/y;

/** 解析属性串；没有值的布尔属性记为 ''。属性名统一小写。 */
export function parseAttributes(raw) {
  // DOM 解析器传入属性串；统一复用共享属性解析规则。
  return attrsOf(raw);
}

/**
 * 逐个读出开始标签里的属性及其值在原文中的位置。
 * embed 用它只替换属性值，其他字节保持原样。
 * @returns {Array<{name:string,value:string,quote:string,nameStart:number,valueStart:number,valueEnd:number}>}
 */
export function attributeSpans(source, tagStart, tagEnd) {
  const spans = [];
  let i = tagStart + 1;
  while (i < tagEnd && /[A-Za-z0-9:_-]/.test(source[i])) i += 1;
  for (;;) {
    while (i < tagEnd && /\s/.test(source[i])) i += 1;
    if (i >= tagEnd || source[i] === '>' || source[i] === '/') break;
    const nameStart = i;
    while (i < tagEnd && /[A-Za-z0-9:_.-]/.test(source[i])) i += 1;
    if (i === nameStart) {
      i += 1;
      continue;
    }
    const name = source.slice(nameStart, i).toLowerCase();
    while (i < tagEnd && /\s/.test(source[i])) i += 1;
    if (source[i] !== '=') continue;
    i += 1;
    while (i < tagEnd && /\s/.test(source[i])) i += 1;
    let quote = '';
    let valueStart = i;
    let valueEnd;
    if (source[i] === '"' || source[i] === "'") {
      quote = source[i];
      valueStart = i + 1;
      valueEnd = source.indexOf(quote, valueStart);
      if (valueEnd < 0 || valueEnd > tagEnd) valueEnd = tagEnd;
      spans.push({
        name, value: source.slice(valueStart, valueEnd), quote, nameStart, valueStart, valueEnd,
      });
      i = valueEnd + 1;
    } else {
      while (i < tagEnd && !/[\s>]/.test(source[i])) i += 1;
      valueEnd = i;
      spans.push({
        name, value: source.slice(valueStart, valueEnd), quote, nameStart, valueStart, valueEnd,
      });
    }
  }
  return spans;
}

const textNode = (text, start) => ({
  type: 'text', text, start, end: start + text.length, parent: null,
});

/**
 * 解析 HTML。
 * @param {string} source
 * @param {{baseOffset?: number}} options 片段解析时把节点位置映射回完整文件
 * @returns {object} root
 */
export function parseHTML(source, { baseOffset = 0 } = {}) {
  const root = {
    type: 'root',
    children: [],
    parent: null,
    start: baseOffset,
    innerStart: baseOffset,
    innerEnd: baseOffset + source.length,
    end: baseOffset + source.length,
  };
  const stack = [root];
  const current = () => stack[stack.length - 1];
  const append = (node) => {
    node.parent = current();
    current().children.push(node);
  };

  const popThrough = (index, at) => {
    for (let i = stack.length - 1; i >= index; i -= 1) {
      const node = stack[i];
      node.innerEnd = at;
      node.end = at;
      stack.pop();
    }
  };
  const closeNearest = (names, boundaries, at) => {
    for (let i = stack.length - 1; i >= 1; i -= 1) {
      const name = stack[i].name;
      if (names.has(name)) {
        popThrough(i, at);
        return true;
      }
      if (boundaries?.has(name)) return false;
    }
    return false;
  };
  const closeForStart = (name, at) => {
    if (P_CLOSERS.has(name)) closeNearest(new Set(['p']), null, at);
    if (name === 'li') closeNearest(new Set(['li']), LIST_BOUNDARY, at);
    if (name === 'dt' || name === 'dd') closeNearest(new Set(['dt', 'dd']), DL_BOUNDARY, at);
    if (name === 'td' || name === 'th') closeNearest(new Set(['td', 'th']), ROW_BOUNDARY, at);
    if (name === 'tr') closeNearest(new Set(['tr']), new Set(['table']), at);
    if (name === 'option') closeNearest(new Set(['option']), new Set(['select', 'datalist']), at);
  };

  let i = 0;
  while (i < source.length) {
    if (source[i] !== '<') {
      const next = source.indexOf('<', i);
      const end = next < 0 ? source.length : next;
      append(textNode(source.slice(i, end), baseOffset + i));
      i = end;
      continue;
    }

    if (source.startsWith('<!--', i)) {
      const close = source.indexOf('-->', i + 4);
      const end = close < 0 ? source.length : close + 3;
      append({
        type: 'comment',
        text: source.slice(i + 4, close < 0 ? source.length : close),
        start: baseOffset + i,
        end: baseOffset + end,
      });
      i = end;
      continue;
    }
    if (source.startsWith('<![CDATA[', i)) {
      const close = source.indexOf(']]>', i + 9);
      const end = close < 0 ? source.length : close + 3;
      append(textNode(source.slice(i + 9, close < 0 ? source.length : close), baseOffset + i));
      i = end;
      continue;
    }
    if (source.startsWith('<!', i) || source.startsWith('<?', i)) {
      const close = source.indexOf('>', i + 2);
      i = close < 0 ? source.length : close + 1;
      continue;
    }

    if (source[i + 1] === '/') {
      END_TAG.lastIndex = i;
      const match = END_TAG.exec(source);
      if (!match) {
        append(textNode('<', baseOffset + i));
        i += 1;
        continue;
      }
      const name = match[1].toLowerCase();
      for (let index = stack.length - 1; index >= 1; index -= 1) {
        if (stack[index].name === name) {
          stack[index].innerEnd = baseOffset + i;
          stack[index].end = baseOffset + END_TAG.lastIndex;
          popThrough(index + 1, baseOffset + i);
          stack.pop();
          break;
        }
      }
      i = END_TAG.lastIndex;
      continue;
    }

    START_TAG.lastIndex = i;
    const match = START_TAG.exec(source);
    if (!match) {
      append(textNode('<', baseOffset + i));
      i += 1;
      continue;
    }
    const name = match[1].toLowerCase();
    const tagEnd = START_TAG.lastIndex;
    const selfClosing = /\/\s*$/.test(match[2]) || VOID_ELEMENTS.has(name);
    closeForStart(name, baseOffset + i);

    const node = {
      type: 'element',
      name,
      attrs: parseAttributes(match[2]),
      children: [],
      parent: null,
      start: baseOffset + i,
      innerStart: baseOffset + tagEnd,
      innerEnd: baseOffset + tagEnd,
      end: baseOffset + tagEnd,
      selfClosing,
    };
    append(node);
    i = tagEnd;

    if (selfClosing) continue;
    if (RAW_TEXT.has(name)) {
      const close = new RegExp(`</${name}\\s*>`, 'ig');
      close.lastIndex = i;
      const end = close.exec(source);
      const closeStart = end ? end.index : source.length;
      if (closeStart > i) node.children.push(textNode(source.slice(i, closeStart), baseOffset + i));
      node.innerEnd = baseOffset + closeStart;
      node.end = baseOffset + (end ? close.lastIndex : source.length);
      i = node.end - baseOffset;
      continue;
    }
    stack.push(node);
  }

  popThrough(1, baseOffset + source.length);
  return root;
}

/** 深度优先遍历元素；fn 返回 false 时不再进入该元素子树。 */
export function walkElements(node, fn) {
  for (const child of node.children ?? []) {
    if (child.type !== 'element') continue;
    if (fn(child) === false) continue;
    walkElements(child, fn);
  }
}

export function findElement(node, predicate) {
  if (node.type === 'element' && predicate(node)) return node;
  for (const child of node.children ?? []) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

export function findAllElements(node, predicate, out = []) {
  if (node.type === 'element' && predicate(node)) out.push(node);
  for (const child of node.children ?? []) findAllElements(child, predicate, out);
  return out;
}

/** 节点的原始文字（不解码实体，不折叠空白）。 */
export function rawText(node) {
  if (node.type === 'text') return node.text;
  if (node.type !== 'element' && node.type !== 'root') return '';
  return (node.children ?? []).map(rawText).join('');
}

export const isElement = (node, name) => node?.type === 'element' && (!name || node.name === name);
