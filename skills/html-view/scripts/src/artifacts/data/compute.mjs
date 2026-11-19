import { createHash } from 'node:crypto';
import { catalog, schema as kchartSchema, validate as validateKChart } from '../../../../vendor/kchart/esm/node.js';
import { compareValues, directionOf, formatDelta, formatValue, roundPercentage } from './format.mjs';
import { compareMonth, parseMonth, shiftMonth } from './period.mjs';
import { CODES, issue } from './errors.mjs';

const obj=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const idPattern=/^[A-Za-z_][A-Za-z0-9_-]*$/;
const monthPattern=/^\d{4}-(0[1-9]|1[0-2])$/;
// periodField:null 表示数据集本身是整段期间的汇总（如上半年分类合计），没有月份维度：取全部记录，不做期间比较。
export const periodOf=dataset=>dataset.periodField===null?null:(dataset.periodField??'month');
const inPeriod=(dataset,row,month)=>periodOf(dataset)===null||row[periodOf(dataset)]===month;

export function validateReport(report){
  const issues=[];
  const err=(code,where,message,fix)=>issues.push(issue(code,'error',where,message,fix));
  const unknown=(value,allowed,where)=>{if(obj(value))for(const key of Object.keys(value))if(!allowed.includes(key))err(CODES.BAD_SCHEMA,`${where}.${key}`,`不支持字段 ${key}`,'删除未定义字段，不使用旧报表兼容字段');};
  if(!obj(report))return{report:null,issues:[issue(CODES.BAD_SCHEMA,'error','report.json','report.json 必须是对象','提供 JSON 对象，而非数组或标量')]};
  const top=new Set(['title','layout','period','sources','datasets','blocks','views']);
  for(const key of Object.keys(report))if(!top.has(key))err(CODES.BAD_SCHEMA,key,`不支持字段 ${key}`,'使用 layout 新契约，删除旧 type 或其他未知字段');
  if(typeof report.title!=='string'||!report.title.trim())err(CODES.MISSING_META,'title','报告标题不能为空','填写 title');
  if(!['analysis','periodic','dashboard','brief'].includes(report.layout))err(CODES.BAD_SCHEMA,'layout','layout 必须是 analysis、periodic、dashboard 或 brief','按阅读结构设置 layout');
  const p=report.period;
  if(!obj(p)){err(CODES.BAD_PERIOD,'period','报告缺少 period 对象','提供 current、compare、timezone、complete');}
  else{
    unknown(p,['current','compare','timezone','complete'],'period');
    if(typeof p.current!=='string'||!monthPattern.test(p.current))err(CODES.BAD_PERIOD,'period.current',`current 必须为 YYYY-MM，当前为 ${JSON.stringify(p.current)}`,'使用有效公历月份');
    if(!Array.isArray(p.compare)||p.compare.some(x=>!['mom','yoy'].includes(x))||new Set(p.compare||[]).size!==(p.compare||[]).length)err(CODES.BAD_PERIOD,'period.compare','compare 只能是不重复的 mom/yoy 列表','写 []、["mom"]、["yoy"] 或 ["mom","yoy"]');
    if(typeof p.timezone!=='string'||!p.timezone.trim())err(CODES.MISSING_META,'period.timezone','缺少时区','填写 IANA 时区，如 Asia/Shanghai');
    else try{new Intl.DateTimeFormat('en',{timeZone:p.timezone}).format(new Date(0));}catch{err('BAD_TIMEZONE','period.timezone',`未知时区 ${p.timezone}`,'使用有效 IANA 时区');}
    if(typeof p.complete!=='boolean')err(CODES.MISSING_META,'period.complete','complete 必须是布尔值','当期完整写 true，未截止写 false');
  }
  const sourceIds=new Set();
  if(!Array.isArray(report.sources)||!report.sources.length)err(CODES.MISSING_META,'sources','至少声明一个来源','提供 id、name、pulledAt');
  else report.sources.forEach((s,i)=>{const at=`sources[${i}]`;unknown(s,['id','name','query','pulledAt'],at);if(!obj(s)||!idPattern.test(s.id||'')||sourceIds.has(s.id)||typeof s.name!=='string'||!s.name.trim()||typeof s.pulledAt!=='string'||!/[zZ]|[+-]\d\d:\d\d$/.test(s.pulledAt)||!Number.isFinite(Date.parse(s.pulledAt))||s.query!=null&&typeof s.query!=='string')err(CODES.BAD_SCHEMA,at,'来源须有唯一 id、name、可选文本 query 和带时区的 pulledAt','填写唯一来源 id、名称和 ISO 8601 时间；query 只能是文字说明');else sourceIds.add(s.id);});
  const datasets=new Map();
  if(!Array.isArray(report.datasets))err(CODES.BAD_SCHEMA,'datasets','datasets 必须是数组','提供数据集数组');
  else report.datasets.forEach((d,i)=>{
    const at=`datasets[${i}]`;
    if(!obj(d)){err(CODES.BAD_SCHEMA,at,'数据集必须是对象','使用数据集对象');return;}
    if(!idPattern.test(d.id||'')||datasets.has(d.id)){err(CODES.BAD_SCHEMA,`${at}.id`,'数据集 id 无效或重复','使用唯一标识符');return;}
    datasets.set(d.id,d);
    unknown(d,['id','label','file','source','periodField','dimensions','measures','total'],at);
    if(typeof d.file!=='string'||!d.file.trim())err(CODES.MISSING_META,`${at}.file`,'数据集缺少文件路径','填写相对 report.json 的 .csv 或 .json 路径');
    if(!sourceIds.has(d.source))err(CODES.BAD_SCHEMA,`${at}.source`,'source 未指向已声明来源','使用 sources[].id');
    if(d.label!=null&&(typeof d.label!=='string'||!d.label.trim()))err(CODES.BAD_SCHEMA,`${at}.label`,'数据集 label 不能为空','提供非空显示名或省略');
    const periodField=periodOf(d);
    if(periodField!==null&&(typeof periodField!=='string'||!periodField.trim()))err(CODES.BAD_SCHEMA,`${at}.periodField`,'periodField 必须是字段名','使用已声明的月份维度');
    if(!obj(d.dimensions)||!Object.keys(d.dimensions).length)err(CODES.BAD_SCHEMA,`${at}.dimensions`,'数据集必须声明维度','至少声明周期维度');
    else for(const [name,dim] of Object.entries(d.dimensions)){unknown(dim,['type','label'],`${at}.dimensions.${name}`);if(!obj(dim)||dim.type!=null&&!['month','category'].includes(dim.type)||dim.label!=null&&typeof dim.label!=='string')err(CODES.BAD_SCHEMA,`${at}.dimensions.${name}`,'维度声明无效','type 使用 month/category，label 使用字符串');}
    if(periodField!==null&&!d.dimensions?.[periodField])err(CODES.BAD_SCHEMA,`${at}.periodField`,`周期字段 ${periodField} 未在 dimensions 声明`,'声明月份维度；整段期间的汇总数据集写 "periodField": null');
    if(!obj(d.measures)||!Object.keys(d.measures).length)err(CODES.MISSING_META,`${at}.measures`,'数据集缺少指标','至少声明一个指标');
    else for(const [name,m] of Object.entries(d.measures)){
      const where=`${at}.measures.${name}`;
      if(!obj(m)){err(CODES.BAD_SCHEMA,where,'指标声明必须是对象','填写 label/unit/kind/definition');continue;}
      unknown(m,['label','unit','kind','definition','numerator','denominator','format','decimals','sample','partOfWhole','additive'],where);
      if(typeof m.label!=='string'||!m.label.trim())err(CODES.MISSING_META,`${where}.label`,'指标缺少 label','填写可读指标名');
      if(typeof m.unit!=='string'||!m.unit.trim())err(CODES.MISSING_META,`${where}.unit`,'指标缺少 unit','填写单位；百分比使用 %');
      if(typeof m.definition!=='string'||!m.definition.trim())err(CODES.MISSING_META,`${where}.definition`,'指标缺少口径定义','说明数据定义，不写可执行表达式');
      if(!['sum','distinct','ratio','mean','snapshot'].includes(m.kind))err(CODES.BAD_KIND,`${where}.kind`,'指标 kind 无效','使用 sum、distinct、ratio 或 mean');
      if(m.decimals!=null&&(!Number.isInteger(m.decimals)||m.decimals<0||m.decimals>6))err(CODES.BAD_SCHEMA,`${where}.decimals`,'decimals 必须在 0 至 6 之间','设置 0..6 的整数');
      if(m.format!=null&&!['percent','number','currency'].includes(m.format))err(CODES.BAD_SCHEMA,`${where}.format`,'format 只能是 percent、number 或 currency（后两者按 unit 显示）','修正 format');
      if(m.unit==='%'&&m.format!=null&&m.format!=='percent')err(CODES.BAD_SCHEMA,`${where}.format`,'unit 为 % 时 format 必须为 percent；不能将比例值当普通数值显示','移除 format:number/currency 或改成明确的非百分比单位');
      if(m.kind==='ratio'||m.kind==='mean')for(const role of ['numerator','denominator']){const part=d.measures?.[m[role]];if(!part||part.kind!=='sum')err(CODES.BAD_KIND,`${where}.${role}`,`${role} 必须引用同数据集的 sum 指标`,'指定同数据集可加指标作为分子和分母');}
      if(m.kind==='snapshot'&&m.additive!=null&&typeof m.additive!=='boolean')err(CODES.BAD_SCHEMA,`${at}.measures.${name}.additive`,'snapshot additive 必须是布尔值','仅同一时点互斥分项可设 true');
      if(m.kind==='ratio'&&m.sample!=null&&typeof m.sample!=='boolean')err(CODES.BAD_SCHEMA,`${where}.sample`,'sample 必须是布尔值','移除或填写布尔值');
      if(m.kind==='ratio'&&m.partOfWhole!=null&&typeof m.partOfWhole!=='boolean')err(CODES.BAD_SCHEMA,`${where}.partOfWhole`,'partOfWhole 必须是布尔值','移除或填写布尔值');
      if(Object.hasOwn(d.dimensions||{},name))err(CODES.BAD_SCHEMA,where,`字段 ${name} 同时声明为维度与指标`,'维度和指标使用不同字段名');
    }
    if(d.total!=null&&(!obj(d.total)||typeof d.total.field!=='string'||!Object.hasOwn(d.total,'value')||!d.dimensions?.[d.total.field]))err(CODES.BAD_SCHEMA,`${at}.total`,'total 必须指向已声明维度和值','提供 {field,value}');
  });
  const chartIds=new Set();
  if(!Array.isArray(report.blocks))err(CODES.BAD_SCHEMA,'blocks','blocks 必须是数组','提供内容块');
  else report.blocks.forEach((b,i)=>{
    const at=`blocks[${i}]`;
    if(!obj(b)||!['kpi','chart','table','text'].includes(b.type)){err(CODES.BAD_SCHEMA,at,'块类型无效','使用 kpi、chart、table 或 text');return;}
    if(b.type==='text'){unknown(b,['type','file','dataset'],at);if(typeof b.file!=='string'||!b.file.trim())err(CODES.BAD_SCHEMA,`${at}.file`,'叙述块缺少 Markdown 文件','填写相对路径');if(b.dataset!=null&&!datasets.has(b.dataset))err(CODES.BAD_SCHEMA,`${at}.dataset`,'叙述 dataset 不存在','使用已声明的数据集');return;}
    const d=datasets.get(b.dataset);
    if(!d){err(CODES.BAD_SCHEMA,`${at}.dataset`,'数据集引用不存在','引用已声明 datasets[].id');return;}
    if(b.type==='kpi')unknown(b,['type','dataset','measures'],at);
    if(b.type==='table')unknown(b,['type','dataset','columns','title'],at);
    if(b.type==='kpi'&&(!Array.isArray(b.measures)||!b.measures.length||b.measures.some(name=>!d.measures?.[name])))err(CODES.BAD_SCHEMA,`${at}.measures`,'KPI 指标列表无效','只引用已声明指标');
    if(b.type==='table'&&(!Array.isArray(b.columns)||!b.columns.length||b.columns.some(name=>!d.dimensions?.[name]&&!d.measures?.[name])))err(CODES.BAD_SCHEMA,`${at}.columns`,'表格列无效','只引用已声明字段');
    if(b.type==='chart'){
      if(b.id!=null&&(!idPattern.test(b.id)||chartIds.has(b.id)))err(CODES.BAD_SCHEMA,`${at}.id`,'chart id 必须唯一且有效','使用唯一 id');
      if(b.id)chartIds.add(b.id);
      if(typeof b.chart!=='string'||!catalog[b.chart]){err(CODES.BAD_KCHART,`${at}.chart`,`未知 KChart 图型 ${String(b.chart)}`,'从当前 KChart catalog/schema 选择图型');return;}
      const chartSchema=kchartSchema(b.chart), optionKeys=new Set(Object.keys(chartSchema.properties).filter(key=>!['chart','data','encode','fields','unit'].includes(key)));
      const fixed=new Set(['type','dataset','chart','encode','id']);
      for(const key of Object.keys(b))if(!fixed.has(key)&&!optionKeys.has(key))err(CODES.BAD_SCHEMA,`${at}.${key}`,`图块不接受 ${key}（旧 columns 列映射已移除）；data/fields/unit 由数据集生成`,'仅使用当前 KChart schema 的图表选项和 encode');
      if(!obj(b.encode)){err(CODES.BAD_KCHART,`${at}.encode`,'必须提供 KChart encode','按 KChart schema 映射维度/指标');return;}
      const spec=catalog[b.chart];
      for(const role of spec.required)if(!Object.hasOwn(b.encode,role))err(CODES.BAD_KCHART,`${at}.encode.${role}`,`缺少必需角色 ${role}`,'查看当前 KChart schema');
      const temporal=[];
      for(const [role,mapping] of Object.entries(b.encode)){
        if(![...spec.required,...spec.optional].includes(role))err(CODES.BAD_KCHART,`${at}.encode.${role}`,`图型 ${b.chart} 不支持角色 ${role}`,'按 KChart catalog 修正 encode');
        for(const field of Array.isArray(mapping)?mapping:[mapping]){
          if(typeof field!=='string'||!field.trim()){err(CODES.BAD_SCHEMA,`${at}.encode.${role}`,'encode 字段必须是非空字段名','引用数据集维度/指标');continue;}
          if(!d.dimensions?.[field]&&!d.measures?.[field])err(CODES.BAD_SCHEMA,`${at}.encode.${role}`,`字段 ${field} 未声明`,'只引用 dimensions/measures');
          if(d.dimensions?.[field]&&(d.dimensions[field].type==='month'||field===periodOf(d)))temporal.push(field);
        }
      }
      if(temporal.length>1)err(CODES.BAD_SCHEMA,`${at}.encode`,'同一图块不能映射多个月份键','选择一个月份维度作为时间键');
    }
  });
  if(report.views!=null&&!Array.isArray(report.views))err(CODES.BAD_SCHEMA,'views','views 必须是数组','提供视图数组');
  const viewIds=new Set(['all']);
  for(const [i,v] of (Array.isArray(report.views)?report.views:[]).entries()){
    const at=`views[${i}]`;
    if(!obj(v)||!idPattern.test(v.id||'')||viewIds.has(v.id)){err(CODES.BAD_SCHEMA,`${at}.id`,'视图 id 无效或重复','使用唯一且非 all 的标识符');continue;}
    viewIds.add(v.id);
    unknown(v,['id','label','filters'],at);
    if(v.label!=null&&typeof v.label!=='string')err(CODES.BAD_SCHEMA,`${at}.label`,'视图 label 必须是字符串','填写可读名称');
    if(!obj(v.filters||{}))err(CODES.BAD_SCHEMA,`${at}.filters`,'filters 必须是对象','按 dataset id 设置维度筛选');
    for(const [datasetId,filters] of Object.entries(v.filters||{})){const d=datasets.get(datasetId);if(!d||!obj(filters)||Object.keys(filters).some(field=>!d.dimensions?.[field]))err(CODES.BAD_SCHEMA,`${at}.filters.${datasetId}`,'视图过滤只能引用已声明数据集维度','修正 dataset 或 dimension');}
  }
  return{report,issues};
}

function splitTotal(dataset,rows){if(!dataset.total)return{totalRows:[],partRows:rows};const{field,value}=dataset.total;const totalRows=rows.filter(row=>String(row[field])===String(value));return{totalRows,partRows:rows.filter(row=>String(row[field])!==String(value))};}
function sumField(rows,field){let sum=0,present=0,missing=0;for(const row of rows){if(row[field]==null)missing++;else{sum+=row[field];present++;}}return{sum,present,missing};}
function sumResult(dataset,name,rows,where,issues){const{totalRows,partRows}=splitTotal(dataset,rows);const keyOf=row=>JSON.stringify(Object.keys(dataset.dimensions||{}).map(key=>row[key]));const totalKeys=new Set();for(const row of totalRows){const key=keyOf(row);if(totalKeys.has(key)){issues.push(issue(CODES.DUPLICATE_KEY,'error',where,`合计指标 ${name} 出现重复 total 行`,'每个周期和其他维度组合只保留一条 total 行'));return{value:null,status:'invalid',reason:'重复 total 行'};}totalKeys.add(key);}const target=totalRows.length?totalRows:partRows;if(!target.length)return{value:null,status:'missing',reason:'没有符合条件的记录'};if(!totalRows.length&&partRows.some(row=>row[name]==null)){const values=sumField(partRows,name);if(!values.present)return{value:null,status:'missing',reason:'分项均缺失，且没有独立合计'};issues.push(issue(CODES.INCOMPLETE_TOTAL,'error',where,`可加指标 ${name} 有缺失分项，又没有独立合计`,'补齐分项或提供完整 total 行；不返回部分和'));return{value:null,status:'incomplete',reason:'分项不完整'};}const values=sumField(target,name);if(!values.present)return{value:null,status:'missing',reason:'合计与分项都没有数值'};if(values.missing){issues.push(issue(CODES.INCOMPLETE_TOTAL,'error',where,`可加指标 ${name} 的合计行有缺失`,'补齐合计行；不能把部分合计显示成总量'));return{value:null,status:'incomplete',reason:'合计不完整'};}if(totalRows.length&&partRows.length){const part=sumField(partRows,name);if(!part.missing&&part.present){const gap=Math.abs(part.sum-values.sum)/Math.max(1,Math.abs(part.sum),Math.abs(values.sum));if(gap>1e-6)issues.push(issue(CODES.TOTAL_MISMATCH,'error',where,`指标 ${name} 的分项和 ${part.sum} 与合计 ${values.sum} 不一致`,'修正分项或合计；只有声明 total 时核对拆分'));}}return{value:values.sum,status:'ok',inputs:{rows:target.length,source:totalRows.length?'total':'parts'}};}
function singleResult(dataset,name,rows,where,issues,reason){const{totalRows,partRows}=splitTotal(dataset,rows);if(totalRows.length===1){const value=totalRows[0][name];return{value:value??null,status:value==null?'missing':'ok',inputs:{source:'total'}};}const selected=totalRows.length?totalRows:partRows;const present=selected.filter(row=>row[name]!=null);if(!present.length)return{value:null,status:'missing',reason:'该期没有可用数值'};if(selected.length!==1||present.length!==1){issues.push(issue(CODES.BAD_KIND,'error',where,reason,'只保留一条上游预聚合记录或提供唯一 total 行；不可跨行相加'));return{value:null,status:'invalid',reason};}return{value:present[0][name],status:'ok',inputs:{rows:1}};}
export function aggregate(dataset, name, rows, where, issues) {
  const spec = dataset.measures?.[name];
  if (!spec) {
    issues.push(issue(CODES.BAD_SCHEMA, 'error', where, `未声明指标 ${name}`, '只使用 measures 中已声明的指标'));
    return { value: null, status: 'invalid', reason: '未声明指标' };
  }
  if (!rows.length) return { value: null, status: 'missing', reason: '没有符合条件的记录' };
  if (spec.kind === 'sum' || (spec.kind === 'snapshot' && spec.additive === true)) {
    return sumResult(dataset, name, rows, where, issues);
  }
  if (spec.kind === 'distinct' || spec.kind === 'snapshot') {
    const reason = spec.kind === 'distinct' ? `去重指标 ${name} 不能跨行相加` : `时点指标 ${name} 未声明 additive，不能把分项相加`;
    return singleResult(dataset, name, rows, where, issues, reason);
  }
  if (spec.kind === 'ratio' || spec.kind === 'mean') {
    const numerator = sumResult(dataset, spec.numerator, rows, `${where}.${spec.numerator}`, issues);
    const denominator = sumResult(dataset, spec.denominator, rows, `${where}.${spec.denominator}`, issues);
    if (numerator.status !== 'ok' || denominator.status !== 'ok') {
      if (numerator.status === 'missing' && denominator.status === 'missing') {
        return { value: null, status: 'missing', reason: '分子或分母缺失' };
      }
      return { value: null, status: 'incomplete', reason: '分子或分母不完整' };
    }
    const inputs = { numerator: numerator.value, denominator: denominator.value };
    if (denominator.value === 0) {
      return { value: null, status: 'zero_denominator', reason: '分母为 0，无法计算比率或均值', inputs };
    }
    return { value: numerator.value / denominator.value, status: 'ok', inputs: { ...inputs, source: numerator.inputs?.source } };
  }
  issues.push(issue(CODES.BAD_KIND, 'error', where, `指标 ${name} 的 kind 不支持`, '使用 sum、ratio、distinct、snapshot 或 mean'));
  return { value: null, status: 'invalid' };
}
export function displaySpec(spec){const percent=spec.format==='percent'||spec.unit==='%'&&spec.format!=='number';return{format:percent?'percent':'number',unit:spec.unit,decimals:spec.decimals??null};}
function filteredRows(dataset,view){const filter=view.filters?.[dataset.id]||{};return dataset.rows.filter(row=>Object.entries(filter).every(([key,value])=>String(row[key])===String(value)));}
function checkMeasureHints(dataset, name, spec, rows, where, issues) {
  if (spec.kind !== 'ratio' || displaySpec(spec).format !== 'percent') return;
  const { totalRows, partRows } = splitTotal(dataset, rows);
  if (spec.sample === true) {
    const source = totalRows.length ? totalRows : partRows;
    const denominator = source.reduce((sum, row) => sum + (row[spec.denominator] ?? 0), 0);
    if (denominator > 0 && denominator < 30) {
      issues.push(issue(CODES.SMALL_BASE, 'hint', where, `百分比比率分母 ${denominator} 小于 30`, '样本较小时不要写成稳定结论；此阈值不用于金额或其他指标'));
    }
  }
  if (!spec.partOfWhole || !totalRows.length || partRows.length < 2) return;
  const values = partRows.map((row) => aggregate(dataset, name, [row], where, []));
  if (values.some((item) => item.status !== 'ok')) return;
  const digits = spec.decimals ?? 1;
  const sum = values.reduce((acc, item) => acc + roundPercentage(item.value, digits), 0);
  if (Math.abs(sum - 100) > 0.05) {
    issues.push(issue(CODES.SHARE_SUM, 'hint', where, `分项百分比四舍五入后合计 ${Number(sum.toFixed(digits))}%，不是 100%`, '说明四舍五入，不要改写原始比率'));
  }
}
function metricFor(dataset,name,rows,report,view,issues,lang){const spec=dataset.measures[name],where=`views.${view.id}.${dataset.id}.${name}`;const current=aggregate(dataset,name,rows.filter(row=>inPeriod(dataset,row,report.period.current)),where,issues);const display=displaySpec(spec),comparisons={};if(report.period.complete&&periodOf(dataset)!==null)for(const kind of report.period.compare||[]){const month=compareMonth(report.period.current,kind);const baseline=aggregate(dataset,name,rows.filter(row=>inPeriod(dataset,row,month)),`${where}.${kind}`,issues);const result=compareValues(current,baseline,display);comparisons[kind]={month,...result,text:formatDelta(result,{...display,lang})};}checkMeasureHints(dataset,name,spec,rows.filter(row=>inPeriod(dataset,row,report.period.current)),where,issues);const value=current.status==='ok'?current.value:null;return{...current,dataset:dataset.id,measure:name,...spec,value,status:current.status,reason:current.reason||null,format:display.format,decimals:display.decimals,displaySpec:display,display:formatValue(value,{...display,unit:'',lang}),comparisons};}

function roleFields(encode){return [...new Set(Object.values(encode||{}).flat())];}
function timeKeyFor(dataset,encode){return roleFields(encode).find(field=>dataset.dimensions?.[field]&&(dataset.dimensions[field].type==='month'||field===periodOf(dataset)))??null;}
function rowGroups(rows,dimensions){if(!dimensions.length)return rows.map((row,index)=>[String(index),[row]]);const groups=new Map();for(const row of rows){const key=JSON.stringify(dimensions.map(field=>row[field]));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}return [...groups.entries()];}
function chartData(dataset,block,view,report,issues){const allRows=filteredRows(dataset,view),fields=roleFields(block.encode),dimensions=fields.filter(field=>dataset.dimensions?.[field]),timeKey=timeKeyFor(dataset,block.encode);let selected=allRows.filter(row=>timeKey||inPeriod(dataset,row,report.period.current));const total=dataset.total;if(total&&dimensions.includes(total.field))selected=selected.filter(row=>String(row[total.field])!==String(total.value));const groups=rowGroups(selected,dimensions);const data=groups.map(([,group])=>Object.fromEntries(fields.map(field=>[field,dataset.measures?.[field]?aggregate(dataset,field,group,`blocks.${block.id||block.chart}.encode.${field}`,issues).value:group[0]?.[field]])));
  if(timeKey&&data.length){const months=[...new Set(data.map(row=>row[timeKey]).filter(value=>parseMonth(value)))].sort((a,b)=>a.localeCompare(b));if(months.length){const otherDimensions=dimensions.filter(field=>field!==timeKey),tuples=[...new Map(data.map(row=>{const values=otherDimensions.map(field=>row[field]);return[JSON.stringify(values),values];})).values()],byKey=new Map(data.map(row=>[JSON.stringify([row[timeKey],...otherDimensions.map(field=>row[field])]),row]));const filled=[];let cursor=months[0],last=months.at(-1);while(cursor<=last){for(const tuple of tuples){const key=JSON.stringify([cursor,...tuple]);filled.push(byKey.get(key)||Object.fromEntries(fields.map(field=>[field,field===timeKey?cursor:otherDimensions.includes(field)?tuple[otherDimensions.indexOf(field)]:null])));}if(cursor===last)break;cursor=shiftMonth(cursor,1);}return filled;}}
  return data;
}
function chartSpec(dataset,block,view,report,issues){const fields=roleFields(block.encode);const data=chartData(dataset,block,view,report,issues);const fieldMeta={};for(const field of fields){const dim=dataset.dimensions?.[field],measure=dataset.measures?.[field];if(dim)fieldMeta[field]={label:dim.label||field,type:dim.type||'category'};else if(measure){const display=displaySpec(measure);fieldMeta[field]={label:measure.label||field,...(display.format==='percent'?{format:'percent'}:{unit:measure.unit}),...(measure.decimals==null?{}:{decimals:measure.decimals})};}}
  const options=Object.keys(kchartSchema(block.chart).properties).filter(key=>!['chart','data','encode','fields','unit'].includes(key));const spec={...Object.fromEntries(Object.entries(block).filter(([key])=>options.includes(key))),chart:block.chart,encode:{...block.encode},data,fields:fieldMeta};const result=validateKChart(spec);for(const error of result.errors)issues.push(issue(CODES.BAD_KCHART,'error',`blocks.${block.id||block.chart}${error.path}`,error.message,error.fix||'按当前 KChart schema 修正 chart 与 encode'));return spec;
}

export function computeReport(report,datasets,{lang='zh-CN',narratives=[]}={}){const issues=[];const narrativeByFile=new Map(narratives.map(item=>[item.block.file,item]));const views=[{id:'all',label:/^en\b/i.test(lang)?'All':'全部',filters:{}},...(report.views||[])];const outputViews=views.map(view=>{const result={id:view.id,label:view.label||(view.id==='all'&&/^en\b/i.test(lang)?'All':view.id),filters:view.filters||{},datasets:{},blocks:[]};for(const dataset of datasets){const rows=filteredRows(dataset,view),measures={};for(const name of Object.keys(dataset.measures))measures[name]=metricFor(dataset,name,rows,report,view,issues,lang);result.datasets[dataset.id]=measures;}
  for(const [index,block] of report.blocks.entries()){if(block.type==='text'){const narrative=narrativeByFile.get(block.file);result.blocks.push({...block,sourceIndex:index,text:narrative?.text??'',filePath:narrative?.filePath??null});continue;}if(block.type==='kpi'){result.blocks.push({...block,sourceIndex:index,data:Object.fromEntries(block.measures.map(name=>[name,result.datasets[block.dataset]?.[name]]))});continue;}if(block.type==='table'){const dataset=datasets.find(item=>item.id===block.dataset);result.blocks.push({...block,sourceIndex:index,rows:filteredRows(dataset,view).filter(row=>inPeriod(dataset,row,report.period.current))});continue;}const dataset=datasets.find(item=>item.id===block.dataset);const spec=chartSpec(dataset,{...block,sourceIndex:index},view,report,issues);result.blocks.push({...block,sourceIndex:index,spec});}
  return result;});if(!report.period.complete&&(report.period.compare||[]).length)issues.push(issue(CODES.PARTIAL_PERIOD,'error','period','期间未完整，不生成 mom/yoy 比较','本期完整后重新 validate/build'));return{report,datasets,metrics:outputViews[0]?.datasets||{},views:outputViews,blocks:outputViews[0]?.blocks||[],issues};}

export function resolveVizReference(source,charts){let reference;try{reference=JSON.parse(source);}catch{throw Object.assign(new Error('叙述图形引用不是有效 JSON'),{code:'BAD_TEXT',fix:'只写 {"ref":"图表块 id"}'});}if(!reference||Object.keys(reference).length!==1||typeof reference.ref!=='string'||!charts.has(reference.ref))throw Object.assign(new Error('叙述图形必须唯一引用已声明图表块'),{code:'BAD_TEXT',fix:'只写 {"ref":"图表块 id"} 且确保该图表块存在'});return reference.ref;}
export function fingerprint(content){return createHash('sha256').update(content).digest('hex');}
export function jsonPointer(parts){return parts.reduce((pointer,part)=>`${pointer}/${String(part).replace(/~/g,'~0').replace(/\//g,'~1')}`,'');}
export { issue, CODES };
