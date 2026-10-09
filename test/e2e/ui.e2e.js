/* Browser verification (Playwright). Run: node test/e2e/dev-server.js  (separate shell), then  node test/e2e/ui.e2e.js
 * The dev server uses FICTIONAL mock provider data — it exists only for this check. Screenshots go to $SHOTS (default /tmp/kother-shots). */
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs'), path = require('path');
const B = process.env.BASE || 'http://127.0.0.1:4100', SHOTS = process.env.SHOTS || '/tmp/kother-shots', FX = path.join(__dirname, '..', 'fixtures');
fs.mkdirSync(SHOTS, { recursive: true });
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067"><defs><linearGradient id="g"><stop offset="0" stop-color="#8fb8b0"/><stop offset="1" stop-color="#d9c9a8"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>';
const results = []; const ok = (name, detail) => { results.push(['PASS', name]); console.log('PASS', name, detail || ''); };
(async () => {
  const browser = await chromium.launch(); const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  let failImages = false; await ctx.route('https://images.pexels.com/**', (r) => (failImages ? r.abort() : r.fulfill({ contentType: 'image/svg+xml', body: svg })));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('PAGE ' + e.message)); page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text()) && errors.push('CONSOLE ' + m.text()));
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, n + '.png') });
  const wait = (sel, t) => page.waitForSelector(sel, { timeout: t || 8000 });
  const done = async () => { await page.waitForSelector('.statusbar.ok, .statusbar.bad', { timeout: 30000 }); };

  // ---- sign up (seeded profile) ----
  await page.goto(B); await wait('.authcard'); await page.click('text=Create an account'); await page.fill('#em', 'mom@example.test'); await page.fill('#pw', 'a long enough password'); await page.click('button[type=submit]');
  await wait('.topbar'); ok('sign-up and sign-in');
  await wait('.statusbar', 10000); await done(); ok('first search completed through the status bar', (await page.locator('.statusbar').innerText()).replace(/\n/g, ' '));

  // ---- education: unverified, flagged, editable ----
  await page.goto(B + '/#/profile'); await wait('.sections');
  assert(await page.locator('text=4 education entries need your review').isVisible()); ok('profile flags 4 unverified education entries');
  await shot('01-profile-desktop');
  await page.click('.sec-card:has(h3:text("Education")) button'); await wait('.reclist .rec');
  const recs = await page.locator('.reclist .rec').allInnerTexts(); assert.equal(recs.length, 4); assert(recs.every((r) => /unverified/i.test(r)) && recs.every((r) => /⚠/.test(r)));
  assert(/Master/.test(recs[3]) && /not a teaching credential/i.test(recs[3])); ok('four education records shown unverified with ambiguity flags', recs.map((r) => r.split('\n')[0]).join(' | '));
  await shot('02-education-review');
  await page.locator('.rec', { hasText: 'Business Management' }).locator('text=Confirm').click(); await page.waitForTimeout(500);
  assert(/confirmed/i.test(await page.locator(".rec", { hasText: "Business Management" }).innerText())); ok('confirming an education record works');
  await page.locator('.rec', { hasText: 'Business Finance' }).locator('[data-action=rec-edit]').click(); await wait('form[data-form=record]');
  await page.selectOption('select[name=level]', 'bachelor'); await page.fill('input[name=school]', 'Example College'); await page.fill('textarea[name=flag]', ''); await page.click('.sheet >> text=Save Changes'); await wait('.reclist .rec');
  assert((await page.locator('.reclist .rec').allInnerTexts()).some((r) => /Example College/.test(r))); ok('editing an education record works');
  await page.locator('.rec', { hasText: 'Finance' }).first().locator('[data-action=rec-delete]').click(); await page.waitForTimeout(500); assert.equal(await page.locator('.reclist .rec').count(), 3); ok('deleting an education record works');
  await page.click('.sheet >> text=Add education'); await page.fill('input[name=field]', 'Accounting'); await page.click('.sheet >> text=Save Changes'); await wait('.reclist .rec'); assert.equal(await page.locator('.reclist .rec').count(), 4); ok('adding an education record works');
  await page.click('.sheet >> text=Done');
  // salary shown as hourly
  assert(await page.locator('.sec-card:has(h3:text("Salary")) p', { hasText: '$58,240' }).isVisible()); ok('$28/hr minimum shown (annualized $58,240)');
  await done();

  // ---- feed + careers ----
  await page.goto(B + '/#/discover'); await wait('.featured');
  console.log('sections:', await page.locator('.section h2').allInnerTexts());
  const titles = [...new Set(await page.locator('.card h3, .featured h2').allInnerTexts())]; assert(!titles.includes('Instructional Aide'), '$28/hr floor hides $38–44k aide'); ok('feed honours the $28/hr floor', titles.join(', '));
  await wait('#rail-careers'); const careers = await page.locator('.card.career h3').allInnerTexts(); assert(careers.length >= 1); ok('"Other Careers to Explore" shows evidence-backed careers (education only → few)', careers.join(' | '));
  const c0 = page.locator('.card.career').first(); assert(/Why your background may be relevant/i.test(await c0.innerText())); assert(await c0.locator('text=Include in searches').isVisible()); assert(await c0.locator('text=Exclude').isVisible());
  await c0.locator('summary').click(); assert(/Typically required/i.test(await c0.innerText())); await shot('03-careers');
  const first = (await c0.locator('h3').innerText()); await c0.locator('text=Include in searches').click(); await page.waitForSelector('.card.career:has-text("Included in searches")'); ok('including a career path works', first);
  await done();
  await page.locator('.card.career').first().locator('text=Exclude').click(); await page.waitForTimeout(800);
  assert(!(await page.locator('.card.career h3').allInnerTexts()).includes(first)); assert(await page.locator('text=career hidden').count() > 0); ok('excluding a career path hides it with a restore control', first);
  await done(); await page.locator('text=career hidden').locator('..').locator('text=Restore').first().click(); await page.waitForTimeout(800); await done(); ok('restoring a hidden career works');
  await shot('04-discover-desktop');

  // ---- job detail ----
  await page.locator('.section .card .open').first().click(); await wait('.detail');
  assert(await page.locator('.inds .ind').count() === 4); ok('job detail shows 4 separate indicators'); assert(await page.locator('text=How is this calculated?').isVisible());
  console.log('detail:', (await page.locator('.detail h1').innerText()), '|', (await page.locator('.verify').innerText()));
  assert(await page.locator('text=Source').first().isVisible() && await page.locator('text=Last verified').isVisible()); ok('source, retrieval and verification are shown'); await shot('05-detail');
  await page.click('.rail-actions >> text=Save job'); await page.waitForTimeout(400); await page.reload(); await wait('.detail'); assert(await page.locator('.rail-actions >> text=Saved').isVisible()); ok('saved job persists after reload');
  await page.click('text=Mark as applied'); await wait('text=Your application'); await page.click('text=Edit tracking'); await wait('form[data-form=tracker]');
  await page.selectOption('select[name=status]', 'interviewing'); await page.click('text=Add interview'); await page.fill('input[name=idate]', '2026-11-03'); await page.fill('input[name=inote]', 'Panel'); await page.click('.sheet >> text=Save Changes'); await wait('text=Panel'); ok('application tracker saves status and interview');
  await page.goto(B + '/#/applications'); await wait('.rowcard'); assert(/Interviewing/.test(await page.locator('.rowcard').first().innerText())); ok('application tracker lists the job');
  await page.goto(B + '/#/saved'); await wait('.rowcard'); ok('saved page lists the job');

  // ---- résumé: unsupported + corrupt + good ----
  await page.goto(B + '/#/profile'); await wait('.resume-panel'); assert(await page.locator('.resume-panel >> text=Upload résumé').isVisible()); await shot('06-resume-empty');
  const input = page.locator('#resume-in'); fs.writeFileSync('/tmp/notes.txt', 'plain text'); await input.setInputFiles('/tmp/notes.txt'); await page.waitForSelector('.toast:has-text("PDF or Word")'); ok('unsupported file type is rejected with an explanation');
  fs.writeFileSync('/tmp/corrupt.pdf', '%PDF-1.4\n garbage\n%%EOF'); await input.setInputFiles('/tmp/corrupt.pdf'); await wait('.resume-panel .banner.warn'); const fail = await page.locator('.resume-panel').innerText(); assert(/couldn.t read/i.test(fail) && /Retry analysis/i.test(fail) && /Upload another file/i.test(fail) && /manually/.test(fail)); ok('corrupt PDF → failure explained with retry / upload another / manual options'); await shot('07-resume-failed');
  await input.setInputFiles(path.join(FX, 'resume-libreoffice.docx')); await wait('.sheet h2:text("Review résumé findings")', 15000);
  const review = await page.locator('.sheet').innerText(); assert(/Stated in résumé/i.test(review) && /Suggested — inferred/i.test(review) && /Evidence from your résumé/i.test(review)); ok('review interface separates stated items from inferred suggestions, with evidence'); await shot('08-resume-review');
  const exp = page.locator('.prop', { hasText: 'Office Manager' }).first(); await exp.locator('text=Accept').click(); await page.waitForSelector('.banner.ok:has-text("Added")'); ok('accept a work-history proposal');
  const skill = page.locator('.prop', { hasText: 'Staff supervision' }).first(); await skill.locator('text=Edit').click(); await wait('form[data-form=prop-edit]'); await page.fill('input[name=name]', 'Team supervision'); await page.click('.sheet >> text=Add to profile'); await wait('.sheet h2:text("Review résumé findings")'); ok('edit a suggestion before adding');
  const rej = page.locator('.prop', { hasText: 'Customer and client service' }).first(); if (await rej.count()) { await rej.locator('text=Reject').click(); await page.waitForTimeout(500); ok('reject a suggestion'); }
  await page.click('.sheet >> text=Done reviewing'); await page.waitForSelector('.toast:has-text("Added")'); ok('finishing the review explains what was added and that searches expand', await page.locator('.toast').innerText());
  await done(); ok('expanded search completes after résumé review', (await page.locator('.statusbar').innerText()).replace(/\n/g, ' '));
  await page.goto(B + '/#/profile'); await wait('.resume-panel'); const rp = await page.locator('.resume-panel').innerText(); assert(/resume-libreoffice.docx/.test(rp) && /Analysis complete/i.test(rp) && /accepted/.test(rp)); ok('résumé panel shows filename, upload date, status and counts'); await shot('09-resume-ready');
  const sk = await page.locator('.sec-card:has(h3:text("Skills")) p').innerText(); assert(/Team supervision/.test(sk)); assert(!/Customer and client service/.test(sk)); ok('profile contains only accepted/edited items');
  await page.goto(B + '/#/discover'); await wait('.featured'); await wait('#rail-careers'); const careers2 = await page.locator('.card.career h3').allInnerTexts(); assert(careers2.length > careers.length, `careers grew from ${careers.length} to ${careers2.length}`); ok('careers expand after résumé review', careers.length + ' → ' + careers2.length + ': ' + careers2.join(' | '));
  await page.goto(B + '/#/profile'); await wait('.resume-panel');
  const dl = await Promise.all([page.waitForEvent('download'), page.click('.resume-panel >> text=Download')]); assert(/resume-libreoffice.docx/.test(dl[0].suggestedFilename())); ok('owner can download own résumé');
  await page.goto(B + '/#/profile'); await wait('.resume-panel'); page.once('dialog', (d) => d.accept()); await page.click('.resume-panel >> text=Remove'); await page.waitForSelector('.toast:has-text("stored file deleted")'); assert(await page.locator('.resume-panel >> text=Upload résumé').isVisible()); ok('removing the résumé deletes the stored file');

  // ---- notifications / settings ----
  await page.click('[data-action=notes]'); await shot('10-notifications'); assert(await page.locator('.pop').isVisible()); ok('notifications popover'); await page.keyboard.press('Escape');
  await page.click('.sec-card:has(h3:text("Notification")) button'); await wait('form[data-form=prefs]'); const nf = await page.locator('.sheet').innerText(); assert(!/email/i.test(nf.replace(/Kother never sends email\./, ''))); assert(/Push on this device/.test(nf)); ok('notification preferences have no email option'); await page.click('.sheet >> text=Cancel');
  await page.goto(B + '/#/settings'); await wait('.prov'); const st = await page.locator('main').innerText(); assert(!/SMTP|Email/.test(st)); assert(/Adzuna/i.test(st)); ok('settings show job sources, no email'); await shot('11-settings');

  // ---- image fallback ----
  failImages = true; await page.goto(B + '/#/discover'); await page.reload(); await wait('.featured'); await page.click('.chip:has-text("Finance")'); await page.waitForTimeout(1200);
  assert((await page.locator('.banner img').count()) === 0 || !(await page.locator('.banner img').first().isVisible().catch(() => false)) || (await page.locator('.banner[hidden]').count()) > 0); ok('failed photos disappear gracefully (no broken-image placeholder)'); failImages = false;

  // ---- responsive ----
  for (const [name, w, h] of [['mobile', 390, 844], ['tablet', 820, 1100], ['desktop', 1440, 1000]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const r of ['discover', 'profile', 'saved']) { await page.goto(B + '/#/' + r); await page.waitForTimeout(500); const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); assert(!over, `${name}/${r} has horizontal overflow`); if (r !== 'saved') await shot(`r-${name}-${r}`); }
    ok(`no horizontal overflow at ${name} (${w}px)`);
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(B + '/#/discover'); await wait('.chips'); const touch = await page.evaluate(() => [...document.querySelectorAll('.act, .chip, .btn')].filter((e) => e.offsetParent).slice(0, 40).map((e) => Math.min(e.offsetWidth, e.offsetHeight)).filter((x) => x < 32).length); assert.equal(touch, 0, 'tap targets ≥ 32px'); ok('touch targets are large enough on mobile');

  console.log('\nconsole/page errors:', errors); assert.equal(errors.length, 0);
  console.log(`\n${results.length} browser checks passed`);
  await browser.close();
})().catch((e) => { console.error('FAIL', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
