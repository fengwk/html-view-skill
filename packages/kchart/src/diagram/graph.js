import { FONT, appearance } from './support.js';
import { parseGraph } from './graph-parse.js';
import { layoutGraph } from './graph-layout.js';
import { cubicPath } from '../core/geometry.js';
import { flowOutlineName, shapeOutline, shapeGlyphBox } from './shapes.js';

const path = (ctx, d, attrs = {}, meta) => ({ ...ctx.path(d, attrs), ...(meta ? { meta } : {}) });
const text = (ctx, x, y, value, opts, meta) => ctx.text(x, y, value, { 'dominant-baseline': 'central', ...opts, meta });
const group = (ctx, children, meta, attrs = {}) => ({ ...ctx.el('g', attrs, children), ...(meta ? { meta } : {}) });
const titleNode = (ctx, value) => value ? { ...ctx.el('title'), text: String(value) } : null;
const points = (coords) => coords.map(([x, y]) => `${x},${y}`).join(' ');

function defs(ctx, a) {
  const arrow = (id, color, d = 'M0 0 L8 4 L0 8 Z') => ({
    tag: 'marker', attrs: {
      id, viewBox: '0 0 8 8', refX: 8, refY: 4,
      markerWidth: 8, markerHeight: 8, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse',
    }, children: [ctx.path(d, { fill: color })],
  });
  // From the relationship line toward the entity: minimum first, then maximum.
  // The outer circle/bar and the inner crow’s foot must occupy separate parts of the 16px stub.
  const zero = ['circle', 4, 8, 3], minOne = ['line', 'M4 2 V14'];
  const maxOne = ['line', 'M12 2 V14'], many = ['line', 'M15 2 L9 8 L15 14 M9 8 H15'];
  const cardSpecs = {
    'zero-one': [zero, maxOne], 'exactly-one': [minOne, maxOne],
    'zero-many': [zero, many], 'one-many': [minOne, many],
  };
  const cards = Object.entries(cardSpecs).map(([name, shapes]) => ({
    tag: 'marker', attrs: {
      id: `graph-card-${name}`, viewBox: '0 0 16 16', refX: 16, refY: 8,
      markerWidth: 16, markerHeight: 16, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse',
    },
    children: shapes.map(([kind, ...args]) => kind === 'circle'
      ? ctx.circle(...args, { fill: a.surface, stroke: a.fg4, 'stroke-width': 1.4 })
      : ctx.path(args[0], { fill: 'none', stroke: a.fg4, 'stroke-width': 1.4 })),
  }));
  return ctx.el('defs', {}, [
    arrow('graph-arrow', a.fg4), arrow('graph-arrow-bold', a.fg3),
    arrow('graph-barb', a.fg4, 'M0 0 L8 4 L0 8 L2 4 Z'), ...cards,
    ...['circle', 'cross'].map(mark => ({
      tag: 'marker', attrs: {
        id: `graph-${mark}`, viewBox: '0 0 10 10', refX: 9, refY: 5,
        markerWidth: 10, markerHeight: 10, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse',
      }, children: [mark === 'circle'
        ? ctx.circle(5, 5, 3.375, { fill: a.surface, stroke: a.fg4, 'stroke-width': 1.25 })
        : ctx.path('M2 2 L8.5 8 M2 8 L8.5 2', { fill: 'none', stroke: a.fg4, 'stroke-width': 1.25 })],
    })),
  ]);
}

function cardKey(card) {
  return card === '|o' || card === 'o|' ? 'zero-one'
    : card === '||' ? 'exactly-one'
      : card === '}o' || card === 'o{' ? 'zero-many'
        : card === '}|' || card === '|{' ? 'one-many' : null;
}

function edgePath(edge, modelNodes, ctx, a) {
  if (!edge.segments?.length || edge.style === 'invisible') return null;
  const d = cubicPath(edge.segments);
  const isEr = modelNodes.get(edge.from)?.kind === 'er' || modelNodes.get(edge.to)?.kind === 'er';
  const bold = edge.style === 'bold';
  const attrs = {
    fill: 'none', stroke: bold ? a.fg3 : a.fg4, 'stroke-width': bold ? 2 : 1.25,
    ...(edge.style === 'dashed' || edge.animated ? { 'stroke-dasharray': '5 4' } : {}),
  };
  if (isEr) {
    const start = edge.startCard && cardKey(edge.startCard), end = edge.endCard && cardKey(edge.endCard);
    if (start) attrs['marker-start'] = `url(#graph-card-${start})`;
    if (end) attrs['marker-end'] = `url(#graph-card-${end})`;
  } else {
    for (const side of ['start', 'end']) {
      const mark = edge[`${side}Mark`] ?? (edge[`${side}Arrow`] ? 'point' : 'none');
      if (mark !== 'none') attrs[`marker-${side}`] = `url(#graph-${mark === 'point' ? `arrow${bold ? '-bold' : ''}` : mark})`;
    }
  }
  const tip = `${edge.from} → ${edge.to}${edge.label ? `：${edge.label}` : ''}`;
  return group(ctx, [titleNode(ctx, tip), path(ctx, d, attrs, { kind: 'edge', from: edge.from, to: edge.to })], { kind: 'edge-group' });
}

function drawFlowShape(ctx, name, { x, y, w, h, direction }, common, a) {
  const glyph = shapeGlyphBox(name, w, h, direction);
  const fill = ['fork', 'f-circ', 'anchor'].includes(name) ? a.fg3 : common.fill;
  const stroke = glyph && common.stroke === a.line2 ? a.fg4 : common.stroke;
  const outlineAttrs = name === 'text' || name === 'icon' || ['brace', 'brace-r', 'braces'].includes(name)
    ? { fill: 'none', stroke: 'none' } : { ...common, fill, stroke, ...(name === 'datastore' ? { 'stroke-dasharray': `${w} ${h}` } : {}) };
  const children = [ctx.shape('polygon', {
    points: points(shapeOutline(name, w, h, direction).map(([px, py]) => [x + px, y + py])), ...outlineAttrs,
  })];
  if (glyph) { x += glyph.x; y += glyph.y; ({ w, h } = glyph); }
  const at = (u, v) => `${x + w * u} ${y + h * v}`;
  const detail = (d) => children.push(path(ctx, d, { fill: 'none', stroke, 'stroke-width': 1.25 }));
  const line = (u, v, s, t) => `M${at(u, v)} L${at(s, t)}`;
  if (name === 'fr-rect') detail(line(.1,0,.1,1) + line(.9,0,.9,1));
  if (['win-pane', 'lin-rect', 'lin-doc'].includes(name)) detail(line(.11,0,.11,name === 'lin-doc' ? .95 : 1));
  if (['win-pane', 'div-rect', 'browser', 'console'].includes(name)) detail(line(0,.22,1,.22));
  if (name === 'browser') for (const dx of [10, 16, 22]) children.push(ctx.circle(x + dx, y + h * .11, 1.4, { fill: common.stroke }));
  if (name === 'console') detail(`M${at(.08,.06)} L${at(.13,.11)} L${at(.08,.16)} ${line(.15,.16,.21,.16)}`);
  if (['cyl', 'lin-cyl', 'bucket'].includes(name)) {
    detail(`M${at(0,.12)} A${w / 2} ${h * .12} 0 0 0 ${at(1,.12)}`);
    if (name === 'lin-cyl') detail(`M${at(0,.19)} A${w / 2} ${h * .12} 0 0 0 ${at(1,.19)}`);
  }
  if (name === 'h-cyl') detail(`M${at(.12,0)} A${w * .12} ${h / 2} 0 0 1 ${at(.12,1)}`);
  if (name === 'tag-rect' || name === 'tag-doc') detail(line(.75,0,1,.24) + line(.75,0,.75,.24) + line(.75,.24,1,.24));
  if (name === 'docs' || name === 'st-rect') {
    const bottom = (name === 'docs' ? .9 : 1) * (h - 10);
    for (const i of [1, 2]) {
      const d = i * 5, right = x + w - d;
      detail(`M${x + 10 - d} ${y + d} H${right} V${y + d + bottom}`);
    }
  }
  if (name === 'dbl-circ' || name === 'fr-circ') {
    children.push(ctx.circle(x + w / 2, y + h / 2, w / 2 - 5, { fill: name === 'fr-circ' ? a.fg4 : 'none', stroke: common.stroke }));
  }
  if (name === 'cross-circ') detail(line(.16,.16,.84,.84) + line(.84,.16,.16,.84));
  const brace = side => {
    // Keep the brace tips inside its logical text-and-brace bounds.
    const b = side ? .94 : .06, c = side ? .06 : -.06;
    detail(`M${at(b-c,.04)} Q${at(b,.04)} ${at(b,.25)} Q${at(b,.5)} ${at(b+c,.5)} Q${at(b,.5)} ${at(b,.75)} Q${at(b,.96)} ${at(b-c,.96)}`);
  };
  if (name === 'brace' || name === 'braces') brace(false);
  if (name === 'brace-r' || name === 'braces') brace(true);
  return children;
}

function drawShape(ctx, item, n, a) {
  const { x, y, w, h } = n;
  const node = item.node;
  const stroke = node.class === 'ext' ? a.line2 : node.class && a[node.class] ? a[node.class] : a.line2;
  const fill = node.class === 'ext' ? 'none' : node.class && a[node.class] ? ctx.mix(a.node, a[node.class], a.soft) : a.node;
  const common = { fill, stroke, 'stroke-width': 1.25, ...(node.class === 'ext' ? { 'stroke-dasharray': '4 3' } : {}) };
  const flowShape = item.flowchart && flowOutlineName(node.shape);
  if (flowShape) return drawFlowShape(ctx, flowShape, n, common, a);
  if (node.kind === 'note') return [ctx.rect(x, y, w, h, { ...common, fill: ctx.mix(a.node, a.warn, a.soft), rx: 3 })];
  if (node.kind === 'start') return [ctx.circle(x + w / 2, y + h / 2, Math.min(w, h) / 2, { fill: a.fg2, stroke: 'none' })];
  if (node.kind === 'end') return [
    ctx.circle(x + w / 2, y + h / 2, Math.min(w, h) / 2, { fill: a.node, stroke: a.fg2, 'stroke-width': 1.5 }),
    ctx.circle(x + w / 2, y + h / 2, Math.min(w, h) / 2 - 4, { fill: a.fg2, stroke: 'none' }),
  ];
  if (node.kind === 'choice' || node.shape === 'diamond') return [ctx.shape('polygon', { points: points([[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2],]), ...common })];
  if (node.kind === 'fork' || node.kind === 'join') return [ctx.rect(x, y, w, h, { ...common, fill: a.fg3, rx: 2 })];
  if (node.shape === 'circle') return [ctx.shape('ellipse', { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, ...common })];
  if (node.shape === 'hexagon') {
    const cut = 16;
    return [ctx.shape('polygon', { points: points([[x + cut, y], [x + w - cut, y], [x + w, y + h / 2], [x + w - cut, y + h], [x + cut, y + h], [x, y + h / 2]]), ...common })];
  }
  if (node.shape === 'stadium') return [ctx.rect(x, y, w, h, { ...common, rx: h / 2 })];
  if (node.shape === 'cylinder') {
    const ry = 6;
    return [
      path(ctx, `M${x} ${y + ry} C${x} ${y - ry * .2} ${x + w} ${y - ry * .2} ${x + w} ${y + ry} V${y + h - ry} C${x + w} ${y + h + ry * .2} ${x} ${y + h + ry * .2} ${x} ${y + h - ry} Z`, common),
      path(ctx, `M${x} ${y + ry} C${x} ${y + ry * 2} ${x + w} ${y + ry * 2} ${x + w} ${y + ry}`, common),
    ];
  }
  const rx = node.kind === 'state' ? 8 : node.shape === 'round' ? 11 : 3;
  const shape = ctx.rect(x, y, w, h, { ...common, rx });
  if (node.shape !== 'subroutine') return [shape];
  return [shape, path(ctx, `M${x + 9} ${y + 4} V${y + h - 4} M${x + w - 9} ${y + 4} V${y + h - 4}`, { fill: 'none', stroke, 'stroke-width': 1.25 })];
}

function drawNode(ctx, item, n, a) {
  const node = item.node, children = [titleNode(ctx, node.label || node.id), ...drawShape(ctx, item, n, a)];
  const nodeMeta = { kind: node.kind === 'collapsed' ? 'frame' : 'node', id: node.id, ...(node.class ? { status: node.class } : {}) };
  if (node.kind === 'start' || node.kind === 'end' || node.kind === 'choice' || node.kind === 'fork' || node.kind === 'join') return group(ctx, children, nodeMeta);
  if (node.kind === 'er' && n.er) {
    const er = n.er, pad = er.pad, ruleY = n.y + er.headerH;
    for (const [i, line] of er.headLines.entries()) children.push(text(ctx, n.x + n.w / 2, n.y + 7 + (i + .5) * 19, line, { anchor: 'middle', size: 14, weight: 600, fill: a.fg1 }, { kind: 'node-label', id: node.id }));
    children.push(path(ctx, `M${n.x + 1} ${ruleY} H${n.x + n.w - 1}`, { stroke: a.line2, 'stroke-width': 1 }));
    let rowY = ruleY + 2;
    for (const row of er.rows) {
      const rowChildren = [];
      if (row.comment) rowChildren.push(titleNode(ctx, `${row.name}${row.keys.length ? ` · ${row.keys.join(' ')}` : ''}：${row.comment}`));
      const cy = rowY + row.rowH / 2;
      row.typeLines.forEach((line, i) => rowChildren.push(text(ctx, n.x + pad, cy + (i - (row.typeLines.length - 1) / 2) * 17, line, { anchor: 'start', size: 13, fill: a.fg3 }, { kind: 'attribute-type', entity: node.id, attribute: row.name })));
      row.nameLines.forEach((line, i) => rowChildren.push(text(ctx, n.x + pad + er.typeW + 12, cy + (i - (row.nameLines.length - 1) / 2) * 17, line, { anchor: 'start', size: 13, fill: a.fg2 }, { kind: 'attribute', entity: node.id, attribute: row.name })));
      if (row.keyText) rowChildren.push(text(ctx, n.x + n.w - pad, cy, row.keyText, { anchor: 'end', size: 12, fill: a.fg3 }, { kind: 'attribute-key', entity: node.id, attribute: row.name }));
      children.push(group(ctx, rowChildren, { kind: 'attribute-row', entity: node.id, attribute: row.name }));
      rowY += row.rowH;
    }
    return group(ctx, children, nodeMeta);
  }
  const lines = item.titleLines || [], desc = item.descLines || [];
  const titleH = lines.length * 19, descH = desc.length * 17, gap = desc.length ? 7 : 0;
  const collapsed = node.kind === 'collapsed';
  const flowShape = item.flowchart && flowOutlineName(node.shape);
  const glyph = flowShape && shapeGlyphBox(flowShape, n.w, n.h, n.direction);
  const top = glyph ? n.y + glyph.y - titleH - 6 : n.y + Math.max(10, (n.h - titleH - gap - descH - (collapsed ? 20 : 0)) / 2);
  const textX = glyph ? n.x + glyph.x + glyph.w + 8 : n.x + n.w / 2;
  if (collapsed) {
    const y = n.y + n.h - 20;
    children.push(path(ctx, `M${n.x} ${y} H${n.x + n.w}`, { fill: 'none', stroke: a.line2, 'stroke-dasharray': '4 3' }));
    for (const dx of [-5, 0, 5]) children.push(ctx.circle(n.x + n.w / 2 + dx, y + 10, 1.25, { fill: a.fg4 }));
  }
  lines.forEach((line, i) => children.push(text(ctx, textX, top + i * 19 + 9.5, line, { anchor: glyph ? 'start' : 'middle', size: FONT.title.size, weight: node.kind === 'note' ? FONT.body.weight : FONT.title.weight, fill: a.fg1 }, { kind: 'node-label', id: node.id })));
  desc.forEach((line, i) => children.push(text(ctx, n.x + n.w / 2, top + titleH + gap + i * 17 + 8.5, line, { anchor: 'middle', size: FONT.body.size, fill: a.fg3 }, { kind: 'node-description', id: node.id })));
  return group(ctx, children, nodeMeta);
}

function scene(geometry, ctx, info = {}) {
  const a = appearance(ctx), model = geometry.model || {}, modelNodes = new Map((model.nodes || []).map(node => [node.id, node]));
  const framesLayer = [], edgeLayer = [], nodeLayer = [], edgeLabelLayer = [], titleLayer = [];
  for (const frame of geometry.frames || []) {
    const attrs = { fill: frame.kind === 'divider' ? a.node : a.surface, stroke: frame.class && a[frame.class] ? a[frame.class] : a.line2, 'stroke-width': 1, 'stroke-dasharray': '5 4' };
    const frameChildren = [ctx.rect(frame.x, frame.y, frame.w, frame.h, { ...attrs, rx: 6 })];
    framesLayer.push(group(ctx, frameChildren, { kind: 'frame', id: frame.id, ...(frame.class ? { status: frame.class } : {}) }));
    if (frame.lines?.length) {
      const rect = frame.titleRect;
      const titleChildren = [ctx.rect(rect.x - 3, rect.y - 3, rect.w + 6, rect.h + 6, { fill: a.surface, rx: 2 })];
      frame.lines.forEach((line, i) => titleChildren.push(text(ctx, rect.x, rect.y + (i + .5) * 17, line, { anchor: 'start', size: 13, weight: 600, fill: a.fg3 }, { kind: 'frame-title', id: frame.id })));
      (frame.descLines || []).forEach((line, i) => titleChildren.push(text(ctx, rect.x, rect.y + frame.lines.length * 17 + 4 + i * 16 + 8, line, { anchor: 'start', size: 13, fill: a.fg3 }, { kind: 'frame-description', id: frame.id })));
      titleLayer.push(group(ctx, titleChildren, { kind: 'frame-title-group', id: frame.id }));
    }
  }
  for (const edge of geometry.edges || []) {
    const rendered = edgePath(edge, modelNodes, ctx, a);
    if (rendered) edgeLayer.push(rendered);
    if (edge.labelRect && edge.labelLines?.length) {
      const r = edge.labelRect, children = [ctx.rect(r.x, r.y, r.w, r.h, { fill: a.surface, rx: 3 })];
      edge.labelLines.forEach((line, i) => children.push(text(ctx, r.x + r.w / 2, r.y + r.h / 2 + (i - (edge.labelLines.length - 1) / 2) * 16, line, { anchor: 'middle', size: 12, fill: a.fg3 }, { kind: 'edge-label' })));
      edgeLabelLayer.push(group(ctx, children, { kind: 'edge-label-group', from: edge.from, to: edge.to }));
    }
  }
  for (const n of geometry.nodes || []) {
    const item = modelNodes.get(n.id);
    if (item) nodeLayer.push(drawNode(ctx, { node: item, flowchart: model.type === 'flowchart', titleLines: n.lines, descLines: n.descLines }, n, a));
  }
  const children = [defs(ctx, a), ...framesLayer,
    group(ctx, edgeLayer, { kind: 'edges' }), group(ctx, nodeLayer, { kind: 'nodes' }),
    group(ctx, edgeLabelLayer, { kind: 'edge-labels' }), group(ctx, titleLayer, { kind: 'frame-titles' })];
  return { width: geometry.width, height: geometry.height, children, ...(info.title ? { title: info.title } : {}) };
}

const implementations = Object.fromEntries(['flowchart', 'stateDiagram-v2', 'erDiagram'].map(kind => [kind, {
  optionMode: 'raw',
  parse: (body, info) => parseGraph(body, info),
  layout: (model, options, info) => layoutGraph(model, options, info),
  scene,
}]));

export { implementations };
