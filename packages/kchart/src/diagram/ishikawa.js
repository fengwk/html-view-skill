/* Ishikawa (fishbone / cause-and-effect): Mermaid's indented cause syntax in KChart's calm bone geometry. */

import { FONT, appearance as appearanceOf, error as issueAt, fallbackMeasure, labelText, warning, wrapText } from './support.js';

// Mermaid's rib angle: a bone leans 8° off vertical, so it drifts LEAN px sideways per px of vertical run.
const LEAN = Math.cos((82 * Math.PI) / 180) / Math.sin((82 * Math.PI) / 180);

const BODY = FONT.label.size;   // 12px cause and sub-bone labels
const LINE = 15;                // 12px label pitch
const HEAD_LINE = 18;           // 14px head label pitch
const HEAD_PAD_X = 16;
const HEAD_PAD_Y = 14;
const HEAD_MIN_W = 96;
const HEAD_MIN_H = 44;
const CHIP_PAD_X = 10;
const CHIP_PAD_Y = 6;
const CHIP_MIN_W = 72;
const CHIP_MIN_H = 30;
const LABEL_GAP = 12;           // a bone tip to the right edge of its label
const LEAF_RUN = 34;            // horizontal bone of a cause without sub-causes (Mermaid's short stub)
const BRANCH_RUN = 44;          // smallest horizontal bone that carries diagonal sub-bones
const STEP_RUN = 18;            // extra horizontal bone per diagonal, so their attach points stay apart
const SPINE_CLEAR = 26;         // innermost label band, measured from the spine
const SIB_GAP = 18;             // neighbouring sub-bone labels on one bone
const CHILD_GAP = 18;           // a label to its own sub-bone labels
const CHIP_GAP = 14;            // outermost label to its category chip
const MIN_BONE = 122;           // vertical span every category bone covers
const CAT_PAD = 30;             // gap between two category strips on one side
const HEAD_GAP = 24;            // spine end to the nearest category strip
const SPINE_TAIL = 26;
const MARGIN = 24;
const NODE_CAP = 2000;          // runtime bound only; readability issues are warnings
const NODE_HINT = 60;
// Narrow frames rewrap labels first; the scene then widens (the host scrolls) instead of shrinking text.
const CAPS = [220, 190, 160, 140, 120];

// Mermaid derives levels from the indentation delta of the first cause (not indent/4), counts a tab as one
// whitespace character, and keeps quotes and mid-line %% in the label.
function parse(source, info = {}) {
  const lang = info.lang || 'zh';
  const firstLine = Number.isInteger(info.firstLine) ? info.firstLine : 2;
  const headerLine = Number.isInteger(info.headerLine) ? info.headerLine : Math.max(1, firstLine - 1);
  const errors = [];
  const rows = [];
  // Mermaid's lexer turns text after the keyword into the first text token, so it is the problem line.
  if (typeof info.params === 'string' && info.params.trim()) rows.push({ indent: 0, text: info.params.trim(), line: headerLine });
  for (const [index, raw] of String(source ?? '').split('\n').entries()) {
    if (!raw.trim() || /^\s*%%/.test(raw)) continue;
    const indent = /^[^\S\n]*/.exec(raw)[0].length;
    rows.push({ indent, text: raw.slice(indent).trim(), line: firstLine + index });
  }
  const problem = rows[0];
  if (!problem) {
    errors.push(issueAt(lang, headerLine, '鱼骨图缺少问题（第一行）', 'Ishikawa diagram has no problem line', '先写问题，再逐层缩进写原因', 'Write the problem first, then indent its causes'));
    return { model: { kind: 'ishikawa', title: '', root: { id: 'root', label: '', line: headerLine, children: [] }, count: 0 }, errors };
  }
  const causes = rows.slice(1);
  const root = { id: 'root', label: labelText(problem.text), line: problem.line, children: [] };
  // Level 1 is the indentation of the first cause, so 4-space steps give levels 1/5/9 and stay a 4-level tree.
  const base = causes.length ? causes[0].indent : 0;
  const stack = [{ level: 0, node: root }];
  let count = 1;
  for (const row of causes) {
    if (count >= NODE_CAP) {
      errors.push(issueAt(lang, row.line, `鱼骨图最多 ${NODE_CAP} 个原因`, `An Ishikawa diagram can contain at most ${NODE_CAP} causes`, '拆分鱼骨图，不要删除原因', 'Split the diagram without dropping causes'));
      break;
    }
    const level = Math.max(1, row.indent - base + 1);
    // Mermaid pops to the nearest strictly shallower cause, so every cause keeps its line and gets a parent.
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    const node = { id: `n${count}`, label: labelText(row.text), line: row.line, children: [] };
    stack[stack.length - 1].node.children.push(node);
    stack.push({ level, node });
    count += 1;
  }
  return { model: { kind: 'ishikawa', title: root.label, root, count }, errors };
}

// Sub-bone labels own disjoint bands, so stacked text never overlaps: children continue outward from their
// parent in source order, and every gap is at least the 18px the shared contract asks for.
function assignBands(list, start) {
  let cursor = start;
  for (const [index, node] of list.entries()) {
    node.s = cursor + node.h / 2;
    cursor += node.h;
    if (node.children.length) cursor = assignBands(node.children, cursor + CHILD_GAP);
    if (index < list.length - 1) cursor += SIB_GAP;
  }
  return cursor;
}

function build(model, { cap, lang, measure, width }) {
  const errors = [];
  const ink = (value, font) => Math.max(0, measure(value, font));
  const wrap = (value, font) => wrapText(value, cap, font, (piece, spec) => measure(piece, spec));
  const headFont = { size: FONT.title.size, weight: FONT.title.weight };
  const bodyFont = { size: BODY, weight: 400 };
  const chipFont = { size: BODY, weight: 600 };

  const headLines = wrap(model.root.label, headFont);
  const headW = Math.max(HEAD_MIN_W, Math.ceil(Math.max(0, ...headLines.map(line => ink(line, headFont))) + HEAD_PAD_X * 2));
  const headH = Math.max(HEAD_MIN_H, headLines.length * HEAD_LINE + HEAD_PAD_Y * 2);
  if (headLines.length > 4) {
    errors.push(warning('DIAGRAM_HINT', lang, model.root.line, `问题换成 ${headLines.length} 行，鱼头会很高`, `The problem label wraps to ${headLines.length} lines and makes a tall head`, '缩短问题描述', 'Shorten the problem statement'));
  }

  const subtree = (from, depth) => {
    const lines = wrap(from.label, bodyFont);
    const node = { id: from.id, line: from.line, depth, lines, children: [] };
    node.h = lines.length * LINE;
    node.w = Math.max(0, ...lines.map(line => ink(line, bodyFont)));
    node.children = (from.children || []).map(child => subtree(child, depth + 1));
    return node;
  };
  const categories = model.root.children.map((from, index) => {
    const lines = wrap(from.label, chipFont);
    return {
      id: from.id, line: from.line, index, dir: index % 2 === 0 ? -1 : 1, lines,
      chipW: Math.max(CHIP_MIN_W, Math.ceil(Math.max(0, ...lines.map(line => ink(line, chipFont))) + CHIP_PAD_X * 2)),
      chipH: Math.max(CHIP_MIN_H, lines.length * LINE + CHIP_PAD_Y * 2),
      children: (from.children || []).map(child => subtree(child, 2)),
    };
  });

  // A category's own bone carries its sub-bones and ends in its chip; both sides share one length so the chips
  // of a side line up (Mermaid also uses one bone length per side).
  for (const category of categories) {
    const end = category.children.length ? assignBands(category.children, SPINE_CLEAR) : SPINE_CLEAR;
    category.reach = Math.max(MIN_BONE, end + CHIP_GAP + category.chipH);
  }
  const sides = [categories.filter(category => category.dir < 0), categories.filter(category => category.dir > 0)];
  for (const side of sides) {
    if (!side.length) continue;
    const reach = Math.max(...side.map(category => category.reach));
    for (const category of side) category.reach = reach;
  }

  // Bone geometry in spine-relative x and outward magnitude: a horizontal sub-bone extends away from the head,
  // a diagonal one starts on its parent's bone and stays parallel to the category bone.
  for (const category of categories) {
    const place = (node, parent) => {
      if (node.depth % 2 === 0) {
        node.y0 = node.s;
        node.x0 = parent === category ? -LEAN * node.s : parent.x1 - LEAN * (node.s - parent.y1);
        node.run = node.children.length ? Math.max(BRANCH_RUN, STEP_RUN * node.children.length) : LEAF_RUN;
        node.x1 = node.x0 - node.run;
        node.y1 = node.s;
      } else {
        // Diagonals spread left→right along the parent's horizontal at equal fractions, like Mermaid.
        const count = parent.children.length, k = parent.children.indexOf(node);
        node.y0 = parent.y1;
        node.x0 = parent.x1 + (parent.x0 - parent.x1) * (k + 1) / (count + 1);
        // The diagonal reaches the outer edge of its own sub-bones so nothing starts in mid-air.
        const end = node.children.length ? Math.max(node.s, ...node.children.map(deepest)) : node.s;
        node.y1 = end;
        node.x1 = node.x0 - LEAN * (end - node.y0);
      }
      node.children.forEach(child => place(child, node));
    };
    category.children.forEach(node => place(node, category));
    const leftOf = (node) => Math.min(node.x1 - LABEL_GAP - node.w, node.x0, node.x1, ...node.children.map(leftOf));
    const leaves = category.children.map(leftOf);
    const chipX = -LEAN * category.reach;
    category.leftRel = Math.min(chipX - category.chipW / 2, ...leaves);
    category.rightRel = Math.max(0, chipX + category.chipW / 2);
  }
  // Categories read left→right in source order, so index 0 attaches nearest the head (as Mermaid orders them).
  for (const side of sides) {
    const step = Math.max(0, ...side.slice(1).map((category, index) => category.rightRel - side[index].leftRel + CAT_PAD));
    side.forEach((category, index) => {
      category.ax = index ? side[index - 1].ax - step : -(category.rightRel + HEAD_GAP);
    });
  }

  const spineLeft = categories.length ? Math.min(...categories.map(category => category.ax)) - SPINE_TAIL : -SPINE_TAIL;
  const minX = Math.min(spineLeft, 0, ...categories.map(category => category.ax + category.leftRel));
  const maxX = Math.max(headW, ...categories.map(category => category.ax + category.rightRel));
  const above = Math.max(0, ...sides[0].map(category => category.reach));
  const below = Math.max(0, ...sides[1].map(category => category.reach));
  const minY = Math.min(-headH / 2, -above);
  const maxY = Math.max(headH / 2, below);
  const dx = MARGIN - minX;
  const dy = MARGIN - minY;
  const point = (relX, magnitude, dir) => [dx + relX, dy + dir * magnitude];

  const bones = [], chips = [], labels = [];
  for (const category of categories) {
    // The bone stops at the chip's inner edge instead of running behind the chip.
    bones.push({
      id: `${category.id}-bone`, from: 'root', to: category.id, main: true,
      points: [point(category.ax, 0, 1), point(category.ax - LEAN * (category.reach - category.chipH), category.reach - category.chipH, category.dir)],
    });
    chips.push({
      id: category.id, line: category.line, tone: category.index % 6, lines: category.lines,
      x: dx + category.ax - LEAN * category.reach - category.chipW / 2,
      y: dy + (category.dir < 0 ? -category.reach : category.reach - category.chipH),
      w: category.chipW, h: category.chipH,
    });
    const walk = (node) => {
      bones.push({
        id: `${node.id}-bone`, from: node.parent || category.id, to: node.id, main: false,
        points: [point(category.ax + node.x0, node.y0, category.dir), point(category.ax + node.x1, node.y1, category.dir)],
      });
      labels.push({
        id: node.id, line: node.line, lines: node.lines, side: category.dir,
        x: dx + category.ax + node.x1 - LABEL_GAP, y: dy + category.dir * node.s,
      });
      node.children.forEach(walk);
    };
    for (const node of category.children) {
      node.parent = category.id;
      const annotate = (child, parent) => { child.parent = parent.id; child.children.forEach(grand => annotate(grand, child)); };
      annotate(node, category);
      walk(node);
    }
  }

  if (model.count > NODE_HINT) {
    errors.push(warning('LARGE_DIAGRAM', lang, model.root.line, `鱼骨图有 ${model.count} 个原因，建议拆分`, `The Ishikawa diagram has ${model.count} causes; consider splitting it`, '按类别拆成多张鱼骨图', 'Split the diagram by category'));
  }
  const natural = Math.ceil(maxX - minX + MARGIN * 2);
  if (model.count <= NODE_HINT && natural > width * 2) {
    errors.push(warning('LARGE_DIAGRAM', lang, model.root.line, `鱼骨图需要 ${natural}px 宽，超过图框两倍`, `The Ishikawa diagram needs ${natural}px, more than twice the frame`, '加宽图框或拆分鱼骨图', 'Widen the frame or split the diagram'));
  }
  return {
    width: natural,
    height: Math.ceil(maxY - minY + MARGIN * 2),
    cap,
    errors,
    head: { x: dx, y: dy - headH / 2, w: headW, h: headH, lines: headLines },
    spine: { x1: dx + spineLeft, y1: dy, x2: dx, y2: dy },
    bones,
    chips,
    labels,
  };
}

const deepest = (node) => Math.max(node.s, ...node.children.map(deepest));

function layout(model, options = {}) {
  const measure = options.measure || fallbackMeasure;
  const width = Math.max(1, Number(options.width) || 800);
  const lang = options.lang || 'zh';
  let plan = null;
  // Take the roomiest wrap that fits; the narrowest attempt wins when nothing fits and the scene widens.
  for (const cap of CAPS) {
    plan = build(model, { cap, lang, measure, width });
    if (plan.width <= width) break;
  }
  return plan;
}

function scene(plan, ctx) {
  const look = appearanceOf(ctx);
  const ink = ctx.frameTone(ctx.color('fg'));
  const strong = ctx.frameTone(ctx.color('accent'), true);
  const tones = Array.from({ length: 6 }, (_, index) => ctx.frameTone(ctx.color(`tone${index + 1}`)));
  const children = plan.bones.map(bone => ctx.path(
    `M${bone.points[0][0]} ${bone.points[0][1]} L${bone.points[1][0]} ${bone.points[1][1]}`,
    {
      fill: 'none', stroke: bone.main ? ink : look.fg4, 'stroke-width': bone.main ? 2 : 1.4, 'stroke-linecap': 'round',
      meta: { kind: 'edge', from: bone.from, to: bone.to },
    },
  ));
  children.push(ctx.line(plan.spine.x1, plan.spine.y1, plan.spine.x2, plan.spine.y2, {
    stroke: ink, 'stroke-width': 2, 'stroke-linecap': 'round', meta: { kind: 'edge', from: 'root', to: 'root' },
  }));
  for (const chip of plan.chips) {
    const tone = tones[chip.tone];
    children.push(ctx.el('g', {}, [
      ctx.rect(chip.x, chip.y, chip.w, chip.h, {
        rx: look.radius, fill: ctx.tint(look.bg, tone, 0.07), stroke: ctx.tint(look.bg, tone, 0.45), 'stroke-width': 1,
        meta: { kind: 'node', id: chip.id, label: chip.id },
      }),
      ...chip.lines.map((line, index) => ctx.text(chip.x + chip.w / 2,
        chip.y + chip.h / 2 + (index - (chip.lines.length - 1) / 2) * LINE, line, {
          size: BODY, weight: 600, fill: look.fg1, anchor: 'middle', 'dominant-baseline': 'central',
        })),
    ]));
  }
  for (const group of plan.labels) children.push(...group.lines.map((line, index) => ctx.text(group.x,
    group.y + (index - (group.lines.length - 1) / 2) * LINE, line, {
      size: BODY, weight: 400, fill: look.fg2, anchor: 'end', 'dominant-baseline': 'central',
    })));
  // The head is the fish's body on the spine's right end: a tinted capsule with an ink dot at the junction.
  const headFill = ctx.tint(look.bg, strong, 0.12);
  children.push(ctx.el('g', {}, [
    ctx.rect(plan.head.x, plan.head.y, plan.head.w, plan.head.h, {
      rx: Math.min(plan.head.h / 2, look.radius + 10), fill: headFill, stroke: ctx.tint(look.bg, strong, 0.5),
      'stroke-width': 1.5, meta: { kind: 'node', id: 'root', label: 'root' },
    }),
    ctx.circle(plan.spine.x2, plan.spine.y2, 3, { fill: ink }),
    ...plan.head.lines.map((line, index) => ctx.text(plan.head.x + plan.head.w / 2,
      plan.head.y + plan.head.h / 2 + (index - (plan.head.lines.length - 1) / 2) * HEAD_LINE, line, {
        size: FONT.title.size, weight: FONT.title.weight, fill: ctx.textOn(headFill), anchor: 'middle', 'dominant-baseline': 'central',
      })),
  ]));
  return {
    width: plan.width,
    height: plan.height,
    title: plan.head.lines.join(' '),
    children,
    anchor: { x: plan.head.x + plan.head.w / 2, y: plan.head.y + plan.head.h / 2 },
  };
}

// The header takes no options; Mermaid reads trailing header text as the problem line (optionMode 'raw').
const implementations = { ishikawa: { optionMode: 'raw', parse, layout, scene } };

export { implementations };
