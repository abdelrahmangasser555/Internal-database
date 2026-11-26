const LAST_KEY = 'bs-last-connection';

export function rememberConnection(id) {
  if (id) localStorage.setItem(LAST_KEY, id);
}

export function lastConnectionId() {
  try {
    return localStorage.getItem(LAST_KEY) || '';
  } catch {
    return '';
  }
}

export function connectionPath(id, ...parts) {
  const segs = ['/c', id, ...parts.filter((part) => part != null && part !== '')];
  return segs.map((seg, i) => (i === 0 ? seg : encodeURIComponent(String(seg)))).join('/');
}

export function explorePath(id, db, col) {
  if (col) return connectionPath(id, 'explore', db, col);
  if (db) return connectionPath(id, 'explore', db);
  return connectionPath(id, 'explore');
}

export function backupsPath(id) {
  return connectionPath(id, 'backups');
}

export function analyticsPath(id, dashboardId) {
  return dashboardId ? connectionPath(id, 'analytics', dashboardId) : connectionPath(id, 'analytics');
}

export function seedsPath(id, seedId) {
  return seedId ? connectionPath(id, 'seeds', seedId) : connectionPath(id, 'seeds');
}

export function flowPath(id) {
  return connectionPath(id, 'flow');
}

export function rotatePath(id) {
  return connectionPath(id, 'rotate');
}

export function settingsPath() {
  return '/settings';
}

export function schemasPath(id) {
  return id ? `/schemas/${encodeURIComponent(id)}` : '/schemas';
}

export function connectionIdFromPath(pathname) {
  const match = String(pathname || '').match(/^\/c\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export function connectionTools(conn) {
  const id = conn?.id;
  if (!id) return [];
  const tools = [
    { to: connectionPath(id), label: 'Overview', end: true, id: 'overview' },
    { to: explorePath(id), label: 'Explore', id: 'explore' },
    { to: backupsPath(id), label: 'Backups', id: 'backups' },
    { to: analyticsPath(id), label: 'Analytics', id: 'analytics' },
    { to: seedsPath(id), label: 'Seeds', id: 'seeds' },
    { to: flowPath(id), label: 'Flow', id: 'flow' },
  ];
  if ((conn.engine || 'mongodb') === 'mongodb') {
    tools.push({ to: rotatePath(id), label: 'Rotate', id: 'rotate' });
  }
  return tools;
}
