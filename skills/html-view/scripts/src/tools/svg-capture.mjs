// SVG 选择器截图：只在本次截图期间展开滚动祖先和 SVG 最大宽度限制。
import { clampClip, documentSize } from './clip.mjs';

export async function screenshotSvg(page, selector, index, margin = 0) {
  const box = await page.json(`JSON.stringify((() => {
    const node = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    if (!(node instanceof SVGSVGElement)) return null;
    if (window.__htmlviewSvgCapture) throw new Error('SVG 截图状态未恢复');
    const saved = [];
    const set = (element, property, value) => {
      saved.push({ element, style: element.getAttribute('style') });
      element.style.setProperty(property, value, 'important');
    };
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.overflowX !== 'visible') set(parent, 'overflow-x', 'visible');
      if (style.overflowY !== 'visible') set(parent, 'overflow-y', 'visible');
    }
    set(node, 'max-width', 'none');
    window.__htmlviewSvgCapture = saved;
    const rect = node.getBoundingClientRect();
    return {
      x: Math.round(rect.left + scrollX) - ${margin},
      y: Math.round(rect.top + scrollY) - ${margin},
      width: Math.round(rect.width) + ${margin * 2},
      height: Math.round(rect.height) + ${margin * 2},
    };
  })())`);
  if (!box) return null;
  try {
    return await page.screenshot(clampClip(box, await documentSize(page)));
  } finally {
    await page.evaluate(`(() => {
      const saved = window.__htmlviewSvgCapture || [];
      for (const item of saved.reverse()) {
        if (item.style === null) item.element.removeAttribute('style');
        else item.element.setAttribute('style', item.style);
      }
      delete window.__htmlviewSvgCapture;
      return 1;
    })()`);
  }
}
