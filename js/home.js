/* IRAI home page: N_eff demo driving the 3D swarm, ceiling chart, manifesto dithering, dusk bees. Needs js/site.js. */
(function(){
"use strict";
const {t,plural,fill,h,$,$$,reduce,num}=window.IRAI;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);

$('#scrollCue').addEventListener('click',()=>{const el=$('#ceiling');if(el)el.scrollIntoView({behavior:reduce.matches?'auto':'smooth'});});

/* ====================== HERO: N_eff demo driving the 3D swarm ====================== */
const sim={N:1000,rho:0.25,paused:false};
const cv=$('#swarm'),fallback=$('#swarmFallback'),pauseBtn=$('#pauseBtn');
const LABELS={truth:t('swarm.truth'),crowd:t('swarm.crowd')};
/* Where and how big the swarm should be: the centre of the empty .swarm-window as 0..1 of the
   hero box (the canvas fills the hero, so this is also the canvas CSS box), plus a radius as a
   fraction of the canvas height that the cloud's outer extent must fit in. Returns [x, y, radius]. */
const heroEl=$('.hero'),swarmWin=$('#swarmWindow');
function swarmFocus(){
  const c=heroEl.getBoundingClientRect(),w=swarmWin.getBoundingClientRect();
  if(!c.width||!c.height||!w.width||!w.height)return null;
  let y=w.top+w.height/2-c.top;
  /* desktop: the window overlaps the docked panel on short screens; keep the centroid and its
     truth/crowd markers a fifth of the hero height clear above the panel */
  if(getComputedStyle(swarmWin).position==='absolute'){
    const pt=$('.console').getBoundingClientRect().top-c.top;
    y=Math.max(c.height*0.24,Math.min(y,pt-c.height*0.2));
  }
  const x=w.left+w.width/2-c.left;
  let r;
  if(getComputedStyle(swarmWin).position==='absolute'){
    /* desktop: a large cloud, ~0.30 of the hero height at 1440×900, scaled with the aspect ratio
       (0.26–0.32); its lower part may pass behind the opaque panel, the centre may not (rule above).
       Capped so it stays clear of the header (the clamp above can lift the centre toward the nav)
       and inside the right edge. */
    r=Math.min(0.32,Math.max(0.26,0.30*(c.width/c.height)/1.6))*c.height;
    r=Math.min(r,y-$('#top').offsetHeight-8,c.width-x); /* hero starts at the page top, under the fixed header */
  }else r=Math.min(w.width,w.height)/2; /* mobile: the dedicated gap */
  return [x/c.width,y/c.height,Math.max(0,r)/c.height];
}
let swarm=null;
const f0=swarmFocus()||[0.68,0.42,0.19];
try{swarm=(window.IraiSwarm&&typeof window.IraiSwarm.create==='function')?window.IraiSwarm.create(cv,{rho:sim.rho,agents:sim.N,reducedMotion:reduce.matches,focus:[f0[0],f0[1]],radius:f0[2],labels:LABELS}):null;}catch(_){swarm=null;}
if(!swarm){cv.hidden=true;fallback.hidden=false;pauseBtn.hidden=true;}
function applyFocus(){
  const f=swarmFocus();if(!f)return;
  heroEl.style.setProperty('--fx',(f[0]*100).toFixed(2)+'%');heroEl.style.setProperty('--fy',(f[1]*100).toFixed(2)+'%');
  if(swarm&&typeof swarm.setFocus==='function')swarm.setFocus(f[0],f[1],f[2]);
}
applyFocus();
if(window.ResizeObserver){const ro=new ResizeObserver(applyFocus);ro.observe(heroEl);ro.observe(swarmWin);}
else window.addEventListener('resize',applyFocus);
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>{
  applyFocus();
  /* the overlay labels are drawn into a glyph atlas: redraw them once the page fonts are in */
  if(!swarm)return;
  if(typeof swarm.setLabels==='function')swarm.setLabels(LABELS);
  else if(typeof swarm.refreshLabels==='function')swarm.refreshLabels();
});
function neff(){return sim.N/(1+(sim.N-1)*sim.rho);}
const rhoFmt={minimumFractionDigits:2,maximumFractionDigits:2};
function updateReadout(){
  const ne=neff(),k=Math.max(1,Math.round(ne));
  fill($('#hLine1'),plural('hero.agents',sim.N),{n:h('b',{id:'hN',text:num(sim.N)})});
  fill($('#hLine2'),plural(sim.rho===0?'hero.opinions_exact':'hero.opinions_about',k),{k:h('b',{id:'hNeff',text:num(k)})});
  $('#rhoVal').textContent=num(sim.rho,rhoFmt);
  const pct=100/Math.sqrt(ne),d=pct<10?1:0;
  $('#errLeft').textContent=num(pct/100,{style:'percent',minimumFractionDigits:d,maximumFractionDigits:d});
  $('#rho').style.setProperty('--fill',(sim.rho/0.95*100).toFixed(1)+'%');
  clearTimeout(updateReadout.t);
  updateReadout.t=setTimeout(()=>{$('#heroLive').textContent=plural('hero.live',k,{n:num(sim.N),rho:num(sim.rho,rhoFmt),k:num(k)});},700);
}
$('#rho').addEventListener('input',e=>{sim.rho=parseFloat(e.target.value);updateReadout();if(swarm)swarm.setRho(sim.rho);});
$$('.seg button').forEach(b=>b.addEventListener('click',()=>{sim.N=parseInt(b.dataset.n,10);$$('.seg button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));updateReadout();if(swarm)swarm.setAgents(sim.N);}));
/* Pause/Play is the only caller of pause()/resume(): swarm.js already stops itself when the hero is
   offscreen or the tab is hidden, and under reduced motion it shows one settled frame until the user presses Play. */
pauseBtn.addEventListener('click',()=>{
  if(!swarm)return;
  sim.paused=!sim.paused;pauseBtn.setAttribute('aria-pressed',String(sim.paused));pauseBtn.textContent=sim.paused?t('hero.resume'):t('hero.pause');
  if(sim.paused)swarm.pause();else swarm.resume();
});
if(reduce.matches){sim.paused=true;pauseBtn.setAttribute('aria-pressed','true');pauseBtn.textContent=t('hero.play');}
/* the build renders the N=1000, ρ=0.25 state; re-render only if the browser restored other control values */
if($('#rho').value!=='0.25'){sim.rho=parseFloat($('#rho').value);if(swarm)swarm.setRho(sim.rho);updateReadout();}
else $('#rho').style.setProperty('--fill',(sim.rho/0.95*100).toFixed(1)+'%');

/* ---- manifesto edges: shade-glyph dithering, one row per density step ---- */
function fillDither(){const n=Math.ceil(window.innerWidth/8)+4;for(const el of $$('.dither'))el.textContent=Array.from(el.dataset.rows,c=>c.repeat(n)).join('\n');}
fillDither();window.addEventListener('resize',fillDither);

/* ====================== CEILING CHART ====================== */
const CEIL=[[0.05,'--s1'],[0.25,'--s2'],[0.5,'--s3']];
function drawCeiling(){
  const box=$('#ceilPlot');if(!box)return;const W=Math.round(box.clientWidth);if(!W)return;
  const H=W<420?250:300,m={l:30,r:14,t:16,b:40},pw=W-m.l-m.r,ph=H-m.t-m.b,YMAX=22;
  const X=n=>m.l+Math.log10(n)/3*pw,Y=v=>m.t+ph-Math.min(v,YMAX)/YMAX*ph,ne=(n,r)=>n/(1+(n-1)*r);
  let g='';
  for(const n of [1,10,100,1000])g+=`<line x1="${X(n)}" x2="${X(n)}" y1="${m.t}" y2="${m.t+ph}" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 4"/>`;
  for(const v of [0,5,10,15,20])g+=`<line x1="${m.l}" x2="${W-m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${m.l-8}" y="${Y(v)+4}" text-anchor="end">${num(v)}</text>`;
  for(const n of [1,10,100,1000])g+=`<text x="${X(n)}" y="${H-m.b+17}" text-anchor="${n===1?'start':n===1000?'end':'middle'}">${esc(num(n))}</text>`;
  g+=`<text x="${m.l+pw/2}" y="${H-4}" text-anchor="middle">${esc(t('chart.x_label'))}</text>`;
  g+=`<path d="M${X(1)},${Y(1)} L${X(YMAX)},${Y(YMAX)}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="1 3" stroke-linecap="round"/>`;
  for(const [r,c] of CEIL){let d='';for(let i=0;i<=90;i++){const n=Math.pow(10,i/30);d+=(i?'L':'M')+X(n).toFixed(1)+','+Y(ne(n,r)).toFixed(1);}
    g+=`<path d="${d}" fill="none" stroke="var(${c})" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    const end=ne(1000,r);g+=`<text class="val" x="${W-m.r}" y="${Y(end)+(r===0.5?16:-8)}" text-anchor="end" style="fill:${c==='--s3'?'var(--cerumen-ink)':'var('+c+')'}">${esc(t('chart.about',{n:num(Math.round(end))}))}</text>`;}
  g+=`<g id="ceilHover" visibility="hidden"><line id="ceilX" y1="${m.t}" y2="${m.t+ph}" stroke="var(--honey)" stroke-width="1"/>${CEIL.map((c,i)=>`<circle id="ceilD${i}" r="5" fill="var(${c[1]})" stroke="var(--bg)" stroke-width="2"/>`).join('')}</g>`;
  box.innerHTML=`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(t('chart.aria'))}">${g}</svg><div class="tip" id="ceilTip" hidden></div>`;
  const svg=box.firstChild,tip=$('#ceilTip'),hov=$('#ceilHover');
  const move=e=>{const rc=svg.getBoundingClientRect(),px=Math.max(m.l,Math.min(W-m.r,(e.clientX-rc.left)*W/rc.width));
    let n=Math.pow(10,(px-m.l)/pw*3);n=n<10?Math.round(n):n<100?Math.round(n/5)*5:Math.round(n/50)*50;n=Math.max(1,Math.min(1000,n));
    const x=X(n);hov.setAttribute('visibility','visible');$('#ceilX').setAttribute('x1',x);$('#ceilX').setAttribute('x2',x);
    tip.textContent='';tip.append(h('b',{text:plural('chart.tip_agents',n,{n:num(n)})}));
    CEIL.forEach((c,i)=>{const v=ne(n,c[0]);const d=$('#ceilD'+i);d.setAttribute('cx',x);d.setAttribute('cy',Y(v));
      tip.append(h('div',null,h('i',{style:'border-color:var('+c[1]+')'}),t('chart.tip_corr',{r:num(c[0]),v:num(v,{minimumFractionDigits:1,maximumFractionDigits:1})})));});
    tip.hidden=false;const tw=tip.offsetWidth;tip.style.left=(x+12+tw>W?Math.max(0,x-12-tw):x+12)+'px';};
  const leave=()=>{hov.setAttribute('visibility','hidden');tip.hidden=true;};
  svg.addEventListener('pointermove',move);svg.addEventListener('pointerdown',move);svg.addEventListener('pointerleave',leave);svg.addEventListener('pointercancel',leave);
}
let ceilW=0;
function ceilMaybe(){const box=$('#ceilPlot');if(!box)return;const w=Math.round(box.clientWidth);if(w&&w!==ceilW){ceilW=w;drawCeiling();}}
window.addEventListener('resize',ceilMaybe);
ceilMaybe();
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>{ceilW=0;ceilMaybe();});

/* ====================== DUSK: bees returning to the entrance (phosphor) ====================== */
const HONEY='#F2B632',PHOSPHOR='#E6E3D8',BG='#05060A';
const dusk={cv:$('#dusk'),bees:[],guards:[],w:0,h:0,on:false,seen:false};
const dctx=dusk.cv.getContext('2d');
function duskSize(){const r=dusk.cv.getBoundingClientRect(),d=Math.min(window.devicePixelRatio||1,2);if(!r.width||!r.height)return false;dusk.w=r.width;dusk.h=r.height;dusk.cv.width=Math.round(r.width*d);dusk.cv.height=Math.round(r.height*d);dctx.setTransform(d,0,0,d,0,0);return true;}
function duskGate(){return{x:dusk.w/2,y:dusk.h*0.6,r:Math.max(20,Math.min(dusk.h*0.12,40))};}
function edgePoint(){const side=Math.random();if(side<0.42)return{x:-20,y:dusk.h*(0.15+Math.random()*0.8)};if(side<0.84)return{x:dusk.w+20,y:dusk.h*(0.15+Math.random()*0.8)};return{x:dusk.w*Math.random(),y:-20};}
function newBee(spread){const g=duskGate(),e=edgePoint(),home=Math.random()<0.62;
  return{ax:home?e.x:g.x,ay:home?e.y:g.y,bx:home?g.x:e.x,by:home?g.y:e.y,t:spread?Math.random():0,sp:0.0016+Math.random()*0.0022,amp:10+Math.random()*26,fr:5+Math.random()*7,ph:Math.random()*6.28,home,trail:[]};}
function beePos(b){const dx=b.bx-b.ax,dy=b.by-b.ay,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;
  const near=b.home?1-b.t:b.t,z=Math.sin(b.t*b.fr*6.28+b.ph)*b.amp*Math.min(1,near*3.2)*Math.min(1,(b.home?b.t:1-b.t)*6+0.15);
  return{x:b.ax+dx*b.t+nx*z,y:b.ay+dy*b.t+ny*z};}
function duskInit(){dusk.bees=[];dusk.guards=[];const n=Math.round(Math.max(26,Math.min(70,dusk.w/16)));for(let i=0;i<n;i++)dusk.bees.push(newBee(true));for(let i=0;i<5;i++)dusk.guards.push({a:-2.6+i*0.55+Math.random()*0.2,d:1.9+Math.random()*0.9,ph:Math.random()*6.28});}
function duskDraw(time,persist){
  const w=dusk.w,hh=dusk.h,g=duskGate();
  /* phosphor persistence: while animating, fade the last frame instead of clearing it */
  dctx.globalCompositeOperation='source-over';
  if(persist){dctx.fillStyle='rgba(5,6,10,0.2)';dctx.fillRect(0,0,w,hh);}else{dctx.fillStyle=BG;dctx.fillRect(0,0,w,hh);}
  dctx.strokeStyle='rgba(125,127,147,.22)';dctx.lineWidth=1;dctx.setLineDash([2,5]);
  for(const k of [2.4,4.2,6.4]){dctx.beginPath();dctx.arc(g.x,g.y,g.r*k,0,6.2832);dctx.stroke();}
  dctx.setLineDash([]);dctx.lineCap='round';
  dctx.globalCompositeOperation='lighter';
  for(const b of dusk.bees){const p=beePos(b);
    if(b.trail.length>1){dctx.strokeStyle=HONEY;dctx.globalAlpha=0.22;dctx.lineWidth=1.2;dctx.beginPath();dctx.moveTo(b.trail[0].x,b.trail[0].y);for(const q of b.trail)dctx.lineTo(q.x,q.y);dctx.lineTo(p.x,p.y);dctx.stroke();}
    dctx.globalAlpha=0.25;dctx.fillStyle=HONEY;dctx.beginPath();dctx.arc(p.x,p.y,5,0,6.2832);dctx.fill();
    dctx.globalAlpha=1;dctx.beginPath();dctx.arc(p.x,p.y,2.2,0,6.2832);dctx.fill();}
  dctx.globalCompositeOperation='source-over';dctx.globalAlpha=1;
  dctx.fillStyle=BG;dctx.beginPath();dctx.arc(g.x,g.y,g.r,0,6.2832);dctx.fill();
  dctx.strokeStyle=PHOSPHOR;dctx.lineWidth=Math.max(3,g.r*0.16);dctx.beginPath();dctx.arc(g.x,g.y,g.r,0,6.2832);dctx.stroke();
  dctx.strokeStyle=HONEY;dctx.lineWidth=1;dctx.beginPath();dctx.arc(g.x,g.y,g.r*1.35,0,6.2832);dctx.stroke();
  dctx.fillStyle=HONEY;dctx.beginPath();dctx.arc(g.x,g.y,g.r*0.28,0,6.2832);dctx.fill();
  for(const q of dusk.guards){const wob=Math.sin(time*0.002+q.ph),a=q.a+wob*0.12,d=g.r*(q.d+Math.cos(time*0.0027+q.ph)*0.14);
    dctx.beginPath();dctx.arc(g.x+Math.cos(a)*d,g.y+Math.sin(a)*d,3.4,0,6.2832);dctx.fill();}
}
function duskStep(time){
  if(!dusk.on)return;
  for(let i=0;i<dusk.bees.length;i++){const b=dusk.bees[i];const p=beePos(b);b.trail.push(p);if(b.trail.length>10)b.trail.shift();b.t+=b.sp;if(b.t>=1)dusk.bees[i]=newBee(false);}
  duskDraw(time,true);requestAnimationFrame(duskStep);
}
function duskVisibility(){
  const should=dusk.seen&&!document.hidden&&!reduce.matches;
  if(should&&!dusk.on){if(!dusk.w&&!duskSize())return;if(!dusk.bees.length)duskInit();dusk.on=true;requestAnimationFrame(duskStep);}
  else if(!should){dusk.on=false;if(duskSize()){if(!dusk.bees.length)duskInit();duskDraw(0,false);}}
}
if(window.IntersectionObserver)new IntersectionObserver(es=>{dusk.seen=es[0].isIntersecting;duskVisibility();},{rootMargin:'120px'}).observe(dusk.cv);else dusk.seen=true;
document.addEventListener('visibilitychange',duskVisibility);
window.addEventListener('resize',()=>{if(duskSize()){duskInit();if(!dusk.on)duskDraw(0,false);}});
duskVisibility();
})();
