#!/usr/bin/env node
// Usage (Node >=22, local Chrome, ImageMagick 7 for changed PNGs):
//   TMPDIR=/var/tmp node render-capture.mjs capture --out <new-dir> [--mermaid-corpus <report.json>]
//   TMPDIR=/var/tmp node render-capture.mjs compare <old-dir> <new-dir>
// Use the same corpus report, Chrome version and system fonts for both captures.
// capture writes manifest.json last; compare exits 1 for any artifact/metric difference
// or >10% ready slowdown, 2 for tool errors. HTML bytes include inline script changes.
// Corpus cells that no longer render at the requested width store diagnostics instead of SVG.
// UI uses each theme's accent/scheme (the UI CLI does not accept reading themes).
// Timing: fresh page loads to HtmlViewViz.ready(), alternating order in one tab;
// static viz has no runtime to time. Identical offline HTML is a timing control:
// measured differences are reported as noise, not regressions. No times are stored.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { galleryCases } from '../../../../../docs/showcase/gallery-cases.mjs';
import { KCHART_CASES } from '../../../../../packages/kchart/tests/kchart-cases.mjs';
import * as kchart from '../../../vendor/kchart/esm/node.js';
import { launchBrowser } from '../../src/shared/browser.mjs';
import { documentSize } from '../../src/tools/clip.mjs';

const { diagram } = kchart;

const skill = fileURLToPath(new URL('../../../', import.meta.url));
const cli = join(skill, 'scripts/htmlview');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function runCli(...args) {
  execFileSync(process.execPath, [cli, ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
}

function matrix(save, corpusFile) {
  const svg = (id, lang, render, recordDiagnostics = false) => {
    for (const theme of Object.keys(kchart.themes).sort()) for (const media of ['screen', 'print']) for (const width of [360, 780]) {
      const entry = `${id}/${lang}/${theme}-${media}-${width}.svg`;
      const result = render({ theme, media, width, lang });
      if (result.svg) save(entry, result.svg);
      else if (recordDiagnostics && result.diagnostics?.length) {
        // The corpus report tests at 800px. A narrower layout can reject the
        // same declaration; preserve that result rather than dropping the cell.
        save(entry.replace(/\.svg$/, '.diagnostics.json'), JSON.stringify(result.diagnostics, null, 2) + '\n');
      } else throw new Error(`${entry}: ${JSON.stringify(result.diagnostics)}`);
    }
  };
  for (const { id, spec } of KCHART_CASES) svg(`kchart/${id}`, 'zh-CN', options => kchart.render(spec, options));
  for (const lang of ['zh-CN', 'en']) {
    const cases = galleryCases(lang);
    const chart = (id, spec) => svg(`gallery/${id}`, lang, options => kchart.render(spec, options));
    for (const [name, spec] of Object.entries(cases.charts)) chart(`chart-${name}`, spec);
    for (const layout of kchart.catalog.mindmap.special.layout) chart(`mindmap-${layout}`, { ...cases.charts.mindmap, layout });
    for (const name of cases.variantGroups.flatMap(group => group.charts)) {
      for (const variant of kchart.catalog[name].special.variant || []) chart(`variant-${name}-${variant}`, cases.variantSpec(name, variant));
    }
    for (const [id, [syntax, source]] of Object.entries(cases.diagrams)) {
      svg(`gallery/diagram-${id}`, lang, options => diagram(source, { ...options, syntax }));
    }
  }
  if (corpusFile) {
    const records = json(corpusFile).records;
    if (!records?.length || !records.every(record => typeof record.kchart?.rendered === 'boolean')) {
      throw new Error('Expected a Mermaid corpus report with records[].kchart.rendered');
    }
    for (const { file, blockIndex, source } of records.filter(record => record.kchart.rendered)) {
      svg(`corpus/${encodeURIComponent(file)}-${blockIndex}`, 'en', options => diagram(source, options), true);
    }
  }
}

function buildPages(out) {
  const inputs = join(out, 'inputs');
  mkdirSync(inputs);
  const doc = join(inputs, 'doc.md');
  const viz = join(inputs, 'chart.json');
  const data = join(inputs, 'data');
  const gallery = galleryCases('en');
  const bar = JSON.stringify(gallery.charts.bar);
  const fence = (kind, source) => `\n\n\`\`\`${kind}\n${source}\n\`\`\`\n`;
  writeFileSync(doc, '# Coffee operations\n\n## Sales and service\n' + fence('kchart', bar)
    + fence('kchart', JSON.stringify(gallery.charts.line))
    + fence('mermaid', `---\ntitle: The order lifecycle\n---\n${gallery.diagrams.flowchart[1]}`)
    + fence('mermaid', `---\ntitle: Service interactions\n---\n${gallery.diagrams.sequenceDiagram[1]}`));
  writeFileSync(viz, bar);
  runCli('data', 'init', data);
  const pages = [];
  for (const theme of ['claude', 'obsidian', 'cloudmusic']) {
    const entries = Object.fromEntries(['doc', 'data', 'ui', 'viz'].map(kind => [kind, `pages/${theme}/${kind}.html`]));
    const file = kind => join(out, entries[kind]);
    mkdirSync(dirname(file('doc')), { recursive: true });
    const opts = ['--theme', theme, '--lang', 'en'];
    runCli('doc', 'build', doc, '--out', file('doc'), ...opts);
    // Normalize only volatile, inert CLI metadata; leave renderer/shell bytes intact.
    const normalize = (html, name, value) => html.replace(new RegExp(`(<meta name="htmlview:${name}" content=")[^"]*`), (_, prefix) => prefix + value);
    writeFileSync(file('doc'), normalize(readFileSync(file('doc'), 'utf8'), 'doc:id', 'abcdef00-0000-4000-8000-000000000000'));
    runCli('data', 'build', join(data, 'report.json'), '--out', file('data'), ...opts);
    const { accent, scheme } = kchart.theme(theme);
    runCli('ui', 'new', file('ui'), '--title', 'Store dashboard', '--device', 'responsive', '--screens', 'Overview',
      '--fidelity', 'mockup', '--brand', accent, '--scheme', scheme, '--lang', 'en');
    let ui = readFileSync(file('ui'), 'utf8');
    ui = normalize(normalize(ui, 'ui-id', 'abcdef00-0000-4000-8000-000000000001'), 'ui-created', '2026-01-01');
    ui = ui.replace(/<!-- htmlview:content -->[\s\S]*?<!-- \/htmlview:content -->/, `<!-- htmlview:content -->
<section class="screen" id="scr-overview" data-title="Overview">
  <div class="app"><header class="app-bar"><h1>Store dashboard</h1></header>
  <div class="app-body stack"><pre data-viz="kchart" id="store-chart">${bar}</pre></div></div>
</section>
<!-- /htmlview:content -->`);
    writeFileSync(file('ui'), ui);
    runCli('style', file('ui'));
    // The viz CLI uses its own short-lived Chrome session for font measurements.
    runCli('viz', 'render', viz, '--out', file('viz'), '--width', '780', ...opts);
    pages.push(...Object.values(entries));
  }
  return pages;
}

async function inOneTab(run) {
  const browser = await launchBrowser();
  try {
    const { targetInfos } = await browser.send('Target.getTargets');
    const page = await browser.newPage();
    for (const { targetId, type } of targetInfos) if (type === 'page') await browser.send('Target.closeTarget', { targetId });
    return await run(page);
  } finally {
    await browser.close();
  }
}

const viewport = width => ({ width, height: width === 390 ? 844 : 900, mobile: width === 390 });
const frames = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))';

async function capture(out, corpusFile) {
  mkdirSync(out);
  const entries = new Map();
  const save = (entry, bytes, metrics) => {
    if (entries.has(entry)) throw new Error(`Duplicate entry: ${entry}`);
    const file = join(out, entry);
    if (bytes == null) bytes = readFileSync(file);
    else {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
    }
    entries.set(entry, { sha256: sha256(bytes), bytes: Buffer.byteLength(bytes), ...(metrics && { metrics }) });
  };
  matrix(save, corpusFile);
  const diagnostics = [...entries.keys()].filter(key => key.endsWith('.diagnostics.json')).length;
  console.log(`Captured ${entries.size - diagnostics} SVGs and ${diagnostics} corpus diagnostics`);
  const pages = buildPages(out);
  await inOneTab(async page => {
    for (const entry of pages) {
      const url = pathToFileURL(join(out, entry)).href;
      const html = readFileSync(join(out, entry), 'utf8');
      const inlineScriptBytes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
        .reduce((total, [, source]) => total + Buffer.byteLength(source), 0);
      const runtime = basename(entry) !== 'viz.html';
      save(entry, null, { inlineScriptBytes, runtime });
      const scenarios = [['screen', 1280], ['screen', 390]];
      if (basename(entry) === 'doc.html') scenarios.push(['print', 1280]);
      for (const [media, width] of scenarios) {
        await page.setViewport(viewport(width));
        await page.setMedia(media);
        await page.goto(url);
        if (runtime) await page.evaluate(`HtmlViewViz.relayout({media:${JSON.stringify(media)}})`);
        await page.evaluate(frames);
        const figureCount = await page.evaluate(`document.querySelectorAll('svg[viewBox]').length`);
        if (!figureCount || await page.evaluate(`Boolean(document.querySelector('.viz-error'))`)) {
          throw new Error(`Missing or failed figure in ${entry} ${media} ${width}`);
        }
        const size = await documentSize(page);
        const png = await page.screenshot({ x: 0, y: 0, ...size });
        save(entry.replace(/\.html$/, `-${media}-${width}.png`), png,
          { viewport: width, media, width: png.readUInt32BE(16), height: png.readUInt32BE(20), figureCount });
      }
    }
  });
  const sorted = Object.fromEntries([...entries.keys()].sort().map(key => [key, entries.get(key)]));
  writeFileSync(join(out, 'manifest.json'), JSON.stringify({ entries: sorted }, null, 2) + '\n');
  console.log(`Captured ${entries.size} total entries in ${out}`);
}

export function compareEntries(oldEntries, newEntries) {
  const differences = [];
  for (const entry of [...new Set([...Object.keys(oldEntries), ...Object.keys(newEntries)])].sort()) {
    if (!Object.hasOwn(newEntries, entry)) differences.push({ entry, status: 'missing' });
    else if (!Object.hasOwn(oldEntries, entry)) differences.push({ entry, status: 'added' });
    else if (!isDeepStrictEqual(oldEntries[entry], newEntries[entry])) differences.push({ entry, status: 'changed' });
  }
  return differences;
}

function pixelAE(oldFile, newFile) {
  const result = spawnSync('magick', ['compare', '-metric', 'AE', oldFile, newFile, 'null:'], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) throw new Error(`magick compare: ${result.stderr}`);
  return result.stderr.trim();
}

const samples = 15;
const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function compareTiming(dirs, manifests) {
  const pages = Object.keys(manifests[0]).filter(entry => entry.endsWith('.html') && Object.hasOwn(manifests[1], entry));
  if (!pages.length) return false;
  return inOneTab(async page => {
    // Install before the page scripts run, so synchronous initialization and async
    // mount work both count. Use the page clock, not CDP round trip or paint wait.
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      (() => {
        const start = performance.now();
        window.addEventListener('load', () => {
          window.__captureReady = (async () => {
            if (!globalThis.HtmlViewViz?.ready) throw new Error('Missing HtmlViewViz.ready()');
            await HtmlViewViz.ready();
            return performance.now() - start;
          })();
        }, {once:true});
      })();` });
    await page.setViewport(viewport(1280));
    let slower = false;
    for (const entry of pages) {
      if (!manifests.every(entries => entries[entry].metrics?.runtime)) {
        console.log(`ready ${entry}: n/a (no paired runtime)`);
        continue;
      }
      const measure = async index => {
        await page.goto(pathToFileURL(join(dirs[index], entry)).href);
        const ms = await page.evaluate('window.__captureReady');
        if (!Number.isFinite(ms) || ms <= 0) throw new Error(`Invalid ready timing: ${entry}`);
        return ms;
      };
      await measure(0);
      await measure(1);
      const readings = [[], []];
      for (let i = 0; i < samples; i++) for (const index of [i % 2, (i + 1) % 2]) readings[index].push(await measure(index));
      const [oldMs, newMs] = readings.map(median);
      const delta = newMs / oldMs - 1;
      const identical = manifests[0][entry].sha256 === manifests[1][entry].sha256;
      // Self-contained byte-identical pages execute the same program; do not
      // let machine load turn this negative control into a failed comparison.
      console.log(`ready ${entry}: ${oldMs.toFixed(2)} ms -> ${newMs.toFixed(2)} ms (${(delta * 100).toFixed(1)}%${identical ? ', identical HTML control' : ''})`);
      if (!identical && newMs > oldMs * 1.10) slower = true;
    }
    return slower;
  });
}

async function main(args) {
  const [mode, ...rest] = args;
  if (mode === 'capture') {
    const { values } = parseArgs({ args: rest, options: { out: { type: 'string' }, 'mermaid-corpus': { type: 'string' } } });
    if (values.out) {
      await capture(resolve(values.out), values['mermaid-corpus']);
      return 0;
    }
  } else if (mode === 'compare' && rest.length === 2) {
    const dirs = rest.map(dir => resolve(dir));
    const manifests = dirs.map(dir => json(join(dir, 'manifest.json')).entries);
    const differences = compareEntries(...manifests);
    for (const { entry, status } of differences) {
      const ae = status === 'changed' && entry.endsWith('.png') ? ` (pixel AE: ${pixelAE(...dirs.map(dir => join(dir, entry)))})` : '';
      console.log(`${status} ${entry}${ae}`);
    }
    const slower = await compareTiming(dirs, manifests);
    console.log(`${differences.length} differing entries${slower ? '; ready slowdown >10%' : ''}`);
    return differences.length || slower ? 1 : 0;
  }
  throw new Error('Usage: capture --out <new-dir> [--mermaid-corpus <report.json>] | compare <old-dir> <new-dir>');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error);
    process.exitCode = 2;
  }
}
