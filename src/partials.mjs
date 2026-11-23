// Small pieces shared by several pages.

/** blog list row; `h` is the heading level for the title (h2 on the blog index, h3 under a section) */
export function postItem(c, p, h = 'h3') {
  return `<div class="item"><div class="meta"><time datetime="${p.date}">${c.date(p.date)}</time></div><div><${h} class="item-h"><a href="${c.url(`blog/${p.slug}/`)}">${c.t(`post.${p.slug}.title`)}</a></${h}><p>${c.t(`post.${p.slug}.summary`)}</p><div class="sub"><span>${c.p('blog.read_time', p.mins, { n: c.num(p.mins) })}</span></div></div></div>`;
}

/** definition grid from keys <prefix>1.h/.p … <prefix>n.h/.p; `extra[i]` is appended inside item i (1-based) */
export function defs(c, prefix, n, h = 'h3', extra = {}) {
  let out = '';
  for (let i = 1; i <= n; i++) {
    const pk = c.has(`${prefix}${i}.p_html`) ? `${prefix}${i}.p_html` : `${prefix}${i}.p`;
    out += `<div><${h} class="def-h">${c.t(`${prefix}${i}.h`)}</${h}><p>${c.t(pk, extra.vars)}</p>${extra[i] || ''}</div>`;
  }
  return `<div class="defs">${out}</div>`;
}

export const RHO = '<span class="rho">ρ</span>';
export const NEFF_FORMULA = `<p class="formula">N<sub>eff</sub> = N / (1 + (N − 1)${RHO})</p>`;
