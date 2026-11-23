// Languages, in switcher order. `code` names the locale file (i18n/<code>.json) and the URL prefix
// (English lives at the root). `html` is the <html lang>, `hreflang` the alternate-link code,
// `og` the Open Graph locale, `name` the endonym shown in the switcher, `short` the compact label.
export const LOCALES = [
  { code: 'en', prefix: '', html: 'en', hreflang: 'en', og: 'en_US', name: 'English', short: 'EN' },
  { code: 'pt', prefix: 'pt', html: 'pt-BR', hreflang: 'pt-BR', og: 'pt_BR', name: 'Português', short: 'PT' },
  { code: 'fr', prefix: 'fr', html: 'fr', hreflang: 'fr', og: 'fr_FR', name: 'Français', short: 'FR' },
  { code: 'es', prefix: 'es', html: 'es', hreflang: 'es', og: 'es_ES', name: 'Español', short: 'ES' },
  { code: 'de', prefix: 'de', html: 'de', hreflang: 'de', og: 'de_DE', name: 'Deutsch', short: 'DE' },
  { code: 'zh', prefix: 'zh', html: 'zh-Hans', hreflang: 'zh-Hans', og: 'zh_CN', name: '中文', short: '中文', cjkFont: 'Noto+Sans+SC' },
  { code: 'ja', prefix: 'ja', html: 'ja', hreflang: 'ja', og: 'ja_JP', name: '日本語', short: '日本語', cjkFont: 'Noto+Sans+JP' },
];

export const CONTACT_EMAIL = 'daniel.sant.salles@gmail.com';
export const GITHUB_REPO = 'https://github.com/Martoto/irai';
export const PAPER_URL = 'https://aisel.aisnet.org/amcis2026/ai_aiaa/ai_aiaa/8';

// Contact topics: stable ids (used in ?topic= links and kept out of translation for brand names).
export const TOPICS = [
  { id: 'neff', label: 'Neff Audit' },
  { id: 'society', label: 'Model Society' },
  { id: 'prova', label: 'Prova' },
  { id: 'guarda', label: 'Guarda' },
  { id: 'research', key: 'contact.topic_research' },
  { id: 'press', key: 'contact.topic_press' },
  { id: 'other', key: 'contact.topic_other' },
];

// Strings every page ships to JavaScript (menu button, language suggestion).
export const PAGE_SCRIPTS = { common: ['nav.menu', 'nav.close'] };
