KChart.define('diagram/numeric-composition', ({ 'diagram/numeric-parse': parser, 'diagram/numeric-common': common }) => {
  const bind = parseFn => ({ parse: parseFn, validate: (model, info) => common.validate(model, info), layout: (model, options, info) => common.render(model, options, info) });
  return { implementations: { pie: bind(parser.parsePie), 'treemap-beta': bind(parser.parseTreemap) } };
});
