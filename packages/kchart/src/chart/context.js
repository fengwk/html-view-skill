import { createContext } from '../core/context.js';
import { compactTemporal, formatPercent, makeFormatters, tickTexts } from '../core/format.js';
import { extent, niceScale } from '../core/scale.js';
import { fieldReader } from './fields.js';

function dateCategories(values, type, fit) {
  const unique = [...new Set(values)];
  if (type !== 'date' && type !== 'month') return unique;
  const valid = unique.every((value) => typeof value === 'string' && (type === 'date' ? /^\d{4}-\d{2}-\d{2}$/.test(value) : /^\d{4}-\d{2}$/.test(value)));
  if (!valid || !unique.length) return unique;
  const toDay = (s) => { const d = new Date(0); d.setUTCHours(0, 0, 0, 0); d.setUTCFullYear(+s.slice(0, 4), +s.slice(5, 7) - 1, type === 'date' ? +s.slice(8, 10) : 1); return d.getTime(); };
  const fromDay = (n) => { const d = new Date(n); return type === 'date' ? d.toISOString().slice(0, 10) : d.toISOString().slice(0, 7); };
  const lo = Math.min(...unique.map(toDay)), hi = Math.max(...unique.map(toDay));
  const first = new Date(lo), last = new Date(hi);
  const span = type === 'date' ? Math.floor((hi - lo) / 86400000) + 1 : (last.getUTCFullYear() - first.getUTCFullYear()) * 12 + last.getUTCMonth() - first.getUTCMonth() + 1;
  if (span > 10000) fit('时间分类跨度过大，无法安全补档', '缩小时间范围后重试');
  const out = [];
  for (let t = lo; t <= hi;) { out.push(fromDay(t)); const d = new Date(t); type === 'date' ? d.setUTCDate(d.getUTCDate() + 1) : d.setUTCMonth(d.getUTCMonth() + 1); t = d.getTime(); }
  return out;
}
function makeContext(options = {}) {
  const ctx = createContext(options);
  const sourceSpec = options.spec || {};
  const { field, format } = fieldReader(sourceSpec, ctx.lang);
  ctx.field = field;
  ctx.format = format;
  ctx.compactTemporal = (labels) => compactTemporal(labels, ctx.lang);
  ctx.ticks = (values, fieldName, {
    zero = false, count = 4, intervals = null, length = null, size = 12, padding = 0, adjacent = false, percentSymbol = true,
  } = {}) => {
    const meta = ctx.field(fieldName);
    if (meta.scale === 'log') throw new Error('Logarithmic ticks must be calculated by the chart layout');
    const annotations = (sourceSpec.annotations || []).filter((a) => a.field === fieldName && ['rule', 'band'].includes(a.kind)).flatMap((a) => a.kind === 'rule' ? [a.value] : [a.from, a.to]);
    const domain = Array.isArray(meta.domain) && meta.domain.length === 2 ? meta.domain : [];
    let [min, max] = extent([...(values || []), ...domain, ...annotations]);
    if (padding > 0) {
      if (zero) {
        min = Math.min(0, min);
        max = Math.max(0, max);
      }
      const extra = (max - min || Math.abs(max) || 1) * padding;
      min = zero && min === 0 ? 0 : min >= 0 ? Math.max(0, min - extra) : min - extra;
      max = zero && max === 0 ? 0 : max <= 0 ? Math.min(0, max + extra) : max + extra;
    }
    const percent = meta.format === 'percent';
    const scaleOf = (n) => {
      const result = niceScale(min, max, { zero, count: n, intervals });
      const f = makeFormatters(ctx.lang); f.decimals = meta.decimals ?? 0;
      const displayTicks = percent ? result.ticks.map(tick => tick * 100) : result.ticks;
      const step = percent ? result.step * 100 : result.step;
      const labels = tickTexts(displayTicks, step, f, percent ? '%' : meta.unit, { percentSymbol });
      return { ...result, labels };
    };
    const fits = ({ ticks, labels }) => {
      if (ticks.length < 2) return true;
      const widths = labels.map((label) => ctx.measure(label, size, 400));
      const spacing = length / (ticks.length - 1);
      return adjacent
        ? widths.every((width, i) => i === 0 || (widths[i - 1] + width) / 2 + 8 <= spacing)
        : Math.max(...widths) + 8 <= spacing;
    };
    let result = scaleOf(count);
    if (Number(length) > 0 && intervals == null) {
      for (let n = count - 1; n >= 1 && !fits(result); n -= 1) result = scaleOf(n);
    }
    return result;
  };
  ctx.percent = (ratio, decimals = 1) => {
    if (!Number.isFinite(ratio)) return '—';
    const f = makeFormatters(ctx.lang);
    return formatPercent(ratio * 100, f, decimals);
  };
  ctx.table = (input = sourceSpec) => table(input, ctx);
  return ctx;
}
function table(spec, ctx) {
  const rows = Array.isArray(spec?.data) ? spec.data : Array.isArray(spec?.rows) ? spec.rows : [];
  const enc = spec?.encode || {};
  const categoryField = enc.category || enc.time || enc.date || enc.month || null;
  const valueRole = enc.value ?? enc.values ?? null;
  const valueFields = Array.isArray(valueRole) ? valueRole : valueRole ? [valueRole] : [];
  const seriesField = enc.series || null, categoryMeta = categoryField ? ctx.field(categoryField) : {};
  const hasDomain = Array.isArray(categoryMeta.domain);
  let categories = categoryField ? (hasDomain ? [...categoryMeta.domain] : dateCategories(rows.map((row) => row?.[categoryField]), categoryMeta.type, ctx.fit)) : [];
  const temporal = ['date', 'month', 'datetime'].includes(categoryMeta.type), sort = spec?.sort;
  if (!hasDomain && categories.length && (temporal || sort)) {
    const original = new Map(categories.map((category, index) => [category, index]));
    const sortValue = (category) => !sort || sort.field === categoryField ? category : rows.find((row) => row?.[categoryField] === category)?.[sort.field] ?? null;
    const compare = (a, b) => {
      if ((!sort && temporal) || (sort?.field === categoryField && temporal)) { const aTime = Date.parse(a), bTime = Date.parse(b); if (Number.isFinite(aTime) && Number.isFinite(bTime)) return aTime - bTime; }
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      const left = String(a), right = String(b); return left < right ? -1 : left > right ? 1 : 0;
    };
    categories.sort((a, b) => {
      const left = sortValue(a), right = sortValue(b);
      if (sort && sort.field !== categoryField && (left == null || right == null)) return left == null ? (right == null ? original.get(a) - original.get(b) : 1) : -1;
      const result = compare(left, right);
      return (sort?.direction === 'desc' ? -result : result) || original.get(a) - original.get(b);
    });
  }
  const series = [];
  if (seriesField && valueFields.length === 1) {
    const ids = [...new Set(rows.map((row) => row?.[seriesField]))];
    for (const id of ids) {
      const values = categories.map((category) => { const row = rows.find((r) => r?.[categoryField] === category && r?.[seriesField] === id), value = row?.[valueFields[0]]; return typeof value === 'number' && Number.isFinite(value) ? value : null; });
      series.push({ id: String(id), label: String(id), field: valueFields[0], values });
    }
  } else {
    for (const name of valueFields) series.push({ id: String(name), label: ctx.field(name).label, field: name, values: categories.map((category) => { const row = rows.find((r) => r?.[categoryField] === category), value = row?.[name]; return typeof value === 'number' && Number.isFinite(value) ? value : null; }) });
  }
  return { rows, categoryField, valueFields, series, categories };
}

export { makeContext };
