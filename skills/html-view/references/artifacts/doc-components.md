# 文档组件

编写或审查阅读文档中的结构、图形、评论和组件时读取本 reference。组件只在比连续文字更清楚时使用。

## 基本结构

- 使用语义化标题、段落、有序/无序列表和表格。表格用于字段对照、决策项和少量精确数据，不用空格手工排版。
- 需要突出结论时，可用文首摘要；只有能帮助读者扫读时才给章节增加一句 `lead`。普通说明文档按读者任务排序，不套用看板式结构。
- 手写 HTML 提示条用 `<div class="note" data-k="warn"><b class="note-k">注意</b><div>写明条件与影响。</div></div>`。`data-k` 按语义取 `accent`、`ok`、`info`、`warn`、`danger`、`new` 或 `neutral`，不用固定颜色。Markdown 提示条写法见[文档流程](doc.md#从-markdown-构建)。
- 连续步骤用 `<ol class="steps">`；时间线用 `<ol class="timeline">`，日期放在每项的 `.tl-date`；次要材料用 `<details class="fold"><summary>…</summary><div class="fold-body">…</div></details>`。没有分组价值时用普通段落或列表。

## 图形

图形使用唯一源码元素，类型取 `kchart`、`mermaid`、`layers`、`blocks` 或 `swimlane`：

```html
<pre data-viz="kchart" id="fig-enrollment">{"chart":"bar","title":"新注册用户逐季增长","data":[{"quarter":"Q1","users":120},{"quarter":"Q2","users":150}],"encode":{"category":"quarter","value":"users"}}</pre>
```

正文与图形输入只保存源码；派生 SVG 由运行时生成，不写回文件。图题写在源码内，不能另加一份与图形不一致的 HTML 标题。跨图链接引用该元素的 `id`：

```html
<p>趋势见 <a class="xref" href="#fig-enrollment"></a>。</p>
```

用 KChart `bar` 或 `bullet` 表达条形比较；用 KChart `data`、`encode` 描述数值图。用普通表格展示需要逐行查阅的记录。

## 代码

普通代码使用 `pre > code`，按需给出语言 class。Prism 在离线文档外壳中提供高亮；高亮是呈现增强，不改变代码内容和语义。长行允许横向滚动，不用插入硬换行改变原始代码。

## 评论

文档运行时允许读者选择正文文字并添加评论，评论保存在当前浏览器本地。导出生成以 `Review Document:` 开头、带文件路径、章节位置、所选文字和评论内容的文本；接收评论时逐条定位原文，先判断是否要求修改。评论导出不是文档正文，除非作者明确将其转化为内容，否则不写回 HTML。

## 检查

文档类型与版式由 doc 产物审计；图题、图形语法、布局和模块覆盖由共享审计。布局或图形有变化时，执行显示检查并查看真实截图；截图应来自当前文档的真实渲染，不用手工绘制或复制图形截图。
