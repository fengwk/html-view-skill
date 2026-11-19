import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { has as hasIcon } from '../../../../vendor/kchart/esm/core/icons.js';
import { parseArgs } from '../../shared/args.mjs';
import { emit, fail } from '../../shared/output.mjs';
import { readAsset } from '../../shared/assets.mjs';
import { auditContent, auditOuterResources } from '../../shared/static-audit.mjs';
import { auditViz, modulesForContent } from '../../shared/viz.mjs';
import { parseShell, renderShell } from '../../shared/shell.mjs';
import { inferLang } from '../../shared/locale.mjs';
import { classList, partsOf, screensOf, splitList, tagsOf } from './model.mjs';
import { renderUi } from './render.mjs';
import { DEFAULTS, generateTokens, normalizeDesign, normalizeDevice, normalizeLang } from './theme.mjs';

const usageNew = 'htmlview ui new <file> --title <标题> --device mobile|desktop|responsive --screens "屏幕一,屏幕二" [选项]';
const usageStyle = 'htmlview style <file> [--lang <lang>] [--device mobile|desktop|responsive] [--fidelity wireframe|mockup] [--brand #hex] [--scheme light|dark] [--radius 0-16] [--density compact|regular]';
const UI_CSS = readAsset('page/ui.css');
const UI_CLASSES = (() => {
  const css = UI_CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const names = new Set();
  for (const rule of css.matchAll(/([^{}]+)\{/g)) for (const match of rule[1].matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) names.add(match[1]);
  return names;
})();
const failKind = (file) => fail('NOT_UI', `${file} 不是界面稿`, { next: '用 htmlview ui new 新建界面稿，或检查 htmlview 元信息' });
function hardcodedColor(value) {
  const rest = String(value).replace(/var\([^)]*\)/gi, ' ').replace(/currentcolor|transparent|none|inherit|initial|unset/gi, ' ');
  return /#[\da-f]{3,8}\b/i.test(rest) || /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i.test(rest)
    || /\b(?:black|white|red|green|blue|yellow|orange|purple|pink|brown|gray|grey|silver|gold|navy|teal|aqua|cyan|magenta|fuchsia|lime|olive|maroon|ivory|beige|coral|crimson|indigo|violet|plum|tan|khaki|salmon|turquoise|lavender|orchid|azure|seashell|linen|snow)\b/i.test(rest);
}
function cssUsesFixedColor(css) {
  return String(css).split(';').some((declaration) => {
    const colon = declaration.indexOf(':');
    if (colon < 0) return false;
    const property = declaration.slice(0, colon).trim();
    return /^(?:color|background(?:-[\w-]+)?|border(?:-[\w-]+)*|outline(?:-[\w-]+)?|box-shadow|text-shadow|fill|stroke|stop-color|caret-color|accent-color|--[\w-]+)$/i.test(property)
      && hardcodedColor(declaration.slice(colon + 1));
  });
}

function splitSelectorList(value) {
  const parts = [];
  const closers = [];
  let start = 0;
  let quote = '';
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === '\\') { i += 1; continue; }
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && value[i + 1] === '*') {
      const end = value.indexOf('*/', i + 2);
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') closers.push(char === '(' ? ')' : ']');
    else if (char === closers.at(-1)) closers.pop();
    else if (char === ',' && !closers.length) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function readUi(html, file) {
  const doc = parseShell(html, file);
  if (doc.kind !== 'ui') failKind(file);
  const requiredMeta = ['ui-device', 'ui-fidelity', 'ui-brand', 'ui-scheme', 'ui-radius', 'ui-density'];
  const missingMeta = requiredMeta.filter((key) => doc.meta[key] == null || String(doc.meta[key]).trim() === '');
  if (missingMeta.length) fail('BAD_SHELL', `${file} 缺少界面设计元信息：${missingMeta.join('、')}`, { next: '从版本管理恢复界面元信息，或用 htmlview ui new 新建后搬运内容' });
  const design = normalizeDesign({
    fidelity: doc.meta['ui-fidelity'],
    brand: doc.meta['ui-brand'],
    scheme: doc.meta['ui-scheme'],
    radius: doc.meta['ui-radius'],
    density: doc.meta['ui-density'],
  });
  const device = normalizeDevice(doc.meta['ui-device']);
  if (doc.attrs['data-device'] !== device || doc.attrs['data-fidelity'] !== design.fidelity || doc.scheme !== design.scheme) fail('BAD_SHELL', `${file} 的 html 根属性与界面元信息不一致`, { next: '用 htmlview style 重写界面外壳' });
  return { ...doc, design, device, lang: normalizeLang(doc.lang) };
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function skeletonFor(screen, screens, device, lang) {
  const title = escapeHtml(screen.title);
  const navLabel = /^zh(?:-|$)/i.test(lang) ? '主导航' : 'Main navigation';
  // 响应式与桌面稿的每个屏幕都带同一套侧栏导航；窄宽度下侧栏由 CSS 收成横向导航。
  if (device === 'mobile') {
    return `<section class="screen" id="${screen.id}" data-title="${title}">
  <div class="app">
    <header class="app-bar"><h1>${title}</h1></header>
    <div class="app-body stack"><p>${/^zh(?:-|$)/i.test(lang) ? '在此描述此屏幕的目标、信息和操作。' : 'Describe this screen\'s purpose, information and actions.'}</p></div>
  </div>
</section>`;
  }
  const nav = screens.map((item) => `      <a class="side-nav-item" href="#${item.id}" data-go="${item.id}"${item.id === screen.id ? ' aria-current="page"' : ''}>${escapeHtml(item.title)}</a>`).join('\n');
  return `<section class="screen" id="${screen.id}" data-title="${title}">
  <div class="app">
    <nav class="side-nav" aria-label="${navLabel}">
${nav}
    </nav>
    <div class="app-main">
      <header class="top-bar"><h1>${title}</h1></header>
      <div class="app-body stack"><p>${/^zh(?:-|$)/i.test(lang) ? '在此描述此屏幕的目标、信息和操作。' : 'Describe this screen\'s purpose, information and actions.'}</p></div>
    </div>
  </div>
</section>`;
}

function newContent(screenNames, device, lang) {
  const screens = screenNames.map((title, index) => ({ id: `scr-${index + 1}`, title }));
  return `\n${screens.map((screen) => skeletonFor(screen, screens, device, lang)).join('\n\n')}\n`;
}

async function newUi(argv) {
  const parsed = parseArgs(argv, {
    title: { type: 'string' }, device: { type: 'string' }, screens: { type: 'string' },
    fidelity: { type: 'string' }, brand: { type: 'string' }, scheme: { type: 'string' },
    radius: { type: 'string' }, density: { type: 'string' }, lang: { type: 'string' }, force: { type: 'boolean' },
  }, { positionals: [1, 1], usage: usageNew });
  const { values, positionals } = parsed;
  if (!values.title?.trim()) fail('USAGE', '缺少 --title', { next: usageNew });
  if (!values.device) fail('USAGE', '缺少 --device', { next: usageNew });
  if (values.screens === undefined) fail('USAGE', '缺少 --screens', { next: usageNew });
  const device = normalizeDevice(values.device);
  const design = normalizeDesign({ ...DEFAULTS, ...values });
  const lang = normalizeLang(values.lang ?? inferLang(values.title, values.screens));
  const screenNames = String(values.screens).split(/[,，]/).map((name) => name.trim());
  if (!screenNames.length || screenNames.some((name) => !name)) fail('BAD_VALUE', '--screens 必须包含至少一个非空屏幕名', { next: '用英文逗号或中文逗号分隔屏幕标题，不要留空项' });
  const file = resolve(positionals[0]);
  if (existsSync(file) && !values.force) fail('FILE_EXISTS', `${file} 已存在`, { next: '换一个路径；确需覆盖时添加 --force' });
  const { html, adjusted } = renderUi({
    title: values.title,
    lang,
    device,
    design,
    content: newContent(screenNames, device, lang),
    meta: { 'ui-id': randomUUID(), 'ui-created': new Date().toISOString().slice(0, 10) },
  }, renderShell);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
  emit({
    file, kind: 'ui', device, fidelity: design.fidelity,
    screens: screenNames.map((title, index) => ({ id: `scr-${index + 1}`, title })),
    tokens: { brand: design.brand, scheme: design.scheme, radius: design.radius, density: design.density, adjusted },
    next: `打开 ${file} 填写每个屏幕，再运行 htmlview audit ${file}`,
  });
}

export async function style(argv) {
  const parsed = parseArgs(argv, {
    lang: { type: 'string' }, device: { type: 'string' },
    fidelity: { type: 'string' }, brand: { type: 'string' }, scheme: { type: 'string' },
    radius: { type: 'string' }, density: { type: 'string' },
  }, { positionals: [1, 1], usage: usageStyle });
  const { values, positionals } = parsed;
  const file = resolve(positionals[0]);
  if (!existsSync(file)) fail('FILE_NOT_FOUND', `文件不存在：${file}`, { next: '检查路径后重试' });
  const before = readUi(readFileSync(file, 'utf8'), file);
  const design = normalizeDesign({ ...before.design, ...Object.fromEntries(['fidelity', 'brand', 'scheme', 'radius', 'density'].filter((key) => values[key] !== undefined).map((key) => [key, values[key]])) });
  const device = normalizeDevice(values.device ?? before.device);
  const lang = normalizeLang(values.lang ?? before.lang);
  const changed = {};
  for (const key of ['fidelity', 'brand', 'scheme', 'radius', 'density', 'device', 'lang']) {
    const from = key === 'device' ? before.device : key === 'lang' ? before.lang : before.design[key];
    const to = key === 'device' ? device : key === 'lang' ? lang : design[key];
    if (from !== to) changed[key] = { from, to };
  }
  const result = renderUi({
    title: before.title,
    lang,
    device,
    design,
    content: before.content,
    attrs: before.attrs,
    meta: before.meta,
    extraHead: before.extraHead,
  }, renderShell);
  if (result.html !== readFileSync(file, 'utf8')) writeFileSync(file, result.html);
  emit({ kind: 'ui', file, changed, tokens: { brand: design.brand, scheme: design.scheme, radius: design.radius, density: design.density, adjusted: result.adjusted } });
}

function addFailure(failures, content, contentLine, code, pos, detail, fix, where = '内容区') {
  failures.push({
    code,
    where,
    line: contentLine + String(content).slice(0, pos).split('\n').length - 1,
    detail,
    fix,
  });
}

export async function audit(html, { file = '文件' } = {}) {
  const failures = [];
  const notes = [];
  let doc;
  try { doc = readUi(html, file); } catch (error) {
    failures.push({ code: error.code || 'NOT_UI', where: file, line: 1, detail: error.message, fix: error.next || '确认这是由 htmlview 生成的界面稿' });
    return { failures, notes };
  }
  failures.push(...auditOuterResources(html, doc.contentStart, doc.contentEnd));
  const content = doc.content;
  if (!doc.title.trim()) failures.push({ code: 'MISSING_TITLE', line: 1, where: file, detail: '界面稿缺少页面标题', fix: '补上页面标题，并用 htmlview style 重写外壳' });
  const screens = screensOf(content);
  const contentLine = doc.contentLine || 1;
  if (!screens.length) addFailure(failures, content, contentLine, 'NO_SCREEN', 0, '内容区没有界面屏幕', '添加顶层 <section class="screen" id="scr-…" data-title="…">');
  const byId = new Map();
  for (const screen of screens) {
    const where = `屏幕「${screen.title || screen.id || '未命名'}」`;
    if (!screen.id || !/^scr-[\w-]+$/.test(screen.id) || !screen.title) addFailure(failures, content, contentLine, 'SCREEN_TITLE', screen.start, '屏幕需要 scr- 前缀的唯一 id 和 data-title', '为屏幕补上唯一 id="scr-…" 与 data-title');
    if (screen.id && byId.has(screen.id)) addFailure(failures, content, contentLine, 'DUPLICATE_ID', screen.start, `屏幕 id 重复：${screen.id}`, '修改为唯一 id，并同步更新屏幕跳转');
    if (screen.id) byId.set(screen.id, screen);
    if (new Set(screen.states).size !== screen.states.length) addFailure(failures, content, contentLine, 'UNKNOWN_STATE', screen.start, 'data-states 中有重复名称', '每种屏幕状态只写一次');
    const declared = new Set(screen.states);
    for (const element of tagsOf(screen.html)) {
      const attrs = element.attrs;
      const when = splitList(attrs['data-when']);
      for (const state of when) if (!declared.has(state)) addFailure(failures, content, contentLine, 'UNKNOWN_STATE', screen.start + element.start, `未声明状态「${state}」`, '将状态加入屏幕 data-states，或改为已有状态', where);
      for (const key of ['data-state-to', 'data-go-state', 'data-next']) {
        const state = attrs[key];
        if (!state) continue;
        const targetScreen = key === 'data-go-state' ? screens.find((item) => item.id === attrs['data-go']) : screen;
        if (!targetScreen || !targetScreen.states.includes(state)) addFailure(failures, content, contentLine, 'UNKNOWN_STATE', screen.start + element.start, `${key} 指向未声明状态「${state}」`, '把目标状态写入对应屏幕的 data-states，或删除该属性', where);
      }
      if (attrs['data-go'] && !byId.has(attrs['data-go']) && !screens.some((item) => item.id === attrs['data-go'])) addFailure(failures, content, contentLine, 'BROKEN_TARGET', screen.start + element.start, `data-go 目标不存在：${attrs['data-go']}`, '改为现有 section.screen 的 id', where);
      if (attrs['data-open'] && !tagsOf(content).some((item) => item.name === 'dialog' && item.attrs.id === attrs['data-open'])) addFailure(failures, content, contentLine, 'BROKEN_TARGET', screen.start + element.start, `data-open 目标不存在：${attrs['data-open']}`, '改为现有 dialog 的 id', where);
      if (attrs['data-toggle'] && !tagsOf(content).some((item) => item.attrs.id === attrs['data-toggle'])) addFailure(failures, content, contentLine, 'BROKEN_TARGET', screen.start + element.start, `data-toggle 目标不存在：${attrs['data-toggle']}`, '改为内容区里存在的目标 id', where);
      if (attrs['data-tab'] && !tagsOf(content).some((item) => item.attrs.id === attrs['data-tab'])) addFailure(failures, content, contentLine, 'BROKEN_TARGET', screen.start + element.start, `data-tab 面板不存在：${attrs['data-tab']}`, '改为现有 tabpanel 的 id', where);
      if (attrs['data-next'] && !attrs['data-when']) addFailure(failures, content, contentLine, 'UNKNOWN_STATE', screen.start + element.start, 'data-next 需要与 data-when 同用', '给自动推进元素添加 data-when，或删除 data-next', where);
      if (attrs['data-icon'] && !hasIcon(attrs['data-icon'])) addFailure(failures, content, contentLine, 'UNKNOWN_ICON', screen.start + element.start, `core/icons 中没有图标：${attrs['data-icon']}`, '改用 core/icons 已登记的图标名', where);
    }
  }
  const allTags = tagsOf(content);
  const hasInlineScript = allTags.some(({ name, attrs, closing }) => name === 'script' && !closing && !Object.hasOwn(attrs, 'src'));
  const formRanges = allTags.filter((tag) => tag.name === 'form' && !tag.closing).map((open) => ({
    start: open.start,
    end: allTags.find((tag) => tag.name === 'form' && tag.closing && tag.start > open.start)?.end ?? content.length,
  }));
  const labelRanges = allTags.filter((tag) => tag.name === 'label' && !tag.closing).map((open) => ({
    start: open.start,
    end: allTags.find((tag) => tag.name === 'label' && tag.closing && tag.start > open.start)?.end ?? content.length,
  }));
  const ids = new Set();
  const styleBlocks = [...content.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)];
  const firstScreen = screens[0];
  if (styleBlocks.length > 1 || (styleBlocks.length && firstScreen && styleBlocks[0].index > firstScreen.start)) {
    addFailure(failures, content, contentLine, 'CUSTOM_STYLE', styleBlocks[0].index, '内容区最多有一个自定义 style，且必须位于第一个屏幕之前', '把自定义规则集中放在内容区开头');
  }
  const customClasses = new Set(styleBlocks.flatMap(([, css]) => [...css.matchAll(/\.((?:x-)[\w-]+)/g)].map((match) => match[1])));
  for (const [index, css] of styleBlocks.map((match) => [match.index, match[1]])) {
    if (/@(?:import|font-face|page)\b|url\s*\(|!important|expression\s*\(|javascript\s*:/i.test(css)) addFailure(failures, content, contentLine, 'CUSTOM_STYLE', index, '自定义样式包含禁止的外链或危险规则', '只使用 x- class、主题变量和受控布局规则');
    for (const atRule of css.matchAll(/@([\w-]+)/g)) if (!['media', 'container', 'supports', 'keyframes'].includes(atRule[1].toLowerCase())) addFailure(failures, content, contentLine, 'CUSTOM_STYLE', index + atRule.index, `不支持的 CSS 规则 @${atRule[1]}`, '只使用 @media、@container、@supports 和 @keyframes x-…');
    if (/@keyframes\s+(?!x-)[\w-]+/i.test(css)) addFailure(failures, content, contentLine, 'CUSTOM_STYLE', index, '@keyframes 名称必须以 x- 开头', '将动画名改为 x-…');
    if (cssUsesFixedColor(css)) addFailure(failures, content, contentLine, 'HARDCODED_COLOR', index, '自定义样式不能写固定颜色', '改用界面主题变量、currentColor 或透明色');
    for (const selector of css.matchAll(/(?:^|})\s*([^@{}][^{}]*)\{/g)) {
      const value = selector[1].trim();
      if (value.startsWith('@')) continue;
      if (/^(?:from|to|\d+(?:\.\d+)?%)(?:\s*,|$)/i.test(value) && /@keyframes\b/i.test(css)) continue;
      if (splitSelectorList(value).some((part) => !part.trim().startsWith('.x-'))) addFailure(failures, content, contentLine, 'CUSTOM_STYLE', index + selector.index, '自定义 CSS 选择器必须以 x- class 起头', '将选择器改为 .x-…，并只扩展界面稿专属元素');
    }
  }
  for (const element of allTags) {
    const { attrs, name, start } = element;
    if (attrs.id) {
      if (ids.has(attrs.id)) addFailure(failures, content, contentLine, 'DUPLICATE_ID', start, `id 重复：${attrs.id}`, '修改为唯一 id，并同步更新引用');
      ids.add(attrs.id);
    }
    if (!element.closing) {
      for (const className of classList(attrs)) if (!UI_CLASSES.has(className) && !customClasses.has(className)) addFailure(failures, content, contentLine, 'UNKNOWN_CLASS', start, `未登记的内容 class：${className}`, '使用 ui-components.md 中列出的组件 class，或在开头的 style 中定义 x- class');
      if (name === 'script' && attrs.src) addFailure(failures, content, contentLine, 'FORBIDDEN_TAG', start, '内容区脚本不能加载外部文件', '将受控原型逻辑写在行内 script');
      if (attrs.style && cssUsesFixedColor(attrs.style)) addFailure(failures, content, contentLine, 'HARDCODED_COLOR', start, 'style 属性不能写固定颜色', '改用界面主题变量、currentColor 或透明色');
    }
    if (!element.closing && ['input', 'select', 'textarea'].includes(name) && !['hidden', 'submit', 'button', 'reset'].includes(attrs.type)) {
      const labeled = attrs['aria-label'] || attrs['aria-labelledby'] || (attrs.id && allTags.some((tag) => tag.name === 'label' && tag.attrs.for === attrs.id))
        || labelRanges.some((range) => start > range.start && start < range.end);
      if (!labeled) addFailure(failures, content, contentLine, 'NO_LABEL', start, `${name} 控件没有可访问名称`, '关联 label，或添加 aria-label');
    }
    const nativeFormAction = name === 'button' && ['submit', 'reset'].includes(attrs.type) && formRanges.some((range) => start > range.start && start < range.end);
    // data-close 是无值属性；其余动作必须有目标或反馈文字。
    const control = !element.closing && (name === 'button' || name === 'a');
    const action = control && attrs['data-action']?.trim();
    if (action && !hasInlineScript) {
      addFailure(failures, content, contentLine, 'ORPHAN_ACTION', start, `data-action「${action}」没有内容区脚本处理`,
        `在内容区行内 script 中用 [data-action="${action}"] 绑定事件，或改用 data-go、data-state-to 等声明式属性`);
    }
    const declared = (action && hasInlineScript) || Object.hasOwn(attrs, 'data-close') || ['data-go', 'data-open', 'data-toggle', 'data-tab', 'data-toast', 'data-state-to', 'href', 'data-note'].some((key) => attrs[key]?.trim());
    if (control && !nativeFormAction && !declared) {
      const end = content.indexOf(`</${name}>`, start);
      const text = (attrs['aria-label'] || (end < 0 ? '' : content.slice(start, end).replace(/<[^>]*>/g, ''))).trim().slice(0, 40);
      const line = contentLine + String(content).slice(0, start).split('\n').length - 1;
      notes.push({ code: 'INERT_CONTROL', line, message: `第 ${line} 行 <${name}>${text ? `「${text}」` : ''} 没有声明原型交互；加 data-go、data-state-to、data-open、data-close、data-toast 或由行内脚本处理的 data-action 等，或改成不可点的元素` });
    }
  }
  const requiredModules = modulesForContent(content);
  const missingModules = requiredModules.filter((name) => !doc.modules.includes(name));
  if (missingModules.length) failures.push({ code: 'VIZ_MODULES', line: contentLine, detail: `外壳缺少图形模块：${missingModules.join(', ')}`, fix: '使用 htmlview style 重新生成包含当前图表的外壳' });
  const staticResult = auditContent(content, {
    kind: 'ui', css: [...doc.styles, ...styleBlocks.map(([, css]) => css)].join('\n'), lang: doc.lang, contentLine,
    allowStyle: true, allowScript: true, tokenCss: `${UI_CSS}\n${generateTokens(doc.design).css}`,
  });
  const vizResult = auditViz(content, { lang: doc.lang, theme: doc.design.scheme === 'dark' ? 'obsidian' : 'paper', contentLine });
  // Native forms are part of the UI contract; the general document auditor rejects them for other artifacts.
  failures.push(...staticResult.failures.filter((item) => !(item.code === 'FORBIDDEN_TAG' && item.where === '<form>')), ...vizResult.failures);
  notes.push(...staticResult.notes, ...vizResult.notes);
  return { failures, notes };
}

export function parts(html, { file = '文件' } = {}) {
  const doc = readUi(html, file);
  return partsOf(doc.content);
}

export const commands = Object.freeze({ new: newUi });
export { renderUi, normalizeDesign, normalizeDevice, normalizeLang, generateTokens };
