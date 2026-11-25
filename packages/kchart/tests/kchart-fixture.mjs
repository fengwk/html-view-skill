import { createRegistry } from '../src/chart/registry.js';
import * as spec from '../src/chart/spec.js';
import { makeContext } from '../src/chart/context.js';
import * as svg from '../src/core/svg.js';
import * as scale from '../src/core/scale.js';
import * as color from '../src/core/color.js';
import * as geometry from '../src/core/geometry.js';
import * as text from '../src/core/text.js';
import * as scene from '../src/core/scene.js';

export function loadChart(installers = []) {
  const registry = createRegistry(spec.validate);
  for (const install of installers) install(registry);
  const api = {
    ...registry,
    createRegistry,
    ...spec,
    ...svg,
    util: { context: makeContext, ...scale, ...color, ...geometry, ...text, ...scene },
  };
  return { api };
}
