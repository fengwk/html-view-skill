import { parseRadar } from './numeric-parse.js';
import { render, validate } from './numeric-common.js';
import '../chart/multivariate.js';

export const implementations = { 'radar-beta': { parse: parseRadar, validate, layout: render } };
