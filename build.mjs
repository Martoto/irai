#!/usr/bin/env node
// Static site build: templates (src/) + locale content (i18n/, content/) -> dist/.
// Zero dependencies, Node >= 20. Usage: node build.mjs   (env SITE_URL overrides the public URL)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LOCALES, PAGE_SCRIPTS } from './src/site.mjs';
import { makeContext } from './src/context.mjs';
import { layout } from './src/layout.mjs';
import home from './src/pages/home.mjs';
import products from './src/pages/products.mjs';
import research from './src/pages/research.mjs';
import blog from './src/pages/blog.mjs';
import post from './src/pages/post.mjs';
import contact from './src/pages/contact.mjs';
import about from './src/pages/about.mjs';
import notFound from './src/pages/notfound.mjs';

/* ---- the one place the public address lives; the base path (/irai/) is derived from it ---- */
const SITE_URL = (process.env.SITE_URL || 'https://martoto.github.io/irai').replace(/\/+$/, '');
const BASE = new URL(SITE_URL + '/').pathname; // '/irai/'
const ORIGIN = new URL(SITE_URL).origin;

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
/* the site is written next to dist/ and swapped in at the end, so a server reading dist/ never sees a half-built site */
const OUT = path.join(ROOT, `dist.tmp-${process.pid}`);
process.on('exit', () => fs.rmSync(OUT, { recursive: true, force: true })); // a failed build leaves dist/ as it was
const STATIC_DIRS = ['css', 'js', 'assets'];

const fail = msgs => { console.error('\nBuild failed:\n  ' + msgs.join('\n  ') + '\n'); process.exit(1); };
const readJSON = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

/* ---------------- content ---------------- */
const POSTS = readJSON('content/posts.json');
const placeholders = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
const tags = s => [...s.matchAll(/<\/?([a-zA-Z][\w-]*)/g)].map(m => m[0]).sort().join(',');
const hrefs = s => [...s.matchAll(/href="([^"]*)"/g)].map(m => m[1]).sort().join(',');
const PLURAL_EXTRA = /\.(zero|two|few|many)$/;

function loadLocale(code) {
  const strings = readJSON(`i18n/${code}.json`);
  const posts = {};
  for (const p of POSTS) {
    const f = path.join(ROOT, 'i18n', code, 'posts', p.slug + '.html');
    posts[p.slug] = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : null;
  }
  return { strings, posts };
}

const content = Object.fromEntries(LOCALES.map(l => [l.code, loadLocale(l.code)]));
{
  const en = content.en, errors = [];
  const markupCheck = (where, a, b) => {
    if (placeholders(a) !== placeholders(b)) errors.push(`${where}: placeholders differ from en ({${placeholders(b)}} vs en {${placeholders(a)}})`);
    if (tags(a) !== tags(b)) errors.push(`${where}: HTML tags differ from en`);
    if (hrefs(a) !== hrefs(b)) errors.push(`${where}: link targets differ from en`);
  };
  for (const l of LOCALES) {
    if (l.code === 'en') continue;
    const { strings, posts } = content[l.code];
    for (const k of Object.keys(en.strings)) {
      if (k.startsWith('_')) continue;
      if (!(k in strings)) { errors.push(`${l.code}.json: missing key "${k}"`); continue; }
      if (typeof strings[k] !== 'string' || !strings[k].trim()) { errors.push(`${l.code}.json: empty key "${k}"`); continue; }
      markupCheck(`${l.code}.json "${k}"`, en.strings[k], strings[k]);
    }
    for (const k of Object.keys(strings)) {
      if (k.startsWith('_') || k in en.strings) continue;
      const base = k.replace(PLURAL_EXTRA, '');
      if (base !== k && (base + '.other') in en.strings) continue; // extra plural category
      errors.push(`${l.code}.json: unknown key "${k}" (not in en.json)`);
    }
    for (const p of POSTS) {
      if (posts[p.slug] == null) errors.push(`i18n/${l.code}/posts/${p.slug}.html: missing`);
      else markupCheck(`i18n/${l.code}/posts/${p.slug}.html`, en.posts[p.slug], posts[p.slug]);
    }
  }
  if (errors.length) fail(errors);
  const pending = LOCALES.filter(l => content[l.code].strings._status === 'untranslated').map(l => l.code);
  if (pending.length) console.warn(`warning: locales still untranslated (copies of English): ${pending.join(', ')}`);
}

/* ---------------- static files, fingerprinted ---------------- */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const versions = {};
for (const dir of STATIC_DIRS) {
  for (const f of fs.readdirSync(path.join(ROOT, dir), { recursive: true })) {
    const src = path.join(ROOT, dir, f);
    if (fs.statSync(src).isDirectory()) continue;
    const rel = `${dir}/${f.split(path.sep).join('/')}`;
    const buf = fs.readFileSync(src);
    versions[rel] = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
    fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true });
    fs.writeFileSync(path.join(OUT, rel), buf);
  }
}

/* ---------------- pages ---------------- */
const LASTMOD = (() => {
  try { return execFileSync('git', ['log', '-1', '--format=%cs'], { cwd: ROOT, encoding: 'utf8' }).trim(); }
  catch { return new Date().toISOString().slice(0, 10); }
})();
const PAGES = [
  { module: home, path: '' },
  { module: products, path: 'products/' },
  { module: research, path: 'research/' },
  { module: blog, path: 'blog/' },
  ...POSTS.map(p => ({ module: post, path: `blog/${p.slug}/`, post: p, lastmod: p.date })),
  { module: contact, path: 'contact/' },
  { module: about, path: 'about/' },
];
const site = { SITE_URL, BASE, ORIGIN, LOCALES, POSTS, PAGE_SCRIPTS, versions, content, LASTMOD };
const usedKeys = new Set();
let count = 0;
for (const page of PAGES) {
  for (const loc of LOCALES) {
    const c = makeContext(site, loc, page, usedKeys);
    const html = layout(c, page.module);
    const file = path.join(OUT, c.localePrefix, page.path, 'index.html');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, html);
    count++;
  }
}
{ // one 404.html at the site root (GitHub Pages serves only that one); it localises itself from the URL prefix
  const page = { module: notFound, path: '404.html', langPath: '', noindex: true };
  const c = makeContext(site, LOCALES[0], page, usedKeys);
  fs.writeFileSync(path.join(OUT, '404.html'), layout(c, notFound));
  count++;
}
for (const k of ['lang.suggest_text', 'lang.suggest_link', 'lang.suggest_dismiss']) usedKeys.add(k); // read straight from the locale files by layout.mjs
const unused = Object.keys(content.en.strings).filter(k => !k.startsWith('_') && !usedKeys.has(k));
if (unused.length) console.warn('warning: en.json keys not used by any page: ' + unused.join(', '));

/* ---------------- sitemap, robots, manifest ---------------- */
const abs = p => ORIGIN + p;
const urlFor = (loc, p) => BASE + (loc.prefix ? loc.prefix + '/' : '') + p;
let sm = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';
for (const page of PAGES) {
  const alts = LOCALES.map(l => `    <xhtml:link rel="alternate" hreflang="${l.hreflang}" href="${abs(urlFor(l, page.path))}"/>`)
    .concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${abs(urlFor(LOCALES[0], page.path))}"/>`).join('\n');
  for (const l of LOCALES) sm += `  <url>\n    <loc>${abs(urlFor(l, page.path))}</loc>\n    <lastmod>${page.lastmod || LASTMOD}</lastmod>\n${alts}\n  </url>\n`;
}
sm += '</urlset>\n';
fs.writeFileSync(path.join(OUT, 'sitemap.xml'), sm);
fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
fs.writeFileSync(path.join(OUT, 'manifest.webmanifest'), JSON.stringify({
  name: 'IRAI', short_name: 'IRAI', start_url: BASE, scope: BASE, display: 'browser',
  background_color: '#05060A', theme_color: '#05060A',
  icons: [192, 512].map(s => ({ src: `${BASE}assets/icon-${s}.png?v=${versions[`assets/icon-${s}.png`]}`, sizes: `${s}x${s}`, type: 'image/png' })),
}, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const OLD = path.join(ROOT, `dist.old-${process.pid}`);
if (fs.existsSync(DIST)) fs.renameSync(DIST, OLD);
fs.renameSync(OUT, DIST);
fs.rmSync(OLD, { recursive: true, force: true });

console.log(`built ${count} pages in ${LOCALES.length} languages -> ${path.relative(process.cwd(), DIST) || '.'}/ (${SITE_URL}/)`);
