import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { audit, commands, style } from '../src/artifacts/ui/index.mjs';
import { renderUi } from '../src/artifacts/ui/render.mjs';
import { generateTokens, normalizeDesign } from '../src/artifacts/ui/theme.mjs';
import { renderShell } from '../src/shared/shell.mjs';
import { ToolError } from '../src/shared/output.mjs';
import { auditContent } from '../src/shared/static-audit.mjs';
import { readAsset } from '../src/shared/assets.mjs';

// The grouped CLI resolves a flat artifact command and UI does not silently accept unsupported built-in themes.
test('UI artifact exposes flat new command and style rejects pseudo --theme', async () => {
  assert.deepEqual(Object.keys(commands), ['new']);
  assert.equal(typeof commands.new, 'function');
  await assert.rejects(style(['unused.html', '--theme', 'paper']), (error) => error instanceof ToolError && error.code === 'USAGE');
});

test('UI new/style CLI responses include kind and do not advertise pseudo themes', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'htmlview-ui-cli-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'app.html');
  const cli = new URL('../htmlview', import.meta.url).pathname;
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: process.cwd(), encoding: 'utf8' });
  const created = run('ui', 'new', file, '--title', '留存看板', '--device', 'responsive', '--screens', '概览,明细');
  assert.equal(created.status, 0, created.stdout + created.stderr);
  assert.equal(JSON.parse(created.stdout).kind, 'ui');
  assert.equal(existsSync(file), true);
  // 响应式骨架的每个屏幕都能从产品内导航到其它屏幕，结构一致。
  const screens = readFileSync(file, 'utf8').split('<section class="screen"').slice(1);
  assert.deepEqual(screens.map((screen) => [screen.includes('class="side-nav"'), screen.includes('class="top-bar"')]), [[true, true], [true, true]]);
  const baseline = join(directory, 'before.html');
  copyFileSync(file, baseline);
  const audited = run('audit', file);
  assert.equal(audited.status, 0, audited.stdout + audited.stderr);
  assert.deepEqual({ kind: JSON.parse(audited.stdout).kind, pass: JSON.parse(audited.stdout).pass }, { kind: 'ui', pass: true });
  const styled = run('style', file, '--scheme', 'dark');
  assert.equal(styled.status, 0, styled.stdout + styled.stderr);
  assert.equal(JSON.parse(styled.stdout).kind, 'ui');
  const compared = run('diff', baseline, file);
  assert.equal(compared.status, 0, compared.stdout + compared.stderr);
  assert.deepEqual({ kind: JSON.parse(compared.stdout).kind, changed: JSON.parse(compared.stdout).changed }, { kind: 'ui', changed: [] });
  const themed = run('style', file, '--theme', 'paper');
  assert.equal(themed.status, 2);
  assert.equal(JSON.parse(themed.stdout).error.code, 'USAGE');
});

test('UI audit recognizes a control labeled by its wrapping label element', async () => {
  // Native wrapping labels are accessible associations even without label[for] or ARIA.
  const design = normalizeDesign({ fidelity: 'mockup' });
  const content = '<section class="screen" id="scr-consent" data-title="Consent"><label><input type="checkbox" required> I confirm the information is accurate</label></section>';
  const { html } = renderUi({ title: 'Consent', lang: 'en', device: 'mobile', design, content }, renderShell);
  const result = await audit(html);
  assert.deepEqual(result.failures.filter(({ code }) => code === 'NO_LABEL'), []);
});

// 意图：data-close 这类无值属性已经是交互；真正无交互的按钮要指出行号和按钮文字。
test('UI audit treats valueless interaction attributes as declared and locates inert buttons', async () => {
  const design = normalizeDesign({ fidelity: 'mockup' });
  const content = '<section class="screen" id="scr-a" data-title="A"><dialog class="dialog" id="d"><button class="btn" type="button" data-close>Keep</button></dialog>\n<button class="btn" type="button">Do nothing</button></section>';
  const { html } = renderUi({ title: 'A', lang: 'en', device: 'mobile', design, content }, renderShell);
  const inert = (await audit(html)).notes.filter(({ code }) => code === 'INERT_CONTROL');
  assert.equal(inert.length, 1);
  assert.match(inert[0].message, /Do nothing/);
  assert.ok(Number.isInteger(inert[0].line));
  assert.match(inert[0].message, /data-action/);
});

// An external script does not qualify, even if the action control already has a link.
test('UI audit recognizes scripted data-action controls and flags orphan actions', async () => {
  const check = (script) => audit(renderUi({ title: 'A', device: 'mobile', content:
    `<section class="screen" id="scr-a" data-title="A"><button data-action="save">Save</button><a href="#scr-a" data-action="refresh">Refresh</a></section>${script}`,
  }, renderShell).html);
  const inline = await check(`<script>document.querySelector('[data-action="save"]').addEventListener('click', () => {});</script>`);
  assert.deepEqual(inline.failures, []);
  assert.deepEqual(inline.notes, []);
  for (const script of ['', '<script src=""></script>']) {
    const { failures } = await check(script);
    assert.deepEqual(failures.filter(({ code }) => code === 'ORPHAN_ACTION').map(({ detail }) => detail), [
      'data-action「save」没有内容区脚本处理', 'data-action「refresh」没有内容区脚本处理',
    ]);
  }
});

// Check both CSS sources and make sure a fallback does not conceal a misspelling.
test('UI audit validates style references against generated and content tokens', async () => {
  const content = `<style>
.x-panel { --x-gap: 8px; gap: var(--x-gap); color: var(--surface2, var(--surface-2)); }
</style>
<section class="screen x-panel" id="scr-a" data-title="A" style="padding:var(--x-gap);border-width:var(--x-typo)"></section>`;
  const { html } = renderUi({ title: 'A', device: 'mobile', content }, renderShell);
  const { failures } = await audit(html);
  assert.deepEqual(failures.map(({ code, detail, line }) => [code, detail, html.split('\n')[line - 1].trim()]), [
    ['UNKNOWN_TOKEN', '未定义的样式变量 --surface2', content.split('\n')[1]],
    ['UNKNOWN_TOKEN', '未定义的样式变量 --x-typo', content.split('\n')[3]],
  ]);
});

// Nested commas must not create new selectors or hide an invalid top-level selector.
test('UI audit checks the x- prefix at top-level selector boundaries', async () => {
  const cases = [
    ['.x-app :is(button, a):focus-visible { outline-offset: 2px; }', false],
    ['.x-list > :where(.x-a, .x-b) { margin: 0; }', false],
    ['.x-row:not(.x-a, .x-b) { margin: 0; }', false],
    [String.raw`.x-row:has([data-label="a\"],b"], :is(a, button)), .x-other { margin: 0; }`, false],
    ['.x-a, button { margin: 0; }', true],
    [':is(.x-a, .x-b) { margin: 0; }', true],
    ['.x-a:is(a, button), button { margin: 0; }', true],
    ['.x-a/* " */, button { margin: 0; }', true],
    ['@keyframes x-fade { from { opacity: 0; } 50%, to { opacity: 1; } }', false],
  ];
  for (const [css, invalid] of cases) {
    const content = `<style>${css}</style><section class="screen" id="scr-a" data-title="A"></section>`;
    const { html } = renderUi({ title: 'A', device: 'mobile', content }, renderShell);
    const { failures } = await audit(html);
    assert.deepEqual(failures.filter(({ code }) => code === 'CUSTOM_STYLE').map(({ detail }) => detail),
      invalid ? ['自定义 CSS 选择器必须以 x- class 起头'] : [], css);
  }
});

test('shared static audit accepts controlled inline UI style and script', () => {
  const content = '<style>.x-note{color:var(--fg-1)}</style><script>window.fixtureLabel = "<title>literal</title>";</script><section class="screen" id="scr-demo" data-title="示例"></section>';
  const result = auditContent(content, { kind: 'ui', css: `${readAsset('page/ui.css')}\n${generateTokens().css}`, allowStyle: true, allowScript: true });
  assert.deepEqual(result.failures, []);
});
