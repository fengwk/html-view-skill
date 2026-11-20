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

// Intent: the registry passes merged config and accessibility text; C4's update macro still takes precedence.
test('C4 honors directive and front-matter row configuration', () => {
  const source = `---
config:
  c4:
    c4ShapeInRow: 1
---
%%{init: {'c4': {'c4ShapeInRow': 2}}}%%
C4Context
accTitle: Service topology
accDescr: The three systems
System(a, A)
System(b, B)
System(c, C)`;
  const { svg, scene, diagnostics } = render(source);
  assert.deepEqual(diagnostics.filter(d => d.code === 'IGNORED_CONFIG'), []);
  assert.match(svg, /<title[^>]*>Service topology<\/title>/);
  assert.match(svg, /<desc[^>]*>The three systems<\/desc>/);
  const rows = value => walk(value).filter(n => n.meta?.kind === 'node').map(n => n.attrs.y);
  const [a, b, c] = rows(scene);
  assert.equal(a, b);
  assert.ok(c > b);
  assert.equal(new Set(rows(render(`${source}\nUpdateLayoutConfig(3)`).scene)).size, 1);
});

// Intent: C4 consumes presentation syntax using the shared roles, safe links, icon lookup and text normalization.
test('C4 presents semantic styles and safe links without retaining unknown assets', () => {
  const { scene, diagnostics } = render(`C4Context
System(a, "fa:fa-user <b>Bank</b> &amp; Trust"):::custom
System(b, "Billing ::icon(tabler:c4-unknown-asset)")
Rel(a, b, "Pays<br/>online")
classDef custom fill:red;stroke:red
linkStyle 0 stroke:blue
click a href "https://example.org" "Bank" _blank
click b href "javascript:alert(1)"`);
  const all = walk(scene);
  const a = all.find(node => node.meta?.id === 'a');
  const b = all.find(node => node.meta?.id === 'b');
  assert.notEqual(a.attrs.stroke, b.attrs.stroke);
  assert.notEqual(a.attrs.stroke, 'red');
  assert.notEqual(all.find(node => node.meta?.kind === 'edge').attrs.stroke, 'blue');
  assert.ok(['Bank & Trust', 'Billing', 'Pays', 'online'].every(text => all.some(node => node.text === text)));
  assert.equal(all.filter(node => node.meta?.kind === 'icon').length, 1);
  assert.deepEqual(all.filter(node => node.tag === 'a').map(node => node.attrs.href), ['https://example.org']);
  assert.deepEqual(diagnostics.map(d => d.code).sort(), ['IGNORED_ASSET', 'IGNORED_INTERACTION']);
});

// Intent: omitted lang lets the registry infer the language of C4's built-in stereotypes from the source.
test('C4 element types follow the inferred diagram language', () => {
  for (const [labels, expected] of [
    [['Customer', 'Banking System', 'Payments API'], ['[Person]', '[Software System]', '[Container: HTTP]']],
    [['客户', '银行系统', '支付接口'], ['[人员]', '[软件系统]', '[容器：HTTP]']],
  ]) {
    const { scene, diagnostics } = diagram(`C4Container\nPerson(p, "${labels[0]}")\nSystem(s, "${labels[1]}")\nContainer(c, "${labels[2]}", HTTP)`, { width: 800 });
    assert.ok(scene, JSON.stringify(diagnostics));
    const stereotypes = walk(scene).filter(node => node.tag === 'text' && node.text.startsWith('[')).map(node => node.text);
    assert.deepEqual(stereotypes, expected);
  }
});

// Default frame types follow the diagram language like element types; a type the author writes is kept.
test('default boundary and node types follow the diagram language', () => {
  const source = 'C4Deployment\nDeployment_Node(edge, "Edge") {\n  System_Boundary(sys, "Shop") {\n    Container(app, "App", "Web")\n  }\n}\nDeployment_Node(cloud, "Cloud", "Kubernetes") {\n  Container(api, "API", "Node.js")\n}';
  const stereotypes = lang => walk(diagram(source, { width: 900, frame: false, lang }).scene)
    .filter(node => node.tag === 'text' && node.text.startsWith('[')).map(node => node.text);
  // Frames are drawn before the cards inside them.
  assert.deepEqual(stereotypes('zh-CN'), ['[节点]', '[系统]', '[Kubernetes]', '[容器：Web]', '[容器：Node.js]']);
  assert.deepEqual(stereotypes('en'), ['[Node]', '[System]', '[Kubernetes]', '[Container: Web]', '[Container: Node.js]']);
});

// A label wider than the default gutter used to sit across both deployment-node borders; the gap now grows to hold it.
test('a relationship label between side-by-side frames fits in the gap between them', () => {
  const source = 'C4Deployment\nDeployment_Node(cloud, "Cloud", "Kubernetes") {\n  Container(api, "API", "Node.js")\n}\nDeployment_Node(shop, "Shop", "Tablet") {\n  Container(screen, "Screen", "Web")\n}\nRel(api, screen, "Pushes tickets over", "WebSocket")';
  const nodes = walk(render(source, 800).scene);
  const frames = nodes.filter(node => node.meta?.kind === 'frame').map(node => node.attrs);
  const plate = nodes.find(node => node.meta?.kind === 'edge-label-group').children[0].attrs;
  assert.equal(frames.length, 2);
  const [left, right] = frames.sort((a, b) => a.x - b.x);
  assert.ok(plate.x >= left.x + left.width && plate.x + plate.width <= right.x, JSON.stringify({ left, right, plate }));
  assert.equal(nodes.filter(node => node.meta?.kind === 'leader').length, 0);
});
