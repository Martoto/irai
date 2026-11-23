import { defs, RHO, NEFF_FORMULA } from '../partials.mjs';
import { PAPER_URL } from '../site.mjs';

/* paper titles stay in their original language; descriptions are translated */
const PAPERS = [
  { chip: 'on', status: 'published', title: `<a href="${PAPER_URL}">Echoes of Humanity: The Collective Mind of LLM Agents</a>`, key: 'research.p1',
    sub: c => `<span>Salles &amp; Graeml</span><span>AMCIS 2026 Proceedings, SIG AIAA, Paper 1719</span><span>${c.t('research.p1.extension')}</span>` },
  { status: 'design', title: 'Built, Not Sampled: Engineering Crowd Wisdom in LLM Agent Swarms through Intersecting Knowledge', key: 'research.p2',
    sub: c => `<span>${c.t('research.working_title')}</span>` },
  { status: 'design', title: 'A Nation of Models: Can an LLM Society of Brazil Forecast Where Polls Cannot See?', key: 'research.p3',
    sub: c => `<span>${c.t('research.working_title')}</span><a href="${c.url('blog/where-polls-cannot-see/')}">${c.t('research.p3.notes')}</a>` },
  { status: 'planned', key: 'research.p4' },
  { status: 'planned', key: 'research.p5' },
  { status: 'planned', key: 'research.p6' },
  { status: 'long', key: 'research.p7' },
];

function paper(c, p) {
  const title = p.title || c.t(`${p.key}.h`);
  return `<div class="item"><div class="meta"><span class="chip${p.chip ? ' ' + p.chip : ''}">${c.t(`research.chip.${p.status}`)}</span></div><div><h3 class="item-h">${title}</h3><p>${c.t(`${p.key}.p`)}</p>${p.sub ? `<div class="sub">${p.sub(c)}</div>` : ''}</div></div>`;
}

export default {
  view: 'research',
  nav: 'research',
  meta: c => ({ title: c.raw('research.meta_title'), description: c.raw('research.meta_desc') }),
  crumbs: c => [{ name: c.raw('nav.research'), path: 'research/' }],
  body: c => `
<div class="wrap page-head">
  <h1>${c.t('research.h1')}</h1>
  <p class="measure lede">${c.t('research.lede')}</p>
</div>

<section class="band tight">
  <div class="wrap">
    <div class="head g12"><h2>${c.t('research.q.h2')}</h2></div>
    ${defs(c, 'research.q', 8)}
  </div>
</section>

<section class="band tight">
  <div class="wrap">
    <div class="head g12"><h2>${c.t('research.kit.h2')}</h2><p class="measure">${c.t('research.kit.p')}</p></div>
    ${defs(c, 'research.k', 5, 'h3', { vars: { rho: RHO }, 2: NEFF_FORMULA, 3: `<p class="formula">${c.t('research.k3.formula')}</p>` })}
  </div>
</section>

<section class="band tight">
  <div class="wrap">
    <div class="head g12"><h2>${c.t('research.papers.h2')}</h2><p class="ui muted">${c.t('research.papers.note')}</p></div>
    <div class="list log">
      ${PAPERS.map(p => paper(c, p)).join('\n      ')}
    </div>
  </div>
</section>

<section class="band tight">
  <div class="wrap">
    <div class="head g12"><h2>${c.t('research.rules.h2')}</h2></div>
    ${defs(c, 'research.r', 6)}
  </div>
</section>`,
};
