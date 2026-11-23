export default {
  view: 'about',
  nav: 'about',
  meta: c => ({ title: c.raw('about.meta_title'), description: c.raw('about.meta_desc') }),
  crumbs: c => [{ name: c.raw('nav.about'), path: 'about/' }],
  body: c => `
<div class="wrap page-head">
  <h1>${c.t('about.h1')}</h1>
  <p class="measure lede">${c.t('about.lede')}</p>
</div>
<section class="band tight flush">
  <div class="wrap g12">
    <div class="col-a stack" style="--gap:20px">
      <h2>${c.t('about.name.h2')}</h2>
      <p>${c.t('about.name.p1_html')}</p>
      <p>${c.t('about.name.p2')}</p>
      <p>${c.t('about.name.p3')}</p>
    </div>
    <div class="col-b stack" style="--gap:20px">
      <h2>${c.t('about.company.h2')}</h2>
      <p>${c.t('about.company.p1_html')}</p>
      <p>${c.t('about.company.p2')}</p>
      <h3>${c.t('about.dont.h3')}</h3>
      <p>${c.t('about.dont.p')}</p>
      <div><a class="btn btn-primary" href="${c.url('contact/')}">${c.t('about.cta')}</a></div>
    </div>
  </div>
</section>`,
};
