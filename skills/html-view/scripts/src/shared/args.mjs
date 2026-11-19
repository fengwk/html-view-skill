// 参数解析：node:util parseArgs（strict），错误交给共享 output 统一构造。
import { parseArgs as nodeParseArgs } from 'node:util';
import { fail } from './output.mjs';

/**
 * @param {string[]} argv 子命令之后的参数
 * @param {object} options parseArgs 的 options
 * @param {{positionals: [number, number], usage: string}} spec 位置参数个数范围与用法示例
 */
export function parseArgs(argv, options, { positionals: [min, max], usage }) {
  // strict parseArgs 把字符串选项后的负数当成未知选项；先合成 --opt=-1，交给调用方校验取值。
  const normalized = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    const name = arg.startsWith('--') && !arg.includes('=') ? arg.slice(2) : null;
    if (name && options[name]?.type === 'string' && typeof next === 'string' && /^-\d/.test(next)) {
      normalized.push(`${arg}=${next}`);
      i += 1;
    } else {
      normalized.push(arg);
    }
  }
  let parsed;
  try {
    parsed = nodeParseArgs({ args: normalized, options, allowPositionals: true, strict: true });
  } catch (err) {
    fail('USAGE', err.message, { next: usage });
  }
  const count = parsed.positionals.length;
  if (count < min || count > max) fail('USAGE', `位置参数个数不对：收到 ${count} 个`, { next: usage });
  return parsed;
}
