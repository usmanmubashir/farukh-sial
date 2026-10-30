// Translations and direction. Every visible string goes through t(key).
// Switching language does not reload the page: the store notifies the UI.
import enBase from '../i18n/en.js';
import urBase from '../i18n/ur.js';
import enScreens from '../i18n/screens-en.js';
import urScreens from '../i18n/screens-ur.js';
import enDocs from '../i18n/docs-en.js';
import urDocs from '../i18n/docs-ur.js';
import enParties from '../i18n/parties-en.js';
import urParties from '../i18n/parties-ur.js';
import enReports from '../i18n/reports-en.js';
import enSettings from '../i18n/settings-en.js';
import urReports from '../i18n/reports-ur.js';
import urSettings from '../i18n/settings-ur.js';
import enSync from '../i18n/sync-en.js';
import urSync from '../i18n/sync-ur.js';
import enQuality from '../i18n/quality-en.js';
import urQuality from '../i18n/quality-ur.js';
import enDemo from '../i18n/demo-en.js';
import urDemo from '../i18n/demo-ur.js';
import enPractice from '../i18n/practice-en.js';
import urPractice from '../i18n/practice-ur.js';
import enPracticeScreen from '../i18n/practice-screen-en.js';
import urPracticeScreen from '../i18n/practice-screen-ur.js';
import * as store from './store.js';

// Screen strings override the base dictionaries with the same key.
const en = { ...enBase, ...enScreens, ...enDocs, ...enParties, ...enReports, ...enSettings, ...enSync, ...enQuality, ...enDemo, ...enPractice, ...enPracticeScreen };
const ur = { ...urBase, ...urScreens, ...urDocs, ...urParties, ...urReports, ...urSettings, ...urSync, ...urQuality, ...urDemo, ...urPractice, ...urPracticeScreen };
const DICTIONARIES = { en, ur };
const RTL_LANGS = ['ur', 'ar', 'fa'];
const STORAGE_KEY = 'shifa.lang';
const warned = new Set();

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ur', label: 'اردو' },
];

/** t('key') or t('key', { name: 'x' }) for "{name}" placeholders. Falls back to English, then to the key. */
export function t(key, vars) {
  const lang = store.get('lang');
  let text = DICTIONARIES[lang]?.[key] ?? en[key];
  if (text === undefined) {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[i18n] missing key "${key}"`);
    }
    return key;
  }
  if (vars) {
    text = text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
  }
  return text;
}

export function isRtl(lang = store.get('lang')) {
  return RTL_LANGS.includes(lang);
}

function applyDirection(lang) {
  const root = document.documentElement;
  root.lang = lang;
  root.dir = isRtl(lang) ? 'rtl' : 'ltr';
}

/**
 * Translates static markup:
 *   data-i18n="key"                  sets textContent (element must not contain other markup)
 *   data-i18n-attr="aria-label:key"  sets attributes, several separated by ";"
 */
export function apply(root = document) {
  const scope = root?.jquery ? root[0] : root;
  scope.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  scope.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    el.dataset.i18nAttr.split(';').forEach((pair) => {
      const at = pair.indexOf(':');
      if (at < 1) return;
      el.setAttribute(pair.slice(0, at).trim(), t(pair.slice(at + 1).trim()));
    });
  });
}

export function setLang(lang) {
  if (!DICTIONARIES[lang]) throw new RangeError(`Unsupported language "${lang}"`);
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage blocked: the choice lasts for this visit only */
  }
  store.set('lang', lang);
  applyDirection(lang);
  apply(document);
}

/** Reads the saved language (default English). Call once at boot, before rendering. */
export function init() {
  let saved = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  const lang = DICTIONARIES[saved] ? saved : 'en';
  store.set('lang', lang);
  applyDirection(lang);
}
