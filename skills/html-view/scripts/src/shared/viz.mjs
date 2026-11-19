import { createRenderer, modulesFor, parse } from '../../../kchart/node.mjs';
import { decodeEntities, scanElements } from './html-util.mjs';

export const VIZ_SYNTAXES = Object.freeze(['kchart', 'mermaid', 'layers', 'blocks', 'swimlane']);
const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const lineAt = (source, offset) => source.slice(0, offset).split('\n').length;

export function vizMarkup(syntax, source, { id } = {}) {
  if (!VIZ_SYNTAXES.includes(syntax)) throw new TypeError(`不支持的图形语法：${syntax}`);
  const idAttr = id == null ? '' : ` id="${esc(id)}"`;
  return `<pre data-viz="${syntax}"${idAttr}>${esc(source)}</pre>`;
}

/** 收集唯一源代码标记；source 是实体解码后的原始图形源码。 */
export function collectViz(content) {
  const text = String(content);
  return scanElements(text).filter((element) => element.name === 'pre' && element.attrs['data-viz'] != null).map((element) => ({
    syntax: decodeEntities(element.attrs['data-viz']),
    source: decodeEntities(text.slice(element.openEnd, element.closeStart)),
    id: element.attrs.id == null ? null : decodeEntities(element.attrs.id),
    line: lineAt(text, element.start),
    offset: element.start,
  }));
}

const topicRef = Object.freeze(Object.fromEntries([
  ...['architecture', 'data-model', 'flow', 'hierarchy', 'sequence', 'time'].map(topic => [topic, `diagrams/${topic}.md`]),
  ...['composition', 'trend', 'matrix', 'network'].map(topic => [topic, `charts/${topic}.md`]),
]));
function vizFailure(item, contentLine, detail) {
  const diagnosticLine = detail?.line ?? detail?.location?.line ?? 1;
  return {
    code: 'BAD_VIZ',
    where: { line: contentLine + item.line + diagnosticLine - 2, part: item.id || item.syntax, selector: 'pre[data-viz]' },
    detail: detail?.message ?? String(detail),
    fix: detail?.fix ?? '按图形声明契约修正输入。',
    ref: `references/${topicRef[detail?.topic] ?? (item.syntax === 'kchart' ? 'charts/common.md' : 'diagrams/flow.md')}`,
    ...(typeof detail === 'object' && detail ? { diagnostics: [detail] } : {}),
  };
}

/** 校验并布局真实 KChart 源码；不触碰旧图表引擎或表格图数据模型。 */
export function auditViz(content, { lang = 'zh-CN', theme = 'claude', requireTitle = false, contentLine = 1, width = 800 } = {}) {
  const items = collectViz(content);
  const failures = [];
  const notes = [];
  const supported = items.filter((item) => VIZ_SYNTAXES.includes(item.syntax));
  for (const item of items) if (!VIZ_SYNTAXES.includes(item.syntax)) failures.push(vizFailure(item, contentLine, `未知 data-viz 类型：${item.syntax}`));
  const parsed = new Map();
  const declarations = [];
  for (const item of supported) {
    if (item.syntax === 'kchart') {
      const { data, errors } = parse(item.source);
      failures.push(...errors.map(error => vizFailure(item, contentLine, error)));
      if (errors.length) continue;
      parsed.set(item, data);
      declarations.push(data);
    } else declarations.push({ source: item.source, syntax: item.syntax });
  }
  if (!declarations.length) return { failures, notes };
  const renderer = createRenderer({ specs: declarations });
  for (const item of supported) {
    if (item.syntax === 'kchart' && !parsed.has(item)) continue;
    const spec = parsed.get(item);
    const { svg, scene, diagnostics } = item.syntax === 'kchart'
      ? renderer.render(spec, { lang, theme, width })
      : renderer.diagram(item.source, { syntax: item.syntax, lang, theme, width });
    for (const diagnostic of diagnostics) failures.push(vizFailure(item, contentLine, diagnostic));
    if (!svg && !diagnostics.length) throw new Error('图形渲染没有返回 SVG 或诊断');
    if (requireTitle && svg && !(spec?.title ?? scene?.heading)?.trim()) failures.push(vizFailure(item, contentLine, {
      message: '文档图形缺少图题', fix: '为 KChart 声明写 title，或为结构图添加 title 前言。',
    }));
  }
  return { failures, notes };
}

export function modulesForContent(content) {
  const items = collectViz(content);
  const declarations = [];
  for (const item of items) {
    if (item.syntax === 'kchart') {
      try { declarations.push(JSON.parse(item.source)); } catch { /* audit reports malformed sources */ }
    } else if (VIZ_SYNTAXES.includes(item.syntax)) declarations.push({ source: item.source, syntax: item.syntax });
  }
  return declarations.length ? modulesFor(declarations) : [];
}
