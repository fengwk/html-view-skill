import { error as issueAt } from './support.js';
import { validate as validateSpec } from '../chart/spec.js';
import { layout } from '../chart/registry.js';
import { ExpectedDiagnostic } from '../core/diagnostics.js';

function toSpec(model) {
  if (model.chart === 'pie') return { chart: 'pie', ...(model.title ? { title: model.title } : {}), data: model.rows.map(({ category, value }) => ({ category, value })), encode: { category: 'category', value: 'value' } };
  if (model.chart === 'line' || model.chart === 'column') return { chart: model.chart, ...(model.title ? { title: model.title } : {}), subtitle: [model.xLabel, model.yLabel].filter(Boolean).join(' · ') || undefined, data: model.categories.map((category, i) => ({ category, value: model.datasets[0].values[i] })), encode: { category: 'category', value: 'value' }, fields: { category: { domain: model.categories }, value: model.yDomain ? { domain: model.yDomain } : {} } };
  if (model.chart === 'combo') {
    const data = model.categories.map((category, i) => Object.fromEntries([['category', category], ...model.datasets.map((d, j) => [`v${j}`, d.values[i]])]));
    const fields = Object.fromEntries(model.datasets.map((d, i) => [`v${i}`, model.yDomain ? { domain: model.yDomain } : {}]));
    return { chart: 'combo', ...(model.title ? { title: model.title } : {}), subtitle: [model.xLabel, model.yLabel].filter(Boolean).join(' · ') || undefined, data, encode: { category: 'category' }, layers: model.datasets.map((d, i) => ({ mark: d.type === 'bar' ? 'column' : 'line', field: `v${i}`, axis: 'left' })), fields };
  }
  if (model.chart === 'sankey') return { chart: 'sankey', data: { nodes: model.nodes, edges: model.edges.map(({ line, ...edge }) => edge) }, layout: 'right' };
  if (model.chart === 'radar') return { chart: 'radar', ...(model.title ? { title: model.title } : {}), data: model.rows, encode: { label: 'label', dimensions: model.fields.map(({ name }) => name) }, fields: Object.fromEntries(model.fields.map(({ name, label }, i) => [name, { label, domain: [0, model.max ?? Math.max(1, ...model.rows.map(row => row[name]))] }])) };
  return { chart: 'treemap', ...(model.title ? { title: model.title } : {}), data: model.data };
}

function lineFor(model, info, diagnostic) {
  const path = String(diagnostic.path || '').split('/').slice(1).map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  const indexAt = (key) => path[path.indexOf(key) + 1];
  if (model.chart === 'sankey') {
    const edgeIndex = Number(indexAt('edges'));
    if (Number.isInteger(edgeIndex) && model.edges[edgeIndex]) return model.edges[edgeIndex].line;
    const nodeIndex = Number(indexAt('nodes'));
    if (Number.isInteger(nodeIndex) && model.nodes[nodeIndex]) {
      const id = model.nodes[nodeIndex].id;
      return model.edges.find(edge => edge.source === id || edge.target === id)?.line;
    }
    return model.edges[0]?.line;
  }
  if (model.chart === 'pie') {
    const row = Number(path[1]);
    return path[0] === 'title' ? model.titleLine : Number.isInteger(row) && model.rows[row] ? model.rows[row].line : model.rows[0]?.line;
  }
  if (model.chart === 'radar') {
    const row = Number(path[1]);
    if (path[0] === 'data' && Number.isInteger(row) && model.curveLines[row]) return model.curveLines[row];
    if (path[0] === 'title') return model.titleLine;
    if (path[0] === 'fields') return model.maxLine || model.axisLine;
    return model.axisLine || model.maxLine || model.curveLines[0];
  }
  if (model.chart === 'treemap') {
    if (path[0] === 'title') return model.titleLine;
    for (let end = path.length; end >= 1; end -= 1) {
      const found = model.treeLines?.[`/${path.slice(0, end).join('/')}`];
      if (found) return found;
    }
    return model.titleLine || info.firstLine;
  }
  if (model.chart === 'line' || model.chart === 'column' || model.chart === 'combo') {
    if (path[0] === 'title') return model.titleLine;
    if (path[0] === 'subtitle') return model.xLine || model.yLine;
    if (path[0] === 'layers') return model.datasets[Number(path[1])]?.line || model.datasets[0]?.line;
    const field = path[2] || '';
    const series = /^v(\d+)$/.exec(field);
    if (series && model.datasets[Number(series[1])]) return model.datasets[Number(series[1])].line;
    if (path[0] === 'fields' && path[1] === 'value') return model.yLine || model.datasets[0]?.line;
    if (path[0] === 'fields' && path[1] === 'category') return model.xLine || model.datasets[0]?.line;
    const row = Number(path[1]);
    if (path[0] === 'data' && Number.isInteger(row) && model.datasets[row]) return model.datasets[row].line;
    return model.datasets[0]?.line;
  }
  return info.firstLine;
}

function diagnostics(errors, model, info) {
  return errors.map(detail => issueAt(
    info.lang,
    lineFor(model, info, detail) || info.firstLine,
    detail.message || 'KChart 声明无效',
    detail.message || 'Invalid KChart declaration',
    detail.fix || '修正图表声明',
    detail.fix || 'Correct the chart declaration',
  ));
}

function validate(model, info) {
  const result = validateSpec(toSpec(model));
  return diagnostics(result.errors, model, info);
}

function addVisibleHeader(scene, options) {
  if (options.renderOptions?.frame) return scene;
  const { ctx } = options;
  const heading = scene.heading || '';
  const subtitle = scene.subtitle || '';
  if (!heading && !subtitle) return scene;
  const available = Math.max(24, scene.width - 32), children = [];
  let top = 16, requiredWidth = scene.width;
  const paragraph = (text, size, weight) => {
    if (!text) return;
    const lines = ctx.wrap(text, available, size, weight), step = size + 6;
    requiredWidth = Math.max(requiredWidth, 32 + Math.max(0, ...lines.map(line => ctx.measure(line, size, weight))));
    children.push(ctx.textLines(16, top + size, lines, {
      leading: step, size, weight, fill: ctx.color(weight > 400 ? 'fg' : 'muted'),
    }));
    top += lines.length * step + 6;
  };
  paragraph(heading, 16, 650);
  paragraph(subtitle, 12, 400);
  top += 8;
  return {
    ...scene,
    width: requiredWidth,
    height: scene.height + top,
    children: [...children, ctx.el('g', { transform: `translate(0 ${top})` }, scene.children)],
  };
}

function render(model, options, info) {
  const spec = toSpec(model), errors = validate(model, info);
  if (errors.length) return { width: options.width, height: 0, errors };
  const layoutOptions = {
    ...options.renderOptions,
    width: options.width,
    lang: info.lang,
    ...(!options.renderOptions?.measure && options.measure ? {
      measure: (text, size = 12, weight = 400) => options.measure(text, { size, weight }),
    } : {}),
  };
  try {
    const scene = addVisibleHeader(layout(spec, layoutOptions), options);
    return { width: scene.width, height: scene.height, scene, errors: [] };
  } catch (error) {
    if (!(error instanceof ExpectedDiagnostic)) throw error;
    return { width: options.width, height: 0, errors: diagnostics(error.errors || [], model, info) };
  }
}

export { render, toSpec, validate };
