KChart.define('diagram/numeric-sankey', ({ 'diagram/numeric-parse': parser, 'diagram/numeric-common': common }) => ({
  implementations: { 'sankey-beta': { parse: parser.parseSankey, validate: (model, info) => common.validate(model, info), layout: (model, options, info) => common.render(model, options, info) } },
}));
