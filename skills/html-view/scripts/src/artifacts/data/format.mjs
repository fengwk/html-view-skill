import { decimalRound, quantityParts } from '../../../../vendor/kchart/esm/core/format.js';
const isEnglish = (lang) => /^en\b/i.test(String(lang ?? 'zh'));
const isHanStart = (unit) => /^\p{Script=Han}/u.test(unit);
const grouped = (whole) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function attachUnit(text, unit) {
  const suffix = String(unit ?? '').trim();
  if (!suffix) return text;
  const separator = suffix === '%' || isHanStart(suffix) ? '' : ' ';
  return `${text}${separator}${suffix}`;
}

export function roundPercentage(value, digits = 1) {
  return decimalRound(value, digits, 2);
}

function formatPercentage(value, digits = 1) {
  return roundPercentage(value, digits).toFixed(digits);
}

export function formatValue(value, spec = {}) {
  if (!Number.isFinite(value)) return '—';
  if (spec.format === 'percent') return `${formatPercentage(value, spec.decimals ?? 1)}%`;
  const declared = Number.isInteger(spec.decimals) ? spec.decimals : null;
  const integer = Number.isInteger(value);
  // exact：数据表和叙述用原值加千分位，不缩写成万、K、M，读者能逐格核对上游数字。
  // 未声明精度时整数不带小数，其余固定两位（不去尾零），同一列的派生值小数位对齐。
  if (spec.exact) {
    const digits = declared ?? (integer ? 0 : 2);
    const [whole, fraction = ''] = Math.abs(decimalRound(value, digits)).toFixed(digits).split('.');
    const sign = value < 0 && Number(`${whole}.${fraction || 0}`) !== 0 ? '-' : '';
    return attachUnit(`${sign}${fraction ? `${grouped(whole)}.${fraction}` : grouped(whole)}`, spec.unit);
  }
  const digitsOf = (scale) => declared ?? (scale === 1 ? (integer ? 0 : 2) : 1);
  const lang = isEnglish(spec.lang) ? 'en' : 'zh';
  const { scaled, digits, suffix, sign, scale } = quantityParts(value, lang, digitsOf);
  const [whole, fraction = ''] = scaled.toFixed(digits).split('.');
  const trailing = declared == null && scale === 1 ? fraction.replace(/0+$/, '') : fraction;
  const number = trailing ? `${grouped(whole)}.${trailing}` : grouped(whole);
  return attachUnit(`${sign}${number}${suffix}`, spec.unit);
}

export function formatDelta(comparison, spec = {}) {
  if (comparison?.status !== 'ok') return '—';
  const english = isEnglish(spec.lang);
  const { direction, mode, delta, current, rate } = comparison;
  if (direction === 'flat') return english ? 'flat' : '持平';
  const up = direction === 'up';
  if (mode === 'percent_point') {
    const points = formatPercentage(Math.abs(delta ?? 0), spec.decimals ?? 1);
    return english ? `${up ? 'up' : 'down'} ${points} pp` : `${up ? '提高' : '下降'} ${points} 个百分点`;
  }
  const amountSpec = { ...spec, unit: '' };
  if (mode === 'from_zero') {
    const amount = formatValue(current, amountSpec);
    return english ? `from 0 to ${amount}` : `由 0 ${up ? '增至' : '降至'} ${amount}`;
  }
  if (mode === 'absolute') {
    const amount = formatValue(Math.abs(delta ?? 0), amountSpec);
    return english ? `${up ? 'increase' : 'decrease'} ${amount}` : `${up ? '增加' : '减少'} ${amount}`;
  }
  if (!Number.isFinite(rate)) return '—';
  const amount = formatPercentage(Math.abs(rate));
  return english ? `${up ? 'up' : 'down'} ${amount}%` : `${up ? '增长' : '下降'} ${amount}%`;
}

export function compareValues(current, baseline, spec = {}) {
  if (current?.status !== 'ok' || current.value == null) {
    const status = current?.status === 'ok' ? 'missing' : current?.status || 'missing';
    return { status, reason: current?.reason || '本期不可用' };
  }
  if (baseline?.status !== 'ok' || baseline.value == null) {
    return { status: 'missing_base', reason: baseline?.reason || '缺少基期，不能比较' };
  }
  const delta = current.value - baseline.value;
  const comparison = {
    status: 'ok', current: current.value, baseline: baseline.value, delta, direction: directionOf(delta),
  };
  if (spec.format === 'percent') return { ...comparison, mode: 'percent_point' };
  if (baseline.value === 0) return { ...comparison, mode: 'from_zero' };
  if (baseline.value < 0) return { ...comparison, mode: 'absolute', reason: '基期为负，只给出两期值与绝对变化' };
  return { ...comparison, mode: 'relative', rate: delta / baseline.value };
}

export function directionOf(delta) {
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}
