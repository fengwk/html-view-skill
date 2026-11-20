import { check, diagram, diagramTypes, themes } from './index.js';
import { ignoredConfigWarning, inferLang, prepareSource } from './src/diagram/source.js';

let config = {};

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
  const settings = { ...config, prefix: id, ...options, syntax: 'mermaid' };
  // Mermaid's own theme names (default, dark, forest, neutral, base) are not KChart themes. As with
  // `%%{init: {theme}}%%` inside a diagram, such a theme is dropped with a warning instead of failing;
  // Mermaid's default needs no warning.
  const { theme } = settings;
  const foreign = typeof theme === 'string' && !Object.hasOwn(themes, theme);
  if (foreign) delete settings.theme;
  const { svg, diagnostics } = await diagram(text, settings);
  if (svg === null) throw invalid(diagnostics);
  const diagramType = detectType(text);
  if (!foreign || theme === 'default') return { svg, diagramType, diagnostics };
  const ignored = ignoredConfigWarning(settings.lang || inferLang(text), 1, `theme: ${theme}`);
  const { topic } = diagramTypes.find(type => type.kind === diagramType);
  return { svg, diagramType, diagnostics: [...diagnostics, { ...ignored, column: 1, topic }] };
}

export async function parse(text, { suppressErrors = false } = {}) {
  const diagnostics = await check(text, { lang: config.lang, syntax: 'mermaid' });
  if (diagnostics.some(isError)) {
    if (suppressErrors) return false;
    throw invalid(diagnostics);
  }
  return { diagramType: detectType(text), diagnostics };
}

// Mermaid itself is used as `import mermaid from 'mermaid'`; the same form works here.
export default { initialize, render, parse, detectType };
