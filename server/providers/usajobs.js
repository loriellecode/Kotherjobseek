'use strict';
/* USAJOBS (federal jobs), https://developer.usajobs.gov/.  Requires USAJOBS_API_KEY and USAJOBS_USER_EMAIL
 * (the registered email is sent as the User-Agent header, as the API requires).
 * Mapping follows the documented Search API response (SearchResult.SearchResultItems[].MatchedObjectDescriptor);
 * confirm against a live key before relying on every field. */
const config = require('../config');
const { fetchJson, ProviderError } = require('./util');
const cfg = () => config.providers.usajobs;

module.exports = {
  id: 'usajobs', name: 'USAJOBS (federal)', kind: 'api', docs: 'https://developer.usajobs.gov/',
  setup: ['Request an API key at https://developer.usajobs.gov/apirequest/', 'Set USAJOBS_API_KEY and USAJOBS_USER_EMAIL (the email you registered with)', 'Restart the server'],
  budget: () => cfg().dailyBudget,
  configured() { const missing = []; if (!cfg().key) missing.push('USAJOBS_API_KEY'); if (!cfg().email) missing.push('USAJOBS_USER_EMAIL'); return { ok: !missing.length, missing }; },
  async search(query, { pageSize = 50 } = {}) {
    const p = new URLSearchParams({ Keyword: query.what, ResultsPerPage: String(pageSize), SortField: 'opendate', SortDirection: 'desc', DatePosted: String(query.maxDaysOld || 30) });
    if (query.where) { p.set('LocationName', query.where); if (query.radiusMiles) p.set('Radius', String(Math.round(query.radiusMiles))); }
    const host = new URL(cfg().base).host;
    const data = await fetchJson(`${cfg().base}/search?${p}`, { headers: { Host: host, 'User-Agent': cfg().email, 'Authorization-Key': cfg().key }, redact: [cfg().key], provider: 'USAJOBS' });
    const items = data && data.SearchResult && data.SearchResult.SearchResultItems;
    if (!Array.isArray(items)) throw new ProviderError('USAJOBS returned an unexpected response format.');
    return { listings: items.map(map).filter(Boolean), total: data.SearchResult.SearchResultCountAll };
  },
};

function map(item) {
  const d = item && item.MatchedObjectDescriptor; if (!d || !item.MatchedObjectId || !d.PositionTitle) return null;
  const loc = (d.PositionLocation || [])[0] || {}, pay = (d.PositionRemuneration || [])[0] || {}, det = (d.UserArea && d.UserArea.Details) || {};
  const period = { PA: 'year', PH: 'hour', PM: 'month', WC: 'week' }[pay.RateIntervalCode] || null;
  const city = (loc.CityName || '').split(',')[0].trim() || null;
  const sched = ((d.PositionSchedule || [])[0] || {}).Name || '';
  const remote = det.RemoteIndicator === true || det.RemoteIndicator === 'True' || /remote/i.test(loc.LocationName || '') ? true : undefined;
  return {
    externalId: String(item.MatchedObjectId), title: d.PositionTitle, employer: [d.OrganizationName, d.DepartmentName].filter(Boolean).join(' — ') || 'U.S. Federal Government',
    locationText: loc.LocationName || '', city, state: loc.CountrySubDivisionCode || null, lat: loc.Latitude, lon: loc.Longitude, remote,
    salaryMin: pay.MinimumRange, salaryMax: pay.MaximumRange, salaryPeriod: period, type: sched, published: d.PublicationStartDate, deadline: d.ApplicationCloseDate,
    description: [det.JobSummary, d.QualificationSummary].filter(Boolean).join('\n\n'), applyUrl: (d.ApplyURI || [])[0] || d.PositionURI, canonicalUrl: d.PositionURI,
  };
}
module.exports._map = map;
