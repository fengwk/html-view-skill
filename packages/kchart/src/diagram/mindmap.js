/* Controlled Mermaid mindmap parsing into the shared KChart tree contract. */
// chart/mindmap is a required registration dependency: Mermaid reuses its existing eight layouts.

import { error, warning } from './support.js';
import { presentation } from './presentation.js';
import { normalizeLabel } from './label.js';
import { resolveIconRef } from '../core/icons.js';
import { createRegistry, layouts as chartLayouts } from '../chart/registry.js';
import { sizeBudget, validate as validateSpec } from '../chart/spec.js';
import { mindmapPresentation } from '../chart/mindmap.js';

const MAX_NODES = 2000, MAX_DEPTH = 100;
const LAYOUTS = ['bilateral', 'right', 'left', 'radial', 'org', 'brace', 'fishbone', 'timeline'];
// Mermaid's layout-algorithm names have no KChart counterpart; both sides fall back the same way.
const LAYOUT_ALIASES = new Set(['tidy-tree', 'dagre', 'elk', 'cose-bilkent']);
// Written form → KChart node shape, longest delimiter first, as Mermaid's getType (mindmapDb.ts:126-144).
// `))…((` is Mermaid's "bang" outline; `)…(` and the legacy `-)…(-`/`(-…-)` forms are clouds.
const SHAPE_FORMS = [
  ['((', '))', 'circle'],
  ['))', '((', 'bang'],
  ['{{', '}}', 'hexagon'],
  ['-)', '(-', 'cloud'],
  ['(-', '-)', 'cloud'],
  ['[', ']', 'rect'],
  ['(', ')', 'rounded'],
  [')', '(', 'cloud'],
];
const BRACKETS = /[()[\]{}]|-\)|\(-/;

const unquote = value => value.length > 1 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;

// `NODE_ID NODE_DSTART NODE_DESCR NODE_DEND`: the description is what the reader sees; a node without
// delimiters keeps its whole text and has no shape of its own (Mermaid's DEFAULT/no-border).
function parseNodeText(raw) {
  const value = raw.trim();
  const start = value.search(BRACKETS);
  if (start < 0) return { label: unquote(value).trim(), shape: 'none' };
  for (const [open, close, shape] of SHAPE_FORMS) {
    if (!value.startsWith(open, start) || !value.endsWith(close) || value.length < start + open.length + close.length) continue;
    return { label: unquote(value.slice(start + open.length, value.length - close.length).trim()).trim(), shape };
  }
  // An unmatched delimiter stays as text: keeping the label is better than dropping the node.
  return { label: value, shape: '' };
}

// Mermaid's relative indentation: the level is the leading-space count, the parent is the closest
// preceding shallower node, and the first node is the baseline. Siblings need not line up.
function readRecords(lines, firstLine, lang, errors) {
  const records = [];
  for (let [index, raw] of lines.entries()) {
    if (!raw.trim() || raw.trimStart().startsWith('%%')) continue;
    const line = firstLine + index;
    if (/^[ \t]*\t/.test(raw)) {
      errors.push(error(lang, line, '缩进不能使用 Tab', 'Tabs are not allowed in indentation', '把 Tab 换成空格', 'Replace tabs with spaces'));
      continue;
    }
    const indent = raw.match(/^ */)[0].length;
    records.push({ text: raw.slice(indent).trimEnd(), line, indent });
  }
  return records;
}

function parse(body, info = {}) {
  const lang = info.lang || 'zh';
  const firstLine = Number.isInteger(info.firstLine) ? info.firstLine : 2;
  const headerLine = info.headerLine || firstLine - 1;
  const errors = [];
  const addError = (line, zh, en, fixZh = '修正脑图语法后重试', fixEn = 'Correct the mindmap syntax and try again', column = 1) => {
    errors.push(error(lang, line, zh, en, fixZh, fixEn, column));
  };
  const lines = String(body ?? '').split('\n');

  // Decorations are consumed first: they always belong to the node line just above them.
  const look = presentation({ lang }), assets = new Set(), identifiers = new Map();
  const addAsset = diagnostic => { if (!assets.has(diagnostic.message)) { assets.add(diagnostic.message); errors.push(diagnostic); } };
  const decorationByLine = new Map();
  let previousNodeLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    if (look.accept(trimmed, firstLine + i)) { lines[i] = ''; continue; }
    if (/^(?::::|::icon\b)/i.test(trimmed)) {
      lines[i] = '';
      const classes = /^:::\s*([\w-]+(?:\s+[\w-]+)*)$/.exec(trimmed)?.[1];
      const ref = /^::icon\(\s*([^()]+?)\s*\)$/i.exec(trimmed)?.[1];
      if (previousNodeLine < 0 || (!classes && !ref)) {
        addError(firstLine + i, '脑图装饰无效或前面缺少节点', 'Malformed mindmap decoration or missing preceding node');
      } else {
        const decoration = decorationByLine.get(previousNodeLine) || { classes: [] };
        if (classes) decoration.classes.push(...classes.split(/\s+/));
        if (ref) {
          decoration.icon = resolveIconRef(ref);
          if (!decoration.icon) addAsset(warning('IGNORED_ASSET', lang, firstLine + i, `未知图标 ${ref}`, `Unknown icon ${ref}`, '改用内置图标', 'Use a supported icon'));
        }
        decorationByLine.set(previousNodeLine, decoration);
      }
      continue;
    }
    previousNodeLine = i;
  }

  const records = readRecords(lines, firstLine, lang, errors);
  const roots = [], stack = [], linesByPath = new Map();
  let nodeCount = 0, maxDepth = 0;
  for (const record of records) {
    while (stack.length && record.indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1)?.node ?? null;
    const depth = stack.length;
    maxDepth = Math.max(maxDepth, depth + 1);
    const { label: rawLabel, shape } = parseNodeText(record.text);
    const id = (shape !== 'none' ? record.text.split(BRACKETS, 1)[0].trim() : '') || rawLabel;
    const normalized = normalizeLabel(rawLabel, { lang, line: record.line });
    normalized.diagnostics.forEach(addAsset);
    const label = normalized.text || (normalized.icon ? id || ' ' : '');
    nodeCount += 1;
    if (nodeCount === MAX_NODES + 1) addError(record.line, `脑图超过安全上限 ${MAX_NODES} 个节点`, `Mindmap exceeds the safety cap of ${MAX_NODES} nodes`, '拆分脑图后重试', 'Split the mindmap and try again');
    if (depth >= MAX_DEPTH) addError(record.line, `脑图超过安全深度上限 ${MAX_DEPTH} 层`, `Mindmap exceeds the safety depth cap of ${MAX_DEPTH}`, '拆分脑图或降低层级', 'Split the mindmap or reduce its depth');
    if (/:::(?:[\w-]+)?|::icon\(/i.test(record.text)) {
      addError(record.line, '不支持行内节点装饰', 'Inline node decorations are unsupported', '在节点下一行使用受控 :::状态 标记', 'Use a supported :::status marker on the next line');
    }
    if (!label) addError(record.line, '节点名称不能为空', 'Node label cannot be empty');
    const node = { label, children: [] };
    if (shape) node.shape = shape;
    const decoration = decorationByLine.get(record.line - firstLine);
    if (decoration?.classes.length) look.addClasses(id, decoration.classes, record.line);
    identifiers.set(node, { id, icon: decoration?.icon || normalized.icon });
    const sibling = parent ? parent.children.length : roots.length;
    linesByPath.set(parent ? `${stack.at(-1).path}/children/${sibling}` : `/roots/${sibling}`, record.line);
    const path = parent ? `${stack.at(-1).path}/children/${sibling}` : `/roots/${sibling}`;
    if (parent) parent.children.push(node);
    else if (roots.length) {
      // Mermaid refuses a second root. Render the document anyway: the extra root becomes a child so no label is lost.
      addError(record.line, `mindmap 只能有一个根节点：「${label}」没有父节点`, `A mindmap can have only one root: "${label}" has no parent`, '把该节点缩进到更浅一级的节点下面', 'Indent this node under a shallower node');
      roots[0].children.push(node);
    } else roots.push(node);
    stack.push({ indent: record.indent, node, path });
  }
  if (!roots.length) addError(firstLine, '脑图中没有节点', 'Mindmap is empty', '保留一个根节点并将其他节点缩进到它下面', 'Keep one root node and indent all other nodes beneath it');

  // Layout names: KChart's own vocabulary, Mermaid's algorithm names, and warn-and-fall-back for anything else.
  const layoutValue = info.config?.layout ?? info.config?.mindmap?.layoutAlgorithm ?? (typeof info.layout === 'string' ? info.layout : info.layout?.config?.layout ?? info.layout?.layout);
  let layout = 'bilateral';
  if (layoutValue != null && layoutValue !== '') {
    const candidate = String(layoutValue).toLowerCase();
    if (LAYOUT_ALIASES.has(candidate)) layout = 'bilateral';
    else if (LAYOUTS.includes(candidate)) layout = candidate;
    else {
      errors.push(warning('IGNORED_CONFIG', lang, headerLine,
        `脑图布局「${layoutValue}」不生效；按 bilateral 排版`, `Mindmap layout "${layoutValue}" is not honored; laid out as bilateral`,
        '改用 bilateral、right、left、radial、org、brace、fishbone 或 timeline', 'Use bilateral, right, left, radial, org, brace, fishbone, or timeline'));
    }
  }
  for (const key of Object.keys(info.options || {})) {
    addError(headerLine, `脑图头行不支持选项「${key}」`, `Mindmap header option is unsupported: ${key}`, '移除头行选项，使用 config.layout 指定布局', 'Remove the header option; use config.layout to choose a layout');
  }

  // The first root becomes /data, so schema paths keep the shape the tree contract expects.
  const data = roots[0] || { label: '' };
  if (linesByPath.has('/roots/0')) linesByPath.set('/data', linesByPath.get('/roots/0'));
  errors.push(...look.diagnostics());
  for (const [node, { id, icon }] of identifiers) {
    const status = look.statusOf(id);
    if (status) node.status = status;
    node[mindmapPresentation] = { icon, link: look.linkOf(id) };
  }
  // The parser above enforces the Mermaid caps with its own diagnostics; the native chart checks only what is left.
  const spec = { chart: 'mindmap', data, layout, [mindmapPresentation]: true, [sizeBudget]: { nodes: MAX_NODES + 1, depth: MAX_DEPTH + 1 } };
  Object.defineProperties(spec, { nodeCount: { value: nodeCount }, maxDepth: { value: maxDepth } });
  if (info.title) spec.title = info.title;
  const checked = validateSpec(spec);
  for (const issue of checked.errors) {
    let path = '', line = firstLine;
    for (const part of issue.path.split('/').slice(1)) {
      path += `/${part}`;
      if (linesByPath.has(path)) line = linesByPath.get(path);
    }
    errors.push({ ...error(lang, line, issue.message, issue.message, issue.fix, issue.fix), code: issue.code, path: issue.path });
  }
  return { model: spec, errors };
}

const mindmapRegistry = createRegistry(validateSpec);
mindmapRegistry.register('mindmap', chartLayouts.get('mindmap'));

function layout(model, options = {}, info = {}) {
  // With many siblings bilateral rails cross labels and share long collinear runs.
  // Radial spacing grows with leaf count, giving each branch a distinct sector.
  const radial = model.nodeCount > 80 && model.layout !== 'radial';
  const scene = mindmapRegistry.layout(radial ? { ...model, layout: 'radial' } : model, options.renderOptions || options);
  const requested = options.width || 800;
  const large = model.nodeCount > 60 || model.maxDepth > 5 || scene.width > requested * 2;
  const errors = large ? [warning('LARGE_DIAGRAM', info.lang || options.lang || 'zh', info.firstLine || 1,
    radial ? '大型脑图使用径向布局以避免重叠' : '脑图较大，可在图内滚动查看',
    radial ? 'Large mindmap uses radial layout to avoid overlaps' : 'Large mindmap; scroll within the figure',
    '拆分脑图以便阅读', 'Split the mindmap for readability')] : [];
  return { width: scene.width, height: scene.height, scene, errors };
}

export const implementations = { mindmap: { acceptsPresentation: true, honoredConfig: ['layout', 'mindmap.layoutAlgorithm'], parse, layout, scene: geometry => geometry.scene } };
