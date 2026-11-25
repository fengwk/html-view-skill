import { resolve as resolveIcon } from '../../../../vendor/kchart/esm/core/icons.js';
import { readAsset } from '../../shared/assets.mjs';
import { darkMockupPrint, generateTokens, normalizeDesign, normalizeDevice, normalizeLang } from './theme.mjs';

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const jsonForScript = (value) => JSON.stringify(value).replace(/<\/script/gi, '<\\/script');

function iconMarkup(content) {
  // The page chrome draws these itself: the date field button and the date picker's month arrows.
  const names = new Set(['calendar', 'chevron-left', 'chevron-right']);
  for (const match of String(content).matchAll(/\bdata-icon\s*=\s*(["'])([^"']+)\1/gi)) names.add(match[2]);
  const result = {};
  for (const name of names) {
    const icon = resolveIcon(name);
    if (!icon) continue;
    result[name] = icon.elements.map(({ tag, attrs }) => `<${tag}${Object.entries(attrs).map(([key, value]) => ` ${key}="${escapeHtml(value)}"`).join('')} />`).join('');
  }
  return result;
}

const isZh = (lang) => /^zh(?:-|$)/i.test(lang);
function translations(lang) {
  const dictionary = JSON.parse(readAsset('page/ui-i18n.json'));
  return isZh(lang) ? dictionary.zh : dictionary.en;
}

function shellContent(content, lang) {
  return {
    before: '<div class="ui-shell"><header class="ui-bar" id="ui-bar"></header><main class="ui-stage" id="main"><div class="ui-frame" id="ui-frame">',
    content: `\n${String(content ?? '')}\n`,
    after: `</div><aside class="ui-notes" id="ui-notes" aria-label="${escapeHtml(translations(lang).notes)}"></aside></main></div>`,
  };
}

export function renderUi({ title = '', lang = 'zh-CN', device = 'mobile', design = {}, content = '', attrs = {}, meta = {}, extraHead = '' }, renderShell) {
  const normalizedLang = normalizeLang(lang);
  const normalizedDevice = normalizeDevice(device);
  const normalizedDesign = normalizeDesign(design);
  const { themes, css, adjusted } = generateTokens(normalizedDesign);
  const frame = shellContent(content, normalizedLang);
  const config = `window.HTMLVIEW_UI=${jsonForScript({ icons: iconMarkup(content), t: translations(normalizedLang) })};\n${readAsset('page/ui.js')}`;
  const shellAttrs = {
    ...attrs,
    'data-device': normalizedDevice,
    'data-fidelity': normalizedDesign.fidelity,
    'data-scheme': normalizedDesign.scheme,
  };
  const uiMeta = {
    ...meta,
    'ui-device': normalizedDevice,
    'ui-fidelity': normalizedDesign.fidelity,
    'ui-brand': normalizedDesign.brand,
    'ui-scheme': normalizedDesign.scheme,
    'ui-radius': String(normalizedDesign.radius),
    'ui-density': normalizedDesign.density,
  };
  const html = renderShell({
    kind: 'ui',
    lang: normalizedLang,
    title,
    attrs: shellAttrs,
    meta: uiMeta,
    extraHead,
    styles: [readAsset('page/ui.css'), css],
    ...frame,
    scripts: [config],
    // 线框稿打印沿用浅色线框配色，不让暗色打印的默认 Paper 色板带回红色。
    vizOptions: { themes, copy: false, ...(normalizedDesign.fidelity === 'wireframe'
      ? { printScheme: 'light' } : { printThemes: { dark: darkMockupPrint } }) },
  });
  return { html, design: normalizedDesign, device: normalizedDevice, lang: normalizedLang, themes, adjusted };
}

export { escapeHtml, jsonForScript };
