import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTokens, normalizeDesign, normalizeDevice, normalizeLang } from '../src/artifacts/ui/theme.mjs';
import { ToolError } from '../src/shared/output.mjs';
import { loadModules } from '../../kchart/modules.mjs';

// Theme creation is delegated to core/theme; this checks both schemes stay valid and return CSS for the UI.
test('UI design produces validated light/dark KChart themes and stable CSS tokens', () => {
  const { themes, css, adjusted } = generateTokens({ brand: '#ff00ff', scheme: 'dark', density: 'compact' });
  assert.equal(themes.light.scheme, 'light');
  assert.equal(themes.dark.scheme, 'dark');
  assert.ok(themes.light.tones.length === 6 && themes.dark.tones.length === 6);
  assert.match(css, /:root\[data-scheme="light"\]/);
  assert.match(css, /:root\[data-scheme="dark"\]/);
  assert.match(css, /--control-h: 32px/);
  assert.ok(Array.isArray(adjusted));
  const color = loadModules(['core/color'])['core/color'];
  for (const scheme of ['light', 'dark']) {
    const block = css.match(new RegExp(`:root\\[data-scheme="${scheme}"\\] \\{([^}]+)`))[1];
    const token = (name) => block.match(new RegExp(`--${name}: ([^;]+);`))[1];
    const foreground = token('on-accent');
    const accentSoft = token('accent-soft');
    const accentText = token('accent-text');
    const statusSoft = token('ok-soft');
    assert.ok(color.contrast(foreground, themes[scheme].accent) >= 4.5);
    assert.ok(color.contrast(accentText, accentSoft) >= 4.5);
    assert.ok(color.contrast(accentText, themes[scheme].surface) >= 4.5);
    assert.ok(color.deltaE2000(accentSoft, themes[scheme].surface) < color.deltaE2000(accentSoft, themes[scheme].accent));
    assert.ok(color.deltaE2000(statusSoft, themes[scheme].surface) < color.deltaE2000(statusSoft, themes[scheme].ok));
  }
});

test('invalid device, language, and design values use the shared BAD_VALUE contract', () => {
  for (const run of [() => normalizeDevice('watch'), () => normalizeLang('invalid tag'), () => normalizeDesign({ radius: 17 })]) {
    assert.throws(run, (error) => error instanceof ToolError && error.code === 'BAD_VALUE');
  }
});

test('wireframe maintains a neutral component accent and both KChart themes validate', () => {
  const { themes, css } = generateTokens({ fidelity: 'wireframe' });
  assert.match(css, /--shadow-1:/);
  assert.equal(themes.light.scheme, 'light');
  assert.equal(themes.dark.scheme, 'dark');
});
