// 矩阵、时间与多维图族的随机声明。只产出符合 spec.js 契约的数据，不迁就当前实现的版面。

const monthType = { type: 'month' };
const dateType = { type: 'date' };
const datetimeType = { type: 'datetime' };

/** 按画像在契约上下限之间取类别数；min/max 画像钉在端点。 */
function span(h, min, max) {
  return h.count(min, max);
}

/**
 * 矩阵行列名用短标签。长英文会让格内换行逐字测宽，超过探针的 6 轮测字上限后被记成 RENDER_ERROR。
 * 多行仍用序号区分，长度随数量增长，用来检查行标签换行与列头压缩。
 */
function axisLabels(h, n) {
  return h.labels(n, { length: 'short' });
}

/** 70% 真实形态，30% 极端量级、全相等或大量零。 */
function realistic(h) {
  return h.chance(0.7);
}

/** 根单位与字段级 unit/percent 互斥：比例字段走字段声明。 */
function rootUnit(h, percent) {
  return percent ? {} : { unit: h.unit() };
}

function fieldLabel(h, fallback) {
  return h.chance(0.55) ? h.labels(1)[0] : fallback;
}

function matrixAxes(h) {
  const rows = span(h, 1, 24);
  const cols = span(h, 1, 24);
  const rowNames = axisLabels(h, rows);
  const temporal = h.chance(0.45);
  const columnNames = temporal ? h.months(cols) : axisLabels(h, cols);
  return { rows, cols, rowNames, columnNames, temporal };
}

/** 长表：缺格不写记录（契约禁止 null）。密度从稀疏到满格。 */
function matrixCells(h, rowNames, columnNames, valueOf) {
  const cells = [];
  for (const row of rowNames) {
    for (const column of columnNames) cells.push([row, column]);
  }
  const density = h.profile.missing ? h.pick([0.35, 0.55, 0.75, 0.9]) : h.pick([0.7, 0.85, 1]);
  const keep = Math.max(1, Math.round(cells.length * density));
  for (let i = cells.length - 1; i > 0; i -= 1) {
    const j = h.int(0, i);
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells.slice(0, keep).map(([row, column]) => ({ row, column, value: valueOf() }));
}

function measure(h, { signed = false, percent = false, min = null, max = null } = {}) {
  if (percent) return h.value({ signed: false, missing: false, min: 0, max: 1 });
  return h.value({ signed, missing: false, min, max });
}

function axisDomain(h, names, use) {
  if (!use || names.length < 2) return undefined;
  const extra = h.chance(0.4) ? h.labels(h.int(1, 2)) : [];
  const ordered = h.chance(0.5) ? [...names] : [...names].reverse();
  return [...ordered, ...extra.filter((name) => !ordered.includes(name))];
}

export const GENERATORS = {
  heatmap(h) {
    const { rowNames, columnNames, temporal } = matrixAxes(h);
    const variant = h.pick(['cells', 'dots', 'arc']);
    const percent = variant === 'arc' ? h.chance(0.55) : h.chance(0.2);
    const signed = variant !== 'arc' && h.profile.sign === 'mixed';
    const data = matrixCells(h, rowNames, columnNames, () => measure(h, { signed, percent }));
    const values = data.map((row) => row.value);
    const valueField = { label: fieldLabel(h, h.zh ? '热度' : 'Heat') };
    if (percent) valueField.format = 'percent';
    else if (h.chance(0.7)) valueField.unit = h.unit();
    if (variant === 'arc' && !percent) {
      const hi = Math.max(1, ...values, 0);
      valueField.domain = [0, hi * (h.chance(0.3) ? 1.25 : 1)];
    } else if (h.chance(0.35) && values.length) {
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      valueField.domain = lo === hi ? [lo - 1, hi + 1] : [lo, hi];
    }
    const fields = { value: valueField };
    if (temporal) fields.column = monthType;
    const rowDomain = axisDomain(h, rowNames, h.chance(0.3));
    const columnDomain = axisDomain(h, columnNames, h.chance(0.3));
    if (rowDomain) fields.row = { ...(fields.row || {}), type: 'category', domain: rowDomain };
    if (columnDomain) fields.column = { ...(fields.column || {}), domain: columnDomain };
    return {
      chart: 'heatmap',
      ...h.texts(),
      ...rootUnit(h, percent || valueField.unit),
      variant,
      data,
      encode: { row: 'row', column: 'column', value: 'value' },
      fields,
    };
  },

  'bubble-matrix'(h) {
    const { rowNames, columnNames, temporal } = matrixAxes(h);
    const percent = h.chance(0.2);
    const data = matrixCells(h, rowNames, columnNames, () => measure(h, { percent, min: 0 }));
    const valueField = { label: fieldLabel(h, h.zh ? '规模' : 'Size') };
    if (percent) valueField.format = 'percent';
    else if (h.chance(0.65)) valueField.unit = h.unit();
    const fields = {
      row: { label: fieldLabel(h, h.zh ? '行' : 'Row') },
      column: { label: fieldLabel(h, h.zh ? '列' : 'Column'), ...(temporal ? monthType : {}) },
      value: valueField,
    };
    const rowDomain = axisDomain(h, rowNames, h.chance(0.35));
    const columnDomain = axisDomain(h, columnNames, h.chance(0.35));
    if (rowDomain) fields.row.domain = rowDomain;
    if (columnDomain) fields.column.domain = columnDomain;
    if (h.chance(0.25) && data.some((row) => row.value > 0)) {
      const hi = Math.max(...data.map((row) => row.value));
      fields.value.domain = [0, hi === 0 ? 1 : hi];
    }
    return {
      chart: 'bubble-matrix',
      ...h.texts(),
      ...rootUnit(h, percent || valueField.unit),
      data,
      encode: { row: 'row', column: 'column', value: 'value' },
      fields,
    };
  },

  calendar(h) {
    const year = h.int(2019, 2026);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const yearDays = leap ? 366 : 365;
    const variant = h.pick(['cells', 'dots']);
    const percent = h.chance(0.2);
    const signed = !percent && h.profile.sign === 'mixed';
    // 从几天到整年；范围形状随规模画像变化，不按宽度收缩。
    const shape = h.profile.size === 'min' ? 'days'
      : h.profile.size === 'small' ? h.pick(['days', 'month'])
        : h.profile.size === 'max' ? h.pick(['quarter', 'year'])
          : h.pick(['days', 'month', 'quarter', 'year']);
    let dates;
    if (shape === 'days') dates = h.days(h.int(2, 20), `${year}-01-01`).filter((day) => day.startsWith(String(year)));
    else if (shape === 'month') dates = h.days(h.int(28, 62), `${year}-${String(h.int(1, 11)).padStart(2, '0')}-01`).filter((day) => day.startsWith(String(year)));
    else if (shape === 'quarter') dates = h.days(h.int(80, 160), `${year}-${String(h.pick([1, 4, 7, 10])).padStart(2, '0')}-01`).filter((day) => day.startsWith(String(year)));
    else dates = h.days(yearDays, `${year}-01-01`);
    if (dates.length < 2) dates = h.days(14, `${year}-06-01`).filter((day) => day.startsWith(String(year)));
    const keep = h.profile.missing ? h.pick([0.15, 0.4, 0.7]) : h.pick([0.55, 0.8, 1]);
    const chosen = dates.filter(() => h.rng() < keep);
    const used = (chosen.length ? chosen : dates.slice(0, 3));
    const data = used.map((date) => ({ date, value: measure(h, { signed, percent }) }));
    const valueField = { label: fieldLabel(h, h.zh ? '当日' : 'Daily') };
    if (percent) valueField.format = 'percent';
    return {
      chart: 'calendar',
      ...h.texts(),
      ...rootUnit(h, percent),
      period: String(year),
      variant,
      data,
      encode: { date: 'date', value: 'value' },
      fields: { date: dateType, value: valueField },
    };
  },

  bump(h) {
    const periods = span(h, 2, 24);
    const seriesCount = span(h, 1, 12);
    const categories = h.chance(0.6) ? h.months(periods) : h.labels(periods);
    const names = h.labels(seriesCount);
    const withId = h.chance(0.35);
    const ranks = new Map(names.map((name) => [name, h.int(1, seriesCount)]));
    const data = [];
    categories.forEach((category, index) => {
      if (index > 0 && realistic(h)) {
        const mover = h.pick(names);
        const other = h.pick(names.filter((name) => name !== mover));
        if (other) {
          const next = ranks.get(other);
          ranks.set(other, ranks.get(mover));
          ranks.set(mover, next);
        }
      } else if (!realistic(h)) {
        names.forEach((name) => ranks.set(name, h.int(1, seriesCount)));
      }
      const seen = new Map();
      names.forEach((name) => {
        const missing = h.profile.missing && h.chance(0.12);
        let rank = missing ? null : ranks.get(name);
        if (rank != null) {
          const peers = seen.get(rank) || 0;
          seen.set(rank, peers + 1);
        }
        data.push({
          category,
          series: name,
          rank,
          ...(withId ? { id: `${index}-${name}` } : {}),
        });
      });
    });
    const fields = {};
    if (typeof categories[0] === 'string' && /^\d{4}-\d{2}$/.test(categories[0])) fields.category = monthType;
    if (h.chance(0.3)) {
      fields.category = { ...(fields.category || { type: 'category' }), domain: categories };
    }
    if (h.chance(0.25)) fields.series = { type: 'category', domain: names };
    return {
      chart: 'bump',
      ...h.texts(),
      data,
      encode: { category: 'category', series: 'series', rank: 'rank' },
      ...(Object.keys(fields).length ? { fields } : {}),
    };
  },

  radar(h) {
    const dimensions = span(h, 3, 6);
    const entities = span(h, 1, 24);
    const names = h.labels(entities);
    const longNames = h.profile.labels !== 'short';
    const dimNames = h.labels(dimensions, { length: longNames ? 'long' : undefined });
    const keys = dimNames.map((_, i) => `d${i + 1}`);
    const percentAxes = new Set(keys.filter(() => h.chance(0.25)));
    const fields = {};
    const withId = h.chance(0.4);
    const data = names.map((label, index) => {
      const row = { label, ...(withId ? { id: `e${index + 1}` } : {}) };
      keys.forEach((key) => { row[key] = percentAxes.has(key) ? measure(h, { percent: true }) : measure(h, { min: 0 }); });
      return row;
    });
    keys.forEach((key, i) => {
      const percent = percentAxes.has(key);
      const samples = data.map((row) => row[key]);
      const lo = percent ? 0 : Math.min(0, ...samples);
      const hi = Math.max(...samples, lo + (percent ? 1 : 1));
      const meta = { label: dimNames[i], domain: percent ? [0, 1] : [lo, hi === lo ? lo + 1 : hi] };
      if (percent) meta.format = 'percent';
      else meta.unit = h.unit();
      fields[key] = meta;
    });
    return {
      chart: 'radar',
      ...h.texts(),
      data,
      encode: { label: 'label', dimensions: keys, ...(withId ? { id: 'id' } : {}) },
      fields,
    };
  },

  parallel(h) {
    const dimensions = span(h, 3, 6);
    const entities = span(h, 2, 24);
    const names = h.labels(entities);
    const longNames = h.profile.labels !== 'short';
    const dimNames = h.labels(dimensions, { length: longNames ? 'long' : undefined });
    const keys = dimNames.map((_, i) => `d${i + 1}`);
    const seriesCount = h.chance(0.45) ? span(h, 2, Math.min(6, entities)) : 0;
    const seriesNames = seriesCount ? h.labels(seriesCount) : [];
    const withId = h.chance(0.5);
    const modes = keys.map(() => h.pick(['linear', 'log', 'percent', 'signed']));
    const fields = {};
    const data = names.map((label, index) => {
      const row = { label };
      if (withId) row.id = `p${index + 1}`;
      if (seriesNames.length) row.series = seriesNames[index % seriesNames.length];
      keys.forEach((key, axis) => {
        const mode = modes[axis];
        if (mode === 'percent') row[key] = measure(h, { percent: true });
        else if (mode === 'log') row[key] = Math.max(0.01, measure(h, { min: 0.01 }));
        else row[key] = measure(h, { signed: mode === 'signed' });
      });
      return row;
    });
    keys.forEach((key, i) => {
      const mode = modes[i];
      const samples = data.map((row) => row[key]);
      const meta = { label: dimNames[i] };
      if (mode === 'percent') {
        meta.format = 'percent';
        meta.domain = [0, 1];
      } else if (mode === 'log') {
        meta.scale = 'log';
        meta.unit = h.unit();
        meta.domain = [Math.min(...samples) * 0.5, Math.max(...samples) * 1.5];
      } else {
        meta.unit = h.unit();
        if (h.chance(0.6)) {
          const lo = Math.min(...samples);
          const hi = Math.max(...samples);
          meta.domain = lo === hi ? [lo - 1, hi + 1] : [lo, hi];
        }
      }
      fields[key] = meta;
    });
    return {
      chart: 'parallel',
      ...h.texts(),
      data,
      encode: {
        label: 'label',
        dimensions: keys,
        ...(withId ? { id: 'id' } : {}),
        ...(seriesNames.length ? { series: 'series' } : {}),
      },
      fields,
      ...(h.chance(0.2) ? { interaction: ['focus'] } : {}),
    };
  },

  'launch-fan'(h) {
    const n = span(h, 1, 24);
    const names = h.labels(n);
    const kind = h.pick(['number', 'month', 'date', 'datetime']);
    const percent = h.chance(0.15);
    const starts = kind === 'number'
      ? Array.from({ length: n }, () => h.int(0, 48)).sort((a, b) => a - b)
      : kind === 'month'
        ? h.months(n)
        : kind === 'date'
          ? h.days(n, `${h.int(2020, 2026)}-01-01`)
          : h.days(n, `${h.int(2020, 2026)}-03-01`).map((day, i) => `${day}T${String(h.int(0, 23)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}:00Z`);
    const data = names.map((label, i) => ({
      label,
      start: starts[i],
      value: percent ? measure(h, { percent: true }) : measure(h, { min: 0 }),
      ...(h.chance(0.45) ? { id: `f${i + 1}` } : {}),
    }));
    const withId = data.every((row) => row.id);
    const startField = kind === 'number' ? { type: 'number' } : kind === 'month' ? monthType : kind === 'date' ? dateType : datetimeType;
    const valueField = { label: fieldLabel(h, h.zh ? '当前规模' : 'Current size') };
    if (percent) valueField.format = 'percent';
    return {
      chart: 'launch-fan',
      ...h.texts(),
      ...rootUnit(h, percent),
      data,
      encode: { label: 'label', start: 'start', value: 'value', ...(withId ? { id: 'id' } : {}) },
      fields: { start: startField, value: valueField },
    };
  },
};
