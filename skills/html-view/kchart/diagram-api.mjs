// 与安装器一样，此函数也嵌入离线浏览器脚本，不依赖外层变量。
export function diagramApi(modules, types) {
  const implementations = Object.create(null);
  for (const [id, unit] of Object.entries(modules)) {
    if (!id.startsWith('diagram/')) continue;
    for (const [kind, impl] of Object.entries(unit.implementations || {})) {
      if (Object.hasOwn(implementations, kind)) throw new TypeError(`结构图实现重复装入：${kind}`);
      implementations[kind] = impl;
    }
  }
  const { diagram, check } = modules['diagram/registry'].createDiagramApi(implementations, types);
  const diagramTypes = Object.freeze(types.map(type => Object.freeze({ ...type, aliases: Object.freeze(type.aliases) })));
  return Object.freeze({ diagram, check, diagramTypes });
}
