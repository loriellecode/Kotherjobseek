'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { open, now, j } = require('./db');
const H = require('./http');
const auth = require('./auth');
const P = require('./profile');
const resume = require('./resume');
const imagery = require('./imagery');
const notify = require('./notify');
const providers = require('./providers');
const { Pipeline } = require('./pipeline');
const { feedFor, rematchUser } = require('./matcher');
const careersEngine = require('./careers');
const emailEngine = require('./emailEngine');
const E = require('../shared/emailDoc').email;
const { normalizeListing } = require('./normalize');
const trustCheck = require('./trustCheck');
const { upsertJob, jobView } = require('./jobs');

const A_where = (j) => (j.remote ? 'Remote' : [j.city, j.state].filter(Boolean).join(', '));
const PUBLIC = path.join(config.root, 'public'), SHARED = path.join(config.root, 'shared');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const APP_STATUSES = ['interested', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn', 'closed'];

function createApp(db, pipeline) {
  const loginLimit = H.rateLimiter(10, 15 * 60000), signupLimit = H.rateLimiter(10, 60 * 60000);
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, public: !!opts.public });

  const statusOf = (userId) => pipeline.statusFor(userId);
  const afterChange = (userId, res) => { // queue a rescan for meaningful profile changes
    let taskId = null;
    if (res.classes.length) taskId = pipeline.enqueue(userId, { classes: res.classes, reason: 'profile', revision: res.revision });
    return { revision: res.revision, classes: res.classes, changed: res.changed, queued: !!taskId, profile: P.getProfile(db, userId), status: statusOf(userId) };
  };
  const jobId = (m) => { const id = Number(m.id); if (!Number.isInteger(id)) throw new H.HttpError(404, 'Job not found'); if (!db.prepare('SELECT 1 FROM jobs WHERE id=?').get(id)) throw new H.HttpError(404, 'Job not found'); return id; };
  const setSession = (res, userId) => { const s = auth.createSession(db, userId); H.setCookie(res, 'kj_session', s.token, { maxAge: s.maxAge, secure: config.secureCookies }); };

  /* ---- auth ---- */
  route('POST', '/api/auth/signup', async (req, res) => {
    signupLimit(H.clientIp(req));
    if (!config.allowSignup && db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) throw new H.HttpError(403, 'Sign-ups are closed on this server.');
    const b = await H.readJson(req), email = auth.validateCreds(b.email, b.password);
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw new H.HttpError(409, 'An account with that email already exists.');
    const id = Number(db.prepare('INSERT INTO users(email,pw_hash,created_at) VALUES(?,?,?)').run(email, await auth.hashPassword(b.password), now()).lastInsertRowid);
    P.ensureProfile(db, id); const seeded = P.applyInitialProfile(db, id); if (seeded.applied) pipeline.enqueue(id, { classes: ['broad', 'location'], reason: 'profile', revision: seeded.revision }); setSession(res, id); H.send(res, 201, { user: { id, email } });
  }, { public: true });
  route('POST', '/api/auth/login', async (req, res) => {
    loginLimit(H.clientIp(req));
    const b = await H.readJson(req), email = String(b.email || '').trim().toLowerCase(), u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    const ok = u ? await auth.verifyPassword(String(b.password || ''), u.pw_hash) : (await auth.verifyPassword('x', 'scrypt$00$00'), false);
    if (!ok) throw new H.HttpError(401, 'Email or password is incorrect.');
    setSession(res, u.id); H.send(res, 200, { user: { id: u.id, email: u.email } });
  }, { public: true });
  route('POST', '/api/auth/logout', (req, res) => { auth.destroySession(db, H.parseCookies(req).kj_session); H.setCookie(res, 'kj_session', '', { maxAge: 0, secure: config.secureCookies }); H.send(res, 200, { ok: true }); }, { public: true });
  route('GET', '/api/health', (req, res) => H.send(res, 200, { ok: true }), { public: true });

  /* ---- bootstrap ---- */
  route('GET', '/api/bootstrap', (req, res) => {
    const u = req.user; P.ensureProfile(db, u.id);
    H.send(res, 200, { user: u, profile: P.getProfile(db, u.id), status: statusOf(u.id), providers: providerStatus(), unread: unread(u.id), config: { pushPublicKey: notify.pushStatus().configured ? config.push.publicKey : null, imagery: imagery.status() }, serverTime: now() });
  });
  route('GET', '/api/feed', (req, res) => H.send(res, 200, { jobs: feedFor(db, req.user.id), status: statusOf(req.user.id) }));

  /* ---- profile ---- */
  route('PATCH', '/api/profile', async (req, res) => H.send(res, 200, afterChange(req.user.id, P.updatePrefs(db, req.user.id, await H.readJson(req)))));
  route('POST', '/api/profile/:kind', async (req, res, m) => { const r = P.addRecord(db, req.user.id, m.kind, await H.readJson(req)); H.send(res, 201, Object.assign({ id: r.result }, afterChange(req.user.id, r))); });
  route('PUT', '/api/profile/:kind/:id', async (req, res, m) => H.send(res, 200, afterChange(req.user.id, P.updateRecord(db, req.user.id, m.kind, Number(m.id), await H.readJson(req)))));
  route('DELETE', '/api/profile/:kind/:id', (req, res, m) => H.send(res, 200, afterChange(req.user.id, P.deleteRecord(db, req.user.id, m.kind, Number(m.id)))));
  route('DELETE', '/api/profile', (req, res) => { db.prepare('DELETE FROM email_drafts WHERE user_id=?').run(req.user.id); resume.removeResume(db, req.user.id); P.deleteAllProfileData(db, req.user.id); rematchUser(db, req.user.id); H.send(res, 200, { profile: P.getProfile(db, req.user.id) }); });
  route('DELETE', '/api/account', async (req, res) => {
    const b = await H.readJson(req), u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!(await auth.verifyPassword(String(b.password || ''), u.pw_hash))) throw new H.HttpError(403, 'Password is incorrect.');
    resume.removeResume(db, req.user.id); db.prepare('DELETE FROM users WHERE id=?').run(req.user.id);
    H.setCookie(res, 'kj_session', '', { maxAge: 0, secure: config.secureCookies }); H.send(res, 200, { deleted: true });
  });

  /* ---- résumé ---- */
  route('POST', '/api/resume', async (req, res) => {
    const name = decodeURIComponent(String(req.headers['x-filename'] || 'resume'));
    const buf = await H.readBody(req, config.maxResumeBytes + 1024);
    const st = await resume.saveResume(db, req.user.id, name, buf);
    rematchUser(db, req.user.id); // résumé text can confirm free-text requirements
    H.send(res, 201, Object.assign(st, { note: 'Nothing has been added to your profile yet. Review the suggestions first.' }));
  });
  route('GET', '/api/resume', (req, res) => H.send(res, 200, resume.state(db, req.user.id)));
  route('POST', '/api/resume/retry', async (req, res) => H.send(res, 200, await resume.retry(db, req.user.id)));
  route('GET', '/api/resume/file', (req, res) => { const f = resume.resumeFile(db, req.user.id); H.send(res, 200, fs.readFileSync(f.file), { 'Content-Type': f.mime, 'Content-Disposition': `attachment; filename="${f.filename.replace(/["\\]/g, '')}"`, 'Cache-Control': 'private, no-store' }); });
  route('DELETE', '/api/resume', (req, res) => { const r = resume.removeResume(db, req.user.id); rematchUser(db, req.user.id); H.send(res, 200, r); });
  route('POST', '/api/resume/finish', (req, res) => H.send(res, 200, resume.finish(db, req.user.id)));
  route('POST', '/api/resume/proposals/:id/:action', async (req, res, m) => {
    if (!['accept', 'reject'].includes(m.action)) throw new H.HttpError(404, 'Not found');
    const b = await H.readJson(req).catch(() => ({}));
    let r; try { r = resume.decideProposal(db, req.user.id, Number(m.id), m.action === 'accept', b); } catch (e) { if (e.status === 409) return H.send(res, 409, { error: e.message, conflict: e.extra.conflict }); throw e; }
    if (r) { r.classes = [...new Set([...r.classes, 'resume'])]; H.send(res, 200, Object.assign(afterChange(req.user.id, r), resume.state(db, req.user.id))); } else H.send(res, 200, Object.assign({ ok: true }, resume.state(db, req.user.id)));
  });

  /* ---- Job Email Assistant: drafts only. Nothing here ever sends email. ---- */
  const aiLimit = H.rateLimiter(40, 60 * 60000);
  route('GET', '/api/email/capabilities', (req, res) => H.send(res, 200, { sends: false, ai: { configured: emailEngine.aiConfigured(), provider: 'Anthropic', disclosure: 'If you turn on AI, the email draft, the job title/employer/description, and the confirmed work history and skills selected for this job are sent to Anthropic to write the email. Your name, phone, email address and résumé file are never sent.' } }));
  const cleanDraft = (b) => ({ to: String(b.to || '').trim().slice(0, 254), subject: String(b.subject || '').replace(/[\r\n]+/g, ' ').slice(0, 300), html: E.blocksToHtml(E.htmlToBlocks(String(b.html || '').slice(0, 100000))), notes: String(b.notes || '').slice(0, 2000) });
  route('GET', '/api/email/drafts/:id', (req, res, m) => { const id = jobId(m), r = db.prepare('SELECT * FROM email_drafts WHERE user_id=? AND job_id=?').get(req.user.id, id); H.send(res, 200, { draft: r ? { to: r.recipient, subject: r.subject, html: r.body_html, notes: r.notes, updatedAt: r.updated_at } : null }); });
  route('PUT', '/api/email/drafts/:id', async (req, res, m) => { const id = jobId(m), d = cleanDraft(await H.readJson(req, 200 * 1024)); db.prepare('INSERT INTO email_drafts(user_id,job_id,recipient,subject,body_html,notes,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,job_id) DO UPDATE SET recipient=excluded.recipient, subject=excluded.subject, body_html=excluded.body_html, notes=excluded.notes, updated_at=excluded.updated_at').run(req.user.id, id, d.to, d.subject, d.html, d.notes, now()); H.send(res, 200, { saved: true, updatedAt: now() }); });
  route('DELETE', '/api/email/drafts/:id', (req, res, m) => { db.prepare('DELETE FROM email_drafts WHERE user_id=? AND job_id=?').run(req.user.id, jobId(m)); H.send(res, 200, { deleted: true }); });
  route('POST', '/api/email/draft', async (req, res) => {
    const b = await H.readJson(req, 200 * 1024), id = jobId({ id: b.jobId }); const row = db.prepare('SELECT * FROM jobs WHERE id=?').get(id), job = jobView(row);
    const d = cleanDraft(b), profile = P.getProfile(db, req.user.id), app = db.prepare('SELECT applied_on FROM applications WHERE user_id=? AND job_id=?').get(req.user.id, id);
    const wantsAi = b.useAi === true && b.consent === true; if (wantsAi) aiLimit(String(req.user.id));
    const ea = job.emailApply ? Object.assign({}, job.emailApply) : null;
    const ctx = { job: { title: job.title, employer: job.employer, location: A_where(job), description: job.description, required: job.required }, facts: emailEngine.applicantFacts(profile, job), email: ea, to: d.to, notes: d.notes, subject: d.subject, appliedOn: app && app.applied_on, useAi: wantsAi };
    if (b.action === 'review') { ctx.userText = ''; return H.send(res, 200, { warnings: emailEngine.review(E.htmlToBlocks(d.html), ctx) }); } // live check while she edits; no rewriting
    const out = await emailEngine.runAction(String(b.action), { blocks: E.htmlToBlocks(d.html), subject: d.subject }, ctx);
    H.send(res, 200, out);
  });

  /* ---- career expansion ---- */
  route('GET', '/api/careers', (req, res) => H.send(res, 200, careersEngine.compute(db, req.user.id)));
  route('PUT', '/api/careers/:id', async (req, res, m) => {
    const b = await H.readJson(req); if (!['include', 'exclude', 'clear'].includes(b.state)) throw new H.HttpError(400, 'state must be include, exclude or clear');
    if (!careersEngine.setState(db, req.user.id, m.id, b.state)) throw new H.HttpError(404, 'Unknown career');
    const r = P.touch(db, req.user.id, ['broad'], ['career paths']); pipeline.enqueue(req.user.id, { classes: ['broad'], reason: 'profile', revision: r.revision });
    H.send(res, 200, Object.assign(careersEngine.compute(db, req.user.id), { status: statusOf(req.user.id) }));
  });

  /* ---- search ---- */
  route('POST', '/api/search/run', (req, res) => { pipeline.enqueue(req.user.id, { reason: 'manual', force: true, search: true }); H.send(res, 202, { status: statusOf(req.user.id) }); });
  route('GET', '/api/search/status', (req, res) => H.send(res, 200, { status: statusOf(req.user.id) }));
  route('GET', '/api/providers', (req, res) => H.send(res, 200, { providers: providerStatus(), imagery: imagery.status(), push: notify.pushStatus() }));

  function providerStatus() {
    const dayStart = now() - 864e5;
    return providers.map((p) => {
      const c = p.configured(), last = db.prepare("SELECT status, finished_at, error, result_count FROM search_log WHERE provider=? AND status IN ('ok','failed') ORDER BY id DESC LIMIT 1").get(p.id);
      const lastOk = db.prepare("SELECT MAX(finished_at) t FROM search_log WHERE provider=? AND status='ok'").get(p.id).t;
      return { id: p.id, name: p.name, kind: p.kind, docs: p.docs, setup: p.setup, configured: c.ok, missing: c.missing, callsToday: db.prepare("SELECT COUNT(*) n FROM search_log WHERE provider=? AND started_at>?").get(p.id, dayStart).n, budget: p.budget(), lastStatus: last ? last.status : null, lastError: last && last.status === 'failed' ? last.error : null, lastSuccess: lastOk, jobCount: db.prepare("SELECT COUNT(*) n FROM jobs WHERE provider=?").get(p.id).n };
    }).concat([{ id: 'import', name: 'Imported file', kind: 'import', configured: true, setup: [], jobCount: db.prepare("SELECT COUNT(*) n FROM jobs WHERE provider='import'").get().n }]);
  }

  /* ---- jobs & per-user state ---- */
  route('GET', '/api/jobs/:id', (req, res, m) => { const id = jobId(m); const f = feedFor(db, req.user.id).find((x) => x.id === id); H.send(res, f ? 200 : 404, f || { error: 'Job not found' }); });
  const userJob = (userId, id) => db.prepare('INSERT OR IGNORE INTO user_jobs(user_id,job_id) VALUES(?,?)').run(userId, id);
  const recheckLimit = H.rateLimiter(30, 60 * 60000);
  route('POST', '/api/jobs/:id/recheck', async (req, res, m) => { const id = jobId(m); recheckLimit('u' + req.user.id); await trustCheck.recheck(db, id); const f = feedFor(db, req.user.id).find((x) => x.id === id); H.send(res, 200, f || { error: 'Job not found' }); });
  route('PUT', '/api/jobs/:id/saved', (req, res, m) => { const id = jobId(m); userJob(req.user.id, id); db.prepare('UPDATE user_jobs SET saved_at=? WHERE user_id=? AND job_id=?').run(now(), req.user.id, id); H.send(res, 200, { saved: true }); });
  route('DELETE', '/api/jobs/:id/saved', (req, res, m) => { const id = jobId(m); db.prepare('UPDATE user_jobs SET saved_at=NULL WHERE user_id=? AND job_id=?').run(req.user.id, id); H.send(res, 200, { saved: false }); });
  route('PUT', '/api/jobs/:id/dismissed', (req, res, m) => { const id = jobId(m); userJob(req.user.id, id); db.prepare('UPDATE user_jobs SET dismissed_at=?, saved_at=NULL WHERE user_id=? AND job_id=?').run(now(), req.user.id, id); H.send(res, 200, { dismissed: true }); });
  route('DELETE', '/api/jobs/:id/dismissed', (req, res, m) => { const id = jobId(m); db.prepare('UPDATE user_jobs SET dismissed_at=NULL WHERE user_id=? AND job_id=?').run(req.user.id, id); H.send(res, 200, { dismissed: false }); });
  route('PUT', '/api/jobs/:id/report', async (req, res, m) => { const id = jobId(m), b = await H.readJson(req); userJob(req.user.id, id); db.prepare('UPDATE user_jobs SET reported=? WHERE user_id=? AND job_id=?').run(String(b.reason || 'other').slice(0, 200), req.user.id, id); H.send(res, 200, { reported: true }); });
  route('DELETE', '/api/jobs/:id/report', (req, res, m) => { const id = jobId(m); db.prepare('UPDATE user_jobs SET reported=NULL WHERE user_id=? AND job_id=?').run(req.user.id, id); H.send(res, 200, { reported: false }); });

  /* ---- application tracking (nothing is ever submitted on the user's behalf) ---- */
  const appView = (r) => ({ jobId: r.job_id, status: r.status, appliedOn: r.applied_on, response: r.response, notes: r.notes, interviews: j(r.interviews, []), closedReason: r.closed_reason, updatedAt: r.updated_at });
  route('GET', '/api/applications', (req, res) => H.send(res, 200, { applications: db.prepare('SELECT * FROM applications WHERE user_id=? ORDER BY updated_at DESC').all(req.user.id).map(appView) }));
  route('PUT', '/api/applications/:id', async (req, res, m) => {
    const id = jobId(m), b = await H.readJson(req), cur = db.prepare('SELECT * FROM applications WHERE user_id=? AND job_id=?').get(req.user.id, id);
    const status = b.status === undefined ? (cur ? cur.status : 'applied') : String(b.status);
    if (!APP_STATUSES.includes(status)) throw new H.HttpError(400, 'Unknown application status.');
    const date = (v) => { if (v === undefined || v === null || v === '') return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new H.HttpError(400, 'Dates must look like 2026-10-31.'); return String(v); };
    const interviews = b.interviews === undefined ? j(cur && cur.interviews, []) : (Array.isArray(b.interviews) ? b.interviews.slice(0, 20).map((i) => ({ date: date(i.date), note: String(i.note || '').slice(0, 1000) })) : []);
    const appliedOn = b.appliedOn === undefined ? (cur ? cur.applied_on : (status === 'interested' ? null : new Date().toISOString().slice(0, 10))) : date(b.appliedOn);
    db.prepare(`INSERT INTO applications(user_id,job_id,status,applied_on,response,notes,interviews,closed_reason,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id,job_id) DO UPDATE SET status=excluded.status, applied_on=excluded.applied_on, response=excluded.response, notes=excluded.notes, interviews=excluded.interviews, closed_reason=excluded.closed_reason, updated_at=excluded.updated_at`)
      .run(req.user.id, id, status, appliedOn, String(b.response ?? (cur && cur.response) ?? '').slice(0, 2000), String(b.notes ?? (cur && cur.notes) ?? '').slice(0, 5000), JSON.stringify(interviews), String(b.closedReason ?? (cur && cur.closed_reason) ?? '').slice(0, 300), now());
    H.send(res, 200, { application: appView(db.prepare('SELECT * FROM applications WHERE user_id=? AND job_id=?').get(req.user.id, id)) });
  });
  route('DELETE', '/api/applications/:id', (req, res, m) => { db.prepare('DELETE FROM applications WHERE user_id=? AND job_id=?').run(req.user.id, jobId(m)); H.send(res, 200, { ok: true }); });

  /* ---- import (JSON file of real listings the user supplies) ---- */
  route('POST', '/api/jobs/import', async (req, res) => {
    const b = await H.readJson(req, 8 * 1024 * 1024), rows = Array.isArray(b) ? b : b.jobs;
    if (!Array.isArray(rows) || !rows.length) throw new H.HttpError(400, 'Expected a non-empty JSON array of jobs.');
    let created = 0, skipped = [];
    rows.slice(0, 2000).forEach((r, i) => {
      const n = normalizeListing({ externalId: r.id || r.url, title: r.title, employer: r.employer, locationText: [r.city, r.state].filter(Boolean).join(', '), city: r.city, state: r.state, neighborhood: r.neighborhood, remote: r.remote, salaryMin: r.salaryMin, salaryMax: r.salaryMax, salaryPeriod: r.salaryPeriod, type: r.type,
        description: r.description || r.summary, applyUrl: r.url, published: r.published, deadline: r.deadline, required: r.required, preferred: r.preferred, categories: (r.categories || []).filter((c) => P.CATEGORIES.includes(c)), logoUrl: r.logoUrl }, 'import', now());
      if (!n) { skipped.push(`Row ${i + 1}: needs id (or url), title and employer`); return; }
      if (upsertJob(db, n).created) created++;
    });
    if (created + 0 === 0 && skipped.length === rows.length) throw new H.HttpError(400, 'No usable listings. ' + skipped[0]);
    pipeline.enqueue(req.user.id, { reason: 'import', search: false });
    H.send(res, 201, { created, skipped: skipped.slice(0, 10), status: statusOf(req.user.id) });
  });

  /* ---- notifications ---- */
  const unread = (uid) => db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL').get(uid).n;
  route('GET', '/api/notifications', (req, res) => H.send(res, 200, { unread: unread(req.user.id), notifications: db.prepare('SELECT id,job_id,kind,title,body,link,created_at,read_at,delivered FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 60').all(req.user.id).map((n) => Object.assign(n, { delivered: j(n.delivered, {}) })) }));
  route('POST', '/api/notifications/read', (req, res) => { db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(now(), req.user.id); H.send(res, 200, { unread: 0 }); });
  route('POST', '/api/push/subscribe', async (req, res) => {
    const b = await H.readJson(req); const s = b.subscription || b;
    if (!notify.pushStatus().configured) throw new H.HttpError(501, 'Web push is not configured on this server (VAPID keys missing).');
    if (!s.endpoint || !/^https:\/\//.test(s.endpoint) || !s.keys || !s.keys.p256dh || !s.keys.auth) throw new H.HttpError(400, 'Invalid push subscription.');
    const owner = db.prepare('SELECT user_id FROM push_subscriptions WHERE endpoint=?').get(s.endpoint);
    if (owner && owner.user_id !== req.user.id) throw new H.HttpError(409, 'That device is already registered to another account.');
    db.prepare('INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth,created_at) VALUES(?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth').run(req.user.id, s.endpoint, s.keys.p256dh, s.keys.auth, now());
    H.send(res, 201, { subscribed: true });
  });
  route('DELETE', '/api/push/subscribe', async (req, res) => { const b = await H.readJson(req).catch(() => ({})); if (b.endpoint) db.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?').run(req.user.id, b.endpoint); else db.prepare('DELETE FROM push_subscriptions WHERE user_id=?').run(req.user.id); H.send(res, 200, { subscribed: false }); });
  route('GET', '/api/imagery/:topic', async (req, res, m) => H.send(res, 200, await imagery.getImage(db, decodeURIComponent(m.topic), new URL(req.url, 'http://x').searchParams.get('i'))));

  /* ---- static files ---- */
  function serveStatic(req, res) {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel === '/') rel = '/index.html';
    const base = rel.startsWith('/shared/') ? SHARED : PUBLIC, file = path.join(base, rel.startsWith('/shared/') ? rel.slice(8) : rel);
    if (!path.resolve(file).startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return H.send(res, 404, 'Not found');
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' || rel === '/sw.js' ? 'no-cache' : 'no-cache', 'Service-Worker-Allowed': '/' });
    fs.createReadStream(file).pipe(res);
  }

  return async function handler(req, res) {
    for (const [k, v] of Object.entries(H.SECURITY_HEADERS)) res.setHeader(k, v);
    try {
      const url = new URL(req.url, 'http://x');
      if (!url.pathname.startsWith('/api/')) { if (req.method !== 'GET' && req.method !== 'HEAD') throw new H.HttpError(405, 'Method not allowed'); return serveStatic(req, res); }
      if (req.method !== 'GET') { const origin = req.headers.origin; if (origin && new URL(origin).host !== req.headers.host) throw new H.HttpError(403, 'Cross-origin request blocked'); }
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname); if (!m) continue;
        if (!r.public) { req.user = auth.userFromToken(db, H.parseCookies(req).kj_session); if (!req.user) throw new H.HttpError(401, 'Please sign in.'); }
        return await r.handler(req, res, m.groups || {});
      }
      throw new H.HttpError(404, 'Not found');
    } catch (e) {
      if (e instanceof H.HttpError) return H.send(res, e.status, { error: e.message });
      console.error('Unhandled error:', e.stack || e.message);
      H.send(res, 500, { error: 'Something went wrong on the server.' });
    }
  };
}

function start(opts = {}) {
  const db = opts.db || open(path.join(config.dataDir, 'kother.db'));
  if (db.prepare('SELECT 1 FROM jobs WHERE trust_status IS NULL LIMIT 1').get()) trustCheck.reassessAll(db); // listings stored before graded trust statuses existed
  const pipeline = new Pipeline(db, opts.pipeline);
  const server = http.createServer(createApp(db, pipeline));
  return new Promise((resolve) => server.listen(opts.port ?? config.port, opts.host || '127.0.0.1', () => {
    if (!opts.noWorker) { pipeline.start(); pipeline.startScheduler(); }
    resolve({ server, db, pipeline, port: server.address().port, close: () => { pipeline.stop(); pipeline.stopScheduler(); server.close(); } });
  }));
}
if (require.main === module) start({ host: process.env.HOST || '0.0.0.0' }).then(({ port }) => {
  console.log(`Kother job discovery listening on port ${port}`);
  for (const p of providers) { const c = p.configured(); console.log(`  source ${p.name}: ${c.ok ? 'configured' : 'NOT configured — missing ' + c.missing.join(', ')}`); }
  console.log(`  imagery (Pexels): ${imagery.status().configured ? 'configured' : 'not configured'}; web push: ${notify.pushStatus().configured ? 'configured' : 'not configured'}`);
});
module.exports = { start, createApp };
