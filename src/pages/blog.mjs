import { postItem } from '../partials.mjs';

export default {
  view: 'blog',
  nav: 'blog',
  meta: c => ({ title: c.raw('blog.meta_title'), description: c.raw('blog.meta_desc') }),
  crumbs: c => [{ name: c.raw('nav.blog'), path: 'blog/' }],
  body: c => `
<div class="wrap page-head">
  <h1>${c.t('blog.h1')}</h1>
  <p class="measure lede">${c.t('blog.lede')}</p>
</div>
<section class="band tight flush"><div class="wrap"><div class="list log">${c.site.POSTS.map(p => postItem(c, p, 'h2')).join('')}</div></div></section>`,
};
