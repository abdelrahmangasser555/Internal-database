// Shared helpers for the seed write path (ensure / wipe / insert).
// Quoting stays in each adapter; types and row coercion live here.

import { restoreValue } from './sqlsafe.js';

export function inferSqlType(value, engine) {
  if (typeof value === 'boolean') {
    if (engine === 'mysql' || engine === 'mariadb') return 'TINYINT(1)';
    if (engine === 'mssql') return 'BIT';
    if (engine === 'postgres') return 'BOOLEAN';
    return 'INTEGER';
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return engine === 'mssql' ? 'BIGINT' : 'INTEGER';
    return engine === 'mssql' ? 'FLOAT' : engine === 'postgres' ? 'DOUBLE PRECISION' : 'REAL';
  }
  if (value && typeof value === 'object') {
    if ('$date' in value) return engine === 'mssql' ? 'DATETIME2' : engine === 'postgres' ? 'TIMESTAMPTZ' : 'TEXT';
    if ('$bigint' in value) return engine === 'mssql' ? 'BIGINT' : 'INTEGER';
    if ('$binary' in value) return engine === 'postgres' ? 'BYTEA' : engine === 'mssql' ? 'VARBINARY(MAX)' : 'BLOB';
    if (engine === 'postgres') return 'JSONB';
    if (engine === 'mysql' || engine === 'mariadb') return 'JSON';
    if (engine === 'mssql') return 'NVARCHAR(MAX)';
    return 'TEXT';
  }
  if (typeof value === 'string' && value.length > 400) {
    return engine === 'mssql' ? 'NVARCHAR(MAX)' : 'TEXT';
  }
  if (engine === 'mssql') return 'NVARCHAR(400)';
  if (engine === 'mysql' || engine === 'mariadb') return 'VARCHAR(400)';
  return 'TEXT';
}

export function sqlColumnsFor(object, engine) {
  const records = object.records || [];
  const declared = Array.isArray(object.columns) ? object.columns : [];
  const names = new Set();
  const cols = [];
  const add = (name, type, { pk, required, nullable } = {}) => {
    if (!name || names.has(name) || name.includes('.')) return;
    names.add(name);
    cols.push({ name, type, pk: Boolean(pk), required: Boolean(required), nullable: nullable !== false });
  };
  for (const c of declared) add(c.name, c.type, c);
  for (const rec of records) {
    for (const [k, v] of Object.entries(rec || {})) {
      if (k.includes('.')) continue;
      if (!names.has(k)) add(k, inferSqlType(v, engine), { pk: object.pk?.includes(k), required: object.rules?.required?.includes(k) });
    }
  }
  for (const k of object.pk || []) if (!names.has(k)) add(k, 'TEXT', { pk: true, required: true });
  if (!cols.length) add('id', 'TEXT', { pk: true, required: true });
  return cols;
}

export function columnSqlType(col, engine) {
  const t = String(col.type || 'string').toLowerCase();
  if (['int', 'integer', 'bigint', 'number', 'float', 'double', 'real'].includes(t)) {
    if (t === 'float' || t === 'double' || t === 'real' || t === 'number') {
      return engine === 'mssql' ? 'FLOAT' : engine === 'postgres' ? 'DOUBLE PRECISION' : 'REAL';
    }
    return engine === 'mssql' ? 'BIGINT' : 'INTEGER';
  }
  if (['bool', 'boolean'].includes(t)) {
    if (engine === 'mysql' || engine === 'mariadb') return 'TINYINT(1)';
    if (engine === 'mssql') return 'BIT';
    if (engine === 'postgres') return 'BOOLEAN';
    return 'INTEGER';
  }
  if (['json', 'object', 'array', 'jsonb'].includes(t)) {
    if (engine === 'postgres') return 'JSONB';
    if (engine === 'mysql' || engine === 'mariadb') return 'JSON';
    if (engine === 'mssql') return 'NVARCHAR(MAX)';
    return 'TEXT';
  }
  if (['date', 'datetime', 'timestamp'].includes(t)) {
    if (engine === 'postgres') return 'TIMESTAMPTZ';
    if (engine === 'mssql') return 'DATETIME2';
    return 'TEXT';
  }
  if (engine === 'mssql') return col.pk ? 'NVARCHAR(191)' : 'NVARCHAR(400)';
  if (engine === 'mysql' || engine === 'mariadb') return col.pk ? 'VARCHAR(191)' : 'TEXT';
  return 'TEXT';
}

export function createTableSql(object, engine, qIdent, qTable) {
  const cols = sqlColumnsFor(object, engine);
  const pk = (object.pk || []).filter((n) => cols.some((c) => c.name === n));
  const lines = cols.map((c) => {
    const notNull = c.pk || c.required ? ' NOT NULL' : '';
    return `  ${qIdent(c.name)} ${columnSqlType(c, engine)}${notNull}`;
  });
  if (pk.length) lines.push(`  PRIMARY KEY (${pk.map(qIdent).join(', ')})`);
  return `CREATE TABLE IF NOT EXISTS ${qTable} (\n${lines.join(',\n')}\n)`;
}

export function coerceSqlValue(value, { json = false, engine } = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value) && '$date' in value) {
    return value.$date;
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && '$oid' in value) {
    return value.$oid;
  }
  const restored = restoreValue(value, { json });
  if (typeof restored === 'boolean') {
    if (engine === 'mysql' || engine === 'mariadb' || engine === 'sqlite') return restored ? 1 : 0;
  }
  return restored;
}

export function recordColumns(records) {
  const names = [];
  const seen = new Set();
  for (const rec of records || []) {
    for (const k of Object.keys(rec || {})) {
      if (k.includes('.') || seen.has(k)) continue;
      seen.add(k);
      names.push(k);
    }
  }
  return names;
}

export function emptyPermission({ user = 'unknown', notes = [] } = {}) {
  return {
    user,
    roles: [],
    canRead: null,
    canWrite: null,
    canCreate: null,
    canDrop: null,
    canAdmin: null,
    privileges: [],
    details: [],
    notes,
  };
}
