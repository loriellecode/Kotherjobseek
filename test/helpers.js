'use strict';
/* Test harness. The mock servers below exist ONLY for tests; the application never contains simulated listings. */
process.env.NODE_ENV = 'test';
process.env.INITIAL_PROFILE_FILE = '/nonexistent/initial-profile.json'; // tests opt in to seeding explicitly
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
  const cfg = require('../server/config'); // the one instance the app uses, so tests can adjust live settings
  Object.assign(cfg.providers.adzuna, { appId: 'test-id', appKey: 'test-key', base: `http://127.0.0.1:${mock.port}/v1/api` });
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

/* ---- document builders (tests only) ---- */
const JSZip = require('jszip');
async function makeDocx(lines) {
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  z.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + lines.map((l) => `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join('') + '</w:body></w:document>');
  return Buffer.from(await z.generateAsync({ type: 'uint8array' }));
}
function makePdf(lines) {
  const esc = (t) => String(t).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = 'BT /F1 11 Tf 14 TL 40 780 Td ' + lines.map((l) => `(${esc(l)}) Tj T*`).join(' ') + ' ET';
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const off = [];
  objs.forEach((o, i) => { off.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
const RESUME_LINES = ['Jane Sample', 'Summary', 'Administrator with budgeting and supervisory experience.', 'Experience',
  'Office Manager, Example County Office of Education  2016 - 2024', '- Supervised 6 staff members and managed the department budget of $1.2M', '- Prepared monthly variance reports and reconciled accounts using Excel and QuickBooks', '- Coordinated IEP meeting scheduling and trained new staff',
  'Teller | Sample Credit Union | Mar 2012 - Dec 2015', '- Processed loans and deposits and resolved member service issues',
  'Education', 'Master of Education in Special Education, Sample State University, 2010', 'Bachelor of Business Administration in Finance, Sample College, 2007',
  'Certifications', 'Notary Public', 'Skills: Excel, Budgeting, Customer service'];
const https = require('node:https');
const { execFileSync } = require('node:child_process');
/** HTTPS server with a throwaway self-signed certificate (web-push only speaks HTTPS). Tests only. */
function listenTls(handler) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-')); execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', dir + '/k.pem', '-out', dir + '/c.pem', '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
  return new Promise((r) => { const s = https.createServer({ key: fs.readFileSync(dir + '/k.pem'), cert: fs.readFileSync(dir + '/c.pem') }, handler); s.listen(0, '127.0.0.1', () => r({ server: s, port: s.address().port })); });
}
module.exports = { mockAdzuna, boot, adz, listen, listenTls, crypto, makeDocx, makePdf, RESUME_LINES };
