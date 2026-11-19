// 笛卡尔图族的随机声明。每个生成器只产出符合 spec.js 契约的数据，不迁就当前实现的版面。
const ICONS = ['box', 'coin', 'user', 'star', 'chart-bar'];

const tidy = (x) => Number(Number(x).toPrecision(4));

function seriesCount(h) {
  if (h.profile.size === 'min') return 1;
  if (h.profile.size === 'small') return h.int(1, 2);
  return h.count(1, 6);
}

function panelCount(h) {
  if (h.profile.size === 'min') return 1;
  if (h.profile.size === 'small') return h.int(1, 2);
  return h.count(2, 6);
}

function adversarial(h) {
  return h.chance(0.3);
}

function trend(h, i, n, { signed = false, floor = null } = {}) {
  const base = h.value({ signed: false, missing: false });
  const span = Math.max(Math.abs(base), 1);
  const slope = (h.rng() * 2 - 1) * span * 0.8;
  const wave = Math.sin((i / Math.max(1, n - 1)) * Math.PI * h.int(1, 3)) * span * 0.25;
  let x = tidy(base + slope * (i / Math.max(1, n - 1)) + wave + (h.rng() - 0.5) * span * 0.15);
  if (signed && h.profile.sign === 'mixed' && h.chance(0.4)) x = -Math.abs(x);
  if (floor != null) x = Math.max(floor, x);
  return x;
}

function seriesValues(h, n, { signed = false, missing = false, positive = false, complete = false } = {}) {
  if (h.profile.values === 'zeros') return h.values(n, { signed: false, missing: false, min: 0, max: 0 });
  if (h.profile.values === 'equal') return h.values(n, { signed, missing, ...(positive ? { min: 0 } : {}) });
  if (adversarial(h) || ['tiny', 'huge', 'mixed'].includes(h.profile.values)) {
    return h.values(n, { signed: signed && !positive, missing, ...(positive ? { min: 0 } : {}) });
  }
  const out = Array.from({ length: n }, (_, i) => trend(h, i, n, { signed: signed && !positive, floor: positive ? 0 : null }));
  if (missing && h.profile.missing) {
    for (let i = 2; i < n; i += 1) if (h.chance(0.15)) out[i] = null;
  }
  if (complete) {
    for (let i = 0; i < n; i += 1) if (out[i] == null) out[i] = trend(h, i, n, { floor: positive ? 0 : null });
  }
  return out;
}

function maybeDomain(h, values, { includeZero = false, log = false } = {}) {
  if (!h.chance(0.2)) return undefined;
  const finite = values.filter((value) => value != null && Number.isFinite(value));
  if (finite.length < 2) return undefined;
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (includeZero) min = Math.min(0, min);
  if (log) min = Math.min(...finite.filter((value) => value > 0));
  if (!(max > min)) max = min + Math.max(Math.abs(min), 1);
  if (log && !(min > 0)) return undefined;
  return [tidy(min), tidy(max * (1 + 1e-6))];
}

function annotationsFor(h, field, values, { notes = false, records = [], domain = null } = {}) {
  if (!h.chance(0.35)) return undefined;
  const finite = values.filter((value) => value != null && Number.isFinite(value));
  if (!finite.length) return undefined;
  const min = domain ? domain[0] : Math.min(...finite);
  const max = domain ? domain[1] : Math.max(...finite);
  const span = max - min || Math.max(Math.abs(max), 1);
  const inside = (value) => tidy(Math.min(max - span * 1e-6, Math.max(min + span * 1e-6, value)));
  const items = [];
  if (h.chance(0.7)) {
    items.push({
      kind: 'rule', field, value: inside(min + span * (0.2 + h.rng() * 0.6)),
      label: h.zh ? '目标' : 'target',
    });
  }
  if (h.chance(0.5)) {
    const from = inside(min + span * h.rng() * 0.3);
    const to = inside(Math.max(from + span * 0.05, from + span * (0.1 + h.rng() * 0.3)));
    if (to > from) items.push({ kind: 'band', field, from, to, label: h.zh ? '区间' : 'band' });
  }
  if (notes && records.length && h.chance(0.6)) {
    const record = h.pick(records.filter((item) => item.value != null));
    if (record) items.push({ kind: 'note', record: record.id, field, text: h.zh ? '备注' : 'note' });
  }
  return items.length ? items : undefined;
}

function categoryAxis(h, n) {
  if (h.chance(0.65)) return { key: 'month', labels: h.months(n), type: 'month' };
  return { key: 'category', labels: h.labels(n), type: 'category' };
}

function longRows(categories, names, columns, { ids = false } = {}) {
  const rows = [];
  categories.labels.forEach((category, index) => {
    names.forEach((name, seriesIndex) => {
      const row = { [categories.key]: category, series: name, value: columns[seriesIndex][index] };
      if (ids) row.id = `r${index}-${seriesIndex}`;
      rows.push(row);
    });
  });
  return rows;
}

function wideRows(categories, keys, columns, extras = () => ({})) {
  return categories.labels.map((category, index) => ({
    [categories.key]: category,
    ...Object.fromEntries(keys.map((key, seriesIndex) => [key, columns[seriesIndex][index]])),
    ...extras(index),
  }));
}

function lineArea(h, chart) {
  const n = h.count(3, 120);
  const names = h.labels(seriesCount(h));
  const keys = names.map((_, index) => `s${index + 1}`);
  const categories = categoryAxis(h, n);
  const percent = chart === 'area' && h.chance(0.22);
  const stacked = chart === 'line' ? h.chance(0.18) : h.chance(0.45);
  const stack = stacked ? (percent && chart === 'area' ? 'percent' : 'absolute') : undefined;
  const missing = !stacked && h.profile.missing;
  const positive = stack === 'percent' || (chart === 'area' && h.chance(0.7));
  const columns = names.map(() => seriesValues(h, n, {
    signed: !positive, missing, positive, complete: stacked,
  }));
  if (stack === 'percent') {
    for (let index = 0; index < n; index += 1) {
      if (columns.every((column) => !(column[index] > 0))) columns[0][index] = tidy(Math.max(columns[0][index] || 0, 0.01));
    }
  }
  const band = !stacked && names.length === 1 && h.chance(chart === 'line' ? 0.18 : 0.16);
  const useLong = !band && names.length > 1 && h.chance(0.45);
  const withId = h.chance(0.3);
  const log = chart === 'line' && !stacked && !percent && h.chance(0.12);
  const texts = h.texts();
  if (band && !texts.note) texts.note = h.zh ? '说明：区间为虚构上下界' : 'Note: band is a fictional range';
  const sharedUnit = percent ? null : h.unit();
  if (log) {
    for (const column of columns) {
      for (let index = 0; index < column.length; index += 1) {
        if (column[index] != null) column[index] = tidy(Math.max(Math.abs(column[index]), 0.01));
      }
    }
  }
  const fieldMeta = (label) => {
    const meta = { label };
    if (percent) meta.format = 'percent';
    else if (useLong || names.length > 1 || band) meta.unit = sharedUnit;
    if (log) meta.scale = 'log';
    return meta;
  };
  let data;
  let encode;
  let fields;
  if (useLong) {
    data = longRows(categories, names, columns, { ids: withId });
    encode = { category: categories.key, value: 'value', series: 'series', ...(withId ? { id: 'id' } : {}) };
    fields = { [categories.key]: { type: categories.type }, value: fieldMeta(h.zh ? '数值' : 'Value') };
  } else {
    data = wideRows(categories, keys, columns);
    encode = { category: categories.key, value: keys.length === 1 ? keys[0] : keys };
    fields = {
      [categories.key]: { type: categories.type },
      ...Object.fromEntries(keys.map((key, index) => [key, fieldMeta(names[index])])),
    };
    if (withId && keys.length === 1) {
      data.forEach((row, index) => { row.id = `r${index}`; });
      encode.id = 'id';
    }
  }
  if (band) {
    const valueKey = encode.value;
    const lower = [];
    const upper = [];
    data.forEach((row, index) => {
      const value = row[valueKey];
      if (value == null) {
        lower.push(null);
        upper.push(null);
        row.lower = null;
        row.upper = null;
        return;
      }
      const pad = Math.max(Math.abs(value) * (0.05 + h.rng() * 0.3), 0.01);
      row.lower = tidy(value - pad);
      row.upper = tidy(value + pad);
      lower.push(row.lower);
      upper.push(row.upper);
    });
    encode.lower = 'lower';
    encode.upper = 'upper';
    const shared = fields[valueKey].unit;
    fields.lower = { label: h.zh ? '下界' : 'Lower', unit: shared };
    fields.upper = { label: h.zh ? '上界' : 'Upper', unit: shared };
    const domain = maybeDomain(h, [...columns.flat(), ...lower, ...upper], { includeZero: chart === 'area' });
    if (domain) fields[valueKey].domain = fields.lower.domain = fields.upper.domain = domain;
  } else {
    const domainValues = columns.flat();
    const domain = maybeDomain(h, domainValues, { includeZero: chart === 'area' || Boolean(stack), log });
    if (domain) {
      const targets = useLong ? ['value'] : keys;
      for (const key of targets) fields[key].domain = domain;
    }
  }
  const valueKey = typeof encode.value === 'string' ? encode.value : encode.value[0];
  const annotationValues = data.map((row) => row[valueKey]);
  const records = encode.id ? data.map((row) => ({ id: row.id, value: row[valueKey] })) : [];
  const annotations = annotationsFor(h, valueKey, annotationValues, { notes: Boolean(encode.id), records, domain: fields[valueKey]?.domain || null });
  let variant;
  if (chart === 'line' && !stacked && !band && keys.length === 1 && !useLong && h.chance(0.7)) variant = h.pick(['counter', 'barcode']);
  const emphasis = useLong && encode.series && h.chance(0.2)
    ? { series: names.slice(0, h.int(1, names.length)) }
    : !useLong && Array.isArray(encode.value) && h.chance(0.2)
      ? { fields: encode.value.slice(0, h.int(1, encode.value.length)) }
      : undefined;
  const rootUnit = !percent && !useLong && names.length === 1 && !band ? sharedUnit : undefined;
  return {
    chart, ...texts, ...(rootUnit ? { unit: rootUnit } : {}),
    data, encode, fields,
    ...(stack ? { stack } : {}),
    ...(variant ? { variant } : {}),
    ...(annotations ? { annotations } : {}),
    ...(emphasis ? { emphasis } : {}),
    ...(h.chance(0.15) ? { interaction: h.chance(0.5) ? ['inspect', 'legend'] : ['inspect'] } : {}),
  };
}

function barColumn(h, chart) {
  const maxCategories = chart === 'bar' ? 24 : 60;
  const variant = h.pick(['solid', 'solid', 'rungs', 'pictorial', 'lollipop']);
  const wide = chart === 'column' && variant === 'solid' && h.chance(0.25);
  const n = wide ? h.count(25, maxCategories) : h.count(2, chart === 'bar' ? 24 : 24);
  const unitVariant = ['rungs', 'pictorial'].includes(variant);
  const grouped = !wide && !unitVariant && h.chance(0.55);
  const names = grouped ? h.labels(seriesCount(h)) : h.labels(1);
  const keys = names.map((_, index) => `s${index + 1}`);
  const categories = categoryAxis(h, n);
  const percent = !unitVariant && h.chance(0.2);
  const stacked = percent || h.chance(0.35);
  const stack = stacked ? (percent ? 'percent' : 'absolute') : undefined;
  const positive = percent || unitVariant || h.chance(0.35);
  const columns = names.map(() => seriesValues(h, n, {
    signed: !positive, missing: false, positive, complete: true,
  }));
  if (percent) {
    for (let index = 0; index < n; index += 1) {
      if (columns.every((column) => !(column[index] > 0))) columns[0][index] = tidy(0.05 + h.rng());
    }
  }
  const useLong = names.length > 1 && h.chance(0.4);
  const withId = h.chance(0.3);
  const sharedUnit = percent ? null : h.unit();
  const meta = (label) => (percent ? { label, format: 'percent' } : names.length > 1 || useLong ? { label, unit: sharedUnit } : { label });
  let data;
  let encode;
  let fields;
  if (useLong) {
    data = longRows(categories, names, columns, { ids: withId });
    encode = { category: categories.key, value: 'value', series: 'series', ...(withId ? { id: 'id' } : {}) };
    fields = { [categories.key]: { type: categories.type }, value: meta(h.zh ? '数值' : 'Value') };
  } else {
    data = wideRows(categories, keys, columns);
    encode = { category: categories.key, value: keys.length === 1 ? keys[0] : keys };
    fields = { [categories.key]: { type: categories.type }, ...Object.fromEntries(keys.map((key, index) => [key, meta(names[index])])) };
    if (withId && keys.length === 1) {
      data.forEach((row, index) => { row.id = `r${index}`; });
      encode.id = 'id';
    }
  }
  const domain = maybeDomain(h, columns.flat(), { includeZero: true });
  if (domain) for (const key of (useLong ? ['value'] : keys)) fields[key].domain = domain;
  const finite = columns.flat().filter((value) => value != null && value > 0);
  const largest = finite.length ? Math.max(...finite) : 1;
  // 全等值时柱高铺满绘图区，符号沿柱高排列，单位必须大于柱高/可读槽数。
  const plotSpan = chart === 'column' ? 180 : Math.max(80, h.profile.width * 0.4);
  const maxMarks = Math.max(1, Math.floor(plotSpan / (variant === 'pictorial' ? 24 : 9)));
  const unitMark = unitVariant ? {
    value: tidy(Math.max(largest / Math.min(h.int(1, 4), maxMarks), largest > 1 ? 1 : largest)),
    label: h.zh ? '单位' : 'unit',
    ...(variant === 'pictorial' ? { icon: h.pick(ICONS) } : {}),
  } : undefined;
  const valueKey = typeof encode.value === 'string' ? encode.value : encode.value[0];
  const annotations = annotationsFor(h, valueKey, data.map((row) => row[valueKey]), {
    notes: Boolean(encode.id),
    records: encode.id ? data.map((row) => ({ id: row.id, value: row[valueKey] })) : [],
    domain: fields[valueKey]?.domain || null,
  });
  const sort = !useLong && keys.length === 1 && !fields[keys[0]].domain && h.chance(0.25)
    ? { field: h.chance(0.5) ? categories.key : keys[0], direction: h.pick(['asc', 'desc']) }
    : undefined;
  return {
    chart, ...h.texts(), ...(!percent && names.length === 1 && !useLong ? { unit: sharedUnit } : {}),
    data, encode, fields,
    ...(stack ? { stack } : {}),
    ...(variant !== 'solid' ? { variant } : {}),
    ...(unitMark ? { unitMark } : {}),
    ...(annotations ? { annotations } : {}),
    ...(sort ? { sort } : {}),
  };
}

export const GENERATORS = {
  line(h) {
    return lineArea(h, 'line');
  },
  area(h) {
    return lineArea(h, 'area');
  },
  bar(h) {
    return barColumn(h, 'bar');
  },
  column(h) {
    return barColumn(h, 'column');
  },
  sparkline(h) {
    const n = h.count(3, 120);
    const categories = categoryAxis(h, n);
    const percent = h.chance(0.2);
    const values = seriesValues(h, n, { signed: !percent, missing: true, positive: percent });
    const data = categories.labels.map((label, index) => ({ [categories.key]: label, value: values[index] }));
    const field = percent ? { label: h.zh ? '比率' : 'Rate', format: 'percent' } : { label: h.zh ? '数值' : 'Value' };
    const domain = maybeDomain(h, values, { includeZero: false });
    if (domain) field.domain = domain;
    return {
      chart: 'sparkline', ...h.texts(), ...(percent ? {} : { unit: h.unit() }),
      data, encode: { category: categories.key, value: 'value' },
      fields: { [categories.key]: { type: categories.type }, value: field },
    };
  },
  'small-multiples'(h) {
    const panels = panelCount(h);
    const n = h.count(3, 120);
    const categories = categoryAxis(h, n);
    const longForm = h.chance(0.45);
    const percent = h.chance(0.2);
    const columns = Array.from({ length: panels }, () => seriesValues(h, n, { signed: !percent, missing: true, positive: percent }));
    const names = h.labels(panels);
    const shared = percent ? { format: 'percent' } : { unit: h.unit() };
    const domain = maybeDomain(h, columns.flat());
    if (longForm) {
      const data = [];
      categories.labels.forEach((category, index) => {
        names.forEach((name, panel) => data.push({ [categories.key]: category, panel: name, value: columns[panel][index] }));
      });
      return {
        chart: 'small-multiples', ...h.texts(),
        data, encode: { category: categories.key, value: 'value', panel: 'panel' },
        fields: {
          [categories.key]: { type: categories.type },
          value: { label: h.zh ? '数值' : 'Value', ...shared, ...(domain ? { domain } : {}) },
        },
      };
    }
    const keys = names.map((_, index) => `p${index + 1}`);
    const fieldShared = percent ? shared : {};
    return {
      chart: 'small-multiples', ...h.texts(), ...(percent ? {} : { unit: shared.unit }),
      data: wideRows(categories, keys, columns),
      encode: { category: categories.key, value: keys },
      fields: {
        [categories.key]: { type: categories.type },
        ...Object.fromEntries(keys.map((key, index) => [key, { label: names[index], ...fieldShared, ...(domain ? { domain } : {}) }])),
      },
    };
  },
  stream(h) {
    const n = h.count(3, 120);
    const names = h.labels(Math.max(2, seriesCount(h)));
    const keys = names.map((_, index) => `s${index + 1}`);
    const categories = categoryAxis(h, n);
    const columns = names.map(() => seriesValues(h, n, { positive: true, complete: true }));
    for (let index = 0; index < n; index += 1) {
      if (columns.every((column) => !(column[index] > 0))) columns[0][index] = tidy(Math.max(columns[0][index], 0.01));
    }
    const useLong = h.chance(0.4);
    const unit = h.unit();
    const data = useLong ? longRows(categories, names, columns) : wideRows(categories, keys, columns);
    const encode = useLong
      ? { category: categories.key, value: 'value', series: 'series' }
      : { category: categories.key, value: keys.length === 1 ? keys[0] : keys };
    const fields = useLong
      ? { [categories.key]: { type: categories.type }, value: { label: h.zh ? '流量' : 'Flow', unit } }
      : { [categories.key]: { type: categories.type }, ...Object.fromEntries(keys.map((key, index) => [key, { label: names[index] }])) };
    return { chart: 'stream', ...h.texts(), ...(useLong ? {} : { unit }), data, encode, fields };
  },
  'split-compare'(h) {
    const n = h.count(3, 120);
    const categories = categoryAxis(h, n);
    const percentUpper = h.chance(0.3);
    const percentLower = !percentUpper && h.chance(0.3);
    const upper = seriesValues(h, n, { positive: true, complete: true });
    const lower = seriesValues(h, n, { positive: percentLower, signed: !percentLower, complete: true });
    const data = categories.labels.map((label, index) => ({ [categories.key]: label, upper: upper[index], lower: lower[index] }));
    const upperField = { label: h.zh ? '上方' : 'Upper', ...(percentUpper ? { format: 'percent' } : { unit: h.unit() }) };
    const lowerField = { label: h.zh ? '下方' : 'Lower', ...(percentLower ? { format: 'percent' } : { unit: h.unit() }) };
    const upperDomain = maybeDomain(h, upper, { includeZero: true });
    const lowerDomain = maybeDomain(h, lower, { includeZero: true });
    if (upperDomain) upperField.domain = upperDomain;
    if (lowerDomain) lowerField.domain = lowerDomain;
    return {
      chart: 'split-compare', ...h.texts(), data,
      encode: { category: categories.key, upper: 'upper', lower: 'lower' },
      fields: { [categories.key]: { type: categories.type }, upper: upperField, lower: lowerField },
    };
  },
  combo(h) {
    const n = h.count(3, 120);
    const categories = categoryAxis(h, n);
    const layerCount = h.count(1, 6);
    const marks = Array.from({ length: layerCount }, () => h.pick(['line', 'column', 'area']));
    const right = layerCount > 1 && h.chance(0.6);
    const layers = marks.map((mark, index) => ({
      mark, field: `m${index + 1}`, axis: right && index === marks.length - 1 ? 'right' : 'left',
    }));
    const areaSide = (axis) => layers.some((layer) => layer.axis === axis && layer.mark !== 'line');
    const leftPercent = !areaSide('left') && h.chance(0.2);
    const rightPercent = right && !areaSide('right') && !leftPercent && h.chance(0.4);
    const leftUnit = leftPercent ? null : h.unit();
    const rightUnit = rightPercent ? null : h.unit();
    const columns = layers.map((layer) => seriesValues(h, n, {
      signed: layer.mark === 'line' && !areaSide(layer.axis), missing: layer.mark === 'line', positive: layer.mark !== 'line' || areaSide(layer.axis), complete: layer.mark !== 'line',
    }));
    const withId = h.chance(0.35);
    const data = categories.labels.map((label, index) => ({
      [categories.key]: label,
      ...Object.fromEntries(layers.map((layer, layerIndex) => [layer.field, columns[layerIndex][index]])),
      ...(withId ? { id: `r${index}` } : {}),
    }));
    const fields = { [categories.key]: { type: categories.type } };
    for (const [index, layer] of layers.entries()) {
      const percent = layer.axis === 'right' ? rightPercent : leftPercent;
      const unit = layer.axis === 'right' ? rightUnit : leftUnit;
      const meta = { label: h.labels(1)[0], ...(percent ? { format: 'percent' } : { unit }) };
      const domain = maybeDomain(h, columns[index], { includeZero: areaSide(layer.axis) });
      if (domain) meta.domain = domain;
      fields[layer.field] = meta;
    }
    const annotated = h.pick(layers);
    const annotations = annotationsFor(h, annotated.field, data.map((row) => row[annotated.field]), {
      notes: withId, records: withId ? data.map((row) => ({ id: row.id, value: row[annotated.field] })) : [],
    });
    return {
      chart: 'combo', ...h.texts(), data,
      encode: { category: categories.key, ...(withId ? { id: 'id' } : {}) },
      layers, fields, ...(annotations ? { annotations } : {}),
    };
  },
};
