/* Phone-edition browser check (Playwright): builds the static site, serves it under /Kotherjobseek/ like GitHub Pages, and verifies that
 * the app runs entirely in the browser, keeps data on the device across reloads, never talks to another host, and shows only California jobs.
 * Run: node test/e2e/phone.e2e.js   (job data below is FICTIONAL test data) */
const { chromium } = require('playwright'); const assert = require('assert'); const http = require('http'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const root = path.join(__dirname, '..', '..'), site = path.join(root, 'site'), FX = path.join(__dirname, '..', 'fixtures'), SHOTS = process.env.SHOTS || '/tmp/kother-shots'; fs.mkdirSync(SHOTS, { recursive: true });
const day = (n) => new Date(Date.now() + n * 864e5).toISOString();
const mk = (id, title, employer, city, state, min, max, desc, url) => ({ externalId: 'adzuna:' + id, title, employer, locationText: `${city}, ${state}`, city, state, salaryMin: min, salaryMax: max, salaryPeriod: 'year', type: 'full_time', description: desc, applyUrl: url, published: day(-2) });
const jobs = [
  mk(1, 'Budget Analyst II', 'City of Stockton', 'Stockton', 'California', 78000, 92000, "Prepare budget forecasts and reports for the city. Bachelor's degree in finance or accounting required. 2 years of finance experience required.", 'https://www.cityofstockton.gov/jobs/1'),
  mk(2, 'Special Education Program Specialist', 'Test Unified School District', 'Stockton', 'California', 72000, 98000, "Support special education programs across the district. Master's degree preferred. Valid California credential helpful.", 'https://acme.wd5.myworkdayjobs.com/en-US/x/job/1'),
  mk(3, 'Employment Specialist', 'Test Workforce Board', 'Lodi', 'California', 62000, 74000, 'Provide job coaching and case management. Bachelor\'s degree preferred. To apply, email your resume and cover letter to hiring@testworkforce.example.test with the subject line Employment Specialist Application.', ''),
  mk(4, 'Accounting Clerk', 'Louisiana Parish Office', 'Hammond', 'Louisiana', 50000, 60000, 'Process invoices and records for the parish office in Hammond, Louisiana. High school diploma required.', 'https://example.test/la'),
  mk(5, 'Payroll Specialist', 'Fee Staffing', 'Stockton', 'California', 60000, 70000, 'Process payroll for clients. You must pay a $99 training fee before your first day.', 'https://fee-staffing.example/apply'),
];
(async () => {
  execFileSync('node', [path.join(root, 'scripts', 'build-phone.js')], { stdio: 'inherit' });
  fs.writeFileSync(path.join(site, 'jobs.json'), JSON.stringify({ generatedAt: new Date().toISOString(), jobs }));
  const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]).replace(/^\/Kotherjobseek/, '') || '/'; if (p.endsWith('/')) p += 'index.html'; const f = path.join(site, p); if (!f.startsWith(site) || !fs.existsSync(f)) { s.writeHead(404); return s.end('nf'); } s.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); }).listen(4200);
  const B = 'http://localhost:4200/Kotherjobseek/', browser = await chromium.launch(), ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage(), errors = [], external = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.on('request', (r) => { if (!r.url().startsWith('http://localhost:4200') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
  const ok = (n) => console.log('PASS', n), wait = (s, t) => page.waitForSelector(s, { timeout: t || 20000 }), done = () => page.waitForSelector('.statusbar.ok, .statusbar.bad', { timeout: 40000 });
  try {
    await page.goto(B); await wait('.dock-tab'); await done(); await page.waitForTimeout(500);
    const text = await page.evaluate(() => document.body.innerText);
    assert(/Special Education Program Specialist/.test(text), 'listing shown'); assert(!/Louisiana|Accounting Clerk/.test(text), 'Louisiana listing never shown'); assert(!/Payroll Specialist/.test(text), 'listing asking for a fee is quarantined');
    ok('opens with no sign-in, runs the engine in the browser, shows California jobs only, hides the fee scam and the Louisiana listing');
    assert.deepEqual(external, [], 'no requests left the device'); ok('no request went to any other host');
    await page.screenshot({ path: path.join(SHOTS, 'phone-home.png') });

    // trust labels in the detail view
    const ids = await page.evaluate(() => KJ.A.S.jobs.map((j) => [j.id, j.title, j.link.level, j.link.label]));
    const by = (t) => ids.find((x) => x[1] === t);
    assert.equal(by('Budget Analyst II')[2], 'trusted'); assert.equal(by('Special Education Program Specialist')[2], 'checked'); ok('trust statuses computed in the browser: ' + ids.map((x) => x[1] + '=' + x[2]).join(', '));
    await page.goto(B + '#/job/' + by('Employment Specialist')[0]); await wait('[data-action=email-open]'); await page.click('[data-action=email-open]'); await wait('.em'); await page.click('[data-act=write]');
    await page.waitForFunction(() => /Dear/.test(document.querySelector('#em-body').innerText), null, { timeout: 15000 }); ok('email assistant writes a draft in the browser');
    const href = await page.getAttribute('#em-mailto', 'href'); assert(/^mailto:hiring@testworkforce\.example\.test/.test(href)); ok('open-in-email-app link is prefilled');
    await page.screenshot({ path: path.join(SHOTS, 'phone-email.png') }); await page.click('.em >> text=Close');

    // her data stays on the device across reloads
    const jid = by('Budget Analyst II')[0];
    await page.evaluate(async (id) => { await fetch('/api/jobs/' + id + '/saved', { method: 'PUT' }); await fetch('/api/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ salary: { min: 28, desired: 31, period: 'hour' } }) }); }, jid);
    await page.waitForTimeout(1200); await page.reload(); await wait('.dock-tab');
    const state = await page.evaluate(async () => { const f = await (await fetch('/api/feed')).json(), p = (await (await fetch('/api/bootstrap')).json()).profile; return { saved: f.jobs.filter((j) => j.userState.saved).map((j) => j.title), desired: p.salary.desired }; });
    assert.deepEqual(state.saved, ['Budget Analyst II']); assert.equal(state.desired, 31); ok('saved jobs and profile edits survive closing and reopening the app (stored on the device)');

    // résumé upload: DOCX and PDF parsed locally
    await page.goto(B + '#/profile'); await wait('.resume-panel'); await page.locator('#resume-in').setInputFiles(path.join(FX, 'resume-libreoffice.docx'));
    await wait('.sheet h2:text("Review résumé findings")', 30000); ok('DOCX résumé parsed on the phone and review screen shown'); await page.screenshot({ path: path.join(SHOTS, 'phone-resume.png') });
    await page.click('.sheet >> text=Done').catch(() => {}); await page.keyboard.press('Escape');
    const pdfRes = await page.evaluate(async (b64) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const r = await fetch('/api/resume', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-filename': 'resume.pdf' }, body: bin }); return r.status; }, fs.readFileSync(path.join(FX, 'resume-reportlab.pdf')).toString('base64'));
    assert([200, 201, 202].includes(pdfRes), 'pdf upload status ' + pdfRes); await page.waitForTimeout(3000);
    const st = await page.evaluate(async () => (await (await fetch('/api/resume')).json())); assert(st.resume && /pdf/i.test(st.resume.filename) && st.resume.status !== 'failed', JSON.stringify(st.resume)); ok('PDF résumé accepted and read on the phone (status: ' + st.resume.status + ')');
    assert.deepEqual(external, []); ok('still no request to any other host after résumé upload');

    // delete everything on this phone
    await page.evaluate(() => fetch('/api/account', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: '{}' })); await page.waitForTimeout(1500); await wait('.dock-tab');
    const after = await page.evaluate(async () => { const r = await (await fetch('/api/resume')).json(); const f = await (await fetch('/api/feed')).json(); return { resume: r.resume, saved: f.jobs.filter((j) => j.userState.saved).length }; });
    assert(!after.resume && after.saved === 0); ok('"delete everything" wipes the phone’s data');
    assert.deepEqual(errors, []); ok('no page errors');
  } finally { await browser.close(); srv.close(); }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
