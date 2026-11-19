// Deterministic fictional inputs for the KChart acceptance gallery. No external data is queried.
const rows = [
  { period: '2026-01', team: '甲', category: '甲', value: 18, amount: 18, sales: 18, users: 18, score: 0.72, unit: 2, id: 'a', x: 1, y: 3 },
  { period: '2026-02', team: '乙', category: '乙', value: 12, amount: 12, sales: 12, users: 12, score: 0.54, unit: 1, id: 'b', x: 2, y: 5 },
  { period: '2026-03', team: '丙', category: '丙', value: 22, amount: 22, sales: 22, users: 22, score: 0.86, unit: 3, id: 'c', x: 3, y: 4 },
  { period: '2026-04', team: '丁', category: '丁', value: 16, amount: 16, sales: 16, users: 16, score: 0.63, unit: 2, id: 'd', x: 4, y: 7 },
];
// 让前后对比、目标和第二序列与主值不同，避免重合点和水平线掩盖图形缺陷。
[14, 16, 19, 21].forEach((users, i) => { rows[i].users = users; });
const table = (chart, encode, extra = {}, data = rows) => ({ chart, data, encode, ...extra });
const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
const teams = ['甲', '乙', '丙', '丁'];
// 完整矩阵才能检查热力、气泡矩阵和排名图的真实密度。
const grid = teams.flatMap((team, i) => months.map((period, j) => ({ team, period, value: [18, 12, 22, 16][i] + ((i * 5 + j * 7) % 9) - 4 })));
const ranks = months.flatMap((period, j) => [[1, 2, 3, 4], [2, 1, 3, 4], [2, 3, 1, 4], [3, 2, 1, 4], [3, 4, 2, 1], [4, 3, 2, 1]][j].map((rank, i) => ({ period, team: teams[i], rank })));
const stripRows = teams.flatMap((category, i) => Array.from({ length: 9 }, (_, k) => ({ category, id: `${category}-${k + 1}`, value: [18, 12, 22, 16][i] + ((k * 37 + i * 11) % 13) / 2 - 3 })));
const tree = { id: 'root', label: '虚构计划', children: [
  { id: 'branch-a', label: '规划与验证', children: [{ id: 'a1', label: '长中文名称：持续观察关键指标' }, { id: 'a2', label: '同名节点' }] },
  { id: 'branch-b', label: '交付与复盘', children: [{ id: 'b1', label: '同名节点' }, { id: 'b2', label: '保留独立标识' }] },
] };
// 小提琴密度只在均值 ±3σ 内取点：两端自然收尖，不出现截平的顶部或贴轴细针。
const densityCurve = (mean, sigma) => {
  const from = Math.max(0, Math.ceil((mean - 3 * sigma) * 2) / 2), to = Math.floor((mean + 3 * sigma) * 2) / 2;
  return Array.from({ length: Math.round((to - from) * 2) + 1 }, (_, k) => {
    const value = from + k / 2;
    return [value, Number(Math.exp(-((value - mean) ** 2) / (2 * sigma ** 2)).toFixed(3))];
  });
};
const graph = { nodes: Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, label: `节点${i + 1}`, ...(i === 0 ? { value: 3 } : {}) })), edges: [
  { id: 'e1', source: 'n0', target: 'n1', value: 4 }, { id: 'e2', source: 'n1', target: 'n2', value: 3 },
  { id: 'e3', source: 'n2', target: 'n0', value: 2 }, { id: 'e4', source: 'n0', target: 'n3', value: 1 },
  { id: 'e5', source: 'n3', target: 'n4', value: 2 }, { id: 'e6', source: 'n4', target: 'n5', value: 1 },
] };
const cases = [
  table('line', { category: 'period', value: 'value' }, { title: '虚构月度趋势', unit: '件' }),
  table('area', { category: 'period', value: 'value' }, { title: '虚构累计趋势', unit: '件' }),
  table('bar', { category: 'category', value: 'value' }, { title: '虚构分类比较', unit: '件' }),
  table('column', { category: 'category', value: 'value' }, { title: '虚构分类比较', unit: '件' }),
  table('share', { category: 'category', value: 'value' }),
  table('pie', { category: 'category', value: 'value' }),
  table('donut', { category: 'category', value: 'value' }),
  table('radial-share', { category: 'category', value: 'value', intensity: 'users' }, { fields: { value: { unit: '件' }, users: { unit: '指数' } } }),
  table('rose', { category: 'category', value: 'value' }),
  table('funnel', { category: 'category', value: 'value' }, {}, rows.map((r, i) => ({ ...r, value: [40, 29, 18, 9][i] }))),
  table('sparkline', { category: 'period', value: 'value' }, { unit: '件' }),
  table('small-multiples', { category: 'period', value: ['sales', 'users'] }),
  table('stream', { category: 'period', value: ['sales', 'users'] }),
  table('split-compare', { category: 'period', upper: 'sales', lower: 'users' }, { fields: { sales: { unit: '件' }, users: { unit: '人' } } }),
  { chart: 'combo', title: '虚构双轴组合', data: rows, encode: { category: 'period' }, layers: [{ mark: 'column', field: 'sales', axis: 'left' }, { mark: 'line', field: 'score', axis: 'right' }], fields: { sales: { unit: '件' }, score: { format: 'percent' } } },
  table('bullet', { category: 'category', actual: 'value', target: 'users' }),
  table('gauge', { value: 'score' }, { range: [0, 1], fields: { score: { format: 'percent' } } }, [{ score: 0.68, users: 0.8 }]),
  table('dumbbell', { category: 'category', before: 'value', after: 'users' }, { unit: '件' }),
  table('slope', { category: 'category', before: 'value', after: 'users' }, { unit: '件' }),
  table('interval', { category: 'category', low: 'lower', high: 'upper', value: 'value' }, { unit: '件' }, rows.map(r => ({ ...r, lower: r.value - 2, upper: r.value + 2 }))),
  table('waterfall', { category: 'category', delta: 'delta' }, { start: 20, unit: '件' }, rows.map((r, i) => ({ ...r, delta: [5, -3, 6, -2][i] }))),
  table('histogram', { lower: 'lower', upper: 'upper', count: 'count' }, { fields: { lower: { label: '单次会话时长', unit: '秒' }, upper: { label: '单次会话时长', unit: '秒' }, count: { label: '会话数', unit: '次' } } }, [{ lower: 0, upper: 1, count: 4 }, { lower: 1, upper: 3, count: 9 }, { lower: 3, upper: 6, count: 5 }]),
  table('boxplot', { category: 'category', low: 'low', q1: 'q1', median: 'median', q3: 'q3', high: 'high', outliers: 'outliers' }, { unit: '分' }, rows.map((r, i) => ({ ...r, low: i + 1, q1: i + 2, median: i + 3, q3: i + 4, high: i + 6, outliers: [i + 8] }))),
  table('violin', { category: 'category', density: 'densityData', median: 'median' }, { unit: '分' }, rows.slice(0, 3).map((r, i) => ({ ...r, densityData: densityCurve(3 + i, 1 + i * 0.4), median: 3 + i }))),
  table('strip', { category: 'category', value: 'value', id: 'id' }, { unit: '件' }, stripRows),
  table('scatter', { x: 'x', y: 'y', size: 'users', series: 'group', label: 'label', id: 'id' }, { fields: { x: { label: '转化率', format: 'percent' }, y: { label: '客单价', unit: '元' }, users: { label: '用户数', unit: '人' } } }, Array.from({ length: 12 }, (_, i) => ({ id: `s${i + 1}`, label: `门店${i + 1}`, group: i % 2 ? '线上' : '线下', x: Number((0.08 + i * 0.017 + (i % 3) * 0.006).toFixed(3)), y: 120 + ((i * 37) % 90), users: 200 + i * 40 }))),
  table('candlestick', { category: 'period', open: 'open', close: 'close', low: 'low', high: 'high' }, { unit: '元' }, rows.map((r, i) => ({ ...r, open: 20 + i, close: 22 + i, low: 18 + i, high: 24 + i }))),
  table('heatmap', { row: 'team', column: 'period', value: 'value' }, { fields: { value: { domain: [0, 30], unit: '件' } } }, grid),
  table('bubble-matrix', { row: 'team', column: 'period', value: 'value' }, { fields: { team: { label: '团队' }, period: { label: '月份' }, value: { label: '指标值', unit: '件' } } }, grid),
  table('calendar', { date: 'date', value: 'value' }, { period: '2026', unit: '件' }, Array.from({ length: 120 }, (_, i) => { const date = new Date(Date.UTC(2026, 0, 1 + i)); return { date: date.toISOString().slice(0, 10), value: (i * 7) % 11 }; })),
  table('waffle', { category: 'category', value: 'value' }),
  table('tally', { category: 'category', value: 'value' }, { fields: { value: { format: 'percent' } } }, rows.map((r, i) => ({ ...r, value: [0.18, 0.24, 0.31, 0.12][i] }))),
  table('bump', { category: 'period', series: 'team', rank: 'rank' }, {}, ranks),
  table('radar', { label: 'team', dimensions: ['sales', 'users', 'x', 'y'] }, { fields: { sales: { domain: [0, 25], unit: '件' }, users: { domain: [0, 25], unit: '人' }, x: { domain: [0, 5] }, y: { domain: [0, 10] } } }, rows.map(r => ({ team: r.team, sales: r.sales, users: r.users, x: r.x, y: r.y }))),
  table('parallel', { label: 'team', dimensions: ['sales', 'users', 'x', 'y'], id: 'id' }, { fields: { sales: { domain: [0, 25] }, users: { domain: [0, 25] }, x: { domain: [0, 5] }, y: { domain: [0, 10] } } }, rows.map(r => ({ team: r.team, id: r.id, sales: r.sales, users: r.users, x: r.x, y: r.y }))),
  table('launch-fan', { label: 'team', start: 'started', value: 'value' }, { fields: { started: { type: 'month' } }, unit: '人' }, rows.map((r, i) => ({ ...r, started: `2026-0${i + 1}`, value: r.users }))),
  { chart: 'tree', layout: 'right', data: tree },
  { chart: 'mindmap', layout: 'bilateral', data: tree },
  { chart: 'treemap', data: { label: '虚构分类', children: [{ label: '甲组', children: [{ label: '甲一', value: 4 }, { label: '甲二', value: 3 }] }, { label: '乙组', children: [{ label: '乙一', value: 5 }, { label: '乙二', value: 2 }] }] }, unit: '件' },
  { chart: 'sunburst', data: { label: '虚构分类', children: [{ label: '甲组', children: [{ label: '甲一', value: 4 }, { label: '甲二', value: 3 }] }, { label: '乙组', children: [{ label: '乙一', value: 5 }, { label: '乙二', value: 2 }] }] }, unit: '件' },
  { chart: 'network', layout: 'circular', data: graph, interaction: ['focus'] },
  { chart: 'sankey', layout: 'right', unit: '人', data: { nodes: [{ id: 'ad', label: '广告' }, { id: 'search', label: '搜索' }, { id: 'site', label: '官网' }, { id: 'app', label: 'App' }, { id: 'trial', label: '试用' }, { id: 'paid', label: '付费' }, { id: 'lost', label: '流失' }], edges: [{ source: 'ad', target: 'site', value: 40 }, { source: 'ad', target: 'app', value: 20 }, { source: 'search', target: 'site', value: 30 }, { source: 'site', target: 'trial', value: 45 }, { source: 'site', target: 'lost', value: 25 }, { source: 'app', target: 'trial', value: 12 }, { source: 'app', target: 'lost', value: 8 }, { source: 'trial', target: 'paid', value: 33 }, { source: 'trial', target: 'lost', value: 24 }] } },
  { chart: 'threads', layout: 'right', unit: '人', data: { stages: [{ id: 's1', label: '入口' }, { id: 's2', label: '评估' }, { id: 's3', label: '结果' }], nodes: [{ id: 'web', label: '网页', stage: 's1' }, { id: 'app', label: 'App', stage: 's1' }, { id: 'demo', label: '演示', stage: 's2' }, { id: 'trial', label: '试用', stage: 's2' }, { id: 'buy', label: '购买', stage: 's3' }, { id: 'drop', label: '放弃', stage: 's3' }], paths: [{ id: 'p1', nodes: ['web', 'demo', 'buy'], value: 9 }, { id: 'p2', nodes: ['web', 'trial', 'buy'], value: 6 }, { id: 'p3', nodes: ['web', 'trial', 'drop'], value: 4 }, { id: 'p4', nodes: ['app', 'trial', 'buy'], value: 5 }, { id: 'p5', nodes: ['app', 'demo', 'drop'], value: 3 }] } },
  { chart: 'choropleth', data: { map: { asset: 'us-states' }, rows: [{ region: 'US-CA', value: 8 }, { region: 'US-NY', value: 5 }] }, encode: { region: 'region', value: 'value' } },
  { chart: 'geo-scatter', data: { map: { asset: 'world' }, rows: [{ longitude: 121.5, latitude: 31.2, label: '虚构点', value: 2 }] }, encode: { longitude: 'longitude', latitude: 'latitude', label: 'label', value: 'value' } },
];

// Ref IDs identify the 51 comparison cases described in docs/chart-coverage.md at the project root.
const referenceIds = {
  bar: ['G3', 'G10', 'L2', 'F5'], waffle: ['G4', 'L14'], column: ['G5', 'G12', 'F1', 'F6', 'F7'], network: ['G6', 'G11', 'B1', 'B2'], tree: ['G7'], 'split-compare': ['G8'], scatter: ['G9', 'F8'], 'radial-share': ['G13'], 'bubble-matrix': ['G14'], strip: ['G15'], bump: ['G16', 'G21'], area: ['G17', 'F3'], line: ['G18', 'L3', 'F2'], violin: ['G19'], heatmap: ['G20', 'L4', 'F10'], sankey: ['G22'], 'launch-fan': ['L1'], funnel: ['L13'], tally: ['L15'], calendar: ['L17'], parallel: ['L20'], donut: ['F4'], waterfall: ['F9'], gauge: ['F11'], dumbbell: ['F12'], treemap: ['F13'], histogram: ['F14'], boxplot: ['F15'], stream: ['F16'], candlestick: ['F17'], choropleth: ['M1'], threads: ['B3'],
};

const result = cases.map(spec => ({ id: `chart-${spec.chart}`, referenceIds: referenceIds[spec.chart] || [], spec }));
result.push({
  id: 'edge-calendar-sparse-year', referenceIds: [],
  spec: table('calendar', { date: 'date', value: 'value' }, { title: '全年稀疏日历', period: '2026', unit: '件' },
    Array.from({ length: 122 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 0, 1 + i * 3));
      return { date: date.toISOString().slice(0, 10), value: i % 5 === 0 ? 0 : (i * 7) % 13 + 1 };
    })),
});
result.push({ id: 'choropleth-world', referenceIds: ['M2'], spec: { chart: 'choropleth', data: { map: { asset: 'world' }, rows: [{ region: 'USA', value: 8 }, { region: 'CHN', value: 5 }] }, encode: { region: 'region', value: 'value' } } });
// Explicitly exercise all eight mind-map layouts with the exact same source tree.
for (const layout of ['bilateral', 'right', 'left', 'radial', 'org', 'brace', 'fishbone', 'timeline']) {
  result.push({ id: `mindmap-${layout}`, referenceIds: [], spec: { chart: 'mindmap', layout, data: tree, title: `脑图布局：${layout}` } });
}

// Catalog-driven variants prevent a newly registered variant from silently escaping the gallery.
const variantCharts = {
  line: ['counter', 'barcode'], area: [], bar: ['solid', 'rungs', 'pictorial', 'lollipop'], column: ['solid', 'rungs', 'pictorial', 'lollipop'], share: ['solid', 'ticks'], donut: ['solid', 'ticks'], funnel: ['bars', 'hourglass'], gauge: ['bar', 'arc', 'ticks'], dumbbell: ['solid', 'rungs'], waterfall: ['solid', 'rungs'], histogram: ['solid', 'rungs'], scatter: ['dots', 'plumb'], heatmap: ['cells', 'dots', 'arc'], calendar: ['cells', 'dots'], waffle: ['dots', 'field'], mindmap: ['editorial', 'cards'], network: ['lines', 'membrane'],
};
for (const spec of cases) for (const variant of variantCharts[spec.chart] || []) {
  const revised = { ...spec, variant };
  if (spec.chart === 'histogram' && variant === 'rungs') {
    revised.data = [{ lower: 0, upper: 2, count: 4 }, { lower: 2, upper: 4, count: 9 }, { lower: 4, upper: 6, count: 5 }];
  }
  if (spec.chart === 'calendar' && revised.period === 'year') revised.period = '2026';
  // 单位档位按最窄 324px 仍可辨认的密度取值；pictorial 使用受控图标库中的真实图标。
  if (variant === 'pictorial') revised.unitMark = { value: 5, label: '件', icon: 'package' };
  else if (variant === 'rungs' && ['bar', 'column', 'dumbbell', 'waterfall', 'histogram'].includes(spec.chart)) revised.unitMark = { value: spec.chart === 'histogram' ? 2 : 5, label: '件' };
  result.push({ id: `variant-${spec.chart}-${variant}`, referenceIds: [], spec: revised });
}

// Deterministic adversarial samples exercise documented semantic edge cases independently.
result.push(
  { id: 'edge-default-legacy-17', referenceIds: [], spec: table('small-multiples', { category: 'period', value: ['sales', 'users'] }, { title: '原17图小多图' }) },
  { id: 'edge-dual-axis', referenceIds: [], spec: cases.find(item => item.chart === 'combo') },
  { id: 'edge-missing-month', referenceIds: [], spec: table('line', { category: 'period', value: 'value' }, { title: '缺月须断线', unit: '件' }, [{ period: '2026-01', value: 2 }, { period: '2026-02', value: 4 }, { period: '2026-03', value: null }, { period: '2026-04', value: 5 }, { period: '2026-05', value: null }, { period: '2026-06', value: 6 }, { period: '2026-07', value: 7 }]) },
  { id: 'edge-outlier', referenceIds: [], spec: cases.find(item => item.chart === 'boxplot') },
  { id: 'edge-long-chinese-decimals', referenceIds: [], spec: table('line', { category: 'category', value: 'value' }, { title: '虚构的较长中文标题用于检查换行与小数单位', unit: '万元' }, [{ category: '很长的中文分类名称用于检查文本测量', value: 1.25 }, { category: '另一个很长的分类名称', value: 2.75 }]) },
  { id: 'edge-duplicate-labels-and-ids', referenceIds: [], spec: { chart: 'mindmap', layout: 'right', data: { label: '同名根', id: 'root', children: [{ label: '同名节点', id: 'one' }, { label: '同名节点', id: 'two' }] } } },
  { id: 'edge-force-180-nodes', referenceIds: [], spec: { chart: 'network', layout: 'force', data: { nodes: Array.from({ length: 180 }, (_, i) => ({ id: `n${i}`, label: `虚构节点${i + 1}` })), edges: Array.from({ length: 240 }, (_, i) => ({ id: `e${i}`, source: `n${i % 180}`, target: `n${(i * 7 + 1) % 180}` })) }, interaction: ['focus'] } },
  { id: 'edge-positive-negative', referenceIds: [], spec: table('bar', { category: 'category', value: 'value' }, { title: '虚构正负值', unit: '件' }, [{ category: '增加', value: 12 }, { category: '减少', value: -7 }, { category: '持平', value: 0 }]) },
);

export const KCHART_CASES = Object.freeze(result.map(item => Object.freeze({ ...item, referenceIds: Object.freeze([...item.referenceIds]) })));
export default KCHART_CASES;
