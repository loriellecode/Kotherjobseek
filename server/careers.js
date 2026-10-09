'use strict';
/* Career-expansion engine. Looks at the user's profile (education — verified or reported —, work history and its responsibilities,
 * accepted skills) and proposes adjacent occupations WITH their evidence. A suggestion needs real support:
 *   • two or more different kinds of evidence (work-history tag, job title, skill, education, industry), or
 *   • a degree field that is the standard pathway into the occupation (`eduDirect`).
 * A keyword overlap with a job description alone never creates a suggestion. Requirements are checked with the same logic as
 * job matching, so what is known / unknown / unmet — and any licensing caution — is stated explicitly. */
const KJ = require('../shared/match');
const { COMPETENCIES } = require('./resumeAnalysis');
const OCC = require('./occupations');
const { now, j } = require('./db');
const { getProfile } = require('./profile');

const LABEL = Object.fromEntries(COMPETENCIES.map(([id, label]) => [id, label]));
const has = (hay, needle) => KJ.norm(hay).includes(KJ.norm(needle));

function evidenceFor(o, p) {
  const ev = [], types = new Set(); let score = 0, expTagEntries = 0, direct = false, core = false;
  const add = (type, w, text) => { ev.push({ type, text }); types.add(type); score += w; };
  for (const e of p.experience || []) {
    const hit = (e.tags || []).filter((t) => o.tags.includes(t));
    if (hit.some((t) => o.core.includes(t))) core = true;
    const coreHit = hit.some((t) => o.core.includes(t)); // generic duties (projects, admin, training…) count only a little; defining competencies count fully
    if (hit.length) { if (coreHit) expTagEntries++; add('work', coreHit ? 2 + Math.min(2, hit.length - 1) : 0.5, `Work history — ${e.title}${e.employer ? ', ' + e.employer : ''}: responsibilities include ${hit.map((t) => LABEL[t] || t).join(', ').toLowerCase()}${e.verified === false ? ' (not yet confirmed)' : ''}`); }
    if (o.titles.some((t) => has(e.title, t))) { core = true; add('title', 3, `Job title — you worked as ${e.title}${e.employer ? ' at ' + e.employer : ''}`); }
    if (o.industries.length && o.industries.some((i) => has(`${e.employer} ${(e.responsibilities || []).join(' ')}`, i))) add('industry', 1, `Industry — experience at ${e.employer}`);
  }
  for (const s of p.skills || []) {
    if (s.name && o.skills.some((k) => has(s.name, k))) { core = true; add('skill', 2, `Skill — ${s.name}${s.origin === 'inferred' ? ' (suggested from your résumé and confirmed by you)' : ''}`); }
  }
  for (const e of p.education || []) {
    const txt = `${e.field} ${e.title}`;
    if (o.edu.some((k) => has(txt, k))) { direct = direct || o.eduDirect; add('education', e.verified === false ? 1.5 : 2, `Education — ${e.field || e.title}${e.level ? ' (' + KJ.EDU_LABEL[e.level].toLowerCase() + ')' : ''}, ${e.verified === false ? 'reported but not yet confirmed' : 'confirmed'}`); }
  }
  const supported = (core && (types.size >= 2 || expTagEntries >= 2)) || (direct && types.has('education')); // a defining competency is required
  return { ev, score, supported, types: [...types], direct };
}

function requirementReport(o, p, resumeText) {
  const job = { title: o.title, categories: [o.category], education: o.require.education ? { level: o.require.education } : null, experience: o.require.experience ? Object.assign({}, o.require.experience) : null, certifications: (o.require.certs || []).map((c) => Object.assign({}, c)), required: [], preferred: [] };
  const m = KJ.evaluate(job, p, { resumeText });
  const checks = m.qualification.checks;
  return { known: checks.filter((c) => c.status === 'met').map((c) => `${c.requirement} — ${c.note}`), toConfirm: checks.filter((c) => c.status === 'reported').map((c) => `${c.requirement} — ${c.note}`),
    unknown: checks.filter((c) => c.status === 'unknown').map((c) => `${c.requirement} — ${c.note}`), unmet: checks.filter((c) => c.status === 'unmet').map((c) => `${c.requirement} — ${c.note}`) };
}

function statsFor(db, o, p) {
  const terms = [...o.terms, o.title].map(KJ.norm), rows = db.prepare("SELECT * FROM jobs WHERE status='active'").all();
  const hit = rows.filter((r) => terms.some((t) => KJ.norm(r.title).includes(t) || t.includes(KJ.norm(r.title))));
  const cities = {}, pay = []; let near = 0;
  for (const r of hit) {
    const city = r.remote ? 'Remote' : r.city || 'Location not listed'; cities[city] = (cities[city] || 0) + 1;
    const loc = KJ.evalLocation({ city: r.city, state: r.state, neighborhood: r.neighborhood, remote: !!r.remote, lat: r.lat, lon: r.lon, locationText: r.location_text }, p);
    if (['priority', 'preferred_city', 'within_commute'].includes(loc.status)) near++;
    const a = !r.salary_estimated && KJ.annual(r.salary_min, r.salary_max, r.salary_period); if (a) pay.push(a);
  }
  const salary = pay.length >= 3 ? { low: Math.round(Math.min(...pay.map((x) => x.min))), high: Math.round(Math.max(...pay.map((x) => x.max))), n: pay.length } : null;
  return { openings: hit.length, nearby: near, cities: Object.entries(cities).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, n]) => ({ city: c, n })), salary };
}

function prefsFor(db, userId) { return Object.fromEntries(db.prepare('SELECT occupation_id, state FROM career_prefs WHERE user_id=?').all(userId).map((r) => [r.occupation_id, r.state])); }

/* -> { suggestions[], excluded[], searchTerms[], careerTerms[], expandedCategories[] } */
function compute(db, userId, opts) {
  opts = opts || {};
  const p = opts.profile || getProfile(db, userId), prefs = prefsFor(db, userId), resumeText = (db.prepare('SELECT text FROM resumes WHERE user_id=? ORDER BY id DESC LIMIT 1').get(userId) || {}).text || '';
  const out = [], excluded = [];
  for (const o of OCC) {
    const e = evidenceFor(o, p), state = prefs[o.id] || 'suggested';
    if (state === 'exclude') { excluded.push({ id: o.id, title: o.title, state }); continue; }
    if (!(e.supported && (e.score >= 3 || (e.direct && e.types.includes('education')))) && state !== 'include') continue;
    const req = requirementReport(o, p, resumeText), inCats = (p.categories || []).includes(o.category);
    out.push({ id: o.id, title: o.title, category: o.category, extra: !!o.extra, otherCategory: !inCats || !!o.extra, state, score: Math.round(e.score * 10) / 10, strength: e.score >= 7 ? 'strong' : e.score >= 4.5 ? 'moderate' : 'emerging',
      does: o.does, evidence: e.ev.length ? e.ev : [{ type: 'chosen', text: 'You chose to include this career in your searches.' }], evidenceBasis: e.types, transferable: [...new Set(e.ev.filter((x) => x.type === 'work' || x.type === 'skill').map((x) => x.text.replace(/^(Work history|Skill) — /, '')))].slice(0, 6),
      essential: o.quals, known: req.known, toConfirm: req.toConfirm, unknown: req.unknown, unmet: req.unmet, licensing: o.licensing,
      licensingNote: req.unmet.concat(req.unknown).some((x) => /credential|license|certif/i.test(x)) || o.licensing ? (o.licensing || 'A license or credential may be required — verify with each employer.') : null,
      searchTerms: o.terms, stats: opts.stats === false ? null : statsFor(db, o, p) });
  }
  out.sort((a, b) => (b.state === 'include') - (a.state === 'include') || b.score - a.score);
  const wide = !!opts.wide, active = out.filter((x) => x.state === 'include' || x.strength !== 'emerging' || wide);
  const termList = active.slice(0, wide ? 14 : 6).flatMap((x) => x.searchTerms.slice(0, wide ? 3 : 2).map((t) => ({ term: t, career: x.title })));
  const expanded = [...new Set(out.filter((x) => x.state === 'include' || x.strength === 'strong').map((x) => x.category))].filter((c) => KJ.CATEGORIES.includes(c) && !(p.categories || []).includes(c));
  return { suggestions: out, excluded, careerTerms: termList, searchTerms: [...new Set(termList.map((t) => t.term))], expandedCategories: expanded };
}
function setState(db, userId, occupationId, state) {
  if (!OCC.some((o) => o.id === occupationId)) return false;
  if (state === 'clear') db.prepare('DELETE FROM career_prefs WHERE user_id=? AND occupation_id=?').run(userId, occupationId);
  else db.prepare('INSERT INTO career_prefs(user_id,occupation_id,state,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,occupation_id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at').run(userId, occupationId, state, now());
  return true;
}
module.exports = { compute, setState, OCC, evidenceFor };
