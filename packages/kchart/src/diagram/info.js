import { error } from './support.js';

function parse(body, info) {
  const errors = [];
  const issue = line => errors.push(error(info.lang, line, 'info 只接受可选的 showInfo', 'info only accepts the optional showInfo keyword',
    '使用 `info` 或 `info showInfo`', 'Use `info` or `info showInfo`'));
  if (info.params && !/^showInfo$/i.test(info.params)) issue(info.headerLine);
  for (const [i, line] of body.split('\n').entries()) {
    if (line.trim() && !/^showInfo$/i.test(line.trim())) issue(info.firstLine + i);
  }
  return { model: null, errors };
}

function layout(_model, { ctx }) {
  const label = `KChart v${__KCHART_VERSION__}`;
  const width = Math.ceil(ctx.measure(label, 13, 400)) + 24;
  return { scene: { width, height: 40, title: label, children: [ctx.text(12, 24, label, { size: 13, fill: ctx.color('muted') })] } };
}

export const implementations = { info: { parse, layout, optionMode: 'raw' } };
