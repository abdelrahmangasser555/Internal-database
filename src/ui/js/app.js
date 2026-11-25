const state = {
  connections: [],
  expanded: {},
  dbs: {},
  cols: {},
  selected: null,
  view: 'home',
  jobs: [],
  records: [],
  meta: {},
  docs: null,
  skip: 0,
};

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toast(message) {
  const root = $('toast-root');
  root.innerHTML = `<div class="toast">${escapeHtml(message)}</div>`;
  setTimeout(() => {
    root.innerHTML = '';
  }, 3200);
}

function cell(value) {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function openModal(title, bodyHtml, onSubmit) {
  const root = $('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop">
      <form class="modal">
        <h2>${escapeHtml(title)}</h2>
        ${bodyHtml}
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="modal-cancel">Cancel</button>
          <button type="submit" class="btn btn-green" style="width:auto">Save</button>
        </div>
      </form>
    </div>`;
  root.querySelector('#modal-cancel').onclick = () => {
    root.innerHTML = '';
  };
  root.querySelector('form').onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const data = Object.fromEntries(form.entries());
    try {
      await onSubmit(data, event.target);
      root.innerHTML = '';
    } catch (err) {
      toast(err.message);
    }
  };
}

function setCrumbs(text) {
  $('crumbs').textContent = text;
}

function setActions(html) {
  $('top-actions').innerHTML = html;
}

async function refreshTree() {
  state.connections = await API.connections.list();
  const tree = $('connection-tree');
  if (!state.connections.length) {
    tree.innerHTML = `<div class="empty">No connections yet</div>`;
    return;
  }
  tree.innerHTML = state.connections
    .map((conn) => {
      const open = state.expanded[conn.id];
      const dbs = state.dbs[conn.id] || [];
      return `
        <div>
          <div class="tree-item ${state.selected?.connectionId === conn.id && !state.selected?.db ? 'active' : ''}" data-conn="${conn.id}">
            <span class="chev">${open ? '▾' : '▸'}</span>
            <span class="dot" style="background:${escapeHtml(conn.color || '#00ED64')}"></span>
            <span>${escapeHtml(conn.name)}</span>
          </div>
          ${
            open
              ? dbs
                  .map((db) => {
                    const key = `${conn.id}:${db.name}`;
                    const colOpen = state.expanded[key];
                    const cols = state.cols[key] || [];
                    return `
                    <div class="tree-children">
                      <div class="tree-child" data-conn="${conn.id}" data-db="${escapeHtml(db.name)}">
                        <span class="chev">${colOpen ? '▾' : '▸'}</span>
                        ${escapeHtml(db.name)}
                      </div>
                      ${
                        colOpen
                          ? cols
                              .map(
                                (col) => `
                            <div class="tree-leaf ${state.selected?.col === col.name && state.selected?.db === db.name ? 'active' : ''}"
                              data-conn="${conn.id}" data-db="${escapeHtml(db.name)}" data-col="${escapeHtml(col.name)}">
                              ${escapeHtml(col.name)}
                            </div>`,
                              )
                              .join('')
                          : ''
                      }
                    </div>`;
                  })
                  .join('')
              : ''
          }
        </div>`;
    })
    .join('');

  tree.querySelectorAll('.tree-item').forEach((el) => {
    el.onclick = async () => {
      const id = el.dataset.conn;
      state.expanded[id] = !state.expanded[id];
      if (state.expanded[id] && !state.dbs[id]) {
        try {
          state.dbs[id] = await API.connections.databases(id);
        } catch (err) {
          toast(err.message);
          state.expanded[id] = false;
        }
      }
      await refreshTree();
    };
    el.oncontextmenu = (event) => {
      event.preventDefault();
      editConnection(state.connections.find((c) => c.id === el.dataset.conn));
    };
  });
  tree.querySelectorAll('.tree-child').forEach((el) => {
    el.onclick = async () => {
      const key = `${el.dataset.conn}:${el.dataset.db}`;
      state.expanded[key] = !state.expanded[key];
      if (state.expanded[key] && !state.cols[key]) {
        state.cols[key] = await API.connections.collections(el.dataset.conn, el.dataset.db);
      }
      state.selected = { connectionId: el.dataset.conn, db: el.dataset.db, col: null };
      await refreshTree();
    };
  });
  tree.querySelectorAll('.tree-leaf').forEach((el) => {
    el.onclick = () => openCollection(el.dataset.conn, el.dataset.db, el.dataset.col);
  });
}

async function openCollection(connectionId, db, col) {
  state.selected = { connectionId, db, col };
  state.view = 'browser';
  state.skip = 0;
  await refreshTree();
  await renderBrowser();
}

async function renderBrowser() {
  const { connectionId, db, col } = state.selected || {};
  if (!col) {
    $('workspace').innerHTML = `<div class="empty">Select a collection to browse documents. This view is read-only.</div>`;
    return;
  }
  setCrumbs(`${connectionName(connectionId)} / ${db} / ${col}`);
  setActions(`
    <button class="btn" id="btn-backup-db">Backup database</button>
    <button class="btn" id="btn-rotate-here">Rotate passwords</button>
  `);
  const data = await API.connections.documents(
    connectionId,
    db,
    col,
    `?skip=${state.skip}&limit=50`,
  );
  state.docs = data;
  const keys = [];
  for (const doc of data.documents) {
    Object.keys(doc).forEach((key) => {
      if (!keys.includes(key) && keys.length < 8) keys.push(key);
    });
  }
  $('workspace').innerHTML = `
    <div class="section">
      <h1>Documents</h1>
      <div class="hint">${data.estimatedCount} estimated documents · read-only</div>
    </div>
    <table class="data">
      <thead><tr>${keys.map((k) => `<th>${escapeHtml(k)}</th>`).join('')}</tr></thead>
      <tbody>
        ${data.documents
          .map(
            (doc, i) =>
              `<tr data-i="${i}">${keys.map((k) => `<td>${escapeHtml(cell(doc[k]))}</td>`).join('')}</tr>`,
          )
          .join('')}
      </tbody>
    </table>
    <div class="pager">
      <button class="btn" id="prev" ${state.skip === 0 ? 'disabled' : ''}>Previous</button>
      <span>${state.skip + 1}–${state.skip + data.documents.length} of ${data.estimatedCount}</span>
      <button class="btn" id="next" ${state.skip + data.documents.length >= data.estimatedCount ? 'disabled' : ''}>Next</button>
    </div>
    <div id="doc-json"></div>
  `;
  $('workspace').querySelectorAll('tbody tr').forEach((row) => {
    row.onclick = () => {
      const doc = data.documents[Number(row.dataset.i)];
      $('doc-json').innerHTML = `<div class="json-drawer">${escapeHtml(JSON.stringify(doc, null, 2))}</div>`;
    };
  });
  $('prev').onclick = async () => {
    state.skip = Math.max(0, state.skip - 50);
    await renderBrowser();
  };
  $('next').onclick = async () => {
    state.skip += 50;
    await renderBrowser();
  };
  $('btn-backup-db').onclick = () => jobModal({ connectionId, database: db });
  $('btn-rotate-here').onclick = () => renderRotate({ connectionId, db, col });
}

function connectionName(id) {
  return state.connections.find((c) => c.id === id)?.name || 'Connection';
}

function editConnection(existing) {
  openModal(
    existing ? 'Edit connection' : 'New connection',
    `
      <div class="stack">
        <div><label>Name</label><input name="name" required value="${escapeHtml(existing?.name || '')}"></div>
        <div><label>Connection string</label>
          <input name="uri" placeholder="mongodb+srv://user:pass@host/db" value="" ${existing ? '' : 'required'}>
          <div class="hint">${existing ? `Saved: ${escapeHtml(existing.uriMasked)}. Leave blank to keep it.` : 'URI is stored encrypted on this device only.'}</div>
        </div>
        <div><label>Color</label><input name="color" type="color" value="${escapeHtml(existing?.color || '#00ed64')}"></div>
      </div>
    `,
    async (data) => {
      if (existing && !data.uri) delete data.uri;
      const saved = await API.connections.save({ ...data, id: existing?.id });
      await API.connections.test({ id: saved.id });
      toast('Connected');
      delete state.dbs[saved.id];
      await refreshTree();
    },
  );
}

function jobModal(preset = {}) {
  const connections = state.connections
    .map((c) => `<option value="${c.id}" ${c.id === preset.connectionId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
    .join('');
  openModal(
    preset.id ? 'Edit backup job' : 'New backup job',
    `
      <div class="stack">
        <div><label>Name</label><input name="name" value="${escapeHtml(preset.name || 'Nightly backup')}" required></div>
        <div><label>Connection</label><select name="connectionId">${connections}</select></div>
        <div><label>Database</label><input name="database" value="${escapeHtml(preset.database || '')}" required></div>
        <div><label>Collections (blank = all)</label>
          <input name="collections" value="${escapeHtml((preset.collections || []).join(', '))}" placeholder="users, orders">
        </div>
        <div>
          <label>Backup folder</label>
          <div class="row">
            <input name="targetPath" id="targetPath" value="${escapeHtml(preset.targetPath || '')}" required>
            <button type="button" class="btn" id="pick-folder">Browse</button>
          </div>
        </div>
        <div class="grid-2">
          <div>
            <label>Interval type</label>
            <select name="intervalType">
              <option value="every" ${preset.interval?.type === 'every' ? 'selected' : ''}>Every</option>
              <option value="daily" ${!preset.interval || preset.interval?.type === 'daily' ? 'selected' : ''}>Daily</option>
              <option value="weekly" ${preset.interval?.type === 'weekly' ? 'selected' : ''}>Weekly</option>
            </select>
          </div>
          <div>
            <label>Every / time</label>
            <input name="every" value="${escapeHtml(preset.interval?.every || 6)}" placeholder="6">
            <select name="unit">
              <option value="hours">hours</option>
              <option value="minutes">minutes</option>
              <option value="days">days</option>
            </select>
            <input name="time" value="${escapeHtml(preset.interval?.time || '02:00')}" placeholder="02:00">
          </div>
        </div>
        <div>
          <label>Notify emails (comma separated)</label>
          <input name="notifyEmails" value="${escapeHtml((preset.notifyEmails || []).join(', '))}">
        </div>
        <label class="row"><input type="checkbox" name="encrypt" ${preset.encrypt ? 'checked' : ''} style="width:auto"> Encrypt backups (AES-256-GCM)</label>
        <div><label>Encryption passphrase</label>
          <input name="passphrase" type="password" placeholder="${preset.hasPassphrase ? 'Leave blank to keep current' : 'Required if encryption is on'}">
          <div class="hint">Use a passphrase if you will move backups to another machine. Encrypted files can be opened from this dashboard or exported as-is.</div>
        </div>
      </div>
    `,
    async (data, form) => {
      const encrypt = form.querySelector('[name=encrypt]').checked;
      const collections = String(data.collections || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const intervalType = data.intervalType;
      const interval =
        intervalType === 'every'
          ? { type: 'every', every: Number(data.every || 1), unit: data.unit || 'hours' }
          : intervalType === 'weekly'
            ? { type: 'weekly', weekday: 0, time: data.time || '02:00' }
            : { type: 'daily', time: data.time || '02:00' };
      const body = {
        id: preset.id,
        name: data.name,
        connectionId: data.connectionId,
        database: data.database,
        collections,
        allCollections: collections.length === 0,
        targetPath: data.targetPath,
        interval,
        notifyEmails: String(data.notifyEmails || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        encrypt,
      };
      if (data.passphrase) body.passphrase = data.passphrase;
      if (encrypt && !data.passphrase && !preset.hasPassphrase) {
        throw new Error('Set an encryption passphrase so this backup can be opened later or on another machine.');
      }
      await API.jobs.save(body);
      toast('Backup job saved');
      if (state.view === 'backups') await renderBackups();
    },
  );
  setTimeout(() => {
    document.getElementById('pick-folder')?.addEventListener('click', async (event) => {
      event.preventDefault();
      try {
        const { path } = await API.folder();
        if (path) document.getElementById('targetPath').value = path;
      } catch (err) {
        toast(err.message);
      }
    });
  }, 0);
}

async function renderBackups() {
  state.view = 'backups';
  setCrumbs('Backups');
  setActions(`<button class="btn btn-green" style="width:auto" id="btn-new-job">New backup job</button>`);
  document.querySelectorAll('.linkish').forEach((el) => el.classList.toggle('active', el.dataset.view === 'backups'));
  const [jobs, records] = await Promise.all([API.jobs.list(), API.records.list()]);
  state.jobs = jobs;
  state.records = records;
  $('workspace').innerHTML = `
    <div class="section">
      <h1>Scheduled backups</h1>
      ${
        jobs.length
          ? `<table class="data">
        <thead><tr><th>Name</th><th>Database</th><th>Interval</th><th>Next run</th><th>Encrypt</th><th>Enabled</th><th></th></tr></thead>
        <tbody>
          ${jobs
            .map(
              (job) => `<tr data-job="${job.id}">
                <td>${escapeHtml(job.name)}</td>
                <td>${escapeHtml(job.database)}</td>
                <td>${escapeHtml(job.intervalLabel)}</td>
                <td>${escapeHtml(job.nextRunLabel)}</td>
                <td>${job.encrypt ? 'Yes' : 'No'}</td>
                <td>${job.enabled ? '<span class="badge ok">on</span>' : '<span class="badge muted">off</span>'}</td>
                <td>
                  <button class="btn" data-run="${job.id}">Run now</button>
                  <button class="btn" data-toggle="${job.id}">Toggle</button>
                  <button class="btn btn-danger" data-deljob="${job.id}">Delete</button>
                </td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>`
          : `<div class="empty">No backup jobs yet</div>`
      }
    </div>
    <div class="section">
      <h1>Backup history</h1>
      ${
        records.length
          ? `<table class="data">
        <thead><tr><th>When</th><th>Job</th><th>Database</th><th>Status</th><th>Size</th><th>Location</th></tr></thead>
        <tbody>
          ${records
            .map(
              (rec) => `<tr data-rec="${rec.id}">
                <td>${escapeHtml(rec.finishedAt || rec.startedAt)}</td>
                <td>${escapeHtml(rec.jobName)}</td>
                <td>${escapeHtml(rec.database)}</td>
                <td>${
                  rec.status === 'success'
                    ? rec.exists
                      ? '<span class="badge ok">success</span>'
                      : '<span class="badge warn">missing file</span>'
                    : `<span class="badge fail">${escapeHtml(rec.status)}</span>`
                }</td>
                <td>${escapeHtml(rec.sizeLabel)}</td>
                <td class="${rec.exists ? '' : 'missing'}">${escapeHtml(rec.filePath)}</td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
      <div class="hint">Click a row to open the folder. Missing files can be located or removed from this device record.</div>`
          : `<div class="empty">No backups on this device yet</div>`
      }
    </div>
  `;
  $('btn-new-job').onclick = () => jobModal(state.selected || {});
  $('workspace').querySelectorAll('[data-run]').forEach((btn) => {
    btn.onclick = async (event) => {
      event.stopPropagation();
      btn.disabled = true;
      btn.textContent = 'Running...';
      try {
        await API.jobs.run(btn.dataset.run);
        toast('Backup finished');
        await renderBackups();
      } catch (err) {
        toast(err.message);
        await renderBackups();
      }
    };
  });
  $('workspace').querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.onclick = async (event) => {
      event.stopPropagation();
      await API.jobs.toggle(btn.dataset.toggle);
      await renderBackups();
    };
  });
  $('workspace').querySelectorAll('[data-deljob]').forEach((btn) => {
    btn.onclick = async (event) => {
      event.stopPropagation();
      if (!confirm('Delete this backup job? Files already written are kept.')) return;
      await API.jobs.remove(btn.dataset.deljob);
      await renderBackups();
    };
  });
  $('workspace').querySelectorAll('[data-rec]').forEach((row) => {
    row.onclick = () => openRecord(row.dataset.rec);
  });
}

async function openRecord(id) {
  const rec = state.records.find((r) => r.id === id);
  if (!rec) return;
  setCrumbs(`Backup / ${rec.fileName}`);
  $('workspace').innerHTML = `
    <div class="card stack">
      <h1>${escapeHtml(rec.jobName || 'Backup')}</h1>
      <div>${rec.exists ? '<span class="badge ok">file found</span>' : '<span class="badge warn">file missing</span>'}
        ${rec.encrypted ? '<span class="badge muted">encrypted</span>' : ''}</div>
      <div><strong>Database</strong> ${escapeHtml(rec.database)}</div>
      <div><strong>Collections</strong> ${(rec.collections || []).map((c) => escapeHtml(c.name)).join(', ') || '—'}</div>
      <div><strong>Documents</strong> ${escapeHtml(rec.documentCount)}</div>
      <div><strong>Location</strong> <code>${escapeHtml(rec.filePath)}</code></div>
      <div><strong>Device</strong> ${escapeHtml(rec.device)}</div>
      <div class="row">
        <button class="btn btn-green" style="width:auto" id="open-loc">Open in explorer</button>
        ${rec.encrypted && rec.exists ? `<button class="btn" id="decrypt-open">Decrypt and open</button>` : ''}
        <button class="btn btn-danger" id="del-rec">Delete record</button>
      </div>
      ${rec.error ? `<div class="badge fail">${escapeHtml(rec.error)}</div>` : ''}
    </div>
  `;
  $('open-loc').onclick = async () => {
    const result = await API.records.open(id);
    if (!result.exists) toast(`File is missing. Location: ${result.path}`);
  };
  const decrypt = $('decrypt-open');
  if (decrypt) {
    decrypt.onclick = async () => {
      try {
        await API.records.decryptOpen(id);
      } catch (err) {
        toast(err.message);
      }
    };
  }
  $('del-rec').onclick = async () => {
    if (!confirm('Remove this record from this device? The file is not deleted unless it is already gone.')) return;
    await API.records.remove(id);
    await renderBackups();
  };
}

async function renderRotate(preset = {}) {
  state.view = 'rotate';
  document.querySelectorAll('.linkish').forEach((el) => el.classList.toggle('active', el.dataset.view === 'rotate'));
  const connId = preset.connectionId || state.selected?.connectionId || state.connections[0]?.id;
  const db = preset.db || state.selected?.db || '';
  const col = preset.col || state.selected?.col || 'users';
  setCrumbs('Password rotate');
  setActions('');
  $('workspace').innerHTML = `
    <div class="grid-2">
      <div class="card stack">
        <h1>Rotate passwords</h1>
        <div class="hint">This is the only module that writes to MongoDB. Backups never modify collections.</div>
        <div><label>Connection</label>
          <select id="rot-conn">${state.connections.map((c) => `<option value="${c.id}" ${c.id === connId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select>
        </div>
        <div><label>Database</label><input id="rot-db" value="${escapeHtml(db)}"></div>
        <div><label>Users collection</label><input id="rot-col" value="${escapeHtml(col)}"></div>
        <div class="grid-2">
          <div><label>Name field</label><input id="f-name" value="name"></div>
          <div><label>Email field</label><input id="f-email" value="email"></div>
          <div><label>Username field</label><input id="f-user" value="email"></div>
          <div><label>Password field</label><input id="f-pass" value="password"></div>
        </div>
        <div>
          <label>Password mode</label>
          <select id="rot-mode">
            <option value="random">Random generate</option>
            <option value="pattern">Pattern</option>
          </select>
        </div>
        <div>
          <label>Pattern</label>
          <input id="rot-pattern" value="{name}2312@">
          <div class="hint">Tokens: {name} {Name} {first} {email} {emailLocal} {user} {yyyy} {mm} {dd} {rand:8} {digits:4}</div>
        </div>
        <label class="row"><input type="checkbox" id="rot-all" style="width:auto"> Rotate all users in this collection</label>
        <label class="row"><input type="checkbox" id="rot-notify" style="width:auto"> Notify users by email (off by default)</label>
        <div>
          <label>Custom message</label>
          <textarea id="rot-msg">Hi {{name}},

Your password for {{database}} has been rotated.

Username: {{username}}
Email: {{email}}
New password: {{password}}</textarea>
        </div>
        <div class="row">
          <button class="btn" id="load-users">Load users</button>
          <button class="btn" id="preview-rot">Preview</button>
          <button class="btn btn-green" style="width:auto" id="run-rot">Rotate selected</button>
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <h3>Users</h3>
          <div id="user-list" class="check-list"><div class="empty">Load users to select them</div></div>
        </div>
        <div class="card">
          <h3>Preview</h3>
          <div id="rot-preview" class="preview-box">Nothing yet</div>
        </div>
      </div>
    </div>
  `;

  const payload = () => ({
    connectionId: $('rot-conn').value,
    database: $('rot-db').value,
    collection: $('rot-col').value,
    mapping: {
      nameField: $('f-name').value,
      emailField: $('f-email').value,
      usernameField: $('f-user').value,
      passwordField: $('f-pass').value,
    },
    mode: $('rot-mode').value,
    pattern: $('rot-pattern').value,
    all: $('rot-all').checked,
    ids: [...document.querySelectorAll('#user-list input:checked')].map((el) => el.value),
    notifyUsers: $('rot-notify').checked,
    customMessage: $('rot-msg').value,
  });

  $('load-users').onclick = async () => {
    const p = payload();
    const data = await API.connections.users(p.connectionId, p.database, p.collection, '?limit=200');
    $('user-list').innerHTML = data.documents
      .map((u) => {
        const id = u._id?.$oid || u._id;
        const label = u.email || u.name || id;
        return `<label><input type="checkbox" value="${escapeHtml(id)}"> ${escapeHtml(label)}</label>`;
      })
      .join('') || `<div class="empty">No users found</div>`;
  };
  $('preview-rot').onclick = async () => {
    const preview = await API.rotate.preview(payload());
    $('rot-preview').textContent = JSON.stringify(preview, null, 2);
  };
  $('run-rot').onclick = async () => {
    const p = payload();
    if (!p.all && !p.ids.length) return toast('Select users or choose rotate all');
    if (!confirm(`This will overwrite ${p.all ? 'ALL' : p.ids.length} password hash(es) in ${p.database}.${p.collection}. Continue?`)) return;
    const result = await API.rotate.execute(p);
    toast(`Updated ${result.updated} users with ${result.algorithm.algorithm} (${result.algorithm.rounds} rounds)`);
  };
}

async function renderSettings() {
  state.view = 'settings';
  document.querySelectorAll('.linkish').forEach((el) => el.classList.toggle('active', el.dataset.view === 'settings'));
  const [settings, autostart] = await Promise.all([API.settings.get(), API.autostart.get()]);
  setCrumbs('Settings');
  setActions('');
  $('workspace').innerHTML = `
    <div class="card stack" style="max-width:640px">
      <h1>Settings</h1>
      <div>Device: <code>${escapeHtml(state.meta.device)}</code></div>
      <div>From email: <code>${escapeHtml(state.meta.fromEmail)}</code></div>
      <div>Password hash: bcrypt, ${settings.hash?.rounds || 10} salt rounds (same as Bahri-MOC-PCR)</div>
      <div>
        <label>Bcrypt rounds</label>
        <input id="rounds" type="number" min="8" max="14" value="${settings.hash?.rounds || 10}">
      </div>
      <div>
        Autostart: ${autostart.enabled ? '<span class="badge ok">enabled</span>' : '<span class="badge warn">off</span>'}
        <div class="hint">${escapeHtml(autostart.kind)} · ${escapeHtml(autostart.name)}${autostart.note ? ` · ${escapeHtml(autostart.note)}` : ''}</div>
      </div>
      <div class="row">
        <button class="btn btn-green" style="width:auto" id="as-on">Enable on boot</button>
        <button class="btn" id="as-off">Disable</button>
      </div>
      <div>
        <label>Send a test email to</label>
        <div class="row">
          <input id="test-to" placeholder="you@company.com">
          <button class="btn" id="send-test">Send</button>
        </div>
      </div>
    </div>
  `;
  $('as-on').onclick = async () => {
    try {
      await API.autostart.enable();
      toast('Autostart enabled');
      await renderSettings();
    } catch (err) {
      toast(err.message);
    }
  };
  $('as-off').onclick = async () => {
    await API.autostart.disable();
    await renderSettings();
  };
  $('send-test').onclick = async () => {
    try {
      await API.testEmail($('test-to').value);
      toast('Test email sent');
    } catch (err) {
      toast(err.message);
    }
  };
  $('rounds').onchange = async () => {
    await API.settings.save({ hash: { algorithm: 'bcrypt', rounds: Number($('rounds').value) } });
    toast('Hash settings saved');
  };
}

async function renderHome() {
  state.view = 'home';
  setCrumbs('Select a connection');
  setActions('');
  $('workspace').innerHTML = `
    <div class="empty">
      <p>Add a MongoDB connection to browse databases like Compass.</p>
      <p>Create a backup job for offline scheduled dumps. Password rotation is a separate write action.</p>
    </div>`;
}

function bindChrome() {
  $('btn-new-connection').onclick = () => editConnection(null);
  document.querySelectorAll('.linkish').forEach((btn) => {
    btn.onclick = () => {
      if (btn.dataset.view === 'backups') renderBackups();
      if (btn.dataset.view === 'rotate') renderRotate();
      if (btn.dataset.view === 'settings') renderSettings();
    };
  });
}

async function boot() {
  bindChrome();
  try {
    state.meta = await API.meta();
    $('device-label').textContent = state.meta.device || 'this device';
  } catch (err) {
    toast(err.message);
  }
  await refreshTree();
  await renderHome();
}

boot();
