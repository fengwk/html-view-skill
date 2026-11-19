// 渲染检查：把检查脚本注入页面，在 desktop / mobile / export / print 视口下收集失败项。
// 检查等待 KChart ready 与当前媒体重排；同一 code 的同一元素在多个视口出现时合并成一条。
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { withBrowser as defaultWithBrowser } from './browser.mjs';
import { fail } from './output.mjs';
import { contentLineRanges } from './content-regions.mjs';
import { applyPrintPaper, readPageRules, resolvePageMetrics } from './page-metrics.mjs';

const FIX = {
  SMALL_TEXT: '字号至少 12px；SVG 按 1:1 绘制，不靠 viewBox 缩放；放不下时让外层容器横向滚动',
  SVG_TEXT_OVERLAP: '移开或缩短重叠的文字；按 htmlview viz measure 的宽度留出间距，连线标签放在线旁的空白处',
  SVG_TEXT_OVERFLOW: '按 htmlview viz measure 的宽度加宽图形或换行，左右至少留 8px；超出画布时同步加大 svg 的 width、height 和 viewBox',
  SVG_LINE_ON_TEXT: '改走线路绕开文字；连线上的标签放一块 var(--viz-chip) 底框，并写在连线之后',
  SVG_MARKER_MISSING: '把 marker-end 等属性指向本文档里存在的 <marker id>；同一文档内 id 唯一，用图的 id 作前缀',
  SVG_ARROW_HIDDEN: '连线终点停在框边外，并把连线写在它连接的框之后',
  TEXT_CLIP: '扩大文本元素或允许换行；若省略号截断是有意的，在元素上标记 data-allow-truncate',
  LOW_CONTRAST: '加深文字色或减淡底色；正文对比度至少 4.5:1',
  PAGE_OVERFLOW: '找出超宽元素（SVG、表格、长 URL），放进横向滚动容器或改成自适应宽度',
  PRINT_CLIP: '调整表格列宽或换行；宽图可减少类别、缩短期间、拆图或换较窄的布局。必要时用 --paper a4-landscape 或 --paper a3-portrait，不缩小 SVG。',
  PRINT_TALL_FIGURE: '图需要放在同一页。改用 --paper a3-portrait、拆图或单独交付完整 SVG，不缩小图或字号。',
  PRINT_UI_FRAME: '界面稿默认按设备尺寸打印；去掉 --paper，或交付保留交互和滚动的 HTML。',
  PRINT_UI_SCROLL: '更大的纸不会放宽设备画布内部。需要 PDF 时先重排表格或图；否则交付保留滚动的 HTML。',
  SMALL_TARGET: '点击区域至少 24×24px；图标按钮补 padding 或 min-width / min-height',
  CONSOLE_ERROR: '修掉报错的脚本或资源；确认是页面自身问题时再交付',
  BROKEN_ANCHOR: '给目标写明确的 id，或修正 href 中不存在的锚点',
  EXTERNAL_REQUEST: '把外部资源下载到本地并用 htmlview embed 内嵌，或删除外部依赖',
};

/** 每个视口的测量方式。print 的宽度在页面加载后从运行中的 @page 规则读取。 */
export function viewportsFor() {
  return [
    {
      id: 'desktop', width: 1280, height: 900, mobile: false, media: '', prepare: 'screen',
    },
    {
      id: 'mobile', width: 390, height: 844, mobile: false, media: '', prepare: 'screen',
    },
    {
      id: 'export', width: 1280, height: 900, mobile: false, media: '', prepare: 'export',
    },
    {
      id: 'print', prepare: 'print',
    },
  ];
}

// 页内脚本：必须自包含（不能引用模块作用域），返回值是 JSON 字符串。
function inspectPage(options) {
  const root = document.documentElement;
  const failures = [];
  const notes = [];
  const viewport = options.viewport;

  const visible = (el) => {
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility === 'visible' && Number(cs.opacity) > 0;
  };
  const textOf = (el) => {
    const clone = el.cloneNode(true);
    if (clone.querySelectorAll) {
      clone.querySelectorAll('[hidden], [aria-hidden="true"], script, style').forEach((node) => node.remove());
      clone.querySelectorAll('a[href^="#"]').forEach((node) => {
        if (/^[#¶§]+$/.test((node.textContent || '').trim())) node.remove();
      });
    }
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  };

  /* 内容区只识别 htmlview 标记；没有标记时整页都是内容区。 */
  let opening;
  let closing;
  const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue === ' htmlview:content ') opening = node;
    if (node.nodeValue === ' /htmlview:content ') closing = node;
  }
  const hasMarkers = !!(opening && closing);
  const scopeCache = new WeakMap();
  const after = (first, second) => Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  const inContent = (el) => {
    if (!hasMarkers) return true;
    if (scopeCache.has(el)) return scopeCache.get(el);
    const result = after(opening, el) && after(el, closing);
    scopeCache.set(el, result);
    return result;
  };

  const keyOf = (el) => {
    const parts = [];
    for (let node = el; node && node !== root; node = node.parentElement) {
      if (node.id) {
        parts.unshift('#' + node.id);
        break;
      }
      let index = 0;
      let prev = node;
      while ((prev = prev.previousElementSibling)) if (prev.tagName === node.tagName) index += 1;
      parts.unshift(node.tagName.toLowerCase() + ':' + index);
    }
    return parts.join('>');
  };
  const heads = Array.from(document.querySelectorAll('h2'));
  const sectionOf = (el, scope) => {
    let section = null;
    for (const head of heads) {
      if (inContent(head) !== (scope === 'content')) continue;
      if (head.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
        section = textOf(head);
      }
    }
    return section;
  };
  const ancestorLabel = (el) => {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const label = node.getAttribute('aria-label') || node.getAttribute('data-title');
      if (label) return label.replace(/\s+/g, ' ').trim();
    }
    return '';
  };
  const describe = (el) => {
    const text = textOf(el);
    const tag = el.tagName.toLowerCase();
    const cls = el.classList && el.classList.length ? '.' + el.classList[0] : '';
    if (!text) return tag + cls;
    return tag + cls + '「' + text.slice(0, 12) + (text.length > 12 ? '…' : '') + '」';
  };
  const locationOf = (el) => {
    const scope = inContent(el) ? 'content' : 'shell';
    const shot = el.closest('figure.ui-shot');
    const shotCaption = shot?.querySelector(':scope > .ui-shot-caption');
    const label = scope === 'content'
      ? (shotCaption && textOf(shotCaption)) || sectionOf(el, scope) || ancestorLabel(el)
      : '';
    const place = scope === 'shell' ? '外壳' : label;
    return { scope, where: (place ? place + ' › ' : '') + describe(el) };
  };
  // fixFor 选择 FIX 表里的另一条改法；文案只在 Node 侧维护一份。
  const push = (code, el, detail, fixFor, instance = '') => {
    // 手绘图检查定位到文字；其余检查保留已有的图卡定位方式。
    const target = code.startsWith('SVG_') ? el : el.closest('.viz-body, .viz-figure') || el;
    const { scope, where } = locationOf(target);
    failures.push({
      code,
      key: `${fixFor === 'PRINT_TALL_FIGURE' ? 'height:' : ''}${keyOf(target)}${instance ? ':' + instance : ''}`,
      scope,
      where,
      detail,
      ...(fixFor ? { fixFor } : {}),
    });
  };

  /* 颜色与对比度：逐层合成背景后算 WCAG 对比度 */
  const parseColor = (value) => {
    const str = String(value).trim();
    if (str === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    const srgb = str.match(/^color\(srgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)(?:\s*\/\s*([-\d.e]+)(%?))?\s*\)$/);
    if (srgb) {
      const alpha = srgb[4] === undefined ? 1 : (srgb[5] ? Number(srgb[4]) / 100 : Number(srgb[4]));
      return {
        r: Number(srgb[1]) * 255, g: Number(srgb[2]) * 255, b: Number(srgb[3]) * 255, a: alpha,
      };
    }
    if (/^rgba?\(/.test(str)) {
      const nums = str.match(/-?[\d.]+/g) || ['0', '0', '0'];
      return {
        r: +nums[0], g: +nums[1], b: +nums[2], a: nums.length > 3 ? +nums[3] : 1,
      };
    }
    return canvasColor(str);
  };
  // color-mix() 的计算值是 oklab()/oklch() 等写法：交给 1×1 画布换算成 sRGB，而不是逐种语法手写解析。
  let colorCanvas = null;
  const canvasColor = (str) => {
    colorCanvas ||= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    colorCanvas.canvas.width = 1;
    colorCanvas.canvas.height = 1;
    colorCanvas.clearRect(0, 0, 1, 1);
    colorCanvas.fillStyle = '#000';
    colorCanvas.fillStyle = str;
    colorCanvas.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = colorCanvas.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  };
  const isColor = (value) => /^(rgb|color\(|oklab\(|oklch\(|lab\(|lch\(|hsl|hwb\()/.test(String(value).trim());
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (x, y) => {
    const a = lum(x);
    const b = lum(y);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const over = (top, base) => ({
    r: top.r * top.a + base.r * (1 - top.a),
    g: top.g * top.a + base.g * (1 - top.a),
    b: top.b * top.a + base.b * (1 - top.a),
    a: 1,
  });
  const white = { r: 255, g: 255, b: 255, a: 1 };
  const backgroundOf = (el) => {
    let node = el instanceof SVGElement ? (el.closest('svg') || el) : el;
    const layers = [];
    for (; node; node = node.parentElement) {
      const color = parseColor(getComputedStyle(node).backgroundColor);
      if (color.a > 0) {
        layers.push(color);
        if (color.a >= 1) break;
      }
    }
    let base = white;
    if (layers.length && layers[layers.length - 1].a >= 1) base = layers.pop();
    for (let i = layers.length - 1; i >= 0; i -= 1) base = over(layers[i], base);
    // SVG 里压在形状上的文字（热力格、柱内读数）：再叠上文字中心下方最上层的纯色填充。
    if (el instanceof SVGElement) {
      const under = svgUnderlay(el);
      if (under) base = over(under, base);
    }
    return base;
  };
  /** 点是否落在形状及其祖先的 clip-path 裁剪区域内；被裁掉的部分不算文字底色。只支持 userSpaceOnUse（SVG 默认）。 */
  const insideClip = (shape, point) => {
    for (let node = shape; node instanceof SVGGraphicsElement; node = node.parentElement) {
      const id = /url\(["']?#([^"')]+)["']?\)/.exec(getComputedStyle(node).clipPath || '')?.[1];
      const clip = id ? node.ownerSVGElement?.getElementById(id) : null;
      if (!clip || clip.getAttribute('clipPathUnits') === 'objectBoundingBox') continue;
      const local = point.matrixTransform(node.getCTM().inverse());
      const hit = [...clip.querySelectorAll('rect, path, circle, ellipse, polygon')].some((part) => {
        const own = part.transform?.baseVal?.consolidate()?.matrix;
        return part.isPointInFill(own ? local.matrixTransform(own.inverse()) : local);
      });
      if (!hit) return false;
    }
    return true;
  };
  /** 文字中心处、文档顺序在它之前的最后一个纯色填充形状（即紧贴文字下方的那层）；渐变、无填充与被裁掉的部分不算。 */
  const svgUnderlay = (el) => {
    const text = el.closest('text') || el;
    const svg = text.ownerSVGElement;
    if (!svg || typeof text.getBBox !== 'function' || !text.getCTM) return null;
    const box = text.getBBox();
    const textCtm = text.getCTM();
    if (!textCtm || !box.width) return null;
    const center = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(textCtm);
    let found = null;
    for (const shape of svg.querySelectorAll('rect, path, circle, ellipse, polygon')) {
      if (!(text.compareDocumentPosition(shape) & Node.DOCUMENT_POSITION_PRECEDING)) continue;
      if (typeof shape.isPointInFill !== 'function' || !visible(shape)) continue;
      const cs = getComputedStyle(shape);
      if (!isColor(cs.fill)) continue;
      const ctm = shape.getCTM();
      if (!ctm) continue;
      const local = center.matrixTransform(ctm.inverse());
      if (!shape.isPointInFill(local) || !insideClip(shape, center)) continue;
      const fill = parseColor(cs.fill);
      fill.a *= (Number(cs.fillOpacity) || 0) * (Number(cs.opacity) || 0);
      if (fill.a > 0) found = fill;
    }
    return found;
  };

  /* 文字元素：每个含可见文字的元素只算一次 */
  const textElements = () => {
    const found = [];
    const seen = new Set();
    const nodes = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = nodes.nextNode(); node; node = nodes.nextNode()) {
      if (!node.nodeValue.trim()) continue;
      const el = node.parentElement;
      if (!el || seen.has(el)) continue;
      if (el.closest('script, style, noscript, template')) continue;
      if (!visible(el)) continue;
      seen.add(el);
      found.push(el);
    }
    return found;
  };
  const shownSize = (el) => {
    let size = parseFloat(getComputedStyle(el).fontSize);
    if (el instanceof SVGElement) {
      const target = el.closest('text') || el;
      const matrix = target.getScreenCTM ? target.getScreenCTM() : null;
      if (matrix) size *= Math.hypot(matrix.a, matrix.b);
    }
    return size;
  };
  const round = (value) => Math.round(value * 10) / 10;

  if (viewport === 'desktop') {
    const opacityCache = new WeakMap();
    const effectiveOpacity = (el) => {
      if (!el) return 1;
      if (!opacityCache.has(el)) {
        opacityCache.set(el, Number(getComputedStyle(el).opacity) * effectiveOpacity(el.parentElement));
      }
      return opacityCache.get(el);
    };
    const shown = (el) => visible(el) && effectiveOpacity(el) > 0
      && !el.closest('defs, symbol, marker, clipPath, mask, pattern');
    const paintAlpha = (paint) => paint === 'none' || !paint ? 0
      : isColor(paint) || paint === 'transparent' ? parseColor(paint).a : 1;
    const contains = (shape, point) => {
      const { left, right, top, bottom } = shape.box;
      return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom
        && shape.el.isPointInFill(point.matrixTransform(shape.inverse));
    };
    const documentURL = new URL(document.URL);
    documentURL.hash = '';
    const markerId = (value) => {
      const ref = /^url\((?:"([^"]+)"|'([^']+)'|([^\s)]+))\)$/.exec(value);
      if (!ref) return null;
      const address = ref[1] ?? ref[2] ?? ref[3];
      let url;
      try { url = new URL(address, documentURL); } catch { return null; }
      if (!url.hash) return null;
      const hash = url.hash.slice(1);
      url.hash = '';
      if (url.href !== documentURL.href) return null;
      try { return decodeURIComponent(hash); } catch { return hash; }
    };
    // 沿路径以最多 1 个屏幕像素的步长累加距离，兼顾曲线与非等比缩放。
    const arrowBackPoint = (el, ctm, length, scale, start) => {
      const at = (distance) => el.getPointAtLength(start ? distance : length - distance);
      let previous = at(0).matrixTransform(ctm);
      let remaining = 4;
      let distance = 0;
      for (let i = 0; i < 2000 && distance < length; i += 1) {
        const next = Math.min(length, distance + 1 / scale);
        const local = at(next);
        const point = local.matrixTransform(ctm);
        const step = Math.hypot(point.x - previous.x, point.y - previous.y);
        if (step >= remaining) return at(distance + (next - distance) * remaining / step);
        if (next === length) return local;
        remaining -= step;
        distance = next;
        previous = point;
      }
      return null;
    };
    const overflowSides = (box, outer) => [
      ['左', outer.left - box.left], ['右', box.right - outer.right],
      ['上', outer.top - box.top], ['下', box.bottom - outer.bottom],
    ].filter(([, px]) => px > 1).map(([side, px]) => `${side}侧 ${round(px)}px`).join('、');

    for (const svg of document.querySelectorAll('svg:not(svg svg)')) {
      if (!inContent(svg) || !shown(svg) || svg.closest('[aria-hidden="true"], .viz-figure:has(> pre[data-viz])')) continue;
      const texts = [...svg.querySelectorAll('text')]
        .filter((el) => el.ownerSVGElement === svg && shown(el))
        .map((el) => ({ el, text: el.textContent.trim(), box: el.getBoundingClientRect() }))
        .filter(({ text, box }) => text && box.width > 0 && box.height > 0);
      if (!texts.length) continue;

      const counts = {};
      const full = (code) => counts[code] >= 20;
      const report = (code, el, detail, instance) => {
        if (full(code)) return;
        push(code, el, detail, undefined, instance);
        counts[code] = (counts[code] || 0) + 1;
      };
      const missingCode = 'SVG_MARKER_MISSING';
      const arrowCode = 'SVG_ARROW_HIDDEN';
      const shapes = [];
      const opaqueShapes = [];
      const connectors = [];
      for (const el of svg.querySelectorAll('*')) {
        if (el.ownerSVGElement !== svg || !shown(el)) continue;
        const cs = getComputedStyle(el);
        const missing = new Set();
        const markers = [cs.markerStart, cs.markerMid, cs.markerEnd].map((value) => {
          const id = markerId(value);
          if (!id) return false;
          if (document.getElementById(id) instanceof SVGMarkerElement) return true;
          if (!missing.has(id)) report(missingCode, el, `箭头引用 #${id} 不存在`, id);
          missing.add(id);
          return false;
        });
        const kind = el.localName;
        if (!/^(rect|circle|ellipse|polygon|path|line|polyline)$/.test(kind)) continue;
        const ctm = el.getScreenCTM();
        if (!ctm) continue;
        const fill = paintAlpha(cs.fill) * Number(cs.fillOpacity);
        const stroke = parseFloat(cs.strokeWidth) > 0 && paintAlpha(cs.stroke) * Number(cs.strokeOpacity) > 0;
        if (stroke && (kind === 'line' || kind === 'polyline'
          || (kind === 'path' && (cs.fill === 'none' || Number(cs.fillOpacity) === 0)))) {
          connectors.push({ el, ctm, start: markers[0], end: markers[2] });
        }
        const container = kind !== 'line' && kind !== 'polyline'
          && !(kind === 'path' && cs.fill === 'none') && (fill > 0 || stroke);
        // 渐变、图案等 paint server 的计算值不能确定采样处的 alpha。
        const opaque = kind !== 'line' && isColor(cs.fill) && fill * effectiveOpacity(el) >= 0.9;
        if (!container && !opaque) continue;
        const shape = { el, box: el.getBoundingClientRect(), inverse: ctm.inverse() };
        if (container) shapes.push(shape);
        if (opaque) opaqueShapes.push(shape);
      }

      const overlapCode = 'SVG_TEXT_OVERLAP';
      const overflowCode = 'SVG_TEXT_OVERFLOW';
      const svgBox = svg.getBoundingClientRect();
      for (const [i, { el, box }] of texts.entries()) {
        for (let j = 0; j < i && !full(overlapCode); j += 1) {
          const other = texts[j];
          const w = Math.min(box.right, other.box.right) - Math.max(box.left, other.box.left);
          const h = Math.min(box.bottom, other.box.bottom) - Math.max(box.top, other.box.top);
          if (w > 2 && h > 2) report(overlapCode, el, `与「${other.text}」重叠 ${round(w)}×${round(h)}px`, keyOf(other.el));
        }
        if (full(overflowCode)) continue;
        const center = new DOMPoint(box.left + box.width / 2, box.top + box.height / 2);
        const container = shapes.findLast((shape) => after(shape.el, el) && contains(shape, center));
        const shapeSides = container && overflowSides(box, container.box);
        if (shapeSides) report(overflowCode, el, `超出容器：${shapeSides}`);
        const canvasSides = overflowSides(box, svgBox);
        if (canvasSides) report(overflowCode, el, `超出 SVG 画布：${canvasSides}`, 'canvas');
      }

      const lineCode = 'SVG_LINE_ON_TEXT';
      for (const { el, ctm, start, end } of connectors) {
        const checkArrow = !full(arrowCode) && (start || end);
        if (full(lineCode) && !checkArrow) continue;
        const length = el.getTotalLength();
        if (!(length > 0)) continue;
        // 取变换的最大伸缩率，让未触及上限时的采样间距不超过 2 个屏幕像素。
        const scale = (Math.hypot(ctm.a + ctm.d, ctm.b - ctm.c)
          + Math.hypot(ctm.a - ctm.d, ctm.b + ctm.c)) / 2;
        const masks = opaqueShapes.filter((shape) => after(el, shape.el));
        const masked = (local, point) => masks.some((shape) => contains(shape, point)
          && insideClip(shape.el, local.matrixTransform(el.getCTM())));
        if (checkArrow && masks.length && scale > 0 && [true, false].some((fromStart) => {
          if (fromStart ? !start : !end) return false;
          const back = arrowBackPoint(el, ctm, length, scale, fromStart);
          return back && masked(back, back.matrixTransform(ctm));
        })) report(arrowCode, el, '箭头被后面绘制的图形盖住');
        if (full(lineCode)) continue;
        const steps = Math.min(1999, Math.max(1, Math.ceil(length * scale / 2)));
        const remaining = new Set(texts);
        for (let i = 0; i <= steps && remaining.size && !full(lineCode); i += 1) {
          const local = el.getPointAtLength(length * i / steps);
          const point = local.matrixTransform(ctm);
          const hits = [];
          for (const item of remaining) {
            const { left, right, top, bottom } = item.box;
            if (point.x > left + 2 && point.x < right - 2 && point.y > top + 2 && point.y < bottom - 2) hits.push(item);
          }
          if (!hits.length || masked(local, point)) continue;
          for (const item of hits) {
            report(lineCode, item.el, '被连线穿过', keyOf(el));
            remaining.delete(item);
          }
        }
      }
    }
  }

  if (viewport === 'desktop' || viewport === 'mobile') {
    for (const el of document.body.querySelectorAll('*')) {
      if (!visible(el) || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) continue;
      if (el === document.body || el === document.documentElement || el.closest('svg, [hidden], [aria-hidden="true"]')) continue;
      let transparentAncestor = false;
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        if (Number(getComputedStyle(parent).opacity) <= 0) {
          transparentAncestor = true;
          break;
        }
      }
      if (transparentAncestor) continue;
      const cs = getComputedStyle(el);
      if (['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY)) continue;
      const childElements = Array.from(el.children);
      let hasText = false;
      let inlineOnly = true;
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE && child.nodeValue.trim()) hasText = true;
        else if (child.nodeType === Node.ELEMENT_NODE) {
          const childStyle = getComputedStyle(child);
          if (!childStyle.display.startsWith('inline') && childStyle.display !== 'contents') inlineOnly = false;
          else if (textOf(child)) hasText = true;
        }
      }
      if (!hasText || (childElements.length && !inlineOnly)) continue;
      const overflowX = ['hidden', 'clip'].includes(cs.overflowX)
        || (cs.textOverflow === 'ellipsis' && ['hidden', 'clip'].includes(cs.overflowX));
      const overflowY = ['hidden', 'clip'].includes(cs.overflowY);
      const clippedX = overflowX && el.scrollWidth - el.clientWidth > 2;
      const clippedY = overflowY && el.scrollHeight - el.clientHeight > 2;
      if (!clippedX && !clippedY) continue;
      if (clippedX && cs.textOverflow === 'ellipsis' && el.hasAttribute('data-allow-truncate')) continue;
      push('TEXT_CLIP', el, `文本内容被截断：${clippedX ? `横向超出 ${el.scrollWidth - el.clientWidth}px` : ''}${clippedX && clippedY ? '；' : ''}${clippedY ? `纵向超出 ${el.scrollHeight - el.clientHeight}px` : ''}`);
    }
  }

  if (viewport !== 'print') {
    for (const el of textElements()) {
      const size = shownSize(el);
      if (size < 12 - 0.01) push('SMALL_TEXT', el, `显示 ${round(size)}px，要求 ≥ 12px`);
      const cs = getComputedStyle(el);
      const colorValue = el instanceof SVGElement ? cs.fill : cs.color;
      if (!isColor(colorValue)) continue;
      const color = parseColor(colorValue);
      if (color.a <= 0) continue;
      const background = backgroundOf(el);
      const contrast = ratio(over(color, background), background);
      const weight = Number(cs.fontWeight) || 400;
      const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
      if (contrast < need - 0.005) push('LOW_CONTRAST', el, `对比度 ${round(contrast)}:1，要求 ≥ ${need}:1`);
    }
  } else {
    for (const el of textElements()) {
      const size = shownSize(el);
      const cs = getComputedStyle(el);
      const colorValue = el instanceof SVGElement ? cs.fill : cs.color;
      if (!isColor(colorValue)) continue;
      const color = parseColor(colorValue);
      if (color.a <= 0) continue;
      const background = backgroundOf(el);
      const contrast = ratio(over(color, background), background);
      const weight = Number(cs.fontWeight) || 400;
      const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
      if (contrast < need - 0.005) push('LOW_CONTRAST', el, `对比度 ${round(contrast)}:1，要求 ≥ ${need}:1`);
    }
  }

  if (viewport !== 'print') {
    const overflow = root.scrollWidth - root.clientWidth;
    if (overflow > 1) {
      // 被祖先横向裁切的元素不会撑宽页面；position: fixed 也不参与文档滚动宽度。
      const clipped = (el) => {
        if (getComputedStyle(el).position === 'fixed') return true;
        for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
          if (getComputedStyle(node).overflowX !== 'visible') return true;
        }
        return false;
      };
      let worst = null;
      for (const el of document.body.querySelectorAll('*')) {
        if (!visible(el) || clipped(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.right > root.clientWidth + 1 && (!worst || rect.right > worst.right)) {
          worst = { el, right: rect.right };
        }
      }
      let target = worst ? worst.el : document.body;
      let targetRight = worst ? worst.right : root.clientWidth;
      while (target.parentElement && target.parentElement !== document.body) {
        const rect = target.parentElement.getBoundingClientRect();
        if (rect.right > targetRight + 1) {
          target = target.parentElement;
          targetRight = rect.right;
        } else {
          break;
        }
      }
      push('PAGE_OVERFLOW', target, `横向溢出 ${Math.round(overflow)}px`);
    }
  }

  // 桌面宽度下仍要横向滚动的容器不是失败项，提醒 Agent 确认是否有意。代码块横向滚动是常规做法，不提醒。
  if (viewport === 'desktop') {
    let count = 0;
    for (const el of document.body.querySelectorAll('*')) {
      if (count >= 10) break;
      if (el.tagName === 'PRE' || !visible(el)) continue;
      const cs = getComputedStyle(el);
      if (!['auto', 'scroll'].includes(cs.overflowX)) continue;
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      notes.push({
        code: 'SCROLL_X',
        message: `${locationOf(el).where}：内容宽 ${el.scrollWidth}px，可见宽 ${el.clientWidth}px，桌面宽度下也需要横向滚动；确认这是有意的，或缩窄内容（例如表格 min-width 不超过容器宽度、换图的方向、拆分）`,
      });
      count += 1;
    }
  }

  if (viewport === 'print') {
    const main = document.querySelector('main') || document.body;
    const pageWidth = root.clientWidth;
    const mainRect = main.getBoundingClientRect();
    const mainWide = mainRect.width > pageWidth + 1
      || mainRect.right > pageWidth + 1 || mainRect.left < -1;
    if (mainWide) {
      push('PRINT_CLIP', main, `正文容器宽 ${Math.round(mainRect.width)}px，超出版心 ${pageWidth}px`);
    }
    const candidates = new Map();
    const add = (el, detail) => {
      if (!candidates.has(el)) candidates.set(el, detail);
    };
    for (const el of main.querySelectorAll('*')) {
      if (!visible(el)) continue;
      const cs = getComputedStyle(el);
      if (['hidden', 'clip', 'auto', 'scroll'].includes(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) {
        add(el, `内容宽 ${el.scrollWidth}px，容器 ${el.clientWidth}px，打印时会被裁掉`);
      }
      const rect = el.getBoundingClientRect();
      const figure = el.matches('.viz-figure') || (el.matches('svg') && !el.parentElement?.closest('svg,.viz-figure'));
      const pageHeight = options.printHeight;
      if (figure && pageHeight > 0 && rect.height > pageHeight + 1) {
        push('PRINT_CLIP', el, `完整图高 ${Math.ceil(rect.height)}px，超出单页版心高度 ${pageHeight}px`, 'PRINT_TALL_FIGURE');
      }
      const outsidePage = rect.right > pageWidth + 1 || rect.left < -1;
      const outsideMain = rect.right > mainRect.right + 1 || rect.left < mainRect.left - 1;
      if (rect.width > 0 && outsidePage && (!mainWide || outsideMain)) {
        // 元素本身可以窄于版心、只因左侧内边距而出界，所以报实际越过的边和距离。
        const side = rect.right > pageWidth + 1
          ? `右缘超出 ${pageWidth}px 版心 ${Math.round(rect.right - pageWidth)}px`
          : `左缘超出 ${pageWidth}px 版心 ${Math.round(-rect.left)}px`;
        add(el, `元素宽 ${Math.round(rect.width)}px，${side}`);
      }
    }
    for (const [el, detail] of candidates) {
      let nested = false;
      for (let parent = el.parentElement; parent && parent !== main; parent = parent.parentElement) {
        if (candidates.has(parent)) {
          nested = true;
          break;
        }
      }
      if (!nested) {
        const fix = el.matches('figure.ui-shot') ? 'PRINT_UI_FRAME'
          : el.closest('figure.ui-shot') ? 'PRINT_UI_SCROLL' : undefined;
        push('PRINT_CLIP', el, detail, fix);
      }
    }
  }

  if (viewport === 'desktop' || viewport === 'mobile') {
    const selector = [
      'button', 'input', 'select', 'textarea', '[role="button"]', '[role="tab"]', '[onclick]',
      '[data-go]', '[data-open]', '[data-toggle]', '[tabindex]', 'a',
    ].join(',');
    const seen = new Set();
    const targetBox = (el) => {
      let best = el.getBoundingClientRect();
      if ((el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')
        && el.labels && el.labels.length) {
        // WCAG 2.5.8：可点击的 label 属于控件目标；取控件和可见关联 label 中面积最大的盒子。
        for (const label of el.labels) {
          if (!visible(label)) continue;
          const box = label.getBoundingClientRect();
          if (box.width * box.height > best.width * best.height) best = box;
        }
      }
      return best;
    };
    for (const el of document.querySelectorAll(selector)) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (!visible(el)) continue;
      if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') {
        // 文字行里的行内链接不是独立点击目标；图标链接（没有文字）仍然检查
        let block = el.parentElement;
        while (block && getComputedStyle(block).display.startsWith('inline')) block = block.parentElement;
        let textLine = false;
        if (block) {
          const nodes = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
          for (let node = nodes.nextNode(); node; node = nodes.nextNode()) {
            if (node.nodeValue.trim()) {
              textLine = true;
              break;
            }
          }
        }
        if (textLine) continue;
      }
      const rect = targetBox(el);
      if (rect.width < 24 - 0.01 || rect.height < 24 - 0.01) {
        push('SMALL_TARGET', el, `点击区域 ${round(rect.width)}×${round(rect.height)}px，要求 ≥ 24×24px`);
      }
    }
  }

  if (viewport === 'desktop') {
    for (const link of document.querySelectorAll('a[href^="#"]')) {
      const raw = link.getAttribute('href').slice(1);
      if (!raw) continue;
      let id = raw;
      try {
        id = decodeURIComponent(raw);
      } catch {
        // 保留原样
      }
      const target = document.getElementById(id);
      const text = textOf(link);
      const marked = link.classList.contains('xref') && text.includes('引用失效');
      if (!target) {
        push('BROKEN_ANCHOR', link, `#${id} 没有对应元素${marked ? '；a.xref 显示「引用失效」' : ''}`);
      } else if (marked) {
        push('BROKEN_ANCHOR', link, `a.xref 显示「引用失效」，但 #${id} 存在`);
      }
    }
  }

  return JSON.stringify({ failures, notes });
}

/** 进入导出模式 / 展开折叠 / 等字体与两帧渲染。 */
async function preparePage(page, { exportMode = false, expandDetails = false } = {}) {
  const expression = `(${async function prepare(options) {
    if (options.exportMode) document.documentElement.dataset.mode = 'export';
    if (options.expandDetails) document.querySelectorAll('details:not(.viz-data)').forEach((item) => { item.open = true; });
    if (window.KChart?.ready) await window.KChart.ready();
    if (window.KChart?.relayout) {
      await window.KChart.relayout({ media: matchMedia('print').matches ? 'print' : 'screen' });
    }
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(1))));
    return 1;
  }.toString()})(${JSON.stringify({ exportMode, expandDetails })})`;
  await page.evaluate(expression);
}

// 检查与实际 PDF 用同一个浏览器准备方法，避免不同纸型、折叠或图形媒体导致误判。
export async function preparePrintPage(page, url, paper) {
  await page.setMedia('print');
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.goto(url);
  await preparePage(page, { exportMode: true, expandDetails: true });
  await applyPrintPaper(page, paper);
  const metrics = resolvePageMetrics(await readPageRules(page));
  const width = Math.max(1, Math.floor(metrics.contentWidth));
  const height = Math.max(1, Math.floor(metrics.contentHeight));
  await page.setViewport({ width, height, deviceScaleFactor: 1, mobile: false });
  await preparePage(page, { exportMode: true, expandDetails: true });
  await keepFiguresWhole(page, height);
  return { metrics, height };
}

/**
 * 标题 break-after:avoid 与图 break-inside:avoid 无法同时满足（标题加图超过一页、图本身放得下）时，
 * Chrome 会在图内断页：图题留在标题下方，不可拆分的 SVG 挤到下一页。这时只放开标题与图之间的断点，
 * 图题和图身整体移到下一页。只改打印用的活动页面，不改源 HTML；check 与 PDF 导出共用这一步。
 */
async function keepFiguresWhole(page, pageHeight) {
  await page.evaluate(`(() => {
    const pageHeight = ${JSON.stringify(pageHeight)};
    for (const figure of document.querySelectorAll('.viz-figure, figure.fig, .fig')) {
      const heading = figure.previousElementSibling;
      if (!heading || !/^H[2-6]$/.test(heading.tagName)) continue;
      const box = figure.getBoundingClientRect();
      const start = heading.getBoundingClientRect().top - (parseFloat(getComputedStyle(heading).marginTop) || 0);
      if (box.height <= pageHeight && box.bottom - start > pageHeight) heading.style.breakAfter = 'auto';
    }
    return 1;
  })()`);
}

const stripTags = (html) => html.replace(/<[^>]*>/g, '');
const unescape = (text) => text
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** 出错行之前最近的 h2 文字：控制台错误没有元素，用章节补足 where。 */
function sectionBefore(source, line) {
  if (!line) return '';
  const rows = source.split('\n');
  for (let i = Math.min(line, rows.length) - 1; i >= 0; i -= 1) {
    const match = /<h2\b[^>]*>([\s\S]*?)<\/h2>/.exec(rows[i]);
    if (match) return unescape(stripTags(match[1])).replace(/\s+/g, ' ').trim();
  }
  return '';
}

// 控制台错误归到内容区还是外壳：按脚本所在文件行号判断，行号落在内容区标记之间即为内容
function consoleFailure(entry, { ranges, source }) {
  const line = entry.line ?? null;
  let inContent = entry.fromContent;
  if (inContent == null) {
    inContent = !ranges || (line != null && ranges.some((range) => line >= range.start && line <= range.end));
  }
  const scope = inContent ? 'content' : 'shell';
  const kind = entry.kind === 'exception' ? '异常' : '错误';
  const section = inContent ? sectionBefore(source, line) : '';
  const place = scope === 'shell' ? '外壳' : section || '内容区';
  return {
    code: 'CONSOLE_ERROR',
    key: `console:${entry.message}`,
    scope,
    where: `${place} › 控制台${kind}：${entry.message}${line ? `（第 ${line} 行）` : ''}`,
    detail: entry.detail || entry.message,
    fix: FIX.CONSOLE_ERROR,
  };
}

const firstLine = (text, fallback) => String(text ?? fallback).split('\n').find((line) => line.trim())?.trim() ?? fallback;

function exceptionEntry(params) {
  const details = params.exceptionDetails;
  const text = details.exception?.description ?? details.text ?? '未捕获异常';
  const frame = details.stackTrace?.callFrames?.[0];
  return {
    kind: 'exception',
    message: firstLine(text, '未捕获异常'),
    detail: String(text).split('\n').slice(0, 3).join(' / '),
    line: frame ? frame.lineNumber + 1 : details.lineNumber != null ? details.lineNumber + 1 : null,
  };
}

function consoleEntry(params) {
  const text = (params.args || []).map((arg) => arg.value ?? arg.description ?? arg.type ?? '').join(' ');
  const frame = params.stackTrace?.callFrames?.[0];
  return {
    kind: 'error',
    message: firstLine(text, 'console.error'),
    detail: String(text),
    line: frame ? frame.lineNumber + 1 : null,
  };
}

function logEntry(entry) {
  return {
    kind: 'error',
    // 资源加载失败来自页面声明的外部资源，算内容问题；浏览器自身日志没有归属，按外壳处理
    fromContent: entry.source === 'network',
    message: firstLine(entry.text, '控制台错误'),
    detail: `${entry.source ?? 'log'}：${entry.text ?? ''}`,
    line: entry.lineNumber != null ? entry.lineNumber + 1 : null,
  };
}

/** 被拦下的外部请求产生的加载失败日志；这个请求已经按 EXTERNAL_REQUEST 报告 */
function blockedExternal(entry) {
  return entry.source === 'network' && /^https?:/i.test(entry.url ?? '');
}

function requestEntry(params) {
  const frame = params.initiator?.stack?.callFrames?.[0];
  return {
    url: params.request.url,
    line: frame ? frame.lineNumber + 1 : null,
  };
}

/**
 * 页内检查表达式：在已加载的页面上按 options.viewport（desktop/mobile/export/print）的规则检查字号、对比度与溢出。
 * renderCheck 与批量探针共用，探针可以在任意视口宽度下复用同一套规则。
 */
export const inspectPageExpression = (options) => `(${inspectPage.toString()})(${JSON.stringify(options)})`;
const withFix = ({ fixFor, ...failure }) => ({ ...failure, fix: FIX[fixFor ?? failure.code] });
export async function printClips(page, height) {
  const { failures } = await page.json(inspectPageExpression({ viewport: 'print', printHeight: height }));
  return failures.filter(({ code }) => code === 'PRINT_CLIP').map(({ key, ...failure }) => withFix(failure));
}

/**
 * 渲染检查。没有浏览器时报 BROWSER_NOT_FOUND，启动或通信失败报 BROWSER_FAILED。
 * @param {string} file HTML 路径
 * @param {{chromePath?: string, browser?: import('./browser.mjs').Browser, paper?: string}} options
 * @returns {Promise<{failures: Array<object>, notes: Array<object>}>}
 */
export async function renderCheck(file, { chromePath, browser, paper } = {}) {
  if (!existsSync(file)) fail('FILE_NOT_FOUND', `文件不存在：${file}`, {
    next: '确认路径；需要定位章节时先运行 htmlview read <file> --outline',
  });
  const source = readFileSync(file, 'utf8');
  const ranges = contentLineRanges(source);
  const viewports = viewportsFor();
  const url = pathToFileURL(file).href;

  const run = async (session) => {
    const page = await session.newPage();
    try {
      const consoleErrors = [];
      const external = [];
      const notes = [];
      page.on((msg) => {
        if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(exceptionEntry(msg.params));
        else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push(consoleEntry(msg.params));
        else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && !blockedExternal(msg.params.entry)) consoleErrors.push(logEntry(msg.params.entry));
        else if (msg.method === 'Network.requestWillBeSent' && /^https?:/i.test(msg.params.request.url)) external.push(requestEntry(msg.params));
      });

      const merged = new Map();
      const add = (failure, viewport) => {
        const key = `${failure.code}\u0000${failure.key}`;
        const seen = merged.get(key);
        if (seen) {
          if (!seen.viewports.includes(viewport)) seen.viewports.push(viewport);
          return;
        }
        merged.set(key, { ...failure, viewports: [viewport] });
      };

      for (const viewport of viewports) {
        consoleErrors.length = 0;
        external.length = 0;
        let printHeight;
        if (viewport.id === 'print') {
          ({ height: printHeight } = await preparePrintPage(page, url, paper));
        } else {
          await page.setMedia(viewport.media);
          await page.setViewport(viewport);
          await page.goto(url);
          await preparePage(page, {
            exportMode: viewport.prepare === 'export',
            expandDetails: viewport.prepare !== 'screen',
          });
        }
        const pageResult = await page.json(inspectPageExpression({ viewport: viewport.id, printHeight }));
        for (const failure of pageResult.failures) add(withFix(failure), viewport.id);
        notes.push(...(pageResult.notes ?? []));
        for (const entry of consoleErrors) add(consoleFailure(entry, { ranges, source }), viewport.id);
        for (const request of external) {
          const inContent = !ranges || request.line == null
            || ranges.some((range) => request.line >= range.start && request.line <= range.end);
          add({
            code: 'EXTERNAL_REQUEST',
            key: `url:${request.url}`,
            scope: inContent ? 'content' : 'shell',
            where: `外部请求 › ${request.url}`,
            detail: `实际发起外部网络请求：${request.url}`,
            fix: FIX.EXTERNAL_REQUEST,
          }, viewport.id);
        }
      }
      // key 只用于合并，不进入对外的 failure 字段
      return {
        failures: [...merged.values()].map(({ key, ...failure }) => failure),
        notes,
      };
    } finally {
      await page.close();
    }
  };

  const result = browser ? await run(browser) : await defaultWithBrowser(run, { chromePath });
  const order = viewports.map((viewport) => viewport.id);
  result.failures.sort((a, b) => order.indexOf(a.viewports[0]) - order.indexOf(b.viewports[0])
    || a.code.localeCompare(b.code)
    || a.where.localeCompare(b.where));
  return result;
}
