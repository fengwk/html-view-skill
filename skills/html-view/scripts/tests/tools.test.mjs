import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, linkSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findBrowser } from '../src/shared/browser.mjs';
import { fallbackMeasure, wrapText } from '../../vendor/kchart/esm/core/text.js';
import { resolveThemeConfig, structureRoles } from '../../vendor/kchart/esm/node.js';
import { structureProperties } from '../src/shared/themes.mjs';

const BIN = fileURLToPath(new URL('../htmlview', import.meta.url));
const browserSkip = findBrowser() ? false : '本机没有 Chrome / Chromium，跳过浏览器工具用例';
const readFixture = fileURLToPath(new URL('./fixtures/tools/read.html', import.meta.url));

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'htmlview-tools-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function invoke(argv) {
  const result = spawnSync(process.execPath, [BIN, ...argv], {
    encoding: 'utf8', timeout: 120000, env: process.env,
  });
  if (result.error) throw result.error;
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status };
}

test('read 对任意本地 HTML 输出纯 Markdown，section 按标题边界截取', async (t) => {
  const result = await invoke(['read', readFixture, '--section', 'first']);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /^# 工具阅读样例/m);
  assert.match(result.stdout, /第一节/);
  assert.match(result.stdout, /只读内容/);
  assert.match(result.stdout, /```mermaid[\s\S]*A --> B/);
  assert.doesNotMatch(result.stdout, /第二节|不应出现在/);
  assert.doesNotMatch(result.stdout, /"ok"\s*:/);

  const plainCode = join(tempDir(t), 'plain.html');
  writeFileSync(plainCode, '<body><main><pre data-lang="mermaid">flowchart LR</pre><pre data-viz="unknown">raw</pre></main></body>');
  const plainResult = invoke(['read', plainCode]);
  assert.equal(plainResult.exitCode, 0);
  assert.match(plainResult.stdout, /```mermaid\nflowchart LR/);
  assert.match(plainResult.stdout, /```\nraw/);
});

test('read --outline 输出稳定的大纲字段，--out 保存 Markdown 正文', async (t) => {
  const dir = tempDir(t);
  const outline = await invoke(['read', readFixture, '--outline']);
  const result = JSON.parse(outline.stdout);
  assert.equal(outline.exitCode, 0);
  assert.equal(result.title, '工具阅读样例');
  assert.deepEqual(result.headings.map(({ level, id, text }) => ({ level, id, text })), [
    { level: 2, id: 'first', text: '第一节' },
    { level: 2, id: 'second', text: '第二节' },
  ]);
  assert.ok(result.headings.every(({ line, end }) => Number.isInteger(line) && end >= line));

  const out = join(dir, 'read.md');
  const written = await invoke(['read', readFixture, '--out', out]);
  assert.equal(written.exitCode, 0);
  assert.match(readFileSync(out, 'utf8'), /第一节/);
  assert.match(JSON.parse(written.stdout).file, /read\.md$/);

  const outlineOut = join(dir, 'outline.json');
  const savedOutline = await invoke(['read', readFixture, '--outline', '--out', outlineOut]);
  assert.equal(savedOutline.exitCode, 0);
  assert.deepEqual(JSON.parse(readFileSync(outlineOut, 'utf8')).headings, result.headings);
});

// Only a skin changes on the copy; a plain HTML input is explicitly rejected before any write.
test('style help distinguishes managed HTML and copy-first restyling preserves the source', (t) => {
  const dir = tempDir(t);
  const input = join(dir, 'original.html');
  const output = join(dir, 'cloudmusic.html');
  const source = join(dir, 'original.md');
  const external = join(dir, 'external.html');
  const help = invoke(['style', '--help']);
  assert.equal(help.exitCode, 0);
  assert.match(help.stdout, /原位更新 htmlview 产物/);
  assert.match(help.stdout, /同目录复制/);

  const ordinaryHtml = '<!doctype html><html><head><title>Original</title></head><body><p>Read-only</p></body></html>';
  writeFileSync(external, ordinaryHtml);
  const unsupported = invoke(['style', external, '--theme', 'cloudmusic']);
  assert.equal(unsupported.exitCode, 2);
  const { error } = JSON.parse(unsupported.stdout);
  assert.equal(error.code, 'BAD_SHELL');
  assert.match(error.next, /普通 HTML.*doc new.*迁移原有内容/);
  assert.equal(readFileSync(external, 'utf8'), ordinaryHtml);

  writeFileSync(source, '# Fictional report\n\n## Results\n\nThe sample contained 305 records.\n');
  assert.equal(invoke(['doc', 'build', source, '--out', input, '--theme', 'claude']).exitCode, 0);
  const original = readFileSync(input, 'utf8');
  copyFileSync(input, output);
  const restyled = invoke(['style', output, '--theme', 'cloudmusic']);
  assert.equal(restyled.exitCode, 0, restyled.stdout);
  assert.equal(JSON.parse(restyled.stdout).theme, 'cloudmusic');
  assert.equal(readFileSync(input, 'utf8'), original);
  const diff = invoke(['diff', input, output]);
  assert.equal(diff.exitCode, 0, diff.stdout);
  assert.deepEqual(JSON.parse(diff.stdout).changed, []);
});

test('embed 只改 htmlview 内容区并内嵌本地图片和 data-src 文本', async (t) => {
  const dir = tempDir(t);
  const image = join(dir, 'pixel.png');
  const code = join(dir, 'snippet.txt');
  const html = join(dir, 'page.html');
  writeFileSync(image, Buffer.from([1, 2, 3]));
  writeFileSync(code, '<node & value>\n');
  writeFileSync(html, '<body><img id="outside" src="pixel.png"><!-- htmlview:content --><main><img src="pixel.png"><pre data-src="snippet.txt"></pre></main><!-- /htmlview:content --></body>');

  const result = await invoke(['embed', html]);
  const output = readFileSync(html, 'utf8');
  assert.equal(result.exitCode, 0);
  assert.match(output, /id="outside" src="pixel\.png"/);
  assert.match(output, /src="data:image\/png;base64,AQID"/);
  assert.match(output, /<code>&lt;node &amp; value&gt;<\/code>/);
  assert.doesNotMatch(output, /data-src=/);
  assert.equal(JSON.parse(result.stdout).embedded.length, 2);
});

test('viz schema 与 palette 通过 KChart 原生 API 返回契约字段', async () => {
  const schemaResult = await invoke(['viz', 'schema']);
  const schemaPayload = JSON.parse(schemaResult.stdout);
  assert.equal(schemaResult.exitCode, 0);
  assert.equal(schemaPayload.ok, true);
  assert.equal(typeof schemaPayload.schema, 'object');

  // A selected chart exposes its role and variant rules before the full conditional schema.
  const line = invoke(['viz', 'schema', 'line']);
  assert.equal(line.exitCode, 0, line.stdout);
  const selected = JSON.parse(line.stdout);
  assert.deepEqual(selected.contract.required, ['category', 'value']);
  assert.deepEqual(selected.contract.special.variant, ['counter', 'barcode']);
  assert.ok(!Object.hasOwn(selected.contract.special, 'layout'));
  assert.equal(selected.schema.allOf[0].then.properties.layout, false);
  const invalid = invoke(['viz', 'schema', 'unknown-chart']);
  assert.equal(invalid.exitCode, 2);
  assert.equal(JSON.parse(invalid.stdout).error.code, 'USAGE');

  const paletteResult = await invoke(['viz', 'palette', '--theme', 'paper']);
  const palettePayload = JSON.parse(paletteResult.stdout);
  assert.equal(paletteResult.exitCode, 0);
  assert.equal(palettePayload.theme, 'paper');
  assert.ok(Array.isArray(palettePayload.roles));
  // 图内强调色与主题 JSON 的页面强调色 accent 是不同角色，输出不得再用 accent 命名。
  assert.equal(palettePayload.palette.chartAccent, palettePayload.palette.tone2);
  assert.ok(!('accent' in palettePayload.palette));
  assert.ok(!palettePayload.roles.some(({ role }) => role === 'accent'));
  assert.match(palettePayload.svgSkeleton, /^<svg\b/);
  // 发布的调色板角色必须与页面变量一一对应，模板本身不烘焙颜色。
  const structure = structureProperties(structureRoles({ theme: 'paper' }));
  assert.deepEqual(Object.fromEntries(palettePayload.structure.map(({ role, cssVariable, value, purpose }) => {
    assert.equal(cssVariable, `--viz-${role}`);
    assert.ok(purpose);
    return [cssVariable, value];
  })), structure);
  assert.equal(palettePayload.tokens.font.family, structure['--viz-font']);
  assert.equal(`${palettePayload.tokens.radius.frame}px`, structure['--viz-radius']);
  assert.doesNotMatch(palettePayload.svgSkeleton, /#[\da-f]{3,8}\b|\b(?:style|class)=|<style\b/i);
  assert.ok(palettePayload.figureTemplate.includes(palettePayload.svgSkeleton));
});

// 用 KChart 同一套估算与断行验证 CLI 输出，包含中英文和加粗字重。
test('viz measure returns KChart widths and lines and enforces minimum size', () => {
  const samples = ['payment-callback', '订单服务'];
  const size = 14, weight = 600, maxWidth = 65;
  const result = invoke(['viz', 'measure', ...samples, '--size', String(size), '--weight', String(weight), '--max-width', String(maxWidth)]);
  assert.equal(result.exitCode, 0, result.stdout);
  const itemOf = (text) => ({ text, width: Math.ceil(fallbackMeasure(text, size, weight)) });
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, size, weight, items: samples.map(text => ({
    ...itemOf(text), lines: Array.from(wrapText(text, maxWidth, { size, weight }), itemOf),
  })) });
  const invalid = invoke(['viz', 'measure', samples[0], '--size', '11']);
  assert.equal(invalid.exitCode, 2);
  assert.equal(JSON.parse(invalid.stdout).error.code, 'USAGE');
  assert.match(JSON.parse(invalid.stdout).error.next, /12px/);
});

// 通过真实 --theme-file 入口核对生成页的结构样式，尤其是暗色主题的打印回退。
test('doc new emits custom theme structure variables for screen and print', (t) => {
  const dir = tempDir(t), configFile = join(dir, 'theme.json'), out = join(dir, 'custom.html');
  const config = { id: 'sketch-night', extends: 'obsidian', fontFamily: 'monospace', diagram: { radius: 12, smallRadius: 3 } };
  writeFileSync(configFile, JSON.stringify(config));
  const result = invoke(['doc', 'new', out, '--type', 'doc', '--title', 'Example', '--theme-file', configFile]);
  assert.equal(result.exitCode, 0, result.stdout);
  const page = readFileSync(out, 'utf8');
  const theme = resolveThemeConfig(config);
  const id = JSON.parse(result.stdout).theme;
  assert.match(id, /^custom-sketch-night-[a-f0-9]{64}$/);
  for (const [media, suffix] of [['screen', ''], ['print', '[data-theme]']]) {
    const block = page.split(`[data-theme="${id}"]${suffix}{`)[1]?.split('}')[0].split(';');
    assert.ok(block);
    for (const [key, value] of Object.entries(structureProperties(structureRoles({ theme, media })))) {
      assert.ok(block.includes(`${key}:${value}`), `${media} ${key}`);
    }
  }
});

test('viz render 用 Chrome 实测 KChart JSON 并输出 SVG', { skip: browserSkip }, async (t) => {
  const dir = tempDir(t);
  const source = join(dir, 'chart.json');
  const out = join(dir, 'chart.svg');
  writeFileSync(source, JSON.stringify({
    chart: 'bar', title: '合成数据', data: [{ region: '北区', sales: 12 }],
    encode: { category: 'region', value: 'sales' },
  }));
  const result = invoke(['viz', 'render', source, '--out', out]);
  const payload = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(payload.format, 'svg');
  assert.equal(payload.theme, 'terminal');
  assert.ok(payload.width > 0 && payload.height > 0);
  assert.match(readFileSync(out, 'utf8'), /^<svg\b/);
});

test('viz render 在校验失败时不写目标文件', async (t) => {
  const dir = tempDir(t);
  const source = join(dir, 'bad.mmd');
  const out = join(dir, 'bad.svg');
  writeFileSync(source, 'not-a-supported-diagram');
  const result = invoke(['viz', 'render', source, '--out', out]);
  const payload = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 2);
  assert.equal(payload.error.code, 'USAGE');
  assert.equal(existsSync(out), false);
});

test('viz render 识别 Mermaid 源码并输出自包含 HTML', { skip: browserSkip }, async (t) => {
  const dir = tempDir(t);
  const source = join(dir, 'flow.mmd');
  const out = join(dir, 'flow.html');
  // 较长的声明在打印模式展开时允许另页阅读，不能算成图身太高；图框还应留两侧边框宽度。
  writeFileSync(source, `flowchart LR\n  A[开始] --> B[结束]\n${'  %% 该行仅为注释，不改变图身。\n'.repeat(55)}`);
  const result = invoke(['viz', 'render', source, '--out', out, '--theme', 'paper', '--width', '350']);
  const payload = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(payload.format, 'html');
  const html = readFileSync(out, 'utf8');
  assert.match(html, /<html\b/);
  assert.match(html, /<svg\b/);
  assert.match(html, /开始/);
  // 复制按钮是单图页唯一的页内脚本；源码留在图外，只供 style 与 parts 读回。
  assert.equal(html.match(/<script\b/gi)?.length, 1);
  assert.doesNotMatch(html, /<link\b/i);
  assert.match(html, /<\/figure><div class="viz-copy"><button type="button" class="btn btn-sm copy"[^>]*>复制<\/button><\/div><pre id="viz-source" hidden>/, 'source stays in the file but outside the figure');
  const measured = invoke(['check', out]);
  assert.equal(measured.exitCode, 0, measured.stdout);
  assert.deepEqual(JSON.parse(measured.stdout).notes.filter(({ code }) => code === 'SCROLL_X'), []);
});

test('check 有失败项时输出诊断并以退出码 1 结束', { skip: browserSkip }, async (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'small-text.html');
  writeFileSync(file, '<!doctype html><html><body><main><p style="font-size:8px">这段文字字号过小</p></main></body></html>');
  const result = await invoke(['check', file]);
  const payload = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 1);
  assert.equal(payload.pass, false);
  assert.ok(payload.failures.some((item) => item.code === 'SMALL_TEXT'));
});

test('shot 对选中的 SVG 按 1:1 输出真实 PNG', { skip: browserSkip }, async (t) => {
  const dir = tempDir(t);
  const html = join(dir, 'svg.html');
  const outputDir = join(dir, 'shots');
  writeFileSync(html, '<!doctype html><html><body><main><svg xmlns="http://www.w3.org/2000/svg" width="320" height="100"><rect width="320" height="100" fill="#2468ac"/></svg></main></body></html>');
  const result = await invoke(['shot', html, '--select', 'svg', '--out', outputDir]);
  const payload = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 0);
  assert.equal(payload.files.length, 1);
  const png = join(outputDir, 'select-01.png');
  assert.ok(existsSync(png));
  const buffer = readFileSync(png);
  assert.equal(buffer.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.equal(buffer.readUInt32BE(16), 320);
});

// 意图：即使输出用另一个文件名指到源文件，也不能用 PDF 覆盖源 HTML。
test('export 拒绝覆盖源 HTML', t => {
  const dir = tempDir(t);
  const html = join(dir, 'source.html');
  const out = join(dir, 'alias.pdf');
  const source = '<!doctype html><main>保留原文</main>';
  writeFileSync(html, source);
  linkSync(html, out);
  const result = invoke(['export', html, '--format', 'pdf', '--out', out]);
  assert.equal(result.exitCode, 2, result.stdout);
  assert.match(JSON.parse(result.stdout).error.message, /不能把导出结果写入源 HTML/);
  assert.equal(readFileSync(html, 'utf8'), source);
});

test('export --format pdf 按 print 媒体生成可读 PDF', { skip: browserSkip }, async (t) => {
  const dir = tempDir(t);
  const html = join(dir, 'print.html');
  const out = join(dir, 'print.pdf');
  writeFileSync(html, '<!doctype html><html><head><style>@page{size:6in 8in;margin:0.3in} @media print{main{color:#111}}</style></head><body><main><h1>Print reflow</h1><p>真实打印媒体布局</p></main></body></html>');
  const result = await invoke(['export', html, '--format', 'pdf', '--out', out]);
  const payload = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 0);
  assert.ok(payload.files[0].pages >= 1);
  assert.equal(readFileSync(out).toString('latin1', 0, 5), '%PDF-');
});

// 意图：没有打印样式的 HTML 也按 A4 四边 15mm 测量，不把略超版心的图当成能打印。
test('默认 A4 使用实际版心，忽略没有生效的 @page', { skip: browserSkip }, t => {
  const dir = tempDir(t);
  const html = join(dir, 'no-print-rule.html');
  const out = join(dir, 'no-print-rule.pdf');
  writeFileSync(html, `<!doctype html><meta charset="utf-8">
<style>body{margin:0} svg{display:block} @media screen{@page{size:A3;margin:0}}</style>
<style media="screen">@page{size:A3;margin:0}</style>
<main><svg width="685" height="40"><rect width="685" height="40"/></svg></main>`);
  const check = invoke(['check', html]);
  assert.equal(check.exitCode, 1, check.stdout);
  const failures = JSON.parse(check.stdout).failures.filter(({ code }) => code === 'PRINT_CLIP');
  assert.equal(failures.length, 1);
  assert.match(failures[0].detail, /680px 版心 5px/);
  const pdf = invoke(['export', html, '--format', 'pdf', '--out', out]);
  assert.equal(pdf.exitCode, 1, pdf.stdout);
  assert.deepEqual(JSON.parse(pdf.stdout).failures, failures.map(({ viewports, ...failure }) => failure));
  assert.equal(existsSync(out), false);
});

// 意图：相同纸型同时控制检查和 PDF 实际页面尺寸，不改源 HTML 也不缩图。
test('A4 横向使用真实拓宽的打印版心', { skip: browserSkip }, async (t) => {
  const dir = tempDir(t);
  const html = join(dir, 'wide.html');
  const out = join(dir, 'wide.pdf');
  const source = '<!doctype html><meta charset="utf-8"><style>@page{size:A4;margin:15mm} @media print{svg{width:740px}}</style><main><svg width="280" height="38" viewBox="0 0 740 38"><rect width="740" height="38"/></svg></main>';
  writeFileSync(html, source);
  const portrait = invoke(['check', html]);
  assert.ok(JSON.parse(portrait.stdout).failures.some(failure => failure.code === 'PRINT_CLIP'));
  const blocked = invoke(['export', html, '--format', 'pdf', '--out', out]);
  assert.equal(blocked.exitCode, 1, blocked.stdout);
  assert.ok(JSON.parse(blocked.stdout).failures.some(failure => failure.code === 'PRINT_CLIP'));
  assert.equal(existsSync(out), false);
  const landscape = invoke(['check', html, '--paper', 'a4-landscape']);
  const result = JSON.parse(landscape.stdout);
  assert.equal(landscape.exitCode, 0, landscape.stdout);
  assert.ok(result.checkedViewports.includes('print'));
  const pdf = invoke(['export', html, '--format', 'pdf', '--paper', 'a4-landscape', '--out', out]);
  assert.equal(pdf.exitCode, 0, pdf.stdout);
  const [, width, height] = /\/MediaBox\s*\[0\s+0\s+([\d.]+)\s+([\d.]+)\]/.exec(readFileSync(out, 'latin1')) ?? [];
  assert.ok(Math.abs(Number(width) - 842) < 3 && Math.abs(Number(height) - 595) < 3, `${width} × ${height}`);
  assert.equal(readFileSync(html, 'utf8'), source);
});

// 意图：标题加图放不进一页、图本身放得下时，图题和图身一起换页，不把图题留在上一页、留下大片空白。
test('图题与图身不被前面的章节标题拆开', { skip: browserSkip || (spawnSync('pdftotext', ['-v']).error ? '没有 pdftotext' : false) }, t => {
  const dir = tempDir(t);
  const html = join(dir, 'figure-page.html');
  const out = join(dir, 'figure-page.pdf');
  writeFileSync(html, `<!doctype html><meta charset="utf-8">
<style>@page{size:A4;margin:15mm} body{margin:0} svg{display:block}
@media print{h2{break-after:avoid} .viz-figure{break-inside:avoid}}</style>
<main><div style="height:520px">INTRO</div><h2>SECTION</h2>
<figure class="viz-figure"><figcaption>CAPTION</figcaption>
<svg width="300" height="950" viewBox="0 0 300 950"><text x="10" y="20">DRAWING</text></svg></figure></main>`);
  const pdf = invoke(['export', html, '--format', 'pdf', '--out', out]);
  assert.equal(pdf.exitCode, 0, pdf.stdout);
  const extracted = spawnSync('pdftotext', [out, '-'], { encoding: 'utf8' });
  assert.equal(extracted.status, 0, extracted.stderr);
  const pages = extracted.stdout.split('\f');
  const pageOf = (word) => pages.findIndex((page) => page.includes(word)) + 1;
  assert.equal(pageOf('INTRO'), 1);
  assert.ok(pageOf('DRAWING') > 1, 'the drawing is present on a later page');
  assert.equal(pageOf('CAPTION'), pageOf('DRAWING'));
});

// 意图：图宽即使可容纳，高于一页仍不能生成空白图或被分片裁切。
test('高图保留尺寸，A4 拒绝导出，A3 纵向正常打印', { skip: browserSkip }, t => {
  const dir = tempDir(t);
  const html = join(dir, 'tall.html');
  const out = join(dir, 'tall.pdf');
  writeFileSync(html, '<!doctype html><meta charset="utf-8"><style>svg{display:block}</style><main><div class="viz-figure"><svg width="240" height="1100" viewBox="0 0 240 1100"><rect width="240" height="1100" /></svg></div></main>');
  const check = invoke(['check', html, '--paper', 'a4-landscape']);
  assert.equal(check.exitCode, 1);
  const tall = JSON.parse(check.stdout).failures.find(failure => failure.code === 'PRINT_CLIP');
  assert.match(tall.detail, /完整图高 1100px/);
  assert.match(tall.fix, /a3-portrait/);
  const blocked = invoke(['export', html, '--format', 'pdf', '--paper', 'a4-landscape', '--out', out]);
  assert.equal(blocked.exitCode, 1, blocked.stdout);
  assert.equal(existsSync(out), false);
  const pdf = invoke(['export', html, '--format', 'pdf', '--paper', 'a3-portrait', '--out', out]);
  assert.equal(pdf.exitCode, 0, pdf.stdout);
  const [file] = JSON.parse(pdf.stdout).files;
  assert.equal(file.pages, 1);
  assert.ok(Math.abs(file.width - 842) < 3 && Math.abs(file.height - 1191) < 3);
});
