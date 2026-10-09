'use strict';
/* Layouts seen in real résumés, reproduced with FICTIONAL content (no personal data in the repository). */
const t = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../server/resumeAnalysis');
const Careers = require('../server/careers');
const P = require('../server/profile');
const { open } = require('../server/db');
const { planSearches } = require('../server/queries');

const PIPE = `JANE Q SAMPLE
Springfield, State | 555-0100 | jane@example.test
CAREER SUMMARY
To secure a position in a reputable organization.
EDUCATION
Bachelor of Science in Management
Example University, Phoenix, Arizona
Associate of Arts Concentration in Business Administration
Example University, Phoenix, Arizona
SKILLS
Leadership          Communication          Microsoft Office
WORK EXPERIENCE
Case Manager|Example Parish Government|Springfield,ST|March 2023-PRESENT
• Conduct participant initial screening and assessment of job readiness and establish Individual Employment Plans.
• Help participants secure full-time employment through case management, barrier reduction and work-based learning.
• Outreach to businesses in the community to develop employment and internship opportunities for participants.
Employment Specialist|County Office of Education|Example County,CA|August 2018-March 2023
• Provide eligible youth with career guidance, vocational assessment and placement services.
• Monitors budget for student hours, wages, and support services; prepare grant proposals.
Job Developer| Example Cerebral Palsy| May 2014-August 2018
• Builds relationships with local employers to develop employment positions for clients and provides job coaching.`;
const DATE_FIRST = `Jane Q Sample
Career Summary
Experienced Employment Specialist.
Experience
03/2023 - Present
WIOA COUNSELOR, EXAMPLE JOBS
Provides vocational and educational guidance to help individuals overcome employment barriers.
Interviews, screens, and determines eligibility of applicants.
08/2018 - 03/2023
EMPLOYMENT SPECIALIST, EXAMPLE COUNTY OFFICE OF EDUCATION
Case manages students and young adults from diverse backgrounds.
Gathers information from Individualized Education Plans (IEPs).
10/2011 - 01/2014
RELATIONSHIP ADVISOR, EXAMPLE COMMUNITY CREDIT UNION
Handle banker and teller transactions and manage loan processes.`;
const REPEATED = `CAREER OBJECTIVECAREER OBJECTIVECAREER OBJECTIVECAREER OBJECTIVE
JOB DEVELOPER/EMPLOYMENT SPECIALISTJOB DEVELOPER/EMPLOYMENT SPECIALISTJOB DEVELOPER/EMPLOYMENT SPECIALISTJOB DEVELOPER/EMPLOYMENT SPECIALIST
Example County OfficeAug 2018 - Present
EXPERIENCEEXPERIENCEEXPERIENCEEXPERIENCE
Develops employment training opportunities and gathers IEP information.`;

t.describe('résumé layouts', () => {
  t.it('pipe-delimited headers: titles, employers, dates and duties are read correctly', () => {
    const r = analyze(PIPE), ex = r.proposals.filter((p) => p.kind === 'experience').map((p) => p.data);
    assert.deepEqual(ex.map((e) => [e.title, e.employer, e.start, e.end]), [['Case Manager', 'Example Parish Government', '2023-03', ''], ['Employment Specialist', 'County Office of Education', '2018-08', '2023-03'], ['Job Developer', 'Example Cerebral Palsy', '2014-05', '2018-08']]);
    assert.ok(ex[0].tags.includes('casemgmt') && ex[0].tags.includes('jobdev') && ex[0].tags.includes('careerguid')); assert.ok(ex[1].tags.includes('grants') && ex[1].tags.includes('budgeting'));
    assert.deepEqual(r.proposals.filter((p) => p.kind === 'education').map((p) => [p.data.level, p.data.field]), [['bachelor', 'Management'], ['associate', 'Business Administration']]);
  });
  t.it('date-first layout ("03/2023 - Present" then the title) separates every job', () => {
    const ex = analyze(DATE_FIRST).proposals.filter((p) => p.kind === 'experience').map((p) => p.data);
    assert.deepEqual(ex.map((e) => [e.title, e.start, e.end]), [['WIOA COUNSELOR', '2023-03', ''], ['EMPLOYMENT SPECIALIST', '2018-08', '2023-03'], ['RELATIONSHIP ADVISOR', '2011-10', '2014-01']]);
    assert.equal(ex[1].employer, 'EXAMPLE COUNTY OFFICE OF EDUCATION'); assert.ok(ex[2].tags.includes('banking')); assert.ok(ex[1].tags.includes('speced'), 'IEP work is recognised as special-education support');
  });
  t.it('headings repeated by a template ("XXXX" x4) are collapsed', () => {
    const r = analyze(REPEATED), joined = JSON.stringify(r.proposals); assert.ok(!/JOB DEVELOPER\/EMPLOYMENT SPECIALISTJOB/.test(joined)); assert.ok(!/EXPERIENCEEXPERIENCE/.test(joined));
  });
  t.it('case management is NOT mistaken for special-education work, and "students" alone is not teaching', () => {
    const tags = analyze(PIPE).proposals.filter((p) => p.kind === 'experience').flatMap((p) => p.data.tags); assert.ok(!tags.includes('speced'), 'no IEP/special-education wording → no speced tag');
  });
});

t.describe('career evidence for a workforce-development background', () => {
  const build = (text) => { const db = open(':memory:'); db.prepare('INSERT INTO users(email,pw_hash,created_at) VALUES(?,?,?)').run('a@b.c', 'x', 1); P.ensureProfile(db, 1); P.updatePrefs(db, 1, { categories: ['Finance'] });
    for (const p of analyze(text).proposals.filter((x) => x.kind === 'experience')) P.addRecord(db, 1, 'experience', p.data, 'resume'); return db; };
  t.it('suggests workforce/case-management careers from the work itself, with evidence', () => {
    const db = build(PIPE), r = Careers.compute(db, 1, { stats: false }), ids = r.suggestions.map((s) => s.id);
    for (const id of ['employment-specialist', 'case-manager', 'workforce-counselor']) assert.ok(ids.includes(id), id);
    const es = r.suggestions.find((s) => s.id === 'employment-specialist'); assert.ok(es.evidence.some((e) => /Case Manager, Example Parish Government/.test(e.text)) && es.evidence.some((e) => e.type === 'title'));
    assert.ok(r.expandedCategories.includes('Workforce Development'));
  });
  t.it('does not suggest credentialed or unrelated careers from generic duties alone', () => {
    const ids = Careers.compute(build(PIPE), 1, { stats: false }).suggestions.map((s) => s.id);
    for (const bad of ['special-education-teacher', 'behavior-specialist', 'school-administrator', 'branch-manager', 'financial-analyst', 'personal-banker', 'instructional-aide']) assert.ok(!ids.includes(bad), `${bad} must not be suggested`);
  });
  t.it('banking history (and IEP work) widens the picture when the résumé shows it', () => {
    const ids = Careers.compute(build(DATE_FIRST), 1, { stats: false }).suggestions.map((s) => s.id); assert.ok(ids.includes('personal-banker')); assert.ok(ids.includes('transition-specialist'), 'IEP + job-development evidence supports a transition/WorkAbility path');
  });
  t.it('licensing cautions are attached where a master’s degree or certification may be required', () => {
    const r = Careers.compute(build(PIPE), 1, { stats: false }), vr = r.suggestions.find((s) => s.id === 'voc-rehab-counselor'), ts = r.suggestions.find((s) => s.id === 'transition-specialist');
    assert.ok(vr && /master’s degree/.test(vr.licensingNote)); assert.ok(vr.unknown.concat(vr.unmet).some((x) => /Master/i.test(x)), 'the master’s requirement is unknown/unmet, never assumed'); if (ts) assert.match(ts.licensingNote, /credential/);
  });
  t.it('the search plan covers work-history titles, career paths AND her stated categories', () => {
    const db = build(PIPE), prof = P.getProfile(db, 1), plan = planSearches(prof, { id: 'x' }, 40, Careers.compute(db, 1, { stats: false, wide: true })), titles = new Set(plan.map((q) => q.what.toLowerCase()));
    assert.ok(titles.has('case manager') && titles.has('job developer'), 'her own titles'); assert.ok([...titles].some((x) => /workforce|employment services|workability|transition/.test(x)), 'adjacent careers'); assert.ok([...titles].some((x) => /financial analyst|budget analyst|accountant/.test(x)), 'her stated finance interest is still searched');
  });
});
