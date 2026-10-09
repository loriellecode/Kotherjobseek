'use strict';
/* Adzuna Jobs API (https://developer.adzuna.com/). Requires ADZUNA_APP_ID and ADZUNA_APP_KEY.
 * Endpoint shape: GET {base}/jobs/{country}/search/{page}?app_id=&app_key=&what=&where=&distance=&results_per_page=&sort_by=&max_days_old=
 * `distance` is expressed in kilometres by Adzuna.  NOTE: the Adzuna docs site was unreachable from the build
 * environment; field names below follow Adzuna's published response format and must be confirmed with a live key. */
const config = require('../config');
const { fetchJson, ProviderError } = require('./util');

const cfg = () => config.providers.adzuna;
const KM_PER_MILE = 1.609344;

module.exports = {
  id: 'adzuna', name: 'Adzuna', kind: 'api', docs: 'https://developer.adzuna.com/',
  setup: ['Create a free account and application at https://developer.adzuna.com/signup', 'Copy the Application ID and Application Key', 'Set ADZUNA_APP_ID and ADZUNA_APP_KEY in the server environment, then restart'],
  budget: () => cfg().dailyBudget,
  configured() { const missing = []; if (!cfg().appId) missing.push('ADZUNA_APP_ID'); if (!cfg().appKey) missing.push('ADZUNA_APP_KEY'); return { ok: !missing.length, missing }; },
  plan(q) { return q; },
  async search(query, { maxPages = 2, pageSize = 50 } = {}) {
    const out = []; let total = null;
    for (let page = 1; page <= maxPages; page++) {
      const p = new URLSearchParams({ app_id: cfg().appId, app_key: cfg().appKey, results_per_page: String(pageSize), what: query.what, sort_by: 'date', max_days_old: String(query.maxDaysOld || 30), 'content-type': 'application/json' });
      if (query.where) { p.set('where', query.where); if (query.radiusMiles) p.set('distance', String(Math.max(1, Math.round(query.radiusMiles * KM_PER_MILE)))); }
      const url = `${cfg().base}/jobs/${cfg().country}/search/${page}?${p}`;
      const data = await fetchJson(url, { redact: [cfg().appId, cfg().appKey], provider: 'Adzuna' });
      if (!data || !Array.isArray(data.results)) throw new ProviderError('Adzuna returned an unexpected response format.');
      total = data.count ?? total;
      for (const r of data.results) { const m = map(r); if (m) out.push(m); }
      if (data.results.length < pageSize) break;
    }
    return { listings: out, total };
  },
};

function map(r) {
  if (!r || r.id === undefined || !r.title) return null;
  const area = (r.location && r.location.area) || [];
  const loc = (r.location && r.location.display_name) || '';
  const city = area.length >= 4 ? area[area.length - 1] : (loc.split(',')[0] || '').trim() || null;
  const ct = `${r.contract_time || ''} ${r.contract_type || ''}`;
  return {
    externalId: String(r.id), title: r.title, employer: (r.company && r.company.display_name) || '', locationText: loc, city, state: area[1] || null, lat: r.latitude, lon: r.longitude,
    salaryMin: r.salary_min, salaryMax: r.salary_max, salaryPeriod: 'year', salaryEstimated: String(r.salary_is_predicted) === '1', type: ct, description: r.description || '',
    applyUrl: r.redirect_url, published: r.created, categoryHint: r.category && r.category.label,
  };
}
module.exports._map = map;
