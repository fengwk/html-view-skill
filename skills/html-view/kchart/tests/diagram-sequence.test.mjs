import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSlice } from './diagram-slice.mjs';

const modules = loadSlice({ 'diagram/sequence': ['diagram/support'] });
const sequenceModule = modules['diagram/sequence'];
const sequence = sequenceModule.implementations;
const plain = value => JSON.parse(JSON.stringify(value));
const measure = value => [...String(value)].length * 7;
const ctx = {
  design: { id:'paper', bg:'#fff', surface:'#f5f5f5', fg1:'#111', fg2:'#333', fg3:'#444', fg4:'#666', accent:'#a46', tones:['#111','#468','#789','#abc','#def','#fed'], line:'#ddd', line2:'#aaa' },
  mix: (_a,_b) => '#ececec',
  tint: (_a,_b) => '#ececec',
  el: (tag,attrs={},children=[]) => ({ tag, attrs, ...(children.length ? { children } : {}) }),
  text: (x,y,value,opts={}) => ({ tag:'text', attrs:{ x,y,...opts }, text:String(value) }),
  line: (x1,y1,x2,y2,attrs={}) => ({ tag:'line', attrs:{ x1,y1,x2,y2,...attrs } }),
  rect: (x,y,width,height,attrs={}) => ({ tag:'rect', attrs:{ x,y,width,height,...attrs } }),
  path: (d,attrs={}) => ({ tag:'path', attrs:{ d,...attrs } }),
};

// 意图：覆盖三类箭头、参与者声明、自调用、分支、注释与激活配对的语义模型。
test('sequence parser preserves participants, message styles, loopback, fragments and notes', () => {
  const result = sequence.sequenceDiagram.parse(`participant A as Caller\nactor B as Worker\nA->>B: request\nB-->>A: reply\nA-)B: notify\nA->>A: retry\nalt success\nNote over A, B: accepted<br/>quickly\nelse failure\nA->>+B: retry\nB-->>-A: done\nend`, { lang:'en', firstLine:2, options:{} });
  assert.deepEqual(plain(result.errors), []);
  const model = plain(result.model);
  assert.deepEqual(model.participants.map(x => [x.id,x.name,x.kind]), [['A','Caller','participant'],['B','Worker','actor']]);
  assert.deepEqual(model.statements.filter(x => x.type === 'message').map(x => [x.style,x.from,x.to,x.activate,x.deactivate]), [['sync','A','B',false,false],['return','B','A',false,false],['async','A','B',false,false],['sync','A','A',false,false],['sync','A','B',true,false],['return','B','A',false,true]]);
  assert.equal(model.statements.find(x=>x.type==='note').text, 'accepted<br/>quickly');
  assert.equal(model.statements.find(x=>x.type==='section').keyword,'else');
});

// 意图：语法非法、限制越界及未配对声明均须给出诊断而不是生成成功模型。
test('sequence parser diagnoses unsupported options, unsafe rect color, unmatched blocks and tabs', () => {
  const result = sequence.sequenceDiagram.parse('rect #fff\nA->>B: ok\nend extra\n\tparticipant C\nend', { lang:'zh', firstLine:2, options:{ mirrorActors:true } });
  assert.ok(result.errors.some(e => e.line === 1 && e.message.includes('不支持选项')));
  assert.ok(result.errors.some(e => e.line === 2 && e.message.includes('不接受颜色')));
  assert.ok(result.errors.some(e => e.line === 5 && e.message.includes('Tab')));
  assert.ok(result.errors.some(e => e.line === 6 && e.message.includes('end')));
  assert.ok(result.errors.every(e => Number.isInteger(e.line) && e.message && e.fix));
});

// 意图：布局应保留生命线/消息/折返和主题样式，Scene 中不得依赖旧 DOM/CSS。
test('sequence layout and scene produce lifelines, dashed returns, loopbacks, actors and notes', () => {
  const parsed = sequence.sequenceDiagram.parse('participant A as Client\nparticipant B as Service\nA->>B: call\nB-->>A: result\nA->>A: retry\nNote right of B: cache\nalt cached\nA-)B: async\nelse missed\nA->>B: fetch\nend', { lang:'en', firstLine:2, options:{} });
  const geometry = sequence.sequenceDiagram.layout(parsed.model, { width:620, lang:'en', measure });
  assert.deepEqual(plain(geometry.errors), []);
  assert.equal(geometry.actors.length,2);
  assert.equal(geometry.actors[0].life.y2 > geometry.actors[0].life.y1,true);
  const scene = sequence.sequenceDiagram.scene(geometry,ctx);
  const nodes=[]; const visit=n=>{ nodes.push(n); for(const child of n.children||[]) visit(child); }; scene.children.forEach(visit);
  assert.ok(nodes.some(n=>n.tag==='line' && n.attrs['stroke-dasharray']==='5 4'));
  assert.ok(nodes.some(n=>n.tag==='path' && /h40/.test(n.attrs.d || '')));
  assert.ok(nodes.some(n=>n.tag==='rect' && n.attrs.fill===ctx.design.surface));
  assert.ok(nodes.some(n=>n.tag==='line' && n.attrs['stroke-dasharray']==='3 3'));
  assert.ok(nodes.some(n=>n.tag==='text' && n.attrs.fill===ctx.design.fg2),'次级标签需使用旧 dg-label 的 fg2');
  assert.ok(nodes.filter(n=>n.tag==='text'&&n.attrs['font-size']===14).every(n=>n.attrs.fill===ctx.design.fg1),'参与者标题需保留旧 dg-title 的 fg1');
  assert.equal(scene.width,geometry.width);
});

// 意图：恢复 box 与 rect 两种分组/强调框在序列布局和 Scene 中的可见性。
test('sequence layout renders participant boxes and rect regions', () => {
  const parsed = sequence.sequenceDiagram.parse('box Backend\nparticipant A\nparticipant B\nend\nrect work\nA->>B: run\nend', { firstLine:2, options:{} });
  assert.deepEqual(plain(parsed.errors), []);
  const geometry = sequence.sequenceDiagram.layout(parsed.model, { width:500, lang:'zh', measure });
  const result = sequence.sequenceDiagram.scene(geometry,ctx);
  const rects=[]; const visit=n=>{ if(n.tag==='rect') rects.push(n); for(const child of n.children||[]) visit(child); }; result.children.forEach(visit);
  assert.ok(rects.some(x => x.attrs['stroke-dasharray'] === '5 4'));
  assert.ok(rects.some(x => x.attrs.stroke === ctx.design.tones[1]));
  assert.ok(rects.some(x => x.attrs.stroke === ctx.design.accent));
});

// 意图：复用旧回归的多版心复杂流程图，锁定最小槽宽、自调用说明、分支压盖和分组范围几何。
test('sequence migrated geometry keeps tight slots, labels and nested regions across widths', () => {
  const source = `participant Client as 客户端
participant API as 评论服务
box Queue
participant Hot as 热点队列
participant Normal as 常规队列
end
Client->>+API: 发布请求
API->>API: 校验参数
critical 热点隔离
API->>Hot: 热点流量
option 常规
API->>Normal: 常规流量
end
alt 已判定
Hot-->>API: 回执
else 继续探测
API->>Hot: 再次探测
end
Note over Client,API: 客户端先插入占位
rect 重点区段
API-->>-Client: 返回结果
end`;
  for (const width of [1040,800,688]) {
    const parsed=sequence.sequenceDiagram.parse(source,{lang:'zh-CN',firstLine:2,options:{}});
    const snapshot=plain(parsed.model);
    const geometry=sequence.sequenceDiagram.layout(parsed.model,{width,lang:'zh-CN',measure});
    assert.deepEqual(plain(parsed.model),snapshot,'layout 不能改写模型');
    assert.deepEqual(plain(geometry.errors),[]);
    assert.ok(geometry.width >= width && geometry.height > 0);
    const rows=geometry.events.filter(e=>e.kind==='message'||e.kind==='note');
    assert.ok(rows.every((e,i)=>!i||e.y>=rows[i-1].y+rows[i-1].h-.1));
    const self=geometry.events.find(e=>e.text==='校验参数');
    assert.ok(self.textW+geometry.actors.find(a=>a.id===self.from).x+52<=geometry.width);
    const alt=geometry.events.find(e=>e.keyword==='alt'&&e.kind==='open');
    const branch=geometry.events.find(e=>e.keyword==='else');
    const next=geometry.events.find(e=>e.text==='再次探测');
    assert.ok(branch.y+16<=next.y,'分支标题槽不能压到下一条消息');
    assert.ok(alt.box.y<branch.y&&branch.y<alt.box.y+alt.box.h);
    for(const frame of geometry.events.filter(e=>e.box)) assert.ok(frame.box.x>=0&&frame.box.y>=0&&frame.box.x+frame.box.w<=geometry.width&&frame.box.y+frame.box.h<=geometry.height);
    const boxFrame=geometry.events.find(e=>e.type==='box').box;
    for(const actor of geometry.actors) for(const part of [actor.head,actor.foot]) {
      const overlaps=part.x<boxFrame.x+boxFrame.w-.5&&boxFrame.x<part.x+part.w-.5&&part.y<boxFrame.y+boxFrame.h-.5&&boxFrame.y<part.y+part.h-.5;
      assert.equal(overlaps,false,actor.id+' group frame must not cover actor labels');
    }
    const apiBar=geometry.activations.find(bar=>bar.id==='API');
    assert.ok(apiBar && apiBar.h>=16);
    assert.ok(apiBar.y+apiBar.h>=geometry.events.find(e=>e.text==='返回结果').y);
  }
});

// 意图：以正式 Context/SVG 序列化器检查 marker 引用重写和合法图元结构，而非仅检查测试替身对象。
test('sequence scene serializes marker refs and expected SVG primitives', () => {
  const parsed=sequence.sequenceDiagram.parse('participant A\nparticipant B\nA->>B: sync\nB-->>A: return\nA-)B: async\nA->>A: self',{lang:'en',firstLine:2,options:{}});
  const context=modules['core/context'].createContext({width:640,theme:'paper',lang:'en'});
  const geometry=sequence.sequenceDiagram.layout(parsed.model,{width:640,lang:'en',measure:modules['diagram/support'].measureOf(context)});
  const scene=sequence.sequenceDiagram.scene(geometry,context);
  const svg=modules['core/svg'].renderScene(scene,{prefix:'sequence-test',theme:'paper'});
  assert.match(svg,/<marker id="sequence-test-seq-arrow"/);
  assert.match(svg,/marker-end="url\(#sequence-test-seq-arrow\)"/);
  assert.match(svg,/marker-end="url\(#sequence-test-seq-arrow-open\)"/);
  assert.match(svg,/<line /);
  assert.match(svg,/<path /);
  assert.match(svg,/<rect /);
  assert.match(svg,/fill="#35373b"/,'次级标签颜色对应 paper 的 fg2');
  assert.match(svg,/fill="#18191d"/,'参与者标题颜色对应 paper 的 fg1');
});

// 意图：固定公开参与者与嵌套限制
test('sequence parser enforces participant and fragment depth limits', () => {
  const tooMany = Array.from({length:9},(_,i)=>`participant P${i}`).join('\n');
  assert.ok(sequence.sequenceDiagram.parse(tooMany,{firstLine:2,options:{}}).errors.some(e=>e.message.includes('8')));
  const nested = 'alt one\nopt two\npar three\nA->>B: x\nend\nend\nend';
  assert.ok(sequence.sequenceDiagram.parse(nested,{firstLine:2,options:{}}).errors.some(e=>e.message.includes('嵌套')));
});
