(() => {
  "use strict";
  const toggle=document.querySelector(".nav-toggle");
  const nav=document.getElementById("site-nav");
  if(toggle && nav){
    const close=()=>{nav.classList.remove("is-open");toggle.setAttribute("aria-expanded","false");toggle.setAttribute("aria-label","Open menu");};
    toggle.addEventListener("click",()=>{const open=toggle.getAttribute("aria-expanded")!=="true";nav.classList.toggle("is-open",open);toggle.setAttribute("aria-expanded",String(open));toggle.setAttribute("aria-label",open?"Close menu":"Open menu");});
    nav.querySelectorAll("a").forEach(a=>a.addEventListener("click",close));
    document.addEventListener("keydown",e=>{if(e.key==="Escape")close();});
    document.addEventListener("click",e=>{if(!nav.contains(e.target)&&!toggle.contains(e.target))close();});
    const mq=window.matchMedia("(min-width:961px)");
    if(mq.addEventListener)mq.addEventListener("change",e=>{if(e.matches)close();});
  }
  const filter=document.getElementById("community-filter");
  const directory=document.getElementById("community-directory");
  if(filter && directory){
    const rows=[...directory.querySelectorAll("li")],count=document.getElementById("match-count"),empty=document.getElementById("directory-empty");
    const render=()=>{const q=filter.value.trim().toLocaleLowerCase();let hits=0;rows.forEach(row=>{const match=row.dataset.name.includes(q);row.hidden=!match;if(match)hits++;});count.textContent=hits+" / "+rows.length;empty.hidden=hits!==0;};
    filter.addEventListener("input",render);render();
  }
  document.querySelectorAll(".year").forEach(el=>el.textContent=String(new Date().getFullYear()));
})();