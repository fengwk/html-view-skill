import { test } from 'vitest';
import assert from 'node:assert/strict';
import { implementations } from '../src/diagram/sequence.js';
import { diagram } from '../dist/esm/node.js';
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
    const reverseShape = { top: 'bottom', bottom: 'top', 'stick-top': 'stick-bottom', 'stick-bottom': 'stick-top' };
    assert.equal(attrs['marker-start'], start ? marker(reverseShape[start] || start) : undefined);
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

// Creation arrows meet the facing card edge on-row and use ordinary lifeline clearance off-row.
test('create message attachment follows the receiving head geometry', () => {
  for (const width of [800, 360]) {
    const { layout, scene } = render('participant A\ncreate participant B\nA->>B: create', width);
    const target = layout.actors[1];
    const routeOf = result => result.children.find(node => node.meta?.kind === 'message');
    const attached = routeOf(scene);
    assert.equal(attached.attrs.x2, target.head.x);
    assert.ok(attached.attrs.y2 > target.head.y && attached.attrs.y2 < target.head.y + target.head.h);
    assert.ok(scene.children.indexOf(attached) > scene.children.findIndex(node => node.meta?.id === 'B'));
    // Move the box to an earlier row, leaving the lifeline as the only attachment.
    target.head.y = attached.attrs.y2 - target.head.h - 24;
    const offRow = engine.scene(layout, createContext({ width, theme: 'paper' }));
    assert.equal(routeOf(offRow).attrs.x2, target.x - 12);
  }
});

// A wide pair keeps a short message on one line; a truly narrow pair wraps and preserves explicit breaks.
test('message wrapping uses the final lifeline span', () => {
  const source = 'participant A\nparticipant B\nparticipant C\nparticipant D\nA->>B: Fine, thank you. And you?\nC->>D: Hello John, how are you?<br>Next';
  const rows = width => render(source, width).layout.events.filter(e => e.kind === 'message').map(e => e.lines);
  assert.deepEqual(rows(800), [['Fine, thank you. And you?'], ['Hello John, how are you?', 'Next']]);
  assert.ok(rows(360)[0].length > 1);
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
  assert.ok(rects[1].box.x < rects[2].box.x && rects[2].right < rects[1].right);
  assert.equal((svg.match(/fill-opacity="0.1"/g) || []).length, 3);
});

// Menu links skip unsafe entries and keep only the first safe URL for each participant.
test('menu statements link participant cards without rendering a menu', () => {
  const { errors, svg } = render(`participant A
participant B
link A: Unsafe @ javascript:alert(1)
links A: {"Unsafe": "//bad.test", "Docs": "https://example.test", "Later": "/later"}
link A: Other @ /other
link B: Guide @ /guide#start`);
  assert.deepEqual(errors.map(e => [e.line, e.code, e.severity]), [[4, 'IGNORED_INTERACTION', 'warning']]);
  assert.match(svg, /<a href="https:\/\/example.test"/);
  assert.match(svg, /<a href="\/guide#start"/);
  assert.match(svg, /text-decoration="underline"/);
  assert.doesNotMatch(svg, /javascript:|bad\.test|\/later|\/other/);
});

// Reverse endpoint order and intervening participants do not change the note's padded span.
test('notes span all lifelines between their endpoints', () => {
  for (const width of [360, 800]) {
    const { layout } = render('participant A\nparticipant B\nparticipant C\nNote over C,A: shared', width);
    const { note } = layout.events.find(e => e.kind === 'note');
    assert.equal(note.x, layout.actors[0].x - 12);
    assert.equal(note.x + note.w, layout.actors[2].x + 12);
  }
});

// The public registry passes configuration and styles through to the sequence renderer, not just its parser.
test('shared config, styling, links and label assets work through diagram()', () => {
  const { svg, scene, diagnostics } = diagram(`---
config:
  sequence:
    mirrorActors: false
    showSequenceNumbers: true
---
sequenceDiagram
participant A::icon(tabler:database) as <b>Source</b>
participant B:::ok as fa:fa-nonexistent-sequence-icon Sink
classDef alert fill:#ff0000
class A alert
style B fill:#00ff00
click A href "/docs"
linkStyle 0 stroke:#0000ff
rect rgb(255, 0, 0)
A->>B: fa:fa-user <i>Hello</i> &amp; #9829;
end
rect rgb(80, 80, 80)
B->>A: done
end`, { width: 360, theme: 'paper', lang: 'en' });
  assert.deepEqual(diagnostics.map(d => d.code).sort(), ['IGNORED_ASSET', 'IGNORED_STYLE']);
  assert.deepEqual(checkScene(scene), []);
  const ctx = createContext({ width: 360, theme: 'paper' });
  const nodes = [];
  const visit = node => { nodes.push(node); node.children?.forEach(visit); };
  scene.children.forEach(visit);
  const frames = nodes.filter(n => n.meta?.kind === 'frame');
  assert.deepEqual(frames.map(n => n.children[0].attrs.fill), [ctx.design.danger, ctx.design.fg4]);
  const actors = nodes.filter(n => n.meta?.kind === 'participant');
  assert.equal(actors.length, 2);
  assert.equal(actors[0].children[0].attrs.stroke, ctx.frameTone(ctx.design.danger));
  assert.equal(actors[1].children[0].attrs.stroke, ctx.frameTone(ctx.design.ok));
  assert.ok(actors[0].children.some(n => n.attrs.transform?.includes('scale(')));
  assert.ok(!actors[1].children.some(n => n.attrs.transform?.includes('scale(')));
  assert.equal(nodes.find(n => n.meta?.kind === 'message').attrs.stroke, ctx.design.info);
  assert.ok(nodes.some(n => n.meta?.kind === 'message-label' && n.text === '1'));
  assert.match(svg, /href="\/docs"/);
  assert.match(svg, /Hello &amp; ♥/);
});

// At the raised limits the scene scrolls instead of clipping stacked bars or participant heads.
test('20 participants and 200 messages render with a single width warning', () => {
  const actors = Array.from({ length: 20 }, (_, i) => `participant P${i}`);
  const calls = Array.from({ length: 200 }, (_, i) => i < 8 ? 'P19->>+P0: start' : 'P0->>P19: work');
  const { layout, scene } = render(['title: Work queue', ...actors, ...calls].join('\n'));
  assert.equal(scene.heading, 'Work queue');
  assert.deepEqual(layout.errors.map(e => e.code), ['LARGE_DIAGRAM']);
  assert.equal(layout.actors.length, 20);
  assert.equal(layout.events.filter(e => e.kind === 'message').length, 200);
  assert.ok(layout.activations.every(bar => bar.x >= 0 && bar.y + bar.h === layout.actors[0].life.y2));
  assert.match(parse([...actors, ...Array(501).fill('P0->>P19')].join('\n')).errors[0].message, /500/);
});
