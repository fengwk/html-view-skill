import { readFileSync } from 'node:fs';
import { createPageApi } from './page-api.js';
import { createRegistry } from './src/chart/registry.js';
import { prepareSource } from './src/diagram/source.js';
import families from './src/families.json';

export { structureRoles } from './src/core/context.js';
export { catalog } from './src/chart/catalog.js';
export { theme, themes, resolveThemeConfig, validateThemeSnapshot, DEFAULT_THEME, FONT_FAMILY, defaultStyle } from './src/core/theme.js';

const modulesByPath = import.meta.glob(['./src/**/*.js', '!./src/runtime.js'], { eager: true });
const dist = new URL(/* @vite-ignore */ '../', import.meta.url);
const read = (file) => readFileSync(new URL(file, dist), 'utf8');
const manifest = JSON.parse(read('units.json'));
const chartModules = new Map();
const chartDecorators = new Map();
const diagramModules = new Map();
const diagramMetadata = [];
for (const [name, entry] of Object.entries(families)) {
  for (const chart of entry.charts || []) {
    if (chartModules.has(chart)) throw new Error(`可视化图型重复登记：${chart}`);
    chartModules.set(chart, name);
  }
  for (const [chart, variants] of Object.entries(entry.variants || {})) {
    if (chartDecorators.has(chart)) throw new Error(`可视化变体模块重复登记：${chart}`);
    chartDecorators.set(chart, { name, variants });
  }
  for (const [kind, { syntax = 'mermaid', topic, aliases = [] }] of Object.entries(entry.diagrams || {})) {
    for (const alias of [kind, ...aliases]) {
      const key = alias.toLowerCase();
      if (diagramModules.has(key)) throw new Error(`结构图别名重复登记：${alias}`);
      diagramModules.set(key, { name, syntax });
    }
    diagramMetadata.push(Object.freeze({ kind, syntax, topic, aliases: Object.freeze(aliases) }));
  }
}
export const diagramTypes = Object.freeze(diagramMetadata);

function dependencyOrder(roots) {
  const ordered = new Set();
  const visiting = new Set();
  function visit(name) {
    if (ordered.has(name)) return;
    if (!Object.hasOwn(manifest, name)) throw new Error(`可视化模块未登记：${name}`);
    if (visiting.has(name)) throw new Error(`可视化模块存在循环依赖：${name}`);
    visiting.add(name);
    for (const dep of manifest[name].deps) visit(dep);
    visiting.delete(name);
    ordered.add(name);
  }
  roots.forEach(visit);
  return [...ordered];
}

const entryRoots = ['chart/catalog', 'chart/spec', 'chart/registry', 'chart/context', 'core/theme'];
const fullChartRoots = [...entryRoots, ...new Set(chartModules.values()), ...new Set([...chartDecorators.values()].map(({ name }) => name)), 'interaction'];
const diagramEntry = 'diagram/registry';

function diagramRoots(sources) {
  if (sources === undefined) return [diagramEntry, ...new Set([...diagramModules.values()].map(({ name }) => name))];
  if (!Array.isArray(sources)) throw new TypeError('结构图源码集合必须是数组');
  const roots = new Set([diagramEntry]);
  for (const item of sources) {
    const { source, syntax = 'mermaid' } = typeof item === 'string' ? { source: item } : item || {};
    if (typeof source !== 'string') throw new TypeError('结构图源码必须是字符串');
    const { kind } = prepareSource(source, { syntax });
    const selected = diagramModules.get(kind.toLowerCase());
    if (selected?.syntax === syntax) roots.add(selected.name);
  }
  return [...roots];
}

export function modulesFor(specs) {
  if (specs === undefined) return dependencyOrder(fullChartRoots);
  if (!Array.isArray(specs)) throw new TypeError('图表声明集合必须是数组');
  const roots = [...entryRoots];
  const decorators = new Set(), diagrams = [];
  let interactive = false;
  for (const spec of specs) {
    if (spec && typeof spec === 'object' && !Object.hasOwn(spec, 'chart') && Object.hasOwn(spec, 'source')) {
      diagrams.push(spec);
      continue;
    }
    const family = chartModules.get(spec?.chart);
    if (!family) throw new TypeError(`无法为未知图型选择模块：${spec?.chart}`);
    roots.push(family);
    const decorator = chartDecorators.get(spec.chart);
    if (decorator?.variants.includes(spec.variant)) decorators.add(decorator.name);
    if (Array.isArray(spec.interaction) && spec.interaction.length) interactive = true;
  }
  if (diagrams.length) roots.push(...diagramRoots(diagrams));
  roots.push(...decorators);
  if (interactive) roots.push('interaction');
  return dependencyOrder(roots);
}

function unloadedVariants(roots) {
  const loaded = new Set(roots);
  return [...chartDecorators]
    .filter(([, { name }]) => !loaded.has(name))
    .map(([chart, { variants }]) => [chart, variants]);
}

const scripts = new Map();
function script(file) {
  if (!scripts.has(file)) {
    const text = read(file);
    if (/<\/script(?:[\s/>]|$)/i.test(text)) throw new Error(`模块源码不能直接内嵌在 HTML 中：${file}`);
    scripts.set(file, text);
  }
  return scripts.get(file);
}
const literal = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');
function browserScript(roots, diagramOnly = false) {
  const label = diagramOnly ? '离线结构图库' : '离线渲染库';
  const units = roots.map(id => script(manifest[id].file)).join('\n');
  const types = roots.includes(diagramEntry) ? diagramTypes : [];
  return `/* KChart ${label} */\n;(() => {\nconst KChartUnits = Object.create(null);\n${units}\n${script('page-api.js')}\nglobalThis.KChart = KChartPageApi.createPageApi(KChartUnits, ${literal(unloadedVariants(roots))}, ${literal(types)}, ${diagramOnly});\n})();\n`;
}

export function browserSource(specs) {
  return browserScript(modulesFor(specs));
}

export function runtimeSource() {
  return script(manifest.runtime.file);
}

const mapFiles = new Map([
  ['world', 'world.geojson'],
  ['us-states', 'us-states.geojson'],
]);
const readMapFile = (file) => read(`assets/maps/${file}`);
const plain = (value) => JSON.parse(JSON.stringify(value));

export function createRenderer({ specs, sources, readMap = readMapFile } = {}) {
  const diagramOnly = sources !== undefined && specs === undefined;
  const roots = diagramOnly ? dependencyOrder(diagramRoots(sources)) : modulesFor(specs);
  return rendererFor(roots, diagramOnly, readMap);
}

function rendererFor(roots, diagramOnly, readMap) {
  const modules = Object.fromEntries(roots.map(id => [id, modulesByPath[`./src/${id}.js`]]));
  // ESM modules are shared, but each renderer still sees only its selected layouts, in dependency order.
  const registry = createRegistry();
  for (const unit of Object.values(modules)) unit.install?.(registry);
  const api = createPageApi(modules, unloadedVariants(roots), diagramTypes, diagramOnly, registry);
  let browser;
  const bundleSource = () => (browser ??= browserScript(roots, diagramOnly));
  const diagramMethods = api.diagram ? {
    diagram: (source, options) => plain(api.diagram(source, options)),
    check: (source, options) => plain(api.check(source, options)),
    diagramTypes,
  } : {};
  if (diagramOnly) return Object.freeze({ ...diagramMethods, theme: modules['core/theme'].theme, themes: modules['core/theme'].themes, bundleSource });

  const maps = new Map();
  function assets(spec) {
    const name = spec?.data?.map?.asset;
    if (name == null) return undefined;
    const file = mapFiles.get(name);
    if (!file) throw new TypeError(`不支持的内置地图：${name}`);
    if (!maps.has(name)) maps.set(name, JSON.parse(readMap(file)));
    return { [name]: plain(maps.get(name)) };
  }
  return Object.freeze({
    parse: (text) => plain(api.parse(text)),
    validate: (spec) => plain(api.validate(spec)),
    schema: (chart) => plain(api.schema(chart)),
    render(spec, options = {}) {
      let map = options.assets;
      if (!map && mapFiles.has(spec?.data?.map?.asset)) map = assets(spec);
      return plain(api.render(spec, { ...options, assets: map }));
    },
    dataTable: (spec, options) => plain(api.dataTable(spec, options)),
    theme: api.theme,
    themes: api.themes,
    palette: (theme) => plain(modules['core/theme'].paletteOf(api.theme(theme))),
    catalog: api.catalog,
    layouts: api.layouts,
    ...diagramMethods,
    assets,
    bundleSource,
  });
}

export function detectSyntax(source) {
  const kind = prepareSource(source).kind.toLowerCase();
  return diagramModules.get(kind)?.syntax ?? 'mermaid';
}

let renderer;
const defaultRenderer = () => (renderer ??= createRenderer());
export const render = (spec, options) => defaultRenderer().render(spec, options);
export const parse = (text) => defaultRenderer().parse(text);
export const validate = (spec) => defaultRenderer().validate(spec);
export const schema = (chart) => defaultRenderer().schema(chart);
export const dataTable = (spec, options) => defaultRenderer().dataTable(spec, options);

let diagramRenderer;
const defaultDiagrams = () => (diagramRenderer ??= rendererFor(dependencyOrder(diagramRoots()), true, readMapFile));
export const diagram = (source, options) => defaultDiagrams().diagram(source, options);
export const check = (source, options) => defaultDiagrams().check(source, options);
