/* Transparent job/profile matching. Pure functions, used by the server (authoritative) and the browser (feed layout).
 *
 * Principles
 *  - Only profile data the user entered counts as evidence. Missing information is "unknown", never "unmet".
 *  - Mandatory requirements and preferred qualifications are scored separately. An unmet mandatory requirement
 *    (a credential, a degree level, required years) sets the classification to "needs_more" — it is not a small penalty.
 *  - The overall score estimates profile alignment. It is NOT a prediction of being hired.
 */
(function (root) {
  'use strict';
  const KJ = (root.KJ = root.KJ || {});

  const EDU_RANK = { 'high school': 1, associate: 2, bachelor: 3, master: 4, doctorate: 5 };
  const EDU_LABEL = { 'high school': 'High school diploma', associate: 'Associate degree', bachelor: "Bachelor's degree", master: "Master's degree", doctorate: 'Doctorate' };
  const PERIOD_MULT = { year: 1, hour: 2080, month: 12, week: 52 };
  const CATEGORIES = ['Finance', 'Business', 'Education', 'Special Education', 'Workforce Development', 'Banking'];
  const CLASS_LABEL = { strong: 'Strong match', potential: 'Potential match', needs_more: 'Additional qualifications may be needed' };
  const CLASS_SHORT = { strong: 'Strong match', potential: 'Potential match', needs_more: 'May need more qualifications' };
  const CLASS_BARS = { strong: 3, potential: 2, needs_more: 1 };
  const FIELD_WORDS = {
    Finance: ['finance', 'financial', 'accounting', 'accountant', 'budget', 'banking', 'bank', 'audit', 'treasury', 'fiscal', 'payroll', 'credit', 'loan', 'investment', 'controller'],
    Business: ['business', 'operations', 'administration', 'management', 'manager', 'analyst', 'coordinator', 'logistics', 'procurement', 'strategy'],
    Education: ['education', 'school', 'teacher', 'teaching', 'instruction', 'instructional', 'principal', 'district', 'curriculum', 'academic', 'college', 'student', 'counselor'],
    'Workforce Development': ['workforce', 'employment specialist', 'job developer', 'job placement', 'career counselor', 'career services', 'vocational', 'wioa', 'case manager', 'job coach', 'reentry', 'one stop', 'employment services', 'career technician', 'work experience'],
    Banking: ['banking', 'bank', 'teller', 'credit union', 'loan', 'lending', 'relationship banker', 'personal banker', 'branch', 'member service'],
    'Special Education': ['special education', 'iep', 'resource specialist', 'behavior', 'autism', 'disabilities', 'mild moderate', 'moderate severe', 'education specialist'],
  };
  // Approximate city-centre coordinates (degrees) for commute estimates when a listing carries no coordinates.
  const CITIES = { stockton: [37.9577, -121.2908], lodi: [38.1302, -121.2724], tracy: [37.7397, -121.4252], manteca: [37.7974, -121.2161], lathrop: [37.8227, -121.2761], modesto: [37.6391, -120.9969], sacramento: [38.5816, -121.4944], galt: [38.2546, -121.3], ripon: [37.7414, -121.1244], escalon: [37.7974, -120.9969], turlock: [37.4947, -120.8466], 'elk grove': [38.4088, -121.3716], oakland: [37.8044, -122.2712], 'san francisco': [37.7749, -122.4194], fresno: [36.7378, -119.7871], vacaville: [38.3566, -121.9877], fairfield: [38.2494, -122.04], pleasanton: [37.6624, -121.8747], 'san jose': [37.3382, -121.8863], livermore: [37.6819, -121.768], brentwood: [37.9319, -121.6958], antioch: [38.0049, -121.8058], davis: [38.5449, -121.7405], woodland: [38.6785, -121.7733], roseville: [38.7521, -121.288], folsom: [38.678, -121.1761], 'rancho cordova': [38.5891, -121.3027], merced: [37.3022, -120.483], 'los banos': [37.0583, -120.8499], patterson: [37.4716, -121.1297], acampo: [38.1916, -121.2569], 'french camp': [37.8813, -121.2677], lockeford: [38.1583, -121.1452], hayward: [37.6688, -122.0808], concord: [37.978, -122.0311], 'walnut creek': [37.9101, -122.0652] };

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
  const fmtMoney = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const tokens = (s) => norm(s).split(' ').filter((w) => w.length > 2);

  function annual(min, max, period) {
    const m = PERIOD_MULT[period || 'year'] || 1, lo = num(min), hi = num(max);
    if (lo === null && hi === null) return null;
    return { min: (lo ?? hi) * m, max: (hi ?? lo) * m };
  }
  const profileFloor = (p) => { const a = annual(p.salary && p.salary.min, p.salary && p.salary.min, p.salary && p.salary.period); return a ? a.min : null; };
  const profileDesired = (p) => { const a = annual(p.salary && p.salary.desired, p.salary && p.salary.desired, p.salary && p.salary.period); return a ? a.min : null; };
  function salaryText(job) {
    const lo = num(job.salaryMin), hi = num(job.salaryMax);
    if (lo === null && hi === null) return '';
    const per = { year: '/yr', hour: '/hr', month: '/mo', week: '/wk' }[job.salaryPeriod || 'year'] || '';
    const f = (n) => (job.salaryPeriod === 'hour' && n % 1 ? '$' + n.toFixed(2) : fmtMoney(n));
    const range = lo !== null && hi !== null && lo !== hi ? `${f(lo)}–${f(hi)}${per}` : `${f(lo ?? hi)}${per}`;
    return job.salaryEstimated ? `${range} (estimated)` : range;
  }

  /* Pay in both forms: the posted figure first, then the equivalent (full-time = 2,080 hours a year). */
  function salaryParts(job) {
    const lo = num(job.salaryMin), hi = num(job.salaryMax);
    if (lo === null && hi === null) return null;
    const per = job.salaryPeriod || 'year', a = annual(lo, hi, per), est = job.salaryEstimated ? ' (estimated)' : '';
    const money = (n, cents) => '$' + (cents ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(n).toLocaleString('en-US'));
    const range = (x, y, cents) => (x !== y ? `${money(x, cents)}–${money(y, cents)}` : money(x, cents));
    const hourly = { min: a.min / 2080, max: a.max / 2080 };
    const l = lo ?? hi, h = hi ?? lo;
    const main = per === 'hour' ? `${range(l, h, l % 1 !== 0 || h % 1 !== 0)}/hr` : salaryText(job).replace(' (estimated)', '');
    const alt = per === 'hour' ? `≈ ${range(a.min, a.max, false)}/yr full-time` : `≈ ${range(hourly.min, hourly.max, true)}/hr`;
    return { main: main + est, alt: alt + est, hourlyMin: hourly.min, hourlyMax: hourly.max };
  }

  /* ---------- location ---------- */
  const stripPlace = (s) => norm(s).replace(/\b(ca|california|usa|us|united states)\b/g, '').replace(/\s+/g, ' ').trim();
  const cityOnly = (s) => stripPlace(s).replace(/\b(north|south|east|west|central|downtown|greater)\b/g, '').replace(/\s+/g, ' ').trim();
  function coordsFor(name) { const c = cityOnly(name); if (CITIES[c]) return CITIES[c]; for (const k of Object.keys(CITIES)) if (c.includes(k)) return CITIES[k]; return null; }
  function miles(a, b) {
    const R = 3958.8, rad = (d) => (d * Math.PI) / 180, dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function evalLocation(job, profile) {
    const modes = profile.workModes && profile.workModes.length ? profile.workModes : ['onsite'];
    const wantsRemote = modes.includes('remote'), onlyRemote = modes.length === 1 && wantsRemote;
    if (job.remote) return wantsRemote ? { status: 'remote', score: 100, text: 'Remote — matches your work-arrangement preference' } : { status: 'remote_not_preferred', score: 40, text: 'Remote — you haven’t asked for remote work' };
    if (onlyRemote) return { status: 'not_preferred', score: 15, text: 'On-site or hybrid; you only want remote work' };
    const where = stripPlace([job.neighborhood, job.city].filter(Boolean).join(' '));
    const cities = profile.cities || [];
    for (let i = 0; i < cities.length; i++) {
      const c = stripPlace(cities[i]); if (!c) continue;
      if (where.includes(c) || (job.neighborhood && stripPlace(job.neighborhood) === c)) return { status: i === 0 ? 'priority' : 'preferred_city', score: i === 0 ? 100 : 92, text: `In ${job.neighborhood || job.city}, one of your preferred locations`, miles: 0 };
    }
    for (let i = 0; i < cities.length; i++) {
      const c = cityOnly(cities[i]); if (c && cityOnly(job.city) === c) return { status: i === 0 ? 'priority' : 'preferred_city', score: i === 0 ? 90 : 85, text: `In ${job.city}${i === 0 ? ' — the exact neighborhood isn’t listed' : ', one of your preferred cities'}`, miles: 0 };
    }
    const jc = num(job.lat) !== null && num(job.lon) !== null ? [Number(job.lat), Number(job.lon)] : coordsFor(job.city || '');
    if (!jc) { const ca0 = /^(ca|california)$/i.test(String(job.state || '').trim()) || /,\s*(ca|california)\b/i.test(job.locationText || ''); if (profile.statewide && ca0) return { status: 'elsewhere_ca', score: 45, text: `In ${job.city || 'California'} — elsewhere in California (distance unknown)` }; return { status: 'unknown', score: 40, text: job.city ? `Distance to ${job.city} unknown` : 'Location not listed' }; }
    let best = null;
    for (const c of cities) { const cc = coordsFor(c); if (cc) { const d = miles(cc, jc); if (best === null || d < best) best = d; } }
    if (best === null) return { status: 'unknown', score: 40, text: 'Add a preferred city to compare distance' };
    const limit = num(profile.commuteMiles) ?? 30;
    const ca = /^(ca|california)$/i.test(String(job.state || '').trim()) || /,\s*(ca|california)\b/i.test(job.locationText || '');
    if (best > limit && profile.statewide && ca) return { status: 'elsewhere_ca', score: 45, text: `About ${Math.round(best)} mi away, elsewhere in California (you’re open to California-wide)`, miles: best };
    if (best <= limit) return { status: 'within_commute', score: Math.round(80 - (best / Math.max(limit, 1)) * 20), text: `About ${Math.round(best)} mi from your preferred area (limit ${limit})`, miles: best };
    return { status: 'outside', score: 15, text: `About ${Math.round(best)} mi away — beyond your ${limit}-mile limit`, miles: best };
  }

  /* ---------- salary ---------- */
  function evalSalary(job, profile) {
    const sal = annual(job.salaryMin, job.salaryMax, job.salaryPeriod), floor = profileFloor(profile), desired = profileDesired(profile);
    if (!sal) return { status: 'unlisted', score: 40, text: 'Salary not listed' };
    if (job.salaryEstimated) return { status: 'estimated', score: 50, text: 'Salary is an estimate from the source, not the employer — not used to filter' };
    if (floor === null && desired === null) return { status: 'no_preference', score: 60, text: 'Set a salary minimum to compare' };
    if (floor !== null && sal.max < floor) return { status: 'below', score: 0, text: `Top of range ${fmtMoney(sal.max)} is below your ${fmtMoney(floor)} minimum` };
    if (desired !== null && sal.max >= desired) return { status: 'meets_desired', score: 100, text: `Reaches your desired ${fmtMoney(desired)}` };
    const ratio = floor ? (sal.max - floor) / floor : 0; // pay further above the minimum scores higher
  return { status: 'meets_min', score: Math.round(70 + 25 * (1 - Math.exp(-2 * Math.max(0, ratio)))), text: floor !== null ? `Meets your ${fmtMoney(floor)} minimum (top of range ${fmtMoney(sal.max)})` : 'Within your range' };
  }

  /* ---------- field alignment (is this the kind of work she is pointed at?) ---------- */
  function evalAlignment(job, profile) {
    const ev = [], title = norm(job.title);
    const jobText = norm([job.title, (job.categories || []).join(' '), String(job.description || job.summary || '').slice(0, 2500)].join(' '));
    let score = 0;
    const pt = (profile.titles || []).find((t) => { const n = norm(t); if (!n) return false; if (title.includes(n) || n.includes(title)) return true; const a = tokens(t), b = new Set(tokens(job.title)); return a.length && a.filter((w) => b.has(w)).length / a.length >= 0.67; });
    if (pt) { score += 40; ev.push(`Similar to your preferred title “${pt}”`); }
    const ct = (profile.careerTerms || []).find((c) => { const n = norm(c.term); return n && (title.includes(n) || n.includes(title)); });
    if (ct) { score += 30; ev.push(`Matches a career path your background supports: ${ct.career}`); }
    const cats = (job.categories || []).filter((c) => (profile.categories || []).includes(c));
    if (cats.length) { score += 20; ev.push(`In your chosen categories: ${cats.join(', ')}`); }
    const edu = (profile.education || []).find((e) => e.field && tokens(e.field).some((w) => jobText.includes(w)));
    if (edu) { score += 20; ev.push(`Your ${edu.field} education relates to this field`); }
    const exp = (profile.experience || []).find((e) => (e.title && tokens(e.title).filter((w) => w.length > 3).some((w) => title.includes(w))) || (e.field && tokens(e.field).some((w) => jobText.includes(w))));
    if (exp) { score += 25; ev.push(`Related to your experience as ${exp.title}`); }
    const sk = (profile.skills || []).map((s) => (typeof s === 'string' ? s : s.name)).filter((s) => s && jobText.includes(norm(s)));
    if (sk.length) { score += Math.min(20, sk.length * 8); ev.push(`Mentions skills you listed: ${sk.slice(0, 3).join(', ')}`); }
    return { score: Math.min(100, score), evidence: ev };
  }

  /* ---------- qualifications ---------- */
  function certMatch(a, b) {
    const x = norm(a), y = norm(b); if (!x || !y) return false;
    if (x.includes(y) || y.includes(x)) return true;
    const ta = new Set(tokens(x)), tb = tokens(y); return tb.length > 0 && tb.filter((w) => ta.has(w)).length / tb.length >= 0.6;
  }
  function evalQualifications(job, profile, resumeText) {
    const checks = [];
    const add = (kind, requirement, mandatory, status, note, inferred) => checks.push({ kind, requirement, mandatory, status, note, inferred: !!inferred });
    /* Statuses: met (confirmed by the user) · reported (the user told us, not yet confirmed) · unknown · unmet. */
    const edu = (profile.education || []).filter((e) => e.status !== 'in progress');
    const best = (list) => { let r = 0, lvl = ''; for (const e of list) { const k = EDU_RANK[e.level] || 0; if (k > r) { r = k; lvl = e.level; } } return { rank: r, level: lvl }; };
    const hiV = best(edu.filter((e) => e.verified !== false)), hiR = best(edu), anyEdu = (profile.education || []).length > 0;

    if (job.education && job.education.level) {
      const need = EDU_RANK[job.education.level] || 0, label = EDU_LABEL[job.education.level], mand = !job.education.preferred, inf = job.education.inferred;
      if (!anyEdu) add('education', label, mand, 'unknown', 'No education in your profile yet', inf);
      else if (hiV.rank >= need) add('education', label, mand, 'met', `You confirmed ${EDU_LABEL[hiV.level]}`, inf);
      else if (hiR.rank >= need) add('education', label, mand, 'reported', `You reported ${EDU_LABEL[hiR.level]}, but haven’t confirmed it yet`, inf);
      else if (!hiR.rank) add('education', label, mand, 'unknown', 'Your education entries don’t say which degree level you hold (or are in progress)', inf);
      else add('education', label, mand, 'unmet', `Your highest reported degree is ${EDU_LABEL[hiR.level].toLowerCase()}`, inf);
    }
    if (job.experience && num(job.experience.years)) {
      const need = num(job.experience.years), field = job.experience.field, mand = !job.experience.preferred, all = profile.experience || [];
      const rel = (list) => (field ? list.filter((e) => norm(e.field) === norm(field) || tokens(field).some((w) => norm(e.title).includes(w) || (e.tags || []).some((t) => norm(t).includes(w)))) : list);
      const yrs = (list) => list.reduce((t, e) => t + (num(e.years) || 0), 0);
      const yV = yrs(rel(all.filter((e) => e.verified !== false))), yR = yrs(rel(all));
      const label = `${need}+ years${field ? ' of ' + field.toLowerCase() + ' experience' : ' of experience'}`, inf = job.experience.inferred;
      if (!all.length) add('experience', label, mand, 'unknown', 'No work history added yet — that doesn’t mean you lack experience', inf);
      else if (yV >= need) add('experience', label, mand, 'met', `You confirmed ${yV} years`, inf);
      else if (yR >= need) add('experience', label, mand, 'reported', `You listed ${yR} years, not all confirmed yet`, inf);
      else if (yR > 0) add('experience', label, mand, 'unmet', `You listed ${yR} years`, inf);
      else add('experience', label, mand, 'unknown', field ? `No ${field.toLowerCase()} experience listed (other work may still be relevant)` : 'No years recorded', inf);
    }
    const certs = profile.certs || [], held = certs.filter((c) => c.status !== 'in progress'), prog = certs.filter((c) => c.status === 'in progress');
    const degreeCaution = anyEdu ? ' A degree on its own doesn’t confirm a credential or license.' : '';
    for (const c of job.certifications || []) {
      const mand = c.required !== false, hit = held.find((h) => certMatch(h.name, c.name));
      if (hit && hit.verified !== false) add('cert', c.name, mand, 'met', 'You confirmed this credential', c.inferred);
      else if (hit) add('cert', c.name, mand, 'reported', 'You listed it, but haven’t confirmed it yet', c.inferred);
      else if (prog.some((h) => certMatch(h.name, c.name))) add('cert', c.name, mand, 'unknown', 'Marked in progress in your profile', c.inferred);
      else if (!mand) add('cert', c.name, false, 'unknown', 'Preferred; not in your profile', c.inferred);
      else if (certs.length || profile.certsNone) add('cert', c.name, true, 'unmet', 'Not in your profile — may need to be obtained or verified.' + degreeCaution, c.inferred);
      else add('cert', c.name, true, 'unknown', 'No credentials recorded yet — verify whether you hold this license.' + degreeCaution, c.inferred);
    }
    const skills = (profile.skills || []).map((s) => norm(typeof s === 'string' ? s : s.name)).filter((s) => s.length > 2), resume = norm(resumeText || '');
    const freeText = (list, mand) => { for (const r of list || []) { const n = norm(r); if (skills.some((s) => n.includes(s))) add('skill', r, mand, 'met', 'Matches a skill you listed'); else add('skill', r, mand, 'unknown', resume ? 'Can’t confirm from your profile' : 'Can’t confirm yet'); } };
    freeText(job.required, true); freeText(job.preferred, false);
    return checks;
  }

  function qualScore(checks) {
    if (!checks.length) return 50;
    let got = 0, tot = 0;
    for (const c of checks) { const w = c.mandatory ? 3 : 1; tot += w; got += w * (c.status === 'met' ? 1 : c.status === 'reported' ? 0.8 : c.status === 'unknown' ? 0.35 : 0); }
    return Math.round((100 * got) / tot);
  }

  /* ---------- the evaluation ---------- */
  function evaluate(job, profile, ctx) {
    ctx = ctx || {};
    const checks = evalQualifications(job, profile, ctx.resumeText);
    const mand = checks.filter((c) => c.mandatory);
    const unmet = mand.filter((c) => c.status === 'unmet'), mUnknown = mand.filter((c) => c.status === 'unknown'), mMet = mand.filter((c) => c.status === 'met'), mReported = mand.filter((c) => c.status === 'reported');
    const align = evalAlignment(job, profile), salary = evalSalary(job, profile), location = evalLocation(job, profile);
    const types = profile.types || [];
    const typeStatus = !job.type || !types.length ? 'unknown' : types.includes(job.type) ? 'match' : 'mismatch';

    const qScore = qualScore(checks);
    let qLevel = 'potential';
    if (unmet.length) qLevel = 'needs_more';
    else if (!mUnknown.length && !mReported.length && (mMet.length >= 1 || align.score >= 60)) qLevel = 'strong';

    const parts = [
      { key: 'qualification', label: 'Qualifications', weight: 35, score: qScore },
      { key: 'alignment', label: 'Field alignment', weight: 25, score: align.score },
      { key: 'location', label: 'Location', weight: 20, score: location.score },
      { key: 'salary', label: 'Salary', weight: 15, score: salary.score },
      { key: 'type', label: 'Employment type', weight: 5, score: typeStatus === 'match' ? 100 : typeStatus === 'unknown' ? 60 : 0 },
    ];
    let overall = Math.round(parts.reduce((s, p) => s + (p.weight * p.score) / 100, 0));
    // Pay above her desired rate keeps ranking higher (up to +5), so higher-paying roles are prioritized even once the target is met.
    let payBonus = 0; const dsr = profileDesired(profile); if (salary.status === 'meets_desired' && dsr) { const top = (annual(job.salaryMin, job.salaryMax, job.salaryPeriod) || { max: 0 }).max; payBonus = Math.min(5, Math.round((10 * (top - dsr)) / dsr)); overall = Math.min(100, overall + payBonus); }
    let capped = false;
    if (unmet.length && overall > 60) { overall = 60; capped = true; }

    let classification = 'potential';
    if (unmet.length) classification = 'needs_more';
    else if (qLevel === 'strong' && align.score >= 40 && location.status !== 'outside' && location.status !== 'not_preferred') classification = 'strong';

    const meets = checks.filter((c) => c.status === 'met').map((c) => `${c.requirement} — ${c.note}`);
    const unverified = checks.filter((c) => c.status === 'reported').map((c) => `${c.requirement}${c.mandatory ? '' : ' (preferred)'} — ${c.note}`);
    const unknown = checks.filter((c) => c.status === 'unknown').map((c) => `${c.requirement}${c.mandatory ? '' : ' (preferred)'} — ${c.note}`);
    const gaps = checks.filter((c) => c.status === 'unmet').map((c) => `${c.requirement}${c.mandatory ? ' (required)' : ''} — ${c.note}`);
    const reasons = [...align.evidence];
    if (location.score >= 80) reasons.push(location.text);
    if (salary.status === 'meets_desired' || salary.status === 'meets_min') reasons.push(salary.text);

    return {
      classification, overall, capped, payBonus, parts, reasons, meets, unverified, unknown, gaps,
      qualification: { level: qLevel, score: qScore, checks, mandatoryUnmet: unmet.length, mandatoryUnknown: mUnknown.length, mandatoryUnverified: mReported.length },
      salary, location, alignment: align, typeStatus,
      excluded: { belowFloor: salary.status === 'below' },
      explanation: 'Overall relevance is a weighted estimate of how well this listing aligns with the profile you entered: qualifications 35%, field alignment 25%, location 20%, salary 15%, employment type 5%. Pay above your desired rate adds up to 5 points. A required qualification you appear not to meet caps it at 60. It is not a prediction of whether you will be hired.',
    };
  }

  /* ---------- feed assembly (works on jobs that already carry .match) ---------- */
  const isNearby = (m) => ['priority', 'preferred_city', 'within_commute'].includes(m.location.status);
  function visible(jobs, profile, ctx) {
    const showBelow = !!(profile.salary && profile.salary.showBelow);
    return jobs.filter((j) => j.match && !j.userState.dismissed && !j.userState.reported && !['expired', 'possibly_expired', 'closed'].includes(j.status) && (showBelow || !j.match.excluded.belowFloor))
      .sort((a, b) => b.match.overall - a.match.overall || ((annual(b.salaryMin, b.salaryMax, b.salaryPeriod) || { max: 0 }).max - (annual(a.salaryMin, a.salaryMax, a.salaryPeriod) || { max: 0 }).max));
  }
  function buildFeed(jobs, profile, ctx) {
    ctx = ctx || {};
    const vis = visible(jobs, profile), newIds = ctx.newIds || new Set();
    const forYou = vis.filter((j) => j.match.alignment.score > 0 || isNearby(j.match) || j.match.classification !== 'needs_more' || j.match.overall >= 40);
    const featured = forYou.find((j) => j.match.classification === 'strong') || forYou.find((j) => j.match.classification === 'potential') || forYou[0] || null;
    const sections = [], push = (id, title, blurb, items, opts) => { items = items.filter((x) => x !== featured); if (items.length) sections.push(Object.assign({ id, title, blurb, items }, opts || {})); };
    push('top', 'Top Matches', 'Strong alignment with the requirements we can verify from your profile.', forYou.filter((j) => j.match.classification === 'strong'), { wide: 2, image: 'career growth' });
    push('new', 'New Opportunities', 'First found since you last visited.', forYou.filter((j) => newIds.has(j.id)));
    push('near', 'Near You', `${(profile.cities && profile.cities[0]) || 'Your area'} first, then the rest of your range.`, vis.filter((j) => isNearby(j.match)).sort((a, b) => a.match.location.score < b.match.location.score ? 1 : -1 || b.match.overall - a.match.overall), { compact: true });
    const floor = profileFloor(profile), desired = profileDesired(profile), bar = desired !== null ? desired : floor !== null ? floor * 1.15 : null;
    if (bar !== null) push('pay', 'Higher-Paying Opportunities', desired !== null ? 'Pay reaches your desired salary.' : `Top of range at least 15% above your ${fmtMoney(floor)}/yr minimum.`, forYou.filter((j) => { const a = annual(j.salaryMin, j.salaryMax, j.salaryPeriod); return a && !j.salaryEstimated && a.max >= bar; }).sort((a, b) => annual(b.salaryMin, b.salaryMax, b.salaryPeriod).max - annual(a.salaryMin, a.salaryMax, a.salaryPeriod).max));
    push('explore', 'Worth Exploring', 'Promising, but something needs verifying first.', forYou.filter((j) => j.match.classification === 'potential'), { compact: true });
    const cats = profile.categories || [];
    if (cats.includes('Education') || cats.includes('Special Education')) push('edu', 'Education and Special Education', 'Teaching, administration and program roles.', vis.filter((j) => (j.categories || []).some((c) => c === 'Education' || c === 'Special Education')), { image: 'education' });
    if (cats.includes('Finance') || cats.includes('Business')) push('fin', 'Finance and Business', 'Analysis, budgeting, banking and operations.', vis.filter((j) => (j.categories || []).some((c) => c === 'Finance' || c === 'Business')), { image: 'finance' });
    if ((profile.workModes || []).includes('remote')) push('remote', 'Remote Opportunities', 'Work from anywhere.', vis.filter((j) => j.remote), { image: 'remote work' });
    return { featured, sections, total: vis.length, forYou };
  }
  function categoryFeed(jobs, profile, cat) {
    const vis = visible(jobs, profile).filter((j) => cat === 'Remote' ? j.remote : cat === 'Nearby' ? isNearby(j.match) : (j.categories || []).includes(cat));
    return { featured: vis[0] || null, rest: vis.slice(1), total: vis.length };
  }
  function search(jobs, profile, q) {
    const terms = norm(q).split(' ').filter(Boolean); if (!terms.length) return [];
    return jobs.filter((j) => !j.userState.dismissed && !j.userState.reported && j.match).filter((j) => { const hay = norm([j.title, j.employer, j.city, j.neighborhood, j.type, (j.categories || []).join(' '), j.summary, j.description].join(' ')); return terms.every((t) => hay.includes(t)); }).sort((a, b) => b.match.overall - a.match.overall);
  }
  function chips(profile) {
    const l = ['For You']; CATEGORIES.forEach((c) => (profile.categories || []).includes(c) && l.push(c));
    if ((profile.workModes || []).includes('remote')) l.push('Remote'); l.push('Nearby'); return l;
  }
  function completion(p) {
    return [
      { id: 'education', label: 'Education', done: (p.education || []).length > 0, review: (p.education || []).filter((e) => e.verified === false).length }, { id: 'experience', label: 'Work Experience', done: (p.experience || []).length > 0 },
      { id: 'skills', label: 'Skills', done: (p.skills || []).length > 0 }, { id: 'certs', label: 'Certifications and Licenses', done: (p.certs || []).length > 0 || !!p.certsNone },
      { id: 'resume', label: 'Résumé', done: !!p.resume }, { id: 'prefs', label: 'Job Preferences', done: (p.categories || []).length > 0 || (p.titles || []).length > 0 },
      { id: 'location', label: 'Location', done: (p.cities || []).length > 0 }, { id: 'salary', label: 'Salary', done: profileFloor(p) !== null }, { id: 'notify', label: 'Notification Preferences', done: true },
    ];
  }

  Object.assign(KJ, { EDU_RANK, EDU_LABEL, CATEGORIES, CLASS_LABEL, CLASS_SHORT, CLASS_BARS, FIELD_WORDS, norm, num, tokens, fmtMoney, annual, profileFloor, profileDesired, salaryText, salaryParts, coordsFor, miles, evaluate, evalLocation, evalSalary, buildFeed, categoryFeed, search, chips, completion, isNearby, cityOnly, stripPlace });
  if (typeof module !== 'undefined') module.exports = KJ;
})(typeof window !== 'undefined' ? window : globalThis);
