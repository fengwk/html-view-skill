import { test } from 'vitest';
import assert from 'node:assert/strict';
import { implementations } from '../src/diagram/cynefin.js';

const parse = (source, config = {}) => implementations['cynefin-beta'].parse(source, { lang: 'en', config });

// This verifies config opt-out, entity normalization, semantic styling, and safe item links at parse time.
test('Cynefin Phase 2 config, labels, presentation and links', () => {
  const { model, errors } = parse('complex\n"A &amp; B"\nclass complex-0 danger\nclick complex-0 https://example.com "Open"', {
    cynefin: { showDomainDescriptions: false },
  });
  assert.deepEqual(errors, []);
  assert.equal(model.showDomainDescriptions, false);
  assert.equal(model.domains.complex[0].label, 'A & B');
  assert.equal(model.domains.complex[0].status, 'danger');
  assert.equal(model.domains.complex[0].link.href, 'https://example.com');
});

// This ensures unknown normalized icon tokens remain non-blocking asset warnings rather than errors.
test('Cynefin Phase 2 unknown icon warning', () => {
  const { errors } = parse('clear\n"fa:fa-not-a-real-icon task"');
  assert.deepEqual(errors.map(({ code, severity }) => [code, severity]), [['IGNORED_ASSET', 'warning']]);
});
