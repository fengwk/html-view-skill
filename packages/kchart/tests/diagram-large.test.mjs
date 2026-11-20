import assert from 'node:assert/strict';
import { test } from 'vitest';
import { families } from '../conformance/large.mjs';
import { diagram } from '../dist/esm/node.js';
import { checkScene } from './helpers/geometry.mjs';

// Each case formerly hit a hard cap; rendering must retain clean geometry and warn once.
test.each([
  ['sequence', 40], ['sequence-messages', 220], ['er', 40], ['er-relations', 60],
  ['mindmap', 100], ['mindmap-depth', 7], ['sankey', 60], ['sankey-flows', 150],
  ['treemap', 100], ['treemap-depth', 7], ['c4', 300], ['swimlane', 8],
  ['agentflow', 70], ['xychart', 9], ['architecture', 300],
])('%s renders cleanly at size %i with one advisory', (family, size) => {
  const source = families[family][1](size);
  const { diagnostics, scene, svg } = diagram(source, { syntax: 'mermaid', width: 800, lang: 'en' });
  assert.ok(svg, JSON.stringify(diagnostics));
  assert.deepEqual(diagnostics.filter(d => d.severity === 'error'), []);
  const warnings = diagnostics.filter(d => d.code === 'LARGE_DIAGRAM');
  assert.equal(warnings.length, 1);
  assert.match(`${warnings[0].message} ${warnings[0].fix}`, /split/i);
  assert.deepEqual(checkScene(scene, { source }), []);
});

// Size alone misses these routing risks: exhausted ER ports and expanded Sankey channels.
test.each([['er-hub', 40, /6 relations per entity/], ['sankey-span', 250, /1000 flow segments/]])(
  '%s rejects work beyond its routing budget', (family, size, cap) => {
    const { diagnostics, svg } = diagram(families[family][1](size), { lang: 'en', width: 800 });
    assert.equal(svg, null);
    assert.equal(diagnostics[0].severity, 'error');
    assert.match(diagnostics[0].message, cap);
    assert.match(diagnostics[0].fix, /split/i);
  },
);

// The default text cap applies to Mermaid only and has actionable localized diagnostics.
test.each([['en', /50,000/, /split/i], ['zh', /50000/, /拆分/]])('source cap in %s', (lang, cap, split) => {
  const result = diagram(`flowchart\n%% ${'x'.repeat(50000)}\nA`, { lang });
  assert.equal(result.svg, null);
  assert.equal(result.diagnostics[0].severity, 'error');
  assert.match(result.diagnostics[0].message, cap);
  assert.match(result.diagnostics[0].fix, split);
});
