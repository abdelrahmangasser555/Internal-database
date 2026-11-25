// Engine registry: detection from a connection string, display metadata, masking.

export const ENGINES = {
  mongodb: { id: 'mongodb', label: 'MongoDB', family: 'document', objectLabel: 'collection', objectPlural: 'collections' },
  postgres: { id: 'postgres', label: 'PostgreSQL', family: 'sql', objectLabel: 'table', objectPlural: 'tables' },
  mysql: { id: 'mysql', label: 'MySQL', family: 'sql', objectLabel: 'table', objectPlural: 'tables' },
  mariadb: { id: 'mariadb', label: 'MariaDB', family: 'sql', objectLabel: 'table', objectPlural: 'tables' },
  sqlite: { id: 'sqlite', label: 'SQLite', family: 'sql', objectLabel: 'table', objectPlural: 'tables' },
  mssql: { id: 'mssql', label: 'SQL Server', family: 'sql', objectLabel: 'table', objectPlural: 'tables' },
};

export function detectEngine(uri) {
  const value = String(uri || '').trim();
  const lower = value.toLowerCase();
  if (lower.startsWith('mongodb://') || lower.startsWith('mongodb+srv://')) return 'mongodb';
  if (lower.startsWith('postgres://') || lower.startsWith('postgresql://')) return 'postgres';
  if (lower.startsWith('mariadb://')) return 'mariadb';
  if (lower.startsWith('mysql://')) return 'mysql';
  if (lower.startsWith('sqlite:') || lower.startsWith('file:') || /\.(db|sqlite|sqlite3|db3)$/i.test(value)) return 'sqlite';
  if (lower.startsWith('mssql://') || lower.startsWith('sqlserver://')) return 'mssql';
  if (/(^|;)\s*(server|data source)\s*=/i.test(value)) return 'mssql';
  return null;
}

export function engineInfo(engine) {
  return ENGINES[engine] || ENGINES.mongodb;
}

export function isSqlEngine(engine) {
  return engineInfo(engine).family === 'sql';
}

/** Hide passwords in URL-style and key=value connection strings. */
export function maskUri(uri) {
  return String(uri || '')
    .replace(/(:\/\/[^:/@]+:)([^@]+)(@)/, '$1*****$3')
    .replace(/((?:^|;)\s*(?:password|pwd)\s*=)([^;]*)/gi, '$1*****')
    .replace(/([?&](?:password|pwd)=)([^&]*)/gi, '$1*****');
}

/** sqlite:///abs/file.db, sqlite:C:\file.db, file:/x.db or a bare path → filesystem path. */
export function sqlitePath(uri) {
  let value = String(uri || '').trim();
  value = value.replace(/^sqlite:(\/\/)?/i, '').replace(/^file:(\/\/)?/i, '');
  value = value.split('?')[0];
  // sqlite:///C:/data/app.db → C:/data/app.db on Windows
  if (/^\/[A-Za-z]:[\\/]/.test(value)) value = value.slice(1);
  try {
    value = decodeURIComponent(value);
  } catch {
    // keep raw
  }
  return value;
}
