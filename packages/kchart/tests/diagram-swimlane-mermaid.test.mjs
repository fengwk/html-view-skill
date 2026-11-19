import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'vitest';
import { diagram } from '../dist/esm/node.js';
import { implementations } from '../src/diagram/swimlane-mermaid.js';
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
