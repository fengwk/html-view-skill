import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { audit, commands, style } from '../src/artifacts/ui/index.mjs';
import { renderUi } from '../src/artifacts/ui/render.mjs';
import { normalizeDesign } from '../src/artifacts/ui/theme.mjs';
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
});

test('shared static audit accepts controlled inline UI style and script', () => {
  const content = '<style>.x-note{color:var(--fg-1)}</style><script>window.fixtureLabel = "<title>literal</title>";</script><section class="screen" id="scr-demo" data-title="示例"></section>';
  const result = auditContent(content, { kind: 'ui', css: readAsset('page/ui.css'), allowStyle: true, allowScript: true });
  assert.deepEqual(result.failures, []);
});
