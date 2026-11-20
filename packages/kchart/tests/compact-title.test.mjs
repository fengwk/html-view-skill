import assert from 'node:assert/strict';
import { test } from 'vitest';
import { diagram, diagramTypes } from '../dist/esm/node.js';
import { createContext } from '../src/core/context.js';
import { cropInk } from '../src/core/scene.js';
import { diagramExample } from './helpers/diagram-examples.mjs';
import { checkScene } from './helpers/geometry.mjs';

const opts = { compact: true, frame: false, width: 390 };
const { measureInk, measureRendered } = createContext(opts);
const title = 'Unique sample heading';
const all = node => [node, ...(node.children || []).flatMap(all)];
const translate = node => node.attrs.transform.match(/^translate\((\S+) (\S+)\)$/).slice(1).map(Number);

function checkHeading(source, expected = title, syntax = 'mermaid') {
  const { scene, diagnostics, svg } = diagram(source, { ...opts, syntax });
  assert.ok(svg, JSON.stringify(diagnostics));
  const nodes = all(scene);
  const heading = nodes.filter(node => node.meta?.kind === 'diagram-title');
  assert.deepEqual(heading.map(node => node.text), [expected]);
  assert.equal(nodes.filter(node => node.tag === 'text' && node.text === expected).length, 1);
  assert.equal(heading[0].attrs['font-size'], 14);
  assert.equal(heading[0].attrs['font-weight'], 600);
  assert.equal(heading[0].attrs['text-anchor'], 'start');
  const [group] = scene.children;
  const [header, ...body] = group.children;
  assert.ok(all(header).includes(heading[0]));
  // Compute separate ink boxes under the same outer transform to test alignment and the fixed leading gap.
  const bounds = children => {
    const measured = cropInk({ ...scene, children: [{ ...group, children }] }, measureInk, { fullText: true });
    const [dx, dy] = translate(measured.children[0]);
    return { dx, dy, height: measured.height };
  };
  const head = bounds([header]), art = bounds(body);
  const unshiftedArt = cropInk({ ...scene, children: body }, measureInk, { fullText: true });
  const [artX] = translate(unshiftedArt.children[0]);
  const [outerX] = translate(group);
  // The separately cropped header has 1 px padding; the rest of the difference is body stroke allowance.
  const pad = 1 + art.dx - head.dx;
  assert.ok(Math.abs(artX - outerX) < 1e-8);
  assert.ok(Math.abs((pad - art.dy) - (1 - head.dy + head.height - 2) - 8) < 1e-8);
  assert.deepEqual(checkScene(scene, { measure: measureRendered }).filter(issue => issue.kind === 'text-outside'), []);
  return svg;
}

for (const { kind, aliases } of diagramTypes) {
  test(`compact ${kind} shows one shared front-matter heading`, () => {
    // Give one runnable example of every registered kind an explicit unique title.
    const [syntax, example] = diagramExample([kind, ...aliases]);
    const source = /^---\r?\n/.test(example) ? example.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (_, yaml) =>
      `---\n${yaml.replace(/^title:.*\n?/m, '')}\ntitle: ${title}\n---`) : `---\ntitle: ${title}\n---\n${example}`;
    checkHeading(source, title, syntax);
    for (const options of [{ compact: true, frame: true }, { compact: false, frame: false }, { compact: false, frame: true }]) {
      const regular = diagram(source, { ...options, syntax, width: opts.width });
      assert.ok(regular.svg);
      assert.doesNotMatch(regular.svg, /data-kc-kind="diagram-title"/);
    }
  });
}

test('body titles, accessible titles and numeric subtitles remain distinct', () => {
  // Body-only headings previously disappeared for sequence and were drawn by the Venn family itself.
  const sequence = checkHeading('sequenceDiagram\n    accTitle: Spoken caption\n    title Body caption\n    A->>B: hello', 'Body caption');
  assert.match(sequence, /<title id="[^"]+">Spoken caption<\/title>/);
  for (const kind of ['zenuml', 'eventmodeling', 'treeView-beta', 'venn-beta', 'wardley-beta', 'cynefin-beta']) {
    const [syntax, source] = diagramExample([kind]);
    const titled = source.replace('\n', '\ntitle Body caption\n');
    const svg = checkHeading(titled, 'Body caption', syntax);
    // Preserve the existing accessible fallback even when tree view has a visible authored heading.
    if (kind === 'treeView-beta') assert.match(svg, /<title id="[^"]+">treeView-beta<\/title>/);
  }
  const chart = checkHeading('xychart-beta\n    title "Body caption"\n    x-axis [A, B]\n    y-axis "Seconds" 0 --> 10\n    bar [2, 4]', 'Body caption');
  assert.match(chart, /<text [^>]+>Seconds<\/text>/);
});

test('long compact headings wrap at the layout width rather than the drawing width', () => {
  // A tiny graph must not force its heading to wrap to the node width.
  const text = 'A long heading that runs across several lines in a narrow host';
  const { scene } = diagram(`---\ntitle: ${text}\n---\nflowchart LR\nA`, { ...opts, width: 180 });
  const lines = all(scene).filter(node => node.meta?.kind === 'diagram-title');
  assert.ok(lines.length > 1);
  assert.equal(lines.map(node => node.text).join(' '), text);
  assert.ok(scene.width <= 180);
});
