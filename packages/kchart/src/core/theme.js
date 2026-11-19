KChart.define('core/theme', ({ 'core/color': color }) => {
  const { isHex, contrast, deltaE2000, simulateCvd } = color;
  const DEFAULT_THEME = 'claude';
  const FONT_FAMILY = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", "Microsoft YaHei", sans-serif';
  const statusMarks = Object.freeze({ new: '+', info: '~', ok: '=', warn: '!', danger: '×', ext: '↗' });
  const textKeys = ['fg1', 'fg2', 'fg3', 'fg4'];
  const statusKeys = Object.keys(statusMarks);
  const backgrounds = ['bg', 'surface', 'surface2'];
  const colorKeys = [...backgrounds, 'line', 'line2', ...textKeys, 'accent', ...statusKeys];
  const optionalColors = ['frameInk', 'tint'];
  const labels = ['name', 'en', 'desc'];
  const snapshotKeys = ['id', 'scheme', 'fontFamily', 'tones', ...colorKeys, ...optionalColors, ...labels, 'style', 'diagram'];
  const configKeys = [...snapshotKeys, 'extends', 'order'];
  const snapshots = new WeakSet();
  const idPattern = /^[a-z][a-z0-9-]{0,47}$/;
  const reservedId = (id) => /^(?:custom-|ui-)/.test(id);
  const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const ranges = (min, max) => (value) => Number.isFinite(value) && value >= min && value <= max;
  const oneOf = (...choices) => (value) => choices.includes(value);
  const textRoles = oneOf(...textKeys, 'accent', ...statusKeys, ...Array.from({ length: 6 }, (_, i) => `tone${i + 1}`));
  // Only local family names, not CSS expressions, quoted escapes, or URLs.
  const localFonts = (value) => typeof value === 'string' && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value)
    && value.split(',').every((part) => /^(?:[\p{L}\p{M}\p{N}_-][\p{L}\p{M}\p{N} _-]*|"[\p{L}\p{M}\p{N} &_-]+"|'[\p{L}\p{M}\p{N} &_-]+')$/u.test(part.replace(/^ +| +$/g, '')));
  const diagramFields = {
    radius: ranges(0, 24), smallRadius: ranges(0, 24), soft: ranges(0, 0.25), nodeBackground: oneOf(...backgrounds),
  };
  const styleFields = {
    ...diagramFields,
    blockBackground: oneOf(...backgrounds, 'transparent'), codeBackground: oneOf(...backgrounds, 'node'),
    displayFont: (value) => value === 'sans' || localFonts(value), displayWeight: (value) => Number.isInteger(value) && ranges(100, 900)(value),
    numberFont: oneOf('sans', 'mono'), numberStyle: oneOf('decimal', 'decimal-leading-zero'), numberColor: textRoles, listMarker: textRoles,
  };
  const defaultStyle = {
    radius: 6, smallRadius: 4, soft: 0.13, nodeBackground: 'surface2', blockBackground: 'surface', codeBackground: 'node',
    displayFont: 'sans', displayWeight: 600, numberFont: 'sans', numberStyle: 'decimal', numberColor: 'fg4', listMarker: 'fg4',
  };
  function checkKeys(value, allowed, path) {
    if (!isRecord(value)) throw new TypeError(`${path} 必须是对象`);
    for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError(`未知主题字段 ${path}.${key}`);
  }
  function checkStyle(value, fields, path) {
    checkKeys(value, Object.keys(fields), path);
    for (const [key, item] of Object.entries(value)) if (!fields[key](item)) throw new TypeError(`主题 ${path}.${key} 取值无效`);
  }
  const pick = (object, keys) => Object.fromEntries(keys.filter((key) => Object.hasOwn(object, key)).map((key) => [key, object[key]]));
  const frozen = (key, value) => {
    if (key === 'tones') return Object.freeze([...value]);
    if (key === 'tint') return Object.freeze({ hue: value.hue, chroma: value.chroma });
    if (key === 'style' || key === 'diagram') return Object.freeze(pick(value, Object.keys(key === 'style' ? styleFields : diagramFields)));
    return value;
  };
  function snapshot(source) {
    const result = Object.freeze(Object.fromEntries(snapshotKeys
      .filter((key) => Object.hasOwn(source, key) && source[key] !== undefined)
      .map((key) => [key, frozen(key, source[key])])));
    snapshots.add(result);
    return result;
  }
  function validate(theme) {
    if (!isRecord(theme)) throw new TypeError('主题必须是对象');
    if (theme.id != null && (typeof theme.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(theme.id))) throw new TypeError('主题 id 非法');
    if (!['light', 'dark'].includes(theme.scheme)) throw new TypeError('主题 scheme 必须是 light 或 dark');
    if (typeof theme.fontFamily !== 'string' || !theme.fontFamily.trim() || /[\u0000-\u001f\u007f<>;]/.test(theme.fontFamily)) throw new TypeError('主题 fontFamily 非法');
    if (theme.style !== undefined) checkStyle(theme.style, styleFields, 'style');
    if (theme.diagram !== undefined) checkStyle(theme.diagram, diagramFields, 'diagram');
    if (!Array.isArray(theme.tones) || theme.tones.length !== 6) throw new TypeError('主题 tones 必须包含 6 个颜色');
    for (const key of colorKeys) if (!isHex(theme[key])) throw new TypeError(`主题 ${key} 必须是 #RRGGBB 颜色`);
    for (const hex of theme.tones) if (!isHex(hex)) throw new TypeError('主题 tones 包含非法颜色');
    if (theme.frameInk !== undefined && (!isHex(theme.frameInk) || contrast(theme.frameInk, theme.surface) < 3)) {
      throw new TypeError('主题 frameInk 必须是对 surface 有至少 3:1 对比度的 #RRGGBB 颜色');
    }
    // tint controls how decorative frames and branches become pale. It does not change semantic status colors.
    if (theme.tint !== undefined) {
      const { hue, chroma } = theme.tint || {};
      if (!isRecord(theme.tint) || Object.keys(theme.tint).some((key) => !['hue', 'chroma'].includes(key))
        || !Number.isFinite(hue) || hue < 0 || hue >= 360 || !ranges(1, 2)(chroma)) throw new TypeError('主题 tint 必须是 { hue: 0–360, chroma: 1–2 }');
    }
    for (let i = 0; i < theme.tones.length; i += 1) {
      if (contrast(theme.tones[i], theme.surface) < 3) throw new TypeError(`主题 tones[${i}] 对 surface 对比度不足 3`);
      for (let j = i + 1; j < theme.tones.length; j += 1) {
        if (deltaE2000(theme.tones[i], theme.tones[j]) < 12) throw new TypeError(`主题 tones[${i}] 与 tones[${j}] 区分度不足 12`);
        if (i < 3 && j < 3) {
          if (deltaE2000(theme.tones[i], theme.tones[j]) < 15) throw new TypeError(`主题 tones[${i}] 与 tones[${j}] 正常视觉区分度不足 15`);
          for (const cvd of ['protan', 'deutan']) if (deltaE2000(simulateCvd(theme.tones[i], cvd), simulateCvd(theme.tones[j], cvd)) < 15) throw new TypeError(`主题 tones[${i}] 与 tones[${j}] 在 ${cvd} 色觉下区分度不足 15`);
        }
      }
    }
    for (const key of ['accent', ...statusKeys]) if (contrast(theme[key], theme.surface) < 3) throw new TypeError(`主题 ${key} 对 surface 对比度不足 3`);
    for (const text of ['fg1', 'fg3']) for (const background of ['bg', 'surface']) if (contrast(theme[text], theme[background]) < 4.5) throw new TypeError(`主题 ${text} 对 ${background} 对比度不足 4.5`);
    return theme;
  }

  const colorOf = (theme, role) => /^tone[1-6]$/.test(role) ? theme.tones[Number(role.at(-1)) - 1] : theme[role];
  function readable(theme, role, on, minimum = 4.5) {
    for (const bg of on) if (contrast(colorOf(theme, role), bg === 'print.bg' ? '#ffffff' : theme[bg]) < minimum) {
      throw new TypeError(`主题 ${role} 对 ${bg} 对比度不足 ${minimum}`);
    }
  }
  // Theme files also style page text. Raw KChart theme objects (including UI brand palettes) have no page contract.
  function checkReadingColors(theme) {
    const page = theme.scheme === 'light' ? ['bg', 'print.bg'] : ['bg'];
    for (const role of [...textKeys, 'accent']) readable(theme, role, [...page, 'surface', 'surface2']);
    for (const role of statusKeys) readable(theme, role, [...page, 'surface']);
    readable(theme, theme.style.numberColor, page);
    readable(theme, theme.style.listMarker, page, 3);
  }
  function resolveConfig(config, base, id) {
    if (Object.hasOwn(config, 'style')) checkStyle(config.style, styleFields, 'style');
    if (Object.hasOwn(config, 'diagram') && config.diagram !== null) checkStyle(config.diagram, diagramFields, 'diagram');
    const style = { ...defaultStyle, ...base?.style, ...config.style };
    const diagram = config.diagram === null ? {} : { ...base?.diagram, ...config.diagram };
    const resolved = { fontFamily: FONT_FAMILY, ...base, ...pick(config, snapshotKeys), id, style };
    for (const key of labels) resolved[key] = config[key] ?? (key === 'desc' ? '' : config.name ?? config.en ?? id ?? 'Custom');
    for (const key of optionalColors) if (resolved[key] === null) delete resolved[key];
    if (Object.keys(diagram).length) resolved.diagram = diagram;
    else delete resolved.diagram;
    checkFileTheme(resolved);
    checkReadingColors(resolved);
    for (const key of [...colorKeys, 'frameInk']) if (resolved[key]) resolved[key] = resolved[key].toLowerCase();
    resolved.tones = resolved.tones.map((hex) => hex.toLowerCase());
    return snapshot(resolved);
  }
  function checkConfig(config, path) {
    checkKeys(config, configKeys, path);
    for (const key of ['id', 'extends']) if (Object.hasOwn(config, key)
      && (typeof config[key] !== 'string' || !idPattern.test(config[key]) || reservedId(config[key]))) throw new TypeError(`主题 ${key} 必须是有效且不保留的主题 ID`);
    if (Object.hasOwn(config, 'order') && (!Number.isSafeInteger(config.order) || config.order < 0)) throw new TypeError('主题 order 必须是非负整数');
    checkLabels(config);
  }
  function checkLabels(config) {
    for (const key of labels) if (Object.hasOwn(config, key) && (typeof config[key] !== 'string' || config[key].length > 240
      || /[\u0000-\u001f\u007f]/.test(config[key]) || (key !== 'desc' && !config[key].trim()))) throw new TypeError(`主题 ${key} 必须是有效的纯文本`);
  }
  function builtins(configs) {
    const resolved = new Map(), visiting = new Set();
    const load = (id) => {
      if (!Object.hasOwn(configs, id)) throw new TypeError(`未知继承主题：${id}`);
      if (resolved.has(id)) return resolved.get(id);
      if (visiting.has(id)) throw new TypeError(`主题继承存在循环：${[...visiting, id].join(' → ')}`);
      const config = configs[id];
      checkConfig(config, `${id}.json`);
      if (config.id !== id) throw new TypeError(`主题 id 必须和文件名一致：${id}.json`);
      if (labels.some((key) => !config[key]?.trim())) throw new TypeError('内置主题必须声明 name、en 和 desc');
      visiting.add(id);
      // Paper is the root palette. Other files may choose a parent or inherit the normal default.
      const parent = config.extends ?? (id === 'paper' ? null : id === DEFAULT_THEME ? 'paper' : DEFAULT_THEME);
      const base = parent === null ? null : load(parent);
      const result = resolveConfig(config, base, id);
      resolved.set(id, result);
      visiting.delete(id);
      return result;
    };
    const ids = Object.keys(configs);
    for (const id of ids) {
      try { load(id); } catch (cause) { throw new TypeError(`内置主题 ${id}.json：${cause.message}`, { cause }); }
    }
    if (!resolved.has(DEFAULT_THEME) || resolved.get('paper')?.scheme !== 'light') throw new TypeError('缺少默认主题或浅色打印基线 Paper');
    ids.sort((a, b) => (configs[a].order ?? Infinity) - (configs[b].order ?? Infinity) || (a < b ? -1 : 1));
    return Object.freeze(Object.fromEntries(ids.map((id) => [id, resolved.get(id)])));
  }
  const themes = builtins(moduleData);

  function resolveThemeConfig(config) {
    checkConfig(config, 'theme');
    if (Object.hasOwn(themes, config.id)) throw new TypeError(`主题 id 与内置主题冲突：${config.id}`);
    const parent = config.extends ?? DEFAULT_THEME;
    if (!Object.hasOwn(themes, parent)) throw new TypeError(`未知继承主题：${parent}`);
    return resolveConfig(config, themes[parent], config.id);
  }
  function checkFileTheme(config) {
    if (!localFonts(config.fontFamily)) throw new TypeError('主题 fontFamily 必须是本地字体名列表');
    validate(config);
  }
  function validateThemeSnapshot(config) {
    checkKeys(config, snapshotKeys, 'theme');
    if (!config.style || Object.keys(defaultStyle).some((key) => !Object.hasOwn(config.style, key))
      || labels.some((key) => !Object.hasOwn(config, key))) throw new TypeError('内嵌主题样式或名称不完整');
    checkLabels(config);
    checkFileTheme(config);
    return snapshot(config);
  }
  function theme(idOrObject = DEFAULT_THEME, { media = 'screen' } = {}) {
    if (!['screen', 'print'].includes(media)) throw new TypeError('media 必须是 screen 或 print');
    let source;
    if (typeof idOrObject === 'string') {
      if (!Object.hasOwn(themes, idOrObject)) throw new TypeError(`未知主题：${idOrObject}`);
      source = themes[idOrObject];
    } else {
      source = snapshots.has(idOrObject) ? idOrObject : snapshot(validate(idOrObject));
    }
    if (media !== 'print') return source;
    if (source.scheme === 'dark') {
      const paper = themes.paper;
      const resolved = { ...source, scheme: 'light', tones: [...paper.tones] };
      for (const key of colorKeys) resolved[key] = paper[key];
      for (const key of optionalColors) {
        if (paper[key] !== undefined) resolved[key] = paper[key];
        else delete resolved[key];
      }
      return snapshot(resolved);
    }
    return snapshot({ ...source, bg: '#ffffff' });
  }
  function paletteOf(resolvedTheme) {
    const [tone1, tone2, tone3, tone4, tone5, tone6] = resolvedTheme.tones;
    return Object.freeze({ ink: tone1, accent: tone2, tone1, tone2, tone3, tone4, tone5, tone6, fg: resolvedTheme.fg1, muted: resolvedTheme.fg3, bg: resolvedTheme.surface, grid: resolvedTheme.line, axis: resolvedTheme.line2 });
  }
  return { themes, theme, paletteOf, resolveThemeConfig, validateThemeSnapshot, DEFAULT_THEME, FONT_FAMILY, defaultStyle: Object.freeze(defaultStyle), statusMarks };
});
