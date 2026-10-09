'use strict';
/* Derive provider search queries from the profile. Only job titles, categories and city names are sent to
 * providers — never the user's name, email, résumé text, employers, or other personal details. */
const KJ = require('../shared/match');
const config = require('./config');

const CATEGORY_TITLES = {
  Finance: ['financial analyst', 'budget analyst', 'accountant', 'finance manager', 'banking'],
  Business: ['business analyst', 'operations manager', 'business administration', 'program manager'],
  Education: ['assistant principal', 'education program coordinator', 'school business manager', 'curriculum', 'education administrator'],
  'Workforce Development': ['employment specialist', 'job developer', 'workforce development specialist', 'career counselor', 'case manager'],
  Banking: ['personal banker', 'relationship banker', 'loan processor', 'branch operations'],
  'Special Education': ['special education teacher', 'education specialist', 'special education program', 'behavior specialist'],
};

function titleTerms(profile, careers) {
  const seen = new Set(), clean = (arr) => arr.filter((t) => { const s = String(t || '').trim(), k = KJ.norm(s); if (!s || k.length < 3 || seen.has(k)) return false; seen.add(k); return true; }).map((t) => String(t).trim());
  const own = clean([...(profile.titles || []), ...(profile.experience || []).slice(-4).reverse().map((e) => e.title)]); // what she has asked for / actually done
  const careerT = clean((careers && careers.searchTerms) || []); // adjacent careers her background supports
  const lists = (profile.categories || []).map((c) => CATEGORY_TITLES[c] || []), catT = []; for (let i = 0; lists.some((l) => i < l.length); i++) lists.forEach((l) => l[i] && catT.push(l[i]));
  const cats = clean(catT);
  const fields = clean((profile.education || []).filter((e) => e.field && e.status !== 'in progress' && e.field.trim().split(/\s+/).length <= 3).map((e) => e.field)); // a bare degree field is a weak query, so it goes last
  // Round-robin so no single source (work history vs. stated categories vs. career paths) crowds the others out of the capped plan.
  const out = [], groups = [own, careerT, cats, fields]; for (let i = 0; groups.some((g) => i < g.length); i++) groups.forEach((g) => g[i] && out.push(g[i]));
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
