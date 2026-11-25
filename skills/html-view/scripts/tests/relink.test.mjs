import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { relinkAnchors, relinkHref } from '../src/shared/relink.mjs';
import { buildDoc } from '../src/artifacts/doc/index.mjs';

// 源目录 A 里有 a.md、b.md、sub/c.md、带空格的文件和 img/ 目录；产物写到 out/html。
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'htmlview-relink-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const src = join(root, 'A');
  mkdirSync(join(src, 'sub'), { recursive: true });
  mkdirSync(join(src, 'img'), { recursive: true });
  writeFileSync(join(src, 'b.md'), '# B\n');
  writeFileSync(join(src, 'sub', 'c.md'), '# C\n');
  writeFileSync(join(src, 'my notes.md'), '# N\n');
  return { root, src, out: join(root, 'out', 'html') };
}

// 意图：只改写指向存在文件的相对路径；绝对路径、协议链接、锚点、查询串与找不到的相对路径原样保留。
test('relinkHref rewrites only existing relative targets against the output directory', (t) => {
  const { src, out } = fixture(t);
  const cases = [
    ['b.md', '../../A/b.md'],
    ['./b.md', '../../A/b.md'],
    ['sub/c.md#part', '../../A/sub/c.md#part'],
    ['sub/c.md?x=1#y', '../../A/sub/c.md?x=1#y'],
    ['img/', '../../A/img/'],
    ['my%20notes.md', '../../A/my%20notes.md'],
    ['missing.md', 'missing.md'],
    ['/abs/b.md', '/abs/b.md'],
    ['https://example.com/b.md', 'https://example.com/b.md'],
    ['//cdn.example.com/b.md', '//cdn.example.com/b.md'],
    ['mailto:a@example.com', 'mailto:a@example.com'],
    ['file:///tmp/b.md', 'file:///tmp/b.md'],
    ['#section', '#section'],
    ['?q=1', '?q=1'],
  ];
  for (const [href, expected] of cases) assert.equal(relinkHref(href, src, out), expected, href);
  // 输出目录就是源目录时不改。
  assert.equal(relinkAnchors('<a href="b.md">B</a>', src, src), '<a href="b.md">B</a>');
});

// 意图：Markdown 链接与手写 HTML 链接一并改写；代码里转义后的 <a> 不受影响，其他属性保持原样。
test('relinkAnchors rewrites markdown and raw HTML anchors but not escaped code', (t) => {
  const { src, out } = fixture(t);
  const html = `<p><a href="b.md">B</a> <a class="x" href='sub/c.md' target="_self">C</a> <a href=missing.md>M</a></p><pre><code>&lt;a href="b.md"&gt;</code></pre>`;
  assert.equal(relinkAnchors(html, src, out),
    `<p><a href="../../A/b.md">B</a> <a class="x" href="../../A/sub/c.md" target="_self">C</a> <a href=missing.md>M</a></p><pre><code>&lt;a href="b.md"&gt;</code></pre>`);
});

// 意图：doc build 输出到其他目录时，存在的相对链接按产物位置改写，其余保持原文。
test('doc build rewrites existing relative links when the output lives elsewhere', async (t) => {
  const { src, out } = fixture(t);
  const source = join(src, 'a.md');
  writeFileSync(source, '# A\n\n见 [B](b.md)、[C](sub/c.md#part)、[缺失](missing.md)、[外链](https://example.com)、[根路径](/etc/hosts)。\n\n<a href="b.md">原样 HTML</a>\n');
  const file = join(out, 'a.html');
  await buildDoc([source, '--out', file]);
  const hrefs = [...readFileSync(file, 'utf8').matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map(([, href]) => href).filter((href) => href !== '#main');
  assert.deepEqual(hrefs, ['../../A/b.md', '../../A/sub/c.md#part', 'missing.md', 'https://example.com', '/etc/hosts', '../../A/b.md']);

  // 输出在源目录时链接保持原文。
  const local = join(src, 'a.html');
  await buildDoc([source, '--out', local]);
  assert.match(readFileSync(local, 'utf8'), /<a href="b\.md">B<\/a>/);
});
