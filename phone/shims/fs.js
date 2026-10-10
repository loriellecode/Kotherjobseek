/* A tiny in-memory file system (persisted to IndexedDB by the engine) — enough for what the server code reads and writes. */
const files = new Map(), dirs = new Set(['/']);
const norm = (p) => { const parts = []; for (const s of String(p).split('/')) { if (!s || s === '.') continue; if (s === '..') parts.pop(); else parts.push(s); } return '/' + parts.join('/'); };
const enoent = (p) => Object.assign(new Error(`ENOENT: no such file or directory, '${p}'`), { code: 'ENOENT' });
let onChange = () => {};
export const __vfs = { files, dirs, setOnChange(fn) { onChange = fn; } };
export const existsSync = (p) => { p = norm(p); return files.has(p) || dirs.has(p); };
export const mkdirSync = (p) => { p = norm(p); let cur = ''; for (const s of p.split('/').filter(Boolean)) { cur += '/' + s; dirs.add(cur); } };
export const writeFileSync = (p, data) => { p = norm(p); mkdirSync(p.slice(0, p.lastIndexOf('/')) || '/'); files.set(p, typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)); onChange(); };
export const readFileSync = (p, enc) => { const f = files.get(norm(p)); if (!f) throw enoent(p); return enc ? new TextDecoder().decode(f) : Buffer.from(f); };
export const unlinkSync = (p) => { if (!files.delete(norm(p))) throw enoent(p); onChange(); };
export const statSync = (p) => { p = norm(p); if (files.has(p)) return { isFile: () => true, isDirectory: () => false, size: files.get(p).length }; if (dirs.has(p)) return { isFile: () => false, isDirectory: () => true, size: 0 }; throw enoent(p); };
export const readdirSync = (p) => { p = norm(p); if (!dirs.has(p)) throw enoent(p); const pre = p === '/' ? '/' : p + '/', out = new Set(); for (const k of [...files.keys(), ...dirs]) if (k.startsWith(pre) && k !== p) out.add(k.slice(pre.length).split('/')[0]); return [...out]; };
export const rmSync = (p) => { p = norm(p); files.delete(p); for (const k of [...files.keys()]) if (k.startsWith(p + '/')) files.delete(k); onChange(); };
export const createReadStream = () => { throw new Error('not available'); };
export default { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, statSync, readdirSync, rmSync, createReadStream };
