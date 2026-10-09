/* UI: routing, rendering, events. Depends on KJ.match / KJ.store / KJ.sampleJobs. */
(function () {
  'use strict';
  const KJ = window.KJ;
  const { store } = KJ;

  let state = store.load();
  const session = { newIds: new Set(), cat: 'For You', q: '', loading: false, error: '', notesOpen: false, applyNote: '', refreshNote: null, lastFocus: null };

  /* ---------- helpers ---------- */
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const persist = () => store.save(state);
  const active = () => state.applied || state.profile;
  const byId = (id) => state.jobs.find((j) => j.id === id);
  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', left: '<path d="m15 5-7 7 7 7"/>', right: '<path d="m9 5 7 7-7 7"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>', compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>', ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/>', flag: '<path d="M5 21V4h11l-1 4 1 4H5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>', pencil: '<path d="m4 20 1-4L16 5l3 3L8 19z"/>',
    alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>', plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>', plus: '<path d="M12 5v14M5 12h14"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>', dash: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>', refresh: '<path d="M20 11a8 8 0 1 0-2 6"/><path d="M20 4v7h-7"/>',
  };
  const icon = (n, cls) => `<svg class="i ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
  const fmtDate = (s) => { if (!s) return ''; const d = new Date(s + 'T12:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
  const daysUntil = (s) => Math.ceil((new Date(s + 'T23:59:59').getTime() - Date.now()) / 864e5);
  const rel = (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : n > 0 ? `in ${n} days` : `${-n} days ago`);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const initials = (n) => n.replace(/^(the|example)\s+/i, '').split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
  const where = (j) => (j.remote ? (j.arrangement || 'Remote') : [j.neighborhood && j.neighborhood !== j.city ? j.neighborhood : '', j.city].filter(Boolean).join(', ') || 'Location not listed');
  const shortWhere = (j) => (j.remote ? 'Remote' : j.neighborhood || j.city || 'Location not listed');
  const pay = (j) => KJ.salaryText(j) || 'Salary not listed';
  const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
  const ctx = () => ({ newIds: session.newIds });
  const evalJob = (j) => KJ.evaluate(j, active());

  function logo(j, big) {
    const img = j.logoUrl ? `<img src="${esc(j.logoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
    return `<span class="mono">${img || esc(initials(j.employer))}</span>`;
  }
  const hue = (str) => { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  function art(j, cls) {
    const img = j.logoUrl ? `<img src="${esc(j.logoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
    return `<div class="art ${cls || ''}" style="--h:${hue(j.employer)}" aria-hidden="true">${img || `<span class="wm">${esc(j.employer.replace(/^example\s+/i, ''))}</span>`}</div>`;
  }
  const sampleTag = (j) => (j.sample ? '<span class="badge-sample">Sample</span>' : '');

  function matchBadge(ev) {
    const n = KJ.LEVEL_BARS[ev.level];
    return `<span class="match ${ev.level}" title="Based only on what is in your profile"><span class="bars" aria-hidden="true">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>${KJ.LEVEL_LABEL[ev.level]}</span>`;
  }
  function jobButtons(j, cls) {
    const s = !!state.saved[j.id];
    return `<button class="${cls || 'act'}" data-action="save" data-id="${esc(j.id)}" aria-pressed="${s}" aria-label="${s ? 'Remove from saved' : 'Save job'}: ${esc(j.title)}">${icon('bookmark', s ? 'fill' : '')}</button>` +
      `<button class="${cls || 'act'}" data-action="dismiss" data-id="${esc(j.id)}" aria-label="Not interested: ${esc(j.title)}">${icon('x')}</button>`;
  }

  /* ---------- cards ---------- */
  function card({ job: j, ev }, variant) {
    const isNew = session.newIds.has(j.id);
    const blurb = variant === 'wide' ? (ev.reasons[0] ? ev.reasons.slice(0, 2).join('. ') + '.' : j.summary) : '';
    const more = j.remote ? 'Remote' : (j.categories || [])[0] || 'Nearby';
    const tags = j.sample || isNew ? `<div class="tags">${sampleTag(j)}${isNew ? '<span class="badge-new">New</span>' : ''}</div>` : '';
    return `<article class="card ${variant || ''}" data-job="${esc(j.id)}">
      <a class="open" href="#/job/${encodeURIComponent(j.id)}" aria-label="${esc(j.title)}, ${esc(j.employer)}"></a>
      ${variant === 'compact' ? '' : `<div class="artwrap">${art(j)}${tags}</div>`}
      <div class="employer">${esc(j.employer)}${variant === 'compact' ? ' ' + sampleTag(j) + (isNew ? ' <span class="badge-new">New</span>' : '') : ''}</div>
      <h3>${esc(j.title)}</h3>
      <div class="meta">${esc(shortWhere(j))}${j.type ? ' · ' + esc(j.type) : ''}</div>
      <div class="pay">${esc(pay(j))}</div>
      ${blurb ? `<p class="blurb">${esc(blurb)}</p>` : ''}
      <div>${matchBadge(ev)}</div>
      <div class="foot"><button class="pill" data-action="more" data-cat="${esc(more)}">More in ${esc(more)}</button><span class="grow"></span>${jobButtons(j)}</div>
    </article>`;
  }

  function featuredCard({ job: j, ev }, label) {
    const isNew = session.newIds.has(j.id);
    const why = ev.reasons.length ? ev.reasons.slice(0, 3) : [];
    const apply = j.url ? `<a class="btn primary" href="${esc(j.url)}" target="_blank" rel="noopener noreferrer" data-action="apply-opened" data-id="${esc(j.id)}">Apply on employer site ${icon('ext')}</a>`
      : `<span class="btn primary" aria-disabled="true">${j.sample ? 'Sample listing — no link' : 'No application link'}</span>`;
    const saved = !!state.saved[j.id];
    const dl = j.deadline ? fmtDate(j.deadline) : 'Not listed';
    return `<article class="featured" data-open="${esc(j.id)}">
      <div class="body">
        <div class="eyebrow-line">${esc(label || 'Featured')} ${isNew ? '<span class="badge-new">New</span>' : ''} ${sampleTag(j)}</div>
        <h2><a href="#/job/${encodeURIComponent(j.id)}" style="text-decoration:none">${esc(j.title)}</a></h2>
        <div class="employer">${esc(j.employer)}</div>
        <dl class="stats"><div><dt>Salary</dt><dd>${esc(pay(j))}</dd></div><div><dt>Location</dt><dd>${esc(shortWhere(j))}</dd></div><div><dt>Type</dt><dd>${esc(j.type || '—')}</dd></div><div><dt>Deadline</dt><dd>${esc(dl)}</dd></div></dl>
        <a class="mini" href="#/job/${encodeURIComponent(j.id)}">${logo(j)}<span><small>View details</small><b>${esc(j.title)}</b></span>${icon('right')}</a>
        <div class="actions">${apply}
          <button class="btn glass" data-action="save" data-id="${esc(j.id)}" aria-pressed="${saved}">${icon('bookmark', saved ? 'fill' : '')} ${saved ? 'Saved' : 'Save'}</button>
          <button class="btn glass" data-action="dismiss" data-id="${esc(j.id)}">${icon('x')} Not interested</button></div>
        <p class="why">${esc(why.length ? 'Why it’s here: ' + why[0].replace(/^./, (c) => c.toLowerCase()) + '.' : j.summary || 'Shown because nothing ranks higher right now.')}</p>
        <div class="explain"><b>${KJ.LEVEL_LABEL[ev.level]} — match explanation</b><ul>${(why.length ? why : ['No confirmed matches yet — add details to your profile']).map((r) => `<li>${esc(r)}</li>`).join('')}${ev.unknown.length ? `<li>Still to verify: ${esc(ev.unknown[0])}</li>` : ''}${ev.gaps.length ? `<li>Possible gap: ${esc(ev.gaps[0])}</li>` : ''}</ul></div>
      </div>
      <div class="visual">${art(j, 'big')}</div>
    </article>`;
  }

  function section(sec) {
    const cards = sec.items.map((it, i) => card(it, sec.wide && i < sec.wide ? 'wide' : sec.compact ? 'compact' : '')).join('');
    return `<section class="section" aria-labelledby="h-${sec.id}">
      <div class="sec-head"><div class="grow"><h2 id="h-${sec.id}">${esc(sec.title)}</h2>${sec.blurb ? `<p>${esc(sec.blurb)}</p>` : ''}</div>
      <div class="rail-nav"><button data-action="rail" data-dir="-1" data-target="rail-${sec.id}" aria-label="Scroll ${esc(sec.title)} back">${icon('left')}</button><button data-action="rail" data-dir="1" data-target="rail-${sec.id}" aria-label="Scroll ${esc(sec.title)} forward">${icon('right')}</button></div></div>
      <div class="rail" id="rail-${sec.id}" data-rail="${sec.id}">${cards}</div></section>`;
  }

  /* ---------- shell ---------- */
  function notifications() {
    const n = [], p = state.profile.notify;
    const feed = KJ.buildFeed(state, active(), ctx());
    if (p.newMatches) {
      const fresh = feed.forYou.filter((x) => session.newIds.has(x.job.id) && (x.ev.level === 'strong' || x.ev.level === 'good'));
      if (fresh.length) n.push({ id: 'new' + fresh.length, t: `${plural(fresh.length, 'new job')} match you`, d: fresh.slice(0, 3).map((x) => x.job.title).join(', '), href: '#/discover' });
    }
    if (p.deadlines) Object.keys(state.saved).map(byId).filter(Boolean).forEach((j) => { if (j.deadline && !state.appliedJobs[j.id]) { const d = daysUntil(j.deadline); if (d >= 0 && d <= 7) n.push({ id: 'dl' + j.id, t: `Deadline ${rel(d)}`, d: `${j.title} · ${j.employer}`, href: '#/job/' + encodeURIComponent(j.id) }); } });
    if (p.sourceIssues) {
      if (!state.sources.length) n.push({ id: 'nosrc', t: 'No job source connected', d: 'Import listings to start your feed.', href: '#/settings' });
      state.sources.forEach((s) => { const st = sourceStatus(s); if (st.kind !== 'ok') n.push({ id: 'src' + s.id + st.kind, t: `${s.name}: ${st.label}`, d: st.detail, href: '#/settings' }); });
    }
    if (pending().length) n.push({ id: 'pend' + pending().length, t: 'Profile changes not applied yet', d: 'Review them to refresh your feed.', href: '#/profile' });
    return n;
  }
  const notesSig = () => notifications().map((x) => x.id).join('|');

  function sourceStatus(s) {
    if (s.status === 'error') return { kind: 'error', label: 'Error', detail: s.error || 'The last update failed.' };
    const age = (Date.now() - s.lastSync) / 864e5;
    if (s.kind !== 'sample' && age > 7) return { kind: 'stale', label: 'Out of date', detail: `Last updated ${Math.floor(age)} days ago. Listings may have closed.` };
    return { kind: 'ok', label: 'Connected', detail: `Last updated ${new Date(s.lastSync).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` };
  }

  function shell(route, title, eyebrow, inner, opts) {
    opts = opts || {};
    const nav = [['discover', 'Discover', 'compass'], ['saved', 'Saved', 'bookmark'], ['applications', 'Applications', 'check'], ['profile', 'Profile', 'user']];
    const sig = notesSig(), unread = sig && state.notesSeen !== sig;
    const nm = state.profile.name;
    const notes = session.notesOpen ? `<div class="pop" role="dialog" aria-label="Notifications">${notifications().map((x) => `<a class="item" style="display:block;text-decoration:none" href="${x.href}" data-action="close-pop"><b>${esc(x.t)}</b><span style="color:var(--muted)">${esc(x.d)}</span></a>`).join('') || '<div class="item"><b>You’re all caught up</b><span style="color:var(--muted)">Nothing needs your attention.</span></div>'}<a class="item" style="display:block;text-decoration:none;color:var(--accent);font-weight:600" href="#/profile" data-action="close-pop">Notification preferences</a></div>` : '';
    return `<div class="shell"><nav class="nav" aria-label="Primary"><div class="brand" aria-hidden="true">K</div>
      ${nav.map(([r, l, ic]) => `<a href="#/${r}" ${route === r ? 'aria-current="page"' : ''}>${icon(ic)}<span>${l}</span></a>`).join('')}</nav>
      <main id="main"><div class="topbar"><div class="titles"><div class="eyebrow">${esc(eyebrow)}</div>${title ? `<h1 class="page">${esc(title)}</h1>` : ''}</div>
      ${opts.search ? `<form class="search" role="search" data-form="search"><span class="sr"><label for="q">Search jobs</label></span>${icon('search')}<input id="q" type="search" placeholder="Search jobs" value="${esc(session.q)}" autocomplete="off" enterkeyhint="search">${session.q ? `<button type="button" class="clear" data-action="clear-search" aria-label="Clear search">${icon('x')}</button>` : ''}</form>` : ''}
      <div class="tools"><button class="icon-btn" data-action="notes" aria-label="Notifications${unread ? ' (new)' : ''}" aria-expanded="${session.notesOpen}">${icon('bell')}${unread ? '<span class="dot"></span>' : ''}</button>${notes}</div>
      <a class="icon-btn" href="#/profile" aria-label="Your profile"><span class="avatar">${nm ? esc(nm[0].toUpperCase()) : icon('user')}</span></a>
      <a class="icon-btn" href="#/settings" aria-label="Settings">${icon('gear')}</a></div>
      ${inner}</main></div>`;
  }

  /* ---------- discover ---------- */
  function sourceBanners(profileOnly) {
    let h = '';
    if (!profileOnly && session.error) h += `<div class="banner warn" role="alert">${icon('alert')}<div class="grow"><b>Couldn’t load listings.</b> ${esc(session.error)}<div class="acts"><button class="btn sm" data-action="import-open">Try another file</button><button class="btn sm quiet" data-action="dismiss-error">Dismiss</button></div></div></div>`;
    if (!profileOnly && state.sources.some((s) => s.kind === 'sample')) h += `<div class="banner warn">${icon('info')}<div class="grow"><b>You’re previewing sample listings.</b> These are fictional examples to show how the app works. They are not real vacancies and can’t be applied to.<div class="acts"><button class="btn sm" data-action="import-open">Import real listings</button><button class="btn sm quiet" data-action="remove-source" data-id="sample">Remove samples</button></div></div></div>`;
    if (!profileOnly) state.sources.forEach((s) => { const st = sourceStatus(s); if (st.kind !== 'ok') h += `<div class="banner warn">${icon('plug')}<div class="grow"><b>${esc(s.name)} — ${st.label.toLowerCase()}.</b> ${esc(st.detail)}<div class="acts"><button class="btn sm" data-action="import-open">Import updated file</button></div></div></div>`; });
    if (session.refreshNote) h += `<div class="banner ok" role="status">${icon('refresh')}<div class="grow"><b>Job search refreshed with your updated profile.</b> ${esc(session.refreshNote.summary)}<div class="acts"><button class="btn sm quiet" data-action="dismiss-refresh">Dismiss</button></div></div></div>`;
    const pend = pending();
    if (pend.length) h += `<div class="banner">${icon('pencil')}<div class="grow"><b>${plural(pend.length, 'profile change')} saved but not applied.</b> Your feed still uses your previous profile.<div class="acts"><button class="btn sm primary" data-action="review-changes">Review and refresh</button></div></div></div>`;
    return h;
  }

  function emptyNoSource() {
    return `<div class="empty">${icon('plug')}<h2>No job source connected</h2><p>This app doesn’t invent listings. It ranks real job postings that you bring in, and it keeps every match honest about what it can and can’t verify.</p>
      <div class="actions"><button class="btn primary" data-action="import-open">Import job listings (JSON)</button><button class="btn" data-action="import-sample">Preview with sample listings</button></div>
      <p class="note">Need the format? <button class="btn quiet sm" data-action="download-template">Download a template</button></p></div>`;
  }
  function emptyFeed(reason) {
    const p = active();
    const msgs = {
      search: ['No jobs found', 'Try a different title, employer or city.'],
      cat: ['Nothing here yet', 'No current listings fit this category and your salary minimum. Check back after your next update, or adjust your preferences.'],
      feed: ['Nothing matches your profile right now', `Nothing currently meets your preferences${KJ.profileFloor(p) ? ' and ' + KJ.fmtMoney(KJ.profileFloor(p)) + ' minimum salary' : ''}. You can broaden your locations or interests, or add more listings.`],
    }[reason];
    return `<div class="empty">${icon('compass')}<h2>${msgs[0]}</h2><p>${msgs[1]}</p><div class="actions">${reason === 'search' ? '<button class="btn" data-action="clear-search">Clear search</button>' : '<a class="btn primary" href="#/profile">Review preferences</a><button class="btn" data-action="import-open">Import listings</button>'}</div></div>`;
  }

  function skeleton() {
    return `<div class="skeleton" aria-busy="true" aria-label="Loading listings"><div class="sk" style="height:300px;margin:12px 0 30px"></div><div class="sk" style="height:26px;width:220px;margin-bottom:14px"></div><div style="display:flex;gap:14px;overflow:hidden">${'<div class="sk" style="flex:none;width:280px;height:232px"></div>'.repeat(4)}</div></div>`;
  }

  function vDiscover() {
    const p = active();
    const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const title = state.profile.name ? `${greeting()}, ${state.profile.name}` : greeting();
    let inner = sourceBanners();
    if (session.loading) inner += skeleton();
    else if (!state.jobs.length) inner += emptyNoSource();
    else {
      const chips = KJ.chips(p);
      if (!chips.includes(session.cat)) session.cat = 'For You';
      inner += `<div class="chips" role="group" aria-label="Categories">${chips.map((c) => `<button class="chip" data-action="cat" data-cat="${esc(c)}" aria-pressed="${session.cat === c}">${esc(c)}</button>`).join('')}</div>`;
      if (session.q.trim()) {
        const res = KJ.search(state, p, session.q);
        inner += `<div class="sec-head" style="margin-top:20px"><div class="grow"><h2>${plural(res.length, 'result')} for “${esc(session.q.trim())}”</h2><p>Search covers every listing you haven’t dismissed, including ones below your salary minimum.</p></div></div>`;
        inner += res.length ? `<div class="grid">${res.map((x) => card(x)).join('')}</div>` : emptyFeed('search');
      } else if (session.cat === 'For You') {
        const feed = KJ.buildFeed(state, p, ctx());
        if (!feed.featured) inner += emptyFeed('feed');
        else {
          inner += featuredCard(feed.featured, 'Featured opportunity');
          inner += feed.sections.map(section).join('');
          if (!feed.sections.some((s) => s.id === 'top')) inner += `<div class="banner" style="margin-top:28px">${icon('info')}<div class="grow"><b>Top Matches will appear as you confirm qualifications.</b> Add your education, experience and credentials so strong matches can be told apart from ones that need checking.<div class="acts"><a class="btn sm" href="#/profile">Complete profile</a></div></div></div>`;
        }
      } else {
        const f = KJ.categoryFeed(state, p, session.cat, ctx());
        if (!f.featured) inner += emptyFeed('cat');
        else inner += featuredCard(f.featured, session.cat) + (f.rest.length ? `<section class="section"><div class="sec-head"><div class="grow"><h2>More in ${esc(session.cat)}</h2><p>${plural(f.total, 'opportunity').replace('opportunitys', 'opportunities')}, best matches first.</p></div></div><div class="grid">${f.rest.map((x) => card(x)).join('')}</div></section>` : '');
      }
    }
    return shell('discover', title, date, inner, { search: true });
  }

  /* ---------- job lists ---------- */
  function rowCard(j, extra) {
    return `<div class="rowcard">${logo(j)}<button class="main" data-open="${esc(j.id)}"><h3>${esc(j.title)} ${sampleTag(j)}</h3><div class="sub">${esc(j.employer)} · ${esc(shortWhere(j))} · ${esc(pay(j))}</div>${j.deadline ? `<div class="sub">Deadline ${fmtDate(j.deadline)} (${rel(daysUntil(j.deadline))})</div>` : ''}${j.orphan ? '<div class="sub">Source removed — details may be out of date</div>' : ''}</button><div class="side">${extra}</div></div>`;
  }
  function vSaved() {
    const saved = Object.keys(state.saved).sort((a, b) => state.saved[b] - state.saved[a]).map(byId).filter(Boolean);
    const dis = Object.keys(state.dismissed).map(byId).filter(Boolean);
    let inner = saved.length ? `<div class="rows">${saved.map((j) => rowCard(j, `${state.appliedJobs[j.id] ? '<span class="status">Applied</span>' : `<button class="btn sm" data-action="mark-applied" data-id="${esc(j.id)}">Mark applied</button>`}<button class="act" data-action="save" data-id="${esc(j.id)}" aria-pressed="true" aria-label="Remove ${esc(j.title)} from saved">${icon('bookmark', 'fill')}</button>`)).join('')}</div>`
      : `<div class="empty">${icon('bookmark')}<h2>Nothing saved yet</h2><p>Tap the bookmark on any job to keep it here. Saved jobs stay on this device until you remove them.</p><a class="btn primary" href="#/discover">Browse opportunities</a></div>`;
    if (dis.length) inner += `<h2 class="subhead">Not interested (${dis.length})</h2><p class="note">Hidden from your feed. Restore any you dismissed by mistake.</p><div class="rows">${dis.map((j) => rowCard(j, `<button class="btn sm" data-action="restore" data-id="${esc(j.id)}">Restore</button>`)).join('')}</div>`;
    return shell('saved', 'Saved', `${plural(saved.length, 'job')}`, inner);
  }
  const APP_STATUS = ['Applied', 'Interviewing', 'Offer', 'Not selected', 'Withdrawn'];
  function vApplications() {
    const ids = Object.keys(state.appliedJobs).sort((a, b) => state.appliedJobs[b].date.localeCompare(state.appliedJobs[a].date));
    const inner = ids.length ? `<p class="note">These are applications you marked yourself. Opening an employer’s website never counts as applying.</p><div class="rows">${ids.map((id) => { const a = state.appliedJobs[id], j = byId(id); if (!j) return ''; return rowCard(j, `<span class="sub">Applied ${fmtDate(a.date)}</span><label class="sr" for="st-${esc(id)}">Status</label><select id="st-${esc(id)}" data-action="app-status" data-id="${esc(id)}">${APP_STATUS.map((s) => `<option ${a.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select><button class="btn sm quiet danger" data-action="unapply" data-id="${esc(id)}">Remove</button>`); }).join('')}</div>`
      : `<div class="empty">${icon('check')}<h2>No applications tracked</h2><p>After you apply on an employer’s site, open the job and tap “Mark as applied” to keep track of it here.</p><a class="btn primary" href="#/discover">Browse opportunities</a></div>`;
    return shell('applications', 'Applications', `${plural(ids.length, 'application')} tracked`, inner);
  }

  /* ---------- detail ---------- */
  function listOrNone(arr, empty) { return arr && arr.length ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="note" style="margin:0">${empty || 'Not listed in the posting'}</p>`; }
  function vJob(id) {
    const j = byId(id);
    if (!j) return shell('discover', 'Job not found', '', `<div class="empty">${icon('alert')}<h2>This listing isn’t available</h2><p>It may have been removed along with its source.</p><a class="btn primary" href="#/discover">Back to Discover</a></div>`);
    const ev = evalJob(j), saved = !!state.saved[id], applied = state.appliedJobs[id], rep = state.reported[id];
    const dl = j.deadline ? `${fmtDate(j.deadline)} (${rel(daysUntil(j.deadline))})` : 'Not listed';
    const comp = j.salaryPeriod === 'hour' ? 'Hourly wage' : j.salaryPeriod === 'year' ? 'Annual salary' : j.salaryPeriod === 'month' ? 'Monthly' : 'Weekly';
    const applyBtn = j.url ? `<a class="btn primary" href="${esc(j.url)}" target="_blank" rel="noopener noreferrer" data-action="apply-opened" data-id="${esc(id)}">Apply on employer’s website ${icon('ext')}</a>` : `<span class="btn primary" aria-disabled="true">${j.sample ? 'Sample listing — no application link' : 'No application link provided'}</span>`;
    const st = (cls, ic, t) => `<li class="${cls}">${icon(ic)}<span>${esc(t)}</span></li>`;
    const eduReq = j.education ? KJ.EDU_LABEL[j.education.level] + (j.education.note ? ' — ' + j.education.note : '') : '';
    const expReq = j.experience ? `${j.experience.years}+ years${j.experience.field ? ' in ' + j.experience.field.toLowerCase() : ''}${j.experience.note ? ' — ' + j.experience.note : ''}` : '';
    const inner = `<button class="back" data-action="back">${icon('left')} Back</button>
      <article class="detail"><header>
        ${j.sample ? '<div class="banner warn" style="margin-top:0">' + icon('info') + '<div class="grow"><b>Sample listing.</b> Fictional example, not a real vacancy.</div></div>' : ''}
        <div class="employer">${logo(j)}<span>${esc(j.employer)}</span> ${session.newIds.has(id) ? '<span class="badge-new">New</span>' : ''}</div>
        <h1>${esc(j.title)}</h1><div class="facts"><span>${esc(where(j))}</span><span class="pay">${esc(pay(j))}</span><span>${esc(j.type || '')}</span></div></header>
      <div class="side"><div class="panel"><div class="rail-actions">${applyBtn}
        ${session.applyNote === id ? `<p class="note" role="status" style="color:var(--ink)">We opened the employer’s site. Nothing has been submitted from here — once you’ve applied there, tap “Mark as applied.”</p>` : ''}
        <button class="btn ${saved ? 'on' : ''}" data-action="save" data-id="${esc(id)}" aria-pressed="${saved}">${icon('bookmark', saved ? 'fill' : '')} ${saved ? 'Saved' : 'Save job'}</button>
        <button class="btn ${applied ? 'on' : ''}" data-action="${applied ? 'unapply' : 'mark-applied'}" data-id="${esc(id)}">${icon('check')} ${applied ? `Marked applied ${fmtDate(applied.date)} · Undo` : 'Mark as applied'}</button>
        <button class="btn" data-action="dismiss-detail" data-id="${esc(id)}">${icon('x')} Not interested</button>
        <button class="btn quiet" data-action="report" data-id="${esc(id)}">${icon('flag')} Report expired or incorrect</button></div>
        ${rep ? '<p class="note">You reported this listing. It is hidden from your feed.</p>' : ''}</div></div>
      <div class="main-col" style="display:grid;gap:16px;min-width:0">
        <section class="panel"><h2>Why we recommended this</h2>
          <p style="margin:0 0 8px"><b>${KJ.LEVEL_LABEL[ev.level]}</b> <span class="note">· based only on what’s in your profile</span></p>
          ${ev.reasons.length ? `<ul>${ev.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : '<p class="note" style="margin:0">Nothing in your profile points to this role yet.</p>'}
          <h3>Qualifications you appear to meet</h3>${ev.meets.length ? `<ul class="status-list">${ev.meets.map((t) => st('met', 'check', t)).join('')}</ul>` : '<p class="note" style="margin:0">None confirmed yet.</p>'}
          <h3>Still unknown</h3>${ev.unknown.length ? `<ul class="status-list">${ev.unknown.map((t) => st('unk', 'dash', t)).join('')}</ul>` : '<p class="note" style="margin:0">Nothing left to verify.</p>'}
          <h3>Potential gaps</h3>${ev.gaps.length ? `<ul class="status-list">${ev.gaps.map((t) => st('gap', 'alert', t)).join('')}</ul>` : '<p class="note" style="margin:0">No gaps found from the requirements listed.</p>'}
          ${ev.unknown.length || ev.gaps.length ? '<p class="note"><a href="#/profile" style="color:var(--accent)">Update your profile</a> and this will be re-evaluated.</p>' : ''}</section>
        <section class="panel"><h2>At a glance</h2><dl class="kv">
          <div><dt>Location</dt><dd>${esc(where(j))}</dd></div><div><dt>Work arrangement</dt><dd>${esc(j.arrangement)}</dd></div>
          <div><dt>Salary</dt><dd class="pay">${esc(pay(j))}</dd></div><div><dt>Compensation type</dt><dd>${KJ.jobAnnual(j) ? comp : 'Not listed'}</dd></div>
          <div><dt>Employment type</dt><dd>${esc(j.type || 'Not listed')}</dd></div><div><dt>Application deadline</dt><dd>${esc(dl)}</dd></div>
          <div><dt>Published</dt><dd>${j.published ? fmtDate(j.published) : 'Not available'}</dd></div><div><dt>Last verified</dt><dd>${j.lastVerified ? fmtDate(j.lastVerified) : 'Not verified'}</dd></div></dl>
          ${j.compensationNote ? `<p class="note">${esc(j.compensationNote)}</p>` : ''}</section>
        <section class="panel"><h2>${j.description ? 'Job description' : 'Summary'}</h2>
          ${j.description ? '<span class="label-tag">From the employer’s posting</span><p class="desc">' + esc(j.description) + '</p>' : j.summary ? '<span class="label-tag">Summary — not the employer’s wording</span><p class="desc">' + esc(j.summary) + '</p>' : '<p class="note">No description was provided with this listing.</p>'}
          ${j.url ? '' : '<p class="note">This listing has no original posting link, so details can’t be checked at the source.</p>'}</section>
        <section class="panel"><h2>Requirements</h2>
          <h3>Required qualifications</h3>${listOrNone(j.required)}<h3>Preferred qualifications</h3>${listOrNone(j.preferred)}
          <h3>Education</h3>${eduReq ? `<p style="margin:0">${esc(eduReq)}</p>` : '<p class="note" style="margin:0">Not listed in the posting</p>'}
          <h3>Experience</h3>${expReq ? `<p style="margin:0">${esc(expReq)}</p>` : '<p class="note" style="margin:0">Not listed in the posting</p>'}
          <h3>Certifications and licenses</h3>${listOrNone(j.certifications.map((c) => c.name + (c.required ? ' (required)' : ' (preferred)')))}</section>
      </div></article>`;
    return shell('discover', '', 'Job details', inner);
  }

  /* ---------- profile ---------- */
  const SECTION_META = {
    education: { t: 'Education', sum: (p) => p.education.length ? p.education.map((e) => `${KJ.EDU_LABEL[e.level]}${e.field ? ', ' + e.field : ''}${e.status === 'in progress' ? ' (in progress)' : ''}`).join(' · ') : 'Add degrees so roles with education requirements can be confirmed.' },
    experience: { t: 'Work Experience', sum: (p) => p.experience.length ? p.experience.map((e) => `${e.title}${e.years ? ' · ' + e.years + ' yr' : ''}`).join(' · ') : 'Add past roles to confirm experience requirements.' },
    skills: { t: 'Skills', sum: (p) => p.skills.length ? p.skills.join(', ') : 'List skills used to confirm requirements.' },
    certs: { t: 'Certifications and Licenses', sum: (p) => p.certs.length ? p.certs.map((c) => c.name + (c.status === 'in progress' ? ' (in progress)' : '')).join(' · ') : p.certsNone ? 'You said you hold none.' : 'Credentials unlock jobs that require them.' },
    resume: { t: 'Résumé', sum: (p) => (p.resume.name || p.resume.text) ? `${p.resume.name || 'Pasted text'}${p.resume.text ? ' · text available for matching' : ' · name only'}` : 'Add your résumé text to improve matching.' },
    prefs: { t: 'Job Preferences', sum: (p) => `${p.prefs.interests.join(', ') || 'No interests chosen'} · ${p.prefs.types.join(', ') || 'Any type'}${p.prefs.remote ? ' · Remote welcome' : ''}` },
    location: { t: 'Location', sum: (p) => `Priority: ${p.location.priority.join(', ') || 'none'} · Also: ${p.location.area.slice(0, 4).join(', ')}${p.location.area.length > 4 ? '…' : ''}` },
    salary: { t: 'Salary', sum: (p) => { const f = KJ.profileFloor(p), d = KJ.profileDesired(p); return f === null ? 'Set a minimum so lower-paying jobs stay out of your feed.' : `Minimum ${KJ.fmtMoney(f)}/yr${d ? ' · Desired ' + KJ.fmtMoney(d) + '/yr' : ''}`; } },
    notify: { t: 'Notification Preferences', sum: (p) => `${[p.notify.newMatches && 'New matches', p.notify.deadlines && 'Deadlines', p.notify.sourceIssues && 'Source issues'].filter(Boolean).join(', ') || 'All off'} · ${p.notify.refresh === 'auto' ? 'Refresh feed automatically' : 'Review changes before refreshing'}` },
  };
  const pending = () => (state.applied ? KJ.describeChanges(state.applied, state.profile) : []);

  function vProfile() {
    const p = state.profile, comp = KJ.completion(p), done = comp.filter((c) => c.done).length, pct = Math.round((done / comp.length) * 100);
    const exYears = p.experience.reduce((s, e) => s + (KJ.num(e.years) || 0), 0);
    const f = KJ.profileFloor(p);
    const first = comp.find((c) => !c.done) || comp[0];
    const inner = sourceBanners(true) + `
      <section class="panel summary" style="margin-top:12px"><div class="sum-head"><div class="ring" style="--p:${pct}" role="img" aria-label="${pct}% complete"><span>${pct}%</span></div>
        <div class="grow"><h2>${p.name ? esc(p.name) : 'Your profile'}</h2><div class="note" style="margin:2px 0 0">${done} of ${comp.length} sections complete · <button class="btn quiet sm" data-action="edit" data-sec="basics" style="min-height:32px">${p.name ? 'Edit name' : 'Add your name'}</button></div></div>
        <button class="btn primary" data-action="edit" data-sec="${first.id}">${icon('pencil')} Edit Profile</button></div>
        <div><h3 style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)">Currently used for matching</h3><div class="used">
          <div><b>Interests</b>${esc(p.prefs.interests.join(', ') || '—')}</div>
          <div><b>Education</b>${p.education.length ? esc(p.education.map((e) => KJ.EDU_LABEL[e.level]).join(', ')) : 'Not added'}</div>
          <div><b>Experience</b>${p.experience.length ? `${exYears} yr across ${plural(p.experience.length, 'role')}` : 'Not added'}</div>
          <div><b>Credentials</b>${p.certs.length ? esc(p.certs.map((c) => c.name).join(', ')) : p.certsNone ? 'None held' : 'Not added'}</div>
          <div><b>Location</b>${esc(p.location.priority.join(', ') || '—')}</div>
          <div><b>Salary</b>${f ? 'Min ' + KJ.fmtMoney(f) + '/yr' : 'No minimum set'}</div>
          <div><b>Work style</b>${p.prefs.remote ? (p.prefs.remoteOnly ? 'Remote only' : 'On-site or remote') : 'On-site'}</div></div></div></section>
      <div class="sections">${comp.map((c) => { const m = SECTION_META[c.id]; return `<section class="sec-card"><div class="row1"><h3>${m.t}</h3>${c.done ? `<span class="status">${icon('check')}Complete</span>` : `<span class="status todo">${icon('dash')}Needs info</span>`}</div><p>${esc(m.sum(p))}</p><div><button class="btn sm" data-action="edit" data-sec="${c.id}" aria-label="Edit ${m.t}">${c.done ? 'Edit' : 'Add info'}</button></div></section>`; }).join('')}</div>`;
    return shell('profile', 'My Profile', 'Used to personalize your feed', inner);
  }

  /* ---------- settings ---------- */
  function vSettings() {
    const th = localStorage.getItem('kj.theme') || 'auto';
    const src = state.sources.length ? state.sources.map((s) => { const st = sourceStatus(s); return `<div class="rowcard" style="margin-bottom:8px"><div class="main" style="cursor:default"><h3>${esc(s.name)}</h3><div class="sub">${plural(state.jobs.filter((j) => j.sourceId === s.id).length, 'listing')} · <span style="color:${st.kind === 'ok' ? 'var(--accent)' : 'var(--warn)'}">${st.label}</span> · ${esc(st.detail)}</div></div><div class="side"><button class="btn sm quiet danger" data-action="remove-source" data-id="${esc(s.id)}">Remove</button></div></div>`; }).join('') : `<div class="banner">${icon('plug')}<div class="grow"><b>No source connected.</b> Your feed is empty until you import listings.</div></div>`;
    const inner = `<section class="panel" style="margin-top:12px"><h2>Job sources</h2>${src}
        <div class="actions"><button class="btn primary" data-action="import-open">Import listings (JSON)</button><button class="btn" data-action="download-template">Download template</button>${state.sources.some((s) => s.kind === 'sample') ? '' : '<button class="btn" data-action="import-sample">Add sample listings</button>'}</div>
        <p class="note">Kother doesn’t search the web by itself. It ranks the real postings you import, and shows the posting’s own application link. Sample listings are fictional and are always labeled.</p></section>
      <section class="panel" style="margin-top:14px"><h2>Appearance</h2><div class="field" style="max-width:280px"><label for="theme">Theme</label><select id="theme" data-action="theme"><option value="auto" ${th === 'auto' ? 'selected' : ''}>Match device</option><option value="light" ${th === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${th === 'dark' ? 'selected' : ''}>Dark</option></select></div></section>
      <section class="panel" style="margin-top:14px"><h2>Your data</h2><p class="note" style="margin-top:0">${store.isPersistent() ? 'Everything is stored on this device only.' : '<b>Storage is unavailable in this browser</b>, so changes will be lost when you close the page.'}</p>
        <div class="actions"><button class="btn" data-action="export-data">Export my data</button><button class="btn danger" data-action="clear-data">Delete all data</button></div></section>`;
    return shell('settings', 'Settings', 'Preferences and data', inner);
  }

  /* ---------- modals ---------- */
  function openModal(html) {
    session.lastFocus = document.activeElement;
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="scrim" data-action="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="mt">${html}</div></div>`;
    document.body.style.overflow = 'hidden';
    const first = root.querySelector('input:not([type=hidden]):not([type=checkbox]), select, textarea, button');
    if (first) first.focus({ preventScroll: true });
  }
  function closeModal() {
    document.getElementById('modal-root').innerHTML = '';
    document.body.style.overflow = '';
    if (session.lastFocus && document.contains(session.lastFocus)) session.lastFocus.focus({ preventScroll: true });
  }

  const FIELDS = {
    education: [{ k: 'level', l: 'Level', t: 'select', o: Object.entries(KJ.EDU_LABEL).map(([v, l]) => [v, l]) }, { k: 'field', l: 'Field of study', ph: 'e.g. Accounting' }, { k: 'school', l: 'School' }, { k: 'status', l: 'Status', t: 'select', o: [['completed', 'Completed'], ['in progress', 'In progress']] }],
    experience: [{ k: 'title', l: 'Job title', ph: 'e.g. Staff Accountant' }, { k: 'employer', l: 'Employer' }, { k: 'field', l: 'Field', t: 'select', o: [['', 'Other / not listed']].concat(KJ.CATEGORIES.map((c) => [c, c])) }, { k: 'years', l: 'Years', t: 'number' }],
    certs: [{ k: 'name', l: 'Credential or license', ph: 'e.g. Education Specialist Instruction Credential' }, { k: 'issuer', l: 'Issued by' }, { k: 'status', l: 'Status', t: 'select', o: [['held', 'Held'], ['in progress', 'In progress']] }],
  };
  const REQUIRED_KEY = { education: 'level', experience: 'title', certs: 'name' };
  function fieldHTML(f, v) {
    const val = v === undefined || v === null ? '' : v;
    const id = 'f' + Math.random().toString(36).slice(2, 8);
    if (f.t === 'select') return `<div class="field"><label for="${id}">${f.l}</label><select id="${id}" data-k="${f.k}">${f.o.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(val) === String(ov) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select></div>`;
    return `<div class="field"><label for="${id}">${f.l}</label><input id="${id}" data-k="${f.k}" type="${f.t || 'text'}" ${f.t === 'number' ? 'min="0" step="0.5" inputmode="decimal"' : ''} value="${esc(val)}" placeholder="${esc(f.ph || '')}"></div>`;
  }
  const entryHTML = (list, row) => `<div class="entry"><button type="button" class="act rm" data-action="row-rm" aria-label="Remove entry">${icon('x')}</button>${FIELDS[list].map((f) => fieldHTML(f, row[f.k])).join('')}</div>`;
  const listHTML = (list, rows, addLabel) => `<div data-list="${list}">${rows.map((r) => entryHTML(list, r)).join('')}</div><button type="button" class="btn sm" data-action="row-add" data-list="${list}">${icon('plus')} ${addLabel}</button>`;
  const check = (name, label, on, val) => `<label class="check"><input type="checkbox" name="${name}" ${val ? `value="${esc(val)}"` : ''} ${on ? 'checked' : ''}> ${esc(label)}</label>`;

  function editorBody(id, p) {
    switch (id) {
      case 'basics': return `<div class="field"><label for="nm">First name</label><input id="nm" name="name" value="${esc(p.name)}" autocomplete="given-name"></div>`;
      case 'education': return listHTML('education', p.education, 'Add education');
      case 'experience': return listHTML('experience', p.experience, 'Add a role');
      case 'skills': return `<div class="field"><label for="sk">Skills (separate with commas or new lines)</label><textarea id="sk" name="skills">${esc(p.skills.join(', '))}</textarea></div>`;
      case 'certs': return listHTML('certs', p.certs, 'Add credential') + `<div style="margin-top:8px">${check('certsNone', 'I don’t currently hold any certifications or licenses', p.certsNone)}</div>`;
      case 'resume': return `<div class="field"><label for="rf">Upload a plain-text résumé (.txt or .md)</label><input id="rf" type="file" accept=".txt,.md,.text,.pdf,.doc,.docx"></div><div class="field"><label for="rn">File or document name</label><input id="rn" name="rname" value="${esc(p.resume.name)}"></div><div class="field"><label for="rt">Résumé text (used for matching, stays on this device)</label><textarea id="rt" name="rtext" style="min-height:180px">${esc(p.resume.text)}</textarea></div><p class="note">PDF and Word files can’t be read here. Paste their text above to use them for matching.</p>`;
      case 'prefs': return `<div class="field"><span>Interests</span>${KJ.CATEGORIES.map((c) => check('interest', c, p.prefs.interests.includes(c), c)).join('')}</div><div class="field"><span>Employment types</span>${['Full-time', 'Part-time', 'Contract', 'Temporary'].map((c) => check('type', c, p.prefs.types.includes(c), c)).join('')}</div><div class="field"><span>Remote work</span>${check('remote', 'Include remote opportunities', p.prefs.remote)}${check('remoteOnly', 'Only show remote jobs', p.prefs.remoteOnly)}</div>`;
      case 'location': return `<div class="field"><label for="lp">Priority locations (one per line, most important first)</label><textarea id="lp" name="priority">${esc(p.location.priority.join('\n'))}</textarea></div><div class="field"><label for="la">Other cities in your range (commas)</label><textarea id="la" name="area">${esc(p.location.area.join(', '))}</textarea></div>`;
      case 'salary': return `<div class="fields"><div class="field"><label for="smin">Minimum</label><input id="smin" name="min" type="number" min="0" inputmode="numeric" value="${esc(p.salary.min ?? '')}"></div><div class="field"><label for="sdes">Desired</label><input id="sdes" name="desired" type="number" min="0" inputmode="numeric" value="${esc(p.salary.desired ?? '')}"></div><div class="field"><label for="sper">Per</label><select id="sper" name="period"><option value="year" ${p.salary.period === 'year' ? 'selected' : ''}>Year</option><option value="hour" ${p.salary.period === 'hour' ? 'selected' : ''}>Hour</option></select></div></div><p class="note">Jobs paying below your minimum are removed from your recommended feed. Jobs with no listed pay are still shown.</p>`;
      case 'notify': return `<div class="field"><span>Notify me about</span>${check('newMatches', 'New strong matches', p.notify.newMatches)}${check('deadlines', 'Deadlines for saved jobs', p.notify.deadlines)}${check('sourceIssues', 'Source problems or out-of-date listings', p.notify.sourceIssues)}</div><div class="field"><label for="rf2">When I change my profile</label><select id="rf2" name="refresh"><option value="auto" ${p.notify.refresh === 'auto' ? 'selected' : ''}>Refresh my feed automatically</option><option value="review" ${p.notify.refresh === 'review' ? 'selected' : ''}>Let me review changes first</option></select></div>`;
    }
    return '';
  }
  function openEditor(id) {
    const title = id === 'basics' ? 'Your name' : SECTION_META[id].t;
    openModal(`<h2 id="mt">${title}</h2><p class="sub">${id === 'basics' ? 'Used for your greeting.' : 'Changes here adjust how jobs are matched and ranked.'}</p><form data-form="profile" data-sec="${id}">${editorBody(id, state.profile)}<div class="foot"><button type="button" class="btn" data-action="close-modal">Cancel</button><button type="submit" class="btn primary">Save Changes</button></div></form>`);
  }
  function collectList(form, list) {
    return [...form.querySelectorAll(`[data-list="${list}"] .entry`)].map((e) => { const o = {}; e.querySelectorAll('[data-k]').forEach((i) => { o[i.dataset.k] = i.type === 'number' ? (i.value === '' ? '' : Number(i.value)) : i.value.trim(); }); return o; }).filter((o) => o[REQUIRED_KEY[list]]);
  }
  function submitProfile(form) {
    const id = form.dataset.sec, p = clone(state.profile), fd = new FormData(form), all = (n) => fd.getAll(n);
    const lines = (s, re) => s.split(re).map((x) => x.trim()).filter(Boolean);
    switch (id) {
      case 'basics': p.name = (fd.get('name') || '').trim(); break;
      case 'education': p.education = collectList(form, 'education'); break;
      case 'experience': p.experience = collectList(form, 'experience'); break;
      case 'skills': p.skills = [...new Set(lines(fd.get('skills') || '', /[,\n]/))]; break;
      case 'certs': p.certs = collectList(form, 'certs'); p.certsNone = !!fd.get('certsNone') && !p.certs.length; break;
      case 'resume': p.resume = { name: (fd.get('rname') || '').trim(), text: fd.get('rtext') || '' }; break;
      case 'prefs': p.prefs = { interests: all('interest'), types: all('type'), remote: !!fd.get('remote') || !!fd.get('remoteOnly'), remoteOnly: !!fd.get('remoteOnly') }; break;
      case 'location': p.location = { priority: lines(fd.get('priority') || '', /\n/), area: lines(fd.get('area') || '', /[,\n]/) }; break;
      case 'salary': { const n = (v) => (v === '' || v === null ? null : Math.max(0, Number(v))); p.salary = { min: n(fd.get('min')), desired: n(fd.get('desired')), period: fd.get('period') }; break; }
      case 'notify': p.notify = { newMatches: !!fd.get('newMatches'), deadlines: !!fd.get('deadlines'), sourceIssues: !!fd.get('sourceIssues'), refresh: fd.get('refresh') }; break;
    }
    closeModal();
    commitProfile(p);
  }

  function feedStats(profile) { const f = KJ.buildFeed(state, profile, ctx()); return { shown: f.forYou.length, top: f.sections.find((s) => s.id === 'top')?.items.length || 0 }; }
  function commitProfile(next) {
    const before = active();
    state.profile = next;
    if (!state.applied) state.applied = clone(before);
    const changes = KJ.describeChanges(before, next);
    if (!changes.length) { persist(); render(); toast('Saved. This doesn’t change your matches.'); return; }
    if (next.notify.refresh === 'review') { persist(); render(); toast(`Saved. ${plural(changes.length, 'change')} waiting for your review.`, 'Review', 'review-changes'); return; }
    applyProfile(changes);
  }
  function applyProfile(changes) {
    const a = feedStats(active());
    state.applied = clone(state.profile);
    const b = feedStats(active());
    const delta = `${plural(b.shown, 'job')} now in your feed (${b.shown - a.shown >= 0 ? '+' : ''}${b.shown - a.shown}), ${plural(b.top, 'top match').replace('top matchs', 'top matches')}.`;
    session.refreshNote = { summary: `${changes.slice(0, 3).join('; ')}${changes.length > 3 ? ` and ${changes.length - 3} more` : ''}. ${delta}` };
    persist(); render();
    toast('Profile saved — refreshing your job search with the new information.');
  }
  function openReview() {
    const ch = pending(); if (!ch.length) { closeModal(); render(); return; }
    const a = feedStats(state.applied), b = feedStats(state.profile);
    openModal(`<h2 id="mt">Review profile changes</h2><p class="sub">Your feed will be re-ranked with these updates. Nothing is lost if you wait.</p><ul class="changes">${ch.map((c) => `<li>${esc(c)}</li>`).join('')}</ul><p class="note">Estimated effect: ${a.shown} → ${b.shown} jobs in your feed, ${a.top} → ${b.top} top matches.</p><div class="foot"><button class="btn danger" data-action="discard-changes">Discard changes</button><button class="btn" data-action="close-modal">Not yet</button><button class="btn primary" data-action="refresh-now">Refresh my feed</button></div>`);
  }

  function openReport(id) {
    const j = byId(id);
    openModal(`<h2 id="mt">Report this listing</h2><p class="sub">${esc(j.title)} · ${esc(j.employer)}. Reports are saved on this device and hide the listing from your feed.</p><form data-form="report" data-id="${esc(id)}"><div class="field"><span>What’s wrong?</span>${['The listing has expired or been filled', 'The salary or details are incorrect', 'The application link is broken', 'It isn’t a real job posting', 'Something else'].map((r, i) => `<label class="check"><input type="radio" name="reason" value="${esc(r)}" ${i === 0 ? 'checked' : ''}> ${r}</label>`).join('')}</div><div class="foot"><button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Report and hide</button></div></form>`);
  }

  /* ---------- toast ---------- */
  function toast(msg, actLabel, act, id) {
    const root = document.getElementById('toast-root');
    const el = document.createElement('div'); el.className = 'toast';
    el.innerHTML = `<span>${esc(msg)}</span>${actLabel ? `<button data-action="${act}" data-id="${esc(id || '')}">${esc(actLabel)}</button>` : ''}`;
    root.replaceChildren(el);
    clearTimeout(toast.t); toast.t = setTimeout(() => el.remove(), actLabel ? 7000 : 4500);
  }

  /* ---------- render ---------- */
  function route() { const h = location.hash.replace(/^#\/?/, '') || 'discover'; const [r, ...rest] = h.split('/'); return { r, arg: decodeURIComponent(rest.join('/')) }; }
  function render(keepScroll) {
    const app = document.getElementById('app');
    const rails = {}; app.querySelectorAll('[data-rail]').forEach((r) => (rails[r.dataset.rail] = r.scrollLeft));
    const y = window.scrollY, wasQ = document.activeElement && document.activeElement.id === 'q', caret = wasQ ? document.activeElement.selectionStart : 0;
    const { r, arg } = route();
    const views = { discover: vDiscover, saved: vSaved, applications: vApplications, profile: vProfile, settings: vSettings, job: () => vJob(arg) };
    app.innerHTML = (views[r] || vDiscover)();
    app.querySelectorAll('[data-rail]').forEach((el) => { if (rails[el.dataset.rail]) el.scrollLeft = rails[el.dataset.rail]; });
    if (keepScroll) window.scrollTo(0, y);
    if (wasQ) { const q = document.getElementById('q'); q.focus(); q.setSelectionRange(caret, caret); }
    bindRails();
    document.title = r === 'job' && byId(arg) ? `${byId(arg).title} — Kother` : 'Kother — Job Discovery';
  }
  function bindRails() {
    document.querySelectorAll('.rail').forEach((rail) => {
      const sec = rail.closest('.section'), prev = sec && sec.querySelector('[data-dir="-1"]'), next = sec && sec.querySelector('[data-dir="1"]');
      const upd = () => { if (!prev) return; prev.disabled = rail.scrollLeft < 4; next.disabled = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 4; };
      rail.addEventListener('scroll', upd, { passive: true }); upd();
    });
  }

  /* ---------- actions ---------- */
  function setSaved(id) {
    if (state.saved[id]) { delete state.saved[id]; toast('Removed from Saved'); } else { state.saved[id] = Date.now(); toast('Saved. Find it under Saved.'); }
    persist();
    render(true);
  }
  function dismiss(id, goBack) {
    state.dismissed[id] = Date.now(); delete state.saved[id]; persist();
    if (goBack) history.length > 1 ? history.back() : (location.hash = '#/discover');
    render(true); toast('Hidden from your feed.', 'Undo', 'restore', id);
  }
  function markApplied(id) {
    state.appliedJobs[id] = { date: new Date().toISOString().slice(0, 10), status: 'Applied' }; persist(); session.applyNote = ''; render(true);
    toast('Marked as applied. You can track it under Applications.');
  }
  function importFile(file) {
    if (!file) return;
    session.loading = true; session.error = ''; render();
    const reader = new FileReader();
    reader.onerror = () => { session.loading = false; session.error = 'The file couldn’t be read.'; render(); };
    reader.onload = () => {
      session.loading = false;
      try {
        const res = store.importJobs(state, JSON.parse(reader.result), { id: 'import-' + file.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase(), name: file.name, kind: 'import' });
        res.added.forEach((id) => session.newIds.add(id)); res.added.forEach((id) => (state.seen[id] = 1));
        persist(); render();
        toast(`Imported ${plural(res.added.length, 'new listing')}${res.skipped.length ? `; skipped ${res.skipped.length}: ${res.skipped[0]}` : ''}.`);
      } catch (e) { session.error = e instanceof SyntaxError ? 'That file isn’t valid JSON.' : e.message; render(); }
    };
    reader.readAsText(file);
  }
  function loadSample() {
    const res = store.importJobs(state, KJ.sampleJobs(), { id: 'sample', name: 'Sample listings (fictional)', kind: 'sample' });
    res.added.forEach((id) => { session.newIds.add(id); state.seen[id] = 1; }); persist(); render(); toast('Sample listings added — they’re fictional.');
  }
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'application/json' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]');
    if (!t) {
      const o = e.target.closest('[data-open]');
      const inter = e.target.closest('a,button,select,input'); if (o && (!inter || inter === o)) location.hash = '#/job/' + encodeURIComponent(o.dataset.open);
      if (session.notesOpen && !e.target.closest('.tools')) { session.notesOpen = false; render(true); }
      return;
    }
    const a = t.dataset.action, id = t.dataset.id;
    if (a === 'scrim') { if (e.target === t) closeModal(); return; }
    if (a === 'apply-opened') { session.applyNote = id; if (route().r === 'job') setTimeout(() => render(true), 0); return; }
    if (t.tagName === 'SELECT') return;
    e.stopPropagation();
    const A = {
      save: () => setSaved(id), dismiss: () => dismiss(id), 'dismiss-detail': () => dismiss(id, true),
      restore: () => { delete state.dismissed[id]; persist(); render(true); toast('Restored to your feed.'); },
      more: () => { session.cat = t.dataset.cat; session.q = ''; location.hash = '#/discover'; render(); window.scrollTo(0, 0); },
      cat: () => { session.cat = t.dataset.cat; session.q = ''; render(); }, 'clear-search': () => { session.q = ''; render(); },
      rail: () => { const r = document.getElementById(t.dataset.target); r.scrollBy({ left: Number(t.dataset.dir) * r.clientWidth * 0.85, behavior: 'smooth' }); },
      back: () => (history.length > 1 ? history.back() : (location.hash = '#/discover')),
      notes: () => { session.notesOpen = !session.notesOpen; if (session.notesOpen) { state.notesSeen = notesSig(); persist(); } render(true); },
      'close-pop': () => { session.notesOpen = false; }, 'close-modal': closeModal,
      'mark-applied': () => markApplied(id), unapply: () => { delete state.appliedJobs[id]; persist(); render(true); },
      report: () => openReport(id), edit: () => openEditor(t.dataset.sec),
      'row-add': () => { const l = t.dataset.list, c = t.closest('form').querySelector(`[data-list="${l}"]`); c.insertAdjacentHTML('beforeend', entryHTML(l, l === 'certs' ? { status: 'held' } : l === 'education' ? { level: 'bachelor', status: 'completed' } : {})); c.lastElementChild.querySelector('input,select').focus(); },
      'row-rm': () => t.closest('.entry').remove(),
      'review-changes': () => openReview(), 'refresh-now': () => { const ch = pending(); closeModal(); applyProfile(ch); },
      'discard-changes': () => { state.profile = clone(state.applied); persist(); closeModal(); render(); toast('Changes discarded.'); },
      'dismiss-refresh': () => { session.refreshNote = null; render(true); }, 'dismiss-error': () => { session.error = ''; render(true); },
      'import-open': () => document.getElementById('file-in').click(), 'import-sample': loadSample,
      'remove-source': () => { if (confirm('Remove this source and its listings? Saved and applied jobs are kept.')) { store.removeSource(state, id); persist(); render(true); toast('Source removed.'); } },
      'download-template': () => download('kother-jobs-template.json', JSON.stringify({ jobs: [{ id: 'unique-id', title: 'Job title', employer: 'Employer name', city: 'Stockton', neighborhood: 'North Stockton', remote: false, arrangement: 'On-site', salaryMin: 70000, salaryMax: 90000, salaryPeriod: 'year', type: 'Full-time', categories: ['Finance'], description: 'Full text of the posting', required: ['Requirement text'], preferred: [], education: { level: 'bachelor' }, experience: { years: 2, field: 'Finance' }, certifications: [{ name: 'Credential name', required: true }], deadline: '2026-12-31', published: '2026-10-01', lastVerified: '2026-10-09', url: 'https://employer.example/jobs/123', logoUrl: '' }] }, null, 2)),
      'export-data': () => download('kother-data.json', JSON.stringify(state, null, 2)),
      'clear-data': () => { if (confirm('Delete your profile, saved jobs, applications and all listings from this device?')) { state = store.defaults(); persist(); session.newIds = new Set(); location.hash = '#/discover'; render(); toast('All data deleted.'); } },
    };
    if (A[a]) A[a]();
    if (a === 'close-pop') render(true);
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'file-in') { importFile(t.files[0]); t.value = ''; }
    else if (t.dataset.action === 'app-status') { state.appliedJobs[t.dataset.id].status = t.value; persist(); toast('Status updated.'); }
    else if (t.dataset.action === 'theme') { try { localStorage.setItem('kj.theme', t.value); } catch (_) {} applyTheme(); }
    else if (t.id === 'rf' && t.files[0]) {
      const f = t.files[0], form = t.closest('form'); form.querySelector('[name=rname]').value = f.name;
      if (/\.(txt|md|text)$/i.test(f.name)) { const r = new FileReader(); r.onload = () => { form.querySelector('[name=rtext]').value = String(r.result).slice(0, 60000); }; r.readAsText(f); }
    }
  });
  document.addEventListener('input', (e) => { if (e.target.id === 'q') { clearTimeout(input.t); input.t = setTimeout(() => { session.q = e.target.value; render(); }, 150); } });
  const input = {};
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault();
    if (f.dataset.form === 'search') { session.q = document.getElementById('q').value; render(); }
    else if (f.dataset.form === 'profile') submitProfile(f);
    else if (f.dataset.form === 'report') {
      state.reported[f.dataset.id] = { reason: new FormData(f).get('reason'), date: Date.now() }; persist(); closeModal();
      location.hash = '#/discover'; render(); toast('Reported and hidden. Thank you.', 'Undo', 'restore-report', f.dataset.id);
    }
  });
  document.addEventListener('click', (e) => { const t = e.target.closest('[data-action="restore-report"]'); if (t) { delete state.reported[t.dataset.id]; persist(); render(true); toast('Report withdrawn.'); } });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (document.getElementById('modal-root').firstChild) closeModal(); else if (session.notesOpen) { session.notesOpen = false; render(true); } }
    if (e.key === 'Tab' && document.getElementById('modal-root').firstChild) {
      const els = [...document.querySelectorAll('#modal-root button, #modal-root input, #modal-root select, #modal-root textarea')].filter((x) => !x.disabled);
      if (!els.length) return; const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  window.addEventListener('hashchange', () => { session.notesOpen = false; render(); const { r } = route(); if (r !== 'job') window.scrollTo(0, 0); else window.scrollTo(0, 0); });

  function applyTheme() { let t = 'auto'; try { t = localStorage.getItem('kj.theme') || 'auto'; } catch (_) {} if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); }

  /* ---------- boot ---------- */
  (function boot() {
    applyTheme();
    const inp = document.createElement('input'); inp.type = 'file'; inp.id = 'file-in'; inp.accept = '.json,application/json'; inp.hidden = true; document.body.appendChild(inp);
    if (!state.applied) state.applied = clone(state.profile);
    state.jobs.forEach((j) => { if (!state.seen[j.id]) { session.newIds.add(j.id); state.seen[j.id] = 1; } });
    state.lastVisit = Date.now(); persist();
    if (!store.isPersistent()) setTimeout(() => toast('Storage is unavailable here, so your changes won’t be kept after you close the page.'), 300);
    render();
  })();
})();
