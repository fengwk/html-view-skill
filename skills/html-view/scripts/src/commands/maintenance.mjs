import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from '../shared/args.mjs';
import { emit, fail } from '../shared/output.mjs';
import { parseShell } from '../shared/shell.mjs';
import { listThemes } from '../shared/themes.mjs';

async function read(filename) {
  const file = resolve(filename);
  try { return { file, html: await readFile(file, 'utf8') }; }
  catch (error) {
    fail(error.code === 'ENOENT' ? 'FILE_NOT_FOUND' : 'USAGE', `无法读取文件：${file}`, { next: '核对路径、文件类型和读取权限。' });
  }
}

function parse({ file, html }) {
  try { return parseShell(html, file); }
  catch (error) {
    if (!(error instanceof TypeError)) throw error;
    fail('BAD_SHELL', error.message, { next: '检查统一内容标记和 htmlview:kind；普通 HTML 可用 check、read、shot 等通用命令。' });
  }
}

function formatIssue(issue) {
  const location = typeof issue.where === 'object' && issue.where ? issue.where : {};
  const ref = issue.ref && (issue.ref.startsWith('references/') ? issue.ref : `references/${issue.ref}`);
  const where = {
    line: location.line ?? issue.line ?? null,
    part: location.part ?? issue.scope ?? (typeof issue.where === 'string' ? issue.where : null),
    selector: location.selector ?? issue.selector ?? null,
  };
  return { code: issue.code, where, detail: issue.detail ?? issue.message, fix: issue.fix ?? '检查指向的内容并重试。',
    ...(ref ? { ref } : {}), ...(issue.diagnostics ? { diagnostics: issue.diagnostics } : {}) };
}

export async function audit(argv) {
  const { positionals } = parseArgs(argv, {}, { positionals: [1, 1], usage: 'htmlview audit <file>' });
  const input = await read(positionals[0]);
  const { kind } = parse(input);
  const artifact = await import(`../artifacts/${kind}/index.mjs`);
  const { failures, notes } = await artifact.audit(input.html, { file: input.file });
  const pass = failures.length === 0;
  emit({ file: input.file, kind, pass, failures: failures.map(formatIssue), notes: notes.map(formatIssue) }, pass ? 0 : 1);
}

const partKinds = Object.freeze({ doc: 'section', data: 'view', ui: 'screen' });
export async function diff(argv) {
  const { positionals } = parseArgs(argv, {}, { positionals: [2, 2], usage: 'htmlview diff <old> <new>' });
  const [before, after] = await Promise.all(positionals.map(read));
  const { kind } = parse(after);
  if (parse(before).kind !== kind) fail('KIND_MISMATCH', '只能比较同类产物。', { next: '选择两个同为 doc、data 或 ui 的产物文件。' });
  const { parts } = await import(`../artifacts/${kind}/index.mjs`);
  const toEntries = ({ html, file }) => new Map(parts(html, { file }).map(({ part, content }) => [part, content]));
  const a = toEntries(before), b = toEntries(after);
  const changed = [];
  for (const part of new Set([...a.keys(), ...b.keys()])) {
    if (a.has(part) && b.has(part) && a.get(part) === b.get(part)) continue;
    changed.push({ part, kind: partKinds[kind], change: !a.has(part) ? 'added' : !b.has(part) ? 'removed' : 'modified' });
  }
  emit({ file: after.file, before: before.file, kind, changed });
}

const designOptions = ['device', 'fidelity', 'brand', 'scheme', 'radius', 'density'];
export async function style(argv) {
  const textOptions = Object.fromEntries(['theme', 'lang', ...designOptions].map(key => [key, { type: 'string' }]));
  const usage = 'htmlview style <file> [--theme <id>] [--lang <lang>] [界面稿设计参数]，或 htmlview style --list';
  const { values, positionals } = parseArgs(argv, { ...textOptions, list: { type: 'boolean' } }, { positionals: [0, 1], usage });
  const [file] = positionals;
  if (values.list) {
    if (file || Object.keys(values).length > 1) fail('USAGE', '--list 不接受其他参数。', { next: usage });
    const themes = listThemes().map(({ id, name, en, scheme, desc }) => ({ id, name, en, scheme, desc }));
    return emit({ themes });
  }
  if (!file) fail('USAGE', '缺少 HTML 文件路径。', { next: usage });
  const { kind } = parse(await read(file));
  if (kind !== 'ui' && designOptions.some(key => values[key] !== undefined)) fail('USAGE', '设计参数仅适用于界面稿。', { next: usage });
  if (kind === 'ui' && values.theme !== undefined) fail('USAGE', '界面稿使用 --brand 和 --scheme 控制颜色。', { next: usage });
  if (kind === 'data' && values.lang !== undefined) fail('USAGE', '报表语言由数据包构建参数决定。', { next: '运行 htmlview data build <report.json> --out <file> --lang <lang>。' });
  const artifact = await import(`../artifacts/${kind}/index.mjs`);
  return artifact.style(argv);
}
