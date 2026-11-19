import assert from 'node:assert/strict';
import test from 'node:test';
import { compareEntries } from '../lab/regression/render-capture.mjs';

// A mixed manifest detects all three difference kinds without reporting equal artifacts.
test('compareEntries reports changed, missing and added artifacts', () => {
  const old = { sha256: 'old', bytes: 7 };
  const newer = { sha256: 'new', bytes: 7 };
  const a = { 'changed.svg': old, 'missing.png': old, 'same.svg': old };
  const b = { 'same.svg': { ...old }, 'added.png': newer, 'changed.svg': newer };
  assert.deepEqual(compareEntries(a, b), [
    { entry: 'added.png', status: 'added' },
    { entry: 'changed.svg', status: 'changed' },
    { entry: 'missing.png', status: 'missing' },
  ]);
  assert.deepEqual(compareEntries(a, structuredClone(a)), []);
});

// Page metrics such as script size are part of the comparison, not just annotations.
test('compareEntries detects page metric changes with the same artifact digest', () => {
  const page = { sha256: 'digest', bytes: 100, metrics: { inlineScriptBytes: 10 } };
  assert.deepEqual(compareEntries({ 'page.html': page }, {
    'page.html': { ...page, metrics: { inlineScriptBytes: 11 } },
  }), [{ entry: 'page.html', status: 'changed' }]);
});
