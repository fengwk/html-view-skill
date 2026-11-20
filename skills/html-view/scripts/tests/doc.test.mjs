import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { audit, buildDoc, commands, newDoc, parts, style } from '../src/artifacts/doc/index.mjs';
import { renderShell } from '../src/shared/shell.mjs';
import { readAsset } from '../src/shared/assets.mjs';

const fixture = (name) => new URL(`./fixtures/doc/${name}`, import.meta.url);
const withTemp = async (run) => {
  const dir = await mkdtemp(join(tmpdir(), 'htmlview-doc-'));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
};

// Strict kind/type checks keep doc commands from turning malformed or other artifact files into documents.
test('doc commands expose only new/build and reject an unknown kind', async () => {
  assert.deepEqual(Object.keys(commands), ['new', 'build']);
  await withTemp(async (dir) => {
    await assert.rejects(newDoc([join(dir, 'bad.html'), '--type', 'unknown', '--title', '虚构标题']), { code: 'UNKNOWN_TYPE' });
    await assert.rejects(newDoc([join(dir, 'spec.html'), '--type', 'tech-spec', '--title', '虚构方案']), { code: 'USAGE' });
    const data = renderShell({ kind: 'data', title: '虚构报表', theme: 'claude', content: '<p>虚构数字</p>' });
    const wrongKind = join(dir, 'data.html');
    const source = join(dir, 'source.md');
    await writeFile(wrongKind, data);
    await writeFile(source, '# 虚构文档\n');
    await assert.rejects(buildDoc([source, '--out', wrongKind]), { code: 'KIND_MISMATCH' });
    assert.equal(await readFile(wrongKind, 'utf8'), data);
    const malformed = join(dir, 'malformed.html');
    await writeFile(malformed, '<html><body>unrelated draft</body></html>');
    await assert.rejects(buildDoc([source, '--out', malformed]), { code: 'BAD_SHELL' });
    assert.equal(await readFile(malformed, 'utf8'), '<html><body>unrelated draft</body></html>');
  });
});

// Source metadata gates replacement: a second manuscript must never overwrite the first one's generated HTML.
test('build records its Markdown source and refuses a different source without changing the target', async () => {
  await withTemp(async (dir) => {
    const sourceDir = join(dir, 'notes');
    const outDir = join(dir, 'docs');
    await mkdir(sourceDir, { recursive: true });
    await mkdir(outDir, { recursive: true });
    const source = join(sourceDir, 'first.md');
    const other = join(sourceDir, 'other.md');
    const output = join(outDir, 'document.html');
    await writeFile(source, await readFile(fixture('source.md'), 'utf8'));
    await writeFile(other, await readFile(fixture('other.md'), 'utf8'));

    await buildDoc([source, '--out', output, '--type', 'plan']);
    const original = await readFile(output, 'utf8');
    assert.match(original, /name="htmlview:doc:source" content="\.\.\/notes\/first\.md"/);
    assert.match(original, /htmlview:kind/);
    await assert.rejects(buildDoc([other, '--out', output, '--type', 'plan']), { code: 'SOURCE_MISMATCH' });
    assert.equal(await readFile(output, 'utf8'), original);

    await writeFile(source, `${await readFile(source, 'utf8')}\n## 新增章节\n\n新增内容。\n`);
    await buildDoc([source, '--out', output, '--type', 'plan']);
    const updated = await readFile(output, 'utf8');
    assert.match(updated, /新增章节/);
    assert.doesNotMatch(updated, /独立内容/);
  });
});

// 英文手稿不写 --lang 时，图号、目录和页码不能变成中文；中文手稿里的英文代码不改变判断；显式 --lang 优先。
test('doc build infers the page language from the manuscript when --lang is omitted', async () => {
  await withTemp(async (dir) => {
    const english = join(dir, 'english.md');
    const chinese = join(dir, 'chinese.md');
    await writeFile(english, '# Search index lag\n\nSearch returned stale results for 18% of queries; the owner is 张三.\n\n```mermaid\n---\ntitle: Events reach the index or the dead-letter queue\n---\nflowchart LR\n  A[Catalog] --> B[Index]\n```\n');
    await writeFile(chinese, '# 索引延迟复盘\n\n迁移先于消费端发布，导致事件被拒。\n\n```sql\nALTER TABLE catalog_events ADD COLUMN region_code TEXT NOT NULL DEFAULT \'EU\';\nSELECT id, region_code FROM catalog_events WHERE region_code IS NULL;\n```\n');
    await buildDoc([english, '--out', join(dir, 'english.html')]);
    await buildDoc([chinese, '--out', join(dir, 'chinese.html')]);
    await buildDoc([english, '--out', join(dir, 'forced.html'), '--lang', 'zh-CN']);
    assert.match(await readFile(join(dir, 'english.html'), 'utf8'), /<html lang="en"/);
    assert.match(await readFile(join(dir, 'chinese.html'), 'utf8'), /<html lang="zh-CN"/);
    assert.match(await readFile(join(dir, 'forced.html'), 'utf8'), /<html lang="zh-CN"/);
  });
});

// Shared graph audit owns figure-title diagnostics; the doc slice adds only its document-layout check.
test('doc audit combines shared figure-title diagnostics with the doc-specific layout check', async () => {
  const html = renderShell({
    kind: 'doc', title: '虚构说明', theme: 'claude', lang: 'zh-CN',
    attrs: { 'data-layout': 'single' }, meta: { 'doc:type': 'report' },
    content: '\n<h2 id="intro">概览</h2><pre data-viz="kchart" id="v1">{"chart":"bar","data":[{"group":"甲","value":1},{"group":"乙","value":2}],"encode":{"category":"group","value":"value"}}</pre>\n',
  });
  const result = await audit(html, { file: 'fixture.html' });
  assert.ok(result.failures.some((failure) => failure.code === 'BAD_VIZ' && failure.detail.includes('图题')));
  assert.ok(result.failures.some((failure) => failure.code === 'DOC_LAYOUT'));
  const unsafe = renderShell({ kind: 'doc', title: '虚构说明', theme: 'claude', meta: { 'doc:type': 'doc' }, content: '<script>window.pwned = true</script>' });
  const unsafeResult = await audit(unsafe, { file: 'unsafe.html' });
  assert.ok(unsafeResult.failures.some((failure) => failure.code === 'FORBIDDEN_TAG'));
});

// A rejected JSON chart anchor should point the author to the surrounding source element.
test('doc audit explains where to place the figure id', async () => {
  const spec = { chart: 'line', title: '虚构趋势', data: [{ day: '甲', value: 1 }], encode: { category: 'day', value: 'value' } };
  const source = JSON.stringify(spec);
  const html = renderShell({ kind: 'doc', title: '示例', theme: 'claude', attrs: { 'data-layout': 'article' }, meta: { 'doc:type': 'report' },
    content: `<pre data-viz="kchart">${source}</pre>`,
  });
  // Simulate editing the source block of an existing hand-authored document before audit.
  const edited = html.replace(`${source}</pre>`, `${JSON.stringify({ ...spec, id: 'trend' })}</pre>`);
  const { failures } = await audit(edited);
  const issue = failures.filter(({ diagnostics }) => diagnostics?.some(({ path }) => path === '/id'));
  assert.equal(issue.length, 1);
  assert.match(issue[0].fix, /<pre data-viz="kchart" id=/);
});

// A hand-drawn SVG uses the page theme; a fallback does not excuse a misspelled token.
test('doc audit checks CSS variables in SVG attributes against shipped theme tokens', async () => {
  const check = (fill) => audit(renderShell({ kind: 'doc', title: '示例', theme: 'claude',
    attrs: { 'data-layout': 'article' }, meta: { 'doc:type': 'doc' },
    content: `<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="${fill}" stroke="var(--viz-1)"/></svg>`,
  }));
  assert.deepEqual((await check('var(--viz-fg)')).failures, []);
  const { failures } = await check('var(--viz-frm-1, var(--surface-2))');
  assert.deepEqual(failures.map(({ code, detail }) => [code, detail]), [['UNKNOWN_TOKEN', '未定义的样式变量 --viz-frm-1']]);
});

// The stable diff parts include chapter names and remain parseable for integration's document diff command.
test('parts uses stable unique document chapter keys', () => {
  const html = renderShell({ kind: 'doc', title: '虚构文档', theme: 'claude', meta: { 'doc:type': 'doc' }, content: '<h2 id="a">甲</h2><p>一</p><h2 id="a">甲</h2><p>二</p>' });
  assert.deepEqual(parts(html).map(({ part }) => part), ['section:a', 'section:a#2']);
});

// A static boundary test keeps the migrated document runtime on the shared graph host and prevents legacy renderer regressions.
test('doc runtime/CSS uses the shared figure contract and contains no legacy graph engines', () => {
  const runtime = readAsset('page/doc.js');
  const styles = readAsset('page/doc.css');
  assert.ok(runtime.includes('KChart?.ready') || runtime.includes('KChart.ready'));
  assert.ok(runtime.includes('MutationObserver'));
  for (const legacy of ['HtmlChart', 'HtmlGraph', 'HtmlDiagram', 'HtmlIcons', 'htmldoc', 'data-chart', '.bars']) assert.equal(runtime.includes(legacy), false, legacy);
  for (const legacy of ['chart-toggle', 'data-chart', '.bars', '.seq', '.arch', '.lg', '.svg-1x']) assert.equal(styles.includes(legacy), false, legacy);
});

// Rebuilding style from parsed document metadata must not inject generated modules as caller options or change the shell fingerprint again.
test('doc style is idempotent after the first shell rebuild', async () => {
  await withTemp(async (dir) => {
    const file = join(dir, 'style.html');
    const content = '<pre data-viz="kchart" id="fig-v">{"chart":"bar","title":"虚构指标对比","data":[{"name":"甲","value":1},{"name":"乙","value":2}],"encode":{"category":"name","value":"value"}}</pre>';
    await writeFile(file, renderShell({ kind: 'doc', title: '虚构标题', theme: 'claude', attrs: { 'data-layout': 'article' }, meta: { 'doc:type': 'doc', 'doc:id': 'fixture' }, content }));
    await style([file, '--theme', 'paper']);
    const first = await readFile(file, 'utf8');
    await style([file, '--theme', 'paper']);
    assert.equal(await readFile(file, 'utf8'), first);
  });
});
