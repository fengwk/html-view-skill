// 本地相对链接改写：产物与 Markdown 源不在同一目录时，指向存在文件的相对链接改成相对产物的路径。
// 绝对路径、带协议的链接、锚点、查询串和找不到目标的相对路径一律原样保留。
import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { decodeEntities } from './html-util.mjs';

const escapeHref = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** 改写一个 href；不需要或无法改写时返回原值。 */
export function relinkHref(href, baseDir, outDir) {
  const value = String(href).trim();
  if (!value || /^[a-z][a-z\d+.-]*:/i.test(value) || /^[/\\#?]/.test(value)) return href;
  const [, pathPart, suffix] = /^([^?#]*)([\s\S]*)$/.exec(value);
  let decoded;
  try { decoded = decodeURIComponent(pathPart); } catch { return href; }
  const target = resolve(baseDir, decoded);
  if (!existsSync(target)) return href;
  let next = relative(outDir, target);
  if (isAbsolute(next)) return href;
  next = next.split(sep).join('/') || '.';
  if (/[/\\]$/.test(pathPart) && !next.endsWith('/')) next += '/';
  // 文件名里的冒号会被读成协议，补 ./；空格、%、#、? 编码后才能留在路径里。
  if (/^[^/]*:/.test(next)) next = `./${next}`;
  return next.replace(/[%\s#?]/g, (ch) => encodeURIComponent(ch)) + suffix;
}

/** 改写 HTML 片段里所有 <a href>；Markdown 链接与手写 HTML 链接走同一处。转义文本里的 &lt;a 不会命中。 */
export function relinkAnchors(html, baseDir, outDir) {
  if (!outDir || resolve(baseDir) === resolve(outDir)) return html;
  return String(html).replace(/<a\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi, (tag) => tag.replace(
    /(\shref\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i,
    (all, lead, double, single, bare) => {
      const href = decodeEntities(double ?? single ?? bare);
      const next = relinkHref(href, baseDir, outDir);
      return next === href ? all : `${lead}"${escapeHref(next)}"`;
    },
  ));
}
