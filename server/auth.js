'use strict';
const crypto = require('node:crypto');
const { HttpError, sha256 } = require('./http');

const SESSION_DAYS = 30;
const scryptAsync = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));

async function hashPassword(pw) { const salt = crypto.randomBytes(16); return `scrypt$${salt.toString('hex')}$${(await scryptAsync(pw, salt)).toString('hex')}`; }
async function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const got = await scryptAsync(pw, Buffer.from(saltHex, 'hex')), want = Buffer.from(hashHex, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
function validateCreds(email, password) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]{1,64}@[^@\s]{1,255}$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  if (typeof password !== 'string' || password.length < 10) throw new HttpError(400, 'Use a password with at least 10 characters.');
  if (password.length > 200) throw new HttpError(400, 'Password is too long.');
  return email;
}
function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(sha256(token), userId, Date.now() + SESSION_DAYS * 864e5);
  return { token, maxAge: SESSION_DAYS * 86400 };
}
function userFromToken(db, token) {
  if (!token) return null;
  const row = db.prepare('SELECT u.id, u.email, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(sha256(token));
  if (!row) return null;
  if (row.expires_at < Date.now()) { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(token)); return null; }
  return { id: row.id, email: row.email };
}
const destroySession = (db, token) => token && db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(token));
module.exports = { hashPassword, verifyPassword, validateCreds, createSession, userFromToken, destroySession };
