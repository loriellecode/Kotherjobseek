/* Matching + feed assembly. Pure functions: no DOM, no storage. */
(function (root) {
  'use strict';
  const KJ = (root.KJ = root.KJ || {});

  const CATEGORIES = ['Finance', 'Business', 'Education', 'Special Education'];
  const EDU_RANK = { 'high school': 1, associate: 2, bachelor: 3, master: 4, doctorate: 5 };
  const EDU_LABEL = { 'high school': 'High school diploma', associate: "Associate degree", bachelor: "Bachelor's degree", master: "Master's degree", doctorate: 'Doctorate' };
  const PERIOD_MULT = { year: 1, hour: 2080, month: 12, week: 52 };
  const DIRECTIONS = /\b(north|south|east|west|central|downtown)\b/g;

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
  const fmtMoney = (n) => '$' + Math.round(n).toLocaleString('en-US');

  function annual(min, max, period) {
    const m = PERIOD_MULT[period || 'year'] || 1;
    const lo = num(min), hi = num(max);
    if (lo === null && hi === null) return null;
    return { min: (lo ?? hi) * m, max: (hi ?? lo) * m };
  }
  const jobAnnual = (job) => annual(job.salaryMin, job.salaryMax, job.salaryPeriod);
  const profileFloor = (p) => { const a = annual(p.salary.min, p.salary.min, p.salary.period); return a ? a.min : null; };
  const profileDesired = (p) => { const a = annual(p.salary.desired, p.salary.desired, p.salary.period); return a ? a.min : null; };

  function salaryText(job) {
    const lo = num(job.salaryMin), hi = num(job.salaryMax);
    if (lo === null && hi === null) return '';
    const per = { year: '/yr', hour: '/hr', month: '/mo', week: '/wk' }[job.salaryPeriod || 'year'] || '';
    const f = (n) => (job.salaryPeriod === 'hour' && n % 1 ? '$' + n.toFixed(2) : fmtMoney(n));
    if (lo !== null && hi !== null && lo !== hi) return `${f(lo)}–${f(hi)}${per}`;
    return `${f(lo ?? hi)}${per}`;
  }

  function hasText(hay, needle) { return needle && norm(hay).includes(norm(needle)); }

  function locationTier(job, profile) {
    const where = norm([job.neighborhood, job.city].filter(Boolean).join(' '));
    const strip = (s) => norm(s).replace(/\bca\b|\bcalifornia\b/g, '').trim();
    const priority = profile.location.priority.map(strip).filter(Boolean);
    for (const p of priority) if (p && where.includes(p)) return { tier: 1, label: job.neighborhood || job.city };
    const cityOf = (p) => p.replace(DIRECTIONS, '').replace(/\s+/g, ' ').trim();
    const areas = profile.location.area.map(strip).concat(priority.map(cityOf)).filter(Boolean);
    const jc = strip(job.city);
    if (jc && areas.some((a) => a && (jc === a || jc.includes(a)))) return { tier: 2, label: job.city };
    return { tier: 0, label: job.city };
  }

  function experienceYears(profile, field) {
    const all = profile.experience || [];
    const inField = all.filter((e) => !field || norm(e.field) === norm(field) || norm(e.title).includes(norm(field)));
    return { total: all.length, years: inField.reduce((s, e) => s + (num(e.years) || 0), 0), inFieldCount: inField.length };
  }

  function highestEducation(profile) {
    let best = 0, label = '';
    for (const e of profile.education || []) {
      if (e.status === 'in progress') continue;
      const r = EDU_RANK[e.level] || 0;
      if (r > best) { best = r; label = e.level; }
    }
    return { rank: best, level: label, any: (profile.education || []).length > 0 };
  }

  function certMatch(heldName, jobName) {
    const a = norm(heldName), b = norm(jobName);
    if (!a || !b) return false;
    if (a.includes(b) || b.includes(a)) return true;
    const ta = new Set(a.split(' ').filter((w) => w.length > 2)), tb = b.split(' ').filter((w) => w.length > 2);
    if (!tb.length) return false;
    const hit = tb.filter((w) => ta.has(w)).length;
    return hit / tb.length >= 0.6;
  }

  function evaluate(job, profile, now) {
    now = now || Date.now();
    const meets = [], unknown = [], gaps = [], reasons = [];
    let hardUnknown = 0;

    // Education
    if (job.education && job.education.level) {
      const need = EDU_RANK[job.education.level] || 0;
      const have = highestEducation(profile);
      const label = EDU_LABEL[job.education.level] || job.education.level;
      if (!have.any) { unknown.push(`${label} required — no education added to your profile yet`); hardUnknown++; }
      else if (have.rank >= need) meets.push(`${label} or higher: you listed ${EDU_LABEL[have.level]}`);
      else if (!have.rank) { unknown.push(`${label} required — your listed education is still in progress`); hardUnknown++; }
      else gaps.push(`Asks for a ${label.toLowerCase()}; your highest completed is ${EDU_LABEL[have.level].toLowerCase()}`);
    }

    // Experience
    if (job.experience && num(job.experience.years)) {
      const need = num(job.experience.years), field = job.experience.field;
      const ex = experienceYears(profile, field);
      const what = field ? `${field.toLowerCase()} experience` : 'experience';
      if (!ex.total) { unknown.push(`${need}+ years of ${what} — no work experience added yet`); hardUnknown++; }
      else if (ex.years >= need) meets.push(`${need}+ years of ${what}: you listed ${ex.years}`);
      else if (ex.years > 0) gaps.push(`Asks for ${need}+ years of ${what}; you listed ${ex.years}`);
      else { unknown.push(`${need}+ years of ${what} — none listed in your profile`); hardUnknown++; }
    }

    // Certifications / licenses
    const held = (profile.certs || []).filter((c) => c.status !== 'in progress');
    const inProg = (profile.certs || []).filter((c) => c.status === 'in progress');
    for (const c of job.certifications || []) {
      const required = c.required !== false;
      if (held.some((h) => certMatch(h.name, c.name))) meets.push(`${c.name}: you listed this credential`);
      else if (inProg.some((h) => certMatch(h.name, c.name))) { unknown.push(`${c.name} — marked in progress in your profile`); if (required) hardUnknown++; }
      else if (!required) unknown.push(`${c.name} preferred — not in your profile`);
      else if ((profile.certs || []).length || profile.certsNone) gaps.push(`${c.name} required — not in your profile`);
      else { unknown.push(`${c.name} required — you haven't added credentials yet`); hardUnknown++; }
    }

    // Free-text requirements: only count what we can honestly confirm.
    const skills = (profile.skills || []).map(norm).filter((s) => s.length > 2);
    const resume = norm(profile.resume && profile.resume.text);
    for (const r of job.required || []) {
      const n = norm(r);
      if (skills.some((s) => n.includes(s)) ) meets.push(`${r}: matches a skill you listed`);
      else if (resume && n.split(' ').filter((w) => w.length > 5).some((w) => resume.includes(w))) meets.push(`${r}: appears in your résumé`);
      else unknown.push(`${r} — can't confirm from your profile`);
    }

    // Interest / category
    const interests = new Set(profile.prefs.interests);
    const cats = job.categories || [];
    const interestHit = cats.filter((c) => interests.has(c));
    let pts = 0;
    if (interestHit.length) { pts += 35; reasons.push(`Matches your interest in ${interestHit.join(' and ')}`); }

    // Location
    const loc = locationTier(job, profile);
    if (job.remote) {
      if (profile.prefs.remote) { pts += 22; reasons.push('Remote, which you asked for'); }
      else pts += 8;
    }
    if (loc.tier === 1) { pts += 25; reasons.push(`In ${loc.label}, one of your priority locations`); }
    else if (loc.tier === 2) { pts += 18; reasons.push(`In ${loc.label}, in your Stockton-area range`); }
    if (profile.prefs.remote && profile.prefs.remoteOnly && !job.remote) pts -= 20;

    // Salary
    const sal = jobAnnual(job);
    const floor = profileFloor(profile), desired = profileDesired(profile);
    let belowFloor = false, salaryTier = 'unlisted';
    if (sal) {
      const top = sal.max;
      if (floor !== null && top < floor) { belowFloor = true; salaryTier = 'below'; }
      else if (desired !== null && top >= desired) { salaryTier = 'desired'; pts += 20; reasons.push(`Pay reaches your desired ${fmtMoney(desired)}`); }
      else if (floor !== null) { salaryTier = 'min'; pts += 14; reasons.push(`Pay meets your ${fmtMoney(floor)} minimum`); }
      else { salaryTier = 'listed'; pts += 8; }
    } else pts += 4;

    // Qualifications
    const totalChecks = meets.length + unknown.length + gaps.length;
    pts += totalChecks ? Math.round(20 * (meets.length / totalChecks)) : 8;
    if (meets.length) reasons.push(`${meets.length} requirement${meets.length > 1 ? 's' : ''} confirmed from your profile`);
    if (gaps.length) pts -= 10 * gaps.length;

    const deadlineMs = job.deadline ? new Date(job.deadline + 'T23:59:59').getTime() : null;
    const expired = deadlineMs !== null && deadlineMs < now;

    let level;
    if (gaps.length) level = 'gap';
    else if (pts >= 70 && hardUnknown === 0) level = 'strong';
    else if (pts >= 55 && hardUnknown <= 1) level = 'good';
    else if (pts >= 35) level = 'explore';
    else level = 'low';

    return { id: job.id, points: pts, level, meets, unknown, gaps, hardUnknown, reasons, tier: loc.tier, locLabel: loc.label,
      interestHit, salaryTier, belowFloor, expired, annual: sal, interested: interestHit.length > 0 };
  }

  const LEVEL_LABEL = { strong: 'Strong match', good: 'Good match', explore: 'Needs verification', gap: 'Possible gap', low: 'Weak match' };
  const LEVEL_BARS = { strong: 3, good: 2, explore: 1, gap: 1, low: 0 };

  function inCategory(job, ev, cat) {
    if (cat === 'For You') return true;
    if (cat === 'Remote') return !!job.remote;
    if (cat === 'Nearby') return ev.tier > 0;
    return (job.categories || []).includes(cat);
  }

  function visibleJobs(state, profile, ctx) {
    ctx = ctx || {};
    const now = ctx.now || Date.now();
    const out = [];
    for (const job of state.jobs) {
      if (state.dismissed[job.id] || state.reported[job.id]) continue;
      const ev = evaluate(job, profile, now);
      if (ev.expired || ev.belowFloor) continue;
      out.push({ job, ev });
    }
    out.sort((a, b) => b.ev.points - a.ev.points);
    return out;
  }

  function buildFeed(state, profile, ctx) {
    ctx = ctx || {};
    const newIds = ctx.newIds || new Set();
    const vis = visibleJobs(state, profile, ctx);
    const forYou = vis.filter((x) => x.ev.points >= 30 || x.ev.interested || x.ev.tier > 0);
    const featured = forYou.find((x) => x.ev.level === 'strong' || x.ev.level === 'good') || forYou[0] || null;
    const rest = forYou.filter((x) => x !== featured);
    const floor = profileFloor(profile), desired = profileDesired(profile);
    const sections = [];
    const push = (id, title, blurb, items, opts) => { items = items.filter((x) => x !== featured); if (items.length) sections.push(Object.assign({ id, title, blurb, items }, opts || {})); };

    push('top', 'Top Matches', 'Your strongest opportunities, based on qualifications, pay and location you have confirmed.',
      forYou.filter((x) => x.ev.level === 'strong' || x.ev.level === 'good'), { wide: 2 });
    push('new', 'New Opportunities', 'Discovered since you last visited.',
      forYou.filter((x) => newIds.has(x.job.id)).sort((a, b) => (b.job.addedAt || 0) - (a.job.addedAt || 0)));
    push('near', 'Near You', `Jobs in ${profile.location.priority[0] || 'your area'} first, then the greater area.`,
      vis.filter((x) => x.ev.tier > 0).sort((a, b) => a.ev.tier - b.ev.tier || b.ev.points - a.ev.points), { compact: true });
    if (floor !== null || desired !== null) {
      const bar = desired !== null ? desired : floor * 1.1;
      push('pay', 'Higher-Paying Opportunities', desired !== null ? `Pay reaches your desired ${fmtMoney(desired)}.` : `At least 10% above your ${fmtMoney(floor)} minimum.`,
        forYou.filter((x) => x.ev.annual && x.ev.annual.max >= bar).sort((a, b) => b.ev.annual.max - a.ev.annual.max));
    }
    push('explore', 'Worth Exploring', 'May suit you, but experience, licensing or qualifications need checking first.',
      forYou.filter((x) => x.ev.level === 'explore' || x.ev.level === 'gap'), { compact: true });
    const has = (c) => profile.prefs.interests.includes(c);
    if (has('Education') || has('Special Education'))
      push('edu', 'Education and Special Education', 'Teaching, administration and program roles.',
        vis.filter((x) => (x.job.categories || []).some((c) => c === 'Education' || c === 'Special Education') && x.ev.points >= 30));
    if (has('Finance') || has('Business'))
      push('fin', 'Finance and Business', 'Analysis, budgeting, banking and operations.',
        vis.filter((x) => (x.job.categories || []).some((c) => c === 'Finance' || c === 'Business') && x.ev.points >= 30));
    if (profile.prefs.remote) push('remote', 'Remote Opportunities', 'Work from anywhere.', vis.filter((x) => x.job.remote));

    return { featured, rest, sections, total: vis.length, forYou };
  }

  function categoryFeed(state, profile, cat, ctx) {
    const vis = visibleJobs(state, profile, ctx).filter((x) => inCategory(x.job, x.ev, cat));
    return { featured: vis[0] || null, rest: vis.slice(1), total: vis.length };
  }

  function search(state, profile, q, ctx) {
    const n = norm(q);
    if (!n) return [];
    const terms = n.split(' ');
    const now = (ctx && ctx.now) || Date.now();
    return state.jobs.filter((j) => !state.dismissed[j.id] && !state.reported[j.id]).map((job) => ({ job, ev: evaluate(job, profile, now) }))
      .filter(({ job }) => { const hay = norm([job.title, job.employer, job.city, job.neighborhood, job.type, (job.categories || []).join(' '), job.summary, job.description].join(' ')); return terms.every((t) => hay.includes(t)); })
      .sort((a, b) => b.ev.points - a.ev.points);
  }

  function chips(profile) {
    const list = ['For You'];
    CATEGORIES.forEach((c) => profile.prefs.interests.includes(c) && list.push(c));
    if (profile.prefs.remote) list.push('Remote');
    list.push('Nearby');
    return list;
  }

  function describeChanges(a, b) {
    const out = [];
    const names = (arr, f) => (arr || []).map(f).filter(Boolean);
    const diff = (label, x, y) => {
      const add = y.filter((v) => !x.includes(v)), rem = x.filter((v) => !y.includes(v));
      add.forEach((v) => out.push(`Added ${label}: ${v}`));
      rem.forEach((v) => out.push(`Removed ${label}: ${v}`));
    };
    diff('education', names(a.education, (e) => `${EDU_LABEL[e.level] || e.level}${e.field ? ' in ' + e.field : ''}${e.status === 'in progress' ? ' (in progress)' : ''}`), names(b.education, (e) => `${EDU_LABEL[e.level] || e.level}${e.field ? ' in ' + e.field : ''}${e.status === 'in progress' ? ' (in progress)' : ''}`));
    const ex = (e) => `${e.title}${e.field ? ' (' + e.field + ')' : ''}${num(e.years) ? ', ' + e.years + ' yr' : ''}`;
    diff('experience', names(a.experience, ex), names(b.experience, ex));
    diff('skill', a.skills || [], b.skills || []);
    const ce = (c) => `${c.name}${c.status === 'in progress' ? ' (in progress)' : ''}`;
    diff('credential', names(a.certs, ce), names(b.certs, ce));
    diff('interest', a.prefs.interests, b.prefs.interests);
    diff('employment type', a.prefs.types, b.prefs.types);
    if (a.prefs.remote !== b.prefs.remote) out.push(b.prefs.remote ? 'Remote work turned on' : 'Remote work turned off');
    if (a.prefs.remoteOnly !== b.prefs.remoteOnly) out.push(b.prefs.remoteOnly ? 'Remote jobs only' : 'No longer remote-only');
    diff('priority location', a.location.priority, b.location.priority);
    diff('nearby city', a.location.area, b.location.area);
    const fl = (p) => { const f = profileFloor(p); return f === null ? 'not set' : fmtMoney(f) + '/yr'; };
    if (fl(a) !== fl(b)) out.push(`Minimum salary: ${fl(a)} → ${fl(b)}`);
    const dz = (p) => { const f = profileDesired(p); return f === null ? 'not set' : fmtMoney(f) + '/yr'; };
    if (dz(a) !== dz(b)) out.push(`Desired salary: ${dz(a)} → ${dz(b)}`);
    if ((a.resume && a.resume.name) !== (b.resume && b.resume.name) || (a.resume && a.resume.text) !== (b.resume && b.resume.text)) out.push('Résumé updated');
    return out;
  }

  function completion(p) {
    return [
      { id: 'education', label: 'Education', done: p.education.length > 0 },
      { id: 'experience', label: 'Work Experience', done: p.experience.length > 0 },
      { id: 'skills', label: 'Skills', done: p.skills.length > 0 },
      { id: 'certs', label: 'Certifications and Licenses', done: p.certs.length > 0 || !!p.certsNone },
      { id: 'resume', label: 'Résumé', done: !!(p.resume && (p.resume.name || p.resume.text)) },
      { id: 'prefs', label: 'Job Preferences', done: p.prefs.interests.length > 0 },
      { id: 'location', label: 'Location', done: p.location.priority.length > 0 },
      { id: 'salary', label: 'Salary', done: profileFloor(p) !== null },
      { id: 'notify', label: 'Notification Preferences', done: true },
    ];
  }

  Object.assign(KJ, { CATEGORIES, EDU_LABEL, norm, num, fmtMoney, salaryText, jobAnnual, profileFloor, profileDesired, evaluate,
    LEVEL_LABEL, LEVEL_BARS, buildFeed, categoryFeed, search, chips, describeChanges, completion, locationTier, inCategory, visibleJobs });
  if (typeof module !== 'undefined') module.exports = KJ;
})(typeof window !== 'undefined' ? window : globalThis);
