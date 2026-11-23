// One blog post; the build passes the post's metadata (content/posts.json entry) as c.page.post.
export default {
  view: 'post',
  nav: 'blog',
  meta: c => {
    const p = c.page.post;
    const title = c.raw(`post.${p.slug}.title`);
    return { title: c.raw('meta.title_post', { title }), ogTitle: title, description: c.raw(`post.${p.slug}.summary`), type: 'article', published: p.date };
  },
  crumbs: c => [{ name: c.raw('nav.blog'), path: 'blog/' }, { name: c.raw(`post.${c.page.post.slug}.title`), path: c.page.path }],
  jsonld: c => {
    const p = c.page.post, url = c.abs(c.url(c.page.path));
    return [{
      '@context': 'https://schema.org', '@type': 'BlogPosting',
      headline: c.raw(`post.${p.slug}.title`), description: c.raw(`post.${p.slug}.summary`),
      datePublished: p.date, inLanguage: c.lang, url,
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      image: `${c.site.SITE_URL}/assets/og.png`,
      author: { '@type': 'Organization', name: 'IRAI', url: `${c.site.SITE_URL}/` },
      publisher: { '@id': `${c.site.SITE_URL}/#organization` },
    }];
  },
  body: c => {
    const p = c.page.post, all = c.site.POSTS;
    const next = all[(all.indexOf(p) + 1) % all.length];
    const time = c.p('blog.read_time', p.mins, { n: c.num(p.mins) });
    return `
<div class="wrap page-head">
  <article class="article">
    <a class="back ui" href="${c.url('blog/')}">${c.t('post.back')}</a>
    <h1>${c.t(`post.${p.slug}.title`)}</h1>
    <p class="by">${c.t('post.byline', { date: `<time datetime="${p.date}">${c.date(p.date)}</time>`, time })}</p>
    <div class="body">
${c.postBody(p.slug)}
    </div>
    <div class="refs"><h2 class="refs-h">${c.t('post.sources')}</h2><ul${c.loc.code !== 'en' ? ' lang="en"' : ''}>${p.refs.map(r => `<li>${c.esc(r)}</li>`).join('')}</ul></div>
    <div class="after"><a class="btn btn-ghost" href="${c.url(`blog/${next.slug}/`)}">${c.t('post.next', { title: c.t(`post.${next.slug}.title`) })}</a></div>
  </article>
</div>`;
  },
};
