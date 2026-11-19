/* KChart browser host runtime. Loaded after the selected browserSource(). */
(() => {
  'use strict';
  const K = globalThis.KChart;
  if (!K) return;

  const mounted = new Set();
  const mountedRoots = new WeakMap();
  const usedPrefixes = new Set();
  let prefixSequence = 0;
  let pending = Promise.resolve();
  const mediaOverrides = new WeakMap();
  const printEvents = new WeakSet();
  const docOf = (root) => root?.nodeType === 9 ? root : root?.ownerDocument || document;
  const rootElement = (root) => root?.nodeType === 9 ? root.documentElement : root;
  const languageOf = (doc, options) => options.lang || doc.documentElement.lang || 'zh-CN';
  const isZh = (lang) => /^zh(?:-|$)/i.test(String(lang));
  const mediaOf = doc => mediaOverrides.get(doc) ?? (
    printEvents.has(doc) || doc.defaultView.matchMedia?.('print').matches ? 'print' : 'screen'
  );
  const errorText = (doc, message, invalid = false, lang = 'zh-CN') => {
    const zh = isZh(lang);
    return `${invalid ? (zh ? '图表声明无法解析。' : 'The chart declaration is invalid.') : (zh ? '图表重排失败。' : 'Chart layout failed.')} ${String(message)}`;
  };
  const reportError = (figure, error, invalid, lang) => {
    let alert = figure.querySelector(':scope > .viz-error');
    if (!alert) {
      alert = figure.ownerDocument.createElement('div');
      alert.className = 'viz-error';
      alert.setAttribute('role', 'alert');
      figure.append(alert);
    }
    alert.textContent = errorText(figure.ownerDocument, error?.message || error, invalid, lang);
  };
  const measureFor = (node) => {
    const doc = node.ownerDocument;
    const context = doc.createElement('canvas').getContext('2d');
    const style = doc.defaultView.getComputedStyle(node);
    return (text, size = 12, weight = 400, font = style.fontFamily || 'sans-serif') => {
      if (!context) return String(text).length * size * 0.6;
      context.font = `${weight} ${size}px ${font}`;
      return context.measureText(String(text)).width;
    };
  };
  const innerWidth = (body) => {
    const style = body.ownerDocument.defaultView.getComputedStyle(body);
    const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    return Math.max(1, Math.floor(body.clientWidth - padding));
  };
  const centerAnchor = (body, svg) => {
    const width = Number(svg.getAttribute('width'));
    const anchorAttribute = svg.getAttribute('data-kchart-anchor-x');
    const anchor = anchorAttribute == null ? NaN : Number(anchorAttribute);
    const overflow = Number.isFinite(width) && width > body.clientWidth;
    body.classList.toggle('viz-scroll', overflow);
    if (!overflow) { body.scrollLeft = 0; return; }
    if (!Number.isFinite(anchor)) return;
    const offset = svg.getBoundingClientRect().left - body.getBoundingClientRect().left + body.scrollLeft;
    body.scrollLeft = Math.max(0, Math.min(body.scrollWidth - body.clientWidth, offset + anchor - body.clientWidth / 2));
  };
  const appendTable = (figure, spec, lang) => {
    const model = K.dataTable(spec, { lang });
    if (!model) return;
    const doc = figure.ownerDocument;
    const details = doc.createElement('details');
    details.className = 'viz-data';
    const summary = doc.createElement('summary');
    const zh = isZh(lang);
    summary.textContent = zh ? `图表数据 · ${model.rows.length} 行` : `Chart data · ${model.rows.length} ${model.rows.length === 1 ? 'row' : 'rows'}`;
    details.append(summary);
    const table = doc.createElement('table');
    const head = table.createTHead().insertRow();
    for (const { label } of model.columns) {
      const cell = doc.createElement('th');
      cell.scope = 'col';
      cell.textContent = label;
      head.append(cell);
    }
    const body = table.createTBody();
    for (const row of model.rows) {
      const tr = body.insertRow();
      row.forEach(({ text, value }) => {
        const cell = tr.insertCell();
        cell.textContent = text;
        cell.setAttribute('data-value', value == null ? 'null' : typeof value === 'object' ? JSON.stringify(value) : String(value));
      });
    }
    details.append(table);
    figure.append(details);
  };
  const readSpec = (pre, syntax) => {
    const source = pre.textContent || '';
    if (syntax === 'kchart') return { source, spec: JSON.parse(source), diagram: false };
    return { source, spec: null, diagram: true };
  };
  const mountSource = (pre, options) => {
    const doc = pre.ownerDocument;
    const syntax = pre.getAttribute('data-viz') || '';
    const figure = doc.createElement('figure');
    figure.classList.add('viz', 'viz-figure');
    for (const attr of [...pre.attributes]) {
      if (attr.name.toLowerCase().startsWith('on')) { pre.removeAttribute(attr.name); continue; }
      if (attr.name === 'data-viz') continue;
      if (attr.name === 'id') { figure.setAttribute('id', attr.value); pre.removeAttribute('id'); }
      else if (attr.name === 'class') for (const token of attr.value.split(/\s+/).filter(Boolean)) figure.classList.add(token);
      else figure.setAttribute(attr.name, attr.value);
    }
    const caption = doc.createElement('figcaption');
    caption.className = 'fig-title';
    const captionText = doc.createTextNode('');
    const subtitle = doc.createElement('span');
    subtitle.className = 'fig-sub';
    caption.append(captionText);
    figure.append(caption);
    const body = doc.createElement('div');
    body.className = 'fig-body viz-body';
    figure.append(body);
    pre.hidden = true;
    pre.replaceWith(figure);
    figure.append(pre);
    const basePrefix = String(figure.id || 'kchart').replace(/[^A-Za-z0-9_-]/g, '-') || 'kchart';
    let prefix = basePrefix;
    while (usedPrefixes.has(prefix)) prefix = `${basePrefix}-${++prefixSequence}`;
    usedPrefixes.add(prefix);
    const state = { figure, body, pre, options, prefix, width: 0, observer: null, detached: () => {}, pending: false, done: Promise.resolve() };
    const lang = languageOf(doc, options);
    const render = (force = false) => {
      state.pending = false;
      const rect = body.getBoundingClientRect();
      if (!rect.width || !body.clientWidth) return;
      const width = innerWidth(body);
      const themeId = options.theme ?? (options.themes ? (doc.documentElement.dataset.scheme === 'dark' ? options.themes.dark : options.themes.light) : doc.documentElement.dataset.theme);
      const media = options.media || mediaOf(doc);
      if (!force && width === state.width && themeId === state.theme && media === state.media && body.querySelector('svg')) return;
      state.done = Promise.resolve().then(() => {
        const parsed = readSpec(pre, syntax);
        const theme = typeof K.theme === 'function' ? K.theme(themeId, { media }) : themeId;
        const renderOptions = { width, lang, theme, measure: measureFor(body), frame: false, prefix, assets: options.assets };
        let result, spec = parsed.spec;
        if (parsed.diagram) result = K.diagram(parsed.source, { syntax, ...renderOptions });
        else {
          const validation = K.validate(spec);
          if (validation?.errors?.length) throw new Error(validation.errors.map((item) => item.message).join('; '));
          result = K.render(spec, renderOptions);
        }
        if (result?.diagnostics?.some((item) => item.severity === 'error' || item.code)) {
          const errors = result.diagnostics.filter((item) => item.severity === 'error' || item.code).map((item) => item.message).join('; ');
          if (errors) throw new Error(errors);
        }
        if (!result?.svg) throw new Error('KChart did not produce an SVG');
        const title = !parsed.diagram ? spec.title : result.scene?.heading;
        captionText.data = title || (isZh(lang) ? '图表' : 'Chart');
        if (!parsed.diagram && spec.subtitle) {
          if (subtitle.textContent !== spec.subtitle) subtitle.textContent = spec.subtitle;
          if (subtitle.parentNode !== caption) caption.append(subtitle);
        } else subtitle.remove();
        const template = doc.createElement('template');
        template.innerHTML = result.svg;
        const svg = template.content.querySelector('svg');
        if (!svg) throw new Error('KChart did not produce an SVG');
        state.detached();
        state.detached = () => {};
        const svgWidth = Number(svg.getAttribute('width'));
        if (Number.isFinite(svgWidth) && svgWidth > 0) svg.style.width = `${svgWidth}px`;
        svg.style.maxWidth = 'none';
        svg.style.height = 'auto';
        svg.style.display = 'block';
        body.replaceChildren(svg);
        body.style.overflowX = svgWidth > body.clientWidth ? 'auto' : '';
        centerAnchor(body, svg);
        figure.querySelector(':scope > .viz-error')?.remove();
        state.width = width;
        state.theme = themeId;
        state.media = media;
        if (!parsed.diagram && Array.isArray(spec.interaction) && spec.interaction.length > 0 && typeof K.attach === 'function') {
          state.detached = K.attach(svg, spec);
        }
        figure.querySelector(':scope > .viz-data')?.remove();
        figure.querySelector(':scope > .fig-meta')?.remove();
        if (!parsed.diagram && (spec.source || spec.note)) {
          const meta = doc.createElement('div');
          meta.className = 'fig-meta';
          if (spec.source) { const source = doc.createElement('span'); source.className = 'fig-source'; source.textContent = `${isZh(lang) ? '来源：' : 'Source: '}${spec.source}`; meta.append(source); }
          if (spec.note) { const note = doc.createElement('span'); note.className = 'fig-note'; note.textContent = `${isZh(lang) ? '注：' : 'Note: '}${spec.note}`; meta.append(note); }
          figure.append(meta);
        }
        if (options.dataTable !== false && !parsed.diagram) appendTable(figure, spec, lang);
      }).catch((error) => reportError(figure, error, true, lang));
      pending = Promise.all([pending.catch(() => {}), state.done]).then(() => undefined);
    };
    const schedule = () => {
      if (state.pending) return;
      state.pending = true;
      const win = doc.defaultView;
      (win.requestAnimationFrame || ((fn) => win.setTimeout(fn, 0)))(() => render());
    };
    state.render = render;
    state.schedule = schedule;
    const Resize = doc.defaultView.ResizeObserver;
    if (typeof Resize === 'function') { state.observer = new Resize(schedule); state.observer.observe(body); }
    render(true);
    return state;
  };
  const mount = (root = document, options = {}) => {
    const doc = docOf(root);
    const host = rootElement(root);
    const existing = mountedRoots.get(host);
    if (existing) return existing.dispose;
    const figures = [];
    for (const pre of host.querySelectorAll?.('pre[data-viz]:not([hidden])') || []) figures.push(mountSource(pre, options));
    const states = new Set(figures);
    const mountedRoot = { root: host, doc, options, states, dispose: null };
    mounted.add(mountedRoot);
    const scheduleAll = () => states.forEach((state) => {
      const win = doc.defaultView;
      (win.requestAnimationFrame || ((fn) => win.setTimeout(fn, 0)))(() => state.render(true));
    });
    const Mutation = doc.defaultView.MutationObserver;
    const attrObserver = typeof Mutation === 'function' ? new Mutation(scheduleAll) : null;
    attrObserver?.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-scheme', 'class'] });
    if (doc.fonts?.ready) void ready();
    mountedRoot.dispose = () => {
      if (!mounted.has(mountedRoot)) return;
      mounted.delete(mountedRoot);
      mountedRoots.delete(host);
      attrObserver?.disconnect();
      for (const state of states) { state.observer?.disconnect(); state.detached(); usedPrefixes.delete(state.prefix); }
      states.clear();
    };
    mountedRoots.set(host, mountedRoot);
    return mountedRoot.dispose;
  };
  // 导出克隆的 SVG 不继承原节点的监听器或可用宽度；从声明重新挂载。
  const mountClones = (root, sourceRoot = docOf(root)) => {
    const { options } = mountedRoots.get(rootElement(sourceRoot)) ?? {};
    if (!options || mountedRoots.has(root)) return mountedRoots.get(root)?.dispose;
    for (const pre of root.querySelectorAll('.viz-figure > pre[data-viz][hidden]')) {
      const figure = pre.parentNode;
      pre.hidden = false;
      figure.replaceWith(pre);
    }
    if (root.querySelector('pre[data-viz]:not([hidden])')) return mount(root, options);
  };
  const relayout = ({ media } = {}) => {
    if (media != null && media !== 'print' && media !== 'screen') throw new TypeError('media 必须为 screen 或 print');
    for (const item of mounted) {
      if (media) mediaOverrides.set(item.doc, media);
      for (const state of item.states) state.render(true);
    }
    return ready();
  };
  const ready = async () => {
    const items = [...mounted];
    await Promise.all(items.map(async (item) => {
      const requests = item.doc.fonts?.ready;
      await requests;
      if (!mounted.has(item)) return;
      const fontChanged = item.fonts !== requests;
      item.fonts = requests;
      for (const state of item.states) state.render(fontChanged);
      await Promise.all([...item.states].map(state => state.done));
    }));
    await pending;
  };
  globalThis.KChart = Object.freeze({ ...K, mount, mountClones, ready, relayout });
  if (typeof document !== 'undefined' && document.documentElement) {
    const lang = document.documentElement.lang || 'zh-CN';
    const start = () => mount(document, { lang });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else queueMicrotask(start);
    if (typeof globalThis.matchMedia === 'function') {
      globalThis.matchMedia('print').addEventListener?.('change', () => relayout());
      // 系统打印事件不与 CLI 的显式媒体设置争抢；每次系统打印开始/结束时重置。
      globalThis.addEventListener?.('beforeprint', () => {
        mediaOverrides.delete(document);
        printEvents.add(document);
        void relayout();
      });
      globalThis.addEventListener?.('afterprint', () => {
        mediaOverrides.delete(document);
        printEvents.delete(document);
        void relayout();
      });
    }
  }
})();
