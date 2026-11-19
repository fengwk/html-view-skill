import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRenderer } from '../../vendor/kchart/esm/node.js';
import { launchBrowser } from '../src/shared/browser.mjs';

// 意图：真实 Chromium 检查单位变体 SVG 的剪裁、文字可读性和像素可见图标。
test('unit variants render safely in a real Chromium SVG viewport', async (t) => {
  let browser;
  let directory;
  try {
    browser = await launchBrowser();
  } catch (error) {
    t.skip(`真实浏览器不可用：${error.message}`);
    return;
  }
  directory = mkdtempSync(join(tmpdir(), 'kchart-unit-render-'));
  try {
    const renderer = createRenderer();
    const samples = [
      { chart: 'bar', variant: 'rungs', unitMark: { value: 2, label: '人' }, data: [{ c: 'A', v: 5 }], encode: { category: 'c', value: 'v' } },
      { chart: 'column', variant: 'pictorial', unitMark: { value: 2, label: '人', icon: 'users' }, data: [{ c: 'A', v: 5 }], encode: { category: 'c', value: 'v' } },
      { chart: 'column', variant: 'lollipop', data: [{ c: 'A', v: 5 }], encode: { category: 'c', value: 'v' } },
      { chart: 'dumbbell', variant: 'rungs', unitMark: { value: 1, label: '件' }, data: [{ c: 'A', b: 0.5, a: 2.5 }], encode: { category: 'c', before: 'b', after: 'a' } },
      { chart: 'waterfall', variant: 'rungs', unitMark: { value: 1, label: '元' }, data: [{ c: 'A', d: 2.5 }, { c: 'B', d: -1.5 }], encode: { category: 'c', delta: 'd' } },
      { chart: 'histogram', variant: 'rungs', unitMark: { value: 2, label: '次' }, data: [{ l: 0, u: 2, n: 5 }, { l: 2, u: 4, n: 8 }], fields: { n: { unit: '次' } }, encode: { lower: 'l', upper: 'u', count: 'n' } },
    ];
    const svgs = samples.map((spec) => renderer.render(spec, { width: 640 }).svg);
    assert.ok(svgs.every((svg) => /<svg/.test(svg) && !/NaN|Infinity/.test(svg)));
    const pageFile = join(directory, 'render.html');
    writeFileSync(pageFile, `<!doctype html><meta charset="utf-8"><main>${svgs.map((svg) => `<section>${svg}</section>`).join('')}</main>`);
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1280, height: 1000 });
      await page.goto(pathToFileURL(pageFile).href);
      const rendered = await page.json(`(async () => {
        const items = [];
        for (const svg of [...document.querySelectorAll('svg')]) {
          const iconGroups = [...svg.querySelectorAll('g[data-kc-kind="record"][clip-path]')];
          let pictorialVisible = 0;
          if (iconGroups.length) {
            const canvas = document.createElement('canvas');
            canvas.width = svg.viewBox.baseVal.width;
            canvas.height = svg.viewBox.baseVal.height;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            const image = new Image();
            image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.outerHTML);
            await image.decode();
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            const background = [pixels[0], pixels[1], pixels[2]];
            pictorialVisible = iconGroups.filter((node) => {
              const box = node.getBBox(), matrix = node.getCTM();
              const corners = [[box.x, box.y], [box.x + box.width, box.y + box.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
              const x0 = Math.max(0, Math.floor(Math.min(...corners.map((point) => point.x)))), y0 = Math.max(0, Math.floor(Math.min(...corners.map((point) => point.y))));
              const x1 = Math.min(canvas.width, Math.ceil(Math.max(...corners.map((point) => point.x))));
              const y1 = Math.min(canvas.height, Math.ceil(Math.max(...corners.map((point) => point.y))));
              let count = 0;
              for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
                const offset = (y * canvas.width + x) * 4;
                if (pixels[offset + 3] > 20 && Math.abs(pixels[offset] - background[0]) + Math.abs(pixels[offset + 1] - background[1]) + Math.abs(pixels[offset + 2] - background[2]) > 60) count += 1;
              }
              return count > 5;
            }).length;
          }
          const references = [...svg.querySelectorAll('[clip-path]')].map((node) => node.getAttribute('clip-path').match(/url\\(#([^\\)]+)\\)/)?.[1]);
          items.push({
            width: svg.getBoundingClientRect().width,
            height: svg.getBoundingClientRect().height,
            marks: svg.querySelectorAll('[data-kc-kind="record"]').length,
            clip: svg.querySelectorAll('clipPath').length,
            broken: svg.querySelectorAll('path[d*="NaN"],path[d*="Infinity"]').length,
            minFont: Math.min(...[...svg.querySelectorAll('text')].map((node) => Number(getComputedStyle(node).fontSize.replace('px', '')) || 12)),
            brokenClip: references.filter((id) => !id || ![...svg.querySelectorAll('clipPath')].some((clip) => clip.id === id)).length,
            pictorialVisible,
          });
        }
        return JSON.stringify(items);
      })()`);
      assert.equal(rendered.length, samples.length);
      assert.ok(rendered.every((item) => item.width > 100 && item.height > 100 && item.marks > 0 && item.broken === 0 && item.brokenClip === 0 && item.minFont >= 12), JSON.stringify(rendered));
      assert.ok(rendered.some((item) => item.clip > 0), 'actual browser DOM contains clipping paths for unit and partial marks');
      assert.equal(rendered[1].pictorialVisible, 3, `each full-size clipped icon paints visible non-background pixels: ${JSON.stringify(rendered[1])}`);
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
