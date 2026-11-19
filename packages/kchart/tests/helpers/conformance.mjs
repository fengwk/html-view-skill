import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { diagram } from '../../dist/esm/node.js';
import { checkScene } from './geometry.mjs';

// From packages/kchart, refresh deliberately with:
// npm run build && node tests/helpers/conformance.mjs --update
// Review the diff: normal tests allow gains, and never rewrite the ratchet.
// To show the per-type summary with Vitest's default reporter:
// npm test -- --disableConsoleIntercept tests/conformance.test.mjs
const fixture = new URL('../conformance/mermaid-12.3.0.json', import.meta.url);
export const expectedPassFile = new URL('../conformance/expected-pass.json', import.meta.url);
export const widths = [800, 360];

export function inspectDiagram(source, options) {
  const { svg, scene, diagnostics } = diagram(source, options);
  return {
    ...(!svg || !scene ? { noRender: true } : {}),
    diagnostics: diagnostics.filter(d => d.severity !== 'warning' && d.severity !== 'info'),
    geometry: scene ? checkScene(scene, { measure: options.measure }) : [],
  };
}

export const failed = r => r.noRender || r.diagnostics.length || r.geometry.length;

export function runCorpus() {
  const summary = new Map(), failures = new Map(), passing = [];
  const records = JSON.parse(readFileSync(fixture, 'utf8')).filter(record => record.mermaid === 'valid');
  const ids = new Set();
  for (const { id, type, source } of records) {
    if (ids.has(id)) throw new Error(`Duplicate corpus id: ${id}`);
    ids.add(id);
    if (!summary.has(type)) summary.set(type, { valid: 0, passing: 0 });
    const counts = summary.get(type);
    counts.valid++;
    const result = widths.map(width => ({ width, ...inspectDiagram(source, { syntax: 'mermaid', width }) })).filter(failed);
    if (result.length) failures.set(id, result);
    else { counts.passing++; passing.push(id); }
  }
  const lines = [...summary].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([type, { valid, passing }]) => `${type}: ${valid} / ${passing}`);
  console.log(`Mermaid 12.3.0 (${widths.join(' & ')} px), valid / passing\n${lines.join('\n')}\nTotal: ${ids.size} / ${passing.length}`);
  return { ids, failures, passing };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv.length !== 3 || process.argv[2] !== '--update') throw new Error('Usage: node tests/helpers/conformance.mjs --update (build dist first)');
  writeFileSync(expectedPassFile, `${JSON.stringify(runCorpus().passing.sort(), null, 2)}\n`);
}
