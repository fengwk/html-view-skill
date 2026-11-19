import assert from 'node:assert/strict';
import test from 'node:test';
import { diagram, structureRoles, themes } from '../node.mjs';
import { loadModules } from '../modules.mjs';

const { createContext } = loadModules(['core/context'])['core/context'];
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

// 六个连续源码行覆盖所有 tone，并检查实际序列化的容器与能力项色值。
test('structure frame and node colors match blocks SVG', () => {
  const source = 'blocks\n' + frameRoles.map((_, i) => `box Frame${i}: Node${i}`).join('\n');
  for (const theme of ['claude', 'cloudmusic']) {
    const { svg, diagnostics } = diagram(source, { syntax: 'blocks', theme });
    assert.deepEqual(diagnostics, []);
    const { colors } = structureRoles({ theme });
    const ctx = createContext({ theme });
    const frames = [...svg.matchAll(/data-kc-kind="container"[^>]*><rect[^>]* fill="([^"]+)" stroke="([^"]+)"/g)];
    const nodes = [...svg.matchAll(/data-kc-kind="capability"[^>]*><rect[^>]* fill="([^"]+)" stroke="([^"]+)"/g)];
    assert.equal(frames.length, 6);
    assert.equal(nodes.length, 6);
    for (let i = 0; i < 6; i += 1) {
      const k = (i + 2) % 6 + 1;
      assert.deepEqual(frames[i].slice(1), [colors[`frame-${k}-fill`], colors[`frame-${k}`]]);
      const line = ctx.tint(ctx.design.bg, ctx.frameTone(ctx.color(`tone${k}`)), 0.40);
      assert.deepEqual(nodes[i].slice(1), [colors.node, k === 1 ? colors['node-line'] : line]);
    }
  }
});
