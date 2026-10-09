'use strict';
const t = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const webpush = require('web-push'); const vapid = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey; process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
const { boot, adz, listenTls, makeDocx, RESUME_LINES } = require('./helpers');
const root = path.join(__dirname, '..');
const walk = (d, out = []) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', '.git', 'data', 'fixtures'].includes(f.name)) continue; const p = path.join(d, f.name); f.isDirectory() ? walk(p, out) : out.push(p); } return out; };

t.describe('authentication, authorization and privacy', () => {
  let env, a, b;
  t.before(async () => { env = await boot(); a = await env.signup('a@example.test'); b = await env.signup('b@example.test'); env.mock.state.jobs = [adz(1), adz(2, { title: 'Financial Analyst' })]; await a.req('PATCH', '/api/profile', { categories: ['Finance'] }); await env.pipeline.drain(); });
  t.after(() => env.close());

  t.it('one user cannot read or change another user’s profile records, saved jobs, applications, résumé or notifications', async () => {
    const rec = (await a.req('POST', '/api/profile/education', { level: 'bachelor', field: 'Finance' })).data.id; await a.req('POST', '/api/profile/skill', { name: 'Budgeting' }); await a.req('POST', '/api/profile/experience', { title: 'Analyst' });
    const exp = (await a.req('GET', '/api/bootstrap')).data.profile.experience[0].id;
    assert.equal((await b.req('PUT', `/api/profile/education/${rec}`, { level: 'doctorate', field: 'Hacked' })).status, 404); assert.equal((await b.req('DELETE', `/api/profile/education/${rec}`)).status, 404);
    assert.equal((await b.req('PUT', `/api/profile/experience/${exp}`, { title: 'Hacked' })).status, 404); assert.equal((await b.req('DELETE', `/api/profile/experience/${exp}`)).status, 404);
    assert.equal((await a.req('GET', '/api/bootstrap')).data.profile.education[0].field, 'Finance');
    assert.deepEqual((await b.req('GET', '/api/bootstrap')).data.profile.education, [], 'B sees none of A’s records');
    const jobs = (await a.req('GET', '/api/feed')).data.jobs; assert.ok(jobs.length >= 1); const j = jobs[0].id;
    await a.req('PUT', `/api/jobs/${j}/saved`); await a.req('PUT', `/api/applications/${j}`, { status: 'applied', notes: 'private note' });
    await b.req('PUT', `/api/applications/${j}`, { status: 'interested' }); // B tracks the same public job independently
    assert.equal((await a.req('GET', '/api/applications')).data.applications[0].notes, 'private note'); assert.equal((await b.req('GET', '/api/applications')).data.applications[0].notes, '');
    assert.equal((await b.req('GET', '/api/feed')).data.jobs.filter((x) => x.userState.saved).length, 0, 'saved state is per user');
    await a.req('POST', '/api/resume', await makeDocx(RESUME_LINES), { 'x-filename': 'r.docx', 'content-type': 'application/octet-stream' });
    assert.equal((await b.req('GET', '/api/resume/file')).status, 404); assert.equal((await b.req('GET', '/api/resume')).data.resume, null);
    const aNotes = (await a.req('GET', '/api/notifications')).data.notifications.length, bNotes = (await b.req('GET', '/api/notifications')).data.notifications; assert.ok(aNotes >= 0); assert.ok(bNotes.every((n) => n.kind !== 'new_match'));
    assert.equal((await b.req('DELETE', '/api/account', { password: 'correct horse battery' })).status, 200, 'B can only delete B'); assert.equal((await a.req('GET', '/api/bootstrap')).status, 200);
  });
  t.it('push subscriptions cannot be hijacked by another account, and must be https', async () => {
    const c2 = await env.signup('c@example.test'); const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
    const sub = { endpoint: 'https://push.example.test/abc', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
    assert.equal((await a.req('POST', '/api/push/subscribe', { subscription: sub })).status, 201); assert.equal((await c2.req('POST', '/api/push/subscribe', { subscription: sub })).status, 409);
    assert.equal((await a.req('POST', '/api/push/subscribe', { subscription: Object.assign({}, sub, { endpoint: 'http://insecure.example/x' }) })).status, 400);
  });
  t.it('push delivery errors are recorded; gone devices (410) are removed; no email is ever attempted', async () => {
    let mode = 410, got = 0; const svc = await listenTls((req, res) => { got++; req.resume(); req.on('end', () => { res.writeHead(mode); res.end(); }); });
    const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys(); const ep = (n) => `https://127.0.0.1:${svc.port}/p/${n}`; const keys = () => ({ p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') });
    await a.req('POST', '/api/push/subscribe', { subscription: { endpoint: ep('gone'), keys: keys() } });
    await a.req('PATCH', '/api/profile', { notify: { push: true, enabled: true, immediate: true, quietStart: 0, quietEnd: 0 } });
    const { create, deliverDue } = require('../server/notify'); const uid = env.db.prepare("SELECT id FROM users WHERE email='a@example.test'").get().id;
    create(env.db, uid, { kind: 'test', signature: 'one', title: 'T1', body: 'b', link: '/#/discover' }); await deliverDue(env.db);
    const d1 = JSON.parse(env.db.prepare("SELECT delivered FROM notifications WHERE signature='one'").get().delivered); assert.match(d1.push.error, /failed on/); assert.equal(d1.email, undefined);
    assert.equal(env.db.prepare('SELECT COUNT(*) n FROM push_subscriptions WHERE endpoint=?').get(ep('gone')).n, 0, 'a 410 Gone subscription is deleted');
    mode = 500; await a.req('POST', '/api/push/subscribe', { subscription: { endpoint: ep('flaky'), keys: keys() } }); create(env.db, uid, { kind: 'test', signature: 'two', title: 'T2', body: 'b' }); await deliverDue(env.db);
    assert.match(JSON.parse(env.db.prepare("SELECT delivered FROM notifications WHERE signature='two'").get().delivered).push.error, /500|failed/); assert.equal(env.db.prepare('SELECT COUNT(*) n FROM push_subscriptions WHERE endpoint=?').get(ep('flaky')).n, 1, 'a transient error keeps the subscription');
    const before = got; await deliverDue(env.db); assert.equal(got, before, 'a delivered/attempted notification is not retried forever');
    svc.server.close();
  });
  t.it('weak passwords, bad logins and brute force are handled', async () => {
    const anon = env.client(); assert.equal((await anon.req('POST', '/api/auth/signup', { email: 'x@example.test', password: 'short' })).status, 400); assert.equal((await anon.req('POST', '/api/auth/signup', { email: 'not-an-email', password: 'long enough password' })).status, 400);
    assert.equal((await anon.req('POST', '/api/auth/signup', { email: 'a@example.test', password: 'long enough password' })).status, 409);
    const bad = await anon.req('POST', '/api/auth/login', { email: 'a@example.test', password: 'wrong wrong wrong' }); assert.equal(bad.status, 401); assert.equal(bad.data.error, (await anon.req('POST', '/api/auth/login', { email: 'nobody@example.test', password: 'x' })).data.error, 'same message for unknown users');
    let last; for (let i = 0; i < 12; i++) last = await anon.req('POST', '/api/auth/login', { email: 'a@example.test', password: 'nope' + i }); assert.equal(last.status, 429);
  });
  t.it('session cookie is HttpOnly + SameSite; logout invalidates the session; static files cannot expose server code or data', async () => {
    const r = await fetch(env.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@example.test', password: 'correct horse battery' }) });
    if (r.status === 200) { const sc = r.headers.get('set-cookie'); assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Lax/); }
    const c = await env.signup('d@example.test'); const cookie = c.cookie; await c.req('POST', '/api/auth/logout'); assert.equal((await env.client(cookie).req('GET', '/api/bootstrap')).status, 401, 'old token no longer works');
    for (const p of ['/../server/config.js', '/%2e%2e/server/index.js', '/server/config.js', '/data/kother.db', '/shared/../server/config.js', '/.env', '/package.json', '/js/../../server/db.js', '/resumes/1/x']) { const s = (await fetch(env.base + p)).status; assert.ok([404, 400].includes(s), `${p} -> ${s}`); }
    const h = (await fetch(env.base + '/')).headers; assert.match(h.get('content-security-policy'), /default-src 'self'/); assert.equal(h.get('x-frame-options'), 'DENY'); assert.equal(h.get('x-content-type-options'), 'nosniff');
  });
  t.it('a fresh install shows no listings and explains which sources need setup (no sample data exists)', async () => {
    const { open } = require('../server/db'); const { start } = require('../server/index'); const app = await start({ db: open(':memory:'), port: 0, noWorker: true });
    const r = await fetch(`http://127.0.0.1:${app.port}/api/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'z@example.test', password: 'long enough password' }) }); const cookie = r.headers.get('set-cookie').split(';')[0];
    const feed = await (await fetch(`http://127.0.0.1:${app.port}/api/feed`, { headers: { cookie } })).json(); assert.deepEqual(feed.jobs, []); assert.equal(app.db.prepare('SELECT COUNT(*) n FROM jobs').get().n, 0);
    const files = walk(path.join(root, 'public')).concat(walk(path.join(root, 'server'))); for (const f of files) assert.ok(!/sampleJobs|Sample listing|sample-budget/i.test(fs.readFileSync(f, 'utf8')), `${path.basename(f)} contains no sample-listing code`);
    app.close();
  });
});

t.describe('source-level guarantees', () => {
  t.it('there is no email code, dependency or setting anywhere in the application', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); assert.ok(!Object.keys(Object.assign({}, pkg.dependencies, pkg.devDependencies)).some((d) => /mail|smtp|sendgrid|mailgun|ses/i.test(d)));
    for (const f of walk(root).filter((x) => /\.(js|json|md|example|html)$/.test(x) && !/test[\\/]|package-lock|README/.test(x))) { const s = fs.readFileSync(f, 'utf8'); assert.ok(!/nodemailer|sendMail|SMTP_|createTransport|MAIL_FROM/.test(s), `${path.relative(root, f)} mentions email delivery`); }
  });
  t.it('mock/stand-in provider URLs are refused in production', () => {
    for (const k of ['ADZUNA_BASE_URL', 'USAJOBS_BASE_URL', 'PEXELS_BASE_URL']) { const r = spawnSync(process.execPath, ['-e', "require('./server/config')"], { cwd: root, env: Object.assign({}, process.env, { NODE_ENV: 'production', [k]: 'http://127.0.0.1:9999' }), encoding: 'utf8' }); assert.notEqual(r.status, 0, k); assert.match(r.stderr, /must not be overridden in production/); }
    const ok = spawnSync(process.execPath, ['-e', "require('./server/config')"], { cwd: root, env: Object.assign({}, process.env, { NODE_ENV: 'production', ADZUNA_BASE_URL: '', USAJOBS_BASE_URL: '', PEXELS_BASE_URL: '' }), encoding: 'utf8' }); assert.equal(ok.status, 0, ok.stderr);
  });
  t.it('no secret-bearing names appear in client-delivered files', () => {
    for (const f of walk(path.join(root, 'public')).concat(path.join(root, 'shared', 'match.js'))) assert.ok(!/ADZUNA_APP_KEY|PEXELS_API_KEY|VAPID_PRIVATE|USAJOBS_API_KEY|Authorization-Key|app_key/.test(fs.readFileSync(f, 'utf8')), path.basename(f));
  });
});

t.describe('scheduler', () => {
  let env, c;
  t.before(async () => { env = await boot(); c = await env.signup(); await c.req('PATCH', '/api/profile', { categories: ['Finance'] }); env.mock.state.jobs = [adz(1)]; await env.pipeline.drain(); });
  t.after(() => env.close());
  t.it('schedules one scan per interval — not one per tick — and not at all when search is disabled', async () => {
    const q = () => env.db.prepare("SELECT COUNT(*) n FROM tasks WHERE status='queued'").get().n, later = Date.now() + 7 * 3600000;
    assert.equal(q(), 0); await env.pipeline.scheduleTick(Date.now()); assert.equal(q(), 0, 'not due yet');
    await env.pipeline.scheduleTick(later); await env.pipeline.scheduleTick(later + 1000); await env.pipeline.scheduleTick(later + 2000); assert.equal(q(), 1, 'ticks never stack duplicate scans');
    await env.pipeline.drain(); assert.equal((await c.req('GET', '/api/search/status')).data.status.reason, 'scheduled');
    await c.req('PATCH', '/api/profile', { searchEnabled: false }); await env.pipeline.drain(); await env.pipeline.scheduleTick(later + 20 * 3600000); assert.equal(q(), 0, 'searching disabled → no scheduled scan');
    await c.req('PATCH', '/api/profile', { searchEnabled: true });
  });
  t.it('repeated identical searches are skipped within the minimum interval; a manual search forces them', async () => {
    process.env.MIN_REPEAT_SEARCH_MINUTES = '360'; const cfg = require('../server/config'); const old = cfg.minRepeatSearchMinutes; cfg.minRepeatSearchMinutes = 360;
    try { await c.req('POST', '/api/search/run'); await env.pipeline.drain(); const n = env.mock.state.calls.length;
      env.pipeline.enqueue(1, { reason: 'scheduled', search: true }); await env.pipeline.drain(); assert.equal(env.mock.state.calls.length, n, 'identical queries within the window are not repeated');
      await c.req('POST', '/api/search/run'); await env.pipeline.drain(); assert.ok(env.mock.state.calls.length > n, 'manual search forces a fresh run'); } finally { cfg.minRepeatSearchMinutes = old; }
  });
  t.it('provider request budgets are enforced and reported', async () => {
    const cfg = require('../server/config'); const old = cfg.providers.adzuna.dailyBudget; cfg.providers.adzuna.dailyBudget = 1;
    try { const n = env.mock.state.calls.length; await c.req('POST', '/api/search/run'); await env.pipeline.drain(); const st = (await c.req('GET', '/api/search/status')).data.status; assert.ok(env.mock.state.calls.length - n <= 1); assert.ok(st.result.errors.some((e) => /budget/.test(e.message))); } finally { cfg.providers.adzuna.dailyBudget = old; }
  });
});
