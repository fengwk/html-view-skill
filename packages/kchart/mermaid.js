import { check, diagram, diagramTypes, themes } from './index.js';
import { prepareSource, siteConfig } from './src/diagram/source.js';

let config = {};

// KChart's own render options, plus `theme` when it names a KChart theme or is a theme object.
const RENDER_OPTIONS = new Set(['width', 'lang', 'media', 'frame', 'prefix', 'measure']);

// Every other setting is Mermaid site configuration, checked exactly like a `config` in the diagram's front matter,
// which overrides it: settings the diagram type honors (such as `c4.c4ShapeInRow`) apply, runtime settings such as
// `startOnLoad` pass silently, and the rest, including `themeVariables` and Mermaid's own theme names other than
// `default`, are reported in one IGNORED_CONFIG warning.
function optionsOf(settings) {
  const options = { syntax: 'mermaid' }, site = {};
  for (const [key, value] of Object.entries(settings)) {
    const kchartTheme = key === 'theme' && (typeof value !== 'string' || Object.hasOwn(themes, value));
    if (RENDER_OPTIONS.has(key) || kchartTheme) options[key] = value;
    else site[key] = value;
  }
  return { ...options, [siteConfig]: site };
}

export function initialize(options = {}) {
  config = { ...options };
}

export function detectType(text) {
  const { kind } = prepareSource(text, { syntax: 'mermaid' });
  const key = kind.toLowerCase();
  const type = diagramTypes.find(({ kind, aliases, syntax }) => syntax === 'mermaid'
    && [kind, ...aliases].some(name => name.toLowerCase() === key));
  if (!type) throw new Error(`Unknown Mermaid diagram type: ${kind}`);
  return type.kind;
}

// Warnings never reject: only diagnostics with severity "error" make a diagram invalid.
const isError = (item) => item.severity !== 'warning';

function invalid(diagnostics) {
  return Object.assign(new Error(diagnostics.find(isError)?.message ?? 'Mermaid diagram could not be rendered'), { diagnostics });
}

export async function render(id, text, options = {}) {
  const { svg, diagnostics } = await diagram(text, optionsOf({ ...config, prefix: id, ...options }));
  if (svg === null) throw invalid(diagnostics);
  return { svg, diagramType: detectType(text), diagnostics };
}

export async function parse(text, { suppressErrors = false } = {}) {
  const diagnostics = await check(text, optionsOf(config));
  if (diagnostics.some(isError)) {
    if (suppressErrors) return false;
    throw invalid(diagnostics);
  }
  return { diagramType: detectType(text), diagnostics };
}

// Mermaid itself is used as `import mermaid from 'mermaid'`; the same form works here.
export default { initialize, render, parse, detectType };
