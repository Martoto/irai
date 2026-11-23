import fs from 'node:fs';
import { CONTACT_EMAIL, PAPER_URL, PAGE_SCRIPTS } from './site.mjs';
import { esc } from './context.mjs';

/* the logotype's dim drop-shadow glyphs are drawn with CSS content (.logotype i.s::before) so they count as
   decoration, not as low-contrast text */
const LOGOTYPE = fs.readFileSync(new URL('./logotype.html', import.meta.url), 'utf8').trim()
  .replace(/<i class="s">([^<]*)<\/i>/g, '<i class="s" data-s="$1"></i>');
export const MARK = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="15" cy="17" r="9" fill="none" stroke="currentColor" stroke-width="3.2"/><circle cx="15" cy="17" r="2.6" fill="#E8A90C"/><circle cx="27" cy="7" r="2.4" fill="#E8A90C"/><circle cx="29" cy="19" r="1.7" fill="#E8A90C"/><circle cx="20" cy="3" r="1.5" fill="#E8A90C"/></svg>';
const FONTS = 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=JetBrains+Mono:ital,wght@0,400;0,500;0,700;1,400&family=Piazzolla:ital,opsz,wght@0,8..30,100..900;1,8..30,100..900&family=Marck+Script';
const THREE = 'https://cdn.jsdelivr.net/npm/three@0.150.1/build/three.min.js';

/* JSON inside <script>: keep "</script>" and friends from ending the element */
export const jsonScript = (obj, attrs) => `<script ${attrs}>${JSON.stringify(obj).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, ch => (ch === '\u2028' ? '\\u2028' : '\\u2029'))}</script>`;

/* the same page in every language */
export function langLinks(c, pagePath) {
  return c.site.LOCALES.map(l => `<li><a href="${c.url(pagePath, l)}" hreflang="${l.hreflang}" lang="${l.html}"${l.code === c.loc.code ? ' aria-current="page"' : ''}>${l.name}</a></li>`).join('');
}

/* the old single-page site lived at the root with hash routes (#products, #post-<slug>, …); send those links to their pages */
function hashRedirect(c) {
  return `<script>(function(){var h=location.hash.slice(1),b=${JSON.stringify(c.site.BASE)},p=null,m;if(!h)return;
var v={home:'',products:'products/',research:'research/',blog:'blog/',contact:'contact/',about:'about/',forum:'contact/'};
if(Object.prototype.hasOwnProperty.call(v,h))p=v[h];else if((m=/^post-([\\w-]+)$/.exec(h)))p='blog/'+m[1]+'/';
else if((m=/^product-(neff|society|prova|guarda)$/.exec(h)))p='products/#'+m[1];else if(/^thread-/.test(h))p='contact/';
if(p!==null)location.replace(b+p);})();</script>`;
}

export function layout(c, mod) {
  const { site, loc, page } = c;
  const meta = mod.meta(c);
  const self = c.url(page.path);
  const noindex = !!page.noindex;
  const L = site.LOCALES;
  const ogImage = `${site.SITE_URL}/assets/og.png`;
  const scripts = mod.scripts || [];
  const isHome = scripts.includes('home');

  /* ---- structured data ---- */
  const org = {
    '@context': 'https://schema.org', '@type': 'Organization', '@id': `${site.SITE_URL}/#organization`,
    name: 'IRAI', url: `${site.SITE_URL}/`, logo: `${site.SITE_URL}/assets/icon-512.png`, email: CONTACT_EMAIL,
    address: { '@type': 'PostalAddress', addressCountry: 'BR' },
  };
  const ld = [org];
  if (mod.crumbs) {
    const items = [{ name: c.raw('nav.home'), path: '' }, ...mod.crumbs(c)];
    ld.push({ '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: c.abs(c.url(it.path)) })) });
  }
  if (mod.jsonld) ld.push(...mod.jsonld(c));

  /* ---- strings for scripts ---- */
  const i18n = {
    lang: loc.html, code: loc.code, base: site.BASE,
    strings: c.jsStrings([...PAGE_SCRIPTS.common, ...(mod.jsKeys || [])]),
  };
  if (!noindex) {
    /* "this page is also in <your language>": each offer is written in the language it offers */
    i18n.suggest = Object.fromEntries(L.filter(l => l.code !== loc.code).map(l => {
      const s = site.content[l.code].strings;
      return [l.code, { lang: l.html, href: c.url(page.path, l), text: s['lang.suggest_text'], link: s['lang.suggest_link'], dismiss: s['lang.suggest_dismiss'] }];
    }));
  }
  if (mod.i18nExtra) Object.assign(i18n, mod.i18nExtra(c));

  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    isHome && loc.code === 'en' ? hashRedirect(c) : '',
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}">`,
    noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${c.abs(self)}">`,
    noindex ? '' : L.map(l => `<link rel="alternate" hreflang="${l.hreflang}" href="${c.abs(c.url(page.path, l))}">`).join('\n') +
      `\n<link rel="alternate" hreflang="x-default" href="${c.abs(c.url(page.path, L[0]))}">`,
    '<meta name="color-scheme" content="dark">',
    '<meta name="theme-color" content="#05060A">',
    `<meta property="og:site_name" content="IRAI">`,
    `<meta property="og:type" content="${meta.type || 'website'}">`,
    `<meta property="og:title" content="${esc(meta.ogTitle || meta.title)}">`,
    `<meta property="og:description" content="${esc(meta.description)}">`,
    noindex ? '' : `<meta property="og:url" content="${c.abs(self)}">`,
    `<meta property="og:image" content="${ogImage}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${c.t('hero.slogan')}">`,
    `<meta property="og:locale" content="${loc.og}">`,
    L.filter(l => l !== loc).map(l => `<meta property="og:locale:alternate" content="${l.og}">`).join('\n'),
    meta.published ? `<meta property="article:published_time" content="${meta.published}">` : '',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(meta.ogTitle || meta.title)}">`,
    `<meta name="twitter:description" content="${esc(meta.description)}">`,
    `<meta name="twitter:image" content="${ogImage}">`,
    `<link rel="icon" href="${c.asset('assets/favicon.svg')}" type="image/svg+xml">`,
    `<link rel="icon" href="${c.asset('assets/favicon-32.png')}" sizes="32x32" type="image/png">`,
    `<link rel="apple-touch-icon" href="${c.asset('assets/apple-touch-icon.png')}">`,
    `<link rel="manifest" href="${site.BASE}manifest.webmanifest">`,
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    isHome ? '<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>' : '',
    `<link rel="stylesheet" href="${FONTS}${loc.cjkFont ? `&family=${loc.cjkFont}:wght@400;500;700;900` : ''}&display=swap">`,
    `<link rel="stylesheet" href="${c.asset('css/site.css')}">`,
    isHome ? `<script src="${THREE}" defer crossorigin="anonymous"></script>\n<script src="${c.asset('js/swarm.js')}" defer></script>` : '',
    `<script src="${c.asset('js/site.js')}" defer></script>`,
    scripts.map(s => `<script src="${c.asset(`js/${s}.js`)}" defer></script>`).join('\n'),
    jsonScript(i18n, 'type="application/json" id="i18n"'),
    ld.map(o => jsonScript(o, 'type="application/ld+json"')).join('\n'),
    mod.head ? mod.head(c) : '',
  ].filter(Boolean).join('\n');

  const nav = [['products', 'products/'], ['research', 'research/'], ['blog', 'blog/'], ['about', 'about/']]
    .map(([k, p]) => `<a href="${c.url(p)}"${mod.nav === k ? ' aria-current="page"' : ''}>${c.t('nav.' + k)}</a>`).join('\n      ');

  return `<!DOCTYPE html>
<html lang="${loc.html}">
<head>
${head}
</head>
<body data-view="${mod.view}">
<a class="skip" href="#main-content">${c.t('skip')}</a>
<div class="cols" aria-hidden="true"><div class="wrap"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div>

<header class="top" id="top">
  <div class="wrap">
    <a class="brand" href="${c.url('')}" aria-label="${c.t('brand.home_aria')}">${MARK}IRAI</a>
    <nav class="nav" id="siteNav" aria-label="${c.t('nav.label')}">
      ${nav}
      <a href="${c.url('contact/')}" class="cta"${mod.nav === 'contact' ? ' aria-current="page"' : ''}>${c.t('cta.audit')}</a>
    </nav>
    <details class="langs">
      <summary><span class="sr">${c.t('lang.label')}: </span>${loc.short}</summary>
      <ul>${langLinks(c, page.langPath ?? page.path)}</ul>
    </details>
    <button class="menu-btn" id="menuBtn" type="button" aria-expanded="false" aria-controls="siteNav">${c.t('nav.menu')}</button>
  </div>
</header>

<main id="main-content" tabindex="-1">
${mod.body(c)}
</main>

<footer class="foot">
  <div class="wrap">
    <div class="logotype" aria-hidden="true">
${LOGOTYPE}
    </div>
    <div class="foot-grid">
      <div class="foot-about">
        <a class="brand" href="${c.url('')}">${MARK}IRAI</a>
        <p>${c.t('foot.about')}</p>
        <p class="door" id="door" data-door="open"><span class="open">${c.t('foot.door_open')}</span><span class="closed">${c.t('foot.door_sealed')}</span></p>
        <p class="door-note">${c.t('foot.door_note')}</p>
      </div>
      <div><h2 class="foot-h">${c.t('foot.site')}</h2><ul><li><a href="${c.url('products/')}">${c.t('nav.products')}</a></li><li><a href="${c.url('research/')}">${c.t('nav.research')}</a></li><li><a href="${c.url('blog/')}">${c.t('nav.blog')}</a></li></ul></div>
      <div><h2 class="foot-h">${c.t('foot.company')}</h2><ul><li><a href="${c.url('about/')}">${c.t('nav.about')}</a></li><li><a href="${c.url('contact/')}">${c.t('nav.contact')}</a></li><li><a class="mail" href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></li><li><a href="${PAPER_URL}">${c.t('foot.paper')}</a></li></ul></div>
    </div>
    <nav class="foot-langs" aria-label="${c.t('lang.label')}"><ul>${langLinks(c, page.langPath ?? page.path)}</ul></nav>
  </div>
  <div class="fine"><div class="wrap"><span>${c.t('foot.fine')}</span></div></div>
</footer>
</body>
</html>
`;
}
