// shot：截首屏和每张图，供 Agent 自查。
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { withBrowser } from '../shared/browser.mjs';
import { clampClip, documentSize } from './clip.mjs';
import { parseArgs } from '../shared/args.mjs';
import { emit, fail } from '../shared/output.mjs';
import { screenshotSvg } from './svg-capture.mjs';

const USAGE = 'htmlview shot <file> [--out <dir>] [--mode screen|export] [--select <css>]... [--section <id>]...';

export const HELP = `shot：给 Agent 自查的截图：首屏、每张 figure，或指定的元素

用法：
  ${USAGE}

参数：
  <file>             本地 HTML 文件
  --out <dir>        输出目录；默认在系统临时目录下新建
  --mode screen      默认；desktop-top.png、mobile-top.png、fig-01.png…
  --mode export      设置 data-mode="export"、展开 details，不截首屏
  --select <css>     只截匹配的元素，替代默认截图；可重复，保持 1:1；选 SVG 本身可截完整图
  --section <id>     只截 id 为该值的元素，替代默认截图；可重复

说明：
  desktop-top.png 是 1280×900 首屏，按 <main> 与首屏内可见宽内容的横向范围裁剪、左右各留 16px（没有 <main> 时用 body；页面贴边时以页面背景补齐）
  mobile-top.png 是 390×844 首屏
  figure 在 1280 宽视口、1x 下截图；figure 的 what 取 figcaption 文字，没有时用 aria-label 或选择器
  选择器直接指向 SVG 时，会临时展开滚动祖先并移除 SVG max-width 限制；选 figure 仍只截当前可见区域
  高于 1500px 的截图分段为 fig-01-1.png、fig-01-2.png…
  --section 的目标是 id 为该值的元素：它是 section / article 的第一个标题时截整个父级，其他标题截到下一个同级或更高级标题之前，其他元素截元素本身；左右各留 16px
  截图裁剪范围不超出页面边界：贴边那一侧不额外补空白
  --section 输出 section-<id>.png，what 用标题文字；能与 --mode export 一起用

输出：{"ok":true,"dir","files":[{"file","what"}]}
示例：htmlview shot docs/example.html --out /tmp/shots
退出码：0 成功；2 文件或参数错误；3 环境错误（找不到浏览器等）；4 CLI 自身缺陷。
`;

const FIG_SLICE = 1500;
const TOP_MARGIN = 16;
const TOP_HEIGHT = 900;
const HIDDEN_NEXT = '元素在隐藏的屏幕、弹窗或折叠内容里时，加 --mode export 再截（导出模式会展开折叠内容，界面稿会把每个屏幕、状态和弹窗单独成图）；否则换一个选择器';

// 注入页面脚本共用：首屏横向范围。<main> 的边框范围并入首屏内可见、且伸出 <main> 的后代节点，
// 这样比 <main> 更宽的图不会被裁掉两侧；被滚动/overflow 祖先裁掉的部分、零尺寸与隐藏节点不计入。
const FIRST_SCREEN_RANGE = `const firstScreenRange = (main) => {
  const base = main.getBoundingClientRect();
  const hidden = (node) => {
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return true;
    const style = getComputedStyle(node);
    return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0;
  };
  // 祖先的 overflow 裁剪框（视口坐标）：只统计真正露在首屏里的部分。
  const clipOf = (node) => {
    let left = -Infinity, right = Infinity, top = -Infinity, bottom = Infinity;
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const rect = parent.getBoundingClientRect();
      left = Math.max(left, rect.left + parent.clientLeft);
      right = Math.min(right, rect.left + parent.clientLeft + parent.clientWidth);
      top = Math.max(top, rect.top + parent.clientTop);
      bottom = Math.min(bottom, rect.top + parent.clientTop + parent.clientHeight);
    }
    return { left, right, top, bottom };
  };
  let left = base.left, right = base.right;
  for (const node of main.querySelectorAll('*')) {
    const rect = node.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    if (rect.top >= ${TOP_HEIGHT} || rect.bottom <= 0) continue;
    // 原始范围已在 <main> 内的节点不需要再看祖先裁剪（裁剪只会更小）。
    if (rect.right <= right && rect.left >= left) continue;
    if (hidden(node)) continue;
    const clip = clipOf(node);
    const visible = {
      left: Math.max(rect.left, clip.left), right: Math.min(rect.right, clip.right),
      top: Math.max(rect.top, clip.top), bottom: Math.min(rect.bottom, clip.bottom),
    };
    if (visible.right <= visible.left || visible.bottom <= visible.top) continue;
    if (visible.top >= ${TOP_HEIGHT} || visible.bottom <= 0) continue;
    left = Math.min(left, visible.left);
    right = Math.max(right, visible.right);
  }
  return { x: Math.round(left + scrollX), width: Math.round(right - left) };
};`;

// 注入页面脚本共用：元素的可见文字，跳过 hidden / aria-hidden / display:none / visibility:hidden 的子树。
// 块级元素前后补空格，避免相邻的图题、副标题等块粘在一起；行内元素按原样连接。
const VISIBLE_TEXT = `const visibleText = (node) => {
  const parts = [];
  const walk = (current) => {
    if (current.nodeType === 3) { parts.push(current.nodeValue); return; }
    if (current.nodeType !== 1) return;
    if (/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(current.tagName)) return;
    if (current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true') return;
    const style = getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    const block = !style.display.startsWith('inline') && style.display !== 'contents';
    if (block) parts.push(' ');
    for (const child of current.childNodes) walk(child);
    if (block) parts.push(' ');
  };
  walk(node);
  return parts.join('').replace(/\\s+/g, ' ').trim();
};`;

async function settlePage(page, exportMode = false) {
  await page.evaluate(`(${async function prepare(exportMode) {
    if (exportMode) {
      document.documentElement.dataset.mode = 'export';
      document.querySelectorAll('details').forEach((item) => { item.open = true; });
    }
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    if (window.HtmlViewViz?.relayout) await window.HtmlViewViz.relayout({ media: 'screen' });
    if (window.HtmlViewViz?.ready) await window.HtmlViewViz.ready();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(1))));
    return 1;
  }.toString()})(${JSON.stringify(exportMode)})`);
}

function partsFor(height) {
  return Math.max(1, Math.ceil(height / FIG_SLICE));
}

export async function run(argv) {
  const { values, positionals } = parseArgs(argv, {
    out: { type: 'string' },
    mode: { type: 'string' },
    select: { type: 'string', multiple: true },
    section: { type: 'string', multiple: true },
  }, {
    positionals: [1, 1],
    usage: USAGE,
  });
  const mode = values.mode ?? 'screen';
  if (!['screen', 'export'].includes(mode)) {
    fail('USAGE', `--mode 只能是 screen 或 export，收到：${mode}`, { next: USAGE });
  }
  const selectors = values.select ?? [];
  const sections = values.section ?? [];
  const file = resolve(positionals[0]);
  if (!existsSync(file)) fail('FILE_NOT_FOUND', `文件不存在：${file}`, { next: '确认路径后重试' });
  const url = pathToFileURL(file).href;
  let dir = values.out ? resolve(values.out) : null;
  const files = [];

  await withBrowser(async (browser) => {
    const page = await browser.newPage();
    try {
      await page.setMedia('');
      await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
      await page.goto(url);
      await settlePage(page, mode === 'export');

      const target = sections.length ? await measureSections(page, sections, file) : null;
      let layout = null;
      let selected = null;
      if (selectors.length) {
        selected = await page.json(`JSON.stringify((() => {
          ${VISIBLE_TEXT}
          const items = [];
          for (const selector of ${JSON.stringify(selectors)}) {
            let nodes;
            try {
              nodes = document.querySelectorAll(selector);
            } catch (error) {
              return { error: error.message, selector };
            }
            if (!nodes.length) return { missing: selector };
            for (const [index, node] of Array.from(nodes).entries()) {
              const rect = node.getBoundingClientRect();
              const caption = node.matches('figure') ? node.querySelector('figcaption') : null;
              const captionText = caption ? visibleText(caption) : '';
              const label = node.getAttribute('aria-label') || node.getAttribute('data-title');
              const text = caption ? captionText : visibleText(node);
              items.push({
                x: Math.round(rect.left + scrollX),
                y: Math.round(rect.top + scrollY),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                what: captionText || label || text || selector + ' #' + (index + 1),
                selector,
                selectorIndex: index,
              });
            }
          }
          return { items };
        })())`);
        if (selected.error) {
          fail('USAGE', `--select 的选择器无法解析：${selected.error}`, { next: '换成有效的 CSS 选择器，例如 --select "figure"' });
        }
        if (selected.missing) {
          fail('USAGE', `--select 没有匹配到元素：${selected.missing}`, { next: '检查选择器；先 htmlview shot 看清页面结构' });
        }
        const empty = selected.items.find((item) => item.width < 1 || item.height < 1);
        if (empty) fail('USAGE', '--select 匹配到了没有可见尺寸的元素', { next: HIDDEN_NEXT });
      } else if (!sections.length) {
        layout = await page.json(`JSON.stringify((() => {
          ${VISIBLE_TEXT}
          ${FIRST_SCREEN_RANGE}
          const main = document.querySelector('main') || document.body;
          const range = firstScreenRange(main);
          const figures = Array.from(document.querySelectorAll('figure')).map((figure, index) => {
            const box = figure.getBoundingClientRect();
            const caption = figure.querySelector('figcaption');
            const label = figure.getAttribute('aria-label') || figure.getAttribute('data-title');
            return {
              x: Math.round(box.left + scrollX),
              y: Math.round(box.top + scrollY),
              width: Math.round(box.width),
              height: Math.round(box.height),
              what: caption ? visibleText(caption) : (label || 'figure:nth-of-type(' + (index + 1) + ')'),
            };
          });
          return {
            main: { x: range.x, width: range.width || 1280 },
            figures,
          };
        })())`);
      }

      if (!dir) dir = mkdtempSync(join(tmpdir(), 'htmlview-shot-'));
      try {
        mkdirSync(dir, { recursive: true });
      } catch (err) {
        fail('USAGE', `无法创建输出目录 ${dir}：${err.message}`, { next: '换一个 --out 目录，或给目标目录写权限' });
      }
      const saveBuffer = async (name, buffer, what) => {
        const path = join(dir, name);
        try {
          writeFileSync(path, buffer);
        } catch (err) {
          fail('USAGE', `无法写入 ${path}：${err.message}`, { next: '换一个 --out 目录，或给目标目录写权限' });
        }
        files.push({ file: path, what });
      };
      const save = async (name, clip, what) => {
        const doc = await documentSize(page);
        await saveBuffer(name, await page.screenshot(clampClip(clip, doc)), what);
      };

      if (target) {
        // 章节是没有边框的文字，紧贴边缘裁会像被切掉：左右各留 16px；越界部分由 save 统一裁到页面内
        for (const item of target.items) {
          const box = { ...item, x: item.x - TOP_MARGIN, width: item.width + TOP_MARGIN * 2 };
          await savePieces(save, `section-${fileSafeId(item.id)}`, box, item.what);
        }
      }
      if (selected) {
        for (const [index, item] of selected.items.entries()) {
          const base = `select-${String(index + 1).padStart(2, '0')}`;
          const svg = await screenshotSvg(page, item.selector, item.selectorIndex);
          if (svg) await saveBuffer(`${base}.png`, svg, item.what);
          else await savePieces(save, base, item, item.what);
        }
      }
      if (!target && !selected && mode === 'screen') {
        const width = layout.main.width + TOP_MARGIN * 2;
        await save('desktop-top.png', {
          x: layout.main.x - TOP_MARGIN, y: 0, width, height: 900,
        }, 'desktop 首屏 1280 视口（按 <main> 与首屏内可见宽内容的横向范围裁剪，左右各留 16px）');

        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
        await page.goto(url);
        await settlePage(page, mode === 'export');
        await save('mobile-top.png', {
          x: 0, y: 0, width: 390, height: 844,
        }, 'mobile 首屏 390 视口');

        await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
        await page.goto(url);
        await settlePage(page, mode === 'export');
        layout = await page.json(`JSON.stringify((() => {
          ${VISIBLE_TEXT}
          return {
            figures: Array.from(document.querySelectorAll('figure')).map((figure, index) => {
              const box = figure.getBoundingClientRect();
              const caption = figure.querySelector('figcaption');
              const label = figure.getAttribute('aria-label') || figure.getAttribute('data-title');
              return {
                x: Math.round(box.left + scrollX),
                y: Math.round(box.top + scrollY),
                width: Math.round(box.width),
                height: Math.round(box.height),
                what: caption ? visibleText(caption) : (label || 'figure:nth-of-type(' + (index + 1) + ')'),
              };
            }),
          };
        })())`);
        await captureFigures(page, layout.figures, dir, files, 'fig', save);
      } else if (!target && !selected) {
        await captureFigures(page, layout.figures, dir, files, 'fig', save);
      }
    } finally {
      await page.close();
    }
  });

  emit({ dir, files });
}

/** 文件名里的 id：保留字母、数字与 _ . -，其余换成连字符。 */
function fileSafeId(id) {
  const name = String(id).replace(/[^\p{L}\p{N}_.-]+/gu, '-').replace(/^[-.]+|[-.]+$/g, '');
  return name || 'target';
}

/**
 * 量出 --section 的目标区域：section / article 的第一个标题用父级，其余标题用标题区间，
 * 其他元素用元素本身；标题区间取区间内可见元素的外接矩形。
 */
async function measureSections(page, ids, file) {
  const found = await page.json(`JSON.stringify((() => {
    ${VISIBLE_TEXT}
    const ids = ${JSON.stringify(ids)};
    const headings = 'h1,h2,h3,h4,h5,h6';
    const all = Array.from(document.body.querySelectorAll('*'));
    const levelOf = (node) => (/^H[1-6]$/.test(node.tagName) ? Number(node.tagName[1]) : 0);
    // 标题文字：去掉指向标题自身的锚点链接（生成器加的 # 装饰）。
    const titleOf = (node) => {
      const copy = node.cloneNode(true);
      for (const link of copy.querySelectorAll('a[href]')) {
        if (node.id && link.getAttribute('href') === '#' + node.id) link.remove();
      }
      return visibleText(copy);
    };
    const union = (nodes) => {
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      for (const node of nodes) {
        const rect = node.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        left = Math.min(left, rect.left + scrollX);
        top = Math.min(top, rect.top + scrollY);
        right = Math.max(right, rect.right + scrollX);
        bottom = Math.max(bottom, rect.bottom + scrollY);
      }
      if (right <= left || bottom <= top) return null;
      return {
        x: Math.round(left),
        y: Math.round(top),
        width: Math.round(right - left),
        height: Math.round(bottom - top),
      };
    };
    const items = [];
    for (const id of ids) {
      const node = document.getElementById(id);
      if (!node) return { missing: id };
      const level = levelOf(node);
      const text = visibleText(node);
      const caption = node.getAttribute('aria-label') || node.getAttribute('data-title');
      let box = null;
      if (!level) {
        box = union([node]);
      } else {
        const parent = node.parentElement;
        const first = parent && /^(SECTION|ARTICLE)$/.test(parent.tagName) ? parent.querySelector(headings) : null;
        if (first === node) {
          box = union([parent]);
        } else {
          const start = all.indexOf(node);
          let stop = all.length;
          for (let index = start + 1; start >= 0 && index < all.length; index += 1) {
            const other = levelOf(all[index]);
            if (other && other <= level) { stop = index; break; }
          }
          box = union(start < 0 ? [node] : all.slice(start, stop));
        }
      }
      if (!box) return { empty: id };
      items.push({ ...box, id, what: level ? titleOf(node) : (caption || text || '#' + id) });
    }
    return { items };
  })())`);
  if (found.missing) {
    fail('USAGE', `找不到 id 为 ${found.missing} 的元素`, {
      next: `先运行 htmlview read ${JSON.stringify(file)} --outline 查看可用 id`,
    });
  }
  if (found.empty) {
    fail('USAGE', `--section ${found.empty} 没有可见尺寸`, { next: HIDDEN_NEXT });
  }
  return found;
}

/** 每张 figure 按 1500px 分段。 */
async function captureFigures(page, figures, dir, files, prefix, save) {
  for (const [index, figure] of figures.entries()) {
    if (figure.width < 1 || figure.height < 1) continue;
    const number = String(index + 1).padStart(2, '0');
    await savePieces(save, `${prefix}-${number}`, figure, figure.what);
  }
}

async function savePieces(save, base, box, what) {
  const parts = partsFor(box.height);
  for (let part = 0; part < parts; part += 1) {
    const name = parts === 1 ? `${base}.png` : `${base}-${part + 1}.png`;
    const height = Math.min(FIG_SLICE, box.height - part * FIG_SLICE);
    const label = parts === 1 ? what : `${what}（第 ${part + 1}/${parts} 段）`;
    await save(name, {
      x: box.x, y: box.y + part * FIG_SLICE, width: box.width, height,
    }, label);
  }
}
