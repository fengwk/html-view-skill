// Copy one render-readme-gallery.mjs output into the repository:
// images replace docs/showcase/gallery/; theme fragments update the root READMEs; gallery fragments update docs/showcase/README.md and README.en.md.
// Usage: node docs/showcase/sync-readme.mjs <directory printed by render-readme-gallery.mjs>
import { access, cp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const THEME_READMES = { 'zh-CN': 'README.md', en: 'README.en.md' };
const GALLERY_READMES = { 'zh-CN': 'docs/showcase/README.md', en: 'docs/showcase/README.en.md' };
const [source] = process.argv.slice(2);
if (!source) {
  console.error('Usage: node docs/showcase/sync-readme.mjs <directory printed by render-readme-gallery.mjs>');
  process.exit(2);
}
const out = resolve(source);
const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));

// Prepare every file first, so a missing marker stops the run before any file changes.
async function replaceMarker(file, name, fragment) {
  let text = await readFile(join(root, file), 'utf8');
  const begin = `<!-- ${name}:begin -->\n`, end = `<!-- ${name}:end -->`;
  const start = text.indexOf(begin), stop = text.indexOf(end);
  if (start < 0 || stop < start || text.indexOf(begin, start + 1) >= 0 || text.indexOf(end, stop + 1) >= 0) {
    throw new Error(`${file} needs exactly one "${begin.trim()}" … "${end}" pair`);
  }
  return [file, text.slice(0, start + begin.length) + fragment + text.slice(stop)];
}

const updates = [];
for (const [lang, file] of Object.entries(THEME_READMES)) {
  if (!manifest.languages?.[lang]) throw new Error(`${out} has no ${lang} gallery; render it with render-readme-gallery.mjs`);
  await access(join(out, 'gallery', lang));
  updates.push(await replaceMarker(file, 'themes', await readFile(join(out, `themes.${lang}.md`), 'utf8')));
}
for (const [lang, file] of Object.entries(GALLERY_READMES)) {
  const fragment = (await readFile(join(out, `gallery.${lang}.md`), 'utf8'))
    .replaceAll('docs/showcase/gallery/', 'gallery/');
  updates.push(await replaceMarker(file, 'gallery', fragment));
}
const target = join(root, 'docs/showcase/gallery');
await rm(target, { recursive: true, force: true });
await cp(join(out, 'gallery'), target, { recursive: true });
for (const [file, text] of updates) await writeFile(join(root, file), text);
console.log(`Synced theme plates in the root READMEs, the gallery in docs/showcase, and docs/showcase/gallery/ from ${out}`);
