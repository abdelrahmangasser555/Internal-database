async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : options.rawBody,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export const API = {
  meta: () => api('/api/meta'),
  connections: {
    list: () => api('/api/connections'),
    save: (body) =>
      api(body.id ? `/api/connections/${body.id}` : '/api/connections', {
        method: body.id ? 'PUT' : 'POST',
        body,
      }),
    remove: (id) => api(`/api/connections/${id}`, { method: 'DELETE' }),
    test: (body) => api('/api/connections/test', { method: 'POST', body }),
    databases: (id) => api(`/api/connections/${id}/databases`),
    collections: (id, db) =>
      api(`/api/connections/${id}/databases/${encodeURIComponent(db)}/collections`),
    documents: (id, db, col, q = '') =>
      api(
        `/api/connections/${id}/databases/${encodeURIComponent(db)}/collections/${encodeURIComponent(col)}/documents${q}`,
      ),
    stats: (id, db, col) =>
      api(
        `/api/connections/${id}/databases/${encodeURIComponent(db)}/collections/${encodeURIComponent(col)}/stats`,
      ),
    indexes: (id, db, col) =>
      api(
        `/api/connections/${id}/databases/${encodeURIComponent(db)}/collections/${encodeURIComponent(col)}/indexes`,
      ),
    health: () => api('/api/connections/health'),
    objects: (id, db) => api(`/api/connections/${id}/databases/${encodeURIComponent(db)}/objects`),
    describe: (id, db, name) =>
      api(`/api/connections/${id}/databases/${encodeURIComponent(db)}/objects/${encodeURIComponent(name)}/describe`),
    rows: (id, db, name, params = {}) => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v == null || v === '') return;
        qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      });
      return api(`/api/connections/${id}/databases/${encodeURIComponent(db)}/objects/${encodeURIComponent(name)}/rows?${qs}`);
    },
    query: (id, db, text, limit) =>
      api(`/api/connections/${id}/databases/${encodeURIComponent(db)}/query`, { method: 'POST', body: { text, limit } }),
    graph: (id, db) => api(`/api/connections/${id}/databases/${encodeURIComponent(db)}/graph`),
    users: (id, db, col, q = '') =>
      api(
        `/api/connections/${id}/databases/${encodeURIComponent(db)}/collections/${encodeURIComponent(col)}/users${q}`,
      ),
    permissions: (id, db) =>
      api(`/api/connections/${id}/permissions${db ? `?db=${encodeURIComponent(db)}` : ''}`),
  },
  seeds: {
    list: () => api('/api/seeds'),
    get: (id) => api(`/api/seeds/${id}`),
    save: (body) =>
      api(body.id ? `/api/seeds/${body.id}` : '/api/seeds', {
        method: body.id ? 'PUT' : 'POST',
        body,
      }),
    remove: (id) => api(`/api/seeds/${id}`, { method: 'DELETE' }),
    validate: (payload) => api('/api/seeds/validate', { method: 'POST', body: { payload } }),
    simulate: (body) => api('/api/seeds/simulate', { method: 'POST', body }),
    apply: (body) => api('/api/seeds/apply', { method: 'POST', body }),
    skills: () => api('/api/seeds/skills'),
    example: () => api('/api/seeds/example'),
  },
  dashboards: {
    list: () => api('/api/dashboards'),
    get: (id) => api(`/api/dashboards/${id}`),
    create: (body) => api('/api/dashboards', { method: 'POST', body }),
    run: (id) => api(`/api/dashboards/${id}/run`, { method: 'POST' }),
    save: (body) => api(`/api/dashboards/${body.id}`, { method: 'PUT', body }),
    remove: (id) => api(`/api/dashboards/${id}`, { method: 'DELETE' }),
  },
  jobs: {
    list: () => api('/api/jobs'),
    save: (body) =>
      api(body.id ? `/api/jobs/${body.id}` : '/api/jobs', {
        method: body.id ? 'PUT' : 'POST',
        body,
      }),
    remove: (id) => api(`/api/jobs/${id}`, { method: 'DELETE' }),
    toggle: (id) => api(`/api/jobs/${id}/toggle`, { method: 'POST' }),
    run: (id) => api(`/api/jobs/${id}/run`, { method: 'POST' }),
    status: (id) => api(`/api/jobs/${id}/status`),
  },
  records: {
    list: () => api('/api/records'),
    remove: (id) => api(`/api/records/${id}`, { method: 'DELETE' }),
    open: (id) => api(`/api/records/${id}/open`, { method: 'POST' }),
    decryptOpen: (id, passphrase) => api(`/api/records/${id}/decrypt-open`, { method: 'POST', body: { passphrase } }),
    import: (body) => api('/api/records/import', { method: 'POST', body }),
    verify: (id, passphrase) => api(`/api/records/${id}/verify`, { method: 'POST', body: { passphrase } }),
    restorePreview: (id, body) => api(`/api/records/${id}/restore/preview`, { method: 'POST', body }),
    restoreExecute: (id, body) => api(`/api/records/${id}/restore/execute`, { method: 'POST', body }),
  },
  rotate: {
    preview: (body) => api('/api/rotate/preview', { method: 'POST', body }),
    execute: (body) => api('/api/rotate/execute', { method: 'POST', body }),
    audit: (query = '') => api(`/api/rotate/audit${query ? `?${query}` : ''}`),
    auditFile: (query = '') => `/api/rotate/audit.txt${query ? `?${query}` : ''}`,
  },
  folder: () => api('/api/dialogs/folder', { method: 'POST' }),
  file: () => api('/api/dialogs/file', { method: 'POST' }),
  autostart: {
    get: () => api('/api/autostart'),
    enable: () => api('/api/autostart/enable', { method: 'POST' }),
    disable: () => api('/api/autostart/disable', { method: 'POST' }),
  },
  settings: {
    get: () => api('/api/settings'),
    save: (body) => api('/api/settings', { method: 'PUT', body }),
  },
  testEmail: (to) => api('/api/email/test', { method: 'POST', body: { to } }),
  running: () => api('/api/running'),
  writeAudit: () => api('/api/audit/writes'),
  ai: {
    status: () => api('/api/ai/status'),
    query: (body) => api('/api/ai/query', { method: 'POST', body }),
    explain: (body) => api('/api/ai/explain', { method: 'POST', body }),
    test: () => api('/api/ai/test', { method: 'POST' }),
  },
};
