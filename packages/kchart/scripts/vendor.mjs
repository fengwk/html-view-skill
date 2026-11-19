// Mirror dist verbatim so html-view has no runtime dependencies.
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
const target = resolve(root, '../../skills/html-view/vendor/kchart');
if (!existsSync(join(dist, 'units.json'))) throw new Error('缺少 dist/：先运行 npm run build');

function compare(source, copy, path = '.') {
  if (!existsSync(copy)) return [`缺少 ${path}`];
  const entries = new Map(readdirSync(copy, { withFileTypes: true }).map(entry => [entry.name, entry]));
  const differences = [];
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const name = entry.name;
    const relative = join(path, name);
    const other = entries.get(name);
    entries.delete(name);
    if (!other) differences.push(`缺少 ${relative}`);
    else if (entry.isDirectory() && other.isDirectory()) differences.push(...compare(join(source, name), join(copy, name), relative));
    else if (!entry.isFile() || !other.isFile() || !readFileSync(join(source, name)).equals(readFileSync(join(copy, name)))) {
      differences.push(`内容不同 ${relative}`);
    }
  }
  for (const name of entries.keys()) differences.push(`多余 ${join(path, name)}`);
  return differences;
}

if (process.argv.includes('--check')) {
  const differences = compare(dist, target);
  if (differences.length) {
    console.error(`vendor: dist 与 vendor 不一致（${differences.length} 项）\n${differences.slice(0, 20).join('\n')}`);
    process.exitCode = 1;
  } else console.log('vendor: 与 dist 一致');
} else {
  rmSync(target, { recursive: true, force: true });
  cpSync(dist, target, { recursive: true });
  console.log('vendor: 已写入 skills/html-view/vendor/kchart');
}
