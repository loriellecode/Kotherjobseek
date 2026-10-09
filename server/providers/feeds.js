'use strict';
/* Employer career pages / public feeds that publish schema.org JobPosting JSON-LD (the format search engines use).
 * Configure feeds in config/employer-feeds.json. Every fetch checks the site's robots.txt first and identifies itself.
 * No site is scraped unless the operator lists it AND robots.txt allows it. Sites without a permitted feed are not covered. */
const fs = require('node:fs');
const config = require('../config');
const { ProviderError } = require('./util');
const { htmlToText } = require('../normalize');

const cfg = () => config.providers.feeds;
function loadFeeds() {
  try { const d = JSON.parse(fs.readFileSync(cfg().file, 'utf8')); return (Array.isArray(d) ? d : d.feeds || []).filter((f) => f && f.name && /^https:\/\//.test(f.url)); } catch (_) { return []; }
}
const robotsCache = new Map();
async function allowedByRobots(url) {
  const u = new URL(url), origin = u.origin;
  let rules = robotsCache.get(origin);
  if (!rules || Date.now() - rules.at > 36e5) {
    rules = { at: Date.now(), disallow: [], ok: true };
    try {
      const res = await fetch(`${origin}/robots.txt`, { headers: { 'User-Agent': cfg().userAgent }, signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        let applies = false, any = false; const dis = [];
        for (const raw of (await res.text()).split('\n')) {
          const line = raw.split('#')[0].trim(), m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
          const k = m[1].toLowerCase(), v = m[2].trim();
          if (k === 'user-agent') { const ua = v.toLowerCase(); applies = ua === '*' || cfg().userAgent.toLowerCase().startsWith(ua); any = any || applies; }
          else if (k === 'disallow' && applies && v) dis.push(v);
        }
        rules.disallow = dis;
      } else if (res.status >= 500) rules.ok = false; // be conservative if robots.txt cannot be read
    } catch (_) { rules.ok = false; }
    robotsCache.set(origin, rules);
  }
  if (!rules.ok) return false;
  return !rules.disallow.some((d) => (u.pathname + u.search).startsWith(d.replace(/\*$/, '')));
}
function collectPostings(node, out) {
  if (!node) return out;
  if (Array.isArray(node)) { node.forEach((n) => collectPostings(n, out)); return out; }
  if (typeof node !== 'object') return out;
  const t = node['@type']; if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) out.push(node);
  for (const k of ['@graph', 'itemListElement', 'item', 'mainEntity', 'hasPart']) if (node[k]) collectPostings(node[k], out);
  return out;
}
function mapPosting(p, feed) {
  const org = typeof p.hiringOrganization === 'string' ? { name: p.hiringOrganization } : p.hiringOrganization || {};
  const locArr = [].concat(p.jobLocation || []); const addr = (locArr[0] && locArr[0].address) || {};
  const sal = p.baseSalary && (p.baseSalary.value || p.baseSalary), unit = String((sal && sal.unitText) || '').toUpperCase();
  const period = { YEAR: 'year', HOUR: 'hour', MONTH: 'month', WEEK: 'week' }[unit] || null;
  const type = [].concat(p.employmentType || []).join(' ').replace(/_/g, ' ');
  const id = (p.identifier && (p.identifier.value || p.identifier)) || p.url;
  if (!p.title || !id) return null;
  const city = addr.addressLocality || null;
  return { externalId: `${feed.name}:${typeof id === 'object' ? JSON.stringify(id) : id}`, title: p.title, employer: org.name || feed.name, logoUrl: typeof org.logo === 'string' ? org.logo : org.logo && org.logo.url,
    locationText: [city, addr.addressRegion].filter(Boolean).join(', '), city, state: addr.addressRegion || null, remote: /TELECOMMUTE/i.test(p.jobLocationType || '') ? true : undefined,
    salaryMin: sal && (sal.minValue ?? sal.value), salaryMax: sal && (sal.maxValue ?? sal.value), salaryPeriod: period, type, published: p.datePosted, deadline: p.validThrough,
    description: htmlToText(p.description), applyUrl: p.url || feed.url, canonicalUrl: p.url, feedHost: new URL(feed.url).hostname };
}

module.exports = {
  id: 'feeds', name: 'Employer career pages (JSON-LD)', kind: 'feed', docs: 'https://schema.org/JobPosting',
  setup: ['Create config/employer-feeds.json: [{"name":"Example District","url":"https://careers.example.org/jobs"}]', 'Only list pages whose terms allow automated reading; robots.txt is checked on every fetch', 'Restart the server'],
  budget: () => 1000,
  configured() { const n = loadFeeds().length; return { ok: n > 0, missing: n ? [] : ['config/employer-feeds.json (no feeds listed)'] }; },
  queriesFor() { return loadFeeds().map((f) => ({ what: f.name, where: '', feed: f, key: `feed:${f.name}` })); },
  async search(query) {
    const feed = query.feed;
    if (!(await allowedByRobots(feed.url))) throw new ProviderError(`${feed.name}: robots.txt does not allow automated access (or could not be read), so this page was not fetched.`);
    const res = await fetch(feed.url, { headers: { 'User-Agent': cfg().userAgent + (cfg().contact ? ` (+${cfg().contact})` : ''), Accept: 'text/html,application/ld+json' }, signal: AbortSignal.timeout(20000) }).catch((e) => { throw new ProviderError(`${feed.name} is unreachable: ${(e.cause && e.cause.code) || e.message}`); });
    if (!res.ok) throw new ProviderError(`${feed.name} returned HTTP ${res.status}.`, res.status);
    const html = await res.text(), posts = [];
    for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) { try { collectPostings(JSON.parse(m[1]), posts); } catch (_) { /* ignore malformed block */ } }
    return { listings: posts.map((p) => mapPosting(p, feed)).filter(Boolean), total: posts.length };
  },
  _mapPosting: mapPosting, _collect: collectPostings,
};
