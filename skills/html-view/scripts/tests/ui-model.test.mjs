import test from 'node:test';
import assert from 'node:assert/strict';
import { partsOf, screensOf, tagsOf } from '../src/artifacts/ui/model.mjs';

// Top-level screen boundaries must ignore nested app elements and inline script markup.
test('UI model finds stable screen parts and retains non-screen styles', () => {
  const content = '<style>.x{color:red}</style>\n<section class="screen" id="scr-a" data-title="首页"><div><section>嵌套</section></div></section>\n<section class="screen" id="scr-b" data-title="详情"><p>内容</p></section>\n';
  assert.deepEqual(screensOf(content).map(({ id, title }) => [id, title]), [['scr-a', '首页'], ['scr-b', '详情']]);
  assert.deepEqual(partsOf(content).map(({ part }) => part), ['content:1', 'screen:scr-a', 'screen:scr-b']);
  const invalidDuplicateIds = partsOf('<section class="screen" id="scr-x"></section><section class="screen" id="scr-x"></section>').map(({ part }) => part);
  assert.deepEqual(invalidDuplicateIds, ['screen:scr-x', 'screen:scr-x#2']);
});

test('attribute scan ignores tag-like strings inside scripts and reads custom form semantics', () => {
  const source = '<section class="screen" id="scr-form"><script>const fake = "<input id=bad>";</script><select id="kind" required><option>A</option></select><input type="date" required min="2026-01-01"></section>';
  const fields = tagsOf(source).filter(({ name, closing }) => !closing && (name === 'input' || name === 'select'));
  assert.equal(fields.length, 2);
  assert.equal(fields[0].attrs.required, '');
  assert.equal(fields[1].attrs.type, 'date');
  assert.equal(fields[1].attrs.min, '2026-01-01');
});
