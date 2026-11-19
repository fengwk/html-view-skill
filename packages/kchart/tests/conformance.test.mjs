import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { galleryCases } from '../../../docs/showcase/gallery-cases.mjs';
import { expectedPassFile, failed, inspectDiagram, runCorpus, widths } from './helpers/conformance.mjs';

// Protect every previously clean Mermaid example at both sizes while allowing new passes.
test('Mermaid 12.3.0 conformance ratchet', () => {
  const expected = JSON.parse(readFileSync(expectedPassFile, 'utf8'));
  expect(Array.isArray(expected) && expected.length > 0).toBe(true);
  expect(expected).toEqual([...new Set(expected)].sort());
  const { ids, failures } = runCorpus();
  expect(expected.filter(id => !ids.has(id)), 'unknown or no longer valid fixture ids').toEqual([]);
  expect(expected.flatMap(id => failures.has(id) ? [{ id, failures: failures.get(id) }] : []), 'regressed Mermaid examples').toEqual([]);
}, 60_000);

// Check all published diagram examples in both languages, including narrow reflow.
test('gallery diagrams have clean scene geometry', () => {
  const failures = [];
  for (const lang of ['zh-CN', 'en']) for (const [id, [syntax, source]] of Object.entries(galleryCases(lang).diagrams)) {
    for (const width of widths) {
      const result = inspectDiagram(source, { syntax, lang, width });
      if (failed(result)) failures.push({ lang, id, width, ...result });
    }
  }
  expect(failures).toEqual([]);
});
