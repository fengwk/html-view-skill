import { resolveIconRef } from '../core/icons.js';
import { boardLook, drawEdge, drawFrame, drawLabel, frameTitle, markers, measureLabel, surfaceAt, titleRect } from './board-paint.js';
import { routeBoard } from './board-route.js';
import { TRACK_CLEAR, TRACK_GAP } from './graph-route.js';
import { normalizeLabel } from './label.js';
import { presentation } from './presentation.js';
import { FONT, appearance, error, maxWidthOf, textBlock, warning, wrapText } from './support.js';

const GAP = 20, PAD = 12, MARGIN = 24, ICON = 16, ICON_GAP = 6;
const NODE_LABEL_MAX = 240;
const shapes = [
  ['(((', ')))', 'doublecircle'], ['((', '))', 'circle'], ['([', '])', 'stadium'], ['(', ')', 'round'],
  ['[[', ']]', 'subroutine'], ['[(', ')]', 'cylinder'], ['[/', '/]', 'leanRight'], ['[\\', '\\]', 'leanLeft'],
  ['[/', '\\]', 'trapezoid'], ['[\\', '/]', 'inverseTrapezoid'], ['[', ']', 'square'],
  ['{{', '}}', 'hexagon'], ['{', '}', 'diamond'], ['>', ']', 'notch'], ['<[', ']>', 'arrow'],
];
const link = /^(?:[xo<]?(?:--+[-xo>]|==+[=xo>]|-?\.+-[xo>]?)|~{3,}|==|<--)/;
const arrowTypes = { '>': 'point', '<': 'point', o: 'circle', x: 'cross' };
const directions = new Set(['left', 'right', 'up', 'down', 'x', 'y']);

function parse(body, { lang, firstLine = 2, params = '', header = 'block' }) {
  const root = { children: [] }, stack = [root], nodes = new Map(), edges = [], errors = [];
  const look = presentation({ lang }), notices = new Map(), styleLines = new Map();
  let defaultStyleLine;
  const note = issue => { if (!notices.has(issue.message)) notices.set(issue.message, issue); };
  const ignoreStyle = (at, zh, en) => note(warning('IGNORED_STYLE', lang, at, zh, en, '使用支持的状态样式', 'Use supported status styling'));
  const resolveIcon = (ref, at) => {
    const icon = resolveIconRef(ref);
    if (!icon) note(warning('IGNORED_ASSET', lang, at, `未知图标 ${ref}`, `Unknown icon ${ref}`, '使用内置图标', 'Use a supported icon'));
    return icon;
  };
  const normalize = (raw, at) => {
    let icon;
    const source = raw.replace(/(?<![\w:/.-])(?:logos|mdi|tabler|simple-icons):[a-z\d-]+/gi, ref => {
      const resolved = resolveIcon(ref, at);
      icon ??= resolved;
      return '';
    });
    const label = normalizeLabel(source, { lang, line: at });
    label.diagnostics.forEach(note);
    return { label: label.text, icon: label.icon ?? icon };
  };
  let anonymous = 0, reserved = 0, line = firstLine, column = 1;
  const bad = (zh, en) => errors.push(error(lang, line, zh, en, '检查 block 语法或拆分图', 'Check block syntax or split the diagram', column));
  if (body.length + params.length > 200_000) {
    bad('块图源码过长', 'Block source is too long');
    return { model: null, errors };
  }
  // The registry separates the header from its body; Mermaid permits statements on either line.
  for (const [i, raw] of [params, ...body.split('\n')].entries()) {
    line = firstLine + i - 1;
    let rest = raw;
    const take = n => { rest = rest.slice(n); };
    const ws = () => take(rest.match(/^\s*/)[0].length);
    const readSpan = () => {
      const m = /^:(\d+)/.exec(rest);
      if (m) take(m[0].length);
      return m ? Number(m[1]) : 1;
    };
    const readNode = () => {
      const m = /^(?![-.])[^()[\]{}<>:=;"\s~]+?(?=$|[()[\]{}<>:=;"\s~]|--|-?\.+-|%%)/.exec(rest);
      if (!m) return null;
      const id = m[0];
      take(id.length);
      const node = { id, line };
      const open = shapes.find(([start]) => rest.startsWith(start))?.[0];
      if (open) {
        take(open.length);
        const quoted = /^\s*"([^"]*)"\s*/.exec(rest);
        let shape;
        if (quoted) {
          take(quoted[0].length);
          shape = shapes.find(([start, end]) => start === open && rest.startsWith(end));
          // Mermaid accepts mismatched shape pairs and draws an ordinary block.
          if (!shape) {
            const close = /^(?:\)\)\)|\)\)|\)\]|\]\)|\]\]|\}\}|[)\]}])/.exec(rest);
            if (close) shape = [open, close[0], 'square'];
          }
          node.label = quoted[1];
        } else {
          shape = shapes.find(([start, end]) => start === open && rest.includes(end));
          if (shape) {
            const end = rest.indexOf(shape[1]);
            node.label = rest.slice(0, end).trim();
            take(end);
          }
        }
        if (!shape) return null;
        take(shape[1].length);
        node.shape = shape[2];
        if (node.shape === 'arrow') {
          const dirs = /^\s*\(([^)]*)\)/.exec(rest);
          node.directions = dirs?.[1].split(/[\s,]+/).filter(Boolean);
          if (!node.directions?.length || node.directions.some(d => !directions.has(d))) return null;
          take(dirs[0].length);
        }
      }
      const suffix = () => {
        const icon = /^::icon\(\s*([^()]+?)\s*\)/i.exec(rest);
        const classes = /^:::([\w-]+(?:,[\w-]+)*)/.exec(rest);
        if (icon) { node.iconRef = icon[1]; take(icon[0].length); }
        else if (classes) {
          styleLines.set(id, styleLines.get(id) ?? line);
          look.addClasses(id, classes[1].split(','), line);
          take(classes[0].length);
        }
        return icon || classes;
      };
      while (suffix()) { /* modifiers may appear before or after the span */ }
      node.span = readSpan();
      while (suffix()) { /* consume modifiers following the span */ }
      return node.span > 0 && node.span <= 2000 ? node : null;
    };
    const insert = (node, group) => {
      const old = nodes.get(node.id);
      if (old) {
        if (node.label !== undefined && !old.children) Object.assign(old, { label: node.label, labelLine: node.line, shape: node.shape, directions: node.directions });
        if (node.iconRef) Object.assign(old, { iconRef: node.iconRef, iconLine: node.line });
      } else {
        nodes.set(node.id, node);
        group.children.push(node);
      }
    };
    while (rest) {
      ws();
      column = raw.length - rest.length + 1 + (i === 0 ? Math.max(0, header.indexOf(params)) : 0);
      if (!rest || /^%%(?!\{)/.test(rest)) break;
      if (rest[0] === ';') { take(1); continue; }
      const styled = /^(style|class)\s+([^\s,]+(?:\s*,\s*[^\s,]+)*)\s+(.+)$/i.exec(rest);
      // Mermaid's block parser accepts this typo as CSS and the browser ignores it.
      if (styled?.[1].toLowerCase() === 'style' && /^[\w-]+#[\da-f]+;?\s*$/i.test(styled[3])) {
        ignoreStyle(line, '已忽略缺少冒号的块图样式', 'Ignored a block style missing its colon');
        break;
      }
      if (styled && /^style$/i.test(styled[1])) {
        for (const id of styled[2].split(/\s*,\s*/)) {
          look.accept(`style ${id} ${styled[3]}`, line);
          styleLines.set(id, styleLines.get(id) ?? line);
        }
        break;
      }
      if (look.accept(rest, line)) {
        if (styled) for (const id of styled[2].split(/\s*,\s*/)) styleLines.set(id, styleLines.get(id) ?? line);
        if (/^classDef\s+default\b/i.test(rest)) defaultStyleLine ??= line;
        break;
      }
      if (/^interpolate\s/i.test(rest)) {
        ignoreStyle(line, '已忽略插值样式；连线使用网格走线', 'Ignored interpolation; edges follow grid routes');
        break;
      }
      const group = stack.at(-1);
      const cols = /^columns\s+(auto|\d+)(?=\s|;|$)/.exec(rest);
      const space = /^space(?=[:;\s]|$)/.exec(rest);
      const begin = /^block(?:-beta)?(?=[:;\s]|$)/.exec(rest);
      const end = /^end(?=[;\s]|$)/.exec(rest);
      if (cols) {
        take(cols[0].length);
        const count = cols[1] === 'auto' ? 0 : Number(cols[1]);
        if (count > 2000 || (count === 0 && cols[1] !== 'auto')) { bad('无效的列数', 'Invalid column count'); break; }
        group.columns = count;
      } else if (space) {
        take(space[0].length);
        const span = readSpan();
        if (span > 2000) { bad('占位过宽', 'Space span is too large'); break; }
        reserved += span;
        if (reserved > 20_000) {
          bad('占位单元格过多', 'Too many space cells');
          return { model: null, errors };
        }
        group.children.push({ space: true, span });
      } else if (begin) {
        take(begin[0].length);
        const named = rest[0] === ':' && !/^:\d/.test(rest);
        if (named) take(1);
        const node = named ? readNode() : { id: `:block${++anonymous}`, line, span: readSpan() };
        if (!node || !node.span || node.span > 2000 || stack.length > 32 || nodes.has(node.id)) {
          bad('无效、重复或嵌套过深的复合块', 'Invalid, duplicate or excessively nested composite block'); break;
        }
        node.children = [];
        insert(node, group);
        stack.push(node);
      } else if (end) {
        take(end[0].length);
        if (stack.length === 1) { bad('end 没有对应的 block', 'No matching block for end'); break; }
        stack.pop();
      } else {
        let from = readNode();
        if (!from) { bad('无法识别块图语句', 'Unrecognized block statement'); break; }
        insert(from, group);
        ws();
        while (rest) {
          const labeled = /^([xo<]?(?:--|==|-\.))\s*"([^"]*)"\s*/.exec(rest);
          const op = link.exec(labeled ? rest.slice(labeled[0].length) : rest);
          if (!op) break;
          take((labeled?.[0].length ?? 0) + op[0].length);
          ws();
          const to = readNode();
          if (!to) { bad('连线缺少终点', 'Missing edge endpoint'); break; }
          insert(to, group);
          const symbol = op[0];
          const legacyLabel = !labeled && /^\s+:\s+(.+)$/.exec(rest);
          if (legacyLabel) take(legacyLabel[0].length);
          edges.push({ from: from.id, to: to.id, line, label: labeled?.[2] ?? legacyLabel?.[1] ?? '',
            arrowStart: arrowTypes[symbol[0]], arrowEnd: arrowTypes[symbol.at(-1)],
            thickness: symbol.includes('==') ? 2.5 : 1.5,
            pattern: symbol.includes('.-') ? 'dotted' : 'solid' });
          if (nodes.size > 2000 || edges.length > 500) {
            bad('块或连线过多', 'Too many blocks or edges');
            return { model: null, errors };
          }
          from = to;
          ws();
        }
      }
      if (nodes.size > 2000) { bad('块过多', 'Too many blocks'); return { model: null, errors }; }
    }
  }
  if (stack.length > 1) {
    line = stack.at(-1).line; column = 1;
    bad('复合块缺少 end', 'Composite block is missing end');
  }
  if (!nodes.size && !root.children.length && !errors.length) {
    line = firstLine - 1; column = 1;
    bad('块图为空', 'Empty block diagram');
  }
  errors.push(...look.diagnostics());
  for (const node of nodes.values()) {
    if (node.label !== undefined) Object.assign(node, normalize(node.label, node.labelLine ?? node.line));
    if (node.iconRef) node.icon = resolveIcon(node.iconRef, node.iconLine ?? node.line) ?? node.icon;
    const status = look.statusOf(node.id);
    if (status && node.shape === 'arrow' && !node.children) {
      ignoreStyle(styleLines.get(node.id) ?? defaultStyleLine ?? node.line, '块箭头不应用自定义样式', 'Block arrows do not apply custom styling');
    } else node.status = status;
    node.link = look.linkOf(node.id);
  }
  edges.forEach((edge, index) => Object.assign(edge, normalize(edge.label, edge.line), { status: look.edgeStatusOf(index) }));
  return { model: { root, edges, nodeCount: nodes.size }, errors: [...errors, ...notices.values()] };
}

// Measure inside out; place outside in. Each container owns its tracks and row heights.
function grid(group, measure, pad, spacing) {
  const gaps = spacing.get(group) ?? newGaps();
  const rows = [], columns = group.columns || Infinity;
  let col = 0, occupied = 0, unit = 72, row;
  const currentRow = () => row ??= { h: 36, cells: [] };
  const advance = span => {
    col += span;
    occupied = Math.max(occupied, col);
    if (col >= columns) { rows.push(row); row = undefined; col = 0; }
  };
  for (const node of group.children) {
    if (node.space) {
      // Spaces are individual empty cells, including on the next row after a wrap.
      for (let left = node.span; left > 0;) {
        currentRow();
        const step = Math.min(left, columns - col);
        advance(step);
        left -= step;
      }
      continue;
    }
    const inner = node.children ? grid(node, measure, pad, spacing) : null;
    let cell, w, h;
    if (inner) {
      // A group's title sits in its top-left corner and replaces the top padding.
      const title = frameTitle({ title: node.label ?? '', icon: node.icon }, measure);
      const inset = inner.gaps.inset.map((gap, i) => Math.max(gap, i === 0 && title.band ? title.band : pad));
      const [top, right, bottom, left] = inset;
      w = Math.max(title.minW, inner.w + left + right);
      h = inner.h + top + bottom;
      cell = { ...node, col, inner, title, inset };
    } else {
      const label = node.label ?? node.id;
      // Measure the label before sizing its tracks; neither a narrow viewport nor a span forces an early wrap.
      const lines = label.trim() ? wrapText(label, NODE_LABEL_MAX - iconWidth(node.icon, [label]), FONT.body, measure) : [];
      const textW = maxWidthOf(lines, FONT.body, measure) + iconWidth(node.icon, lines);
      const textH = Math.max(lines.length * 18, node.icon ? ICON : 0);
      w = textW + 28;
      h = textH + 20;
      const compact = ['diamond', 'circle', 'doublecircle'].includes(node.shape);
      if (compact) {
        w = h = Math.ceil(node.shape === 'diamond' ? textW + textH + 24 : Math.hypot(textW, textH) + 24);
      } else if (node.shape === 'arrow') {
        w += 28;
        h += 24;
      } else if (node.shape === 'cylinder') h += 12;
      else if (node.shape && !['square', 'round', 'stadium'].includes(node.shape)) w += 20;
      cell = { ...node, col, lines, font: FONT.body, textH, ...(compact ? { diameter: w } : {}) };
    }
    currentRow().cells.push(cell);
    row.h = Math.max(row.h, h);
    unit = Math.max(unit, Math.ceil((w - (node.span - 1) * GAP) / node.span));
    occupied = Math.max(occupied, col + node.span);
    // The block can extend past the last track, but its overflow never shifts the next row.
    advance(Math.min(node.span, columns - col));
  }
  if (row) rows.push(row);
  const xGaps = Array.from({ length: Math.max(0, occupied - 1) }, (_, i) => gaps.x.get(i) ?? GAP);
  const yGaps = rows.slice(1).map((_, i) => gaps.y.get(i) ?? GAP);
  return { group, gaps, rows, xGaps, yGaps, columns: occupied,
    w: occupied * unit + sum(xGaps), h: sum(rows.map(row => row.h)) + sum(yGaps) };
}

const sum = values => values.reduce((a, b) => a + b, 0);
const newGaps = () => ({ x: new Map(), y: new Map(), inset: [0, 0, 0, 0] });

function place(grid, x, y, width, nodes, frames, corridors, parent, outline) {
  if (!grid.columns) return;
  const unit = (width - sum(grid.xGaps)) / grid.columns;
  const xs = [x];
  const corridor = (axis, index, start, size, lo, hi, inset = false) => {
    if (size > 0) corridors.push({ group: grid.group, axis, index, start, size, lo, hi, inset });
  };
  for (const [i, gap] of grid.xGaps.entries()) {
    corridor('x', i, xs[i] + unit, gap, y, y + grid.h);
    xs.push(xs[i] + unit + gap);
  }
  if (outline) {
    corridor('y', 0, outline.y, y - outline.y, x, x + width, true);
    corridor('x', 1, x + width, outline.x + outline.w - x - width, y, y + grid.h, true);
    corridor('y', 2, y + grid.h, outline.y + outline.h - y - grid.h, x, x + width, true);
    corridor('x', 3, outline.x, x - outline.x, y, y + grid.h, true);
  }
  for (const [r, row] of grid.rows.entries()) {
    for (const cell of row.cells) {
      const end = cell.col + cell.span - 1;
      const box = { ...cell, x: xs[cell.col], y, w: xs[end] - xs[cell.col] + unit, h: row.h, ...(parent ? { parent } : {}) };
      if (cell.diameter) {
        box.x += (box.w - cell.diameter) / 2;
        box.y += (box.h - cell.diameter) / 2;
        box.w = box.h = cell.diameter;
      } else if (!cell.inner && cell.shape === 'arrow' && !cell.textH) {
        box.x += (box.w - 28) / 2;
        box.y += (box.h - 28) / 2;
        box.w = box.h = 28;
      }
      nodes.set(box.id, box);
      if (box.inner) {
        frames.push(box);
        const [top, right, , left] = cell.inset;
        place(box.inner, box.x + left, y + top, box.w - left - right, nodes, frames, corridors, box.id, box);
      }
    }
    const gap = grid.yGaps[r] ?? 0;
    corridor('y', r, y + row.h, gap, x, x + width);
    y += row.h + gap;
  }
}

// Reserve room for simultaneous parallel runs and for any plate centred in the gutter.
function widenCorridors(corridors, routes, relations, nodes, spacing) {
  let changed = false;
  for (const { group, axis, index, start, size, lo, hi, inset } of corridors) {
    const along = axis === 'x' ? 'y' : 'x', span = axis === 'x' ? 'w' : 'h', end = start + size;
    const inside = coord => start < coord && coord < end;
    let required = size;
    // A plate too wide for a facing gap can otherwise force a detour before we see its demand.
    if (!inset) for (const { from, to, label } of relations) {
      if (!label || label[span] + 2 * TRACK_CLEAR <= required) continue;
      const crossSpan = axis === 'x' ? 'h' : 'w';
      const a = nodes.get(from), b = nodes.get(to);
      const [first, second] = a[axis] < b[axis] ? [a, b] : [b, a];
      if (Math.abs(first[axis] + first[span] - start) < .01 && Math.abs(second[axis] - end) < .01 &&
          Math.min(hi, a[along] + a[crossSpan], b[along] + b[crossSpan]) > Math.max(lo, a[along], b[along])) {
        required = label[span] + 2 * TRACK_CLEAR;
      }
    }
    const events = [];
    for (const { points, labelRect: label } of routes) {
      if (label && inside(label[axis] + label[span] / 2)) {
        const crossSpan = axis === 'x' ? 'h' : 'w', at = label[along] + label[crossSpan] / 2;
        if (lo <= at && at <= hi) required = Math.max(required, label[span] + 2 * TRACK_CLEAR);
      }
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        if (a[axis] !== b[axis] || !inside(a[axis])) continue;
        const first = Math.max(lo, Math.min(a[along], b[along])), last = Math.min(hi, Math.max(a[along], b[along]));
        if (last > first) events.push([first, 1], [last, -1]);
      }
    }
    let tracks = 0;
    for (const [, delta] of events.sort(([a, da], [b, db]) => a - b || da - db)) {
      tracks += delta;
      if (tracks > 0) required = Math.max(required, 2 * TRACK_CLEAR + (tracks - 1) * TRACK_GAP);
    }
    if (required <= size + .01) continue;
    const gaps = spacing.get(group) ?? newGaps();
    spacing.set(group, gaps);
    if (inset) gaps.inset[index] = Math.ceil(required);
    else gaps[axis].set(index, Math.ceil(required));
    changed = true;
  }
  return changed;
}

const polygons = {
  diamond: [[.5, 0], [1, .5], [.5, 1], [0, .5]],
  hexagon: [[.13, 0], [.87, 0], [1, .5], [.87, 1], [.13, 1], [0, .5]],
  notch: [[0, 0], [1, 0], [1, 1], [0, 1], [.13, .5]],
  leanRight: [[.13, 0], [1, 0], [.87, 1], [0, 1]],
  leanLeft: [[0, 0], [.87, 0], [1, 1], [.13, 1]],
  trapezoid: [[.13, 0], [.87, 0], [1, 1], [0, 1]],
  inverseTrapezoid: [[0, 0], [1, 0], [.87, 1], [.13, 1]],
};

function outline(box) {
  let points = polygons[box.shape];
  if (box.shape === 'arrow') {
    const dirs = box.directions;
    const sides = ['up', 'right', 'down', 'left'];
    const active = sides.map((dir, i) => dirs.includes(dir) || dirs.includes(i % 2 ? 'x' : 'y'));
    const dx = Math.min(.22, 16 / box.w), dy = Math.min(.24, 14 / box.h);
    const [top, right, bottom, left] = active.map((on, i) => on ? [dy, dx][i % 2] : 0);
    const corners = [[left, top], [1 - right, top], [1 - right, 1 - bottom], [left, 1 - bottom]];
    const heads = [
      [[.24, top], [.5, 0], [.76, top]], [[1 - right, .24], [1, .5], [1 - right, .76]],
      [[.76, 1 - bottom], [.5, 1], [.24, 1 - bottom]], [[left, .76], [0, .5], [left, .24]],
    ];
    const vertical = active[0] || active[2], horizontal = active[1] || active[3];
    if (vertical && !horizontal) {
      const inset = Math.min(.28, 12 / box.w);
      corners.forEach((p, i) => { p[0] = i === 0 || i === 3 ? inset : 1 - inset; });
      heads[0][0][0] = 0; heads[0][2][0] = 1;
      heads[2][0][0] = 1; heads[2][2][0] = 0;
    } else if (horizontal && !vertical) {
      const inset = Math.min(.24, 12 / box.h);
      corners.forEach((p, i) => { p[1] = i < 2 ? inset : 1 - inset; });
      heads[1][0][1] = 0; heads[1][2][1] = 1;
      heads[3][0][1] = 1; heads[3][2][1] = 0;
    }
    points = corners.flatMap((point, i) => {
      if (!active[i]) return [point];
      const next = corners[(i + 1) % 4], head = heads[i], axis = i % 2;
      if (horizontal && vertical) return [point, ...head];
      const shoulder = (p, corner) => p.map((v, k) => k === axis ? v : corner[k]);
      // The shaft meets the base of the head at a square shoulder.
      return [point, shoulder(head[0], point), ...head, shoulder(head[2], next)];
    });
  }
  return points?.map(([x, y]) => [box.x + x * box.w, box.y + y * box.h]);
}

const center = b => [b.x + b.w / 2, b.y + b.h / 2];
const roundShape = b => b.shape === 'circle' || b.shape === 'doublecircle';

// A self link leaves the right side and comes back through the top.
function loop(box) {
  const [cx, cy] = center(box), right = box.x + box.w, top = box.y;
  return [{ x: right, y: cy }, { x: right + 12, y: cy }, { x: right + 12, y: top - 12 }, { x: cx, y: top - 12 }, { x: cx, y: top }];
}

function layout(model, { width, lang, measure }, info) {
  const padding = info.config?.block?.padding;
  const validPadding = Number.isFinite(padding) && padding >= 0 && padding <= 2000;
  const pad = validPadding ? padding : PAD;
  const spacing = new Map(), edges = [], errors = [];
  if (padding !== undefined && !validPadding) {
    errors.push(warning('IGNORED_CONFIG', lang, info.configLines?.['block.padding'] ?? info.headerLine ?? 1,
      '已忽略无效的 block.padding', 'Ignored invalid block.padding', '使用 0 到 2000 之间的数值', 'Use a number from 0 to 2000'));
  }
  const labels = model.edges.map(edge => measureLabel(edge.label, measure, edge.icon));
  const relations = model.edges.flatMap((edge, id) => edge.from === edge.to ? [] : [{ id, from: edge.from, to: edge.to, ...(labels[id] ? { label: labels[id] } : {}) }]);
  let nodes, frames, leaves, naturalWidth, height, routed;
  for (let pass = 0; pass < 3; pass++) {
    const plan = grid(model.root, measure, pad, spacing), corridors = [];
    nodes = new Map(); frames = [];
    place(plan, MARGIN, MARGIN, plan.w, nodes, frames, corridors);
    leaves = [...nodes.values()].filter(box => !box.inner);
    naturalWidth = plan.w + 2 * MARGIN; height = plan.h + 2 * MARGIN;
    routed = routeBoard({
      width: naturalWidth, height,
      nodes: leaves,
      frames: frames.map(frame => ({ ...frame, titleRect: titleRect(frame, frame.title) })),
      edges: relations,
    });
    if (pass === 2 || !widenCorridors(corridors, routed.edges, relations, nodes, spacing)) break;
  }
  const routes = new Map(routed.edges.map(route => [route.id, route]));
  model.edges.forEach((edge, id) => {
    const route = routes.get(id), label = labels[id];
    if (edge.from === edge.to) {
      const points = loop(nodes.get(edge.from));
      const rect = label && { x: points[2].x + 4, y: points[2].y - label.h / 2, w: label.w, h: label.h };
      edges.push({ ...edge, points, label: rect ? { rect, lines: label.lines } : null });
    } else if (route) {
      edges.push({ ...edge, points: route.points, label: label && route.labelRect ? { rect: route.labelRect, lines: label.lines } : null });
    } else {
      errors.push(error(lang, edge.line, `无法为 ${edge.from} → ${edge.to} 留出连线空间`, `No clear route for ${edge.from} → ${edge.to}`, '增加 space 留出走线空间', 'Add space cells to make room for the edge'));
    }
  });
  if (naturalWidth > 2 * width || model.nodeCount > 60) {
    errors.push(warning('LARGE_DIAGRAM', lang, info.headerLine || 1, '块图较大，可滚动查看', 'Large block diagram; scroll to view it', '考虑拆分块图', 'Consider splitting the diagram'));
  }
  return { width: naturalWidth, height, pad, nodes: leaves, frames, edges, errors };
}

function drawShape(ctx, node, style) {
  const { x, y, w, h, shape } = node, [cx, cy] = center(node);
  if (roundShape(node)) {
    const oval = (rx, ry, attrs) => ctx.el('ellipse', { cx, cy, rx, ry, ...attrs });
    return [oval(w / 2, h / 2, style), ...(shape === 'doublecircle' ? [oval(w / 2 - 4, h / 2 - 4, { ...style, fill: 'none' })] : [])];
  }
  const points = outline(node);
  if (points) return [ctx.el('polygon', { points: points.map(p => p.join(',')).join(' '), ...style })];
  if (shape === 'cylinder') {
    const ry = 7;
    return [ctx.path(`M${x} ${y + ry} A${w / 2} ${ry} 0 0 1 ${x + w} ${y + ry} V${y + h - ry} A${w / 2} ${ry} 0 0 1 ${x} ${y + h - ry} Z`, style),
      ctx.path(`M${x} ${y + ry} A${w / 2} ${ry} 0 0 0 ${x + w} ${y + ry}`, { ...style, fill: 'none' })];
  }
  const rx = shape === 'stadium' ? Math.min(w, h) / 2 : shape === 'round' ? 10 : 0;
  return [ctx.rect(x, y, w, h, { ...style, rx }), ...(shape === 'subroutine' ? [10, w - 10].map(dx => ctx.path(`M${x + dx} ${y} V${y + h}`, { stroke: style.stroke, fill: 'none' })) : [])];
}

function iconWidth(icon, lines) { return icon ? ICON + (lines.length ? ICON_GAP : 0) : 0; }

function caption(ctx, { icon, x, y, lines, font, lineHeight }) {
  const width = iconWidth(icon, lines);
  const text = textBlock(ctx, { x: x + width / 2, y, lines, font, lineHeight });
  if (!icon) return text;
  const [vx, vy, w, h] = icon.viewBox.split(/\s+/).map(Number), scale = ICON / Math.max(w, h);
  const textWidth = maxWidthOf(lines, font, (value, f) => ctx.measure(value, f.size, f.weight));
  const ix = x - (width + textWidth) / 2 + (ICON - w * scale) / 2;
  const iy = y - h * scale / 2;
  const color = ctx.color('fg'), stroke = icon.set === 'tabler';
  const glyph = ctx.el('g', { transform: `translate(${ix} ${iy}) scale(${scale}) translate(${-vx} ${-vy})`,
    fill: stroke ? 'none' : color, stroke: stroke ? color : 'none', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
  icon.elements.map(({ tag, attrs }) => ctx.shape(tag, attrs)));
  return ctx.el('g', {}, [glyph, text]);
}

const markKinds = { point: 'arrow', circle: 'circle', cross: 'cross' };

function scene(g, ctx) {
  const ink = ctx.color('muted'), bg = ctx.design.bg, nodeFill = appearance(ctx).node;
  const look = boardLook(ctx), marks = markers(ctx);
  const attachLink = (node, shape) => node.link ? ctx.link(node.link.href, [shape], node.link) : shape;
  const groups = g.frames.map(frame => ({ ...frame, style: frame.status }));
  const frames = groups.map(frame => attachLink(frame, drawFrame(ctx, frame, look)));
  const nodes = g.nodes.map(node => {
    const [x, y] = center(node);
    const { status } = node, tone = status && ctx.design[status];
    const parts = drawShape(ctx, node, { fill: tone ? ctx.tint(bg, tone, .11) : nodeFill, stroke: ctx.tint(bg, tone || ink, .62), 'stroke-width': 1.25 });
    parts.push(caption(ctx, { ...node, x, y, lineHeight: 18 }));
    return attachLink(node, { ...ctx.el('g', {}, parts), meta: { kind: 'node', id: node.id, ...(status ? { status } : {}) } });
  });
  const edges = [], labels = [];
  for (const edge of g.edges) {
    const { from, to, pattern, thickness, arrowStart, arrowEnd, label, icon, status } = edge;
    // Mermaid's thick link stays thick; color comes only from a mapped link style.
    const stroke = thickness > 2 ? { ...look.edge('plain', status), width: 2.5 } : look.edge(pattern === 'dotted' ? 'dashed' : 'plain', status);
    const end = kind => kind && marks.url(markKinds[kind], stroke.stroke);
    edges.push(drawEdge(ctx, edge, stroke, { start: end(arrowStart), end: end(arrowEnd) }));
    if (label) {
      const { rect } = label;
      labels.push(drawLabel(ctx, { from, to, rect, lines: label.lines, icon, plate: surfaceAt(groups, look, rect.x + rect.w / 2, rect.y + rect.h / 2) }, look));
    }
  }
  return { width: g.width, height: g.height, children: [...marks.defs(), ...frames, ...edges, ...nodes, ...labels] };
}

export const implementations = { block: { optionMode: 'raw', parse, layout, scene, acceptsPresentation: true, honoredConfig: ['block.padding'] } };
