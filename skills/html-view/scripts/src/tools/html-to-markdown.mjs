// 任意 HTML 的静态内容读取；只识别当前 data-viz 源标记，不兼容旧宿主图形格式。
import {
  findElement, findAllElements, parseHTML, walkElements,
} from '../shared/dom.mjs';
import { contentRegions } from '../shared/content-regions.mjs';
import { collapse, decodeEntities, lineAt } from '../shared/html-util.mjs';
import { VIZ_SYNTAXES } from '../shared/viz.mjs';

const DISCARD = new Set([
  'script', 'style', 'template', 'noscript', 'nav', 'head', 'meta', 'link', 'base', 'title',
]);
const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'center', 'details', 'dialog', 'div', 'dl',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
  'hgroup', 'hr', 'html', 'li', 'main', 'ol', 'p', 'pre', 'section', 'svg', 'table', 'ul',
]);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

// 固定标签按文档语言切换；没有 lang 或 lang 以 zh 开头时用中文。
const LABELS = {
  zh: {
    figure: '图：',
    table: '表：',
    dialog: '对话框',
    button: '按钮',
    input: '输入',
    embedded: '内嵌图片',
    separator: '、',
    colon: '：',
    svgText: '图中文字：',
  },
  en: {
    figure: 'Figure: ',
    table: 'Table: ',
    dialog: 'Dialog',
    button: 'Button',
    input: 'Input',
    embedded: 'embedded image',
    separator: ', ',
    colon: ': ',
    svgText: 'Image text: ',
  },
};

const isElement = (node) => node?.type === 'element';
const attr = (node, name) => node?.attrs?.[name];

function discarded(node) {
  if (!isElement(node) || DISCARD.has(node.name)) return true;
  if (attr(node, 'hidden') != null) return true;
  return String(attr(node, 'aria-hidden') ?? '').toLowerCase() === 'true';
}

function plainText(node) {
  const parts = [];
  const visit = (current, root = false) => {
    if (!current) return;
    if (current.type === 'text') {
      parts.push(current.text);
      return;
    }
    if (current.type !== 'element' && current.type !== 'root') return;
    if (!root && current.type === 'element' && discarded(current)) return;
    for (const child of current.children ?? []) visit(child);
  };
  visit(node, true);
  return collapse(decodeEntities(parts.join('')));
}

function textValue(node) {
  return plainText(node);
}

function textInline(value) {
  return decodeEntities(value).replace(/\s+/g, ' ');
}

/** 代码 / kbd：按内容里的反引号数量选围栏。 */
function inlineCode(value) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const runs = text.match(/`+/g) ?? [];
  const size = (runs.length ? Math.max(...runs.map((run) => run.length)) : 0) + 1;
  const fence = '`'.repeat(Math.max(1, size));
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function headingText(node) {
  return textValue(node);
}

function svgTextLine(node, ctx) {
  const found = [];
  const visit = (current) => {
    for (const child of current.children ?? []) {
      if (!isElement(child) || discarded(child)) continue;
      if (child.name === 'text' || child.name === 'foreignObject' || child.name === 'tspan') {
        const text = plainText(child);
        if (text) found.push(text);
        continue;
      }
      visit(child);
    }
  };
  visit(node);
  const unique = [...new Set(found)];
  return unique.length ? `${ctx.labels.svgText}${unique.join(' · ')}` : '';
}

function makeContext(doc) {
  const labelFor = new Map();
  for (const fragment of doc.fragments) {
    walkElements(fragment.root, (node) => {
      if (node.name === 'label' && node.attrs.for) {
        labelFor.set(node.attrs.for, plainText(node));
      }
    });
  }
  const lang = String(attr(findElement(doc.full, (node) => node.name === 'html'), 'lang') ?? '').trim();
  return { labelFor, skipInput: null, labels: lang && !/^zh/i.test(lang) ? LABELS.en : LABELS.zh };
}

function labelForControl(node, ctx) {
  const id = attr(node, 'id');
  if (id && ctx.labelFor.has(id)) return ctx.labelFor.get(id);
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'root') break;
    if (parent.name === 'label') return plainText(parent);
  }
  const direct = attr(node, 'aria-label') || attr(node, 'data-label');
  if (direct) return collapse(decodeEntities(direct));
  const placeholder = attr(node, 'placeholder');
  if (placeholder) return collapse(decodeEntities(placeholder));
  const name = attr(node, 'name');
  return name ? collapse(decodeEntities(name)) : '';
}

function inputPlaceholder(node, ctx) {
  const type = String(attr(node, 'type') ?? 'text').toLowerCase();
  if (type === 'hidden') return '';
  const label = labelForControl(node, ctx);
  if (type === 'checkbox' || type === 'radio') {
    const checked = attr(node, 'checked') != null;
    return checked ? `[x]${label ? ` ${label}` : ''}` : `[ ]${label ? ` ${label}` : ''}`;
  }
  const { input, colon } = ctx.labels;
  return label ? `[${input}${colon}${label}]` : `[${input}]`;
}

function selectPlaceholder(node, ctx) {
  const label = labelForControl(node, ctx);
  const options = findAllElements(node, (item) => item.name === 'option');
  const selected = options.filter((item) => attr(item, 'selected') != null);
  const chosen = (selected.length ? selected : options.slice(0, 1)).map((item) => textValue(item)).filter(Boolean);
  const value = chosen.join(ctx.labels.separator);
  const { input, colon } = ctx.labels;
  if (label && value) return `[${input}${colon}${label}${colon}${value}]`;
  if (label) return `[${input}${colon}${label}]`;
  if (value) return `[${input}${colon}${value}]`;
  return `[${input}]`;
}

function buttonPlaceholder(node, ctx) {
  const text = inline(node.children, ctx).trim() || collapse(decodeEntities(attr(node, 'aria-label') || attr(node, 'title') || ''));
  return text ? `[${ctx.labels.button}${ctx.labels.colon}${text}]` : `[${ctx.labels.button}]`;
}

/** 行内内容。 */
function inline(nodes, ctx) {
  let out = '';
  for (const node of nodes ?? []) {
    if (node === ctx.skipInput) continue;
    if (node.type === 'text') {
      out += textInline(node.text);
      continue;
    }
    if (node.type !== 'element' || discarded(node)) continue;
    const name = node.name;
    if (name === 'br') {
      out += '\n';
    } else if (name === 'strong' || name === 'b') {
      const body = inline(node.children, ctx).trim();
      out += body ? `**${body}**` : '';
    } else if (name === 'em' || name === 'i') {
      const body = inline(node.children, ctx).trim();
      out += body ? `*${body}*` : '';
    } else if (name === 'del' || name === 's') {
      const body = inline(node.children, ctx).trim();
      out += body ? `~~${body}~~` : '';
    } else if (name === 'code' || name === 'kbd') {
      out += inlineCode(plainText(node));
    } else if (name === 'a') {
      const href = decodeEntities(attr(node, 'href') ?? '');
      const body = inline(node.children, ctx).trim();
      if (!href) out += body;
      else out += `[${body || href}](${href})`;
    } else if (name === 'img') {
      const alt = collapse(decodeEntities(attr(node, 'alt') ?? ''));
      const src = decodeEntities(attr(node, 'src') ?? '');
      const shown = /^data:/i.test(src) ? ctx.labels.embedded : src;
      out += `![${alt}](${shown})`;
    } else if (name === 'svg') {
      const line = svgTextLine(node, ctx);
      if (line) out += line;
    } else if (name === 'input') {
      out += inputPlaceholder(node, ctx);
    } else if (name === 'select') {
      out += selectPlaceholder(node, ctx);
    } else if (name === 'textarea') {
      const label = labelForControl(node, ctx);
      out += label ? `[${ctx.labels.input}${ctx.labels.colon}${label}]` : `[${ctx.labels.input}]`;
    } else if (name === 'button') {
      out += buttonPlaceholder(node, ctx);
    } else if (name === 'hr') {
      out += '\n\n---\n\n';
    } else {
      out += inline(node.children, ctx);
    }
  }
  return out;
}

function isBlock(node) {
  return isElement(node) && BLOCK.has(node.name) && !discarded(node);
}

/** 块容器：块之间空一行，容器本身不输出标记。 */
function renderContainer(nodes, ctx) {
  const blocks = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const value = inline(run, ctx).trim();
    if (value) blocks.push(value);
    run = [];
  };
  for (const node of nodes ?? []) {
    if (node.type === 'comment') continue;
    if (node === ctx.skipInput) continue;
    if (isElement(node) && discarded(node)) continue;
    if (isBlock(node)) {
      flush();
      const value = renderBlock(node, ctx);
      if (value && value.trim()) blocks.push(value.trim());
    } else {
      run.push(node);
    }
  }
  flush();
  return blocks.join('\n\n');
}

function renderBlock(node, ctx) {
  if (!isElement(node) || discarded(node) || node === ctx.skipInput) return '';
  const name = node.name;
  if (HEADINGS.has(name)) {
    const level = Number(name[1]);
    const text = headingText(node);
    const id = attr(node, 'id');
    return `${'#'.repeat(level)} ${text}${id ? ` {#${id}}` : ''}`.trimEnd();
  }
  if (name === 'p') return inline(node.children, ctx).trim();
  if (['div', 'section', 'article', 'header', 'footer', 'aside', 'main', 'body', 'html', 'form', 'fieldset', 'address', 'center', 'hgroup'].includes(name)) {
    return renderContainer(node.children, ctx);
  }
  if (name === 'ul' || name === 'ol') return renderList(node, ctx);
  if (name === 'li') return renderListItem(node, '- ', ctx);
  if (name === 'table') return renderTable(node, ctx);
  if (name === 'pre') return renderPre(node, { vizSource: attr(node, 'data-viz') != null });
  if (name === 'blockquote') return renderBlockquote(node, ctx);
  if (name === 'dl') return renderDl(node, ctx);
  if (name === 'figure') return renderFigure(node, ctx);
  if (name === 'details') return renderDetails(node, ctx);
  if (name === 'dialog') return renderDialog(node, ctx);
  if (name === 'hr') return '---';
  if (name === 'svg') return svgTextLine(node, ctx);
  if (name === 'input' || name === 'select' || name === 'textarea' || name === 'button') {
    return inline([node], ctx).trim();
  }
  if (name === 'figcaption') return figureCaption(node, ctx);
  return renderContainer(node.children, ctx);
}

function collectListItems(node, out = []) {
  for (const child of node.children ?? []) {
    if (!isElement(child)) continue;
    if (child.name === 'li') out.push(child);
    else if (child.name === 'ul' || child.name === 'ol') continue;
    else if (child.name !== 'script' && child.name !== 'style' && child.name !== 'template') {
      collectListItems(child, out);
    }
  }
  return out;
}

function findCheckbox(node) {
  for (const child of node.children ?? []) {
    if (!isElement(child)) continue;
    if (child.name === 'ul' || child.name === 'ol') continue;
    if (child.name === 'input' && String(attr(child, 'type') ?? '').toLowerCase() === 'checkbox') return child;
    const found = findCheckbox(child);
    if (found) return found;
  }
  return null;
}

function renderListItem(li, marker, ctx) {
  const checkbox = findCheckbox(li);
  const doneAttr = attr(li, 'data-done');
  const task = Boolean(checkbox) || doneAttr != null;
  const checked = Boolean(checkbox && attr(checkbox, 'checked') != null)
    || (doneAttr != null && String(doneAttr).toLowerCase() !== 'false');
  const previous = ctx.skipInput;
  ctx.skipInput = checkbox;
  const content = renderContainer(li.children, ctx).trim();
  ctx.skipInput = previous;

  const prefix = task ? `[${checked ? 'x' : ' '}] ` : '';
  if (!content) return `${marker}${prefix}`.trimEnd();
  const lines = content.split('\n');
  const first = lines.shift() ?? '';
  const out = [marker + prefix + first];
  for (const line of lines) out.push(line ? `  ${line}` : '');
  return out.join('\n');
}

function renderList(node, ctx) {
  const ordered = node.name === 'ol';
  const start = Number.parseInt(attr(node, 'start') ?? '1', 10);
  let number = Number.isFinite(start) ? start : 1;
  const items = collectListItems(node);
  const rendered = [];
  for (const li of items) {
    rendered.push(renderListItem(li, ordered ? `${number}. ` : '- ', ctx));
    number += 1;
  }
  return rendered.join('\n');
}

function renderBlockquote(node, ctx) {
  const body = renderContainer(node.children, ctx);
  if (!body) return '';
  return body.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
}

function renderDl(node, ctx) {
  const sequence = [];
  const visit = (current) => {
    for (const child of current.children ?? []) {
      if (!isElement(child)) continue;
      if (child.name === 'dt' || child.name === 'dd') sequence.push(child);
      else if (!discarded(child)) visit(child);
    }
  };
  visit(node);
  const items = [];
  for (let index = 0; index < sequence.length; index += 1) {
    const entry = sequence[index];
    if (entry.name === 'dt') {
      const term = inline(entry.children, ctx).trim();
      const definitions = [];
      while (index + 1 < sequence.length && sequence[index + 1].name === 'dd') {
        index += 1;
        definitions.push(inline(sequence[index].children, ctx).replace(/\n+/g, '<br>').trim());
      }
      const value = definitions.filter(Boolean).join('；');
      items.push(term ? `- **${term}**${ctx.labels.colon}${value}`.trimEnd() : `- ${value}`.trimEnd());
    } else {
      const value = inline(entry.children, ctx).replace(/\n+/g, '<br>').trim();
      if (value) items.push(`- ${value}`);
    }
  }
  return items.join('\n');
}

/** figcaption 各部分都是元素且有多段文字时，用破折号连接标题和副标题。 */
function figureCaption(node, ctx) {
  const children = node.children ?? [];
  const elements = children.filter((child) => isElement(child) && !discarded(child));
  const onlyElementsAndGaps = children.every((child) => child.type === 'comment'
    || isElement(child)
    || (child.type === 'text' && !child.text.trim()));
  if (onlyElementsAndGaps && elements.length >= 2) {
    const parts = elements.map((child) => inline([child], ctx).trim()).filter(Boolean);
    if (parts.length >= 2) return parts.join(' — ');
  }
  return inline(children, ctx).trim();
}

function renderFigure(node, ctx) {
  const captionNode = findElement(node, (item) => item.name === 'figcaption');
  const caption = captionNode ? figureCaption(captionNode, ctx) : '';
  const bodyNodes = captionNode ? node.children.filter((item) => item !== captionNode) : node.children;
  const body = renderContainer(bodyNodes, ctx);
  if (!caption) return body;
  return body ? `${body}\n\n*${ctx.labels.figure}${caption}*` : `*${ctx.labels.figure}${caption}*`;
}

function renderDetails(node, ctx) {
  const summary = findElement(node, (item) => item.name === 'summary');
  const summaryText = summary ? inline(summary.children, ctx).trim() : '';
  const bodyNodes = summary ? node.children.filter((item) => item !== summary) : node.children;
  const body = renderContainer(bodyNodes, ctx);
  if (summaryText && body) return `**${summaryText}**\n\n${body}`;
  if (summaryText) return `**${summaryText}**`;
  return body;
}

function renderDialog(node, ctx) {
  let label = collapse(decodeEntities(attr(node, 'aria-label') || attr(node, 'data-title') || ''));
  let heading = null;
  if (!label) {
    heading = findElement(node, (item) => HEADINGS.has(item.name));
    if (heading) label = headingText(heading);
  }
  const bodyNodes = heading ? node.children.filter((item) => item !== heading) : node.children;
  const body = renderContainer(bodyNodes, ctx);
  const header = `> **${ctx.labels.dialog}**${label ? `${ctx.labels.colon}${label}` : ''}`;
  if (!body) return header;
  return `${header}\n${body.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n')}`;
}

function renderPre(node, { vizSource = false } = {}) {
  const codeNode = node.children.find((child) => isElement(child) && child.name === 'code');
  let code = decodeEntities(codeText(node)).replace(/\r\n?/g, '\n');
  // 与浏览器渲染一致：pre 紧跟开始标签的一个换行不算内容。
  if (code.startsWith('\n')) code = code.slice(1);
  if (code.endsWith('\n')) code = code.slice(0, -1);
  const syntax = String(attr(node, 'data-viz') ?? '').trim().toLowerCase();
  const isViz = vizSource && VIZ_SYNTAXES.includes(syntax);
  const cls = String(attr(node, 'class') ?? attr(codeNode, 'class') ?? '');
  let lang = isViz ? syntax : String(attr(node, 'data-lang') || attr(codeNode, 'data-lang')
    || (/language-([\w-]+)/.exec(cls)?.[1] ?? '')).trim();
  // 只有 pre[data-viz] 的声明作为 KChart fence 往返；泛化 HTML 里的其它高亮标签保留原语法。
  if (vizSource && !isViz && VIZ_SYNTAXES.includes(syntax)) lang = 'text';
  const runs = code.match(/`+/g) ?? [];
  const fence = '`'.repeat(Math.max(3, (runs.length ? Math.max(...runs.map((run) => run.length)) : 0) + 1));
  return `${fence}${lang}\n${code}\n${fence}`;
}

/** 代码块里的原始文字：br 元素写成字面 <br>，mermaid 用它换行。 */
function codeText(node) {
  if (node.type === 'text') return node.text;
  if (node.type !== 'element' && node.type !== 'root') return '';
  if (node.type === 'element' && node.name === 'br') return '<br>';
  return (node.children ?? []).map(codeText).join('');
}

function collectRows(node, out = []) {
  for (const child of node.children ?? []) {
    if (!isElement(child)) continue;
    if (child.name === 'tr') out.push(child);
    else if (['thead', 'tbody', 'tfoot'].includes(child.name)) collectRows(child, out);
  }
  return out;
}

function cellMarkdown(cell, ctx) {
  const value = renderContainer(cell.children, ctx).replace(/\n+/g, '<br>').trim();
  return value.replace(/\|/g, '\\|');
}

function renderTable(node, ctx) {
  const rows = collectRows(node);
  if (!rows.length) return '';
  const grid = [];
  for (const [rowIndex, row] of rows.entries()) {
    if (!grid[rowIndex]) grid[rowIndex] = [];
    let column = 0;
    for (const cell of row.children) {
      if (!isElement(cell) || (cell.name !== 'td' && cell.name !== 'th')) continue;
      while (grid[rowIndex][column] !== undefined) column += 1;
      const colspan = Math.max(1, Number.parseInt(attr(cell, 'colspan') ?? '1', 10) || 1);
      const rowspan = Math.max(1, Number.parseInt(attr(cell, 'rowspan') ?? '1', 10) || 1);
      const value = cellMarkdown(cell, ctx);
      for (let dr = 0; dr < rowspan; dr += 1) {
        if (!grid[rowIndex + dr]) grid[rowIndex + dr] = [];
        for (let dc = 0; dc < colspan; dc += 1) grid[rowIndex + dr][column + dc] = value;
      }
      column += colspan;
    }
  }
  const width = Math.max(...grid.map((row) => row.length), 0);
  if (!width) return '';
  const line = (row) => `| ${Array.from({ length: width }, (_, index) => row?.[index] ?? '').join(' | ')} |`;
  const output = [line(grid[0]), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`];
  for (let index = 1; index < grid.length; index += 1) output.push(line(grid[index]));
  const captionNode = node.children.find((child) => isElement(child) && child.name === 'caption' && !discarded(child));
  const caption = captionNode ? inline(captionNode.children, ctx).trim() : '';
  const table = output.join('\n');
  return caption ? `*${ctx.labels.table}${caption}*\n\n${table}` : table;
}

/** 读取内容区并解析成片段；片段保留在原文件中的绝对偏移。 */
export function loadDocument(source, { fallback = 'main' } = {}) {
  const regions = contentRegions(source, { fallback });
  const fragments = regions.map((region) => ({
    region,
    root: parseHTML(source.slice(region.start, region.end), { baseOffset: region.start }),
  }));
  return {
    source, regions, fragments, full: parseHTML(source),
  };
}

/** 文档标题：<title>，没有时用内容区第一个 h1。 */
export function documentTitle(doc) {
  const title = findElement(doc.full, (node) => node.name === 'title');
  const fromTitle = title ? textValue(title) : '';
  if (fromTitle) return fromTitle;
  const first = contentHeadings(doc).find((item) => item.level === 1);
  return first ? first.text : '';
}

function headingDiscarded(heading) {
  for (let node = heading; node; node = node.parent) {
    if (node.type === 'root') break;
    if (discarded(node)) return true;
  }
  return false;
}

/** 内容区内所有 h1–h6，按文档顺序。 */
export function contentHeadings(doc) {
  const headings = [];
  for (const fragment of doc.fragments) {
    walkElements(fragment.root, (node) => {
      if (!HEADINGS.has(node.name) || headingDiscarded(node)) return;
      headings.push({
        node,
        level: Number(node.name[1]),
        id: attr(node, 'id') ?? null,
        text: headingText(node),
        line: lineAt(doc.source, node.start),
        region: fragment.region,
        fragment,
      });
    });
  }
  headings.sort((a, b) => a.node.start - b.node.start);
  return headings;
}

export function findContentElement(doc, id) {
  for (const fragment of doc.fragments) {
    const found = findElement(fragment.root, (node) => attr(node, 'id') === id);
    if (found) return found;
  }
  return null;
}

/** 标题章节的结束偏移：同区域内下一个同级或更高级标题之前，或内容区结束。 */
export function headingSectionEnd(doc, info, headings = contentHeadings(doc)) {
  for (const other of headings) {
    if (other.region !== info.region) continue;
    if (other.node.start <= info.node.start) continue;
    if (other.level <= info.level) return other.node.start;
  }
  return info.region.end;
}

/**
 * 渲染 Markdown。
 * @param {ReturnType<typeof loadDocument>} doc
 * @param {{selection?: object}} options selection 是内容区里的元素节点
 */
export function renderMarkdown(doc, { selection = null } = {}) {
  const ctx = makeContext(doc);
  const title = documentTitle(doc);
  const duplicateTitle = Boolean(title) && contentHeadings(doc).some((item) => item.level === 1 && item.text === title);
  let body = '';
  if (selection) {
    const headings = contentHeadings(doc);
    const info = headings.find((item) => item.node === selection);
    if (info) {
      const end = headingSectionEnd(doc, info, headings);
      const root = parseHTML(doc.source.slice(selection.start, end), { baseOffset: selection.start });
      body = renderContainer(root.children, ctx);
    } else {
      body = renderBlock(selection, ctx);
    }
  } else {
    const blocks = [];
    for (const fragment of doc.fragments) {
      const value = renderContainer(fragment.root.children, ctx);
      if (value) blocks.push(value);
    }
    body = blocks.join('\n\n');
  }
  const parts = [];
  if (title && !duplicateTitle) parts.push(`# ${title}`);
  if (body) parts.push(body);
  const markdown = parts.join('\n\n').replace(/\n+$/, '');
  return markdown ? `${markdown}\n` : '';
}
