/* A `node:sqlite` DatabaseSync look-alike on top of sql.js (SQLite compiled to WebAssembly), persisted to IndexedDB.
 * Only the calls the app uses are implemented: exec, prepare(...).run/get/all, close. */
const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'bigint' ? Number(v) : v);
const args = (a) => a.map(norm);

class StatementSync {
  constructor(db, sql) { this.db = db; this.sql = sql; }
  run(...p) {
    const d = this.db.raw; d.run(this.sql, args(p)); const changes = d.getRowsModified(); this.db._dirty();
    const r = d.exec('SELECT last_insert_rowid() AS id'); return { changes, lastInsertRowid: r[0].values[0][0] };
  }
  get(...p) { const s = this.db.raw.prepare(this.sql); try { s.bind(args(p)); return s.step() ? s.getAsObject() : undefined; } finally { s.free(); } }
  all(...p) { const s = this.db.raw.prepare(this.sql), out = []; try { s.bind(args(p)); while (s.step()) out.push(s.getAsObject()); return out; } finally { s.free(); } }
}
export class DatabaseSync {
  constructor() {
    const SQL = globalThis.__KJ_SQL, bytes = globalThis.__KJ_DB_BYTES;
    this.raw = bytes ? new SQL.Database(bytes) : new SQL.Database(); this.timer = null; this.persist = globalThis.__KJ_PERSIST || (() => {});
  }
  exec(sql) { this.raw.exec(sql); this._dirty(); }
  prepare(sql) { return new StatementSync(this, sql); }
  close() { this.flush(); this.raw.close(); }
  _dirty() { if (this.inTx) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 400); }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    const bytes = this.raw.export(); this.raw.exec('PRAGMA foreign_keys = ON'); // export() resets connection settings
    this.persist(bytes);
  }
}
