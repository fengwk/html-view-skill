import { test } from 'vitest';
import assert from 'node:assert/strict';
import { diagram, themes } from '../dist/esm/node.js';
import { deltaE2000 } from '../src/core/color.js';
import { checkScene } from './helpers/geometry.mjs';

const draw = (source, options = {}) => diagram(source, { syntax: 'blocks', width: 801, ...options });

// Repeated titles, reserved punctuation and description-looking syntax do not confuse ID resolution.
test('blocks v2 measures and paints a compound board with explicit endpoints', () => {
  const source = `col
  box Group {info #F @group}
    grid 3
      card Review {accent #01 @first "Go, now"}
        card This is a description
        first -> second
      card Review {ext @second}
      card Why: A ~> B {@third}
      note Author order is preserved
  legend
    accent: primary card
    ext: external card
    =>: main flow
first => second
second ~> third: queue`;
  const output = draw(source);
  assert.deepEqual(output.diagnostics, []);
  assert.deepEqual(checkScene(output.scene, { source, orthogonal: true }), []);
  assert.equal(output.svg, draw(source).svg);
  const byKind = kind => output.scene.children.filter(el => el.meta?.kind === kind);
  const cards = byKind('node').map(el => el.children[0].attrs);
  assert.equal(cards.length, 3);
  assert.equal(new Set(cards.map(c => c.width)).size, 1);
  assert.equal(new Set(cards.map(c => c.height)).size, 1);
  assert.ok(Number(cards[1].x) - Number(cards[0].x) - Number(cards[0].width) > 16);
  assert.equal(Number(cards[2].x) - Number(cards[1].x) - Number(cards[1].width) > 16, true);
  assert.deepEqual(byKind('edge').map(el => [el.meta.from, el.meta.to, el.attrs['stroke-width']]), [['first', 'second', 1.75], ['second', 'third', 1.25]]);
  assert.match(output.svg, /Go, now/);
  const disconnected = draw(source.split('\nfirst =>')[0]);
  const [a, b] = disconnected.scene.children.filter(el => el.meta?.kind === 'node').map(el => el.children[0].attrs);
  assert.equal(Number(b.x) - Number(a.x) - Number(a.width), 16);
});

// The public API maps parse/layout diagnostics through front matter and localizes message and fix.
const errors = [
  ['card A {blue}', 4, /未知属性/, /Unknown.*attribute/],
  ['box A {new ok}', 4, /一种样式/, /one style/],
  ['card A {#12345}', 4, /徽章/, /badge/],
  ['card A {@2}', 4, /引用 ID/, /reference ID/],
  ['card A {"abcdefghijklmn"}', 4, /标签/, /tag/],
  ['card A {@a}\nbox B {@a}', 5, /重复/, /Duplicate reference/],
  ['card A\ncard B\ncard B\nA -> B', 7, /不唯一/, /Ambiguous/],
  ['card A\nA -> Missing', 5, /不存在/, /Unknown relation endpoint/],
  ['card A {@a}\nA -> a', 5, /自身/, /itself/],
  ['card A\nnote Footnote\nA ~> Footnote', 6, /注释或能力项/, /note or capability/],
  ['box A: item\nA -> item', 5, /注释或能力项/, /note or capability/],
  ['legend\n  color: Meaning', 5, /图例键无效/, /Unknown legend key/],
  ['legend\n  =>: Main\n  =>: Again', 6, /图例键.*重复/, /Repeated legend key/],
  ['grid 13\n  card A', 4, /列数/, /Grid column count/],
  [`card ${'长标题'.repeat(50)}`, 4, /标题.*2 行/, /titles.*2 lines/],
  [`card A${'\n  description'.repeat(9)}`, 13, /描述.*8 行/, /8 card description/],
];

test.each(errors)('blocks v2 localizes and locates the diagnostic for %j', (body, line, zh, en) => {
  const source = `---\ntitle: Review\n---\n${body}`;
  const results = [['zh', zh], ['en', en]].map(([lang, pattern]) => {
    const result = draw(source, { lang });
    assert.equal(result.svg, null);
    const diagnostic = result.diagnostics.find(d => d.line === line && pattern.test(d.message));
    assert.ok(diagnostic?.fix, JSON.stringify(result.diagnostics));
    return diagnostic;
  });
  assert.notEqual(results[0].fix, results[1].fix);
});

// Plain cards differ from styled ones by shape (borderless tile); styled outlines used together in one
// board stay ≥ 12 CIEDE2000 apart in every theme, because a clashing accent falls back to ink.
test('blocks v2 keeps every legend style distinguishable in every theme', () => {
  const status = ['new', 'info', 'ok', 'warn', 'danger'];
  const outlines = (styles, theme) => draw(`row\n${styles.map(s => `  card ${s} {${s}}`).join('\n')}\n  card plain`, { theme })
    .scene.children.filter(el => el.meta?.kind === 'node').map(el => el.children[0].attrs.stroke);
  for (const theme of Object.keys(themes)) {
    for (const styles of [['accent', ...status], ...status.map(s => ['accent', s])]) {
      const strokes = outlines(styles, theme);
      assert.equal(strokes.pop(), undefined, `${theme}: plain card has no outline`);
      strokes.forEach((a, i) => strokes.slice(i + 1).forEach((b, j) => assert.ok(deltaE2000(a, b) >= 12,
        `${theme}: ${styles[i]} ${a} vs ${styles[i + 1 + j]} ${b}`)));
    }
  }
  // The fallback is per board: Claude keeps its accent hue unless a clashing status shares the board.
  const [alone] = outlines(['accent', 'ok'], 'claude'), [clashing] = outlines(['accent', 'danger'], 'claude');
  assert.notEqual(alone, clashing);
});

// Each size trigger emits exactly one warning; a narrow viewport grows the canvas, not the row count.
test('blocks v2 warns once when oversized and never reflows the authored grid', () => {
  const cards = Array.from({ length: 61 }, (_, i) => `  card C${i}`).join('\n');
  const warningCount = result => result.diagnostics.filter(d => d.code === 'LARGE_DIAGRAM').length;
  assert.equal(warningCount(draw(`col\n${cards}`)), 1);
  assert.equal(warningCount(draw(`grid 12\n${cards}`, { width: 390 })), 1);
  const source = `grid 12\n${cards.split('\n').slice(0, 12).join('\n')}`;
  const result = draw(source, { width: 390 });
  assert.equal(warningCount(result), 1);
  const cells = result.scene.children.filter(c => c.meta?.kind === 'node');
  assert.equal(cells.length, 12);
  assert.equal(new Set(cells.map(c => c.children[0].attrs.y)).size, 1);
});
