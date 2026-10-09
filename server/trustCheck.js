'use strict';
/* Re-checking a listing's trust. Gathers supporting evidence from our own data (other sources that list the same job, the employer's own
 * careers feed) and — when allowed — does a guarded live check of the application page, then stores the new assessment with its evidence and time. */
const { now, j } = require('./db');
const config = require('./config');
const trust = require('./trust');
const { safeFetch } = require('./safeFetch');

const hostOf = (u) => { const p = trust.parseUrl(u); return p.host || ''; };

function context(db, row) {
  const emp = String(row.employer || '').trim().toLowerCase(), title = String(row.title || '').trim().toLowerCase();
  const others = [], seen = new Set();
  for (const a of j(row.also_listed, [])) { const h = hostOf(a.url); if (h && !seen.has(h)) { seen.add(h); others.push({ provider: a.provider, host: h, url: a.url, trust: a.trust }); } }
  if (emp) for (const o of db.prepare("SELECT provider, apply_url, trust_status FROM jobs WHERE id!=? AND status='active' AND lower(employer)=? AND lower(title)=? AND apply_url IS NOT NULL").all(row.id, emp, title)) {
    const h = hostOf(o.apply_url); if (h && h !== hostOf(row.apply_url) && !seen.has(h)) { seen.add(h); others.push({ provider: o.provider, host: h, url: o.apply_url, trust: o.trust_status }); }
  }
  let feedHost = null;
  if (emp) { const f = db.prepare("SELECT apply_url FROM jobs WHERE provider='feeds' AND lower(employer)=? AND apply_url IS NOT NULL LIMIT 1").get(emp); if (f) feedHost = hostOf(f.apply_url); }
  return { otherSources: others, feedHost };
}
function listingOf(row) {
  const ea = j(row.email_apply, null);
  return { provider: row.provider, applyUrl: row.apply_url, employer: row.employer, title: row.title, description: row.description, summary: row.summary, salaryMin: row.salary_min, salaryMax: row.salary_max, deadline: row.deadline, emailApply: ea };
}
function save(db, row, a) {
  db.prepare('UPDATE jobs SET trust_status=?, link_level=?, trust_detail=?, trust_checked_at=?, apply_url=? WHERE id=?')
    .run(a.status, a.status, JSON.stringify({ label: a.label, reasons: a.reasons, evidence: a.evidence, host: a.host, expired: a.expired, checks: a.checks }), a.checkedAt, a.url, row.id);
}
/* Offline re-assessment of every stored listing (cheap; run after the rules change or the data does). */
function reassessAll(db) { let n = 0; for (const row of db.prepare("SELECT * FROM jobs WHERE status!='closed'").all()) { save(db, row, trust.assess(listingOf(row), Object.assign(context(db, row), { now: now() }))); n++; } return n; }

/* Re-check one job. opts.network (default config.trust.networkChecks) controls the live page check. Returns the assessment. */
async function recheck(db, id, opts) {
  opts = opts || {}; const row = db.prepare('SELECT * FROM jobs WHERE id=?').get(id); if (!row) return null;
  const ctx = Object.assign(context(db, row), { now: now() });
  const network = opts.network ?? config.trust.networkChecks;
  if (network && row.apply_url && trust.parseUrl(row.apply_url).url && !trust.parseUrl(row.apply_url).creds) {
    ctx.page = await (opts.fetch || safeFetch)(row.apply_url, { allowPrivate: config.trust.allowPrivateFetch, allowAnyPort: config.trust.allowPrivateFetch, lookup: opts.lookup });
  }
  const a = trust.assess(listingOf(row), ctx); save(db, row, a); return a;
}
module.exports = { recheck, reassessAll, context };
