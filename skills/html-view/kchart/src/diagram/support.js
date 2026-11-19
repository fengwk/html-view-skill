KChart.define('diagram/support', ({ 'core/text': text, 'core/theme': { statusMarks } }) => {
  const FONT = Object.freeze({ title: { size: 14, weight: 600 }, body: { size: 13, weight: 400 }, label: { size: 12, weight: 400 } });
  const DIRECTIONS = ['TB', 'BT', 'LR', 'RL'];
  const isEn = lang => /^en\b/i.test(lang || '');
  const message = (lang, zh, en) => isEn(lang) && en ? en : zh;
  const error = (lang, line, zh, en, fixZh, fixEn, column = 1) => ({
    line, column, message: message(lang, zh, en), fix: message(lang, fixZh, fixEn),
  });
  const snap = n => Math.ceil(n / 4) * 4;
  const measureOf = ctx => (value, font = FONT.body) => ctx.measure(value, font.size, font.weight);
  const fallbackMeasure = (value, font = FONT.body) => text.fallbackMeasure(value, font.size, font.weight);
  const maxWidthOf = (lines, font, measure) => Math.max(0, ...lines.map(line => measure(line, font)));
  const wrapText = (value, width, font, measure, options) => text.wrapText(value, width, font, measure, options);

  // 标签只解释公开支持的换行和实体；其它字符由共享 SVG 序列化器作文本转义。
  function labelText(raw) {
    return String(raw ?? '').replace(/<br\s*\/?>/gi, '\n')
      .replace(/&(lt|gt|quot|#39|nbsp|amp);/g, (_, key) => ({ lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ', amp: '&' })[key]);
  }

  function parseIndented(source, { lang, firstLine = 2, bullet = true } = {}) {
    const items = [], errors = [], stack = [], indents = [];
    for (const [index, raw] of String(source).split('\n').entries()) {
      if (!raw.trim() || raw.trimStart().startsWith('%%')) continue;
      const line = firstLine + index;
      if (/^[ \t]*\t/.test(raw)) {
        errors.push(error(lang, line, '缩进不能使用 Tab', 'Tabs are not allowed in indentation', '把 Tab 换成空格', 'Replace tabs with spaces'));
        continue;
      }
      const indent = raw.match(/^ */)[0].length;
      let value = raw.slice(indent).trimEnd();
      if (bullet) {
        if (!/^-\s+\S/.test(value)) {
          errors.push(error(lang, line, '列表项需要以「- 」开头', 'Expected a list item starting with "- "', '在名称前加「- 」', 'Add "- " before the label', indent + 1));
          continue;
        }
        value = value.replace(/^-\s+/, '');
      }
      while (stack.length && indent <= stack.at(-1).indent) stack.pop();
      const depth = stack.length;
      indents[depth] ??= indent;
      if (indents[depth] !== indent) {
        errors.push(error(lang, line, '同级条目的缩进不一致', 'Inconsistent indentation at the same level', `把本行缩进改为 ${indents[depth]} 个空格`, `Indent this line with ${indents[depth]} spaces`, indent + 1));
        continue;
      }
      const item = { text: value, line, indent, children: [] };
      (stack.length ? stack.at(-1).children : items).push(item);
      stack.push(item);
    }
    return { items, errors };
  }

  // 保留旧结构图各主题的圆角与轻表面，不再从宿主样式表取色。
  const presets = {
    claude: [10, 6, .10, true], paper: [6, 4, .09, true], obsidian: [8, 6, .11],
    tokyo: [4, 3, .13], kanagawa: [2, 2, .12], terminal: [0, 0, .12],
    cloudmusic: [12, 8, .08, true],
  };
  function appearance(ctx) {
    const t = ctx.design;
    const [radius, smallRadius, soft, pageNodes] = presets[t.id] || [6, 4, .13];
    return { ...t, radius, smallRadius, soft, node: pageNodes ? t.bg : t.surface2 };
  }

  // 每行是独立的可测量文字图元；坐标 y 表示整块的垂直中心。
  function textBlock(ctx, { x, y, lines, font = FONT.body, anchor = 'middle', lineHeight = 20, fill = ctx.design.fg1, meta }) {
    const rows = lines || [];
    const children = rows.map((line, index) => ctx.text(x, y + (index - (rows.length - 1) / 2) * lineHeight, line, {
      anchor, size: font.size, weight: font.weight, fill, 'dominant-baseline': 'central',
    }));
    return { ...ctx.el('g', {}, children), ...(meta ? { meta } : {}) };
  }

  return { FONT, DIRECTIONS, statusMarks, isEn, message, error, snap, measureOf, fallbackMeasure, maxWidthOf, wrapText, labelText, parseIndented, appearance, textBlock };
});
