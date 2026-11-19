/* 分层架构 / 无层能力分组；同层共用网格行数，文字不折行。 */
KChart.define('diagram/layers', ({ 'diagram/support': u }) => {
  const { FONT, snap } = u;
  const LIMITS = { layers: 8, groups: 6, items: 30, labelWidth: 208 };
  const GAP = 12, PAD = 12, ITEM_GAP = 8, ITEM_H = 32, DB_H = 56, HEADER = 40;
  const issue = (lang, line, zh, en, fixZh = '拆成两张图，或把说明移到图外', fixEn = 'Split into two diagrams, or move descriptions outside the diagram') => u.error(lang, line, zh, en, fixZh, fixEn);

  function parse(source, info) {
    const ctx = { ...info, lang: info.lang, firstLine: info.firstLine, options: info.options || {} };
    const { items: roots, errors } = u.parseIndented(source, ctx);
    const { lang, options } = ctx;
    for (const key of Object.keys(options)) errors.push(issue(lang, ctx.firstLine - 1, `layers 不支持选项「${key}」`, `Unsupported layers option: ${key}`, '移除这个选项', 'Remove this option'));
    const isGroup = (node) => /[:：]/.test(node.text.split('|')[0]) || (!node.text.includes('|') && node.children.some((child) => /^[^:：>]+>/.test(child.text)));
    const modes = roots.map(isGroup);
    if (modes.some(Boolean) && modes.some((mode) => !mode)) errors.push(issue(lang, roots[modes.findIndex((mode) => mode !== modes[0])].line, '顶层不能混用层与分组', 'Do not mix layers and groups at the top level', '顶层全部写成层，或全部写成分组', 'Use only layers or only groups at the top level'));
    function capabilities(text, line) {
      const result = text.split(/[,，]/).map((part) => {
        const label = part.trim(), mark = label.match(/^([+~=])\s*/)?.[1] || '';
        if (!label || !label.replace(/^[+~=]\s*/, '')) errors.push(issue(lang, line, '能力项名称不能为空', 'Capability labels cannot be empty', '删除空项或补上名称', 'Remove the empty item or add a label'));
        return { label: mark ? `${mark} ${label.replace(/^[+~=]\s*/, '')}` : label, mark, tone: ({ '+': 'new', '~': 'info', '=': 'ok' })[mark] || '', line };
      });
      return result;
    }
    function group(node) {
      const parts = node.text.split(/[:：]/);
      const header = parts.shift().trim();
      const flag = header.match(/\s*\{(db|ext)\}$/)?.[1] || '';
      const title = header.replace(/\s*\{(db|ext)\}$/, '').trim();
      if (!title || /[{}|>]/.test(title)) errors.push(issue(lang, node.line, '分组名称或标志无效', 'Invalid group name or flag', '使用「名称 {db}: 项, 项」或普通名称', 'Use "Name {db}: item, item" or a plain name'));
      const result = { title, flag, line: node.line, items: [], categories: [] };
      if (parts.length) {
        result.items = capabilities(parts.join(':'), node.line);
        if (node.children.length) errors.push(issue(lang, node.children[0].line, '行内能力项不能再带子项', 'Inline capabilities cannot have children', '改成分类行写法，或删除子项', 'Use category rows, or remove the children'));
      } else {
        if (!node.children.length) errors.push(issue(lang, node.line, '分组中没有能力项', 'Group has no capabilities', '在名称后加「: 项, 项」，或添加分类行', 'Add ": item, item" or category rows'));
        for (const child of node.children) {
          const match = child.text.match(/^(.+?)\s*>\s*(.+)$/);
          if (!match || child.children.length) {
            errors.push(issue(lang, child.children[0]?.line || child.line, '分类行写法无效', 'Invalid category row', '使用「- 分类 > 项, 项」，不嵌套子项', 'Use "- Category > item, item" without nesting'));
            continue;
          }
          const row = { label: match[1].trim(), line: child.line, items: capabilities(match[2], child.line) };
          result.categories.push(row);
          result.items.push(...row.items);
        }
      }
      if (result.items.length > LIMITS.items) errors.push(issue(lang, node.line, `每组最多 ${LIMITS.items} 项`, `At most ${LIMITS.items} capabilities per group`));
      return result;
    }
    const layered = !modes.some(Boolean);
    const layers = layered ? roots.map((node) => {
      const [title, ...desc] = node.text.split('|').map((s) => s.trim());
      if (!title || /[{}>]/.test(title)) errors.push(issue(lang, node.line, '层名称无效', 'Invalid layer name', '使用「- 层名 | 说明」', 'Use "- Layer | description"'));
      if (!node.children.length) errors.push(issue(lang, node.line, '层中没有分组', 'Layer has no groups', '给这一层添加分组和能力项', 'Add groups and capabilities to this layer'));
      if (node.children.length > LIMITS.groups) errors.push(issue(lang, node.line, `每层最多 ${LIMITS.groups} 组`, `At most ${LIMITS.groups} groups per layer`));
      return { title, description: desc.join(' | '), line: node.line, groups: node.children.map(group) };
    }) : [];
    const groups = layered ? [] : roots.map(group);
    if (!roots.length) errors.push(issue(lang, ctx.firstLine, '图中没有条目', 'Diagram is empty', '添加层、分组与能力项', 'Add layers, groups and capabilities'));
    if (layered && layers.length > LIMITS.layers) errors.push(issue(lang, roots[LIMITS.layers].line, `最多 ${LIMITS.layers} 层`, `At most ${LIMITS.layers} layers`));
    return { model: { type: 'layers', layered, layers, groups }, errors };
  }

  function layout(model, { measure, width, lang }) {
    const errors = [], groups = [], layers = [], nodes = [];
    const all = model.layered ? model.layers.flatMap((l) => l.groups) : model.groups;
    for (const group of all) for (const item of group.items) {
      if (measure(item.label.replace(/^[+~=]\s*/, ''), FONT.body) > LIMITS.labelWidth) errors.push(issue(lang, item.line, `能力项「${item.label}」过长`, `Capability label is too long: ${item.label}`, '把说明移到图外，名称缩短至约 16 个汉字', 'Move descriptions outside; shorten the label to about 16 CJK characters'));
    }
    if (errors.length) return { width, height: 0, errors };
    const cellW = (g, pad) => snap(Math.max(g.flag === 'db' ? 80 : 64, ...g.items.map((item) => measure(item.label, FONT.body) + pad)));
    const rowsOf = (g, rows) => g.flag === 'db' ? Math.max(1, Math.round((rows * ITEM_H + (rows - 1) * ITEM_GAP) / (DB_H + ITEM_GAP))) : rows;
    const colsOf = (g, rows) => Math.max(1, Math.ceil(g.items.length / rowsOf(g, rows)));
    const categoryLabelW = (g) => snap(Math.max(0, ...g.categories.map((row) => measure(row.label, FONT.body))) + 16);
    function groupW(g, rows, pad) {
      let inside;
      if (g.categories.length) {
        inside = categoryLabelW(g) + ITEM_GAP + Math.max(...g.categories.map((row) => row.items.reduce((n, item) => n + snap(Math.max(64, measure(item.label, FONT.body) + pad)), 0) + ITEM_GAP * (row.items.length - 1)));
      } else {
        const cols = colsOf(g, rows);
        inside = cols * cellW(g, pad) + ITEM_GAP * (cols - 1);
      }
      return snap(Math.max(inside, measure(g.title, FONT.title)) + PAD * 2);
    }
    const groupH = (g, rows) => HEADER + PAD + (g.categories.length ? g.categories.length * (g.flag === 'db' ? DB_H : ITEM_H) + (g.categories.length - 1) * ITEM_GAP : rowsOf(g, rows) * (g.flag === 'db' ? DB_H : ITEM_H) + (rowsOf(g, rows) - 1) * ITEM_GAP);
    const total = (gs, rows, pad) => gs.reduce((n, g) => n + groupW(g, rows, pad), 0) + GAP * (gs.length - 1);
    // 余宽按理想宽度分配；4px 网格向下取整，尾组吸收余数。
    function distribute(mins, ideals, space) {
      const extra = Math.max(0, space - mins.reduce((a, b) => a + b, 0));
      const sum = ideals.reduce((a, b) => a + b, 0);
      const ws = mins.map((min, i) => min + Math.floor(extra * ideals[i] / sum / 4) * 4);
      ws[ws.length - 1] += space - ws.reduce((a, b) => a + b, 0);
      return ws;
    }
    let id = 0;
    function placeGroup(g, x, y, w, h, rows, color) {
      const placed = { ...g, x, y, w, h, rows, color, id: `group-${id++}`, nodes: [], categoryNodes: [] };
      groups.push(placed);
      const makeNode = (item, nx, ny, nw, nh, category = false) => {
        const node = { ...item, x: nx, y: ny, w: nw, h: nh, shape: !category && g.flag === 'db' ? 'db' : 'rect', group: placed.id, category, color };
        nodes.push(node);
        (category ? placed.categoryNodes : placed.nodes).push(node);
      };
      const inside = w - PAD * 2;
      if (g.categories.length) {
        const labelW = categoryLabelW(g), ih = g.flag === 'db' ? DB_H : ITEM_H;
        g.categories.forEach((row, ri) => {
          const ny = y + HEADER + ri * (ih + ITEM_GAP);
          makeNode({ label: row.label, line: row.line }, x + PAD, ny, labelW, ih, true);
          const mins = row.items.map((item) => snap(Math.max(64, measure(item.label, FONT.body) + 16)));
          const ws = distribute(mins, mins.map((n) => n + 8), inside - labelW - ITEM_GAP * row.items.length);
          let nx = x + PAD + labelW + ITEM_GAP;
          row.items.forEach((item, i) => { makeNode(item, nx, ny, ws[i], ih); nx += ws[i] + ITEM_GAP; });
        });
      } else {
        const cols = colsOf(g, rows), ih = g.flag === 'db' ? DB_H : ITEM_H;
        const countRows = Math.ceil(g.items.length / cols);
        // 分组标题下的网格统一从顶部排起：同排各组首行对齐，多出的高度留在底部。
        const top = y + HEADER;
        for (let ri = 0; ri < countRows; ri += 1) {
          const items = g.items.slice(ri * cols, (ri + 1) * cols);
          const db = g.flag === 'db';
          const count = db ? cols : items.length;
          const cw = Math.floor((inside - (count - 1) * ITEM_GAP) / count / 4) * 4;
          let nx = x + PAD + (db ? Math.floor((inside - (items.length * cw + (items.length - 1) * ITEM_GAP)) / 8) * 4 : 0);
          items.forEach((item, ci) => {
            const nw = !db && ci === items.length - 1 ? x + w - PAD - nx : cw;
            makeNode(item, nx, top + ri * (ih + ITEM_GAP), nw, ih);
            nx += cw + ITEM_GAP;
          });
        }
      }
      return placed;
    }
    let actualWidth = Math.floor(width), y = 4;
    if (model.layered) {
      // 左栏宽度同时计入层名与说明：说明先按自身长度要求宽度（上有上限），再按词换行。
      const DESC_MAX = 120;
      const titleNeed = (l) => measure(l.title, FONT.title) + 16;
      const descNeed = (l) => (l.description ? Math.min(DESC_MAX, measure(l.description, FONT.label) + 8) : 0);
      const labelWidth = snap(Math.max(80, ...model.layers.map((l) => Math.max(titleNeed(l), descNeed(l)))));
      const nameWidth = Math.min(labelWidth, 160);
      if (labelWidth > 160 && model.layers.some((l) => titleNeed(l) > 160)) errors.push(issue(lang, model.layers.find((l) => titleNeed(l) > 160).line, '层名称过长', 'Layer name is too long', '缩短层名，把说明放在「|」之后', 'Shorten the name; put descriptions after "|"'));
      const left = 4 + nameWidth + GAP;
      // 先求每层单列所需宽度，保证窄屏返回固有最小宽度，而不是缩小字号。
      for (const layer of model.layers) actualWidth = Math.max(actualWidth, left + total(layer.groups, LIMITS.items * 2, 16) + 4);
      const available = actualWidth - left - 4;
      for (const layer of model.layers) {
        let rows = 1;
        while (rows < LIMITS.items * 2 && total(layer.groups, rows, 16) > available) rows += 1;
        const mins = layer.groups.map((g) => groupW(g, rows, 16)), ideals = layer.groups.map((g) => groupW(g, rows, 24));
        const widths = distribute(mins, ideals, available - GAP * (layer.groups.length - 1));
        const descriptionLines = layer.description ? u.wrapText(layer.description, nameWidth - 8, FONT.label, measure) : [];
        const h = Math.max(...layer.groups.map((g) => groupH(g, rows)), 32 + descriptionLines.length * 16);
        const color = layers.length % 6 + 1;
        layers.push({ ...layer, x: 4, y, w: nameWidth, h, rows, color, descriptionLines });
        let x = left;
        layer.groups.forEach((g, i) => { placeGroup(g, x, y, widths[i], h, rows, color); x += widths[i] + GAP; });
        y += h + 16;
      }
    } else {
      // 分类行不拆行；普通组先尝试一行，只有自身放不下时才增加网格行数。
      for (const g of model.groups) actualWidth = Math.max(actualWidth, groupW(g, LIMITS.items * 2, 16) + 8);
      const available = actualWidth - 8;
      const rowCounts = new Map(model.groups.map((g) => {
        let rows = 1;
        while (!g.categories.length && rows < LIMITS.items * 2 && groupW(g, rows, 16) > available) rows += 1;
        return [g, rows];
      }));
      const rowCount = (g) => rowCounts.get(g);
      const lines = [];
      let current = [];
      for (const g of model.groups) {
        if (current.length && current.reduce((s, item) => s + groupW(item, rowCount(item), 16), 0) + GAP * current.length + groupW(g, rowCount(g), 16) > available) { lines.push(current); current = []; }
        current.push(g);
      }
      if (current.length) lines.push(current);
      for (const line of lines) {
        const mins = line.map((g) => groupW(g, rowCount(g), 16));
        const ws = distribute(mins, line.map((g) => groupW(g, rowCount(g), 24)), available - GAP * (line.length - 1));
        const h = Math.max(...line.map((g) => groupH(g, rowCount(g))));
        let x = 4;
        line.forEach((g, i) => { placeGroup(g, x, y, ws[i], h, rowCount(g), model.groups.indexOf(g) % 6 + 1); x += ws[i] + GAP; });
        y += h + 16;
      }
    }
    return { type: 'layers', width: actualWidth, height: y - 12, layers, groups, nodes, errors };
  }

  function scene(geometry, ctx) {
    const children = [], theme = u.appearance(ctx);
    const groupColor = (index) => ctx.frameTone(ctx.color(`tone${index}`));
    const text = (x, y, value, font, fill) => ctx.text(x, y, value, { size: font.size, weight: font.weight, fill, anchor: 'middle', 'dominant-baseline': 'central' });
    const capabilityText = (node, y) => {
      const mark = node.tone && node.label.match(/^([+~=])\s/);
      if (!mark) return text(node.x + node.w / 2, y, node.label, FONT.body, theme.fg1);
      const center = node.x + node.w / 2, total = ctx.measure(node.label, FONT.body.size, FONT.body.weight);
      const start = center - total / 2, markWidth = ctx.measure(mark[1], FONT.body.size, FONT.body.weight);
      return ctx.el('g', {}, [
        ctx.text(start, y, mark[1], { size: FONT.body.size, weight: FONT.body.weight, fill: theme[node.tone], anchor: 'start', 'dominant-baseline': 'central' }),
        ctx.text(start + markWidth, y, node.label.slice(1), { size: FONT.body.size, weight: FONT.body.weight, fill: theme.fg1, anchor: 'start', 'dominant-baseline': 'central' }),
      ]);
    };
    for (const group of geometry.groups) {
      const color = groupColor(group.color), fill = ctx.tint(theme.bg, color, .07), stroke = ctx.tint(theme.bg, color, .45);
      children.push(ctx.rect(group.x, group.y, group.w, group.h, { rx: theme.radius, fill, stroke, 'stroke-width': 1, 'stroke-dasharray': group.flag === 'ext' ? '5 4' : undefined, meta: { kind: 'layers', group: group.id, role: 'group' } }));
      children.push(text(group.x + group.w / 2, group.y + 20, group.title, FONT.title, theme.fg1));
    }
    for (const layer of geometry.layers) {
      const center = layer.y + layer.h / 2, descH = layer.descriptionLines.length * 16;
      const blockH = 20 + (descH ? descH + 4 : 0), top = center - blockH / 2;
      children.push(text(layer.x + layer.w / 2, top + 10, layer.title, FONT.title, theme.fg1));
      layer.descriptionLines.forEach((line, i) => children.push(text(layer.x + layer.w / 2, top + 20 + 4 + (i + .5) * 16, line, FONT.label, theme.fg2)));
    }
    for (const node of geometry.nodes) {
      // 语义色（新增、风险等）保持原色相，只有主题序列色按主题 tint 变浅。
      const color = node.tone ? theme[node.tone] : groupColor(node.color), shade = node.tone ? ctx.mix : ctx.tint;
      const fill = node.category ? shade(theme.bg, color, .08) : theme.node;
      const stroke = shade(theme.bg, color, .4);
      const common = { fill, stroke, 'stroke-width': 1, 'stroke-dasharray': node.category ? '5 4' : undefined, meta: { kind: 'layers', group: node.group, line: node.line, role: node.category ? 'category' : 'capability' } };
      if (node.shape === 'db') {
        const { x, y, w, h } = node;
        children.push(ctx.path(`M${x} ${y + 8} a${w / 2} 8 0 0 1 ${w} 0 V${y + h - 8} a${w / 2} 8 0 0 1 ${-w} 0 Z`, { ...common, meta: { ...common.meta, shape: 'database' } }));
        children.push(ctx.path(`M${x} ${y + 8} a${w / 2} 8 0 0 0 ${w} 0`, { fill: 'none', stroke, 'stroke-width': 1, meta: { ...common.meta, role: 'database-rim' } }));
      } else children.push(ctx.rect(node.x, node.y, node.w, node.h, { rx: theme.smallRadius, ...common }));
      children.push(capabilityText(node, node.y + node.h / 2 + (node.shape === 'db' ? 4 : 0)));
    }
    return { width: geometry.width, height: geometry.height, children };
  }

  return { implementations: { layers: { parse, layout, scene } }, limits: LIMITS };
});
