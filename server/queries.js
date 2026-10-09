'use strict';
/* Derive provider search queries from the profile. Only job titles, categories and city names are sent to
 * providers — never the user's name, email, résumé text, employers, or other personal details. */
const KJ = require('../shared/match');
const config = require('./config');

const CATEGORY_TITLES = {
  Finance: ['financial analyst', 'budget analyst', 'accountant', 'finance manager', 'banking'],
  Business: ['business analyst', 'operations manager', 'business administration', 'program manager'],
  Education: ['assistant principal', 'education program coordinator', 'school business manager', 'curriculum', 'education administrator'],
  'Special Education': ['special education teacher', 'education specialist', 'special education program', 'behavior specialist'],
};

function titleTerms(profile, careers) {
  const out = [], seen = new Set();
  const add = (t) => { const s = String(t || '').trim(); const k = KJ.norm(s); if (s && k.length > 2 && !seen.has(k)) { seen.add(k); out.push(s); } };
  (profile.titles || []).forEach(add);
  (profile.experience || []).slice(-4).reverse().forEach((e) => add(e.title));
  ((careers && careers.searchTerms) || []).forEach(add); // adjacent careers supported by the profile (see careers.js)
  const lists = (profile.categories || []).map((c) => CATEGORY_TITLES[c] || []);
  for (let i = 0; lists.some((l) => i < l.length); i++) lists.forEach((l) => l[i] && add(l[i]));
  // A bare degree field ("Finance") is a weak query, so it comes after real job titles.
  (profile.education || []).forEach((e) => { const f = (e.field || '').trim(); if (f && e.status !== 'in progress' && f.split(/\s+/).length <= 3) add(f); });
  return out;
}

/* -> [{ key, what, where, radiusMiles, remote }] */
function planSearches(profile, provider, cap, careers) {
  cap = cap || config.maxQueriesPerScan;
  if (provider.queriesFor) return provider.queriesFor().slice(0, cap);
  const titles = titleTerms(profile, careers), q = [];
  const seenCity = new Set(), cities = (profile.cities || []).filter((c) => { const k = KJ.cityOnly(c); if (!k || seenCity.has(k)) return false; seenCity.add(k); return true; }).slice(0, 5); // "North Stockton" and "Stockton" are one search
  const radius = Math.max(5, Math.min(100, Number(profile.commuteMiles) || 30));
  const modes = profile.workModes || ['onsite'];
  const wantsOnsite = modes.includes('onsite') || modes.includes('hybrid') || !modes.length;
  const wantsRemote = modes.includes('remote');
  const share = (wantsRemote ? 0.6 : 1) * (profile.statewide ? 0.75 : 1);
  const perCity = cities.length ? Math.max(2, Math.floor((cap * share) / cities.length)) : 0;
  if (wantsOnsite || !wantsRemote) for (const city of cities) titles.slice(0, perCity).forEach((t) => q.push({ what: t, where: city.replace(/,?\s*(CA|California)$/i, ', CA'), radiusMiles: radius, remote: false }));
  if (profile.statewide) titles.slice(0, Math.max(3, Math.floor(cap * 0.2))).forEach((t) => q.push({ what: t, where: 'California', radiusMiles: 0, remote: false }));
  if (wantsRemote) titles.slice(0, Math.max(3, cap - q.length)).forEach((t) => q.push({ what: `${t} remote`, where: 'California', radiusMiles: 0, remote: true }));
  return q.slice(0, cap).map((x) => Object.assign(x, { key: [KJ.norm(x.what), KJ.norm(x.where), x.radiusMiles].join('|') }));
}
module.exports = { planSearches, titleTerms, CATEGORY_TITLES };
