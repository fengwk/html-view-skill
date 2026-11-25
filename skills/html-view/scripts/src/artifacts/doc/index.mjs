import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, relative, resolve, sep } from 'node:path';
import { parseArgs } from '../../shared/args.mjs';
import { emit, fail } from '../../shared/output.mjs';
import { readAsset } from '../../shared/assets.mjs';
import { markdownToContent } from '../../shared/markdown.mjs';
import { inferLang } from '../../shared/locale.mjs';
import { auditShell, parseShell, renderShell } from '../../shared/shell.mjs';
import { selectTheme, themeId, themeOptions, THEME_USAGE } from '../../shared/theme-file.mjs';

export const TYPES = Object.freeze({
  'tech-spec': { layout: 'article', markdownOnly: true },
  plan: { layout: 'article' },
  report: { layout: 'article' },
  doc: { layout: 'article' },
  'one-pager': { layout: 'single' },
  explainer: { layout: 'single' },
});
const TYPE_NAMES = Object.keys(TYPES).join('、');
const usage = `htmlview doc new <file> --type <type> --title <标题> ${THEME_USAGE} [--lang <tag>] [--force]`;
const buildUsage = `htmlview doc build <source.md> --out <file> [--type <type>] ${THEME_USAGE} [--lang <tag>] [--force]`;
const esc = (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const langIsZh = (lang) => /^zh(?:-|$)/i.test(lang);
const normalizeAssetPath = (path) => path.split(sep).join('/');

function validateType(type) {
  if (!Object.hasOwn(TYPES, type)) {
    fail('UNKNOWN_TYPE', `未知文档类型：${type ?? ''}`, { next: `可选类型：${TYPE_NAMES}` });
  }
  return type;
}

function parseDocShell(html, file, options) {
  let doc;
  try { doc = parseShell(html, file, options); }
  catch (error) { fail('BAD_SHELL', `${file} 不是有效的 htmlview 文档：${error.message}`, { next: '用 htmlview doc new 或 doc build 生成文档外壳。' }); }
  if (doc.kind !== 'doc') fail('KIND_MISMATCH', `${file} 不是 doc 产物`, { next: '选择 doc 文件，或确认重建时使用 --force' });
  return doc;
}

function sourceMetadata(source, output) {
  return normalizeAssetPath(relative(dirname(output), source)) || '.';
}

function sameSource(metaSource, output, source) {
  if (!metaSource) return false;
  const recorded = resolve(dirname(output), metaSource.split('/').join(sep));
  return recorded === resolve(source);
}

function retainedMeta(extraHead = '') {
  const reserved = /^(?:charset|viewport|color-scheme|generator|htmlview:)/i;
  return [...String(extraHead).matchAll(/<meta\b[^>]*>/gi)]
    .filter((match) => {
      const name = /\bname=["']([^"']+)["']/i.exec(match[0])?.[1];
      const attribute = /\b(?:property|http-equiv|itemprop)=["'][^"']+["']/i.test(match[0]);
      return (name && !reserved.test(name)) || attribute;
    })
    .map((match) => match[0]).join('\n');
}

function docFrame(layout, lang) {
  const zh = langIsZh(lang);
  const before = [
    `<a class="skip" href="#main">${zh ? '跳到正文' : 'Skip to content'}</a>`,
    '<div class="page">',
    ...(layout === 'article' ? [`<aside class="side" aria-label="${zh ? '目录' : 'Contents'}"><div class="side-title">${zh ? '目录' : 'Contents'}</div><nav class="toc" id="toc" aria-label="${zh ? '文档目录' : 'Document contents'}"></nav></aside>`] : []),
    '<main class="main" id="main">',
    ...(layout === 'article' ? [`<details class="toc-mobile" id="toc-mobile"><summary>${zh ? '目录' : 'Contents'}</summary></details>`] : []),
  ].join('\n');
  return { before, after: '</main>\n</div>' };
}

function renderDoc({ type, title, content, theme, lang = 'zh-CN', source = null, id = randomUUID(), extraHead = '' }) {
  validateType(type);
  const layout = TYPES[type].layout;
  const frame = docFrame(layout, lang);
  return renderShell({
    kind: 'doc', lang, title, theme, extraHead: retainedMeta(extraHead), ...frame,
    attrs: { 'data-layout': layout },
    meta: { 'doc:type': type, 'doc:id': id, ...(source ? { 'doc:source': source } : {}) },
    styles: [readAsset('page/doc.css')],
    content,
    scripts: [readAsset('vendor/prism.js'), readAsset('page/doc.js')],
  });
}

export async function newDoc(argv) {
  const { values, positionals } = parseArgs(argv, {
    type: { type: 'string' }, title: { type: 'string' }, ...themeOptions,
    lang: { type: 'string' }, force: { type: 'boolean' },
  }, { positionals: [1, 1], usage });
  const file = resolve(positionals[0]);
  const type = validateType(values.type);
  if (TYPES[type].markdownOnly) fail('USAGE', `${type} 由 Markdown 源生成，请使用 doc build`, { next: buildUsage });
  if (!values.title) fail('USAGE', '缺少 --title', { next: usage });
  if (values.lang && !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(values.lang)) fail('USAGE', `语言标签不合法：${values.lang}`, { next: '使用 BCP 47 标签，例如 zh-CN、en、ja、pt-BR' });
  if (existsSync(file) && !values.force) {
    fail('FILE_EXISTS', `${file} 已存在`, { next: '换一个路径；确实要重建时才加 --force', state: 'unchanged' });
  }
  const lang = values.lang ?? inferLang(values.title);
  const theme = selectTheme(values, undefined, file);
  const skeleton = `${langIsZh(lang) ? '' : 'en/'}${type}.html`;
  const content = `\n${readAsset(`skeletons/${skeleton}`).replaceAll('{{title}}', esc(values.title)).replace(/\n+$/, '')}\n`;
  const html = renderDoc({ type, title: values.title, content, theme, lang });
  const documentModel = parseDocShell(html, file);
  if (documentModel.meta['doc:type'] !== type) fail('BAD_SHELL', '新文档类型元数据与所选类型不一致。', { next: '重试；不要手工改写 shell 元数据。' });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
  emit({ file, kind: 'doc', type, theme: themeId(theme), layout: TYPES[type].layout, next: `htmlview audit ${file}` });
}

export async function buildDoc(argv) {
  const { values, positionals } = parseArgs(argv, {
    out: { type: 'string' }, type: { type: 'string' }, ...themeOptions,
    lang: { type: 'string' }, force: { type: 'boolean' },
  }, { positionals: [1, 1], usage: buildUsage });
  if (!values.out) fail('USAGE', '缺少 --out', { next: buildUsage });
  const source = resolve(positionals[0]);
  const file = resolve(values.out);
  if (values.lang && !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(values.lang)) fail('USAGE', `语言标签不合法：${values.lang}`, { next: '使用 BCP 47 标签，例如 zh-CN、en、ja、pt-BR' });
  if (!existsSync(source)) fail('SOURCE_NOT_FOUND', `Markdown 源文件不存在：${source}`, { next: '检查源文件路径后重试' });

  let previous = null;
  let type = values.type ?? 'doc';
  const markdown = readFileSync(source, 'utf8');
  let lang = values.lang ?? inferLang(markdown);
  if (existsSync(file) && !values.force) {
    previous = parseDocShell(readFileSync(file, 'utf8'), file);
    if (!sameSource(previous.meta['doc:source'], file, source)) {
      fail('SOURCE_MISMATCH', `${file} 记录的 Markdown 源不是 ${source}`, {
        next: '为这份 Markdown 选择新的 --out；只有明确要替换该产物时才加 --force', state: 'unchanged',
      });
    }
    type = values.type ?? previous.meta['doc:type'];
    lang = values.lang ?? previous.lang;
  }
  validateType(type);
  const theme = selectTheme(values, previous?.themeSnapshot ?? previous?.theme ?? undefined, file);
  const imported = markdownToContent(markdown, {
    lang, baseDir: dirname(source), outDir: dirname(file), renderViz: undefined,
  });
  const title = imported.title || previous?.title;
  if (!title) fail('USAGE', 'Markdown 没有标题，请添加唯一的 # 标题、前言区 title，或通过 --type 外的标题参数指定标题', { next: buildUsage });
  const content = `\n${String(imported.content).replace(/\n+$/, '')}\n`;
  const html = renderDoc({ type, title, content, theme, lang, source: sourceMetadata(source, file), id: previous?.meta['doc:id'], extraHead: previous?.extraHead });
  const current = parseDocShell(html, file);
  const original = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const changed = html !== original;
  const changedParts = compareParts(previous?.content ?? '', current.content);
  if (changed) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
  }
  emit({ file, kind: 'doc', type, theme: themeId(theme), changed, source: sourceMetadata(source, file), changedParts, next: `htmlview audit ${file}` });
}

function headingParts(content) {
  const result = [];
  const used = new Set();
  const uniquePart = (value) => {
    let key = value;
    let index = 2;
    while (used.has(key)) key = `${value}#${index++}`;
    used.add(key);
    return key;
  };
  const headings = [...content.matchAll(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/gi)];
  if (!headings.length) return content.trim() ? [{ part: 'content', content }] : [];
  const bodyStart = headings[0].index;
  if (bodyStart > 0 && content.slice(0, bodyStart).trim()) result.push({ part: uniquePart('intro'), content: content.slice(0, bodyStart) });
  for (let i = 0; i < headings.length; i += 1) {
    const match = headings[i];
    const id = /\bid=["']([^"']+)["']/i.exec(match[1])?.[1];
    const label = match[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    result.push({ part: uniquePart(`section:${id || label || i + 1}`), content: content.slice(match.index, headings[i + 1]?.index ?? content.length) });
  }
  return result;
}

function compareParts(oldContent, nextContent) {
  const oldParts = headingParts(oldContent);
  const nextParts = headingParts(nextContent);
  const oldMap = new Map(oldParts.map(({ part, content }) => [part, content]));
  const nextMap = new Map(nextParts.map(({ part, content }) => [part, content]));
  return [
    ...nextParts.filter(({ part, content }) => oldMap.get(part) !== content).map(({ part }) => part),
    ...oldParts.filter(({ part }) => !nextMap.has(part)).map(({ part }) => `removed:${part}`),
  ];
}

function layoutFailures(doc) {
  const failures = [];
  const expected = TYPES[doc.meta['doc:type']]?.layout;
  if (expected && doc.attrs['data-layout'] !== expected) {
    failures.push({ code: 'DOC_LAYOUT', where: { line: 1, part: 'shell', selector: 'html[data-layout]' }, detail: `${doc.meta['doc:type']} 应使用 ${expected} 版式。`, fix: '使用 htmlview style 重组文档外壳。', ref: 'artifacts/doc.md' });
  }
  if (doc.meta['doc:type'] === 'one-pager') {
    const count = [...doc.content.matchAll(/<h2\b/gi)].length;
    if (count > 5) failures.push({ code: 'DOC_ONE_PAGER_LENGTH', where: { line: doc.contentLine, part: 'content', selector: 'h2' }, detail: `一页纸包含 ${count} 节，超过 5 节。`, fix: '压缩到 5 节以内，待确认事项可列在末尾。', ref: 'artifacts/doc.md' });
    const text = doc.content.replace(/<[^>]*>/g, ' ');
    const length = [...text.matchAll(/\p{Script=Han}/gu)].length + [...text.matchAll(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)].length;
    if (length > 2000) failures.push({ code: 'DOC_ONE_PAGER_LENGTH', where: { line: doc.contentLine, part: 'content' }, detail: `一页纸正文约 ${length} 个中英文字符/词，超过 2000。`, fix: '压缩正文，或改用 report / plan 类型。', ref: 'artifacts/doc.md' });
  }
  return failures;
}

export async function audit(html, { file = '文件' } = {}) {
  let doc;
  try { doc = parseShell(html, file); } catch (error) {
    return { failures: [{ code: 'BAD_SHELL', where: { line: 1, part: 'shell' }, detail: error.message, fix: '恢复有效的 htmlview doc 外壳。' }], notes: [] };
  }
  const failures = [];
  const notes = [];
  if (doc.kind !== 'doc') failures.push({ code: 'KIND_MISMATCH', where: { line: 1, part: 'shell' }, detail: `期望 doc，实际为 ${doc.kind}。`, fix: '使用对应产物命令维护该文件。' });
  else {
    if (!Object.hasOwn(TYPES, doc.meta['doc:type'])) failures.push({ code: 'UNKNOWN_TYPE', where: { line: 1, part: 'shell' }, detail: `未知文档类型：${doc.meta['doc:type'] ?? ''}`, fix: `可选类型：${TYPE_NAMES}` });
    failures.push(...layoutFailures(doc));
  }
  const shared = await auditShell(html, { lang: doc.lang, theme: doc.theme, requireTitle: true });
  return { failures: [...shared.failures, ...failures], notes: [...shared.notes, ...notes] };
}

export function parts(html, { file = '文件' } = {}) {
  const doc = parseDocShell(html, file);
  return headingParts(doc.content);
}

export async function style(argv) {
  const { values, positionals } = parseArgs(argv, {
    ...themeOptions, lang: { type: 'string' },
  }, { positionals: [1, 1], usage: `htmlview style <file> ${THEME_USAGE} [--lang <lang>]` });
  const file = resolve(positionals[0]);
  if (!existsSync(file)) fail('FILE_NOT_FOUND', `文件不存在：${file}`, { next: '检查文件路径后重试' });
  const html = readFileSync(file, 'utf8');
  const doc = parseDocShell(html, file, { allowMissingVizScripts: true });
  if (values.lang && !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(values.lang)) fail('USAGE', `语言标签不合法：${values.lang}`, { next: '使用 BCP 47 标签，例如 zh-CN、en、ja、pt-BR' });
  const type = validateType(doc.meta['doc:type']);
  const theme = selectTheme(values, doc.themeSnapshot ?? doc.theme ?? undefined, file);
  const lang = values.lang ?? doc.lang;
  const frame = docFrame(TYPES[type].layout, lang);
  const updated = renderShell({
    kind: 'doc', lang, title: doc.title, theme, ...frame,
    attrs: { ...doc.attrs, 'data-layout': TYPES[type].layout }, meta: doc.meta,
    extraHead: retainedMeta(doc.extraHead), styles: [readAsset('page/doc.css')], content: doc.content,
    scripts: [readAsset('vendor/prism.js'), readAsset('page/doc.js')],
  });
  parseDocShell(updated, file);
  writeFileSync(file, updated);
  emit({ file, kind: 'doc', type, theme: themeId(theme), changed: updated !== html, next: `htmlview audit ${file}` });
}

export const commands = Object.freeze({ new: newDoc, build: buildDoc });
