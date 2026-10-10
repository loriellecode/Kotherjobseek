'use strict';
/* Editorial photography from Pexels (https://www.pexels.com/api/documentation/). The API key stays on the server;
 * the browser only receives photo URLs (Pexels CDN) plus the attribution Pexels asks for. Results are cached for a week
 * to stay well inside the 200 requests/hour default limit. These photos illustrate topics — they are never
 * presented as a picture of any employer or workplace. */
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { now, j } = require('./db');

const TOPICS = {
  finance: 'finance accounting desk', business: 'business meeting office', education: 'classroom teacher students', 'special education': 'teacher helping student classroom',
  workforce: 'career counseling job seeker interview', banking: 'bank teller customer service',
  'professional development': 'professional learning workshop', 'career growth': 'career growth professional', 'remote work': 'working from home laptop', workplace: 'modern office workplace',
};
const TTL = 7 * 864e5;

const PHOTO_DIR = process.env.PHOTO_DIR || path.join(__dirname, '..', 'public', 'photos');
const slug = (t) => String(t).replace(/[^a-z0-9]+/g, '-');
/* Your own free photos: put .jpg/.jpeg/.png/.webp files in public/photos/<topic>/ (e.g. public/photos/finance/) — or public/photos/any/ for all topics —
 * and optionally credit them in public/photos/credits.json: { "finance/desk.jpg": { "photographer": "Name", "url": "https://…" } }. Used only when no Pexels key is set. */
function localPhotos(topic) {
  let credits = {}; try { credits = JSON.parse(fs.readFileSync(path.join(PHOTO_DIR, 'credits.json'), 'utf8')); } catch (_) { /* optional */ }
  const out = [];
  for (const dir of [slug(topic), 'any']) {
    let files = []; try { files = fs.readdirSync(path.join(PHOTO_DIR, dir)).filter((f) => /^[\w.\- ]+\.(jpe?g|png|webp)$/i.test(f)).sort(); } catch (_) { continue; }
    for (const f of files) { const rel = `${dir}/${f}`, c = credits[rel] || {}, src = '/photos/' + rel.split('/').map(encodeURIComponent).join('/');
      out.push({ id: rel, pageUrl: /^https:\/\//.test(c.url || '') ? c.url : '', photographer: c.photographer || 'a free-license photographer', photographerUrl: '', alt: '', avgColor: null, width: 1600, height: 1067, src: { small: src, medium: src, large: src, large2x: src }, source: c.source || 'Free photo', license: c.license || '' }); }
    if (out.length) break;
  }
  return out;
}
const localCount = () => { try { return fs.readdirSync(PHOTO_DIR, { recursive: true }).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).length; } catch (_) { return 0; } };
function status() { return config.pexels.key ? { configured: true } : localCount() ? { configured: true, local: true } : { configured: false, missing: ['PEXELS_API_KEY (or your own photos in public/photos/)'] }; }

const KEEP = 8;
const shape = (pick) => ({ id: pick.id, pageUrl: pick.url, photographer: pick.photographer, photographerUrl: pick.photographer_url, alt: pick.alt || '', avgColor: pick.avg_color || null, width: pick.width, height: pick.height,
  src: { small: pick.src.small, medium: pick.src.medium, large: pick.src.large, large2x: pick.src.large2x }, source: 'Pexels', license: 'https://www.pexels.com/license/' });
/* The cache holds up to 8 photos per topic so cards on one page don't all show the same picture; `variant` picks one (stable within a day). */
const choose = (list, variant) => (list.length ? list[(Math.floor(now() / 864e5) + (Number(variant) || 0)) % list.length] : null);
const listOf = (d) => (d && Array.isArray(d.list) ? d.list : d && d.id ? [d] : []);

async function getImage(db, topic, variant) {
  topic = String(topic || '').toLowerCase();
  if (!TOPICS[topic]) return { configured: status().configured, photo: null, error: 'unknown topic' };
  if (!config.pexels.key) { const l = localPhotos(topic); return l.length ? { configured: true, photo: choose(l, variant), local: true } : { configured: false, photo: null }; }
  const row = db.prepare('SELECT * FROM images WHERE topic=?').get(topic);
  if (row && now() - row.fetched_at < TTL) return { configured: true, photo: choose(listOf(j(row.data, null)), variant) };
  try {
    const p = new URLSearchParams({ query: TOPICS[topic], orientation: 'landscape', size: 'medium', per_page: '15' });
    const res = await fetch(`${config.pexels.base}/search?${p}`, { headers: { Authorization: config.pexels.key }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Pexels returned HTTP ${res.status}`);
    const data = await res.json();
    const photos = (data.photos || []).filter((x) => x && x.src && x.photographer && x.url);
    if (!photos.length) throw new Error('no photos returned');
    const list = photos.slice(0, KEEP).map(shape);
    db.prepare('INSERT INTO images(topic,data,fetched_at) VALUES(?,?,?) ON CONFLICT(topic) DO UPDATE SET data=excluded.data, fetched_at=excluded.fetched_at').run(topic, JSON.stringify({ list }), now());
    return { configured: true, photo: choose(list, variant) };
  } catch (e) {
    if (row) return { configured: true, photo: choose(listOf(j(row.data, null)), variant), stale: true };
    return { configured: true, photo: null, error: 'Image service unavailable' };
  }
}
module.exports = { getImage, status, TOPICS };
