import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { sqlitePath } from '../engines.js';
import {
  assertReadOnlySql,
  backupValue,
  clampLimit,
  displayValue,
  restoreValue,
  topoSortTables,
} from './sqlsafe.js';
import { coerceSqlValue, createTableSql, recordColumns } from './seedwrite.js';

let sqliteModule;
async function lib() {
  if (!sqliteModule) {
    try {
      sqliteModule = await import('node:sqlite');
    } catch {
      throw new Error('SQLite support needs Node.js 22.13 or newer (built-in node:sqlite)');
    }
  }
  return sqliteModule;
}

const handles = new Map();

function q(ident) {
  return `"${String(ident).replace(/"/g, '""')}"`;
}

async function open(conn, { write = false } = {}) {
  const file = sqlitePath(conn.uri);
  if (!fs.existsSync(file)) {
    if (!write) throw new Error(`SQLite file not found: ${file}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
  }
  const { DatabaseSync } = await lib();
  if (write) return new DatabaseSync(file, { readOnly: false });
  const key = conn.id || file;
  let db = handles.get(key);
  if (!db) {
    db = new DatabaseSync(file, { readOnly: true });
    handles.set(key, db);
  }
  return db;
}

function iterate(stmt, ...params) {
  if (typeof stmt.iterate === 'function') return stmt.iterate(...params);
  return stmt.all(...params)[Symbol.iterator]();
}

function columnsOf(stmt, rowsArr) {
  if (typeof stmt.columns === 'function') return stmt.columns().map((c) => ({ name: c.name, type: c.type || '' }));
  return Object.keys(rowsArr[0] || {}).map((name) => ({ name }));
}

export const engine = 'sqlite';

export async function test(uri) {
  const started = Date.now();
  const file = sqlitePath(uri);
  if (!fs.existsSync(file)) throw new Error(`SQLite file not found: ${file}`);
  const { DatabaseSync } = await lib();
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare('SELECT sqlite_version() AS v').get();
    return { ok: true, version: row.v, database: path.basename(file), latencyMs: Date.now() - started };
  } finally {
    db.close();
  }
}

export async function listDatabases(conn) {
  const file = sqlitePath(conn.uri);
  const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
  return [{ name: 'main', sizeOnDisk: size, primary: true, file: path.basename(file) }];
}

export async function listObjects(conn) {
  const db = await open(conn);
  const list = db
    .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();
  return list.map((r) => {
    let rowsCount = 0;
    try {
      rowsCount = r.type === 'table' ? Number(db.prepare(`SELECT COUNT(*) AS n FROM ${q(r.name)}`).get().n) : 0;
    } catch {
      rowsCount = 0;
    }
    return { name: r.name, table: r.name, type: r.type, rows: rowsCount };
  });
}

function describeWith(db, name) {
  const master = db.prepare('SELECT type, sql FROM sqlite_master WHERE name = ?').get(name);
  if (!master) throw new Error(`Table ${name} not found`);
  const cols = db.prepare(`PRAGMA table_info(${q(name)})`).all();
  const fks = db.prepare(`PRAGMA foreign_key_list(${q(name)})`).all();
  const idx = db.prepare(`PRAGMA index_list(${q(name)})`).all();
  const fkCols = new Set(fks.map((f) => f.from));
  const pk = cols.filter((c) => c.pk).sort((a, b) => a.pk - b.pk).map((c) => c.name);
  let est = 0;
  try {
    est = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${q(name)}`).get().n);
  } catch {
    est = 0;
  }
  return {
    name,
    table: name,
    type: master.type,
    columns: cols.map((c) => ({
      name: c.name,
      type: c.type || 'ANY',
      nullable: !c.notnull && !c.pk,
      default: c.dflt_value,
      pk: Boolean(c.pk),
      fk: fkCols.has(c.name),
    })),
    primaryKey: pk,
    foreignKeys: fks.map((f) => ({ name: `fk_${name}_${f.id}`, column: f.from, refTable: f.table, refColumn: f.to })),
    indexes: idx.map((i) => {
      const parts = db.prepare(`PRAGMA index_info(${q(i.name)})`).all().map((p) => p.name);
      return { name: i.name, unique: Boolean(i.unique), primary: i.origin === 'pk', definition: `(${parts.join(', ')})` };
    }),
    estimatedCount: est,
    ddl: master.sql,
  };
}

export async function describe(conn, _db, name) {
  return describeWith(await open(conn), name);
}

function filterSql(filter, columns, params) {
  if (!filter?.column) return '';
  const col = columns.find((c) => c.name === filter.column);
  if (!col) throw new Error(`Unknown column ${filter.column}`);
  const ref = q(col.name);
  switch (filter.op) {
    case 'contains':
      params.push(`%${filter.value ?? ''}%`);
      return `WHERE CAST(${ref} AS TEXT) LIKE ?`;
    case 'null':
      return `WHERE ${ref} IS NULL`;
    case 'notnull':
      return `WHERE ${ref} IS NOT NULL`;
    case 'gt':
    case 'lt':
    case 'eq':
    case 'neq':
      params.push(filter.value ?? '');
      return `WHERE ${ref} ${{ gt: '>', lt: '<', eq: '=', neq: '<>' }[filter.op]} ?`;
    default:
      return '';
  }
}

export async function rows(conn, _db, name, { skip = 0, limit = 50, sort, filter } = {}) {
  const db = await open(conn);
  const meta = describeWith(db, name);
  const safeLimit = clampLimit(limit, 50, 500);
  const safeSkip = Math.max(Number(skip) || 0, 0);
  const params = [];
  const where = filterSql(filter, meta.columns, params);
  let order = '';
  if (sort?.column && meta.columns.some((c) => c.name === sort.column)) {
    order = `ORDER BY ${q(sort.column)} ${sort.dir === 'desc' ? 'DESC' : 'ASC'}`;
  } else if (meta.primaryKey.length) order = `ORDER BY ${meta.primaryKey.map(q).join(', ')}`;
  const stmt = db.prepare(`SELECT * FROM ${q(name)} ${where} ${order} LIMIT ${safeLimit} OFFSET ${safeSkip}`);
  const data = stmt.all(...params);
  const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${q(name)} ${where}`).get(...params).n);
  const columns = meta.columns.map((c) => ({ name: c.name, type: c.type }));
  return {
    columns,
    rows: data.map((r) => columns.map((c) => displayValue(r[c.name]))),
    total,
    exact: true,
    skip: safeSkip,
    limit: safeLimit,
    primaryKey: meta.primaryKey,
  };
}

export async function query(conn, _db, text, { limit = 500 } = {}) {
  const sql = assertReadOnlySql(text);
  const cap = clampLimit(limit, 500, 5000);
  const started = Date.now();
  const db = await open(conn);
  const stmt = db.prepare(sql);
  const arrays = typeof stmt.setReturnArrays === 'function';
  if (arrays) stmt.setReturnArrays(true);
  const out = [];
  let truncated = false;
  for (const row of iterate(stmt)) {
    if (out.length >= cap) {
      truncated = true;
      break;
    }
    out.push(row);
  }
  const columns = columnsOf(stmt, arrays ? [] : out);
  return {
    columns: columns.map((c) => ({ name: c.name })),
    rows: out.map((r) => (arrays ? r.map(displayValue) : columns.map((c) => displayValue(r[c.name])))),
    rowCount: out.length,
    truncated,
    durationMs: Date.now() - started,
  };
}

export async function graph(conn) {
  const db = await open(conn);
  const list = db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 300")
    .all();
  const tables = [];
  const relations = [];
  for (const { name } of list) {
    const d = describeWith(db, name);
    tables.push({
      name,
      type: d.type,
      rows: d.estimatedCount,
      columns: d.columns.map((c) => ({ name: c.name, type: c.type, pk: c.pk, fk: c.fk, nullable: c.nullable })),
    });
    for (const fk of d.foreignKeys) {
      relations.push({ from: name, fromColumn: fk.column, to: fk.refTable, toColumn: fk.refColumn || 'rowid' });
    }
  }
  return { tables, relations };
}

export async function dump(conn, _db, { objects, onProgress }, dir) {
  const file = sqlitePath(conn.uri);
  const { DatabaseSync, backup } = await lib();
  const db = new DatabaseSync(file, { readOnly: true });
  const summary = [];
  const schema = { engine, database: 'main', tables: [] };
  try {
    db.exec('BEGIN');
    const all = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((r) => r.name);
    const names = all.filter((n) => !objects?.length || objects.includes(n));
    if (objects?.length && !names.length) throw new Error('None of the selected tables exist');
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      const d = describeWith(db, name);
      const tdir = path.join(dir, 'tables', name);
      fs.mkdirSync(tdir, { recursive: true });
      const ws = fs.createWriteStream(path.join(tdir, 'rows.ndjson'));
      let count = 0;
      onProgress?.({ collection: name, collectionsDone: i, collectionsTotal: names.length });
      for (const row of iterate(db.prepare(`SELECT * FROM ${q(name)}`))) {
        const out = {};
        for (const [k, v] of Object.entries(row)) out[k] = backupValue(v);
        if (!ws.write(`${JSON.stringify(out)}\n`)) await once(ws, 'drain');
        count += 1;
      }
      ws.end();
      await once(ws, 'finish');
      schema.tables.push(d);
      summary.push({ name, count, indexes: d.indexes.length });
    }
    schema.indexDdl = db
      .prepare("SELECT tbl_name AS tbl, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL")
      .all()
      .filter((r) => names.includes(r.tbl))
      .map((r) => r.sql);
    db.exec('ROLLBACK');
  } finally {
    db.close();
  }
  // Full-fidelity copy of the file alongside the logical dump (whole database backups only).
  if (!objects?.length && typeof backup === 'function') {
    const src = new DatabaseSync(file, { readOnly: true });
    try {
      await backup(src, path.join(dir, 'database.sqlite'));
    } catch {
      // logical dump is still complete
    } finally {
      src.close();
    }
  }
  fs.writeFileSync(path.join(dir, 'schema.json'), JSON.stringify(schema, null, 2));
  return { summary };
}

export async function restoreCheck(conn, _db, names) {
  const db = await open(conn, { write: true });
  try {
    return names.map((name) => {
      const ex = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
      const n = ex ? Number(db.prepare(`SELECT COUNT(*) AS n FROM ${q(name)}`).get().n) : 0;
      return { name, exists: Boolean(ex), rows: n };
    });
  } finally {
    db.close();
  }
}

export async function restore(conn, _db, { schema, names, readRows, onProgress }) {
  const db = await open(conn, { write: true });
  const tables = schema.tables.filter((t) => names.includes(t.name));
  const order = topoSortTables(tables, tables.flatMap((t) => t.foreignKeys.map((fk) => ({ from: t.name, to: fk.refTable }))));
  const results = [];
  try {
    db.exec('BEGIN');
    for (const t of tables) {
      const ex = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t.name);
      if (!ex) db.exec(t.ddl);
    }
    for (const name of order) {
      const t = tables.find((x) => x.name === name);
      const cols = t.columns.map((c) => c.name);
      const stmt = db.prepare(`INSERT INTO ${q(name)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
      let inserted = 0;
      for await (const row of readRows(name)) {
        stmt.run(...cols.map((c) => {
          const v = restoreValue(row[c], { json: true });
          return typeof v === 'boolean' ? Number(v) : v;
        }));
        inserted += 1;
        if (inserted % 1000 === 0) onProgress?.({ collection: name, documents: inserted });
      }
      results.push({ name, inserted });
    }
    for (const sql of schema.indexDdl || []) {
      try {
        db.exec(sql);
      } catch {
        // index may already exist
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  } finally {
    db.close();
  }
  return results;
}

export async function close(connectionId) {
  const db = handles.get(connectionId);
  if (db) {
    handles.delete(connectionId);
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

export async function permissions(conn) {
  const file = sqlitePath(conn.uri);
  let writable = false;
  try {
    fs.accessSync(file, fs.constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }
  return {
    user: 'local-file',
    roles: [],
    canRead: true,
    canWrite: writable,
    canCreate: writable,
    canDrop: writable,
    canAdmin: writable,
    privileges: writable ? ['read', 'write'] : ['read'],
    details: [{ resource: path.basename(file), actions: writable ? ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE'] : ['SELECT'] }],
    notes: writable ? ['SQLite has no users. Permissions follow the file on disk.'] : ['The SQLite file is not writable by this process.'],
  };
}

export async function seedEnsure(conn, _db, object) {
  const db = await open(conn, { write: true });
  try {
    db.exec(createTableSql(object, 'sqlite', q, q(object.name)));
    return { name: object.name, created: true };
  } finally {
    db.close();
  }
}

export async function seedWipe(conn, _db, names) {
  const db = await open(conn, { write: true });
  const out = [];
  try {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    for (const name of names) {
      const info = db.prepare(`SELECT COUNT(*) AS n FROM ${q(name)}`).get();
      db.prepare(`DELETE FROM ${q(name)}`).run();
      out.push({ name, deleted: Number(info?.n) || 0 });
    }
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  } finally {
    try {
      db.exec('PRAGMA foreign_keys = ON');
    } catch {
      // ignore
    }
    db.close();
  }
}

export async function seedInsert(conn, _db, name, records) {
  if (!records?.length) return { name, inserted: 0 };
  const cols = recordColumns(records);
  const db = await open(conn, { write: true });
  try {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    const stmt = db.prepare(`INSERT INTO ${q(name)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
    for (const rec of records) {
      stmt.run(
        ...cols.map((c) => {
          const v = coerceSqlValue(rec[c], { json: true, engine: 'sqlite' });
          return typeof v === 'boolean' ? Number(v) : v;
        }),
      );
    }
    db.exec('COMMIT');
    return { name, inserted: records.length };
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  } finally {
    try {
      db.exec('PRAGMA foreign_keys = ON');
    } catch {
      // ignore
    }
    db.close();
  }
}

export async function insight(conn) {
  const file = sqlitePath(conn.uri);
  const db = await open(conn);
  const version = db.prepare('SELECT sqlite_version() AS v').get()?.v;
  const page = db.prepare('PRAGMA page_count').get();
  const pageSize = db.prepare('PRAGMA page_size').get();
  const journal = db.prepare('PRAGMA journal_mode').get();
  const objects = await listObjects(conn).catch(() => []);
  const size = fs.existsSync(file) ? fs.statSync(file).size : Number(page?.page_count || 0) * Number(pageSize?.page_size || 0);
  return {
    version,
    process: 'sqlite',
    topology: 'file',
    host: path.basename(file),
    instanceType: `SQLite ${version || ''}`.trim(),
    os: { type: 'file', name: path.basename(file), version },
    connections: { current: 1, available: 0, max: 1, active: 1, totalCreated: null },
    databases: [{ name: 'main', sizeOnDisk: size }],
    database: 'main',
    objects: (objects || []).slice(0, 40),
    dataSize: size,
    notes: journal?.journal_mode ? [`journal ${journal.journal_mode}`] : [],
  };
}

export async function lookupKeys(conn, _db, name, field, values) {
  const list = [...new Set((values || []).filter((v) => v != null && v !== ''))].slice(0, 200);
  if (!list.length) return [];
  const db = await open(conn);
  try {
    const stmt = db.prepare(`SELECT ${q(field)} AS k FROM ${q(name)} WHERE ${q(field)} = ?`);
    const found = [];
    for (const v of list) {
      const row = stmt.get(String(v));
      if (row) found.push(String(row.k));
    }
    return found;
  } finally {
    // read handle is cached
  }
}
