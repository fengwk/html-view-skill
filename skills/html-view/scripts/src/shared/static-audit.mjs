import { parseHTML, walkElements, rawText } from './dom.mjs';
import { decodeEntities, lineAt, tokens, VOID } from './html-util.mjs';
import { readAsset } from './assets.mjs';

const EXTERNAL_TAGS = new Set(['img', 'script', 'link', 'iframe', 'video', 'audio', 'source', 'track', 'object', 'embed']);
const OPTIONAL_END = new Set(['li', 'dt', 'dd', 'p', 'rt', 'rp', 'optgroup', 'option', 'colgroup', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th']);
const COLOR_NAMES = /\b(?:black|white|red|green|blue|yellow|orange|purple|pink|brown|gray|grey|silver|gold|navy|teal|aqua|cyan|magenta|fuchsia|lime|olive|maroon|ivory|beige|coral|crimson|indigo|violet|plum|tan|khaki|salmon|turquoise|lavender|orchid|azure|seashell|linen|snow)\b/i;
const COLOR_VALUE = /(?:#[\da-f]{3,8}\b|\b(?:rgb|hsl|hwb|lab|lch|oklab|oklch)\s*\()/i;
const DEFAULT_CSS = ['page/reading.css', 'page/viz.css'].map((asset) => {
  try { return readAsset(asset); } catch { return ''; }
}).join('\n');

const makeFailure = (code, source, offset, detail, fix, contentLine = 1, where) => ({
  code, line: contentLine + lineAt(source, offset) - 1, ...(where ? { where } : {}), detail, ...(fix ? { fix } : {}),
});
// 与浏览器的 URL 预处理一致：去掉内部 Tab/CR/LF 和首尾 C0 控制字符。
const normalizeUrl = (value) => String(value).replace(/[\t\r\n]/g, '').replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '');
const resourceAttrs = new Set(['src', 'poster', 'action', 'formaction', 'xlink:href']);
const navigationTags = new Set(['a', 'area']);

function* srcsetUrls(value) {
  // URL token 内可有逗号，例如内嵌 data URI；描述符结尾的逗号才开启下一项。
  const tokens = /[^\t\n\f\r ,]+[^\t\n\f\r ]*/gy;
  let index = 0;
  while (index < value.length) {
    while (index < value.length && /[\t\n\f\r ,]/.test(value[index])) index += 1;
    tokens.lastIndex = index;
    const next = tokens.exec(value);
    if (!next) break;
    const url = next[0];
    yield url.replace(/,+$/, '');
    index = tokens.lastIndex;
    if (!url.endsWith(',')) {
      let depth = 0;
      while (index < value.length) {
        const char = value[index++];
        if (char === '(') depth += 1;
        else if (char === ')' && depth) depth -= 1;
        else if (char === ',' && !depth) break;
      }
    }
  }
}

function cssUrls(value) {
  const source = String(value).replace(/\/\*[\s\S]*?\*\//g, '');
  return [...source.matchAll(/url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/gi)]
    .map((match) => match.slice(1).find((item) => item !== undefined));
}

function resourceCode(values) {
  const urls = Array.from(values, normalizeUrl);
  if (urls.some((url) => /^(?:https?:|ftp:|[\\/]{2})/i.test(url))) return 'EXTERNAL_RESOURCE';
  if (urls.some((url) => url && !/^(?:data:|#)/i.test(url))) return 'UNEMBEDDED_RESOURCE';
  return null;
}
const classNames = (css) => {
  const source = String(css).replace(/\/\*[\s\S]*?\*\//g, '');
  const classes = new Set([...source.matchAll(/\.([_a-zA-Z][\w-]*)/g)].map((match) => match[1]));
  classes.add('data-content'); // 数据产物的语义根容器，不单独承载视觉样式。
  return classes;
};
const colorsIn = (value) => COLOR_VALUE.test(value) || COLOR_NAMES.test(value);
// Mask comments and strings without shifting source offsets.
const cssCode = (css) => css.replace(/\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g,
  (text) => text.replace(/[^\r\n]/g, ' '));
const tokenNames = (css) => new Set(Array.from(cssCode(css).matchAll(/(?:^|[;{])\s*(--[\w\u0080-\uFFFF-]+)\s*:/g), (match) => match[1]));

function auditResourceUrls(values, source, offset, label, contentLine, where, failures) {
  const code = resourceCode(values);
  if (code) {
    const problem = code === 'EXTERNAL_RESOURCE' ? '不能请求网络资源' : '依赖文件尚未内嵌';
    failures.push(makeFailure(code, source, offset, `${label} ${problem}`, '将资源内嵌或使用页面内引用', contentLine, where));
  }
}

function auditCss(css, source, offset, contentLine, where, failures) {
  auditResourceUrls(cssUrls(css), source, offset, 'CSS', contentLine, where, failures);
  if (/expression\s*\(|javascript\s*:/i.test(css)) {
    failures.push(makeFailure('DANGEROUS_STYLE', source, offset, 'CSS 包含危险表达式', '移除可执行表达式', contentLine, where));
  }
}

function auditResourceAttribute(element, attr, value, source, contentLine, failures) {
  const { name, start } = element;
  const where = `<${name}>`;
  const add = (code, detail, fix) => failures.push(makeFailure(code, source, start, detail, fix, contentLine, where));
  if (attr.startsWith('on')) add('EVENT_ATTRIBUTE', `禁止事件属性 ${attr}`, '移除事件属性，使用受控交互声明');
  const loadsResource = resourceAttrs.has(attr) || (name === 'object' && attr === 'data') || (attr === 'href' && !navigationTags.has(name));
  if ((loadsResource || attr === 'href') && /^(?:javascript|vbscript):/i.test(normalizeUrl(value))) {
    add('DANGEROUS_URL', `${attr} 不能使用脚本 URL`, '改用安全链接或页面内锚点');
    return;
  }
  if (attr === 'style') auditCss(value, source, start, contentLine, where, failures);
  else if (attr === 'srcset' || attr === 'imagesrcset') auditResourceUrls(srcsetUrls(value), source, start, attr, contentLine, where, failures);
  else if (loadsResource) auditResourceUrls([value], source, start, attr, contentLine, where, failures);
  else if (['fill', 'stroke', 'filter', 'mask', 'clip-path', 'marker-start', 'marker-mid', 'marker-end', 'cursor'].includes(attr)) {
    auditResourceUrls(cssUrls(value), source, start, attr, contentLine, where, failures);
  }
  if (attr === 'ping' && value.trim()) add('EXTERNAL_RESOURCE', '链接不能发送 ping 请求', '保留导航链接，移除 ping 属性');
}

/** 检查内容标记之外的资源；外壳自己的内联样式与脚本不按正文组件规则检查。 */
export function auditOuterResources(source, start, end) {
  const failures = [];
  walkElements(parseHTML(source), (el) => {
    if (el.start >= start && el.start < end) return;
    for (const [attr, raw] of Object.entries(el.attrs)) {
      auditResourceAttribute(el, attr, decodeEntities(raw), source, 1, failures);
    }
    if (el.name === 'style') auditCss(rawText(el), source, el.start, 1, '<style>', failures);
    const refresh = el.name === 'meta' && decodeEntities(el.attrs['http-equiv'] ?? '').trim().toLowerCase() === 'refresh';
    if (refresh || ['base', 'iframe', 'object', 'embed'].includes(el.name)) {
      failures.push(makeFailure('FORBIDDEN_TAG', source, el.start, `外壳不允许 <${el.name}> 嵌入另一个页面或改变导航`, '移除此标签，保留内嵌资源', 1, `<${el.name}>`));
    }
  });
  return failures;
}

/** 通用静态 HTML 审计。受控 UI 可显式放行 style/script 标签；其专属约束由 UI 产物审计。 */
function auditMarkup(source, contentLine, failures) {
  const stack = [];
  const closeImplicit = (name) => {
    const groups = name === 'li' ? [['li'], ['ul', 'ol']]
      : ['dt', 'dd'].includes(name) ? [['dt', 'dd'], ['dl']]
        : name === 'tr' ? [['tr'], ['table']]
          : ['td', 'th'].includes(name) ? [['td', 'th'], ['tr', 'table']]
            : name === 'option' ? [['option'], ['select', 'datalist']] : null;
    if (groups) {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (groups[0].includes(stack[i].name)) { stack.splice(i); return; }
        if (groups[1].includes(stack[i].name)) return;
      }
    }
    if (/^(?:address|article|aside|blockquote|div|dl|fieldset|figure|footer|form|h[1-6]|header|hr|main|nav|ol|pre|section|table|ul)$/.test(name)) {
      const p = stack.map((item) => item.name).lastIndexOf('p');
      if (p >= 0) stack.splice(p);
    }
  };
  for (const token of tokens(source)) {
    if (token.type === 'open') {
      closeImplicit(token.name);
      if (!VOID.has(token.name) && !token.selfClosing) stack.push({ name: token.name, index: token.index });
    } else if (token.type === 'close') {
      let i = stack.length - 1;
      while (i >= 0 && stack[i].name !== token.name) i -= 1;
      if (i < 0) failures.push(makeFailure('BAD_MARKUP', source, token.index, `没有对应开始标签的 </${token.name}>`, '补齐或修正附近的标签名', contentLine, `</${token.name}>`));
      else {
        for (const node of stack.slice(i + 1)) if (!OPTIONAL_END.has(node.name)) {
          failures.push(makeFailure('BAD_MARKUP', source, node.index, `<${node.name}> 缺少结束标签`, '补上结束标签并检查嵌套顺序', contentLine, `<${node.name}>`));
        }
        stack.length = i;
      }
    }
  }
  for (const node of stack) if (!OPTIONAL_END.has(node.name)) failures.push(makeFailure('BAD_MARKUP', source, node.index, `<${node.name}> 缺少结束标签`, '补上结束标签并检查附近标签的嵌套顺序', contentLine, `<${node.name}>`));
}

export function auditContent(content, {
  kind = 'doc', css = '', lang = 'zh-CN', contentLine = 1,
  allowStyle = false, allowScript = false, title, tokenCss = css, ...options
} = {}) {
  const source = String(content);
  const failures = [];
  const notes = [];
  const classSet = classNames(`${DEFAULT_CSS}\n${css}`);
  auditMarkup(source, contentLine, failures);
  const tree = parseHTML(source);
  const elements = [];
  walkElements(tree, (element) => elements.push(element));
  const ui = kind === 'ui';
  const contentCss = ui ? elements.filter(({ name }) => name === 'style').map(rawText) : [];
  const allowedTokens = tokenNames([tokenCss, ...contentCss].join('\n'));
  const tokenFix = ui ? '按 ui-components.md「样式变量」一节选用已有变量；自定义变量先在内容区 style 里以 --x- 开头定义'
    : '用 htmlview viz palette 列出的变量，如 --viz-fg、--viz-frame-1';
  function auditTokens(value, start, where, exactOffset = false) {
    for (const match of value.matchAll(/(?<![\w\u0080-\uFFFF-])var\(\s*(--[\w\u0080-\uFFFF-]+)\s*(?=[,)])/gi)) {
      const name = match[1];
      if (!allowedTokens.has(name)) failures.push(makeFailure('UNKNOWN_TOKEN', source, start + (exactOffset ? match.index : 0), `未定义的样式变量 ${name}`, tokenFix, contentLine, where));
    }
  }
  const ids = new Map();
  const anchors = [];
  const headings = [];
  let headingLevel = 0;
  const activeAllowed = (tag) => (tag === 'style' && allowStyle) || (tag === 'script' && allowScript);

  for (const element of elements) {
    const { name, attrs, start } = element;
    const where = `<${name}>`;
    for (const [rawName, rawValue] of Object.entries(attrs)) {
      const attr = rawName.toLowerCase();
      const value = decodeEntities(rawValue);
      auditResourceAttribute(element, attr, value, source, contentLine, failures);
      if (!ui) auditTokens(value, start, where);
      else if (attr === 'style') auditTokens(cssCode(value), start, where);
      if (attr === 'style') {
        if (!allowStyle) failures.push(makeFailure('INLINE_STYLE', source, start, '此产物不允许行内 style', '由产物样式表或允许的组件规则表达样式', contentLine, where));
        if (/@import/i.test(value)) failures.push(makeFailure('DANGEROUS_STYLE', source, start, '行内 style 不允许 @import', '仅保留静态、内嵌且受控的 CSS 声明', contentLine, where));
        if (kind !== 'ui' && colorsIn(value)) failures.push(makeFailure('HARDCODED_COLOR', source, start, '行内 style 不得写死颜色', '改用主题变量或 UI 产物的主题 token', contentLine, where));
      }
      if (kind !== 'ui' && ['fill', 'stroke', 'color', 'stop-color', 'flood-color', 'lighting-color'].includes(attr) && colorsIn(value)) failures.push(makeFailure('HARDCODED_COLOR', source, start, `属性 ${attr} 写入了固定颜色`, '改用图表主题或受支持的语义色', contentLine, where));
      if (attr === 'href' && value.startsWith('#') && value.length > 1) {
        let target = value.slice(1);
        try { target = decodeURIComponent(target); } catch { /* 保留原串用于诊断。 */ }
        anchors.push({ value: target, start, where });
      }
      if (attr === 'class') for (const token of value.trim().split(/\s+/).filter(Boolean)) {
        if (classSet.size && !classSet.has(token)) failures.push(makeFailure('UNKNOWN_CLASS', source, start, `没有已登记的样式类：.${token}`, '从当前产物组件与样式中选择已有 class', contentLine, where));
      }
      if (attr === 'data-todo') failures.push(makeFailure('PLACEHOLDER', source, start, '内容仍标记为待补充', '补齐真实内容并移除 data-todo，或删除不适用的区块', contentLine, where));
    }
    if (attrs.id) {
      if (ids.has(attrs.id)) failures.push(makeFailure('DUPLICATE_ID', source, start, `id 重复：${attrs.id}`, '改成唯一 id，并同步更新引用', contentLine, where));
      else ids.set(attrs.id, start);
    }
    if (name === 'style' && !allowStyle) failures.push(makeFailure('FORBIDDEN_TAG', source, start, '内容区不允许使用 <style>', '将样式写入 UI 产物或由外壳提供', contentLine, where));
    if (EXTERNAL_TAGS.has(name) && !activeAllowed(name) && (name === 'script' || name === 'link' || name === 'iframe' || name === 'object' || name === 'embed')) {
      failures.push(makeFailure('FORBIDDEN_TAG', source, start, `内容区不允许使用 <${name}>`, '资源由外壳提供；删除危险标签或使用本地、内嵌资源', contentLine, where));
    }
    if (['form', 'base', 'meta'].includes(name)) failures.push(makeFailure('FORBIDDEN_TAG', source, start, `内容区不允许使用 <${name}>`, '使用产物提供的表单组件或由外壳设置页面元数据', contentLine, where));
    if (/^h[1-6]$/.test(name)) {
      const level = Number(name[1]);
      if (headingLevel && level > headingLevel + 1) failures.push(makeFailure('HEADING_SKIP', source, start, `标题层级从 h${headingLevel} 跳到了 h${level}`, '按 h2 → h3 → h4 逐级使用标题', contentLine, where));
      headingLevel = level;
      headings.push(element);
    }
    if (name === 'style') {
      const style = rawText(element);
      auditCss(style, source, start, contentLine, where, failures);
      if (ui) auditTokens(cssCode(style), element.children[0]?.start ?? start, where, true);
    }
  }

  for (const anchor of anchors) if (!ids.has(anchor.value)) failures.push(makeFailure('BROKEN_ANCHOR', source, anchor.start, `锚点目标不存在：#${anchor.value}`, '为目标添加 id，或修正链接地址', contentLine, anchor.where));
  if (title && headings.length) {
    const h1 = headings.find((heading) => heading.name === 'h1');
    if (h1) {
      const text = decodeEntities(rawText(h1)).replace(/\s+/g, ' ').trim();
      const expected = String(title).replace(/\s+/g, ' ').trim();
      if (text && expected && !expected.includes(text)) failures.push(makeFailure('TITLE_MISMATCH', source, h1.start, '页面 <title> 与内容 h1 不一致', '同步修改页面标题与 h1', contentLine, '<h1>'));
    }
  }
  return { failures, notes };
}
