import { normalizeLabel } from './label.js';
import { presentation } from './presentation.js';
import { FONT, appearance, error, textBlock, warning } from './support.js';

const optionMode = 'raw';
const honoredConfig = ['showBranches', 'showCommitLabel', 'mainBranchName', 'mainBranchOrder', 'parallelCommits', 'diagramPadding', 'titleTopMargin', 'rotateCommitLabel'].map(key => `gitGraph.${key}`);
const quoted = /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')$/;
const valueOf = token => quoted.test(token) ? token.slice(1, -1).replace(/\\(.)/g, '$1') : token;
const ref = token => token && (quoted.test(token) || /^\w(?:[-./\w]*[-\w])?$/.test(token));

function attributes(command, tokens) {
  const attrs = { tags: [] };
  const allowed = { commit: ['id', 'msg', 'type', 'tag'], merge: ['id', 'type', 'tag'], 'cherry-pick': ['id', 'parent', 'tag'] }[command];
  for (let i = 0; i < tokens.length;) {
    const key = quoted.test(tokens[i]) ? 'msg' : tokens[i++];
    if (!allowed.includes(key)) return null;
    if (tokens[i] === ':') i++;
    else if (key !== 'msg') return null;
    const val = tokens[i++];
    if (key === 'type' ? !['NORMAL', 'REVERSE', 'HIGHLIGHT'].includes(val) : !quoted.test(val ?? '')) return null;
    if (key === 'tag') attrs.tags.push(valueOf(val));
    else attrs[key] = valueOf(val);
  }
  return attrs;
}

function parse(body, { lang, firstLine = 2, headerLine = firstLine - 1, title = '', params = '', config }) {
  const errors = [], commits = [], byId = new Map(), assets = new Set(), duplicateIds = new Set();
  const look = presentation({ lang });
  const clean = (value, line) => {
    const { text, icon, diagnostics } = normalizeLabel(value, { lang, line });
    if (icon) diagnostics.push(warning('IGNORED_ASSET', lang, line, 'Git 标签仅显示文本', 'Git labels display text only'));
    for (const d of diagnostics) if (!assets.has(d.message)) { assets.add(d.message); errors.push(d); }
    return text;
  };
  config = config?.gitGraph || {};
  const main = typeof config.mainBranchName === 'string' && config.mainBranchName || 'main';
  const branches = new Map([[main, { name: main, label: clean(main, headerLine), order: Number(config.mainBranchOrder) || 0 }]]);
  let current = branches.get(main);
  const fail = (line, zh, en) => errors.push(error(lang, line, zh, en, '修正提交或分支声明', 'Fix the commit or branch declaration'));
  const direction = /^(?:(LR|TB|BT)\s*:|:)?$/i.exec(params);
  if (!direction) fail(headerLine, '方向必须为 LR:、TB: 或 BT:', 'Expected header direction LR:, TB: or BT:');
  if (config.rotateCommitLabel === true) errors.push(warning('IGNORED_CONFIG', lang, headerLine,
    '提交标签保持水平', 'Commit labels remain horizontal', '无需旋转设置', 'Remove the rotation setting'));
  let branchIndex = 0;
  for (const [i, raw] of body.split('\n').entries()) {
    const s = raw.trim(), line = firstLine + i;
    if (!s || s.startsWith('%%') || look.accept(s, line)) continue;
    const heading = /^title(?:\s*:\s*|\s+)(.+)/i.exec(s);
    if (heading) { title = clean(heading[1], line); continue; }
    const tokens = [];
    for (const [token] of s.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|%%.*|:|[^\s:"']+/g)) {
      if (token.startsWith('%%')) break;
      tokens.push(token);
    }
    const command = tokens.shift();
    if (['branch', 'checkout', 'switch', 'merge'].includes(command)) {
      const name = valueOf(tokens[0]);
      if (!ref(tokens.shift())) { fail(line, '缺少有效的分支名', 'Expected a valid branch name'); continue; }
      if (command === 'branch') {
        const order = tokens.length === 3 && tokens[0] === 'order' && tokens[1] === ':' && /^\d+$/.test(tokens[2]) ? Number(tokens[2]) : null;
        if (branches.has(name) || (tokens.length && !Number.isSafeInteger(order))) { fail(line, '重复的分支或无效的顺序', 'Duplicate branch or invalid order'); continue; }
        if (branches.size === 2000) { fail(line, '分支超过 2000 个，请拆分图表', 'More than 2000 branches; split the diagram'); break; }
        const seq = ++branchIndex;
        branches.set(name, current = { name, label: clean(name, line), order: order ?? Number(`0.${seq}`), head: current.head });
        continue;
      }
      const other = branches.get(name);
      if (!other) { fail(line, `未知分支：${name}`, `Unknown branch: ${name}`); continue; }
      if (command !== 'merge') {
        if (tokens.length) fail(line, '切换分支不接受额外参数', 'Unexpected checkout option');
        else current = other;
        continue;
      }
      if (!current.head || !other.head || current.head === other.head || current.head.branch === name || current === other) {
        fail(line, '合并要求两个不同的分支有不同的提交头', 'Merge requires different branches with distinct commit heads'); continue;
      }
      tokens.unshift(other.head);
    }
    if (!['commit', 'merge', 'cherry-pick'].includes(command)) { fail(line, '未知的 Git 命令', 'Unknown Git command'); continue; }
    const other = command === 'merge' ? tokens.shift() : null;
    const attrs = attributes(command, tokens);
    if (!attrs) { fail(line, '无效的提交属性', 'Invalid commit attributes'); continue; }
    const seq = commits.length;
    if (seq === 2000) { fail(line, '提交超过 2000 个，请拆分图表', 'More than 2000 commits; split the diagram'); break; }
    const parents = current.head ? [current.head.seq] : [];
    if (other) parents.push(other.seq);
    const customId = command !== 'cherry-pick' && Boolean(attrs.id);
    const id = customId ? attrs.id : undefined;
    if (customId && byId.has(id)) {
      if (command === 'merge') { fail(line, `重复的合并提交 ID：${id}`, `Duplicate merge commit ID: ${id}`); continue; }
      if (!duplicateIds.has(id)) errors.push(warning('DIAGRAM_HINT', lang, line, `重复的提交 ID：${id}`, `Duplicate commit ID: ${id}`, '使用不同的 ID', 'Use distinct IDs'));
      duplicateIds.add(id);
    }
    let cherryOf;
    if (command === 'cherry-pick') {
      const source = byId.get(attrs.id), parent = byId.get(attrs.parent);
      if (!source || !current.head || source.branch === current.name || (attrs.parent && (!parent || !source.parents.includes(parent.seq))) || (source.merge && !attrs.parent)) {
        fail(line, '拣选需要另一分支的提交和当前分支的提交头；拣选合并提交还需指定直接父提交',
          'Cherry-pick needs a source on another branch and a current head; a merge source requires an immediate parent'); continue;
      }
      parents.push(source.seq);
      cherryOf = source.id;
      if (!attrs.tags.length) attrs.tags.push(`cherry-pick:${source.id}${source.merge ? `|parent:${attrs.parent}` : ''}`);
    }
    const commit = { id, label: id && clean(id, line), seq, branch: current.name, parents, type: attrs.type,
      tags: attrs.tags.map(tag => clean(tag, line)), msg: clean(attrs.msg, line), merge: command === 'merge', cherryOf };
    commits.push(commit);
    if (customId) byId.set(id, commit);
    current.head = commit;
  }
  const presentationOf = id => ({ status: look.statusOf(id), link: look.linkOf(id) });
  const ordered = [...branches.values()].sort((a, b) => a.order - b.order).map(({ name, label, order }) => ({ name, label, order, ...presentationOf(name) }));
  let edge = 0;
  for (const commit of commits) {
    Object.assign(commit, presentationOf(commit.id ?? String(commit.seq + 1)));
    commit.edgeStatuses = commit.parents.map(() => look.edgeStatusOf(edge++));
  }
  errors.push(...look.diagnostics());
  return { model: { type: 'gitGraph', commits, branches: ordered, title, direction: direction?.[1]?.toUpperCase() || 'LR', config }, errors };
}

function roundedRoute(points) {
  let d = `M${points[0].join(' ')}`;
  const toward = (p, q, d) => {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    return len ? p.map((v, i) => v + (q[i] - v) * d / len) : p;
  };
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i], a = points[i - 1], b = points[i + 1];
    const r = Math.min(8, Math.hypot(p[0] - a[0], p[1] - a[1]) / 2, Math.hypot(b[0] - p[0], b[1] - p[1]) / 2);
    d += ` L${toward(p, a, r).join(' ')} Q${p.join(' ')} ${toward(p, b, r).join(' ')}`;
  }
  return `${d} L${points.at(-1).join(' ')}`;
}

function layout(model, { ctx, width, renderOptions, compact, embedHeading }, info = {}) {
  const { title, commits, branches, direction, config } = model, t = appearance(ctx);
  const vertical = direction !== 'LR', reverse = direction === 'BT';
  const showBranches = config.showBranches !== false, showLabels = config.showCommitLabel !== false;
  const pad = Math.max(12, Math.min(60, Number(config.diagramPadding) || 18));
  const titleInline = title && !renderOptions?.frame && !embedHeading, heading = titleInline ? Math.max(30, Math.min(100, Number(config.titleTopMargin) || 30)) : 0;
  const W = lines => Math.max(0, ...lines.map(s => ctx.measure(s, FONT.label.size)));
  const laneOf = new Map(branches.map(({ name }, i) => [name, i]));
  const branchNames = branches.map(({ label }) => ctx.wrap(label, 128, FONT.label.size));
  const branchW = showBranches ? Math.max(...branchNames.map(W)) + 20 : 0;
  const branchH = showBranches ? Math.max(...branchNames.map(lines => lines.length)) * 16 + 10 : 0;
  const wrapCommit = text => {
    const limit = 130, size = FONT.label.size;
    const fallback = () => ctx.wrap(text, limit, size);
    if (!/\p{Script=Han}/u.test(text)) return fallback();
    // Keep uninterrupted CJK runs together when the label can wrap at explicit word breaks.
    const lines = [];
    for (const paragraph of text.split('\n')) {
      let line = '';
      for (const part of paragraph.split(/(?<=[,.:;!?，。；：！？、])|(?=\s)/u)) {
        const word = part.trim();
        if (!word) continue;
        if (ctx.measure(word, size) > limit) return fallback();
        const next = line + (line && /^\s/u.test(part) ? ' ' : '') + word;
        if (ctx.measure(next, size) > limit) { lines.push(line); line = word; }
        else line = next;
      }
      lines.push(line);
    }
    return lines;
  };
  const slots = [];
  const nodes = commits.map(c => {
    const label = showLabels ? wrapCommit(c.id ? c.label : (!c.merge && c.cherryOf == null ? `${c.seq + 1}` : '')).filter(Boolean) : [];
    const msg = c.msg ? wrapCommit(c.msg) : [];
    const tags = c.tags.map(tag => ctx.wrap(tag, 130, FONT.label.size));
    const slot = config.parallelCommits ? Math.max(-1, ...c.parents.map(p => slots[p])) + 1 : c.seq;
    slots.push(slot);
    return { ...c, lane: laneOf.get(c.branch), label: [...label, ...msg], tags };
  });
  const labelH = Math.max(0, ...nodes.map(n => n.label.length * 16));
  const tagH = Math.max(0, ...nodes.map(n => n.tags.reduce((sum, lines) => sum + lines.length * 16 + 8, 0)));
  const textW = Math.max(14, ...nodes.flatMap(n => [W(n.label), ...n.tags.map(W)]));
  const beforeLane = vertical ? Math.max(branchW / 2 + 14, textW + 32) : tagH + 24;
  const afterLane = vertical ? Math.max(branchW / 2 + 14, textW + 26) : labelH + 20;
  const cross = nodes.flatMap(n => n.parents.filter(p => nodes[p].lane !== n.lane).map(p => ({ from: p, to: n.seq })));
  const crossOf = new Map(cross.map((edge, index) => [`${edge.from}:${edge.to}`, index]));
  const slotCount = Math.max(0, ...slots) + 1;
  const slotGaps = Array.from({ length: slotCount }, () => ({ incoming: [], outgoing: [] }));
  cross.forEach((edge, i) => {
    slotGaps[slots[edge.from]].outgoing.push(i);
    slotGaps[slots[edge.to]].incoming.push(i);
  });
  const slotWidth = Array(slotCount).fill(14);
  nodes.forEach((n, i) => { slotWidth[slots[i]] = Math.max(slotWidth[slots[i]], W(n.label), ...n.tags.map(lines => W(lines) + 12)); });
  const times = [], depart = new Map(), arrive = new Map();
  let pos = pad + (vertical ? branchH : branchW) + 8;
  for (const [index, gap] of slotGaps.entries()) {
    const stepHalf = vertical ? Math.max(tagH, labelH) / 2 + 20 : slotWidth[index] / 2 + 18;
    for (const id of gap.incoming) { pos += 6; arrive.set(id, pos); }
    times.push(pos += stepHalf);
    pos += stepHalf;
    for (const id of gap.outgoing) { pos += 6; depart.set(id, pos); }
  }
  const timeline = pos + pad;
  const laneCenters = [], tracks = new Map();
  pos = pad;
  for (let i = 0; i < branches.length; i++) {
    laneCenters.push(pos += beforeLane);
    pos += afterLane;
    cross.forEach((edge, j) => { if (nodes[edge.from].lane === i) { tracks.set(j, pos); pos += 6; } });
  }
  const breadth = pos + (vertical ? pad : Math.max(0, pad - 12));
  const w = Math.max(compact ? 0 : width, vertical ? breadth : timeline), height = heading + (vertical ? timeline : breadth);
  const offset = (w - (vertical ? breadth : timeline)) / 2;
  const coords = (u, v) => vertical ? [offset + v, heading + (reverse ? timeline - u : u)] : [offset + u, heading + v];
  const centered = { ...FONT.label, anchor: 'middle', 'dominant-baseline': 'central' };
  const children = [];
  const tone = lane => ctx.color(`tone${lane % 6 + 1}`);
  if (titleInline) children.push(ctx.text(w / 2, heading / 2, title, { ...centered, ...FONT.title, fill: t.fg1 }));
  if (showBranches) branches.forEach(({ name, status, link }, lane) => {
    const v = laneCenters[lane], railStart = pad + (vertical ? branchH : branchW);
    children.push(ctx.line(...coords(railStart, v), ...coords(timeline - pad, v), { stroke: t.line, meta: { kind: 'frame', id: name } }));
    const [x, y] = coords(pad + (vertical ? branchH : branchW) / 2, v);
    const pw = vertical ? W(branchNames[lane]) + 20 : branchW, ph = vertical ? branchH : branchNames[lane].length * 16 + 10;
    const plate = [ctx.rect(x - pw / 2, y - ph / 2, pw, ph, { rx: t.smallRadius,
      fill: ctx.tint(t.surface, t[status] || tone(lane), .1), stroke: ctx.frameTone(t[status] || t.line) }),
      textBlock(ctx, { x, y, lines: branchNames[lane], font: FONT.label, lineHeight: 16 })];
    children.push(...(link ? [ctx.link(link.href, plate, link)] : plate));
  });
  // Cross-lane links use their own tracks outside the glyph/label bands and cross lanes only between time slots.
  for (const to of nodes) for (const [parentIndex, parent] of to.parents.entries()) {
    const from = nodes[parent], a = times[slots[parent]], b = times[slots[to.seq]], av = laneCenters[from.lane], bv = laneCenters[to.lane];
    let route;
    if (av === bv) route = [[a + 6, av], [b - 7, bv]];
    else {
      const id = crossOf.get(`${parent}:${to.seq}`), out = depart.get(id), end = arrive.get(id), track = tracks.get(id);
      if (slots[to.seq] === slots[parent] + 1) route = [[a, av], [out, av + (bv > av ? 9 : -9)], [out, bv - (bv > av ? 9 : -9)], [b, bv]];
      else route = [[a, av], [out, av - 9], [out, track], [end, track], [end, bv - 9], [b, bv]];
    }
    const points = route.map(point => coords(...point)), last = points.at(-1), prev = points.at(-2);
    const distance = Math.hypot(last[0] - prev[0], last[1] - prev[1]);
    const [dx, dy] = last.map((v, i) => (v - prev[i]) / distance);
    if (av !== bv) points[points.length - 1] = [last[0] - dx * 7, last[1] - dy * 7];
    const [x, y] = points.at(-1), stroke = t[to.edgeStatuses[parentIndex]] || tone(from.lane);
    children.push(ctx.path(roundedRoute(points), { fill: 'none', stroke, 'stroke-width': 1.5, meta: { kind: 'edge', from: parent, to: to.seq } }));
    children.push(ctx.path(`M${x - dx * 6 - dy * 3} ${y - dy * 6 + dx * 3} L${x} ${y} L${x - dx * 6 + dy * 3} ${y - dy * 6 - dx * 3} Z`, { fill: stroke }));
  }
  for (const n of nodes) {
    const [x, y] = coords(times[slots[n.seq]], laneCenters[n.lane]);
    const first = children.length;
    const stroke = t[n.status] || tone(n.lane), meta = { kind: 'node', id: n.seq };
    const highlight = n.type === 'HIGHLIGHT';
    children.push(highlight ? ctx.rect(x - 6, y - 6, 12, 12, { rx: 2, fill: stroke, meta }) :
      ctx.circle(x, y, 6, { fill: t.surface, stroke, 'stroke-width': 2, meta }));
    if (n.merge) children.push(ctx.circle(x, y, 3, { fill: highlight ? t.surface : stroke }));
    if (n.type === 'REVERSE') children.push(ctx.path(`M${x - 3} ${y - 3} l6 6 m0 -6 l-6 6`, { fill: 'none', stroke }));
    if (n.cherryOf != null) {
      children.push(ctx.line(x - 3, y - 2, x + 3, y + 2, { stroke }));
      for (const d of [-2, 2]) children.push(ctx.circle(x + d, y + d, 1.3, { fill: stroke }));
    }
    n.label.forEach((text, i) => children.push(ctx.text(vertical ? x + 16 : x,
      vertical ? y + (i - (n.label.length - 1) / 2) * 16 : y + 19 + i * 16,
      text, { ...centered, anchor: vertical ? 'start' : 'middle', fill: t.fg1 })));
    let tagY = vertical ? y + n.tags.reduce((sum, lines) => sum + lines.length * 16 + 8, 0) / 2 : y - 14;
    if (n.tags.length) children.push(vertical ? ctx.line(x - 7, y, x - 16, y, { stroke }) : ctx.line(x, y - 7, x, tagY, { stroke }));
    for (const lines of n.tags) {
      const h = lines.length * 16 + 6, tw = W(lines) + 12;
      const tx = vertical ? x - 16 - tw / 2 : x;
      children.push(ctx.rect(tx - tw / 2, tagY - h, tw, h, { rx: t.smallRadius, fill: ctx.tint(t.surface, stroke, .12), stroke: t.line }));
      children.push(textBlock(ctx, { x: tx, y: tagY - h / 2, lines, font: FONT.label, lineHeight: 16 }));
      tagY -= h + 2;
    }
    if (n.link) children.push(ctx.link(n.link.href, children.splice(first), n.link));
  }
  const errors = w > width * 2 || commits.length + branches.length > 60 ? [warning('LARGE_DIAGRAM', ctx.lang, info.headerLine || 1,
    'Git 历史较大', 'Large Git history', '考虑拆分图表', 'Consider splitting the diagram')] : [];
  return { width: w, height, scene: { width: w, height, children, title, heading: title }, errors };
}

const implementations = { gitGraph: { parse, layout, optionMode, honoredConfig, acceptsPresentation: true } };
export { implementations };
