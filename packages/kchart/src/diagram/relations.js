/* Mermaid relation and architecture diagrams rendered as semantic KChart scenes. */

import { error, labelText } from './support.js';
import { parseFlow } from './graph-parse.js';
import { layoutGraph } from './graph-layout.js';
import { cubicPath } from '../core/geometry.js';

const TYPES = ['C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment', 'zenuml'];
const MAX = { nodes: 40, edges: 60, lines: 240 };
const ICONS = {
  cloud: 'M6.657 18c-2.572 0-4.657-2.007-4.657-4.483 0-2.475 2.085-4.482 4.657-4.482.393-1.762 1.794-3.2 3.675-3.773 1.88-.572 3.956-.193 5.444 1 1.488 1.19 2.162 3.007 1.77 4.769h.99c1.913 0 3.464 1.56 3.464 3.486 0 1.927-1.551 3.487-3.465 3.487h-11.878',
  database: 'M4 6a8 3 0 1 0 16 0a8 3 0 1 0 -16 0 M4 6v6a8 3 0 0 0 16 0v-6 M4 12v6a8 3 0 0 0 16 0v-6',
  disk: 'M4 6a8 3 0 1 0 16 0a8 3 0 1 0 -16 0 M4 6v6a8 3 0 0 0 16 0v-6 M4 12v6a8 3 0 0 0 16 0v-6',
  internet: 'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0 M3.6 9h16.8 M3.6 15h16.8 M11.5 3a17 17 0 0 0 0 18 M12.5 3a17 17 0 0 1 0 18',
  server: 'M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3h-12a3 3 0 0 1-3-3v-2 M3 15a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3h-12a3 3 0 0 1-3-3l0-2 M7 8l0 .01 M7 16l0 .01',
  browser: 'M4 8h16 M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-12a2 2 0 0 1-2-2l0-12 M8 4v4',
};
// [中文, English] reader-facing names for C4 element macros and requirement-diagram types.
const TYPE_WORDS = {
  person: ['人员', 'Person'], person_ext: ['外部人员', 'External person'],
  system: ['软件系统', 'Software system'], system_ext: ['外部系统', 'External system'],
  container: ['容器', 'Container'], containerdb: ['数据库容器', 'Database container'], containerqueue: ['队列容器', 'Queue container'],
  component: ['组件', 'Component'], deployment_node: ['部署节点', 'Deployment node'],
  requirement: ['需求', 'Requirement'], functionalrequirement: ['功能需求', 'Functional requirement'],
  interfacerequirement: ['接口需求', 'Interface requirement'], performancerequirement: ['性能需求', 'Performance requirement'],
  physicalrequirement: ['物理需求', 'Physical requirement'], designconstraint: ['设计约束', 'Design constraint'], element: ['元素', 'Element'],
};
const validId = value => /^[\w.-]+$/u.test(value);
const issue = (lang, line, text) => error(lang, line, `不支持或无效的关系图语句：「${text}」`, `Unsupported or invalid relation-diagram statement: "${text}"`, '按受支持子集修正；未实现语法不会被忽略', 'Use the supported subset; unsupported syntax is never ignored');
const unquote = value => String(value || '').trim().replace(/^("|')(.*)\1$/u, '$2');
function splitArgs(source) {
  const result = []; let value = '', quote = '', depth = 0;
  for (const ch of source) {
    if (quote) { value += ch; if (ch === quote) quote = ''; }
    else if (ch === '"' || ch === "'") { quote = ch; value += ch; }
    else if ('([{'.includes(ch)) { depth++; value += ch; }
    else if (')]}'.includes(ch)) { depth--; value += ch; }
    else if (ch === ',' && depth === 0) { result.push(unquote(value).trim()); value = ''; }
    else value += ch;
  }
  result.push(unquote(value).trim()); return result;
}
function parseFor(kind, source, info = {}) {
  const lang = info.lang || 'zh', firstLine = info.firstLine || 2;
  const errors = [], nodes = [], edges = [], groups = [], sequence = [], byId = new Map();
  let title = info.title || '', parent = null, classNode = null, requirement = null, columns = 1, blockGroup = null;
  for (const key of Object.keys(info.options || {})) errors.push(issue(lang, firstLine - 1, `${kind} option ${key}`));
  const addNode = (id, label = id, type = 'node', line = firstLine, extra = {}) => {
    if (!validId(id)) { errors.push(issue(lang, line, id)); return null; }
    let found = byId.get(id);
    if (found) {
      if (extra.declared && found.implicit) Object.assign(found, { label: label || id, type, line, implicit: false, ...extra });
      else if (extra.declared) errors.push(issue(lang, line, `duplicate declaration ${id}`));
      return found;
    }
    found = { id, label: label || id, type, line, parent, implicit: !extra.declared, attrs: [], methods: [], ...extra };
    byId.set(id, found); nodes.push(found); return found;
  };
  const addEdge = (from, to, label, line, type = 'relation', direction = 'both', extra = {}) => edges.push({ from, to, label: label || '', line, type, direction, ...extra });
  const lines = String(source ?? '').replace(/\r\n?/gu, '\n').split('\n');
  if (lines.length > MAX.lines) errors.push(issue(lang, firstLine + MAX.lines, 'input line limit'));
  for (let i = 0; i < Math.min(lines.length, MAX.lines); i++) {
    const text = lines[i].trim(), line = firstLine + i;
    if (!text || text.startsWith('%%')) continue;
    const titleMatch = /^title\s+(.+)$/iu.exec(text);
    if (titleMatch) { if (title) errors.push(issue(lang, line, 'duplicate title')); else title = titleMatch[1]; continue; }
    if (kind === 'classDiagram') {
      let m = /^class\s+([\w.-]+)(?:\s+as\s+(.+?))?\s*\{$/iu.exec(text);
      if (m) { classNode = addNode(m[1], unquote(m[2]) || m[1], 'class', line, { declared: true }); continue; }
      if (text === '}') { if (!classNode) errors.push(issue(lang, line, text)); classNode = null; continue; }
      m = /^([\w.-]+)(?:\s+"([^"]+)")?\s+(<\|--|<\|\.\.|\.\.\|>|\*--|--\*|o--|--o|\.\.>|-->|--|\.\.)(?:\s+"([^"]+)")?\s+([\w.-]+)(?:\s*:\s*(.*))?$/u.exec(text);
      if (m) { addNode(m[1], m[1], 'class', line); addNode(m[5], m[5], 'class', line); addEdge(m[1], m[5], m[6] || '', line, m[3], ['<|--', '<|..'].includes(m[3]) ? 'left' : ['..|>', '-->', '..>'].includes(m[3]) ? 'right' : 'none', { startCard: m[2] || '', endCard: m[4] || '' }); continue; }
      if (classNode && /^[+~#-]?\s*[\w$]+(?:\s*:\s*[\w.$<>\[\]]+|\([^()]*\)(?:\s*:\s*[\w.$<>\[\]]+)?)$/u.test(text)) { (/[()]/u.test(text) ? classNode.methods : classNode.attrs).push(text); continue; }
      m = /^class\s+([\w.-]+)(?:\s+as\s+(.+))?$/iu.exec(text);
      if (m) { addNode(m[1], unquote(m[2]) || m[1], 'class', line, { declared: true }); continue; }
    } else if (kind === 'requirementDiagram') {
      let m = /^(requirement|functionalRequirement|performanceRequirement|interfaceRequirement|physicalRequirement|designConstraint|element)\s+([\w.-]+)\s*\{$/iu.exec(text);
      if (m) { requirement = addNode(m[2], m[2], m[1], line, { declared: true }); continue; }
      if (text === '}') { if (!requirement) errors.push(issue(lang, line, text)); requirement = null; continue; }
      m = /^(id|text|risk|verifymethod|owner|docref)\s*:\s*(.+)$/iu.exec(text);
      if (requirement && m) { requirement.attrs.push(`${m[1]}: ${m[2]}`); continue; }
      m = /^([\w.-]+)\s+-\s*(satisfies|contains|derives|refines|traces|copies|verifies)\s*->\s*([\w.-]+)$/iu.exec(text);
      if (m) { addNode(m[1], m[1], 'requirement', line); addNode(m[3], m[3], 'requirement', line); addEdge(m[1], m[3], m[2], line, m[2], 'right'); continue; }
    } else if (/^C4/u.test(kind)) {
      // One level of grouping: system/container boundaries, or a deployment node that contains elements.
      let m = /^(Enterprise_Boundary|System_Boundary|Container_Boundary|Boundary|Deployment_Node)\s*\(\s*([^,]+),\s*"([^"]+)"(?:,\s*"([^"]*)")?\s*\)\s*\{$/iu.exec(text);
      if (m && m[4] && !/^Deployment_Node$/iu.test(m[1])) m = null;
      if (m) { const id = m[2].trim(); if (parent || !validId(id) || groups.some(g => g.id === id) || byId.has(id)) errors.push(issue(lang, line, `invalid or nested boundary ${id}`)); else { groups.push({ id, label: m[4] ? `${m[3]} [${m[4]}]` : m[3], line, kind: 'c4', parent: null }); parent = id; } continue; }
      if (text === '}') { if (!parent) errors.push(issue(lang, line, text)); parent = null; continue; }
      m = /^Rel(?:_[LRUD])?\s*\(\s*([^,]+),\s*([^,]+),\s*"([^"]+)"(?:,\s*"([^"]*)")?\s*\)$/iu.exec(text);
      if (m) { const label = kind === 'C4Dynamic' && !/^\d+\.\s/u.test(m[3]) ? `${edges.length + 1}. ${m[3]}` : m[3]; addEdge(m[1].trim(), m[2].trim(), label, line, 'Rel', 'right', { description: m[4] || '' }); continue; }
      m = /^Deployment_Node\s*\(\s*([^,]+),\s*"([^"]+)"(?:,\s*"([^"]*)")?\s*\)$/iu.exec(text);
      if (m) { addNode(m[1].trim(), m[2], 'Deployment_Node', line, { attrs: m[3] ? [m[3]] : [], declared: true }); continue; }
      m = /^(Person|Person_Ext|System|System_Ext|Container|ContainerDb|ContainerQueue|Component|Deployment_Node)\s*\((.*)\)$/iu.exec(text);
      if (m) { const args = splitArgs(m[2]); if (args.length >= 2 && args.length <= 5) { addNode(args[0], args[1], m[1], line, { attrs: args.slice(2), declared: true }); continue; } }
    } else if (kind === 'architecture-beta') {
      let m = /^(group|service|junction)\s+([\w.-]+)(?:\(([^)]*)\))?(?:\s*\[([^\]]+)\])?(?:\s+in\s+([\w.-]+))?$/iu.exec(text);
      if (m && (m[1].toLowerCase() === 'junction' || m[4])) {
        const type = m[1].toLowerCase(), icon = (m[3] || '').toLowerCase();
        if (type === 'group' && m[5]) errors.push(issue(lang, line, 'nested architecture groups are unsupported'));
        else if (type !== 'junction' && !ICONS[icon]) errors.push(issue(lang, line, `unrenderable architecture icon ${icon || '(missing)'}`));
        else { const n = addNode(m[2], m[4] || m[2], type, line, { icon, parent: m[5] || null, declared: true }); if (n && type === 'group') groups.push({ id: n.id, label: n.label, line, kind: 'architecture', parent: null }); }
        continue;
      }
      m = /^([\w.-]+)(?::([LRTB]))?\s*(<-->|<--|-->|--)\s*(?:([LRTB]):)?([\w.-]+)(?:\s*:\s*(.+))?$/u.exec(text);
      if (m) { const direction = m[3] === '<-->' ? 'both' : m[3] === '--' ? 'none' : m[3].startsWith('<') ? 'left' : 'right'; addEdge(m[1], m[5], m[6] || '', line, 'architecture', direction, { startPort: m[2] || '', endPort: m[4] || '' }); continue; }
    } else if (kind === 'block-beta') {
      let m = /^columns\s+(\d+)$/iu.exec(text); if (m) { columns = Number(m[1]); if (columns < 1 || columns > 8) errors.push(issue(lang, line, text)); continue; }
      if (/^space$/iu.test(text)) { const n = addNode(`__space${nodes.length + 1}`, ' ', 'space', line, { parent: blockGroup }); if (n) n.hidden = true; continue; }
      m = /^block(?::([\w.-]+))?$/iu.exec(text); if (m) { const id = m[1] || `__block${groups.length + 1}`; if (blockGroup || !validId(id) || byId.has(id)) errors.push(issue(lang, line, 'nested or duplicate block group')); else { groups.push({ id, label: m[1] || 'Block group', line, kind: 'block', parent: null }); blockGroup = id; } continue; }
      if (/^end$/iu.test(text)) { if (!blockGroup) errors.push(issue(lang, line, text)); blockGroup = null; continue; }
      m = /^([\w.-]+)\s*(<-->|<--|-->|---|==|--x)\s*([\w.-]+)(?:\s*:\s*(.*))?$/u.exec(text);
      if (m) { addNode(m[1], m[1], 'block', line, { parent: blockGroup }); addNode(m[3], m[3], 'block', line, { parent: blockGroup }); const direction = { '<-->': 'both', '<--': 'left', '-->': 'right', '--x': 'right' }[m[2]] || 'none'; addEdge(m[1], m[3], m[4] || '', line, m[2], direction); continue; }
      m = /^([\w.-]+)(?:\["?([^\]]+?)"?\])?$/u.exec(text);
      if (m) { addNode(m[1], m[2] || m[1], 'block', line, { parent: blockGroup }); continue; }
    } else if (kind === 'zenuml') {
      if (/^(?:@startuml|@enduml)$/iu.test(text)) continue;
      if (/^[\w.-]+$/u.test(text)) { addNode(text, text, 'participant', line, { declared: true }); continue; }
      let m = /^([\w.-]+)\s*->\s*([\w.-]+)\s*:\s*(.+)$/u.exec(text);
      if (m) { addNode(m[1], m[1], 'participant', line); addNode(m[2], m[2], 'participant', line); sequence.push({ from: m[1], to: m[2], label: m[3], line, kind: 'message' }); continue; }
      m = /^([\w.-]+)\.([\w.-]+)\(([^()]*)\)\s*\{\s*([\w.-]+)\.([\w.-]+)\(([^()]*)\)\s*\}$/u.exec(text);
      if (m) { addNode(m[1], m[1], 'participant', line); addNode(m[4], m[4], 'participant', line); sequence.push({ from: m[1], to: m[1], label: `${m[2]}(${m[3]})`, line, kind: 'call' }, { from: m[1], to: m[4], label: `${m[5]}(${m[6]})`, line, kind: 'call' }); continue; }
      m = /^([\w.-]+)\.([\w.-]+)\(([^()]*)\)$/u.exec(text);
      if (m) { addNode(m[1], m[1], 'participant', line); sequence.push({ from: m[1], to: m[1], label: `${m[2]}(${m[3]})`, line, kind: 'call' }); continue; }
    }
    errors.push(issue(lang, line, text));
  }
  if (classNode) errors.push(issue(lang, classNode.line, 'class block missing }'));
  if (requirement) errors.push(issue(lang, requirement.line, 'requirement block missing }'));
  if (parent || blockGroup) errors.push(issue(lang, firstLine + lines.length - 1, 'unclosed group'));
  for (const edge of edges) {
    const a = byId.get(edge.from), b = byId.get(edge.to);
    if (!a || !b) errors.push(issue(lang, edge.line, `unknown endpoint ${edge.from} -> ${edge.to}`));
    else if ((/^C4/u.test(kind) || kind === 'architecture-beta') && (a.implicit || b.implicit)) errors.push(issue(lang, edge.line, `undeclared endpoint ${a.implicit ? a.id : b.id}`));
    // A group is drawn as a container around its services, never as a node of its own.
    else if (a.type === 'group' || b.type === 'group') errors.push(issue(lang, edge.line, `edges to a group are unsupported: ${a.type === 'group' ? a.id : b.id}`));
  }
  for (const group of groups) {
    if (group.parent && !groups.some(candidate => candidate.id === group.parent)) errors.push(issue(lang, group.line, `unknown group parent ${group.parent}`));
    if (group.kind !== 'architecture' && byId.has(group.id)) errors.push(issue(lang, group.line, `group id conflicts with node ${group.id}`));
  }
  for (const node of nodes) if (node.parent && !byId.has(node.parent) && !groups.some(group => group.id === node.parent)) errors.push(issue(lang, node.line, `unknown group ${node.parent}`));
  if (kind === 'block-beta' && columns > 1 && nodes.length > columns) errors.push(issue(lang, nodes[columns].line, 'multi-row block grids are unsupported'));
  if (nodes.length > MAX.nodes) errors.push(issue(lang, nodes[MAX.nodes].line, 'node limit exceeded'));
  if (edges.length > MAX.edges) errors.push(issue(lang, edges[MAX.edges].line, 'edge limit exceeded'));
  if (!nodes.length) errors.push(issue(lang, firstLine, 'diagram must contain at least one node'));
  return { model: { kind, title, nodes, edges, groups, sequence, columns }, errors };
}
function layoutSequence(model, ctx) {
  const boxW = Math.max(112, ...model.nodes.map(n => ctx.measure(n.label, 13, 600) + 24));
  const gap = boxW + 38, top = 24, pad = 16;
  const xOf = new Map(model.nodes.map((n, i) => [n.id, pad + boxW / 2 + i * gap]));
  const width = 2 * pad + boxW + Math.max(0, model.nodes.length - 1) * gap;
  const height = Math.max(120, 92 + model.sequence.length * 56), children = [];
  for (const n of model.nodes) {
    const x = xOf.get(n.id);
    children.push(ctx.rect(x - boxW / 2, top, boxW, 34, {
      rx: 7, fill: ctx.color('bg'), stroke: ctx.color('axis'), 'stroke-width': 1,
      meta: { kind: 'participant', node: n.id },
    }));
    children.push(ctx.text(x, top + 22, n.label, {
      anchor: 'middle', size: 13, weight: 600, fill: ctx.color('fg'), meta: { kind: 'participant-label', node: n.id },
    }));
    children.push(ctx.line(x, top + 34, x, height - 12, {
      stroke: ctx.color('tone5'), 'stroke-width': 1, 'stroke-dasharray': '4 4', meta: { kind: 'lifeline', participant: n.id },
    }));
  }
  for (const [i, event] of model.sequence.entries()) {
    const y = 82 + i * 56, x1 = xOf.get(event.from), x2 = xOf.get(event.to);
    if (x1 === x2) {
      children.push(ctx.path(`M${x1} ${y} H${x1 + 26} V${y + 18} H${x1}`, {
        fill: 'none', stroke: ctx.design.fg4, 'stroke-width': 1.2, meta: { kind: 'call', line: event.line },
      }));
      children.push(ctx.text(x1 + 32, y + 13, event.label, { size: 12, meta: { kind: 'message-label', line: event.line } }));
    } else {
      const direction = x2 > x1 ? -1 : 1;
      children.push(ctx.line(x1, y, x2, y, { stroke: ctx.design.fg4, 'stroke-width': 1.2, meta: { kind: 'message', line: event.line } }));
      children.push(ctx.shape('polygon', { points: `${x2},${y} ${x2 + direction * 7},${y - 4} ${x2 + direction * 7},${y + 4}`, fill: ctx.color('muted') }, { kind: 'message-arrow', line: event.line }));
      children.push(ctx.text((x1 + x2) / 2, y - 6, event.label, { anchor: 'middle', size: 12, meta: { kind: 'message-label', line: event.line } }));
    }
  }
  const scene = { width, height, children, title: model.title || model.kind, heading: model.title || undefined };
  return { width, height, scene, errors: [] };
}
function layoutGeometry(model, { width = 800, lang = 'zh', measure, ctx }) {
  if (model.kind === 'zenuml') return layoutSequence(model, ctx);
  const ids = new Map(model.nodes.map((n, i) => [n.id, `rel_${i}`]));
  // Type words carry meaning in C4 and requirement diagrams; generic ones would repeat on every card.
  // Cards show the reader's word for a type, not the macro or keyword that declared it.
  const english = /^en(?:-|$)/iu.test(String(lang));
  const typeWord = type => { const words = TYPE_WORDS[String(type).toLowerCase()]; return words ? words[english ? 1 : 0] : type; };
  const typeLine = n => (['node', 'class', 'service', 'block', 'group', 'junction'].includes(n.type) ? [] : [typeWord(n.type)]);
  const quoted = text => String(text).replace(/"/gu, '&quot;');
  const nodeStatement = n => ({ text: `${ids.get(n.id)}["${quoted([n.label, ...typeLine(n), ...(n.attrs || []), ...(n.methods || [])].join('<br/>'))}"]`, line: n.line });
  // Each group becomes a subgraph, so the layout reserves its title band and padding instead of
  // boxes being drawn around nodes afterwards and crowding the edge between two groups.
  const groupIndex = new Map(model.groups.map((group, i) => [group.id, i]));
  const statements = [], emitted = new Set();
  for (const n of model.nodes.filter(node => node.type !== 'group')) {
    if (!groupIndex.has(n.parent)) { statements.push(nodeStatement(n)); continue; }
    if (emitted.has(n.parent)) continue;
    emitted.add(n.parent);
    const group = model.groups[groupIndex.get(n.parent)];
    statements.push({ text: `subgraph grp_${groupIndex.get(n.parent)}["${quoted(group.label)}"]`, line: group.line },
      ...model.nodes.filter(member => member.type !== 'group' && member.parent === n.parent).map(nodeStatement), { text: 'end', line: group.line });
  }
  for (const edge of model.edges) statements.push({ text: `${ids.get(edge.from)} --> ${ids.get(edge.to)}`, line: edge.line });
  if (model.kind === 'block-beta' && model.columns > 1) for (let i = 0; i + model.columns < model.nodes.length; i++) statements.push({ text: `${ids.get(model.nodes[i].id)} --> ${ids.get(model.nodes[i + model.columns].id)}`, line: model.nodes[i].line });
  // Architecture ports say where a neighbour sits; mostly left/right ports read best as a row.
  const ports = model.kind === 'architecture-beta' ? model.edges.flatMap(edge => [edge.startPort, edge.endPort]).filter(Boolean) : [];
  const sideways = ports.filter(port => port === 'L' || port === 'R').length;
  const direction = (model.kind === 'block-beta' && model.columns > 1) || (sideways && sideways * 2 >= ports.length) ? 'LR' : 'TB';
  const parsed = parseFlow(statements, { direction });
  if (parsed.errors?.length) return { width, height: 1, scene: ctx.scene(1, [], model.title || model.kind), errors: parsed.errors };
  // An icon sits left of its node's title, so that title is measured 24px wider and drawn 12px right.
  const iconTitles = new Set(model.nodes.filter(n => n.icon && ICONS[n.icon]).map(n => n.label));
  const graph = layoutGraph(parsed.model, { width, measure: (text, font) => measure(text, font) + (iconTitles.has(text) ? 24 : 0) });
  const placements = new Map();
  for (const item of graph.nodes) { const n = model.nodes[Number(String(item.id).replace('rel_', ''))]; if (n) placements.set(n.id, { n, x: item.x + item.w / 2, y: item.y + item.h / 2, w: item.w, h: item.h, attrs: [...typeLine(n), ...(n.attrs || [])], methods: n.methods || [] }); }
  const frames = new Map((graph.frames || []).map(frame => [frame.id, frame]));
  const groupBounds = model.groups.map((group, i) => {
    const frame = frames.get(`grp_${i}`);
    return frame ? { group, left: frame.x, right: frame.x + frame.w, top: frame.y, bottom: frame.y + frame.h } : null;
  }).filter(Boolean);
  const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const errors = [];
  for (let i = 0; i < groupBounds.length; i++) {
    for (let j = i + 1; j < groupBounds.length; j++) if (overlaps(groupBounds[i], groupBounds[j])) errors.push(error(lang, groupBounds[j].group.line, '分组边界交叠', 'Relation group boundaries overlap', '调整分组成员或拆分图', 'Adjust group members or split the diagram'));
    for (const placement of placements.values()) if (placement.n.parent !== groupBounds[i].group.id && overlaps(groupBounds[i], { left: placement.x - placement.w / 2, right: placement.x + placement.w / 2, top: placement.y - placement.h / 2, bottom: placement.y + placement.h / 2 })) errors.push(error(lang, placement.n.line, '节点落入其他分组边界', 'A node overlaps another group boundary', '调整分组成员或拆分图', 'Adjust group members or split the diagram'));
  }
  if (errors.length) return { width: graph.width, height: 1, scene: ctx.scene(1, [], model.title || model.kind), errors };
  const children = [];
  for (const { group, left, right, top, bottom } of groupBounds) {
    children.push(ctx.rect(left, top, right - left, bottom - top, {
      rx: 9, fill: ctx.color('bg'), 'fill-opacity': .3, stroke: ctx.color('axis'), 'stroke-width': 1,
      meta: { kind: 'group', group: group.id },
    }));
    children.push(ctx.text(left + 12, top + 16, group.label, {
      size: 12, weight: 600, fill: ctx.color('muted'), meta: { kind: 'group-label', group: group.id },
    }));
  }
  // 连线穿过分组标题时在标题处断开。分组底色半透明，实色底板会露出色块，所以用带孔的裁剪区把标题挖空。
  const titleHoles = groupBounds.map(({ group, left, top }) => ({ x: left + 8, y: top + 3, w: ctx.measure(group.label, 12, 600) + 8, h: 18 }));
  let edgeClip = null;
  if (titleHoles.length) {
    const x0 = Math.min(0, ...groupBounds.map(g => g.left)) - 24, y0 = Math.min(0, ...groupBounds.map(g => g.top)) - 24;
    const x1 = Math.max(graph.width, ...groupBounds.map(g => g.right)) + 24, y1 = Math.max(graph.height, ...groupBounds.map(g => g.bottom)) + 24;
    const d = [`M${x0} ${y0}H${x1}V${y1}H${x0}Z`, ...titleHoles.map(h => `M${h.x} ${h.y}H${h.x + h.w}V${h.y + h.h}H${h.x}Z`)].join('');
    children.push(ctx.el('clipPath', { id: 'group-titles' }, [ctx.path(d, { 'clip-rule': 'evenodd', meta: { kind: 'group-title-holes' } })]));
    edgeClip = 'url(#group-titles)';
  }
  for (const route of graph.edges) {
    if (route.id >= model.edges.length) continue;
    const edge = model.edges[route.id], a = placements.get(edge?.from), b = placements.get(edge?.to); if (!edge || !a || !b) continue;
    let end = route.end || { x: b.x - b.w / 2, y: b.y }, start = route.start || { x: a.x + a.w / 2, y: a.y };
    let path;
    if (edge.type === 'architecture' && (edge.startPort || edge.endPort)) {
      const portPoint = (placement, port) => port === 'L' ? { x: placement.x - placement.w / 2, y: placement.y } : port === 'R' ? { x: placement.x + placement.w / 2, y: placement.y } : port === 'T' ? { x: placement.x, y: placement.y - placement.h / 2 } : { x: placement.x, y: placement.y + placement.h / 2 };
      const step = (point, port) => ({ x: point.x + (port === 'L' ? -12 : port === 'R' ? 12 : 0), y: point.y + (port === 'T' ? -12 : port === 'B' ? 12 : 0) });
      if (edge.startPort) start = portPoint(a, edge.startPort);
      if (edge.endPort) end = portPoint(b, edge.endPort);
      // Leave each port straight out, then join the two stubs with at most two orthogonal bends.
      const out = edge.startPort ? step(start, edge.startPort) : start, into = edge.endPort ? step(end, edge.endPort) : end;
      const across = port => port === 'L' || port === 'R';
      const startAcross = edge.startPort ? across(edge.startPort) : Math.abs(into.x - out.x) >= Math.abs(into.y - out.y);
      const endAcross = edge.endPort ? across(edge.endPort) : startAcross;
      const bends = out.x === into.x || out.y === into.y ? []
        : startAcross && endAcross ? [{ x: (out.x + into.x) / 2, y: out.y }, { x: (out.x + into.x) / 2, y: into.y }]
          : !startAcross && !endAcross ? [{ x: out.x, y: (out.y + into.y) / 2 }, { x: into.x, y: (out.y + into.y) / 2 }]
            : startAcross ? [{ x: into.x, y: out.y }] : [{ x: out.x, y: into.y }];
      const points = [start, out, ...bends, into, end].filter((point, index, all) => !index || point.x !== all[index - 1].x || point.y !== all[index - 1].y);
      path = points.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join(' ');
    } else path = cubicPath(route.segments);
    const dashed = ['..|>', '<|..', '..>', '..'].includes(edge.type);
    children.push(ctx.path(path, { fill: 'none', stroke: ctx.design.fg4, 'stroke-width': 1.25, 'stroke-dasharray': dashed ? '4 3' : null, 'clip-path': edgeClip, meta: { kind: 'edge', edge: String(route.id), source: edge.from, target: edge.to, type: edge.type, startPort: edge.startPort || undefined, endPort: edge.endPort || undefined, direction: edge.direction } }));
    const vectorAt = atStart => {
      const port = atStart ? edge.startPort : edge.endPort;
      if (edge.type === 'architecture' && port) return port === 'L' ? { x: 1, y: 0 } : port === 'R' ? { x: -1, y: 0 } : port === 'T' ? { x: 0, y: 1 } : { x: 0, y: -1 };
      const segment = atStart ? route.segments?.[0] : route.segments?.at(-1);
      if (!segment) return { x: atStart ? -1 : 1, y: 0 };
      const from = atStart ? segment.p1 : segment.p0, to = atStart ? segment.p0 : segment.p1;
      const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy) || 1;
      return { x: dx / length, y: dy / length };
    };
    // How far each end marker reaches along the edge; the label keeps to the free stretch between them.
    const reach = { start: 0, end: 0 };
    if (edge.type === '--x') {
      reach.end = 5;
      const { x, y } = end;
      children.push(ctx.path(`M${x - 4} ${y - 4} L${x + 4} ${y + 4} M${x + 4} ${y - 4} L${x - 4} ${y + 4}`, {
        fill: 'none', stroke: ctx.design.fg4, 'stroke-width': 1.25, meta: { kind: 'relation-marker', edge: String(route.id), marker: 'cross' },
      }));
    }
    const marker = (point, type, filled = false, vector = { x: -1, y: 0 }) => {
      const { x: ux, y: uy } = vector, px = -uy, py = ux;
      let points;
      if (type === 'triangle') points = `${point.x},${point.y} ${point.x - ux * 7 + px * 5},${point.y - uy * 7 + py * 5} ${point.x - ux * 7 - px * 5},${point.y - uy * 7 - py * 5}`;
      else if (type === 'diamond') points = `${point.x},${point.y} ${point.x - ux * 6 + px * 5},${point.y - uy * 6 + py * 5} ${point.x - ux * 12},${point.y - uy * 12} ${point.x - ux * 6 - px * 5},${point.y - uy * 6 - py * 5}`;
      else points = `${point.x},${point.y} ${point.x - ux * 7 + px * 4},${point.y - uy * 7 + py * 4} ${point.x - ux * 7 - px * 4},${point.y - uy * 7 - py * 4}`;
      reach[point === start ? 'start' : 'end'] = type === 'diamond' ? 12 : 7;
      children.push(ctx.shape('polygon', { points, fill: type === 'triangle' || (type === 'diamond' && !filled) ? ctx.color('bg') : ctx.color('muted'), ...(type === 'arrow' ? {} : { stroke: ctx.color('muted'), 'stroke-width': 1 }) }, { kind: 'relation-marker', edge: String(route.id), marker: type }));
    };
    if (edge.type === '<|--' || edge.type === '<|..') marker(start, 'triangle', false, vectorAt(true)); else if (edge.type === '..|>') marker(end, 'triangle', false, vectorAt(false));
    else if (['*--', '--*', 'o--', '--o'].includes(edge.type)) { const atStart = edge.type.startsWith('*') || edge.type.startsWith('o'); marker(atStart ? start : end, 'diamond', edge.type.includes('*'), vectorAt(atStart)); }
    else {
      if (edge.direction === 'left' || edge.direction === 'both') marker(start, 'arrow', false, vectorAt(true));
      if (edge.type !== '--x' && (edge.direction === 'right' || edge.direction === 'both')) marker(end, 'arrow', false, vectorAt(false));
    }
    let labelBox;
    if (edge.label) {
      // Vertical edges centre the plate on the free stretch; horizontal edges keep it just above the line.
      const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy) || 1;
      const along = reach.start + Math.max(0, length - reach.start - reach.end) / 2;
      const mx = start.x + dx / length * along, my = start.y + dy / length * along;
      const upright = Math.abs(dy) > Math.abs(dx) && (reach.start || reach.end);
      const x = mx, y = upright ? my + (edge.description ? -2 : 5) : my - (edge.description ? 10 : 4);
      const labels = [edge.label, edge.description].filter(Boolean);
      const w = Math.max(...labels.map(label => ctx.measure(label, 12, 400))) + 14;
      labelBox = { x: x - w / 2, y: y - 15, w, h: edge.description ? 34 : 20 };
      children.push(ctx.rect(labelBox.x, labelBox.y, labelBox.w, labelBox.h, {
        rx: 5, fill: ctx.color('bg'), stroke: ctx.color('grid'), 'stroke-width': .6,
      }));
      labels.forEach((label, index) => children.push(ctx.text(x, y + index * 14, label, {
        anchor: 'middle', size: 12, fill: ctx.color('muted'),
        meta: { kind: index ? 'edge-description' : 'edge-label', edge: String(route.id) },
      })));
    }
    // 基数先向框外走，再退到路径旁；固定把 y 减小会让纵向出线的基数压住卡片内容。
    for (const [point, value, atStart] of [[start, edge.startCard, true], [end, edge.endCard, false]]) {
      if (!value) continue;
      const into = vectorAt(atStart);
      const vertical = Math.abs(into.y) > Math.abs(into.x);
      let x = vertical ? point.x + (atStart ? -6 : 6) : point.x - Math.sign(into.x) * 6;
      let y = vertical ? point.y - Math.sign(into.y) * 8 : point.y - 9;
      const anchor = vertical ? (atStart ? 'end' : 'start') : (into.x > 0 ? 'end' : 'start');
      if (labelBox && y + 7 > labelBox.y && y - 7 < labelBox.y + labelBox.h) {
        const w = ctx.measure(value, 12, 400);
        const left = anchor === 'end' ? x - w : x;
        if (left < labelBox.x + labelBox.w + 4 && left + w > labelBox.x - 4) {
          if (vertical) x = atStart ? labelBox.x - 4 : labelBox.x + labelBox.w + 4;
          else y = labelBox.y - 9;
        }
      }
      children.push(ctx.text(x, y, value, {
        anchor, size: 12, fill: ctx.color('muted'), 'dominant-baseline': 'central',
        meta: { kind: 'cardinality', edge: String(route.id), endpoint: atStart ? 'start' : 'end' },
      }));
    }
  }
  for (const p of placements.values()) {
    if (p.n.hidden) continue;
    const left = p.x - p.w / 2, top = p.y - p.h / 2;
    // A header band only separates the title from detail lines; a title-only card is one plain box with the title centred.
    const detailed = p.attrs.length + p.methods.length > 0;
    children.push(ctx.rect(left, top, p.w, p.h, { rx: 8, fill: ctx.color('bg'), stroke: ctx.color('axis'), 'stroke-width': 1, meta: { kind: 'node', node: p.n.id, type: p.n.type } }));
    if (detailed) children.push(ctx.rect(left, top, p.w, 31, { rx: 8, fill: ctx.color('grid'), 'fill-opacity': .5, stroke: 'none', meta: { kind: 'node-header', node: p.n.id } }));
    const titleY = detailed ? top + 20 : p.y + 5, iconY = detailed ? top + 7 : p.y - 8.64;
    if (p.n.icon && ICONS[p.n.icon]) children.push(ctx.path(ICONS[p.n.icon], { transform: `translate(${left + 9} ${iconY}) scale(.72)`, fill: 'none', stroke: ctx.color('muted'), 'stroke-width': 1.8, meta: { kind: 'icon', node: p.n.id, icon: p.n.icon } }));
    children.push(ctx.text(p.x + (p.n.icon && ICONS[p.n.icon] ? 12 : 0), titleY, p.n.label, { anchor: 'middle', size: 14, weight: 600, fill: ctx.color('fg'), meta: { kind: 'node-label', node: p.n.id } }));
    let y = top + 48;
    for (const [i, text] of [...p.attrs, ...p.methods].entries()) { if (i === p.attrs.length && p.methods.length) children.push(ctx.line(left + 10, y - 12, left + p.w - 10, y - 12, { stroke: ctx.color('grid'), 'stroke-width': .8, meta: { kind: 'member-divider', node: p.n.id } })); for (const paragraph of String(text).split(/<br\s*\/?\s*>/iu)) for (const line of ctx.wrap(labelText(paragraph), Math.max(1, p.w - 24), 12, 400)) { children.push(ctx.text(left + 12, y, line, { anchor: 'start', size: 12, fill: ctx.color('muted'), meta: { kind: 'node-detail', node: p.n.id } })); y += 16; } }
  }
  // 无关图族不加固定边距。只有分组实际超出节点布局的边界时才补留白。
  const topInset = Math.max(0, ...groupBounds.map(group => 12 - group.top));
  const leftInset = Math.max(0, ...groupBounds.map(group => 12 - group.left));
  const bottom = Math.max(graph.height + 10, ...groupBounds.map(group => group.bottom + 12));
  const right = Math.max(graph.width, ...groupBounds.map(group => group.right + 12));
  const height = Math.max(100, bottom + topInset), sceneWidth = right + leftInset;
  const shapes = leftInset || topInset ? [ctx.el('g', { transform: `translate(${leftInset} ${topInset})` }, children)] : children;
  const scene = { width: sceneWidth, height, children: shapes, title: model.title || model.kind, heading: model.title || undefined };
  return { width: sceneWidth, height, geometry: graph, scene, errors: [] };
}
const implementations = Object.fromEntries(TYPES.map(kind => [kind, { parse: (body, info) => parseFor(kind, body, info), layout: layoutGeometry }]));

export { implementations };
