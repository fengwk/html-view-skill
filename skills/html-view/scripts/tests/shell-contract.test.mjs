import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { structureRoles } from '../../vendor/kchart/esm/node.js';
import { getTheme, listThemes, themesCss, readingCss, structureProperties } from '../src/shared/themes.mjs';
import { readAsset } from '../src/shared/assets.mjs';
import { auditContent } from '../src/shared/static-audit.mjs';
import { markdownToContent } from '../src/shared/markdown.mjs';
import { auditViz, collectViz, vizMarkup } from '../src/shared/viz.mjs';
import { auditShell, parseShell, renderShell } from '../src/shared/shell.mjs';

test('built-in themes retain KChart color palette and print transforms dark themes via core/theme', () => {
  // Verifies page tokens and chart colors share the runtime source rather than a duplicated palette.
  const html = renderShell({ kind: 'doc', content: '<p>结构图</p>' });
  for (const { id } of listThemes()) {
    const theme = getTheme(id);
    assert.ok(theme.css.includes(`--viz-1:${theme.tones[0]}`));
    assert.ok(theme.css.includes(`--viz-fg:${theme.fg1}`));
    for (const [media, suffix] of [['screen', ''], ['print', '[data-theme]']]) {
      const block = html.split(`[data-theme="${id}"]${suffix}{`)[1]?.split('}')[0].split(';');
      assert.ok(block);
      for (const [key, value] of Object.entries(structureProperties(structureRoles({ theme: id, media })))) {
        assert.ok(block.includes(`${key}:${value}`), `${id}/${media} ${key}`);
      }
    }
  }
  const print = themesCss().slice(themesCss().indexOf('@media print'));
  assert.match(print, /data-theme="obsidian"\]\[data-theme\][^}]*--bg:#ffffff/i);
  assert.match(print, /data-theme="obsidian"\]\[data-theme\][^}]*--viz-1:#23272c/i);
  const pageCss = readingCss();
  for (const selector of ['.doc-body h2', '.table-wrap', '.stats', '.cm-panel', '.viz-body', '@page { size: A4']) assert.ok(pageCss.includes(selector), `missing migrated reading style: ${selector}`);
  assert.ok(!['@print-palette', '.bars', '.chart-svg', '.svg-1x', '.seq-actors'].some((legacy) => pageCss.includes(legacy)));
});

test('shell escapes root properties and title while round-tripping one exact content region', () => {
  // Attacker-controlled text must remain inert, while authored content is preserved byte-for-byte.
  const content = '<p data-x="a&b">text</p>\n';
  const html = renderShell({ kind: 'doc', title: '<title>&"', attrs: { 'data-note': 'x" onmouseover="bad' }, content, meta: { source: 'a&b' } });
  assert.match(html, /<title>&lt;title&gt;&amp;&quot;<\/title>/);
  assert.match(html, /data-note="x&quot; onmouseover=&quot;bad"/);
  assert.equal(parseShell(html).content, content);
  assert.equal(parseShell(html).kind, 'doc');
  assert.throws(() => parseShell(html.replace('</body>', '<!-- htmlview:content --></body>')), /只能包含一对/);
  assert.throws(() => parseShell(html.replace('<!-- htmlview:content -->', '<!--htmlview:content-->')), /精确拼写/);
  assert.throws(() => parseShell(html.replace('</body>', '<!-- HTMLVIEW: CONTENT --></body>')), /精确拼写/);
  assert.throws(() => parseShell(html.replace('content="doc"', 'content="other"')), /类型无效/);
  assert.throws(() => renderShell({ kind: 'doc', before: '<!--htmlview:content-->' }), /内容标记/);
  assert.throws(() => renderShell({ kind: 'doc', extraHead: '<meta http-equiv=" refresh " content="0">' }), /refresh/);
});

test('HTML scanners ignore script pseudo-markup, retain only external meta, and audit real fingerprints', async () => {
  // Script strings must not forge markers/titles; reassembly compares the actual current shell fingerprint.
  const script = `const fake = '<!-- htmlview:content --><title>not a title</title>';`;
  const html = renderShell({ kind: 'ui', attrs: { 'data-scheme': 'dark' }, extraHead: '<meta name="description" content="Synthetic">', styles: ['/* <!-- htmlview:content --> <title>not a title</title> */'], scripts: [script], content: '<p>Screen</p>' });
  const parsed = parseShell(html);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.equal(parsed.theme, null);
  assert.equal(parsed.scheme, 'dark');
  assert.equal(parsed.extraHead, '<meta name="description" content="Synthetic">');
  assert.equal((parsed.content.match(/<p>/g) ?? []).length, 1);
  assert.equal((await auditShell(html, { expected: parsed.shell })).notes.length, 0);
  assert.ok((await auditShell(html, { expected: '0'.repeat(64) })).notes.some(({ code }) => code === 'SHELL_OUTDATED'));
  assert.ok((await auditShell(html.replace(script, 'const fake = 2;'))).notes.some(({ code }) => code === 'SHELL_OUTDATED'));
  const malformed = await auditShell(html.replace('<p>Screen</p>', vizMarkup('kchart', '{bad json}')));
  assert.ok(malformed.failures.some(({ code }) => code === 'BAD_SHELL'), '图形内容缺少角色脚本时拒绝旧外壳');
  const graphic = renderShell({ kind: 'doc', content: vizMarkup('kchart', JSON.stringify({ chart: 'bar', data: [{ label: 'A', value: 1 }], encode: { category: 'label', value: 'value' } })) });
  const brokenViz = await auditShell(graphic.replace(/<pre data-viz="kchart">[^<]*<\/pre>/, vizMarkup('kchart', '{bad json}')));
  assert.ok(brokenViz.failures.some(({ code }) => code === 'BAD_VIZ'));
  assert.throws(() => renderShell({ kind: 'doc', content: vizMarkup('kchart', '{bad json}') }), (error) => error.code === 'BAD_VALUE' && error.details?.failures?.length > 0);
  assert.throws(() => renderShell({ kind: 'doc', theme: 'claude', attrs: { 'data-scheme': 'dark' }, content: '<p>x</p>' }), /冲突/);
});

test('shell assembles declared diagram/chart modules, local map data, and the role scripts', () => {
  // A declared map chart must carry its local asset once and the selected module closure into the shell.
  const map = { chart: 'choropleth', data: { map: { asset: 'world' }, rows: [{ region: 'ZWE', value: 1 }] }, encode: { region: 'region', value: 'value' } };
  const content = `${vizMarkup('kchart', JSON.stringify(map))}\n${vizMarkup('mermaid', 'flowchart TD\nA --> B')}`;
  const html = renderShell({ kind: 'doc', content, scripts: ['window.page=1;'] });
  const parsed = parseShell(html);
  assert.ok(parsed.modules.includes('chart/maps'));
  assert.ok(parsed.modules.some((module) => module.startsWith('diagram/')));
  assert.match(html, /"assets":\{"world":/);
  // 生成脚本按角色排列，页面自己的脚本留在它们之后：没有内联 mount 代码。
  assert.deepEqual(parsed.scripts.map(({ role }) => role), ['kchart', 'viz-config', 'viz', 'page']);
  const [kchart, config, viz] = parsed.scripts;
  assert.match(kchart.content, /KChartPageApi\.createPageApi/);
  assert.doesNotMatch(kchart.content, /mountClones|relayout:/);
  assert.deepEqual(Object.keys(JSON.parse(config.content)), ['lang', 'assets']);
  assert.equal(viz.content, readAsset('page/viz.js'));
  assert.match(viz.content, /globalThis\.HtmlViewViz = Object\.freeze\(\{ ready, relayout, mountClones \}\)/);
  assert.doesNotMatch(html, /KChart\.mount\(document/);
});

// 旧产物只有内联 runtime 和内联 mount，没有角色脚本；解析必须直接要求从源文件重建。
test('parseShell rejects graphic content without the generated role scripts', () => {
  const spec = { chart: 'bar', data: [{ label: 'A', value: 1 }], encode: { category: 'label', value: 'value' } };
  const html = renderShell({ kind: 'doc', content: vizMarkup('kchart', JSON.stringify(spec)) });
  assert.throws(() => parseShell(html.replace('<script data-htmlview="kchart">', '<script>')), /重新构建/);
  assert.throws(() => parseShell(html.replace('data-htmlview="viz-config"', 'data-htmlview="other"')), /未知的 data-htmlview 脚本角色/);
  assert.throws(() => parseShell(html.replace('type="application/json" ', '')), /type 无效/);
  assert.throws(() => parseShell(html.replace(/<script type="application\/json" data-htmlview="viz-config">[^<]*<\/script>\n/, '')), /viz-config/);
  assert.doesNotThrow(() => parseShell(renderShell({ kind: 'doc', content: '<p>普通正文</p>' })));
});

test('Markdown recognizes only the five visualization fences; ordinary JSON stays code', () => {
  // A JSON example is not a chart unless explicitly tagged kchart.
  const result = markdownToContent('```json\n{"chart":"bar"}\n```\n\n```kchart\n{"chart":"bar"}\n```');
  assert.equal((result.content.match(/data-viz=/g) ?? []).length, 1);
  assert.match(result.content, /data-lang="json"/);
  assert.equal(collectViz(result.content)[0].syntax, 'kchart');
  assert.equal(vizMarkup('kchart', '</pre><script>bad</script>').includes('&lt;/pre&gt;'), true);
});

test('legacy Markdown structures, local images, IDs, numeric units, and front matter remain migratable', async (t) => {
  // Preserves old document authoring constructs while the figure fence alone switches to data-viz.
  const baseDir = await mkdtemp(path.join(os.tmpdir(), 'hv-markdown-'));
  t.after(() => rm(baseDir, { recursive: true, force: true }));
  await writeFile(path.join(baseDir, 'pixel.png'), Buffer.from([137, 80, 78, 71]));
  const md = `---\ntitle: "迁移计划"\nowner: team\n---\n\n# 迁移计划\n\n## 1. 覆盖 20 万人\n\n覆盖 20 万人，包含 ![样图](pixel.png)。\n\n> [!NOTE]\n> 保留提示条。\n\n| 项目 | 状态 |\n| --- | --- |\n| 样例 | 完成 |\n\n<details>\n<summary>补充</summary>\n折叠正文\n</details>\n\n## 2. 示例\n\n\`\`\`json\n{\\"chart\\":\\"bar\\"}\n\`\`\`\n\n\`\`\`mermaid\nflowchart TD\nA --> B\n\`\`\``;
  const result = markdownToContent(md, { baseDir });
  assert.equal(result.title, '迁移计划');
  assert.ok(result.content.includes('data:image/png;base64,'));
  assert.match(result.content, /<table>/);
  assert.match(result.content, /class="note"/);
  assert.match(result.content, /<details class="fold">/);
  assert.match(result.content, /id="sec-1"/);
  assert.match(result.content, /class="nowrap">20 万/);
  assert.equal((result.content.match(/<h1/g) ?? []).length, 1);
  assert.match(result.content, /data-lang="json"/);
  assert.equal((result.content.match(/data-viz="mermaid"/g) ?? []).length, 1);
});

// 意图：前言区不再折叠——带 title 以外字段时，整段 YAML（含 title 行、原样转义）作为普通 yaml 代码块出现在正文最前，
// 因此与手写 ```yaml 代码块同形，文档外壳会给它加复制按钮。
test('markdown front matter with extra keys renders the original YAML as a regular yaml code block', () => {
  const yaml = '\ntitle: 迁移计划\nowner: team\ndesc: a<b & c\nstages:\n  - 调研\n  - 灰度\n';
  const body = '## 目标\n\n正文。';
  const { title, content } = markdownToContent(`---\n${yaml}\n---\n\n${body}`);
  assert.equal(title, '迁移计划');
  const block = content.match(/<pre data-lang="yaml"><code>[\s\S]*?<\/code><\/pre>/)?.[0];
  assert.ok(block, '前言区应渲染出 yaml 代码块');
  // 同一个代码块字符串也由手写 ```yaml 代码块产生：结构相同，不额外包 folding 容器。
  const fenced = markdownToContent(`\`\`\`yaml\n${yaml}\n\`\`\`\n\n${body}`);
  assert.equal(block, fenced.content.match(/<pre data-lang="yaml"><code>[\s\S]*?<\/code><\/pre>/)?.[0]);
  assert.match(block, /title: 迁移计划\nowner: team/);
  assert.match(block, /desc: a&lt;b &amp; c/);
  // 位置同原折叠块：正文最前，先于第一个章节。
  assert.ok(content.indexOf(block) < content.indexOf('<h2'));
  assert.doesNotMatch(content, /Markdown 前言区|Markdown front matter|<details|<summary/);
  // 只有简单 title 时行为不变：只作文档标题，不输出额外代码块。
  const simple = markdownToContent('---\ntitle: 迁移计划\n---\n\n## 目标\n\n正文。');
  assert.equal(simple.title, '迁移计划');
  assert.doesNotMatch(simple.content, /data-lang="yaml"/);
  assert.doesNotMatch(simple.content, /title: 迁移计划/);
});

// 意图：Markdown 表格的对齐曾生成行内 style，doc build 后 audit 必然报 INLINE_STYLE；对齐必须落到已登记的 class。
test('markdown table alignment uses registered classes that pass the content audit', () => {
  const { content } = markdownToContent('| 批次 | 比例 | 状态 |\n| :--- | ---: | :---: |\n| 第一批 | 1% | 完成 |');
  assert.match(content, /<th class="align-left">批次<\/th><th class="align-right">比例<\/th><th class="align-center">状态<\/th>/);
  assert.match(content, /<td class="align-left">第一批<\/td><td class="align-right">/);
  assert.doesNotMatch(content, /style=/);
  assert.deepEqual(auditContent(content, { kind: 'doc' }).failures, []);
});

test('shared static audit rejects external resources and dangerous markup but allows explicitly controlled UI script/style', () => {
  // UI permission is explicit and does not disable event-attribute or external-resource checks.
  const blocked = auditContent('<img src="https://example.test/a.png"><script>x()</script>', { kind: 'doc', contentLine: 7 });
  assert.ok(blocked.failures.some(({ code, line }) => code === 'EXTERNAL_RESOURCE' && line === 7));
  assert.ok(blocked.failures.some(({ code }) => code === 'FORBIDDEN_TAG'));
  const controlled = auditContent('<style>.x{color:red}</style><script>setup()</script>', { kind: 'ui', allowStyle: true, allowScript: true });
  assert.deepEqual(controlled.failures, []);
  assert.ok(auditContent('<button onclick="run()">x</button>', { kind: 'ui', allowScript: true }).failures.some(({ code }) => code === 'EVENT_ATTRIBUTE'));
  const resourceMarkup = '<img srcset="a.png 1x, https://example.test/b.png 2x"><svg><use href="//example.test/i.svg#x"></use><rect fill="url(https://example.test/p.svg#x)"></rect></svg><div><span>not closed</div>';
  const issues = auditContent(resourceMarkup).failures;
  assert.equal(issues.filter(({ code }) => code === 'EXTERNAL_RESOURCE').length, 3);
  assert.ok(issues.some(({ code, where }) => code === 'BAD_MARKUP' && where === '<span>'));
});

test('resource audit covers the full page and distinguishes loaded assets from navigation', async () => {
  // 正文、外壳和 SVG 对资源采用相同规则；普通出站链接需要点开，不是页面依赖。
  const content = '<a href="https://example.test/docs">说明</a>'
    + '<img srcset="data:image/png;base64,AAAA 1x, https://example.test/large.png 2x">'
    + '<svg><filter id="blur"><feImage href="//example.test/filter.png"/></filter></svg>';
  const html = renderShell({ kind: 'doc', content, before: '<img src="ht&#9;tps://example.test/header.png" src="data:image/png;base64,AAAA">',
    styles: ['.sample { background: url(assets/texture.png); }'] });
  const { failures } = await auditShell(html);
  assert.deepEqual(failures.map(({ code, where }) => [code, where]), [
    ['UNEMBEDDED_RESOURCE', '<style>'], ['EXTERNAL_RESOURCE', '<img>'],
    ['EXTERNAL_RESOURCE', '<img>'], ['EXTERNAL_RESOURCE', '<feimage>'],
  ]);
  assert.deepEqual(auditContent('<img srcset="data:image/gif;base64,AAAA 1x, data:image/gif;base64,BBBB 2x">').failures, []);
  assert.equal(auditContent('<a href="java&NewLine;script:void(0)">不可执行</a>').failures[0]?.code, 'DANGEROUS_URL');
});

test('static audit restores placeholders, colors, class, markup, IDs, anchors, and heading checks', () => {
  // Each generic audit class has a focused failure so it can guide a real content repair.
  const html = '<h1>Wrong title</h1><h2 id="same">Section</h2><h4>Skipped</h4><p id="same">body</p><a href="#missing">jump</a><div class="unknown" data-todo style="color:#123">draft</div><section>';
  const codes = new Set(auditContent(html, { kind: 'doc', css: '.known{}', contentLine: 4, title: 'Other title' }).failures.map(({ code }) => code));
  for (const code of ['BAD_MARKUP', 'HARDCODED_COLOR', 'HEADING_SKIP', 'UNKNOWN_CLASS', 'PLACEHOLDER', 'DUPLICATE_ID', 'BROKEN_ANCHOR', 'TITLE_MISMATCH']) assert.ok(codes.has(code), `missing audit code ${code}`);
});

test('viz audit delegates recognized source validation and layout to KChart', () => {
  // A valid diagram must lay out; malformed KChart JSON must fail without legacy chart engines.
  const good = auditViz(vizMarkup('mermaid', 'flowchart TD\nA --> B'));
  assert.deepEqual(good.failures, []);
  const bad = auditViz(vizMarkup('kchart', '{not json}'), { contentLine: 3 });
  assert.equal(bad.failures[0].code, 'BAD_VIZ');
  assert.equal(bad.failures[0].where.line, 3);
  const duplicate = auditViz(vizMarkup('kchart', '{"chart":"pie",\n"chart":"bar"}'), { contentLine: 3 });
  assert.equal(duplicate.failures[0].diagnostics[0].path, '/chart');
  assert.equal(duplicate.failures[0].where.line, 4);
  assert.equal(duplicate.failures[0].ref, 'references/charts/common.md');
});
