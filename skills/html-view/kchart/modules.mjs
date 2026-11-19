// Node 与 HTML 共用同一次模块组装；库只从自己的目录加载源码和数据。
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const root = new URL('./', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('src/modules.json', root), 'utf8'));
const entries = Object.entries(manifest);
const layerOf = (name) => name.split('/')[0];
const permissions = {
  core: ['core'],
  chart: ['core', 'chart'],
  diagram: ['core', 'chart', 'diagram'],
  interaction: ['core', 'chart'],
  runtime: ['core', 'chart', 'diagram', 'interaction'],
};

const chartModules = new Map();
const chartDecorators = new Map();
const diagramModules = new Map();
const diagramMetadata = [];
for (const [name, entry] of entries) {
  const allowed = permissions[layerOf(name)];
  if (!allowed || !/^(?:src|assets)\/(?:[\w-]+\/)*[\w-]+\.(?:js|json)$/.test(entry.file)) {
    throw new Error(`可视化模块登记有误：${name}`);
  }
  for (const dep of entry.deps) {
    if (!Object.hasOwn(manifest, dep) || !allowed.includes(layerOf(dep))
      || (name === 'interaction' && !dep.startsWith('core/') && dep !== 'chart/fields')) {
      throw new Error(`可视化模块依赖方向非法：${name} → ${dep}`);
    }
  }
  for (const chart of entry.charts || []) {
    if (chartModules.has(chart)) throw new Error(`可视化图型重复登记：${chart}`);
    chartModules.set(chart, name);
  }
  for (const [kind, { syntax = 'mermaid', topic, aliases = [] }] of Object.entries(entry.diagrams || {})) {
    if (layerOf(name) !== 'diagram' || !topic || !Array.isArray(aliases)
      || !['mermaid', 'layers', 'blocks', 'swimlane'].includes(syntax)) {
      throw new Error(`结构图类型登记有误：${kind}`);
    }
    for (const alias of [kind, ...aliases]) {
      const key = alias.toLowerCase();
      if (diagramModules.has(key)) throw new Error(`结构图别名重复登记：${alias}`);
      diagramModules.set(key, { name, syntax });
    }
    diagramMetadata.push(Object.freeze({ kind, syntax, topic, aliases: Object.freeze(aliases) }));
  }
  for (const [chart, variants] of Object.entries(entry.variants || {})) {
    if (chartDecorators.has(chart)) throw new Error(`可视化变体模块重复登记：${chart}`);
    chartDecorators.set(chart, { name, variants });
  }
}

export function dependencyOrder(roots) {
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

// 载入 manifest 时校验整张依赖图，不能只检查当前选中的图族。
dependencyOrder(entries.map(([name]) => name));

const entryRoots = ['chart/catalog', 'chart/spec', 'chart/registry', 'chart/context', 'core/theme'];
const fullChartRoots = [...entryRoots, ...new Set(chartModules.values()), ...new Set([...chartDecorators.values()].map(({ name }) => name)), 'interaction'];
const diagramEntry = 'diagram/registry';
export const diagramTypes = Object.freeze(diagramMetadata);
let prepareSource;

function diagramRoots(sources) {
  if (sources === undefined) return [diagramEntry, ...new Set([...diagramModules.values()].map(({ name }) => name))];
  if (!Array.isArray(sources)) throw new TypeError('结构图源码集合必须是数组');
  prepareSource ??= loadModules(['diagram/source'])['diagram/source'].prepareSource;
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

export function diagramModulesFor(sources) {
  return dependencyOrder(diagramRoots(sources));
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

export function unloadedVariants(roots) {
  const loaded = new Set(roots);
  return [...chartDecorators]
    .filter(([, { name }]) => !loaded.has(name))
    .map(([chart, { variants }]) => [chart, variants]);
}

// 此函数进入组装后的脚本，仅使用标准 JavaScript；模块只收到声明过的依赖。
function execute(install) {
  const exportsByName = new Map();
  const register = (name, deps, source) => {
    let registered = false;
    source(Object.freeze({
      define(id, factory) {
        if (registered || id !== name || typeof factory !== 'function') {
          throw new Error(`可视化模块声明不匹配：${name}`);
        }
        registered = true;
        const imports = Object.fromEntries(deps.map((dep) => [dep, exportsByName.get(dep)]));
        exportsByName.set(id, Object.freeze(factory(Object.freeze(imports)) ?? {}));
      },
    }));
    if (!registered) throw new Error(`可视化模块没有声明导出：${name}`);
  };
  install(register);
  return Object.freeze(Object.fromEntries(exportsByName));
}

const sources = new Map();
function sourceOf(name) {
  if (sources.has(name)) return sources.get(name);
  const { file, deps } = manifest[name];
  const text = readFileSync(new URL(file, root), 'utf8');
  const code = file.endsWith('.json')
    ? `KChart.define(${JSON.stringify(name)}, () => (${JSON.stringify(JSON.parse(text)).replaceAll('<', '\\u003c')}));`
    : text;
  if (/<\/script(?:[\s/>]|$)/i.test(code)) throw new Error(`模块源码不能直接内嵌在 HTML 中：${name}`);
  const source = `register(${JSON.stringify(name)}, ${JSON.stringify(deps)}, (KChart) => {\n${code}\n});`;
  sources.set(name, source);
  return source;
}

export function assembleModules(roots) {
  const code = dependencyOrder(roots).map(sourceOf).join('\n');
  return `(${execute.toString()})((register) => {\n${code}\n})`;
}

export function loadModules(roots) {
  return runInNewContext(assembleModules(roots), {}, { filename: 'kchart.js', timeout: 10000 });
}
