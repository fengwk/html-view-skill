import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'vitest';
import { diagram } from '../dist/esm/node.js';
import { implementations } from '../src/diagram/swimlane-mermaid.js';
import corpus from './conformance/mermaid-12.3.0.json';
import { checkScene } from './helpers/geometry.mjs';

// Digests captured before sharing the engine pin native SVG bytes in both orientations.
test('native lane output is byte-identical', () => {
  for (const [direction, hash] of [
    ['LR', 'ba1b6be46da706212430660f8324907de39d0a232c4fc3539c5dc54fe23611d9'],
    ['TB', '5b74c8d309a91f972bf57ddfa2fd89988351f10ffe589387e3516fd2504a94df'],
  ]) {
    const source = `swimlane ${direction}\nlane Intake\n  A([Start])\n  B{Ready?}:::warn\nlane Review\n  C((Done))\nA --> B\nB -.->|Try again| A\nB ==>|Yes| C`;
    const result = diagram(source, { syntax: 'swimlane', width: 360 });
    assert.deepEqual(result.diagnostics, []);
    assert.equal(createHash('sha256').update(result.svg).digest('hex'), hash);
  }
});

// References do not move an existing node; nested groups and free nodes inherit different lanes.
test('resolves swimlane ownership and lane titles independently', () => {
  const { model, errors } = implementations['swimlane-beta'].parse(`subgraph sales [Sales team]\ndirection TD\nA\nsubgraph Group\nC\nend\nend\nsubgraph Support\nB --> A\nend\nA --> Z`, { params: '', firstLine: 2, lang: 'en' });
  assert.ok(errors.every(item => item.severity === 'warning'));
  assert.deepEqual(model.lanes.map(lane => [lane.name, lane.nodes]), [['Sales team', ['A', 'C']], ['Support', ['B']], ['Unassigned', ['Z']]]);
  const result = diagram('swimlane-beta LR\nsubgraph Sales\nsubgraph Group\nA --> B\nend\nend', { width: 360 });
  assert.deepEqual(checkScene(result.scene), []);
  assert.match(result.svg, /data-kc-kind="frame" data-kc-id="Group"/);
});

// Lane overflow and contradictory direction statements are reported at the offending source line.
test('reports lane and direction constraints', () => {
  const lanes = Array.from({ length: 7 }, (_, i) => `subgraph Lane${i}\nA${i}\nend`).join('\n');
  assert.ok(diagram(`swimlane-beta\n${lanes}`, { lang: 'en' }).diagnostics.some(d => d.line === 20 && /6 lanes/.test(d.message)));
  assert.ok(diagram('swimlane-beta LR\nsubgraph Lane\ndirection TD\nA\nend', { lang: 'en' }).diagnostics.some(d => d.line === 3 && /Conflicting/.test(d.message)));
});

// A hidden link affects rank without painting an edge; separators inside a label remain literal.
test('preserves invisible layout links and quoted punctuation', () => {
  const result = diagram('swimlane-beta LR\nsubgraph Work; A["Start; ~~~"]; B[Done]; end\nA ~~~ B %% align only', { width: 360 });
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.svg, /Start; ~~~/);
  assert.doesNotMatch(result.svg, /data-kc-kind="edge"/);
});

// The Mermaid adapter retains the shared class cascade, numbered link style, normalized text and safe href.
test('renders Mermaid presentation without changing native swimlanes', () => {
  const result = diagram(`swimlane-beta LR\nsubgraph Work\nA["fa:fa-user Review &amp; approve"]:::attention --> B[Done]\nend\nclassDef attention fill:#e9b824\nlinkStyle 0 stroke:#268bd2\nclick A href "/review"`, { width: 360 });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(checkScene(result.scene), []);
  assert.match(result.svg, /data-kc-status="warn"/);
  assert.match(result.svg, /data-kc-status="info"/);
  assert.match(result.svg, /href="\/review"/);
  assert.match(result.svg, /Review &amp; approve/);
  assert.doesNotMatch(result.svg, /fa:fa-user/);
});

// Direct edges use centered ports, and a cross-lane decision leaves from the facing vertex.
test('centers audit connectors and keeps the decision diamond square', () => {
  const items = (id, width) => {
    const source = corpus.find(row => row.id === `swimlanes.md:${id}`).source;
    const visit = item => [item, ...(item.children ?? []).flatMap(visit)];
    return diagram(source, { width }).scene.children.flatMap(visit);
  };
  for (const width of [800, 360]) {
    for (const [id, from, to] of [[28, 'Pay', 'Pick'], [82, 'triage', 'answer']]) {
      const all = items(id, width);
      const node = all.find(i => i.meta?.kind === 'node' && i.meta.id === from).attrs;
      const edge = all.find(i => i.meta?.kind === 'edge' && i.meta.from === from && i.meta.to === to).attrs;
      assert.equal(Number(edge.d.match(/^M[\d.]+ ([\d.]+)/)[1]), node.y + node.height / 2);
    }
    const all = items(360, width);
    const diamond = all.find(i => i.meta?.kind === 'node' && i.meta.id === 'classify');
    const [top, right, bottom, left] = diamond.attrs.points.split(' ').map(point => point.split(',').map(Number));
    assert.equal(right[0] - left[0], bottom[1] - top[1]);
    const edge = all.find(i => i.meta?.kind === 'edge' && i.meta.from === 'classify' && i.meta.to === 'prioritize');
    assert.ok(edge.attrs.d.startsWith(`M${bottom.join(' ')} L${bottom[0]} `));
  }
});

// Reverse flow mirrors geometry, not the text; bold relations and accessibility survive serialization.
test('renders reversed flow with shapes and accessible labels', () => {
  for (const direction of ['RL', 'BT']) {
    const result = diagram(`swimlane-beta ${direction}\naccTitle: Work plan\naccDescr: Two steps\nsubgraph Work\nA([Start]) ==> B((Done))\nend`, { width: 360 });
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(checkScene(result.scene), []);
    assert.match(result.svg, /Work plan<\/title>/);
    assert.match(result.svg, /Two steps<\/desc>/);
    assert.match(result.svg, /stroke-width="2.5"/);
    assert.match(result.svg, /<circle/);
  }
});
