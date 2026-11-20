# htmlview 命令维护

使用 Node.js 22+。在本目录运行 `node htmlview --help`；浏览器命令自动寻找 Chrome/Chromium/Edge，也可设置 `CHROME_PATH`。脚本按自身位置定位资产，不取其他技能目录或工作目录中的脚本。

从仓库根目录安装 KChart 的开发依赖，再运行技能测试：

```sh
(cd packages/kchart && npm ci && npm test)
TMPDIR=/var/tmp node --test skills/html-view/scripts/tests/*.test.mjs
(cd skills/html-view/assets/vendor && sha256sum -c prism.js.sha256)
```

Prism 为离线代码高亮，包含上游 MIT 声明。`prism.js.sha256` 固定随技能发布的实际文件。

视觉复现：`node scripts/lab/showcase/generate.mjs` 生成完整筛选展册；`scripts/lab/regression/kchart-gallery.mjs` 和 `kchart-fuzz.mjs` 用实际 Chrome 验证边界与随机样本，参数见文件开头。图库和外壳使用 `skills/html-view/vendor/kchart` 中的构建产物，浏览器脚本按声明选择所需单元。库的源码、API 及独立测试见仓库根目录下的 `packages/kchart/README.md`。

新增内置主题前，先用 `--theme-file` 在真实文档、数据图和结构图上预览。将确认后的 JSON 保存为 `packages/kchart/assets/themes/<id>.json`，填写 `id`、`name`、`en`、`desc`；可选 `order` 为非负整数，省略时排在有 `order` 的主题之后。在 `packages/kchart` 运行 `npm run build && npm run vendor`。CLI、KChart、主题测试和图库生成器自动发现新主题；发布仓库前重新生成 README 主题样张。
