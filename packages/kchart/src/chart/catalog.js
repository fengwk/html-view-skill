/* KChart DSL contracts. Pure data: safe to load in browser and Node without DOM. */

const rows = [
  ['line','table',['category','value'],['series','id','lower','upper'],{stack:['absolute'],variant:['counter','barcode']},{arrayRoles:['value']}],
  ['area','table',['category','value'],['series','id','lower','upper'],{stack:['absolute','percent']},{arrayRoles:['value']}],
  ['bar','table',['category','value'],['series','id'],{stack:['absolute','percent'],variant:['solid','rungs','pictorial','lollipop']},{arrayRoles:['value']}],
  ['column','table',['category','value'],['series','id'],{stack:['absolute','percent'],variant:['solid','rungs','pictorial','lollipop']},{arrayRoles:['value']}],
  ['share','table',['category','value'],['series'],{variant:['solid','ticks']},{arrayRoles:['value']}],
  ['pie','table',['category','value'],['id'],{sliceLabels:'boolean'}], ['donut','table',['category','value'],['id'],{variant:['solid','ticks']}],
  ['radial-share','table',['category','value','intensity'],['id']], ['rose','table',['category','value'],['id']],
  ['funnel','table',['category','value'],['id'],{variant:['bars','hourglass']}],
  ['sparkline','table',['category','value'],[]], ['small-multiples','table',['category'],['value','panel'],{}, {arrayRoles:['value'],encodeForms:[['value'],['value','panel']]}],
  ['stream','table',['category','value'],['series'],{}, {arrayRoles:['value']}], ['split-compare','table',['category','upper','lower'],[]],
  ['combo','table',['category'],['id'],{layers:'layers'}, {requiredSpecial:['layers']}],
  ['bullet','table',['category','actual','target'],['id']], ['gauge','table',['value'],['target'],{range:'range',variant:['bar','arc','ticks']}],
  ['dumbbell','table',['category','before','after'],['id'],{variant:['solid','rungs']}], ['slope','table',['category','before','after'],['id']],
  ['interval','table',['category','low','high'],['value','id']], ['waterfall','table',['category','delta'],['id'],{start:'number',variant:['solid','rungs']}],
  ['histogram','table',['lower','upper','count'],[],{variant:['solid','rungs']}],
  ['boxplot','table',['category','low','q1','median','q3','high'],['outliers','id']], ['violin','table',['category','density','median'],['id']],
  ['strip','table',['category','value'],['id']], ['scatter','table',['x','y'],['size','series','label','id'],{variant:['dots','plumb']}],
  ['candlestick','table',['category','open','close','low','high'],['id']],
  ['heatmap','table',['row','column','value'],[],{variant:['cells','dots','arc']}], ['bubble-matrix','table',['row','column','value'],[]],
  ['calendar','table',['date','value'],[],{period:'year',variant:['cells','dots']}, {requiredSpecial:['period']}], ['waffle','table',['category','value'],[],{variant:['dots','field']}],
  ['tally','table',['category','value'],[]], ['bump','table',['category','series','rank'],[]],
  ['radar','table',['label','dimensions'],['id'],{rings:'number',graticule:['circle','polygon'],legend:'boolean'}, {arrayRoles:['dimensions']}], ['parallel','table',['label','dimensions'],['id','series'],{}, {arrayRoles:['dimensions']}],
  ['launch-fan','table',['label','start','value'],['id']],
  ['tree','tree',[],[],{layout:['right','left','org','brace']}],
  ['mindmap','tree',[],[],{layout:['bilateral','right','left','radial','org','brace','fishbone','timeline'],variant:['editorial','cards']}],
  ['treemap','tree',[],[]], ['sunburst','tree',[],[]],
  ['network','network',[],[],{layout:['circular','force'],directed:'boolean',variant:['lines','membrane']}],
  ['sankey','network',[],[],{layout:['right','down'],tolerant:'boolean',showValues:'boolean'}], ['threads','paths',[],[],{layout:['right','down']}],
  ['choropleth','geo',['region','value'],[]], ['geo-scatter','geo',['longitude','latitude'],['value','label','id']],
];
const catalog = Object.create(null);
for (const [name, shape, required, optional = [], special = {}, contract = {}] of rows) {
  const options = Object.fromEntries(Object.entries(special).map(([key, value]) => (
    [key, Array.isArray(value) ? Object.freeze(value) : value]
  )));
  catalog[name] = Object.freeze({
    name, shape, required: Object.freeze(required), optional: Object.freeze(optional), special: Object.freeze(options),
    arrayRoles: Object.freeze(contract.arrayRoles || []),
    encodeForms: Object.freeze((contract.encodeForms || []).map(Object.freeze)),
    requiredSpecial: Object.freeze(contract.requiredSpecial || []),
  });
}

// Freeze in place, exactly as the legacy return object did.
Object.freeze(catalog);

export { catalog };
