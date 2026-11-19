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

// 线框不借用品牌红或风险红；CSS 与传给 KChart 的配色都执行同一条规则。
test('wireframe omits red in status and chart colors in both schemes', () => {
  const { themes, css } = generateTokens({ fidelity: 'wireframe', brand: '#d82420' });
  const notRed = (hex) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return r <= Math.max(g, b);
  };
  for (const theme of [themes.light, themes.dark]) {
    assert.equal(theme.tones.length, 6);
    for (const value of [theme.accent, theme.danger, ...theme.tones]) assert.ok(notRed(value), value);
    assert.match(css, new RegExp(`--danger: ${theme.danger};`));
  }
  for (const [, hex] of css.matchAll(/--(?:danger-soft|viz-\d): (#[\da-f]{6});/g)) assert.ok(notRed(hex), hex);
});

// 具名主题可以独立改色；高保真 UI 的默认六序列仍是已发布的取色结果和顺序。
test('mockup series keep the published UI palette independent of document themes', () => {
  const { themes } = generateTokens({ fidelity: 'mockup' });
  assert.deepEqual([...themes.light.tones], ['#2f6fed', '#866700', '#261e1e', '#cc3a2b', '#439b5b', '#948b8a']);
  assert.deepEqual([...themes.dark.tones], ['#2f6fed', '#6de18b', '#bb5a35', '#d9e1f6', '#007232', '#d4b771']);
});
