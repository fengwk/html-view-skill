// 切片的测试可在汇总登记之前，先以显式依赖在干净 VM 中装载自己的模块。
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { loadModules } from '../modules.mjs';

export function loadSlice(parts, roots = ['diagram/support', 'core/svg']) {
  const modules = { ...loadModules(roots) };
  for (const [id, names] of Object.entries(parts)) {
    const deps = Object.freeze(Object.fromEntries(names.map(name => {
      if (!Object.hasOwn(modules, name)) throw new TypeError(`测试未装入依赖：${name}`);
      return [name, modules[name]];
    })));
    const KChart = Object.freeze({ define(name, factory) {
      if (name !== id || Object.hasOwn(modules, id)) throw new TypeError(`测试模块 ID 不匹配：${name}`);
      modules[id] = factory(deps);
    } });
    const file = new URL(`../src/${id}.js`, import.meta.url);
    runInNewContext(readFileSync(file, 'utf8'), { KChart }, { filename: file.pathname, timeout: 5000 });
  }
  return modules;
}
