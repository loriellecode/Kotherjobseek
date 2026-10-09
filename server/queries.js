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

function titleTerms(profile) {
  const out = [], seen = new Set();
  const add = (t) => { const s = String(t || '').trim(); const k = KJ.norm(s); if (s && k.length > 2 && !seen.has(k)) { seen.add(k); out.push(s); } };
  (profile.titles || []).forEach(add);
  (profile.experience || []).slice(-4).reverse().forEach((e) => add(e.title));
  (profile.education || []).forEach((e) => { if (e.field && e.status !== 'in progress') add(e.field); });
  const lists = (profile.categories || []).map((c) => CATEGORY_TITLES[c] || []);
  for (let i = 0; lists.some((l) => i < l.length); i++) lists.forEach((l) => l[i] && add(l[i]));
  return out;
}

/* -> [{ key, what, where, radiusMiles, remote }] */
function planSearches(profile, provider, cap) {
  cap = cap || config.maxQueriesPerScan;
  if (provider.queriesFor) return provider.queriesFor().slice(0, cap);
  const titles = titleTerms(profile), cities = (profile.cities || []).slice(0, 4), q = [];
  const radius = Math.max(5, Math.min(100, Number(profile.commuteMiles) || 30));
  const modes = profile.workModes || ['onsite'];
  const wantsOnsite = modes.includes('onsite') || modes.includes('hybrid') || !modes.length;
  const wantsRemote = modes.includes('remote');
  const perCity = cities.length ? Math.max(2, Math.floor((wantsRemote ? cap * 0.75 : cap) / cities.length)) : 0;
  if (wantsOnsite || !wantsRemote) for (const city of cities) titles.slice(0, perCity).forEach((t) => q.push({ what: t, where: city.replace(/,?\s*(CA|California)$/i, ', CA'), radiusMiles: radius, remote: false }));
  if (wantsRemote) titles.slice(0, Math.max(3, cap - q.length)).forEach((t) => q.push({ what: `${t} remote`, where: 'California', radiusMiles: 0, remote: true }));
  return q.slice(0, cap).map((x) => Object.assign(x, { key: [KJ.norm(x.what), KJ.norm(x.where), x.radiusMiles].join('|') }));
}
module.exports = { planSearches, titleTerms, CATEGORY_TITLES };
