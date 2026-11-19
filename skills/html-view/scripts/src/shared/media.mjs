// 本地图片内嵌为 data URI。只使用 Node 内置模块。
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_EMBED_BYTES = 5 * 1024 * 1024;

export const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
};

/** src 指向本地文件：不是 data:、http(s)、协议相对地址、页内锚点。 */
export const isLocalSrc = (src) => {
  const value = String(src ?? '').trim();
  return value !== '' && !/^(?:data:|https?:|\/\/|#|about:|blob:)/i.test(value);
};

/** 去掉查询串与锚点，只保留文件路径。 */
function pathPart(value) {
  const index = value.search(/[?#]/);
  return index < 0 ? value : value.slice(0, index);
}

function localPath(src, baseDir) {
  const value = pathPart(String(src).trim());
  let path;
  try {
    path = value.startsWith('file:') ? fileURLToPath(value) : decodeURI(value);
  } catch {
    path = value;
  }
  if (!isAbsolute(path)) path = resolve(baseDir, path);
  return path;
}

/**
 * 把本地文本文件读成代码块的内容：换行统一成 \n，去掉文件末尾的一个换行。
 * 文件不存在、超过 5 MB、含 NUL 字节（不是文本）都返回 error，由调用方写进 missing。
 * @returns {{text: string, bytes: number} | {error: string}}
 */
export function readTextFile(src, baseDir) {
  const path = localPath(src, baseDir);
  if (!existsSync(path)) return { error: `文件不存在：${path}` };
  let data;
  try {
    const { size } = statSync(path);
    if (size > MAX_EMBED_BYTES) return { error: `文件 ${(size / 1024 / 1024).toFixed(1)} MB，超过 5 MB 上限` };
    data = readFileSync(path);
  } catch (err) {
    return { error: `无法读取文件：${err.message}` };
  }
  if (data.includes(0)) return { error: '不是文本文件' };
  return { text: data.toString('utf8').replace(/\r\n/g, '\n').replace(/\n$/, ''), bytes: data.length };
}

/**
 * 把本地图片读成 data URI。相对路径按 baseDir 解析，支持 file: URL 与 %20 这类转义。
 * 超过 5 MB、类型不支持、文件不存在都返回 error，由调用方写进 missing。
 * @returns {{uri: string, bytes: number} | {error: string}}
 */
export function toDataUri(src, baseDir) {
  const path = localPath(src, baseDir);
  const ext = extname(path).toLowerCase();
  const mime = MIME[ext];
  if (!mime) return { error: `不支持的图片类型：${ext || '没有扩展名'}` };
  if (!existsSync(path)) return { error: `文件不存在：${path}` };
  let size;
  try {
    size = statSync(path).size;
  } catch (err) {
    return { error: `无法读取文件：${err.message}` };
  }
  if (size > MAX_EMBED_BYTES) {
    return { error: `文件 ${(size / 1024 / 1024).toFixed(1)} MB，超过 5 MB 上限` };
  }
  let data;
  try {
    data = readFileSync(path);
  } catch (err) {
    return { error: `无法读取文件：${err.message}` };
  }
  return { uri: `data:${mime};base64,${data.toString('base64')}`, bytes: data.length };
}
