import { fallbackMeasure } from '../../src/core/text.js';
import { pathLines } from './scene-path.mjs';

const nonRendered = new Set(['defs', 'marker', 'clipPath', 'title', 'desc', 'linearGradient']);
const identity = p => p;
const sub = ([x, y], [u, v]) => [x - u, y - v];
const dot = ([x, y], [u, v]) => x * u + y * v;
const cross = ([x, y], [u, v]) => x * v - y * u;
const length = ([x, y]) => Math.hypot(x, y);
const at = ([x, y], [u, v], t) => [x + (u - x) * t, y + (v - y) * t];
const number = (v, fallback = 0) => Number.parseFloat(v) || fallback;
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const bounds = ps => {
  const xs = ps.map(p => p[0]), ys = ps.map(p => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};
const segments = ps => ps.slice(1).map((p, i) => [ps[i], p]).filter(([a, b]) => length(sub(b, a)) > 1e-7);
const sidesOf = ps => segments([...ps, ps[0]]);
const spansOverlap = (a0, a1, b0, b1, gap) => Math.min(a1, b1) - Math.max(a0, b0) > gap;
const hit = (a, b, gap) => spansOverlap(a.x0, a.x1, b.x0, b.x1, gap) && spansOverlap(a.y0, a.y1, b.y0, b.y1, gap);

function overlaps(a, b) {
  // One pixel of overlap is below the reliability of Node's estimated text
  // advances and the rounded SVG bounds. Test oriented shapes, not just AABBs.
  return hit(a.box, b.box, 1) && [...sidesOf(a.polygon), ...sidesOf(b.polygon)].every(([p, q]) => {
    const [x, y] = sub(q, p), d = length([x, y]), axis = [-y / d, x / d];
    const u = a.polygon.map(r => dot(axis, r)), v = b.polygon.map(r => dot(axis, r));
    return spansOverlap(Math.min(...u), Math.max(...u), Math.min(...v), Math.max(...v), 1);
  });
}

function transform(value, parent) {
  const maps = [];
  for (const [, op, body] of String(value || '').matchAll(/(\w+)\(([^)]*)\)/g)) {
    const [a, b, c, d, e, f] = body.trim().split(/[\s,]+/).map(Number);
    if (op === 'translate') maps.push(([x, y]) => [x + a, y + (b ?? 0)]);
    else if (op === 'scale') maps.push(([x, y]) => [x * a, y * (b ?? a)]);
    else if (op === 'matrix') maps.push(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
    else if (op === 'rotate') {
      const t = a * Math.PI / 180, cx = b ?? 0, cy = c ?? 0;
      maps.push(([x, y]) => [cx + (x - cx) * Math.cos(t) - (y - cy) * Math.sin(t), cy + (x - cx) * Math.sin(t) + (y - cy) * Math.cos(t)]);
    } else throw new Error(`Unsupported scene transform: ${op}`);
  }
  return maps.length ? p => parent(maps.reduceRight((q, map) => map(q), p)) : parent;
}

const points = value => (String(value).match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) || [])
  .map(Number).reduce((ps, n, i) => { if (i % 2) ps.at(-1).push(n); else ps.push([n]); return ps; }, []);
const oval = (x, y, rx, ry, from, arc, steps) => Array.from({ length: steps + 1 }, (_, i) => {
  const t = from + i * arc / steps;
  return [x + rx * Math.cos(t), y + ry * Math.sin(t)];
});

function outline(node, map) {
  const { tag, attrs: a = {} } = node;
  let polygon, borders;
  if (tag === 'rect') {
    const x = number(a.x), y = number(a.y), w = number(a.width), h = number(a.height);
    if (w <= 0 || h <= 0) return;
    const rx = Math.min(w / 2, number(a.rx ?? a.ry)), ry = Math.min(h / 2, number(a.ry ?? a.rx));
    if (rx > 0 && ry > 0) {
      const corners = [[x + w - rx, y + ry], [x + w - rx, y + h - ry], [x + rx, y + h - ry], [x + rx, y + ry]]
        .map(([cx, cy], i) => oval(cx, cy, rx, ry, (i - 1) * Math.PI / 2, Math.PI / 2, 8));
      borders = corners.map((ps, i) => [ps.at(-1), corners[(i + 1) % 4][0]]);
      polygon = corners.flat();
    } else polygon = rect(x, y, w, h);
  } else if (tag === 'polygon') polygon = points(a.points);
  else if (tag === 'circle' || tag === 'ellipse') {
    polygon = oval(number(a.cx), number(a.cy), number(a.r ?? a.rx), number(a.r ?? a.ry), 0, 2 * Math.PI, 48);
    borders = [];
  } else if (tag === 'path') {
    // The path-backed node shapes emitted by KChart are convex cylinders.
    polygon = pathLines(a.d, identity)[0];
    borders = sidesOf(polygon || []).filter(([p, q]) => p[0] === q[0] || p[1] === q[1]);
  }
  if (!polygon || polygon.length < 3) return;
  return { polygon: polygon.map(map), borders: (borders || sidesOf(polygon)).map(pair => pair.map(map)) };
}

// Clip a segment to the inset convex outline. Using the actual outline avoids
// calling a line through the empty corners of diamonds/rounded cards a hit.
function inside([a, b], polygon, inset) {
  let lo = 0, hi = 1;
  const sides = sidesOf(polygon);
  const sign = Math.sign(sides.reduce((sum, [p, q]) => sum + cross(p, q), 0));
  if (!sign) return;
  for (const [p, q] of sides) {
    const v = sub(q, p), scale = sign / length(v);
    const x = cross(v, sub(a, p)) * scale - inset, y = cross(v, sub(b, p)) * scale - inset;
    if (x < 0 && y < 0) return;
    if (x < 0) lo = Math.max(lo, x / (x - y));
    if (y < 0) hi = Math.min(hi, x / (x - y));
    if (lo >= hi) return;
  }
  return [at(a, b, lo), at(a, b, hi)];
}

// Real routes have port rounding, 1–2px strokes and small curve chords. A
// 1px transverse allowance catches actual stroke contact (architecture.md:237
// slides 0.384px off the node boundary). Require >4px of sustained contact so
// normal port touches and brief grazing of rounded corners don't count.
function along([a, b], [p, q]) {
  const v = sub(b, a), span = length(v);
  if (span <= 4 || length(sub(q, p)) <= 4) return;
  const t = v.map(n => n / span);
  const [u0, u1] = [dot(t, sub(p, a)), dot(t, sub(q, a))].sort((x, y) => x - y);
  const lo = Math.max(0, u0), hi = Math.min(span, u1);
  if (hi - lo <= 4) return;
  const w = sub(q, p), dir = dot(t, w);
  if (Math.abs(cross(t, w)) > Math.abs(dir) * .1) return;
  for (const d of [lo, hi]) {
    if (Math.abs(cross(t, sub(at(p, q, (d - dot(t, sub(p, a))) / dir), a))) > 1) return;
  }
  return [at(a, b, lo / span), at(a, b, hi / span)];
}

// Mindmap/tree siblings deliberately share a trunk (bilateralPath, org, brace).
// Exempt only their directed common prefix, not subsequent coincident routes.
function sharedTrunk(a, b) {
  const shared = new Set();
  if (!a.tree || a.tree !== b.tree || a.from !== b.from || a.to === b.to) return shared;
  for (let i = 0, j = 0; i < a.segments.length && j < b.segments.length; i++, j++) {
    const [p, q] = a.segments[i], [u, v] = b.segments[j];
    if (length(sub(p, u)) > .01) break;
    if (along([p, q], [u, v])) shared.add(`${i}:${j}`);
    if (length(sub(q, v)) > .01) break;
  }
  return shared;
}

const edgeLabel = new Set(['edge-label', 'edge-description', 'cardinality', 'message-label']);
const fontKeys = ['font-size', 'font-weight', 'font-family', 'text-anchor', 'dominant-baseline', 'letter-spacing'];
const textOf = node => `${node.text ?? ''}${(node.children || []).filter(child => child.tag === 'tspan').map(textOf).join('')}`;

// Text is checked in every family. Structural checks require roles: an
// unmarked frame, lifeline, grid line or decoration isn't a node or route.
export function checkScene(scene, { measure = fallbackMeasure } = {}) {
  const issues = [], texts = [], nodes = [], edges = [], labels = [];
  const issue = (kind, items, coordinates) => issues.push({ kind, elements: items.map(item => item.id), coordinates });
  let ordinal = 0;
  function visit(node, parent, inherited, group) {
    const { tag, attrs: a = {}, meta: m = {} } = node;
    if (nonRendered.has(tag) || Number(a.opacity) === 0) return;
    const map = transform(a.transform, parent);
    const font = { ...inherited };
    for (const key of fontKeys) if (a[key] != null) font[key] = a[key];
    const index = ++ordinal, pair = m.from != null && `${m.from}→${m.to}`;
    const id = m.id ?? m.node ?? m.edge ?? a.id ?? (pair || `${tag}#${index}`);
    if (tag === 'g' && (['relation', 'edge-label-group'].includes(m.kind) || (!m.kind && m.label != null))) {
      group = { ...m, id: pair || m.label || id };
      const plate = node.children?.find(child => child.tag === 'rect');
      const plateOutline = plate && outline(plate, transform(plate.attrs?.transform, map));
      if (plateOutline) labels.push({ id: group.id, polygon: plateOutline.polygon, box: bounds(plateOutline.polygon) });
      group.hasPlate = Boolean(plateOutline);
    }
    const nodeKind = ['node', 'participant', 'capability'].includes(m.kind) ||
      (m.node != null && (m.shape || ['mindmap', 'tree'].includes(m.kind)) && m.from == null && !m.role);
    if (nodeKind) {
      const shape = tag === 'g' ? node.children?.find(child => ['rect', 'polygon', 'circle', 'ellipse', 'path'].includes(child.tag)) : node;
      const body = shape && outline(shape, shape === node ? map : transform(shape.attrs?.transform, map));
      if (body) nodes.push({ ...body, id: m.label ?? id, box: bounds(body.polygon) });
    }
    // Filled Sankey ribbons share boundaries and terminate flush against nodes;
    // their outlines are not routed edge centerlines. Their text still counts.
    const ribbon = m.kind === 'edge' && m.value != null && a.fill && a.fill !== 'none';
    if (!ribbon && ['path', 'line', 'polyline'].includes(tag) && (['edge', 'message'].includes(m.kind) || (!m.kind && m.edge != null) || m.from != null || group?.kind === 'relation')) {
      const lines = tag === 'path' ? pathLines(a.d, map) : [tag === 'line'
        ? [[number(a.x1), number(a.y1)], [number(a.x2), number(a.y2)]].map(map) : points(a.points).map(map)];
      const ps = lines.flat();
      if (ps.length) edges.push({ id: group?.kind === 'relation' ? group.id : id, from: m.from ?? m.source ?? group?.from, to: m.to ?? m.target ?? group?.to, box: bounds(ps), lines, segments: lines.flatMap(segments), tree: ['mindmap', 'tree'].includes(m.kind) ? m.kind : null, inferEndpoints: !m.kind && m.edge != null });
    }
    if (tag === 'text') {
      const text = textOf(node);
      if (!text.trim()) return;
      const size = number(font['font-size'], 12), weight = number(font['font-weight'], font['font-weight'] === 'bold' ? 700 : 400);
      const width = number(a.textLength, measure(text, size, weight, font['font-family']) + (text.length - 1) * number(font['letter-spacing']));
      const x = number(a.x) + number(a.dx) - (font['text-anchor'] === 'middle' ? width / 2 : font['text-anchor'] === 'end' ? width : 0);
      const y = number(a.y) + number(a.dy), baseline = font['dominant-baseline'];
      const top = y - size * (['middle', 'central'].includes(baseline) ? .5 : ['hanging', 'text-before-edge'].includes(baseline) ? 0 : .8);
      const full = bounds(rect(x, top, width, size).map(map));
      // KChart's 12px central labels and default-baseline ticks use different
      // alignment but the em box includes non-ink ascent/descent in both cases.
      // Use its middle 70% for collision, and the full em for canvas clipping.
      const polygon = rect(x, top + size * .15, width, size * .7).map(map);
      const item = { id: text, box: bounds(polygon), polygon };
      const scaled = size * length(sub(map([0, 1]), map([0, 0])));
      if (scaled < 12 - 1e-7) issue('small-text', [item], { ...full, size: scaled });
      // Match containText's half-pixel viewport allowance; do not suppress real clipping.
      if (full.x0 < -.5 || full.y0 < -.5 || full.x1 > scene.width + .5 || full.y1 > scene.height + .5) issue('text-outside', [item], full);
      texts.push(item);
      if (!group?.hasPlate && (group || edgeLabel.has(m.kind))) labels.push(item);
      return;
    }
    for (const child of node.children || []) visit(child, map, font, group);
  }
  for (const node of scene.children) visit(node, identity, {}, null);

  const compare = (items, kind) => {
    items.forEach((a, i) => {
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j];
        if (overlaps(a, b)) issue(kind, [a, b], [a.box, b.box]);
      }
    });
  };
  compare(texts, 'text-overlap');
  compare(labels, 'edge-label-overlap');
  for (const label of labels) for (const node of nodes) {
    if (overlaps(label, node)) issue('edge-label-node-overlap', [label, node], { label: label.box, node: node.box });
  }
  edges.forEach((edge, i) => {
    for (const node of nodes) {
      const { box: b } = node, { box: e } = edge;
      if (e.x1 < b.x0 - 1 || e.x0 > b.x1 + 1 || e.y1 < b.y0 - 1 || e.y0 > b.y1 + 1) continue;
      // Exclusively for swimlane (no endpoint IDs), infer attachment from the
      // path tips and actual outline, not merely any point close to the box.
      const tips = [edge.lines[0][0], edge.lines.at(-1).at(-1)];
      const attached = node.id === edge.from || node.id === edge.to || (edge.inferEndpoints &&
        tips.some(p => inside([p, p], node.polygon, -1)));
      if (!attached) {
        for (const segment of edge.segments) {
          const crossing = inside(segment, node.polygon, 1);
          if (crossing) { issue('edge-crosses-node', [edge, node], crossing); break; }
        }
      }
      border: for (const segment of edge.segments) for (const side of node.borders) {
        const slide = along(segment, side);
        if (slide) { issue('edge-along-border', [edge, node], slide); break border; }
      }
    }
    for (let j = i + 1; j < edges.length; j++) {
      const other = edges[j], a = edge.box, b = other.box;
      if (a.x1 < b.x0 - 1 || a.x0 > b.x1 + 1 || a.y1 < b.y0 - 1 || a.y0 > b.y1 + 1) continue;
      const trunk = sharedTrunk(edge, other);
      routes: for (const [i, s] of edge.segments.entries()) for (const [j, t] of other.segments.entries()) {
        const overlap = along(s, t);
        if (overlap && !trunk.has(`${i}:${j}`)) { issue('collinear-edges', [edge, other], overlap); break routes; }
      }
    }
  });
  return issues;
}
