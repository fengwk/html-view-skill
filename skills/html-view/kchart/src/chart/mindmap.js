/* Deterministic tree layouts shared by the mindmap and tree chart families. */
KChart.define('chart/mindmap', ({ 'chart/registry': { register }, 'core/theme': { statusMarks } }) => {
  const GAP_X = 44, COMPACT_GAP = 24, GAP_Y = 18, PAD_X = 14, PAD_Y = 9, TEXT_WIDTH = 220, MARGIN = 24;
  // 排版方案从宽松到紧凑：先收窄节点换行宽度（不低于 120px 可读下限），再收紧层距。
  // 取第一个放得进图框的方案；都放不下时用最紧凑的一档，保留所选布局，由宿主提供图内滚动。
  const PLANS = [GAP_X, COMPACT_GAP].flatMap(gap => [TEXT_WIDTH, 190, 160, 140, 120].map(cap => ({ gap, cap })));
  const mindLayouts = ['bilateral', 'right', 'left', 'radial', 'org', 'brace', 'fishbone', 'timeline'];
  const treeLayouts = ['right', 'left', 'org', 'brace'];
  const LEAF_LINE_GAP = 8;
  const BRANCH_RADIUS = 7;
  const hasFrame = (variant, depth, children) => depth === 0 || Boolean(children?.length) || variant === 'cards';
  const nodeTextX = (box, alignRight) => alignRight ? box.x + box.w - PAD_X : box.x + PAD_X;

  /** 按节点换行上限 cap 与层距 gap 排出整棵树，返回已平移到正坐标的节点框与内容宽度。 */
  function arrange(spec, ctx, mode, { cap, gap }) {
    const nodes = [];
    const textWidth = cap - PAD_X * 2;
    function visit(source, parent = null, depth = 0) {
      if (source.icon) ctx.fit('此布局不支持节点图标', '删掉节点的 icon，保留文字标签');
      const weight = depth === 0 ? 650 : 500;
      const textOnly = mode === 'bilateral' && !hasFrame(spec.variant, depth, source.children);
      const wrapOptions = { bounded: textOnly };
      const marker = source.status ? statusMarks[source.status] : '';
      const markerWidth = marker ? ctx.measure(marker, 12, 700) + 6 : 0;
      const lines = ctx.wrap(source.label, textWidth - markerWidth, 13, weight, wrapOptions);
      const noteLines = source.note ? ctx.wrap(source.note, textWidth, 12, 400, wrapOptions) : [];
      const widths = [...lines.map(s => ctx.measure(s, 13, weight)), ...noteLines.map(s => ctx.measure(s, 12, 400))];
      const measuredWidth = Math.max(...widths) + PAD_X * 2 + markerWidth;
      const n = {
        id: source.id || `n${nodes.length}`, label: source.label, note: source.note || '', status: source.status || '', marker, markerWidth, parent, depth, children: [], lines, noteLines,
        w: Math.max(70, textOnly ? measuredWidth : Math.min(cap, measuredWidth)), contentW: measuredWidth - PAD_X * 2,
        h: Math.max(34, lines.length * 17 + noteLines.length * 15 + PAD_Y * 2),
      };
      nodes.push(n);
      n.children = (source.children || []).map(child => visit(child, n, depth + 1));
      return n;
    }
    const root = visit(spec.data);
    const leaves = n => n.children.length ? n.children.reduce((sum, c) => sum + leaves(c), 0) : 1;
    const maxDepth = Math.max(...nodes.map(n => n.depth));
    const maxH = Math.max(...nodes.map(n => n.h));
    const pitch = maxH + GAP_Y;
    const coords = new Map(), fishboneSpine = new Map();
    let fishboneSpineEnd = 0;
    const place = (n, x, y) => coords.set(n, { x, y, cx: x + n.w / 2, cy: y + n.h / 2, w: n.w, h: n.h });
    const levelWidths = group => Array.from({ length: maxDepth + 1 }, (_, d) => Math.max(0, ...group.filter(n => n.depth === d).map(n => n.w)));
    // 纵向按叶子数分配跨度，父节点居中于自己的子树；横坐标由各布局的列规则给出。
    const stack = (node, top, xOf) => {
      place(node, xOf(node), top + leaves(node) * pitch / 2 - node.h / 2);
      let at = top;
      for (const child of node.children) {
        stack(child, at, xOf);
        at += leaves(child) * pitch;
      }
    };
    if (mode === 'right' || mode === 'left' || mode === 'brace') {
      const levelW = levelWidths(nodes), col = [0];
      for (let d = 0; d < maxDepth; d++) col[d + 1] = col[d] + levelW[d] + gap;
      stack(root, 0, n => mode === 'left' ? -col[n.depth] - n.w : col[n.depth]);
    } else if (mode === 'bilateral') {
      // 一级分支按叶子数交替分到左右两侧；每侧逐层取该侧最宽节点定列宽，根与各层之间都相隔 gap。
      const sides = [[], []], mass = [0, 0];
      for (const child of root.children) {
        const side = mass[0] <= mass[1] ? 0 : 1;
        sides[side].push(child);
        mass[side] += leaves(child);
      }
      const subtree = n => [n, ...n.children.flatMap(subtree)];
      place(root, 0, -root.h / 2);
      sides.forEach((group, side) => {
        const levelW = levelWidths(group.flatMap(subtree)), start = [0, gap];
        for (let d = 1; d < maxDepth; d++) start[d + 1] = start[d] + levelW[d] + gap;
        let at = -mass[side] * pitch / 2;
        for (const node of group) {
          stack(node, at, n => side === 0 ? -start[n.depth] - n.w : root.w + start[n.depth]);
          at += leaves(node) * pitch;
        }
      });
    } else if (mode === 'org' || mode === 'timeline') {
      // Width each subtree from measured node widths; parent centered over source-order children.
      const subW = new Map();
      const calcW = (node) => {
        const childW = node.children.reduce((sum, child) => sum + calcW(child), 0)
          + Math.max(0, node.children.length - 1) * gap;
        const width = Math.max(node.w, childW);
        subW.set(node, width);
        return width;
      };
      calcW(root);
      const levels = Array.from({ length: maxDepth + 1 }, (_, d) => Math.max(...nodes.filter(n => n.depth === d).map(n => n.h)));
      const levelY = [0];
      for (let d = 1; d <= maxDepth; d++) levelY[d] = levelY[d - 1] + levels[d - 1] + GAP_Y + (mode === 'timeline' && d === 1 ? 24 : 0);
      const org = (node, left, depth, fixedY) => {
        const center = left + subW.get(node) / 2;
        place(node, center - node.w / 2, fixedY ?? levelY[depth]);
        let x = left;
        for (const child of node.children) {
          const childY = mode === 'timeline' && depth === 0 ? levelY[1] + levels[1] + GAP_Y : undefined;
          org(child, x, depth + 1, childY);
          x += subW.get(child) + gap;
        }
      };
      org(root, 0, 0);
      // timeline uses top-level stage columns on one horizontal baseline, with descendants nested below each stage.
      if (mode === 'timeline') {
        const stageGap = 36, baseline = maxH + 50;
        // 根与第一阶段之间的主轴引线：宽松方案留出明显的起点，紧凑方案收短。
        let x = root.w + (gap === GAP_X ? 100 : 28);
        for (const stage of root.children) {
          const positionStage = (node, left, depth) => {
            const center = left + subW.get(node) / 2;
            const y = depth === 1
              ? baseline + (root.h - node.h) / 2
              : baseline + Math.max(root.h, levels[1]) + GAP_Y + (depth - 2) * (maxH + GAP_Y);
            place(node, center - node.w / 2, y);
            let xx = left;
            for (const child of node.children) {
              positionStage(child, xx, depth + 1);
              xx += subW.get(child) + gap;
            }
          };
          positionStage(stage, x, 1);
          x += subW.get(stage) + stageGap;
        }
        place(root, 0, baseline);
      }
    } else if (mode === 'radial') {
      // 每个子树按叶子数分得父节点扇区内的一段角度，子节点始终留在父节点的扇区里。
      const angleOf = new Map();
      const assign = (node, lo, hi) => {
        angleOf.set(node, (lo + hi) / 2);
        const total = node.children.reduce((sum, child) => sum + leaves(child), 0) || 1;
        let cur = lo;
        for (const child of node.children) {
          const next = cur + (hi - lo) * leaves(child) / total;
          assign(child, cur, next);
          cur = next;
        }
      };
      assign(root, -Math.PI, Math.PI);
      // 环半径同时满足两条几何约束（节点按包住已换行标签的外接圆计算）：
      // 与内一环的外接圆不相交；同环相邻节点之间的弦长放得下两者的外接圆。
      const radiusOf = node => Math.hypot(node.w, node.h) / 2;
      const byDepth = Array.from({ length: maxDepth + 1 }, (_, d) => nodes.filter(n => n.depth === d)
        .sort((a, b) => angleOf.get(a) - angleOf.get(b)));
      const levelRadius = byDepth.map(level => Math.max(0, ...level.map(radiusOf)));
      const radius = [0];
      place(root, -root.w / 2, -root.h / 2);
      for (let d = 1; d <= maxDepth; d++) {
        const level = byDepth[d];
        let need = radius[d - 1] + levelRadius[d - 1] + levelRadius[d] + 12;
        if (level.length > 1) level.forEach((node, index) => {
          const next = level[(index + 1) % level.length];
          const delta = (angleOf.get(next) - angleOf.get(node) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
          const chord = 2 * Math.sin(Math.min(Math.PI, delta) / 2);
          need = Math.max(need, (radiusOf(node) + radiusOf(next) + 12) / chord);
        });
        radius[d] = need;
        for (const node of level) {
          const a = angleOf.get(node);
          place(node, radius[d] * Math.cos(a) - node.w / 2, radius[d] * Math.sin(a) - node.h / 2);
        }
      }
    } else if (mode === 'fishbone') {
      // Root anchors a horizontal spine; categories alternate above/below it and their details fan outward.
      const baseY = 0, rootX = 0, cats = root.children;
      // 骨距与分支列宽跟随当前方案的节点上限和层距，窄图框里整条鱼骨同比例收紧。
      const column = cap + gap, pitchX = Math.max(column, ...cats.map(cat => cat.w + gap));
      place(root, rootX, baseY - root.h / 2);
      for (let ci = 0; ci < cats.length; ci++) {
        const cat = cats[ci], sign = ci % 2 ? 1 : -1;
        const spineX = rootX + root.w + 48 + ci * pitchX;
        const branchNodes = [];
        const collectBranch = node => { for (const child of node.children) { branchNodes.push(child); collectBranch(child); } };
        collectBranch(cat);
        const branchGap = GAP_Y;
        // 同一骨线上的卡片按深度错列，每个节点独占自己的实测高度，不再叠到同一行。
        const span = node => node.h + (node.children.length
          ? node.children.reduce((sum, child) => sum + span(child), 0) + node.children.length * branchGap
          : 0);
        const branchHeight = cat.children.reduce((sum, child) => sum + span(child), 0)
          + Math.max(0, cat.children.length - 1) * branchGap;
        const categoryY = baseY + sign * (root.h / 2 + 36 + Math.max(cat.h, branchHeight) / 2);
        fishboneSpine.set(cat, spineX);
        fishboneSpineEnd = spineX;
        place(cat, spineX + sign * 32 - cat.w / 2, categoryY - cat.h / 2);
        let cursor = sign > 0 ? categoryY + cat.h / 2 + branchGap : categoryY - cat.h / 2 - branchGap;
        const branch = (parent, depth) => {
          for (const child of parent.children) {
            const block = span(child);
            const y = sign > 0 ? cursor : cursor - child.h;
            place(child, spineX + depth * column, y);
            const next = sign > 0 ? cursor + child.h + branchGap : cursor - child.h - branchGap;
            const saved = cursor;
            cursor = next;
            branch(child, depth + 1);
            cursor = sign > 0 ? Math.max(cursor, saved + block + branchGap) : Math.min(cursor, saved - block - branchGap);
          }
        };
        branch(cat, 1);
      }
    }

    // 平移到正坐标并留出统一边距；连线都在节点框之间，内容宽度由节点右缘决定。
    const minX = Math.min(...nodes.map(n => coords.get(n).x)), minY = Math.min(...nodes.map(n => coords.get(n).y));
    for (const n of nodes) {
      const p = coords.get(n);
      place(n, p.x + MARGIN - minX, p.y + MARGIN - minY);
    }
    for (const [cat, x] of fishboneSpine) fishboneSpine.set(cat, x + MARGIN - minX);
    const width = Math.ceil(Math.max(...nodes.map(n => coords.get(n).x + n.w)) + MARGIN);
    return { nodes, root, coords, fishboneSpine, fishboneSpineEnd: fishboneSpineEnd + MARGIN - minX, gap, width };
  }

  function bilateralPath(a, b, framed, gap) {
    const left = b.cx < a.cx, direction = left ? -1 : 1;
    const fromX = left ? a.x : a.x + a.w;
    const childSide = left ? b.x + b.w : b.x;
    const toX = framed ? childSide : nodeTextX(b, left) - direction * LEAF_LINE_GAP;
    const start = `M${fromX} ${a.cy}`, end = `L${toX} ${b.cy}`;
    if (a.cy === b.cy) return `${start} ${end}`;

    // 同一列的兄弟分支共用转折线。圆角位于层间空隙中，首尾留出水平线段。
    const turnX = childSide - direction * gap / 2;
    const dy = b.cy - a.cy, vertical = Math.sign(dy);
    const radius = Math.min(BRANCH_RADIUS, gap / 4, Math.abs(dy) / 2);
    return [
      start,
      `L${turnX - direction * radius} ${a.cy}`,
      `Q${turnX} ${a.cy} ${turnX} ${a.cy + vertical * radius}`,
      `L${turnX} ${b.cy - vertical * radius}`,
      `Q${turnX} ${b.cy} ${turnX + direction * radius} ${b.cy}`,
      end,
    ].join(' ');
  }

  function build(spec, ctx, isMindmap) {
    const mode = spec.layout || (isMindmap ? 'bilateral' : 'right');
    const variant = isMindmap ? spec.variant || 'editorial' : 'editorial';
    if (!(isMindmap ? mindLayouts : treeLayouts).includes(mode)) ctx.fit(`不支持布局 ${mode}`, '选择该图型的受控 layout');
    if (!['editorial', 'cards'].includes(variant)) ctx.fit(`不支持变体 ${variant}`, '选择该图型的受控 variant');
    let plan;
    for (const option of PLANS) {
      plan = arrange(spec, ctx, mode, option);
      if (plan.width <= ctx.width) break;
    }
    const { nodes, root, coords, fishboneSpine, fishboneSpineEnd } = plan;
    const rootPosition = coords.get(root);
    const edgeList = [];
    const boundary = (box, dx, dy) => { const sx = dx ? box.w / 2 / Math.abs(dx) : Infinity, sy = dy ? box.h / 2 / Math.abs(dy) : Infinity, t = Math.min(sx, sy); return { x: box.cx + dx * t, y: box.cy + dy * t }; };
    for (const n of nodes) if (n.parent) {
      const a = coords.get(n.parent), b = coords.get(n);
      let d;
      if (mode === 'bilateral') d = bilateralPath(a, b, hasFrame(variant, n.depth, n.children), plan.gap);
      else if (mode === 'org') { const top = { x: a.cx, y: a.y + a.h }, bottom = { x: b.cx, y: b.y }, sharedY = (top.y + bottom.y) / 2; d = `M${top.x} ${top.y} L${top.x} ${sharedY} L${bottom.x} ${sharedY} L${bottom.x} ${bottom.y}`; }
      else if (mode === 'fishbone' && n.parent === root) { const spineX = fishboneSpine.get(n), rootEdge = { x: a.x + a.w, y: a.cy }, branchEnd = boundary(b, spineX - b.cx, a.cy - b.cy); d = `M${rootEdge.x} ${rootEdge.y} L${spineX} ${rootEdge.y} L${branchEnd.x} ${branchEnd.y}`; }
      else {
        const dx = b.cx - a.cx, dy = b.cy - a.cy;
        const from = boundary(a, dx, dy), to = boundary(b, -dx, -dy);
        if (mode === 'brace') {
          // A bracket leaves the parent's right edge at mid-height and enters each child at mid-height,
          // so no arm runs along a box border.
          const trunk = Math.min(...n.parent.children.map(child => coords.get(child).x)) - plan.gap / 2;
          const out = { x: a.x + a.w, y: a.cy }, into = { x: b.x, y: b.cy };
          d = `M${out.x} ${out.y} L${trunk} ${out.y} L${trunk} ${into.y} L${into.x} ${into.y}`;
        } else d = `M${from.x} ${from.y} L${to.x} ${to.y}`;
      }
      edgeList.push({ from: n.parent.id, to: n.id, d, kind: mode, parent: n.parent, child: n });
    }
    const svgNodes = [], rootText = ctx.textOn('accent');
    for (const n of nodes) {
      const p = coords.get(n), rootNode = n === root, card = variant === 'cards';
      const framed = hasFrame(variant, n.depth, n.children);
      if (framed) {
        const fill = rootNode ? ctx.color('accent') : card ? ctx.tint(ctx.palette.bg, ctx.palette.accent, 0.035) : ctx.tint(ctx.palette.bg, ctx.palette.accent, 0.12);
        svgNodes.push(ctx.rect(p.x, p.y, n.w, n.h, { rx: rootNode ? 10 : 6, fill, stroke: rootNode ? ctx.color('accent') : card ? ctx.color('axis') : ctx.tint(ctx.palette.bg, ctx.palette.accent, 0.28), 'stroke-width': rootNode || card ? 1 : 0.8, meta: { kind: isMindmap ? 'mindmap' : 'tree', node: n.id, related: descendants(n) } }));
      }
      // 无框叶子的文字向连线一侧对齐，长短不一的多行文字也紧靠同一个端口。
      const leftLeaf = mode === 'bilateral' && !framed && p.cx < rootPosition.cx;
      const anchor = rootNode ? 'middle' : leftLeaf ? 'end' : 'start';
      // 框被 70px 最小宽撑开时，文字块在框内居中；多行仍共用同一起点。
      const tx = rootNode ? p.cx : framed ? p.x + Math.max(PAD_X, (n.w - n.contentW) / 2) : nodeTextX(p, leftLeaf);
      const labelX = rootNode ? tx + n.markerWidth / 2 : tx + (leftLeaf ? -n.markerWidth : n.markerWidth);
      const markerX = rootNode ? tx : tx + (leftLeaf ? -n.markerWidth / 2 : n.markerWidth / 2);
      const weight = rootNode ? 650 : 500;
      const labelStep = 16, total = n.lines.length * labelStep + n.noteLines.length * 15;
      const labelY = p.cy - total / 2 + 12;
      svgNodes.push(...ctx.textLines(labelX, labelY, n.lines, { anchor, size: 13, weight, fill: rootNode ? rootText : ctx.color('fg'), meta: { kind: isMindmap ? 'mindmap' : 'tree', node: n.id, related: descendants(n), role: 'label' } }).children);
      if (n.marker) svgNodes.push(ctx.text(markerX, labelY, n.marker, { anchor: 'middle', size: 12, weight: 700, fill: rootNode ? rootText : ctx.textColor(ctx.design[n.status]), meta: { kind: isMindmap ? 'mindmap' : 'tree', node: n.id, related: descendants(n), role: 'status', status: n.status } }));
      let y = labelY + n.lines.length * labelStep;
      for (const line of n.noteLines) { svgNodes.push(ctx.text(tx, y, line, { anchor, size: 12, fill: rootNode ? rootText : ctx.color('muted'), meta: { kind: isMindmap ? 'mindmap' : 'tree', node: n.id, related: descendants(n), role: 'note' } })); y += 15; }
    }
    function descendants(n) { return [n.id, ...n.children.flatMap(descendants)]; }
    const paths = edgeList.map(e => ctx.path(e.d, { fill: 'none', stroke: ctx.color('tone5'), 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', meta: { kind: isMindmap ? 'mindmap' : 'tree', node: e.child.id, related: descendants(e.child), from: e.from, to: e.to } }));
    if (mode === 'fishbone' && root.children.length) {
      const r = coords.get(root);
      const spine = `M${r.x + r.w} ${r.cy} L${Math.max(r.x + r.w, fishboneSpineEnd)} ${r.cy}`;
      paths.push(ctx.path(spine, { fill: 'none', stroke: ctx.color('tone5'), 'stroke-width': 2, meta: { kind: isMindmap ? 'mindmap' : 'tree', node: root.id, related: descendants(root), role: 'spine' } }));
    }
    const sceneNodes = nodes.map(n => { const p = coords.get(n); return { id:n.id,x:p.x,y:p.y,w:n.w,h:n.h,parent:n.parent?.id||null,depth:n.depth,label:n.label,note:n.note,...(n.status?{status:n.status}:{}) }; });
    // 双侧曲线的控制点都在节点给出的边界内，不需要从 SVG 字符串读回坐标。
    const pairs = mode === 'bilateral' ? [] : edgeList.flatMap(e =>
      [...e.d.matchAll(/(?:M|L)\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)].map(m => [Number(m[1]), Number(m[2])]),
    );
    const width = Math.ceil(Math.max(...nodes.map(n => coords.get(n).x + n.w), ...pairs.map(p => p[0])) + MARGIN);
    const height = Math.ceil(Math.max(...nodes.map(n => coords.get(n).y + n.h), ...pairs.map(p => p[1])) + MARGIN);
    return { width, height, title: spec.title || (isMindmap ? 'Mindmap' : 'Tree'), children: [...paths, ...svgNodes], nodes: sceneNodes, edges: edgeList.map(({from,to,d,kind}) => ({from,to,d,kind})), layout: mode, variant, anchor: { x: rootPosition.cx, y: rootPosition.cy } };
  }
  register('mindmap', (spec, ctx) => build(spec, ctx, true));
  register('tree', (spec, ctx) => build(spec, ctx, false));
});
