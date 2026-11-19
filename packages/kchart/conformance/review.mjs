// Visual review sheets: KChart (left) next to real Mermaid (right), with KChart diagnostics and geometry issues.
// From packages/kchart after `npm run build`:
//   TMPDIR=/var/tmp node conformance/review.mjs --out <dir> [--type flowchart,stateDiagram] [--id file.md:12,…]
//     [--source a.mmd,b.mmd] [--width 800] [--theme claude] [--per-page 6] [--mermaid 12.3.0]
// --type matches the corpus `type` or header keyword (case-insensitive); --id selects corpus records; --source
// adds local files. Writes <dir>/page-NN.html + page-NN.png (one Chrome tab, scale 1) and <dir>/report.json.
// Mermaid's npm bundle is cached in $TMPDIR/kchart-mermaid-<version>/.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { diagram } from '../dist/esm/node.js';
import { checkScene } from '../tests/helpers/geometry.mjs';
import { launchBrowser } from '../../../skills/html-view/scripts/src/shared/browser.mjs';

const { values } = parseArgs({
  options: {
    out: { type: 'string' }, type: { type: 'string' }, id: { type: 'string' }, source: { type: 'string' },
    width: { type: 'string', default: '800' }, theme: { type: 'string', default: 'claude' },
    'per-page': { type: 'string', default: '6' }, mermaid: { type: 'string', default: '12.3.0' },
  },
});
if (!values.out || !(values.type || values.id || values.source)) {
  throw new Error('Usage: node conformance/review.mjs --out <dir> (--type <types> | --id <ids> | --source <files>) [--width 800] [--theme claude]');
}
const list = (value) => (value ? value.split(',').map(item => item.trim()).filter(Boolean) : []);
const width = Number(values.width), perPage = Number(values['per-page']);
const corpus = JSON.parse(readFileSync(new URL('../tests/conformance/mermaid-12.3.0.json', import.meta.url), 'utf8'));
const types = new Set(list(values.type).map(type => type.toLowerCase()));
const ids = new Set(list(values.id));
const records = [
  ...corpus.filter(r => r.mermaid === 'valid' && (ids.has(r.id) || types.has(r.type.toLowerCase()) || types.has(r.header.toLowerCase()))),
  ...list(values.source).map(file => ({ id: basename(file), source: readFileSync(file, 'utf8') })),
];
if (!records.length) throw new Error('No records selected');

function mermaidBundle(version) {
  const dir = join(tmpdir(), `kchart-mermaid-${version}`);
  const bundle = join(dir, 'package/dist/mermaid.min.js');
  if (!existsSync(bundle)) {
    mkdirSync(dir, { recursive: true });
    execFileSync('npm', ['pack', '--loglevel=error', '--cache', join(dir, 'npm-cache'), `mermaid@${version}`], { cwd: dir });
    execFileSync('tar', ['-xzf', `mermaid-${version}.tgz`, 'package/dist/mermaid.min.js'], { cwd: dir });
  }
  return pathToFileURL(bundle).href;
}

const escapeHtml = (value) => String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const reviewed = records.map((record, index) => {
  const { svg, scene, diagnostics } = diagram(record.source, { syntax: 'mermaid', width, theme: values.theme, prefix: `k${index}` });
  const geometry = scene ? checkScene(scene) : [];
  return { ...record, svg, diagnostics, geometry };
});

function pageHtml(items, bundle) {
  const rows = items.map((item, i) => {
    const errors = item.diagnostics.filter(d => d.severity !== 'warning');
    const warnings = item.diagnostics.filter(d => d.severity === 'warning');
    const status = [
      item.svg ? 'rendered' : 'NOT RENDERED',
      errors.length && `${errors.length} error(s): ${errors.map(d => `L${d.line} ${d.message}`).join(' | ')}`,
      warnings.length && `${warnings.length} warning(s): ${warnings.map(d => `${d.code} L${d.line} ${d.message}`).join(' | ')}`,
      item.geometry.length && `${item.geometry.length} geometry issue(s): ${[...new Set(item.geometry.map(g => g.kind))].join(', ')}`,
    ].filter(Boolean).join(' · ');
    const bad = !item.svg || errors.length || item.geometry.length;
    return `<section><h2 class="${bad ? 'bad' : ''}">${escapeHtml(item.id)} — ${escapeHtml(status)}</h2>
<div class="pair"><div class="cell">${item.svg ?? `<pre>${escapeHtml(item.source)}</pre>`}</div><div class="cell mm" data-i="${i}"></div></div></section>`;
  }).join('\n');
  const sources = JSON.stringify(items.map(item => item.source)).replace(/</g, '\\u003c');
  return `<!doctype html><meta charset="utf-8"><title>KChart review</title>
<style>body{margin:16px;font:13px system-ui,sans-serif;background:#f4f4f4;color:#222}h2{font-size:13px;margin:16px 0 6px}h2.bad{color:#b00020}
.pair{display:grid;grid-template-columns:${width + 2}px 1fr;gap:12px;align-items:start}.cell{background:#fff;border:1px solid #ddd;overflow:auto;max-height:1600px}
.cell svg{display:block;max-width:none}pre{white-space:pre-wrap;margin:8px}</style>
${rows}
<script src="${bundle}"></script>
<script>const sources = ${sources};
mermaid.initialize({ startOnLoad: false });
window.ready = (async () => {
  for (const cell of document.querySelectorAll('.mm')) {
    try { cell.innerHTML = (await mermaid.render('m' + cell.dataset.i, sources[cell.dataset.i])).svg; }
    catch (error) { cell.textContent = 'Mermaid: ' + (error?.message || error); }
  }
  return 1;
})();</script>`;
}

const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const bundle = mermaidBundle(values.mermaid);
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  for (let start = 0, n = 1; start < reviewed.length; start += perPage, n++) {
    const name = `page-${String(n).padStart(2, '0')}`;
    writeFileSync(join(out, `${name}.html`), pageHtml(reviewed.slice(start, start + perPage), bundle));
    await page.setViewport({ width: 2 * width + 80, height: 1000 });
    await page.goto(pathToFileURL(join(out, `${name}.html`)).href);
    await page.evaluate('window.ready');
    const height = await page.evaluate('Math.min(document.documentElement.scrollHeight, 16000)');
    writeFileSync(join(out, `${name}.png`), await page.screenshot({ x: 0, y: 0, width: 2 * width + 80, height }));
  }
} finally {
  await browser.close();
}
const report = reviewed.map(({ id, svg, diagnostics, geometry }) => ({ id, rendered: Boolean(svg), diagnostics, geometry }));
writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
const failing = report.filter(r => !r.rendered || r.diagnostics.some(d => d.severity !== 'warning') || r.geometry.length);
console.log(`review: ${report.length} record(s), ${failing.length} failing, sheets in ${out}`);
