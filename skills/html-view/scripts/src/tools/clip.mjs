// 截图裁剪：所有 clip 都要限制在文档范围内。
// Chrome 对越界的 clip（尤其 x/y 为负）会退回 1x 绘制，图片尺寸却仍按 deviceScaleFactor 计算，内容就只占一部分。

/** 文档可截图范围（CSS px）：横向、纵向都取滚动范围。 */
export async function documentSize(page) {
  return page.json(`JSON.stringify((() => ({
    width: Math.round(Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)),
    height: Math.round(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)),
  }))())`);
}

/** 把期望的裁剪框夹到文档内；页面贴边时不向页面外补留白。 */
export function clampClip(box, doc) {
  const right = Math.max(1, Math.min(doc.width, box.x + box.width));
  const bottom = Math.max(1, Math.min(doc.height, box.y + box.height));
  const x = Math.max(0, Math.min(box.x, right - 1));
  const y = Math.max(0, Math.min(box.y, bottom - 1));
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}
