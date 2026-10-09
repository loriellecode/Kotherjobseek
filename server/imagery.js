'use strict';
/* Editorial photography from Pexels (https://www.pexels.com/api/documentation/). The API key stays on the server;
 * the browser only receives photo URLs (Pexels CDN) plus the attribution Pexels asks for. Results are cached for a week
 * to stay well inside the 200 requests/hour default limit. These photos illustrate topics — they are never
 * presented as a picture of any employer or workplace. */
const config = require('./config');
const { now, j } = require('./db');

const TOPICS = {
  finance: 'finance accounting desk', business: 'business meeting office', education: 'classroom teacher students', 'special education': 'teacher helping student classroom',
  workforce: 'career counseling job seeker interview', banking: 'bank teller customer service',
  'professional development': 'professional learning workshop', 'career growth': 'career growth professional', 'remote work': 'working from home laptop', workplace: 'modern office workplace',
};
const TTL = 7 * 864e5;

function status() { return config.pexels.key ? { configured: true } : { configured: false, missing: ['PEXELS_API_KEY'] }; }

const KEEP = 8;
const shape = (pick) => ({ id: pick.id, pageUrl: pick.url, photographer: pick.photographer, photographerUrl: pick.photographer_url, alt: pick.alt || '', avgColor: pick.avg_color || null, width: pick.width, height: pick.height,
  src: { small: pick.src.small, medium: pick.src.medium, large: pick.src.large, large2x: pick.src.large2x }, source: 'Pexels', license: 'https://www.pexels.com/license/' });
/* The cache holds up to 8 photos per topic so cards on one page don't all show the same picture; `variant` picks one (stable within a day). */
const choose = (list, variant) => (list.length ? list[(Math.floor(now() / 864e5) + (Number(variant) || 0)) % list.length] : null);
const listOf = (d) => (d && Array.isArray(d.list) ? d.list : d && d.id ? [d] : []);

async function getImage(db, topic, variant) {
  topic = String(topic || '').toLowerCase();
  if (!TOPICS[topic]) return { configured: status().configured, photo: null, error: 'unknown topic' };
  if (!config.pexels.key) return { configured: false, photo: null };
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
