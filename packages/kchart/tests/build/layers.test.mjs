import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parseAst } from 'vite';
import { expect, it } from 'vitest';

const src = resolve(import.meta.dirname, '../../src');
const files = readdirSync(src, { recursive: true }).filter(file => file.endsWith('.js'));
const allowed = {
  core: ['core'], chart: ['core', 'chart'], diagram: ['core', 'chart', 'diagram'],
  interaction: ['core'], runtime: ['core', 'chart', 'diagram', 'interaction'],
};
const layer = file => file.split(/[\\/]/)[0].replace(/\.js$/, '');

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else walk(value, visit);
  }
}

// Keeps units within their layers, using only static named imports and exports (except JSON data).
it('enforces the source module boundaries', () => {
  const errors = [];
  for (const file of files) {
    const ast = parseAst(readFileSync(join(src, file), 'utf8'));
    walk(ast, node => {
      if (['ImportExpression', 'ImportNamespaceSpecifier', 'ExportDefaultDeclaration'].includes(node.type)) {
        errors.push(`${file}: ${node.type}`);
      }
    });
    for (const { source } of ast.body.filter(node => node.source)) {
      const specifier = source.value;
      if (file === join('core', 'icon-data.js') && specifier === '../../assets/icons.json') continue;
      const target = relative(src, resolve(src, dirname(file), specifier));
      if (specifier.startsWith('.') && files.includes(target) && (
        allowed[layer(file)]?.includes(layer(target)) || file === 'interaction.js' && target === join('chart', 'fields.js')
      )) continue;
      errors.push(`${file} → ${specifier}`);
    }
  }
  expect(errors).toEqual([]);
});
