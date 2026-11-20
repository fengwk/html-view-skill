import { parseGraph } from './graph-parse.js';
import { layout as laneLayout, scene } from './swimlane.js';
import { error, warning } from './support.js';

function parse(body, info) {
  const { lang, firstLine, headerLine = firstLine - 1 } = info;
  const errors = [];
  const fix = ['检查泳道声明', 'Check the swimlane declaration'];
  const fail = (line, zh, en) => errors.push(error(lang, line, zh, en, ...fix));
  const hint = (line, zh, en) => errors.push(warning('DIAGRAM_HINT', lang, line, zh, en, ...fix));
  let direction;
  function setDirection(value, line) {
    let next = value.toUpperCase();
    if (next === 'TD') next = 'TB';
    if (['BR', '<', '>', '^', 'V'].includes(next)) {
      hint(line, `方向 ${value} 按 TB 绘制`, `Direction ${value} is drawn as TB`);
      next = 'TB';
    }
    if (!['LR', 'RL', 'TB', 'BT'].includes(next)) fail(line, '无效的泳道方向', 'Invalid swimlane direction');
    else if (direction && direction !== next) fail(line, '泳道方向声明冲突', 'Conflicting swimlane directions');
    else direction = next;
  }
  const params = info.params.trim();
  if (params) setDirection(params, headerLine);
  const source = body.split('\n').map((row, index) => {
    const dir = /^\s*direction\s+(\S+)\s*$/i.exec(row);
    if (!dir) return row;
    setDirection(dir[1], firstLine + index);
    return '';
  }).join('\n');
  // The Mermaid family also shares flowchart tokenization, presentation and label normalization.
  const flow = parseGraph(source, { ...info, kind: 'flowchart', syntax: 'mermaid', headerLine, header: `flowchart ${direction || 'TB'}` });
  errors.push(...flow.errors);
  const groups = new Map(flow.model.subgraphs.map(group => [group.id, group]));
  const lanes = flow.model.subgraphs.filter(group => group.parent == null)
    .map(group => ({ ...group, name: group.title, nodes: [] }));
  const nested = flow.model.subgraphs.filter(group => group.parent != null).map(group => ({ ...group, nodes: [] }));
  const nestedById = new Map(nested.map(group => [group.id, group]));
  const byLane = new Map(lanes.map(lane => [lane.id, lane]));
  let unassigned;
  const nodes = flow.model.nodes.map(node => {
    let parent = groups.get(node.parent);
    const ancestors = [];
    while (parent?.parent != null) {
      ancestors.push(nestedById.get(parent.id));
      parent = groups.get(parent.parent);
    }
    for (const group of ancestors) {
      group.lane = parent.id;
      group.nodes.push(node.id);
    }
    let lane = byLane.get(parent?.id);
    if (!lane) {
      if (!unassigned) {
        let id = '@unassigned';
        while (groups.has(id)) id += '_';
        unassigned = { id, name: /^en\b/i.test(lang) ? 'Unassigned' : '未分配', line: node.line, nodes: [] };
        lanes.push(unassigned);
        hint(node.line, '未归属节点被放入独立泳道', 'Unassigned nodes are drawn in a separate lane');
      }
      lane = unassigned;
    }
    lane.nodes.push(node.id);
    return { ...node, lane: lane.id };
  });
  if (lanes.length > 6) fail(lanes[6].line, '最多 6 条泳道', 'At most 6 lanes');
  const unsupported = nodes.filter(node => !['rect', 'round', 'stadium', 'circle', 'diamond'].includes(node.shape));
  if (unsupported.length) hint(unsupported[0].line, '其他节点形状按圆角矩形绘制', 'Other node shapes are drawn as rounded rectangles');
  if (nested.length) hint(nested[0].line, '嵌套子图在所属泳道内绘制', 'Nested subgraphs are drawn within their enclosing lane');
  const edges = [];
  for (const edge of flow.model.edges) {
    if (edge.fromFrame || edge.toFrame) fail(edge.line, '连线必须连接泳道节点', 'Edges must connect swimlane nodes');
    else edges.push({ ...edge, id: `e${edge.seq}` });
  }
  return { model: { mermaid: true, direction: ['LR', 'RL'].includes(flow.model.direction) ? 'LR' : 'TB',
    reverse: ['RL', 'BT'].includes(flow.model.direction), lanes, nodes, edges, nested }, errors };
}

function layout(model, options) {
  const geometry = laneLayout(model, options);
  if (!geometry.errors.length && (geometry.width > options.width * 2 || model.nodes.length > 60)) geometry.errors.push(warning('LARGE_DIAGRAM', options.lang,
    model.lanes[0]?.line, '泳道图较宽，可拆成多张图', 'Wide swimlane diagram; consider splitting it'));
  return geometry;
}

export const implementations = { 'swimlane-beta': { optionMode: 'raw', acceptsPresentation: true, parse, layout, scene } };
