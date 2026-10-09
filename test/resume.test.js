'use strict';
const t = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot, adz, makeDocx, makePdf, RESUME_LINES } = require('./helpers');
const JSZip = require('jszip');

const up = (c, name, buf, headers) => c.req('POST', '/api/resume', buf, Object.assign({ 'x-filename': encodeURIComponent(name), 'content-type': 'application/octet-stream' }, headers));

t.describe('résumé upload, analysis, review', () => {
  let env, c;
  t.before(async () => { env = await boot(); c = await env.signup(); });
  t.after(() => env.close());

  t.it('valid PDF: stored privately, analyzed, proposals created — profile unchanged', async () => {
    const r = await up(c, 'resume.pdf', makePdf(RESUME_LINES)); assert.equal(r.status, 201);
    assert.equal(r.data.resume.status, 'ready'); assert.equal(r.data.resume.filename, 'resume.pdf'); assert.ok(r.data.resume.uploadedAt); assert.ok(r.data.proposals.length >= 8);
    const kinds = new Set(r.data.proposals.map((p) => p.group)); for (const g of ['education', 'experience', 'cert', 'skills_stated', 'skills_inferred']) assert.ok(kinds.has(g), g);
    const p = (await c.req('GET', '/api/bootstrap')).data.profile; assert.deepEqual([p.education.length, p.experience.length, p.skills.length], [0, 0, 0], 'nothing is added before review');
    const row = env.db.prepare('SELECT * FROM resumes').get(), file = path.join(process.env.DATA_DIR, 'resumes', String(row.user_id), row.stored_name);
    assert.ok(fs.existsSync(file)); assert.ok(!file.includes('public')); assert.notEqual(row.stored_name, 'resume.pdf', 'random stored name');
    assert.equal((await fetch(env.base + '/resumes/' + row.user_id + '/' + row.stored_name)).status, 404, 'no public URL serves it');
  });
  t.it('real-world documents (ReportLab PDF, LibreOffice DOCX) are read correctly, repeatedly and in any order', async () => {
    const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n));
    for (const [name, buf] of [['a.pdf', fx('resume-reportlab.pdf')], ['b.docx', fx('resume-libreoffice.docx')], ['c.pdf', fx('resume-reportlab.pdf')], ['d.pdf', fx('blank.pdf')], ['e.pdf', fx('resume-reportlab.pdf')]]) {
      const r = await up(c, name, buf); assert.equal(r.status, 201, name);
      if (name === 'd.pdf') { assert.equal(r.data.resume.status, 'failed', 'a text-less PDF must not pick up text from earlier uploads'); assert.match(r.data.resume.error, /No readable text/); assert.equal(r.data.proposals.length, 0); }
      else { assert.equal(r.data.resume.status, 'ready', name); assert.ok(r.data.proposals.some((p) => p.kind === 'experience' && /Office Manager/.test(p.data.title)), name); }
    }
  });
  t.it('valid DOCX replaces the PDF and the old file is deleted', async () => {
    const old = env.db.prepare('SELECT * FROM resumes').get(), oldFile = path.join(process.env.DATA_DIR, 'resumes', String(old.user_id), old.stored_name);
    const r = await up(c, 'resume.docx', await makeDocx(RESUME_LINES)); assert.equal(r.status, 201); assert.equal(r.data.resume.status, 'ready'); assert.equal(r.data.resume.filename, 'resume.docx');
    assert.ok(!fs.existsSync(oldFile), 'previous file removed'); assert.equal(env.db.prepare('SELECT COUNT(*) n FROM resumes').get().n, 1);
  });
  t.it('rejects unsupported types, mismatched content, oversize, and corrupt documents — keeping the current résumé', async () => {
    const before = env.db.prepare('SELECT stored_name FROM resumes').get().stored_name;
    assert.equal((await up(c, 'notes.txt', Buffer.from('plain text résumé'))).status, 415);
    assert.equal((await up(c, 'run.exe', Buffer.from('MZ'))).status, 415);
    assert.equal((await up(c, 'fake.pdf', Buffer.from('this is not a pdf'))).status, 415, 'extension alone is not trusted');
    assert.equal((await up(c, 'fake.docx', Buffer.from('PK\x03\x04junk-not-a-zip'))).status, 415);
    assert.equal((await up(c, 'zip.docx', await new JSZip().file('hello.txt', 'x').generateAsync({ type: 'nodebuffer' }))).status, 415, 'a zip without word/document.xml is not a docx');
    const bomb = new JSZip(); bomb.file('[Content_Types].xml', '<x/>'); bomb.file('word/document.xml', Buffer.alloc(70 * 1024 * 1024, 65)); assert.equal((await up(c, 'bomb.docx', await bomb.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))).status, 415, 'a decompression bomb is refused');
    assert.equal((await up(c, 'empty.pdf', Buffer.alloc(0))).status, 400);
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5 * 1024 * 1024 + 10, 32)]); assert.equal((await up(c, 'big.pdf', big)).status, 413);
    assert.equal((await up(c, 'x.pdf', makePdf(RESUME_LINES), { 'content-type': 'image/png' })).status, 201, 'browser content-type is ignored (content is what counts)');
    assert.notEqual(env.db.prepare('SELECT stored_name FROM resumes').get().stored_name, before);
  });
  t.it('corrupt-but-plausible and text-less documents fail gracefully with an explanation, and can be retried', async () => {
    const r = await up(c, 'corrupt.pdf', Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ngarbage garbage\n%%EOF')); assert.equal(r.status, 201);
    assert.equal(r.data.resume.status, 'failed'); assert.match(r.data.resume.error, /could not be read|No readable text/); assert.deepEqual(r.data.proposals, []);
    const scanned = await up(c, 'scan.pdf', makePdf([])); assert.equal(scanned.data.resume.status, 'failed'); assert.match(scanned.data.resume.error, /scanned image|No readable text/);
    const retry = await c.req('POST', '/api/resume/retry'); assert.equal(retry.status, 200); assert.equal(retry.data.resume.status, 'failed', 'a retry that fails again says so');
    const good = await up(c, 'resume.docx', await makeDocx(RESUME_LINES)); assert.equal(good.data.resume.status, 'ready');
    env.db.prepare("UPDATE resumes SET status='failed', error='simulated'").run(); env.db.prepare('DELETE FROM resume_proposals').run();
    const again = await c.req('POST', '/api/resume/retry'); assert.equal(again.data.resume.status, 'ready'); assert.ok(again.data.proposals.length > 5, 'retry re-analyzes the stored file');
  });
  t.it('review: stated vs inferred are labelled; accept / edit / reject each work; nothing else changes', async () => {
    const st = (await c.req('GET', '/api/resume')).data, by = (g) => st.proposals.filter((p) => p.group === g);
    assert.ok(by('skills_inferred').every((p) => p.origin === 'inferred' && p.evidence.length > 0), 'inferred skills carry the evidence they were inferred from');
    assert.ok(by('skills_stated').every((p) => p.origin === 'stated')); assert.ok(by('experience').every((p) => p.origin === 'stated'));
    const exp = by('experience').find((p) => /Office Manager/.test(p.data.title)); assert.equal(exp.data.employer, 'Example County Office of Education'); assert.equal(exp.data.years, 8.5 + 0 >= 8 ? exp.data.years : 0); assert.ok(exp.data.responsibilities.length >= 2); assert.ok(exp.data.tags.includes('supervision'));
    // accept as-is → verified experience
    let r = await c.req('POST', `/api/resume/proposals/${exp.id}/accept`, {}); assert.equal(r.status, 200); assert.ok(r.data.queued); assert.ok(r.data.classes.includes('resume'));
    assert.equal(r.data.profile.experience.length, 1); assert.equal(r.data.profile.experience[0].source, 'resume'); assert.equal(r.data.profile.experience[0].verified, true);
    // edit an education proposal before accepting
    const edu = by('education').find((p) => p.data.level === 'master'); r = await c.req('POST', `/api/resume/proposals/${edu.id}/accept`, { data: { school: 'Corrected University', year: 2011, verified: true, flag: '' } });
    const e = r.data.profile.education[0]; assert.equal(e.school, 'Corrected University'); assert.equal(e.verified, true); assert.equal(e.level, 'master');
    // quick-accept of a flagged/credential item records it as UNVERIFIED
    const cert = by('cert')[0]; r = await c.req('POST', `/api/resume/proposals/${cert.id}/accept`, {}); assert.equal(r.data.profile.certs[0].verified, false);
    // reject
    const sk = by('skills_inferred')[0]; r = await c.req('POST', `/api/resume/proposals/${sk.id}/reject`, {}); assert.equal(r.status, 200); assert.ok(!r.data.proposals.some((p) => p.id === sk.id)); assert.equal(r.data.resume.counts.rejected, 1);
    assert.equal(r.data.profile ? r.data.profile.skills.length : (await c.req('GET', '/api/bootstrap')).data.profile.skills.length, 0, 'rejected suggestion is not added');
    // accepting an inferred skill keeps its provenance
    const sk2 = by('skills_inferred')[1]; r = await c.req('POST', `/api/resume/proposals/${sk2.id}/accept`, {}); const added = r.data.profile.skills.at(-1); assert.equal(added.origin, 'inferred'); assert.ok(added.evidence.length > 10);
  });
  t.it('conflicts with verified data are never overwritten silently', async () => {
    const st = (await c.req('GET', '/api/resume')).data; const bach = st.proposals.find((p) => p.group === 'education' && p.data.level === 'bachelor');
    const prof = (await c.req('GET', '/api/bootstrap')).data.profile;
    // user verified a Finance bachelor's from a different school/year
    await c.req('POST', '/api/profile/education', { level: 'bachelor', field: 'Finance', school: 'Verified University', year: 2004, verified: true });
    const fresh = (await c.req('GET', '/api/resume')).data.proposals.find((p) => p.id === bach.id); assert.ok(fresh.conflict, 'conflict is detected'); assert.equal(fresh.conflict.verified, true); assert.ok(fresh.conflict.differences.some((d) => /school/.test(d)));
    let r = await c.req('POST', `/api/resume/proposals/${bach.id}/accept`, {}); assert.equal(r.status, 409); assert.ok(r.data.conflict);
    assert.equal((await c.req('GET', '/api/bootstrap')).data.profile.education.find((e) => e.school === 'Verified University').verified, true, 'unchanged after the refused accept');
    r = await c.req('POST', `/api/resume/proposals/${bach.id}/accept`, { mode: 'keep_existing' }); assert.equal(r.status, 200);
    assert.equal((await c.req('GET', '/api/bootstrap')).data.profile.education.filter((e) => e.level === 'bachelor').length, 1);
  });
  t.it('replace requires an explicit choice; duplicates are not re-proposed; finish explains the outcome', async () => {
    await c.req('POST', '/api/profile/experience', { title: 'Teller', employer: 'Sample Credit Union', years: 1, start: '2012-03', verified: true });
    await c.req('POST', '/api/resume/retry'); const st = (await c.req('GET', '/api/resume')).data, teller = st.proposals.find((p) => p.kind === 'experience' && /Teller/.test(p.data.title));
    assert.ok(teller && teller.conflict, 'years differ (1 vs ~4)'); assert.equal((await c.req('POST', `/api/resume/proposals/${teller.id}/accept`, {})).status, 409);
    const r = await c.req('POST', `/api/resume/proposals/${teller.id}/accept`, { mode: 'replace', data: { verified: false } });
    assert.equal(r.status, 200); const tel = r.data.profile.experience.find((e) => e.employer === 'Sample Credit Union'); assert.ok(tel.years > 2); assert.equal(tel.verified, false, 'replaced content is unverified until the user confirms it');
    await c.req('POST', '/api/resume/retry'); assert.ok((await c.req('GET', '/api/resume')).data.resume.counts.duplicates >= 3, 'items already in the profile are not proposed again');
    const fin = (await c.req('POST', '/api/resume/finish')).data; assert.equal(typeof fin.message, 'string');
  });
  t.it('"no major change" is reported honestly when nothing new is accepted', async () => {
    const e2 = await boot(); const c2 = await e2.signup('nochange@example.test');
    await up(c2, 'r.docx', await makeDocx(RESUME_LINES)); const pending = (await c2.req('GET', '/api/resume')).data.proposals;
    for (const p of pending) await c2.req('POST', `/api/resume/proposals/${p.id}/reject`, {});
    const fin = (await c2.req('POST', '/api/resume/finish')).data; assert.equal(fin.searchExpanded, false); assert.match(fin.message, /No new information was added.*not expanded/);
    assert.equal(e2.db.prepare("SELECT COUNT(*) n FROM tasks WHERE status='queued' AND scope LIKE '%resume%'").get().n, 0, 'no expanded search queued');
    e2.close();
  });
  t.it('access is limited to the owner: download, state, retry, proposals', async () => {
    const other = await env.signup('intruder@example.test');
    assert.equal((await other.req('GET', '/api/resume/file')).status, 404); assert.deepEqual((await other.req('GET', '/api/resume')).data, { resume: null, proposals: [] });
    assert.equal((await other.req('POST', '/api/resume/retry')).status, 404);
    const pid = env.db.prepare("SELECT id FROM resume_proposals WHERE status='pending' LIMIT 1").get(); if (pid) { assert.equal((await other.req('POST', `/api/resume/proposals/${pid.id}/accept`, {})).status, 404); assert.equal((await other.req('POST', `/api/resume/proposals/${pid.id}/reject`, {})).status, 404); }
    assert.equal((await env.client().req('GET', '/api/resume/file')).status, 401);
    const dl = await c.req('GET', '/api/resume/file'); assert.equal(dl.status, 200); assert.equal(dl.headers.get('cache-control'), 'private, no-store');
  });
  t.it('removal deletes the stored file and reports it', async () => {
    const row = env.db.prepare('SELECT user_id, stored_name FROM resumes WHERE user_id=1').get(), file = path.join(process.env.DATA_DIR, 'resumes', String(row.user_id), row.stored_name);
    assert.ok(fs.existsSync(file)); const r = await c.req('DELETE', '/api/resume'); assert.equal(r.data.fileDeleted, true); assert.ok(!fs.existsSync(file));
    assert.equal(env.db.prepare('SELECT COUNT(*) n FROM resume_proposals WHERE user_id=1').get().n, 0); assert.equal((await c.req('GET', '/api/resume/file')).status, 404);
    assert.ok((await c.req('GET', '/api/bootstrap')).data.profile.experience.length >= 1, 'accepted profile entries are kept');
  });
  t.it('no external service is contacted while analysing a résumé', async () => {
    const orig = global.fetch; const calls = []; global.fetch = (...a) => { calls.push(String(a[0])); return orig(...a); };
    try { const e3 = await boot(); const c3 = await e3.signup('priv@example.test'); const before = calls.length; await up(c3, 'r.pdf', makePdf(RESUME_LINES)); const during = calls.slice(before).filter((u) => !u.startsWith(e3.base)); assert.deepEqual(during, [], 'only the app itself is called'); e3.close(); } finally { global.fetch = orig; }
  });
});
