import { test } from 'vitest';
import assert from 'node:assert/strict';
import { implementations } from '../src/diagram/ishikawa.js';

const parse = source => implementations.ishikawa.parse(source, { lang: 'en' });

// This proves Ishikawa labels normalize HTML entities and presentation styles/links attach to stable node IDs.
test('Ishikawa Phase 2 labels, status and safe links', () => {
  const { model, errors } = parse('Effect &amp; cause\n  Category\n    Detail &#35;1\nclass n1 warn\nclick n1 https://example.com "Open"');
  assert.deepEqual(errors, []);
  assert.equal(model.root.label, 'Effect & cause');
  assert.equal(model.root.children[0].children[0].label, 'Detail #1');
  assert.equal(model.root.children[0].status, 'warn');
  assert.equal(model.root.children[0].link.href, 'https://example.com');
});

// This proves unsafe link targets are ignored with a warning and do not turn valid fishbone content into errors.
test('Ishikawa Phase 2 unsafe links warn', () => {
  const { errors } = parse('Effect\n  Category\nclick n1 javascript:alert(1)');
  assert.deepEqual(errors.map(({ code, severity }) => [code, severity]), [['IGNORED_INTERACTION', 'warning']]);
});
