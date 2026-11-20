const isCJK = (ch) => /[\u2E80-\u9FFF\uF900-\uFAFF]/.test(ch);
const isCJKPunct = (ch) => /[\u3000-\u303F\uFF00-\uFFEF]/.test(ch);
function fallbackMeasure(text, size = 12, weight = 400) {
  return [...String(text ?? '')].reduce((sum, ch) => sum + (/^[\u2e80-\u9fff\uf900-\ufaff\u3000-\u30ff\uac00-\ud7af\uff01-\uff60\uffe0-\uffe6]$/u.test(ch) ? 1 : 0.56) * size * (weight >= 600 ? 1.04 : 1), 0);
}
const NO_LINE_START = new Set([...'）)]］】」』〉》，,。、；;：:！!？?…%％']);
const NO_LINE_END = new Set([...'（([［【「『〈《']);
function applyKinsoku(lines, start = 0) {
  for (let i = start + 1; i < lines.length; i += 1) {
    let guard = 0;
    while (lines[i] && NO_LINE_START.has([...lines[i]][0]) && guard++ < 8) {
      const chars = [...lines[i]]; lines[i - 1] += chars.shift(); lines[i] = chars.join('');
    }
    if (!lines[i]) { lines.splice(i--, 1); continue; }
    guard = 0;
    while (lines[i - 1] && NO_LINE_END.has([...lines[i - 1]].at(-1)) && guard++ < 8) {
      const chars = [...lines[i - 1]];
      if (chars.length <= 1) break;
      lines[i] = chars.pop() + lines[i]; lines[i - 1] = chars.join('');
    }
  }
  return lines;
}
let segmenter = null, segmenterChecked = false;
function wordBreaker() {
  if (!segmenterChecked) {
    segmenterChecked = true;
    try { segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh', { granularity: 'word' }) : null; }
    catch { segmenter = null; }
  }
  return segmenter;
}
function wrapTokens(paragraph) {
  const tokens = []; let latin = '';
  const flush = () => { if (latin) { tokens.push(latin); latin = ''; } };
  const breaker = wordBreaker();
  if (!breaker) {
    for (const ch of paragraph) {
      if (/\s/.test(ch)) { flush(); tokens.push(' '); }
      else if (isCJK(ch) || isCJKPunct(ch)) { flush(); tokens.push(ch); }
      else latin += ch;
    }
    flush(); return tokens;
  }
  for (const part of breaker.segment(paragraph)) {
    const value = part.segment;
    if (/^\s+$/.test(value)) { flush(); tokens.push(' '); continue; }
    const chars = [...value];
    if (!chars.some((ch) => isCJK(ch) || isCJKPunct(ch))) { latin += value; continue; }
    flush();
    if (part.isWordLike && chars.length > 1 && chars.every(isCJK)) tokens.push(value);
    else tokens.push(...chars);
  }
  flush();
  for (let i = 1; i < tokens.length; i += 1) {
    if ([...tokens[i]].length !== 1 || !isCJK(tokens[i]) || !isCJK([...tokens[i - 1]].at(-1))) continue;
    tokens.splice(i - 1, 2, tokens[i - 1] + tokens[i]); i -= 1;
  }
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (!/^[\d.,%]+$/.test(tokens[i]) || !/\d/.test(tokens[i])) continue;
    const gap = tokens[i + 1] === ' ' ? 1 : 0, next = tokens[i + 1 + gap];
    if (next && isCJK(next[0]) && !isCJKPunct(next[0])) tokens.splice(i, 2 + gap, `${tokens[i]}${gap ? ' ' : ''}${next}`);
  }
  return tokens;
}
const WRAP_TOLERANCE = 0.5;
function wrapAt(text, maxWidth, font, measure) {
  const lines = [];
  const size = Number(font.size) || 13, weight = Number(font.weight) || 400;
  const fontSpec = { size, weight };
  for (const paragraph of String(text ?? '').split('\n')) {
    if (!paragraph) { lines.push(''); continue; }
    const start = lines.length, widths = new Map();
    const widthOf = (token) => {
      if (!widths.has(token)) widths.set(token, measure(token, fontSpec));
      return widths.get(token);
    };
    const lineWidth = (tokens) => tokens.reduce((sum, token) => sum + widthOf(token), 0);
    const tooWide = (piece) => widthOf(piece) > maxWidth + WRAP_TOLERANCE;
    const tokens = wrapTokens(paragraph).flatMap((token) => (token === ' ' || !tooWide(token) ? [token]
      : token.split(/(?<=[-/])/).flatMap((piece) => (tooWide(piece) ? [...piece] : [piece]))));
    const wrapped = [[]]; let currentWidth = 0;
    for (const token of tokens) {
      const current = wrapped.at(-1);
      if (token === ' ') { if (current.length) { current.push(' '); currentWidth += widthOf(' '); } continue; }
      if (currentWidth + widthOf(token) <= maxWidth + WRAP_TOLERANCE) { current.push(token); currentWidth += widthOf(token); }
      else { wrapped.push([token]); currentWidth = widthOf(token); }
    }
    for (let i = wrapped.length - 1; i > 0; i -= 1) {
      let guard = 0;
      while (guard < 4 && [...wrapped[i].join('').trim()].length <= 2 && wrapped[i - 1].filter((token) => token !== ' ').length > 1) {
        let at = wrapped[i - 1].length - 1;
        while (at >= 0 && wrapped[i - 1][at] === ' ') at -= 1;
        if (at < 0 || !isCJK([...wrapped[i - 1][at]][0])) break;
        const merged = [...wrapped[i - 1].slice(at), ...wrapped[i]];
        if (lineWidth(merged) > maxWidth + WRAP_TOLERANCE) break;
        wrapped[i] = merged; wrapped[i - 1] = wrapped[i - 1].slice(0, at); guard += 1;
      }
    }
    for (const line of wrapped) lines.push(line.join('').trimEnd());
    if (lines.length === start) lines.push('');
    applyKinsoku(lines, start);
  }
  return lines.length ? lines : [''];
}
function wrapText(text, maxWidth, font = {}, measure = (value, f) => fallbackMeasure(value, f.size, f.weight), { bounded = false } = {}) {
  if (!bounded) return wrapAt(text, maxWidth, font, measure);
  const fontSpec = { size: Number(font.size) || 13, weight: Number(font.weight) || 400 };
  const measured = new Map();
  const widthOf = (value) => {
    if (!measured.has(value)) measured.set(value, measure(value, fontSpec));
    return measured.get(value);
  };
  const widest = (lines) => Math.max(...lines.map(widthOf));
  let budget = maxWidth;
  let best = wrapAt(text, budget, fontSpec, widthOf);
  let bestWidth = widest(best);
  // 禁则会把标点移回上一行。固定标签栏按整行实测，缩小断行预算，给移回的标点预留空间。
  let lineWidth = bestWidth;
  while (lineWidth > maxWidth + WRAP_TOLERANCE && budget > fontSpec.size) {
    budget = Math.max(fontSpec.size, budget - Math.ceil(lineWidth - maxWidth));
    const lines = wrapAt(text, budget, fontSpec, widthOf);
    lineWidth = widest(lines);
    if (lineWidth < bestWidth) {
      best = lines;
      bestWidth = lineWidth;
    }
  }
  return best;
}

export { wrapText, fallbackMeasure };
