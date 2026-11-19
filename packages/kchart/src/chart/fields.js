import { formatValue, makeFormatters } from '../core/format.js';

const valueRoles = [
  'value', 'lower', 'upper', 'low', 'high', 'q1', 'median', 'q3',
  'actual', 'target', 'before', 'after', 'delta', 'start', 'end',
];

function fieldReader(spec = {}, lang) {
  const encoding = spec.encode || {};
  const formatter = makeFormatters(lang);
  function rootUnitFor(name) {
    if (!spec.unit || !name) return undefined;
    if (['tree', 'mindmap', 'treemap', 'sunburst'].includes(spec.chart) && name === 'value') return spec.unit;
    if ((spec.chart === 'sankey' && name === 'edge.value') || (spec.chart === 'threads' && name === 'path.value')) return spec.unit;
    if (spec.chart === 'histogram') return [encoding.lower, encoding.upper].includes(name) ? spec.unit : undefined;
    if (spec.chart === 'violin' && encoding.density === name) return `${spec.unit}⁻¹`;
    if (valueRoles.some((role) => [encoding[role]].flat().includes(name))) return spec.unit;
  }
  function field(name) {
    const meta = { ...(spec.fields?.[name] || {}) };
    if (meta.unit == null) meta.unit = rootUnitFor(name);
    return { label: meta.label || name, ...meta };
  }
  function format(value, fieldName, withUnit = true) {
    const meta = field(fieldName);
    if (!Number.isFinite(value)) return '—';
    if (meta.format === 'percent') {
      const decimals = meta.decimals ?? 1;
      formatter.decimals = decimals;
      return formatValue(value * 100, withUnit ? '%' : null, formatter, decimals);
    }
    const decimals = meta.decimals ?? naturalDecimals(value);
    formatter.decimals = decimals;
    return formatValue(value, withUnit ? meta.unit : null, formatter,
      meta.decimals ?? (decimals > 4 ? decimals : null));
  }
  return { field, format };
}

function naturalDecimals(value) {
  const [mantissa, exponent = '0'] = String(Number(Math.abs(value).toPrecision(12))).toLowerCase().split('e');
  return Math.max(0, Math.min(6, (mantissa.split('.')[1]?.length || 0) - Number(exponent)));
}

export { fieldReader };
