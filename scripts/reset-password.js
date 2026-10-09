#!/usr/bin/env node
/* Usage: node scripts/reset-password.js user@example.com 'new long password'
 * There is no email-based reset (the app never sends email), so the operator resets passwords here. Signs the user out everywhere. */
const path = require('node:path');
const { open } = require('../server/db');
const config = require('../server/config');
const auth = require('../server/auth');
const [email, pw] = [String(process.argv[2] || '').toLowerCase(), process.argv[3]];
if (!email || !pw || pw.length < 10) { console.error('Usage: node scripts/reset-password.js <email> <password of 10+ characters>'); process.exit(1); }
const db = open(path.join(config.dataDir, 'kother.db'));
const u = db.prepare('SELECT id FROM users WHERE email=?').get(email);
if (!u) { console.error('No such account.'); process.exit(1); }
auth.hashPassword(pw).then((h) => { db.prepare('UPDATE users SET pw_hash=? WHERE id=?').run(h, u.id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id); console.log('Password updated; all sessions ended.'); });
