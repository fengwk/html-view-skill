KChart.define('diagram/numeric-radar', ({ 'diagram/numeric-parse': parser, 'diagram/numeric-common': common }) => ({
  implementations: { 'radar-beta': { parse: parser.parseRadar, validate: (model, info) => common.validate(model, info), layout: (model, options, info) => common.render(model, options, info) } },
}));
