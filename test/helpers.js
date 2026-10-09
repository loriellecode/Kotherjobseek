'use strict';
/* Test harness. The mock servers below exist ONLY for tests; the application never contains simulated listings. */
process.env.NODE_ENV = 'test';
process.env.MAIL_TRANSPORT = 'json';
process.env.MAIL_FROM = 'jobs@test.local';
process.env.RESCAN_DEBOUNCE_MS = '60';
process.env.SCHEDULER_ENABLED = 'false';
process.env.MIN_REPEAT_SEARCH_MINUTES = '0';
const http = require('node:http');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kother-test-'));

function listen(handler) { return new Promise((r) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => r({ server: s, port: s.address().port })); }); }

/** Mock Adzuna: `state.jobs` is what the "provider" currently lists; `state.mode` can be 'ok' | 'error' | 'auth'. */
async function mockAdzuna() {
  const state = { jobs: [], mode: 'ok', calls: [] };
  const { server, port } = await listen((req, res) => {
    const u = new URL(req.url, 'http://x'); state.calls.push(Object.fromEntries(u.searchParams));
    if (state.mode === 'error') { res.writeHead(500); return res.end('boom'); }
    if (state.mode === 'auth') { res.writeHead(401); return res.end('no'); }
    if (u.searchParams.get('app_id') !== 'test-id' || u.searchParams.get('app_key') !== 'test-key') { res.writeHead(401); return res.end(); }
    const page = Number(u.pathname.split('/').pop()), what = (u.searchParams.get('what') || '').toLowerCase().replace(/ remote$/, '');
    const hit = state.jobs.filter((j) => !what || (j.title + ' ' + j.description).toLowerCase().split(/\s+/).some((w) => what.split(' ').includes(w)));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ count: hit.length, results: page === 1 ? hit : [] }));
  });
  return { state, port, close: () => server.close() };
}
const adz = (id, o) => Object.assign({ id: String(id), title: 'Budget Analyst', company: { display_name: 'Test County' }, location: { display_name: 'Stockton, San Joaquin County, California', area: ['US', 'California', 'San Joaquin County', 'Stockton'] }, latitude: 37.96, longitude: -121.29,
  salary_min: 70000, salary_max: 90000, salary_is_predicted: '0', contract_time: 'full_time', redirect_url: `https://example.test/jobs/${id}`, created: new Date().toISOString(), description: 'Prepare budget reports and forecasts. Bachelor\'s degree required. 2 years of finance experience required.', category: { label: 'Accounting & Finance Jobs' } }, o || {});

async function boot(extra) {
  const mock = await mockAdzuna();
  process.env.ADZUNA_APP_ID = 'test-id'; process.env.ADZUNA_APP_KEY = 'test-key'; process.env.ADZUNA_BASE_URL = `http://127.0.0.1:${mock.port}/v1/api`;
  delete require.cache[require.resolve('../server/config')];
  const { start } = require('../server/index');
  const { open } = require('../server/db');
  const app = await start(Object.assign({ db: open(':memory:'), port: 0, noWorker: true, pipeline: { debounceMs: 60 } }, extra));
  const base = `http://127.0.0.1:${app.port}`;
  const client = (cookie) => {
    const c = { cookie: cookie || '' };
    c.req = async (method, p, body, headers) => {
      const isBuf = Buffer.isBuffer(body);
      const res = await fetch(base + p, { method, headers: Object.assign({ cookie: c.cookie }, body !== undefined && !isBuf ? { 'content-type': 'application/json' } : {}, headers || {}), body: body === undefined ? undefined : isBuf ? body : JSON.stringify(body), redirect: 'manual' });
      const sc = res.headers.get('set-cookie'); if (sc) c.cookie = sc.split(';')[0];
      const ct = res.headers.get('content-type') || ''; const data = ct.includes('json') ? await res.json() : await res.text();
      return { status: res.status, data, headers: res.headers };
    };
    return c;
  };
  async function signup(email = 'her@example.test') { const c = client(); const r = await c.req('POST', '/api/auth/signup', { email, password: 'correct horse battery' }); if (r.status !== 201) throw new Error('signup failed ' + JSON.stringify(r.data)); return c; }
  return { app, mock, base, client, signup, db: app.db, pipeline: app.pipeline, close: () => { app.close(); mock.close(); } };
}
module.exports = { boot, adz, listen, crypto };
