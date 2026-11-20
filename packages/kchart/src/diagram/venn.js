/* venn-beta: Mermaid's sets, unions and text nodes as tinted overlapping rings; four or more sets become a region grid. */

import { contrast, pushContrast } from '../core/color.js';
import { FONT, appearance as appearanceOf, error as issueAt, fallbackMeasure, warning, wrapText } from './support.js';
import { normalizeLabel } from './label.js';
import { presentation } from './presentation.js';
import { labelIcon } from './tree-family-icon.js';

const MARGIN = 24;
const TITLE_LINE = 20;
const TITLE_GAP = 12;
const HEAD_LINE = 18;      // 14 px pitch: set labels and grid panel headers
const ITEM_LINE = 16;      // 12 px pitch: union labels, text nodes, shelf rows
const ITEM_GAP = 4;        // region label → its own text nodes
const SET_CLEAR = 12;      // set label → ring stroke
const UNION_CLEAR = 10;    // union label → ring stroke
const INK_GAP = 4;         // minimum clearance from the line box to the circle edge
const SHELF_GAP = 26;      // plot bottom → the shelf
const SHELF_PITCH = 28;    // between shelf items on one row
const LEADER = 8;          // shelf row top → its leader line
const GRID_PAD = 14;
const GRID_GAP = 16;
const GRID_MIN_W = 168;
const GRID_COLS = 3;
const ITEM_CAP = 12;       // text nodes kept inside one region before a hint is raised
const SIZE_DEFAULT = 10;   // Mermaid's default weight; a union of n sets defaults to 10 / n²
const RING_STROKE = 1.5;
const RING_OPACITY = 0.10;
const TEXT_CONTRAST = 4.5;
const SPREADS = 17;        // spread candidates, ordered by distance from the canonical layout
const GROW = 1.12;         // ring growth per fitting pass; the scene widens, text never shrinks
const MAX_GROWTH = 6;
const PLOT_H = 460;        // preferred plot height before labels force a wider plot
const PARTS_HINT = 60;
const RING_MAX = 3;

// Two rings overlap by 55 % of the smaller radius; three rings keep the classic centre-to-centre distance of
// one radius (s = 1). Both are the visual reference points the spread search starts from.
const PAIR_SHARE = 0.55;
const TRIANGLE_MIN = 0.55;
const TRIANGLE_MAX = 1.25;
const TRIANGLE_CANON = 1;

const TITLE_FONT = { size: FONT.title.size, weight: FONT.title.weight };
const SET_FONT = { size: FONT.title.size, weight: FONT.title.weight };
const ITEM_FONT = { size: FONT.label.size, weight: FONT.label.weight };
const UNION_FONT = { ...ITEM_FONT, weight: 600 };

// --- parsing ------------------------------------------------------------------------------------

// Mermaid's venn lexer skips `%%` comments anywhere; only a quoted label can contain the marker.
function stripComment(line) {
  let quote = false;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '"') { quote = !quote; continue; }
    if (!quote && line[i] === '%' && line[i + 1] === '%') return line.slice(0, i);
  }
  return line;
}

const IDENT = /^"([^"]*)"|^([A-Za-z_][\w-]*)/;
const BLANK = /^[ \t]*/;

// An identifier is a bare word or a quoted string (venn.jison IDENTIFIER / STRING).
function readIdent(text, at) {
  const cursor = at + BLANK.exec(text.slice(at))[0].length;
  const match = IDENT.exec(text.slice(cursor));
  return match ? { id: match[1] ?? match[2], at: cursor + match[0].length } : null;
}

// Keywords are case-insensitive and must be a whole word.
function keywordOf(text) {
  const match = /^[A-Za-z][\w-]*/.exec(text);
  return match ? { word: match[0].toLowerCase(), at: match[0].length } : { word: '', at: 0 };
}

// Comma-separated identifier list (identifierList in the grammar); a following `key:` is not an identifier.
function readIdents(text, at) {
  const ids = [];
  let cursor = at;
  for (;;) {
    const ident = readIdent(text, cursor);
    if (!ident) break;
    if (/^\s*:/.test(text.slice(ident.at))) break;
    ids.push(ident.id);
    const after = ident.at + BLANK.exec(text.slice(ident.at))[0].length;
    if (text[after] !== ',') { cursor = ident.at; break; }
    cursor = after + 1;
  }
  const end = ids.length ? cursor : at;
  return { ids, at: end + BLANK.exec(text.slice(end))[0].length };
}

// `["Label"]` keeps the identifier short; bare brackets `[Label]` are accepted too (BRACKET_LABEL).
function readLabel(text, at) {
  const match = /^\[([^\]]*)\]/.exec(text.slice(at));
  if (!match) return { label: null, at };
  let value = match[1];
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  return { label: value.trim(), at: at + match[0].length };
}

function readSize(text, at) {
  const match = /^:\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))/.exec(text.slice(at));
  return match ? { size: Number(match[1]), at: at + match[0].length } : { size: null, at };
}

function parse(source, info = {}) {
  const lang = info.lang || 'zh';
  const firstLine = Number.isInteger(info.firstLine) ? info.firstLine : 2;
  const headerLine = Number.isInteger(info.headerLine) ? info.headerLine : Math.max(1, firstLine - 1);
  const errors = [];
  const look = presentation({ lang });
  const assetWarnings = new Set();
  const sets = [];
  const unions = [];
  const texts = [];
  const known = new Map();
  let title = '';
  let titleLine = headerLine;
  let scope = null;
  let indentMode = false;

  const fail = (line, zh, en, fixZh, fixEn) => errors.push(issueAt(lang, line, zh, en, fixZh, fixEn));
  const junk = (line) => fail(line, '无法识别这一行', 'Unrecognized line',
    '使用 set、union、text、title 或 style', 'Use set, union, text, title, or style');
  const orphan = (line) => fail(line, 'text 前缺少 set 或 union', 'A text line needs an owning set or union',
    '把 text 缩进到 set/union 下面，或先写集合 id', 'Indent text under a set/union, or name the set first');

  // The header takes no options; Mermaid's grammar has no production for trailing header tokens.
  const params = typeof info.params === 'string' ? info.params.trim() : '';
  if (params) {
    fail(headerLine, `venn-beta 头行不能带内容「${params}」`, `Unexpected text after "venn-beta": ${params}`,
      '把内容写成 set、union 或 text 行', 'Move the text into set, union, or text lines');
  }
  for (const key of Object.keys(info.options || {})) {
    fail(headerLine, `venn-beta 不支持选项「${key}」`, `Unsupported venn-beta option: ${key}`,
      '删除这个选项', 'Remove this option');
  }

  const labelOf = (raw, line) => {
    const normalized = normalizeLabel(raw, { lang, line });
    for (const diagnostic of normalized.diagnostics) {
      const key = `${diagnostic.code}:${diagnostic.message}`;
      if (!assetWarnings.has(key)) { assetWarnings.add(key); errors.push(diagnostic); }
    }
    return { text: normalized.text, icon: normalized.icon };
  };

  const addSet = (id, label, size, line) => {
    if (!id) { junk(line); return false; }
    if (known.has(id)) {
      fail(line, `集合「${id}」重复定义`, `Duplicate set identifier: ${id}`,
        '把同一个集合合并成一行 set', 'Merge the duplicate into a single set line');
      return false;
    }
    const normalized = label ? labelOf(label, line) : { text: '', icon: null };
    sets.push({ id, label: normalized.text, icon: normalized.icon, size: size ?? SIZE_DEFAULT, tone: (sets.length % 6) + 1, line });
    known.set(id, sets.at(-1));
    scope = { ids: [id] };
    return true;
  };

  const addUnion = (ids, label, size, line) => {
    const unique = ids.filter((id, index) => ids.indexOf(id) === index);
    if (unique.length < 2) {
      fail(line, 'union 至少需要两个集合', 'A union needs at least two sets',
        '写成 union A,B 或列更多集合', 'Write union A,B or list more sets');
      return false;
    }
    const unknown = unique.filter((id) => !known.has(id));
    if (unknown.length) {
      fail(line, `union 引用了未定义的集合「${unknown.join('、')}」`, `Unknown set identifier: ${unknown.join(', ')}`,
        '先用 set 声明集合，再写 union', 'Declare each set with set before the union');
      return false;
    }
    const sorted = [...unique].sort();
    const normalized = label ? labelOf(label, line) : { text: '', icon: null };
    unions.push({ ids: sorted, label: normalized.text, icon: normalized.icon, size: size ?? SIZE_DEFAULT / (unique.length ** 2), line });
    scope = { ids: sorted };
    return true;
  };

  const addText = (id, label, ids, line) => {
    const unique = ids.filter((value, index) => ids.indexOf(value) === index);
    if (!unique.length) { orphan(line); return; }
    const normalized = labelOf(label || id, line);
    texts.push({ id, label: normalized.text, icon: normalized.icon, ids: [...unique].sort(), key: [...unique].sort().join('|'), line });
  };

  for (const [index, raw] of String(source ?? '').split('\n').entries()) {
    const line = firstLine + index;
    const body = stripComment(raw).trim();
    if (!body) continue;
    const indented = /^[ \t]/.test(raw);
    // Venn additionally allows style on a comma-separated region (for example style A,B).
    // The shared collector handles all other Mermaid presentation statements.
    const style = /^style\s+/i.exec(body);
    if (style) {
      const list = readIdents(body, style[0].length);
      if (list.ids.length > 1) {
        look.accept(`style ${JSON.stringify([...list.ids].sort().join('|'))} ${body.slice(list.at).trimStart()}`, line);
        continue;
      }
    }
    if (look.accept(body, line)) continue;
    const head = keywordOf(body);
    const rest = body.slice(head.at);

    // An indented `text` line attaches to the most recent set/union and names one node (INDENT_TEXT).
    if (indentMode && indented && head.word === 'text') {
      const node = readIdent(rest, 0);
      const label = readLabel(rest, node ? node.at : 0);
      if (!node || rest.slice(label.at).trim()) { junk(line); continue; }
      if (scope) addText(node.id, label.label, scope.ids, line);
      else orphan(line);
      continue;
    }
    // Any statement that starts at column 0 ends Mermaid's indent mode.
    if (!indented) indentMode = false;

    if (head.word === 'title') {
      const value = rest.trim();
      if (!value) {
        fail(line, 'title 后面缺少标题文字', 'title needs a heading after it',
          '写成 title 标题文字', 'Write title followed by the heading');
        continue;
      }
      // Mermaid keeps the raw remainder (quotes included); KChart strips one pair of quotes.
      title = labelOf(value.replace(/^"(.*)"$/, '$1').trim(), line).text;
      titleLine = line;
      continue;
    }
    if (head.word === 'set') {
      const first = readIdent(rest, 0);
      if (!first) { junk(line); continue; }
      const label = readLabel(rest, first.at);
      const size = readSize(rest, label.at);
      if (rest.slice(size.at).trim()) { junk(line); continue; }
      if (addSet(first.id, label.label, size.size, line)) indentMode = true;
      continue;
    }
    if (head.word === 'union') {
      const list = readIdents(rest, 0);
      const label = readLabel(rest, list.at);
      const size = readSize(rest, label.at);
      if (!list.ids.length || rest.slice(size.at).trim()) { junk(line); continue; }
      if (addUnion(list.ids, label.label, size.size, line)) indentMode = true;
      continue;
    }
    if (head.word === 'text') {
      const list = readIdents(rest, 0);
      const owner = readIdent(rest, list.at);
      const label = readLabel(rest, owner ? owner.at : list.at);
      if (!list.ids.length || rest.slice(label.at).trim()) { junk(line); continue; }
      // `text Shared A,B` scopes to A and B; `text A1["React"]` names node A1 of the current scope.
      if (owner) addText(owner.id, label.label, list.ids, line);
      else addText(list.ids[0], label.label, scope ? scope.ids : [], line);
      continue;
    }
    junk(line);
  }

  errors.push(...look.diagnostics());
  if (!sets.length) {
    fail(firstLine, '文氏图没有任何 set', 'A Venn diagram needs at least one set',
      '至少写一行 set', 'Write at least one set line');
  }
  const attach = (item, id) => ({ ...item, status: look.statusOf(id), link: look.linkOf(id) });
  for (const set of sets) Object.assign(set, attach({}, set.id));
  for (const union of unions) Object.assign(union, attach({}, union.ids.join('|')));
  for (const text of texts) Object.assign(text, attach({}, text.id));
  return { model: { kind: 'venn-beta', title, titleLine, sets, unions, texts }, errors };
}

// --- ring geometry ------------------------------------------------------------------------------

// Clearance of a point: inside every `inside` ring, outside every `outside` ring.
function clearanceAt(x, y, inside, outside) {
  let value = Infinity;
  for (const ring of inside) value = Math.min(value, ring.r - Math.hypot(x - ring.cx, y - ring.cy));
  for (const ring of outside) value = Math.min(value, Math.hypot(x - ring.cx, y - ring.cy) - ring.r);
  return value;
}

// The most central point of a region: maximum clearance from every ring edge bounding it. A coarse-to-fine
// grid keeps symmetric regions on their axis, and the result is a pure function of the ring geometry.
function deepestPoint(inside, outside, rounds = 3, steps = 16) {
  const cx = inside.reduce((sum, ring) => sum + ring.cx, 0) / inside.length;
  const cy = inside.reduce((sum, ring) => sum + ring.cy, 0) / inside.length;
  let best = { x: cx, y: cy, value: clearanceAt(cx, cy, inside, outside) };
  let span = Math.max(...inside.map((ring) => ring.r));
  for (let round = 0; round < rounds; round += 1) {
    const from = best;
    for (let ix = -steps / 2; ix <= steps / 2; ix += 1) {
      for (let iy = -steps / 2; iy <= steps / 2; iy += 1) {
        const x = from.x + (ix * span) / (steps / 2);
        const y = from.y + (iy * span) / (steps / 2);
        const value = clearanceAt(x, y, inside, outside);
        // Ties stay closest to the region centre row, which keeps horizontal regions level.
        if (value > best.value + 1e-9 || (Math.abs(value - best.value) <= 1e-9 && Math.abs(y - cy) < Math.abs(best.y - cy) - 1e-9)) best = { x, y, value };
      }
    }
    span /= steps / 4;
  }
  return best;
}

// Ring radii follow √weight, so the drawn area reads as the declared size. The smallest ring keeps 30 % of
// the largest radius; equal weights therefore give equal rings.
function radiiOf(sets, R) {
  const weights = sets.map((set) => (Number.isFinite(set.size) ? Math.max(0, set.size) : SIZE_DEFAULT));
  const peak = Math.max(0, ...weights);
  return weights.map((weight) => R * (peak > 0 ? Math.max(0.3, Math.sqrt(weight / peak)) : 1));
}

// `spread` is the single positioning parameter: 0 packs the rings together, 1 strings them apart, and the
// search below picks the value that gives every label the most room around its canonical look.
function ringsAt(sets, R, spread) {
  const radii = radiiOf(sets, R);
  const rings = sets.map((set, index) => ({ id: set.id, label: set.label, icon: set.icon, tone: set.tone, status: set.status, link: set.link, line: set.line, r: radii[index], cx: 0, cy: 0 }));
  if (rings.length === 1) return rings;
  if (rings.length === 2) {
    const small = Math.min(radii[0], radii[1]);
    const near = Math.abs(radii[0] - radii[1]) + 0.25 * small;
    const far = radii[0] + radii[1] - 0.1 * small;
    const gap = near + Math.min(1, Math.max(0, spread)) * (far - near);
    rings[0].cx = -gap / 2;
    rings[1].cx = gap / 2;
    return rings;
  }
  // The largest set takes the apex (the last declaration wins a tie); the other two sit at ±120°.
  const order = rings.map((ring, index) => ({ index, r: ring.r })).sort((left, right) => right.r - left.r || right.index - left.index);
  const apex = order[0].index;
  const rest = [0, 1, 2].filter((index) => index !== apex).sort((left, right) => left - right);
  const scale = TRIANGLE_MIN + Math.min(1, Math.max(0, spread)) * (TRIANGLE_MAX - TRIANGLE_MIN);
  const share = scale * (radii.reduce((sum, r) => sum + r, 0) / 3);
  const angle = [];
  angle[apex] = -Math.PI / 2;
  angle[rest[0]] = (5 * Math.PI) / 6;
  angle[rest[1]] = Math.PI / 6;
  rings.forEach((ring, index) => {
    ring.cx = Math.cos(angle[index]) * share;
    ring.cy = Math.sin(angle[index]) * share;
  });
  return rings;
}

// The canonical layout, expressed as the same 0..1 spread scale.
function canonicalSpread(sets, R) {
  if (sets.length <= 1) return 0.5;
  const radii = radiiOf(sets, R);
  if (sets.length === 2) {
    const small = Math.min(radii[0], radii[1]);
    const near = Math.abs(radii[0] - radii[1]) + 0.25 * small;
    const far = radii[0] + radii[1] - 0.1 * small;
    return far > near ? Math.min(1, Math.max(0, (radii[0] + radii[1] - PAIR_SHARE * small - near) / (far - near))) : 0.5;
  }
  return (TRIANGLE_CANON - TRIANGLE_MIN) / (TRIANGLE_MAX - TRIANGLE_MIN);
}

function boundsOf(rings) {
  const left = Math.min(...rings.map((ring) => ring.cx - ring.r));
  const right = Math.max(...rings.map((ring) => ring.cx + ring.r));
  const top = Math.min(...rings.map((ring) => ring.cy - ring.r));
  const bottom = Math.max(...rings.map((ring) => ring.cy + ring.r));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

// Wrap one region's labels and text nodes inside its clearance circle. The wrap width follows the
// clearance, so a bigger ring gets longer lines instead of a smaller font. A single word is never split:
// the widest unbreakable token is the floor, so an over-long label grows the rings or moves to the shelf.
function planBlock(region, measure) {
  const slack = region.kind === 'set' ? SET_CLEAR : UNION_CLEAR;
  const labelFont = region.kind === 'set' ? SET_FONT : UNION_FONT;
  const floorOf = (entries, font) => Math.max(0, ...entries.flatMap(({ text }) => String(text).split(/\s+/).filter(Boolean)
    .map((word) => measure(word, font))));
  const cap = Math.max(48, floorOf(region.labels, labelFont) + 2, floorOf(region.items, ITEM_FONT) + 2, (region.clear - slack) * 2 - 20);
  const rows = (entries, font, status) => entries.flatMap((entry) => wrapText(entry.text, cap, font, measure)
    .map((text) => ({ text, font, icon: entry.icon, link: entry.link, status: entry.status || status })));
  const labels = rows(region.labels, labelFont, region.status);
  const items = rows(region.items, ITEM_FONT, labels.length ? null : region.status);
  const labelH = labels.length * (region.kind === 'set' ? HEAD_LINE : ITEM_LINE);
  const w = Math.max(0, ...[...labels, ...items].map((row) => rowWidth(row, measure)));
  const h = labelH + (labels.length && items.length ? ITEM_GAP : 0) + items.length * ITEM_LINE;
  // Negative room means the whole block must grow or move.
  return { labels, items, labelH, w, h, room: h ? blockClearance(region, w, h) - INK_GAP : Infinity };
}

function rowWidth(row, measure) {
  return measure(row.text, row.font) + (row.icon ? 18 : 0);
}

// For inside rings the farthest rectangle point is a corner; for outside rings the closest
// point is the centre clamped to the rectangle, which need not be a corner or edge midpoint.
function blockClearance(region, w, h) {
  let worst = Infinity;
  for (const ring of region.inside) {
    worst = Math.min(worst, ring.r - Math.hypot(Math.abs(region.x - ring.cx) + w / 2, Math.abs(region.y - ring.cy) + h / 2));
  }
  for (const ring of region.outside) {
    worst = Math.min(worst, Math.hypot(Math.max(0, Math.abs(region.x - ring.cx) - w / 2), Math.max(0, Math.abs(region.y - ring.cy) - h / 2)) - ring.r);
  }
  return worst;
}

function regionList(rings, model) {
  const groups = new Map();
  for (const text of model.texts) {
    const list = groups.get(text.key) || [];
    list.push(text);
    groups.set(text.key, list);
  }
  const regions = [];
  for (const ring of rings) {
    regions.push({
      key: ring.id, kind: 'set', ids: [ring.id], line: ring.line, tone: ring.tone,
      // Mermaid draws the set identifier when no bracket label is given (the reference PNGs show exactly that).
      labels: [{ text: ring.label || ring.id, icon: ring.icon, line: ring.line, link: ring.link }],
      items: (groups.get(ring.id) || []).map((text) => ({ text: text.label, icon: text.icon, link: text.link, status: text.status })),
      texts: groups.get(ring.id) || [],
    });
  }
  const merged = new Map();
  for (const union of model.unions) {
    const key = union.ids.join('|');
    const existing = merged.get(key);
    const labels = union.label || union.icon ? [{ text: union.label, icon: union.icon, line: union.line, link: union.link }] : [];
    if (existing) { existing.labels.push(...labels); continue; }
    const region = {
      key, kind: 'union', ids: union.ids, line: union.line,
      tone: rings.find((ring) => ring.id === union.ids[0])?.tone || 1,
      labels,
      items: (groups.get(key) || []).map((text) => ({ text: text.label, icon: text.icon, link: text.link, status: text.status })),
      status: union.status, link: union.link,
      texts: groups.get(key) || [],
    };
    merged.set(key, region);
    regions.push(region);
  }
  bindRegions(regions, rings);
  return regions;
}

// A region is the inside-set of rings it names minus every other ring: a set label owns the exclusive area,
// a union label the lens or triple region. Rings are rebound on every spread so nothing keeps stale geometry.
function bindRegions(regions, rings) {
  for (const region of regions) {
    region.inside = region.ids.map((id) => rings.find((ring) => ring.id === id)).filter(Boolean);
    region.outside = rings.filter((ring) => !region.inside.includes(ring));
  }
}

// Room left for every region once its own content is placed; positive means everything fits. The deepest
// point uses a coarse search while scanning spreads and the full search for the chosen one.
function roomOf(regions, measure, coarse) {
  let worst = Infinity;
  for (const region of regions) {
    const point = deepestPoint(region.inside, region.outside, coarse ? 2 : 3, coarse ? 10 : 16);
    region.x = point.x;
    region.y = point.y;
    region.clear = point.value;
    region.block = planBlock(region, measure);
    worst = Math.min(worst, region.block.room);
  }
  return worst;
}

// Prefer the spread closest to the canonical look that fits every label; otherwise keep the roomiest one so
// the caller can grow the rings from the best starting point. `regions` always describes the returned rings.
function chooseSpread(ringsFor, regions, measure, preferred) {
  const order = [];
  for (let index = 0; index < SPREADS; index += 1) order.push(index / (SPREADS - 1));
  order.sort((left, right) => Math.abs(left - preferred) - Math.abs(right - preferred) || right - left);
  let best = null;
  for (const spread of order) {
    const rings = ringsFor(spread);
    bindRegions(regions, rings);
    const coarse = roomOf(regions, measure, true);
    const worst = coarse >= 0 ? roomOf(regions, measure, false) : coarse;
    if (worst >= 0) return { rings, worst };
    if (!best || worst > best.worst + 1e-9) best = { spread, worst };
  }
  // Nothing fits at this radius: keep the roomiest spread and let the caller grow the rings.
  const rings = ringsFor(best.spread);
  bindRegions(regions, rings);
  return { rings, worst: roomOf(regions, measure, false) };
}

// --- ring layout --------------------------------------------------------------------------------

// Rows of one region, stacked around its deepest point.
function layoutBlock(region) {
  const block = region.block;
  const top = region.y - block.h / 2;
  const pitch = region.kind === 'set' ? HEAD_LINE : ITEM_LINE;
  region.rows = block.labels.map((row, index) => ({
    ...row, x: region.x, y: top + (index + 0.5) * pitch, anchor: 'middle',
  }));
  const itemTop = top + block.labelH + (block.labels.length && block.items.length ? ITEM_GAP : 0);
  block.items.forEach((row, index) => region.rows.push({
    ...row, x: region.x, anchor: 'middle', y: itemTop + (index + 0.5) * ITEM_LINE,
  }));
}

function planRings(model, { measure, width, lang }) {
  const available = Math.max(240, width - MARGIN * 2);
  const preferred = canonicalSpread(model.sets, 1);
  const unit = boundsOf(ringsAt(model.sets, 1, preferred));
  let R = Math.max(56, Math.min(available / Math.max(1, unit.w), PLOT_H / Math.max(1, unit.h)));
  const regions = regionList(ringsAt(model.sets, R, preferred), model);
  let chosen = null;
  // Growing the radius scales every clearance, so a few passes make room; the scene widens, never the text.
  for (let pass = 0; pass <= MAX_GROWTH; pass += 1) {
    chosen = chooseSpread((spread) => ringsAt(model.sets, R, spread), regions, measure, preferred);
    if (chosen.worst >= 0) break;
    const next = R * GROW;
    if (boundsOf(ringsAt(model.sets, next, preferred)).w > available * 2) break;
    R = next;
  }
  const rings = chosen.rings;
  // Whatever still does not fit leaves its region for the shelf, with a leader back to the region.
  const shelf = [];
  for (const region of regions) {
    if (region.block.room >= 0) continue;
    shelf.push({ region, rows: [...region.block.labels, ...region.block.items] });
  }
  // Text nodes scoped to a combination no set or union declares would vanish; keep them, captioned.
  const claimed = new Set(regions.map((region) => region.key));
  for (const text of model.texts) {
    if (claimed.has(text.key)) continue;
    shelf.push({ region: { x: null, y: null, tone: 1, line: text.line, caption: text.ids.join(' ∩ ') }, rows: [{ text: text.label, font: ITEM_FONT, icon: text.icon, link: text.link, status: text.status }] });
  }
  const notes = [];
  if (shelf.length) {
    notes.push(warning('DIAGRAM_HINT', lang, shelf[0].region.line ?? model.sets[0].line,
      `有 ${shelf.length} 个标签放不进所属区域，已排在图下方并用引线指向该区域`,
      `${shelf.length} label(s) do not fit their region and moved below the plot with a leader`,
      '缩短标签，或减少同一区域的 text', 'Shorten the labels, or use fewer text nodes per region'));
  }
  for (const region of regions) {
    if (region.texts.length <= ITEM_CAP) continue;
    notes.push(warning('DIAGRAM_HINT', lang, region.texts[ITEM_CAP].line,
      `「${region.key}」区域有 ${region.texts.length} 个 text，超过 ${ITEM_CAP} 个后很难阅读`,
      `Region "${region.key}" holds ${region.texts.length} text nodes; more than ${ITEM_CAP} is hard to read`,
      '把说明移到图外，或拆成多张图', 'Move details outside, or split the diagram'));
    break;
  }
  const drawn = regions.filter((region) => region.block.h > 0 && region.block.room >= 0);
  for (const region of drawn) layoutBlock(region);
  return finish({ mode: 'rings', rings, regions: drawn, plot: boundsOf(rings), rows: drawn.flatMap((region) => region.rows), shelf, notes }, model, { measure, width });
}

// --- region grid (four or more sets) ------------------------------------------------------------

// Beyond three rings the readable overlap regions disappear: one tinted panel per set plus one per declared
// union keeps every set, union and text node visible without pretending the overlaps are circles.
function planGrid(model, { measure, width, lang }) {
  const groups = new Map();
  for (const text of model.texts) {
    const list = groups.get(text.key) || [];
    list.push(text);
    groups.set(text.key, list);
  }
  const panels = [];
  for (const set of model.sets) {
    panels.push({
      kind: 'set', key: set.id, tone: set.tone, status: set.status, link: set.link, line: set.line,
      titles: [{ ...set, label: set.label || set.id }], caption: '',
      items: groups.get(set.id) || [],
    });
  }
  const merged = new Map();
  for (const union of model.unions) {
    const key = union.ids.join('|');
    const existing = merged.get(key);
    if (existing) { if (union.label) existing.titles.push(union); continue; }
    const panel = {
      kind: 'union', key, tone: model.sets.find((set) => set.id === union.ids[0])?.tone || 1,
      status: union.status, link: union.link, line: union.line,
      titles: union.label || union.icon ? [union] : [], caption: union.ids.join(' ∩ '),
      items: groups.get(key) || [],
    };
    merged.set(key, panel);
    panels.push(panel);
  }
  const claimed = new Set(panels.map((panel) => panel.key));
  for (const text of model.texts) {
    if (claimed.has(text.key)) continue;
    panels.push({ kind: 'loose', key: text.key, tone: 1, line: text.line, titles: [text], caption: text.ids.join(' ∩ '), items: [] });
  }

  const wrap = (value, font) => wrapText(value, GRID_MIN_W - GRID_PAD * 2, font, (piece, spec) => measure(piece, spec));
  for (const panel of panels) {
    const rows = (entries, font) => entries.flatMap(item => wrap(item.label, font).map((text, index) => ({ text, font, status: item.status, link: item.link, icon: index === 0 ? item.icon : null })));
    panel.header = rows(panel.titles, SET_FONT);
    panel.captionLines = panel.caption ? wrap(panel.caption, ITEM_FONT) : [];
    panel.itemLines = rows(panel.items, ITEM_FONT);
    const widths = [
      ...panel.header.map(row => measure(row.text, row.font) + (row.icon ? 18 : 0)),
      ...panel.captionLines.map((row) => measure(row, ITEM_FONT)),
      ...panel.itemLines.map(row => measure(row.text, row.font) + (row.icon ? 18 : 0)),
    ];
    panel.w = Math.max(GRID_MIN_W, Math.ceil(Math.max(0, ...widths) + GRID_PAD * 2));
    panel.h = GRID_PAD * 2 + panel.header.length * HEAD_LINE
      + (panel.captionLines.length ? 4 + panel.captionLines.length * ITEM_LINE : 0)
      + (panel.itemLines.length ? 6 + panel.itemLines.length * ITEM_LINE : 0);
  }
  const cellW = Math.max(...panels.map((panel) => panel.w));
  const available = Math.max(240, width - MARGIN * 2);
  let cols = Math.min(GRID_COLS, panels.length);
  // Columns only shrink when the panels cannot be read side by side even at twice the frame width.
  while (cols > 1 && cols * cellW + (cols - 1) * GRID_GAP > available * 2) cols -= 1;
  const rowCount = Math.ceil(panels.length / cols);
  const rowHeights = [];
  panels.forEach((panel, index) => {
    panel.column = index % cols;
    panel.row = Math.floor(index / cols);
    rowHeights[panel.row] = Math.max(rowHeights[panel.row] || 0, panel.h);
  });
  const tops = [];
  let cursor = 0;
  for (let row = 0; row < rowCount; row += 1) { tops[row] = cursor; cursor += rowHeights[row] + GRID_GAP; }
  panels.forEach((panel) => {
    panel.w = cellW;
    panel.x = panel.column * (cellW + GRID_GAP);
    panel.y = tops[panel.row];
    panel.rows = [];
    let y = panel.y + GRID_PAD;
    for (const row of panel.header) { panel.rows.push({ ...row, x: panel.x + GRID_PAD, y: y + HEAD_LINE / 2, anchor: 'start' }); y += HEAD_LINE; }
    if (panel.captionLines.length) {
      y += 4;
      for (const row of panel.captionLines) { panel.rows.push({ text: row, font: ITEM_FONT, x: panel.x + GRID_PAD, y: y + ITEM_LINE / 2, anchor: 'start' }); y += ITEM_LINE; }
    }
    if (panel.itemLines.length) {
      y += 6;
      for (const row of panel.itemLines) { panel.rows.push({ ...row, x: panel.x + GRID_PAD, y: y + ITEM_LINE / 2, anchor: 'start' }); y += ITEM_LINE; }
    }
  });
  const notes = [warning('DIAGRAM_HINT', lang, model.sets[0].line,
    `${model.sets.length} 个集合画成圆环后重叠区无法阅读，已改用分区面板`,
    `${model.sets.length} sets would leave unreadable overlaps; drawn as a region grid instead`,
    '集合减到 3 个可获得圆环布局，或接受分区面板', 'Keep three sets for rings, or accept the region grid')];
  const plot = { x: 0, y: 0, w: cols * cellW + (cols - 1) * GRID_GAP, h: cursor - GRID_GAP };
  return finish({ mode: 'grid', panels, plot, rows: panels.flatMap((panel) => panel.rows), shelf: [], notes }, model, { measure, width });
}

// --- shared plan finishing ----------------------------------------------------------------------

// Adds the title, stacks the shelf under the plot and shifts everything into the margin box.
function finish(plan, model, { measure, width }) {
  const titleLines = model.title
    ? wrapText(model.title, Math.max(160, Math.min(width - MARGIN * 2, 480)), TITLE_FONT, (piece, spec) => measure(piece, spec))
    : [];
  const titleH = titleLines.length ? titleLines.length * TITLE_LINE + TITLE_GAP : 0;
  const shelf = [];
  let shelfRight = plan.plot.x + plan.plot.w;
  let shelfBottom = plan.plot.y + plan.plot.h;
  if (plan.shelf.length) {
    const limit = Math.max(plan.plot.w, 240);
    let cursor = plan.plot.x;
    let top = plan.plot.y + plan.plot.h + SHELF_GAP;
    let rowH = 0;
    for (const item of plan.shelf) {
      const caption = item.region.caption ? [{ text: item.region.caption, font: ITEM_FONT, kind: 'caption' }] : [];
      const rows = [...caption, ...item.rows];
      const w = Math.max(0, ...rows.map((row) => rowWidth(row, measure)));
      if (cursor > plan.plot.x && cursor + w > plan.plot.x + limit) { cursor = plan.plot.x; top += rowH + GRID_GAP / 2; rowH = 0; }
      const lines = rows.map((row, index) => ({ ...row, anchor: 'start', x: cursor, y: top + (index + 0.5) * ITEM_LINE }));
      shelf.push({
        lines, tone: item.region.tone,
        from: item.region.x == null ? null : { x: item.region.x, y: item.region.y },
        to: { x: cursor + w / 2, y: top - LEADER },
      });
      shelfBottom = Math.max(shelfBottom, top + rows.length * ITEM_LINE);
      shelfRight = Math.max(shelfRight, cursor + w);
      rowH = Math.max(rowH, rows.length * ITEM_LINE);
      cursor += w + SHELF_PITCH;
    }
  }
  const spanW = Math.max(plan.plot.x + plan.plot.w, shelfRight) - plan.plot.x;
  const contentW = Math.max(spanW, ...titleLines.map((row) => measure(row, TITLE_FONT)));
  // The plot box is the content's own bounding box, which may start at negative coordinates (a raised apex).
  const dx = MARGIN + (contentW - spanW) / 2 - plan.plot.x;
  const dy = MARGIN + titleH - plan.plot.y;
  const height = Math.ceil(shelfBottom - plan.plot.y + titleH + MARGIN * 2);
  const finalWidth = Math.ceil(contentW + MARGIN * 2);

  for (const ring of plan.rings || []) { ring.cx += dx; ring.cy += dy; }
  for (const panel of plan.panels || []) { panel.x += dx; panel.y += dy; }
  for (const row of plan.rows) { row.x += dx; row.y += dy; }
  for (const region of plan.regions || []) {
    region.x += dx;
    region.y += dy;
  }
  for (const item of shelf) {
    for (const line of item.lines) { line.x += dx; line.y += dy; }
    if (item.from) item.from = { x: item.from.x + dx, y: item.from.y + dy };
    item.to = { x: item.to.x + dx, y: item.to.y + dy };
  }
  return {
    width: finalWidth,
    height,
    mode: plan.mode,
    title: titleLines.length ? { lines: titleLines, x: MARGIN + contentW / 2, top: MARGIN + TITLE_LINE / 2 } : null,
    rings: plan.rings || [],
    regions: plan.regions || [],
    panels: plan.panels || [],
    rows: plan.rows,
    shelf,
    notes: plan.notes,
    anchor: { x: MARGIN + contentW / 2, y: MARGIN + titleH + plan.plot.h / 2 },
  };
}

function layout(model, options = {}) {
  const measure = options.measure || fallbackMeasure;
  const width = Math.max(1, Number(options.width) || 800);
  const lang = options.lang || 'zh';
  if (!model.sets.length) return { width, height: 0, errors: [] };
  const plan = model.sets.length <= RING_MAX
    ? planRings(model, { measure, width, lang })
    : planGrid(model, { measure, width, lang });
  const errors = [...plan.notes];
  const parts = model.sets.length + model.unions.length + model.texts.length;
  if (parts > PARTS_HINT) {
    errors.push(warning('LARGE_DIAGRAM', lang, model.sets[0].line,
      `文氏图有 ${parts} 个元素，建议拆分`, `The Venn diagram has ${parts} parts; consider splitting it`,
      '按集合拆成多张图', 'Split the diagram by set'));
  } else if (plan.width > width * 2) {
    errors.push(warning('LARGE_DIAGRAM', lang, model.sets[0].line,
      `文氏图需要 ${plan.width}px 宽，超过图框两倍`, `The Venn diagram needs ${plan.width}px, more than twice the frame`,
      '加宽图框，或拆分文氏图', 'Widen the frame, or split the diagram'));
  }
  return { ...plan, errors };
}

// --- scene --------------------------------------------------------------------------------------

function scene(plan, ctx) {
  const look = appearanceOf(ctx);
  const paper = ctx.color('bg');
  const tone = (index) => ctx.frameTone(ctx.color(`tone${((index - 1) % 6) + 1}`));
  const row = (item, background) => {
    let ink = item.status ? ctx.textColor(look[item.status]) : item.kind === 'caption' ? look.fg3 : item.font === SET_FONT ? look.fg1 : look.fg2;
    if (background && contrast(ink, background) < TEXT_CONTRAST) {
      let target = ctx.textOn(background);
      // A mid-tone custom theme can exhaust the contrast available on its preferred side.
      if (contrast(target, background) < TEXT_CONTRAST) {
        target = contrast('#000000', background) >= TEXT_CONTRAST ? '#000000' : '#ffffff';
      }
      ink = pushContrast(ink, target, background, TEXT_CONTRAST);
    }
    const children = [ctx.text(item.x + (item.icon ? (item.anchor === 'middle' ? 9 : 18) : 0), item.y, item.text, {
      anchor: item.anchor, size: item.font.size, weight: item.font.weight, 'dominant-baseline': 'central', fill: ink,
    })];
    if (item.icon) {
      const x = item.anchor === 'middle' ? item.x - ctx.measure(item.text, item.font.size, item.font.weight) / 2 - 3 : item.x + 6;
      children.unshift(labelIcon(ctx, item.icon, x, item.y, 12, ink));
    }
    return item.link ? ctx.link(item.link.href, children, item.link) : ctx.el('g', {}, children);
  };
  const children = [];
  if (plan.mode === 'rings') {
    const fills = plan.rings.map((ring) => ring.status ? ctx.frameTone(look[ring.status]) : tone(ring.tone));
    for (const [index, ring] of plan.rings.entries()) {
      children.push(ctx.circle(ring.cx, ring.cy, ring.r, { fill: fills[index], 'fill-opacity': RING_OPACITY }));
    }
    for (const [index, ring] of plan.rings.entries()) {
      children.push(ctx.circle(ring.cx, ring.cy, ring.r, {
        fill: 'none', stroke: fills[index], 'stroke-width': RING_STROKE,
        meta: { kind: 'node', id: ring.id, label: ring.id },
      }));
    }
    for (const region of plan.regions) {
      const background = plan.rings.reduce((under, ring, index) => region.ids.includes(ring.id)
        ? ctx.mix(under, fills[index], RING_OPACITY) : under, paper);
      for (const item of region.rows) children.push(row(item, background));
    }
    for (const item of plan.shelf) {
      if (item.from) {
        children.push(ctx.line(item.from.x, item.from.y, item.to.x, item.to.y, {
          stroke: ctx.tint(paper, tone(item.tone), 0.55), 'stroke-width': 1, 'stroke-dasharray': '3 3',
        }));
      }
      for (const line of item.lines) children.push(row(line, paper));
    }
  } else {
    for (const panel of plan.panels) {
      const color = panel.status ? ctx.frameTone(look[panel.status]) : tone(panel.tone);
      children.push(ctx.rect(panel.x, panel.y, panel.w, panel.h, {
        rx: look.radius,
        fill: ctx.tint(paper, color, panel.kind === 'set' ? 0.07 : 0.04),
        stroke: ctx.tint(paper, color, 0.45),
        'stroke-width': 1,
        ...(panel.kind === 'set' ? {} : { 'stroke-dasharray': '5 4' }),
        meta: { kind: panel.kind === 'set' ? 'node' : 'frame', id: panel.key, label: panel.key },
      }));
      for (const item of panel.rows) children.push(row(item));
    }
  }
  if (plan.title) {
    plan.title.lines.forEach((line, index) => children.push(ctx.text(plan.title.x, plan.title.top + index * TITLE_LINE, line, {
      anchor: 'middle', size: TITLE_FONT.size, weight: TITLE_FONT.weight, fill: look.fg1, 'dominant-baseline': 'central',
    })));
  }
  return {
    width: plan.width,
    height: plan.height,
    title: plan.title ? plan.title.lines.join(' ') : undefined,
    children,
    anchor: plan.anchor,
  };
}

export const implementations = { 'venn-beta': { acceptsPresentation: true, parse, layout, scene } };
