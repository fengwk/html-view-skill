KChart.define('diagram/sequence', ({ 'diagram/support': u }) => {
  const { FONT, snap } = u;
  const LIMITS = Object.freeze({ participants: 8, messages: 40, fragmentDepth: 2, lines: 3 });
  const FRAGMENTS = new Set(['alt', 'opt', 'loop', 'par', 'critical', 'break']);
  const SECTIONS = new Set(['else', 'and', 'option']);
  const ARROWS = [['-->>', 'return'], ['->>', 'sync'], ['-->', 'return'], ['->', 'sync'], ['--x', 'lost'], ['-x', 'lost'], ['--)', 'async'], ['-)', 'async']];
  const issue = (lang, line, zh, en, fixZh, fixEn) => u.error(lang, line, zh, en, fixZh, fixEn);
  const colorLike = (text) => /(?:^|[\s,])(?:rgb|rgba|hsl|hsla)\s*\(|#[0-9a-f]{3,8}\b/i.test(text);

  function parse(source, info) {
    const { lang, options, firstLine } = info;
    const errors = [];
    for (const key of Object.keys(options)) {
      errors.push(issue(lang, firstLine - 1, `sequenceDiagram 不支持选项「${key}」`, `Unsupported sequenceDiagram option: ${key}`, '删掉第一行的选项', 'Remove the option from the first line'));
    }
    const participants = [];
    const byId = new Map();
    const statements = [];
    const stack = [];
    let messages = 0;

    function ensure(id, line, name = id) {
      if (byId.has(id)) return byId.get(id);
      if (participants.length >= LIMITS.participants) {
        errors.push(issue(lang, line, `参与者超过 ${LIMITS.participants} 个`, `More than ${LIMITS.participants} participants`, `删到 ${LIMITS.participants} 个参与者，或拆成两张图`, `Keep at most ${LIMITS.participants} participants, or split the diagram`));
        return null;
      }
      const actor = { id, name, kind: 'participant', line, index: participants.length };
      participants.push(actor);
      byId.set(id, actor);
      return actor;
    }
    function close(line, expected) {
      const open = stack.at(-1);
      if (!open) {
        errors.push(issue(lang, line, 'end 没有对应的开始语句', 'end has no matching start', '删掉这个 end，或在它前面补上片段、rect 或 box', 'Remove this end, or add the fragment, rect, or box it closes'));
        return;
      }
      if (expected && open.kind !== expected) {
        errors.push(issue(lang, line, `这里需要 end 结束「${open.keyword}」，不能写 ${expected === 'section' ? '分支' : expected}`, `Close "${open.keyword}" with end before starting another block`, `先写 end 结束第 ${open.line} 行`, `Write end to close line ${open.line} first`));
        return;
      }
      stack.pop();
      statements.push({ type: 'end', line, target: open });
    }

    const lines = String(source).split('\n');
    lines.forEach((raw, index) => {
      const lineNo = firstLine + index;
      if (!raw.trim() || raw.trimStart().startsWith('%%')) return;
      if (/^\s*\t|^\s+\t/.test(raw) || raw.includes('\t')) {
        errors.push(issue(lang, lineNo, '时序图语句不能使用 Tab', 'Tabs are not allowed in sequence statements', '把 Tab 换成空格', 'Replace tabs with spaces'));
        return;
      }
      const line = raw.trim();
      const decl = /^(participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/i.exec(line);
      if (decl) {
        const id = decl[2];
        const name = (decl[3] || id).trim();
        if (!name || /[:：]/.test(id)) {
          errors.push(issue(lang, lineNo, '参与者 ID 或名称无效', 'Invalid participant id or name', '写成 participant ID as 名称', 'Write participant ID as Name'));
          return;
        }
        const existing = byId.get(id);
        if (existing) {
          existing.name = name;
          existing.kind = decl[1].toLowerCase();
          existing.declared = true;
          existing.line = lineNo;
        } else {
          const actor = ensure(id, lineNo, name);
          if (actor) { actor.kind = decl[1].toLowerCase(); actor.declared = true; }
        }
        if (stack.at(-1)?.type === 'box') stack.at(-1).members.push(id);
        statements.push({ type: 'participant', id, line: lineNo });
        return;
      }
      if (/^activate\s+(\S+)$/i.test(line) || /^deactivate\s+(\S+)$/i.test(line)) {
        const [, word, id] = /^(activate|deactivate)\s+(\S+)$/i.exec(line);
        if (!ensure(id, lineNo)) return;
        statements.push({ type: word.toLowerCase(), id, line: lineNo });
        return;
      }
      const note = /^Note\s+(over\s+(\S+?)(?:\s*,\s*(\S+))?|left\s+of\s+(\S+)|right\s+of\s+(\S+))\s*:\s*(.*)$/i.exec(line);
      if (note) {
        const ids = note[2] ? [note[2], note[3]].filter(Boolean) : [note[4] || note[5]];
        if (ids.some((id) => !ensure(id, lineNo))) return;
        const text = note[6].trim();
        if (!text) {
          errors.push(issue(lang, lineNo, '注释不能为空', 'Note text cannot be empty', '在冒号后写上注释', 'Write the note after the colon'));
          return;
        }
        statements.push({ type: 'note', place: note[2] ? 'over' : (note[4] ? 'left' : 'right'), ids, text, line: lineNo });
        return;
      }
      const block = /^(alt|opt|loop|par|critical|break|rect|box|else|and|option|end)\b\s*(.*)$/i.exec(line);
      if (block) {
        const word = block[1].toLowerCase();
        const rest = block[2].trim();
        if (word === 'end') {
          if (rest) errors.push(issue(lang, lineNo, 'end 后面不能再写内容', 'end cannot have trailing text', '这一行只写 end', 'Leave only end on this line'));
          close(lineNo);
          return;
        }
        if (SECTIONS.has(word)) {
          const open = stack.at(-1);
          const allowed = { else: ['alt'], and: ['par'], option: ['critical'] }[word];
          if (!open || !allowed.includes(open.keyword)) {
            errors.push(issue(lang, lineNo, `「${word}」不能出现在当前片段里`, `"${word}" is not valid in the current fragment`, `把它放到对应的 ${allowed.join('/')} 片段中`, `Place it inside ${allowed.join('/')} before end`));
            return;
          }
          if (!rest) errors.push(issue(lang, lineNo, `「${word}」需要条件或说明`, `"${word}" needs a condition or label`, `写成 ${word} 条件`, `Write ${word} followed by a label`));
          statements.push({ type: 'section', keyword: word, text: rest, line: lineNo, owner: open.line });
          open.sections.push({ keyword: word, text: rest, line: lineNo });
          return;
        }
        if (word === 'rect' && colorLike(rest)) {
          errors.push(issue(lang, lineNo, 'rect 不接受颜色', 'rect does not accept a color', '去掉 rgb 或 # 色值，只保留区段说明或直接写 rect', 'Remove the rgb or # color and keep only a label, or write rect alone'));
          return;
        }
        if (word === 'box' && !rest) {
          errors.push(issue(lang, lineNo, '分组需要名称', 'A box needs a name', '写成 box 名称', 'Write box followed by its name'));
          return;
        }
        if (stack.filter((item) => item.kind === 'fragment').length >= LIMITS.fragmentDepth && word !== 'box' && word !== 'rect') {
          errors.push(issue(lang, lineNo, `组合片段最多嵌套 ${LIMITS.fragmentDepth} 层`, `Fragments nest at most ${LIMITS.fragmentDepth} levels`, '把内层片段拆到另一张图', 'Move the inner fragment to another diagram'));
          return;
        }
        const node = { type: word === 'box' ? 'box' : (word === 'rect' ? 'rect' : 'fragment'), keyword: word, text: rest, line: lineNo, kind: word === 'box' || word === 'rect' ? word : 'fragment', sections: [], members: [] };
        statements.push(node);
        stack.push(node);
        return;
      }
      let arrow = null;
      let from = '';
      let tail = '';
      for (const [token, style] of ARROWS) {
        const at = line.indexOf(token);
        if (at > 0 && !line.slice(0, at).includes(':')) { arrow = { token, style }; from = line.slice(0, at).trim(); tail = line.slice(at + token.length); break; }
      }
      if (arrow) {
        if (/[+-]$/.test(from)) {
          errors.push(issue(lang, lineNo, '激活简写不能写在发送方名字后', 'Activation shorthand cannot follow the sender name', '写成 A->>+B: 请求 或 B-->>-A: 返回，+ 激活接收方，- 结束发送方', 'Write A->>+B: request or B-->>-A: return; + activates the receiver and - deactivates the sender'));
          return;
        }
        const mark = /^\s*([+-])?\s*(\S+?)\s*([+-])?\s*(?::\s*([\s\S]*))?$/.exec(tail);
        const to = mark?.[2] || '';
        const signal = mark?.[1] || mark?.[3] || '';
        if (!from || !to || /\s|[+-]/.test(from) || /\s|[+-]/.test(to)) {
          errors.push(issue(lang, lineNo, '消息的参与者写法无效', 'Invalid message participants', '写成 A->>B: 消息，自调用写成 A->>A: 消息', 'Write A->>B: message, or A->>A: message for a self call'));
          return;
        }
        if (!ensure(from, lineNo) || !ensure(to, lineNo)) return;
        messages += 1;
        if (messages > LIMITS.messages) {
          errors.push(issue(lang, lineNo, `消息超过 ${LIMITS.messages} 条`, `More than ${LIMITS.messages} messages`, `删到 ${LIMITS.messages} 条，或拆成两张图`, `Keep at most ${LIMITS.messages} messages, or split the diagram`));
          return;
        }
        // + 激活接收方；- 结束发送方。箭头前后都接受，但不从参与者名字里剥掉。
        const activateOn = signal === '+' ? to : '';
        const deactivateOn = signal === '-' ? from : '';
        statements.push({
          type: 'message', from, to, style: arrow.style, text: (mark?.[4] || '').trim(), line: lineNo,
          activate: Boolean(activateOn), deactivate: Boolean(deactivateOn), activateOn, deactivateOn,
        });
        return;
      }
      errors.push(issue(lang, lineNo, `无法识别的语句「${line.slice(0, 40)}」`, `Unrecognized statement: ${line.slice(0, 40)}`, '改成 participant、消息、Note、片段、rect、box 或 end', 'Use participant, a message, Note, a fragment, rect, box, or end'));
    });
    for (const open of stack) {
      errors.push(issue(lang, open.line, `「${open.keyword}」缺少 end`, `"${open.keyword}" is missing end`, `在第 ${lines.length ? firstLine + lines.length - 1 : open.line} 行后补上 end`, 'Add end after the block'));
    }
    const depth = new Map();
    for (const item of statements) {
      if (item.type === 'activate') depth.set(item.id, (depth.get(item.id) || 0) + 1);
      if (item.type === 'message' && item.activateOn) depth.set(item.activateOn, (depth.get(item.activateOn) || 0) + 1);
      if (item.type === 'deactivate' || (item.type === 'message' && item.deactivateOn)) {
        const id = item.type === 'deactivate' ? item.id : item.deactivateOn;
        const next = (depth.get(id) || 0) - 1;
        if (next < 0) errors.push(issue(lang, item.line, `「${id}」的激活条没有配对的开始`, `Activation of "${id}" has no matching start`, `在这条之前写 activate ${id}，或给进入消息加 +`, `Write activate ${id} before this line, or add + to the incoming message`));
        depth.set(id, Math.max(0, next));
      }
    }
    for (const [id, count] of depth) {
      if (count > 0) errors.push(issue(lang, byId.get(id).line, `「${id}」的激活条没有结束`, `Activation of "${id}" is not closed`, `补上 deactivate ${id}，或在返回消息后加 -`, `Add deactivate ${id}, or append - to the return message`));
    }
    if (!participants.length) errors.push(issue(lang, firstLine, '图中没有参与者', 'The diagram has no participants', '写 participant，或写一条 A->>B: 消息', 'Add a participant or a message such as A->>B: text'));
    return { model: { type: 'sequence', participants, statements }, errors };
  }

  function layout(model, { measure, width, lang }) {
    const errors = [];
    const actors = model.participants.map((item) => ({ ...item }));
    const actorAt = (id) => actors.find((item) => item.id === id);
    const labelSize = (text, font) => {
      const all = u.wrapText(text, 168, font, measure);
      const lines = all.slice(0, LIMITS.lines);
      return { lines, w: snap(Math.max(64, u.maxWidthOf(lines, font, measure) + 24)), h: snap(Math.max(32, lines.length * 18 + 14)) };
    };
    for (const actor of actors) {
      const box = labelSize(actor.name, FONT.title);
      actor.head = box;
      actor.foot = labelSize(actor.name, FONT.title);
      if (u.wrapText(actor.name, 168, FONT.title, measure).length > LIMITS.lines) {
        errors.push(issue(lang, actor.line, `参与者「${actor.name}」超过 ${LIMITS.lines} 行`, `Participant "${actor.name}" exceeds ${LIMITS.lines} lines`, '缩短名称，说明移到图外', 'Shorten the name and move the description outside'));
      }
    }
    // 标签单行上限随版心收缩：窄宽度下按列均分预算折行，宽到列距够用后再放到 200px。
    const columnBudget = (Math.max(320, width) - 16) / (actors.length + 1);
    const labelLimit = Math.round(Math.max(96, Math.min(200, columnBudget)));
    const noteLimit = Math.round(Math.max(96, Math.min(180, columnBudget)));
    const events = [];
    const open = [];
    const push = (event) => { events.push(event); };
    for (const item of model.statements) {
      if (item.type === 'box' || item.type === 'rect' || item.type === 'fragment') {
        const head = item.type === 'box' ? 8 : (item.type === 'rect' ? 28 : 28);
        push({ ...item, kind: 'open', h: head, depth: open.length });
        open.push(events.at(-1));
      } else if (item.type === 'section') {
        push({ ...item, kind: 'section', h: 28, depth: open.length });
      } else if (item.type === 'end') {
        const started = open.pop();
        push({ ...item, kind: 'close', h: 12, depth: open.length });
        if (started) started.close = events.at(-1);
      } else if (item.type === 'note') {
        const font = FONT.label;
        const wrapped = u.wrapText(item.text, noteLimit, font, measure);
        if (wrapped.length > LIMITS.lines) errors.push(issue(lang, item.line, `注释超过 ${LIMITS.lines} 行`, `Note exceeds ${LIMITS.lines} lines`, '缩短注释，或拆成多条 Note', 'Shorten the note or split it into several Note lines'));
        const lines = wrapped.slice(0, LIMITS.lines);
        push({ ...item, kind: 'note', lines, h: snap(lines.length * 16 + 16), textW: u.maxWidthOf(lines, font, measure) });
      } else if (item.type === 'participant') {
        push({ ...item, kind: 'participant', h: 0 });
      } else if (item.type === 'activate' || item.type === 'deactivate') {
        push({ ...item, kind: item.type, h: 8 });
      } else if (item.type === 'message') {
        const font = FONT.label;
        const span = Math.abs(actorAt(item.from).index - actorAt(item.to).index);
        // 相邻消息按列预算折行；跨列消息随跨越的列数放宽，宽图再回到 200px。
        const limit = item.from === item.to ? Math.min(168, labelLimit) : Math.max(labelLimit, Math.min(200, span * 132));
        const wrapped = u.wrapText(item.text, limit, font, measure);
        if (item.text && wrapped.length > LIMITS.lines) errors.push(issue(lang, item.line, `消息「${item.text}」超过 ${LIMITS.lines} 行`, `Message "${item.text}" exceeds ${LIMITS.lines} lines`, '缩短消息，说明移到图外', 'Shorten the message and move details outside'));
        const lines = item.text ? wrapped.slice(0, LIMITS.lines) : [];
        push({ ...item, kind: 'message', lines, h: snap((lines.length ? lines.length * 16 + 8 : 0) + 20), textW: u.maxWidthOf(lines, font, measure) });
      }
    }
    if (errors.length) return { width, height: 0, errors };

    const count = actors.length;
    const indexOf = new Map(events.map((event, index) => [event, index]));
    const contained = new Map();
    for (const event of events) {
      if (event.kind !== 'open' || !event.close) continue;
      const inside = [];
      for (let i = indexOf.get(event) + 1; i < indexOf.get(event.close); i += 1) inside.push(events[i]);
      contained.set(event, inside);
    }
    const rangeOf = (ids) => {
      const indexes = ids.map((id) => actorAt(id).index);
      return [Math.min(...indexes), Math.max(...indexes)];
    };
    for (const event of events) {
      if (event.kind !== 'open') continue;
      const seen = event.type === 'box' ? [...(event.members || [])] : [];
      if (event.type !== 'box') for (const inner of contained.get(event) || []) if (inner.kind === 'message' || inner.kind === 'note') seen.push(...(inner.kind === 'note' ? inner.ids : [inner.from, inner.to]));
      const ids = [...new Set(seen)];
      if (!ids.length) {
        errors.push(issue(lang, event.line, event.type === 'box' ? '分组里没有参与者' : '片段里没有消息或注释', event.type === 'box' ? 'Box contains no participants' : 'Fragment contains no message or note', '把消息或注释写进开始和 end 之间', 'Put a message or note between the opening line and end'));
        continue;
      }
      [event.lo, event.hi] = rangeOf(ids);
    }
    if (errors.length) return { width, height: 0, errors };

    // 相邻生命线的最小距离由头部宽度、消息标签、自调用说明和注释决定；余宽再在列间均匀分配，每段有上限。
    const headHalf = actors.map((actor) => Math.max(actor.head.w, actor.foot.w) / 2);
    const base = new Array(count + 1).fill(0);
    const floor = new Array(count + 1).fill(0);
    const bump = (index, value) => { if (index >= 0 && index <= count) base[index] = Math.max(base[index], value); };
    const shared = (lo, hi, value) => { const parts = hi - lo; for (let i = lo + 1; i <= hi; i += 1) bump(i, value / parts); };
    actors.forEach((actor, i) => {
      bump(i, headHalf[i] + 12);
      bump(i + 1, headHalf[i] + 12);
      floor[i] = Math.max(floor[i], headHalf[i] + 12);
      floor[i + 1] = Math.max(floor[i + 1], headHalf[i] + 12);
      if (i > 0) { bump(i, headHalf[i - 1] + headHalf[i] + 16); floor[i] = Math.max(floor[i], headHalf[i - 1] + headHalf[i] + 16); }
    });
    for (let i = 1; i < count; i += 1) floor[i] = Math.max(floor[i], 24);
    for (const event of events) {
      if (event.kind === 'note') {
        if (event.place !== 'over') bump(event.place === 'left' ? actorAt(event.ids[0]).index : actorAt(event.ids.at(-1)).index + 1, event.textW + 28);
        else {
          const [lo, hi] = rangeOf(event.ids);
          if (lo === hi) bump(hi + 1, event.textW + 44);
          else shared(lo, hi, event.textW + 28);
        }
      } else if (event.kind === 'message' && event.lines.length) {
        const a = actorAt(event.from).index, b = actorAt(event.to).index;
        // 自调用向右折出 40px 后写说明；跨列消息按标签居中，所需宽度平均计入跨过的列间距。
        if (a === b) bump(a + 1, event.textW + 60);
        else shared(Math.min(a, b), Math.max(a, b), event.textW + 36);
      }
    }
    const gaps = base.map((value, i) => Math.max(value, floor[i]));
    const xsOf = () => {
      const xs = [];
      let cursor = gaps[0];
      for (let i = 0; i < count; i += 1) { xs.push(cursor); cursor += gaps[i + 1]; }
      return xs;
    };
    const noteBox = (event, xs) => {
      const a = xs[actorAt(event.ids[0]).index], b = xs[actorAt(event.ids.at(-1)).index];
      const w = snap(event.textW + 16);
      const over = event.place === 'over';
      const x = event.place === 'left' ? a - w - 16 : (event.place === 'right' ? b + 16 : (a + b) / 2 - w / 2);
      return { x: over && a === b ? a + 16 : x, w, h: event.h - 8 };
    };
    const sectionsOf = new Map();
    for (const event of events) {
      if (event.kind !== 'section') continue;
      const list = sectionsOf.get(event.owner) || [];
      list.push(`${event.keyword} ${event.text}`);
      sectionsOf.set(event.owner, list);
    }
    // 片段框、rect、box 的左右范围覆盖框内标题、消息标签、自调用说明、注释和内层框；内层先算，外层再包住内层。
    const geometryOf = (xs) => {
      const notes = new Map();
      for (const event of events) if (event.kind === 'note') notes.set(event, noteBox(event, xs));
      const frames = new Map();
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i];
        if (event.kind !== 'open' || event.lo == null) continue;
        const pad = 18 + event.depth * 12;
        let left = xs[event.lo] - pad;
        let right = xs[event.hi] + pad;
        for (const inner of contained.get(event) || []) {
          if (inner.kind === 'message' && inner.lines.length) {
            const a = xs[actorAt(inner.from).index], b = xs[actorAt(inner.to).index];
            if (a === b) right = Math.max(right, a + 52 + inner.textW + 8);
            else {
              const mid = (a + b) / 2;
              left = Math.min(left, mid - inner.textW / 2 - 4);
              right = Math.max(right, mid + inner.textW / 2 + 4);
            }
          } else if (inner.kind === 'note' && notes.has(inner)) {
            const note = notes.get(inner);
            left = Math.min(left, note.x);
            right = Math.max(right, note.x + note.w);
          } else if (inner.kind === 'open' && frames.has(inner)) {
            left = Math.min(left, frames.get(inner).left);
            right = Math.max(right, frames.get(inner).right);
          }
        }
        // 标题与分支标题写在框内左上角，框宽必须容下最宽的一条。
        const labels = [event.type === 'box' ? event.text : `${event.keyword}${event.text ? ` [${event.text}]` : ''}`, ...(sectionsOf.get(event.line) || [])].filter(Boolean);
        right = Math.max(right, left + 8 + Math.max(0, ...labels.map((label) => measure(label, FONT.label))) + 12);
        frames.set(event, { left, right });
      }
      let left = xs[0] - headHalf[0], right = xs[count - 1] + headHalf[count - 1];
      for (const frame of frames.values()) { left = Math.min(left, frame.left); right = Math.max(right, frame.right); }
      for (const [event, note] of notes) { left = Math.min(left, note.x); right = Math.max(right, note.x + note.w); }
      for (const event of events) {
        if (event.kind !== 'message' || !event.lines.length) continue;
        const a = xs[actorAt(event.from).index], b = xs[actorAt(event.to).index];
        if (a === b) right = Math.max(right, a + 52 + event.textW + 8);
        else {
          const mid = (a + b) / 2;
          left = Math.min(left, mid - event.textW / 2 - 4);
          right = Math.max(right, mid + event.textW / 2 + 4);
        }
      }
      return { notes, frames, left, right };
    };
    let xs = xsOf();
    let geometry = geometryOf(xs);
    // 在可用宽度内补足余宽：每段列间距最多再增 128px，避免参与者很少时拉出过大的空当。
    for (let pass = 0; pass < 4; pass += 1) {
      const slack = Math.floor(width) - 16 - (geometry.right - geometry.left);
      if (slack < 1) break;
      const add = Math.min(slack / (count + 1), 128);
      if (add < 1) break;
      for (let i = 0; i <= count; i += 1) gaps[i] += add;
      xs = xsOf();
      geometry = geometryOf(xs);
    }
    // 整体左移，让最左侧内容从 8px 开始；右边界由实际内容决定。
    const shift = 8 - geometry.left;
    xs = xs.map((value) => value + shift);
    geometry = geometryOf(xs);
    actors.forEach((actor, i) => { actor.x = xs[i]; });
    for (const [event, note] of geometry.notes) event.note = note;
    for (const [event, frame] of geometry.frames) { event.left = frame.left; event.right = frame.right; }
    let contentRight = geometry.right;

    const hasBox = events.some((event) => event.type === 'box');
    const headBand = snap(8 + Math.max(36, ...actors.map((actor) => actor.head.h)) + 12);
    const top = headBand + (hasBox ? 28 : 8);
    let cursor = top;
    for (const event of events) {
      event.y = cursor;
      cursor += event.h;
    }
    const foot = snap(Math.max(...actors.map((actor) => actor.foot.h)) + 12);
    const bottom = cursor + 8;
    const height = bottom + foot + 8;
    for (const event of events) {
      if (event.kind !== 'open' || !event.close) continue;
      const boxY = event.type === 'box' ? headBand + 20 : event.y;
      const boxH = (event.type === 'box' ? bottom + 4 : event.close.y + event.close.h) - boxY;
      event.box = { x: event.left, y: boxY, w: event.right - event.left, h: boxH };
    }
    for (const event of events) if (event.note) event.note.y = event.y + 4;
    const activations = [];
    const active = new Map(actors.map((actor) => [actor.id, []]));
    const messageY = (event) => event.y + (event.lines.length ? event.lines.length * 16 + 10 : 10);
    for (const event of events) {
      const start = (id, at) => {
        const stack = active.get(id);
        const bar = { id, x: actorAt(id).x - 5 - stack.length * 7, y: at, h: 0 };
        stack.push(bar);
        activations.push(bar);
      };
      const stop = (id, at) => {
        const bar = active.get(id).pop();
        if (bar) bar.h = Math.max(16, at - bar.y);
      };
      if (event.type === 'activate') start(event.id, event.y + 4);
      if (event.type === 'deactivate') stop(event.id, event.y + 4);
      if (event.kind === 'message' && event.activateOn) start(event.activateOn, messageY(event));
      if (event.kind === 'message' && event.deactivateOn) stop(event.deactivateOn, messageY(event) + 8);
    }
    // 片段标题与分支标题要让开同一行的激活条：条画在框上，标题压到条上会看不清。
    const labelXOf = (box, y, width) => {
      let x = box.x + 8;
      for (let pass = 0; pass < 3; pass += 1) {
        let moved = false;
        for (const bar of activations) {
          if (bar.y > y + 18 || bar.y + bar.h < y) continue;
          const right = bar.x + 10 + 6;
          if (bar.x < x + width && right > x) { x = right; moved = true; }
        }
        if (!moved) break;
      }
      return x;
    };
    for (const event of events) {
      if (event.kind === 'open' && event.box && event.type !== 'box') {
        const text = event.type === 'rect' ? event.text : `${event.keyword}${event.text ? ` [${event.text}]` : ''}`;
        if (!text) continue;
        event.labelX = labelXOf(event.box, event.box.y, measure(text, FONT.label));
        event.box.w = Math.max(event.box.w, event.labelX + measure(text, FONT.label) + 12 - event.box.x);
        contentRight = Math.max(contentRight, event.box.x + event.box.w);
      }
      if (event.kind === 'section') {
        const host = events.find((item) => item.kind === 'open' && item.line === event.owner);
        if (!host?.box) continue;
        const text = `${event.keyword} ${event.text}`;
        event.labelX = labelXOf(host.box, event.y, measure(text, FONT.label));
      }
    }
    for (const actor of actors) {
      actor.life = { x: actor.x, y1: top - 4, y2: bottom };
      actor.head.x = actor.x - actor.head.w / 2;
      actor.head.y = 8;
      actor.foot.x = actor.x - actor.foot.w / 2;
      actor.foot.y = bottom + 8;
    }
    // 画布宽度取内容右边界与版心宽度的较小值；内容放不下时返回固有宽度，由宿主滚动。
    const naturalWidth = snap(contentRight + 8);
    const canvas = naturalWidth <= width ? Math.floor(width) : naturalWidth;
    return {
      type: 'sequence', width: canvas, height: snap(height), actors, events, activations, errors,
    };
  }
  function scene(layout, ctx) {
    const theme = u.appearance(ctx), children = [];
    const addText = (parent, { x, y, lines, font = FONT.label, anchor = 'middle', lineHeight = 16, fill = theme.fg2 }) => {
      const rows = lines || [];
      const nodes = rows.map((line, index) => ctx.text(x, y + (index - (rows.length - 1) / 2) * lineHeight, line, {
        anchor, size: font.size, weight: font.weight, fill, 'dominant-baseline': 'central',
      }));
      parent.push(ctx.el('g', {}, nodes));
    };
    const line = (x1, y1, x2, y2, attrs = {}) => ctx.line(x1, y1, x2, y2, attrs);
    const marker = (id, open) => ctx.el('marker', {
      id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 9, markerHeight: 9,
      orient: 'auto', markerUnits: 'userSpaceOnUse',
    }, [ctx.path(open ? 'M1 1 L8 5 L1 9' : 'M1 1 L8 5 L1 9 Z', {
      fill: open ? 'none' : theme.fg3, stroke: open ? theme.fg3 : 'none', 'stroke-width': open ? 1.5 : 0,
    })]);
    children.push(ctx.el('defs', {}, [marker('seq-arrow', false), marker('seq-arrow-open', true)]));

    const sectionTone = ctx.frameTone(theme.accent), boxTone = ctx.frameTone(theme.tones[1]);
    const paintFrame = event => {
      if (!event.box) return;
      const { x, y, w, h } = event.box;
      const frame = [];
      const boxFrame = event.type === 'box';
      const fill = event.type === 'rect' ? ctx.tint(theme.bg, sectionTone, theme.soft)
        : boxFrame ? ctx.tint(theme.bg, boxTone, .08) : ctx.mix(theme.bg, theme.fg4, .07);
      const stroke = event.type === 'rect' ? sectionTone : boxFrame ? boxTone : theme.line;
      frame.push(ctx.rect(x, y, w, h, {
        fill, stroke, ...(event.type === 'rect' ? { 'stroke-opacity': .45 } : {}), 'stroke-width': 1, rx: theme.smallRadius,
        ...(boxFrame ? { 'stroke-dasharray': '5 4' } : {}),
      }));
      if (boxFrame) addText(children, { x: x + w / 2, y: y - 10, lines: [event.text] });
      else if (event.type !== 'rect' || event.text) {
        const label = event.type === 'rect' ? event.text : event.keyword + (event.text ? ' [' + event.text + ']' : '');
        addText(frame, { x: event.labelX ?? x + 8, y: y + 12, lines: [label], anchor: 'start' });
      }
      children.push(ctx.el('g', {}, frame));
    };
    for (const event of layout.events) if (event.kind === 'open') paintFrame(event);
    for (const actor of layout.actors) children.push(line(actor.life.x, actor.life.y1, actor.life.x, actor.life.y2, { stroke: theme.line2, 'stroke-width': 1 }));
    for (const bar of layout.activations) children.push(ctx.rect(bar.x, bar.y, 10, bar.h, {
      fill: ctx.tint(theme.bg, sectionTone, .28), stroke: sectionTone, 'stroke-opacity': .45, 'stroke-width': 1,
    }));

    const actorAt = id => layout.actors.find(item => item.id === id);
    for (const event of layout.events) {
      if (event.kind === 'section') {
        const host = layout.events.find(item => item.kind === 'open' && item.line === event.owner);
        if (!host?.box) continue;
        children.push(line(host.box.x, event.y + 4, host.box.x + host.box.w, event.y + 4, { stroke: theme.line, 'stroke-dasharray': '3 3' }));
        addText(children, { x: event.labelX ?? host.box.x + 8, y: event.y + 14, lines: [event.keyword + ' ' + event.text], anchor: 'start' });
      }
      if (event.kind === 'note') {
        const { x, y, w, h } = event.note, note = [];
        note.push(ctx.rect(x, y, w, h, { fill: theme.surface, stroke: theme.line2, 'stroke-width': 1, rx: theme.smallRadius }));
        addText(note, { x: x + 8, y: y + h / 2, lines: event.lines, anchor: 'start', lineHeight: 16 });
        children.push(ctx.el('g', {}, note));
      }
      if (event.kind !== 'message') continue;
      const from = actorAt(event.from), to = actorAt(event.to);
      const y = event.y + (event.lines.length ? event.lines.length * 16 + 10 : 10);
      const arrow = event.style === 'async' ? 'url(#seq-arrow-open)' : 'url(#seq-arrow)';
      const dashed = event.style === 'return' || event.style === 'async' ? { 'stroke-dasharray': '5 4' } : {};
      const lineAttrs = { stroke: theme.fg3, 'stroke-width': 1.5, 'stroke-linecap': 'butt', ...dashed };
      if (from === to) {
        const d = 'M' + (from.x + 6) + ' ' + (y - 14) + ' h40 v18 H' + (from.x + 12);
        children.push(ctx.path(d, { fill: 'none', ...lineAttrs, 'marker-end': arrow }));
        if (event.lines.length) addText(children, {
          x: from.x + 52, y: y - 20 - (event.lines.length - 1) * 8,
          lines: event.lines, anchor: 'start', lineHeight: 16,
        });
      } else {
        const dir = to.x > from.x ? 1 : -1;
        const startX = from.x + dir * 8, endX = to.x - dir * 12;
        children.push(line(startX, y, endX, y, { ...lineAttrs, 'marker-end': arrow }));
        const d = 'M' + (endX - dir * 8) + ' ' + (y - 4) + ' L' + endX + ' ' + y + ' L' + (endX - dir * 8) + ' ' + (y + 4) + (event.style === 'async' ? '' : ' Z');
        children.push(ctx.path(d, {
          fill: event.style === 'async' ? 'none' : theme.fg3,
          stroke: theme.fg3, 'stroke-width': 1.5,
        }));
        if (event.lines.length) addText(children, {
          x: (from.x + to.x) / 2, y: event.y + event.lines.length * 8,
          lines: event.lines, anchor: 'middle', lineHeight: 16,
        });
      }
    }
    for (const actor of layout.actors) for (const part of [actor.head, actor.foot]) {
      const group = [];
      group.push(ctx.rect(part.x, part.y, part.w, part.h, { fill: theme.surface, stroke: theme.line, 'stroke-width': 1, rx: theme.smallRadius }));
      addText(group, { x: actor.x, y: part.y + part.h / 2, lines: part.lines, font: FONT.title, lineHeight: 18, fill: theme.fg1 });
      children.push(ctx.el('g', {}, group));
    }
    return { width: layout.width, height: layout.height, children };
  }
  return { implementations: { sequenceDiagram: { parse, layout, scene } }, LIMITS };
});
