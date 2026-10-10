'use strict';
const t = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFile } = require('node:child_process');
const { mockAdzuna, adz } = require('./helpers');
const { normalizeListing } = require('../server/normalize');
const staticProvider = require('../server/providers/static');

const run = (env) => new Promise((resolve) => execFile(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'scripts', 'fetch-jobs.js'), env.OUT], { env: Object.assign({}, process.env, env), timeout: 100000 }, (err, stdout, stderr) => resolve({ err, stdout, stderr })));

t.describe('phone edition: daily job list', () => {
  t.it('without keys it publishes an honest empty list (never sample jobs)', async () => {
    const OUT = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kj-')), 'jobs.json');
    const r = await run({ OUT, ADZUNA_APP_ID: '', ADZUNA_APP_KEY: '', USAJOBS_API_KEY: '', USAJOBS_USER_EMAIL: '' });
    const d = JSON.parse(fs.readFileSync(OUT, 'utf8')); assert.deepEqual(d.jobs, []); assert.match(d.note, /No job-search keys/); assert.match(r.stdout + r.stderr, /warning/);
  });
  t.it('with keys it fetches, keeps California only, drops quarantined listings, and the result loads through the normal normalizer', async () => {
    const m = await mockAdzuna(); const OUT = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kj-')), 'jobs.json');
    m.state.jobs = [adz(1, { title: 'Budget Analyst', description: 'Prepare budgets and reports for the county. Bachelor’s degree required in finance.' }),
      adz(2, { title: 'Budget Analyst', company: { display_name: 'Louisiana Parish' }, location: { display_name: 'Hammond, Louisiana', area: ['US', 'Louisiana', 'Tangipahoa Parish', 'Hammond'] }, description: 'Budget work for the parish office in Hammond, Louisiana.' }),
      adz(3, { title: 'Budget Analyst', company: { display_name: 'Fee Co' }, description: 'Budget support role. You must pay a $120 training fee before starting work.' })];
    try {
      const r = await run({ OUT, ADZUNA_APP_ID: 'test-id', ADZUNA_APP_KEY: 'test-key', ADZUNA_BASE_URL: `http://127.0.0.1:${m.port}/v1/api`, USAJOBS_API_KEY: '', USAJOBS_USER_EMAIL: '', MAX_QUERIES_PER_SCAN: '6' });
      assert.ifError(r.err); const d = JSON.parse(fs.readFileSync(OUT, 'utf8'));
      assert.deepEqual(d.jobs.map((j) => j.employer), ['Test County']); assert.ok(d.jobs[0].externalId.startsWith('adzuna:')); assert.ok(!JSON.stringify(d).includes('Louisiana') && !JSON.stringify(d).includes('Fee Co'));
      const n = normalizeListing(d.jobs[0], 'static', Date.now()); assert.ok(n && n.title === 'Budget Analyst' && n.apply_url);
    } finally { m.close(); }
  });
  t.it('the phone job source reads one published file and reports a missing file honestly', async () => {
    const real = globalThis.fetch; globalThis.__KJ_JOBS_URL = 'http://x/jobs.json';
    try {
      globalThis.fetch = async () => ({ ok: true, json: async () => ({ jobs: [{ externalId: 'a:1', title: 'X' }, { title: 'no id' }] }) }); assert.equal((await staticProvider.search()).listings.length, 1);
      globalThis.fetch = async () => ({ ok: false, status: 404 }); await assert.rejects(staticProvider.search(), /not published yet/);
    } finally { globalThis.fetch = real; delete globalThis.__KJ_JOBS_URL; }
  });
});
