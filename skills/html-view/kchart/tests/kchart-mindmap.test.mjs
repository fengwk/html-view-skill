import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadChart } from './kchart-fixture.mjs';
import { themes } from '../node.mjs';
import { KCHART_CASES } from './kchart-cases.mjs';

const { api: K } = loadChart(['chart/mindmap']);
const plain = value => JSON.parse(JSON.stringify(value));
const data = {
  id: 'root', label: '中心主题：覆盖所有结构与长标签', note: '根节点注释也需要清晰可见', children: [
    { id: 'a', label: '规划与设计领域的较长分类名称', note: '先澄清问题边界，再选择设计方案', children: [
      { id: 'a1', label: '保持所有叶子节点完整呈现', note: '叶子注释不能被省略' },
      { id: 'a2', label: '测字后换行的中文长文本' },
    ] },
    { id: 'b', label: '交付与验证', children: [
      { id: 'b1', label: '自动化测试覆盖' },
      { id: 'b2', label: '视觉核验' },
    ] },
    { id: 'c', label: '治理' },
    { id: 'd', label: '迭代' },
  ],
};
const spec = layout => ({ chart: 'mindmap', layout, variant: 'editorial', data });

function assertDisjoint(nodes, layout) {
  for (let i = 0; i < nodes.length; i += 1) for (let j = i + 1; j < nodes.length; j += 1) {
    const a = nodes[i], b = nodes[j];
    const separated = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    assert.ok(separated, `${layout}: boxes ${a.id} and ${b.id} overlap: ${JSON.stringify([a,b])}`);
  }
}

// 意图：八种布局均沿用同一树数据，节点数和ID集合完全守恒，并固定严格不重叠几何断言。
test('all eight mindmap layouts preserve the source tree and never overlap node boxes', () => {
  const ids = ['root', 'a', 'a1', 'a2', 'b', 'b1', 'b2', 'c', 'd'];
  for (const layout of ['bilateral', 'right', 'left', 'radial', 'org', 'brace', 'fishbone', 'timeline']) {
    let scene;
    try { scene = K.layout(spec(layout), { width: 640, measure: text => [...text].length * 8 }); }
    catch (error) { throw new Error(`${layout}: ${error.message}`, { cause: error }); }
    const nodes = plain(scene.nodes);
    assert.deepEqual(nodes.map(n => n.id).sort(), [...ids].sort(), `${layout} must not lose or duplicate any node`);
    assert.equal(new Set(nodes.map(n => n.id)).size, ids.length);
    assert.equal(plain(scene.edges).length, ids.length - 1, `${layout} must preserve each parent relationship`);
    assert.ok(scene.width > 0 && scene.height > 0);
    const root = nodes.find(node => node.id === 'root');
    assert.deepEqual(plain(scene.anchor), { x: root.x + root.w / 2, y: root.y + root.h / 2 }, `${layout} anchor must target the root center`);
    for (const n of nodes) assert.ok(n.w > 0 && n.h > 0 && n.x >= 0 && n.y >= 0, `${layout}: invalid node bounds`);
    assertDisjoint(nodes, layout);
    assert.equal(JSON.stringify(plain(K.layout(spec(layout), { width: 640, measure: text => [...text].length * 8 }))), JSON.stringify(plain(scene)), `${layout} must be deterministic`);
  }
});

// 意图：径向脑图的环半径按实测文本框的外接圆加大，长短标签相邻时标签块仍分离；子节点留在父节点扇区内。
test('radial allocation reserves angle for differently sized wrapped sibling labels', () => {
  const labels = [
    'Self-serve annual renewals (net)', 'West', 'North America enterprise accounts',
    'University and research procurement', 'Partner-led marketplace orders', 'Online',
    'Cross-border fulfilment from own warehouse', 'Retail',
  ];
  const radialData = { label: 'Regional revenue', children: labels.map((label, i) => ({
    id: `branch-${i}`, label, note: i % 2 ? 'North America' : '',
    children: Array.from({ length: i % 3 + 1 }, (_, j) => ({ id: `leaf-${i}-${j}`, label: labels[(i + j + 2) % labels.length] })),
  })) };
  const scene = K.layout({ chart: 'mindmap', layout: 'radial', data: radialData }, { width: 300, lang: 'en', measure: text => [...text].length * 7.3 });
  assert.equal(scene.layout, 'radial', 'space is added to the requested radial scene instead of changing layout');
  assertDisjoint(plain(scene.nodes), 'radial variable label widths');
  assert.ok(scene.width > 300 || scene.height > 300, 'the radial scene grows when its measured label blocks need more room');
  // 每个子节点相对根的方向都落在父节点扇区内：与父节点方向的夹角不超过父扇区的一半。
  const nodes = plain(scene.nodes), byId = new Map(nodes.map((node) => [node.id, node]));
  const root = nodes.find((node) => node.depth === 0);
  const center = (node) => [node.x + node.w / 2 - (root.x + root.w / 2), node.y + node.h / 2 - (root.y + root.h / 2)];
  const direction = (node) => Math.atan2(center(node)[1], center(node)[0]);
  const leafCount = (id) => { const kids = nodes.filter((node) => node.parent === id); return kids.length ? kids.reduce((sum, kid) => sum + leafCount(kid.id), 0) : 1; };
  const total = leafCount(root.id);
  for (const node of nodes.filter((item) => item.depth === 2)) {
    const parent = byId.get(node.parent);
    const turn = Math.abs(((direction(node) - direction(parent)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
    assert.ok(turn <= Math.PI * leafCount(parent.id) / total + 1e-9, `${node.id} stays inside the sector of ${parent.id}`);
  }
});

// 意图：以宽分支树和单节点树覆盖径向分配、鱼骨分组及布局边界，几何重叠始终保持严格断言。
test('radial and specialized layouts keep highly branching and degenerate trees disjoint', () => {
  const broad = { label: 'root', children: Array.from({ length: 8 }, (_, i) => ({ label: `category-${i}`, children: Array.from({ length: 5 }, (_, j) => ({ label: `leaf-${i}-${j}` })) })) };
  const single = { label: 'only node', note: 'single-node note' };
  for (const data of [broad, single]) for (const layout of ['bilateral', 'right', 'left', 'radial', 'org', 'brace', 'fishbone', 'timeline']) {
    const scene = K.layout({ chart: 'mindmap', layout, data }, { measure: text => [...text].length * 7 });
    assert.equal(scene.nodes.length, data === single ? 1 : 49, `${layout} must preserve every branch`);
    assertDisjoint(plain(scene.nodes), layout);
  }
});

// 意图：真实ctx.wrap测字、保留注释，并确保SVG文本水平显示；风险是节点布局完整但标签被裁切或注释静默丢失。
test('measured long labels and notes are wrapped and rendered horizontally in both variants', () => {
  for (const variant of ['editorial', 'cards']) {
    const scene = K.layout({ ...spec('right'), variant }, { width: 480, measure: text => [...text].length * 9 });
    const texts = scene.children.filter(node => node.tag === 'text');
    const label = texts.filter(node => node.meta?.role === 'label').map(node => node.text).join('');
    const notes = texts.filter(node => node.meta?.role === 'note').map(node => node.text).join('');
    assert.equal(label, data.label + data.children.flatMap(n => [n.label, ...(n.children || []).map(c => c.label)]).join(''));
    assert.equal(notes, data.note + data.children.flatMap(n => [n.note || '', ...(n.children || []).map(c => c.note || '')]).join(''));
    assert.ok(texts.length > 0);
    assert.ok(texts.every(node => !('transform' in node.attrs) && !('rotate' in node.attrs)));
    assert.ok(scene.nodes.some(node => node.h > 34), 'wrapped content must increase box height');
    assert.ok(scene.nodes.some(node => node.note), 'source notes must remain in scene geometry');
    const framed = new Set(scene.children.filter(node => node.tag === 'rect').map(node => node.meta?.node));
    assert.ok(framed.has('root') && framed.has('a'), 'root and secondary categories must receive surface emphasis');
    if (variant === 'editorial') assert.ok(!framed.has('a1'), 'editorial leaves must remain unboxed');
    else assert.ok(framed.has('a1'), 'cards variant must frame leaves');
  }
});

// 意图：已建模但当前无安全图标路径渲染器时明确失败，避免接受icon字段却静默吞掉节点图标。
test('unsupported controlled icon slots fail explicitly instead of being ignored', () => {
  const { svg, diagnostics } = K.render({ ...spec('right'), data: { label: 'root', icon: 'alert-triangle' } });
  assert.equal(svg, null);
  assert.equal(diagnostics[0].code, 'CHART_FIT');
  assert.match(diagnostics[0].message, /不支持节点图标/);
  assert.match(diagnostics[0].fix, /删掉节点的 icon/);
});

// 意图：使用边框端口的布局仍从父框接到子框；双侧无框叶子的文字端口另测。
test('layout paths with box ports have finite coordinates and terminate on both node boundaries', () => {
  for (const layout of ['bilateral', 'right', 'left', 'radial', 'org', 'brace', 'fishbone', 'timeline']) {
    const variant = layout === 'bilateral' ? 'cards' : 'editorial';
    const scene = K.layout({ ...spec(layout), variant }, { width: 324, theme: 'obsidian', measure: text => [...text].length * 11 });
    const byId = new Map(plain(scene.nodes).map(node => [node.id, node]));
    for (const edge of plain(scene.edges)) {
      assert.ok(!/NaN|Infinity/.test(edge.d), `${layout}: path must be finite: ${edge.d}`);
      const points = [...edge.d.matchAll(/(?:M|L)\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)].map(m => [Number(m[1]), Number(m[2])]);
      assert.ok(points.length >= 2, `${layout}: edge must contain endpoints`);
      for (const [point, nodeId] of [[points[0], edge.from], [points.at(-1), edge.to]]) {
        const n = byId.get(nodeId), [x,y] = point, eps = 0.02;
        const onBoundary = Math.abs(x - n.x) < eps || Math.abs(x - n.x - n.w) < eps || Math.abs(y - n.y) < eps || Math.abs(y - n.y - n.h) < eps;
        assert.ok(onBoundary, `${layout}: endpoint ${point} must lie on ${nodeId} boundary`);
      }
    }
  }
});

// 意图：左右两侧都有长短不同的无框文字；窄屏仍须从父卡侧边水平出线，贴着真实文字对齐。
test('bilateral edges connect horizontally to visible cards or adjacent leaf text', () => {
  const measure = (text, size) => [...text].length * size * 0.85;
  const branch = (id, label) => ({ id, label, children: [
    { id: `${id}-long`, label: '观测目标与验收指标\n口径', note: '核对说明' },
    { id: `${id}-short`, label: '发布' },
  ] });
  const data = { id: 'root', label: '计划', children: [branch('left', '研究'), branch('right', '交付')] };
  const centerY = node => node.y + node.h / 2;
  for (const width of [268, 984]) for (const variant of ['editorial', 'cards']) {
    const scene = K.layout({ ...spec('bilateral'), variant, data }, { width, measure });
    const nodes = new Map(scene.nodes.map(node => [node.id, node]));
    for (const edge of scene.edges) {
      const parent = nodes.get(edge.from), child = nodes.get(edge.to);
      const left = child.x < parent.x;
      const startX = left ? parent.x : parent.x + parent.w;
      const commands = edge.d.split(/ (?=[MLQ])/);
      const points = commands.map(command => command.slice(1).split(' ').map(Number).slice(-2));
      const [endX, endY] = points.at(-1);
      assert.deepEqual(points[0], [startX, centerY(parent)], `${edge.to}: starts on the visible card side`);
      assert.equal(endY, centerY(child), `${edge.to}: finishes at the child center`);
      if (centerY(parent) === endY) {
        assert.equal(points.length, 2, `${edge.to}: aligned nodes use a straight horizontal edge`);
      } else {
        assert.equal(commands.filter(command => command.startsWith('Q')).length, 2, `${edge.to}: two rounded turns`);
        assert.equal(points[1][1], centerY(parent), `${edge.to}: horizontal exit before the first turn`);
        assert.equal(points.at(-2)[1], endY, `${edge.to}: horizontal approach after the last turn`);
      }
      if (variant === 'cards' || child.depth === 1) {
        assert.equal(endX, left ? child.x + child.w : child.x, `${edge.to}: connects to the card border`);
      } else {
        const lines = scene.children.filter(node => node.tag === 'text' && node.meta?.node === child.id);
        assert.ok(lines.length > 0 && lines.every(line => line.attrs['text-anchor'] === (left ? 'end' : 'start')));
        for (const line of lines) {
          const gap = left ? endX - line.attrs.x : line.attrs.x - endX;
          assert.equal(gap, 8, `${edge.to}: clear, consistent spacing from every aligned line`);
        }
      }
    }
  }
});

// 意图：验证两类结构图的SVG保留布局声明的根节点锚点，供宿主识别并定位滚动首屏。
test('mindmap and tree SVG roots serialize their scene anchors', () => {
  for (const chart of ['mindmap', 'tree']) {
    const rendered = K.render({ chart, layout: 'org', data }, { width: 324, measure: text => [...text].length * 8 });
    assert.match(rendered.svg, new RegExp(`data-kchart-anchor-x="${rendered.scene.anchor.x}"`));
    assert.match(rendered.svg, new RegExp(`data-kchart-anchor-y="${rendered.scene.anchor.y}"`));
  }
});

// 意图：tree必须注册且默认right；折叠可用的图元/边包含kind、node与相关子树身份，不依赖新增DSL字段。
test('tree is registered with semantic layouts and tree scene metadata supports collapse', () => {
  const tree = data;
  const defaults = K.layout({ chart: 'tree', data: tree }, { measure: text => [...text].length * 8 });
  assert.equal(defaults.layout, 'right');
  for (const layout of ['right', 'left', 'org', 'brace']) {
    const scene = K.layout({ chart: 'tree', layout, data: tree }, { measure: text => [...text].length * 8 });
    assert.equal(scene.layout, layout);
    assert.equal(scene.nodes.length, 9);
    for (const child of scene.children) {
      assert.ok(['tree', 'mindmap'].includes(child.meta?.kind));
      assert.ok(child.meta?.node);
      assert.ok(Array.isArray(child.meta?.related));
    }
  }
  const treeWithInteractions = K.layout({ chart: 'tree', data: tree, interaction: ['collapse'] }, { measure: text => [...text].length * 8 });
  assert.equal(treeWithInteractions.nodes.length, 9);
  // 括号从父节点右侧中点出发、从子节点左侧中点进入，不沿方框边线走。
  const brace = K.layout({ chart: 'tree', layout: 'brace', data: tree }, { measure: text => [...text].length * 8 });
  const boxes = new Map(plain(brace.nodes).map(node => [node.id, node]));
  const edges = brace.children.filter(child => child.tag === 'path' && child.meta?.kind === 'tree' && child.meta.from);
  assert.ok(edges.length);
  for (const edge of edges) {
    const [start, , , end] = [...edge.attrs.d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
    const parent = boxes.get(edge.meta.from), child = boxes.get(edge.meta.to);
    assert.ok(Math.abs(start.x - (parent.x + parent.w)) < .01 && Math.abs(start.y - (parent.y + parent.h / 2)) < .01, edge.attrs.d);
    assert.ok(Math.abs(end.x - child.x) < .01 && Math.abs(end.y - (child.y + child.h / 2)) < .01, edge.attrs.d);
  }
});

// 意图：在真实gallery场景下固定双侧节点完整入画的宽度，并验证同名叶子仍通过节点身份区分。
test('bilateral 1040px gallery case fits and duplicate labels keep distinct node identities', () => {
  const bilateralCase = KCHART_CASES.find(item => item.id === 'mindmap-bilateral');
  const bilateral = K.layout(bilateralCase.spec, { width: 984 });
  assert.ok(bilateral.width <= 984, `bilateral should fit the 1040px viewport content width, got ${bilateral.width}`);
  assert.ok(bilateral.nodes.every(node => node.x >= 0 && node.x + node.w <= bilateral.width));
  const duplicateCase = KCHART_CASES.find(item => item.id === 'edge-duplicate-labels-and-ids');
  const duplicate = K.layout(duplicateCase.spec, { width: 984 });
  assert.deepEqual(plain(duplicate.nodes).map(node => node.id).sort(), ['one', 'root', 'two']);
  const repeatedLabels = duplicate.children.filter(node => node.meta?.role === 'label' && node.text === '同名节点');
  assert.equal(JSON.stringify(repeatedLabels.map(node => node.meta.node).sort()), JSON.stringify(['one', 'two']));
});

// 意图：换行宽度与层距按图框逐档收紧——窄图框不能比宽图框排得更宽，A4 打印版心放得下时不留滚动；
// 双侧脑图从根向外每一层都是同一个间距，根与一级分支之间不能多出一整列空白。
test('mindmap plans tighten monotonically and bilateral columns keep one gap from the root outward', () => {
  const measure = text => [...text].length * 13;
  for (const item of KCHART_CASES.filter(entry => entry.spec.chart === 'mindmap')) {
    const widths = [268, 400, 502, 656, 760, 984].map(width => K.layout(item.spec, { width, measure }).width);
    widths.forEach((width, i) => assert.ok(i === 0 || width >= widths[i - 1], `${item.id}: a wider frame must not produce a narrower scene: ${widths.join('/')}`));
  }
  const bilateral = KCHART_CASES.find(entry => entry.id === 'mindmap-bilateral').spec;
  assert.ok(K.layout(bilateral, { width: 656, measure }).width <= 656, 'the gallery bilateral mindmap fits the A4 print measure');
  const scene = K.layout(bilateral, { width: 984, measure });
  const root = scene.nodes.find(node => node.depth === 0);
  for (const side of [-1, 1]) {
    const level = depth => scene.nodes.filter(node => node.depth === depth && Math.sign(node.x - root.x) === side);
    const near = nodes => side > 0 ? Math.min(...nodes.map(node => node.x)) : Math.max(...nodes.map(node => node.x + node.w));
    const far = nodes => side > 0 ? Math.max(...nodes.map(node => node.x + node.w)) : Math.min(...nodes.map(node => node.x));
    const rootGap = Math.abs(near(level(1)) - (side > 0 ? root.x + root.w : root.x));
    const levelGap = Math.abs(near(level(2)) - far(level(1)));
    assert.equal(rootGap, levelGap, `side ${side}: root-to-branch gap ${rootGap} must match branch-to-leaf gap ${levelGap}`);
  }
});

// 意图：窄图框保留所选布局、节点和标签；确实放不下时允许图内滚动，不能用列表替换布局。
test('gallery mindmap cases preserve their layout and measured content at narrow widths', () => {
  const cases = KCHART_CASES.filter(item => item.spec.chart === 'mindmap');
  for (const item of cases) for (const width of [268, 502]) {
    const scene = K.layout(item.spec, { width, measure: text => [...text].length * 8 });
    const right = Math.max(...scene.nodes.map(node => node.x + node.w));
    assert.equal(scene.width, Math.ceil(right + 24), `${item.id} must budget the measured nodes without an empty canvas`);
    assertDisjoint(plain(scene.nodes), `${item.id}/${width}`);
    const expected = [];
    const visit = node => { expected.push(node.label); for (const child of node.children || []) visit(child); };
    visit(item.spec.data);
    const rendered = scene.children.filter(node => node.meta?.role === 'label').map(node => node.text).join('');
    assert.equal(rendered, expected.join(''), `${item.id} must preserve every wrapped label`);
    const lineCounts = new Map();
    for (const node of scene.children.filter(child => child.meta?.role === 'label')) lineCounts.set(node.meta.node, (lineCounts.get(node.meta.node) || 0) + 1);
    assert.ok([...lineCounts.values()].every(count => count <= 3), `${item.id} labels should wrap into at most three lines`);
  }
});

// 意图：复现窄屏径向连线横穿叶子文字；检查线段与无关节点内部相交，而不只检查节点彼此重叠。
test('narrow radial gallery edges avoid unrelated label boxes', () => {
  const item = KCHART_CASES.find(item => item.id === 'mindmap-radial');
  const intersects = (from, to, box) => {
    let enter = 0;
    let leave = 1;
    for (const [axis, min, max] of [[0, box.x + 0.5, box.x + box.w - 0.5], [1, box.y + 0.5, box.y + box.h - 0.5]]) {
      const delta = to[axis] - from[axis];
      if (Math.abs(delta) < 1e-9) {
        if (from[axis] <= min || from[axis] >= max) return false;
      } else {
        const times = [(min - from[axis]) / delta, (max - from[axis]) / delta].sort((a, b) => a - b);
        enter = Math.max(enter, times[0]);
        leave = Math.min(leave, times[1]);
        if (enter >= leave) return false;
      }
    }
    return enter < leave;
  };
  for (const width of [268, 502]) {
    const scene = K.layout(item.spec, { width, measure: text => [...text].length * 8 });
    for (const edge of scene.edges) {
      const points = [...edge.d.matchAll(/(?:M|L)\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)]
        .map(match => [Number(match[1]), Number(match[2])]);
      for (const node of scene.nodes.filter(node => node.id !== edge.from && node.id !== edge.to)) {
        for (let i = 1; i < points.length; i += 1) {
          assert.ok(!intersects(points[i - 1], points[i], node), `${width}px edge ${edge.from}/${edge.to} crosses ${node.id}`);
        }
      }
    }
  }
});

// 意图：窄图框下仍然使用真实方向、层级、主脊与放射构图，防止八个布局静默退化成同一种列表。
test('narrow mindmaps retain the geometry of every requested layout', () => {
  for (const width of [268, 502]) for (const layout of ['bilateral', 'right', 'left', 'radial', 'org', 'brace', 'fishbone', 'timeline']) {
    const scene = K.layout(spec(layout), { width, measure: text => [...text].length * 8 });
    const byId = new Map(plain(scene.nodes).map(node => [node.id, node]));
    const root = byId.get('root');
    const centerY = node => node.y + node.h / 2;
    const categories = ['a', 'b', 'c', 'd'].map(id => byId.get(id));
    if (layout === 'right' || layout === 'brace') {
      assert.ok(categories.every(node => node.x >= root.x + root.w), `${layout} must expand to the right`);
    } else if (layout === 'left') {
      assert.ok(categories.every(node => node.x + node.w <= root.x), 'left must expand to the left');
    } else if (layout === 'bilateral') {
      assert.ok(categories.some(node => node.x + node.w <= root.x), 'bilateral needs a left branch');
      assert.ok(categories.some(node => node.x >= root.x + root.w), 'bilateral needs a right branch');
    } else if (layout === 'org') {
      assert.ok(categories.every(node => node.y >= root.y + root.h), 'org must keep the root above its children');
      assert.ok(new Set(categories.map(node => node.x)).size > 1, 'org must keep sibling columns');
    } else if (layout === 'timeline') {
      assert.ok(categories.every(node => centerY(node) === centerY(root)), 'timeline stages must share the horizontal baseline');
      assert.ok(categories.every((node, i) => i === 0 || node.x > categories[i - 1].x), 'timeline must preserve source-order stages');
    } else {
      const sides = categories.map(node => Math.sign(centerY(node) - centerY(root)));
      assert.ok(sides.includes(-1) && sides.includes(1), `${layout} must keep branches on both sides of its center`);
      if (layout === 'fishbone') assert.deepEqual(sides, [-1, 1, -1, 1], 'fishbone must keep alternating category bones');
    }
  }
});

// 意图：首屏按根节点锚点居中后仍须包含根节点及至少一条一级分支，不得展示任意远端分支。
test('narrow tree and mindmap root anchors expose the root and a first-level branch', () => {
  const cases = KCHART_CASES.filter(item => item.spec.chart === 'mindmap' || item.id === 'chart-tree');
  for (const item of cases) {
    const scene = K.layout(item.spec, { width: 268, measure: text => [...text].length * 8 });
    const root = scene.nodes.find(node => node.depth === 0);
    const firstLevel = scene.nodes.filter(node => node.depth === 1);
    const left = Math.max(0, Math.min(scene.width - 268, scene.anchor.x - 134));
    const right = left + 268;
    assert.ok(root.x >= left && root.x + root.w <= right, `${item.id} keeps the complete root in the anchored viewport`);
    assert.ok(firstLevel.some(node => node.x < right && node.x + node.w > left), `${item.id} shows at least part of a first-level branch`);
  }
});

// 意图：鱼骨和时间轴画布高度仅包住真实节点/连线路径，鱼骨脊线位于内容区域而非空白画布边界。
test('narrow fishbone and timeline height follows their content bounds', () => {
  for (const id of ['mindmap-fishbone', 'mindmap-timeline']) {
    const item = KCHART_CASES.find(entry => entry.id === id);
    const scene = K.layout(item.spec, { width: 268, measure: text => [...text].length * 8 });
    const nodeBottom = Math.max(...scene.nodes.map(node => node.y + node.h));
    assert.equal(scene.height, Math.ceil(nodeBottom + 24), `${id} has only the standard content margin below its nodes`);
    if (id === 'mindmap-fishbone') {
      const spine = scene.children.find(node => node.meta?.role === 'spine');
      const points = [...spine.attrs.d.matchAll(/(?:M|L)([-0-9.]+) ([-0-9.]+)/g)].map(match => [Number(match[1]), Number(match[2])]);
      assert.ok(points.every(([, y]) => y >= 0 && y < scene.height), 'fishbone spine remains within the content area');
    }
  }
});

// 意图：防止紧凑化后径向图再次退化为超大空画布，并验证鱼骨主脊、交替类别骨与全部子节点均存在。
test('radial layout stays compact and fishbone preserves an alternating spine and all branches', () => {
  const radial = K.layout(spec('radial'), { measure: text => [...text].length * 8 });
  assert.ok(radial.width < 900 && radial.height < 700, `radial canvas should be compact, got ${radial.width}x${radial.height}`);
  const fishbone = K.layout(spec('fishbone'), { measure: text => [...text].length * 8 });
  assert.equal(fishbone.nodes.length, 9);
  assert.equal(fishbone.edges.length, 8);
  const byId = new Map(plain(fishbone.nodes).map(node => [node.id, node]));
  const root = byId.get('root');
  const categorySides = ['a', 'b', 'c', 'd'].map(id => Math.sign((byId.get(id).y + byId.get(id).h / 2) - (root.y + root.h / 2)));
  assert.deepEqual(categorySides, [-1, 1, -1, 1], 'fishbone categories must alternate above and below the spine');
  const categoryEdges = plain(fishbone.edges).filter(edge => ['a', 'b', 'c', 'd'].includes(edge.to));
  assert.equal(categoryEdges.length, 4);
  const attachmentXs = categoryEdges.map(edge => [...edge.d.matchAll(/(?:M|L)\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)].map(m => Number(m[1]))[1]);
  assert.equal(new Set(attachmentXs).size, 4, 'each category bone must attach to a different point on the spine');
  assert.ok(categoryEdges.every(edge => {
    const points = [...edge.d.matchAll(/(?:M|L)\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)].map(m => [Number(m[1]), Number(m[2])]);
    return points.some((point, i) => i > 0 && point[0] !== points[i - 1][0] && point[1] !== points[i - 1][1]);
  }), 'category bones must leave the spine diagonally');
  const spine = fishbone.children.find(node => node.meta?.role === 'spine');
  assert.ok(spine, 'fishbone must draw its main spine');
  const points = [...spine.attrs.d.matchAll(/(?:M|L)([-0-9.]+) ([-0-9.]+)/g)].map(m => [Number(m[1]), Number(m[2])]);
  assert.ok(points.length >= 2 && points[0][0] < points.at(-1)[0], 'main spine must extend across the ordered category bones');
  assert.ok(points.at(-1)[0] <= fishbone.width, 'main spine must remain inside the scene');
});

// 意图：深链和单侧极不平衡结构验证几何稳定性，浅/暗主题与窄容器均不允许节点丢失或重叠。
test('deep unbalanced trees remain deterministic, visible, and disjoint in narrow themes', () => {
  const deep = { id: 'r', label: '根主题及很长的中文节点名称用于检查真实测量与换行', note: '根主题注释较长，必须以足够字号完整换行展示', children: [
    { id: 'wide', label: '很长的中文一级分支名称和说明内容', children: [{ id: 'd2', label: '二级分支' }, { id: 'd2b', label: '另一个二级分支' }] },
    { id: 'chain1', label: '链一', children: [{ id: 'chain2', label: '链二', children: [{ id: 'chain3', label: '链三', children: [{ id: 'chain4', label: '链四' }] }] }] },
  ] };
  for (const theme of ['claude', 'obsidian']) for (const layout of ['bilateral', 'right', 'left', 'radial', 'org', 'brace', 'fishbone', 'timeline']) {
    const make = () => K.layout({ chart: 'mindmap', layout, data: deep }, { width: 324, theme, measure: text => [...text].length * 10 });
    const scene = make();
    assert.equal(scene.nodes.length, 8);
    assertDisjoint(plain(scene.nodes), layout);
    assert.ok(scene.children.filter(node => node.meta?.role === 'note').every(node => node.attrs['font-size'] >= 12));
    assert.equal(JSON.stringify(plain(make())), JSON.stringify(plain(scene)));
  }
});

// 意图：放射扇区和鱼骨卡片都按实测外框错开，密集长标签下节点框仍不重叠，且不改换所请求的布局。
test('radial and fishbone layouts keep measured node boxes apart', () => {
  const radial = {
    label: '中心', children: Array.from({ length: 6 }, (_, i) => ({
      label: `分支${i}的长名称`, children: [{ label: '叶子甲很长' }, { label: '叶子乙很长' }],
    })),
  };
  const radialScene = K.layout({ chart: 'mindmap', layout: 'radial', variant: 'cards', data: radial }, { width: 320, measure: text => [...text].length * 12 });
  assert.equal(radialScene.layout, 'radial');
  assertDisjoint(plain(radialScene.nodes), 'radial');
  const fish = {
    label: '主题', children: Array.from({ length: 4 }, (_, i) => ({
      label: `骨${i}`, children: [{ label: '卡片甲' }, { label: '卡片乙', children: [{ label: '细项' }] }],
    })),
  };
  const fishScene = K.layout({ chart: 'mindmap', layout: 'fishbone', variant: 'cards', data: fish }, { width: 280, measure: text => [...text].length * 10 });
  assert.equal(fishScene.layout, 'fishbone');
  assertDisjoint(plain(fishScene.nodes), 'fishbone');
});

// 意图：根节点实心强调色、分支淡底和叶子页面底色上的名称与注释，各内置主题下都达到正文 4.5:1。
test('tree and mindmap labels and notes keep body-text contrast on their node fills in every theme', () => {
  const hexIn = value => String(value).match(/#[0-9a-f]{6}/gi).at(-1);
  for (const theme of Object.keys(themes)) for (const chart of ['tree', 'mindmap']) {
    const scene = K.layout({ chart, ...(chart === 'mindmap' ? { layout: 'right' } : {}), data }, { width: 720, theme });
    const bg = K.util.context({ theme }).palette.bg;
    const boxes = scene.children.filter(node => node.tag === 'rect' && node.meta?.node);
    const texts = scene.children.filter(node => node.tag === 'text' && node.meta?.node);
    assert.ok(texts.some(node => node.meta.node === 'root'), `${theme} ${chart}: root label is present`);
    for (const text of texts) {
      const box = boxes.find(node => node.meta.node === text.meta.node);
      const under = box ? hexIn(box.attrs.fill) : bg;
      assert.ok(K.util.contrast(hexIn(text.attrs.fill), under) >= 4.5, `${theme} ${chart}: ${text.text} on ${under}`);
    }
  }
});

// 意图：短标签的框被最小宽撑开时，文字在框内左右留白相等，不贴左留一大块空。
test('short labels sit centred in boxes widened to the minimum width', () => {
  const short = { id: 'r', label: 'New store', children: [{ id: 'p', label: 'Prep', children: [{ id: 'q', label: 'Build' }] }, { id: 's', label: 'Site', children: [{ id: 't', label: 'Rent' }] }] };
  const ctx = K.util.context({ lang: 'en' });
  for (const layout of ['right', 'left', 'radial', 'org', 'bilateral']) {
    const nodes = K.layout({ chart: 'mindmap', layout, variant: 'editorial', data: short }, { lang: 'en' }).children;
    const flat = (list) => list.flatMap((node) => [node, ...flat(node.children || [])]);
    for (const id of ['p', 's']) {
      const box = flat(nodes).find((node) => node.tag === 'rect' && node.meta?.node === id);
      const label = flat(nodes).find((node) => node.tag === 'text' && node.meta?.node === id && node.meta.role === 'label');
      if (!box) continue;
      const left = label.attrs.x - box.attrs.x, right = box.attrs.x + box.attrs.width - label.attrs.x - ctx.measure(label.text, 13, 500);
      assert.ok(Math.abs(left - right) <= 1, `${layout} ${id}: ${left.toFixed(1)} vs ${right.toFixed(1)}`);
    }
  }
});
