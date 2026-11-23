import { defs, NEFF_FORMULA } from '../partials.mjs';

function steps(c, prefix) {
  let out = '';
  for (let i = 1; i <= 4; i++) out += `<li><b>${c.t(`${prefix}.s${i}.h`)}</b>${c.t(`${prefix}.s${i}.p`)}</li>`;
  return `<ol class="steps">${out}</ol>`;
}

function section(c, id, name, chip, cta, body) {
  return `<section class="band tight" id="${id}">
  <div class="wrap product">
    <div class="side"><h2>${name}</h2>${chip}${cta}</div>
    <div class="body">
${body}
    </div>
  </div>
</section>`;
}
const ask = (c, id, name) => `<a class="btn btn-ghost" href="${c.url(`contact/?topic=${id}`)}">${c.t('products.ask', { product: name })}</a>`;

export default {
  view: 'products',
  nav: 'products',
  meta: c => ({ title: c.raw('products.meta_title'), description: c.raw('products.meta_desc') }),
  crumbs: c => [{ name: c.raw('nav.products'), path: 'products/' }],
  body: c => `
<div class="wrap page-head">
  <h1>${c.t('products.h1')}</h1>
  <p class="measure lede">${c.t('products.lede')}</p>
</div>

${section(c, 'neff', 'Neff Audit', `<span class="chip on">${c.t('products.neff.chip')}</span>`,
    `<a class="btn btn-primary" href="${c.url('contact/?topic=neff')}">${c.t('cta.audit')}</a>`, `
      <p class="measure">${c.t('products.neff.intro')}</p>
      <div>
        <h3 class="sub-h">${c.t('products.neff.report_h')}</h3>
        ${defs(c, 'products.neff.d', 4, 'h4', { 2: NEFF_FORMULA })}
      </div>
      <div>
        <h3 class="sub-h">${c.t('products.neff.steps_h')}</h3>
        ${steps(c, 'products.neff')}
      </div>`)}

${section(c, 'society', 'Model Society', `<span class="chip warm">${c.t('products.society.chip')}</span>`, ask(c, 'society', 'Model Society'), `
      <p class="measure">${c.t('products.society.intro')}</p>
      ${defs(c, 'products.society.d', 6)}
      <p class="note">${c.t('products.society.note')}</p>`)}

${section(c, 'prova', 'Prova', `<span class="chip warm">${c.t('status.development')}</span>`, ask(c, 'prova', 'Prova'), `
      <p class="measure">${c.t('products.prova.intro')}</p>
      ${defs(c, 'products.prova.d', 6)}
      <div>
        <h3 class="sub-h">${c.t('products.prova.steps_h')}</h3>
        ${steps(c, 'products.prova')}
      </div>
      <p class="note">${c.t('products.prova.note')}</p>`)}

${section(c, 'guarda', 'Guarda', `<span class="chip warm">${c.t('status.development')}</span>`, ask(c, 'guarda', 'Guarda'), `
      <p class="measure">${c.t('products.guarda.intro')}</p>
      ${defs(c, 'products.guarda.d', 4)}`)}`,
};
