import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditContent } from '../src/shared/static-audit.mjs';

// SVG anchor href is navigational; an SVG href on an image remains an external resource.
test('a static SVG figure can link to remote documentation without loading it', () => {
  const href = 'https://docs.example.test/?x=1&amp;y=2';
  const figure = `<figure><svg xmlns="http://www.w3.org/2000/svg" width="160" height="40"><a href="${href}" target="_blank" rel="noopener noreferrer"><title>Read docs</title><text x="8" y="20">Docs</text></a></svg></figure>`;
  assert.deepEqual(auditContent(figure).failures, []);
  assert.ok(auditContent(`<figure><svg><image href="${href}"/></svg></figure>`).failures.length > 0);
});
