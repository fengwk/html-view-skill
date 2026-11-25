import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import vm from 'node:vm';
import { launchBrowser } from '../src/shared/browser.mjs';
import { aggregate, computeReport, displaySpec, fingerprint, resolveVizReference, validateReport } from '../src/artifacts/data/compute.mjs';
import { loadDataPackage } from '../src/artifacts/data/load.mjs';
import { bindText } from '../src/artifacts/data/bindings.mjs';
import { formatValue } from '../src/artifacts/data/format.mjs';

const dataset = {
  id:'monthly', periodField:'month', dimensions:{month:{type:'month'},channel:{type:'category'}}, total:{field:'channel',value:'All'},
  measures:{sales:{label:'Sales',unit:'USD',kind:'sum',definition:'Synthetic gross sales'},people:{label:'People',unit:'users',kind:'distinct',definition:'Pre-aggregated unique users'},orders:{label:'Orders',unit:'count',kind:'sum',definition:'Synthetic orders'},visits:{label:'Visits',unit:'count',kind:'sum',definition:'Synthetic visits'},rate:{label:'Rate',unit:'%',kind:'ratio',format:'percent',numerator:'orders',denominator:'visits',definition:'Orders divided by visits'},average:{label:'Average',unit:'USD',kind:'mean',numerator:'sales',denominator:'orders',definition:'Sales divided by orders'}},
};
const sharedFiles=['shell.mjs','viz.mjs','markdown.mjs','output.mjs','args.mjs'].map(name=>fileURLToPath(new URL(`../src/shared/${name}`,import.meta.url)));
const sharedReady=sharedFiles.every(existsSync);

function packageFixture() {
  return {
    title:'Synthetic monthly report',layout:'periodic',period:{current:'2026-10',compare:['mom'],timezone:'UTC',complete:true},
    sources:[{id:'s',name:'Synthetic source',pulledAt:'2026-11-01T00:00:00Z'}],
    datasets:[{id:'monthly',file:'data.csv',source:'s',periodField:'month',dimensions:{month:{type:'month',label:'Month'},channel:{type:'category',label:'Channel'}},measures:{sales:{label:'Sales',unit:'USD',kind:'sum',definition:'Synthetic sales'},people:{label:'People',unit:'users',kind:'distinct',definition:'Synthetic unique users'},orders:{label:'Orders',unit:'count',kind:'sum',definition:'Synthetic orders'},visits:{label:'Visits',unit:'count',kind:'sum',definition:'Synthetic visits'},rate:{label:'Rate',unit:'%',kind:'ratio',format:'percent',numerator:'orders',denominator:'visits',definition:'Synthetic conversion'}},total:{field:'channel',value:'All'}}],
    blocks:[{type:'chart',id:'trend',dataset:'monthly',chart:'line',encode:{category:'month',value:'sales'},title:'Synthetic sales'},{type:'kpi',dataset:'monthly',measures:['sales','people','rate']},{type:'table',dataset:'monthly',columns:['month','channel','sales']},{type:'text',file:'narrative.md'}],
    views:[{id:'web',label:'Web',filters:{monthly:{channel:'web'}}}],
  };
}

async function createPackage(t) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'hv-data-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const report=packageFixture();
  const rows=[
    {month:'2026-08',channel:'All',sales:80,people:16,orders:8,visits:80},{month:'2026-08',channel:'web',sales:80,people:9,orders:8,visits:80},
    {month:'2026-10',channel:'All',sales:100,people:20,orders:10,visits:100},{month:'2026-10',channel:'web',sales:70,people:13,orders:7,visits:50},{month:'2026-10',channel:'store',sales:30,people:12,orders:3,visits:50},
  ];
  const reportPath=path.join(dir,'report.json');
  await writeFile(reportPath,JSON.stringify(report));
  await writeFile(path.join(dir,'data.csv'),`month,channel,sales,people,orders,visits\n${rows.map(r=>Object.values(r).join(',')).join('\n')}\n`);
  await writeFile(path.join(dir,'narrative.md'),'### Synthetic narrative\n\nSynthetic narrative body.\n\nRevenue is {{sales.value}}; rate is {{rate.value}}.\n\n```kchart\n{"ref":"trend"}\n```\n');
  return {dir,reportPath};
}

test('sum refuses partial totals; distinct cannot be added; ratio and mean derive from sum inputs', () => {
  const issues=[];
  const rows=[{month:'2026-10',channel:'web',sales:40,people:10,orders:4,visits:20},{month:'2026-10',channel:'store',sales:null,people:8,orders:6,visits:30}];
  assert.equal(aggregate(dataset,'sales',rows,'sales',issues).status,'incomplete');
  assert.equal(aggregate(dataset,'people',rows,'people',issues).status,'invalid');
  const derived=aggregate(dataset,'rate',[
    {month:'2026-10',channel:'All',sales:120,people:20,orders:10,visits:100,rate:999,average:999},
    {month:'2026-10',channel:'web',sales:120,people:10,orders:10,visits:100},
  ],'rate',issues);
  assert.equal(derived.value,0.1);
  const mean=aggregate(dataset,'average',[{month:'2026-10',channel:'All',sales:120,orders:10}],'average',issues);
  assert.equal(mean.value,12);
  assert.ok(issues.some(i=>i.code==='INCOMPLETE_TOTAL'));
  assert.ok(issues.some(i=>i.code==='BAD_KIND'));
});

// 意图：文档列出的 sample / partOfWhole 只给提示、不改数；未列出的旧字段被拒绝。
test('sample and partOfWhole ratios warn about small bases and rounded shares without changing values', () => {
  const report=packageFixture();
  const spec={label:'Share',unit:'%',kind:'ratio',numerator:'orders',denominator:'visits',definition:'Synthetic share',sample:true,partOfWhole:true};
  report.datasets[0].measures.share=spec;
  const rows=[{month:'2026-10',channel:'All',sales:3,people:3,orders:3,visits:9},...['a','b','c'].map(channel=>({month:'2026-10',channel,sales:1,people:1,orders:1,visits:3}))];
  const {metrics,issues}=computeReport(report,[{...report.datasets[0],rows}]);
  assert.equal(metrics.monthly.share.value,1/3);
  const hint=code=>issues.find(item=>item.code===code)?.severity;
  assert.equal(hint('SMALL_BASE'),'hint','a sampled ratio over 9 visits is flagged as a small base');
  assert.equal(hint('SHARE_SUM'),'hint','three shares of 33.3% sum to 99.9%');
  report.datasets[0].measures.share={...spec,partOfWhole:undefined,composition:true};
  assert.ok(validateReport(report).issues.some(item=>item.code==='BAD_SCHEMA'&&item.where.endsWith('share.composition')),'undocumented aliases are rejected');
});

test('additive snapshot uses total rows, never invents zero, and rejects incomplete or duplicate totals', () => {
  const additive={id:'stock',dimensions:{month:{type:'month'},channel:{type:'category'}},total:{field:'channel',value:'All'},measures:{stock:{label:'Stock',unit:'%',kind:'snapshot',additive:true,format:'percent',definition:'Synthetic snapshot'}}};
  const total=aggregate(additive,'stock',[{month:'2026-10',channel:'All',stock:0.14}],'stock',[]);
  assert.equal(total.value,0.14,'a declared total is reused when no component rows exist');
  const noRows=aggregate(additive,'stock',[],'stock',[]);assert.equal(noRows.status,'missing');assert.equal(noRows.value,null);
  const issues=[],missing=aggregate(additive,'stock',[{month:'2026-10',channel:'web',stock:0.1},{month:'2026-10',channel:'store',stock:null}],'stock',issues);
  assert.equal(missing.status,'incomplete');assert.equal(missing.value,null);assert.ok(issues.some(item=>item.code==='INCOMPLETE_TOTAL'));
  const duplicateIssues=[],duplicate=aggregate(additive,'stock',[{month:'2026-10',channel:'All',stock:0.14},{month:'2026-10',channel:'All',stock:0.14}],'stock',duplicateIssues);
  assert.equal(duplicate.status,'invalid');assert.equal(duplicate.value,null);assert.ok(duplicateIssues.some(item=>item.code==='DUPLICATE_KEY'));
});

test('data protocol requires layout and KChart chart+encode; legacy type and chart columns/data are rejected', () => {
  const base={title:'Synthetic',period:{current:'2026-10',compare:[],timezone:'UTC',complete:true},sources:[{id:'s',name:'Synthetic',pulledAt:'2026-11-01T00:00:00Z'}],datasets:[dataset],blocks:[],views:[]};
  assert.ok(validateReport({...base,type:'periodic'}).issues.some(i=>i.where==='type'));
  assert.ok(validateReport({...base,layout:'periodic',views:[{id:'web',filters:{}},{id:'web',filters:{}}]}).issues.some(i=>i.where==='views[1].id'),'view ids must be unique because tab/section references are global');
  assert.ok(validateReport({...base,layout:'periodic',blocks:[{type:'chart',dataset:'monthly',chart:'line',columns:['month','sales']}]}).issues.some(i=>i.message.includes('旧 columns')));
  assert.ok(validateReport({...base,layout:'periodic',blocks:[{type:'chart',dataset:'monthly',chart:'line',encode:{category:'month',value:'sales'},unit:'USD'}]}).issues.some(i=>i.where==='blocks[0].unit'));
  assert.ok(validateReport({...base,layout:'periodic',datasets:[{...dataset,measures:{...dataset.measures,rate:{...dataset.measures.rate,format:'number',unit:'%'}}}]}).issues.some(i=>i.where==='datasets[0].measures.rate.format'),'percentage values cannot declare a conflicting numeric display format');
  assert.equal(displaySpec({kind:'mean',unit:'%',format:'percent'}).format,'percent');
  assert.equal(displaySpec({kind:'snapshot',unit:'%',format:'percent'}).format,'percent');
});

test('report readouts share compact unit boundaries and round decimal ties from their decimal representation', () => {
  // 报表仍保留指标显示精度；舍入进位使用图表的统一万／K 边界。
  assert.equal(formatValue(9999.995, { unit: '元' }), '1.0万元');
  assert.equal(formatValue(9999.995, { lang: 'en', unit: 'USD' }), '10.0K USD');
  assert.equal(formatValue(0.1005, { format: 'percent' }), '10.1%');
  assert.equal(formatValue(-0.001), '0');
});

test('narrative token binding preserves raw evidence, percent formatting, and unbound-number hints', () => {
  const computed={datasets:[{id:'monthly'}],views:[{id:'all',datasets:{monthly:{sales:{dataset:'monthly',measure:'sales',value:100,unit:'USD',format:'number',displaySpec:{format:'number',unit:'USD'},comparisons:{mom:{status:'ok',mode:'relative',direction:'up',current:100,baseline:80,delta:20,rate:0.25}}},rate:{dataset:'monthly',measure:'rate',value:0.125,unit:'%',format:'percent',displaySpec:{format:'percent',unit:'%',decimals:1},comparisons:{}}}}}]};
  const result=bindText('Sales {{sales.value}}; {{sales.mom_text}}; rate {{rate.value}}; observed 17.',computed,{view:'all',lang:'zh-CN'});
  assert.match(result.text,/Sales 100/);assert.match(result.text,/增长 25.0%/);assert.match(result.text,/12.5%/);
  assert.ok(result.bindings.every(item=>item.raw!==undefined&&item.display));
  assert.ok(result.issues.some(item=>item.code==='UNBOUND_NUMBER'&&item.severity==='hint'));
  assert.ok(bindText('来源：10 个来源，不做裸数字提示',computed).issues.every(item=>item.code!=='UNBOUND_NUMBER'));
  assert.ok(bindText('{{unknown.value}}',computed).issues.some(item=>item.code==='UNKNOWN_TOKEN'&&item.severity==='error'));
  // 叙述里的绝对数和表格一样写原值：38,760 不能变成「3.9万」，否则与同段手写的精确数对不上。
  const big={...computed,views:[{id:'all',datasets:{monthly:{loans:{dataset:'monthly',measure:'loans',value:38760,displaySpec:{format:'number'},comparisons:{}},per:{dataset:'monthly',measure:'per',value:90.5,displaySpec:{format:'number'},comparisons:{}}}}}]};
  assert.equal(bindText('{{loans.value}} / {{per.value}}',big,{view:'all',lang:'zh-CN'}).text.replace(/<[^>]+>/g,''),'38,760 / 90.50');
});

test('malformed package roots return schema issues instead of throwing', async t => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'hv-data-invalid-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'report.json');await writeFile(file,'[]');
  const {validatePackage}=await import('../src/artifacts/data/index.mjs');
  const result=await validatePackage(file);assert.equal(result.pass,false);assert.equal(result.issues[0].code,'BAD_SCHEMA');
});

test('data package paths cannot escape the package root', async t => {
  const {reportPath}=await createPackage(t),report=JSON.parse(await readFile(reportPath,'utf8'));
  report.datasets[0].file='../outside.csv';await writeFile(reportPath,JSON.stringify(report));
  await assert.rejects(()=>loadDataPackage(reportPath),error=>error.code==='BAD_PATH'&&error.file==='../outside.csv');
});

test('CSV accepts quoted cells at LF and CRLF row boundaries and preserves multiline fields', async t => {
  // 导出工具可以给末列加引号；引号内的逗号、双引号与换行仍属于同一字段。
  const { dir, reportPath } = await createPackage(t);
  await writeFile(path.join(dir, 'data.csv'), [
    'month,channel,sales,people,orders,"visits"\r\n',
    '2026-10,"Web, ""Direct""\nCampaign",85,11,10,"100"\n',
    '2026-10,store,15,9,3,"20"\r\n',
  ].join(''));
  const { datasets, issues } = await loadDataPackage(reportPath);
  assert.deepEqual(issues, []);
  assert.deepEqual(datasets[0].rows.map(({ channel, visits }) => [channel, visits]), [
    ['Web, "Direct"\nCampaign', 100], ['store', 20],
  ]);
});

test('percent mean and snapshot share one display contract across KPI, table, chart, and narrative', async t => {
  const {dir,reportPath}=await createPackage(t),report=JSON.parse(await readFile(reportPath,'utf8'));
  const measures=report.datasets[0].measures;
  measures.percent_numerator={label:'Percent numerator',unit:'count',kind:'sum',definition:'Synthetic percent numerator'};
  measures.percent_denominator={label:'Percent denominator',unit:'count',kind:'sum',definition:'Synthetic percent denominator'};
  measures.mean_percent={label:'Mean percent',unit:'%',kind:'mean',format:'percent',numerator:'percent_numerator',denominator:'percent_denominator',definition:'Synthetic mean ratio'};
  measures.snapshot_percent={label:'Snapshot percent',unit:'%',kind:'snapshot',format:'percent',definition:'Synthetic monthly percent snapshot'};
  measures.empty_percent={label:'Missing percent',unit:'%',kind:'snapshot',format:'percent',definition:'Synthetic missing snapshot'};
  const csvPath=path.join(dir,'data.csv'),lines=(await readFile(csvPath,'utf8')).trimEnd().split('\n');
  lines.push('2026-08,store,0,7,0,50','2026-09,All,0,0,0,0','2026-09,web,0,0,0,0','2026-09,store,0,0,0,0');
  lines[0]+=',percent_numerator,percent_denominator,snapshot_percent,empty_percent';
  const values={'2026-08|All':['10','100','0.10',''],'2026-08|web':['7','50','0.14',''],'2026-08|store':['3','50','0.06',''],'2026-09|All':['10','100','0.10',''],'2026-09|web':['5','50','0.10',''],'2026-09|store':['5','50','0.10',''],'2026-10|All':['14','100','0.14',''],'2026-10|web':['7','50','0.14',''],'2026-10|store':['7','50','0.14','']};
  const oldHead=lines[0].split(',').slice(0,-4);
  for(let i=1;i<lines.length;i++){const fields=lines[i].split(','),key=`${fields[oldHead.indexOf('month')]}|${fields[oldHead.indexOf('channel')]}`;lines[i]+=` ,${values[key].join(',')}`;lines[i]=lines[i].replace(' ,',',');}
  await writeFile(csvPath,`${lines.join('\n')}\n`);
  report.blocks.find(block=>block.type==='kpi').measures.push('mean_percent','snapshot_percent','empty_percent');
  report.blocks.find(block=>block.type==='table').columns.push('mean_percent','snapshot_percent','empty_percent');
  report.blocks.push({type:'chart',id:'mean-percent-trend',dataset:'monthly',chart:'line',encode:{category:'month',value:'mean_percent'},title:'Synthetic percent trend'});
  await writeFile(path.join(dir,'narrative.md'),'### Synthetic narrative\n\nMean {{mean_percent.value}}, point delta {{mean_percent.mom_delta}}; missing {{empty_percent.value}}.\n');
  await writeFile(reportPath,JSON.stringify(report));
  const {buildPackage,audit}=await import('../src/artifacts/data/index.mjs'),out=path.join(dir,'percent.html'),built=await buildPackage(reportPath,out);
  assert.equal(built.ok,true,JSON.stringify(built));assert.notEqual(built.pass,false,JSON.stringify(built));
  const html=await readFile(out,'utf8');assert.ok((html.match(/14\.0%<\/span>/g)||[]).length>=3,'KPI, current table cells, and bindings all show 0.14 as 14.0%');
  assert.ok(html.includes('提高 4.0 个百分点'),'percent mean mom_delta follows percentage-point comparison semantics');
  assert.match(html,/data-value=""[^>]*data-measure="monthly\.empty_percent"/,'missing value evidence uses the same empty data-value representation as null evidence');
  const {collectViz}=await import('../src/shared/viz.mjs'),chart=collectViz(html).map(item=>JSON.parse(item.source)).find(spec=>spec.encode?.value==='mean_percent');
  assert.equal(chart.fields.mean_percent.format,'percent','KChart receives the same displaySpec as KPI/table');
  assert.deepEqual((await audit(html)).failures,[]);
});

test('period-less summary datasets use every row, skip period comparisons, and tables show exact values under period-aware headings', async t => {
  // 上半年分类合计没有月份列：不能被当前月筛空，也不能编出环比；明细表要能逐格核对原值。
  const {dir,reportPath}=await createPackage(t),report=JSON.parse(await readFile(reportPath,'utf8'));
  report.datasets[0].label='Monthly channels';
  report.datasets.push({id:'summary',label:'Half-year categories',file:'summary.csv',source:'s',periodField:null,dimensions:{category:{type:'category',label:'Category'}},measures:{loans:{label:'Loans',unit:'count',kind:'sum',definition:'Synthetic half-year loans'}}});
  report.blocks.push({type:'kpi',dataset:'summary',measures:['loans']},{type:'table',dataset:'summary',columns:['category','loans']});
  await writeFile(reportPath,JSON.stringify(report));
  await writeFile(path.join(dir,'summary.csv'),'category,loans\nPicture books,58010\nFiction,53680\n');
  const loaded=await loadDataPackage(reportPath),computed=computeReport(loaded.report,loaded.datasets);
  assert.deepEqual([...loaded.issues,...computed.issues].filter(i=>i.severity!=='hint'),[]);
  assert.equal(computed.metrics.summary.loans.value,111690,'all rows count when the dataset has no period dimension');
  assert.deepEqual(computed.metrics.summary.loans.comparisons,{},'no month-over-month value is invented for a period-less dataset');
  const {buildPackage}=await import('../src/artifacts/data/index.mjs'),out=path.join(dir,'summary.html'),built=await buildPackage(reportPath,out);
  assert.equal(built.ok,true,JSON.stringify(built));
  const html=await readFile(out,'utf8');
  assert.match(html,/<h2>Half-year categories<\/h2>/,'period-less table is titled by its dataset label without a month');
  assert.match(html,/<h2>Monthly channels \(2026-10\)<\/h2>/,'periodic table states which month its rows belong to, in the inferred report language');
  assert.match(html,/>58,010<\/span>/,'table cells keep exact grouped values instead of compact 万/K forms');
  assert.doesNotMatch(html,/>5\.8万<\/span><\/td>/);
  // 数字列右对齐才能按位比较；维度列保持左对齐。
  assert.match(html,/<th scope="col">Category<\/th><th scope="col" class="num">Loans \(count\)<\/th>/,'only measure headers align with their numbers');
  assert.match(html,/<td>Picture books<\/td><td class="num" data-sort="58010"/,'measure cells are right-aligned numbers; dimension cells are not');
  assert.ok(validateReport({...report,datasets:[{...report.datasets[1],periodField:''}]}).issues.some(i=>i.where==='datasets[0].periodField'),'empty strings are still rejected; only null opts out of the period dimension');
});

// 意图：叙述里指向存在文件的相对链接按产物位置改写，找不到的原样保留；改写发生在取指纹前，audit 仍通过。
test('narrative relative links are rewritten for an output in another directory', async t => {
  const {dir,reportPath}=await createPackage(t);
  await writeFile(path.join(dir,'notes.md'),'# Notes\n');
  await writeFile(path.join(dir,'narrative.md'),'### Synthetic narrative\n\nSee [notes](notes.md#top) and [gone](gone.md).\n');
  const {buildPackage,audit}=await import('../src/artifacts/data/index.mjs'),out=path.join(dir,'out','report.html'),built=await buildPackage(reportPath,out);
  assert.equal(built.ok,true,JSON.stringify(built));
  const html=await readFile(out,'utf8');
  assert.match(html,/<a href="\.\.\/notes\.md#top">notes<\/a>/);
  assert.match(html,/<a href="gone\.md">gone<\/a>/);
  assert.deepEqual((await audit(html)).failures,[]);
});

test('narrative HTML that audit would reject fails validate, so build never writes it', async t => {
  // 曾经只拦 script/style/link：带事件属性或外部图片的片段会被写进报表，直到 audit 才发现。
  const {dir,reportPath}=await createPackage(t);
  await writeFile(path.join(dir,'narrative.md'),'### Synthetic narrative\n\n<div onclick="x()">Click</div>\n\n<img src="https://example.com/a.png" alt="">\n');
  const {validatePackage,buildPackage}=await import('../src/artifacts/data/index.mjs');
  const checked=await validatePackage(reportPath);
  assert.equal(checked.pass,false);
  const details=checked.issues.filter(item=>item.code==='BAD_TEXT').map(item=>item.message).join('\n');
  assert.match(details,/EVENT_ATTRIBUTE/);assert.match(details,/EXTERNAL_RESOURCE/);
  const out=path.join(dir,'blocked.html'),built=await buildPackage(reportPath,out);
  assert.equal(built.pass,false);assert.equal(existsSync(out),false);
});

test('narrative reference is only an exact ref to a declared KChart block', () => {
  const charts=new Map([['revenue',{chart:'line',data:[],encode:{}}]]);
  assert.equal(resolveVizReference('{"ref":"revenue"}',charts),'revenue');
  for(const source of ['not json','{"ref":"missing"}','{"ref":"revenue","data":[]}']) assert.throws(()=>resolveVizReference(source,charts),e=>e.code==='BAD_TEXT');
});

test('pre-aggregated package retains view guards, calendar comparison and missing-month nulls', async t => {
  const {reportPath}=await createPackage(t);
  const loaded=await loadDataPackage(reportPath);
  const computed=computeReport(loaded.report,loaded.datasets);
  assert.deepEqual([...loaded.issues,...computed.issues].filter(i=>i.severity!=='hint'),[]);
  assert.equal(computed.views[1].datasets.monthly.people.value,13,'view filters retain one pre-aggregated distinct value rather than add categories');
  assert.equal(computed.metrics.monthly.sales.comparisons.mom.status,'missing_base','comparison uses calendar month rather than previous file row');
  assert.deepEqual(computed.blocks[0].spec.data.map(row=>row.month),['2026-08','2026-09','2026-10']);
  assert.deepEqual(computed.blocks[0].spec.data.filter(row=>row.sales!=null).map(row=>row.sales),[80,100],'encoded total dimension reads its unique total row without double-counting parts');
  assert.equal(computed.blocks[0].spec.data[1].sales,null,'missing period is a null break, not an inferred zero');
  assert.equal(fingerprint('x').length,64);
});

test('report gutters and mobile KPI grid stay inside the viewport at desktop and mobile widths', async t => {
  const {dir,reportPath}=await createPackage(t),{buildPackage}=await import('../src/artifacts/data/index.mjs'),file=path.join(dir,'layout.html');
  assert.equal((await buildPackage(reportPath,file)).ok,true);
  const browser=await launchBrowser();t.after(()=>browser.close());const page=await browser.newPage();t.after(()=>page.close());await page.goto(new URL(`file://${file}`).href);
  for(const width of [1280,390]){
    await page.setViewport({width,height:844});await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const result=await page.json(`JSON.stringify((()=>{const main=document.querySelector('body > main'),rect=main.getBoundingClientRect(),cards=[...document.querySelectorAll('[data-view-section]:not([hidden]) [data-kpis] > .data-kpi')];return{width:innerWidth,documentWidth:document.documentElement.scrollWidth,left:rect.left,right:rect.right,columns:getComputedStyle(document.querySelector('[data-view-section]:not([hidden]) [data-kpis]')).gridTemplateColumns,gridWidth:document.querySelector('[data-view-section]:not([hidden]) [data-kpis]').clientWidth,cards:cards.map(card=>({overflow:card.scrollWidth>card.clientWidth,font:parseFloat(getComputedStyle(card.querySelector('.data-kpi-value')).fontSize),width:card.offsetWidth,top:card.offsetTop}))};})())`);
    assert.ok(result.left>=12&&result.right<=width-12,`${width}px layout retains visible horizontal gutters: ${JSON.stringify(result)}`);
    assert.ok(result.documentWidth<=width,`${width}px report has no document-level horizontal overflow`);
    assert.ok(result.cards.length>0&&result.cards.every(card=>!card.overflow&&card.font>=12),`${width}px KPI cards fit and remain at least 12px: ${JSON.stringify(result.cards)}`);
    if(width===390){
      assert.equal(result.columns.split(' ').length,2,'three mobile KPIs use a two-column grid rather than overflowing a desktop row');
      // 单数个 KPI 时最后一张占满一行，不在右侧留下空格。
      const [first,,last]=result.cards;
      assert.ok(last.top>first.top&&last.width===result.gridWidth,`the odd last KPI spans the row: ${JSON.stringify(result)}`);
    }
  }
  // 视图名要跟着首个内容块，但剩余版心可容纳两者时不强制另起一页。
  await page.setMedia('print');
  const breaks=await page.json(`JSON.stringify([...document.querySelectorAll('[data-view-section]')].map(view=>[getComputedStyle(view).breakBefore,getComputedStyle(view.querySelector('.data-view-heading')).breakAfter]))`);
  assert.deepEqual(breaks,[['auto','avoid'],['auto','avoid']]);
});

test('dashboard cards occupy complete grid rows and measure their actual column widths', async (t) => {
  // 三张图保留原次序：不能把居中的趋势图提升为整行，在前后留下两个空位。
  const { dir, reportPath } = await createPackage(t);
  const { buildPackage, audit } = await import('../src/artifacts/data/index.mjs');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  report.layout = 'dashboard';
  const trend = { ...report.blocks[0], subtitle: 'Synthetic aggregate · USD' };
  const comparison = { ...trend, encode: { category: 'channel', value: 'sales' } };
  report.blocks.splice(0, 1, { ...comparison, id: 'bars', chart: 'bar' }, trend, { ...comparison, id: 'columns', chart: 'column' });
  await writeFile(reportPath, JSON.stringify(report));
  // 叙述引用的图会移到叙述里；这里只测网格，叙述不引用图。
  await writeFile(path.join(dir, 'narrative.md'), '### Synthetic narrative\n\nRevenue is {{sales.value}}.\n');
  const file = path.join(dir, 'dashboard.html');
  const result = await buildPackage(reportPath, file);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.notEqual(result.pass, false, JSON.stringify(result));
  assert.deepEqual((await audit(await readFile(file, 'utf8'))).failures, []);
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.goto(new URL(`file://${file}`).href);
  for (const width of [1280, 390]) {
    await page.setViewport({ width, height: 844 });
    const layout = await page.json(`(async () => {
      await HtmlViewViz.relayout();
      const grid = document.querySelector('[data-view-section="all"] [data-chart-grid]');
      return JSON.stringify({
        gridWidth: grid.clientWidth,
        cards: [...grid.children].map(cell => {
          const figure = cell.querySelector('.viz-figure'), body = figure?.querySelector('.viz-body'), svg = body?.querySelector('svg');
          const chart = svg?.getBoundingClientRect(), plot = body?.getBoundingClientRect();
          return {
            top: cell.offsetTop, width: cell.clientWidth, card: figure?.clientWidth,
            svg: chart?.width, svgWidth: Number(svg?.getAttribute('width')),
            plotVisible: plot?.bottom >= chart?.bottom,
            captionHeight: figure?.querySelector('figcaption').clientHeight,
          };
        }),
      });
    })()`);
    const [first, second, third] = layout.cards;
    assert.ok(layout.cards.every(card => card.width === card.card && card.svg === card.svgWidth && card.svg > 0), JSON.stringify(layout));
    assert.ok(layout.cards.every(card => card.plotVisible && card.captionHeight <= 68), JSON.stringify(layout));
    assert.equal(third.width, layout.gridWidth);
    if (width === 1280) {
      assert.equal(first.width, second.width);
      assert.equal(first.top, second.top);
      assert.ok(third.top > second.top);
    } else {
      assert.ok(layout.cards.every(card => card.width === layout.gridWidth));
      assert.ok(first.top < second.top && second.top < third.top);
    }
  }
});

test('view runtime switches existing precomputed sections and sorts numeric cells with nulls last', async () => {
  const source=await readFile(new URL('../../assets/page/data.js',import.meta.url),'utf8'),handlers={},relayout=[];
  const tab=view=>({dataset:{viewTab:view},attrs:{},tabIndex:view==='all'?0:-1,setAttribute(k,v){this.attrs[k]=v;},addEventListener(type,fn){handlers[`tab:${view}:${type}`]=fn;},focus(){this.focused=true;}});
  const tabs=[tab('all'),tab('web')],sections=[{dataset:{viewSection:'all'},hidden:false},{dataset:{viewSection:'web'},hidden:true}];
  const header={attrs:{},getAttribute(k){return this.attrs[k]||'none';},setAttribute(k,v){this.attrs[k]=v;},addEventListener(type,fn){handlers[`sort:${type}`]=fn;}};
  const row=(label,number)=>({cells:[{textContent:label,getAttribute(name){return name==='data-sort'?String(number??''):name==='data-sort-null'?String(number==null):null;}}]});
  const body={rows:[row('100',100),row('2',2),row('—',null)],append(item){this.rows=this.rows.filter(existing=>existing!==item);this.rows.push(item);}};
  const table={tHead:{rows:[{cells:[header]}]},tBodies:[body]};
  const root={documentElement:{lang:'en',dataset:{}},fonts:{ready:Promise.resolve()},querySelectorAll(selector){return selector==='[data-view-tab]'?tabs:selector==='[data-view-section]'?sections:selector==='table[data-sortable]'?[table]:[];}};
  const context={document:root,HtmlViewViz:{relayout(){relayout.push('layout');return Promise.resolve();}}};
  vm.runInNewContext(source,context);await new Promise(resolve=>setImmediate(resolve));
  assert.ok(relayout.length>0,'runtime starts and asks the figure host to lay out visible sources');
  handlers['tab:web:click']();assert.deepEqual(sections.map(item=>item.hidden),[true,false]);
  assert.deepEqual(tabs.map(item=>item.attrs['aria-selected']),['false','true']);
  handlers['sort:click']();assert.deepEqual(body.rows.map(item=>item.cells[0].textContent),['2','100','—']);
});

test('shared index integration enforces shell/viz/data integrity gates', {skip:sharedReady ? false : 'shared shell/viz/markdown/output/args contracts are not merged into this worktree'}, async t => {
  const {commands,audit,parts,style,buildPackage}=await import('../src/artifacts/data/index.mjs');
  assert.deepEqual(Object.keys(commands),['init','validate','build']);
  assert.equal(typeof audit,'function'); assert.equal(typeof parts,'function'); assert.equal(typeof style,'function');
  const {dir,reportPath}=await createPackage(t), out=path.join(dir,'report.html');
  const build=await buildPackage(reportPath,out);
  assert.equal(build.ok,true,JSON.stringify(build));
  assert.notEqual(build.pass,false,JSON.stringify(build));
  const html=await readFile(out,'utf8');
  assert.deepEqual((await audit(html)).failures,[]);
  const langTampered=html.replace(/<html lang="([^"]+)"/,(match,lang)=>`<html lang="${lang==='zh-CN'?'en-US':'zh-CN'}"`);
  assert.notEqual(langTampered,html,'language tamper fixture must change the shell');
  assert.ok((await audit(langTampered)).failures.some(item=>item.code==='EVIDENCE_LANGUAGE_MISMATCH'),'audited language must match language recorded in data evidence');
  assert.match(html,/Revenue is <span data-evidence="e\d+"[^>]*>100<\/span>/,'narrative tokens are formatted and carry tamper-evident bindings');
  assert.ok(html.includes('14.0%'),'per-view ratio is recalculated from the filtered pre-aggregated orders/visits row');
  assert.ok(html.includes('data-view-tab="web"'),'static view is present alongside all-data view');
  assert.equal(parts(html).length,4,'diff parts split views, source metadata, and report header');
  // 叙述引用的图只画在引用处：每个视图里同一张图不重复。
  for(const view of html.split('data-view-section=').slice(1))assert.deepEqual(view.match(/<pre data-viz="kchart" id="[^"]+"/g).map(tag=>/narrative-/.test(tag)),[true],'the referenced chart appears once, inside the narrative');
  for(const layout of ['analysis','periodic','dashboard','brief']){
    const report=JSON.parse(await readFile(reportPath,'utf8'));report.layout=layout;
    if(!report.blocks.some(block=>block.id==='orders'))report.blocks.push({type:'chart',id:'orders',dataset:'monthly',chart:'column',encode:{category:'channel',value:'orders'},title:'Synthetic orders'});
    await writeFile(reportPath,JSON.stringify(report));
    const layoutFile=path.join(dir,`${layout}.html`);assert.equal((await buildPackage(reportPath,layoutFile)).ok,true);
    const page=await readFile(layoutFile,'utf8');assert.ok(page.includes(`data-report-layout="${layout}"`));
    if(layout==='dashboard')assert.ok(page.includes('<div data-chart-grid>'));
    else assert.equal(page.includes('<div data-chart-grid>'),false);
    // 英文报表未指定 --lang 时推断为英文，叙述标题随页面语言。
    assert.ok(page.includes('<html lang="en"'),'an English package builds an English page without --lang');
    assert.ok(page.includes(layout==='analysis'||layout==='brief'?'Findings':'Notes'),'layout selects the narrative heading in the page language');
  }
  const styledPath=path.join(dir,'styled.html'); await writeFile(styledPath,html);
  await style([styledPath,'--theme','obsidian']);
  const styled=await readFile(styledPath,'utf8');
  assert.match(styled,/data-theme="obsidian"/);
  assert.deepEqual((await audit(styled)).failures,[]);
  const tampered=html.replace('data-view-label="Web"','data-view-label="Changed"');
  assert.notEqual(tampered,html,'tampering fixture must change the report content');
  assert.equal((await audit(tampered)).failures[0].code,'DATA_INTEGRITY');
  await writeFile(styledPath,tampered); await style([styledPath,'--theme','paper']);
  assert.equal(await readFile(styledPath,'utf8'),tampered,'style must not write content that fails the integrity gate');
  process.exitCode=0;
});
