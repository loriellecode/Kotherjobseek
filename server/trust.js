'use strict';
/* Job trust assessment. Replaces a verified/unverified switch with five graded statuses and records WHY each was given.
 *   trusted       — an official employer / government / school / university site, or an established recruiting platform, was identified
 *   checked       — the application destination looks consistent with the employer or a legitimate applicant-tracking provider (the job itself is not guaranteed authentic)
 *   closer_look   — the employer or destination could not be independently confirmed; the job stays visible with a proportionate note
 *   high_risk     — significant warning signs; the direct application action (link and apply-by-email) is hidden until a re-check clears it
 *   blocked       — strong evidence of fraud, impersonation, a malicious link, or an upfront-payment request; the listing is quarantined (not shown)
 * Nothing here proves a job is real. Recognised names are only evidence — not a pass — and are never the sole criterion for visibility.
 * Listing text and external pages are untrusted data: they are only pattern-searched, never rendered or executed. */

const STATUSES = ['trusted', 'checked', 'closer_look', 'high_risk', 'blocked'];
const LABELS = { trusted: 'Trusted source', checked: 'Application destination checked', closer_look: 'Needs a closer look', high_risk: 'High risk', blocked: 'Blocked' };
const RANK = { trusted: 0, checked: 1, closer_look: 2, high_risk: 3, blocked: 4 };

const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'tiny.cc', 'rb.gy', 'lnkd.in']);
/* Recognised applicant-tracking systems (slug = where the employer's name usually appears: 'sub' subdomain, 'path' first path segment, 'path2' second). */
const ATS = [
  ['myworkdayjobs.com', 'Workday', 'sub'], ['myworkdaysite.com', 'Workday', 'path2'], ['greenhouse.io', 'Greenhouse', 'path'], ['lever.co', 'Lever', 'path'], ['icims.com', 'iCIMS', 'sub'], ['smartrecruiters.com', 'SmartRecruiters', 'path'],
  ['ashbyhq.com', 'Ashby', 'path'], ['jobvite.com', 'Jobvite', 'path'], ['taleo.net', 'Oracle Taleo', 'sub'], ['oraclecloud.com', 'Oracle Recruiting', 'sub'], ['workable.com', 'Workable', 'path'], ['breezy.hr', 'Breezy HR', 'sub'],
  ['bamboohr.com', 'BambooHR', 'sub'], ['applytojob.com', 'JazzHR', 'sub'], ['recruitee.com', 'Recruitee', 'sub'], ['teamtailor.com', 'Teamtailor', 'sub'], ['paylocity.com', 'Paylocity', 'path'], ['paycomonline.net', 'Paycom', 'path'],
  ['ultipro.com', 'UKG', 'sub'], ['dayforcehcm.com', 'Dayforce', 'path'], ['csod.com', 'Cornerstone', 'sub'], ['brassring.com', 'BrassRing', 'sub'], ['successfactors.com', 'SAP SuccessFactors', 'sub'], ['adp.com', 'ADP', 'sub'], ['paycor.com', 'Paycor', 'sub'],
  ['governmentjobs.com', 'NEOGOV (public-sector hiring)', 'path2'], ['edjoin.org', 'EdJoin (California school hiring)', 'none'], ['applitrack.com', 'AppliTrack (school hiring)', 'path'], ['schoolspring.com', 'SchoolSpring (school hiring)', 'none'],
];
const BOARDS = ['indeed.com', 'linkedin.com', 'glassdoor.com', 'ziprecruiter.com', 'monster.com', 'careerbuilder.com', 'simplyhired.com', 'snagajob.com', 'adzuna.com', 'jooble.org', 'talent.com', 'flexjobs.com', 'idealist.org', 'usajobs.gov', 'calcareers.ca.gov', 'handshake.com', 'joinhandshake.com'];
const onDomain = (host, d) => host === d || host.endsWith('.' + d);
const GENERIC = new Set(['the', 'and', 'inc', 'llc', 'ltd', 'corp', 'co', 'company', 'group', 'services', 'service', 'county', 'city', 'district', 'unified', 'school', 'schools', 'university', 'college', 'office', 'department', 'health', 'center', 'test', 'of', 'for', 'new', 'jobs', 'careers', 'employment', 'staffing', 'solutions', 'systems', 'partners', 'consulting', 'associates', 'international', 'global', 'recruiting', 'recruiters', 'resources', 'human', 'management', 'enterprises', 'industries', 'american', 'national', 'california', 'valley']);
const compact = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const sigWords = (name) => String(name || '').toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC.has(w));

/* ---------- URL validation / normalisation ---------- */
function parseUrl(raw) {
  const s = String(raw || '').trim().slice(0, 2000);
  if (!s) return { error: 'empty' };
  if (/^\s*(javascript|data|vbscript|file|blob|ftp):/i.test(s)) return { error: 'scheme', scheme: s.split(':')[0].toLowerCase() };
  let u; try { u = new URL(s); } catch (_) { return { error: 'invalid' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'scheme', scheme: u.protocol.replace(':', '') };
  u.hash = '';
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  return { url: u, host, https: u.protocol === 'https:', creds: !!(u.username || u.password), href: u.href };
}

/* ---------- listing-text signals (untrusted text; pattern search only) ---------- */
const PAYMENT = [
  [/\b(?:pay|send|wire|deposit|transfer|purchase|buy)\b[^.\n]{0,60}\b(?:application|registration|training|processing|onboarding|starter|equipment|software|uniform|background[- ]check|security)\s+(?:fee|deposit|kit|package|costs?)\b/i, 'asks you to pay a fee as part of getting the job'],
  [/\b(?:you (?:will|must|need to) (?:pay|purchase|buy)|required to (?:pay|purchase|buy)|(?:upfront|up-front|advance) (?:payment|fee|deposit))\b/i, 'asks for payment up front'],
  [/\b(?:gift ?cards?|western union|moneygram|money order|cashier'?s check|wire transfer|bitcoin|crypto(?:currency)?|zelle|cash ?app)\b/i, 'mentions an unusual payment method (gift cards, wire, crypto or similar)'],
  [/\b(?:deposit|cash)\b[^.\n]{0,40}\b(?:check|cheque)\b[^.\n]{0,60}\b(?:send|keep|buy|purchase|forward)\b/i, 'describes depositing a check and sending money onward'],
];
const SENSITIVE = [
  [/\b(?:send|provide|submit|enter|email|give|upload|text)\b[^.\n]{0,50}\b(?:social security|ssn|ss#|bank account|routing number|account number|credit card|debit card|driver'?s licen[cs]e number|passport (?:number|copy)|copy of (?:your )?(?:id|driver|passport))\b/i, 'asks for Social Security, bank-account or ID details as part of applying'],
  [/\b(?:social security|ssn)\b[^.\n]{0,30}\b(?:to apply|with (?:your )?application|before (?:the )?interview|upfront)\b/i, 'asks for a Social Security number before any offer'],
];
const MESSAGING = [[/\b(?:contact|message|text|interview)\b[^.\n]{0,50}\b(?:telegram|whatsapp|signal|google hangouts|skype)\b/i, 'moves the conversation to a private messaging app']];
const HYPE = [[/\bno experience (?:needed|necessary|required)\b[^.\n]{0,160}\$\s?\d{3,}\s*(?:\/|per|a)\s*(?:day|hour|hr)\b/i, 'promises high pay with no experience'], [/\bguaranteed (?:income|pay|salary|earnings|job)\b/i, 'promises guaranteed income']];

function listingSignals(l) {
  const text = [l.title, l.description, l.summary].filter(Boolean).join('\n').slice(0, 20000), bad = [], warn = [];
  for (const [re, msg] of PAYMENT) if (re.test(text)) { bad.push({ code: 'payment_request', text: `The listing ${msg}. Real employers don’t charge you to be hired.` }); break; }
  for (const [re, msg] of SENSITIVE) if (re.test(text)) { bad.push({ code: 'premature_sensitive_data', text: `The listing ${msg}. That is unusual this early in a hiring process.` }); break; }
  for (const [re, msg] of MESSAGING) if (re.test(text)) { warn.push({ code: 'private_messaging', text: `The listing ${msg}.` }); break; }
  for (const [re, msg] of HYPE) if (re.test(text)) { warn.push({ code: 'implausible_promise', text: `The listing ${msg}.` }); break; }
  const lo = Number(l.salaryMin), hi = Number(l.salaryMax);
  if (lo > 0 && hi > 0 && hi / lo > 6) warn.push({ code: 'pay_inconsistent', text: `The advertised pay range is unusually wide ($${lo.toLocaleString()}–$${hi.toLocaleString()}).` });
  if (/^\s*(confidential|private (?:employer|company)|anonymous|n\/a|unknown|various)\s*$/i.test(String(l.employer || ''))) warn.push({ code: 'employer_hidden', text: 'The employer’s name is not given.' });
  if (!String(l.employer || '').trim()) warn.push({ code: 'employer_hidden', text: 'The employer’s name is not given.' });
  const exp = l.deadline && Date.parse(l.deadline) < Date.now();
  return { bad, warn, expired: !!exp };
}

/* ---------- destination assessment ---------- */
function atsMatch(host, u) {
  for (const [d, name, slug] of ATS) {
    if (!onDomain(host, d)) continue;
    const segs = u.pathname.split('/').filter(Boolean);
    const sub = host.slice(0, -(d.length + 1)).split('.').filter((x) => x && !/^(www|jobs|boards|job-boards|careers|apply|careers-?\d*|wd\d+|hcm\d*|ew\d*|[a-z]{2}\d+)$/i.test(x));
    const label = slug === 'sub' ? sub[0] : slug === 'path' ? segs[0] : slug === 'path2' ? (host.startsWith('www') || segs.length > 1 ? segs[1] || segs[0] : segs[0]) : '';
    return { domain: d, name, slug: label || '' };
  }
  return null;
}
function employerMatches(employer, hostLabelsText) {
  const words = sigWords(employer); if (!words.length) return { match: false, why: '' };
  const hay = compact(hostLabelsText);
  const hit = words.find((w) => hay.includes(w));
  if (hit) return { match: true, why: hit };
  const ini = words.map((w) => w[0]).join(''); // acronym, e.g. "Valley Credit Union" ~ vcu
  const allWords = String(employer || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((w) => w[0]).join('');
  for (const a of [ini, allWords]) if (a.length >= 3 && hay.includes(a)) return { match: true, why: a };
  return { match: false, why: '' };
}
function lookalike(host) {
  const parts = host.split(/[.\-]/);
  const brands = [...ATS.map((a) => [a[0], a[1]]), ...BOARDS.map((d) => [d, d])];
  for (const [d] of brands) {
    const brand = d.split('.')[0]; if (brand.length < 5 || onDomain(host, d)) continue;
    if (parts.includes(brand) || host.includes(d)) return d;
  }
  return null;
}

/* assess(listing, ctx) → { status, label, reasons:[{kind,text}], evidence:[...], host, url, checkedAt, expired, checks:{automated:[...], notDone:[...]} }
 * listing: { provider, applyUrl, employer, title, description, summary, salaryMin, salaryMax, deadline, emailApply }
 * ctx: { feedHost, otherSources:[{provider,host,url}] (other listings of the same job), page:{status, finalUrl, text, error} (from a re-check), now } */
function assess(listing, ctx) {
  ctx = ctx || {}; const reasons = [], evidence = [], done = ['URL format and scheme', 'Address type (no IP/local host, credentials or shorteners)', 'Look-alike and impersonation patterns', 'Listing text patterns (fees, sensitive data, pay promises)'];
  const notDone = ['Independent confirmation that the employer exists (no business-registry lookup configured)', 'Reputation-service check (e.g. Google Safe Browsing — not configured)', 'Whether the employer’s own website lists this job (not fetched automatically)'];
  const add = (kind, text) => reasons.push({ kind, text }), ev = (t) => evidence.push(t);
  const sig = listingSignals(listing);
  const base = (status, extra) => Object.assign({ status, label: LABELS[status], reasons, evidence, host: '', url: null, checkedAt: ctx.now || Date.now(), expired: sig.expired, checks: { automated: done, notDone } }, extra || {});
  let status = 'closer_look', host = '', url = null;
  const hasEmail = !!(listing.emailApply && listing.emailApply.address);

  // 1. The destination
  const p = listing.applyUrl ? parseUrl(listing.applyUrl) : null;
  if (p && p.error) {
    add('bad', p.error === 'scheme' ? `The link uses “${p.scheme}:”, which isn’t a web address. It was removed.` : 'The link is not a valid web address and was removed.');
    status = 'blocked';
  } else if (p) {
    host = p.host; url = p.href;
    if (p.creds) { add('bad', 'The link contains embedded login details — a common way to disguise where a link goes. It was removed.'); status = 'blocked'; url = null; }
    else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host === 'localhost' || /\.(local|internal|localhost|lan)$/.test(host) || !host.includes('.')) { add('bad', 'The link points to a raw IP address or a local/internal host rather than a public website.'); status = 'high_risk'; }
    else if (SHORTENERS.has(host)) { add('bad', 'The link is a URL shortener, which hides the real destination. Look for the job on the employer’s own site.'); status = 'high_risk'; }
    else if (host.split('.').some((l) => l.startsWith('xn--'))) { add('bad', 'The address uses international look-alike characters, which can imitate a real site.'); status = 'high_risk'; }
    else {
      const imp = lookalike(host);
      if (imp) { add('bad', `The address imitates “${imp}” but isn’t on that site.`); status = 'high_risk'; }
      else {
        const govEdu = /\.(gov|edu|mil)$/.test(host) || /\.k12\.[a-z]{2}\.us$/.test(host) || /\.(ca|co)\.gov$/.test(host) || /\.ca\.us$/.test(host);
        const ats = atsMatch(host, p.url), board = BOARDS.find((d) => onDomain(host, d)), feedOwn = ctx.feedHost && onDomain(host, String(ctx.feedHost).replace(/^www\./, ''));
        const hostText = host.split('.').slice(0, -1).join(' ') + ' ' + p.url.pathname.split('/').slice(1, 3).join(' ');
        const emp = employerMatches(listing.employer, hostText);
        const support = (ctx.otherSources || []).find((o) => o.host && o.host !== host);
        if (govEdu) { status = 'trusted'; add('good', 'Government or education website identified.'); ev(`${host} is a government/education domain.`); }
        else if (feedOwn) { status = 'trusted'; add('good', 'Official employer site identified.'); ev(`This job came from the employer’s own careers page at ${ctx.feedHost}.`); }
        else if (board) { status = 'trusted'; add('good', `Established job platform identified (${board}).`); add('info', 'The platform is recognised, but the employer’s identity is not independently confirmed.'); ev(`${host} belongs to ${board}.`); }
        else if (ats) {
          status = 'checked'; add('good', 'Application platform appears consistent.'); ev(`${host} is ${ats.name}, a recognised applicant-tracking system.`);
          const slugEmp = ats.slug ? employerMatches(listing.employer, ats.slug) : { match: false };
          if (slugEmp.match) { add('good', `The platform account name (“${ats.slug}”) matches the employer.`); ev(`Account “${ats.slug}” matches “${listing.employer}”.`); }
          else if (support) { add('good', `Another source lists this job at ${support.host}.`); ev(`Also found via ${support.provider}: ${support.host}.`); }
          else { add('info', 'Employer connection not confirmed — the platform account name doesn’t clearly match the employer. Many employers use a different name on these platforms.'); }
        }
        else if (emp.match) { status = 'checked'; add('good', 'The website address is consistent with the employer name.'); ev(`“${emp.why}” appears in ${host} and the employer name.`); }
        else if (support && (support.trust === 'trusted' || support.trust === 'checked')) { status = 'checked'; add('good', `Another source lists this job on ${support.host}.`); ev(`Also listed via ${support.provider}.`); }
        else { status = 'closer_look'; add('info', 'Employer connection not confirmed.'); }
        if (!p.https) { add('warn', 'This site doesn’t use an encrypted (https) connection. Don’t enter personal information on it.'); if (RANK[status] < RANK.closer_look) status = 'closer_look'; }
        else ev('Uses an encrypted (https) connection — this alone doesn’t show the site is legitimate.');
      }
    }
  } else if (hasEmail) {
    add('info', 'This listing applies by email rather than a web link.'); status = 'closer_look';
    if (listing.emailApply.freeMail) add('warn', 'The email address is a free consumer email (such as Gmail). Small businesses do use these, but confirm the employer first.');
  } else { add('info', 'The listing has no application link.'); status = 'closer_look'; }

  // 2. Listing-level signals
  for (const b of sig.bad) {
    add('bad', b.text);
    if (b.code === 'payment_request') status = 'blocked';
    else if (RANK[status] < RANK.high_risk) status = 'high_risk';
  }
  for (const w of sig.warn) { add('warn', w.text); if (status === 'checked' && sig.warn.length >= 2) status = 'closer_look'; }
  if (sig.expired) add('warn', 'The listing’s closing date has passed.');
  if (listing.freeMailContact && status !== 'blocked') add('warn', 'The contact address is a free consumer email.');

  // 3. Re-check results (only present after a network check)
  const pg = ctx.page;
  if (pg) {
    done.push('Live page check (redirects followed safely; page text searched only)');
    const idx = notDone.findIndex((x) => /own website lists/.test(x));
    if (!pg.ok) add('info', `The application page couldn’t be checked automatically (${pg.error || 'no response'}). That doesn’t mean there is a problem.`);
    else {
      if (pg.finalUrl && pg.hops && pg.hops.length > 1) { const fp = parseUrl(pg.finalUrl); if (fp.host) { ev(`The link redirects to ${fp.host}.`); if (fp.host !== host) { const again = quick(fp.host, fp.url, listing); if (again.bad) { add('bad', again.bad); status = RANK[status] < RANK.high_risk ? 'high_risk' : status; } else if (again.good) add('good', again.good); } } }
      if (pg.status === 404 || pg.status === 410) { add('warn', 'The application page returned “not found”. The listing may have expired.'); sig.expired = true; }
      else if (pg.status >= 200 && pg.status < 300) ev(`The application page responded (HTTP ${pg.status}).`);
      const t = String(pg.text || '').slice(0, 200000);
      if (/\b(?:no longer accepting|position (?:has been|is) filled|(?:job|posting|position) (?:is )?(?:closed|expired)|this job has expired)\b/i.test(t)) { add('warn', 'The page says this position is closed or expired.'); sig.expired = true; }
      const ps = listingSignals({ description: t.replace(/<[^>]+>/g, ' ') });
      for (const b of ps.bad) { add('bad', `On the page: ${b.text}`); status = b.code === 'payment_request' ? 'blocked' : (RANK[status] < RANK.high_risk ? 'high_risk' : status); }
      if (idx >= 0 && pg.ok) notDone[idx] = 'Whether the employer’s own website lists this job (only the application page itself was checked)';
    }
  }
  const out = base(status, { host, url });
  out.expired = sig.expired;
  return out;
}
/* Light check of a redirect target host. */
function quick(host, u, listing) {
  if (SHORTENERS.has(host) || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return { bad: `The link redirects to ${host}, which is not a normal employer website.` };
  const imp = lookalike(host); if (imp) return { bad: `The link redirects to ${host}, which imitates ${imp}.` };
  const ats = atsMatch(host, u); if (ats) return { good: `The link forwards to ${ats.name}, a recognised applicant-tracking platform.` };
  if (/\.(gov|edu)$/.test(host)) return { good: `The link forwards to a government/education site (${host}).` };
  if (employerMatches(listing.employer, host.split('.').slice(0, -1).join(' ')).match) return { good: `The link forwards to ${host}, consistent with the employer name.` };
  return {};
}
const visibleApply = (status) => status !== 'high_risk' && status !== 'blocked';
const isHidden = (status) => status === 'blocked';
module.exports = { assess, parseUrl, listingSignals, STATUSES, LABELS, RANK, visibleApply, isHidden, atsMatch, employerMatches, lookalike };
