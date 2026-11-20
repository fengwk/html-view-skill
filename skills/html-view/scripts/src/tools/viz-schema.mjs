import { parseArgs } from '../shared/args.mjs';
import { emit, fail } from '../shared/output.mjs';
import { catalog, schema } from '../../../vendor/kchart/esm/node.js';

const USAGE = 'htmlview viz schema [chart]';

export async function run(argv) {
  const { positionals } = parseArgs(argv, {}, { positionals: [0, 1], usage: USAGE });
  const [chart] = positionals;
  if (chart === undefined) return emit({ schema: schema() });
  const contract = catalog[chart];
  if (!contract) fail('USAGE', `未知图型：${chart}`, { next: '运行 htmlview viz schema 查看已登记的图型名。' });
  return emit({ contract, schema: schema(chart) });
}
