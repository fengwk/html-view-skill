import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from '../src/shared/browser.mjs';
import { renderShell } from '../src/shared/shell.mjs';
import { renderUi } from '../src/artifacts/ui/render.mjs';
import { audit } from '../src/artifacts/ui/index.mjs';

const fixture = readFileSync(new URL('./fixtures/ui/retention-dashboard.html', import.meta.url), 'utf8');

// Real Chrome verifies native form semantics survive custom widgets and screen/theme interactions use the new shell.
test('UI shell preserves select/date required-value-change behavior, navigation, and KChart theme relayout', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'htmlview-ui-browser-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'retention-dashboard.html');
  const rendered = renderUi({
    title: '留存观察台', lang: 'zh-CN', device: 'responsive', design: { fidelity: 'mockup', scheme: 'light' }, content: fixture,
  }, renderShell);
  const audited = await audit(rendered.html, { file });
  assert.deepEqual(audited.failures, [], JSON.stringify(audited.failures));
  assert.deepEqual(audited.notes, [], JSON.stringify(audited.notes));
  writeFileSync(file, rendered.html);
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setViewport({ width: 390, height: 844 });
  const url = pathToFileURL(file);
  // 首次通过 #scr-… 打开另一个屏幕：验证真的选中了目标，并且浏览器没有把它滚到吸顶工具栏下方。
  url.hash = 'scr-insights';
  await page.goto(url.href);
  const linked = await page.json(`(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return JSON.stringify({ screen: document.querySelector('#scr-insights').hidden, top: scrollY });
  })()`);
  assert.deepEqual(linked, { screen: false, top: 0 });
  // 换查询字符串触发完整导航，而不是只改 hash。
  url.hash = '';
  url.search = '?initial';
  await page.goto(url.href);

  const initial = await page.json(`JSON.stringify((()=>({screen:document.querySelector('#scr-overview').hidden,toolbar:!!document.querySelector('#ui-bar'),width:document.querySelector('.ui-seg[aria-label="宽度"] button[aria-pressed="true"]')?.textContent.trim()}))())`);
  assert.deepEqual(initial, { screen: false, toolbar: true, width: '手机' });
  assert.equal(await page.evaluate('window.retentionFixtureLabel'), '<title>示例字串，不是页面标题</title>');

  await page.evaluate(`document.querySelector('#scr-overview a[data-go="scr-insights"]').click()`);
  await page.evaluate(`new Promise((resolve,reject)=>{const start=performance.now();const poll=()=>{if(!document.querySelector('#scr-insights').hidden){resolve(true);return;}if(performance.now()-start>3000){reject(Error('screen navigation timed out'));return;}requestAnimationFrame(poll)};poll()})`);
  await page.evaluate(`window.__uiChanges={select:0,date:0};document.querySelector('#retention-channel').addEventListener('change',()=>window.__uiChanges.select++);document.querySelector('#retention-date').addEventListener('change',()=>window.__uiChanges.date++)`);

  const invalid = await page.json(`JSON.stringify((()=>{const form=document.querySelector('#retention-filters');form.querySelector('[type="submit"]').click();return {valid:form.checkValidity(),selectRequired:document.querySelector('#retention-channel').required,dateRequired:document.querySelector('#retention-date').required,state:document.querySelector('#scr-insights').querySelector('[data-when="已筛选"]').hidden}})())`);
  assert.deepEqual(invalid, { valid: false, selectRequired: true, dateRequired: true, state: true });

  await page.evaluate(`(()=>{const native=document.querySelector('#retention-channel');const button=native.parentElement.querySelector('.ui-combo');button.focus();button.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));button.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));button.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))})()`);
  const selected = await page.json(`JSON.stringify({value:document.querySelector('#retention-channel').value,text:document.querySelector('#retention-channel').parentElement.querySelector('.ui-combo').textContent.trim(),changes:window.__uiChanges.select})`);
  assert.equal(selected.value, 'organic');
  assert.match(selected.text, /自然流量/);
  assert.equal(selected.changes, 1, 'custom select dispatches one native change event');

  const chosenDate = await page.json(`JSON.stringify((()=>{const input=document.querySelector('#retention-date');const button=input.parentElement.querySelector('.ui-date');button.focus();button.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));const active=document.getElementById(button.getAttribute('aria-activedescendant')).dataset.date;const navIcons=[...document.querySelectorAll('.ui-date-nav')].map(nav=>nav.querySelectorAll('svg path').length);button.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));return {value:input.value,active,navIcons,required:input.required,min:input.min,max:input.max,changes:window.__uiChanges.date}})())`);
  assert.deepEqual(chosenDate.navIcons, [1, 1], 'previous and next month buttons each draw a chevron');
  assert.equal(chosenDate.value, chosenDate.active, 'keyboard selection writes the active date into the native input');
  assert.equal(chosenDate.required, true);
  assert.equal(chosenDate.changes, 1, 'custom calendar dispatches one native change event');
  assert.ok(chosenDate.value >= chosenDate.min && chosenDate.value <= chosenDate.max, 'keyboard selection respects native min/max bounds');
  const valid = await page.evaluate(`document.querySelector('#retention-filters').checkValidity()`);
  assert.equal(valid, true, 'native form validity follows the custom widget values');
  await page.evaluate(`document.querySelector('#retention-filters').requestSubmit()`);
  await page.evaluate(`new Promise((resolve,reject)=>{const start=performance.now();const poll=()=>{if(!document.querySelector('#scr-insights [data-when="已筛选"]').hidden){resolve(true);return;}if(performance.now()-start>3000){reject(Error('state change timed out'));return;}requestAnimationFrame(poll)};poll()})`);

  await page.evaluate(`document.querySelector('#scr-insights a[data-go="scr-overview"]').click()`);
  await page.evaluate(`new Promise((resolve,reject)=>{const start=performance.now();const poll=()=>{if(!document.querySelector('#scr-overview').hidden){resolve(true);return;}if(performance.now()-start>3000){reject(Error('return navigation timed out'));return;}requestAnimationFrame(poll)};poll()})`);
  await page.evaluate(`document.querySelector('#scr-overview a[data-go="scr-insights"]').click()`);
  await page.evaluate(`new Promise((resolve,reject)=>{const start=performance.now();const poll=()=>{if(!document.querySelector('#scr-insights').hidden&&document.querySelector('#channel-retention svg')){resolve(true);return;}if(performance.now()-start>5000){reject(Error('chart did not render after screen navigation'));return;}requestAnimationFrame(poll)};poll()})`);
  await page.evaluate('KChart.ready()');
  const beforeTheme = await page.json(`JSON.stringify({scheme:document.documentElement.dataset.scheme,svg:document.querySelector('#channel-retention svg').innerHTML,table:!!document.querySelector('#channel-retention .viz-data')})`);
  assert.equal(beforeTheme.scheme, 'light');
  assert.equal(beforeTheme.table, false, 'UI has no default readable chart table');
  assert.equal(await page.evaluate("getComputedStyle(document.querySelector('.card > #channel-retention')).marginBlockStart"), '0px',
    '图嵌入现有卡片时不叠加外边距');
  const desktop = await page.evaluate(`(()=>{document.querySelector('.ui-seg[aria-label="宽度"] button:nth-child(3)').click();return {width:document.querySelector('.ui-shell').dataset.width,pressed:document.querySelector('.ui-seg[aria-label="宽度"] button:nth-child(3)').getAttribute('aria-pressed')}})()`);
  assert.deepEqual(desktop, { width: 'desktop', pressed: 'true' });
  await page.evaluate('KChart.ready()');
  const lightDesktop = await page.json(`JSON.stringify({scheme:document.documentElement.dataset.scheme,svg:document.querySelector('#channel-retention svg').innerHTML})`);
  await page.evaluate(`document.querySelector('.ui-seg[aria-label="配色"] button:nth-child(2)').click()`);
  await page.evaluate('KChart.ready()');
  const afterTheme = await page.json(`JSON.stringify({scheme:document.documentElement.dataset.scheme,svg:document.querySelector('#channel-retention svg').innerHTML})`);
  assert.equal(afterTheme.scheme, 'dark');
  assert.notEqual(afterTheme.svg, lightDesktop.svg, 'KChart SVG is re-laid out with the dark vizOptions theme at the same viewport width');

  // 打印会复制不同设备和状态。两种尺寸须从同一声明各自绘制，也要覆盖从未显示过的状态。
  await page.setMedia('print');
  const print = await page.json(`(async () => {
    document.documentElement.dataset.mode = 'export';
    await new Promise(requestAnimationFrame);
    await KChart.relayout({ media: 'print' });
    const charts = Array.from(document.querySelectorAll('.ui-shot .viz-body > svg'));
    return JSON.stringify({
      charts: charts.map(svg => ({
        device: svg.closest('.ui-shot').dataset.w,
        width: Number(svg.getAttribute('width')),
        displayWidth: Math.round(svg.getBoundingClientRect().width),
        label: svg.getAttribute('aria-labelledby'),
      })),
      dataTables: document.querySelectorAll('.ui-shot .viz-data').length,
      buttons: Array.from(document.querySelectorAll('.ui-shot .screen .btn')).filter(button => !button.closest('[hidden]'))
        .map(button => getComputedStyle(button).display),
    });
  })()`);
  // 界面稿里的按钮是设计内容；阅读外壳在打印时隐藏自己的 .btn，不能连屏幕里的按钮一起删掉。
  assert.ok(print.buttons.length > 0, 'printed screens contain visible product buttons');
  assert.ok(print.buttons.every(display => display !== 'none'), `screen buttons stay in print: ${print.buttons}`);
  assert.equal(print.charts.length, 8);
  assert.equal(print.dataTables, 0, 'clones reuse UI host options');
  assert.equal(new Set(print.charts.map(({ label }) => label)).size, 8, 'clones have independent SVG reference IDs');
  for (const { device, width, displayWidth } of print.charts) {
    assert.equal(width, displayWidth, 're-layout, not SVG scaling');
    assert.ok(device === 'mobile' ? width <= 390 : width >= 900, `${device} rendered at ${width}px`);
  }
  await page.setMedia('screen');
  const restored = await page.json(`(async () => {
    delete document.documentElement.dataset.mode;
    await new Promise(requestAnimationFrame);
    await KChart.relayout({ media: 'screen' });
    return JSON.stringify({ shots: document.querySelectorAll('.ui-shot').length, screen: document.querySelector('#scr-insights').hidden, svg: !!document.querySelector('#channel-retention svg') });
  })()`);
  assert.deepEqual(restored, { shots: 0, screen: false, svg: true });
});
