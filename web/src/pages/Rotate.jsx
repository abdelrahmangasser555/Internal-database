import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Check, KeyRound, Search, ShieldAlert, Users } from 'lucide-react';
import { toast } from 'sonner';
import { API } from '../api.js';
import { useApp } from '../state/AppState.jsx';
import { Badge, Button, Card, CardHeader, Confirm, Empty, Field, Input, PageHeader, Select, Switch, Tabs, Textarea } from '../components/ui.jsx';
import { EngineLogo } from '../components/EngineLogo.jsx';
import { docId, formatWhen, relativeTime } from '../lib/format.js';
import { cn } from '../lib/cn.js';

const STEPS = ['Target', 'Mapping', 'Users', 'Preview'];

export function RotatePage() {
  const { connections: all, openSheet } = useApp();
  const connections = useMemo(() => all.filter((c) => (c.engine || 'mongodb') === 'mongodb'), [all]);
  const location = useLocation();
  const preset = location.state || {};
  const [step, setStep] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [preview, setPreview] = useState(null);
  const [audit, setAudit] = useState([]);
  const [dbs, setDbs] = useState([]);
  const [cols, setCols] = useState([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    connectionId: preset.connectionId || connections[0]?.id || '',
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

  useEffect(() => {
    API.rotate.audit().then(setAudit).catch(() => {});
  }, []);

  useEffect(() => {
    if (!form.connectionId && connections[0]?.id) setForm((prev) => ({ ...prev, connectionId: connections[0].id }));
  }, [connections, form.connectionId]);

  useEffect(() => {
    if (!form.connectionId) return;
    API.connections
      .databases(form.connectionId)
      .then((list) => {
        const names = list.map((d) => d.name).filter((n) => !['admin', 'config', 'local'].includes(n));
        setDbs(names);
        setForm((p) => (p.database ? p : { ...p, database: names[0] || '' }));
      })
      .catch(() => setDbs([]));
  }, [form.connectionId]);

  useEffect(() => {
    if (!form.connectionId || !form.database) return;
    API.connections
      .objects(form.connectionId, form.database)
      .then((list) => setCols(list.map((o) => o.name)))
      .catch(() => setCols([]));
  }, [form.connectionId, form.database]);

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

  const term = userSearch.trim().toLowerCase();
  const shownUsers = users.filter((u) => !term || [u[form.emailField], u[form.nameField], docId(u)].some((v) => String(v || '').toLowerCase().includes(term)));
  const conn = connections.find((c) => c.id === form.connectionId);

  if (!connections.length) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-10">
        <Card>
          <Empty
            icon={KeyRound}
            title="Rotate works on MongoDB connections"
            body="Add a MongoDB connection with a user that can write to the users collection. SQL connections are read-only here."
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
    <div className="mx-auto max-w-[1200px] space-y-6 px-5 py-6 md:px-8">
      <PageHeader
        title="Password rotate"
        subtitle="The one module that writes password hashes to MongoDB. Backups never modify collections. Hashes use bcrypt (Bahri-MOC-PCR)."
      />

      <div className="flex items-center gap-2 rounded-lg border border-warn/25 bg-warn/8 px-3.5 py-2.5 text-[12.5px]">
        <ShieldAlert size={15} className="shrink-0 text-warn" />
        Preview first. Rotating overwrites the selected users' password hashes and every write is logged in the audit on the right.
      </div>

      <ol className="flex flex-wrap items-center gap-2">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep(i)}
              className={cn(
                'focus-ring inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[12.5px] font-medium transition',
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

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <Card className="space-y-5">
          {step === 0 ? (
            <>
              <CardHeader title="Where are the users?" subtitle="Pick the MongoDB connection, database and users collection." />
              <Field label="Connection">
                <div className="flex items-center gap-2">
                  <EngineLogo engine="mongodb" size={16} tile />
                  <Select value={form.connectionId} onChange={set('connectionId')}>
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
                  <Input list="rotate-dbs" value={form.database} onChange={set('database')} />
                  <datalist id="rotate-dbs">
                    {dbs.map((d) => (
                      <option key={d} value={d} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Users collection">
                  <Input list="rotate-cols" value={form.collection} onChange={set('collection')} />
                  <datalist id="rotate-cols">
                    {cols.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </Field>
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <CardHeader title="Field mapping & password" subtitle="Tell the rotator which fields hold what, and how to build new passwords." />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name field">
                  <Input value={form.nameField} onChange={set('nameField')} />
                </Field>
                <Field label="Email field">
                  <Input value={form.emailField} onChange={set('emailField')} />
                </Field>
                <Field label="Username field">
                  <Input value={form.usernameField} onChange={set('usernameField')} />
                </Field>
                <Field label="Password field">
                  <Input value={form.passwordField} onChange={set('passwordField')} />
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
                subtitle={form.all ? 'Every user in the collection' : `${form.ids.length} selected`}
                icon={Users}
                action={
                  <Button
                    size="sm"
                    loading={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const data = await API.connections.users(form.connectionId, form.database, form.collection, '?limit=200');
                        setUsers(data.documents || []);
                        toast.success(`${data.documents?.length || 0} users loaded`);
                      } catch (err) {
                        toast.error(err.message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
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
                    <Button size="sm" variant="ghost" disabled={!shownUsers.length} onClick={() => setForm((p) => ({ ...p, ids: [...new Set([...p.ids, ...shownUsers.map(docId)])] }))}>
                      Select shown
                    </Button>
                    <Button size="sm" variant="ghost" disabled={!form.ids.length} onClick={() => setForm((p) => ({ ...p, ids: [] }))}>
                      Clear
                    </Button>
                  </div>
                  <div className="max-h-80 overflow-auto rounded-lg border border-line">
                    {shownUsers.map((u) => {
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
                    {!users.length ? <p className="p-4 text-[12.5px] text-subtle">Load users to select them.</p> : null}
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

        <Card>
          <CardHeader title="Audit" subtitle="Recent hash writes on this device" />
          <div className="mt-3 max-h-[520px] space-y-2 overflow-auto">
            {audit.slice(0, 40).map((row, i) => (
              <div key={i} className="rounded-md border border-line px-3 py-2 text-[12px]">
                <div className="flex justify-between gap-2">
                  <span className="truncate font-medium">{row.email || row.userId}</span>
                  <span className="shrink-0 text-subtle" title={formatWhen(row.at)}>
                    {relativeTime(row.at)}
                  </span>
                </div>
                <div className="truncate text-subtle">
                  {row.connectionName} · {row.database}.{row.collection}
                </div>
              </div>
            ))}
            {!audit.length ? <p className="text-[12.5px] text-subtle">No rotations yet.</p> : null}
          </div>
        </Card>
      </div>

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
            setAudit(await API.rotate.audit());
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
