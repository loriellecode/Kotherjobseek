/* Persistent state (localStorage with an in-memory fallback) and job import. */
(function (root) {
  'use strict';
  const KJ = (root.KJ = root.KJ || {});
  const KEY = 'kj.state.v1';
  let persistent = true;

  function defaultProfile() {
    return {
      name: '', education: [], experience: [], skills: [], certs: [], certsNone: false,
      resume: { name: '', text: '' },
      prefs: { interests: ['Finance', 'Business', 'Education', 'Special Education'], types: ['Full-time'], remote: false, remoteOnly: false },
      location: { priority: ['North Stockton, CA'], area: ['Stockton', 'Lodi', 'Manteca', 'Tracy', 'Lathrop', 'Ripon', 'Escalon', 'Galt', 'Modesto'] },
      salary: { min: null, desired: null, period: 'year' },
      notify: { newMatches: true, deadlines: true, sourceIssues: true, refresh: 'auto' },
    };
  }
  const defaults = () => ({ profile: defaultProfile(), applied: null, saved: {}, dismissed: {}, appliedJobs: {}, reported: {}, sources: [], jobs: [], seen: {}, lastVisit: 0, readNotes: {} });

  function merge(base, over) {
    if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
    const out = Object.assign({}, base);
    if (over && typeof over === 'object') for (const k of Object.keys(over)) out[k] = k in base ? merge(base[k], over[k]) : over[k];
    return out;
  }

  function load() {
    try {
      const raw = root.localStorage.getItem(KEY);
      if (raw) return merge(defaults(), JSON.parse(raw));
    } catch (e) { persistent = false; }
    return defaults();
  }
  function save(state) {
    try { root.localStorage.setItem(KEY, JSON.stringify(state)); persistent = true; } catch (e) { persistent = false; }
  }
  const isPersistent = () => persistent;

  /* ---- Job import ---- */
  const TYPES = ['Full-time', 'Part-time', 'Contract', 'Temporary', 'Internship'];
  const EDU = ['high school', 'associate', 'bachelor', 'master', 'doctorate'];
  const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
  const list = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
  const dateStr = (v) => { const s = str(v); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ''; };

  function normalizeJob(raw, sourceId, now) {
    if (!raw || typeof raw !== 'object') return { error: 'not an object' };
    const title = str(raw.title), employer = str(raw.employer);
    if (!title || !employer) return { error: 'missing title or employer' };
    const url = str(raw.url);
    if (url && !/^https?:\/\//i.test(url)) return { error: 'application link must start with http(s)://' };
    const id = str(raw.id) || 'j-' + (url || title + employer + str(raw.city)).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80);
    const edu = EDU.includes(str(raw.education && raw.education.level)) ? { level: str(raw.education.level), note: str(raw.education.note) } : null;
    const exp = raw.experience && Number(raw.experience.years) > 0 ? { years: Number(raw.experience.years), field: str(raw.experience.field), note: str(raw.experience.note) } : null;
    const certs = (Array.isArray(raw.certifications) ? raw.certifications : []).map((c) => (typeof c === 'string' ? { name: c, required: true } : { name: str(c.name), required: c.required !== false })).filter((c) => c.name);
    return { job: {
      id, sourceId, sample: !!raw.sample, title, employer, logoUrl: /^https?:\/\//i.test(str(raw.logoUrl)) ? str(raw.logoUrl) : '',
      city: str(raw.city), neighborhood: str(raw.neighborhood), remote: !!raw.remote, arrangement: str(raw.arrangement) || (raw.remote ? 'Remote' : 'On-site'),
      salaryMin: raw.salaryMin === undefined || raw.salaryMin === null || raw.salaryMin === '' ? null : Number(raw.salaryMin),
      salaryMax: raw.salaryMax === undefined || raw.salaryMax === null || raw.salaryMax === '' ? null : Number(raw.salaryMax),
      salaryPeriod: ['year', 'hour', 'month', 'week'].includes(raw.salaryPeriod) ? raw.salaryPeriod : 'year', compensationNote: str(raw.compensationNote),
      type: TYPES.includes(str(raw.type)) ? str(raw.type) : str(raw.type), categories: list(raw.categories).filter((c) => KJ.CATEGORIES.includes(c)),
      description: str(raw.description), summary: str(raw.summary), required: list(raw.required), preferred: list(raw.preferred),
      education: edu, experience: exp, certifications: certs,
      deadline: dateStr(raw.deadline), published: dateStr(raw.published), lastVerified: dateStr(raw.lastVerified), url, addedAt: now,
    } };
  }

  function importJobs(state, payload, source) {
    let rows = payload;
    if (rows && !Array.isArray(rows) && Array.isArray(rows.jobs)) rows = rows.jobs;
    if (!Array.isArray(rows)) throw new Error('Expected a JSON array of jobs, or an object with a "jobs" array.');
    const now = Date.now(), added = [], skipped = [];
    const existing = new Set(state.jobs.map((j) => j.id));
    rows.forEach((r, i) => {
      const res = normalizeJob(Object.assign({}, r, source.kind === 'sample' ? { sample: true } : {}), source.id, now);
      if (res.error) { skipped.push(`Row ${i + 1}: ${res.error}`); return; }
      if (existing.has(res.job.id)) {
        const idx = state.jobs.findIndex((j) => j.id === res.job.id);
        res.job.addedAt = state.jobs[idx].addedAt; state.jobs[idx] = res.job; return;
      }
      existing.add(res.job.id); state.jobs.push(res.job); added.push(res.job.id);
    });
    if (!rows.length) throw new Error('The file contains no jobs.');
    if (skipped.length === rows.length) throw new Error('No usable jobs found. ' + skipped.slice(0, 3).join('; '));
    const src = state.sources.find((s) => s.id === source.id);
    const rec = { id: source.id, name: source.name, kind: source.kind, status: 'connected', lastSync: now, error: '' };
    if (src) Object.assign(src, rec); else state.sources.push(rec);
    return { added, skipped, total: rows.length };
  }

  function removeSource(state, id) {
    state.sources = state.sources.filter((s) => s.id !== id);
    state.jobs = state.jobs.filter((j) => j.sourceId !== id || state.saved[j.id] || state.appliedJobs[j.id]);
    state.jobs.forEach((j) => { if (j.sourceId === id) j.orphan = true; });
  }

  Object.assign(KJ, { store: { load, save, isPersistent, importJobs, removeSource, defaults, defaultProfile } });
  if (typeof module !== 'undefined') module.exports = KJ;
})(typeof window !== 'undefined' ? window : globalThis);
