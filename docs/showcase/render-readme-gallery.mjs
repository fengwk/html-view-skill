// Render the README gallery in Chinese and English into a new temporary directory:
// SVG plates, embeddable Markdown fragments and a coverage manifest. Publish the result with sync-readme.mjs.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalog, createRenderer, diagramTypes } from '../../skills/html-view/kchart/node.mjs';
import { launchBrowser } from '../../skills/html-view/scripts/src/shared/browser.mjs';
import { galleryCases } from './gallery-cases.mjs';

const LANGS = ['zh-CN', 'en'];
// Two independent strips wrap to one column on phones. Render at their real pixel widths; never scale an SVG.
const STRIP = 360, WIDE = 780, PAD = 9, TOP = 57, GAP = 10;
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const safeScript = value => value.replace(/<\/script/gi, '<\\/script');

// Build every sample for one language and prove that the gallery covers the whole catalog exactly once.
function samplesFor(lang, catalog, diagramTypes) {
  const cases = galleryCases(lang);
  const samples = new Map();
  for (const [chart, spec] of Object.entries(cases.charts)) samples.set(`chart-${chart}`, { spec, key: chart });
  for (const layout of catalog.mindmap.special.layout) {
    samples.set(`mindmap-${layout}`, { spec: { ...cases.charts.mindmap, layout }, key: `mindmap / ${layout}` });
  }
  for (const [kind, [syntax, source]] of Object.entries(cases.diagrams)) samples.set(`diagram-${kind}`, { syntax, source, key: kind });
  const chartTitle = new Map(cases.groups.flatMap(group => group.items).map(item => [item.id, item.title]));
  for (const group of cases.variantGroups) {
    group.items = group.charts.flatMap(chart => (catalog[chart].special.variant || []).map(variant => {
      const label = cases.variantLabel[variant];
      assert.ok(label, `${chart}:${variant} has no gallery label`);
      const id = `variant-${chart}-${variant}`;
      samples.set(id, { spec: cases.variantSpec(chart, variant), key: `${chart} / ${variant}` });
      return { id, title: `${chartTitle.get(`chart-${chart}`)} · ${label}`, wide: chart === 'calendar' || (chart === 'mindmap' && variant === 'cards') };
    }));
  }
  const groups = [...cases.groups, ...cases.variantGroups];
  const shown = groups.flatMap(group => group.items.map(item => item.id));
  assert.deepEqual(shown.slice().sort(), [...samples.keys()].sort(), `${lang}: every sample appears exactly once`);
  assert.equal(new Set(shown).size, shown.length);
  assert.deepEqual(Object.keys(cases.charts).sort(), Object.keys(catalog).sort(), `${lang}: one sample per chart type`);
  const variants = Object.entries(catalog).flatMap(([chart, entry]) => (entry.special.variant || []).map(variant => `variant-${chart}-${variant}`));
  assert.deepEqual(shown.filter(id => id.startsWith('variant-')).sort(), variants.sort(), `${lang}: one sample per variant`);
  const diagramKinds = Object.entries(cases.diagrams).map(([key, [syntax]]) => {
    const type = diagramTypes.find(type => type.syntax === syntax && [type.kind, ...type.aliases].includes(key));
    assert.ok(type, `${lang}: unknown diagram sample ${syntax}:${key}`);
    return type.kind;
  });
  assert.deepEqual(diagramKinds.sort(), diagramTypes.map(type => type.kind).sort(), `${lang}: one sample per diagram type`);
  return { cases, samples, groups };
}

const built = Object.fromEntries(LANGS.map(lang => [lang, samplesFor(lang, catalog, diagramTypes)]));
const everySpec = LANGS.flatMap(lang => [...built[lang].samples.values()].map(sample => sample.spec ?? { syntax: sample.syntax, source: sample.source }));
const renderer = createRenderer({ specs: [...everySpec, built.en.cases.themeSpec] });
const themes = Object.values(renderer.themes);
const counts = {
  charts: Object.keys(renderer.catalog).length,
  variants: Object.values(renderer.catalog).reduce((sum, entry) => sum + (entry.special.variant?.length || 0), 0),
  diagrams: renderer.diagramTypes.length,
  layouts: renderer.catalog.mindmap.special.layout.length,
};

const out = await mkdtemp(join(tmpdir(), 'kchart-readme-'));
const FONT = renderer.themes.paper.fontFamily;
const artwork = join(out, 'renderer.html');
const mapAssets = Object.assign({}, ...everySpec.filter(spec => spec.data?.map).map(spec => renderer.assets(spec)));
await writeFile(artwork, `<!doctype html><html><meta charset="utf-8"><body><div id="scene"></div><script>${safeScript(renderer.bundleSource())}</script><script>
const assets = ${safeScript(JSON.stringify(mapAssets))};
const ctx = document.createElement('canvas').getContext('2d');
const measure = (text, size=12, weight=400, font=${JSON.stringify(FONT)}) => {
  ctx.font = weight+' '+size+'px '+font;
  return ctx.measureText(String(text ?? '')).width;
};
window.draw = ({spec, source, syntax}, width, theme, prefix, lang) => {
  document.documentElement.lang = lang;
  const options = {width,theme,prefix,assets,measure,lang,frame:false};
  const result = spec ? KChart.render(spec, options) : KChart.diagram(source, {...options, syntax});
  if (!result.svg || result.diagnostics?.length) throw new Error(prefix+': '+JSON.stringify(result.diagnostics));
  document.getElementById('scene').innerHTML = result.svg;
  const element = document.querySelector('#scene svg');
  const b = element.getBoundingClientRect();
  const overflow = [...element.querySelectorAll('text')].filter(text => {
    const t = text.getBoundingClientRect();
    return t.left < b.left - 2 || t.right > b.right + 2 || t.top < b.top - 2 || t.bottom > b.bottom + 2;
  }).map(text => text.textContent);
  return {svg:result.svg, width:element.width.baseVal.value, height:element.height.baseVal.value, overflow};
};</script></body></html>`);

function card(item, render, theme, width, y) {
  const height = Math.ceil(render.height) + TOP + 11;
  const x = (width - render.width) / 2;
  const swatches = item.swatches ? theme.tones.map((color, i) => `<circle cx="${width - 17 - (5 - i) * 14}" cy="28" r="4" fill="${color}"/>`).join('') : '';
  return { height, markup: `<g transform="translate(0 ${y})" data-sample="${esc(item.id)}"><rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="13" fill="${theme.surface}" stroke="${theme.line2}"/><path d="M16 17v22" stroke="${theme.accent}" stroke-width="3" stroke-linecap="round"/><text x="29" y="27" font-size="16" font-weight="650" fill="${theme.fg1}">${esc(item.title)}</text><text x="29" y="45" font-size="12" fill="${theme.fg3}">${esc(item.key)}</text>${swatches}<g transform="translate(${x} ${TOP})">${render.svg}</g></g>` };
}

async function writeStrip(dir, filename, title, entries, width, lang) {
  let y = 0;
  const markup = entries.map(({ item, render, theme }) => {
    const panel = card(item, render, theme, width, y);
    y += panel.height + GAP;
    return panel.markup;
  });
  const height = y - GAP;
  const alt = entries.map(({ item }) => item.title).join(lang === 'en' ? ', ' : '、');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${esc(FONT)}" role="img" lang="${lang}"><title>${esc(title)}</title><desc>${esc(alt)}</desc>${markup.join('\n')}</svg>\n`;
  await writeFile(join(dir, filename), svg);
  return { filename, width, height, alt, samples: entries.map(({ item }) => item.id) };
}

const report = { counts, languages: {} };
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 1000 });
  await page.goto(pathToFileURL(artwork).href);
  // Leave a small gutter for renderers that include border pixels in their natural width.
  const draw = (sample, width, theme, prefix, lang) => page.json(`window.draw(${JSON.stringify(sample)},${width - PAD * 2 - 4},${JSON.stringify(theme)},${JSON.stringify(prefix)},${JSON.stringify(lang)})`);
  for (const lang of LANGS) {
    const { cases, samples, groups } = built[lang];
    const dir = join(out, 'gallery', lang);
    await mkdir(dir, { recursive: true });
    const record = { groups: [] };
    for (const group of groups) {
      const compact = [], wide = [], theme = renderer.themes.claude;
      const files = [];
      for (const item of group.items) {
        const sample = samples.get(item.id);
        const entry = { ...item, key: sample.key };
        const input = sample.spec ? { spec: sample.spec } : { syntax: sample.syntax, source: sample.source };
        let width = item.wide ? WIDE : STRIP;
        let rendered = await draw(input, width, theme.id, `g-${group.id}-${item.id}`, lang);
        if (width === STRIP && (rendered.width > STRIP - PAD * 2 || rendered.overflow.length)) {
          width = WIDE;
          rendered = await draw(input, width, theme.id, `g-${group.id}-${item.id}`, lang);
        }
        assert.ok(Number.isFinite(rendered.height) && rendered.height > 0 && rendered.width <= width - PAD * 2,
          `${lang} ${item.id}: canvas ${rendered.width}×${rendered.height} does not fit the plate`);
        assert.deepEqual(rendered.overflow, [], `${lang} ${item.id}: glyphs fall outside the canvas`);
        (width === STRIP ? compact : wide).push({ item: entry, render: rendered, theme });
      }
      // Balance the two columns without shrinking labels or leaving empty tiles.
      const columns = [[], []], heights = [0, 0];
      for (const entry of compact) {
        const i = heights[0] <= heights[1] ? 0 : 1;
        columns[i].push(entry);
        heights[i] += entry.render.height + TOP + GAP;
      }
      for (const [i, entries] of columns.entries()) if (entries.length) files.push(await writeStrip(dir, `${group.id}-${i + 1}.svg`, group.title, entries, STRIP, lang));
      for (let i = 0; i < wide.length; i += 2) files.push(await writeStrip(dir, `${group.id}-wide-${i / 2 + 1}.svg`, group.title, wide.slice(i, i + 2), WIDE, lang));
      record.groups.push({ id: group.id, title: group.title, kind: group.kind, count: group.items.length, files });
    }
    const plates = [];
    for (const theme of themes) {
      const id = `theme-${theme.id}`;
      const render = await draw({ spec: cases.themeSpec }, STRIP, theme.id, id, lang);
      assert.ok(render.width <= STRIP - PAD * 2 && render.overflow.length === 0, `${lang} ${id} does not fit`);
      const key = lang === 'en' ? `${cases.words.scheme[theme.scheme]} theme` : `${theme.name} · ${cases.words.scheme[theme.scheme]}`;
      plates.push({ item: { id, title: theme.en, key, swatches: true }, theme, render });
    }
    const themeFiles = [];
    for (const [i, indices] of [[0, 2, 4], [1, 3, 5]].entries()) themeFiles.push(await writeStrip(dir, `themes-${i + 1}.svg`, cases.words.themes, indices.map(j => plates[j]), STRIP, lang));
    record.groups.push({ id: 'themes', title: cases.words.themes, count: themes.length, files: themeFiles });

    // Map geometry is heavy. The README loads a 2× PNG that links to the unscaled vector plate.
    for (const file of record.groups.find(group => group.id === 'geography').files) {
      file.preview = file.filename.replace(/\.svg$/, '.png');
      await page.setViewport({ width: file.width, height: file.height, deviceScaleFactor: 2 });
      await page.goto(pathToFileURL(join(dir, file.filename)).href);
      await writeFile(join(dir, file.preview), await page.screenshot({ x: 0, y: 0, width: file.width, height: file.height }));
    }
    await page.setViewport({ width: 900, height: 1000, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(artwork).href);

    const prefix = `docs/showcase/gallery/${lang}`;
    const thumb = file => `<a href="${prefix}/${file.filename}"><img src="${prefix}/${file.preview ?? file.filename}" width="${file.width}" align="top" alt="${esc(file.alt)}"></a>`;
    const line = files => `<p align="center">${files.map(thumb).join(' ')}</p>`;
    // Anchors use the language-neutral group ids that also name the image files, so both READMEs share one set of slugs.
    const groupMarkdown = (group, heading = true) => {
      const compact = group.files.filter(file => file.width === STRIP), wide = group.files.filter(file => file.width === WIDE);
      return [heading ? `<a id="${group.id}"></a>\n\n#### ${group.title}` : '', compact.length ? line(compact) : '', ...wide.map(file => line([file]))].filter(Boolean).join('\n\n');
    };
    const sectionIds = { chart: 'charts', diagram: 'diagrams', variant: 'variants' };
    const fragment = ['chart', 'diagram', 'variant'].map(kind => {
      const groups = record.groups.filter(group => group.kind === kind);
      return [`<a id="${sectionIds[kind]}"></a>\n\n### ${cases.words.sections[kind]}`, groups.map(group => `[${group.title}](#${group.id})`).join(' · '),
        ...groups.map(group => groupMarkdown(group))].join('\n\n');
    }).join('\n\n');
    await writeFile(join(out, `gallery.${lang}.md`), fragment + '\n');
    await writeFile(join(out, `themes.${lang}.md`), groupMarkdown(record.groups.find(group => group.id === 'themes'), false) + '\n');
    report.languages[lang] = record;
  }
} finally { await browser.close(); }
await writeFile(join(out, 'manifest.json'), JSON.stringify(report, null, 2) + '\n');
console.log(out);
