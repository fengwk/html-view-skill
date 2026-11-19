import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { parseArgs } from '../shared/args.mjs';
import { emit, fail } from '../shared/output.mjs';
import { selectTheme, themeId, themeOptions, THEME_USAGE } from '../shared/theme-file.mjs';
import { measureFigure, renderStaticFigure } from '../shared/static-figure.mjs';

const USAGE = `htmlview viz render <source> --out <file.svg|file.html> ${THEME_USAGE} [--width <px>] [--lang <lang>] [--force]`;
function readInput(input) {
  if (input === '-') return readFileSync(0, 'utf8');
  const file = resolve(input);
  if (!existsSync(file)) fail('FILE_NOT_FOUND', `找不到图形源码：${file}`, { next: '确认源码文件路径后重试' });
  try { return readFileSync(file, 'utf8'); }
  catch (error) { fail('USAGE', `无法读取 ${file}：${error.message}`, { next: '检查文件权限后重试' }); }
}

export async function run(argv) {
  const { values, positionals } = parseArgs(argv, {
    out: { type: 'string' }, ...themeOptions, width: { type: 'string', default: '800' },
    lang: { type: 'string' }, force: { type: 'boolean' },
  }, { positionals: [1, 1], usage: USAGE });
  if (!values.out) fail('USAGE', '必须提供 --out <file.svg|file.html>', { next: USAGE });
  const out = resolve(values.out);
  const format = extname(out).toLowerCase();
  if (!['.svg', '.html'].includes(format)) fail('USAGE', '--out 扩展名必须是 .svg 或 .html', { next: USAGE });
  if (!values.force && existsSync(out)) fail('FILE_EXISTS', `目标文件已存在：${out}`, { next: '选择新文件，或明确要替换时才使用 --force。' });
  const input = positionals[0];
  if (input !== '-' && resolve(input) === out) fail('USAGE', '输出不能覆盖声明输入文件', { next: USAGE });
  const theme = selectTheme(values, undefined, out);
  const source = readInput(input).replace(/^\uFEFF/, '');
  const options = { theme, width: Number(values.width), lang: values.lang };
  const measured = format === '.html' ? await renderStaticFigure(source, options) : await measureFigure(source, options);
  const content = measured.html ?? measured.svg;
  try {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, content, 'utf8');
  } catch (error) {
    fail('USAGE', `无法写入 ${out}：${error.message}`, { next: '换一个可写的 --out 路径' });
  }
  emit({ file: out, format: format.slice(1), theme: themeId(theme), width: measured.width, height: measured.height, bytes: Buffer.byteLength(content) });
}
