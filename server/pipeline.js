'use strict';
/* Search + matching pipeline: a debounced task queue, a single worker, and a scheduler.
 *
 * Profile change -> revision -> task queued (edits within RESCAN_DEBOUNCE_MS merge into ONE task)
 *   -> searching (only if the change needs fresh listings) -> matching -> updating feed -> done | failed.
 * "done" is written only after every step has actually finished. Failures keep all existing results. */
const config = require('./config');
const { now, j, tx } = require('./db');
const KJ = require('../shared/match');
const { getProfile } = require('./profile');
const providers = require('./providers');
const { planSearches } = require('./queries');
const { normalizeListing } = require('./normalize');
const { upsertJob, sweepStatuses, jobView } = require('./jobs');
const { rematchUser, strongIds, feedFor } = require('./matcher');
const careersEngine = require('./careers');
const notify = require('./notify');

const SEARCH_CLASSES = new Set(['broad', 'location', 'resume']);
const LABELS = { queued: 'Search queued', searching: 'Searching for jobs', matching: 'Matching jobs to your profile', updating: 'Updating recommendations', done: 'Results updated', failed: 'Search failed' };

class Pipeline {
  constructor(db, opts = {}) { this.db = db;
    // Crash/restart recovery: a task that was mid-run when the process stopped goes back in the queue (searches are idempotent).
    db.prepare("UPDATE tasks SET status='queued', stage='queued', run_after=? WHERE status='running'").run(now());
    this.providers = opts.providers || providers; this.running = false; this.timer = null; this.listeners = []; this.debounceMs = opts.debounceMs ?? config.debounceMs; }

  /* ---- queue ---- */
  enqueue(userId, { classes = [], reason = 'profile', force = false, search = null, revision = null } = {}) {
    const t = now();
    const needsSearch = search !== null ? search : classes.some((c) => SEARCH_CLASSES.has(c));
    const pending = this.db.prepare("SELECT * FROM tasks WHERE user_id=? AND status='queued' ORDER BY id DESC LIMIT 1").get(userId);
    const delay = reason === 'profile' ? this.debounceMs : 0;
    if (pending) { // consolidate rapid edits into the one waiting task
      const sc = j(pending.scope, {}), merged = { classes: [...new Set([...(sc.classes || []), ...classes])], force: !!(sc.force || force), search: !!(sc.search || needsSearch) };
      this.db.prepare('UPDATE tasks SET scope=?, run_after=?, revision=?, reason=? WHERE id=?').run(JSON.stringify(merged), t + delay, revision ?? pending.revision, reason === 'profile' ? pending.reason : reason, pending.id);
      return pending.id;
    }
    return Number(this.db.prepare("INSERT INTO tasks(user_id,kind,reason,scope,status,stage,run_after,revision,created_at) VALUES(?,?,?,?,'queued','queued',?,?,?)").run(userId, 'search', reason, JSON.stringify({ classes, force, search: needsSearch }), t + delay, revision, t).lastInsertRowid);
  }
  statusFor(userId) {
    const row = this.db.prepare("SELECT * FROM tasks WHERE user_id=? ORDER BY CASE WHEN status IN ('queued','running') THEN 0 ELSE 1 END, id DESC LIMIT 1").get(userId);
    if (!row) return { state: 'idle', label: 'No search has run yet' };
    const state = row.status === 'running' ? row.stage : row.status;
    const result = j(row.result, null);
    let label = LABELS[state] || state;
    if (state === 'done' && result && result.searched === false) label = result.noSourcesConfigured ? 'Recommendations updated — no job sources are configured, so no new listings were retrieved' : 'Recommendations updated';
    else if (state === 'done' && result && result.partial) label = 'Results updated — some searches failed';
    return { id: row.id, state, stage: row.stage, label, reason: row.reason, queuedAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at, error: row.error, result, canRetry: row.status === 'failed' };
  }

  /* ---- worker ---- */
  start() { if (this.timer) return; this.timer = setInterval(() => this.tick().catch((e) => console.error('pipeline tick failed:', e.message)), 1000); this.timer.unref && this.timer.unref(); }
  stop() { clearInterval(this.timer); this.timer = null; }
  async tick() { if (this.running) return; this.running = true; try { await this.processDue(); await notify.deliverDue(this.db); } finally { this.running = false; } }
  async processDue(ignoreDelay) {
    for (;;) {
      const task = this.db.prepare(`SELECT * FROM tasks WHERE status='queued' AND run_after <= ? ORDER BY run_after, id LIMIT 1`).get(ignoreDelay ? Number.MAX_SAFE_INTEGER : now());
      if (!task) return;
      await this.runTask(task);
    }
  }
  /* Test/maintenance helper: run everything that is queued now. */
  async drain() { const was = this.running; this.running = true; try { await this.processDue(true); await notify.deliverDue(this.db); } finally { this.running = was; } }

  setStage(id, stage) { this.db.prepare('UPDATE tasks SET stage=? WHERE id=?').run(stage, id); this.listeners.forEach((f) => f(id, stage)); }
  async runTask(task) {
    const scope = j(task.scope, {}), userId = task.user_id;
    this.db.prepare("UPDATE tasks SET status='running', stage='searching', started_at=? WHERE id=?").run(now(), task.id);
    try {
      const before = strongIds(this.db, userId);
      const result = { searched: false, created: 0, updated: 0, duplicates: 0, errors: [], queries: 0, skippedRecent: 0 };
      if (scope.search) { this.setStage(task.id, 'searching'); await this.searchForUser(userId, { force: scope.force, result, manual: task.reason === 'manual', wide: (scope.classes || []).includes('resume') }); }
      this.setStage(task.id, 'matching');
      sweepStatuses(this.db);
      const m = rematchUser(this.db, userId);
      this.setStage(task.id, 'updating');
      const after = strongIds(this.db, userId);
      result.matched = m.count; result.strong = after.size; result.revision = m.revision;
      this.surfaceAndNotify(userId, task, before, after, result);
      const allFailed = scope.search && result.searched && result.queries > 0 && result.errors.length >= result.queries && result.created + result.updated + result.duplicates === 0;
      if (allFailed) {
        this.db.prepare("UPDATE tasks SET status='failed', stage='failed', error=?, result=?, finished_at=? WHERE id=?").run(result.errors[0].message, JSON.stringify(result), now(), task.id);
      } else {
        result.partial = result.errors.length > 0;
        this.db.prepare("UPDATE tasks SET status='done', stage='done', result=?, finished_at=? WHERE id=?").run(JSON.stringify(result), now(), task.id);
      }
    } catch (e) {
      this.db.prepare("UPDATE tasks SET status='failed', stage='failed', error=?, finished_at=? WHERE id=?").run(String(e.message).slice(0, 300), now(), task.id);
    }
  }

  async searchForUser(userId, { force, result, manual, wide }) {
    const profile = getProfile(this.db, userId);
    if (!profile.searchEnabled && !manual) { result.skipped = 'search disabled'; return; }
    const configured = this.providers.filter((p) => p.configured().ok);
    if (!configured.length) { result.noSourcesConfigured = true; return; }
    result.searched = true;
    const t0 = now(), dayStart = t0 - 864e5;
    for (const prov of configured) {
      const careers = careersEngine.compute(this.db, userId, { profile, stats: false, wide });
      result.careerTerms = careers.searchTerms.length; if (wide) result.expanded = true;
      let plan = planSearches(profile, prov, wide ? Math.round(config.maxQueriesPerScan * 1.5) : config.maxQueriesPerScan, careers);
      let used = this.db.prepare("SELECT COUNT(*) AS n FROM search_log WHERE provider=? AND started_at>? AND status IN ('ok','failed')").get(prov.id, dayStart).n;
      for (const q of plan) {
        const key = q.key || `${q.what}|${q.where}`;
        if (!force) {
          const recent = this.db.prepare("SELECT 1 FROM search_log WHERE provider=? AND query_key=? AND status='ok' AND started_at>?").get(prov.id, key, now() - config.minRepeatSearchMinutes * 60000);
          if (recent) { result.skippedRecent++; continue; }
        }
        if (used >= prov.budget()) { result.errors.push({ provider: prov.id, message: `${prov.name}: today's request budget (${prov.budget()}) is used up; remaining searches wait until tomorrow.` }); break; }
        used++; result.queries++;
        const logId = Number(this.db.prepare("INSERT INTO search_log(provider,query_key,user_id,started_at,status) VALUES(?,?,?,?,'running')").run(prov.id, key, userId, now()).lastInsertRowid);
        try {
          const res = await prov.search(q);
          let fresh = 0;
          for (const raw of res.listings) {
            const n = normalizeListing(raw, prov.id, now()); if (!n) continue;
            if (!KJ.inSearchStates({ state: n.state, locationText: n.location_text, city: n.city, remote: n.remote })) { result.outsideStates = (result.outsideStates || 0) + 1; continue; }
            const r = upsertJob(this.db, n);
            if (r.created) { result.created++; fresh++; } else if (r.duplicate) result.duplicates++; else { result.updated++; if (r.changed.length) this.noteChange(userId, r.id, r.changed); }
          }
          if (prov.reconcile) prov.reconcile(this.db, res.listings);
          this.db.prepare("UPDATE search_log SET status='ok', finished_at=?, result_count=?, new_count=? WHERE id=?").run(now(), res.listings.length, fresh, logId);
        } catch (e) {
          this.db.prepare("UPDATE search_log SET status='failed', finished_at=?, error=? WHERE id=?").run(now(), String(e.message).slice(0, 300), logId);
          result.errors.push({ provider: prov.id, message: e.message });
          notify.notifySourceIssue(this.db, userId, prov.name, e.message);
          if (e.status === 401 || e.status === 403 || e.status === 429) break; // credentials/rate limit: stop hammering this provider
        }
      }
    }
  }
  noteChange(userId, jobId, changed) {
    const saved = this.db.prepare('SELECT 1 FROM user_jobs WHERE user_id=? AND job_id=? AND saved_at IS NOT NULL').get(userId, jobId) || this.db.prepare('SELECT 1 FROM applications WHERE user_id=? AND job_id=?').get(userId, jobId);
    if (saved) notify.notifyJobChanged(this.db, userId, jobView(this.db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId)), changed);
  }

  /* Identify genuinely new matches (never surfaced before) and notify per the user's settings. */
  surfaceAndNotify(userId, task, before, after, result) {
    const profile = getProfile(this.db, userId), firstRun = this.db.prepare('SELECT COUNT(*) AS n FROM user_jobs WHERE user_id=? AND first_surfaced IS NOT NULL').get(userId).n === 0;
    const rows = this.db.prepare(`SELECT jb.*, m.detail, m.classification, m.excluded FROM matches m JOIN jobs jb ON jb.id=m.job_id LEFT JOIN user_jobs u ON u.user_id=m.user_id AND u.job_id=m.job_id
      WHERE m.user_id=? AND jb.status='active' AND m.classification IN ('strong','potential') AND (u.first_surfaced IS NULL) AND (m.excluded=0 OR ?)`).all(userId, profile.salary.showBelow ? 1 : 0);
    const newIds = [], t = now();
    for (const r of rows) {
      this.db.prepare('INSERT INTO user_jobs(user_id,job_id,first_surfaced) VALUES(?,?,?) ON CONFLICT(user_id,job_id) DO UPDATE SET first_surfaced=excluded.first_surfaced').run(userId, r.id, t);
      newIds.push(r.id);
    }
    result.newMatches = newIds.length;
    let sent = 0;
    for (const r of rows) if (r.classification === 'strong' && !firstRun && sent < 10) { if (notify.notifyNewMatch(this.db, userId, jobView(r), j(r.detail, {}))) sent++; }
    if (firstRun && newIds.length) notify.create(this.db, userId, { kind: 'first_results', signature: 'first', title: 'Your first results are ready', body: `${newIds.length} listings were found and matched to your profile.`, link: '/#/discover', deliverAfter: t });
    result.notificationsCreated = sent;
    if (task.reason === 'profile' && !firstRun) {
      const newlyStrong = [...after].filter((id) => !before.has(id)).length;
      if (newlyStrong > 0 && notify.notifyProfileUpdate(this.db, userId, result.revision ?? (j(task.scope, {}).revision || task.revision || 0), newlyStrong, after.size)) result.profileUpdateNotified = true;
    }
  }

  /* ---- scheduler ---- */
  async scheduleTick(t) {
    t = t || now();
    sweepStatuses(this.db, t);
    for (const u of this.db.prepare('SELECT user_id FROM profiles').all()) {
      const p = getProfile(this.db, u.user_id);
      if (p.searchEnabled) {
        const last = this.db.prepare("SELECT MAX(COALESCE(finished_at, created_at)) AS t FROM tasks WHERE user_id=? AND status IN ('done','queued','running') AND reason IN ('scheduled','manual','profile')").get(u.user_id).t || 0;
        if (t - last >= config.scanIntervalHours * 3600000) this.enqueue(u.user_id, { reason: 'scheduled', search: true });
      }
      notify.notifyDeadlines(this.db, u.user_id);
      notify.maybeDigest(this.db, u.user_id, t);
    }
  }
  startScheduler() { if (this.sched || !config.schedulerEnabled) return; this.sched = setInterval(() => this.scheduleTick().catch((e) => console.error('scheduler failed:', e.message)), 60000); this.sched.unref && this.sched.unref(); setTimeout(() => this.scheduleTick().catch(() => {}), 3000).unref(); }
  stopScheduler() { clearInterval(this.sched); this.sched = null; }
}
module.exports = { Pipeline, LABELS };
