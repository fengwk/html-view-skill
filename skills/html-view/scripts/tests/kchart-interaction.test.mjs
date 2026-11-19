// KChart interaction contract is exercised in Chromium because SVG focus, pointer events and body portals require a real DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { launchBrowser } from '../src/shared/browser.mjs';

import { browserSource } from '../../vendor/kchart/esm/node.js';

const runtime = browserSource([{ chart: 'network', interaction: ['inspect', 'focus', 'pan-zoom', 'drag'] }]);

test('runtime module loads without a DOM and exposes attach', () => {
  const context = vm.createContext({});
  vm.runInContext(runtime, context);
  assert.equal(vm.runInContext('typeof document', context), 'undefined');
  assert.equal(vm.runInContext('typeof KChart.attach', context), 'function');
});

test('attach interactions follow each chart contract and print/cleanup restore static state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kchart-interaction-'));
  const file = join(dir, 'interaction.html');
  writeFileSync(file, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0}svg{width:600px;height:250px}</style>
  <svg id="chart" viewBox="0 0 600 300" width="600" height="300">
    <rect id="grid" x="0" y="0" width="600" height="300"/>
    <g id="root" data-kc-kind="node" data-kc-node="root" data-kc-label="根节点" opacity=".8" data-kc-related='["child","route-1","unrelated-path"]'><circle cx="50" cy="50" r="16"/><text x="50" y="80">root</text></g>
    <text id="root-label" data-kc-kind="label" data-kc-node="root" x="50" y="80">root label</text>
    <g id="child" display="inline" data-kc-kind="node" data-kc-node="child" data-kc-label="子节点" data-kc-related='["grandchild"]'><circle cx="120" cy="50" r="12"/></g>
    <g id="grandchild" data-kc-kind="node" data-kc-node="grandchild"><circle cx="170" cy="50" r="8"/></g>
    <path id="route" data-kc-kind="path" data-kc-edge="edge-1" data-kc-path="route-1" data-kc-source="root" data-kc-target="child" data-kc-node="child" data-kc-related='["root","child"]' data-kc-value="4" d="M50 50Q85 50 120 50"/>
    <path id="orphan-edge" data-kc-kind="path" data-kc-edge="unrelated" data-kc-path="unrelated-path" d="M20 100L50 100"/>
    <g id="legend" data-kc-kind="legend" data-kc-series="alpha" data-kc-label="系列 A"><text x="10" y="120">系列 A</text><circle id="legend-swatch" data-kc-series="alpha" cx="20" cy="120" r="4"/></g>
    <circle id="series-mark" display="inline" data-kc-series="alpha" cx="200" cy="50" r="8"/>
  </svg><script>${runtime}\nwindow.detachCurrent = KChart.attach(document.querySelector('#chart'), {chart:'network', layout:'force', interaction:['inspect','focus','pan-zoom','drag']});</script>`, 'utf8');
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(pathToFileURL(file).href);
    const noInteraction = await page.json(`(() => { const svg=document.querySelector('#chart'); const before=svg.outerHTML; const cleanup=KChart.attach(svg,{interaction:[]}); cleanup(); return before===svg.outerHTML; })()`);
    assert.equal(noInteraction, true, '默认空 interaction 不改变静态 SVG');

    const inspect = await page.json(`(() => { const node=document.querySelector('#root'); node.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,clientX:40,clientY:40})); return {text:document.querySelector('[role=tooltip]')?.textContent, described:node.getAttribute('aria-describedby'), html:document.querySelector('[role=tooltip]')?.innerHTML}; })()`);
    assert.equal(inspect.text, '根节点');
    assert.equal(inspect.html, '根节点', 'inspect 通过 textContent 插入，不能解释 HTML');
    assert.ok(inspect.described);

    const dragged = await page.json(`(() => {
      const svg=document.querySelector('#chart'), root=document.querySelector('#root');
      root.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,clientX:100,clientY:50}));
      svg.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,clientX:130,clientY:65}));
      svg.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,clientX:130,clientY:65}));
      return {transform:root.getAttribute('transform'), path:document.querySelector('#route').getAttribute('d')};
    })()`);
    assert.match(dragged.transform, /translate\(36 18\)/, 'drag uses inverse screen CTM to convert pointer motion across viewBox letterboxing');
    assert.equal(dragged.path, 'M 86 68 Q 103 59 120 50', 'drag moves the connected path endpoint and interpolates its quadratic control point');

    const network = await page.json(`(() => {
      const svg=document.querySelector('#chart'), root=document.querySelector('#root'), edge=document.querySelector('#route');
      root.dispatchEvent(new PointerEvent('pointerover',{bubbles:true})); const focus=edge.getAttribute('opacity'), orphan=document.querySelector('#orphan-edge').getAttribute('opacity'), grid=document.querySelector('#grid').getAttribute('opacity');
      const before=svg.getAttribute('viewBox'); document.querySelector('[aria-label="放大"]').click(); const zoom=svg.getAttribute('viewBox');
      svg.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); const escaped=edge.getAttribute('opacity');
      window.dispatchEvent(new Event('beforeprint'));
      return {focus,orphan,grid,before,zoom,escaped,view:svg.getAttribute('viewBox'),transform:root.getAttribute('transform'),path:edge.getAttribute('d'),toolbarHidden:document.querySelector('[aria-label="图表视图控制"]').hidden};
    })()`);
    assert.equal(network.focus, '1', 'network node focus includes an edge through its source/target identity');
    assert.equal(network.grid, null, 'focus leaves non-interactive grid decoration untouched');
    assert.equal(network.orphan, '.18', 'network focus does not interpret a related node ID as an unrelated edge ID');
    assert.notEqual(network.zoom, network.before, 'pan-zoom updates viewBox');
    assert.equal(network.escaped, null, 'Escape releases focus');
    assert.equal(network.view, network.before, 'beforeprint resets zoom');
    assert.equal(network.transform, null, 'beforeprint resets drag presentation');
    assert.equal(network.path, 'M50 50Q85 50 120 50', 'beforeprint restores the original connected path geometry');
    assert.equal(network.toolbarHidden, true, 'beforeprint hides the interactive toolbar');
    await page.evaluate(`window.dispatchEvent(new Event('afterprint'))`);
    assert.equal(await page.json(`document.querySelector('[aria-label="图表视图控制"]').hidden`), false, 'afterprint restores toolbar usability');

    await page.evaluate(`window.detachCurrent(); window.detachCurrent = KChart.attach(document.querySelector('#chart'), {chart:'mindmap', interaction:['collapse']});`);
    const collapse = await page.json(`(() => {
      const root=document.querySelector('#root'), label=document.querySelector('#root-label'), child=document.querySelector('#child'), grandchild=document.querySelector('#grandchild'), route=document.querySelector('#route');
      label.dispatchEvent(new MouseEvent('click',{bubbles:true})); const parentClosed={child:child.getAttribute('display'),grandchild:grandchild.getAttribute('display'),route:route.getAttribute('display'),expanded:label.getAttribute('aria-expanded')};
      root.dispatchEvent(new MouseEvent('click',{bubbles:true})); const parentOpened={child:child.getAttribute('display'),grandchild:grandchild.getAttribute('display'),expanded:label.getAttribute('aria-expanded')};
      child.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      root.dispatchEvent(new MouseEvent('click',{bubbles:true})); const closed={display:child.getAttribute('display'),route:route.getAttribute('display'),hidden:child.getAttribute('aria-hidden'),expanded:root.getAttribute('aria-expanded')};
      root.dispatchEvent(new MouseEvent('click',{bubbles:true})); const opened={display:child.getAttribute('display'),grandchild:grandchild.getAttribute('display'),grandHidden:grandchild.getAttribute('aria-hidden'),expanded:root.getAttribute('aria-expanded')};
      return {parentClosed,parentOpened,closed,opened};
    })()`);
    assert.deepEqual(collapse.parentClosed, { child: 'none', grandchild: 'none', route: 'none', expanded: 'false' }, 'clicking a node label collapses its entire related subtree');
    assert.deepEqual(collapse.parentOpened, { child: 'inline', grandchild: null, expanded: 'true' }, 'expanding an uncollapsed parent restores all descendants');
    assert.deepEqual(collapse.closed, { display: 'none', route: 'none', hidden: 'true', expanded: 'false' });
    assert.deepEqual(collapse.opened, { display: 'inline', grandchild: 'none', grandHidden: 'true', expanded: 'true' }, 'expanding a parent preserves the independently collapsed child subtree');
    const printCollapse = await page.json(`(() => { window.dispatchEvent(new Event('beforeprint')); return {child:document.querySelector('#child').getAttribute('display'),grandchild:document.querySelector('#grandchild').getAttribute('display'),expanded:document.querySelector('#root').getAttribute('aria-expanded')}; })()`);
    assert.deepEqual(printCollapse, { child: 'inline', grandchild: null, expanded: null }, 'beforeprint resets nested collapse state as well as its presentation');
    await page.evaluate(`window.dispatchEvent(new Event('afterprint'))`);

    await page.evaluate(`window.detachCurrent(); window.detachCurrent = KChart.attach(document.querySelector('#chart'), {chart:'line', interaction:['legend']});`);
    const legend = await page.json(`(() => {
      const item=document.querySelector('#legend'), mark=document.querySelector('#series-mark'), swatch=document.querySelector('#legend-swatch');
      item.dispatchEvent(new MouseEvent('click',{bubbles:true})); const hidden=mark.getAttribute('display'), swatchDisplay=swatch.getAttribute('display');
      item.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return {hidden,swatchDisplay,shown:mark.getAttribute('display')};
    })()`);
    assert.equal(legend.hidden, 'none', 'legend click hides its data series');
    assert.equal(legend.swatchDisplay, null, 'legend descendants remain visible when their series is hidden');
    assert.equal(legend.shown, 'inline', 'legend keyboard activation restores existing SVG display styling');

    await page.evaluate(`window.detachCurrent(); window.detachCurrent = KChart.attach(document.querySelector('#chart'), {chart:'parallel', interaction:['focus']});`);
    const parallel = await page.json(`(() => {
      document.querySelector('#series-mark').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));
      return {target:document.querySelector('#series-mark').getAttribute('opacity'),related:document.querySelector('#legend').getAttribute('opacity')};
    })()`);
    assert.deepEqual(parallel, { target: '1', related: '1' }, 'parallel focus highlights the selected series');

    await page.evaluate(`document.querySelector('#root').setAttribute('data-kc-related','["child","route-1"]'); window.detachCurrent(); window.detachCurrent = KChart.attach(document.querySelector('#chart'), {chart:'threads', interaction:['focus']});`);
    const threads = await page.json(`(() => {
      const root=document.querySelector('#root'), path=document.querySelector('#route');
      root.dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));
      return {focus:path.getAttribute('opacity'),readout:document.querySelector('[role=status]')?.textContent};
    })()`);
    assert.equal(threads.focus, '1', 'threads node focus selects its related path');
    assert.equal(threads.readout, '路径 1 条 · 权重合计 4', 'threads focus reports paths and provided weights using the document language');

    await page.evaluate(`window.detachCurrent(); window.detachCurrent = KChart.attach(document.querySelector('#chart'), {chart:'threads', interaction:['inspect','focus']});`);
    const pinned = await page.json(`(() => {
      const root=document.querySelector('#root');
      root.dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));
      root.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      root.dispatchEvent(new PointerEvent('pointerout',{bubbles:true,relatedTarget:document.body}));
      const during={pinned:root.getAttribute('opacity'),tip:!!document.querySelector('[role=tooltip]')};
      root.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      return {during,after:root.getAttribute('opacity'),tip:!!document.querySelector('[role=tooltip]')};
    })()`);
    assert.deepEqual(pinned.during, { pinned: '1', tip: true }, 'inspect and focus share one click-pin state and pointerout does not clear it');
    assert.deepEqual({ opacity: pinned.after, tip: pinned.tip }, { opacity: '.8', tip: false }, 'a second click consistently releases the pin and restores original opacity');

    const cleanup = await page.json(`(() => { window.detachCurrent(); window.detachCurrent(); return {view:document.querySelector('#chart').getAttribute('viewBox'),tip:!!document.querySelector('[role=tooltip]'),toolbar:!!document.querySelector('[aria-label="图表视图控制"]'),tab:document.querySelector('#chart').getAttribute('tabindex'),role:document.querySelector('#root').getAttribute('role'),display:document.querySelector('#child').getAttribute('display'),seriesDisplay:document.querySelector('#series-mark').getAttribute('display'),opacity:document.querySelector('#root').getAttribute('opacity'),focus:document.querySelector('#route').getAttribute('opacity'),hostPosition:document.body.style.position}; })()`);
    assert.deepEqual(cleanup, { view: '0 0 600 300', tip: false, toolbar: false, tab: null, role: null, display: 'inline', seriesDisplay: 'inline', opacity: '.8', focus: null, hostPosition: '' }, 'cleanup restores chart presentation without leaking styles onto the host');
  } finally {
    await page.close(); await browser.close(); rmSync(dir, { recursive: true, force: true });
  }
});
