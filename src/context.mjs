// Per-page, per-locale template helpers.
export const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

export function makeContext(site, loc, page, usedKeys) {
  const { strings, posts } = site.content[loc.code];
  const prPlural = new Intl.PluralRules(loc.html);
  const where = `[${loc.code}] ${page.path || 'home'}`;

  function lookup(key) {
    if (!(key in strings)) throw new Error(`${where}: no string "${key}"`);
    usedKeys.add(key);
    return strings[key];
  }
  function fill(s, vars, key) {
    return s.replace(/\{(\w+)\}/g, (m, v) => {
      if (!vars || !(v in vars)) throw new Error(`${where}: "${key}" needs a value for {${v}}`);
      return vars[v];
    });
  }
  const pluralKey = (key, n) => {
    for (const k of Object.keys(strings)) if (k.startsWith(key + '.')) usedKeys.add(k);
    const k = `${key}.${prPlural.select(n)}`;
    return k in strings ? k : `${key}.other`;
  };
  const localePrefix = loc.prefix;
  const url = (p = '', l = loc) => site.BASE + (l.prefix ? l.prefix + '/' : '') + p;

  const c = {
    site, loc, page, localePrefix, esc,
    lang: loc.html,
    /** HTML-safe string; `vars` values are inserted as HTML. Keys ending in _html are already HTML. */
    t: (key, vars) => fill(key.endsWith('_html') ? lookup(key) : esc(lookup(key)), vars, key),
    /** plain text (for JSON-LD and scripts); `vars` inserted as text */
    raw: (key, vars) => fill(lookup(key), vars, key),
    /** plural form chosen by Intl.PluralRules for n */
    p: (key, n, vars) => c.t(pluralKey(key, n), vars),
    has: key => key in strings,
    num: (n, opts) => new Intl.NumberFormat(loc.html, opts).format(n),
    date: iso => new Intl.DateTimeFormat(loc.html, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(iso + 'T00:00:00Z')),
    url,
    abs: p => site.ORIGIN + p,
    asset: rel => {
      if (!(rel in site.versions)) throw new Error(`${where}: unknown asset ${rel}`);
      return `${site.BASE}${rel}?v=${site.versions[rel]}`;
    },
    postBody: slug => fill(posts[slug], { rho: '<span class="rho">ρ</span>', neff: 'N<sub>eff</sub>' }, `posts/${slug}`),
    /** the strings a page's scripts need, by exact key or by "prefix." */
    jsStrings: wanted => {
      const out = {};
      for (const k of Object.keys(strings)) {
        if (k.startsWith('_')) continue;
        if (wanted.some(w => (w.endsWith('.') ? k.startsWith(w) : k === w || k.startsWith(w + '.')))) { out[k] = strings[k]; usedKeys.add(k); }
      }
      return out;
    },
  };
  return c;
}
