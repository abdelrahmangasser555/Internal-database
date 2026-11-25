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

const API = {
  meta: () => api('/api/meta'),
  connections: {
    list: () => api('/api/connections'),
    save: (body) => api(body.id ? `/api/connections/${body.id}` : '/api/connections', { method: body.id ? 'PUT' : 'POST', body }),
    remove: (id) => api(`/api/connections/${id}`, { method: 'DELETE' }),
    test: (body) => api('/api/connections/test', { method: 'POST', body }),
    databases: (id) => api(`/api/connections/${id}/databases`),
    collections: (id, db) => api(`/api/connections/${id}/databases/${encodeURIComponent(db)}/collections`),
    documents: (id, db, col, q = '') =>
      api(`/api/connections/${id}/databases/${encodeURIComponent(db)}/collections/${encodeURIComponent(col)}/documents${q}`),
    users: (id, db, col, q = '') =>
      api(`/api/connections/${id}/databases/${encodeURIComponent(db)}/collections/${encodeURIComponent(col)}/users${q}`),
  },
  jobs: {
    list: () => api('/api/jobs'),
    save: (body) => api(body.id ? `/api/jobs/${body.id}` : '/api/jobs', { method: body.id ? 'PUT' : 'POST', body }),
    remove: (id) => api(`/api/jobs/${id}`, { method: 'DELETE' }),
    toggle: (id) => api(`/api/jobs/${id}/toggle`, { method: 'POST' }),
    run: (id) => api(`/api/jobs/${id}/run`, { method: 'POST' }),
  },
  records: {
    list: () => api('/api/records'),
    remove: (id) => api(`/api/records/${id}`, { method: 'DELETE' }),
    open: (id) => api(`/api/records/${id}/open`, { method: 'POST' }),
    decryptOpen: (id) => api(`/api/records/${id}/decrypt-open`, { method: 'POST' }),
    import: (body) => api('/api/records/import', { method: 'POST', body }),
  },
  rotate: {
    preview: (body) => api('/api/rotate/preview', { method: 'POST', body }),
    execute: (body) => api('/api/rotate/execute', { method: 'POST', body }),
  },
  folder: () => api('/api/dialogs/folder', { method: 'POST' }),
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
};
