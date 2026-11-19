import { check, diagram, diagramTypes } from './index.js';
import { prepareSource } from './src/diagram/source.js';

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
  const { svg, diagnostics } = await diagram(text, { ...config, prefix: id, ...options, syntax: 'mermaid' });
  if (svg === null) throw invalid(diagnostics);
  return { svg, diagramType: detectType(text), diagnostics };
}

export async function parse(text, { suppressErrors = false } = {}) {
  const diagnostics = await check(text, { lang: config.lang, syntax: 'mermaid' });
  if (diagnostics.some(isError)) {
    if (suppressErrors) return false;
    throw invalid(diagnostics);
  }
  return { diagramType: detectType(text), diagnostics };
}
