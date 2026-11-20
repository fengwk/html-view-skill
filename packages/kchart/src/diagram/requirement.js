/* Mermaid requirementDiagram: requirements and elements as cards, joined by the seven SysML verbs only. */

import { error, warning } from './support.js';
import { layoutCards } from './class.js';

// Mermaid's header keyword and its shorter alias (requirementDiagram.jison:36). The family is registered in
// src/families.json; these descriptors carry the same shape so a caller can register them itself.
const kind = Object.freeze({ kind: 'requirementDiagram', syntax: 'mermaid', topic: 'data-model', aliases: Object.freeze(['requirement']) });
const kinds = Object.freeze([kind]);
// Work caps bound runtime only (§9 of the shared contract); a large diagram warns long before it fails.
const limits = Object.freeze({ cards: 2000, edges: 5000, large: 60 });

// Block keywords and the words Mermaid prints for them (requirementDiagram.jison:48-64, requirementDb.ts:35-42).
const typeWords = Object.freeze({
  requirement: 'Requirement',
  functionalrequirement: 'Functional Requirement',
  interfacerequirement: 'Interface Requirement',
  performancerequirement: 'Performance Requirement',
  physicalrequirement: 'Physical Requirement',
  designconstraint: 'Design Constraint',
  element: 'Element',
});
// Closed value sets: Mermaid rejects anything else, so out-of-range values stay errors
// (requirementDiagram.jison:55-62,177-190; requirementDb.ts:44-55).
const riskLevels = Object.freeze({ low: 'Low', medium: 'Medium', high: 'High' });
const verificationMethods = Object.freeze({ analysis: 'Analysis', demonstration: 'Demonstration', inspection: 'Inspection', test: 'Test' });
const relationships = Object.freeze(['contains', 'copies', 'derives', 'satisfies', 'verifies', 'refines', 'traces']);
// Fields per block body: a requirement has no type/docref, an element no id/text/risk/verifymethod (jison:151-203).
const requirementFields = Object.freeze({ id: 'reqId', text: 'text', risk: 'risk', verifymethod: 'verifyMethod' });
const elementFields = Object.freeze({ type: 'elementType', docref: 'docRef' });
const directions = Object.freeze(['TB', 'BT', 'RL', 'LR']);

// Names are Mermaid's unqString or qString (jison:99,260-265): unquoted names cannot hold ':' ',' '{' '}' '<' '>' '-' '='.
const NAME = '(?:"[^"]*"|[^\\s:,\\r\\n{}<>=-][^:,\\r\\n{}<>=-]*)';
const BLOCK = new RegExp(`^(${Object.keys(typeWords).join('|')})\\s+(${NAME})(?:\\s*:::\\s*([\\w,\\s]*?))?\\s*\\{\\s*$`, 'iu');
const FORWARD = new RegExp(`^(${NAME})\\s*-\\s*(${relationships.join('|')})\\s*->\\s*(${NAME})\\s*$`, 'iu');
// The reverse form is tried only after the forward form, so `-` never wins over `<-` (jison:205-209).
const REVERSE = new RegExp(`^(${NAME})\\s*<-\\s*(${relationships.join('|')})\\s*-\\s*(${NAME})\\s*$`, 'iu');
const FIELD = /^([A-Za-z][\w-]*)\s*:\s*([\s\S]*)$/u;
const CLASS_ONLY = new RegExp(`^(${NAME})\\s*:::\\s*([\\w,\\s]+)$`, 'u');
// Mermaid's lexer matches `.*direction\s+(TB|BT|RL|LR)[^\n]*`, i.e. anywhere on a top-level line (jison:26-29).
const DIRECTION = new RegExp(`\\bdirection\\s+(${directions.join('|')})\\b`, 'iu');
const STYLE_STATEMENT = /^(classDef|class|style)\s/iu;
const ACCESSIBILITY = /^acc(?:Title|Descr)\b/iu;

const issue = (lang, line, zh, en, fixZh, fixEn, column = 1) => error(lang, line, zh, en, fixZh, fixEn, column);
const unknownStatement = (lang, line, text) => issue(lang, line,
  `不支持或无效的需求图语句：「${text}」`,
  `Unsupported or invalid requirement-diagram statement: "${text}"`,
  '使用 requirement/element 块、字段行或「A - 关系 -> B」',
  'Use a requirement/element block, a field line, or "A - relation -> B"');
// Quotes are the only escaping this family owns; entities, inline HTML and Markdown are the shared label module's.
const unquote = (value) => {
  const text = String(value ?? '').trim(), quoted = /^"([^"]*)"$/u.exec(text);
  return quoted ? quoted[1] : text;
};

// Mermaid's lexer skips `#…` and `%%…` to end of line outside a quoted string (jison:32-33), but entity codes such
// as `#quot;` or `&#9829;` are user text: they are the shared label module's to decode, so they stay.
const ENTITY = /^&?#(?:x[\da-f]+|\d+|\w+);/iu;
function stripComment(raw) {
  let quote = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '"') { quote = !quote; continue; }
    if (quote) continue;
    if (ch === '%' && raw[i + 1] === '%') return raw.slice(0, i);
    if (ch === '#' && !ENTITY.test(raw.slice(i))) return raw.slice(0, i);
  }
  return raw;
}

// `parse(source, info)` follows the registry contract: `source` is the prepared body text and `info` carries the
// language, the first body line and the header options.
function parse(source, info = {}) {
  const lang = info.lang || 'zh', firstLine = info.firstLine || 2;
  const errors = [], warnings = [];
  for (const key of Object.keys(info.options || {})) {
    errors.push(issue(lang, firstLine - 1,
      `需求图不接受选项「${key}」`,
      `Requirement diagrams take no option: ${key}`,
      '把方向写成正文的 direction TB|BT|RL|LR',
      'Write the direction as a body statement: direction TB|BT|RL|LR'));
  }

  const cards = [], edges = [], byId = new Map();
  const duplicates = [], styleLines = [], classNames = [];
  let direction = 'TB', title = '', open = null, accessibilityBlock = false;

  const create = (id, line, declared, type) => {
    const card = { id, name: id, type: declared ? type : '', declared, classes: [], line, fields: Object.create(null) };
    byId.set(id, card);
    cards.push(card);
    return card;
  };
  // A relation may name a requirement that is declared later (or never): the name still becomes a card, so the
  // relation is drawn instead of silently disappearing.
  const reference = (id, line) => byId.get(id) || create(id, line, false, '');

  const rows = String(source ?? '').replace(/\r\n?/gu, '\n').split('\n');
  for (const [index, raw] of rows.entries()) {
    const line = firstLine + index;
    const text = stripComment(raw).trim();
    if (!text) continue;
    // Multi-line accDescr blocks are shared infrastructure's; skip their body so it is never read as statements.
    if (accessibilityBlock) { if (text.includes('}')) accessibilityBlock = false; continue; }
    if (/^accDescr\s*\{/iu.test(text)) { accessibilityBlock = !text.slice(text.indexOf('{') + 1).includes('}'); continue; }

    if (open) {
      if (text === '}') { open = null; continue; }
      const field = FIELD.exec(text);
      if (!field) { errors.push(unknownStatement(lang, line, text)); continue; }
      const key = field[1].toLowerCase(), value = unquote(field[2]);
      const word = typeWords[open.card.type];
      const allowed = open.card.type === 'element' ? elementFields : requirementFields;
      if (!Object.hasOwn(allowed, key)) {
        errors.push(issue(lang, line,
          `${word} 块不支持字段「${field[1]}」`,
          `${word} blocks have no field "${field[1]}"`,
          `只使用 ${Object.keys(allowed).join('、')}`,
          `Use only ${Object.keys(allowed).join(', ')}`));
        continue;
      }
      if (!value) {
        errors.push(issue(lang, line,
          `字段「${field[1]}」缺少取值`,
          `Field "${field[1]}" needs a value`,
          '在冒号后写上取值，或删掉这一行',
          'Write a value after the colon, or remove the line'));
        continue;
      }
      if (key === 'risk' || key === 'verifymethod') {
        // Mermaid's enum tokens are case-insensitive, so `risk: HIGH` is valid; the card shows Mermaid's word.
        const table = key === 'risk' ? riskLevels : verificationMethods, normalized = table[value.toLowerCase()];
        if (!normalized) {
          errors.push(issue(lang, line,
            `「${field[1]}」只接受 ${Object.keys(table).join('/')}，不能是「${value}」`,
            `"${field[1]}" accepts only ${Object.keys(table).join('/')}, not "${value}"`,
            `改成 ${Object.keys(table).join('、')} 之一`,
            `Use one of ${Object.keys(table).join(', ')}`));
          continue;
        }
        open.card.fields[allowed[key]] = normalized;
        continue;
      }
      open.card.fields[allowed[key]] = value;
      continue;
    }

    if (ACCESSIBILITY.test(text)) continue;
    // `title` is not in Mermaid's requirement grammar, but Mermaid's lexer reserves the word and KChart has always
    // honored it here; accepting it is a superset of Mermaid's accepted input.
    const titleMatch = /^title\s+(.+)$/iu.exec(text);
    if (titleMatch) { title ||= titleMatch[1].trim(); continue; }

    const block = BLOCK.exec(text);
    if (block) {
      const type = block[1].toLowerCase(), name = unquote(block[2]);
      const classes = (block[3] || '').split(',').map((entry) => entry.trim()).filter(Boolean);
      if (!name) {
        errors.push(issue(lang, line, '需求或元素名称不能为空', 'A requirement or element needs a name', '在关键字后写上名称', 'Write a name after the keyword'));
        continue;
      }
      const existing = byId.get(name);
      if (existing?.declared) {
        // Mermaid silently keeps only the first definition. KChart keeps the first card, lets later fields correct
        // it, and reports the redeclaration once per diagram so a copy-paste slip is visible.
        duplicates.push({ name, line });
        existing.classes.push(...classes);
        open = { card: existing };
        continue;
      }
      // A name a relation introduced earlier becomes a declared card now; its fields start from here.
      const card = existing || create(name, line, true, type);
      Object.assign(card, { type, declared: true, fields: Object.create(null) });
      card.classes.push(...classes);
      open = { card };
      continue;
    }

    const forward = FORWARD.exec(text), reverse = forward ? null : REVERSE.exec(text);
    if (forward || reverse) {
      // `b <- verb - a` stores the same (src,dst) pair as `a - verb -> b` (jison:205-209).
      const verb = (forward ? forward[2] : reverse[2]).toLowerCase();
      const from = unquote(forward ? forward[1] : reverse[3]), to = unquote(forward ? forward[3] : reverse[1]);
      if (!from || !to) {
        errors.push(issue(lang, line, '关系的两端都需要名称', 'Both ends of a relation need a name', '在箭头两侧写上需求或元素名称', 'Name a requirement or element on both sides of the arrow'));
        continue;
      }
      reference(from, line); reference(to, line);
      const contains = verb === 'contains';
      // `contains` is solid with Mermaid's square marker at the source; the other six are dashed with an open arrow
      // at the target and always labelled `<<verb>>` (requirementDb.ts:318-339).
      edges.push({
        from, to, verb, label: `<<${verb}>>`, dashed: !contains, line,
        ...(contains ? { start: 'contains' } : { end: 'arrow' }),
      });
      continue;
    }

    const heading = DIRECTION.exec(text);
    if (heading) { direction = heading[1].toUpperCase(); continue; }

    if (STYLE_STATEMENT.test(text)) { styleLines.push({ line, text }); continue; }
    // `a:::cls` alone is a valid class assignment (jison:233) and only affects presentation, like ::: in a block.
    const classOnly = CLASS_ONLY.exec(text);
    if (classOnly) {
      const target = byId.get(unquote(classOnly[1]));
      classNames.push({ line, text, target: target?.name || null });
      continue;
    }
    errors.push(unknownStatement(lang, line, text));
  }
  if (open) {
    errors.push(issue(lang, open.card.line,
      '需求或元素块缺少结束的 }',
      'Requirement or element block is missing its closing }',
      '在块末尾补上 }',
      'Add } at the end of the block'));
  }
  if (duplicates.length) {
    warnings.push(warning('DIAGRAM_HINT', lang, duplicates[0].line,
      `${duplicates.map((entry) => `「${entry.name}」`).join('、')} 重复声明，只画第一张卡，后面的字段覆盖前面的取值`,
      `${duplicates.map((entry) => `"${entry.name}"`).join(', ')} declared more than once; one card is drawn and later fields win`,
      '每个需求或元素只声明一次',
      'Declare each requirement or element once'));
  }
  // style/classDef/class and ::: class names belong to the shared presentation module; until it is wired they are
  // accepted and drawn with theme roles, never silently dropped (§4, phase 2 leftover).
  if (styleLines.length || classNames.length) {
    const first = [...styleLines, ...classNames].sort((a, b) => a.line - b.line)[0];
    const parts = [];
    if (classNames.length) parts.push({ zh: `${classNames.length} 个 ::: 类名`, en: `${classNames.length} ::: class name(s)` });
    if (styleLines.length) parts.push({ zh: `${styleLines.length} 条样式语句`, en: `${styleLines.length} style statement(s)` });
    warnings.push(warning('IGNORED_STYLE', lang, first.line,
      `${parts.map((part) => part.zh).join('和')}未绘制，卡片配色由主题决定`,
      `${parts.map((part) => part.en).join(' and ')} are not drawn; card colors come from the theme`,
      '删掉 style/classDef/class 与 ::: 类名，或等表现层支持',
      'Remove style/classDef/class and ::: class names, or wait for presentation support'));
  }
  if (cards.length > limits.large) {
    warnings.push(warning('LARGE_DIAGRAM', lang, cards[0]?.line || firstLine,
      `${cards.length} 个需求或元素，图会很大，建议拆分`,
      `${cards.length} requirements and elements; consider splitting this diagram`,
      '按需求分组拆成多张图，并用文字说明它们的对应关系',
      'Split by requirement group and describe the mapping in prose'));
  }
  if (cards.length > limits.cards) {
    errors.push(issue(lang, cards[limits.cards].line,
      `需求与元素最多 ${limits.cards} 个`,
      `At most ${limits.cards} requirements and elements`,
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

  // Card body: the `<<type>>` stereotype section, then one section of field rows. A name that only appears as a
  // relation endpoint has no sections and is drawn as its name alone. Items carry text only; typography is the
  // stereotype's one emphasis (Mermaid prints it in a lighter, italic line) and the rest is the layout's choice.
  const sections = (card) => {
    if (!card.declared) return [];
    const rows = [];
    if (card.type === 'element') {
      if (card.fields.elementType) rows.push({ text: `Type: ${card.fields.elementType}` });
      if (card.fields.docRef) rows.push({ text: `Doc Ref: ${card.fields.docRef}` });
    } else {
      if (card.fields.reqId) rows.push({ text: `ID: ${card.fields.reqId}` });
      if (card.fields.text) rows.push({ text: `Text: ${card.fields.text}` });
      if (card.fields.risk) rows.push({ text: `Risk: ${card.fields.risk}` });
      if (card.fields.verifyMethod) rows.push({ text: `Verification: ${card.fields.verifyMethod}` });
    }
    const stereotype = [{ text: `<<${typeWords[card.type]}>>`, fontStyle: 'italic', role: 'stereotype' }];
    return rows.length ? [stereotype, rows] : [stereotype];
  };
  const model = {
    type: 'requirementDiagram',
    direction,
    ...(title ? { title } : {}),
    cards: cards.map((card) => ({
      id: card.id,
      title: card.name,
      sections: sections(card),
      ...(card.declared ? { stereotype: typeWords[card.type], kind: card.type } : { implicit: true, kind: 'reference' }),
      // Elements and requirements must stay apart at a glance; the theme's status roles carry that difference.
      ...(card.declared && card.type === 'element' ? { tone: 'info' } : {}),
      ...(card.classes.length ? { classes: [...new Set(card.classes)] } : {}),
      ...(card.declared ? { fields: { ...card.fields } } : {}),
      line: card.line,
    })),
    edges,
  };
  // Warnings travel in `errors` like every other family (their severity keeps them non-blocking) and are also
  // returned on their own for callers that want them separated.
  return { errors: [...errors, ...warnings], warnings, model };
}

const implementation = { parse, layout: layoutCards };
export const implementations = { requirementDiagram: implementation };

export { kind, kinds, limits, typeWords, riskLevels, verificationMethods, relationships, directions, parse, implementation };
export { parse as parseRequirement };
