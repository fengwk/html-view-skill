import { assembleModules, diagramModulesFor, diagramTypes, loadModules } from './modules.mjs';
import { diagramApi } from './diagram-api.mjs';

const plain = value => JSON.parse(JSON.stringify(value));

function browserScript(roots) {
  const code = assembleModules(roots);
  return `/* KChart 离线结构图库 */\n;globalThis.KChart = (${diagramApi.toString()})(${code}, ${JSON.stringify(diagramTypes)});\n`;
}

export const browserSource = sources => browserScript(diagramModulesFor(sources));
export { diagramModulesFor as modulesFor, diagramTypes };

// 对独立文件识别前言与注释后的头行；原生裸正文仍需由宿主指定 syntax。
export function detectSyntax(source) {
  const parsed = loadModules(['diagram/source'])['diagram/source'].prepareSource(source);
  const kind = parsed.kind.toLowerCase();
  return diagramTypes.find(type => [type.kind, ...type.aliases].some(name => name.toLowerCase() === kind))?.syntax ?? 'mermaid';
}

export function createRenderer({ sources } = {}) {
  const roots = diagramModulesFor(sources);
  const modules = loadModules(roots);
  const api = diagramApi(modules, diagramTypes);
  let browser;
  return Object.freeze({
    diagram: (source, options) => plain(api.diagram(source, options)),
    check: (source, options) => plain(api.check(source, options)),
    diagramTypes,
    theme: modules['core/theme'].theme,
    themes: modules['core/theme'].themes,
    bundleSource: () => (browser ??= browserScript(roots)),
  });
}

let renderer;
const defaultRenderer = () => (renderer ??= createRenderer());
export const diagram = (source, options) => defaultRenderer().diagram(source, options);
export const check = (source, options) => defaultRenderer().check(source, options);
