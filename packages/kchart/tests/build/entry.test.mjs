import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { galleryCases } from '../../../../docs/showcase/gallery-cases.mjs';
import * as node from '../../dist/esm/node.js';
import { registerIcons } from '../../dist/esm/index.js';

const families = JSON.parse(readFileSync(new URL('../../src/families.json', import.meta.url), 'utf8'));
const gallery = galleryCases('en');
const chartKeys = ['catalog', 'dataTable', 'layouts', 'parse', 'render', 'schema', 'theme', 'themes', 'validate'];
const diagramKeys = ['check', 'diagram', 'diagramTypes'];
const page = (script) => {
  const context = {};
  expect(script).not.toMatch(/<\/script/i);
  runInNewContext(script, context);
  return context.KChart;
};

// Pins the synchronous Node export surface, including host icon registration.
it('exports the synchronous Node API', () => {
  expect(Object.keys(node).sort()).toEqual([
    'createRenderer', 'render', 'parse', 'validate', 'schema', 'dataTable', 'catalog', 'theme', 'themes',
    'resolveThemeConfig', 'validateThemeSnapshot', 'DEFAULT_THEME', 'FONT_FAMILY', 'defaultStyle',
    'structureRoles', 'modulesFor', 'diagram', 'check', 'diagramTypes', 'detectSyntax', 'browserSource', 'runtimeSource', 'registerIcons',
  ].sort());
});

// Both published entries share the same process-wide registry.
it('exports the same icon registration function from both entries', () => {
  expect(registerIcons).toBe(node.registerIcons);
});

for (const [family, entry] of Object.entries(families)) {
  const chart = entry.charts?.[0] ?? Object.keys(entry.variants ?? {})[0];
  const kind = Object.keys(entry.diagrams ?? {})[0];
  if (!chart && !kind) continue;
  // A fresh classic-script VM exposes the old keys and renders the same SVG as the matching Node renderer.
  it(`renders ${family} through the offline page API`, () => {
    const options = { width: 780, lang: 'en', theme: 'claude' };
    if (chart) {
      const spec = entry.variants ? gallery.variantSpec(chart, entry.variants[chart][0]) : gallery.charts[chart];
      const renderer = node.createRenderer({ specs: [spec] });
      const browser = page(node.browserSource([spec]));
      expect(Object.keys(browser).sort()).toEqual([...chartKeys, ...(spec.interaction?.length ? ['attach'] : [])].sort());
      const svg = renderer.render(spec, options).svg;
      expect(svg).toMatch(/^<svg\b/);
      expect(browser.render(spec, { ...options, assets: renderer.assets(spec) }).svg).toBe(svg);
    } else {
      const keys = [kind, ...(entry.diagrams[kind].aliases ?? [])];
      const [syntax, source] = keys.map(key => gallery.diagrams[key]).find(Boolean);
      const declaration = { syntax, source };
      const renderer = node.createRenderer({ specs: [declaration] });
      const browser = page(node.browserSource([declaration]));
      expect(Object.keys(browser).sort()).toEqual([...chartKeys, ...diagramKeys].sort());
      const svg = renderer.diagram(source, { ...options, syntax }).svg;
      expect(svg).toMatch(/^<svg\b/);
      expect(browser.diagram(source, { ...options, syntax }).svg).toBe(svg);
    }
  });
}

// Ensures declaration selection remains isolated even after the shared ESM modules have loaded.
it('limits the layouts of each renderer to its declared families', () => {
  const full = node.createRenderer();
  const line = node.createRenderer({ specs: [gallery.charts.line] });
  expect(full.layouts.has('pie')).toBe(true);
  expect(line.layouts.has('pie')).toBe(false);
  expect(line.render(gallery.charts.pie).diagnostics[0]).toMatchObject({ code: 'BAD_KCHART', path: '/chart' });
});

// Checks the optional interaction, diagram-only bundle and runtime API shapes.
it('preserves optional browser APIs', () => {
  const source = 'flowchart TD\n A --> B';
  expect(Object.keys(page(node.createRenderer({ sources: [source] }).bundleSource())).sort()).toEqual(diagramKeys);
  const browser = page(node.browserSource([{ chart: 'line', interaction: [{}] }]));
  expect(Object.keys(browser).sort()).toEqual([...chartKeys, 'attach'].sort());
  const context = { KChart: browser, document: { addEventListener() {} } };
  runInNewContext(node.runtimeSource(), context);
  expect(Object.keys(context.KChart).sort()).toEqual([...chartKeys, 'attach', 'mount', 'mountClones', 'ready', 'relayout'].sort());
});
