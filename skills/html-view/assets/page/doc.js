(() => {
  'use strict';

  if (typeof document === 'undefined' || !document.documentElement) return;

  const root = document.documentElement;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  /* 界面文案跟随 <html lang>：以 zh 开头用中文，其余用英文 */
  const zh = /^zh\b/i.test(String(document.documentElement.lang || ''));
  const T = zh ? {
    sectionLink: '本节链接：',
    contents: '文档目录',
    brokenRef: (id) => '〔引用失效：' + id + '〕',
    copy: '复制',
    copied: '已复制',
    copyFailed: '复制失败',
    scrollHint: '可横向滚动 →',
    tableHint: '横向滚动查看完整表格 →',
    figureNum: '图',
    tableNum: '表',
    figureLabel: (n, title) => '图 ' + n + (title ? ' ' + title : ''),
    tableLabel: (n, title) => '表 ' + n + (title ? ' ' + title : ''),
    cmAction: '评论',
    cmEditor: '评论选中的文字',
    cmPlaceholder: '写评论，Ctrl / ⌘ + Enter 保存',
    cmCancel: '取消',
    cmSave: '保存',
    cmEmptyInput: '评论不能为空',
    cmPanel: '评论',
    cmTitle: (n) => '评论 ' + n,
    cmCopyAll: '复制全部',
    cmClear: '清空',
    cmClearConfirm: '删除这份文档的全部评论？',
    cmDelete: '删除',
    cmMissing: '原文已不在文档中',
    cmStart: '正文开头',
  } : {
    sectionLink: 'Section link: ',
    contents: 'Document contents',
    brokenRef: (id) => '[Broken reference: ' + id + ']',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Copy failed',
    scrollHint: 'Scroll horizontally →',
    tableHint: 'Scroll to see the full table →',
    figureNum: 'Figure',
    tableNum: 'Table',
    figureLabel: (n, title) => 'Figure ' + n + (title ? ' ' + title : ''),
    tableLabel: (n, title) => 'Table ' + n + (title ? ' ' + title : ''),
    cmAction: 'Comment',
    cmEditor: 'Comment on the selected text',
    cmPlaceholder: 'Write a comment. Ctrl / ⌘ + Enter to save',
    cmCancel: 'Cancel',
    cmSave: 'Save',
    cmEmptyInput: 'The comment is empty',
    cmPanel: 'Comments',
    cmTitle: (n) => 'Comments ' + n,
    cmCopyAll: 'Copy all',
    cmClear: 'Clear',
    cmClearConfirm: 'Delete all comments on this document?',
    cmDelete: 'Delete',
    cmMissing: 'The text is no longer in the document',
    cmStart: 'Start of the document',
  };

  /* 章节、锚点、目录、交叉引用 */
  const body = $('.doc-body');
  const heads = body ? $$('h2, h3', body) : [];
  let n2 = 0;
  let n3 = 0;
  const entries = heads.map((h) => {
    const level = h.tagName === 'H2' ? 1 : 2;
    if (level === 1) { n2 += 1; n3 = 0; } else { n3 += 1; }
    const text = h.textContent.trim().replace(/\s*#\s*$/, '');
    if (!h.id) h.id = 's-' + n2 + (level === 2 ? '-' + n3 : '');
    const a = document.createElement('a');
    a.className = 'h-anchor';
    a.href = '#' + h.id;
    a.textContent = '#';
    a.setAttribute('aria-label', T.sectionLink + text);
    h.append(a);
    return { h, level, n2, n3, text };
  });
  const byId = new Map(entries.map((e) => [e.h.id, e]));
  const numStyle = () => getComputedStyle(root).getPropertyValue('--num-style').trim();
  const fmt2 = (n) => (numStyle() === 'decimal-leading-zero' && n < 10 ? '0' + n : String(n));
  const label = (e) => (e.level === 1 ? fmt2(e.n2) : fmt2(e.n2) + '.' + e.n3);

  /* 图、表编号与交叉引用目标：编号按内容区文档顺序生成，作者不手写「图 N」 */
  const targetLabels = new Map();
  const cleanText = (el) => {
    if (!el) return '';
    const clone = el.cloneNode(true);
    $$('.fig-num, .tbl-num, .scroll-hint, .viz-copy', clone).forEach((x) => x.remove());
    return clone.textContent.trim().replace(/\s+/g, ' ');
  };
  const addNum = (el, className, text) => {
    if (!el || $('.' + className, el)) return;
    const s = document.createElement('span');
    s.className = className;
    s.textContent = text;
    el.prepend(s);
  };
  const annotate = () => {
    const scope = $('.main') || body || document;
    targetLabels.clear();
    let figs = 0;
    $$('.viz-figure', scope).forEach((fig) => {
      const titleEl = $('.fig-title', fig);
      if (!titleEl) return;
      figs += 1;
      const title = cleanText(titleEl);
      addNum($('.fig-heading', titleEl) || titleEl, 'fig-num', T.figureNum + ' ' + figs);
      if (fig.id) targetLabels.set(fig.id, T.figureLabel(figs, title));
    });
    let tables = 0;
    $$('table', scope).forEach((table) => {
      const caption = Array.from(table.children).find((c) => c.tagName === 'CAPTION');
      if (!caption) return;
      tables += 1;
      const title = cleanText(caption);
      addNum(caption, 'tbl-num', T.tableNum + ' ' + tables);
      if (table.id) targetLabels.set(table.id, T.tableLabel(tables, title));
    });
  };
  annotate();

  const buildToc = () => {
    const list = document.createElement('ol');
    let sub = null;
    entries.forEach((e) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#' + e.h.id;
      const n = document.createElement('span');
      n.className = 'toc-num';
      const t = document.createElement('span');
      t.textContent = e.text;
      a.append(n, t);
      li.append(a);
      if (e.level === 1) {
        list.append(li);
        sub = document.createElement('ol');
        li.append(sub);
      } else {
        (sub || list).append(li);
      }
    });
    $$('ol', list).forEach((x) => { if (!x.children.length) x.remove(); });
    return list;
  };
  const sideToc = $('#toc');
  if (sideToc && entries.length) sideToc.append(buildToc());
  const mobileToc = $('#toc-mobile');
  if (mobileToc && entries.length) {
    const nav = document.createElement('nav');
    nav.className = 'toc';
    nav.setAttribute('aria-label', T.contents);
    nav.append(buildToc());
    mobileToc.append(nav);
    nav.addEventListener('click', (ev) => { if (ev.target.closest('a')) mobileToc.open = false; });
  }
  const truncate = (text) => {
    const chars = Array.from(String(text).trim());
    return chars.length > 30 ? chars.slice(0, 30).join('') : chars.join('');
  };
  const renumber = () => {
    $$('.toc a').forEach((a) => {
      const e = byId.get(a.getAttribute('href').slice(1));
      const n = $('.toc-num', a);
      if (e && n && n.textContent !== label(e)) n.textContent = label(e);
    });
    const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
    $$('a.xref').forEach((a) => {
      let id = (a.getAttribute('href') || '').slice(1);
      try { id = decodeURIComponent(id); } catch (e) { /* 保留原始 id，按失效处理 */ }
      const e = byId.get(id);
      const numbered = targetLabels.get(id);
      if (e) {
        setText(a, '§' + label(e) + ' ' + e.text);
        a.classList.remove('is-broken');
      } else if (numbered) {
        setText(a, numbered);
        a.classList.remove('is-broken');
      } else {
        const target = document.getElementById(id);
        if (target) {
          a.classList.remove('is-broken');
          if (!a.textContent.trim()) setText(a, truncate(target.textContent));
        } else {
          setText(a, T.brokenRef(id));
          a.classList.add('is-broken');
        }
      }
    });
  };

  /* 当前章节高亮 */
  const side = $('.side');
  let current = null;
  const setActive = () => {
    let cur = null;
    for (const e of entries) {
      if (e.h.getBoundingClientRect().top <= 96) cur = e; else break;
    }
    if (!cur && entries.length) cur = entries[0];
    if (cur === current) return;
    current = cur;
    $$('.toc a').forEach((a) => {
      if (cur && a.getAttribute('href') === '#' + cur.h.id) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    });
    const active = side ? $('.toc a[aria-current]', side) : null;
    if (active && side.clientHeight) {
      const r = active.getBoundingClientRect();
      const s = side.getBoundingClientRect();
      if (r.top < s.top + 48 || r.bottom > s.bottom - 48) side.scrollTop += r.top - s.top - s.height / 2;
    }
  };
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; setActive(); });
  }, { passive: true });
  window.addEventListener('hashchange', setActive);

  /* 外壳补齐：侧栏标题、裸 table、pre[data-lang] 都交给运行时，内容区不重复写 */
  const sideTitle = $('.side-title');
  if (sideTitle && !sideTitle.textContent.trim()) {
    const h1 = $('.doc-head h1') || $('h1');
    if (h1) sideTitle.append(h1.textContent.trim());
  }

  /* 没有被 .table-wrap 包住的 table 自动包一层，才有横向滚动与提示 */
  $$('.doc-body table').forEach((table) => {
    if (table.closest('.table-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    table.replaceWith(wrap);
    wrap.append(table);
  });

  /* pre[data-lang] 自动包成 .code：标题栏显示 data-name 或语言，复制按钮由下面补 */
  $$('pre[data-lang]').forEach((pre) => {
    if (pre.closest('.code')) return;
    const wrap = document.createElement('div');
    wrap.className = 'code';
    const head = document.createElement('div');
    head.className = 'code-head';
    const name = document.createElement('span');
    name.className = 'code-name';
    name.textContent = pre.dataset.name || pre.dataset.lang;
    head.append(name);
    pre.replaceWith(wrap);
    wrap.append(head, pre);
  });

  /* 代码着色交给外壳内嵌的 Prism（script#doc-prism 带 data-manual，Prism 不会自己扫描页面）。
     data-lang 用 Prism 的语言名或别名；diff-<语言>（如 diff-java）在增删行里再按该语言着色。
     token 类加 prism- 前缀，免得和组件类（如 .tag）撞名。
     代码里已有子元素、超过 20 万字符、语言不认识时保持原样；Prism 出错也保持原样，不影响后面的复制按钮和评论。 */
  const Prism = window.Prism;
  // 没有 custom-class 插件就加不了前缀，类名会和组件类撞名，干脆不着色
  if (Prism && Prism.plugins.customClass) {
    Prism.plugins.customClass.prefix('prism-');
    const ALIAS = { patch: 'diff', golang: 'go', mysql: 'sql', zsh: 'bash', jsonc: 'json' };
    $$('pre[data-lang]').forEach((pre) => {
      const target = $('code', pre) || pre;
      if (target.children.length || target.textContent.length > 200000) return;
      const name = pre.dataset.lang.toLowerCase();
      const lang = ALIAS[name] || name;
      const isDiff = lang === 'diff' || lang.startsWith('diff-');
      const grammar = isDiff ? Prism.languages.diff : Prism.languages[lang];
      if (!grammar || typeof grammar !== 'object') return;
      try {
        target.innerHTML = Prism.highlight(target.textContent, grammar, lang);
        if (isDiff) target.classList.add('diff-highlight');
      } catch { /* 保持原样 */ }
    });
  }

  /* 复制文字：优先剪贴板接口；不可用时（部分浏览器的 file://）用隐藏文本框加 execCommand */
  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.append(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      area.remove();
      return ok;
    }
  };
  /* 按钮短暂显示复制结果，再恢复原文字 */
  const flashCopied = (btn, ok, idle) => {
    btn.textContent = ok ? T.copied : T.copyFailed;
    setTimeout(() => { btn.textContent = idle; }, 1600);
  };

  /* 代码复制 */
  $$('.code').forEach((block) => {
    const pre = $('pre', block);
    const head = $('.code-head', block);
    if (!pre || !head) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm copy';
    btn.textContent = T.copy;
    btn.addEventListener('click', async () => flashCopied(btn, await copyText(pre.textContent), T.copy));
    head.append(btn);
  });

  /* 文档内的锚点留在当前页（目录、交叉引用、跳到正文），其余链接在新标签页打开，读者不会离开文档。
     链接自己写了 target 时按作者的写法。 */
  const openLinksInNewTab = () => {
    $$('.main a[href]').forEach((a) => {
      const href = a.getAttribute('href').trim();
      if (!href || href.startsWith('#') || /^(?:mailto|tel):/i.test(href)) return;
      if (a.hasAttribute('target')) return;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    });
  };

  /* 划词评论：在正文里选中文字写评论；评论按文档 id 存在浏览器本地，右侧面板按文档顺序列出，
     「复制全部」拼成纯文本交给 Agent 逐条处理。原文用 CSS Highlight API 标出，不改动正文 DOM。 */
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (className, text) => {
    const b = el('button', 'btn ' + className, text);
    b.type = 'button';
    return b;
  };

  const initComments = () => {
    if (!body) return;
    const docId = ($('meta[name="htmlview:doc:id"]') || {}).content || location.pathname;
    const storeKey = 'htmlview-comments:' + docId;
    const isComment = (c) => c && typeof c.id === 'string' && typeof c.text === 'string' && typeof c.comment === 'string';
    let comments = [];
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey) || '[]');
      if (Array.isArray(saved)) comments = saved.filter(isComment);
    } catch (e) { comments = []; }
    const persist = () => {
      try {
        if (comments.length) localStorage.setItem(storeKey, JSON.stringify(comments));
        else localStorage.removeItem(storeKey);
      } catch (e) { /* 浏览器不让存时，评论只留在这次打开的页面里 */ }
    };

    /* 位置：选区起点所在的 h2 / h3，编号与目录、交叉引用一致；章节被删时用保存时的文字 */
    const sectionOf = (node) => {
      let found = null;
      for (const e of entries) {
        if (e.h === node || (e.h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) found = e;
        else break;
      }
      return found;
    };
    const sectionLabel = (e) => '§' + label(e) + ' ' + e.text;
    const whereOf = (c) => {
      const e = byId.get(c.section);
      return e ? sectionLabel(e) : (c.where || T.cmStart);
    };

    /* 找回原文：选区文字与 DOM 文字的空白不一致（换行、单元格分隔），两边都去掉空白再比对；
       先从评论所在章节往后找，找不到再从头找 */
    const indexText = () => {
      const chars = [];
      const nodes = [];
      const offsets = [];
      const sectionStart = new Map();
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const head = node.parentElement && node.parentElement.closest('h2, h3');
        if (head && head.id && !sectionStart.has(head.id)) sectionStart.set(head.id, chars.length);
        const s = node.data;
        for (let i = 0; i < s.length; i += 1) {
          if (/\s/.test(s[i])) continue;
          chars.push(s[i]);
          nodes.push(node);
          offsets.push(i);
        }
      }
      return { flat: chars.join(''), nodes, offsets, sectionStart };
    };
    const locate = (index, c) => {
      const needle = c.text.replace(/\s+/g, '');
      if (!needle) return null;
      let at = index.flat.indexOf(needle, index.sectionStart.get(c.section) || 0);
      if (at < 0) at = index.flat.indexOf(needle);
      if (at < 0) return null;
      const end = at + needle.length - 1;
      const range = document.createRange();
      range.setStart(index.nodes[at], index.offsets[at]);
      range.setEnd(index.nodes[end], index.offsets[end] + 1);
      return { at, range };
    };

    const canHighlight = typeof Highlight === 'function' && window.CSS && CSS.highlights;
    let located = new Map();
    const paint = (activeId) => {
      if (!canHighlight) return;
      CSS.highlights.set('doc-comment', new Highlight(...[...located.values()].map((x) => x.range)));
      const active = activeId && located.get(activeId);
      if (active) CSS.highlights.set('doc-comment-active', new Highlight(active.range));
      else CSS.highlights.delete('doc-comment-active');
    };

    /* 界面：选区旁的「评论」按钮、编辑框、右侧面板 */
    const action = button('btn-sm cm-action', T.cmAction);
    action.hidden = true;

    const editor = el('div', 'cm-editor');
    editor.hidden = true;
    editor.setAttribute('role', 'dialog');
    editor.setAttribute('aria-label', T.cmEditor);
    const edWhere = el('div', 'cm-where');
    const edQuote = el('blockquote', 'cm-quote');
    const input = el('textarea', 'cm-input');
    input.rows = 3;
    input.placeholder = T.cmPlaceholder;
    input.setAttribute('aria-label', T.cmEditor);
    const edError = el('span', 'cm-error');
    edError.setAttribute('role', 'alert');
    const cancel = button('btn-sm', T.cmCancel);
    const save = button('btn-sm cm-save', T.cmSave);
    const edActions = el('div', 'cm-actions');
    edActions.append(edError, cancel, save);
    editor.append(edWhere, edQuote, input, edActions);

    const panel = el('aside', 'cm-panel');
    panel.hidden = true;
    panel.setAttribute('aria-label', T.cmPanel);
    /* 面板头一行：标题、复制全部、清空 */
    const panelHead = el('div', 'cm-head');
    const title = el('b', 'cm-title');
    const copyAll = button('btn-sm cm-copy', T.cmCopyAll);
    const clear = button('btn-sm cm-clear', T.cmClear);
    panelHead.append(title, copyAll, clear);
    const list = el('ol', 'cm-list');
    panel.append(panelHead, list);
    /* 面板放进 .page，排在正文之后，和左侧目录一样占页面的一列 */
    ($('.page') || document.body).append(panel);
    document.body.append(action, editor);

    /* 面板与列表按当前评论重画；有评论时面板一直显示，没有时整列去掉。
       列表顺序就是原文在文档里的顺序，找不到原文的排在最后 */
    const render = (activeId) => {
      const index = indexText();
      located = new Map();
      comments.forEach((c) => {
        const hit = locate(index, c);
        if (hit) located.set(c.id, hit);
      });
      const pos = (c) => (located.has(c.id) ? located.get(c.id).at : Infinity);
      comments.sort((a, b) => pos(a) - pos(b));
      panel.hidden = !comments.length;
      root.classList.toggle('cm-open', comments.length > 0);
      title.textContent = T.cmTitle(comments.length);
      list.replaceChildren(...comments.map((c) => {
        const item = el('li', c.id === activeId ? 'cm-item is-active' : 'cm-item');
        item.dataset.id = c.id;
        const jump = el('button', 'cm-jump', whereOf(c));
        jump.type = 'button';
        const meta = el('div', 'cm-meta');
        meta.append(jump, button('btn-sm cm-delete', T.cmDelete));
        item.append(meta, el('blockquote', 'cm-quote', c.text), el('p', 'cm-text', c.comment));
        if (!located.has(c.id)) item.append(el('p', 'cm-missing', T.cmMissing));
        return item;
      }));
      paint(activeId);
    };

    /* 选区：两端都在正文里、去掉首尾空白后不为空才算 */
    let pending = null;
    let editing = null;
    let pointerDown = false;
    const readSelection = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
      const range = sel.getRangeAt(0);
      if (!body.contains(range.startContainer) || !body.contains(range.endContainer)) return null;
      const text = sel.toString().trim();
      if (!text) return null;
      /* 左边取整个选区的左边，其余取选区最末一段；换算成页面坐标，之后滚动页面，浮层仍贴着这段文字 */
      const all = range.getBoundingClientRect();
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
      const r = rects[rects.length - 1] || all;
      const box = { left: all.left + scrollX, right: r.right + scrollX, top: r.top + scrollY, bottom: r.bottom + scrollY };
      const e = sectionOf(range.startContainer);
      return { text, section: e ? e.h.id : '', where: e ? sectionLabel(e) : T.cmStart, box };
    };
    /* 浮层放在选区右侧（按钮）或下方（编辑框）；右侧放不下时换到下方，并收进视口宽度 */
    const place = (node, box, beside) => {
      const w = node.offsetWidth;
      const h = node.offsetHeight;
      const minLeft = scrollX + 8;
      const maxLeft = scrollX + innerWidth - w - 8;
      let left = beside ? box.right + 6 : box.left;
      let top = beside ? (box.top + box.bottom - h) / 2 : box.bottom + 8;
      if (left > maxLeft) {
        left = box.left;
        top = box.bottom + 8;
      }
      node.style.left = Math.round(Math.max(minLeft, Math.min(left, maxLeft))) + 'px';
      node.style.top = Math.round(top) + 'px';
    };
    const showAction = () => {
      pending = editor.hidden ? readSelection() : null;
      action.hidden = !pending;
      if (pending) place(action, pending.box, true);
    };
    const closeEditor = () => {
      editor.hidden = true;
      editing = null;
    };
    /* 拖选期间不弹按钮：鼠标或手指抬起后再判断；键盘选择在选区停稳后判断 */
    let settle = 0;
    document.addEventListener('selectionchange', () => {
      clearTimeout(settle);
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        pending = null;
        action.hidden = true;
        return;
      }
      if (!pointerDown) settle = setTimeout(showAction, 250);
    });
    /* 在编辑框外按下时，没写内容的编辑框直接关掉，读者可以接着选别的文字；写了内容的留着，不丢输入 */
    document.addEventListener('pointerdown', (ev) => {
      if (action.contains(ev.target) || editor.contains(ev.target)) return;
      if (!editor.hidden && !input.value.trim()) closeEditor();
      pointerDown = true;
    });
    document.addEventListener('pointerup', () => {
      if (!pointerDown) return;
      pointerDown = false;
      setTimeout(showAction, 0);
    });
    window.addEventListener('resize', () => { action.hidden = true; });

    const openEditor = () => {
      if (!pending) return;
      editing = pending;
      pending = null;
      action.hidden = true;
      edWhere.textContent = editing.where;
      edQuote.textContent = editing.text;
      input.value = '';
      edError.textContent = '';
      editor.hidden = false;
      place(editor, editing.box, false);
      input.focus();
    };
    const saveEditor = () => {
      const comment = input.value.trim();
      if (!comment) {
        edError.textContent = T.cmEmptyInput;
        input.focus();
        return;
      }
      const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      comments.push({ id, section: editing.section, where: editing.where, text: editing.text, comment, at: new Date().toISOString() });
      persist();
      closeEditor();
      window.getSelection().removeAllRanges();
      render(id);
    };
    /* 按下按钮时不让浏览器清掉选区 */
    action.addEventListener('mousedown', (ev) => ev.preventDefault());
    action.addEventListener('click', openEditor);
    cancel.addEventListener('click', closeEditor);
    save.addEventListener('click', saveEditor);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        saveEditor();
      }
    });
    editor.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeEditor(); });

    /* 复制给 Agent 的纯文本；围栏比文字里最长的反引号串多一个，原文里的代码块不会截断它 */
    const fenced = (heading, s) => {
      const f = '`'.repeat(Math.max(3, ...(s.match(/`+/g) || []).map((m) => m.length + 1)));
      return [heading, f, s, f].join('\n');
    };
    const clipboardText = () => {
      const h1 = $('.doc-head h1') || $('h1');
      const file = location.protocol === 'file:' ? decodeURIComponent(location.pathname) : location.href.split('#')[0];
      const out = ['Review Document: ' + (h1 ? h1.textContent.trim() : document.title), 'File: ' + file];
      comments.forEach((c) => out.push('', '---', '', whereOf(c), '', fenced('Selected Text', c.text), '', fenced('User Comment', c.comment)));
      return out.join('\n') + '\n';
    };

    copyAll.addEventListener('click', async () => flashCopied(copyAll, await copyText(clipboardText()), T.cmCopyAll));
    clear.addEventListener('click', () => {
      if (!window.confirm(T.cmClearConfirm)) return;
      comments = [];
      persist();
      render();
    });
    list.addEventListener('click', (ev) => {
      const item = ev.target.closest('.cm-item');
      if (!item) return;
      const id = item.dataset.id;
      if (ev.target.closest('.cm-delete')) {
        comments = comments.filter((c) => c.id !== id);
        persist();
        render();
        return;
      }
      if (!ev.target.closest('.cm-jump')) return;
      const hit = located.get(id);
      const c = comments.find((x) => x.id === id);
      const target = hit ? hit.range.startContainer.parentElement : (byId.get(c.section) || {}).h;
      if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      render(id);
    });

    render();
  };

  /* 图内放不下时提示可横向滚动 */
  const markOverflow = () => {
    $$('.viz-figure').forEach((fig) => {
      const scroller = $('.viz-body', fig);
      const cap = $('.fig-heading', fig) || $('.fig-title', fig);
      if (!scroller || !cap) return;
      const overflowing = scroller.scrollWidth > scroller.clientWidth + 1;
      let hint = $('.scroll-hint', cap);
      if (overflowing && !hint) {
        hint = document.createElement('span');
        hint.className = 'tag scroll-hint';
        hint.dataset.k = 'neutral';
        hint.textContent = T.scrollHint;
        cap.append(hint);
      } else if (!overflowing && hint) {
        hint.remove();
      }
    });
  };

  /* 表格放不下时给一行可停留的提示 */
  const markTables = () => {
    $$('.table-wrap').forEach((wrap) => {
      const overflowing = wrap.scrollWidth > wrap.clientWidth + 1;
      let hint = $('.table-hint', wrap);
      if (overflowing && !hint) {
        hint = document.createElement('span');
        hint.className = 'table-hint';
        hint.textContent = T.tableHint;
        wrap.prepend(hint);
      } else if (!overflowing && hint) {
        hint.remove();
      }
    });
  };

  /* 打印时展开折叠内容，打印后还原 */
  const folds = $$('details.fold');
  window.addEventListener('beforeprint', () => folds.forEach((d) => {
    if (!d.open) { d.dataset.printOpened = '1'; d.open = true; }
  }));
  window.addEventListener('afterprint', () => folds.forEach((d) => {
    if (d.dataset.printOpened) { delete d.dataset.printOpened; d.open = false; }
  }));

  const refresh = () => { markOverflow(); markTables(); };
  const reindex = () => { annotate(); renumber(); refresh(); };
  let resizeTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(refresh, 200); });
  window.addEventListener('load', refresh);
  window.addEventListener('afterprint', refresh);

  renumber();
  openLinksInNewTab();
  initComments();
  setActive();
  refresh();
  if (window.HtmlViewViz?.ready) window.HtmlViewViz.ready().then(reindex);
  let frame = 0;
  const observer = window.MutationObserver ? new MutationObserver(() => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; reindex(); });
  }) : null;
  if (observer) observer.observe($('.main') || body || document.body, { childList: true, subtree: true });
  if (document.fonts?.ready) document.fonts.ready.then(() => { if (window.HtmlViewViz?.ready) return window.HtmlViewViz.ready(); }).then(reindex);
})();
