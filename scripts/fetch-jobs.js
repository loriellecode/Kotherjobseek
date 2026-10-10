'use strict';
/* Builds jobs.json for the phone edition. Runs in GitHub Actions (never on the phone) with API keys from repository secrets.
 * It runs the real search pipeline for the starter profile (config/initial-profile.json — public job titles/categories and California
 * places only; nothing from the person's own phone) and writes the public listings it finds.
 * Usage: node scripts/fetch-jobs.js [output.json]   Env: ADZUNA_APP_ID/KEY, USAJOBS_API_KEY/USAJOBS_USER_EMAIL */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kother-jobs-'));
process.env.SCHEDULER_ENABLED = 'false'; process.env.MAX_QUERIES_PER_SCAN = process.env.MAX_QUERIES_PER_SCAN || '60'; process.env.MIN_REPEAT_SEARCH_MINUTES = '0';
const config = require('../server/config'), { open, now } = require('../server/db'), P = require('../server/profile'), { Pipeline } = require('../server/pipeline'), providers = require('../server/providers'), KJ = require('../shared/match'), trust = require('../server/trust');
const outFile = process.argv[2] || 'jobs.json';

(async () => {
  const configured = providers.filter((p) => p.configured().ok);
  const meta = { generatedAt: new Date().toISOString(), sources: configured.map((p) => p.name), note: '' };
  if (!configured.length) {
    const snap = process.env.JOBS_SNAPSHOT || path.join(__dirname, '..', 'config', 'jobs-snapshot.json');
    if (fs.existsSync(snap)) { const d = JSON.parse(fs.readFileSync(snap, 'utf8')); d.note = 'Listings from the last saved snapshot (' + d.generatedAt + '). No job-search keys are set, so they were not refreshed. Add the keys as repository secrets to refresh daily.'; console.warn('::warning::' + d.note); fs.writeFileSync(outFile, JSON.stringify(d)); return; }
    meta.note = 'No job-search keys are set, so no listings were fetched. Add ADZUNA_APP_ID/ADZUNA_APP_KEY and/or USAJOBS_API_KEY/USAJOBS_USER_EMAIL as repository secrets, then run “Publish app” again.';
    console.warn('::warning::' + meta.note); fs.writeFileSync(outFile, JSON.stringify(Object.assign(meta, { jobs: [] }))); return;
  }
  const db = open(path.join(config.dataDir, 'jobs.db')), id = Number(db.prepare('INSERT INTO users(email,pw_hash,created_at) VALUES(?,?,?)').run('starter@local', 'x', now()).lastInsertRowid);
  P.ensureProfile(db, id); P.applyInitialProfile(db, id);
  const pipeline = new Pipeline(db, { debounceMs: 0 });
  pipeline.enqueue(id, { classes: ['broad', 'location'], reason: 'manual', force: true, search: true }); await pipeline.drain();
  pipeline.enqueue(id, { classes: ['resume'], reason: 'manual', force: true, search: true }); await pipeline.drain(); // second, wider pass
  const err = db.prepare("SELECT error FROM tasks WHERE status='failed' ORDER BY id DESC LIMIT 1").get(); if (err) console.warn('::warning::' + err.error);
  const rows = db.prepare("SELECT * FROM jobs WHERE status='active' ORDER BY published DESC").all();
  const jobs = [];
  for (const r of rows) {
    if (!KJ.inSearchStates({ state: r.state, locationText: r.location_text, city: r.city, remote: !!r.remote })) continue; // California only
    if (r.trust_status === 'blocked') continue; // quarantined listings are never published
    jobs.push({ externalId: `${r.provider}:${r.external_id}`, title: r.title, employer: r.employer, locationText: r.location_text, city: r.city, state: r.state, lat: r.lat, lon: r.lon, remote: !!r.remote, arrangement: r.arrangement, salaryMin: r.salary_min, salaryMax: r.salary_max, salaryPeriod: r.salary_period, salaryEstimated: !!r.salary_estimated, compNote: r.comp_note, type: r.employment_type, description: r.description, summary: r.summary, applyUrl: r.apply_url, published: r.published, deadline: r.deadline, logoUrl: r.logo_url });
    if (jobs.length >= 3000) break;
  }
  fs.writeFileSync(outFile, JSON.stringify(Object.assign(meta, { count: jobs.length, jobs })));
  console.log(`Wrote ${jobs.length} California listings from ${meta.sources.join(', ')} to ${outFile}`);
})().catch((e) => { console.error('::error::' + e.message); process.exit(1); });
