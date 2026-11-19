import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const generator = fileURLToPath(new URL('../lab/showcase/generate.mjs', import.meta.url));
const generate = (directory) => spawnSync(process.execPath, [generator, '--out', directory], { encoding: 'utf8', timeout: 10000 });

test('图库不在未知非空目录或通过符号链接写文件', async (t) => {
  // 生成失败后，用户目录里的内容和链接指向的目标都必须保持原样。
  const root = await mkdtemp(join(tmpdir(), 'htmlview-showcase-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plain = join(root, 'keep');
  await mkdir(plain);
  const sentinel = join(plain, 'untouched.txt');
  await writeFile(sentinel, '原文件');
  const linked = join(root, 'linked');
  await symlink(plain, linked, 'dir');
  for (const [directory, why] of [[plain, /目录非空/], [join(linked, 'new'), /不跟随符号链接/]]) {
    const result = generate(directory);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, why);
  }
  assert.deepEqual(await readdir(plain), ['untouched.txt']);
  assert.equal(await readFile(sentinel, 'utf8'), '原文件');
});
