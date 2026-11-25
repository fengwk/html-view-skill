import { createPageApi } from './page-api.js';
import { catalog } from './src/chart/catalog.js';
import { theme, themes } from './src/core/theme.js';
import { prepareSource } from './src/diagram/source.js';
import families from './src/families.json';
import { loadFamily } from 'virtual:kchart-families';

export { catalog, theme, themes };
export { registerIcons } from './src/core/icons.js';

const charts = new Map(), decorators = new Map(), diagrams = new Map();
const types = [];
for (const [family, entry] of Object.entries(families)) {
  for (const chart of entry.charts || []) charts.set(chart, family);
  for (const [chart, variants] of Object.entries(entry.variants || {})) {
    decorators.set(chart, { family, variants, charts: Object.keys(entry.variants) });
  }
  for (const [kind, { syntax = 'mermaid', topic, aliases = [] }] of Object.entries(entry.diagrams || {})) {
    for (const name of [kind, ...aliases]) diagrams.set(name.toLowerCase(), { family, syntax });
    types.push(Object.freeze({ kind, syntax, topic, aliases: Object.freeze(aliases) }));
  }
}
export const diagramTypes = Object.freeze(types);

const maps = import.meta.glob('./assets/maps/*.geojson', { query: '?raw', import: 'default' });
const plain = (value) => JSON.parse(JSON.stringify(value));

export async function render(spec, options = {}) {
  const chart = spec?.chart;
  const family = charts.get(chart);
  const candidate = decorators.get(chart);
  const decorator = candidate?.variants.includes(spec.variant) ? candidate : undefined;
  // Decorators register for multiple layouts, so install all their bases before installing them.
  const bases = new Set(decorator ? decorator.charts.map(name => charts.get(name)) : family ? [family] : []);
  const name = spec?.data?.map?.asset;
  const map = family === 'chart/maps' && !options.assets && typeof name === 'string'
    ? maps[`./assets/maps/${name}.geojson`] : undefined;
  const [registryModule, chartSpec, context, layouts, variants, mapText] = await Promise.all([
    import('./src/chart/registry.js'), import('./src/chart/spec.js'), import('./src/chart/context.js'),
    Promise.all([...bases].map(id => loadFamily[id]())), decorator && loadFamily[decorator.family](), map?.(),
  ]);
  const registry = registryModule.createRegistry(chartSpec.validate);
  for (const layout of layouts) layout.install(registry);
  variants?.install(registry);
  const api = createPageApi({
    'chart/spec': chartSpec, 'chart/catalog': { catalog }, 'chart/context': context, 'core/theme': { theme, themes },
  }, [], [], false, registry);
  const assets = mapText === undefined ? options.assets : { [name]: JSON.parse(mapText) };
  return plain(api.render(spec, { ...options, assets }));
}

async function diagramApi(source, options) {
  const syntax = options.syntax || 'mermaid';
  const { kind } = prepareSource(source, { syntax, lang: options.lang });
  const selected = diagrams.get(kind.toLowerCase());
  const family = selected?.syntax.toLowerCase() === syntax.toLowerCase() ? selected.family : undefined;
  const [registry, unit] = await Promise.all([
    import('./src/diagram/registry.js'), family && loadFamily[family](),
  ]);
  const modules = { 'diagram/registry': registry };
  if (unit) modules[family] = unit;
  return createPageApi(modules, [], diagramTypes, true);
}

export async function diagram(source, options = {}) {
  return plain((await diagramApi(source, options)).diagram(source, options));
}

export async function check(source, options = {}) {
  return plain((await diagramApi(source, options)).check(source, options));
}

// The interaction layer is the only code that reads the DOM, so it loads on first use.
export async function attach(svg, spec) {
  const { attach: attachSvg } = await import('./src/interaction.js');
  return attachSvg(svg, spec);
}
