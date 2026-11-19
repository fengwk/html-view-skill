// Usage: TMPDIR=/var/tmp node validate.mjs records.json [mermaid-version] > report.json
// Input: JSON array of { id, source, ... }. JSON report on stdout; exit 1 for any
// core rejection (including external plugins). Defaults to Mermaid 12.3.0.
// Requires npm, tar and Chrome/Chromium (CHROME_PATH can override its location).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from '../../../skills/html-view/scripts/src/shared/browser.mjs';

const VERSION = '12.3.0';

export function mermaidHeader(source) {
  return source.trimStart().replace(/^---[^\S\n]*\n[\s\S]*?^(?:---|\.\.\.)[^\S\n]*(?:\n|$)/m, '')
    .replace(/%%\{[\s\S]*?\}%%/g, '').replace(/^\s*%%[^\n]*/gm, '')
    .trimStart().match(/^[A-Za-z][\w-]*/)?.[0] ?? '';
}

// Adapted from the archived audit oracle: load the npm UMD bundle in one tab,
// pass sources as JSON over CDP (never as HTML) and parse them sequentially.
export async function validate(records, version = VERSION) {
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('Expected an exact Mermaid version');
  if (!Array.isArray(records) || records.some(r => typeof r?.source !== 'string' || typeof r.id !== 'string')) {
    throw new Error('Expected a JSON array of records with string id and source');
  }
  if (!records.length) return [];
  const dir = mkdtempSync(join(tmpdir(), 'mermaid-parse-'));
  let browser;
  try {
    execFileSync('npm', ['pack', '--loglevel=error', '--cache', join(dir, 'npm-cache'), `mermaid@${version}`], { cwd: dir });
    execFileSync('tar', ['-xzf', `mermaid-${version}.tgz`, 'package/dist/mermaid.min.js'], { cwd: dir });
    const html = join(dir, 'page.html');
    writeFileSync(html, `<!doctype html><meta charset="utf-8">
<script src="package/dist/mermaid.min.js"></script>
<script>
mermaid.initialize({ startOnLoad: false });
window.parseAll = async (list) => {
  const out = [];
  for (const source of list) {
    try {
      const { diagramType: type } = await mermaid.parse(source);
      out.push({ type, mermaid: 'valid' });
    } catch (e) {
      const error = String(e?.message || e).split('\\n').slice(0, 4).join(' | ').slice(0, 400);
      out.push({ mermaid: 'invalid', error });
    }
  }
  return JSON.stringify(out);
};
</script>`);
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.goto(pathToFileURL(html).href);
    const parsed = await page.json(`window.parseAll(${JSON.stringify(records.map(r => r.source))})`);
    return records.map(({ id, source }, i) => {
      const result = parsed[i];
      const header = mermaidHeader(source);
      if (header === 'zenuml' && result.error?.startsWith('No diagram type detected')) {
        return { id, header, ...result, type: 'zenuml', mermaid: 'plugin' };
      }
      return { id, header, ...result };
    });
  } finally {
    try { await browser?.close(); } finally { rmSync(dir, { recursive: true, force: true }); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , input, version = VERSION] = process.argv;
  if (!input) throw new Error('Usage: node validate.mjs records.json [mermaid-version]');
  const results = await validate(JSON.parse(readFileSync(input, 'utf8')), version);
  const rejected = results.filter(r => r.mermaid !== 'valid');
  console.log(JSON.stringify({ version, total: results.length, valid: results.length - rejected.length, rejected }, null, 2));
  if (rejected.length) process.exitCode = 1;
}
