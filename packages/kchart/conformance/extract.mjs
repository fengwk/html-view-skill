// Usage: TMPDIR=/var/tmp node extract.mjs [mermaid@12.3.0] [local-checkout] > corpus.json
// Without a checkout, sparse-clone the tag. The tag also pins the Mermaid parser version.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mermaidHeader, validate } from './validate.mjs';

const SYNTAX = 'packages/mermaid/src/docs/syntax';
const INFO = new Set(['mermaid-example', 'mermaid', 'mermaid-nocode']);

// Adapted from the corpus audit: line is the first source line, not the opener.
export function* fences(text) {
  const lines = text.split(/\r?\n/);
  let open;
  for (let i = 0; i < lines.length; i++) {
    const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (open) {
      if (!match || match[2][0] !== open.marker[0] || match[2].length < open.marker.length || match[3].trim()) continue;
      const source = lines.slice(open.start, i)
        .map(line => line.replace(new RegExp(`^ {0,${open.indent}}`), '')).join('\n');
      yield { line: open.start + 1, info: open.info, source };
      open = undefined;
    } else if (match && !(match[2][0] === '`' && match[3].includes('`'))) {
      open = { marker: match[2], start: i + 1, indent: match[1].length, info: match[3].trim() };
    }
  }
}

export function extract(docs) {
  return readdirSync(docs).filter(file => file.endsWith('.md')).sort().flatMap(file =>
    [...fences(readFileSync(join(docs, file), 'utf8'))].filter(({ info }) => INFO.has(info.split(/\s/, 1)[0]))
      .map(({ line, source }) => ({ id: `${file}:${line}`, file, line, header: mermaidHeader(source), source })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , tag = 'mermaid@12.3.0', checkout] = process.argv;
  if (!/^mermaid@\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(tag)) throw new Error(`Expected a Mermaid release tag, got ${tag}`);
  const dir = checkout ? null : mkdtempSync(join(tmpdir(), 'mermaid-docs-'));
  const root = checkout ?? join(dir, 'src');
  try {
    const git = (...args) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }).trim();
    if (!checkout) {
      git('clone', '--depth=1', '--filter=blob:none', '--sparse', '--branch', tag, 'https://github.com/mermaid-js/mermaid.git', root);
      git('-C', root, 'sparse-checkout', 'set', '--', SYNTAX);
    }
    if (git('-C', root, 'rev-parse', 'HEAD') !== git('-C', root, 'rev-parse', `refs/tags/${tag}^{commit}`)) {
      throw new Error(`Checkout HEAD does not match ${tag}`);
    }
    const records = extract(join(root, SYNTAX));
    if (!records.length) throw new Error(`No Mermaid examples found in ${root}`);
    const results = await validate(records, tag.slice('mermaid@'.length));
    if (results.some(r => r.mermaid === 'invalid')) {
      console.error(JSON.stringify(results.filter(r => r.mermaid === 'invalid'), null, 2));
      throw new Error('Unexpected parse failures in the upstream corpus');
    }
    console.log(JSON.stringify(records.map(({ id, file, line, header, source }, i) => ({
      id, file, line, type: results[i].type, header, source, mermaid: results[i].mermaid,
      ...(results[i].error && { error: results[i].error }),
    })), null, 2));
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}
