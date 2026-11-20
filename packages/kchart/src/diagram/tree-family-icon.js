// A resolved icon is centred in its reserved label slot.
export function labelIcon(ctx, icon, x, y, size, ink) {
  const [l, t, w, h] = icon.viewBox.split(/\s+/).map(Number);
  const scale = size / Math.max(w, h);
  const paint = icon.set === 'tabler'
    ? { fill: 'none', stroke: ink, 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }
    : { fill: ink };
  return { ...ctx.el('g', {
    transform: `translate(${x - (l + w / 2) * scale} ${y - (t + h / 2) * scale}) scale(${scale})`,
  }, icon.elements.map(({ tag, attrs }) => ctx.shape(tag, { ...attrs, ...paint }))), meta: { kind: 'icon' } };
}
