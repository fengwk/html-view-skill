import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'vitest';
import { browserSource, diagram, validate } from '../dist/esm/node.js';
import { render } from '../dist/esm/mermaid.js';
import { checkScene } from './helpers/geometry.mjs';

const radar = n => {
  const axes = Array.from({ length: n }, (_, i) => `a${i}["Axis ${i} with a long label"]`);
  return `radar-beta\naxis ${axes.join(', ')}\ncurve sample{${axes.map((_, i) => i + 1).join(', ')}}`;
};
const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children || [])]);

// The low-count curves retain all real points but never synthesize a filled triangle.
test('Mermaid radars with one or two axes draw degenerate curves with one hint', () => {
  for (const count of [1, 2]) {
    const { scene, svg, diagnostics } = diagram(radar(count), { lang: 'en' });
    assert.ok(svg);
    assert.deepEqual(diagnostics.map(d => [d.code, d.line, d.severity]), [['DIAGRAM_HINT', 2, 'warning']]);
    assert.match(diagnostics[0].fix, /at least 3 axes/);
    const nodes = flatten(scene.children);
    assert.equal(nodes.filter(node => node.tag === 'circle' && node.meta?.field).length, count);
    assert.equal(nodes.filter(node => node.tag === 'line' && node.attrs['stroke-width'] === 2).length, count - 1);
    assert.ok(!nodes.some(node => node.tag === 'polygon'));
    assert.deepEqual(checkScene(scene), []);
  }
});

// Run the geometry gate for each dense axis count at both viewport sizes, using wrapped labels.
test('Mermaid radar keeps dense labels legible and warns exactly when it scrolls', () => {
  let scrolled = false, fit = false;
  for (const width of [360, 800]) for (let n = 7; n <= 24; n++) {
    const source = radar(n);
    const { scene, svg, diagnostics } = diagram(source, { width });
    assert.ok(svg, `${n} axes at ${width}: ${JSON.stringify(diagnostics)}`);
    assert.deepEqual(checkScene(scene, { source }), [], `${n} axes at ${width}`);
    const text = flatten(scene.children).filter(node => node.tag === 'text');
    assert.equal(text.filter(node => node.text.startsWith('Axis ')).length, n);
    assert.ok(text.every(node => node.attrs['font-size'] >= 12));
    const overflow = scene.width > width;
    assert.deepEqual(diagnostics.map(d => d.code), overflow ? ['LARGE_DIAGRAM'] : []);
    scrolled ||= overflow;
    fit ||= !overflow;
  }
  assert.ok(scrolled && fit);
  const capped = diagram(radar(25), { lang: 'en' });
  assert.equal(capped.svg, null);
  assert.equal(capped.diagnostics[0].line, 2);
  assert.equal(capped.diagnostics[0].severity, 'error');
  assert.match(capped.diagnostics[0].message, /24 axes/);
  assert.match(capped.diagnostics[0].fix, /Split/);
});

// The adapter allowance is not available to JSON declarations.
test('native radar retains its 3–6 dimensions limit', () => {
  for (const n of [1, 2, 3, 6, 7, 24]) {
    const dimensions = Array.from({ length: n }, (_, i) => `a${i}`);
    const spec = { chart: 'radar', encode: { label: 'name', dimensions },
      fields: Object.fromEntries(dimensions.map(key => [key, { domain: [0, 2] }])),
      data: [{ name: 'sample', ...Object.fromEntries(dimensions.map(key => [key, 1])) }] };
    assert.deepEqual(validate(spec).errors.map(d => d.path), n === 3 || n === 6 ? [] : ['/encode/dimensions']);
  }
});

// Exercise the version define both through the ESM facade and through the classic page units.
test('info shows the package version with or without showInfo', async () => {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const env = {};
  runInNewContext(browserSource([{ source: 'info' }]), env);
  const options = { width: 360, frame: false, prefix: 'info-test' };
  for (const source of ['info', 'info showInfo', 'info\nshowInfo']) {
    const { scene, svg, diagnostics } = diagram(source, options);
    assert.deepEqual(diagnostics, []);
    assert.ok(scene.height <= 48);
    assert.ok(svg.includes(`>KChart v${version}</text>`));
    assert.equal(env.KChart.diagram(source, options).svg, svg);
    assert.ok((await render('info-test', source, options)).svg.includes(`>KChart v${version}</text>`));
  }
});

// A suggestion is not a new alias. Test both directions of the beta slip and a registered alias.
test('unknown Mermaid header suggests a nearby supported keyword on the header line', () => {
  for (const [wrong, right] of [['eventmodeling-beta', 'eventmodeling'], ['RADAR', 'radar-beta'], ['GRAPH-BETA', 'graph']]) {
    const { svg, diagnostics } = diagram(`%% Comment\n${wrong}`, { lang: 'en' });
    assert.equal(svg, null);
    assert.deepEqual(diagnostics.map(d => [d.line, d.severity, d.fix]), [[2, 'error', `Use "${right}" as the header keyword`]]);
  }
});

// Exercise excess comma fields and a second separator independently; time fields may contain colons.
test('gantt identifies glued tasks without rejecting HH:mm times', () => {
  for (const task of ['A: one, two, three, four', 'A: 1d B: 2d']) {
    const { svg, diagnostics } = diagram(`gantt\nsection Work\n${task}`, { lang: 'en' });
    assert.equal(svg, null);
    assert.deepEqual(diagnostics.map(d => [d.line, d.severity, d.message, d.fix]),
      [[3, 'error', 'This looks like two tasks on one line', 'Put each task on its own line']]);
  }
  assert.ok(diagram('gantt\ndateFormat HH:mm\nA: 00:00, 00:40').svg);
});

// No lang override: the first blocking diagnostic and its fix must follow source-language inference.
test('block, Wardley, ZenUML and all railroad dialects report localized, actionable first errors', () => {
  const cases = [
    ['block-beta', 'block:A["%s"]', 2, '复合块缺少 end', 'Composite block is missing end', /单独写一行 end/, /Put end on its own line/],
    ['wardley-beta', 'title %s\n[A] --> [B]', 3, '无法识别 Wardley 地图语句', 'Unrecognized Wardley map statement', /"需求" --> "网关"/, /"Demand" --> "Gateway"/],
    ['zenuml', 'title %s\n@Actor(User)\nA-->>User: reply\nUser', 3, 'ZenUML 参与者注解写法无效：「@Actor(User)」', 'Invalid ZenUML participant annotation "@Actor(User)"', /@Actor User/, /@Actor User/],
    ...[
      ['railroad-beta', '=', '=', /item = terminal\("x"\);/],
      ['railroad-ebnf-beta', '= 或 ::=', '= or ::=', /item = "x";/],
      ['railroad-abnf-beta', '=', '=', /item = "x";/],
      ['railroad-peg-beta', '<-', '<-', /item <- "x";/],
    ].map(([kind, zh, en, rule]) => [kind, 'diagram-title: %s', 2, `规则名后应为 ${zh}`, `Expected ${en} after the rule name`, /title 标题/, /title My Grammar/, rule]),
  ];
  for (const [kind, body, line, zh, en, fixZh, fixEn, rule] of cases) {
    for (const [title, message, fix] of [['这里是一段用于检查语言的中文标题', zh, fixZh], ['A sample diagram title', en, fixEn]]) {
      const { svg, diagnostics } = diagram(`${kind}\n${body.replace('%s', title)}`);
      assert.equal(svg, null, kind);
      const first = diagnostics.find(d => d.severity === 'error');
      assert.equal(first.line, line, kind);
      assert.equal(first.message, message, kind);
      assert.match(first.fix, fix, kind);
      if (rule) assert.match(first.fix, rule, kind);
      if (kind === 'zenuml') {
        assert.equal(diagnostics[1].line, 4);
        assert.equal(diagnostics[1].message, message === zh ? 'ZenUML 消息箭头写法无效：「-->>」' : 'Invalid ZenUML message arrow "-->>"');
        assert.match(diagnostics[1].fix, /A->User: reply/);
        assert.match(diagnostics[1].fix, /@return A->User: reply/);
      }
    }
  }
});
