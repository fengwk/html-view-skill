# 层级图

组织、分类或逐级拆分适合用树；围绕一个主题向外展开适合用脑图。需要卡片、注释或数值时，使用 KChart 声明，不要把 Mermaid 脑图当成可自由定制的布局。

## 图型 `tree`

用于固定的组织、分类或分解关系。KChart `data` 是含 `label`、可选 `children` 的单个根节点；支持 `right`、`left`、`org`、`brace`，默认 `right`。最多 80 个节点、5 层。节点可带 `note`、`value` 与受控 `status`；采用真实层级，超过上限拆图。

## 图型 `mindmap`

需要节点读数、附注或卡片构图时使用同样的 KChart 层级数据，支持下列八种布局和 `variant: "cards"`。以下用法适用于直接写 Mermaid 脑图。

## mindmap

只接受一个根节点，用空格缩进表达父子关系。`(( ))`、`{{ }}`、`)) ((`、`[ ]`、`( )`、`) (` 等外壳会绘制对应形状。把 `:::类名` 或 `::icon(引用)` 放在所修饰节点的下一行。支持[通用样式、链接和图标](mermaid.md)；Tab 缩进、多根、行内装饰或头行参数报错。

用 `config.layout` 或 `config.mindmap.layoutAlgorithm` 选择 `bilateral`（默认）、`right`、`left`、`radial`、`org`、`brace`、`fishbone`、`timeline`。`tidy-tree`、`dagre`、`elk`、`cose-bilkent` 按默认布局绘制；其他名称回退到默认布局并告警。

```mermaid
---
title: 搜索能力按召回与排序拆分
config:
  layout: brace
---
mindmap
  root((搜索能力))
    召回
      向量召回
      倒排召回
    排序
      粗排
      精排
```

需要节点注释、数值或卡片式布局时改用 KChart 层级图声明。

## ishikawa

也接受 `ishikawa-beta`。鱼骨图用缩进表达：第一行是要分析的问题，下一级是原因类别（如 Process、User、Equipment），再下级是具体原因，可继续细分。用于原因分类，不表达时间或流程。通用样式与安全链接以 `root` 引用问题，以 `n1`、`n2`……按源码顺序引用原因。标签支持图标。无专用配置键；缺少问题会报错，问题标签过长会提示。

## treeView-beta

目录树：用 `├──`、`└──`、`│` 画出的文件树，或按缩进逐行写名称；以 `/` 结尾的名称是目录。适合展示代码库或文档结构。名称后可写 `:::highlight` 或状态类、`icon(名称)` 及 `## 描述`（描述放在最后）。默认给目录和文件绘制内置图标；名称开头的 emoji 代替默认图标。`icon(none)` 隐藏当前图标，未知图标回退到默认图标并提示。前置 `config.treeView` 支持 `showIcons: false`（全图隐藏）、`filenameIcons`、`extensionIcons`（键带点，如 `.ts`）、`rowIndent`、`paddingX`、`paddingY`、`lineThickness`；间距和线宽保持在可读范围内。通用样式与链接以显示名称为目标（目录名不带末尾 `/`）。头行参数、缺少条目名或无法识别的条目注解会报错。
