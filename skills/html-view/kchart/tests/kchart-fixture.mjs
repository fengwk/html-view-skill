import vm from 'node:vm';
import { assembleModules } from '../modules.mjs';

export function loadChart(families = [], globals = {}) {
  const context = vm.createContext(globals);
  const source = assembleModules(['chart/registry', ...families]);
  const modules = vm.runInContext(source, context, { filename: 'kchart.js', timeout: 10000 });
  const api = {
    ...modules['chart/registry'],
    ...modules['chart/spec'],
    ...modules['core/svg'],
    dataTable: modules['chart/context'].dataTable,
    util: {
      context: modules['chart/context'].makeContext,
      ...modules['core/scale'],
      ...modules['core/color'],
      ...modules['core/geometry'],
      ...modules['core/text'],
      ...modules['core/scene'],
    },
  };
  return { api, context, modules };
}
