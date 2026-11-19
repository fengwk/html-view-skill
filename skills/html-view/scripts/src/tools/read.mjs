import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from '../shared/args.mjs';
import { emit, fail } from '../shared/output.mjs';
import {
  contentHeadings, documentTitle, findContentElement, loadDocument, renderMarkdown,
} from './html-to-markdown.mjs';

const USAGE = 'htmlview read <file> [--outline | --section <id>] [--out <file>]';

export async function run(argv) {
  const { values, positionals } = parseArgs(argv, {
    outline: { type: 'boolean', default: false },
    section: { type: 'string' },
    out: { type: 'string' },
  }, { positionals: [1, 1], usage: USAGE });
  if (values.outline && values.section != null) {
    fail('USAGE', '--outline 与 --section 不能同时使用', { next: USAGE });
  }
  const file = resolve(positionals[0]);
  if (!existsSync(file)) fail('FILE_NOT_FOUND', `文件不存在：${file}`, { next: '确认路径后重试' });
  let source;
  try { source = readFileSync(file, 'utf8'); }
  catch (error) { fail('USAGE', `无法读取 ${file}：${error.message}`, { next: '检查文件权限后重试' }); }
  const doc = loadDocument(source);

  if (values.outline) {
    const all = contentHeadings(doc).filter((item) => item.level <= 4);
    const headings = all.map((item, index) => {
      let end = item.region.endLine;
      for (let next = index + 1; next < all.length; next += 1) {
        if (all[next].region === item.region && all[next].level <= item.level) {
          end = all[next].line - 1;
          break;
        }
      }
      return { level: item.level, id: item.id, text: item.text, line: item.line, end: Math.max(item.line, end) };
    });
    const result = { file, title: documentTitle(doc), bytes: Buffer.byteLength(source), headings };
    if (values.out == null) emit(result);
    else writeResult(resolve(values.out), JSON.stringify(result, null, 2) + '\n', source);
    return;
  }

  let selection = null;
  if (values.section != null) {
    selection = findContentElement(doc, values.section);
    if (!selection) {
      fail('USAGE', `找不到 id 为 ${values.section} 的元素`, {
        next: `运行 htmlview read ${JSON.stringify(file)} --outline 查看可用 id`,
      });
    }
  }
  const markdown = renderMarkdown(doc, { selection });
  if (values.out == null) {
    process.stdout.write(markdown);
    return;
  }
  writeResult(resolve(values.out), markdown, source);
}

function writeResult(target, content, source) {
  try { writeFileSync(target, content); }
  catch (error) { fail('USAGE', `无法写入 ${target}：${error.message}`, { next: '换一个可写的 --out 路径' }); }
  emit({ file: target, bytes: Buffer.byteLength(content), source_bytes: Buffer.byteLength(source) });
}
