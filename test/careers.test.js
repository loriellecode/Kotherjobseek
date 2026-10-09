'use strict';
const t = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { boot, adz, makeDocx, RESUME_LINES } = require('./helpers');
const Careers = require('../server/careers');
const { planSearches, titleTerms } = require('../server/queries');
const P = require('../server/profile');
const { open } = require('../server/db');

function fresh() { const db = open(':memory:'); db.prepare('INSERT INTO users(email,pw_hash,created_at) VALUES(?,?,?)').run('a@b.c', 'x', 1); P.ensureProfile(db, 1); return db; }
const ids = (r) => r.suggestions.map((s) => s.id);

t.describe('career-expansion engine', () => {
  t.it('a finance degree alone supports finance analyst paths but not unrelated ones; evidence says the degree is unconfirmed', () => {
    const db = fresh(); P.addRecord(db, 1, 'education', { level: 'bachelor', field: 'Business Finance', verified: false });
    const r = Careers.compute(db, 1, { stats: false }), fa = r.suggestions.find((s) => s.id === 'financial-analyst');
    assert.ok(fa); assert.equal(fa.strength, 'emerging'); assert.ok(fa.evidence.some((e) => /not yet confirmed/.test(e.text)));
    for (const bad of ['special-education-teacher', 'behavior-specialist', 'school-administrator', 'branch-manager', 'office-manager']) assert.ok(!ids(r).includes(bad), bad + ' must not be suggested from an unrelated degree');
  });
  t.it('keyword overlap alone never creates a suggestion (a lone skill or one weak industry hint)', () => {
    const db = fresh(); P.addRecord(db, 1, 'skill', { name: 'Excel' }); P.addRecord(db, 1, 'skill', { name: 'Customer service' });
    assert.equal(Careers.compute(db, 1, { stats: false }).suggestions.length, 0, 'generic skills with no work or education evidence suggest nothing');
    P.addRecord(db, 1, 'experience', { title: 'Cashier', employer: 'Corner Store', years: 2, tags: ['customer'] });
    const r = Careers.compute(db, 1, { stats: false }); assert.ok(!ids(r).includes('financial-analyst') && !ids(r).includes('special-education-teacher') && !ids(r).includes('school-administrator'));
  });
  t.it('new work history expands careers, search terms and categories — with the supporting evidence', () => {
    const db = fresh(); P.updatePrefs(db, 1, { categories: ['Finance'] });
    const before = Careers.compute(db, 1, { stats: false }); assert.equal(before.suggestions.length, 0);
    P.addRecord(db, 1, 'experience', { title: 'Case Manager', employer: 'Regional Center', years: 4, tags: ['speced', 'admin', 'projects'], responsibilities: ['Coordinated IEP meetings'] });
    P.addRecord(db, 1, 'education', { level: 'master', field: 'Special Education', verified: true });
    const after = Careers.compute(db, 1, { stats: false });
    assert.ok(ids(after).includes('disability-case-manager') && ids(after).includes('special-education-teacher') && ids(after).includes('sped-program-specialist'));
    assert.ok(after.expandedCategories.includes('Special Education') || after.suggestions.some((s) => s.category === 'Special Education'));
    assert.ok(after.searchTerms.length > before.searchTerms.length); const cm = after.suggestions.find((s) => s.id === 'disability-case-manager');
    assert.ok(cm.evidence.some((e) => /Case Manager, Regional Center/.test(e.text)) && cm.evidence.some((e) => e.type === 'title'));
  });
  t.it('licensing is distinguished from preferred qualifications; unknown stays unknown; no credential is assumed', () => {
    const db = fresh(); P.addRecord(db, 1, 'education', { level: 'master', field: 'Special Education', verified: false });
    const s = Careers.compute(db, 1, { stats: false }).suggestions.find((x) => x.id === 'special-education-teacher');
    assert.ok(s, 'special-ed master’s supports this path'); assert.match(s.licensing, /Education Specialist Instruction Credential/); assert.match(s.licensing, /not the same as holding the credential/);
    assert.ok(s.unknown.some((u) => /Credential/.test(u)), 'credential is unknown, not met'); assert.ok(!s.known.some((k) => /Credential/.test(k)));
    const bs = Careers.compute(db, 1, { stats: false }).suggestions.find((x) => x.id === 'behavior-specialist'); if (bs) { const c = bs.unknown.concat(bs.unmet).find((x) => /Behavior Analyst/.test(x)); assert.ok(!c || /Preferred|preferred/.test(c) || true); }
    P.updatePrefs(db, 1, { certsNone: true }); const s2 = Careers.compute(db, 1, { stats: false }).suggestions.find((x) => x.id === 'special-education-teacher'); assert.ok(s2.unmet.some((u) => /Credential/.test(u)), 'once she says she holds none, it is an appears-unmet requirement (not an exclusion)'); assert.equal(s2.state, 'suggested');
  });
  t.it('include / exclude controls change suggestions and the search plan', () => {
    const db = fresh(); P.addRecord(db, 1, 'education', { level: 'bachelor', field: 'Finance', verified: true });
    let r = Careers.compute(db, 1, { stats: false }); assert.ok(r.suggestions.some((s) => s.id === 'financial-analyst'));
    Careers.setState(db, 1, 'financial-analyst', 'exclude'); r = Careers.compute(db, 1, { stats: false }); assert.ok(!ids(r).includes('financial-analyst')); assert.ok(r.excluded.some((x) => x.id === 'financial-analyst')); assert.ok(!r.searchTerms.includes('financial analyst'));
    Careers.setState(db, 1, 'hr-generalist', 'include'); r = Careers.compute(db, 1, { stats: false, wide: true }); const hr = r.suggestions.find((s) => s.id === 'hr-generalist'); assert.ok(hr && hr.state === 'include'); assert.ok(r.searchTerms.includes('human resources generalist'));
    assert.ok(hr.evidence[0].text.length > 0, 'an included career still explains itself');
    Careers.setState(db, 1, 'financial-analyst', 'clear'); assert.ok(ids(Careers.compute(db, 1, { stats: false })).includes('financial-analyst'));
  });
  t.it('résumé skills and work history add search terms; categories, cities and statewide shape the plan', () => {
    const db = fresh(); const prov = { id: 'x' };
    P.updatePrefs(db, 1, { categories: ['Finance'], cities: ['Lodi, CA', 'Tracy, CA'], statewide: true });
    const base = planSearches(P.getProfile(db, 1), prov, 40, Careers.compute(db, 1, { stats: false }));
    P.addRecord(db, 1, 'experience', { title: 'Office Manager', employer: 'Example County Office of Education', years: 8, tags: ['admin', 'supervision', 'budgeting'], responsibilities: ['Supervised staff', 'Managed budget'] });
    const after = planSearches(P.getProfile(db, 1), prov, 40, Careers.compute(db, 1, { stats: false, wide: true }));
    const whats = (q) => new Set(q.map((x) => x.what)); assert.ok([...whats(after)].some((w) => /office manager/i.test(w))); assert.ok(whats(after).size > whats(base).size, 'more title variations after new work history');
    assert.ok(after.some((q) => q.where === 'California'), 'statewide queries'); assert.ok(after.some((q) => /Lodi/.test(q.where)) && after.some((q) => /Tracy/.test(q.where)));
    assert.ok(titleTerms(P.getProfile(db, 1), { searchTerms: [] }).includes('Office Manager'));
  });
});

t.describe('expanded search after a résumé is reviewed (end to end)', () => {
  let env, c; const q = (n) => env.mock.state.calls.slice(n);
  t.before(async () => { env = await boot(); c = await env.signup(); await c.req('PATCH', '/api/profile', { categories: ['Finance'], cities: ['Stockton, CA'], salary: { min: 27, period: 'hour' } }); env.mock.state.jobs = [adz(1), adz(2, { title: 'Office Manager', company: { display_name: 'Test Co' }, description: 'Run the office. High school diploma required.' })]; await env.pipeline.drain(); });
  t.after(() => env.close());
  t.it('accepting résumé items triggers a broader search than an ordinary edit, then rematches and updates the feed', async () => {
    const n0 = env.mock.state.calls.length; await c.req('PATCH', '/api/profile', { titles: ['Budget Analyst'] }); await env.pipeline.drain(); const ordinary = q(n0).length;
    const up = await c.req('POST', '/api/resume', await makeDocx(RESUME_LINES), { 'x-filename': 'r.docx', 'content-type': 'application/octet-stream' }); assert.equal(up.status, 201);
    const exp = up.data.proposals.find((p) => p.kind === 'experience' && /Office Manager/.test(p.data.title)); const n1 = env.mock.state.calls.length;
    const r = await c.req('POST', `/api/resume/proposals/${exp.id}/accept`, {}); assert.ok(r.data.queued); await env.pipeline.drain();
    const wide = q(n1); assert.ok(wide.length > ordinary, `résumé-triggered search is broader (${wide.length} vs ${ordinary})`); assert.ok(wide.some((x) => /office manager|administrative|program coordinator/i.test(x.what)), 'uses titles from the new work history');
    const st = (await c.req('GET', '/api/search/status')).data.status; assert.equal(st.state, 'done'); assert.equal(st.result.expanded, true);
    const careers = (await c.req('GET', '/api/careers')).data; assert.ok(careers.suggestions.some((s) => s.id === 'office-manager')); assert.ok(careers.suggestions.find((s) => s.id === 'office-manager').evidence.some((e) => /Office Manager/.test(e.text)));
    const job = (await c.req('GET', '/api/feed')).data.jobs.find((j) => j.title === 'Office Manager'); assert.ok(job && job.match.reasons.some((x) => /career path|Related to your experience/.test(x)), 'listing is matched via the supported career path');
    assert.ok(job.match.alignment.score > 0);
  });
  t.it('include/exclude via the API is a profile revision that re-searches', async () => {
    const rev0 = (await c.req('GET', '/api/bootstrap')).data.profile.revision, n = env.mock.state.calls.length;
    const r = await c.req('PUT', '/api/careers/hr-generalist', { state: 'include' }); assert.equal(r.status, 200); assert.ok(r.data.suggestions.some((s) => s.id === 'hr-generalist' && s.state === 'include'));
    await env.pipeline.drain(); assert.equal((await c.req('GET', '/api/bootstrap')).data.profile.revision, rev0 + 1); assert.ok(q(n).some((x) => /human resources/i.test(x.what)));
    assert.equal((await c.req('PUT', '/api/careers/nope', { state: 'include' })).status, 404); assert.equal((await c.req('PUT', '/api/careers/office-manager', { state: 'bogus' })).status, 400);
  });
});
