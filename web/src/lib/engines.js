export const ENGINES = {
  mongodb: {
    id: 'mongodb',
    label: 'MongoDB',
    family: 'document',
    object: 'collection',
    objects: 'collections',
    logo: { dark: '/brands/mongodb-icon-dark.svg', light: '/brands/mongodb-icon-light.svg' },
    color: '#00ED64',
    example: 'mongodb+srv://user:pass@cluster.mongodb.net/app',
  },
  postgres: {
    id: 'postgres',
    label: 'PostgreSQL',
    family: 'sql',
    object: 'table',
    objects: 'tables',
    logo: '/brands/postgresql.svg',
    color: '#336791',
    example: 'postgres://user:pass@localhost:5432/app',
  },
  mysql: {
    id: 'mysql',
    label: 'MySQL',
    family: 'sql',
    object: 'table',
    objects: 'tables',
    logo: { dark: '/brands/mysql-icon-dark.svg', light: '/brands/mysql-icon-light.svg' },
    color: '#00758F',
    example: 'mysql://user:pass@localhost:3306/app',
  },
  mariadb: {
    id: 'mariadb',
    label: 'MariaDB',
    family: 'sql',
    object: 'table',
    objects: 'tables',
    logo: '/brands/mariadb.svg',
    color: '#C0765A',
    example: 'mariadb://user:pass@localhost:3306/app',
  },
  sqlite: {
    id: 'sqlite',
    label: 'SQLite',
    family: 'sql',
    object: 'table',
    objects: 'tables',
    logo: '/brands/sqlite-icon.svg',
    color: '#0F80CC',
    example: 'sqlite:///C:/data/app.db',
  },
  mssql: {
    id: 'mssql',
    label: 'SQL Server',
    family: 'sql',
    object: 'table',
    objects: 'tables',
    logo: '/brands/sql-server.svg',
    color: '#CC2927',
    example: 'mssql://user:pass@localhost:1433/app?trustServerCertificate=true',
  },
};

const ANY_ENGINE = {
  id: 'any',
  label: 'Any engine',
  family: 'any',
  object: 'collection',
  objects: 'collections',
  logo: '/brand/mark.svg',
  color: '#888888',
  example: '',
};

export function engineOf(engine) {
  if (engine === 'any') return ANY_ENGINE;
  return ENGINES[engine] || ENGINES.mongodb;
}

export function detectEngine(uri) {
  const v = String(uri || '').trim().toLowerCase();
  if (v.startsWith('mongodb://') || v.startsWith('mongodb+srv://')) return 'mongodb';
  if (v.startsWith('postgres://') || v.startsWith('postgresql://')) return 'postgres';
  if (v.startsWith('mariadb://')) return 'mariadb';
  if (v.startsWith('mysql://')) return 'mysql';
  if (v.startsWith('sqlite:') || v.startsWith('file:') || /\.(db|sqlite|sqlite3|db3)$/.test(v)) return 'sqlite';
  if (v.startsWith('mssql://') || v.startsWith('sqlserver://') || /(^|;)\s*(server|data source)\s*=/.test(v)) return 'mssql';
  return null;
}

export function isSql(engine) {
  return engineOf(engine).family === 'sql';
}

/** Short display name: drop the default schema prefix. */
export function shortName(name, engine) {
  const s = String(name || '');
  if (engine === 'postgres' && s.startsWith('public.')) return s.slice(7);
  if (engine === 'mssql' && s.startsWith('dbo.')) return s.slice(4);
  return s;
}

export const ENV_TONES = {
  production: { label: 'Production', tone: 'fail' },
  staging: { label: 'Staging', tone: 'warn' },
  development: { label: 'Development', tone: 'info' },
  local: { label: 'Local', tone: 'muted' },
};
