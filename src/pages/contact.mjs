import { CONTACT_EMAIL, TOPICS } from '../site.mjs';

const mail = `<a class="mail" href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`;

export default {
  view: 'contact',
  nav: 'contact',
  scripts: ['contact'],
  jsKeys: ['contact.'],
  i18nExtra: () => ({ email: CONTACT_EMAIL }),
  meta: c => ({ title: c.raw('contact.meta_title'), description: c.raw('contact.meta_desc') }),
  crumbs: c => [{ name: c.raw('nav.contact'), path: 'contact/' }],
  body: c => `
<div class="wrap page-head">
  <h1>${c.t('contact.h1')}</h1>
  <p class="measure lede">${c.t('contact.lede')}</p>
</div>
<section class="band tight flush">
  <div class="wrap g12">
    <div class="col-form stack" style="--gap:24px">
      <p class="note" id="contactNote">${c.t('contact.note', { email: mail })}</p>
      <form class="panel frame" id="contactForm" novalidate>
        <div class="form-grid">
          <div class="field"><label for="cName">${c.t('contact.label_name')}</label><input type="text" id="cName" maxlength="120" autocomplete="name" required></div>
          <div class="field"><label for="cEmail">${c.t('contact.label_email')}</label><input type="email" id="cEmail" maxlength="160" autocomplete="email" required></div>
          <div class="field"><label for="cOrg">${c.t('contact.label_org')}</label><input type="text" id="cOrg" maxlength="160" autocomplete="organization"></div>
          <div class="field"><label for="cTopic">${c.t('contact.label_topic')}</label><select id="cTopic">${TOPICS.map(t => `<option value="${t.id}">${t.label || c.t(t.key)}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label for="cBody">${c.t('contact.label_body')}</label><textarea id="cBody" maxlength="4000" required></textarea></div>
        <p class="note err" id="cErr" role="alert" hidden></p>
        <div class="form-actions"><button class="btn btn-primary" type="submit" id="cSubmit">${c.t('contact.send')}</button><button class="btn btn-ghost" type="button" id="cCopy">${c.t('contact.copy')}</button></div>
      </form>
      <div class="panel frame" id="contactDone" hidden tabindex="-1">
        <h2 class="panel-h">${c.t('contact.done_h')}</h2>
        <p>${c.t('contact.done_p', { email: mail })}</p>
        <p id="cDoneCut" hidden>${c.t('contact.done_cut')}</p>
        <div class="form-actions"><button class="btn btn-ghost" type="button" id="cAgain">${c.t('contact.again')}</button><button class="btn btn-ghost" type="button" id="cCopyDone">${c.t('contact.copy')}</button></div>
      </div>
    </div>
    <div class="col-aside aside stack" style="--gap:28px">
      <div><h2 class="aside-h">${c.t('contact.aside_audit_h')}</h2><p>${c.t('contact.aside_audit_p')}</p></div>
      <div><h2 class="aside-h">${c.t('contact.aside_research_h')}</h2><p>${c.t('contact.aside_research_p')}</p></div>
    </div>
  </div>
</section>`,
};
