# 检查、截图、导出与阅读

已有 HTML，不确定如何显示、打印或从中提取信息时读本页。以下命令操作本地文件；`check` 每次只接受一个文件。截图与导出使用实际浏览器排版，不读远程字体或脚本来补救离线产物。

| 目的 | 命令与结果 |
|---|---|
| 检查本地页面 | `htmlview check report.html` 检查桌面、手机、导出和打印；看 `failures` 的位置、细节和修法 |
| 首屏与局部截图 | `htmlview shot report.html --out shots` 生成桌面和手机首屏及每张图的截图；`--select 'figure'` 只截指定元素，`--section id` 按页面锚点截，`--mode export` 截静态展开状态 |
| 完整宽图 | `htmlview export report.html --format png --select '.viz-body svg' --out chart.png`；多个命中会生成编号文件。选择 SVG 本身，避免只截滚动容器可见部分 |
| 打印 | `htmlview export report.html --format pdf --out report.pdf` |
| 整页长图 | `htmlview export report.html --format png --out page.png` 生成从页首到页尾的完整截图；加 `--device mobile` 按手机宽度生成 |
| 阅读正文 | `htmlview read report.html --outline` 找标题和锚点；`htmlview read report.html --section method --out method.md` 抽取一节；不写 `--out` 时读取 JSON 内容 |
| 内嵌本地文件 | `htmlview embed doc.html` 以 data URI 内嵌本地图片，读取 `<pre data-src="…">` 的本地代码；会更新目标，查看 `missing` 并补齐 |

- `audit` 检查内容和外壳中的资源引用；图片、字体、样式等页面依赖须内嵌，读者主动打开的普通外部链接可以保留。`check` 在浏览器中阻止并报告尝试发出的 HTTP(S) 请求。两者不是任意 HTML 的安全沙箱，只处理可信来源的本地文件。
- `check` 通过后仍要打开实际截图。重点看屏幕窄时标题、标签和控件能否读清楚，连线是否指向正确的节点。点击原型时检查屏幕、状态、返回与表单。
- 单个图或表需要横向滚动是正常现象；整页不应横向溢出。`PRINT_CLIP` 表示内容超出打印版心，PDF 不会写出。宽图可试 `--paper a4-landscape`，放不进单页的高图可试 `--paper a3-portrait`；`check` 和 PDF `export` 使用同一纸型与版心，不改源 HTML。未指定 `--paper` 时沿用生效的 `@page`；没有页面规则时用 A4 和四边 15mm。仍放不下时按类或时段拆图、换较窄的布局，或交付完整 SVG，不删数据或缩字。导出后阅读实际 PDF，核对分页和图题、图身是否同页。
- 界面稿默认按设备画布生成 PDF；响应式稿同时输出手机与桌面状态。更大的纸不会放宽画布内部的滚动区。若该区在打印时放不下表或图，保留可滚动的 HTML；需要 PDF 时，先重排组件并复查各状态。
- 文档与界面稿可在发布前内嵌本地材料；数据报表的内容区受完整性保护。内嵌或正文修订必须在数据包输入阶段完成，再构建报表。
