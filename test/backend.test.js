'use strict';
const t = require('node:test');
const assert = require('node:assert/strict');
const { boot, adz } = require('./helpers');

t.describe('profile → rematch pipeline', () => {
  let env, c;
  t.before(async () => { env = await boot(); c = await env.signup(); });
  t.after(() => env.close());

  t.it('requires authentication and rejects cross-origin writes', async () => {
    const anon = env.client();
    assert.equal((await anon.req('GET', '/api/feed')).status, 401);
    const r = await fetch(env.base + '/api/profile', { method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'https://evil.example', cookie: c.cookie }, body: '{}' });
    assert.equal(r.status, 403);
  });

  t.it('starts with an empty profile — nothing invented', async () => {
    const { data } = await c.req('GET', '/api/bootstrap');
    assert.deepEqual([data.profile.education, data.profile.experience, data.profile.skills, data.profile.certs], [[], [], [], []]);
    assert.equal(data.profile.salary.min, null);
    assert.equal((await c.req('GET', '/api/feed')).data.jobs.length, 0);
  });

  t.it('A: saving education creates a revision and queues ONE search+match task', async () => {
    env.mock.state.jobs = [adz(1), adz(2, { title: 'Financial Analyst', company: { display_name: 'Lodi Credit Union' }, location: { display_name: 'Lodi, California', area: ['US', 'California', 'San Joaquin County', 'Lodi'] } })];
    // two quick edits -> consolidated
    let r = await c.req('POST', '/api/profile/education', { level: 'bachelor', field: 'Finance', status: 'completed' });
    assert.equal(r.status, 201); assert.deepEqual(r.data.classes, ['broad']); assert.equal(r.data.revision, 1);
    await c.req('PATCH', '/api/profile', { titles: ['Budget Analyst'] });
    const queued = env.db.prepare("SELECT * FROM tasks WHERE status='queued'").all();
    assert.equal(queued.length, 1, 'rapid edits consolidate into a single task');
    assert.equal(r.data.status.state, 'queued');
    assert.equal(env.db.prepare('SELECT COUNT(*) n FROM profile_revisions').get().n, 2);
    assert.ok(env.mock.state.calls.length === 0, 'no search before the worker runs');
    await env.pipeline.drain();
    const st = (await c.req('GET', '/api/search/status')).data.status;
    assert.equal(st.state, 'done'); assert.equal(st.result.searched, true); assert.ok(st.result.created >= 2);
    assert.ok(env.mock.state.calls.length > 0);
    const apiKeyLeak = JSON.stringify(st); assert.ok(!apiKeyLeak.includes('test-key'));
  });

  t.it('C: finance degree supports an analyst role without assuming experience', async () => {
    const jobs = (await c.req('GET', '/api/feed')).data.jobs, ba = jobs.find((j) => j.title === 'Budget Analyst');
    assert.ok(ba, 'listing present'); assert.equal(ba.provider, 'adzuna'); assert.equal(ba.applyUrl, 'https://example.test/jobs/1');
    assert.equal(ba.education.level, 'bachelor'); assert.equal(ba.education.inferred, true);
    assert.equal(ba.experience.years, 2);
    const exp = ba.match.qualification.checks.find((x) => x.kind === 'experience');
    assert.equal(exp.status, 'unknown', 'no experience entered → unknown, not met, not unmet');
    assert.notEqual(ba.match.classification, 'needs_more');
    assert.ok(ba.match.meets.some((x) => /Bachelor/.test(x)));
    // add experience → rematch
    const before = ba.match.overall;
    await c.req('POST', '/api/profile/experience', { title: 'Staff Accountant', employer: 'Acme', field: 'Finance', years: 3 });
    await env.pipeline.drain();
    const ba2 = (await c.req('GET', '/api/feed')).data.jobs.find((j) => j.title === 'Budget Analyst');
    assert.equal(ba2.match.qualification.checks.find((x) => x.kind === 'experience').status, 'met');
    assert.ok(ba2.match.overall > before);
    assert.equal(ba2.match.classification, 'strong');
  });

  t.it('D: raising minimum salary hides lower-paying jobs from the default feed unless shown', async () => {
    env.mock.state.jobs.push(adz(3, { title: 'Budget Clerk', salary_min: 40000, salary_max: 48000 }));
    await c.req('POST', '/api/search/run'); await env.pipeline.drain();
    let r = await c.req('PATCH', '/api/profile', { salary: { min: 60000, period: 'year' } });
    assert.deepEqual(r.data.classes, ['salary']);
    await env.pipeline.drain();
    const clerk = (await c.req('GET', '/api/feed')).data.jobs.find((j) => j.title === 'Budget Clerk');
    assert.equal(clerk.match.salary.status, 'below'); assert.equal(clerk.match.excluded.belowFloor, true);
    const KJ = require('../shared/match'); const prof = (await c.req('GET', '/api/bootstrap')).data.profile;
    const jobs = (await c.req('GET', '/api/feed')).data.jobs;
    assert.ok(!KJ.buildFeed(jobs, prof).forYou.some((j) => j.title === 'Budget Clerk'));
    prof.salary.showBelow = true;
    assert.ok(KJ.buildFeed(jobs, prof).forYou.some((j) => j.title === 'Budget Clerk'), 'explicit opt-in shows them');
    // salary-only change must not trigger a new search
    const calls = env.mock.state.calls.length;
    await c.req('PATCH', '/api/profile', { salary: { min: 65000 } }); await env.pipeline.drain();
    assert.equal(env.mock.state.calls.length, calls, 'salary change recalculates matches without searching');
  });

  t.it('E: changing preferred cities reruns searches for the new location and updates location matches', async () => {
    const calls = env.mock.state.calls.length;
    const r = await c.req('PATCH', '/api/profile', { cities: ['Lodi, CA'], commuteMiles: 15 });
    assert.deepEqual(r.data.classes, ['location']);
    await env.pipeline.drain();
    const newCalls = env.mock.state.calls.slice(calls);
    assert.ok(newCalls.length > 0 && newCalls.every((q) => /lodi/i.test(q.where || '')), 'searches target Lodi');
    assert.ok(newCalls.every((q) => Number(q.distance) > 0), 'radius passed (km)');
    const jobs = (await c.req('GET', '/api/feed')).data.jobs;
    assert.equal(jobs.find((j) => j.employer === 'Lodi Credit Union').match.location.status, 'priority');
    assert.notEqual(jobs.find((j) => j.title === 'Budget Analyst').match.location.status, 'priority');
  });

  t.it('M: no duplicate jobs or repeated notifications after repeated cycles', async () => {
    const jobsBefore = env.db.prepare('SELECT COUNT(*) n FROM jobs').get().n;
    for (let i = 0; i < 3; i++) { await c.req('POST', '/api/search/run'); await env.pipeline.drain(); }
    assert.equal(env.db.prepare('SELECT COUNT(*) n FROM jobs').get().n, jobsBefore);
    const dupSig = env.db.prepare('SELECT user_id, kind, signature, COUNT(*) n FROM notifications GROUP BY 1,2,3 HAVING n>1').all();
    assert.equal(dupSig.length, 0);
  });

  t.it('cross-provider duplicates collapse into one job listing both sources', async () => {
    const { upsertJob } = require('../server/jobs'), { normalizeListing } = require('../server/normalize');
    const a = normalizeListing({ externalId: 'x1', title: 'Grants Manager', employer: 'Sample Foundation', city: 'Sacramento', applyUrl: 'https://careers.example.test/grants?utm_source=a' }, 'feeds', Date.now());
    const b = normalizeListing({ externalId: 'z9', title: 'Grants Manager', employer: 'Sample Foundation', city: 'Sacramento', applyUrl: 'https://careers.example.test/grants?utm_source=b' }, 'usajobs', Date.now());
    const r1 = upsertJob(env.db, a), r2 = upsertJob(env.db, b);
    assert.equal(r1.id, r2.id); assert.equal(r2.duplicate, true);
    assert.equal(JSON.parse(env.db.prepare('SELECT also_listed FROM jobs WHERE id=?').get(r1.id).also_listed).length, 1);
  });
});
