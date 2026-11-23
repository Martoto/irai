// /404.html. GitHub Pages serves this one file for every missing URL, so it is built in English
// and swaps its message to the language of the URL prefix (/pt/…, /ja/…) when there is one.
export default {
  view: 'notfound',
  meta: c => ({ title: c.raw('nf.meta_title'), description: c.raw('nf.p') }),
  body: c => {
    const msgs = Object.fromEntries(c.site.LOCALES.map(l => {
      const s = c.site.content[l.code].strings;
      return [l.prefix || 'en', { lang: l.html, title: s['nf.meta_title'], h1: s['nf.h1'], p: s['nf.p'], home: s['nf.home'], href: c.url('', l) }];
    }));
    ['nf.meta_title', 'nf.h1', 'nf.p', 'nf.home'].forEach(k => c.raw(k));
    const data = JSON.stringify({ base: c.site.BASE, msgs }).replace(/</g, '\\u003c');
    return `
<div class="wrap page-head">
  <h1 id="nfH">${c.t('nf.h1')}</h1>
  <p class="measure lede" id="nfP">${c.t('nf.p')}</p>
  <div><a class="btn btn-primary" id="nfHome" href="${c.url('')}">${c.t('nf.home')}</a></div>
</div>
<script>(function(){var d=${data},seg=location.pathname.indexOf(d.base)===0?location.pathname.slice(d.base.length).split('/')[0]:'',m=d.msgs[seg];
if(!m||seg==='en')return;document.documentElement.lang=m.lang;document.title=m.title;
document.getElementById('nfH').textContent=m.h1;document.getElementById('nfP').textContent=m.p;var a=document.getElementById('nfHome');a.textContent=m.home;a.href=m.href;})();</script>`;
  },
};
