import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { catalog, diagram, diagramTypes, render } from '../../vendor/kchart/esm/node.js';
import { markdownToContent } from '../src/shared/markdown.mjs';
import { VIZ_SYNTAXES } from '../src/shared/viz.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const main = readFileSync(join(root, 'SKILL.md'), 'utf8');
const refRoot = join(root, 'references');
const refs = readdirSync(refRoot, { recursive: true }).filter(path => path.endsWith('.md')).map(path => path.split(sep).join('/'));
const docs = new Map([['SKILL.md', main], ...refs.map(ref => [`references/${ref}`, readFileSync(join(refRoot, ref), 'utf8')])]);
const entryCount = (regex) => [...docs.entries()].filter(([path]) => path !== 'SKILL.md').reduce((n, [, text]) => n + [...text.matchAll(regex)].length, 0);
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 入口要覆盖每个规范类型，详细写法只有一个来源。
test('图型索引完整且 reference 小节不重复', () => {
  assert.ok(main.split('\n').length < 250);
  for (const name of Object.keys(catalog)) {
    assert.ok(main.includes('`' + name + '`'), name);
    assert.equal(entryCount(new RegExp('^## 图型 `' + escape(name) + '`\\s*$', 'gm')), 1, name);
  }
  for (const item of diagramTypes) {
    const name = item.kind;
    assert.ok(main.includes('`' + name + '`'), name);
    assert.equal(entryCount(new RegExp('^## ' + escape(name) + '\\s*$', 'gm')), 1, name);
    assert.ok(refs.some(ref => ref.endsWith(`/${item.topic}.md`)), `${name}: ${item.topic}`);
  }
  for (const ref of refs) assert.ok(main.includes(`references/${ref}`), `入口缺少 ${ref}`);
});

// 真正调用 Markdown 识别与两个渲染入口；嵌套 Markdown 示例和报表引用不当成独立数据。
test('技能文档中的每个图形示例实际渲染', () => {
  let count = 0;
  for (const [path, text] of docs) {
    markdownToContent(text, { renderViz(syntax, source) {
      assert.ok(VIZ_SYNTAXES.includes(syntax));
      const spec = syntax === 'kchart' ? JSON.parse(source) : null;
      const result = syntax === 'kchart' ? render(spec, { width: 502 }) : diagram(source, { syntax, width: 502 });
      assert.deepEqual(result.diagnostics, [], `${path}: ${source}`);
      assert.ok(result.svg, path);
      count++;
      return '';
    } });
  }
  assert.ok(count >= 15, `只读取了 ${count} 个示例`);
});

test('技能文档相对链接可达，入口和正文不引用其他技能', () => {
  const parent = resolve(root, '..');
  const siblings = readdirSync(parent).filter(name => name !== 'html-view' && existsSync(join(parent, name, 'SKILL.md')));
  for (const [path, text] of docs) {
    for (const [, target] of text.matchAll(/\]\(([^)]+\.md)(?:#[^)]+)?\)/g)) assert.ok(existsSync(resolve(root, dirname(path), target)), `${path}: ${target}`);
    for (const name of siblings) {
      const namePattern = new RegExp('(?<![\\w-])' + escape(name) + '(?![\\w-])');
      // report/doc/ui 和 chart 角色等英文通用词不是技能引用；名称只有精确命中才检查。
      assert.ok(!namePattern.test(text), `${path} 引用另一个技能：${name}`);
    }
  }
});
