const allowedTags = new Set(['a', 'g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'tspan', 'defs', 'marker', 'linearGradient', 'stop', 'clipPath', 'title', 'desc']);
const safeAttrs = new Set(('id class x y x1 y1 x2 y2 cx cy r rx ry width height d points dx dy rotate fill fill-opacity fill-rule clip-rule stroke stroke-width stroke-opacity stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit marker-start marker-mid marker-end markerWidth markerHeight markerUnits refX refY orient opacity transform text-anchor dominant-baseline font-family font-size font-weight font-style letter-spacing text-decoration textLength lengthAdjust paint-order viewBox preserveAspectRatio offset stop-color stop-opacity gradientUnits gradientTransform clip-path vector-effect pointer-events role aria-label aria-labelledby aria-describedby').split(' '));

const escapeXml = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]);
function hash(text) {
  let h = 2166136261;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
function validateTag(tag) {
  if (!allowedTags.has(tag)) throw new TypeError(`Unsafe SVG tag: ${tag}`);
  return tag;
}
const linkAttrs = new Set(['href', 'target', 'rel']);
const linkTargets = new Set(['_blank', '_self', '_parent', '_top']);
const blankRel = 'noopener noreferrer';

function safeHref(url) {
  if (typeof url !== 'string' || !url || /[\s\p{Cc}\\]/u.test(url) || url.startsWith('//')) return null;
  const scheme = /^[a-z][a-z\d+.-]*:/i.exec(url)?.[0];
  if (!scheme) return url;
  if (!/^(https?|mailto):$/i.test(scheme) || !URL.canParse(url)) return null;
  return url;
}

function validateLink(attrs) {
  if (!safeHref(attrs.href)) throw new TypeError('Unsafe SVG link href');
  if (attrs.target != null && !linkTargets.has(attrs.target)) throw new TypeError('Unsafe SVG link target');
  if (attrs.target === '_blank' ? attrs.rel !== blankRel : attrs.rel != null) throw new TypeError('Unsafe SVG link rel');
}

function validateAttribute(key, { serialize = false, generated = false, tag } = {}) {
  if (linkAttrs.has(key)) {
    if (tag !== 'a') throw new TypeError(`Unsafe SVG attribute: ${key}`);
    return key;
  }
  const invalid = /^on/i.test(key) || (!generated && !safeAttrs.has(key)) || /^(?:href|xlink:href|style|target|rel)$/i.test(key);
  if (invalid || (serialize && !/^(?:[a-zA-Z][\w:-]*)$/.test(key))) throw new TypeError(`Unsafe SVG attribute: ${key}`);
  return key;
}
function el(tag, attrs = {}, children = []) {
  validateTag(tag);
  const safe = {};
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null) continue;
    validateAttribute(key, { tag });
    safe[key] = value;
  }
  if (tag === 'a') validateLink(safe);
  return { tag, attrs: safe, ...(children?.length ? { children: [...children] } : {}) };
}
function link(href, children, { tooltip, target } = {}) {
  const title = tooltip == null || tooltip === '' ? [] : [{ ...el('title'), text: String(tooltip) }];
  return el('a', { href, target, rel: target === '_blank' ? blankRel : undefined }, [...title, ...children]);
}

const primitive = (tag, attrs, meta) => { const { meta: ignored, ...rest } = attrs || {}; return { ...el(tag, rest), ...(meta ? { meta } : {}) }; };

// Matrix math and text bounds are kept with the scene model so every layout shares the same overflow rules.
const IDENTITY = [1, 0, 0, 1, 0, 0];
const multiply = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const NUMBER = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi;
const radians = (degrees) => degrees * Math.PI / 180;
function parseTransform(value, ink = false) {
  let matrix = IDENTITY;
  const commands = ink ? /(translate|scale|matrix|rotate|skewX|skewY)\(([^)]*)\)/g : /(translate|scale|matrix)\(([^)]*)\)/g;
  for (const [, name, body] of String(value || '').matchAll(commands)) {
    const n = ink ? (body.match(NUMBER) || []).map(Number) : body.split(/[\s,]+/).filter(Boolean).map(Number);
    if (name === 'translate') matrix = multiply(matrix, [1, 0, 0, 1, n[0] || 0, n[1] || 0]);
    else if (name === 'scale') matrix = multiply(matrix, [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0]);
    else if (name === 'rotate') {
      const [angle, x = 0, y = 0] = n;
      const c = Math.cos(radians(angle)), s = Math.sin(radians(angle));
      matrix = multiply(matrix, [c, s, -s, c, x - c * x + s * y, y - s * x - c * y]);
    } else if (name === 'skewX') matrix = multiply(matrix, [1, 0, Math.tan(radians(n[0])), 1, 0, 0]);
    else if (name === 'skewY') matrix = multiply(matrix, [1, Math.tan(radians(n[0])), 0, 1, 0, 0]);
    else if (n.length === 6) matrix = multiply(matrix, n);
  }
  return matrix;
}
const NON_RENDERED = new Set(['defs', 'marker', 'clipPath', 'title', 'desc', 'linearGradient', 'stop']);
const textContent = (node) => `${node.text ?? ''}${(node.children || []).filter(child => child.tag === 'tspan' && Number(child.attrs?.opacity) !== 0).map(textContent).join('')}`;
const paintKeys = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'letter-spacing'];

// Convert SVG endpoint arcs to centre form, then test extrema in transformed axes.
function arcExtent(x, y, endX, endY, [rx, ry, angle, large, sweep], point, [a, b, c, d]) {
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry || (x === endX && y === endY)) return;
  const cos = Math.cos(radians(angle)), sin = Math.sin(radians(angle));
  const dx = (x - endX) / 2, dy = (y - endY) / 2;
  const u = cos * dx + sin * dy, v = -sin * dx + cos * dy;
  const radiusScale = Math.max(1, Math.hypot(u / rx, v / ry));
  rx *= radiusScale; ry *= radiusScale;
  const len = (u / rx) ** 2 + (v / ry) ** 2;
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, 1 / len - 1));
  const cu = factor * rx * (v / ry), cv = -factor * ry * (u / rx);
  const cx = cos * cu - sin * cv + (x + endX) / 2, cy = sin * cu + cos * cv + (y + endY) / 2;
  const start = Math.atan2((v - cv) / ry, (u - cu) / rx);
  const end = Math.atan2((-v - cv) / ry, (-u - cu) / rx);
  const turn = 2 * Math.PI, mod = (value) => (value % turn + turn) % turn;
  const sign = sweep ? 1 : -1, span = mod(sign * (end - start));
  const ux = rx * cos, uy = rx * sin, vx = -ry * sin, vy = ry * cos;
  for (const theta of [Math.atan2(a * vx + c * vy, a * ux + c * uy), Math.atan2(b * vx + d * vy, b * ux + d * uy)]) {
    for (const t of [theta, theta + Math.PI]) {
      if (mod(sign * (t - start)) <= span) point(cx + ux * Math.cos(t) + vx * Math.sin(t), cy + uy * Math.cos(t) + vy * Math.sin(t));
    }
  }
}

const pathArity = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
function pathExtent(value, point, matrix) {
  const source = String(value || '');
  const number = new RegExp(NUMBER.source, 'iy'), flag = /[01]/y, sep = /[\s,]*/y;
  let i = 0, command, previous, control, x = 0, y = 0, startX = 0, startY = 0;
  const skip = () => { sep.lastIndex = i; sep.exec(source); i = sep.lastIndex; };
  while (i < source.length) {
    skip();
    if (/[MLHVCSQTAZ]/i.test(source[i] || '')) command = source[i++];
    if (!command || i === source.length && command.toUpperCase() !== 'Z') break;
    const kind = command.toUpperCase(), relative = command !== kind;
    const args = [];
    for (let j = 0; j < pathArity[kind]; j++) {
      skip();
      const token = kind === 'A' && (j === 3 || j === 4) ? flag : number;
      token.lastIndex = i;
      const match = token.exec(source);
      if (!match) return;
      args.push(Number(match[0])); i = token.lastIndex;
    }
    const px = (n) => args[n] + (relative ? x : 0), py = (n) => args[n] + (relative ? y : 0);
    const end = args.length - 2;
    const nx = kind === 'Z' ? startX : kind === 'V' ? x : px(kind === 'H' ? 0 : end);
    const ny = kind === 'Z' ? startY : kind === 'H' ? y : py(kind === 'V' ? 0 : end + 1);
    if (kind === 'M') {
      startX = nx; startY = ny;
      command = relative ? 'l' : 'L';
    } else {
      point(x, y); point(nx, ny);
      // The curve lies inside the hull of its endpoints and control points.
      if (kind === 'S' || kind === 'T') {
        const reflect = (kind === 'S' ? ['C', 'S'] : ['Q', 'T']).includes(previous);
        control = reflect ? [2 * x - control[0], 2 * y - control[1]] : [x, y];
        point(...control);
      }
      if (kind === 'C') point(px(0), py(1));
      if (kind === 'C' || kind === 'S' || kind === 'Q') {
        control = [px(end - 2), py(end - 1)];
        point(...control);
      }
      if (kind === 'A') arcExtent(x, y, nx, ny, args, point, matrix);
      if (kind === 'Z') command = null;
    }
    previous = kind; x = nx; y = ny;
  }
}

function sceneExtent(scene, measure, blockPadding, ink = false) {
  let box = null;
  const grow = (x, y) => { box = box ? { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) } : { x0: x, y0: y, x1: x, y1: y }; };
  let stroke = 0;
  const visit = (node, parent, inherited = {}) => {
    if (!node || NON_RENDERED.has(node.tag) || Number(node.attrs?.opacity) === 0) return;
    const matrix = multiply(parent, parseTransform(node.attrs?.transform, ink));
    const attrs = ink ? { ...inherited, ...node.attrs } : node.attrs || {};
    const [a, b, c, d, e, f] = matrix;
    const point = (x, y) => grow(a * x + c * y + e, b * x + d * y + f);
    const rect = (x0, y0, x1, y1) => {
      point(x0, y0); point(x1, y0); point(x0, y1); point(x1, y1);
    };
    const text = node.tag === 'text' ? (ink ? textContent(node) : String(node.text ?? '')) : '';
    const hasStroke = ink && attrs.stroke != null && !['none', 'transparent'].includes(attrs.stroke) && Number(attrs['stroke-opacity']) !== 0;
    const hasFill = !ink || !['none', 'transparent'].includes(attrs.fill) && Number(attrs['fill-opacity']) !== 0;
    let drawn = false;
    if (text.trim() && (hasFill || hasStroke)) {
      const size = Number(attrs['font-size']) || 12;
      const width = ink && attrs.textLength != null ? Number(attrs.textLength) :
        measure(text, size, Number(attrs['font-weight']) || 400) + (ink ? (Number(attrs['letter-spacing']) || 0) * [...text].length : 0);
      const x = (Number(attrs.x) || 0) + (Number(attrs.dx) || 0), y = (Number(attrs.y) || 0) + (Number(attrs.dy) || 0);
      const left = attrs['text-anchor'] === 'middle' ? x - width / 2 : attrs['text-anchor'] === 'end' ? x - width : x;
      const baseline = attrs['dominant-baseline'];
      const [top, bottom] = ['middle', 'central'].includes(baseline) ? [y - size / 2, y + size / 2] : ['hanging', 'text-before-edge'].includes(baseline) ? [y, y + size] : [y - size * 0.8, y + size * 0.2];
      const y0 = top - blockPadding, y1 = bottom + blockPadding;
      rect(left, y0, left + width, y1);
      drawn = true;
    } else if (ink && (hasFill || hasStroke || attrs['marker-start'] || attrs['marker-end'] || attrs['marker-mid'])) {
      const n = (key) => Number(attrs[key]) || 0;
      drawn = true;
      switch (node.tag) {
        case 'rect': rect(n('x'), n('y'), n('x') + n('width'), n('y') + n('height')); break;
        case 'line':
          drawn = hasStroke || !!(attrs['marker-start'] || attrs['marker-end']);
          if (drawn) { point(n('x1'), n('y1')); point(n('x2'), n('y2')); }
          break;
        case 'circle': case 'ellipse': {
          const x = n('cx'), y = n('cy'), rx = n(node.tag === 'circle' ? 'r' : 'rx'), ry = n(node.tag === 'circle' ? 'r' : 'ry');
          const cx = a * x + c * y + e, cy = b * x + d * y + f;
          const w = Math.hypot(a * rx, c * ry), h = Math.hypot(b * rx, d * ry);
          grow(cx - w, cy - h); grow(cx + w, cy + h);
          break;
        }
        case 'polygon': case 'polyline': {
          const points = (String(attrs.points || '').match(NUMBER) || []).map(Number);
          for (let i = 1; i < points.length; i += 2) point(points[i - 1], points[i]);
          break;
        }
        case 'path': pathExtent(attrs.d, point, matrix); break;
        default: drawn = false;
      }
    }
    if (drawn && hasStroke) {
      // Largest stretch of the transform (including combinations of rotation and non-uniform scale).
      const scale = attrs['vector-effect'] === 'non-scaling-stroke' ? 1 : (Math.hypot(a + d, b - c) + Math.hypot(a - d, b + c)) / 2;
      stroke = Math.max(stroke, (Number(attrs['stroke-width'] ?? 1) || 0) * scale);
    }
    if (!ink || node.tag !== 'text') {
      const paint = ink ? Object.fromEntries(paintKeys.filter(key => key in attrs).map(key => [key, attrs[key]])) : inherited;
      for (const child of node.children || []) visit(child, matrix, paint);
    }
  };
  for (const child of scene.children) visit(child, IDENTITY);
  return ink && box ? { ...box, stroke } : box;
}
function containText(scene, measure, { blockPadding = 0 } = {}) {
  const box = sceneExtent(scene, measure, blockPadding);
  if (!box) return scene;
  const beyond = (value) => value > 0.5 ? Math.ceil(value) : 0;
  const left = beyond(-box.x0), top = beyond(-box.y0), right = beyond(box.x1 - scene.width), bottom = beyond(box.y1 - scene.height);
  if (!left && !top && !right && !bottom) return scene;
  const anchor = scene.anchor ? { ...scene.anchor, x: scene.anchor.x + left, y: scene.anchor.y + top } : scene.anchor;
  return { ...scene, width: scene.width + left + right, height: scene.height + top + bottom, children: left || top ? [el('g', { transform: `translate(${left} ${top})` }, scene.children)] : scene.children, ...(anchor ? { anchor } : {}), overflow: { left, top, right, bottom } };
}

function cropInk(scene, measure) {
  const box = sceneExtent(scene, measure, 0, true);
  if (!box) return scene;
  const pad = 1 + box.stroke / 2;
  const x = pad - box.x0, y = pad - box.y0;
  const anchor = scene.anchor;
  return { ...scene, width: box.x1 - box.x0 + 2 * pad, height: box.y1 - box.y0 + 2 * pad,
    children: [el('g', { transform: `translate(${x} ${y})` }, scene.children)],
    ...(anchor ? { anchor: { ...anchor, x: anchor.x + x, y: anchor.y + y } } : {}) };
}

export { el, link, safeHref, linkTargets, validateLink, primitive, hash, escapeXml, containText, cropInk, validateTag, validateAttribute, allowedTags, safeAttrs };
