import { linkTargets, safeHref } from '../core/scene.js';
import { error, statusMarks, warning } from './support.js';

// CSS named colors (sRGB), excluding transparent which is always neutral.
const named = new Map(`aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f grey:808080 honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd
lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32`.split(/\s+/).map(pair => pair.split(':')));
const clamp = n => Math.max(0, Math.min(1, n));
const number = /^([+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?)(%|deg|rad|grad|turn)?$/;
const hue = n => ((n % 360) + 360) % 360;

function rgba(css) {
  if (typeof css !== 'string') return null;
  css = css.trim().toLowerCase();
  let hex = named.get(css) ?? /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.exec(css)?.[1];
  if (hex) {
    if (hex.length <= 4) hex = [...hex].map(c => c + c).join('');
    return hex.match(/../g).map(c => parseInt(c, 16) / 255);
  }
  const match = /^(rgb|hsl)a?\(([^()]*)\)$/.exec(css);
  if (!match) return null;
  const body = match[2].trim();
  const legacy = body.includes(',');
  const [channels, alpha, extra] = body.split(/\s*\/\s*/);
  const values = legacy ? body.split(/\s*,\s*/) : channels.split(/\s+/);
  if (legacy ? values.length < 3 || values.length > 4 : values.length !== 3 || extra !== undefined) return null;
  if (!legacy && alpha !== undefined) values.push(alpha);
  const tokens = values.map(v => number.exec(v));
  if (tokens.some(t => !t || !Number.isFinite(Number(t[1])))) return null;
  const [[, x, u], [, y, v], [, z, w], [, a = 1, au] = []] = tokens;
  if (au && au !== '%') return null;
  const opacity = clamp(Number(a) / (au ? 100 : 1));
  if (match[1] === 'rgb') {
    if ([u, v, w].some(unit => unit && unit !== '%') || (legacy && (u !== v || v !== w))) return null;
    return [clamp(x / (u ? 100 : 255)), clamp(y / (v ? 100 : 255)), clamp(z / (w ? 100 : 255)), opacity];
  }
  if (u === '%' || v !== '%' || w !== '%') return null;
  const h = hue(x * ({ turn: 360, rad: 180 / Math.PI, grad: 0.9, deg: 1 }[u] ?? 1)) / 30;
  const s = clamp(y / 100), l = clamp(z / 100), c = s * Math.min(l, 1 - l);
  return [...[0, 8, 4].map(n => { const k = (n + h) % 12; return l - c * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }), opacity];
}

function roleOfColor(css) {
  const channels = rgba(css);
  if (!channels || (channels[3] ?? 1) < 0.2) return null;
  // sRGB → OKLab a/b, then polar chroma and hue; preserve fractional CSS channels.
  const [r, g, b] = channels.slice(0, 3).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  if (!Number.isFinite(a + bb) || Math.hypot(a, bb) < 0.035) return null;
  const h = hue(Math.atan2(bb, a) * 180 / Math.PI);
  return h < 45 || h >= 345 ? 'danger' : h < 115 ? 'warn' : h < 200 ? 'ok' : h < 290 ? 'info' : 'new';
}

// Split CSS declarations only outside strings/functions. Escaped separators stay in their values.
function declarations(source) {
  const entries = [];
  let quote = '', depth = 0, start = 0, malformed = false;
  const add = end => {
    const part = source.slice(start, end).trim();
    start = end + 1;
    if (!part) return;
    const pair = /^([\w-]+)\s*:\s*(\S[\s\S]*)$/.exec(part);
    if (!pair) malformed = true;
    else entries.push([pair[1].toLowerCase(), pair[2].replace(/\\([,;])/g, '$1')]);
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') i++;
    else if (quote) { if (c === quote) quote = ''; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') { if (depth) depth--; else malformed = true; }
    else if (!depth && (c === ',' || c === ';')) {
      // Mermaid examples also use unescaped numeric lists in stroke-dasharray.
      if (c === ',' && /^\s*stroke-dasharray\s*:/i.test(source.slice(start, i)) && /^\s*[+-]?(?:\d|\.\d)/.test(source.slice(i + 1))) continue;
      add(i);
    }
  }
  add(source.length);
  return { props: Object.fromEntries(entries), entries, malformed: malformed || !!quote || !!depth || !entries.length };
}

function parseProps(source) { return declarations(source).props; }

const nodeColors = ['fill', 'background', 'stroke', 'border-color'];
const edgeColors = ['stroke', 'fill', 'background', 'border-color'];
const statuses = new Set(Object.keys(statusMarks));
const words = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s"']+/gy;
const quoted = /^(?:"|')/;
const unquote = word => quoted.test(word) ? word.slice(1, -1).replace(/\\(["'])/g, '$1') : word;
const list = value => value.split(',').map(s => s.trim());
const listHead = /^("[^"\n]+"|'[^'\n]+'|[^\s,"']+(?:\s*,\s*[^\s,"']+)*)\s+(.+)$/s;

function tokenize(source) {
  const tokens = [];
  for (let start = 0; start < source.length;) {
    words.lastIndex = start;
    const word = words.exec(source)?.[0];
    if (!word) return null;
    tokens.push(word);
    start += word.length;
    if (start < source.length && !/\s/.test(source[start])) return null;
    while (start < source.length && /\s/.test(source[start])) start++;
  }
  return tokens;
}

function presentation({ lang, classKeyword = 'class' } = {}) {
  const defs = new Map(), classes = new Map(), styles = new Map(), edges = new Map(), links = new Map();
  const issues = [], ignoredStyles = new Map(), interactions = new Set();
  const addClasses = (id, names, _line) => {
    if (!classes.has(id)) classes.set(id, []);
    classes.get(id).push(...names);
  };
  function accept(text, line) {
    const source = text.trim().replace(/;$/, '').trimEnd();
    const [, keyword, body = ''] = /^(\S+)(?:\s+(.*))?$/s.exec(source) ?? [];
    const kind = keyword?.toLowerCase();
    if (![classKeyword.toLowerCase(), 'classdef', 'style', 'linkstyle', 'click', 'href', 'link', 'callback'].includes(kind)) return false;
    const malformed = () => issues.push({ ...error(lang, line, `无效的 ${keyword} 语句`, `Malformed ${keyword} statement`, '检查标识符和参数', 'Check identifiers and arguments'), severity: 'error' });
    const ignoreInteraction = (subject, zh, en) => {
      if (interactions.has(subject)) return;
      interactions.add(subject);
      issues.push(warning('IGNORED_INTERACTION', lang, line, zh, en, '改用安全链接，不使用回调', 'Use a safe URL instead of a callback or unsupported link'));
    };
    const head = listHead.exec(body);
    const ids = head ? list(unquote(head[1])) : [];
    if (kind === classKeyword.toLowerCase()) {
      const names = head ? list(unquote(head[2])) : [];
      if (!ids.length || ids.some(id => !id) || names.some(name => !/^[^\s,"']+$/.test(name))) malformed();
      else for (const id of ids) addClasses(id, names, line);
    } else if (kind === 'style' || kind === 'classdef' || kind === 'linkstyle') {
      if (!ids.length || ids.some(id => !id) || (kind === 'style' && ids.length !== 1) ||
          (kind === 'linkstyle' && !(ids.length === 1 && ids[0] === 'default') && !ids.every(id => /^\d+$/.test(id) && Number.isSafeInteger(Number(id))))) {
        malformed();
      } else {
        const { props, entries, malformed: invalid } = declarations(head[2]);
        if (invalid) malformed();
        else {
          const colors = kind === 'linkstyle' ? edgeColors : nodeColors;
          for (const [key, value] of entries) if (!colors.includes(key) || !roleOfColor(value)) {
            const subject = colors.includes(key) ? `${key}: ${value}` : key;
            if (!ignoredStyles.has(subject)) ignoredStyles.set(subject, line);
          }
          const role = colors.map(key => roleOfColor(props[key])).find(Boolean) ?? null;
          const store = kind === 'classdef' ? defs : kind === 'style' ? styles : edges;
          for (const id of ids) store.set(kind === 'linkstyle' && id !== 'default' ? Number(id) : id, role);
        }
      }
    } else {
      const call = kind === 'click' && /^(?:"[^"]+"|'[^']+'|\S+)\s+call\s+([\w.$]+)\s*\([\s\S]*\)(?:\s+"(?:\\.|[^"\\])*")?$/.exec(body);
      if (call) ignoreInteraction(`callback:${call[1]}`, `已忽略回调 ${call[1]}`, `Ignored callback ${call[1]}`);
      else {
        const tokens = tokenize(body);
        const [id, arg, ...tail] = tokens ?? [];
        const explicit = kind === 'click' && arg === 'href';
        const url = explicit ? tail.shift() : arg;
        const tooltip = quoted.test(tail[0] ?? '') ? unquote(tail.shift()) : undefined;
        const target = tail.shift();
        if (!id || !unquote(id) || !url || (kind === 'click' && arg === 'call') || tail.length) malformed();
        else if (kind === 'callback' || (kind === 'click' && !explicit && /^[\w$]+(?:\.[\w$]+)*$/.test(url))) {
          if (target !== undefined) malformed();
          else ignoreInteraction(`callback:${unquote(url)}`, `已忽略回调 ${unquote(url)}`, `Ignored callback ${unquote(url)}`);
        } else {
          const href = safeHref(unquote(url));
          if (!href || (target !== undefined && !linkTargets.has(target))) {
            ignoreInteraction(`link:${!href ? unquote(url) : target}`, '已忽略不安全的链接或不支持的目标', 'Ignored unsafe URL or unsupported target');
          } else links.set(unquote(id), { href, ...(tooltip === undefined ? {} : { tooltip }), ...(target === undefined ? {} : { target }) });
        }
      }
    }
    return true;
  }
  function statusOf(id) {
    if (styles.get(id)) return styles.get(id);
    const applied = classes.get(id) ?? [];
    for (let i = applied.length - 1; i >= 0; i--) {
      const name = applied[i], status = statuses.has(name) ? name : defs.get(name);
      if (status) return status;
    }
    return defs.get('default') ?? null;
  }
  function diagnostics() {
    const result = [...issues];
    if (ignoredStyles.size) {
      const subjects = [...ignoredStyles.keys()].join(', ');
      result.push(warning('IGNORED_STYLE', lang, ignoredStyles.values().next().value,
        `已忽略部分样式：${subjects}`, `Ignored styles: ${subjects}`, '用状态类或有彩度的颜色', 'Use status classes or chromatic colors'));
    }
    return result.sort((a, b) => a.line - b.line);
  }
  return { accept, addClasses, statusOf, edgeStatusOf: index => edges.get(index) ?? edges.get('default') ?? null,
    linkOf: id => links.get(id) ?? null, diagnostics };
}

export { presentation, roleOfColor, safeHref, parseProps };
