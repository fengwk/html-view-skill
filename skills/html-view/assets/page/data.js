(()=>{
  'use strict';
  const initialized=new WeakSet();
  function relayout(){
    const viz=globalThis.HtmlViewViz;
    if(viz?.relayout)return viz.relayout();
    return viz?.ready?.();
  }
  function expandViews(root){
    const sections=[...root.querySelectorAll('[data-view-section]')];
    if(!sections.length)return false;
    for(const section of sections)section.hidden=false;
    void relayout();
    return true;
  }
  function start(root=document){
    const doc=root.documentElement?root:root.ownerDocument||globalThis.document;
    const mode=()=>doc?.documentElement?.dataset?.mode||'';
    if(!initialized.has(root)){
      initialized.add(root);
      const tabs=[...root.querySelectorAll('[data-view-tab]')];
      const choose=(tab,focus=false)=>{
        for(const item of tabs){const selected=item===tab;item.setAttribute('aria-selected',String(selected));item.tabIndex=selected?0:-1;}
        for(const section of root.querySelectorAll('[data-view-section]'))section.hidden=section.dataset.viewSection!==tab.dataset.viewTab;
        if(focus)tab.focus();
        void relayout();
      };
      tabs.forEach((tab,index)=>{
        tab.addEventListener('click',()=>choose(tab));
        tab.addEventListener('keydown',event=>{
          const step={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[event.key];
          let next=null;
          if(step)next=tabs[(index+step+tabs.length)%tabs.length];
          else if(event.key==='Home')next=tabs[0];
          else if(event.key==='End')next=tabs[tabs.length-1];
          if(!next)return;
          event.preventDefault();choose(next,true);
        });
      });
      for(const table of root.querySelectorAll('table[data-sortable]')){
        const body=table.tBodies[0];
        if(!body||!table.tHead?.rows?.[0])continue;
        [...table.tHead.rows[0].cells].forEach((cell,column)=>{
          cell.tabIndex=0;cell.setAttribute('aria-sort','none');
          const sort=()=>{
            const ascending=cell.getAttribute('aria-sort')!=='ascending';
            for(const sibling of table.tHead.rows[0].cells)sibling.setAttribute('aria-sort','none');
            cell.setAttribute('aria-sort',ascending?'ascending':'descending');
            const rows=[...body.rows];
            rows.sort((left,right)=>{
              const a=left.cells[column],b=right.cells[column];
              const aNull=a?.getAttribute('data-sort-null')==='true',bNull=b?.getAttribute('data-sort-null')==='true';
              if(aNull!==bNull)return aNull?1:-1;
              const av=a?.getAttribute('data-sort'),bv=b?.getAttribute('data-sort');
              const compared=av!=null&&bv!=null&&av!==''&&bv!==''?Number(av)-Number(bv):(a?.textContent||'').trim().localeCompare((b?.textContent||'').trim(),undefined,{numeric:true});
              return(ascending?1:-1)*compared;
            });
            for(const row of rows)body.append(row);
          };
          cell.addEventListener('click',sort);
          cell.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();sort();}});
        });
      }
      if(typeof MutationObserver==='function'&&doc?.documentElement){
        const observer=new MutationObserver(()=>{if(mode()==='export')expandViews(root);});
        observer.observe(doc.documentElement,{attributes:true,attributeFilter:['data-mode']});
      }
    }
    const render=()=>{if(mode()==='export')expandViews(root);else void relayout();};
    const ready=doc?.fonts?.ready;
    if(ready&&typeof ready.then==='function')ready.then(render,render);else render();
  }
  globalThis.HtmlDataReport={start};
  if(typeof document!=='undefined')start(document);
})();
