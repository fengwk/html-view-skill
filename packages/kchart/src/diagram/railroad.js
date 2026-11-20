import { structureRoles } from '../core/context.js';
import { FONT, snap, textBlock, warning } from './support.js';
import { childrenOf, parseAbnf, parseEbnf, parseIr, parsePeg } from './railroad-parse.js';

const metricKeys = ['padding', 'verticalSeparation', 'horizontalSeparation', 'arcRadius', 'fontSize', 'showMarkers', 'markerRadius', 'compactMode'];
const honoredConfig = metricKeys.map(key => `railroad.${key}`);
function metrics(config) {
  const section = Object.entries(config ?? {}).find(([key]) => key.toLowerCase() === 'railroad')?.[1];
  const options = new Map(Object.entries(section ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
  const value = (key, fallback, low, high) => {
    const n = options.get(key.toLowerCase());
    return typeof n === 'number' && Number.isFinite(n) ? Math.max(low, Math.min(high, n)) : fallback;
  };
  const compact = options.get('compactmode') === true;
  return {
    pad: value('padding', 16, 8, 80), rail: compact ? 6 : value('horizontalSeparation', 12, 6, 80),
    gap: compact ? 6 : value('verticalSeparation', 10, 6, 80), radius: value('arcRadius', 9, 6, 16),
    marker: options.get('showmarkers') === false ? 0 : value('markerRadius', 4, 2, 7),
    font: { ...FONT.body, size: value('fontSize', FONT.body.size, 12, 32) },
  };
}
const nameFont = { ...FONT.body, weight: 600 };
const caption = ({ min, max }) => max === Infinity ? `${min}+` : min === max ? `×${min}` : `${min}…${max}`;
const literal = value => value.replace(/[\n\r\t]/g, ch => ({ '\n': '\\n', '\r': '\\r', '\t': '\\t' })[ch]);

// Bottom-up measurement creates the same port-and-baseline model for every dialect.
function measureTrack(root, measure, prefix, { rail, gap, radius, font }) {
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
      const label = literal(node.label ?? node.text ?? node.value ?? node.name);
      track.label = node.type === 'special' ? `? ${label} ?` : label;
      track.labelWidth = Math.ceil(measure(track.label, font));
      track.w = Math.max(24, track.labelWidth + 16 + (node.icon ? (track.label ? 20 : 14) : 0));
      track.up = track.down = snap(font.size + 12) / 2;
      track.entry = track.exit = id;
    } else if (node.type === 'sequence') {
      track.w = parts.reduce((sum, child) => sum + child.w, (parts.length - 1) * rail);
      track.up = Math.max(...parts.map(child => child.up));
      track.down = Math.max(...parts.map(child => child.down));
      track.entry = parts[0].entry;
      track.exit = parts.at(-1).exit;
    } else if (node.type === 'choice') {
      const spacing = gap + Math.min(14, Math.max(0, 2 * (parts.length - 3)));
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

function paintTrack(track, left, baseline, draw, { rail, radius }) {
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
  const style = metrics(info.config), { pad, gap, marker, font } = style;
  const edges = [], chips = [], text = [];
  const edgeInk = colors['edge-strong'];
  const edge = (d, from, to) => edges.push(ctx.path(d, { fill: 'none', stroke: ctx.design[model.edgeStatusOf(edges.length)] ?? edgeInk,
    'stroke-width': 1.5, 'stroke-linecap': 'round', meta: { kind: 'edge', from, to } }));
  const label = (value, x, y, font, anchor, fill) => textBlock(ctx, { lines: [value], x, y, font, anchor, fill });
  const linked = (link, children) => link ? ctx.link(link.href, children, link) : ctx.el('g', {}, children);
  function iconAt(icon, x, y) {
    const [left, top, w, h] = icon.viewBox.split(/\s+/).map(Number), scale = 14 / Math.max(w, h);
    const fill = ctx.design.fg1;
    return ctx.el('g', { transform: `translate(${x - (left + w / 2) * scale} ${y - (top + h / 2) * scale}) scale(${scale})` },
      icon.elements.map(({ tag, attrs }) => ctx.shape(tag, { ...attrs,
        ...(icon.set === 'simple' ? { fill } : { fill: 'none', stroke: fill, 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }) })));
  }
  const chip = (t, x, y) => {
    const special = t.node.type === 'special';
    const { icon, status, link } = t.node;
    const stroke = ctx.design[status] ?? (t.node.undefined || t.node.exception ? ctx.design.warn : special ? colors['em-line'] : colors['node-line']);
    const center = x + t.w / 2;
    const outline = ctx.rect(x, y - t.up, t.w, t.up + t.down, {
      rx: t.node.type === 'terminal' ? t.up : 2, fill: special ? colors['em-fill'] : colors.node,
      stroke, ...(special ? { 'stroke-dasharray': '4 3' } : {}), meta: { kind: 'node', id: t.id },
    });
    const content = [outline];
    if (icon) content.push(iconAt(icon, center - (t.label ? t.labelWidth / 2 + 3 : 0), y));
    if (t.label) content.push(label(t.label, center + (icon ? 10 : 0), y, font, 'middle', ctx.design.fg1));
    chips.push(linked(link, content));
  };
  const count = (value, x, y) => {
    text.push(ctx.text(x, y, value, { ...FONT.label, anchor: 'middle', fill: edgeInk,
      'dominant-baseline': 'central', meta: { kind: 'edge-label' } }));
    return Math.ceil(measure(value, FONT.label)) / 2 + 5;
  };
  const nameWidth = Math.ceil(Math.max(0, ...model.rules.map(rule => measure(`${rule.name} =`, nameFont) + (rule.icon ? 20 : 0))));
  const start = pad + nameWidth + 16, left = start + 16;
  let y = pad, natural = 200;
  for (const [index, rule] of model.rules.entries()) {
    const id = `rule-${index}`, t = measureTrack(rule.definition, measure, id, style), baseline = y + t.up;
    const end = left + t.w + 16;
    const markerInk = ctx.design[rule.status] ?? edgeInk;
    const heading = label(`${rule.name} =`, pad + (rule.icon ? 20 : 0), baseline, nameFont, 'start', ctx.textColor(ctx.design[rule.status] ?? ctx.design.fg1));
    text.push(linked(rule.link, rule.icon ? [iconAt(rule.icon, pad + 7, baseline), heading] : [heading]));
    if (marker) for (const [x, suffix] of [[start, 'start'], [end, 'end']]) {
      chips.push(ctx.circle(x, baseline, marker, { fill: markerInk, meta: { kind: 'node', id: `${id}-${suffix}` } }));
    }
    edge(`M ${start + marker} ${baseline} H ${left}`, `${id}-start`, t.entry);
    paintTrack(t, left, baseline, { chip, count, edge }, style);
    edge(`M ${left + t.w} ${baseline} H ${end - marker}`, t.exit, `${id}-end`);
    natural = Math.max(natural, end + marker + pad);
    y = baseline + t.down + gap + 14;
  }
  const errors = natural > 2 * width || model.count > 60 ? [warning('LARGE_DIAGRAM', lang, info.headerLine,
    '语法图较大，可在图框中滚动', 'Large grammar; scroll inside the frame', '考虑拆分规则', 'Consider splitting the rules')] : [];
  return { scene: { width: natural, height: model.rules.length ? y - gap - 14 + pad : 100,
    children: [...edges, ...chips, ...text], title: info.accTitle || model.accTitle || model.title, heading: model.title,
    description: info.accDescr || model.accDescr }, errors };
}

const implementation = parse => ({ optionMode: 'raw', parse, layout, acceptsPresentation: true, honoredConfig });
export const implementations = {
  'railroad-beta': implementation(parseIr),
  'railroad-ebnf-beta': implementation(parseEbnf),
  'railroad-abnf-beta': implementation(parseAbnf),
  'railroad-peg-beta': implementation(parsePeg),
};
