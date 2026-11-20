import { structureRoles } from '../core/context.js';
import { FONT, snap, textBlock, warning } from './support.js';
import { childrenOf, parseAbnf, parseEbnf, parseIr, parsePeg } from './railroad-parse.js';

const pad = 16, rail = 12, radius = 9, marker = 4;
const nameFont = { ...FONT.body, weight: 600 };
const caption = ({ min, max }) => max === Infinity ? `${min}+` : min === max ? `×${min}` : `${min}…${max}`;
const literal = value => value.replace(/[\n\r\t]/g, ch => ({ '\n': '\\n', '\r': '\\r', '\t': '\\t' })[ch]);

// Bottom-up measurement creates the same port-and-baseline model for every dialect.
function measureTrack(root, measure, prefix) {
  const sizes = new Map(), stack = [[root, false]];
  while (stack.length) {
    const [node, visited] = stack.pop(), descendants = childrenOf(node);
    if (!visited && descendants.length) {
      stack.push([node, true], ...descendants.map(child => [child, false]).reverse());
      continue;
    }
    const id = `${prefix}-${sizes.size}`, parts = descendants.map(child => sizes.get(child));
    const track = { id, entry: `${id}-in`, exit: `${id}-out`, node, parts };
    if (!parts.length) {
      track.label = node.type === 'special' ? `? ${literal(node.text)} ?` : literal(node.value ?? node.name);
      track.w = Math.max(24, Math.ceil(measure(track.label, FONT.body)) + 16);
      track.up = track.down = snap(FONT.body.size + 12) / 2;
      track.entry = track.exit = id;
    } else if (node.type === 'sequence') {
      track.w = parts.reduce((sum, child) => sum + child.w, (parts.length - 1) * rail);
      track.up = Math.max(...parts.map(child => child.up));
      track.down = Math.max(...parts.map(child => child.down));
      track.entry = parts[0].entry;
      track.exit = parts.at(-1).exit;
    } else if (node.type === 'choice') {
      const spacing = Math.min(24, Math.max(10, 8 + 2 * (parts.length - 2)));
      let cursor = 0;
      const lanes = parts.map(child => {
        const baseline = cursor + child.up;
        cursor = baseline + child.down + spacing;
        return baseline;
      });
      const baseline = lanes[Math.floor((lanes.length - 1) / 2)];
      track.lanes = lanes.map(y => y - baseline);
      track.w = Math.max(...parts.map(child => child.w)) + 4 * radius;
      track.up = baseline;
      track.down = cursor - spacing - baseline;
    } else {
      const [inner] = parts;
      track.bypass = node.type === 'optional' || node.min === 0;
      track.caption = node.type === 'repetition' ? caption(node) : null;
      track.w = 4 * radius + Math.max(inner.w, track.caption ? Math.ceil(measure(track.caption, FONT.label)) + 16 : 0);
      track.up = inner.up + (track.bypass ? 2 * radius : 0);
      track.down = inner.down + (track.caption ? 2 * radius + 8 : 0);
    }
    sizes.set(node, track);
  }
  return sizes.get(root);
}

function paintTrack(track, left, baseline, draw) {
  const stack = [[track, left, baseline]];
  const { edge, chip, count } = draw;
  while (stack.length) {
    const [t, x, y] = stack.pop(), right = x + t.w;
    const r = radius, { parts, entry, exit } = t;
    if (!parts.length) { chip(t, x, y); continue; }
    const children = [];
    if (t.node.type === 'sequence') {
      let cursor = x;
      parts.forEach((child, i) => {
        if (i) edge(`M ${cursor - rail} ${y} H ${cursor}`, parts[i - 1].exit, child.entry);
        children.push([child, cursor, y]);
        cursor += child.w + rail;
      });
    } else if (t.node.type === 'choice') {
      const a = x + r, b = right - r;
      edge(`M ${x} ${y} H ${a}`, entry, `${entry}-fan`);
      edge(`M ${b} ${y} H ${right}`, `${exit}-fan`, exit);
      // The two trunks are drawn once: branches touch them but never repaint a shared segment.
      const top = y + Math.min(0, t.lanes[0] + r), bottom = y + Math.max(0, t.lanes.at(-1) - r);
      edge(`M ${a} ${top} V ${bottom}`, `${entry}-fan`, `${entry}-fan`);
      edge(`M ${b} ${top} V ${bottom}`, `${exit}-fan`, `${exit}-fan`);
      parts.forEach((child, i) => {
        const lane = y + t.lanes[i], childX = x + (t.w - child.w) / 2;
        const dy = Math.sign(t.lanes[i]) * r;
        const start = dy ? `M ${a} ${lane - dy} A ${r} ${r} 0 0 ${dy > 0 ? 0 : 1} ${a + r} ${lane}` : `M ${a} ${y}`;
        const end = dy ? `H ${b - r} A ${r} ${r} 0 0 ${dy > 0 ? 0 : 1} ${b} ${lane - dy}` : `H ${b}`;
        edge(`${start} H ${childX}`, `${entry}-fan`, child.entry);
        edge(`M ${childX + child.w} ${lane} ${end}`, child.exit, `${exit}-fan`);
        children.push([child, childX, lane]);
      });
    } else {
      const [inner] = parts, childX = x + (t.w - inner.w) / 2;
      const a = x + 2 * r, b = right - 2 * r;
      edge(`M ${x} ${y} H ${childX}`, entry, inner.entry);
      edge(`M ${childX + inner.w} ${y} H ${right}`, inner.exit, exit);
      if (t.bypass) {
        const above = y - t.up + 2;
        edge(`M ${x} ${y} Q ${x + r} ${y} ${x + r} ${y - r} V ${above + r} Q ${x + r} ${above} ${a} ${above} H ${b} Q ${right - r} ${above} ${right - r} ${above + r} V ${y - r} Q ${right - r} ${y} ${right} ${y}`, entry, exit);
      }
      if (t.caption) {
        const below = y + inner.down + 2 * r, mid = (a + b) / 2;
        const half = count(t.caption, mid, below);
        edge(`M ${b} ${y} Q ${b + r} ${y} ${b + r} ${y + r} V ${below - r} Q ${b + r} ${below} ${b} ${below} H ${mid + half}`, inner.exit, `${t.id}-count`);
        edge(`M ${mid - half} ${below} H ${a} Q ${a - r} ${below} ${a - r} ${below - r} V ${y + r} Q ${a - r} ${y} ${a} ${y}`, `${t.id}-count`, inner.entry);
      }
      children.push([inner, childX, y]);
    }
    stack.push(...children.reverse());
  }
}

function layout(model, { width, ctx, measure, lang, renderOptions }, info) {
  const colors = structureRoles(renderOptions).colors;
  const edges = [], chips = [], text = [];
  const edgeInk = colors['edge-strong'];
  const edge = (d, from, to) => edges.push(ctx.path(d, { fill: 'none', stroke: edgeInk, 'stroke-width': 1.5, 'stroke-linecap': 'round', meta: { kind: 'edge', from, to } }));
  const label = (value, x, y, font, anchor, fill) => text.push(textBlock(ctx, { lines: [value], x, y, font, anchor, fill }));
  const chip = (t, x, y) => {
    const special = t.node.type === 'special';
    const stroke = t.node.undefined || t.node.exception ? ctx.design.warn : special ? colors['em-line'] : colors['node-line'];
    chips.push(ctx.rect(x, y - t.up, t.w, t.up + t.down, {
      rx: t.node.type === 'terminal' ? t.up : 2, fill: special ? colors['em-fill'] : colors.node,
      stroke, ...(special ? { 'stroke-dasharray': '4 3' } : {}), meta: { kind: 'node', id: t.id },
    }));
    label(t.label, x + t.w / 2, y, FONT.body, 'middle', ctx.design.fg1);
  };
  const count = (value, x, y) => {
    text.push(ctx.text(x, y, value, { ...FONT.label, anchor: 'middle', fill: edgeInk,
      'dominant-baseline': 'central', meta: { kind: 'edge-label' } }));
    return Math.ceil(measure(value, FONT.label)) / 2 + 5;
  };
  const nameWidth = Math.ceil(Math.max(0, ...model.rules.map(rule => measure(`${rule.name} =`, nameFont))));
  const start = pad + nameWidth + 16, left = start + 16;
  let y = pad, natural = 200;
  for (const [index, rule] of model.rules.entries()) {
    const id = `rule-${index}`, t = measureTrack(rule.definition, measure, id), baseline = y + t.up;
    const end = left + t.w + 16;
    label(`${rule.name} =`, pad, baseline, nameFont, 'start', ctx.design.fg1);
    for (const [x, suffix] of [[start, 'start'], [end, 'end']]) {
      chips.push(ctx.circle(x, baseline, marker, { fill: edgeInk, meta: { kind: 'node', id: `${id}-${suffix}` } }));
    }
    edge(`M ${start + marker} ${baseline} H ${left}`, `${id}-start`, t.entry);
    edge(`M ${left + t.w} ${baseline} H ${end - marker}`, t.exit, `${id}-end`);
    paintTrack(t, left, baseline, { chip, count, edge });
    natural = Math.max(natural, end + marker + pad);
    y = baseline + t.down + 24;
  }
  const errors = natural > 2 * width || model.count > 60 ? [warning('LARGE_DIAGRAM', lang, info.headerLine,
    '语法图较大，可在图框中滚动', 'Large grammar; scroll inside the frame', '考虑拆分规则', 'Consider splitting the rules')] : [];
  return { scene: { width: natural, height: model.rules.length ? y - 24 + pad : 100,
    children: [...edges, ...chips, ...text], title: info.accTitle || model.accTitle || model.title, heading: model.title,
    description: info.accDescr || model.accDescr }, errors };
}

export const implementations = {
  'railroad-beta': { optionMode: 'raw', parse: parseIr, layout },
  'railroad-ebnf-beta': { optionMode: 'raw', parse: parseEbnf, layout },
  'railroad-abnf-beta': { optionMode: 'raw', parse: parseAbnf, layout },
  'railroad-peg-beta': { optionMode: 'raw', parse: parsePeg, layout },
};
