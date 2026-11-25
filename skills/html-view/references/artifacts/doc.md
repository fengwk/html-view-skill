# 阅读文档

文档类型、Markdown 构建与源保护、版式和文档专属检查使用本 reference。

## 类型

| `--type` | 用途 | 外壳版式 |
|---|---|---|
| `tech-spec` | 技术方案 | 侧栏目录 + 正文 |
| `plan` | 计划、路线图 | 侧栏目录 + 正文 |
| `report` | 调研、分析、评审结论、复盘 | 侧栏目录 + 正文 |
| `doc` | 指南、说明、纪要等文章 | 侧栏目录 + 正文 |
| `one-pager` | 提案、进展同步 | 单栏；最多 5 个二级章节 |
| `explainer` | 以图解释系统、流程或概念 | 单栏 |

类型值严格区分大小写；未知值应更正为上表中的一种，不以普通 HTML 或其他产物类型代替。`tech-spec` 以 Markdown 为源，没有 HTML 骨架；使用 `doc build` 创建与更新。其他类型可用 `doc new` 生成骨架，或用 `doc build` 从 Markdown 转写。

## 新建骨架

```sh
htmlview doc new docs/plan/launch.html --type plan --title "虚构功能发布计划" --lang zh-CN
```

命令生成统一 `htmlview` 外壳、文档类型元数据和章节骨架。只编辑 `<!-- htmlview:content -->` 与 `<!-- /htmlview:content -->` 之间的内容及 `<title>`。骨架中的 `data-todo` 是待填写位置；删除不适用的整节，不留空标题。`--force` 只在明确要求覆盖目标时使用。`tech-spec` 不支持 `doc new`，应从 Markdown 构建。

## 从 Markdown 构建

```sh
htmlview doc build docs/notes/launch.md --out docs/plan/launch.html --type plan
```

Markdown 标题用来生成页面标题。构建后的外壳在 `htmlview:doc:source` 记录相对 HTML 输出文件的 Markdown 源路径；只对记录的同一源文件进行原位更新。目标已存在但不是 doc 产物，或记录了其他源文件时，命令拒绝改写并保持目标不变。确需替换其他内容，先明确替换授权再传 `--force`。成功输出中的 `changedParts` 只列被更新的文首或章节，缺失的章节不会被并入其他 Markdown 手稿，也不会因比较被误报为未变化。

Markdown 源的内容是唯一编辑源；构建后不要直接修改 HTML 内容区。Markdown 的 fenced code block 中，`kchart`、`mermaid`、`layers`、`blocks`、`swimlane` 转为统一 `pre[data-viz]` 源元素；普通 `json` 仍作为代码示例。Markdown 图片和相对路径资源按源文件所在目录解释。

除标准 Markdown 外，还支持这些写法：

- 提示条：引用块首行写 `> [!NOTE]` 或 `> [!TIP]`（说明）、`> [!IMPORTANT]` 或 `> [!WARNING]`（注意）、`> [!CAUTION]`（风险），其后的引用行是正文。
- 固定锚点：标题末尾写 `{#id}`，交叉引用不随章节顺序变化。标题里手写的连续编号会被去掉，由外壳统一编号。
- 折叠：`<details>` 与 `<summary>`。
- 前言：文首 `---` 包住的 YAML 中 `title` 作为页面标题，还有其他字段时，前言区以 `yaml` 代码块原样展示整段 YAML（含 `title`）。

## 图题与交叉引用

图题只写在图形源码中：KChart JSON 的 `title`，或 Mermaid / 原生结构图的前言区 `title`。图标题表达结论，不只重复图型或主题名称。图形源码元素的 `id` 可用于正文交叉引用：

```html
<a class="xref" href="#fig-enrollment"></a>
```

文档运行时根据标题和图形目标填入编号及名称。图题缺失、图语法、图布局和外壳模块覆盖都由共享图形/外壳审计报告；doc 审计不重复这些图形规则。

## 文档版式检查

文档专属审计验证文档类型元数据、类型与版式匹配，以及一页纸长度。页面标题、图题、图形语法与布局、外壳模块和通用 HTML 结构由共享静态审计处理。`audit` 返回 `failures` 与 `notes`；根据失败项的 `line`、`detail`、`fix` 修复内容，或在图形模块不足时重组外壳。

技术方案、计划和报告先保证章节逻辑与来源可追溯；一页纸围绕结论和决策压缩篇幅；图解用一张总图建立全景，再用少量文字说明图中不易读出的规则。不要为满足骨架保留没有信息的章节。
