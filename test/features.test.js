'use strict';
const webpush = require('web-push');
const vapid = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey; process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
process.env.PEXELS_API_KEY = 'pexels-test-key';
const t = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { boot, adz, listen } = require('./helpers');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // test only: the mock push service uses a throwaway self-signed certificate
function listenTls(handler) { const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tls-')); execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', dir + '/k.pem', '-out', dir + '/c.pem', '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' }); return new Promise((r) => { const s = https.createServer({ key: fs.readFileSync(dir + '/k.pem'), cert: fs.readFileSync(dir + '/c.pem') }, handler); s.listen(0, '127.0.0.1', () => r({ server: s, port: s.address().port })); }); }

t.describe('alerts, scheduling, sources, tracking, résumé, imagery', () => {
  let env, c, pexels, pushSvc, pexelsCalls = 0, pushReceived = [];
  t.before(async () => {
    pexels = await listen((req, res) => { pexelsCalls++; if (req.headers.authorization !== 'pexels-test-key') { res.writeHead(401); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ photos: [{ id: 7, url: 'https://www.pexels.com/photo/test-7/', photographer: 'Pat Photographer', photographer_url: 'https://www.pexels.com/@pat', alt: 'Desk', avg_color: '#aabbcc', width: 4000, height: 3000, src: { small: 'https://images.pexels.com/photos/7/s.jpg', medium: 'https://images.pexels.com/photos/7/m.jpg', large: 'https://images.pexels.com/photos/7/l.jpg', large2x: 'https://images.pexels.com/photos/7/l2.jpg' } }] })); });
    pushSvc = await listenTls((req, res) => { const chunks = []; req.on('data', (d) => chunks.push(d)); req.on('end', () => { pushReceived.push({ headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(201); res.end(); }); });
    process.env.PEXELS_BASE_URL = `http://127.0.0.1:${pexels.port}/v1`;
    env = await boot(); c = await env.signup();
    await c.req('POST', '/api/profile/education', { level: 'bachelor', field: 'Finance' });
    await c.req('POST', '/api/profile/experience', { title: 'Staff Accountant', field: 'Finance', years: 4 });
    await c.req('PATCH', '/api/profile', { titles: ['Budget Analyst'], categories: ['Finance'], salary: { min: 60000 }, notify: { push: true, immediate: true, quietStart: 0, quietEnd: 0 } });
    env.mock.state.jobs = [adz(1)];
    await env.pipeline.drain();
  });
  t.after(() => { env.close(); pexels.server.close(); pushSvc.server.close(); });

  t.it('I: a failing source keeps existing results and reports an understandable error with retry', async () => {
    const before = (await c.req('GET', '/api/feed')).data.jobs.length; assert.ok(before >= 1);
    env.mock.state.mode = 'error';
    await c.req('POST', '/api/search/run'); await env.pipeline.drain();
    const st = (await c.req('GET', '/api/search/status')).data.status;
    assert.equal(st.state, 'failed'); assert.equal(st.canRetry, true); assert.match(st.error, /Adzuna returned HTTP 500/);
    assert.ok(!JSON.stringify(st).includes('test-key'), 'credentials never appear in errors');
    assert.equal((await c.req('GET', '/api/feed')).data.jobs.length, before, 'existing results preserved');
    assert.ok((await c.req('GET', '/api/notifications')).data.notifications.some((n) => n.kind === 'source_issue'));
    env.mock.state.mode = 'auth'; await c.req('POST', '/api/search/run'); await env.pipeline.drain();
    assert.match((await c.req('GET', '/api/search/status')).data.status.error, /rejected the credentials/);
    env.mock.state.mode = 'ok'; await c.req('POST', '/api/search/run'); await env.pipeline.drain();
    assert.equal((await c.req('GET', '/api/search/status')).data.status.state, 'done');
  });

  t.it('H: a scheduled search finds a genuinely new listing and sends one in-app notification and one push', async () => {
    // register a push device against the local mock push service
    const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
    const sub = { endpoint: `https://127.0.0.1:${pushSvc.port}/push/dev1`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
    assert.equal((await c.req('POST', '/api/push/subscribe', { subscription: sub })).status, 201);
    env.mock.state.jobs.push(adz(50, { title: 'Senior Budget Analyst', company: { display_name: 'Lodi Unified Finance' }, salary_min: 85000, salary_max: 99000 }));
    await env.pipeline.scheduleTick(Date.now() + 7 * 3600000); // scan interval has elapsed
    await env.pipeline.drain();
    const notes = (await c.req('GET', '/api/notifications')).data.notifications.filter((n) => n.kind === 'new_match');
    const n = notes.find((x) => /Senior Budget Analyst/.test(x.title)); assert.ok(n, 'notification for the new job');
    assert.match(n.title, /Lodi Unified Finance/); assert.match(n.body, /\$85,000–\$99,000/); assert.match(n.body, /Why:/); assert.match(n.link, /^\/#\/job\/\d+$/);
    assert.equal(n.delivered.email, undefined, 'no email channel exists'); assert.ok(n.delivered.push && n.delivered.push.sent, 'push delivered');
    assert.equal(pushReceived.length, 1); assert.match(pushReceived[0].headers.authorization, /^vapid /i); assert.equal(pushReceived[0].headers['content-encoding'], 'aes128gcm');
    // another cycle must not repeat it
    await c.req('POST', '/api/search/run'); await env.pipeline.drain();
    assert.equal((await c.req('GET', '/api/notifications')).data.notifications.filter((x) => /Senior Budget Analyst/.test(x.title)).length, 1);
    assert.equal(pushReceived.length, 1);
    // the job is in the feed exactly once
    assert.equal((await c.req('GET', '/api/feed')).data.jobs.filter((j) => j.title === 'Senior Budget Analyst').length, 1);
  });

  t.it('quiet hours defer email/push but never hide in-app notifications; notifications can be disabled without stopping search', async () => {
    const h = require('../server/notify').localHour(Date.now(), 'America/Los_Angeles');
    await c.req('PATCH', '/api/profile', { notify: { quietStart: h, quietEnd: (h + 2) % 24 } });
    env.mock.state.jobs.push(adz(51, { title: 'Budget Director', company: { display_name: 'Quiet Hours County' }, salary_min: 95000, salary_max: 120000 }));
    const pushes = pushReceived.length; await c.req('POST', '/api/search/run'); await env.pipeline.drain();
    const n = (await c.req('GET', '/api/notifications')).data.notifications.find((x) => /Budget Director/.test(x.title));
    assert.ok(n, 'visible in app immediately'); assert.ok(!n.delivered.push, 'external delivery deferred'); assert.equal(pushReceived.length, pushes);
    await c.req('PATCH', '/api/profile', { notify: { enabled: false } });
    env.mock.state.jobs.push(adz(52, { title: 'Budget Chief', company: { display_name: 'Muted County' } }));
    await c.req('POST', '/api/search/run'); await env.pipeline.drain();
    assert.ok(!(await c.req('GET', '/api/notifications')).data.notifications.some((x) => /Budget Chief/.test(x.title)));
    assert.ok((await c.req('GET', '/api/feed')).data.jobs.some((j) => j.title === 'Budget Chief'), 'search still ran and found it');
    await c.req('PATCH', '/api/profile', { notify: { enabled: true, quietStart: 21, quietEnd: 7 } });
  });

  t.it('J: listings not seen recently or past their deadline are not presented as verified open', async () => {
    const id = env.db.prepare("SELECT id FROM jobs WHERE title='Budget Chief'").get().id;
    env.db.prepare('UPDATE jobs SET last_seen=?, last_verified=? WHERE id=?').run(Date.now() - 20 * 864e5, Date.now() - 20 * 864e5, id);
    require('../server/jobs').sweepStatuses(env.db);
    let job = (await c.req('GET', '/api/jobs/' + id)).data; assert.equal(job.status, 'possibly_expired'); assert.equal(job.verification, 'possibly_expired');
    const KJ = require('../shared/match'), prof = (await c.req('GET', '/api/bootstrap')).data.profile;
    assert.ok(!KJ.buildFeed((await c.req('GET', '/api/feed')).data.jobs, prof).forYou.some((j) => j.id === id), 'excluded from default feed');
    env.db.prepare("UPDATE jobs SET status='active', last_seen=?, last_verified=?, deadline='2020-01-01' WHERE id=?").run(Date.now(), Date.now() - 10 * 864e5, id);
    require('../server/jobs').sweepStatuses(env.db);
    assert.equal((await c.req('GET', '/api/jobs/' + id)).data.status, 'expired');
    env.db.prepare("UPDATE jobs SET status='active', deadline=NULL WHERE id=?").run(id);
    assert.equal((await c.req('GET', '/api/jobs/' + id)).data.verification, 'unverified', 'last verified 10 days ago is not "verified"');
    // reappearing in a provider search reopens it
    env.mock.state.jobs.push(adz(52, { title: 'Budget Chief', company: { display_name: 'Muted County' } })); await c.req('POST', '/api/search/run'); await env.pipeline.drain();
    assert.equal((await c.req('GET', '/api/jobs/' + id)).data.verification, 'verified');
  });

  t.it('F/G: save, dismiss, report and application tracking persist in the database', async () => {
    const jobs = (await c.req('GET', '/api/feed')).data.jobs, a = jobs[0], b = jobs[1];
    await c.req('PUT', `/api/jobs/${a.id}/saved`);
    const c2 = env.client(c.cookie); // "reopen the app"
    assert.ok((await c2.req('GET', '/api/feed')).data.jobs.find((j) => j.id === a.id).userState.saved);
    await c.req('DELETE', `/api/jobs/${a.id}/saved`); assert.equal((await c.req('GET', '/api/feed')).data.jobs.find((j) => j.id === a.id).userState.saved, null);
    await c.req('PUT', `/api/jobs/${b.id}/dismissed`); assert.ok((await c.req('GET', '/api/feed')).data.jobs.find((j) => j.id === b.id).userState.dismissed);
    await c.req('DELETE', `/api/jobs/${b.id}/dismissed`);
    assert.equal((await c.req('PUT', `/api/applications/${a.id}`, { status: 'bogus' })).status, 400);
    assert.equal((await c.req('PUT', `/api/applications/${a.id}`, { status: 'applied', appliedOn: 'tomorrow' })).status, 400);
    let r = await c.req('PUT', `/api/applications/${a.id}`, { status: 'applied', appliedOn: '2026-10-01' }); assert.equal(r.data.application.appliedOn, '2026-10-01');
    r = await c.req('PUT', `/api/applications/${a.id}`, { status: 'interviewing', interviews: [{ date: '2026-10-20', note: 'Panel interview' }], response: 'Phone screen scheduled', notes: 'Ask about budget cycle' });
    assert.equal(r.data.application.status, 'interviewing'); assert.equal(r.data.application.interviews[0].note, 'Panel interview'); assert.equal(r.data.application.appliedOn, '2026-10-01');
    r = await c.req('PUT', `/api/applications/${a.id}`, { status: 'closed', closedReason: 'Position filled' });
    const list = (await c2.req('GET', '/api/applications')).data.applications; assert.equal(list.length, 1); assert.equal(list[0].status, 'closed'); assert.equal(list[0].closedReason, 'Position filled');
    assert.equal(env.db.prepare('SELECT COUNT(*) n FROM applications').get().n, 1);
    await c.req('PUT', `/api/jobs/${b.id}/report`, { reason: 'The listing has expired' }); assert.ok((await c.req('GET', '/api/feed')).data.jobs.find((j) => j.id === b.id).userState.reported);
  });

  t.it('K: imagery is fetched server-side with attribution, cached, and degrades without a key', async () => {
    const r = await c.req('GET', '/api/imagery/finance'); assert.equal(r.data.configured, true);
    assert.equal(r.data.photo.photographer, 'Pat Photographer'); assert.match(r.data.photo.pageUrl, /pexels\.com/); assert.match(r.data.photo.src.medium, /^https:\/\/images\.pexels\.com\//);
    const n = pexelsCalls; await c.req('GET', '/api/imagery/finance'); assert.equal(pexelsCalls, n, 'second request served from cache');
    assert.equal((await c.req('GET', '/api/imagery/not-a-topic')).data.photo, null);
    assert.ok(!JSON.stringify(r.data).includes('pexels-test-key'));
  });

  t.it('L/N: secrets never reach clients; provider status shows source and verification', async () => {
    for (const p of ['/api/bootstrap', '/api/providers', '/api/feed']) assert.ok(!JSON.stringify((await c.req('GET', p)).data).match(/test-key|pexels-test-key|VAPID_PRIVATE|\b(?:[A-Za-z0-9_-]{43})\b.*private/i), p);
    assert.ok(!JSON.stringify((await c.req('GET', '/api/bootstrap')).data).includes(vapid.privateKey));
    const root = path.join(__dirname, '..');
    const files = []; (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); f.isDirectory() ? walk(p) : files.push(p); } })(path.join(root, 'public')); files.push(path.join(root, 'shared', 'match.js'));
    for (const f of files) { const s = fs.readFileSync(f, 'utf8'); assert.ok(!/ADZUNA_APP_KEY|PEXELS_API_KEY|VAPID_PRIVATE|app_key|Authorization-Key/.test(s), `${path.basename(f)} must not reference secrets`); }
    const prov = (await c.req('GET', '/api/providers')).data.providers.find((p) => p.id === 'adzuna');
    assert.equal(prov.configured, true); assert.ok(prov.lastSuccess); assert.ok(prov.jobCount > 0);
    const job = (await c.req('GET', '/api/feed')).data.jobs[0]; assert.equal(job.provider, 'adzuna'); assert.ok(job.lastVerified && job.retrievedAt && job.applyUrl);
  });

  t.it('delete profile data and account', async () => {
    assert.equal((await c.req('DELETE', '/api/profile')).status, 200);
    const p = (await c.req('GET', '/api/bootstrap')).data.profile; assert.deepEqual([p.education.length, p.experience.length], [0, 0]);
    assert.equal((await c.req('DELETE', '/api/account', { password: 'wrong password!' })).status, 403);
    assert.equal((await c.req('DELETE', '/api/account', { password: 'correct horse battery' })).status, 200);
    assert.equal((await c.req('GET', '/api/bootstrap')).status, 401);
    assert.equal(env.db.prepare("SELECT COUNT(*) n FROM users WHERE email='her@example.test'").get().n, 0);
  });
});
