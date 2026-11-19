const mix = ([x, y], [u, v]) => [(x + u) / 2, (y + v) / 2];
const distance = ([x, y], [u, v]) => Math.hypot(x - u, y - v);

// Flatten in scene pixels, well below the one-pixel collision margin. Splitting
// by control-polygon length as well as distance to the chord preserves reversals.
function curve(points, add, depth = 0) {
  const a = points[0], b = points.at(-1), chord = distance(a, b);
  const length = points.slice(1).reduce((sum, p, i) => sum + distance(p, points[i]), 0);
  if (depth === 16 || (length - chord <= .125 && points.slice(1, -1).every(([x, y]) =>
    Math.abs((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) <= .125 * chord))) {
    add(b);
    return;
  }
  const left = [a], right = [b];
  while (points.length > 1) {
    points = points.slice(1).map((p, i) => mix(points[i], p));
    left.push(points[0]); right.unshift(points.at(-1));
  }
  curve(left, add, depth + 1);
  curve(right, add, depth + 1);
}

// SVG endpoint-to-center conversion, including radius correction. Swimlane
// crossover hops and blocks' cylinders use arcs rather than line segments.
function arc([x, y], [u, v], [rx, ry, degrees, large, sweep], add) {
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry || (x === u && y === v)) return add([u, v]);
  const phi = degrees * Math.PI / 180, c = Math.cos(phi), s = Math.sin(phi);
  const px = (c * (x - u) + s * (y - v)) / 2, py = (-s * (x - u) + c * (y - v)) / 2;
  const scale = Math.max(1, Math.hypot(px / rx, py / ry));
  rx *= scale; ry *= scale;
  const norm = (px / rx) ** 2 + (py / ry) ** 2;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, 1 / norm - 1));
  const cx = k * rx * py / ry, cy = -k * ry * px / rx;
  const start = Math.atan2((py - cy) / ry, (px - cx) / rx);
  let sweepAngle = Math.atan2((-py - cy) / ry, (-px - cx) / rx) - start;
  if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI;
  if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI;
  const steps = Math.max(1, Math.ceil(Math.abs(sweepAngle) / (2 * Math.acos(Math.max(0, 1 - .125 / Math.max(rx, ry))))));
  for (let i = 1; i < steps; i++) {
    const t = start + sweepAngle * i / steps, a = cx + rx * Math.cos(t), b = cy + ry * Math.sin(t);
    add([(x + u) / 2 + c * a - s * b, (y + v) / 2 + s * a + c * b]);
  }
  add([u, v]);
}

export function pathLines(d, map) {
  const tokens = String(d).match(/[a-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) || [];
  const counts = { M: 2, L: 2, H: 1, V: 1, Q: 4, C: 6, A: 7, Z: 0 };
  const lines = [];
  let p = [0, 0], start = p, cmd, i = 0, line;
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i])) cmd = tokens[i++];
    const op = cmd?.toUpperCase(), n = counts[op];
    const a = tokens.slice(i, i + n).map(Number);
    if (n == null || a.length !== n || a.some(v => !Number.isFinite(v))) throw new Error(`Unsupported scene path: ${d}`);
    i += n;
    const [x, y] = cmd === op ? [0, 0] : p;
    const point = (j) => [x + a[j], y + a[j + 1]];
    const add = (q) => line.push(map(q));
    const q = op === 'H' ? [x + a[0], p[1]] : op === 'V' ? [p[0], y + a[0]] : op === 'Z' ? start : point(n - 2);
    if (op === 'M') {
      start = q; lines.push(line = [map(q)]); cmd = cmd === op ? 'L' : 'l';
    } else if (op === 'A') arc(p, q, a, add);
    else if (op === 'C' || op === 'Q') curve([map(p), ...Array.from({ length: n / 2 }, (_, j) => map(point(j * 2)))], v => line.push(v));
    else { add(q); if (op === 'Z') cmd = undefined; }
    p = q;
  }
  return lines;
}
