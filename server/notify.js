'use strict';
/* Notifications: in-app records (always the source of truth) plus optional web push (VAPID). There is NO email channel.
 * Quiet hours, categories, immediate/daily/weekly and per-channel switches all come from the user's profile. */
const config = require('./config');
const { now, j } = require('./db');
const { getProfile } = require('./profile');
const KJ = require('../shared/match');

let webpush = null;
function pushStatus() { const p = config.push; return p.publicKey && p.privateKey ? { configured: true } : { configured: false, missing: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'].filter((k) => !process.env[k]) }; }
function getPush() { if (!webpush) { webpush = require('web-push'); webpush.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey); } return webpush; }

/* ---- time helpers ---- */
function localHour(ts, tz) { try { return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date(ts))) % 24; } catch (_) { return new Date(ts).getUTCHours(); } }
function localDate(ts, tz) { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ts)); } catch (_) { return new Date(ts).toISOString().slice(0, 10); } }
function localWeekday(ts, tz) { try { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(new Date(ts))); } catch (_) { return new Date(ts).getUTCDay(); } }
function inQuiet(ts, n) { const h = localHour(ts, n.tz), s = n.quietStart, e = n.quietEnd; if (s === e) return false; return s < e ? h >= s && h < e : h >= s || h < e; }
function nextAllowed(ts, n) { let t = ts, i = 0; while (inQuiet(t, n) && i++ < 60) t += 30 * 60 * 1000; return t; }

/* ---- creating notifications ---- */
function enabled(profile, category) { const n = profile.notify; return n.enabled && n.categories[category] !== false; }
function describeJob(job, match) {
  const where = job.remote ? 'Remote' : [job.city, job.state].filter(Boolean).join(', ') || 'Location not listed';
  const pay = KJ.salaryText(job) || 'Salary not listed';
  const why = (match.reasons && match.reasons[0]) || KJ.CLASS_LABEL[match.classification];
  return { title: `${job.title} — ${job.employer}`, body: `${where} · ${pay}. Why: ${why}.`, link: `/#/job/${job.id}` };
}
/* INSERT OR IGNORE on (user, kind, signature) is what prevents repeat notifications. */
function create(db, userId, { jobId = null, kind, signature, title, body, link, deliverAfter }) {
  const r = db.prepare('INSERT OR IGNORE INTO notifications(user_id,job_id,kind,signature,title,body,link,deliver_after,delivered,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(userId, jobId, kind, String(signature), title, body, link || null, deliverAfter ?? now(), '{}', now());
  return r.changes > 0;
}
function notifyNewMatch(db, userId, job, match) {
  const p = getProfile(db, userId); if (!enabled(p, 'newMatches')) return false;
  const d = describeJob(job, match);
  return create(db, userId, { jobId: job.id, kind: 'new_match', signature: String(job.id), title: d.title, body: d.body, link: d.link, deliverAfter: p.notify.immediate ? nextAllowed(now(), p.notify) : now() + 10 * 365 * 864e5 });
}
function notifyProfileUpdate(db, userId, revision, newlyStrong, total) {
  const p = getProfile(db, userId); if (!enabled(p, 'profileUpdates')) return false;
  return create(db, userId, { kind: 'profile_update', signature: `rev${revision}`, title: 'Your profile update improved your recommendations', body: `${newlyStrong} job${newlyStrong === 1 ? ' is' : 's are'} now a strong match (${total} strong matches in total).`, link: '/#/discover', deliverAfter: nextAllowed(now(), p.notify) });
}
function notifyJobChanged(db, userId, job, what) {
  const p = getProfile(db, userId); if (!enabled(p, 'deadlines')) return false;
  return create(db, userId, { jobId: job.id, kind: 'job_changed', signature: `${job.id}:${what.join('+')}:${job.deadline || ''}:${job.salaryMin || ''}-${job.salaryMax || ''}`, title: `Updated: ${job.title} — ${job.employer}`, body: `Listing details changed (${what.join(', ')}). Open it to review.`, link: `/#/job/${job.id}`, deliverAfter: nextAllowed(now(), p.notify) });
}
function notifySourceIssue(db, userId, provider, message) {
  const p = getProfile(db, userId); if (!enabled(p, 'sourceIssues')) return false;
  return create(db, userId, { kind: 'source_issue', signature: `${provider}:${localDate(now(), p.notify.tz)}`, title: `${provider} search problem`, body: `${message} Your existing results are unchanged.`, link: '/#/settings', deliverAfter: nextAllowed(now(), p.notify) });
}
function notifyDeadlines(db, userId) {
  const p = getProfile(db, userId); if (!enabled(p, 'deadlines')) return 0;
  const rows = db.prepare("SELECT jb.* FROM user_jobs u JOIN jobs jb ON jb.id=u.job_id WHERE u.user_id=? AND u.saved_at IS NOT NULL AND jb.deadline IS NOT NULL AND jb.deadline >= ? AND jb.deadline <= ? AND jb.status='active' AND jb.id NOT IN (SELECT job_id FROM applications WHERE user_id=?)")
    .all(userId, new Date().toISOString().slice(0, 10), new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10), userId);
  let n = 0; for (const r of rows) if (create(db, userId, { jobId: r.id, kind: 'deadline', signature: `${r.id}:${r.deadline}`, title: `Deadline ${r.deadline}: ${r.title}`, body: `${r.employer} — you saved this job and it closes soon.`, link: `/#/job/${r.id}`, deliverAfter: nextAllowed(now(), p.notify) })) n++;
  return n;
}
/* Daily/weekly digest of matches surfaced since the last digest. */
function maybeDigest(db, userId, t) {
  t = t || now();
  const p = getProfile(db, userId), n = p.notify; if (!enabled(p, 'newMatches')) return 0;
  const last = (kind) => (db.prepare('SELECT MAX(created_at) AS t FROM notifications WHERE user_id=? AND kind=?').get(userId, kind) || {}).t || 0;
  let made = 0;
  for (const [kind, on, since, sig] of [['digest_daily', n.daily && localHour(t, n.tz) === n.dailyHour, 864e5, localDate(t, n.tz)], ['digest_weekly', n.weekly && localWeekday(t, n.tz) === n.weeklyDay && localHour(t, n.tz) === n.dailyHour, 7 * 864e5, localDate(t, n.tz)]]) {
    if (!on) continue;
    const rows = db.prepare(`SELECT jb.*, m.detail FROM user_jobs u JOIN jobs jb ON jb.id=u.job_id JOIN matches m ON m.job_id=jb.id AND m.user_id=u.user_id
      WHERE u.user_id=? AND u.first_surfaced >= ? AND m.classification IN ('strong','potential') AND jb.status='active' AND u.dismissed_at IS NULL AND m.excluded=0 ORDER BY m.overall DESC LIMIT 8`).all(userId, Math.max(t - since, last(kind)));
    if (!rows.length) continue;
    const lines = rows.map((r) => { const job = require('./jobs').jobView(r), d = describeJob(job, j(r.detail, {})); return `• ${d.title}\n  ${d.body}\n  ${config.publicUrl}${d.link}`; });
    if (create(db, userId, { kind, signature: sig, title: kind === 'digest_daily' ? `Daily summary: ${rows.length} job${rows.length === 1 ? '' : 's'} to look at` : `Weekly summary: ${rows.length} job${rows.length === 1 ? '' : 's'} to look at`, body: lines.join('\n'), link: '/#/discover', deliverAfter: t })) made++;
  }
  return made;
}

/* ---- delivery to external channels ---- */
async function deliverDue(db, t) {
  t = t || now();
  const rows = db.prepare('SELECT n.*, u.email FROM notifications n JOIN users u ON u.id=n.user_id WHERE n.deliver_after <= ? AND n.created_at > ? AND n.delivered NOT LIKE \'%"done"%\' ORDER BY n.id LIMIT 100').all(t, t - 7 * 864e5);
  const results = [];
  for (const n of rows) {
    const d = j(n.delivered, {}), p = getProfile(db, n.user_id), pref = p.notify;
    let dirty = false;
    const skip = !pref.enabled || (n.kind === 'new_match' && !pref.immediate); // new matches go out in digests only when immediate alerts are off
    if (!skip && pref.push && !d.push) {
      const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id=?').all(n.user_id);
      if (!pushStatus().configured) d.push = { error: 'push not configured' };
      else if (!subs.length) d.push = { error: 'no subscribed device' };
      else {
        let ok = 0, fail = 0, why = '';
        for (const s of subs) try { await getPush().sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title: n.title, body: n.body.split('\n')[0], url: n.link || '/' }), { TTL: 86400 }); ok++; } catch (e) { fail++; why = String(e.statusCode || e.code || e.message).slice(0, 80); if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(s.id); }
        d.push = ok ? { sent: t, devices: ok } : { error: `delivery failed on ${fail} device(s)${why ? ' (' + why + ')' : ''}` };
      }
      dirty = true;
    }
    d.done = t; db.prepare('UPDATE notifications SET delivered=? WHERE id=?').run(JSON.stringify(d), n.id); if (dirty) results.push({ id: n.id, delivered: d });
  }
  return results;
}
module.exports = { pushStatus, create, notifyNewMatch, notifyProfileUpdate, notifyJobChanged, notifySourceIssue, notifyDeadlines, maybeDigest, deliverDue, inQuiet, nextAllowed, localHour, describeJob };
