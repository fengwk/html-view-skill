// Usage (from any directory): node path/to/repo-examples.mjs > records.json
// Collect published Mermaid Markdown fences and both localized gallery sources.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { galleryCases } from '../../../docs/showcase/gallery-cases.mjs';
import { fences } from './extract.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const gallery = 'docs/showcase/gallery-cases.mjs';
const walk = dir => readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => {
  const path = `${dir}/${entry.name}`;
  return entry.isDirectory() ? walk(path) : entry.isFile() && path.endsWith('.md') ? [path] : [];
});
const readmes = readdirSync(root).filter(file => /^README.*\.md$/.test(file));
const records = [...readmes, ...walk('docs'), ...walk('skills/html-view/references')].sort().flatMap(file =>
  [...fences(readFileSync(join(root, file), 'utf8'))].filter(({ info }) => info.split(/\s/, 1)[0] === 'mermaid')
    .map(({ line, source }) => ({ id: `${file}:${line}`, file, line, source })));
for (const lang of ['zh-CN', 'en']) {
  for (const [kind, [syntax, source]] of Object.entries(galleryCases(lang).diagrams)) {
    if (syntax === 'mermaid') records.push({ id: `${gallery}:${lang}:${kind}`, file: gallery, source });
  }
}
console.log(JSON.stringify(records, null, 2));
