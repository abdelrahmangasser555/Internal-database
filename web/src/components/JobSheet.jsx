import { useEffect, useMemo, useState } from 'react';
import { FolderOpen, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { API } from '../api.js';
import { useApp } from '../state/AppState.jsx';
import { Button, Field, Input, Select, Sheet, Switch, Tabs } from './ui.jsx';
import { EngineLogo } from './EngineLogo.jsx';
import { engineOf, shortName } from '../lib/engines.js';
import { cn } from '../lib/cn.js';
import { compact } from '../lib/format.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function Section({ title, children }) {
  return (
    <section className="space-y-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">{title}</h4>
      {children}
    </section>
  );
}

export function JobSheet() {
  const { sheet, closeSheet, refresh, connections } = useApp();
  const open = sheet?.type === 'job';
  const preset = open ? sheet.job || {} : {};

  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [dbs, setDbs] = useState([]);
  const [objects, setObjects] = useState([]);
  const [loadingObjects, setLoadingObjects] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      name: preset.name || 'Nightly backup',
      connectionId: preset.connectionId || connections[0]?.id || '',
      database: preset.database || '',
      scope: preset.collections?.length && !preset.allCollections ? 'some' : 'all',
      collections: preset.collections || [],
      targetPath: preset.targetPath || '',
      intervalType: preset.interval?.type || 'daily',
      every: preset.interval?.every || 6,
      unit: preset.interval?.unit || 'hours',
      time: preset.interval?.time || '02:00',
      weekday: preset.interval?.weekday ?? 0,
      notifyEmails: (preset.notifyEmails || []).join(', '),
      encrypt: Boolean(preset.encrypt),
      passphrase: '',
      keepLast: preset.retention?.keepLast ?? 0,
      maxAgeDays: preset.retention?.maxAgeDays ?? 0,
      verifyAfter: preset.verifyAfter !== false,
    });
    setBusy(false);
  }, [open, preset.id]);

  const conn = connections.find((c) => c.id === form.connectionId);
  const info = engineOf(conn?.engine);

  useEffect(() => {
    if (!open || !form.connectionId) return;
    setDbs([]);
    API.connections
      .databases(form.connectionId)
      .then((list) => {
        setDbs(list);
        setForm((f) => (f.database ? f : { ...f, database: (list.find((d) => d.primary) || list[0])?.name || '' }));
      })
      .catch(() => setDbs([]));
  }, [open, form.connectionId]);

  useEffect(() => {
    if (!open || !form.connectionId || !form.database) return;
    setLoadingObjects(true);
    API.connections
      .objects(form.connectionId, form.database)
      .then((list) => setObjects(list.filter((o) => o.type !== 'view')))
      .catch(() => setObjects([]))
      .finally(() => setLoadingObjects(false));
  }, [open, form.connectionId, form.database]);

  const set = (key) => (e) => {
    const value = e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const totalRows = useMemo(() => {
    const chosen = form.scope === 'all' ? objects : objects.filter((o) => form.collections?.includes(o.name));
    return chosen.reduce((s, o) => s + (o.rows || 0), 0);
  }, [objects, form.scope, form.collections]);

  const save = async () => {
    const collections = form.scope === 'all' ? [] : form.collections;
    if (form.scope === 'some' && !collections.length) return toast.error(`Pick at least one ${info.object}`);
    if (!form.targetPath) return toast.error('Choose a folder for the backup files');
    const interval =
      form.intervalType === 'every'
        ? { type: 'every', every: Number(form.every || 1), unit: form.unit || 'hours' }
        : form.intervalType === 'weekly'
          ? { type: 'weekly', weekday: Number(form.weekday || 0), time: form.time || '02:00' }
          : { type: 'daily', time: form.time || '02:00' };
    if (form.encrypt && !form.passphrase && !preset.hasPassphrase) {
      return toast.error('Set an encryption passphrase so this backup can be opened later.');
    }
    setBusy(true);
    try {
      const body = {
        id: preset.id,
        name: form.name,
        connectionId: form.connectionId,
        database: form.database,
        collections,
        allCollections: collections.length === 0,
        targetPath: form.targetPath,
        interval,
        notifyEmails: String(form.notifyEmails || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        encrypt: form.encrypt,
        retention: { keepLast: Number(form.keepLast) || 0, maxAgeDays: Number(form.maxAgeDays) || 0 },
        verifyAfter: form.verifyAfter,
      };
      if (form.passphrase) body.passphrase = form.passphrase;
      await API.jobs.save(body);
      toast.success('Backup job saved');
      await refresh();
      closeSheet();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      wide
      title={preset.id ? `Edit ${preset.name}` : 'New backup job'}
      subtitle="Read-only snapshot → compressed archive → optional encryption → checksum → retention."
      icon={conn ? <EngineLogo engine={conn.engine} size={18} tile /> : null}
      onClose={closeSheet}
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-subtle">
            {objects.length ? `≈ ${compact(totalRows)} ${info.family === 'sql' ? 'rows' : 'documents'} per run` : ''}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={closeSheet}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={save}>
              Save job
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-7">
        <Section title="Source">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Job name">
              <Input value={form.name || ''} onChange={set('name')} />
            </Field>
            <Field label="Connection">
              <Select value={form.connectionId || ''} onChange={(e) => setForm((f) => ({ ...f, connectionId: e.target.value, database: '', collections: [] }))}>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {engineOf(c.engine).label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Database">
              {dbs.length ? (
                <Select value={form.database || ''} onChange={(e) => setForm((f) => ({ ...f, database: e.target.value, collections: [] }))}>
                  {dbs.map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input value={form.database || ''} onChange={set('database')} placeholder="app_production" />
              )}
            </Field>
            <Field label="Scope">
              <Tabs
                size="sm"
                value={form.scope}
                onChange={set('scope')}
                tabs={[
                  { id: 'all', label: `Whole database` },
                  { id: 'some', label: `Pick ${info.objects}` },
                ]}
              />
            </Field>
          </div>
          {form.scope === 'some' ? (
            <div className="max-h-56 overflow-auto rounded-lg border border-line">
              {loadingObjects ? <p className="p-3 text-[12px] text-subtle">Loading {info.objects}…</p> : null}
              {objects.map((o) => {
                const checked = form.collections?.includes(o.name);
                return (
                  <label key={o.name} className="flex cursor-pointer items-center gap-3 border-b border-line px-3 py-2 text-[13px] last:border-0 hover:bg-surface-2/60">
                    <input
                      type="checkbox"
                      className="accent-[var(--primary)]"
                      checked={Boolean(checked)}
                      onChange={() =>
                        setForm((f) => ({
                          ...f,
                          collections: checked ? f.collections.filter((x) => x !== o.name) : [...(f.collections || []), o.name],
                        }))
                      }
                    />
                    <span className="truncate">{shortName(o.name, conn?.engine)}</span>
                    <span className="num ml-auto text-[12px] text-subtle">{compact(o.rows)}</span>
                  </label>
                );
              })}
              {!loadingObjects && !objects.length ? <p className="p-3 text-[12px] text-subtle">No {info.objects} found.</p> : null}
            </div>
          ) : null}
        </Section>

        <Section title="Destination">
          <Field label="Backup folder" hint="Files are written as .zip (or .zip.enc) with a .sha256 checksum next to them.">
            <div className="flex gap-2">
              <Input value={form.targetPath || ''} onChange={set('targetPath')} placeholder="C:\Backups\databases" className="font-mono text-[12px]" />
              <Button
                onClick={async () => {
                  try {
                    const { path } = await API.folder();
                    if (path) setForm((prev) => ({ ...prev, targetPath: path }));
                  } catch (err) {
                    toast.error(err.message);
                  }
                }}
              >
                <FolderOpen size={14} /> Browse
              </Button>
            </div>
          </Field>
          <Switch checked={Boolean(form.encrypt)} onChange={set('encrypt')} label="Encrypt archives (AES-256-GCM)" hint="Keep the passphrase somewhere safe. Without it the file cannot be opened." />
          {form.encrypt ? (
            <Field label="Encryption passphrase" hint={preset.hasPassphrase ? 'Leave blank to keep the current passphrase.' : 'Required while encryption is on.'}>
              <Input type="password" value={form.passphrase || ''} onChange={set('passphrase')} autoComplete="new-password" />
            </Field>
          ) : null}
        </Section>

        <Section title="Schedule">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Cadence">
              <Tabs
                size="sm"
                value={form.intervalType || 'daily'}
                onChange={set('intervalType')}
                tabs={[
                  { id: 'every', label: 'Interval' },
                  { id: 'daily', label: 'Daily' },
                  { id: 'weekly', label: 'Weekly' },
                ]}
              />
            </Field>
            {form.intervalType === 'every' ? (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Every">
                  <Input type="number" min="1" value={form.every || 1} onChange={set('every')} />
                </Field>
                <Field label="Unit">
                  <Select value={form.unit || 'hours'} onChange={set('unit')}>
                    <option value="minutes">minutes</option>
                    <option value="hours">hours</option>
                    <option value="days">days</option>
                  </Select>
                </Field>
              </div>
            ) : (
              <div className={cn('grid gap-2', form.intervalType === 'weekly' ? 'grid-cols-2' : 'grid-cols-1')}>
                {form.intervalType === 'weekly' ? (
                  <Field label="Day">
                    <Select value={String(form.weekday ?? 0)} onChange={set('weekday')}>
                      {DAYS.map((d, i) => (
                        <option key={d} value={i}>
                          {d}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
                <Field label="Time (this device)">
                  <Input type="time" value={form.time || '02:00'} onChange={set('time')} />
                </Field>
              </div>
            )}
          </div>
        </Section>

        <Section title="Retention & checks">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Keep the last" hint="0 keeps every file. Older files from this job are deleted; history rows stay.">
              <div className="flex items-center gap-2">
                <Input type="number" min="0" value={form.keepLast} onChange={set('keepLast')} className="w-24" />
                <span className="text-[12px] text-muted">backups</span>
              </div>
            </Field>
            <Field label="Delete files older than" hint="0 turns age-based cleanup off.">
              <div className="flex items-center gap-2">
                <Input type="number" min="0" value={form.maxAgeDays} onChange={set('maxAgeDays')} className="w-24" />
                <span className="text-[12px] text-muted">days</span>
              </div>
            </Field>
          </div>
          <Switch
            checked={Boolean(form.verifyAfter)}
            onChange={set('verifyAfter')}
            label={
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-ok" /> Verify every backup after it is written
              </span>
            }
            hint="Re-reads the archive, checks SHA-256 and per-file checksums, and recounts records."
          />
          <Field label="Notify emails" hint="Comma separated. Sent through AWS SES after each run.">
            <Input value={form.notifyEmails || ''} onChange={set('notifyEmails')} placeholder="ops@company.com" />
          </Field>
        </Section>
      </div>
    </Sheet>
  );
}
