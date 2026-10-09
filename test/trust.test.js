'use strict';
const t = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const trust = require('../server/trust');
const { safeFetch, isPublicIp } = require('../server/safeFetch');
const { normalizeListing } = require('../server/normalize');
const trustCheck = require('../server/trustCheck');
const { boot } = require('./helpers');

const A = (url, employer, extra) => trust.assess(Object.assign({ applyUrl: url, employer: employer || 'Example Employer', title: 'Analyst', description: 'Prepare reports and analyze data for the department.' }, extra || {}));
const texts = (a) => a.reasons.map((r) => r.text).join(' | ');

t.describe('trust statuses', () => {
  t.it('official government, school and university pages are trusted, with the reason stated', () => {
    for (const u of ['https://www.cityofstockton.gov/jobs/1', 'https://www.deltacollege.edu/hr/9', 'https://www.lodiusd.k12.ca.us/jobs', 'https://www.calcareers.ca.gov/x']) assert.equal(A(u, 'City').status, 'trusted', u);
    assert.match(texts(A('https://www.cityofstockton.gov/jobs/1')), /Government or education website identified/);
  });
  t.it('the employer’s own careers feed counts as an official employer site', () => {
    const a = trust.assess({ applyUrl: 'https://careers.acme.example/j/1', employer: 'Acme', title: 'x', description: 'y' }, { feedHost: 'careers.acme.example' });
    assert.equal(a.status, 'trusted'); assert.match(texts(a), /Official employer site identified/);
  });
  t.it('third-party application systems (Workday, Greenhouse, Lever) are accepted even though the domain differs from the employer’s', () => {
    for (const u of ['https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Stockton/x_1', 'https://boards.greenhouse.io/acme/jobs/123', 'https://jobs.lever.co/acme/abc']) {
      const a = A(u, 'Acme Corporation'); assert.equal(a.status, 'checked', u); assert.match(texts(a), /Application platform appears consistent/); assert.match(texts(a), /matches the employer/);
    }
  });
  t.it('an ATS account that doesn’t obviously match the employer is still accepted, but says the connection is unconfirmed', () => {
    const a = A('https://boards.greenhouse.io/someotherco/jobs/1', 'Acme Corporation'); assert.equal(a.status, 'checked'); assert.match(texts(a), /Employer connection not confirmed/);
  });
  t.it('another source listing the same job supports an ATS connection', () => {
    const a = trust.assess({ applyUrl: 'https://boards.greenhouse.io/someotherco/jobs/1', employer: 'Acme Corporation', title: 'x', description: 'y' }, { otherSources: [{ provider: 'feeds', host: 'careers.acme.example', trust: 'trusted' }] });
    assert.match(texts(a), /Another source lists this job/); assert.ok(a.evidence.some((e) => /feeds/.test(e)));
  });
  t.it('small businesses: a domain consistent with the employer name is "checked"; an unrelated unknown domain stays visible as "needs a closer look"', () => {
    assert.equal(A('https://www.stocktonbakery.com/careers', 'Stockton Bakery').status, 'checked');
    const u = A('https://some-hiring-page.example/apply', 'Delta Plumbing'); assert.equal(u.status, 'closer_look'); assert.match(texts(u), /Employer connection not confirmed/); assert.doesNotMatch(texts(u), /not verified/i);
  });
  t.it('established job boards are recognised, and the wording is honest that the employer is not confirmed', () => {
    const a = A('https://www.indeed.com/viewjob?jk=1'); assert.equal(a.status, 'trusted'); assert.match(texts(a), /employer’s identity is not independently confirmed/);
  });
  t.it('plain http is flagged and cannot rank above "needs a closer look"', () => {
    const a = A('http://delta-plumbing.example/apply', 'Delta Plumbing'); assert.equal(a.status, 'closer_look'); assert.match(texts(a), /encrypted/);
  });
  t.it('no wording claims a site is 100% safe, guaranteed or fully verified', () => {
    for (const u of ['https://www.cityofstockton.gov/x', 'https://boards.greenhouse.io/acme/1', 'https://random.example/x', 'https://www.indeed.com/x']) { const a = A(u, 'Acme'); assert.doesNotMatch(texts(a) + a.label, /100%|guarantee|fully verified|certified safe/i); }
  });
});

t.describe('high risk and blocked', () => {
  t.it('look-alike and impersonating addresses are high risk', () => {
    for (const u of ['https://usajobs.gov.evil.example/job', 'https://greenhouse-careers.example/apply', 'https://xn--usajobs-9ya.com/apply', 'https://lever-jobs.example/x']) assert.equal(A(u, 'Acme').status, 'high_risk', u);
  });
  t.it('URL shorteners and raw IP / local hosts are high risk, never trusted', () => {
    for (const u of ['https://bit.ly/abc', 'https://tinyurl.com/x', 'https://192.168.1.5/apply', 'http://localhost/x', 'https://intranet/apply', 'https://printer.local/x']) assert.equal(A(u).status, 'high_risk', u);
  });
  t.it('javascript:/data:/ftp: schemes and embedded credentials are blocked and never stored', () => {
    for (const u of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x.example/a', 'https://user:pass@jobs.example.com/a']) { const a = A(u); assert.equal(a.status, 'blocked', u); assert.equal(a.url, null); }
    const n = normalizeListing({ externalId: '1', title: 'Analyst', employer: 'Co', applyUrl: 'javascript:alert(1)' }, 'import', 1);
    assert.equal(n.apply_url, null); assert.equal(n.url_key, null); assert.ok(!JSON.stringify(n).includes('alert(1)'));
  });
  t.it('an upfront-payment request is blocked even on a plausible site; a premature sensitive-data request is high risk', () => {
    assert.equal(A('https://boards.greenhouse.io/acme/1', 'Acme', { description: 'You must pay a $99 training fee before your first day.' }).status, 'blocked');
    assert.equal(A('https://www.stocktonbakery.com/x', 'Stockton Bakery', { description: 'Buy gift cards and send us the codes; we reimburse you.' }).status, 'blocked');
    const s = A('https://www.stocktonbakery.com/x', 'Stockton Bakery', { description: 'To apply please send your social security number and bank account number.' });
    assert.equal(s.status, 'high_risk'); assert.match(texts(s), /unusual this early/);
  });
  t.it('legitimate wording is not flagged (background check after an offer, "no fee", I-9 on day one, EEO text)', () => {
    const a = A('https://boards.greenhouse.io/acme/1', 'Acme', { description: 'Employment is contingent on a background check after an offer. There is no fee to apply. Documents for Form I-9 are collected on your first day. Equal opportunity employer.' });
    assert.equal(a.status, 'checked'); assert.equal(a.reasons.filter((r) => r.kind === 'bad').length, 0);
  });
  t.it('softer signals warn but do not block (private messaging, implausible promises, hidden employer, wild pay range)', () => {
    const a = A('https://some-hiring-page.example/apply', 'Confidential', { description: 'Interview via Telegram. Guaranteed income, no experience needed!', salaryMin: 20000, salaryMax: 250000 });
    assert.equal(a.status, 'closer_look'); const k = texts(a); assert.match(k, /messaging app/); assert.match(k, /guaranteed income/i); assert.match(k, /pay range/); assert.match(k, /employer’s name is not given/);
  });
  t.it('an expired listing is noted without being rejected', () => {
    const a = A('https://boards.greenhouse.io/acme/1', 'Acme', { deadline: '2020-01-01' }); assert.equal(a.expired, true); assert.match(texts(a), /closing date has passed/); assert.equal(a.status, 'checked');
  });
  t.it('records why: reasons, evidence, what was and wasn’t checked, and when', () => {
    const a = A('https://boards.greenhouse.io/acme/1', 'Acme'); assert.ok(a.reasons.length && a.evidence.length && a.checkedAt > 0);
    assert.ok(a.checks.automated.length && a.checks.notDone.some((x) => /business-registry|Safe Browsing/.test(x)));
  });
});

t.describe('safe fetching', () => {
  t.it('private, loopback, link-local, CGNAT and multicast addresses are not public', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.1.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '224.0.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1']) assert.equal(isPublicIp(ip), false, ip);
    for (const ip of ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']) assert.equal(isPublicIp(ip), true, ip);
  });
  t.it('refuses loopback/metadata/private targets, credentials and non-http schemes, and hostnames that resolve to private addresses', async () => {
    const pub = { lookup: async () => [{ address: '93.184.216.34' }] };
    for (const u of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://localhost/', 'https://user:pw@example.com/', 'file:///etc/passwd', 'http://example.com:8080/']) assert.equal((await safeFetch(u, pub)).ok, false, u);
    const r = await safeFetch('https://innocent.example/', { lookup: async () => [{ address: '10.0.0.7' }] }); assert.equal(r.ok, false); assert.match(r.error, /blocked/);
  });
  t.it('(test-only private access) follows redirects but re-validates each hop; caps size; ignores non-text', async () => {
    const srv = http.createServer((q, s) => {
      if (q.url === '/ok') { s.writeHead(200, { 'content-type': 'text/html' }); s.end('<h1>Apply now</h1>'); }
      else if (q.url === '/hop') { s.writeHead(302, { location: '/ok' }); s.end(); }
      else if (q.url === '/big') { s.writeHead(200, { 'content-type': 'text/html' }); s.end('x'.repeat(500000)); }
      else if (q.url === '/bin') { s.writeHead(200, { 'content-type': 'application/octet-stream' }); s.end('abc'); }
      else if (q.url === '/loop') { s.writeHead(302, { location: '/loop' }); s.end(); }
      else { s.writeHead(404); s.end('no'); }
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port, o = { allowPrivate: true, allowAnyPort: true };
    try {
      const ok = await safeFetch(base + '/hop', o); assert.equal(ok.ok, true); assert.equal(ok.status, 200); assert.match(ok.text, /Apply now/); assert.equal(ok.hops.length, 2);
      const big = await safeFetch(base + '/big', o); assert.equal(big.truncated, true); assert.ok(big.text.length <= 220000);
      assert.equal((await safeFetch(base + '/bin', o)).text, ''); assert.equal((await safeFetch(base + '/missing', o)).status, 404);
      const loop = await safeFetch(base + '/loop', o); assert.equal(loop.ok, false); assert.match(loop.error, /redirects/);
      assert.equal((await safeFetch(base + '/ok', { allowPrivate: false })).ok, false, 'without the test override, loopback is refused');
    } finally { srv.close(); }
  });
});

t.describe('listings, feed and re-check (end to end)', () => {
  const body = 'Prepare and monitor budgets and financial reports for the department. Bachelor’s degree required.';
  const job = (id, employer, url, extra) => Object.assign({ id, title: 'Budget Analyst', employer, city: 'Stockton', description: body, url }, extra || {});
  t.it('feed: plausible listings stay visible with specific labels; high risk hides the action; blocked is quarantined', async () => {
    const env = await boot(), c = await env.signup();
    try {
      await c.req('POST', '/api/jobs/import', { jobs: [
        job('a', 'City of Stockton', 'https://www.cityofstockton.gov/jobs/1'), job('b', 'Acme Corporation', 'https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/1'), job('c', 'Delta Plumbing', 'https://some-hiring-page.example/apply'),
        job('d', 'Short Link Co', 'https://bit.ly/abc'), job('e', 'Shady Co', 'https://user:pw@shady.example/apply'), job('f', 'Fee Co', 'https://fee-co.example/apply', { description: body + ' You must pay a $150 training fee to start.' }),
      ] });
      await env.pipeline.drain(); const jobs = (await c.req('GET', '/api/feed')).data.jobs, by = (e) => jobs.find((j) => j.employer === e);
      assert.equal(by('City of Stockton').link.level, 'trusted'); assert.equal(by('City of Stockton').link.label, 'Trusted source');
      assert.equal(by('Acme Corporation').link.level, 'checked'); assert.equal(by('Acme Corporation').link.label, 'Application destination checked'); assert.ok(by('Acme Corporation').applyUrl);
      const d = by('Delta Plumbing'); assert.equal(d.link.level, 'closer_look'); assert.equal(d.link.label, 'Needs a closer look'); assert.ok(d.applyUrl, 'plausible but unconfirmed listings keep their link'); assert.ok(d.link.reasons.length && d.link.checkedAt);
      const s = by('Short Link Co'); assert.equal(s.link.level, 'high_risk'); assert.equal(s.applyUrl, null, 'the direct apply action is hidden'); assert.ok(!JSON.stringify(s).includes('bit.ly/abc'), 'the hidden link is not sent to the browser');
      assert.equal(by('Shady Co'), undefined); assert.equal(by('Fee Co'), undefined);
    } finally { env.close(); }
  });
  t.it('re-check: the endpoint re-assesses and records a new time; a stubbed live check can lower or raise risk; an unreachable page is not itself a risk', async () => {
    const cfg = require('../server/config'), env = await boot(), c = await env.signup();
    try {
      await c.req('POST', '/api/jobs/import', { jobs: [job('a', 'Delta Plumbing', 'https://some-hiring-page.example/apply')] });
      await env.pipeline.drain(); const j = (await c.req('GET', '/api/feed')).data.jobs[0], before = j.link.checkedAt;
      cfg.trust.networkChecks = false; await new Promise((r) => setTimeout(r, 5));
      const r = await c.req('POST', `/api/jobs/${j.id}/recheck`); assert.equal(r.status, 200); assert.ok(r.data.link.checkedAt >= before); assert.equal(r.data.link.level, 'closer_look');
      assert.equal((await c.req('POST', '/api/jobs/999999/recheck')).status, 404);
      const live = (o) => trustCheck.recheck(env.db, j.id, { network: true, fetch: async () => o });
      const gone = await live({ ok: true, status: 404, hops: ['x'], text: '' }); assert.equal(gone.expired, true); assert.match(texts(gone), /not found/);
      assert.match(texts(await live({ ok: true, status: 200, hops: ['x'], text: '<p>This position has been filled.</p>' })), /closed or expired/);
      assert.equal((await live({ ok: true, status: 200, hops: ['x'], text: '<p>Send a $100 registration fee via gift cards to begin.</p>' })).status, 'blocked');
      const down = await live({ ok: false, error: 'timed out', hops: [] }); assert.match(texts(down), /couldn’t be checked automatically/); assert.equal(down.status, 'closer_look');
    } finally { cfg.trust.networkChecks = true; env.close(); }
  });
  t.it('a live-check redirect to a shortener raises risk; a redirect to a known ATS is noted as support', async () => {
    const env = await boot(), c = await env.signup();
    try {
      await c.req('POST', '/api/jobs/import', { jobs: [job('a', 'Acme Corporation', 'https://some-hiring-page.example/apply')] }); await env.pipeline.drain();
      const id = (await c.req('GET', '/api/feed')).data.jobs[0].id, live = (o) => trustCheck.recheck(env.db, id, { network: true, fetch: async () => o });
      assert.equal((await live({ ok: true, status: 200, finalUrl: 'https://bit.ly/zzz', hops: ['a', 'b'], text: '' })).status, 'high_risk');
      assert.match(texts(await live({ ok: true, status: 200, finalUrl: 'https://acme.wd1.myworkdayjobs.com/x', hops: ['a', 'b'], text: '' })), /forwards to Workday/);
    } finally { env.close(); }
  });
});
