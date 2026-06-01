'use strict';
const fs   = require('fs');
const path = require('path');

const I18N_PATH = path.join(__dirname, '..', 'public', 'js', 'i18n.js');
const REF_LANG  = 'fr';
const LANGS     = ['fr','en','es','de','pt','it','zh','ja','ko','id','ar','th','tr','nl','ru','pl','vi','hi','pt-BR','uk'];

function extractKeys(content, lang) {
  const marker = lang === 'pt-BR' ? `  'pt-BR': {` : `  ${lang}: {`;
  const start = content.indexOf(marker);
  if (start === -1) return null;

  // Slice up to the next top-level language block
  const afterStart = start + marker.length;
  const nextLang = /\n  (?:'pt-BR'|[a-z]{2}): \{/g;
  nextLang.lastIndex = afterStart;
  const next = nextLang.exec(content);
  const block = next ? content.slice(start, next.index) : content.slice(start);

  const keys = [];
  const re = /^    ([a-z_0-9]+):/mg;
  let m;
  while ((m = re.exec(block)) !== null) keys.push(m[1]);
  return keys;
}

function checkI18n() {
  const content = fs.readFileSync(I18N_PATH, 'utf8');
  const refKeys = extractKeys(content, REF_LANG);
  if (!refKeys) return { error: `Language '${REF_LANG}' not found in i18n file` };

  const detail  = {};
  const issues  = [];

  for (const lang of LANGS) {
    if (lang === REF_LANG) {
      detail[lang] = { keyCount: refKeys.length, missing: [], ok: true };
      continue;
    }
    const keys = extractKeys(content, lang);
    if (!keys) {
      detail[lang] = { keyCount: 0, missing: refKeys.slice(), ok: false };
      issues.push({ lang, missingCount: refKeys.length });
      continue;
    }
    const keySet = new Set(keys);
    const missing = refKeys.filter(k => !keySet.has(k));
    detail[lang] = { keyCount: keys.length, missing, ok: missing.length === 0 };
    if (missing.length > 0) issues.push({ lang, missingCount: missing.length, missing });
  }

  return {
    refLang:       REF_LANG,
    refKeyCount:   refKeys.length,
    totalLangs:    LANGS.length,
    langsOk:       Object.values(detail).filter(r => r.ok).length,
    langsWithIssues: issues.length,
    issues,
    detail,
    checkedAt:     new Date().toISOString(),
  };
}

module.exports = { checkI18n };
