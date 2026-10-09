'use strict';
/* Application-link safety. We cannot certify that any third-party website is safe, so this does the checks that are possible
 * before a link is ever shown, and tells the user honestly what we know.
 *   trusted  — https on the provider's own official domain (usajobs.gov), the employer-feed's own domain, or a .gov/.edu site
 *   redirect — https via a job board (Adzuna) that forwards to the employer's site
 *   caution  — https (or http) on a domain we don't recognise, or a look-alike (punycode) address: the user is warned before opening
 *   blocked  — never shown: embedded credentials, IP-address/local hosts, URL shorteners, non-http(s) schemes
 * (Optional hardening: check URLs against a reputation service such as Google Safe Browsing — not configured here.) */
const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'tiny.cc', 'rb.gy', 'lnkd.in']);
const PROVIDER_HOSTS = { usajobs: ['usajobs.gov'], adzuna: ['adzuna.com'] };
const onDomain = (host, d) => host === d || host.endsWith('.' + d);

function classify(rawUrl, provider, ctx) {
  ctx = ctx || {};
  let u; try { u = new URL(String(rawUrl)); } catch (_) { return { url: null, level: 'blocked', host: '', notes: ['The link is not a valid web address.'] }; }
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const block = (why) => ({ url: null, level: 'blocked', host, notes: [why] });
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return block('The link doesn’t use a normal web address (http/https).');
  if (u.username || u.password) return block('The link contains embedded login details, a common sign of a deceptive address.');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host === 'localhost' || /\.(local|internal|localhost|lan)$/.test(host) || !host.includes('.')) return block('The link points to a raw IP address or a local/internal host, not a public employer website.');
  if (SHORTENERS.has(host)) return block('The link is a URL shortener, which hides where it really goes.');
  const notes = [];
  if (host.split('.').some((l) => l.startsWith('xn--'))) { notes.push('The address uses international look-alike characters. Check it carefully.'); return { url: u.href, level: 'caution', host, notes }; }
  if (u.protocol === 'http:') { notes.push('This site does not use an encrypted (https) connection. Don’t enter personal information on it.'); return { url: u.href, level: 'caution', host, notes }; }
  if ((PROVIDER_HOSTS[provider] || []).some((d) => onDomain(host, d))) return { url: u.href, level: provider === 'adzuna' ? 'redirect' : 'trusted', host, notes: provider === 'adzuna' ? ['Opens Adzuna, which forwards you to the employer’s application page.'] : ['Official government job site.'] };
  if (provider === 'feeds' && ctx.feedHost && onDomain(host, ctx.feedHost.replace(/^www\./, ''))) return { url: u.href, level: 'trusted', host, notes: ['Same website as the employer’s own careers page.'] };
  if (/\.(gov|edu)$/.test(host) || /\.k12\.[a-z]{2}\.us$/.test(host)) return { url: u.href, level: 'trusted', host, notes: ['Government or education website.'] };
  notes.push(provider === 'import' ? 'This link came from a file you imported, so we can’t vouch for it.' : 'We don’t recognize this as the job provider’s or the employer’s official website.');
  return { url: u.href, level: 'caution', host, notes };
}
module.exports = { classify };
