/* Mermaid journey diagrams: scored tasks grouped into themed section bands, drawn as a compact row model. */

import { resolveIconRef } from '../core/icons.js';
import { FONT, appearance as appearanceOf, error, isEn, warning } from './support.js';
import { normalizeLabel } from './label.js';
import { presentation } from './presentation.js';

const TASK_ADVISORY = 60;
const TASK_CAP = 2000;
// Journey owns its Mermaid config section: the four keys below are honored, everything else is
// reported once (colors belong to the theme, the box metrics of Mermaid's grid have no KChart meaning).
const honoredConfig = ['journey'];
const HONORED = new Map([['taskfontsize', 'taskFontSize'], ['maxlabelwidth', 'maxLabelWidth'], ['titlefontsize', 'titleFontSize'], ['leftmargin', 'leftMargin']]);
const COLOR_KEYS = new Set(['actorcolours', 'sectionfills', 'sectioncolours', 'titlecolor']);
const configKey = value => String(value).toLowerCase().replace(/[-_]/g, '');
const FACE_R = 9;
const ICON_SIZE = 14;
const ICON_GAP = 4;
const MAX_SCORE = 5;
const LAYOUT = { labelX: 12, labelPad: 12, plotGap: 6, right: 16, band: 10, bottom: 16, row: 48, chipR: 4, chipGap: 6 };
LAYOUT.chip = LAYOUT.chipR * 2 + LAYOUT.chipGap;

const issue = (lang, line, zh, en, fixZh, fixEn) => error(lang, line, zh, en, fixZh, fixEn);
// CSS lengths as Mermaid writes them; `ex` follows the spec's 4ex → 16px reading.
const pixels = (value, fallback, min, max) => {
  if (value == null || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  const match = /^([+-]?\d*\.?\d+)\s*(px|pt|ex|em|rem)?$/i.exec(String(value).trim());
  if (!match) return fallback;
  const factor = { px: 1, pt: 4 / 3, ex: 4, em: 12, rem: 12 }[(match[2] || 'px').toLowerCase()];
  return Math.min(max, Math.max(min, Number(match[1]) * factor));
};

// Mermaid's journey lexer ends a line at `%%…` and at `#…`; entity codes (#9829;) stay text.
// Whole-line comments are already blanked by the source layer.
function uncomment(value) {
  let quote = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '%' && value[i + 1] === '%') return value.slice(0, i).trimEnd();
    if (ch === '#' && !/^#[\w]+;/.test(value.slice(i))) return value.slice(0, i).trimEnd();
  }
  return value;
}
// `;` terminates a journey statement, but an entity code such as `#35;` is a single character.
const hasStraySemicolon = value => value.replace(/(?:&#?|#)[\w]+;/g, '').includes(';');

function readConfig(info, lang, line, errors) {
  const source = info?.config?.journey;
  const settings = {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) return settings;
  const colors = [], ignored = [];
  for (const [key, value] of Object.entries(source)) {
    const name = configKey(key);
    if (HONORED.has(name)) { settings[HONORED.get(name)] = value; continue; }
    if (COLOR_KEYS.has(name)) colors.push(key);
    else ignored.push(key);
  }
  if (colors.length) errors.push(warning('IGNORED_STYLE', lang, line,
    `旅程图颜色由主题决定，已忽略配置：${colors.join(', ')}`, `Journey colors come from the theme; ignored: ${colors.join(', ')}`,
    '改用主题调色板', 'Use the theme palette'));
  if (ignored.length) errors.push(warning('IGNORED_CONFIG', lang, line,
    `旅程图不支持这些配置，已忽略：${ignored.join(', ')}`, `Ignored journey config: ${ignored.join(', ')}`,
    '移除这些配置项', 'Remove these config keys'));
  return settings;
}

function parse(body, info = {}) {
  const lang = info.lang || 'zh';
  const firstLine = Number.isInteger(info.firstLine) ? info.firstLine : 2;
  const errors = [];
  if (body.length > 200000) return { model: null, errors: [issue(lang, firstLine,
    '旅程图源码超过 200000 字符', 'Journey source exceeds 200,000 characters', '拆分旅程图', 'Split the journey')] };
  const raw = readConfig(info, lang, info.headerLine || Math.max(1, firstLine - 1), errors);
  const config = {
    taskFontSize: pixels(raw.taskFontSize, FONT.body.size, 12, 20),
    maxLabelWidth: pixels(raw.maxLabelWidth, 360, 120, 640),
    titleFontSize: pixels(raw.titleFontSize, FONT.title.size, 12, 28),
    leftMargin: pixels(raw.leftMargin, 0, 0, 480),
  };
  const tasks = [], sections = [{ name: '', tasks: [] }];
  const look = presentation({ lang });
  const assetWarnings = new Set();
  const addAssetWarnings = diagnostics => diagnostics.forEach(diagnostic => {
    if (diagnostic.code !== 'IGNORED_ASSET' || !assetWarnings.has(diagnostic.message)) {
      errors.push(diagnostic);
      if (diagnostic.code === 'IGNORED_ASSET') assetWarnings.add(diagnostic.message);
    }
  });
  const cleanLabel = (raw, line) => {
    let explicit;
    const consume = ref => { explicit ??= ref; return ''; };
    const source = raw.replace(/::icon\(([^)]+)\)/gi, (_, ref) => consume(ref.trim()))
      .replace(/(?<![\w:/.-])(?:logos|mdi|tabler|simple-icons):[a-z\d-]+/gi, consume);
    const result = normalizeLabel(source, { lang, line });
    addAssetWarnings(result.diagnostics);
    return { text: result.text, icon: (explicit ? explicitIcon(explicit, line) : null) || result.icon };
  };
  const explicitIcon = (ref, line) => {
    const icon = resolveIconRef(ref);
    if (!icon) addAssetWarnings([warning('IGNORED_ASSET', lang, line, `未知图标 ${ref}`, `Unknown icon ${ref}`, '使用内置图标', 'Use a built-in icon')]);
    return icon;
  };
  let title = info.title || '', titleLine = info.headerLine || Math.max(1, firstLine - 1), decimalWarned = false, overflow = false;
  const ignoredOptions = Object.keys(info.options || {});
  if (ignoredOptions.length) {
    errors.push(warning('IGNORED_CONFIG', lang, info.headerLine || Math.max(1, firstLine - 1),
      `旅程图标题行不接受选项，已忽略：${ignoredOptions.join(', ')}`, `Journey header options are ignored: ${ignoredOptions.join(', ')}`,
      '只保留 journey 关键字', 'Keep only the journey keyword'));
  }
  const lines = String(body ?? '').replace(/\r\n?/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = firstLine + index;
    const raw = lines[index].trim();
    if (look.accept(raw, line)) continue;
    const text = uncomment(raw).trim();
    if (!text || text.startsWith('%%')) continue;
    if (hasStraySemicolon(text)) {
      errors.push(issue(lang, line, '分号不能用于分隔旅程图语句', 'Semicolons cannot separate journey statements', '每行只写一条语句', 'Write one statement per line'));
      continue;
    }
    let match;
    if ((match = /^title(?:\s*:|\s+)(.*)$/i.exec(text))) { title = match[1].trim(); titleLine = line; continue; }
    if (/^title$/i.test(text)) continue;
    if (/^section\b/i.test(text)) {
      const name = /^section\s+(.+)$/i.exec(text);
      if (!name || !name[1].trim()) {
        errors.push(issue(lang, line, '分组名不能为空', 'A section name must be non-empty', '写成「section 名称」', 'Write "section name"'));
        continue;
      }
      const section = cleanLabel(name[1].trim(), line);
      sections.push({ name: section.text, icon: section.icon, tasks: [], line });
      continue;
    }
    const names = [];
    const statement = text.replace(/:::([\w-]+)/g, (_, name) => { names.push(name); return ''; });
    const colon = [...statement.matchAll(/::icon\([^)]+\)|(?<![\w:/.-])(?:fa[bsrlk]?|logos|mdi|tabler|simple-icons):[a-z\d-]+|(:)/gi)].find(match => match[1])?.index;
    const name = colon == null ? '' : statement.slice(0, colon).trim();
    if (!name) {
      errors.push(issue(lang, line, '旅程任务需要写成「任务名: 评分: 参与者」', 'A journey task reads "task name: score: actors"', '在冒号前写任务名', 'Write the task name before the colon'));
      continue;
    }
    const [, scoreText, cast = ''] = /^\s*([^:]*?)(?:\s*:\s*(.*))?$/.exec(statement.slice(colon + 1));
    const score = scoreText.trim() ? Number(scoreText) : NaN;
    const actorLabels = cast.split(',').map(actor => cleanLabel(actor.trim(), line));
    const actors = [...new Set(actorLabels.map(actor => actor.text).filter(Boolean))];
    if (!Number.isFinite(score)) {
      errors.push(issue(lang, line, `评分「${scoreText}」不是数字`, `Score "${scoreText}" is not a number`, '用 1–5 的整数评分', 'Use a whole score from 1 to 5'));
      continue;
    }
    if (score < 1 || score > 5) {
      errors.push(issue(lang, line, `评分 ${score} 超出 1–5 的范围`, `Score ${score} is outside 1–5`, '把评分改为 1 到 5', 'Use a score from 1 to 5'));
      continue;
    }
    if (!Number.isInteger(score) && !decimalWarned) {
      decimalWarned = true;
      errors.push(warning('DIAGRAM_HINT', lang, line,
        `评分 ${score} 不是整数，已按原值绘制`, `Score ${score} is not whole; drawn as written`, '使用 1–5 的整数评分', 'Use whole scores from 1 to 5'));
    }
    if (tasks.length >= TASK_CAP) {
      if (!overflow) {
        overflow = true;
        errors.push(issue(lang, line, `旅程图最多 ${TASK_CAP} 个任务`, `A journey can contain at most ${TASK_CAP} tasks`, '把旅程拆成两张图', 'Split the journey into two diagrams'));
      }
      continue;
    }
    const label = cleanLabel(name, line);
    const id = `task:${tasks.length}`;
    if (names.length) look.addClasses(id, names, line);
    const task = { id, name: label.text, icon: label.icon,
      score, actors, actorLabels, line };
    tasks.push(task); sections.at(-1).tasks.push(task);
  }
  const normalizedTitle = cleanLabel(title, titleLine);
  title = normalizedTitle.text;
  info.title = title;
  if (!tasks.length && !errors.some(item => item.severity !== 'warning')) {
    errors.push(issue(lang, firstLine, '旅程图中没有任务', 'Journey has no tasks', '添加「任务名: 评分: 参与者」', 'Add "task name: score: actors"'));
  }
  // Actors keep first-appearance order: chips, legend colors and tones all follow it.
  const actors = [...new Set(tasks.flatMap(task => task.actors))];
  const actorIcons = new Map(), actorLinks = new Map();
  for (const task of tasks) for (const actor of task.actorLabels) if (actor.text) {
    if (actor.icon && !actorIcons.has(actor.text)) actorIcons.set(actor.text, actor.icon);
    if (!actorLinks.has(actor.text)) actorLinks.set(actor.text, look.linkOf(actor.text));
  }
  for (const task of tasks) {
    task.status = look.statusOf(task.id);
    task.link = look.linkOf(task.id);
  }
  for (const section of sections) {
    section.status = look.statusOf(section.name);
    section.link = look.linkOf(section.name);
  }
  errors.push(...look.diagnostics());
  return { model: { type: 'journey', title, titleIcon: normalizedTitle.icon, titleLink: look.linkOf(title), tasks, sections, actors,
    actorIcons: Object.fromEntries(actorIcons), actorLinks: Object.fromEntries(actorLinks),
    actorStatuses: Object.fromEntries(actors.map(actor => [actor, look.statusOf(actor)])),
    config }, errors };
}

function drawIcon(ctx, icon, x, y, size = ICON_SIZE, color = ctx.color('fg')) {
  if (!icon) return null;
  const [vx, vy, w, h] = icon.viewBox.split(/\s+/).map(Number), scale = size / Math.max(w, h);
  const stroke = icon.set === 'tabler';
  return ctx.el('g', { transform: `translate(${x + (size - w * scale) / 2} ${y + (size - h * scale) / 2}) scale(${scale}) translate(${-vx} ${-vy})`,
    fill: stroke ? 'none' : color, stroke: stroke ? color : 'none', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
  icon.elements.map(({ tag, attrs }) => ctx.shape(tag, attrs)));
}

function layout(model, options = {}) {
  const { width = 800, ctx, renderOptions = {}, compact, embedHeading } = options;
  if (!ctx) throw new TypeError('journey layout needs a theme context');
  const look = appearanceOf(ctx);
  const measure = options.measure || ((value, font) => ctx.measure(value, font.size, font.weight));
  const paper = ctx.color('bg'), accent = ctx.color('accent'), grid = ctx.color('grid');
  const ink = ctx.color('fg'), muted = ctx.color('muted');
  const config = model.config || {};
  const bodyFont = { size: config.taskFontSize || FONT.body.size, weight: FONT.body.weight };
  const labelFont = { size: FONT.label.size, weight: FONT.label.weight };
  const scoreCaption = isEn(ctx.lang) ? 'Score' : '评分';
  const titleSize = config.titleFontSize || FONT.title.size;
  const maxLabelWidth = config.maxLabelWidth || 360;
  const { tasks, actors } = model, groups = model.sections.filter(g => g.name || g.icon || g.tasks.length);
  const actorIndex = new Map(actors.map((actor, index) => [actor, index]));
  const linked = (link, children) => link ? [ctx.link(link.href, children, link)] : children;
  const iconSlot = icon => icon ? ICON_SIZE + ICON_GAP : 0;
  const children = [], errors = [];
  const font = (size, weight) => ({ size, weight });
  const widthOf = (value, style) => measure(value, style);

  // Actor chips and the legend share one tone per actor, fixed by first appearance.
  const toneOf = name => {
    const index = actorIndex.get(name);
    const status = model.actorStatuses?.[name];
    return ctx.tint(paper, status ? ctx.design[status] : ctx.color(`tone${index % 6 + 1}`), .8);
  };

  // 1. Text metrics: task names wrap to maxLabelWidth, the label column grows to fit them and the chips.
  const names = new Map(tasks.map(task => [task, ctx.wrap(task.name, Math.max(40, maxLabelWidth - iconSlot(task.icon)), bodyFont.size, bodyFont.weight)]));
  const chipsOf = task => (task.actors.length ? (task.actors.length - 1) * LAYOUT.chip + LAYOUT.chipR * 2 : 0);
  const labelWidth = Math.max(0, ...tasks.map(task => iconSlot(task.icon) + Math.max(0, ...names.get(task).map(line => widthOf(line, bodyFont))) + (task.actors.length ? 10 + chipsOf(task) : 0)));
  const sectionFont = font(FONT.body.size, 600);
  const sectionWidth = Math.max(0, ...groups.flatMap(group => group.name.split('\n').map((line, index) => widthOf(line, sectionFont) + (index === 0 ? iconSlot(group.icon) : 0))));
  const pitch = bodyFont.size + 5;
  const left = Math.max(config.leftMargin || 0, LAYOUT.labelX + Math.max(labelWidth, sectionWidth, widthOf(scoreCaption, labelFont)) + LAYOUT.labelPad + FACE_R + LAYOUT.plotGap);
  // A five-stop scale needs room for a legible step; the scene widens (the host scrolls) instead of shrinking text.
  const plotW = compact ? 140 : Math.max(140, width - left - LAYOUT.right);
  const x0 = left, x1 = left + plotW, step = plotW / (MAX_SCORE - 1);
  const sceneWidth = Math.ceil(Math.max(compact ? 0 : width, x1 + LAYOUT.right));

  // 2. Top band: optional in-scene title, the actor legend, then the numbered 1–5 scale.
  const inSceneTitle = Boolean(model.title) && !renderOptions?.frame && !embedHeading;
  if (inSceneTitle) {
    const titleText = ctx.text(LAYOUT.labelX + iconSlot(model.titleIcon), titleSize + 12, model.title, { size: titleSize, weight: 600, fill: ink });
    const titleParts = [...(model.titleIcon ? [drawIcon(ctx, model.titleIcon, LAYOUT.labelX, titleSize + 12 - ICON_SIZE / 2)] : []), titleText];
    children.push(...linked(model.titleLink, [ctx.el('g', {}, titleParts)]));
  }
  let cursor = inSceneTitle ? 12 + titleSize + 18 : 16;
  const legendWidth = Math.max(120, x1 - LAYOUT.labelX);
  const legendRows = [];
  let row = [], used = 0, rowHeight = 0;
  for (const name of actors) {
    const lines = ctx.wrap(name, Math.max(40, legendWidth - 13 - iconSlot(model.actorIcons?.[name])), labelFont.size, labelFont.weight);
    const itemWidth = 13 + iconSlot(model.actorIcons?.[name]) + Math.max(0, ...lines.map(line => widthOf(line, labelFont)));
    if (row.length && used + itemWidth > legendWidth) { legendRows.push({ items: row, height: rowHeight }); row = []; used = 0; rowHeight = 0; }
    row.push({ name, lines, width: itemWidth });
    used += itemWidth + 14;
    rowHeight = Math.max(rowHeight, lines.length * 15);
  }
  if (row.length) legendRows.push({ items: row, height: rowHeight });
  for (const legend of legendRows) {
    let x = LAYOUT.labelX;
    for (const item of legend.items) {
      const icon = model.actorIcons?.[item.name], slot = iconSlot(icon);
      const marker = ctx.titled(ctx.circle(x + LAYOUT.chipR, cursor + 8, LAYOUT.chipR, { fill: toneOf(item.name), stroke: paper, 'stroke-width': 1 }), item.name);
      children.push(...linked(model.actorLinks?.[item.name], [marker]));
      if (icon) children.push(drawIcon(ctx, icon, x + 13, cursor + 1));
      item.lines.forEach((text, i) => children.push(...linked(model.actorLinks?.[item.name], [ctx.text(x + 13 + slot, cursor + 8 + i * 15, text, { ...labelFont, fill: muted, 'dominant-baseline': 'middle' })])));
      x += item.width + slot + 14;
    }
    cursor += legend.height + (legendRows.length > 1 ? 4 : 0);
  }
  if (legendRows.length) cursor += 10;
  const scaleY = cursor + 8;
  children.push(ctx.text(LAYOUT.labelX, scaleY, scoreCaption, { ...labelFont, fill: muted, 'dominant-baseline': 'middle' }));
  for (let score = 1; score <= MAX_SCORE; score += 1) {
    children.push(ctx.text(x0 + (score - 1) * step, scaleY, String(score), { ...labelFont, fill: muted, anchor: 'middle', 'dominant-baseline': 'middle' }));
  }
  cursor = scaleY + 14;

  // 3. Section bands: one themed band behind each group of rows, the name on its own header line.
  const bands = [];
  for (const [index, group] of groups.entries()) {
    const sectionLines = group.name || group.icon ? group.name.split('\n') : [];
    const bandY = cursor, headerH = sectionLines.length ? 10 + 18 * sectionLines.length : 0;
    let y = bandY + headerH;
    const rows = group.tasks.map(task => {
      const lines = names.get(task);
      const height = Math.max(LAYOUT.row, lines.length * pitch + 24);
      const entry = { task, lines, y, height, mid: y + height / 2 };
      y += height;
      return entry;
    });
    bands.push({ group, index, y: bandY, height: y - bandY, sectionLines, rows });
    cursor = y + LAYOUT.band;
  }
  const contentBottom = bands.length ? cursor - LAYOUT.band : cursor;

  // Bands sit under every other mark so row lines and faces stay crisp.
  for (const band of bands) {
    if (!band.group.name) continue;
    const sectionTone = band.group.status ? ctx.design[band.group.status] : ctx.color(`tone${band.index % 6 + 1}`);
    children.push(ctx.rect(8, band.y, x1 + LAYOUT.labelPad - 8, band.height, {
      rx: look.radius, fill: ctx.tint(paper, sectionTone, .06),
      meta: { kind: 'frame', id: `section:${band.index}`, ...(band.group.status ? { status: band.group.status } : {}) },
    }));
  }

  // 4. Rows: name and chips in the label column, a row rule, and the face at its score position.
  for (const band of bands) {
    band.sectionLines.forEach((line, i) => {
      const iconSlotWidth = i === 0 ? iconSlot(band.group.icon) : 0;
      const text = ctx.text(LAYOUT.labelX + iconSlotWidth, band.y + 15 + i * 18, line,
        { ...sectionFont, fill: muted, 'dominant-baseline': 'middle' });
      const parts = [...(i === 0 && band.group.icon ? [drawIcon(ctx, band.group.icon, LAYOUT.labelX, band.y + 8)] : []), text];
      children.push(...linked(band.group.link, parts));
    });
    for (const { task, lines, mid } of band.rows) {
      const taskIconSlot = iconSlot(task.icon);
      if (task.icon) children.push(drawIcon(ctx, task.icon, LAYOUT.labelX, mid - ICON_SIZE / 2));
      lines.forEach((text, i) => children.push(...linked(task.link, [ctx.text(LAYOUT.labelX + taskIconSlot, mid + (i - (lines.length - 1) / 2) * pitch, text,
        { ...bodyFont, fill: ink, 'dominant-baseline': 'middle' })])));
      if (task.actors.length) {
        const start = LAYOUT.labelX + taskIconSlot + Math.max(0, ...lines.map(line => widthOf(line, bodyFont))) + 10 + LAYOUT.chipR;
        task.actors.forEach((name, i) => {
          const marker = ctx.titled(ctx.circle(start + i * LAYOUT.chip, mid, LAYOUT.chipR,
            { fill: toneOf(name), stroke: paper, 'stroke-width': 1 }), name);
          children.push(...linked(model.actorLinks?.[name], [marker]));
        });
      }
      children.push(ctx.line(x0, mid, x1, mid, { stroke: grid, 'stroke-width': 1 }));
      const faceX = x0 + (task.score - 1) * step;
      const taskTone = task.status ? ctx.design[task.status] : accent;
      const face = ctx.circle(faceX, mid, FACE_R, { fill: ctx.tint(paper, taskTone, .06), stroke: taskTone, 'stroke-width': 1.4,
        role: 'img', 'aria-label': `${task.name}: ${scoreCaption} ${task.score}/${MAX_SCORE}`,
        meta: { kind: 'node', id: task.id, ...(task.status ? { status: task.status } : {}) } });
      children.push(...linked(task.link, [face]));
      for (const eye of [-3, 3]) children.push(ctx.circle(faceX + eye, mid - 2.5, 1.2, { fill: muted }));
      const mouth = task.score > 3 ? `M${faceX - 4} ${mid + 2} Q${faceX} ${mid + 7} ${faceX + 4} ${mid + 2}`
        : task.score < 3 ? `M${faceX - 4} ${mid + 5.5} Q${faceX} ${mid + .5} ${faceX + 4} ${mid + 5.5}`
          : `M${faceX - 4} ${mid + 3.5} L${faceX + 4} ${mid + 3.5}`;
      children.push(ctx.path(mouth, { fill: 'none', stroke: accent, 'stroke-width': 1.4, 'stroke-linecap': 'round' }));
    }
  }

  const height = Math.ceil(Math.max(160, contentBottom + LAYOUT.bottom));
  if (tasks.length > TASK_ADVISORY) {
    errors.push(warning('LARGE_DIAGRAM', options.lang || ctx.lang || 'zh', tasks[TASK_ADVISORY].line,
      `旅程图有 ${tasks.length} 个任务，建议拆分`, `The journey has ${tasks.length} tasks; consider splitting it`,
      '按阶段拆成两张旅程图', 'Split the journey by stage'));
  } else if (sceneWidth > width * 2) {
    errors.push(warning('LARGE_DIAGRAM', options.lang || ctx.lang || 'zh', 1,
      '旅程图比给定宽度宽很多', 'The journey is much wider than the requested width', '缩小任务名或拆分旅程图', 'Shorten task names or split the journey'));
  }
  const scene = {
    width: sceneWidth, height, children,
    ...(model.title ? { title: model.title } : {}),
    ...((renderOptions?.frame || embedHeading) && model.title ? { heading: model.title } : {}),
  };
  return { width: sceneWidth, height, scene, errors };
}

const implementations = { journey: { parse, layout, honoredConfig, acceptsPresentation: true } };

export { implementations };
