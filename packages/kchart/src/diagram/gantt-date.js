const DAY = 86400000;
const weekdays = 'Sunday Monday Tuesday Wednesday Thursday Friday Saturday'.split(' ');
const months = 'January February March April May June July August September October November December'.split(' ');
const shortMonths = months.map(name => name.slice(0, 3));
const shortWeekdays = weekdays.map(name => name.slice(0, 3));
const pad = (n, width = 2, char = '0') => String(n).padStart(width, char);
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function civil(y, m = 0, d = 1, h = 0, min = 0, s = 0, ms = 0) {
  const date = new Date(0);
  date.setUTCFullYear(y, m, d);
  date.setUTCHours(h, min, s, ms);
  return date;
}
const parts = stamp => {
  const d = new Date(stamp), y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate(), dow = d.getUTCDay();
  return { y, m, day, dow, h: d.getUTCHours(), min: d.getUTCMinutes(), s: d.getUTCSeconds(), ms: d.getUTCMilliseconds(), doy: Math.floor((stamp - +civil(y)) / DAY) + 1 };
};
const one = '\\d{1,2}', two = '\\d{2}';
const patterns = {
  YYYY: '\\d{4}', YY: two, Q: '[1-4]', M: one, MM: two, MMM: shortMonths.join('|'), MMMM: months.join('|'),
  D: one, DD: two, Do: '\\d{1,2}(?:st|nd|rd|th)', DDD: '\\d{1,3}', DDDD: '\\d{3}',
  d: '[0-6]', dd: weekdays.map(x => x.slice(0, 2)).join('|'), ddd: shortWeekdays.join('|'), dddd: weekdays.join('|'),
  H: one, HH: two, h: one, hh: two, a: 'am|pm', A: 'AM|PM', m: one, mm: two, s: one, ss: two,
  S: '\\d', SS: two, SSS: '\\d{3}', Z: 'Z|[+-]\\d{2}:\\d{2}', ZZ: 'Z|[+-]\\d{4}',
};
const dateTokens = [...Object.keys(patterns), 'X', 'x'];
function compileDate(format) {
  if (format === 'X' || format === 'x') return {
    parse: text => /^-?\d+(?:\.\d+)?$/.test(text) ? +new Date(Number(text) * (format === 'X' ? 1000 : 1)) : NaN,
    format: stamp => String(format === 'X' ? Math.floor(stamp / 1000) : stamp),
  };
  const tokens = [], fields = [], atom = /\[([^\]]*)\]|([A-Za-z]+)|([^A-Za-z\[\]]+)|([\[\]])/g;
  const scan = new RegExp(Object.keys(patterns).sort((a, b) => b.length - a.length).join('|'), 'y');
  for (const [, literal, word, punctuation, invalid] of format.matchAll(atom)) {
    if (invalid) throw new Error(invalid);
    if (!word) { tokens.push({ literal: literal ?? punctuation }); continue; }
    scan.lastIndex = 0;
    while (scan.lastIndex < word.length) {
      const index = scan.lastIndex, match = scan.exec(word);
      if (!match) throw new Error(word.slice(index));
      fields.push(match[0]); tokens.push({ key: match[0] });
    }
  }
  // Adjacent fields can be valid (YYYYMMDD), but two spellings for the same field are not
  // a way to spell a longer token (MMMMM, HHH, etc.).
  const keys = fields.map(key => key === 'Do' ? 'D' : key.replace(/(.)\1+/g, '$1').replace(/^[aA]$/, 'a').replace(/^[hH]$/, 'H'));
  if (!fields.length || new Set(keys).size !== fields.length) throw new Error(format);
  const re = new RegExp(`^${tokens.map(({ key, literal }) => key ? `(${patterns[key]})` : escape(literal)).join('')}$`, 'u');
  const formatParts = p => {
    const { y, m, day, dow, h, min, s, ms, doy } = p, hh = h % 12 || 12;
    return { YYYY: pad(y, 4), YY: pad(y % 100), Q: Math.floor(m / 3) + 1, M: m + 1, MM: pad(m + 1), MMM: shortMonths[m], MMMM: months[m],
      D: day, DD: pad(day), Do: ordinal(day), DDD: doy, DDDD: pad(doy, 3), d: dow, dd: weekdays[dow].slice(0, 2), ddd: shortWeekdays[dow], dddd: weekdays[dow],
      H: h, HH: pad(h), h: hh, hh: pad(hh), a: h < 12 ? 'am' : 'pm', A: h < 12 ? 'AM' : 'PM', m: min, mm: pad(min), s, ss: pad(s),
      S: Math.floor(ms / 100), SS: pad(Math.floor(ms / 10)), SSS: pad(ms, 3), Z: '+00:00', ZZ: '+0000' };
  };
  return {
    parse(text) {
      const match = re.exec(text);
      if (!match) return NaN;
      const f = Object.fromEntries(fields.map((key, i) => [key, match[i + 1]]));
      const yy = Number(f.YY), y = Number(f.YYYY ?? (f.YY ? (yy > 68 ? 1900 : 2000) + yy : 1970));
      const m = f.MMM ? shortMonths.indexOf(f.MMM) : f.MMMM ? months.indexOf(f.MMMM) : Number(f.M ?? f.MM ?? (f.Q ? (+f.Q - 1) * 3 + 1 : 1)) - 1;
      const doy = f.DDD ?? f.DDDD, day = Number(doy ?? f.D ?? f.DD ?? (f.Do ? parseInt(f.Do, 10) : 1));
      const hour = Number(f.h ?? f.hh), ampm = (f.a ?? f.A)?.toLowerCase();
      if ((f.h || f.hh) && (hour < 1 || hour > 12)) return NaN;
      const h = Number(f.H ?? f.HH ?? (Number.isNaN(hour) ? 0 : ampm ? hour % 12 + (ampm === 'pm' ? 12 : 0) : hour));
      const stamp = +civil(y, doy ? 0 : m, day, h, Number(f.m ?? f.mm ?? 0), Number(f.s ?? f.ss ?? 0), Number(f.SSS ?? ((f.SS ?? f.S ?? '').padEnd(3, '0'))));
      if (!Number.isFinite(stamp)) return NaN;
      const zone = f.Z ?? f.ZZ, digits = zone?.replace(':', '');
      const zh = Number(digits?.slice(1, 3)), zm = Number(digits?.slice(3));
      const values = formatParts(parts(stamp));
      if (fields.some(key => key !== 'Z' && key !== 'ZZ' && String(values[key]) !== f[key])) return NaN;
      if (!zone || zone === 'Z') return stamp;
      return zh <= 23 && zm <= 59 ? stamp - (zone[0] === '-' ? -1 : 1) * (zh * 60 + zm) * 60000 : NaN;
    },
    format(stamp) {
      const values = formatParts(parts(stamp));
      return tokens.map(({ key, literal }) => key ? values[key] : literal).join('');
    },
  };
}

const axisTokens = 'a A b B c d e H I j m M L p S U w W x X y Y Z % s Q f g G q u V'.split(' ');
function compileAxis(format) {
  const directives = /%([-_0]?)(.)?/g;
  for (const [token, , key] of format.matchAll(directives)) if (!key || !axisTokens.includes(key)) throw new Error(token);
  return stamp => {
    const { y, m, day, dow, h, min, s, ms, doy } = parts(stamp), hh = h % 12 || 12;
    const thursday = parts(stamp + (3 - (dow + 6) % 7) * DAY);
    const values = { a: shortWeekdays[dow], A: weekdays[dow], b: shortMonths[m], B: months[m],
      d: day, e: day, H: h, I: hh, j: doy, m: m + 1, M: min, L: ms, p: h < 12 ? 'AM' : 'PM', S: s,
      U: Math.floor((doy + 6 - dow) / 7), W: Math.floor((doy + 6 - (dow + 6) % 7) / 7), w: dow, y: y % 100, Y: y, Z: '+0000', '%': '%',
      x: `${m + 1}/${day}/${y}`, X: `${hh}:${pad(min)}:${pad(s)} ${h < 12 ? 'AM' : 'PM'}`,
      s: Math.floor(stamp / 1000), Q: stamp, f: ms * 1000, g: thursday.y % 100, G: thursday.y, q: Math.floor(m / 3) + 1, u: dow || 7, V: Math.ceil(thursday.doy / 7) };
    values.c = `${values.x}, ${values.X}`;
    const widths = { Y: 4, G: 4, f: 6, L: 3, j: 3 };
    return format.replace(directives, (_, modifier, key) => {
      const n = values[key];
      return modifier === '-' || typeof n !== 'number' || 'sQqwu'.includes(key) ? String(n) : pad(n, widths[key] || 2, modifier === '_' || (!modifier && key === 'e') ? ' ' : '0');
    });
  };
}

const units = { ms: 1, s: 1000, m: 60000, h: 3600000, d: DAY, w: 7 * DAY };
const durationPattern = /^(\d+(?:\.\d+)?)(ms|[smhdwMy])$/;
function add(stamp, n, unit) {
  if (unit !== 'M' && unit !== 'y') return +new Date(stamp + n * units[unit]);
  const { y, m, day, h, min, s, ms } = parts(stamp);
  const endMonth = m + (unit === 'M' ? Math.trunc(n) : 0), endYear = y + (unit === 'y' ? Math.trunc(n) : 0);
  const lastDay = civil(endYear, endMonth + 1, 0).getUTCDate();
  return +civil(endYear, endMonth, Math.min(day, lastDay), h, min, s, ms);
}
function excludedBy({ includes, excludes, weekend }, format) {
  const iso = compileDate('YYYY-MM-DD').format;
  return stamp => {
    const full = format(stamp).toLowerCase(), day = iso(stamp), dow = parts(stamp).dow;
    if (includes.has(full) || includes.has(day) || includes.has(weekdays[dow].toLowerCase()) || (includes.has('weekends') && (dow === weekend || dow === (weekend + 1) % 7))) return false;
    return excludes.has(full) || excludes.has(day) || excludes.has(weekdays[dow].toLowerCase()) ||
      (excludes.has('weekends') && (dow === weekend || dow === (weekend + 1) % 7));
  };
}
function shiftEnd(start, end, excluded) {
  // Mermaid checks the same clock time on each following day, including the end date.
  for (let day = start + DAY; day <= end; day += DAY) {
    if (day - start > 10000 * DAY) return NaN;
    if (excluded(day)) end += DAY;
  }
  return end;
}

const intervalUnits = { millisecond: 'ms', second: 's', minute: 'm', hour: 'h', day: 'd', week: 'w', month: 'M', year: 'y' };
const intervalPattern = /^([1-9]\d*)(millisecond|second|minute|hour|day|week|month|year)$/;
const autoIntervals = [[1, 'ms'], [10, 'ms'], [100, 'ms'], [1, 's'], [5, 's'], [15, 's'], [30, 's'], [1, 'm'], [5, 'm'], [15, 'm'], [30, 'm'], [1, 'h'], [3, 'h'], [6, 'h'], [12, 'h'], [1, 'd'], [1, 'w'], [1, 'M'], [3, 'M'], [1, 'y']];
const approx = unit => units[unit] ?? (unit === 'M' ? 30 : 365) * DAY;
function ticks(min, max, weekday, interval) {
  const span = max - min;
  const unit = interval ? intervalUnits[interval[2]] : null;
  const dropped = Boolean(unit && span / (approx(unit) * Number(interval[1])) > 9999);
  const [step, kind] = unit && !dropped ? [Number(interval[1]), unit] :
    autoIntervals.find(([n, key]) => n * approx(key) >= span / 9) || [Math.ceil(span / (9 * approx('y'))), 'y'];
  const p = parts(min), weekBase = (weekday - 4) * DAY;
  const floor = (n, base) => Math.floor(n / base) * base;
  let stamp;
  if (kind === 'y') stamp = +civil(floor(p.y, step));
  else if (kind === 'M') stamp = +civil(p.y, floor(p.m, step));
  else if (kind === 'w') stamp = floor(min - weekBase, step * units.w) + weekBase;
  else if (kind === 'd') stamp = +civil(p.y, p.m, 1 + floor(p.day - 1, step));
  else stamp = floor(min, step * units[kind]);
  const values = [];
  while (Number.isFinite(stamp) && stamp <= max && values.length <= 10000) {
    if (stamp >= min) values.push(stamp);
    const next = add(stamp, step, kind), a = parts(stamp), b = parts(next);
    stamp = kind === 'd' && (a.y !== b.y || a.m !== b.m) ? +civil(a.y, a.m + 1) :
      kind === 'M' && a.y !== b.y ? +civil(a.y + 1) : next;
    if (stamp <= (values.at(-1) ?? -Infinity)) break;
  }
  if (values.length > 10000) return { ...ticks(min, max, weekday), dropped: true };
  return { values: values.length ? values : [min], dropped };
}

export { DAY, weekdays, compileDate, compileAxis, dateTokens, axisTokens, durationPattern, add, excludedBy, shiftEnd, intervalPattern, ticks };
