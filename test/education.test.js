'use strict';
const t = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { boot, adz } = require('./helpers');
const KJ = require('../shared/match');

t.describe('initial education profile (unverified until reviewed)', () => {
  let env, c;
  t.before(async () => {
    process.env.INITIAL_PROFILE_FILE = path.join(__dirname, '..', 'config', 'initial-profile.json');
    env = await boot(); c = await env.signup();
  });
  t.after(() => { env.close(); process.env.INITIAL_PROFILE_FILE = '/nonexistent/initial-profile.json'; });

  t.it('seeds exactly the four provided education items, all unverified and flagged, with nothing invented', async () => {
    const p = (await c.req('GET', '/api/bootstrap')).data.profile;
    assert.equal(p.education.length, 4);
    assert.deepEqual(p.education.map((e) => [e.level, e.field]), [['', 'Finance'], ['bachelor', 'Business Management and Administration'], ['', 'Business Finance'], ['master', 'Special Education']]);
    for (const e of p.education) { assert.equal(e.verified, false); assert.equal(e.source, 'provided'); assert.equal(e.school, ''); assert.equal(e.year, null); assert.equal(e.title, ''); assert.ok(e.flag.length > 20, 'ambiguity is explained'); }
    assert.match(p.education[0].flag, /separate degree|major of one/); assert.match(p.education[3].flag, /not a teaching credential/i);
    assert.deepEqual([p.certs, p.experience, p.skills], [[], [], []], 'no licenses, certifications or experience invented');
  });
  t.it('seeds her stated preferences: $28/hr minimum, $30/hr desired, priority cities, California-wide', async () => {
    const p = (await c.req('GET', '/api/bootstrap')).data.profile;
    assert.deepEqual(p.salary, { min: 28, desired: 30, period: 'hour', showBelow: false });
    assert.deepEqual(p.cities.slice(0, 5), ['North Stockton, CA', 'Stockton, CA', 'Lodi, CA', 'Tracy, CA', 'Manteca, CA']); assert.equal(p.statewide, true);
    assert.equal(KJ.profileFloor(p), 28 * 2080); assert.equal(KJ.profileDesired(p), 30 * 2080);
  });
  t.it('seeding is idempotent and starts a first search', async () => {
    const P = require('../server/profile'); const uid = env.db.prepare('SELECT id FROM users').get().id;
    assert.equal(P.applyInitialProfile(env.db, uid).applied, false);
    assert.equal((await c.req('GET', '/api/bootstrap')).data.profile.education.length, 4);
    assert.equal(env.db.prepare("SELECT COUNT(*) n FROM tasks WHERE status='queued'").get().n, 1);
  });
  t.it('matching treats reported degrees as unconfirmed, never as a credential', async () => {
    env.mock.state.jobs = [adz(1, { title: 'Budget Analyst', description: "Prepare budgets. Bachelor's degree required." }),
      adz(2, { title: 'Special Education Teacher', description: "Teach students with disabilities. Bachelor's degree required. A valid California Education Specialist Instruction Credential is required." }),
      adz(3, { title: 'Special Education Program Specialist', company: { display_name: 'Test District' }, description: "Master's degree required." })];
    await env.pipeline.drain();
    const jobs = (await c.req('GET', '/api/feed')).data.jobs, by = (x) => jobs.find((j) => j.title === x);
    const ba = by('Budget Analyst').match;
    assert.equal(ba.qualification.checks.find((x) => x.kind === 'education').status, 'reported');
    assert.notEqual(ba.classification, 'strong', 'unverified education cannot make a strong match'); assert.ok(ba.unverified.length >= 1);
    const sp = by('Special Education Teacher').match, cert = sp.qualification.checks.find((x) => x.kind === 'cert');
    assert.equal(cert.status, 'unknown'); assert.notEqual(cert.status, 'met'); assert.match(cert.note, /degree on its own doesn’t confirm a credential/);
    assert.notEqual(sp.classification, 'needs_more', 'unclear credential does not exclude the job'); assert.ok(sp.unknown.some((x) => /Credential/.test(x)));
    assert.equal(by('Special Education Program Specialist').match.qualification.checks.find((x) => x.kind === 'education').status, 'reported', 'the reported master’s is unconfirmed');
  });
  t.it('hourly minimum: $28/hr hides lower-paying jobs; higher pay ranks higher', async () => {
    env.mock.state.jobs.push(adz(4, { title: 'Budget Aide', salary_min: 40000, salary_max: 50000 }), adz(5, { title: 'Budget Director', salary_min: 100000, salary_max: 120000 }));
    await c.req('POST', '/api/search/run'); await env.pipeline.drain();
    const jobs = (await c.req('GET', '/api/feed')).data.jobs, prof = (await c.req('GET', '/api/bootstrap')).data.profile;
    assert.equal(jobs.find((j) => j.title === 'Budget Aide').match.salary.status, 'below');
    assert.ok(!KJ.buildFeed(jobs, prof).forYou.some((j) => j.title === 'Budget Aide'));
    assert.equal(jobs.find((j) => j.title === 'Budget Director').match.salary.status, 'meets_desired');
    env.mock.state.jobs.push(adz(7, { title: 'Financial Analyst I', salary_min: 70000, salary_max: 80000 }), adz(8, { title: 'Financial Analyst II', salary_min: 100000, salary_max: 120000 }));
    await c.req('POST', '/api/search/run'); await env.pipeline.drain();
    const pair = (await c.req('GET', '/api/feed')).data.jobs, lo = pair.find((j) => j.title === 'Financial Analyst I').match, hi = pair.find((j) => j.title === 'Financial Analyst II').match;
    assert.ok(hi.overall > lo.overall, `otherwise-identical jobs: higher pay ranks higher (${hi.overall} vs ${lo.overall})`); assert.ok(hi.payBonus > lo.payBonus);
    const pay = KJ.buildFeed(jobs, prof).sections.find((s) => s.id === 'pay'); assert.ok(pay && pay.items[0].title === 'Budget Director', 'higher-paying section leads with the highest pay');
  });
  t.it('California-wide: a Fresno job is considered, labelled as elsewhere in California', async () => {
    env.mock.state.jobs.push(adz(6, { title: 'Budget Analyst II', latitude: null, longitude: null, location: { display_name: 'Fresno, California', area: ['US', 'California', 'Fresno County', 'Fresno'] } }));
    await c.req('POST', '/api/search/run'); await env.pipeline.drain();
    const f = (await c.req('GET', '/api/feed')).data.jobs.find((j) => j.title === 'Budget Analyst II');
    assert.equal(f.match.location.status, 'elsewhere_ca'); assert.ok(env.mock.state.calls.some((q) => q.where === 'California'), 'a California-wide search ran');
  });
  t.it('reviewing: editing and confirming records changes matching; nothing is confirmed until she says so', async () => {
    let p = (await c.req('GET', '/api/bootstrap')).data.profile; const bach = p.education.find((e) => e.level === 'bachelor'), { id, source, ...body } = bach;
    let r = await c.req('PUT', `/api/profile/education/${id}`, Object.assign(body, { title: 'Bachelor of Science in Business Management and Administration', school: 'Example College', year: 2005, verified: true, flag: '' }));
    assert.equal(r.status, 200); assert.ok(r.data.queued);
    p = r.data.profile; assert.equal(p.education.find((e) => e.id === id).verified, true); assert.equal(p.education.filter((e) => e.verified === false).length, 3);
    await env.pipeline.drain();
    const ba = (await c.req('GET', '/api/feed')).data.jobs.find((j) => j.title === 'Budget Analyst').match.qualification.checks.find((x) => x.kind === 'education');
    assert.equal(ba.status, 'met'); const revs = env.db.prepare('SELECT COUNT(*) n FROM profile_revisions').get().n; assert.ok(revs >= 2);
    assert.equal((await c.req('DELETE', `/api/profile/education/${p.education[0].id}`)).status, 200);
  });
});

t.describe('persistence across a server restart (file database)', () => {
  t.it('profile, résumé file and saved jobs survive; interrupted tasks are recovered', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kother-persist-')), file = path.join(dir, 'k.db'), { open } = require('../server/db'), { start } = require('../server/index');
    const { makeDocx, RESUME_LINES } = require('./helpers');
    let app = await start({ db: open(file), port: 0, noWorker: true });
    const base = () => `http://127.0.0.1:${app.port}`; let cookie = '';
    const call = async (m, p, b, h) => { const r = await fetch(base() + p, { method: m, headers: Object.assign({ cookie }, b !== undefined && !Buffer.isBuffer(b) ? { 'content-type': 'application/json' } : {}, h || {}), body: b === undefined ? undefined : Buffer.isBuffer(b) ? b : JSON.stringify(b) }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { status: r.status, data: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text() }; };
    await call('POST', '/api/auth/signup', { email: 'p@example.test', password: 'a long enough password' });
    await call('POST', '/api/profile/education', { level: 'bachelor', field: 'Finance', verified: false, flag: 'check me' });
    await call('PATCH', '/api/profile', { salary: { min: 27, period: 'hour' } });
    const up = await call('POST', '/api/resume', await makeDocx(RESUME_LINES), { 'x-filename': 'r.docx', 'content-type': 'application/octet-stream' }); assert.equal(up.status, 201);
    app.db.prepare("INSERT INTO tasks(user_id,kind,reason,scope,status,stage,run_after,created_at) VALUES(1,'search','profile','{}','running','searching',0,0)").run();
    app.close(); await new Promise((r) => setTimeout(r, 100));
    app = await start({ db: open(file), port: 0, noWorker: true }); // "restart"
    const boot2 = await call('GET', '/api/bootstrap'); assert.equal(boot2.status, 200, 'session cookie survives restart');
    assert.equal(boot2.data.profile.education[0].flag, 'check me'); assert.equal(boot2.data.profile.salary.min, 27); assert.equal(boot2.data.profile.resume.filename, 'r.docx');
    assert.equal((await call('GET', '/api/resume/file')).status, 200);
    assert.equal(app.db.prepare("SELECT COUNT(*) n FROM tasks WHERE status='running'").get().n, 0, 'an interrupted task is re-queued, not lost');
    assert.equal(app.db.prepare("SELECT status FROM tasks WHERE id=1").get().status, 'queued');
    app.close();
  });
});
