/* IRAI — code every page runs: strings, header menu, language menu and suggestion, footer door.
   Page strings come from <script type="application/json" id="i18n"> written by build.mjs. */
(function(){
"use strict";
const $=(s,r=document)=>r.querySelector(s);
const data=JSON.parse(($('#i18n')||{}).textContent||'{}');
const S=data.strings||{};
const lang=data.lang||document.documentElement.lang||'en';
const plurals=new Intl.PluralRules(lang);
/* plain-text string with {name} placeholders filled from vars */
function t(key,vars){
  const s=S[key];if(s==null){console.warn('i18n: missing '+key);return key;}
  return vars?s.replace(/\{(\w+)\}/g,(m,v)=>v in vars?String(vars[v]):m):s;
}
function plural(key,n,vars){const k=key+'.'+plurals.select(n);return t(k in S?k:key+'.other',vars);}
/* fill an element from a template whose placeholders become nodes, e.g. "{n} agents." with {n:<b>} */
function fill(el,template,nodes){
  el.textContent='';
  for(const part of template.split(/(\{\w+\})/)){
    const m=/^\{(\w+)\}$/.exec(part);
    if(m&&nodes[m[1]]!=null)el.append(nodes[m[1]]);else if(part)el.append(part);
  }
}
function h(tag,attrs,...kids){
  const el=document.createElement(tag);
  if(attrs)for(const k in attrs){const v=attrs[k];if(v==null||v===false)continue;
    if(k==='class')el.className=v;else if(k==='text')el.textContent=v;else if(k.startsWith('on'))el.addEventListener(k.slice(2),v);else el.setAttribute(k,v===true?'':v);}
  for(const kid of kids.flat()){if(kid==null||kid===false)continue;el.append(kid.nodeType?kid:document.createTextNode(String(kid)));}
  return el;
}
const reduce=window.matchMedia('(prefers-reduced-motion: reduce)');
window.IRAI={data,lang,t,plural,fill,h,$,$$:(s,r=document)=>Array.from(r.querySelectorAll(s)),reduce,num:(n,o)=>new Intl.NumberFormat(lang,o).format(n)};

/* ---- header: menu + scrolled state ---- */
const top=$('#top'),menuBtn=$('#menuBtn'),siteNav=$('#siteNav');
function setMenu(open){
  siteNav.classList.toggle('open',open);menuBtn.setAttribute('aria-expanded',String(open));
  menuBtn.textContent=open?t('nav.close'):t('nav.menu');document.body.classList.toggle('menu-open',open);
}
menuBtn.addEventListener('click',()=>setMenu(!siteNav.classList.contains('open')));
function onScroll(){top.classList.toggle('scrolled',window.scrollY>8);}
window.addEventListener('scroll',onScroll,{passive:true});onScroll();

/* ---- language menu: close on outside click and Escape ---- */
const langs=$('.langs');
document.addEventListener('click',e=>{if(langs&&langs.open&&!langs.contains(e.target))langs.open=false;});
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  if(langs&&langs.open){langs.open=false;langs.querySelector('summary').focus();}
  else if(siteNav.classList.contains('open')){setMenu(false);menuBtn.focus();}
});

/* ---- "this page is also in your language": a one-line offer, never a redirect ---- */
const DISMISS='irai.langOffer.dismissed';
function storedDismiss(){try{return localStorage.getItem(DISMISS)==='1';}catch(_){return true;}}
function dismiss(){try{localStorage.setItem(DISMISS,'1');}catch(_){}}
function preferredLocale(){
  for(const tag of navigator.languages||[navigator.language||'']){
    const l=String(tag).toLowerCase();
    if(/^zh-(tw|hk|mo)|^zh-hant/.test(l))continue; /* the Chinese pages are Simplified */
    const code=l.split('-')[0];
    if(code===data.code||(data.suggest&&code in data.suggest))return code;
  }
  return null;
}
(function offerLanguage(){
  if(!data.suggest||storedDismiss())return;
  const code=preferredLocale();if(!code||code===data.code)return;
  const s=data.suggest[code];
  const bar=h('div',{class:'lang-offer',lang:s.lang,role:'region','aria-label':s.text},
    h('span',{text:s.text}),
    h('a',{href:s.href,hreflang:s.lang,text:s.link,onclick:dismiss}),
    h('button',{type:'button',class:'lang-offer-x','aria-label':s.dismiss,text:'×',onclick:()=>{dismiss();bar.remove();}}));
  document.body.append(bar);
})();

/* ---- display headings: shrink one just enough that its longest word fits the column, so a word is never
   split (long German compounds on phones). Words are measured in the heading's own font; CJK runs may break
   between characters, and a break after a hyphen or dash is a real one, so neither counts as a word. ---- */
const FIT='.hero .slogan,.hero .claim,main :is(h1,h2,h3,h4):not(#heroH)';
const CJK=/[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]+/;
const words=text=>text.split(/\s+/).flatMap(w=>w.split(CJK)).flatMap(w=>w.split(/(?<=[-\u2010-\u2014\/\u00AD])/)).filter(Boolean);
const contentWidth=el=>{const cs=getComputedStyle(el);return el.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);};
function fitHeadings(){
  const els=window.IRAI.$$(FIT).filter(el=>el.getClientRects().length);
  for(const el of els){el.style.fontSize='';el.style.removeProperty('--word');}
  for(const el of els){
    const ws=words(el.textContent);if(!ws.length)continue;
    const probe=document.createElement('span');
    probe.style.cssText='position:absolute;left:0;top:0;visibility:hidden;white-space:nowrap;pointer-events:none';
    el.append(probe);
    let w=0;for(const x of ws){probe.textContent=x;w=Math.max(w,probe.getBoundingClientRect().width);}
    probe.remove();
    /* the space is the heading's column, not its ch-based measure (.band h2, .article h1); a heading that is
       sized to its content can still be wider than its parent, so the parent bounds it too */
    el.style.maxWidth='none';
    const avail=Math.min(contentWidth(el),contentWidth(el.parentElement));
    el.style.maxWidth='';
    if(avail>0&&w>avail){const k=avail/w*0.98;el.style.fontSize=(parseFloat(getComputedStyle(el).fontSize)*k).toFixed(2)+'px';w*=k;}
    /* lets a ch-based max-width grow to the longest word (see .band h2) */
    el.style.setProperty('--word',Math.ceil(w)+'px');
  }
}
let fitQueued=false;
const queueFit=()=>{if(!fitQueued){fitQueued=true;requestAnimationFrame(()=>{fitQueued=false;fitHeadings();});}};
fitHeadings();
window.addEventListener('resize',queueFit);
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fitHeadings);

/* ---- footer door: open 06:00–18:00 in São Paulo ---- */
const hourFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'});
const door=$('#door');
function updateDoor(){const hr=parseInt(hourFmt.format(new Date()),10)%24;door.dataset.door=hr>=6&&hr<18?'open':'sealed';}
if(door){updateDoor();setInterval(updateDoor,60000);}
})();
