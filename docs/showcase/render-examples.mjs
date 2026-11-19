// 从仓库内的合成样例生成 README 图示所用的实际 HTML 和 Chromium 截图；中英文各一套，输出到 <临时目录>/<语言>/。
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser } from '../../skills/html-view/scripts/src/shared/browser.mjs';
import { renderShell } from '../../skills/html-view/scripts/src/shared/shell.mjs';
import { renderUi } from '../../skills/html-view/scripts/src/artifacts/ui/render.mjs';

const cli = fileURLToPath(new URL('../../skills/html-view/scripts/htmlview', import.meta.url));
const here = name => fileURLToPath(new URL(name, import.meta.url));
// 两种语言使用同一组数字、元素 ID 和交互，只替换文字；中文原型同时是 UI 回归测试的夹具。
const LOCALES = {
  'zh-CN': { dashboardTitle: '拾光咖啡 · 经营看板', uiTitle: '留存观察台', filtered: '已筛选',
    ui: '../../skills/html-view/scripts/tests/fixtures/ui/retention-dashboard.html' },
  en: { dashboardTitle: 'Shiguang Coffee · Operations dashboard', uiTitle: 'Retention Watch', filtered: 'Filtered',
    ui: './examples/en/retention-dashboard.html' },
};
const root = await mkdtemp(join(tmpdir(), 'htmlview-examples-'));
const run = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' }));
const browser = await launchBrowser();
try {
  for (const [lang, locale] of Object.entries(LOCALES)) await renderLocale(lang, locale);
} finally {
  await browser.close();
}
console.log(root);

async function renderLocale(lang, locale) {
  const input = name => here(`./examples/${lang}/${name}`);
  const out = join(root, lang);
  const previews = join(out, 'previews');
  await mkdir(previews, { recursive: true });
  const doc = join(out, 'notification-platform.html');
  const report = join(out, 'coffee-report.html');
  const dashboard = join(out, 'coffee-dashboard.html');
  const ui = join(out, 'retention-dashboard.html');
  run('doc', 'build', input('notification-platform.md'), '--type', 'tech-spec', '--theme', 'claude', '--out', doc);
  run('data', 'validate', input('coffee/report.json'));
  run('data', 'build', input('coffee/report.json'), '--theme', 'claude', '--out', report);
  // Reuse the fictional source package, but select a compact set of KPIs and two side-by-side charts.
  const dashboardInput = join(out, 'dashboard-source');
  await cp(input('coffee'), dashboardInput, { recursive: true });
  const dashboardSpec = JSON.parse(await readFile(input('coffee/report.json'), 'utf8'));
  dashboardSpec.title = locale.dashboardTitle;
  dashboardSpec.layout = 'dashboard';
  dashboardSpec.datasets = dashboardSpec.datasets.filter(({ id }) => id !== 'regions');
  dashboardSpec.views = dashboardSpec.views.filter(({ filters }) => filters.channels);
  dashboardSpec.blocks = dashboardSpec.blocks.filter(({ type, dataset }) => type === 'kpi' || (type === 'chart' && dataset !== 'regions'));
  dashboardSpec.blocks[0].measures = dashboardSpec.blocks[0].measures.slice(0, 4);
  const dashboardFile = join(dashboardInput, 'report.json');
  await writeFile(dashboardFile, JSON.stringify(dashboardSpec, null, 2) + '\n');
  run('data', 'validate', dashboardFile);
  run('data', 'build', dashboardFile, '--theme', 'claude', '--out', dashboard);
  const content = await readFile(here(locale.ui), 'utf8');
  await writeFile(ui, renderUi({ title: locale.uiTitle, lang, device: 'responsive', content,
    design: { fidelity: 'mockup', scheme: 'light', brand: '#a84624' } }, renderShell).html);
  for (const file of [doc, report, dashboard, ui]) run('audit', file);

  const page = await browser.newPage();
  async function open(file, width, height, scale = 1) {
    await page.setViewport({ width, height, deviceScaleFactor: scale, mobile: width < 600 });
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(`(async()=>{await document.fonts.ready;await window.KChart?.ready();return true;})()`);
  }
  async function clip(name, selector, { height, through, margin = 0, width } = {}) {
    const bounds = await page.json(`JSON.stringify((()=>{
      const options=${JSON.stringify({ selector, height, through, margin, width })};
      const box=document.querySelector(options.selector).getBoundingClientRect();
      const end=options.through ? document.querySelector(options.through).getBoundingClientRect().bottom + options.margin : box.bottom;
      return {x:Math.round(Math.max(0,box.left+scrollX-options.margin)),y:Math.round(box.top+scrollY),
        width:Math.round(options.width ?? (box.width+2*options.margin)),height:Math.round(Math.min(options.height ?? Infinity,end-box.top))};
    })())`);
    await writeFile(join(previews, `${name}.png`), await page.screenshot(bounds));
  }
  await open(report, 1120, 900);
  // 捕获报告首屏，保留标题、视图切换、所有 KPI 和首张图。
  await clip('data-periodic', 'body > main', { through: '.viz-figure', margin: 16 });
  await open(doc, 1280, 900);
  await clip('doc-reading', 'body', { height: 795 });
  await clip('doc-architecture', '.viz-figure');
  await open(ui, 1360, 900);
  await clip('ui-desktop-overview', '.ui-frame', { through: '.card:has(#weekly-retention)' });
  await open(ui, 390, 900);
  await page.evaluate(`(async()=>{
    document.querySelector('#scr-overview a[data-go="scr-insights"]').click();
    const form=document.querySelector('#retention-filters');
    const channel=form.querySelector('select'), date=form.querySelector('input[type="date"]');
    channel.value='organic'; date.value='2026-11-19';
    for (const field of [channel,date]) field.dispatchEvent(new Event('change',{bubbles:true}));
    form.requestSubmit();
    await window.KChart.ready();
    if (!form.checkValidity() || form.querySelector('[data-when=${JSON.stringify(locale.filtered)}]').hidden) throw new Error('未进入已筛选状态');
    // 等待短暂的提醒消失，保留稳定的已筛选状态和完整图表。
    const deadline=performance.now()+6000;
    while(document.querySelector('.ui-toast-host')?.children.length){
      if(performance.now()>deadline) throw new Error('筛选提醒未退出');
      await new Promise(requestAnimationFrame);
    }
    return true;
  })()`);
  await clip('ui-mobile-filtered', '.ui-frame');
  await open(dashboard, 840, 840, 2);
  await clip('dashboard-hero', 'body', { through: '[data-chart-grid]', margin: 20, width: 840 });
  await open(dashboard, 360, 1000, 2);
  await clip('dashboard-mobile', 'body', { through: '[data-chart-grid] .viz-figure', margin: 14, width: 360 });
  await page.close();
}
