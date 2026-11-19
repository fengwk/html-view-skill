KChart.define('core/theme', ({ 'core/color': color }) => {
  const { isHex, contrast, deltaE2000, simulateCvd } = color;
  const FONT_FAMILY = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", "Microsoft YaHei", sans-serif';
  const statusMarks = Object.freeze({ new: '+', info: '~', ok: '=', warn: '!', danger: '×', ext: '↗' });
  const definitions = {
    claude: { id: 'claude', scheme: 'light', fontFamily: FONT_FAMILY, tones: ['#2a2621', '#bb5a35', '#5f5a55', '#54220e', '#847f7a', '#b67f6b'], bg: '#faf9f5', surface: '#f5f4ed', surface2: '#efede6', line: '#e8e6dc', line2: '#dad9d4', fg1: '#141413', fg2: '#3d3d3a', fg3: '#5f5e58', fg4: '#6b6961', accent: '#a84624', new: '#7c5378', info: '#3b6692', ok: '#576b3c', warn: '#815b26', danger: '#96382f', ext: '#5f5e58', name: '陶土', en: 'Claude', desc: 'Claude 经典亮色：象牙白底、暖近黑字、陶土色文字与编号、衬线标题。' },
    paper: { id: 'paper', scheme: 'light', fontFamily: FONT_FAMILY, tones: ['#23272c', '#2769c6', '#575b62', '#0e3163', '#7c8088', '#6e92c6'], bg: '#ffffff', surface: '#f9fafc', surface2: '#f3f4f6', line: '#e5e6e8', line2: '#d2d3d5', fg1: '#18191d', fg2: '#35373b', fg3: '#54575b', fg4: '#686a6f', accent: '#245fd4', new: '#72579d', info: '#00738e', ok: '#307944', warn: '#905908', danger: '#a83634', ext: '#54575b', name: '素白', en: 'Paper', desc: '纯白底、近黑字、细灰线与蓝色强调。' },
    obsidian: { id: 'obsidian', scheme: 'dark', fontFamily: FONT_FAMILY, tones: ['#e1e0e8', '#afaff6', '#98979e', '#8080b5', '#636269', '#5d58a6'], bg: '#0b0b0e', surface: '#111114', surface2: '#19181b', line: '#202023', line2: '#303033', fg1: '#e8e7ec', fg2: '#cdcdd1', fg3: '#a6a5aa', fg4: '#8d8d91', accent: '#b2b1ff', new: '#c8aadb', info: '#8fbde5', ok: '#89c7ab', warn: '#d2b281', danger: '#e29c9b', ext: '#a6a5aa', name: '黑曜', en: 'Obsidian', desc: '近黑紫调底色与长春花紫强调的暗色主题。' },
    tokyo: { id: 'tokyo', scheme: 'dark', fontFamily: FONT_FAMILY, tones: ['#d9e1f6', '#81aaf7', '#9198ab', '#6686c0', '#61687a', '#3966bc'], bg: '#1a1b26', surface: '#16161e', surface2: '#24283b', line: '#292e42', line2: '#3b4261', fg1: '#c8d1f5', fg2: '#a9b1d6', fg3: '#9aa5ce', fg4: '#8a92c0', accent: '#7aa2f7', new: '#c5abf4', info: '#6bc8f0', ok: '#a7c87e', warn: '#e3b06b', danger: '#ef8d9d', ext: '#9aa5ce', name: '夜都', en: 'Tokyo Night', desc: 'Tokyo Night 靛蓝夜色主题。' },
    kanagawa: { id: 'kanagawa', scheme: 'dark', fontFamily: FONT_FAMILY, tones: ['#e8e1d1', '#d4b771', '#9e9889', '#99844f', '#716b5e', '#866700'], bg: '#1b1816', surface: '#221f1d', surface2: '#2b2825', line: '#312e2b', line2: '#46423f', fg1: '#f0e5cf', fg2: '#d9ceb8', fg3: '#b4aa94', fg4: '#9c937e', accent: '#8ba9be', new: '#cb9fc6', info: '#74bfba', ok: '#a9b781', warn: '#e1a583', danger: '#d5878a', ext: '#b4aa94', name: '神奈川', en: 'Kanagawa', desc: '复古暖调与米白文字的暗色主题。' },
    terminal: { id: 'terminal', scheme: 'dark', fontFamily: FONT_FAMILY, tones: ['#d8e5da', '#6de18b', '#909c92', '#439b5b', '#5c675d', '#007232'], bg: '#0a0e0b', surface: '#0e1410', surface2: '#142018', line: '#1c2b21', line2: '#2a4233', fg1: '#e2f5e7', fg2: '#bdd7c4', fg3: '#93b39d', fg4: '#7c9c86', accent: '#5af78e', new: '#d9a4ff', info: '#80c5ff', ok: '#0bdac9', warn: '#e7b643', danger: '#ff8a82', ext: '#93b39d', name: '终端', en: 'Terminal', desc: '黑绿终端风与荧光绿强调的暗色主题。' },
  };
  const colorKeys = ['bg', 'surface', 'surface2', 'line', 'line2', 'fg1', 'fg2', 'fg3', 'fg4', 'accent', 'new', 'info', 'ok', 'warn', 'danger', 'ext'];
  const snapshotKeys = ['id', 'scheme', 'fontFamily', 'tones', ...colorKeys, 'name', 'en', 'desc'];
  const snapshots = new WeakSet();
  function snapshot(source) {
    const result = Object.freeze(Object.fromEntries(snapshotKeys
      .filter((key) => Object.hasOwn(source, key))
      .map((key) => [key, key === 'tones' ? Object.freeze([...source.tones]) : source[key]])));
    snapshots.add(result);
    return result;
  }
  function validate(theme) {
    if (!theme || typeof theme !== 'object' || Array.isArray(theme)) throw new TypeError('主题必须是对象');
    if (theme.id != null && (typeof theme.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(theme.id))) throw new TypeError('主题 id 非法');
    if (!['light', 'dark'].includes(theme.scheme)) throw new TypeError('主题 scheme 必须是 light 或 dark');
    if (typeof theme.fontFamily !== 'string' || !theme.fontFamily.trim() || /[\u0000-\u001f\u007f<>;]/.test(theme.fontFamily)) throw new TypeError('主题 fontFamily 非法');
    if (!Array.isArray(theme.tones) || theme.tones.length !== 6) throw new TypeError('主题 tones 必须包含 6 个颜色');
    for (const key of colorKeys) if (!isHex(theme[key])) throw new TypeError(`主题 ${key} 必须是 #RRGGBB 颜色`);
    for (const hex of theme.tones) if (!isHex(hex)) throw new TypeError('主题 tones 包含非法颜色');
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
    for (const key of ['accent', 'new', 'info', 'ok', 'warn', 'danger', 'ext']) if (contrast(theme[key], theme.surface) < 3) throw new TypeError(`主题 ${key} 对 surface 对比度不足 3`);
    for (const text of ['fg1', 'fg3']) for (const background of ['bg', 'surface']) if (contrast(theme[text], theme[background]) < 4.5) throw new TypeError(`主题 ${text} 对 ${background} 对比度不足 4.5`);
    return theme;
  }
  const themes = Object.freeze(Object.fromEntries(Object.entries(definitions).map(([id, value]) => [id, snapshot(validate(value))])));
  function theme(idOrObject = 'claude', { media = 'screen' } = {}) {
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
      return snapshot(resolved);
    }
    return snapshot({ ...source, bg: '#ffffff' });
  }
  function paletteOf(resolvedTheme) {
    const [tone1, tone2, tone3, tone4, tone5, tone6] = resolvedTheme.tones;
    return Object.freeze({ ink: tone1, accent: tone2, tone1, tone2, tone3, tone4, tone5, tone6, fg: resolvedTheme.fg1, muted: resolvedTheme.fg3, bg: resolvedTheme.surface, grid: resolvedTheme.line, axis: resolvedTheme.line2 });
  }
  return { themes, theme, paletteOf, FONT_FAMILY, statusMarks };
});
