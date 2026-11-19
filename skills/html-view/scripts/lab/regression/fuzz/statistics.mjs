// 统计与比较图族的随机声明。每个生成器只产出符合 spec.js 契约的数据，不迁就当前实现的版面。
// rungs 的单位符号有文档上限（全图 ≤2000，且单个符号必须达到可读尺寸），否则实现抛 CHART_FIT。
// unitMark 由试渲染收到该上限内；数值形态本身仍按画像覆盖。
import { render } from '../../../../vendor/kchart/esm/node.js';

const MAX_SYMBOLS = 2000;

const note = (h, zh, en) => {
  if (h.profile.text === 'none') return {};
  const base = h.texts();
  return { ...base, note: h.zh ? zh : en };
};

const fieldMeta = (h, { percent = false, label = null, domain = null, scale = null, decimals = null } = {}) => {
  const meta = {};
  if (label) meta.label = label;
  if (percent) meta.format = 'percent';
  else if (h.chance(0.55)) meta.unit = h.unit();
  if (domain) meta.domain = domain;
  if (scale) meta.scale = scale;
  if (decimals != null) meta.decimals = decimals;
  return meta;
};

const textOf = (h, { long = false } = {}) => {
  if (h.profile.text === 'none') return h.chance(0.5) ? h.labels(1, { length: 'short' })[0] : h.labels(1)[0];
  const bank = h.texts();
  const source = long || h.profile.text === 'long' ? bank.note : bank.title;
  return source.length > 42 ? source.slice(0, 42) : source;
};

const tidy = (value) => Number(Number(value).toPrecision(6));

const positive = (h, { min = 0, max = null } = {}) => {
  let value = h.value({ signed: false, missing: false, min });
  if (value == null || value < min) value = min === 0 ? Math.abs(h.value({ signed: false, missing: false }) ?? 1) : min;
  if (max != null) value = Math.min(max, value);
  if (value < min) value = min;
  return value;
};

// 符号像素尺寸取决于数值跨度、图宽和坐标刻度，静态估算不稳定。
// 在本次画像宽度上试渲染，逐步加大步长，直到不再触发 CHART_FIT。
const unitMarkFor = (h, values, spec) => {
  const finite = values.filter((value) => Number.isFinite(value) && value !== 0).map(Math.abs);
  const peak = Math.max(...finite, 1);
  let value = Math.max(peak / 20, peak * finite.length / (MAX_SYMBOLS * 0.8));
  const label = h.unit();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    spec.unitMark = { value: tidy(Math.min(value, peak)), label };
    const { diagnostics } = render(spec, { width: h.profile.width, theme: h.profile.theme, lang: h.lang });
    if (!diagnostics.length) return spec.unitMark;
    if (diagnostics.some(({ code }) => code !== 'CHART_FIT')) {
      throw new Error(diagnostics.map(({ message }) => message).join('；'));
    }
    value *= 3;
  }
  spec.variant = 'solid';
  delete spec.unitMark;
  return null;
};

const withIds = (h, rows, prefix) => {
  if (!h.chance(0.55)) return false;
  rows.forEach((row, index) => { row.id = `${prefix}-${index + 1}`; });
  return true;
};

const spread = (h) => {
  if (h.profile.values === 'huge') return 10 ** (5 + h.rng() * 4.7);
  if (h.profile.values === 'tiny') return 0.001 + h.rng();
  if (h.profile.values === 'mixed') return 10 ** (-1 + h.rng() * 8);
  return 8 + h.rng() * 240;
};

export const GENERATORS = {
  dumbbell(h) {
    const n = h.count(1, 12);
    const variant = h.pick(['solid', 'solid', 'rungs']);
    const percent = variant !== 'rungs' && h.chance(0.22);
    const signed = variant !== 'rungs';
    const categories = h.labels(n);
    const rows = categories.map((category, index) => {
      const before = percent ? h.rng() : positive(h);
      const delta = percent ? (h.rng() - 0.5) * 0.4 : (h.chance(0.5) ? 1 : -1) * spread(h) * 0.35;
      let after = percent ? Math.min(1, Math.max(0, before + delta)) : signed ? tidy(before + delta) : Math.max(0, tidy(before + Math.abs(delta)));
      if (h.profile.values === 'equal') after = before;
      if (h.profile.values === 'zeros' && h.chance(0.3)) after = 0;
      const row = { category, before: tidy(before), after: tidy(after) };
      return row;
    });
    const hasId = withIds(h, rows, 'db');
    if (variant === 'rungs') for (const row of rows) { row.before = Math.abs(row.before); row.after = Math.abs(row.after); }
    const measure = percent ? fieldMeta(h, { percent, label: h.zh ? '占比' : 'Share' }) : fieldMeta(h);
    const spec = {
      chart: 'dumbbell',
      ...note(h, '说明：两端为同一口径的前后读数，库不计算显著性。', 'Note: both ends are readings of the same measure; no significance is computed.'),
      encode: { category: 'category', before: 'before', after: 'after', ...(hasId ? { id: 'id' } : {}) },
      fields: { before: measure, after: { ...measure } },
      data: rows,
    };
    if (!percent && h.chance(0.7)) spec.unit = measure.unit || h.unit();
    if (percent) delete spec.unit;
    if (!percent && measure.unit && spec.unit) { delete spec.fields.before.unit; delete spec.fields.after.unit; }
    if (variant === 'rungs') {
      spec.variant = 'rungs';
      unitMarkFor(h, rows.flatMap((row) => [row.before, row.after]), spec);
    } else if (h.chance(0.15)) spec.variant = 'solid';
    if (h.chance(0.25) && !percent) {
      const all = rows.flatMap((row) => [row.before, row.after]);
      spec.fields.before.domain = [Math.min(0, ...all), Math.max(...all)];
      spec.fields.after.domain = [...spec.fields.before.domain];
    }
    return spec;
  },

  slope(h) {
    const n = h.count(1, 8);
    const percent = h.chance(0.2);
    const categories = h.labels(n);
    const rows = categories.map((category, index) => {
      const before = percent ? h.rng() * 0.9 : h.value({ signed: true, missing: false });
      const after = percent ? Math.min(1, Math.max(0, before + (h.rng() - 0.45) * 0.5)) : tidy(before + (h.chance(0.5) ? 1 : -1) * spread(h) * 0.4);
      const row = { category, before: tidy(before), after: h.profile.values === 'equal' ? tidy(before) : tidy(after) };
      return row;
    });
    const hasId = withIds(h, rows, 'sl');
    const measure = percent ? fieldMeta(h, { percent, label: h.zh ? '份额' : 'Share' }) : fieldMeta(h, { label: h.zh ? '读数' : 'Reading' });
    const spec = {
      chart: 'slope',
      ...note(h, '说明：斜线连接同一口径的前后读数，数值不是名次。', 'Note: slopes connect readings of the same measure; values are not ranks.'),
      encode: { category: 'category', before: 'before', after: 'after', ...(hasId ? { id: 'id' } : {}) },
      fields: {
        before: { ...measure, label: h.zh ? '之前' : 'Before' },
        after: { ...measure, label: h.zh ? '之后' : 'After' },
      },
      data: rows,
    };
    if (!percent && h.chance(0.65)) spec.unit = measure.unit || h.unit();
    if (spec.unit) { delete spec.fields.before.unit; delete spec.fields.after.unit; }
    if (h.chance(0.2)) {
      const all = rows.flatMap((row) => [row.before, row.after]);
      const domain = [Math.min(...all) - Math.abs(Math.min(...all)) * 0.05, Math.max(...all) + Math.abs(Math.max(...all)) * 0.05 || 1];
      spec.fields.before.domain = domain.map(tidy);
      spec.fields.after.domain = domain.map(tidy);
    }
    return spec;
  },

  interval(h) {
    const n = h.count(1, 12);
    const withValue = h.chance(0.7);
    const percent = h.chance(0.18);
    const categories = h.labels(n);
    const rows = categories.map((category, index) => {
      const center = percent ? 0.15 + h.rng() * 0.7 : h.value({ signed: true, missing: false });
      const half = percent ? 0.02 + h.rng() * 0.12 : Math.abs(spread(h)) * (0.05 + h.rng() * 0.25) || 0.5;
      let low = tidy(center - half);
      let high = tidy(Math.max(center + half, low + (percent ? 0.01 : Math.abs(center) * 1e-4 || 0.01)));
      if (percent) { low = Math.max(0, low); high = Math.min(1, Math.max(high, low + 0.01)); }
      const row = { category, low, high };
      if (withValue) row.value = tidy(low + (high - low) * (0.15 + h.rng() * 0.7));
      return row;
    });
    const hasId = withIds(h, rows, 'iv');
    const measure = percent ? fieldMeta(h, { percent }) : fieldMeta(h);
    const spec = {
      chart: 'interval',
      ...note(h, '说明：竖线为声明区间，点为区间内的点估计；库不计算置信水平。', 'Note: bars are declared intervals and dots are estimates inside them; no confidence level is computed.'),
      encode: { category: 'category', low: 'low', high: 'high', ...(withValue ? { value: 'value' } : {}), ...(hasId ? { id: 'id' } : {}) },
      fields: { low: { ...measure, label: h.zh ? '下界' : 'Low' }, high: { ...measure, label: h.zh ? '上界' : 'High' } },
      data: rows,
    };
    if (withValue) spec.fields.value = { ...measure, label: h.zh ? '点估计' : 'Estimate' };
    if (!percent && h.chance(0.6)) spec.unit = measure.unit || h.unit();
    if (spec.unit) for (const key of Object.keys(spec.fields)) delete spec.fields[key].unit;
    if (h.chance(0.35)) {
      const field = h.pick(withValue ? ['low', 'value', 'high'] : ['low', 'high']);
      const numbers = rows.flatMap((row) => [row.low, row.high, row.value].filter(Number.isFinite));
      const span = Math.max(...numbers) - Math.min(...numbers) || 1;
      if (h.chance(0.5)) {
        spec.annotations = [{ kind: 'rule', field, value: tidy(numbers[0] + span * h.rng()), label: textOf(h) }];
      } else {
        const from = tidy(Math.min(...numbers) + span * h.rng() * 0.4);
        spec.annotations = [{ kind: 'band', field, from, to: tidy(from + span * (0.1 + h.rng() * 0.3)), label: textOf(h) }];
      }
      if (hasId && h.chance(0.4)) spec.annotations.push({ kind: 'note', record: rows[0].id, field, text: textOf(h) });
    }
    return spec;
  },

  waterfall(h) {
    const n = h.count(1, 16);
    const variant = h.pick(['solid', 'solid', 'rungs']);
    const percent = variant !== 'rungs' && h.chance(0.16);
    const categories = h.labels(n);
    const rows = categories.map((category, index) => {
      let delta = percent ? tidy((h.rng() - 0.42) * 0.35) : tidy((h.chance(0.45) ? -1 : 1) * spread(h));
      if (h.profile.values === 'zeros' && h.chance(0.35)) delta = 0;
      if (h.profile.values === 'equal') delta = Math.abs(delta);
      if (variant === 'rungs') delta = tidy((h.chance(0.45) ? -1 : 1) * Math.abs(delta));
      const row = { category, delta };
      return row;
    });
    const hasId = withIds(h, rows, 'wf');
    if (rows.every((row) => row.delta === 0)) rows[0].delta = percent ? 0.05 : 1;
    const measure = percent ? fieldMeta(h, { percent, label: h.zh ? '增减' : 'Change' }) : fieldMeta(h, { label: h.zh ? '增减' : 'Change' });
    let start = percent ? tidy(0.2 + h.rng() * 0.5) : tidy((h.chance(0.3) ? -1 : 1) * spread(h));
    if (h.chance(0.2)) start = 0;
    const spec = {
      chart: 'waterfall',
      ...note(h, '说明：柱为相对起点的增减，末柱为累计。', 'Note: bars are changes from the start; the last bar is the cumulative total.'),
      start,
      encode: { category: 'category', delta: 'delta', ...(hasId ? { id: 'id' } : {}) },
      fields: { delta: measure },
      data: rows,
    };
    if (!percent && h.chance(0.7)) spec.unit = measure.unit || h.unit();
    if (spec.unit) delete spec.fields.delta.unit;
    if (variant === 'rungs') {
      spec.variant = 'rungs';
      unitMarkFor(h, rows.map((row) => row.delta), spec);
    } else if (h.chance(0.15)) spec.variant = 'solid';
    return spec;
  },

  histogram(h) {
    const n = h.count(1, 40);
    const variant = h.pick(['solid', 'solid', 'rungs']);
    const unequal = variant === 'rungs' ? false : h.chance(0.45);
    const percent = variant !== 'rungs' && h.chance(0.12);
    const width0 = percent ? Number((0.02 + h.rng() * 0.06).toFixed(4)) : Number(Math.max(1e-3, spread(h) * 0.05).toPrecision(4));
    let cursor = percent ? 0 : tidy((h.chance(0.25) ? -1 : 1) * spread(h) * 0.2);
    const rows = [];
    for (let index = 0; index < n; index += 1) {
      const width = unequal ? Number((width0 * (0.35 + h.rng() * 4.5)).toPrecision(6)) : width0;
      const upper = unequal ? Number((cursor + width).toPrecision(8)) : cursor + width0;
      let count = h.profile.values === 'zeros' && h.chance(0.4) ? 0 : Math.abs(h.value({ signed: false, missing: false }));
      if (h.profile.values === 'equal') count = Math.abs(rows[0]?.count ?? count);
      rows.push({ lower: cursor, upper, count: tidy(count) });
      cursor = upper;
    }
    const bin = percent ? fieldMeta(h, { percent, label: h.zh ? '取值' : 'Value' }) : fieldMeta(h, { label: h.zh ? '取值' : 'Value' });
    const count = { label: h.zh ? '频数' : 'Frequency' };
    const spec = {
      chart: 'histogram',
      ...note(h, '说明：柱高或面积表示频数；不等宽箱按真实宽度绘制。', 'Note: bar height or area encodes frequency; unequal bins use their real width.'),
      encode: { lower: 'lower', upper: 'upper', count: 'count' },
      fields: { lower: { ...bin }, upper: { ...bin }, count },
      data: rows,
    };
    if (!percent && h.chance(0.55)) {
      spec.unit = bin.unit || h.unit();
      delete spec.fields.lower.unit;
      delete spec.fields.upper.unit;
    }
    if (variant === 'rungs') {
      spec.variant = 'rungs';
      unitMarkFor(h, rows.map((row) => row.count), spec);
    } else if (h.chance(0.15)) spec.variant = 'solid';
    if (h.chance(0.3)) {
      const field = h.pick(['lower', 'upper']);
      const lo = rows[0].lower;
      const hi = rows.at(-1).upper;
      const span = hi - lo || 1;
      spec.annotations = h.chance(0.5)
        ? [{ kind: 'rule', field, value: tidy(lo + span * (0.15 + h.rng() * 0.7)), label: textOf(h) }]
        : [{ kind: 'band', field, from: tidy(lo + span * 0.1), to: tidy(lo + span * (0.4 + h.rng() * 0.4)), label: textOf(h) }];
    }
    return spec;
  },

  boxplot(h) {
    const n = h.count(1, 12);
    const withOutliers = h.chance(0.7);
    const percent = h.chance(0.16);
    const categories = h.labels(n);
    const rows = categories.map((category, index) => {
      const base = percent ? 0.05 + h.rng() * 0.7 : h.value({ signed: true, missing: false });
      const step = percent ? 0.01 + h.rng() * 0.04 : Math.abs(spread(h)) * 0.08 + (Math.abs(base) * 0.02 || 0.5);
      const low = tidy(base);
      const q1 = tidy(base + step);
      const median = tidy(base + step * (1.6 + h.rng()));
      const q3 = tidy(median + step * (0.6 + h.rng()));
      const high = tidy(q3 + step * (0.6 + h.rng()));
      const row = { category, low, q1, median, q3, high };
      if (withOutliers && h.chance(0.75)) {
        const count = h.profile.size === 'max' ? h.int(1, 12) : h.int(1, 4);
        const outliers = [];
        for (let k = 0; k < count; k += 1) {
          const gap = step * (0.4 + h.rng() * 4);
          outliers.push(tidy(h.chance(0.5) ? low - gap : high + gap));
        }
        row.outliers = outliers;
      }
      return row;
    });
    const hasId = withIds(h, rows, 'bx');
    const hasOutliers = rows.some((row) => row.outliers);
    if (hasOutliers) for (const row of rows) row.outliers ??= [];
    const measure = percent ? fieldMeta(h, { percent }) : fieldMeta(h);
    const roles = ['low', 'q1', 'median', 'q3', 'high'];
    const spec = {
      chart: 'boxplot',
      ...note(h, '说明：须线端点是声明的 low/high，不是包含异常点的样本极值。', 'Note: whisker ends are the declared low and high, not sample extremes that include outliers.'),
      encode: { category: 'category', low: 'low', q1: 'q1', median: 'median', q3: 'q3', high: 'high', ...(hasOutliers ? { outliers: 'outliers' } : {}), ...(hasId ? { id: 'id' } : {}) },
      fields: Object.fromEntries(roles.map((role) => [role, { ...measure }])),
      data: rows,
    };
    if (!percent && h.chance(0.65)) spec.unit = measure.unit || h.unit();
    if (spec.unit) for (const role of roles) delete spec.fields[role].unit;
    return spec;
  },

  violin(h) {
    const n = h.count(1, 12);
    const points = h.profile.size === 'min' ? 2 : h.profile.size === 'max' ? h.int(40, 120) : h.int(6, 24);
    const percent = h.chance(0.14);
    const categories = h.labels(n);
    const rows = categories.map((category, index) => {
      const center = percent ? 0.2 + h.rng() * 0.6 : h.value({ signed: true, missing: false });
      const sigma = percent ? 0.03 + h.rng() * 0.08 : Math.abs(spread(h)) * 0.15 + 0.5;
      const step = Math.max(sigma * 6 / Math.max(1, points - 1), Math.abs(center) * 1e-4 || 1e-4);
      const start = center - step * (points - 1) / 2;
      const density = [];
      let previous = -Infinity;
      for (let k = 0; k < points; k += 1) {
        let x = tidy(start + step * k);
        if (!(x > previous)) x = tidy(previous + Math.max(Math.abs(step) * 1e-4, 1e-6));
        previous = x;
        const z = (x - center) / (sigma || 1);
        const height = Math.exp(-0.5 * z * z);
        density.push([x, tidy(height < 1e-6 ? 0 : height)]);
      }
      if (density.every((point) => point[1] === 0)) density[Math.floor(points / 2)][1] = 1;
      const median = tidy(Math.min(density.at(-1)[0], Math.max(density[0][0], center)));
      const row = { category, density, median };
      return row;
    });
    const hasId = withIds(h, rows, 'vn');
    const measure = percent ? fieldMeta(h, { percent, label: h.zh ? '取值' : 'Value' }) : fieldMeta(h, { label: h.zh ? '取值' : 'Value' });
    const spec = {
      chart: 'violin',
      ...note(h, '说明：轮廓为预计算密度，横线为上游给出的中位数，库不重新拟合。', 'Note: outlines are precomputed densities and the line is the supplied median; nothing is refit.'),
      encode: { category: 'category', density: 'density', median: 'median', ...(hasId ? { id: 'id' } : {}) },
      fields: { median: measure },
      data: rows,
    };
    if (!percent && h.chance(0.6)) spec.unit = measure.unit || h.unit();
    if (spec.unit) delete spec.fields.median.unit;
    return spec;
  },

  strip(h) {
    const categories = h.labels(h.count(1, 8));
    const per = h.profile.size === 'min' ? 1 : h.profile.size === 'max' ? h.int(40, 120) : h.int(3, 16);
    const totalCap = Math.min(1000, categories.length * per);
    const percent = h.chance(0.16);
    const rows = [];
    let index = 0;
    for (const category of categories) {
      const center = percent ? 0.2 + h.rng() * 0.6 : h.value({ signed: true, missing: false });
      const count = Math.max(1, Math.min(per, totalCap - rows.length));
      for (let k = 0; k < count; k += 1) {
        let value = percent
          ? tidy(Math.min(1, Math.max(0, center + (h.rng() - 0.5) * 0.3)))
          : tidy(center + (h.rng() - 0.5) * Math.abs(spread(h)) * 0.3);
        if (h.profile.values === 'equal' || (h.chance(0.15) && k > 0)) value = rows.at(-1)?.category === category ? rows.at(-1).value : value;
        const row = { category, value };
        rows.push(row);
        index += 1;
      }
    }
    const hasId = withIds(h, rows, 'st');
    const measure = percent ? fieldMeta(h, { percent }) : fieldMeta(h);
    const spec = {
      chart: 'strip',
      ...h.texts(),
      encode: { category: 'category', value: 'value', ...(hasId ? { id: 'id' } : {}) },
      fields: { value: measure },
      data: rows,
    };
    if (!percent && h.chance(0.6)) spec.unit = measure.unit || h.unit();
    if (spec.unit) delete spec.fields.value.unit;
    return spec;
  },

  scatter(h) {
    const n = h.profile.size === 'min' ? h.int(1, 3) : h.profile.size === 'max' ? h.int(120, 240) : h.count(6, 48);
    const withSize = h.chance(0.55);
    const withSeries = h.chance(0.5);
    const withLabel = h.chance(0.45);
    const withId = h.chance(0.6);
    const variant = h.pick(['dots', 'dots', 'plumb']);
    const percentX = h.chance(0.2);
    const logX = !percentX && h.chance(0.12);
    const logY = h.chance(0.1);
    const seriesNames = withSeries ? h.labels(h.int(2, 4)) : [];
    const labelNames = withLabel ? h.labels(Math.min(n, 12)) : [];
    const rows = Array.from({ length: n }, (_, index) => {
      const row = {};
      if (withId) row.id = `sc-${index + 1}`;
      if (withSeries) row.series = seriesNames[index % seriesNames.length];
      if (withLabel) row.label = index < labelNames.length ? labelNames[index] : `${labelNames[index % labelNames.length]} ${index + 1}`;
      const x = logX ? tidy(10 ** (-1 + h.rng() * 5)) : percentX ? tidy(h.rng()) : h.value({ signed: true, missing: false });
      const y = logY ? tidy(10 ** (-1 + h.rng() * 5)) : h.value({ signed: true, missing: false });
      row.x = x;
      row.y = y;
      if (withSize) row.size = tidy(Math.abs(h.value({ signed: false, missing: false })) || 1);
      return row;
    });
    if (h.chance(0.7) && rows.length > 4) {
      const extreme = rows[rows.length - 1];
      extreme.x = logX || percentX ? extreme.x : tidy(extreme.x * 40 || 4000);
      extreme.y = logY ? extreme.y : tidy((extreme.y || 1) * -25);
      if (rows.length > 6) {
        rows[rows.length - 2].x = rows[0].x;
        rows[rows.length - 2].y = rows[1].y;
      }
    }
    const xMeta = percentX ? fieldMeta(h, { percent: true, label: h.zh ? '转化率' : 'Rate' }) : fieldMeta(h, { label: h.zh ? '横轴' : 'X', scale: logX ? 'log' : null });
    const yMeta = fieldMeta(h, { label: h.zh ? '纵轴' : 'Y', scale: logY ? 'log' : null });
    if (!percentX && h.chance(0.3) && !logX) {
      const xs = rows.map((row) => row.x);
      xMeta.domain = [Math.min(...xs), Math.max(...xs)].map(tidy);
      if (xMeta.domain[0] === xMeta.domain[1]) xMeta.domain[1] = tidy(xMeta.domain[0] + 1);
    }
    const spec = {
      chart: 'scatter',
      ...h.texts(),
      encode: {
        x: 'x', y: 'y',
        ...(withSize ? { size: 'size' } : {}),
        ...(withSeries ? { series: 'series' } : {}),
        ...(withLabel && rows.some((row) => row.label) ? { label: 'label' } : {}),
        ...(withId ? { id: 'id' } : {}),
      },
      fields: { x: xMeta, y: yMeta, ...(withSize ? { size: fieldMeta(h, { label: h.zh ? '规模' : 'Size' }) } : {}) },
      data: rows,
    };
    if (variant === 'plumb') spec.variant = 'plumb';
    else if (h.chance(0.15)) spec.variant = 'dots';
    if (h.chance(0.3) && withId) {
      const field = h.pick(['x', 'y']);
      const values = rows.map((row) => row[field]).filter((value) => !logX && field === 'x' || !logY && field === 'y' ? true : value > 0);
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      const span = hi - lo || Math.abs(hi) || 1;
      const inside = tidy(lo + span * (0.2 + h.rng() * 0.5));
      const usable = (field === 'x' ? !logX : !logY) || inside > 0;
      if (usable) spec.annotations = [{ kind: 'rule', field, value: Math.max(field === 'x' && logX || field === 'y' && logY ? 1e-6 : -Infinity, inside), label: textOf(h) }];
      if (h.chance(0.5)) spec.annotations = [...(spec.annotations || []), { kind: 'note', record: rows[0].id, field, text: textOf(h) }];
    }
    return spec;
  },

  candlestick(h) {
    const n = h.count(1, 120);
    const categories = n > 16 ? h.days(n) : h.labels(n);
    let price = 20 + h.rng() * 80;
    if (h.profile.values === 'huge') price = 10 ** (5 + h.rng() * 2);
    if (h.profile.values === 'tiny') price = 0.01 + h.rng();
    const rows = categories.map((category, index) => {
      const swing = Math.abs(price) * (0.01 + h.rng() * 0.08) || 0.5;
      const open = tidy(Math.max(0.0001, price));
      const close = tidy(Math.max(0.0001, price + (h.chance(0.5) ? 1 : -1) * swing * h.rng()));
      const low = tidy(Math.max(0, Math.min(open, close) - swing * h.rng()));
      const high = tidy(Math.max(open, close) + swing * (0.1 + h.rng()));
      price = close;
      const row = { category, open, close, low, high };
      if (h.profile.values === 'equal') { row.close = row.open; row.low = row.open; row.high = row.open; }
      return row;
    });
    const hasId = withIds(h, rows, 'cd');
    const measure = fieldMeta(h, { label: h.zh ? '价格' : 'Price' });
    const spec = {
      chart: 'candlestick',
      ...note(h, '说明：空心为收盘不低于开盘，实心为收盘低于开盘。', 'Note: hollow marks a close at or above the open; filled marks a close below the open.'),
      encode: { category: 'category', open: 'open', close: 'close', low: 'low', high: 'high', ...(hasId ? { id: 'id' } : {}) },
      fields: { open: { ...measure }, close: { ...measure }, low: { ...measure }, high: { ...measure } },
      data: rows,
    };
    if (h.chance(0.7)) spec.unit = measure.unit || h.unit();
    if (spec.unit) for (const role of ['open', 'close', 'low', 'high']) delete spec.fields[role].unit;
    else {
      const unit = measure.unit || h.unit();
      for (const role of ['open', 'close', 'low', 'high']) spec.fields[role].unit = unit;
    }
    if (h.chance(0.25)) {
      const field = h.pick(['low', 'high', 'open', 'close']);
      const values = rows.flatMap((row) => [row.low, row.high]);
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      spec.annotations = [{ kind: 'rule', field, value: tidy(lo + (hi - lo) * (0.2 + h.rng() * 0.6) || lo), label: textOf(h) }];
      if (hasId && h.chance(0.5)) spec.annotations.push({ kind: 'note', record: rows[0].id, field, text: textOf(h) });
    }
    return spec;
  },
};
