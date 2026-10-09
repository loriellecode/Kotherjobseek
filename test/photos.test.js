'use strict';
const t = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { boot } = require('./helpers');
const dir = path.join(__dirname, '..', 'public', 'photos');
t.describe('bundled / local photos (used when no Pexels key is set)', () => {
  t.it('serves your own photos with credits, falls back to “any”, and shows none when the folder is empty', async () => {
    const had = fs.existsSync(dir); fs.mkdirSync(path.join(dir, 'finance'), { recursive: true }); fs.mkdirSync(path.join(dir, 'any'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'finance', 'desk.jpg'), 'x'); fs.writeFileSync(path.join(dir, 'any', 'office.png'), 'x'); fs.writeFileSync(path.join(dir, 'credits.json'), JSON.stringify({ 'finance/desk.jpg': { photographer: 'Test Person', url: 'https://example.com/p' } }));
    const cfg = require('../server/config'), key = cfg.pexels.key; cfg.pexels.key = '';
    const env = await boot(), c = await env.signup();
    try {
      const f = (await c.req('GET', '/api/imagery/finance')).data; assert.equal(f.photo.src.medium, '/photos/finance/desk.jpg'); assert.equal(f.photo.photographer, 'Test Person'); assert.equal(f.photo.pageUrl, 'https://example.com/p');
      const b = (await c.req('GET', '/api/imagery/business')).data; assert.equal(b.photo.src.medium, '/photos/any/office.png'); assert.equal(b.photo.photographer, 'a free-license photographer');
      assert.equal((await c.req('GET', '/photos/finance/desk.jpg')).status, 200);
      fs.rmSync(path.join(dir, 'finance'), { recursive: true }); fs.rmSync(path.join(dir, 'any'), { recursive: true }); assert.equal((await c.req('GET', '/api/imagery/finance')).data.photo, null);
    } finally { cfg.pexels.key = key; env.close(); fs.rmSync(path.join(dir, 'credits.json'), { force: true }); if (!had) fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
