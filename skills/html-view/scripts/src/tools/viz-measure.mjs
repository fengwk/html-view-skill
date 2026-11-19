import { fallbackMeasure, wrapText } from '../../../vendor/kchart/esm/core/text.js';
import { parseArgs } from '../shared/args.mjs';
import { emit, fail } from '../shared/output.mjs';

const USAGE = 'htmlview viz measure <text>… [--size <px>] [--weight <n>] [--max-width <px>]';
const options = {
  size: { type: 'string', default: '13' },
  weight: { type: 'string', default: '400' },
  'max-width': { type: 'string' },
};

export async function run(argv) {
  const { values, positionals } = parseArgs(argv, options, { positionals: [1, Infinity], usage: USAGE });
  const size = Number(values.size), weight = Number(values.weight);
  const maxWidth = values['max-width'] === undefined ? undefined : Number(values['max-width']);
  if (!Number.isFinite(size) || size < 12) fail('USAGE', '--size 必须是至少 12 的有限数值', { next: '图内文字最小为 12px；请使用 --size 12 或更大字号。' });
  if (!Number.isFinite(weight) || weight <= 0) fail('USAGE', '--weight 必须是正数', { next: USAGE });
  if (maxWidth !== undefined && (!Number.isFinite(maxWidth) || maxWidth <= 0)) fail('USAGE', '--max-width 必须是正数', { next: USAGE });

  const itemOf = (text) => ({ text, width: Math.ceil(fallbackMeasure(text, size, weight)) });
  const items = positionals.map((text) => ({
    ...itemOf(text),
    ...(maxWidth === undefined ? {} : { lines: wrapText(text, maxWidth, { size, weight }).map(itemOf) }),
  }));
  emit({ size, weight, items });
}
