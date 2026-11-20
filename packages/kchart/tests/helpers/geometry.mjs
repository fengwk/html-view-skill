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
function clip([a, b], polygon, inset) {
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
  return [lo, hi];
}

function inside(segment, polygon, inset) {
  return clip(segment, polygon, inset)?.map(t => at(...segment, t));
}

// Real routes have port rounding, 1–2px strokes and small curve chords. A
// 1px transverse allowance catches actual stroke contact (architecture.md:237
// slides 0.384px off the node boundary). Require >4px of sustained contact so
// normal port touches and brief grazing of rounded corners don't count.
function along([a, b], [p, q], clearance = 1, minimum = 4) {
  const v = sub(b, a), span = length(v);
  if (span <= minimum || length(sub(q, p)) <= minimum) return;
  const t = v.map(n => n / span);
  const [u0, u1] = [dot(t, sub(p, a)), dot(t, sub(q, a))].sort((x, y) => x - y);
  const lo = Math.max(0, u0), hi = Math.min(span, u1);
  if (hi - lo <= minimum) return;
  const w = sub(q, p), dir = dot(t, w);
  if (Math.abs(cross(t, w)) > Math.abs(dir) * .1) return;
  for (const d of [lo, hi]) {
    if (Math.abs(cross(t, sub(at(p, q, (d - dot(t, sub(p, a))) / dir), a))) > clearance) return;
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

// Unlike node outlines, a UML package frame has a concave corner below its tab.
function frameSide(p, sides) {
  let enclosed = false;
  for (const [a, b] of sides) {
    const v = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), v) / dot(v, v)));
    // Ignore the 1px band around rounded/stroked borders: touching a port
    // or skimming a corner isn't entering the frame.
    if (length(sub(p, at(a, b, t))) <= 1) return 0;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < at(a, b, (p[1] - a[1]) / v[1])[0]) enclosed = !enclosed;
  }
  return enclosed ? 1 : -1;
}

function frameCrossing(line, sides) {
  let previous = 0, border;
  for (const [a, b] of segments(line)) {
    const v = sub(b, a), cuts = [0, 1];
    for (const [p, q] of sides) {
      const w = sub(q, p), d = cross(v, w);
      if (Math.abs(d) < 1e-7) continue;
      const t = cross(sub(p, a), w) / d, u = cross(sub(p, a), v) / d;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) cuts.push(t);
    }
    cuts.sort((x, y) => x - y);
    for (let i = 1; i < cuts.length; i++) {
      const p = at(a, b, (cuts[i - 1] + cuts[i]) / 2), side = frameSide(p, sides);
      if (side && previous && side !== previous) return border ?? a;
      if (side) { previous = side; border = undefined; }
      if (i < cuts.length - 1) border = at(a, b, cuts[i]);
    }
  }
}

// The core of the measured ink box avoids advance/ascent rounding and the
// empty outskirts of glyphs. Require >3px of continuous visible stroke: a
// corner graze is not overprint, but Wardley's Auth Service leader still is.
function textCrossing(edge, text, covers) {
  for (const line of edge.lines) {
    let start, end, span = 0;
    for (const segment of segments(line)) {
      const interval = clip(segment, text.polygon, 1.5);
      if (!interval) { start = end = undefined; span = 0; continue; }
      let visible = [interval];
      for (const cover of covers) {
        const hidden = clip(segment, cover.polygon, 0);
        if (!hidden) continue;
        visible = visible.flatMap(([a, b]) => hidden[1] <= a || hidden[0] >= b ? [[a, b]] : [
          ...(a < hidden[0] ? [[a, hidden[0]]] : []), ...(b > hidden[1] ? [[hidden[1], b]] : []),
        ]);
      }
      if (!visible.length) { start = end = undefined; span = 0; }
      for (const [a, b] of visible) {
        const p = at(...segment, a), q = at(...segment, b);
        if (!end || length(sub(p, end)) > 1e-7) { start = p; span = 0; }
        end = q;
        span += length(sub(q, p));
        if (span > 3) return [start, end];
      }
    }
  }
}

// Flowchart.md:117 leaves only 0.75px of ink-to-ink whitespace between
// routes 2px apart for 29px. Use 4px over >8px to also catch the crowded
// 12px approach in C4. The same flowchart's node clearance is 5.9236px
// over 18px: allow up to 6px, but require >12px to ignore short corners.
const edgeClearance = 4, nodeClearance = 6;
// At 2px the solid route and dashed frame in flowchart.md:1040 have
// subpixel ink clearance; classDiagram.md:421 actually overprints.
// Reviewed 4–6px frame offsets are visibly separate. Keep the >12px
// sustained-run floor and allow numerical noise at exactly 2px.
const frameClearance = 2 + 1e-7;

function portFan(a, i, b, j, run) {
  // Allow only a short run on the port-adjacent segments, not a later
  // rejoin or an incoming/outgoing pair. GitGraph's shared departure is
  // 24.3px; C4 uses nominally the same port with a 3.28px tip offset.
  for (const [end, index, tip] of [['from', 0, 0], ['to', -1, 1]]) {
    if (a[end] == null || a[end] !== b[end]) continue;
    if (i !== (index === 0 ? 0 : a.segments.length - 1) || j !== (index === 0 ? 0 : b.segments.length - 1)) continue;
    const p = a.segments.at(index)[tip], q = b.segments.at(index)[tip];
    if (length(sub(p, q)) <= edgeClearance && run.every(r => length(sub(r, p)) <= 26 && length(sub(r, q)) <= 26)) return true;
  }
  return false;
}
const nearBoxes = (a, b, gap) => a.x1 >= b.x0 - gap && a.x0 <= b.x1 + gap && a.y1 >= b.y0 - gap && a.y0 <= b.y1 + gap;
const shapeTags = ['rect', 'polygon', 'circle', 'ellipse', 'path'];
const near = (a, b) => a.x1 >= b.x0 && a.x0 <= b.x1 && a.y1 >= b.y0 && a.y0 <= b.y1;
const center = ({ x0, x1, y0, y1 }) => [(x0 + x1) / 2, (y0 + y1) / 2];
const within = ([x, y], { x0, x1, y0, y1 }) => x0 <= x && x <= x1 && y0 <= y && y <= y1;
const edgeLabel = new Set(['edge-label', 'edge-description', 'cardinality', 'message-label']);
const fontKeys = ['font-size', 'font-weight', 'font-family', 'text-anchor', 'dominant-baseline', 'letter-spacing'];
const textOf = node => `${node.text ?? ''}${(node.children || []).filter(child => child.tag === 'tspan').map(textOf).join('')}`;

// Text is checked in every family. Structural checks require roles: an
// unmarked frame, lifeline, grid line or decoration isn't a node or route.
export function checkScene(scene, { measure = fallbackMeasure, source } = {}) {
  const issues = [], texts = [], nodes = [], edges = [], labels = [], frames = [], leaders = [], covers = [];
  const issue = (kind, items, coordinates) => issues.push({ kind, elements: items.map(item => item.id), coordinates });
  const authored = source?.replace(/\s+/g, ' ');
  let ordinal = 0;
  function visit(node, parent, inherited, group, opaque, rows) {
    const { tag, attrs: a = {}, meta: m = {} } = node;
    if (nonRendered.has(tag) || Number(a.opacity) === 0) return;
    const map = transform(a.transform, parent);
    const font = { ...inherited };
    for (const key of fontKeys) if (a[key] != null) font[key] = a[key];
    const index = ++ordinal, pair = m.from != null && `${m.from}→${m.to}`;
    const id = m.id ?? m.node ?? m.edge ?? a.id ?? (pair || `${tag}#${index}`);
    if (tag === 'g' && (['relation', 'edge-label-group'].includes(m.kind) || (!m.kind && m.label != null))) {
      group = { ...m, index, id: pair || m.label || id };
      const plate = node.children?.find(child => child.tag === 'rect');
      const plateOutline = plate && outline(plate, transform(plate.attrs?.transform, map));
      if (plateOutline) labels.push({ id: group.id, polygon: plateOutline.polygon, box: bounds(plateOutline.polygon) });
      group.hasPlate = Boolean(plateOutline);
    }
    const nodeKind = ['node', 'participant', 'capability'].includes(m.kind) ||
      (m.node != null && (m.shape || ['mindmap', 'tree'].includes(m.kind)) && m.from == null && !m.role);
    const frameKind = ['frame', 'container', 'group'].includes(m.kind) || m.lane != null || (m.kind === 'layers' && m.role === 'group');
    if (nodeKind || frameKind) {
      const shape = tag === 'g' ? node.children?.find(child => shapeTags.includes(child.tag)) : node;
      const body = shape && outline(shape, shape === node ? map : transform(shape.attrs?.transform, map));
      if (body && nodeKind) nodes.push({ ...body, id: m.label ?? id, endpointId: id, box: bounds(body.polygon) });
      if (body && frameKind && !(shape !== node && shape.meta?.kind === 'frame')) {
        frames.push({ id: m.group ?? m.name ?? m.lane ?? id, lane: m.lane != null,
          sides: sidesOf(body.polygon), borders: shape.attrs?.stroke === 'none' ? [] : body.borders, box: bounds(body.polygon) });
      }
    }
    opaque = opaque && Number(a.opacity ?? 1) === 1 && !a['clip-path'] && !a.mask;
    // KChart uses solid hex fills for its node cards and label plates. Respect
    // paint order: an earlier card can't hide a route drawn over its label.
    if (opaque && ['rect', 'polygon', 'circle', 'ellipse'].includes(tag) && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(a.fill) && Number(a['fill-opacity'] ?? 1) === 1) {
      const body = outline(node, map);
      if (body) covers.push({ index, polygon: body.polygon, box: bounds(body.polygon) });
    }
    // Filled Sankey ribbons share boundaries and terminate flush against nodes;
    // their outlines are not routed edge centerlines. Their text still counts.
    const ribbon = m.kind === 'edge' && m.value != null && a.fill && a.fill !== 'none';
    // Wardley leaders predate metadata. Their unclassed 1px 2/3 dash is
    // distinct from map guides and the chart waterfall's classed connectors.
    const leader = m.kind === 'leader' || (tag === 'line' && !m.kind && !a.class && a['stroke-dasharray'] === '2 3' && Number(a['stroke-width']) === 1);
    if (!ribbon && ['path', 'line', 'polyline'].includes(tag) && (leader || ['edge', 'message'].includes(m.kind) || (!m.kind && m.edge != null) || m.from != null || group?.kind === 'relation')) {
      const lines = tag === 'path' ? pathLines(a.d, map) : [tag === 'line'
        ? [[number(a.x1), number(a.y1)], [number(a.x2), number(a.y2)]].map(map) : points(a.points).map(map)];
      const ps = lines.flat();
      if (ps.length) (leader ? leaders : edges).push({
        id: group?.kind === 'relation' ? group.id : id, key: m.edge ?? m.id, group: group?.index,
        from: m.from ?? m.source ?? group?.from, to: m.to ?? m.target ?? group?.to,
        kind: m.kind, clip: a['clip-path'], marker: a['marker-end'], index,
        box: bounds(ps), lines, segments: lines.flatMap(segments),
        tree: ['mindmap', 'tree'].includes(m.kind) ? m.kind : null, inferEndpoints: !m.kind && m.edge != null,
      });
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
      const owner = group || (edgeLabel.has(m.kind) ? m : null);
      const item = { id: text, box: bounds(polygon), polygon, owner, kind: m.kind, index };
      const scaled = size * length(sub(map([0, 1]), map([0, 0])));
      if (scaled < 12 - 1e-7) issue('small-text', [item], { ...full, size: scaled });
      // Match containText's half-pixel viewport allowance; do not suppress real clipping.
      if (full.x0 < -.5 || full.y0 < -.5 || full.x1 > scene.width + .5 || full.y1 > scene.height + .5) issue('text-outside', [item], full);
      if (authored) {
        const ax = number(a.x) + number(a.dx), anchor = map([ax, y]);
        const style = JSON.stringify([fontKeys.map(key => font[key]), a.fill, m.kind]);
        const prev = rows.last, value = text.trim().replace(/\s+/g, ' ');
        // KChart's row primitives share a parent and start/anchor, with a
        // baseline step near one em (e.g. ER/class: 17px at 13px).
        if (prev && prev.index + 1 === index && prev.style === style &&
          Math.abs(anchor[0] - prev.anchor[0]) < .01 && y - prev.y >= .85 * size && y - prev.y <= 1.8 * size &&
          /[a-z0-9]$/i.test(prev.value) && /^[a-z0-9]/i.test(value) &&
          authored.includes(prev.value + value) && !authored.includes(`${prev.value} ${value}`)) {
          // Scene width is not a hard limit: the host can scroll a widened
          // scene. No exception unless the scene contract exposes a hard cap.
          issue('split-word', [prev.item, item], [prev.anchor, anchor]);
        }
        rows.last = { index, style, anchor, y, value, item };
      }
      texts.push(item);
      if (!group?.hasPlate && (group || edgeLabel.has(m.kind))) labels.push(item);
      return;
    }
    const childTexts = {};
    for (const child of node.children || []) visit(child, map, font, group, opaque, childTexts);
  }
  const rootTexts = {};
  for (const node of scene.children) visit(node, identity, {}, null, true, rootTexts);

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
  for (const edge of [...edges, ...leaders]) for (const text of texts) {
    if (!near(edge.box, text.box)) continue;
    const { owner } = text;
    if (owner && ((owner.index != null && owner.index === edge.group) ||
      ((owner.edge ?? owner.label) != null ? (owner.edge ?? owner.label) === edge.key :
        owner.from != null && owner.from === edge.from && owner.to === edge.to))) continue;
    // Relations explicitly cut group titles out of the route with an SVG clip.
    if (text.kind === 'group-label' && edge.clip?.includes('#group-titles')) continue;
    const masks = covers.filter(cover => cover.index > edge.index && cover.index < text.index && near(cover.box, text.box));
    const crossing = textCrossing(edge, text, masks);
    if (crossing) issue('edge-crosses-text', [edge, text], crossing);
  }
  edges.forEach((edge, i) => {
    const tips = [edge.lines[0][0], edge.lines.at(-1).at(-1)];
    const endpoints = [edge.from, edge.to].map((id, i) => {
      const node = nodes.find(node => node.endpointId === id || node.id === id);
      return node ? center(node.box) : tips[i];
    });
    const isLane = frame => frame.lane || (edge.marker === 'url(#em-arrow)' && /^lane-\d+$/.test(frame.id));
    const laneAt = p => frames.find(frame => isLane(frame) && within(p, frame.box) && frameSide(p, frame.sides) >= 0);
    const [firstLane, lastLane] = endpoints.map(laneAt);
    const betweenLanes = firstLane && lastLane && firstLane !== lastLane && bounds([center(firstLane.box), center(lastLane.box)]);
    for (const frame of frames) {
      if (!nearBoxes(edge.box, frame.box, frameClearance)) continue;
      // In lane-based layouts, a transition between different bands must
      // traverse the bands in between. Nested group boxes are not bands.
      if (isLane(frame) && betweenLanes && within(center(frame.box), betweenLanes)) continue;
      // Cynefin quadrants are the map background, not obstacle containers.
      if (edge.marker === 'url(#cynefin-arrow)' && ['complex', 'complicated', 'chaotic', 'clear'].includes(frame.id)) continue;
      // Sequence fragment/participant boxes are crossed by messages by design.
      if (edge.kind === 'message' && String(frame.id).startsWith('sequence-frame-')) continue;
      // Long parallel runs count on either side. Reject a run through the
      // border itself unless it actually follows the border (zero offset).
      hug: for (const segment of edge.segments) for (const side of frame.borders) {
        const run = along(segment, side, frameClearance, 12);
        if (!run) continue;
        const v = sub(side[1], side[0]);
        const offsets = run.map(p => cross(v, sub(p, side[0])));
        if (offsets[0] * offsets[1] < -1e-7) continue;
        issue('edge-hugs-frame', [edge, frame], run);
        break hug;
      }
      if (!near(edge.box, frame.box) || frame.id === edge.from || frame.id === edge.to ||
        endpoints.some(p => frameSide(p, frame.sides) >= 0)) continue;
      for (const line of edge.lines) {
        const crossing = frameCrossing(line, frame.sides);
        if (crossing) { issue('edge-crosses-frame', [edge, frame], crossing); break; }
      }
    }
    for (const node of nodes) {
      const { box: b } = node, { box: e } = edge;
      if (!nearBoxes(e, b, nodeClearance)) continue;
      // Exclusively for swimlane (no endpoint IDs), infer attachment from the
      // path tips and actual outline, not merely any point close to the box.
      const attached = node.id === edge.from || node.id === edge.to || (edge.inferEndpoints &&
        tips.some(p => inside([p, p], node.polygon, -1)));
      const nearBorder = nearBoxes(e, b, 1);
      if (!attached && nearBorder) {
        for (const segment of edge.segments) {
          const crossing = inside(segment, node.polygon, 1);
          if (crossing) { issue('edge-crosses-node', [edge, node], crossing); break; }
        }
      }
      if (!attached && node.endpointId !== edge.from && node.endpointId !== edge.to) {
        hug: for (const segment of edge.segments) for (const side of node.borders) {
          const run = along(segment, side, nodeClearance, 12);
          if (run && !along(segment, side)) { issue('edge-hugs-node', [edge, node], run); break hug; }
        }
      }
      if (!nearBorder) continue;
      border: for (const segment of edge.segments) for (const side of node.borders) {
        const slide = along(segment, side);
        if (slide) { issue('edge-along-border', [edge, node], slide); break border; }
      }
    }
    for (let j = i + 1; j < edges.length; j++) {
      const other = edges[j], a = edge.box, b = other.box;
      if (!nearBoxes(a, b, edgeClearance)) continue;
      const trunk = sharedTrunk(edge, other);
      const nearRoute = nearBoxes(a, b, 1);
      let close;
      routes: for (const [i, s] of edge.segments.entries()) for (const [j, t] of other.segments.entries()) {
        const overlap = nearRoute && along(s, t);
        if (trunk.has(`${i}:${j}`)) continue;
        if (overlap) { issue('collinear-edges', [edge, other], overlap); close = undefined; break routes; }
        if (!close) {
          const run = along(s, t, edgeClearance, 8);
          if (run && !portFan(edge, i, other, j, run)) close = run;
        }
      }
      if (close) issue('near-parallel-overlap', [edge, other], close);
    }
  });
  return issues;
}
