import { readFileSync } from 'node:fs';
import { assembleModules, diagramTypes, loadModules, modulesFor, unloadedVariants } from './modules.mjs';
import { diagramApi } from './diagram-api.mjs';
export { diagram, check, diagramTypes } from './diagram.mjs';

const mapFiles = new Map([
  ['world', 'world.geojson'],
  ['us-states', 'us-states.geojson'],
]);
const readMapFile = (file) => readFileSync(new URL(`assets/maps/${file}`, import.meta.url), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

// 在 Node 或浏览器中从相同模块导出 API；只有 Node 适配器读取本地图资。
function chartApi(modules, unloaded) {
  const { render, layouts } = modules['chart/registry'];
  const excluded = new Map(unloaded);
  return Object.freeze({
    ...modules['chart/spec'],
    catalog: modules['chart/catalog'].catalog,
    dataTable: modules['chart/context'].dataTable,
    theme: modules['core/theme'].theme,
    themes: modules['core/theme'].themes,
    layouts,
    render(spec, options = {}) {
      if (excluded.get(spec?.chart)?.includes(spec.variant)) {
        const { errors } = modules['chart/spec'].validate(spec);
        if (errors.length) return { scene: null, svg: null, diagnostics: errors };
        return { scene: null, svg: null, diagnostics: [{
          code: 'BAD_KCHART', path: '/variant', message: `未装入 ${spec.chart} 的变体模块`,
          fix: '以该图表声明重新组装渲染器',
        }] };
      }
      return render(spec, { frame: true, ...options });
    },
    ...(modules.interaction ? { attach: modules.interaction.attach } : {}),
  });
}

function browserScript(roots) {
  const modules = assembleModules(roots);
  const unloaded = JSON.stringify(unloadedVariants(roots));
  const charts = `(${chartApi.toString()})(modules, ${unloaded})`;
  if (!roots.includes('diagram/registry')) {
    return `/* KChart 离线渲染库 */\n;globalThis.KChart = (${chartApi.toString()})(${modules}, ${unloaded});\n`;
  }
  const diagrams = `(${diagramApi.toString()})(modules, ${JSON.stringify(diagramTypes)})`;
  return `/* KChart 离线渲染库 */\n;globalThis.KChart = ((modules) => Object.freeze({ ...${charts}, ...${diagrams} }))(${modules});\n`;
}

export function browserSource(specs) {
  return browserScript(modulesFor(specs));
}

export function createRenderer({ specs, readMap = readMapFile } = {}) {
  const roots = modulesFor(specs);
  const modules = loadModules(roots);
  const api = chartApi(modules, unloadedVariants(roots));
  const diagrams = modules['diagram/registry'] && diagramApi(modules, diagramTypes);
  const maps = new Map();
  function assets(spec) {
    const name = spec?.data?.map?.asset;
    if (name == null) return undefined;
    const file = mapFiles.get(name);
    if (!file) throw new TypeError(`不支持的内置地图：${name}`);
    if (!maps.has(name)) maps.set(name, JSON.parse(readMap(file)));
    return { [name]: plain(maps.get(name)) };
  }
  let browser;
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
    ...(diagrams ? {
      diagram: (source, options) => plain(diagrams.diagram(source, options)),
      check: (source, options) => plain(diagrams.check(source, options)),
      diagramTypes,
    } : {}),
    assets,
    bundleSource: () => (browser ??= browserScript(roots)),
  });
}

const metadata = loadModules(['chart/catalog', 'core/theme']);
export const { catalog } = metadata['chart/catalog'];
export const { theme, themes } = metadata['core/theme'];
export { modulesFor };

let renderer;
const defaultRenderer = () => (renderer ??= createRenderer());
export const render = (spec, options) => defaultRenderer().render(spec, options);
export const parse = (text) => defaultRenderer().parse(text);
export const validate = (spec) => defaultRenderer().validate(spec);
export const schema = (chart) => defaultRenderer().schema(chart);
export const dataTable = (spec, options) => defaultRenderer().dataTable(spec, options);
