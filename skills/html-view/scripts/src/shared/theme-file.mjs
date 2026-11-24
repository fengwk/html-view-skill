import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { themes, resolveThemeConfig, validateThemeSnapshot } from '../../../vendor/kchart/esm/node.js';
import { fail } from './output.mjs';
import { DEFAULT_THEME } from './themes.mjs';
import { THEME_USAGE } from './theme-options.mjs';

export { THEME_USAGE };
export const THEME_META = 'theme';
export const themeOptions = { theme: { type: 'string' }, 'theme-file': { type: 'string' } };
const customId = /^custom-(?:[a-z][a-z0-9-]{0,47}-)?([0-9a-f]{64})$/;
const MAX_FILE_SIZE = 32 * 1024;
const themeFix = '使用有效的主题 JSON；字段和示例见 references/guides/themes.md。';
export const themeId = (theme) => typeof theme === 'string' ? theme : theme.id;
const dataOf = ({ id, ...data }) => data;
const digest = (theme) => createHash('sha256').update(JSON.stringify(dataOf(theme))).digest('hex');

export function selectTheme(values, fallback = DEFAULT_THEME, output) {
  const input = values['theme-file'];
  if (input === undefined) {
    if (values.theme === undefined) return fallback;
    if (!Object.hasOwn(themes, values.theme)) fail('UNKNOWN_THEME', `没有主题：${values.theme}`, { next: '运行 htmlview style --list 查看内置主题，或用 --theme-file 传入主题文件。' });
    return values.theme;
  }
  if (values.theme !== undefined) fail('USAGE', '--theme 和 --theme-file 只能选一个。', { next: `使用 ${THEME_USAGE}。` });
  if (!input) fail('BAD_THEME', '--theme-file 需要非空文件路径。', { next: themeFix });
  const file = resolve(input);
  const badFile = (message, reason) => fail('BAD_THEME', message, { next: themeFix, details: { path: file, reason } });
  let info;
  try { info = statSync(file, { bigint: true }); }
  catch (error) {
    if (error.code === 'ENOENT') fail('FILE_NOT_FOUND', `找不到主题文件：${file}`, { next: '检查 --theme-file 的路径。', details: { path: file } });
    badFile(`无法读取主题文件：${file}`, error.code);
  }
  if (!info.isFile() || info.size > BigInt(MAX_FILE_SIZE)) badFile('主题必须是普通 JSON 文件，且不超过 32 KiB。', 'file');
  if (output !== undefined) {
    let target;
    try { target = statSync(output, { bigint: true, throwIfNoEntry: false }); }
    catch { fail('BAD_PATH', `无法检查输出路径：${output}`, { next: '选择一个可写的输出路径。' }); }
    if (target && info.ino === target.ino && info.dev === target.dev) fail('BAD_PATH', '输出不能覆盖 --theme-file 的源文件。', { next: '指定另一个输出路径。' });
  }
  let text;
  try { text = readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); }
  catch (error) { badFile(`无法读取主题文件：${file}`, error.code); }
  let config;
  try { config = JSON.parse(text); }
  catch { badFile('主题文件不是有效的 JSON。', 'json'); }
  let snapshot;
  try { snapshot = resolveThemeConfig(config); }
  catch (error) {
    if (error?.name !== 'TypeError') throw error;
    badFile(error.message, 'schema');
  }
  return Object.freeze({ ...snapshot, id: `custom-${snapshot.id ? `${snapshot.id}-` : ''}${digest(snapshot)}` });
}

export function restoreTheme(id, text) {
  if (text === undefined) {
    if (id === null || Object.hasOwn(themes, id)) return id;
    throw new TypeError(customId.test(id) ? '缺少内嵌主题快照（htmlview:theme）' : `未知 data-theme：${id}`);
  }
  const match = customId.exec(id ?? '');
  if (!match) throw new TypeError('仅自定义主题可携带 htmlview:theme');
  try {
    const parsed = JSON.parse(text);
    const snapshot = validateThemeSnapshot(parsed);
    if (snapshot.id !== id || digest(snapshot) !== match[1]) throw new TypeError('内嵌主题与 data-theme 不匹配');
    return snapshot;
  } catch (error) {
    if (!['TypeError', 'SyntaxError'].includes(error.name)) throw error;
    throw new TypeError(`htmlview:theme 无效：${error.name === 'SyntaxError' ? '不是有效的 JSON' : error.message}`);
  }
}
