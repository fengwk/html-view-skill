import { fail, emitError } from '../shared/output.mjs';
import { paperChoices } from '../shared/page-metrics.mjs';
import { THEME_USAGE } from '../shared/theme-options.mjs';

// 中文说明和用法只登记公开路由；模块在命中命令时才加载。
const routes = new Map([
  ['doc new', ['新建阅读文档骨架', `<file> --type <type> --title <标题> ${THEME_USAGE} [--lang <lang>] [--force]`]],
  ['doc build', ['从 Markdown 生成或更新阅读文档', `<source.md> --out <file> [--type <type>] ${THEME_USAGE} [--lang <lang>] [--force]`]],
  ['data init', ['创建可运行的虚构数据包', '<dir>']],
  ['data validate', ['检查数据包、口径和图表，不写文件', '<report.json>']],
  ['data build', ['从数据包生成可核对的报表', `<report.json> --out <file> ${THEME_USAGE} [--lang <lang>] [--force]`]],
  ['ui new', ['创建界面稿骨架', '<file> --title <标题> --device mobile|desktop|responsive --screens <列表> [--fidelity wireframe|mockup] [--brand <色值>] [--scheme light|dark] [--radius <值>] [--density compact|regular] [--lang <lang>] [--force]']],
  ['audit', ['静态审计产物源码', '<file>']],
  ['diff', ['比较两个同类产物的章节、视图或屏幕', '<old> <new>']],
  ['style', ['换主题或重组外壳；单图页从内嵌声明重绘；`--list` 列出主题', `<file> ${THEME_USAGE} [--lang <lang>] [界面稿设计参数] | --list`]],
  ['check', ['在桌面、手机、导出和打印视口检查一个本地 HTML', `<file> [--paper ${paperChoices}]`]],
  ['shot', ['截图，或用选择器截图指定元素', '<file> [--mode screen|export] [--select <css>]… [--section <id>]… [--out <dir>]']],
  ['export', ['导出 PDF 或 PNG', `<file> --format pdf|png [--device desktop|mobile] [--select <css>] [--paper ${paperChoices}] [--out <path>]`]],
  ['embed', ['将本地图片与代码文件内嵌到 HTML', '<file>']],
  ['read', ['读取本地 HTML 的 Markdown 或标题大纲', '<file> [--outline | --section <id>] [--out <file>]']],
  ['viz render', ['把图形声明渲染为独立 SVG 或 HTML', `<source> --out <file.svg|file.html> ${THEME_USAGE} [--width <px>] [--lang <lang>] [--force]`]],
  ['viz schema', ['读取图表 JSON Schema', '[<chart>]']],
  ['viz palette', ['读取主题色角色、结构图配色和手绘 SVG 骨架', THEME_USAGE]],
  ['viz measure', ['估算图内文字宽度与换行', '<text>… [--size <px>] [--weight <n>] [--max-width <px>]']],
]);
const artifactGroups = new Set(['doc', 'data', 'ui']);
const maintenance = new Set(['audit', 'diff', 'style']);
const groups = new Set([...artifactGroups, 'viz']);
const exits = '退出码：0 成功，1 检查有失败项，2 用法或输入错误，3 环境错误，4 内部错误。';

function showHelp(group = null) {
  const entries = [...routes.entries()].filter(([key]) => !group || key === group || key.startsWith(`${group} `));
  const lines = entries.flatMap(([key, [desc, usage]]) => [`  htmlview ${key} ${usage}`, `    ${desc}`]);
  if (group === 'style') lines.push('    界面稿设计参数与 ui new 相同，不接受 --theme 或 --theme-file；报表只能重组外壳或换主题。');
  process.stdout.write(`htmlview · 离线 HTML 文档、数据报表、界面稿与图形\n\n${lines.join('\n')}\n\n${exits}\n`);
}

export async function main(input) {
  try {
    const [group, ...rest] = input;
    if (!group || group === '--help' || group === '-h') return showHelp();
    const grouped = groups.has(group);
    const route = grouped && rest.length && !['--help', '-h'].includes(rest[0]) ? `${group} ${rest[0]}` : group;
    const args = grouped && route !== group ? rest.slice(1) : rest;
    const sentinel = args.indexOf('--');
    const options = sentinel < 0 ? args : args.slice(0, sentinel);
    if (grouped && route === group && !args.length) return showHelp(group);
    if (options.some(value => value === '--help' || value === '-h') && (routes.has(route) || groups.has(route))) return showHelp(route);
    if (!routes.has(route)) fail('USAGE', `未知命令：${route}`, { next: '运行 htmlview --help 查看命令。' });
    if (artifactGroups.has(group)) {
      const { commands } = await import(`../artifacts/${group}/index.mjs`);
      const handler = commands[rest[0]] ?? commands[group]?.[rest[0]];
      return await handler(args);
    }
    if (maintenance.has(group)) {
      const { [group]: run } = await import('../commands/maintenance.mjs');
      return await run(args);
    }
    const { run } = await import(`../tools/${route.replace(' ', '-')}.mjs`);
    return await run(args);
  } catch (error) {
    emitError(error);
  }
}
