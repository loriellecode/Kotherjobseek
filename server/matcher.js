'use strict';
/* Server-side matching: evaluate every live job against the user's latest saved profile. */
const KJ = require('../shared/match');
const { now, j, tx } = require('./db');
const { getProfile } = require('./profile');
const { jobView } = require('./jobs');
const careersEngine = require('./careers');

function latestResumeText(db, userId) { const r = db.prepare('SELECT text FROM resumes WHERE user_id=? ORDER BY id DESC LIMIT 1').get(userId); return r ? r.text : ''; }

function rematchUser(db, userId) {
  const base = getProfile(db, userId), resumeText = latestResumeText(db, userId), t = now();
  const careers = careersEngine.compute(db, userId, { profile: base, stats: false, wide: true });
  const profile = Object.assign({}, base, { careerTerms: careers.careerTerms, categories: [...new Set([...(base.categories || []), ...careers.expandedCategories])] }); // evidence-backed expansion
  const rows = db.prepare("SELECT * FROM jobs WHERE status != 'closed'").all();
  const up = db.prepare('INSERT INTO matches(user_id,job_id,revision,classification,overall,excluded,detail,computed_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id,job_id) DO UPDATE SET revision=excluded.revision, classification=excluded.classification, overall=excluded.overall, excluded=excluded.excluded, detail=excluded.detail, computed_at=excluded.computed_at');
  return tx(db, () => {
    let strong = 0;
    for (const row of rows) {
      const ev = KJ.evaluate(jobView(row, t), profile, { resumeText });
      up.run(userId, row.id, base.revision, ev.classification, ev.overall, (ev.excluded.belowFloor || ev.excluded.farArea) ? 1 : 0, JSON.stringify(ev), t);
      if (ev.classification === 'strong') strong++;
    }
    return { count: rows.length, strong, revision: base.revision };
  });
}

/* Job ids that are currently a strong match and eligible for the default feed. */
function strongIds(db, userId) {
  const profile = getProfile(db, userId), showBelow = !!profile.salary.showBelow;
  return new Set(db.prepare(`SELECT m.job_id FROM matches m JOIN jobs jb ON jb.id=m.job_id LEFT JOIN user_jobs u ON u.user_id=m.user_id AND u.job_id=m.job_id
    WHERE m.user_id=? AND m.classification='strong' AND jb.status='active' AND u.dismissed_at IS NULL ${showBelow ? '' : 'AND m.excluded=0'}`).all(userId).map((r) => r.job_id));
}

/* Only show listings that say something about the job and give a way to apply (a link, or an email address to apply by). */
function hasInfoAndWayToApply(r) { return !!((r.description || r.summary) && String(r.description || r.summary).trim().length >= 40 && (r.apply_url || r.email_apply || r.trust_status === 'high_risk')); }

/* The API feed: jobs + their match + the user's own state. */
function feedFor(db, userId) {
  const t = now();
  const rows = db.prepare(`SELECT jb.*, m.detail AS m_detail, m.classification AS m_class, u.first_surfaced, u.saved_at, u.dismissed_at, u.reported
    FROM jobs jb JOIN matches m ON m.job_id=jb.id AND m.user_id=? LEFT JOIN user_jobs u ON u.job_id=jb.id AND u.user_id=?
    WHERE jb.status != 'closed' OR u.saved_at IS NOT NULL OR jb.id IN (SELECT job_id FROM applications WHERE user_id=?)
    ORDER BY m.overall DESC LIMIT 2000`).all(userId, userId, userId);
  return rows.filter((r) => KJ.inSearchStates({ state: r.state, locationText: r.location_text, city: r.city, remote: !!r.remote }) && r.trust_status !== 'blocked' && hasInfoAndWayToApply(r)).map((r) => Object.assign(jobView(r, t), { match: j(r.m_detail, null), userState: { saved: r.saved_at || null, dismissed: r.dismissed_at || null, reported: r.reported || null, firstSurfaced: r.first_surfaced || null } }));
}
module.exports = { rematchUser, strongIds, feedFor, latestResumeText };
