'use strict';
/* Convert provider listings into the internal job shape. Unknown stays unknown: nothing is invented.
 * Requirements detected from free text are flagged `inferred` so the UI can say so. */
const crypto = require('node:crypto');
const KJ = require('../shared/match');
const { classify: classifyLink } = require('./linkSafety');
const { detectEmailApply } = require('./emailEngine');

const str = (v, max) => { const s = v === undefined || v === null ? '' : String(v).trim(); return max ? s.slice(0, max) : s; };
const numOrNull = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
const isoDate = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d.toISOString().slice(0, 10); };

function htmlToText(html) {
  return String(html || '').replace(/<\s*(br|\/p|\/li|\/div|\/h\d)\s*\/?>/gi, '\n').replace(/<li[^>]*>/gi, '• ').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeUrl(u) {
  try {
    const url = new URL(u); url.hash = '';
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|gclid|fbclid|ref$|source$|src$)/i.test(k)) url.searchParams.delete(k);
    return (url.hostname.toLowerCase() + url.pathname.replace(/\/+$/, '') + url.search).toLowerCase();
  } catch (_) { return null; }
}
const fingerprint = (title, employer, city, remote) => crypto.createHash('sha1').update([KJ.norm(title), KJ.norm(employer), remote ? 'remote' : KJ.cityOnly(city || '')].join('|')).digest('hex');

/* ---- requirement extraction from text (heuristic; always flagged inferred) ---- */
const PREF = /\b(prefer|preferred|desired|desirable|a plus|nice to have|ideally|ideal candidate|bonus|advantageous)\b/i;
const EDU_PATTERNS = [['doctorate', /\b(doctorate|ph\.?\s?d\.?|doctoral)\b/i], ['master', /\b(master'?s|m\.?s\.?\b|m\.?a\.?\b|mba)\b/i], ['bachelor', /\b(bachelor'?s?|b\.?s\.?\b|b\.?a\.?\b|four[- ]year degree|4[- ]year degree)\b/i], ['associate', /\b(associate'?s?|a\.?a\.?\b|two[- ]year degree)\b/i], ['high school', /\b(high school (diploma|graduate)|ged)\b/i]];
const CERT_PATTERNS = [
  /\b(preliminary |clear |professional )?(education specialist|multiple subject|single subject|administrative services|pupil personnel services|school counselor|teaching|special education)( instruction(al)?)?( \(?[a-z/ -]{0,30}\)?)? (credential|authorization)\b/i,
  /\bcertified public accountant\b|\bCPA\b/, /\bCBEST\b|\bCSET\b/, /\bBCBA\b|board certified behavior analyst/i, /\bCFA\b|chartered financial analyst/i, /\bPMP\b/, /\b(notary public)\b/i,
  /\bvalid california [a-z ]{3,40}(credential|license|certificate|certification)\b/i,
];
function splitSentences(text) { return String(text || '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 3); }
function guessField(s) {
  const n = KJ.norm(s); let best = null, bestHits = 0;
  for (const [cat, words] of Object.entries(KJ.FIELD_WORDS)) { const hits = words.filter((w) => n.includes(w)).length; if (hits > bestHits) { best = cat; bestHits = hits; } }
  return best;
}
function extractRequirements(text) {
  const out = { education: null, experience: null, certs: [] };
  for (const s of splitSentences(text).slice(0, 80)) {
    const preferred = PREF.test(s);
    if (!out.education || (out.education.preferred && !preferred)) for (const [level, re] of EDU_PATTERNS) if (re.test(s) && /\b(degree|diploma|ged|graduate|bachelor|master|associate|doctorate|required|education)\b/i.test(s)) { out.education = { level, preferred, inferred: true }; break; }
    const m = s.match(/\b(\d{1,2})\s*\+?\s*(?:or more\s*)?(?:years?|yrs?)\b[^.]{0,60}?\bexperience\b/i);
    if (m && (!out.experience || (out.experience.preferred && !preferred))) out.experience = { years: Number(m[1]), field: guessField(s), preferred, inferred: true };
    for (const re of CERT_PATTERNS) { const c = s.match(re); if (c) { const name = c[0].replace(/\s+/g, ' ').trim(); if (!out.certs.some((x) => KJ.norm(x.name) === KJ.norm(name))) out.certs.push({ name, required: !preferred, inferred: true }); } }
  }
  return out;
}
function deriveCategories(title, text) {
  const t = KJ.norm(title), d = KJ.norm(String(text || '').slice(0, 1800)), out = [];
  for (const cat of KJ.CATEGORIES) {
    const words = KJ.FIELD_WORDS[cat]; let score = 0;
    for (const w of words) { if (t.includes(w)) score += 3; if (d.includes(w)) score += 1; }
    if (score >= 3) out.push([cat, score]);
  }
  out.sort((a, b) => b[1] - a[1]);
  let cats = out.map((x) => x[0]);
  if (cats.includes('Special Education') && !cats.includes('Education')) cats.push('Education');
  return cats.slice(0, 3);
}
function detectArrangement(title, locationText, text) {
  const head = `${title} ${locationText}`.toLowerCase(), body = String(text || '').toLowerCase();
  if (/\b(remote|work from home|telecommut|telework)\b/.test(head) && !/\b(not|no) remote\b/.test(head)) return { remote: true, arrangement: 'Remote' };
  if (/(fully|100%|this (is a|position is)) remote\b|work from home position|remote position/.test(body)) return { remote: true, arrangement: 'Remote' };
  if (/\bhybrid\b/.test(head) || /\bhybrid (schedule|work|position|role|model)\b/.test(body)) return { remote: false, arrangement: 'Hybrid' };
  return { remote: false, arrangement: null };
}
function mapType(s) {
  const t = KJ.norm(s);
  if (!t) return null;
  if (/part time/.test(t)) return 'Part-time'; if (/full time|permanent|regular/.test(t)) return 'Full-time';
  if (/contract|temporary|intern|seasonal|per diem/.test(t)) return /temporary|seasonal|per diem/.test(t) ? 'Temporary' : 'Contract';
  return null;
}

/* raw: provider-mapped canonical-ish object. Returns row-ready object or null if unusable. */
function normalizeListing(raw, provider, now) {
  const title = str(raw.title, 200), employer = str(raw.employer, 200), externalId = str(raw.externalId, 200);
  if (!title || !employer || !externalId) return null;
  const description = htmlToText(raw.description).slice(0, 20000);
  const locationText = str(raw.locationText, 200);
  const arr = detectArrangement(title, locationText, description);
  const remote = raw.remote === true ? true : raw.remote === false && raw.arrangement ? false : arr.remote;
  const ext = extractRequirements(description);
  const education = raw.education || (ext.education ? { level: ext.education.level, preferred: ext.education.preferred, inferred: true } : null);
  const experience = raw.experience || (ext.experience ? ext.experience : null);
  const certs = raw.certs && raw.certs.length ? raw.certs : ext.certs;
  const link = str(raw.applyUrl) ? classifyLink(str(raw.applyUrl, 2000), provider, { feedHost: raw.feedHost }) : { url: null, level: null, host: '', notes: [] };
  const applyUrl = link.url; // blocked links are never stored or shown
  const city = str(raw.city, 100) || null;
  return {
    provider, external_id: externalId, fingerprint: fingerprint(title, employer, city || locationText, remote), url_key: applyUrl ? normalizeUrl(raw.canonicalUrl || applyUrl) : null,
    title, employer, city, state: str(raw.state, 40) || null, location_text: locationText || null, neighborhood: str(raw.neighborhood, 100) || null,
    lat: numOrNull(raw.lat), lon: numOrNull(raw.lon), arrangement: raw.arrangement || arr.arrangement, remote: remote ? 1 : 0,
    salary_min: numOrNull(raw.salaryMin), salary_max: numOrNull(raw.salaryMax), salary_period: ['year', 'hour', 'month', 'week'].includes(raw.salaryPeriod) ? raw.salaryPeriod : (numOrNull(raw.salaryMin) !== null || numOrNull(raw.salaryMax) !== null ? 'year' : null),
    salary_estimated: raw.salaryEstimated ? 1 : 0, comp_note: str(raw.compNote, 300) || null, employment_type: mapType(raw.type) || null,
    description, summary: str(raw.summary, 1000) || null,
    required: JSON.stringify((raw.required || []).map((x) => str(x, 200)).filter(Boolean)), preferred: JSON.stringify((raw.preferred || []).map((x) => str(x, 200)).filter(Boolean)),
    edu_level: education ? education.level : null, edu_inferred: education ? (education.inferred ? 1 : 0) : 0, exp_years: experience ? experience.years : null, exp_field: experience ? experience.field || null : null, exp_inferred: experience ? (experience.inferred ? 1 : 0) : 0,
    certs: JSON.stringify(certs || []), categories: JSON.stringify(raw.categories && raw.categories.length ? raw.categories : deriveCategories(title, description + ' ' + (raw.categoryHint || ''))),
    apply_url: applyUrl, link_level: link.level, link_notes: JSON.stringify({ host: link.host, notes: link.notes }), email_apply: (() => { const d = detectEmailApply(description + '\n' + str(raw.summary)); return d ? JSON.stringify(d) : null; })(), logo_url: /^https:\/\//i.test(str(raw.logoUrl)) ? str(raw.logoUrl, 1000) : null, published: isoDate(raw.published), deadline: isoDate(raw.deadline),
    retrieved_at: now, raw_hash: crypto.createHash('sha1').update(JSON.stringify([title, employer, raw.salaryMin, raw.salaryMax, raw.deadline, description.slice(0, 500)])).digest('hex'),
    edu_preferred: education && education.preferred ? 1 : 0, exp_preferred: experience && experience.preferred ? 1 : 0,
  };
}
module.exports = { normalizeListing, normalizeUrl, fingerprint, extractRequirements, deriveCategories, htmlToText, mapType, isoDate };
