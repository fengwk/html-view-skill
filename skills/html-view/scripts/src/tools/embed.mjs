import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from '../shared/args.mjs';
import { emit, fail } from '../shared/output.mjs';
import { attributeSpans, parseHTML, walkElements } from '../shared/dom.mjs';
import { contentRegions } from '../shared/content-regions.mjs';
import { decodeEntities, escapeHtml, tokens } from '../shared/html-util.mjs';
import { isLocalSrc, readTextFile, toDataUri } from '../shared/media.mjs';

const USAGE = 'htmlview embed <file>';
const SRC_ATTRS = {
  img: ['src'], source: ['src'], video: ['poster'], image: ['href', 'xlink:href'],
};

export async function run(argv) {
  const { positionals } = parseArgs(argv, {}, { positionals: [1, 1], usage: USAGE });
  const file = resolve(positionals[0]);
  if (!existsSync(file)) fail('FILE_NOT_FOUND', `文件不存在：${file}`, { next: '检查路径后重试' });
  let source;
  try { source = readFileSync(file, 'utf8'); }
  catch (error) { fail('USAGE', `无法读取 ${file}：${error.message}`, { next: '检查文件权限后重试' }); }
  if ([...tokens(source)].some(({ type, name, attrs }) => type === 'open' && name === 'meta' && attrs.name === 'htmlview:kind' && attrs.content === 'data')) {
    fail('DATA_INTEGRITY', '数据报表内容区不可原位改写。', { next: '在数据包中提供本地资源后重新运行 htmlview data build。' });
  }
  const regions = contentRegions(source);
  const root = parseHTML(source);
  const embedded = [];
  const missing = [];
  const replacements = [];
  walkElements(root, (node) => {
    if (!regions.some((region) => node.start >= region.start && node.start < region.end)) return;
    if (node.name === 'pre') {
      const span = attributeSpans(source, node.start, node.innerStart).find((item) => item.name === 'data-src');
      if (!span) return;
      const result = readTextFile(decodeEntities(span.value), dirname(file));
      if (result.error) { missing.push({ src: span.value, reason: result.error }); return; }
      embedded.push({ src: span.value, bytes: result.bytes });
      let attrStart = span.nameStart;
      while (attrStart > node.start && /\s/.test(source[attrStart - 1])) attrStart -= 1;
      replacements.push({ start: attrStart, end: span.valueEnd + span.quote.length, text: '' });
      const code = node.children.find((child) => child.type === 'element' && child.name === 'code');
      const text = escapeHtml(result.text);
      replacements.push(code
        ? { start: code.innerStart, end: code.innerEnd, text }
        : { start: node.innerStart, end: node.innerEnd, text: `<code>${text}</code>` });
      return;
    }
    const allowed = SRC_ATTRS[node.name];
    if (!allowed) return;
    for (const span of attributeSpans(source, node.start, node.innerStart)) {
      if (!allowed.includes(span.name)) continue;
      const decoded = decodeEntities(span.value);
      if (!isLocalSrc(decoded)) continue;
      const result = toDataUri(decoded, dirname(file));
      if (result.error) { missing.push({ src: span.value, reason: result.error }); continue; }
      embedded.push({ src: span.value, bytes: result.bytes });
      replacements.push({ start: span.valueStart, end: span.valueEnd, text: span.quote ? result.uri : `"${result.uri}"` });
    }
  });

  const unique = new Map();
  for (const item of replacements) unique.set(`${item.start}:${item.end}`, item);
  let output = source;
  for (const item of [...unique.values()].sort((a, b) => b.start - a.start)) {
    output = output.slice(0, item.start) + item.text + output.slice(item.end);
  }
  if (embedded.length) {
    try { writeFileSync(file, output); }
    catch (error) { fail('USAGE', `无法写入 ${file}：${error.message}`, { next: '检查文件权限后重试' }); }
  }
  emit({ file, embedded, missing, bytes: Buffer.byteLength(output) });
}
