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

// The table is assembled once, in the shared page API, so every entry returns the same model.
it('returns the labelled and formatted chart table from every entry', async () => {
  const spec = {
    chart: 'bar',
    data: [{ month: '2026-11', revenue: 1284000 }],
    encode: { category: 'month', value: 'revenue' },
    fields: { month: { label: '月份' }, revenue: { label: '上月收入', unit: '元' } },
  };
  const renderOptions = { width: 780, lang: 'zh', theme: 'claude' };
  const expected = {
    columns: [{ key: 'month', label: '月份' }, { key: 'revenue', label: '上月收入（元）' }],
    rows: [[{ text: '2026-11', value: '2026-11' }, { text: '128.4万元', value: 1284000 }]],
  };
  const renderer = node.createRenderer({ specs: [spec] });
  expect(node.render(spec, renderOptions).table).toEqual(expected);
  expect(renderer.render(spec, renderOptions).table).toEqual(expected);
  expect(page(renderer.bundleSource()).render(spec, renderOptions).table).toEqual(expected);
  expect((await asyncRender(spec, renderOptions)).table).toEqual(expected);
  // The render language picks the unit suffix, so a host can render either style from one model.
  expect(node.render(spec, { ...renderOptions, lang: 'en' }).table.columns.map(({ label }) => label))
    .toEqual(['月份', '上月收入 (元)']);
  // Field formats reach the table too; 0.792 shows as 79.2%.
  const percent = {
    chart: 'bar',
    data: [{ channel: 'push', rate: 0.792 }],
    encode: { category: 'channel', value: 'rate' },
    fields: { rate: { label: '转化率', format: 'percent', decimals: 1 } },
  };
  expect(node.render(percent, renderOptions).table).toEqual({
    columns: [{ key: 'channel', label: 'channel' }, { key: 'rate', label: '转化率（%）' }],
    rows: [[{ text: 'push', value: 'push' }, { text: '79.2%', value: 0.792 }]],
  });
  // Non-tabular data and a chart that never drew have no table to show.
  expect(node.render(gallery.charts.tree, renderOptions).table).toBeNull();
  expect(node.render({ chart: 'not-a-chart' }, renderOptions).table).toBeNull();
});

// Checks the optional interaction bundle, diagram-only bundle and the rendering-only page API.
it('preserves optional browser APIs', () => {
  const source = 'flowchart TD\n A --> B';
  expect(Object.keys(page(node.createRenderer({ sources: [source] }).bundleSource())).sort()).toEqual(diagramKeys);
  const browser = page(node.createRenderer({ specs: [{ chart: 'line', interaction: [{}] }] }).bundleSource());
  expect(Object.keys(browser).sort()).toEqual([...chartKeys, 'attach'].sort());
  // Mounting and the data table belong to the host, so the page API must not grow them back.
  for (const name of ['mount', 'mountClones', 'ready', 'relayout', 'dataTable']) expect(browser[name]).toBeUndefined();
});
