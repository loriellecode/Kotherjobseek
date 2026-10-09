'use strict';
class ProviderError extends Error { constructor(message, status) { super(message); this.status = status; } }

/* fetch JSON with timeout. Error messages never include the request URL (it contains credentials). */
async function fetchJson(url, { headers = {}, redact = [], provider = 'Provider', timeoutMs = 20000 } = {}) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs);
  const scrub = (s) => redact.filter(Boolean).reduce((t, secret) => t.split(secret).join('***'), String(s));
  try {
    const res = await fetch(url, { headers: Object.assign({ Accept: 'application/json' }, headers), signal: ctl.signal });
    if (res.status === 401 || res.status === 403) throw new ProviderError(`${provider} rejected the credentials (HTTP ${res.status}). Check the configured keys.`, res.status);
    if (res.status === 429) throw new ProviderError(`${provider} rate limit reached (HTTP 429). It will be retried later.`, 429);
    if (!res.ok) throw new ProviderError(`${provider} returned HTTP ${res.status}.`, res.status);
    try { return await res.json(); } catch (_) { throw new ProviderError(`${provider} returned a response that is not valid JSON.`); }
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (e.name === 'AbortError') throw new ProviderError(`${provider} did not respond in time.`);
    throw new ProviderError(`${provider} is unreachable: ${scrub((e.cause && e.cause.code) || e.message)}`);
  } finally { clearTimeout(timer); }
}
module.exports = { ProviderError, fetchJson };
