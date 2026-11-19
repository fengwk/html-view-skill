import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
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
// 静态导入由 Node 自己的 ESM 解析器读取，不用正则猜。SourceTextModule 只在 --experimental-vm-modules 下开放，
// 所以放进带这个开关的子进程；不论用哪条命令运行测试，这项检查都会真正执行。
const PARSER = `import { SourceTextModule } from 'node:vm';
import { readFileSync } from 'node:fs';
const result = {};
for (const file of JSON.parse(readFileSync(0, 'utf8'))) {
  const module = new SourceTextModule(readFileSync(file, 'utf8'), { identifier: file });
  result[file] = module.moduleRequests?.map(({ specifier }) => specifier) ?? module.dependencySpecifiers;
}
process.stdout.write(JSON.stringify(result));`;
const importsOf = filenames => JSON.parse(execFileSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', '--input-type=module', '-e', PARSER], {
  input: JSON.stringify(filenames), encoding: 'utf8', maxBuffer: 64 << 20,
}));

// 层级与独立打包是运行合同，不允许产物之间借函数或偷偷读取其他技能代码。
test('Node 静态依赖只能沿宿主层级和独立库边界进入', () => {
  const hosts = files(src).map(name => join(src, name)), libs = files(library).map(name => join(library, name));
  const imports = importsOf([...hosts, ...libs]);
  assert.equal(Object.keys(imports).length, hosts.length + libs.length);
  assert.ok(imports[join(src, 'cli/main.mjs')]?.length, 'the parser reports the CLI entry imports');
  for (const name of files(src)) {
    const filename = join(src, name);
    const layer = layerOf(filename);
    assert.ok(allowed.has(layer), name);
    for (const specifier of imports[filename]) {
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
    for (const specifier of imports[filename]) {
      if (specifier.startsWith('node:')) continue;
      const target = resolve(dirname(filename), specifier);
      assert.ok(specifier.startsWith('.') && target.startsWith(library + sep) && existsSync(target), `${name}: ${specifier}`);
    }
  }
});
