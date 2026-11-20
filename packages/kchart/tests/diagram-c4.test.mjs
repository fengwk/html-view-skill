import assert from 'node:assert/strict';
import { test } from 'vitest';
import { implementations } from '../src/diagram/c4.js';
import { diagram } from '../dist/esm/node.js';
import { checkScene } from './helpers/geometry.mjs';

const parse = (kind, body) => implementations[kind].parse(body, { kind, lang: 'en', firstLine: 2 });
const walk = node => [node, ...(node.children ?? []).flatMap(walk)];
const render = (source, width = 360) => {
  const result = diagram(source, { width, frame: false, lang: 'en' });
  assert.ok(result.svg, JSON.stringify(result.diagnostics));
  assert.deepEqual(checkScene(result.scene), []);
  return result;
};

// Intent: distinguish empty slots, quoted commas, named fields and ignored assets without losing labels.
test('C4 argument slots retain semantic fields and aggregate presentation warnings', () => {
  const { model, errors } = parse('C4Container', `Person(a, "A", , ) %% a comment
Person_Ext(b, "B", $tags="v1.0")
Container_Ext(c, "C %% D", "C#, Xamarin", $descr="Text (with parentheses)")
Boundary(group, "Group", "boundary")
{
  Node_L(n, "N", "Linux")
}
Rel(a, b, "l", $sprite="s")`);
  assert.deepEqual(errors.map(({ code, severity }) => [code, severity]), [['IGNORED_STYLE', 'warning']]);
  assert.match(errors[0].message, /tags, sprite/);
  const [a, , c, group, n] = model.items;
  assert.equal(a.descr, '');
  assert.equal(c.label, 'C %% D');
  assert.equal(c.techn, 'C#, Xamarin');
  assert.equal(c.descr, 'Text (with parentheses)');
  assert.equal(group.type, 'boundary');
  assert.equal(n.parent, 'group');
  assert.equal(n.frame, false);
  assert.equal(n.type, 'Linux');
});

// Intent: nested boundary stack preserves parent identity and reports the actual unclosed declaration.
test('C4 deployment aliases can be frames or standalone elements', () => {
  const body = `Deployment_Node(root, Root) {
  Node_R(host, Host) {
    Node_L(server, Server) {
      Node(db, DB, Linux)
    }
  }
}`;
  const { model, errors } = parse('C4Deployment', body);
  assert.deepEqual(errors, []);
  assert.deepEqual(model.items.map(({ parent, frame }) => [parent, frame]), [[undefined, true], ['root', true], ['host', true], ['server', false]]);
  const { scene } = render(`C4Deployment\n${body}`);
  assert.equal(walk(scene).filter(node => node.meta?.kind === 'frame').length, 3);
  assert.match(parse('C4Deployment', body.slice(0, -1)).errors[0].message, /Unclosed/);
  assert.equal(parse('C4Deployment', body.slice(0, -1)).errors[0].line, 2);
  assert.match(parse('C4Deployment', `${body}\nRel(db, missing, uses)`).errors[0].message, /Undeclared/);
});

// Intent: long and short Rel directions have terminal arrows; Back and BiRel change only the marker ends.
test('C4 relationships render the correct marker ends and number dynamic interactions in declaration order', () => {
  const macros = ['Rel_Up', 'Rel_Down', 'Rel_Left', 'Rel_Right', 'Rel_U', 'Rel_D', 'Rel_L', 'Rel_R', 'Rel_Back', 'BiRel', 'RelIndex'];
  for (const macro of macros) {
    const body = `Person(a, A)\nSystem(b, B)\n${macro}(${macro === 'RelIndex' ? '93, ' : ''}a, b, calls)`;
    const { scene } = render(`C4Dynamic\n${body}`);
    const all = walk(scene);
    assert.deepEqual(all.filter(node => node.meta?.kind === 'relation-marker').map(node => node.meta.end),
      macro === 'BiRel' ? ['start', 'end'] : [macro === 'Rel_Back' ? 'start' : 'end'], macro);
    assert.ok(all.some(node => node.text === '1: calls'), macro);
  }
  const { model } = parse('C4Dynamic', `System(a, A)\nSystem(b, B)\nRelIndex(17, a, b, request)\nRelIndex(2, b, a, response)`);
  assert.deepEqual(model.rels.map(rel => rel.label), ['1: request', '2: response']);
});

// Intent: each row bound applies independently, preserves reading order at both widths and honors a cylinder override.
test('C4 layout respects row counts, shape updates and narrow horizontal scrolling', () => {
  const source = `C4Container
Container(a, A)
Container(b, B)
Container(c, C)
Container(d, D)
Boundary(e, E) { System(x, X) }
Boundary(f, F) { System(y, Y) }
UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
UpdateElementStyle(a, $shape="database")
Rel(a, c, skips B)`;
  for (const width of [360, 800]) {
    const { scene, svg } = render(source, width);
    const all = walk(scene);
    const byId = id => all.find(node => node.meta?.id === id);
    assert.equal(byId('a').tag, 'path');
    assert.equal(byId('b').attrs.y, byId('c').attrs.y);
    assert.ok(byId('b').attrs.x < byId('c').attrs.x);
    assert.ok(byId('d').attrs.y > byId('b').attrs.y);
    assert.equal(byId('e').attrs.x, byId('f').attrs.x);
    assert.ok(byId('e').attrs.y < byId('f').attrs.y);
    assert.ok(scene.width > width);
    assert.equal(svg, render(source, width).svg);
  }
});

// Intent: sibling deployment frames leave a clear in-row gutter for a visible relationship caption.
test('deployment frame labels and relationship technology remain visible', () => {
  const source = `C4Deployment
Deployment_Node(cloud, Cloud, Kubernetes) { Container(api, API, Node.js) }
Deployment_Node(shop, Store, Tablet) { Container(bar, Screen, Web) }
Rel(api, bar, uses, HTTPS)`;
  for (const width of [360, 800]) {
    const all = walk(render(source, width).scene);
    const [a, b] = all.filter(node => node.meta?.kind === 'frame').map(node => node.attrs);
    const plate = all.find(node => node.meta?.kind === 'edge-label-group').children[0].attrs;
    assert.ok(b.x - a.x - a.width >= 24);
    assert.ok(plate.x >= a.x + a.width && plate.x + plate.width <= b.x);
    assert.ok(all.some(node => node.text === '[HTTPS]'));
    assert.ok(all.some(node => node.text === '[Kubernetes]'));
  }
});
