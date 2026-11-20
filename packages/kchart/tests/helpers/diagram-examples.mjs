import { readFileSync } from 'node:fs';
import { galleryCases } from '../../../../docs/showcase/gallery-cases.mjs';

// One renderable [syntax, source] per diagram kind or alias: the English showcase case when there is one,
// otherwise the first passing Mermaid 12.3.0 corpus record whose header names the kind. New diagram
// families therefore need no per-slice example table in the shared entry and package tests.
const gallery = galleryCases('en').diagrams;
const corpus = JSON.parse(readFileSync(new URL('../conformance/mermaid-12.3.0.json', import.meta.url), 'utf8'));
const passing = new Set(JSON.parse(readFileSync(new URL('../conformance/expected-pass.json', import.meta.url), 'utf8')));

export function diagramExample(keys) {
  for (const key of keys) if (gallery[key]) return gallery[key];
  const names = new Set(keys.map(key => key.toLowerCase()));
  const record = corpus.find(r => passing.has(r.id) && names.has(r.header.toLowerCase()));
  return record ? ['mermaid', record.source] : undefined;
}
