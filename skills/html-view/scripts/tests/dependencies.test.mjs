import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const src = join(root, 'scripts/src');
const scripts = join(root, 'scripts');
// KChart 只以已提交的构建产物进入本技能；源码项目在仓库的 packages/kchart，本技能不直接读它。
const vendor = join(root, 'vendor/kchart');
const vendoredEsm = join(vendor, 'esm');
const library = join(root, '..', '..', 'packages/kchart');
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
const inside = (parent, target) => target.startsWith(parent + sep);

// 层级与独立打包是运行合同，不允许产物之间借函数或偷偷读取其他技能代码。
test('Node 静态依赖只能沿宿主层级进入，KChart 只从 vendor 引入', () => {
  const hosts = files(src).map(name => join(src, name));
  const imports = importsOf(hosts);
  assert.equal(Object.keys(imports).length, hosts.length);
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
      // 库边界：KChart 只以已提交的 vendor 产物出现，且一定落在 vendor/kchart 内。
      if (inside(vendor, target)) {
        assert.ok(inside(vendoredEsm, target), `${name}: ${specifier} 必须指向 vendor/kchart/esm`);
        continue;
      }
      assert.ok(!inside(library, target), `${name}: ${specifier} 不能直接读 packages/kchart 源码`);
      assert.ok(allowed.get(layer).has(layerOf(target)), `${name}: ${specifier}`);
      if (layer === 'artifacts' && layerOf(target) === 'artifacts') {
        assert.equal(relative(src, target).split(sep)[1], name.split(sep)[1], `${name}: ${specifier}`);
      }
    }
  }
});

// 即使不从 CLI 进入，测试和实验工具的静态依赖也不能指向已删除的源码树。
test('旧 kchart/ 源码树已删除，脚本不再静态导入它', () => {
  const legacy = join(root, 'kchart');
  assert.equal(existsSync(legacy), false);
  const imports = importsOf(files(scripts).map(name => join(scripts, name)));
  for (const [filename, specifiers] of Object.entries(imports)) {
    for (const specifier of specifiers.filter(value => value.startsWith('.'))) {
      assert.ok(!inside(legacy, resolve(dirname(filename), specifier)), `${relative(scripts, filename)}: ${specifier}`);
    }
  }
});

// vendor 是构建产物：它必须自包含，导入只能留在 vendor/kchart 内，且按 ESM 声明交给 Node 解析。
test('vendored KChart 自包含：ESM 导入不出 vendor/kchart', () => {
  assert.deepEqual(JSON.parse(readFileSync(join(vendoredEsm, 'package.json'), 'utf8')), { type: 'module' });
  const vendored = readdirSync(vendoredEsm, { recursive: true }).filter(name => name.endsWith('.js')).map(name => join(vendoredEsm, name));
  assert.ok(vendored.length > 0, 'vendor/kchart/esm 有构建产物');
  const imports = importsOf(vendored);
  for (const [filename, specifiers] of Object.entries(imports)) {
    for (const specifier of specifiers) {
      if (specifier.startsWith('node:')) continue;
      const target = resolve(dirname(filename), specifier);
      assert.ok(specifier.startsWith('.') && inside(vendor, target) && existsSync(target), `${relative(vendor, filename)}: ${specifier}`);
    }
  }
});
