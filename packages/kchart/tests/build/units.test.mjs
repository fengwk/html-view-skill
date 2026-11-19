import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

const dist = new URL('../../dist/', import.meta.url);
const units = JSON.parse(readFileSync(new URL('units.json', dist), 'utf8'));
const code = new Map(Object.entries(units).map(([id, { file }]) => [id, readFileSync(new URL(file, dist), 'utf8')]));

// Every IIFE runs in a fresh VM after its transitive dependencies, with only direct dependency slots visible to it.
it.each(Object.entries(units))('evaluates %s with its declared dependencies', (id, { deps, bytes }) => {
  const values = Object.create(null);
  const done = new Set();
  function evaluate(unit) {
    if (done.has(unit)) return;
    done.add(unit);
    const declared = units[unit].deps;
    declared.forEach(evaluate);
    const slots = new Proxy(values, {
      get(target, key) {
        if (!declared.includes(key) || !Object.hasOwn(target, key)) throw new Error(`${unit} → ${String(key)}`);
        return target[key];
      },
    });
    runInNewContext(code.get(unit), { KChartUnits: slots });
  }
  expect(Buffer.byteLength(code.get(id))).toBe(bytes);
  evaluate(id);
  if (id !== 'runtime') expect(values[id]).toBeDefined();
  expect(new Set(Object.keys(values))).toEqual(new Set([...done].filter(unit => unit !== 'runtime')));
  expect(deps).not.toContain(id);
});
