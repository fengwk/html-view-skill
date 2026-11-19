import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render } from '../../vendor/kchart/esm/node.js';
import { launchBrowser } from '../src/shared/browser.mjs';

// 意图：在真实 Chrome 像素里，短扇区的描边尖角不能跨进相邻扇区；接缝仍可见且不拦截鼠标。
test('饼图分隔线对准圆心，不在临近扇区留下描边尖角', async (t) => {
  let browser;
  try {
    browser = await launchBrowser();
  } catch (error) {
    t.skip(`真实浏览器不可用：${error.message}`);
    return;
  }
  try {
    const { svg, diagnostics } = render({
      chart: 'pie', data: [{ c: 'Web', v: 58 }, { c: 'Mobile', v: 32 }, { c: 'Other', v: 10 }],
      encode: { category: 'c', value: 'v' },
    }, { width: 502, frame: false });
    assert.deepEqual(diagnostics, []);
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 640, height: 420 });
      await page.goto('about:blank');
      const pixels = await page.json(`(async () => {
        document.body.innerHTML = ${JSON.stringify(svg)};
        const svg = document.querySelector('svg'), sector = svg.querySelector('[data-kc-kind="pie"][data-kc-label="Web"]');
        // Web 扇区超过半圆，包含圆的上下和最右端，可从实际几何求圆心。
        const box = sector.getBBox(), r = box.height / 2;
        const cx = box.x + box.width - r, cy = box.y + r;
        const image = new Image();
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.outerHTML);
        await image.decode();
        const zoom = 8, pad = 24;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 2 * pad * zoom;
        const ctx = canvas.getContext('2d');
        ctx.scale(zoom, zoom);
        ctx.drawImage(image, pad - cx, pad - cy);
        const pixel = (x, y) => [...ctx.getImageData((x + pad) * zoom, (y + pad) * zoom, 1, 1).data];
        const point = new DOMPoint(cx + .75, cy - 12).matrixTransform(svg.getScreenCTM());
        return JSON.stringify({
          clean: pixel(.625, 1.875), inSector: pixel(4, 2),
          seam: pixel(.25, -12), hit: document.elementFromPoint(point.x, point.y)?.getAttribute('data-kc-label'),
        });
      })()`);
      assert.deepEqual(pixels.clean, pixels.inSector, '竖直分隔线在圆心下方 1.875px 处不能有白色尖角');
      assert.ok(pixels.seam[0] > pixels.inSector[0] + 100, '从同一圆心出发的分隔线仍然可见');
      assert.equal(pixels.hit, 'Web', '覆盖在扇区上的分隔线不捕获鼠标事件');
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
