import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import mysql from 'mysql2/promise';
import {
  assertReadOnlySql,
  backupValue,
  clampLimit,
  displayValue,
  restoreValue,
  topoSortTables,
} from './sqlsafe.js';

const pools = new Map();
const SYSTEM_DBS = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);

function normalizeUri(uri) {
  return String(uri).replace(/^mariadb:\/\//i, 'mysql://');
}

function options(uri, database) {
  const opts = {
    uri: normalizeUri(uri),
    connectTimeout: 10_000,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    multipleStatements: false,
  };
  if (database) opts.database = database;
  return opts;
}

function q(ident) {
  return `\`${String(ident).replace(/`/g, '``')}\``;
}

function defaultDb(uri) {
  try {
    return decodeURIComponent(new URL(normalizeUri(uri)).pathname.replace(/^\//, '')) || '';
  } catch {
    return '';
  }
}

function pool(conn, db) {
  const key = `${conn.id}:${db || ''}`;
  let p = pools.get(key);
  if (!p) {
    p = mysql.createPool({ ...options(conn.uri, db), connectionLimit: 4, maxIdle: 2, idleTimeout: 60_000 });
    pools.set(key, p);
  }
  return p;
}

async function applyTimeout(c, ms) {
  await c.query(`SET SESSION max_execution_time = ${Number(ms)}`).catch(() => {});
  await c.query(`SET SESSION max_statement_time = ${Number(ms) / 1000}`).catch(() => {});
}

async function readOnly(conn, db, fn, { timeoutMs = 30_000 } = {}) {
  const c = await pool(conn, db).getConnection();
  let destroy = false;
  try {
    await applyTimeout(c, timeoutMs);
    await c.query('START TRANSACTION READ ONLY');
    return await fn(c, () => {
      destroy = true;
    });
  } finally {
    if (destroy) c.destroy();
    else {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  }
}

export const engine = 'mysql';

export async function test(uri) {
  const started = Date.now();
  const c = await mysql.createConnection(options(uri));
  try {
    const [rows] = await c.query('SELECT VERSION() AS v, DATABASE() AS db');
    const v = String(rows[0].v);
    return {
      ok: true,
      version: v.split('-')[0],
      flavor: /mariadb/i.test(v) ? 'mariadb' : 'mysql',
      database: rows[0].db,
      latencyMs: Date.now() - started,
    };
  } finally {
    await c.end().catch(() => {});
  }
}

export async function listDatabases(conn) {
  const primary = defaultDb(conn.uri);
  return readOnly(conn, primary, async (c) => {
    const [rows] = await c.query(
      `SELECT s.SCHEMA_NAME AS name, COALESCE(SUM(t.DATA_LENGTH + t.INDEX_LENGTH), 0) AS size
         FROM information_schema.SCHEMATA s LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = s.SCHEMA_NAME
        GROUP BY s.SCHEMA_NAME ORDER BY s.SCHEMA_NAME`,
    );
    return rows
      .filter((r) => !SYSTEM_DBS.has(r.name))
      .map((r) => ({ name: r.name, sizeOnDisk: Number(r.size) || 0, primary: r.name === primary }));
  });
}

export async function listObjects(conn, db) {
  return readOnly(conn, db, async (c) => {
    const [rows] = await c.query(
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_ROWS AS est, DATA_LENGTH + INDEX_LENGTH AS size
         FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
      [db],
    );
    return rows.map((r) => ({
      name: r.name,
      table: r.name,
      type: /view/i.test(r.type) ? 'view' : 'table',
      rows: Number(r.est) || 0,
      size: Number(r.size) || 0,
    }));
  });
}

async function describeWith(c, db, name) {
  const [cols] = await c.query(
    `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS def,
            COLUMN_KEY AS ckey, EXTRA AS extra
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
    [db, name],
  );
  const [fks] = await c.query(
    `SELECT CONSTRAINT_NAME AS name, COLUMN_NAME AS col, REFERENCED_TABLE_NAME AS refTable, REFERENCED_COLUMN_NAME AS refCol
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
    [db, name],
  );
  const [idx] = await c.query(
    `SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
       FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? GROUP BY INDEX_NAME, NON_UNIQUE`,
    [db, name],
  );
  const [meta] = await c.query(
    'SELECT TABLE_ROWS AS est, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [db, name],
  );
  if (!cols.length) throw new Error(`Table ${name} not found`);
  const fkCols = new Set(fks.map((f) => f.col));
  const pk = cols.filter((col) => col.ckey === 'PRI').map((col) => col.name);
  return {
    name,
    table: name,
    type: /view/i.test(meta[0]?.type || '') ? 'view' : 'table',
    columns: cols.map((col) => ({
      name: col.name,
      type: col.type,
      nullable: col.nullable === 'YES',
      default: col.def,
      extra: col.extra,
      pk: col.ckey === 'PRI',
      fk: fkCols.has(col.name),
    })),
    primaryKey: pk,
    foreignKeys: fks.map((f) => ({ name: f.name, column: f.col, refTable: f.refTable, refColumn: f.refCol })),
    indexes: idx.map((i) => ({
      name: i.name,
      unique: !Number(i.nonUnique),
      primary: i.name === 'PRIMARY',
      definition: `(${i.cols})`,
    })),
    estimatedCount: Number(meta[0]?.est) || 0,
  };
}

export async function describe(conn, db, name) {
  return readOnly(conn, db, (c) => describeWith(c, db, name));
}

function filterSql(filter, columns, params) {
  if (!filter?.column) return '';
  const col = columns.find((c) => c.name === filter.column);
  if (!col) throw new Error(`Unknown column ${filter.column}`);
  const ref = q(col.name);
  switch (filter.op) {
    case 'contains':
      params.push(`%${filter.value ?? ''}%`);
      return `WHERE CAST(${ref} AS CHAR) LIKE ?`;
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

export async function rows(conn, db, name, { skip = 0, limit = 50, sort, filter } = {}) {
  const meta = await describe(conn, db, name);
  const safeLimit = clampLimit(limit, 50, 500);
  const safeSkip = Math.max(Number(skip) || 0, 0);
  const params = [];
  const where = filterSql(filter, meta.columns, params);
  let order = '';
  if (sort?.column && meta.columns.some((c) => c.name === sort.column)) {
    order = `ORDER BY ${q(sort.column)} ${sort.dir === 'desc' ? 'DESC' : 'ASC'}`;
  } else if (meta.primaryKey.length) {
    order = `ORDER BY ${meta.primaryKey.map(q).join(', ')}`;
  }
  return readOnly(conn, db, async (c) => {
    const [data, fields] = await c.query({
      sql: `SELECT * FROM ${q(name)} ${where} ${order} LIMIT ${safeLimit} OFFSET ${safeSkip}`,
      values: params,
      rowsAsArray: true,
    });
    let total = meta.estimatedCount;
    let exact = false;
    try {
      const [cnt] = await c.query({ sql: `SELECT COUNT(*) AS n FROM ${q(name)} ${where}`, values: params });
      total = Number(cnt[0].n);
      exact = true;
    } catch {
      // estimate
    }
    return {
      columns: fields.map((f) => ({ name: f.name, type: meta.columns.find((col) => col.name === f.name)?.type || '' })),
      rows: data.map((r) => r.map(displayValue)),
      total,
      exact,
      skip: safeSkip,
      limit: safeLimit,
      primaryKey: meta.primaryKey,
    };
  });
}

export async function query(conn, db, text, { limit = 500 } = {}) {
  const sql = assertReadOnlySql(text);
  const cap = clampLimit(limit, 500, 5000);
  const started = Date.now();
  return readOnly(conn, db, (c, markDestroy) =>
    new Promise((resolve, reject) => {
      const rowsOut = [];
      let columns = [];
      let truncated = false;
      let settled = false;
      const core = c.connection;
      const qry = core.query({ sql, rowsAsArray: true });
      const done = () => {
        if (settled) return;
        settled = true;
        resolve({ columns, rows: rowsOut, rowCount: rowsOut.length, truncated, durationMs: Date.now() - started });
      };
      qry.on('fields', (fields) => {
        columns = (fields || []).map((f) => ({ name: f.name }));
      });
      qry.on('result', (row) => {
        if (settled) return;
        if (!Array.isArray(row)) return; // OK packets for SHOW-like statements
        if (rowsOut.length >= cap) {
          truncated = true;
          markDestroy();
          core.pause();
          done();
          return;
        }
        rowsOut.push(row.map(displayValue));
      });
      qry.on('error', (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      qry.on('end', done);
    }),
  );
}

export async function graph(conn, db) {
  return readOnly(conn, db, async (c) => {
    const [objects] = await c.query(
      'SELECT TABLE_NAME AS name, TABLE_ROWS AS est FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME LIMIT 300',
      [db],
    );
    const tables = [];
    const relations = [];
    for (const o of objects) {
      const d = await describeWith(c, db, o.name);
      tables.push({
        name: d.name,
        type: d.type,
        rows: Number(o.est) || 0,
        columns: d.columns.map((col) => ({ name: col.name, type: col.type, pk: col.pk, fk: col.fk, nullable: col.nullable })),
      });
      for (const fk of d.foreignKeys) relations.push({ from: d.name, fromColumn: fk.column, to: fk.refTable, toColumn: fk.refColumn });
    }
    return { tables, relations };
  });
}

export async function dump(conn, db, { objects, onProgress }, dir) {
  const c = await pool(conn, db).getConnection();
  const summary = [];
  const schema = { engine, database: db, tables: [] };
  try {
    await applyTimeout(c, 0);
    await c.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await c.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY').catch(() => c.query('START TRANSACTION READ ONLY'));
    const [all] = await c.query(
      "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
      [db],
    );
    const names = all.map((r) => r.name).filter((n) => !objects?.length || objects.includes(n));
    if (objects?.length && !names.length) throw new Error('None of the selected tables exist');
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      const d = await describeWith(c, db, name);
      const [[created]] = await c.query(`SHOW CREATE TABLE ${q(name)}`);
      const tdir = path.join(dir, 'tables', name);
      fs.mkdirSync(tdir, { recursive: true });
      const ws = fs.createWriteStream(path.join(tdir, 'rows.ndjson'));
      let count = 0;
      onProgress?.({ collection: name, collectionsDone: i, collectionsTotal: names.length });
      const stream = c.connection.query(`SELECT * FROM ${q(name)}`).stream({ highWaterMark: 500 });
      for await (const row of stream) {
        const out = {};
        for (const [k, v] of Object.entries(row)) out[k] = backupValue(v);
        if (!ws.write(`${JSON.stringify(out)}\n`)) await once(ws, 'drain');
        count += 1;
        if (count % 1000 === 0) onProgress?.({ collection: name, collectionsDone: i, collectionsTotal: names.length, documents: count });
      }
      ws.end();
      await once(ws, 'finish');
      schema.tables.push({ ...d, ddl: created['Create Table'] });
      summary.push({ name, count, indexes: d.indexes.length });
    }
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    c.release();
  }
  fs.writeFileSync(path.join(dir, 'schema.json'), JSON.stringify(schema, null, 2));
  return { summary };
}

async function writeConnection(conn, db) {
  return mysql.createConnection(options(conn.uri, db));
}

export async function restoreCheck(conn, db, names) {
  const c = await writeConnection(conn, db);
  try {
    const out = [];
    for (const name of names) {
      const [ex] = await c.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [db, name]);
      let n = 0;
      if (ex.length) n = Number((await c.query(`SELECT COUNT(*) AS n FROM ${q(name)}`))[0][0].n);
      out.push({ name, exists: ex.length > 0, rows: n });
    }
    return out;
  } finally {
    await c.end().catch(() => {});
  }
}

export async function restore(conn, db, { schema, names, readRows, onProgress }) {
  const c = await writeConnection(conn, db);
  const tables = schema.tables.filter((t) => names.includes(t.name));
  const order = topoSortTables(tables, tables.flatMap((t) => t.foreignKeys.map((fk) => ({ from: t.name, to: fk.refTable }))));
  const results = [];
  try {
    await c.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of tables) {
      const [ex] = await c.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [db, t.name]);
      if (!ex.length) await c.query(t.ddl);
    }
    for (const name of order) {
      const t = tables.find((x) => x.name === name);
      const colNames = t.columns.map((col) => col.name);
      const jsonCols = new Set(t.columns.filter((col) => /^json/i.test(col.type)).map((col) => col.name));
      let inserted = 0;
      let batch = [];
      const flush = async () => {
        if (!batch.length) return;
        const values = batch.map((row) => colNames.map((col) => restoreValue(row[col], { json: jsonCols.has(col) })));
        await c.query(`INSERT INTO ${q(name)} (${colNames.map(q).join(', ')}) VALUES ?`, [values]);
        inserted += batch.length;
        batch = [];
        onProgress?.({ collection: name, documents: inserted });
      };
      await c.beginTransaction();
      for await (const row of readRows(name)) {
        batch.push(row);
        if (batch.length >= 500) await flush();
      }
      await flush();
      await c.commit();
      results.push({ name, inserted });
    }
  } catch (err) {
    await c.rollback().catch(() => {});
    throw err;
  } finally {
    await c.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
    await c.end().catch(() => {});
  }
  return results;
}

export async function close(connectionId) {
  for (const [key, p] of pools) {
    if (key.startsWith(`${connectionId}:`)) {
      pools.delete(key);
      await p.end().catch(() => {});
    }
  }
}
