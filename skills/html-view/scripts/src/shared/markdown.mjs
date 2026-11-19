// 将 Markdown 确定性转换为产物内容区。
// 只做规则内的结构；处理不了的结构保留原文并加 data-todo，由 Agent 接手。
import { toDataUri } from './media.mjs';
import { isZhLang, noteLabels } from './locale.mjs';
import { keepNumberUnits } from './html-util.mjs';
import { vizMarkup, VIZ_SYNTAXES } from './viz.mjs';

// 中日韩字符（含全角标点、假名、谚文）：软换行两侧都是它们时不插空格
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u;
const isCjk = (ch) => Boolean(ch) && CJK.test(ch);

// GitHub 提示块归入提示条的三类，标签取 noteLabels
const ALERTS = { NOTE: 'info', TIP: 'info', IMPORTANT: 'warn', WARNING: 'warn', CAUTION: 'danger' };

const IMPORT_LABELS = {
  zh: { untitled: '未命名文档', remote: '（远程图片，未内嵌）', missing: '图片未内嵌：', meta: 'Markdown 前言区（YAML）' },
  en: { untitled: 'Untitled document', remote: ' (remote image, not embedded)', missing: 'Image not embedded: ', meta: 'Markdown front matter (YAML)' },
};

const langOf = (ctx) => (isZhLang(ctx?.lang) ? 'zh' : 'en');
const labelsOf = (ctx) => IMPORT_LABELS[langOf(ctx)];

const ITEM_RE = /^( *)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/;
const DELIM_ROW = /^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const HR_RE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
// 只有块级标签才算「原样 HTML 块」；<https://…> 这类自动链接要留给行内规则
const BLOCK_TAGS = 'address|article|aside|audio|blockquote|button|dd|details|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|iframe|img|label|li|link|main|nav|ol|p|picture|pre|script|section|style|summary|svg|table|tbody|td|th|thead|tr|ul|video';
const HTML_BLOCK = new RegExp(`^ {0,3}(?:<(?:${BLOCK_TAGS})\\b|<!--|<!)`, 'i');

const escapeText = (s) => String(s)
  .replace(/&(?!(?:#\d+|#x[\da-f]+|[a-z][\da-z]*);)/gi, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');
const escapeAttr = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeCode = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const indentOf = (line) => /^ */.exec(line)[0].length;

/** 去掉行内标记，用来生成纯文本标题。 */
export function plainText(md) {
  let s = String(md);
  for (let k = 0; k < 3; k += 1) {
    s = s
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/`+([^`]*)`+/g, '$1')
      .replace(/(\*\*|__|~~|\*|_)(\S(?:[\s\S]*?\S)?)\1/g, '$2');
  }
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
}

/** 简单内联 title 的值；块、锚点、标签、引用等写法返回 null，交给原始折叠内容保留。 */
function simpleTitleValue(raw) {
  const value = String(raw).trim();
  if (!value) return null;
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    if (value.length < 2 || !value.endsWith(quote)) return null;
    const inner = value.slice(1, -1);
    // Escaped YAML strings need a real YAML parser; retain their source instead of guessing.
    if (inner.includes(quote) || (quote === '"' && inner.includes('\\'))) return null;
    return inner;
  }
  if ('|>&*!{[#%@`?'.includes(value[0]) || /^[:-]\s/.test(value)) return null;
  if (/\s#/.test(value) || /:\s/.test(value)) return null;
  return value;
}

/**
 * 前言区：简单 title 可作文档标题；只有简单 title 且无其他内容时只作标题。
 * 其余情况把整段前言区原样留在 metadata，避免丢字段、锚点、块内容和缩进。
 */
function splitFrontMatter(md) {
  const text = String(md).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return { meta: {}, lines, metadata: '' };
  const end = lines.findIndex((line, idx) => idx > 0 && /^(---|\.\.\.)\s*$/.test(line));
  if (end < 0) return { meta: {}, lines, metadata: '' };
  const body = lines.slice(1, end);
  // 顶层键的缩进以第一条有效行为准；缩进更深的行属于嵌套结构，不能当标题读走。
  const baseIndent = body.find((line) => line.trim() && !/^\s*#/.test(line))?.match(/^ */)[0].length ?? 0;
  const titleLines = [];
  body.forEach((line, index) => {
    if (line.match(/^ */)[0].length !== baseIndent) return;
    const m = /^([\w-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (m && m[1].toLowerCase() === 'title') titleLines.push({ index, value: m[2] });
  });
  const raw = body.join('\n').replace(/^\n+|\n+$/g, '');
  const metadata = raw.trim() ? raw : '';
  if (titleLines.length !== 1) return { meta: {}, lines: lines.slice(end + 1), metadata };
  const title = simpleTitleValue(titleLines[0].value);
  if (title === null) return { meta: {}, lines: lines.slice(end + 1), metadata };
  const hasOtherContent = body.some((line, index) => index !== titleLines[0].index && line.trim());
  return {
    meta: { title },
    lines: lines.slice(end + 1),
    metadata: hasOtherContent ? metadata : '',
  };
}

/** 前言区原文放进折叠块，YAML 按代码转义，信息不丢也不触发 HTML。 */
function frontMatterFold(yaml, ctx) {
  return [
    '<details class="fold">',
    `<summary>${labelsOf(ctx).meta}</summary>`,
    '<div class="fold-body">',
    `<pre data-lang="yaml"><code>${escapeCode(yaml)}</code></pre>`,
    '</div>',
    '</details>',
  ].join('\n');
}

/** 找一个强调/删除线定界符的闭合位置；不套 CommonMark 的 flanking 规则，紧贴中文标点也生效。 */
function matchDelimiter(s, i, delim) {
  if (!s.startsWith(delim, i)) return null;
  const after = s[i + delim.length];
  if (after === undefined || /\s/.test(after)) return null;
  if (delim === '_' && i > 0 && /[\p{L}\p{N}]/u.test(s[i - 1])) return null; // _ 不在单词内部生效
  let from = i + delim.length;
  for (;;) {
    const close = s.indexOf(delim, from);
    if (close < 0) return null;
    const before = s[close - 1];
    const next = s[close + delim.length];
    const okBefore = before !== undefined && !/\s/.test(before);
    const okAfter = delim !== '_' || next === undefined || !/[\p{L}\p{N}]/u.test(next);
    if (okBefore && okAfter && close > i + delim.length) {
      return { inner: s.slice(i + delim.length, close), end: close + delim.length };
    }
    from = close + 1;
  }
}

function image(alt, src, ctx) {
  const labels = labelsOf(ctx);
  if (/^data:/i.test(src)) return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}">`;
  if (/^(?:https?:)?\/\//i.test(src)) {
    return `<a href="${escapeAttr(src)}" data-todo>${escapeText(alt || src)}${labels.remote}</a>`;
  }
  const local = toDataUri(src, ctx.baseDir);
  if (local.uri) return `<img src="${local.uri}" alt="${escapeAttr(alt)}">`;
  return `<span class="tag" data-todo>${labels.missing}${escapeText(alt || src)}</span>`;
}

/** 行内规则：代码、链接、图片、加粗、斜体、删除线、自动链接、转义。 */
export function inline(text, ctx = { baseDir: process.cwd() }) {
  const s = String(text);
  let out = '';
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    let m = /^\\([\\`*_{}[\]()#+\-.!>~|])/.exec(rest);
    if (m) {
      out += escapeText(m[1]);
      i += m[0].length;
      continue;
    }
    m = /^(`+)([\s\S]*?)\1(?!`)/.exec(rest);
    if (m) {
      let code = m[2].replace(/\n/g, ' ');
      if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ')) code = code.slice(1, -1);
      out += `<code>${escapeCode(code)}</code>`;
      i += m[0].length;
      continue;
    }
    m = /^<((?:https?|mailto):[^>\s]+)>/.exec(rest);
    if (m) {
      out += `<a href="${escapeAttr(m[1])}">${escapeText(m[1].replace(/^mailto:/, ''))}</a>`;
      i += m[0].length;
      continue;
    }
    m = /^!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?\s*\)/.exec(rest);
    if (m) {
      out += image(m[1], m[2], ctx);
      i += m[0].length;
      continue;
    }
    m = /^\[([^\]]*)\]\(\s*<?([^)\s>]+)>?\s*\)/.exec(rest);
    if (m) {
      out += `<a href="${escapeAttr(m[2])}">${inline(m[1], ctx)}</a>`;
      i += m[0].length;
      continue;
    }
    // 原样 HTML：行内标签与实体透传
    m = /^<\/?[a-zA-Z][\w:-]*(?:"[^"]*"|'[^']*'|[^>"'])*>/.exec(rest);
    if (m) {
      out += m[0];
      i += m[0].length;
      continue;
    }
    m = /^&(?:#\d+|#x[\da-f]+|[a-z][\da-z]*);/i.exec(rest);
    if (m) {
      out += m[0];
      i += m[0].length;
      continue;
    }
    const strong = matchDelimiter(s, i, '**') ?? matchDelimiter(s, i, '__');
    if (strong) {
      out += `<strong>${inline(strong.inner, ctx)}</strong>`;
      i = strong.end;
      continue;
    }
    const del = matchDelimiter(s, i, '~~');
    if (del) {
      out += `<del>${inline(del.inner, ctx)}</del>`;
      i = del.end;
      continue;
    }
    const em = matchDelimiter(s, i, '*') ?? matchDelimiter(s, i, '_');
    if (em) {
      out += `<em>${inline(em.inner, ctx)}</em>`;
      i = em.end;
      continue;
    }
    out += escapeText(s[i]);
    i += 1;
  }
  return out;
}

function softJoin(prev, next) {
  return isCjk(prev.trim().slice(-1)) && isCjk(next.trim()[0]) ? '' : ' ';
}

/** 段落内的换行：行尾两个空格或 \ 是硬换行，其余按两侧字符决定连写还是空格。 */
function joinLines(buf, ctx) {
  let out = '';
  buf.forEach((raw, k) => {
    const hard = / {2,}$/.test(raw) || /\\[ \t]*$/.test(raw);
    const text = raw.replace(/[ \t]+$/, '').replace(/\\$/, '').trim();
    out += inline(text, ctx);
    if (k === buf.length - 1) return;
    out += hard ? '<br>\n' : softJoin(text, buf[k + 1]);
  });
  return out;
}

function splitRow(line) {
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let cur = '';
  let inCode = false;
  for (let k = 0; k < s.length; k += 1) {
    const ch = s[k];
    if (ch === '\\' && s[k + 1] === '|') {
      cur += '\\|';
      k += 1;
      continue;
    }
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const alignOf = (cell) => {
  const v = cell.trim();
  const left = v.startsWith(':');
  const right = v.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return '';
};

function isTableStart(lines, i) {
  return Boolean(lines[i + 1]) && lines[i].includes('|') && !lines[i + 1].trim().startsWith('#')
    && DELIM_ROW.test(lines[i + 1]) && splitRow(lines[i]).length === splitRow(lines[i + 1]).length;
}

function startsBlock(lines, i) {
  const line = lines[i];
  if (!line.trim()) return true;
  if (/^ {0,3}(`{3,}|~{3,})/.test(line)) return true;
  if (/^ {0,3}#{1,6}[ \t]+/.test(line)) return true;
  if (HR_RE.test(line)) return true;
  if (/^ {0,3}>/.test(line)) return true;
  if (ITEM_RE.test(line)) return true;
  if (HTML_BLOCK.test(line)) return true;
  return isTableStart(lines, i);
}

function renderItem(item) {
  if (item.kind === 'html') return item.html;
  if (item.kind === 'viz') return item.html;
  if (item.kind === 'code') {
    const lang = item.lang ? ` data-lang="${escapeAttr(item.lang)}"` : '';
    return `<pre${lang}><code>${escapeCode(item.code)}</code></pre>`;
  }
  const id = item.id ? ` id="${escapeAttr(item.id)}"` : '';
  return `<h${item.level}${id}>${item.html}</h${item.level}>`;
}

const renderItems = (items) => items.filter(Boolean).map(renderItem).join('\n');

function paragraph(lines, i, ctx) {
  const buf = [];
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) break;
    if (buf.length && startsBlock(lines, i)) break;
    buf.push(line);
    i += 1;
  }
  return { html: `<p>${joinLines(buf, ctx)}</p>`, next: i };
}

function note(kind, inner) {
  const body = inner ? `\n${inner}\n` : '';
  return `<div class="note" data-k="${kind.k}"><b class="note-k">${kind.label}</b><div>${body}</div></div>`;
}

function blockquote(lines, i, ctx) {
  const buf = [];
  while (i < lines.length) {
    const line = lines[i];
    if (/^ {0,3}>/.test(line)) {
      buf.push(line.replace(/^ {0,3}> ?/, ''));
      i += 1;
      continue;
    }
    if (line.trim() && buf.length && !startsBlock(lines, i)) {
      buf.push(line);
      i += 1;
      continue;
    }
    break;
  }
  const alert = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i.exec((buf[0] ?? '').trim());
  if (alert) {
    const k = ALERTS[alert[1].toUpperCase()];
    const inner = renderItems(renderBlocks(buf.slice(1), ctx));
    return { html: note({ k, label: noteLabels(ctx?.lang)[k] }, inner), next: i };
  }
  const inner = renderItems(renderBlocks(buf, ctx));
  return { html: `<blockquote>\n${inner}\n</blockquote>`, next: i };
}

function dedent(body) {
  const rest = body.slice(1);
  const indents = rest.filter((line) => line.trim()).map(indentOf);
  const min = indents.length ? Math.min(...indents) : 0;
  return [body[0], ...rest.map((line) => (line.trim() ? line.slice(min) : ''))];
}

function buildList(lines, ctx) {
  const base = indentOf(lines[0]);
  const ordered = /^\d/.test(ITEM_RE.exec(lines[0])[2]);
  const items = [];
  let i = 0;
  while (i < lines.length) {
    const m = ITEM_RE.exec(lines[i]);
    if (!m || indentOf(lines[i]) !== base) {
      i += 1;
      continue;
    }
    const body = [m[4]];
    i += 1;
    while (i < lines.length) {
      if (!lines[i].trim()) {
        body.push('');
        i += 1;
        continue;
      }
      const next = ITEM_RE.exec(lines[i]);
      if (next && indentOf(lines[i]) === base) break;
      body.push(lines[i]);
      i += 1;
    }
    items.push(dedent(body));
  }

  let anyTask = false;
  const lis = items.map((bodyLines) => {
    const task = ordered ? null : /^\[([ xX])\]\s+(.*)$/.exec(bodyLines[0]);
    if (task) anyTask = true;
    const content = task ? [task[2], ...bodyLines.slice(1)] : bodyLines;
    const loose = bodyLines.slice(1).some((line) => !line.trim());
    let html = renderItems(renderBlocks(content, ctx));
    // 紧凑列表项不套 <p>；有空行的松散列表保留段落
    if (!loose) html = html.replace(/^<p>([\s\S]*?)<\/p>\n?/, '$1\n').trim();
    const done = task && /[xX]/.test(task[1]) ? ' data-done' : '';
    return `<li${done}>${html}</li>`;
  });
  const tag = ordered ? 'ol' : 'ul';
  const cls = anyTask ? ' class="tasks"' : '';
  return `<${tag}${cls}>\n${lis.join('\n')}\n</${tag}>`;
}

function list(lines, i, ctx) {
  const firstIndent = indentOf(lines[i]);
  const ordered = /^\d/.test(ITEM_RE.exec(lines[i])[2]);
  const collected = [];
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j += 1;
      if (j >= lines.length) break;
      const m = ITEM_RE.exec(lines[j]);
      const ind = indentOf(lines[j]);
      if (m && ind === firstIndent && /^\d/.test(m[2]) !== ordered) break;
      if ((m && ind >= firstIndent) || (ind > firstIndent && !startsBlock(lines, j))) {
        collected.push('');
        i += 1;
        continue;
      }
      break;
    }
    const m = ITEM_RE.exec(line);
    const ind = indentOf(line);
    if (m && ind === firstIndent && /^\d/.test(m[2]) !== ordered) break;
    if ((m && ind >= firstIndent) || (!m && ind > firstIndent)) {
      collected.push(line);
      i += 1;
      continue;
    }
    break;
  }
  return { html: buildList(collected, ctx), next: i };
}

function table(lines, i, ctx) {
  const header = splitRow(lines[i]);
  const aligns = splitRow(lines[i + 1]).map(alignOf);
  const rows = [];
  let j = i + 2;
  while (j < lines.length && lines[j].trim() && lines[j].includes('|')) {
    rows.push(splitRow(lines[j]));
    j += 1;
  }
  const cell = (tag, text, idx) => {
    const style = aligns[idx] ? ` style="text-align: ${aligns[idx]}"` : '';
    return `<${tag}${style}>${inline(text, ctx)}</${tag}>`;
  };
  const head = `<thead><tr>${header.map((text, idx) => cell('th', text, idx)).join('')}</tr></thead>`;
  const body = rows.map((row) => `<tr>${header.map((_, idx) => cell('td', row[idx] ?? '', idx)).join('')}</tr>`);
  const tbody = body.length ? `<tbody>\n${body.join('\n')}\n</tbody>` : '';
  return { html: `<table>\n${head}\n${tbody}\n</table>`, next: j };
}

/**
 * <details> 折叠块：<summary> 是标题，其余按 Markdown 转换。写法同 GitHub：
 * <details> 与 <summary> 各占一行，正文和 </details> 前后空一行。没有 summary 时返回 null，按原样 HTML 处理。
 */
function details(lines, i, ctx) {
  let depth = 0;
  let end = i;
  for (; end < lines.length; end += 1) {
    depth += (lines[end].match(/<details\b/gi) ?? []).length;
    depth -= (lines[end].match(/<\/details>/gi) ?? []).length;
    if (depth <= 0) break;
  }
  if (end >= lines.length) return null;
  const block = lines.slice(i, end + 1).join('\n');
  const m = /^\s*<details\b[^>]*>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*)<\/details>\s*$/i.exec(block);
  if (!m) return null;
  const inner = renderItems(renderBlocks(m[2].split('\n'), ctx));
  return {
    html: `<details class="fold">\n<summary>${inline(m[1].trim(), ctx)}</summary>\n<div class="fold-body">\n${inner}\n</div>\n</details>`,
    next: end + 1,
  };
}

function rawHtml(lines, i) {
  const buf = [];
  while (i < lines.length && lines[i].trim()) {
    buf.push(lines[i]);
    i += 1;
  }
  return { html: buf.join('\n'), next: i };
}

/** 块级解析：产出 {kind:'html'|'heading'|'code'} 的序列。 */
export function renderBlocks(lines, ctx) {
  const items = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const fence = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const len = fence[1].length;
      const closeRe = new RegExp(`^ {0,3}\\${marker}{${len},}\\s*$`);
      const buf = [];
      i += 1;
      while (i < lines.length) {
        if (closeRe.test(lines[i])) {
          i += 1;
          break;
        }
        buf.push(lines[i]);
        i += 1;
      }
      const code = buf.join('\n');
      const info = fence[2].trim().split(/\s+/).filter(Boolean);
      const lang = (info[0] ?? '').toLowerCase();
      const item = { kind: 'code', lang, code };
      if (VIZ_SYNTAXES.includes(lang)) {
        ctx.vizFigures = (ctx.vizFigures || 0) + 1;
        const id = `fig-viz-${ctx.vizFigures}`;
        const html = typeof ctx.renderViz === 'function'
          ? ctx.renderViz(lang, code, { id, lang: ctx.lang })
          : vizMarkup(lang, code, { id });
        items.push({ kind: 'viz', html, syntax: lang, source: code, id });
      } else items.push(item);
      continue;
    }
    const heading = /^ {0,3}(#{1,6})[ \t]+(.*?)\s*$/.exec(line);
    if (heading) {
      const level = ctx.levelOf(heading[1].length);
      // 标题末尾的 {#id} 是这个标题的固定 id，交叉引用和链接靠它，不随章节顺序变化
      const [, text, id] = /^(.*?)(?:\s*\{#([A-Za-z][\w-]*)\})?$/.exec(heading[2].replace(/\s+#+\s*$/, '').trim());
      i += 1;
      if (level === 1) {
        ctx.title = ctx.title ?? plainText(text);
        continue;
      }
      items.push({ kind: 'heading', level, text, html: keepNumberUnits(inline(text, ctx)), id });
      continue;
    }
    if (/^ {0,3}<details\b/i.test(line)) {
      const r = details(lines, i, ctx);
      if (r) {
        items.push({ kind: 'html', html: r.html });
        i = r.next;
        continue;
      }
    }
    if (HR_RE.test(line)) {
      items.push({ kind: 'html', html: '<hr>' });
      i += 1;
      continue;
    }
    if (/^ {0,3}>/.test(line)) {
      const r = blockquote(lines, i, ctx);
      items.push({ kind: 'html', html: r.html });
      i = r.next;
      continue;
    }
    if (ITEM_RE.test(line)) {
      const r = list(lines, i, ctx);
      items.push({ kind: 'html', html: r.html });
      i = r.next;
      continue;
    }
    if (isTableStart(lines, i)) {
      const r = table(lines, i, ctx);
      items.push({ kind: 'html', html: r.html });
      i = r.next;
      continue;
    }
    if (HTML_BLOCK.test(line)) {
      const r = rawHtml(lines, i);
      items.push({ kind: 'html', html: r.html });
      i = r.next;
      continue;
    }
    const r = paragraph(lines, i, ctx);
    items.push({ kind: 'html', html: r.html });
    i = r.next;
  }
  return items;
}

const CN_DIGITS = '一二三四五六七八九';
/** 一到九十九的中文数字 */
function cnNumber(text) {
  const m = /^([一二三四五六七八九])?(十)?([一二三四五六七八九])?$/.exec(text);
  if (!m || (!m[2] && (m[1] && m[3]))) return null;
  const digit = (c) => CN_DIGITS.indexOf(c) + 1;
  if (!m[2]) return m[1] ? digit(m[1]) : null;
  return (m[1] ? digit(m[1]) : 1) * 10 + (m[3] ? digit(m[3]) : 0);
}

/** 标题开头的手写编号：返回写法、序号和编号的长度；不像编号时返回 null */
function manualNumber(text) {
  let m = /^(\d+(?:\.\d+)*)(?:[.、]\s*|\s+)(?=\S)/.exec(text);
  if (m) {
    const parts = m[1].split('.');
    return { style: `arabic-${parts.length}`, value: Number(parts.at(-1)), length: m[0].length };
  }
  m = /^([一二三四五六七八九十]+)、\s*(?=\S)/.exec(text) ?? /^[（(]([一二三四五六七八九十]+)[）)]\s*(?=\S)/.exec(text);
  if (m) return { style: m[0][0] === '（' || m[0][0] === '(' ? 'cn-paren' : 'cn', value: cnNumber(m[1]), length: m[0].length };
  return null;
}

/**
 * 外壳给 h2、h3 自动编号，标题里手写的编号会重复。同级的一组标题（全部 h2，或同一个 h2 下的 h3）
 * 都以同一种写法编号、从 1 连续递增时，去掉这组编号；否则开头的数字算标题内容（如「1.0 版本发布」），原样保留。
 */
function stripManualNumbers(items, ctx) {
  const groups = [[]];
  let h3s = [];
  groups.push(h3s);
  for (const item of items) {
    if (item.kind !== 'heading') continue;
    if (item.level === 2) {
      groups[0].push(item);
      h3s = [];
      groups.push(h3s);
    } else if (item.level === 3) h3s.push(item);
  }
  for (const group of groups) {
    if (!group.length) continue;
    const numbers = group.map((item) => manualNumber(item.text));
    const ok = numbers.every((n, i) => n && n.style === numbers[0].style && n.value === i + 1);
    if (!ok) continue;
    group.forEach((item, i) => { item.html = keepNumberUnits(inline(item.text.slice(numbers[i].length), ctx)); });
  }
}

/**
 * 把 Markdown 转成 HTML 内容区。
 * @param {string} md Markdown 原文
 * @param {{lang?: string, baseDir?: string, title?: string, renderViz?: (syntax: string, source: string, options: {id: string, lang: string}) => string}} options
 * @returns {{title: string|null, content: string}}
 */
export function markdownToContent(md, {
  lang = 'zh', baseDir = process.cwd(), title: override = null, renderViz,
} = {}) {
  const langKey = isZhLang(lang) ? 'zh' : 'en';
  const labels = IMPORT_LABELS[langKey];
  const { meta, lines, metadata } = splitFrontMatter(md);
  const multi = lines.filter((line) => /^ {0,3}#[ \t]+/.test(line)).length >= 2;
  // 只有一个 # 时它是文档标题（level 1），否则整体升一级
  const levelOf = (n) => {
    if (n === 1) return multi ? 2 : 1;
    if (n === 2) return multi ? 3 : 2;
    if (n === 3) return multi ? 4 : 3;
    return 4;
  };
  const ctx = {
    baseDir, levelOf, lang: langKey, title: override ?? meta.title ?? null, renderViz,
  };
  const items = renderBlocks(lines, ctx);
  if (metadata) items.unshift({ kind: 'html', html: frontMatterFold(metadata, ctx) });
  stripManualNumbers(items, ctx);
  const title = ctx.title ?? null;

  const pre = [];
  const sections = [];
  let current = null;
  let h2 = 0;
  let h3 = 0;
  let preH3 = 0;
  for (const item of items) {
    if (item.kind === 'heading' && item.level === 2) {
      h2 += 1;
      h3 = 0;
      current = { id: item.id ?? `sec-${h2}`, html: item.html, body: [] };
      sections.push(current);
      continue;
    }
    if (item.kind === 'heading' && item.level === 3) {
      if (current) {
        h3 += 1;
        item.id ??= `sec-${h2}-${h3}`;
      } else {
        preH3 += 1;
        item.id ??= `sec-0-${preH3}`;
      }
    }
    const html = renderItem(item);
    if (current) current.body.push(html);
    else pre.push(html);
  }

  const head = `<header class="doc-head">\n  <h1>${keepNumberUnits(escapeText(title ?? labels.untitled))}</h1>\n</header>`;

  const parts = [head];
  if (pre.length) parts.push(['<section>', ...pre, '</section>'].join('\n'));
  if (sections.length) {
    parts.push([
      '<div class="doc-body">',
      ...sections.map((s) => [
        '<section>',
        `<h2 id="${s.id}">${s.html}</h2>`,
        ...s.body,
        '</section>',
      ].join('\n')),
      '</div>',
    ].join('\n'));
  }
  return { title, content: parts.join('\n\n') };
}
