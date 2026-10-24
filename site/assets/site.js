(() => {
  'use strict';
  const root=document.documentElement;
  const prefersDark=window.matchMedia('(prefers-color-scheme: dark)');
  const themeButtons=[...document.querySelectorAll('.theme-control')];
  const currentTheme=() => root.dataset.theme==='dark'||root.dataset.theme==='light'
    ?root.dataset.theme:(prefersDark.matches?'dark':'light');
  const updateTheme=() => {
    const next=currentTheme()==='dark'?'light':'dark';
    for(const b of themeButtons){
      b.setAttribute('aria-label','Switch to '+next+' mode');
      b.setAttribute('title','Switch to '+next+' mode');
      const label=b.querySelector('.theme-label');
      const indicator=b.querySelector('.theme-indicator');
      if(label)label.textContent='SWITCH TO '+next.toUpperCase();
      if(indicator)indicator.textContent=next==='dark'?'☾':'☼';
    }
  };
  updateTheme();
  themeButtons.forEach(button=>button.addEventListener('click',()=>{
    const next=currentTheme()==='dark'?'light':'dark';
    root.dataset.theme=next;
    try{localStorage.setItem('asbcs-theme',next)}catch{}
    updateTheme();
  }));
  const mqChange=()=>{if(!root.dataset.theme)updateTheme()};
  if(prefersDark.addEventListener)prefersDark.addEventListener('change',mqChange);
  else if(prefersDark.addListener)prefersDark.addListener(mqChange);

  const rail=document.querySelector('#site-rail');
  const menuButton=document.querySelector('.mobile-menu');
  const compact=window.matchMedia('(max-width:1080px)');
  const setRail=open=>{
    if(!rail||!menuButton)return;
    const shouldOpen=Boolean(open)&&compact.matches;
    rail.classList.toggle('is-open',shouldOpen);
    rail.inert=compact.matches&&!shouldOpen;
    menuButton.setAttribute('aria-expanded',String(shouldOpen));
    menuButton.setAttribute('aria-label',shouldOpen?'Close site menu':'Open site menu');
    document.body.classList.toggle('nav-open',shouldOpen);
  };
  if(rail&&menuButton){
    setRail(false);
    menuButton.addEventListener('click',()=>setRail(menuButton.getAttribute('aria-expanded')!=='true'));
    rail.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>setRail(false)));
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&menuButton.getAttribute('aria-expanded')==='true'){
        setRail(false);menuButton.focus();
      }
    });
    document.addEventListener('click',e=>{
      if(menuButton.getAttribute('aria-expanded')==='true'&&!rail.contains(e.target)&&!menuButton.contains(e.target))setRail(false);
    });
    if(compact.addEventListener)compact.addEventListener('change',()=>setRail(false));
    else if(compact.addListener)compact.addListener(()=>setRail(false));
  }
  const page=document.body.dataset.page;
  const active=document.querySelector('.rail-nav [data-route="'+page+'"]');
  if(active){active.classList.add('active');active.setAttribute('aria-current','page')}

  const searches=[...document.querySelectorAll('[data-community-search]')];
  searches.forEach(input=>{
    const listId=input.dataset.communitySearch;
    const list=document.getElementById(listId);
    if(!list)return;
    const rows=[...list.querySelectorAll('li[data-name]')];
    const count=document.getElementById(listId==='home-list'?'home-count':listId+'-count');
    const empty=document.querySelector('[data-no-results="'+listId+'"]');
    const filter=()=>{
      const text=input.value.trim().toLocaleLowerCase();
      let visible=0;
      for(const row of rows){
        const match=(row.dataset.name||'').includes(text);
        row.hidden=!match;
        if(match)visible++;
      }
      if(count)count.textContent=visible+' RESULT'+(visible===1?'':'S');
      if(empty)empty.hidden=visible!==0;
    };
    input.addEventListener('input',filter);
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='/'&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
      const el=document.activeElement;
      if(el&&(/INPUT|TEXTAREA|SELECT/.test(el.tagName)||el.isContentEditable))return;
      const first=searches[0];
      if(first){e.preventDefault();first.focus()}
    }
  });
})();