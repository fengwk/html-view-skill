/* Mermaid classDiagram: four-compartment cards, namespaces, notes and the complete relation marker table. */

import { appearance, error, FONT, warning } from './support.js';
import { presentation } from './presentation.js';
import { normalizeLabel } from './label.js';
import { resolveIconRef } from '../core/icons.js';
import { layoutGraph } from './graph-layout.js';
import { cubicPath } from '../core/geometry.js';

// Mermaid registers both header spellings for the same diagram (classDiagram.jison:41-42). The family is
// registered in src/families.json; these descriptors carry the same shape so a caller can register them itself.
const kind = Object.freeze({ kind: 'classDiagram', syntax: 'mermaid', topic: 'data-model', aliases: Object.freeze(['classDiagram-v2']) });
const kinds = Object.freeze([kind]);
// Work caps bound runtime only (§9 of the shared contract); a large diagram warns long before it fails.
const limits = Object.freeze({ cards: 2000, edges: 5000, large: 60 });
const directions = Object.freeze(['TB', 'BT', 'RL', 'LR']);
// Closed marker vocabulary of the layout. A marker on `start` is drawn at the `from` end pointing into `from`,
// one on `end` at the `to` end pointing into `to`. Class syntax never yields `cross`: Mermaid has no cross
// arrow here, the shared vocabulary keeps it for other relation families.
const markers = Object.freeze(['triangle', 'filledDiamond', 'hollowDiamond', 'arrow', 'circle', 'cross']);
// Arrow token → marker (classDiagram.jison:371-389; classDb.ts:505-511,704-726).
const arrowMarkers = Object.freeze({
  '<|': 'triangle', '|>': 'triangle',
  '*': 'filledDiamond',
  o: 'hollowDiamond',
  '>': 'arrow', '<': 'arrow',
  '()': 'circle',
});
const VISIBILITY = '#+~-';

const issue = (lang, line, zh, en, fixZh, fixEn, column = 1) => error(lang, line, zh, en, fixZh, fixEn, column);
const unknownStatement = (lang, line, text) => issue(lang, line,
  `不支持或无效的类图语句：「${text}」`,
  `Unsupported or invalid class-diagram statement: "${text}"`,
  '使用 class、namespace、note、direction 或「A <|-- B : 标签」',
  'Use class, namespace, note, direction, or "A <|-- B : label"');
// Quotes and backticks are the only escaping this family owns; entities, inline HTML and Markdown belong to
// the shared label module.
const unquote = (value) => {
  const text = String(value ?? '').trim();
  const quoted = /^"([^"]*)"$/u.exec(text);
  if (quoted) return quoted[1];
  return /^`[^`]*`$/u.test(text) ? text.slice(1, -1) : text;
};

// ---------------------------------------------------------------------------------------------------------
// Lexer fragments, transcribed from classDiagram.jison so every accepted line can be classified in one pass.
// A name is Mermaid's `className`: `alphaNumToken`, dots, single minuses, `` `literal` `` and `~generic~`
// groups (classDiagram.jison:251-258,434-436). `--` and `..` end a name, so `<--` never reads as `<|--`.
// ---------------------------------------------------------------------------------------------------------
const ATOM = String.raw`(?:\u0060[^\u0060]*\u0060|~[^~\s]*~|[\p{L}\p{N}\p{M}_$]|[-.](?![-.]))`;
const NAME = `${ATOM}+`;
// relationType tokens: EXTENSION, COMPOSITION, AGGREGATION, DEPENDENCY, LOLLIPOP.
const END = String.raw`(?:<\|?|\|>|\(\s*\)|o|\*|>|<)`;
const NAME_HEAD = new RegExp(`^(?:${ATOM})+`, 'u');
const RELATION = new RegExp(`^(${NAME})\\s*(?:"([^"]*)")?\\s*((?:${END})?(?:--|\\.\\.)(?:${END})?)\\s*(?:"([^"]*)")?\\s*(${NAME})(?:\\s*:\\s*(.+))?$`, 'u');
const ARROW = new RegExp(`^(?:(${END}))?(--|\\.\\.)(?:(${END}))?$`, 'u');
const NOTE_FOR = new RegExp(`^note\\s+for\\s+(${NAME})\\s+"([^"]*)"$`, 'iu');
const NOTE = /^note\s+"([^"]*)"$/iu;
const CLASS_DECL = /^class\s+(.+)$/iu;
const NAMESPACE_DECL = /^namespace\s+(.+)$/iu;
const ANNOTATION_LINE = new RegExp(`^<<\\s*([^<>]+?)\\s*>>\\s+(${NAME})$`, 'u');
const ANNOTATION_HEAD = /^<<\s*([^<>]+?)\s*>>/u;
const COLON_MEMBER = new RegExp(`^(${NAME})\\s*:\\s*([\\s\\S]+)$`, 'u');
const CLASS_ONLY = new RegExp(`^(${NAME})\\s*:::\\s*([\\w-]+(?:\\s*,\\s*[\\w-]+)*)$`, 'u');
const BARE_NAME = new RegExp(`^(${NAME})$`, 'u');
const LABEL_SUFFIX = /^\[\s*"([^"]*)"\s*\]/u;
const STYLE_SUFFIX = /^:::\s*([\w-]+(?:\s*,\s*[\w-]+)*)/u;
// Mermaid matches `direction …` anywhere on the line and consumes the whole line (classDiagram.jison:24-27).
const DIRECTION = new RegExp(`\\bdirection\\s+(${directions.join('|')})\\b`, 'iu');
const ICON_SUFFIX = /^::icon\s*\(\s*([^()]+?)\s*\)/u;
const ACCESSIBILITY = /^acc(?:Title|Descr)\b/iu;
// Mermaid's member classifier: `*` prints italic (abstract), `$` underlined (static) (classTypes.ts:136-145).
const METHOD = /^([#+~-])?(.+)\((.*)\)([\s$*])?(.*)([$*])?$/u;

// Mermaid skips `%%…` to end of line outside a quoted string (classDiagram.jison:28-29). Entity codes stay
// text: they are the shared label module's to decode.
function stripComment(raw) {
  let quote = '', backtick = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (backtick) { if (ch === '`') backtick = false; continue; }
    if (ch === '`') { backtick = true; continue; }
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '%' && raw[i + 1] === '%') return raw.slice(0, i);
  }
  return raw;
}

// First index of `--`/`..`/`:` outside quotes and backticks, or -1. Mermaid's lexer prefers `LABEL` for the
// rest of a line after `className :`, so a colon that comes before the arrow makes the line a member.
function indexOutside(raw, wanted) {
  let quote = '', backtick = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (backtick) { if (ch === '`') backtick = false; continue; }
    if (ch === '`') { backtick = true; continue; }
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (wanted === 'arrow' ? ((ch === '-' || ch === '.') && raw[i + 1] === ch) : ch === wanted) return i;
  }
  return -1;
}

// Callers hand over `{ text, line }` statements (the shape the shared presentation loop consumes); a raw
// body string is accepted too, so the registry can pass `prepared.body` unchanged.
function statementsOf(input, firstLine) {
  if (Array.isArray(input)) {
    return input
      .filter((item) => item && typeof item.text === 'string')
      .map((item) => ({ text: item.text, line: Number.isFinite(item.line) ? item.line : firstLine }));
  }
  return String(input ?? '').replace(/\r\n?/gu, '\n').split('\n')
    .map((text, index) => ({ text, line: firstLine + index }));
}

function takeName(text, start = 0) {
  const match = NAME_HEAD.exec(text.slice(start));
  return match ? { raw: match[0], next: start + match[0].length } : null;
}

// `Square~Shape~` is class `Square` with generic `Shape`; the generic never joins the id (classDb.ts:80-92).
function nameParts(raw) {
  const text = String(raw).startsWith('`') ? String(raw).slice(1, -1) : String(raw);
  const parts = text.split('~');
  return { id: parts[0], generic: parts.length > 1 ? parts[1] : '' };
}

// Mermaid's parseGenericTypes (common.ts:215-268): `~T~` prints as `<T>`, nested `List~List~int~~` as
// `List<List<int>>`, and a comma set such as `Map~K, V~` is rejoined before conversion.
const tildeCount = (text) => Math.max(0, String(text).split('~').length - 1);
function processSet(input) {
  const count = tildeCount(input);
  if (count <= 1) return input;
  let text = input, prefixed = false;
  if (count % 2 !== 0 && text.startsWith('~')) { text = text.slice(1); prefixed = true; }
  const chars = [...text];
  let first = chars.indexOf('~'), last = chars.lastIndexOf('~');
  while (first !== -1 && last !== -1 && first !== last) {
    // Escape generated delimiters until normalizeLabel has handled authored HTML tags.
    chars[first] = '&lt;';
    chars[last] = '&gt;';
    first = chars.indexOf('~');
    last = chars.lastIndexOf('~');
  }
  if (prefixed) chars.unshift('~');
  return chars.join('');
}
function parseGenericTypes(input) {
  const sets = String(input ?? '').split(/(,)/u), output = [];
  for (let i = 0; i < sets.length; i += 1) {
    let set = sets[i];
    if (set === ',' && i > 0 && i + 1 < sets.length && tildeCount(sets[i - 1]) === 1 && tildeCount(sets[i + 1]) === 1) {
      set = `${sets[i - 1]},${sets[i + 1]}`;
      i += 1;
      output.pop();
    }
    output.push(processSet(set));
  }
  return output.join('');
}

function decorate(row, classifier) {
  if (classifier === '*') row.fontStyle = 'italic';
  else if (classifier === '$') row.decoration = 'underline';
  return row;
}
// One member row: `visibility + name` + `(parameters)` + ` : returnType`, with the classifier carried as
// typography instead of text (classTypes.ts:62-78,80-134). Greedy matching keeps `a(b)(c)` identical to Mermaid.
function parseMember(input) {
  const text = String(input).trim();
  const method = text.indexOf(')') > 0 ? METHOD.exec(text) : null;
  if (method) {
    const visibility = method[1] || '';
    const id = String(method[2]).trim();
    const parameters = String(method[3] || '').trim();
    let classifier = String(method[4] || '').trim();
    let returnType = String(method[5] || '').trim();
    if (!classifier && /[$*]$/u.test(returnType)) {
      classifier = returnType.slice(-1);
      returnType = returnType.slice(0, -1);
    }
    const head = `${visibility}${parseGenericTypes(id)}(${parseGenericTypes(parameters)})`;
    const row = { text: (returnType ? `${head} : ${parseGenericTypes(returnType)}` : head).trim() };
    return { method: true, item: decorate(row, classifier) };
  }
  const length = text.length;
  const visibility = VISIBILITY.includes(text[0] || '') ? text[0] : '';
  const classifier = /[$*]$/u.test(text) ? text.slice(-1) : '';
  let id = text.slice(visibility ? 1 : 0, classifier ? length - 1 : length);
  // Mermaid keeps one leading space so `+ String name` still reads with its space (classTypes.ts:127).
  id = id.startsWith(' ') ? ` ${id.trim()}` : id.trim();
  return { method: false, item: decorate({ text: `${visibility}${parseGenericTypes(id)}`.trim() }, classifier) };
}

// Config is read from `info.config.class.*` only, in either casing and as a boolean or its text form; a missing
// section or key falls back to Mermaid's default instead of borrowing another diagram's config.
function configKey(object, key) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return undefined;
  const wanted = key.toLowerCase();
  for (const [name, value] of Object.entries(object)) if (name.toLowerCase() === wanted) return value;
  return undefined;
}
function configFlag(config, key, fallback) {
  const value = configKey(configKey(config, 'class'), key);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (text === 'true') return true;
    if (text === 'false') return false;
  }
  return fallback;
}

/**
 * `parseClass(statements, info)` follows the registry contract: `statements` are the prepared body as
 * `{ text, line }` pairs (a raw string body is accepted too) and `info` carries the language, the first body
 * line, the header options and — once the shared config module lands — `info.config`.
 * Returns `{ errors, warnings, model }`; warnings carry `severity: 'warning'` and never block rendering.
 */
function parseClass(statements, info = {}) {
  const lang = info.lang || 'zh';
  const firstLine = info.firstLine || 2;
  const errors = [], warnings = [];
  for (const key of Object.keys(info.options || {})) {
    errors.push(issue(lang, firstLine - 1,
      `类图不接受选项「${key}」`,
      `Class diagrams take no option: ${key}`,
      '把方向写成正文的 direction TB|BT|RL|LR',
      'Write the direction as a body statement: direction TB|BT|RL|LR'));
  }
  const hierarchical = configFlag(info.config, 'hierarchicalNamespaces', true);
  const hideEmptyMembersBox = configFlag(info.config, 'hideEmptyMembersBox', false);

  const cards = [], byId = new Map(), namespaces = new Map(), edges = [], pendingNotes = [];
  const look = presentation({ lang, classKeyword: 'cssClass' });
  const stack = [];
  let direction = 'TB', open = null, accessibilityBlock = false, interfaceCount = 0, noteCount = 0;

  const create = (id, line) => {
    const card = {
      id, label: id, generic: '', annotations: [], members: [], methods: [],
      parent: null, declared: false, note: false, hidden: false, interface: false, line,
    };
    byId.set(id, card);
    cards.push(card);
    return card;
  };
  // A relation may name a class that is declared later (or never): it still becomes a card, so no edge and no
  // label disappears.
  const reference = (name, line) => {
    const card = byId.get(name.id) || create(name.id, line);
    if (name.generic && !card.generic) card.generic = name.generic;
    return card;
  };
  // A declared class inside a namespace body belongs to that frame, exactly like Mermaid's
  // addClassesToNamespace at the closing brace (classDb.ts:667-682).
  const declare = (name, line) => {
    const card = reference(name, line);
    card.declared = true;
    if (card.interface) { card.interface = false; card.hidden = false; }
    if (stack.length) card.parent = stack.at(-1);
    return card;
  };
  const addMember = (card, text) => {
    const member = String(text).trim();
    if (!member || !card) return;
    // `<<interface>>` inside a body is an annotation, not a member (classDb.ts:287-295).
    if (member.startsWith('<<') && member.endsWith('>>')) { card.annotations.push({ text: member.slice(2, -2).trim() }); return; }
    const parsed = parseMember(member);
    (parsed.method ? card.methods : card.members).push(parsed.item);
  };

  const addNamespace = (name, label, line) => {
    const qualified = stack.length ? `${stack.at(-1)}.${name}` : name;
    stack.push(qualified);
    const existing = namespaces.get(qualified);
    if (existing) {
      // Re-declaration promotes an auto-created ancestor to explicit (classDb.ts:608-621).
      existing.explicit = true;
      if (label) existing.label = label;
      return;
    }
    const parts = qualified.split('.');
    for (let i = 1; i <= parts.length; i += 1) {
      const id = parts.slice(0, i).join('.');
      const leaf = i === parts.length;
      const parent = i > 1 ? parts.slice(0, i - 1).join('.') : null;
      const known = namespaces.get(id);
      if (!known) namespaces.set(id, { id, label: leaf && label ? label : parts[i - 1], parent, depth: i - 1, explicit: leaf, line });
      else if (leaf) {
        known.explicit = true;
        if (label) known.label = label;
      }
    }
  };
  const explicitAncestor = (id) => {
    let current = id;
    while (current) {
      const namespace = namespaces.get(current);
      if (!namespace) return null;
      if (namespace.explicit) return current;
      current = namespace.parent;
    }
    return null;
  };

  const addNote = (text, target, line) => {
    while (byId.has(`note${noteCount}`)) noteCount += 1;
    const card = create(`note${noteCount}`, line);
    noteCount += 1;
    Object.assign(card, { note: true, label: text, parent: stack.at(-1) || null });
    if (target) pendingNotes.push({ card, target, line });
    return card;
  };
  // A lollipop's interface end is Mermaid's invisible node carrying the circle marker
  // (classDb.ts:220-237,832-841). The written name becomes that card, so its label stays readable.
  const interfaceCard = (name, line) => {
    const existing = byId.get(name);
    if (!existing) {
      const card = create(name, line);
      Object.assign(card, { interface: true, hidden: true, parent: stack.at(-1) || null });
      return card;
    }
    // Every lollipop has its own endpoint, even when two interfaces have the same name.
    while (byId.has(`interface${interfaceCount}`)) interfaceCount += 1;
    const card = create(`interface${interfaceCount}`, line);
    interfaceCount += 1;
    Object.assign(card, { interface: true, hidden: true, label: name, parent: stack.at(-1) || null });
    return card;
  };

  for (const row of statementsOf(statements, firstLine)) {
    const line = row.line;
    const text = stripComment(row.text).trim();
    if (!text) continue;
    // Multi-line accDescr bodies belong to shared infrastructure; skip them so they never read as statements.
    if (accessibilityBlock) { if (text.includes('}')) accessibilityBlock = false; continue; }
    if (/^accDescr\s*\{/iu.test(text)) { accessibilityBlock = !text.slice(text.indexOf('{') + 1).includes('}'); continue; }

    // Every line inside a class body is one MEMBER (classDiagram.jison:86): Mermaid's `direction` lexer rule
    // is not scoped to the class-body start condition, so it cannot escape a body either.
    if (open) {
      const card = open;
      let body = text;
      if (text.endsWith('}')) { body = text.slice(0, -1); open = null; }
      if (body.includes('{')) {
        errors.push(issue(lang, line,
          '类成员里不能再写 {',
          'A class body has no nested {',
          '把成员写在 class 块内的独立行上',
          'Write members on their own lines inside the class block'));
        continue;
      }
      addMember(card, body);
      continue;
    }

    const heading = DIRECTION.exec(text);
    if (heading) { direction = heading[1].toUpperCase(); continue; }

    if (text === '}') {
      if (stack.length) stack.pop();
      else errors.push(issue(lang, line, '多余的 }', 'Unmatched }', '删掉这一行，或补上它对应的 namespace', 'Remove this line, or add the namespace it closes'));
      continue;
    }

    const namespace = NAMESPACE_DECL.exec(text);
    if (namespace) {
      let rest = namespace[1].trim();
      const token = takeName(rest);
      if (!token) {
        errors.push(issue(lang, line, 'namespace 后需要命名空间名称', 'A namespace needs a name', '写成 namespace 名称 {', 'Write namespace name {'));
        continue;
      }
      const name = nameParts(token.raw).id;
      rest = rest.slice(token.next).trim();
      const label = LABEL_SUFFIX.exec(rest);
      let display = null;
      if (label) { display = label[1]; rest = rest.slice(label[0].length).trim(); }
      if (rest !== '{') {
        errors.push(issue(lang, line,
          '命名空间后需要 {，块内容从下一行开始',
          'A namespace opens with { and its body starts on the next line',
          '写成 namespace 名称 { 再逐行写 class',
          'Write namespace name { and put each class on its own line'));
        continue;
      }
      addNamespace(name, display, line);
      continue;
    }

    const declaration = CLASS_DECL.exec(text);
    if (declaration) {
      let rest = declaration[1].trim();
      const token = takeName(rest);
      if (!token) {
        errors.push(issue(lang, line, 'class 后需要类名', 'A class needs a name', '写成 class 类名、class 类名["标签"] 或 class 类名 {', 'Write class Name, class Name["label"] or class Name {'));
        continue;
      }
      const card = declare(nameParts(token.raw), line);
      rest = rest.slice(token.next).trim();
      // `class A["label"]` is Mermaid's classLabel (classDiagram.jison:240-242); `class A as label` is the
      // older KChart spelling of the same thing and stays accepted.
      const quoted = LABEL_SUFFIX.exec(rest);
      if (quoted) {
        card.label = quoted[1];
        rest = rest.slice(quoted[0].length).trim();
      } else {
        const legacy = /^as\s+([\s\S]+)$/iu.exec(rest);
        if (legacy) { card.label = unquote(legacy[1]); rest = ''; }
      }
      let body = null, bad = null;
      for (;;) {
        rest = rest.trim();
        if (!rest) break;
        const annotation = ANNOTATION_HEAD.exec(rest);
        if (annotation) { card.annotations.push({ text: annotation[1].trim() }); rest = rest.slice(annotation[0].length).trim(); continue; }
        const style = STYLE_SUFFIX.exec(rest);
        if (style) {
          look.addClasses(card.id, style[1].split(/\s*,\s*/u), line);
          rest = rest.slice(style[0].length).trim();
          continue;
        }
        if (rest.startsWith('{')) { body = rest.slice(1); break; }
        bad = rest;
        break;
      }
      if (bad !== null) { errors.push(unknownStatement(lang, line, text)); continue; }
      if (body === null) continue;
      // Mermaid's class-body state accepts a member on the opening line and keeps reading the body until `}`
      // (classDiagram.jison:81-87), so `class A { +int x` is a body row, not a broken declaration.
      const inner = body.trim();
      if (inner.endsWith('}')) {
        const member = inner.slice(0, -1);
        if (member.trim()) addMember(card, member);
      } else {
        if (inner) addMember(card, inner);
        open = card;
      }
      continue;
    }

    const annotationLine = ANNOTATION_LINE.exec(text);
    if (annotationLine) {
      declare(nameParts(annotationLine[2]), line).annotations.push({ text: annotationLine[1].trim() });
      continue;
    }

    const noteFor = NOTE_FOR.exec(text);
    if (noteFor) { addNote(noteFor[2], nameParts(noteFor[1]).id, line); continue; }
    const note = NOTE.exec(text);
    if (note) { addNote(note[1], null, line); continue; }
    if (/^note\b/iu.test(text)) {
      errors.push(issue(lang, line,
        'note 的文本需要写在双引号里',
        'A note needs its text in double quotes',
        '写成 note "文本" 或 note for 类名 "文本"',
        'Write note "text" or note for Name "text"'));
      continue;
    }

    if (look.accept(text, line)) continue;
    const iconAt = text.indexOf('::icon');
    const iconSuffix = iconAt > 0 ? ICON_SUFFIX.exec(text.slice(iconAt)) : null;
    if (iconSuffix && iconAt + iconSuffix[0].length === text.length && BARE_NAME.test(text.slice(0, iconAt).trimEnd())) {
      declare(nameParts(text.slice(0, iconAt).trimEnd()), line).iconRef = iconSuffix[1];
      continue;
    }
    if (ACCESSIBILITY.test(text)) continue;

    // A colon before the arrow means the rest of the line is a member label, matching Mermaid's LABEL token.
    const arrowAt = indexOutside(text, 'arrow'), colonAt = indexOutside(text, ':');
    if (arrowAt >= 0 && (colonAt < 0 || arrowAt < colonAt)) {
      const relation = RELATION.exec(text);
      const arrow = relation ? ARROW.exec(relation[3]) : null;
      if (!arrow) { errors.push(unknownStatement(lang, line, text)); continue; }
      const leftToken = arrow[1] ? String(arrow[1]).replace(/\s+/gu, '') : '';
      const rightToken = arrow[3] ? String(arrow[3]).replace(/\s+/gu, '') : '';
      const start = leftToken ? arrowMarkers[leftToken] : undefined;
      const end = rightToken ? arrowMarkers[rightToken] : undefined;
      if ((leftToken && !start) || (rightToken && !end)) { errors.push(unknownStatement(lang, line, text)); continue; }
      const from = nameParts(relation[1]), to = nameParts(relation[5]);
      // A lollipop replaces its own end with an invisible node; the opposite end must be a plain class.
      const fromCard = start === 'circle' && !end ? interfaceCard(from.id, line) : reference(from, line);
      const toCard = end === 'circle' && !start ? interfaceCard(to.id, line) : reference(to, line);
      edges.push({
        from: fromCard.id,
        to: toCard.id,
        label: relation[6] ? relation[6].trim() : '',
        ...(arrow[2] === '..' ? { dashed: true } : { dashed: false }),
        ...(start ? { start } : {}),
        ...(end ? { end } : {}),
        ...(relation[2] ? { c1: relation[2].trim() } : {}),
        ...(relation[4] ? { c2: relation[4].trim() } : {}),
        line,
      });
      continue;
    }

    // `A:::name` is Mermaid's STYLE_SEPARATOR, which the lexer prefers over a `LABEL` colon.
    const classOnly = CLASS_ONLY.exec(text);
    if (classOnly) {
      look.addClasses(declare(nameParts(classOnly[1]), line).id, classOnly[2].split(/\s*,\s*/u), line);
      continue;
    }

    // `A : +String owner` is the same member statement as a body row (classDiagram.jison:332-337).
    const colonMember = COLON_MEMBER.exec(text);
    if (colonMember) { addMember(reference(nameParts(colonMember[1]), line), colonMember[2]); continue; }

    const bare = BARE_NAME.exec(text);
    if (bare) { declare(nameParts(bare[1]), line); continue; }

    errors.push(unknownStatement(lang, line, text));
  }

  if (open) {
    errors.push(issue(lang, open.line,
      'class 块缺少结束的 }',
      'A class block is missing its closing }',
      '在块末尾补上 }',
      'Add } at the end of the block'));
  }
  if (stack.length) {
    errors.push(issue(lang, namespaces.get(stack.at(-1))?.line ?? firstLine,
      'namespace 块缺少结束的 }',
      'A namespace block is missing its closing }',
      '在块末尾补上 }',
      'Add } at the end of the block'));
  }

  // Notes resolve after the whole body, so `note for X` works whether X is declared before or after. Mermaid
  // links a note to its class with a marker-free dotted edge (classDb.ts:790-830).
  for (const entry of pendingNotes) {
    const target = byId.get(entry.target);
    if (!target) {
      warnings.push(warning('DIAGRAM_HINT', lang, entry.line,
        `note for 指向的「${entry.target}」不是任何类，这张注释没有连线`,
        `"${entry.target}" is not a class, so this note stays unconnected`,
        '把 note for 后面的类名改成图中的类',
        'Point note for at a class in the diagram'));
      continue;
    }
    edges.push({ from: entry.card.id, to: target.id, label: '', dashed: true, line: entry.line });
  }
  edges.sort((a, b) => a.line - b.line);


  if (cards.length > limits.large) {
    warnings.push(warning('LARGE_DIAGRAM', lang, cards[0]?.line ?? firstLine,
      `${cards.length} 个类或注释，图会很大，建议拆分`,
      `${cards.length} classes and notes; consider splitting this diagram`,
      '按命名空间拆成多张图，并用文字说明它们的对应关系',
      'Split by namespace and describe the mapping in prose'));
  }
  if (cards.length > limits.cards) {
    errors.push(issue(lang, cards[limits.cards].line,
      `类与注释最多 ${limits.cards} 个`,
      `At most ${limits.cards} classes and notes`,
      '拆成多张图',
      'Split into several diagrams'));
  }
  if (edges.length > limits.edges) {
    errors.push(issue(lang, edges[limits.edges].line,
      `关系最多 ${limits.edges} 条`,
      `At most ${limits.edges} relations`,
      '删掉次要关系，或拆成多张图',
      'Remove secondary relations, or split into several diagrams'));
  }

  // `sections` is one array per drawn band: attributes, then methods. A class with no member still shows an
  // empty member band while `hideEmptyMembersBox` is false — the empty section stands for it — and `true`
  // drops it so only the name band remains (classBox.ts:41-46).
  const sectionsOf = (card) => {
    if (card.note || card.hidden) return [];
    if (hideEmptyMembersBox && !card.members.length && !card.methods.length) return [];
    return [card.members, card.methods];
  };
  const titleOf = (card) => {
    const generic = card.generic ? parseGenericTypes(card.generic) : '';
    return generic ? `${card.label}&lt;${generic}&gt;` : card.label;
  };
  const frames = [];
  for (const namespace of namespaces.values()) {
    // `hierarchicalNamespaces: false` draws only declared frames, titled with the qualified name
    // (classDb.ts:748-770).
    if (!hierarchical && !namespace.explicit) continue;
    frames.push({
      id: namespace.id,
      label: hierarchical ? namespace.label : namespace.id,
      parent: hierarchical ? namespace.parent : null,
      depth: hierarchical ? namespace.depth : 0,
      line: namespace.line,
    });
  }
  const model = {
    kind: 'classDiagram',
    direction,
    cards: cards.map((card) => {
      const parent = card.parent ? (hierarchical ? card.parent : explicitAncestor(card.parent)) : null;
      return {
        id: card.id,
        title: card.note ? card.label : titleOf(card),
        ...(card.annotations.length ? { annotations: card.annotations.map((entry) => ({ text: entry.text })) } : {}),
        sections: sectionsOf(card),
        ...(parent ? { parent } : {}),
        ...(card.note ? { note: true } : {}),
        ...(card.hidden ? { hidden: true } : {}),
        ...(card.iconRef ? { iconRef: card.iconRef } : {}),
        line: card.line,
      };
    }),
    frames,
    edges,
  };
  // Warnings travel in `errors` like every other family (their severity keeps them non-blocking) and are also
  // returned on their own for callers that want them separated.
  errors.push(...finishCards(model, look, lang));
  return { errors: [...errors, ...warnings], warnings: [...warnings, ...errors.filter(item => item.severity === 'warning')], model };
}

export function finishCards(model, look, lang) {
  const issues = new Map();
  const remember = issue => {
    if ((issues.get(issue.message)?.line ?? Infinity) > issue.line) issues.set(issue.message, issue);
  };
  const normalize = (item, key, owner = item) => {
    if (item[key] == null) return;
    const { text, icon, diagnostics } = normalizeLabel(item[key], { lang, line: owner.line });
    item[key] = text;
    if (icon) owner.icon ??= icon;
    diagnostics.forEach(remember);
  };
  for (const card of model.cards) {
    const tone = look.statusOf(card.id), link = look.linkOf(card.id);
    if (tone) card.tone = tone;
    if (link) card.link = link;
    if (card.iconRef) {
      const ref = card.iconRef;
      const icon = resolveIconRef(ref);
      if (icon) card.icon = icon;
      else remember(warning('IGNORED_ASSET', lang, card.line, `未知图标 ${ref}`, `Unknown icon ${ref}`, '使用内置图标', 'Use a built-in icon'));
      delete card.iconRef;
    }
    normalize(card, 'title');
    for (const row of [...(card.annotations || []), ...card.sections.flat()]) normalize(row, 'text', card);
  }
  for (const frame of model.frames || []) normalize(frame, 'label');
  for (const [index, edge] of model.edges.entries()) {
    const tone = look.edgeStatusOf(index);
    if (tone) edge.tone = tone;
    for (const key of ['label', 'c1', 'c2']) normalize(edge, key);
  }
  return [...look.diagnostics(), ...issues.values()];
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const markerId = (name, tone) => `uml-${name}${tone ? `-${tone}` : ''}`;

function drawIcon(ctx, icon, x, y, ink) {
  const [left, top, w, h] = icon.viewBox.split(/\s+/).map(Number);
  const scale = 14 / Math.max(w, h);
  return ctx.el('g', { transform: `translate(${x - (left + w / 2) * scale} ${y - (top + h / 2) * scale}) scale(${scale})` },
    icon.elements.map(({ tag, attrs }) => ctx.shape(tag, { ...attrs, ...(icon.set === 'simple' ? { fill: ink }
      : { fill: 'none', stroke: ink, 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }) })));
}

function cardMarkers(ctx, a, edges) {
  const surface = a.surface;
  const shapes = {
    triangle: ['M2 2 L13 7 L2 12 Z', surface],
    hollowDiamond: ['M1 7 L7 2 L13 7 L7 12 Z', surface],
    filledDiamond: ['M1 7 L7 2 L13 7 L7 12 Z', null],
    arrow: ['M4 3 L13 7 L4 11', 'none'],
    cross: ['M5 3 L13 11 M5 11 L13 3', 'none'],
    contains: ['M2 3 H10 V11 H2 Z M4 7 H8 M6 5 V9', surface],
  };
  const used = new Map(edges.flatMap(edge => [edge.start, edge.end].filter(Boolean)
    .map(name => [markerId(name, edge.tone), { name, ink: a[edge.tone] || a.fg4 }])));
  return ctx.el('defs', {}, [...used].map(([id, { name, ink }]) => {
    const attrs = { stroke: ink, 'stroke-width': 1.25 };
    const shape = name === 'circle' ? ctx.circle(7, 7, 5, { ...attrs, fill: surface })
      : ctx.path(shapes[name][0], { ...attrs, fill: shapes[name][1] ?? ink });
    return ctx.el('marker', { id, viewBox: '0 0 14 14', refX: name === 'circle' ? 7 : 13,
      refY: 7, markerWidth: 14, markerHeight: 14, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' }, [shape]);
  }));
}

// Reserve each compartment through graph-layout's independently measured description rows.
// Empty bands need a sizing row too, but no drawn text. The engine measures at 13px,
// slightly larger than the 12px detail rows, so leave room for that second measurement.
export function layoutCards(model, { ctx, width, lang, measure = (s, f) => ctx.measure(s, f.size, f.weight) }) {
  const { cards, frames = [], edges, direction } = model;
  const requirements = model.type === 'requirementDiagram';
  const a = appearance(ctx);
  const cardById = new Map(cards.map(card => [card.id, card]));
  const rowsById = new Map();
  const nodes = cards.map((card, seq) => {
    const wrap = rows => rows.flatMap(row => ctx.wrap(row.text, 172, FONT.label.size, FONT.label.weight)
      .map(text => ({ ...row, text })));
    const [first, ...rest] = card.sections;
    const typeBand = first?.[0]?.role === 'stereotype';
    const annotations = wrap(typeBand ? first : (card.annotations || []).map(row => ({ ...row, text: `«${row.text}»` })));
    const sections = (typeBand ? rest : card.sections).map(wrap);
    rowsById.set(card.id, { annotations, sections });
    const desc = [...(card.icon ? ['·'] : []), ...annotations.map(row => row.text), ...sections.flatMap(rows => rows.length ? rows.map(row => row.text) : ['·'])];
    return { id: card.id, seq, label: card.title || '\u00a0', desc, parent: card.parent,
      ...(card.hidden ? { kind: 'start' } : {}) };
  });
  const graph = layoutGraph({ type: 'flowchart', direction, nodes,
    subgraphs: frames.map((frame, seq) => ({ ...frame, seq, title: frame.label })),
    edges: edges.map((edge, seq) => ({ ...edge, seq, style: edge.dashed ? 'dashed' : 'solid',
      startArrow: Boolean(edge.start), endArrow: Boolean(edge.end) })),
  }, { measure, lang });
  const text = (x, y, value, opts = {}) => ctx.text(x, y, value, { 'dominant-baseline': 'central', fill: a.fg3, ...opts });
  const outlines = [], titles = [], paths = [], boxes = [], labels = [];
  const obstacles = [...graph.nodes, ...graph.frames.map(frame => frame.titleRect).filter(Boolean),
    ...graph.edges.map(edge => edge.labelRect).filter(Boolean)];
  // A cubic stays within the bounds of its control points; reserve them so endpoint text
  // cannot land on a neighboring route, including closely spaced parallel ports.
  const routeBounds = graph.edges.flatMap(edge => edge.segments.map(({ p0, c1, c2, p1 }) => {
    const xs = [p0.x, c1.x, c2.x, p1.x], ys = [p0.y, c1.y, c2.y, p1.y];
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x: x - 1, y: y - 1, w: Math.max(...xs) - x + 2, h: Math.max(...ys) - y + 2 };
  }));
  const free = box => !obstacles.some(other => overlaps(box, other)) && !routeBounds.some(other => overlaps(box, other));
  for (const f of graph.frames) {
    outlines.push(ctx.rect(f.x, f.y, f.w, f.h, { rx: 7, fill: a.surface, stroke: a.line2, meta: { kind: 'frame', id: f.id } }));
    if (!f.titleRect) continue;
    const r = f.titleRect;
    titles.push(ctx.rect(r.x - 3, r.y, r.w + 6, r.h, { rx: 3, fill: a.surface }));
    f.lines.forEach((line, i) => titles.push(text(r.x, r.y + (i + .5) * 17, line, { size: 13, weight: 600 })));
  }
  for (const route of graph.edges) {
    if (!route.segments?.length) continue;
    const edge = edges[route.id];
    paths.push(ctx.path(cubicPath(route.segments), {
      fill: 'none', stroke: a[edge.tone] || a.fg4, 'stroke-width': 1.25, 'stroke-dasharray': edge.dashed ? '5 4' : null,
      'marker-start': edge.start ? `url(#${markerId(edge.start, edge.tone)})` : null,
      'marker-end': edge.end ? `url(#${markerId(edge.end, edge.tone)})` : null,
      meta: { kind: 'edge', from: edge.from, to: edge.to },
    }));
    const r = route.labelRect;
    if (r && route.labelLines.length) {
      const children = [ctx.rect(r.x, r.y, r.w, r.h, { rx: 4, fill: a.surface, stroke: a.line1, 'stroke-width': .6 })];
      route.labelLines.forEach((line, i) => children.push(text(r.x + r.w / 2,
        r.y + r.h / 2 + (i - (route.labelLines.length - 1) / 2) * 16, line, { size: 12, anchor: 'middle' })));
      labels.push({ ...ctx.el('g', {}, children), meta: { kind: 'edge-label-group', from: edge.from, to: edge.to } });
    }
    for (const [value, start] of [[edge.c1, true], [edge.c2, false]]) {
      if (!value) continue;
      const segment = start ? route.segments[0] : route.segments.at(-1);
      const p = start ? segment.p0 : segment.p1;
      const q = start ? segment.c1 || segment.p1 : segment.c2 || segment.p0;
      const vertical = Math.abs(q.y - p.y) >= Math.abs(q.x - p.x);
      const sign = Math.sign(vertical ? q.y - p.y : q.x - p.x) || 1;
      const w = ctx.measure(value, 12, 400);
      let box;
      for (const distance of [10, 18, 26, 36, 48]) {
        for (const side of start ? [-1, 1] : [1, -1]) {
          const candidate = vertical
            ? { x: p.x + (side < 0 ? -8 - w : 8), y: p.y + sign * distance - 7, w, h: 14 }
            : { x: p.x + (sign < 0 ? -distance - w : distance), y: p.y + side * 12 - 7, w, h: 14 };
          box = candidate;
          if (free(candidate)) break;
        }
        if (free(box)) break;
      }
      obstacles.push(box);
      labels.push(text(box.x, box.y + 7, value, { size: 12, meta: { kind: 'cardinality', endpoint: start ? 'start' : 'end' } }));
    }
  }
  for (const n of graph.nodes) {
    const card = cardById.get(n.id);
    if (card.hidden) continue;
    const { x, y, w, h } = n;
    const { annotations, sections } = rowsById.get(n.id);
    const stroke = card.tone ? a[card.tone] : a.line2;
    const fill = card.tone ? ctx.mix(a.node, stroke, a.soft) : a.node;
    const anchor = requirements || card.note ? 'start' : 'middle';
    const tx = anchor === 'start' ? x + 14 : x + w / 2;
    const header = 20 + (annotations.length + Number(Boolean(card.icon))) * 17 + n.lines.length * 19;
    const items = [];
    items.push(ctx.rect(x, y, w, h, { rx: 7, fill, stroke, meta: { kind: 'node', id: card.id } }));
    if (sections.length) items.push(ctx.rect(x + 1, y + 1, w - 2, header - 1, { rx: 6, fill: a.line1, 'fill-opacity': .3 }));
    let cursor = y + 10;
    if (card.icon) {
      items.push(drawIcon(ctx, card.icon, tx + (anchor === 'start' ? 7 : 0), cursor + 8.5, stroke));
      cursor += 17;
    }
    const drawRow = (row, px, baseline, opts) => items.push(text(px, baseline, row.text, { size: FONT.label.size,
      'font-style': row.fontStyle, 'text-decoration': row.decoration, ...opts }));
    for (const row of annotations) { drawRow(row, tx, cursor + 8.5, { anchor }); cursor += 17; }
    for (const line of n.lines) {
      items.push(text(tx, cursor + 9.5, line, { ...FONT.title, ...(card.note ? { weight: 400 } : {}), anchor, fill: a.fg1 })); cursor += 19;
    }
    cursor += 10;
    for (const [i, rows] of sections.entries()) {
      items.push(ctx.line(x + (i ? 9 : 0), cursor, x + w - (i ? 9 : 0), cursor, { stroke: a.line2, 'stroke-width': .7 }));
      for (const [j, row] of rows.entries()) drawRow(row, x + 14, cursor + 11 + j * 17, {});
      cursor += Math.max(1, rows.length) * 17;
    }
    if (card.link) boxes.push(ctx.link(card.link.href, items, card.link));
    else boxes.push(...items);
  }
  // Interface names sit on the far side of the circle, not between the circle and its class.
  for (const route of graph.edges) {
    for (const [id, marker, p, q] of [[route.from, edges[route.id].start, route.start, route.end],
      [route.to, edges[route.id].end, route.end, route.start]]) {
      const card = cardById.get(id);
      if (marker !== 'circle' || !card?.hidden || !p || !q) continue;
      const horizontal = direction === 'LR' || direction === 'RL';
      const sign = (horizontal ? p.x - q.x : p.y - q.y) >= 0 ? 1 : -1;
      labels.push(text(p.x + (horizontal ? sign * 11 : 0), p.y + (horizontal ? 0 : sign * 14), card.title,
        { size: 12, anchor: horizontal ? (sign > 0 ? 'start' : 'end') : 'middle' }));
    }
  }
  const errors = graph.width > 2 * width && cards.length <= limits.large ? [warning('LARGE_DIAGRAM', lang, 1,
    '图较宽，将横向滚动', 'This diagram is wide and will scroll horizontally', '考虑拆分成多张图', 'Consider splitting it into several diagrams')] : [];
  const scene = { width: graph.width, height: graph.height, title: model.title || model.kind || model.type, heading: model.title,
    children: [cardMarkers(ctx, a, edges), ...outlines, ...paths, ...boxes, ...labels, ...titles] };
  return { width: graph.width, height: graph.height, geometry: graph, scene, errors };
}

const implementation = { parse: parseClass, layout: layoutCards, acceptsPresentation: true,
  honoredConfig: ['class.hideEmptyMembersBox', 'class.hierarchicalNamespaces'] };
export const implementations = { classDiagram: implementation };

export { kind, kinds, limits, directions, markers, arrowMarkers, parseClass, parseClass as parse, implementation };
