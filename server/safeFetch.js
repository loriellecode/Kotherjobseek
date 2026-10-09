'use strict';
/* A deliberately small, SSRF-resistant fetcher used ONLY to re-check an application destination when a check is requested.
 *   - http/https only, default ports only, no credentials in the URL
 *   - the host is resolved first and every address must be public (no loopback, private, link-local, CGNAT, multicast, reserved, or IPv6 equivalents)
 *   - redirects are followed by hand (max 3) and every hop is re-validated the same way
 *   - body capped (200 KB), 6 s timeout, text/html (or plain text) only; the content is only ever searched as text — never rendered or executed
 * Known limit: a DNS answer could change between our lookup and the connection (DNS rebinding); the connection is made to the address we validated to keep that window closed. */
const dns = require('node:dns').promises, net = require('node:net'), http = require('node:http'), https = require('node:https');

function privateV4(a) {
  const [p, q] = a.split('.').map(Number);
  return p === 0 || p === 10 || p === 127 || (p === 100 && q >= 64 && q <= 127) || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 0) || (p === 192 && q === 168) || (p === 198 && (q === 18 || q === 19)) || p >= 224;
}
function isPublicIp(ip) {
  if (net.isIPv4(ip)) return !privateV4(ip);
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    const m = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (m) return !privateV4(m[1]);
    return !(x === '::' || x === '::1' || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb') || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('ff') || x.startsWith('2001:db8'));
  }
  return false;
}
async function resolvePublic(host, opts) {
  if (net.isIP(host)) { if (!opts.allowPrivate && !isPublicIp(host)) throw new Error('blocked address'); return host; }
  const list = await (opts.lookup || ((h) => dns.lookup(h, { all: true })))(host);
  const addrs = (Array.isArray(list) ? list : [list]).map((x) => x.address || x);
  if (!addrs.length) throw new Error('no address');
  if (!opts.allowPrivate && !addrs.every(isPublicIp)) throw new Error('blocked address');
  return addrs[0];
}
function once(u, ip, opts) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({ host: ip, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: 'GET', servername: u.hostname, timeout: opts.timeoutMs || 6000,
      headers: { host: u.host, 'user-agent': 'KotherJobCheck/1.0 (link check; no scripts executed)', accept: 'text/html,text/plain;q=0.9', 'accept-encoding': 'identity' } }, (res) => {
      const status = res.statusCode, loc = res.headers.location, type = String(res.headers['content-type'] || '');
      if (status >= 300 && status < 400 && loc) { res.resume(); return resolve({ status, location: loc }); }
      if (!/^text\/(html|plain)|application\/xhtml/i.test(type)) { res.resume(); return resolve({ status, text: '', type }); }
      const chunks = []; let n = 0; const max = opts.maxBytes || 200000;
      res.on('data', (c) => { n += c.length; if (n > max) { res.destroy(); resolve({ status, text: Buffer.concat(chunks).toString('utf8'), type, truncated: true }); } else chunks.push(c); });
      res.on('end', () => resolve({ status, text: Buffer.concat(chunks).toString('utf8'), type }));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error('timed out')); }); req.on('error', reject); req.end();
  });
}
/* Returns { ok, status, finalUrl, hops, text } or { ok:false, error }. Never throws. */
async function safeFetch(rawUrl, opts) {
  opts = opts || {}; const hops = [];
  try {
    let u = new URL(rawUrl);
    for (let i = 0; i <= 3; i++) {
      if (!/^https?:$/.test(u.protocol) || u.username || u.password || (u.port && !opts.allowAnyPort && u.port !== (u.protocol === 'https:' ? '443' : '80'))) return { ok: false, error: 'unsupported address', hops };
      const ip = await resolvePublic(u.hostname.replace(/^\[|\]$/g, ''), opts);
      hops.push(u.href);
      const r = await once(u, ip, opts);
      if (r.location) { u = new URL(r.location, u); continue; }
      return { ok: true, status: r.status, finalUrl: u.href, hops, text: r.text || '', type: r.type, truncated: !!r.truncated };
    }
    return { ok: false, error: 'too many redirects', hops };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 120), hops }; }
}
module.exports = { safeFetch, isPublicIp };
