import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from '../../shared/args.mjs';
import { decodeEntities, innerHtml, scanElements } from '../../shared/html-util.mjs';
import { emit, fail } from '../../shared/output.mjs';
import { auditShell, parseShell } from '../../shared/shell.mjs';
import { selectTheme, themeId, themeOptions, THEME_USAGE } from '../../shared/theme-file.mjs';
import { copyButtonScript, renderStaticFigure, validVizWidth, VIZ_SOURCE_ID, VIZ_WIDTH } from '../../shared/static-figure.mjs';

function definition(shell) {
  const elements = scanElements(shell.content);
  const sources = elements.filter(({ name, attrs }) => name === 'pre' && attrs.id === VIZ_SOURCE_ID);
  const width = Number(shell.meta[VIZ_WIDTH]);
  const raw = sources.length === 1 ? innerHtml(shell.content, sources[0]) : '';
  if (!raw.startsWith('<code>') || !raw.endsWith('</code>')) return null;
  const source = decodeEntities(raw.slice(6, -7));
  if (!source.trim() || !validVizWidth(width) || !elements.some(({ name }) => name === 'svg')) return null;
  return { source, width };
}
export async function audit(html, { file } = {}) {
  const shell = parseShell(html, file);
  const result = await auditShell(html, { requireTitle: true });
  // 图页只运行生成的复制脚本，不放开任意页内脚本。
  const scripts = scanElements(html).filter(({ name }) => name === 'script');
  const copyScript = scripts.length === 1 && Object.keys(scripts[0].attrs).length === 0
    && shell.scripts.length === 1 && shell.scripts[0].role === 'page'
    && shell.scripts[0].content === copyButtonScript(shell.lang);
  if (!definition(shell) || !copyScript) {
    result.failures.push({ code: 'BAD_VIZ', detail: '静态图页必须包含图形、图形源码与原始宽度，且只允许生成的复制脚本。', fix: '从图形源码重新运行 htmlview viz render。' });
  }
  return result;
}
export function parts(html, { file } = {}) {
  const shell = parseShell(html, file);
  const item = definition(shell);
  return item ? [{ part: VIZ_SOURCE_ID, content: item.source }] : [];
}
export async function style(argv) {
  const { values, positionals } = parseArgs(argv, { ...themeOptions, lang: { type: 'string' } }, {
    positionals: [1, 1], usage: `htmlview style <file> ${THEME_USAGE} [--lang <lang>]`,
  });
  const file = resolve(positionals[0]);
  const html = await readFile(file, 'utf8');
  const shell = parseShell(html, file);
  const item = definition(shell);
  if (!item) fail('BAD_SHELL', '静态图页缺少图形、声明或宽度。', { next: '从图形源码重新运行 htmlview viz render。' });
  const theme = selectTheme(values, shell.themeSnapshot ?? shell.theme ?? undefined, file);
  const rebuilt = await renderStaticFigure(item.source, { theme, width: item.width, lang: values.lang ?? shell.lang });
  const changed = rebuilt.html !== html;
  if (changed) await writeFile(file, rebuilt.html, 'utf8');
  emit({ file, kind: 'viz', theme: themeId(theme), changed });
}
