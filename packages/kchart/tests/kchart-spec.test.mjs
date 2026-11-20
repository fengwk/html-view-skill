// KChart 基础契约：设计样例、严格语义校验、重复 JSON 属性定位与生成schema。
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as spec from '../src/chart/spec.js';
import * as catalog from '../src/chart/catalog.js';
import { createRenderer } from '../dist/esm/node.js';

const K = { ...spec, ...catalog };
const examples = JSON.parse(readFileSync(new URL('./kchart-examples.json', import.meta.url), 'utf8'));
const plain = value => JSON.parse(JSON.stringify(value));

test('30设计样例严格按expect验证', () => {
  // 设计样例作为完整契约回归，验证负例不会因弱化语义而误通过。
  assert.equal(examples.cases.length, 30);
  for (const c of examples.cases) {
    const result = K.validate(c.spec);
    assert.equal(result.errors.length === 0, c.expect === 'accept', `${c.name}: ${JSON.stringify(plain(result.errors))}`);
    assert.equal(result.data === null, c.expect === 'reject', `${c.name}: result data null state`);
  }
});

test('parse发现重复JSON属性并返回JSON Pointer和源码位置', () => {
  // JSON.parse本身会吞掉重复键；专用扫描必须在解析前定位并拒绝它。
  const result = K.parse('{\n  "chart":"bar",\n  "data":[],\n  "chart":"line"\n}');
  assert.equal(result.data, null);
  assert.equal(result.errors[0].path, '/chart');
  assert.deepEqual(plain(result.errors[0].location), { offset: 34, line: 4, column: 3 });
});

test('严格语义拒绝非法时间、重复身份、无效守恒与树值不守恒', () => {
  // 日期、身份及守恒均不可由布局猜测或自动修正。
  const invalidDate = K.validate({chart:'line',data:[{d:'2025-02-29',v:1}],encode:{category:'d',value:'v'},fields:{d:{type:'date'}}});
  assert.ok(invalidDate.errors.some(e => e.path === '/data/0/d'));
  const duplicateIds = K.validate({chart:'scatter',data:[{x:1,y:2,id:'same'},{x:2,y:3,id:'same'}],encode:{x:'x',y:'y',id:'id'}});
  assert.ok(duplicateIds.errors.some(e => e.message.includes('重复身份')));
  const unbalanced = K.validate({chart:'sankey',data:{nodes:[{id:'a'},{id:'b'},{id:'c'}],edges:[{source:'a',target:'b',value:10},{source:'b',target:'c',value:9}]}});
  assert.ok(unbalanced.errors.some(e => e.message.includes('不守恒')));
  const cyclic = K.validate({chart:'sankey',data:{nodes:[{id:'a'},{id:'b'}],edges:[{source:'a',target:'b',value:3},{source:'b',target:'a',value:3}]}});
  assert.ok(cyclic.errors.some(e => e.message.includes('DAG')));
  const tree = K.validate({chart:'treemap',data:{label:'总计',value:10,children:[{label:'A',value:7},{label:'B',value:5}]}});
  assert.ok(tree.errors.some(e => e.message.includes('合计')));
});

test('拒绝图型专用字段越界、单位歧义、错误日期与不允许的缺失值', () => {
  // 这些限制保证不能通过宽松的共享字段表绕过逐图契约。
  const badVariant = K.validate({chart:'pie',variant:'hourglass',data:[{c:'A',v:1}],encode:{category:'c',value:'v'}});
  assert.ok(badVariant.errors.some(e => e.path === '/variant'));
  const ambiguousUnit = K.validate({chart:'bar',unit:'元',data:[{c:'A',v:0.5}],encode:{category:'c',value:'v'},fields:{v:{format:'percent'}}});
  assert.ok(ambiguousUnit.errors.some(e => e.path === '/unit'));
  const badDate = K.validate({chart:'calendar',period:'2025',data:[{d:'2025-02-30',v:1}],encode:{date:'d',value:'v'}});
  assert.ok(badDate.errors.some(e => e.path === '/data/0/d'));
  const missingBar = K.validate({chart:'bar',data:[{c:'A',v:null}],encode:{category:'c',value:'v'}});
  assert.ok(missingBar.errors.some(e => e.path === '/data/0/v'));
  const unsupported = K.validate({chart:'pie',color:'#f00',data:[{c:'A',v:1}],encode:{category:'c',value:'v'}});
  assert.ok(unsupported.errors.some(e => e.path === '/color'));
});

// HTML anchors are not chart fields; row identifiers still use the registered encode role.
test('根级 id 只报一次，encode.id 仍可标识记录', () => {
  const spec = { chart: 'line', data: [{ day: '1月', value: 3, row: 'first' }], encode: { category: 'day', value: 'value', id: 'row' } };
  assert.deepEqual(K.validate(spec).errors, []);
  const { errors } = K.validate({ ...spec, id: 'fig-trend' });
  assert.deepEqual(errors.map(({ path }) => path), ['/id']);
  assert.match(errors[0].fix, /encode\.id/);
});

test('正负值按图型和变体区分，small-multiples两种编码形式均正确', () => {
  // 普通比较保留有符号数据；只有声明的构成/符号变体及目标图才要求非负。
  for (const chart of ['line','area','bar','column']) {
    const r=K.validate({chart,data:[{c:'A',v:-2}],encode:{category:'c',value:'v'}});
    assert.equal(r.errors.length,0,`${chart} permits signed values`);
  }
  assert.equal(K.validate({chart:'dumbbell',data:[{c:'A',a:-2,b:3}],encode:{category:'c',before:'a',after:'b'}}).errors.length,0);
  assert.ok(K.validate({chart:'dumbbell',variant:'rungs',unitMark:{value:1,label:'1'},data:[{c:'A',a:-2,b:3}],encode:{category:'c',before:'a',after:'b'}}).errors.length);
  assert.ok(K.validate({chart:'bullet',data:[{c:'A',a:-2,t:3}],encode:{category:'c',actual:'a',target:'t'}}).errors.length);
  const wide=K.validate({chart:'small-multiples',data:[{x:'A',a:1,b:2}],encode:{category:'x',value:['a','b']}});
  const long=K.validate({chart:'small-multiples',data:[{x:'A',p:'P',v:1}],encode:{category:'x',panel:'p',value:'v'}});
  assert.equal(wide.errors.length,0);assert.equal(long.errors.length,0);
  assert.ok(K.validate({chart:'pie',data:[{c:'A',a:1,b:2}],encode:{category:'c',value:['a','b']}}).errors.length);
});

test('无效日期和损坏网络/路径数据稳定返回诊断而不抛异常', () => {
  // Date ISO 序列化边界和嵌套null都从公开validate入口安全返回errors。
  const invalidDate=K.validate({chart:'line',data:[{d:'2026-99-99',v:1}],encode:{category:'d',value:'v'},fields:{d:{type:'date'}}});
  assert.ok(invalidDate.errors.length);
  for(const spec of [
    {chart:'network',data:{nodes:[null],edges:[null]}},
    {chart:'sankey',data:{nodes:[null],edges:[null]}},
    {chart:'threads',data:{stages:[null],nodes:[null],paths:[null]}},
    {chart:'network',data:null},
  ]) assert.ok(Array.isArray(K.validate(spec).errors));
  const tree={chart:'tree',data:{label:'root'}};tree.data.children=[tree.data];
  assert.ok(K.validate(tree).errors.some(e=>e.message.includes('环')));
});

test('图族语义约束：funnel、gauge、tally、domain、统计密度、矩阵和箱连续性', () => {
  // 直接覆盖此前未被设计正例触达的图型专属语义，防止样例通过掩盖规则缺失。
  assert.ok(K.validate({chart:'funnel',data:[{c:'A',v:8},{c:'B',v:9}],encode:{category:'c',value:'v'}}).errors.length);
  assert.ok(K.validate({chart:'gauge',range:[0,10],data:[{v:11}],encode:{value:'v'}}).errors.length);
  assert.ok(K.validate({chart:'tally',data:[{c:'A',v:1.2}],encode:{category:'c',value:'v'},fields:{v:{format:'percent'}}}).errors.length);
  assert.ok(K.validate({chart:'radar',data:[{label:'A',a:1,b:2,c:3}],encode:{label:'label',dimensions:['a','b','c']},fields:{a:{domain:[0,2]},b:{domain:[0,3]},c:{domain:[0,4]}}}).errors.length===0);
  assert.ok(K.validate({chart:'violin',data:[{c:'A',d:[[0,0],[1,0]],m:.5}],encode:{category:'c',density:'d',median:'m'}}).errors.length);
  assert.ok(K.validate({chart:'histogram',data:[{a:0,b:1,n:1},{a:1.1,b:2,n:1}],encode:{lower:'a',upper:'b',count:'n'}}).errors.length);
  assert.ok(K.validate({chart:'heatmap',data:[{r:'A',c:'B',v:1},{r:'A',c:'B',v:2}],encode:{row:'r',column:'c',value:'v'}}).errors.length);
  assert.ok(K.validate({chart:'calendar',period:'2024',data:[{d:'2024-02-29',v:1},{d:'2024-02-29',v:2}],encode:{date:'d',value:'v'}}).errors.length);
});

test('身份注释/强调/排序、单位和字段数组限制真实校验', () => {
  // 引用只有命中已有字段/记录才有效；同轴度量与catalog数组契约不可绕过。
  const candle={chart:'candlestick',data:[{d:'x',o:2,c:3,l:1,h:4,id:'r'}],encode:{category:'d',open:'o',close:'c',low:'l',high:'h',id:'id'},annotations:[{kind:'note',record:'r',field:'c',text:'close'}]};
  assert.equal(K.validate(candle).errors.length,0);
  assert.ok(K.validate({...candle,annotations:[{kind:'note',record:'missing',field:'c',text:'x'}]}).errors.length);
  assert.ok(K.validate({chart:'bar',data:[{c:'A',v:1}],encode:{category:'c',value:'v',id:'id'},emphasis:{rows:['missing']}}).errors.length);
  assert.ok(K.validate({chart:'bar',data:[{c:'A',v:1},{c:'B',v:2}],encode:{category:'c',value:['v','v2']},sort:{field:'v',direction:'desc'}}).errors.length);
  assert.ok(K.validate({chart:'line',unit:'元',data:[{c:'A',a:1,b:2}],encode:{category:'c',value:['a','b']},fields:{a:{unit:'元'},b:{unit:'美元'}}}).errors.length);
  assert.ok(K.validate({chart:'pie',data:[{c:'A',v:1}],encode:{category:'c',value:'v'},fields:{v:{scale:'log'}}}).errors.length);
});

// 意图：emphasis 通过校验就必须改变绘制。曾经饼图、bullet、脑图等接受 emphasis 却画出完全相同的图，读者看不到重点。
test('emphasis passes validation only where it changes the drawing', () => {
  const R = createRenderer();
  const wide = [{c:'A',v:5,w:2,id:'a'},{c:'B',v:3,w:4,id:'b'},{c:'C',v:2,w:1,id:'c'}];
  const long = [{c:'A',s:'x',v:5},{c:'A',s:'y',v:2},{c:'B',s:'x',v:3},{c:'B',s:'y',v:4}];
  const kinds = [
    [wide, {category:'c',value:'v',id:'id'}, {rows:['b']}],
    [wide, {category:'c',value:['v','w']}, {fields:['w']}],
    [long, {category:'c',value:'v',series:'s'}, {series:['y']}],
  ];
  let drawn = 0;
  for (const chart of Object.keys(R.catalog)) for (const variant of [undefined, ...(R.catalog[chart].special?.variant || [])]) {
    const unitMark = ['rungs','pictorial'].includes(variant) ? {unitMark:{value:1,label:'1 个',...(variant === 'pictorial' ? {icon:'user'} : {})}} : {};
    for (const [data, encode, emphasis] of kinds) {
      const base = {chart, unit:'个', data, encode, ...(variant ? {variant} : {}), ...unitMark};
      if (R.validate(base).errors.length) continue;
      const valid = R.validate({...base, emphasis}).errors.length === 0;
      const changed = valid && R.render(base, {width:600}).svg !== R.render({...base, emphasis}, {width:600}).svg;
      assert.equal(valid, changed, `${chart} ${variant ?? 'default'} ${Object.keys(emphasis)[0]}`);
      if (valid) drawn += 1;
    }
  }
  assert.equal(drawn, 34, 'line, area, bar, column, share and funnel keep their drawn emphasis');
  const refused = [
    {chart:'bullet',data:[{c:'A',a:3,t:4,id:'a'}],encode:{category:'c',actual:'a',target:'t',id:'id'},emphasis:{rows:['a']}},
    {chart:'mindmap',data:{label:'root',children:[{id:'n',label:'node'}]},emphasis:{nodes:['n']}},
  ];
  for (const spec of refused) assert.ok(R.validate(spec).errors.some(error => error.path === '/emphasis'), spec.chart);
});

test('数量边界和schema按catalog严格分支', () => {
  // 图族上限是校验契约，schema必须与geo和special字段的运行时规则一致。
  const pie={chart:'pie',data:Array.from({length:7},(_,i)=>({c:`${i}`,v:1})),encode:{category:'c',value:'v'}};
  assert.ok(K.validate(pie).errors.length);
  const schema=plain(K.schema());
  const geo=schema.anyOf.find(x=>x.properties.chart.const==='choropleth');
  assert.equal(geo.properties.encode.type,'object');
  const combo=schema.allOf.find(x=>x.if.properties.chart.const==='combo');
  assert.ok(combo.then.required.includes('layers'));
  const calendar=schema.allOf.find(x=>x.if.properties.chart.const==='calendar');
  assert.ok(calendar.then.required.includes('period'));
  assert.equal(typeof K.validate({chart:'combo',data:[],encode:{category:'c'}}),'object');
});

test('排名缺口和显式时间起点通过公开校验，非法名次与重复时点拒绝', () => {
  // 排名缺失必须断线，时间起点不能被通用number校验误拒绝。
  const bump={chart:'bump',data:[{t:'Q1',s:'A',r:1},{t:'Q2',s:'A',r:null}],encode:{category:'t',series:'s',rank:'r'},fields:{t:{domain:['Q1','Q2','Q3']}}};
  assert.deepEqual(plain(K.validate(bump).errors),[]);
  assert.ok(K.validate({...bump,data:[{t:'Q1',s:'A',r:0}]}).errors.length);
  assert.ok(K.validate({...bump,data:[{t:'Q1',s:'A',r:1.5}]}).errors.length);
  assert.ok(K.validate({...bump,data:[bump.data[0],bump.data[0]]}).errors.length);
  const fan={chart:'launch-fan',data:[{n:'A',t:'2026-01-31',v:20}],encode:{label:'n',start:'t',value:'v'},fields:{t:{type:'date'}}};
  assert.deepEqual(plain(K.validate(fan).errors),[]);
  assert.ok(K.validate({...fan,fields:{}}).errors.length);
  assert.ok(K.validate({...fan,data:[{n:'A',t:'2026-02-30',v:20}]}).errors.length);
});

test('组合层数值和轴范围不能绕过语义校验', () => {
  // layers不是encode.value，仍须校验数值类型、字段单位与唯一性。
  const combo={chart:'combo',data:[{c:'A',v:2}],encode:{category:'c'},layers:[{mark:'line',field:'v',axis:'left'}],fields:{v:{type:'number',domain:[0,3]}}};
  assert.deepEqual(plain(K.validate(combo).errors),[]);
  assert.ok(K.validate({...combo,data:[{c:'A',v:'2'}]}).errors.length);
  assert.ok(K.validate({...combo,layers:[...combo.layers,...combo.layers]}).errors.length);
  assert.ok(K.validate({...combo,annotations:[{kind:'rule',field:'v',value:4}]}).errors.length);
  const bar={chart:'bar',data:[{c:'A',v:2}],encode:{category:'c',value:'v'},fields:{v:{domain:[1,3]}}};
  assert.ok(K.validate(bar).errors.length);
  assert.ok(K.validate({...bar,chart:'line',fields:{v:{scale:'log',domain:[0,3]}}}).errors.length);
});

test('schema从完整catalog动态枚举图型，不开放额外声明字段', () => {
  // schema与运行时catalog同源；额外字段不因schema生成而被隐式放行。
  const schema = plain(K.schema());
  assert.deepEqual(schema.properties.chart.enum.sort(), Object.keys(K.catalog).sort());
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.version, undefined);
  assert.equal(typeof K.parse, 'function');
  assert.equal(typeof K.validate, 'function');
});
