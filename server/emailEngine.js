'use strict';
/* Job Email Assistant — drafting engine.
 *  • detectEmailApply(): finds "email your résumé to …" instructions in a listing. It never invents an address.
 *  • applicantFacts(): ONLY confirmed profile information is used to personalize a draft (unverified education/credentials are excluded).
 *  • Actions: write · grammar · professional · shorter · tailor · followup. A rule-based engine always works offline; an AI service
 *    (server-side key, explicit per-request consent, no contact details sent) can be added with ANTHROPIC_API_KEY.
 *  • Nothing here sends email. The user reviews, copies or opens the draft and sends it herself. */
const E = require('../shared/emailDoc').email;
const KJ = require('../shared/match');
const config = require('./config');
const { COMPETENCIES } = require('./resumeAnalysis');

const LABELS = Object.fromEntries(COMPETENCIES.map(([id, label]) => [id, label.toLowerCase()]));
const { SB, EB } = E;

/* =============== detection =============== */
const EMAIL_FIND = /[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/g;
const APPLY_CUE = /\b(e-?mail|send|submit|forward|apply|application)\b/i, DOC_CUE = /(r[eé]sum[eé]|\bcv\b|cover letter|letter of interest|application|portfolio|references)/i;
const FREE_MAIL = /@(gmail|yahoo|hotmail|outlook|aol|icloud|live|msn|proton(mail)?)\./i;
function detectEmailApply(text) {
  const t = String(text || ''); if (!t) return null;
  const sentences = t.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const emails = [];
  for (const s of sentences) for (const a of s.match(EMAIL_FIND) || []) {
    const addr = a.replace(/[.,;:)]+$/, '').toLowerCase();
    if (/(^|[._-])(no-?reply|do-?not-?reply|donotreply|unsubscribe|abuse|postmaster)@/.test(addr) || /\.(png|jpe?g|gif|svg|webp)$/.test(addr) || !E.emailValid(addr)) continue;
    emails.push({ addr, s, high: APPLY_CUE.test(s) && (DOC_CUE.test(s) || /\bapply\b/i.test(s)) });
  }
  const instr = sentences.find((s) => /\b(e-?mail|send|submit|forward)\b[^.]{0,80}(r[eé]sum[eé]|\bcv\b|cover letter|application|letter of interest)/i.test(s) || /\bapply\b[^.]{0,40}\b(by|via|through)\b[^.]{0,20}e-?mail/i.test(s));
  const best = emails.find((e) => e.high) || null, low = emails[0] || null;
  if (!best && !instr && !low) return null;
  const src = (best && best.s) || instr || (low && low.s) || '';
  const subj = t.match(/subject(?: line)?\s*[:\-]?\s*["“'‘]([^"”'’\n]{3,100})["”'’]/i) || t.match(/(?:put|include|use|type|write)\s+["“'‘]([^"”'’\n]{3,80})["”'’]\s+(?:in|as)\s+(?:the\s+)?subject/i);
  const wantsResume = /(attach\w*|includ\w+|send\w*|submit\w*|forward\w*|provid\w+)[^.]{0,50}(r[eé]sum[eé]|\bcv\b)|r[eé]sum[eé] (?:attached|required)/i.test(t) && /attach|e-?mail|send|submit/i.test(t);
  const wantsCover = /(attach\w*|includ\w+|send\w*|submit\w*)[^.]{0,50}cover letter|cover letter (?:attached|required)/i.test(t);
  return { address: best ? best.addr : null, candidate: !best && low ? low.addr : null, confidence: best ? 'high' : low ? 'low' : 'none', mentionsEmail: !!(best || instr), instructions: src.slice(0, 320), wantsResume, wantsCoverLetter: wantsCover, requiredSubject: subj ? subj[1].trim() : null, freeMail: !!(best && FREE_MAIL.test(best.addr)) };
}

/* =============== confirmed facts =============== */
function applicantFacts(profile, job) {
  const jobText = KJ.norm([job.title, job.description, (job.required || []).join(' ')].join(' ')), has = (s) => KJ.tokens(s).some((w) => jobText.includes(w));
  const name = String(profile.name || '').trim();
  const exps = (profile.experience || []).filter((e) => e.verified !== false).map((e) => {
    const labels = (e.tags || []).map((t) => LABELS[t]).filter(Boolean), score = (has(e.title) ? 3 : 0) + (e.tags || []).filter((t) => has(LABELS[t] || '')).length + (e.responsibilities || []).filter((r) => has(r)).length * 0.5;
    return { title: e.title, employer: e.employer || '', years: e.years || null, labels: labels.slice(0, 2), score };
  }).sort((a, b) => b.score - a.score);
  const skills = (profile.skills || []).map((s) => s.name).filter((s) => s && has(s)).slice(0, 4);
  const edu = (profile.education || []).filter((e) => e.verified !== false && e.level && e.status === 'completed').map((e) => `${KJ.EDU_LABEL[e.level]}${e.field ? ' in ' + e.field : ''}`);
  const certs = (profile.certs || []).filter((c) => c.verified !== false && c.status !== 'in progress').map((c) => c.name);
  const unconfirmed = (profile.education || []).filter((e) => e.verified === false).length + (profile.certs || []).filter((c) => c.verified === false).length + (profile.experience || []).filter((e) => e.verified === false).length;
  return { name, fullName: name.split(/\s+/).length >= 2 ? name : '', experiences: exps.slice(0, 3), skills, education: edu, certs, unconfirmed };
}

/* =============== text transforms (bold preserved through sentinels) =============== */
const PROTECT = /(\[[^\]\n]{2,70}\]|[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|https?:\/\/\S+|\b\d{1,2}[:.]\d{2}\b|\b\d+(?:\.\d+)+\b)/g;
function runsToMarked(runs) { return runs.map((r) => (r.b && r.t.trim() ? SB + r.t + EB : r.t)).join(''); }
function markedToRuns(s) { const out = []; let bold = false, cur = ''; for (const ch of s) { if (ch === SB || ch === EB) { if (cur) out.push({ t: cur, b: bold }); cur = ''; bold = ch === SB; } else cur += ch; } if (cur) out.push({ t: cur, b: bold }); return E.mdToRuns(out); }
function withProtected(s, fn) { const store = []; const t = s.replace(PROTECT, (m) => { store.push(m); return `${store.length - 1}`; }); return fn(t).replace(/(\d+)/g, (_, i) => store[Number(i)]); }
const keepCase = (from, to) => (/^[A-Z]/.test(from) ? to[0].toUpperCase() + to.slice(1) : to);
const MISSPELL = { recieve: 'receive', recieved: 'received', definately: 'definitely', definatly: 'definitely', seperate: 'separate', occured: 'occurred', untill: 'until', experiance: 'experience', experence: 'experience', alot: 'a lot', thier: 'their', wich: 'which', becuase: 'because', becasue: 'because', teh: 'the', adress: 'address', sucessful: 'successful', successfull: 'successful', positon: 'position', oportunity: 'opportunity', opportunty: 'opportunity', oppurtunity: 'opportunity', applicaton: 'application', knowlege: 'knowledge', responsiblities: 'responsibilities', managment: 'management', assitant: 'assistant', enviroment: 'environment', profesional: 'professional', immediatly: 'immediately', sincerly: 'sincerely', sincerley: 'sincerely', wouldnt: "wouldn't", coudl: 'could', shoudl: 'should', tommorow: 'tomorrow', tomorow: 'tomorrow', writting: 'writing', resumee: 'résumé', experienc: 'experience', availible: 'available', avaliable: 'available', qualfications: 'qualifications', qualifcations: 'qualifications', interveiw: 'interview', intreview: 'interview', beleive: 'believe', accomodate: 'accommodate', apreciate: 'appreciate', appriciate: 'appreciate', consideraton: 'consideration', thankyou: 'thank you', employeer: 'employer', calender: 'calendar', refered: 'referred', begining: 'beginning', goverment: 'government', wensday: 'Wednesday', febuary: 'February' };
const CONTRACT = { dont: "don't", doesnt: "doesn't", didnt: "didn't", cant: "can't", wont: "won't", isnt: "isn't", arent: "aren't", wasnt: "wasn't", werent: "weren't", havent: "haven't", hasnt: "hasn't", shouldnt: "shouldn't", couldnt: "couldn't", thats: "that's", theres: "there's", youre: "you're", theyre: "they're", weve: "we've", ive: "I've", im: "I'm", ill: "I'll" };
const SHORTHAND = { u: 'you', ur: 'your', pls: 'please', plz: 'please', thx: 'thanks', ty: 'thank you', tho: 'though', b4: 'before', 'w/': 'with', 'w/o': 'without', ppl: 'people', rn: 'right now', idk: "I don't know", btw: 'by the way' };
const DAYS = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|april|june|july|august|september|october|november|december)\b/g;

function fixText(s, stats) {
  const count = (k) => { stats[k] = (stats[k] || 0) + 1; };
  return withProtected(s, (t) => {
    t = t.replace(/[ \t]{2,}/g, (m) => (count('spacing'), ' ')).replace(/[ \t]+([,.;:!?])/g, (m, p) => (count('punctuation'), p)).replace(/([,;:!?])(?=[A-Za-z])/g, (m, p) => (count('punctuation'), p + ' ')).replace(/(\b[A-Za-z]{2,})\.(?=[A-Z][a-z])/g, (m, w) => (count('punctuation'), w + '. '));
    t = t.replace(/\b([A-Za-z']+)\b/g, (w) => { const lw = w.toLowerCase(); if (MISSPELL[lw] && !(w === w.toUpperCase() && w.length > 1)) { count('spelling'); return keepCase(w, MISSPELL[lw]); } if (CONTRACT[lw] && !(lw === 'ill' || lw === 'ive' && false)) { if (lw === 'ill') return w; count('apostrophes'); return keepCase(w, CONTRACT[lw]).replace(/^i('|’)/, 'I$1'); } if (SHORTHAND[lw] && w === lw) { count('shorthand'); return SHORTHAND[lw]; } return w; });
    t = t.replace(/\bi\b(?!['’.])/g, () => (count('capitalization'), 'I')).replace(/\bi(?=['’](?:m|ve|ll|d)\b)/g, () => (count('capitalization'), 'I'));
    t = t.replace(/\b(\w{2,})(\s+)\1\b/gi, (m, w) => (count('repeated words'), w));
    t = t.replace(DAYS, (m) => (m[0] === m[0].toUpperCase() ? m : (count('capitalization'), m[0].toUpperCase() + m.slice(1))));
    t = t.replace(/(^|[.!?]["')\]]*\s+|\n\s*)([]*)([a-z])/g, (m, a, sent, c) => (count('capitalization'), a + sent + c.toUpperCase()));
    t = t.replace(/!{2,}/g, () => (count('punctuation'), '!')).replace(/\?{2,}/g, () => (count('punctuation'), '?')).replace(/\.{4,}/g, '...');
    return t;
  });
}
const GREETING = /^[]*(dear|hello|hi|hey|good (morning|afternoon|evening)|greetings|to whom)\b/i;
const CLOSINGS = /^[]*(sincerely|best regards|kind regards|regards|respectfully|best|thank you|thanks|yours truly|warm regards|cordially)\b/i;
function ensureTerminal(s) { const t = s.replace(/[]+$/, ''); return /[.!?:)\]"'”]$/.test(t.trim()) || !t.trim() ? s : s.replace(/([]*)$/, '.$1'); }

function processBlocks(blocks, fn) { return blocks.map((b) => (b.type === 'ul' ? { type: 'ul', items: b.items.map((it) => markedToRuns(fn(runsToMarked(it), true))) } : { type: 'p', runs: markedToRuns(fn(runsToMarked(b.runs), false)) })).filter((b) => b.type === 'ul' || b.runs.length); }

function splitLong(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.type !== 'p') { out.push(b); continue; }
    const text = E.runsText(b.runs), words = text.split(/\s+/).length;
    if (words <= 85 || /\n/.test(text)) { out.push(b); continue; }
    const marked = runsToMarked(b.runs), sents = marked.match(/[^.!?]+[.!?]+(?:["')\]]*)\s*|[^.!?]+$/g) || [marked];
    if (sents.length < 3) { out.push(b); continue; }
    const half = Math.ceil(sents.length / 2); out.push({ type: 'p', runs: markedToRuns(sents.slice(0, half).join('').trim()) }, { type: 'p', runs: markedToRuns(sents.slice(half).join('').trim()) });
  }
  return out;
}
const SIGNOFF = /^[\uE000\uE001]*(sincerely|best regards|kind regards|warm regards|regards|respectfully|best|yours truly|cordially|with appreciation)\b/i;
const THANKS_ONLY = /^[\uE000\uE001]*(thanks|thank you|thx|many thanks)[\uE000\uE001]*[.!,\s]*$/i;
/* An informal opener ("hey i saw…") becomes a greeting line plus a body; a trailing "thanks" becomes its own closing line. */
function splitGreetingAndThanks(blocks, changes) {
  const out = blocks.map((b) => b);
  const first = out[0];
  if (first && first.type === 'p') {
    const t = runsToMarked(first.runs), m = t.match(/^([\uE000\uE001]*(?:hey|hi|hello|good (?:morning|afternoon|evening)|dear [A-Za-z.' ]{2,40}?))(?=[\s,!.]+(?:[A-Za-z]))[\s,!.]+(?=\S)/i);
    if (m && !/\n/.test(t.slice(0, m[0].length)) && t.length > m[0].length + 8 && !(/^dear/i.test(m[1]) && !/[,]/.test(t.slice(0, m[0].length)) && !/^dear [A-Z]/.test(m[1].replace(/[\uE000\uE001]/g, '')))) {
      const greet = m[1].replace(/[\uE000\uE001]/g, '').trim(), rest = t.slice(m[0].length);
      out.splice(0, 1, { type: 'p', runs: [{ t: greet, b: false }] }, { type: 'p', runs: markedToRuns(rest) }); changes.push('Separated the greeting from the message');
    }
  }
  const last = out[out.length - 1];
  if (last && last.type === 'p' && out.length > 1) {
    const t = runsToMarked(last.runs), parts = t.match(/[^.!?]+[.!?]*\s*/g) || [t], tail = parts[parts.length - 1].trim();
    if (parts.length > 1 && THANKS_ONLY.test(tail) && !/\n/.test(t)) { out.splice(out.length - 1, 1, { type: 'p', runs: markedToRuns(parts.slice(0, -1).join('').trim()) }, { type: 'p', runs: [{ t: tail.replace(/[.!,]+$/, ''), b: false }] }); }
  }
  return out;
}
/* greeting → body → closing → signature */
function ensureStructure(blocks, ctx, changes) {
  const out = blocks.slice(), name = ctx.facts.fullName || ctx.facts.name || '[Your full name]';
  const first = out[0] && out[0].type === 'p' ? E.runsText(out[0].runs) : '';
  if (!GREETING.test(first)) { out.unshift({ type: 'p', runs: [{ t: 'Dear Hiring Manager,', b: false }] }); changes.push('Added a greeting'); }
  const txt = (b) => (b.type === 'p' ? E.runsText(b.runs) : '');
  let si = out.findIndex((b, i) => i > 0 && SIGNOFF.test(txt(b)));
  if (si === -1) {
    if (!out.some((b) => /thank/i.test(txt(b)))) { out.push({ type: 'p', runs: [{ t: 'Thank you for your time and consideration. I look forward to hearing from you.', b: false }] }); changes.push('Added a courteous closing sentence'); }
    out.push({ type: 'p', runs: [{ t: `Sincerely,\n${name}`, b: false }] }); changes.push('Added a sign-off and signature');
  } else {
    const lines = txt(out[si]).split('\n');
    if (lines.length === 1) { out[si] = { type: 'p', runs: [{ t: `${lines[0].replace(/[,.]?\s*$/, ',')}\n${name}`, b: false }] }; changes.push('Added your name under the sign-off'); }
  }
  return out;
}
function grammar(blocks, ctx, changes) {
  const stats = {};
  let out = processBlocks(splitGreetingAndThanks(blocks, changes), (s, isItem) => {
    s = s.split('\n').map((line) => fixText(line.trim(), stats)).join('\n');
    if (GREETING.test(s) && !/[,:]$/.test(s.replace(/[]+$/, '')) && s.length < 60) { s = s.replace(/([]*)$/, ',$1'); stats.punctuation = (stats.punctuation || 0) + 1; }
    else if (!GREETING.test(s) && !SIGNOFF.test(s) && !THANKS_ONLY.test(s) && !/\n/.test(s) && s.split(/\s+/).length > 3) { const t = ensureTerminal(s); if (t !== s) stats.punctuation = (stats.punctuation || 0) + 1; s = t; }
    if (THANKS_ONLY.test(s)) { s = s.replace(/[.!,\s]*$/, '.'); }
    return s;
  });
  out = splitLong(out);
  const summary = Object.entries(stats).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`); if (summary.length) changes.push(`Corrected ${summary.join(', ')}`);
  return out;
}

const FORMAL = [[/\b(hey|hi|yo|hiya)\b(?=[\s,!]*(there|team|all|sir|madam|mr|ms|mrs|dr)?)/gi, 'Hello'], [/\bwanna\b/gi, 'would like to'], [/\bgonna\b/gi, 'going to'], [/\bgotta\b/gi, 'need to'], [/\bkinda\b/gi, 'somewhat'], [/\blemme\b/gi, 'let me'], [/\bgimme\b/gi, 'give me'], [/\basap\b/gi, 'as soon as possible'], [/\bthanks\b(?! for)/gi, 'thank you'], [/\bthanks for\b/gi, 'thank you for'], [/\bI(?:'|’)d love to\b/gi, 'I would welcome the opportunity to'], [/\bI(?:'|’)d really love to\b/gi, 'I would welcome the opportunity to'], [/\bI(?:'|’)m (?:really )?excited about\b/gi, 'I am enthusiastic about'], [/\bget back to me\b/gi, 'respond'], [/\blet me know\b/gi, 'please let me know'], [/\bplease please\b/gi, 'please'], [/\bchat\b/gi, 'speak'], [/\bstuff\b/gi, 'responsibilities'], [/\bpretty (good|great)\b/gi, 'strong'], [/\b(awesome|amazing|super)\b/gi, 'excellent'], [/\bI(?:'|’)m\b/g, 'I am'], [/\bI(?:'|’)ve\b/g, 'I have'], [/\bI(?:'|’)ll\b/g, 'I will'], [/\bI(?:'|’)d\b/g, 'I would'], [/\bdon(?:'|’)t\b/gi, 'do not'], [/\bcan(?:'|’)t\b/gi, 'cannot'], [/\bwon(?:'|’)t\b/gi, 'will not'], [/\bdidn(?:'|’)t\b/gi, 'did not'], [/\bdoesn(?:'|’)t\b/gi, 'does not'], [/\bwouldn(?:'|’)t\b/gi, 'would not'], [/\bcouldn(?:'|’)t\b/gi, 'could not']];
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;
function formalize(blocks, ctx, changes) {
  let n = 0;
  let out = processBlocks(blocks, (s) => withProtected(s, (t) => {
    t = t.replace(EMOJI, () => (n++, '')); for (const [re, to] of FORMAL) t = t.replace(re, (m) => { n++; return keepCase(m, to); });
    t = t.replace(/\b(just|really|very|basically|actually|literally)\s+/gi, () => (n++, '')).replace(/!+/g, () => (n++, '.')).replace(/\.\s*\./g, '.').replace(/\bi\s+would\b/g, 'I would');
    return t;
  }));
  if (n) changes.push(`Made the wording more formal (${n} change${n === 1 ? '' : 's'})`);
  // never leave a bold run that covers a whole paragraph or is long: it reads as shouting
  out = out.map((b) => (b.type === 'p' ? { type: 'p', runs: E.normRuns(b.runs.map((r) => (r.b && r.t.split(/\s+/).length > 8 ? (changes.includes('Removed excessive bold') || changes.push('Removed excessive bold'), { t: r.t, b: false }) : r))) } : b));
  return out;
}
const COMPRESS = [[/\bin order to\b/gi, 'to'], [/\bdue to the fact that\b/gi, 'because'], [/\bat this point in time\b/gi, 'now'], [/\bI am writing to (?:let you know that I am|inform you that I am)\b/gi, 'I am'], [/\bI (?:just )?wanted to (?:reach out and |take a moment to )?(?=\w)/gi, 'I '], [/\bplease do not hesitate to (contact|call|reach) me\b/gi, 'please $1 me'], [/\bI would like to take this opportunity to\b/gi, 'I would like to'], [/\bwith regard(?:s)? to\b/gi, 'regarding'], [/\ba number of\b/gi, 'several'], [/\bis able to\b/gi, 'can'], [/\bhas the ability to\b/gi, 'can'], [/\bin the event that\b/gi, 'if'], [/\bas you can see\b,?\s*/gi, ''], [/\bit is important to note that\b\s*/gi, ''], [/\bI am very much looking forward to\b/gi, 'I look forward to'], [/\bat your earliest convenience\b/gi, 'soon'], [/\bfor the purpose of\b/gi, 'for'], [/\bI am writing to express my interest in\b/gi, 'I am applying for'], [/\bI would like to apply for\b/gi, 'I am applying for'], [/\bplease find (?:attached )?my r[eé]sum[eé] (?:attached )?for your (?:review|consideration)\b/gi, 'my résumé is attached'], [/\bI believe that I\b/gi, 'I'], [/\bI am confident that I\b/gi, 'I']];
function shorten(blocks, ctx, changes) {
  let n = 0, dup = 0; const seen = new Set();
  let out = processBlocks(blocks, (s) => withProtected(s, (t) => { for (const [re, to] of COMPRESS) t = t.replace(re, (...m) => { n++; return to.replace(/\$1/g, m[1] || ''); }); return t; }));
  out = out.map((b) => { if (b.type !== 'p') return b; const text = E.runsText(b.runs); if (/\n/.test(text) || text.split(/\s+/).length < 6) return b; const marked = runsToMarked(b.runs), sents = marked.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [marked];
    const keep = sents.filter((x) => { const k = KJ.norm(x.replace(/[]/g, '')); if (!k) return false; if (seen.has(k)) { dup++; return false; } seen.add(k); return true; }); return { type: 'p', runs: markedToRuns(keep.join('').trim()) }; }).filter((b) => b.type === 'ul' || b.runs.length);
  if (n) changes.push(`Tightened ${n} wordy phrase${n === 1 ? '' : 's'}`); if (dup) changes.push(`Removed ${dup} repeated sentence${dup === 1 ? '' : 's'}`);
  return out;
}

/* =============== writing from facts =============== */
const B = (t) => ({ t, b: true }), N = (t) => ({ t, b: false });
const p = (...runs) => ({ type: 'p', runs: E.normRuns(runs.map((r) => (typeof r === 'string' ? N(r) : r))) });
const expLine = (e) => `${e.title}${e.employer ? ', ' + e.employer : ''}${e.years ? ` (${e.years} year${e.years === 1 ? '' : 's'})` : ''}${e.labels.length ? ': ' + e.labels.join(', ') : ''}`;
function factsBlocks(ctx) {
  const f = ctx.facts, out = [];
  if (f.experiences.length) { out.push(p('Relevant experience from my background:')); out.push({ type: 'ul', items: f.experiences.slice(0, 3).map((e) => [N(expLine(e))]) }); }
  else out.push(p('[Add one or two sentences about your most relevant experience.]'));
  if (f.skills.length) out.push(p(`Skills I can bring to this role include ${f.skills.map((x) => (/^[A-Z]{2,}\b/.test(x) ? x : x[0].toLowerCase() + x.slice(1))).join(', ')}.`));
  return out;
}
function signature(ctx) { return p(`Sincerely,\n${ctx.facts.fullName || ctx.facts.name || '[Your full name]'}\n[Your phone number]`); }
function writeEmail(ctx) {
  const { job, facts, email } = ctx, blocks = [p('Dear Hiring Manager,'), p('I am writing to apply for the ', B(job.title), ` position at ${job.employer || 'your organization'}.`)];
  blocks.push(...factsBlocks(ctx));
  if (ctx.notes) { const nb = grammar(E.textToBlocks(ctx.notes), ctx, []); blocks.push(...nb); }
  const attach = []; if (email && email.wantsResume) attach.push('résumé'); if (email && email.wantsCoverLetter) attach.push('cover letter');
  if (attach.length) blocks.push(p(`My ${attach.join(' and ')} ${attach.length > 1 ? 'are' : 'is'} attached for your review.`));
  blocks.push(p('Thank you for your time and consideration. I look forward to hearing from you.'), signature(ctx));
  return blocks;
}
function tailorEmail(blocks, ctx, changes) {
  const { job, facts } = ctx; let out = blocks.length ? blocks.slice() : writeEmail(ctx); if (!blocks.length) { changes.push('Wrote a new draft for this job'); return out; }
  const text = KJ.norm(out.map((b) => (b.type === 'p' ? E.runsText(b.runs) : b.items.map(E.runsText).join(' '))).join(' '));
  const gi = out.findIndex((b) => b.type === 'p' && GREETING.test(E.runsText(b.runs))), at = gi === -1 ? 0 : gi + 1;
  if (!text.includes(KJ.norm(job.title))) { out.splice(at, 0, p('I am writing to apply for the ', B(job.title), ` position at ${job.employer || 'your organization'}.`)); changes.push(`Named the position${job.employer ? ' and employer' : ''}`); }
  const mentioned = facts.experiences.filter((e) => text.includes(KJ.norm(e.title)) && (!e.employer || text.includes(KJ.norm(e.employer))));
  if (!mentioned.length) { const fb = factsBlocks(ctx); const ins = out.findIndex((b, i) => i >= at && (b.type === 'p' && CLOSINGS.test(E.runsText(b.runs)) || /thank/i.test(b.type === 'p' ? E.runsText(b.runs) : ''))); out.splice(ins === -1 ? out.length : ins, 0, ...fb); changes.push(facts.experiences.length ? 'Added your most relevant confirmed experience' : 'Added a placeholder where your relevant experience belongs'); }
  return out;
}
function followUp(ctx) {
  const { job, appliedOn } = ctx, date = appliedOn ? new Date(appliedOn + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '[date you applied]';
  return [p('Dear Hiring Manager,'), p('I am writing to follow up on my application for the ', B(job.title), ` position at ${job.employer || 'your organization'}, which I submitted on `, B(date), '.'),
    p('I remain very interested in the opportunity and would welcome the chance to discuss how my background fits your needs. Please let me know if you need any additional information from me.'), p('Thank you for your time and consideration.'), signature(ctx)];
}
function subjectFor(ctx, action) {
  const { job, facts, email } = ctx, nm = facts.fullName || facts.name || '[Your full name]';
  if (action === 'followup') return `Following up on my application for ${job.title} — ${nm}`;
  if (email && email.requiredSubject) return email.requiredSubject;
  return `Application for ${job.title} — ${nm}`;
}

/* =============== review (honesty guard) =============== */
function review(blocks, ctx) {
  const text = blocks.map((b) => (b.type === 'p' ? E.runsText(b.runs) : b.items.map(E.runsText).join('\n'))).join('\n'), warnings = [], f = ctx.facts;
  const ph = E.findPlaceholders(text); if (ph.length) warnings.push({ level: 'warn', code: 'placeholders', msg: `Fill in ${ph.length === 1 ? 'this placeholder' : 'these placeholders'} before sending: ${ph.join(', ')}` });
  const yrs = [...text.matchAll(/\b(\d{1,2})\+?\s*(?:years?|yrs?)\b/gi)].map((m) => Number(m[1])), known = f.experiences.map((e) => e.years).filter(Boolean).concat(f.experiences.map((e) => Math.floor(e.years || 0)));
  for (const y of yrs) if (!known.some((k) => Math.abs(k - y) <= 0.5) && !(ctx.userText || '').includes(String(y))) warnings.push({ level: 'warn', code: 'unverified-years', msg: `The draft says “${y} years”, which isn’t in your confirmed work history. Only keep it if it’s true.` });
  const claim = (re, label, ok) => { const m = text.match(re); if (m && !ok.some((x) => KJ.norm(x).includes(KJ.norm(m[0]).split(' ')[0])) && !(ctx.userText || '').toLowerCase().includes(m[0].toLowerCase())) warnings.push({ level: 'warn', code: 'unverified-claim', msg: `The draft mentions “${m[0]}”, which isn’t in your confirmed profile. Remove it unless it’s true.` }); };
  claim(/\b(master|doctorate|ph\.?d|mba)\b[^.]{0,30}/i, 'degree', f.education); claim(/\b(licensed|licence|license|credentialed|credential|certified|certification)\b[^.]{0,30}/i, 'credential', f.certs);
  claim(/\bbachelor(?:'s)?\b[^.]{0,30}/i, 'degree', f.education);
  const bolds = E.boldRuns(blocks); if (bolds.length > 3) warnings.push({ level: 'info', code: 'bold', msg: 'There’s a lot of bold text. Keep bold for one or two key details so the email stays professional.' });
  if (!ctx.to) warnings.push({ level: 'warn', code: 'recipient', msg: ctx.email && ctx.email.mentionsEmail ? 'The listing mentions email, but no address was found. Enter the address from the posting.' : 'Enter the recipient’s email address.' }); else if (!E.emailValid(ctx.to)) warnings.push({ level: 'error', code: 'recipient-invalid', msg: 'That recipient address doesn’t look valid.' });
  if (ctx.email && ctx.email.wantsResume) warnings.push({ level: 'info', code: 'attach-resume', msg: 'This listing asks for a résumé. Attach your résumé file yourself before sending — Jobgeek can’t attach it for you.' });
  if (ctx.email && ctx.email.wantsCoverLetter) warnings.push({ level: 'info', code: 'attach-cover', msg: 'This listing also asks for a cover letter. Attach it before sending.' });
  if (f.unconfirmed) warnings.push({ level: 'info', code: 'unconfirmed', msg: `${f.unconfirmed} item${f.unconfirmed === 1 ? '' : 's'} in your profile ${f.unconfirmed === 1 ? 'is' : 'are'} still unconfirmed, so ${f.unconfirmed === 1 ? 'it was' : 'they were'} left out of this draft.` });
  return warnings;
}

/* =============== AI (optional) =============== */
function aiConfigured() { return !!config.ai.key; }
const SYSTEM = 'You edit and write job-application emails for a job seeker. Rules: preserve the writer’s meaning and voice; never add facts, experience, degrees, licenses, certifications or numbers that are not in FACTS; if needed information is missing use a bracketed placeholder such as [Your phone number]; use [Your full name] for the signature name; use bold sparingly (at most two short runs, e.g. the job title or an important date) and NEVER Markdown symbols; keep a greeting, short readable paragraphs, a courteous closing and a signature. Reply with ONLY JSON: {"subject": string, "blocks": [{"type":"p","runs":[{"t":string,"b":boolean}]} | {"type":"ul","items":[[{"t":string,"b":boolean}]]}], "notes": [string]}.';
async function aiDraft(action, blocks, ctx) {
  const facts = { experiences: ctx.facts.experiences.map((e) => ({ title: e.title, employer: e.employer, years: e.years, strengths: e.labels })), skills: ctx.facts.skills, confirmedEducation: ctx.facts.education, confirmedCredentials: ctx.facts.certs };
  const body = { model: config.ai.model, max_tokens: 1500, system: SYSTEM, messages: [{ role: 'user', content: JSON.stringify({ action, job: { title: ctx.job.title, employer: ctx.job.employer, location: ctx.job.location, descriptionExcerpt: String(ctx.job.description || '').slice(0, 2500) }, listingFlags: ctx.email ? { wantsResume: ctx.email.wantsResume, wantsCoverLetter: ctx.email.wantsCoverLetter, requiredSubject: ctx.email.requiredSubject } : {}, FACTS: facts, currentSubject: ctx.subject || '', currentDraft: blocks, extraNotes: ctx.notes || '', appliedOn: ctx.appliedOn || null }) }] };
  const res = await fetch(`${config.ai.base}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': config.ai.key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body), signal: AbortSignal.timeout(40000) });
  if (!res.ok) throw new Error(`The AI service returned HTTP ${res.status}.`);
  const data = await res.json(); const raw = ((data.content || []).find((c) => c.type === 'text') || {}).text || '';
  let parsed; try { parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()); } catch (_) { throw new Error('The AI service returned an unreadable reply.'); }
  const out = []; for (const b of parsed.blocks || []) { if (b.type === 'ul' && Array.isArray(b.items)) out.push({ type: 'ul', items: b.items.map((it) => E.mdToRuns((it || []).map((r) => ({ t: String(r.t || ''), b: !!r.b })))) }); else if (b.type === 'p' && Array.isArray(b.runs)) out.push({ type: 'p', runs: E.mdToRuns(b.runs.map((r) => ({ t: String(r.t || ''), b: !!r.b }))) }); }
  if (!out.length) throw new Error('The AI service returned an empty draft.');
  return { blocks: out, subject: typeof parsed.subject === 'string' ? parsed.subject.replace(/\*\*|__/g, '').slice(0, 200) : null, notes: Array.isArray(parsed.notes) ? parsed.notes.map(String).slice(0, 5) : [] };
}

/* =============== orchestration =============== */
const ACTIONS = ['write', 'grammar', 'professional', 'shorter', 'tailor', 'followup'];
async function runAction(action, input, ctx) {
  if (!ACTIONS.includes(action)) throw Object.assign(new Error('Unknown action'), { status: 400 });
  const changes = [], warnNotes = []; let mode = 'basic', blocks = input.blocks, subject = input.subject || '';
  ctx.userText = E.blocksToText(input.blocks);
  const cleanSubject = () => subject.replace(/\*\*|__/g, '').trim();
  let done = false;
  if (ctx.useAi && aiConfigured()) {
    try { const r = await aiDraft(action, input.blocks, ctx); blocks = r.blocks; if (r.subject) subject = r.subject; changes.push(...(r.notes.length ? r.notes : [`AI ${{ write: 'wrote', grammar: 'corrected', professional: 'professionalized', shorter: 'shortened', tailor: 'tailored', followup: 'wrote a follow-up for' }[action]} the email`])); mode = 'ai'; done = true; }
    catch (e) { warnNotes.push({ level: 'info', code: 'ai-fallback', msg: `The AI service couldn’t be used (${e.message}) so the basic editor was used instead.` }); }
  } else if (ctx.useAi) warnNotes.push({ level: 'info', code: 'ai-off', msg: 'AI isn’t configured on this server, so the basic editor was used.' });
  if (!done) {
    if (action === 'write') { blocks = writeEmail(ctx); changes.push('Wrote a draft from the job and your confirmed profile'); }
    else if (action === 'followup') { blocks = followUp(ctx); changes.push('Wrote a polite follow-up'); }
    else {
      if (!blocks.length) { blocks = writeEmail(ctx); changes.push('There was no draft yet, so one was written for you'); }
      else if (action === 'grammar') blocks = ensureStructure(grammar(blocks, ctx, changes), ctx, changes);
      else if (action === 'professional') blocks = ensureStructure(grammar(formalize(grammar(blocks, ctx, changes), ctx, changes), ctx, []), ctx, changes);
      else if (action === 'shorter') blocks = ensureStructure(grammar(shorten(blocks, ctx, changes), ctx, changes), ctx, changes);
      else if (action === 'tailor') blocks = grammar(tailorEmail(blocks, ctx, changes), ctx, changes);
    }
    if (action === 'write' || action === 'followup' || !subject) subject = subjectFor(ctx, action);
  }
  // final safety: no markdown symbols, name placeholder filled locally (the AI never sees the name)
  const nm = ctx.facts.fullName || ctx.facts.name;
  blocks = blocks.map((b) => (b.type === 'ul' ? { type: 'ul', items: b.items.map((it) => E.mdToRuns(it.map((r) => ({ t: nm ? r.t.replace(/\[Your (?:full )?name\]/gi, nm) : r.t, b: r.b })))) } : { type: 'p', runs: E.mdToRuns(b.runs.map((r) => ({ t: nm ? r.t.replace(/\[Your (?:full )?name\]/gi, nm) : r.t, b: r.b }))) }));
  if (nm) subject = subject.replace(/\[Your (?:full )?name\]/gi, nm);
  const warnings = warnNotes.concat(review(blocks, ctx));
  if (!changes.length) changes.push('No changes were needed');
  return { mode, subject: cleanSubject() ? subject.replace(/\*\*|__/g, '') : subjectFor(ctx, 'write'), blocks, html: E.blocksToHtml(blocks), text: E.blocksToText(blocks), warnings, changes };
}
module.exports = { detectEmailApply, applicantFacts, runAction, review, aiConfigured, ACTIONS, grammar, formalize, shorten, ensureStructure, writeEmail, followUp, fixText, runsToMarked, markedToRuns };
