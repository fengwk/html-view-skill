import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseArgs } from '../src/shared/args.mjs';
import { contentRegions } from '../src/shared/content-regions.mjs';
import { escapeHtml } from '../src/shared/html-util.mjs';
import { fail, ToolError } from '../src/shared/output.mjs';
import { launchBrowser } from '../src/shared/browser.mjs';
import { renderCheck } from '../src/shared/render-audit.mjs';

test('shared args preserve negative string values and use the shared ToolError for usage errors', () => {
  const parsed = parseArgs(['--width', '-12'], { width: { type: 'string' } }, {
    positionals: [0, 0], usage: 'htmlview check <file>',
  });
  assert.equal(parsed.values.width, '-12');

  assert.throws(
    () => parseArgs(['--unknown'], {}, { positionals: [0, 0], usage: 'htmlview check <file>' }),
    (error) => error instanceof ToolError && error.code === 'USAGE' && error.next === 'htmlview check <file>',
  );
  assert.throws(() => fail('FILE_NOT_FOUND', 'missing'), (error) => error instanceof ToolError);
});

test('HTML utilities escape text and content regions only honor htmlview markers before ordinary main/body fallback', () => {
  assert.equal(escapeHtml(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');

  const ordinary = '<body><main>plain <table><tr><td>readable</td></tr></table></main></body>';
  const fallback = contentRegions(ordinary);
  assert.equal(ordinary.slice(fallback[0].start, fallback[0].end), 'plain <table><tr><td>readable</td></tr></table>');

  const legacyMarker = '<!-- doc:content --><p>legacy</p><!-- /doc:content -->';
  assert.equal(contentRegions(legacyMarker)[0].start, 0);

  const marked = '<main>outside</main><!-- htmlview:content --><figure class="viz-figure">inside</figure><!-- /htmlview:content -->';
  const region = contentRegions(marked)[0];
  assert.match(marked.slice(region.start, region.end), /class="viz-figure"/);
});

// 意图：存在且可执行的浏览器脚本也可能因解释器缺失而失败，仍须走结构化环境错误。
test('browser launch reports spawn failures instead of crashing the process', { skip: process.platform === 'win32' }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'htmlview-bad-browser-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const browser = path.join(directory, 'chrome');
  await writeFile(browser, `#!${path.join(directory, 'missing')}\n`, { mode: 0o755 });
  await assert.rejects(launchBrowser({ chromePath: browser }), (error) => {
    const log = error.details?.log;
    if (log) t.after(() => rm(path.dirname(log), { recursive: true, force: true }));
    return error instanceof ToolError && error.code === 'BROWSER_FAILED' && /ENOENT/.test(error.message);
  });
});

test('render audit waits for KChart readiness and relayouts against the selected media', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'htmlview-foundation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'plain.html');
  await writeFile(file, '<!doctype html><html><body><main><table><tr><td>ordinary HTML</td></tr></table></main></body></html>');

  const evaluations = [];
  const media = [];
  const page = {
    async send() {},
    on() {},
    async setMedia(value) { media.push(value); },
    async setViewport() {},
    async goto() {},
    async evaluate(expression) {
      evaluations.push(expression);
      if (expression.includes('collectPageRules')) return [];
      return 1;
    },
    async json() { return { failures: [], notes: [] }; },
    async close() {},
  };
  const browser = { async newPage() { return page; } };

  const result = await renderCheck(file, { browser });
  assert.deepEqual(result, { failures: [], notes: [] });
  assert.ok(evaluations.some((expression) => expression.includes('window.KChart?.ready')));
  assert.ok(evaluations.some((expression) => expression.includes('window.KChart?.relayout')));
  assert.ok(evaluations.some((expression) => expression.includes("matchMedia('print').matches")));
  assert.ok(media.includes('print'));
  assert.ok(media.includes(''));
  // 检查与内容提取共用拒绝规则，不把错误拼写当成普通 HTML 然后启动浏览器。
  await writeFile(file, '<main><!--htmlview:content--><p>正文</p><!-- /htmlview:content --></main>');
  await assert.rejects(
    renderCheck(file, { browser: { async newPage() { assert.fail('invalid marker opened the browser'); } } }),
    (error) => error instanceof ToolError && error.code === 'BAD_SHELL',
  );
  await assert.rejects(
    renderCheck(path.join(directory, 'missing.html'), { browser }),
    (error) => error instanceof ToolError && error.code === 'FILE_NOT_FOUND',
  );
});
