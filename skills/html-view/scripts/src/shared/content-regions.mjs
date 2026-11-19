// 内容区 API：标记与树解析的职责和通用扫描工具分离。
import { findElement, parseHTML } from './dom.mjs';
import { lineAt, tokens } from './html-util.mjs';
import { ToolError } from './output.mjs';

export const START = '<!-- htmlview:content -->';
export const END = '<!-- /htmlview:content -->';

export function* contentMarkers(source) {
  for (const token of tokens(source)) {
    if (token.type !== 'comment') continue;
    const marker = token.text.slice(4, -3);
    if (!/^\s*\/?\s*htmlview\s*:\s*content\s*$/i.test(marker)) continue;
    yield { ...token, closing: token.text === END, exact: token.text === START || token.text === END };
  }
}

/** 普通 HTML 也支持读取；只有完整的一对统一标记才定义内容区。 */
export function contentMarkerRegions(source) {
  const [open, close, extra] = contentMarkers(source);
  if (!open) return [];
  if (!open.exact || !close?.exact || extra || open.closing || !close.closing) {
    throw new ToolError('BAD_SHELL', '必须且只能包含一对有序、精确拼写的 htmlview 内容标记。', {
      next: `恢复 ${START} 和 ${END}，删掉重复或拼写不符的标记。`,
    });
  }
  return [{ name: 'htmlview', openStart: open.index, start: open.end, end: close.index, closeStart: close.index, closeEnd: close.end }];
}

/** 内容区结束标签/注释独占一行时，结束行取它上一行。 */
function contentEndLine(source, offset) {
  const text = String(source);
  const line = lineAt(text, offset);
  const lineStart = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const before = text.slice(lineStart, offset);
  return before.trim() === '' && lineStart > 0 ? Math.max(1, line - 1) : line;
}

function elementInnerRegion(source, name) {
  const root = parseHTML(source);
  const node = findElement(root, (item) => item.name === name);
  if (!node) return null;
  return { name: null, start: node.innerStart, end: node.innerEnd, openStart: node.start, closeStart: node.innerEnd, closeEnd: node.end };
}

/** 内容处理范围：优先 htmlview 标记，否则按 main/body 或 body/main 回退。 */
export function contentRegions(source, { fallback = 'main' } = {}) {
  let regions = contentMarkerRegions(source);
  if (!regions.length && fallback !== 'all') {
    const names = fallback === 'main' ? ['main', 'body'] : ['body', 'main'];
    for (const name of names) {
      const region = elementInnerRegion(source, name);
      if (region) { regions = [region]; break; }
    }
  }
  if (!regions.length) {
    const length = String(source).length;
    regions = [{ name: null, start: 0, end: length, openStart: 0, closeStart: length, closeEnd: length }];
  }
  return regions.map((region) => ({ ...region, endLine: contentEndLine(source, region.end) }));
}

/** 有内容区标记时返回标记之间的行号范围；无标记返回 null。 */
export function contentLineRanges(source) {
  const regions = contentMarkerRegions(source);
  if (!regions.length) return null;
  return regions.map((region) => ({ start: lineAt(source, region.start), end: contentEndLine(source, region.end) }));
}
