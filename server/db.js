'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, pw_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS profiles (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, name TEXT DEFAULT '', data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS profile_records (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, data TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'user', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_records_user ON profile_records(user_id, kind);
CREATE TABLE IF NOT EXISTS profile_revisions (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, revision INTEGER NOT NULL, change_class TEXT NOT NULL, summary TEXT NOT NULL, snapshot TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS resumes (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, filename TEXT NOT NULL, stored_name TEXT NOT NULL, mime TEXT, size INTEGER, text TEXT DEFAULT '', created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'processing', error TEXT, insights TEXT, analyzed_at INTEGER, accepted_count INTEGER NOT NULL DEFAULT 0, rejected_count INTEGER NOT NULL DEFAULT 0, duplicate_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS resume_proposals (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, resume_id INTEGER NOT NULL REFERENCES resumes(id) ON DELETE CASCADE, kind TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', origin TEXT NOT NULL DEFAULT 'stated', evidence TEXT NOT NULL DEFAULT '[]', grp TEXT);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY, provider TEXT NOT NULL, external_id TEXT NOT NULL, fingerprint TEXT NOT NULL, url_key TEXT,
  title TEXT NOT NULL, employer TEXT NOT NULL, city TEXT, state TEXT, location_text TEXT, neighborhood TEXT, lat REAL, lon REAL,
  arrangement TEXT, remote INTEGER DEFAULT 0, salary_min REAL, salary_max REAL, salary_period TEXT, salary_estimated INTEGER DEFAULT 0, comp_note TEXT,
  employment_type TEXT, description TEXT, summary TEXT, required TEXT DEFAULT '[]', preferred TEXT DEFAULT '[]',
  edu_level TEXT, edu_inferred INTEGER DEFAULT 0, edu_preferred INTEGER DEFAULT 0, exp_years REAL, exp_field TEXT, exp_inferred INTEGER DEFAULT 0, exp_preferred INTEGER DEFAULT 0, certs TEXT DEFAULT '[]', categories TEXT DEFAULT '[]',
  apply_url TEXT, link_level TEXT, link_notes TEXT, email_apply TEXT, logo_url TEXT, published TEXT, deadline TEXT,
  retrieved_at INTEGER NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, last_verified INTEGER,
  status TEXT NOT NULL DEFAULT 'active', also_listed TEXT DEFAULT '[]', raw_hash TEXT,
  UNIQUE(provider, external_id));
CREATE INDEX IF NOT EXISTS idx_jobs_fp ON jobs(fingerprint);
CREATE INDEX IF NOT EXISTS idx_jobs_url ON jobs(url_key);
CREATE TABLE IF NOT EXISTS user_jobs (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, first_surfaced INTEGER, saved_at INTEGER, dismissed_at INTEGER, reported TEXT, PRIMARY KEY(user_id, job_id));
CREATE TABLE IF NOT EXISTS applications (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'applied', applied_on TEXT, response TEXT DEFAULT '', notes TEXT DEFAULT '', interviews TEXT DEFAULT '[]', closed_reason TEXT DEFAULT '', updated_at INTEGER NOT NULL, UNIQUE(user_id, job_id));
CREATE TABLE IF NOT EXISTS matches (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, revision INTEGER NOT NULL, classification TEXT NOT NULL, overall REAL, excluded INTEGER DEFAULT 0, detail TEXT NOT NULL, computed_at INTEGER NOT NULL, PRIMARY KEY(user_id, job_id));
CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, reason TEXT, scope TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'queued', stage TEXT, run_after INTEGER NOT NULL, revision INTEGER, error TEXT, result TEXT, created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(status, run_after);
CREATE TABLE IF NOT EXISTS search_log (id INTEGER PRIMARY KEY, provider TEXT NOT NULL, query_key TEXT NOT NULL, user_id INTEGER, started_at INTEGER NOT NULL, finished_at INTEGER, status TEXT NOT NULL, result_count INTEGER, new_count INTEGER, error TEXT);
CREATE INDEX IF NOT EXISTS idx_search_key ON search_log(provider, query_key, status, started_at);
CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, job_id INTEGER, kind TEXT NOT NULL, signature TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, link TEXT, deliver_after INTEGER NOT NULL, delivered TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, read_at INTEGER, UNIQUE(user_id, kind, signature));
CREATE TABLE IF NOT EXISTS push_subscriptions (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, endpoint TEXT UNIQUE NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS images (topic TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS email_drafts (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, recipient TEXT DEFAULT '', subject TEXT DEFAULT '', body_html TEXT DEFAULT '', notes TEXT DEFAULT '', updated_at INTEGER NOT NULL, PRIMARY KEY(user_id, job_id));
CREATE TABLE IF NOT EXISTS career_prefs (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, occupation_id TEXT NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id, occupation_id));
`;

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}
/* Add columns introduced after a database was first created (SCHEMA only covers fresh databases). */
function ensureColumn(db, table, col, def) { if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); }
function migrate(db) {
  ensureColumn(db, 'jobs', 'email_apply', 'TEXT'); ensureColumn(db, 'jobs', 'link_level', 'TEXT'); ensureColumn(db, 'jobs', 'link_notes', 'TEXT');
  for (const [c, d] of [['status', "TEXT NOT NULL DEFAULT 'ready'"], ['error', 'TEXT'], ['insights', 'TEXT'], ['analyzed_at', 'INTEGER'], ['accepted_count', 'INTEGER NOT NULL DEFAULT 0'], ['rejected_count', 'INTEGER NOT NULL DEFAULT 0'], ['duplicate_count', 'INTEGER NOT NULL DEFAULT 0']]) ensureColumn(db, 'resumes', c, d);
  for (const [c, d] of [['origin', "TEXT NOT NULL DEFAULT 'stated'"], ['evidence', "TEXT NOT NULL DEFAULT '[]'"], ['grp', 'TEXT']]) ensureColumn(db, 'resume_proposals', c, d);
}
const now = () => Date.now();
const j = (v, d) => { try { return v ? JSON.parse(v) : d; } catch (_) { return d; } };
function tx(db, fn) { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } }

module.exports = { open, now, j, tx };
