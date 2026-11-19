import assert from 'node:assert/strict';
import test from 'node:test';
import { audit } from '../src/artifacts/doc/index.mjs';
import { renderShell } from '../src/shared/shell.mjs';

// A real Mermaid figure with an ignored visual setting passes document audit with a note.
test('doc audit reports ignored Mermaid config as VIZ_WARNING', async () => {
  const html = renderShell({
    kind: 'doc', title: 'Deployment plan', theme: 'claude', lang: 'en',
    attrs: { 'data-layout': 'article' }, meta: { 'doc:type': 'doc' },
    content: '<h2 id="steps">Steps</h2><pre data-viz="mermaid">---\ntitle: Deployment flow\nconfig:\n  look: handDrawn\n---\nflowchart LR\n  A[Build] --&gt; B[Deploy]</pre>',
  });
  const result = await audit(html, { file: 'fixture.html' });
  assert.deepEqual(result.failures, []);
  const warnings = result.notes.filter(note => note.code === 'VIZ_WARNING');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].detail, /look/);
});
