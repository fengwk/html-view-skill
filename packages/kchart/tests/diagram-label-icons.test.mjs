import { expect, test } from 'vitest';
import { has, registerIcons, resolve, resolveIconRef } from '../src/core/icons.js';
import { normalizeLabel } from '../src/diagram/label.js';

// Named, decimal, hex and Mermaid entities decode once; formatting tags preserve their enclosed text.
test('normalize entities and inline markup', () => {
  expect(normalizeLabel('<b title="a>b">#quot;#35;#9829;</b><BR><em>&copy; &euro; &amp;lt;</em><br/><kbd>&#169; &#x1f680;</kbd><br />&lt;i&gt;', { line: 7 })).toEqual({
    text: '"#♥\n© € &lt;\n© 🚀\n<i>', icon: null, diagnostics: [],
  });
  expect(normalizeLabel('"`**strong** and *emphasis*\ntext`"').text).toBe('strong and emphasis\ntext');
  // Underscore emphasis keeps its text too, while snake_case, 中_文 and markers beside spaces stay literal.
  expect(normalizeLabel('"`This is _Markdown_, __strong__, snake_case_name, 中_文_字, a _ b _ c`"').text)
    .toBe('This is Markdown, strong, snake_case_name, 中_文_字, a _ b _ c');
  expect(normalizeLabel('<br>text<br/>').text).toBe('\ntext\n');
});

// Images disappear, math stays literal, and repeated ignored assets warn only once in a label.
test('retain TeX and discard images', () => {
  const { text, diagnostics } = normalizeLabel('a<img src="https://example.test/a"/>b <IMG src="b">$$x<i>+fa:fa-heart$$ $$y$$', { lang: 'en', line: 7 });
  expect(text).toBe('ab x<i>+fa:fa-heart y');
  expect(diagnostics.map(({ code, severity, line, message }) => [code, severity, line, message])).toEqual([
    ['IGNORED_ASSET', 'warning', 7, 'Removed an image from the label'], ['IGNORED_ASSET', 'warning', 7, 'Math shown as TeX source'],
  ]);
});

// Only the first FA token supplies the icon; known tokens are not text and unknown tokens warn.
test('extract Font Awesome tokens', () => {
  const { text, icon, diagnostics } = normalizeLabel('fas:fa-envelope <strong>Mail</strong> fab:fa-github far:fa-not-real fal:fa-heart fak:fa-home fa:fa-user', { lang: 'en', line: 4 });
  expect(text).toBe('Mail');
  expect(icon).toBe(resolve('mail'));
  expect(diagnostics).toEqual([expect.objectContaining({ code: 'IGNORED_ASSET', line: 4, message: 'Unknown icon far:fa-not-real' })]);
  expect(normalizeLabel('fa:fa-not-real fa:fa-home text').icon).toBeNull();
});

// Pack names, the legacy FA spelling and shared aliases resolve to bundled geometry only.
test('resolve icons and aliases', () => {
  for (const [ref, name] of [['mail', 'mail'], ['tabler:mail', 'mail'], ['simple-icons:github', 'github'], ['logos:github', 'github'],
    ['fa:fa-envelope', 'mail'], ['fa fa-cog', 'settings'], ['mdi:account', 'user'], ['mdi:source-branch', 'git-branch']]) {
    expect(resolveIconRef(ref)).toBe(resolve(name));
    expect(resolveIconRef(ref)).not.toBeNull();
  }
  expect(resolveIconRef('fa:fa-not-real')).toBeNull();
  expect(resolveIconRef('constructor')).toBeNull();
});

// Registration is namespaced, flattens nested groups, drops paint, and honors Iconify dimensions.
test('register controlled Iconify geometry', () => {
  registerIcons({ prefix: 'test-diagram', width: 24, height: 20, icons: {
    'two-paths': { height: 16, body: '<g fill="none" stroke="currentColor"><path d="M0 0h10"/><g><path d=\'M1 2v3\' stroke-width="2" /></g></g>' },
  } });
  expect(has('test-diagram:two-paths')).toBe(true);
  expect(resolveIconRef('test-diagram:two-paths')).toEqual({ set: 'test-diagram', viewBox: '0 0 24 16', elements: [
    { tag: 'path', attrs: { d: 'M0 0h10' } }, { tag: 'path', attrs: { d: 'M1 2v3' } },
  ] });
  expect(resolveIconRef('two-paths')).toBeNull();
  expect(() => registerIcons({ prefix: 'test-diagram', icons: { bad: { body: '<g><path d="M1 1" onclick="go()"/></g>' } } })).toThrow(TypeError);
  expect(resolveIconRef('test-diagram:bad')).toBeNull();
});
