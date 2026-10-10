'use strict';
/* The phone edition's job source: a single JSON file (jobs.json) published next to the app. A scheduled GitHub Action refreshes it from
 * Adzuna/USAJOBS using keys held in GitHub Secrets (see scripts/fetch-jobs.js), so no API key is ever in the app or on the phone.
 * The file contains public job listings only — nothing about the person using the app. */
const { ProviderError } = require('./util');

/* After the list is read, listings that are no longer in it are closed (kept only if she saved or applied to them), so removed or old
 * listings — including anything from an earlier version of the list — never linger on her phone. */
function reconcile(db, listings) {
  const keep = new Set(listings.map((l) => String(l.externalId)));
  const rows = db.prepare("SELECT id, external_id FROM jobs WHERE provider='static' AND status!='closed'").all();
  const gone = rows.filter((r) => !keep.has(String(r.external_id))); if (!gone.length) return 0;
  const up = db.prepare("UPDATE jobs SET status='closed' WHERE id=?");
  db.exec('BEGIN'); try { for (const r of gone) up.run(r.id); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  return gone.length;
}

module.exports = {
  reconcile,
  id: 'static', name: 'Daily job list', kind: 'feed', docs: 'See README → “Phone edition”.',
  setup: ['The list is refreshed by the “Publish app” GitHub workflow (needs ADZUNA_APP_ID / ADZUNA_APP_KEY and/or USAJOBS_API_KEY / USAJOBS_USER_EMAIL as repository secrets).'],
  budget: () => 1000000,
  configured: () => ({ ok: true, missing: [] }),
  queriesFor: () => [{ what: 'daily list', where: 'California', key: 'static:list' }],
  async search() {
    const url = globalThis.__KJ_JOBS_URL || 'jobs.json';
    let res; try { res = await fetch(url, { cache: 'no-cache' }); } catch (e) { throw new ProviderError('The daily job list could not be loaded. Check your connection and try again.'); }
    if (!res.ok) throw new ProviderError(`The daily job list is not published yet (HTTP ${res.status}). Run the “Publish app” workflow on GitHub with your job-search keys set.`);
    let data; try { data = await res.json(); } catch (_) { throw new ProviderError('The daily job list is not valid JSON.'); }
    const jobs = (Array.isArray(data) ? data : data.jobs || []).filter((x) => x && x.externalId && x.title);
    return { listings: jobs, total: jobs.length, generatedAt: data.generatedAt || null };
  },
};
