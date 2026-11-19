# Mermaid 12.3.0 conformance fixtures

`mermaid-12.3.0.json` contains all `mermaid`, `mermaid-example`, and
`mermaid-nocode` fences in the [official syntax docs][syntax] at tag
`mermaid@12.3.0` (commit `2086904e76c692331e34a45d7cc3bc30860d040e`).
Record IDs use the doc basename and the 1-based **first source line**
(the line immediately after the opening fence). `header` is the source
keyword; `type` is Mermaid's diagram ID. Real Mermaid 12.3.0 parses 525
records; the 16 ZenUML examples require an external plugin and carry the
core parser's error. A `valid` result does not imply KChart renders it yet.

From the repository root (requires Node, npm, Git, tar, and Chrome/Chromium):

```sh
node --test packages/kchart/tests/conformance/extract.node.mjs
TMPDIR=/var/tmp node packages/kchart/conformance/extract.mjs mermaid@12.3.0 > corpus.json
node packages/kchart/conformance/repo-examples.mjs > examples.json
TMPDIR=/var/tmp node packages/kchart/conformance/validate.mjs examples.json > report.json
```

Pass a local checkout after the tag to skip cloning. `validate.mjs` uses
real Mermaid in headless Chrome via CDP and exits 1 if core rejects any
record, including examples that require a plugin. See the
[published-examples audit][audit] for the baseline results.

[syntax]: https://github.com/mermaid-js/mermaid/tree/mermaid%4012.3.0/packages/mermaid/src/docs/syntax
[audit]: ../../conformance/published-report.json

## Mermaid — MIT License

Copyright (c) 2014 - 2022 Knut Sveidqvist

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
