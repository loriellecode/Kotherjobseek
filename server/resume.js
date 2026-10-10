'use strict';
/* Résumé handling.
 *  - Validation is on the server and does not trust the filename or browser content type (extension AND file signature AND structure).
 *  - Files live in DATA_DIR/resumes/<userId>/<random>, never in a public directory; only the owner can download them.
 *  - Extraction is local (pdf-parse / mammoth). No résumé content is sent to any external service.
 *  - Analysis only PROPOSES profile entries. The user accepts, edits or rejects each one; verified records are never silently overwritten. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const { now, j, tx } = require('./db');
const { HttpError } = require('./http');
const P = require('./profile');
const { analyze } = require('./resumeAnalysis');

const TYPES = { '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const dirFor = (userId) => path.join(config.dataDir, 'resumes', String(userId));
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

async function validate(ext, buf) {
  if (!TYPES[ext]) throw new HttpError(415, 'Please upload a PDF or Word (.docx) résumé.');
  if (!buf.length) throw new HttpError(400, 'The file is empty.');
  if (buf.length > config.maxResumeBytes) throw new HttpError(413, `Résumés must be smaller than ${Math.round(config.maxResumeBytes / 1048576)} MB.`);
  if (ext === '.pdf') { if (buf.slice(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(415, 'That file isn’t a real PDF (its contents don’t match its name).'); return; }
  if (!(buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5))) throw new HttpError(415, 'That file isn’t a real Word document (its contents don’t match its name).');
  try {
    const zip = await require('jszip').loadAsync(buf), names = Object.keys(zip.files);
    if (names.length > 3000 || !zip.file('word/document.xml')) throw new Error('structure');
    const unpacked = names.reduce((t, n) => t + ((zip.files[n]._data && zip.files[n]._data.uncompressedSize) || 0), 0);
    if (unpacked > 60 * 1024 * 1024) throw new Error('too large when unpacked'); // zip-bomb guard
  } catch (_) { throw new HttpError(415, 'That file isn’t a readable .docx Word document.'); }
}
/* IMPORTANT: Node serves small Buffers from a shared memory pool. The bundled pdf.js ignores a Buffer's byteOffset and would read neighbouring
 * memory (other uploads!) — giving random failures and potentially another person's text. Always hand it a standalone copy. */
const standalone = (buf) => { const u = new Uint8Array(buf.length); u.set(buf); return u; };
async function extractText(ext, buf) {
  if (ext === '.pdf') { const pdf = require('pdf-parse/lib/pdf-parse.js'); const r = await withTimeout(pdf(standalone(buf), { max: 30 }), 25000, 'timeout'); return r.text || ''; }
  const r = await withTimeout(require('mammoth').extractRawText({ buffer: buf, arrayBuffer: standalone(buf).buffer }), 25000, 'timeout'); return r.value || '';
}

/* ---- conflicts & duplicates against the current profile ---- */
function tokens(s) { return norm(s).split(' ').filter((w) => w.length > 2); }
function overlap(a, b) { const x = new Set(tokens(a)), y = tokens(b); return y.length ? y.filter((w) => x.has(w)).length / y.length : 0; }
function compare(db, userId, kind, d) {
  const recs = P.getProfile(db, userId)[{ education: 'education', experience: 'experience', cert: 'certs', skill: 'skills' }[kind]] || [];
  for (const r of recs) {
    const diffs = [];
    if (kind === 'skill') { if (norm(r.name) === norm(d.name)) return { duplicate: true, record: r }; continue; }
    if (kind === 'cert') { if (!(norm(r.name) === norm(d.name) || overlap(r.name, d.name) >= 0.8)) continue; if (r.status !== d.status) diffs.push(`status: profile says “${r.status}”, résumé says “${d.status}”`); }
    else if (kind === 'education') {
      const sameLevel = r.level && d.level && r.level === d.level;
      const sameField = (norm(r.field) && norm(r.field) === norm(d.field)) || (r.title && d.title && norm(r.title) === norm(d.title)) || (sameLevel && norm(r.field) && norm(d.field) && (overlap(r.field, d.field) >= 0.5 || overlap(d.field, r.field) >= 0.5));
      if (!sameField) continue;
      if (norm(r.field) && norm(d.field) && norm(r.field) !== norm(d.field)) diffs.push(`field wording: profile says “${r.field}”, résumé says “${d.field}”`);
      if (d.title && !r.title) diffs.push(`the résumé gives the exact degree title “${d.title}”`);
      if (d.school && !r.school) diffs.push(`the résumé names the school “${d.school}”`);
      if (r.level && d.level && r.level !== d.level) diffs.push(`degree level: profile says ${r.level}, résumé says ${d.level}`);
      if (r.school && d.school && norm(r.school) !== norm(d.school)) diffs.push(`school: profile says “${r.school}”, résumé says “${d.school}”`);
      if (r.year && d.year && Number(r.year) !== Number(d.year)) diffs.push(`graduation year: profile says ${r.year}, résumé says ${d.year}`);
    } else if (kind === 'experience') {
      if (!(norm(r.employer) && norm(d.employer) && (norm(r.employer).includes(norm(d.employer)) || norm(d.employer).includes(norm(r.employer))))) continue;
      if (overlap(r.title, d.title) < 0.5) diffs.push(`job title: profile says “${r.title}”, résumé says “${d.title}”`);
      if (r.years && d.years && Math.abs(Number(r.years) - Number(d.years)) > 1) diffs.push(`years: profile says ${r.years}, résumé says ${d.years}`);
      if (r.start && d.start && String(r.start).slice(0, 4) !== String(d.start).slice(0, 4)) diffs.push(`start date: profile says ${r.start}, résumé says ${d.start}`);
    }
    return diffs.length ? { duplicate: false, conflict: { recordId: r.id, verified: r.verified !== false, differences: diffs } } : { duplicate: true, record: r };
  }
  return null;
}

/* ---- processing ---- */
async function processResume(db, userId, id) {
  const r = db.prepare('SELECT * FROM resumes WHERE id=? AND user_id=?').get(id, userId); if (!r) throw new HttpError(404, 'No résumé uploaded.');
  db.prepare("UPDATE resumes SET status='processing', error=NULL WHERE id=?").run(id);
  db.prepare("DELETE FROM resume_proposals WHERE resume_id=? AND status='pending'").run(id);
  try {
    const buf = fs.readFileSync(path.join(dirFor(userId), r.stored_name)), text = await extractText(path.extname(r.stored_name), buf);
    if (norm(text).length < 40) throw Object.assign(new Error('No readable text was found. It may be a scanned image or a protected file. Upload a text-based PDF or Word file, or enter your information manually.'), { user: true });
    const a = analyze(text); let dups = 0;
    a.insights.educationFound = a.proposals.filter((p) => p.kind === 'education').map((p) => ({ level: p.data.level, field: p.data.field, title: p.data.title }));
    tx(db, () => {
      const ins = db.prepare('INSERT INTO resume_proposals(user_id,resume_id,kind,data,origin,evidence,grp) VALUES(?,?,?,?,?,?,?)');
      for (const p of a.proposals) { const c = compare(db, userId, p.kind, p.data); if (c && c.duplicate) { dups++; continue; } ins.run(userId, id, p.kind, JSON.stringify(p.data), p.origin, JSON.stringify(p.evidence), p.group); }
      db.prepare("UPDATE resumes SET status='ready', text=?, insights=?, analyzed_at=?, duplicate_count=?, accepted_count=0, rejected_count=0 WHERE id=?").run(text.slice(0, 200000), JSON.stringify(a.insights), now(), dups, id);
    });
  } catch (e) {
    if (process.env.DEBUG_RESUME) console.error('résumé analysis error:', e.stack);
    const msg = e.user ? e.message : (e.message === 'timeout' ? 'Reading the file took too long.' : 'The document could not be read — it may be corrupt or password-protected. Upload another file, or enter your information manually.');
    db.prepare("UPDATE resumes SET status='failed', error=?, analyzed_at=? WHERE id=?").run(msg, now(), id);
  }
}

async function saveResume(db, userId, filename, buf) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  await validate(ext, buf); // throws before anything is stored
  const dir = dirFor(userId); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stored = crypto.randomBytes(16).toString('hex') + ext;
  fs.writeFileSync(path.join(dir, stored), buf, { mode: 0o600 });
  const old = db.prepare('SELECT id, stored_name FROM resumes WHERE user_id=?').all(userId);
  const safeName = path.basename(String(filename)).replace(/[^\w.\- ()]+/g, '_').slice(0, 120);
  const id = Number(db.prepare("INSERT INTO resumes(user_id,filename,stored_name,mime,size,text,created_at,status) VALUES(?,?,?,?,?,?,?,'processing')").run(userId, safeName, stored, TYPES[ext], buf.length, '', now()).lastInsertRowid);
  for (const o of old) { try { fs.unlinkSync(path.join(dir, o.stored_name)); } catch (_) { /* already gone */ } db.prepare('DELETE FROM resumes WHERE id=?').run(o.id); } // replace: the previous file is deleted
  await processResume(db, userId, id);
  return state(db, userId);
}
async function retry(db, userId) { const r = db.prepare('SELECT id FROM resumes WHERE user_id=? ORDER BY id DESC LIMIT 1').get(userId); if (!r) throw new HttpError(404, 'No résumé uploaded.'); await processResume(db, userId, r.id); return state(db, userId); }

function state(db, userId) {
  const r = db.prepare('SELECT * FROM resumes WHERE user_id=? ORDER BY id DESC LIMIT 1').get(userId);
  if (!r) return { resume: null, proposals: [] };
  const rows = db.prepare("SELECT * FROM resume_proposals WHERE resume_id=? AND user_id=? AND status='pending' ORDER BY id").all(r.id, userId);
  const proposals = rows.map((p) => { const data = j(p.data, {}), c = compare(db, userId, p.kind, data); return { id: p.id, kind: p.kind, group: p.grp || p.kind, origin: p.origin, evidence: j(p.evidence, []), data, conflict: c && c.conflict ? c.conflict : null }; });
  const ins = j(r.insights, null), found = (ins && ins.educationFound) || [];
  /* Cross-check: education already in the profile (e.g. provided by family, unverified) that this résumé does not show. */
  const notOnResume = r.status === 'ready' ? P.getProfile(db, userId).education.filter((e) => e.verified === false && e.status !== 'in progress' && !found.some((f) => (norm(f.field) && (norm(f.field) === norm(e.field) || overlap(e.field, f.field) >= 0.5 || overlap(f.field, e.field) >= 0.5)) && (!e.level || !f.level || e.level === f.level))).map((e) => ({ id: e.id, text: `${e.level ? e.level + "'s degree" : 'Degree'}${e.field ? ' — ' + e.field : ''}` })) : [];
  return { resume: { id: r.id, notOnResume, filename: r.filename, size: r.size, uploadedAt: r.created_at, status: r.status, error: r.error, analyzedAt: r.analyzed_at, textAvailable: !!r.text, insights: j(r.insights, null), counts: { pending: proposals.length, accepted: r.accepted_count, rejected: r.rejected_count, duplicates: r.duplicate_count } }, proposals };
}
function removeResume(db, userId) {
  const rows = db.prepare('SELECT * FROM resumes WHERE user_id=?').all(userId); let deleted = 0;
  for (const r of rows) { const f = path.join(dirFor(userId), r.stored_name); try { fs.unlinkSync(f); } catch (_) { /* already gone */ } if (!fs.existsSync(f)) deleted++; }
  db.prepare('DELETE FROM resumes WHERE user_id=?').run(userId); // proposals cascade
  return { removed: rows.length, fileDeleted: deleted === rows.length };
}
function resumeFile(db, userId) {
  const r = db.prepare('SELECT * FROM resumes WHERE user_id=? ORDER BY id DESC LIMIT 1').get(userId);
  if (!r) throw new HttpError(404, 'No résumé uploaded.');
  const file = path.join(dirFor(userId), r.stored_name);
  if (!path.resolve(file).startsWith(path.resolve(dirFor(userId)) + path.sep) || !fs.existsSync(file)) throw new HttpError(404, 'File not found.');
  return { file, filename: r.filename, mime: r.mime };
}

/* Accept (optionally edited) / reject one proposal. Conflicts with existing records require an explicit choice. */
function decideProposal(db, userId, id, accept, body) {
  body = body || {};
  const p = db.prepare("SELECT * FROM resume_proposals WHERE id=? AND user_id=? AND status='pending'").get(id, userId);
  if (!p) throw new HttpError(404, 'Suggestion not found.');
  const bump = (col) => db.prepare(`UPDATE resumes SET ${col}=${col}+1 WHERE id=?`).run(p.resume_id);
  if (!accept) { db.prepare("UPDATE resume_proposals SET status='rejected' WHERE id=?").run(id); bump('rejected_count'); return null; }
  const data = Object.assign({}, j(p.data, {}), body.data && typeof body.data === 'object' ? body.data : {}), edited = !!(body.data && Object.keys(body.data).length);
  if (p.kind === 'skill' && p.origin === 'inferred') data.origin = 'inferred';
  const c = compare(db, userId, p.kind, data);
  if (c && c.duplicate) { db.prepare("UPDATE resume_proposals SET status='rejected' WHERE id=?").run(id); bump('duplicate_count'); return null; }
  if (c && c.conflict && !['keep_existing', 'add_separate', 'replace'].includes(body.mode)) throw new HttpError(409, 'This conflicts with something already in your profile. Choose what to do.', { conflict: c.conflict });
  if (c && c.conflict && body.mode === 'keep_existing') { db.prepare("UPDATE resume_proposals SET status='rejected' WHERE id=?").run(id); bump('rejected_count'); return null; }
  // Quick-accepting an ambiguous education line or a credential records it as reported-but-unconfirmed; only an explicit confirmation verifies it.
  const needsConfirm = (p.kind === 'education' || p.kind === 'cert') && !edited && (data.flag || p.kind === 'cert');
  if (data.verified === undefined) data.verified = !needsConfirm;
  let res;
  if (c && c.conflict && body.mode === 'replace') res = P.updateRecord(db, userId, p.kind, c.conflict.recordId, Object.assign(data, { verified: body.data && body.data.verified === true }));
  else res = P.addRecord(db, userId, p.kind, data, 'resume');
  db.prepare("UPDATE resume_proposals SET status='accepted' WHERE id=?").run(id); bump('accepted_count');
  return res;
}
function finish(db, userId) {
  const s = state(db, userId); if (!s.resume) throw new HttpError(404, 'No résumé uploaded.');
  const c = s.resume.counts, any = c.accepted > 0;
  return { accepted: c.accepted, rejected: c.rejected, pending: c.pending, duplicates: c.duplicates, searchExpanded: any,
    message: any ? `Added ${c.accepted} item${c.accepted === 1 ? '' : 's'} to your profile. Your job searches are being expanded with the new information.` : (c.duplicates && !c.pending ? 'Everything in your résumé was already in your profile, so no major change was detected and your searches were not expanded.' : 'No new information was added, so your searches were not expanded.') };
}
module.exports = { saveResume, retry, state, removeResume, resumeFile, decideProposal, finish, compare };
