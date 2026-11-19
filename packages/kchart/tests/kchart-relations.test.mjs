import { test } from 'vitest';
import assert from 'node:assert/strict';
import { install } from '../src/chart/relations.js';
import { loadChart } from './kchart-fixture.mjs';
import { KCHART_CASES } from './kchart-cases.mjs';

const { api: K } = loadChart([install]);
const plain = (value) => JSON.parse(JSON.stringify(value));
const layout = (chart, data, options = {}) => {
  const { lang = 'zh', ...specOptions } = options;
  return K.render({ chart, data, ...specOptions }, { width: 720, lang });
};

// 意图：网络图保留节点/边身份、依赖值编码面积且定向边以显式箭头绘制；force相同输入收敛为相同静态场景。
test('network preserves identities, encodes node size, arrows and deterministic settled force', () => {
  const spec = { chart: 'network', layout: 'force', directed: true, data: {
    nodes: [{ id: 'a', label: 'Alpha', value: 1, group: 'red' }, { id: 'b', label: 'Beta', value: 9, group: 'blue' }, { id: 'c', label: '孤立点', value: 0 }],
    edges: [{ id: 'ab', source: 'a', target: 'b', value: 4 }, { id: 'ba', source: 'b', target: 'a', value: 2 }],
  } };
  const first = K.render(spec, { width: 720 }), second = K.render(spec, { width: 720 });
  assert.deepEqual(plain(first.scene), plain(second.scene));
  const nodes = first.scene.children.filter((child) => child.meta?.kind === 'node');
  assert.deepEqual(plain(nodes.map((node) => node.meta.node)), ['a', 'b', 'c']);
  assert.ok(nodes[1].attrs.r > nodes[0].attrs.r);
  assert.ok(first.scene.children.some((child) => child.meta?.kind === 'size-legend' && child.text.includes('面积')));
  assert.ok(Math.abs(nodes[1].attrs.r ** 2 / nodes[0].attrs.r ** 2 - 9) < 1e-9);
  assert.equal(nodes[2].attrs.r, 0);
  const labels = first.scene.children.filter((child) => child.meta?.kind === 'label');
  const nodeById = new Map(nodes.map((node) => [node.meta.node, node]));
  assert.ok(labels.every((label) => Number(label.attrs['font-size']) >= 12));
  assert.ok(labels.every((label) => {
    const node = nodeById.get(label.meta.node), anchor = label.attrs['text-anchor'];
    return anchor === 'start' ? label.attrs.x >= node.attrs.cx + node.attrs.r + 8 : label.attrs.x <= node.attrs.cx - node.attrs.r - 8;
  }), 'circular graph labels sit outside their node marks');
  assert.notEqual(nodes[0].attrs.fill, nodes[1].attrs.fill);
  assert.equal(first.scene.children.filter((child) => child.meta?.kind === 'edge').length, 2);
  assert.deepEqual(plain(first.scene.children.filter((child) => child.meta?.kind === 'arrow').map((child) => child.meta.edge)), ['ab', 'ba']);
  assert.match(first.svg, /data-kc-edge="ab"/);
  assert.doesNotMatch(first.svg, /animate/);
});

// 意图：密集force网络保留给定宽度、使用近方形布局，并只显示度数最高的少数标签而不绘制180条文字索引。
test('dense force network fits its width and labels only the highest-degree nodes', () => {
  const data = {
    nodes: Array.from({ length: 180 }, (_, i) => ({ id: `n${i}`, label: `虚构节点${i + 1}` })),
    edges: Array.from({ length: 240 }, (_, i) => ({ id: `e${i}`, source: `n${i % 180}`, target: `n${(i * 7 + 1) % 180}` })),
  };
  const rendered = K.render({ chart: 'network', layout: 'force', data }, { width: 324 });
  const nodes = rendered.scene.children.filter((child) => child.meta?.kind === 'node');
  const labels = rendered.scene.children.filter((child) => child.meta?.kind === 'label');
  assert.equal(rendered.scene.width, 324, 'canvas fills but does not exceed its available width');
  assert.ok(rendered.scene.height >= 240 && rendered.scene.width / rendered.scene.height >= 1 && rendered.scene.width / rendered.scene.height <= 1.35, 'canvas stays near a square landscape aspect ratio');
  assert.equal(nodes.length, 180);
  assert.equal(new Set(labels.map((label) => label.meta.node)).size, 4, 'the narrow viewport labels only a few high-degree nodes');
  const degree = new Map(data.nodes.map((node) => [node.id, 0]));
  for (const edge of data.edges) { degree.set(edge.source, degree.get(edge.source) + 1); degree.set(edge.target, degree.get(edge.target) + 1); }
  const expected = data.nodes.map((node) => node.id).sort((a, b) => degree.get(b) - degree.get(a) || (a < b ? -1 : a > b ? 1 : 0)).slice(0, 4).sort();
  assert.deepEqual([...new Set(labels.map((label) => label.meta.node))].sort(), expected, 'labels are reserved for highest-degree nodes');
  assert.ok(labels.every((label) => label.attrs.x >= 0 && label.attrs.x <= rendered.scene.width && label.attrs.y >= 0 && label.attrs.y <= rendered.scene.height));
  // 意图：真实180节点不应被逐帧边界裁切钉成方框；至少一半节点必须留在布局内部。
  const xs = nodes.map(node => node.attrs.cx), ys = nodes.map(node => node.attrs.cy);
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
  const interior = nodes.filter(({ attrs: p }) => p.cx > xmin + (xmax - xmin) * .08 && p.cx < xmax - (xmax - xmin) * .08
    && p.cy > ymin + (ymax - ymin) * .08 && p.cy < ymax - (ymax - ymin) * .08);
  assert.ok(interior.length > nodes.length / 2, 'force equilibrium distributes nodes through the interior, not along the frame');
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i].attrs, b = nodes[j].attrs;
    assert.ok(Math.hypot(a.cx - b.cx, a.cy - b.cy) >= a.r + b.r + 1.5, 'settled force nodes retain a visible gap');
  }
  // 意图：左右两组高连接度标签也需互相避让，而不是只在各自侧列内排开。
  const wide = K.layout({ chart: 'network', layout: 'force', data }, { width: 984 });
  const measure = K.util.context().measure;
  const boxes = wide.children.filter(node => node.meta?.kind === 'label').map(node => {
    const w = measure(node.text, 12, node.attrs['font-weight']);
    return { x: node.attrs.x - (node.attrs['text-anchor'] === 'end' ? w : 0), y: node.attrs.y - 12, w, h: 14 };
  });
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'selected dense-network labels do not overlap');
  }
});

// 意图：sankey边各自保留ID、线宽按流量、阶段坐标不会因原始stage值量级失控且守恒仍由DSL校验。
test('sankey conserves flow and renders distinct proportional ribbons by stable identity', () => {
  const data = {
    nodes: [{ id: 'start', label: '来源', stage: 0 }, { id: 'mid', label: '中间', stage: 1000000 }, { id: 'end', label: '终点', stage: 2000000 }],
    edges: [{ id: 'part-a', source: 'start', target: 'mid', value: 2 }, { id: 'part-b', source: 'start', target: 'mid', value: 3 }, { id: 'out', source: 'mid', target: 'end', value: 5 }],
  };
  const rendered = layout('sankey', data);
  const ribbons = rendered.scene.children.filter((child) => child.meta?.kind === 'edge');
  assert.deepEqual(plain(ribbons.map((ribbon) => ribbon.meta.edge)), ['part-a', 'part-b', 'out']);
  assert.deepEqual(plain(ribbons.map((ribbon) => ribbon.meta.value)), [2, 3, 5]);
  assert.notEqual(ribbons[0].attrs.d, ribbons[1].attrs.d);
  const rects = rendered.scene.children.filter((child) => child.meta?.kind === 'node');
  assert.equal(rects.length, 3);
  assert.ok(rects.every((node) => Number.isFinite(node.attrs.x) && node.attrs.x < 720));
  const invalid = structuredClone(data); invalid.edges[2].value = 4;
  const result = K.validate({ chart: 'sankey', data: invalid });
  assert.ok(result.errors.some((error) => error.message.includes('不守恒')));
});

// 意图：窄Sankey加大内部阶段间距容纳节点外标签，且无输入stage时不伪造阶段编号。
test('narrow sankey reserves label lanes and omits generated stage names', () => {
  const data = {
    nodes: [{ id: 'ad', label: '广告' }, { id: 'search', label: '搜索' }, { id: 'site', label: '官网' }, { id: 'app', label: 'App' }, { id: 'trial', label: '试用' }, { id: 'paid', label: '付费' }, { id: 'lost', label: '流失' }],
    edges: [{ id: 'ad-site', source: 'ad', target: 'site', value: 40 }, { id: 'ad-app', source: 'ad', target: 'app', value: 20 }, { id: 'search-site', source: 'search', target: 'site', value: 30 }, { id: 'site-trial', source: 'site', target: 'trial', value: 45 }, { id: 'site-lost', source: 'site', target: 'lost', value: 25 }, { id: 'app-trial', source: 'app', target: 'trial', value: 12 }, { id: 'app-lost', source: 'app', target: 'lost', value: 8 }, { id: 'trial-paid', source: 'trial', target: 'paid', value: 33 }, { id: 'trial-lost', source: 'trial', target: 'lost', value: 24 }],
  };
  const rendered = K.render({ chart: 'sankey', layout: 'right', data }, { width: 268 });
  const scene = rendered.scene, nodes = scene.children.filter((child) => child.meta?.kind === 'node'), labels = scene.children.filter((child) => child.meta?.kind === 'label');
  assert.ok(scene.width >= 268, 'a narrow frame widens until every measured label lane fits between stages');
  assert.equal(scene.children.filter((child) => child.tag === 'text' && /^(?:阶段|Stage) \d+$/.test(child.text)).length, 0);
  assert.equal(new Set(labels.map((label) => label.meta.node)).size, 7);
  const boxes = new Map(nodes.map((node) => [node.meta.node, node.attrs]));
  assert.ok(labels.every((label) => {
    const node = boxes.get(label.meta.node);
    return label.attrs['text-anchor'] === 'start' ? label.attrs.x >= node.x + node.width + 8 : label.attrs.x <= node.x - 8;
  }), 'horizontal node labels sit outside node rectangles');
  const readouts = scene.children.filter((child) => child.meta?.kind === 'edge-label');
  assert.ok(readouts.every((node) => Number(node.attrs['font-size']) >= 12), 'ribbon readouts stay at least 12px or are omitted');

  // 意图：跨阶段流带（官网→流失）的中点落在中间阶段的节点列上，读数必须避开所有节点条。
  const caseSpec = KCHART_CASES.find(item => item.id === 'chart-sankey').spec;
  for (const width of [502, 984]) {
    const wide = K.render(caseSpec, { width }).scene;
    const measure = K.util.context({ spec: caseSpec, width }).measure;
    const bars = wide.children.filter((child) => child.meta?.kind === 'node').map((node) => node.attrs);
    for (const readout of wide.children.filter((child) => child.meta?.kind === 'edge-label')) {
      const half = measure(readout.text, 12) / 2, x = Number(readout.attrs.x), y = Number(readout.attrs.y);
      const covered = bars.some((bar) => x + half > bar.x && x - half < bar.x + bar.width && y > bar.y && y - 12 < bar.y + bar.height);
      assert.ok(!covered, `${width}: readout ${readout.text} does not sit on a node bar`);
    }
  }
});

// 意图：手机、平板和桌面宽度下横向Sankey scene均不突破容器，标签文字完整留在SVG边界内。
test('horizontal sankey stays within 268, 502, and 984 pixel scene widths', () => {
  const spec = KCHART_CASES.find(item => item.id === 'chart-sankey').spec;
  for (const width of [268, 502, 984]) {
    const scene = K.layout(spec, { width, measure: text => [...text].length * 8 });
    assert.ok(scene.width >= width, `${width}px Sankey keeps at least the requested frame`);
    const nodes = scene.children.filter(node => node.meta?.kind === 'node');
    const nodeBoxes = new Map(nodes.map(node => [node.meta.node, node.attrs]));
    const nodeStages = new Map(nodes.map(node => [node.meta.node, node.meta.stage]));
    const lastStage = Math.max(...nodes.map(node => node.meta.stage));
    const labels = scene.children.filter(node => node.meta?.kind === 'label');
    assert.ok(labels.length > 0);
    for (const label of labels) {
      const box = nodeBoxes.get(label.meta.node);
      assert.ok(label.attrs.y <= box.y + box.height, `${width}px label ${label.text} stays with its node band`);
      const size = K.util.context({ width }).measure(label.text, Number(label.attrs['font-size']), Number(label.attrs['font-weight']));
      const left = label.attrs['text-anchor'] === 'end' ? label.attrs.x - size : label.attrs.x;
      assert.ok(left >= 0 && left + size <= scene.width, `${width}px label ${label.text} remains in scene bounds`);
      assert.equal(label.attrs['stroke'], K.util.context({ width }).color('bg'), 'label halo matches the chart background');
      assert.ok(Number(label.attrs['font-size']) >= 12);
      const isLast = nodeStages.get(label.meta.node) === lastStage;
      assert.equal(label.attrs['text-anchor'], isLast ? 'end' : 'start', 'last-column labels face inward');
    }
    const labelGroups = new Map();
    for (const label of labels) {
      const group = labelGroups.get(label.meta.node) ?? [];
      group.push(label);
      labelGroups.set(label.meta.node, group);
    }
    for (const stage of new Set(nodeStages.values())) {
      const boxes = [...labelGroups].filter(([id]) => nodeStages.get(id) === stage).map(([id, lines]) => ({
        id,
        top: Math.min(...lines.map(line => Number(line.attrs.y))) - 12,
        bottom: Math.max(...lines.map(line => Number(line.attrs.y))) + 3,
      })).sort((a, b) => a.top - b.top);
      for (let index = 1; index < boxes.length; index++) {
        assert.ok(boxes[index].top >= boxes[index - 1].bottom, `${width}px labels ${boxes[index - 1].id} and ${boxes[index].id} avoid vertical overlap`);
      }
    }
  }
});

// 意图：300px长标签在横向与纵向Sankey都由布局预留文字空间；纵向还需按行测宽扩展场景，多行标签全部保留。
test('long-label sankey reserves text bounds in both orientations', () => {
  const assertLabelsPreserved = (scene, data) => {
    const labels = new Map();
    const visit = child => {
      if (child.meta?.kind === 'label') {
        const group = labels.get(child.meta.node) || [];
        group.push(child.text);
        labels.set(child.meta.node, group);
      }
      for (const nested of child.children || []) visit(nested);
    };
    scene.children.forEach(visit);
    for (const node of data.nodes) {
      const lines = labels.get(node.id) || [];
      assert.ok(lines.length > 0, `${node.id} has a rendered label block`);
      assert.equal(lines.join('').replace(/\s/g, ''), String(node.label).replace(/\s/g, ''), `${node.id} retains its complete label`);
    }
  };
  const horizontal = {
    nodes: [
      { id: 'a', label: '跨境电商平台自营仓发货', stage: 0 },
      { id: 'b', label: '新注册且完成首单的用户', stage: 1 },
    ],
    edges: [{ id: 'ab', source: 'a', target: 'b', value: 10 }],
  };
  const horizontalScene = K.render({ chart: 'sankey', data: horizontal }, { width: 300 }).scene;
  assert.ok(!horizontalScene.overflow || Object.values(horizontalScene.overflow).every(value => value === 0));
  assertLabelsPreserved(horizontalScene, horizontal);

  const vertical = {
    nodes: [
      { id: 'a', label: '跨境电商平台自营仓发货', stage: 0 },
      { id: 'b', label: '新注册且完成首单的用户', stage: 0 },
      { id: 'c', label: '第三方配送平台外卖订单', stage: 1 },
      { id: 'd', label: '高校与科研机构采购合同，含跨年度框架协议下的分批交付与验收后付款订单', stage: 1 },
    ],
    edges: [
      { id: 'ac', source: 'a', target: 'c', value: 10 },
      { id: 'bd', source: 'b', target: 'd', value: 10 },
    ],
  };
  const verticalScene = K.render({ chart: 'sankey', layout: 'down', data: vertical }, { width: 300 }).scene;
  assert.ok(!verticalScene.overflow || Object.values(verticalScene.overflow).every(value => value === 0));
  assert.ok(verticalScene.width > 300, 'long-label rows deliberately widen the scene');
  assertLabelsPreserved(verticalScene, vertical);
});

// 意图：Sankey的stage只是排列序号，横向与纵向都不把它画成“0”“1”这样的阶段标题。
test('sankey never prints stage indices as stage labels', () => {
  const data = {
    nodes: [{ id: 'a', label: '来源', stage: 0 }, { id: 'b', label: '结果', stage: 1 }],
    edges: [{ id: 'ab', source: 'a', target: 'b', value: 10 }],
  };
  for (const layout of ['right', 'down']) {
    const scene = K.render({ chart: 'sankey', layout, data }, { width: 300 }).scene;
    const texts = [];
    const visit = child => {
      if (child.tag === 'text') texts.push(child.text);
      for (const nested of child.children || []) visit(nested);
    };
    scene.children.forEach(visit);
    assert.equal(texts.filter(text => /^(?:0|1)$/.test(text)).length, 0, `${layout} layout has no stage index text`);
  }
});

// 意图：圆形网络半径只在最外侧标签放不下时才收小；窄画布按最小可读标签加宽，宽画布保持原有尺寸。
test('circular network shrinks its radius only for labels that would leave the canvas', () => {
  const nodes = (labels) => labels.map((label, i) => ({ id: `n${i}`, label }));
  const ring = (count) => Array.from({ length: count }, (_, i) => ({ id: `e${i}`, source: `n${i}`, target: `n${(i + 1) % count}` }));
  const nodeXs = (scene) => scene.children.filter((node) => node.tag === 'circle' && node.meta?.kind === 'node').map((node) => node.attrs.cx);
  const span = (labels) => {
    const xs = nodeXs(K.render({ chart: 'network', data: { nodes: nodes(labels), edges: ring(4) } }, { width: 558 }).scene);
    return Math.max(...xs) - Math.min(...xs);
  };
  const tiny = span(['A', 'B', 'C', 'D']);
  assert.equal(span(['节点1', '节点2', '节点3', '节点4']), tiny, 'labels that fit do not shrink the circle');
  assert.ok(tiny >= 558 / 2, 'the circle spans at least half of a 558px canvas');
  const long = K.render({ chart: 'network', data: { nodes: nodes(['North America enterprise accounts', 'First-time buyers with a completed order', 'Cross-border fulfilment from own warehouse', 'University and research procurement']), edges: ring(4) } }, { width: 240, lang: 'en' }).scene;
  assert.ok(!long.overflow || Object.values(long.overflow).every((value) => value === 0), 'long labels stay inside the scene');
  const longXs = nodeXs(long);
  assert.ok(Math.max(...longXs) - Math.min(...longXs) >= 96 - 1, 'the circle keeps its minimum readable radius');
});

// 意图：240px force网络按节点标签最小换行宽度预留两侧边距，节点区过窄时加宽场景。
test('narrow force network reserves long-label text bounds', () => {
  const data = {
    nodes: [
      { id: 'a', label: 'North America enterprise accounts' },
      { id: 'b', label: 'First-time buyers with a completed order' },
      { id: 'c', label: 'Cross-border fulfilment from own warehouse' },
      { id: 'd', label: 'University and research procurement' },
    ],
    edges: [
      { id: 'ab', source: 'a', target: 'b' }, { id: 'bc', source: 'b', target: 'c' },
      { id: 'cd', source: 'c', target: 'd' }, { id: 'da', source: 'd', target: 'a' },
    ],
  };
  const scene = K.render({ chart: 'network', layout: 'force', data }, { width: 240, lang: 'en' }).scene;
  assert.ok(!scene.overflow || Object.values(scene.overflow).every(value => value === 0));
  assert.ok(scene.width > 240, 'narrow force layouts deliberately reserve a readable label margin');
});

// 意图：给足流量的Sankey ribbon显示对应读数，避免数值太细时把12px文字硬塞到窄流带。
test('sankey prints edge values only when ribbon thickness can hold the label', () => {
  const data = {
    nodes: [{ id: 'a', label: '入口', stage: 0 }, { id: 'b', label: '中段', stage: 1 }, { id: 'c', label: '结果', stage: 2 }],
    edges: [{ id: 'b20', source: 'a', target: 'b', value: 20 }, { id: 'b30', source: 'a', target: 'b', value: 30 }, { id: 'c20', source: 'b', target: 'c', value: 20 }, { id: 'c30', source: 'b', target: 'c', value: 30 }],
  };
  const scene = layout('sankey', data);
  const labels = scene.scene.children.filter((child) => child.meta?.kind === 'edge-label');
  assert.deepEqual(plain(labels.map((label) => label.meta.edge)), ['b20', 'b30', 'c20', 'c30']);
  assert.deepEqual(plain(labels.map((label) => label.text)), ['20', '30', '20', '30']);
  assert.ok(labels.every((label) => label.attrs['font-size'] >= 12));
});

// 意图：细流带没有读数时，静态图仍要能读出量：每个节点名下标出节点总量，并与流带读数共用单位。
test('sankey labels every node with its total so thin unlabelled ribbons stay readable', () => {
  const data = {
    nodes: [{ id: 'gas', label: 'Gas' }, { id: 'power', label: 'Electricity' }, { id: 'heat', label: 'Heating' }, { id: 'light', label: 'Lighting' }],
    edges: [{ source: 'gas', target: 'heat', value: 42 }, { source: 'power', target: 'heat', value: 9 }, { source: 'power', target: 'light', value: 1 }],
  };
  for (const layoutName of ['right', 'down']) {
    const scene = K.render({ chart: 'sankey', layout: layoutName, unit: 'TWh', data }, { width: 720, lang: 'en' }).scene;
    const totals = Object.fromEntries(scene.children.filter((child) => child.meta?.kind === 'node-total').map((child) => [child.meta.node, child.text]));
    assert.deepEqual(totals, { gas: '42 TWh', power: '10 TWh', heat: '51 TWh', light: '1 TWh' }, layoutName);
    assert.ok(!scene.children.some((child) => child.meta?.kind === 'edge-label' && child.meta.value === 1), 'the 1 TWh ribbon is too thin for its own readout');
  }
});

// 意图：多入多出流带交叉处的20和30曾完全重叠，所有读数须保留且沿各自曲线避让。
test('sankey readouts avoid one another and render above every ribbon', () => {
  const fixture = KCHART_CASES.find(item => item.id === 'chart-sankey').spec;
  const scene = K.layout(fixture, { width: 984 });
  const labels = scene.children.filter(node => node.meta?.kind === 'edge-label');
  const measure = K.util.context().measure;
  assert.ok(labels.length >= 2, 'thick ribbons keep a readout when it fits the band');
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    const a = labels[i], b = labels[j];
    assert.ok(Math.abs(a.attrs.y - b.attrs.y) >= 16 || Math.abs(a.attrs.x - b.attrs.x) >= (measure(a.text, 12) + measure(b.text, 12)) / 2 + 4);
  }
  const lastRibbon = scene.children.reduce((last, node, i) => node.meta?.kind === 'edge' ? i : last, -1);
  assert.ok(labels.every(node => scene.children.indexOf(node) > lastRibbon));
});

// 意图：窄环形网络的图例紧贴节点与文字外包框，避免固定最小高度留下大片空白。
test('narrow circular network sizes its legend gap from rendered content', () => {
  const spec = KCHART_CASES.find(item => item.id === 'chart-network').spec;
  const scene = K.layout(spec, { width: 268 });
  const legend = scene.children.find(node => node.meta?.kind === 'size-legend');
  const nodeBottom = Math.max(...scene.children.filter(node => node.meta?.kind === 'node').map(node => node.attrs.cy + node.attrs.r));
  const labelBottom = Math.max(...scene.children.filter(node => node.meta?.kind === 'label').map(node => node.attrs.y + 3));
  assert.equal(legend.attrs.y - Math.max(nodeBottom, labelBottom), 16, 'legend starts 16px after the actual content bounds');
  assert.ok(scene.height < 300, `narrow graph should not retain a desktop height, got ${scene.height}`);
  assert.ok(legend.attrs.y < scene.height && scene.height - legend.attrs.y <= 12, 'legend remains at the scene bottom');
});

// 意图：真实几何检查确保两种方向的流带从node边界端口闭合，平行边分别占有端口，零值节点不制造流带。
test('sankey ribbons start and end at bounded ports in both orientations', () => {
  const data = {
    nodes: [
      { id: 'source', label: '源头长标签需要换行', stage: 0 },
      { id: 'a', label: '分支甲', stage: 1 }, { id: 'b', label: '分支乙', stage: 1 },
      { id: 'end', label: '最终阶段需要较长中文标签', stage: 2 },
      { id: 'idle', label: '零流量节点', stage: 1 },
    ],
    edges: [
      { id: 'parallel-1', source: 'source', target: 'a', value: 1 },
      { id: 'parallel-2', source: 'source', target: 'a', value: 1 },
      { id: 'source-b', source: 'source', target: 'b', value: 3 },
      { id: 'a-end', source: 'a', target: 'end', value: 2 },
      { id: 'b-end', source: 'b', target: 'end', value: 3 },
    ],
  };
  const pairValues = (d) => [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => [+m[1], +m[2]]);
  for (const layoutName of ['right', 'down']) {
    const validation = K.validate({ chart: 'sankey', data, layout: layoutName });
    assert.deepEqual(plain(validation.errors), []);
    const rendered = layout('sankey', data, { layout: layoutName, lang: 'zh' });
    const horizontal = layoutName !== 'down';
    const flat = allNodes(rendered.scene.children);
    const rects = new Map(flat.filter((child) => child.meta?.kind === 'node').map((child) => [child.meta.node, child.attrs]));
    const ribbons = flat.filter((child) => child.meta?.kind === 'edge');
    assert.equal(ribbons.length, data.edges.length);
    assert.equal(ribbons.find((r) => r.meta.edge === 'parallel-1').attrs.d !== ribbons.find((r) => r.meta.edge === 'parallel-2').attrs.d, true);
    const used = new Map();
    for (const ribbon of ribbons) {
      const edge = data.edges.find((candidate) => candidate.id === ribbon.meta.edge), points = pairValues(ribbon.attrs.d);
      assert.ok(points.length >= 7, `closed ribbon ${edge.id} has ${points.length} points: ${ribbon.attrs.d.slice(0, 80)}`);
      const source = rects.get(edge.source), target = rects.get(edge.target), sOffset = used.get(`out:${edge.source}`) || 0, tOffset = used.get(`in:${edge.target}`) || 0;
      const stageTotal = data.edges.filter((item) => item.source === edge.source || item.target === edge.source)
        .reduce((sum, item) => sum + (item.source === edge.source ? item.value : 0), 0) || 1;
      const thick = (horizontal ? source.height : source.width) * edge.value / (edge.source === 'source' ? 5 : stageTotal);
      if (horizontal) {
        assert.ok(Math.abs(points[0][0] - (source.x + source.width)) < .02);
        assert.ok(Math.abs(points[0][1] - (source.y + sOffset)) < .02);
        assert.ok(Math.abs(points[3][0] - target.x) < .02);
        assert.ok(Math.abs(points[3][1] - (target.y + tOffset)) < .02);
        assert.ok(points[0][1] + thick <= source.y + source.height + .02);
        assert.ok(points[3][1] + thick <= target.y + target.height + .02);
      } else {
        assert.ok(Math.abs(points[0][0] - (source.x + sOffset)) < .02);
        assert.ok(Math.abs(points[0][1] - (source.y + source.height)) < .02);
        assert.ok(Math.abs(points[3][0] - (target.x + tOffset)) < .02);
        assert.ok(Math.abs(points[3][1] - target.y) < .02);
        assert.ok(points[0][0] + thick <= source.x + source.width + .02);
        assert.ok(points[3][0] + thick <= target.x + target.width + .02);
      }
      used.set(`out:${edge.source}`, sOffset + thick);
      used.set(`in:${edge.target}`, tOffset + thick);
    }
    assert.deepEqual(plain(ribbons.map((r) => r.meta.edge)), data.edges.map((e) => e.id));
    assert.equal(horizontal ? rects.get('idle').height : rects.get('idle').width, 0);
    assert.ok([...rects.values()].every((rect) => rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 720 && rect.y + rect.height <= rendered.scene.height), `${layoutName} height=${rendered.scene.height}: ${JSON.stringify([...rects])}`);
    assert.ok(rendered.scene.children.filter((child) => child.tag === 'text').every((label) => Number(label.attrs['font-size']) >= 12));
    assert.equal(rendered.scene.title, undefined);
  }
});

// 意图：60节点集中在单一阶段且节点无流量时仍按中文label换行高度布局，不压扁或越出scene。
test('sankey reserves actual wrapped label height for dense zero-flow stages', () => {
  const data = { nodes: Array.from({ length: 60 }, (_, i) => ({ id: `n${i}`, label: `零流量节点 ${i} 的长名称`, stage: 0 })), edges: [] };
  const rendered = layout('sankey', data);
  // 长标签超出左边时核心会把内容包进平移组，按整棵场景树查找。
  const all = (children) => children.flatMap((child) => [child, ...all(child.children || [])]);
  const nodes = all(rendered.scene.children).filter((child) => child.meta?.kind === 'node');
  const labels = all(rendered.scene.children).filter((child) => child.meta?.kind === 'label');
  assert.equal(nodes.length, 60);
  assert.ok(labels.length >= 60);
  assert.equal(new Set(labels.map((label) => label.meta.node)).size, 60);
  assert.ok(rendered.scene.height > 2000);
  assert.ok(nodes.every((node) => node.attrs.y >= 0 && node.attrs.y + node.attrs.height <= rendered.scene.height));
  assert.ok(labels.every((label) => label.attrs.y > 0 && label.attrs.y <= rendered.scene.height));
  assert.equal(all(rendered.scene.children).filter((child) => child.meta?.kind === 'edge').length, 0);
});

// 意图：五条threads按输入权重分配线宽、将上限约束到stage间距，并独立留出标签通道及压缩垂直留白。
test('threads allocate five route widths by value and keep node labels outside the flow lane', () => {
  const data = {
    stages: [{ id: 's1', label: '入口' }, { id: 's2', label: '评估' }, { id: 's3', label: '结果' }],
    nodes: [{ id: 'web', label: '网页', stage: 's1' }, { id: 'app', label: 'App', stage: 's1' }, { id: 'demo', label: '演示', stage: 's2' }, { id: 'trial', label: '试用', stage: 's2' }, { id: 'buy', label: '购买', stage: 's3' }, { id: 'drop', label: '放弃', stage: 's3' }],
    paths: [{ id: 'p1', nodes: ['web', 'demo', 'buy'], value: 9 }, { id: 'p2', nodes: ['web', 'trial', 'buy'], value: 6 }, { id: 'p3', nodes: ['web', 'trial', 'drop'], value: 4 }, { id: 'p4', nodes: ['app', 'trial', 'buy'], value: 5 }, { id: 'p5', nodes: ['app', 'demo', 'drop'], value: 3 }],
  };
  const scene = layout('threads', data).scene;
  const paths = scene.children.filter((child) => child.meta?.kind === 'path');
  const nodes = new Map(scene.children.filter((child) => child.meta?.kind === 'node').map((child) => [child.meta.node, child]));
  const labels = scene.children.filter((child) => child.meta?.kind === 'label');
  assert.deepEqual(plain(paths.map((path) => path.meta.path)), ['p1', 'p2', 'p3', 'p4', 'p5']);
  assert.ok(Math.abs(paths[0].attrs['stroke-width'] / paths[4].attrs['stroke-width'] - 3) < 1e-9);
  assert.ok(scene.height < 380, 'default layout does not preserve a large empty band');
  const lowest = Math.max(...scene.children.filter((child) => child.tag === 'text').map((child) => child.attrs.y));
  assert.ok(scene.height - lowest <= 20, `the scene ends just below the stage names (${scene.height} vs ${lowest})`);
  assert.ok(labels.every((label) => label.attrs.y + 4 < nodes.get(label.meta.node).attrs.cy - 3.5), 'labels have a dedicated lane above the paths');
  const maxPathWidth = 296 * .05;
  assert.ok(paths.every((path) => path.attrs['stroke-width'] <= maxPathWidth), 'route width is capped by adjacent-stage spacing');
});

// 意图：threads逐路径输出而非聚合重构，重复节点序列仍按ID分开，端口稳定并把共享路径集写入related。
test('threads keep repeated routes independent and expose deterministic bundle metadata', () => {
  const data = {
    stages: [{ id: 's0', label: '起点' }, { id: 's1', label: '中段' }, { id: 's2', label: '终点' }],
    nodes: [{ id: 'a', label: 'A', stage: 's0' }, { id: 'b', label: 'B', stage: 's1' }, { id: 'c', label: 'C', stage: 's2' }],
    paths: [{ id: 'p1', nodes: ['a', 'b', 'c'], value: 2 }, { id: 'p2', nodes: ['a', 'b', 'c'], value: 1 }],
  };
  const first = layout('threads', data), second = layout('threads', data);
  const paths = first.scene.children.filter((child) => child.meta?.kind === 'path');
  assert.deepEqual(plain(paths.map((path) => path.meta.path)), ['p1', 'p2']);
  assert.deepEqual(plain(paths.map((path) => path.meta.related)), [['p2'], ['p1']]);
  assert.notEqual(paths[0].attrs.d, paths[1].attrs.d);
  assert.deepEqual(plain(first.scene), plain(second.scene));
  assert.ok(first.scene.height < 640, 'compact route set should not retain the legacy oversized blank canvas');
  assert.equal(paths[0].attrs['stroke-width'] / paths[1].attrs['stroke-width'], 2, 'route widths follow provided values');
  const labels = first.scene.children.filter((child) => child.meta?.kind === 'label');
  const nodes = new Map(first.scene.children.filter((child) => child.meta?.kind === 'node').map((child) => [child.meta.node, child]));
  assert.ok(labels.every((label) => label.attrs.y + 4 < nodes.get(label.meta.node).attrs.cy - 3.5), 'node labels sit above their ribbon lanes');
  const node = first.scene.children.find((child) => child.meta?.kind === 'node' && child.meta.node === 'b');
  assert.deepEqual(plain(node.meta.related), ['p1', 'p2']);
  assert.match(first.svg, /data-kc-path="p1"/);
});

const allNodes = (children) => children.flatMap((child) => [child, ...allNodes(child.children || [])]);

// 意图：同列长短标签按各自换行高度错开；纵向标签停在下一阶段之前；单阶段标签朝内且不靠事后扩边。
test('sankey labels keep a measured lane and never cross the next stage', () => {
  const right = {
    nodes: [
      { id: 'a', label: '入口甲', stage: 0 },
      { id: 'b', label: '入口乙需要换行的长名称', stage: 0 },
      { id: 'c', label: '出口', stage: 1 },
    ],
    edges: [{ source: 'a', target: 'c', value: 2 }, { source: 'b', target: 'c', value: 3 }],
  };
  const scene = K.layout({ chart: 'sankey', layout: 'right', data: right }, { width: 640 }).children;
  const nodes = new Map(scene.filter((node) => node.meta?.kind === 'node').map((node) => [node.meta.node, node]));
  const labels = scene.filter((node) => node.meta?.kind === 'label');
  const band = (id) => {
    const lines = labels.filter((node) => node.meta.node === id);
    return { top: Math.min(...lines.map((line) => line.attrs.y)) - 12, bottom: Math.max(...lines.map((line) => line.attrs.y)) + 4 };
  };
  const first = band('a'), second = band('b');
  assert.ok(first.bottom <= second.top || second.bottom <= first.top, 'same-column labels do not share a vertical band');
  const down = K.layout({ chart: 'sankey', layout: 'down', data: {
    nodes: [
      { id: 'a', label: '第一阶段很长的节点名称', stage: 0 },
      { id: 'b', label: '第二阶段', stage: 1 },
    ],
    edges: [{ source: 'a', target: 'b', value: 4 }],
  } }, { width: 420 });
  const downNodes = new Map(allNodes(down.children).filter((node) => node.meta?.kind === 'node').map((node) => [node.meta.node, node.attrs]));
  const downLabels = allNodes(down.children).filter((node) => node.meta?.kind === 'label' && node.meta.node === 'a');
  const nextTop = downNodes.get('b').y;
  assert.ok(downLabels.every((label) => label.attrs.x >= downNodes.get('a').x + downNodes.get('a').width), 'down-layout labels sit beside the node');
  assert.ok(Math.max(...downLabels.map((label) => label.attrs.y)) < nextTop + downNodes.get('b').height, 'down-layout labels stay in their own stage band');
  const alone = K.layout({ chart: 'sankey', layout: 'right', data: { nodes: [{ id: 'only', label: '单独阶段的长标签名称', stage: 0 }], edges: [] } }, { width: 360 });
  assert.equal(alone.overflow, undefined, 'a single stage reserves its measured label lane instead of overflowing');
  const aloneLabel = allNodes(alone.children).find((node) => node.meta?.kind === 'label');
  assert.equal(aloneLabel.attrs['text-anchor'], 'end');
});

// 意图：横向路径把长标签留在阶段之间的实测带内；纵向只按标签带的实测下限加宽。
test('threads keep long labels in a measured lane beside each stage', () => {
  const data = {
    stages: [{ id: 's0', label: '起点' }, { id: 's1', label: '终点' }],
    nodes: [
      { id: 'a', label: '很长的入口节点名称需要完整留下', stage: 's0' },
      { id: 'b', label: '出口', stage: 's1' },
    ],
    paths: [{ id: 'p', nodes: ['a', 'b'], value: 2 }],
  };
  const scene = K.layout({ chart: 'threads', layout: 'right', data }, { width: 280 });
  const node = allNodes(scene.children).find((child) => child.meta?.node === 'b' && child.tag === 'circle');
  const label = allNodes(scene.children).find((child) => child.meta?.kind === 'label' && child.meta.node === 'a');
  const width = K.util.context().measure(label.text, 12, 400);
  assert.ok(label.attrs.y + 4 < node.attrs.cy - 3.5, 'the label stays above the flow');
  assert.ok(label.attrs.x + width / 2 <= node.attrs.cx - 8, 'the label ends before the next stage node');
  const narrow = K.layout({ chart: 'threads', layout: 'down', data }, { width: 240 });
  const wide = K.layout({ chart: 'threads', layout: 'down', data }, { width: 240, measure: (text) => [...text].length * 14 });
  assert.ok(wide.width >= narrow.width, `a wider measured label widens the down layout (${narrow.width} vs ${wide.width})`);
  assert.ok(wide.width - 240 < 800, 'widening stays near the measured label lane');
});

// 意图：横向Sankey两侧标签列按实测宽度隔开；密集同阶段名称堆叠后扩高，不以固定间距互相覆盖。
test('sankey allocates measured label columns and stacks dense names', () => {
  const data = {
    nodes: Array.from({ length: 16 }, (_, i) => ({ id: `a${i}`, label: `Cross-border fulfilment from own warehouse ${i}`, stage: 0 }))
      .concat(Array.from({ length: 16 }, (_, i) => ({ id: `b${i}`, label: `University and research procurement ${i}`, stage: 1 }))),
    edges: [],
  };
  const scene = K.layout({ chart: 'sankey', layout: 'right', data }, { width: 268 });
  const measure = K.util.context().measure;
  const labels = scene.children.filter(node => node.meta?.kind === 'label').map(node => {
    const w = measure(node.text, 12, 400), x = Number(node.attrs.x);
    return { id: node.meta.node, left: node.attrs['text-anchor'] === 'end' ? x - w : x, right: node.attrs['text-anchor'] === 'end' ? x : x + w, top: Number(node.attrs.y) - 12, bottom: Number(node.attrs.y) + 2 };
  });
  assert.ok(scene.width > 268, 'readable label columns widen the narrow frame');
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    const a = labels[i], b = labels[j];
    assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, `${a.id} and ${b.id} labels stay in separate boxes`);
  }
  assert.ok(scene.height > 360, 'the stage label stack grows the plot rather than overlapping');
});

// 意图：Sankey流带读数只有在真实文字框避开所有节点标签时才显示，且数值仍保留在边元数据。
test('sankey readouts never intrude into node label boxes', () => {
  const data = {
    nodes: [{ id: 'a', label: 'Cross-border fulfilment', stage: 0 }, { id: 'b', label: 'University procurement', stage: 0 }, { id: 'c', label: 'Completed order', stage: 1 }, { id: 'd', label: 'Renewal', stage: 1 }],
    edges: [{ id: 'ac', source: 'a', target: 'c', value: 80 }, { id: 'ad', source: 'a', target: 'd', value: 60 }, { id: 'bc', source: 'b', target: 'c', value: 40 }, { id: 'bd', source: 'b', target: 'd', value: 20 }],
  };
  const scene = K.layout({ chart: 'sankey', layout: 'right', data }, { width: 720 });
  const measure = K.util.context().measure;
  const labels = scene.children.filter(node => node.meta?.kind === 'label').map(node => {
    const w = measure(node.text, 12, 400), left = node.attrs['text-anchor'] === 'end' ? node.attrs.x - w : node.attrs.x;
    return { left, right: left + w, top: node.attrs.y - 12, bottom: node.attrs.y + 3 };
  });
  const readouts = scene.children.filter(node => node.meta?.kind === 'edge-label');
  for (const value of readouts) {
    const w = measure(value.text, 12), box = { left: value.attrs.x - w / 2, right: value.attrs.x + w / 2, top: value.attrs.y - 12, bottom: value.attrs.y + 3 };
    assert.ok(labels.every(label => box.right <= label.left || label.right <= box.left || box.bottom <= label.top || label.bottom <= box.top));
  }
  assert.deepEqual(plain(scene.children.filter(node => node.meta?.kind === 'edge').map(node => node.meta.value)), [80, 60, 40, 20]);
});

// 意图：threads横向同列标签以测得行高堆叠并使用不透明背景板，避免互相碰撞及线束低对比。
test('threads horizontal labels stack with readable background plates', () => {
  const data = {
    stages: [{ id: 's0', label: 'Start' }, { id: 's1', label: 'Middle' }, { id: 's2', label: 'End' }],
    nodes: ['s0', 's1', 's2'].flatMap((stage, index) => Array.from({ length: 4 }, (_, i) => ({ id: `${stage}-${i}`, stage, label: [`Cross-border fulfilment from own warehouse`, `University and research procurement`, `First-time buyers with a completed order`, `Self-serve annual renewals`][(i + index) % 4] }))),
    paths: [],
  };
  const scene = K.layout({ chart: 'threads', layout: 'right', data }, { width: 320 });
  const measure = K.util.context().measure;
  const labels = scene.children.filter(node => node.meta?.kind === 'label');
  assert.equal(scene.children.filter(node => node.meta?.kind === 'label-plate').length, data.nodes.length);
  const boxes = labels.map(node => { const w = measure(node.text, 12); return { left: node.attrs.x - w / 2, right: node.attrs.x + w / 2, top: node.attrs.y - 12, bottom: node.attrs.y + 2 }; });
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, 'thread names have distinct measured boxes');
  }
});

// 意图：threads纵向标签槽按完整名称实测宽度扩开，且宽度、节点名数量均保持完整。
test('threads vertical labels reserve measured name width', () => {
  const data = {
    stages: [{ id: 's0', label: 'Start' }, { id: 's1', label: 'End' }],
    nodes: Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, label: ['Cross-border fulfilment from own warehouse', 'University and research procurement', 'First-time buyers with a completed order'][i % 3], stage: 's0' }))
      .concat(Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, label: ['Self-serve annual renewals', 'Partner-led marketplace orders', 'Returning customers'][i % 3], stage: 's1' }))),
    paths: [],
  };
  const scene = K.layout({ chart: 'threads', layout: 'down', data }, { width: 240 });
  const labels = scene.children.filter(node => node.meta?.kind === 'label');
  assert.equal(new Set(labels.map(node => node.meta.node)).size, data.nodes.length);
  assert.ok(scene.width > 240, 'the measured label slots widen the narrow vertical layout');
  assert.ok(labels.every(node => Number(node.attrs['font-size']) >= 12));
});

// 意图：膜带和连线上的标签按合成底色取色，并带浅底，避免同色文字融进膜里。
test('network labels on membranes use the composited underlay colour', () => {
  const data = {
    nodes: [{ id: 'a', label: '甲', group: 'g' }, { id: 'b', label: '乙', group: 'g' }],
    edges: [{ source: 'a', target: 'b' }],
  };
  const scene = K.layout({ chart: 'network', variant: 'membrane', data }, { width: 480, theme: 'claude' });
  const label = allNodes(scene.children).find((node) => node.meta?.kind === 'label');
  const halo = allNodes(scene.children).find((node) => node.tag === 'rect');
  assert.ok(halo, 'each label sits on a background halo');
  assert.equal(label.attrs.fill, K.util.context({ theme: 'claude' }).textOn('tone3', { opacity: 0.24 }));
});
