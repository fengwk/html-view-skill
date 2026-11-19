/* Strict KChart JSON parsing, validation and catalog-derived JSON Schema. */

import { catalog } from './catalog.js';

const TOP = new Set(['chart','title','subtitle','source','note','data','encode','fields','unit','variant','layout','sort','emphasis','annotations','interaction','stack','unitMark','range','start','layers','period','directed']);
const ENCODE = new Set(['category','value','series','id','lower','upper','intensity','panel','actual','target','before','after','open','close','low','high','delta','count','q1','median','q3','outliers','density','x','y','size','label','row','column','date','rank','dimensions','start','region','longitude','latitude']);
const FIELD_KEYS = new Set(['label','type','unit','format','decimals','domain','scale']);
// 只登记绘制时真正改变的图型、变体和身份类型；其余组合若被接受，读者会看到一张没有任何强调的图。空键是默认变体。
const ALL_EMPHASIS = ['rows', 'fields', 'series'], ROW_EMPHASIS = ['rows'], SERIES_EMPHASIS = ['fields', 'series'];
const EMPHASIS = {
  line: { '': ALL_EMPHASIS, counter: ALL_EMPHASIS, barcode: ROW_EMPHASIS },
  area: { '': ALL_EMPHASIS },
  bar: { '': ALL_EMPHASIS, solid: ALL_EMPHASIS, lollipop: ROW_EMPHASIS, rungs: ROW_EMPHASIS, pictorial: ROW_EMPHASIS },
  column: { '': ALL_EMPHASIS, solid: ALL_EMPHASIS, lollipop: ROW_EMPHASIS, rungs: ROW_EMPHASIS, pictorial: ROW_EMPHASIS },
  share: { '': SERIES_EMPHASIS, solid: SERIES_EMPHASIS },
  funnel: { '': ROW_EMPHASIS, bars: ROW_EMPHASIS },
};
const err = (errors, path, message, fix = '请按图型契约修正字段或数据。', code = 'BAD_KCHART', loc) => errors.push({code,path,message,fix,...(loc ? {location:loc} : {})});
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = v => typeof v === 'number' && Number.isFinite(v);
const ptr = p => p.map(x => `/${String(x).replace(/~/g,'~0').replace(/\//g,'~1')}`).join('');
const keys = (value, allowed, path, errors) => {
  if (!obj(value)) {
    err(errors, path, '必须是对象');
    return;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) err(errors, `${path}/${key}`, '未知字段');
  }
};
const safeDate = (v, type) => {
  if (typeof v !== 'string') return false;
  if (type === 'month') return /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
  if (type === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }
  if (type === 'datetime') {
    return /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v)
      && safeDate(v.slice(0, 10), 'date')
      && Number.isFinite(Date.parse(v));
  }
  return true;
};
function validate(spec) {
  const errors = [];
  if (!obj(spec)) {
    err(errors, '', '声明必须是对象');
    return { errors, data: null };
  }
  keys(spec,TOP,'',errors);
  const c = typeof spec.chart === 'string' ? catalog[spec.chart] : undefined;
  if (!c) err(errors,'/chart','未知图型','chart 必须是注册图型名。');
  for (const k of ['title','subtitle','source','note','unit']) if (spec[k] !== undefined && typeof spec[k] !== 'string') err(errors,`/${k}`,'必须是字符串');
  if (spec.unit === '%') err(errors,'/unit','根 unit 不可写 %','比例数据请用 fields.<字段>.format=percent。');
  if (spec.data === undefined) err(errors,'/data','必填字段缺失');
  if (c) {
    const shapeOk = c.shape === 'table'
      ? Array.isArray(spec.data) && spec.data.length > 0 && spec.data.every(obj)
      : c.shape === 'tree'
        ? obj(spec.data)
        : c.shape === 'network'
          ? obj(spec.data) && Array.isArray(spec.data.nodes) && Array.isArray(spec.data.edges)
          : c.shape === 'paths'
            ? obj(spec.data) && Array.isArray(spec.data.stages) && Array.isArray(spec.data.nodes) && Array.isArray(spec.data.paths)
            : obj(spec.data) && obj(spec.data.map) && Array.isArray(spec.data.rows);
    if (!shapeOk) err(errors, '/data', `数据必须匹配 ${c.shape} 形状`);
    const errorsBeforeEncode = errors.length;
    if (c.shape==='table') {
      if (!obj(spec.encode)) err(errors,'/encode','必须提供角色映射');
      else {
        keys(spec.encode,ENCODE,'/encode',errors);
        for (const role of c.required) if (spec.encode[role]===undefined) err(errors,`/encode/${role}`,'必填角色缺失');
        for (const role of Object.keys(spec.encode)) if (![...c.required,...c.optional].includes(role)) err(errors,`/encode/${role}`,'该图型不支持此角色');
        for (const role of [...c.required,...c.optional]) if (spec.encode[role]!==undefined) {
          const value=spec.encode[role];
          const allowsArray=c.arrayRoles.includes(role);
          if(role==='dimensions') { if(!Array.isArray(value)||!value.length||!value.every(x=>typeof x==='string'&&x)) err(errors,`/encode/${role}`,'dimensions须为非空字段名数组'); }
          else if(allowsArray) { if(!(typeof value==='string'&&value||Array.isArray(value)&&value.length&&value.every(x=>typeof x==='string'&&x))) err(errors,`/encode/${role}`,'须为非空字段名或字段名数组'); }
          else if(typeof value!=='string'||!value) err(errors,`/encode/${role}`,'必须是单个非空字段名');
        }
      }
    } else if (c.shape==='geo') {
      if (!obj(spec.encode)) err(errors,'/encode','地图必须提供角色映射');
      else {
        keys(spec.encode,ENCODE,'/encode',errors);
        for (const role of c.required) if (spec.encode[role]===undefined) err(errors,`/encode/${role}`,'必填角色缺失');
        for (const [role, value] of Object.entries(spec.encode)) {
          if (![...c.required, ...c.optional].includes(role)) err(errors, `/encode/${role}`, '该地图不支持此角色');
          else if (typeof value !== 'string' || !value) err(errors, `/encode/${role}`, '必须是单个非空字段名');
        }
      }
    } else if (spec.encode!==undefined) err(errors,'/encode','该图型不使用 encode');
    const encodeOk = errors.length === errorsBeforeEncode;
    const layersOk = c.name !== 'combo' || Array.isArray(spec.layers) && spec.layers.every((layer) => obj(layer) && typeof layer.field === 'string');
    const commonFields=new Set(['chart','title','subtitle','source','note','data','fields','unit','sort','emphasis','annotations','interaction','encode']);
    for (const field of Object.keys(spec)) if (!commonFields.has(field) && c.special[field]===undefined && !(field==='unitMark'&&['bar','column','dumbbell','waterfall','histogram'].includes(c.name))) err(errors,`/${field}`,`图型 ${c.name} 不支持此参数`);
    for (const field of c.requiredSpecial) if (spec[field]===undefined) err(errors,`/${field}`,'必填专用字段缺失');
    for (const [field, allowed] of Object.entries(c.special)) {
      const v=spec[field]; if (v===undefined) { if (allowed==='range') err(errors,`/${field}`,'必填专用字段缺失'); continue; }
      if (Array.isArray(allowed) && !allowed.includes(v)) err(errors, `/${field}`, `必须为 ${allowed.join('、')} 中的一项`);
      else if (allowed==='boolean' && typeof v!=='boolean') err(errors,`/${field}`,'必须是布尔值');
      else if (allowed==='number' && !finite(v)) err(errors,`/${field}`,'必须是有限数');
      else if (allowed==='year' && (typeof v !== 'string' || !/^\d{4}$/.test(v))) err(errors,`/${field}`,'必须是YYYY年份');
      else if (allowed==='range' && !(Array.isArray(v)&&v.length===2&&v.every(finite)&&v[0]<v[1])) err(errors,`/${field}`,'必须是递增的有限数范围');
      else if (allowed==='layers' && (!Array.isArray(v)||!v.length||v.some(x=>!obj(x)||!['line','area','column'].includes(x.mark)||typeof x.field!=='string'||!['left','right'].includes(x.axis)))) err(errors,`/${field}`,'必须是有效 layers 数组');
    }
    if (spec.unitMark!==undefined) {
      keys(spec.unitMark,new Set(['value','label','icon']),'/unitMark',errors);
      if (!obj(spec.unitMark)||!finite(spec.unitMark.value)||spec.unitMark.value<=0||typeof spec.unitMark.label!=='string'||!spec.unitMark.label) err(errors,'/unitMark','unitMark须含正有限value及非空label');
      if (spec.variant==='rungs'&&spec.unitMark?.icon!==undefined) err(errors,'/unitMark/icon','rungs不支持icon');
      if (spec.variant==='pictorial'&&(typeof spec.unitMark?.icon!=='string'||!spec.unitMark.icon)) err(errors,'/unitMark/icon','pictorial必须指定受控icon ID');
    }
    if (['rungs','pictorial'].includes(spec.variant)&&spec.unitMark===undefined) err(errors,'/unitMark','该变体必须声明unitMark');
    if (spec.unitMark!==undefined&&!['bar','column','dumbbell','waterfall','histogram'].includes(c.name)) err(errors,'/unitMark','该图型不支持unitMark');
    if (shapeOk && c.shape === 'tree') checkTree(spec.data, c.name, errors);
    if (shapeOk&&c.shape==='network') checkNetwork(spec.data,spec.chart,errors);
    if (shapeOk&&c.shape==='paths') checkPaths(spec.data,errors);
    if (c.shape==='geo' && spec.data?.map) {
      const m=spec.data.map;
      const builtin=obj(m)&&Object.keys(m).length===1&&['world','us-states'].includes(m.asset);
      const external=obj(m)&&obj(m.geojson)&&m.geojson.type==='FeatureCollection'&&Array.isArray(m.geojson.features)&&typeof m.idProperty==='string'&&Object.keys(m).every(k=>['geojson','idProperty'].includes(k));
      if (!builtin&&!external) err(errors,'/data/map','map须是world、us-states或GeoJSON FeatureCollection');
      if (external) {
        const ids=new Set();
        for(const [i,f] of m.geojson.features.entries()) {
          if(!obj(f)||f.type!=='Feature'||!obj(f.properties)||!obj(f.geometry)||!['Polygon','MultiPolygon'].includes(f.geometry.type)) {err(errors,`/data/map/geojson/features/${i}`,'地图仅支持带properties的Polygon/MultiPolygon Feature');continue;}
          const id=f.properties[m.idProperty];
          if(typeof id!=='string'||!id||ids.has(id)) err(errors,`/data/map/geojson/features/${i}/properties/${m.idProperty}`,'地图地区键须唯一非空字符串');
          ids.add(id);
        }
      }
    }
    if (c.shape === 'table' && shapeOk && encodeOk && layersOk) checkTable(spec, c, errors);
    if (c.shape === 'geo' && shapeOk && encodeOk) checkGeoRows(spec, c, errors);
  }
  if (spec.fields!==undefined) {
    if (!obj(spec.fields)) err(errors,'/fields','必须是对象'); else for (const [name,f] of Object.entries(spec.fields)) {
      keys(f,FIELD_KEYS,`/fields/${name}`,errors); if (!obj(f)) continue;
      if (f.label!==undefined&&typeof f.label!=='string') err(errors,`/fields/${name}/label`,'必须是字符串');
      if (f.type!==undefined&&!['number','category','date','month','datetime'].includes(f.type)) err(errors,`/fields/${name}/type`,'无效字段类型');
      if (f.format!==undefined&&!['number','percent'].includes(f.format)) err(errors,`/fields/${name}/format`,'无效数值格式');
      if (f.unit!==undefined&&typeof f.unit!=='string') err(errors,`/fields/${name}/unit`,'必须是字符串');
      if (f.unit!==undefined&&f.format==='percent') err(errors,`/fields/${name}`,'percent已隐含%单位，不可再声明unit');
      if (f.decimals!==undefined&&(!Number.isInteger(f.decimals)||f.decimals<0||f.decimals>6)) err(errors,`/fields/${name}/decimals`,'必须是0至6的整数');
      if (f.scale!==undefined&&!['linear','log'].includes(f.scale)) err(errors,`/fields/${name}/scale`,'无效scale');
      if (f.domain!==undefined) { const d=f.domain; if (!(Array.isArray(d)&&((d.length===2&&d.every(finite)&&d[0]<d[1])||(d.every(x=>typeof x==='string')&&new Set(d).size===d.length)))) err(errors,`/fields/${name}/domain`,'domain须为递增数值范围或无重复分类序列'); }
    }
  }
  if (spec.unit!==undefined&&spec.fields&&Object.values(spec.fields).some(f=>obj(f)&&(f.unit!==undefined||f.format==='percent'))) err(errors,'/unit','根 unit 与字段级 unit/percent 冲突');
  if (spec.unit!==undefined&&['radial-share','split-compare'].includes(spec.chart)) err(errors,'/unit','该图型不支持根 unit，须分别声明字段单位或格式');
  if (spec.sort!==undefined) {
    keys(spec.sort,new Set(['field','direction']),'/sort',errors);
    if (!obj(spec.sort)||typeof spec.sort.field!=='string'||!['asc','desc'].includes(spec.sort.direction)) err(errors,'/sort','须为 {field,direction:asc|desc}');
    const allowed=['bar','column','pie','donut','radial-share','rose','tally'].includes(spec.chart);
    if(!allowed)err(errors,'/sort','该图型不支持排序');
    if(obj(spec.encode)&&spec.sort?.field){
      const vals=spec.encode.value;
      const category=spec.encode.category;
      if(Array.isArray(vals)&&vals.length!==1)err(errors,'/sort','多系列图不能排序');
      if(![category,...(Array.isArray(vals)?vals:[vals])].includes(spec.sort.field))err(errors,'/sort/field','sort.field必须是实际category或value字段');
    }
  }
  if (spec.interaction !== undefined) {
    if (!Array.isArray(spec.interaction)
      || spec.interaction.some(action => !['inspect', 'legend', 'focus', 'pan-zoom', 'drag', 'collapse'].includes(action))) {
      err(errors, '/interaction', '包含无效交互');
    } else {
      for (const action of spec.interaction) {
        const supported = action === 'inspect'
          || action === 'legend' && ['line', 'area', 'bar', 'column', 'scatter'].includes(spec.chart)
          || action === 'focus' && ['network', 'sankey', 'threads', 'tree', 'mindmap', 'parallel'].includes(spec.chart)
          || action === 'pan-zoom' && ['network', 'tree', 'mindmap', 'sankey', 'threads', 'choropleth', 'geo-scatter'].includes(spec.chart)
          || action === 'drag' && spec.chart === 'network' && spec.layout === 'force'
          || action === 'collapse' && ['tree', 'mindmap'].includes(spec.chart);
        if (!supported) err(errors, '/interaction', `该图型不支持 ${action}`);
      }
    }
    if (Array.isArray(spec.interaction) && spec.interaction.includes('drag') && !spec.interaction.includes('pan-zoom')) {
      err(errors, '/interaction', 'drag必须搭配pan-zoom');
    }
  }
  if (spec.annotations!==undefined) {
    const allowedCharts=['line','area','bar','column','scatter','combo','interval','histogram','candlestick'];
    if (!Array.isArray(spec.annotations)) err(errors,'/annotations','必须是数组');
    else for (const [i, annotation] of spec.annotations.entries()) {
      const path = `/annotations/${i}`;
      if (!obj(annotation) || !['rule', 'band', 'note'].includes(annotation.kind)) {
        err(errors, path, '无效注释');
        continue;
      }
      const allowedKeys = annotation.kind === 'rule'
        ? ['kind', 'field', 'value', 'label']
        : annotation.kind === 'band'
          ? ['kind', 'field', 'from', 'to', 'label']
          : ['kind', 'record', 'field', 'text'];
      keys(annotation, new Set(allowedKeys), path, errors);
      if (!allowedCharts.includes(spec.chart)) err(errors, path, `${spec.chart}不支持annotations`);
      if (annotation.kind === 'rule' && (!finite(annotation.value) || typeof annotation.field !== 'string')) {
        err(errors, path, 'rule须指定数值field和value');
      }
      if (annotation.kind === 'band'
        && (!finite(annotation.from) || !finite(annotation.to) || annotation.from >= annotation.to || typeof annotation.field !== 'string')) {
        err(errors, path, 'band须指定field及递增数值边界');
      }
      if (annotation.kind === 'note'
        && (typeof annotation.record !== 'string' || typeof annotation.field !== 'string' || typeof annotation.text !== 'string' || !obj(spec.encode) || !spec.encode.id)) {
        err(errors, path, 'note须通过encode.id引用记录并提供field/text');
      }
      if (annotation.label !== undefined && typeof annotation.label !== 'string'
        || annotation.text !== undefined && typeof annotation.text !== 'string') {
        err(errors, path, '注释label/text须为纯文本');
      }
      const enc = spec.encode || {};
      const scalarFields = Object.entries(enc)
        .filter(([role, value]) => typeof value === 'string' && !['category', 'series', 'id', 'panel', 'label', 'row', 'column', 'date'].includes(role))
        .map(([, value]) => value);
      if (Array.isArray(enc.value)) scalarFields.push(...enc.value);
      if (Array.isArray(spec.layers)) scalarFields.push(...spec.layers.filter(obj).map(layer => layer.field));
      if (typeof annotation.field === 'string' && !scalarFields.includes(annotation.field)) {
        err(errors, `${path}/field`, '注释字段必须是本图已引用的标量数值角色');
      }
      if (spec.chart === 'histogram' && typeof annotation.field === 'string'
        && !['lower', 'upper'].some(role => enc[role] === annotation.field)) {
        err(errors, `${path}/field`, 'histogram注释只允许lower或upper');
      }
      if (annotation.kind === 'note' && Array.isArray(spec.data)) {
        const idField = enc.id;
        if (!spec.data.some(row => row?.[idField] === annotation.record)) {
          err(errors, `${path}/record`, 'note引用的record id不存在');
        }
      }
    }
  }
  if (spec.emphasis !== undefined) {
    const kind = Object.keys(obj(spec.emphasis) ? spec.emphasis : {});
    const values = kind.length === 1 ? spec.emphasis[kind[0]] : null;
    const supported = EMPHASIS[spec.chart]?.[spec.variant ?? ''] || [];
    const target = `${spec.chart}${spec.variant ? ` 的 ${spec.variant} 变体` : ''}`;
    if (kind.length !== 1 || !ALL_EMPHASIS.includes(kind[0]) || !Array.isArray(values)) {
      err(errors, '/emphasis', '强调须在 rows、fields、series 中选一种身份数组');
    } else if (!supported.includes(kind[0])) {
      err(errors, '/emphasis', supported.length ? `${target}只绘制 ${supported.join('、')} 强调` : `${target}不绘制强调`,
        supported.length ? `改用 ${supported.join(' 或 ')}` : '删去 emphasis；改用 line、area、bar、column、share 或 funnel，或用标题、注释指出重点');
    } else {
      const enc = spec.encode || {};
      let actual = [];
      if (kind[0] === 'rows' && Array.isArray(spec.data) && enc.id) actual = spec.data.map(row => row?.[enc.id]);
      if (kind[0] === 'fields' && Array.isArray(enc.value)) actual = enc.value;
      if (kind[0] === 'series' && Array.isArray(spec.data) && enc.series) actual = spec.data.map(row => row?.[enc.series]);
      if (kind[0] === 'series' && Array.isArray(enc.value)) actual = enc.value;
      if (!actual.length || values.some(value => !actual.includes(value)) || new Set(values).size !== values.length) {
        err(errors, '/emphasis', `强调引用不存在或重复的${kind[0]}`);
      }
      if (kind[0] === 'rows' && !enc.id || kind[0] === 'fields' && !Array.isArray(enc.value)) {
        err(errors, '/emphasis', `该图型不支持${kind[0]}强调`);
      }
    }
  }
  return {errors,data:errors.length?null:spec};
}
function checkGeoRows(spec, chart, errors) {
  const { encode, data: { rows } } = spec;
  for (const [i, row] of rows.entries()) {
    const path = `/data/rows/${i}`;
    if (!obj(row)) {
      err(errors, path, '地图记录必须是对象');
      continue;
    }
    for (const role of [...chart.required, ...chart.optional]) {
      const field = encode[role];
      if (field === undefined) continue;
      if (!Object.hasOwn(row, field)) {
        err(errors, `/encode/${role}`, `引用字段不存在：${field}`);
      } else if (['longitude', 'latitude', 'value'].includes(role)) {
        const value = row[field];
        const fieldPath = ptr(['data', 'rows', i, field]);
        if (!finite(value) && !(role === 'value' && value === null)) {
          err(errors, fieldPath, '数值角色必须是有限数');
        } else if (role === 'longitude' && Math.abs(value) > 180 || role === 'latitude' && Math.abs(value) > 90) {
          err(errors, fieldPath, '经纬度超出合法范围');
        }
      }
    }
  }
}

function checkTable(s,c,e) {
  const enc=s.encode, names=[]; for (const [role,val] of Object.entries(enc)) names.push(...(Array.isArray(val)?val:typeof val==='string'?[val]:[]));
  if (s.chart==='combo'&&Array.isArray(s.layers)) for (const l of s.layers) names.push(l.field);
  const fields = Object.assign(Object.create(null), Object.fromEntries(
    Object.entries(obj(s.fields) ? s.fields : {}).filter(([, field]) => obj(field)),
  ));
  for (const name of names) if (!s.data.every(row=>Object.hasOwn(row,name))) err(e,'/encode',`引用字段不存在：${name}`,'请修正 encode 字段名。');
  for (const [i,row] of s.data.entries()) for (const [k,value] of Object.entries(row)) {
    // Unreferenced fields remain inspectable, but cannot hide nested objects or invalid JSON numbers.
    if (!(value===null||typeof value==='string'||typeof value==='boolean'||finite(value)||Array.isArray(value)&&['density','outliers'].some(role=>s.encode?.[role]===k))) err(e,`/data/${i}/${k}`,'记录值必须是标量或图型明确允许的数组');
  }
  for (const [name,meta] of Object.entries(fields)) if (!s.data.some(row=>Object.hasOwn(row,name))) err(e,`/fields/${name}`,'元数据字段不在数据中');
  validateFieldMeta(s,fields,enc,e);
  for (const [role,name] of Object.entries(enc)) if (typeof name==='string'&&(role==='date'||fields[name]&&['date','month','datetime'].includes(fields[name].type))) for (const [i,row] of s.data.entries()) if (!safeDate(row[name],role==='date'?'date':fields[name].type)) err(e,`/data/${i}/${name}`,'非法日期或时间值');
  const nonNumericRoles=new Set(['category','series','id','panel','label','row','column','date']);
  const temporalStart=s.chart==='launch-fan'&&['date','month','datetime'].includes(fields[enc.start]?.type);
  if(temporalStart)nonNumericRoles.add('start');
  if(s.chart==='launch-fan'&&!['number','date','month','datetime'].includes(fields[enc.start]?.type))err(e,`/fields/${enc.start}/type`,'launch-fan.start必须显式声明number或时间类型');
  const values=[...new Set([...Object.entries(enc).filter(([role])=>!nonNumericRoles.has(role)).flatMap(([,name])=>Array.isArray(name)?name:typeof name==='string'?[name]:[]),...(s.chart==='combo'&&Array.isArray(s.layers)?s.layers.map(layer=>layer.field):[])])];
  for (const [i,row] of s.data.entries()) for (const name of values) if (Object.hasOwn(row,name)) {
    const v=row[name]; if (v===null&&!['line','area','sparkline','small-multiples','bump','combo'].includes(s.chart)) err(e,`/data/${i}/${name}`,'该图型不允许数值缺失'); if (v!==null&&!finite(v)&&!(Array.isArray(v)&&['density','outliers'].some(r=>enc[r]===name))) err(e,`/data/${i}/${name}`,'数值角色必须是有限JSON number或允许的数组');
    const type=fields[name]?.type; if (type&&['date','month','datetime'].includes(type)&&!safeDate(v,type)) err(e,`/data/${i}/${name}`,'非法日期或时间值');
    if (fields[name]?.scale==='log'&&finite(v)&&v<=0) err(e,`/data/${i}/${name}`,'log数值必须大于0');
  }
  for (const role of ['id']) if (typeof enc[role]==='string') unique(s.data.map(r=>r[enc[role]]),`/encode/${role}`,e,true);
  if(c.encodeForms.length&&!c.encodeForms.some(form=>form.length===Object.keys(enc).filter(k=>k==='value'||k==='panel').length&&form.every(k=>Object.hasOwn(enc,k)))) err(e,'/encode','small-multiples须使用value[]宽表或value+panel长表');
  if(s.chart==='small-multiples'&&(enc.panel?Array.isArray(enc.value):!Array.isArray(enc.value))) err(e,'/encode','宽表value须为字段数组；长表value须为单个字段并配panel');
  if(Array.isArray(enc.value)&&enc.value.length>6) err(e,'/encode/value','最多支持6个度量系列');
  if(['radar','parallel'].includes(s.chart)&&(enc.dimensions?.length<3||enc.dimensions?.length>6)) err(e,'/encode/dimensions','radar至少3维，parallel为3至6维');
  if(s.chart==='radar') for(const name of enc.dimensions||[]) if(!fields[name]?.domain) err(e,`/fields/${name}/domain`,`${s.chart}的每个维度都必须显式声明domain`);
  if (enc.category&&!['strip','scatter'].includes(s.chart)) {
    const seen=new Set();
    for (const row of s.data) {
      const key=[row[enc.category],enc.series?row[enc.series]:s.chart==='small-multiples'?row[enc.panel]:null];
      const k=JSON.stringify(key); if (seen.has(k)) err(e,'/data','重复的category/series组合'); seen.add(k);
    }
  }
  if (['interval', 'bullet', 'dumbbell', 'slope', 'candlestick'].includes(s.chart)) {
    for (const [i, r] of s.data.entries()) {
      const value = (role) => finite(r[enc[role]]) ? r[enc[role]] : NaN;
      if (s.chart === 'interval' && !(value('low') <= value('high')
        && (enc.value === undefined || value('value') >= value('low') && value('value') <= value('high')))) {
        err(e, `/data/${i}`, 'interval须满足low≤value≤high');
      }
      if (s.chart === 'candlestick' && !(value('low') <= Math.min(value('open'), value('close'))
        && Math.max(value('open'), value('close')) <= value('high'))) {
        err(e, `/data/${i}`, 'candlestick须满足low≤open/close≤high');
      }
      if (s.chart === 'bullet' && [enc.actual, enc.target].some(field => finite(r[field]) && r[field] < 0)) {
        err(e, `/data/${i}`, 'bullet数值须非负');
      }
    }
  }
  if (s.chart === 'histogram') {
    let previous = null;
    for (const [i, row] of s.data.entries()) {
      const lo = row[enc.lower], hi = row[enc.upper], count = row[enc.count];
      if (!(finite(lo) && finite(hi) && lo < hi && (previous === null || lo === previous) && finite(count) && count >= 0)) {
        err(e, `/data/${i}`, 'histogram箱须连续精确接壤、递增且count非负');
      }
      previous = hi;
    }
    if (s.variant === 'rungs' && s.data.length > 1 && s.data.every((row) => finite(row[enc.lower]) && finite(row[enc.upper]))) {
      const width = s.data[0][enc.upper] - s.data[0][enc.lower];
      if (s.data.some((row) => Math.abs((row[enc.upper] - row[enc.lower]) - width) > Math.max(1, Math.abs(width)) * 1e-9)) {
        err(e, '/data', 'histogram rungs要求等宽分箱；不等宽时请使用默认实心直方图');
      }
    }
  }
  if (s.chart === 'calendar') {
    const dates = new Set();
    for (const [i, row] of s.data.entries()) {
      const date = row[enc.date];
      if (typeof date === 'string' && date.slice(0, 4) !== s.period) {
        err(e, `/data/${i}/${enc.date}`, 'calendar日期须属于period指定年份');
      }
      if (dates.has(date)) err(e, `/data/${i}/${enc.date}`, 'calendar日期重复');
      dates.add(date);
    }
  }
  if (['line', 'area'].includes(s.chart) && (enc.lower || enc.upper)) {
    if (!enc.lower || !enc.upper || Array.isArray(enc.value) || enc.series || s.stack) {
      err(e, '/encode', '区间lower/upper仅支持非堆叠单度量');
    }
    if (enc.lower && enc.upper) {
      for (const [i, row] of s.data.entries()) {
        const lo = row[enc.lower], hi = row[enc.upper], value = row[enc.value];
        if (!((lo === null && hi === null && value === null)
          || (finite(lo) && finite(hi) && finite(value) && lo <= value && value <= hi))) {
          err(e, `/data/${i}`, 'lower/value/upper须同时缺失或满足lower≤value≤upper');
        }
      }
    }
  }
  if (s.chart === 'heatmap' || s.chart === 'bubble-matrix') {
    const cells = new Set();
    for (const [i, row] of s.data.entries()) {
      const cell = JSON.stringify([row[enc.row], row[enc.column]]);
      if (cells.has(cell)) err(e, `/data/${i}`, '矩阵单元格重复');
      cells.add(cell);
    }
  }
  if (['boxplot','violin'].includes(s.chart)) checkStats(s,e);
  checkTableLimits(s,e);
  const valueFields=Array.isArray(enc.value)?enc.value:typeof enc.value==='string'?[enc.value]:[];
  if(s.stack==='percent'&&valueFields.some(f=>s.data.some(r=>finite(r[f])&&r[f]<0)))err(e,'/data','percent stack不允许负值');
  const nonnegative=['share','pie','donut','radial-share','rose','funnel','waffle','tally','bullet','stream'];
  if(nonnegative.includes(s.chart)||['bar','column','dumbbell'].includes(s.chart)&&['rungs','pictorial'].includes(s.variant)) for(const f of valueFields) if(s.data.some(r=>finite(r[f])&&r[f]<0)) err(e,'/data','该图型或变体数值不可为负');
  if(s.chart==='bump') for(const [i,row] of s.data.entries()) if(row[enc.rank]!==null&&(!Number.isInteger(row[enc.rank])||row[enc.rank]<1))err(e,`/data/${i}/${enc.rank}`,'rank必须是正整数或null');
  if(s.chart==='launch-fan'&&s.data.some(row=>finite(row[enc.value])&&row[enc.value]<0))err(e,'/data','launch-fan当前量必须非负');
  if(s.chart==='bubble-matrix'&&s.data.some(row=>finite(row[enc.value])&&row[enc.value]<0))err(e,'/data','气泡矩阵面积值必须非负');
  if(s.chart==='radial-share') {
    for(const role of ['value','intensity']) {
      const name=enc[role],meta=fields[name];
      if(!obj(meta)||(meta.unit===undefined&&meta.format!=='percent'))err(e,`/fields/${name}`,'份额和强度必须分别声明单位或比例格式');
      if(s.data.some(row=>finite(row[name])&&row[name]<0)||!s.data.some(row=>finite(row[name])&&row[name]>0))err(e,`/encode/${role}`,'份额和强度须非负且各至少一个正值');
      if(meta?.domain&&meta.domain[0]!==0)err(e,`/fields/${name}/domain`,'强度/份额范围必须从0开始');
    }
  }
  if(s.chart==='heatmap'&&s.variant==='arc') {
    const meta=fields[enc.value];
    if(meta?.format!=='percent'&&!(Array.isArray(meta?.domain)&&meta.domain[0]===0&&meta.domain[1]>0))err(e,`/fields/${enc.value}`,'arc须使用比例格式或从0开始的数值范围');
    if (s.data.some((row) => finite(row[enc.value]) && (row[enc.value] < 0 || meta?.format === 'percent' && row[enc.value] > 1))) {
      err(e, '/data', 'arc数值必须位于0至整弧范围');
    }
  }
  if(s.chart==='combo'&&Array.isArray(s.layers)) {
    if(s.layers.length>6||!s.layers.some(layer=>layer.axis==='left'))err(e,'/layers','combo最多6层且必须有left轴');
    unique(s.layers.map(layer=>layer.field),'/layers/field',e,true);
    for(const [i,layer] of s.layers.entries())keys(layer,new Set(['mark','field','axis']),`/layers/${i}`,e);
  }
  if(s.chart==='dumbbell'&&s.variant==='rungs') for(const role of ['before','after']) if(s.data.some(r=>finite(r[enc[role]])&&r[enc[role]]<0)) err(e,'/data',`rungs的${role}须非负`);
  if(s.chart==='tally') {
    const meta=fields[enc.value]; if(meta?.format!=='percent') err(e,`/fields/${enc.value}/format`,'tally数值字段必须format=percent');
    if(s.data.some(r=>!finite(r[enc.value])||r[enc.value]<0||r[enc.value]>1)) err(e,'/data','tally每项须在0至1之间');
  }
  if (s.chart === 'funnel') {
    let previous = Infinity;
    for (const [i, row] of s.data.entries()) {
      const value = row[enc.value];
      if (!finite(value) || value < 0 || value > previous || i === 0 && value <= 0) {
        err(e, `/data/${i}/${enc.value}`, 'funnel须非负递减且首步大于0');
      }
      if (finite(value)) previous = value;
    }
  }
  if(s.chart==='gauge') {
    if(s.data.length!==1)err(e,'/data','gauge必须恰有一条记录');
    else if (Array.isArray(s.range) && s.range.length === 2 && s.range.every(finite)) {
      for (const role of ['value', 'target']) {
        const value = s.data[0][enc[role]];
        if (enc[role] && finite(value) && (value < s.range[0] || value > s.range[1])) {
          err(e, `/data/0/${enc[role]}`, 'gauge值与target必须位于range内');
        }
      }
    }
  }
  if(['scatter','strip'].includes(s.chart)&&enc.size&&s.data.some(r=>finite(r[enc.size])&&r[enc.size]<0))err(e,'/data','size必须非负');
  if(s.chart==='radar'&&valueFields.length&&s.data.some(r=>finite(r[enc.value])&&r[enc.value]<0))err(e,'/data','radar维度值须非负');
}
function validateFieldMeta(s,fields,enc,e) {
  const numeric=new Set([...Object.entries(enc).flatMap(([role,value])=>role==='dimensions'&&Array.isArray(value)?value:typeof value==='string'&&!['category','series','id','panel','label','row','column','date'].includes(role)?[value]:Array.isArray(value)?value:[]),...(s.chart==='combo'&&Array.isArray(s.layers)?s.layers.map(layer=>layer.field):[])]);
  const categorical=new Set(['category','series','panel','label','row','column','date'].map(role=>enc[role]).filter(x=>typeof x==='string'));
  const domainCharts=new Set(['line','area','bar','column','sparkline','small-multiples','combo','split-compare','scatter','strip','interval','bullet','dumbbell','slope','histogram','boxplot','violin','candlestick','parallel','radar','heatmap','bubble-matrix','radial-share','bump']);
  for(const [name,f]of Object.entries(fields)) {
    if(f.domain!==undefined) {
      if(!domainCharts.has(s.chart))err(e,`/fields/${name}/domain`,'该图型不支持domain');
      if(s.sort&&name===enc.category)err(e,'/sort','分类domain已确定顺序，不能同时sort');
      if(Array.isArray(f.domain)&&f.domain.every(finite)&&['bar','column','area','bullet','split-compare'].includes(s.chart)&&f.domain[0]>0)err(e,`/fields/${name}/domain`,'面积和柱条度量范围必须包含0');
      if (Array.isArray(f.domain) && f.domain.every(finite) && Array.isArray(s.annotations)) {
        for (const a of s.annotations) {
          if (!obj(a) || a.field !== name || !['rule', 'band'].includes(a.kind)) continue;
          const limits = a.kind === 'rule' ? [a.value] : [a.from, a.to];
          if (limits.some((v) => finite(v) && (v < f.domain[0] || v > f.domain[1]))) {
            err(e, `/fields/${name}/domain`, 'domain不得裁剪参考线或参考区间');
          }
        }
      }
      if(Array.isArray(f.domain)&&f.domain.length===2&&f.domain.every(finite)) {
        if(!numeric.has(name))err(e,`/fields/${name}/domain`,'数值domain只能用于数值角色');
        for(const row of s.data)if(finite(row[name])&&(row[name]<f.domain[0]||row[name]>f.domain[1]))err(e,`/fields/${name}/domain`,'domain不得裁剪数据');
      } else {
        if(!categorical.has(name))err(e,`/fields/${name}/domain`,'分类domain只能用于分类角色');
        if(Array.isArray(f.domain)&&s.data.some(row=>!f.domain.includes(row[name])))err(e,`/fields/${name}/domain`,'domain必须包含所有实际分类');
      }
    }
    if(f.scale!==undefined) {
      if(!numeric.has(name)||!domainCharts.has(s.chart))err(e,`/fields/${name}/scale`,'scale仅允许适用图型的数值角色');
      if(f.scale==='log'&&!['line','scatter','parallel'].includes(s.chart))err(e,`/fields/${name}/scale`,'log仅支持line/scatter/parallel');
      if(f.scale==='log'&&(s.data.some(row=>finite(row[name])&&row[name]<=0)||Array.isArray(f.domain)&&f.domain.some(v=>finite(v)&&v<=0)))err(e,`/fields/${name}/scale`,'log数据与domain必须大于0');
      if(f.scale==='log'&&s.stack)err(e,`/fields/${name}/scale`,'log坐标不支持堆叠');
    }
    if(f.type==='number'&&!numeric.has(name)||f.type==='category'&&!categorical.has(name))err(e,`/fields/${name}/type`,'字段type与编码角色不相符');
  }
  const valueNames=Array.isArray(enc.value)?enc.value:typeof enc.value==='string'?[enc.value]:[];
  const grouped=[...valueNames];
  if(s.chart==='bullet')grouped.push(enc.actual,enc.target);
  if(['dumbbell','slope'].includes(s.chart))grouped.push(enc.before,enc.after);
  if(s.chart==='interval')grouped.push(enc.low,enc.high,enc.value);
  if(s.chart==='candlestick')grouped.push(enc.open,enc.close,enc.low,enc.high);
  const rootUnit = typeof s.unit === 'string' ? s.unit : '';
  const sig = (name) => {
    const { unit, format } = fields[name] || {};
    return JSON.stringify([typeof unit === 'string' ? unit : rootUnit, format === 'percent' ? 'percent' : 'number']);
  };
  if(grouped.filter(Boolean).length>1&&new Set(grouped.filter(Boolean).map(sig)).size>1)err(e,'/fields','同一坐标轴的可比较度量必须单位和format一致');
  if(s.chart==='combo'&&Array.isArray(s.layers))for(const axis of ['left','right']){const names=s.layers.filter(l=>l.axis===axis).map(l=>l.field);if(new Set(names.map(sig)).size>1)err(e,'/layers',`${axis}轴的字段必须单位和format一致`);}
}
function checkTableLimits(s,e) {
  const enc=s.encode, rows=s.data, uniq=field=>new Set(rows.map(r=>r[field])).size;
  const categories=enc.category?uniq(enc.category):0;
  const limits={funnel:6,share:6,pie:6,donut:6,'radial-share':6,rose:6,waffle:6,tally:6,bullet:12,dumbbell:12,interval:12,boxplot:12,violin:12,slope:8,waterfall:16,histogram:40,scatter:1000,strip:1000,calendar:366,'candlestick':120,'launch-fan':24};
  if(limits[s.chart]!==undefined&&rows.length>limits[s.chart])err(e,'/data',`${s.chart}最多${limits[s.chart]}条记录`);
  if(['bar','column'].includes(s.chart)) {
    if(categories>60||s.chart==='bar'&&categories>24)err(e,'/data',`${s.chart}类别数超限`);
    if(categories>24&&(s.chart!=='column'||Array.isArray(enc.value)&&enc.value.length!==1||enc.series||!['solid',undefined].includes(s.variant)))err(e,'/data','25至60类仅支持单系列solid通栏column');
  }
  if(['line','area','sparkline','small-multiples','stream','split-compare','combo'].includes(s.chart)&&categories>120)err(e,'/data','时点最多120');
  if(s.chart==='small-multiples') {const panels=enc.panel?uniq(enc.panel):Array.isArray(enc.value)?enc.value.length:0;if(panels>6)err(e,'/data','small-multiples最多6面板');if(enc.panel){const counts=new Map();for(const r of rows)counts.set(r[enc.panel],(counts.get(r[enc.panel])||0)+1);for(const n of counts.values())if(n>120)err(e,'/data','每个small-multiples面板最多120时点');}}
  if(['heatmap','bubble-matrix'].includes(s.chart)&&(uniq(enc.row)>24||uniq(enc.column)>24))err(e,'/data','矩阵每轴最多24类');
  if(s.chart==='radar'||s.chart==='parallel')if(rows.length>24)err(e,'/data','多维图最多24实体');
  if(s.chart==='bump'&&(uniq(enc.series)>12||uniq(enc.category)>24))err(e,'/data','bump最多12实体、24时点');
}
function unique(arr,path,e,nonempty=false) { const set=new Set(); for (const x of arr) { if ((nonempty&&typeof x!=='string')||x===''||x===null||x===undefined) err(e,path,'身份必须是非空字符串'); else if (set.has(x)) err(e,path,`重复身份：${x}`); set.add(x); } }
function checkStats(s, e) {
  const en = s.encode;
  for (const [i, row] of s.data.entries()) {
    if (s.chart === 'boxplot') {
      const values = ['low', 'q1', 'median', 'q3', 'high'].map(key => row[en[key]]);
      if (values.every(finite) && !(values[0] <= values[1] && values[1] <= values[2]
        && values[2] <= values[3] && values[3] <= values[4])) {
        err(e, `/data/${i}`, '箱线统计值必须low≤q1≤median≤q3≤high');
      }
      if (en.outliers && Array.isArray(row[en.outliers])) {
        if (row[en.outliers].length > 200) {
          err(e, `/data/${i}/${en.outliers}`, '每组最多200个异常点');
        }
        if (values.every(finite) && row[en.outliers].some(value => !finite(value) || value >= values[0] && value <= values[4])) {
          err(e, `/data/${i}/${en.outliers}`, '异常值必须严格位于须线之外');
        }
      }
    } else {
      const density = row[en.density], median = row[en.median];
      if (!Array.isArray(density) || density.length < 2 || density.length > 120
        || density.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(finite) || point[1] < 0)
        || density.some((point, index) => index && point[0] <= density[index - 1][0])
        || !finite(median) || density.length && !(median >= density[0][0] && median <= density.at(-1)[0])) {
        err(e, `/data/${i}`, 'violin须提供2至120个递增的有限密度采样与范围内中位数');
        continue;
      }
      let integral = 0;
      for (let j = 1; j < density.length; j++) {
        integral += (density[j][0] - density[j - 1][0]) * (density[j][1] + density[j - 1][1]) / 2;
      }
      if (!(integral > 0)) err(e, `/data/${i}/${en.density}`, 'violin密度积分必须大于0');
    }
  }
}
function checkTree(rootNode, chart, e) {
  const ids = new Set(), seen = new Set();
  let count = 0;
  const walk = (node, path, depth) => {
    if (!obj(node)) {
      err(e, path, '树节点必须是对象');
      return 0;
    }
    if (seen.has(node)) {
      err(e, path, '树不允许共享节点或环');
      return finite(node.value) ? node.value : 0;
    }
    seen.add(node);
    if (depth > 5) {
      err(e, path, '超过树深度上限');
      return finite(node.value) ? node.value : 0;
    }
    count++;
    if (typeof node.label !== 'string' || !node.label) err(e, `${path}/label`, '节点label必填');
    for (const key of Object.keys(node)) {
      if (!['label', 'children', 'value', 'id', 'icon', 'note', ...(['mindmap', 'tree'].includes(chart) ? ['status'] : [])].includes(key)) {
        err(e, `${path}/${key}`, '未知节点字段');
      }
    }
    if (node.status !== undefined && ['mindmap', 'tree'].includes(chart)
      && !['new', 'info', 'ok', 'warn', 'danger', 'ext'].includes(node.status)) {
      err(e, `${path}/status`, '无效节点状态');
    }
    if (node.id !== undefined) {
      if (typeof node.id !== 'string' || !node.id || ids.has(node.id)) err(e, `${path}/id`, '节点ID须唯一非空');
      ids.add(node.id);
    }
    if (node.value !== undefined && (!finite(node.value) || node.value < 0)) {
      err(e, `${path}/value`, '节点权重须为非负有限数');
    }
    if (node.children !== undefined && !Array.isArray(node.children)) err(e, `${path}/children`, 'children须为数组');
    const children = Array.isArray(node.children) ? node.children : [];
    const sum = children.reduce((total, child, i) => total + walk(child, `${path}/children/${i}`, depth + 1), 0);
    if (children.length && node.value !== undefined && finite(node.value)
      && Math.abs(node.value - sum) > 1e-9 * Math.max(1, node.value, sum)) {
      err(e, `${path}/value`, '父节点value必须等于子树叶子合计');
    }
    if (['treemap', 'sunburst'].includes(chart) && !children.length
      && (!finite(node.value) || node.value < 0)) {
      err(e, path, '层级面积图叶子必须有非负value');
    }
    return finite(node.value) ? node.value : sum;
  };
  walk(rootNode, '/data', 1);
  if (count > 80) err(e, '/data', '超过80节点上限');
}
function checkNetwork(d,chart,e) {
  const rawNodes=d.nodes||[],rawEdges=d.edges||[];
  rawNodes.forEach((n,i)=>{if(!obj(n))err(e,`/data/nodes/${i}`,'节点必须是对象');});
  rawEdges.forEach((x,i)=>{if(!obj(x))err(e,`/data/edges/${i}`,'边必须是对象');});
  const nodes=rawNodes.filter(obj),edges=rawEdges.filter(obj);
  const ids=new Set(nodes.map(n=>n.id));
  unique(nodes.map(n=>n?.id),'/data/nodes/id',e,true);
  for(const [i,n] of rawNodes.entries()) {
    if(!obj(n))continue;
    for(const k of Object.keys(n))if(!['id','label','group','value','stage','icon','note'].includes(k))err(e,`/data/nodes/${i}/${k}`,'未知节点字段');
    if(n.label!==undefined&&typeof n.label!=='string')err(e,`/data/nodes/${i}/label`,'label须为字符串');
    if(n.value!==undefined&&!finite(n.value))err(e,`/data/nodes/${i}/value`,'value须为有限数');
    if(chart==='sankey'&&n.value!==undefined)err(e,`/data/nodes/${i}/value`,'sankey禁用node.value');
    if(n.stage!==undefined&&(!Number.isInteger(n.stage)||n.stage<0))err(e,`/data/nodes/${i}/stage`,'stage须为非负整数');
  }
  const edgeIds=[];
  for(const [i,x]of rawEdges.entries()){
    if(!obj(x))continue;
    for(const k of Object.keys(x))if(!['source','target','id','label','value'].includes(k))err(e,`/data/edges/${i}/${k}`,'未知边字段');
    if(!ids.has(x.source)||!ids.has(x.target))err(e,`/data/edges/${i}`,'边必须引用已声明节点');
    if(x.label!==undefined&&typeof x.label!=='string')err(e,`/data/edges/${i}/label`,'label须为字符串');
    if(x.id!==undefined)edgeIds.push(x.id);
    if(chart==='sankey'&&(!finite(x.value)||x.value<=0||x.source===x.target))err(e,`/data/edges/${i}/value`,'Sankey边值须为正且不可自环');
    else if(chart==='network'&&x.value!==undefined&&!finite(x.value))err(e,`/data/edges/${i}/value`,'边value须为有限数');
  }
  unique(edgeIds,'/data/edges/id',e,true);
  const pairCounts=new Map();for(const x of edges){const key=JSON.stringify([x.source,x.target]);pairCounts.set(key,(pairCounts.get(key)||0)+1);}
  for(const [i,x] of rawEdges.entries())if(obj(x)&&pairCounts.get(JSON.stringify([x.source,x.target]))>1&&x.id===undefined)err(e,`/data/edges/${i}/id`,'平行边必须提供唯一id');
  if(chart==='sankey'){
    const stage=new Map(nodes.map(n=>[n.id,n.stage]));
    const specified=nodes.filter(n=>n.stage!==undefined).length;
    if(specified&&specified!==nodes.length)err(e,'/data/nodes','stage不可部分指定');
    const ins=new Map(),outs=new Map(),indegree=new Map(nodes.map(n=>[n.id,0])),next=new Map(nodes.map(n=>[n.id,[]]));
    for(const x of edges){
      if(specified&&!(Number.isInteger(stage.get(x.source))&&Number.isInteger(stage.get(x.target))&&stage.get(x.target)>stage.get(x.source)))err(e,'/data/edges','Sankey边必须指向更高stage');
      if (finite(x.value)) {
        ins.set(x.target, (ins.get(x.target) || 0) + x.value);
        outs.set(x.source, (outs.get(x.source) || 0) + x.value);
      }
      if(ids.has(x.source)&&ids.has(x.target)){next.get(x.source).push(x.target);indegree.set(x.target,(indegree.get(x.target)||0)+1);}
    }
    const ready=[...indegree].filter(([,n])=>n===0).map(([id])=>id);let visited=0;
    while(ready.length){const id=ready.pop();visited++;for(const to of next.get(id)){indegree.set(to,indegree.get(to)-1);if(indegree.get(to)===0)ready.push(to);}}
    if(visited!==nodes.length)err(e,'/data/edges','Sankey必须是DAG，不允许环');
    for(const n of nodes){const a=ins.get(n.id)||0,b=outs.get(n.id)||0;if(a&&b&&Math.abs(a-b)>1e-9*Math.max(1,a,b))err(e,'/data/nodes','Sankey中间节点流量不守恒');}
  }
}
function checkPaths(d,e){
  const stages=d.stages.filter(obj),nodes=d.nodes.filter(obj),paths=d.paths.filter(obj);
  for(const [i,x]of d.stages.entries())if(!obj(x))err(e,`/data/stages/${i}`,'stage必须是对象');
  for(const [i,x]of d.nodes.entries())if(!obj(x))err(e,`/data/nodes/${i}`,'path node必须是对象');
  for(const [i,x]of d.paths.entries())if(!obj(x))err(e,`/data/paths/${i}`,'path必须是对象');
  unique(stages.map(x=>x.id),'/data/stages/id',e,true);unique(nodes.map(x=>x.id),'/data/nodes/id',e,true);unique(paths.map(x=>x.id),'/data/paths/id',e,true);
  stages.forEach((x,i)=>{for(const k of Object.keys(x))if(!['id','label'].includes(k))err(e,`/data/stages/${i}/${k}`,'未知stage字段');if(typeof x.label!=='string')err(e,`/data/stages/${i}/label`,'label必填');});
  const stage=new Map(stages.map((x,i)=>[x.id,i])),nodeMap=new Map(nodes.map(x=>[x.id,x]));
  nodes.forEach((n,i)=>{for(const k of Object.keys(n))if(!['id','label','stage'].includes(k))err(e,`/data/nodes/${i}/${k}`,'未知路径节点字段');if(!stage.has(n.stage))err(e,`/data/nodes/${i}/stage`,'节点stage不存在');if(typeof n.label!=='string')err(e,`/data/nodes/${i}/label`,'label必填');});
  for(const [i,p]of d.paths.entries())if(obj(p)){for(const k of Object.keys(p))if(!['id','nodes','value','note'].includes(k))err(e,`/data/paths/${i}/${k}`,'未知path字段');if(p.note!==undefined&&typeof p.note!=='string')err(e,`/data/paths/${i}/note`,'note须为字符串');if(!Array.isArray(p.nodes)||p.nodes.length<2){err(e,`/data/paths/${i}/nodes`,'路径至少包含两个节点');continue;}let prev=-1;for(const id of p.nodes){const n=nodeMap.get(id),at=stage.get(n?.stage);if(!n||at===undefined||at<=prev){err(e,`/data/paths/${i}/nodes`,'路径节点须按阶段严格前进');continue;}prev=at;}if(p.value!==undefined&&(!finite(p.value)||p.value<=0))err(e,`/data/paths/${i}/value`,'路径权重须为正有限数');}
}
function location(text, offset) {
  const before = text.slice(0, offset);
  return { offset, line: before.split('\n').length, column: offset - before.lastIndexOf('\n') };
}

// 只扫描已通过 JSON.parse 语法检查的文本。键名解码后比较，用显式栈保留嵌套路径。
function checkDuplicateKeys(text, errors) {
  const stack = [];
  const tokens = /"(?:[^"\\]|\\.)*"|[{}\[\]:,]|[^\s{}\[\]:,"]+/g;
  for (const match of text.matchAll(tokens)) {
    const [token] = match;
    const frame = stack.at(-1);
    if (token === '}' || token === ']') {
      stack.pop();
    } else if (token === ',') {
      if (frame.keys) frame.key = undefined;
    } else if (token !== ':') {
      if (frame?.keys && frame.key === undefined) {
        const key = JSON.parse(token);
        if (frame.keys.has(key)) {
          const path = ptr([...stack.slice(1).map((entry) => entry.at), key]);
          err(errors, path, `重复 JSON 属性：${key}`, '删除重复属性并保留唯一值。', 'BAD_KCHART', location(text, match.index));
        }
        frame.keys.add(key);
        frame.key = key;
      } else {
        const at = frame?.keys ? frame.key : frame ? frame.next++ : undefined;
        if (token === '{') stack.push({ at, keys: new Set() });
        if (token === '[') stack.push({ at, next: 0 });
      }
    }
  }
}

function parse(text) {
  const errors = [];
  if (typeof text !== 'string') {
    err(errors, '', '输入必须是 JSON 文本', '提供合法的 JSON 字符串。');
    return { errors, data: null };
  }
  let spec;
  try {
    spec = JSON.parse(text);
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) throw cause;
    const offset = Number(/position (\d+)/.exec(cause.message)?.[1] ?? 0);
    err(errors, '', `JSON 语法错误：${cause.message}`, '修正 JSON 语法。', 'BAD_KCHART', location(text, offset));
    return { errors, data: null };
  }
  checkDuplicateKeys(text, errors);
  return errors.length ? { errors, data: null } : validate(spec);
}
function schema(chart){
  if (chart !== undefined && (typeof chart !== 'string' || !catalog[chart])) throw new TypeError('未知图型，请从图型目录中选择');
  const properties={chart:{type:'string',enum:chart === undefined ? Object.keys(catalog) : [chart]},title:{type:'string'},subtitle:{type:'string'},source:{type:'string'},note:{type:'string'},unit:{type:'string',not:{const:'%'}},variant:{type:'string'},layout:{type:'string'},data:{},encode:{type:'object',additionalProperties:{type:['string','array']}},fields:{type:'object',additionalProperties:{type:'object',properties:{label:{type:'string'},type:{enum:['number','category','date','month','datetime']},unit:{type:'string'},format:{enum:['number','percent']},decimals:{type:'integer',minimum:0,maximum:6},domain:{type:'array'},scale:{enum:['linear','log']}},additionalProperties:false}},sort:{type:'object',properties:{field:{type:'string'},direction:{enum:['asc','desc']}},required:['field','direction'],additionalProperties:false},emphasis:{type:'object'},annotations:{type:'array'},interaction:{type:'array',items:{enum:['inspect','legend','focus','pan-zoom','drag','collapse']}},stack:{enum:['absolute','percent']},unitMark:{type:'object'},range:{type:'array',minItems:2,maxItems:2,items:{type:'number'}},start:{type:'number'},layers:{type:'array'},period:{type:'string',pattern:'^\\d{4}$'},directed:{type:'boolean'}};
  const entries=Object.values(catalog).filter(c=>chart === undefined || c.name === chart);
  const anyOf=entries.map(c=>{
    const base={required:['chart','data'],properties:{chart:{const:c.name}}};
    if(c.shape==='table'||c.shape==='geo'){
      base.required.push('encode');
      base.properties.data=c.shape==='table'?{type:'array',minItems:1,items:{type:'object'}}:{type:'object',required:['map','rows'],properties:{map:{type:'object'},rows:{type:'array'}},additionalProperties:false};
      const roles=[...c.required,...c.optional];
      const roleSchema=role=>role==='dimensions'?{type:'array',minItems:3,items:{type:'string'}}:
        c.arrayRoles.includes(role)?{oneOf:[{type:'string'},{type:'array',items:{type:'string'},minItems:1}]}:{type:'string'};
      base.properties.encode={type:'object',required:c.required,properties:Object.fromEntries(roles.map(role=>[role,roleSchema(role)])),additionalProperties:false};
      if(c.encodeForms.length)base.properties.encode.oneOf=c.encodeForms.map(form=>({required:form,properties:{value:form.includes('panel')?{type:'string'}:{type:'array',items:{type:'string'},minItems:1}}}));
    } else {
      base.properties.encode=false;
      base.properties.data=c.shape==='tree'?{type:'object',required:['label']}:
        c.shape==='network'?{type:'object',required:['nodes','edges'],properties:{nodes:{type:'array'},edges:{type:'array'}},additionalProperties:false}:
        {type:'object',required:['stages','nodes','paths'],properties:{stages:{type:'array'},nodes:{type:'array'},paths:{type:'array'}},additionalProperties:false};
    }
    return base;
  });
  const schemaFor=value=>Array.isArray(value)?{enum:value}:value==='boolean'?{type:'boolean'}:value==='number'?{type:'number'}:value==='year'?{type:'string',pattern:'^[0-9]{4}$'}:value==='range'?{type:'array',minItems:2,maxItems:2,items:{type:'number'}}:value==='layers'?{type:'array',items:{type:'object',required:['mark','field','axis'],properties:{mark:{enum:['line','area','column']},field:{type:'string'},axis:{enum:['left','right']}},additionalProperties:false}}:{type:'string'};
  const allOf=entries.map(c=>{
    const special=Object.fromEntries(Object.entries(c.special).map(([k,v])=>[k,schemaFor(v)]));
    if(['bar','column','dumbbell','waterfall','histogram'].includes(c.name)) special.unitMark={type:'object',required:['value','label'],properties:{value:{type:'number',exclusiveMinimum:0},label:{type:'string',minLength:1},icon:{type:'string'}},additionalProperties:false};
    for(const field of ['variant','stack','layout','directed','range','start','layers','period','unitMark']) if(special[field]===undefined) special[field]=false;
    return {if:{properties:{chart:{const:c.name}},required:['chart']},then:{properties:special,required:[...c.requiredSpecial,...Object.entries(c.special).filter(([,v])=>v==='range').map(([k])=>k)]}};
  });
  const schema = {type:'object',properties,required:['chart','data'],additionalProperties:false,anyOf,allOf};
  if (chart === undefined || chart === 'mindmap' || chart === 'tree') {
    const nodeSchema = chartType => ({
      type:'object', required:['label'], additionalProperties:false,
      properties:{ label:{type:'string'}, id:{type:'string'}, note:{type:'string'}, value:{type:'number',minimum:0}, icon:{type:'string'}, status:{enum:['new','info','ok','warn','danger','ext']}, children:{type:'array',items:{$ref:`#/$defs/${chartType}Node`}} },
    });
    schema.$defs = {};
    if (chart === undefined || chart === 'mindmap') schema.$defs.mindmapNode = nodeSchema('mindmap');
    if (chart === undefined || chart === 'tree') schema.$defs.treeNode = nodeSchema('tree');
    for (const chartType of ['mindmap', 'tree']) {
      if (chart !== undefined && chart !== chartType) continue;
      const branch = schema.anyOf.find(item => item.properties.chart.const === chartType);
      if (branch) branch.properties.data = {$ref:`#/$defs/${chartType}Node`};
    }
  }
  return schema;
}

export { parse, validate, schema };
