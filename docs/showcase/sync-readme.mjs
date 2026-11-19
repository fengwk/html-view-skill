// Copy one render-readme-gallery.mjs output into the repository:
// images replace docs/showcase/gallery/, and each language's fragments replace the marked blocks in its README.
// Usage: node docs/showcase/sync-readme.mjs <directory printed by render-readme-gallery.mjs>
import { access, cp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const READMES = { 'zh-CN': 'README.md', en: 'README.en.md' };
const [source] = process.argv.slice(2);
if (!source) {
  console.error('Usage: node docs/showcase/sync-readme.mjs <directory printed by render-readme-gallery.mjs>');
  process.exit(2);
}
const out = resolve(source);
const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));

// Prepare every README first, so a missing marker stops the run before any file changes.
const updates = [];
for (const [lang, file] of Object.entries(READMES)) {
  if (!manifest.languages?.[lang]) throw new Error(`${out} has no ${lang} gallery; render it with render-readme-gallery.mjs`);
  await access(join(out, 'gallery', lang));
  let text = await readFile(join(root, file), 'utf8');
  for (const name of ['gallery', 'themes']) {
    const begin = `<!-- ${name}:begin -->\n`, end = `<!-- ${name}:end -->`;
    const start = text.indexOf(begin), stop = text.indexOf(end);
    if (start < 0 || stop < start || text.indexOf(begin, start + 1) >= 0 || text.indexOf(end, stop + 1) >= 0) {
      throw new Error(`${file} needs exactly one "${begin.trim()}" … "${end}" pair`);
    }
    text = text.slice(0, start + begin.length) + await readFile(join(out, `${name}.${lang}.md`), 'utf8') + text.slice(stop);
  }
  updates.push([file, text]);
}
const target = join(root, 'docs/showcase/gallery');
await rm(target, { recursive: true, force: true });
await cp(join(out, 'gallery'), target, { recursive: true });
for (const [file, text] of updates) await writeFile(join(root, file), text);
console.log(`Synced ${Object.keys(READMES).length} READMEs and docs/showcase/gallery/ from ${out}`);
