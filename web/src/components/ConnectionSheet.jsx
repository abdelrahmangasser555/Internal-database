import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircleCheck, CircleX, Lock, PlugZap, Shield } from 'lucide-react';
import { toast } from 'sonner';
import { API } from '../api.js';
import { useApp } from '../state/AppState.jsx';
import { connectionPath, rememberConnection } from '../lib/paths.js';
import { Badge, Button, Confirm, Field, Input, Sheet, Tabs } from './ui.jsx';
import { EngineLogo } from './EngineLogo.jsx';
import { ENGINES, ENV_TONES, detectEngine, engineOf } from '../lib/engines.js';
import { cn } from '../lib/cn.js';

const SWATCHES = ['#E8E8E8', '#9D9D9D', '#3794FF', '#3FB950', '#D29922', '#F14C4C', '#C084FC', '#F472B6'];

export function ConnectionSheet() {
  const { sheet, closeSheet, refresh, checkHealth } = useApp();
  const navigate = useNavigate();
  const open = sheet?.type === 'connection';
  const existing = open ? sheet.connection : null;

  const [name, setName] = useState('');
  const [uri, setUri] = useState('');
  const [engine, setEngine] = useState('mongodb');
  const [environment, setEnvironment] = useState('production');
  const [color, setColor] = useState(SWATCHES[0]);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [permissions, setPermissions] = useState(null);
  const [permBusy, setPermBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(existing?.name || '');
    setUri('');
    setEngine(existing?.engine || 'mongodb');
    setEnvironment(existing?.environment || 'production');
    setColor(existing?.color || SWATCHES[0]);
    setTest(null);
    setBusy(false);
    setPermissions(null);
    if (existing?.id) {
      setPermBusy(true);
      API.connections
        .permissions(existing.id)
        .then(setPermissions)
        .catch((err) => setPermissions({ error: err.message }))
        .finally(() => setPermBusy(false));
    }
  }, [open, existing?.id]);

  const detected = useMemo(() => detectEngine(uri), [uri]);
  useEffect(() => {
    if (detected) setEngine(detected === 'mysql' && engine === 'mariadb' ? 'mariadb' : detected);
  }, [detected]);

  const info = engineOf(engine);

  const runTest = async () => {
    setTesting(true);
    try {
      const result = await API.connections.test(uri.trim() ? { uri: uri.trim(), engine } : { id: existing?.id });
      setTest({ ok: true, ...result });
      if (result.engine && result.engine !== engine) setEngine(result.engine);
    } catch (err) {
      setTest({ ok: false, error: err.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Sheet
      open={open}
      title={existing ? `Edit ${existing.name}` : 'New connection'}
      subtitle="Stored encrypted on this device. Explore and backups never write to it."
      icon={<EngineLogo engine={engine} size={18} tile />}
      onClose={closeSheet}
      footer={
        <div className="flex items-center justify-between gap-2">
          {existing ? (
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
              Remove
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={closeSheet}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                if (!name.trim()) return toast.error('Give the connection a name');
                if (!existing && !uri.trim()) return toast.error('Paste a connection string');
                setBusy(true);
                try {
                  const body = { name, color, environment, engine, id: existing?.id };
                  if (uri.trim()) body.uri = uri.trim();
                  const saved = await API.connections.save(body);
                  try {
                    const result = await API.connections.test({ id: saved.id });
                    toast.success(`Connected · ${result.label || info.label} ${result.version || ''}`.trim());
                  } catch (err) {
                    toast.warning(`Saved, but the test failed: ${err.message}`);
                  }
                  await refresh();
                  checkHealth();
                  rememberConnection(saved.id);
                  if (!existing) navigate(connectionPath(saved.id));
                  closeSheet();
                } catch (err) {
                  toast.error(err.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save & test
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div>
          <div className="mb-2 text-[12px] font-medium text-muted">Engine</div>
          <div className="grid grid-cols-3 gap-2">
            {Object.values(ENGINES).map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setEngine(e.id)}
                className={cn(
                  'focus-ring flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[12.5px] transition',
                  engine === e.id ? 'border-primary/60 bg-primary/8 text-fg' : 'border-line bg-surface-2/50 text-muted hover:border-line-strong hover:text-fg',
                )}
              >
                <EngineLogo engine={e.id} size={16} />
                {e.label}
              </button>
            ))}
          </div>
        </div>

        <Field label="Name" info="A label on this device only. It is not sent to the database server.">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${info.label} production`} autoFocus />
        </Field>

        <Field
          label="Connection string"
          info="URI is encrypted with this device's master key. Explore, backups and analytics never write through it. Restore, Rotate and Seeds are the only write paths."
          right={<span className="inline-flex items-center gap-1 text-[11px] text-subtle"><Lock size={11} /> AES-256-GCM at rest</span>}
          hint={
            existing
              ? `Saved: ${existing.uriMasked}. Leave blank to keep it.`
              : detected
                ? `Detected ${engineOf(detected).label}.`
                : `Example: ${info.example}`
          }
        >
          <Input
            value={uri}
            onChange={(e) => {
              setUri(e.target.value);
              setTest(null);
            }}
            placeholder={info.example}
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-[12px]"
          />
        </Field>

        <Field label="Environment" info="Cosmetic tag so production connections are harder to mix up with local ones. It does not change server behaviour.">
          <Tabs
            size="sm"
            value={environment}
            onChange={setEnvironment}
            tabs={Object.entries(ENV_TONES).map(([id, v]) => ({ id, label: v.label }))}
          />
        </Field>

        <Field label="Accent">
          <div className="flex items-center gap-2">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => setColor(c)}
                className={cn('h-6 w-6 rounded-full border-2 transition', color.toLowerCase() === c.toLowerCase() ? 'border-fg' : 'border-transparent')}
                style={{ background: c }}
              />
            ))}
          </div>
        </Field>

        {existing ? (
          <div className="rounded-lg border border-line bg-surface-2/50 p-3.5">
            <div className="mb-2 flex items-center gap-2 text-[12.5px] font-medium text-fg">
              <Shield size={14} className="text-primary" />
              User privileges
              <span className="font-normal text-subtle">what this login can do</span>
            </div>
            {permBusy ? <p className="text-[12px] text-subtle">Reading grants…</p> : null}
            {permissions?.error ? <p className="text-[12.5px] text-danger">{permissions.error}</p> : null}
            {permissions && !permissions.error ? (
              <div className="space-y-2">
                <p className="font-mono text-[12px] text-muted">{permissions.user || 'unknown user'}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone={permissions.canRead ? 'ok' : 'muted'}>read {permissions.canRead ? 'yes' : 'no'}</Badge>
                  <Badge tone={permissions.canWrite ? 'warn' : 'muted'}>write {permissions.canWrite ? 'yes' : 'no'}</Badge>
                  <Badge tone={permissions.canCreate ? 'info' : 'muted'}>create {permissions.canCreate ? 'yes' : 'no'}</Badge>
                  <Badge tone={permissions.canDrop ? 'fail' : 'muted'}>drop {permissions.canDrop ? 'yes' : 'no'}</Badge>
                  {permissions.canAdmin ? <Badge tone="warn">admin</Badge> : null}
                </div>
                {permissions.roles?.length ? <p className="text-[12px] text-muted">Roles: {permissions.roles.join(', ')}</p> : null}
                {permissions.notes?.length ? <p className="text-[12px] text-subtle">{permissions.notes.join(' ')}</p> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-lg border border-line bg-surface-2/50 p-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[12.5px] text-muted">Check that this device can reach the server.</div>
            <Button size="sm" loading={testing} onClick={runTest} disabled={!uri.trim() && !existing}>
              <PlugZap size={14} /> Test
            </Button>
          </div>
          {test ? (
            <div className={cn('mt-3 flex items-start gap-2 rounded-md px-3 py-2 text-[12.5px]', test.ok ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger')}>
              {test.ok ? <CircleCheck size={15} className="mt-0.5" /> : <CircleX size={15} className="mt-0.5" />}
              <div>
                {test.ok ? (
                  <>
                    Reachable · {test.label || info.label} {test.version}
                    {test.latencyMs != null ? <span className="text-ok/70"> · {test.latencyMs} ms</span> : null}
                    {test.database ? <span className="text-ok/70"> · {test.database}</span> : null}
                  </>
                ) : (
                  test.error
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <Confirm
        open={confirmDelete}
        danger
        title={`Remove ${existing?.name}?`}
        body="This removes the saved connection from this device. Backup files and history stay where they are. The database itself is not touched."
        confirmLabel="Remove connection"
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          try {
            await API.connections.remove(existing.id);
            toast.success('Connection removed');
            setConfirmDelete(false);
            await refresh();
            closeSheet();
          } catch (err) {
            toast.error(err.message);
          }
        }}
      />
    </Sheet>
  );
}
