// stdout 只输出一个 JSON 对象；错误码与 ToolError 在整个 html-view 中只登记一次。
const EXIT_CODES = Object.freeze({
  USAGE: 2, FILE_NOT_FOUND: 2, SOURCE_NOT_FOUND: 2, NODE_TOO_OLD: 3, INTERNAL: 4,
  UNKNOWN_TYPE: 2, UNKNOWN_THEME: 2, FILE_EXISTS: 2, KIND_MISMATCH: 2, SOURCE_MISMATCH: 2,
  BAD_SHELL: 2, NOT_UI: 2, BAD_VALUE: 2, BAD_THEME: 2, BROWSER_NOT_FOUND: 3, BROWSER_FAILED: 3,
  DATA_INTEGRITY: 2, BAD_SCHEMA: 2, BAD_FILE: 2, BAD_PATH: 2, BAD_VIZ: 2, BAD_TEXT: 2,
  DATA: 1, AUDIT: 1, ENVIRONMENT: 3,
});
const INTERNAL_NEXT = '保留错误输出与 stderr，核对目标文件状态后报告给维护者。';

export class ToolError extends Error {
  constructor(code, message, { next, state = 'unchanged', retryable = false, details } = {}) {
    super(message);
    if (!Object.hasOwn(EXIT_CODES, code)) throw new Error(`未登记的错误码：${code}`);
    this.name = 'ToolError';
    this.code = code;
    this.next = next ?? '查看 htmlview --help 或对应子命令的 --help 后重试。';
    this.state = state;
    this.retryable = retryable;
    this.details = details;
  }
}

export function fail(code, message, options) {
  throw new ToolError(code, message, options);
}

export function emit(payload, exit = 0) {
  process.stdout.write(JSON.stringify({ ok: true, ...payload }, null, 2) + '\n');
  process.exitCode = exit;
}

export function emitError(error) {
  const err = error instanceof ToolError
    ? error
    : new ToolError('INTERNAL', `htmlview 内部错误：${error?.message ?? error}`, {
      state: 'unknown', next: INTERNAL_NEXT,
    });
  if (!(error instanceof ToolError)) process.stderr.write(String(error?.stack ?? error) + '\n');
  const payload = { code: err.code, message: err.message, state: err.state, retryable: err.retryable, next: err.next };
  if (err.details) payload.details = err.details;
  process.stdout.write(JSON.stringify({ ok: false, error: payload }, null, 2) + '\n');
  process.exitCode = EXIT_CODES[err.code];
}
