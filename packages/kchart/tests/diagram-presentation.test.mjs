import { expect, test } from 'vitest';
import { parseProps, presentation, roleOfColor, safeHref } from '../src/diagram/presentation.js';
import { createContext } from '../src/core/context.js';
import { renderScene } from '../src/core/svg.js';

function collect(look, statements) {
  statements.forEach((source, i) => expect(look.accept(source, i + 1)).toBe(true));
}

// Cascade resolves forward definitions, the last eligible class, inline classes, and direct styles.
test('node presentation cascade', () => {
  const look = presentation({ lang: 'en' });
  expect(look.accept('A --> B', 1)).toBe(false);
  collect(look, [
    'class A, B first', 'class A,C second', 'classDef first, shared fill:#f00',
    'classDef second background:#0f0', 'classDef default fill:#00f',
    'classDef ext fill:#f00', 'style A stroke:#ff0; background:#f9f;',
    'class C unknown', 'class D ext', 'class G,I shared', 'class I shared,second',
  ]);
  look.addClasses('F', ['first', 'ok'], 12);
  expect(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'I'].map(look.statusOf)).toEqual(['new', 'danger', 'ok', 'ext', 'info', 'ok', 'danger', 'ok']);
  expect(look.diagnostics()).toEqual([]);
});

// Class diagrams consume cssClass with quoted lists but leave class declarations alone.
test('alternate class keyword', () => {
  const look = presentation({ classKeyword: 'cssClass' });
  expect(look.accept('class A', 1)).toBe(false);
  collect(look, ['cssClass "A, B" warn']);
  expect(['A', 'B', 'C'].map(look.statusOf)).toEqual(['warn', 'warn', null]);
});

// Only top-level separators divide properties, including CSS functions, quoted values and Mermaid escapes.
test('parse CSS-like declarations', () => {
  expect(parseProps(' Stroke:rgb(255, 0, 0); font-family:"a,b"; stroke-dasharray:4\\,2')).toEqual({ stroke: 'rgb(255, 0, 0)', 'font-family': '"a,b"', 'stroke-dasharray': '4,2' });
});

// Real OKLCH sectors differ from HSL/HSV sectors (notably cyan and pale blue).
test.each([
  ['#f00', 'danger'], ['#f90', 'warn'], ['#ff0', 'warn'], ['#0f0', 'ok'], ['#0ff', 'ok'], ['#00f', 'info'],
  ['#f0f', 'new'], ['#f9f', 'new'], ['#bbf', 'info'], ['#333', null], ['#f002', null], ['#f003', 'danger'], ['#ff000033', 'danger'],
  ['#00ffff', 'ok'], ['rgba(255,0,0,.1)', null], ['rgb(100% 0 0 / 20%)', 'danger'],
  ['hsl(.333turn 100% 50%)', 'ok'], ['hsla(0, 100%, 50%, .2)', 'danger'], ['rebeccapurple', 'new'],
  ['GOLD', 'warn'], ['transparent', null], ['rgb(30, 40)', null], ['not-a-color', null],
])('maps %s to %s', (color, role) => expect(roleOfColor(color)).toBe(role));

// Neutral/invalid colors and unsupported properties are aggregated at the first occurrence.
test('ignored style and edge cascade', () => {
  const look = presentation({ lang: 'en' });
  collect(look, ['linkStyle default stroke:#0f0', 'linkStyle 0, 2 fill:#00f,stroke:#f00,stroke-width:4',
    'style A fill:#333,stroke:#f00,font-family:serif', 'style B fill:bad,stroke-width:2,stroke-dasharray: 9,5', 'linkStyle 3 stroke:#333']);
  expect([0, 1, 2, 3].map(look.edgeStatusOf)).toEqual(['danger', 'ok', 'danger', 'ok']);
  expect(look.statusOf('A')).toBe('danger');
  expect(look.statusOf('B')).toBeNull();
  expect(look.diagnostics()).toEqual([expect.objectContaining({ severity: 'warning', code: 'IGNORED_STYLE', line: 2, message: 'Ignored styles: stroke-width, fill: #333, font-family, fill: bad, stroke-dasharray, stroke: #333' })]);
});

// All URL spellings populate the same SVG-ready record; callbacks and unsafe links remain nonblocking.
test('links and interactions', () => {
  const look = presentation({ lang: 'en' });
  collect(look, ['click A "https://example.test/path" "Read docs" _blank', 'click B href "../docs" _self',
    'click C mailto:support@example.test', 'link D "#note" "Footnote"', 'href E "/relative"',
    'click F call helper("x y", 2)', 'click G helper "No callback"', 'callback H "other" "Tip"',
    'click I href "javascript:alert(1)"', 'click J "https://example.test" custom']);
  expect(['A', 'B', 'C', 'D', 'E'].map(look.linkOf)).toEqual([
    { href: 'https://example.test/path', tooltip: 'Read docs', target: '_blank' }, { href: '../docs', target: '_self' },
    { href: 'mailto:support@example.test' }, { href: '#note', tooltip: 'Footnote' }, { href: '/relative' },
  ]);
  expect(['F', 'G', 'H', 'I', 'J'].map(look.linkOf)).toEqual(Array(5).fill(null));
  expect(look.diagnostics().map(({ line, code, severity }) => [line, code, severity])).toEqual(
    [6, 8, 9, 10].map(line => [line, 'IGNORED_INTERACTION', 'warning']));
  for (const url of ['http://example.test', 'https://example.test', 'mailto:a@b.test', 'relative', '#id', '?q=new']) expect(safeHref(url)).toBe(url);
  for (const url of ['//example.test', '/\\example.test', 'javascript:alert(1)', 'data:,x', 'file:///tmp/x', 'foo bar', 'java\tscript:x', '\u0001https://example.test', 'https://']) expect(safeHref(url)).toBeNull();
});

// Malformed recognized statements are consumed with positioned errors, not mistaken for nodes.
test('malformed statements', () => {
  const look = presentation({ lang: 'en' });
  collect(look, ['classDef named fill:', 'class A', 'style', 'linkStyle -1 stroke:#f00', 'click A href', 'link A "unterminated']);
  expect(look.diagnostics().map(({ line, severity }) => [line, severity])).toEqual([1, 2, 3, 4, 5, 6].map(line => [line, 'error']));
});

// Constructed and hand-built scenes share link validation, and link attributes do not escape the SVG allowlist.
test('serialize safe SVG links only', () => {
  const ctx = createContext({ width: 120 });
  const svg = renderScene(ctx.scene(40, [ctx.link('https://example.test/?q=url(a)&p=1', [ctx.text(5, 20, 'Read')], { tooltip: 'Read <docs>', target: '_blank' })]));
  expect(svg).toContain('<a href="https://example.test/?q=url(a)&amp;p=1" target="_blank" rel="noopener noreferrer"><title>Read &lt;docs&gt;</title><text ');
  expect(() => ctx.link('javascript:alert(1)', [])).toThrow(/Unsafe SVG link href/);
  const render = (tag, attrs) => renderScene(ctx.scene(40, [{ tag, attrs }]));
  expect(() => render('a', { href: '//example.test' })).toThrow(/Unsafe SVG link href/);
  expect(() => render('a', { href: '/docs', target: '_blank' })).toThrow(/Unsafe SVG link rel/);
  for (const key of ['href', 'style', 'target', 'rel', 'xlink:href']) expect(() => render('g', { [key]: '/docs' })).toThrow(/Unsafe SVG attribute/);
  expect(() => render('a', { href: '/docs', style: 'color:red' })).toThrow(/Unsafe SVG attribute/);
});
