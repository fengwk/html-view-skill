import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from '../shared/args.mjs';
import { emit, fail } from '../shared/output.mjs';
import { renderCheck, viewportsFor } from '../shared/render-audit.mjs';
import { isPrintPaper, paperChoices } from '../shared/page-metrics.mjs';

const USAGE = `htmlview check <file> [--paper ${paperChoices}]`;

export async function run(argv) {
  const { positionals, values } = parseArgs(argv, { paper: { type: 'string' } }, { positionals: [1, 1], usage: USAGE });
  if (values.paper != null && !isPrintPaper(values.paper)) fail('USAGE', `纸型须为 ${paperChoices}`, { next: USAGE });
  const file = resolve(positionals[0]);
  const result = await renderCheck(file, { paper: values.paper });
  const total = result.failures.length;
  const failures = result.failures.slice(0, 30);
  const output = {
    pass: total === 0,
    file,
    total,
    checkedViewports: viewportsFor().map(({ id }) => id),
    failures,
    notes: result.notes,
    next: total === 0
      ? `检查通过；需要截图时运行 htmlview shot ${JSON.stringify(file)}`
      : `逐条按 fix 修改后重跑 htmlview check ${JSON.stringify(file)}`,
  };
  if (total > failures.length) {
    const dir = mkdtempSync(join(tmpdir(), 'htmlview-check-'));
    const full = join(dir, 'failures.json');
    writeFileSync(full, JSON.stringify(result.failures, null, 2) + '\n');
    output.details = full;
  }
  emit(output, total === 0 ? 0 : 1);
}
