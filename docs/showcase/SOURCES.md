# Sample sources and licenses

Fetched 2026-11-24T17:22Z. All figures in the dashboards come from these sources; none were invented.

## Kubernetes control-plane reading doc
- Source: official Kubernetes documentation, [Cluster Architecture](https://kubernetes.io/docs/concepts/architecture/)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), © The Kubernetes Authors
- Note: The prose is a condensed restatement for review, with attribution. The layer diagram is a redrawn explanation, not a copy of the official figure. The Kubernetes project itself is Apache-2.0.

## Kubernetes engineering dashboard
- Source: GitHub REST API for [kubernetes/kubernetes](https://github.com/kubernetes/kubernetes)
  - `GET /repos/kubernetes/kubernetes` (stars, forks, open_issues_count, subscribers_count)
  - `GET /repos/kubernetes/kubernetes/releases` (paginated)
  - `GET /repos/kubernetes/kubernetes/stats/commit_activity`
- License: the repository is Apache-2.0; the numbers are public GitHub metadata, cited with fetch time.
- Definitions used:
  - Official release: GitHub release that is not draft or prerelease, with major version ≥ 1.
  - Commits: weekly `commit_activity` rolled up to UTC calendar months. Incomplete months at the ends of the 52-week window (2025-11 and 2026-11) were excluded.
  - `open_issues_count` includes open pull requests; the KPI is labeled accordingly.
  - Star / open-issue figures are a point-in-time snapshot at fetch time, not October totals.

## 宣传视频补充（2026-11-24）

- 控制平面 Markdown 与架构整理仍依据 Kubernetes 官方文档 [Cluster Architecture](https://kubernetes.io/docs/concepts/architecture/)，许可 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)，作者 The Kubernetes Authors。
- 视频中的 Mermaid `flowchart` / `sequenceDiagram` / `stateDiagram-v2` 是按该文档中的组件关系重绘的说明图，不是官方原图的复制件。
- 月提交数、正式发布数仍来自 GitHub API 对 `kubernetes/kubernetes` 的公开仓库元数据（见上文数据包口径）；KChart 折线与柱状图使用与 `src/*/k8s-engineering/data/monthly.csv` 相同的数字。
- 划词评论画面来自真实打开 `zh-CN-k8s-control-plane-terminal.html` 后的运行时交互。导出文本中的 `File:` 路径在视频里改写为 `k8s-control-plane.html`，避免出现制作机本地绝对路径；其余字段（标题、章节、选区、评论）未改。
