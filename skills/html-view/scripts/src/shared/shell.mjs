import { createHash } from 'node:crypto';
import { browserSource, createRenderer, runtimeSource, theme as resolveTheme, DEFAULT_THEME as KCHART_DEFAULT_THEME } from '../../../vendor/kchart/esm/node.js';
import { ToolError } from './output.mjs';
import { decodeEntities, lineAt, scanElements } from './html-util.mjs';
import { contentMarkerRegions, contentMarkers, START, END } from './content-regions.mjs';
import { readAsset } from './assets.mjs';
import { DEFAULT_THEME, readingCss } from './themes.mjs';
import { restoreTheme, THEME_META } from './theme-file.mjs';
import { auditContent, auditOuterResources } from './static-audit.mjs';
import { auditViz, collectViz, modulesForContent } from './viz.mjs';

export { START, END } from './content-regions.mjs';
const kinds = new Set(['doc', 'data', 'ui', 'viz']);
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const asText = (value) => String(value ?? '');
const validAttr = (name) => /^[a-zA-Z_:][\w:.-]*$/.test(name) && !/^on/i.test(name);
const decodedAttrs = (node) => Object.fromEntries(Object.entries(node.attrs).map(([key, value]) => [key, decodeEntities(value)]));
const metaNodes = (elements, head) => elements.filter((node) => node.name === 'meta' && node.start > head.start && node.start < head.closeStart);
const normalizedAttrs = (attrs) => Object.fromEntries(Object.entries(attrs).filter(([name]) => !['lang', 'data-theme', 'data-scheme'].includes(name.toLowerCase())).map(([name, value]) => [name, value === true ? '' : asText(value)]));
const fingerprintInput = ({ kind, lang, theme, themeSnapshot, attrs, scheme, modules, styles, scripts }) => ({
  kind, lang, theme, ...(themeSnapshot ? { themeSnapshot } : {}), attrs, scheme, modules, styles, scripts,
});
const themeMetaMarkup = (snapshot) => `<meta name="htmlview:${THEME_META}" content="${escape(JSON.stringify(snapshot))}">`;

function metaMarkup(source) {
  const elements = scanElements(source);
  const tags = elements.filter((element) => element.name === 'meta');
  if (elements.some((element) => element.name !== 'meta')) throw new TypeError('extraHead 只允许外部 meta 标签');
  for (const tag of tags) {
    const attrs = decodedAttrs(tag);
    const name = attrs.name?.toLowerCase();
    const property = attrs.property || attrs['http-equiv'] || attrs.itemprop;
    if (Object.keys(attrs).some((key) => /^on/i.test(key))) throw new TypeError('meta 标签不允许事件属性');
    if (attrs['http-equiv']?.trim().toLowerCase() === 'refresh') throw new TypeError('meta refresh 不允许跳转');
    if (!(name && attrs.content != null) && !(property && attrs.content != null)) throw new TypeError('外部 meta 必须声明 name/property 与 content');
    if (/^(?:htmlview:|generator$|viewport$|color-scheme$)/i.test(name ?? '')) throw new TypeError(`外部 meta 名称保留：${name}`);
  }
  return tags.map((tag) => source.slice(tag.start, tag.end)).join('\n');
}

function currentRuntime() {
  return runtimeSource();
}
function throwVizFailures(result) {
  if (!result.failures.length) return;
  throw new ToolError('BAD_VALUE', '图形源码校验或布局失败，未生成外壳。', {
    next: '按 details.failures 中的源码行号和修法修改图形声明，再重新生成或运行 htmlview style。',
    details: { failures: result.failures },
  });
}
function sourceDeclarations(content) {
  const declarations = [];
  for (const item of collectViz(content)) {
    if (item.syntax === 'kchart') {
      try { declarations.push(JSON.parse(item.source)); }
      catch (error) {
        throw new ToolError('BAD_VALUE', 'KChart JSON 声明无法解析。', {
          next: '修复图形源码中的 JSON 语法；若使用 Markdown，请确认 fence 标记为 kchart。',
          details: { code: 'BAD_VIZ', line: item.line, where: item.id || item.syntax, message: error.message },
        });
      }
    } else if (['mermaid', 'layers', 'blocks', 'swimlane'].includes(item.syntax)) declarations.push({ source: item.source, syntax: item.syntax });
  }
  return declarations;
}

export function renderShell({
  kind, lang = 'zh-CN', title = '', theme, attrs = {}, meta = {}, extraHead = '', styles = [],
  before = '', content = '', after = '', scripts = [], vizOptions = {},
} = {}) {
  if (!kinds.has(kind)) throw new TypeError(`无效 htmlview kind：${kind}`);
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs) || !meta || typeof meta !== 'object' || Array.isArray(meta)) throw new TypeError('attrs/meta 必须是对象');
  if (!/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(lang)) throw new TypeError('lang 必须为 BCP 47 标签');
  if (!Array.isArray(styles) || !Array.isArray(scripts)) throw new TypeError('styles/scripts 必须是数组');
  const selected = theme ?? (kind === 'ui' ? null : DEFAULT_THEME);
  const themeSnapshot = selected && typeof selected === 'object' ? restoreTheme(selected.id, JSON.stringify(selected)) : null;
  if (kind === 'ui' && themeSnapshot) throw new TypeError('界面稿使用独立配色，不接受自定义主题');
  const themeInfo = selected === null ? null : (themeSnapshot ?? resolveTheme(selected));
  const selectedTheme = themeInfo?.id ?? null;
  const suppliedAttrs = {};
  for (const [rawName, value] of Object.entries(attrs)) {
    const name = rawName.toLowerCase();
    if (Object.hasOwn(suppliedAttrs, name)) throw new TypeError(`html 属性重复：${name}`);
    if (!validAttr(name)) throw new TypeError(`不允许的 html 属性：${rawName}`);
    suppliedAttrs[name] = value;
  }
  if (Object.hasOwn(suppliedAttrs, 'lang') || Object.hasOwn(suppliedAttrs, 'data-theme') || Object.hasOwn(suppliedAttrs, 'style')) throw new TypeError('lang/data-theme/style 由外壳管理');
  if (Object.hasOwn(suppliedAttrs, 'data-scheme') && !['light', 'dark'].includes(suppliedAttrs['data-scheme'])) throw new TypeError('data-scheme 必须为 light 或 dark');
  if (themeInfo && suppliedAttrs['data-scheme'] && suppliedAttrs['data-scheme'] !== themeInfo.scheme) throw new TypeError('固定 theme 与 attrs.data-scheme 冲突');
  if ([before, content, after].some(fragment => !contentMarkers(fragment).next().done)) throw new TypeError('内容不能包含外壳内容标记');
  const externalMeta = metaMarkup(asText(extraHead));
  const staticViz = kind === 'viz';
  if (!staticViz) throwVizFailures(auditViz(content, { lang, theme: themeSnapshot ?? selectedTheme ?? KCHART_DEFAULT_THEME, contentLine: 1 }));
  const declarations = staticViz ? [] : sourceDeclarations(content);
  const modules = staticViz ? [] : modulesForContent(content);
  const scheme = themeInfo?.scheme ?? suppliedAttrs['data-scheme'] ?? null;
  const htmlAttrs = { lang, ...(selectedTheme ? { 'data-theme': selectedTheme } : {}), ...(scheme ? { 'data-scheme': scheme } : {}), ...suppliedAttrs };
  const attrsText = Object.entries(htmlAttrs).filter(([, value]) => value != null && value !== false).map(([name, value]) => ` ${name}="${escape(value === true ? '' : value)}"`).join('');
  const baseStyles = [readingCss(themeSnapshot), readAsset('page/viz.css'), ...styles.map(asText)];
  const mapAssets = {};
  const renderer = declarations.length ? createRenderer({ specs: declarations }) : null;
  for (const declaration of declarations) if (declaration?.chart && renderer) Object.assign(mapAssets, renderer.assets(declaration) ?? {});
  const options = JSON.stringify({ ...vizOptions, lang, ...(Object.keys(mapAssets).length ? { assets: mapAssets } : {}) }).replaceAll('<', '\\u003c');
  // The inert metadata is the single custom snapshot; browser and CLI read the same data.
  const mountOptions = themeSnapshot
    ? `{...${options},theme:JSON.parse(document.head.querySelector('meta[name="htmlview:${THEME_META}"]').content)}` : options;
  const generatedScripts = declarations.length ? [
    browserSource(declarations), currentRuntime(),
    `if(globalThis.KChart&&globalThis.KChart.mount)globalThis.KChart.mount(document,${mountOptions});`,
  ] : [];
  const allScripts = [...generatedScripts, ...scripts.map(asText)];
  for (const css of baseStyles) if (/<\/style/i.test(css)) throw new TypeError('CSS 文本不能关闭 style 元素');
  for (const js of allScripts) if (/<\/script/i.test(js)) throw new TypeError('脚本文本不能关闭 script 元素');
  const fingerprint = hash(fingerprintInput({
    kind, lang, theme: selectedTheme, themeSnapshot, attrs: normalizedAttrs(suppliedAttrs), scheme, modules,
    styles: baseStyles, scripts: allScripts,
  }));
  const reserved = new Set(['kind', 'shell', 'modules', THEME_META]);
  const generatedMeta = [
    '<meta name="generator" content="htmlview">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="htmlview:kind" content="${kind}">`,
    `<meta name="htmlview:shell" content="${fingerprint}">`,
    `<meta name="htmlview:modules" content="${escape(JSON.stringify(modules))}">`,
    ...(themeSnapshot ? [themeMetaMarkup(themeSnapshot)] : []),
    ...Object.entries(meta).filter(([name]) => !reserved.has(String(name).toLowerCase())).map(([name, value]) => `<meta name="${escape(`htmlview:${name}`)}" content="${escape(value)}">`),
  ];
  const html = [
    '<!doctype html>', `<html${attrsText}>`, '<head>', '<meta charset="utf-8">', ...generatedMeta,
    `<title>${escape(title)}</title>`, externalMeta,
    ...baseStyles.map((css) => `<style>${css}</style>`), '</head>', '<body>',
    asText(before), START, asText(content), END, asText(after),
    ...allScripts.map((js) => `<script>${js}</script>`), '</body>', '</html>',
  ].join('\n');
  return `${html}\n`;
}

export function parseShell(html, file = '文件') {
  const source = String(html);
  const elements = scanElements(source);
  const rootNodes = elements.filter((element) => element.name === 'html' && !element.parent);
  const htmlNode = rootNodes[0];
  const headNodes = elements.filter((element) => element.name === 'head');
  const bodyNodes = elements.filter((element) => element.name === 'body');
  if (rootNodes.length !== 1 || headNodes.length !== 1 || bodyNodes.length !== 1) throw new TypeError(`${file}：html/head/body 必须各有且仅有一个真实元素`);
  const head = headNodes[0], body = bodyNodes[0];
  if (head.parent !== htmlNode || body.parent !== htmlNode) throw new TypeError(`${file}：head/body 必须直接位于 html 根元素内`);
  const [region] = contentMarkerRegions(source);
  if (!region) throw new TypeError(`${file}：必须且只能包含一对有序 htmlview 内容标记`);
  if (region.openStart < body.start || region.closeEnd > body.closeStart) throw new TypeError(`${file}：内容标记必须位于 body 内`);
  let contentStart = region.start;
  let contentEnd = region.end;
  if (source.startsWith('\r\n', contentStart)) contentStart += 2; else if (source[contentStart] === '\n') contentStart += 1;
  if (contentEnd > contentStart && source[contentEnd - 1] === '\n') contentEnd -= 1;
  if (contentEnd > contentStart && source[contentEnd - 1] === '\r') contentEnd -= 1;
  const content = source.slice(contentStart, contentEnd);
  const inHeadMeta = metaNodes(elements, head).filter((node) => node.parent === head);
  const named = (name) => inHeadMeta.filter((node) => String(node.attrs.name ?? '').toLowerCase() === `htmlview:${name}`);
  for (const key of ['kind', 'shell', 'modules']) if (named(key).length !== 1) throw new TypeError(`${file}：head 中 htmlview:${key} 必须且只能出现一次`);
  const kind = decodeEntities(named('kind')[0].attrs.content ?? '');
  if (!kinds.has(kind)) throw new TypeError(`${file}：htmlview:kind 类型无效`);
  const fingerprint = decodeEntities(named('shell')[0].attrs.content ?? '');
  if (!/^[a-f0-9]{64}$/i.test(fingerprint)) throw new TypeError(`${file}：htmlview:shell 指纹无效`);
  let modules;
  try { modules = JSON.parse(decodeEntities(named('modules')[0].attrs.content ?? '')); }
  catch { throw new TypeError(`${file}：htmlview:modules 不是合法 JSON`); }
  if (!Array.isArray(modules) || modules.some((item) => typeof item !== 'string' || !/^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/.test(item)) || new Set(modules).size !== modules.length) throw new TypeError(`${file}：htmlview:modules schema 无效`);
  const titleNodes = elements.filter((element) => element.name === 'title' && element.parent === head);
  if (titleNodes.length !== 1) throw new TypeError(`${file}：head 中 title 必须且只能出现一次`);
  const metas = inHeadMeta.map((node) => decodedAttrs(node));
  const generators = metas.filter((meta) => meta.name?.toLowerCase() === 'generator');
  if (generators.length !== 1 || generators[0].content !== 'htmlview') throw new TypeError(`${file}：generator 标记必须且只能出现一次`);
  const charsets = inHeadMeta.filter((node) => decodedAttrs(node).charset?.toLowerCase() === 'utf-8');
  if (charsets.length !== 1) throw new TypeError(`${file}：UTF-8 charset meta 必须且只能出现一次`);
  const viewports = metas.filter((meta) => meta.name?.toLowerCase() === 'viewport');
  if (viewports.length !== 1 || viewports[0].content !== 'width=device-width, initial-scale=1') throw new TypeError(`${file}：viewport meta 缺失或无效`);
  const htmlAttrs = decodedAttrs(htmlNode);
  if (!/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(htmlAttrs.lang ?? '')) throw new TypeError(`${file}：lang 必须为 BCP 47 标签`);
  for (const name of Object.keys(htmlAttrs)) if (!validAttr(name) || name.toLowerCase() === 'style') throw new TypeError(`${file}：html 根属性无效：${name}`);
  const theme = htmlAttrs['data-theme'] ?? null;
  const embedded = named(THEME_META);
  if (embedded.length > 1 || (kind === 'ui' && embedded.length)) throw new TypeError(`${file}：htmlview:${THEME_META} 重复或不适用于该产物`);
  const resolved = restoreTheme(theme, embedded.length ? decodeEntities(embedded[0].attrs.content ?? '') : undefined);
  const themeSnapshot = typeof resolved === 'object' ? resolved : null;
  const themeInfo = resolved === null ? null : resolveTheme(resolved);
  const scheme = htmlAttrs['data-scheme'] ?? null;
  if (scheme != null && !['light', 'dark'].includes(scheme)) throw new TypeError(`${file}：data-scheme 无效`);
  if (themeInfo && scheme !== themeInfo.scheme) throw new TypeError(`${file}：data-theme 与 data-scheme 冲突`);
  const meta = {};
  for (const values of metas) {
    const name = values.name?.toLowerCase() ?? '';
    if (!name.startsWith('htmlview:') || ['htmlview:kind', 'htmlview:shell', 'htmlview:modules', `htmlview:${THEME_META}`].includes(name)) continue;
    const key = values.name.slice('htmlview:'.length);
    if (Object.hasOwn(meta, key)) throw new TypeError(`${file}：htmlview:${key} 重复`);
    meta[key] = values.content ?? '';
  }
  if (metas.some(meta => meta['http-equiv']?.trim().toLowerCase() === 'refresh')) throw new TypeError(`${file}：外壳不允许 meta refresh`);
  const externalMeta = inHeadMeta.filter((node) => {
    const attrs = decodedAttrs(node);
    const name = attrs.name?.toLowerCase() ?? '';
    const external = (attrs.name && attrs.content != null) || (attrs.property && attrs.content != null) || (attrs['http-equiv'] && attrs.content != null) || (attrs.itemprop && attrs.content != null);
    return external && !/^(?:htmlview:|generator$|viewport$|color-scheme$)/i.test(name) && !['charset', 'refresh'].includes(attrs['http-equiv']?.trim().toLowerCase());
  }).map((node) => source.slice(node.start, node.end)).join('\n');
  const safeExternalMeta = metaMarkup(externalMeta);
  const styles = elements.filter((element) => element.name === 'style' && element.parent === head).map((element) => source.slice(element.openEnd, element.closeStart));
  const scripts = elements.filter((element) => element.name === 'script' && element.parent === body && (element.start < region.openStart || element.start >= region.closeEnd)).map((element) => source.slice(element.openEnd, element.closeStart));
  return {
    kind, lang: htmlAttrs.lang, title: decodeEntities(source.slice(titleNodes[0].openEnd, titleNodes[0].closeStart)),
    theme, themeSnapshot, attrs: Object.fromEntries(Object.entries(htmlAttrs).filter(([key]) => !['lang', 'data-theme', 'data-scheme'].includes(key))),
    scheme, meta, extraHead: safeExternalMeta, content, contentStart, contentEnd,
    contentLine: lineAt(source, contentStart), shell: fingerprint, modules, styles, scripts,
  };
}

export async function auditShell(html, { expected, lang, theme, requireTitle = false } = {}) {
  const failures = [];
  const notes = [];
  let shell;
  try { shell = parseShell(html); }
  catch (error) { return { failures: [{ code: 'BAD_SHELL', line: 1, detail: error.message, fix: '恢复 htmlview 统一外壳及唯一内容标记。' }], notes }; }
  const staticViz = shell.kind === 'viz';
  // Static figures are generated SVG (with literal paints). Audit all their resources, not document authoring rules.
  failures.push(...auditOuterResources(html, staticViz ? 0 : shell.contentStart, staticViz ? 0 : shell.contentEnd));
  if (lang && shell.lang !== lang) failures.push({ code: 'LANG_MISMATCH', line: 1, detail: `语言应为 ${lang}` });
  if (theme && shell.theme !== theme) failures.push({ code: 'THEME_MISMATCH', line: 1, detail: `主题应为 ${theme}` });
  if (requireTitle && !shell.title.trim()) failures.push({ code: 'MISSING_TITLE', line: 1, detail: '页面缺少标题' });
  const required = staticViz ? [] : modulesForContent(shell.content);
  const missing = required.filter((name) => !shell.modules.includes(name));
  if (missing.length) failures.push({ code: 'VIZ_MODULES', line: shell.contentLine, detail: `外壳缺少图形模块：${missing.join(', ')}`, fix: '运行 htmlview style 重新组装外壳。' });
  const vizResult = staticViz ? { failures: [], notes: [] } : auditViz(shell.content, { lang: lang ?? shell.lang, theme: shell.themeSnapshot ?? shell.theme ?? KCHART_DEFAULT_THEME, requireTitle: requireTitle && shell.kind === 'doc', contentLine: shell.contentLine });
  if (!vizResult.failures.length) {
    const declarations = staticViz ? [] : sourceDeclarations(shell.content);
    const currentStyles = [readingCss(shell.themeSnapshot), readAsset('page/viz.css'), ...shell.styles.slice(2)];
    const currentScripts = declarations.length ? [browserSource(declarations), currentRuntime(), ...shell.scripts.slice(2)] : shell.scripts;
    const actualCurrent = hash(fingerprintInput({
      kind: shell.kind, lang: shell.lang, theme: shell.theme, themeSnapshot: shell.themeSnapshot, attrs: normalizedAttrs(shell.attrs), scheme: shell.scheme,
      modules: required, styles: currentStyles, scripts: currentScripts,
    }));
    const storedMarkup = hash(fingerprintInput({
      kind: shell.kind, lang: shell.lang, theme: shell.theme, themeSnapshot: shell.themeSnapshot, attrs: normalizedAttrs(shell.attrs), scheme: shell.scheme,
      modules: shell.modules, styles: shell.styles, scripts: shell.scripts,
    }));
    if (shell.shell !== actualCurrent || shell.shell !== storedMarkup) notes.push({ code: 'SHELL_OUTDATED', line: 1, detail: '外壳资源指纹与当前页面、图形模块或运行时不一致。' });
  }
  if (expected != null) {
    const expectedHash = typeof expected === 'string' ? expected : expected?.shell ?? expected?.fingerprint;
    if (!/^[a-f0-9]{64}$/i.test(String(expectedHash ?? ''))) failures.push({ code: 'BAD_EXPECTED', line: 1, detail: 'expected 必须是 SHA-256 指纹或包含 shell/fingerprint 的对象。' });
    else if (shell.shell !== expectedHash) notes.push({ code: 'SHELL_OUTDATED', line: 1, detail: '外壳指纹与 expected 指纹不一致。' });
  }
  if (staticViz) return { failures, notes };
  const css = shell.styles.join('\n');
  const staticResult = auditContent(shell.content, { kind: shell.kind, css, lang: shell.lang, contentLine: shell.contentLine, title: shell.title, allowStyle: shell.kind === 'ui', allowScript: shell.kind === 'ui' });
  return { failures: [...failures, ...staticResult.failures, ...vizResult.failures], notes: [...notes, ...staticResult.notes, ...vizResult.notes] };
}
