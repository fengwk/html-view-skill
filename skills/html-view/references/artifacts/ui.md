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

普通单选 `<select>` 会增强为可点击、可键盘操作的自绘列表；`input[type="date"]` 会增强为自绘月历。增强后，原生表单控件仍保留为实际值和校验源，因此 `value`、`required`、表单提交前校验和 `change` 事件语义保持有效。下拉支持方向键、Enter、Esc 和首字跳转；月历支持方向键按日/周移动、PageUp/PageDown 翻月、Shift 配合翻年，并遵守 `min`、`max`。非必填日期可以清除。

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

使用 [ui-components.md](ui-components.md) 列出的实际组件 class、图标名和 `data-*` 属性。自定义内容样式放在内容区开头的 `<style>` 内；类名以 `x-` 开始，颜色使用主题 CSS 变量、`currentColor` 或透明色，不写固定颜色。每个 `<input>`、`<select>` 和 `<textarea>` 都应有标签。

## 验证

生成或改动后先运行 `htmlview audit <file>`，再运行 `htmlview diff <old> <new>` 查看屏幕增删和修改。显示检查应覆盖工具栏切换屏幕/状态/宽度/明暗、控件的点按和键盘操作、必填表单校验，以及带图表的屏幕主题重排；移动和桌面宽度均需检查。截图或导出由共享 HTML 工具完成，内容区应仍可作为独立、离线的原型阅读。
