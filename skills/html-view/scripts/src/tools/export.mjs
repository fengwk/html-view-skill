// export：导出 PDF（书签、页脚页码）与 PNG 长图 / 元素图。
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { withBrowser } from '../shared/browser.mjs';
import { clampClip, documentSize } from './clip.mjs';
import { parseArgs } from '../shared/args.mjs';
import { emit, fail } from '../shared/output.mjs';
import { isPrintPaper, paperChoices } from '../shared/page-metrics.mjs';
import { preparePrintPage, printClips } from '../shared/render-audit.mjs';
import { screenshotSvg } from './svg-capture.mjs';

const USAGE = `htmlview export <file> --format pdf|png [--device desktop|mobile] [--select <css>] [--paper ${paperChoices}] [--out <path>]`;

export const HELP = `export：给用户的成品：PDF、PNG 长图或单个元素图

用法：
  ${USAGE}

参数：
  <file>             本地 HTML 文件
  --format pdf       print 媒体；preferCSSPageSize、printBackground、按标题生成书签、页脚居中页码；
                     无生效的 @page 时用 A4 竖版、四边 15mm；发现裁切不写 PDF
  --format png       导出模式长图；默认 desktop（1280 宽、2x，按 <main> 横向范围左右各留 32px，页面贴边时以页面背景补齐）
  --device desktop   png 默认设备：1280 宽、2x
  --device mobile    png 移动设备：390 宽、3x；宽表可缩窄，SVG 保持原尺寸
  --paper            只用于 PDF，覆盖 @page 的纸型并使用 15mm 页边距
  --select <css>     每个匹配元素单独导出（desktop、2x，四周各留 16px，页面贴边时以页面背景补齐），只用于 png；选择 SVG 本身可截完整图
  --out <path>       输出文件；多张时为 <去扩展名>-<n>.png

说明：
  先设置 data-mode="export" 并展开 details；截图前等字体与两帧渲染
  SVG 选择器会临时展开滚动祖先并移除 max-width 限制；选择 figure 仍按当前可见区域截图
  默认输出到原文件同目录同名：x.pdf、x.png；单张超过 40000 像素高时按段切开
  截图裁剪范围不超出页面边界：页面贴边的那一侧不额外补空白，留白由页面背景承担
  输出：{"ok":true,"files":[{"file","width","height","bytes"}]}，PDF 的每个文件另给 pages

示例：
  htmlview export docs/example.html --format pdf
  htmlview export docs/example.html --format png --device mobile --out /tmp/example.png

退出码：0 成功；1 打印裁切；2 文件或参数错误；3 环境错误；4 内部错误。
`;

const FORMATS = new Set(['pdf', 'png']);
const DEVICES = {
  desktop: {
    width: 1280, height: 900, deviceScaleFactor: 2, mobile: false,
  },
  mobile: {
    width: 390, height: 844, deviceScaleFactor: 3, mobile: false,
  },
};
const MAX_SLICE_PX = 40000;
const PAGE_MARGIN = 32;
const SELECT_MARGIN = 16;
const HIDDEN_NEXT = '元素在隐藏的屏幕、弹窗或折叠内容里时，确认它在导出状态下可见后再选择；否则换一个选择器';

// Chrome 只在页边距里画页眉页脚；页脚居中显示页码
// 页脚用语跟随页面 <html lang>：英文文档写 Page，其余写「页码」。
const footer = (lang) => `<div style="width:100%;font-size:8px;text-align:center;color:#666">${/^en\b/i.test(lang || '') ? 'Page' : '页码'} <span class="pageNumber"></span> / <span class="totalPages"></span></div>`;

const pngSize = (buffer) => ({ width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) });

/** 读 PDF 的页数与页面尺寸（pt）：Chrome 输出未压缩的对象字典，直接看字节即可。 */
function pdfInfo(buffer) {
  const raw = buffer.toString('latin1');
  const pages = (raw.match(/\/Type\s*\/Page(?![s])/g) || []).length
    || Number((raw.match(/\/Count\s+(\d+)/) || [])[1])
    || 1;
  const box = raw.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
  return {
    pages,
    width: box ? Math.round((Number(box[3]) - Number(box[1])) * 100) / 100 : null,
    height: box ? Math.round((Number(box[4]) - Number(box[2])) * 100) / 100 : null,
  };
}

const defaultPath = (file, extension) => join(dirname(file), parse(file).name + extension);
const numberedPath = (path, index) => join(dirname(path), `${parse(path).name}-${index}.png`);

function protectInput(file, paths) {
  const input = statSync(file);
  for (const path of paths) {
    let output;
    try {
      output = statSync(path, { throwIfNoEntry: false });
    } catch (err) {
      fail('USAGE', `无法检查输出路径 ${path}：${err.message}`, { next: '换一个 --out 路径' });
    }
    if (output && output.dev === input.dev && output.ino === input.ino) {
      fail('USAGE', `不能把导出结果写入源 HTML：${path}`, { next: '为 --out 指定另一个文件' });
    }
  }
}

/** 把整页高度按 MAX_SLICE_PX（输出像素）切段，返回每段的 CSS 坐标与高度。 */
function slice(height, scale) {
  const maxCss = MAX_SLICE_PX / scale;
  const segments = [];
  for (let y = 0; y < height; y += maxCss) {
    segments.push({
      y: Math.round(y * 100) / 100,
      height: Math.round(Math.min(maxCss, height - y) * 100) / 100,
    });
  }
  return segments.length ? segments : [{ y: 0, height }];
}

/** 写输出文件；目录不可写属于用法 / 输入问题，不要误报成浏览器故障。 */
function writeOutput(target, buffer) {
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, buffer);
  } catch (err) {
    fail('USAGE', `无法写入 ${target}：${err.message}`, { next: '换一个 --out 路径，或给目标目录写权限' });
  }
}

async function prepareExport(page) {
  await page.evaluate(`(${async function prepare() {
    document.documentElement.dataset.mode = 'export';
    document.querySelectorAll('details:not(.viz-data)').forEach((item) => { item.open = true; });
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const media = matchMedia('print').matches ? 'print' : 'screen';
    if (window.HtmlViewViz?.relayout) await window.HtmlViewViz.relayout({ media });
    if (window.HtmlViewViz?.ready) await window.HtmlViewViz.ready();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(1))));
    return 1;
  }.toString()})()`);
}

async function settle(page) {
  await page.evaluate(`(${async function wait() {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const media = matchMedia('print').matches ? 'print' : 'screen';
    if (window.HtmlViewViz?.relayout) await window.HtmlViewViz.relayout({ media });
    if (window.HtmlViewViz?.ready) await window.HtmlViewViz.ready();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(1))));
    return 1;
  }.toString()})()`);
}

/** 移动端长图可收窄表格；数据图和结构图保留 1:1，完整图用 --select 选择 SVG。 */
const ZOOM = `(() => {
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (!['auto', 'scroll'].includes(cs.overflowX) || el.querySelector('svg')) continue;
    const available = el.clientWidth;
    const needed = el.scrollWidth;
    if (available > 0 && needed > available + 1) {
      el.style.zoom = String(available / needed);
    }
  }
  return 1;
})()`;

const MEASURE = `JSON.stringify((() => {
  const main = document.querySelector('main') || document.body;
  const rect = main.getBoundingClientRect();
  return {
    x: Math.round(rect.left + scrollX),
    width: Math.round(rect.width),
    height: Math.round(Math.max(document.documentElement.scrollHeight, rect.bottom + scrollY)),
    documentWidth: Math.round(Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)),
  };
})())`;

async function exportPdf(browser, file, out, paper) {
  const target = out ? resolve(out) : defaultPath(file, '.pdf');
  const page = await browser.newPage();
  try {
    const { metrics: livePage, height } = await preparePrintPage(page, pathToFileURL(file).href, paper);
    const failures = await printClips(page, height);
    if (failures.length) return { pass: false, failures, files: [] };
    const params = {
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: footer(await page.evaluate('document.documentElement.lang')),
      generateDocumentOutline: true,
    };
    if (!livePage.hasPage) {
      Object.assign(params, {
        // CDP 的纸面尺寸使用英寸；版心测量使用 CSS px。
        paperWidth: livePage.width / 96,
        paperHeight: livePage.height / 96,
        marginTop: livePage.margin.top / 96,
        marginBottom: livePage.margin.bottom / 96,
        marginLeft: livePage.margin.left / 96,
        marginRight: livePage.margin.right / 96,
      });
    }
    const buffer = await page.printToPDF(params);
    writeOutput(target, buffer);
    return { files: [{ file: target, ...pdfInfo(buffer), bytes: buffer.length }] };
  } finally {
    await page.close();
  }
}

/** 每个匹配元素单独导出（desktop、2x，四周各留 16px）。 */
async function exportSelection(page, file, selector, target) {
  const found = await page.json(`JSON.stringify((() => {
    let nodes;
    try {
      nodes = document.querySelectorAll(${JSON.stringify(selector)});
    } catch (err) {
      return { error: err.message };
    }
    return {
      count: nodes.length,
      boxes: Array.from(nodes).map((node, index) => {
        const rect = node.getBoundingClientRect();
        return {
          index,
          x: Math.round(rect.left + scrollX), y: Math.round(rect.top + scrollY),
          width: Math.round(rect.width), height: Math.round(rect.height),
        };
      }),
    };
  })())`);
  if (found.error) {
    fail('USAGE', `--select 的选择器无法解析：${found.error}`, { next: '换成有效的 CSS 选择器，例如 --select "figure"' });
  }
  if (!found.count) {
    fail('USAGE', `--select 没有匹配到元素：${selector}`, { next: '检查选择器；先 htmlview shot 看清页面结构' });
  }
  if (found.boxes.some((box) => box.width < 1 || box.height < 1)) {
    fail('USAGE', '--select 匹配到了没有可见尺寸的元素', { next: HIDDEN_NEXT });
  }
  const paths = found.boxes.map((_, index) => found.count > 1 ? numberedPath(target, index + 1) : target);
  protectInput(file, paths);
  const files = [];
  const doc = await documentSize(page);
  for (const [index, box] of found.boxes.entries()) {
    const path = paths[index];
    const svg = await screenshotSvg(page, selector, box.index, SELECT_MARGIN);
    const buffer = svg ?? await page.screenshot(clampClip({
      x: box.x - SELECT_MARGIN,
      y: box.y - SELECT_MARGIN,
      width: box.width + SELECT_MARGIN * 2,
      height: box.height + SELECT_MARGIN * 2,
    }, doc));
    writeOutput(path, buffer);
    files.push({ file: path, ...pngSize(buffer), bytes: buffer.length });
  }
  return files;
}

async function exportPng(browser, file, {
  device, select, out,
}) {
  const page = await browser.newPage();
  try {
    // --select 固定 desktop、2x，与 --device 无关
    const deviceSpec = select ? DEVICES.desktop : DEVICES[device];
    await page.setMedia('');
    await page.setViewport(deviceSpec);
    await page.goto(pathToFileURL(file).href);
    await prepareExport(page);
    if (select) return await exportSelection(page, file, select, out ? resolve(out) : defaultPath(file, '.png'));
    if (device === 'mobile') await page.evaluate(ZOOM);
    await settle(page);

    const box = await page.json(MEASURE);
    // 裁剪框越过页面左边界（x<0）时，Chrome 会退回 1x 绘制，图片尺寸却仍乘设备倍数，
    // 内容就只占左上角；这里把裁剪范围限制在页面内，贴边一侧的留白由页面背景承担。
    const left = Math.max(0, box.x - PAGE_MARGIN);
    const width = Math.max(1, Math.min(box.documentWidth, box.x + box.width + PAGE_MARGIN) - left);
    const segments = slice(box.height, deviceSpec.deviceScaleFactor);
    const target = out ? resolve(out) : defaultPath(file, '.png');
    const paths = segments.map((_, index) => segments.length > 1 ? numberedPath(target, index + 1) : target);
    protectInput(file, paths);
    const files = [];
    for (const [index, segment] of segments.entries()) {
      const path = paths[index];
      const buffer = await page.screenshot({
        x: left,
        y: segment.y,
        width,
        height: segment.height,
      });
      writeOutput(path, buffer);
      files.push({ file: path, ...pngSize(buffer), bytes: buffer.length });
    }
    return files;
  } finally {
    await page.close();
  }
}

export async function run(argv) {
  const { values, positionals } = parseArgs(argv, {
    format: { type: 'string' },
    device: { type: 'string' },
    select: { type: 'string' },
    out: { type: 'string' },
    paper: { type: 'string' },
  }, {
    positionals: [1, 1],
    usage: USAGE,
  });
  const format = values.format;
  if (!format || !FORMATS.has(format)) {
    fail('USAGE', format ? `--format 只能是 pdf 或 png，收到：${format}` : '缺少 --format pdf|png', { next: USAGE });
  }
  const device = values.device ?? 'desktop';
  if (!Object.hasOwn(DEVICES, device)) {
    fail('USAGE', `--device 只能是 desktop 或 mobile，收到：${device}`, { next: USAGE });
  }
  if (values.select != null && format === 'pdf') {
    fail('USAGE', '--select 只用于 --format png', { next: '去掉 --select，或改成 --format png' });
  }
  if (values.paper != null && (format !== 'pdf' || !isPrintPaper(values.paper))) {
    fail('USAGE', `--paper ${paperChoices} 只用于 PDF`, { next: USAGE });
  }
  const file = resolve(positionals[0]);
  if (!existsSync(file)) fail('FILE_NOT_FOUND', `文件不存在：${file}`, { next: '确认路径后重试' });
  protectInput(file, [values.out ? resolve(values.out) : defaultPath(file, `.${format}`)]);

  const output = await withBrowser(async (browser) => format === 'pdf'
    ? exportPdf(browser, file, values.out, values.paper)
    : { files: await exportPng(browser, file, { device, select: values.select, out: values.out }) });
  emit(output, output.pass === false ? 1 : 0);
}
