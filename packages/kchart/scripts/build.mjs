// Builds the KChart distribution. One pipeline, no dependencies beyond vite 8 (Rolldown):
//   dist/esm/        preserveModules ESM, unminified: node.js, page-api.js and every src/**/*.js
//   dist/units/      one minified classic-script IIFE per src module; imports resolve via KChartUnits["<id>"]
//   dist/page-api.js classic IIFE that defines the page API as the name KChartPageApi
//   dist/units.json  { "<id>": { file, deps, bytes } } with deps in source statement order
//   dist/assets/     runtime data the Node entry reads on demand (maps) plus license texts
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { build, parseAst } from 'vite';

const root = resolve(import.meta.dirname, '..');
const srcRoot = join(root, 'src');
const distRoot = join(root, 'dist');
const unitsRoot = join(distRoot, 'units');
// Rolldown names the IIFE after lib.name; the unit stage rewrites that name into a KChartUnits slot.
const UNIT_NAME = '__KCHART_UNIT__';
const PAGE_API_NAME = 'KChartPageApi';
const pageApiEntry = 'createPageApi';
const nodeBuiltins = new Set(builtinModules);
const posix = (path) => path.split(sep).join('/');
const isNodeBuiltin = (id) => id.startsWith('node:') || nodeBuiltins.has(id);
const read = (path) => readFileSync(path, 'utf8');

function listFiles(dir, filter, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(path, filter, acc);
    else if (entry.isFile() && filter(entry.name)) acc.push(path);
  }
  return acc;
}

// Unit ids are the path under src/ without .js, so they keep the old module ids.
const units = listFiles(srcRoot, (name) => name.endsWith('.js')).sort()
  .map((file) => ({ id: posix(relative(srcRoot, file)).slice(0, -3), file }));
const idOfFile = new Map(units.map((unit) => [unit.file, unit.id]));
const sourceFiles = new Set(units.map((unit) => unit.file));

const importSpecifiers = (unit) => {
  const specifiers = [];
  for (const statement of parseAst(read(unit.file)).body) {
    if (statement.type !== 'ImportDeclaration' && statement.type !== 'ExportNamedDeclaration' && statement.type !== 'ExportAllDeclaration') continue;
    const specifier = statement.source?.value;
    if (typeof specifier === 'string') specifiers.push(specifier);
  }
  return specifiers;
};

// Declared deps follow the source import statements in order and keep side-effect-only imports even
// when the bundler drops them from the emitted IIFE, because page assembly runs units in this order.
function declaredDeps(unit) {
  const deps = [];
  for (const specifier of importSpecifiers(unit)) {
    const id = idOfFile.get(resolve(dirname(unit.file), specifier.split('?')[0]));
    if (id !== undefined && id !== unit.id && !deps.includes(id)) deps.push(id);
  }
  return deps;
}

// A module with only `export {}` exports no value, so its IIFE must not receive an exports object.
const hasValueExports = (unit) => parseAst(read(unit.file)).body.some((statement) => {
  if (statement.type === 'ExportDefaultDeclaration' || statement.type === 'ExportAllDeclaration') return true;
  if (statement.type !== 'ExportNamedDeclaration') return false;
  return Boolean(statement.declaration) || Boolean(statement.source) || Boolean(statement.specifiers?.length);
});

function requireEntry(path) {
  if (!existsSync(path)) throw new Error(`缺少构建入口：${posix(relative(root, path))}`);
  return path;
}

const chunkOf = (result) => (Array.isArray(result) ? result : [result])
  .flatMap((item) => item.output ?? [])
  .find((output) => output.type === 'chunk');

// Stage 1: ESM. Every source module and both entry modules stay separate chunks; Node builtins stay external.
const esmEntries = { node: requireEntry(join(root, 'node.js')), 'page-api': requireEntry(join(root, 'page-api.js')) };
for (const unit of units) esmEntries[unit.id] = unit.file;

rmSync(distRoot, { recursive: true, force: true });
await build({
  configFile: false,
  root,
  logLevel: 'warn',
  build: {
    outDir: join(distRoot, 'esm'),
    emptyOutDir: true,
    copyPublicDir: false,
    reportCompressedSize: false,
    minify: false,
    lib: { entry: esmEntries, formats: ['es'] },
    rolldownOptions: {
      external: isNodeBuiltin,
      output: { preserveModules: true, preserveModulesRoot: '.', entryFileNames: '[name].js' },
    },
  },
});

// Stage 2: one classic-script IIFE per source module. Other source modules are externals bound to
// KChartUnits["<id>"]; JSON imports and import.meta.glob data are inlined so units stay self-contained.
const records = [];
for (const unit of units) {
  const browserImports = importSpecifiers(unit).filter((specifier) => isNodeBuiltin(specifier));
  if (browserImports.length) throw new Error(`浏览器单元不能依赖 Node 内置模块：${unit.id} → ${browserImports.join(', ')}`);
  const externals = new Set([...sourceFiles].filter((file) => file !== unit.file));
  const globals = Object.fromEntries([...externals].map((file) => [file, `KChartUnits[${JSON.stringify(idOfFile.get(file))}]`]));
  const exported = hasValueExports(unit);
  const chunk = chunkOf(await build({
    configFile: false,
    root,
    logLevel: 'warn',
    build: {
      write: false,
      minify: true,
      copyPublicDir: false,
      reportCompressedSize: false,
      lib: { entry: unit.file, formats: ['iife'], name: UNIT_NAME },
      rolldownOptions: {
        external: (id) => externals.has(id),
        output: { entryFileNames: 'unit.js', globals, exports: exported ? 'named' : 'none' },
      },
    },
  }));
  const binding = `KChartUnits[${JSON.stringify(unit.id)}]=`;
  let code = chunk.code;
  // A leading 'use strict' directive may precede the container declaration, so match it anywhere and
  // require exactly one occurrence to keep the rewrite deterministic.
  const named = new RegExp(`(var|const|let)\\s+${UNIT_NAME}\\s*=`, 'g');
  const occurrences = code.match(named)?.length ?? 0;
  if (exported) {
    if (occurrences !== 1) throw new Error(`单元IIFE导出容器异常：${unit.id}`);
    code = code.replace(named, binding).trimEnd();
  } else {
    // A value-less module exports nothing, so nothing can read its slot: the unit stays a bare classic
    // script. That keeps `export {}` modules such as runtime.js usable directly as a script tag body.
    if (occurrences !== 0) throw new Error(`无导出单元不应有导出容器：${unit.id}`);
    code = code.trimEnd();
  }
  const text = `${code}\n`;
  const target = join(unitsRoot, `${unit.id}.js`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  records.push([unit.id, { file: `units/${unit.id}.js`, deps: declaredDeps(unit), bytes: Buffer.byteLength(text) }]);
}
writeFileSync(join(distRoot, 'units.json'), `${JSON.stringify(Object.fromEntries(records), null, 2)}\n`);

// Stage 3: the dependency-free page API as a classic script exposing the name KChartPageApi.
const pageApiChunk = chunkOf(await build({
  configFile: false,
  root,
  logLevel: 'warn',
  build: {
    write: false,
    minify: true,
    copyPublicDir: false,
    reportCompressedSize: false,
    lib: { entry: join(root, 'page-api.js'), formats: ['iife'], name: PAGE_API_NAME },
    rolldownOptions: { output: { entryFileNames: 'page-api.js' } },
  },
}));
if (!pageApiChunk.exports.includes(pageApiEntry)) throw new Error(`页面API必须导出${pageApiEntry}`);
if (pageApiChunk.code.includes('require(') || /\bimport\s*\(/.test(pageApiChunk.code)) throw new Error('页面API必须是零依赖模块');
writeFileSync(join(distRoot, 'page-api.js'), `${pageApiChunk.code}\n`);

// Stage 4: make the mirrored ESM independent of the enclosing package, and ship runtime assets.
writeFileSync(join(distRoot, 'esm/package.json'), '{"type":"module"}\n');
cpSync(join(root, 'assets/maps'), join(distRoot, 'assets/maps'), { recursive: true });
for (const file of ['assets/ICONS-LICENSE.txt', 'LICENSE', 'NOTICE.md']) cpSync(join(root, file), join(distRoot, file));

// The build fails rather than ship a partial or machine-dependent dist.
const expected = [
  'esm/node.js', 'esm/page-api.js', 'page-api.js', 'units.json',
  'assets/maps/world.geojson', 'assets/maps/us-states.geojson', 'assets/ICONS-LICENSE.txt', 'LICENSE', 'NOTICE.md',
  ...units.flatMap((unit) => [`esm/${unit.id}.js`, `units/${unit.id}.js`]),
];
const missing = expected.filter((path) => !existsSync(join(distRoot, path)));
if (missing.length) throw new Error(`构建产物缺失：${missing.join(', ')}`);
const known = new Set(records.map(([id]) => id));
const unknown = records.flatMap(([id, record]) => record.deps.filter((dep) => !known.has(dep)).map((dep) => `${id} → ${dep}`));
if (unknown.length) throw new Error(`单元依赖未登记：${unknown.join(', ')}`);

const textFiles = listFiles(distRoot, (name) => name.endsWith('.js') || name.endsWith('.json') || /^(?:LICENSE|NOTICE\.md|.*\.txt)$/.test(name));
const machinePaths = textFiles.filter((file) => read(file).includes(root));
if (machinePaths.length) throw new Error(`构建产物包含绝对路径：${machinePaths.map((file) => posix(relative(distRoot, file))).join(', ')}`);

const bytes = textFiles.reduce((sum, file) => sum + Buffer.byteLength(read(file)), 0);
process.stdout.write(`build: ${units.length} units, ${textFiles.length} files, ${(bytes / 1024).toFixed(1)} KiB\n`);
