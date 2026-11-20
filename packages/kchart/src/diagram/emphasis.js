// Mermaid Markdown strings: **bold**, __bold__, *italic* and _italic_ keep their text; the emphasis is not drawn.
// As in CommonMark, underscores inside a word (snake_case, 中_文) and markers next to spaces stay literal.
// Kept apart from label.js so the eager source preparation does not load the icon data label.js needs.
function stripEmphasis(text) {
  return String(text)
    .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
    .replace(/(^|[^\p{L}\p{N}_])__(?=\S)([\s\S]*?\S)__(?![\p{L}\p{N}_])/gu, '$1$2')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/(^|[^\p{L}\p{N}_])_(?=\S)([^_\n]*?\S)_(?![\p{L}\p{N}_])/gu, '$1$2');
}

export { stripEmphasis };
