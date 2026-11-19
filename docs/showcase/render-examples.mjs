// 从仓库内的合成样例生成 README 图示所用的实际 HTML 和 Chromium 截图。
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser } from '../../skills/html-view/scripts/src/shared/browser.mjs';
import { renderShell } from '../../skills/html-view/scripts/src/shared/shell.mjs';
import { renderUi } from '../../skills/html-view/scripts/src/artifacts/ui/render.mjs';

const cli = fileURLToPath(new URL('../../skills/html-view/scripts/htmlview', import.meta.url));
const input = name => fileURLToPath(new URL(`./examples/${name}`, import.meta.url));
const out = await mkdtemp(join(tmpdir(), 'htmlview-examples-'));
const previews = join(out, 'previews');
await mkdir(previews);
const run = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' }));
const doc = join(out, 'notification-platform.html');
const report = join(out, 'coffee-report.html');
const ui = join(out, 'retention-dashboard.html');
run('doc', 'build', input('notification-platform.md'), '--type', 'tech-spec', '--theme', 'claude', '--out', doc);
run('data', 'validate', input('coffee/report.json'));
run('data', 'build', input('coffee/report.json'), '--theme', 'paper', '--out', report);
const content = await readFile(new URL('../../skills/html-view/scripts/tests/fixtures/ui/retention-dashboard.html', import.meta.url), 'utf8');
await writeFile(ui, renderUi({ title: '留存观察台', lang: 'zh-CN', device: 'responsive', content,
  design: { fidelity: 'mockup', scheme: 'light' } }, renderShell).html);
for (const file of [doc, report, ui]) run('audit', file);

const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  async function open(file, width, height) {
    await page.setViewport({ width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(`(async()=>{await document.fonts.ready;await window.KChart?.ready();return true;})()`);
  }
  async function clip(name, selector, { height, through, margin = 0 } = {}) {
    const bounds = await page.json(`JSON.stringify((()=>{
      const options=${JSON.stringify({ selector, height, through, margin })};
      const box=document.querySelector(options.selector).getBoundingClientRect();
      const end=options.through ? document.querySelector(options.through).getBoundingClientRect().bottom + options.margin : box.bottom;
      return {x:Math.round(Math.max(0,box.left+scrollX-options.margin)),y:Math.round(box.top+scrollY),
        width:Math.round(box.width+2*options.margin),height:Math.round(Math.min(options.height ?? Infinity,end-box.top))};
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
    if (!form.checkValidity() || form.querySelector('[data-when="已筛选"]').hidden) throw new Error('未进入已筛选状态');
    // 等待短暂的提醒消失，保留稳定的已筛选状态和完整图表。
    const deadline=performance.now()+6000;
    while(document.querySelector('.ui-toast-host')?.children.length){
      if(performance.now()>deadline) throw new Error('筛选提醒未退出');
      await new Promise(requestAnimationFrame);
    }
    return true;
  })()`);
  await clip('ui-mobile-filtered', '.ui-frame');
} finally {
  await browser.close();
}
console.log(out);
