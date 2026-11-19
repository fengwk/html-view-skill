import { parseSankey } from './numeric-parse.js';
import { render, validate } from './numeric-common.js';
import '../chart/relations.js';

export const implementations = { 'sankey-beta': { parse: parseSankey, validate, layout: render } };
