// Built both as ESM for Node and as a classic script for offline pages.
export function createPageApi(modules, unloaded, types, diagramOnly = false, registry = modules['chart/registry']) {
  const api = {};
  if (!diagramOnly) {
    const { parse, validate, schema } = modules['chart/spec'];
    const excluded = new Map(unloaded);
    Object.assign(api, {
      parse, validate, schema,
      catalog: modules['chart/catalog'].catalog,
      theme: modules['core/theme'].theme,
      themes: modules['core/theme'].themes,
      layouts: registry.layouts,
      render(spec, options = {}) {
        if (excluded.get(spec?.chart)?.includes(spec.variant)) {
          const { errors } = validate(spec);
          if (errors.length) return { scene: null, svg: null, table: null, diagnostics: errors };
          return { scene: null, svg: null, table: null, diagnostics: [{
            code: 'BAD_KCHART', path: '/variant', message: `未装入 ${spec.chart} 的变体模块`,
            fix: '以该图表声明重新组装渲染器',
          }] };
        }
        const result = registry.render(spec, { frame: true, ...options });
        // The host draws the table; rendering only reports its model, and only for a chart that drew.
        const table = result.svg ? modules['chart/context'].dataTable(spec, { lang: options.lang }) : null;
        return { ...result, table };
      },
      ...(modules.interaction ? { attach: modules.interaction.attach } : {}),
    });
  }
  if (modules['diagram/registry']) {
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
    Object.assign(api, { diagram, check, diagramTypes });
  }
  return Object.freeze(api);
}
