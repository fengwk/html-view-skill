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

// Domain names and Mermaid's decision-model notes follow the diagram language; items stay as written.
test('generated Cynefin labels follow the diagram language', () => {
  const draw = lang => {
    const { model } = implementations['cynefin-beta'].parse('complex\n"Trial"\nconfusion\n"Unknown"', { lang });
    return JSON.stringify(implementations['cynefin-beta'].layout(model, { lang, width: 800 }));
  };
  const zh = draw('zh-CN');
  for (const word of ['复杂', '繁杂', '混乱', '清晰', '困惑', '探测 → 感知 → 响应', '涌现实践', '失序', 'Trial']) assert.ok(zh.includes(`"${word}"`), word);
  assert.doesNotMatch(zh, /"(?:Complex|Emergent Practices|Disorder)"/);
  for (const word of ['Complex', 'Probe → Sense → Respond', 'Disorder']) assert.ok(draw('en').includes(`"${word}"`), word);
});
