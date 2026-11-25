import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { API } from '../api.js';
import { useApp } from '../state/AppState.jsx';
import { Badge, Button, Card, Confirm, Field, Input, Select, Textarea } from '../components/ui.jsx';
import { docId, formatWhen } from '../lib/format.js';

const STEPS = ['Target', 'Mapping', 'Users', 'Preview'];

export function RotatePage() {
  const { connections } = useApp();
  const location = useLocation();
  const preset = location.state || {};
  const [step, setStep] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [preview, setPreview] = useState(null);
  const [audit, setAudit] = useState([]);
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
    if (!form.connectionId && connections[0]?.id) {
      setForm((prev) => ({ ...prev, connectionId: connections[0].id }));
    }
  }, [connections, form.connectionId]);

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
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

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Password rotate</h1>
        <p className="text-sm text-mist">
          This is the only module that writes to MongoDB. Backups never modify collections. Hashes use bcrypt (Bahri-MOC-PCR).
        </p>
      </div>

      <div className="flex gap-2">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => setStep(i)}
            className={`rounded-full px-3 py-1 text-xs ${i === step ? 'bg-leaf text-ink' : 'bg-white/5 text-mist'}`}
          >
            {i + 1}. {label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="space-y-4">
          {step === 0 ? (
            <>
              <Field label="Connection">
                <Select value={form.connectionId} onChange={set('connectionId')}>
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Database">
                <Input value={form.database} onChange={set('database')} />
              </Field>
              <Field label="Users collection">
                <Input value={form.collection} onChange={set('collection')} />
              </Field>
            </>
          ) : null}
          {step === 1 ? (
            <div className="grid gap-3 sm:grid-cols-2">
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
              <Field label="Password mode">
                <Select value={form.mode} onChange={set('mode')}>
                  <option value="random">Random generate</option>
                  <option value="pattern">Pattern</option>
                </Select>
              </Field>
              <Field
                label="Pattern"
                hint="{name} {Name} {first} {email} {emailLocal} {user} {yyyy} {mm} {dd} {rand:8} {digits:4}"
              >
                <Input value={form.pattern} onChange={set('pattern')} />
              </Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={form.notifyUsers} onChange={set('notifyUsers')} />
                Notify users by email (off by default)
              </label>
              <div className="sm:col-span-2">
                <Field label="Custom message">
                  <Textarea value={form.customMessage} onChange={set('customMessage')} />
                </Field>
              </div>
            </div>
          ) : null}
          {step === 2 ? (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.all} onChange={set('all')} />
                Rotate all users in this collection
              </label>
              <Button
                onClick={async () => {
                  try {
                    const data = await API.connections.users(
                      form.connectionId,
                      form.database,
                      form.collection,
                      '?limit=200',
                    );
                    setUsers(data.documents || []);
                    toast.success(`${data.documents?.length || 0} users loaded`);
                  } catch (err) {
                    toast.error(err.message);
                  }
                }}
              >
                Load users
              </Button>
              <div className="max-h-80 overflow-auto rounded-xl border border-line">
                {users.map((u) => {
                  const id = docId(u);
                  const checked = form.ids.includes(id);
                  return (
                    <label key={id} className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setForm((prev) => ({
                            ...prev,
                            ids: checked ? prev.ids.filter((x) => x !== id) : [...prev.ids, id],
                          }))
                        }
                      />
                      {u.email || u.name || id}
                    </label>
                  );
                })}
                {!users.length ? <p className="p-4 text-sm text-mist">Load users to select them.</p> : null}
              </div>
            </>
          ) : null}
          {step === 3 ? (
            <>
              <p className="text-sm text-mist">
                Preview generates sample passwords without writing. Execute overwrites hashes for the selected users.
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={async () => {
                    try {
                      setPreview(await API.rotate.preview(payload()));
                    } catch (err) {
                      toast.error(err.message);
                    }
                  }}
                >
                  Preview
                </Button>
                <Button variant="primary" onClick={() => setConfirmOpen(true)}>
                  Rotate selected
                </Button>
              </div>
              {preview ? (
                <div className="space-y-2">
                  <Badge tone="sky">{preview.count} users in scope</Badge>
                  {(preview.samples || []).map((s, i) => (
                    <div key={i} className="rounded-xl border border-line bg-ink-2 p-3 text-xs">
                      <div className="font-medium">{s.email || s.name || 'user'}</div>
                      <div className="mt-1 font-mono text-leaf">{s.password}</div>
                      <pre className="mt-2 whitespace-pre-wrap text-mist">{s.emailPreview}</pre>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
          <div className="flex justify-between pt-2">
            <Button disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
              Back
            </Button>
            <Button disabled={step === STEPS.length - 1} onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
              Next
            </Button>
          </div>
        </Card>
        <Card>
          <h2 className="font-display text-lg font-semibold">Audit</h2>
          <p className="mb-3 text-xs text-mist">Recent hash writes on this device.</p>
          <div className="max-h-[520px] space-y-2 overflow-auto">
            {audit.slice(0, 40).map((row, i) => (
              <div key={i} className="rounded-xl border border-line px-3 py-2 text-xs">
                <div className="flex justify-between gap-2">
                  <span>{row.email || row.userId}</span>
                  <span className="text-mist">{formatWhen(row.at)}</span>
                </div>
                <div className="text-mist">
                  {row.connectionName} · {row.database}.{row.collection}
                </div>
              </div>
            ))}
            {!audit.length ? <p className="text-sm text-mist">No rotations yet.</p> : null}
          </div>
        </Card>
      </div>

      <Confirm
        open={confirmOpen}
        danger
        title="Overwrite password hashes?"
        body={`This will overwrite ${form.all ? 'ALL' : form.ids.length} password hash(es) in ${form.database}.${form.collection}. Backups are not involved.`}
        confirmLabel="Rotate now"
        onClose={() => setConfirmOpen(false)}
        onConfirm={async () => {
          const p = payload();
          if (!p.all && !p.ids.length) {
            toast.error('Select users or choose rotate all');
            return;
          }
          try {
            const result = await API.rotate.execute(p);
            toast.success(`Updated ${result.updated} users with ${result.algorithm.algorithm} (${result.algorithm.rounds} rounds)`);
            setConfirmOpen(false);
            setAudit(await API.rotate.audit());
          } catch (err) {
            toast.error(err.message);
          }
        }}
      />
    </div>
  );
}
