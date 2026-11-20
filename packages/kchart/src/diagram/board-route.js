import { repairRoutes } from './graph-route.js';

const center = box => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
const straight = (a, b) => ({ p0: a, c1: a, c2: b, p1: b });
const BLOCKER = '\u0000blocker';

// Routes every relation of a board with the compound router: orthogonal runs that keep clear of
// unrelated cards, group borders and group titles, and cross only their endpoints' own groups.
//   nodes:    [{ id, x, y, w, h, parent? }]            cards / nodes: obstacles and endpoints
//   frames:   [{ id, x, y, w, h, parent?, titleRect? }] groups: endpoints; borders crossed only by descendants
//   blockers: [{ x, y, w, h }]                          notes, legends: obstacles only
//   edges:    [{ id, from, to, label?: { w, h } }]      from / to name a node or a frame
// Returns { edges: [{ id, points, labelRect? }], failed: [id] }; points run outline to outline.
export function routeBoard({ width, height, nodes, frames, blockers = [], edges }) {
  const boxes = new Map([...nodes, ...frames].map(box => [box.id, box]));
  const routed = edges.map(edge => {
    const a = center(boxes.get(edge.from)), b = center(boxes.get(edge.to));
    const segments = [straight(a, b)];
    // Pending labels supply dimensions only; a repaired edge reserves its placed plate.
    return { id: edge.id, from: edge.from, to: edge.to, start: a, end: b, segments, initial: segments,
      ...(edge.label ? { labelRect: { w: edge.label.w, h: edge.label.h } } : {}) };
  });
  const geometry = {
    type: 'board', width, height, labels: [], edges: routed,
    nodes: [...nodes.map(node => ({ ...node })), ...blockers.map((box, i) => ({ ...box, id: `${BLOCKER}${i}` }))],
    frames: frames.map(frame => ({ ...frame })),
  };
  // A redirect makes the router replace every route instead of repairing a drawn one.
  repairRoutes(geometry, new Map(routed.map(edge => [edge.id, { from: edge.from, to: edge.to }])), { board: true });
  const failed = routed.filter(edge => edge.segments === edge.initial).map(edge => edge.id);
  return {
    failed,
    edges: routed.filter(edge => edge.segments !== edge.initial).map(edge => ({
      id: edge.id,
      points: [edge.segments[0].p0, ...edge.segments.map(segment => segment.p1)],
      ...(edge.labelRect ? { labelRect: edge.labelRect } : {}),
    })),
  };
}
