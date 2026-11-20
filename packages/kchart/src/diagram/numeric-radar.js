/* radar-beta：Mermaid 雷达图语法 → KChart radar 声明。

   numeric-parse 的雷达分支只认一行 `axis`、一条 curve 和非零 min 之外的少数选项；
   这里按 Mermaid 12.3.0 `radar.langium` 重写：多条 axis、`id["标签"]`、一行多条
   curve、按轴名引用取值，以及 showLegend/ticks/max/min/graticule 全部选项。 */

import { error, warning } from './support.js';
import { numericLabel, renderWith, validateWith } from './numeric-model.js';
import { sizeBudget } from '../chart/spec.js';
import '../chart/multivariate.js';

const limit = 24;
const MAX_AXES = 24, MIN_RINGS = 2, MAX_RINGS = 8, DEFAULT_RINGS = 5;
const unquote = (value) => {
  const text = String(value).trim();
  return (text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))
    ? text.slice(1, -1).replace(/\\([\\"'])/g, '$1') : text;
};
const number = (value) => /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(value).trim()) ? Number(value) : null;
const issue = (info, line, zh, en, fixZh = '修正 Mermaid radar 语法', fixEn = 'Correct the Mermaid radar syntax') => error(info.lang, line, zh, en, fixZh, fixEn);
const hint = (info, line, zh, en, fixZh, fixEn) => warning('DIAGRAM_HINT', info.lang, line, zh, en, fixZh, fixEn);

// 曲线值可以换行书写，所以在花括号闭合前把后续行并进同一条语句。
function statements(source, firstLine) {
  const out = []; let buffer = null, start = 0, depth = 0;
  String(source).split('\n').forEach((raw, index) => {
    const text = raw.trim();
    if (buffer === null && (!text || text.startsWith('%%'))) return;
    if (buffer === null) { start = firstLine + index; buffer = ''; }
    buffer += (buffer ? '\n' : '') + text;
    depth = Math.max(0, depth + (text.match(/\{/g) || []).length - (text.match(/\}/g) || []).length);
    if (depth) return;
    out.push({ text: buffer, line: start });
    buffer = null;
  });
  if (buffer !== null) out.push({ text: buffer, line: start });
  return out;
}

// 只在引号和方括号/花括号之外切分逗号；括号内的逗号属于标签或数值列表。
function splitTop(text) {
  const parts = []; let current = '', quote = '', depth = 0;
  for (const char of text) {
    if (quote) { current += char; if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; current += char; continue; }
    if (char === '[' || char === '{') depth += 1;
    if (char === ']' || char === '}') depth -= 1;
    if (char === ',' && depth === 0) { parts.push(current.trim()); current = ''; continue; }
    current += char;
  }
  parts.push(current.trim());
  return parts;
}

const LABEL = '(?:\\[\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|\'((?:[^\'\\\\]|\\\\.)*)\'|([^\\]]*))\\s*\\])?';
const ID = '[\\p{L}\\p{N}_][\\p{L}\\p{N}_.-]*';
const AXIS = new RegExp(`^(${ID})\\s*${LABEL}$`, 'u');
const CURVE = new RegExp(`^(${ID})\\s*${LABEL}\\s*\\{([\\s\\S]*)\\}$`, 'u');
const ENTRY = new RegExp(`^(${ID})\\s*:?\\s*([-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))$`, 'u');
const labelOf = (match, id) => {
  const raw = [match[2], match[3], match[4]].find(value => value !== undefined);
  const label = raw === undefined ? id : unquote(raw);
  return label || id;
};

// 头部只允许 radar-beta 关键字和 Mermaid 语法接受的尾随冒号。
function headerError(info) {
  const rest = String(info.params || '').replace(/\s*:\s*$/, '').trim();
  if (rest) return issue(info, info.headerLine || info.firstLine, `radar-beta 不支持头行选项「${rest}」`, `radar-beta does not accept header options: ${rest}`, '把选项写成独立语句（max、min、ticks、showLegend、graticule）', 'Write options as their own statements');
  return null;
}

function readAxes(info, text, line, axes, errors) {
  for (const part of splitTop(text.replace(/^axis\s+/i, ''))) {
    const match = AXIS.exec(part);
    if (!match) { errors.push(issue(info, line, `无法识别 radar 维度「${part}」`, `Unrecognized radar axis "${part}"`, '使用 `axis 名称` 或 `axis 名称["显示名"]`', 'Use `axis name` or `axis name["Label"]`')); continue; }
    const id = match[1];
    if (axes.some(axis => axis.id === id)) { errors.push(issue(info, line, `radar 维度「${id}」重复`, `Duplicate radar axis "${id}"`, '每个维度只声明一次', 'Declare each axis once')); continue; }
    axes.push({ id, label: numericLabel(labelOf(match, id), info, line, errors), line });
  }
}

function readCurves(info, text, line, curves, errors) {
  for (const part of splitTop(text.replace(/^curve\s+/i, ''))) {
    const match = CURVE.exec(part);
    if (!match) { errors.push(issue(info, line, `无法识别 radar 曲线「${part}」`, `Unrecognized radar curve "${part}"`, '使用 `curve 名称["显示名"]{值, 值}` 或 `curve 名称{维度: 值}`', 'Use `curve name["Label"]{value, value}` or `curve name{axis: value}`')); continue; }
    const id = match[1], entries = [], items = match[5].split(/[,\n]/).map(item => item.trim()).filter(Boolean);
    let broken = false;
    for (const item of items) {
      const value = number(item);
      if (value !== null) { entries.push({ axis: null, value }); continue; }
      const pair = ENTRY.exec(item);
      if (!pair) { errors.push(issue(info, line, `radar 曲线「${id}」的值「${item}」无效`, `Invalid value "${item}" in radar curve "${id}"`, '曲线值必须是数值，或 `维度名: 数值`', 'Curve values must be numbers or `axis: number` pairs')); broken = true; continue; }
      entries.push({ axis: pair[1], value: Number(pair[2]) });
    }
    if (!broken) curves.push({ id, label: numericLabel(labelOf(match, id), info, line, errors), entries, line });
  }
}

// 展开曲线取值：按轴名引用时按 axis 顺序重排，混用两种写法则报错（Mermaid 也只认一种）。
function resolveCurves(info, curves, axes, errors) {
  return curves.flatMap(curve => {
    const referenced = curve.entries.filter(entry => entry.axis !== null);
    if (!referenced.length) return [{ ...curve, values: curve.entries.map(entry => entry.value) }];
    if (referenced.length !== curve.entries.length) {
      errors.push(issue(info, curve.line, `radar 曲线「${curve.label}」不能混用按位和按维度取值`, `Radar curve "${curve.label}" mixes positional and named values`, '整条曲线统一使用一种写法', 'Use one value form for the whole curve'));
      return [];
    }
    const unknown = referenced.filter(entry => !axes.some(axis => axis.id === entry.axis));
    if (unknown.length) {
      errors.push(issue(info, curve.line, `radar 曲线「${curve.label}」引用了未声明的维度「${unknown[0].axis}」`, `Radar curve "${curve.label}" references undeclared axis "${unknown[0].axis}"`, '先声明该维度，或删去这一项', 'Declare the axis first, or remove that entry'));
      return [];
    }
    const missing = axes.filter(axis => !referenced.some(entry => entry.axis === axis.id));
    if (missing.length) {
      errors.push(issue(info, curve.line, `radar 曲线「${curve.label}」缺少维度「${missing.map(axis => axis.id).join('、')}」的值`, `Radar curve "${curve.label}" is missing values for ${missing.map(axis => axis.id).join(', ')}`, '为每个维度各写一个 `维度名: 数值`', 'Give one `axis: number` entry per axis'));
      return [];
    }
    return [{ ...curve, values: axes.map(axis => referenced.find(entry => entry.axis === axis.id).value) }];
  });
}

function readOption(info, text, line, options, errors) {
  for (const part of splitTop(text)) {
    const match = /^(showLegend|ticks|max|min|graticule)\s+(\S+)$/i.exec(part);
    if (!match) { errors.push(issue(info, line, `无法识别 radar 语句「${part}」`, `Unrecognized radar statement "${part}"`, '支持 axis、curve、max、min、ticks、showLegend、graticule', 'Supported: axis, curve, max, min, ticks, showLegend, graticule')); continue; }
    const name = match[1].toLowerCase(), value = match[2];
    if (name === 'showlegend') {
      if (!/^(true|false)$/i.test(value)) { errors.push(issue(info, line, 'showLegend 只接受 true 或 false', 'showLegend accepts only true or false')); continue; }
      options.showLegend = value.toLowerCase() === 'true'; options.line ??= line; continue;
    }
    if (name === 'graticule') {
      if (!/^(circle|polygon)$/i.test(value)) { errors.push(issue(info, line, 'graticule 只接受 circle 或 polygon', 'graticule accepts only circle or polygon')); continue; }
      options.graticule = value.toLowerCase(); options.line ??= line; continue;
    }
    const numericValue = number(value);
    if (numericValue === null) { errors.push(issue(info, line, `radar ${name} 值「${value}」无效`, `Invalid radar ${name} value "${value}"`)); continue; }
    options[name] = numericValue; options.line ??= line;
  }
}

// 前端配置（phase 2 由 source.js 提供）只读取 KChart 真能画出的项；其余由共享层告警。
const configValue = (config, name) => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return undefined;
  const key = Object.keys(config).find(candidate => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : config[key];
};
const configFlag = (config, name) => {
  const value = configValue(config, name);
  return typeof value === 'boolean' ? value : undefined;
};
const configNumber = (config, name) => {
  const value = configValue(config, name);
  const parsed = typeof value === 'number' ? value : number(value ?? '');
  return parsed !== null && Number.isFinite(parsed) ? parsed : undefined;
};

function parseRadar(source, info) {
  const errors = [], axes = [], curves = [], options = {};
  const header = headerError(info);
  if (header) errors.push(header);
  let title = null, titleLine = null, axisLine = null;
  for (const item of statements(source, info.firstLine)) {
    if (/^title\s+/i.test(item.text)) {
      if (title !== null) { errors.push(issue(info, item.line, 'radar 只能有一个 title')); continue; }
      title = numericLabel(unquote(item.text.replace(/^title\s+/i, '')), info, item.line, errors); titleLine = item.line; continue;
    }
    if (/^axis\s+/i.test(item.text)) { axisLine ??= item.line; readAxes(info, item.text, item.line, axes, errors); continue; }
    if (/^curve\s+/i.test(item.text)) { readCurves(info, item.text, item.line, curves, errors); continue; }
    readOption(info, item.text, item.line, options, errors);
  }

  const radarConfig = configValue(info.config, 'radar');
  const ticks = configNumber(radarConfig, 'ticks') ?? options.ticks ?? DEFAULT_RINGS;
  const min = configNumber(radarConfig, 'min') ?? options.min ?? 0;
  const declaredMax = configNumber(radarConfig, 'max') ?? options.max ?? null;
  const showLegend = configFlag(radarConfig, 'showLegend') ?? options.showLegend ?? true;
  const graticule = String(configValue(radarConfig, 'graticule') ?? options.graticule ?? 'circle').toLowerCase();

  if (!axes.length) {
    errors.push(issue(info, info.firstLine, 'radar 至少需要一个维度', 'Radar needs at least one axis', '添加 axis 语句', 'Add an axis statement'));
  } else if (axes.length > MAX_AXES) {
    errors.push(issue(info, axes[MAX_AXES].line, `radar 维度安全上限为 ${MAX_AXES} 个，当前 ${axes.length} 个`, `Radar safety cap is ${MAX_AXES} axes; got ${axes.length}`,
      '将维度拆分到多张雷达图', 'Split the axes across multiple radar charts'));
    return { model: null, errors };
  } else if (axes.length < 3) {
    errors.push(hint(info, axisLine, `radar 只有 ${axes.length} 个维度，无法形成面积`, `Radar has ${axes.length} axes and cannot enclose an area`,
      '建议至少使用 3 个维度', 'Use at least 3 axes for an area'));
  }
  if (!curves.length && !errors.some(item => item.severity === 'error')) errors.push(issue(info, info.firstLine, 'radar 至少需要一条 curve', 'Radar needs at least one curve'));
  if (declaredMax !== null && declaredMax <= min) errors.push(issue(info, options.line || info.firstLine, 'radar max 必须大于 min', 'Radar max must be greater than min'));

  const resolved = resolveCurves(info, curves, axes, errors);
  const kept = resolved.filter(curve => {
    if (curve.values.length === axes.length) return true;
    // Mermaid 静默跳过长度不符的曲线；这里告警并跳过，其余曲线的读者体验不受影响。
    errors.push(hint(info, curve.line, `radar 曲线「${curve.label}」有 ${curve.values.length} 个值、${axes.length} 个维度，已跳过`, `Radar curve "${curve.label}" has ${curve.values.length} values for ${axes.length} axes and was skipped`, '为每个维度写一个值', 'Give one value per axis'));
    return false;
  });
  if (resolved.length > limit) errors.push(issue(info, resolved[limit].line,
    `radar 安全上限为 ${limit} 条曲线，当前 ${resolved.length} 条`, `radar safety cap is ${limit} curves; got ${resolved.length}`,
    `将曲线合并到 ${limit} 条以内，或拆成多张图`, `Merge curves to stay within ${limit}, or split the chart`));

  // 声明范围小于数据时向上扩展并告警：静默裁剪会误报量级，硬报错则丢掉整张图。
  const values = kept.flatMap(curve => curve.values).filter(Number.isFinite);
  const dataMax = values.length ? Math.max(...values) : 0, dataMin = values.length ? Math.min(...values) : 0;
  let top = declaredMax ?? Math.max(dataMax, min + 1), bottom = min;
  if (!(top > bottom)) top = bottom + 1;
  if (dataMax > top) {
    errors.push(hint(info, options.line || info.firstLine, `radar max ${top} 小于数据最大值 ${dataMax}，已扩展到 ${dataMax}`, `Radar max ${top} is below the data maximum ${dataMax}; extended to ${dataMax}`, `把 max 改为不小于 ${dataMax}`, `Set max to at least ${dataMax}`));
    top = dataMax;
  }
  if (dataMin < bottom) {
    errors.push(hint(info, options.line || info.firstLine, `radar min ${bottom} 大于数据最小值 ${dataMin}，已扩展到 ${dataMin}`, `Radar min ${bottom} is above the data minimum ${dataMin}; extended to ${dataMin}`, `把 min 改为不大于 ${dataMin}`, `Set min to no more than ${dataMin}`));
    bottom = dataMin;
  }
  const rings = Math.max(MIN_RINGS, Math.min(MAX_RINGS, Math.round(ticks)));
  if (rings !== ticks) {
    errors.push(hint(info, options.line || info.firstLine, `radar ticks ${ticks} 超出 ${MIN_RINGS}–${MAX_RINGS} 环的可读范围，按 ${rings} 环绘制`, `Radar ticks ${ticks} is outside the readable ${MIN_RINGS}–${MAX_RINGS} rings; drawing ${rings}`, `把 ticks 设为 ${MIN_RINGS}–${MAX_RINGS} 之间的整数`, `Set ticks to an integer within ${MIN_RINGS}–${MAX_RINGS}`));
  }

  const fields = axes.map((axis, index) => ({ name: `d${index}`, label: axis.label }));
  const rows = kept.map(curve => Object.fromEntries([['label', curve.label], ...fields.map((field, index) => [field.name, curve.values[index]])]));
  return {
    model: {
      chart: 'radar', title, titleLine, axisLine, axes, fields, rows,
      domain: [bottom, top], rings, graticule, showLegend,
      curveLines: kept.map(curve => curve.line), optionsLine: options.line || axisLine || info.firstLine,
    },
    errors,
  };
}

function toSpec(model) {
  return {
    chart: 'radar',
    [sizeBudget]: { minDimensions: 1, maxDimensions: MAX_AXES },
    ...(model.title ? { title: model.title } : {}),
    data: model.rows,
    encode: { label: 'label', dimensions: model.fields.map(field => field.name) },
    fields: Object.fromEntries(model.fields.map(field => [field.name, { label: field.label, domain: model.domain }])),
    rings: model.rings,
    graticule: model.graticule,
    legend: model.showLegend,
  };
}

function lineFor(model, detail) {
  const path = String(detail?.path || '').split('/').slice(1).map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  const row = Number(path[1]);
  if (path[0] === 'title') return model.titleLine;
  if (path[0] === 'data' && Number.isInteger(row) && model.curveLines[row]) return model.curveLines[row];
  if (path[0] === 'fields' || path[0] === 'encode') return model.axisLine;
  if (['rings', 'graticule', 'legend'].includes(path[0])) return model.optionsLine;
  return model.axisLine || model.curveLines[0] || model.optionsLine;
}

const validate = (model, info) => validateWith(toSpec(model), info, detail => lineFor(model, detail));
const layout = (model, options, info) => {
  const result = renderWith(toSpec(model), options, info, detail => lineFor(model, detail));
  if (result.scene && result.width > options.width) {
    result.errors.push(warning('LARGE_DIAGRAM', info.lang, model.optionsLine,
      '雷达图超出可用宽度，可滚动查看', 'The radar chart exceeds the available width; scroll to view',
      '缩短维度标签或拆分图表', 'Shorten axis labels or split the chart'));
  }
  return result;
};

export const honoredConfig = Object.freeze(['radar.ticks', 'radar.min', 'radar.max', 'radar.showLegend', 'radar.graticule']);

const implementation = { parse: parseRadar, validate, layout, optionMode: 'raw', honoredConfig };

export const implementations = { 'radar-beta': implementation };
