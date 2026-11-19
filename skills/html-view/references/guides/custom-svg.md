# 手写 SVG

内置图族都不能表达、且材料明确给出关系时才用手写 SVG。数据图和结构图优先写声明；不要用 SVG 重做已有图型。

`htmlview viz palette --theme paper` 会列出可用角色和骨架。图放进 `figure.fig`，标题放在 `figcaption`，图形设置 `viewBox`、可访问名称，颜色只引用主题变量，例如 `var(--viz-fg)`、`var(--viz-1)`，不要写死颜色。避免远程资源、脚本、任意动画和缩字。使用 `audit`、`check`，再在至少一亮一暗主题目检同一张图。

```html
<figure class="fig" id="fig-boundary">
  <figcaption>高亮表示当前覆盖范围</figcaption>
  <div class="fig-body">
    <svg viewBox="0 0 240 92" width="240" height="92" role="img" aria-label="已覆盖区域与未覆盖区域">
      <rect x="8" y="12" width="224" height="68" rx="8" fill="none" stroke="var(--viz-axis)"></rect>
      <rect x="19" y="23" width="86" height="46" rx="4" fill="var(--viz-1)"></rect>
      <text x="120" y="51" font-size="14" fill="var(--viz-fg)">未覆盖</text>
    </svg>
  </div>
</figure>
```
