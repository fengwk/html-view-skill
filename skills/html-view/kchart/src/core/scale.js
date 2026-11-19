KChart.define('core/scale', () => {
  function niceStep(raw) {
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    const exp = Math.floor(Math.log10(raw)), f = raw / (10 ** exp);
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * (10 ** exp);
  }
  function decimalsFor(step) {
    if (!Number.isFinite(step) || step <= 0) return 0;
    for (let digits = 0; digits <= 6; digits += 1) {
      const scaled = step * (10 ** digits);
      if (Math.abs(scaled - Math.round(scaled)) < 1e-9 * Math.max(1, Math.abs(scaled))) return digits;
    }
    return 6;
  }
  const roundTo = (value, step) => Math.round(value * (10 ** decimalsFor(step))) / (10 ** decimalsFor(step));
  function fixedScale(lo, hi, intervals) {
    let step = niceStep((hi - lo) / intervals);
    let start = Math.floor(lo / step + 1e-9) * step;
    while (start + step * intervals < hi - step * 1e-9) {
      step = niceStep(step * (1 + 1e-6));
      start = Math.floor(lo / step + 1e-9) * step;
    }
    const ticks = Array.from({ length: intervals + 1 }, (_, i) => roundTo(start + i * step, step));
    return { min: ticks[0], max: ticks.at(-1), step, ticks };
  }
  function niceScale(min, max, { count = 5, zero = false, intervals = null } = {}) {
    let lo = Number.isFinite(min) ? min : 0, hi = Number.isFinite(max) ? max : 1;
    if (zero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
    if (lo > hi) [lo, hi] = [hi, lo];
    if (lo === hi) {
      if (lo === 0) hi = 1;
      else if (lo > 0) { lo = zero ? 0 : lo - Math.abs(lo) * 0.1; hi += Math.abs(hi) * 0.1; }
      else { hi = zero ? 0 : hi + Math.abs(hi) * 0.1; lo -= Math.abs(lo) * 0.1; }
    }
    if (Number.isInteger(intervals) && intervals > 0) return fixedScale(lo, hi, intervals);
    const target = Math.max(1, count), exp = Math.floor(Math.log10((hi - lo) / target));
    const rank = new Map([[1, 0], [2, 1], [5, 2], [2.5, 3]]);
    let best = null;
    for (let e = exp - 1; e <= exp + 1; e += 1) for (const m of [1, 2, 2.5, 5]) {
      const step = m * (10 ** e), start = Math.floor(lo / step + 1e-9) * step, end = Math.ceil(hi / step - 1e-9) * step;
      const n = Math.round((end - start) / step);
      if (n < Math.max(2, target - 1) || n > target + 2) continue;
      const span = end - start;
      const better = !best || span < best.span - 1e-9 * Math.max(1, Math.abs(span))
        || (Math.abs(span - best.span) <= 1e-9 * Math.max(1, Math.abs(span)) && (rank.get(m) < best.rank || (rank.get(m) === best.rank && Math.abs(n - target) < Math.abs(best.intervals - target))));
      if (better) best = { step, start, end, span, rank: rank.get(m), intervals: n };
    }
    let step = best ? best.step : niceStep((hi - lo) / target);
    let start = best ? best.start : Math.floor(lo / step + 1e-9) * step;
    let end = best ? best.end : Math.ceil(hi / step - 1e-9) * step;
    let ticks = [];
    for (let value = start; value <= end + step * 1e-8; value += step) ticks.push(roundTo(value, step));
    if (ticks.length > 12) {
      step = niceStep((hi - lo) / Math.max(1, Math.ceil(count / 2)));
      start = Math.floor(lo / step + 1e-9) * step; end = Math.ceil(hi / step - 1e-9) * step; ticks = [];
      for (let value = start; value <= end + step * 1e-8; value += step) ticks.push(roundTo(value, step));
    }
    ticks = ticks.filter((tick, index) => ticks.indexOf(tick) === index);
    return { min: start, max: end, step, ticks };
  }
  function extent(values) {
    const nums = Array.from(values || []).filter((value) => typeof value === 'number' && Number.isFinite(value));
    return nums.length ? [Math.min(...nums), Math.max(...nums)] : [0, 0];
  }
  function linear(min, max, start, end) {
    const span = max - min;
    return (value) => span === 0 ? (start + end) / 2 : start + (Number(value) - min) / span * (end - start);
  }
  return { niceScale, niceStep, decimalsFor, extent, linear };
});
