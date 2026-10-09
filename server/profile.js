'use strict';
/* Profile storage: per-record CRUD, preference updates, revisions, and change classification. */
const { now, j, tx } = require('./db');
const { HttpError } = require('./http');

const EDU_LEVELS = ['high school', 'associate', 'bachelor', 'master', 'doctorate'];
const CATEGORIES = ['Finance', 'Business', 'Education', 'Special Education'];
const TYPES = ['Full-time', 'Part-time', 'Contract', 'Temporary'];
const MODES = ['onsite', 'hybrid', 'remote'];
const KINDS = { education: 'education', experience: 'experience', skill: 'skill', cert: 'cert' };

const str = (v, max = 200) => String(v === undefined || v === null ? '' : v).trim().slice(0, max);
const numOrNull = (v, lo = 0, hi = 10000000) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Math.min(hi, Math.max(lo, Number(v))));
const oneOf = (v, list, d) => (list.includes(v) ? v : d);

const CLEANERS = {
  education: (d) => ({ level: oneOf(d.level, EDU_LEVELS, null) || (() => { throw new HttpError(400, 'Choose an education level.'); })(), field: str(d.field), school: str(d.school), status: oneOf(d.status, ['completed', 'in progress'], 'completed'), year: numOrNull(d.year, 1950, 2100) }),
  experience: (d) => { const title = str(d.title); if (!title) throw new HttpError(400, 'Enter a job title.'); return { title, employer: str(d.employer), field: str(d.field), years: numOrNull(d.years, 0, 60), summary: str(d.summary, 2000) }; },
  skill: (d) => { const name = str(d.name, 80); if (!name) throw new HttpError(400, 'Enter a skill.'); return { name }; },
  cert: (d) => { const name = str(d.name); if (!name) throw new HttpError(400, 'Enter the credential or license name.'); return { name, issuer: str(d.issuer), status: oneOf(d.status, ['held', 'in progress'], 'held'), expires: str(d.expires, 10) }; },
};

function defaultData() {
  return {
    titles: [], categories: [...CATEGORIES], types: ['Full-time'], workModes: ['onsite'], cities: ['North Stockton, CA'], commuteMiles: 30, certsNone: false,
    salary: { min: null, desired: null, period: 'year', showBelow: false },
    notify: { enabled: true, inApp: true, email: false, push: false, immediate: true, daily: false, weekly: false, dailyHour: 8, weeklyDay: 1, quietStart: 21, quietEnd: 7, tz: 'America/Los_Angeles', categories: { newMatches: true, deadlines: true, profileUpdates: true, sourceIssues: true } },
    searchEnabled: true,
  };
}

function ensureProfile(db, userId) {
  if (!db.prepare('SELECT 1 FROM profiles WHERE user_id=?').get(userId))
    db.prepare('INSERT INTO profiles(user_id,name,data,revision,updated_at) VALUES(?,?,?,?,?)').run(userId, '', JSON.stringify(defaultData()), 0, now());
}

function cleanPrefs(patch, cur) {
  const out = JSON.parse(JSON.stringify(cur));
  const list = (v, cap, max) => (Array.isArray(v) ? [...new Set(v.map((x) => str(x, max)).filter(Boolean))].slice(0, cap) : null);
  if ('titles' in patch) out.titles = list(patch.titles, 20, 80) || [];
  if ('categories' in patch) out.categories = (list(patch.categories, 10, 40) || []).filter((c) => CATEGORIES.includes(c));
  if ('types' in patch) out.types = (list(patch.types, 6, 20) || []).filter((c) => TYPES.includes(c));
  if ('workModes' in patch) { out.workModes = (list(patch.workModes, 3, 10) || []).filter((c) => MODES.includes(c)); if (!out.workModes.length) out.workModes = ['onsite']; }
  if ('cities' in patch) out.cities = list(patch.cities, 12, 80) || [];
  if ('commuteMiles' in patch) out.commuteMiles = numOrNull(patch.commuteMiles, 0, 500) ?? 30;
  if ('certsNone' in patch) out.certsNone = !!patch.certsNone;
  if ('searchEnabled' in patch) out.searchEnabled = !!patch.searchEnabled;
  if (patch.salary && typeof patch.salary === 'object') {
    const s = patch.salary; out.salary = { min: 'min' in s ? numOrNull(s.min) : cur.salary.min, desired: 'desired' in s ? numOrNull(s.desired) : cur.salary.desired, period: oneOf(s.period ?? cur.salary.period, ['year', 'hour'], 'year'), showBelow: 'showBelow' in s ? !!s.showBelow : cur.salary.showBelow };
  }
  if (patch.notify && typeof patch.notify === 'object') {
    const n = patch.notify, c = cur.notify, o = out.notify;
    for (const k of ['enabled', 'inApp', 'email', 'push', 'immediate', 'daily', 'weekly']) if (k in n) o[k] = !!n[k];
    for (const k of ['dailyHour', 'quietStart', 'quietEnd']) if (k in n) o[k] = Math.min(23, Math.max(0, Math.floor(Number(n[k]) || 0)));
    if ('weeklyDay' in n) o.weeklyDay = Math.min(6, Math.max(0, Math.floor(Number(n.weeklyDay) || 0)));
    if ('tz' in n) { try { new Intl.DateTimeFormat('en-US', { timeZone: n.tz }); o.tz = n.tz; } catch (_) { throw new HttpError(400, 'Unknown time zone.'); } }
    if (n.categories) for (const k of Object.keys(c.categories)) if (k in n.categories) o.categories[k] = !!n.categories[k];
  }
  return out;
}

function getRecords(db, userId) {
  const out = { education: [], experience: [], skill: [], cert: [] };
  for (const r of db.prepare('SELECT * FROM profile_records WHERE user_id=? ORDER BY id').all(userId))
    if (out[r.kind]) out[r.kind].push(Object.assign({ id: r.id, source: r.source }, j(r.data, {})));
  return out;
}
function getProfile(db, userId) {
  ensureProfile(db, userId);
  const p = db.prepare('SELECT * FROM profiles WHERE user_id=?').get(userId);
  const rec = getRecords(db, userId);
  const resume = db.prepare('SELECT id, filename, size, created_at FROM resumes WHERE user_id=? ORDER BY id DESC LIMIT 1').get(userId);
  return Object.assign(defaultData(), j(p.data, {}), { name: p.name, revision: p.revision, education: rec.education, experience: rec.experience, skills: rec.skill, certs: rec.cert, resume: resume || null });
}

/* Classify what a change touches so the pipeline knows how much work to do. */
function classify(before, after) {
  const classes = new Set(), changed = [];
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const strip = (a) => a.map(({ id, source, ...r }) => r);
  for (const k of ['education', 'experience', 'skills', 'certs']) if (!eq(strip(before[k] || []).map((x) => (typeof x === 'object' ? x : x)), strip(after[k] || []))) { classes.add('broad'); changed.push(k); }
  if (!eq(before.titles, after.titles)) { classes.add('broad'); changed.push('preferred titles'); }
  if (!eq(before.categories, after.categories)) { classes.add('broad'); changed.push('career categories'); }
  if (!eq(before.cities, after.cities) || before.commuteMiles !== after.commuteMiles) { classes.add('location'); changed.push('location'); }
  if (!eq(before.workModes, after.workModes)) { classes.add('location'); changed.push('work arrangement'); }
  if (!eq(before.salary, after.salary)) { classes.add('salary'); changed.push('salary'); }
  if (!eq(before.types, after.types)) { classes.add('salary'); changed.push('employment types'); }
  if (before.certsNone !== after.certsNone) { classes.add('rematch'); changed.push('credentials answer'); }
  return { classes: [...classes], changed };
}

function recordRevision(db, userId, classes, changed, summary) {
  const p = getProfile(db, userId);
  const rev = p.revision + 1;
  db.prepare('UPDATE profiles SET revision=?, updated_at=? WHERE user_id=?').run(rev, now(), userId);
  p.revision = rev;
  db.prepare('INSERT INTO profile_revisions(user_id,revision,change_class,summary,snapshot,created_at) VALUES(?,?,?,?,?,?)').run(userId, rev, classes.join(',') || 'minor', JSON.stringify({ changed, summary }), JSON.stringify(p), now());
  return rev;
}

function mutate(db, userId, fn, summary) {
  return tx(db, () => {
    const before = getProfile(db, userId);
    const result = fn();
    const after = getProfile(db, userId);
    const { classes, changed } = classify(before, after);
    let revision = before.revision;
    const nameChanged = before.name !== after.name;
    if (classes.length || changed.length || nameChanged) revision = recordRevision(db, userId, classes, changed.length ? changed : ['name'], summary || changed.join(', '));
    return { result, revision, classes, changed };
  });
}

function addRecord(db, userId, kind, data, source = 'user') {
  if (!KINDS[kind]) throw new HttpError(404, 'Unknown record type');
  const clean = CLEANERS[kind](data || {});
  return mutate(db, userId, () => db.prepare('INSERT INTO profile_records(user_id,kind,data,source,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(userId, kind, JSON.stringify(clean), source, now(), now()).lastInsertRowid, `Added ${kind}`);
}
function updateRecord(db, userId, kind, id, data) {
  if (!KINDS[kind]) throw new HttpError(404, 'Unknown record type');
  const row = db.prepare('SELECT 1 FROM profile_records WHERE id=? AND user_id=? AND kind=?').get(id, userId, kind);
  if (!row) throw new HttpError(404, 'Record not found');
  const clean = CLEANERS[kind](data || {});
  return mutate(db, userId, () => db.prepare('UPDATE profile_records SET data=?, updated_at=? WHERE id=? AND user_id=?').run(JSON.stringify(clean), now(), id, userId), `Edited ${kind}`);
}
function deleteRecord(db, userId, kind, id) {
  if (!KINDS[kind]) throw new HttpError(404, 'Unknown record type');
  if (!db.prepare('SELECT 1 FROM profile_records WHERE id=? AND user_id=? AND kind=?').get(id, userId, kind)) throw new HttpError(404, 'Record not found');
  return mutate(db, userId, () => db.prepare('DELETE FROM profile_records WHERE id=? AND user_id=?').run(id, userId), `Removed ${kind}`);
}
function updatePrefs(db, userId, patch) {
  return mutate(db, userId, () => {
    const p = db.prepare('SELECT * FROM profiles WHERE user_id=?').get(userId);
    const cur = Object.assign(defaultData(), j(p.data, {}));
    const next = cleanPrefs(patch || {}, cur);
    if ('name' in (patch || {})) db.prepare('UPDATE profiles SET name=? WHERE user_id=?').run(str(patch.name, 60), userId);
    db.prepare('UPDATE profiles SET data=? WHERE user_id=?').run(JSON.stringify(next), userId);
  }, 'Updated preferences');
}
function deleteAllProfileData(db, userId) {
  tx(db, () => {
    for (const t of ['profile_records', 'profile_revisions', 'resumes', 'resume_proposals', 'matches']) db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(userId);
    db.prepare('UPDATE profiles SET name=?, data=?, revision=0, updated_at=? WHERE user_id=?').run('', JSON.stringify(defaultData()), now(), userId);
  });
}

module.exports = { ensureProfile, getProfile, addRecord, updateRecord, deleteRecord, updatePrefs, classify, deleteAllProfileData, defaultData, CATEGORIES, EDU_LEVELS };
