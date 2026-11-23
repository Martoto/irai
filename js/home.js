/* IRAI home page: N_eff demo driving the 3D swarm, ceiling chart, manifesto dithering, dusk bees. Needs js/site.js. */
(function(){
"use strict";
const {t,plural,fill,h,$,$$,reduce,num}=window.IRAI;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);

$('#scrollCue').addEventListener('click',()=>{const el=$('#ceiling');if(el)el.scrollIntoView({behavior:reduce.matches?'auto':'smooth'});});

/* ====================== HERO: N_eff demo driving the 3D swarm ====================== */
const sim={N:1000,rho:0.25,paused:false};
const cv=$('#swarm'),fallback=$('#swarmFallback'),pauseBtn=$('#pauseBtn');
/* the overlay names its markers exactly as the panel legend does */
const LABELS={truth:t('hero.legend_truth'),crowd:t('hero.legend_crowd')};
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

/* ====================== DUSK: a flock streams past the nest entrance (boids + curl-noise flow) ======================
   Reynolds boids (separation / alignment / cohesion over a uniform neighbour grid) relax toward a divergence-free flow:
   a slow drifting current plus a few evolving sinusoidal stream-function modes, so bands and eddies form and dissolve.
   The entrance is a gentle attractor: streams bend toward its height and pass by; now and then one bee peels off and
   goes in (it re-enters upstream). Guards hover loosely beside the cell. Units: px and px per 60 Hz frame. */
const HONEY='#F2B632',BG='#05060A',FADE='rgba(5,6,10,0.4)';
const LUM=[0.5,0.68,0.85,1].map(a=>'rgba(242,182,50,'+a+')');
const NR=30,SR=10,VMAX=2.4,VMIN=0.7;
const dusk={cv:$('#dusk'),w:0,h:0,n:0,t:0,v:1,last:0,on:false,seen:false,still:false,pt:false,px:0,py:0};
const dctx=dusk.cv.getContext('2d');
const coarse=window.matchMedia('(pointer: coarse)'),hover=window.matchMedia('(hover: hover) and (pointer: fine)');
let bx,by,bvx,bvy,bst,blum,head,next,gcols=0,grows=0,modes=[],guards=[],fu=0,fv=0;
function duskSize(){const r=dusk.cv.getBoundingClientRect(),d=Math.min(window.devicePixelRatio||1,2);if(!r.width||!r.height)return false;dusk.w=r.width;dusk.h=r.height;dusk.cv.width=Math.round(r.width*d);dusk.cv.height=Math.round(r.height*d);dctx.setTransform(d,0,0,d,0,0);return true;}
function duskGate(){return{x:dusk.w*0.6,y:dusk.h*0.58,r:Math.max(8,Math.min(dusk.h*0.035,15))};}
/* flow velocity at (x,y,t) into fu,fv: curl of a stream function, so the field has no sources or sinks */
function duskFlow(x,y,t){let u=0,v=0;
  for(const m of modes){const c=Math.cos(m.kx*x+m.ky*y+m.w*t+m.ph)*m.amp*(0.55+0.45*Math.sin(t*m.mw+m.mp));u+=m.ky*c;v-=m.kx*c;}
  const th=0.28*Math.sin(t*0.05);fu=(u+0.7*Math.cos(th))*dusk.v;fv=(v+0.7*Math.sin(th))*dusk.v;}
function duskSpawn(i,x){const h=dusk.h;bx[i]=x;by[i]=h*(0.1+Math.random()*0.8);duskFlow(bx[i],by[i],dusk.t);bvx[i]=fu;bvy[i]=fv;bst[i]=0;blum[i]=Math.random()*4|0;}
function duskInit(settle){
  const w=dusk.w,h=dusk.h,n=Math.round(Math.max(120,Math.min(560,w*h/1250*(coarse.matches?0.7:1))));
  dusk.n=n;dusk.v=Math.max(0.6,Math.min(1,h/420));bx=new Float32Array(n);by=new Float32Array(n);bvx=new Float32Array(n);bvy=new Float32Array(n);bst=new Uint8Array(n);blum=new Uint8Array(n);
  next=new Int32Array(n);gcols=Math.ceil(w/NR)+2;grows=Math.ceil(h/NR)+2;head=new Int32Array(gcols*grows);
  modes=[];for(let i=0;i<5;i++){const k=6.2832/(h*(0.6+Math.random()*0.9)),a=Math.random()*6.2832;
    modes.push({kx:Math.cos(a)*k,ky:Math.sin(a)*k,amp:(0.35+Math.random()*0.35)/k,w:(0.1+Math.random()*0.2)*(Math.random()<0.5?-1:1),ph:Math.random()*6.2832,mw:0.03+Math.random()*0.05,mp:Math.random()*6.2832});}
  dusk.t=Math.random()*200;
  for(let i=0;i<n;i++)duskSpawn(i,Math.random()*w);
  const G=coarse.matches?4:6;guards=[];
  for(let i=0;i<G;i++)guards.push({a:-2.4+i*(4.8/(G-1))+(Math.random()-0.5)*0.4,d:2.1+Math.random()*0.8,ph:Math.random()*6.2832,f1:1.6+Math.random()*1.2,f2:1.9+Math.random()*1.4});
  for(let s=0;s<settle;s++)duskSim(1);
}
function duskSim(dt){
  const n=dusk.n,w=dusk.w,h=dusk.h,g=duskGate(),t=dusk.t+=dt/60,top=h*0.08,bot=h*0.94,keep=g.r*2.4,near=Math.max(110,h*0.4),vmax=VMAX*dusk.v,vmin=VMIN*dusk.v;
  head.fill(-1);
  for(let i=0;i<n;i++){const c=Math.min(grows-1,Math.max(0,(by[i]/NR|0)+1))*gcols+Math.min(gcols-1,Math.max(0,(bx[i]/NR|0)+1));next[i]=head[c];head[c]=i;}
  /* now and then a bee near the entrance peels off the stream and heads in */
  if(Math.random()<dt*0.02)for(let k=0;k<10;k++){const i=Math.random()*n|0;if(!bst[i]&&Math.hypot(bx[i]-g.x,by[i]-g.y)<near){bst[i]=1;break;}}
  for(let i=0;i<n;i++){
    const x=bx[i],y=by[i],gx=x-g.x,gy=y-g.y,dg=Math.hypot(gx,gy)||1;let vx=bvx[i],vy=bvy[i],ax=0,ay=0,cnt=0,sx=0,sy=0,avx=0,avy=0,cx=0,cy=0;
    const ci=Math.min(gcols-1,Math.max(0,(x/NR|0)+1)),cj=Math.min(grows-1,Math.max(0,(y/NR|0)+1));
    for(let jj=Math.max(0,cj-1);jj<=Math.min(grows-1,cj+1);jj++)for(let ii=Math.max(0,ci-1);ii<=Math.min(gcols-1,ci+1);ii++)
      for(let k=head[jj*gcols+ii];k>=0;k=next[k]){if(k===i)continue;const dx=x-bx[k],dy=y-by[k],d2=dx*dx+dy*dy;if(d2>NR*NR)continue;
        cnt++;avx+=bvx[k];avy+=bvy[k];cx+=bx[k];cy+=by[k];if(d2<SR*SR&&d2>0.01){const d=Math.sqrt(d2),s=(SR-d)/(SR*d);sx+=dx*s;sy+=dy*s;}}
    if(bst[i]){
      if(dg<g.r*0.5){duskSpawn(i,-10);continue;}
      const sp=Math.min(1.8,0.3+dg*0.022)*dusk.v;ax=(-gx/dg*sp-vx)*0.08+sx*0.2;ay=(-gy/dg*sp-vy)*0.08+sy*0.2;
    }else{
      duskFlow(x,y,t);ax=(fu-vx)*0.03+sx*0.35;ay=(fv-vy)*0.03+sy*0.35;
      if(cnt){ax+=(avx/cnt-vx)*0.05+(cx/cnt-x)*0.001;ay+=(avy/cnt-vy)*0.05+(cy/cnt-y)*0.001;}
      ay-=gy*0.0003*Math.exp(-gx*gx/(w*w*0.03));
      if(dg<keep){const s=(keep-dg)/keep*0.22;ax+=gx/dg*s;ay+=gy/dg*s;}
      if(dusk.pt){const px=x-dusk.px,py=y-dusk.py,p2=px*px+py*py;if(p2<6400){const pd=Math.sqrt(p2)||1,s=(80-pd)/80*0.3;ax+=px/pd*s;ay+=py/pd*s;}}
      if(y<top)ay+=(top-y)*0.004;else if(y>bot)ay-=(y-bot)*0.004;
    }
    vx+=ax*dt;vy+=ay*dt;const s=Math.hypot(vx,vy),lo=bst[i]?0.25:vmin;
    if(s>vmax){vx*=vmax/s;vy*=vmax/s;}else if(s<lo&&s>0){vx*=lo/s;vy*=lo/s;}
    bvx[i]=vx;bvy[i]=vy;let nx=x+vx*dt;if(nx>w+12)nx-=w+24;else if(nx<-12)nx+=w+24;bx[i]=nx;by[i]=y+vy*dt;
  }
}
function duskHex(x,y,r){dctx.moveTo(x,y-r);for(let k=1;k<6;k++){const a=-1.5708+k*1.0472;dctx.lineTo(x+Math.cos(a)*r,y+Math.sin(a)*r);}dctx.closePath();}
function duskDraw(persist){
  const w=dusk.w,h=dusk.h,n=dusk.n,t=dusk.t,g=duskGate(),r=g.r;
  dctx.globalAlpha=1;dctx.fillStyle=persist?FADE:BG;dctx.fillRect(0,0,w,h);
  /* a dim fragment of comb behind the entrance cell (pointy-top axial offsets) */
  const sp=r*1.732+3;dctx.lineWidth=1;dctx.strokeStyle='rgba(125,127,147,.24)';dctx.beginPath();
  for(const [q,s] of [[-1,0],[0,-1],[1,-1],[-1,-1],[-2,1]])duskHex(g.x+sp*(q+s/2),g.y+sp*0.866*s,r);
  dctx.stroke();
  /* bees: short honey dashes along velocity, batched by brightness */
  dctx.lineCap='round';dctx.lineWidth=1.7;
  for(let L=0;L<4;L++){dctx.strokeStyle=LUM[L];dctx.beginPath();
    for(let i=0;i<n;i++){if(blum[i]!==L)continue;const vx=bvx[i],vy=bvy[i],k=0.9/(Math.hypot(vx,vy)||1);dctx.moveTo(bx[i]-vx*k,by[i]-vy*k);dctx.lineTo(bx[i]+vx*k,by[i]+vy*k);}
    dctx.stroke();}
  /* the entrance: a short hexagonal wax tube seen at a slight angle; it hides bees that went in */
  const ix=g.x+r*0.14,iy=g.y+r*0.18,ir=r*0.58;
  dctx.fillStyle=BG;dctx.beginPath();duskHex(g.x,g.y,r);dctx.fill();
  dctx.fillStyle='#000';dctx.beginPath();duskHex(ix,iy,ir);dctx.fill();
  dctx.strokeStyle='rgba(242,182,50,.35)';dctx.beginPath();duskHex(ix,iy,ir);
  for(let k=0;k<6;k++){const a=-1.5708+k*1.0472,c=Math.cos(a),s=Math.sin(a);dctx.moveTo(g.x+c*r,g.y+s*r);dctx.lineTo(ix+c*ir,iy+s*ir);}dctx.stroke();
  dctx.strokeStyle=HONEY;dctx.lineWidth=1.25;dctx.beginPath();duskHex(g.x,g.y,r);dctx.stroke();
  /* guards: hold loosely beside the entrance, facing it, with a small hover */
  dctx.lineWidth=2;dctx.strokeStyle=HONEY;dctx.beginPath();
  for(const q of guards){const a=q.a+0.12*Math.sin(t*0.2+q.ph),x=g.x+Math.cos(a)*r*q.d+Math.sin(t*q.f1+q.ph)*2.2,y=g.y+Math.sin(a)*r*q.d+Math.cos(t*q.f2+q.ph)*1.6;
    const f=Math.atan2(g.y-y,g.x-x)+0.35*Math.sin(t*0.9+q.ph),c=Math.cos(f)*1.2,s=Math.sin(f)*1.2;dctx.moveTo(x-c,y-s);dctx.lineTo(x+c,y+s);}
  dctx.stroke();
}
function duskStep(time){
  if(!dusk.on)return;
  const dt=dusk.last?Math.min(2,Math.max(0.25,(time-dusk.last)/16.667)):1;dusk.last=time;
  duskSim(dt);duskDraw(true);requestAnimationFrame(duskStep);
}
function duskVisibility(){
  const should=dusk.seen&&!document.hidden&&!reduce.matches;
  if(should&&!dusk.on){if(!dusk.n){if(!duskSize())return;duskInit(120);}dusk.on=true;dusk.still=false;dusk.last=0;requestAnimationFrame(duskStep);}
  /* paused offscreen/hidden: keep the last frame; first paint or reduced motion: one settled, trail-free frame */
  else if(!should){dusk.on=false;if((!dusk.n||reduce.matches&&!dusk.still)&&duskSize()){duskInit(reduce.matches?360:120);duskDraw(false);dusk.still=reduce.matches;}}
}
if(window.IntersectionObserver)new IntersectionObserver(es=>{dusk.seen=es[0].isIntersecting;duskVisibility();},{rootMargin:'120px'}).observe(dusk.cv);else dusk.seen=true;
document.addEventListener('visibilitychange',duskVisibility);
if(reduce.addEventListener)reduce.addEventListener('change',duskVisibility);
dusk.cv.addEventListener('pointermove',e=>{if(e.pointerType!=='mouse'||!hover.matches)return;const r=dusk.cv.getBoundingClientRect();dusk.px=e.clientX-r.left;dusk.py=e.clientY-r.top;dusk.pt=true;});
dusk.cv.addEventListener('pointerleave',()=>{dusk.pt=false;});
window.addEventListener('resize',()=>{const r=dusk.cv.getBoundingClientRect(),d=Math.min(window.devicePixelRatio||1,2);
  if(Math.round(r.width*d)===dusk.cv.width&&Math.round(r.height*d)===dusk.cv.height)return;
  if(duskSize()){duskInit(reduce.matches?360:120);if(!dusk.on)duskDraw(false);}});
duskVisibility();
})();
