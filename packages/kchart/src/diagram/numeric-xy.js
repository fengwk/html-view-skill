import { parseXy } from './numeric-parse.js';
import { render, validate } from './numeric-common.js';
import '../chart/basic.js';
import '../chart/multivariate.js';

const parse = (body, info) => parseXy(body, info);
const bind = { parse, validate: (model, info) => validate(model, info), layout: (model, options, info) => render(model, options, info) };

export const implementations = { xychart: bind };
