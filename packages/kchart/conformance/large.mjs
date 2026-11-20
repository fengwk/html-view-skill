import { pathToFileURL } from 'node:url';
import { checkScene } from '../tests/helpers/geometry.mjs';

const rows = (n, row) => Array.from({ length: n }, (_, i) => row(i)).join('\n');
const chain = (n, arrow) => rows(n - 1, i => `N${i} ${arrow} N${i + 1}`);

// Keep the sources reproducible and exercise distinct limits independently.
export const families = {
  sequence: [[40, 100, 300], n => `sequenceDiagram\n${rows(n, i => `participant P${i}`)}`],
  'sequence-messages': [[220, 500], n => `sequenceDiagram\n${rows(n, i => `A->>B: Message ${i}`)}`],
  er: [[40, 100, 300], n => `erDiagram\n${rows(n, i => `N${i}`)}`],
  'er-relations': [[60, 100, 150], n => `erDiagram\n${rows(n, i => `N${i} ||--o{ N${i + 1} : has`)}`],
  mindmap: [[100, 300], n => `mindmap\n  Root\n${rows(n, i => `    Leaf ${i}`)}`],
  'mindmap-depth': [[7, 12, 24], n => `mindmap\n${rows(n, i => `${'  '.repeat(i)}Level ${i}`)}`],
  sankey: [[60, 150, 300], n => `sankey\n${rows(n, i => `From${i},To${i},1`)}`],
  'sankey-flows': [[150, 500], n => `sankey\n${rows(n, () => 'A,B,1')}`],
  treemap: [[100, 200, 300], n => `treemap-beta\n"Group"\n${rows(n, i => `  "Leaf ${i}": 1`)}`],
  'treemap-depth': [[7, 12], n => `treemap-beta\n${rows(n, i => `${'  '.repeat(i)}"Group ${i}"${i === n - 1 ? ': 1' : ''}`)}`],
  c4: [[100, 150, 300], n => `C4Context\n${rows(n, i => `System(n${i}, "System ${i}")`)}`],
  swimlane: [[8, 16, 40], n => `swimlane-beta LR\n${rows(n, i => `subgraph Lane${i}\n  N${i}[Task ${i}]\nend`)}\n${chain(n, '-->')}`],
  flowchart: [[100, 300], n => `flowchart LR\n${chain(n, '-->')}`],
  state: [[100, 300], n => `stateDiagram-v2\n${chain(n, '-->')}`],
  class: [[100, 300], n => `classDiagram\n${chain(n, '-->')}`],
  eventmodeling: [[100, 300], n => `eventmodeling\n${rows(n, i => `tf ${String(i + 1).padStart(3, '0')} evt Event${i}`)}`],
  gantt: [[100, 300], n => `gantt\n  dateFormat YYYY-MM-DD\n  section Work\n${rows(n, i => `  Task ${i} :t${i}, 2025-01-01, 1d`)}`],
  journey: [[100, 300, 600], n => `journey\n  section Work\n${rows(n, i => `  Task ${i}: 5: Me`)}`],
  gitGraph: [[100, 300], n => `gitGraph\n${rows(n, () => '  commit')}`],
  kanban: [[100, 300], n => `kanban\n  work[Work]\n${rows(n, i => `    t${i}[Task ${i}]`)}`],
  requirement: [[100, 300], n => `requirementDiagram\n${rows(n, i => `element N${i} {\n  type: Test\n  docref: D${i}\n}`)}`],
  pie: [[100, 300], n => `pie\n${rows(n, i => `  "Item ${i}" : 1`)}`],
  timeline: [[100, 300], n => `timeline\n${rows(n, i => `  ${1900 + i} : Event ${i}`)}`],
  architecture: [[100, 300], n => `architecture-beta\n${rows(n, i => `  service n${i}(server)[Server ${i}]`)}`],
  agentflow: [[70, 150, 300], n => `agentflow-beta TB\n  flow work["Work"]\n${rows(n, i => `    N${i}["Task ${i}"]`)}\n${chain(n, '-->')}\n  end`],
  xychart: [[9, 20, 24, 60], n => `xychart\n  x-axis [A, B]\n${rows(n, i => `  bar [${i + 1}, ${i + 2}]`)}`],
  radar: [[9, 20, 24, 60], n => `radar-beta\n  axis a[A], b[B], c[C]\n${rows(n, i => `  curve r${i}[R${i}]{1, 2, 3}`)}`],
  ishikawa: [[40, 100, 300], n => `ishikawa-beta\n  Problem\n${rows(n, i => `    Cause ${i}`)}`],
  block: [[40, 100, 300], n => `block\n  columns 5\n${rows(n, i => `  N${i}[Item ${i}]`)}`],
  packet: [[100, 300], n => `packet\n${rows(n, i => `${i * 8}-${i * 8 + 7}: "Item ${i}"`)}`],
  quadrant: [[100, 300], n => `quadrantChart\n${rows(n, i => `P${i}: [${(i % 20 + 1) / 22}, ${Math.floor(i / 20 + 1) / 18}]`)}`],
  treeView: [[100, 300], n => `treeView-beta\n${rows(n, i => `${i === n - 1 ? '└' : '├'}── File ${i}`)}`],
  cynefin: [[100, 300], n => `cynefin-beta\n  complex\n${rows(n, i => `    "Item ${i}"`)}`],
  'railroad-ebnf': [[100, 300], n => `railroad-ebnf-beta\n${rows(n, i => `r${i} = "Item ${i}" ;`)}`],
  'railroad-abnf': [[100, 300], n => `railroad-abnf-beta\n${rows(n, i => `r${i} = "Item ${i}" ;`)}`],
  'railroad-peg': [[100, 300], n => `railroad-peg-beta\n${rows(n, i => `r${i} <- "Item ${i}" ;`)}`],
  railroad: [[100, 300], n => `railroad-beta\n${rows(n, i => `r${i} = terminal("Item ${i}");`)}`],
  usecase: [[100, 300], n => `usecase-beta\n${rows(n, i => `N${i}("Use case ${i}")`)}`],
  venn: [[6, 20], n => `venn-beta\n${rows(n, i => `  set S${i}`)}`],
  wardley: [[100, 300], n => `wardley-beta\n${rows(n, i => `component "Item ${i}" [${((i % 20 + 1) / 22).toFixed(3)}, ${(Math.floor(i / 20 + 1) / 18).toFixed(3)}]`)}`],
};

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { diagram } = await import('../dist/esm/node.js');
  const selected = process.argv.slice(2);
  for (const name of selected) if (!Object.hasOwn(families, name)) throw new Error(`Unknown probe family: ${name}`);
  console.log('family\tsize\tresult\tLARGE_DIAGRAM\tms\tscene\tgeometry\tdetail');
  for (const [family, [sizes, make]] of Object.entries(families)) {
    if (selected.length && !selected.includes(family)) continue;
    for (const n of sizes) {
      const source = make(n);
      const start = performance.now();
      const { svg, scene, diagnostics } = diagram(source, { syntax: 'mermaid', lang: 'en', width: 800 });
      const ms = Math.round(performance.now() - start);
      const errors = diagnostics.filter(d => d.severity === 'error');
      const geometry = scene ? checkScene(scene, { source }) : [];
      console.log([family, n, svg && !errors.length ? 'ok' : 'error', diagnostics.filter(d => d.code === 'LARGE_DIAGRAM').length,
        ms, scene ? `${scene.width}x${scene.height}` : '-', scene ? geometry.length : '-', errors[0]?.message ?? geometry[0]?.kind ?? ''].join('\t'));
    }
  }
}
