import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';

const root = resolve(fileURLToPath(new URL('../../../assets/', import.meta.url)));

/** 读取 html-view/assets 下的文本资产；拒绝越界路径与符号化路径穿越。 */
export function readAsset(name) {
  if (typeof name !== 'string' || !name || name.includes('\0')) throw new TypeError('资产名称无效');
  const file = resolve(root, name);
  if (file !== root && !file.startsWith(root + sep)) throw new TypeError('资产路径越界');
  return readFileSync(file, 'utf8');
}
