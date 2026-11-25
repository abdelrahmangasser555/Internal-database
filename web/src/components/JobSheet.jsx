import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { API } from '../api.js';
import { useApp } from '../state/AppState.jsx';
import { Button, Field, Input, Select, Sheet } from './ui.jsx';

export function JobSheet() {
  const { sheet, closeSheet, refresh, connections } = useApp();
  const open = sheet?.type === 'job';
  const preset = open ? sheet.job || {} : {};

  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      name: preset.name || 'Nightly backup',
      connectionId: preset.connectionId || connections[0]?.id || '',
      database: preset.database || '',
      collections: (preset.collections || []).join(', '),
      targetPath: preset.targetPath || '',
      intervalType: preset.interval?.type || 'daily',
      every: preset.interval?.every || 6,
      unit: preset.interval?.unit || 'hours',
      time: preset.interval?.time || '02:00',
      weekday: preset.interval?.weekday ?? 0,
      notifyEmails: (preset.notifyEmails || []).join(', '),
      encrypt: Boolean(preset.encrypt),
      passphrase: '',
    });
    setBusy(false);
  }, [open, preset.id, preset.name, connections]);

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <Sheet
      open={open}
      wide
      title={preset.id ? 'Edit backup job' : 'New backup job'}
      subtitle="Read-only dumps. Encryption is optional AES-256-GCM with a passphrase you keep."
      onClose={closeSheet}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={closeSheet}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              const collections = String(form.collections || '')
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
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
            }}
          >
            {busy ? 'Saving…' : 'Save job'}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name">
          <Input value={form.name || ''} onChange={set('name')} />
        </Field>
        <Field label="Connection">
          <Select value={form.connectionId || ''} onChange={set('connectionId')}>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Database">
          <Input value={form.database || ''} onChange={set('database')} placeholder="app_production" />
        </Field>
        <Field label="Collections" hint="Blank = entire database">
          <Input value={form.collections || ''} onChange={set('collections')} placeholder="users, orders" />
        </Field>
        <div className="md:col-span-2">
          <Field label="Backup folder">
            <div className="flex gap-2">
              <Input value={form.targetPath || ''} onChange={set('targetPath')} placeholder="C:\\Backups\\mongo" />
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
                Browse
              </Button>
            </div>
          </Field>
        </div>
        <Field label="Cadence">
          <Select value={form.intervalType || 'daily'} onChange={set('intervalType')}>
            <option value="every">Every</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </Select>
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
          <Field label={form.intervalType === 'weekly' ? 'Weekday + time' : 'Time'}>
            <div className="flex gap-2">
              {form.intervalType === 'weekly' ? (
                <Select value={String(form.weekday ?? 0)} onChange={set('weekday')}>
                  {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </Select>
              ) : null}
              <Input type="time" value={form.time || '02:00'} onChange={set('time')} />
            </div>
          </Field>
        )}
        <div className="md:col-span-2">
          <Field label="Notify emails" hint="Comma separated. SES must be able to send to these addresses.">
            <Input value={form.notifyEmails || ''} onChange={set('notifyEmails')} placeholder="ops@company.com" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input type="checkbox" checked={Boolean(form.encrypt)} onChange={set('encrypt')} />
          Encrypt backups (AES-256-GCM)
        </label>
        <div className="md:col-span-2">
          <Field
            label="Encryption passphrase"
            hint={preset.hasPassphrase ? 'Leave blank to keep the current passphrase.' : 'Required if encryption is on.'}
          >
            <Input type="password" value={form.passphrase || ''} onChange={set('passphrase')} />
          </Field>
        </div>
      </div>
    </Sheet>
  );
}
