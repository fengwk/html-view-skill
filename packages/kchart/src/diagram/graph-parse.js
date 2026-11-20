import { DIRECTIONS, labelText, statusMarks, warning } from './support.js';
import { shapeName } from './shapes.js';

const LIMITS = { nodes: 30, edges: 50, subgraphDepth: 3, stateDepth: 2 };
const CLASSES = Object.keys(statusMarks);
const stripQuotes = (raw) => {
  let text = String(raw ?? '').trim();
  if (text.length >= 2 && ((text[0] === '"' && text.endsWith('"')) || (text[0] === "'" && text.endsWith("'")))) {
    text = text.slice(1, -1);
  }
  return text.replace(/\\"/g, '"').replace(/\\'/g, "'");
};
function normalizeLabel(raw) { return labelText(raw).trim(); }
function splitStatements(text) {
  const parts = [];
  let depth = 0;
  let quote = false;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' && text[i - 1] !== '\\') {
      quote = !quote;
      continue;
    }
    if (quote) continue;
    if ('[({'.includes(ch)) depth += 1;
    else if (']})'.includes(ch)) depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}
function parseDirection(token) {
  const upper = String(token || '').toUpperCase();
  if (upper === 'TD') return { direction: 'TB' };
  if (DIRECTIONS.includes(upper)) return { direction: upper };
  return { error: `不支持的方向：${token}` };
}
function findClose(text, start, close) {
  let quote = null;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (text.startsWith(close, i)) return i;
  }
  return -1;
}

function parseShapeAt(text, index) {
  const read = (openLen, close, shape, lean = false) => {
    const end = findClose(text, index + openLen, close);
    if (end < 0) return { error: 'unterminated', end: text.length };
    let raw = text.slice(index + openLen, end);
    if (lean) {
      const forms = { '//': 'lean-r', '\\\\': 'lean-l', '/\\': 'trap-b', '\\/': 'trap-t' };
      shape = forms[raw[0] + raw.at(-1)];
      if (!shape) return { error: 'unterminated', end: end + 1 };
      raw = raw.slice(1, -1);
    }
    return { shape, label: normalizeLabel(stripQuotes(raw)), end: end + close.length };
  };
  const ch = text[index];
  if (ch === '[') {
    if (text[index + 1] === '[') return read(2, ']]', 'subroutine');
    if (text[index + 1] === '(') return read(2, ')]', 'cylinder');
    if (text[index + 1] === '/' || text[index + 1] === '\\') return read(1, ']', 'rect', true);
    return read(1, ']', 'rect');
  }
  if (ch === '(') {
    if (text.startsWith('(((', index)) return read(3, ')))', 'dbl-circ');
    if (text.startsWith('(-', index)) return read(2, '-)', 'circle');
    if (text[index + 1] === '(') return read(2, '))', 'circle');
    if (text[index + 1] === '[') return read(2, '])', 'stadium');
    return read(1, ')', 'round');
  }
  if (ch === '{') {
    if (text[index + 1] === '{') return read(2, '}}', 'hexagon');
    return read(1, '}', 'diamond');
  }
  if (ch === '>') return read(1, ']', 'odd');
  return null;
}

function parseFlowNodeToken(text, start) {
  let i = start;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  if (i >= text.length) return null;
  if (text.startsWith('@{', i)) return { error: 'shape', end: i + 2 };
  if (text[i] === '&') return null;
  const idStart = i;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) break;
    if ('[](){}|&;:<>@'.includes(ch)) break;
    if (ch === '-' && (text[i + 1] === '-' || text[i + 1] === '.')) break;
    if (ch === '=' && text[i + 1] === '=') break;
    i += 1;
  }
  const id = text.slice(idStart, i);
  if (!id) return null;
  if (text.startsWith('@{', i)) {
    const close = findClose(text, i + 2, '}');
    if (close < 0) return { id, error: 'unterminated', end: text.length };
    const metadata = Object.create(null);
    const payload = text.slice(i + 2, close);
    const fields = /\s*([\w-]+)\s*:\s*("(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[^,]*?)\s*(?:,|$)/gy;
    while (fields.lastIndex < payload.length && payload.slice(fields.lastIndex).trim()) {
      const field = fields.exec(payload);
      if (!field) return { id, error: 'metadata', end: close + 1 };
      metadata[field[1]] = stripQuotes(field[2]);
    }
    return { id, metadata, end: close + 1 };
  }
  let shape = null;
  let label = null;
  let error = null;
  const shapePart = parseShapeAt(text, i);
  if (shapePart) {
    if (shapePart.error) error = shapePart.error;
    else {
      shape = shapePart.shape;
      label = shapePart.label;
    }
    i = shapePart.end;
  }
  let cls = null;
  if (text.startsWith(':::', i)) {
    i += 3;
    const classStart = i;
    while (i < text.length && !/[\s&;]/.test(text[i])) i += 1;
    cls = text.slice(classStart, i);
    if (!cls) error = 'class-empty';
  }
  return {
    id, shape, label, cls, error, end: i,
  };
}

function parseFlowGroup(text, start) {
  const tokens = [];
  let i = start;
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (i >= text.length) break;
    const token = parseFlowNodeToken(text, i);
    if (!token) return null;
    tokens.push(token);
    i = token.end;
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (text[i] === '&') {
      i += 1;
      continue;
    }
    break;
  }
  return tokens.length ? { tokens, end: i } : null;
}

function parseOperator(text, start) {
  const s = text.slice(start);
  let m = /^<(-{2,}|={2,}|-\.-+)>(?:\|([^|]*)\|)?/.exec(s);
  if (m) {
    const body = m[1];
    const style = body[0] === '=' ? 'bold' : body.includes('.') ? 'dashed' : 'solid';
    const extra = style === 'dashed' ? 0 : Math.max(0, body.length - 2);
    return {
      style,
      startArrow: true,
      endArrow: true,
      extra,
      label: m[2] === undefined ? null : normalizeLabel(stripQuotes(m[2])),
      end: start + m[0].length,
    };
  }
  m = /^(-{2,})\s+([\s\S]+?)\s+(-{2,}>|-{2,}[ox]?)\s*/.exec(s);
  if (m) {
    const close = m[3];
    return {
      style: 'solid',
      startArrow: false,
      endArrow: /[>ox]$/.test(close),
      extra: Math.max(0, (close.match(/-+/)?.[0].length || 2) - 2),
      label: normalizeLabel(stripQuotes(m[2])),
      end: start + m[0].length,
    };
  }
  m = /^(-\.)\s+([\s\S]+?)\s+(\.->|\.-)\s*/.exec(s);
  if (m) {
    return {
      style: 'dashed',
      startArrow: false,
      endArrow: m[3] === '.->',
      extra: 0,
      label: normalizeLabel(stripQuotes(m[2])),
      end: start + m[0].length,
    };
  }
  m = /^(==)\s+([\s\S]+?)\s+(={2,}>|={2,})\s*/.exec(s);
  if (m) {
    const close = m[3];
    return {
      style: 'bold',
      startArrow: false,
      endArrow: close.endsWith('>'),
      extra: Math.max(0, (close.match(/=+/)?.[0].length || 2) - 2),
      label: normalizeLabel(stripQuotes(m[2])),
      end: start + m[0].length,
    };
  }
  m = /^(-{2,})([>ox])?(?:\|([^|]*)\|)?/.exec(s);
  if (m) {
    return {
      style: 'solid',
      startArrow: false,
      endArrow: Boolean(m[2]),
      extra: Math.max(0, m[1].length - 2),
      label: m[3] === undefined ? null : normalizeLabel(stripQuotes(m[3])),
      end: start + m[0].length,
    };
  }
  m = /^(-\.)(->|-)(?:\|([^|]*)\|)?/.exec(s);
  if (m) {
    return {
      style: 'dashed',
      startArrow: false,
      endArrow: m[2] === '->',
      extra: 0,
      label: m[3] === undefined ? null : normalizeLabel(stripQuotes(m[3])),
      end: start + m[0].length,
    };
  }
  m = /^(={2,})(>)?(?:\|([^|]*)\|)?/.exec(s);
  if (m) {
    return {
      style: 'bold',
      startArrow: false,
      endArrow: Boolean(m[2]),
      extra: Math.max(0, m[1].length - 2),
      label: m[3] === undefined ? null : normalizeLabel(stripQuotes(m[3])),
      end: start + m[0].length,
    };
  }
  return null;
}

function parseSubgraphDecl(rest) {
  const text = rest.trim();
  let m = /^([^\s[\]]+)\s*\[([\s\S]*)\]\s*$/.exec(text);
  if (m) return { id: m[1], title: normalizeLabel(stripQuotes(m[2])) || m[1] };
  if (/^(["'])/.test(text) && /["']$/.test(text)) {
    const title = normalizeLabel(stripQuotes(text));
    return { id: title, title };
  }
  const parts = text.split(/\s+/);
  return { id: parts[0], title: normalizeLabel(text) || parts[0] };
}

function parseFlowchartBody(statements, errors, direction = 'TB', lang) {
  const model = {
    type: 'flowchart', direction: 'TB', nodes: [], edges: [], subgraphs: [],
  };
  const nodes = new Map();
  const subgraphs = new Map();
  const stack = [];
  const knownFrames = new Set();
  for (const st of statements) {
    const m = /^subgraph\s+([^\s[\]]+)/i.exec(st.text);
    if (m) knownFrames.add(m[1]);
  }
  let seq = 0;
  let edgeSeq = 0;
  let nodeLimit = false;
  let edgeLimit = false;
  const currentParent = () => (stack.length ? stack[stack.length - 1].id : null);
  const addError = (line, message, fix) => errors.push({ line, message, fix });

  const checkClass = (name, line) => {
    if (!CLASSES.includes(name)) {
      addError(line, `未知分类：${name}`, `可用分类：${CLASSES.join('、')}`);
      return null;
    }
    return name;
  };

  const warned = new Set();
  const resolveToken = (token, line) => {
    if (token.error === 'shape' || token.error === 'metadata') {
      addError(line, '无法解析形状属性', '使用 A@{ shape: rect, label: "文字" }');
      return null;
    }
    if (token.metadata) {
      const { shape, label, ...other } = token.metadata;
      if (shape !== undefined) {
        token.shape = shapeName(shape);
        if (!token.shape) {
          addError(line, `No such shape: ${shape}`, '使用 Mermaid 的小写形状名称');
          return null;
        }
      }
      if (label !== undefined) token.label = normalizeLabel(label);
      const asset = 'img' in other || 'icon' in other;
      if (asset && !warned.has('asset')) {
        warned.add('asset');
        errors.push(warning('IGNORED_ASSET', lang, line, '忽略图标或远程图片', 'Ignored icon or remote image'));
      }
      const keys = Object.keys(other).filter(key => !['img', 'icon', 'form', 'pos', 'w', 'h', 'constraint'].includes(key));
      for (const key of keys) if (!warned.has(key)) {
        warned.add(key);
        errors.push(warning('IGNORED_CONFIG', lang, line, `忽略属性 ${key}`, `Ignored property ${key}`));
      }
    }
    if (token.error === 'unterminated') {
      addError(line, `节点 ${token.id} 的形状没有结束的括号`, '补上缺少的 ]、) 或 }');
      return null;
    }
    if (token.error === 'class-empty') {
      addError(line, `节点 ${token.id} 的 ::: 后面缺少分类名`, `可用分类：${CLASSES.join('、')}`);
    }
    if (knownFrames.has(token.id) && !token.shape) return { id: token.id, frame: true };
    let node = nodes.get(token.id);
    if (!node) {
      node = {
        id: token.id,
        label: token.id,
        shape: 'rect',
        class: null,
        parent: currentParent(),
        seq: seq++,
        line,
      };
      nodes.set(token.id, node);
      model.nodes.push(node);
      if (model.nodes.length === LIMITS.nodes + 1 && !nodeLimit) {
        nodeLimit = true;
        addError(line, `节点 ${model.nodes.length} 个，超过上限 ${LIMITS.nodes}`, '拆成总图和局部图');
      }
    } else if (node.parent == null && currentParent() != null) {
      node.parent = currentParent();
    }
    if (token.shape) node.shape = token.shape;
    if (token.label != null) node.label = token.label;
    if (token.cls) {
      const cls = checkClass(token.cls, line);
      if (cls) node.class = cls;
    }
    return { id: node.id, node };
  };

  const addEdge = (from, to, op, line) => {
    if (from.id === to.id && !from.frame && !to.frame && !op.selfAllowed) {
      // 自环合法，保留
    }
    const edge = {
      seq: edgeSeq++,
      from: from.id,
      to: to.id,
      fromFrame: Boolean(from.frame),
      toFrame: Boolean(to.frame),
      label: op.label,
      style: op.style,
      startArrow: op.startArrow,
      endArrow: op.endArrow,
      extra: op.extra,
      line,
    };
    model.edges.push(edge);
    if (model.edges.length === LIMITS.edges + 1 && !edgeLimit) {
      edgeLimit = true;
      addError(line, `连线 ${model.edges.length} 条，超过上限 ${LIMITS.edges}`, '拆成总图和局部图');
    }
  };

  for (const st of statements.slice(1)) {
    const text = st.text;
    const line = st.line;
    if (/^subgraph\b/i.test(text)) {
      const decl = parseSubgraphDecl(text.replace(/^subgraph\b/i, ''));
      if (subgraphs.has(decl.id) || knownFrames.has(decl.id) && subgraphs.has(decl.id)) {
        addError(line, `子图 id 重复：${decl.id}`, '换一个 id');
        continue;
      }
      if (stack.length + 1 > LIMITS.subgraphDepth) {
        addError(line, `子图嵌套 ${stack.length + 1} 层，超过上限 ${LIMITS.subgraphDepth} 层`, '拆成总图和局部图');
        continue;
      }
      const sg = {
        id: decl.id,
        title: decl.title,
        parent: currentParent(),
        depth: stack.length + 1,
        seq: seq++,
        line,
      };
      subgraphs.set(sg.id, sg);
      model.subgraphs.push(sg);
      stack.push(sg);
      continue;
    }
    if (/^end\s*$/i.test(text)) {
      if (!stack.length) {
        addError(line, 'end 没有对应的 subgraph', '删除多余的 end');
        continue;
      }
      stack.pop();
      continue;
    }
    if (/^direction\b/i.test(text)) {
      if (!stack.length) {
        const token = text.replace(/^direction\b/i, '').trim();
        const d = parseDirection(token);
        if (d.error) addError(line, d.error, '方向用 TB、TD、BT、LR、RL');
        else direction = d.direction;
      }
      continue;
    }
    if (/^(classDef|style|linkStyle)\b/i.test(text)) {
      addError(line, `不支持 ${text.split(/\s+/)[0]}`, '颜色由主题决定，删掉这一行；节点分类用 :::new 等');
      continue;
    }
    if (/^(click|call)\b/i.test(text)) {
      addError(line, `不支持 ${text.split(/\s+/)[0]}`, '删掉交互语句');
      continue;
    }
    if (/^class\s+/i.test(text)) {
      const m = /^class\s+([^\s]+)\s+([A-Za-z_]\w*)\s*$/i.exec(text);
      if (!m) {
        addError(line, 'class 写法不对', '写成 class A,B ok');
        continue;
      }
      const cls = checkClass(m[2], line);
      for (const id of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
        const node = nodes.get(id);
        if (node) {
          if (cls) node.class = cls;
        } else if (subgraphs.has(id)) {
          if (cls) subgraphs.get(id).class = cls;
        } else {
          const created = resolveToken({ id }, line);
          if (created?.node && cls) created.node.class = cls;
        }
      }
      continue;
    }
    if (/^(note|classDiagram|stateDiagram|erDiagram|flowchart|graph)\b/i.test(text)) {
      addError(line, `无法解析的语句：${text}`, '检查 Mermaid 语法；图类型只能声明一次');
      continue;
    }

    let group = parseFlowGroup(text, 0);
    if (!group) {
      addError(line, `无法解析的语句：${text}`, '检查节点 id、形状括号与连线写法');
      continue;
    }
    let cursor = group.end;
    let left = group.tokens.map((t) => resolveToken(t, line)).filter(Boolean);
    let hasEdge = false;
    while (cursor < text.length) {
      while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
      if (cursor >= text.length) break;
      const op = parseOperator(text, cursor);
      if (!op) {
        addError(line, `无法解析的连线：${text.slice(cursor)}`, '连线写成 -->、-.->、==>、--- 等；标签用 |文字| 或 -- 文字 -->');
        break;
      }
      cursor = op.end;
      const next = parseFlowGroup(text, cursor);
      if (!next) {
        addError(line, '连线后面缺少节点', '在连线运算符后写节点 id');
        break;
      }
      cursor = next.end;
      const right = next.tokens.map((t) => resolveToken(t, line)).filter(Boolean);
      for (const a of left) for (const b of right) addEdge(a, b, op, line);
      left = right;
      hasEdge = true;
    }
    if (!hasEdge) left.forEach(() => {});
  }

  if (stack.length) {
    addError(statements[statements.length - 1].line, 'subgraph 没有结束的 end', '补上 end');
  }
  for (const node of model.nodes) {
    if (subgraphs.has(node.id)) {
      node.conflict = true;
    }
  }
  model.direction = direction;
  model.nodes.sort((a, b) => a.seq - b.seq);
  model.subgraphs.sort((a, b) => a.seq - b.seq);
  return model;
}

function parseFlowchart(statements, errors, lang) {
  const head = statements[0].text;
  let direction = 'TB';
  const header = /^(?:flowchart|graph)\b\s*([A-Za-z]*)/i.exec(head);
  if (header && header[1]) {
    const d = parseDirection(header[1]);
    if (d.error) errors.push({ line: statements[0].line, message: d.error, fix: '方向用 TB、TD、BT、LR、RL（TD 等同 TB）' });
    else direction = d.direction;
  }
  return parseFlowchartBody(statements, errors, direction, lang);
}

/* ───────────────────────── stateDiagram 解析 ───────────────────────── */

function parseStateDecl(rest) {
  let text = rest.trim();
  let kind = 'state';
  let m = /<<(choice|fork|join)>>\s*$/i.exec(text);
  if (m) {
    kind = m[1].toLowerCase();
    text = text.slice(0, m.index).trim();
  }
  m = /^"([\s\S]*)"\s+as\s+([^\s]+)$/.exec(text);
  if (m) return { id: m[2], label: normalizeLabel(m[1]), kind };
  return { id: text, label: null, kind };
}

function parseState(statements, errors) {
  const head = statements[0].text;
  const model = {
    type: 'state', direction: 'TB', nodes: [], edges: [], subgraphs: [],
  };
  let direction = 'TB';
  const header = /^stateDiagram(?:-v2)?\b\s*([A-Za-z]*)/i.exec(head);
  if (header && header[1]) {
    const d = parseDirection(header[1]);
    if (d.error) errors.push({ line: statements[0].line, message: d.error, fix: '方向用 TB、TD、BT、LR、RL' });
    else direction = d.direction;
  }
  const nodes = new Map();
  const subgraphs = new Map();
  const stack = [];
  const knownComposite = new Set();
  const compositeMeta = new Map();
  const metaFor = (id) => {
    if (!compositeMeta.has(id)) compositeMeta.set(id, { label: null, desc: [], class: null });
    return compositeMeta.get(id);
  };
  for (const st of statements) {
    const m = /^state\s+(.+?)\s*\{\s*$/i.exec(st.text);
    if (!m) continue;
    const decl = parseStateDecl(m[1]);
    if (decl.id) knownComposite.add(decl.id);
  }
  let seq = 0;
  let edgeSeq = 0;
  let nodeLimit = false;
  let edgeLimit = false;
  const currentParent = () => (stack.length ? stack[stack.length - 1].id : null);
  const addError = (line, message, fix) => errors.push({ line, message, fix });
  const checkClass = (name, line) => {
    if (!CLASSES.includes(name)) {
      addError(line, `未知分类：${name}`, `可用分类：${CLASSES.join('、')}`);
      return null;
    }
    return name;
  };
  const countStates = () => model.nodes.filter((n) => !n.pseudo).length;

  const ensureState = (id, line, { label = null, kind = 'state' } = {}) => {
    if (knownComposite.has(id) || subgraphs.has(id)) return null;
    let node = nodes.get(id);
    if (!node) {
      node = {
        id,
        label: label ?? id,
        kind: kind === 'state' ? 'state' : kind,
        desc: [],
        class: null,
        parent: currentParent(),
        seq: seq++,
        line,
      };
      nodes.set(id, node);
      model.nodes.push(node);
      if (countStates() === LIMITS.nodes + 1 && !nodeLimit) {
        nodeLimit = true;
        addError(line, `状态 ${countStates()} 个，超过上限 ${LIMITS.nodes}`, '拆成总图和局部图');
      }
    } else {
      if (label != null) node.label = label;
      if (kind !== 'state') node.kind = kind;
      if (node.parent == null && currentParent() != null) node.parent = currentParent();
    }
    return node;
  };

  const ensurePseudo = (kind, line) => {
    const scope = currentParent();
    const id = `@@${kind}:${scope ?? '@root'}`;
    let node = nodes.get(id);
    if (!node) {
      node = {
        id,
        label: '',
        kind,
        desc: [],
        class: null,
        parent: scope,
        seq: seq++,
        line,
        pseudo: true,
      };
      nodes.set(id, node);
      model.nodes.push(node);
    }
    return node;
  };

  const addEdge = (from, to, label, line) => {
    model.edges.push({
      seq: edgeSeq++,
      from,
      to,
      fromFrame: false,
      toFrame: false,
      label: label == null ? null : normalizeLabel(stripQuotes(label)),
      style: 'solid',
      startArrow: false,
      endArrow: true,
      extra: 0,
      line,
    });
    if (model.edges.length === LIMITS.edges + 1 && !edgeLimit) {
      edgeLimit = true;
      addError(line, `连线 ${model.edges.length} 条，超过上限 ${LIMITS.edges}`, '拆成总图和局部图');
    }
  };

  for (const st of statements.slice(1)) {
    const text = st.text;
    const line = st.line;
    if (/^direction\b/i.test(text)) {
      if (!stack.length) {
        const token = text.replace(/^direction\b/i, '').trim();
        const d = parseDirection(token);
        if (d.error) addError(line, d.error, '方向用 TB、TD、BT、LR、RL');
        else direction = d.direction;
      }
      continue;
    }
    if (/^\}\s*$/.test(text)) {
      if (!stack.length) {
        addError(line, '} 没有对应的 state {', '删除多余的 }');
        continue;
      }
      stack.pop();
      continue;
    }
    if (text === '--') {
      addError(line, '不支持 -- 并发分区', '拆成两张图，或用 fork/join');
      continue;
    }
    if (/^note\b/i.test(text)) {
      addError(line, '状态图不支持 note', '说明写进 fig-note 或正文');
      continue;
    }
    if (/^(classDef|style|linkStyle)\b/i.test(text)) {
      addError(line, `不支持 ${text.split(/\s+/)[0]}`, '颜色由主题决定，删掉这一行；节点分类用 :::warn 等');
      continue;
    }
    if (/^(click|call)\b/i.test(text)) {
      addError(line, `不支持 ${text.split(/\s+/)[0]}`, '删掉交互语句');
      continue;
    }
    if (/^class\s+/i.test(text)) {
      const m = /^class\s+([^\s]+)\s+([A-Za-z_]\w*)\s*$/i.exec(text);
      if (!m) {
        addError(line, 'class 写法不对', '写成 class A danger');
        continue;
      }
      const cls = checkClass(m[2], line);
      for (const id of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
        if (subgraphs.has(id)) {
          if (cls) subgraphs.get(id).class = cls;
          continue;
        }
        if (knownComposite.has(id)) {
          if (cls) metaFor(id).class = cls;
          continue;
        }
        const node = nodes.get(id) || ensureState(id, line);
        if (node && cls) node.class = cls;
      }
      continue;
    }
    if (/^state\b/i.test(text)) {
      const block = /^state\s+(.+?)\s*\{\s*$/i.exec(text);
      if (block) {
        const decl = parseStateDecl(block[1]);
        if (!decl.id) {
          addError(line, 'state { 缺少 id', '写成 state A {');
          continue;
        }
        if (subgraphs.has(decl.id)) {
          addError(line, `复合状态 id 重复：${decl.id}`, '换一个 id');
          continue;
        }
        if (stack.length + 1 > LIMITS.stateDepth) {
          addError(line, `复合状态嵌套 ${stack.length + 1} 层，超过上限 ${LIMITS.stateDepth} 层`, '拆成平级状态或拆成两张图');
          continue;
        }
        const placeholder = nodes.get(decl.id);
        const meta = metaFor(decl.id);
        let title = decl.label || meta.label;
        if (!title && placeholder && placeholder.label !== placeholder.id) title = placeholder.label;
        if (placeholder) {
          nodes.delete(decl.id);
          const at = model.nodes.indexOf(placeholder);
          if (at >= 0) model.nodes.splice(at, 1);
        }
        const sg = {
          id: decl.id,
          title: title || decl.id,
          parent: currentParent(),
          depth: stack.length + 1,
          seq: seq++,
          line,
          kind: 'composite',
          desc: [...meta.desc],
          class: meta.class,
        };
        subgraphs.set(sg.id, sg);
        model.subgraphs.push(sg);
        stack.push(sg);
        continue;
      }
      const decl = parseStateDecl(text.replace(/^state\b/i, ''));
      if (!decl.id) {
        addError(line, 'state 缺少 id', '写成 state A 或 state "名称" as A');
        continue;
      }
      if (knownComposite.has(decl.id)) {
        if (decl.label) metaFor(decl.id).label = decl.label;
        continue;
      }
      ensureState(decl.id, line, { label: decl.label, kind: decl.kind });
      continue;
    }

    const arrow = /^(.+?)\s*-->\s*(.+)$/.exec(text);
    if (arrow) {
      const parseEnd = (raw) => {
        let value = raw.trim();
        let cls = null;
        const at = value.indexOf(':::');
        if (at >= 0) {
          cls = value.slice(at + 3).trim();
          value = value.slice(0, at).trim();
        }
        return { id: value, cls };
      };
      let leftTok = parseEnd(arrow[1]);
      let rightTok = parseEnd(arrow[2]);
      let label = null;
      const colon = rightTok.id.indexOf(':');
      if (colon >= 0) {
        label = rightTok.id.slice(colon + 1).trim();
        rightTok.id = rightTok.id.slice(0, colon).trim();
      }
      if (!leftTok.id || !rightTok.id) {
        addError(line, '状态转移缺少起点或终点', '写成 A --> B : 说明');
        continue;
      }
      const leftClass = leftTok.cls ? checkClass(leftTok.cls, line) : null;
      const rightClass = rightTok.cls ? checkClass(rightTok.cls, line) : null;
      let from;
      let to;
      if (leftTok.id === '[*]') from = ensurePseudo('start', line).id;
      else {
        const node = ensureState(leftTok.id, line);
        if (node && leftClass) node.class = leftClass;
        from = leftTok.id;
      }
      if (rightTok.id === '[*]') to = ensurePseudo('end', line).id;
      else {
        const node = ensureState(rightTok.id, line);
        if (node && rightClass) node.class = rightClass;
        to = rightTok.id;
      }
      addEdge(from, to, label, line);
      continue;
    }

    const desc = /^([^\s:]+)\s*:\s*(.+)$/.exec(text);
    if (desc) {
      const id = desc[1];
      const value = normalizeLabel(desc[2]);
      if (subgraphs.has(id)) subgraphs.get(id).desc.push(value);
      else if (knownComposite.has(id)) metaFor(id).desc.push(value);
      else {
        const node = nodes.get(id) || ensureState(id, line);
        if (node) node.desc.push(value);
      }
      continue;
    }
    if (/^(stateDiagram|flowchart|graph|erDiagram)\b/i.test(text)) {
      addError(line, '图类型只能声明一次', '删掉重复的声明');
      continue;
    }
    addError(line, `无法解析的语句：${text}`, '检查状态名、转移箭头与 : 说明的写法');
  }

  if (stack.length) {
    addError(statements[statements.length - 1].line, '复合状态没有结束的 }', '补上 }');
  }
  for (const edge of model.edges) {
    edge.fromFrame = subgraphs.has(edge.from) && !nodes.has(edge.from);
    edge.toFrame = subgraphs.has(edge.to) && !nodes.has(edge.to);
  }
  model.direction = direction;
  model.nodes.sort((a, b) => a.seq - b.seq);
  model.subgraphs.sort((a, b) => a.seq - b.seq);
  return model;
}

/* ───────────────────────── erDiagram 解析 ───────────────────────── */

function parseEr(statements, errors) {
  const head = statements[0].text;
  const model = {
    type: 'er', direction: 'TB', nodes: [], edges: [], subgraphs: [],
  };
  let direction = 'TB';
  const header = /^erDiagram\b\s*([A-Za-z]*)/i.exec(head);
  if (header && header[1]) {
    const d = parseDirection(header[1]);
    if (d.error) errors.push({ line: statements[0].line, message: d.error, fix: '方向用 TB、TD、BT、LR、RL' });
    else direction = d.direction;
  }
  const entities = new Map();
  let seq = 0;
  let edgeSeq = 0;
  let nodeLimit = false;
  let edgeLimit = false;
  const addError = (line, message, fix) => errors.push({ line, message, fix });

  const ensureEntity = (id, line, alias = null) => {
    let entity = entities.get(id);
    if (!entity) {
      entity = {
        id,
        label: alias || id,
        kind: 'er',
        shape: 'er',
        fields: [],
        class: null,
        parent: null,
        seq: seq++,
        line,
      };
      entities.set(id, entity);
      model.nodes.push(entity);
      if (model.nodes.length === LIMITS.nodes + 1 && !nodeLimit) {
        nodeLimit = true;
        addError(line, `实体 ${model.nodes.length} 个，超过上限 ${LIMITS.nodes}`, '拆成总图和局部图');
      }
    } else if (alias) entity.label = alias;
    return entity;
  };

  const addField = (entity, text, line) => {
    let rest = text.trim();
    if (!rest) return;
    let comment = null;
    const cm = /"([^"]*)"\s*$/.exec(rest);
    if (cm) {
      comment = cm[1];
      rest = rest.slice(0, cm.index).trim();
    }
    const parts = rest.split(/\s+/);
    if (parts.length < 2) {
      addError(line, `实体 ${entity.id} 的属性写法不对：${text}`, '写成 type name PK|FK|UK "注释"');
      return;
    }
    const keys = parts.slice(2).join(' ').split(',').map((x) => x.trim()).filter(Boolean);
    for (const key of keys) {
      if (!['PK', 'FK', 'UK'].includes(key)) {
        addError(line, `属性键只能是 PK、FK、UK，收到：${key}`, '删掉未知的键标记，或改成 PK/FK/UK');
      }
    }
    entity.fields.push({
      type: parts[0],
      name: parts[1],
      keys: keys.filter((key) => ['PK', 'FK', 'UK'].includes(key)),
      comment,
    });
  };

  const addRelation = (from, to, startCard, endCard, style, label, line) => {
    ensureEntity(from, line);
    ensureEntity(to, line);
    model.edges.push({
      seq: edgeSeq++,
      from,
      to,
      fromFrame: false,
      toFrame: false,
      label: label == null ? null : normalizeLabel(stripQuotes(label)),
      startCard,
      endCard,
      style: style === '..' ? 'dashed' : 'solid',
      startArrow: false,
      endArrow: false,
      extra: 0,
      line,
    });
    if (model.edges.length === LIMITS.edges + 1 && !edgeLimit) {
      edgeLimit = true;
      addError(line, `关系 ${model.edges.length} 条，超过上限 ${LIMITS.edges}`, '拆成总图和局部图');
    }
  };

  for (let i = 1; i < statements.length; i += 1) {
    const st = statements[i];
    const text = st.text;
    const line = st.line;
    if (/^direction\b/i.test(text)) {
      const token = text.replace(/^direction\b/i, '').trim();
      const d = parseDirection(token);
      if (d.error) addError(line, d.error, '方向用 TB、TD、BT、LR、RL');
      else direction = d.direction;
      continue;
    }
    if (/^(classDef|style|linkStyle)\b/i.test(text)) {
      addError(line, `ER 图不支持 ${text.split(/\s+/)[0]}`, '颜色由主题决定，删掉这一行');
      continue;
    }
    const block = /^([^\s{}[\]]+)\s*(?:\["([^"]*)"\])?\s*\{\s*$/.exec(text);
    if (block) {
      const entity = ensureEntity(block[1], line, block[2] || null);
      let closed = false;
      i += 1;
      for (; i < statements.length; i += 1) {
        const row = statements[i];
        if (/^\}\s*$/.test(row.text)) {
          closed = true;
          break;
        }
        addField(entity, row.text, row.line);
      }
      if (!closed) addError(line, `实体 ${entity.id} 的属性块没有结束的 }`, '补一个 }');
      continue;
    }
    const aliasOnly = /^([^\s{}[\]]+)\s*\["([^"]*)"\]\s*$/.exec(text);
    if (aliasOnly) {
      ensureEntity(aliasOnly[1], line, aliasOnly[2]);
      continue;
    }
    const rel = /^(\S+)\s+(\|\||\|o|\}o|\}\|)\s*(--|\.\.)\s*(\|\||o\||o\{|\|\{)\s+(\S+)\s*(?::\s*(.*))?$/.exec(text);
    if (rel) {
      addRelation(rel[1], rel[5], rel[2], rel[4], rel[3], rel[6], line);
      continue;
    }
    if (/^\}\s*$/.test(text)) {
      addError(line, '没有对应的实体 {', '删除多余的 }');
      continue;
    }
    if (/^(erDiagram|flowchart|graph|stateDiagram)\b/i.test(text)) {
      addError(line, '图类型只能声明一次', '删掉重复的声明');
      continue;
    }
    addError(line, `无法解析的语句：${text}`, '实体写成 ENTITY { … }；关系写成 A ||--o{ B : 标签');
  }
  model.direction = direction;
  model.nodes.sort((a, b) => a.seq - b.seq);
  return model;
}
/**
 * 供泳道图复用的流程语法解析。调用方传入已剔除泳道壳层的流程语句，
 * 每条 { text, line }；line 必须是原源码行号，这样报错仍指向用户看到的那一行。
 * direction 只记录在模型上，不参与此处的解析。
 */
function parseFlow(statements, { direction = 'TB' } = {}) {
  const errors = [];
  const safeDirection = DIRECTIONS.includes(direction) ? direction : 'TB';
  const model = parseFlowchartBody([{ text: 'flowchart', line: 0 }, ...statements], errors, safeDirection);
  return { ok: errors.length === 0, errors, model };
}
function statementsOf(body, firstLine) {
  const rows = String(body ?? '').replace(/\r\n?/g, '\n').split('\n');
  const statements = [];
  rows.forEach((row, index) => {
    for (const piece of splitStatements(row)) {
      const text = piece.trim();
      if (text && !/^\s*%%/.test(text) && !/^acc(Title|Descr)\s*:/i.test(text)) statements.push({ text, line: firstLine + index });
    }
  });
  return statements;
}
function parseGraph(body, info = {}) {
  const kind = String(info.kind || '').toLowerCase();
  const header = String(info.header || '');
  const headerLine = Number.isFinite(info.headerLine) ? info.headerLine : Math.max(1, (info.firstLine || 2) - 1);
  const firstLine = Number.isFinite(info.firstLine) ? info.firstLine : headerLine + 1;
  const statements = [...statementsOf(header, headerLine), ...statementsOf(body, firstLine)];
  const errors = [];
  if (info.syntax === 'mermaid') {
    // 与逐行源码检查一致；分号连接的语句也不能绕过样式类约束。
    for (const item of statements.slice(1)) if (/^class\s+\S+\s+\S+/i.test(item.text)) {
      errors.push({ line: item.line, column: 1, message: '不支持 Mermaid 样式类声明', fix: '改用 ::: 状态分类' });
    }
    if (errors.length) return { model: null, errors };
  }
  if (!statements.length) return { model: null, errors: [{ line: headerLine, column: 1, message: '图源码为空', fix: '写 flowchart、stateDiagram-v2 或 erDiagram 开头的图' }] };
  const first = statements[0].text;
  let model;
  if (kind === 'flowchart') model = parseFlowchart(statements, errors, info.lang);
  else if (kind === 'statediagram-v2' || kind === 'statediagram') model = parseState(statements, errors);
  else if (kind === 'erdiagram') model = parseEr(statements, errors);
  else errors.push({ line: statements[0].line, column: 1, message: '不支持的图类型：' + first.split(/\s+/)[0], fix: '使用 flowchart、stateDiagram-v2 或 erDiagram 图型' });
  return { model: model || null, errors: errors.map(item => ({ column: 1, ...item })) };
}

export { parseGraph, parseFlow };
