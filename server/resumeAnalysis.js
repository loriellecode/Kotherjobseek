'use strict';
/* Résumé analysis: turn extracted text into REVIEWABLE proposals. Nothing here touches the profile.
 *  origin 'stated'   — appears in the résumé text itself (a degree line, a job entry, a listed skill/tool, a credential).
 *  origin 'inferred' — a competency suggested by described responsibilities. Always labelled as a suggestion needing confirmation,
 *                      and always carries the sentence(s) it was inferred from. */
const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec';
const RANGE = new RegExp(`((?:(?:${MONTHS})[a-z]*\\.?\\s*|\\d{1,2}\\/)?(?:19|20)\\d{2})\\s*(?:-|–|—|to)\\s*(present|current|now|(?:(?:${MONTHS})[a-z]*\\.?\\s*|\\d{1,2}\\/)?(?:19|20)\\d{2})`, 'i');
const SECTION = [
  ['education', /^(education|academic (background|history)|education and training|degrees?)$/i], ['experience', /^((professional|relevant|related|work|employment|career) )?(experience|history)( summary)?$|^employment$|^work experience$/i],
  ['skills', /^((technical|core|key|professional|relevant) )?(skills|competencies|proficiencies)( (and|&) (tools|software|technologies))?$|^(tools|software|technical proficiencies)$/i], ['certs', /^(certifications?|licenses?|credentials|certifications? (and|&) licenses?|licenses? (and|&) certifications?|professional (licenses|certifications|credentials))$/i],
  ['summary', /^(professional )?(summary|profile|objective|career objective|career summary|summary of qualifications)$/i], ['other', /^(awards?|honors?|projects?|references?|volunteer( experience)?|publications?|affiliations?|interests?|activities|languages?)$/i],
];
const TOOLS = ['Excel', 'Microsoft Word', 'PowerPoint', 'Outlook', 'Microsoft Office', 'Google Workspace', 'Google Sheets', 'QuickBooks', 'SAP', 'Oracle', 'NetSuite', 'Workday', 'PeopleSoft', 'Munis', 'Salesforce', 'SQL', 'Tableau', 'Power BI', 'Access', 'Blackbaud', 'Sage', 'Bloomberg', 'SEIS', 'Aeries', 'PowerSchool', 'Infinite Campus', 'Canvas', 'Google Classroom', 'Smartsheet', 'Asana', 'Visio', 'Adobe Acrobat', 'Zoom'];
const DEG = [['doctorate', /\b(ph\.?\s?d\.?|doctor(?:ate)? of [a-z ]+|ed\.?\s?d\.?)\b/i], ['master', /\b(master(?:'s|’s)?(?: degree)?(?: of| in)?|m\.?b\.?a\.?|m\.?s\.?(?= |,|$)|m\.?a\.?(?= |,|$)|m\.?ed\.?)/i], ['bachelor', /\b(bachelor(?:'s|’s)?(?: degree)?(?: of| in)?|b\.?s\.?(?= |,|$)|b\.?a\.?(?= |,|$)|b\.?b\.?a\.?)/i], ['associate', /\b(associate(?:'s|’s)?(?: degree)?(?: of| in)?|a\.?a\.?(?= |,|$)|a\.?s\.?(?= |,|$))/i]];
const CERT_RE = /\b(credential|license|licence|certification|certificate|certified|CPA|CBEST|CSET|BCBA|PMP|CFA|notary)\b/i;
const SCHOOL_RE = /\b(university|college|institute|academy|school of|polytechnic)\b/i;

/* competency inference: [id, label, family, regex over a responsibility sentence] */
const COMPETENCIES = [
  ['budgeting', 'Budgeting and forecasting', 'finance', /\b(budget(s|ing|ed)?|forecast(s|ing)?|variance|appropriation|expenditure|cost control|fiscal)\b/i],
  ['finreport', 'Financial reporting and analysis', 'finance', /\b(financial (analysis|reports?|reporting|statements?|models?|modeling)|reconcil\w+|general ledger|month[- ]end|audit\w*|journal entr\w+|profit and loss|p&l)\b/i],
  ['apar', 'Accounts payable / receivable', 'finance', /\b(accounts? (payable|receivable)|\bA\/?P\b|\bA\/?R\b|invoic\w+|billing|collections?)\b/i],
  ['banking', 'Banking and lending', 'banking', /\b(bank(ing|er)?|teller|loan(s)?|lending|mortgage|credit union|underwrit\w+|deposit(s)?|western union)\b/i],
  ['payroll', 'Payroll', 'finance', /\b(payroll|timesheets?|wages)\b/i],
  ['supervision', 'Staff supervision and team leadership', 'management', /\b(supervis\w+|manag(ed|ing) (a )?(team|staff|employees|department|\d+)|led (a )?(team|staff|\d+)|lead(ing)? (a )?(team|staff)|lead and participate|direct(ed|ing) (a )?(team|staff)|oversaw|oversee(ing)?|assign (employee )?duties|work guidance to assigned|review work for compliance|evaluat\w+ (staff|employees)|mentor\w*)\b/i],
  ['admin', 'Office and administrative management', 'administration', /\b(office (manag\w+|administr\w+)|administrative (support|assistant|duties)|administrat(ive|ion|or)|schedul(e|ing)|calendar|records? (management|keeping)|front office|clerical|meeting minutes|file systems?|answer(ing)? (the )?phones?)\b/i],
  ['operations', 'Business operations', 'business', /\b(operations?|process improvement|workflow|logistics|procurement|purchasing|vendor(s)?|inventory|policies and procedures|compliance|comply with)\b/i],
  ['projects', 'Project and program coordination', 'business', /\b(project(s)? (manag\w+|coordinat\w+|plan\w+)|program (coordinat\w+|manag\w+|develop\w+|activities|expectations)|coordinat(ed|ing) (programs?|projects?|events?|applicant|client)|implementing (youth services )?(projects|operations)|timeline(s)?)\b/i],
  ['training', 'Training and staff development', 'education', /\b(train(ed|ing|er)s?|professional development|onboard\w*|workshop(s)?|curricul\w+|instruction(al)? (design|coach)\w*|staff development|lesson planning|soft skills)\b/i],
  ['teaching', 'Teaching and instruction', 'education', /\b(taught|teach(ing)?|lesson plans?|classroom|instruct(ed|ing|ion)|designed and taught|delivers? work ?ability)\b/i],
  ['speced', 'Special education support (IEPs, transition services)', 'special education', /\b(special education|IEPs?|individualized education|resource specialist|inclusion|students? with (disabilit\w+|special needs)|individuals? with (disabilit\w+|special needs)|special needs|autism|behavior (plan|support|intervention)s?|transition (services|to competitive)|work ?ability)\b/i],
  ['casemgmt', 'Case management', 'workforce', /\b(case[- ]manage\w*|caseload|intake|individual(ized)? (employment|employability|service|education|program) (plans?|strateg\w+)|eligibility|barrier(s)? (reduction|to employment)|participant (files|records)|referr?(ed|al)s?)\b/i],
  ['jobdev', 'Job development and employer outreach', 'workforce', /\b(job develop\w*|employer(s)? (outreach|partnerships?|relationships?)|relationships? with (a variety of )?(local area )?employers|placement|job coaching|internships?|work[- ]based|work ?sites?|developing (job|employment)|job opportunities|supported employment)\b/i],
  ['careerguid', 'Career counseling and vocational assessment', 'workforce', /\b(career (guidance|counsel\w+|plans?|services)|vocational (assessment|rehabilitation|guidance|training)|WIOA|assessment instruments?|job readiness|academic counseling|employability|interview(ing)? skills|resume (assistance|writing))\b/i],
  ['grants', 'Grant writing and funding compliance', 'business', /\b(grant (proposals?|specifications?|requirements?|writing|compliance)|funding proposals?|fundrais\w+|donors?|sponsors?)\b/i],
  ['recruiting', 'Recruiting and candidate screening', 'administration', /\b(recruit\w+|candidate sourcing|sourcing|screen(ing|s|ed)? (potential |applicants|participants|candidates)|hiring)\b/i],
  ['customer', 'Customer and client service', 'business', /\b(customer service|client(s)? (relations|service)|member service|front desk|help ?desk|customer relationships?)\b/i],
  ['data', 'Data entry, records and reporting', 'business', /\b(data analy\w+|data entry|database|dashboards?|metrics|kpi(s)?|statistical|spreadsheets?|reports? (and|on)|service tracking reports|documentation)\b/i],
  ['hr', 'Human resources support', 'administration', /\b(human resources|benefits administration|employee relations|hr department)\b/i],
];
const INDUSTRIES = [
  ['Public education (K–12 / higher education)', /\b(school district|unified school|usd|elementary|middle school|high school|college|university|academy|charter school|county office of education)\b/i], ['Banking / credit unions', /\b(bank|credit union|savings|financial institution|mortgage)\b/i],
  ['Local / state government', /\b(county of|city of|state of|county office|department of|municipal|public works)\b/i], ['Healthcare', /\b(hospital|clinic|health|medical|healthcare)\b/i], ['Nonprofit / social services', /\b(foundation|nonprofit|non-profit|community services|regional center|united way)\b/i],
];

/* Some résumé templates repeat a heading several times in the extracted text ("JOB DEVELOPERJOB DEVELOPER..."): collapse it. */
function dedupeRepeat(l) {
  const n = l.length; if (n < 8) return l;
  for (let p = 4; p <= n / 2; p++) if (n % p === 0 && l === l.slice(0, p).repeat(n / p)) return l.slice(0, p);
  return l;
}
const clean = (s) => dedupeRepeat(String(s || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim());
const bullet = (s) => clean(s).replace(/^[•●▪■◦*·\-–—]+\s*/, '');
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

function sections(lines) {
  const out = []; let cur = { name: 'header', lines: [] };
  for (const raw of lines) {
    const l = clean(raw), t = l.replace(/[:：]\s*$/, '');
    const hit = t.length <= 50 && SECTION.find(([, re]) => re.test(t));
    if (hit) { out.push(cur); cur = { name: hit[0], lines: [] }; continue; }
    const inline = l.match(/^([A-Za-z &]{3,40})\s*[:：]\s*(.+)$/); // "Skills: Excel, Budgeting" starts a section on the same line
    const ih = inline && SECTION.find(([, re]) => re.test(inline[1].trim()));
    if (ih) { out.push(cur); cur = { name: ih[0], lines: [inline[2]] }; continue; }
    cur.lines.push(l);
  }
  out.push(cur); return out;
}
function parseDate(s, isEnd) {
  if (/present|current|now/i.test(s)) return { y: new Date().getFullYear(), m: new Date().getMonth() + 1, present: true };
  const y = Number((s.match(/(19|20)\d{2}/) || [])[0]), mm = (s.match(new RegExp(`(${MONTHS})`, 'i')) || [])[1], nm = (s.match(/^\s*(\d{1,2})\//) || [])[1];
  const m = nm ? Number(nm) : mm ? 1 + MONTHS.split('|').findIndex((x) => x.startsWith(mm.toLowerCase().slice(0, 3))) : (isEnd ? 12 : 1);
  return { y, m: Math.max(1, Math.min(12, m)) };
}
const yearsBetween = (a, b) => Math.max(0, Math.round((((b.y - a.y) * 12 + (b.m - a.m) + 1) / 12) * 2) / 2);

function parseExperience(lines) {
  const entries = []; let cur = null, prev = [];
  const flush = () => { if (cur) entries.push(cur); cur = null; };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]; if (!l) continue; const m = l.match(RANGE);
    if (m && l.length < 160) {
      flush();
      let head = clean(l.replace(RANGE, '').replace(/[()|,–—-]+\s*$/g, '').replace(/^\s*[|,–—-]+/, ''));
      if (!head) { // "date first, title on the next line" layout
        let k = i + 1; while (k < lines.length && !lines[k]) k++;
        if (k < lines.length && !/^[•●▪■◦*·\-–—]/.test(lines[k]) && lines[k].length < 100 && !RANGE.test(lines[k])) { head = lines[k]; i = k; }
      }
      let parts = head.split(/\s*\|\s*|\s+[–—-]\s+|\s+@\s+|\s+at\s+|,\s+/).map(clean).filter(Boolean);
      if (parts.length < 2) { const before = prev.filter((x) => !/^[•●▪■◦*·\-–—]/.test(x)).slice(-2); parts = [...before, ...parts].filter(Boolean); if (parts.length > 2) parts = parts.slice(-2); }
      const a = parseDate(m[1], false), b = parseDate(m[2], true);
      cur = { title: parts[0] || '', employer: parts[1] || '', start: `${a.y}${/[a-z]|^\s*\d{1,2}\//i.test(m[1]) ? '-' + String(a.m).padStart(2, '0') : ''}`, end: b.present ? '' : `${b.y}${/[a-z]|^\s*\d{1,2}\//i.test(m[2]) ? '-' + String(b.m).padStart(2, '0') : ''}`, years: yearsBetween(a, b), bullets: [], raw: l };
      prev = []; continue;
    }
    if (cur) { if (/^[•●▪■◦*·\-–—]/.test(l) || l.length > 40) cur.bullets.push(bullet(l)); else if (!cur.employer && l.length < 80) cur.employer = l; else cur.bullets.push(bullet(l)); }
    else prev.push(l);
  }
  flush(); return entries.filter((e) => e.title);
}
function parseEducation(lines, all) {
  const out = [];
  lines.forEach((line, i) => {
    if (line.length > 180) return;
    for (const [level, re] of DEG) {
      if (!re.test(line) || !/\b(of|in|degree|b\.?[sab]\.?|m\.?[sabd]\.?|mba|ph|ed\.?d|associate|bachelor|master|doctor)/i.test(line)) continue;
      const ins = [...line.matchAll(/\bin\s+([A-Z][A-Za-z&' ]{2,50}?)(?=\s*(?:[,|(–—]|\s-\s|$))/g)], inM = ins.length ? ins[ins.length - 1] : line.match(/\b(?:Bachelor|Master|Associate|Doctor)(?:'s|’s)?(?: Degree)? of\s+(?!Science\b|Arts\b|Fine Arts\b|Applied Science\b|Education\b)([A-Z][A-Za-z&' ]{2,50}?)(?=\s*(?:[,|(–—]|\s-\s|$))/), field = inM ? inM[1].trim() : ((line.match(/\b(?:Science|Arts)\s*[,:]\s*(?:in\s+)?([A-Z][A-Za-z&' ]{2,50}?)(?=\s*(?:[,|(–—]|\s-\s|$))/) || [])[1] || '');
      const seg = line.split(/[,|–—]|\s-\s/).map(clean).find((x) => SCHOOL_RE.test(x)) || ([lines[i + 1], lines[i - 1]].find((l2) => l2 && SCHOOL_RE.test(l2) && l2.length < 100 && !DEG.some(([, r2]) => r2.test(l2))) || '');
      const yr = (line.match(/\b(19|20)\d{2}\b/) || [])[0];
      const title = (line.match(/\b((?:Bachelor|Master|Associate|Doctor)(?:'s|’s)?(?: Degree)? (?:of|in) [A-Z][A-Za-z&' ]{2,60}?(?: in [A-Z][A-Za-z&' ]{2,40})?)(?=\s*(?:[,|(–—]|\s-\s|$))/) || [])[1] || '';
      out.push({ level, field, title, school: clean(seg).replace(/\s+[|–—-]\s+.*$/, ''), year: yr ? Number(yr) : null, status: /\b(expected|in progress|candidate|currently|pursuing)\b/i.test(line) ? 'in progress' : 'completed', line });
      break;
    }
  });
  return out;
}
const sentences = (text) => String(text).split(/(?<=[.!?])\s+|\n+/).map(bullet).filter((s) => s.length > 8);

function analyze(text) {
  const lines = String(text || '').split(/\r?\n/).map(clean).filter(Boolean), secs = sections(lines);
  const get = (n) => secs.filter((s) => s.name === n).flatMap((s) => s.lines);
  const proposals = [], seen = new Set();
  const push = (kind, data, origin, evidence, group) => { const k = kind + '|' + (kind === 'skill' ? norm(data.name) : norm(JSON.stringify(data))); if (seen.has(k)) return; seen.add(k); proposals.push({ kind, data, origin, evidence: (evidence || []).slice(0, 3), group: group || kind }); };

  // education (dedicated section first, then anywhere)
  const eduLines = get('education').length ? get('education') : lines;
  for (const e of parseEducation(eduLines, lines)) push('education', { level: e.level, field: e.field, title: e.title, school: e.school, status: e.status, year: e.year, flag: e.level && !e.field ? 'Field of study was not clear in the résumé line.' : '' }, 'stated', [e.line], 'education');

  // experience
  const expSection = get('experience'); let entries = parseExperience(expSection); if (!entries.length) entries = parseExperience(lines); // some templates scatter entry headers outside the experience section
  const tagsByEntry = [];
  for (const e of entries) {
    const text = e.bullets.join('. '), tags = new Set(), ev = {};
    for (const [id, label, fam, re] of COMPETENCIES) { const hits = sentences(text).filter((s) => re.test(s)); if (hits.length) { tags.add(id); ev[id] = hits.slice(0, 2); } }
    tagsByEntry.push({ e, tags, ev });
    push('experience', { title: e.title, employer: e.employer, field: '', years: e.years || null, start: e.start, end: e.end, responsibilities: e.bullets.slice(0, 8), tags: [...tags], summary: '', flag: e.employer ? '' : 'Employer name was not clear in the résumé.' }, 'stated', [e.raw], 'experience');
  }

  // credentials
  const credLines = [...get('certs'), ...lines.filter((l) => CERT_RE.test(l) && l.length < 110 && !/\b(responsib|manag|develop|prepar|assist)/i.test(l))];
  for (const l of credLines) { const name = bullet(l).replace(/\s+(passed|earned|obtained|issued|completed)?\s*(in\s*)?(19|20)\d{2}.*$/i, '').replace(/\s*[|–—-]\s*(\d{4}.*)?$/, '').trim(); if (name.length > 2 && name.length < 90 && !DEG.some(([, re]) => re.test(name) && /degree|bachelor|master/i.test(name))) push('cert', { name, issuer: '', status: /\b(in progress|pursuing|candidate|expected)\b/i.test(l) ? 'in progress' : 'held', flag: 'Read from your résumé — confirm that you hold this credential and that it is current.' }, 'stated', [l], 'cert'); }

  // skills explicitly stated: skills section + tools mentioned anywhere
  for (const l of get('skills')) for (const s of l.split(/[,;•|·]+/).map(bullet).filter((x) => x.length > 1 && x.length <= 40)) push('skill', { name: s, origin: 'stated', evidence: 'Listed in the skills section of your résumé' }, 'stated', [], 'skills_stated');
  for (const t of TOOLS) if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) { const ln = lines.find((l) => new RegExp(`\\b${t}\\b`, 'i').test(l)); push('skill', { name: t, origin: 'stated', evidence: 'Mentioned in your résumé' }, 'stated', ln ? [ln] : [], 'skills_stated'); }

  // competencies inferred from responsibilities (suggestions only)
  const compEvidence = {};
  for (const { e, ev } of tagsByEntry) for (const [id, sents] of Object.entries(ev)) { (compEvidence[id] = compEvidence[id] || []).push(...sents.map((s) => `${e.title}${e.employer ? ', ' + e.employer : ''}: ${s}`)); }
  const summaryText = get('summary').join(' '); for (const [id, , , re] of COMPETENCIES) { const hits = sentences(summaryText).filter((s) => re.test(s)); if (hits.length) (compEvidence[id] = compEvidence[id] || []).push(...hits.slice(0, 1).map((s) => 'Summary: ' + s)); }
  const supervised = (text.match(/\b(?:supervis\w+|managed|led|directed|oversaw)\s+(?:a\s+)?(?:team\s+of\s+|staff\s+of\s+)?(\d{1,3})\s+(?:staff|employees|people|team members|reports|direct reports)/i) || [])[1];
  for (const [id, label] of COMPETENCIES) if (compEvidence[id]) push('skill', { name: label, origin: 'inferred', evidence: compEvidence[id][0].slice(0, 300) }, 'inferred', compEvidence[id], 'skills_inferred');
  // industries (inferred from employers)
  const empl = entries.map((e) => e.employer).join(' | ') + ' ' + text.slice(0, 3000);
  for (const [label, re] of INDUSTRIES) { const hit = entries.find((e) => re.test(e.employer)); if (hit) push('skill', { name: `${label} experience`, origin: 'inferred', evidence: `Employer: ${hit.employer}` }, 'inferred', [`Employer: ${hit.employer}`], 'industry'); }

  const insights = { management: compEvidence.supervision ? { evidence: compEvidence.supervision.slice(0, 2), staffCount: supervised ? Number(supervised) : null } : null, budgeting: compEvidence.budgeting ? { evidence: compEvidence.budgeting.slice(0, 2) } : null,
    administration: compEvidence.admin || compEvidence.operations ? { evidence: [...(compEvidence.admin || []), ...(compEvidence.operations || [])].slice(0, 2) } : null, teaching: compEvidence.teaching || compEvidence.speced ? { evidence: [...(compEvidence.teaching || []), ...(compEvidence.speced || [])].slice(0, 2) } : null };
  return { proposals, insights, stats: { textLength: text.length, experienceEntries: entries.length, educationLines: proposals.filter((p) => p.kind === 'education').length } };
}
module.exports = { analyze, parseExperience, COMPETENCIES, TOOLS };
