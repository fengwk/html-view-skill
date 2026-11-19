KChart.define('diagram/numeric-xy', ({ 'diagram/numeric-parse': parser, 'diagram/numeric-common': common }) => {
  const parse = (body, info) => parser.parseXy(body, info);
  const bind = { parse, validate: (model, info) => common.validate(model, info), layout: (model, options, info) => common.render(model, options, info) };
  return { implementations: { xychart: bind } };
});
