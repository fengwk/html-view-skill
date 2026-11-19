# 界面稿组件清单

写入屏幕内容前读本文件；屏幕/状态与交互时序见 [ui.md](ui.md)。以下 class 均来自当前 `html-view/assets/page/ui.css`，交互属性由 `html-view/assets/page/ui.js` 实际读取。`ui-*` 是外壳运行时的私有 class，不要写进内容区。

## 结构与布局

| Class | 用途与结构 |
|---|---|
| `screen` | 顶层 `<section>` 屏幕；必须有唯一 `id="scr-…"` 和 `data-title`。可有一个 `.app`。 |
| `app` | 屏幕应用框架。 |
| `app-bar` | 移动端屏幕顶栏，放在 `.app` 开头。 |
| `app-body` | 屏幕主体内边距容器，通常与 `stack` 组合。 |
| `app-main` | 桌面端右侧内容列，包含 `top-bar` 与 `app-body`。 |
| `side-nav`、`side-nav-item` | 桌面端屏幕导航；链接同时写 `href="#scr-…"` 和 `data-go="scr-…"`。 |
| `tab-bar`、`tab-bar-item` | 移动端底部屏幕导航；当前项写 `aria-current="page"`。 |
| `top-bar` | 桌面端内容区标题栏。 |
| `page-head` | 页面标题、说明和主要操作组成的标题区。 |
| `stack` | 纵向内容与间距容器。 |
| `row` | 横向操作/内容组，可换行。 |
| `grid` | 自适应等宽列布局。 |
| `split` | 有主次关系的内容与侧栏，窄宽下堆叠。 |
| `card` | 相关信息容器；内部通常组合 `stack`。 |
| `section-title`、`divider` | 卡片/分组标题和分隔线。 |

## 操作与表单

| Class | 用途与必要约定 |
|---|---|
| `btn` | 普通按钮；`data-variant="primary|secondary|outline|ghost|danger"` 控制强调级别。破坏性操作才用 `danger`。 |
| `icon-btn` | 纯图标按钮；必须有 `aria-label`。 |
| `link` | 行内链接样式；导航用 `<a href>`，动作使用 `<button>`。 |
| `field` | 表单字段容器；包括 `label` 与原生控件。 |
| `field-help`、`field-error` | 字段提示与错误说明。静态错误示例可在字段控件上写 `data-invalid`。 |
| `check`、`radio`、`switch` | 复选框、单选框和开关；由 label 包住原生 input 与文字。 |
| `seg` | 分段选择控件；按钮用 `aria-pressed` 表示当前项。 |
| `search` | 搜索控件外壳，内含 `i.icon` 和 `input[type="search"]`。 |

`select` 和 `input[type="date"]` 保持原生值与校验源，由运行时增强为自绘控件。不要移除它们的 `required`、`min`、`max` 或关联的 label；脚本改值后派发冒泡的 `change`。完整键盘和表单语义见 [ui.md](ui.md#自绘下拉与日期控件)。

## 信息展示与浮层

| Class | 用途 |
|---|---|
| `list`、`item` | 列表与列表项；行内角色可组合 `item-lead`、`item-body`、`item-title`、`item-sub`、`item-trail`。 |
| `row-link` | 表格单元格内的行内跳转/操作链接。 |
| `badge` | 短状态或计数；状态用 `data-k="ok|warn|danger|info|neutral"`。 |
| `avatar` | 姓名缩写或头像占位。 |
| `stat`、`stat-v`、`stat-l` | 数值指标、数值与说明。 |
| `progress` | 原生 `<progress class="progress">` 进度条。 |
| `stepper` | 有序步骤；当前步 `aria-current="step"`。 |
| `kv` | 键值对详情，`dl` 中每组 `dt`/`dd` 由一层 `div` 包住。 |
| `ph` | 线框/界面稿里的图片占位。 |
| `empty`、`skeleton` | 空状态和加载占位；skeleton 容器需用 `role="status"` 与 `aria-label` 说明状态。 |
| `alert` | 持续提示；使用 `data-k` 指定状态，必要时标记 `role="alert"` 或 `role="status"`。标题和说明写成 `<strong>标题</strong><p>说明</p>`，不用 `<br>`；带图标时把文字包进一个 `<div>`，放在图标之后。 |
| `tabs` | 标签组；按钮使用 `role="tab"` 和 `data-tab`，面板使用 `role="tabpanel"`。 |
| `menu` | 短操作菜单；目标以 `data-toggle` 控制。 |
| `pagination` | 分页导航；当前项使用 `aria-current="page"`。 |
| `chips`、`chip` | 筛选项容器和选项；当前项写 `aria-pressed="true"`。 |
| `dialog`、`sheet`、`drawer` | 原生 `<dialog>` 的居中弹窗、底部弹层和侧边抽屉；用 `data-open`、`data-close` 操作。 |

普通 HTML 表格只用于用户确实需要的表格数据；图表必须用 KChart 声明 `<pre data-viz="kchart">…</pre>`，界面稿外壳默认不渲染可读数据表。

## 内容属性

| 属性 | 用法 |
|---|---|
| `data-title` | 屏幕标题，显示在屏幕选择工具栏。 |
| `data-states` | 屏幕状态列表，以逗号分隔。 |
| `data-when` | 元素在哪些屏幕状态显示。 |
| `data-next` | 当前可见状态自动进入的目标状态。 |
| `data-go`、`data-go-state` | 导航到目标屏幕，可指定初始状态。 |
| `data-state-to` | 在当前屏幕切换到指定状态。 |
| `data-open`、`data-close` | 打开目标 dialog，或关闭当前 dialog。 |
| `data-toggle` | 切换目标菜单/展开块。 |
| `data-tab` | 切换目标 tabpanel。 |
| `data-toast` | 显示短暂操作反馈。 |
| `data-note` | 为界面元素添加业务假设/说明标注。 |
| `data-variant` | 按钮的视觉级别：`primary`、`secondary`、`outline`、`ghost`、`danger`。 |
| `data-size`、`data-block` | 按钮尺寸 `s`/`l` 与整行宽度标记。 |
| `data-k` | badge/alert 状态：`ok`、`warn`、`danger`、`info`、`neutral`。 |
| `data-invalid` | 静态稿显式展示输入错误状态。 |

自定义样式只放内容区开头的一个 `<style>`；每个自定义类以 `x-` 开头，颜色用界面主题变量、`currentColor` 或透明色，不使用固定颜色。自定义行内脚本只写原型逻辑；不能加入事件属性、外链资源或远程依赖。

## 图标名

内容图标写为 `<i class="icon" data-icon="name"></i>`。下列是当前 `core/icons` 实际登记的名称（来自可视化内库的图标模块；UI 不保存图形数据副本）：

`activity`、`adjustments`、`affiliate`、`alarm`、`alert-triangle`、`alibabacloud`、`amazonwebservices`、`analyze`、`android`、`angular`、`antenna`、`apache`、`apachecassandra`、`apachekafka`、`apachespark`、`api`、`app-window`、`apple`、`apps`、`archive`、`arrow-narrow-right`、`arrow-right`、`arrows-exchange`、`arrows-right`、`arrows-split`、`atom`、`award`、`bell`、`binary`、`binary-tree`、`bolt`、`book`、`book-2`、`bookmark`、`box`、`box-multiple`、`brain`、`brand-docker`、`brand-github`、`brand-javascript`、`brand-python`、`brand-react`、`brand-typescript`、`briefcase`、`broadcast`、`browser`、`bucket`、`bug`、`building`、`building-bank`、`building-store`、`bulb`、`calendar`、`calendar-stats`、`camera`、`chart-bar`、`chart-dots`、`chart-histogram`、`chart-line`、`chart-pie`、`check`、`checklist`、`circle-check`、`circle-dot`、`clickhouse`、`clipboard`、`clock`、`cloud`、`cloud-computing`、`cloud-data-connection`、`cloud-lock`、`cloud-upload`、`code`、`code-dots`、`coin`、`columns`、`command`、`compass`、`components`、`container`、`cpu`、`credit-card`、`crown`、`cube`、`current-location`、`dashboard`、`database`、`database-search`、`databricks`、`device-analytics`、`device-desktop`、`device-imac`、`device-mobile`、`devices`、`diamond`、`docker`、`download`、`elasticsearch`、`eye`、`file`、`file-code`、`file-database`、`file-text`、`filter`、`fingerprint`、`flag`、`flame`、`folder`、`folders`、`forms`、`function`、`gauge`、`git`、`git-branch`、`git-fork`、`git-merge`、`github`、`gitlab`、`globe`、`go`、`google`、`googlecloud`、`grafana`、`graphql`、`grid-dots`、`hash`、`heart`、`helm`、`hexagon`、`hierarchy`、`history`、`home`、`html5`、`id`、`inbox`、`info-circle`、`javascript`、`jenkins`、`key`、`kotlin`、`kubernetes`、`language`、`layers-linked`、`layout-board`、`layout-grid`、`layout-kanban`、`library`、`link`、`linux`、`list`、`list-details`、`lock`、`lock-access`、`mail`、`map`、`mariadb`、`message`、`message-2`、`message-circle`、`messages`、`microphone`、`mongodb`、`mysql`、`network`、`news`、`nextdotjs`、`nginx`、`nodedotjs`、`notebook`、`notification`、`openai`、`openjdk`、`opentelemetry`、`package`、`packages`、`photo`、`player-play`、`player-skip-forward`、`plug`、`postgresql`、`prometheus`、`puzzle`、`python`、`rabbitmq`、`react`、`receipt`、`redis`、`refresh`、`repeat`、`report`、`report-analytics`、`robot`、`rocket`、`route`、`rss`、`rust`、`scale`、`schema`、`search`、`send`、`server`、`server-2`、`settings`、`settings-automation`、`share`、`shield`、`shield-check`、`shield-lock`、`shopping-cart`、`sitemap`、`source-code`、`sparkles`、`speakerphone`、`spring`、`sqlite`、`stack`、`stack-2`、`star`、`table`、`table-options`、`tag`、`target`、`template`、`terminal`、`terraform`、`timeline`、`timeline-event`、`toggle-right`、`tool`、`topology-star`、`transfer`、`trash`、`truck`、`typescript`、`ubuntu`、`upload`、`user`、`user-check`、`users`、`users-group`、`vector-triangle`、`versions`、`video`、`vuedotjs`、`wallet`、`wand`、`webhook`、`webpack`、`wifi`、`world`、`zoom-code`

运行时生成的 `ui-*` class（例如 `.ui-combo`、`.ui-date-panel`、`.ui-notes`）由工具栏、下拉、月历和标注组件使用；它们不是内容组件 API，不要在界面稿中依赖或覆写。
