// Render the README gallery in Chinese and English into a new temporary directory:
// one SVG tile per sample, one full-page PNG per built-in theme, embeddable Markdown fragments and a coverage manifest.
// Publish the result with sync-readme.mjs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { catalog, createRenderer, diagramTypes } from '../../skills/html-view/vendor/kchart/esm/node.js';
import { launchBrowser } from '../../skills/html-view/scripts/src/shared/browser.mjs';
import { galleryCases } from './gallery-cases.mjs';

const LANGS = ['zh-CN', 'en'];
// Two 360px cells share a table row; a sample that needs more room takes a full 780px row.
// Tiles are drawn at their real pixel widths; never scale an SVG to make it fit.
const CELL = 360, WIDE = 780, PAD = 9, PAD_Y = 16, SWATCH_ROW = 26, RADIUS = 12, TALL = 520;
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const safeScript = value => value.replace(/<\/script/gi, '<\\/script');
const cli = fileURLToPath(new URL('../../skills/html-view/scripts/htmlview', import.meta.url));
const htmlview = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' }));
// Page samples are real documents captured at the wide-tile width and 2× pixels; the bottom margin matches the page's top.
const PAGE_SCALE = 2, PAGE_MARGIN = 28;

// `info` only prints the renderer version: a supported Mermaid keyword, not a figure to show.
const showcased = types => types.filter(type => type.kind !== 'info');

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
  assert.deepEqual(diagramKinds.sort(), showcased(diagramTypes).map(type => type.kind).sort(), `${lang}: one sample per diagram type`);
  return { cases, samples, groups };
}

const built = Object.fromEntries(LANGS.map(lang => [lang, samplesFor(lang, catalog, diagramTypes)]));
const everySpec = LANGS.flatMap(lang => [...built[lang].samples.values()].map(sample => sample.spec ?? { syntax: sample.syntax, source: sample.source }));
const renderer = createRenderer({ specs: [...everySpec, built.en.cases.themeSpec] });
const themes = Object.values(renderer.themes);
const counts = {
  charts: Object.keys(renderer.catalog).length,
  variants: Object.values(renderer.catalog).reduce((sum, entry) => sum + (entry.special.variant?.length || 0), 0),
  diagrams: showcased(renderer.diagramTypes).length,
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
  if (!result.svg) throw new Error(prefix+': '+JSON.stringify(result.diagnostics));
  document.getElementById('scene').innerHTML = result.svg;
  const element = document.querySelector('#scene svg');
  const b = element.getBoundingClientRect();
  const overflow = [...element.querySelectorAll('text')].filter(text => {
    const t = text.getBoundingClientRect();
    return t.left < b.left - 2 || t.right > b.right + 2 || t.top < b.top - 2 || t.bottom > b.bottom + 2;
  }).map(text => text.textContent);
  const diagnostics = (result.diagnostics || []).map(d => d.code+': '+d.message);
  return {svg:result.svg, width:element.width.baseVal.value, height:element.height.baseVal.value, overflow, diagnostics};
};</script></body></html>`);
// A diagram much wider than a cell warns LARGE_DIAGRAM at cell width; that only means it belongs in a wide row.
const tooLarge = rendered => rendered.diagnostics.length > 0 && rendered.diagnostics.every(text => text.startsWith('LARGE_DIAGRAM:'));

// Cells in one row share a height, so compact samples of similar height are paired: after sorting by height,
// neighbours make the pairs with the least empty card space. When a compact run has an odd count of three or
// more, the last row uses three cells instead of leaving one chart alone above a packed row. A single compact
// leftover after a wide row still occupies a full-width row. Wide samples keep their own rows. Rows then follow
// gallery order by their earliest sample.
function rowsOf(entries) {
  const indexed = entries.map((entry, index) => ({ entry, index }));
  const rows = [];
  let buf = [];
  const flush = () => {
    if (!buf.length) return;
    const compact = [...buf].sort((a, b) => a.entry.render.height - b.entry.render.height);
    const packed = [];
    if (compact.length % 2 === 1 && compact.length >= 3) {
      const last3 = compact.splice(compact.length - 3, 3);
      for (let i = 0; i < compact.length; i += 2) packed.push([compact[i], compact[i + 1]].sort((a, b) => a.index - b.index));
      packed.push(last3.sort((a, b) => a.index - b.index));
    } else if (compact.length === 1) {
      packed.push([compact[0]]);
    } else {
      for (let i = 0; i < compact.length; i += 2) packed.push([compact[i], compact[i + 1]].sort((a, b) => a.index - b.index));
    }
    packed.sort((a, b) => a[0].index - b[0].index);
    rows.push(...packed);
    buf = [];
  };
  for (const item of indexed) {
    if (item.entry.width === WIDE) { flush(); rows.push([item]); }
    else buf.push(item);
  }
  flush();
  return rows.map(row => row.map(({ entry }) => entry));
}

// Homepage theme comparison: a four-theme lead row (the same set as the hero stack) and a three-theme row
// for the remaining built-in themes, so the table never starts with a single leftover cell.
const THEME_LEAD = ['paper', 'claude', 'tokyo', 'terminal'];
const THEME_REST = ['obsidian', 'kanagawa', 'cloudmusic'];
function themeRows(plates) {
  const get = id => plates.find(entry => entry.item.id === `theme-${id}`);
  return [THEME_LEAD.map(get), THEME_REST.map(get)];
}

// One tile per sample: the sample's own theme card, centered at its natural size. Cells in one row share a height,
// so the captions under them line up.
async function writeTile(dir, entry, height, lang) {
  const { item, render, theme, width } = entry;
  const top = item.swatches ? SWATCH_ROW : 0;
  const x = (width - render.width) / 2, y = top + (height - top - render.height) / 2;
  const swatches = item.swatches ? theme.tones.map((color, i) => `<circle cx="${20 + i * 14}" cy="${PAD_Y + 4}" r="4" fill="${color}"/>`).join('') : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${esc(FONT)}" role="img" lang="${lang}"><title>${esc(item.title)}</title><rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${RADIUS}" fill="${theme.surface}" stroke="${theme.line2}"/>${swatches}<g transform="translate(${x} ${y})">${render.svg}</g></svg>\n`;
  const filename = `${item.id}.svg`;
  await writeFile(join(dir, filename), svg);
  return { id: item.id, filename, width, height, title: item.title, key: item.key };
}

async function writeRows(dir, entries, lang, planned = rowsOf(entries)) {
  const rows = [];
  for (const row of planned) {
    const height = Math.ceil(Math.max(...row.map(({ item, render }) => render.height + (item.swatches ? SWATCH_ROW : 0)))) + PAD_Y * 2;
    const tiles = [];
    for (const entry of row) tiles.push(await writeTile(dir, entry, height, lang));
    rows.push(tiles);
  }
  return rows;
}

const report = { counts, languages: {} };
const browser = await launchBrowser();
try {
  // One tab only: a second tab would push this one into the background, where Chrome stops painting it.
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
    const theme = renderer.themes.claude;
    for (const group of groups) {
      const entries = [];
      for (const item of group.items) {
        const sample = samples.get(item.id);
        const input = sample.spec ? { spec: sample.spec } : { syntax: sample.syntax, source: sample.source };
        let width = item.wide ? WIDE : CELL;
        let rendered = await draw(input, width, theme.id, `g-${item.id}`, lang);
        if (width === CELL && (rendered.width > CELL - PAD * 2 || rendered.overflow.length || tooLarge(rendered))) {
          width = WIDE;
          rendered = await draw(input, width, theme.id, `g-${item.id}`, lang);
        } else if (width === CELL && rendered.height > TALL) {
          // A very tall narrow tile (stacked panels) reads better across a full row when that layout is shorter.
          const wide = await draw(input, WIDE, theme.id, `g-${item.id}`, lang);
          if (wide.height < rendered.height && !wide.overflow.length) { width = WIDE; rendered = wide; }
        }
        assert.ok(Number.isFinite(rendered.height) && rendered.height > 0 && rendered.width <= width - PAD * 2,
          `${lang} ${item.id}: canvas ${rendered.width}×${rendered.height} does not fit the tile`);
        assert.deepEqual(rendered.overflow, [], `${lang} ${item.id}: glyphs fall outside the canvas`);
        assert.deepEqual(rendered.diagnostics, [], `${lang} ${item.id}: a gallery sample must render without diagnostics`);
        entries.push({ item: { ...item, key: sample.key }, render: rendered, theme, width });
      }
      record.groups.push({ id: group.id, title: group.title, kind: group.kind, count: group.items.length, rows: await writeRows(dir, entries, lang) });
    }
    const plates = [];
    for (const themeItem of themes) {
      const id = `theme-${themeItem.id}`;
      const render = await draw({ spec: cases.themeSpec }, CELL, themeItem.id, id, lang);
      assert.ok(render.width <= CELL - PAD * 2 && render.overflow.length === 0 && render.diagnostics.length === 0, `${lang} ${id} does not fit`);
      const key = lang === 'en' ? `${cases.words.scheme[themeItem.scheme]} theme` : `${themeItem.name} · ${cases.words.scheme[themeItem.scheme]}`;
      plates.push({ item: { id, title: themeItem.en, key, swatches: true }, theme: themeItem, render, width: CELL });
    }
    record.groups.push({ id: 'themes', title: cases.words.themes, count: themes.length, rows: await writeRows(dir, plates, lang, themeRows(plates)) });

    // The same short document in every theme, built and audited by the CLI, then captured from the top of the page
    // to the end of its content. The tab returns to the chart renderer after the map previews below.
    const pageDir = join(out, 'pages', lang);
    await mkdir(pageDir, { recursive: true });
    const pageSource = join(pageDir, 'theme-page.md');
    await writeFile(pageSource, cases.themePage);
    record.themePages = [];
    for (const [index, themeItem] of themes.entries()) {
      const html = join(pageDir, `${themeItem.id}.html`);
      htmlview('doc', 'build', pageSource, '--type', 'one-pager', '--theme', themeItem.id, '--lang', lang, '--out', html);
      const audit = htmlview('audit', html);
      assert.equal(audit.pass, true, `${lang} ${themeItem.id} page: ${JSON.stringify(audit.failures)}`);
      await page.setViewport({ width: WIDE, height: 900, deviceScaleFactor: PAGE_SCALE });
      await page.goto(pathToFileURL(html).href);
      await page.evaluate('(async()=>{await document.fonts.ready;await window.HtmlViewViz?.ready();return true;})()');
      const box = await page.json(`JSON.stringify({scrollWidth:document.documentElement.scrollWidth,
        bottom:Math.max(...[...document.querySelectorAll('#main section > *')].map(node=>node.getBoundingClientRect().bottom+scrollY))})`);
      assert.ok(box.scrollWidth <= WIDE, `${lang} ${themeItem.id} page overflows: ${box.scrollWidth}px`);
      const height = Math.ceil(box.bottom + PAGE_MARGIN);
      const filename = `theme-${themeItem.id}-page.png`;
      await writeFile(join(dir, filename), await page.screenshot({ x: 0, y: 0, width: WIDE, height }));
      record.themePages.push({ id: themeItem.id, filename, width: WIDE, height, title: themeItem.en, key: plates[index].item.key });
    }

    // Map geometry is heavy. The README loads a 2× PNG that links to the unscaled vector tile.
    for (const tile of record.groups.find(group => group.id === 'geography').rows.flat()) {
      tile.preview = tile.filename.replace(/\.svg$/, '.png');
      await page.setViewport({ width: tile.width, height: tile.height, deviceScaleFactor: 2 });
      await page.goto(pathToFileURL(join(dir, tile.filename)).href);
      await writeFile(join(dir, tile.preview), await page.screenshot({ x: 0, y: 0, width: tile.width, height: tile.height }));
    }
    await page.setViewport({ width: 900, height: 1000, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(artwork).href);

    const prefix = `docs/showcase/gallery/${lang}`;
    // GitHub keeps align, valign, width and colspan on table cells; captions stay real text for search, translation and dark mode.
    const cell = tile => `<a href="${prefix}/${tile.filename}"><img src="${prefix}/${tile.preview ?? tile.filename}" width="${tile.width}" alt="${esc(tile.title)}"></a><br><b>${esc(tile.title)}</b><br><sub><code>${esc(tile.key)}</code></sub>`;
    // One table per row so a three-column last row does not fight a two-column row in the same table.
    // On a phone GitHub shrinks each column to the screen: its CSS gives images max-width:100%, a cell's width
    // attribute is not a minimum, and style attributes are stripped. Every tile therefore links to its full-size SVG.
    const cellWidth = n => n === 3 ? '33%' : n === 4 ? '25%' : '50%';
    const row = tiles => tiles.length === 1
      ? `<tr>\n<td align="center">${cell(tiles[0])}</td>\n</tr>`
      : `<tr>\n${tiles.map(tile => `<td align="center" valign="top" width="${cellWidth(tiles.length)}">${cell(tile)}</td>`).join('\n')}\n</tr>`;
    const table = group => group.rows.map(tiles => `<table>\n${row(tiles)}\n</table>`).join('\n\n');
    // Anchors use the language-neutral group ids, so both READMEs share one set of slugs.
    const groupMarkdown = (group, heading = true) => [heading ? `<a id="${group.id}"></a>\n\n#### ${group.title}` : '', table(group)].filter(Boolean).join('\n\n');
    const sectionIds = { chart: 'charts', diagram: 'diagrams', variant: 'variants' };
    const fragment = ['chart', 'diagram', 'variant'].map(kind => {
      const kindGroups = record.groups.filter(group => group.kind === kind);
      return [`<a id="${sectionIds[kind]}"></a>\n\n### ${cases.words.sections[kind]}`, kindGroups.map(group => `[${group.title}](#${group.id})`).join(' · '),
        ...kindGroups.map(group => groupMarkdown(group))].join('\n\n');
    }).join('\n\n');
    await writeFile(join(out, `gallery.${lang}.md`), fragment + '\n');
    // GitHub keeps <details name>, prefixing it the same way for every block, so browsers that support exclusive
    // details share a name so browsers that support exclusive details keep one theme open at a time;
    // others fall back to independent toggles. None starts open.
    const pageDetails = record.themePages.map((tile) => `<details name="theme-page">\n<summary><b>${esc(tile.title)}</b> · ${esc(tile.key)}</summary>\n\n`
      + `<a href="${prefix}/${tile.filename}"><img src="${prefix}/${tile.filename}" width="${tile.width}" alt="${esc(cases.words.pageAlt(tile.title))}"></a>\n\n</details>`).join('\n');
    await writeFile(join(out, `themes.${lang}.md`), [groupMarkdown(record.groups.find(group => group.id === 'themes'), false), cases.words.themePages, pageDetails].join('\n\n') + '\n');
    report.languages[lang] = record;
  }
} finally { await browser.close(); }
await writeFile(join(out, 'manifest.json'), JSON.stringify(report, null, 2) + '\n');
console.log(out);
