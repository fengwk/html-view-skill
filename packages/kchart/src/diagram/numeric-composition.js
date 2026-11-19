import { parsePie, parseTreemap } from './numeric-parse.js';
import { render, validate } from './numeric-common.js';
import '../chart/composition.js';

const bind = parseFn => ({ parse: parseFn, validate: (model, info) => validate(model, info), layout: (model, options, info) => render(model, options, info) });

export const implementations = { pie: bind(parsePie), 'treemap-beta': bind(parseTreemap) };
