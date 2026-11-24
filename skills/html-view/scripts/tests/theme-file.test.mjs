import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { findBrowser } from '../src/shared/browser.mjs';
import { parseShell } from '../src/shared/shell.mjs';
import { innerHtml, scanElements } from '../src/shared/html-util.mjs';

const bin = fileURLToPath(new URL('../htmlview', import.meta.url));
function temp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'hv-theme-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return (name) => join(dir, name);
}
function run(args, status = 0, cli = bin) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 30000 });
  assert.ifError(result.error);
  assert.equal(result.status, status, result.stdout + result.stderr);
  const payload = JSON.parse(result.stdout);
  if (status === 0) assert.equal(payload.ok, true);
  return payload;
}
const custom = { id: 'test-harbor', extends: 'paper', accent: '#12635e', frameInk: '#677471', style: { radius: 12, numberColor: 'accent' } };
const read = (file) => readFileSync(file, 'utf8');

// New output uses Terminal without a theme flag; rebuilds and explicit choices keep their own theme.
test('CLI defaults to Terminal only when no named theme is selected', (t) => {
  const at = temp(t), md = at('source.md'), out = at('doc.html'), report = at('report.html');
  writeFileSync(md, '# Fictional release\n\n## Review\n\nA short status update.\n');
  assert.equal(run(['viz', 'palette']).theme, 'terminal');
  assert.equal(run(['doc', 'new', at('new.html'), '--type', 'doc', '--title', 'Draft']).theme, 'terminal');
  assert.equal(run(['doc', 'build', md, '--out', out]).theme, 'terminal');
  assert.equal(parseShell(read(out)).theme, 'terminal');
  assert.equal(run(['style', out, '--theme', 'paper']).theme, 'paper');
  assert.equal(run(['doc', 'build', md, '--out', out]).theme, 'paper');
  assert.equal(run(['style', out]).theme, 'paper');
  run(['data', 'init', at('report')]);
  run(['data', 'build', at('report/report.json'), '--out', report]);
  assert.equal(parseShell(read(report)).theme, 'terminal');
});

// Different entry points must produce the same snapshot ID. The output also has no path back to the external file.
test('theme files round-trip through document audit, rebuild and style', (t) => {
  const at = temp(t), config = at('harbor.json'), md = at('source.md'), out = at('doc.html');
  writeFileSync(config, JSON.stringify({ ...custom, desc: 'Harbor & <b>coast</b>' }));
  writeFileSync(md, '# Fictional release\n\n## Review\n\nA short status update.\n');
  const option = ['--theme-file', config];
  const { theme } = run(['viz', 'palette', ...option]);
  assert.equal(run(['doc', 'new', at('new.html'), '--type', 'doc', '--title', 'Draft', ...option]).theme, theme);
  assert.equal(run(['doc', 'build', md, '--out', out, ...option]).theme, theme);
  const initial = read(out), parsed = parseShell(initial);
  assert.equal(parsed.themeSnapshot.accent, custom.accent);
  assert.equal(parsed.themeSnapshot.desc, 'Harbor & <b>coast</b>');
  assert.doesNotMatch(initial, /harbor\.json|<b>coast<\/b>/);
  rmSync(config);
  assert.deepEqual(run(['audit', out]).notes, []);
  assert.equal(run(['style', out]).theme, theme);
  assert.equal(run(['doc', 'build', md, '--out', out]).changed, false);
  assert.equal(read(out), initial);
  const broken = at('incomplete.html');
  writeFileSync(broken, initial.replace(/^<meta name="htmlview:theme"[^\n]*\n/m, ''));
  assert.match(run(['audit', broken], 2).error.message, /缺少内嵌主题快照/);
  writeFileSync(broken, initial.replace(custom.accent, '#12625e'));
  assert.match(run(['audit', broken], 2).error.message, /不匹配/);
  run(['style', out, '--theme', 'paper']);
  assert.equal(parseShell(read(out)).content, parsed.content);
  assert.doesNotMatch(read(out), /<meta name="htmlview:theme"/);
});

// Data evidence is immutable when styling, and an invalid file must not write or overwrite outputs.
test('theme-file data build and style preserve evidence; validation is a write gate', (t) => {
  const at = temp(t), config = at('theme.json'), out = at('report.html');
  run(['data', 'init', at('report')]);
  writeFileSync(config, JSON.stringify(custom));
  run(['data', 'build', at('report/report.json'), '--out', out, '--theme-file', config]);
  const initial = read(out);
  rmSync(config);
  assert.equal(run(['audit', out]).pass, true);
  run(['style', out]);
  assert.equal(read(out), initial);
  const expectBad = (value, message) => {
    writeFileSync(config, value);
    assert.match(run(['style', out, '--theme-file', config], 2).error.message, message);
    assert.equal(read(out), initial);
  };
  expectBad('{', /JSON/);
  expectBad('{"extends":"absent"}', /未知继承主题/);
  expectBad('{"id":"paper"}', /冲突/);
  expectBad('{"fg2":"#eeeeee"}', /对比度不足/);
  expectBad('{"fontFamily":"url(https://example.test/font.woff)"}', /本地字体/);
  expectBad('{"diagram":{"radius":-1}}', /diagram.radius/);
  writeFileSync(config, JSON.stringify(custom));
  assert.equal(run(['style', out, '--theme', 'paper', '--theme-file', config], 2).error.code, 'USAGE');
  const alias = at('alias.html');
  linkSync(config, alias);
  assert.equal(run(['doc', 'new', alias, '--force', '--type', 'doc', '--title', 'Draft', '--theme-file', config], 2).error.code, 'BAD_PATH');
  assert.equal(read(config), JSON.stringify(custom));
  assert.equal(existsSync(alias), true);
});

// A theme JSON becomes available to the CLI and browser only after rebuilding and vendoring KChart.
test('one JSON file plus the build+vendor step registers a built-in theme in the CLI and browser bundle', (t) => {
  const at = temp(t);
  const library = at('packages/kchart');
  const skill = at('skills/html-view');
  for (const name of ['assets', 'scripts/src', 'scripts/htmlview', 'vendor/kchart']) {
    cpSync(new URL(`../../${name}`, import.meta.url), join(skill, name), { recursive: true });
  }
  // The library project is copied without its build output; the vendored artifacts come from our own build.
  mkdirSync(library, { recursive: true });
  const packageRoot = new URL('../../../../packages/kchart/', import.meta.url);
  for (const name of readdirSync(packageRoot)) {
    if (!['node_modules', 'dist', 'tests'].includes(name)) cpSync(new URL(name, packageRoot), join(library, name), { recursive: true });
  }
  symlinkSync(new URL('../../../../packages/kchart/node_modules', import.meta.url), join(library, 'node_modules'), 'dir');
  const lib = (script, ...args) => {
    const result = spawnSync(process.execPath, [join(library, 'scripts', script), ...args], { cwd: library, encoding: 'utf8', timeout: 180000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  };
  const id = 'single-file-probe';
  const cli = join(skill, 'scripts/htmlview');
  // The theme JSON alone is not registration any more: the shipped build has not seen it yet.
  writeFileSync(join(library, 'assets/themes', `${id}.json`), JSON.stringify({ id, name: '样例', en: 'Example', desc: 'Synthetic test theme', accent: '#12635e' }));
  assert.equal(run(['style', '--list'], 0, cli).themes.some((item) => item.id === id), false);
  lib('build.mjs');
  lib('vendor.mjs');
  assert.ok(run(['style', '--list'], 0, cli).themes.some((item) => item.id === id));
  const out = at('doc.html');
  const md = at('source.md');
  writeFileSync(md, '# Example\n\n```mermaid\n---\ntitle: Sample flow\n---\nflowchart LR\nA --> B\n```\n');
  run(['doc', 'build', md, '--out', out, '--theme', id], 0, cli);
  const html = read(out);
  assert.match(html, new RegExp(`data-theme="${id}"`));
  assert.match(html, /--accent:#12635e/);
  // Run the emitted renderer without host filesystem access, just as a browser does.
  const bundle = scanElements(html).find(({ name }) => name === 'script');
  const scope = {};
  runInNewContext(innerHtml(html, bundle), scope, { timeout: 5000 });
  assert.equal(scope.KChart.theme(id).accent, '#12635e');
});

// The standalone HTML remains script-free and can still be restyled from its own source and snapshot.
test('standalone custom dark figure is portable and has a Paper print figure', { skip: !findBrowser() }, (t) => {
  const at = temp(t), config = at('dark.json'), source = at('flow.mmd'), out = at('flow.html');
  const diagram = '---\ntitle: Sample flow\n---\nflowchart LR\nA[Queue] --> B[Worker]\n';
  writeFileSync(config, JSON.stringify({ extends: 'obsidian', diagram: { radius: 2 }, fontFamily: 'monospace' }));
  writeFileSync(source, diagram);
  const { theme } = run(['viz', 'render', source, '--out', out, '--width', '360', '--theme-file', config]);
  rmSync(config);
  rmSync(source);
  const initial = read(out);
  assert.doesNotMatch(initial, /<script\b|<link\b/);
  assert.match(initial, /viz-static-screen"><svg[^>]+font-family="monospace"/);
  assert.match(initial, /viz-static-print"><svg[^>]*>[\s\S]*?fill="#f9fafc"/);
  assert.equal(run(['audit', out]).pass, true);
  assert.equal(run(['style', out]).theme, theme);
  assert.equal(read(out), initial);
  assert.equal(run(['style', out, '--theme', 'paper']).theme, 'paper');
  assert.match(read(out), /Queue/);
});
