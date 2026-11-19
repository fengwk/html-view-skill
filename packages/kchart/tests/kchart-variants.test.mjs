import { test } from 'vitest';
import assert from 'node:assert/strict';
import { install as installBasic } from '../src/chart/basic.js';
import { install as installStatistics } from '../src/chart/statistics.js';
import { install as installVariants } from '../src/chart/variants.js';
import { loadChart } from './kchart-fixture.mjs';
import { themes } from '../src/core/theme.js';

const { api: K } = loadChart([installBasic, installStatistics, installVariants]);
const plain = value => JSON.parse(JSON.stringify(value));
const elements = (scene, tag) => {
  const found=[]; const visit=node=>{if(node.tag===tag)found.push(node);for(const child of node.children||[])visit(child);};
  scene.children.forEach(visit); return found;
};
const textOf = scene => elements(scene,'text').map(node=>node.text).join('\n');
const run = (spec, width=760, lang='zh') => {
  const result=K.validate(spec); assert.deepEqual(plain(result.errors),[]);
  const scene=K.layout(spec,{width,lang});
  assert.ok(scene.height>0 && scene.children.length>0);
  assert.ok(elements(scene,'text').every(node=>Number(node.attrs['font-size']||12)>=12));
  assert.doesNotMatch(K.renderScene(scene),/NaN|Infinity/);
  return scene;
};
const assertBounds = (spec, width) => {
  const {scene,svg}=K.render(spec,{width});
  assert.match(svg,/viewBox=/);
  const check=(node,dx=0,dy=0)=>{
    const translate=String(node.attrs?.transform||'').match(/^translate\(\s*([-\d.]+)(?:[ ,]+([-\d.]+))?\s*\)$/);
    const ox=dx+(translate?Number(translate[1]):0), oy=dy+(translate?Number(translate[2]||0):0);
    const n=(key)=>Number(node.attrs?.[key])+((key==='cx'||key==='x'||key==='x1'||key==='x2')?ox:oy);
    if(node.tag==='text')assert.ok(n('x')>=-0.1&&n('x')<=scene.width+.1&&n('y')>=-0.1&&n('y')<=scene.height+.1,`text anchor outside ${width}: ${JSON.stringify(node.attrs)}`);
    if(node.tag==='circle')assert.ok(n('cx')-Number(node.attrs.r)>=-0.1&&n('cx')+Number(node.attrs.r)<=scene.width+.1&&n('cy')-Number(node.attrs.r)>=-0.1&&n('cy')+Number(node.attrs.r)<=scene.height+.1,`circle outside ${width}: ${JSON.stringify(node.attrs)}`);
    if(node.tag==='rect')assert.ok(n('x')>=-0.1&&n('x')+Number(node.attrs.width)<=scene.width+.1&&n('y')>=-0.1&&n('y')+Number(node.attrs.height)<=scene.height+.1,`rect outside ${width}: ${JSON.stringify(node.attrs)}`);
    if(node.tag==='line')assert.ok(Math.min(n('x1'),n('x2'))>=-0.1&&Math.max(n('x1'),n('x2'))<=scene.width+.1&&Math.min(n('y1'),n('y2'))>=-0.1&&Math.max(n('y1'),n('y2'))<=scene.height+.1,`line outside ${width}: ${JSON.stringify(node.attrs)}`);
    if(node.tag==='path'){
      const d=String(node.attrs.d||'');
      const points=[...d.matchAll(/[ML]\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/g)].map(m=>[Number(m[1]),Number(m[2])]);
      for(const match of d.matchAll(/C\s*(-?[\d.]+)[ ,]+(-?[\d.]+)[ ,]+(-?[\d.]+)[ ,]+(-?[\d.]+)[ ,]+(-?[\d.]+)[ ,]+(-?[\d.]+)/g))for(let i=1;i<6;i+=2)points.push([Number(match[i]),Number(match[i+1])]);
      points.forEach(([x,y])=>assert.ok(x+ox>=-0.1&&x+ox<=scene.width+.1&&y+oy>=-0.1&&y+oy<=scene.height+.1,`path outside ${width}: ${d}`));
    }
    for(const child of node.children||[])check(child,ox,oy);
  };
  scene.children.forEach(node=>check(node));
  return scene;
};

//意图：这些独立结构和可见读数验证每个变体真正改了构图，不只是没有NaN的比例运算。
test('counter, barcode and ticks variants use real values and explicit denominator',()=>{
  const standard=run({chart:'line',data:[{d:'A',v:1},{d:'B',v:2}],encode:{category:'d',value:'v'}});
  assert.ok(elements(standard,'path').some(n=>n.attrs.fill==='none'&&n.attrs.stroke!=='none'),'omitted variant still uses the original line');
  const counter=run({chart:'line',variant:'counter',data:[{d:'Jan',v:12},{d:'Feb',v:18},{d:'Mar',v:25}],encode:{category:'d',value:'v'},unit:'件'});
  assert.match(textOf(counter),/25件/); assert.ok(elements(counter,'circle').length>=3);
  assert.equal(elements(counter,'text').filter(node => node.text === '25件').length, 1, 'counter suppresses the duplicate latest-point readout from its base line chart');
  const gap=run({chart:'line',variant:'counter',data:[{d:'A',v:1},{d:'B',v:null},{d:'C',v:3}],encode:{category:'d',value:'v'}});
  assert.equal(elements(gap,'path').filter(n=>n.attrs.stroke!=='none').length,2,'counter trend stays broken across a missing reading');
  const stacked=run({chart:'line',variant:'counter',stack:'absolute',data:[{d:'A',a:2,b:3},{d:'B',a:4,b:5}],encode:{category:'d',value:['a','b']}});
  const topReads=elements(stacked,'text').filter(n=>n.meta?.kind==='counter');
  assert.deepEqual(topReads.map(n=>n.meta.plotted),[4,9]);
  assert.notEqual(topReads[0].attrs.y,topReads[1].attrs.y,'equal latest category positions keep each stacked series readout distinct');
  const barcode=run({chart:'line',variant:'barcode',data:[{d:'Jan',v:2},{d:'Feb',v:4},{d:'Mar',v:3}],encode:{category:'d',value:'v'}});
  assert.equal(elements(barcode,'line').filter(n=>n.meta?.kind==='barcode').length,3);
  assert.equal(elements(barcode,'path').filter(n=>n.attrs.fill==='none'&&n.attrs.stroke!=='none').length,0,'barcode removes default connecting trend strokes');
  assert.match(textOf(barcode),/Jan/); assert.match(textOf(barcode),/3/);
  const ticks=run({chart:'share',variant:'ticks',data:[{c:'A',v:3},{c:'B',v:1}],encode:{category:'c',value:'v'}});
  const marks=elements(ticks,'line').filter(n=>n.meta?.kind==='tick');
  assert.equal(marks.length,24); assert.ok(marks.every(n=>n.meta.denominator===4));
  assert.match(textOf(ticks),/75\.0%/); assert.match(textOf(ticks),/合计 4/);
});

test('default bars funnel gives separate three-line quantity and retention readouts',()=>{
  const spec={chart:'funnel',variant:'bars',data:[{step:'到访',amount:100},{step:'试用',amount:50},{step:'付费',amount:20}],encode:{category:'step',value:'amount'},unit:'人'};
  for(const width of [268,502,984]){
    const result=assertBounds(spec,width), rows=elements(result,'text').filter(node=>node.meta?.kind==='value');
    const first=rows.filter(node=>node.meta.category==='到访').map(node=>node.text);
    const second=rows.filter(node=>node.meta.category==='试用').map(node=>node.text);
    assert.deepEqual(first,['100人','占首步 100.0%']);
    assert.deepEqual(second,['50人','占首步 50.0%','占上一步 50.0%']);
    assert.ok(rows.some(node=>node.meta.category==='付费'&&node.text==='占上一步 40.0%'));
    assert.ok(rows.every(node=>!node.text.includes('·')),'funnel readouts do not merge percentages with a separator');
  }
});

test('hourglass and plumb show stage quantities and numeric-axis points',()=>{
  const funnel=run({chart:'funnel',variant:'hourglass',data:[{s:'Visit',n:100},{s:'Trial',n:50},{s:'Paid',n:20}],encode:{category:'s',value:'n'},unit:'人'});
  assert.match(textOf(funnel),/100人/); assert.match(textOf(funnel),/50\.0%/); assert.ok(elements(funnel,'path').length>=3);
  const scatter=run({chart:'scatter',variant:'plumb',data:[{x:1,y:2,id:'a'},{x:3,y:6,id:'b'}],encode:{x:'x',y:'y',id:'id'}});
  const plumbs=elements(scatter,'line').filter(n=>n.meta?.kind==='plumb');
  assert.equal(plumbs.length,2); assert.ok(plumbs.every(n=>Number(n.attrs.x1)===Number(n.attrs.x2))); assert.equal(new Set(plumbs.map(n=>n.attrs.y1)).size,1);
  const axisTitles=elements(scatter,'text').filter(n=>n.meta?.kind==='axis-title').map(n=>`${n.meta.axis}:${n.text}`).sort();
  assert.deepEqual(axisTitles,['x:x','y:y'], 'scatter axes are labeled by their fields rather than internal role names');
});

test('heatmap dots and arcs distinguish missing cells and disclose the full scale',()=>{
  const data=[{r:'North',c:'A',v:0},{r:'North',c:'B',v:0.5}];
  const dots=run({chart:'heatmap',variant:'dots',data,fields:{v:{format:'percent'},r:{domain:['North','South']},c:{domain:['A','B']}},encode:{row:'r',column:'c',value:'v'}});
  assert.equal(elements(dots,'circle').filter(n=>n.meta?.kind==='missing').length,2);
  assert.equal(elements(dots,'text').filter(n=>n.meta?.kind==='missing-label').length,0,'missing values use a uniform hollow mark instead of repeating a word in every cell');
  assert.match(textOf(dots),/空心环表示缺失/,'the missing mark is explained once in the matrix note');
  assert.ok(elements(dots,'circle').some(n=>n.meta?.kind==='zero'&&n.meta.value===0));
  const arcs=run({chart:'heatmap',variant:'arc',data:[{r:'North',c:'A',v:0},{r:'North',c:'B',v:0.5}],fields:{v:{format:'percent'}},encode:{row:'r',column:'c',value:'v'}});
  assert.match(textOf(arcs),/整弧 = 100%/);
  assert.ok(elements(arcs,'path').length>=1);
});

test('waffle field allocates exactly one hundred percentage points in category blocks',()=>{
  const field=run({chart:'waffle',variant:'field',data:[{c:'A',v:1},{c:'B',v:1},{c:'C',v:1}],encode:{category:'c',value:'v'}});
  const points=elements(field,'circle').filter(n=>n.meta?.kind==='unit');
  assert.equal(points.length,100); assert.ok(points.every(n=>n.meta.percent===1));
  assert.match(textOf(field),/最大余数法/);
  assert.equal(points.filter(n=>n.meta.category==='A').length,34);
  assert.equal(points.filter(n=>n.meta.category==='B').length,33);
  assert.equal(points.filter(n=>n.meta.category==='C').length,33);
  for(const category of ['A','B','C']){
    const group=points.filter(point=>point.meta.category===category);
    assert.equal(new Set(group.map(point=>Number(point.attrs.cx))).size,5,'each category uses five aligned columns');
  }
  const ranges=['A','B','C'].map(category=>points.filter(point=>point.meta.category===category).map(point=>Number(point.attrs.cy)));
  assert.ok(Math.min(...ranges[1])>Math.max(...ranges[0])&&Math.min(...ranges[2])>Math.max(...ranges[1]),'category blocks are continuous and separated from one another');
  assert.match(textOf(field),/A · 33\.3%/); assert.match(textOf(field),/B · 33\.3%/); assert.match(textOf(field),/C · 33\.3%/);
});

//意图：确保next提供的坐标轴、区间与注释仍在变体场景中，并在窄/中/宽视口完整落入SVG bounds。
test('counter and barcode retain next axes, log domains, confidence bands and annotations',()=>{
  const spec={chart:'line',variant:'counter',data:[
    {t:'A',v:1,lo:0.5,hi:2,id:'a'},{t:'B',v:10,lo:5,hi:20,id:'b'},{t:'C',v:100,lo:50,hi:150,id:'c'},
  ],encode:{category:'t',value:'v',lower:'lo',upper:'hi',id:'id'},fields:{v:{scale:'log',domain:[0.5,200]}},
  annotations:[{kind:'rule',field:'v',value:25,label:'target'},{kind:'note',field:'v',record:'b',text:'event'}]};
  const barcode={...spec,variant:'barcode'};
  for(const width of [324,558,1040]){
    const counter=assertBounds(spec,width),ticks=elements(counter,'text').map(n=>n.text).join('\n');
    assert.match(ticks,/target/); assert.match(ticks,/event/); assert.match(ticks,/100/);
    assert.ok(elements(counter,'path').some(n=>n.attrs['fill-opacity']===0.13),'counter retains the confidence interval from next');
    const bars=assertBounds(barcode,width);
    assert.match(elements(bars,'text').map(n=>n.text).join('\n'),/target/);
    assert.equal(elements(bars,'line').filter(n=>n.meta?.kind==='barcode').length,3);
    assert.ok(elements(bars,'path').some(n=>n.attrs['fill-opacity']===0.13),'barcode retains the confidence interval while replacing only the trend');
  }
});

//意图：长表多系列及长标签在窄屏使用每系列真实值，且换行摘要不与下一系列重叠。
test('share ticks read each long-table series and reserve wrapped rows',()=>{
  const fields=['one','two','three','four'];
  const categories=['甲渠道特别长的分类标签一','乙渠道特别长的分类标签二','丙渠道特别长的分类标签三','丁渠道特别长的分类标签四','戊渠道特别长的分类标签五','己渠道特别长的分类标签六'];
  const profiles=[[1,2,3,4,5,6],[6,5,4,3,2,1],[1,1,1,1,1,1],[2,1,3,1,5,1]];
  const wideData=categories.map((category,i)=>({category,...Object.fromEntries(fields.map((field,j)=>[field,profiles[j][i]]))}));
  const wide={chart:'share',variant:'ticks',data:wideData,encode:{category:'category',value:fields},fields:Object.fromEntries(fields.map((field,i)=>[field,{label:`非常长的系列名称${i+1}`}]))};
  for(const width of [324,558,1040]){
    const result=assertBounds(wide,width), ticks=elements(result,'line').filter(n=>n.meta?.kind==='tick');
    assert.equal(ticks.length,fields.length*24);
    assert.equal(elements(result,'g').filter(n=>n.meta?.kind==='legend').length,6,'category tick colors have a visible legend');
    const rowY=fields.map(field=>ticks.find(n=>n.meta.series===field).attrs.y1);
    for(let i=1;i<rowY.length;i++)assert.ok(Number(rowY[i])-Number(rowY[i-1])>=60,'each series gets enough vertical room for its wrapped percentage summary');
    fields.forEach((field,j)=>assert.ok(ticks.some(n=>n.meta.series===field&&n.meta.denominator===profiles[j].reduce((sum,value)=>sum+value,0))));
  }
  // Long-form input is capped at six source rows by this validator; this two-series case still detects accidental reuse of the first series per category.
  const longData=[{category:'A',series:'first',amount:9},{category:'B',series:'first',amount:1},{category:'C',series:'first',amount:0},{category:'A',series:'second',amount:2},{category:'B',series:'second',amount:8},{category:'C',series:'second',amount:0}];
  const long={chart:'share',variant:'ticks',data:longData,encode:{category:'category',series:'series',value:'amount'}};
  assert.deepEqual(plain(K.validate(long).errors),[]);
  for(const width of [324,558,1040]){
    const ticks=elements(assertBounds(long,width),'line').filter(n=>n.meta?.kind==='tick');
    assert.equal(ticks.filter(n=>n.meta.series==='first'&&n.meta.category==='A').length,22);
    assert.equal(ticks.filter(n=>n.meta.series==='second'&&n.meta.category==='A').length,5,'each long-table series uses its own values rather than the first value for a category');
  }
});

//意图：ticks与实心占比条共用行几何，系列名右对齐在刻度带左侧并与之垂直居中，不再悬在刻度带上方。
test('share ticks keep the series label beside a band that matches the solid bar', () => {
  const spec = { chart: 'share', data: [{ c: '甲', v: 3 }, { c: '乙', v: 1 }], encode: { category: 'c', value: 'v' } };
  for (const width of [324, 558]) {
    const solid = run(spec, width), ticks = run({ ...spec, variant: 'ticks' }, width);
    const track = elements(solid, 'rect').find((node) => Number(node.attrs.height) === 22);
    const marks = elements(ticks, 'line').filter((node) => node.meta?.kind === 'tick');
    const label = (scene) => elements(scene, 'text').find((node) => node.meta?.kind === 'series');
    const bandTop = Number(marks[0].attrs.y1), bandBottom = Number(marks[0].attrs.y2);
    assert.equal(bandTop, Number(track.attrs.y), `${width}px tick band starts where the solid bar starts`);
    assert.equal(bandBottom - bandTop, 22, 'tick band has the solid bar height');
    assert.ok(Math.abs(Number(marks[0].attrs.x1) - Number(track.attrs.x)) <= 1.2, 'tick band starts at the solid bar left edge');
    assert.equal(label(ticks).attrs['text-anchor'], 'end');
    assert.ok(Number(label(ticks).attrs.x) < Number(marks[0].attrs.x1), 'series label sits left of the band');
    // 12px 文字的视觉中心约在基线上方 0.35em；允许 2px 内的光学偏差。
    const labelCenter = Number(label(ticks).attrs.y) - 12 * 0.35;
    assert.ok(Math.abs(labelCenter - (bandTop + bandBottom) / 2) <= 2, 'series label is vertically centered on the band');
    assert.equal(label(ticks).attrs.y, label(solid).attrs.y, 'both variants place the series label identically');
  }
});

//意图：268px下ticks读数包含全部类别和合计，ctx.flow只在完整条目之间换行。
test('share ticks flow every category readout atomically at mobile width', () => {
  const categories = ['甲', '乙', '丙', '丁'];
  const spec = { chart: 'share', variant: 'ticks', data: categories.map((category, i) => ({ category, amount: [18, 21, 24, 5][i] })), encode: { category: 'category', value: 'amount' } };
  const scene = assertBounds(spec, 268);
  const readouts = elements(scene, 'text').filter((node) => node.meta?.kind === 'readout');
  const text = readouts.map((node) => node.text);
  for (const category of categories) assert.ok(text.some((line) => line.includes(`${category} `)), `${category} remains a complete readout item`);
  assert.ok(text.some((line) => line.includes('合计 ')), 'total remains a complete readout item');
  assert.ok(readouts.length > 1, 'readout items wrap to multiple lines rather than being internally split');
  assert.ok(readouts.every((node) => node.meta.items.every((item) => node.text.includes(item))), 'every displayed line is assembled from intact flow items');
});

// 意图：ticks单条读数比刻度带还宽时在带宽内换行，不越出场景。
test('share ticks wrap a readout wider than the band inside the scene', () => {
  const spec = { chart: 'share', variant: 'ticks', unit: 'USD', data: [
    { category: 'Retail', value: 2476 }, { category: 'First-time buyers with a completed order', value: 1493 },
    { category: 'Self-serve annual renewals (net)', value: 2257 }, { category: 'Lagos', value: 2726 },
  ], encode: { category: 'category', value: 'value' } };
  const scene = K.layout(spec, { width: 300, lang: 'en' });
  assert.equal(scene.overflow, undefined);
  const text = elements(scene, 'text').filter((node) => node.meta?.kind === 'readout').map((node) => node.text).join(' ');
  for (const word of ['First-time', 'buyers', 'completed', 'order']) assert.match(text, new RegExp(word), 'the wrapped readout keeps every word');
});

//意图：零前序必须显示不可计算，三种画布宽度均完整保留形状和外置标签。
test('hourglass uses each stage value for its own section and handles zero predecessor',()=>{
  const spec={chart:'funnel',variant:'hourglass',data:[{step:'流量来源非常长的阶段一',n:100},{step:'阶段二',n:0},{step:'阶段三',n:0}],encode:{category:'step',value:'n'},unit:'人'};
  for(const width of [324,558,1040]){
    const result=assertBounds(spec,width), text=textOf(result), shapes=elements(result,'path').filter(n=>n.meta?.kind==='stage');
    assert.match(text.replace(/\s/g,''),/上一步为0，不可计算/); assert.doesNotMatch(text,/NaN|undefined|上步—|prior —/);
    assert.match(text,/占首步/); assert.match(text,/占上一步/);
    assert.equal(shapes.length,3); assert.ok(shapes.every(n=>n.attrs.d.includes(' C ') && n.meta.shapeWidth >= 90),'stage silhouettes use smooth flow contours and retain a readable minimum width');
    const widths=shapes.map(n=>{
      const start=n.attrs.d.match(/M\s*(-?[\d.]+)/), curves=[...n.attrs.d.matchAll(/C\s*(-?[\d.]+)[ ,]+(-?[\d.]+)[ ,]+(-?[\d.]+)[ ,]+(-?[\d.]+)[ ,]+(-?[\d.]+)[ ,]+(-?[\d.]+)/g)];
      return Number(curves.at(-1)[5])-Number(start[1]);
    });
    assert.ok(widths[0]>0&&widths[1]===0,'top section widths are the current stage values, not the previous value');
  }
});

//意图：plumb从next继承对数位置、参考线、原点大小及真实点，不造第二坐标系或伪化零尺寸。
test('plumb decorates next scatter points and annotations at all target widths',()=>{
  const spec={chart:'scatter',variant:'plumb',data:[{id:'a',x:1,y:1,s:0},{id:'b',x:10,y:10,s:4},{id:'c',x:100,y:100,s:16}],
    encode:{x:'x',y:'y',size:'s',id:'id'},fields:{x:{scale:'log',domain:[1,100]},y:{scale:'log',domain:[1,100]}},
    annotations:[{kind:'rule',field:'x',value:10,label:'x reference'},{kind:'rule',field:'y',value:20,label:'y reference'}]};
  for(const width of [324,558,1040]){
    const result=assertBounds(spec,width), marks=elements(result,'circle'), stems=elements(result,'line').filter(n=>n.meta?.kind==='plumb');
    assert.equal(marks.length,3); assert.equal(stems.length,3);
    assert.equal(Number(marks.find(n=>n.attrs.r===0)?.attrs.r),0,'zero size remains a zero-radius point');
    assert.match(textOf(result),/x reference/); assert.match(textOf(result),/y reference/);
    assert.ok(elements(result,'line').some(n=>n.attrs.stroke===K.util.context({spec}).palette.grid),'next grid axis remains present');
  }
});

//意图：矩阵以弧长/点面积为主、精确值仍由可访问title提供；缺失与零不混淆。
test('heatmap dots and arcs omit repeated readouts while preserving accessible values and missing versus zero',()=>{
  const dots={chart:'heatmap',variant:'dots',data:[{r:'North',c:'A',v:0},{r:'North',c:'B',v:25},{r:'South',c:'A',v:-100}],
    encode:{row:'r',column:'c',value:'v'},fields:{v:{unit:'measurement-unit-long',domain:[-100,100]},c:{domain:['A','B']},r:{domain:['North','South','East']}}};
  const arc={chart:'heatmap',variant:'arc',data:[{r:'North',c:'A',v:0},{r:'North',c:'B',v:2},{r:'South',c:'A',v:10}],
    encode:{row:'r',column:'c',value:'v'},fields:{v:{unit:'measurement-unit-long',domain:[0,10]},c:{domain:['A','B']},r:{domain:['North','South']}}};
  for(const width of [324,558,1040]){
    const dotScene=assertBounds(dots,width), dotMarks=elements(dotScene,'circle').filter(n=>['zero','cell','missing'].includes(n.meta?.kind));
    assert.equal(elements(dotScene,'circle').filter(n=>n.meta?.kind==='zero').length,1);
    assert.equal(elements(dotScene,'circle').filter(n=>n.meta?.kind==='missing').length,3);
    const small=dotMarks.find(n=>n.meta?.kind==='cell'&&n.meta.value===25),large=dotMarks.find(n=>n.meta?.kind==='cell'&&n.meta.value===-100);
    assert.ok(Math.abs((Number(large.attrs.r)/Number(small.attrs.r))**2-4)<1e-8,'dot area ratio tracks absolute values without a minimum-radius clamp');
    assert.equal(elements(dotScene,'text').filter(n=>/measurement-unit-long/.test(n.text)).length,0,'cell values are not redundantly printed beside the encoded dot');
    const dotTitles=elements(dotScene,'title').map(n=>n.text);
    assert.ok(dotTitles.includes('North · B: 25 measurement-unit-long'),'the exact value remains available in accessible SVG title text');
    const arcScene=assertBounds(arc,width), full=elements(arcScene,'path').find(n=>n.meta?.kind==='cell'&&n.meta.value===10);
    assert.ok(full&&((full.attrs.d.match(/A/g)||[]).length===2),'maximum uses an explicit full circumference');
    assert.equal(elements(arcScene,'text').filter(n=>/measurement-unit-long/.test(n.text)).length,1,'only the shared encoding note mentions units; cells do not duplicate readouts');
    assert.ok(elements(arcScene,'title').some(n=>n.text==='South · A: 10 measurement-unit-long'));
    assert.match(textOf(arcScene),/整弧 = 10 measurement-unit-long/);
  }
});

//意图：field按类别连续分块、块内五列，类别与百分比紧邻区块并适配窄视口。
test('waffle field groups five-column category blocks with inline percentages inside render bounds',()=>{
  const spec={chart:'waffle',variant:'field',data:[{c:'Alpha',v:3},{c:'Beta',v:2},{c:'Gamma',v:1}],encode:{category:'c',value:'v'}};
  for(const width of [268,324,558,1040]){
    const result=assertBounds(spec,width), points=elements(result,'circle').filter(n=>n.meta?.kind==='unit');
    assert.equal(points.length,100);
    assert.equal(Math.max(...points.map(n=>Number(n.attrs.cx)+Number(n.attrs.r)))<=result.width,true);
    assert.ok(result.width <= Math.max(width,260), 'category blocks and note reflow within the actual narrow chart viewport');
    const groups=[...new Set(points.map(n=>n.meta.category))].map(category=>points.filter(n=>n.meta.category===category));
    assert.ok(groups.every(group=>new Set(group.map(n=>Number(n.attrs.cx))).size===5),'each category block is laid out in five columns');
    assert.ok(groups.every((group,index)=>index===0||Math.min(...group.map(n=>Number(n.attrs.cy)))>Math.max(...groups[index-1].map(n=>Number(n.attrs.cy)))),'category blocks occupy distinct contiguous vertical ranges');
    assert.ok(['Alpha','Beta','Gamma'].every(name=>textOf(result).includes(name)),'every block has its adjacent category label');
    const fieldText=textOf(result).replace(/\s+/g,' ');
    assert.match(fieldText,/Alpha · 50\.0%/); assert.match(fieldText,/最大余数法/);
  }
  const english=run(spec,324,'en');
  assert.match(textOf(english),/Largest-remainder rounding/);
});

// 意图：中文禁则不能把点阵说明的逗号留在装不下它的上一行。
test('窄版华夫图完整保留说明且不突破留白', () => {
  const measure = text => [...text].reduce((width, char) => width + (/^[\u0000-\u007f]$/.test(char) ? 7 : 12), 0);
  const input = { chart: 'waffle', variant: 'field', data: [{ c: '甲组', v: 4 }, { c: '乙组', v: 6 }], encode: { category: 'c', value: 'v' } };
  const result = K.layout(input, { width: 300, measure });
  assert.equal(result.width, 300);
  const note = elements(result, 'text').filter(({ attrs }) => attrs.x === 16);
  assert.equal(note.map(({ text }) => text).join(''), '共100点，每点表示1个百分点；按最大余数法舍入，不代表真实个体。');
  assert.ok(note.every(({ text }) => measure(text) <= 268));
});

// 意图：点与环和列头文字共用同一中轴，宽图框中不贴在列左侧；华夫分块的着色类别名在各内置主题下达到正文 4.5:1。
test('heatmap dots align with column headers and waffle field labels stay readable in every theme',()=>{
  const hexIn=value=>String(value).match(/#[0-9a-f]{6}/gi).at(-1);
  const data=[{r:'North',c:'A',v:4},{r:'North',c:'B',v:9},{r:'South',c:'A',v:1},{r:'South',c:'B',v:6}];
  for(const variant of ['dots','arc'])for(const width of [324,1040]){
    const scene=run({chart:'heatmap',variant,data,fields:{v:{domain:[0,10]}},encode:{row:'r',column:'c',value:'v'}},width);
    const headers=elements(scene,'text').filter(n=>['A','B'].includes(n.text));
    const marks=elements(scene,variant==='dots'?'circle':'path').filter(n=>n.meta?.kind==='cell');
    for(const mark of marks){
      const header=headers.find(n=>n.text===mark.meta.column);
      const cx=variant==='dots'?Number(mark.attrs.cx):Number(mark.attrs.d.match(/^M\s*([-\d.]+)/)[1]);
      assert.ok(Math.abs(cx-Number(header.attrs.x))<0.5,`${variant} ${width}: ${mark.meta.row}/${mark.meta.column} is centered under its header`);
    }
  }
  const field={chart:'waffle',variant:'field',data:[{c:'Alpha',v:3},{c:'Beta',v:2},{c:'Gamma',v:1}],encode:{category:'c',value:'v'}};
  for(const theme of Object.keys(themes)){
    const bg=K.util.context({theme}).palette.bg;
    const labels=elements(K.layout(field,{width:558,theme}),'text').filter(n=>n.meta?.kind==='category');
    assert.deepEqual(plain([...new Set(labels.map(n=>n.meta.label))]),['Alpha','Beta','Gamma']);
    for(const label of labels)assert.ok(K.util.contrast(hexIn(label.attrs.fill),bg)>=4.5,`${theme}: ${label.text}`);
  }
});
