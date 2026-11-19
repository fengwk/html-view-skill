// 从正在运行的页面读取 @page 规则，计算打印版心。check 与 export 共用。
// 只在浏览器里读 document.styleSheets，绝不从 HTML 源码或 <script> 字符串里解析 CSS。

const MM = 96 / 25.4;
const PAPER = {
  a3: [297, 420],
  a4: [210, 297],
  a5: [148, 210],
  b4: [250, 353],
  b5: [176, 250],
  letter: [215.9, 279.4],
  legal: [215.9, 355.6],
  tabloid: [279.4, 431.8],
};
// 没有生效的 @page 时，检查和 PDF 都使用 A4 竖版、四边 15mm。
const DEFAULT_MARGIN = 15 * MM;
const DEFAULT_WIDTH = 210 * MM;
const DEFAULT_HEIGHT = 297 * MM;
// @page 存在但没有写 margin 时，沿用 Chrome printToPDF 的默认页边 0.4in（约 1cm），
// 而不是把 15mm 兜底强加给已定义 @page 的页面。
const CHROME_DEFAULT_PAGE_MARGIN = 0.4 * 96;
// 有 @page 但没有 size 时，printToPDF 使用 Chrome 默认纸张 Letter（8.5×11in）。
const CHROME_DEFAULT_PAPER = { width: 8.5 * 96, height: 11 * 96 };

function parseLength(value) {
  const match = /^([\d.]+)\s*(mm|cm|in|pt|pc|px|q)?$/i.exec(String(value).trim());
  if (!match) return null;
  const number = Number(match[1]);
  const unit = (match[2] ?? 'px').toLowerCase();
  const factor = {
    mm: MM, cm: MM * 10, in: 96, pt: 96 / 72, pc: 16, px: 1, q: MM / 4,
  }[unit];
  return Number.isFinite(number) ? number * factor : null;
}

function parsePageSize(value) {
  let text = String(value ?? '').trim().toLowerCase();
  if (!text || text === 'auto') return null;
  const landscape = /\blandscape\b/.test(text);
  const portrait = /\bportrait\b/.test(text);
  text = text.replace(/\b(?:landscape|portrait)\b/g, '').trim();
  let width = null;
  let height = null;
  const named = PAPER[text];
  if (named) {
    [width, height] = named.map((mm) => mm * MM);
  } else {
    const parts = text.split(/\s+/);
    if (parts.length === 2) {
      width = parseLength(parts[0]);
      height = parseLength(parts[1]);
    } else if (parts.length === 1) {
      width = parseLength(parts[0]);
      height = width;
    }
  }
  if (!width || !height) return null;
  if ((landscape && width < height) || (portrait && width > height)) {
    [width, height] = [height, width];
  }
  return { width, height };
}

function defaultMetrics() {
  return {
    hasPage: false,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    margin: {
      top: DEFAULT_MARGIN,
      right: DEFAULT_MARGIN,
      bottom: DEFAULT_MARGIN,
      left: DEFAULT_MARGIN,
    },
    contentWidth: DEFAULT_WIDTH - DEFAULT_MARGIN * 2,
    contentHeight: DEFAULT_HEIGHT - DEFAULT_MARGIN * 2,
  };
}

function applyMarginShorthand(state, value) {
  const values = String(value).trim().split(/\s+/).map(parseLength);
  if (!values.length || values.some((item) => item == null)) return;
  if (values.length === 1) {
    state.margin = {
      top: values[0], right: values[0], bottom: values[0], left: values[0],
    };
  } else if (values.length === 2) {
    state.margin = {
      top: values[0], right: values[1], bottom: values[0], left: values[1],
    };
  } else if (values.length === 3) {
    state.margin = {
      top: values[0], right: values[1], bottom: values[2], left: values[1],
    };
  } else if (values.length >= 4) {
    state.margin = {
      top: values[0], right: values[1], bottom: values[2], left: values[3],
    };
  }
}

/**
 * @param {Array<{size?:string,margin?:string,marginTop?:string,marginRight?:string,
 *   marginBottom?:string,marginLeft?:string}>} rules 按文档顺序读取到的 @page 规则
 */
export function resolvePageMetrics(rules) {
  if (!Array.isArray(rules) || rules.length === 0) return defaultMetrics();

  let size = null;
  const state = {
    margin: {
      top: null, right: null, bottom: null, left: null,
    },
  };
  for (const rule of rules) {
    const parsedSize = parsePageSize(rule.size);
    if (parsedSize) size = parsedSize;
    if (rule.margin) applyMarginShorthand(state, rule.margin);
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const raw = rule[`margin${side[0].toUpperCase()}${side.slice(1)}`];
      if (!raw) continue;
      const parsed = parseLength(raw);
      if (parsed != null) state.margin[side] = parsed;
    }
  }

  const page = size ?? CHROME_DEFAULT_PAPER;
  const margin = {};
  for (const side of ['top', 'right', 'bottom', 'left']) {
    margin[side] = state.margin[side] ?? CHROME_DEFAULT_PAGE_MARGIN;
  }
  const contentWidth = page.width - margin.left - margin.right;
  const contentHeight = page.height - margin.top - margin.bottom;
  if (contentWidth <= 1 || contentHeight <= 1) return defaultMetrics();
  return {
    hasPage: true,
    width: page.width,
    height: page.height,
    margin,
    contentWidth,
    contentHeight,
  };
}

// 页内函数：遍历所有可访问的样式表（包括动态插入的 <style>），跳过跨域样式表。
function collectPageRules() {
  const result = [];
  const seen = new Set();
  const visit = (rules) => {
    for (const rule of rules) {
      try {
        if (rule.media?.mediaText && !matchMedia(rule.media.mediaText).matches) continue;
        if (rule.type === CSSRule.SUPPORTS_RULE && !CSS.supports(rule.conditionText)) continue;
        if (rule.type === 6 || rule.constructor?.name === 'CSSPageRule') {
          const style = rule.style;
          result.push({
            size: style?.getPropertyValue('size') ?? '',
            margin: style?.getPropertyValue('margin') ?? '',
            marginTop: style?.getPropertyValue('margin-top') ?? '',
            marginRight: style?.getPropertyValue('margin-right') ?? '',
            marginBottom: style?.getPropertyValue('margin-bottom') ?? '',
            marginLeft: style?.getPropertyValue('margin-left') ?? '',
          });
          continue;
        }
        if (rule.cssRules) visit(rule.cssRules);
      } catch {
        // @import 跨域或规则不可读时跳过
      }
    }
  };
  const sheets = [...document.styleSheets, ...(document.adoptedStyleSheets ?? [])];
  for (const sheet of sheets) {
    if (!sheet || sheet.disabled || seen.has(sheet)) continue;
    if (sheet.media?.mediaText && !matchMedia(sheet.media.mediaText).matches) continue;
    seen.add(sheet);
    try {
      visit(sheet.cssRules);
    } catch {
      // 跨域样式表：按设计跳过
    }
  }
  return result;
}

/** 读取正在运行页面的全部 @page 规则（含动态插入 <style> 中的规则）。 */
export async function readPageRules(page) {
  const rules = await page.evaluate(`(${collectPageRules.toString()})()`);
  return Array.isArray(rules) ? rules : [];
}

const printPapers = new Map([['a4-landscape', 'A4 landscape'], ['a3-portrait', 'A3 portrait']]);
export const paperChoices = [...printPapers.keys()].join('|');
export const isPrintPaper = name => printPapers.has(name);

// 可选纸型只在当前浏览器页面生效，原 HTML 不变；检查和导出使用同一个覆盖。
export async function applyPrintPaper(page, paper) {
  if (!paper) return;
  const size = printPapers.get(paper);
  if (!size) throw new TypeError(`纸型须为 ${paperChoices}`);
  const rule = `@page { size: ${size} !important; margin: 15mm !important; }`;
  await page.evaluate(`(() => {
    const style = document.createElement('style');
    style.textContent = ${JSON.stringify(rule)};
    document.head.append(style);
  })()`);
}

export { parseLength, parsePageSize };
