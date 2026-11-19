import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const npmPack = (...args) => {
  const result = JSON.parse(execFileSync('npm', ['pack', '--json', ...args], { cwd: root, encoding: 'utf8' }));
  return Array.isArray(result) ? result[0] : result['@fengwk/kchart'];
};

// Checks the published file boundary and scans the text npm actually selects for machine paths.
it('packs only the documented distribution, without machine paths', () => {
  const { files } = npmPack('--dry-run');
  const paths = files.map(({ path }) => path);
  expect(paths.filter(path => !path.startsWith('dist/')).sort()).toEqual([
    'CHANGELOG.md', 'LICENSE', 'NOTICE.md', 'README.md', 'README.zh-CN.md', 'package.json',
  ]);
  expect(paths).toEqual(expect.arrayContaining([
    'dist/assets/ICONS-LICENSE.txt', 'dist/assets/maps/LICENSE.md', 'dist/assets/maps/world.geojson',
    'dist/assets/maps/us-states.geojson', 'dist/esm/index.js', 'dist/esm/mermaid.js', 'dist/esm/node.js',
    'dist/esm/index.d.ts', 'dist/esm/mermaid.d.ts', 'dist/esm/node.d.ts', 'dist/units.json',
  ]));
  for (const path of paths) {
    expect(path).not.toMatch(/(?:^|\/)(?:tests|conformance)\/|\.map$/);
    const text = readFileSync(join(root, path), 'utf8');
    expect(text.includes(root), path).toBe(false);
    expect(/(?:file:\/\/\/|(?:^|[\s"'`(])(?:\/(?:home|Users|tmp|var|private|workspace|builds|opt|mnt)\/|[a-z]:[\\/]))/im.test(text), path).toBe(false);
  }
});

// A real packed install keeps Markdown, all families and each built-in map off the initial graph.
it('splits the packed browser API into lazy family and map chunks under Vite', async () => {
  const fixture = mkdtempSync(join(root, '.package-consumer-'));
  try {
    const packed = npmPack('--pack-destination', fixture);
    const installed = join(fixture, 'node_modules/@fengwk/kchart');
    mkdirSync(installed, { recursive: true });
    execFileSync('tar', ['-xzf', join(fixture, packed.filename), '--strip-components=1', '-C', installed]);
    writeFileSync(join(fixture, 'entry.js'), `import { render } from '@fengwk/kchart';
      globalThis.bar = () => render({ chart: 'bar', data: [{ k: 'A', v: 1 }], encode: { category: 'k', value: 'v' } });
      globalThis.markdown = () => import('./markdown.js');\n`);
    writeFileSync(join(fixture, 'markdown.js'), `export { render } from '@fengwk/kchart/mermaid';\n`);
    const { output } = await build({
      root: fixture, configFile: false, logLevel: 'silent',
      build: { write: false, rolldownOptions: { input: join(fixture, 'entry.js') } },
    });
    const chunks = output.filter(item => item.type === 'chunk');
    const byName = new Map(chunks.map(chunk => [chunk.fileName, chunk]));
    const containing = (suffix) => chunks.find(chunk => Object.keys(chunk.modules).some(id => id.endsWith(suffix)));
    const entry = chunks.find(chunk => chunk.isEntry);
    const staticGraph = (chunk, seen = new Set()) => {
      if (!seen.has(chunk.fileName)) {
        seen.add(chunk.fileName);
        for (const dep of chunk.imports) staticGraph(byName.get(dep), seen);
      }
      return seen;
    };
    const eager = staticGraph(entry);
    const families = Object.keys(JSON.parse(readFileSync(join(root, 'src/families.json'), 'utf8')));
    const paths = [...families, 'assets/maps/world', 'assets/maps/us-states'];
    const lazy = paths.map(id => {
      const chunk = containing(`/dist/esm/${id}.js`);
      expect(chunk, id).toBeDefined();
      expect(eager.has(chunk.fileName), id).toBe(false);
      expect(chunks.some(parent => parent.dynamicImports.includes(chunk.fileName)), id).toBe(true);
      return chunk.fileName;
    });
    expect(new Set(lazy).size).toBe(paths.length);
    const markdown = containing('/markdown.js');
    expect(entry.dynamicImports).toContain(markdown.fileName);
    const facade = containing('/dist/esm/mermaid.js');
    expect(staticGraph(markdown).has(facade.fileName)).toBe(true);
    expect(eager.has(facade.fileName)).toBe(false);
    expect(containing('/dist/esm/node.js')).toBeUndefined();
    const icons = containing('/dist/esm/assets/icons.js');
    expect(icons).toBeDefined();
    expect(eager.has(icons.fileName)).toBe(false);
    const barGraph = staticGraph(containing('/dist/esm/chart/basic.js'));
    const mapGraph = staticGraph(containing('/dist/esm/chart/maps.js'));
    for (const name of lazy.slice(-2)) {
      expect(barGraph.has(name)).toBe(false);
      expect(mapGraph.has(name)).toBe(false);
      expect([...staticGraph(byName.get(name))]).toEqual([name]);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
