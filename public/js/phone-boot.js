/* Phone edition shim: sends the app's /api/* calls to the in-browser engine (engine.js) instead of a server. Does nothing when the
 * engine isn't present (the normal server edition). */
(function () {
  if (!document.querySelector('meta[name="kj-edition"][content="phone"]')) return;
  const realFetch = window.fetch.bind(window);
  const engineReady = new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = 'engine.js'; s.onload = resolve; s.onerror = () => reject(new Error('The app engine could not be loaded.')); document.head.appendChild(s); });
  const apiPath = (input) => { const u = new URL(typeof input === 'string' ? input : input.url, location.href); if (u.origin !== location.origin) return null; const i = u.pathname.indexOf('/api/'); return i >= 0 ? u.pathname.slice(i) + u.search : null; };
  window.fetch = async function (input, init) {
    const p = apiPath(input); if (!p) return realFetch(input, init);
    await engineReady; init = init || {};
    const headers = {}; new Headers(init.headers || (typeof input === 'object' && input.headers) || {}).forEach((v, k) => { headers[k] = v; });
    let body = init.body; if (body instanceof Blob) body = await body.arrayBuffer();
    const r = await window.KJ_PHONE.request((init.method || 'GET').toUpperCase(), p, headers, body);
    return new Response([204, 304].includes(r.status) ? null : r.body, { status: r.status, headers: r.headers });
  };
  // The résumé download link points at an API path; fetch it locally and save the file.
  document.addEventListener('click', async (e) => {
    const a = e.target.closest && e.target.closest('a[href$="/api/resume/file"]'); if (!a) return;
    e.preventDefault(); const r = await window.fetch('api/resume/file'); if (!r.ok) return;
    const blob = await r.blob(), cd = r.headers.get('content-disposition') || '', m = cd.match(/filename="?([^";]+)"?/), url = URL.createObjectURL(blob), l = document.createElement('a');
    l.href = url; l.download = m ? decodeURIComponent(m[1]) : 'resume'; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, true);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
