import assert from 'node:assert/strict';
import { test } from 'vitest';
import corpus from './conformance/mermaid-12.3.0.json';
import { diagram } from '../dist/esm/node.js';
import { implementations } from '../src/diagram/usecase.js';
import { checkScene } from './helpers/geometry.mjs';

const parse = body => implementations['usecase-beta'].parse(body, { params: '', firstLine: 2, lang: 'en' });
const render = (body, width = 360) => diagram(`usecase-beta\n${body}`, { width, lang: 'en' });

// Forward references unify with explicit actor and use-case declarations, and a later assignment changes the generated system ID.
test('resolves forward declarations and late package metadata', () => {
  const source = `Clerk --> Authorize\nsystemBoundary "Payment service"\nactor Clerk("Payment clerk")\nAuthorize("Authorize payment")\nend\nPayment_service@{ type: package }`;
  const { model, errors } = parse(source);
  assert.deepEqual(errors, []);
  assert.deepEqual(model.nodes.map(n => [n.id, n.kind, n.parent]), [['Clerk', 'actor', 'Payment_service'], ['Authorize', 'usecase', 'Payment_service']]);
  assert.equal(model.boundaries[0].package, true);
  const result = render(source);
  assert.deepEqual(checkScene(result.scene), []);
  assert.match(result.svg, /<path[^>]*data-kc-kind="frame"/);
});

// Each association operator preserves its marker end; a textual “include” does not become a dependency.
test('maps association, dependency and generalization operators without changing their semantics', () => {
  const { model, errors } = parse(`actor User, Support\nUser --> Start\nStart <-- Support\nStart -- Finish\nUser --o Start\nStart o-- Support\nUser --x Finish\nFinish x-- Support\nUser -- "include account details" --> Login\nStart ..> : include Finish\nFinish ..> : extend Start\nUser --|> Support`);
  assert.deepEqual(errors, []);
  assert.deepEqual(model.edges.map(e => [e.start, e.end, e.label]), [
    [null, 'arrow', ''], ['arrow', null, ''], [null, null, ''], [null, 'circle', ''], ['circle', null, ''],
    [null, 'cross', ''], ['cross', null, ''], [null, 'arrow', 'include account details'],
    [null, 'arrow', '«include»'], [null, 'arrow', '«extend»'], [null, 'triangle', ''],
  ]);
});

// Edge IDs accept their later metadata, preserve minlen and draw a static relationship.
test('parses explicit edge IDs and animation metadata', () => {
  const body = `actor Customer\nCustomer opens@-- "starts checkout" ---> Checkout\nCheckout pays@..> : include Payment\nopens@{ animation: fast }\npays@{ animate: false }`;
  const { model, errors } = parse(body);
  assert.deepEqual(errors, []);
  assert.deepEqual(model.edges.map(e => [e.id, e.extra]), [['opens', 1], ['pays', 0]]);
  assert.ok(render(body).svg);
});

// JSON rows are ordered lexically, not by JavaScript integer-key enumeration; forward notes retain dotted attachment.
test('flattens lexical JSON paths and resolves a note declared first', () => {
  const source = `direction TB\nnote for Inspect "Read the payload"\nInspect\njson Payload@{\n  "2": "second", "1": "first", "items": [{ "name": "Book" }], "empty": {}, "list": []\n}\nInspect --> Payload`;
  const { model, errors } = parse(source);
  assert.deepEqual(errors, []);
  assert.deepEqual(model.nodes.find(n => n.kind === 'json').rows, [['2', 'second'], ['1', 'first'], ['items[0].name', 'Book'], ['empty', '{}'], ['list', '[]']]);
  const result = render(source);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(checkScene(result.scene), []);
  assert.match(result.svg, /stroke-dasharray="2 4"/);
});

// Actor variants, business markings and literal versus Markdown labels retain their distinct roles.
test('renders variants and physical Markdown line breaks without shrinking text', () => {
  const body = `actor Clerk@{ type: hollow, business: true } <<Employee>>\nactor Lead@{ type: awesome }\nactor Other@{ icon: "not-registered:no-such-uml-icon" }\nReport("\`**Refund**\n#40;partial#41;\`")@{ business: true }\nClerk --> Report\nLead --> Report\nOther --> Report`;
  const parsed = parse(body.replace('**Refund**\n', 'Refund<br>'));
  assert.deepEqual(parsed.model.nodes.filter(n => n.kind === 'actor').map(n => n.variant), ['hollow', 'awesome', 'normal']);
  const result = render(body);
  assert.deepEqual(result.diagnostics.map(d => [d.severity, d.code]), [['warning', 'IGNORED_ASSET']]);
  assert.deepEqual(checkScene(result.scene), []);
  assert.match(result.svg, /Refund<\/text>/);
  assert.match(result.svg, /\(partial\)<\/text>/);
  assert.match(result.svg, /«Employee»/);
});

// Styling an explicit edge ID, safe links, built-in actor icons and configured text size reach the scene.
test('applies shared presentation and bounds use-case font sizes', () => {
  const source = `---\nconfig:\n  usecase:\n    actorFontSize: 16\n    usecaseFontSize: 8\n    diagramPadding: 28\n---\nusecase-beta\nactor Clerk@{ icon: "fa:user" }\nClerk opens@--> Checkout("Review &amp; pay"):::urgent\nclassDef urgent fill:#dc322f\nstyle opens stroke:#268bd2\nclick Checkout href "/orders"`;
  const result = diagram(source, { width: 360, lang: 'en' });
  assert.deepEqual(result.diagnostics.map(item => item.code), ['IGNORED_CONFIG']);
  assert.deepEqual(checkScene(result.scene), []);
  assert.match(result.svg, /data-kc-status="danger"/);
  assert.match(result.svg, /data-kc-status="info"/);
  assert.match(result.svg, /href="\/orders"/);
  assert.match(result.svg, /font-size="16"[^>]*>Clerk/);
  assert.match(result.svg, /font-size="12"[^>]*>Review &amp; pay/);
});

// When the shared router reroutes a long edge, its chip stays on the new horizontal run.
test('reattaches the ordering use-case label to its repaired route', () => {
  const { source } = corpus.find(row => row.id === 'usecase.md:538');
  const { scene } = diagram(source, { width: 800 });
  const walk = item => [item, ...(item.children ?? []).flatMap(walk)];
  const elements = scene.children.flatMap(walk);
  const path = elements.find(item => item.meta?.kind === 'edge' && item.meta.from === 'Customer' && item.meta.to === 'Checkout');
  const chip = elements.find(item => item.meta?.kind === 'edge-label-group' && item.meta.from === 'Customer' && item.meta.to === 'Checkout').children[0].attrs;
  const points = path.attrs.d.split(/[MC]/).filter(Boolean).map(command => command.trim().split(/\s+/).map(Number));
  assert.ok(points.some((segment, i) => {
    if (!i) return false;
    const [x0, y0] = points[i - 1].slice(-2), [x1, y1] = segment.slice(-2);
    return y0 === y1 && y0 === chip.y + chip.height / 2 && Math.min(x0, x1) <= chip.x && Math.max(x0, x1) >= chip.x + chip.width;
  }));
});

// Audit corpus: emphasis is removed, explicit line breaks fit, and only actors retain business strokes.
test('normalizes use-case labels and preserves authored line breaks', () => {
  for (const width of [800, 360]) {
    const svg = id => diagram(corpus.find(row => row.id === `usecase.md:${id}`).source, { width }).svg;
    assert.match(svg(159), />Analyst<\/text>/);
    assert.match(svg(159), />Literal markers<\/text>/);
    assert.doesNotMatch(svg(159), /\*Analyst\*|\*\*Literal markers\*\*/);
    assert.match(svg(170), />with a physical line break<\/text>/);
    assert.doesNotMatch(svg(140), /l11 -15/);
  }
});

// Invalid kind/shape pairings, nesting, and unresolved metadata still produce blocking diagnostics.
test('rejects invalid UML declarations and relationship endpoints', () => {
  for (const input of [
    'systemBoundary Outer\nsystemBoundary Inner\nA\nend\nend',
    'actor User\nUser ..> : include Checkout',
    'actor User\nUser --|> Checkout',
    'A[Box]@{ business: true }',
    'note for Missing "Unresolved"',
    'Missing@{ type: package }',
    'json Invalid@{ key: "not JSON" }',
  ]) {
    const result = render(input);
    assert.equal(result.svg, null, input);
    assert.ok(result.diagnostics.some(d => d.severity === 'error'), input);
  }
});
