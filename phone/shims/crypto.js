import { sha1 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
const hex = (u) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
const bytes = (d) => (typeof d === 'string' ? new TextEncoder().encode(d) : d);
export function createHash(alg) {
  const fn = alg === 'sha1' ? sha1 : alg === 'sha256' ? sha256 : null; if (!fn) throw new Error('unsupported hash ' + alg);
  const chunks = []; const h = { update(d) { chunks.push(bytes(d)); return h; }, digest(enc) { const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; } const out = fn(all); return enc === 'hex' ? hex(out) : Buffer.from(out); } };
  return h;
}
export const randomBytes = (n) => Buffer.from(crypto.getRandomValues(new Uint8Array(n)));
const no = () => { throw new Error('not available in the phone edition'); };
export const scrypt = no, timingSafeEqual = no;
export default { createHash, randomBytes, scrypt, timingSafeEqual };
