'use strict';
/* LIVE provider checks. They run only when real credentials are present AND LIVE_PROVIDER_TESTS=1, and make a handful of real requests.
 *   ADZUNA_APP_ID/ADZUNA_APP_KEY, USAJOBS_API_KEY/USAJOBS_USER_EMAIL, PEXELS_API_KEY
 * Without credentials every test is SKIPPED (not passed) so the report can't mistake mocks for real verification. */
const t = require('node:test');
const assert = require('node:assert/strict');
const live = process.env.LIVE_PROVIDER_TESTS === '1';
const need = (name, ...vars) => (!live ? 'set LIVE_PROVIDER_TESTS=1' : vars.every((v) => process.env[v]) ? false : `missing ${vars.filter((v) => !process.env[v]).join(', ')}`);

t.describe('LIVE providers (skipped unless credentials are configured)', () => {
  t.it('Adzuna: real search near Stockton returns well-formed listings', { skip: need('adzuna', 'ADZUNA_APP_ID', 'ADZUNA_APP_KEY') }, async () => {
    const adz = require('../server/providers/adzuna'); const { listings } = await adz.search({ what: 'accountant', where: 'Stockton, CA', radiusMiles: 30 }, { maxPages: 1, pageSize: 10 });
    assert.ok(listings.length > 0, 'at least one listing'); for (const l of listings) { assert.ok(l.externalId && l.title && l.employer && /^https?:\/\//.test(l.applyUrl)); }
    console.log('LIVE Adzuna sample:', JSON.stringify(listings[0]).slice(0, 300));
  });
  t.it('USAJOBS: real search returns well-formed listings', { skip: need('usajobs', 'USAJOBS_API_KEY', 'USAJOBS_USER_EMAIL') }, async () => {
    const u = require('../server/providers/usajobs'); const { listings } = await u.search({ what: 'budget analyst', where: 'California', radiusMiles: 0 }, { pageSize: 10 });
    assert.ok(listings.length >= 0); for (const l of listings) assert.ok(l.externalId && l.title && /^https?:\/\//.test(l.applyUrl));
  });
  t.it('Pexels: a real topic search returns a photo with attribution', { skip: need('pexels', 'PEXELS_API_KEY') }, async () => {
    const r = await fetch('https://api.pexels.com/v1/search?query=finance&per_page=1', { headers: { Authorization: process.env.PEXELS_API_KEY } }); assert.equal(r.status, 200);
    const d = await r.json(); assert.ok(d.photos[0].photographer && d.photos[0].url && d.photos[0].src.medium.startsWith('https://images.pexels.com/'));
  });
});
