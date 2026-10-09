#!/usr/bin/env node
/* Usage: node scripts/seed-profile.js user@example.com
 * Applies config/initial-profile.json to an EXISTING account (only once). Education is stored unverified. */
const path = require('node:path');
const { open } = require('../server/db');
const config = require('../server/config');
const P = require('../server/profile');
const email = String(process.argv[2] || '').toLowerCase();
if (!email) { console.error('Usage: node scripts/seed-profile.js <account email>'); process.exit(1); }
const db = open(path.join(config.dataDir, 'kother.db'));
const u = db.prepare('SELECT id FROM users WHERE email=?').get(email);
if (!u) { console.error('No such account.'); process.exit(1); }
P.ensureProfile(db, u.id);
console.log(JSON.stringify(P.applyInitialProfile(db, u.id)));
