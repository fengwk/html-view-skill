import { test } from 'vitest';
import assert from 'node:assert/strict';
import { implementations } from '../src/diagram/sequence.js';
import { createContext } from '../src/core/context.js';
import { renderScene } from '../src/core/svg.js';
import { measureOf } from '../src/diagram/support.js';
import { checkScene } from './helpers/geometry.mjs';

const engine = implementations.sequenceDiagram;
const parse = source => engine.parse(source, { firstLine: 2, options: {}, lang: 'en' });
const messages = model => model.statements.filter(item => item.type === 'message');
function render(source, width = 360) {
  const { model, errors } = parse(source);
  assert.deepEqual(errors.filter(e => e.severity !== 'warning'), []);
  const ctx = createContext({ width, theme: 'paper', lang: 'en' });
  const layout = engine.layout(model, { width, lang: 'en', measure: measureOf(ctx) });
  assert.deepEqual(layout.errors.filter(e => e.severity !== 'warning'), []);
  const scene = engine.scene(layout, ctx);
  assert.deepEqual(checkScene(scene), []);
  return { model, layout, scene, errors, svg: renderScene(scene, { prefix: 'sequence', theme: 'paper' }) };
}

// All 26 tokens render with the proper endpoints and dashes, even when an ID or label contains punctuation.
test('longest arrow matching preserves all 26 spellings', () => {
  const arrows = [
    ['->>', 'arrow'], ['-->>', 'arrow'], ['->', 'none'], ['-->', 'none'], ['<<->>', 'arrow', 'arrow'], ['<<-->>', 'arrow', 'arrow'],
    ['-x', 'cross'], ['--x', 'cross'], ['-)', 'open'], ['--)', 'open'],
    ['-|\\', 'top'], ['--|\\', 'top'], ['-|/', 'bottom'], ['--|/', 'bottom'],
    ['-\\\\', 'stick-top'], ['--\\\\', 'stick-top'], ['-//', 'stick-bottom'], ['--//', 'stick-bottom'],
    ['/|-', 'none', 'top'], ['/|--', 'none', 'top'], ['\\|-', 'none', 'bottom'], ['\\|--', 'none', 'bottom'],
    ['//-', 'none', 'stick-top'], ['//--', 'none', 'stick-top'], ['\\\\-', 'none', 'stick-bottom'], ['\\\\--', 'none', 'stick-bottom'],
  ];
  const { model, scene, svg } = render(arrows.map(([token]) => `A-v1${token}B.v2: reply: later -->> #9829;`).join('\n'));
  assert.deepEqual(model.participants.map(a => a.id), ['A-v1', 'B.v2']);
  assert.deepEqual(messages(model).map(m => [m.arrow.token, m.arrow.head, m.arrow.start]), arrows.map(([token, head, start]) => [token, head, start]));
  assert.ok(messages(model).every(m => m.text === 'reply: later -->> ♥'));
  const routes = scene.children.filter(node => node.meta?.kind === 'message');
  assert.equal(routes.length, 26);
  const marker = head => head === 'arrow' ? 'url(#seq-arrow)' : `url(#seq-arrow-${head})`;
  routes.forEach(({ attrs }, i) => {
    const [token, head, start] = arrows[i];
    assert.equal(attrs['marker-start'], start ? marker(start) : undefined);
    assert.equal(attrs['marker-end'], head === 'none' ? undefined : marker(head));
    assert.equal(Boolean(attrs['stroke-dasharray']), token.includes('--'));
  });
  assert.match(svg, /marker-start="url\(#sequence-seq-arrow\)"/);
});

// Epicentre markers must add dots to the real lifelines, not create extra participants.
test('central connections attach on either or both ends', () => {
  const { model, scene, layout } = render('A->>()B: right; A()->>B: left\nA()->>()B: both');
  assert.deepEqual(messages(model).map(m => [m.centralStart, m.centralEnd]), [[false, true], [true, false], [true, true]]);
  assert.deepEqual(scene.children.filter(n => n.tag === 'circle').map(n => n.attrs.cx), [layout.actors[1].x, layout.actors[0].x, layout.actors[0].x, layout.actors[1].x]);
});

// Created heads occupy their incoming row, aliases win over metadata, and destroy terminates a sender and its activation.
test('participant metadata, boxed creation and sender destruction', () => {
  for (const width of [800, 360]) {
    const { layout, svg } = render(`participant A@{ "type": "queue", alias: Internal } as Q
box Purple Created actors
create actor D as Donald
end
A->>+D: create
D->>D: work
destroy D
D-->>-A: finished`, width);
    const [a, d] = layout.actors;
    assert.deepEqual([a.kind, a.name, d.kind, d.name], ['queue', 'Q', 'actor', 'Donald']);
    const created = layout.events.find(e => e.create), destroyed = layout.events.find(e => e.destroy);
    assert.equal(d.head.y + d.head.h / 2, created.y + created.lineOffset);
    assert.equal(d.life.y1, d.head.y + d.head.h);
    assert.equal(d.life.y2, destroyed.y + destroyed.lineOffset);
    assert.equal(layout.activations[0].y + layout.activations[0].h, d.life.y2);
    assert.equal(d.foot, null);
    assert.match(svg, /Created actors/);
  }
  assert.match(parse('create actor D\nA->>B: wrong').errors[0].message, /must target/);
});

// Only messages consume numbering; an off event leaves subsequent rows unnumbered.
test('autonumber honors start, step and off without covering labels', () => {
  const { layout } = render('autonumber 10 5\nA->>B: first\nNote over B: no number\nA->>A: second\nautonumber off\nB->>A: third');
  assert.deepEqual(layout.events.filter(e => e.kind === 'message').map(e => e.ordinal), ['10', '15', '']);
});

// Four nested levels, three alternative branches and nested RGB regions retain their independent slots and frames.
test('nested fragments, sections and shaded rects render at narrow widths', () => {
  const { layout, svg } = render(`par_over outer
critical critical section
alt primary
rect rgba(40, 50, 60, 0.5)
A->>B: main
end
else retry
A->>B: retry
else skip
B-->>A: skip
else cancel
B-xA: cancel
end
option recover
A->>B: recover
end
and peer
A->>A: peer
end
rect rgb(40, 50, 60)
rect rgb(70, 80, 90)
A->>B: nested
end
end`);
  const branches = layout.events.filter(e => e.keyword === 'else');
  assert.equal(branches.length, 3);
  assert.ok(branches.every(e => e.y > e.host.box.y && e.y < e.host.box.y + e.host.box.h));
  const rects = layout.events.filter(e => e.kind === 'open' && e.type === 'rect');
  assert.ok(rects[2].box.y + rects[2].box.h < rects[1].box.y + rects[1].box.h);
  assert.equal((svg.match(/fill-opacity="0.1"/g) || []).length, 3);
});

// Menus produce one non-blocking diagnostic and cannot introduce links or carry unsafe URL text into the SVG.
test('menu statements accept and ignore URLs', () => {
  const { errors, svg } = render('participant A\nlink A: Unsafe @ javascript:alert(1)\nlinks A: {"Docs": "https://example.test"}');
  assert.deepEqual(errors.map(e => [e.line, e.code, e.severity]), [[3, 'IGNORED_INTERACTION', 'warning']]);
  assert.doesNotMatch(svg, /<a\s|href=|javascript:|example\.test/);
});
