import * as mongo from './mongo.js';
import * as postgres from './postgres.js';
import * as mysql from './mysql.js';
import * as sqlite from './sqlite.js';
import * as mssql from './mssql.js';
import { detectEngine, engineInfo } from '../engines.js';
import { getConnection, listConnections } from '../store.js';

// Every adapter implements the same surface so the UI, backups and the assistant
// do not care which engine sits behind a connection:
//   test(uri) listDatabases(conn) listObjects(conn, db) describe(conn, db, name)
//   rows(conn, db, name, opts) query(conn, db, text, opts) graph(conn, db)
//   dump(conn, db, opts, dir) restoreCheck(conn, db, names) restore(conn, db, opts) close(id)
//   permissions(conn, db) insight(conn, db) seedEnsure() seedWipe() seedInsert() lookupKeys()
// Read paths are read-only by construction. dump() is read-only. restore() and
// seed*() are the explicit write paths (Restore sheet and Import Seeds).

const ADAPTERS = { mongodb: mongo, postgres, mysql, mariadb: mysql, sqlite, mssql };

export function adapterFor(engine) {
  const adapter = ADAPTERS[engine || 'mongodb'];
  if (!adapter) throw new Error(`Unsupported engine: ${engine}`);
  return adapter;
}

export function resolveConnection(id) {
  const conn = getConnection(id, { includeUri: true });
  if (!conn?.uri) throw new Error('Connection not found');
  return { conn, adapter: adapterFor(conn.engine), info: engineInfo(conn.engine) };
}

export async function testConnectionUri(uri, engine) {
  const resolved = engine || detectEngine(uri);
  if (!resolved) throw new Error('Unrecognised connection string. Use mongodb://, postgres://, mysql://, mariadb://, sqlite:/path or mssql://');
  const result = await adapterFor(resolved).test(uri);
  const finalEngine = resolved === 'mysql' && result.flavor === 'mariadb' ? 'mariadb' : resolved;
  return { ...result, engine: finalEngine, label: engineInfo(finalEngine).label };
}

export async function healthCheckAll() {
  const rows = listConnections();
  return Promise.all(
    rows.map(async (row) => {
      const started = Date.now();
      try {
        const { conn, adapter } = resolveConnection(row.id);
        const result = await Promise.race([
          adapter.test(conn.uri),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out after 15s')), 15_000)),
        ]);
        return { id: row.id, ok: true, version: result.version, latencyMs: result.latencyMs ?? Date.now() - started, checkedAt: new Date().toISOString() };
      } catch (err) {
        return { id: row.id, ok: false, error: err.message, latencyMs: Date.now() - started, checkedAt: new Date().toISOString() };
      }
    }),
  );
}

export async function closeAdapter(id, engine) {
  await adapterFor(engine).close(id).catch(() => {});
}
