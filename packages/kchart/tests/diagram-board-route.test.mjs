import { test } from 'vitest';
import assert from 'node:assert/strict';
import { routeBoard } from '../src/diagram/board-route.js';

// Non-centred facing ports let a tall card fan out straight even when links are authored bottom-first.
test('board fans out on ordered ports inside each facing overlap', () => {
  const nodes = [
    { id: 'source', x: 20, y: 20, w: 80, h: 180 },
    ...[20, 90, 160].map((y, i) => ({ id: `target${i}`, x: 112, y, w: 80, h: 40 })),
  ];
  const edges = [2, 1, 0].map(id => ({ id, from: 'source', to: `target${id}` }));
  const board = { width: 250, height: 230, nodes, frames: [], edges };
  const result = routeBoard(board);
  assert.deepEqual(result, routeBoard(board));
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.edges.map(({ points }) => points), [180, 110, 40].map(y => [{ x: 100, y }, { x: 112, y }]));
});

// A group endpoint can attach inward without forcing a relation to its descendant around the frame.
test('board attaches a child to its enclosing frame from inside', () => {
  const nodes = [{ id: 'child', x: 52, y: 60, w: 80, h: 42, parent: 'frame' }];
  const frames = [{ id: 'frame', x: 40, y: 20, w: 104, h: 112, titleRect: { x: 52, y: 30, w: 80, h: 14 } }];
  const result = routeBoard({ width: 180, height: 160, nodes, frames, edges: [{ id: 0, from: 'frame', to: 'child' }] });
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.edges[0].points, [{ x: 40, y: 81 }, { x: 52, y: 81 }]);
});
