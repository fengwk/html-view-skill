/* xychart：Mermaid `xychart` / `xychart-beta` 语法 → KChart line、column 或 combo 声明。

   numeric-parse 里的旧 xychart 分支只认无名的 `bar [..]`、类别 x 轴和一条 y 轴范围；这里按
   Mermaid 12.3.0 `parser/xychart.jison` 重写：头行方向、命名序列、行内数据点标签、数值 x 轴
   `min --> max`，以及 y 轴范围与数据/0 基线的自动补齐。Mermaid 接受这些写法，所以 KChart 不能
   拒绝；能画的画出来，画不出的写一条 warning 说明替代效果。
   解析与声明构造都留在本文件，共享的 numeric-parse.js / numeric-common.js 不再需要 xychart 规则。 */

import { error, warning } from './support.js';
import { numericLabel, renderWith, validateWith } from './numeric-model.js';
import { diagramLine } from '../chart/basic.js';
import { diagramCombo } from '../chart/multivariate.js';

// Mermaid 的 NUMBER_WITH_DECIMAL：没有指数、也没有末尾小数点。
const NUMBER = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
const NUMERIC = new RegExp(`^${NUMBER}$`);
const RANGE = new RegExp(`^(.*?)\\s*(${NUMBER})\\s*-->\\s*(${NUMBER})\\s*$`);
const BAND = /^(.*?)\s*\[([^\]]*)\]\s*$/;
const PLOT = /^(bar|line)\b([\s\S]*)$/i;
const POINT = new RegExp(`^(${NUMBER})\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|'((?:[^'\\\\]|\\\\.)*)')?$`);
const NAME = /^\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^\s[\]"]+))?\s*\[([\s\S]*)\]\s*$/;
const MAX_PLOTS = 6;

const issue = (info, line, zh, en, fixZh = '修正 Mermaid xychart 语法', fixEn = 'Correct the Mermaid xychart syntax') => error(info.lang, line, zh, en, fixZh, fixEn);
const hint = (errors, info, line, zh, en, fixZh = '检查图表声明', fixEn = 'Check the chart declaration') => errors.push(warning('DIAGRAM_HINT', info.lang, line, zh, en, fixZh, fixEn));
const isEnglish = (lang) => /^en(?:-|$)/i.test(String(lang || ''));

const unescape = (text) => String(text).replace(/\\([\\"'])/g, '$1');
const unquote = (value) => {
  const text = String(value).trim();
  return (text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))
    ? unescape(text.slice(1, -1)) : text;
};
const quoteOf = (double, single, bare) => [double, single, bare].find(value => value !== undefined);

// 只在引号和括号之外切分：引号里的逗号属于标签，`;` 在 Mermaid 里是语句结束符。
function splitTop(text, separator = ',') {
  const parts = []; let current = '', quote = '', depth = 0;
  for (const char of String(text)) {
    if (quote) { current += char; if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; current += char; continue; }
    if (char === '[' || char === '{') depth += 1;
    if (char === ']' || char === '}') depth -= 1;
    if (char === separator && depth === 0) { parts.push(current.trim()); current = ''; continue; }
    current += char;
  }
  parts.push(current.trim());
  return parts;
}

// 语句行：空行和整行 `%%` 注释先跳过，同一物理行里的 `;` 拆成多条语句，行号保持不变。
function statements(source, firstLine) {
  const out = [];
  String(source).split('\n').forEach((raw, index) => {
    const text = raw.trim();
    if (!text || text.startsWith('%%')) return;
    for (const part of splitTop(text, ';')) if (part) out.push({ text: part, line: firstLine + index });
  });
  return out;
}

// 头行只有方向是合法 token（Mermaid `chartConfig : CHART_ORIENTATION`），其他一律按不支持处理。
function readHeader(info, errors) {
  let orientation = null;
  for (const token of String(info.params || '').split(/\s+/).filter(Boolean)) {
    if (!/^(?:horizontal|vertical)$/i.test(token)) {
      errors.push(issue(info, info.headerLine || info.firstLine, `xychart 不支持头行选项「${token}」`, `xychart does not accept header options: ${token}`, '头行只接受 horizontal 或 vertical', 'Only horizontal or vertical is allowed after the header'));
      continue;
    }
    orientation = token.toLowerCase();
  }
  return orientation;
}

// 数据点：数值后面可以紧跟一个引号标签；标签只对 line 有意义（Mermaid 对 bar 同样忽略）。
function readPoints(text, info, line, errors) {
  const points = [];
  for (const item of splitTop(text)) {
    const match = POINT.exec(item);
    if (!match) {
      errors.push(issue(info, line, `数据点「${item}」须为数值，可带一个引号标签`, `Data point "${item}" must be a number, optionally with a quoted label`, '写成 `12` 或 `12 "标签"`', 'Write `12` or `12 "Label"`'));
      return null;
    }
    const label = quoteOf(match[2], match[3], undefined);
    points.push({ value: Number(match[1]), label: label === undefined ? null : unescape(label) || null });
  }
  return points;
}

// 轴线（x-axis / y-axis）共用读法：`[类别]`、`min --> max`、纯标题，以及标题加数据。
function readAxis(info, rest, line, errors) {
  const band = BAND.exec(rest);
  if (band) {
    const title = band[1].trim() ? unquote(band[1]) : null;
    const categories = splitTop(band[2]);
    if (!categories.length || categories.some(item => !item)) {
      errors.push(issue(info, line, 'x-axis 需要非空类别列表', 'x-axis needs a non-empty category list', '去掉空类别或多余的逗号', 'Remove empty categories or extra commas'));
      return { title, data: null };
    }
    return { title, data: { kind: 'band', categories: categories.map(unquote) } };
  }
  const range = RANGE.exec(rest);
  // 形如 `Some-->Thing` 的单词也被 alphaNum 允许；只有标签不像箭头残片时才当成数值范围。
  if (range && !/-$/.test(range[1])) {
    const min = Number(range[2]), max = Number(range[3]);
    return { title: range[1].trim() ? unquote(range[1]) : null, data: { kind: 'linear', min, max } };
  }
  return { title: rest ? unquote(rest) : null, data: null };
}

// 类别名是 KChart 的分类身份，重复标签会让两列数据合并，因此给重复项加序号并只告警一次。
function uniqueCategories(errors, info, line, categories) {
  const seen = new Map(), out = [];
  let duplicated = false;
  for (const category of categories) {
    const count = (seen.get(category) || 0) + 1;
    seen.set(category, count);
    if (count === 1) { out.push(category); continue; }
    duplicated = true;
    out.push(`${category} (${count})`);
  }
  if (duplicated) hint(errors, info, line, 'x-axis 类别名重复，已按出现顺序加序号区分', 'Duplicate x-axis categories were numbered in source order', '让每个类别名唯一', 'Give every category a unique name');
  return out;
}

// Mermaid 把线性 x 轴的最小/最大值均分给每个数据点，标签就是这些等分点。
function linearLabels(min, max, count) {
  const round = (value) => String(Number(value.toPrecision(12)));
  if (count <= 0) return [];
  if (count === 1) return [round(min)];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, index) => round(min + index * step));
}

function readPlots(info, text, line, errors) {
  const head = PLOT.exec(text), type = head[1].toLowerCase(), body = NAME.exec(head[2]);
  if (!body) {
    errors.push(issue(info, line, `无法识别 ${type} 数据「${text}」`, `Unrecognized ${type} data "${text}"`, `写成 \`${type} [值, 值]\` 或 \`${type} "名称" [值, 值]\``, `Write \`${type} [value, value]\` or \`${type} "Name" [value, value]\``));
    return null;
  }
  const points = readPoints(body[4], info, line, errors);
  if (!points) return null;
  const name = quoteOf(body[1], body[2], body[3]);
  return { type, name: name === undefined ? null : unescape(name), points, line };
}

function parseXychart(source, info) {
  const errors = [];
  let title = null, titleLine = null, xTitle = null, yTitle = null, xData = null, xAxisLine = null, yAxisLine = null, yDomain = null;
  const plots = [];
  const orientation = readHeader(info, errors);

  for (const item of statements(source, info.firstLine)) {
    if (/^title\b/i.test(item.text)) {
      const text = item.text.replace(/^title\b/i, '').trim();
      if (!text) { errors.push(issue(info, item.line, 'title 需要标题文字', 'title needs some text')); continue; }
      if (title !== null) { errors.push(issue(info, item.line, 'xychart 只能有一个 title', 'xychart accepts one title')); continue; }
      title = numericLabel(unquote(text), info, item.line, errors); titleLine = item.line; continue;
    }
    if (/^x-axis\b/i.test(item.text)) {
      const axis = readAxis(info, item.text.replace(/^x-axis\b/i, '').trim(), item.line, errors);
      // Mermaid 的第二条 x-axis 覆盖第一条（setXAxisTitle/setXAxisBand 直接赋值），这里同样最后一条生效。
      if (axis.title !== null) {
        if (xTitle !== null) hint(errors, info, item.line, 'xychart 重复的 x-axis，只保留最后一条', 'Duplicate x-axis; the last one is used');
        xTitle = numericLabel(axis.title, info, item.line, errors);
      }
      if (axis.data) {
        if (xData) hint(errors, info, item.line, 'xychart 重复的 x-axis 数据，只保留最后一条', 'Duplicate x-axis data; the last one is used');
        xData = axis.data; xAxisLine = item.line;
      }
      xAxisLine ??= item.line; continue;
    }
    if (/^y-axis\b/i.test(item.text)) {
      const axis = readAxis(info, item.text.replace(/^y-axis\b/i, '').trim(), item.line, errors);
      yAxisLine ??= item.line;
      if (axis.title !== null) {
        if (yTitle !== null) hint(errors, info, item.line, 'xychart 重复的 y-axis，只保留最后一条', 'Duplicate y-axis; the last one is used');
        yTitle = numericLabel(axis.title, info, item.line, errors);
      }
      if (axis.data && axis.data.kind === 'linear') {
        if (yDomain) hint(errors, info, item.line, 'xychart 重复的 y-axis 范围，只保留最后一条', 'Duplicate y-axis range; the last one is used');
        yDomain = [axis.data.min, axis.data.max];
      } else if (axis.data?.kind === 'band') {
        errors.push(issue(info, item.line, 'y-axis 只接受数值范围 `min --> max`', 'y-axis accepts only a numeric range `min --> max`', '改成 `y-axis "标题" 0 --> 100`', 'Use `y-axis "Title" 0 --> 100`'));
      }
      continue;
    }
    if (PLOT.test(item.text)) {
      const plot = readPlots(info, item.text, item.line, errors);
      if (plot) plots.push(plot);
      continue;
    }
    errors.push(issue(info, item.line, `无法识别 xychart 语句「${item.text}」`, `Unrecognized xychart statement "${item.text}"`, '支持 title、x-axis、y-axis、bar、line', 'Supported: title, x-axis, y-axis, bar, line'));
  }

  if (!plots.length) errors.push(issue(info, info.firstLine, 'xychart 至少需要一条 bar 或 line 数据', 'xychart needs at least one bar or line plot'));
  if (plots.length > MAX_PLOTS) errors.push(issue(info, plots[MAX_PLOTS].line, `xychart 最多支持 ${MAX_PLOTS} 条数据序列`, `xychart supports at most ${MAX_PLOTS} plots`, `合并到 ${MAX_PLOTS} 条以内，或拆成两张图`, `Merge into ${MAX_PLOTS} plots or split the chart`));

  const hasNamedOnly = plots.length === 1 && plots[0].name;
  const hasPointLabels = plots.some(plot => plot.type === 'line' && plot.points.some(point => point.label));
  // 单序列时：命名序列用 combo 才画得出图例；数据点标签只有 line 画得出，两者同时出现优先保留标签。
  const chart = plots.length > 1 ? 'combo'
    : hasNamedOnly && !(plots[0].type === 'line' && plots[0].points.some(point => point.label)) ? 'combo'
      : plots[0]?.type === 'bar' ? 'column' : 'line';

  const categoryLine = xAxisLine || plots[0]?.line || info.firstLine;
  const lengths = plots.map(plot => plot.points.length);
  const categoryCount = xData?.kind === 'band' ? xData.categories.length : Math.max(0, ...lengths);
  let categories;
  if (xData?.kind === 'band') categories = uniqueCategories(errors, info, categoryLine, xData.categories.map(value => numericLabel(value, info, categoryLine, errors)));
  else if (xData?.kind === 'linear') categories = linearLabels(xData.min, xData.max, categoryCount);
  // 既没有 x-axis 也没有类别时，Mermaid 用 1…n 的线性轴；这里就是同样的 1…n 标签。
  else categories = Array.from({ length: categoryCount }, (_, index) => String(index + 1));

  const datasets = plots.map((plot) => {
    const truncated = plot.points.length > categories.length;
    // 缺失的点按图型取舍：折线留空档，柱形（Mermaid 里就是一根没有的柱）在单柱图里按 0 画并告警。
    const pad = chart === 'combo' || plot.type === 'line' ? null : 0;
    if (truncated) hint(errors, info, plot.line, `数据点数 ${plot.points.length} 多于类别数 ${categories.length}，多余的点已略去`, `${plot.points.length} points exceed ${categories.length} categories; extra points were dropped`, '补齐 x-axis 类别或删去多余的点', 'Add x-axis categories or remove the extra points');
    else if (plot.points.length < categories.length && pad === 0) hint(errors, info, plot.line, `bar 数据点数少于类别数，缺少的点按 0 绘制`, `The bar plot has fewer points than categories; missing points are drawn as 0`, '补齐数据点', 'Provide a value for every category');
    return {
      type: plot.type,
      name: plot.name && numericLabel(plot.name, info, plot.line, errors),
      line: plot.line,
      values: categories.map((_, index) => plot.points[index]?.value ?? pad),
      pointLabels: categories.map((_, index) => {
        const label = plot.points[index]?.label;
        return label ? numericLabel(label, info, plot.line, errors) : null;
      }),
    };
  });

  if (chart === 'combo' && hasPointLabels) hint(errors, info, plots[0].line, '组合图中的数据点标签未绘制', 'Point labels are not drawn on a combined chart', '把该序列拆成单独的 line 图，或删去标签', 'Split that plot into a line-only chart or drop the labels');
  if (chart !== 'combo' && datasets[0]?.name && hasPointLabels) hint(errors, info, plots[0].line, `单序列折线的名称「${datasets[0].name}」未作为图例绘制`, `The name "${datasets[0].name}" of this single line is not drawn as a legend`, '需要图例时不要同时使用数据点标签', 'Do not combine point labels with a series name if the legend matters');
  const labelledBars = plots.find(plot => plot.type === 'bar' && plot.points.some(point => point.label));
  if (labelledBars) hint(errors, info, labelledBars.line, 'bar 的数据点标签被忽略（Mermaid 也只对 line 绘制点标签）', 'Point labels on a bar plot are ignored (Mermaid draws them on line plots only)', '改用 line 绘制带标签的序列', 'Use line for a labeled series');

  const values = plots.flatMap(plot => plot.points.map(point => point.value));
  const dataMin = Math.min(...values), dataMax = Math.max(...values);
  let domain = null;
  if (yDomain) {
    if (!(yDomain[1] > yDomain[0])) hint(errors, info, yAxisLine, `y-axis 范围 ${yDomain[0]} --> ${yDomain[1]} 不是递增区间，已改为按数据取值`, `y-axis range ${yDomain[0]} --> ${yDomain[1]} is not increasing; derived from data instead`, '把范围写成 `小值 --> 大值`', 'Write the range as `low --> high`');
    else domain = [yDomain[0], yDomain[1]];
  }
  if (domain) {
    // Mermaid 会照声明范围裁掉超出的点；KChart 扩到数据能画下的范围，既不裁剪也不说谎。
    if (domain[0] > dataMin) { hint(errors, info, yAxisLine, `y-axis 最小值 ${domain[0]} 高于数据最小值 ${dataMin}，已扩展到 ${dataMin}`, `y-axis minimum ${domain[0]} is above the data minimum ${dataMin}; extended to ${dataMin}`, `把最小值改为不大于 ${dataMin}`, `Set the minimum to at most ${dataMin}`); domain[0] = dataMin; }
    if (domain[1] < dataMax) { hint(errors, info, yAxisLine, `y-axis 最大值 ${domain[1]} 低于数据最大值 ${dataMax}，已扩展到 ${dataMax}`, `y-axis maximum ${domain[1]} is below the data maximum ${dataMax}; extended to ${dataMax}`, `把最大值改为不小于 ${dataMax}`, `Set the maximum to at least ${dataMax}`); domain[1] = dataMax; }
    // 柱形从 0 基线起画；Mermaid 声明 4000 --> 11000 时柱子贴底起步，KChart 把 0 纳入范围并告警。
    if (plots.some(plot => plot.type === 'bar') && (domain[0] > 0 || domain[1] < 0)) {
      hint(errors, info, yAxisLine, `柱形 y 轴已自动包含 0 基线（${domain[0]} --> ${domain[1]} → ${Math.min(0, domain[0])} --> ${Math.max(0, domain[1])}）`, `The bar y-axis now includes the zero baseline (${domain[0]} --> ${domain[1]} → ${Math.min(0, domain[0])} --> ${Math.max(0, domain[1])})`, '把 y-axis 范围写成包含 0 的区间', 'Declare a y-axis range that includes 0');
      domain = [Math.min(0, domain[0]), Math.max(0, domain[1])];
    }
  }
  if (orientation === 'horizontal') hint(errors, info, info.headerLine || info.firstLine, 'xychart horizontal 暂不支持，按纵向绘制', 'Horizontal xychart is not supported yet; drawing vertically', '改成 `xychart` 或 `xychart vertical`', 'Use `xychart` or `xychart vertical`');
  if (xData?.kind === 'linear' && new Set(categories).size !== categories.length) hint(errors, info, categoryLine, `数值 x 轴 ${xData.min} --> ${xData.max} 的刻度有重复，类别名已加序号`, `The numeric x-axis ${xData.min} --> ${xData.max} produces repeated ticks; categories were numbered`, '扩大范围或减少数据点', 'Widen the range or use fewer points');

  return {
    model: {
      chart, title, titleLine, xLabel: xTitle, yLabel: yTitle, xLine: xAxisLine, yLine: yAxisLine,
      yDomain: domain, categories, datasets, horizontal: orientation === 'horizontal',
    },
    errors,
  };
}

// 模型 → KChart 声明：单序列用 line/column，多序列或需要图例时用 combo（每个序列一层）。
function specOf(model, info) {
  const en = isEnglish(info?.lang);
  const subtitle = [model.xLabel, model.yLabel].filter(Boolean).join(' · ') || undefined;
  const domain = model.yDomain ? { domain: model.yDomain } : {};
  if (model.chart === 'combo') {
    const data = model.categories.map((category, index) => Object.fromEntries([
      ['category', category],
      ...model.datasets.map((dataset, series) => [`v${series}`, dataset.values[index]]),
    ]));
    return {
      chart: 'combo',
      [diagramCombo]: true,
      ...(model.title ? { title: model.title } : {}),
      ...(subtitle ? { subtitle } : {}),
      data,
      encode: { category: 'category' },
      layers: model.datasets.map((dataset, series) => ({ mark: dataset.type === 'bar' ? 'column' : 'line', field: `v${series}`, axis: 'left' })),
      fields: Object.fromEntries(model.datasets.map((dataset, series) => [`v${series}`, {
        // 无名序列也要有可读的图例项：Mermaid 直接省略，KChart 的 combo 总画图例。
        label: dataset.name || (en ? `Series ${series + 1}` : `系列 ${series + 1}`),
        ...domain,
      }])),
    };
  }
  const dataset = model.datasets[0];
  // 行内点标签借 annotations 的 note 画在每个顶点旁：不需要放宽 chart 契约，也不会改动 JSON 图表输出。
  const labelled = dataset.pointLabels.some(Boolean);
  const data = model.categories.map((category, index) => ({
    category,
    value: dataset.values[index],
    ...(labelled ? { id: String(index) } : {}),
  }));
  return {
    chart: model.chart,
    ...(model.chart === 'line' ? { [diagramLine]: true } : {}),
    ...(model.title ? { title: model.title } : {}),
    ...(subtitle ? { subtitle } : {}),
    data,
    encode: { category: 'category', value: 'value', ...(labelled ? { id: 'id' } : {}) },
    fields: { value: { ...domain, ...(dataset.name ? { label: dataset.name } : {}) } },
    ...(labelled ? {
      annotations: dataset.pointLabels.flatMap((text, index) => text ? [{ kind: 'note', field: 'value', record: String(index), text }] : []),
    } : {}),
  };
}

function lineFor(model, detail) {
  const path = String(detail?.path || '').split('/').slice(1).map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  const series = (value) => { const match = /^v(\d+)$/.exec(String(value || '')); return match ? Number(match[1]) : null; };
  if (path[0] === 'title') return model.titleLine;
  if (path[0] === 'subtitle') return model.xLine || model.yLine;
  if (path[0] === 'layers') return model.datasets[Number(path[1])]?.line || model.datasets[0]?.line;
  if (path[0] === 'fields') {
    const index = series(path[1]);
    return (index === null ? null : model.datasets[index]?.line) || model.yLine || model.datasets[0]?.line;
  }
  if (path[0] === 'encode') return model.xLine || model.datasets[0]?.line;
  if (path[0] === 'annotations') return model.datasets[0]?.line;
  if (path[0] === 'data') {
    const index = series(path[2]);
    return (index === null ? null : model.datasets[index]?.line) || model.datasets[0]?.line;
  }
  return model.datasets[0]?.line;
}

const validate = (model, info) => validateWith(specOf(model, info), info, detail => lineFor(model, detail));
const layout = (model, options, info) => renderWith(specOf(model, info), options, info, detail => lineFor(model, detail));

const implementation = { parse: parseXychart, validate, layout, optionMode: 'raw' };

export const implementations = { xychart: implementation };
