/* sankey：Mermaid 桑基图语法 → KChart sankey 声明。

   numeric-parse 的桑基分支按 KChart 的严格守恒契约解析；Mermaid 允许中间节点
   入流与出流不等（节点取较大一侧，差额就是可见的损耗信号），因此这里用
   `tolerant` 打开同一引擎的宽松模式，并保留 Mermaid 的 CSV 细节：
   `""` 转义、乱序空行、仅在引号内允许的逗号与非 ASCII 文本。 */

import { error, warning } from './support.js';
import { numericLabel, renderWith, validateWith } from './numeric-model.js';
import { presentation } from './presentation.js';
import { sankeyPresentation } from '../chart/relations.js';

const MAX_NODES = 60, MAX_EDGES = 120;
const issue = (info, line, zh, en, fixZh = '修正 Mermaid sankey 语法', fixEn = 'Correct the Mermaid sankey syntax') => error(info.lang, line, zh, en, fixZh, fixEn);
const hint = (info, line, zh, en, fixZh, fixEn) => warning('DIAGRAM_HINT', info.lang, line, zh, en, fixZh, fixEn);
const configNote = (info, line, zh, en, fixZh, fixEn) => warning('IGNORED_CONFIG', info.lang, line, zh, en, fixZh, fixEn);
// Mermaid 只接受 ASCII 0x20–0x7E 的未加引号文本；KChart 接受更多字符，因此不会因字符集报错。
const csv = (text) => {
  const cells = []; let value = '', quoted = false, after = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { value += '"'; i += 1; }
      else if (char === '"') { quoted = false; after = true; }
      else value += char;
    } else if (char === '"') {
      if (value.trim() || after) return null;
      value = ''; quoted = true;
    } else if (char === ',') { cells.push(value.trim()); value = ''; after = false; }
    else if (after && !/\s/.test(char)) return null;
    else value += char;
  }
  if (quoted) return null;
  cells.push(value.trim());
  return cells;
};

const value = (text) => {
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : null;
};

// 前端配置只读取 KChart 真能画出的项：showValues 与纯单位字符串的 prefix/suffix。
const configValue = (config, name) => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return undefined;
  const key = Object.keys(config).find(candidate => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : config[key];
};
const configFlag = (config, name) => {
  const found = configValue(config, name);
  return typeof found === 'boolean' ? found : undefined;
};

// 一项配置只产生一条告警，避免 68 行的能源图刷屏。
const UNSUPPORTED_CONFIG = [
  ['linkColor', 'KChart 流带统一使用主题 tone2；请改用主题调整颜色', 'KChart ribbons always use theme tone2; adjust the theme instead'],
  ['nodeAlignment', 'KChart 自动做交叉最少化排序，不接受 nodeAlignment', 'KChart orders nodes by crossing minimisation instead of nodeAlignment'],
  ['nodeWidth', 'KChart 节点厚度固定为 18px', 'KChart fixes node thickness at 18px'],
  ['nodePadding', 'KChart 按实测标签计算节点间距', 'KChart derives node spacing from measured labels'],
  ['labelStyle', 'KChart 的桑基标签已带描边衬底', 'KChart sankey labels already sit on an outlined plate'],
  ['nodeColors', '颜色由主题 tone 决定，忽略 nodeColors', 'Colors come from theme tones; nodeColors is ignored'],
  ['width', '场景宽度取调用方给出的宽度，忽略 width', 'The scene takes the caller width; the width option is ignored'],
  ['height', '场景高度按节点和标签推算，忽略 height', 'The scene height follows nodes and labels; the height option is ignored'],
];

function configWarnings(info) {
  const config = configValue(info.config, 'sankey');
  if (!config || typeof config !== 'object' || Array.isArray(config)) return [];
  const out = [];
  const line = info.configLines?.sankey || info.headerLine || info.firstLine;
  for (const [key, zh, en] of UNSUPPORTED_CONFIG) {
    if (configValue(config, key) === undefined) continue;
    out.push(configNote(info, line, `sankey.${key} 不生效：${zh}`, `sankey.${key} is ignored: ${en}`, '移除该项，或改用主题与 KChart 支持的 sankey 配置', 'Remove it, or use the theme and the supported sankey options'));
  }
  return out;
}

function parseSankey(source, info) {
  const errors = [], rows = [], nodes = [];
  const look = presentation({ lang: info.lang });
  const header = String(info.params || Object.keys(info.options || {}).join(' ')).replace(/\s*:\s*$/, '').trim();
  if (header) errors.push(issue(info, info.headerLine || info.firstLine, `sankey 不支持头行选项「${header}」`, `sankey does not accept header options: ${header}`, '把配置写在前言区 sankey: 下', 'Put options under front matter sankey:'));
  String(source).split('\n').forEach((raw, index) => {
    const text = raw.trim(), line = info.firstLine + index;
    if (!text || text.startsWith('%%') || look.accept(text, line)) return;
    const cells = csv(text);
    if (!cells) { errors.push(issue(info, line, 'sankey CSV 引号格式错误', 'Malformed sankey CSV quoting', '用成对的 " 包住含逗号的名称，字段内引号写作 ""', 'Wrap names that contain commas in " and write inner quotes as ""')); return; }
    if (cells.length !== 3) { errors.push(issue(info, line, `sankey 每行必须是 Source,Target,Value 三列，本行 ${cells.length} 列`, `Each sankey row needs exactly 3 columns, got ${cells.length}`, '每行只写来源、目标、数值三列', 'Write source, target and value only')); return; }
    const [from, to] = [cells[0], cells[1]], amount = value(cells[2]);
    if (!from || !to) { errors.push(issue(info, line, 'sankey 来源与目标不能为空', 'Sankey source and target must not be empty')); return; }
    if (amount === null || amount <= 0) { errors.push(issue(info, line, `sankey 流量必须为正有限数，本行「${cells[2]}」`, `Sankey value must be a positive finite number, got "${cells[2]}"`, '把数值改为大于 0 的有限数', 'Use a positive finite number')); return; }
    for (const id of [from, to]) if (!nodes.includes(id)) nodes.push(id);
    rows.push({ id: `edge-${rows.length + 1}`, source: from, target: to, value: amount, line });
  });
  if (!rows.length && !errors.length) errors.push(issue(info, info.firstLine, 'sankey 至少需要一条有效流量 CSV 记录', 'Sankey needs at least one valid CSV flow record'));
  if (nodes.length > MAX_NODES) errors.push(issue(info, info.firstLine, `sankey 最多 ${MAX_NODES} 个节点，当前 ${nodes.length} 个`, `Sankey supports at most ${MAX_NODES} nodes, got ${nodes.length}`, '合并同名来源或目标后重试', 'Merge related sources or targets'));
  if (rows.length > MAX_EDGES) errors.push(issue(info, info.firstLine, `sankey 最多 ${MAX_EDGES} 条流量，当前 ${rows.length} 条`, `Sankey supports at most ${MAX_EDGES} flows, got ${rows.length}`, '合并相同来源与目标的流量后重试', 'Combine flows that share a source and target'));
  const showValues = configFlag(configValue(info.config, 'sankey'), 'showValues') ?? true;
  return {
    model: {
      chart: 'sankey',
      nodes: nodes.map(id => ({ id, label: numericLabel(id, info, rows.find(e => e.source === id || e.target === id)?.line, errors), [sankeyPresentation]: { status: look.statusOf(id), link: look.linkOf(id) } })),
      edges: rows.map((edge, index) => ({ ...edge, [sankeyPresentation]: look.edgeStatusOf(index) })),
      showValues,
      unit: unitOf(info),
    },
    errors: [...errors, ...look.diagnostics()],
  };
}

// prefix/suffix 只在纯粹是单位文本时映射成 KChart 的 unit，否则交给共享层告警。
function unitOf(info) {
  const config = configValue(info.config, 'sankey');
  const prefix = configValue(config, 'prefix'), suffix = configValue(config, 'suffix');
  if (prefix === undefined && suffix === undefined) return undefined;
  const text = value => value === undefined || value === null ? '' : String(value);
  const [pre, post] = [text(prefix), text(suffix)];
  return /^[\p{L}\p{Sc}%‰°]*\p{Sc}?[\p{L}\p{Sc}%‰°]*$/u.test(`${pre}${post}`) && `${pre}${post}` ? `${pre}${post}` : undefined;
}

function toSpec(model) {
  return {
    chart: 'sankey',
    tolerant: true,
    [sankeyPresentation]: true,
    data: { nodes: model.nodes, edges: model.edges.map(({ line, ...edge }) => edge) },
    layout: 'right',
    showValues: model.showValues,
    ...(model.unit ? { unit: model.unit } : {}),
  };
}

// 声明错误回到它引用的节点或流量所在行，读者才知道改哪一条。
function lineFor(model, detail) {
  const path = String(detail?.path || '').split('/').slice(1).map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  const indexAt = key => path[path.indexOf(key) + 1];
  const edgeIndex = Number(indexAt('edges'));
  if (Number.isInteger(edgeIndex) && model.edges[edgeIndex]) return model.edges[edgeIndex].line;
  const nodeIndex = Number(indexAt('nodes'));
  if (Number.isInteger(nodeIndex) && model.nodes[nodeIndex]) {
    const id = model.nodes[nodeIndex].id;
    return model.edges.find(edge => edge.source === id || edge.target === id)?.line;
  }
  return model.edges[0]?.line;
}

const validate = (model, info) => validateWith(toSpec(model), info, detail => lineFor(model, detail));
const layout = (model, options, info) => renderWith(toSpec(model), options, info, detail => lineFor(model, detail));

export const honoredConfig = Object.freeze(['sankey.showValues', 'sankey.prefix', 'sankey.suffix']);

const implementation = { parse: parseSankey, validate, layout, optionMode: 'raw', acceptsPresentation: true, honoredConfig };

export const implementations = { sankey: implementation };
