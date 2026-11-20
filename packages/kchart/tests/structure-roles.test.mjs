import assert from 'node:assert/strict';
import { test } from 'vitest';
import { diagram, structureRoles, themes } from '../dist/esm/node.js';
import { createContext } from '../src/core/context.js';
const frameRoles = Array.from({ length: 6 }, (_, i) => `frame-${i + 1}`);

// 所有媒体都产生 CSS 可用的颜色；灰色 RGB 三通道相等意味着 OKLCH 色度近零。
test('structure roles use hex colors and honor Cloud Music’s neutral frame ink', () => {
  for (const theme of Object.keys(themes)) {
    for (const media of ['screen', 'print']) {
      const result = structureRoles({ theme, media });
      assert.ok(Object.isFrozen(result) && Object.isFrozen(result.colors));
      assert.equal(Object.keys(result.colors).length, 21);
      for (const hex of Object.values(result.colors)) assert.match(hex, /^#[0-9a-f]{6}$/i, `${theme}/${media}`);
    }
  }
  const { colors } = structureRoles({ theme: 'cloudmusic' });
  assert.deepEqual(new Set(frameRoles.map(role => colors[role])), new Set([colors['frame-1']]));
  assert.match(colors['frame-1'], /^#([0-9a-f]{2})\1\1$/i);
  assert.equal(colors.em, themes.cloudmusic.fg1);
});

// 六层覆盖所有 tone：手写 SVG 用的结构色必须与 layers 实际序列化的分组框和能力项一致。
// blocks 自 0.2.0 起使用中性虚线分组的总览图外观，不再按 tone 轮换分组色。
test('structure frame and node colors match layers SVG', () => {
  const source = 'layers\n' + frameRoles.map((_, i) => `- Layer${i}\n  - Group${i}: Node${i}`).join('\n');
  for (const theme of ['claude', 'cloudmusic']) {
    const { svg, diagnostics } = diagram(source, { syntax: 'layers', theme });
    assert.deepEqual(diagnostics, []);
    const { colors } = structureRoles({ theme });
    const ctx = createContext({ theme });
    const shapes = role => [...svg.matchAll(new RegExp(`<rect[^>]* fill="([^"]+)" stroke="([^"]+)"[^>]*data-kc-role="${role}"`, 'g'))];
    const frames = shapes('group'), nodes = shapes('capability');
    assert.equal(frames.length, 6);
    assert.equal(nodes.length, 6);
    for (let i = 0; i < 6; i += 1) {
      const k = i + 1;
      assert.deepEqual(frames[i].slice(1), [colors[`frame-${k}-fill`], colors[`frame-${k}`]]);
      const line = ctx.tint(ctx.design.bg, ctx.frameTone(ctx.color(`tone${k}`)), 0.40);
      assert.deepEqual(nodes[i].slice(1), [colors.node, k === 1 ? colors['node-line'] : line]);
    }
  }
});

// 总览图里带样式的卡片沿用公开的节点底色（与手写 SVG 的 --viz-node 一致）；普通卡片和能力项是无边框底块。
test('board styled cards use the public node fill and plain ones are borderless tiles', () => {
  for (const theme of ['claude', 'cloudmusic', 'tokyo']) {
    const { svg, diagnostics } = diagram('blocks\nrow\n  box Group: Item\n  card Plain\n  card Styled {ok}', { syntax: 'blocks', theme });
    assert.deepEqual(diagnostics, []);
    const { colors } = structureRoles({ theme });
    const shapes = [...svg.matchAll(/data-kc-kind="(?:capability|node)"[^>]*><rect([^>]*)>/g)]
      .map(([, attrs]) => ({ fill: attrs.match(/ fill="([^"]+)"/)[1], outlined: / stroke=/.test(attrs) }));
    assert.deepEqual(shapes.map(s => s.outlined), [false, false, true]);
    assert.equal(shapes[2].fill, colors.node);
    assert.ok(shapes.slice(0, 2).every(s => s.fill !== colors.node));
  }
});
