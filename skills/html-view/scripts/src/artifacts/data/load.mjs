import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { validateReport } from './compute.mjs';

const missing = new Set(['', '—', '–', '-', 'n/a', 'null']);
const isMissing = value => value == null || typeof value === 'string' && missing.has(value.trim().toLowerCase());
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export class DataPackageError extends Error {
  constructor(code, message, file, fix) { super(message); this.name = 'DataPackageError'; this.code = code; this.file = file; this.fix = fix; }
}

function resolveInput(root, rel, label) {
  if (typeof rel !== 'string' || !rel.trim() || path.isAbsolute(rel)) throw new DataPackageError('BAD_PATH', `${label} 必须是相对 report.json 的路径`, rel, '改用数据包目录内的相对路径');
  const file = path.resolve(root, rel);
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new DataPackageError('BAD_PATH', `${label} ${rel} 超出数据包目录`, rel, '把文件放在 report.json 所在目录内');
  return file;
}

function parseCsv(text, file) {
  const rows = [];
  let row = [], cell = '', quoted = false, closedQuote = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closedQuote = true; }
      else cell += c;
    } else if (closedQuote && c !== ',' && c !== '\n' && c !== '\r') throw new DataPackageError('CSV_PARSE', `${file} 引号结束后出现非法字符`, file, '引号关闭后只能接逗号、换行或文件结束');
    else if (c === '"' && cell === '') quoted = true;
    else if (c === '"') throw new DataPackageError('CSV_PARSE', `${file} 引号未放在字段开头`, file, '字段内双引号写成两个双引号');
    else if (c === ',') { row.push(cell); cell = ''; closedQuote = false; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(cell); cell = ''; closedQuote = false;
      if (row.some(x => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (quoted) throw new DataPackageError('CSV_PARSE', `${file} 引号未闭合`, file, '修正 CSV 中未配对的双引号');
  row.push(cell);
  if (row.some(x => x !== '')) rows.push(row);
  if (!rows.length) return [];
  const [headers, ...values] = rows;
  if (new Set(headers).size !== headers.length || headers.some(x => !x)) throw new DataPackageError('CSV_PARSE', `${file} 表头为空或重复`, file, '提供唯一非空字段名');
  return values.map((values, i) => {
    if (values.length !== headers.length) throw new DataPackageError('CSV_PARSE', `${file} 第 ${i + 2} 行列数不匹配`, file, '修正每行字段数使其与表头相同');
    return Object.fromEntries(headers.map((key, j) => [key, values[j]]));
  });
}

function parseRows(text, file) {
  if (path.extname(file).toLowerCase() === '.csv') return parseCsv(text, file);
  if (path.extname(file).toLowerCase() !== '.json') throw new DataPackageError('BAD_PATH', `${file} 只支持 CSV 或 JSON`, file, '把数据文件改为 .csv 或 .json');
  try { const rows = JSON.parse(text); if (!Array.isArray(rows)) throw new Error('需要 JSON 数组'); return rows; }
  catch (error) { throw new DataPackageError('JSON_PARSE', `${file} JSON 无效：${error.message}`, file, '修正 JSON 语法并提供记录数组'); }
}

function normalizeRows(rows, dataset, issues, sourceFile) {
  const expected = new Set([...Object.keys(dataset.dimensions || {}), ...Object.keys(dataset.measures || {}).filter(k => !['ratio','mean'].includes(dataset.measures[k]?.kind)), ...Object.values(dataset.measures || {}).flatMap(m => [m?.numerator,m?.denominator]).filter(Boolean)]);
  const seen = new Set();
  return rows.flatMap((raw, index) => {
    const before = issues.length;
    const at = `datasets.${dataset.id}.rows[${index}]`;
    if (!object(raw)) { issues.push({ code:'BAD_SCHEMA',severity:'error',where:at,message:'数据行必须是对象',fix:'使用 JSON 对象数组或带表头 CSV' }); return []; }
    const row = {};
    for (const field of expected) if (!Object.hasOwn(raw, field)) issues.push({ code:'BAD_SCHEMA',severity:'error',where:`${at}.${field}`,message:`缺少字段 ${field}`,fix:'补齐已声明的维度、sum 指标与 ratio/mean 分子分母' });
    for (const [field, meta] of Object.entries(dataset.dimensions || {})) {
      const value = raw[field];
      if (isMissing(value)) { issues.push({ code:'BAD_VALUE',severity:'error',where:`${at}.${field}`,message:'维度不能缺失',fix:'补齐维度值；指标缺失可留空' }); row[field] = null; }
      else row[field] = String(value).trim();
      if ((meta.type === 'month' || field === (dataset.periodField === null ? null : dataset.periodField ?? 'month')) && !/^\d{4}-(0[1-9]|1[0-2])$/.test(row[field] || '')) issues.push({ code:'BAD_PERIOD',severity:'error',where:`${at}.${field}`,message:'月份必须为 YYYY-MM',fix:'使用有效公历月份' });
    }
    const numeric = new Set([...Object.keys(dataset.measures || {}), ...Object.values(dataset.measures || {}).flatMap(m => [m?.numerator,m?.denominator]).filter(Boolean)]);
    for (const field of numeric) {
      const value = raw[field];
      if (isMissing(value)) row[field] = null;
      else {
        const number = typeof value === 'number' ? value : Number(String(value).trim());
        if (!Number.isFinite(number)) { issues.push({ code:'BAD_VALUE',severity:'error',where:`${at}.${field}`,message:`${JSON.stringify(value)} 不是有限数字`,fix:'缺失用空值；不要使用 NaN、Infinity 或非数字文本' }); row[field] = null; }
        else row[field] = number;
      }
    }
    const key = Object.keys(dataset.dimensions || {}).map(k => `${String(row[k])}`).join('\u001f');
    if (seen.has(key)) issues.push({ code:'DUPLICATE_KEY',severity:'error',where:at,message:'数据集出现重复维度键',fix:'每组周期与维度只保留一条上游聚合记录' }); else seen.add(key);
    row.__row = index;
    for (const problem of issues.slice(before)) problem.file = sourceFile;
    return [row];
  });
}

export async function loadDataPackage(reportPath) {
  const absolute = path.resolve(reportPath);
  let report;
  try { report = JSON.parse(await readFile(absolute, 'utf8')); }
  catch (error) { throw new DataPackageError(error.code === 'ENOENT' ? 'NOT_FOUND' : 'JSON_PARSE', `${absolute} 无法读取或解析：${error.message}`, absolute, error.code === 'ENOENT' ? '确认 report.json 原路径存在' : '修正 report.json JSON 语法'); }
  const { issues } = validateReport(report);
  if (issues.some(problem => problem.severity === 'error')) return { report, datasets:[], narratives:[], issues, reportPath:absolute };
  const root = await realpath(path.dirname(absolute));
  const ensureInside = async file => {
    const physical = await realpath(file);
    const relative = path.relative(root, physical);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new DataPackageError('BAD_PATH', `文件 ${file} 通过符号链接越出数据包目录`, file, '把数据文件复制到 report.json 所在目录内，不要使用外部符号链接');
    return physical;
  };
  const datasets = [];
  for (const spec of report.datasets || []) {
    if (!spec || typeof spec.file !== 'string') continue;
    const file = resolveInput(root, spec.file, `数据集 ${spec.id}`);
    let text;
    try { text = await readFile(await ensureInside(file), 'utf8'); }
    catch (error) { if (error instanceof DataPackageError) throw error; throw new DataPackageError(error.code === 'ENOENT' ? 'NOT_FOUND' : 'IO_ERROR', `无法读取 ${file}: ${error.message}`, file, '核对原路径、文件是否存在及权限'); }
    datasets.push({ ...spec, rows: normalizeRows(parseRows(text, file), spec, issues, file), filePath: file });
  }
  const narratives = [];
  for (const block of report.blocks || []) if (block.type === 'text') {
    const file = resolveInput(root, block.file, '叙述文件');
    try { narratives.push({ block, filePath:file, text:await readFile(await ensureInside(file),'utf8') }); }
    catch (error) { if (error instanceof DataPackageError) throw error; throw new DataPackageError(error.code === 'ENOENT' ? 'NOT_FOUND' : 'IO_ERROR', `无法读取 ${file}: ${error.message}`, file, '核对原路径、文件是否存在及权限'); }
  }
  return { report, datasets, narratives, issues, reportPath: absolute };
}
