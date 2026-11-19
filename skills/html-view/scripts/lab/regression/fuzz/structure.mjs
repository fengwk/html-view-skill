// 结构 / 网络 / 地理图族的随机声明。每个生成器只产出符合 spec.js 与文档上限的数据，不迁就当前版面。
const TREE_LAYOUTS = ['right', 'left', 'org', 'brace'];
const MIND_LAYOUTS = ['bilateral', 'right', 'left', 'radial', 'org', 'brace', 'fishbone', 'timeline'];
const NETWORK_LAYOUTS = ['circular', 'force'];
const FLOW_LAYOUTS = ['right', 'down'];
const WORLD_IDS = ['ZWE', 'ZMB', 'YEM', 'VNM', 'VEN', 'VAT', 'VUT', 'UZB', 'URY', 'USA', 'GBR', 'CHN', 'IND', 'BRA', 'RUS', 'JPN', 'DEU', 'FRA', 'CAN', 'AUS', 'MEX', 'IDN', 'NGA', 'ZAF', 'KOR', 'ITA', 'ESP', 'TUR', 'ARG', 'EGY', 'SAU', 'IRN', 'THA', 'POL', 'UKR', 'SWE', 'NOR', 'FIN', 'NZL', 'CHL', 'PER', 'COL', 'KEN', 'ETH', 'MAR', 'DZA', 'PAK', 'BGD', 'PHL', 'MYS'];
const STATE_IDS = ['US-AK', 'US-AL', 'US-AR', 'US-AZ', 'US-CA', 'US-CO', 'US-CT', 'US-DE', 'US-FL', 'US-GA', 'US-HI', 'US-IA', 'US-ID', 'US-IL', 'US-IN', 'US-KS', 'US-KY', 'US-LA', 'US-MA', 'US-MD', 'US-ME', 'US-MI', 'US-MN', 'US-MO', 'US-MS', 'US-MT', 'US-NC', 'US-ND', 'US-NE', 'US-NH', 'US-NJ', 'US-NM', 'US-NV', 'US-NY', 'US-OH', 'US-OK', 'US-OR', 'US-PA', 'US-RI', 'US-SC', 'US-SD', 'US-TN', 'US-TX', 'US-UT', 'US-VA', 'US-VT', 'US-WA', 'US-WI', 'US-WV', 'US-WY'];
const CLUSTERS = [[116.4, 39.9], [121.5, 31.2], [-74.0, 40.7], [-0.13, 51.5], [139.7, 35.7], [2.35, 48.86], [-43.2, -22.9], [151.2, -33.9], [77.2, 28.6], [37.6, 55.75]];

function shell(h, extra = {}) {
  const spec = { ...h.texts(), ...extra };
  if (h.chance(0.75)) spec.unit = h.unit();
  return spec;
}

function weight(h) {
  const value = h.value({ min: 0 });
  return value == null || value <= 0 ? h.int(1, 40) : value;
}

/** 在文档上限（≤80 节点、≤5 层）内造树：常规、一条深枝、一层很宽、或接近上限。 */
function buildTree(h, { weighted = false } = {}) {
  const budget = h.count(1, 79);
  const shape = h.pick(h.profile.size === 'min' ? ['chain'] : ['balanced', 'deep', 'wide', 'max']);
  const root = { label: h.labels(1)[0], id: 'n1' };
  if (h.chance(0.3)) root.note = h.labels(1, { length: 'short' })[0];
  const nodes = [root];
  const depth = new Map([[root, 1]]);
  const leaves = [root];
  const add = (parent) => {
    const node = { label: h.labels(1)[0], id: `n${nodes.length + 1}` };
    if (h.chance(0.2)) node.note = h.labels(1, { length: 'short' })[0];
    parent.children = parent.children || [];
    parent.children.push(node);
    nodes.push(node);
    depth.set(node, depth.get(parent) + 1);
    return node;
  };
  if (shape === 'chain') {
    let cursor = root;
    while (nodes.length <= budget && depth.get(cursor) < 5) cursor = add(cursor);
  } else if (shape === 'deep') {
    let cursor = root;
    while (depth.get(cursor) < 5 && nodes.length <= budget) cursor = add(cursor);
    const wide = nodes[Math.min(1, nodes.length - 1)];
    while (nodes.length <= budget && depth.get(wide) < 5) add(wide);
  } else if (shape === 'wide') {
    const fan = h.int(6, Math.min(24, budget));
    for (let i = 0; i < fan && nodes.length <= budget; i += 1) leaves.push(add(root));
    while (nodes.length <= budget) {
      const open = leaves.filter((node) => depth.get(node) < 5);
      if (!open.length) break;
      leaves.push(add(h.pick(open)));
    }
  } else {
    while (nodes.length <= budget) {
      const open = nodes.filter((node) => depth.get(node) < 5);
      if (!open.length) break;
      add(h.pick(open));
    }
  }
  if (weighted) {
    const walk = (node) => {
      if (!node.children?.length) {
        node.value = weight(h);
        if (h.chance(0.12)) node.value = h.profile.values === 'tiny' ? 0.001 : 0.01;
        return node.value;
      }
      node.value = node.children.reduce((sum, child) => sum + walk(child), 0);
      return node.value;
    };
    const tips = nodes.filter((node) => !node.children?.length);
    if (tips.length > 1 && h.chance(0.7)) {
      tips[0].value = Math.max(tips[0].value, h.profile.values === 'huge' ? tips[0].value : 400);
      tips[1].value = h.profile.values === 'huge' ? Math.max(tips[1].value * 1e-6, 0.001) : 0.01;
      walk(root);
    }
    if (!(walk(root) > 0)) {
      tips[0].value = 1;
      walk(root);
    }
  }
  return root;
}

function nodeFields(h, withValue) {
  const fields = { 'node.label': { label: h.zh ? '节点' : 'Node' } };
  if (withValue) fields['node.value'] = { label: h.zh ? '规模' : 'Size' };
  if (h.chance(0.4)) fields['edge.value'] = { label: h.zh ? '关系' : 'Link' };
  return fields;
}

function graph(h, { nodes: nodeCount, edges: edgeCount, stages = 0, conserve = false, values = false }) {
  const count = Math.max(1, nodeCount);
  const names = h.labels(count);
  const nodes = names.map((label, i) => {
    const node = { id: `n${i + 1}`, label };
    if (h.chance(0.35)) node.group = h.labels(1, { length: 'short' })[0];
    if (h.chance(0.15)) node.note = h.labels(1, { length: 'short' })[0];
    if (values && !conserve && h.chance(0.7)) node.value = Math.abs(h.value({ min: 0 }) ?? 0);
    if (stages) node.stage = Math.min(stages - 1, Math.floor((i / count) * stages));
    return node;
  });
  const edges = [];
  const seen = new Set();
  const push = (source, target, value) => {
    if (source === target) return false;
    const key = `${source}>${target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const edge = { source, target };
    if (value != null) edge.value = value;
    if (!conserve && h.chance(0.2)) edge.label = h.labels(1, { length: 'short' })[0];
    edges.push(edge);
    return true;
  };
  if (conserve) {
    const byStage = Array.from({ length: stages }, () => []);
    nodes.forEach((node) => byStage[node.stage].push(node.id));
    const inflow = new Map(nodes.map((node) => [node.id, 0]));
    for (let stage = 0; stage < stages - 1 && edges.length < edgeCount; stage += 1) {
      const sources = byStage[stage];
      const targets = byStage[stage + 1];
      if (!sources.length || !targets.length) continue;
      for (const source of sources) {
        const fan = h.int(1, Math.min(3, targets.length));
        const parts = Array.from({ length: fan }, () => h.int(1, 100));
        const base = inflow.get(source);
        const total = parts.reduce((sum, part) => sum + part, 0);
        let spent = 0;
        for (let i = 0; i < fan; i += 1) {
          const amount = base > 0 ? (i === fan - 1 ? base - spent : Math.floor(parts[i] / total * base)) : parts[i];
          if (amount <= 0) continue;
          const target = targets[(sources.indexOf(source) + i) % targets.length];
          if (push(source, target, amount)) {
            inflow.set(target, inflow.get(target) + amount);
            spent += amount;
          }
        }
      }
    }
  } else {
    const dense = h.chance(0.35);
    const targetEdges = Math.min(edgeCount, dense ? count * 3 : Math.max(0, count - 1));
    if (h.chance(0.7) && count > 1) {
      for (let i = 1; i < count && edges.length < targetEdges; i += 1) push(nodes[h.int(0, i - 1)].id, nodes[i].id, values ? weight(h) : undefined);
    }
    let guard = 0;
    while (edges.length < targetEdges && guard < targetEdges * 8) {
      guard += 1;
      const source = nodes[h.int(0, count - 1)].id;
      const target = nodes[h.int(0, count - 1)].id;
      push(source, target, values ? weight(h) : undefined);
    }
    if (h.chance(0.2) && edges.length) {
      const edge = edges[0];
      edges.push({ ...edge, id: 'parallel-2', ...(values ? { value: weight(h) } : {}) });
      edge.id = 'parallel-1';
    }
  }
  return { nodes, edges };
}

export const GENERATORS = {
  tree(h) {
    return shell(h, { chart: 'tree', layout: h.pick(TREE_LAYOUTS), data: buildTree(h) });
  },
  mindmap(h) {
    const spec = shell(h, {
      chart: 'mindmap',
      layout: h.pick(MIND_LAYOUTS),
      variant: h.pick(['editorial', 'cards']),
      data: buildTree(h),
    });
    return spec;
  },
  treemap(h) {
    return shell(h, { chart: 'treemap', data: buildTree(h, { weighted: true }) });
  },
  sunburst(h) {
    return shell(h, { chart: 'sunburst', data: buildTree(h, { weighted: true }) });
  },
  network(h) {
    const nodes = h.count(2, 200);
    const edges = h.count(0, Math.min(500, Math.max(0, nodes * (h.chance(0.3) ? 4 : 1))));
    const data = graph(h, { nodes, edges, values: h.chance(0.55) });
    const bothValued = data.nodes.some((node) => node.value != null) && data.edges.some((edge) => edge.value != null);
    const spec = {
      chart: 'network',
      layout: h.pick(NETWORK_LAYOUTS),
      directed: h.chance(0.5),
      variant: h.pick(['lines', 'membrane']),
      ...h.texts(),
      data,
      fields: nodeFields(h, data.nodes.some((node) => node.value != null)),
    };
    if (!bothValued && h.chance(0.6)) spec.unit = h.unit();
    return spec;
  },
  sankey(h) {
    const stages = h.count(2, 8);
    const nodes = h.count(stages, Math.min(60, stages * 8));
    const data = graph(h, { nodes, edges: Math.min(120, nodes * 2), stages, conserve: true, values: true });
    return shell(h, { chart: 'sankey', layout: h.pick(FLOW_LAYOUTS), data });
  },
  threads(h) {
    const stageCount = h.count(2, 8);
    const stages = Array.from({ length: stageCount }, (_, i) => ({ id: `s${i + 1}`, label: h.labels(1)[0] }));
    const perStage = Math.max(1, Math.floor(h.count(stageCount, 80) / stageCount));
    const nodes = [];
    for (const stage of stages) {
      const room = 80 - nodes.length;
      const n = Math.max(1, Math.min(perStage, room));
      for (let i = 0; i < n; i += 1) nodes.push({ id: `${stage.id}-${i + 1}`, label: h.labels(1)[0], stage: stage.id });
    }
    const pathCount = h.count(1, Math.min(240, nodes.length * 3));
    const paths = [];
    for (let i = 0; i < pathCount; i += 1) {
      const span = h.int(2, stageCount);
      const start = h.int(0, stageCount - span);
      const chosen = [];
      for (let at = start; at < start + span; at += 1) {
        const pool = nodes.filter((node) => node.stage === stages[at].id);
        if (pool.length) chosen.push(h.pick(pool).id);
      }
      if (chosen.length >= 2) paths.push({ id: `p${i + 1}`, nodes: chosen, value: weight(h), ...(h.chance(0.15) ? { note: h.labels(1, { length: 'short' })[0] } : {}) });
    }
    if (!paths.length && nodes.length >= 2) paths.push({ id: 'p1', nodes: [nodes[0].id, nodes[1].id], value: 1 });
    return shell(h, { chart: 'threads', layout: h.pick(FLOW_LAYOUTS), data: { stages, nodes, paths } });
  },
  choropleth(h) {
    const asset = h.pick(['world', 'us-states']);
    const ids = asset === 'world' ? WORLD_IDS : STATE_IDS;
    const coverage = h.pick(['sparse', 'partial', 'full']);
    const taken = coverage === 'full' ? ids.length : coverage === 'sparse' ? h.int(1, Math.min(8, ids.length)) : h.count(3, ids.length);
    const rows = [];
    const used = new Set();
    while (rows.length < taken) {
      const region = ids[h.int(0, ids.length - 1)];
      if (used.has(region)) continue;
      used.add(region);
      const value = h.value({ min: 0, missing: coverage !== 'full' });
      rows.push({ region, value: value == null ? null : Math.abs(value) });
    }
    if (!rows.some((row) => Number.isFinite(row.value))) rows[0].value = 1;
    if (rows.length > 1 && h.chance(0.3)) rows[1].value = 0;
    return shell(h, { chart: 'choropleth', data: { map: { asset }, rows }, encode: { region: 'region', value: 'value' } });
  },
  'geo-scatter'(h) {
    const asset = h.pick(['world', 'us-states']);
    const n = h.count(1, asset === 'world' ? 1000 : 120);
    const withValue = h.chance(0.75);
    const withLabel = h.chance(0.55);
    const withId = h.chance(0.3);
    const labels = withLabel ? h.labels(Math.min(n, 40)) : [];
    const rows = [];
    const cluster = CLUSTERS[h.int(0, CLUSTERS.length - 1)];
    for (let i = 0; i < n; i += 1) {
      const clustered = i < Math.ceil(n * 0.3);
      const base = clustered ? cluster : [h.int(-170, 170), h.int(-80, 80)];
      const row = {
        longitude: Math.max(-180, Math.min(180, Number((base[0] + (h.rng() - 0.5) * (clustered ? 6 : 20)).toFixed(3)))),
        latitude: Math.max(-90, Math.min(90, Number((base[1] + (h.rng() - 0.5) * (clustered ? 4 : 16)).toFixed(3)))),
      };
      if (withValue) row.value = Math.abs(h.value({ min: 0 }) ?? 0);
      if (withLabel) row.label = labels[i % labels.length];
      if (withId) row.id = `p${i + 1}`;
      rows.push(row);
    }
    const encode = { longitude: 'longitude', latitude: 'latitude' };
    if (withValue) encode.value = 'value';
    if (withLabel) encode.label = 'label';
    if (withId) encode.id = 'id';
    return shell(h, { chart: 'geo-scatter', data: { map: { asset }, rows }, encode });
  },
};
