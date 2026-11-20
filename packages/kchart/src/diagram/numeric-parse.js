import { error, warning } from './support.js';
import { presentation } from './presentation.js';
import { numericLabel } from './numeric-model.js';
import { compositionPresentation } from '../chart/composition.js';

const issue = (info, line, text, en) => error(info.lang, line, text, en, '修正图表语法', 'Correct the chart syntax');
const unquote = text => text.replace(/^(["'])(.*)\1$/, '$2');
const numeric = value => /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(value) && Number.isFinite(Number(value));
export const TREEMAP_MAX_NODES = 201, TREEMAP_MAX_DEPTH = 100;
const linesOf = (source, firstLine) => source.split('\n').map((raw, i) => ({ raw, text: raw.trim(), line: firstLine + i })).filter(x => x.text && !x.text.startsWith('%%'));

export function parsePie(source, info) {
  const errors = [], rows = [], labels = new Set(), duplicates = [];
  const header = info.headerLine || info.firstLine - 1;
  const params = (info.params || '').trim();
  const showData = /^showData\b/i.test(params) || info.options?.showData === true;
  const rest = params.replace(/^showData\b\s*/i, '');
  let title = null, titleLine = null;
  const setTitle = (text, line) => {
    if (title !== null) errors.push(issue(info, line, 'pie 只能有一个 title', 'Pie accepts only one title'));
    else { title = numericLabel(unquote(text), info, line, errors); titleLine = line; }
  };
  if (/^title\s+\S/i.test(rest)) setTitle(rest.replace(/^title\s+/i, ''), header);
  else if (rest) errors.push(issue(info, header, 'pie 只支持 showData 和 title', 'Pie only supports showData and title'));
  for (const { text, line } of linesOf(source, info.firstLine)) {
    if (/^title\s+/i.test(text)) { setTitle(text.replace(/^title\s+/i, ''), line); continue; }
    const m = /^(.+?)\s*:\s*(\S+)$/.exec(text);
    const label = m && numericLabel(unquote(m[1]), info, line, errors);
    if (!label || !numeric(m[2]) || +m[2] < 0) {
      errors.push(issue(info, line, 'pie 数据必须是非负有限数值及非空标签', 'Pie sections require a label and a finite nonnegative value'));
    } else if (labels.has(label)) duplicates.push({ label, line });
    else { labels.add(label); rows.push({ category: label, value: +m[2], line }); }
  }
  if (!rows.length) errors.push(issue(info, info.firstLine, 'pie 至少需要一条数据', 'Pie requires at least one section'));
  if (duplicates.length) {
    const names = [...new Set(duplicates.map(x => x.label))].join(', ');
    errors.push(warning('DIAGRAM_HINT', info.lang, duplicates[0].line, `pie 重复标签仅保留首次值：${names}`, `Pie keeps the first value for duplicate labels: ${names}`, '删除重复条目', 'Remove duplicate sections'));
  }
  if (rows.length > 60) errors.push(warning('LARGE_DIAGRAM', info.lang, rows[60].line,
    '饼图条目较多，建议拆分图表', 'Large pie chart; consider splitting it', '请拆分图表', 'Split the chart'));
  if (rows.length > 6) {
    const overflow = rows.splice(5), value = overflow.reduce((sum, row) => sum + row.value, 0);
    const names = overflow.map(row => row.category).join(', ');
    const other = /^en/i.test(info.lang) ? 'Other' : '其他';
    let category = `${other} (${names})`;
    while (labels.has(category)) category += '*';
    if (!(value > 0)) errors.push(issue(info, overflow[0].line, 'pie 合并项的总值必须大于零', 'The combined pie section must have a positive total'));
    rows.push({ category, value, line: overflow[0].line });
    errors.push(warning('DIAGRAM_HINT', info.lang, overflow[0].line, `pie 已将其余条目合并为其他：${names}`, `Pie combines remaining sections as Other: ${names}`, '如需分别展示，请拆分图表', 'Split the chart to show these sections separately'));
  }
  const position = info.config?.pie?.textPosition;
  const labelRadius = Number.isFinite(position) ? Math.max(.5, Math.min(.95, position)) : .72;
  if (position !== undefined && position !== labelRadius) errors.push(warning('IGNORED_CONFIG', info.lang, info.configLines?.['pie.textposition'] || header, `pie.textPosition 调整为 ${labelRadius}`, `pie.textPosition adjusted to ${labelRadius}`, '使用 0.5 至 0.95', 'Use a value from 0.5 to 0.95'));
  return { model: { chart: 'pie', title, titleLine, showData, rows, labelRadius }, errors };
}

export function parseTreemap(source, info) {
  const errors = [], roots = [], stack = [], levels = [], names = new Map();
  let nodeCount = 0;
  const look = presentation({ lang: info.lang });
  let title = null, titleLine = null;
  for (const key of Object.keys(info.options || {})) errors.push(issue(info, info.headerLine, `treemap 不支持选项 ${key}`, `Unsupported treemap option ${key}`));
  for (const { raw, text, line } of linesOf(source, info.firstLine)) {
    if (look.accept(text, line)) continue;
    if (/^title\s+/i.test(text)) {
      if (title !== null) errors.push(issue(info, line, 'treemap 只能有一个 title', 'Treemap accepts only one title'));
      else { title = numericLabel(unquote(text.replace(/^title\s+/i, '')), info, line, errors); titleLine = line; }
      continue;
    }
    const leading = raw.match(/^[ \t]*/)[0];
    if (leading.includes('\t')) {
      errors.push(error(info.lang, line, 'treemap 缩进不能使用 Tab', 'Treemap indentation cannot use tabs', '用空格缩进', 'Indent with spaces', leading.indexOf('\t') + 1));
      continue;
    }
    const suffix = /:::\s*([\w-]+)\s*$/.exec(text);
    const statement = suffix ? text.slice(0, suffix.index).trimEnd() : text;
    const match = /^("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^:,]+?)(?:\s*[:,]\s*(.+))?$/.exec(statement);
    const name = match && unquote(match[1].trim());
    if (!name || /:::|[{}]/.test(name)) { errors.push(issue(info, line, 'treemap 节点名称无效', 'Invalid treemap node name')); continue; }
    nodeCount += 1;
    if (nodeCount === TREEMAP_MAX_NODES + 1) errors.push(issue(info, line, `treemap 超过安全上限 ${TREEMAP_MAX_NODES} 个节点`, `Treemap exceeds the safety cap of ${TREEMAP_MAX_NODES} nodes; split the diagram`));
    const node = { label: numericLabel(name, info, line, errors), children: [], line };
    if (suffix) look.addClasses(name, [suffix[1]], line);
    names.set(node, name);
    if (match[2] !== undefined) {
      const value = match[2].replace(/[_,]/g, '');
      if (!numeric(value) || Number(value) < 0 || match[2].includes(':::')) errors.push(issue(info, line, 'treemap 权重必须是非负有限数', 'Treemap weights must be finite and nonnegative'));
      else node.value = Number(value);
    }
    const indent = leading.length;
    while (stack.length && indent <= stack.at(-1).indent) stack.pop();
    const depth = stack.length;
    if (depth && levels[depth] !== undefined && levels[depth] !== indent) errors.push(issue(info, line, 'treemap 同级缩进不一致', 'Treemap sibling indentation must match'));
    levels[depth] ??= indent;
    (depth ? stack.at(-1).node.children : roots).push(node);
    stack.push({ indent, node });
  }
  if (!roots.length) errors.push(issue(info, info.firstLine, 'treemap 需要至少一个根节点', 'Treemap requires at least one root'));
  const data = roots.length === 1 ? roots[0] : { label: 'Treemap', children: roots, line: info.firstLine };
  const treeLines = {};
  let maxDepth = 0;
  const clean = (node, path, depth) => {
    maxDepth = Math.max(maxDepth, depth);
    treeLines[path] = node.line;
    if (depth > TREEMAP_MAX_DEPTH) { errors.push(issue(info, node.line, `treemap 超过安全深度上限 ${TREEMAP_MAX_DEPTH} 层`, `Treemap exceeds the safety depth cap of ${TREEMAP_MAX_DEPTH}; split the diagram`)); return; }
    node.children.forEach((child, i) => clean(child, `${path}/children/${i}`, depth + 1));
    if (node.children.length && node.value !== undefined) errors.push(issue(info, node.line, '有子项的 treemap 节点不能同时指定权重', 'Treemap sections with children cannot have weights'));
    if (!node.children.length && node.value === undefined) errors.push(issue(info, node.line, 'treemap 叶节点必须指定权重', 'Treemap leaves require a weight'));
    delete node.line;
  };
  if (roots.length) clean(data, '/data', 1);
  for (const [node, name] of names) node[compositionPresentation] = { status: look.statusOf(name), link: look.linkOf(name) };
  errors.push(...look.diagnostics());
  const pattern = info.config?.treemap?.valueFormat;
  let valueField;
  if (pattern !== undefined && pattern !== ',') {
    const match = /^(\$)?(?:,)?(?:\.([0-6]))?(%|f)?$/.exec(typeof pattern === 'string' ? pattern : '');
    if (pattern === '$0,0') valueField = { unit: '$', decimals: 0 };
    else if (match && pattern) valueField = { ...(match[1] && match[3] !== '%' ? { unit: '$' } : {}), ...(match[2] ? { decimals: +match[2] } : {}), ...(match[3] === '%' ? { format: 'percent' } : {}) };
    else errors.push(warning('IGNORED_CONFIG', info.lang, info.configLines?.['treemap.valueformat'] || info.firstLine, `未识别 treemap.valueFormat ${pattern}`, `Unsupported treemap.valueFormat ${pattern}`, '使用默认数字格式', 'Use the default number format'));
  }
  return { model: { chart: 'treemap', title, titleLine, treeLines, data, nodeCount, depth: maxDepth, namedRoot: roots.length === 1 && data.children.length > 0, valueField, prefix: valueField?.format === 'percent' && pattern.startsWith('$') ? '$' : '' }, errors };
}
