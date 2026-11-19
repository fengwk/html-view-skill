// 构成图族的随机声明。每个生成器只产出符合 spec.js 契约的数据，不迁就当前实现的版面。
// 约七成走合理份额、递减漏斗和量程内仪表，其余故意用极值、全等、零和单极切片。

const tidy = (x) => Number(Number(x).toPrecision(4));

function realistic(h) {
  return h.rng() < 0.7;
}

function texts(h) {
  return h.texts();
}

/** 非负且合计大于 0。percent 时各项落在 0..1，不要求加总为 1。 */
function parts(h, n, { percent = false } = {}) {
  if (h.profile.values === 'equal') {
    const each = percent ? tidy(h.rng() * 0.4 + 0.05) : tidy(10 + h.rng() * 90);
    return Array.from({ length: n }, () => each);
  }
  if (h.profile.values === 'zeros') {
    const out = Array.from({ length: n }, () => (h.chance(0.45) ? 0 : h.value({ min: 0 })));
    if (!out.some((value) => value > 0)) out[0] = percent ? tidy(0.2 + h.rng() * 0.6) : tidy(10 + h.rng() * 40);
    return percent ? out.map((value) => (value > 1 ? tidy(value / (Math.max(...out) || 1)) : value)) : out;
  }
  if (!realistic(h)) {
    const dominant = h.int(0, n - 1);
    return Array.from({ length: n }, (_, i) => {
      if (i === dominant) return percent ? tidy(0.85 + h.rng() * 0.14) : tidy(10 ** (3 + h.rng() * 3));
      return h.chance(0.25) ? 0 : (percent ? tidy(h.rng() * 0.04) : tidy(h.rng() * 2));
    });
  }
  const raw = Array.from({ length: n }, () => 0.4 + h.rng());
  const sum = raw.reduce((total, value) => total + value, 0);
  if (percent) return raw.map((value) => tidy(value / sum));
  const scale = h.profile.values === 'tiny' ? 0.01 : h.profile.values === 'huge' ? 1e6 : h.profile.values === 'mixed' ? 10 ** h.int(0, 4) : 100;
  return raw.map((value) => tidy((value / sum) * scale * (0.6 + h.rng())));
}

function categories(h, n) {
  return h.labels(n);
}

function maybeId(h, encode, data) {
  if (!h.chance(0.45)) return;
  encode.id = 'id';
  data.forEach((row, i) => { row.id = `r${i + 1}`; });
}

function maybeSort(h, encode, valueField) {
  if (!h.chance(0.35)) return {};
  return { sort: { field: h.chance(0.7) ? valueField : encode.category, direction: h.pick(['asc', 'desc']) } };
}

function maybeEmphasis(h, encode, data) {
  if (!encode.id || !h.chance(0.3) || !data.length) return {};
  const picked = data[h.int(0, data.length - 1)].id;
  return { emphasis: { rows: [picked] } };
}

function compositionRows(h, { min = 1, max = 6, percent = false, id = true, sort = false } = {}) {
  const n = h.count(min, max);
  const names = categories(h, n);
  const values = parts(h, n, { percent });
  const data = names.map((category, i) => ({ category, value: values[i] }));
  const encode = { category: 'category', value: 'value' };
  if (id) maybeId(h, encode, data);
  return { data, encode, extra: { ...texts(h), ...(sort ? maybeSort(h, encode, 'value') : {}), ...maybeEmphasis(h, encode, data) } };
}

export const GENERATORS = {
  share(h) {
    const n = h.count(1, 6);
    // 校验按记录数计，share 最多 6 行，类别×系列不能超过这个上限。
    const seriesCount = h.chance(0.55) ? h.count(1, Math.max(1, Math.floor(6 / n))) : 1;
    const wide = seriesCount > 1;
    const names = categories(h, n);
    const series = wide ? h.labels(seriesCount) : [null];
    const percent = h.chance(0.3);
    const data = [];
    series.forEach((name) => {
      const values = parts(h, n, { percent });
      names.forEach((category, i) => {
        const row = { category, value: values[i] };
        if (wide) row.series = name;
        data.push(row);
      });
    });
    const seriesLabel = wide && h.chance(0.4) ? { series: { label: h.labels(1, { length: 'short' })[0] } } : {};
    const encode = { category: 'category', value: wide && h.chance(0.4) ? ['value'] : 'value', ...(wide ? { series: 'series' } : {}) };
    const fields = { ...(percent ? { value: { format: 'percent' } } : {}), ...seriesLabel };
    return {
      chart: 'share',
      ...texts(h),
      ...(percent ? {} : { unit: h.unit() }),
      variant: h.pick(['solid', 'ticks']),
      data,
      encode,
      ...(Object.keys(fields).length ? { fields } : {}),
    };
  },

  pie(h) {
    const { data, encode, extra } = compositionRows(h, { sort: true });
    const percent = h.chance(0.25);
    return { chart: 'pie', ...extra, ...(percent ? { fields: { value: { format: 'percent' } } } : { unit: h.unit() }), data, encode };
  },

  donut(h) {
    const { data, encode, extra } = compositionRows(h, { sort: true });
    const percent = h.chance(0.25);
    const fields = percent ? { value: { format: 'percent' } } : {};
    if (!percent && h.chance(0.5)) fields.value = { label: h.labels(1, { length: 'short' })[0] };
    return {
      chart: 'donut',
      ...extra,
      variant: h.pick(['solid', 'ticks']),
      ...(percent || fields.value?.label ? { fields } : { unit: h.unit() }),
      ...(percent ? {} : fields.value?.label ? { unit: h.unit(), fields } : {}),
      data,
      encode,
    };
  },

  'radial-share'(h) {
    const n = h.count(1, 6);
    const names = categories(h, n);
    const shares = parts(h, n, { percent: h.chance(0.4) });
    const valuePercent = h.chance(0.35);
    const intensityPercent = !valuePercent && h.chance(0.25);
    const intensities = (() => {
      if (realistic(h)) return Array.from({ length: n }, () => tidy(intensityPercent ? h.rng() : 10 + h.rng() * 90));
      const out = Array.from({ length: n }, () => (h.chance(0.3) ? 0 : tidy(intensityPercent ? h.rng() : h.value({ min: 0 }))));
      if (!out.some((value) => value > 0)) out[0] = intensityPercent ? tidy(0.2 + h.rng() * 0.7) : tidy(1 + h.rng() * 20);
      return intensityPercent ? out.map((value) => Math.min(1, value)) : out;
    })();
    const data = names.map((category, i) => ({ category, value: valuePercent ? tidy(shares[i] / shares.reduce((s, v) => s + v, 0) || shares[i]) : shares[i], intensity: intensities[i] }));
    if (valuePercent) {
      const sum = data.reduce((total, row) => total + row.value, 0) || 1;
      data.forEach((row) => { row.value = tidy(row.value / sum); });
    }
    const encode = { category: 'category', value: 'value', intensity: 'intensity' };
    maybeId(h, encode, data);
    const valueField = valuePercent ? { format: 'percent' } : { unit: h.unit() };
    const intensityField = intensityPercent ? { format: 'percent' } : { unit: h.zh ? '指数' : 'index' };
    if (h.chance(0.35) && !valuePercent) {
      const hi = Math.max(...data.map((row) => row.value), 1);
      valueField.domain = [0, tidy(hi * (1 + h.rng()))];
    }
    if (h.chance(0.35) && !intensityPercent) {
      const hi = Math.max(...data.map((row) => row.intensity), 1);
      intensityField.domain = [0, tidy(hi * (1 + h.rng()))];
    }
    return {
      chart: 'radial-share',
      ...texts(h),
      data,
      encode,
      fields: { value: valueField, intensity: intensityField },
      ...maybeSort(h, encode, 'value'),
      ...maybeEmphasis(h, encode, data),
    };
  },

  rose(h) {
    const { data, encode, extra } = compositionRows(h, { sort: true });
    const percent = h.chance(0.2);
    return { chart: 'rose', ...extra, ...(percent ? { fields: { value: { format: 'percent' } } } : { unit: h.unit() }), data, encode };
  },

  funnel(h) {
    const n = h.count(1, 6);
    const names = categories(h, n);
    const head = realistic(h) ? tidy(40 + h.rng() * 160) : tidy(h.profile.values === 'tiny' ? 0.01 + h.rng() : h.profile.values === 'huge' ? 1e6 + h.rng() * 1e6 : 20 + h.rng() * 80);
    const values = [head];
    for (let i = 1; i < n; i += 1) {
      const previous = values[i - 1];
      if (!realistic(h) && h.chance(0.2)) values.push(h.chance(0.5) ? 0 : previous);
      else values.push(tidy(previous * (0.35 + h.rng() * 0.6)));
    }
    const data = names.map((category, i) => ({ category, value: values[i] }));
    const encode = { category: 'category', value: 'value' };
    maybeId(h, encode, data);
    return {
      chart: 'funnel',
      ...texts(h),
      unit: h.unit(),
      variant: h.pick(['bars', 'hourglass']),
      data,
      encode,
      ...maybeEmphasis(h, encode, data),
    };
  },

  waffle(h) {
    const { data, encode, extra } = compositionRows(h, { id: false });
    const percent = h.chance(0.25);
    return {
      chart: 'waffle',
      ...extra,
      variant: h.pick(['dots', 'field']),
      ...(percent ? { fields: { value: { format: 'percent' } } } : { unit: h.unit() }),
      data,
      encode,
    };
  },

  tally(h) {
    const n = h.count(1, 6);
    const names = categories(h, n);
    const values = (() => {
      if (h.profile.values === 'equal') return Array.from({ length: n }, () => tidy(0.15 + h.rng() * 0.5));
      if (h.profile.values === 'zeros') {
        const out = Array.from({ length: n }, () => (h.chance(0.4) ? 0 : tidy(h.rng())));
        return out;
      }
      if (!realistic(h)) return Array.from({ length: n }, () => (h.chance(0.2) ? 0 : h.chance(0.2) ? 1 : tidy(h.rng() ** 2)));
      return Array.from({ length: n }, () => tidy(0.08 + h.rng() * 0.7));
    })();
    const data = names.map((category, i) => ({ category, value: values[i] }));
    const encode = { category: 'category', value: 'value' };
    return {
      chart: 'tally',
      ...texts(h),
      data,
      encode,
      fields: { value: { format: 'percent', ...(h.chance(0.3) ? { decimals: h.int(0, 2) } : {}) } },
      ...maybeSort(h, encode, 'value'),
    };
  },

  gauge(h) {
    const percent = h.chance(0.4);
    const min = percent ? 0 : (h.chance(0.7) ? 0 : tidy(h.int(0, 40)));
    const max = percent ? 1 : tidy(min + (h.profile.values === 'huge' ? 10 ** h.int(3, 6) : 20 + h.rng() * 180));
    const span = max - min;
    const atEdge = !realistic(h) && h.chance(0.45);
    const value = atEdge ? (h.chance(0.5) ? min : max) : tidy(min + span * (0.15 + h.rng() * 0.7));
    const withTarget = h.chance(0.65);
    const target = withTarget ? tidy(min + span * h.rng()) : undefined;
    const row = { value: percent ? tidy(Math.min(1, Math.max(0, value))) : value };
    if (withTarget) row.target = percent ? tidy(Math.min(1, Math.max(0, target))) : target;
    if (percent) {
      row.value = Math.min(1, Math.max(0, row.value));
      if (withTarget) row.target = Math.min(1, Math.max(0, row.target));
    }
    return {
      chart: 'gauge',
      ...texts(h),
      variant: h.pick(['bar', 'arc', 'ticks']),
      range: percent ? [0, 1] : [min, max],
      ...(percent ? { fields: { value: { format: 'percent' }, ...(withTarget ? { target: { format: 'percent' } } : {}) } } : { unit: h.unit() }),
      data: [row],
      encode: { value: 'value', ...(withTarget ? { target: 'target' } : {}) },
    };
  },

  bullet(h) {
    const n = h.count(1, 12);
    const names = categories(h, n);
    const percent = h.chance(0.25);
    const data = names.map((category) => {
      if (percent) {
        const target = realistic(h) ? tidy(0.3 + h.rng() * 0.6) : tidy(h.chance(0.15) ? 0 : h.rng());
        const actual = realistic(h) ? tidy(target * (0.6 + h.rng() * 0.7)) : tidy(h.chance(0.1) ? 0 : h.rng() * 1.4);
        return { category, actual: Math.min(1, actual), target: Math.min(1, target) };
      }
      const target = realistic(h) ? tidy(40 + h.rng() * 160) : h.value({ min: 0 });
      const actual = realistic(h) ? tidy(Math.max(0, target) * (0.5 + h.rng() * 0.9)) : h.value({ min: 0 });
      return { category, actual, target };
    });
    const encode = { category: 'category', actual: 'actual', target: 'target' };
    maybeId(h, encode, data);
    const meta = percent ? { format: 'percent' } : {};
    return {
      chart: 'bullet',
      ...texts(h),
      ...(percent ? { fields: { actual: meta, target: { format: 'percent' } } } : { unit: h.unit() }),
      data,
      encode,
      ...maybeEmphasis(h, encode, data),
    };
  },
};
