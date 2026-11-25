import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { galleryCases } from '../../../../docs/showcase/gallery-cases.mjs';
import * as node from '../../dist/esm/node.js';
import { registerIcons, render as asyncRender } from '../../dist/esm/index.js';
import { diagramExample } from '../helpers/diagram-examples.mjs';

const families = JSON.parse(readFileSync(new URL('../../src/families.json', import.meta.url), 'utf8'));
const gallery = galleryCases('en');
const chartKeys = ['catalog', 'layouts', 'parse', 'render', 'schema', 'theme', 'themes', 'validate'];
const diagramKeys = ['check', 'diagram', 'diagramTypes'];
const page = (script) => {
  const context = {};
  expect(script).not.toMatch(/<\/script/i);
  runInNewContext(script, context);
  return context.KChart;
};
const options = { width: 780, lang: 'en', theme: 'claude' };

// Pins the synchronous Node export surface: rendering only, with icons for the host.
it('exports the synchronous Node API', () => {
  expect(Object.keys(node).sort()).toEqual([
    'createRenderer', 'render', 'parse', 'validate', 'schema', 'catalog', 'theme', 'themes',
    'resolveThemeConfig', 'validateThemeSnapshot', 'DEFAULT_THEME', 'FONT_FAMILY', 'defaultStyle',
    'structureRoles', 'modulesFor', 'diagram', 'check', 'diagramTypes', 'detectSyntax', 'registerIcons',
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
  // A fresh classic script from the selected renderer exposes the rendering keys and matches it.
  it(`renders ${family} through the offline page API`, () => {
    const sample = chart
      ? (entry.variants ? gallery.variantSpec(chart, entry.variants[chart][0]) : gallery.charts[chart])
      : undefined;
    if (sample) {
      const renderer = node.createRenderer({ specs: [sample] });
      const browser = page(renderer.bundleSource());
      expect(Object.keys(browser).sort()).toEqual([...chartKeys, ...(sample.interaction?.length ? ['attach'] : [])].sort());
      const rendered = renderer.render(sample, options);
      expect(rendered.svg).toMatch(/^<svg\b/);
      expect(browser.render(sample, { ...options, assets: renderer.assets(sample) })).toEqual(rendered);
    } else {
      const [syntax, source] = diagramExample([kind, ...(entry.diagrams[kind].aliases ?? [])]);
      const declaration = { syntax, source };
      const renderer = node.createRenderer({ specs: [declaration] });
      const browser = page(renderer.bundleSource());
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

// Exact result keys catch a reintroduced table even on paths that never draw a chart.
const renderKeys = ['diagnostics', 'scene', 'svg'];
it('returns only SVG, scene and diagnostics from every chart entry', async () => {
  const spec = gallery.charts.line;
  const renderer = node.createRenderer({ specs: [spec] });
  const browser = page(renderer.bundleSource());
  for (const render of [asyncRender, node.render, renderer.render, browser.render]) {
    const result = await render(spec, options);
    expect(Object.keys(result).sort()).toEqual(renderKeys);
    expect(result.svg).toMatch(/^<svg\b/);

    const invalid = await render({ chart: 'not-a-chart' }, options);
    expect(Object.keys(invalid).sort()).toEqual(renderKeys);
    expect(invalid.svg).toBeNull();
    expect(invalid.scene).toBeNull();
    expect(invalid.diagnostics).not.toHaveLength(0);
  }
});

// A base-only renderer reaches both excluded-variant branches before the registry.
it('returns the same result shape for unloaded variants and their validation errors', () => {
  const renderer = node.createRenderer({ specs: [gallery.charts.line] });
  const browser = page(renderer.bundleSource());
  const variant = gallery.variantSpec('line', 'counter');
  const invalid = { ...variant, encode: {} };
  const { errors } = node.validate(invalid);
  expect(errors).not.toHaveLength(0);
  for (const render of [renderer.render, browser.render]) {
    const unloaded = render(variant, options);
    expect(Object.keys(unloaded).sort()).toEqual(renderKeys);
    expect(unloaded).toMatchObject({ svg: null, scene: null, diagnostics: [{ code: 'BAD_KCHART', path: '/variant' }] });

    const rejected = render(invalid, options);
    expect(Object.keys(rejected).sort()).toEqual(renderKeys);
    expect(rejected).toEqual({ svg: null, scene: null, diagnostics: errors });
  }
});

// Checks the optional interaction bundle, diagram-only bundle and the rendering-only page API.
it('preserves optional browser APIs', () => {
  const source = 'flowchart TD\n A --> B';
  expect(Object.keys(page(node.createRenderer({ sources: [source] }).bundleSource())).sort()).toEqual(diagramKeys);
  const browser = page(node.createRenderer({ specs: [{ chart: 'line', interaction: [{}] }] }).bundleSource());
  expect(Object.keys(browser).sort()).toEqual([...chartKeys, 'attach'].sort());
  // Mounting belongs to the host, so the page API must not grow it back.
  for (const name of ['mount', 'mountClones', 'ready', 'relayout']) expect(browser[name]).toBeUndefined();
});
