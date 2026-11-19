/** BCP 47 语言标签：主语言 2–3 个字母，后面每段 2–8 个字母或数字。 */
export const LANG_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
export const isZhLang = (lang) => /^zh\b/i.test(String(lang ?? ''));

/** 语言子标签小写、两字母地区大写、四字母文字标签首字母大写；zh 写成 zh-CN。 */
export function normalizeLangTag(lang) {
  const raw = String(lang ?? 'zh').trim();
  const parts = raw.split('-').filter(Boolean);
  const out = parts.map((part, i) => {
    if (i === 0) return part.toLowerCase();
    if (/^[A-Za-z]{2}$/.test(part)) return part.toUpperCase();
    if (/^[A-Za-z]{4}$/.test(part)) return part[0].toUpperCase() + part.slice(1).toLowerCase();
    return part.toLowerCase();
  });
  return out.length === 1 && out[0] === 'zh' ? 'zh-CN' : out.join('-');
}

/**
 * 未指定 --lang 时按内容推断外壳和图表用语（图号、目录、页码、图例措辞）。
 * 去掉代码与链接后比较英文词数和中日韩字数：英文词至少是中日韩字的两倍时按英文，否则按中文。
 * 英文正文里的人名、中文正文里的产品名和术语都不会改变判断。
 */
export function inferLang(...texts) {
  const text = texts.filter((item) => item != null).map(String).join('\n')
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ');
  const cjk = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length;
  const latin = (text.match(/[A-Za-z]{2,}/g) || []).length;
  return latin > 0 && latin >= cjk * 2 ? 'en' : 'zh-CN';
}

/** 提示条只有三类，标签固定：读者看标签就知道是哪一类，不靠颜色。 */
const NOTE_LABELS = {
  zh: { danger: '风险', warn: '注意', info: '说明' },
  en: { danger: 'Risk', warn: 'Warning', info: 'Note' },
};
export const noteLabels = (lang) => NOTE_LABELS[isZhLang(lang) ? 'zh' : 'en'];
