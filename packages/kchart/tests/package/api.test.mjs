import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { galleryCases } from '../../../../docs/showcase/gallery-cases.mjs';
import * as api from '@fengwk/kchart';
import * as node from '@fengwk/kchart/node';
import * as mermaid from '@fengwk/kchart/mermaid';

import { treeFamilyExamples } from '../helpers/tree-family-examples.mjs';

const families = JSON.parse(readFileSync(new URL('../../src/families.json', import.meta.url), 'utf8'));
const gallery = galleryCases('en');
const options = { width: 780, lang: 'en', theme: 'claude' };

for (const [family, entry] of Object.entries(families)) {
  // Each independent lazy assembly (including decorators and maps) must match the sync renderer.
  it(`renders ${family} with byte-identical SVG`, async () => {
    const kind = Object.keys(entry.diagrams ?? {})[0];
    if (kind) {
      const [syntax, source] = [kind, ...(entry.diagrams[kind].aliases ?? [])]
        .map(key => gallery.diagrams[key] ?? treeFamilyExamples[key]).find(Boolean);
      const opts = { ...options, syntax };
      const expected = node.diagram(source, opts).svg;
      expect(expected).toMatch(/^<svg\b/);
      expect(await api.check(source, opts)).toEqual([]);
      expect((await api.diagram(source, opts)).svg).toBe(expected);
    } else {
      const chart = entry.charts?.[0] ?? Object.keys(entry.variants)[0];
      const spec = entry.variants ? gallery.variantSpec(chart, entry.variants[chart][0]) : gallery.charts[chart];
      const expected = node.render(spec, options).svg;
      expect(expected).toMatch(/^<svg\b/);
      expect((await api.render(spec, options)).svg).toBe(expected);
    }
  });
}

// Invalid declarations retain diagnostics rather than surfacing a missing loader error.
it('returns the underlying diagnostics for unknown input', async () => {
  expect(await api.render({ chart: 'not-a-chart' })).toEqual(node.render({ chart: 'not-a-chart' }));
  expect(await api.check('not-a-diagram')).toEqual(node.check('not-a-diagram'));
});

// Covers canonical alias detection, per-call precedence and the error/suppression contract.
it('implements the Mermaid facade', async () => {
  const source = '%% comment\ngraph LR\nA --> B';
  mermaid.initialize({ theme: 'paper', width: 420 });
  try {
    expect(mermaid.detectType(source)).toBe('flowchart');
    expect(() => mermaid.detectType('not-a-diagram')).toThrow(Error);
    expect(await mermaid.parse(source)).toEqual({ diagramType: 'flowchart', diagnostics: [] });
    expect(await mermaid.render('preview', source, { width: 500 })).toEqual({
      svg: node.diagram(source, { theme: 'paper', width: 500, prefix: 'preview' }).svg,
      diagramType: 'flowchart', diagnostics: [],
    });
    const bad = 'flowchart LR\nclick A call callback()';
    const diagnostic = { code: 'BAD_DIAGRAM', line: 2 };
    await expect(mermaid.render('preview', bad)).rejects.toBeInstanceOf(Error);
    await expect(mermaid.render('preview', bad)).rejects.toMatchObject({ diagnostics: [expect.objectContaining(diagnostic)] });
    await expect(mermaid.parse(bad)).rejects.toMatchObject({ diagnostics: [expect.objectContaining(diagnostic)] });
    expect(await mermaid.parse(bad, { suppressErrors: true })).toBe(false);
  } finally {
    mermaid.initialize();
  }
});
