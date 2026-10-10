/* The phone edition's engine: the same server code (matching, trust checks, profile, applications, email assistant) running inside the
 * browser, with SQLite (sql.js) saved in this device's IndexedDB. There is no server for her data — it never leaves the phone. */
globalThis.__KJ_PHONE = true;
import initSqlJs from 'sql.js/dist/sql-wasm-browser.js';
import * as vfsMod from 'node:fs';
import INITIAL_PROFILE from '../config/initial-profile.json';
import PHOTOS from './photos-manifest.json';

const SCRIPT_URL = (document.currentScript && document.currentScript.src) || location.href;
const url = (rel) => new URL(rel, SCRIPT_URL).href;

/* ---- IndexedDB (key → value) ---- */
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('kother-phone', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const kv = async (mode, fn) => { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction('kv', mode), s = t.objectStore('kv'), r = fn(s); t.oncomplete = () => { d.close(); res(r && r.result); }; t.onerror = () => { d.close(); rej(t.error); }; }); };
const idbGet = (k) => kv('readonly', (s) => s.get(k));
const idbSet = (k, v) => kv('readwrite', (s) => s.put(v, k));
const idbClear = () => kv('readwrite', (s) => s.clear());

let app = null, token = '', ready = null;

async function boot() {
  const SQL = await initSqlJs({ locateFile: () => url('sql-wasm-browser.wasm') });
  globalThis.__KJ_SQL = SQL; globalThis.__KJ_DB_BYTES = await idbGet('db'); globalThis.__KJ_PERSIST = (b) => { idbSet('db', b).catch(() => {}); };
  globalThis.__KJ_JOBS_URL = url('jobs.json'); globalThis.__KJ_PDF_WORKER_SRC = url('pdf.worker.js'); globalThis.PDFJS = Object.assign(globalThis.PDFJS || {}, { workerSrc: url('pdf.worker.js') });
  // Files the server code expects to find on disk.
  const V = vfsMod.__vfs; vfsMod.mkdirSync('/app/config'); vfsMod.writeFileSync('/app/config/initial-profile.json', JSON.stringify(INITIAL_PROFILE));
  for (const [dir, names] of Object.entries(PHOTOS.dirs || {})) for (const f of names) vfsMod.writeFileSync(`/app/public/photos/${dir}/${f}`, '');
  if (PHOTOS.credits) vfsMod.writeFileSync('/app/public/photos/credits.json', JSON.stringify(PHOTOS.credits));
  const saved = await idbGet('vfs'); if (saved) for (const [p, b] of Object.entries(saved)) vfsMod.writeFileSync(p, b);
  let t = null; V.setOnChange(() => { clearTimeout(t); t = setTimeout(() => { const o = {}; for (const [p, b] of V.files) if (p.startsWith('/data/')) o[p] = b; idbSet('vfs', o).catch(() => {}); }, 400); });

  const { open, now } = require('../server/db'), { createApp } = require('../server/index'), { Pipeline } = require('../server/pipeline'), P = require('../server/profile'), H = require('../server/http');
  const db = open('/data/kother.db');
  const pipeline = new Pipeline(db, { debounceMs: 1500 });
  let u = db.prepare('SELECT * FROM users ORDER BY id LIMIT 1').get(), first = false;
  if (!u) { const id = Number(db.prepare('INSERT INTO users(email,pw_hash,created_at) VALUES(?,?,?)').run('me@this-phone.local', 'none', now()).lastInsertRowid); P.ensureProfile(db, id); const seeded = P.applyInitialProfile(db, id); if (seeded.applied) pipeline.enqueue(id, { classes: ['broad', 'location'], reason: 'profile', revision: seeded.revision }); u = { id }; first = true; }
  token = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
  db.prepare('INSERT OR REPLACE INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(H.sha256(token), u.id, Date.now() + 3650 * 864e5);
  pipeline.start(); if (!first) pipeline.scheduleTick().catch(() => {}); setInterval(() => pipeline.scheduleTick().catch(() => {}), 30 * 60000);
  app = { handler: createApp(db, pipeline), db, pipeline, H };
  addEventListener('pagehide', () => { try { app.db.flush(); } catch (_) { /* ignore */ } });
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

/* ---- a minimal Node-style request/response so the unchanged route handlers can run here ---- */
function call(method, path, headers, body) {
  return new Promise((resolve) => {
    const h = {}; for (const [k, v] of Object.entries(headers || {})) h[k.toLowerCase()] = v;
    h.cookie = 'kj_session=' + token; h.host = 'phone.local'; delete h.origin;
    const bodyBuf = body == null ? null : typeof body === 'string' ? Buffer.from(body) : Buffer.from(body instanceof ArrayBuffer ? new Uint8Array(body) : body);
    const ev = {}; const req = { method, url: path, headers: h, socket: { remoteAddress: 'local' }, destroy() {}, on(e, f) { (ev[e] = ev[e] || []).push(f); return req; } };
    const out = { status: 200, headers: {}, chunks: [] };
    const res = { setHeader(k, v) { out.headers[k.toLowerCase()] = v; }, getHeader(k) { return out.headers[k.toLowerCase()]; }, writeHead(s, hd) { out.status = s; for (const [k, v] of Object.entries(hd || {})) out.headers[k.toLowerCase()] = v; }, write(c) { out.chunks.push(Buffer.from(c)); }, end(c) { if (c !== undefined) out.chunks.push(Buffer.from(c)); resolve(out); }, set statusCode(v) { out.status = v; }, get statusCode() { return out.status; } };
    app.handler(req, res).catch((e) => resolve({ status: 500, headers: { 'content-type': 'application/json' }, chunks: [Buffer.from(JSON.stringify({ error: String(e.message) }))] }));
    queueMicrotask(() => { if (bodyBuf) (ev.data || []).forEach((f) => f(bodyBuf)); (ev.end || []).forEach((f) => f()); });
  });
}

/* Everything on this phone: delete and start fresh. */
async function resetEverything() { try { app.db.flush(); } catch (_) { /* ignore */ } await idbClear(); location.reload(); }

globalThis.KJ_PHONE = {
  ready: () => (ready = ready || boot()),
  async request(method, path, headers, body) {
    await this.ready();
    if (method === 'DELETE' && /\/api\/account$/.test(path)) { setTimeout(resetEverything, 50); return { status: 200, headers: { 'content-type': 'application/json' }, body: new TextEncoder().encode('{"ok":true}') }; }
    if (/\/api\/auth\/(logout|login|signup)$/.test(path)) return { status: 200, headers: { 'content-type': 'application/json' }, body: new TextEncoder().encode(JSON.stringify({ ok: true, user: { id: 1, email: 'me@this-phone.local' } })) };
    const out = await call(method, path, headers, body);
    return { status: out.status, headers: out.headers, body: out.chunks.length ? new Uint8Array(Buffer.concat(out.chunks)) : new Uint8Array(0) };
  },
  reset: resetEverything,
};
