import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import pg from 'pg';
import {
  assertReadOnlySql,
  backupValue,
  clampLimit,
  displayValue,
  isSelectLike,
  restoreValue,
  topoSortTables,
} from './sqlsafe.js';
import { coerceSqlValue, createTableSql, emptyPermission, recordColumns } from './seedwrite.js';

const pools = new Map();
const SYSTEM_SCHEMAS = "('pg_catalog','information_schema','pg_toast')";

function withDatabase(uri, database) {
  if (!database) return uri;
  try {
    const u = new URL(uri);
    u.pathname = `/${encodeURIComponent(database)}`;
    return u.toString();
  } catch {
    return uri;
  }
}

function baseConfig(uri, database) {
  // pg lets connectionString values win over explicit fields, so swap the database in the URL itself.
  return { connectionString: withDatabase(uri, database), connectionTimeoutMillis: 10_000, application_name: 'backup-service' };
}

function q(ident) {
  return `"${String(ident).replace(/"/g, '""')}"`;
}

export function splitName(name) {
  const s = String(name);
  const i = s.indexOf('.');
  return i === -1 ? { schema: 'public', table: s } : { schema: s.slice(0, i), table: s.slice(i + 1) };
}

function qName(name) {
  const { schema, table } = splitName(name);
  return `${q(schema)}.${q(table)}`;
}

function pool(conn, db) {
  const key = `${conn.id}:${db || ''}`;
  let p = pools.get(key);
  if (!p) {
    p = new pg.Pool({ ...baseConfig(conn.uri, db), max: 4, idleTimeoutMillis: 60_000 });
    p.on('error', () => {});
    pools.set(key, p);
  }
  return p;
}

/** Run fn inside a READ ONLY transaction that is always rolled back. */
async function readOnly(conn, db, fn, { timeoutMs = 30_000 } = {}) {
  const client = await pool(conn, db).connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${Number(timeoutMs)}`);
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

function defaultDb(uri) {
  try {
    return decodeURIComponent(new URL(uri).pathname.replace(/^\//, '')) || 'postgres';
  } catch {
    return 'postgres';
  }
}

export const engine = 'postgres';

export async function test(uri) {
  const started = Date.now();
  const client = new pg.Client(baseConfig(uri));
  await client.connect();
  try {
    const { rows } = await client.query('SELECT version() AS v, current_database() AS db');
    const version = (/PostgreSQL ([\d.]+)/.exec(rows[0].v) || [])[1] || rows[0].v;
    return { ok: true, version, database: rows[0].db, latencyMs: Date.now() - started };
  } finally {
    await client.end().catch(() => {});
  }
}

export async function listDatabases(conn) {
  const fallback = defaultDb(conn.uri);
  try {
    return await readOnly(conn, fallback, async (c) => {
      const { rows } = await c.query(
        `SELECT datname AS name, pg_database_size(datname) AS size
           FROM pg_database
          WHERE NOT datistemplate AND has_database_privilege(datname, 'CONNECT')
          ORDER BY datname`,
      );
      return rows.map((r) => ({ name: r.name, sizeOnDisk: Number(r.size) || 0, primary: r.name === fallback }));
    });
  } catch {
    return [{ name: fallback, sizeOnDisk: 0, primary: true }];
  }
}

export async function listObjects(conn, db) {
  return readOnly(conn, db, async (c) => {
    const { rows } = await c.query(
      `SELECT n.nspname AS schema, cl.relname AS table, cl.relkind AS kind,
              GREATEST(cl.reltuples, 0)::bigint AS rows, pg_total_relation_size(cl.oid) AS size
         FROM pg_class cl JOIN pg_namespace n ON n.oid = cl.relnamespace
        WHERE cl.relkind IN ('r','p','v','m','f') AND n.nspname NOT IN ${SYSTEM_SCHEMAS}
          AND has_table_privilege(cl.oid, 'SELECT')
        ORDER BY n.nspname, cl.relname`,
    );
    return rows.map((r) => ({
      name: `${r.schema}.${r.table}`,
      schema: r.schema,
      table: r.table,
      type: ['v', 'm'].includes(r.kind) ? 'view' : 'table',
      rows: Number(r.rows) || 0,
      size: Number(r.size) || 0,
    }));
  });
}

async function describeWith(c, name) {
  const { schema, table } = splitName(name);
  const cols = await c.query(
    `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable,
            pg_get_expr(d.adbin, d.adrelid) AS "default", a.attidentity AS identity
       FROM pg_attribute a
       JOIN pg_class cl ON cl.oid = a.attrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = $1 AND cl.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`,
    [schema, table],
  );
  const cons = await c.query(
    `SELECT con.conname AS name, con.contype AS type,
            ARRAY(SELECT att.attname FROM unnest(con.conkey) WITH ORDINALITY k(n, ord)
                  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.n ORDER BY k.ord)::text[] AS columns,
            fn.nspname AS ref_schema, fcl.relname AS ref_table,
            ARRAY(SELECT att.attname FROM unnest(con.confkey) WITH ORDINALITY k(n, ord)
                  JOIN pg_attribute att ON att.attrelid = con.confrelid AND att.attnum = k.n ORDER BY k.ord)::text[] AS ref_columns
       FROM pg_constraint con
       JOIN pg_class cl ON cl.oid = con.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
       LEFT JOIN pg_class fcl ON fcl.oid = con.confrelid LEFT JOIN pg_namespace fn ON fn.oid = fcl.relnamespace
      WHERE n.nspname = $1 AND cl.relname = $2 AND con.contype IN ('p','f','u')`,
    [schema, table],
  );
  const idx = await c.query(
    `SELECT i.relname AS name, ix.indisunique AS unique, ix.indisprimary AS primary,
            pg_get_indexdef(ix.indexrelid) AS definition
       FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_class cl ON cl.oid = ix.indrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE n.nspname = $1 AND cl.relname = $2`,
    [schema, table],
  );
  const est = await c.query(
    `SELECT GREATEST(cl.reltuples, 0)::bigint AS rows, cl.relkind AS kind FROM pg_class cl
       JOIN pg_namespace n ON n.oid = cl.relnamespace WHERE n.nspname = $1 AND cl.relname = $2`,
    [schema, table],
  );
  const pk = cons.rows.find((r) => r.type === 'p');
  const pkCols = new Set(pk?.columns || []);
  const fks = cons.rows
    .filter((r) => r.type === 'f')
    .flatMap((r) =>
      r.columns.map((col, i) => ({
        name: r.name,
        column: col,
        refTable: `${r.ref_schema}.${r.ref_table}`,
        refColumn: r.ref_columns[i],
      })),
    );
  const fkCols = new Set(fks.map((f) => f.column));
  return {
    name,
    schema,
    table,
    type: ['v', 'm'].includes(est.rows[0]?.kind) ? 'view' : 'table',
    columns: cols.rows.map((r) => ({
      name: r.name,
      type: r.type,
      nullable: r.nullable,
      default: r.default,
      identity: Boolean(r.identity),
      pk: pkCols.has(r.name),
      fk: fkCols.has(r.name),
    })),
    primaryKey: pk?.columns || [],
    uniques: cons.rows.filter((r) => r.type === 'u').map((r) => r.columns),
    foreignKeys: fks,
    indexes: idx.rows.map((r) => ({ name: r.name, unique: r.unique, primary: r.primary, definition: r.definition })),
    estimatedCount: Number(est.rows[0]?.rows) || 0,
  };
}

export async function describe(conn, db, name) {
  return readOnly(conn, db, (c) => describeWith(c, name));
}

function filterSql(filter, columns, params) {
  if (!filter?.column) return '';
  const col = columns.find((c) => c.name === filter.column);
  if (!col) throw new Error(`Unknown column ${filter.column}`);
  const ref = q(col.name);
  switch (filter.op) {
    case 'contains':
      params.push(`%${filter.value ?? ''}%`);
      return `WHERE ${ref}::text ILIKE $${params.length}`;
    case 'null':
      return `WHERE ${ref} IS NULL`;
    case 'notnull':
      return `WHERE ${ref} IS NOT NULL`;
    case 'gt':
    case 'lt':
    case 'eq':
    case 'neq': {
      params.push(filter.value ?? '');
      const op = { gt: '>', lt: '<', eq: '=', neq: '<>' }[filter.op];
      return `WHERE ${ref}::text ${op} $${params.length}::text`;
    }
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
    order = `ORDER BY ${q(sort.column)} ${sort.dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST`;
  } else if (meta.primaryKey.length) {
    order = `ORDER BY ${meta.primaryKey.map(q).join(', ')}`;
  }
  const data = await readOnly(conn, db, (c) =>
    c.query({
      text: `SELECT * FROM ${qName(name)} ${where} ${order} LIMIT ${safeLimit} OFFSET ${safeSkip}`,
      values: params,
      rowMode: 'array',
    }),
  );
  let total = meta.estimatedCount;
  let exact = false;
  try {
    const counted = await readOnly(
      conn,
      db,
      (c) => c.query({ text: `SELECT count(*)::bigint AS n FROM ${qName(name)} ${where}`, values: params }),
      { timeoutMs: 3000 },
    );
    total = Number(counted.rows[0].n);
    exact = true;
  } catch {
    // estimate only
  }
  return {
    columns: data.fields.map((f) => ({ name: f.name, type: meta.columns.find((c) => c.name === f.name)?.type || '' })),
    rows: data.rows.map((r) => r.map(displayValue)),
    total,
    exact,
    skip: safeSkip,
    limit: safeLimit,
    primaryKey: meta.primaryKey,
  };
}

export async function query(conn, db, text, { limit = 500 } = {}) {
  const sql = assertReadOnlySql(text);
  const cap = clampLimit(limit, 500, 5000);
  const started = Date.now();
  return readOnly(conn, db, async (c) => {
    let result;
    let truncated = false;
    if (isSelectLike(sql)) {
      await c.query(`DECLARE _bk_cursor NO SCROLL CURSOR FOR ${sql}`);
      result = await c.query({ text: `FETCH ${cap + 1} FROM _bk_cursor`, rowMode: 'array' });
      if (result.rows.length > cap) {
        truncated = true;
        result.rows = result.rows.slice(0, cap);
      }
    } else {
      result = await c.query({ text: sql, rowMode: 'array' });
      if (result.rows.length > cap) {
        truncated = true;
        result.rows = result.rows.slice(0, cap);
      }
    }
    return {
      columns: (result.fields || []).map((f) => ({ name: f.name })),
      rows: (result.rows || []).map((r) => r.map(displayValue)),
      rowCount: result.rows?.length || 0,
      truncated,
      durationMs: Date.now() - started,
    };
  });
}

export async function graph(conn, db) {
  return readOnly(conn, db, async (c) => {
    const objects = await c.query(
      `SELECT n.nspname AS schema, cl.relname AS table, cl.relkind AS kind, GREATEST(cl.reltuples,0)::bigint AS rows
         FROM pg_class cl JOIN pg_namespace n ON n.oid = cl.relnamespace
        WHERE cl.relkind IN ('r','p','v','m','f') AND n.nspname NOT IN ${SYSTEM_SCHEMAS}
        ORDER BY 1, 2 LIMIT 300`,
    );
    const tables = [];
    const relations = [];
    for (const o of objects.rows) {
      const d = await describeWith(c, `${o.schema}.${o.table}`);
      tables.push({
        name: d.name,
        type: d.type,
        rows: Number(o.rows) || 0,
        columns: d.columns.map((col) => ({ name: col.name, type: col.type, pk: col.pk, fk: col.fk, nullable: col.nullable })),
      });
      for (const fk of d.foreignKeys) {
        relations.push({ from: d.name, fromColumn: fk.column, to: fk.refTable, toColumn: fk.refColumn });
      }
    }
    return { tables, relations };
  });
}

function ddlFor(d) {
  const cols = d.columns.map((c) => {
    let line = `  ${q(c.name)} ${c.type}`;
    if (!c.nullable) line += ' NOT NULL';
    if (c.identity || /nextval\(/i.test(c.default || '')) line += ' GENERATED BY DEFAULT AS IDENTITY';
    else if (c.default) line += ` DEFAULT ${c.default}`;
    return line;
  });
  if (d.primaryKey.length) cols.push(`  PRIMARY KEY (${d.primaryKey.map(q).join(', ')})`);
  return `CREATE TABLE ${qName(d.name)} (\n${cols.join(',\n')}\n);`;
}

function fkDdl(d) {
  const byName = new Map();
  for (const fk of d.foreignKeys) {
    if (!byName.has(fk.name)) byName.set(fk.name, { cols: [], refTable: fk.refTable, refCols: [] });
    byName.get(fk.name).cols.push(fk.column);
    byName.get(fk.name).refCols.push(fk.refColumn);
  }
  return [...byName.entries()].map(
    ([n, fk]) =>
      `ALTER TABLE ${qName(d.name)} ADD CONSTRAINT ${q(n)} FOREIGN KEY (${fk.cols.map(q).join(', ')}) REFERENCES ${qName(fk.refTable)} (${fk.refCols.map(q).join(', ')});`,
  );
}

/** Consistent snapshot dump: one REPEATABLE READ, READ ONLY transaction for all tables. */
export async function dump(conn, db, { objects, onProgress }, dir) {
  const client = await pool(conn, db).connect();
  const summary = [];
  const schema = { engine, database: db, tables: [] };
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const all = (
      await client.query(
        `SELECT n.nspname AS schema, cl.relname AS table FROM pg_class cl JOIN pg_namespace n ON n.oid = cl.relnamespace
          WHERE cl.relkind IN ('r','p') AND n.nspname NOT IN ${SYSTEM_SCHEMAS} ORDER BY 1, 2`,
      )
    ).rows.map((r) => `${r.schema}.${r.table}`);
    const names = objects?.length ? all.filter((n) => objects.includes(n) || objects.includes(splitName(n).table)) : all;
    if (objects?.length && !names.length) throw new Error('None of the selected tables exist');
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      const d = await describeWith(client, name);
      const tdir = path.join(dir, 'tables', name);
      fs.mkdirSync(tdir, { recursive: true });
      const ws = fs.createWriteStream(path.join(tdir, 'rows.ndjson'));
      let count = 0;
      onProgress?.({ collection: name, collectionsDone: i, collectionsTotal: names.length });
      await client.query(`DECLARE _bk_dump NO SCROLL CURSOR FOR SELECT * FROM ${qName(name)}`);
      for (;;) {
        const batch = await client.query('FETCH 1000 FROM _bk_dump');
        if (!batch.rows.length) break;
        for (const row of batch.rows) {
          const out = {};
          for (const [k, v] of Object.entries(row)) out[k] = backupValue(v);
          if (!ws.write(`${JSON.stringify(out)}\n`)) await once(ws, 'drain');
          count += 1;
        }
        onProgress?.({ collection: name, collectionsDone: i, collectionsTotal: names.length, documents: count });
      }
      await client.query('CLOSE _bk_dump');
      ws.end();
      await once(ws, 'finish');
      schema.tables.push({ ...d, ddl: ddlFor(d), fkDdl: fkDdl(d) });
      summary.push({ name, count, indexes: d.indexes.length });
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
  fs.writeFileSync(path.join(dir, 'schema.json'), JSON.stringify(schema, null, 2));
  return { summary };
}

async function safeQuery(client, text, values) {
  await client.query('SAVEPOINT bk_safe');
  try {
    await client.query(text, values);
    await client.query('RELEASE SAVEPOINT bk_safe');
    return true;
  } catch {
    await client.query('ROLLBACK TO SAVEPOINT bk_safe');
    return false;
  }
}

async function writeClient(conn, db) {
  const client = new pg.Client(baseConfig(conn.uri, db));
  await client.connect();
  return client;
}

export async function restoreCheck(conn, db, names) {
  const client = await writeClient(conn, db);
  try {
    const out = [];
    for (const name of names) {
      const { schema, table } = splitName(name);
      const ex = await client.query(
        `SELECT 1 FROM pg_class cl JOIN pg_namespace n ON n.oid = cl.relnamespace WHERE n.nspname=$1 AND cl.relname=$2`,
        [schema, table],
      );
      let rowsCount = 0;
      if (ex.rows.length) rowsCount = Number((await client.query(`SELECT count(*) AS n FROM ${qName(name)}`)).rows[0].n);
      out.push({ name, exists: ex.rows.length > 0, rows: rowsCount });
    }
    return out;
  } finally {
    await client.end().catch(() => {});
  }
}

/** Explicit write path: create tables and load rows into an empty target, all in one transaction. */
export async function restore(conn, db, { schema, names, readRows, onProgress }) {
  const client = await writeClient(conn, db);
  const tables = schema.tables.filter((t) => names.includes(t.name));
  const order = topoSortTables(
    tables,
    tables.flatMap((t) => t.foreignKeys.map((fk) => ({ from: t.name, to: fk.refTable }))),
  );
  const results = [];
  try {
    await client.query('BEGIN');
    for (const t of tables) {
      if (t.schema && t.schema !== 'public') await client.query(`CREATE SCHEMA IF NOT EXISTS ${q(t.schema)}`);
      const exists = await client.query(
        `SELECT 1 FROM pg_class cl JOIN pg_namespace n ON n.oid = cl.relnamespace WHERE n.nspname=$1 AND cl.relname=$2`,
        [t.schema || 'public', t.table || splitName(t.name).table],
      );
      if (!exists.rows.length) await client.query(t.ddl);
    }
    for (const name of order) {
      const t = tables.find((x) => x.name === name);
      const jsonCols = new Set(t.columns.filter((c) => /^jsonb?$/.test(c.type)).map((c) => c.name));
      const colNames = t.columns.map((c) => c.name);
      let inserted = 0;
      let batch = [];
      const flush = async () => {
        if (!batch.length) return;
        const values = [];
        const tuples = batch.map((row) => {
          const ph = colNames.map((c) => {
            values.push(restoreValue(row[c], { json: jsonCols.has(c) }));
            return `$${values.length}`;
          });
          return `(${ph.join(', ')})`;
        });
        const overriding = t.columns.some((c) => c.identity) ? ' OVERRIDING SYSTEM VALUE' : '';
        await client.query(
          `INSERT INTO ${qName(name)} (${colNames.map(q).join(', ')})${overriding} VALUES ${tuples.join(', ')}`,
          values,
        );
        inserted += batch.length;
        batch = [];
        onProgress?.({ collection: name, documents: inserted });
      };
      for await (const row of readRows(name)) {
        batch.push(row);
        if (batch.length * colNames.length >= 5000 || batch.length >= 500) await flush();
      }
      await flush();
      results.push({ name, inserted });
    }
    for (const t of tables) {
      for (const stmt of t.fkDdl || []) {
        const refName = (/REFERENCES "([^"]+)"\."([^"]+)"/.exec(stmt) || []).slice(1).join('.');
        if (!refName || names.includes(refName)) await safeQuery(client, stmt);
      }
    }
    // Move serial sequences past restored ids.
    for (const t of tables) {
      for (const c of t.columns.filter((col) => /nextval\(/i.test(col.default || '') || col.identity)) {
        await safeQuery(
          client,
          `SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT MAX(${q(c.name)}) FROM ${qName(t.name)}), 0) + 1, false)`,
          [qName(t.name), c.name],
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end().catch(() => {});
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

export async function permissions(conn, db) {
  try {
    return await readOnly(conn, db, async (c) => {
      const { rows: [u] } = await c.query(
        `SELECT current_user AS user_name, session_user AS session,
                current_database() AS database,
                r.rolsuper, r.rolcreatedb, r.rolcreaterole
           FROM pg_roles r WHERE r.rolname = current_user`,
      );
      const { rows: grants } = await c.query(
        `SELECT privilege_type, COUNT(*)::int AS n
           FROM information_schema.role_table_grants
          WHERE grantee = current_user
          GROUP BY privilege_type
          ORDER BY privilege_type`,
      );
      const { rows: [dbp] } = await c.query(
        `SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS can_create,
                has_database_privilege(current_user, current_database(), 'CONNECT') AS can_connect`,
      );
      const privs = grants.map((g) => `${g.privilege_type} (${g.n} tables)`);
      const canWrite = Boolean(u.rolsuper) || grants.some((g) => ['INSERT', 'UPDATE', 'DELETE'].includes(g.privilege_type));
      return {
        user: u.user_name,
        roles: [u.rolsuper ? 'superuser' : null, u.rolcreatedb ? 'createdb' : null, u.rolcreaterole ? 'createrole' : null].filter(Boolean),
        canRead: true,
        canWrite,
        canCreate: Boolean(dbp?.can_create || u.rolsuper),
        canDrop: Boolean(u.rolsuper) || grants.some((g) => g.privilege_type === 'TRUNCATE'),
        canAdmin: Boolean(u.rolsuper),
        privileges: privs,
        details: [{ resource: u.database, actions: ['CONNECT', dbp?.can_create ? 'CREATE' : null].filter(Boolean) }],
        notes: u.rolsuper ? ['This role is a PostgreSQL superuser.'] : [],
      };
    });
  } catch (err) {
    return emptyPermission({ notes: [err.message] });
  }
}

export async function seedEnsure(conn, db, object) {
  const client = await writeClient(conn, db);
  try {
    const { schema } = splitName(object.name);
    if (schema && schema !== 'public') await client.query(`CREATE SCHEMA IF NOT EXISTS ${q(schema)}`);
    await client.query(createTableSql(object, 'postgres', q, qName(object.name)));
    return { name: object.name, created: true };
  } finally {
    await client.end().catch(() => {});
  }
}

export async function seedWipe(conn, db, names) {
  const client = await writeClient(conn, db);
  const out = [];
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    for (const name of names) {
      const n = await client.query(`DELETE FROM ${qName(name)}`);
      out.push({ name, deleted: n.rowCount || 0 });
    }
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end().catch(() => {});
  }
}

export async function seedInsert(conn, db, name, records) {
  if (!records?.length) return { name, inserted: 0 };
  const cols = recordColumns(records);
  const client = await writeClient(conn, db);
  const colSql = cols.map(q).join(', ');
  const ph = cols.map((_, i) => `$${i + 1}`).join(', ');
  const insertSql = (overriding) =>
    `INSERT INTO ${qName(name)} (${colSql})${overriding ? ' OVERRIDING SYSTEM VALUE' : ''} VALUES (${ph})`;
  try {
    await client.query('BEGIN');
    let overriding = false;
    let inserted = 0;
    for (const rec of records) {
      const values = cols.map((c) => coerceSqlValue(rec[c], { json: true, engine: 'postgres' }));
      try {
        await client.query(insertSql(overriding), values);
      } catch (err) {
        if (!overriding && /identity|overriding/i.test(err.message)) {
          overriding = true;
          await client.query(insertSql(true), values);
        } else {
          throw err;
        }
      }
      inserted += 1;
    }
    await client.query('COMMIT');
    return { name, inserted };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end().catch(() => {});
  }
}

export async function lookupKeys(conn, db, name, field, values) {
  const list = [...new Set((values || []).filter((v) => v != null && v !== ''))].slice(0, 200);
  if (!list.length) return [];
  return readOnly(conn, db, async (c) => {
    const { rows } = await c.query(`SELECT ${q(field)} AS k FROM ${qName(name)} WHERE ${q(field)} = ANY($1) LIMIT 200`, [list.map(String)]);
    return rows.map((r) => String(r.k));
  });
}
