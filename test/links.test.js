'use strict';
const t = require('node:test');
const assert = require('node:assert/strict');
const { classify } = require('../server/linkSafety');
const { normalizeListing } = require('../server/normalize');
const KJ = require('../shared/match');
const { boot, adz } = require('./helpers');

t.describe('application-link safety', () => {
  t.it('trusts official provider domains, labels job-board redirects, and requires https', () => {
    assert.equal(classify('https://www.usajobs.gov/job/123', 'usajobs').level, 'trusted');
    assert.equal(classify('https://www.adzuna.com/land/ad/99?se=x', 'adzuna').level, 'redirect');
    assert.equal(classify('https://careers.lodiusd.net/jobs/5', 'feeds', { feedHost: 'careers.lodiusd.net' }).level, 'trusted');
    assert.equal(classify('https://apply.lodiusd.net/5', 'feeds', { feedHost: 'careers.lodiusd.net' }).level, 'caution', 'a different subdomain of a different registrable site is not assumed to be the employer');
    assert.equal(classify('https://jobs.stocktonca.gov/x', 'import').level, 'trusted', '.gov is restricted to government bodies');
    assert.equal(classify('https://www.deltacollege.edu/hr', 'adzuna').level, 'trusted');
    assert.equal(classify('http://careers.example.com/x', 'adzuna').level, 'caution'); assert.match(classify('http://careers.example.com/x', 'adzuna').notes[0], /encrypted/);
  });
  t.it('unrecognized sites get a caution, never a silent pass; look-alike (punycode) addresses are flagged', () => {
    const u = classify('https://some-random-staffing.example/apply', 'adzuna'); assert.equal(u.level, 'caution'); assert.match(u.notes[0], /don’t recognize this/);
    assert.equal(classify('https://xn--usajobs-9ya.com/apply', 'usajobs').level, 'caution');
    assert.equal(classify('https://usajobs.gov.evil.example/job', 'usajobs').level, 'caution', 'a trusted name as a subdomain of someone else’s domain is not trusted');
    assert.equal(classify('https://evilusajobs.gov.example/job', 'usajobs').level, 'caution'); assert.equal(classify('https://notadzuna.com/x', 'adzuna').level, 'caution');
    assert.match(classify('https://x.example/a', 'import').notes[0], /file you imported/);
  });
  t.it('dangerous links are blocked and never stored or shown', () => {
    for (const u of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x.example/a', 'https://user:pass@jobs.example.com/a', 'https://192.168.1.5/apply', 'https://127.0.0.1/x', 'http://localhost/x', 'https://intranet/apply', 'https://printer.local/x', 'https://bit.ly/3abc', 'https://tinyurl.com/x', 'not a url', 'https://[::1]/x']) assert.equal(classify(u, 'import').level, 'blocked', u);
    const n = normalizeListing({ externalId: '1', title: 'Analyst', employer: 'Co', applyUrl: 'https://bit.ly/3abc' }, 'import', 1); assert.equal(n.apply_url, null); assert.equal(n.link_level, 'blocked'); assert.equal(n.url_key, null);
    assert.ok(!JSON.stringify(n).includes('bit.ly/3abc'), 'the dangerous URL is not retained');
  });
  t.it('end to end: the API exposes link level + host; imports with unsafe links never reach the feed with a URL', async () => {
    const env = await boot(), c = await env.signup();
    await c.req('POST', '/api/jobs/import', { jobs: [{ id: 'a', title: 'Budget Analyst', employer: 'Good City', city: 'Stockton', url: 'https://www.cityofstockton.gov/jobs/1' }, { id: 'b', title: 'Budget Analyst', employer: 'Odd Staffing', city: 'Stockton', url: 'https://odd-staffing.example/apply' }, { id: 'c', title: 'Budget Analyst', employer: 'Shady', city: 'Stockton', url: 'https://user:pw@shady.example/apply' }, { id: 'd', title: 'Budget Analyst', employer: 'Short', city: 'Stockton', url: 'https://bit.ly/abc' }] });
    await env.pipeline.drain(); const jobs = (await c.req('GET', '/api/feed')).data.jobs, by = (e) => jobs.find((j) => j.employer === e);
    assert.equal(by('Good City').link.level, 'trusted'); assert.equal(by('Good City').link.host, 'www.cityofstockton.gov'); assert.equal(by('Odd Staffing').link.level, 'caution');
    for (const e of ['Shady', 'Short']) { assert.equal(by(e).applyUrl, null); assert.equal(by(e).link.level, 'blocked'); assert.ok(by(e).link.notes[0].length > 10); }
    env.close();
  });
});

t.describe('pay shown as hourly and annual', () => {
  t.it('annual → hourly equivalent, hourly → annual equivalent, estimates labelled, unknown stays unknown', () => {
    assert.deepEqual([KJ.salaryParts({ salaryMin: 78000, salaryMax: 92000, salaryPeriod: 'year' }).main, KJ.salaryParts({ salaryMin: 78000, salaryMax: 92000, salaryPeriod: 'year' }).alt], ['$78,000–$92,000/yr', '≈ $37.50–$44.23/hr']);
    const h = KJ.salaryParts({ salaryMin: 28, salaryMax: 34.5, salaryPeriod: 'hour' }); assert.equal(h.main, '$28.00–$34.50/hr'); assert.equal(h.alt, '≈ $58,240–$71,760/yr full-time');
    assert.equal(KJ.salaryParts({ salaryMin: 62400, salaryMax: 62400, salaryPeriod: 'year' }).alt, '≈ $30.00/hr');
    assert.match(KJ.salaryParts({ salaryMin: 70000, salaryMax: 80000, salaryEstimated: true }).alt, /estimated/); assert.equal(KJ.salaryParts({}), null);
  });
  t.it('her thresholds read correctly in both forms ($28/hr = $58,240/yr; $30/hr = $62,400/yr)', () => {
    assert.equal(KJ.salaryParts({ salaryMin: 58240, salaryMax: 58240, salaryPeriod: 'year' }).alt, '≈ $28.00/hr'); assert.equal(KJ.salaryParts({ salaryMin: 30, salaryMax: 30, salaryPeriod: 'hour' }).alt, '≈ $62,400/yr full-time');
  });
});
