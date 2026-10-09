'use strict';
/* Résumé handling: validated upload, private storage, text extraction, and *proposed* profile entries
 * that only enter the verified profile after the user reviews and accepts them. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const { now, j, tx } = require('./db');
const { HttpError } = require('./http');
const { addRecord } = require('./profile');

const TYPES = { '.txt': 'text/plain', '.md': 'text/markdown', '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const dirFor = (userId) => path.join(config.dataDir, 'resumes', String(userId));

function sniff(ext, buf) {
  if (ext === '.pdf') return buf.slice(0, 5).toString() === '%PDF-';
  if (ext === '.docx') return buf[0] === 0x50 && buf[1] === 0x4b;
  return !buf.slice(0, 4096).includes(0); // text files must not contain NUL bytes
}
async function extractText(ext, buf) {
  try {
    if (ext === '.txt' || ext === '.md') return buf.toString('utf8');
    if (ext === '.pdf') { const pdf = require('pdf-parse/lib/pdf-parse.js'); return (await pdf(buf)).text || ''; }
    if (ext === '.docx') return (await require('mammoth').extractRawText({ buffer: buf })).value || '';
  } catch (_) { /* unreadable: stored, but no text available */ }
  return '';
}

/* ---- heuristic extraction -> proposals (never auto-applied) ---- */
const DEG = [['doctorate', /\b(ph\.?\s?d\.?|doctor(ate)? of [a-z ]+|ed\.?d\.?)\b/i], ['master', /\b(master(?:'s)? of [a-z ]+|master(?:'s)? in [a-z ]+|m\.?b\.?a\.?|m\.?s\.?\b|m\.?a\.?\b)/i], ['bachelor', /\b(bachelor(?:'s)? of [a-z ]+|bachelor(?:'s)? in [a-z ]+|b\.?s\.?\b|b\.?a\.?\b)/i], ['associate', /\b(associate(?:'s)? (?:of|in|degree)[a-z ]*|a\.?a\.?\b|a\.?s\.?\b)/i]];
const CERT_RE = /\b(credential|license|licence|certification|certificate|certified|CPA|CBEST|CSET|BCBA|PMP|CFA)\b/i;
function extractProposals(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean), out = [], seen = new Set();
  const push = (kind, data) => { const k = kind + JSON.stringify(data).toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push({ kind, data }); } };
  lines.forEach((line, i) => {
    if (line.length > 160) return;
    for (const [level, re] of DEG) { const m = line.match(re); if (m && /\b(of|in|degree|b\.?[sa]\.?|m\.?[sab]\.?a?\.?|ph)/i.test(line)) {
      const inM = line.match(/\bin\s+([A-Z][A-Za-z&' ]{2,40}?)(?=\s*(?:[,|(–—-]|$))/), ofM = line.match(/\b(?:Bachelor|Master|Associate|Doctor)(?:'s)?\s+of\s+(?!Science|Arts|Fine|Applied)([A-Z][A-Za-z&' ]{2,40}?)(?=\s*(?:[,|(–—-]|$))/i);
      const fm = inM || ofM;
      const seg = line.split(/[,|–—]/).map((x) => x.trim()).find((x) => /\b(university|college|institute|school)\b/i.test(x)) || ((/\b(university|college|institute|school)\b/i.test(lines[i + 1] || '') && lines[i + 1].length < 100) ? lines[i + 1] : '');
      const school = seg;
      push('education', { level, field: fm ? fm[1].trim().replace(/\s+/g, ' ') : '', school: school ? school.replace(/\s*[|–—-].*$/, '').trim() : '', status: /\b(expected|in progress|candidate|current)\b/i.test(line) ? 'in progress' : 'completed' }); break; } }
    if (CERT_RE.test(line) && line.length < 110 && !/\b(responsib|manage|develop|prepare)/i.test(line)) push('cert', { name: line.replace(/^[•*\-–\s]+/, '').replace(/\s+(passed|earned|obtained|issued)?\s*(in\s*)?(19|20)\d{2}.*$/i, '').replace(/\s*[|–—-]\s*(\d{4}.*)?$/, ''), issuer: '', status: /\b(in progress|pursuing|candidate|expected)\b/i.test(line) ? 'in progress' : 'held' });
    const exp = line.match(/^(.{3,70}?)\s*(?:,|\||–|—|-| at )\s*(.{2,70}?)\s*(?:,|\||–|—|-|\()\s*((?:19|20)\d{2})\s*(?:–|—|-|to)\s*((?:19|20)\d{2}|present|current)\)?$/i);
    if (exp) { const y1 = Number(exp[3]), y2 = /present|current/i.test(exp[4]) ? new Date().getFullYear() : Number(exp[4]); if (y2 >= y1 && y2 - y1 <= 40) push('experience', { title: exp[1].trim(), employer: exp[2].trim(), field: '', years: y2 - y1, summary: '' }); }
  });
  const si = lines.findIndex((l) => /^(technical |core |key )?skills\b[:\s]*$/i.test(l) || /^skills\s*[:\-]/i.test(l));
  if (si >= 0) {
    const first = lines[si].replace(/^[^:\-]*[:\-]\s*/, '');
    const block = [first, ...lines.slice(si + 1, si + 8).filter((l) => !/^(experience|education|certif|work|employment|projects|summary|references)\b/i.test(l))].join(',');
    block.split(/[,;•|·\n]+/).map((s) => s.replace(/^[•*\-–\s]+/, '').trim()).filter((s) => s.length > 1 && s.length <= 40).slice(0, 30).forEach((s) => push('skill', { name: s }));
  }
  return out.slice(0, 60);
}

async function saveResume(db, userId, filename, buf) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  if (!TYPES[ext]) throw new HttpError(415, 'Upload a .pdf, .docx, .txt or .md file.');
  if (!buf.length) throw new HttpError(400, 'The file is empty.');
  if (buf.length > config.maxResumeBytes) throw new HttpError(413, `Résumés must be under ${Math.round(config.maxResumeBytes / 1048576)} MB.`);
  if (!sniff(ext, buf)) throw new HttpError(415, 'That file doesn’t look like a valid ' + ext + ' document.');
  removeResume(db, userId);
  const text = (await extractText(ext, buf)).slice(0, 200000);
  const dir = dirFor(userId); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stored = crypto.randomBytes(16).toString('hex') + ext;
  fs.writeFileSync(path.join(dir, stored), buf, { mode: 0o600 });
  const safeName = path.basename(String(filename)).replace(/[^\w.\- ()]+/g, '_').slice(0, 120);
  const id = Number(db.prepare('INSERT INTO resumes(user_id,filename,stored_name,mime,size,text,created_at) VALUES(?,?,?,?,?,?,?)').run(userId, safeName, stored, TYPES[ext], buf.length, text, now()).lastInsertRowid);
  const proposals = extractProposals(text);
  const ins = db.prepare('INSERT INTO resume_proposals(user_id,resume_id,kind,data) VALUES(?,?,?,?)');
  tx(db, () => proposals.forEach((p) => ins.run(userId, id, p.kind, JSON.stringify(p.data))));
  return { id, filename: safeName, size: buf.length, textExtracted: text.length > 0, proposals: listProposals(db, userId) };
}
function listProposals(db, userId) { return db.prepare("SELECT id, kind, data FROM resume_proposals WHERE user_id=? AND status='pending' ORDER BY id").all(userId).map((r) => ({ id: r.id, kind: r.kind, data: j(r.data, {}) })); }
function removeResume(db, userId) {
  for (const r of db.prepare('SELECT * FROM resumes WHERE user_id=?').all(userId)) { try { fs.unlinkSync(path.join(dirFor(userId), r.stored_name)); } catch (_) { /* already gone */ } }
  db.prepare('DELETE FROM resumes WHERE user_id=?').run(userId); // proposals cascade
}
function resumeFile(db, userId) {
  const r = db.prepare('SELECT * FROM resumes WHERE user_id=? ORDER BY id DESC LIMIT 1').get(userId);
  if (!r) throw new HttpError(404, 'No résumé uploaded.');
  const file = path.join(dirFor(userId), r.stored_name);
  if (!path.resolve(file).startsWith(path.resolve(dirFor(userId)) + path.sep) || !fs.existsSync(file)) throw new HttpError(404, 'File not found.');
  return { file, filename: r.filename, mime: r.mime };
}
function decideProposal(db, userId, id, accept, edited) {
  const p = db.prepare("SELECT * FROM resume_proposals WHERE id=? AND user_id=? AND status='pending'").get(id, userId);
  if (!p) throw new HttpError(404, 'Suggestion not found.');
  let out = null;
  if (accept) out = addRecord(db, userId, p.kind, edited && typeof edited === 'object' ? edited : j(p.data, {}), 'resume');
  db.prepare('UPDATE resume_proposals SET status=? WHERE id=?').run(accept ? 'accepted' : 'rejected', id);
  return out;
}
module.exports = { saveResume, listProposals, removeResume, resumeFile, decideProposal, extractProposals };
