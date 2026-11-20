import { resolveIconRef } from '../core/icons.js';
import { parseFlow } from './graph-parse.js';
import { layoutGraph } from './graph-layout.js';
import { implementations as graph } from './graph.js';
import { normalizeLabel } from './label.js';
import { presentation } from './presentation.js';
import { flowOutlineName } from './shapes.js';
import { ignoredConfigWarning, prepareSource } from './source.js';
import { DIRECTIONS, FONT, appearance, error, warning, wrapText } from './support.js';

const SHAPES = new Map(Object.entries({ task: 'rounded', tool: 'subroutine', input: 'lean-r',
  decision: 'diamond', refdoc: 'lin-doc', action: 'hexagon', connector: 'rect',
  roundedRect: 'rounded', roundedrect: 'rounded', collapsedGroup: 'rounded', collapsedgroup: 'rounded', round: 'rect' }));
const OUTLINES = new Set(['rounded', 'fr-rect', 'lean-r', 'diam', 'lin-doc', 'hex', 'rect']);
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const EDGE_KINDS = new Map([['solid:point', 'sequence'], ['dashed:none', 'reference'], ['solid:cross', 'failure']]);
const LIMITS = { nodes: 300, edges: 420, frames: 60, depth: 12, connectors: 60, lines: 2000, metadataKeys: 24, metadataString: 400 };
const valueText = value => typeof value === 'string' ? value : JSON.stringify(value);
const ICON_PLACEHOLDER = '\u25cc';

// Preserve source lines and keep delimiters inside labels and YAML out of the flow grammar.
function statements(source, firstLine) {
  const result = [];
  let text = '', line = firstLine, start = line, quote = '', pipe = false;
  let brackets = 0, yamlDepth = 0, yamlStart = 0, yamlLine = 0;
  let metadata = [], classes = [];
  const flush = () => {
    if (text.trim() || metadata.length) result.push({ text: text.trim(), line: start, metadata, classes });
    text = ''; metadata = []; classes = [];
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (!yamlDepth) text += ch;
      if (ch === '\\' && quote === '"' && source[i + 1] !== '\n' && i + 1 < source.length) {
        if (!yamlDepth) text += source[i + 1];
        i++;
      } else if (ch === quote) {
        if (yamlDepth && quote === "'" && source[i + 1] === "'") i++;
        else quote = '';
      }
    } else if (ch === '"' || (ch === "'" && !/[\w]/.test(source[i - 1] || ''))) {
      quote = ch;
      if (!yamlDepth) text += ch;
    } else if (yamlDepth) {
      if (ch === '#' && /\s/.test(source[i - 1] || '')) {
        const end = source.indexOf('\n', i);
        i = end < 0 ? source.length : end - 1;
      } else if (ch === '{') yamlDepth++;
      else if (ch === '}' && --yamlDepth === 0) {
        metadata.push({ prefix: text.trim(), raw: source.slice(yamlStart, i), line: yamlLine });
      }
    } else if (!brackets && !pipe && source.startsWith('@{', i)) {
      yamlDepth = 1; yamlStart = i + 2; yamlLine = line; i++;
    } else if (!brackets && !pipe && source.startsWith(':::', i)) {
      const cls = /^:::([\w]+(?:-[\w]+)*(?:,[\w]+(?:-[\w]+)*)*)/.exec(source.slice(i));
      if (cls) {
        classes.push({ prefix: text.trim(), names: cls[1].split(',') });
        i += cls[0].length - 1;
      } else text += ch;
    } else if (!brackets && !pipe && (ch === ';' || ch === '\n')) {
      flush(); start = line + Number(ch === '\n');
    } else {
      if (ch === '|' && !brackets) pipe = !pipe;
      if (!pipe) {
        if ('[({'.includes(ch) || (ch === '>' && /[^\s\-=]/.test(source[i - 1] ?? '') && /^[^\n]*\]/.test(source.slice(i + 1)))) brackets++;
        else if (']})'.includes(ch)) brackets = Math.max(0, brackets - 1);
      }
      text += ch;
    }
    if (ch === '\n') line++;
  }
  flush();
  return { statements: result, unclosed: yamlDepth ? yamlLine : null };
}

// Reuse the source YAML reader via its front-matter API. A sequence wrapper keeps
// metadata keys case-sensitive (source config itself merges keys case-insensitively).
function readMetadata(raw, lang) {
  const read = (wrapped, offset) => {
    const prepared = prepareSource(`---\nconfig:\n${wrapped}\n---\nagentflow-beta`, { syntax: 'native', lang });
    return { value: prepared.config.values?.[0], problem: prepared.errors[0], offset };
  };
  if (!raw.trim()) return { value: {} };
  if (!raw.includes('\n')) return read(`  values: [{${raw}}]`, 3);
  const rows = raw.split('\n');
  const indent = Math.min(...rows.filter(row => row.trim()).map(row => row.search(/\S/)));
  const block = rows.map(row => `      ${row.slice(indent).replace(/,([ \t]*(?:#.*)?)$/, '$1')}`).join('\n');
  return read(`  values:\n    -\n${block}`, 5);
}

function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !UNSAFE_KEYS.has(key)).map(([key, child]) => [key, clean(child)]));
  return value;
}

function parse(body, info) {
  const { lang, firstLine, headerLine } = info;
  const errors = [], warnings = new Map(), ignored = new Map();
  const fail = (line, zh, en) => errors.push(error(lang, line, zh, en, '检查 agentflow 语法', 'Check the agentflow syntax'));
  const warn = (code, line, zh, en) => {
    const item = warning(code, lang, line, zh, en), key = `${code}:${item.message}`;
    if (!warnings.has(key) || warnings.get(key).line > line) warnings.set(key, item);
  };
  const ignore = (key, line) => { if (!ignored.has(key)) ignored.set(key, line); };
  const look = presentation({ lang, classKeyword: 'class' });
  const nodes = new Map(), frames = new Map(), edges = [], connectors = new Set(), global = new Set();
  const attributes = [], stack = [];
  let seq = 0, direction = 'TB';
  const candidate = (value, line) => {
    const dir = value.toUpperCase();
    if (dir === 'TD') return 'TB';
    if (DIRECTIONS.includes(dir)) return dir;
    if (['BR', '<', '>', '^', 'V'].includes(dir)) ignore(`direction ${value}`, line);
    else fail(line, `无效的方向 ${value}`, `Invalid direction ${value}`);
    return null;
  };
  const normalized = (raw, line, type) => {
    const text = valueText(raw) ?? '';
    const result = normalizeLabel(type === 'markdown' && !text.startsWith('`') ? `\`${text}\`` : text, { lang, line });
    for (const item of result.diagnostics) {
      const key = `${item.code}:${item.message}`;
      if (!warnings.has(key) || warnings.get(key).line > item.line) warnings.set(key, item);
    }
    return result;
  };
  const [head, ...inline] = (info.params || '').split(';');
  if (head.trim()) direction = candidate(head.trim(), headerLine) || direction;
  const input = inline.length ? `${inline.join(';')}\n${body}` : body;
  if (body.split('\n').length > LIMITS.lines || input.length > 50_000) {
    fail(firstLine, `Agentflow 最多 ${LIMITS.lines} 行、50000 个字符，请拆分图表`, `Agentflow supports up to ${LIMITS.lines} lines and 50,000 characters; split the diagram`);
    return { model: null, errors };
  }
  const scanned = statements(input, inline.length ? headerLine : firstLine);
  if (scanned.unclosed) fail(scanned.unclosed, '元数据缺少结束括号', 'Unclosed metadata block');
  const frameIds = new Set(scanned.statements.map(st => /^flow\s+([^\s["']+)/i.exec(st.text)?.[1]).filter(Boolean));
  for (const st of scanned.statements) {
    let { text } = st;
    const { line } = st;
    if (look.accept(text, line)) continue;
    const inGlobal = stack.includes(null);
    const parent = inGlobal ? null : stack.at(-1)?.id ?? null;
    const flow = /^flow(?:\s+([\s\S]*))?$/i.exec(text);
    const connector = /^connector\s+([\s\S]+)$/i.exec(text);
    const dir = /^direction\s+(\S+)$/i.exec(text);
    let declared;
    if (flow) {
      const rest = flow[1] || '';
      const match = /^([^\s["']+)(?:\s*\[([\s\S]*)\]|\s+([\s\S]*))?$/.exec(rest);
      const id = match?.[1] ?? `flow-${line}-${seq}`;
      const label = (match?.[2] ?? match?.[3] ?? (rest || id)).replace(/^("|')([\s\S]*)\1$/, '$2');
      declared = { id, title: label, parent, line, seq: seq++, depth: stack.filter(Boolean).length + 1 };
      if (frames.has(id)) fail(line, `流程重复：${id}`, `Duplicate flow: ${id}`);
      else frames.set(id, declared);
      stack.push(declared);
      if (declared.depth > LIMITS.depth) fail(line, `流程最多嵌套 ${LIMITS.depth} 层，请拆分图表`, `Flow nesting is limited to ${LIMITS.depth} levels; split the diagram`);
    } else if (/^global$/i.test(text)) stack.push(null);
    else if (/^end$/i.test(text)) {
      if (stack.length) stack.pop();
      else fail(line, '多余的 end', 'Unexpected end');
    } else if (dir) direction = candidate(dir[1], line) || direction;
    else if (text) {
      if (connector) {
        text = connector[1].replace(/^(\S+)\s+(".*"|'.*')$/, '$1[$2]');
      }
      const parsed = parseFlow([{ text, line }], { direction });
      // The flowchart's aggregate limits are checked below using this family's budget.
      errors.push(...parsed.errors.filter(item => !/^(?:节点|连线) \d+ (?:个|条)，超过上限/.test(item.message)));
      const metadataOnly = !connector && st.metadata.length && parsed.model.edges.length === 0 &&
        parsed.model.nodes.length === 1 && parsed.model.nodes[0].id === text && st.classes.length === 0;
      for (const parsedNode of parsed.model.nodes) {
        const { id, label, shape, explicitLabel } = parsedNode;
        if (frameIds.has(id) || metadataOnly) continue;
        let node = nodes.get(id);
        if (!node) {
          node = { id, label: id, parent, seq: seq++, line, shape: 'rounded' };
          nodes.set(id, node);
        } else if (node.parent === null && parent !== null) node.parent = parent;
        if (inGlobal) global.add(id);
        if (explicitLabel) Object.assign(node, { label, explicitLabel, shape, labelLine: line });
        if (connector) { connectors.add(id); node.connector = true; declared = node; }
      }
      for (const edge of parsed.model.edges) {
        const semantic = !edge.startArrow && EDGE_KINDS.get(`${edge.style}:${edge.endMark}`);
        if (!semantic || edge.extra) fail(line, 'Agentflow 连线使用 -->、-.- 或 --x', 'Agentflow edges use -->, -.- or --x');
        edge.edgeSemantic = semantic;
        edge.seq = edges.length;
        edges.push(edge);
      }
      // Use the shared token parser to identify the node at an inline class boundary.
      for (const cls of st.classes) {
        const prefix = connector ? cls.prefix.replace(/^connector\s+/i, '') : cls.prefix;
        // The last occurrence can refer to a node already seen earlier in a chain.
        const target = lastNode(prefix, line);
        if (target) look.addClasses(target, cls.names, line);
      }
      for (const attr of st.metadata) {
        attr.id = declared?.id || (metadataOnly ? text : lastNode(attr.prefix, line));
        attr.parent = parent;
        if (inGlobal && attr.id) global.add(attr.id);
      }
    }
    for (const attr of st.metadata) attributes.push({ ...attr, id: declared?.id ?? attr.id });
  }
  if (stack.length) fail(scanned.statements.at(-1)?.line ?? firstLine, '流程块缺少 end', 'Unclosed flow or global block');

  const edgeIds = new Map(edges.filter(edge => edge.id).map(edge => [edge.id, edge]));
  for (const attr of attributes) {
    if (!attr.id) { fail(attr.line, '元数据缺少目标', 'Metadata requires a target'); continue; }
    const { value, problem, offset } = readMetadata(attr.raw, lang);
    if (problem || value == null || typeof value !== 'object' || Array.isArray(value)) {
      fail(attr.line + Math.max(0, (problem?.line ?? offset) - offset), '无效的元数据 YAML', 'Invalid metadata YAML');
      continue;
    }
    const data = clean(value);
    let target = frames.get(attr.id) ?? edgeIds.get(attr.id) ?? nodes.get(attr.id);
    if (!target) {
      target = { id: attr.id, label: attr.id, parent: attr.parent ?? null, seq: seq++, line: attr.line, shape: 'rounded' };
      nodes.set(attr.id, target);
    }
    if (nodes.get(attr.id) === target && attr.line < target.line && attr.parent != null) target.parent = attr.parent;
    target.metadata = { ...target.metadata, ...data };
    target.metadataLine ??= attr.line;
  }
  const applyMetadata = item => {
    const data = item.metadata;
    if (!data) return;
    const at = item.metadataLine;
    let longString = false;
    JSON.stringify(data, (_, value) => {
      if (typeof value === 'string' && value.length > LIMITS.metadataString) longString = true;
      return value;
    });
    if (longString) fail(at, '元数据文字过长', 'Metadata string is too long');
    if (Object.keys(data).length > LIMITS.metadataKeys) fail(at, '元数据过多', 'Too many metadata keys');
    for (const key of ['algorithm', 'curve', 'animate', 'animation']) if (key in data) ignore(key, at);
  };
  for (const frame of frames.values()) {
    applyMetadata(frame);
    const data = frame.metadata ?? {};
    if (data.view === 'collapsed') frame.view = data.view;
    else if (data.view != null && data.view !== 'expanded') ignore('view', frame.metadataLine);
    const label = normalized(data.label ?? frame.title, data.label == null ? frame.line : frame.metadataLine, data.labelType);
    frame.title = label.text;
    frame.icon = label.icon;
    frame.class = look.statusOf(frame.id);
    frame.link = look.linkOf(frame.id);
  }
  for (const node of nodes.values()) {
    applyMetadata(node);
    const data = node.metadata ?? {};
    const authored = data.shape ?? node.shape;
    node.shapeAlias = data.shape ?? null;
    const shape = SHAPES.get(authored) ?? (authored === 'lean_right' ? 'lean-r' : authored);
    if (OUTLINES.has(flowOutlineName(shape))) node.shape = shape;
    else {
      node.shape = 'rounded';
      warn('DIAGRAM_HINT', data.shape == null ? node.labelLine : node.metadataLine,
        `形状 ${valueText(authored)} 改用 task`, `Shape ${valueText(authored)} drawn as task`);
    }
    node.global = global.has(node.id);
    if (node.global) node.parent = null;
    const label = normalized(data.label ?? node.label, data.label == null ? node.labelLine ?? node.line : node.metadataLine, data.labelType);
    node.label = label.text;
    const icon = resolveIconRef(data.icon);
    if (data.icon != null && !icon) warn('IGNORED_ASSET', node.metadataLine, `未知图标 ${valueText(data.icon)}`, `Unknown icon ${valueText(data.icon)}`);
    if ('img' in data) warn('IGNORED_ASSET', node.metadataLine, '忽略远程图片', 'Ignored remote image');
    node.icon = icon || label.icon || (node.connector || authored === 'connector' ? resolveIconRef('plug') : null);
    node.class = look.statusOf(node.id);
    node.link = look.linkOf(node.id);
  }
  for (const edge of edges) {
    applyMetadata(edge);
    edge.fromFrame = frames.has(edge.from);
    edge.toFrame = frames.has(edge.to);
    if (edge.label != null || edge.metadata?.label != null) {
      const label = normalized(edge.metadata?.label ?? edge.label, edge.metadata?.label == null ? edge.line : edge.metadataLine, edge.metadata?.labelType);
      edge.label = label.text;
      edge.icon = label.icon;
    }
    edge.status = look.edgeStatusOf(edge.seq);
  }
  for (const [size, key] of [[nodes.size, 'nodes'], [edges.length, 'edges'], [frames.size, 'frames'], [connectors.size, 'connectors']]) {
    if (size > LIMITS[key]) fail(firstLine, `${key} 超过上限 ${LIMITS[key]}，请拆分图表`, `Too many ${key} (limit ${LIMITS[key]}); split the diagram`);
  }
  if (ignored.size) errors.push(ignoredConfigWarning(lang, Math.min(...ignored.values()), [...ignored.keys()].join(', ')));
  const model = { type: 'flowchart', variant: 'agentflow', direction, nodes: [...nodes.values()], edges,
    subgraphs: [...frames.values()], connectors: [...connectors].map(id => nodes.get(id)) };
  return { model, errors: [...errors, ...warnings.values(), ...look.diagnostics()] };
}

function lastNode(prefix, line) {
  const result = parseFlow([{ text: prefix.trim(), line }]).model;
  return result.edges.at(-1)?.to ?? result.nodes.at(-1)?.id;
}

function layout(model, options, info) {
  const byId = new Map(model.subgraphs.map(frame => [frame.id, frame]));
  const counts = new Map();
  for (const node of model.nodes) for (let parent = node.parent; parent; parent = byId.get(parent)?.parent) {
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  const en = /^en\b/i.test(info.lang);
  const config = Object.entries(info.config ?? {}).find(([key]) => key.toLowerCase() === 'agentflow')?.[1];
  const wrap = Object.entries(config ?? {}).find(([key]) => key.toLowerCase() === 'wrappingwidth')?.[1];
  const wrappingWidth = typeof wrap === 'number' && wrap > 0 ? Math.max(68, Math.min(200, wrap)) : 120;
  const nodes = model.nodes.map(node => {
    const { params, returns } = node.metadata ?? {};
    const value = [params, returns].filter(value => value != null).map(valueText).join(' → ');
    const desc = value && options.measure(value, FONT.body) <= wrappingWidth ? [value] : undefined;
    const label = wrap == null ? node.label : wrapText(node.label, wrappingWidth, FONT.title, options.measure).join('\n');
    return { ...node, label, desc };
  });
  const subgraphs = model.subgraphs.map(frame => {
    if (frame.view !== 'collapsed') return frame.icon && !frame.title ? { ...frame, title: ICON_PLACEHOLDER, iconOnly: true } : frame;
    const count = counts.get(frame.id) ?? 0;
    return { ...frame, desc: [en ? `${count} ${count === 1 ? 'node' : 'nodes'}` : `${count} 个节点`] };
  });
  const edges = model.edges.map(edge => edge.icon && !edge.label ? { ...edge, label: ICON_PLACEHOLDER, iconOnly: true } : edge);
  const edgeIcons = edges.some(edge => edge.icon), frameIcons = subgraphs.some(frame => frame.icon);
  const graphOptions = { ...options, measure: (value, font) => {
    const measured = options.measure(value, font);
    if (font === FONT.title) return Math.max(68, measured + 22); // 96px minimum; room for an inline icon.
    if ((edgeIcons && font === FONT.label) || (frameIcons && font.size === 13 && font.weight === 600)) return measured + 20;
    return measured;
  } };
  return layoutGraph({ ...model, nodes, subgraphs, edges }, graphOptions, info);
}

function drawIcon(ctx, icon, x, y, color) {
  const [left, top, w, h] = icon.viewBox.split(/\s+/).map(Number), scale = 14 / Math.max(w, h);
  return ctx.el('g', { transform: `translate(${x - (left + w / 2) * scale} ${y - (top + h / 2) * scale}) scale(${scale})` },
    icon.elements.map(({ tag, attrs }) => ctx.shape(tag, { ...attrs,
      ...(icon.set === 'simple' ? { fill: color } : { fill: 'none', stroke: color, 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }) })));
}

function placeIcon(ctx, group, lines, item, color) {
  const first = lines[0];
  if (!first) return;
  const a = first.attrs, centered = a['text-anchor'] === 'middle';
  const x = Number(a.x), y = Number(a.y);
  const half = centered ? ctx.measure(first.text, a['font-size'], a['font-weight']) / 2 : 0;
  if (item.iconOnly) first.text = '';
  else for (const line of lines) line.attrs.x = Number(line.attrs.x) + (centered ? 10 : 20);
  group.children.push(drawIcon(ctx, item.icon, item.iconOnly ? x + (centered ? 0 : 8) : x + (centered ? -half - 2 : 8), y, color));
}

function tooltip(item) {
  return [item.iconOnly ? null : item.label ?? item.title, ...Object.entries(item.metadata ?? {}).map(([key, value]) =>
    `${key}: ${valueText(value)}`)].filter(Boolean).join('\n');
}

function scene(geometry, ctx, info) {
  const scene = graph.flowchart.scene(geometry, ctx, info), a = appearance(ctx);
  const nodes = new Map(geometry.model.nodes.map(item => [item.id, item]));
  const frames = new Map(geometry.model.subgraphs.map(item => [item.id, item]));
  const bounds = new Map(geometry.nodes.map(item => [item.id, item]));
  const edgeLayer = scene.children.find(item => item.meta?.kind === 'edges');
  const labelsLayer = scene.children.find(item => item.meta?.kind === 'edge-labels');
  const defs = scene.children.find(item => item.tag === 'defs');
  const edgeModels = new Map(geometry.model.edges.map(edge => [edge.seq, edge]));
  let index = 0, labelIndex = 0;
  for (const route of geometry.edges) {
    if (!route.segments?.length) continue;
    const edge = edgeModels.get(route.id);
    const group = edgeLayer.children[index++], path = group.children.find(item => item.tag === 'path');
    const failure = edge.edgeSemantic === 'failure';
    const color = failure ? a.danger : a[edge.status] || a.fg4;
    path.attrs.stroke = color;
    if (edge.edgeSemantic === 'reference') path.attrs['stroke-dasharray'] = '4 4';
    if (failure || (edge.edgeSemantic === 'sequence' && edge.status)) {
      const id = `agentflow-marker-${failure ? 'failure' : edge.status}`;
      if (!defs.children.some(item => item.attrs.id === id)) defs.children.push(ctx.el('marker', {
        id, viewBox: failure ? '0 0 18 10' : '0 0 8 8', refX: failure ? 18 : 8, refY: failure ? 5 : 4,
        markerWidth: failure ? 18 : 8, markerHeight: failure ? 10 : 8, markerUnits: 'userSpaceOnUse', orient: 'auto',
      }, failure ? [ctx.path('M0 1 L8 5 L0 9 Z', { fill: color }), ctx.path('M10 1 L17 9 M10 9 L17 1', { fill: 'none', stroke: color, 'stroke-width': 1.5 })]
        : [ctx.path('M0 0 L8 4 L0 8 Z', { fill: color })]));
      path.attrs['marker-end'] = `url(#${id})`;
    }
    if (edge.iconOnly) group.children[0].text = `${route.from} → ${route.to}`;
    if (edge.metadata) group.children[0].text += `\n${tooltip(edge)}`;
    if (route.labelRect && route.labelLines?.length) {
      const label = labelsLayer.children[labelIndex++];
      const lines = label.children.filter(item => item.tag === 'text');
      if (failure || edge.status) for (const item of lines) item.attrs.fill = color;
      if (edge.icon) placeIcon(ctx, label, lines, edge, color);
    }
  }
  const decorateNode = group => {
    const node = nodes.get(group.meta?.id), box = bounds.get(node?.id);
    if (!node || !box) return group;
    if (node.metadata && group.children[0]?.tag === 'title') group.children[0].text = tooltip(node);
    const title = group.children.filter(item => item.meta?.kind === 'node-label');
    for (const label of title) {
      label.attrs['font-size'] = 13;
      label.attrs['font-weight'] = 400;
    }
    const outline = group.children.find(item => ['rect', 'polygon'].includes(item.tag));
    if (outline && !node.class) outline.attrs.stroke = ctx.tint(a.node, a.frameInk || a.fg3, .32);
    if (node.icon) {
      if (title.length) placeIcon(ctx, group, title, node, a.fg3);
      else group.children.push(drawIcon(ctx, node.icon, box.x + box.w / 2, box.y + box.h / 2, a.fg3));
    }
    return node.link ? ctx.link(node.link.href, [group], node.link) : group;
  };
  const nodeLayer = scene.children.find(item => item.meta?.kind === 'nodes');
  if (nodeLayer.children) nodeLayer.children = nodeLayer.children.map(decorateNode);
  scene.children = scene.children.map(item => {
    if (item.meta?.kind !== 'frame') return item;
    const frame = frames.get(item.meta.id);
    if (frame?.metadata) item.children.push({ ...ctx.el('title'), text: tooltip(frame) });
    const outline = item.children[0];
    outline.attrs.stroke = frame?.class ? a[frame.class] : a.frameInk || ctx.tint(a.surface, a.fg3, .30);
    return item;
  });
  const frameTitles = scene.children.find(item => item.meta?.kind === 'frame-titles');
  if (frameTitles.children) frameTitles.children = frameTitles.children.map(item => {
    const frame = frames.get(item.meta.id);
    if (frame?.icon) placeIcon(ctx, item, item.children.filter(part => part.meta?.kind === 'frame-title'), frame, a.fg3);
    const link = frame?.link;
    return link ? ctx.link(link.href, [item], link) : item;
  });
  return scene;
}

export const implementations = { 'agentflow-beta': {
  optionMode: 'raw', acceptsPresentation: true, honoredConfig: ['agentflow.wrappingWidth'], parse, layout, scene,
} };
