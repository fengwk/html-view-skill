import { parsePie, parseTreemap, TREEMAP_MAX_DEPTH, TREEMAP_MAX_NODES } from './numeric-parse.js';
import { diagnostics, renderWith, validateWith } from './numeric-model.js';
import { compositionPresentation } from '../chart/composition.js';
import { createRegistry, layouts as chartLayouts } from '../chart/registry.js';
import { sizeBudget, validate as validateSpec } from '../chart/spec.js';
import { warning } from './support.js';

function bind(parse, toSpec, lineFor, options) {
  return {
    ...options, parse,
    validate: (model, info) => validateWith(toSpec(model, info), info, detail => lineFor(model, detail.path)),
    layout(model, options, info) {
      // Fit compact pies to their categories instead of the host canvas; native chart widths stay untouched.
      const width = options.compact ? Math.min(560, Math.max(360, 290 + model.rows.length * 24)) : options.width;
      return renderWith(toSpec(model, info, options.compact === true), { ...options, width }, info, detail => lineFor(model, detail.path));
    },
  };
}
const pie = bind(parsePie, (model, _info, compact) => ({
  chart: 'pie', title: model.title || undefined, sliceLabels: true,
  data: model.rows.map(({ category, value }) => ({ category, value })),
  encode: { category: 'category', value: 'value' },
  [compositionPresentation]: { labelRadius: model.labelRadius, ...(compact ? { compact: true } : {}) },
}), (model, path) => path === '/title' ? model.titleLine : model.rows[Number(path?.split('/')[2])]?.line || model.rows[0]?.line, { optionMode: 'raw', honoredConfig: ['pie.textPosition'] });
const treemapSpec = (model, info) => ({
  chart: 'treemap', title: model.title || undefined, data: model.data,
  fields: model.valueField ? { value: model.valueField } : undefined,
  [compositionPresentation]: { showValues: info.config?.treemap?.showValues !== false, prefix: model.prefix, namedRoot: model.namedRoot },
  // parseTreemap enforces the Mermaid caps with its own diagnostics; +1 leaves room for the root the chart wraps around them.
  [sizeBudget]: { nodes: TREEMAP_MAX_NODES + 1, depth: TREEMAP_MAX_DEPTH + 1 },
});
const treemapLine = (model, path) => {
  if (path === '/title') return model.titleLine;
  for (let key = path; key; key = key.slice(0, key.lastIndexOf('/'))) {
    if (model.treeLines[key]) return model.treeLines[key];
    if (!key.includes('/')) break;
  }
  return null;
};

const treemapRegistry = createRegistry(validateSpec);
treemapRegistry.register('treemap', chartLayouts.get('treemap'));
const treemap = {
  parse: parseTreemap,
  acceptsPresentation: true,
  honoredConfig: ['treemap.showValues', 'treemap.valueFormat'],
  validate(model, info) {
    const spec = treemapSpec(model, info);
    return diagnostics(validateSpec(spec).errors, info, detail => treemapLine(model, detail.path));
  },
  layout(model, options, info) {
    const compact = options.compact === true;
    const spec = treemapSpec(model, info), lineFor = detail => treemapLine(model, detail.path);
    if (compact) spec[compositionPresentation] = { ...spec[compositionPresentation], compact: true };
    // Treemap reserves 48px around its map; expand with item count, except a lone leaf gets a small inline tile.
    const singleLeaf = model.data.children?.length === 1 && !model.data.children[0]?.children?.length;
    const width = compact ? (singleLeaf ? 256 : Math.min(640, 480 + Math.max(0, model.nodeCount - 1) * 10)) : options.width;
    const renderOptions = compact ? { ...options, width } : options;
    const result = renderWith(spec, renderOptions, info, lineFor, treemapRegistry.layout);
    if (result.scene && (model.nodeCount > 60 || model.depth > 5 || result.width > options.width * 2)) {
      result.errors.push(warning('LARGE_DIAGRAM', info.lang, info.headerLine,
        '矩形树图较大，可滚动查看', 'Large treemap; scroll to view it', '考虑拆分图表', 'Consider splitting the chart'));
    }
    return result;
  },
};

export const implementations = { pie, treemap };
