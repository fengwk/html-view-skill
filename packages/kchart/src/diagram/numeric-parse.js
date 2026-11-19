import { error } from './support.js';

const issue = (info, line, text, fix = '修正 Mermaid 数值图语法；不支持的语句请移除') => error(info.lang, line, text, `Unsupported or invalid Mermaid chart syntax: ${text}`, fix, 'Correct the Mermaid chart syntax or remove the unsupported statement');
const unquote = value => { const text = value.trim(); return ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) ? text.slice(1, -1).replace(/\\([\\"'])/g, '$1') : text; };
const numeric = value => /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(String(value).trim()) && Number.isFinite(Number(value));
const linesOf = (source, firstLine) => String(source).split('\n').map((raw, i) => ({ raw, text: raw.trim(), line: firstLine + i })).filter(x => x.text && !x.text.startsWith('%%'));
const badOptions = (info, name, errors, allowShowData = false) => {
  for (const [key, value] of Object.entries(info.options || {})) if (!(allowShowData && key === 'showData' && value === true)) errors.push(issue(info, info.headerLine || info.firstLine - 1, `${name} 不支持选项「${key}」`, allowShowData ? '只接受无值的 showData 选项' : undefined));
};
const quotedList = input => {
  const out = []; let current = '', quote = '', escaped = false;
  for (const ch of input) { if (escaped) { current += ch; escaped = false; continue; } if (ch === '\\' && quote) { escaped = true; continue; } if (quote) { if (ch === quote) quote = ''; else current += ch; continue; } if (ch === '"' || ch === "'") quote = ch; else if (ch === ',') { out.push(current.trim()); current = ''; } else current += ch; }
  if (quote) return null; if (current.trim() || input.endsWith(',')) out.push(current.trim()); return out;
};
const finiteList = input => { const list = quotedList(input); return !list || !list.length || list.some(x => !numeric(x)) ? null : list.map(Number); };
function pie(source, info) {
  const errors = [], rows = []; let title = null, titleLine = null;
  badOptions(info, 'pie', errors, true);
  for (const item of linesOf(source, info.firstLine)) {
    if (/^title\s+/i.test(item.text)) { if (title !== null) errors.push(issue(info, item.line, 'pie 只能有一个 title')); else { title = unquote(item.text.replace(/^title\s+/i, '')); titleLine = item.line; } continue; }
    const m = /^(.+?)\s*:\s*(\S+)\s*$/.exec(item.text);
    if (!m) { errors.push(issue(info, item.line, `无法识别 pie 语句「${item.text}」`)); continue; }
    const label = unquote(m[1]); if (!label || !numeric(m[2]) || Number(m[2]) < 0) errors.push(issue(info, item.line, 'pie 数据必须是非负有限数值及非空标签')); else rows.push({ category: label, value: Number(m[2]), line: item.line });
  }
  if (!rows.length) errors.push(issue(info, info.firstLine, 'pie 至少需要一条数据'));
  if (new Set(rows.map(x => x.category)).size !== rows.length) errors.push(issue(info, info.firstLine, 'pie 类别不得重复'));
  return { model: { chart: 'pie', title, titleLine, showData: !!info.options?.showData, rows }, errors };
}
function xy(source, info) {
  const errors = [], datasets = []; let title = null, titleLine = null, categories = null, xLabel = null, xLine = null, yLabel = null, yLine = null, yDomain = null, hasY = false;
  badOptions(info, info.kind, errors);
  for (const item of linesOf(source, info.firstLine)) { let m;
    if ((m = /^title\s+(.+)$/i.exec(item.text))) { if (title !== null) errors.push(issue(info, item.line, 'xychart 只能有一个 title')); else { title = unquote(m[1]); titleLine = item.line; } }
    else if ((m = /^x-axis(?:\s+(.+?))?\s*\[([^\]]*)\]\s*$/i.exec(item.text))) { if (categories) errors.push(issue(info, item.line, 'xychart 只能有一个 x-axis')); else { xLine = item.line; xLabel = m[1] ? unquote(m[1]) : null; categories = quotedList(m[2]); if (!categories?.length || categories.some(x => !x)) errors.push(issue(info, item.line, 'x-axis 需要非空类别列表')); } }
    else if (/^y-axis(?:\s+.*)?$/i.test(item.text)) { if (hasY) errors.push(issue(info, item.line, 'xychart 只能有一个 y-axis')); hasY = true; yLine = item.line; const rest = item.text.replace(/^y-axis\s*/i, ''), range = /^(.*?)\s*([-+\d.eE]+)\s*-->\s*([-+\d.eE]+)\s*$/.exec(rest), label = range ? range[1] : rest; yLabel = label ? unquote(label) : null; if (range) { if (!numeric(range[2]) || !numeric(range[3]) || Number(range[2]) >= Number(range[3])) errors.push(issue(info, item.line, 'y-axis 范围必须为递增有限数')); else yDomain = [+range[2], +range[3]]; } }
    else if ((m = /^(bar|line)\s*\[([^\]]*)\]\s*$/i.exec(item.text))) { const values = finiteList(m[2]); if (!values) errors.push(issue(info, item.line, 'bar/line 需要有限数值列表')); else datasets.push({ type: m[1].toLowerCase(), values, line: item.line }); }
    else errors.push(issue(info, item.line, `无法识别 xychart 语句「${item.text}」`));
  }
  if (!datasets.length) errors.push(issue(info, info.firstLine, 'xychart 至少需要一条 bar 或 line 数据'));
  if (datasets.length > 6) errors.push(issue(info, datasets[6].line, 'xychart 最多支持六条数据序列'));
  if (datasets.length === 1 && datasets[0].type === 'bar') datasets[0].type = 'column';
  categories ||= datasets[0]?.values.map((_, i) => String(i + 1)) || [];
  for (const d of datasets) if (categories.length !== d.values.length) errors.push(issue(info, d.line, `x-axis 类别数 ${categories.length} 与数据点数 ${d.values.length} 不一致`));
  const values = datasets.flatMap(d => d.values);
  if (yDomain && values.some(v => v < yDomain[0] || v > yDomain[1])) errors.push(issue(info, info.firstLine, 'y-axis domain 不得裁剪数据'));
  if (yDomain && datasets.some(d => d.type === 'bar' || d.type === 'column') && yDomain[0] > 0) errors.push(issue(info, info.firstLine, '柱形图 y-axis domain 必须包含 0 基线'));
  return { model: { chart: datasets.length > 1 ? 'combo' : datasets[0]?.type || 'line', title, titleLine, xLabel, xLine, yLabel, yLine, yDomain, categories, datasets }, errors };
}
function csv(text) { const cells = []; let value = '', quoted = false, after = false; for (let i = 0; i < text.length; i++) { const ch = text[i]; if (quoted) { if (ch === '"' && text[i + 1] === '"') { value += '"'; i++; } else if (ch === '"') { quoted = false; after = true; } else value += ch; } else if (ch === '"') { if (value.trim() || after) return null; value = ''; quoted = true; } else if (ch === ',') { cells.push(value.trim()); value = ''; after = false; } else if (after && !/\s/.test(ch)) return null; else value += ch; } if (quoted) return null; cells.push(value.trim()); return cells; }
function sankey(source, info) {
  const errors = [], rows = []; badOptions(info, 'sankey-beta', errors);
  String(source).split('\n').forEach((raw, i) => { const text = raw.trim(); if (!text || text.startsWith('%%')) return; const line = info.firstLine + i, cells = csv(text); if (!cells) { errors.push(issue(info, line, 'sankey CSV 引号格式错误')); return; } if (cells.length !== 3 || !cells[0] || !cells[1] || !numeric(cells[2]) || Number(cells[2]) <= 0) { errors.push(issue(info, line, 'sankey 每行须为 Source,Target,正有限 Value')); return; } rows.push({ id: `edge-${rows.length + 1}`, source: cells[0], target: cells[1], value: Number(cells[2]), line }); });
  if (!rows.length) errors.push(issue(info, info.firstLine, 'sankey 至少需要一条有效流量 CSV 记录'));
  const nodes = [...new Set(rows.flatMap(r => [r.source, r.target]))]; return { model: { chart: 'sankey', nodes: nodes.map(id => ({ id, label: id })), edges: rows }, errors };
}
function radar(source, info) {
  const errors = [], curves = []; let axes = null, axisLine = null, title = null, titleLine = null, max = null, maxLine = null, min = null, ticks = null, legend = null; badOptions(info, 'radar-beta', errors);
  for (const item of linesOf(source, info.firstLine)) { let m;
    if ((m = /^title\s+(.+)$/i.exec(item.text))) { if (title !== null) errors.push(issue(info, item.line, 'radar 只能有一个 title')); else { title = unquote(m[1]); titleLine = item.line; } }
    else if ((m = /^axis\s+(.+)$/i.exec(item.text))) { if (axes) errors.push(issue(info, item.line, 'radar 只能有一个 axis')); else { axes = quotedList(m[1]); axisLine = item.line; } }
    else if ((m = /^curve\s+(.+?)\s*\{([^}]*)\}\s*$/i.exec(item.text))) { const values = finiteList(m[2]); if (!values) errors.push(issue(info, item.line, 'curve 必须包含有限数值列表')); else curves.push({ label: unquote(m[1]), values, line: item.line }); }
    else if ((m = /^(max|min|ticks)\s+(\S+)$/i.exec(item.text))) { const n = Number(m[2]); if (!numeric(m[2]) || m[1].toLowerCase() === 'ticks' && (!Number.isInteger(n) || n < 1)) errors.push(issue(info, item.line, `radar ${m[1]} 值无效`)); else if (m[1].toLowerCase() === 'max') { max = n; maxLine = item.line; } else if (m[1].toLowerCase() === 'min') min = n; else ticks = n; }
    else if ((m = /^showLegend\s+(true|false)$/i.exec(item.text))) legend = m[1].toLowerCase() === 'true'; else errors.push(issue(info, item.line, `无法识别 radar 语句「${item.text}」`));
  }
  if (!axes || axes.length < 3 || axes.some(x => !x) || new Set(axes).size !== axes.length) errors.push(issue(info, info.firstLine, 'radar axis 必须包含至少三个不重复的维度'));
  if (!curves.length) errors.push(issue(info, info.firstLine, 'radar 至少需要一条 curve'));
  for (const c of curves) if (axes && c.values.length !== axes.length) errors.push(issue(info, c.line, `curve「${c.label}」的值数量须与 axis 数量一致`));
  if (min != null && max != null && min >= max) errors.push(issue(info, info.firstLine, 'radar min 必须小于 max'));
  if (ticks != null || legend != null || min != null && min !== 0) errors.push(issue(info, info.firstLine, 'KChart radar DSL 不支持 ticks、showLegend 或非零 min', '移除不支持的 radar 参数'));
  if (curves.length > 24) errors.push(issue(info, info.firstLine, 'radar 最多支持 24 条 curve'));
  if (max != null && curves.some(c => c.values.some(v => v > max))) errors.push(issue(info, info.firstLine, 'radar max 不得裁剪曲线数据'));
  const fields = (axes || []).map((label, i) => ({ name: `d${i}`, label })); const rows = curves.map(c => Object.fromEntries([['label', c.label], ...fields.map(({ name }, i) => [name, c.values[i]])]));
  return { model: { chart: 'radar', title, titleLine, axisLine, axes: axes || [], fields, rows, max, maxLine, curveLines: curves.map(c => c.line) }, errors };
}
function treemap(source, info) {
  const errors = [], roots = [], stack = [], levels = []; let title = null, titleLine = null; badOptions(info, 'treemap-beta', errors);
  const split = text => { let q = ''; for (let i = 0; i < text.length; i++) { const c = text[i]; if (q) { if (c === q && text[i - 1] !== '\\') q = ''; } else if (c === '"' || c === "'") q = c; else if (c === ':') return [text.slice(0, i).trim(), text.slice(i + 1).trim()]; } return q ? null : [text.trim(), undefined]; };
  for (const item of linesOf(source, info.firstLine)) {
    if (/^title\s+/i.test(item.text)) { if (title !== null) errors.push(issue(info, item.line, 'treemap 只能有一个 title')); else { title = unquote(item.text.replace(/^title\s+/i, '')); titleLine = item.line; } continue; }
    if (/\t/.test(item.raw)) { errors.push(issue(info, item.line, 'treemap 缩进不能使用 Tab')); continue; }
    const indent = item.raw.match(/^ */)[0].length, pair = split(item.text); if (!pair) { errors.push(issue(info, item.line, 'treemap 节点引号未闭合')); continue; }
    const label = unquote(pair[0]); if (!label || /[{}]/.test(label)) { errors.push(issue(info, item.line, 'treemap 节点名称无效')); continue; }
    const node = { label, children: [], line: item.line }; if (pair[1] !== undefined) { if (!numeric(pair[1]) || Number(pair[1]) < 0) errors.push(issue(info, item.line, 'treemap 权重必须是非负有限数')); else node.value = Number(pair[1]); }
    while (stack.length && indent <= stack.at(-1).indent) stack.pop(); const depth = stack.length; if (depth > 0 && levels[depth] !== undefined && levels[depth] !== indent) errors.push(issue(info, item.line, 'treemap 同级缩进不一致')); levels[depth] ??= indent; (stack.length ? stack.at(-1).node.children : roots).push(node); stack.push({ indent, node });
  }
  if (roots.length !== 1) errors.push(issue(info, info.firstLine, 'treemap 必须有且只有一个根节点'));
  const treeLines = {};
  if (roots.length) { const clean = (node, path) => { treeLines[path] = node.line; node.children.forEach((child, index) => clean(child, `${path}/children/${index}`)); if (node.children.length) { if (node.value !== undefined) errors.push(issue(info, node.line, '有子项的 treemap 节点不能同时指定权重')); delete node.value; } else if (node.value === undefined) errors.push(issue(info, node.line, 'treemap 叶节点必须指定权重')); delete node.line; }; clean(roots[0], '/data'); }
  return { model: { chart: 'treemap', title, titleLine, treeLines, data: roots[0] || { label: '', children: [] } }, errors };
}

export { pie as parsePie, xy as parseXy, sankey as parseSankey, radar as parseRadar, treemap as parseTreemap };
