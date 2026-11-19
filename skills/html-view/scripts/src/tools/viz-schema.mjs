import { parseArgs } from '../shared/args.mjs';
import { emit } from '../shared/output.mjs';
import { schema } from '../../../vendor/kchart/esm/node.js';

const USAGE = 'htmlview viz schema [chart]';

export async function run(argv) {
  const { positionals } = parseArgs(argv, {}, { positionals: [0, 1], usage: USAGE });
  emit({ schema: schema(positionals[0]) });
}
