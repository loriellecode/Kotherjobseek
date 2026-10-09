/* Client core: state, API access, helpers, modal and toast. No secrets live in the browser; all data comes from the server API. */
(function () {
  'use strict';
  const KJ = (window.KJ = window.KJ || {});
  const A = (KJ.A = {
    S: { user: null, profile: null, jobs: [], apps: {}, status: null, providers: [], config: {}, notes: [], unread: 0, offline: false, loaded: false },
    session: { cat: 'For You', q: '', newIds: new Set(), notesOpen: false, applyNote: '', error: '', flash: null, images: {}, lastFocus: null },
  });

  A.esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  A.clone = (o) => JSON.parse(JSON.stringify(o));
  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>', bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>', left: '<path d="m15 5-7 7 7 7"/>', right: '<path d="m9 5 7 7-7 7"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>', check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>', ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/>',
    flag: '<path d="M5 21V4h11l-1 4 1 4H5"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    pencil: '<path d="m4 20 1-4L16 5l3 3L8 19z"/>', alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>', plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>', dash: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2 6"/><path d="M20 4v7h-7"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>', lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  };
  A.icon = (n, cls) => `<svg class="i ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
  A.fmtDate = (s) => (s ? new Date(String(s).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
  A.fmtTs = (t) => (t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');
  A.daysUntil = (s) => Math.ceil((new Date(s + 'T23:59:59').getTime() - Date.now()) / 864e5);
  A.rel = (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : n > 0 ? `in ${n} days` : `${-n} days ago`);
  A.ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  A.plural = (n, w, p) => `${n} ${n === 1 ? w : p || w + 's'}`;
  A.initials = (n) => String(n).split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  A.hue = (str) => { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  A.job = (id) => A.S.jobs.find((j) => j.id === Number(id));
  A.where = (j) => (j.remote ? j.arrangement || 'Remote' : [j.neighborhood && j.neighborhood !== j.city ? j.neighborhood : '', j.city, j.state].filter(Boolean).join(', ') || j.locationText || 'Location not listed');
  A.shortWhere = (j) => (j.remote ? 'Remote' : j.neighborhood || j.city || j.locationText || 'Location not listed');
  A.pay = (j) => KJ.salaryText(j) || 'Salary not listed';
  A.PROVIDER_NAMES = { adzuna: 'Adzuna', usajobs: 'USAJOBS', feeds: 'Employer career page', import: 'Imported file' };
  A.providerName = (p) => A.PROVIDER_NAMES[p] || p;

  /* ---- API ---- */
  A.api = async function (method, path, body, opts) {
    opts = opts || {};
    const init = { method, credentials: 'same-origin', headers: Object.assign({}, opts.headers) };
    if (body !== undefined) { if (body instanceof Blob) init.body = body; else { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); } }
    let res;
    try { res = await fetch(path, init); A.S.offline = false; } catch (_) { A.S.offline = true; A.renderBanners && A.renderBanners(); throw Object.assign(new Error('Can’t reach the server. Showing the last results that loaded.'), { offline: true }); }
    let data = null; try { data = await res.json(); } catch (_) { /* non-JSON */ }
    if (res.status === 401 && !opts.quiet) { A.S.user = null; A.render(); throw Object.assign(new Error('Please sign in.'), { status: 401 }); }
    if (!res.ok) throw Object.assign(new Error((data && data.error) || `Request failed (${res.status})`), { status: res.status, conflict: data && data.conflict });
    return data;
  };

  /* ---- toast ---- */
  A.toast = function (msg, actLabel, act, id) {
    const root = document.getElementById('toast-root'), el = document.createElement('div'); el.className = 'toast';
    el.innerHTML = `<span>${A.esc(msg)}</span>${actLabel ? `<button data-action="${act}" data-id="${A.esc(id || '')}">${A.esc(actLabel)}</button>` : ''}`;
    root.replaceChildren(el); clearTimeout(A.toast.t); A.toast.t = setTimeout(() => el.remove(), actLabel ? 7000 : 4500);
  };

  /* ---- modal ---- */
  A.openModal = function (html) {
    A.session.lastFocus = document.activeElement;
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="scrim" data-action="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="mt">${html}</div></div>`;
    document.body.style.overflow = 'hidden';
    const first = root.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, button.btn.primary'); if (first) first.focus({ preventScroll: true });
  };
  A.closeModal = function () {
    document.getElementById('modal-root').innerHTML = ''; document.body.style.overflow = '';
    const f = A.session.lastFocus; if (f && document.contains(f)) f.focus({ preventScroll: true });
  };
  A.errorLine = (msg) => { const el = document.querySelector('#modal-root .form-error'); if (el) { el.textContent = msg; el.hidden = false; } else A.toast(msg); };
})();
