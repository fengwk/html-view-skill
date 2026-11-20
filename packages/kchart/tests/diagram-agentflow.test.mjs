import { expect, test } from 'vitest';
import { diagram } from '../dist/esm/node.js';
import { implementations } from '../src/diagram/agentflow.js';
import { prepareSource } from '../src/diagram/source.js';
import { checkScene } from './helpers/geometry.mjs';

const lang = 'en';
const parse = source => {
  const info = prepareSource(source, { syntax: 'mermaid', lang });
  const result = implementations['agentflow-beta'].parse(info.body, { ...info, lang });
  expect(result.errors.filter(d => d.severity !== 'warning')).toEqual([]);
  return result;
};
function* walk(node) {
  yield node;
  for (const child of node.children ?? []) yield* walk(child);
}

// Translate domain shapes without rejecting removed or incorrectly cased names.
test('agentflow shapes resolve aliases and warn on fallback', () => {
  const shapes = ['task', 'tool', 'input', 'decision', 'refdoc', 'action', 'lined-document', 'stadium', 'TASK'];
  const { model, errors } = parse('agentflow-beta\n' + shapes.map((shape, i) => `n${i}@{ shape: ${shape} }`).join('\n'));
  expect(model.nodes.map(node => node.shape)).toEqual(['rounded', 'subroutine', 'lean-r', 'diamond', 'lin-doc', 'hexagon', 'lined-document', 'rounded', 'rounded']);
  expect(errors.map(({ line, code }) => [line, code])).toEqual([[9, 'DIAGRAM_HINT'], [10, 'DIAGRAM_HINT']]);
});

// Verify chaining and authored edge IDs, then check the three SVG marker treatments.
test('agentflow edges distinguish sequence, reference and failure', () => {
  const source = `agentflow-beta LR
    a e1@--> b --> c
    a -- yes --> d
    b -.- d
    c --x|failed| a
    e1@{ animate: true, note: "audit" }`;
  const { model } = parse(source);
  expect(model.edges.map(e => [e.from, e.to, e.id, e.edgeSemantic, e.label])).toEqual([
    ['a', 'b', 'e1', 'sequence', null], ['b', 'c', null, 'sequence', null], ['a', 'd', null, 'sequence', 'yes'],
    ['b', 'd', null, 'reference', null], ['c', 'a', null, 'failure', 'failed'],
  ]);
  expect(model.edges[0].metadata).toEqual({ animate: true, note: 'audit' });
  const { scene, diagnostics } = diagram(source, { width: 360, lang });
  expect(diagnostics.some(d => d.code === 'IGNORED_CONFIG')).toBe(true);
  const parts = [...walk(scene)];
  const edge = (from, to) => parts.find(p => p.meta?.kind === 'edge' && p.meta.from === from && p.meta.to === to);
  expect(edge('a', 'b').attrs['marker-end']).toContain('graph-arrow');
  expect(edge('b', 'd').attrs['stroke-dasharray']).toBe('4 4');
  expect(edge('b', 'd').attrs['marker-end']).toBeUndefined();
  const failure = edge('c', 'a');
  expect(failure.attrs['marker-end']).toContain('agentflow-marker-failure');
  expect(parts.find(p => p.attrs?.id === 'agentflow-marker-failure').children).toHaveLength(2);
  expect(parts.find(p => p.text === 'failed').attrs.fill).toBe(failure.attrs.stroke);
  expect(checkScene(scene)).toEqual([]);
});

// Folding hides both nested flows, redirects boundary edges and keeps earlier global references outside.
test('agentflow nested frames, global and collapsed view preserve endpoints', () => {
  const source = `agentflow-beta TB
    flow outer[Outer]
      flow middle[Middle]
        flow inner[Inner]
          A --> B
          B -.- shared
        end
      end
    end
    outer@{ view: collapsed }
    global
      shared[Shared]
    end
    start --> A
    B --> finish`;
  const { model } = parse(source);
  expect(model.subgraphs.map(f => [f.id, f.parent, f.depth])).toEqual([['outer', null, 1], ['middle', 'outer', 2], ['inner', 'middle', 3]]);
  expect(model.nodes.find(node => node.id === 'shared')).toMatchObject({ global: true, parent: null });
  const { scene } = diagram(source, { width: 360, lang });
  const elements = [...walk(scene)];
  expect(elements.some(p => p.text === '2 nodes')).toBe(true);
  expect(elements.filter(p => p.meta?.kind === 'edge').map(p => [p.meta.from, p.meta.to])).toEqual([
    ['outer', 'shared'], ['start', 'outer'], ['outer', 'finish'],
  ]);
  expect(elements.filter(p => p.meta?.kind === 'node').map(p => p.meta.id).sort()).toEqual(['finish', 'shared', 'start']);
  expect(checkScene(scene)).toEqual([]);
});

// Multiline, nested YAML keeps connector references opaque and strips forbidden keys recursively.
test('agentflow preserves safe metadata and connector values', () => {
  const source = `agentflow-beta
    connector service["API"]@{ protocol: "http" }
    flow agent
      query@{
        shape: tool,
        params: "city } %% name",
        connectorRef: service.lookup,
        details:
          list: [{safe: true, __proto__: discarded, constructor: ignored}]
          prototype: removed
      }
      send@{ connectorRef: "https://example.org/hook", returns: OK }
    end`;
  const { model } = parse(source);
  const query = model.nodes.find(node => node.id === 'query');
  expect(query.parent).toBe('agent');
  expect(query.metadata).toEqual({ shape: 'tool', params: 'city } %% name', connectorRef: 'service.lookup', details: { list: [{ safe: true }] } });
  expect(model.connectors[0]).toMatchObject({ id: 'service', label: 'API', connector: true, metadata: { protocol: 'http' } });
  expect(model.nodes.find(node => node.id === 'send').metadata.connectorRef).toBe('https://example.org/hook');
  expect(diagram(source, { lang }).svg).toContain('connectorRef: https://example.org/hook');
});

// Shared presentation, labels and icon handling keep safe content without honoring arbitrary style or callbacks.
test('agentflow shares roles, links, rich labels and asset warnings', () => {
  const source = `agentflow-beta
    classDef custom fill:#ff0000,stroke-width:4px
    a["fa:fa-home <b>A %% literal</b><br>second #9829;"]:::custom-->b %% trailing
    style b fill:#0066ff
    linkStyle 0 stroke:#00aa00
    click a href "https://example.org" "More" _blank
    click b call open()
    b@{ icon: "no-such-icon" }`;
  const { model } = parse(source);
  expect(model.nodes[0]).toMatchObject({ id: 'a', label: 'A %% literal\nsecond ♥', class: 'danger', icon: { set: 'tabler' } });
  expect(model.nodes[1].class).toBe('info');
  expect(model.edges[0].status).toBe('ok');
  const result = diagram(source, { lang });
  expect(result.diagnostics.map(d => d.code).sort()).toEqual(['IGNORED_ASSET', 'IGNORED_INTERACTION', 'IGNORED_STYLE']);
  expect(result.svg).toMatch(/href="https:\/\/example.org"[^>]*rel="noopener noreferrer"/);
  expect(result.svg).not.toContain('trailing');
  expect(checkScene(result.scene)).toEqual([]);
});

// Icon-only edge labels and icon-bearing frame titles reserve their geometry without placeholder text.
test('agentflow keeps icons on frames and edges', () => {
  const result = diagram(`agentflow-beta
    flow group["fa:fa-home Tasks"]
      A -->|fa:fa-home| B
    end`, { width: 360, lang });
  expect(result.diagnostics).toEqual([]);
  const parts = [...walk(result.scene)];
  for (const kind of ['frame-title-group', 'edge-label-group']) {
    const group = parts.find(part => part.meta?.kind === kind);
    expect(group.children.some(part => part.tag === 'g' && / scale\(/.test(part.attrs.transform))).toBe(true);
  }
  expect(result.svg).not.toContain('◌');
  expect(checkScene(result.scene)).toEqual([]);
});

// ELK is a warning, not an alternate layout; both render byte-identically with a fixed prefix.
test('agentflow warns on unsupported layout but uses the same route', () => {
  const options = { lang, prefix: 'agentflow-config' };
  const run = layout => diagram(`---\nconfig:\n  layout: ${layout}\n---\nagentflow-beta\na --> b`, options);
  const dagre = run('dagre'), elk = run('elk');
  expect(dagre.diagnostics).toEqual([]);
  expect(elk.diagnostics).toEqual([expect.objectContaining({ line: 3, code: 'IGNORED_CONFIG', severity: 'warning' })]);
  expect(elk.svg).toBe(dagre.svg);
});
