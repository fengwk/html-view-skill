// Public Mermaid 12.3 names; the first name in each row selects the geometry.
const aliases = `rect proc process rectangle
rounded event
stadium terminal pill
fr-rect subprocess subproc framed-rectangle subroutine
cyl db database cylinder
datastore data-store
folder directory
bucket
console
browser
person
circle circ
bang
cloud
diam decision diamond question
hex hexagon prepare
lean-r lean-right in-out
lean-l lean-left out-in
trap-b priority trapezoid-bottom trapezoid
trap-t manual trapezoid-top inv-trapezoid
dbl-circ double-circle
text
notch-rect card notched-rectangle
lin-rect lined-rectangle lined-process lin-proc shaded-process
sm-circ start small-circle
fr-circ stop framed-circle
fork join
hourglass collate
brace comment brace-l
brace-r
braces
bolt com-link lightning-bolt
doc document
delay half-rounded-rectangle
h-cyl das horizontal-cylinder
lin-cyl disk lined-cylinder
curv-trap curved-trapezoid display
div-rect div-proc divided-rectangle divided-process
tri extract triangle
win-pane internal-storage window-pane
f-circ junction filled-circle
notch-pent loop-limit notched-pentagon
flip-tri manual-file flipped-triangle
sl-rect manual-input sloped-rectangle
docs documents st-doc stacked-document
st-rect procs processes stacked-rectangle
bow-rect stored-data bow-tie-rectangle
cross-circ summary crossed-circle
tag-doc tagged-document
tag-rect tagged-rectangle tag-proc tagged-process
flag paper-tape
odd
lin-doc lined-document
state
choice
note
composite
icon
anchor`.split('\n').map(row => row.split(' '));
const names = new Map(aliases.flatMap(row => row.map(alias => [alias, row[0]])));
export const shapeNames = [...names.keys()];
export const shapeName = name => names.get(name) ?? null;
export const flowOutlineName = name => name === 'round' ? 'rounded' : shapeName(name);

const polygons = {
  diam: [[.5,0],[1,.5],[.5,1],[0,.5]],
  hex: [[.14,0],[.86,0],[1,.5],[.86,1],[.14,1],[0,.5]],
  'lean-r': [[.14,0],[1,0],[.86,1],[0,1]],
  'lean-l': [[0,0],[.86,0],[1,1],[.14,1]],
  'trap-b': [[.14,0],[.86,0],[1,1],[0,1]],
  'trap-t': [[0,0],[1,0],[.86,1],[.14,1]],
  tri: [[.5,0],[1,1],[0,1]],
  'flip-tri': [[0,0],[1,0],[.5,1]],
  'notch-pent': [[.14,0],[.86,0],[1,.23],[1,1],[0,1],[0,.23]],
  'sl-rect': [[0,.24],[1,0],[1,1],[0,1]],
  'notch-rect': [[.14,0],[1,0],[1,1],[0,1],[0,.25]],
  odd: [[0,0],[1,0],[1,1],[0,1],[.16,.5]],
  hourglass: [[0,0],[1,0],[.55,.5],[1,1],[0,1],[.45,.5]],
  bolt: [[1,0],[.4,.44],[1,.44],[0,1],[.60,.56],[0,.56]],
  folder: [[0,0],[.37,0],[.46,.19],[1,.19],[1,1],[0,1]],
};
const box = [[0,0],[1,0],[1,1],[0,1]];
const arc = (cx, cy, rx, ry, start, end, n = 12) => Array.from({ length: n + 1 }, (_, i) => {
  const t = (start + (end - start) * i / n) * Math.PI / 180;
  return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)];
});
const wave = (y, reverse = false) => Array.from({ length: 17 }, (_, i) => {
  const t = (reverse ? 16 - i : i) / 16;
  return [t, y + .09 * Math.sin(t * 2 * Math.PI)];
});

const fixed = new Map([['sm-circ', [14, 14]], ['f-circ', [14, 14]], ['fr-circ', [16, 16]],
  ['cross-circ', [36, 36]], ['anchor', [2, 2]], ['hourglass', [30, 30]], ['bolt', [24, 48]], ['fork', [70, 10]]]);
const fixedSize = (name, direction) => {
  const pair = fixed.get(name);
  return pair && name === 'fork' && ['LR', 'RL'].includes(direction) ? [pair[1], pair[0]] : pair;
};
export function shapeGlyphBox(shape, w, h, direction) {
  const size = fixedSize(shape, direction);
  if (!size) return null;
  const gw = Math.min(w, size[0]), gh = Math.min(h, size[1]);
  return { x: (w - gw) / 2, y: (h - gh) / 2, w: gw, h: gh };
}

export function shapeSize(shape, w, h, direction, hasLabel) {
  const size = fixedSize(shape, direction);
  if (size) return hasLabel ? [size[0] + (w - 12) * 2, size[1] + 12] : size;
  if (['diam', 'choice'].includes(shape)) return [w * 1.7, h * 1.7];
  if (['tri', 'flip-tri'].includes(shape)) return [w * 2, h * 2];
  if (['circle', 'dbl-circ'].includes(shape)) return Array(2).fill(Math.hypot(w, h) + (shape === 'dbl-circ' ? 10 : 0));
  if (['person', 'bang', 'cloud'].includes(shape)) return [w * 1.6, h * 1.7];
  if (['rect', 'rounded', 'state', 'note', 'composite', 'text', 'icon'].includes(shape)) return [w, h];
  return [w + 24, h + 12];
}

// The renderer and router use the same boundary, including sampled arcs and waves.
export function shapeOutline(shape, width, height, direction) {
  const boxOfGlyph = shapeGlyphBox(shape, width, height, direction);
  const { x: dx, y: dy, w, h } = boxOfGlyph ?? { x: 0, y: 0, w: width, h: height };
  let outline = polygons[shape === 'choice' ? 'diam' : shape];
  if (!outline) {
    const r = Math.min(8, h / 2, w / 2), rx = r / w, ry = r / h;
    if (shape === 'note') {
      const fold = Math.min(12, w / 3, h / 3);
      outline = [[0,0],[1-fold/w,0],[1,fold/h],[1,1],[0,1]];
    } else if (['rounded', 'state', 'browser', 'console', 'composite'].includes(shape)) {
      outline = [...arc(1-rx, ry, rx, ry, -90, 0), ...arc(1-rx, 1-ry, rx, ry, 0, 90),
        ...arc(rx, 1-ry, rx, ry, 90, 180), ...arc(rx, ry, rx, ry, 180, 270)];
    } else if (['stadium', 'delay', 'curv-trap'].includes(shape)) {
      const cap = Math.min(.5, h / (2 * w));
      outline = [...arc(1-cap, .5, cap, .5, -90, 90), ...(shape === 'stadium'
        ? arc(cap, .5, cap, .5, 90, 270) : [[0,1], ...(shape === 'curv-trap' ? [[.14,.5]] : []), [0,0]])];
    } else if (['circle','dbl-circ','cross-circ','fr-circ','sm-circ','f-circ','anchor'].includes(shape)) {
      outline = arc(.5,.5,.5,.5,0,360,64).slice(0,-1);
    } else if (['cyl', 'lin-cyl', 'bucket'].includes(shape)) {
      outline = [...arc(.5,.12,.5,.12,180,360), ...arc(.5,.88,shape === 'bucket' ? .38 : .5,.12,0,180)];
    } else if (shape === 'h-cyl') {
      outline = [...arc(.88,.5,.12,.5,-90,90), ...arc(.12,.5,.12,.5,90,270)];
    } else if (shape === 'st-rect' || shape === 'docs') {
      const u = 5 / w, v = 5 / h;
      const ys = shape === 'docs' ? .9 : 1;
      const base = shape === 'docs' ? wave(.9, true).map(([x, y]) => [x * (1 - 2 * u), 2 * v + y * (1 - 2 * v)])
        : [[1 - 2 * u, 1], [0, 1]];
      outline = [[0, 2 * v], [u, 2 * v], [u, v], [2 * u, v], [2 * u, 0], [1, 0], [1, ys * (1 - 2 * v)],
        [1-u, ys * (1-2*v)], [1-u, v + ys * (1-2*v)], [1-2*u, v + ys * (1-2*v)], ...base];
    } else if (['doc', 'lin-doc', 'tag-doc', 'flag'].includes(shape)) {
      outline = [...(shape === 'flag' ? wave(.1) : [[0,0],[1,0]]), ...wave(.9, true)];
    } else if (shape === 'bow-rect') {
      const side = Array.from({ length: 17 }, (_, i) => {
        const t = i / 16;
        return [1 - .075 * Math.sin(Math.PI * t), t];
      });
      outline = [...side, ...side.map(([x,y]) => [x - .925, 1-y])];
    } else if (shape === 'bang' || shape === 'cloud') {
      outline = Array.from({ length: 96 }, (_, i) => {
        const t = i * Math.PI / 48;
        const r = shape === 'cloud' ? .46 + .04 * Math.cos(7 * t) : (i % 8 === 0 ? .5 : .37 + .13 * Math.abs(i % 8 - 4) / 4);
        return [.5 + r * Math.cos(t), .5 + r * Math.sin(t)];
      });
    } else if (shape === 'person') {
      outline = [...arc(.5,.2,.19,.2,130,410,32), [.61,.39],[.80,.44],[.96,.58],[1,.8],[1,1],[0,1],[0,.8],[.04,.58],[.20,.44],[.39,.39]];
    } else outline = box;
  }
  return outline.map(([x,y]) => [dx + x*w,dy + y*h]);
}

export function outlinePort(outline, side, cross) {
  const vertical = side === 'top' || side === 'bottom';
  const axis = vertical ? 0 : 1, other = 1 - axis;
  const coords = outline.map(p => p[axis]);
  const min = Math.min(...coords), max = Math.max(...coords);
  const at = Math.max(min + .001, Math.min(max - .001, cross));
  const hits = [];
  outline.forEach((p, i) => {
    const q = outline[(i + 1) % outline.length];
    if ((p[axis] <= at && q[axis] > at) || (q[axis] <= at && p[axis] > at)) {
      hits.push(p[other] + (q[other] - p[other]) * (at - p[axis]) / (q[axis] - p[axis]));
    }
  });
  const edge = side === 'top' || side === 'left' ? Math.min(...hits) : Math.max(...hits);
  return vertical ? { x: at, y: edge } : { x: edge, y: at };
}
