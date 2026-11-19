import assert from 'node:assert/strict';
import test from 'node:test';
import { fences } from '../../conformance/extract.mjs';

// Proves that IDs can use first-source line numbers and embedded fences stay literal.
test('extracts closed fences with their info strings and first source lines', () => {
  const sample = [
    '# Example',
    '````markdown',
    '```mermaid',
    'graph TD',
    '```',
    '`````',
    '  ~~~mermaid-example  title=demo  ',
    '  graph LR',
    '    A --> B',
    '  ~~~',
    '``` mermaid-nocode',
    'pie',
    '```',
    '```mermaid',
    'not closed',
  ].join('\r\n');
  assert.deepEqual([...fences(sample)], [
    { line: 3, info: 'markdown', source: '```mermaid\ngraph TD\n```' },
    { line: 8, info: 'mermaid-example  title=demo', source: 'graph LR\n  A --> B' },
    { line: 12, info: 'mermaid-nocode', source: 'pie' },
  ]);
});
