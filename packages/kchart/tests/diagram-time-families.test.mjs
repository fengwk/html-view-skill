import { test } from 'vitest';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createDiagramApi } from '../src/diagram/registry.js';
import { createContext } from '../src/core/context.js';
import { implementations as gantt } from '../src/diagram/gantt.js';
import { implementations as journey } from '../src/diagram/journey.js';
import { implementations as timeline } from '../src/diagram/timeline.js';
import { compileDate, compileAxis, DAY } from '../src/diagram/gantt-date.js';
import { checkScene } from './helpers/geometry.mjs';

const implementations = { ...gantt, ...timeline, ...journey };
const api = createDiagramApi(implementations, Object.keys(implementations).map(kind => ({ kind, syntax: 'mermaid', aliases: [], topic: 'time' })));
const options = { width: 360, lang: 'en', frame: false };
const noErrors = errors => assert.deepEqual(errors.filter(e => e.severity !== 'warning'), []);
function sceneOf(source, opts = {}) {
  const result = api.diagram(source, { ...options, ...opts });
  noErrors(result.diagnostics);
  assert.deepEqual(checkScene(result.scene), []);
  return result.scene;
}
function direct(kind, body, config) {
  const ctx = createContext(options);
  const impl = implementations[kind];
  const parsed = impl.parse(body, { config, lang: 'en' });
  noErrors(parsed.errors);
  const { scene } = impl.layout(parsed.model, { ctx, width: options.width,
    measure: (text, font) => ctx.measure(text, font.size, font.weight) });
  assert.deepEqual(checkScene(scene), []);
  return scene;
}
const texts = scene => scene.children.filter(child => child.tag === 'text');

// Verify strict UTC parsing, civil-date tokens, timestamp units and explicit unsupported-token diagnostics.
test('Gantt date formats are strict and deterministic', () => {
  assert.equal(compileDate('dddd, MMMM Do YYYY hh:mm:ss.SSS A Z').parse('Thursday, February 29th 2024 11:05:06.007 PM +02:30'), Date.UTC(2024, 1, 29, 20, 35, 6, 7));
  assert.equal(compileDate('YYYY-DDD').parse('2024-60'), Date.UTC(2024, 1, 29));
  assert.equal(compileDate('HH:mm').parse('17:49'), (17 * 60 + 49) * 60000);
  assert.equal(compileDate('x').parse('71'), 71);
  assert.ok(Number.isNaN(compileDate('YYYY-MM-DD').parse('2023-02-29')));
  assert.equal(compileAxis('%G-W%V %j %Z %%')(Date.UTC(2021, 0, 1)), '2020-W53 001 +0000 %');
  for (const [directive, token] of [['dateFormat', 'YYYY-WW'], ['dateFormat', 'YYYY-MMMMM-DD'], ['axisFormat', '%K']]) {
    const [error] = api.check(`gantt\n${directive} ${token}\nTask: 2024-01-01, 1d`, options);
    assert.equal(error.line, 2);
    assert.match(error.message, /Unsupported \w+ token:/);
    assert.match(error.fix, /Supported:/);
  }
  const unix = 'gantt\ndateFormat X\naxisFormat %s %%\n71: 0, 71';
  const result = api.parse(unix, options);
  assert.equal(result.model.items[0].endTime, 71000);
  assert.ok(texts(sceneOf(unix)).some(node => node.text === '0 %'));
});

// Fixed durations retain sub-day precision; calendar units clamp at the target month's end.
test('Gantt durations and inclusive explicit end dates', () => {
  const durations = ['1.5d', '24h', '1w', '1M', '1y', '500ms'];
  const { model, diagnostics } = api.parse(`gantt\ninclusiveEndDates\n${durations.map((d, i) => `N${i}: 2024-01-31, ${d}`).join('\n')}\nExplicit: 2024-01-31, 2024-02-01\nLeap: 2024-02-29, 1y`, options);
  noErrors(diagnostics);
  assert.deepEqual(model.items.map(item => item.endTime - item.startTime), [1.5 * DAY, DAY, 7 * DAY, 29 * DAY, 366 * DAY, 500, 2 * DAY, 365 * DAY]);
  assert.equal(model.items.at(-1).end, '2025-02-28');
});

// Resolve multiple references in dependency order, and report a cycle rather than recursing forever.
test('Gantt after uses latest end and until uses earliest start', () => {
  const source = 'gantt\nBefore: b, 2024-01-01, until a c\nAfter: d, after a c, 2d\nA: a, 2024-01-03, 1d\nC: c, 2024-01-05, 2d\nNext: 1d';
  const { model, diagnostics } = api.parse(source, options);
  noErrors(diagnostics);
  assert.equal(model.items[0].end, '2024-01-03');
  assert.equal(model.items[1].start, '2024-01-07');
  assert.equal(model.items.at(-1).start, '2024-01-07');
  assert.match(api.check('gantt\nA: a, after b, 1d\nB: b, after a, 1d', options)[0].message, /a → b → a/);
  const missing = api.parse('gantt\nA: after notFound, 1d', options);
  assert.equal(missing.model.items[0].startTime, 0);
  assert.equal(missing.diagnostics[0].severity, 'warning');
});

// Extend only durations across excluded days, honor overrides, and bound schedules with no available day.
test('Gantt working calendar handles Friday weekends, dates and weekdays', () => {
  const source = 'gantt\nweekend friday\nexcludes weekends, monday, 2024-01-07\nincludes 2024-01-05\nA: 2024-01-04, 2d\nB: 2024-01-04, 2024-01-06';
  const { model, diagnostics } = api.parse(source, options);
  noErrors(diagnostics);
  assert.deepEqual(model.items.map(item => item.end), ['2024-01-09', '2024-01-06']);
  assert.ok(api.check('gantt\nexcludes monday tuesday wednesday thursday friday saturday sunday\nA: 2024-01-01, 1d', options).some(d => d.severity === 'error'));
});

// Keep custom tick alignment, mirror the axis, and place milestone/vertical markers at duration midpoints.
test('Gantt tick intervals, top axis and markers retain their geometry', () => {
  const monthly = 'gantt\naxisFormat %Y-%m-%d\ntopAxis\nA: 2024-01-01, 2024-02-05';
  const tickTexts = scene => texts(scene).filter(t => /^2024-/.test(t.text));
  const custom = tickTexts(sceneOf(monthly.replace('topAxis', 'topAxis\ntickInterval 1month')));
  assert.deepEqual(custom.map(x => x.text), ['2024-01-01', '2024-01-01', '2024-02-01', '2024-02-01']);
  assert.ok(tickTexts(sceneOf(monthly)).length > custom.length);
  const weeks = sceneOf('gantt\nweekday monday\ntickInterval 1week\naxisFormat %a %d\nA: 2024-01-05, 2024-01-19');
  assert.deepEqual(texts(weeks).filter(t => /^Mon /.test(t.text)).map(t => t.text), ['Mon 08', 'Mon 15']);
  const markers = sceneOf('gantt\ndateFormat HH:mm\naxisFormat %H:%M\nA: 00:00, 00:40\nMarker: milestone, 00:10, 20m\nRelease: vert, 00:15, 10m');
  const diamond = markers.children.find(node => node.tag === 'polygon');
  const vertical = markers.children.find(node => node.attrs?.['stroke-dasharray']);
  assert.ok(Math.abs(parseFloat(diamond.attrs.points) - vertical.attrs.x1) < .01);
  assert.equal(markers.children.filter(node => node.meta?.kind === 'node').length, 2);
});

// Today never depends on wall time; compact mode keeps overlapping tasks in distinct lanes.
test('Gantt uses a fixed today marker only and packs free lanes', () => {
  const source = 'section Work\nA: 2024-01-01, 5d\nB: 2024-01-02, 5d\nC: 2024-01-03, 5d\nD: 2024-01-04, 5d\nE: 2024-01-10, 1d';
  const plain = direct('gantt', source);
  const fixed = { gantt: { todayDate: '2024-01-03', displayMode: 'compact' } };
  const packed = direct('gantt', source, fixed);
  const ys = scene => scene.children.filter(n => n.meta?.kind === 'node').map(n => n.attrs.y);
  assert.equal(new Set(ys(plain)).size, 5);
  assert.equal(new Set(ys(packed)).size, 4);
  assert.ok(texts(packed).some(t => t.text === 'Today'));
  assert.ok(!texts(plain).some(t => t.text === 'Today'));
  assert.ok(!texts(direct('gantt', `todayMarker off\n${source}`, fixed)).some(t => t.text === 'Today'));
  const svg = () => api.diagram(`gantt\n${source}`, options).svg;
  assert.equal(svg(), svg());
});

// A compact lane places task captions inside, right, or left of their own mark and reserves each footprint.
test('Gantt compact caption placement favors inside, right, then left', () => {
  const source = '---\ndisplayMode: compact\n---\ngantt\ndateFormat X\naxisFormat %s\nsection Work\nWide: wide, 0, 30\nMid: mid, 38, 0s\nEnding: tail, 100, 0s';
  for (const width of [800, 360]) {
    const scene = sceneOf(source, { width });
    const mark = id => scene.children.find(n => n.meta?.id === id);
    const label = id => texts(scene).find(n => n.meta?.node === id);
    const [wide, mid, end] = ['wide', 'mid', 'tail'].map(mark);
    assert.equal(label('wide').meta.kind, 'node-label');
    assert.ok(label('wide').attrs.x > wide.attrs.x && label('wide').attrs.x < wide.attrs.x + wide.attrs.width);
    assert.equal(label('mid').meta.kind, 'edge-label');
    assert.ok(label('mid').attrs.x > mid.attrs.x + mid.attrs.width);
    assert.equal(label('tail').meta.kind, 'edge-label');
    assert.ok(label('tail').attrs.x < end.attrs.x);
    assert.equal(new Set([wide, mid, end].map(n => n.attrs.y)).size, 1);
  }
});

// Guard the Issue1300 regression using its real front matter and inferred English status text.
test('Gantt compact corpus captions identify the two bars and the milestone', () => {
  const files = JSON.parse(readFileSync(new URL('./conformance/mermaid-12.3.0.json', import.meta.url)));
  const source = files.find(f => f.id === 'gantt.md:524').source;
  for (const width of [800, 360]) {
    const scene = sceneOf(source, { width, lang: undefined });
    const label = name => texts(scene).find(n => n.text === name);
    const mark = id => scene.children.find(n => n.meta?.id === id);
    assert.equal(label('94').meta.node, 'item94');
    assert.equal(label('5').meta.node, 'item5');
    assert.equal(label('0').meta.node, 'item0');
    assert.equal(label('milestone').meta.node, 'item0');
    assert.equal(label('94').attrs.y, mark('item94').attrs.y + 11);
    assert.equal(label('5').attrs.y, mark('item5').attrs.y + 11);
    assert.equal(label('milestone').attrs.x, label('0').attrs.x);
    assert.ok(label('0').attrs.x > label('Issue1300').attrs.x);
  }
});

// Compress many tiny marks against adjacent vertical guides without crossing captions.
test('Gantt compact lanes split when captions compete for the same space', () => {
  const tasks = Array.from({ length: 12 }, (_, i) => `Work ${i}: t${i}, ${i * 8}, 1s`);
  const source = ['---', 'displayMode: compact', '---', 'gantt', 'dateFormat X', 'axisFormat %s', 'Start guide: vert, 0, 0s',
    'Early guide: vert, 3, 0s', 'End guide: vert, 100, 0s', ...tasks].join('\n');
  for (const width of [800, 360]) {
    const scene = sceneOf(source, { width });
    const marks = scene.children.filter(n => n.meta?.kind === 'node');
    const captions = texts(scene).filter(n => n.meta?.node);
    assert.equal(marks.length, tasks.length);
    assert.deepEqual(new Set(captions.map(n => n.meta.node)), new Set(marks.map(n => n.meta.id)));
    const lanes = new Set(marks.map(n => n.attrs.y));
    assert.ok(lanes.size > 1 && lanes.size < tasks.length);
    if (width === 800) {
      const guides = scene.children.filter(n => n.meta?.kind === 'leader' && n.meta.id === 'task2');
      const first = captions.find(n => n.meta.node === 't0');
      assert.equal(guides.length, 2);
      assert.ok(guides[0].attrs.y2 < first.attrs.y && guides[1].attrs.y1 > first.attrs.y);
    }
  }
});

// Keep inline and continued events distinct, including colons without a following space in an event.
test('Timeline TD renders multiline sections and every event in the proper period', () => {
  const source = 'timeline TD\nsection First<br>Phase\nA : One : 10:30 : Three : Four\n: Five\n: Six\nB : Seven';
  const { model, diagnostics } = api.parse(source, options);
  noErrors(diagnostics);
  assert.deepEqual(model.items[0].events, ['One', '10:30', 'Three', 'Four', 'Five', 'Six']);
  const scene = sceneOf(source);
  assert.ok(texts(scene).some(t => t.text === 'Phase'));
  const [a, b] = scene.children.filter(n => /^period:\d+$/.test(n.meta?.id));
  assert.equal(a.attrs.x, b.attrs.x);
  assert.ok(a.attrs.y < b.attrs.y);
  assert.equal(scene.children.filter(n => n.meta?.kind === 'node').length, 9);
  assert.match(api.check('timeline BT\nA : Event', options)[0].message, /LR or TD/);
});

// Preserve source order and width under many LR columns; long labels wrap without reducing their font.
test('Timeline LR widens, wraps and uses single or per-period colors', () => {
  const long = 'Long period label '.repeat(8).trim();
  const singles = `${long} : Event\nB : Other`;
  const colors = scene => scene.children.filter(n => n.meta?.kind === 'node').map(n => n.attrs.stroke);
  assert.equal(new Set(colors(direct('timeline', singles))).size, 2);
  const mono = direct('timeline', singles, { timeline: { disableMulticolor: true } });
  assert.equal(new Set(colors(mono)).size, 1);
  assert.ok(texts(mono).some(t => t.text !== long && t.text.startsWith('Long period')));
  const sections = Array.from({ length: 3 }, (_, i) => `section Stage ${i}\n${Array.from({ length: 5 }, (_, j) => `P${i}${j} : Event`).join('\n')}`).join('\n');
  const scene = sceneOf(`timeline LR\n${sections}`);
  assert.ok(scene.width > 800);
  assert.equal(scene.children.filter(n => n.meta?.kind === 'frame').length, 3);
});

// Retain actor identity across sections and draw distinct sad, neutral and smiling faces including actor-free tasks.
test('Journey shows scores and a shared actor legend with per-task chips', () => {
  const source = 'journey\nsection Work\nDo work: 1: Me, Cat\nWait: 3\nsection Home\nRest: 5: Me';
  const scene = sceneOf(source);
  const names = texts(scene).map(n => n.text);
  assert.equal(names.filter(name => name === 'Me').length, 1);
  const chips = scene.children.filter(n => n.children?.some(child => child.tag === 'circle' && child.attrs.r === 4));
  assert.deepEqual(chips.map(n => n.children.find(child => child.tag === 'title').text), ['Me', 'Cat', 'Me', 'Cat', 'Me']);
  const mouths = scene.children.filter(n => n.tag === 'path');
  assert.deepEqual(mouths.map(n => n.attrs.d.includes('Q')), [true, false, true]);
  const faces = scene.children.filter(n => n.meta?.kind === 'node');
  assert.ok(faces[0].attrs.cx < faces[1].attrs.cx && faces[1].attrs.cx < faces[2].attrs.cx);
  assert.equal(scene.children.filter(n => n.meta?.kind === 'frame').length, 2);
});

// Reject out-of-range scores by line, warn once for decimals, and retain all rows in a narrow long journey.
test('Journey validates scores and scrolls rather than dropping long rows', () => {
  assert.deepEqual(api.check('journey\nZero: 0\nNine: 9', options).map(d => [d.line, d.severity]), [[2, 'error'], [3, 'error']]);
  assert.deepEqual(api.check('journey\nA: 1.5\nB: 2.5', options).map(d => d.code), ['DIAGRAM_HINT']);
  const scene = sceneOf(`journey\nsection A\n${Array.from({ length: 12 }, (_, i) => `A long named task with a detailed description ${i}: 4: Me`).join('\n')}`);
  assert.ok(scene.width > options.width);
  assert.equal(scene.children.filter(n => n.meta?.kind === 'node').length, 12);
});

// Body titles win in the frame and SVG; the independent accessibility title and description still apply.
test('time families prefer their body title', () => {
  for (const [kind, task] of [['gantt', 'A: 2024-01-01, 1d'], ['timeline', 'A : Event'], ['journey', 'A: 3']]) {
    const source = `---\ntitle: Fallback heading\n---\n${kind}\ntitle Body &amp; plan\naccTitle: Accessible title\naccDescr {\n  Details\n}\n${task}`;
    const result = api.diagram(source, { ...options, frame: true });
    noErrors(result.diagnostics);
    assert.equal(result.scene.heading, 'Body & plan');
    assert.equal(result.scene.title, 'Accessible title');
    assert.equal(result.scene.description, 'Details');
    assert.ok(!result.svg.includes('Fallback heading'));
  }
});

// Gantt retains literal percent syntax and trailing statement text, and joins a vertical marker's name and date.
test('Gantt uses a single caption next to a vertical marker', () => {
  const source = 'gantt\ntitle Rollout %% note\ndateFormat YYYY\naxisFormat %y %%\ntopAxis\nTrack: 1900, 1920\n9: vert, 1906, 1s %% not part of a duration';
  const { info, model, diagnostics } = api.parse(source, options);
  noErrors(diagnostics);
  assert.equal(info.title, 'Rollout %% note');
  assert.equal(model.items[1].endTime, model.items[1].startTime);
  assert.ok(diagnostics.some(d => d.code === 'DIAGRAM_HINT' && d.message.includes('1s %%')));
  assert.ok(texts(sceneOf(source)).some(t => t.text === '9 · 06 %'));
});

// Only safe URLs become anchors, even when a Gantt task declares href and call together.
test('Gantt safely handles both click commands and draws calm status bars', () => {
  const source = `gantt\nA: a, 2024-01-01, 1d\nB: active, b, 2024-01-02, 1d\nC: crit, c, 2024-01-03, 1d\nD: done, d, 2024-01-04, 1d\nclick a href "https://example.com/a" call onOpen()\nclick b call onOpen() href "https://example.com/b"\nclick c href "javascript:alert(1)"`;
  const { svg, scene, diagnostics } = api.diagram(source, options);
  noErrors(diagnostics);
  assert.deepEqual(checkScene(scene), []);
  assert.deepEqual(scene.children.filter(n => n.tag === 'a').map(n => n.attrs.href), ['https://example.com/a', 'https://example.com/b']);
  assert.equal(diagnostics.filter(d => d.code === 'IGNORED_INTERACTION').length, 2);
  assert.ok(!/onOpen|javascript:/.test(svg));
  const bars = scene.children.flatMap(n => n.tag === 'a' ? n.children : [n]).filter(n => n.meta?.kind === 'node');
  assert.equal(new Set(bars.map(n => n.attrs.fill)).size, 4);
  assert.ok(bars.every(n => n.attrs.stroke && n.attrs.stroke !== n.attrs.fill));
});

// All three families resolve labels and local icons, apply class status and keep a single warning for repeated missing icons.
test('time families use shared label and presentation rules', () => {
  const fixtures = [
    ['gantt', 'fa:fa-user A &amp; B:::urgent: id, 2024-01-01, 1d\nfa:fa-does-not-exist X: 1d\nfa:fa-does-not-exist Y: 1d', 'id'],
    ['timeline', 'fa:fa-user A &amp; B:::urgent : A\nfa:fa-does-not-exist X : Two\nfa:fa-does-not-exist Y : Three', 'period:0'],
    ['journey', 'fa:fa-user A &amp; B:::urgent: 4: Me\nfa:fa-does-not-exist X: 3\nfa:fa-does-not-exist Y: 2', 'task:0'],
  ];
  for (const [kind, body, id] of fixtures) {
    const source = `${kind}\n${body}\nclassDef urgent fill:#ff0000\nclick ${id} href "https://example.com/"`;
    const { model, diagnostics } = api.parse(source, options);
    noErrors(diagnostics);
    assert.equal(diagnostics.filter(d => d.code === 'IGNORED_ASSET').length, 1);
    const first = (model.items || model.tasks)[0];
    assert.equal(first.name || first.text, 'A & B');
    assert.ok(first.icon, kind);
    assert.equal(first.status, 'danger');
    for (const width of [360, 800]) {
      const scene = sceneOf(source, { width });
      assert.ok(scene.children.some(n => n.tag === 'a' && n.attrs.href === 'https://example.com/'), kind);
    }
  }
});
