import { DIRECTIONS, FONT as BASE_FONT, fallbackMeasure, maxWidthOf, wrapText } from './support.js';
import { flowOutlineName, shapeSize, shapeOutline, outlinePort } from './shapes.js';

const FONT = { ...BASE_FONT, frame: { size: 13, weight: 600 }, erHead: { size: 14, weight: 600 }, erAttr: { size: 13, weight: 400 }, erKey: { size: 12, weight: 400 } };
const FRAME_PAD = 14;
const MARGIN = 16;
const markOf = cls => (cls === 'new' ? '+ ' : cls === 'info' ? '~ ' : cls === 'ok' ? '= ' : '');
function labelBlock(item, rect) {
  const titleH = item.titleLines.length * 19;
  const descH = item.descLines.length * 17;
  const gap = item.descLines.length ? 7 : 0;
  const top = rect.y + Math.max(10, (rect.h - titleH - gap - descH) / 2);
  return {
    titleY: top + titleH / 2,
    descY: item.descLines.length ? top + titleH + gap + descH / 2 : null,
  };
}
const hgap = (a, b) => {
  if (a.kind === 'real' && b.kind === 'real') return 28;
  if (a.kind === 'label' || b.kind === 'label') return 18;
  return 20;
};

function collapseFrames(model) {
  const frames = new Map(model.subgraphs.map(frame => [frame.id, frame]));
  if (![...frames.values()].some(frame => frame.view === 'collapsed')) return model;
  const byId = new Map([...model.nodes, ...model.subgraphs].map(item => [item.id, item]));
  const redirects = new Map();
  for (const item of byId.values()) {
    let collapsed = item.view === 'collapsed' ? item.id : null;
    for (let parent = item.parent; parent; parent = frames.get(parent)?.parent) {
      if (frames.get(parent)?.view === 'collapsed') collapsed = parent;
    }
    if (collapsed != null) redirects.set(item.id, collapsed);
  }
  const nodes = model.nodes.filter(node => !redirects.has(node.id));
  for (const frame of frames.values()) if (redirects.get(frame.id) === frame.id) {
    nodes.push({ ...frame, label: frame.title, shape: 'rounded', kind: 'collapsed' });
  }
  const subgraphs = model.subgraphs.filter(frame => !redirects.has(frame.id));
  const edges = model.edges.flatMap(edge => {
    const from = redirects.get(edge.from) ?? edge.from, to = redirects.get(edge.to) ?? edge.to;
    if (from === to && redirects.has(from)) return [];
    return [{ ...edge, from, to, fromFrame: edge.fromFrame && !redirects.has(from), toFrame: edge.toFrame && !redirects.has(to) }];
  });
  return { ...model, nodes, subgraphs, edges };
}

// A closed frame can be laid out in its own direction without rotating its labels or shapes.
// The parent router sees its entire bounding box; only edges addressed to the frame can enter.
function layoutGraph(source, options = {}) {
  const model = collapseFrames(source);
  const frames = new Map(model.subgraphs.map(frame => [frame.id, frame]));
  const childRegions = new Set(model.subgraphs.filter(frame => frame.kind === 'divider').map(frame => frame.parent));
  const hidden = new Set(), localEdges = new Set(), blocks = new Map();
  const nodes = [...model.nodes], edges = [...model.edges];
  const measure = options.measure ?? fallbackMeasure;
  const isMember = (item, frame) => {
    for (let parent = item.parent; parent; parent = frames.get(parent)?.parent) if (parent === frame.id) return true;
    return false;
  };
  const all = [...nodes, ...model.subgraphs];
  for (const frame of [...frames.values()].sort((a, b) => a.depth - b.depth || a.seq - b.seq)) {
    if (hidden.has(frame.id) || !(frame.dir || frame.kind === 'divider' || childRegions.has(frame.id))) continue;
    const members = new Set(all.filter(item => isMember(item, frame)).map(item => item.id));
    if (!members.size || edges.some(edge => members.has(edge.from) !== members.has(edge.to))) continue;
    const topLevel = item => item.parent === frame.id ? { ...item, parent: null } : item;
    const inside = edges.filter(edge => members.has(edge.from));
    const inner = layoutGraph({ ...model, direction: frame.dir || (model.type === 'state' ? 'TB' : model.direction),
      nodes: nodes.filter(item => members.has(item.id)).map(topLevel),
      subgraphs: model.subgraphs.filter(item => members.has(item.id)).map(topLevel), edges: inside,
    }, options);
    const lines = frame.title ? wrapText(frame.title, 200, FONT.frame, measure) : [];
    const descLines = (frame.desc ?? []).flatMap(line => wrapText(line, 180, FONT.body, measure));
    const titleW = Math.max(maxWidthOf(lines, FONT.frame, measure), maxWidthOf(descLines, FONT.body, measure));
    const titleH = lines.length * 17 + (descLines.length ? 4 + descLines.length * 16 : 0);
    const titleBand = titleH ? titleH + 8 : 0;
    const w = Math.max(inner.width, titleW + 32), h = inner.height + titleBand;
    blocks.set(frame.id, { frame, inner, lines, descLines, titleW, titleH, titleBand, w, h });
    for (const id of members) hidden.add(id);
    for (const edge of inside) localEdges.add(edge);
  }
  if (!blocks.size) return layoutCore(model, options);
  const proxy = id => blocks.has(id);
  const outer = layoutCore({ ...model,
    nodes: [...nodes.filter(item => !hidden.has(item.id)), ...[...blocks.values()].map(({ frame, w, h }) => ({ ...frame, label: '', block: { w, h }, shape: 'rect' }))],
    subgraphs: model.subgraphs.filter(frame => !hidden.has(frame.id) && !proxy(frame.id)),
    edges: edges.filter(edge => !localEdges.has(edge)).map(edge => ({ ...edge,
      fromFrame: edge.fromFrame && !proxy(edge.from), toFrame: edge.toFrame && !proxy(edge.to),
    })),
  }, options);
  const retained = [];
  for (const node of outer.nodes) {
    const block = blocks.get(node.id);
    if (!block) { retained.push(node); continue; }
    const { frame, inner, lines, descLines, titleW, titleH, titleBand, w, h } = block;
    const dx = node.x + (w - inner.width) / 2, dy = node.y + titleBand;
    const move = p => p && { ...p, x: p.x + dx, y: p.y + dy };
    const attach = item => item.parent == null ? frame.id : item.parent;
    outer.frames.push({ ...frame, x: node.x, y: node.y, w, h, lines, descLines,
      titleRect: { x: node.x + 16, y: node.y + 10, w: titleW, h: titleH },
    });
    outer.frames.push(...inner.frames.map(item => ({ ...move(item), parent: attach(item), titleRect: move(item.titleRect) })));
    retained.push(...inner.nodes.map(item => ({ ...move(item), parent: attach(item),
      titleY: item.titleY + dy, descY: item.descY == null ? null : item.descY + dy,
    })));
    outer.labels.push(...inner.labels.map(move));
    outer.edges.push(...inner.edges.map(edge => ({ ...edge, start: move(edge.start), end: move(edge.end), labelRect: move(edge.labelRect),
      segments: edge.segments.map(({ p0, c1, c2, p1 }) => ({ p0: move(p0), c1: move(c1), c2: move(c2), p1: move(p1) })),
    })));
  }
  for (const edge of outer.edges) {
    if (proxy(edge.from)) edge.fromFrame = true;
    if (proxy(edge.to)) edge.toFrame = true;
  }
  return { ...outer, nodes: retained, model };
}

function layoutCore(model, { measure = fallbackMeasure, lang, ctx, renderOptions } = {}) {
  const direction = DIRECTIONS.includes(model.direction) ? model.direction : 'TB';
  const isLR = direction === 'LR' || direction === 'RL';
  const clusters = new Map();
  const root = {
    id: null,
    model: null,
    parent: null,
    children: [],
    seq: -1,
    depth: 0,
    title: '',
    titleLines: [],
    descLines: [],
    titleW: 0,
    titleBand: 0,
  };
  const realItems = [];
  const realById = new Map();
  const selfEdges = new Map();
  const warnings = [];

  // 自环单独统计：节点侧面需要的空间会加进布局宽度
  for (const edge of model.edges) {
    if (edge.from === edge.to && !edge.fromFrame && !edge.toFrame) {
      if (!selfEdges.has(edge.from)) selfEdges.set(edge.from, []);
      selfEdges.get(edge.from).push(edge);
    }
  }

  const measureNode = (node) => {
    const titleText = markOf(node.class) + (node.label || node.id);
    const titleLines = wrapText(titleText, node.kind === 'er' ? 180 : 200, FONT.title, measure);
    const descLines = [];
    for (const desc of node.desc || []) descLines.push(...wrapText(desc, 200, FONT.body, measure));
    let tw;
    let th;
    let er = null;
    if (node.kind === 'start') {
      tw = 14;
      th = 14;
    } else if (node.kind === 'end') {
      tw = 18;
      th = 18;
    } else if (node.kind === 'choice') {
      tw = 34;
      th = 34;
    } else if (node.kind === 'fork' || node.kind === 'join') {
      tw = 48;
      th = 10;
    } else if (node.kind === 'er') {
      const pad = 12;
      const headLines = titleLines;
      const headW = maxWidthOf(headLines, FONT.erHead, measure);
      const typeW = Math.max(
        36,
        ...node.fields.map((f) => maxWidthOf(wrapText(f.type, 80, FONT.erAttr, measure), FONT.erAttr, measure)),
      );
      const keyW = Math.max(
        24,
        ...node.fields.map((f) => maxWidthOf([f.keys.join(' ')], FONT.erKey, measure)),
      );
      const nameMax = Math.max(60, 240 - pad * 2 - typeW - 24 - keyW);
      const rows = node.fields.map((f) => {
        const typeLines = wrapText(f.type, 80, FONT.erAttr, measure);
        const nameLines = wrapText(f.name, nameMax, FONT.erAttr, measure);
        const keyText = f.keys.join(' ');
        const rowH = Math.max(typeLines.length, nameLines.length) * 17 + 8;
        return {
          ...f, typeLines, nameLines, keyText, rowH,
        };
      });
      const nameW = Math.max(
        60,
        ...rows.map((r) => maxWidthOf(r.nameLines, FONT.erAttr, measure)),
      );
      tw = Math.max(132, pad * 2 + Math.max(headW, typeW + 12 + nameW + 12 + keyW));
      const headerH = headLines.length * 19 + 14;
      const rowsH = rows.reduce((sum, row) => sum + row.rowH, 0);
      th = headerH + rowsH + 6;
      er = {
        headLines,
        typeW,
        nameW,
        keyW,
        headerH,
        rows,
        pad,
      };
    } else {
      const titleW = maxWidthOf(titleLines, FONT.title, measure);
      const descW = maxWidthOf(descLines, FONT.body, measure);
      tw = Math.max(64, Math.max(titleW, descW) + 28);
      th = 20 + titleLines.length * 19 + (descLines.length ? 5 + descLines.length * 17 : 0);
      th = Math.max(40, th) + (node.kind === 'collapsed' ? 20 : 0);
      const flowShape = model.type === 'flowchart' && flowOutlineName(node.shape);
      if (flowShape) {
        [tw, th] = shapeSize(flowShape, tw, th);
      } else if (node.shape === 'diamond') {
        tw *= 1.7;
        th *= 1.7;
      } else if (node.shape === 'circle') {
        const d = Math.max(48, Math.max(tw, th) * 1.3);
        tw = d;
        th = d;
      } else if (node.shape === 'hexagon') {
        tw += 34;
      } else if (node.shape === 'cylinder') {
        th += 12;
      }
    }
    if (node.block) ({ w: tw, h: th } = node.block);
    const loops = selfEdges.get(node.id) || [];
    let loopExtra = 0;
    let loopLabels = [];
    if (loops.length) {
      const labelWidths = loops.map((edge) => (edge.label ? maxWidthOf(wrapText(edge.label, 120, FONT.label, measure), FONT.label, measure) : 0));
      const maxLabel = Math.max(0, ...labelWidths);
      loopExtra = 26 + maxLabel + Math.max(0, loops.length - 1) * 12;
      loopLabels = loops.map((edge, index) => ({
        edge,
        width: labelWidths[index],
        lines: edge.label ? wrapText(edge.label, 120, FONT.label, measure) : [],
        index,
      }));
    }
    const cross = isLR ? th : tw;
    const flow = isLR ? tw : th;
    return {
      kind: 'real',
      node,
      id: node.id,
      seq: node.seq,
      tw,
      th,
      bw: cross + loopExtra,
      bh: flow,
      offsetCross: loopExtra ? -loopExtra / 2 : 0,
      titleLines,
      descLines,
      er,
      loopExtra,
      loopLabels,
      selfLoops: loops,
      parent: node.parent || null,
      cluster: null,
      up: [],
      down: [],
      rank: 0,
    };
  };

  for (const node of model.nodes) {
    const item = measureNode(node);
    realItems.push(item);
    realById.set(node.id, item);
  }
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  if (!realItems.length) {
    return {
      type: model.type,
      direction,
      width: MARGIN * 2,
      height: MARGIN * 2,
      nodes: [],
      labels: [],
      frames: [],
      edges: [],
      ranks: [],
      warnings: ['图里没有节点'],
      model,
    };
  }

  const layoutClusterTitle = (cluster, maxWidth) => {
    cluster.titleLines = wrapText(cluster.title, maxWidth, FONT.frame, measure);
    cluster.titleW = maxWidthOf(cluster.titleLines, FONT.frame, measure);
    cluster.titleBand = 10 + cluster.titleLines.length * 17
      + (cluster.descLines.length ? 4 + cluster.descLines.length * 16 : 0) + 8;
  };
  for (const sg of model.subgraphs) {
    const cluster = {
      id: sg.id,
      model: sg,
      parent: null,
      children: [],
      seq: sg.seq,
      depth: sg.depth,
      title: sg.title ?? sg.id,
      titleLines: [],
      descLines: [],
      class: sg.class || null,
    };
    for (const desc of sg.desc || []) cluster.descLines.push(...wrapText(desc, 180, FONT.body, measure));
    cluster.descW = maxWidthOf(cluster.descLines, FONT.body, measure);
    layoutClusterTitle(cluster, 200);
    clusters.set(cluster.id, cluster);
  }
  for (const cluster of clusters.values()) {
    const parent = cluster.model.parent ? clusters.get(cluster.model.parent) : root;
    cluster.parent = parent || root;
    cluster.parent.children.push(cluster);
  }
  const sortChildren = (item) => {
    item.children.sort((a, b) => a.seq - b.seq);
    for (const child of item.children) sortChildren(child);
  };
  sortChildren(root);

  for (const item of realItems) {
    item.cluster = item.parent ? clusters.get(item.parent) || root : root;
  }

  const isDescendantOf = (cluster, ancestor) => {
    for (let current = cluster; current; current = current.parent) if (current === ancestor) return true;
    return false;
  };
  const membersOf = (frame) => realItems.filter((item) => isDescendantOf(item.cluster, frame));
  const isFrameId = (id) => clusters.has(id) && !nodeById.has(id);
  const clusterChain = (cluster) => {
    const chain = [];
    for (let current = cluster; current; current = current.parent) chain.push(current);
    return chain;
  };
  const lca = (a, b) => {
    const chainA = clusterChain(a);
    const setB = new Set(clusterChain(b));
    for (const cluster of chainA) if (setB.has(cluster)) return cluster;
    return root;
  };

  // 复合状态优先用内部起点/终点；普通子图用没有内部入边/出边的成员
  const frameEntry = (frame) => {
    const members = membersOf(frame);
    if (!members.length) return null;
    const start = members.find((item) => item.node.kind === 'start' && item.parent === frame.id);
    if (start) return start;
    const memberIds = new Set(members.map((item) => item.id));
    const hasInternalIn = (id) => model.edges.some((edge) => edge.to === id && memberIds.has(edge.from) && !edge.toFrame && !edge.fromFrame);
    const candidate = members.find((item) => !hasInternalIn(item.id));
    return candidate || members[0];
  };
  const frameExit = (frame) => {
    const members = membersOf(frame);
    if (!members.length) return null;
    const end = members.find((item) => item.node.kind === 'end' && item.parent === frame.id);
    if (end) return end;
    const memberIds = new Set(members.map((item) => item.id));
    const hasInternalOut = (id) => model.edges.some((edge) => edge.from === id && memberIds.has(edge.to) && !edge.toFrame && !edge.fromFrame);
    const reversed = [...members].reverse();
    const candidate = reversed.find((item) => !hasInternalOut(item.id));
    return candidate || reversed[0];
  };

  const layoutEdges = [];
  for (const edge of model.edges) {
    const fromFrame = isFrameId(edge.from);
    const toFrame = isFrameId(edge.to);
    edge.fromFrame = fromFrame;
    edge.toFrame = toFrame;
    if (edge.from === edge.to && fromFrame && toFrame) {
      edge.skip = true;
      warnings.push(`自环子图 ${edge.from} 暂不绘制`);
      continue;
    }
    if (edge.from === edge.to && !fromFrame && !toFrame) continue;
    const fromItem = fromFrame ? frameExit(clusters.get(edge.from)) : realById.get(edge.from);
    const toItem = toFrame ? frameEntry(clusters.get(edge.to)) : realById.get(edge.to);
    if (!fromItem || !toItem) {
      edge.skip = true;
      if (fromFrame && !membersOf(clusters.get(edge.from)).length) warnings.push(`空子图 ${edge.from} 的连线已跳过`);
      if (toFrame && !membersOf(clusters.get(edge.to)).length) warnings.push(`空子图 ${edge.to} 的连线已跳过`);
      continue;
    }
    if (fromItem === toItem) {
      edge.skip = true;
      continue;
    }
    const fromChain = fromFrame ? clusterChain(clusters.get(edge.from).parent) : clusterChain(realById.get(edge.from).cluster);
    const toChain = toFrame ? clusterChain(clusters.get(edge.to).parent) : clusterChain(realById.get(edge.to).cluster);
    const ownerSet = new Set(toChain);
    const owner = fromChain.find((cluster) => ownerSet.has(cluster)) || root;
    layoutEdges.push({
      edge,
      fromItem,
      toItem,
      fromFrame,
      toFrame,
      owner,
      minlen: 1 + (edge.extra || 0),
      reversed: false,
      chain: null,
      start: null,
      end: null,
      segments: [],
    });
  }

  const allItems = [...realItems];
  for (const frame of clusters.values()) {
    const hasItems = realItems.some((item) => isDescendantOf(item.cluster, frame));
    if (!hasItems) warnings.push(`空子图 ${frame.id} 未绘制`);
  }

  // 去环：按声明顺序 DFS，回边反向
  const out = new Map(realItems.map((item) => [item, []]));
  const inn = new Map(realItems.map((item) => [item, []]));
  for (const le of layoutEdges) {
    out.get(le.fromItem).push(le);
    inn.get(le.toItem).push(le);
  }
  const color = new Map();
  const visit = (item) => {
    color.set(item, 1);
    for (const le of out.get(item)) {
      const target = le.toItem;
      const state = color.get(target) || 0;
      if (state === 1) le.reversed = true;
      else if (state === 0) visit(target);
    }
    color.set(item, 2);
  };
  for (const item of realItems) if (!color.get(item)) visit(item);
  for (const le of layoutEdges) {
    if (le.reversed) {
      const swap = le.fromItem;
      le.fromItem = le.toItem;
      le.toItem = swap;
    }
  }
  for (const item of realItems) {
    out.set(item, []);
    inn.set(item, []);
  }
  for (const le of layoutEdges) {
    out.get(le.fromItem).push(le);
    inn.get(le.toItem).push(le);
  }

  // 分层：最长路径 + 中位数收紧
  const indeg = new Map(realItems.map((item) => [item, 0]));
  for (const le of layoutEdges) indeg.set(le.toItem, indeg.get(le.toItem) + 1);
  const queue = realItems.filter((item) => indeg.get(item) === 0);
  const topo = [];
  while (queue.length) {
    const item = queue.shift();
    topo.push(item);
    for (const le of out.get(item)) {
      indeg.set(le.toItem, indeg.get(le.toItem) - 1);
      if (indeg.get(le.toItem) === 0) queue.push(le.toItem);
    }
  }
  if (topo.length < realItems.length) {
    for (const item of realItems) if (!topo.includes(item)) topo.push(item);
  }
  const rank = new Map(realItems.map((item) => [item, 0]));
  for (const item of topo) {
    for (const le of out.get(item)) {
      rank.set(le.toItem, Math.max(rank.get(le.toItem), rank.get(item) + le.minlen));
    }
  }
  // 收紧层号：让节点落在相邻边的加权中位数上，最小化 Σ w·span。
  // 带标签的边权重更高，优先缩短标注边；无标签边让位成细长线。
  const LABELLED_RANK_WEIGHT = 2;
  const edgeRankWeight = (le) => (le.edge.label ? LABELLED_RANK_WEIGHT : 1);
  /** 加权中位数；累计权重正好落在中点时取两侧值的平均，等权时即普通中位数；调用方再四舍五入为整数层号。 */
  const weightedRankMedian = (entries) => {
    if (!entries.length) return 0;
    const sorted = [...entries].sort((a, b) => a.value - b.value || a.weight - b.weight);
    const total = sorted.reduce((sum, entry) => sum + entry.weight, 0);
    let acc = 0;
    let lower = sorted[0].value;
    for (const entry of sorted) {
      acc += entry.weight;
      if (acc >= total / 2 - 1e-9) {
        lower = entry.value;
        break;
      }
    }
    acc = 0;
    let upper = sorted[sorted.length - 1].value;
    for (const entry of sorted) {
      acc += entry.weight;
      if (acc > total / 2 + 1e-9) {
        upper = entry.value;
        break;
      }
    }
    return (lower + upper) / 2;
  };
  for (let iter = 0; iter < 4; iter += 1) {
    const order = iter % 2 ? [...topo].reverse() : topo;
    for (const item of order) {
      const preds = inn.get(item).map((le) => rank.get(le.fromItem) + le.minlen);
      const succs = out.get(item).map((le) => rank.get(le.toItem) - le.minlen);
      const lower = preds.length ? Math.max(...preds) : 0;
      const upper = succs.length ? Math.min(...succs) : Infinity;
      if (upper < lower) continue;
      const entries = [
        ...inn.get(item).map((le) => ({ value: rank.get(le.fromItem) + le.minlen, weight: edgeRankWeight(le) })),
        ...out.get(item).map((le) => ({ value: rank.get(le.toItem) - le.minlen, weight: edgeRankWeight(le) })),
      ];
      const desired = Math.round(weightedRankMedian(entries));
      const next = Math.max(lower, Math.min(upper, Number.isFinite(desired) ? desired : lower));
      rank.set(item, next);
    }
  }
  let minRank = Math.min(...realItems.map((item) => rank.get(item)));
  if (!Number.isFinite(minRank)) minRank = 0;
  for (const item of realItems) {
    item.rank = (rank.get(item) - minRank) * 2;
  }

  // 子图在双倍层号里的范围；帧边的标签要落在帧外侧，避免压进帧内
  const frameRankRanges = new Map();
  for (const cluster of clusters.values()) {
    const members = realItems.filter((item) => isDescendantOf(item.cluster, cluster));
    if (!members.length) continue;
    frameRankRanges.set(cluster.id, {
      top: Math.min(...members.map((item) => item.rank)),
      bottom: Math.max(...members.map((item) => item.rank)),
    });
  }

  // 长边拆成虚拟节点；标签落在中间层
  let dummySeq = 100000;
  const dummyItems = [];
  for (const le of layoutEdges) {
    const a = le.fromItem;
    const b = le.toItem;
    const span = b.rank - a.rank;
    if (span <= 0) {
      le.edge.skip = true;
      continue;
    }
    const chain = [a];
    let labelRank = le.edge.label ? a.rank + Math.max(1, Math.floor(span / 2)) : -1;
    if (le.edge.label && (le.fromFrame || le.toFrame)) {
      const candidates = [];
      const lowIsFrame = le.reversed ? le.toFrame : le.fromFrame;
      const highIsFrame = le.reversed ? le.fromFrame : le.toFrame;
      const lowFrameId = le.reversed ? le.edge.to : le.edge.from;
      const highFrameId = le.reversed ? le.edge.from : le.edge.to;
      if (lowIsFrame) {
        const range = frameRankRanges.get(lowFrameId);
        if (range && b.rank < range.top) candidates.push(b.rank + Math.max(1, Math.floor((range.top - b.rank) / 2)));
        else if (range && b.rank > range.bottom) candidates.push(range.bottom + Math.max(1, Math.floor((b.rank - range.bottom) / 2)));
      }
      if (highIsFrame) {
        const range = frameRankRanges.get(highFrameId);
        if (range && a.rank < range.top) candidates.push(a.rank + Math.max(1, Math.floor((range.top - a.rank) / 2)));
        else if (range && a.rank > range.bottom) candidates.push(range.bottom + Math.max(1, Math.floor((a.rank - range.bottom) / 2)));
      }
      const valid = candidates.filter((rank) => rank > a.rank && rank < b.rank);
      if (valid.length) labelRank = valid[0];
    }
    for (let r = a.rank + 1; r < b.rank; r += 1) {
      const isLabel = r === labelRank;
      let tw = 4;
      let th = 4;
      let labelLines = [];
      if (isLabel) {
        labelLines = wrapText(le.edge.label, 160, FONT.label, measure);
        tw = Math.max(26, maxWidthOf(labelLines, FONT.label, measure) + 10);
        th = Math.max(18, labelLines.length * 16 + 6);
      }
      const item = {
        kind: isLabel ? 'label' : 'dummy',
        id: `@@${le.edge.seq}:${r}`,
        seq: dummySeq++,
        rank: r,
        edge: le.edge,
        owner: le.owner,
        cluster: le.owner,
        tw,
        th,
        bw: isLR ? th : tw,
        bh: isLR ? tw : th,
        labelLines,
        offsetCross: 0,
        up: [],
        down: [],
      };
      dummyItems.push(item);
      chain.push(item);
      allItems.push(item);
    }
    chain.push(b);
    le.chain = chain;
    for (let i = 0; i < chain.length - 1; i += 1) {
      chain[i].down.push(chain[i + 1]);
      chain[i + 1].up.push(chain[i]);
    }
  }

  const rankItems = new Map();
  for (const item of allItems) {
    if (!rankItems.has(item.rank)) rankItems.set(item.rank, []);
    rankItems.get(item.rank).push(item);
  }
  for (const [r, items] of rankItems) {
    items.sort((a, b) => a.seq - b.seq);
    rankItems.set(r, items);
  }
  const maxRank = Math.max(...rankItems.keys());

  const clusterItemsAtRank = (cluster, r) => (rankItems.get(r) || []).filter((item) => isDescendantOf(item.cluster, cluster));

  // 子图在某一层是否“在场”：按真实成员的层范围判断，而不是该层恰好有没有成员。
  // 一个子图在它的整个矩形高度内都占着横带；只在范围外的层让出横带，框外节点才能挪到框正上方。
  const childPresentAt = (child, r) => {
    const range = frameRankRanges.get(child.id);
    return Boolean(range) && r >= range.top && r <= range.bottom;
  };

  const buildOrder = (cluster, r, bc) => {
    const items = rankItems.get(r) || [];
    const direct = items.filter((item) => item.cluster === cluster);
    const children = cluster.children.filter((child) => childPresentAt(child, r));
    const childBC = new Map();
    for (const child of children) {
      const childItems = clusterItemsAtRank(child, r);
      if (childItems.length) {
        childBC.set(child, childItems.reduce((sum, item) => sum + (bc.get(item) ?? 0), 0) / childItems.length);
        continue;
      }
      // 在场但没有本层直接成员（成员都在更深的子图里）：取最近一层成员的排序位置作回退
      const range = frameRankRanges.get(child.id);
      let fallback = 0;
      for (let delta = 1; range && delta <= range.bottom - range.top; delta += 1) {
        const found = [r - delta, r + delta]
          .filter((rank) => rank >= range.top && rank <= range.bottom)
          .map((rank) => (rankItems.get(rank) || []).filter((item) => isDescendantOf(item.cluster, child)))
          .find((list) => list.length > 0);
        if (!found) continue;
        const known = found.map((item) => bc.get(item)).filter((value) => value != null);
        if (known.length) fallback = known.reduce((sum, value) => sum + value, 0) / known.length;
        else {
          const list = rankItems.get(found[0].rank) || [];
          fallback = found.reduce((sum, item) => sum + list.indexOf(item), 0) / found.length;
        }
        break;
      }
      childBC.set(child, fallback);
    }
    direct.sort((a, b) => (bc.get(a) ?? 0) - (bc.get(b) ?? 0) || a.seq - b.seq);
    const gaps = Array.from({ length: children.length + 1 }, () => []);
    for (const item of direct) {
      let gap = 0;
      for (const child of children) if ((bc.get(item) ?? 0) > (childBC.get(child) ?? 0)) gap += 1;
      item.gapIndex = gap;
      gaps[gap].push(item);
    }
    const result = [];
    for (let g = 0; g <= children.length; g += 1) {
      result.push(...gaps[g]);
      if (g < children.length) result.push(...buildOrder(children[g], r, bc));
    }
    return result;
  };

  const orderRank = (r, side) => {
    const items = rankItems.get(r) || [];
    if (!items.length) return;
    const current = new Map(items.map((item, index) => [item, index]));
    const adjacent = rankItems.get(side === 'up' ? r - 1 : r + 1) || [];
    const adjacentIndex = new Map(adjacent.map((item, index) => [item, index]));
    const bc = new Map();
    for (const item of items) {
      const neighbors = (side === 'up' ? item.up : item.down)
        .map((neighbor) => adjacentIndex.get(neighbor))
        .filter((index) => index != null);
      bc.set(item, neighbors.length
        ? neighbors.reduce((sum, index) => sum + index, 0) / neighbors.length
        : (current.get(item) ?? 0));
    }
    const next = buildOrder(root, r, bc);
    if (next.length !== items.length) return;
    rankItems.set(r, next);
  };

  for (let iter = 0; iter < 4; iter += 1) {
    for (let r = 1; r <= maxRank; r += 1) orderRank(r, 'up');
    for (let r = maxRank - 1; r >= 0; r -= 1) orderRank(r, 'down');
  }

  // 相邻交换：只在同一 gap 的兄弟之间换，保持子图成员连续
  const linksBetween = (r) => {
    const top = rankItems.get(r) || [];
    const bottom = rankItems.get(r + 1) || [];
    const topIndex = new Map(top.map((item, index) => [item, index]));
    const bottomIndex = new Map(bottom.map((item, index) => [item, index]));
    const links = [];
    for (const item of top) {
      for (const neighbor of item.down) {
        if (neighbor.rank === r + 1) links.push([topIndex.get(item), bottomIndex.get(neighbor)]);
      }
    }
    return links;
  };
  const crossings = (r) => {
    if (r < 0 || r >= maxRank) return 0;
    const links = linksBetween(r);
    let count = 0;
    for (let i = 0; i < links.length; i += 1) {
      for (let j = i + 1; j < links.length; j += 1) {
        if ((links[i][0] - links[j][0]) * (links[i][1] - links[j][1]) < 0) count += 1;
      }
    }
    return count;
  };
  for (let pass = 0; pass < 2; pass += 1) {
    for (let r = 0; r <= maxRank; r += 1) {
      const items = rankItems.get(r);
      if (!items) continue;
      for (let i = 0; i < items.length - 1; i += 1) {
        const a = items[i];
        const b = items[i + 1];
        if (a.cluster !== b.cluster || (a.gapIndex || 0) !== (b.gapIndex || 0)) continue;
        const before = crossings(r - 1) + crossings(r);
        items[i] = b;
        items[i + 1] = a;
        const after = crossings(r - 1) + crossings(r);
        if (after < before) {
          // 换过之后保持连续，不需要重建块结构
        } else {
          items[i] = a;
          items[i + 1] = b;
        }
      }
    }
  }

  // 恢复声明顺序：若相邻真实节点写反了，且换回来不会增加跨层交叉，则按输入顺序排列
  for (let pass = 0; pass < 2; pass += 1) {
    for (let r = 0; r <= maxRank; r += 1) {
      const items = rankItems.get(r);
      if (!items) continue;
      for (let i = 0; i < items.length - 1; i += 1) {
        const a = items[i];
        const b = items[i + 1];
        if (a.kind !== 'node' || b.kind !== 'node') continue;
        if (a.cluster !== b.cluster || (a.gapIndex || 0) !== (b.gapIndex || 0)) continue;
        if (a.seq < b.seq) continue;
        const before = crossings(r - 1) + crossings(r);
        items[i] = b;
        items[i + 1] = a;
        const after = crossings(r - 1) + crossings(r);
        if (after <= before) continue;
        items[i] = a;
        items[i + 1] = b;
      }
    }
  }

  // 子图带宽度：父级为子图预留固定横带，兄弟子图在所有层保持同一顺序。
  // 每层按“在场子图”把直接成员切成若干段，段宽必须容下该层这一段里的成员。
  const clusterGap = 20;
  const rankSegments = (cluster, r) => {
    const active = [];
    cluster.children.forEach((child, index) => {
      if (childPresentAt(child, r)) active.push(index);
    });
    const segments = [];
    for (let s = 0; s <= active.length; s += 1) {
      segments.push({
        gStart: s === 0 ? 0 : active[s - 1] + 1,
        gEnd: s === active.length ? cluster.children.length : active[s],
        leftChild: s === 0 ? null : active[s - 1],
        rightChild: s === active.length ? null : active[s],
      });
    }
    return segments;
  };
  const segmentNatural = (list) => list.reduce(
    (sum, item, index) => sum + item.bw + (index ? hgap(list[index - 1], item) : 0),
    0,
  );
  const computeWidths = (cluster) => {
    for (const child of cluster.children) computeWidths(child);
    const children = cluster.children;
    const gapWidths = Array.from({ length: children.length + 1 }, () => 0);
    const singles = [];
    const multis = [];
    for (const [r, items] of rankItems) {
      const segments = rankSegments(cluster, r);
      const byGap = new Map();
      for (const item of items) {
        if (item.cluster !== cluster) continue;
        const gap = item.gapIndex || 0;
        if (!byGap.has(gap)) byGap.set(gap, []);
        byGap.get(gap).push(item);
      }
      for (const [gap, list] of byGap) {
        const seg = segments[gap] || segments[segments.length - 1];
        const entry = { ...seg, natural: segmentNatural(list) };
        if (entry.gStart === entry.gEnd) singles.push(entry);
        else multis.push(entry);
      }
    }
    // 单 gap 段直接给出下界；多 gap 段按当前跨度从窄到宽补缺口，缺口由覆盖的 gap 平分。
    // 补只增不减，所以已处理的段不会重新失衡。空 gap 不占位也不产生间隔：
    // 一旦补出宽度，它与相邻槽之间才会多出 clusterGap，因此每轮都要按新宽度重算跨度。
    for (const seg of singles) {
      gapWidths[seg.gStart] = Math.max(gapWidths[seg.gStart], seg.natural);
    }
    const spanOf = (seg) => {
      let width = 0;
      let bands = 0;
      for (let g = seg.gStart; g <= seg.gEnd; g += 1) {
        if (gapWidths[g] <= 0) continue;
        width += gapWidths[g];
        bands += 1;
      }
      for (let c = seg.gStart; c < seg.gEnd; c += 1) {
        width += children[c].width;
        bands += 1;
      }
      return width + clusterGap * Math.max(0, bands - 1);
    };
    const ordered = multis
      .map((seg) => ({ ...seg, span: spanOf(seg) }))
      .sort((a, b) => a.span - b.span || a.gStart - b.gStart || a.gEnd - b.gEnd || a.natural - b.natural);
    for (const seg of ordered) {
      // 补宽可能把空 gap 变成非空，跨度会额外增加 separator；循环到满足为止即可
      for (let guard = 0; guard < 8; guard += 1) {
        const span = spanOf(seg);
        if (seg.natural <= span + 1e-9) break;
        const count = seg.gEnd - seg.gStart + 1;
        const add = (seg.natural - span) / count;
        for (let g = seg.gStart; g <= seg.gEnd; g += 1) gapWidths[g] += add;
      }
    }
    // 空 gap 不占 slot：相邻子图之间只留一个 clusterGap，空的外侧 gap 不额外占位
    const slots = [];
    for (let g = 0; g <= children.length; g += 1) {
      if (gapWidths[g] > 0) slots.push({ kind: 'gap', gap: g, width: gapWidths[g] });
      if (g < children.length) slots.push({ kind: 'child', child: children[g], width: children[g].width });
    }
    const contentWidth = slots.reduce((sum, slot, index) => sum + slot.width + (index ? clusterGap : 0), 0);
    // 宽框按内容宽度重排标题：标题尽量一行，但不反过来把框撑宽。
    if (cluster !== root && contentWidth > 200) {
      layoutClusterTitle(cluster, contentWidth);
    }
    let width;
    if (cluster === root) width = contentWidth;
    else {
      const crossTitle = isLR ? cluster.titleBand : 0;
      const titleMin = isLR || contentWidth > 200 ? 0 : cluster.titleW + FRAME_PAD * 2;
      width = Math.max(contentWidth + FRAME_PAD * 2 + crossTitle, titleMin);
    }
    cluster.contentWidth = contentWidth;
    cluster.gapWidths = gapWidths;
    cluster.slots = slots;
    cluster.width = width;
  };
  computeWidths(root);

  const placeCluster = (cluster, left) => {
    cluster.left = left;
    const pad = cluster === root ? 0 : FRAME_PAD;
    const titleBand = isLR && cluster !== root ? cluster.titleBand : 0;
    const innerLeft = left + pad + titleBand;
    const innerWidth = cluster.width - pad * 2 - titleBand;
    cluster.innerLeft = innerLeft;
    const offset = Math.max(0, (innerWidth - cluster.contentWidth) / 2);
    let cursor = innerLeft + offset;
    const contentLeft = cursor;
    const contentRight = contentLeft + cluster.contentWidth;
    cluster.slots.forEach((slot, index) => {
      slot.left = cursor;
      if (slot.kind === 'child') placeCluster(slot.child, cursor);
      cursor += slot.width + (index < cluster.slots.length - 1 ? clusterGap : 0);
    });
    // 成员的可用横区间来自所在层的段：边界贴住最近的在场子图横带并留 clusterGap，
    // 不在场子图与空 gap 不占横带，成员可以从上方跨过它们。
    for (const [r, items] of rankItems) {
      const segments = rankSegments(cluster, r);
      const byGap = new Map();
      for (const item of items) {
        if (item.cluster !== cluster) continue;
        const gap = item.gapIndex || 0;
        if (!byGap.has(gap)) byGap.set(gap, []);
        byGap.get(gap).push(item);
      }
      for (const [gap, list] of byGap) {
        const seg = segments[gap] || segments[segments.length - 1];
        const leftChild = seg.leftChild == null ? null : cluster.children[seg.leftChild];
        const rightChild = seg.rightChild == null ? null : cluster.children[seg.rightChild];
        const slotLeft = leftChild ? leftChild.left + leftChild.width + clusterGap : contentLeft;
        const slotRight = Math.max(slotLeft, rightChild ? rightChild.left - clusterGap : contentRight);
        const natural = segmentNatural(list);
        let x = slotLeft + Math.max(0, (slotRight - slotLeft - natural) / 2);
        list.forEach((item, index) => {
          item.slotLeft = slotLeft;
          item.slotRight = slotRight;
          item.centerX = x + item.bw / 2;
          if (index < list.length - 1) x += item.bw + hgap(item, list[index + 1]);
        });
      }
    }
  };
  placeCluster(root, 0);

  const anchorX = (item) => item.centerX + (item.offsetCross || 0);
  // 每层、每个父框段一组成员；段内成员共享同一对 slotLeft / slotRight
  const segmentGroups = [];
  for (const [r, items] of rankItems) {
    const groups = new Map();
    for (const item of items) {
      const key = `${item.cluster.id ?? '@root'}#${item.gapIndex || 0}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    for (const list of groups.values()) segmentGroups.push({ rank: r, items: list });
  }
  for (let iter = 0; iter < 8; iter += 1) {
    const down = iter % 2 === 0;
    const ranks = down ? [...rankItems.keys()].sort((a, b) => a - b) : [...rankItems.keys()].sort((a, b) => b - a);
    for (const r of ranks) {
      for (const group of segmentGroups) {
        if (group.rank !== r) continue;
        const items = group.items;
        const desired = items.map((item) => {
          const neighbors = (down ? item.up : item.down).map(anchorX);
          if (!neighbors.length) return item.centerX;
          const target = neighbors.reduce((sum, value) => sum + value, 0) / neighbors.length;
          return target - (item.offsetCross || 0);
        });
        let cursor = items[0].slotLeft;
        for (let i = 0; i < items.length; i += 1) {
          const item = items[i];
          const min = (i === 0 ? item.slotLeft : cursor) + item.bw / 2;
          const max = item.slotRight - item.bw / 2;
          let center = Number.isFinite(desired[i]) ? desired[i] : min;
          center = Math.max(min, Math.min(max, center));
          item.centerX = center;
          cursor = center + item.bw / 2 + (i < items.length - 1 ? hgap(item, items[i + 1]) : 0);
        }
        let limit = items[items.length - 1].slotRight;
        for (let i = items.length - 1; i >= 0; i -= 1) {
          const item = items[i];
          const max = (i === items.length - 1 ? item.slotRight : limit) - item.bw / 2;
          const min = item.slotLeft + item.bw / 2;
          item.centerX = Math.max(min, Math.min(max, item.centerX));
          limit = item.centerX - item.bw / 2 - (i > 0 ? hgap(items[i - 1], item) : 0);
        }
      }
    }
  }

  // 长边拉直：目标 Σ Ω·|x_u − x_v|（真实-真实 1、真实-虚拟 2、虚拟-虚拟 8，dot 权重）。
  // 单个点只在同段邻居与段边界给出的自由区间内移动；长边的整条虚拟链尽量落到同一 x。
  const omegaOf = (a, b) => {
    const aVirtual = a.kind !== 'real';
    const bVirtual = b.kind !== 'real';
    if (aVirtual && bVirtual) return 8;
    if (aVirtual || bVirtual) return 2;
    return 1;
  };
  const segmentEntry = new Map();
  for (const group of segmentGroups) {
    group.items.forEach((item, index) => segmentEntry.set(item, { group, index }));
  }
  const freeInterval = (item) => {
    const entry = segmentEntry.get(item);
    const items = entry.group.items;
    let min = item.slotLeft + item.bw / 2;
    let max = item.slotRight - item.bw / 2;
    if (entry.index > 0) {
      const prev = items[entry.index - 1];
      min = Math.max(min, prev.centerX + prev.bw / 2 + hgap(prev, item) + item.bw / 2);
    }
    if (entry.index < items.length - 1) {
      const next = items[entry.index + 1];
      max = Math.min(max, next.centerX - next.bw / 2 - hgap(item, next) - item.bw / 2);
    }
    return min <= max ? { min, max } : { min: item.centerX, max: item.centerX };
  };
  const weightedMedian = (entries) => {
    const sorted = [...entries].sort((a, b) => a.value - b.value || b.weight - a.weight);
    const total = sorted.reduce((sum, entry) => sum + entry.weight, 0);
    let acc = 0;
    for (const entry of sorted) {
      acc += entry.weight;
      if (acc >= total / 2 - 1e-9) return entry.value;
    }
    return sorted[sorted.length - 1].value;
  };
  const clampTo = (value, interval) => Math.max(interval.min, Math.min(interval.max, value));
  const incidentCost = (item, centerX) => {
    const anchor = centerX + (item.offsetCross || 0);
    let cost = 0;
    for (const neighbor of item.up) cost += omegaOf(item, neighbor) * Math.abs(anchor - anchorX(neighbor));
    for (const neighbor of item.down) cost += omegaOf(item, neighbor) * Math.abs(anchor - anchorX(neighbor));
    return cost;
  };
  const chainCost = (chain, overrides) => {
    let cost = 0;
    for (let i = 0; i < chain.length - 1; i += 1) {
      const a = chain[i];
      const b = chain[i + 1];
      const ax = overrides && overrides.has(a) ? overrides.get(a) : anchorX(a);
      const bx = overrides && overrides.has(b) ? overrides.get(b) : anchorX(b);
      cost += omegaOf(a, b) * Math.abs(ax - bx);
    }
    return cost;
  };
  const trySingleMove = (item) => {
    const neighbors = [...item.up, ...item.down];
    if (!neighbors.length) return false;
    const median = weightedMedian(neighbors.map((neighbor) => ({
      value: anchorX(neighbor),
      weight: omegaOf(item, neighbor),
    })));
    const target = clampTo(median - (item.offsetCross || 0), freeInterval(item));
    if (Math.abs(target - item.centerX) < 0.01) return false;
    const before = incidentCost(item, item.centerX);
    const after = incidentCost(item, target);
    if (after > before - 0.01) return false;
    item.centerX = target;
    return true;
  };
  const runInterval = (items) => {
    let min = -Infinity;
    let max = Infinity;
    for (const item of items) {
      const interval = freeInterval(item);
      min = Math.max(min, interval.min);
      max = Math.min(max, interval.max);
      if (min > max + 1e-9) return null;
    }
    return { min, max };
  };
  const tryChainMove = (le) => {
    const chain = le.chain;
    if (!chain || chain.length < 3) return false;
    const members = chain.slice(1, -1);
    if (!members.every((item) => segmentEntry.has(item))) return false;
    const before = chainCost(chain, null);
    const all = runInterval(members);
    if (all) {
      const low = anchorX(chain[0]);
      const high = anchorX(chain[chain.length - 1]);
      const mean = members.reduce((sum, item) => sum + anchorX(item), 0) / members.length;
      // 端点之间的任意 x 代价相同；取离当前链均值最近的位置。
      // 端点区间和可行交集不相交时，取可行交集里离端点区间最近的一侧，把链往端点方向拉。
      const best = { min: Math.max(all.min, Math.min(low, high)), max: Math.min(all.max, Math.max(low, high)) };
      let target;
      if (best.min <= best.max) target = clampTo(mean, best);
      else if (all.max < Math.min(low, high)) target = all.max;
      else target = all.min;
      const overrides = new Map(members.map((item) => [item, target]));
      if (chainCost(chain, overrides) > before - 0.01) return false;
      for (const item of members) item.centerX = target;
      return true;
    }
    // 交集为空：对齐最长可共线的前缀与后缀，中间保持不动
    let prefix = 0;
    while (prefix < members.length && runInterval(members.slice(0, prefix + 1))) prefix += 1;
    let suffix = 0;
    while (suffix < members.length && runInterval(members.slice(members.length - suffix - 1))) suffix += 1;
    if (prefix + suffix > members.length) {
      if (prefix >= suffix) suffix = members.length - prefix;
      else prefix = members.length - suffix;
    }
    let moved = false;
    const alignRun = (items, outside) => {
      if (items.length < 2) return false;
      const interval = runInterval(items);
      if (!interval) return false;
      const leftmost = members.indexOf(items[0]);
      const nextItem = leftmost > 0 ? members[leftmost - 1] : members[leftmost + items.length];
      const entries = [{ value: anchorX(outside), weight: 2 }];
      if (nextItem) entries.push({ value: anchorX(nextItem), weight: 8 });
      const target = clampTo(weightedMedian(entries), interval);
      const overrides = new Map(items.map((item) => [item, target]));
      if (chainCost(chain, overrides) > chainCost(chain, null) - 0.01) return false;
      for (const item of items) item.centerX = target;
      return true;
    };
    if (prefix >= 2) moved = alignRun(members.slice(0, prefix), chain[0]) || moved;
    if (suffix >= 2) moved = alignRun(members.slice(members.length - suffix), chain[chain.length - 1]) || moved;
    return moved;
  };
  for (let pass = 0; pass < 40; pass += 1) {
    let accepted = false;
    for (const [, items] of [...rankItems.entries()].sort((a, b) => a[0] - b[0])) {
      for (const item of items) if (trySingleMove(item)) accepted = true;
    }
    for (const le of layoutEdges) if (tryChainMove(le)) accepted = true;
    if (!accepted) break;
  }

  // 虚拟点避让相邻层的高节点：曲线从虚拟点出发时不要贴着高节点的圆角/边缘。
  // 拉直过的长边按整条链一起挪；链上没有共同空位就不动，避免把直线再掰弯。
  const edgeOfItem = new Map();
  for (const le of layoutEdges) {
    if (!le.chain) continue;
    for (const item of le.chain) edgeOfItem.set(item, le);
  }
  const realAtRank = new Map();
  for (const item of realItems) {
    if (!realAtRank.has(item.rank)) realAtRank.set(item.rank, []);
    realAtRank.get(item.rank).push(item);
  }
  const separateGap = (items) => {
    if (!items.length) return;
    let cursor = items[0].slotLeft;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const min = (i === 0 ? item.slotLeft : cursor) + item.bw / 2;
      const max = item.slotRight - item.bw / 2;
      item.centerX = Math.max(min, Math.min(max, item.centerX));
      cursor = item.centerX + item.bw / 2 + (i < items.length - 1 ? hgap(item, items[i + 1]) : 0);
    }
    let limit = items[items.length - 1].slotRight;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      const max = (i === items.length - 1 ? item.slotRight : limit) - item.bw / 2;
      const min = item.slotLeft + item.bw / 2;
      item.centerX = Math.max(min, Math.min(max, item.centerX));
      limit = item.centerX - item.bw / 2 - (i > 0 ? hgap(items[i - 1], item) : 0);
    }
  };
  for (let pass = 0; pass < 4; pass += 1) {
    for (const dummy of dummyItems) {
      if (dummy.kind !== 'dummy') continue;
      for (const rank of [dummy.rank - 1, dummy.rank + 1]) {
        // 只看链上位于该层的邻居；若邻居就是该节点，端口会正对它，不需要避让
        const neighborsAtRank = (rank < dummy.rank ? dummy.up : dummy.down)
          .filter((item) => item.rank === rank);
        if (!neighborsAtRank.length) continue;
        for (const node of realAtRank.get(rank) || []) {
          if (neighborsAtRank.includes(node)) continue;
          const center = node.centerX + (node.offsetCross || 0);
          const half = (isLR ? node.th : node.tw) / 2 + 14;
          if (Math.abs(dummy.centerX - center) >= half) continue;
          // 链上邻居在节点的哪一侧，虚拟点就绕到哪一侧
          const neighborX = neighborsAtRank
            .map((item) => item.centerX + (item.offsetCross || 0))
            .reduce((sum, value) => sum + value, 0) / neighborsAtRank.length;
          const target = neighborX < center ? center - half : center + half;
          const le = edgeOfItem.get(dummy);
          const members = le && le.chain ? le.chain.slice(1, -1) : [dummy];
          const interval = runInterval(members);
          if (!interval) continue;
          const x = clampTo(target, interval);
          if (Math.abs(x - dummy.centerX) < 0.01) continue;
          for (const member of members) member.centerX = x;
        }
      }
    }
    for (const group of segmentGroups) separateGap(group.items);
  }

  /* ── 纵向对齐 + 横向压实（R4，Brandes–Köpf 风格）──
   * 1. 每个点最多挑一个主上邻：实线优先，其次最长路径上的边，再取上邻 x 的中位，最后按源顺序；
   *    每个父节点最多认一个对齐子节点，且对齐线不许交叉 ⇒ 对齐链互不冲突。
   * 2. 对齐链合成一个块，块内共用一个 x，主路径因此笔直（不再一格一格被侧枝拉成 S 形）。
   * 3. 块之间按层内顺序做最小间距压实：带 slot 边界的前后向松弛，侧枝整块让位。
   */
  if (model.type === 'er') {
    // ER 关系线保持旧版平滑曲线：横向位置也沿用旧的单点/整链微调，布局与基线逐字节一致
    for (let pass = 0; pass < 40; pass += 1) {
      let accepted = false;
      for (const [, items] of [...rankItems.entries()].sort((a, b) => a[0] - b[0])) {
        for (const item of items) if (trySingleMove(item)) accepted = true;
      }
      for (const le of layoutEdges) if (tryChainMove(le)) accepted = true;
      if (!accepted) break;
    }
  } else {
    // 对齐前的位置来自 slot 排版，节点互不重叠；压实无解时回退到这里。
    const beforeAlign = new Map();
    for (const items of rankItems.values()) for (const item of items) beforeAlign.set(item, item.centerX);
    {
      const linkKey = (a, b) => `${a.seq}>${b.seq}`;
      const linkInfo = new Map();
      for (const le of layoutEdges) {
        if (!le.chain) continue;
        for (let i = 0; i + 1 < le.chain.length; i += 1) {
          linkInfo.set(linkKey(le.chain[i], le.chain[i + 1]), le);
        }
      }
      // 回边由外侧通道走线，它的虚拟点不参与对齐，免得挡住主路径
      const isBackLink = (le) => Boolean(le && le.reversed);
      const styleRank = (le) => {
        const style = le && le.edge ? le.edge.style : null;
        if (style === 'dotted') return 2;
        if (style === 'dashed') return 1;
        return 0;
      };
      const ranksAsc = [...rankItems.keys()].sort((a, b) => a - b);
      const upsOf = (item) => item.up.filter((up) => up.rank === item.rank - 1);
      const downsOf = (item) => item.down.filter((down) => down.rank === item.rank + 1);
      const level = new Map();
      for (const r of ranksAsc) {
        for (const item of rankItems.get(r) || []) {
          const ups = upsOf(item);
          level.set(item, ups.length ? Math.max(...ups.map((up) => level.get(up) + 1)) : 0);
        }
      }
      const height = new Map();
      for (const r of [...ranksAsc].reverse()) {
        for (const item of rankItems.get(r) || []) {
          const downs = downsOf(item);
          height.set(item, downs.length ? Math.max(...downs.map((down) => height.get(down) + 1)) : 0);
        }
      }
      const totalSpan = Math.max(0, ...height.values());
      const onLongest = (up, item) => (level.get(up) + 1 + height.get(item) >= totalSpan ? 0 : 1);

      // 1. 主上邻
      const primaryUp = new Map();
      for (const r of ranksAsc) {
        if (r === 0) continue;
        for (const item of rankItems.get(r) || []) {
          const ups = upsOf(item);
          if (!ups.length) {
            primaryUp.set(item, null);
            continue;
          }
          const scored = ups
            .filter((up) => !isBackLink(linkInfo.get(linkKey(up, item))))
            .map((up) => {
              const le = linkInfo.get(linkKey(up, item));
              return {
                up, style: styleRank(le), crit: onLongest(up, item), x: anchorX(up), seq: up.seq,
              };
            });
          if (!scored.length) {
            primaryUp.set(item, null);
            continue;
          }
          const bestStyle = Math.min(...scored.map((s) => s.style));
          const byStyle = scored.filter((s) => s.style === bestStyle);
          const bestCrit = Math.min(...byStyle.map((s) => s.crit));
          const pool = byStyle.filter((s) => s.crit === bestCrit);
          const xs = pool.map((s) => s.x).sort((a, b) => a - b);
          const mid = xs.length % 2
            ? xs[(xs.length - 1) / 2]
            : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
          pool.sort((a, b) => Math.abs(a.x - mid) - Math.abs(b.x - mid) || a.seq - b.seq);
          primaryUp.set(item, pool[0].up);
        }
      }

      // 2. 对齐（父最多一个子，对齐线不交叉；主路径上的边先占位）
      // 交叉判定用层内序号而不是当前 x：对齐后块内的 x 会统一，用 x 判会把本来嵌套的两段误判成交叉。
      const orderIndex = new Map();
      for (const r of ranksAsc) {
        (rankItems.get(r) || []).forEach((item, index) => orderIndex.set(item, index));
      }
      const pairs = [];
      const hasChild = new Set();
      for (const r of ranksAsc) {
        if (r === 0) continue;
        const entries = (rankItems.get(r) || []).map((item) => {
          const up = primaryUp.get(item);
          const le = up ? linkInfo.get(linkKey(up, item)) : null;
          return {
            item,
            up: up && !isBackLink(le) ? up : null,
            style: styleRank(le),
            crit: up ? onLongest(up, item) : 1,
          };
        });
        entries.sort((a, b) => a.crit - b.crit || a.style - b.style
          || anchorX(a.up || a.item) - anchorX(b.up || b.item) || a.item.seq - b.item.seq);
        for (const entry of entries) {
          const { item, up } = entry;
          if (!up || hasChild.has(up)) continue;
          const ui = orderIndex.get(up);
          const vi = orderIndex.get(item);
          let crossing = false;
          for (const [pu, pv] of pairs) {
            if ((orderIndex.get(pu) - ui) * (orderIndex.get(pv) - vi) < 0) {
              crossing = true;
              break;
            }
          }
          if (crossing) continue;
          pairs.push([up, item]);
          hasChild.add(up);
        }
      }
      const alignUp = new Map(pairs.map(([up, item]) => [item, up]));

      // 3. 块
      const blockOf = new Map();
      for (const r of ranksAsc) {
        for (const item of rankItems.get(r) || []) {
          const up = alignUp.get(item);
          if (up && blockOf.has(up)) {
            const block = blockOf.get(up);
            block.items.push(item);
            blockOf.set(item, block);
          } else {
            blockOf.set(item, { id: blockOf.size, items: [item] });
          }
        }
      }
      // 对齐后的竖走廊若正好穿过无关节点，就把这块拆回单点（长边绕行，别穿节点）
      const crossRect = (item) => ({
        x: item.centerX + (item.offsetCross || 0) - (isLR ? item.th : item.tw) / 2,
        w: isLR ? item.th : item.tw,
      });
      const corridorBlocked = (block) => {
        const xs = block.items.map(anchorX).sort((a, b) => a - b);
        const mid = xs.length % 2
          ? xs[(xs.length - 1) / 2]
          : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
        const ranks = block.items.map((item) => item.rank);
        const lo = Math.min(...ranks);
        const hi = Math.max(...ranks);
        for (const item of realItems) {
          if (item.rank <= lo || item.rank >= hi) continue;
          if (block.items.includes(item)) continue;
          const rect = crossRect(item);
          if (mid > rect.x - 8 && mid < rect.x + rect.w + 8) return true;
        }
        return false;
      };
      for (const block of [...new Set(blockOf.values())]) {
        if (block.items.length < 2 || !corridorBlocked(block)) continue;
        for (const item of block.items) blockOf.set(item, { id: blockOf.size, items: [item] });
      }
      // 同一条长边的连续虚拟点并成一块：整条长边拉成一条竖线，而不是逐层折来折去
      for (const le of layoutEdges) {
        if (!le.chain || le.chain.length < 3) continue;
        let run = [];
        const flush = () => {
          if (run.length > 1) {
            const first = blockOf.get(run[0]);
            for (const item of run.slice(1)) {
              const block = blockOf.get(item);
              if (!block || block === first) continue;
              for (const member of block.items) {
                blockOf.set(member, first);
                first.items.push(member);
              }
              block.items = [];
            }
          }
          run = [];
        };
        for (const item of le.chain.slice(1, -1)) {
          if (item.kind !== 'dummy') { flush(); continue; }
          if (run.length && item.rank !== run[run.length - 1].rank + 1) flush();
          run.push(item);
        }
        flush();
      }
      const blocks = [...new Set(blockOf.values())];
      const blockIndex = new Map(blocks.map((block, index) => [block, index]));

      // 4. 相邻块之间的最小间距（同层段内左右相邻）
      const constraintMap = new Map();
      for (const group of segmentGroups) {
        const order = [];
        for (const item of group.items) {
          const block = blockOf.get(item);
          if (!block) continue;
          if (order.length && order[order.length - 1].block === block) continue;
          order.push({ block, item });
        }
        for (let i = 1; i < order.length; i += 1) {
          const a = order[i - 1];
          const b = order[i];
          const sep = a.item.bw / 2 + hgap(a.item, b.item) + b.item.bw / 2;
          const key = `${blockIndex.get(a.block)}>${blockIndex.get(b.block)}`;
          const prev = constraintMap.get(key);
          if (!prev) constraintMap.set(key, { a: a.block, b: b.block, sep });
          else prev.sep = Math.max(prev.sep, sep);
        }
      }
      const constraints = [...constraintMap.values()];

      // 5. 块的期望位置与可用区间；区间为空的块放弃对齐（保持逐点位置）
      const spanOf = (block) => {
        let min = -Infinity;
        let max = Infinity;
        const xs = [];
        for (const item of block.items) {
          // 顶层成员的 slot 只是排版参考：块可以越出排版框（画布会跟着变宽），
          // 只有子图内成员必须留在框内，否则帧内边距会被破坏。
          if (item.cluster && item.cluster !== root) {
            min = Math.max(min, item.slotLeft + item.bw / 2 - (item.offsetCross || 0));
            max = Math.min(max, item.slotRight - item.bw / 2 - (item.offsetCross || 0));
          }
          xs.push(anchorX(item));
        }
        if (min > max + 0.01) return null;
        xs.sort((a, b) => a - b);
        const mid = xs.length % 2
          ? xs[(xs.length - 1) / 2]
          : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
        return { min, max, mid };
      };
      const spans = new Map();
      for (const block of blocks) {
        const s = spanOf(block);
        if (!s) {
          for (const item of block.items) blockOf.delete(item);
          continue;
        }
        spans.set(block, s);
      }
      const pos = new Map();
      for (const [block, s] of spans) pos.set(block, Math.max(s.min, Math.min(s.max, s.mid)));
      const alive = constraints.filter((c) => spans.has(c.a) && spans.has(c.b) && c.a !== c.b);
      const move = (block, value) => {
        const s = spans.get(block);
        if (!s) return;
        pos.set(block, Math.max(s.min, Math.min(s.max, value)));
      };
      // 拓扑序压实：每个块先取自己的期望位置，再把左侧块推过来的要求并进去。
      // 交替松弛在有环 / 无界区间（顶层块）时会来回震荡，最后留下重叠（#263）。
      const nexts = new Map(blocks.map((block) => [block, []]));
      const indeg = new Map(blocks.map((block) => [block, 0]));
      for (const c of alive) {
        nexts.get(c.a).push(c);
        indeg.set(c.b, indeg.get(c.b) + 1);
      }
      const queue = blocks.filter((block) => spans.has(block) && indeg.get(block) === 0);
      queue.sort((a, b) => pos.get(a) - pos.get(b));
      const order = [];
      while (queue.length) {
        const block = queue.shift();
        order.push(block);
        for (const c of nexts.get(block)) {
          indeg.set(c.b, indeg.get(c.b) - 1);
          if (indeg.get(c.b) === 0) queue.push(c.b);
        }
      }
      if (order.length < blocks.length) {
        const rest = blocks.filter((block) => !order.includes(block));
        rest.sort((a, b) => pos.get(a) - pos.get(b));
        order.push(...rest);
      }
      for (const block of order) {
        let want = pos.get(block);
        for (const c of alive) if (c.b === block) want = Math.max(want, pos.get(c.a) + c.sep);
        move(block, want);
      }
      // 反向：被块边界夹回来的（子图内）块要把左侧一起收回来，否则会压到别人身上
      for (let i = order.length - 1; i >= 0; i -= 1) {
        const block = order[i];
        const s = spans.get(block);
        if (!s) continue;
        const clamped = Math.max(s.min, Math.min(s.max, pos.get(block)));
        if (clamped === pos.get(block)) continue;
        pos.set(block, clamped);
        for (const c of alive) {
          if (c.b !== block) continue;
          pos.set(c.a, Math.min(pos.get(c.a), clamped - c.sep));
          move(c.a, pos.get(c.a));
        }
      }
      for (const [block, s] of spans) {
        const x = Math.max(s.min, Math.min(s.max, pos.get(block)));
        for (const item of block.items) item.centerX = x - (item.offsetCross || 0);
      }
    }
    // 子图边界与对齐块同时夹住时，压实可能无解。对齐只是美观优化，不能以节点重叠为代价。
    const overlaps = [...rankItems.values()].some((items) => {
      const reals = items.filter((item) => item.kind === 'real')
        .map((item) => ({ x: item.centerX + (item.offsetCross || 0), w: isLR ? item.th : item.tw }))
        .sort((a, b) => a.x - b.x);
      return reals.some((item, index) => index > 0
        && item.x - reals[index - 1].x < (item.w + reals[index - 1].w) / 2 + 2);
    });
    if (overlaps) for (const [item, x] of beforeAlign) item.centerX = x;
  }

  /* ───────── 直角走线规划（R1–R12）─────────
   * 流程图 / 状态图的连线只由水平、竖直线段组成：拐角 6px 圆角，横线穿过其它竖线时加
   * 小跨线弯。规划在 TB 坐标系（cross = x、flow = y）里完成，90° 方向变换仍是直角，
   * 所以 LR / RL / BT 与 TB 共用同一套端口、轨道和回边规则。分两步：
   *   1. 纵向排布之前定端口、回边通道与每个层间区间的轨道数（轨道数决定层间距）；
   *   2. 纵向落位后按端口和轨道生成折线，再统一变换到目标方向。
   * ER 关系线保持原来的平滑曲线，不进入这条路径。
   */
  const ortho = model.type === 'er' ? null : (() => {
    const clampTo = (value, min, max) => Math.max(min, Math.min(max, value));
    const R_CORNER = 6;
    const HOP_R = 5;
    const PORT_GAP = 16;
    const TRACK_GAP = 12;
    const TRACK_CLEAR = 8;
    const SIDE_STUB = 10;
    // 侧顶点短头缩短后的下限：再短就看不出是从侧顶点水平出线。
    const MIN_STUB = 4;
    const LOOP_EXT = 24;
    const KAPPA = 0.5522847498;

    const isFlowSide = (side) => side === 'top' || side === 'bottom';
    const tbRectOf = (item) => {
      if (item.kind === 'real') {
        const cross = isLR ? item.th : item.tw;
        const flow = isLR ? item.tw : item.th;
        return {
          x: item.centerX + (item.offsetCross || 0) - cross / 2,
          y: item.cy - flow / 2,
          w: cross,
          h: flow,
        };
      }
      return {
        x: item.centerX - item.bw / 2, y: item.cy - item.bh / 2, w: item.bw, h: item.bh,
      };
    };
    const shapeOf = (item) => {
      const node = item.node || {};
      if (node.kind === 'choice') return 'diamond';
      if (node.kind === 'start' || node.kind === 'end') return 'circle';
      const flowShape = model.type === 'flowchart' && flowOutlineName(node.shape);
      return flowShape ? `flow:${flowShape}` : node.shape || 'rect';
    };
    const isDiamondNode = (item) => Boolean(item) && ['diamond', 'flow:diam', 'flow:choice'].includes(shapeOf(item));
    const outlines = new Map();
    const routedOutline = (shape, w, h) => {
      const key = `${shape}:${w}:${h}`;
      if (!outlines.has(key)) {
        const outline = shapeOutline(shape, isLR ? h : w, isLR ? w : h);
        // Undo the final direction transform so asymmetric shapes stay upright.
        outlines.set(key, outline.map(([x, y]) => {
          if (direction === 'BT') return [x, h - y];
          if (direction === 'LR') return [y, x];
          if (direction === 'RL') return [y, h - x];
          return [x, y];
        }));
      }
      return outlines.get(key);
    };

    /** 端口落在边框上；上下边的 cross 是绝对 x，左右边的 cross 是相对 cy 的偏移。 */
    const borderPort = (rect, shape, side, cross) => {
      if (shape.startsWith('flow:')) {
        const offset = isFlowSide(side) ? cross - rect.x : cross + rect.h / 2;
        const port = outlinePort(routedOutline(shape.slice(5), rect.w, rect.h), side, offset);
        return { x: rect.x + port.x, y: rect.y + port.y };
      }
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      const hw = rect.w / 2;
      const hh = rect.h / 2;
      if (isFlowSide(side)) {
        const x = clampTo(cross, cx - hw * 0.96, cx + hw * 0.96);
        let y = side === 'top' ? rect.y : rect.y + rect.h;
        if (shape === 'diamond') {
          const dx = Math.min(hw * 0.96, Math.abs(x - cx));
          y = cy + (side === 'top' ? -1 : 1) * hh * (1 - dx / hw);
        } else if (shape === 'circle') {
          const dx = Math.min(hw * 0.96, Math.abs(x - cx));
          y = cy + (side === 'top' ? -1 : 1) * hh * Math.sqrt(Math.max(0, 1 - (dx / hw) ** 2));
        } else if (shape === 'hexagon') {
          const cut = Math.min(16, hw * 0.35);
          const flat = hw - cut;
          const dx = Math.abs(x - cx);
          if (dx > flat) {
            const t = Math.min(1, (dx - flat) / Math.max(1, hw - flat));
            y = cy + (side === 'top' ? -1 : 1) * hh * t;
          }
        }
        return { x, y };
      }
      const dy = clampTo(cross, -hh * 0.96, hh * 0.96);
      let x = side === 'left' ? rect.x : rect.x + rect.w;
      if (shape === 'diamond') {
        const d = Math.min(hh * 0.82, Math.abs(dy));
        x = cx + (side === 'left' ? -1 : 1) * hw * (1 - d / hh);
      } else if (shape === 'circle') {
        const d = Math.min(hh * 0.84, Math.abs(dy));
        x = cx + (side === 'left' ? -1 : 1) * hw * Math.sqrt(Math.max(0, 1 - (d / hh) ** 2));
      } else if (shape === 'hexagon') {
        const cut = Math.min(16, hh * 0.35);
        const t = Math.abs(dy) / Math.max(1, hh);
        x = side === 'left' ? rect.x + cut * t : rect.x + rect.w - cut * t;
      }
      return { x, y: cy + dy };
    };
    /** 侧向端口在 TB 里的 x：只依赖形状与相对偏移，不依赖所在层的 y。 */
    const sidePortX = (rect, shape, side, cross) => borderPort(
      {
        x: rect.x, y: -rect.h / 2, w: rect.w, h: rect.h,
      },
      shape,
      side,
      cross,
    ).x;
    const frameRectOf = (cluster) => cluster.rect || (
      cluster.left != null
        ? {
          x: cluster.left, y: 0, w: cluster.width || 1, h: 1,
        }
        : null
    );
    const endRect = (end) => (end.isFrame ? frameRectOf(end.cluster) : tbRectOf(end.item));
    const endCenterX = (end) => {
      const rect = endRect(end);
      return rect.x + rect.w / 2;
    };

    /* 端点：帧端点取帧框，节点端点取节点本身 */
    const routes = [];
    for (const le of layoutEdges) {
      if (!le.chain || !le.chain.length) continue;
      const chain = le.chain;
      const lowItem = chain[0];
      const highItem = chain[chain.length - 1];
      const lowIsFrame = le.reversed ? le.toFrame : le.fromFrame;
      const highIsFrame = le.reversed ? le.fromFrame : le.toFrame;
      const lowId = le.reversed ? le.edge.to : le.edge.from;
      const highId = le.reversed ? le.edge.from : le.edge.to;
      const lowRange = lowIsFrame ? frameRankRanges.get(lowId) : null;
      const highRange = highIsFrame ? frameRankRanges.get(highId) : null;
      if (lowIsFrame && !lowRange) continue;
      if (highIsFrame && !highRange) continue;
      const makeEnd = (isFrame, id, item, range) => {
        const cluster = isFrame ? clusters.get(id) : null;
        // 纵向落位前帧只有横向范围（cluster.left/width），横向跨度和最终帧框一致，足以定端口与轨道
        if (isFrame && !frameRectOf(cluster)) return null;
        return {
          isFrame,
          id,
          item,
          cluster,
          shape: isFrame ? 'rect' : shapeOf(item),
          rankTop: isFrame ? range.top : item.rank,
          rankBottom: isFrame ? range.bottom : item.rank,
        };
      };
      const lowEnd = makeEnd(lowIsFrame, lowId, lowItem, lowRange);
      const highEnd = makeEnd(highIsFrame, highId, highItem, highRange);
      if (!lowEnd || !highEnd) continue;
      // 上方节点的端口往下走线，下方节点的端口往上走线（回边也一样：它从下方层间绕回上方节点）。
      lowEnd.down = true;
      highEnd.down = false;
      // 帧内的虚拟点不绘制：线停在帧边；帧外的虚拟点（标签等）仍要参与折线
      const insideRange = (rank, range) => rank >= range.top && rank <= range.bottom;
      // 穿过别人的子图时，帧内的虚拟点一并去掉：连线在帧外绕行，只在帧边框上垂直穿一次（R11）
      const insideForeignFrame = (mid) => {
        for (const cluster of clusters.values()) {
          const range = frameRankRanges.get(cluster.id);
          if (!range) continue;
          if (isDescendantOf(le.owner, cluster)) continue;
          if (!insideRange(mid.rank, range)) continue;
          return true;
        }
        return false;
      };
      const mids = chain.slice(1, -1).filter((item) => {
        if (lowIsFrame && insideRange(item.rank, lowRange)) return false;
        if (highIsFrame && insideRange(item.rank, highRange)) return false;
        if (insideForeignFrame(item)) return false;
        return true;
      });
      const route = {
        le,
        lowEnd,
        highEnd,
        mids,
        kind: le.reversed ? 'back' : 'forward',
        srcEnd: le.reversed ? highEnd : lowEnd,
        tgtEnd: le.reversed ? lowEnd : highEnd,
        stops: [],
        lanes: [],
        tracks: [],
        seq: le.edge.seq,
      };
      routes.push(route);
    }

    const outRoutes = new Map();
    const inRoutes = new Map();
    const pushMap = (map, key, value) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(value);
    };
    for (const route of routes) {
      if (route.kind !== 'forward') continue;
      if (!route.srcEnd.isFrame) pushMap(outRoutes, route.srcEnd.item, route);
      if (!route.tgtEnd.isFrame) pushMap(inRoutes, route.tgtEnd.item, route);
    }
    const plainMids = (route) => route.mids.filter((item) => item.kind !== 'label');
    // 判断出口看的是“真正的下一站”：标签层紧贴菱形，不能拿标签的位置决定走顶点还是走侧顶点
    const adjacentX = (route, role) => {
      const mids = plainMids(route);
      if (role === 'src') {
        const mid = mids[0];
        return mid ? mid.centerX : endCenterX(route.tgtEnd);
      }
      const mid = mids[mids.length - 1];
      return mid ? mid.centerX : endCenterX(route.srcEnd);
    };
    // R3：菱形 / choice 只有一条出线走上下顶点，其余从左右顶点水平出线
    const pickMain = (list, role, cx) => {
      let best = null;
      for (const route of list) {
        const distance = Math.abs(adjacentX(route, role) - cx);
        if (!best || distance < best.distance - 1e-6
          || (Math.abs(distance - best.distance) <= 1e-6 && route.seq < best.route.seq)) {
          best = { route, distance };
        }
      }
      return best ? best.route : null;
    };
    const frameSideOf = (frameEnd, otherEnd) => {
      if (otherEnd.rankBottom < frameEnd.rankTop) return 'top';
      if (otherEnd.rankTop > frameEnd.rankBottom) return 'bottom';
      return endCenterX(otherEnd) < endCenterX(frameEnd) ? 'left' : 'right';
    };
    const frameCross = (frameEnd, side, adjacent) => {
      if (!isFlowSide(side)) return 0;
      const rect = endRect(frameEnd);
      return clampTo(adjacent, rect.x + 12, rect.x + rect.w - 12);
    };
    for (const route of routes) {
      const src = route.srcEnd;
      const tgt = route.tgtEnd;
      if (route.kind === 'back') {
        // R5：回边从两侧出线，经节点外侧的竖向通道绕回；两端同侧
        const sideCost = (side) => {
          const sign = side === 'right' ? 1 : -1;
          let score = 0;
          for (const end of [src, tgt]) {
            const gap = end === src ? end.rankTop - 0.5 : end.rankBottom + 0.5;
            const cx = endCenterX(end);
            for (const other of routes) {
              if (other.kind !== 'forward' || other.srcEnd.rankBottom >= gap || other.tgtEnd.rankTop <= gap) continue;
              // 以两端和无标签虚拟点预估该层间的竖线位置，选择横穿正向线更少的一侧。
              const stops = [
                { rank: other.srcEnd.rankBottom, x: endCenterX(other.srcEnd) },
                ...plainMids(other).map((mid) => ({ rank: mid.rank, x: mid.centerX })),
                { rank: other.tgtEnd.rankTop, x: endCenterX(other.tgtEnd) },
              ];
              for (let i = 1; i < stops.length; i += 1) {
                if (stops[i - 1].rank >= gap || stops[i].rank <= gap) continue;
                if (Math.max(sign * (stops[i - 1].x - cx), sign * (stops[i].x - cx)) > 8) score += 1;
              }
            }
            if (side === 'right' && end.item?.selfLoops?.length) score += 2;
          }
          return score;
        };
        const side = sideCost('left') < sideCost('right') ? 'left' : 'right';
        src.side = side;
        tgt.side = side;
        src.pref = 0;
        tgt.pref = 0;
        route.backSide = side;
        continue;
      }
      if (src.isFrame) {
        src.side = frameSideOf(src, tgt);
        src.pref = frameCross(src, src.side, adjacentX(route, 'src'));
      } else if (isDiamondNode(src.item)) {
        // R3：横移落在菱形横向跨度内就走底部顶点（只有一段横移），
        // 否则走朝向目标的那一侧顶点，避免先往外探出再折回来（U 形）。
        const rect = endRect(src);
        const lane = endCenterX(tgt);
        if (lane > rect.x + 16 && lane < rect.x + rect.w - 16) {
          src.side = 'bottom';
          src.hardCross = rect.x + rect.w / 2;
        } else {
          src.side = lane < rect.x + rect.w / 2 ? 'left' : 'right';
          src.hardCross = 0;
          src.pref = 0;
        }
      } else {
        src.side = 'bottom';
        src.pref = adjacentX(route, 'src');
      }
      if (tgt.isFrame) {
        tgt.side = frameSideOf(tgt, src);
        tgt.pref = frameCross(tgt, tgt.side, adjacentX(route, 'tgt'));
      } else if (isDiamondNode(tgt.item)) {
        const rect = endRect(tgt);
        const lane = endCenterX(src);
        const cx = rect.x + rect.w / 2;
        // 源端从判断框侧顶点水平出线、目标顶部顶点在出线方向的外侧：进目标顶部，横→竖一次拐弯；
        // 进目标侧顶点会变成「横→竖→横」的 Z 形台阶。
        const srcRect = src.isFrame ? null : endRect(src);
        const ahead = !!srcRect && isDiamondNode(src.item)
          && ((src.side === 'right' && cx > srcRect.x + srcRect.w + 16) || (src.side === 'left' && cx < srcRect.x - 16));
        if (ahead || (lane > rect.x + 16 && lane < rect.x + rect.w - 16)) {
          tgt.side = 'top';
          tgt.hardCross = cx;
        } else {
          tgt.side = lane < rect.x + rect.w / 2 ? 'left' : 'right';
          tgt.hardCross = 0;
          tgt.pref = 0;
        }
      } else {
        tgt.side = 'top';
        tgt.pref = adjacentX(route, 'tgt');
      }
    }
    // 判断框侧顶点直连普通节点时，另一端端口对准侧向短头；否则会先向外出头、再折回入口。
    const stubLane = (end) => sidePortX(endRect(end), end.shape, end.side, 0) + (end.side === 'left' ? -SIDE_STUB : SIDE_STUB);
    for (const route of routes) {
      if (route.kind !== 'forward' || plainMids(route).length) continue;
      if (!isFlowSide(route.srcEnd.side) && route.tgtEnd.side === 'top' && route.tgtEnd.hardCross == null) {
        route.tgtEnd.pref = stubLane(route.srcEnd);
        // 短头指向外侧：端口被邻居占位时优先继续往外让，而不是折回到判断框一侧。
        route.tgtEnd.outward = route.srcEnd.side === 'left' ? -1 : 1;
      }
      if (!isFlowSide(route.tgtEnd.side) && route.srcEnd.side === 'bottom' && route.srcEnd.hardCross == null) {
        route.srcEnd.pref = stubLane(route.tgtEnd);
      }
    }
    // 起止圆点一类的窄节点：同一侧装不下多个箭头时，分到左右侧，保证箭头不重叠（R10）
    for (const [item, list] of inRoutes) {
      const rect = tbRectOf(item);
      const top = list.filter((route) => route.tgtEnd.side === 'top');
      const capacity = Math.max(1, Math.floor((rect.w - 4) / PORT_GAP) + 1);
      if (top.length <= capacity) continue;
      const cx = rect.x + rect.w / 2;
      top.sort((a, b) => Math.abs(adjacentX(a, 'tgt') - cx) - Math.abs(adjacentX(b, 'tgt') - cx) || a.seq - b.seq);
      top.slice(capacity).forEach((route, index) => {
        route.tgtEnd.side = index % 2 === 0 ? 'left' : 'right';
        // 侧向端口留在竖直中点：与顶部箭头方向垂直，视觉上分得开。
        // pref 原来是绝对 x，换成侧边语义（相对 cy 的偏移）后必须清零，否则会被夹到边角 (#278/#291)。
        route.tgtEnd.hardCross = 0;
        route.tgtEnd.pref = 0;
      });
    }

    /* 端口分组分配：车道优先。主链（对齐走廊）与实线先占自己的车道，虚线支路让位 */
    /** 端口优先级：数字越小越该保住自己的车道。 */
    const portPriority = (route, end) => {
      if (end && end.hardCross != null) return 0;
      if (end && end.isFrame) return 1;
      if (route.kind === 'back') return 6;
      const style = route.le.edge.style || 'solid';
      const chain = Boolean(route.mids && route.mids.length);
      const main = style === 'solid' || style === 'bold';
      if (main) return chain ? 2 : 3;
      return chain ? 4 : 5;
    };
    const requests = [];
    for (const route of routes) {
      for (const end of [route.srcEnd, route.tgtEnd]) {
        requests.push({
          route,
          end,
          side: end.side,
          isFrame: end.isFrame,
          rect: endRect(end),
          id: end.id,
          seq: route.seq,
          prio: portPriority(route, end),
        });
      }
    }
    // 自环：右侧两个端口，和回边端口一起排序分配（R9）
    const loops = [];
    for (const item of realItems) {
      for (const edge of item.selfLoops || []) {
        const loop = { item, edge, index: loops.length };
        const rect = tbRectOf(item);
        const shape = shapeOf(item);
        // 标签居中压在环的外侧竖边上，环的高度要容得下标签
        loop.labelLines = edge.label ? wrapText(edge.label, 120, FONT.label, measure) : [];
        loop.labelW = loop.labelLines.length ? maxWidthOf(loop.labelLines, FONT.label, measure) + 10 : 0;
        loop.labelH = loop.labelLines.length ? Math.max(18, loop.labelLines.length * 16 + 6) : 0;
        const halfSpan = Math.max(8, (loop.labelH + 6) / 2);
        loop.upper = {
          loop, side: 'right', isFrame: false, rect, shape, id: item.id, want: -halfSpan, seq: edge.seq, order: 0,
        };
        loop.lower = {
          loop, side: 'right', isFrame: false, rect, shape, id: item.id, want: halfSpan, seq: edge.seq, order: 1,
        };
        requests.push(loop.upper, loop.lower);
        loops.push(loop);
      }
    }
    const groups = new Map();
    for (const request of requests) {
      const key = `${request.isFrame ? 'F' : 'N'}${request.id}|${request.side}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(request);
    }
    /* 端口分配：车道优先。
     *   (a) 锚定：车道落在可用段内的端口正好落在车道上，第一段竖线就是直的；抢位时按优先级让位（虚线支路让主链）。
     *   (b) 自由：其余端口在空档里就近安置，离任何邻居 ≥ PORT_GAP；装不下时按边内均分。
     * 旧实现会把整组端口重新居中，连已经对上车道的那一根也跟着挪 4~10px，端口旁就折出微折。 */
    const endSlots = new Map();
    const placeSide = (list) => {
      const side = list[0].side;
      const rect = list[0].rect;
      const flowSide = isFlowSide(side);
      const len = flowSide ? rect.w : rect.h;
      const margin = list[0].isFrame ? 12 : 0;
      // 端口只占边的中间一段：贴到角上时，相邻两条边的端口会撞在一起（#278 / #291）
      const half = Math.max(0, Math.min((flowSide ? 0.3 : 0.4) * len, len / 2 - margin));
      const center = flowSide ? rect.x + rect.w / 2 : 0;
      const min = center - half;
      const max = center + half;
      const n = list.length;
      const gap = n > 1 ? Math.min(PORT_GAP, (2 * half) / Math.max(1, n - 1)) : PORT_GAP;
      const items = list.map((request) => ({
        request,
        fixed: request.end && request.end.hardCross != null ? request.end.hardCross : null,
        want: request.end
          ? (request.end.hardCross != null ? request.end.hardCross : (request.end.pref == null ? center : request.end.pref))
          : request.want,
        pos: null,
        pinned: false,
      }));
      // 多个请求抢同一个固定端口（典型是菱形顶点）时全部让出固定位，改走就近分配，免得两根线共用一个箭头
      if (n > 1) {
        const fixedGroups = new Map();
        for (const item of items) {
          if (item.fixed == null) continue;
          const key = Math.round(item.fixed * 2) / 2;
          fixedGroups.set(key, (fixedGroups.get(key) || []).concat(item));
        }
        for (const group of fixedGroups.values()) {
          if (group.length < 2) continue;
          for (const item of group) {
            item.fixed = null;
            item.want = item.request.end
              ? (item.request.end.pref == null ? center : item.request.end.pref)
              : item.request.want;
          }
        }
      }
      const fit = (value) => clampTo(value, min, max);
      const clearOf = (value, self) => items.every((item) => item === self || item.pos == null
        || Math.abs(item.pos - value) >= gap - 0.01);
      // 左右侧端口按竖线去向分上下：往下走的取顶点及其下方的位置，往上走的取上方。
      // 菱形、圆、六边形在顶点处最宽，竖线若从端口朝顶点方向走，会穿过节点本身。
      const heading = (item) => (!flowSide && item.request.end ? (item.request.end.down ? 1 : -1) : 0);
      const towardHeading = (item) => (a, b) => (heading(item) ? (b - a) * heading(item) : a - b);
      // (a) 硬端口先占位，再按优先级把车道在可用段内的端口钉在车道上
      for (const item of items) {
        if (item.fixed == null) continue;
        item.pos = fit(item.fixed);
        item.pinned = true;
      }
      const ranked = items.filter((item) => item.fixed == null).sort((a, b) => (a.request.prio ?? 3) - (b.request.prio ?? 3)
        || a.want - b.want || a.request.seq - b.request.seq || (a.request.order ?? 0) - (b.request.order ?? 0));
      for (const item of ranked) {
        if (item.want < min - 0.01 || item.want > max + 0.01) continue;
        if (!clearOf(item.want, item)) continue;
        item.pos = item.want;
        item.pinned = true;
      }
      // (b) 其余端口：在可用段里找离自己的车道最近、又不挤占邻居的落点
      let crowded = false;
      for (const item of ranked) {
        if (item.pos != null) continue;
        const slots = [fit(item.want), min, max];
        for (const other of items) {
          if (other.pos == null) continue;
          slots.push(fit(other.pos - gap), fit(other.pos + gap));
        }
        let open = slots.filter((value) => clearOf(value, item));
        const dir = item.request.end && item.request.end.outward;
        if (dir) {
          // 侧顶点短头来的连线：优先继续往外让，但不能越过已占位的邻居端口——那会横穿它的竖线，
          // 交叉点像一个汇合点。外侧没有不交叉的空位时，退到短头与顶点之间（短头随之缩短，至少留 MIN_STUB）。
          const vertex = item.want - dir * SIDE_STUB;
          const crosses = (value) => items.some((other) => other !== item && other.pos != null
            && (other.pos - item.want) * dir > 0.01 && (value - other.pos) * dir > 0.01);
          const ahead = open.filter((value) => (value - item.want) * dir >= -0.01);
          const clean = ahead.filter((value) => !crosses(value));
          const behind = open.filter((value) => (value - item.want) * dir < -0.01 && (value - vertex) * dir >= MIN_STUB - 0.01);
          if (clean.length) open = clean;
          else if (behind.length) open = behind;
          else if (ahead.length) open = ahead;
        }
        if (!open.length) {
          crowded = true;
          break;
        }
        open.sort((a, b) => Math.abs(a - item.want) - Math.abs(b - item.want) || towardHeading(item)(a, b));
        item.pos = open[0];
      }
      // 狭窄节点装不下锚点与其余端口时，整组重新排布；不能让兜底端口覆盖已占位置。
      if (crowded) {
        const order = items.slice().sort((a, b) => a.want - b.want || heading(a) - heading(b) || a.request.seq - b.request.seq);
        const packedHalf = Math.min(half, PORT_GAP * (n - 1) / 2);
        order.forEach((item, index) => {
          item.pos = n === 1 ? fit(center) : center - packedHalf + (2 * packedHalf * index) / (n - 1);
        });
      }
      for (const item of items) if (item.pos == null) item.pos = fit(item.want);
      // 落点撞在一起（小节点、菱形侧顶点）时按顺序均分，箭头才不会叠在一个点上
      const clashes = new Map();
      for (const item of items) {
        const key = Math.round(item.pos);
        clashes.set(key, (clashes.get(key) || []).concat(item));
      }
      for (const group of clashes.values()) {
        if (group.length < 2) continue;
        const step = Math.min(PORT_GAP, (2 * half) / Math.max(1, group.length - 1));
        const start = center - (step * (group.length - 1)) / 2;
        group
          .slice()
          .sort((a, b) => a.want - b.want || heading(a) - heading(b) || a.request.seq - b.request.seq)
          .forEach((item, order) => { item.pos = fit(start + order * step); });
      }
      for (const item of items) {
        item.request.pos = item.pos;
        if (item.request.end) {
          item.request.end.pos = item.pos;
          endSlots.set(item.request.end, {
            items, gap, min, max, item,
          });
        }
      }
    };
    for (const list of groups.values()) placeSide(list);

    /* 端口 ↔ 车道微折：横移不到 16px 的拐角夹在两个圆角之间，看起来就是个错位的弯。
     * 依次尝试：端口吸到车道 → 端口反向让开 ≥16px → 直连边把另一端的端口拉过来。 */
    const JOG_MIN = PORT_GAP + 0.5;
    const relocate = (end, value) => {
      const slot = endSlots.get(end);
      if (!slot || end.isFrame || end.hardCross != null || !isFlowSide(end.side)) return false;
      if (!Number.isFinite(value) || value < slot.min - 0.01 || value > slot.max + 0.01) return false;
      for (const other of slot.items) {
        if (other === slot.item || other.pos == null) continue;
        if (Math.abs(other.pos - value) < slot.gap - 0.01) return false;
      }
      slot.item.pos = value;
      end.pos = value;
      return true;
    };
    const straighten = (route) => {
      if (route.kind !== 'forward' || route.lanes.length < 2) return false;
      const last = route.lanes.length - 1;
      const pairs = [
        { end: route.srcEnd, lane: route.lanes[1], mate: route.tgtEnd },
        { end: route.tgtEnd, lane: route.lanes[last - 1], mate: route.srcEnd },
      ];
      let moved = false;
      for (const { end, lane, mate } of pairs) {
        if (!isFlowSide(end.side)) continue;
        const delta = lane - end.pos;
        if (Math.abs(delta) < 0.01) continue;
        // 车道落在可用边内时，端口直接跟随车道：任何横移都少一个弯，也避免标签车道造成折返。
        if (relocate(end, lane)) {
          moved = true;
          continue;
        }
        if (Math.abs(delta) >= JOG_MIN - 0.01) continue;
        if (relocate(end, end.pos - Math.sign(delta) * (JOG_MIN - Math.abs(delta)))) {
          moved = true;
          continue;
        }
        if (route.lanes.length === 2 && relocate(mate, end.pos)) moved = true;
      }
      return moved;
    };

    /* 侧向外线短头：端口先水平走一小段，再竖向下行（R3） */
    const laneXOfEnd = (end) => {
      if (isFlowSide(end.side)) return end.pos;
      return sidePortX(endRect(end), end.shape, end.side, end.pos)
        + (end.side === 'left' ? -SIDE_STUB : SIDE_STUB);
    };

    /* 回边通道：在所有中间节点外侧留一条竖走廊（R5） */
    const backSlots = [];
    const channelFor = (route) => {
      const side = route.backSide;
      const lo = Math.min(route.tgtEnd.rankTop, route.srcEnd.rankBottom);
      const hi = Math.max(route.tgtEnd.rankBottom, route.srcEnd.rankTop);
      let edgeX = side === 'right' ? -Infinity : Infinity;
      for (const item of allItems) {
        if (item.rank < lo || item.rank > hi) continue;
        const rect = tbRectOf(item);
        if (!Number.isFinite(rect.x) || !Number.isFinite(rect.w)) continue;
        edgeX = side === 'right' ? Math.max(edgeX, rect.x + rect.w) : Math.min(edgeX, rect.x);
      }
      for (const cluster of clusters.values()) {
        const frameRect = frameRectOf(cluster);
        if (!frameRect || !Number.isFinite(frameRect.x) || !Number.isFinite(frameRect.w)) continue;
        if (cluster.bottomRank < lo || cluster.topRank > hi) continue;
        edgeX = side === 'right'
          ? Math.max(edgeX, frameRect.x + frameRect.w)
          : Math.min(edgeX, frameRect.x);
      }
      if (!Number.isFinite(edgeX)) edgeX = 0;
      // 标签居中压在通道上，所以两条带标签的通道要拉开到标签不相碰
      const need = Math.max(12, route.mids.reduce(
        (best, mid) => (mid.kind === 'label' ? Math.max(best, mid.bw / 2 + 2) : best),
        0,
      ));
      let x = edgeX + (side === 'right' ? 14 : -14);
      for (let pass = 0; pass < 8; pass += 1) {
        let moved = false;
        for (const slot of backSlots) {
          if (slot.side !== side || slot.hi <= lo || slot.lo >= hi) continue;
          if (Math.abs(slot.x - x) < need + slot.need) {
            x = slot.x + (side === 'right' ? 1 : -1) * (need + slot.need);
            moved = true;
          }
        }
        if (!moved) break;
      }
      backSlots.push({
        side, lo, hi, x, need,
      });
      return x;
    };

    const needsLabelLane = (route, item) => {
      // 狭窄直连带内若还有回边横穿，需要标签自己的留白车道，不能只把文字挤在交叉点两旁。
      // 标签车道离两端太远时会把连线拉成 U 形；绕行不超过标签宽度才值得为文字让路。
      const a = laneXOfEnd(route.srcEnd);
      const b = laneXOfEnd(route.tgtEnd);
      const detour = Math.max(0, item.centerX - Math.max(a, b)) + Math.max(0, Math.min(a, b) - item.centerX);
      // 绕行超过两倍标签宽度时，宁可让标签在自己的直线段上找空位，也不把连线拉到别的车道上。
      // 同一对节点之间的平行连线依赖各自的标签车道分开，不受这个限制。
      const parallel = routes.some((other) => other !== route
        && other.lowEnd.id === route.lowEnd.id && other.highEnd.id === route.highEnd.id);
      if (!parallel && detour > item.bw * 2) return false;
      if (Math.abs(a - b) < item.bw + 2 && detour <= item.bw
        && routes.some((other) => other.kind === 'back'
          && other.tgtEnd.rankBottom < item.rank && other.srcEnd.rankTop > item.rank)) return true;
      // 同侧并行出口附近，文字宽于端口间距时保留独立标签车道，避免标签压到主链上。
      for (const end of [route.srcEnd, route.tgtEnd]) {
        if (!isFlowSide(end.side)) continue;
        for (const other of routes) {
          if (other === route || other.kind !== 'forward') continue;
          for (const mate of [other.srcEnd, other.tgtEnd]) {
            if (mate.id !== end.id || mate.side !== end.side) continue;
            if (Math.abs(mate.pos - end.pos) < item.bw / 2 + 5) return true;
          }
        }
      }
      return false;
    };
    for (const route of routes) {
      if (route.kind === 'forward') {
        route.stops = [
          { end: route.srcEnd },
          // 标签只占层间空间，不充当走线的车道；沿标签虚拟点折返会产生无意义的 S / U 形。
          ...route.mids.filter((item) => item.kind !== 'label' || needsLabelLane(route, item)).map((item) => ({ mid: item })),
          { end: route.tgtEnd },
        ];
      } else {
        route.channelX = channelFor(route);
        route.stops = [{ end: route.srcEnd }, { channel: route.channelX }, { end: route.tgtEnd }];
      }
    }

    // 车道先定，端口再向车道靠；每一轮修正都会改变车道，所以重算到稳定为止
    const assignLanes = () => {
      for (const route of routes) {
        route.lanes = route.stops.map((stop) => {
          if (stop.end) return laneXOfEnd(stop.end);
          if (stop.mid) return stop.mid.centerX;
          return stop.channel;
        });
        // 两端都是侧向短头且车道只差不到一个间距时，把源端短头延长到目标车道，只留一条竖线。
        if (route.kind === 'forward' && route.lanes.length === 2
          && !isFlowSide(route.srcEnd.side) && !isFlowSide(route.tgtEnd.side)) {
          const [a, b] = route.lanes;
          const outward = route.srcEnd.side === 'right' ? b > a : b < a;
          if (outward && Math.abs(a - b) < PORT_GAP) route.lanes[0] = b;
        }
        // 侧向短头直连下方端口、端口又在更外侧时，延长短头到端口车道；同层中间有节点时不延长。
        // 目标是判断框顶部顶点时不限距离：从侧顶点水平走到它正上方再下行，一次拐弯（L 形），
        // 此时同层的长边虚拟点也算障碍，水平段不横穿别的竖线。
        if (route.kind === 'forward' && route.lanes.length === 2
          && !isFlowSide(route.srcEnd.side) && isFlowSide(route.tgtEnd.side) && !route.srcEnd.isFrame) {
          const [a, b] = route.lanes;
          const outward = route.srcEnd.side === 'right' ? b > a : b < a;
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          const vertex = route.tgtEnd.side === 'top' && !route.tgtEnd.isFrame && isDiamondNode(route.tgtEnd.item);
          const blocked = (vertex ? allItems : realItems).some((item) => {
            if (item === route.srcEnd.item || item.rank !== route.srcEnd.item.rank) return false;
            const rect = tbRectOf(item);
            return rect.x < hi + 8 && rect.x + rect.w > lo - 8;
          });
          if (outward && (hi - lo <= 2 * PORT_GAP || vertex) && !blocked) route.lanes[0] = b;
          // 端口落在短头与侧顶点之间（为了不横穿邻居端口而往回让）：短头缩到端口车道，只留一条竖线。
          const sign = route.srcEnd.side === 'right' ? 1 : -1;
          const vertexX = a - sign * SIDE_STUB;
          if (!outward && (b - vertexX) * sign >= MIN_STUB - 0.01) route.lanes[0] = b;
        }
        // 回边的端口外车道与通道相距不足一个折线间距时，共用外通道，消除 4px 台阶。
        if (route.kind === 'back') {
          for (const index of [0, route.lanes.length - 1]) {
            if (Math.abs(route.lanes[index] - route.channelX) < PORT_GAP) route.lanes[index] = route.channelX;
          }
        }
      }
      // 长边的连续虚拟点是一条车道。它与端口只差半个间距时，整列吸附到端口，
      // 而不是在目标前再折出一条与别的入线相隔 8px 的平行线。
      for (const route of routes) {
        if (route.kind !== 'forward') continue;
        const interior = route.stops.slice(1, -1);
        if (!interior.length || interior.some((stop) => !stop.mid || stop.mid.kind !== 'dummy')) continue;
        const old = route.lanes[1];
        if (route.lanes.slice(1, -1).some((x) => Math.abs(x - old) > 0.01)) continue;
        const choices = [route.lanes.at(-1), route.lanes[0]];
        for (const x of choices) {
          if (Math.abs(x - old) < 0.01 || Math.abs(x - old) >= PORT_GAP) continue;
          const blocked = realItems.some((item) => {
            if (item.rank <= route.srcEnd.rankBottom || item.rank >= route.tgtEnd.rankTop) return false;
            const rect = tbRectOf(item);
            return x > rect.x - 8 && x < rect.x + rect.w + 8;
          });
          const outside = interior.some(({ mid }) => mid.cluster && mid.cluster !== root
            && (x < mid.slotLeft || x > mid.slotRight));
          if (blocked || outside) continue;
          for (let i = 1; i < route.lanes.length - 1; i += 1) route.lanes[i] = x;
          break;
        }
      }
    };
    assignLanes();
    for (let pass = 0; pass < 4; pass += 1) {
      let moved = false;
      for (const route of routes) if (straighten(route)) moved = true;
      if (!moved) break;
      assignLanes();
    }

    /* 轨道：每条需要横移的连线在每个层间区间占一条独立横线（R6） */
    const gapTracks = new Map();
    const trackAt = (gap, route, index) => {
      if (!Number.isFinite(gap) || gap < 0 || gap > maxRank - 1) return null;
      if (!gapTracks.has(gap)) gapTracks.set(gap, []);
      const track = {
        gap, route, index, y: null,
      };
      gapTracks.get(gap).push(track);
      return track;
    };
    const gapBelow = (route, stop) => {
      if (stop.end) {
        if (stop.end.isFrame) return stop.end === route.srcEnd ? stop.end.rankBottom : stop.end.rankTop - 1;
        return stop.end.item.rank;
      }
      return stop.mid.rank;
    };
    for (const route of routes) {
      route.tracks = [];
      if (route.kind === 'forward') {
        for (let i = 0; i + 1 < route.lanes.length; i += 1) {
          if (Math.abs(route.lanes[i + 1] - route.lanes[i]) < 0.01) {
            route.tracks.push(null);
            continue;
          }
          route.tracks.push(trackAt(gapBelow(route, route.stops[i]), route, i));
        }
      } else {
        const srcGap = route.srcEnd.rankTop - 1;
        const tgtGap = route.tgtEnd.rankBottom;
        let srcTrack;
        let tgtTrack;
        // 同一格时目标端轨道必须在源端上方，否则折线会自交
        if (srcGap === tgtGap) {
          tgtTrack = trackAt(tgtGap, route, 1);
          srcTrack = trackAt(srcGap, route, 0);
        } else {
          srcTrack = trackAt(srcGap, route, 0);
          tgtTrack = trackAt(tgtGap, route, 1);
        }
        route.tracks = [srcTrack, tgtTrack];
      }
    }

    /* ── 纵向落位后的几何生成：折线、圆角、跨线弯、自环与标签 ── */
    const lineSeg = (a, b) => ({
      p0: a,
      p1: b,
      c1: { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
      c2: { x: a.x + (b.x - a.x) * 2 / 3, y: a.y + (b.y - a.y) * 2 / 3 },
      kind: 'line',
    });
    const arcSeg = (a, b, c1, c2, kind) => ({
      p0: a, p1: b, c1, c2, kind,
    });
    const simplifyPoints = (points) => {
      const out = [];
      for (const point of points) {
        const last = out[out.length - 1];
        if (last && Math.abs(last.x - point.x) < 0.01 && Math.abs(last.y - point.y) < 0.01) continue;
        out.push(point);
        while (out.length >= 3) {
          const c = out[out.length - 1];
          const b = out[out.length - 2];
          const a = out[out.length - 3];
          const sameX = Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01;
          const sameY = Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01;
          if (!sameX && !sameY) break;
          out.splice(out.length - 2, 1);
        }
      }
      return out;
    };
    const runsOf = (points) => {
      const runs = [];
      for (let i = 0; i + 1 < points.length; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        const horizontal = Math.abs(a.y - b.y) < 0.01;
        const vertical = Math.abs(a.x - b.x) < 0.01;
        if (!horizontal && !vertical) continue;
        if (Math.hypot(b.x - a.x, b.y - a.y) < 0.01) continue;
        runs.push({ horizontal, a, b });
      }
      return runs;
    };
    /** 折线 → 三次段：直线段三等分，拐角 6px 圆角，跨线点拱起 HOP_R。 */
    const segmentsOf = (points, hops) => {
      const out = [];
      const pushStraight = (a, b) => {
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 0.01) return;
        const horizontal = Math.abs(a.y - b.y) < 0.01;
        if (!horizontal || !hops || !hops.length) {
          out.push(lineSeg(a, b));
          return;
        }
        const dir = Math.sign(b.x - a.x) || 1;
        const along = (p) => (p.x - a.x) * dir;
        const list = hops
          .filter((hop) => Math.abs(hop.y - a.y) < 0.01 && along(hop) > HOP_R + 6 && along(hop) < len - HOP_R - 6)
          .sort((p, q) => along(p) - along(q));
        let cursor = a;
        for (const hop of list) {
          if (along(cursor) > along(hop) - HOP_R - 1) continue;
          const before = { x: hop.x - dir * HOP_R, y: hop.y };
          const after = { x: hop.x + dir * HOP_R, y: hop.y };
          const top = { x: hop.x, y: hop.y - HOP_R };
          out.push(lineSeg(cursor, before));
          out.push(arcSeg(
            before,
            top,
            { x: before.x, y: before.y - HOP_R * KAPPA },
            { x: top.x - dir * HOP_R * KAPPA, y: top.y },
            'jump',
          ));
          out.push(arcSeg(
            top,
            after,
            { x: top.x + dir * HOP_R * KAPPA, y: top.y },
            { x: after.x, y: after.y - HOP_R * KAPPA },
            'jump',
          ));
          cursor = after;
        }
        if (Math.hypot(b.x - cursor.x, b.y - cursor.y) > 0.01) out.push(lineSeg(cursor, b));
      };
      const pts = simplifyPoints(points);
      if (pts.length < 2) return out;
      let cursor = pts[0];
      for (let i = 1; i + 1 < pts.length; i += 1) {
        const p = pts[i];
        const q = pts[i + 1];
        const inLen = Math.hypot(p.x - cursor.x, p.y - cursor.y);
        const outLen = Math.hypot(q.x - p.x, q.y - p.y);
        if (inLen < 0.01 || outLen < 0.01) continue;
        const r = Math.min(R_CORNER, inLen / 2, outLen / 2);
        if (r < 0.5) {
          // 亚像素小台阶不做圆角，但要保留成两段直角线，不能把首尾直接连成斜线
          pushStraight(cursor, p);
          cursor = p;
          continue;
        }
        const uIn = { x: (p.x - cursor.x) / inLen, y: (p.y - cursor.y) / inLen };
        const uOut = { x: (q.x - p.x) / outLen, y: (q.y - p.y) / outLen };
        const a = { x: p.x - uIn.x * r, y: p.y - uIn.y * r };
        const b = { x: p.x + uOut.x * r, y: p.y + uOut.y * r };
        pushStraight(cursor, a);
        out.push(arcSeg(
          a,
          b,
          { x: a.x + uIn.x * r * KAPPA, y: a.y + uIn.y * r * KAPPA },
          { x: b.x - uOut.x * r * KAPPA, y: b.y - uOut.y * r * KAPPA },
          'corner',
        ));
        cursor = b;
      }
      pushStraight(cursor, pts[pts.length - 1]);
      return out;
    };
    const tbPortPoint = (end, other) => {
      const rect = endRect(end);
      // 帧的侧向出入口：纵向位置对齐另一端的中心，并收进帧内 16px（避免落在帧边中点）
      if (end.isFrame && !isFlowSide(end.side)) {
        const otherRect = other ? endRect(other) : null;
        const wantY = otherRect ? otherRect.y + otherRect.h / 2 : rect.y + rect.h / 2;
        const half = Math.max(0, rect.h / 2 - 16);
        return borderPort(rect, end.shape, end.side, clampTo(wantY - (rect.y + rect.h / 2), -half, half));
      }
      return borderPort(rect, end.shape, end.side, end.pos);
    };
    const stopY = (stop, other) => {
      if (stop.end) return tbPortPoint(stop.end, other).y;
      if (stop.mid) return stop.mid.cy;
      return null;
    };
    /** 最后一道保险：端口被边框限制后与车道错开时插拐点，保证不出现斜线 */
    const axisAlign = (points) => {
      const out = [];
      for (const point of points) {
        const last = out[out.length - 1];
        if (last && Math.abs(last.x - point.x) > 0.01 && Math.abs(last.y - point.y) > 0.01) {
          out.push({ x: last.x, y: point.y });
        }
        out.push(point);
      }
      return out;
    };
    /** 端口 / 虚拟点 → 直角折线；横移一律走本层间的轨道（R6）。 */
    const pathOf = (route) => {
      const pts = [];
      const start = tbPortPoint(route.srcEnd, route.tgtEnd);
      const end = tbPortPoint(route.tgtEnd, route.srcEnd);
      pts.push(start);
      let cursor = route.lanes[0];
      if (!isFlowSide(route.srcEnd.side)) pts.push({ x: cursor, y: start.y });
      for (let i = 0; i + 1 < route.lanes.length; i += 1) {
        // 亚像素级的车道差直接并到上一条车道，避免折出 0.6px 的小台阶
        const next = Math.abs(route.lanes[i + 1] - cursor) < 1 ? cursor : route.lanes[i + 1];
        if (Math.abs(next - cursor) > 0.01) {
          const track = route.tracks[i];
          let y = track ? track.y : null;
          if (y == null) {
            const otherOf = (stop) => (stop.end ? (stop.end === route.srcEnd ? route.tgtEnd : route.srcEnd) : null);
            const a = stopY(route.stops[i], otherOf(route.stops[i]));
            const b = stopY(route.stops[i + 1], otherOf(route.stops[i + 1]));
            y = a != null && b != null ? (a + b) / 2 : (a ?? b ?? 0) + 20;
          }
          pts.push({ x: cursor, y });
          pts.push({ x: next, y });
        }
        cursor = next;
      }
      if (!isFlowSide(route.tgtEnd.side)) {
        pts.push({ x: cursor, y: end.y });
      } else if (Math.abs(end.x - cursor) > 0.01 && Math.abs(end.x - cursor) < 1.5) {
        // 端口和车道差不到 1.5px 时直接吸到车道上，避免最后一段出现看不见的斜线
        end.x = cursor;
      }
      pts.push(end);
      return simplifyPoints(axisAlign(pts));
    };
    const tbTitleRect = (cluster) => {
      const vr = cluster.visualRect;
      if (!vr) return null;
      const titleH = cluster.titleLines.length * 17
        + (cluster.descLines.length ? 4 + cluster.descLines.length * 16 : 0);
      const rect = {
        x: vr.x + FRAME_PAD,
        y: vr.y + 10,
        w: Math.max(cluster.titleW, cluster.descW || 0, 1),
        h: Math.max(titleH, 1),
      };
      if (direction === 'BT') return { x: rect.x, y: H - rect.y - rect.h, w: rect.w, h: rect.h };
      if (direction === 'LR') return { x: rect.y, y: rect.x, w: rect.h, h: rect.w };
      if (direction === 'RL') return { x: rect.y, y: W - rect.x - rect.w, w: rect.h, h: rect.w };
      return rect;
    };
    const hitsRun = (rect, points) => runsOf(points).some((run) => {
      const x1 = Math.min(run.a.x, run.b.x);
      const x2 = Math.max(run.a.x, run.b.x);
      const y1 = Math.min(run.a.y, run.b.y);
      const y2 = Math.max(run.a.y, run.b.y);
      if (x2 < rect.x + 0.5 || x1 > rect.x + rect.w - 0.5) return false;
      if (y2 < rect.y + 0.5 || y1 > rect.y + rect.h - 0.5) return false;
      return true;
    });

    return {
      routes,
      loops,
      gapTracks,
      build: () => {
        for (const route of routes) route.points = pathOf(route);

        // 自环：右侧闭合矩形，伸出 ≥24px；标签压在外侧竖边上（R8/R9）
        const loopResults = loops.map((loop) => {
          const rect = tbRectOf(loop.item);
          const shape = shapeOf(loop.item);
          const upper = borderPort(rect, shape, 'right', loop.upper.pos ?? -8);
          const lower = borderPort(rect, shape, 'right', loop.lower.pos ?? 8);
          const ext = Math.max(LOOP_EXT, loop.labelW / 2 + 12);
          const outerX = Math.max(rect.x + rect.w + ext, upper.x + ext, lower.x + ext);
          const points = simplifyPoints([
            upper,
            { x: outerX, y: upper.y },
            { x: outerX, y: lower.y },
            lower,
          ]);
          const lines = loop.labelLines;
          let labelRect = null;
          if (lines.length) {
            labelRect = {
              x: outerX - loop.labelW / 2,
              y: (upper.y + lower.y) / 2 - loop.labelH / 2,
              w: loop.labelW,
              h: loop.labelH,
            };
          }
          loop.points = points;
          loop.labelRect = labelRect;
          return loop;
        });

        // 跨线弯：横线穿过别的连线的竖线时插小半圆（R7）
        const runList = [];
        for (const route of routes) {
          for (const run of runsOf(route.points)) runList.push({ run, key: route });
        }
        for (const loop of loopResults) {
          for (const run of runsOf(loop.points)) runList.push({ run, key: loop });
        }
        const hopsOf = new Map();
        // 跨线弯必须离箭头 / 端口 16px 以上（R7）
        const allEnds = [];
        for (const entry of runList) allEnds.push(entry.run.a, entry.run.b);
        for (const { run, key } of runList) {
          if (!run.horizontal) continue;
          const lo = Math.min(run.a.x, run.b.x);
          const hi = Math.max(run.a.x, run.b.x);
          const y = run.a.y;
          const list = [];
          for (const other of runList) {
            if (other.key === key || other.run.horizontal) continue;
            const x = other.run.a.x;
            if (x < lo + HOP_R + 14 || x > hi - HOP_R - 14) continue;
            const y1 = Math.min(other.run.a.y, other.run.b.y);
            const y2 = Math.max(other.run.a.y, other.run.b.y);
            if (y < y1 + HOP_R + 10 || y > y2 - HOP_R - 10) continue;
            if (allEnds.some((point) => Math.hypot(point.x - x, point.y - y) < 20)) continue;
            list.push({ x, y });
          }
          if (!list.length) continue;
          const previous = hopsOf.get(key) || [];
          hopsOf.set(key, previous.concat(list));
        }

        // 每条带标签的连线都要定位标签：穿过子图的长边，标签层可能落在帧内，
        // 此时沿自己的折线滑到最近的可放位置（R8：标签中心必须压在自己的线上）。
        const routeBySeq = new Map(routes.map((route) => [route.le.edge.seq, route]));
        const labelRoute = new Map();
        for (const item of allItems) {
          if (item.kind !== 'label') continue;
          const route = routeBySeq.get(item.edge.seq);
          if (route) labelRoute.set(item, route);
        }
        const labelRects = new Map();
        // 折角画的是圆角、跨线画的是小弯：标签最后要吸附到“真正画出来的那根线”上
        const cubicAt = (segment, t) => {
          const u = 1 - t;
          const a = u * u * u;
          const b = 3 * u * u * t;
          const c = 3 * u * t * t;
          const d = t * t * t;
          return {
            x: a * segment.p0.x + b * segment.c1.x + c * segment.c2.x + d * segment.p1.x,
            y: a * segment.p0.y + b * segment.c1.y + c * segment.c2.y + d * segment.p1.y,
          };
        };
        const renderedByRoute = new Map(routes.map((route) => [
          route,
          segmentsOf(route.points, hopsOf.get(route) || []),
        ]));
        const frameRects = [...clusters.values()].map((cluster) => cluster.rect).filter(Boolean);
        // 只避让已经落位的标签；未放置标签的虚拟位置不能占住其它标签唯一的可行空隙。
        const titleRects = [];
        for (const cluster of clusters.values()) {
          const title = tbTitleRect(cluster);
          if (title) titleRects.push(title);
        }
        const fits = (item, route, rect) => {
          for (const node of realItems) if (boxesOverlap(rect, tbRectOf(node), 2)) return false;
          for (const [other, otherRect] of labelRects) {
            if (other !== item && boxesOverlap(rect, otherRect, 3)) return false;
          }
          for (const loop of loopResults) {
            if (loop.labelRect && boxesOverlap(rect, loop.labelRect, 3)) return false;
          }
          for (const title of titleRects) if (boxesOverlap(rect, title, 2)) return false;
          for (const frame of frameRects) {
            if (!boxesOverlap(rect, frame, 1)) continue;
            const inside = rect.x >= frame.x - 0.5 && rect.y >= frame.y - 0.5
              && rect.x + rect.w <= frame.x + frame.w + 0.5
              && rect.y + rect.h <= frame.y + frame.h + 0.5;
            if (!inside) return false;
          }
          for (const other of routes) {
            if (other === route) continue;
            if (hitsRun(rect, other.points)) return false;
            // 跨线弯向轨道外凸出 5px：仅检查原始折线会把标签放在弯弧上。
            for (const segment of renderedByRoute.get(other) || []) {
              if (segment.kind === 'line') continue;
              for (let i = 0; i <= 12; i += 1) {
                const point = cubicAt(segment, i / 12);
                if (point.x > rect.x - 1 && point.x < rect.x + rect.w + 1
                  && point.y > rect.y - 1 && point.y < rect.y + rect.h + 1) return false;
              }
            }
          }
          for (const loop of loopResults) if (hitsRun(rect, loop.points)) return false;
          return true;
        };
        // 标签中心必须压在自己的折线上（R8）：沿直线段滑动，取离首选位置最近且不与任何元素相碰的点
        for (const [item, route] of labelRoute) {
          const width = item.bw;
          const height = item.bh;
          const pref = {
            x: (route.kind === 'back' ? route.channelX : item.centerX),
            y: item.cy,
          };
          let best = null;
          let bestDistance = Infinity;
          let fallback = null;
          let fallbackDistance = Infinity;
          // 折角处画的是 6px 圆角，标签压在那儿会离线 2~3px；给折角加权，优先落在直段上
          const corners = route.points.slice(1, -1);
          for (const run of runsOf(route.points)) {
            const len = Math.hypot(run.b.x - run.a.x, run.b.y - run.a.y);
            const steps = Math.max(1, Math.ceil(len / 6));
            for (let step = 0; step <= steps; step += 1) {
              const t = step / steps;
              const px = run.a.x + (run.b.x - run.a.x) * t;
              const py = run.a.y + (run.b.y - run.a.y) * t;
              const nearCorner = corners.some((corner) => Math.hypot(corner.x - px, corner.y - py) < R_CORNER + height / 2 + 2);
              const distance = Math.hypot(px - pref.x, py - pref.y) + (nearCorner ? 14 : 0);
              const candidate = {
                x: px - width / 2, y: py - height / 2, w: width, h: height,
              };
              if (distance < fallbackDistance) {
                fallback = candidate;
                fallbackDistance = distance;
              }
              if (distance >= bestDistance) continue;
              if (!fits(item, route, candidate)) continue;
              best = candidate;
              bestDistance = distance;
            }
          }
          const chosen = best || fallback;
          if (!chosen) continue;
          // 中心吸到绘制曲线的最近点上（圆角 / 跨线弯之后，原始折点可能离线 2~3px）
          const segments = renderedByRoute.get(route) || [];
          let nearestPoint = null;
          let nearestDistance = Infinity;
          for (const segment of segments) {
            const span = Math.hypot(segment.p1.x - segment.p0.x, segment.p1.y - segment.p0.y);
            const steps = Math.max(8, Math.min(80, Math.ceil(span / 2)));
            for (let step = 0; step <= steps; step += 1) {
              const point = cubicAt(segment, step / steps);
              const distance = Math.hypot(point.x - (chosen.x + width / 2), point.y - (chosen.y + height / 2));
              if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestPoint = point;
              }
            }
          }
          if (nearestPoint && nearestDistance > 0.05 && nearestDistance < 8) {
            chosen.x += nearestPoint.x - (chosen.x + width / 2);
            chosen.y += nearestPoint.y - (chosen.y + height / 2);
          }
          labelRects.set(item, chosen);
        }
        // 兜底：没找到落点的标签也用初始位置吸附一次，保证中心总在绘制线上
        for (const [item, route] of labelRoute) {
          const rect = labelRects.get(item);
          if (!rect) continue;
          const segments = renderedByRoute.get(route) || [];
          let point = null;
          let distance = Infinity;
          for (const segment of segments) {
            const span = Math.hypot(segment.p1.x - segment.p0.x, segment.p1.y - segment.p0.y);
            const steps = Math.max(8, Math.min(80, Math.ceil(span / 2)));
            for (let step = 0; step <= steps; step += 1) {
              const at = cubicAt(segment, step / steps);
              const gap = Math.hypot(at.x - (rect.x + rect.w / 2), at.y - (rect.y + rect.h / 2));
              if (gap < distance) {
                distance = gap;
                point = at;
              }
            }
          }
          if (!point || distance <= 0.05 || distance > 24) continue;
          rect.x += point.x - (rect.x + rect.w / 2);
          rect.y += point.y - (rect.y + rect.h / 2);
        }

        return {
          routes: routes.map((route) => ({
            le: route.le,
            start: route.points[0],
            end: route.points[route.points.length - 1],
            points: route.points,
            segments: segmentsOf(route.points, hopsOf.get(route) || []),
          })),
          loops: loopResults.map((loop) => ({
            edge: loop.edge,
            item: loop.item,
            start: loop.points[0],
            end: loop.points[loop.points.length - 1],
            points: loop.points,
            segments: segmentsOf(loop.points, hopsOf.get(loop) || []),
            labelRect: loop.labelRect,
            labelLines: loop.labelLines,
          })),
          labels: labelRects,
        };
      },
    };
  })();

  // 纵向：层高 + 间距；子图标题占用上下空隙
  const rankHeight = (r) => (rankItems.get(r) || []).reduce((best, item) => Math.max(best, item.bh), 0);
  const rankReal = (r) => (rankItems.get(r) || []).some((item) => item.kind === 'real');
  const rankLabel = (r) => (rankItems.get(r) || []).some((item) => item.kind === 'label');
  // ER 端点要先走一段 ER_STUB 直线放基数标记（16px），再弯向标签；层间距按此留足。
  const ER_STUB = 18;
  const baseGap = (a, b) => {
    if (model.type === 'er' && (rankReal(a) || rankReal(b))) return rankReal(a) && rankReal(b) ? ER_STUB * 2 + 24 : ER_STUB + 20;
    if (rankReal(a) && rankReal(b)) return 34;
    if (rankReal(a) || rankReal(b)) return 20;
    if (rankLabel(a) || rankLabel(b)) return 16;
    return 16;
  };
  const topExt = (cluster) => {
    if (cluster === root) return 0;
    if (isLR) return 12;
    return cluster.titleBand;
  };
  const bottomExt = (cluster) => (cluster === root ? 0 : 12);

  for (const cluster of clusters.values()) {
    const items = realItems.filter((item) => isDescendantOf(item.cluster, cluster));
    if (!items.length) {
      cluster.topRank = Infinity;
      cluster.bottomRank = -Infinity;
      continue;
    }
    cluster.topRank = Math.min(...items.map((item) => item.rank));
    cluster.bottomRank = Math.max(...items.map((item) => item.rank));
  }
  const stackTop = (cluster) => {
    let nested = 0;
    for (const child of cluster.children) {
      if (child.topRank === cluster.topRank && Number.isFinite(child.topRank)) nested = Math.max(nested, stackTop(child));
    }
    return topExt(cluster) + nested;
  };
  const stackBottom = (cluster) => {
    let nested = 0;
    for (const child of cluster.children) {
      if (child.bottomRank === cluster.bottomRank && Number.isFinite(child.bottomRank)) nested = Math.max(nested, stackBottom(child));
    }
    return bottomExt(cluster) + nested;
  };
  const gapExtra = new Map();
  for (let r = 0; r < maxRank; r += 1) {
    const topNeed = [...clusters.values()]
      .filter((cluster) => cluster.topRank === r + 1)
      .reduce((best, cluster) => Math.max(best, stackTop(cluster)), 0);
    const bottomNeed = [...clusters.values()]
      .filter((cluster) => cluster.bottomRank === r)
      .reduce((best, cluster) => Math.max(best, stackBottom(cluster)), 0);
    gapExtra.set(r, Math.max(topNeed, bottomNeed));
  }
  // 同一对节点之间平行边多时加宽层间距，给标签和分叉留出水平空间
  const boundaryPairs = new Map();
  for (const le of layoutEdges) {
    if (!le.fromItem || !le.toItem) continue;
    const from = Math.min(le.fromItem.rank, le.toItem.rank);
    const to = Math.max(le.fromItem.rank, le.toItem.rank);
    const fromId = le.edge.from;
    const toId = le.edge.to;
    const key = fromId < toId ? `${fromId}<->${toId}` : `${toId}<->${fromId}`;
    for (let r = from; r < to; r += 1) {
      if (!boundaryPairs.has(r)) boundaryPairs.set(r, new Map());
      const counts = boundaryPairs.get(r);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  for (const [r, counts] of boundaryPairs) {
    const maxParallel = Math.max(...counts.values());
    if (maxParallel <= 3) continue;
    gapExtra.set(r, Math.max(gapExtra.get(r) || 0, (maxParallel - 3) * 24));
  }
  const y = new Map([[0, 0]]);
  for (let r = 1; r <= maxRank; r += 1) {
    y.set(r, y.get(r - 1) + rankHeight(r - 1) / 2 + baseGap(r - 1, r) + (gapExtra.get(r - 1) || 0) + rankHeight(r) / 2);
  }
  for (const item of allItems) item.cy = y.get(item.rank);

  const computeFrameRect = (cluster) => {
    for (const child of cluster.children) computeFrameRect(child);
    if (cluster === root) {
      cluster.rect = null;
      return;
    }
    const items = allItems.filter((item) => isDescendantOf(item.cluster, cluster));
    if (!items.length) {
      cluster.rect = null;
      return;
    }
    let top = Math.min(...items.map((item) => item.cy - item.bh / 2));
    let bottom = Math.max(...items.map((item) => item.cy + item.bh / 2));
    for (const child of cluster.children) {
      if (!child.rect) continue;
      top = Math.min(top, child.rect.y);
      bottom = Math.max(bottom, child.rect.y + child.rect.h);
    }
    cluster.rect = {
      x: cluster.left,
      y: top - topExt(cluster),
      w: cluster.width,
      h: bottom + bottomExt(cluster) - (top - topExt(cluster)),
    };
  };
  computeFrameRect(root);

  // 层间轨道放不下时加高该层间距（R6：同一区间横线 ≥12px，不同连线不共线）
  if (ortho) {
    const trackWindow = (gap) => {
      let lo = -Infinity;
      let hi = Infinity;
      for (const item of rankItems.get(gap) || []) lo = Math.max(lo, item.cy + item.bh / 2);
      for (const item of rankItems.get(gap + 1) || []) hi = Math.min(hi, item.cy - item.bh / 2);
      for (const cluster of clusters.values()) {
        if (!cluster.rect) continue;
        if (cluster.topRank === gap + 1) hi = Math.min(hi, cluster.rect.y - 6);
        if (cluster.bottomRank === gap) lo = Math.max(lo, cluster.rect.y + cluster.rect.h + 6);
      }
      return { lo, hi };
    };
    const neededOf = (list) => ((list.length - 1) * 12) + 32;
    for (let pass = 0; pass < 10; pass += 1) {
      let grown = false;
      for (let gap = 0; gap < maxRank; gap += 1) {
        const list = ortho.gapTracks.get(gap);
        if (!list || !list.length) continue;
        const window = trackWindow(gap);
        const need = neededOf(list);
        if (window.hi - window.lo >= need - 1e-6) continue;
        gapExtra.set(gap, (gapExtra.get(gap) || 0) + (need - (window.hi - window.lo)) + 2);
        grown = true;
        y.set(0, 0);
        for (let r = 1; r <= maxRank; r += 1) {
          y.set(r, y.get(r - 1) + rankHeight(r - 1) / 2 + baseGap(r - 1, r) + (gapExtra.get(r - 1) || 0) + rankHeight(r) / 2);
        }
        for (const item of allItems) item.cy = y.get(item.rank);
        computeFrameRect(root);
      }
      if (!grown) break;
    }
    // 轨道 y：在窗口内居中，自上而下按请求顺序排列
    const gapWindow = new Map();
    for (const [gap, list] of ortho.gapTracks) {
      const window = trackWindow(gap);
      gapWindow.set(gap, window);
      const step = Math.max(12, Math.min(16, (window.hi - window.lo - 16) / Math.max(1, list.length - 1)));
      const span = (list.length - 1) * step;
      const start = window.lo + Math.max(16, (window.hi - window.lo - span) / 2);
      list.forEach((track, index) => { track.y = start + index * step; });
    }
    // 相邻层间区间的轨道也互相避让：两个轨道只隔 9px 时，两条横线会看起来像同一条（#173）
    const allTracks = [];
    for (const [gap, list] of ortho.gapTracks) for (const track of list) allTracks.push({ gap, track });
    allTracks.sort((a, b) => a.track.y - b.track.y);
    for (let i = 1; i < allTracks.length; i += 1) {
      const prev = allTracks[i - 1].track;
      const current = allTracks[i];
      const need = 12 - (current.track.y - prev.y);
      if (need <= 0.01) continue;
      const window = gapWindow.get(current.gap);
      if (!window) continue;
      const next = Math.min(window.hi - 6, current.track.y + need);
      current.track.y = Math.max(current.track.y, next);
    }
  }

  // 变换到最终方向，1:1 输出
  const tbBoxes = [];
  for (const item of realItems) {
    const cross = isLR ? item.th : item.tw;
    const flow = isLR ? item.tw : item.th;
    item.tbVisual = {
      x: item.centerX + (item.offsetCross || 0) - cross / 2,
      y: item.cy - flow / 2,
      w: cross,
      h: flow,
    };
    tbBoxes.push(item.tbVisual);
  }
  const labelItems = dummyItems.filter((item) => item.kind === 'label');
  for (const item of labelItems) {
    const cross = isLR ? item.th : item.tw;
    const flow = isLR ? item.tw : item.th;
    item.tbVisual = {
      x: item.centerX - cross / 2,
      y: item.cy - flow / 2,
      w: cross,
      h: flow,
    };
    tbBoxes.push(item.tbVisual);
  }
  for (const item of allItems) {
    tbBoxes.push({
      x: item.centerX - item.bw / 2,
      y: item.cy - item.bh / 2,
      w: item.bw,
      h: item.bh,
    });
  }
  for (const cluster of clusters.values()) if (cluster.rect) tbBoxes.push(cluster.rect);
  let tbMinX = Math.min(...tbBoxes.map((box) => box.x));
  let tbMinY = Math.min(...tbBoxes.map((box) => box.y));
  let tbMaxX = Math.max(...tbBoxes.map((box) => box.x + box.w));
  let tbMaxY = Math.max(...tbBoxes.map((box) => box.y + box.h));
  const shiftX = -tbMinX;
  const shiftY = -tbMinY;
  const W = tbMaxX - tbMinX;
  const H = tbMaxY - tbMinY;

  const transformPoint = (x, yy) => {
    const nx = x + shiftX;
    const ny = yy + shiftY;
    if (direction === 'BT') return { x: nx, y: H - ny };
    if (direction === 'LR') return { x: ny, y: nx };
    if (direction === 'RL') return { x: W - ny, y: nx };
    return { x: nx, y: ny };
  };
  const transformRect = (rect) => {
    const x1 = rect.x + shiftX;
    const y1 = rect.y + shiftY;
    const x2 = x1 + rect.w;
    const y2 = y1 + rect.h;
    if (direction === 'BT') return { x: x1, y: H - y2, w: rect.w, h: rect.h };
    if (direction === 'LR') return { x: y1, y: x1, w: rect.h, h: rect.w };
    if (direction === 'RL') return { x: W - y2, y: x1, w: rect.h, h: rect.w };
    return { x: x1, y: y1, w: rect.w, h: rect.h };
  };

  const visualNodes = new Map();
  for (const item of realItems) {
    const rect = transformRect(item.tbVisual);
    item.visualRect = rect;
    const anchor = transformPoint(item.centerX + (item.offsetCross || 0), item.cy);
    item.vx = anchor.x;
    item.vy = anchor.y;
    visualNodes.set(item.node.id, { item, rect });
  }
  const visualLabels = new Map();
  for (const item of labelItems) {
    const rect = transformRect(item.tbVisual);
    item.visualRect = rect;
    const anchor = transformPoint(item.centerX, item.cy);
    item.vx = anchor.x;
    item.vy = anchor.y;
    visualLabels.set(item, { item, rect });
  }
  for (const item of dummyItems) {
    if (item.kind === 'label') continue;
    const anchor = transformPoint(item.centerX, item.cy);
    item.vx = anchor.x;
    item.vy = anchor.y;
  }
  const visualFrames = new Map();
  for (const cluster of clusters.values()) {
    if (!cluster.rect) continue;
    const rect = transformRect(cluster.rect);
    const titleH = cluster.titleLines.length * 17 + (cluster.descLines.length ? 4 + cluster.descLines.length * 16 : 0);
    const titleRect = {
      x: rect.x + FRAME_PAD,
      y: rect.y + 10,
      w: Math.max(cluster.titleW, cluster.descW || 0, 1),
      h: Math.max(titleH, 1),
    };
    cluster.visualRect = rect;
    cluster.visualTitleRect = titleRect;
    visualFrames.set(cluster.id, { cluster, rect, titleRect });
  }

  // 端点端口与连线几何：ER 关系线沿用平滑三次曲线；流程图 / 状态图走直角折线。
  // 直角折线已在纵向排布前规划（端口、回边通道、层间轨道），这里只做落位后的几何生成。
  let selfResults = [];
  const clampValue = (value, min, max) => Math.max(min, Math.min(max, value));
  const centerOfRect = (rect) => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
  const boxesOverlap = (a, b, pad = 0) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x
    && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

  if (ortho) {
    const built = ortho.build();
    const toVisual = (point) => transformPoint(point.x, point.y);
    const toVisualSegments = (segments) => segments.map((seg) => ({
      p0: toVisual(seg.p0),
      p1: toVisual(seg.p1),
      c1: toVisual(seg.c1),
      c2: toVisual(seg.c2),
      kind: seg.kind,
    }));
    for (const route of built.routes) {
      const { le } = route;
      le.start = toVisual(route.start);
      le.end = toVisual(route.end);
      le.points = route.points.map(toVisual);
      le.segments = toVisualSegments(route.segments);
    }
    for (const [item, rect] of built.labels) {
      item.visualRect = transformRect(rect);
      item.vx = item.visualRect.x + item.visualRect.w / 2;
      item.vy = item.visualRect.y + item.visualRect.h / 2;
    }
    selfResults = built.loops.map((loop) => ({
      edge: loop.edge,
      item: loop.item,
      start: toVisual(loop.start),
      end: toVisual(loop.end),
      points: loop.points.map(toVisual),
      segments: toVisualSegments(loop.segments),
      labelRect: loop.labelRect ? transformRect(loop.labelRect) : null,
      labelLines: loop.labelLines,
    }));
  } else {
  // 端点端口：同节点同侧的多条线按另一端位置分散；帧边按帧的层范围选上下/左右侧
  const endpointSide = (center, adjacent) => {
    if (isLR) return adjacent.x >= center.x ? 'right' : 'left';
    return adjacent.y >= center.y ? 'bottom' : 'top';
  };
  const nodePort = (item, side, cross) => {
    const rect = item.visualRect;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const halfW = rect.w / 2;
    const halfH = rect.h / 2;
    const shape = item.node.shape;
    const diamond = shape === 'diamond' || item.node.kind === 'choice';
    const circle = shape === 'circle' || item.node.kind === 'start' || item.node.kind === 'end';
    if (side === 'top' || side === 'bottom') {
      const x = clampValue(cross, cx - halfW * 0.96, cx + halfW * 0.96);
      let y = side === 'top' ? rect.y : rect.y + rect.h;
      if (diamond) {
        // 端点 x 已被夹到 0.96 半宽，y 必须按同一个 x 求轮廓，否则会落到形状外面
        const dx = Math.min(halfW * 0.96, Math.abs(x - cx));
        y = cy + (side === 'top' ? -1 : 1) * halfH * (1 - dx / halfW);
      } else if (circle) {
        const dx = Math.min(halfW * 0.96, Math.abs(x - cx));
        const ry = halfH * Math.sqrt(Math.max(0, 1 - (dx / halfW) ** 2));
        y = cy + (side === 'top' ? -1 : 1) * ry;
      } else if (shape === 'hexagon') {
        const cut = Math.min(16, halfW * 0.35);
        const flat = halfW - cut;
        const dx = Math.abs(x - cx);
        if (dx > flat) {
          const t = Math.min(1, (dx - flat) / Math.max(1, halfW - flat));
          y = cy + (side === 'top' ? -1 : 1) * halfH * t;
        }
      }
      return { x, y };
    }
    const y = clampValue(cross, cy - halfH * 0.96, cy + halfH * 0.96);
    let x = side === 'left' ? rect.x : rect.x + rect.w;
    if (diamond) {
      const dy = Math.min(halfH * 0.82, Math.abs(y - cy));
      x = cx + (side === 'left' ? -1 : 1) * halfW * (1 - dy / halfH);
    } else if (circle) {
      const dy = Math.min(halfH * 0.84, Math.abs(y - cy));
      const rx = halfW * Math.sqrt(Math.max(0, 1 - (dy / halfH) ** 2));
      x = cx + (side === 'left' ? -1 : 1) * rx;
    } else if (shape === 'hexagon') {
      const cut = Math.min(16, halfH * 0.35);
      const t = Math.abs(y - cy) / Math.max(1, halfH);
      x = side === 'left' ? rect.x + cut * t : rect.x + rect.w - cut * t;
    }
    return { x, y };
  };
  const framePort = (rect, side, cross) => {
    if (side === 'top' || side === 'bottom') {
      const cx = rect.x + rect.w / 2;
      const x = clampValue(cross, cx - rect.w * 0.48, cx + rect.w * 0.48);
      return { x, y: side === 'top' ? rect.y : rect.y + rect.h };
    }
    const cy = rect.y + rect.h / 2;
    const y = clampValue(cross, cy - rect.h * 0.48, cy + rect.h * 0.48);
    return { x: side === 'left' ? rect.x : rect.x + rect.w, y };
  };
  const frameSide = (id, otherRank, adjacent, center) => {
    const range = frameRankRanges.get(id);
    if (!range) return endpointSide(center, adjacent);
    if (otherRank < range.top) return isLR ? 'left' : 'top';
    if (otherRank > range.bottom) return isLR ? 'right' : 'bottom';
    return endpointSide(center, adjacent);
  };

  const portRequests = [];
  for (const le of layoutEdges) {
    if (!le.chain) continue;
    const chainStart = le.chain[0];
    const chainEnd = le.chain[le.chain.length - 1];
    const lowFrame = le.reversed ? le.toFrame : le.fromFrame;
    const highFrame = le.reversed ? le.fromFrame : le.toFrame;
    const lowId = le.reversed ? le.edge.to : le.edge.from;
    const highId = le.reversed ? le.edge.from : le.edge.to;
    const lowRange = lowFrame ? frameRankRanges.get(lowId) : null;
    const highRange = highFrame ? frameRankRanges.get(highId) : null;
    const rawMids = le.chain.slice(1, -1);
    const lowCenter = lowFrame
      ? centerOfRect(visualFrames.get(lowId).rect)
      : { x: chainStart.visualRect.x + chainStart.visualRect.w / 2, y: chainStart.visualRect.y + chainStart.visualRect.h / 2 };
    const highCenter = highFrame
      ? centerOfRect(visualFrames.get(highId).rect)
      : { x: chainEnd.visualRect.x + chainEnd.visualRect.w / 2, y: chainEnd.visualRect.y + chainEnd.visualRect.h / 2 };
    const lowAdjacent0 = rawMids.length
      ? { x: rawMids[0].vx, y: rawMids[0].vy }
      : { x: chainEnd.vx, y: chainEnd.vy };
    const highAdjacent0 = rawMids.length
      ? { x: rawMids[rawMids.length - 1].vx, y: rawMids[rawMids.length - 1].vy }
      : { x: chainStart.vx, y: chainStart.vy };
    const lowSide = lowFrame
      ? frameSide(lowId, chainEnd.rank, lowAdjacent0, lowCenter)
      : endpointSide(lowCenter, lowAdjacent0);
    const highSide = highFrame
      ? frameSide(highId, chainStart.rank, highAdjacent0, highCenter)
      : endpointSide(highCenter, highAdjacent0);
    // 帧边只保留帧外侧的虚拟点；帧内的点不绘制，线停在帧边
    const mids = rawMids.filter((item) => {
      if (lowFrame) {
        if ((lowSide === 'top' || lowSide === 'left') && item.rank >= lowRange.top) return false;
        if ((lowSide === 'bottom' || lowSide === 'right') && item.rank <= lowRange.bottom) return false;
      }
      if (highFrame) {
        if ((highSide === 'top' || highSide === 'left') && item.rank >= highRange.top) return false;
        if ((highSide === 'bottom' || highSide === 'right') && item.rank <= highRange.bottom) return false;
      }
      return true;
    });
    le.filteredMids = mids;
    const lowAdjacent = mids.length
      ? { x: mids[0].vx, y: mids[0].vy }
      : { x: chainEnd.vx, y: chainEnd.vy };
    const highAdjacent = mids.length
      ? { x: mids[mids.length - 1].vx, y: mids[mids.length - 1].vy }
      : { x: chainStart.vx, y: chainStart.vy };
    const lowCross = lowSide === 'top' || lowSide === 'bottom' ? lowAdjacent.x : lowAdjacent.y;
    const highCross = highSide === 'top' || highSide === 'bottom' ? highAdjacent.x : highAdjacent.y;
    le.lowReq = {
      le,
      role: 'low',
      id: lowId,
      isFrame: lowFrame,
      side: lowSide,
      cross: lowCross,
      item: lowFrame ? null : chainStart,
      rect: lowFrame ? visualFrames.get(lowId).rect : null,
      center: lowCenter,
      edgeSeq: le.edge.seq,
    };
    le.highReq = {
      le,
      role: 'high',
      id: highId,
      isFrame: highFrame,
      side: highSide,
      cross: highCross,
      item: highFrame ? null : chainEnd,
      rect: highFrame ? visualFrames.get(highId).rect : null,
      center: highCenter,
      edgeSeq: le.edge.seq,
    };
    portRequests.push(le.lowReq, le.highReq);
  }

  const portGroups = new Map();
  for (const request of portRequests) {
    const key = `${request.isFrame ? 'F' : 'N'}:${request.id}:${request.side}`;
    if (!portGroups.has(key)) portGroups.set(key, []);
    portGroups.get(key).push(request);
  }
  // 同一侧端口过多时，适当增大节点在十字轴上的尺寸，保证 12px 以上的间距；
  // ER 基数标记宽 12px，相邻端口至少隔 28px，两个鸦爪之间还留 16px。
  const PORT_SPACING = model.type === 'er' ? 28 : 12;
  const growth = new Map();
  for (const group of portGroups.values()) {
    const first = group[0];
    if (first.isFrame || group.length < 2) continue;
    const item = first.item;
    // 帧内节点不在这里扩张，避免顶出子图；帧边端口由帧框本身分散
    if (item.cluster && item.cluster !== root) continue;
    const vertical = first.side === 'left' || first.side === 'right';
    const current = vertical ? item.visualRect.h : item.visualRect.w;
    const required = Math.max(current, ((group.length - 1) * PORT_SPACING) / 0.96);
    const need = growth.get(item) || { w: item.visualRect.w, h: item.visualRect.h };
    if (vertical) need.h = Math.max(need.h, required);
    else need.w = Math.max(need.w, required);
    growth.set(item, need);
  }
  for (const [item, need] of growth) {
    const rect = item.visualRect;
    if (need.w <= rect.w + 0.1 && need.h <= rect.h + 0.1) continue;
    const next = {
      x: rect.x - (need.w - rect.w) / 2,
      y: rect.y - (need.h - rect.h) / 2,
      w: need.w,
      h: need.h,
    };
    const collides = realItems.some((other) => other !== item && boxesOverlap(next, other.visualRect, 4));
    if (!collides) item.visualRect = next;
  }
  for (const request of portRequests) {
    if (request.isFrame) continue;
    request.center = centerOfRect(request.item.visualRect);
  }

  for (const group of portGroups.values()) {
    group.sort((a, b) => a.cross - b.cross || a.edgeSeq - b.edgeSeq || (a.role === 'low' ? -1 : 1));
    const count = group.length;
    const first = group[0];
    const sideLength = first.isFrame
      ? (first.side === 'top' || first.side === 'bottom' ? first.rect.w : first.rect.h)
      : (first.side === 'top' || first.side === 'bottom'
        ? first.item.visualRect.w
        : first.item.visualRect.h);
    const centerCross = first.side === 'top' || first.side === 'bottom' ? first.center.x : first.center.y;
    const span = count === 1 ? 0 : Math.min(sideLength * 0.96, PORT_SPACING * (count - 1));
    group.forEach((request, index) => {
      const cross = count === 1 ? centerCross : centerCross - span / 2 + (span * index) / (count - 1);
      request.port = request.isFrame
        ? framePort(request.rect, request.side, cross)
        : nodePort(request.item, request.side, cross);
    });
  }

  // 平滑三次曲线：相邻两点之间沿层方向切线，每条线只经过自己的虚拟节点链。
  const buildSegments = (points) => {
    const segments = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const p0 = points[i];
      const p1 = points[i + 1];
      if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 0.01) continue;
      let c1;
      let c2;
      if (isLR) {
        const mx = (p0.x + p1.x) / 2;
        c1 = { x: mx, y: p0.y };
        c2 = { x: mx, y: p1.y };
      } else {
        const my = (p0.y + p1.y) / 2;
        c1 = { x: p0.x, y: my };
        c2 = { x: p1.x, y: my };
      }
      segments.push({ p0, p1, c1, c2 });
    }
    return segments;
  };

  // 端点沿出线侧的法向走 ER_STUB 直线：基数标记按端点切线绘制，曲线若立刻转弯，标记会悬在线外。
  const stubOf = (port, side) => ({
    x: port.x + (side === 'right' ? ER_STUB : side === 'left' ? -ER_STUB : 0),
    y: port.y + (side === 'bottom' ? ER_STUB : side === 'top' ? -ER_STUB : 0),
  });
  const straight = (p0, p1) => ({
    p0, p1, c1: { x: p0.x + (p1.x - p0.x) / 3, y: p0.y + (p1.y - p0.y) / 3 }, c2: { x: p0.x + ((p1.x - p0.x) * 2) / 3, y: p0.y + ((p1.y - p0.y) * 2) / 3 },
  });
  for (const le of layoutEdges) {
    if (!le.chain || !le.lowReq) continue;
    const mids = le.filteredMids.map((item) => ({ x: item.vx, y: item.vy }));
    if (model.type === 'er') {
      const lowStub = stubOf(le.lowReq.port, le.lowReq.side);
      const highStub = stubOf(le.highReq.port, le.highReq.side);
      const segments = [straight(le.lowReq.port, lowStub), ...buildSegments([lowStub, ...mids, highStub]), straight(highStub, le.highReq.port)];
      le.start = le.reversed ? le.highReq.port : le.lowReq.port;
      le.end = le.reversed ? le.lowReq.port : le.highReq.port;
      le.segments = le.reversed
        ? segments.reverse().map(({ p0, p1, c1, c2 }) => ({ p0: p1, p1: p0, c1: c2, c2: c1 }))
        : segments;
      continue;
    }
    const lowPoints = [le.lowReq.port, ...mids, le.highReq.port];
    const points = le.reversed ? [...lowPoints].reverse() : lowPoints;
    le.start = points[0];
    le.end = points[points.length - 1];
    le.segments = buildSegments(points);
  }

  selfResults = [];
  for (const item of realItems) {
    if (!item.selfLoops.length) continue;
    for (const edge of item.selfLoops) {
      const rect = item.visualRect;
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      const labelWidth = edge.label ? maxWidthOf(wrapText(edge.label, 120, FONT.label, measure), FONT.label, measure) : 0;
      const labelLines = edge.label ? wrapText(edge.label, 120, FONT.label, measure) : [];
      const labelHeight = labelLines.length ? labelLines.length * 16 + 6 : 0;
      const loop = direction === 'LR' || direction === 'RL'
        ? Math.max(16, labelLines.length ? (labelHeight + 12) / 1.5 : 16)
        : Math.max(16, labelLines.length ? (labelWidth + 22) / 1.5 : 16);
      let start;
      let end;
      let segments;
      let outer;
      if (direction === 'LR' || direction === 'RL') {
        const below = direction === 'LR';
        const side = below ? 'bottom' : 'top';
        const ySide = below ? rect.y + rect.h : rect.y;
        start = nodePort(item, side, cx - 8);
        end = nodePort(item, side, cx + 8);
        outer = below ? ySide + loop * 0.75 : ySide - loop * 0.75;
        segments = [{
          p0: start,
          p1: end,
          c1: { x: cx - 8, y: below ? ySide + loop : ySide - loop },
          c2: { x: cx + 8, y: below ? ySide + loop : ySide - loop },
        }];
      } else {
        const right = rect.x + rect.w;
        start = nodePort(item, 'right', cy - 8);
        end = nodePort(item, 'right', cy + 8);
        outer = right + loop * 0.75;
        segments = [{
          p0: start,
          p1: end,
          c1: { x: right + loop, y: cy - 8 },
          c2: { x: right + loop, y: cy + 8 },
        }];
      }
      let labelRect = null;
      if (labelLines.length) {
        if (direction === 'LR' || direction === 'RL') {
          labelRect = {
            x: cx - (labelWidth + 10) / 2,
            y: outer - labelHeight / 2,
            w: labelWidth + 10,
            h: labelHeight,
          };
        } else {
          labelRect = {
            x: outer - (labelWidth + 10) / 2,
            y: cy - labelHeight / 2,
            w: labelWidth + 10,
            h: labelHeight,
          };
        }
      }
      selfResults.push({
        edge,
        item,
        start,
        end,
        segments,
        labelRect,
        labelLines,
      });
    }
  }

  // 标签沿线微调：中心仍压在自身连线上，但避开其他连线和标签。
  const labelEdgeMap = new Map();
  for (const le of layoutEdges) {
    const item = le.chain ? le.chain.find((part) => part.kind === 'label') : null;
    if (item) labelEdgeMap.set(item, le);
  }
  const pointOnSegment = (segment, t) => {
    const u = 1 - t;
    return {
      x: u * u * u * segment.p0.x + 3 * u * u * t * segment.c1.x + 3 * u * t * t * segment.c2.x + t * t * t * segment.p1.x,
      y: u * u * u * segment.p0.y + 3 * u * u * t * segment.c1.y + 3 * u * t * t * segment.c2.y + t * t * t * segment.p1.y,
    };
  };
  const allSegments = [];
  for (const le of layoutEdges) if (le.segments && le.segments.length) allSegments.push({ le, segments: le.segments });
  for (const loop of selfResults) allSegments.push({ loop, segments: loop.segments });
  const labelRectList = () => {
    const list = labelItems.map((item) => item.visualRect);
    for (const loop of selfResults) if (loop.labelRect) list.push(loop.labelRect);
    return list;
  };
  const labelFits = (rect, item, ownLe) => {
    for (const node of realItems) {
      if (boxesOverlap(rect, node.visualRect, 2)) return false;
    }
    for (const other of labelItems) {
      if (other !== item && boxesOverlap(rect, other.visualRect, 2)) return false;
    }
    for (const loop of selfResults) {
      if (loop.labelRect && boxesOverlap(rect, loop.labelRect, 2)) return false;
    }
    for (const frame of visualFrames.values()) {
      if (frame.titleRect && boxesOverlap(rect, frame.titleRect, 2)) return false;
    }
    for (const entry of allSegments) {
      if (entry.le === ownLe || entry.loop) continue;
      for (const segment of entry.segments) {
        for (let step = 0; step <= 48; step += 1) {
          const point = pointOnSegment(segment, step / 48);
          if (point.x > rect.x + 0.5 && point.x < rect.x + rect.w - 0.5
            && point.y > rect.y + 0.5 && point.y < rect.y + rect.h - 0.5) return false;
        }
      }
    }
    return true;
  };
  // 直角折线的标签在规划阶段已沿自己的竖线放好，不再走这里的候选点回退
  if (!ortho) {
    const labelOrder = [...labelItems].sort((a, b) => a.edge.seq - b.edge.seq);
    for (const item of labelOrder) {
      const le = labelEdgeMap.get(item);
      if (!le || !le.segments || !le.segments.length) continue;
      const original = item.visualRect;
      if (labelFits(original, item, le)) continue;
      const width = original.w;
      const height = original.h;
      const candidates = [];
      for (const segment of le.segments) {
        for (let step = 6; step <= 44; step += 1) {
          const t = step / 50;
          const point = pointOnSegment(segment, t);
          candidates.push({
            x: point.x - width / 2,
            y: point.y - height / 2,
            w: width,
            h: height,
          });
        }
      }
      let best = null;
      let bestDistance = Infinity;
      for (const candidate of candidates) {
        if (!labelFits(candidate, item, le)) continue;
        const distance = Math.hypot(candidate.x - original.x, candidate.y - original.y);
        if (distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
        }
      }
      if (best) {
        item.visualRect = best;
        item.vx = best.x + width / 2;
        item.vy = best.y + height / 2;
      }
    }
  }

  // 计算最终画布：包含节点、标签、子图与连线控制点
  }
  const visualBoxes = [];
  for (const item of realItems) visualBoxes.push(item.visualRect);
  for (const item of labelItems) visualBoxes.push(item.visualRect);
  for (const cluster of clusters.values()) {
    if (cluster.visualRect) visualBoxes.push(cluster.visualRect);
    if (cluster.visualTitleRect) visualBoxes.push(cluster.visualTitleRect);
  }
  for (const le of layoutEdges) {
    if (!le.segments) continue;
    for (const seg of le.segments) {
      visualBoxes.push({ x: seg.p0.x, y: seg.p0.y, w: 0, h: 0 });
      visualBoxes.push({ x: seg.p1.x, y: seg.p1.y, w: 0, h: 0 });
      visualBoxes.push({ x: seg.c1.x, y: seg.c1.y, w: 0, h: 0 });
      visualBoxes.push({ x: seg.c2.x, y: seg.c2.y, w: 0, h: 0 });
    }
  }
  for (const loop of selfResults) {
    for (const seg of loop.segments) {
      visualBoxes.push({ x: seg.p0.x, y: seg.p0.y, w: 0, h: 0 });
      visualBoxes.push({ x: seg.p1.x, y: seg.p1.y, w: 0, h: 0 });
      visualBoxes.push({ x: seg.c1.x, y: seg.c1.y, w: 0, h: 0 });
      visualBoxes.push({ x: seg.c2.x, y: seg.c2.y, w: 0, h: 0 });
    }
    if (loop.labelRect) visualBoxes.push(loop.labelRect);
  }
  const minX = Math.min(...visualBoxes.map((box) => box.x));
  const minY = Math.min(...visualBoxes.map((box) => box.y));
  const maxX = Math.max(...visualBoxes.map((box) => box.x + box.w));
  const maxY = Math.max(...visualBoxes.map((box) => box.y + box.h));
  const offsetX = MARGIN - minX;
  const offsetY = MARGIN - minY;
  const width = Math.ceil(maxX - minX + MARGIN * 2);
  const height = Math.ceil(maxY - minY + MARGIN * 2);
  const movePoint = (point) => ({ x: point.x + offsetX, y: point.y + offsetY });
  const moveRect = (rect) => ({
    x: rect.x + offsetX, y: rect.y + offsetY, w: rect.w, h: rect.h,
  });
  for (const item of realItems) {
    item.visualRect = moveRect(item.visualRect);
    const anchor = movePoint({ x: item.vx, y: item.vy });
    item.vx = anchor.x;
    item.vy = anchor.y;
  }
  for (const item of labelItems) {
    item.visualRect = moveRect(item.visualRect);
    const anchor = movePoint({ x: item.vx, y: item.vy });
    item.vx = anchor.x;
    item.vy = anchor.y;
  }
  for (const item of dummyItems) {
    if (item.kind === 'label') continue;
    const anchor = movePoint({ x: item.vx, y: item.vy });
    item.vx = anchor.x;
    item.vy = anchor.y;
  }
  for (const cluster of clusters.values()) {
    if (cluster.visualRect) cluster.visualRect = moveRect(cluster.visualRect);
    if (cluster.visualTitleRect) cluster.visualTitleRect = moveRect(cluster.visualTitleRect);
  }
  for (const le of layoutEdges) {
    le.start = le.start ? movePoint(le.start) : null;
    le.end = le.end ? movePoint(le.end) : null;
    le.segments = le.segments.map((seg) => ({
      p0: movePoint(seg.p0),
      p1: movePoint(seg.p1),
      c1: movePoint(seg.c1),
      c2: movePoint(seg.c2),
      ...(seg.kind === undefined ? {} : { kind: seg.kind }),
    }));
  }
  for (const loop of selfResults) {
    loop.start = movePoint(loop.start);
    loop.end = movePoint(loop.end);
    loop.segments = loop.segments.map((seg) => ({
      p0: movePoint(seg.p0),
      p1: movePoint(seg.p1),
      c1: movePoint(seg.c1),
      c2: movePoint(seg.c2),
      ...(seg.kind === undefined ? {} : { kind: seg.kind }),
    }));
    if (loop.labelRect) loop.labelRect = moveRect(loop.labelRect);
  }

  const nodes = realItems.map((item) => {
    const text = labelBlock(item, item.visualRect);
    return {
      id: item.node.id,
      kind: item.node.kind,
      shape: item.node.shape,
      class: item.node.class,
      label: item.node.label,
      lines: item.titleLines,
      descLines: item.descLines,
      er: item.er,
      parent: item.parent,
      x: item.visualRect.x,
      y: item.visualRect.y,
      w: item.visualRect.w,
      h: item.visualRect.h,
      titleY: text.titleY,
      descY: text.descY,
    };
  });
  const labels = labelItems.map((item) => ({
    id: item.id,
    edge: item.edge.seq,
    lines: item.labelLines,
    x: item.visualRect.x,
    y: item.visualRect.y,
    w: item.visualRect.w,
    h: item.visualRect.h,
  }));
  for (const loop of selfResults) {
    if (!loop.labelRect) continue;
    labels.push({
      id: `@@self:${loop.edge.seq}`,
      edge: loop.edge.seq,
      lines: loop.labelLines,
      x: loop.labelRect.x,
      y: loop.labelRect.y,
      w: loop.labelRect.w,
      h: loop.labelRect.h,
    });
  }
  const frames = [...clusters.values()]
    .filter((cluster) => cluster.visualRect)
    .map((cluster) => ({
      id: cluster.id,
      title: cluster.title,
      class: cluster.class,
      kind: cluster.model.kind,
      parent: cluster.model.parent || null,
      lines: cluster.titleLines,
      descLines: cluster.descLines,
      x: cluster.visualRect.x,
      y: cluster.visualRect.y,
      w: cluster.visualRect.w,
      h: cluster.visualRect.h,
      titleRect: cluster.visualTitleRect,
    }));
  const edges = [];
  for (const le of layoutEdges) {
    const labelItem = le.chain.find((item) => item.kind === 'label');
    edges.push({
      id: le.edge.seq,
      from: le.edge.from,
      to: le.edge.to,
      fromFrame: le.fromFrame,
      toFrame: le.toFrame,
      label: le.edge.label,
      style: le.edge.style,
      startArrow: le.edge.startArrow,
      endArrow: le.edge.endArrow,
      startMark: le.edge.startMark,
      endMark: le.edge.endMark,
      animated: le.edge.anim?.animate,
      startCard: le.edge.startCard || null,
      endCard: le.edge.endCard || null,
      start: le.start,
      end: le.end,
      segments: le.segments,
      labelRect: labelItem ? labelItem.visualRect : null,
      labelLines: labelItem ? labelItem.labelLines : [],
      self: false,
    });
  }
  for (const loop of selfResults) {
    edges.push({
      id: loop.edge.seq,
      from: loop.edge.from,
      to: loop.edge.to,
      fromFrame: false,
      toFrame: false,
      label: loop.edge.label,
      style: loop.edge.style,
      startArrow: loop.edge.startArrow,
      endArrow: loop.edge.endArrow,
      startMark: loop.edge.startMark,
      endMark: loop.edge.endMark,
      animated: loop.edge.anim?.animate,
      startCard: null,
      endCard: null,
      start: loop.start,
      end: loop.end,
      segments: loop.segments,
      labelRect: loop.labelRect,
      labelLines: loop.labelLines,
      self: true,
    });
  }

  return {
    type: model.type,
    direction,
    width,
    height,
    nodes,
    labels,
    frames,
    edges,
    ranks: [...rankItems.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([r, items]) => ({ rank: r, items: items.map((item) => item.id) })),
    warnings,
    model,
  };
}

export { layoutGraph };
