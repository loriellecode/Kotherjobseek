/* Wiring: routing, rendering, events, polling, push, imagery. */
(function () {
  'use strict';
  const KJ = window.KJ, A = KJ.A, { esc } = A, S = A.S, ses = A.session;
  const RUNNING = ['queued', 'searching', 'matching', 'updating'];
  let poll = null;

  /* ---------- loading ---------- */
  function setJobs(jobs, markNew) {
    const prev = new Set(S.jobs.map((j) => j.id));
    S.jobs = jobs;
    if (markNew) jobs.forEach((j) => { if (!prev.has(j.id) && j.userState.firstSurfaced && Date.now() - j.userState.firstSurfaced < 36e5) ses.newIds.add(j.id); });
  }
  A.loadAll = async function () {
    const b = await A.api('GET', '/api/bootstrap', undefined, { quiet: true });
    Object.assign(S, { user: b.user, profile: b.profile, status: b.status, providers: b.providers, config: b.config, unread: b.unread });
    const [feed, apps, notes, resume, careers] = await Promise.all([A.api('GET', '/api/feed'), A.api('GET', '/api/applications'), A.api('GET', '/api/notifications'), A.api('GET', '/api/resume'), A.api('GET', '/api/careers')]);
    S.resume = resume; S.careers = careers;
    S.apps = Object.fromEntries(apps.applications.map((a) => [a.jobId, a])); S.notes = notes.notifications; S.unread = notes.unread;
    let last = 0; try { last = Number(localStorage.getItem('kj.lastVisit') || 0); } catch (_) { /* storage blocked */ }
    S.jobs = feed.jobs; if (!ses.newIds.size) feed.jobs.forEach((j) => { if (j.userState.firstSurfaced && j.userState.firstSurfaced > last) ses.newIds.add(j.id); });
    S.loaded = true;
  };
  A.refreshFeed = async function () {
    try {
      const [feed, b, cr] = await Promise.all([A.api('GET', '/api/feed'), A.api('GET', '/api/bootstrap'), A.api('GET', '/api/careers')]);
      S.careers = cr; setJobs(feed.jobs, true); S.profile = b.profile; S.providers = b.providers; S.unread = b.unread; S.status = feed.status;
      const n = await A.api('GET', '/api/notifications'); S.notes = n.notifications; S.unread = n.unread;
      A.render(true);
    } catch (_) { /* offline banner already shown */ }
  };
  A.pollStatus = function () {
    if (poll) return;
    const tick = async () => {
      try { const r = await A.api('GET', '/api/search/status'); S.status = r.status; A.renderBanners(); if (RUNNING.includes(S.status.state)) { poll = setTimeout(tick, 900); return; } poll = null; await A.refreshFeed(); }
      catch (_) { poll = null; }
    };
    poll = setTimeout(tick, 400);
  };
  A.afterProfile = function (resp, quiet) {
    S.profile = resp.profile; S.status = resp.status;
    if (!quiet) A.toast(resp.queued ? 'Profile saved. Updating your matches…' : 'Profile saved.');
    if (resp.queued) A.pollStatus();
    A.render(true);
  };
  async function sync() { // pick up scheduled searches that finished while the app was open
    if (document.hidden || !S.user || poll) return;
    try { const r = await A.api('GET', '/api/search/status', undefined, { quiet: true }); const changed = !S.status || r.status.id !== S.status.id || r.status.finishedAt !== S.status.finishedAt || r.status.state !== S.status.state; S.status = r.status; if (RUNNING.includes(r.status.state)) A.pollStatus(); else if (changed) await A.refreshFeed(); else A.renderBanners(); } catch (_) { /* offline */ }
  }

  /* ---------- render ---------- */
  const route = () => { const h = location.hash.replace(/^#\/?/, '') || 'discover'; const [r, ...rest] = h.split('/'); return { r, arg: decodeURIComponent(rest.join('/')) }; };
  A.render = function (keep) {
    const app = document.getElementById('app'), rails = {};
    app.querySelectorAll('[data-rail]').forEach((r) => (rails[r.dataset.rail] = r.scrollLeft));
    const y = window.scrollY, q = document.activeElement && document.activeElement.id === 'q', caret = q ? document.activeElement.selectionStart : 0;
    const { r, arg } = route();
    if (S.booting) app.innerHTML = '<div class="shell"><main><div class="skeleton" aria-busy="true"><div class="sk" style="height:60px;margin-top:20px"></div><div class="sk" style="height:300px;margin:20px 0"></div></div></main></div>';
    else if (!S.user) app.innerHTML = A.views.auth();
    else { const v = r === 'job' ? () => A.views.job(arg) : A.views[r] || A.views.discover; app.innerHTML = v(); }
    app.querySelectorAll('[data-rail]').forEach((el) => { if (rails[el.dataset.rail]) el.scrollLeft = rails[el.dataset.rail]; });
    if (keep) window.scrollTo(0, y);
    if (q) { const el = document.getElementById('q'); if (el) { el.focus(); el.setSelectionRange(caret, caret); } }
    app.querySelectorAll('.rail').forEach((rail) => {
      const sec = rail.closest('.section'), prev = sec && sec.querySelector('[data-dir="-1"]'), next = sec && sec.querySelector('[data-dir="1"]');
      const upd = () => { if (prev) { prev.disabled = rail.scrollLeft < 4; next.disabled = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 4; } };
      rail.addEventListener('scroll', upd, { passive: true }); upd();
    });
    document.title = r === 'job' && A.job(arg) ? `${A.job(arg).title} — Kother` : 'Kother — Job Discovery';
    hydrateImages();
  };

  /* ---------- editorial imagery (server-side Pexels proxy; attribution always shown) ---------- */
  function hydrateImages() {
    document.querySelectorAll('[data-img-topic]').forEach(async (el) => {
      const t = el.dataset.imgTopic;
      if (!(t in ses.images)) ses.images[t] = A.api('GET', '/api/imagery/' + encodeURIComponent(t), undefined, { quiet: true }).then((r) => r.photo).catch(() => null);
      const p = await ses.images[t];
      if (!p || !document.body.contains(el) || !/^https:\/\/images\.pexels\.com\//.test(p.src.medium)) return;
      const banner = el.classList.contains('banner'), alt = p.alt || '';
      const credit = `<a href="${esc(p.pageUrl)}" target="_blank" rel="noopener noreferrer">Photo by ${esc(p.photographer)}</a> on <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer">Pexels</a>`;
      if (banner) el.innerHTML = `<img src="${esc(p.src.large)}" srcset="${esc(p.src.small)} 350w, ${esc(p.src.medium)} 940w, ${esc(p.src.large)} 1280w, ${esc(p.src.large2x)} 2400w" sizes="(min-width: 1180px) 1120px, 100vw" width="${p.width}" height="${p.height}" alt="${esc(alt)}" loading="lazy" decoding="async" style="background:${esc(p.avgColor || 'var(--surface-2)')}"><span class="credit">${credit}</span>`;
      else { el.innerHTML = `<img src="${esc(p.src.small)}" srcset="${esc(p.src.small)} 350w, ${esc(p.src.medium)} 940w" sizes="96px" alt="" loading="lazy" decoding="async" style="background:${esc(p.avgColor || 'var(--surface-2)')}">`; const sec = el.closest('.section'); if (sec && !sec.querySelector('.credit-line')) sec.insertAdjacentHTML('beforeend', `<p class="credit-line">${credit}</p>`); }
      el.hidden = false;
    });
  }
  document.addEventListener('error', (e) => { const t = e.target; if (t && t.tagName === 'IMG') { const w = t.closest('[data-img-topic]'); if (w) w.hidden = true; else t.remove(); } }, true); // graceful fallback for any broken image

  /* ---------- actions ---------- */
  const jobAction = async (fn) => { try { await fn(); } catch (e) { if (e.status !== 401) A.toast(e.message); } };
  A.setBusy = (msg) => { S.busy = msg; A.renderBanners(); };
  async function decide(id, action, body) {
    try {
      const r = await A.api('POST', `/api/resume/proposals/${id}/${action}`, body);
      S.resume = { resume: r.resume, proposals: r.proposals }; if (r.profile) { S.profile = r.profile; S.status = r.status; if (r.queued) A.pollStatus(); }
      A.render(true); A.editors.resumeReview(S.resume, action === 'accept' ? (r.queued ? 'Added to your profile. Updating your matches…' : 'Done.') : undefined);
    } catch (e) {
      if (e.status === 409 && e.conflict) return A.editors.conflictDialog(id, e.conflict, body && body.data);
      throw e;
    }
  }
  async function setSaved(id) {
    const j = A.job(id), on = !j.userState.saved;
    await A.api(on ? 'PUT' : 'DELETE', `/api/jobs/${id}/saved`); j.userState.saved = on ? Date.now() : null; A.render(true); A.toast(on ? 'Saved. Find it under Saved.' : 'Removed from Saved');
  }
  async function dismiss(id, back) {
    await A.api('PUT', `/api/jobs/${id}/dismissed`); const j = A.job(id); j.userState.dismissed = Date.now(); j.userState.saved = null;
    if (back) { history.length > 1 ? history.back() : (location.hash = '#/discover'); } A.render(true); A.toast('Hidden from your feed.', 'Undo', 'restore', id);
  }
  async function markApplied(id) {
    const r = await A.api('PUT', `/api/applications/${id}`, { status: 'applied' }); S.apps[id] = r.application; ses.applyNote = ''; A.render(true);
    A.toast('Marked as applied. Nothing was sent to the employer — this is your own record.');
  }
  async function searchNow() { const r = await A.api('POST', '/api/search/run'); S.status = r.status; A.renderBanners(); A.pollStatus(); A.toast('Search queued.'); }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]');
    if (!t) {
      const o = e.target.closest('[data-open]'), inter = e.target.closest('a,button,select,input');
      if (o && (!inter || inter === o)) location.hash = '#/job/' + o.dataset.open;
      if (ses.notesOpen && !e.target.closest('.tools')) { ses.notesOpen = false; A.render(true); }
      return;
    }
    const a = t.dataset.action, id = t.dataset.id;
    if (a === 'scrim') { if (e.target === t) A.closeModal(); return; }
    if (a === 'apply-opened') { ses.applyNote = Number(id); if (route().r === 'job') setTimeout(() => A.render(true), 0); return; }
    if (t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type !== 'button')) return;
    e.stopPropagation();
    const run = (fn) => jobAction(fn);
    const H = {
      save: () => run(() => setSaved(id)), dismiss: () => run(() => dismiss(id)), 'dismiss-detail': () => run(() => dismiss(id, true)),
      restore: () => run(async () => { await A.api('DELETE', `/api/jobs/${id}/dismissed`); A.job(id).userState.dismissed = null; A.render(true); A.toast('Restored to your feed.'); }),
      'restore-report': () => run(async () => { await A.api('DELETE', `/api/jobs/${id}/report`); A.job(id).userState.reported = null; A.render(true); A.toast('Report withdrawn.'); }),
      'mark-applied': () => run(() => markApplied(id)), 'open-link': () => A.editors.linkConfirm(A.job(id)), track: () => A.editors.trackerModal(Number(id)), report: () => A.editors.reportModal(Number(id)),
      cat: () => { ses.cat = t.dataset.cat; ses.q = ''; A.render(); }, more: () => { ses.cat = t.dataset.cat; ses.q = ''; if (route().r !== 'discover') location.hash = '#/discover'; A.render(); window.scrollTo(0, 0); },
      'clear-search': () => { ses.q = ''; A.render(); }, rail: () => { const r = document.getElementById(t.dataset.target); r.scrollBy({ left: Number(t.dataset.dir) * r.clientWidth * 0.85, behavior: 'smooth' }); },
      back: () => (history.length > 1 ? history.back() : (location.hash = '#/discover')),
      notes: () => run(async () => { ses.notesOpen = !ses.notesOpen; A.render(true); if (ses.notesOpen && S.unread) { await A.api('POST', '/api/notifications/read'); S.unread = 0; S.notes.forEach((n) => (n.read_at = n.read_at || Date.now())); setTimeout(() => A.render(true), 0); } }),
      'close-pop': () => { ses.notesOpen = false; }, 'close-modal': A.closeModal,
      edit: () => A.editors.open(t.dataset.sec),
      'rec-add': () => A.editors.recordForm(t.dataset.kind, t.dataset.sec), 'rec-back': () => A.editors.open(t.dataset.sec),
      'rec-edit': () => { const sec = { education: 'education', experience: 'experience', cert: 'certs', skill: 'skills' }[t.dataset.kind]; const rec = S.profile[sec === 'certs' ? 'certs' : sec].find((r) => r.id === Number(id)); A.editors.recordForm(t.dataset.kind, sec, rec); },
      'rec-confirm': () => run(async () => { const k = t.dataset.kind, sec = { education: 'education', experience: 'experience', cert: 'certs' }[k]; const rec = S.profile[sec].find((r) => r.id === Number(id)); const { id: _i, source: _s, ...body } = rec; const r = await A.api('PUT', `/api/profile/${k}/${id}`, Object.assign(body, { verified: true })); A.afterProfile(r, true); A.toast('Confirmed. Updating your matches…'); A.editors.open(sec); }),
      'rec-delete': () => run(async () => { const k = t.dataset.kind, sec = { education: 'education', experience: 'experience', cert: 'certs', skill: 'skills' }[k]; const r = await A.api('DELETE', `/api/profile/${k}/${id}`); A.afterProfile(r); A.editors.open(sec); }),
      'resume-upload': () => document.getElementById('resume-in').click(),
      'resume-review': () => run(async () => { S.resume = await A.api('GET', '/api/resume'); A.editors.resumeReview(S.resume); }),
      'resume-retry': () => run(async () => { A.setBusy('Re-reading your résumé'); try { S.resume = await A.api('POST', '/api/resume/retry'); } finally { A.setBusy(null); } A.render(true); if (S.resume.resume && S.resume.resume.status === 'ready' && S.resume.proposals.length) A.editors.resumeReview(S.resume); else if (S.resume.resume && S.resume.resume.status === 'failed') A.toast('Analysis failed again: ' + S.resume.resume.error); }),
      'resume-remove': () => run(async () => { if (!confirm('Remove your résumé? The stored file is deleted from the server. Profile entries you already accepted are kept.')) return; const r = await A.api('DELETE', '/api/resume'); S.resume = { resume: null, proposals: [] }; const b = await A.api('GET', '/api/bootstrap'); S.profile = b.profile; A.render(true); A.toast(r.fileDeleted ? 'Résumé removed and the stored file deleted.' : 'Résumé removed, but the file could not be deleted — contact the operator.'); }),
      'prop-accept': () => run(() => decide(id, 'accept', {})),
      'prop-reject': () => run(() => decide(id, 'reject', {})),
      'prop-edit': () => A.editors.proposalEdit(S.resume.proposals.find((p) => p.id === Number(id))),
      'prop-resolve': () => run(() => decide(id, 'accept', Object.assign({ mode: t.dataset.mode }, A.session.pendingEdit ? { data: A.session.pendingEdit } : {}))),
      'prop-accept-all': () => run(async () => { for (const p of S.resume.proposals.filter((x) => x.origin === 'stated' && !x.conflict && !x.data.flag && x.kind !== 'cert')) { const r = await A.api('POST', `/api/resume/proposals/${p.id}/accept`, {}); S.resume = { resume: r.resume, proposals: r.proposals }; S.profile = r.profile; S.status = r.status; } A.pollStatus(); A.render(true); A.editors.resumeReview(S.resume, 'Added. Your searches are being expanded.'); }),
      'resume-finish': () => run(async () => { const r = await A.api('POST', '/api/resume/finish'); S.resume = await A.api('GET', '/api/resume'); A.closeModal(); A.render(true); A.toast(r.message); if (r.searchExpanded) A.pollStatus(); }),
      'career-state': () => run(async () => { const r = await A.api('PUT', `/api/careers/${id}`, { state: t.dataset.state }); S.careers = r; S.status = r.status; A.pollStatus(); A.render(true); A.toast(t.dataset.state === 'include' ? 'Included. Searching for these roles…' : t.dataset.state === 'exclude' ? 'Hidden, and left out of future searches.' : 'Restored.'); }),
      'career-view': () => { ses.q = t.dataset.q; ses.cat = 'For You'; A.render(); window.scrollTo(0, 0); },
      'int-add': () => document.getElementById('ints').insertAdjacentHTML('beforeend', A.intRow({})), 'int-rm': () => t.closest('.irow').remove(),
      untrack: () => run(async () => { await A.api('DELETE', `/api/applications/${id}`); delete S.apps[id]; A.closeModal(); A.render(true); A.toast('Stopped tracking this job.'); }),
      'search-now': () => run(searchNow), 'retry-search': () => run(searchNow), 'dismiss-status': () => { S.status = Object.assign({}, S.status, { dismissed: true }); A.renderBanners(); },
      'dismiss-error': () => { ses.error = ''; A.render(true); }, 'reload-all': () => run(async () => { await A.loadAll(); A.render(true); }),
      'show-below': () => run(async () => { const r = await A.api('PATCH', '/api/profile', { salary: { showBelow: true } }); A.afterProfile(r); }),
      'import-open': () => document.getElementById('file-in').click(),
      'download-template': () => download('kother-jobs-template.json', JSON.stringify({ jobs: [{ id: 'unique-id-or-url', title: 'Job title', employer: 'Employer name', city: 'Stockton', neighborhood: 'North Stockton', remote: false, salaryMin: 70000, salaryMax: 90000, salaryPeriod: 'year', type: 'Full-time', categories: ['Finance'], description: 'Full text of the posting', required: [], preferred: [], deadline: '2026-12-31', published: '2026-10-01', url: 'https://employer.example/jobs/123' }] }, null, 2)),
      logout: () => run(async () => { await A.api('POST', '/api/auth/logout'); S.user = null; S.jobs = []; S.loaded = false; location.hash = '#/discover'; A.render(); }),
      'auth-mode': () => { ses.authMode = ses.authMode === 'signup' ? 'login' : 'signup'; A.render(); },
      'enable-push': () => run(enablePush), 'disable-push': () => run(disablePush),
      'delete-profile': () => A.editors.deleteModal('profile'), 'delete-account': () => A.editors.deleteModal('account'),
      'delete-profile-confirm': () => run(async () => { const r = await A.api('DELETE', '/api/profile'); S.profile = r.profile; A.closeModal(); A.refreshFeed(); A.toast('Profile data deleted.'); }),
    };
    if (H[a]) H[a]();
    if (a === 'close-pop') A.render(true);
  });
  function download(name, text) { const l = document.createElement('a'); l.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); l.download = name; l.click(); setTimeout(() => URL.revokeObjectURL(l.href), 1000); }

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'file-in') importFile(t.files[0]), (t.value = '');
    else if (t.dataset.action === 'theme') { try { localStorage.setItem('kj.theme', t.value); } catch (_) { /* ignore */ } applyTheme(); }
    else if (t.dataset.action === 'resume-pick' && t.files[0]) jobAction(async () => {
      const f = t.files[0]; t.value = ''; A.setBusy('Uploading and reading your résumé');
      try {
        const r = await A.api('POST', '/api/resume', f, { headers: { 'x-filename': encodeURIComponent(f.name), 'content-type': 'application/octet-stream' } });
        S.resume = { resume: r.resume, proposals: r.proposals }; const b = await A.api('GET', '/api/bootstrap'); S.profile = b.profile;
      } finally { A.setBusy(null); }
      A.render(true);
      const R = S.resume.resume;
      if (R.status === 'failed') A.toast('We couldn’t read that résumé. You can retry, upload another file, or enter your information manually.');
      else if (S.resume.proposals.length) A.editors.resumeReview(S.resume); else A.toast('Résumé read. No major new information was detected, so nothing needs review and your searches were not expanded.');
    });
  });
  async function importFile(file) {
    if (!file) return;
    try { const data = JSON.parse(await file.text()); const r = await A.api('POST', '/api/jobs/import', data); S.status = r.status; A.pollStatus(); A.toast(`Imported ${A.plural(r.created, 'new listing')}${r.skipped.length ? `; skipped ${r.skipped.length}: ${r.skipped[0]}` : ''}.`); }
    catch (e) { ses.error = e instanceof SyntaxError ? 'That file isn’t valid JSON.' : e.message; A.render(true); }
  }

  let qt;
  document.addEventListener('input', (e) => { if (e.target.id === 'q') { clearTimeout(qt); qt = setTimeout(() => { ses.q = e.target.value; A.render(); }, 150); } });

  /* ---------- forms ---------- */
  const formErr = (f, msg) => { const el = f.querySelector('.form-error'); if (el) { el.textContent = msg; el.hidden = false; } else A.toast(msg); };
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault();
    const kind = f.dataset.form, fd = new FormData(f), btn = f.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
    const done = () => { if (btn) btn.disabled = false; };
    const go = async () => {
      if (kind === 'search') { ses.q = document.getElementById('q').value; A.render(); }
      else if (kind === 'auth') {
        const r = await A.api('POST', '/api/auth/' + (f.dataset.mode === 'signup' ? 'signup' : 'login'), { email: fd.get('email'), password: fd.get('password') }, { quiet: true });
        S.booting = true; A.render(); await A.loadAll(); S.booting = false; S.user = S.user || r.user; A.render(); if (S.status && RUNNING.includes(S.status.state)) A.pollStatus();
      } else if (kind === 'record') {
        const k = f.dataset.kind, sec = f.dataset.sec, body = Object.fromEntries(fd.entries()), id = f.dataset.id;
        const r = await A.api(id ? 'PUT' : 'POST', `/api/profile/${k}${id ? '/' + id : ''}`, body); A.afterProfile(r, true); A.toast(r.queued ? 'Saved. Updating your matches…' : 'Saved.'); A.editors.open(sec);
      } else if (kind === 'skills-add') {
        const names = String(fd.get('names') || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean); if (!names.length) return formErr(f, 'Enter at least one skill.');
        let r; for (const n of names) r = await A.api('POST', '/api/profile/skill', { name: n }); A.afterProfile(r, true); A.toast('Skills saved.'); A.editors.open('skills');
      } else if (kind === 'prefs') { const r = await A.api('PATCH', '/api/profile', A.editors.collectPrefs(f)); A.closeModal(); A.afterProfile(r); }
      else if (kind === 'certsnone') { const r = await A.api('PATCH', '/api/profile', { certsNone: !!fd.get('certsNone') }); A.afterProfile(r, true); A.toast('Saved.'); A.editors.open('certs'); }
      else if (kind === 'tracker') {
        const id = f.dataset.id, ints = [...f.querySelectorAll('.irow')].map((r) => ({ date: r.querySelector('[name=idate]').value, note: r.querySelector('[name=inote]').value })).filter((i) => i.date || i.note);
        const r = await A.api('PUT', `/api/applications/${id}`, { status: fd.get('status'), appliedOn: fd.get('appliedOn') || null, response: fd.get('response'), notes: fd.get('notes'), closedReason: fd.get('closedReason'), interviews: ints });
        S.apps[id] = r.application; A.closeModal(); A.render(true); A.toast('Application updated.');
      } else if (kind === 'report') { const id = f.dataset.id; await A.api('PUT', `/api/jobs/${id}/report`, { reason: fd.get('reason') }); A.job(id).userState.reported = fd.get('reason'); A.closeModal(); location.hash = '#/discover'; A.render(); A.toast('Reported and hidden. Thank you.', 'Undo', 'restore-report', id); }
      else if (kind === 'prop-edit') { const body = Object.fromEntries(fd.entries()); await decide(f.dataset.id, 'accept', { data: body }); }
      else if (kind === 'delete-account') { await A.api('DELETE', '/api/account', { password: fd.get('password') }); A.closeModal(); Object.assign(S, { user: null, jobs: [], profile: null, loaded: false }); A.render(); A.toast('Your account was deleted.'); }
    };
    go().catch((err) => { if (err.status !== 401 || kind === 'auth') formErr(f, err.message); }).finally(done);
  });
  document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('modal-root');
    if (e.key === 'Escape') { if (modal.firstChild) A.closeModal(); else if (ses.notesOpen) { ses.notesOpen = false; A.render(true); } }
    if (e.key === 'Tab' && modal.firstChild) {
      const els = [...modal.querySelectorAll('button, input, select, textarea, a[href]')].filter((x) => !x.disabled && !x.hidden); if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  window.addEventListener('hashchange', () => { ses.notesOpen = false; A.render(); window.scrollTo(0, 0); });

  /* ---------- push (only works where the browser + server support it; verify on your own device) ---------- */
  const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4), r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
  async function enablePush() {
    if (!S.config.pushPublicKey) return A.toast('Push isn’t configured on this server.');
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return A.toast('This browser doesn’t support web push.');
    if ((await Notification.requestPermission()) !== 'granted') return A.toast('Notifications were not allowed in this browser.');
    const reg = await navigator.serviceWorker.register('/sw.js'), sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(S.config.pushPublicKey) });
    await A.api('POST', '/api/push/subscribe', { subscription: sub.toJSON() }); const r = await A.api('PATCH', '/api/profile', { notify: { push: true } }); S.profile = r.profile; A.render(true); A.toast('Push is on for this device.');
  }
  async function disablePush() {
    const reg = await navigator.serviceWorker.getRegistration(), sub = reg && (await reg.pushManager.getSubscription());
    if (sub) { await A.api('DELETE', '/api/push/subscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); } A.toast('Push is off for this device.');
  }

  function applyTheme() { let t = 'auto'; try { t = localStorage.getItem('kj.theme') || 'auto'; } catch (_) { /* ignore */ } if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); }

  /* ---------- boot ---------- */
  (async function boot() {
    applyTheme();
    const inp = document.createElement('input'); inp.type = 'file'; inp.id = 'file-in'; inp.accept = '.json,application/json'; inp.hidden = true; document.body.appendChild(inp);
    const rin = document.createElement('input'); rin.type = 'file'; rin.id = 'resume-in'; rin.accept = '.pdf,.docx'; rin.hidden = true; rin.dataset.action = 'resume-pick'; document.body.appendChild(rin);
    S.booting = true; A.render();
    try { await A.loadAll(); } catch (err) { if (err.status !== 401 && !err.offline) ses.error = err.message; }
    S.booting = false; A.render();
    if (S.status && RUNNING.includes(S.status.state)) A.pollStatus();
    setInterval(sync, 45000);
    const stamp = () => { try { localStorage.setItem('kj.lastVisit', String(Date.now())); } catch (_) { /* ignore */ } };
    window.addEventListener('pagehide', stamp); document.addEventListener('visibilitychange', () => { if (document.hidden) stamp(); else sync(); });
  })();
})();
