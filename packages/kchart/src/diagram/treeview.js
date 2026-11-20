import { FONT, appearance, error, maxWidthOf, textBlock, warning, wrapText } from './support.js';
import { normalizeLabel } from './label.js';
import { presentation } from './presentation.js';
import { resolveIconRef } from '../core/icons.js';
import { labelIcon } from './tree-family-icon.js';

const honoredConfig = ['rowIndent', 'paddingX', 'paddingY', 'lineThickness', 'showIcons', 'filenameIcons', 'extensionIcons'].map(key => `treeView.${key}`);
const clamp = (value, fallback, min, max) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

const BRANCH = /^([ \t│┃]*)(?:[├└┣┗])[─━]*[ \t]*/;
const ANNOTATION = /[ \t]+(?=:::[ \t]*[A-Za-z_]|icon\(|##)/;
const LEADING_EMOJI = /^(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F|[0-9#*]\uFE0F?\u20E3)/u;
const MARGIN = 24, STEP = 24;
const columns = str => str.replaceAll('\t', '    ').length;

function parse(body, { firstLine = 2, headerLine = 1, lang, params, config }) {
  const errors = [], rows = [{ id: 'root', label: '/', directory: true, depth: 0, description: '' }];
  const look = presentation({ lang }), settings = config?.treeView ?? {}, seen = new Set();
  const addIssue = issue => { if (!seen.has(issue.message)) { seen.add(issue.message); errors.push(issue); } };
  const normalize = (value, line) => {
    const result = normalizeLabel(value, { lang, line });
    result.diagnostics.forEach(addIssue);
    return result;
  };
  const lines = String(body).split('\n').map((raw, index) => ({ raw, line: firstLine + index })).filter(({ raw, line }) => raw.trim() && !raw.trimStart().startsWith('%%') && !look.accept(raw, line));
  const unit = lines.map(({ raw }) => raw.match(BRANCH)).find(match => match && columns(match[1]))?.[1];
  const box = lines.some(({ raw }) => BRANCH.test(raw));
  const stack = [];
  let title;
  const fail = (line, zh, en) => errors.push(error(lang, line, zh, en, '检查树节点声明', 'Check the tree node declaration'));
  if (params?.trim()) fail(headerLine, '树视图表头不接受参数', 'Tree view header takes no parameters');
  for (const { raw, line } of lines) {
    const text = raw.trim();
    const heading = text.match(/^title(?:\s*:\s*|\s+)(.*)/i);
    if (heading) { title = normalize(heading[1], line).text; continue; }
    const prefix = box ? raw.match(BRANCH) : null;
    if (box && /^[\s│┃]+$/.test(raw)) continue;
    if (box && !prefix && /^[ \t│┃]/.test(raw)) {
      fail(line, '缩进缺少树线前缀', 'Unexpected indentation without box-drawing characters');
      continue;
    }
    if (prefix && !raw.slice(prefix[0].length).trim()) {
      fail(line, '树线后缺少文件或目录名', 'Empty node: expected a filename or directory name after the box-drawing prefix');
      continue;
    }
    const indent = prefix ? Math.round(columns(prefix[1]) / (unit ? columns(unit) : 4)) + 1 : columns(raw.match(/^[ \t]*/)[0]);
    let value = prefix ? raw.slice(prefix[0].length).trim() : text;
    const quoted = value.match(/^(?:"([^"]*)"|'([^']*)')/);
    const boundary = value.search(ANNOTATION);
    const label = quoted ? quoted[1] ?? quoted[2] : (boundary < 0 ? value : value.slice(0, boundary)).trimEnd();
    value = quoted ? value.slice(quoted[0].length).trimStart() : boundary < 0 ? '' : value.slice(boundary).trimStart();
    let description = '', highlight = false, icon;
    const name = normalize(label, line);
    const directory = name.text.endsWith('/');
    const textLabel = directory && name.text !== '/' ? name.text.slice(0, -1) : name.text;
    while (value) {
      const cls = value.match(/^:::[ \t]*([A-Za-z_][\w-]*)/);
      const ico = value.match(/^icon\(([\w-]*(?::[\w-]+)?)\)/);
      if (value.startsWith('##')) { description = normalize(value.slice(2), line).text; break; }
      if (cls) {
        if (cls[1] === 'highlight') highlight = true;
        else look.addClasses(textLabel, [cls[1]], line);
      } else if (ico) {
        icon = ico[1] || 'none';
      } else { fail(line, '无法识别树节点注解', 'Unrecognized tree node annotation'); break; }
      value = value.slice((cls || ico)[0].length).trimStart();
    }
    while (stack.length && indent <= stack.at(-1).indent) stack.pop();
    const ext = /\.[^.\/]+$/.exec(textLabel)?.[0];
    const mapped = settings.filenameIcons?.[textLabel] ?? (!directory && ext ? settings.extensionIcons?.[ext] : undefined);
    const ref = icon ?? (name.icon ? undefined : typeof mapped === 'string' ? mapped : undefined);
    const defaultGlyph = LEADING_EMOJI.test(textLabel) ? null : resolveIconRef(directory ? 'tabler:folder' : 'tabler:file');
    let glyph = name.icon ?? defaultGlyph;
    if (ref === 'none') glyph = null;
    else if (ref) {
      glyph = resolveIconRef(ref);
      if (!glyph) {
        addIssue(warning('IGNORED_ASSET', lang, line, `未知图标 ${ref}`, `Unknown icon ${ref}`, '使用内置或已注册的图标', 'Use a built-in or registered icon'));
        glyph = defaultGlyph;
      }
    }
    const row = { id: `row-${line}`, parent: stack.at(-1)?.id ?? 'root', depth: stack.length + 1, indent, line,
      directory, label: textLabel, description, highlight, icon, glyph: settings.showIcons === false ? null : glyph };
    rows.push(row);
    stack.push(row);
    if (rows.length > 2001) { fail(line, '树节点最多支持 2000 个', 'Tree view supports at most 2,000 entries'); break; }
  }
  rows[0].glyph = settings.showIcons === false ? null : resolveIconRef('tabler:folder');
  rows.forEach((row, index) => {
    row.status = look.statusOf(row.label);
    row.link = look.linkOf(row.label);
    if (index) row.edgeStatus = look.edgeStatusOf(index - 1);
  });
  return { model: { rows, title, headerLine, settings }, errors: [...errors, ...look.diagnostics()] };
}

function layout(model, { width, measure, lang }) {
  const available = Math.max(120, width - 2 * MARGIN);
  const { settings } = model;
  const step = clamp(clamp(settings.rowIndent, 10, 4, 90) + clamp(settings.paddingX, 14, 4, 24), STEP, 12, 96);
  const inset = clamp(settings.paddingY, 4, 4, 20);
  const lineThickness = clamp(settings.lineThickness, 1, 1, 3);
  let rows, end;
  for (const cap of [220, 190, 160, 140, 120]) {
    rows = model.rows.map(row => {
      const font = { ...FONT.body, weight: row.directory ? 650 : 400 };
      const lines = wrapText(row.label, cap, font, measure);
      const notes = row.description ? wrapText(row.description, 240, FONT.label, measure) : [];
      const x = MARGIN + step * row.depth;
      const textX = x + (row.glyph ? 20 : 0);
      return { ...row, font, lines, notes, x, textX, labelEnd: textX + maxWidthOf(lines, font, measure) };
    });
    end = Math.max(...rows.map(row => row.labelEnd));
    if (end + MARGIN <= width) break;
  }
  const noteWidth = Math.max(0, ...rows.map(row => maxWidthOf(row.notes, FONT.label, measure)));
  const inline = !noteWidth || end + 16 + noteWidth + MARGIN <= width + 240;
  const title = model.title ? wrapText(model.title, available, FONT.title, measure) : [];
  let y = MARGIN + (title.length ? title.length * 19 + 12 : 0);
  let right = Math.max(end, MARGIN + maxWidthOf(title, FONT.title, measure));
  for (const row of rows) {
    const labelH = row.lines.length * 17;
    const noteH = row.notes.length * 16;
    row.top = y;
    row.h = Math.max(24, (inline ? Math.max(labelH, noteH) : labelH + (noteH ? noteH + 4 : 0)) + inset * 2);
    row.labelY = inline ? y + row.h / 2 : y + inset + labelH / 2;
    row.noteY = inline ? row.labelY : y + inset + 4 + labelH + noteH / 2;
    row.noteX = inline ? end + 16 : row.x;
    if (noteH) right = Math.max(right, row.noteX + maxWidthOf(row.notes, FONT.label, measure));
    y += row.h;
  }
  const naturalWidth = Math.ceil(right + MARGIN + 8);
  const errors = rows.length > 61 || naturalWidth > width * 2
    ? [warning('LARGE_DIAGRAM', lang, model.headerLine, '树视图较大', 'This tree view is large', '考虑拆分为多个树视图', 'Consider splitting it into smaller trees')] : [];
  return { rows, title, width: naturalWidth, height: y + MARGIN, right, lineThickness, errors };
}

function scene(plan, ctx) {
  const A = appearance(ctx), { rows, right } = plan;
  const byId = new Map(rows.map(row => [row.id, row]));
  const trunk = new Map(), edges = [], labels = [];
  for (const row of rows) {
    const parent = byId.get(row.parent);
    if (parent) {
      const x = parent.x + 4, y = trunk.get(parent.id) ?? (parent.top + parent.h);
      const armY = row.labelY;
      edges.push(ctx.path(`M${x} ${y} V${armY - 2} Q${x} ${armY} ${x + 2} ${armY} H${row.x - 5}`, {
        fill: 'none', stroke: row.edgeStatus ? ctx.frameTone(A[row.edgeStatus]) : A.fg4, 'stroke-width': plan.lineThickness,
        meta: { kind: 'edge', from: parent.id, to: row.id },
      }));
      trunk.set(parent.id, armY);
    }
    const x = row.x - 3, y = row.top + 1, h = row.h - 2;
    const tone = A[row.status] ?? (row.highlight ? A.warn : null);
    const content = [ctx.rect(x, y, (tone ? right + 8 : row.labelEnd + 3) - x, h, {
      fill: tone ? ctx.tint(A.bg, tone, .12) : 'none',
      ...(tone ? { stroke: ctx.frameTone(tone), rx: 3 } : {}), meta: { kind: 'node', id: row.id },
    })];
    if (row.glyph) content.push(labelIcon(ctx, row.glyph, row.x + 7, row.labelY, 14, A.fg3));
    content.push(textBlock(ctx, { x: row.textX, y: row.labelY, lines: row.lines, font: row.font, anchor: 'start', lineHeight: 17, fill: row.parent ? A.fg1 : ctx.color('muted') }));
    labels.push(...(row.link ? [ctx.link(row.link.href, content, row.link)] : content));
    if (row.notes.length) labels.push(textBlock(ctx, { x: row.noteX, y: row.noteY, lines: row.notes, font: FONT.label, anchor: 'start', lineHeight: 16, fill: ctx.color('muted') }));
  }
  if (plan.title.length) labels.push(textBlock(ctx, { x: MARGIN, y: MARGIN + plan.title.length * 19 / 2, lines: plan.title, font: FONT.title, anchor: 'start', lineHeight: 19 }));
  return { width: plan.width, height: plan.height, children: [...edges, ...labels] };
}

export const implementations = { 'treeView-beta': { optionMode: 'raw', acceptsPresentation: true, honoredConfig, parse, layout, scene } };
