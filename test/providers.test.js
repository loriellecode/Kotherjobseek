'use strict';
/* Provider contract tests. These check our adapters against the response/request formats documented by each provider
 * (as far as the official docs could be consulted — see README "Verification status") using LOCAL MOCK servers.
 * They prove the adapters behave correctly for documented shapes; they do NOT prove the live APIs still match. See live.providers.test.js. */
const t = require('node:test');
const assert = require('node:assert/strict');
const { listen } = require('./helpers');

t.describe('Adzuna adapter', () => {
  let mock, calls = [], respond, adz;
  t.before(async () => {
    mock = await listen((req, res) => { const u = new URL(req.url, 'http://x'); calls.push({ path: u.pathname, q: Object.fromEntries(u.searchParams), headers: req.headers }); respond(req, res, u); });
    process.env.ADZUNA_APP_ID = 'id123'; process.env.ADZUNA_APP_KEY = 'secretkey456'; process.env.ADZUNA_BASE_URL = `http://127.0.0.1:${mock.port}/v1/api`;
    adz = require('../server/providers/adzuna');
  });
  t.after(() => mock.server.close());
  const ok = (body) => (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const job = (i, o) => Object.assign({ id: String(1000 + i), title: 'Budget Analyst', company: { display_name: 'Co ' + i }, location: { display_name: 'Stockton, San Joaquin County, California', area: ['US', 'California', 'San Joaquin County', 'Stockton'] }, latitude: 37.9, longitude: -121.3, salary_min: 60000, salary_max: 80000, salary_is_predicted: '0', contract_time: 'full_time', redirect_url: 'https://www.adzuna.com/land/ad/' + i, created: '2026-10-01T12:00:00Z', description: 'x', category: { label: 'Accounting' } }, o);

  t.it('builds the documented request: path, credentials, keyword, location, radius (km), date sort', async () => {
    calls = []; respond = ok({ count: 1, results: [job(1)] });
    await adz.search({ what: 'budget analyst', where: 'Stockton, CA', radiusMiles: 30 });
    const c = calls[0]; assert.equal(c.path, '/v1/api/jobs/us/search/1'); assert.equal(c.q.app_id, 'id123'); assert.equal(c.q.app_key, 'secretkey456'); assert.equal(c.q.what, 'budget analyst'); assert.equal(c.q.where, 'Stockton, CA');
    assert.equal(c.q.distance, String(Math.round(30 * 1.609344))); assert.equal(c.q.sort_by, 'date'); assert.equal(c.q.results_per_page, '50'); assert.ok(Number(c.q.max_days_old) > 0);
    calls = []; await adz.search({ what: 'x', where: 'California', radiusMiles: 0 }); assert.equal(calls[0].q.distance, undefined, 'no radius for a statewide search');
  });
  t.it('paginates until a short page and numbers pages in the path', async () => {
    calls = []; respond = (req, res, u) => { const p = Number(u.pathname.split('/').pop()); ok({ count: 120, results: p < 3 ? Array.from({ length: 50 }, (_, i) => job(p * 100 + i)) : Array.from({ length: 7 }, (_, i) => job(900 + i)) })(req, res); };
    const r = await adz.search({ what: 'a', where: 'b' }, { maxPages: 5 }); assert.deepEqual(calls.map((c) => c.path.split('/').pop()), ['1', '2', '3']); assert.equal(r.listings.length, 107);
    calls = []; await adz.search({ what: 'a', where: 'b' }); assert.equal(calls.length, 2, 'default maximum of two pages');
  });
  t.it('maps fields: city/state from area, predicted salary flag, annual period, redirect URL, id as string', async () => {
    respond = ok({ results: [job(1), job(2, { salary_is_predicted: '1' }), job(3, { salary_min: undefined, salary_max: undefined, contract_time: 'part_time' })] });
    const { listings } = await adz.search({ what: 'a', where: 'b' }); const [a, b, c] = listings;
    assert.equal(a.externalId, '1001'); assert.equal(a.city, 'Stockton'); assert.equal(a.state, 'California'); assert.equal(a.salaryPeriod, 'year'); assert.equal(a.salaryEstimated, false); assert.equal(b.salaryEstimated, true);
    assert.equal(a.applyUrl, 'https://www.adzuna.com/land/ad/1'); assert.equal(c.salaryMin, undefined); assert.match(c.type, /part_time/);
    const { normalizeListing } = require('../server/normalize'); const n = normalizeListing(c, 'adzuna', 1); assert.equal(n.salary_min, null, 'missing salary stays unknown'); assert.equal(n.employment_type, 'Part-time');
  });
  t.it('errors are understandable and never contain the credentials', async () => {
    for (const [status, re] of [[401, /rejected the credentials/], [403, /rejected the credentials/], [429, /rate limit/], [500, /HTTP 500/]]) {
      respond = (req, res) => { res.writeHead(status); res.end('nope'); };
      await assert.rejects(adz.search({ what: 'a', where: 'b' }), (e) => { assert.match(e.message, re); assert.ok(!e.message.includes('secretkey456') && !e.message.includes('id123')); assert.equal(e.status, status); return true; });
    }
    respond = (req, res) => { res.writeHead(200); res.end('<html>not json'); }; await assert.rejects(adz.search({ what: 'a', where: 'b' }), /not valid JSON/);
    respond = ok({ unexpected: true }); await assert.rejects(adz.search({ what: 'a', where: 'b' }), /unexpected response format/);
    mock.server.close(); await assert.rejects(adz.search({ what: 'a', where: 'b' }), (e) => { assert.match(e.message, /unreachable/); assert.ok(!e.message.includes('secretkey456')); return true; });
  });
  t.it('reports missing credentials precisely', () => { const saved = process.env.ADZUNA_APP_KEY; const c = require('../server/config'); const old = c.providers.adzuna.appKey; c.providers.adzuna.appKey = ''; const r = adz.configured(); c.providers.adzuna.appKey = old; assert.deepEqual(r, { ok: false, missing: ['ADZUNA_APP_KEY'] }); assert.ok(saved); });
});

t.describe('USAJOBS adapter', () => {
  let mock, seen, usa;
  t.before(async () => {
    mock = await listen((req, res) => { seen = { path: req.url, headers: req.headers }; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ SearchResult: { SearchResultCountAll: 2, SearchResultItems: [
      { MatchedObjectId: '800001', MatchedObjectDescriptor: { PositionTitle: 'Budget Analyst', PositionURI: 'https://www.usajobs.gov/job/800001', ApplyURI: ['https://www.usajobs.gov/job/800001/apply'], OrganizationName: 'Dept of Example', DepartmentName: 'Example Agency', PositionLocation: [{ LocationName: 'Stockton, California', CityName: 'Stockton, California', CountrySubDivisionCode: 'California', Latitude: 37.95, Longitude: -121.29 }], PositionRemuneration: [{ MinimumRange: '25.50', MaximumRange: '33.10', RateIntervalCode: 'PH' }], PositionSchedule: [{ Name: 'Full-time' }], PublicationStartDate: '2026-10-01', ApplicationCloseDate: '2026-11-01T23:59:59', QualificationSummary: "Bachelor's degree required. 2 years of finance experience required.", UserArea: { Details: { JobSummary: 'Prepare budgets.', RemoteIndicator: false } } } },
      { MatchedObjectId: '800002', MatchedObjectDescriptor: { PositionTitle: 'Analyst (Remote)', PositionURI: 'https://www.usajobs.gov/job/800002', ApplyURI: [], OrganizationName: 'Another', PositionLocation: [{ LocationName: 'Anywhere in the U.S. (remote job)' }], PositionRemuneration: [{ MinimumRange: '90000', MaximumRange: '120000', RateIntervalCode: 'PA' }], UserArea: { Details: { RemoteIndicator: true } } } }] } })); });
    process.env.USAJOBS_API_KEY = 'usakey789'; process.env.USAJOBS_USER_EMAIL = 'me@example.test'; process.env.USAJOBS_BASE_URL = `http://127.0.0.1:${mock.port}/api`;
    delete require.cache[require.resolve('../server/config')]; for (const k of Object.keys(require.cache)) if (/server[\\/]providers/.test(k)) delete require.cache[k]; usa = require('../server/providers/usajobs');
  });
  t.after(() => mock.server.close());
  t.it('sends the documented headers (Host, User-Agent = registered email, Authorization-Key) and location/keyword params', async () => {
    await usa.search({ what: 'budget analyst', where: 'Stockton, CA', radiusMiles: 30 });
    assert.equal(seen.headers['authorization-key'], 'usakey789'); assert.equal(seen.headers['user-agent'], 'me@example.test'); assert.match(seen.path, /Keyword=budget\+analyst/); assert.match(seen.path, /LocationName=Stockton%2C\+CA/); assert.match(seen.path, /Radius=30/);
  });
  t.it('maps hourly and annual pay, coordinates, deadline, remote, and both URLs; normalizes salary to annual', async () => {
    const { listings } = await usa.search({ what: 'a', where: '' }); const [h, r] = listings;
    assert.equal(h.salaryPeriod, 'hour'); assert.equal(h.salaryMin, '25.50'); assert.equal(h.lat, 37.95); assert.equal(h.deadline, '2026-11-01T23:59:59'); assert.equal(h.applyUrl, 'https://www.usajobs.gov/job/800001/apply'); assert.equal(h.employer, 'Dept of Example — Example Agency');
    assert.equal(r.remote, true); assert.equal(r.applyUrl, 'https://www.usajobs.gov/job/800002', 'falls back to the posting URL when no ApplyURI'); assert.equal(r.salaryPeriod, 'year');
    const { normalizeListing } = require('../server/normalize'), KJ = require('../shared/match'); const n = normalizeListing(h, 'usajobs', 1);
    assert.equal(n.deadline, '2026-11-01'); assert.equal(n.edu_level, 'bachelor'); assert.equal(n.exp_years, 2); assert.equal(KJ.annual(n.salary_min, n.salary_max, n.salary_period).max, 33.1 * 2080);
    assert.equal(KJ.salaryText({ salaryMin: n.salary_min, salaryMax: n.salary_max, salaryPeriod: n.salary_period }), '$25.50–$33.10/hr');
  });
  t.it('credentials in error messages are redacted; 401 is explained', async () => {
    mock.server.removeAllListeners('request'); mock.server.on('request', (req, res) => { res.writeHead(401); res.end(); });
    await assert.rejects(usa.search({ what: 'a', where: '' }), (e) => { assert.match(e.message, /rejected the credentials/); assert.ok(!e.message.includes('usakey789')); return true; });
  });
});

t.describe('Employer career pages (JSON-LD) adapter', () => {
  let mock, hits = [], robots = 'User-agent: *\nDisallow: /private/', feeds;
  const post = (id, o) => Object.assign({ '@type': 'JobPosting', title: 'Accounting Technician', identifier: { '@type': 'PropertyValue', value: id }, hiringOrganization: { '@type': 'Organization', name: 'Example USD', logo: 'https://example.test/logo.png' }, jobLocation: { '@type': 'Place', address: { addressLocality: 'Stockton', addressRegion: 'CA' } },
    baseSalary: { '@type': 'MonetaryAmount', value: { '@type': 'QuantitativeValue', minValue: 28, maxValue: 34, unitText: 'HOUR' } }, employmentType: 'FULL_TIME', datePosted: '2026-10-02', validThrough: '2026-11-15', description: '<p>Process <b>invoices</b>.</p><ul><li>High school diploma required</li></ul>', url: 'https://careers.example.test/jobs/' + id }, o);
  t.before(async () => {
    mock = await listen((req, res) => { hits.push({ url: req.url, ua: req.headers['user-agent'] }); if (req.url === '/robots.txt') { res.writeHead(200); return res.end(robots); }
      res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<html><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [post('A1'), post('A2', { jobLocationType: 'TELECOMMUTE' })] })}</script><script type="application/ld+json">{bad json</script><script type="application/ld+json">${JSON.stringify({ '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', item: post('A3') }] })}</script></html>`); });
    delete require.cache[require.resolve('../server/config')]; for (const k of Object.keys(require.cache)) if (/server[\\/]providers/.test(k)) delete require.cache[k]; feeds = require('../server/providers/feeds');
  });
  t.after(() => mock.server.close());
  t.it('reads JobPosting JSON-LD from @graph and ItemList, ignores malformed blocks, maps pay/dates/remote/logo', async () => {
    hits = []; const { listings } = await feeds.search({ feed: { name: 'Example USD', url: `http://127.0.0.1:${mock.port}/jobs` } });
    assert.equal(listings.length, 3); const a = listings[0]; assert.equal(a.salaryPeriod, 'hour'); assert.equal(a.salaryMin, 28); assert.equal(a.deadline, '2026-11-15'); assert.equal(a.city, 'Stockton'); assert.equal(a.logoUrl, 'https://example.test/logo.png'); assert.equal(listings[1].remote, true);
    assert.ok(!/<|>/.test(a.description) && /invoices/.test(a.description)); assert.match(hits.find((h) => h.url === '/jobs').ua, /KotherJobSearch/, 'identifies itself');
  });
  t.it('honours robots.txt: a disallowed page is never fetched', async () => {
    // a fresh origin so no cached robots.txt applies
    hits = []; const m2 = await listen((req, res) => { hits.push(req.url); if (req.url === '/robots.txt') { res.writeHead(200); return res.end('User-agent: *\nDisallow: /jobs'); } res.writeHead(200); res.end('<html></html>'); });
    await assert.rejects(feeds.search({ feed: { name: 'Blocked', url: `http://127.0.0.1:${m2.port}/jobs` } }), /robots\.txt does not allow/); assert.deepEqual(hits, ['/robots.txt'], 'only robots.txt was requested'); m2.server.close();
  });
  t.it('only https feeds listed in the operator-controlled file are used; an unreadable robots.txt means do not fetch', async () => {
    const m3 = await listen((req, res) => { res.writeHead(req.url === '/robots.txt' ? 503 : 200); res.end('<html></html>'); });
    await assert.rejects(feeds.search({ feed: { name: 'Flaky', url: `http://127.0.0.1:${m3.port}/jobs` } }), /robots\.txt/); m3.server.close();
    assert.equal(feeds.configured().ok, false, 'no feeds configured by default'); assert.ok(feeds.configured().missing[0]);
  });
});
