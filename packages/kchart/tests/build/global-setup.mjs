// Builds dist/ once per `npm test` run so every build test reads the same artifacts.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

export default function setup() {
  const root = resolve(import.meta.dirname, '../..');
  const run = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'inherit' });
  if (run.status !== 0) throw new Error('KChart 构建失败，无法运行构建冒烟测试');
}
