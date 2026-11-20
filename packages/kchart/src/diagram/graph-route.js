import { flowOutlineName, shapeOutline, shapeGlyphBox, outlinePort } from './shapes.js';

export const TRACK_GAP = 12;
export const TRACK_CLEAR = 8;
// Two parallel runs closer than this read as one line (the scene geometry check uses the same 4px).
const EDGE_CLEAR = 4;
const sides = ['top', 'right', 'bottom', 'left'];
const vertical = side => side === 'top' || side === 'bottom';
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const expand = ({ x, y, w, h }, d) => ({ x: x - d, y: y - d, w: w + d * 2, h: h + d * 2 });
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Segment against the open interior: even a segment parallel to an outline needs clearance.
// The router calls this for every candidate leg and obstacle, so the two slabs are spelled out.
function hits(a, b, rect) {
  let lo = 0, hi = 1;
  const dx = b.x - a.x;
  if (Math.abs(dx) < 1e-8) { if (a.x <= rect.x || a.x >= rect.x + rect.w) return false; }
  else {
    const p = (rect.x - a.x) / dx, q = (rect.x + rect.w - a.x) / dx;
    lo = Math.max(lo, Math.min(p, q)); hi = Math.min(hi, Math.max(p, q));
    if (lo >= hi) return false;
  }
  const dy = b.y - a.y;
  if (Math.abs(dy) < 1e-8) { if (a.y <= rect.y || a.y >= rect.y + rect.h) return false; }
  else {
    const p = (rect.y - a.y) / dy, q = (rect.y + rect.h - a.y) / dy;
    lo = Math.max(lo, Math.min(p, q)); hi = Math.min(hi, Math.max(p, q));
    if (lo >= hi) return false;
  }
  return lo < hi;
}

function attachment(node, side, type, offset = 0, coord) {
  const v = vertical(side), sign = side === 'top' || side === 'left' ? -1 : 1;
  const shape = !node.frame && (type === 'flowchart' ? flowOutlineName(node.shape)
    : node.kind === 'choice' ? 'diam' : node.kind === 'start' || node.kind === 'end' ? 'circle'
      : node.kind === 'state' ? 'rounded' : node.kind === 'note' ? 'note' : null);
  const plain = v ? { x: node.w / 2, y: sign < 0 ? 0 : node.h } : { x: sign < 0 ? 0 : node.w, y: node.h / 2 };
  if (v) plain.x = coord === undefined ? plain.x + node.w * offset : coord - node.x;
  else plain.y = coord === undefined ? plain.y + node.h * offset : coord - node.y;
  const local = shape ? outlinePort(shapeOutline(shape, node.w, node.h, node.direction), side, v ? plain.x : plain.y) : plain;
  const port = { x: node.x + local.x, y: node.y + local.y };
  const stub = v ? { x: port.x, y: node.y + (sign < 0 ? -10 : node.h + 10) }
    : { x: node.x + (sign < 0 ? -10 : node.w + 10), y: port.y };
  return { port, stub };
}

function straight(a, b) {
  return { p0: a, c1: a, c2: b, p1: b };
}

function sharesRun(a, b, p, q, gap = 1, span = 4) {
  const same = (a, b) => Math.abs(a - b) < .01;
  const axis = same(a.x, b.x) && same(p.x, q.x) && Math.abs(a.x - p.x) < gap - .001 ? 'y'
    : same(a.y, b.y) && same(p.y, q.y) && Math.abs(a.y - p.y) < gap - .001 ? 'x' : null;
  return axis && Math.min(Math.max(a[axis], b[axis]), Math.max(p[axis], q[axis])) - Math.max(Math.min(a[axis], b[axis]), Math.min(p[axis], q[axis])) > span;
}

function crosses(a, b) {
  const side = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(a.p0, a.p1, b.p0) * side(a.p0, a.p1, b.p1) < -1e-6 &&
    side(b.p0, b.p1, a.p0) * side(b.p0, b.p1, a.p1) < -1e-6;
}

// A side port should lead away from the node, not wrap back around its near corner.
function cornerHook(points, box, axis) {
  if (points.length < 4) return false;
  const [port, lead, turn, next] = points;
  const d = lead[axis] - port[axis];
  const opposite = d * (next[axis] - turn[axis]) < 0;
  return opposite && (d * (next[axis] - port[axis]) < 0 || hits(turn, next, expand(box, TRACK_GAP)));
}

// clearOf: parallel runs a forward route must keep EDGE_CLEAR away from (edges that read as one
// line otherwise). Without it the old 1px tolerance applies, so a route is never lost.
// lanes: x / y of the straight runs the edge had before repair. A detour tries them first.
function shortest(from, to, obstacles, occupied, type, bounds, label, original, back, frameSides, arrivals, clearOf = [], lanes = { x: [], y: [] }, board = false, forward = null) {
  let best = null, score = Infinity, needsDetour = true;
  // Track coordinates beside obstacles, frames and (for back edges) other runs; only the midpoint
  // differs between searches, so the fixed part is collected once per route.
  const fixed = {};
  for (const [key, span] of [['x', 'w'], ['y', 'h']]) {
    const frameTracks = frameSides.filter(({ p0, p1 }) => p0[key] === p1[key])
      .flatMap(({ p0 }) => {
        const at = p0[key], clearance = board && label ? Math.max(TRACK_CLEAR, label[span] / 2 + 2) : TRACK_CLEAR;
        return clearance === TRACK_CLEAR ? [at - TRACK_CLEAR, at + TRACK_CLEAR]
          : [at - TRACK_CLEAR, at + TRACK_CLEAR, at - clearance, at + clearance];
      });
    const tracks = (back || board || forward) ? occupied.filter(({ p0, p1 }) => Math.abs(p0[key] - p1[key]) < .01)
      .flatMap(({ p0 }) => [p0[key] - TRACK_GAP, p0[key] + TRACK_GAP]) : [];
    fixed[key] = [...new Set([6, bounds[span] - 6, ...tracks, ...frameTracks, ...obstacles.flatMap(r => [r[key] - 1, r[key] + r[span] + 1])])]
      .filter(x => x >= 4 && x <= bounds[span] - 4);
  }
  const sorted = new Map();
  const candidates = (a, b, key, span) => {
    const midpoint = (a[key] + b[key]) / 2;
    if (!sorted.has(key + midpoint)) {
      const coords = midpoint >= 4 && midpoint <= bounds[span] - 4 && !fixed[key].includes(midpoint) ? [midpoint, ...fixed[key]] : fixed[key].slice();
      sorted.set(key + midpoint, coords.sort((x, y) => Math.abs(x - midpoint) - Math.abs(y - midpoint) || x - y).slice(0, 28));
    }
    return sorted.get(key + midpoint);
  };
  const clear = (a, b) => !obstacles.some(r => hits(a, b, r));
  const fromBox = expand(from, 4), toBox = expand(to, 4);
  const inside = board && (board.insideFrom ? from : board.insideTo ? to : null);
  const fitsInside = p => !inside || p.x >= inside.x && p.x <= inside.x + inside.w && p.y >= inside.y && p.y <= inside.y + inside.h;
  const orderedPort = (port, side, peer, ports) => {
    const axis = vertical(side) ? 'x' : 'y', span = axis === 'x' ? 'w' : 'h';
    const at = peer[axis] + peer[span] / 2;
    return ports.every(old => {
      if (side !== old.side) return true;
      const delta = at - (old.peer[axis] + old.peer[span] / 2);
      return Math.abs(port[axis] - old.port[axis]) >= EDGE_CLEAR - .001 && delta * (port[axis] - old.port[axis]) >= 0;
    });
  };
  const attach = (box, side, offset, coord) => {
    if (!board) return attachment(box, side, type, offset, coord);
    const v = vertical(side), first = side === 'top' || side === 'left';
    const along = coord ?? (v ? box.x + box.w * (.5 + offset) : box.y + box.h * (.5 + offset));
    const face = v ? box.y + (first ? 0 : box.h) : box.x + (first ? 0 : box.w);
    const lead = face + (first ? -1 : 1) * (inside ? 4 : TRACK_CLEAR) * (box === inside ? -1 : 1);
    return v ? { port: { x: along, y: face }, stub: { x: along, y: lead } }
      : { port: { x: face, y: along }, stub: { x: lead, y: along } };
  };
  const search = (source, target, startOffset, endOffset, detour, sharedCoord) => {
    const start = attach(from, source, startOffset, sharedCoord), end = attach(to, target, endOffset, sharedCoord);
    const { port: fromPort } = start, { port: toPort } = end;
    // A straight connection does not need room for two full turning stubs.
    const mid = sharedCoord === undefined ? null : { x: (fromPort.x + toPort.x) / 2, y: (fromPort.y + toPort.y) / 2 };
    const a = mid ?? start.stub, b = mid ?? end.stub;
    const pointsToward = ({ port, stub }) => (mid.x - port.x) * (stub.x - port.x) + (mid.y - port.y) * (stub.y - port.y) > 0;
    if (mid && (!pointsToward(start) || !pointsToward(end))) return;
    if (board && (!orderedPort(fromPort, source, to, board.fromPorts) || !orderedPort(toPort, target, from, board.toPorts))) return;
    if (!clear(fromPort, a) || !clear(b, toPort)) return;
    if (arrivals.some(edge => distance(edge.end, toPort) < TRACK_CLEAR)) return;
    if (distance(fromPort, a) + distance(a, b) + distance(b, toPort) >= score) return;
    const validate = mids => {
      const points = [fromPort, a, ...mids, b, toPort].filter((p, i, all) => !i || distance(p, all[i - 1]) > (board ? 0 : .001));
      if (inside && !points.every(fitsInside)) return;
      let length = 0;
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 2], a = points[i - 1], b = points[i];
        if (prev && (prev.x === a.x && a.x === b.x || prev.y === a.y && a.y === b.y) &&
            distance(prev, a) + distance(a, b) > distance(prev, b) + .001) return;
        length += distance(a, b);
      }
      const compact = points.filter((p, i) => !i || i === points.length - 1 ||
        Math.abs(distance(points[i - 1], p) + distance(p, points[i + 1]) - distance(points[i - 1], points[i + 1])) > .001 ||
        (points[i - 1].x !== points[i + 1].x && points[i - 1].y !== points[i + 1].y));
      const bends = compact.length - 2;
      if (forward?.maxBends != null && bends > forward.maxBends) return;
      if (forward?.refine && (cornerHook(compact, from, forward.lateral) ||
          cornerHook(compact.slice(-4).reverse(), to, forward.lateral))) return;
      const cost = length + bends * 16;
      // Cheap cost first: a leg that cannot beat the best route needs no obstacle tests.
      if (cost >= score) return;
      for (let i = 2; i < points.length - 1; i++) {
        if (from !== inside && hits(points[i - 1], points[i], fromBox) || to !== inside && hits(points[i - 1], points[i], toBox)) return;
        if (!clear(points[i - 1], points[i])) return;
      }
      const segments = compact.slice(1).map((p, i) => straight(compact[i], p));
      if (segments.some(({ p0, p1 }) => occupied.some(seg =>
        sharesRun(p0, p1, seg.p0, seg.p1, board ? EDGE_CLEAR : back ? TRACK_GAP : 1, board ? 0 : back ? 8 : 4)) ||
        clearOf.some(seg => sharesRun(p0, p1, seg.p0, seg.p1, forward && (forward.maxBends == null || from.parent !== to.parent) ? TRACK_GAP : EDGE_CLEAR, 4)) ||
        forward?.siblings.some(seg => crosses({ p0, p1 }, seg)) ||
        frameSides.some(seg => sharesRun(p0, p1, seg.p0, seg.p1, TRACK_CLEAR, 12)) ||
        arrivals.some(edge => edge.segments.some(seg => crosses({ p0, p1 }, seg) ||
          sharesRun(p0, p1, seg.p0, seg.p1, TRACK_CLEAR, 8))))) return;
      let crossingPenalty = 0;
      if (forward) for (const seg of segments) for (const other of occupied) {
        if (crosses(seg, other)) crossingPenalty += 1;
      }
      if (forward?.maxBends != null && crossingPenalty) return;
      // Going upstream to find a gutter makes a hook at the endpoint. Prefer a gutter
      // that can be reached without doubling back, even when the route is longer.
      const retreat = forward ? segments.reduce((sum, seg) =>
        sum + Math.max(0, forward.coordinate(seg.p0) - forward.coordinate(seg.p1)), 0) : 0;
      const flowCost = cost + crossingPenalty * 240 + retreat * 6;
      if (flowCost >= score) return;
      let labelRect = label;
      if (label) {
        const box = p => ({ ...label, x: p.x - label.w / 2, y: p.y - label.h / 2 });
        const allowed = box => ![from, to, ...obstacles].some(r => r !== inside && overlaps(box, r)) && (!board ||
          fitsInside(box) && fitsInside({ x: box.x + box.w, y: box.y + box.h }) &&
          box.x >= 0 && box.y >= 0 && box.x + box.w <= bounds.w && box.y + box.h <= bounds.h &&
          !occupied.some(seg => hits(seg.p0, seg.p1, expand(box, 2))) &&
          !frameSides.some(seg => hits(seg.p0, seg.p1, box)));
        const legs = compact.slice(1).map((p, i) => [compact[i], p]).sort(([p, q], [r, s]) => distance(r, s) - distance(p, q));
        labelRect = null;
        for (const [p, q] of legs) {
          for (const f of board ? [.5, .35, .65, .2, .8] : [.5, .35, .65]) {
            const candidate = box({ x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f });
            if (allowed(candidate)) { labelRect = candidate; break; }
          }
          if (labelRect) break;
        }
        if (!labelRect && original && allowed(label)) labelRect = label;
        if (!labelRect) return;
      }
      best = { start: fromPort, end: toPort, labelRect, segments, ...(board ? { source, target } : {}) };
      score = flowCost;
      needsDetour = crossingPenalty > 0 || retreat > .001 || (forward?.refine && bends > 2);
    };
    if (a.x === b.x || a.y === b.y) validate([]);
    if (sharedCoord !== undefined) return;
    validate([{ x: a.x, y: b.y }]); validate([{ x: b.x, y: a.y }]);
    if (forward?.maxBends === 1) return;
    // Path length alone (before bends) already rules most tracks out; skip those without building
    // the path. The .01 margin keeps every track validate could still accept.
    const ends = distance(fromPort, a) + distance(b, toPort) - .01;
    const tracksNear = (key, span) => {
      const middle = candidates(a, b, key, span);
      return forward?.refine && forward.maxBends == null && !forward.straightOnly
        ? new Set([...middle, ...candidates(a, a, key, span).slice(0, 6), ...candidates(b, b, key, span).slice(0, 6)]) : middle;
    };
    const xs = tracksNear('x', 'w'), ys = tracksNear('y', 'h');
    for (const x of xs) {
      if (ends + Math.abs(a.x - x) + Math.abs(a.y - b.y) + Math.abs(x - b.x) < score) validate([{ x, y: a.y }, { x, y: b.y }]);
    }
    for (const y of ys) {
      if (ends + Math.abs(a.y - y) + Math.abs(a.x - b.x) + Math.abs(y - b.y) < score) validate([{ x: a.x, y }, { x: b.x, y }]);
    }
    if (detour && (!best || (forward && needsDetour))) {
      if (forward) {
        // Try the outer gutter independently of the midpoint track limit. The two turns
        // can lie in different rank gaps, e.g. below a source frame and above a target.
        const axis = vertical(forward.exit) ? 'x' : 'y', along = axis === 'x' ? 'y' : 'x';
        const rails = candidates(a, b, axis, axis === 'x' ? 'w' : 'h');
        const depth = axis === 'x' ? 'h' : 'w', span = axis === 'x' ? 'w' : 'h';
        const near = p => new Set([p[along], ...candidates(p, p, along, depth).slice(0, 9)]);
        const starts = near(a), endsAt = near(b);
        const walls = frameSides.filter(({ p0, p1 }) => p0[axis] === p1[axis]).map(({ p0 }) => p0[axis]);
        const low = Math.min(...walls) - TRACK_CLEAR, high = Math.max(...walls) + TRACK_CLEAR;
        const railTracks = [...new Set([...lanes[axis], ...rails.slice(0, 12), low, high, low - TRACK_GAP,
          high + TRACK_GAP, 6, bounds[span] - 6])];
        for (const rail of railTracks) for (const at of starts) for (const bt of endsAt) {
          if (rail < 4 || rail > bounds[span] - 4 || ends + Math.abs(a[along] - at) + Math.abs(at - bt) +
              Math.abs(bt - b[along]) + Math.abs(a[axis] - rail) + Math.abs(b[axis] - rail) >= score) continue;
          validate([{ ...a, [along]: at }, { [axis]: rail, [along]: at },
            { [axis]: rail, [along]: bt }, { ...b, [along]: bt }]);
        }
      }
      // Travel down separate local corridors, then change tracks in the rank gap.
      const near = (p, key, span) => candidates(p, p, key, span).slice(0, 7);
      const aX = near(a, 'x', 'w'), bX = near(b, 'x', 'w');
      const aY = near(a, 'y', 'h'), bY = near(b, 'y', 'h');
      // The gap track nearest the midpoint can still lie inside a subgraph the edge must pass. The
      // edge's own earlier lanes (in a compact layout, the channel the outer layout kept beside that
      // subgraph) come first.
      const gapTracks = (list, key, span) => [...new Set([...lanes[key].filter(v => v >= 4 && v <= bounds[span] - 4), ...list.slice(0, 8)])];
      for (const y of gapTracks(candidates(a, b, 'y', 'h'), 'y', 'h')) for (const x1 of aX) for (const x2 of bX) {
        if (ends + Math.abs(a.x - x1) + Math.abs(a.y - y) + Math.abs(x1 - x2) + Math.abs(y - b.y) + Math.abs(x2 - b.x) >= score) continue;
        validate([{ x: x1, y: a.y }, { x: x1, y }, { x: x2, y }, { x: x2, y: b.y }]);
      }
      for (const x of gapTracks(candidates(a, b, 'x', 'w'), 'x', 'w')) for (const y1 of aY) for (const y2 of bY) {
        if (ends + Math.abs(a.y - y1) + Math.abs(a.x - x) + Math.abs(y1 - y2) + Math.abs(x - b.x) + Math.abs(y2 - b.y) >= score) continue;
        validate([{ x: a.x, y: y1 }, { x, y: y1 }, { x, y: y2 }, { x: b.x, y: y2 }]);
      }
    }
  };
  if (board) {
    // Try ports inside the common projection of facing sides before searching detours.
    // Clamp to the destination centre when possible, so fan-out follows destination order.
    for (const [key, span, low, high] of [['x', 'w', 'top', 'bottom'], ['y', 'h', 'left', 'right']]) {
      const inset = box => Math.min(8, box[span] / 4);
      const overlapLo = Math.max(from[key], to[key]), overlapHi = Math.min(from[key] + from[span], to[key] + to[span]);
      if (overlapHi <= overlapLo) continue;
      const lo = Math.min((overlapLo + overlapHi) / 2, Math.max(from[key] + inset(from), to[key] + inset(to)));
      const hi = Math.max((overlapLo + overlapHi) / 2, Math.min(from[key] + from[span] - inset(from), to[key] + to[span] - inset(to)));
      const clamp = value => Math.max(lo, Math.min(hi, value));
      const preferred = clamp(to[key] + to[span] / 2);
      const cross = key === 'x' ? 'y' : 'x', size = key === 'x' ? 'h' : 'w';
      const pair = from[cross] + from[size] <= to[cross] ? [high, low]
        : to[cross] + to[size] <= from[cross] ? [low, high] : null;
      const pairs = inside ? [[low, low], [high, high]] : pair ? [pair] : [];
      for (const faces of pairs) for (const coord of new Set([preferred, (lo + hi) / 2, clamp(preferred - TRACK_GAP), clamp(preferred + TRACK_GAP), lo, hi])) {
        search(...faces, 0, 0, false, coord);
        if (best && !inside) return best;
      }
    }
  }
  if (forward) {
    const { exit, enter } = forward;
    const axis = vertical(exit) ? 'x' : 'y', span = vertical(exit) ? 'w' : 'h';
    for (const box of [to, from]) {
      const coord = box[axis] + box[span] / 2;
      if ([from, to].every(box => coord >= box[axis] + 6 && coord <= box[axis] + box[span] - 6)) {
        search(exit, enter, 0, 0, false, coord);
      }
    }
    if (forward.straightOnly) return best;
  }
  const sources = forward ? sides.filter(side => side !== forward.enter) : sides;
  const targets = forward ? sides.filter(side => side !== forward.exit) : sides;
  for (const source of sources) for (const target of targets) {
    search(source, target, 0, 0, false);
    if (forward?.maxBends != null) {
      const shift = (box, side) => {
        const axis = vertical(side) ? 'x' : 'y', span = vertical(side) ? 'w' : 'h';
        return lanes[axis].filter(coord => coord >= box[axis] + 6 && coord <= box[axis] + box[span] - 6)
          .slice(0, 3).map(coord => (coord - box[axis]) / box[span] - .5);
      };
      for (const offset of shift(from, source)) search(source, target, offset, 0, false);
      for (const offset of shift(to, target)) search(source, target, 0, offset, false);
    }
  }
  if (forward?.maxBends != null) return best;
  // Parallel links may exhaust center ports. Try separated ports before longer paths.
  for (const offset of [-.2, .2, -.35, .35]) {
    if (best && !board && (!forward || !needsDetour)) break;
    for (const source of sources) for (const target of targets) for (const [u, v] of [[offset, 0], [0, offset], [offset, offset]]) {
      search(source, target, u, v, false);
    }
  }
  if (forward?.refine && needsDetour) {
    // An obstacle-defined corridor may begin inside the facing side of the node.
    // Try putting the port on that channel rather than adding two turns to reach it.
    const axis = forward.lateral, span = axis === 'x' ? 'w' : 'h';
    const offsets = box => {
      const tracks = fixed[axis].filter(at => at >= box[axis] + 6 && at <= box[axis] + box[span] - 6).sort((a, b) => a - b);
      const center = box[axis] + box[span] / 2;
      const extremes = [...tracks.slice(0, 3), ...tracks.slice(-3)];
      return [...new Set([...extremes, ...tracks.sort((a, b) => Math.abs(a - center) - Math.abs(b - center)).slice(0, 4)])]
        .map(at => (at - center) / box[span]);
    };
    for (const offset of offsets(from)) for (const end of [0, -.2, .2]) search(forward.exit, forward.enter, offset, end, false);
    for (const offset of offsets(to)) for (const start of [0, -.2, .2]) search(forward.exit, forward.enter, start, offset, false);
  }
  for (const offset of [0, -.2, .2]) {
    if (best && (!forward || !needsDetour)) break;
    for (const source of sources) for (const target of targets) search(source, target, offset, offset, true);
  }
  return best;
}

const curvePoint = ({ p0, c1, c2, p1 }, t) => {
  const u = 1 - t, at = k => u ** 3 * p0[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t ** 3 * p1[k];
  return { x: at('x'), y: at('y') };
};

function borders({ x, y, w, h }) {
  const a = { x, y }, b = { x: x + w, y }, c = { x: x + w, y: y + h }, d = { x, y: y + h };
  return [straight(a, b), straight(b, c), straight(c, d), straight(d, a)];
}

export function repairRoutes(geometry, redirects = new Map(), { board = false } = {}) {
  const nodes = new Map(geometry.nodes.map(node => [node.id, node]));
  const frames = new Map(geometry.frames.map(frame => [frame.id, { ...frame, frame: true }]));
  const endpoint = id => nodes.get(id) ?? frames.get(id);
  const ancestors = node => {
    const result = new Set([node.id]);
    for (let id = node.parent; board ? id != null : id; id = frames.get(id)?.parent) result.add(id);
    return result;
  };
  const checkTracks = !board && nodes.size > 30;
  const pending = new Set(redirects.keys());
  const settled = [];
  const ports = new Map();
  const reserve = (box, peer, port, side) => {
    if (!ports.has(box.id)) ports.set(box.id, []);
    ports.get(box.id).push({ peer, port, side });
  };
  const direction = geometry.direction;
  const faces = { TB: ['bottom', 'top'], BT: ['top', 'bottom'], LR: ['right', 'left'], RL: ['left', 'right'] }[direction];
  const lateral = faces && (vertical(faces[0]) ? 'x' : 'y');
  const straighten = !board && geometry.model?.variant !== 'agentflow' && (geometry.type === 'flowchart' || geometry.type === 'state');
  // Explicit frame routes already own their ports and tracks; retain their repair order.
  const projectForward = straighten && !geometry.model?.edges.some(edge => edge.fromFrame || edge.toFrame);
  // Custom blocks (e.g. class cards) paint their own geometry on top of graph layout.
  const polishFlow = projectForward && geometry.type === 'flowchart' && !geometry.model?.nodes.some(node => node.block);
  const coordinate = p => direction === 'LR' ? p.x : direction === 'RL' ? -p.x : direction === 'BT' ? -p.y : p.y;
  const back = e => e.reversed || (e.start && e.end && coordinate(e.start) > coordinate(e.end) + 1);
  // Reserve the forward tracks first; a back edge is the one that yields.
  const span = edge => {
    const { from, to } = redirects.get(edge.id);
    return Math.abs(coordinate(endpoint(from) ?? edge.start) - coordinate(endpoint(to) ?? edge.end));
  };
  const ordered = [...geometry.edges].sort((a, b) => Number(!!back(a)) - Number(!!back(b)) || (projectForward ?
    Number(pending.has(a.id)) - Number(pending.has(b.id)) ||
    (pending.has(a.id) && pending.has(b.id) ? span(a) - span(b) : 0) : 0));
  const frameSides = [...frames.values()].flatMap(borders);
  const nodeBorders = new Map([...nodes.values()].map(node => [node.id, borders(node)]));
  for (const edge of ordered) {
    if (edge.style === 'invisible' || edge.self || !edge.segments?.length) continue;
    const redirect = redirects.get(edge.id);
    const from = endpoint(redirect?.from ?? edge.from), to = endpoint(redirect?.to ?? edge.to);
    if (!from || !to || from === to) continue;
    const fromAncestors = ancestors(from), toAncestors = ancestors(to);
    const exempt = new Set([...fromAncestors, ...toAncestors]);
    const boxes = [...nodes.values(), ...frames.values()].filter(box => !exempt.has(box.id));
    const isBack = !!back(edge);
    const obstacles = boxes.map(box => expand(box, box.frame ? 5 : TRACK_CLEAR));
    const titles = [...frames.values()].flatMap(f => f.titleRect && f.titleRect.w && f.titleRect.h ? [expand(f.titleRect, 5)] : []);
    const tight = [...boxes.map(r => expand(r, 1.5)), ...titles];
    const occupiedOf = () => geometry.edges.filter(other => other !== edge && other.style !== 'invisible' && !pending.has(other.id)).flatMap(other => other.segments);
    const occupied = isBack ? occupiedOf() : null;
    const arrivals = to.kind === 'end' ? geometry.edges.filter(other => other !== edge && other.to === to.id && other.end &&
      (distance(other.start, other.end) > distance(edge.start, edge.end) ||
        distance(other.start, other.end) === distance(edge.start, edge.end) && other.id < edge.id)) : [];
    const hugs = (seg, box) => nodeBorders.get(box.id)?.some(side => sharesRun(seg.p0, seg.p1, side.p0, side.p1, TRACK_CLEAR, 8));
    let collision = !!redirect || edge.segments.some(seg => boxes.some(box => !box.frame && hugs(seg, box)) ||
      occupied?.some(other => sharesRun(seg.p0, seg.p1, other.p0, other.p1, TRACK_GAP, 8)) ||
      frameSides.some(side => sharesRun(seg.p0, seg.p1, side.p0, side.p1, TRACK_CLEAR, 12)) ||
      arrivals.some(other => other.segments.some(run => crosses(seg, run) ||
        sharesRun(seg.p0, seg.p1, run.p0, run.p1, TRACK_CLEAR, 8))));
    if (!collision) for (const seg of edge.segments) {
      let prev = seg.p0;
      for (let i = 1; i <= 5; i++) {
        const next = curvePoint(seg, i / 5);
        if (tight.some(r => hits(prev, next, r))) { collision = true; break; }
        prev = next;
      }
      if (collision) break;
    }
    if (!collision && checkTracks) {
      const avoid = [...borders(from), ...borders(to), ...settled];
      collision = edge.segments.some(seg => avoid.some(other => sharesRun(seg.p0, seg.p1, other.p0, other.p1)));
    }
    const jog = straighten && !redirect && !isBack && lateral && edge.segments.length > 2 &&
      Math.abs(edge.start[lateral] - edge.end[lateral]) < 24 &&
      edge.segments.every(seg => coordinate(seg.p0) <= coordinate(seg.p1) + .001);
    // A side-to-main-axis route with a jog near an endpoint can often be drawn as an L.
    // Limit this pass to routes with at most three turns (one segment per rounded corner).
    const polish = polishFlow && !redirect && !isBack && lateral &&
      edge.segments.length >= 3 && edge.segments.length <= 7 &&
      edge.segments.filter(({ p0, p1 }) => Math.abs(p0.x - p1.x) < .01 || Math.abs(p0.y - p1.y) < .01).length >= 3 &&
      Math.abs(edge.end[lateral] - edge.start[lateral]) >= TRACK_CLEAR &&
      (Math.abs(edge.segments[0].p1[lateral] - edge.start[lateral]) > .01 ||
       Math.abs(edge.end[lateral] - edge.segments.at(-1).p0[lateral]) > .01);
    if (!collision && !jog && !polish) { if (checkTracks) settled.push(...edge.segments); continue; }
    const labelObstacles = geometry.edges.filter(other => other !== edge && other.labelRect && (!(board || projectForward) || !pending.has(other.id)))
      .map(other => expand(other.labelRect, 2));
    // A forward route keeps clear of other forward routes. Back edges yield later, so their current
    // runs are not reserved yet.
    const forwardRuns = isBack || board ? [] : geometry.edges.filter(other => other !== edge && other.style !== 'invisible' &&
      !pending.has(other.id) && !back(other)).flatMap(other => other.segments);
    const lanes = { x: [], y: [] };
    for (const { p0, p1 } of edge.segments) {
      if (Math.abs(p0.x - p1.x) < .01) lanes.x.push(p0.x);
      if (Math.abs(p0.y - p1.y) < .01) lanes.y.push(p0.y);
    }
    const boardPorts = board && { insideFrom: toAncestors.has(from.id), insideTo: fromAncestors.has(to.id),
      fromPorts: ports.get(from.id) ?? [], toPorts: ports.get(to.id) ?? [] };
    const forward = ((projectForward && redirect) || jog || polish) && !isBack && faces && {
      exit: faces[0], enter: faces[1], straightOnly: !!jog && !polish, coordinate, lateral,
      maxBends: polish ? 1 : undefined, refine: polishFlow,
      siblings: geometry.edges.filter(other => other !== edge && other.from === from.id && other.style !== 'invisible' &&
        !pending.has(other.id)).flatMap(other => other.segments) };
    const route = (clearOf, rule) => shortest(from, to, [...obstacles, ...titles, ...labelObstacles], occupied ?? occupiedOf(), geometry.type,
      { w: geometry.width, h: geometry.height }, edge.labelRect, !redirect, isBack, frameSides, arrivals, clearOf, lanes, boardPorts, rule);
    const replacement = (forward && (route(forwardRuns, forward) || (redirect && route([], forward)))) ||
      (collision && ((forwardRuns.length && route(forwardRuns)) || route([])));
    if (replacement) {
      pending.delete(edge.id);
      if (board) {
        reserve(from, to, replacement.start, replacement.source);
        reserve(to, from, replacement.end, replacement.target);
      }
      Object.assign(edge, replacement, { from: from.id, to: to.id, fromFrame: from.frame === true, toFrame: to.frame === true });
    }
    if (checkTracks) settled.push(...edge.segments);
  }
  return geometry;
}

export function placeGraphLabels(geometry, measure) {
  const { nodes, frames, edges, width, height } = geometry;
  const titles = frames.map(f => f.titleRect).filter(r => r?.w && r.h);
  const paths = edges.map(edge => edge.style === 'invisible' ? [] : edge.segments.flatMap(seg => {
    if (['x', 'y'].some(key => [seg.c1, seg.c2, seg.p1].every(p => Math.abs(p[key] - seg.p0[key]) < 1e-8))) return [seg];
    return Array.from({ length: 12 }, (_, i) => straight(curvePoint(seg, i / 12), curvePoint(seg, (i + 1) / 12)));
  }));
  const pathHits = (path, box) => path.some(seg => hits(seg.p0, seg.p1, box));
  const fits = box => box.x >= 0 && box.y >= 0 && box.x + box.w <= width && box.y + box.h <= height;
  edges.forEach((edge, index) => {
    const r = edge.labelRect;
    if (!r || !paths[index].length) return;
    const center = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    const blockers = [...nodes, ...titles, ...edges.flatMap(e => e !== edge && e.labelRect ? [e.labelRect] : [])];
    let best = null, score = Infinity;
    for (const { p0, p1 } of paths[index]) {
      const dx = p1.x - p0.x, dy = p1.y - p0.y;
      const len = Math.hypot(dx, dy);
      if (!len) continue;
      const t = Math.min(1, Math.max(0, ((center.x - p0.x) * dx + (center.y - p0.y) * dy) / (len * len)));
      const steps = Math.min(128, Math.ceil(len / 5));
      for (const at of [t, ...Array.from({ length: steps }, (_, i) => (i + .5) / steps)]) {
        const p = { x: p0.x + dx * at, y: p0.y + dy * at };
        const cost = Math.hypot(p.x - center.x, p.y - center.y);
        if (cost >= score) continue;
        const box = { ...r, x: p.x - r.w / 2, y: p.y - r.h / 2 };
        if (!fits(box) || blockers.some(b => overlaps(box, b)) || paths.some((path, j) => j !== index && pathHits(path, box))) continue;
        best = box;
        score = cost;
      }
    }
    if (best) {
      edge.labelRect = best;
      const label = geometry.labels.find(label => label.edge === edge.id);
      if (label) Object.assign(label, best);
    }
  });
  if (geometry.type !== 'flowchart') return;
  for (const n of nodes) {
    const glyph = shapeGlyphBox(flowOutlineName(n.shape), n.w, n.h, n.direction);
    if (!glyph || !n.lines.length) continue;
    const w = Math.max(...n.lines.map(value => measure(value, { size: 14, weight: 600 })));
    const h = n.lines.length * 19;
    const rect = x => ({ x, y: n.y + (n.h - h) / 2, w, h });
    const blocked = box => !fits(box) || paths.some(path => pathHits(path, expand(box, 2))) ||
      nodes.some(other => other !== n && overlaps(box, other)) || edges.some(e => e.labelRect && overlaps(box, e.labelRect));
    n.glyphLabelLeft = blocked(rect(n.x + glyph.x + glyph.w + 8)) && !blocked(rect(n.x + glyph.x - 8 - w));
  }
}
