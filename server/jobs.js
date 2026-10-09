'use strict';
/* Job storage: upsert with deduplication, lifecycle status, and the API view of a job. */
const { now, j, tx } = require('./db');
const config = require('./config');

const COLS = ['title', 'employer', 'city', 'state', 'location_text', 'neighborhood', 'lat', 'lon', 'arrangement', 'remote', 'salary_min', 'salary_max', 'salary_period', 'salary_estimated', 'comp_note', 'employment_type', 'description', 'summary', 'required', 'preferred', 'edu_level', 'edu_inferred', 'edu_preferred', 'exp_years', 'exp_field', 'exp_inferred', 'exp_preferred', 'certs', 'categories', 'apply_url', 'link_level', 'link_notes', 'trust_status', 'trust_detail', 'trust_checked_at', 'email_apply', 'logo_url', 'published', 'deadline', 'retrieved_at', 'raw_hash'];

function upsertJob(db, n, t) {
  t = t || now();
  const base = { fingerprint: n.fingerprint, url_key: n.url_key };
  return tx(db, () => {
    const exact = db.prepare('SELECT * FROM jobs WHERE provider=? AND external_id=?').get(n.provider, n.external_id);
    if (exact) {
      // Keep the result of a live re-check while the link is unchanged; otherwise take the fresh offline assessment.
      const keepCheck = exact.apply_url === n.apply_url && /Live page check/.test(exact.trust_detail || '');
      const cols = keepCheck ? COLS.filter((c) => !/^trust_|^link_level$/.test(c)) : COLS;
      const sets = cols.map((c) => `${c}=?`).join(',');
      const changed = [];
      if (exact.salary_min !== n.salary_min || exact.salary_max !== n.salary_max) changed.push('salary');
      if (exact.deadline !== n.deadline) changed.push('deadline');
      if (exact.status !== 'active') changed.push('reopened');
      db.prepare(`UPDATE jobs SET ${sets}, fingerprint=?, url_key=?, last_seen=?, last_verified=?, status='active' WHERE id=?`).run(...cols.map((c) => n[c] ?? null), n.fingerprint, n.url_key, t, t, exact.id);
      return { id: exact.id, created: false, changed };
    }
    let dup = n.url_key ? db.prepare('SELECT * FROM jobs WHERE url_key=?').get(n.url_key) : null;
    if (!dup) {
      const cands = db.prepare('SELECT * FROM jobs WHERE fingerprint=?').all(n.fingerprint);
      dup = cands.find((c) => !c.published || !n.published || Math.abs(new Date(c.published) - new Date(n.published)) < 30 * 864e5) || null;
    }
    if (dup) {
      const also = j(dup.also_listed, []);
      const key = `${n.provider}:${n.external_id}`;
      if (!also.some((a) => a.key === key) && !(dup.provider === n.provider && dup.external_id === n.external_id))
        also.push({ key, provider: n.provider, url: n.apply_url, seen: t });
      // Fill gaps in the canonical record from the duplicate, never overwrite what is already known.
      const fill = {}; for (const c of ['salary_min', 'salary_max', 'salary_period', 'deadline', 'published', 'logo_url', 'edu_level', 'exp_years', 'neighborhood']) if (dup[c] === null && n[c] !== null && n[c] !== undefined) fill[c] = n[c];
      const keys = Object.keys(fill);
      db.prepare(`UPDATE jobs SET also_listed=?, last_seen=?, last_verified=?, status='active'${keys.map((k) => `, ${k}=?`).join('')} WHERE id=?`).run(JSON.stringify(also), t, t, ...keys.map((k) => fill[k]), dup.id);
      return { id: dup.id, created: false, duplicate: true, changed: [] };
    }
    const cols = ['provider', 'external_id', 'fingerprint', 'url_key', ...COLS, 'first_seen', 'last_seen', 'last_verified', 'status'];
    const info = db.prepare(`INSERT INTO jobs(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(n.provider, n.external_id, base.fingerprint, base.url_key, ...COLS.map((c) => n[c] ?? null), t, t, t, 'active');
    return { id: Number(info.lastInsertRowid), created: true, changed: [] };
  });
}

/* Lifecycle. "verified" only means a provider returned this listing recently — never that it is certainly open. */
function sweepStatuses(db, t) {
  t = t || now();
  const today = new Date(t).toISOString().slice(0, 10);
  db.prepare("UPDATE jobs SET status='expired' WHERE deadline IS NOT NULL AND deadline < ? AND status NOT IN ('closed','expired')").run(today);
  db.prepare("UPDATE jobs SET status='possibly_expired' WHERE status='active' AND last_seen < ?").run(t - config.staleAfterDays * 864e5);
}
function verification(row, t) {
  t = t || now();
  if (['closed', 'expired'].includes(row.status)) return 'closed';
  if (row.status === 'possibly_expired') return 'possibly_expired';
  return row.last_verified && t - row.last_verified <= config.verifiedWithinDays * 864e5 ? 'verified' : 'unverified';
}

/* Trust status → what the API exposes. High-risk and blocked listings never expose a direct application action. */
const trust = require('./trust');
function trustStatus(row) { return row.trust_status || (row.apply_url ? 'closer_look' : null); }
function applyAllowed(row) { const st = trustStatus(row); return !st || trust.visibleApply(st); }
function trustView(row) {
  const st = trustStatus(row), d = j(row.trust_detail, {});
  if (!st) return { level: null, label: '', host: '', reasons: [], evidence: [], notes: [], checkedAt: null, checks: null, expired: false };
  const reasons = d.reasons || [{ kind: 'info', text: 'Employer connection not confirmed.' }];
  return { level: st, label: trust.LABELS[st], host: d.host || '', reasons, notes: reasons.map((r) => r.text), evidence: d.evidence || [], checkedAt: row.trust_checked_at || null, checks: d.checks || null, expired: !!d.expired };
}

function jobView(row, t) {
  return {
    id: row.id, provider: row.provider, externalId: row.external_id, title: row.title, employer: row.employer, city: row.city, state: row.state, locationText: row.location_text, neighborhood: row.neighborhood,
    lat: row.lat, lon: row.lon, arrangement: row.arrangement, remote: !!row.remote, salaryMin: row.salary_min, salaryMax: row.salary_max, salaryPeriod: row.salary_period || 'year', salaryEstimated: !!row.salary_estimated, compNote: row.comp_note,
    type: row.employment_type, description: row.description, summary: row.summary, required: j(row.required, []), preferred: j(row.preferred, []),
    education: row.edu_level ? { level: row.edu_level, inferred: !!row.edu_inferred, preferred: !!row.edu_preferred } : null, experience: row.exp_years ? { years: row.exp_years, field: row.exp_field, inferred: !!row.exp_inferred, preferred: !!row.exp_preferred } : null,
    certifications: j(row.certs, []), categories: j(row.categories, []), applyUrl: applyAllowed(row) ? row.apply_url : null, link: trustView(row), emailApply: applyAllowed(row) ? j(row.email_apply, null) : null, logoUrl: row.logo_url, published: row.published, deadline: row.deadline,
    retrievedAt: row.retrieved_at, firstSeen: row.first_seen, lastSeen: row.last_seen, lastVerified: row.last_verified, status: row.status, verification: verification(row, t), alsoListed: j(row.also_listed, []),
  };
}
/* The matcher expects `education.preferred` / `experience.preferred` — re-derive from stored flags. */
function matcherJob(row) {
  const v = jobView(row);
  return v;
}
module.exports = { trustView, upsertJob, sweepStatuses, jobView, matcherJob, verification };
