import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import sql from 'mssql';
import {
  assertReadOnlySql,
  backupValue,
  clampLimit,
  displayValue,
  restoreValue,
  topoSortTables,
} from './sqlsafe.js';
import { coerceSqlValue, createTableSql, emptyPermission, recordColumns } from './seedwrite.js';

// SQL Server support. Read paths run inside a transaction that is always rolled back
// and go through the read-only statement guard.

const pools = new Map();
const SYSTEM_DBS = new Set(['master', 'tempdb', 'model', 'msdb']);

function truthy(v) {
  return ['1', 'true', 'yes'].includes(String(v).toLowerCase());
}

export function parseConfig(uri, database) {
  const value = String(uri).trim();
  let cfg;
  if (/^(mssql|sqlserver):\/\//i.test(value)) {
    const u = new URL(value.replace(/^sqlserver:/i, 'mssql:'));
    const params = Object.fromEntries([...u.searchParams.entries()].map(([k, v]) => [k.toLowerCase(), v]));
    cfg = {
      server: decodeURIComponent(u.hostname),
      port: u.port ? Number(u.port) : undefined,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.replace(/^\//, '')) || undefined,
      options: {
        encrypt: params.encrypt ? truthy(params.encrypt) : true,
        trustServerCertificate: truthy(params.trustservercertificate),
        instanceName: params.instancename || undefined,
      },
    };
  } else {
    cfg = sql.ConnectionPool.parseConnectionString(value);
  }
  if (database) cfg.database = database;
  cfg.connectionTimeout = 10_000;
  cfg.requestTimeout = 30_000;
  cfg.pool = { max: 4, min: 0, idleTimeoutMillis: 60_000 };
  return cfg;
}

function q(ident) {
  return `[${String(ident).replace(/]/g, ']]')}]`;
}

export function splitName(name) {
  const s = String(name);
  const i = s.indexOf('.');
  return i === -1 ? { schema: 'dbo', table: s } : { schema: s.slice(0, i), table: s.slice(i + 1) };
}

function qName(name) {
  const { schema, table } = splitName(name);
  return `${q(schema)}.${q(table)}`;
}

async function pool(conn, db) {
  const key = `${conn.id}:${db || ''}`;
  let p = pools.get(key);
  if (!p) {
    p = new sql.ConnectionPool(parseConfig(conn.uri, db));
    p.on('error', () => {});
    pools.set(key, p.connect().then(() => p));
    p = pools.get(key);
  }
  try {
    return await p;
  } catch (err) {
    pools.delete(key);
    throw err;
  }
}

async function readOnly(conn, db, fn) {
  const p = await pool(conn, db);
  const tx = new sql.Transaction(p);
  await tx.begin();
  try {
    return await fn(() => new sql.Request(tx));
  } finally {
    await tx.rollback().catch(() => {});
  }
}

export const engine = 'mssql';

export async function test(uri) {
  const started = Date.now();
  const p = new sql.ConnectionPool(parseConfig(uri));
  await p.connect();
  try {
    const r = await p.request().query("SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(64)) AS v, DB_NAME() AS db");
    return { ok: true, version: r.recordset[0].v, database: r.recordset[0].db, latencyMs: Date.now() - started };
  } finally {
    await p.close().catch(() => {});
  }
}

export async function listDatabases(conn) {
  const primary = parseConfig(conn.uri).database || 'master';
  return readOnly(conn, null, async (req) => {
    const r = await req().query(
      `SELECT d.name, SUM(CAST(f.size AS bigint)) * 8192 AS size FROM sys.databases d
         LEFT JOIN sys.master_files f ON f.database_id = d.database_id
        WHERE HAS_DBACCESS(d.name) = 1 GROUP BY d.name ORDER BY d.name`,
    );
    return r.recordset
      .filter((x) => !SYSTEM_DBS.has(x.name))
      .map((x) => ({ name: x.name, sizeOnDisk: Number(x.size) || 0, primary: x.name === primary }));
  });
}

export async function listObjects(conn, db) {
  return readOnly(conn, db, async (req) => {
    const r = await req().query(
      `SELECT s.name AS [schema], o.name AS [table], o.type AS kind,
              (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = o.object_id AND p.index_id IN (0,1)) AS est
         FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE o.type IN ('U','V') AND o.is_ms_shipped = 0 ORDER BY s.name, o.name`,
    );
    return r.recordset.map((x) => ({
      name: `${x.schema}.${x.table}`,
      schema: x.schema,
      table: x.table,
      type: x.kind.trim() === 'V' ? 'view' : 'table',
      rows: Number(x.est) || 0,
    }));
  });
}

async function describeWith(req, name) {
  const { schema, table } = splitName(name);
  const full = `${schema}.${table}`;
  const cols = await req()
    .input('full', sql.NVarChar, full)
    .query(
      `SELECT c.name, TYPE_NAME(c.user_type_id) AS type, c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity,
              OBJECT_DEFINITION(c.default_object_id) AS def
         FROM sys.columns c WHERE c.object_id = OBJECT_ID(@full) ORDER BY c.column_id`,
    );
  if (!cols.recordset.length) throw new Error(`Table ${name} not found`);
  const pk = await req()
    .input('full', sql.NVarChar, full)
    .query(
      `SELECT c.name FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
         JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        WHERE i.object_id = OBJECT_ID(@full) AND i.is_primary_key = 1 ORDER BY ic.key_ordinal`,
    );
  const fks = await req()
    .input('full', sql.NVarChar, full)
    .query(
      `SELECT fk.name, pc.name AS col, rs.name AS ref_schema, rt.name AS ref_table, rc.name AS ref_col
         FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
         JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
         JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
         JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
        WHERE fk.parent_object_id = OBJECT_ID(@full)`,
    );
  const idx = await req()
    .input('full', sql.NVarChar, full)
    .query(
      `SELECT i.name, i.is_unique, i.is_primary_key,
              STUFF((SELECT ', ' + c.name FROM sys.index_columns ic JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                     WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id ORDER BY ic.key_ordinal FOR XML PATH('')), 1, 2, '') AS cols
         FROM sys.indexes i WHERE i.object_id = OBJECT_ID(@full) AND i.name IS NOT NULL`,
    );
  const est = await req()
    .input('full', sql.NVarChar, full)
    .query(
      `SELECT SUM(rows) AS n, (SELECT type FROM sys.objects WHERE object_id = OBJECT_ID(@full)) AS kind
         FROM sys.partitions WHERE object_id = OBJECT_ID(@full) AND index_id IN (0,1)`,
    );
  const pkCols = pk.recordset.map((r) => r.name);
  const fkCols = new Set(fks.recordset.map((r) => r.col));
  const typeLabel = (c) => {
    if (['varchar', 'char', 'varbinary', 'binary'].includes(c.type)) return `${c.type}(${c.max_length === -1 ? 'max' : c.max_length})`;
    if (['nvarchar', 'nchar'].includes(c.type)) return `${c.type}(${c.max_length === -1 ? 'max' : c.max_length / 2})`;
    if (['decimal', 'numeric'].includes(c.type)) return `${c.type}(${c.precision},${c.scale})`;
    return c.type;
  };
  return {
    name: full,
    schema,
    table,
    type: String(est.recordset[0]?.kind || '').trim() === 'V' ? 'view' : 'table',
    columns: cols.recordset.map((c) => ({
      name: c.name,
      type: typeLabel(c),
      nullable: c.is_nullable,
      default: c.def,
      identity: c.is_identity,
      pk: pkCols.includes(c.name),
      fk: fkCols.has(c.name),
    })),
    primaryKey: pkCols,
    foreignKeys: fks.recordset.map((r) => ({
      name: r.name,
      column: r.col,
      refTable: `${r.ref_schema}.${r.ref_table}`,
      refColumn: r.ref_col,
    })),
    indexes: idx.recordset.map((r) => ({ name: r.name, unique: r.is_unique, primary: r.is_primary_key, definition: `(${r.cols})` })),
    estimatedCount: Number(est.recordset[0]?.n) || 0,
  };
}

export async function describe(conn, db, name) {
  return readOnly(conn, db, (req) => describeWith(req, name));
}

export async function rows(conn, db, name, { skip = 0, limit = 50, sort, filter } = {}) {
  const safeLimit = clampLimit(limit, 50, 500);
  const safeSkip = Math.max(Number(skip) || 0, 0);
  return readOnly(conn, db, async (req) => {
    const meta = await describeWith(req, name);
    const r = req();
    let where = '';
    if (filter?.column) {
      const col = meta.columns.find((c) => c.name === filter.column);
      if (!col) throw new Error(`Unknown column ${filter.column}`);
      const ref = q(col.name);
      if (filter.op === 'contains') {
        r.input('fv', sql.NVarChar, `%${filter.value ?? ''}%`);
        where = `WHERE CAST(${ref} AS nvarchar(max)) LIKE @fv`;
      } else if (filter.op === 'null') where = `WHERE ${ref} IS NULL`;
      else if (filter.op === 'notnull') where = `WHERE ${ref} IS NOT NULL`;
      else if (['gt', 'lt', 'eq', 'neq'].includes(filter.op)) {
        r.input('fv', sql.NVarChar, String(filter.value ?? ''));
        where = `WHERE ${ref} ${{ gt: '>', lt: '<', eq: '=', neq: '<>' }[filter.op]} @fv`;
      }
    }
    let order = 'ORDER BY (SELECT NULL)';
    if (sort?.column && meta.columns.some((c) => c.name === sort.column)) order = `ORDER BY ${q(sort.column)} ${sort.dir === 'desc' ? 'DESC' : 'ASC'}`;
    else if (meta.primaryKey.length) order = `ORDER BY ${meta.primaryKey.map(q).join(', ')}`;
    r.arrayRowMode = true;
    const data = await r.query(`SELECT * FROM ${qName(name)} ${where} ${order} OFFSET ${safeSkip} ROWS FETCH NEXT ${safeLimit} ROWS ONLY`);
    const cr = req();
    if (filter?.value != null && filter.op !== 'null' && filter.op !== 'notnull') {
      cr.input('fv', sql.NVarChar, filter.op === 'contains' ? `%${filter.value}%` : String(filter.value));
    }
    const cnt = await cr.query(`SELECT COUNT_BIG(*) AS n FROM ${qName(name)} ${where}`);
    return {
      columns: (data.columns?.[0] || data.columns || []).map((c) => ({ name: c.name, type: meta.columns.find((m) => m.name === c.name)?.type || '' })),
      rows: (data.recordset || []).map((row) => row.map(displayValue)),
      total: Number(cnt.recordset[0].n),
      exact: true,
      skip: safeSkip,
      limit: safeLimit,
      primaryKey: meta.primaryKey,
    };
  });
}

export async function fetchOne(conn, db, name, { field, value }) {
  if (!field) throw new Error('field is required');
  return readOnly(conn, db, async (req) => {
    const meta = await describeWith(req, name);
    if (!meta.columns.some((c) => c.name === field)) throw new Error(`Unknown column ${field}`);
    const r = req();
    r.input('lk', sql.NVarChar, String(value ?? ''));
    const data = await r.query(`SELECT TOP 1 * FROM ${qName(name)} WHERE ${q(field)} = @lk`);
    const rec = data.recordset?.[0];
    if (!rec) return { found: false, object: name, field };
    const row = {};
    const cols = data.columns?.[0] || data.columns || [];
    for (let i = 0; i < cols.length; i += 1) row[cols[i].name] = displayValue(rec[i]);
    return {
      found: true,
      object: name,
      field,
      columns: meta.columns.map((c) => ({ name: c.name, type: c.type })),
      row,
      primaryKey: meta.primaryKey,
    };
  });
}

export async function query(conn, db, text, { limit = 500 } = {}) {
  const statement = assertReadOnlySql(text);
  const cap = clampLimit(limit, 500, 5000);
  const started = Date.now();
  return readOnly(conn, db, (req) =>
    new Promise((resolve, reject) => {
      const r = req();
      r.stream = true;
      r.arrayRowMode = true;
      const out = [];
      let columns = [];
      let truncated = false;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve({ columns, rows: out, rowCount: out.length, truncated, durationMs: Date.now() - started });
      };
      r.on('recordset', (cols) => {
        if (!columns.length) columns = (Array.isArray(cols) ? cols : Object.values(cols)).map((c) => ({ name: c.name }));
      });
      r.on('row', (row) => {
        if (settled) return;
        if (out.length >= cap) {
          truncated = true;
          r.cancel();
          finish();
          return;
        }
        out.push(row.map(displayValue));
      });
      r.on('error', (err) => {
        if (truncated) return finish();
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      r.on('done', finish);
      r.query(statement);
    }),
  );
}

export async function graph(conn, db) {
  return readOnly(conn, db, async (req) => {
    const objs = await req().query(
      `SELECT TOP 300 s.name AS [schema], o.name AS [table] FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE o.type IN ('U','V') AND o.is_ms_shipped = 0 ORDER BY s.name, o.name`,
    );
    const tables = [];
    const relations = [];
    for (const o of objs.recordset) {
      const d = await describeWith(req, `${o.schema}.${o.table}`);
      tables.push({
        name: d.name,
        type: d.type,
        rows: d.estimatedCount,
        columns: d.columns.map((c) => ({ name: c.name, type: c.type, pk: c.pk, fk: c.fk, nullable: c.nullable })),
      });
      for (const fk of d.foreignKeys) relations.push({ from: d.name, fromColumn: fk.column, to: fk.refTable, toColumn: fk.refColumn });
    }
    return { tables, relations };
  });
}

function ddlFor(d) {
  const cols = d.columns.map((c) => `  ${q(c.name)} ${c.type}${c.identity ? ' IDENTITY(1,1)' : ''}${c.nullable ? ' NULL' : ' NOT NULL'}`);
  if (d.primaryKey.length) cols.push(`  PRIMARY KEY (${d.primaryKey.map(q).join(', ')})`);
  return `CREATE TABLE ${qName(d.name)} (\n${cols.join(',\n')}\n);`;
}

export async function dump(conn, db, { objects, onProgress }, dir) {
  const p = await pool(conn, db);
  const tx = new sql.Transaction(p);
  await tx.begin(sql.ISOLATION_LEVEL.SNAPSHOT).catch(() => tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED));
  const req = () => new sql.Request(tx);
  const summary = [];
  const schema = { engine, database: db, tables: [] };
  try {
    const all = (
      await req().query(
        "SELECT s.name AS [schema], t.name AS [table] FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE t.is_ms_shipped = 0 ORDER BY 1, 2",
      )
    ).recordset.map((r) => `${r.schema}.${r.table}`);
    const names = objects?.length ? all.filter((n) => objects.includes(n) || objects.includes(splitName(n).table)) : all;
    if (objects?.length && !names.length) throw new Error('None of the selected tables exist');
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      const d = await describeWith(req, name);
      const tdir = path.join(dir, 'tables', name);
      fs.mkdirSync(tdir, { recursive: true });
      const ws = fs.createWriteStream(path.join(tdir, 'rows.ndjson'));
      onProgress?.({ collection: name, collectionsDone: i, collectionsTotal: names.length });
      const count = await new Promise((resolve, reject) => {
        const r = req();
        r.stream = true;
        let n = 0;
        r.on('row', (row) => {
          const out = {};
          for (const [k, v] of Object.entries(row)) out[k] = backupValue(v);
          if (!ws.write(`${JSON.stringify(out)}\n`)) {
            r.pause();
            ws.once('drain', () => r.resume());
          }
          n += 1;
        });
        r.on('error', reject);
        r.on('done', () => resolve(n));
        r.query(`SELECT * FROM ${qName(name)}`);
      });
      ws.end();
      await once(ws, 'finish');
      schema.tables.push({ ...d, ddl: ddlFor(d) });
      summary.push({ name, count, indexes: d.indexes.length });
    }
  } finally {
    await tx.rollback().catch(() => {});
  }
  fs.writeFileSync(path.join(dir, 'schema.json'), JSON.stringify(schema, null, 2));
  return { summary };
}

export async function restoreCheck(conn, db, names) {
  const p = await pool(conn, db);
  const out = [];
  for (const name of names) {
    const ex = await p.request().input('full', sql.NVarChar, name).query('SELECT OBJECT_ID(@full) AS id');
    let n = 0;
    if (ex.recordset[0].id) n = Number((await p.request().query(`SELECT COUNT_BIG(*) AS n FROM ${qName(name)}`)).recordset[0].n);
    out.push({ name, exists: Boolean(ex.recordset[0].id), rows: n });
  }
  return out;
}

export async function restore(conn, db, { schema, names, readRows, onProgress }) {
  const p = await pool(conn, db);
  const tables = schema.tables.filter((t) => names.includes(t.name));
  const order = topoSortTables(tables, tables.flatMap((t) => t.foreignKeys.map((fk) => ({ from: t.name, to: fk.refTable }))));
  const tx = new sql.Transaction(p);
  await tx.begin();
  const results = [];
  try {
    for (const t of tables) {
      const ex = await new sql.Request(tx).input('full', sql.NVarChar, t.name).query('SELECT OBJECT_ID(@full) AS id');
      if (!ex.recordset[0].id) await new sql.Request(tx).batch(t.ddl);
    }
    for (const name of order) {
      const t = tables.find((x) => x.name === name);
      const cols = t.columns.map((c) => c.name);
      const identity = t.columns.some((c) => c.identity);
      if (identity) await new sql.Request(tx).batch(`SET IDENTITY_INSERT ${qName(name)} ON`);
      let inserted = 0;
      for await (const row of readRows(name)) {
        const r = new sql.Request(tx);
        cols.forEach((c, i) => r.input(`p${i}`, restoreValue(row[c], { json: true })));
        await r.query(`INSERT INTO ${qName(name)} (${cols.map(q).join(', ')}) VALUES (${cols.map((_, i) => `@p${i}`).join(', ')})`);
        inserted += 1;
        if (inserted % 500 === 0) onProgress?.({ collection: name, documents: inserted });
      }
      if (identity) await new sql.Request(tx).batch(`SET IDENTITY_INSERT ${qName(name)} OFF`);
      results.push({ name, inserted });
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
  return results;
}

export async function close(connectionId) {
  for (const [key, p] of pools) {
    if (key.startsWith(`${connectionId}:`)) {
      pools.delete(key);
      await Promise.resolve(p)
        .then((x) => x.close())
        .catch(() => {});
    }
  }
}

export async function permissions(conn, db) {
  try {
    const p = await pool(conn, db);
    const who = await p.request().query(`
      SELECT SYSTEM_USER AS login_name, USER_NAME() AS user_name, DB_NAME() AS database_name,
             IS_SRVROLEMEMBER('sysadmin') AS sysadmin,
             IS_MEMBER('db_owner') AS db_owner,
             IS_MEMBER('db_datareader') AS datareader,
             IS_MEMBER('db_datawriter') AS datawriter
    `);
    const u = who.recordset[0] || {};
    let perms = [];
    try {
      const r = await p.request().query(`SELECT permission_name FROM fn_my_permissions(NULL, 'DATABASE')`);
      perms = r.recordset.map((row) => row.permission_name);
    } catch {
      perms = [];
    }
    const blob = perms.join(' ').toUpperCase();
    return {
      user: u.user_name || u.login_name || 'unknown',
      roles: [u.sysadmin ? 'sysadmin' : null, u.db_owner ? 'db_owner' : null, u.datareader ? 'db_datareader' : null, u.datawriter ? 'db_datawriter' : null].filter(Boolean),
      canRead: Boolean(u.datareader || u.db_owner || u.sysadmin) || blob.includes('SELECT'),
      canWrite: Boolean(u.datawriter || u.db_owner || u.sysadmin) || blob.includes('INSERT'),
      canCreate: Boolean(u.db_owner || u.sysadmin) || blob.includes('CREATE'),
      canDrop: Boolean(u.db_owner || u.sysadmin) || blob.includes('DELETE'),
      canAdmin: Boolean(u.sysadmin || u.db_owner),
      privileges: perms.slice(0, 40),
      details: [{ resource: u.database_name || db, actions: perms.slice(0, 12) }],
      notes: u.login_name ? [`Login ${u.login_name}`] : [],
    };
  } catch (err) {
    return emptyPermission({ notes: [err.message] });
  }
}

export async function seedEnsure(conn, db, object) {
  const p = await pool(conn, db);
  const { schema } = splitName(object.name);
  if (schema && schema !== 'dbo') {
    await p.request().batch(`IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'${schema.replace(/'/g, "''")}') EXEC('CREATE SCHEMA ${q(schema)}')`);
  }
  await p.request().batch(createTableSql(object, 'mssql', q, qName(object.name)));
  return { name: object.name, created: true };
}

export async function seedWipe(conn, db, names) {
  const p = await pool(conn, db);
  const out = [];
  for (const name of names) {
    const r = await p.request().query(`DELETE FROM ${qName(name)}; SELECT @@ROWCOUNT AS n`);
    const n = r.recordset?.[0]?.n ?? r.rowsAffected?.[0] ?? 0;
    out.push({ name, deleted: Number(n) || 0 });
  }
  return out;
}

export async function seedInsert(conn, db, name, records) {
  if (!records?.length) return { name, inserted: 0 };
  const cols = recordColumns(records);
  const p = await pool(conn, db);
  const tx = new sql.Transaction(p);
  await tx.begin();
  try {
    await new sql.Request(tx).batch(`SET IDENTITY_INSERT ${qName(name)} ON`).catch(() => {});
    let inserted = 0;
    for (const rec of records) {
      const r = new sql.Request(tx);
      cols.forEach((c, i) => r.input(`p${i}`, coerceSqlValue(rec[c], { json: true, engine: 'mssql' })));
      await r.query(`INSERT INTO ${qName(name)} (${cols.map(q).join(', ')}) VALUES (${cols.map((_, i) => `@p${i}`).join(', ')})`);
      inserted += 1;
    }
    await new sql.Request(tx).batch(`SET IDENTITY_INSERT ${qName(name)} OFF`).catch(() => {});
    await tx.commit();
    return { name, inserted };
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

export async function insight(conn, db) {
  const target = db || parseConfig(conn.uri).database || 'master';
  return readOnly(conn, target, async (req) => {
    const info = await req().query(`
      SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(64)) AS version,
             CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS edition,
             CAST(SERVERPROPERTY('MachineName') AS nvarchar(128)) AS host,
             DB_NAME() AS db,
             (SELECT cpu_count FROM sys.dm_os_sys_info) AS cpu_count,
             (SELECT sqlserver_start_time FROM sys.dm_os_sys_info) AS started
    `);
    const conns = await req()
      .query('SELECT COUNT(*) AS n FROM sys.dm_exec_connections')
      .catch(() => ({ recordset: [{ n: null }] }));
    const dbs = await req()
      .query(
        `SELECT d.name, SUM(CAST(f.size AS bigint)) * 8192 AS size FROM sys.databases d
           LEFT JOIN sys.master_files f ON f.database_id = d.database_id
          WHERE HAS_DBACCESS(d.name) = 1 GROUP BY d.name ORDER BY d.name`,
      )
      .catch(() => ({ recordset: [] }));
    let objects = [];
    try {
      objects = (await listObjects(conn, target)).slice(0, 40);
    } catch {
      objects = [];
    }
    const row = info.recordset[0] || {};
    const databases = (dbs.recordset || [])
      .filter((x) => !SYSTEM_DBS.has(x.name))
      .map((x) => ({ name: x.name, sizeOnDisk: Number(x.size) || 0 }));
    return {
      version: row.version || null,
      process: 'sqlserver',
      topology: 'standalone',
      host: row.host || null,
      instanceType: row.edition || 'SQL Server',
      os: { type: 'SQL Server', name: row.edition || null, version: row.version || null },
      cpu: row.cpu_count ? { cores: row.cpu_count } : null,
      uptimeSec: row.started ? Math.round((Date.now() - new Date(row.started).getTime()) / 1000) : null,
      connections: {
        current: conns.recordset?.[0]?.n ?? null,
        available: null,
        max: null,
        active: conns.recordset?.[0]?.n ?? null,
        totalCreated: null,
      },
      databases,
      database: target,
      objects,
      dataSize: databases.reduce((s, d) => s + (d.sizeOnDisk || 0), 0),
      notes: [],
    };
  });
}

export async function lookupKeys(conn, db, name, field, values) {
  const list = [...new Set((values || []).filter((v) => v != null && v !== ''))].slice(0, 200);
  if (!list.length) return [];
  const p = await pool(conn, db);
  const req = p.request();
  list.forEach((v, i) => req.input(`p${i}`, sql.NVarChar, String(v)));
  const r = await req.query(`SELECT ${q(field)} AS k FROM ${qName(name)} WHERE ${q(field)} IN (${list.map((_, i) => `@p${i}`).join(', ')})`);
  return r.recordset.map((row) => String(row.k));
}
