# HTML View

**让 Agent 稳定交付好读的 HTML：文档、数据报表、Dashboard 与可点击原型。**

简体中文 · [English](README.en.md)

把 Markdown、已汇总的 CSV／JSON 或一段产品流程交给 Agent，它会交回一个**可以离线打开的 HTML 文件**。图表、主题和交互都内嵌在文件里，不用启动服务器，也不从网络加载资源。交付前，Agent 会在真实浏览器里检查窄屏和打印版心，需要时再导出 PDF 或 PNG。

[快速开始](#quick-start) · [交付样张](#showcase) · [**45 种数据图与 30 种结构图**](#gallery) · [六套主题](#themes) · [安装说明](#install) · [更新与卸载](#update-uninstall)

<p align="center"><a href="docs/showcase/previews/zh-CN/dashboard-hero.png"><picture><source media="(max-width: 600px)" srcset="docs/showcase/previews/zh-CN/dashboard-mobile.png"><img src="docs/showcase/previews/zh-CN/dashboard-hero.png" width="840" alt="Claude 暖白主题的虚构咖啡经营看板：四张指标卡、收入走势和渠道对比"></picture></a></p>

*实际生成的 Dashboard：宽屏双列，手机上改为单列。渠道视图可离线切换；样例数据均为虚构。*

<a id="quick-start"></a>

## 快速开始

**1. 安装。** 需要 Git 和 Node.js 22+。先下载脚本，看过再执行：

```bash
# macOS / Linux / WSL
curl -fsSL --proto '=https' -o install-html-view.sh https://raw.githubusercontent.com/fengwk/html-view-skill/main/scripts/install.sh
bash ./install-html-view.sh
```

```powershell
# Windows PowerShell
Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/fengwk/html-view-skill/main/scripts/install.ps1' -OutFile '.\install-html-view.ps1'
.\install-html-view.ps1
```

**2. 重开 Agent。** Codex、Pi 和 Claude Code 的技能列表里会出现 `html-view`。其他 Agent 见[安装说明](#install)。

**3. 说出你要的 HTML。** 例如：

> 用 HTML View 把 `proposal.md` 做成一份可以批注的技术方案。保留决策和风险，画清服务之间的调用链；交付 HTML 和检查过的 PDF。

> 把这些已汇总的 CSV 做成离线 Dashboard。首屏看关键指标、收入趋势和渠道差异，数字要能打开明细核对；缺失别填成 0。

> 做一个可点的报销原型。包含列表、详情、提交失败和成功状态；在手机宽度实际走一次提交流程。

Agent 生成 HTML 后会运行 `htmlview audit` 检查内容和资源，再用 `htmlview check` 在桌面、手机和打印版心下实际打开。截图、导出 PDF 和渲染独立图需要本机有 Chrome 或 Chromium（可用 `CHROME_PATH` 指定）。

<a id="showcase"></a>

## 交付样张

| 产物 | 打开文件后，你能做什么 |
|---|---|
| [阅读文档](skills/html-view/references/artifacts/doc.md) | 从目录跳转、对照编号与图表、逐段批注；检查打印后导出 PDF |
| [数据报表](skills/html-view/references/artifacts/data.md) | 看同比环比，打开明细，核对指标口径、来源和原始读数 |
| [Dashboard](skills/html-view/references/artifacts/data.md) | 首屏扫读关键指标、趋势和异常；用预计算视图切换渠道或区域，不查询线上数据 |
| [可点击原型](skills/html-view/references/artifacts/ui.md) | 走通页面切换、表单校验、筛选和状态变化；不调用业务服务 |

<table>
<tr><td width="50%"><strong>阅读文档 · 通知平台技术方案</strong><br><a href="docs/showcase/previews/zh-CN/doc-reading.png"><img src="docs/showcase/previews/zh-CN/doc-reading.png" alt="Claude 主题的技术方案：左侧目录，正文中的范围表" width="100%"></a></td><td width="50%"><strong>数据报表 · 拾光咖啡月报</strong><br><a href="docs/showcase/previews/zh-CN/data-periodic.png"><img src="docs/showcase/previews/zh-CN/data-periodic.png" alt="Claude 主题的经营月报：六项关键指标、同比环比和收入走势" width="100%"></a></td></tr>
</table>

**可点击原型 · 留存观察台**

<table>
<tr><td width="72%"><a href="docs/showcase/previews/zh-CN/ui-desktop-overview.png"><img src="docs/showcase/previews/zh-CN/ui-desktop-overview.png" alt="留存观察台桌面概览：指标、趋势和状态提醒" width="100%"></a></td><td width="28%"><a href="docs/showcase/previews/zh-CN/ui-mobile-filtered.png"><img src="docs/showcase/previews/zh-CN/ui-mobile-filtered.png" alt="同一原型在手机上的渠道与日期筛选结果" width="100%"></a></td></tr>
</table>

同一份原型，桌面看经营概览，手机走渠道与日期筛选。原型的配色由 `--brand` 和 `--scheme` 控制。

[样例源码与复现方式 →](docs/showcase/README.md)

<a id="gallery"></a>

## KChart 图谱

HTML View 的图表由自带的 KChart 库绘制：**45 种数据图、38 项受控变体、27 种 Mermaid 子集图型、3 种原生结构图、8 种脑图布局**。下面每一种都有一张真实渲染的样张，统一使用 Claude 配色。点击图片打开原尺寸 SVG；宽图独占一行，不为拼图缩小文字。

[生成可筛选的完整图库 →](docs/showcase/README.md#full-gallery)

<!-- gallery:begin -->
<a id="charts"></a>

### 数据图

[趋势与时间](#trends) · [比较、目标与区间](#comparison) · [构成与增减](#composition) · [分布与相关](#distribution) · [矩阵与多维](#matrix) · [层级](#hierarchy) · [网络、流量与路径](#relations) · [地图](#geography)

<a id="trends"></a>

#### 趋势与时间

<p align="center"><a href="docs/showcase/gallery/zh-CN/trends-1.svg"><img src="docs/showcase/gallery/zh-CN/trends-1.svg" width="360" align="top" alt="走势、迷你走势、流图、上下对照"></a> <a href="docs/showcase/gallery/zh-CN/trends-2.svg"><img src="docs/showcase/gallery/zh-CN/trends-2.svg" width="360" align="top" alt="堆叠面积、小多图、开收与高低"></a></p>

<p align="center"><a href="docs/showcase/gallery/zh-CN/trends-wide-1.svg"><img src="docs/showcase/gallery/zh-CN/trends-wide-1.svg" width="780" align="top" alt="双轴组合、排名变动"></a></p>

<p align="center"><a href="docs/showcase/gallery/zh-CN/trends-wide-2.svg"><img src="docs/showcase/gallery/zh-CN/trends-wide-2.svg" width="780" align="top" alt="从开张到现在"></a></p>

<a id="comparison"></a>

#### 比较、目标与区间

<p align="center"><a href="docs/showcase/gallery/zh-CN/comparison-1.svg"><img src="docs/showcase/gallery/zh-CN/comparison-1.svg" width="360" align="top" alt="横向比较、前后差距、实际与目标"></a> <a href="docs/showcase/gallery/zh-CN/comparison-2.svg"><img src="docs/showcase/gallery/zh-CN/comparison-2.svg" width="360" align="top" alt="纵向比较、变化方向、完成度、区间与中位数"></a></p>

<a id="composition"></a>

#### 构成与增减

<p align="center"><a href="docs/showcase/gallery/zh-CN/composition-1.svg"><img src="docs/showcase/gallery/zh-CN/composition-1.svg" width="360" align="top" alt="占比条、环形图、玫瑰图、百格图"></a> <a href="docs/showcase/gallery/zh-CN/composition-2.svg"><img src="docs/showcase/gallery/zh-CN/composition-2.svg" width="360" align="top" alt="饼图、份额与强度、漏斗、多选比例"></a></p>

<p align="center"><a href="docs/showcase/gallery/zh-CN/composition-wide-1.svg"><img src="docs/showcase/gallery/zh-CN/composition-wide-1.svg" width="780" align="top" alt="瀑布"></a></p>

<a id="distribution"></a>

#### 分布与相关

<p align="center"><a href="docs/showcase/gallery/zh-CN/distribution-1.svg"><img src="docs/showcase/gallery/zh-CN/distribution-1.svg" width="360" align="top" alt="直方图、散点条"></a> <a href="docs/showcase/gallery/zh-CN/distribution-2.svg"><img src="docs/showcase/gallery/zh-CN/distribution-2.svg" width="360" align="top" alt="箱线图、小提琴图、散点图"></a></p>

<a id="matrix"></a>

#### 矩阵与多维

<p align="center"><a href="docs/showcase/gallery/zh-CN/matrix-1.svg"><img src="docs/showcase/gallery/zh-CN/matrix-1.svg" width="360" align="top" alt="热力图、雷达图"></a> <a href="docs/showcase/gallery/zh-CN/matrix-2.svg"><img src="docs/showcase/gallery/zh-CN/matrix-2.svg" width="360" align="top" alt="气泡矩阵"></a></p>

<p align="center"><a href="docs/showcase/gallery/zh-CN/matrix-wide-1.svg"><img src="docs/showcase/gallery/zh-CN/matrix-wide-1.svg" width="780" align="top" alt="平行坐标、日历"></a></p>

<a id="hierarchy"></a>

#### 层级

<p align="center"><a href="docs/showcase/gallery/zh-CN/hierarchy-1.svg"><img src="docs/showcase/gallery/zh-CN/hierarchy-1.svg" width="360" align="top" alt="层级树、旭日图"></a> <a href="docs/showcase/gallery/zh-CN/hierarchy-2.svg"><img src="docs/showcase/gallery/zh-CN/hierarchy-2.svg" width="360" align="top" alt="矩形树图"></a></p>

<p align="center"><a href="docs/showcase/gallery/zh-CN/hierarchy-wide-1.svg"><img src="docs/showcase/gallery/zh-CN/hierarchy-wide-1.svg" width="780" align="top" alt="脑图"></a></p>

<a id="relations"></a>

#### 网络、流量与路径

<p align="center"><a href="docs/showcase/gallery/zh-CN/relations-1.svg"><img src="docs/showcase/gallery/zh-CN/relations-1.svg" width="360" align="top" alt="关系网络"></a></p>

<p align="center"><a href="docs/showcase/gallery/zh-CN/relations-wide-1.svg"><img src="docs/showcase/gallery/zh-CN/relations-wide-1.svg" width="780" align="top" alt="桑基图、路径流向"></a></p>

<a id="geography"></a>

#### 地图

<p align="center"><a href="docs/showcase/gallery/zh-CN/geography-wide-1.svg"><img src="docs/showcase/gallery/zh-CN/geography-wide-1.png" width="780" align="top" alt="分区着色、地图散点"></a></p>

<a id="diagrams"></a>

### 结构图

[流程、状态与旅程](#process) · [时序与数据模型](#model) · [排期、看板与协议](#planning) · [架构与分层](#architecture) · [C4 的五个视角](#c4) · [Mermaid 数值图](#mermaid-data) · [一棵树，八种脑图布局](#mindmaps)

<a id="process"></a>

#### 流程、状态与旅程

<p align="center"><a href="docs/showcase/gallery/zh-CN/process-1.svg"><img src="docs/showcase/gallery/zh-CN/process-1.svg" width="360" align="top" alt="状态图"></a></p>

<p align="center"><a href="docs/showcase/gallery/zh-CN/process-wide-1.svg"><img src="docs/showcase/gallery/zh-CN/process-wide-1.svg" width="780" align="top" alt="流程图、体验旅程"></a></p>

<p align="center"><a href="docs/showcase/gallery/zh-CN/process-wide-2.svg"><img src="docs/showcase/gallery/zh-CN/process-wide-2.svg" width="780" align="top" alt="泳道图"></a></p>

<a id="model"></a>

#### 时序与数据模型

<p align="center"><a href="docs/showcase/gallery/zh-CN/model-1.svg"><img src="docs/showcase/gallery/zh-CN/model-1.svg" width="360" align="top" alt="ZenUML、需求图"></a> <a href="docs/showcase/gallery/zh-CN/model-2.svg"><img src="docs/showcase/gallery/zh-CN/model-2.svg" width="360" align="top" alt="类图"></a></p>

<p align="center"><a href="docs/showcase/gallery/zh-CN/model-wide-1.svg"><img src="docs/showcase/gallery/zh-CN/model-wide-1.svg" width="780" align="top" alt="时序图、ER 图"></a></p>

<a id="planning"></a>

#### 排期、看板与协议

<p align="center"><a href="docs/showcase/gallery/zh-CN/planning-wide-1.svg"><img src="docs/showcase/gallery/zh-CN/planning-wide-1.svg" width="780" align="top" alt="甘特图、时间线"></a></p>

<p align="center"><a href="docs/showcase/gallery/zh-CN/planning-wide-2.svg"><img src="docs/showcase/gallery/zh-CN/planning-wide-2.svg" width="780" align="top" alt="Git 分支、看板"></a></p>

<p align="center"><a href="docs/showcase/gallery/zh-CN/planning-wide-3.svg"><img src="docs/showcase/gallery/zh-CN/planning-wide-3.svg" width="780" align="top" alt="报文位域、四象限"></a></p>

<a id="architecture"></a>

#### 架构与分层

<p align="center"><a href="docs/showcase/gallery/zh-CN/architecture-1.svg"><img src="docs/showcase/gallery/zh-CN/architecture-1.svg" width="360" align="top" alt="分层图"></a></p>

<p align="center"><a href="docs/showcase/gallery/zh-CN/architecture-wide-1.svg"><img src="docs/showcase/gallery/zh-CN/architecture-wide-1.svg" width="780" align="top" alt="能力块、架构图"></a></p>

<p align="center"><a href="docs/showcase/gallery/zh-CN/architecture-wide-2.svg"><img src="docs/showcase/gallery/zh-CN/architecture-wide-2.svg" width="780" align="top" alt="块图"></a></p>

<a id="c4"></a>

#### C4 的五个视角

<p align="center"><a href="docs/showcase/gallery/zh-CN/c4-1.svg"><img src="docs/showcase/gallery/zh-CN/c4-1.svg" width="360" align="top" alt="系统上下文、组件、部署"></a> <a href="docs/showcase/gallery/zh-CN/c4-2.svg"><img src="docs/showcase/gallery/zh-CN/c4-2.svg" width="360" align="top" alt="容器、动态"></a></p>

<a id="mermaid-data"></a>

#### Mermaid 数值图

<p align="center"><a href="docs/showcase/gallery/zh-CN/mermaid-data-1.svg"><img src="docs/showcase/gallery/zh-CN/mermaid-data-1.svg" width="360" align="top" alt="饼图、雷达图"></a> <a href="docs/showcase/gallery/zh-CN/mermaid-data-2.svg"><img src="docs/showcase/gallery/zh-CN/mermaid-data-2.svg" width="360" align="top" alt="XY 图、桑基图、矩形树图"></a></p>

<a id="mindmaps"></a>

#### 一棵树，八种脑图布局

<p align="center"><a href="docs/showcase/gallery/zh-CN/mindmaps-1.svg"><img src="docs/showcase/gallery/zh-CN/mindmaps-1.svg" width="360" align="top" alt="向右、括号"></a> <a href="docs/showcase/gallery/zh-CN/mindmaps-2.svg"><img src="docs/showcase/gallery/zh-CN/mindmaps-2.svg" width="360" align="top" alt="向左"></a></p>

<p align="center"><a href="docs/showcase/gallery/zh-CN/mindmaps-wide-1.svg"><img src="docs/showcase/gallery/zh-CN/mindmaps-wide-1.svg" width="780" align="top" alt="Mermaid 脑图、双侧"></a></p>

<p align="center"><a href="docs/showcase/gallery/zh-CN/mindmaps-wide-2.svg"><img src="docs/showcase/gallery/zh-CN/mindmaps-wide-2.svg" width="780" align="top" alt="放射、组织"></a></p>

<p align="center"><a href="docs/showcase/gallery/zh-CN/mindmaps-wide-3.svg"><img src="docs/showcase/gallery/zh-CN/mindmaps-wide-3.svg" width="780" align="top" alt="鱼骨、时间线"></a></p>

<a id="variants"></a>

### 受控变体

[柱、线与标记](#variants-marks) · [占比与阶段](#variants-part) · [目标、差距与分布](#variants-value) · [矩阵、日历与网络](#variants-pattern)

<a id="variants-marks"></a>

#### 柱、线与标记

<p align="center"><a href="docs/showcase/gallery/zh-CN/variants-marks-1.svg"><img src="docs/showcase/gallery/zh-CN/variants-marks-1.svg" width="360" align="top" alt="横向比较 · 实心、横向比较 · 图标、纵向比较 · 实心、纵向比较 · 图标、走势 · 末值突出"></a> <a href="docs/showcase/gallery/zh-CN/variants-marks-2.svg"><img src="docs/showcase/gallery/zh-CN/variants-marks-2.svg" width="360" align="top" alt="横向比较 · 单位刻度、横向比较 · 棒棒糖、纵向比较 · 单位刻度、纵向比较 · 棒棒糖、走势 · 条码"></a></p>

<a id="variants-part"></a>

#### 占比与阶段

<p align="center"><a href="docs/showcase/gallery/zh-CN/variants-part-1.svg"><img src="docs/showcase/gallery/zh-CN/variants-part-1.svg" width="360" align="top" alt="占比条 · 实心、环形图 · 实心、漏斗 · 横条、百格图 · 点阵"></a> <a href="docs/showcase/gallery/zh-CN/variants-part-2.svg"><img src="docs/showcase/gallery/zh-CN/variants-part-2.svg" width="360" align="top" alt="占比条 · 刻度、环形图 · 刻度、漏斗 · 沙漏、百格图 · 疏朗点阵"></a></p>

<a id="variants-value"></a>

#### 目标、差距与分布

<p align="center"><a href="docs/showcase/gallery/zh-CN/variants-value-1.svg"><img src="docs/showcase/gallery/zh-CN/variants-value-1.svg" width="360" align="top" alt="完成度 · 条形、完成度 · 刻度、前后差距 · 单位刻度、直方图 · 单位刻度、散点图 · 垂线"></a> <a href="docs/showcase/gallery/zh-CN/variants-value-2.svg"><img src="docs/showcase/gallery/zh-CN/variants-value-2.svg" width="360" align="top" alt="完成度 · 圆弧、前后差距 · 实心、直方图 · 实心、散点图 · 点阵"></a></p>

<p align="center"><a href="docs/showcase/gallery/zh-CN/variants-value-wide-1.svg"><img src="docs/showcase/gallery/zh-CN/variants-value-wide-1.svg" width="780" align="top" alt="瀑布 · 实心、瀑布 · 单位刻度"></a></p>

<a id="variants-pattern"></a>

#### 矩阵、日历与网络

<p align="center"><a href="docs/showcase/gallery/zh-CN/variants-pattern-1.svg"><img src="docs/showcase/gallery/zh-CN/variants-pattern-1.svg" width="360" align="top" alt="热力图 · 方格、热力图 · 圆弧"></a> <a href="docs/showcase/gallery/zh-CN/variants-pattern-2.svg"><img src="docs/showcase/gallery/zh-CN/variants-pattern-2.svg" width="360" align="top" alt="热力图 · 点阵、关系网络 · 连线、关系网络 · 弦膜"></a></p>

<p align="center"><a href="docs/showcase/gallery/zh-CN/variants-pattern-wide-1.svg"><img src="docs/showcase/gallery/zh-CN/variants-pattern-wide-1.svg" width="780" align="top" alt="日历 · 方格、日历 · 点阵"></a></p>

<p align="center"><a href="docs/showcase/gallery/zh-CN/variants-pattern-wide-2.svg"><img src="docs/showcase/gallery/zh-CN/variants-pattern-wide-2.svg" width="780" align="top" alt="脑图 · 编辑式、脑图 · 卡片式"></a></p>
<!-- gallery:end -->

<a id="themes"></a>

## 同一张图，六套主题

<!-- themes:begin -->
<p align="center"><a href="docs/showcase/gallery/zh-CN/themes-1.svg"><img src="docs/showcase/gallery/zh-CN/themes-1.svg" width="360" align="top" alt="Claude、Obsidian、Kanagawa"></a> <a href="docs/showcase/gallery/zh-CN/themes-2.svg"><img src="docs/showcase/gallery/zh-CN/themes-2.svg" width="360" align="top" alt="Paper、Tokyo Night、Terminal"></a></p>
<!-- themes:end -->

文档和报表换主题不用改内容：`htmlview style report.html --theme obsidian`。KChart 的程序接口可以直接传入一套自定义主题对象。要让 CLI 认出一个新的主题名，需要登记一份调色盘、加一个小型主题 CSS，不用改各图型的绘制逻辑。[主题扩展说明 →](docs/architecture.md#themes)

<a id="install"></a>

## 安装说明

安装脚本把仓库克隆到 `~/.agents/skill-lib/html-view-skill`，再从其中的 `skills/html-view` 建两个链接：

| 链接 | 读取它的 Agent |
|---|---|
| `~/.agents/skills/html-view` | [Codex](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills)、[Pi](https://docs.pi.dev/latest/skills) |
| `~/.claude/skills/html-view` | [Claude Code](https://code.claude.com/docs/en/skills#where-skills-live) |

这两个目录是各工具自己的约定，Agent Skills 规范没有规定统一位置。其他 Agent 请把 `skills/html-view` 链接或复制到它读取技能的目录。

- **可以重复运行。** 已有有效检出就直接复用，不自动拉取；检出损坏或来源不对就报错，不会覆盖。两个链接分别检查，同名文件、目录或断链都原样保留。
- **也可以手动克隆。** 克隆到上面的位置后运行脚本，它会补齐链接。
- **原生 Windows** 用目录联接（junction）代替符号链接，各 Agent 能否识别联接还没有在原生 Windows 上实测。WSL 使用其 Linux 环境中的 `$HOME`。
- **PowerShell 拦截脚本时：** 如果 `RemoteSigned` 只因文件来自互联网而拦截，核对内容后运行 `Unblock-File -LiteralPath '.\install-html-view.ps1'` 再执行，不必修改系统策略。

<a id="update-uninstall"></a>

## 更新与卸载

**更新：** 拉取克隆即可，两个链接仍指向同一个检出。

```bash
git -C "$HOME/.agents/skill-lib/html-view-skill" pull --ff-only
```

**卸载：** 先确认两个链接指向本项目，再删除链接。`rm` 不带 `-r` 时只删链接；如果那里是真实目录，它会报错而不是删除。

```bash
readlink ~/.agents/skills/html-view ~/.claude/skills/html-view   # 应指向 …/html-view-skill/skills/html-view
rm ~/.agents/skills/html-view ~/.claude/skills/html-view
```

Windows 上用 `cmd /c rmdir "<路径>"` 删除目录联接，不带 `/s` 时只删联接本身。最后确认没有其他入口在用，再移走 `~/.agents/skill-lib/html-view-skill`。安装时被跳过的同名项不属于本项目，请保留。

<a id="cli"></a>

## CLI 与维护

在项目根目录，从示例源构建一份文档并检查：

```sh
node skills/html-view/scripts/htmlview doc build docs/showcase/examples/zh-CN/notification-platform.md --type tech-spec --out notification-platform.html
node skills/html-view/scripts/htmlview audit notification-platform.html
node skills/html-view/scripts/htmlview check notification-platform.html --paper a3-portrait
node skills/html-view/scripts/htmlview export notification-platform.html --format pdf --paper a3-portrait --out notification-platform.pdf
```

`check` 用真实浏览器检查窄屏、图内溢出和打印版心；PDF 遇到裁切会停止，不会缩小图或字号。宽图可试 A4 横向，高图可试 A3 纵向；仍放不下就重排，或附上完整 SVG。分享 HTML 前请检查源码中的元数据：文档可能含 Markdown 源路径，报表内嵌了来源和计算证据。

[技能入口](skills/html-view/SKILL.md) · [CLI 与回归测试](skills/html-view/scripts/README.md) · [安装测试](scripts/tests/install.test.mjs) · [KChart API](skills/html-view/kchart/README.md) · [架构与主题扩展](docs/architecture.md)

<a id="license"></a>

## 许可

自有源码与文档采用 [MIT License](LICENSE)。Prism 保留其[上游 MIT 许可](skills/html-view/assets/vendor/prism.js)；图标、品牌商标和 Natural Earth 地图数据的条款见[第三方资产声明](skills/html-view/kchart/NOTICE.md)。
