import fs from 'node:fs';
import { postItem, RHO } from '../partials.mjs';

const ASCII = fs.readFileSync(new URL('../hero-ascii.txt', import.meta.url), 'utf8').replace(/\n+$/, '');
const N0 = 1000, RHO0 = 0.25;
const neff = (n, r) => n / (1 + (n - 1) * r);
const MARK_DARK = '<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><circle cx="15" cy="17" r="9" fill="none" stroke="#05060A" stroke-width="3.2"/><circle cx="15" cy="17" r="2.6" fill="#05060A"/><circle cx="27" cy="7" r="2.4" fill="#05060A"/><circle cx="29" cy="19" r="1.7" fill="#05060A"/><circle cx="20" cy="3" r="1.5" fill="#05060A"/></svg>';

/* initial hero readout, identical to what js/home.js renders for N=1000, ρ=0.25 */
function heroClaim(c) {
  const k = Math.max(1, Math.round(neff(N0, RHO0)));
  return `<span id="hLine1">${c.p('hero.agents', N0, { n: `<b id="hN">${c.num(N0)}</b>` })}</span> <span id="hLine2">${c.p('hero.opinions_about', k, { k: `<b id="hNeff">${c.num(k)}</b>` })}</span>`;
}
function errLeft(c) {
  const pct = 100 / Math.sqrt(neff(N0, RHO0)), d = pct < 10 ? 1 : 0;
  return c.num(pct / 100, { style: 'percent', minimumFractionDigits: d, maximumFractionDigits: d });
}

function ceilingTable(c) {
  const one = v => c.num(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const rows = [10, 100, 1000].map(n => `<tr><th>${c.num(n)}</th><td>${c.num(n)}</td>${[0.05, 0.25, 0.5].map(r => `<td>${one(neff(n, r))}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr><th>${c.t('ceiling.th_agents')}</th><th>${c.t('ceiling.th_none')}</th><th>${c.num(0.05)}</th><th>${c.num(0.25)}</th><th>${c.num(0.5)}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const ROWS = [
  ['neff', 'Neff Audit', 'on', 'status.pilot'],
  ['society', 'Model Society', 'warm', 'status.validation'],
  ['prova', 'Prova', 'warm', 'status.development'],
  ['guarda', 'Guarda', 'warm', 'status.development'],
];

function ladder(c) {
  let out = '';
  for (let i = 0; i < 8; i++) {
    const bars = '▁▂▃▄▅▆▇█';
    const flag = c.has(`ladder.${i}.flag`) ? ` <span class="flag">${c.t(`ladder.${i}.flag`)}</span>` : '';
    out += `<li style="--d:${i}"${i === 0 ? ' class="now"' : ''}><span class="bars" aria-hidden="true"><b>${bars.slice(0, i + 1)}</b>${bars.slice(i + 1)}</span><div><h3 class="ladder-h">${c.t(`ladder.${i}.h`)}${flag}</h3><p>${c.t(`ladder.${i}.p`)}</p></div></li>`;
  }
  return out;
}

export default {
  view: 'home',
  scripts: ['home'],
  jsKeys: ['hero.agents', 'hero.opinions_about', 'hero.opinions_exact', 'hero.live', 'hero.pause', 'hero.resume', 'hero.play', 'hero.legend_truth', 'hero.legend_crowd', 'chart.'],
  meta: c => ({ title: c.raw('home.meta_title'), description: c.raw('home.meta_desc') }),
  jsonld: c => [{
    '@context': 'https://schema.org', '@type': 'WebSite', '@id': `${c.abs(c.url(''))}#website`,
    name: 'IRAI', url: c.abs(c.url('')), inLanguage: c.lang, description: c.raw('home.meta_desc'),
    publisher: { '@id': `${c.site.SITE_URL}/#organization` },
  }],
  body: c => `
<section class="hero" aria-labelledby="heroH">
  <canvas id="swarm" role="img" aria-label="${c.t('hero.canvas_aria')}"></canvas>
  <pre class="hero-ascii" id="swarmFallback" role="img" aria-label="${c.t('hero.fallback_aria')}" hidden>${ASCII}</pre>
  <div class="hero-inner">
    <div class="hero-copy">
      <h1 id="heroH"><span class="slogan">${c.t('hero.slogan')}</span> <span class="claim">${heroClaim(c)}</span></h1>
      <div class="swarm-window" id="swarmWindow" aria-hidden="true"></div>
      <p class="lede">${c.t('hero.lede')}</p>
      <div class="btn-row">
        <a class="btn btn-primary" href="${c.url('contact/')}">${c.t('cta.audit')}</a>
        <a class="btn btn-ghost" href="${c.url('research/')}">${c.t('hero.read_research')}</a>
      </div>
    </div>
    <div class="console">
      <div class="console-top">
        <ul class="legend" aria-hidden="true">
          <li><svg viewBox="0 0 14 14"><path d="M7 1v12M1 7h12" stroke="#E6E3D8" stroke-width="2"/></svg>${c.t('hero.legend_truth')}</li>
          <li><svg viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="none" stroke="#E6E3D8" stroke-width="2"/></svg>${c.t('hero.legend_crowd')}</li>
          <li><svg viewBox="0 0 14 14"><circle cx="7" cy="7" r="3" fill="#F2B632"/></svg>${c.t('hero.legend_agent')}</li>
        </ul>
        <button type="button" id="pauseBtn" aria-pressed="false">${c.t('hero.pause')}</button>
      </div>
      <div class="controls">
        <div class="rho-ctl">
          <label for="rho"><span class="prompt" aria-hidden="true">&gt;</span> ${c.t('hero.rho_label', { rho: RHO, value: `<span id="rhoVal">${c.num(RHO0, { minimumFractionDigits: 2 })}</span>` })}</label>
          <input type="range" id="rho" min="0" max="0.95" step="0.01" value="${RHO0}">
          <div class="ends"><span>${c.t('hero.end_independent')}</span><span>${c.t('hero.end_copies')}</span></div>
        </div>
        <div class="agents">
          <span class="agents-label" id="nLabel">${c.t('hero.agents_label')}</span>
          <div class="seg" role="group" aria-labelledby="nLabel">
            ${[10, 100, 1000].map(n => `<button type="button" data-n="${n}" aria-pressed="${n === N0}">${c.num(n)}</button>`).join('\n            ')}
          </div>
        </div>
        <div class="readout"><span>${c.t('hero.error_left', { pct: `<strong id="errLeft">${errLeft(c)}</strong>` })}</span></div>
      </div>
      <p class="sr" aria-live="polite" id="heroLive"></p>
    </div>
  </div>
  <button class="cue" type="button" id="scrollCue"><span aria-hidden="true">▾</span> ${c.t('hero.scroll')}</button>
</section>

<section class="band" id="ceiling">
  <div class="wrap g12">
    <div class="col-a stack" style="--gap:20px">
      <h2>${c.t('ceiling.h2')}</h2>
      <p>${c.t('ceiling.p1')}</p>
      <p>${c.t('ceiling.p2')}</p>
      <p class="ui muted cite">${c.t('ceiling.cite_html')}</p>
    </div>
    <figure class="viz frame col-b">
      <p class="fig-formula">N<sub>eff</sub> = N / (1 + (N − 1)${RHO})</p>
      <h3>${c.t('ceiling.fig_h')}</h3>
      <p class="sub">${c.t('ceiling.fig_sub')}</p>
      <div class="plotbox" id="ceilPlot"></div>
      <figcaption class="key"><span><i style="border-color:var(--s1)"></i>${c.t('ceiling.key_corr', { r: c.num(0.05) })}</span><span><i style="border-color:var(--s2)"></i>${c.num(0.25)}</span><span><i style="border-color:var(--s3)"></i>${c.num(0.5)}</span><span><i style="border-color:var(--muted);border-top-width:1.5px"></i>${c.t('ceiling.key_none')}</span></figcaption>
      <details><summary>${c.t('ceiling.show_numbers')}</summary>
        ${ceilingTable(c)}
      </details>
    </figure>
  </div>
</section>

<section class="band">
  <div class="wrap">
    <div class="head g12"><h2>${c.t('do.h2')}</h2></div>
    <div class="rows">
${ROWS.map(([id, name, tone, status]) => `      <div class="row">
        <div class="rec"><h3>${name}</h3><span class="status ${tone}">${c.t(status)}</span></div>
        <div><p class="q">${c.t(`do.${id}.q`)}</p><p>${c.t(`do.${id}.p`)}</p></div>
        <div class="for"><span>${c.t(`do.${id}.for`)}</span><a href="${c.url('products/')}#${id}">${c.t(`do.${id}.link`)}</a></div>
      </div>`).join('\n')}
    </div>
  </div>
</section>

<section class="band">
  <div class="wrap g12">
    <div class="col-a stack" style="--gap:20px">
      <h2>${c.t('ladder.h2')}</h2>
      <p>${c.t('ladder.p1')}</p>
      <p>${c.t('ladder.p2')}</p>
    </div>
    <div class="col-b">
      <div class="depth" aria-hidden="true"><span>${c.t('ladder.shallow')}</span><span>▁▂▃▄▅▆▇█</span><span>${c.t('ladder.deep')}</span></div>
      <ol class="ladder">${ladder(c)}</ol>
      <p class="note">${c.t('ladder.note')}</p>
    </div>
  </div>
</section>

<section class="band">
  <div class="wrap">
    <div class="head g12 head-row">
      <h2>${c.t('homeblog.h2')}</h2>
      <a class="ui more" href="${c.url('blog/')}">${c.t('homeblog.all')}</a>
    </div>
    <div class="list log">${c.site.POSTS.slice(0, 3).map(p => postItem(c, p, 'h3')).join('')}</div>
  </div>
</section>

<section class="manifesto" aria-labelledby="missionText">
  <pre class="dither" data-rows="░▒▓" aria-hidden="true"></pre>
  <div class="col">
    ${MARK_DARK}
    <p class="mission" id="missionText">${c.t('manifesto.mission')}</p>
    <p class="sign" lang="pt">iraí</p>
    <div class="letter">
      <p>${c.t('manifesto.letter1')}</p>
      <p>${c.t('manifesto.letter2')}</p>
    </div>
  </div>
  <pre class="dither" data-rows="▓▒░" aria-hidden="true"></pre>
  <div class="dusk"><canvas id="dusk" role="img" aria-label="${c.t('manifesto.dusk_aria')}"></canvas></div>
</section>`,
};
