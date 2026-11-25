// Read-only guard for SQL text. This is a defence layer on top of the engine-level
// read-only sessions (READ ONLY transactions, SQLite readOnly handles).

const ALLOWED_FIRST = new Set(['select', 'with', 'explain', 'show', 'describe', 'desc', 'values', 'table', 'pragma']);

const FORBIDDEN = [
  'insert', 'update', 'delete', 'merge', 'upsert', 'drop', 'alter', 'create', 'truncate', 'grant', 'revoke',
  'call', 'exec', 'execute', 'copy', 'vacuum', 'attach', 'detach', 'reindex', 'lock', 'unlock',
  'into', 'do', 'load', 'handler', 'rename', 'install', 'uninstall',
  'shutdown', 'kill', 'dbcc', 'bulk', 'openrowset', 'opendatasource', 'xp_cmdshell',
  'sp_configure', 'reconfigure', 'begin', 'commit', 'rollback', 'savepoint', 'prepare', 'deallocate',
  'listen', 'notify', 'discard', 'checkpoint', 'set',
];

const FORBIDDEN_FUNCTIONS = [
  'pg_terminate_backend', 'pg_cancel_backend', 'pg_reload_conf', 'pg_read_file', 'pg_read_binary_file',
  'pg_ls_dir', 'pg_stat_file', 'lo_import', 'lo_export', 'dblink', 'dblink_exec', 'pg_sleep', 'set_config',
  'pg_advisory_lock', 'sleep', 'benchmark', 'load_file', 'get_lock', 'waitfor', 'load_extension', 'writefile',
  'readfile', 'edit',
];

/** Remove comments and string/identifier literals so keyword checks only see code. */
export function stripSql(text) {
  let out = '';
  const s = String(text || '');
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];
    if (c === '-' && n === '-') {
      while (i < s.length && s[i] !== '\n') i += 1;
      out += ' ';
      continue;
    }
    if (c === '#') {
      while (i < s.length && s[i] !== '\n') i += 1;
      out += ' ';
      continue;
    }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i += 1;
      i += 2;
      out += ' ';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i += 1;
      while (i < s.length) {
        if (s[i] === quote && s[i + 1] === quote) {
          i += 2;
          continue;
        }
        if (s[i] === '\\' && quote === "'") {
          i += 2;
          continue;
        }
        if (s[i] === quote) break;
        i += 1;
      }
      i += 1;
      out += quote === "'" ? " '' " : ' _ident_ ';
      continue;
    }
    if (c === '[') {
      while (i < s.length && s[i] !== ']') i += 1;
      i += 1;
      out += ' _ident_ ';
      continue;
    }
    if (c === '$') {
      // Postgres dollar quoting $tag$ ... $tag$
      const m = /^\$[A-Za-z_]*\$/.exec(s.slice(i));
      if (m) {
        const end = s.indexOf(m[0], i + m[0].length);
        i = end === -1 ? s.length : end + m[0].length;
        out += " '' ";
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

export function assertReadOnlySql(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('Query is empty');
  if (raw.length > 100_000) throw new Error('Query is too long');
  const code = stripSql(raw).trim().replace(/;\s*$/, '');
  if (code.includes(';')) throw new Error('Run one statement at a time');
  const words = code.toLowerCase().match(/[a-z_][a-z0-9_$]*/g) || [];
  const first = words[0];
  if (!ALLOWED_FIRST.has(first)) {
    throw new Error('Only read-only statements are allowed here (SELECT, WITH, EXPLAIN, SHOW, DESCRIBE, VALUES)');
  }
  const bad = words.find((w) => FORBIDDEN.includes(w));
  if (bad) throw new Error(`"${bad.toUpperCase()}" is not allowed. Explorer and the assistant are read-only.`);
  const badFn = FORBIDDEN_FUNCTIONS.find((fn) => new RegExp(`\\b${fn}\\s*\\(`, 'i').test(code));
  if (badFn) throw new Error(`${badFn}() is blocked in the read-only runner`);
  if (first === 'pragma' && /=/.test(code)) throw new Error('PRAGMA assignments are not allowed');
  if (first === 'explain' && /\banalyze\b/i.test(code) && !/^explain\s+(\(.*\)\s*)?(analyze\s+)?(select|with|values|table)\b/i.test(code)) {
    throw new Error('EXPLAIN ANALYZE is only allowed for SELECT statements');
  }
  return raw.replace(/;\s*$/, '');
}

export function isSelectLike(text) {
  const first = (stripSql(text).trim().toLowerCase().match(/[a-z_]+/) || [])[0];
  return ['select', 'with', 'values', 'table'].includes(first);
}

/** Make driver values JSON-safe for the UI grid. */
export function displayValue(value) {
  if (value == null) return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? String(value) : value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const buf = Buffer.from(value);
    const hex = buf.subarray(0, 32).toString('hex');
    return `\\x${hex}${buf.length > 32 ? `… (${buf.length} bytes)` : ''}`;
  }
  if (typeof value === 'object') return value;
  return value;
}

/** Lossless JSON encoding for backup files. */
export function backupValue(value) {
  if (value == null) return null;
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { $binary: Buffer.from(value).toString('base64') };
  return value;
}

export function restoreValue(value, { json = false } = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if ('$binary' in value && Object.keys(value).length === 1) return Buffer.from(value.$binary, 'base64');
    if ('$bigint' in value && Object.keys(value).length === 1) return value.$bigint;
  }
  if (json && value != null && typeof value === 'object') return JSON.stringify(value);
  return value;
}

export function clampLimit(limit, fallback = 50, max = 1000) {
  return Math.min(Math.max(Number(limit) || fallback, 1), max);
}

/** Order tables so referenced tables come before referencing ones. */
export function topoSortTables(tables, relations) {
  const names = tables.map((t) => t.name);
  const deps = new Map(names.map((n) => [n, new Set()]));
  for (const rel of relations || []) {
    if (rel.from !== rel.to && deps.has(rel.from) && deps.has(rel.to)) deps.get(rel.from).add(rel.to);
  }
  const out = [];
  const seen = new Set();
  const visit = (n, stack = new Set()) => {
    if (seen.has(n) || stack.has(n)) return;
    stack.add(n);
    for (const d of deps.get(n) || []) visit(d, stack);
    seen.add(n);
    out.push(n);
  };
  names.forEach((n) => visit(n));
  return out;
}
