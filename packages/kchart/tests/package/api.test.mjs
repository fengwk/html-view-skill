import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { galleryCases } from '../../../../docs/showcase/gallery-cases.mjs';
import * as api from '@fengwk/kchart';
import * as node from '@fengwk/kchart/node';
import * as mermaid from '@fengwk/kchart/mermaid';
import mermaidDefault from '@fengwk/kchart/mermaid';
import { diagramExample } from '../helpers/diagram-examples.mjs';

const families = JSON.parse(readFileSync(new URL('../../src/families.json', import.meta.url), 'utf8'));
const gallery = galleryCases('en');
const options = { width: 780, lang: 'en', theme: 'claude' };

for (const [family, entry] of Object.entries(families)) {
  // Each independent lazy assembly (including decorators and maps) must match the sync renderer.
  it(`renders ${family} with byte-identical SVG`, async () => {
    const kind = Object.keys(entry.diagrams ?? {})[0];
    if (kind) {
      const [syntax, source] = diagramExample([kind, ...(entry.diagrams[kind].aliases ?? [])]);
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
    // A warning (an ignored callback) rides along with the SVG instead of rejecting.
    const warned = await mermaid.render('preview', 'flowchart LR\nA --> B\nclick A call callback()');
    expect(warned.svg).toMatch(/^<svg/);
    expect(warned.diagnostics).toEqual([expect.objectContaining({ code: 'IGNORED_INTERACTION', severity: 'warning', line: 3 })]);
    const bad = 'flowchart LR\nA -->';
    const diagnostic = { code: 'BAD_DIAGRAM', severity: 'error', line: 2 };
    await expect(mermaid.render('preview', bad)).rejects.toBeInstanceOf(Error);
    await expect(mermaid.render('preview', bad)).rejects.toMatchObject({ diagnostics: [expect.objectContaining(diagnostic)] });
    await expect(mermaid.parse(bad)).rejects.toMatchObject({ diagnostics: [expect.objectContaining(diagnostic)] });
    expect(await mermaid.parse(bad, { suppressErrors: true })).toBe(false);
    // `import mermaid from ...` (Mermaid's own form) reaches the same functions.
    for (const name of ['initialize', 'render', 'parse', 'detectType']) expect(mermaidDefault[name]).toBe(mermaid[name]);
    // Mermaid's own theme names are not KChart themes: the default theme draws, with a warning instead of a rejection.
    mermaid.initialize({ theme: 'dark', startOnLoad: false, securityLevel: 'strict' });
    const dark = await mermaid.render('preview', source);
    expect(dark.svg).toBe(node.diagram(source, { prefix: 'preview' }).svg);
    expect(dark.diagnostics).toEqual([{ code: 'IGNORED_CONFIG', severity: 'warning', line: 1, column: 1, topic: 'flow',
      message: 'Ignored configuration: theme', fix: 'Remove configuration that does not affect rendering' }]);
    mermaid.initialize({ theme: 'default' });
    expect((await mermaid.render('preview', source)).diagnostics).toEqual([]);
  } finally {
    mermaid.initialize();
  }
});

// Mermaid settings behave like the diagram's own front-matter config, which overrides them.
it('treats Mermaid settings as site configuration', async () => {
  const c4 = 'C4Context\nPerson(a, "A")\nSystem(b, "B")\nRel(a, b, "uses")';
  const inRow = n => `---\nconfig:\n  c4:\n    c4ShapeInRow: ${n}\n---\n${c4}`;
  const svg = (text, options) => node.diagram(text, { prefix: 'p', ...options }).svg;
  try {
    const honored = await mermaid.render('p', c4, { c4: { c4ShapeInRow: 1 } });
    expect(honored).toMatchObject({ svg: svg(inRow(1)), diagnostics: [] });
    expect(honored.svg).not.toBe(svg(c4));
    expect((await mermaid.render('p', inRow(4), { c4: { c4ShapeInRow: 1 } })).svg).toBe(svg(inRow(4)));
    mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', themeVariables: { primaryColor: '#ff0000' } });
    const warned = await mermaid.render('p', c4);
    expect(warned.svg).toBe(svg(c4));
    expect(warned.diagnostics).toEqual([expect.objectContaining({ code: 'IGNORED_CONFIG', severity: 'warning', line: 1,
      message: 'Ignored configuration: themeVariables.primaryColor' })]);
    expect((await mermaid.parse(c4)).diagnostics).toEqual(warned.diagnostics);
  } finally {
    mermaid.initialize();
  }
});
