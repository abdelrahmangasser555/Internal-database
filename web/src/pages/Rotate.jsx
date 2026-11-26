import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { rememberConnection } from '../lib/paths.js';
import { Check, Copy, Download, KeyRound, ScrollText, Search, ShieldAlert, Users } from 'lucide-react';
import { toast } from 'sonner';
import { API } from '../api.js';
import { useApp } from '../state/AppState.jsx';
import { Badge, Button, Card, CardHeader, Confirm, Empty, Field, Input, PageHeader, Select, Sheet, Switch, Tabs, Textarea } from '../components/ui.jsx';
import { EngineLogo } from '../components/EngineLogo.jsx';
import { docId, formatWhen, relativeTime } from '../lib/format.js';
import { cn } from '../lib/cn.js';

const STEPS = ['Target', 'Mapping', 'Users', 'Preview'];
const PAGE = 200;

export function RotatePage() {
  const { connections: all, openSheet } = useApp();
  const { connectionId: routeConnectionId } = useParams();
  const connections = useMemo(() => all.filter((c) => (c.engine || 'mongodb') === 'mongodb'), [all]);
  const location = useLocation();
  const preset = location.state || {};
  const lockedId = routeConnectionId || preset.connectionId || '';
  const [step, setStep] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [preview, setPreview] = useState(null);
  const [audit, setAudit] = useState([]);
  const [auditQ, setAuditQ] = useState('');
  const [auditFrom, setAuditFrom] = useState('');
  const [auditTo, setAuditTo] = useState('');
  const [dbs, setDbs] = useState([]);
  const [cols, setCols] = useState([]);
  const [fieldNames, setFieldNames] = useState([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadLock = useRef(false);
  const [form, setForm] = useState({
    connectionId: lockedId || connections[0]?.id || '',
    database: preset.db || '',
    collection: preset.col || 'users',
    nameField: 'name',
    emailField: 'email',
    usernameField: 'email',
    passwordField: 'password',
    mode: 'random',
    pattern: '{name}2312@',
    all: false,
    ids: [],
    notifyUsers: false,
    customMessage:
      'Hi {{name}},\n\nYour password for {{database}} has been rotated.\n\nUsername: {{username}}\nEmail: {{email}}\nNew password: {{password}}',
  });

  const auditQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (auditQ.trim()) params.set('q', auditQ.trim());
    if (auditFrom) params.set('from', auditFrom);
    if (auditTo) params.set('to', auditTo);
    if (form.database) params.set('database', form.database);
    if (form.connectionId) params.set('connectionId', form.connectionId);
    params.set('unique', '1');
    return params.toString();
  }, [auditQ, auditFrom, auditTo, form.database, form.connectionId]);

  useEffect(() => {
    const handle = setTimeout(() => {
      API.rotate.audit(auditQuery).then(setAudit).catch(() => {});
    }, 180);
    return () => clearTimeout(handle);
  }, [auditQuery]);

  useEffect(() => {
    if (lockedId) rememberConnection(lockedId);
    if (lockedId && form.connectionId !== lockedId) setForm((prev) => ({ ...prev, connectionId: lockedId }));
    else if (!form.connectionId && connections[0]?.id) setForm((prev) => ({ ...prev, connectionId: connections[0].id }));
  }, [connections, form.connectionId, lockedId]);

  useEffect(() => {
    if (!form.connectionId) return;
    API.connections
      .databases(form.connectionId)
      .then((list) => {
        const names = (Array.isArray(list) ? list : []).map((d) => d.name || d).filter((n) => !['admin', 'config', 'local'].includes(n));
        setDbs(names);
        setForm((p) => {
          if (names.includes(p.database)) return p;
          return { ...p, database: names[0] || '', collection: p.collection || 'users' };
        });
      })
      .catch(() => setDbs([]));
  }, [form.connectionId]);

  useEffect(() => {
    if (!form.connectionId || !form.database) {
      setCols([]);
      return;
    }
    API.connections
      .objects(form.connectionId, form.database)
      .then((list) => {
        const names = (Array.isArray(list) ? list : []).map((o) => o.name).filter(Boolean);
        setCols(names);
        setForm((p) => {
          if (names.includes(p.collection)) return p;
          const guess = names.find((n) => /user/i.test(n)) || names[0] || 'users';
          return { ...p, collection: guess };
        });
      })
      .catch(() => setCols([]));
  }, [form.connectionId, form.database]);

  useEffect(() => {
    if (!form.connectionId || !form.database || !form.collection) {
      setFieldNames([]);
      return;
    }
    let alive = true;
    setFieldsLoading(true);
    API.connections
      .describe(form.connectionId, form.database, form.collection)
      .then((meta) => {
        if (!alive) return;
        const names = (meta.columns || []).map((c) => c.name).filter(Boolean);
        setFieldNames(names);
        setForm((p) => {
          const pick = (current, ...candidates) => {
            if (names.includes(current)) return current;
            for (const c of candidates) if (names.includes(c)) return c;
            return names[0] || current;
          };
          return {
            ...p,
            nameField: pick(p.nameField, 'name', 'fullName', 'displayName', 'firstName'),
            emailField: pick(p.emailField, 'email', 'mail', 'emailAddress'),
            usernameField: pick(p.usernameField, 'email', 'username', 'userName', 'login'),
            passwordField: pick(p.passwordField, 'password', 'passwordHash', 'hash'),
          };
        });
      })
      .catch(() => alive && setFieldNames([]))
      .finally(() => alive && setFieldsLoading(false));
    return () => {
      alive = false;
    };
  }, [form.connectionId, form.database, form.collection]);

  const fieldChoices = useMemo(() => {
    const set = new Set(fieldNames);
    for (const key of ['nameField', 'emailField', 'usernameField', 'passwordField']) {
      if (form[key]) set.add(form[key]);
    }
    return [...set].filter((n) => n !== '_id').sort((a, b) => a.localeCompare(b));
  }, [fieldNames, form.nameField, form.emailField, form.usernameField, form.passwordField]);

  const set = (key) => (e) => {
    const value = e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const payload = () => ({
    connectionId: form.connectionId,
    database: form.database,
    collection: form.collection,
    mapping: {
      nameField: form.nameField,
      emailField: form.emailField,
      usernameField: form.usernameField,
      passwordField: form.passwordField,
    },
    mode: form.mode,
    pattern: form.pattern,
    all: form.all,
    ids: form.ids,
    notifyUsers: form.notifyUsers,
    customMessage: form.customMessage,
  });

  const loadUsers = useCallback(
    async ({ skip = 0, reset = false } = {}) => {
      if (!form.connectionId || !form.database || !form.collection) return;
      if (loadLock.current) return;
      loadLock.current = true;
      if (reset || skip === 0) setBusy(true);
      else setLoadingMore(true);
      try {
        const params = new URLSearchParams({ skip: String(skip), limit: String(PAGE) });
        if (userSearch.trim()) params.set('search', userSearch.trim());
        const data = await API.connections.users(form.connectionId, form.database, form.collection, `?${params}`);
        const docs = data.documents || [];
        setUsers((prev) => (reset || skip === 0 ? docs : [...prev, ...docs]));
        setUsersTotal(Number(data.total) || (reset || skip === 0 ? docs.length : skip + docs.length));
        setUsersLoaded(true);
      } catch (err) {
        toast.error(err.message);
      } finally {
        loadLock.current = false;
        setBusy(false);
        setLoadingMore(false);
      }
    },
    [form.connectionId, form.database, form.collection, userSearch],
  );

  useEffect(() => {
    setUsers([]);
    setUsersTotal(0);
    setUsersLoaded(false);
  }, [form.connectionId, form.database, form.collection]);

  useEffect(() => {
    if (step !== 2 || !usersLoaded) return;
    const handle = setTimeout(() => loadUsers({ skip: 0, reset: true }), 220);
    return () => clearTimeout(handle);
  }, [userSearch]);

  const onUsersScroll = (e) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 96) return;
    if (loadingMore || busy || users.length >= usersTotal) return;
    loadUsers({ skip: users.length });
  };

  const conn = connections.find((c) => c.id === form.connectionId);

  if (!connections.length || (routeConnectionId && (all.find((c) => c.id === routeConnectionId)?.engine || 'mongodb') !== 'mongodb')) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-10">
        <Card>
          <Empty
            icon={KeyRound}
            title="Rotate works on MongoDB connections"
            body="Password rotation writes bcrypt hashes to a users collection. SQL connections stay read-only here."
            action={
              <Button variant="primary" onClick={() => openSheet({ type: 'connection' })}>
                Add MongoDB connection
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[760px] space-y-6 px-5 py-6 md:px-8">
      <PageHeader
        title="Password rotate"
        subtitle="Writes bcrypt hashes to MongoDB. The generated passwords are kept in the audit on this device so you can look one up and copy it."
        actions={
          <Button onClick={() => setAuditOpen(true)}>
            <ScrollText size={14} /> Audit
            {audit.length ? <Badge tone="muted">{audit.length}</Badge> : null}
          </Button>
        }
      />

      <div className="flex items-center gap-2 rounded-lg border border-warn/25 bg-warn/8 px-3.5 py-2.5 text-[12.5px]">
        <ShieldAlert size={15} className="shrink-0 text-warn" />
        Preview first. Rotating overwrites the selected users' password hashes. Every write is logged in Audit for the database you picked.
      </div>

      <ol className="flex flex-wrap items-center gap-2">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep(i)}
              className={cn(
                'focus-ring inline-flex h-8 items-center gap-2 rounded-sm border px-3 text-[12.5px] font-medium transition',
                i === step ? 'border-primary bg-primary/12 text-fg' : i < step ? 'border-line text-fg' : 'border-line text-muted',
              )}
            >
              <span className={cn('grid h-5 w-5 place-items-center rounded-full text-[10.5px]', i < step ? 'bg-ok text-white' : i === step ? 'bg-primary text-primary-fg' : 'bg-surface-3 text-muted')}>
                {i < step ? <Check size={11} /> : i + 1}
              </span>
              {label}
            </button>
            {i < STEPS.length - 1 ? <span className="h-px w-6 bg-line" /> : null}
          </li>
        ))}
      </ol>

      <Card className="space-y-5">
        {step === 0 ? (
          <>
            <CardHeader title="Where are the users?" subtitle="Pick the MongoDB connection, database and users collection." />
            <Field label="Connection">
              <div className="flex items-center gap-2">
                <EngineLogo engine="mongodb" size={16} tile />
                <Select value={form.connectionId} onChange={set('connectionId')} disabled={Boolean(lockedId)}>
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.environment || 'production'}
                    </option>
                  ))}
                </Select>
              </div>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Database">
                <Select
                  value={form.database}
                  onChange={(e) => setForm((p) => ({ ...p, database: e.target.value }))}
                  disabled={!dbs.length && !form.database}
                >
                  {!form.database ? <option value="">Select a database</option> : null}
                  {form.database && !dbs.includes(form.database) ? <option value={form.database}>{form.database}</option> : null}
                  {dbs.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Users collection">
                <Select value={form.collection} onChange={set('collection')} disabled={!form.database}>
                  {form.collection && !cols.includes(form.collection) ? <option value={form.collection}>{form.collection}</option> : null}
                  {cols.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  {!cols.length && !form.collection ? <option value="">Select a collection</option> : null}
                </Select>
              </Field>
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <CardHeader
              title="Field mapping & password"
              subtitle={
                fieldsLoading
                  ? 'Reading fields from the collection…'
                  : fieldChoices.length
                    ? `Map to fields discovered in ${form.collection} (sampled from live documents).`
                    : 'Pick a collection on Target first — fields come from the collection schema sample.'
              }
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name field" hint="Display name for emails and preview">
                <Select value={form.nameField} onChange={set('nameField')} disabled={fieldsLoading || !fieldChoices.length}>
                  {!fieldChoices.length ? <option value="">No fields yet</option> : null}
                  {form.nameField && !fieldChoices.includes(form.nameField) ? <option value={form.nameField}>{form.nameField}</option> : null}
                  {fieldChoices.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Email field">
                <Select value={form.emailField} onChange={set('emailField')} disabled={fieldsLoading || !fieldChoices.length}>
                  {!fieldChoices.length ? <option value="">No fields yet</option> : null}
                  {form.emailField && !fieldChoices.includes(form.emailField) ? <option value={form.emailField}>{form.emailField}</option> : null}
                  {fieldChoices.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Username field" hint="Often the same as email">
                <Select value={form.usernameField} onChange={set('usernameField')} disabled={fieldsLoading || !fieldChoices.length}>
                  {!fieldChoices.length ? <option value="">No fields yet</option> : null}
                  {form.usernameField && !fieldChoices.includes(form.usernameField) ? (
                    <option value={form.usernameField}>{form.usernameField}</option>
                  ) : null}
                  {fieldChoices.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Password field" hint="Where the bcrypt hash is stored">
                <Select value={form.passwordField} onChange={set('passwordField')} disabled={fieldsLoading || !fieldChoices.length}>
                  {!fieldChoices.length ? <option value="">No fields yet</option> : null}
                  {form.passwordField && !fieldChoices.includes(form.passwordField) ? (
                    <option value={form.passwordField}>{form.passwordField}</option>
                  ) : null}
                  {fieldChoices.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Password mode">
              <Tabs
                value={form.mode}
                onChange={set('mode')}
                tabs={[
                  { id: 'random', label: 'Random generate' },
                  { id: 'pattern', label: 'Pattern' },
                ]}
              />
            </Field>
            {form.mode === 'pattern' ? (
              <Field label="Pattern" hint="{name} {Name} {first} {email} {emailLocal} {user} {yyyy} {mm} {dd} {rand:8} {digits:4}">
                <Input value={form.pattern} onChange={set('pattern')} className="font-mono" />
              </Field>
            ) : null}
            <Switch checked={form.notifyUsers} onChange={set('notifyUsers')} label="Notify users by email" hint="Off by default. Sends the message below to each rotated user." />
            {form.notifyUsers ? (
              <Field label="Custom message" hint="{{name}} {{email}} {{username}} {{password}} {{database}}">
                <Textarea value={form.customMessage} onChange={set('customMessage')} />
              </Field>
            ) : null}
          </>
        ) : null}

        {step === 2 ? (
          <>
            <CardHeader
              title="Who to rotate"
              subtitle={form.all ? 'Every user in the collection' : `${form.ids.length} selected · ${users.length.toLocaleString()} of ${usersTotal.toLocaleString()} loaded`}
              icon={Users}
              action={
                <Button size="sm" loading={busy} onClick={() => loadUsers({ skip: 0, reset: true })}>
                  Load users
                </Button>
              }
            />
            <Switch checked={form.all} onChange={set('all')} label="Rotate all users in this collection" />
            {!form.all ? (
              <>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" />
                    <Input value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="Search users" className="h-8 pl-8 text-[12.5px]" />
                  </div>
                  <Button size="sm" variant="ghost" disabled={!users.length} onClick={() => setForm((p) => ({ ...p, ids: [...new Set([...p.ids, ...users.map(docId)])] }))}>
                    Select shown
                  </Button>
                  <Button size="sm" variant="ghost" disabled={!form.ids.length} onClick={() => setForm((p) => ({ ...p, ids: [] }))}>
                    Clear
                  </Button>
                </div>
                <div className="max-h-[360px] overflow-auto rounded-lg border border-line" onScroll={onUsersScroll}>
                  {users.map((u) => {
                    const id = docId(u);
                    const checked = form.ids.includes(id);
                    return (
                      <label key={id} className="flex cursor-pointer items-center gap-3 border-b border-line px-3 py-2 text-[13px] last:border-0 hover:bg-surface-2/60">
                        <input
                          type="checkbox"
                          className="accent-[var(--primary)]"
                          checked={checked}
                          onChange={() => setForm((prev) => ({ ...prev, ids: checked ? prev.ids.filter((x) => x !== id) : [...prev.ids, id] }))}
                        />
                        <span className="min-w-0">
                          <span className="block truncate">{u[form.nameField] || u[form.emailField] || id}</span>
                          <span className="block truncate text-[11.5px] text-subtle">{u[form.emailField] || id}</span>
                        </span>
                      </label>
                    );
                  })}
                  {!users.length ? <p className="p-4 text-[12.5px] text-subtle">Load users to select them. The first 200 load; scroll down for more.</p> : null}
                  {users.length && users.length < usersTotal ? (
                    <div className="px-3 py-2 text-center text-[11.5px] text-subtle">
                      {loadingMore ? 'Loading more…' : `Scroll for more · ${users.length.toLocaleString()} / ${usersTotal.toLocaleString()}`}
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </>
        ) : null}

        {step === 3 ? (
          <>
            <CardHeader title="Preview & rotate" subtitle="Preview generates sample passwords without writing. Rotate overwrites hashes for the selected users." />
            <div className="flex gap-2">
              <Button
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    setPreview(await API.rotate.preview(payload()));
                  } catch (err) {
                    toast.error(err.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Preview
              </Button>
              <Button variant="danger" onClick={() => setConfirmOpen(true)}>
                <KeyRound size={14} /> Rotate selected
              </Button>
            </div>
            {preview ? (
              <div className="space-y-2">
                <Badge tone="info">{preview.count} users in scope</Badge>
                {(preview.samples || []).map((s, i) => (
                  <div key={i} className="rounded-lg border border-line bg-surface-2/50 p-3 text-[12px]">
                    <div className="font-medium">{s.email || s.name || 'user'}</div>
                    <div className="mt-1 font-mono text-primary-strong">{s.password}</div>
                    {s.emailPreview ? <pre className="mt-2 whitespace-pre-wrap font-sans text-muted">{s.emailPreview}</pre> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        <div className="flex justify-between border-t border-line pt-4">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
            Back
          </Button>
          <Button variant="primary" disabled={step === STEPS.length - 1} onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
            Next
          </Button>
        </div>
      </Card>

      <Sheet
        open={auditOpen}
        wide
        title="Rotation audit"
        subtitle={form.database ? `Latest password per user in ${form.database}` : 'Latest password per user on this connection'}
        icon={<ScrollText size={18} className="text-muted" />}
        onClose={() => setAuditOpen(false)}
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-subtle">{audit.length} user{audit.length === 1 ? '' : 's'}</span>
            <Button
              size="sm"
              onClick={() => {
                const a = document.createElement('a');
                a.href = API.rotate.auditFile(auditQuery);
                a.download = '';
                document.body.appendChild(a);
                a.click();
                a.remove();
              }}
            >
              <Download size={13} /> Text file
            </Button>
          </div>
        }
      >
        <div className="grid gap-2">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" />
            <Input value={auditQ} onChange={(e) => setAuditQ(e.target.value)} placeholder="Name, email, username or id" className="h-8 pl-8 text-[12.5px]" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="From">
              <Input type="date" value={auditFrom} onChange={(e) => setAuditFrom(e.target.value)} className="h-8 text-[12.5px]" />
            </Field>
            <Field label="To">
              <Input type="date" value={auditTo} onChange={(e) => setAuditTo(e.target.value)} className="h-8 text-[12.5px]" />
            </Field>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {audit.map((row, i) => (
            <div key={`${row.at}-${row.userId}-${i}`} className="rounded-sm border border-dashed border-line px-3 py-2 text-[12px]">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate font-medium">{row.name || row.email || row.userId}</span>
                <span className="shrink-0 text-subtle" title={formatWhen(row.at)}>
                  {relativeTime(row.at)}
                </span>
              </div>
              <div className="truncate text-subtle">
                {row.email || row.username || row.userId} · {row.connectionName} · {row.database}.{row.collection}
              </div>
              <div className="mt-1.5 grid gap-0.5 font-mono text-[11px]">
                <span className="text-subtle">old {row.previousPassword || 'not recorded'}</span>
                <span className="text-fg">new {row.password || 'not recorded'}</span>
              </div>
              {row.password ? (
                <Button
                  size="xs"
                  variant="ghost"
                  className="mt-1.5"
                  onClick={async () => {
                    await navigator.clipboard.writeText(row.password);
                    toast.success('Copied password');
                  }}
                >
                  <Copy size={12} /> Copy
                </Button>
              ) : null}
            </div>
          ))}
          {!audit.length ? <p className="text-[12.5px] text-subtle">No rotations for this database yet.</p> : null}
        </div>
      </Sheet>

      <Confirm
        open={confirmOpen}
        danger
        title="Overwrite password hashes?"
        body={`This will overwrite ${form.all ? 'ALL' : form.ids.length} password hash(es) in ${form.database}.${form.collection} on ${conn?.name || 'this connection'}. Backups are not involved.`}
        confirmLabel="Rotate now"
        typeToConfirm={form.all ? form.collection : undefined}
        busy={busy}
        onClose={() => setConfirmOpen(false)}
        onConfirm={async () => {
          const p = payload();
          if (!p.all && !p.ids.length) {
            toast.error('Select users or choose rotate all');
            return;
          }
          setBusy(true);
          try {
            const result = await API.rotate.execute(p);
            toast.success(`Updated ${result.updated} users with ${result.algorithm.algorithm} (${result.algorithm.rounds} rounds)`);
            setConfirmOpen(false);
            setAudit(await API.rotate.audit(auditQuery));
            setAuditOpen(true);
          } catch (err) {
            toast.error(err.message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
