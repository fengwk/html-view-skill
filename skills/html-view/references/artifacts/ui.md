# 界面稿 `ui`

把单页界面稿写成离线可运行的 HTML 原型时读本 reference。页面内容由顶层屏幕组成；共享外壳提供移动与桌面工具栏、设备预览、状态切换、明暗主题和标注。组件 class、可用图标与内容区属性清单见 [ui-components.md](ui-components.md)。新建使用 `htmlview ui new`，修改设计参数使用 `htmlview style`，检查内容使用 `htmlview audit`，按屏幕比较版本使用 `htmlview diff`。

## 设计参数

`ui new` 支持 `--device mobile|desktop|responsive`、`--fidelity wireframe|mockup`、`--brand #hex`、`--scheme light|dark`、`--radius 0–16`、`--density compact|regular` 和 `--lang`。屏幕切换、状态切换、设备宽度、明暗和标注均由工具栏控制；responsive 预览可切换手机、平板与桌面宽度。用户内容里的屏幕、状态、交互和表单不因工具栏操作而改写。

界面主题从设计参数生成。浅色与深色主题对象分别经 KChart `core/color` 与 `core/theme` 校验，工具栏切换时图表使用对应主题重新布局；因对比度校验而调整的颜色记录在命令输出 `tokens.adjusted`。线框稿不使用红色。错误和风险用文字或图标说明，多系列图表用低彩度冷色区分。界面稿的图默认不附带可读数据表。

## 屏幕与状态

每个屏幕为一个顶层 `<section class="screen">`，`id` 使用 `scr-` 前缀，`data-title` 用作工具栏名称。在文件链接末尾加 `#scr-…` 可指定初始屏幕；未指定时打开第一个屏幕。`data-states` 用英文或中文逗号分隔状态名；不写时只有默认状态。`data-when` 控制内容可见状态，`data-next` 可让当前状态在短暂提示后进入下一状态。

```html
<section class="screen" id="scr-queue" data-title="待处理" data-states="默认,加载中,已完成">
  <div class="app">
    <header class="app-bar"><h1>待处理</h1></header>
    <div class="app-body stack">
      <p data-when="默认">还有 3 条待处理事项。</p>
      <p data-when="加载中" role="status">正在刷新…</p>
      <p data-when="已完成" role="status">已全部处理。</p>
      <button class="btn" type="button" data-state-to="加载中">刷新</button>
      <button class="btn" type="button" data-state-to="已完成">完成</button>
    </div>
  </div>
</section>
```

常见声明式交互：

| 属性 | 行为 |
|---|---|
| `data-go="scr-x"` | 切换屏幕；导航链接同时填写 `href="#scr-x"` |
| `data-go-state="状态"` | 切换到目标屏幕并进入所列状态 |
| `data-state-to="状态"` | 切换当前屏幕状态 |
| `data-open="dialog-id"`、`data-close` | 打开或关闭弹窗、抽屉和底部弹层 |
| `data-toggle="id"` | 展开或收起菜单/内容块；菜单在切屏、点击外部或按 Esc 后收起 |
| `data-tab="panel-id"` | 切换标签页；支持方向键及 Home/End 键 |
| `data-toast="文字"` | 显示短暂反馈 |
| `data-note="说明"` | 生成编号标注与说明面板 |

屏幕与状态改变后，运行时更新可见内容、导航当前项和图表布局；切屏会更新 hash，并将焦点移到新屏幕。表单先使用浏览器原生约束校验，通过后才执行其声明的跳转、状态变化或提示。原型不提交真实数据。

## 自绘下拉与日期控件

普通单选 `<select>` 会增强为自绘列表，`input[type="date"]` 会增强为自绘月历。点击控件或关联的 `<label>` 都会打开同一个面板。原生字段仍负责 `value`、`required`、表单校验和 `change` 事件。下拉支持方向键、Enter、Esc 和首字跳转；月历支持方向键按日/周移动、PageUp/PageDown 翻月、Shift 配合翻年，并遵守 `min`、`max`。非必填日期可以清除。

脚本如需改动已增强控件的值，应设置原生控件的 `.value`，然后派发冒泡的 `change` 事件，使显示值和可访问状态同步：

```js
const date = document.querySelector('input[type="date"]');
date.value = '2026-02-14';
date.dispatchEvent(new Event('change', { bubbles: true }));
```

必填下拉仍然以原生 `<select required>` 参与表单校验，不要用另一个按钮值替代其表单值。输入框必须有关联 `<label>` 或可访问名称。

## 图表与图标

KChart 图表只使用 `pre[data-viz="kchart"]` 声明。不要用 HTML 数据表来代替图表，也不要把可读数据表作为界面稿默认输出。增改图形声明后运行 `htmlview style <file>` 装入相应图模块。工具栏的屏幕、状态、宽度或主题变化会请求图表重新布局。

内容图标使用 `i.icon[data-icon]`。名称来自 KChart 的 `core/icons`；生成界面稿时通过该模块解析并序列化当前内容需要的受控图形，不在 UI 资产中保存或复制一份原始图标数据。工具栏和自绘日期控件专用的几何图元属于 UI 自有外壳元素，样式与来源均维护在本 UI 的 CSS/运行时中。

## 组件和自定义样式

先用 [ui-components.md](ui-components.md) 列出的组件 class、图标名和 `data-*` 属性。聊天气泡、播放器、时间轴、画布这类清单里没有的部分再手写。版式、字号和配色的取舍见[界面设计](../guides/ui-design.md)。

- 自定义样式集中写在内容区开头唯一的 `<style>` 里。选择器以 `.x-` 开头；at 规则只用 `@media`、`@container`、`@supports` 和以 `x-` 命名的 `@keyframes`。
- 颜色、字号、间距、圆角和阴影只取[样式变量](ui-components.md#样式变量)、`currentColor` 或透明色，不写固定颜色；这样明暗切换和品牌色会自动生效。自己的变量先在同一个 `<style>` 里以 `--x-` 开头定义再用；引用不存在的变量时，`audit` 报 `UNKNOWN_TOKEN`。
- 每个 `<input>`、`<select>` 和 `<textarea>` 都应有标签。新增 `data-icon` 或图表后运行 `htmlview style <file>`，装入对应图标和图模块。

## 行内脚本

声明式属性表达不了的原型逻辑，如播放进度、本地发送消息、筛选列表，写在内容区的行内 `<script>` 里。脚本不加载外部文件、不发网络请求，数据用虚构样例。

- 由脚本处理的按钮或链接加 `data-action="名称"`，脚本用 `[data-action="名称"]` 绑定事件。`audit` 据此认定控件有交互；内容区没有脚本时报 `ORPHAN_ACTION`。
- 切屏、切状态、开关弹窗和提示调用 `window.htmlviewUI`，不要自己改 `hidden` 或调用原生 `dialog.close()`，否则导航、焦点和遮罩不会同步。

| 调用 | 作用 |
|---|---|
| `htmlviewUI.go('scr-x', '状态')` | 同 `data-go` 加 `data-go-state`；省略状态时进入该屏的默认状态 |
| `htmlviewUI.state('状态')` | 同 `data-state-to`；状态名不存在时抛出错误 |
| `htmlviewUI.open('dialog-id')`、`htmlviewUI.close()` | 同 `data-open`、`data-close`；`close()` 关闭最上层的弹窗 |
| `htmlviewUI.toast('文字')` | 同 `data-toast` |
| `htmlviewUI.current()` | 返回 `{ screen, state }` |

屏幕或状态变化后，`document` 会收到 `htmlview:change` 事件，`event.detail` 为 `{ screen, state }`；需要跟着状态更新的脚本监听它。

## 验证

生成或改动后先运行 `htmlview audit <file>`，再运行 `htmlview diff <old> <new>` 查看屏幕增删和修改。显示检查应覆盖工具栏切换屏幕/状态/宽度/明暗、控件的点按和键盘操作、必填表单校验，以及带图表的屏幕主题重排；移动和桌面宽度均需检查。`htmlview shot <file> --mode export --out shots` 为每个屏幕、状态、宽度和弹层各截一张图，逐张打开看；手写的部分还要切到深色再看一遍。内容区应仍可作为独立、离线的原型阅读。
