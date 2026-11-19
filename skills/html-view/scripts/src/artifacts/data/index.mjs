import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render as renderKChart, theme as kchartTheme } from '../../../../kchart/node.mjs';
import { renderShell, parseShell, auditShell } from '../../shared/shell.mjs';
import { vizMarkup, auditViz } from '../../shared/viz.mjs';
import { markdownToContent } from '../../shared/markdown.mjs';
import { auditContent } from '../../shared/static-audit.mjs';
import { escapeHtml, scanElements, innerHtml, decodeEntities } from '../../shared/html-util.mjs';
import { getTheme } from '../../shared/themes.mjs';
import { emit, fail, ToolError } from '../../shared/output.mjs';
import { parseArgs } from '../../shared/args.mjs';
import { inferLang } from '../../shared/locale.mjs';
import { bindText } from './bindings.mjs';
import { formatDelta, formatValue } from './format.mjs';
import { compareMonth } from './period.mjs';
import { computeReport, displaySpec, fingerprint, periodOf, resolveVizReference, CODES, issue } from './compute.mjs';
import { DataPackageError, loadDataPackage } from './load.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const escape=escapeHtml;
// 叙述里的 HTML 片段在 validate 阶段就按 audit 的内容规则检查：build 不写出 audit 会拒绝的报表。
// 标题层级、锚点、id 和页面标题要看整页才能判断，留给 build 后的 audit。
const PAGE_CONTEXT_CODES=new Set(['HEADING_SKIP','BROKEN_ANCHOR','DUPLICATE_ID','TITLE_MISMATCH']);
let dataCss;
async function narrativeMarkupIssues(content,where){dataCss??=await readFile(path.resolve(here,'../../../../assets/page/data.css'),'utf8');return auditContent(content,{kind:'data',css:dataCss}).failures.filter(item=>!PAGE_CONTEXT_CODES.has(item.code)).map(item=>issue(CODES.BAD_TEXT,'error',where,`叙述 Markdown 中的 HTML 不能通过 audit（${item.code}）：${item.detail}`,item.fix||'改用 Markdown 写法，或删除该 HTML'));}
const optionsSpec={force:{type:'boolean'},out:{type:'string'},theme:{type:'string'},lang:{type:'string'}};
const failure=(code,detail,file,fix,where=null)=>({code,where:{line:null,part:file||null,selector:where},detail,fix,ref:'references/artifacts/data-package.md'});
const reportIssue=(item,fallback)=>({code:item.code,where:{line:null,part:item.file||fallback||null,selector:item.where||null},detail:item.message,fix:item.fix,ref:'references/artifacts/data-package.md'});
function parseCli(argv,range,usage,allowed=[]){const selected=Object.fromEntries(allowed.map(name=>[name,optionsSpec[name]]));const parsed=parseArgs(argv,selected,{positionals:range,usage});return{positionals:parsed.positionals,values:parsed.values};}
function failInput(code,message,next,details){fail(code,message,{next,details});}
async function safe(operation){try{return await operation();}catch(error){if(error instanceof DataPackageError||error?.code==='BAD_PERIOD'||error?.code==='BAD_VIZ'||error?.code==='BAD_TEXT'){const mapping={BAD_VIZ:'BAD_TEXT',BAD_KCHART:'BAD_VIZ',BAD_TIMEZONE:'BAD_SCHEMA',NOT_FOUND:'FILE_NOT_FOUND',IO_ERROR:'BAD_FILE',CSV_PARSE:'BAD_FILE',JSON_PARSE:'BAD_FILE',DUPLICATE_KEY:'DATA',BAD_KIND:'DATA',INCOMPLETE_TOTAL:'DATA',TOTAL_MISMATCH:'DATA'};const allowed=new Set(['USAGE','FILE_NOT_FOUND','SOURCE_NOT_FOUND','NODE_TOO_OLD','INTERNAL','UNKNOWN_TYPE','UNKNOWN_THEME','FILE_EXISTS','KIND_MISMATCH','SOURCE_MISMATCH','BAD_SHELL','NOT_UI','BAD_VALUE','BAD_THEME','BROWSER_NOT_FOUND','BROWSER_FAILED','DATA_INTEGRITY','BAD_SCHEMA','BAD_FILE','BAD_PATH','BAD_VIZ','BAD_TEXT','DATA','AUDIT','ENVIRONMENT']);const code=mapping[error.code]||(allowed.has(error.code)?error.code:'BAD_FILE');const details={...(error.details||{}),...(error.code!==code?{dataCode:error.code}:{}),...(error.file?{path:error.file}:{})};fail(code,error.message,{next:error.fix||error.next||'核对报错指出的路径和字段后修正',details:Object.keys(details).length?details:undefined});}if(error?.code==='ENOENT'||error?.code==='EACCES')fail(error.code==='ENOENT'?'FILE_NOT_FOUND':'BAD_FILE',`无法访问 ${error.path||''}：${error.message}`,{next:'检查原路径、文件是否存在及权限',details:{path:error.path}});throw error;}}
function narrativeHeadingIssues(text,file,where){const issues=[];let fence=null;for(const[index,line]of String(text||'').split(/\r?\n/).entries()){const mark=/^ {0,3}(`{3,}|~{3,})/.exec(line);if(mark){fence=fence===null?mark[1][0]:null;continue;}if(fence===null&&/^ {0,3}#{1,2}\s+/.test(line))issues.push(issue(CODES.NARRATIVE_HEADING,'error',`${where}:line:${index+1}`,'叙述不可包含一级或二级标题；页面标题由 report.json title 提供','移除一级/二级标题，使用 ### 小标题'));}for(const item of issues)item.file=file;return issues;}
function blockRefMap(computed,view,lang='zh-CN'){return new Map(view.blocks.filter(block=>block.type==='chart'&&block.id&&block.spec).map(block=>{const spec={...block.spec};const title=bindText(typeof spec.title==='string'?spec.title:'',computed,{dataset:block.dataset,view:view.id,lang});const subtitle=bindText(typeof spec.subtitle==='string'?spec.subtitle:'',computed,{dataset:block.dataset,view:view.id,lang});spec.title=title.text||spec.chart;if(spec.subtitle)spec.subtitle=subtitle.text;return[block.id,{spec,dataset:block.dataset,block}];}));}
function checkedRender(spec,theme,where){const result=renderKChart(spec,{theme,width:820,lang:'zh-CN'});if(result.diagnostics?.length)throw new DataPackageError('BAD_KCHART',`图表 ${where} 渲染/布局失败：${result.diagnostics.map(d=>d.message).join('；')}`,null,'按 KChart 诊断修正图型、字段或数据');if(!result.svg)throw new DataPackageError('BAD_KCHART',`图表 ${where} 未生成 SVG`,null,'按当前 KChart catalog/schema 修正 chart+encode');return result;}
function bindNarrative(text,computed,scope,evidence){const bound=bindText(text,computed,scope);evidence.bindings.push(...bound.bindings);const used=new Set();let matchIndex=0;const prepared=String(text).replace(/\{\{\s*[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*){1,2}\s*\}\}/g,token=>{const key=token.slice(2,-2).trim(),bindingIndex=bound.bindings.findIndex((item,index)=>!used.has(index)&&item.token===key);if(bindingIndex<0)return token;used.add(bindingIndex);const binding=bound.bindings[bindingIndex];matchIndex++;const marker=`HVBind${evidence.units.length+1}Token${matchIndex}End`;evidence.units.push({id:`e${evidence.units.length+1}`,kind:'binding',measure:`${binding.dataset}.${binding.measure}`,view:binding.view,value:binding.raw,display:binding.display,marker});return marker;});return{prepared,issues:bound.issues,bindings:bound.bindings};}
function bindMarkers(html,evidence){return html.replace(/HVBind\d+Token\d+End/g,marker=>{const unit=evidence.units.find(item=>item.marker===marker);if(!unit)return marker;delete unit.marker;return `<span data-evidence="${unit.id}" data-value="${unit.value==null?'':escape(unit.value)}" data-measure="${escape(unit.measure)}" data-view="${escape(unit.view)}">${escape(unit.display)}</span>`;});}
function prefixNarrativeIds(html,prefix){const ids=new Map();let result=html.replace(/\bid="([^"]+)"/g,(all,id)=>{const next=`${prefix}-${id}`;ids.set(id,next);return `id="${escape(next)}"`;});result=result.replace(/\b(href)="#([^"]+)"/g,(all,name,id)=>`${name}="#${escape(ids.get(id)||id)}"`).replace(/\b(aria-labelledby|aria-describedby|headers|for)="([^"]+)"/g,(all,name,value)=>`${name}="${value.split(/\s+/).map(id=>escape(ids.get(id)||id)).join(' ')}"`);return result;}
function removeMarkdownHeader(content){const header=scanElements(content).find(element=>element.name==='header'&&element.parent===null);return header?content.slice(0,header.start)+content.slice(header.end):content;}
function renderNarrative(block, view, computed, refs, theme, lang, evidence) {
  const { prepared, issues } = bindNarrative(block.text || '', computed, { dataset: block.dataset, view: view.id, lang }, evidence);
  evidence.issues.push(...issues);
  const invalid = issues.find((item) => item.severity === 'error');
  if (invalid) throw new DataPackageError(invalid.code, invalid.message, block.filePath, invalid.fix);
  if (/<\s*(?:script|style|link)\b/i.test(prepared)) throw new DataPackageError('BAD_TEXT', '叙述 Markdown 不允许 script、style 或 link 标签', block.filePath, '删除活动标签后重新 build');
  const prefix = `narrative-${view.id}-${block.sourceIndex ?? 0}`;
  const { content } = markdownToContent(prepared, {
    lang, baseDir: block.filePath ? path.dirname(block.filePath) : process.cwd(), title: null,
    renderViz(syntax, source) {
      if (syntax !== 'kchart') throw new DataPackageError('BAD_TEXT', `报表叙述只允许 KChart ref，不接受 ${syntax}`, block.filePath, '使用 kchart fence 并只写 {"ref":"图表块 id"}');
      const id = resolveVizReference(source, refs), target = refs.get(id);
      checkedRender(target.spec, theme, `ref ${id}`);
      const alias = `ref-${view.id}-${id}-${evidence.references.length + 1}`;
      const declaration = JSON.stringify(target.spec);
      evidence.references.push({
        ref: id, view: view.id, sourceId: `${prefix}-${alias}`, sourceDataset: target.dataset,
        sourceDataSha256: fingerprint(JSON.stringify(target.spec.data)), sourceSpecSha256: fingerprint(declaration),
      });
      return vizMarkup('kchart', declaration, { id: alias });
    },
  });
  return bindMarkers(prefixNarrativeIds(removeMarkdownHeader(content), prefix), evidence);
}
function evidenceSpan(evidence,display,{measure,view,kind='value',value=null}={}){const id=`e${evidence.units.length+1}`;evidence.units.push({id,kind,measure,view,value,display:String(display)});return `<span data-evidence="${id}" data-value="${value==null?'':escape(value)}" data-measure="${escape(measure)}" data-view="${escape(view)}">${escape(display)}</span>`;}
function isPercent(spec){return spec!=null&&displaySpec(spec).format==='percent';}
function unitLabel(label,spec,lang){const unit=isPercent(spec)?'':spec?.unit;return unit?(/^en\b/i.test(lang)?`${label} (${unit})`:`${label}（${unit}）`):label;}
function tableBlock(block,view,computed,report,lang,evidence){const dataset=computed.datasets.find(item=>item.id===block.dataset);const rows=(view.blocks.find(item=>item.type==='table'&&item.sourceIndex===block.sourceIndex)?.rows||[]);const headers=block.columns.map(name=>unitLabel(dataset.measures?.[name]?.label||dataset.dimensions?.[name]?.label||name,dataset.measures?.[name],lang));const tableId=`tbl-${view.id}-${block.sourceIndex}`;const body=rows.map(row=>`<tr>${block.columns.map(name=>{const spec=dataset.measures?.[name];let value=row[name]??null;if(spec?.kind==='ratio'||spec?.kind==='mean'){const denominator=row[spec.denominator],numerator=row[spec.numerator];value=Number.isFinite(numerator)&&Number.isFinite(denominator)&&denominator!==0?numerator/denominator:null;}if(spec){const shown=formatValue(value,{...displaySpec(spec),unit:'',lang,exact:true});return `<td class="num" data-sort="${value==null?'':escape(value)}" data-sort-null="${value==null?'true':'false'}">${evidenceSpan(evidence,shown,{measure:`${dataset.id}.${name}`,view:view.id,kind:'table',value})}</td>`;}return `<td>${escape(value??'—')}</td>`;}).join('')}</tr>`).join('');const table=`<table data-sortable="true" data-evidence-table="${tableId}" data-measure="${escape(block.columns.join(','))}" data-view="${escape(view.id)}"><thead><tr>${headers.map((header,i)=>`<th scope="col"${dataset.measures?.[block.columns[i]]?' class="num"':''}>${escape(header)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;evidence.tables.push({id:tableId,view:view.id,measures:block.columns,sha256:fingerprint(table),kind:'table'});const period=periodOf(dataset)===null?'':(lang.startsWith('en')?` (${report.period.current})`:`（${report.period.current}）`);const fallback=dataset.label||(lang.startsWith('en')?'Data table':'数据表');return `<section><h2>${escape(block.title||`${fallback}${period}`)}</h2><div class="data-table-scroll">${table}</div></section>`;}
function metricSection(block,view,report,lang,evidence){const dataset=report.datasets.find(item=>item.id===block.dataset),metrics=view.datasets?.[block.dataset]||{};const cards=block.measures.map(name=>{const metric=metrics[name],spec=dataset.measures[name],number=formatValue(metric?.value??null,{format:metric?.displaySpec?.format||'number',decimals:metric?.decimals,lang});const numberMarkup=evidenceSpan(evidence,number,{measure:`${block.dataset}.${name}`,view:view.id,kind:'kpi',value:metric?.value??null});const unit=isPercent(spec)?'':spec.unit;const unitMarkup=unit?`${/^\p{Script=Han}/u.test(unit)?'':' '}<span class="data-kpi-unit">${escape(unit)}</span>`:'';const comparisons=Object.entries(metric?.comparisons||{}).map(([kind,comparison])=>`<p class="data-kpi-comparison"><span>${kind==='mom'?(lang.startsWith('en')?'MoM':'环比'):(lang.startsWith('en')?'YoY':'同比')}</span> ${evidenceSpan(evidence,formatDelta(comparison,{...metric.displaySpec,lang}),{measure:`${block.dataset}.${name}.${kind}`,view:view.id,kind:'comparison',value:comparison.status==='ok'?comparison.rate??comparison.delta??null:null})}</p>`).join('');return `<article class="data-kpi"><h3 class="data-kpi-name">${escape(metric?.label||name)}</h3><p class="data-kpi-value">${numberMarkup}${unitMarkup}</p>${comparisons}</article>`;}).join('');const period=periodOf(dataset)===null?'':(lang.startsWith('en')?` (${report.period.current})`:`（${report.period.current}）`);return `<section><h2>${lang.startsWith('en')?'Key metrics':'关键指标'}${period}</h2><div data-kpis data-count="${block.measures.length}">${cards}</div></section>`;}
function renderChart(block, declaration, view, computed, theme, lang, evidence, narrativeSourceId) {
  const spec = { ...declaration };
  const bindingOptions = { dataset: block.dataset, view: view.id, lang };
  const bindHeading = (text) => {
    const result = bindText(typeof text === 'string' ? text : '', computed, bindingOptions);
    evidence.bindings.push(...result.bindings);
    for (const item of result.issues) {
      evidence.issues.push(item);
      if (item.severity === 'error') throw new DataPackageError(item.code, item.message, null, item.fix);
    }
    return result.text;
  };
  spec.title = bindHeading(spec.title) || spec.chart;
  if (spec.subtitle) spec.subtitle = bindHeading(spec.subtitle);
  if (!narrativeSourceId) checkedRender(spec, theme, `blocks[${block.sourceIndex}]`);
  const id = narrativeSourceId ?? `chart-${view.id}-${block.sourceIndex}`;
  const source = JSON.stringify(spec);
  evidence.charts.push({
    id: block.id || null, sourceId: id, view: view.id, dataset: block.dataset,
    sourceDataSha256: fingerprint(JSON.stringify(spec.data)), sourceSpecSha256: fingerprint(source), displayed: !narrativeSourceId,
  });
  return narrativeSourceId ? '' : vizMarkup('kchart', source, { id });
}
function sourceAndDefinitions(report,view,lang){const en=lang.startsWith('en'),punc=en?{field:': ',sep:'; ',list:', ',wrap:value=>` (${value})`}:{field:'：',sep:'；',list:'、',wrap:value=>`（${value}）`};const baseline=(report.period.compare||[]).map(kind=>`${kind==='mom'?(en?'MoM':'环比'):(en?'YoY':'同比')}${punc.wrap(compareMonth(report.period.current,kind))}`).join(punc.list)||'—';const labels=en?{sources:'Source and definitions',period:'Period',baseline:'Comparison baseline',timezone:'Time zone',complete:'complete',incomplete:'incomplete',source:'Source',query:'Query / notes',pulled:'Extracted at',units:'Units and definitions'}:{sources:'来源与口径',period:'时间',baseline:'对比基准',timezone:'时区',complete:'完整',incomplete:'不完整',source:'来源',query:'查询 / 说明',pulled:'提取时间',units:'单位与口径'};const sources=report.sources.map(source=>`<tr><th>${escape(source.name)}</th><td>${escape(source.query||source.description||'')}</td><td>${escape(source.pulledAt||'')}</td></tr>`).join('');const definitions=report.datasets.map(dataset=>`<h3>${escape(report.datasets.length===1?labels.units:dataset.label||dataset.id)}</h3><ul>${Object.entries(dataset.measures).map(([name,spec])=>`<li>${escape(spec.label||name)}${spec.unit?punc.wrap(escape(spec.unit)):''}${punc.field}${escape(spec.definition)}</li>`).join('')}</ul>`).join('');return `<section data-meta-section="sources"><h2>${labels.sources}</h2><p>${labels.period}${punc.field}${escape(report.period.current)}${punc.sep}${labels.baseline}${punc.field}${escape(baseline)}</p><p>${labels.timezone}${punc.field}${escape(report.period.timezone)}${punc.sep}${escape(report.period.complete?labels.complete:labels.incomplete)}</p><div class="fig-body data-source-table"><table><thead><tr><th>${labels.source}</th><th>${labels.query}</th><th>${labels.pulled}</th></tr></thead><tbody>${sources}</tbody></table></div>${definitions}</section>`;}
const WIDE_FRIENDLY = ['line', 'area', 'waterfall', 'column', 'heatmap', 'small-multiples', 'histogram', 'scatter'];
function balanceSpans(charts) {
  const rank = ({ chart }) => {
    const index = WIDE_FRIENDLY.indexOf(chart);
    return index < 0 ? Infinity : index;
  };
  const widenOddRun = (run) => {
    if (run.length % 2 === 0) return;
    // 不能留下半行空白。只提升已经在奇数位置的卡片，保证提升前后都可配对。
    const candidates = run.filter((_chart, index) => index % 2 === 0);
    const chosen = candidates.reduce((best, item) => rank(item) < rank(best) ? item : best, candidates.at(-1));
    chosen.full = true;
  };
  let run = [];
  for (const chart of charts) {
    if (chart.full) {
      widenOddRun(run);
      run = [];
    } else run.push(chart);
  }
  widenOddRun(run);
}

function chartSections(blocks, viewBlocks, view, computed, report, theme, lang, evidence, inNarrative) {
  const charts = [];
  const dashboard = report.layout === 'dashboard';
  for (const block of blocks) {
    const spec = viewBlocks.get(block.sourceIndex).spec;
    if (!spec) continue;
    // 叙述引用的图只显示在引用处，图表区不再重复同一张图；仍记录证据，audit 用它核对引用。
    const markup = renderChart(block, spec, view, computed, theme, lang, evidence, inNarrative.get(block.id));
    if (!markup) continue;
    const full = dashboard && (block.chart === 'sparkline' || (block.chart === 'bullet' && spec.data.length <= 3));
    charts.push({ chart: block.chart, full, markup });
  }
  if (!charts.length) return '';
  if (dashboard) balanceSpans(charts);
  const html = charts.map(({ chart, full, markup }) => {
    return `<section data-kchart-chart="${escape(chart)}"${full ? ' data-span="full"' : ''}>${markup}</section>`;
  }).join('');
  return dashboard ? `<div data-chart-grid>${html}</div>` : html;
}

function sectionsForReport(computed, report, theme, lang, evidence) {
  const english = lang.startsWith('en');
  const narrativeFirst = report.layout === 'analysis' || report.layout === 'brief';
  const order = narrativeFirst ? ['text', 'kpi', 'chart', 'table'] : ['kpi', 'chart', 'table', 'text'];
  const sourceBlocks = report.blocks.map((block, sourceIndex) => ({ ...block, sourceIndex }));
  return computed.views.map((view) => {
    const refs = blockRefMap(computed, view, lang);
    const viewBlocks = new Map(view.blocks.map((block) => [block.sourceIndex, block]));
    const blocksOf = (type) => sourceBlocks.filter((block) => block.type === type && viewBlocks.has(block.sourceIndex));
    // 先渲染叙述，知道实际被引用的图；只认真正渲染出的引用，示例代码块里的 ref 不算。
    const firstReference = evidence.references.length;
    const narratives = blocksOf('text').map((block) => renderNarrative(viewBlocks.get(block.sourceIndex), view, computed, refs, theme, lang, evidence));
    const inNarrative = new Map(evidence.references.slice(firstReference).map((item) => [item.ref, item.sourceId]));
    let section = '';
    for (const type of order) {
      const blocks = blocksOf(type);
      if (type === 'text') {
        const heading = narrativeFirst ? (english ? 'Findings' : '结论') : (english ? 'Notes' : '说明');
        if (narratives.length) section += `<section><h2>${heading}</h2>${narratives.join('')}</section>`;
      } else if (type === 'chart') {
        section += chartSections(blocks, viewBlocks, view, computed, report, theme, lang, evidence, inNarrative);
      } else if (type === 'kpi') {
        for (const block of blocks) section += metricSection(block, view, report, lang, evidence);
      } else {
        for (const block of blocks) section += tableBlock(block, view, computed, report, lang, evidence);
      }
    }
    const viewTitle = escape(view.id === 'all' && english ? 'All' : view.label);
    return `<section data-view-section="${escape(view.id)}" data-view-label="${viewTitle}"${view.id === 'all' ? '' : ' hidden'}>`
      + `<p class="data-view-heading">${english ? 'View: ' : '视图：'}${viewTitle}</p>${section}</section>`;
  }).join('');
}
function contentMarkup(computed,report,theme,lang,evidence){const title=escape(report.title),views=computed.views,tabs=views.map(view=>{const label=view.id==='all'&&lang.startsWith('en')?'All':view.label,selected=view.id==='all';return `<button type="button" class="data-view-tab" role="tab" data-view-tab="${escape(view.id)}" aria-selected="${selected}" tabindex="${selected?0:-1}">${escape(label)}</button>`;}).join('');return `<main><header data-report-header><h1>${title}</h1></header>${views.length>1?`<nav aria-label="${lang.startsWith('en')?'View':'视图'}" data-view-nav><div class="data-view-tabs" role="tablist" aria-label="${lang.startsWith('en')?'View':'视图'}">${tabs}</div></nav>`:''}<div class="doc-body">${sectionsForReport(computed,report,theme,lang,evidence)}${sourceAndDefinitions(report,views[0],lang)}</div></main>`;}

export async function validatePackage(reportPath){const loaded=await loadDataPackage(reportPath);if(loaded.issues.some(item=>item.severity==='error'))return{pass:false,issues:loaded.issues,computed:{issues:[],views:[],metrics:{},blocks:[]},loaded};const computed=computeReport(loaded.report,loaded.datasets,{narratives:loaded.narratives}),issues=[...loaded.issues,...computed.issues];for(const item of issues){const dataset=loaded.datasets.find(candidate=>item.where?.includes(candidate.id));if(dataset)item.file=dataset.filePath;const blockIndex=/^blocks\[(\d+)\]/.exec(item.where||'')?.[1];if(blockIndex!=null){const block=loaded.report.blocks[Number(blockIndex)];if(block?.dataset)item.file=loaded.datasets.find(candidate=>candidate.id===block.dataset)?.filePath||loaded.reportPath;}}for(const block of loaded.report.blocks.filter(item=>item.type==='text')){const narrative=loaded.narratives.find(item=>item.block===block);if(narrative)issues.push(...narrativeHeadingIssues(narrative.text,narrative.filePath,`blocks.${block.file}`));}for(const view of computed.views){const refs=blockRefMap(computed,view,'zh-CN');for(const block of loaded.report.blocks){const sourceIndex=loaded.report.blocks.indexOf(block),rendered=view.blocks.find(item=>item.sourceIndex===sourceIndex);if(block.type==='chart'&&rendered?.spec){try{checkedRender(rendered.spec,'claude',`blocks[${sourceIndex}]`);}catch(error){issues.push(issue(CODES.BAD_KCHART,'error',`blocks[${sourceIndex}]`,error.message,error.fix||'按 KChart 诊断修正 chart 与 encode'));}}if(block.type==='text'&&rendered){const bound=bindText(rendered.text||'',computed,{dataset:block.dataset,view:view.id,lang:'zh-CN'});issues.push(...bound.issues);if(bound.issues.some(item=>item.severity==='error'))continue;if(/<\s*(?:script|style|link)\b/i.test(rendered.text||''))issues.push(issue(CODES.BAD_TEXT,'error',`blocks[${sourceIndex}]`,'叙述 Markdown 不允许 script、style 或 link 标签','删除活动标签'));try{const markdown=markdownToContent(bound.text,{lang:'zh-CN',renderViz:(syntax,source)=>{if(syntax!=='kchart')throw new DataPackageError(CODES.BAD_TEXT,'报表叙述只允许 KChart ref',rendered.filePath,'使用 kchart fence 并只写 {"ref":"图表块 id"}');const id=resolveVizReference(source,refs);checkedRender(refs.get(id).spec,'claude',`ref ${id}`);return vizMarkup('kchart',JSON.stringify(refs.get(id).spec));}});if(view===computed.views[0])issues.push(...await narrativeMarkupIssues(markdown.content,`blocks[${sourceIndex}]`));}catch(error){issues.push(issue(CODES.BAD_TEXT,'error',`blocks[${sourceIndex}]`,error.message,error.fix||'修正叙述中的 kchart ref'));}}}}
 const pass=!issues.some(item=>item.severity==='error');return{pass,issues,computed,loaded};}
function buildEvidence(computed,report,lang){return{version:1,lang,report:{title:report.title,layout:report.layout,current:report.period.current},summary:{views:computed.views.map(view=>({id:view.id,label:view.label,datasets:view.datasets}))},units:[],bindings:[],tables:[],charts:[],references:[],issues:[]};}
export async function buildPackage(reportPath,outPath,{force=false,theme='claude',lang}={}){const checked=await validatePackage(reportPath);if(!checked.pass)return{ok:true,pass:false,failures:checked.issues.filter(item=>item.severity!=='hint'),notes:checked.issues.filter(item=>item.severity==='hint')};const {report}=checked.loaded,computed=checked.computed;
// 未指定 --lang 时按报表标题和叙述的文字推断外壳与图表用语。
lang=lang??inferLang(report.title,...(checked.loaded.narratives||[]).map(item=>item.text));let themeObject;try{themeObject=kchartTheme(theme);}catch{throw new DataPackageError('BAD_THEME',`未知 KChart 主题 ${theme}`,reportPath,'从当前 KChart 主题中选择');}const evidence=buildEvidence(computed,report,lang);evidence.issues=checked.issues.filter(item=>item.severity==='hint');const content=contentMarkup(computed,report,theme,lang,evidence);evidence.contentSha256=fingerprint(content);const evidenceJson=JSON.stringify(evidence).replace(/</g,'\\u003c').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');const meta={'data-content-sha256':evidence.contentSha256,'data-evidence':evidenceJson};const css=await readFile(path.resolve(here,'../../../../assets/page/data.css'),'utf8'),runtime=await readFile(path.resolve(here,'../../../../assets/page/data.js'),'utf8');const html=renderShell({kind:'data',lang,title:report.title,theme,attrs:{'data-report-layout':report.layout},meta,styles:[`${getTheme(theme).css}${css}`],content,scripts:[runtime]});if(!force){try{await readFile(outPath);return{ok:false,error:{code:'FILE_EXISTS',message:`目标文件已存在：${outPath}`,next:'确认覆盖后使用 --force'}};}catch(error){if(error.code!=='ENOENT')throw error;}}await mkdir(path.dirname(path.resolve(outPath)),{recursive:true});await writeFile(outPath,html,'utf8');return{ok:true,file:path.resolve(outPath),kind:'data',issues:checked.issues};}
function evidenceValueError(html,evidence){const failures=[],elements=scanElements(html);for(const unit of evidence.units||[]){const element=elements.find(item=>item.name==='span'&&item.attrs['data-evidence']===unit.id);if(!element){failures.push(failure('EVIDENCE_UNIT_MISSING',`可见证据 ${unit.id} 缺失`,null,'从原数据包重新 build'));continue;}const visible=decodeEntities(innerHtml(html,element)).replace(/<[^>]*>/g,'').trim();if(visible!==String(unit.display))failures.push(failure('EVIDENCE_VALUE_MISMATCH',`可见值 ${unit.id} 与计算证据不一致`,null,'修改数据包后重新 build'));for(const[name,value]of Object.entries({'data-value':unit.value==null?'':unit.value,'data-measure':unit.measure,'data-view':unit.view}))if(element.attrs[name]!==String(value??''))failures.push(failure('EVIDENCE_ATTR_MISMATCH',`${unit.id} 的 ${name} 与计算证据不一致`,null,'修改数据包后重新 build'));}for(const table of evidence.tables||[]){const element=elements.find(item=>item.name==='table'&&item.attrs['data-evidence-table']===table.id);if(!element)failures.push(failure('TABLE_MISSING',`证据表 ${table.id} 缺失`,null,'修改数据包后重新 build'));else if(fingerprint(html.slice(element.start,element.end))!==table.sha256)failures.push(failure('TABLE_HASH_MISMATCH',`证据表 ${table.id} 已被修改`,null,'修改数据包后重新 build'));}for(const chart of evidence.charts||[]){const pre=elements.find(item=>item.name==='pre'&&item.attrs['data-viz']==='kchart'&&item.attrs.id===chart.sourceId);if(!pre){failures.push(failure('CHART_SOURCE_MISSING',`图表源 ${chart.id||chart.sourceId} 缺失`,null,'修改数据包后重新 build'));continue;}try{const spec=JSON.parse(decodeEntities(innerHtml(html,pre)));if(fingerprint(JSON.stringify(spec))!==chart.sourceSpecSha256||fingerprint(JSON.stringify(spec.data))!==chart.sourceDataSha256)failures.push(failure('CHART_SOURCE_MISMATCH',`图表 ${chart.id||chart.sourceId} 声明与来源摘要不一致`,null,'修改数据包后重新 build'));}catch{failures.push(failure('CHART_SOURCE_INVALID',`图表源 ${chart.id||chart.sourceId} 无法解析`,null,'修改数据包后重新 build'));}}return failures;}
export async function audit(html,{file='报表'}={}){const failures=[],notes=[];let parsed;try{parsed=parseShell(html,file);}catch(error){return{failures:[failure('BAD_SHELL',error.message,file,'修正 htmlview 外壳或从数据包重新 build')],notes};}if(parsed.kind!=='data')failures.push(failure('KIND_MISMATCH',`期望 data 产物，实际为 ${parsed.kind}`,file,'对 data 产物执行 audit'));const shell=await auditShell(html,{lang:parsed.lang,theme:parsed.theme,requireTitle:true}),viz=auditViz(parsed.content,{lang:parsed.lang,theme:parsed.theme||'claude',contentLine:parsed.contentLine});failures.push(...shell.failures.map(item=>failure(item.code,item.detail,file,'修正图形或外壳',item.where)),...viz.failures.map(item=>failure(item.code,item.detail,file,'按 KChart 诊断修正声明',item.where)));notes.push(...shell.notes,...viz.notes);const evidenceText=parsed.meta['data-evidence'];let evidence;try{evidence=JSON.parse(evidenceText||'');}catch{failures.push(failure('EVIDENCE_JSON','报表证据缺失或 JSON 无效',file,'从数据包重新 build'));return{failures,notes};}if(evidence.lang!==parsed.lang)failures.push(failure('EVIDENCE_LANGUAGE_MISMATCH',`页面语言 ${parsed.lang} 与生成证据语言 ${evidence.lang} 不一致`,file,'不要手改语言属性；从数据包重新 build'));if(fingerprint(parsed.content)!==parsed.meta['data-content-sha256']||fingerprint(parsed.content)!==evidence.contentSha256)failures.push(failure(CODES.DATA_INTEGRITY,'内容区整体与生成时的 SHA-256 不一致',file,'内容、表格、叙述与图形整体受保护；修改数据包后重新 build','.data-content'));failures.push(...evidenceValueError(parsed.content,evidence).map(item=>({...item,where:{...item.where,part:file}})));for(const ref of evidence.references||[]){const chart=evidence.charts.find(item=>item.id===ref.ref&&item.view===ref.view);if(!chart||chart.dataset!==ref.sourceDataset||chart.sourceDataSha256!==ref.sourceDataSha256||chart.sourceSpecSha256!==ref.sourceSpecSha256)failures.push(failure('EVIDENCE_REF_INVALID',`叙述引用 ${ref.ref} 来源证据不匹配`,file,'只引用同一视图中唯一 chart id'));}return{failures,notes};}
export function parts(html,{file='报表'}={}){const parsed=parseShell(html,file);if(parsed.kind!=='data')fail('KIND_MISMATCH',`期望 data 产物，实际为 ${parsed.kind}`,{next:'只对 data 产物执行 diff'});const body=parsed.content,elements=scanElements(body);const views=elements.filter(item=>item.name==='section'&&item.attrs['data-view-section']&&(!item.parent||item.parent.name!=='section')).map(item=>({part:`view:${item.attrs['data-view-section']}`,content:body.slice(item.start,item.end)}));const meta=elements.find(item=>item.name==='section'&&item.attrs['data-meta-section']==='sources'),result=[...views];if(meta)result.push({part:'meta:sources',content:body.slice(meta.start,meta.end)});const header=elements.find(item=>item.name==='header'&&item.attrs['data-report-header']!=null);if(header)result.push({part:'header',content:body.slice(header.start,header.end)});return result.length?result:[{part:'report',content:body}];}
export async function style(argv=[]){return safe(async()=>{const{positionals,values}=parseCli(argv,[1,1],'htmlview style <file> [--theme <id>] [--lang <lang>]', ['theme','lang']),file=positionals[0];if(values.lang)failInput('USAGE','data style 不支持更改语言','从数据包重新 data build');const html=await readFile(file,'utf8'),checked=await audit(html,{file});if(checked.failures.length){emit({pass:false,failures:checked.failures,notes:checked.notes},1);return;}const parsed=parseShell(html,file),theme=values.theme||parsed.theme||'claude',themeInfo=getTheme(theme);if(!themeInfo)failInput('BAD_THEME',`未知主题 ${theme}`,'选择 KChart 当前主题');const css=await readFile(path.resolve(here,'../../../../assets/page/data.css'),'utf8'),runtime=await readFile(path.resolve(here,'../../../../assets/page/data.js'),'utf8');const rebuilt=renderShell({kind:'data',lang:parsed.lang,title:parsed.title,theme,attrs:{...parsed.attrs,'data-report-layout':parsed.attrs['data-report-layout']||'analysis'},meta:parsed.meta,styles:[`${themeInfo.css}${css}`],content:parsed.content,scripts:[runtime]}),finalShell=parseShell(rebuilt,file);if(finalShell.content!==parsed.content)throw new ToolError('INTERNAL','style 重建改变内容区字节',{next:'保留现场并报告，不写入目标'});await writeFile(file,rebuilt,'utf8');emit({file,kind:'data'});});}
export const commands={
 async init(argv=[]){return safe(async()=>{const{positionals,values}=parseCli(argv,[1,1],'htmlview data init <dir> [--force]', ['force']),root=path.resolve(positionals[0]),force=values.force===true,targets=['report.json','data/monthly.csv','narrative.md'].map(name=>path.join(root,name));if(!force)for(const target of targets){try{await readFile(target);failInput('FILE_EXISTS',`init 不覆盖已有文件：${target}`,'检查目录；仅在确认覆盖时使用 --force');}catch(error){if(error instanceof ToolError)throw error;if(error.code!=='ENOENT')throw error;}}await mkdir(path.join(root,'data'),{recursive:true});const report={title:'虚构月度经营报表',layout:'periodic',period:{current:'2026-10',compare:['mom','yoy'],timezone:'Asia/Shanghai',complete:true},sources:[{id:'demo',name:'虚构合成数据',pulledAt:'2026-11-01T00:00:00Z'}],datasets:[{id:'monthly',file:'data/monthly.csv',source:'demo',periodField:'month',dimensions:{month:{type:'month',label:'月份'},channel:{type:'category',label:'渠道'}},measures:{revenue:{label:'收入',unit:'元',kind:'sum',definition:'合成已支付金额'},orders:{label:'订单数',unit:'单',kind:'sum',definition:'合成订单数'},visits:{label:'访问次数',unit:'次',kind:'sum',definition:'合成访问次数'},conversion:{label:'转化率',unit:'%',kind:'ratio',format:'percent',numerator:'orders',denominator:'visits',definition:'订单数除以访问次数'}},total:{field:'channel',value:'全部'}}],blocks:[{type:'kpi',dataset:'monthly',measures:['revenue','conversion']},{type:'chart',id:'revenue-trend',dataset:'monthly',chart:'line',encode:{category:'month',value:'revenue'},title:'合成收入趋势'},{type:'table',dataset:'monthly',columns:['month','channel','revenue','conversion']},{type:'text',file:'narrative.md'}],views:[{id:'direct',label:'直接',filters:{monthly:{channel:'直接'}}}]};await writeFile(targets[0],`${JSON.stringify(report,null,2)}\n`,'utf8');await writeFile(targets[1],'month,channel,revenue,orders,visits,conversion\n2026-09,全部,1000,10,100,0.1\n2026-09,直接,600,6,60,0.1\n2026-09,其他,400,4,40,0.1\n2026-10,全部,1200,12,100,0.12\n2026-10,直接,700,7,50,0.14\n2026-10,其他,500,5,50,0.1\n','utf8');await writeFile(targets[2],'### 合成数据说明\n\n收入较上月：{{revenue.mom_text}}。\n','utf8');emit({dir:root,kind:'data-package'});});},
 async validate(argv=[]){return safe(async()=>{const{positionals}=parseCli(argv,[1,1],'htmlview data validate <report.json>',[]),result=await validatePackage(positionals[0]),failures=result.issues.filter(item=>item.severity!=='hint').map(item=>reportIssue(item,positionals[0])),notes=result.issues.filter(item=>item.severity==='hint').map(item=>reportIssue(item,positionals[0]));emit({pass:result.pass,failures,notes},result.pass?0:1);});},
 async build(argv=[]){return safe(async()=>{const{positionals,values}=parseCli(argv,[1,1],'htmlview data build <report.json> --out <file> [--theme <id>] [--lang <lang>] [--force]', ['out','theme','lang','force']);if(!values.out)failInput('USAGE','data build 缺少 --out','htmlview data build <report.json> --out <file> [--theme <id>] [--lang <lang>] [--force]');const result=await buildPackage(positionals[0],values.out,{force:values.force,theme:values.theme||'claude',lang:values.lang});if(result.ok===false)failInput('FILE_EXISTS',result.error.message,result.error.next,{path:result.file});if(result.pass===false){emit({pass:false,failures:result.failures.map(item=>reportIssue(item,positionals[0])),notes:result.notes||[]},1);return;}emit(result);});},
};
export default{commands,audit,parts,style};
export{DataPackageError,loadDataPackage,computeReport};
