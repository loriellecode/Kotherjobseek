/* Views: everything the user sees. Pure functions of KJ.A.S (server-provided state). */
(function () {
  'use strict';
  const KJ = window.KJ, A = KJ.A, { esc, icon } = A;
  const S = () => A.S, ses = () => A.session;
  const profile = () => A.S.profile;
  const APP_STATUS = { interested: 'Interested', applied: 'Applied', interviewing: 'Interviewing', offer: 'Offer', rejected: 'Not selected', withdrawn: 'Withdrawn', closed: 'Closed / no longer relevant' };
  A.APP_STATUS = APP_STATUS;

  /* ---------- small components ---------- */
  function art(j, cls) {
    const img = j.logoUrl ? `<img src="${esc(j.logoUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '';
    return `<div class="art ${cls || ''}" style="--h:${A.hue(j.employer)}">${img}<span class="wm" aria-hidden="true">${esc(j.employer)}</span><div class="cardimg" data-img-topic="${esc(A.topicFor(j))}" data-img-i="${j.id % 8}" data-card="1" hidden></div></div>`;
  }
  const logo = (j) => `<span class="mono">${j.logoUrl ? `<img src="${esc(j.logoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<b>${esc(A.initials(j.employer))}</b></span>`;
  const isNew = (j) => ses().newIds.has(j.id);
  const stale = (j) => (j.verification === 'unverified' ? '<span class="badge-stale">Not verified recently</span>' : j.verification === 'possibly_expired' ? '<span class="badge-stale warn">May have closed</span>' : j.verification === 'closed' ? '<span class="badge-stale warn">Closed</span>' : '');
  const tags = (j) => { const t = (isNew(j) ? '<span class="badge-new">New</span>' : '') + stale(j); return t ? `<div class="tags">${t}</div>` : ''; };
  function matchBadge(m) {
    const n = KJ.CLASS_BARS[m.classification];
    return `<span class="match ${m.classification}" title="An estimate of how well this fits the profile you entered — not a prediction of being hired"><span class="bars" aria-hidden="true">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>${KJ.CLASS_SHORT[m.classification]}</span>`;
  }
  function jobButtons(j, cls) {
    const s = !!j.userState.saved;
    return `<button class="${cls || 'act'}" data-action="save" data-id="${j.id}" aria-pressed="${s}" aria-label="${s ? 'Remove from saved' : 'Save job'}: ${esc(j.title)}">${icon('bookmark', s ? 'fill' : '')}</button>` +
      `<button class="${cls || 'act'}" data-action="dismiss" data-id="${j.id}" aria-label="Not interested: ${esc(j.title)}">${icon('x')}</button>`;
  }
  const indicator = (label, value, sub, pct, cls) => `<div class="ind ${cls || ''}"><div class="ind-h"><span>${label}</span><b>${value}</b></div><div class="meter" role="img" aria-label="${esc(label)}: ${esc(value)}"><i style="width:${Math.max(4, pct)}%"></i></div><p>${esc(sub)}</p></div>`;
  function indicators(m) {
    const q = m.qualification, qLabel = { strong: 'Strong', potential: 'Needs verifying', needs_more: 'Gaps found' }[q.level];
    const sLabel = { meets_desired: 'Meets desired', meets_min: 'Meets minimum', below: 'Below minimum', unlisted: 'Not listed', estimated: 'Estimated', no_preference: 'Not set' }[m.salary.status];
    const lLabel = { priority: 'Priority area', preferred_city: 'Preferred city', within_commute: 'Within commute', remote: 'Remote', remote_not_preferred: 'Remote', elsewhere_ca: 'Elsewhere in California', outside: 'Too far', not_preferred: 'Not preferred', unknown: 'Unknown' }[m.location.status];
    return `<div class="inds">${indicator('Qualifications', qLabel, `${q.checks.filter((c) => c.status === 'met').length} confirmed · ${q.mandatoryUnverified || 0} to confirm · ${q.mandatoryUnknown} unknown · ${q.mandatoryUnmet} unmet (required)`, q.score, q.level)}
      ${indicator('Salary', sLabel, m.salary.text, m.salary.score)}${indicator('Location', lLabel, m.location.text, m.location.score)}${indicator('Overall relevance', `${m.overall}/100`, 'Estimate of profile fit', m.overall, 'overall')}</div>`;
  }

  /* ---------- cards ---------- */
  function card(j, variant) {
    const m = j.match, more = j.remote ? 'Remote' : (j.categories || [])[0] || 'Nearby', cat = (j.categories || [])[0] || '';
    const blurb = ''; // the “why this matches” reasons live on the job’s detail page
    const chipTxt = j.remote ? 'Remote' : j.type || '';
    const emailChip = j.emailApply && j.emailApply.confidence === 'high' ? '<span class="chip-over mail">✉ Email to apply</span>' : '';
    return `<article class="card ${variant || ''}" data-job="${j.id}"><a class="open" href="#/job/${j.id}" aria-label="${esc(j.title)}, ${esc(j.employer)}"></a>
      ${variant === 'compact' ? '' : `<div class="artwrap">${art(j)}${chipTxt ? `<span class="chip-over">${esc(chipTxt)}</span>` : ''}<div class="tags">${isNew(j) ? '<span class="badge-new">New</span>' : ''}${stale(j)}${emailChip}</div></div>`}
      <div class="employer">${esc(j.employer)}${variant === 'compact' ? ' ' + (isNew(j) ? '<span class="badge-new">New</span>' : '') + stale(j) + (emailChip ? ' ✉' : '') : ''}</div>
      ${cat ? `<div class="catlabel" style="color:${A.CAT_COLOR[cat] || 'var(--accent)'}">${esc(cat)}${j.type ? ' · ' + esc(j.type) : ''}</div>` : ''}
      <h3>${esc(j.title)}</h3><div class="meta">${esc(A.shortWhere(j))}</div><div class="pay">${esc(A.pay(j))}${A.payAlt(j) ? `<span class="pay-alt">${esc(A.payAlt(j))}</span>` : ''}</div>
      ${j.deadline ? `<div class="meta">Closes ${esc(A.fmtDate(j.deadline))}</div>` : ''}${blurb ? `<p class="blurb">${esc(blurb)}</p>` : ''}
      <div class="foot"><span class="matchpill ${m.classification}">${esc(KJ.CLASS_SHORT[m.classification])}</span><span class="grow"></span>${jobButtons(j)}</div></article>`;
  }
  /* Trust is assessed on the server (see server/trust.js). Nothing is "verified": statuses describe the evidence found. closer_look needs an explicit review step; high_risk hides the apply action. */
  const TRUST_ICON = { trusted: 'check', checked: 'check', closer_look: 'alert', high_risk: 'alert' };
  function applyButton(j) {
    const lv = j.link && j.link.level;
    if (lv === 'high_risk') return '<span class="btn primary" aria-disabled="true">Application link hidden — high risk</span>';
    if (!j.applyUrl) return `<span class="btn primary" aria-disabled="true">${j.emailApply ? 'Apply by email — see below' : 'No application link in this listing'}</span>`;
    if (!lv || lv === 'closer_look') return `<button class="btn caution" data-action="open-link" data-id="${j.id}">Review destination, then open ${icon('ext')}</button>`;
    return `<a class="btn primary" href="${esc(j.applyUrl)}" target="_blank" rel="noopener noreferrer" data-action="apply-opened" data-id="${j.id}">Apply on ${esc(j.link.host || 'the employer’s site')} ${icon('ext')}</a>`;
  }
  const ago = (t) => { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} hr ago` : `${Math.round(m / 1440)} days ago`; };
  function linkNote(j) {
    const L = j.link || {}; if (!L.level) return '';
    const good = (L.reasons || []).filter((r) => r.kind === 'good'), rest = (L.reasons || []).filter((r) => r.kind !== 'good');
    const head = good[0] ? good[0].text : (rest[0] ? rest[0].text : L.label);
    const li = (r) => `<li class="r-${r.kind}">${esc(r.text)}</li>`;
    return `<div class="trust ${L.level}"><p class="linknote ${L.level}">${icon(TRUST_ICON[L.level] || 'alert')}<span><b>${esc(L.label)}.</b> ${esc(head)}${L.host ? ` <span class="host">${esc(L.host)}</span>` : ''}</span></p>
      <details class="how"><summary>Why this status</summary><ul class="reasons">${(L.reasons || []).map(li).join('')}</ul>${(L.evidence || []).length ? `<p class="note"><b>Evidence:</b> ${(L.evidence || []).map(esc).join(' ')}</p>` : ''}
      <p class="note">Last checked ${esc(ago(L.checkedAt))}. ${L.checks ? `Automated: ${(L.checks.automated || []).map(esc).join('; ')}. <b>Not done:</b> ${(L.checks.notDone || []).map(esc).join('; ')}.` : ''} This is guidance, not a guarantee — always review the employer and the site before sharing personal information.</p>
      <button class="btn sm" data-action="trust-recheck" data-id="${j.id}">Re-check this listing</button></details></div>`;
  }
  function featuredCard(j, label) {
    const m = j.match, why = m.reasons.slice(0, 3), saved = !!j.userState.saved, cat = (j.categories || [])[0] || '';
    return `<article class="hero" data-open="${j.id}">
      <div class="hero-bg" style="--h:${A.hue(j.employer)}" data-img-topic="${A.topicFor(j)}" data-hero="1"></div><div class="hero-shade"></div>
      <div class="hero-body">
        <div class="hero-eyebrow">${esc(label || 'Featured')}${cat ? ' · ' + esc(cat) : ''} · ${esc(KJ.CLASS_SHORT[m.classification])} ${isNew(j) ? '<span class="badge-new onimg">New</span>' : ''} ${stale(j)}</div>
        <h2><a href="#/job/${j.id}">${esc(j.title)}</a></h2>
        <div class="hero-sub">${esc(j.employer)}</div>
        <p class="hero-meta">${esc(A.where(j))} · <b>${esc(A.pay(j))}</b>${A.payAlt(j) ? ` <span>${esc(A.payAlt(j))}</span>` : ''}${j.type ? ' · ' + esc(j.type) : ''}${j.deadline ? ' · Closes ' + esc(A.fmtDate(j.deadline)) : ''}</p>
        <div class="hero-actions"><a class="btn white" href="#/job/${j.id}">View opportunity</a>${applyButton(j)}
          <button class="btn glass-dark icon" data-action="save" data-id="${j.id}" aria-pressed="${saved}" aria-label="${saved ? 'Remove from saved' : 'Save job'}">${icon('bookmark', saved ? 'fill' : '')}</button><button class="btn glass-dark icon" data-action="dismiss" data-id="${j.id}" aria-label="Not interested">${icon('x')}</button></div>
      </div><span class="hero-credit"></span></article>
      <section class="why"><div class="why-col"><b>Why it’s here</b><ul>${(why.length ? why : ['No confirmed alignment yet — add details to your profile']).map((r) => `<li>${esc(r)}</li>`).join('')}${m.unknown[0] ? `<li>Still to verify: ${esc(m.unknown[0])}</li>` : ''}${m.gaps[0] ? `<li>Possible gap: ${esc(m.gaps[0])}</li>` : ''}</ul></div>
        <div class="why-col"><p class="mini-ind"><span>Salary: ${esc(m.salary.text)}</span><span>Location: ${esc(m.location.text)}</span></p>${linkNote(j)}<p class="src">Source: ${esc(A.providerName(j.provider))}${j.lastVerified ? ' · last seen ' + esc(A.ago(j.lastVerified)) : ''}</p></div></section>`;
  }
  function imageSlot(topic, kind) { return topic ? `<div class="${kind}" data-img-topic="${esc(topic)}" hidden></div>` : ''; }
  function section(sec) {
    const cards = sec.items.map((it, i) => card(it, sec.wide && i < sec.wide ? 'wide' : sec.compact ? 'compact' : '')).join('');
    return `<section class="section" aria-labelledby="h-${sec.id}"><div class="sec-head">${imageSlot(sec.image, 'thumb')}<div class="grow"><h2 id="h-${sec.id}">${esc(sec.title)}</h2>${sec.blurb ? `<p>${esc(sec.blurb)}</p>` : ''}</div>
      <div class="rail-nav"><button data-action="rail" data-dir="-1" data-target="rail-${sec.id}" aria-label="Scroll ${esc(sec.title)} back">${icon('left')}</button><button data-action="rail" data-dir="1" data-target="rail-${sec.id}" aria-label="Scroll ${esc(sec.title)} forward">${icon('right')}</button></div></div>
      <div class="rail" id="rail-${sec.id}" data-rail="${sec.id}">${cards}</div></section>`;
  }

  /* ---------- status + banners ---------- */
  A.statusHTML = function () {
    if (S().busy) return `<div class="statusbar run" role="status"><span class="spin" aria-hidden="true"></span><div class="grow"><b>${esc(S().busy)}…</b></div></div>`;
    const st = S().status; if (!st || st.state === 'idle' || (st.dismissed)) return '';
    const run = ['queued', 'searching', 'matching', 'updating'].includes(st.state);
    if (run) return `<div class="statusbar run" role="status"><span class="spin" aria-hidden="true"></span><div class="grow"><b>${esc(st.label)}…</b>${st.state === 'queued' ? ' <span class="note">Edits made within a few seconds are combined into one search.</span>' : ''}</div></div>`;
    if (st.state === 'failed') return `<div class="statusbar bad" role="alert">${icon('alert')}<div class="grow"><b>Search failed.</b> ${esc(st.error || 'Something went wrong.')} <span class="note">Your existing results are unchanged.</span></div><button class="btn sm" data-action="retry-search">Retry</button><button class="btn sm quiet" data-action="dismiss-status" aria-label="Dismiss">${icon('x')}</button></div>`;
    if (st.state === 'done' && st.finishedAt && Date.now() - st.finishedAt > 45000) return ''; // fades away; the Settings page keeps the history
    if (st.state === 'done') { const r = st.result || {}; const parts = []; if (r.searched) parts.push(`${r.created || 0} new listing${r.created === 1 ? '' : 's'} found`); if (r.newMatches) parts.push(`${r.newMatches} new match${r.newMatches === 1 ? '' : 'es'}`); if (r.errors && r.errors.length) parts.push(`${r.errors.length} search${r.errors.length === 1 ? '' : 'es'} failed: ${r.errors[0].message}`);
      return `<div class="statusbar ok" role="status">${icon('check')}<div class="grow"><b>${esc(st.label)}.</b> ${esc(parts.join(' · '))} <span class="note">${st.finishedAt ? esc(A.ago(st.finishedAt)) : ''}</span></div><button class="btn sm quiet" data-action="dismiss-status" aria-label="Dismiss">${icon('x')}</button></div>`; }
    return '';
  };
  A.renderBanners = function () { const el = document.getElementById('statusbar'); if (el) el.innerHTML = A.statusHTML(); };

  function sourceBanners() {
    let h = '';
    if (S().offline) h += `<div class="banner warn" role="alert">${icon('plug')}<div class="grow"><b>You’re disconnected from the server.</b> Showing the last results that loaded; changes can’t be saved until the connection returns.<div class="acts"><button class="btn sm" data-action="reload-all">Try again</button></div></div></div>`;
    if (ses().error) h += `<div class="banner warn" role="alert">${icon('alert')}<div class="grow">${esc(ses().error)}<div class="acts"><button class="btn sm quiet" data-action="dismiss-error">Dismiss</button></div></div></div>`;
    const live = S().providers.filter((p) => p.kind !== 'import');
    if (S().jobs.length && live.length && !live.some((p) => p.configured)) h += `<div class="banner warn">${icon('plug')}<div class="grow"><b>No live job source is configured.</b> These listings came from an imported file, so they won’t refresh by themselves.<div class="acts"><a class="btn sm" href="#/settings">Set up sources</a></div></div></div>`;
    for (const p of live) {
      if (p.configured && p.lastStatus === 'failed') h += `<div class="banner warn">${icon('plug')}<div class="grow"><b>${esc(p.name)} had a problem.</b> ${esc(p.lastError || '')} Existing results are kept${p.lastSuccess ? '; last successful update ' + esc(A.ago(p.lastSuccess)) : ''}.<div class="acts"><button class="btn sm" data-action="retry-search">Retry</button></div></div></div>`;
    }
    return h;
  }

  /* ---------- shell ---------- */
  function shell(route, title, eyebrow, inner, opts) {
    opts = opts || {};
    const tabs = [['discover', 'Discover'], ['saved', 'Saved'], ['applications', 'Applications'], ['profile', 'Profile']];
    const unread = S().unread, here = route === 'job' ? 'discover' : route;
    const pop = ses().notesOpen ? `<div class="pop" role="dialog" aria-label="Notifications">${S().notes.map((n) => `<a class="item" href="${esc(n.link || '#/discover')}" data-action="close-pop"><b>${esc(n.title)}</b><span>${esc(n.body.split('\n')[0])}</span><small>${esc(A.ago(n.created_at))}</small></a>`).join('') || '<div class="item"><b>You’re all caught up</b><span>Nothing needs your attention.</span></div>'}<a class="item link" href="#/profile" data-action="close-pop">Notification preferences</a></div>` : '';
    const searchOpen = route === 'discover' && (ses().searchOpen || ses().q);
    return `<div class="shell"><header class="dock-wrap"><nav class="dock" aria-label="Primary">
      ${tabs.map(([r, l]) => `<a class="dock-tab" href="#/${r}" ${here === r ? 'aria-current="page"' : ''}>${l}</a>`).join('')}
      <span class="dock-sep" aria-hidden="true"></span>
      <button class="dock-icon" data-action="toggle-search" aria-label="Search jobs" aria-expanded="${!!searchOpen}">${icon('search')}</button>
      <div class="tools"><button class="dock-icon" data-action="notes" aria-label="Notifications${unread ? ` (${unread} unread)` : ''}" aria-expanded="${ses().notesOpen}">${icon('bell')}${unread ? '<span class="dot"></span>' : ''}</button>${pop}</div>
      <a class="dock-icon" href="#/settings" aria-label="Settings">${icon('gear')}</a></nav></header>
      <main id="main">
      ${searchOpen ? `<form class="searchbar" role="search" data-form="search"><label class="sr" for="q">Search jobs</label>${icon('search')}<input id="q" type="search" placeholder="Search jobs, employers, cities" value="${esc(ses().q)}" autocomplete="off" enterkeyhint="search">${ses().q ? `<button type="button" class="clear" data-action="clear-search" aria-label="Clear search">${icon('x')}</button>` : ''}</form>` : ''}
      <div class="topbar"><div class="titles"><div class="eyebrow">${esc(eyebrow)}</div>${title ? `<h1 class="page">${esc(title)}</h1>` : ''}</div></div>
      <div id="statusbar">${A.statusHTML()}</div>${inner}</main></div>`;
  }


  /* ---------- résumé panel (My Profile) ---------- */
  function resumePanel() {
    const R = S().resume && S().resume.resume, busy = S().busy && /résumé/i.test(S().busy);
    const priv = `<p class="note priv">${icon('lock')} Private to your account and stored where this app runs (on your phone in the phone edition). It is read here to suggest profile entries — never sent to an outside AI service or to employers.</p>`;
    if (busy) return `<section class="panel resume-panel"><h2>Résumé</h2><div class="statusbar run"><span class="spin"></span><div class="grow"><b>${esc(S().busy)}…</b></div></div></section>`;
    if (!R) return `<section class="panel resume-panel"><h2>Résumé</h2><p class="note" style="margin-top:0">Upload a PDF or Word résumé. Jobgeek suggests education, work history, skills and credentials for you to review, then uses what you approve to widen your job search.</p><div class="actions"><button class="btn primary" data-action="resume-upload">${icon('upload')} Upload résumé</button><button class="btn quiet" data-action="edit" data-sec="experience">Enter work history manually</button></div><p class="note">PDF or DOCX, up to 5 MB.</p>${priv}</section>`;
    const st = { ready: ['Analysis complete', 'ok'], failed: ['Analysis failed', 'bad'], processing: ['Processing…', 'run'] }[R.status] || ['', ''], c = R.counts;
    return `<section class="panel resume-panel"><div class="row1"><h2 style="margin:0;flex:1">Résumé</h2><span class="chip-s s-${st[1]}">${st[0]}</span></div>
      <dl class="kv" style="margin-top:12px"><div><dt>File</dt><dd>${esc(R.filename)}</dd></div><div><dt>Uploaded</dt><dd>${esc(A.fmtDate(new Date(R.uploadedAt).toISOString()))} · ${(R.size / 1024).toFixed(0)} KB</dd></div><div><dt>Status</dt><dd>${R.status === 'ready' ? (c.pending ? A.plural(c.pending, 'suggestion') + ' to review' : 'Review complete') : R.status === 'failed' ? 'Could not be analyzed' : 'Working'}</dd></div><div><dt>Added from this résumé</dt><dd>${c.accepted} accepted · ${c.rejected} rejected</dd></div></dl>
      ${R.status === 'failed' ? `<div class="banner warn" role="alert">${icon('alert')}<div class="grow"><b>We couldn’t read this résumé.</b> ${esc(R.error || '')}<div class="acts"><button class="btn sm primary" data-action="resume-retry">Retry analysis</button><button class="btn sm" data-action="resume-upload">Upload another file</button><button class="btn sm quiet" data-action="edit" data-sec="experience">Enter work history manually</button></div></div></div>` : ''}
      ${R.status === 'ready' && c.duplicates && !c.pending ? `<p class="note">${c.duplicates} item${c.duplicates === 1 ? ' was' : 's were'} already in your profile, so nothing major changed.</p>` : ''}
      <div class="actions">${R.status === 'ready' && c.pending ? `<button class="btn primary" data-action="resume-review">Review ${c.pending} suggestion${c.pending === 1 ? '' : 's'}</button>` : ''}<button class="btn" data-action="resume-upload">Replace résumé</button>${R.status !== 'processing' ? '<button class="btn" data-action="resume-retry">Re-run analysis</button>' : ''}<a class="btn quiet" href="/api/resume/file" download>Download</a><button class="btn quiet danger" data-action="resume-remove">${icon('trash')} Remove</button></div>${priv}</section>`;
  }

  /* ---------- "Other Careers to Explore" ---------- */
  const careerStats = (c) => {
    const st = c.stats;
    const pay = st && st.salary ? `${KJ.fmtMoney(st.salary.low)}–${KJ.fmtMoney(st.salary.high)}/yr across ${st.salary.n} current listings` : 'Not enough current listings with posted pay to say';
    const geo = st ? (st.openings ? `${A.plural(st.openings, 'current opening')}${st.nearby ? `, ${st.nearby} in your preferred area` : ', none in your preferred area yet'}${st.cities.length ? ' · ' + st.cities.slice(0, 3).map((x) => x.city).join(', ') : ''}` : 'No current openings found yet') : '';
    return { pay, geo };
  };
  const bullets = (arr) => `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  /* A career card is a short summary; tapping it opens everything (what the job is, why it may be relevant, skills, pay, gaps). */
  const textSize = () => { try { return localStorage.getItem('kj.text') || 'normal'; } catch (_) { return 'normal'; } };
  function careerCard(c) {
    const inc = c.state === 'include', st = c.stats, { pay, geo } = careerStats(c);
    const short = st && st.salary ? `${KJ.fmtMoney(st.salary.low)}–${KJ.fmtMoney(st.salary.high)}/yr` : '';
    const open = st && st.openings ? A.plural(st.openings, 'opening') + (st.nearby ? ` · ${st.nearby} nearby` : '') : 'No openings found yet';
    return `<article class="card career" data-career="${esc(c.id)}" data-action="career-open" data-id="${esc(c.id)}" tabindex="0" role="button" aria-label="${esc(c.title)} — see details"><div class="employer">${esc(c.category)}${c.strength ? ' · ' + esc(c.strength) + ' evidence' : ''}</div><h3>${esc(c.title)}</h3>
      <p class="meta">${esc([short, open].filter(Boolean).join(' · '))}</p>
      <div class="foot"><button class="btn sm ${inc ? 'on' : ''}" data-action="career-state" data-id="${esc(c.id)}" data-state="${inc ? 'clear' : 'include'}" aria-pressed="${inc}">${inc ? 'Included ✓' : 'Include in searches'}</button><button class="btn sm quiet" data-action="career-state" data-id="${esc(c.id)}" data-state="exclude">Exclude</button><span class="grow"></span><span class="more" aria-hidden="true">Details ›</span></div></article>`;
  }
  A.careerDetail = function (id) {
    const c = (S().careers.suggestions || []).find((x) => x.id === id); if (!c) return;
    const inc = c.state === 'include', st = c.stats, { pay, geo } = careerStats(c);
    A.openModal(`<h2 id="mt">${esc(c.title)}</h2><p class="sub">${esc(c.category)}${c.strength ? ' · ' + esc(c.strength) + ' evidence' : ''}</p>
      <p>${esc(c.does)}</p>
      <h4>Why your background may be relevant</h4>${bullets(c.evidence.map((e) => e.text))}
      ${c.transferable.length ? `<h4>Transferable skills</h4><p>${esc(c.transferable.join(' · '))}</p>` : ''}
      <dl class="mini-kv"><div><dt>Pay in current listings</dt><dd>${esc(pay)}</dd></div>${geo ? `<div><dt>Availability</dt><dd>${esc(geo)}</dd></div>` : ''}</dl>
      <h4>Typically required</h4>${bullets(c.essential)}${c.known.length ? `<h4>Known to be satisfied</h4>${bullets(c.known)}` : ''}${c.toConfirm.length ? `<h4>Reported — needs your confirmation</h4>${bullets(c.toConfirm)}` : ''}${c.unknown.length ? `<h4>Unknown</h4>${bullets(c.unknown)}` : ''}${c.unmet.length ? `<h4>Appears unmet</h4>${bullets(c.unmet)}` : ''}${c.licensingNote ? `<p class="note warnline">${icon('alert')} ${esc(c.licensingNote)}</p>` : ''}<p class="note">Requirements are typical and vary by employer.</p>
      <div class="foot"><button class="btn" data-action="close-modal">Close</button><button class="btn sm ${inc ? 'on' : ''}" data-action="career-state" data-id="${esc(c.id)}" data-state="${inc ? 'clear' : 'include'}">${inc ? 'Included in searches ✓' : 'Include in searches'}</button>${st && st.openings ? `<button class="btn primary" data-action="career-view" data-q="${esc(c.searchTerms[0])}">View openings</button>` : ''}</div>`);
  };
  function careerSection() {
    const C = S().careers; if (!C) return '';
    const shown = C.suggestions.filter((c) => c.otherCategory || c.state === 'include').slice(0, 10);
    const hidden = C.excluded.length ? `<p class="note">${A.plural(C.excluded.length, 'career')} hidden: ${C.excluded.map((x) => `${esc(x.title)} <button class="btn quiet sm" data-action="career-state" data-id="${esc(x.id)}" data-state="clear">Restore</button>`).join(' · ')}</p>` : '';
    if (!shown.length) return `<section class="section"><div class="sec-head"><div class="grow"><h2>Other Careers to Explore</h2><p>Careers are suggested only when your education, work history or skills support them.</p></div></div><div class="banner">${icon('info')}<div class="grow"><b>No supported suggestions yet.</b> Add work history or upload a résumé so suggestions can be backed by your actual experience.<div class="acts"><a class="btn sm" href="#/profile">Open profile</a></div></div></div>${hidden}</section>`;
    return `<section class="section" aria-labelledby="h-careers"><div class="sec-head"><div class="grow"><h2 id="h-careers">Other Careers to Explore</h2><p>Each suggestion shows the evidence from your profile behind it. Nothing here claims you qualify — check the gaps.</p></div><div class="rail-nav"><button data-action="rail" data-dir="-1" data-target="rail-careers" aria-label="Scroll careers back">${icon('left')}</button><button data-action="rail" data-dir="1" data-target="rail-careers" aria-label="Scroll careers forward">${icon('right')}</button></div></div><div class="rail careers-rail" id="rail-careers" data-rail="careers">${shown.map(careerCard).join('')}</div>${hidden}</section>`;
  }

  /* ---------- discover ---------- */
  function providerChecklist() {
    const live = S().providers.filter((p) => p.kind !== 'import');
    return `<div class="checklist">${live.map((p) => `<div class="panel"><div class="row1"><h3>${esc(p.name)}</h3>${p.configured ? '<span class="status">' + icon('check') + 'Configured</span>' : '<span class="status todo">' + icon('dash') + 'Needs setup</span>'}</div>${p.configured ? '' : `<p class="note">Missing: <code>${esc((p.missing || []).join(', '))}</code></p><ol>${p.setup.map((s) => `<li>${esc(s)}</li>`).join('')}</ol><p class="note"><a href="${esc(p.docs)}" target="_blank" rel="noopener noreferrer">Official documentation ${icon('ext')}</a></p>`}</div>`).join('')}</div>`;
  }
  function emptyNoJobs() {
    const anyConfigured = S().providers.some((p) => p.kind !== 'import' && p.configured), running = S().status && ['queued', 'searching', 'matching', 'updating'].includes(S().status.state);
    if (anyConfigured) return `<div class="empty">${icon('search')}<h2>${running ? 'Searching for jobs…' : 'No listings yet'}</h2><p>${running ? 'The first search can take a minute. Results appear here when it finishes.' : 'A job source is configured but nothing has been retrieved yet. Run a search to fetch current listings.'}</p><div class="actions"><button class="btn primary" data-action="search-now" ${running ? 'disabled' : ''}>Search now</button><a class="btn" href="#/profile">Review your profile</a></div></div>`;
    return `<div class="empty wide">${icon('plug')}<h2>No job source is configured</h2><p>Jobgeek only shows real postings from sources you connect. It never makes up listings. Set up at least one source below (the server needs the listed environment variables), or import a JSON file of real postings.</p>${providerChecklist()}<div class="actions"><button class="btn" data-action="import-open">Import listings (JSON)</button><button class="btn quiet" data-action="download-template">Download template</button></div></div>`;
  }
  function emptyFeed(reason) {
    const below = S().jobs.filter((j) => j.match && j.match.excluded.belowFloor).length;
    const m = { search: ['No jobs found', 'Try a different title, employer or city.'], cat: ['Nothing here yet', 'No current listings fit this category and your preferences.'], feed: ['Nothing matches your preferences right now', below ? `${below} listing${below === 1 ? ' is' : 's are'} hidden because they pay below your minimum.` : 'Nothing currently fits your location, salary and category preferences.'] }[reason];
    return `<div class="empty">${icon('compass')}<h2>${m[0]}</h2><p>${m[1]}</p><div class="actions">${reason === 'search' ? '<button class="btn" data-action="clear-search">Clear search</button>' : `<a class="btn primary" href="#/profile">Review preferences</a>${below ? '<button class="btn" data-action="show-below">Show jobs below my minimum</button>' : ''}<button class="btn" data-action="search-now">Search now</button>`}</div></div>`;
  }
  const skeleton = () => `<div class="skeleton" aria-busy="true" aria-label="Loading"><div class="sk" style="height:300px;margin:12px 0 30px"></div><div class="sk" style="height:26px;width:220px;margin-bottom:14px"></div><div style="display:flex;gap:14px;overflow:hidden">${'<div class="sk" style="flex:none;width:280px;height:232px"></div>'.repeat(4)}</div></div>`;
  const CAT_IMAGE = { Finance: 'finance', Business: 'business', Education: 'education', 'Special Education': 'special education', Remote: 'remote work', Nearby: 'workplace' };

  function vDiscover() {
    const p = profile(), date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }), h = new Date().getHours();
    const g = h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    let inner = sourceBanners();
    if (!S().loaded) inner += skeleton();
    else if (!S().jobs.length) inner += emptyNoJobs();
    else {
      const chips = KJ.chips(p); if (!chips.includes(ses().cat)) ses().cat = 'For You';
      const JOBS = A.filtered(), seg = (k, items) => `<div class="seg" role="group" aria-label="${k}">${items.map(([v, l]) => `<button data-action="set-${k}" data-v="${v}" aria-pressed="${ses()[k] === v}">${l}</button>`).join('')}</div>`;
      const opt = (items, cur) => items.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');
      inner += `<div class="filterbar" role="group" aria-label="Filter jobs">
        <label class="fsel"><span>Show</span><select data-action="filter" data-key="mode">${opt([['all', 'All jobs'], ['remote', 'Remote only'], ['onsite', 'On-site only']], ses().mode)}</select></label>
        <label class="fsel"><span>Where</span><select data-action="filter" data-key="where">${opt([['anywhere', 'Anywhere'], ['near', 'Near me'], ['remote', 'Remote']], ses().where)}</select></label>
        <label class="fsel full"><span>Kind of work</span><select data-action="filter" data-key="cat">${opt(chips.map((c) => [c, c]), ses().cat)}</select></label>
        <button class="fscan" data-action="search-now">${icon('refresh')} Look for new jobs</button></div>`;
      if (ses().q.trim()) {
        const res = KJ.search(JOBS, p, ses().q);
        inner += `<div class="sec-head" style="margin-top:20px"><div class="grow"><h2>${A.plural(res.length, 'result')} for “${esc(ses().q.trim())}”</h2><p>Search covers every listing you haven’t dismissed.</p></div></div>${res.length ? `<div class="grid">${res.map((j) => card(j)).join('')}</div>` : emptyFeed('search')}`;
      } else if (ses().cat === 'For You') {
        const feed = KJ.buildFeed(JOBS, p, { newIds: ses().newIds });
        if (!feed.featured) inner += emptyFeed('feed');
        else {
          inner += featuredCard(feed.featured, 'Featured opportunity') + feed.sections.map(section).join('') + careerSection();
          if (!feed.sections.some((s) => s.id === 'top')) inner += `<div class="banner" style="margin-top:28px">${icon('info')}<div class="grow"><b>Top Matches appear as you confirm qualifications.</b> Add education, experience and credentials so strong matches can be told apart from ones that need checking.<div class="acts"><a class="btn sm" href="#/profile">Complete profile</a></div></div></div>`;
        }
      } else {
        const f = KJ.categoryFeed(JOBS, p, ses().cat);
        inner += imageSlot(CAT_IMAGE[ses().cat], 'banner');
        inner += !f.featured ? emptyFeed('cat') : featuredCard(f.featured, ses().cat) + (f.rest.length ? `<section class="section"><div class="sec-head"><div class="grow"><h2>More in ${esc(ses().cat)}</h2><p>${A.plural(f.total, 'opportunity', 'opportunities')}, best matches first.</p></div></div><div class="grid">${f.rest.map((j) => card(j)).join('')}</div></section>` : '');
      }
    }
    return shell('discover', p && p.name ? `${g}, ${p.name}` : g, date, inner);
  }

  /* ---------- saved / applications ---------- */
  function rowCard(j, extra, sub) {
    return `<div class="rowcard">${logo(j)}<button class="main" data-open="${j.id}"><h3>${esc(j.title)}</h3><div class="sub">${esc(j.employer)} · ${esc(A.shortWhere(j))} · ${esc(A.pay(j))}${A.payAlt(j) ? ' · ' + esc(A.payAlt(j)) : ''}</div>${sub || ''}${stale(j)}</button><div class="side">${extra}</div></div>`;
  }
  function vSaved() {
    const saved = S().jobs.filter((j) => j.userState.saved).sort((a, b) => b.userState.saved - a.userState.saved), dis = S().jobs.filter((j) => j.userState.dismissed);
    let inner = saved.length ? `<div class="rows">${saved.map((j) => rowCard(j, `${S().apps[j.id] ? `<span class="status">${esc(APP_STATUS[S().apps[j.id].status])}</span>` : `<button class="btn sm" data-action="mark-applied" data-id="${j.id}">Mark applied</button>`}<button class="act" data-action="save" data-id="${j.id}" aria-pressed="true" aria-label="Remove ${esc(j.title)} from saved">${icon('bookmark', 'fill')}</button>`, j.deadline ? `<div class="sub">Deadline ${esc(A.fmtDate(j.deadline))} (${A.rel(A.daysUntil(j.deadline))})</div>` : '')).join('')}</div>`
      : `<div class="empty">${icon('bookmark')}<h2>Nothing saved yet</h2><p>Tap the bookmark on any job to keep it here. Saved jobs are stored in your account.</p><a class="btn primary" href="#/discover">Browse opportunities</a></div>`;
    if (dis.length) inner += `<h2 class="subhead">Not interested (${dis.length})</h2><p class="note">Hidden from your feed. Restore any you dismissed by mistake.</p><div class="rows">${dis.map((j) => rowCard(j, `<button class="btn sm" data-action="restore" data-id="${j.id}">Restore</button>`)).join('')}</div>`;
    return shell('saved', 'Saved', A.plural(saved.length, 'job'), inner);
  }
  function vApplications() {
    const apps = Object.values(S().apps).filter((a) => A.job(a.jobId)).sort((a, b) => b.updatedAt - a.updatedAt);
    const inner = apps.length ? `<p class="note">You track these yourself. Jobgeek never sends an application or résumé to an employer.</p><div class="rows">${apps.map((a) => { const j = A.job(a.jobId), next = (a.interviews || []).filter((i) => i.date && i.date >= new Date().toISOString().slice(0, 10)).sort((x, y) => x.date.localeCompare(y.date))[0];
      return rowCard(j, `<span class="chip-s s-${a.status}">${esc(APP_STATUS[a.status])}</span><button class="btn sm" data-action="track" data-id="${j.id}">Update</button><button class="btn sm" data-action="email-followup" data-id="${j.id}">Follow-up email</button>`, `<div class="sub">${a.appliedOn ? 'Applied ' + esc(A.fmtDate(a.appliedOn)) : 'Not applied yet'}${next ? ' · Interview ' + esc(A.fmtDate(next.date)) : ''}${a.response ? ' · ' + esc(a.response.slice(0, 60)) : ''}</div>`); }).join('')}</div>`
      : `<div class="empty">${icon('check')}<h2>No applications tracked</h2><p>After you apply on an employer’s site, open the job and tap “Mark as applied” to keep track of interviews, responses and notes here.</p><a class="btn primary" href="#/discover">Browse opportunities</a></div>`;
    return shell('applications', 'Applications', A.plural(apps.length, 'application') + ' tracked', inner);
  }

  /* ---------- job detail ---------- */
  const list = (arr, empty) => (arr && arr.length ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="note" style="margin:0">${empty || 'Not listed in the posting'}</p>`);
  function checkList(m, mandatory) {
    const cs = m.qualification.checks.filter((c) => c.mandatory === mandatory); if (!cs.length) return `<p class="note" style="margin:0">None found in the listing data.</p>`;
    const ic = { met: ['met', 'check'], reported: ['unk', 'info'], unknown: ['unk', 'dash'], unmet: ['gap', 'alert'] };
    return `<ul class="status-list">${cs.map((c) => `<li class="${ic[c.status][0]}">${icon(ic[c.status][1])}<span><b>${esc(c.requirement)}</b> — ${esc({ met: 'met', reported: 'reported, needs confirming', unknown: 'unknown', unmet: 'not met' }[c.status])}: ${esc(c.note)}${c.inferred ? ' <em class="note">(detected from the description text — confirm in the original posting)</em>' : ''}</span></li>`).join('')}</ul>`;
  }
  function trackerPanel(j) {
    const a = S().apps[j.id]; if (!a) return '';
    return `<section class="panel"><h2>Your application</h2><dl class="kv"><div><dt>Status</dt><dd>${esc(APP_STATUS[a.status])}</dd></div><div><dt>Applied</dt><dd>${a.appliedOn ? esc(A.fmtDate(a.appliedOn)) : 'Not yet'}</dd></div><div><dt>Employer response</dt><dd>${esc(a.response || '—')}</dd></div></dl>
      ${(a.interviews || []).length ? `<h3>Interviews</h3><ul>${a.interviews.map((i) => `<li>${esc(A.fmtDate(i.date))}${i.note ? ' — ' + esc(i.note) : ''}</li>`).join('')}</ul>` : ''}${a.notes ? `<h3>Notes</h3><p style="white-space:pre-line;margin:0">${esc(a.notes)}</p>` : ''}${a.closedReason ? `<p class="note">Closed: ${esc(a.closedReason)}</p>` : ''}
      <div class="actions"><button class="btn" data-action="track" data-id="${j.id}">${icon('pencil')} Edit tracking</button><button class="btn" data-action="email-followup" data-id="${j.id}">${icon('mail')} Write a follow-up email</button></div></section>`;
  }
  function vJob(id) {
    const j = A.job(id);
    if (!j) return shell('discover', '', 'Job details', `<button class="back" data-action="back">${icon('left')} Back</button><div class="empty">${icon('alert')}<h2>${S().loaded ? 'This listing isn’t available' : 'Loading…'}</h2><p>${S().loaded ? 'It may have been removed or you may have reported it.' : ''}</p><a class="btn primary" href="#/discover">Back to Discover</a></div>`);
    const m = j.match, saved = !!j.userState.saved, app = S().apps[j.id];
    const deadline = j.deadline ? `${A.fmtDate(j.deadline)} (${A.rel(A.daysUntil(j.deadline))})` : 'Not listed';
    const comp = !KJ.annual(j.salaryMin, j.salaryMax, j.salaryPeriod) ? 'Not listed' : j.salaryEstimated ? 'Estimated by the source (not from the employer)' : { hour: 'Hourly wage', year: 'Annual salary', month: 'Monthly', week: 'Weekly' }[j.salaryPeriod];
    const closed = ['expired', 'possibly_expired', 'closed'].includes(j.status);
    const verifyText = { verified: `Seen in a recent search by ${A.providerName(j.provider)} (${A.ago(j.lastVerified)})`, unverified: `Not seen in a search since ${A.fmtTs(j.lastVerified)} — it may no longer be open`, possibly_expired: 'Not seen in recent searches — it may have closed', closed: 'Past its application deadline' }[j.verification];
    const inner = `<button class="back" data-action="back">${icon('left')} Back</button><article class="detail"><header>
      ${closed ? `<div class="banner warn" style="margin-top:0">${icon('alert')}<div class="grow"><b>${j.status === 'expired' ? 'The application deadline has passed.' : 'This listing may have closed.'}</b> Check the original posting before spending time on it.</div></div>` : ''}
      <div class="employer">${logo(j)}<span>${esc(j.employer)}</span> ${isNew(j) ? '<span class="badge-new">New</span>' : ''}</div><h1>${esc(j.title)}</h1>
      <div class="facts"><span>${esc(A.where(j))}</span><span class="pay">${esc(A.pay(j))}${A.payAlt(j) ? ` <span class="pay-alt inline">${esc(A.payAlt(j))}</span>` : ''}</span><span>${esc(j.type || '')}</span></div></header>
      <div class="side"><div class="panel"><div class="rail-actions">${applyButton(j)}${linkNote(j)}
        ${ses().applyNote === j.id ? `<p class="note" role="status" style="color:var(--ink)">The employer’s site opened in a new tab. Nothing was submitted from here — once you’ve applied there yourself, tap “Mark as applied.”</p>` : ''}
        <button class="btn ${saved ? 'on' : ''}" data-action="save" data-id="${j.id}" aria-pressed="${saved}">${icon('bookmark', saved ? 'fill' : '')} ${saved ? 'Saved' : 'Save job'}</button>
        <button class="btn ${app && app.status !== 'interested' ? 'on' : ''}" data-action="${app && app.status !== 'interested' ? 'track' : 'mark-applied'}" data-id="${j.id}">${icon('check')} ${app && app.status !== 'interested' ? `${esc(APP_STATUS[app.status])} · update` : 'Mark as applied'}</button>
        <button class="btn" data-action="dismiss-detail" data-id="${j.id}">${icon('x')} Not interested</button><button class="btn quiet" data-action="report" data-id="${j.id}">${icon('flag')} Report expired or incorrect</button></div></div>
        ${A.emailPanel(j)}
        <div class="panel src-panel"><h2>Source</h2><dl class="kv one"><div><dt>Provider</dt><dd>${esc(A.providerName(j.provider))}</dd></div>${(j.alsoListed || []).length ? `<div><dt>Also listed by</dt><dd>${esc([...new Set(j.alsoListed.map((a) => A.providerName(a.provider)))].join(', '))}</dd></div>` : ''}<div><dt>Published</dt><dd>${j.published ? esc(A.fmtDate(j.published)) : 'Not available'}</dd></div><div><dt>First retrieved</dt><dd>${esc(A.fmtDate(new Date(j.firstSeen).toISOString()))}</dd></div><div><dt>Last verified</dt><dd>${j.lastVerified ? esc(A.fmtTs(j.lastVerified)) : 'Never'}</dd></div></dl>
        <p class="note verify ${j.verification}">${esc(verifyText)}</p></div></div>
      <div class="main-col" style="display:grid;gap:16px;min-width:0">
        <section class="panel"><h2>Why we recommended this</h2><p style="margin:0 0 10px"><b>${esc(KJ.CLASS_LABEL[m.classification])}</b></p>${indicators(m)}
          ${m.reasons.length ? `<ul style="margin-top:12px">${m.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : '<p class="note">Nothing in your profile points to this role yet.</p>'}
          <details class="how"><summary>How is this calculated?</summary><p class="note">${esc(m.explanation)}</p><table class="parts"><tbody>${m.parts.map((p) => `<tr><td>${esc(p.label)}</td><td>${p.weight}%</td><td>${p.score}/100</td></tr>`).join('')}</tbody></table>${m.capped ? '<p class="note">Capped at 60 because a required qualification appears unmet.</p>' : ''}</details></section>
        <section class="panel"><h2>Your qualifications</h2><h3>Required</h3>${checkList(m, true)}<h3>Preferred</h3>${checkList(m, false)}
          <h3>Qualifications you appear to meet</h3>${m.meets.length ? list(m.meets) : '<p class="note" style="margin:0">None confirmed yet.</p>'}
          <h3>Reported by you, needs confirming</h3>${m.unverified && m.unverified.length ? list(m.unverified) : '<p class="note" style="margin:0">Nothing waiting on confirmation.</p>'}
          <h3>Still unknown</h3>${m.unknown.length ? list(m.unknown) : '<p class="note" style="margin:0">Nothing left to verify.</p>'}
          <h3>Potential gaps</h3>${m.gaps.length ? list(m.gaps) : '<p class="note" style="margin:0">No unmet requirements found in the listing data.</p>'}
          <p class="note"><a href="#/profile">Update your profile</a> and this is re-evaluated automatically.</p></section>
        ${trackerPanel(j)}
        <section class="panel"><h2>At a glance</h2><dl class="kv"><div><dt>Location</dt><dd>${esc(A.where(j))}</dd></div><div><dt>Work arrangement</dt><dd>${esc(j.arrangement || 'Not stated')}</dd></div><div><dt>Salary</dt><dd class="pay">${esc(A.pay(j))}${A.payAlt(j) ? `<span class="pay-alt">${esc(A.payAlt(j))}</span>` : ''}</dd></div><div><dt>Compensation type</dt><dd>${esc(comp)}</dd></div><div><dt>Employment type</dt><dd>${esc(j.type || 'Not listed')}</dd></div><div><dt>Application deadline</dt><dd>${esc(deadline)}</dd></div></dl></section>
        <section class="panel"><h2>Listing details</h2><span class="label-tag">${j.provider === 'import' ? 'From your imported file' : 'Text provided by ' + esc(A.providerName(j.provider)) + ' — may be an excerpt'}</span>
          ${j.description ? `<p class="desc">${esc(j.description)}</p>` : '<p class="note">No description was provided. Open the original listing for details.</p>'}
          <h3>Required qualifications (as listed)</h3>${list(j.required)}<h3>Preferred qualifications (as listed)</h3>${list(j.preferred)}
          <h3>Education</h3><p style="margin:0">${j.education ? esc(KJ.EDU_LABEL[j.education.level]) + (j.education.preferred ? ' (preferred)' : '') + (j.education.inferred ? ' — detected from the description' : '') : '<span class="note">Not listed</span>'}</p>
          <h3>Experience</h3><p style="margin:0">${j.experience ? esc(j.experience.years + '+ years' + (j.experience.field ? ' in ' + j.experience.field.toLowerCase() : '') + (j.experience.preferred ? ' (preferred)' : '') + (j.experience.inferred ? ' — detected from the description' : '')) : '<span class="note">Not listed</span>'}</p>
          <h3>Certifications and licenses</h3>${j.certifications.length ? list(j.certifications.map((c) => c.name + (c.required ? ' (required)' : ' (preferred)') + (c.inferred ? ' — detected from the description' : ''))) : '<p class="note" style="margin:0">None found in the listing data</p>'}
          ${j.applyUrl ? `<p class="note"><a href="${esc(j.applyUrl)}" target="_blank" rel="noopener noreferrer">Open the original listing ${icon('ext')}</a></p>` : ''}</section>
      </div></article>`;
    return shell('discover', '', 'Job details', inner);
  }

  /* ---------- profile ---------- */
  const EDU = KJ.EDU_LABEL;
  A.SECTIONS = {
    education: { t: 'Education', sum: (p) => (p.education.length ? p.education.map((e) => `${e.level ? EDU[e.level] : 'Degree level not specified'}${e.field ? ', ' + e.field : ''}${e.status === 'in progress' ? ' (in progress)' : ''}${e.verified === false ? ' — unverified' : ''}`).join(' · ') : 'No education added. Add degrees so education requirements can be checked.') },
    experience: { t: 'Work Experience', sum: (p) => (p.experience.length ? p.experience.map((e) => `${e.title}${e.years ? ' · ' + e.years + ' yr' : ''}`).join(' · ') : 'No work history added. Roles that ask for experience stay “needs verification”.') },
    skills: { t: 'Skills', sum: (p) => (p.skills.length ? p.skills.map((s) => s.name).join(', ') : 'No skills added.') },
    certs: { t: 'Certifications and Licenses', sum: (p) => (p.certs.length ? p.certs.map((c) => c.name + (c.status === 'in progress' ? ' (in progress)' : '')).join(' · ') : p.certsNone ? 'You said you hold none.' : 'Not answered. Jobs that require credentials stay “needs verification”.') },
    resume: { t: 'Résumé', sum: (p) => (p.resume ? `${p.resume.filename} · uploaded ${A.fmtDate(new Date(p.resume.created_at).toISOString())} · private to you` : 'No résumé uploaded. Uploading one only suggests entries for you to review.') },
    prefs: { t: 'Job Preferences', sum: (p) => `${p.titles.length ? 'Titles: ' + p.titles.join(', ') + ' · ' : ''}${p.categories.join(', ') || 'No categories'} · ${p.types.join(', ') || 'Any type'} · ${p.workModes.map((m) => ({ onsite: 'On-site', hybrid: 'Hybrid', remote: 'Remote' }[m])).join(', ')}` },
    location: { t: 'Location', sum: (p) => `${p.cities.join(' › ') || 'No cities'} · within ${p.commuteMiles} miles` },
    salary: { t: 'Salary', sum: (p) => { const f = KJ.profileFloor(p), d = KJ.profileDesired(p); return f === null ? 'No minimum set. Set one so lower-paying jobs stay out of your feed.' : `Minimum ${KJ.fmtMoney(f)}/yr${d ? ' · Desired ' + KJ.fmtMoney(d) + '/yr' : ''}${p.salary.showBelow ? ' · also showing jobs below minimum' : ''}`; } },
    notify: { t: 'Notification Preferences', sum: (p) => { const n = p.notify; return n.enabled ? [n.inApp && 'In app', n.push && 'Push'].filter(Boolean).join(', ') + ' · ' + [n.immediate && 'Immediate', n.daily && 'Daily', n.weekly && 'Weekly'].filter(Boolean).join(', ') + ` · Quiet ${n.quietStart}:00–${n.quietEnd}:00` : 'Notifications off (searching continues)'; } },
  };
  function vProfile() {
    const p = profile(), comp = KJ.completion(p), done = comp.filter((c) => c.done).length, pct = Math.round((done / comp.length) * 100), first = comp.find((c) => !c.done) || comp[0];
    const exYears = p.experience.reduce((s, e) => s + (Number(e.years) || 0), 0), f = KJ.profileFloor(p);
    const inner = imageSlot('professional development', 'banner') + `<section class="panel summary" style="margin-top:12px"><div class="sum-head"><div class="ring" style="--p:${pct}" role="img" aria-label="${pct}% complete"><span>${pct}%</span></div>
      <div class="grow"><h2>${p.name ? esc(p.name) : 'Your profile'}</h2><div class="note" style="margin:2px 0 0">${done} of ${comp.length} sections complete · revision ${p.revision} · <button class="btn quiet sm" data-action="edit" data-sec="basics" style="min-height:32px">${p.name ? 'Edit name' : 'Add your name'}</button></div></div>
      <button class="btn primary" data-action="edit" data-sec="${first.id}">${icon('pencil')} Edit Profile</button></div>
      <div><h3 class="used-h">Currently used for matching</h3><div class="used"><div><b>Preferred titles</b>${esc(p.titles.join(', ') || '—')}</div><div><b>Categories</b>${esc(p.categories.join(', ') || '—')}</div><div><b>Education</b>${p.education.length ? esc(p.education.map((e) => (e.level ? EDU[e.level] : 'Level unspecified') + (e.field ? ' — ' + e.field : '') + (e.verified === false ? ' (unverified)' : '')).join('; ')) : 'Not added'}</div><div><b>Experience</b>${p.experience.length ? `${exYears} yr across ${A.plural(p.experience.length, 'role')}` : 'Not added'}</div><div><b>Credentials</b>${p.certs.length ? esc(p.certs.map((c) => c.name).join(', ')) : p.certsNone ? 'None held' : 'Not answered'}</div><div><b>Locations</b>${esc(p.cities.join(', ') || '—')} (${p.commuteMiles} mi)</div><div><b>Salary</b>${f ? 'Min ' + KJ.fmtMoney(f) + '/yr' : 'No minimum set'}</div><div><b>Work style</b>${esc(p.workModes.join(', '))}</div></div></div>
      ${p.education.some((e) => e.verified === false) ? `<div class="banner warn" style="margin-bottom:0">${icon('alert')}<div class="grow"><b>${A.plural(p.education.filter((e) => e.verified === false).length, 'education entry', 'education entries')} need your review.</b> They came from information provided to us and are treated as <i>reported, not confirmed</i> until you confirm or correct them. Nothing here is assumed to be a teaching credential or license.<div class="acts"><button class="btn sm primary" data-action="edit" data-sec="education">Review education</button></div></div></div>` : ''}
      <p class="note priv">${icon('lock')} Only job titles, categories and city names are sent to job sources — never your name, email, résumé or employers.</p></section>
      ${resumePanel()}
      <div class="sections">${comp.filter((c) => c.id !== 'resume').map((c) => { const m = A.SECTIONS[c.id]; return `<section class="sec-card"><div class="row1"><h3>${m.t}</h3>${c.done ? `<span class="status">${icon('check')}Complete</span>` : `<span class="status todo">${icon('dash')}Needs info</span>`}</div><p>${esc(m.sum(p))}</p><div class="actions"><button class="btn sm" data-action="edit" data-sec="${c.id}" aria-label="Edit ${m.t}">${c.done ? 'Edit' : 'Add info'}</button></div></section>`; }).join('')}</div>
      <section class="panel" style="margin-top:18px"><h2>Your data</h2><p class="note" style="margin-top:0">Your profile and résumé are visible only to you. You can remove them at any time.</p><div class="actions"><a class="btn" href="#/settings">Settings</a><button class="btn danger" data-action="delete-profile">Delete my profile data</button><button class="btn danger" data-action="delete-account">Delete my account</button></div></section>`;
    return shell('profile', 'My Profile', 'Used to personalize your feed', inner);
  }

  /* ---------- settings ---------- */
  function vSettings() {
    const th = localStorage.getItem('kj.theme') || 'auto', pr = S().providers, cfg = S().config;
    const rows = pr.map((p) => `<div class="panel prov"><div class="row1"><h3>${esc(p.name)}</h3>${p.configured ? `<span class="status">${icon('check')}Configured</span>` : `<span class="status todo">${icon('dash')}Needs setup</span>`}</div>
      ${p.kind === 'import' ? `<p class="note">${A.plural(p.jobCount, 'listing')} imported from files you provided.</p>` : p.configured ? `<p class="note">${A.plural(p.jobCount, 'listing')} stored · ${p.callsToday}/${p.budget} requests used in the last 24 h${p.lastSuccess ? ' · last successful search ' + esc(A.ago(p.lastSuccess)) : ' · no successful search yet'}</p>${p.lastError ? `<p class="note bad">Last error: ${esc(p.lastError)}</p>` : ''}` : `<p class="note">Missing: <code>${esc((p.missing || []).join(', '))}</code></p><details><summary>Setup steps</summary><ol>${p.setup.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></details><p class="note"><a href="${esc(p.docs)}" target="_blank" rel="noopener noreferrer">Official documentation ${icon('ext')}</a></p>`}</div>`).join('');
    const inner = `<section class="panel" style="margin-top:12px"><h2>Job sources</h2><p class="note" style="margin-top:0">Jobgeek searches only the sources below, through their permitted APIs or feeds. No single source covers every job on the web.</p>${rows}
      <div class="actions"><button class="btn primary" data-action="search-now">${icon('refresh')} Search now</button><button class="btn" data-action="import-open">Import listings (JSON)</button><button class="btn quiet" data-action="download-template">Download template</button></div></section>
      <section class="panel" style="margin-top:14px"><h2>Notifications and photos</h2><dl class="kv"><div><dt>Web push</dt><dd>${cfg.pushPublicKey ? (Notification && Notification.permission === 'granted' ? 'Allowed in this browser' : 'Available — enable below') : 'Not configured on this server'}</dd></div><div><dt>Editorial photos (Pexels)</dt><dd>${cfg.imagery && cfg.imagery.configured ? 'Configured' : 'Not configured'}</dd></div></dl>
        <div class="actions">${cfg.pushPublicKey ? '<button class="btn" data-action="enable-push">Enable push on this device</button><button class="btn quiet" data-action="disable-push">Turn off on this device</button>' : ''}<a class="btn quiet" href="#/profile">Notification preferences</a></div>
        <p class="note">Push is only confirmed to work once it has been tested on your own device in the deployed app.</p></section>
      <section class="panel" style="margin-top:14px"><h2>Appearance and account</h2><div class="field" style="max-width:280px"><label for="textsize">Text size</label><select id="textsize" data-action="textsize"><option value="normal" ${textSize() === 'normal' ? 'selected' : ''}>Normal</option><option value="large" ${textSize() === 'large' ? 'selected' : ''}>Large</option><option value="xlarge" ${textSize() === 'xlarge' ? 'selected' : ''}>Extra large</option></select></div><div class="field" style="max-width:280px"><label for="theme">Theme</label><select id="theme" data-action="theme"><option value="auto" ${th === 'auto' ? 'selected' : ''}>Match device</option><option value="light" ${th === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${th === 'dark' ? 'selected' : ''}>Dark</option></select></div><p class="note">Signed in as ${esc(S().user.email)}</p><div class="actions"><button class="btn" data-action="logout">Sign out</button></div></section>`;
    return shell('settings', 'Settings', 'Sources, alerts and account', inner);
  }

  /* ---------- sign in ---------- */
  function vAuth() {
    const mode = ses().authMode || 'login';
    return `<div class="authwrap"><form class="authcard" data-form="auth" data-mode="${mode}"><div class="brand big" aria-hidden="true">K</div><h1>${mode === 'login' ? 'Sign in' : 'Create your account'}</h1><p class="note">Your profile, résumé and saved jobs are private to your account.</p>
      <div class="field"><label for="em">Email</label><input id="em" name="email" type="email" autocomplete="email" required></div><div class="field"><label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" minlength="${mode === 'login' ? 1 : 10}" required><span class="note">${mode === 'login' ? '' : 'At least 10 characters.'}</span></div>
      <p class="form-error" role="alert" hidden></p><button class="btn primary" type="submit" style="width:100%">${mode === 'login' ? 'Sign in' : 'Create account'}</button>
      <p class="note center"><button type="button" class="btn quiet" data-action="auth-mode">${mode === 'login' ? 'Create an account' : 'I already have an account'}</button></p></form></div>`;
  }

  A.views = { discover: vDiscover, saved: vSaved, applications: vApplications, profile: vProfile, settings: vSettings, job: vJob, auth: vAuth, card, featuredCard };
})();
