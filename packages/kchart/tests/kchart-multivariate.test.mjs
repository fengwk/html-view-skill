// 多维图型的真实几何与专属语义：阻止注册名存在但回退成通用柱图。
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { contrast } from '../src/core/color.js';
import { install } from '../src/chart/multivariate.js';
import { loadChart } from './kchart-fixture.mjs';
import { createRenderer, themes } from '../dist/esm/node.js';
import { KCHART_CASES } from './kchart-cases.mjs';

const { api: K } = loadChart([install]);
const renderer = createRenderer();
const cases = [
  { chart: 'stream', data: [{t:'Jan',a:2,b:3},{t:'Feb',a:4,b:1}], encode:{category:'t',value:['a','b']} },
  { chart: 'split-compare', data: [{t:'Jan',u:2,l:3},{t:'Feb',u:4,l:1}], encode:{category:'t',upper:'u',lower:'l'}, fields:{u:{unit:'人'},l:{unit:'元'}} },
  { chart: 'combo', data: [{t:'Jan',a:2,b:.2},{t:'Feb',a:4,b:.4}], encode:{category:'t'}, fields:{a:{unit:'元'},b:{format:'percent'}}, layers:[{mark:'column',field:'a',axis:'left'},{mark:'line',field:'b',axis:'right'}], annotations:[{kind:'rule',field:'b',value:.3,label:'目标'},{kind:'band',field:'b',from:.25,to:.35,label:'目标区间'}] },
  { chart: 'bubble-matrix', data:[{r:'A',c:'x',v:4},{r:'B',c:'y',v:1}], encode:{row:'r',column:'c',value:'v'} },
  { chart: 'calendar', period:'2024', data:[{d:'2024-02-28',v:0},{d:'2024-02-29',v:2},{d:'2024-03-01',v:4}], encode:{date:'d',value:'v'} },
  { chart: 'tally', data:[{c:'A',v:.25},{c:'B',v:.4}], encode:{category:'c',value:'v'}, fields:{v:{format:'percent'}} },
  { chart: 'bump', data:[{t:'Q1',s:'A',r:1},{t:'Q2',s:'A',r:2},{t:'Q1',s:'B',r:2},{t:'Q2',s:'B',r:1}], encode:{category:'t',series:'s',rank:'r'} },
  { chart: 'radar', data:[{name:'甲',a:4,b:7,c:3}], encode:{label:'name',dimensions:['a','b','c']}, fields:{a:{domain:[0,10],unit:'kg'},b:{domain:[0,20],unit:'元'},c:{domain:[0,5],unit:'分'}} },
  { chart: 'parallel', data:[{name:'甲',a:4,b:7,c:3},{name:'乙',a:8,b:2,c:4}], encode:{label:'name',dimensions:['a','b','c']}, fields:{a:{domain:[0,10],unit:'kg'},b:{domain:[0,20],unit:'元'},c:{domain:[0,5],unit:'分'}} },
  { chart: 'launch-fan', data:[{name:'甲',started:2020,size:9},{name:'乙',started:2022,size:4}], encode:{label:'name',start:'started',value:'size'}, fields:{started:{type:'number'},size:{unit:'人'}} },
];
const plain = x => JSON.parse(JSON.stringify(x));
const visit = nodes => nodes.flatMap(node => [node, ...(node.children ? visit(node.children) : [])]);

test('radar leaves headroom for the top axis label without a frame', () => {
  // Chrome 的中文回退字体在 12px 标签上量得 14px 上伸；无外框时画布也要留出这段空间。
  const radar = cases.find(({ chart }) => chart === 'radar');
  const spec = { ...radar, fields: { ...radar.fields, a: { ...radar.fields.a, label: '甜感' } } };
  for (const width of [338, 758]) {
    const { scene } = renderer.render(spec, { width, frame: false });
    const label = visit(scene.children).find(node => node.tag === 'text' && node.text === '甜感');
    assert.ok(label.attrs.y >= 16, 'leave room above the font ascent, regardless of plot width');
  }
});

test('十图均注册为专用布局并通过各自DSL契约', () => {
  // 单纯使用同一renderer名称会在本测试的几何检查中失败；这里先锁定精确图型集合和校验。
  assert.deepEqual([...K.layouts.keys()].sort(), cases.map(c => c.chart).sort());
  for (const spec of cases) assert.deepEqual(plain(K.validate(spec).errors), [], `${spec.chart}: ${JSON.stringify(plain(K.validate(spec).errors))}`);
});

test('十图渲染为真实、可序列化且视觉结构不同的场景', () => {
  // 用每类特有的图元/坐标特征而非“渲染不报错”断言其语义没有降级成柱图。
  const rendered = new Map(cases.map(spec => [spec.chart, K.render(spec, { width: 720 })]));
  for (const [name, result] of rendered) {
    assert.ok(result.scene.width >= 720, name);
    assert.match(result.svg, /<svg/);
  }
  const stream = rendered.get('stream').scene.children;
  assert.ok(stream.some(e => e.tag === 'polygon' && String(e.attrs.points).includes(',')), 'stream uses centered layered stream polygons');
  const split = rendered.get('split-compare').scene.children;
  assert.ok(split.some(e => e.tag === 'rect') && split.some(e => e.tag === 'path'), 'split-compare combines inverted bars with an independent area');
  const combo = rendered.get('combo').scene.children;
  assert.ok(combo.some(e => e.tag === 'rect') && combo.some(e => e.tag === 'circle') && combo.some(e => e.tag === 'line'), 'combo renders columns, line points and dual-axis references');
  const bubble = rendered.get('bubble-matrix').scene.children;
  assert.ok(bubble.some(e => e.tag === 'circle') && bubble.some(e => e.tag === 'rect'), 'bubble matrix encodes value as circle area in matrix cells');
  const calendar = rendered.get('calendar').scene.children.filter(e => e.tag === 'rect' && e.meta?.record);
  assert.equal(calendar.length, 60, 'calendar spans February 1 through March 31, not the full leap year');
  assert.ok(combo.some(e => e.tag === 'rect' && e.attrs['fill-opacity'] === .12), 'combo supports field-local reference bands');
  const tally = rendered.get('tally').scene.children;
  assert.ok(tally.filter(e => e.tag === 'circle').length >= 200, 'tally preserves independent 100-point percentage marks');
  assert.ok(rendered.get('bump').scene.children.some(e => e.tag === 'path'), 'bump draws rank trajectories');
  assert.ok(visit(rendered.get('radar').scene.children).filter(e => e.tag === 'polygon').length >= 5, 'radar draws domain rings and a value polygon');
  assert.ok(visit(rendered.get('parallel').scene.children).filter(e => e.tag === 'path').length >= 2, 'parallel draws an entity polyline for each record');
  assert.ok(rendered.get('launch-fan').scene.children.filter(e => e.tag === 'circle').length >= 4, 'launch-fan encodes start points and current-size bubbles');
});

test('排名从1置顶、漏值断线，日历的未采集和零值可区分', () => {
  // 排名方向和null不能被绘成最后名；calendar零格为主题填色、缺失格为虚线空格。
  const bump = cases.find(x => x.chart === 'bump');
  const incomplete = { ...bump, data:[{t:'Q1',s:'A',r:1},{t:'Q2',s:'A',r:null}] };
  // 经公开校验与布局链路保留缺口，不绕过validator来掩盖不一致。
  const scene = K.render(incomplete, { width: 720 }).scene;
  const path = scene.children.find(e => e.tag === 'path');
  assert.match(path.attrs.d, /^M/);
  assert.doesNotMatch(path.attrs.d, /L/); // 单个有效时点只画点，不伪造指向末名的线段。
  const cal = K.layout(cases.find(x => x.chart === 'calendar'), { width: 720 });
  const cells = cal.children.filter(e => e.tag === 'rect');
  assert.ok(cells.some(e => e.attrs['stroke-dasharray'] === '2 2'));
  assert.ok(cells.some(e => e.attrs.fill && e.attrs.fill !== 'none'));
  assert.equal(cells.find(e => e.meta?.record === '2024-02-28')?.meta.value, 0);
  assert.equal(cells.find(e => e.meta?.record === '2024-02-29')?.meta.value, 2);
  assert.equal(cells.find(e => e.meta?.record === '2024-02-27')?.meta.value, null);
  const dots = K.layout({ ...cases.find(x => x.chart === 'calendar'), variant:'dots' }, { width: 720 });
  assert.ok(dots.children.some(e => e.tag === 'circle'));
  assert.ok(dots.children.some(e => e.tag === 'rect' && e.attrs['stroke-dasharray'] === '2 2'));
  const incompleteStream = { chart:'stream', data:[{m:'2024-01',v:1},{m:'2024-03',v:2}], encode:{category:'m',value:'v'}, fields:{m:{type:'month'}} };
  assert.throws(() => K.layout(incompleteStream), error => error.code === 'CHART_FIT' && /不要把缺失当作0/.test(error.message));
  const clippedBaseline = { ...cases.find(x => x.chart === 'split-compare'), fields:{u:{domain:[1,5],unit:'人'},l:{unit:'元'}} };
  assert.throws(() => K.layout(clippedBaseline), error => error.code === 'BAD_KCHART' && error.errors.some(issue => /必须包含0/.test(issue.message)));
});

test('Review回归：日历周布局与窄屏转置、文字字号不低于12且宿主不重复标题', () => {
  // 真实KChart.render覆盖宿主序列化路径；检查尺寸与可见文本，而不以占位renderer替代布局。
  const calendar = { chart:'calendar', period:'2021', data:[{d:'2021-01-01',v:-1},{d:'2021-01-02',v:-4},{d:'2021-01-03',v:0},{d:'2021-01-04',v:2},{d:'2021-01-05',v:8}], encode:{date:'d',value:'v'} };
  const titledCalendar = { ...calendar, title:'Annual activity', subtitle:'Observed activity by date' };
  const result = K.render(titledCalendar, { width:720 });
  assert.equal(result.scene.width, 720, 'calendar stays within the available canvas');
  assert.ok(result.scene.height < 420, 'calendar height reflects the covered month rather than a full year');
  const cells = result.scene.children.filter(e => e.tag === 'rect' && e.meta?.record);
  assert.equal(cells.length, 31, 'calendar includes the full covered month');
  assert.equal(new Set(cells.map(e => e.attrs.y)).size, 7, 'calendar keeps seven weekday rows');
  assert.equal(new Set(cells.map(e => e.attrs.x)).size, 5, 'January 2021 spans five horizontal week columns');
  const cell = date => cells.find(e => e.meta.record === date);
  assert.notEqual(cell('2021-01-01').attrs.fill, cell('2021-01-03').attrs.fill, 'negative heat remains distinct from observed zero');
  assert.notEqual(cell('2021-01-01').attrs.fill, cell('2021-01-02').attrs.fill, 'negative values use magnitude relative to negative maximum');
  assert.equal(result.scene.title, 'Annual activity', 'scene retains semantic title for host/accessible figure');
  assert.ok(!visit(result.scene.children).some(e => e.tag === 'text' && ['Annual activity','Observed activity by date'].includes(e.text)), 'title/subtitle are not duplicated inside the plot');
  for (const spec of cases) {
    const rendered = K.render(spec, { width:720 });
    for (const item of visit(rendered.scene.children)) if (item.tag === 'text') assert.ok(Number(item.attrs['font-size']) >= 12, `${spec.chart} text has readable size`);
  }
  const english = K.render(calendar, { width:720, lang:'en-US' }).scene;
  assert.ok(visit(english.children).some(e => e.tag === 'text' && /Missing: dashed/.test(e.text)), 'calendar auxiliary copy follows ctx.lang');
});

test('Review回归：combo共享同轴尺度、列分组，矩阵说明不压列标签，实体身份保留', () => {
  // 两字段同轴必须把同值映射到相同y；并列柱并排，bump并列点仍可辨认身份。
  const comboSpec = { chart:'combo', data:[{t:'A',a:10,b:100},{t:'B',a:20,b:200}], encode:{category:'t'}, fields:{a:{unit:'u'},b:{unit:'u'}}, layers:[{mark:'column',field:'a',axis:'left'},{mark:'column',field:'b',axis:'left'}], annotations:[{kind:'rule',field:'b',value:300,label:'limit'}] };
  const combo = K.render(comboSpec, { width:720 }).scene.children;
  const columns = combo.filter(e => e.tag === 'rect');
  assert.notEqual(columns[0].attrs.x, columns[1].attrs.x, 'same-category column series occupy separate slots');
  assert.ok(Math.abs(Number(columns[2].attrs.height) / Number(columns[0].attrs.height) - 10) < .01, 'same-axis fields share one value-to-pixel mapping');
  const badUnits = { ...comboSpec, fields:{a:{unit:'u'},b:{unit:'v'}} };
  assert.throws(() => K.layouts.get('combo')(badUnits, K.util.context({ spec:badUnits, width:720 })), error => error.code === 'CHART_FIT');
  const matrix = K.render(cases.find(x => x.chart === 'bubble-matrix'), { width:720 }).scene.children;
  const all = nodes => nodes.flatMap(node => [node, ...all(node.children || [])]);
  const columnLabel = all(matrix).find(e => e.tag === 'text' && e.text === 'x');
  const explanation = all(matrix).find(e => e.tag === 'text' && e.text.includes('气泡面积'));
  assert.ok(explanation.attrs.y > columnLabel.attrs.y, 'matrix description is below column labels');
  const tied = { chart:'bump', data:[{t:'Q1',s:'A',r:1},{t:'Q1',s:'B',r:1},{t:'Q2',s:'A',r:2},{t:'Q2',s:'B',r:1}], encode:{category:'t',series:'s',rank:'r'} };
  const bump = K.layouts.get('bump')(tied, K.util.context({ spec:tied, width:720 }));
  const points = bump.children.filter(e => e.tag === 'circle' && e.meta?.category === 'Q1' && e.meta?.rank === 1 && e.meta?.series);
  assert.equal(points.length, 2);
  assert.ok(Math.hypot(points[0].attrs.cx - points[1].attrs.cx, points[0].attrs.cy - points[1].attrs.cy) >= 10, 'tied markers remain visually separate');
  assert.deepEqual(Array.from(points, e => e.meta.series).sort(), ['A','B']);
});

// 柱色接近线色时只在实际柱面内描细边，且柱写在折线后也不会盖住它。
test('combo only separates low-contrast traces from the columns underneath', () => {
  const spec = cases.find(item => item.chart === 'combo');
  const dark = K.render({ ...spec, annotations: [], layers: [...spec.layers].reverse() }, { width: 720, theme: 'terminal', prefix: 'contrast' });
  const { children } = dark.scene;
  const rim = children.find(item => item.attrs['clip-path']);
  const path = children.find(item => item.tag === 'path');
  const rimPath = rim.children.find(item => item.tag === 'path');
  assert.equal(rimPath.attrs.d, path.attrs.d);
  assert.equal(rimPath.attrs['stroke-width'] - path.attrs['stroke-width'], 2);
  assert.equal(path.attrs.stroke, themes.terminal.tones[0], 'series color still follows the declared order');
  assert.ok(contrast(path.attrs.stroke, rimPath.attrs.stroke) >= 3);
  assert.notEqual(rimPath.attrs.stroke, themes.terminal.surface);
  const columns = children.filter(item => item.tag === 'rect' && item.attrs.fill === themes.terminal.tones[1]);
  assert.equal(columns.length, spec.data.length);
  assert.ok(columns.every(item => children.indexOf(item) < children.indexOf(rim)) && children.indexOf(rim) < children.indexOf(path));
  const [clip] = children.find(item => item.tag === 'defs').children;
  const box = ({ x, y, width, height }) => ({ x, y, width, height });
  assert.deepEqual(clip.children.map(item => box(item.attrs)), columns.map(item => box(item.attrs)));
  assert.match(dark.svg, /id="contrast-combo-column-1"/);
  assert.match(dark.svg, /clip-path="url\(#contrast-combo-column-1\)"/);
});

test('Review回归：空值分段、字段格式化及末端标签留白', () => {
  // 这些具体风险使用实际布局输出核对：空值断线、雷达复用字段格式、发射扇标签不被画布裁切。
  const parallel = { chart:'parallel', data:[{name:'A',a:1,b:null,c:3},{name:'B',a:2,b:4,c:5}], encode:{label:'name',dimensions:['a','b','c']}, fields:{a:{domain:[0,5]},b:{domain:[0,5]},c:{domain:[0,5]}} };
  const parallelScene = K.layouts.get('parallel')(parallel, K.util.context({ spec:parallel, width:720 }));
  const trajectory = parallelScene.children.find(e => e.tag === 'path');
  assert.equal((trajectory.attrs.d.match(/M/g) || []).length, 2, 'parallel missing values split a trajectory instead of mapping to zero');
  const fan = { chart:'launch-fan', data:[{name:'An unusually long launch label requiring wrap',started:2020,size:9},{name:'Second cohort',started:2022,size:4},{name:'Another 2020 cohort',started:2020,size:3}], encode:{label:'name',start:'started',value:'size'}, fields:{started:{type:'number'},size:{unit:'people'}} };
  const fanResult = K.render(fan, { width:720 });
  assert.equal(fanResult.scene.width, 720, 'long launch labels wrap within the requested canvas');
  assert.ok(visit(fanResult.scene.children).filter(e => e.tag === 'text').map(e => e.text).join(' ').includes('An unusually long launch label'));
  assert.ok(fanResult.scene.children.filter(e => e.tag === 'circle').every(e => Number(e.attrs.r) <= 28));
  const dated = { chart:'launch-fan', data:[{name:'Early',started:'2020-01-01',size:2},{name:'Later',started:'2020-01-15',size:3}], encode:{label:'name',start:'started',value:'size'}, fields:{started:{type:'date'},size:{unit:'people'}} };
  const datedScene = K.layouts.get('launch-fan')(dated, K.util.context({ spec:dated, width:720, lang:'en-US' }));
  assert.ok(visit(datedScene.children).some(e => e.tag === 'text' && e.text.includes('Jan 1, 2020')), 'date labels distinguish starts within the same year');
  const starts = fanResult.scene.children.filter(e => e.tag === 'circle' && e.meta?.start === 2020);
  assert.equal(starts.length, 2);
  assert.notEqual(starts[0].attrs.cy, starts[1].attrs.cy, 'coincident start markers are separated without losing date metadata');
  const radar = K.render({ chart:'radar', data:[{name:'Entity',a:.5,b:.8,c:.2}], encode:{label:'name',dimensions:['a','b','c']}, fields:{a:{domain:[0,1],format:'percent'},b:{domain:[0,1],format:'percent'},c:{domain:[0,1],format:'percent'}} }, { width:720 });
  assert.ok(visit(radar.scene.children).some(e => e.tag === 'text' && e.text.includes('0.0%') && e.text.includes('100.0%')), 'radar axis ranges use ctx.format including percent format');
  const tally = K.render({ chart:'tally', data:[{c:'A very long category label that needs measured reservation',v:.25}], encode:{category:'c',value:'v'}, fields:{v:{format:'percent'}} }, { width:720 });
  assert.equal(tally.scene.children.filter(e => e.tag === 'circle').length, 100);
  assert.ok(visit(tally.scene.children).filter(e => e.tag === 'text').map(e => e.text).join(' ').includes('A very long category label'),
    'long tally category names wrap instead of disappearing');
  assert.equal(tally.scene.width, 720, 'tally reserves measured category, 100-point, and value columns inside the requested canvas');
  const nullableCombo = { chart:'combo', data:[{t:'A',a:1,b:2},{t:'B',a:null,b:null},{t:'C',a:3,b:4}], encode:{category:'t'}, fields:{a:{unit:'u'},b:{unit:'u'}}, layers:[{mark:'column',field:'a',axis:'left'},{mark:'area',field:'b',axis:'left'}] };
  const nullableScene = K.layouts.get('combo')(nullableCombo, K.util.context({ spec:nullableCombo, width:720 }));
  assert.equal(nullableScene.children.filter(e => e.tag === 'rect').length, 2, 'column null is skipped');
  assert.equal(nullableScene.children.filter(e => e.tag === 'path' && e.attrs['fill-opacity'] === .2).length, 2, 'area null breaks the filled area into disjoint segments');
});

// 意图：combo规则注释移入绘图区并避开右轴刻度列，避免长数字轴标签与注释占用同一横向区域。
test('combo rule labels stay inside the plot rather than occupying the right tick gutter', () => {
  const spec = { chart:'combo', data:[{t:'A',left:10,right:1_000_000_000},{t:'B',left:20,right:2_000_000_000},{t:'C',left:30,right:3_000_000_000}], encode:{category:'t'}, fields:{left:{unit:'u'},right:{unit:'u'}}, layers:[{mark:'column',field:'left',axis:'left'},{mark:'line',field:'right',axis:'right'}], annotations:[{kind:'rule',field:'right',value:1_500_000_000,label:'target'},{kind:'band',field:'right',from:1_000_000_000,to:2_000_000_000,label:'range'}] };
  const scene = K.render(spec, { width:712, lang:'en-US' }).scene;
  const texts = visit(scene.children).filter(node => node.tag === 'text');
  const annotations = texts.filter(node => ['target','range'].includes(node.text));
  const rightTicks = texts.filter(node => ['1B','2B','3B'].includes(node.text));
  assert.equal(annotations.length, 2);
  assert.ok(rightTicks.length);
  assert.ok(annotations.every(node => Number(node.attrs.x) < Math.min(...rightTicks.map(tick => Number(tick.attrs.x))), 'annotations sit left of the right-axis tick column'));
  assert.ok(Math.abs(Number(annotations[0].attrs.y) - Number(annotations[1].attrs.y)) >= 16, 'annotation labels occupy separate measured-height rows');
});

test('Gallery multivariate cases remain readable at narrow and desktop widths', () => {
  // Lock the actual 120-day, complete 4x6, and 324px review fixtures to the layout conditions called out in the visual review.
  const caseSpec = chart => KCHART_CASES.find(item => item.spec.chart === chart).spec;
  const calendar = K.render(caseSpec('calendar'), { width: 984 }).scene;
  const dates = calendar.children.filter(node => node.tag === 'text' && /^\d+$/.test(node.text) && node.attrs.y > 80 && node.attrs.y < 230);
  assert.equal(dates.length, 0, 'calendar day cells encode only through color or dot area, never printed day numbers');
  assert.ok(calendar.width >= 720, 'calendar uses the available viewport instead of shrinking its annual grid into half the viewport');
  const weekdays = calendar.children.filter(node => node.tag === 'text' && ['一','二','三','四','五','六','日'].includes(node.text));
  assert.equal(weekdays.length, 3, 'calendar shows only three weekday labels to reduce grid noise');
  assert.ok(visit(calendar.children).some(node => node.tag === 'text' && node.text.includes('色阶')), 'calendar cells disclose color depth, not area');
  assert.ok(calendar.children.some(node => node.tag === 'rect' && Number(node.attrs.width) === 18 && Number(node.attrs.height) === 10), 'calendar includes a discrete color ramp legend');
  assert.ok(calendar.width >= 984, 'at 1040px viewport the enlarged calendar fits the available SVG width');
  const narrowCalendar = K.render(caseSpec('calendar'), { width:268 }).scene;
  const narrowCells = narrowCalendar.children.filter(node => node.tag === 'rect' && node.meta?.record);
  assert.ok(narrowCalendar.width <= 268 && Number(narrowCells[0].attrs.width) + 2 >= 10, '120-day calendar fits 268px with square cells at least 10px');

  const matrix = K.render(caseSpec('bubble-matrix'), { width: 268 }).scene;
  const matrixTexts = visit(matrix.children).filter(node => node.tag === 'text');
  assert.equal(matrixTexts.filter(node => /^2026-\d\d$/.test(node.text)).length, 0, 'month columns use the shared compact temporal headers');
  assert.equal(matrixTexts.filter(node => /^2026/.test(node.text)).length, 1, 'the year is written once under its first column');
  const matrixMeasure = K.util.context({ spec: caseSpec('bubble-matrix'), width: 268 }).measure;
  const headerBoxes = matrixTexts.filter(node => node.attrs['text-anchor'] === 'middle' && !node.meta?.kind)
    .map(node => ({ x: Number(node.attrs.x), y: Number(node.attrs.y), half: matrixMeasure(node.text, 12, 400) / 2 }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  assert.ok(headerBoxes.every((box, i) => i === 0 || box.y !== headerBoxes[i - 1].y || box.x - box.half >= headerBoxes[i - 1].x + headerBoxes[i - 1].half), 'column headers never overlap');
  assert.equal(matrix.children.filter(node => node.tag === 'circle').length, 24, 'all matrix observations remain represented');

  const radar = K.render(caseSpec('radar'), { width: 268 }).scene;
  const radarTexts = visit(radar.children).filter(node => node.tag === 'text').map(node => node.text).join(' ');
  assert.ok(radar.width <= 320, 'radar keeps axis labels beside the plot instead of overflowing by a full label column');
  const measure = K.util.context({ spec: caseSpec('radar'), width: 268 }).measure;
  for (const node of visit(radar.children).filter(node => node.tag === 'text')) {
    const x = Number(node.attrs.x), textWidth = measure(node.text, Number(node.attrs['font-size']) || 12, Number(node.attrs['font-weight']) || 400), anchor = node.attrs['text-anchor'];
    assert.ok((anchor === 'end' ? x - textWidth : anchor === 'middle' ? x - textWidth / 2 : x) >= 0, `radar text left edge stays in viewBox: ${node.text}`);
    assert.ok((anchor === 'end' ? x : anchor === 'middle' ? x + textWidth / 2 : x + textWidth) <= radar.width, `radar text right edge stays in viewBox: ${node.text}`);
  }
  assert.match(radarTexts, /sales|users/, 'radar axis labels retain field names when no explicit label is supplied');
  assert.match(radarTexts, /25件/, 'narrow radar keeps each axis range on its own second line');
  const rangeLabels = visit(radar.children).filter(node => node.tag === 'text' && /25件/.test(node.text));
  assert.ok(rangeLabels.length > 0 && rangeLabels.every(node => Number(node.attrs['font-weight']) === 400), 'axis ranges use regular-weight muted text');
  assert.doesNotMatch(radarTexts, /维度 1|Dimension 1/, 'radar does not replace semantic field names with generic dimensions');
  const radar1040 = K.render(caseSpec('radar'), { width: 984 }).scene;
  const rings = visit(radar1040.children).filter(node => node.tag === 'polygon' && node.attrs.fill === 'none');
  const points = rings[0].attrs.points.split(' ').map(pair => pair.split(',').map(Number));
  const diameter = (Math.max(...points.map(point => point[0])) - Math.min(...points.map(point => point[0]))) / .25;
  assert.ok(diameter >= 320, `radar radius uses available desktop dimensions (${diameter}px diameter)`);

  const rawSplit = { chart:'split-compare', data:[{c:'A',u:18.75,l:6.25},{c:'B',u:12.5,l:3.1}], encode:{category:'c',upper:'u',lower:'l'}, fields:{u:{unit:'件'},l:{unit:'人'}} };
  const split = K.render(rawSplit, { width:984 }).scene;
  const splitLabels = visit(split.children).filter(node => node.tag === 'text');
  assert.ok(!splitLabels.some(node => /18\.75|6\.25|3\.1/.test(node.text)), 'split-compare uses nice ticks rather than raw data values');
  assert.ok(splitLabels.some(node => node.attrs['text-anchor'] === 'start' && node.text.includes('人')), 'lower-scale labels use the opposite side to avoid overlap');
  const narrowSplit = K.render(caseSpec('split-compare'), { width:268 }).scene, narrowSplitTexts = visit(narrowSplit.children).filter(node => node.tag === 'text');
  const dateLabels = narrowSplitTexts.filter(node => /^2026-/.test(node.text)), labelMeasure = K.util.context({ spec:caseSpec('split-compare'), width:268 }).measure;
  for (let i = 0; i < dateLabels.length; i++) for (let j = i + 1; j < dateLabels.length; j++) {
    const a = dateLabels[i], b = dateLabels[j], aw = labelMeasure(a.text, 12), bw = labelMeasure(b.text, 12);
    assert.ok(Math.abs(a.attrs.x - b.attrs.x) >= (aw + bw) / 2 + 6, 'split-compare thins measured date labels without overlap');
  }

  const combo = K.render({ chart:'combo', data:[{t:'A',a:1,b:.1},{t:'B',a:2,b:.9}], encode:{category:'t'}, fields:{a:{unit:'件'},b:{format:'percent'}}, layers:[{mark:'column',field:'a',axis:'left'},{mark:'line',field:'b',axis:'right'}] }, { width:984 }).scene;
  const comboText = visit(combo.children).filter(node => node.tag === 'text').map(node => node.text);
  assert.ok(comboText.some(text => /b · % · 右轴/.test(text)), 'legend states the axis unit');
  assert.ok(!comboText.some(text => /^[-\d.]+%$/.test(text)), 'ticks never repeat the percent unit');
  // 双轴刻度落在同一组网格线上：右轴取值恰好等于某个刻度的点必须压在该刻度的网格线上；左轴最高刻度也要画出。
  const aligned = K.render({ chart:'combo', data:[{t:'A',a:18,b:.6},{t:'B',a:22,b:.86},{t:'C',a:12,b:.54}], encode:{category:'t'}, fields:{a:{unit:'件'},b:{format:'percent'}}, layers:[{mark:'column',field:'a',axis:'left'},{mark:'line',field:'b',axis:'right'}] }, { width:640 }).scene;
  const texts = aligned.children.filter(node => node.tag === 'text');
  const grid = aligned.children.filter(node => node.tag === 'line' && node.attrs.y1 === node.attrs.y2);
  const rightLabels = texts.filter(node => node.attrs['text-anchor'] === 'start' && /^\d+$/.test(node.text));
  const leftLabels = texts.filter(node => node.attrs['text-anchor'] === 'end' && /^\d+$/.test(node.text));
  assert.equal(rightLabels.length, leftLabels.length, 'both axes label the same gridlines');
  assert.ok(rightLabels.every(label => grid.some(line => Math.abs(line.attrs.y1 - (label.attrs.y - 4)) < 0.01)), 'every right tick sits on a gridline');
  const sixty = rightLabels.find(label => label.text === '60');
  assert.ok(sixty, 'the percentage axis is displayed as 60, not 0.6');
  const point = aligned.children.find(node => node.tag === 'circle' && Math.abs(node.attrs.cy - (sixty.attrs.y - 4)) < 0.01);
  assert.ok(point, 'the 60% observation is drawn on the 60% gridline');
  assert.ok(Number(leftLabels.at(-1).text) >= 22, `left axis labels its top tick: ${leftLabels.map(node => node.text).join('|')}`);
  // 默认 Claude 的线/柱对比足够，保留连续的系列色折线和实心圆点，不加底色边。
  const marks = visit(aligned.children);
  const linePaths = marks.filter(node => node.tag === 'path' && node.attrs.fill === 'none');
  assert.deepEqual(linePaths.map(node => [node.attrs.stroke, node.attrs['stroke-width']]), [[themes.claude.tones[1], 2]]);
  assert.ok(!marks.some(node => node.attrs['clip-path'] || (node.tag === 'circle' && node.attrs.stroke)));
  const narrowTally = K.render(caseSpec('tally'), { width:502 }).scene;
  assert.ok(narrowTally.width <= 502, '100 tally marks and formatted values fit in the 558px gallery viewport without clipping');
  const bump = K.render(caseSpec('bump'), { width:268 }).scene;
  const bumpText = visit(bump.children).filter(node => node.tag === 'text').map(node => node.text);
  assert.ok(bumpText.filter(text => text === '甲').length >= 2 && bumpText.filter(text => text === '丁').length >= 2, 'bump labels every series at both ends');
  assert.equal(bumpText.filter(text => /^[1-4]$/.test(text)).length, 4, 'bump has only y-axis rank ticks, not a rank label on every point');
  const stream = K.render(caseSpec('stream'), { width:268 }).scene;
  const streamText = visit(stream.children).filter(node => node.tag === 'text').map(node => node.text);
  assert.ok(!streamText.some(text => text.includes('20.5') || text === '41'), 'stream thickness axis uses nice ticks instead of 20.5 and 41');
});

test('launch-fan keeps distinct baseline dates, both endpoints, and year changes while thinning collisions', () => {
  const spec = {
    chart: 'launch-fan', encode: { label: 'name', start: 'start', value: 'amount' },
    fields: { start: { type: 'month' }, amount: { unit: '件' } },
    data: ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02']
      .map((start, i) => ({ name: `方案${i + 1}`, start, amount: 100 - i * 10 })),
  };
  const scene = renderer.render(spec, { width: 268, lang: 'zh' }).scene;
  const dates = visit(scene.children).filter(node => node.tag === 'text' && node.meta?.kind === 'launch-fan-time');
  assert.ok(dates.length >= 2 && dates.length < spec.data.length, 'crowded start labels are uniformly thinned');
  assert.ok(dates[0].meta.value < dates.at(-1).meta.value, 'the first and last start dates survive thinning');
  assert.ok(dates.every(node => node.attrs.y === dates[0].attrs.y && !node.text.includes('\\n')), 'all baseline date labels stay on one line');
  assert.ok(dates.some(node => /2026年/.test(node.text)) && dates.some(node => /2027年/.test(node.text)), 'a new year is explicitly labeled');
  const measure = K.util.context({ spec, width: 268 }).measure;
  for (let i = 1; i < dates.length; i++) {
    const previousWidth = measure(dates[i - 1].text, 12), currentWidth = measure(dates[i].text, 12);
    const previousRight = dates[i - 1].attrs['text-anchor'] === 'start'
      ? dates[i - 1].attrs.x + previousWidth : dates[i - 1].attrs.x;
    const currentLeft = dates[i].attrs['text-anchor'] === 'end'
      ? dates[i].attrs.x - currentWidth : dates[i].attrs['text-anchor'] === 'middle'
        ? dates[i].attrs.x - currentWidth / 2 : dates[i].attrs.x;
    assert.ok(previousRight + 8 <= currentLeft, 'kept baseline labels do not collide');
  }
  // 大小相近的末端圆相邻时也不相交。
  const bubbles = visit(scene.children).filter(node => node.tag === 'circle' && node.attrs.r > 3).sort((a, b) => a.attrs.cy - b.attrs.cy);
  assert.equal(bubbles.length, spec.data.length);
  for (let i = 1; i < bubbles.length; i++) {
    assert.ok(bubbles[i].attrs.cy - bubbles[i - 1].attrs.cy >= bubbles[i].attrs.r + bubbles[i - 1].attrs.r, 'neighbouring end circles do not overlap');
  }
});

// 意图：锁定目检发现的四处互盖；窄矩阵保留全部值元数据，不能用超宽读数挤在24px格中。
test('compact multivariate charts reserve measured space for labels and legends', () => {
  const fixture = chart => KCHART_CASES.find(item => item.spec.chart === chart).spec;
  const longRowName = '华东区域重点客户';
  const longRowSpec = {
    chart: 'heatmap', encode: { row: 'region', column: 'period', value: 'value' },
    fields: { region: { label: '区域' }, period: { label: '月份' }, value: { label: '订单量', unit: '件', domain: [0, 6] } },
    data: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']
      .map((period, i) => ({ region: longRowName, period, value: i + 1 })),
  };
  for (const variant of [undefined, 'dots', 'arc']) {
    const spec = variant ? { ...longRowSpec, variant } : longRowSpec;
    const scene = renderer.render(spec, { width: 268 }).scene;
    const rowTexts = visit(scene.children).filter(node => node.tag === 'text');
    assert.ok(rowTexts.map(node => node.text).join('').includes(longRowName), `${variant || 'cells'} wraps the full long row name`);
    const measure = K.util.context({ spec: longRowSpec, width: 268 }).measure;
    assert.ok(rowTexts.every(node => {
      const x = Number(node.attrs.x), textWidth = measure(node.text, 12, Number(node.attrs['font-weight']) || 400);
      const anchor = node.attrs['text-anchor'];
      const left = anchor === 'end' ? x - textWidth : anchor === 'middle' ? x - textWidth / 2 : x;
      return x >= 0 && left >= -0.5;
    }), `${variant || 'cells'} keeps row labels inside the left edge`);
  }

  const matrix = K.layout(fixture('bubble-matrix'), { width: 268 });
  const matrixText = visit(matrix.children).filter(node => node.tag === 'text').map(node => node.text).join(' ');
  assert.match(matrixText, /团队.*月份.*指标值/, 'bubble-matrix description uses human field labels rather than internal encoding names');
  const readouts = matrix.children.filter(node => node.meta?.kind === 'cell-readout');
  const bubbles = matrix.children.filter(node => node.tag === 'circle' && node.meta?.value > 0);
  assert.ok(readouts.every(node => {
    const bubble = bubbles.find(mark => mark.meta.row === node.meta.row && mark.meta.column === node.meta.column);
    return bubble && Math.abs(node.attrs.x - bubble.attrs.cx) + 6 <= bubble.attrs.r;
  }), 'narrow matrix readouts stay inside their own bubble or are omitted');
  assert.equal(matrix.children.filter(node => node.tag === 'circle' && node.meta?.value != null).length, 24);
  const wideMatrix = K.layout(fixture('bubble-matrix'), { width: 984 });
  assert.equal(wideMatrix.children.filter(node => node.meta?.kind === 'cell-readout').length, 24);

  const calendar = K.layout(fixture('calendar'), { width: 984 });
  const rampLabel = visit(calendar.children).find(node => node.tag === 'text' && node.text.includes('色阶'));
  const firstSwatch = calendar.children.find(node => node.tag === 'rect' && node.attrs.width === 18 && node.attrs.height === 10);
  assert.equal(firstSwatch.attrs.x, rampLabel.attrs.x, 'a sufficiently wide calendar places the legend block to the right of its grid');
  assert.ok(firstSwatch.attrs.y > rampLabel.attrs.y, 'the ramp follows its wrapped label within the side legend block');
  const narrowCalendar = K.layout(fixture('calendar'), { width: 268 });
  const narrowCells = narrowCalendar.children.filter(node => node.tag === 'rect' && node.meta?.record);
  const note = visit(narrowCalendar.children).find(node => node.tag === 'text' && node.text.includes('未采集'));
  assert.ok(note.attrs.y > Math.max(...narrowCells.map(node => node.attrs.y + node.attrs.height)), 'calendar legend moves below the grid when the right-side block cannot fit');
  const dots = K.layout({ ...fixture('calendar'), variant: 'dots' }, { width: 984 });
  assert.ok(visit(dots.children).some(node => node.tag === 'text' && node.text.includes('面积小→大')), 'dot calendar explains area rather than a color scale');

  const bump = K.layout(fixture('bump'), { width: 268 });
  const rankTick = visit(bump.children).find(node => node.tag === 'text' && node.text === '1');
  const endpoints = visit(bump.children).filter(node => node.tag === 'text' && node.text === '甲');
  assert.equal(endpoints.length, 2, 'both ends name the series even on a narrow chart');
  assert.ok(endpoints.some(node => node.attrs['text-anchor'] === 'end' && rankTick.attrs.x - node.attrs.x >= 16), 'left names stay clear of the rank column');
  assert.ok(endpoints.some(node => node.attrs['text-anchor'] === 'start' && node.attrs.x - rankTick.attrs.x >= 30), 'right names stay clear of the rank column');

  const fan = K.layout(fixture('launch-fan'), { width: 268 });
  const dates = visit(fan.children).filter(node => node.tag === 'text' && node.meta?.kind === 'launch-fan-time');
  assert.ok(dates.length >= 2, 'the baseline retains distinct start-date ticks');
  assert.ok(dates.every(node => !node.text.includes('\n') && node.attrs.y === dates[0].attrs.y), 'baseline dates remain single-line on one row');
  assert.match(dates[0].text, /2026年/);
  assert.equal(dates.filter(node => /2026年/.test(node.text)).length, 1, 'a same-year timeline shows its year only on the first label');
  assert.ok(dates[0].meta.value < dates.at(-1).meta.value, 'endpoint labels are preserved after collision thinning');
  // 末端标签不能压在弧线上：窄宽下也必须位于各自圆的右侧，并保持在 viewBox 内。
  const fanBubbles = fan.children.filter(node => node.tag === 'circle' && node.meta?.value != null && node.attrs.r > 3);
  const endLabels = visit(fan.children).filter(node => node.tag === 'text' && node.meta?.value != null && node.meta?.kind == null);
  assert.equal(endLabels.length, fanBubbles.length);
  for (const label of endLabels) {
    const bubble = fanBubbles.find(node => node.meta.record === label.meta.record);
    assert.ok(label.attrs['text-anchor'] === 'start' && label.attrs.x >= bubble.attrs.cx + bubble.attrs.r, `${label.text} sits right of its bubble`);
    assert.ok(label.attrs.x + 60 <= fan.width, `${label.text} stays inside the viewBox`);
  }
  const radar = K.layout(fixture('radar'), { width: 268 });
  const texts = visit(radar.children).filter(node => node.tag === 'text').map(node => node.text);
  assert.ok(texts.some(text => /^users(?:\s|$)/.test(text)), 'side-axis labels keep short English names intact instead of breaking them into letters');
  assert.ok(radar.height < 320, 'narrow radar does not retain a desktop-height empty band');
});

test('Acceptance: readable minimums fit where possible and otherwise stay inside expanded viewBoxes', () => {
  const ids = [
    'chart-heatmap', 'variant-heatmap-cells', 'variant-heatmap-dots', 'variant-heatmap-arc',
    'variant-funnel-hourglass', 'variant-funnel-bars', 'chart-funnel', 'chart-tally',
    'chart-bump', 'chart-launch-fan', 'chart-calendar', 'variant-calendar-cells',
    'variant-calendar-dots', 'chart-radar', 'chart-bubble-matrix', 'edge-calendar-sparse-year',
  ];
  const fixtures = new Map(KCHART_CASES.map(item => [item.id, item.spec]));
  for (const id of ids) for (const width of [268, 502, 984]) {
    const spec = fixtures.get(id);
    const scene = renderer.render(spec, { width }).scene;
    assert.ok(scene.width >= width, `${id} scene.width ${scene.width} is unexpectedly smaller than ${width}`);
    const measure = K.util.context({ spec, width }).measure;
    for (const node of visit(scene.children).filter(item => item.tag === 'text')) {
      const x = Number(node.attrs.x);
      const size = Number(node.attrs['font-size']) || 12;
      const weight = Number(node.attrs['font-weight']) || 400;
      const textWidth = measure(node.text, size, weight);
      const anchor = node.attrs['text-anchor'];
      const left = anchor === 'end' ? x - textWidth : anchor === 'middle' ? x - textWidth / 2 : x;
      const right = anchor === 'end' ? x : anchor === 'middle' ? x + textWidth / 2 : x + textWidth;
      assert.ok(left >= -0.5 && right <= scene.width + 0.5, `${id} at ${width}px has clipped text: ${node.text}`);
    }
  }
  const heatmap = renderer.render(fixtures.get('chart-heatmap'), { width: 268 }).scene;
  const monthLabels = visit(heatmap.children).filter(node => node.tag === 'text' && /^\d+月$/.test(node.text));
  assert.deepEqual(monthLabels.map(node => node.text), ['1月', '2月', '3月', '4月', '5月', '6月']);
  assert.ok(visit(heatmap.children).some(node => node.tag === 'text' && node.text === '2026年'), 'heatmap retains the source year once in the first header row');
  const heatCells = heatmap.children.filter(node => node.tag === 'rect' && node.meta?.record);
  assert.equal(heatCells.length, 24, 'all six columns and four rows remain represented');
  const longHeatSpec = {
    chart: 'heatmap',
    data: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']
      .map(column => ({ row: 'A', column, value: 987654321 })),
    encode: { row: 'row', column: 'column', value: 'value' },
    fields: { value: { unit: '人' } },
  };
  const longHeat = renderer.render(longHeatSpec, { width: 268 }).scene;
  assert.equal(longHeat.children.filter(node => node.tag === 'rect' && node.meta?.record).length, 6);
  assert.equal(longHeat.children.filter(node => node.tag === 'text' && /987654321/.test(node.text)).length, 0,
    'oversized cell readouts are omitted while every raw value remains in cell metadata');
  assert.ok(longHeat.children.filter(node => node.tag === 'rect' && node.meta?.record).every(node => node.meta.value === 987654321));
  const wideTally = renderer.render(fixtures.get('chart-tally'), { width: 558 }).scene;
  const wideMarks = wideTally.children.filter(node => node.tag === 'circle' && node.meta?.kind === 'tally-mark');
  assert.equal(wideMarks.length, 400, 'wide tally keeps every category’s complete 10×10 dot array');
  const wideCenters = [...new Set(wideMarks.map(node => node.meta.category))].map(category => {
    const dots = wideMarks.filter(node => node.meta.category === category);
    return (Math.min(...dots.map(node => node.attrs.cx)) + Math.max(...dots.map(node => node.attrs.cx))) / 2;
  });
  assert.ok(wideCenters.slice(1).every((center, i) => Math.abs((center - wideCenters[i]) - (wideCenters[1] - wideCenters[0])) < 0.01), 'wide tally groups are evenly distributed across the width');
  for (const category of new Set(wideMarks.map(node => node.meta.category))) {
    const dots = wideMarks.filter(node => node.meta.category === category).sort((a, b) => a.meta.index - b.meta.index);
    const pitch = dots[1].attrs.cx - dots[0].attrs.cx;
    assert.ok(pitch >= 7 && pitch <= 12, `wide tally pitch remains between 7 and 12px (${pitch})`);
  }
  assert.ok(wideTally.children.some(node => node.tag === 'text' && node.attrs['font-weight'] === 600 && /%$/.test(node.text)), 'wide tally places bold percentages below dot arrays');

  const tally = renderer.render(fixtures.get('chart-tally'), { width: 268 }).scene;
  const marks = tally.children.filter(node => node.tag === 'circle' && node.meta?.kind === 'tally-mark');
  assert.equal(marks.length, 400, 'each of four categories retains one hundred count marks');
  assert.ok(marks.every(node => Number(node.attrs.r) >= 1.5), 'tally marks remain visually distinct dots');
  for (const category of new Set(marks.map(node => node.meta.category))) {
    const row = marks.filter(node => node.meta.category === category).sort((a, b) => a.meta.index - b.meta.index);
    const pitch = row[1].attrs.cx - row[0].attrs.cx;
    assert.ok(pitch >= 6 && pitch <= 9, `tally point pitch remains readable (${pitch}px)`);
    assert.ok(Math.abs(row[0].attrs.r * 2 - pitch * 0.7) < 0.01, 'tally dot diameter is 70% of its pitch');
    assert.equal(row[0].attrs.opacity, 1, 'filled points retain full contrast');
    const ctx = K.util.context({ spec: fixtures.get('chart-tally'), width: 268 });
    assert.equal(row[99].attrs.fill, ctx.color('axis'), 'empty points use the visible axis color role');
    assert.equal(row[99].attrs.opacity, 1, 'empty axis-colored points retain their full visibility');
  }
  const markBottom = Math.max(...marks.map(node => node.attrs.cy + node.attrs.r));
  const note = visit(tally.children).find(node => node.tag === 'text' && node.text.includes('每项独立百分比'));
  assert.ok(Number(note.attrs.y) - 12 > markBottom, 'the tally note starts below the final dot row');
  const linear = channel => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = color => {
    const channels = [1, 3, 5].map(index => linear(color.slice(index, index + 2)));
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const contrast = (a, b) => {
    const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  for (const theme of ['claude', 'obsidian']) {
    const palette = K.util.context({ theme }).palette;
    assert.ok(contrast(palette.tone1, palette.bg) >= 3, `${theme} filled tally dots retain 3:1 contrast`);
    assert.ok(contrast(palette.axis, palette.bg) >= 1.2, `${theme} empty dots remain distinguishable from the chart background`);
  }
  const bump = renderer.render(fixtures.get('chart-bump'), { width: 268 }).scene;
  assert.ok(bump.width >= 268, 'six periods keep the requested canvas or widen for the 36px period slot and both-end names');
  const bumpPoints = bump.children.filter(node => node.tag === 'circle' && node.meta?.category);
  assert.equal(bumpPoints.length, 24, 'six periods retain all four series points');
  const bumpCategories = K.util.context({ spec: fixtures.get('chart-bump'), width: 268 }).table(fixtures.get('chart-bump')).categories;
  const periodCenters = bumpCategories.map(category => {
    const points = bumpPoints.filter(node => node.meta.category === category);
    return points.reduce((sum, node) => sum + node.attrs.cx, 0) / points.length;
  });
  assert.ok(periodCenters.slice(1).every((x, i) => x - periodCenters[i] >= 36), 'narrow bump allocates at least 36px between periods');
  const bumpLabels = visit(bump.children).filter(node => node.tag === 'text' && node.meta?.series);
  assert.equal(bumpLabels.length, 8, 'narrow bump names every series at both ends so cycled colors stay identifiable');
  assert.equal(bumpLabels.filter(node => node.attrs['text-anchor'] === 'start').length, 4, 'the right end labels every series');
  assert.equal(bumpLabels.filter(node => node.attrs['text-anchor'] === 'end').length, 4, 'the left end labels every series');
  const bumpMeasure = K.util.context({ spec: fixtures.get('chart-bump'), width: 268 }).measure;
  assert.ok(bumpLabels.every(node => {
    const width = bumpMeasure(node.text, 12);
    const left = node.attrs['text-anchor'] === 'end' ? node.attrs.x - width : node.attrs.x;
    const right = node.attrs['text-anchor'] === 'end' ? node.attrs.x : node.attrs.x + width;
    return left >= -0.5 && right <= bump.width + 0.5;
  }), 'series labels at both ends remain inside the viewBox');
  const tightBump = renderer.render(fixtures.get('chart-bump'), { width: 220 }).scene;
  assert.ok(tightBump.width > 220, 'bump expands only when the requested canvas cannot satisfy period spacing');
  const tightCenters = bumpCategories.map(category => {
    const points = tightBump.children.filter(node => node.tag === 'circle' && node.meta?.category === category);
    return points.reduce((sum, node) => sum + node.attrs.cx, 0) / points.length;
  });
  assert.ok(tightCenters.slice(1).every((x, i) => x - tightCenters[i] >= 36), 'expanded bump still preserves 36px between periods');
  const calendarSpec = fixtures.get('chart-calendar');
  const calendar = renderer.render(calendarSpec, { width: 268 }).scene;
  const days = calendar.children.filter(node => node.tag === 'rect' && node.meta?.record);
  assert.equal(days.length, 120, 'compact calendar spans the 120 covered days, month-aligned');
  assert.ok(calendar.width <= 268 && days.every(node => Math.abs(Number(node.attrs.width) - Number(node.attrs.height)) < 0.01
    && Number(node.attrs.width) >= 10), '120-day calendar fits horizontally with square cells at least 10px');
  // 相邻周列之间始终保留至少 2px 留白，窄宽与宽屏都不会拼成无缝棋盘。
  for (const width of [268, 558, 984]) {
    const cells = renderer.render(calendarSpec, { width }).scene.children.filter(node => node.tag === 'rect' && node.meta?.record);
    const columns = [...new Set(cells.map(node => Number(node.attrs.x)))].sort((a, b) => a - b);
    assert.ok(columns[1] - columns[0] - Number(cells[0].attrs.width) >= 2, `${width}px calendar keeps a visible gutter between weeks`);
  }
  const longSpan = { ...calendarSpec, data: Array.from({ length: 12 }, (_, month) => ({
    date: new Date(Date.UTC(2026, month, 1)).toISOString().slice(0, 10), value: month,
  })) };
  const expandedCalendar = renderer.render(longSpan, { width: 268 }).scene;
  const expandedDays = expandedCalendar.children.filter(node => node.tag === 'rect' && node.meta?.record);
  assert.ok(expandedCalendar.width > 268, 'a 12-month range expands instead of shrinking calendar cells below 10px');
  assert.equal(new Set(expandedDays.map(node => node.attrs.x)).size, 53, 'year-long calendar retains horizontal week columns');
  assert.ok(expandedDays.every(node => Number(node.attrs.width) === 10 && Number(node.attrs.height) === 10
    && Number(node.attrs.x) + Number(node.attrs.width) <= expandedCalendar.width), 'expanded calendar cells remain square, 10px, and inside the viewBox');
  const sparseSpec = fixtures.get('edge-calendar-sparse-year');
  assert.equal(sparseSpec.data.length, 122);
  assert.ok(sparseSpec.data.some(row => row.value === 0), 'sparse-year fixture includes zero values');
  const sparseNarrow = renderer.render(sparseSpec, { width: 268 }).scene;
  const sparseCells = sparseNarrow.children.filter(node => node.tag === 'rect' && node.meta?.record);
  assert.ok(sparseNarrow.width > 268, 'the full-year calendar may scroll internally on a narrow viewport');
  assert.equal(sparseCells.length, 365, 'the narrow full-year grid renders every day');
  assert.equal(new Set(sparseCells.map(node => node.attrs.x)).size, 53, 'the full-year calendar keeps horizontal week columns');
  assert.ok(sparseCells.every(node => Number(node.attrs.width) === 10 && Number(node.attrs.height) === 10), 'narrow full-year cells stay square at the 10px minimum');
  const sparseWide = renderer.render(sparseSpec, { width: 984 }).scene;
  const sparseWideCells = sparseWide.children.filter(node => node.tag === 'rect' && node.meta?.record);
  assert.ok(sparseWide.width <= 984 && sparseWideCells.length === 365, 'the full-year calendar fits completely at desktop width');
  const radar = renderer.render(fixtures.get('chart-radar'), { width: 268 }).scene;
  const ring = visit(radar.children).find(node => node.tag === 'polygon' && node.attrs.fill === 'none');
  const points = ring.attrs.points.split(' ').map(pair => pair.split(',').map(Number));
  const diameter = (Math.max(...points.map(point => point[0])) - Math.min(...points.map(point => point[0]))) / 0.25;
  assert.ok(diameter >= 268 * 0.55, `narrow radar diameter is adequate (${diameter}px)`);
});

// 意图：三种热力矩阵共用年月压缩，低于最小列宽时扩展视口而不是裁切单元格。
test('shared temporal labels preserve years and 24-column heatmaps expand safely', () => {
  const compact = K.util.context({ width: 24 }).compactTemporal(['2026-01', '2026-02', '2026-12', '2027-01']);
  assert.deepEqual(Array.from(compact, item => item.label), ['1月', '2月', '12月', '1月']);
  assert.deepEqual(Array.from(compact, item => item.year), ['2026年', '', '', '2027年']);
  const english = K.util.context({ width: 24, lang: 'en-US' }).compactTemporal(['2026-01', '2026-02']);
  assert.deepEqual(Array.from(english, item => item.label), ['Jan', 'Feb']);
  assert.deepEqual(Array.from(english, item => item.year), ['2026', '']);

  const columns = Array.from({ length: 24 }, (_, i) => new Date(Date.UTC(2026, i, 1)).toISOString().slice(0, 7));
  const spec = {
    chart: 'heatmap', encode: { row: 'r', column: 'c', value: 'v' }, fields: { v: { domain: [0, 30], unit: '件' } },
    data: columns.map((c, i) => ({ r: 'A', c, v: i + 1 })),
  };
  for (const variant of [undefined, 'dots', 'arc']) {
    const scene = renderer.render({ ...spec, variant }, { width: 268 }).scene;
    assert.ok(scene.width > 268, `${variant || 'cells'} expands when 24 minimum-size columns cannot fit`);
    const nodes = visit(scene.children);
    const cells = variant === undefined
      ? nodes.filter(node => node.tag === 'rect' && node.meta?.record)
      : variant === 'dots'
        ? nodes.filter(node => node.tag === 'circle' && node.meta?.kind === 'cell')
        : nodes.filter(node => node.tag === 'circle' && node.meta?.kind === 'arc-track');
    assert.equal(cells.length, 24);
    assert.ok(cells.every(node => Number(node.attrs.x ?? node.attrs.cx) - Number(node.attrs.r || 0) >= 0
      && Number(node.attrs.x ?? node.attrs.cx) + Number(node.attrs.width || node.attrs.r || 0) <= scene.width), 'all cells are inside the expanded viewBox');
    assert.ok(scene.children.some(node => node.tag === 'text' && node.text === '2026年'));
    assert.ok(scene.children.some(node => node.tag === 'text' && node.text === '2027年'));
  }
});

const hexIn = (value) => String(value).match(/#[0-9a-f]{6}/gi).at(-1);
const THEMES = Object.keys(themes);

// 意图：气泡矩阵读数既可能落在半透明气泡上也可能落在格子底色上，两种底色在各内置主题下都要达到 4.5:1；
// 排名图首尾的系列名是着色正文，对页面底色同样要达到 4.5:1。
test('bubble-matrix readouts and bump series labels keep body-text contrast in every theme', () => {
  const bubbles = { chart: 'bubble-matrix', encode: { row: 'r', column: 'c', value: 'v' }, data: ['A', 'B'].flatMap((r) => ['x', 'y', 'z'].map((c, j) => ({ r, c, v: j * 4 + (r === 'A' ? 1 : 3) }))) };
  const ranks = { chart: 'bump', encode: { category: 't', series: 's', rank: 'rank' }, data: ['P1', 'P2', 'P3'].flatMap((t, i) => ['甲', '乙', '丙', '丁', '戊', '己'].map((s, j) => ({ t, s, rank: (j + i) % 6 + 1 }))) };
  for (const theme of THEMES) {
    const ctx = K.util.context({ theme });
    const scene = K.layout(bubbles, { width: 640, theme });
    const readouts = scene.children.filter((node) => node.meta?.kind === 'cell-readout');
    const bubble = scene.children.find((node) => node.tag === 'circle');
    assert.equal(readouts.length, bubbles.data.length);
    const onBubble = K.util.mix(ctx.palette.grid, ctx.palette.tone2, bubble.attrs['fill-opacity']);
    for (const under of [onBubble, ctx.palette.grid]) assert.ok(K.util.contrast(hexIn(readouts[0].attrs.fill), under) >= 4.5, `${theme}: readout on ${under}`);
    assert.ok(bubble.attrs.stroke, `${theme}: translucent bubbles keep a solid outline`);
    const labels = visit(K.layout(ranks, { width: 640, theme }).children).filter((node) => node.tag === 'text' && /^[甲乙丙丁戊己]$/.test(node.text));
    assert.equal(labels.length, 12, `${theme}: both ends label every series`);
    for (const label of labels) assert.ok(K.util.contrast(hexIn(label.attrs.fill), ctx.palette.bg) >= 4.5, `${theme}: ${label.text}`);
  }
  // 英文系列名换行只在词间发生，单词不被拆成两行。
  const words = { chart: 'bump', encode: { category: 't', series: 's', rank: 'rank' }, data: ['P1', 'P2'].flatMap((t, i) => ['Americano', 'Oat latte', 'Tea'].map((s, j) => ({ t, s, rank: (j + i) % 3 + 1 }))) };
  const shown = visit(K.layout(words, { width: 360, lang: 'en' }).children).filter((node) => node.tag === 'text' && /[a-z]/i.test(node.text) && !/^P\d$/.test(node.text)).map((node) => node.text);
  assert.ok(shown.filter((text) => text === 'Americano').length === 2, `Americano stays whole: ${shown}`);
  assert.ok(shown.every((text) => ['Americano', 'Oat', 'latte', 'Oat latte', 'Tea'].includes(text)), `${shown}`);
});

// 意图：行列变密时格子保持最小槽并加宽；读数只在完全落进气泡时才画，行名按实测留在场景内。
test('bubble-matrix keeps a minimum slot and draws readouts only inside the bubble', () => {
  const rows = Array.from({ length: 12 }, (_, i) => `行${i + 1}`);
  const columns = Array.from({ length: 12 }, (_, i) => `列${i + 1}`);
  const spec = {
    chart: 'bubble-matrix', encode: { row: 'r', column: 'c', value: 'v' },
    fields: { v: { unit: '个' } },
    data: rows.flatMap((row, i) => columns.map((column, j) => ({ r: row, c: column, v: (i + j) % 5 === 0 ? 0 : i * 12 + j + 1 }))),
  };
  const scene = K.layout(spec, { width: 1400 });
  const cells = scene.children.filter((node) => node.tag === 'rect');
  const slot = cells[1].attrs.x - cells[0].attrs.x;
  assert.ok(slot >= 28, 'dense columns widen instead of squashing the cell');
  assert.ok(scene.width >= 1400, 'the matrix keeps the requested width or widens for the minimum slot');
  const bubbles = scene.children.filter((node) => node.tag === 'circle');
  const readouts = scene.children.filter((node) => node.meta?.kind === 'cell-readout');
  for (const text of readouts) {
    const bubble = bubbles.find((node) => node.meta.row === text.meta.row && node.meta.column === text.meta.column);
    const width = K.util.context({ spec, width: 1400 }).measure(text.text, 12);
    assert.ok(width <= bubble.attrs.r * 2, `${text.text} fits inside its bubble`);
    assert.doesNotMatch(text.text, /个$/, 'a readout inside the bubble does not repeat the field unit');
  }
  assert.equal(scene.overflow, undefined, 'measured row labels do not rely on scene containment');
});

// 意图：雷达范围和平行坐标刻度都只保留一份单位，轴名换行不超过相邻轴距。
test('radar ranges and parallel ticks state each unit once', () => {
  const radar = {
    chart: 'radar', encode: { label: 'name', dimensions: ['a', 'b', 'c'] },
    fields: { a: { domain: [0, 435.8], unit: '个', label: '很长的轴名称用来检查换行' }, b: { domain: [0, 10], unit: '元' }, c: { domain: [0, 1], format: 'percent' } },
    data: [{ name: '甲', a: 20, b: 4, c: 0.5 }],
  };
  const radarText = visit(K.layout(radar, { width: 420 }).children).filter((node) => node.tag === 'text').map((node) => node.text).join(' ');
  assert.match(radarText, /0–435\.8个/);
  assert.doesNotMatch(radarText, /0个–/);
  assert.match(radarText, /0\.0–100\.0%/);
  assert.doesNotMatch(radarText, /0\.0%–100\.0%/);
  const parallel = {
    chart: 'parallel', encode: { label: 'name', dimensions: ['a', 'b', 'c'] },
    fields: { a: { domain: [0, 22780000], unit: '万元', label: '销售额' }, b: { domain: [0, 10], unit: '个' }, c: { domain: [0, 1], format: 'percent', label: '占比' } },
    data: [{ name: '甲', a: 1000000, b: 4, c: 0.5 }],
  };
  const scene = K.layout(parallel, { width: 360 });
  const texts = visit(scene.children).filter((node) => node.tag === 'text');
  assert.ok(texts.some((node) => node.text.includes('万元')), 'the axis title keeps the unit');
  const ticks = texts.filter((node) => node.attrs['font-weight'] !== 600 && node.attrs.y > 40 && node.attrs.y < scene.height - 40 && /\d/.test(node.text));
  assert.ok(ticks.every((node) => !/万万|个个|%%|万元|个$|%$/.test(node.text)), `ticks do not append the axis unit again: ${ticks.map((node) => node.text).join('|')}`);
  const titles = texts.filter((node) => node.attrs['font-weight'] === 600);
  const axes = [...new Set(titles.map((node) => node.attrs.x))].sort((a, b) => a - b);
  const measure = K.util.context({ spec: parallel, width: 360 }).measure;
  for (const title of titles) {
    const width = measure(title.text, 12, 600);
    const neighbor = Math.min(...axes.filter((x) => x !== title.attrs.x).map((x) => Math.abs(x - title.attrs.x)));
    assert.ok(width <= neighbor, `${title.text} wraps within the measured axis spacing`);
  }
});

// 意图：深浅主题的色带亮度方向可以反转；cells 用色阶数值解释颜色，只有 dots 用面积。
test('calendar legend describes the encoding without assuming the theme’s lightness direction', () => {
  const base = { chart: 'calendar', period: '2026', encode: { date: 'd', value: 'v' }, data: [{ d: '2026-01-01', v: -1 }, { d: '2026-01-02', v: 4 }] };
  const legend = (spec, theme, lang) => visit(K.layout(spec, { width: 640, theme, lang }).children)
    .map((node) => node.text).join(' ');
  for (const theme of ['paper', 'terminal']) {
    const chinese = legend(base, theme, 'zh');
    const english = legend(base, theme, 'en');
    assert.match(chinese, /正值色阶.*负值色阶/);
    assert.doesNotMatch(chinese, /浅→深|面积/);
    assert.match(english, /Positive color scale.*Negative color scale/);
    assert.doesNotMatch(english, /light→dark|area/i);
  }
  assert.match(legend({ ...base, variant: 'dots' }, 'terminal', 'zh'), /面积小→大/);
});

// 意图：河流图每层的下边必须与上边在同一时点配对，闭合多边形的每个横坐标处厚度等于该序列当期数值。
test('stream layers pair upper and lower edges at the same period', () => {
  const spec = { chart: 'stream', encode: { category: 't', value: ['a', 'b'] }, data: [{ t: 'P1', a: 1, b: 4 }, { t: 'P2', a: 6, b: 2 }, { t: 'P3', a: 3, b: 3 }] };
  const polygons = K.layout(spec, { width: 640 }).children.filter((node) => node.tag === 'polygon');
  assert.equal(polygons.length, 2);
  const thickness = polygons.map((polygon) => {
    const points = polygon.attrs.points.split(' ').map((pair) => pair.split(',').map(Number));
    const half = points.length / 2, upper = points.slice(0, half), lower = points.slice(half).reverse();
    assert.deepEqual(upper.map(([x]) => x), lower.map(([x]) => x), 'lower edge revisits the same periods in reverse');
    return upper.map(([, y], i) => lower[i][1] - y);
  });
  // 两层在各期的厚度比应等于数值比（同一比例尺）。
  const ratio = thickness[0][0] / spec.data[0].a;
  spec.data.forEach((row, i) => {
    assert.ok(Math.abs(thickness[0][i] - row.a * ratio) < 0.01, `a at ${row.t}`);
    assert.ok(Math.abs(thickness[1][i] - row.b * ratio) < 0.01, `b at ${row.t}`);
  });
});

// 意图：横向计数的每组标题至少有可读槽宽。组数多到槽宽不够时改成纵向，标题不进入邻组。
test('tally stacks groups when a horizontal slot would be narrower than a readable title', () => {
  const categories = ['North America enterprise accounts', 'Self-serve annual renewals', 'Cross-border fulfilment', 'Partner marketplace orders', 'University procurement', 'First-time buyers'];
  const spec = { chart: 'tally', data: categories.map((category, i) => ({ category, value: 0.1 + i * 0.05 })), encode: { category: 'category', value: 'value' }, fields: { value: { format: 'percent' } } };
  const scene = K.layout(spec, { width: 520, lang: 'en' });
  const texts = visit(scene.children).filter((node) => node.tag === 'text');
  const titles = texts.filter((node) => node.attrs['font-weight'] === 600 && node.attrs['text-anchor'] !== 'middle' && node.attrs.y < 220);
  const narrowCenters = [...new Set(titles.map((node) => Number(node.attrs.x)))].sort((a, b) => a - b);
  assert.ok(narrowCenters.length < categories.length, 'titles that cannot keep a readable slot stop using one column per group');
  const gap = narrowCenters.length > 1 ? Math.min(...narrowCenters.slice(1).map((x, i) => x - narrowCenters[i])) : scene.width;
  assert.ok(gap >= 72, 'remaining columns stay wide enough for a word');
  const wide = K.layout({ ...spec, data: spec.data.slice(0, 2) }, { width: 720, lang: 'en' });
  const wideTitles = visit(wide.children).filter((node) => node.tag === 'text' && node.attrs['text-anchor'] === 'middle' && Number(node.attrs.y) < 80);
  const wideCenters = [...new Set(wideTitles.map((node) => Number(node.attrs.x)))];
  assert.ok(wideCenters.length === 2, 'two groups that fit stay side by side');
});

// 意图：河流图偏移刻度只写数字，左右刻度按测得宽度留在绘图区外，相同注释不叠在一起。
test('stream and split-compare ticks stay numeric and inside measured gutters', () => {
  const stream = K.layout({ chart: 'stream', encode: { category: 'm', series: 's', value: 'v' }, fields: { v: { unit: '万元' } }, data: [{ m: '2024-01', s: '甲', v: 2710 }, { m: '2024-02', s: '甲', v: 1800 }] }, { width: 640 });
  const streamTicks = stream.children.filter((node) => node.tag === 'text' && node.attrs['text-anchor'] === 'end');
  assert.ok(streamTicks.length > 0);
  assert.ok(streamTicks.every((node) => !/万|元|%/.test(node.text)), 'offset ticks do not append a unit to an already scaled number');
  assert.equal(stream.overflow, undefined, 'the left gutter is measured from the tick labels');
  const split = K.layout({ chart: 'split-compare', encode: { category: 'm', upper: 'u', lower: 'l' }, fields: { u: { unit: '元' }, l: { unit: '元' } }, data: [{ m: '2024-01', u: 1500, l: 1500 }, { m: '2024-02', u: 900, l: 400 }] }, { width: 480 });
  const left = split.children.filter((node) => node.tag === 'text' && node.attrs['text-anchor'] === 'end' && /^-?[\d,.]+$/.test(node.text));
  const right = split.children.filter((node) => node.tag === 'text' && node.attrs['text-anchor'] === 'start' && /^-?[\d,.]+$/.test(node.text));
  assert.ok(left.length && right.length);
  assert.ok(Math.max(...left.map((node) => Number(node.attrs.x))) < Math.min(...right.map((node) => Number(node.attrs.x))), 'upper and lower ticks use opposite gutters');
  assert.equal(split.width, 480, 'measured gutters fit inside the requested width');
});

// 意图：combo首末长分类标签居中会出画布时才向内锚定并预留宽度；放得下时仍居中对齐自己的柱。
test('combo long edge categories stay inside reserved gutters at narrow widths', () => {
  const label = 'North American enterprise subscription renewals';
  const spec = { chart: 'combo', encode: { category: 'category' }, fields: { value: { label: 'Annual recurring revenue' } }, data: [{ category: label, value: 10 }, { category: 'Other long-term contracts and services', value: 20 }], layers: [{ mark: 'line', field: 'value', axis: 'left' }] };
  assert.equal(K.layout(spec, { width: 320, lang: 'en-US' }).overflow, undefined);
  const short = { chart: 'combo', encode: { category: 'm' }, data: ['2026-01', '2026-02', '2026-03', '2026-04'].map((m, i) => ({ m, sales: 10 + i })), layers: [{ mark: 'column', field: 'sales', axis: 'left' }] };
  const labels = K.layout(short, { width: 558 }).children.filter((node) => node.tag === 'text' && /^2026-0[14]$/.test(node.text));
  assert.equal(labels.length, 2);
  assert.ok(labels.every((node) => node.attrs['text-anchor'] === 'middle'), 'short edge categories stay centered under their columns');
});

// 意图：stream首末长分类标签不能从默认左右边距伸出场景边界。
test('stream long edge categories stay inside reserved gutters at narrow widths', () => {
  const spec = { chart: 'stream', encode: { category: 'category', value: ['current', 'previous'] }, data: [{ category: 'North American enterprise subscription renewals', current: 12, previous: 8 }, { category: 'Other long-term contracts and services', current: 20, previous: 10 }] };
  assert.equal(K.layout(spec, { width: 320, lang: 'en-US' }).overflow, undefined);
});

// 意图：split-compare首末长分类标签与左右刻度列共同落在计算后的场景宽度内。
test('split-compare long edge categories stay inside reserved gutters at narrow widths', () => {
  const spec = { chart: 'split-compare', encode: { category: 'category', upper: 'revenue', lower: 'cost' }, fields: { revenue: { label: 'Annual recurring revenue', unit: 'USD' }, cost: { label: 'Operating cost', unit: 'USD' } }, data: [{ category: 'North American enterprise subscription renewals', revenue: 1200000, cost: 800000 }, { category: 'Other long-term contracts and services', revenue: 2000000, cost: 1100000 }] };
  assert.equal(K.layout(spec, { width: 320, lang: 'en-US' }).overflow, undefined);
});
