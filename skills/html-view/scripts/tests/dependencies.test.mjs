import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SourceTextModule } from 'node:vm';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const src = join(root, 'scripts/src');
const library = join(root, 'kchart');
const files = dir => readdirSync(dir, { recursive: true }).filter(name => name.endsWith('.mjs'));
const layerOf = filename => relative(src, filename).split(sep)[0];
const allowed = new Map([
  ['cli', new Set(['cli', 'shared', 'commands', 'tools', 'artifacts'])],
  ['commands', new Set(['commands', 'shared', 'tools', 'artifacts'])],
  ['shared', new Set(['shared'])],
  ['artifacts', new Set(['artifacts', 'shared'])],
  ['tools', new Set(['tools', 'shared'])],
]);
function imports(filename) {
  const module = new SourceTextModule(readFileSync(filename, 'utf8'), { identifier: filename });
  return module.moduleRequests?.map(({ specifier }) => specifier) ?? module.dependencySpecifiers;
}

// 层级与独立打包是运行合同，不允许产物之间借函数或偷偷读取其他技能代码。
test('Node 静态依赖只能沿宿主层级和独立库边界进入', { skip: typeof SourceTextModule !== 'function' }, () => {
  for (const name of files(src)) {
    const filename = join(src, name);
    const layer = layerOf(filename);
    assert.ok(allowed.has(layer), name);
    for (const specifier of imports(filename)) {
      if (specifier.startsWith('node:')) continue;
      assert.ok(specifier.startsWith('.'), `${name}: ${specifier}`);
      const target = resolve(dirname(filename), specifier);
      assert.ok(existsSync(target), `${name}: ${specifier}`);
      if (target.startsWith(library + sep)) continue;
      assert.ok(allowed.get(layer).has(layerOf(target)), `${name}: ${specifier}`);
      if (layer === 'artifacts' && layerOf(target) === 'artifacts') {
        assert.equal(relative(src, target).split(sep)[1], name.split(sep)[1], `${name}: ${specifier}`);
      }
    }
  }
  for (const name of files(library)) {
    const filename = join(library, name);
    for (const specifier of imports(filename)) {
      if (specifier.startsWith('node:')) continue;
      const target = resolve(dirname(filename), specifier);
      assert.ok(specifier.startsWith('.') && target.startsWith(library + sep) && existsSync(target), `${name}: ${specifier}`);
    }
  }
});
