# htmlview 命令维护

使用 Node.js 22+。在本目录运行 `node htmlview --help`；浏览器命令自动寻找 Chrome/Chromium/Edge，也可设置 `CHROME_PATH`。脚本按自身位置定位资产，不取其他技能目录或工作目录中的脚本。

从技能根目录运行：

```sh
node --experimental-vm-modules --test kchart/tests/*.test.mjs scripts/tests/*.test.mjs
(cd assets/vendor && sha256sum -c prism.js.sha256)
```

Prism 为离线代码高亮，包含上游 MIT 声明。`prism.js.sha256` 固定随技能发布的实际文件。

视觉复现：`node scripts/lab/showcase/generate.mjs` 生成完整筛选展册；`scripts/lab/regression/kchart-gallery.mjs` 和 `kchart-fuzz.mjs` 用实际 Chrome 验证边界与随机样本，参数见文件开头。图库、外壳和浏览器脚本均从声明及模块现场组装，不把整包构建物写回源码。KChart 的两个程序入口及独立测试见 [库说明](../kchart/README.md)；该 README 随独立 npm 包分发。
