import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { API } from '../api.js';
import { useApp } from '../state/AppState.jsx';
import { Button, Field, Input, Sheet } from './ui.jsx';

export function ConnectionSheet() {
  const { sheet, closeSheet, refresh } = useApp();
  const open = sheet?.type === 'connection';
  const existing = open ? sheet.connection : null;

  const [name, setName] = useState('');
  const [uri, setUri] = useState('');
  const [color, setColor] = useState('#00ed64');
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState(null);

  useEffect(() => {
    if (!open) return;
    setName(existing?.name || '');
    setUri('');
    setColor(existing?.color || '#00ed64');
    setTest(null);
    setBusy(false);
  }, [open, existing?.id, existing?.name, existing?.color]);

  return (
    <Sheet
      open={open}
      title={existing ? 'Edit connection' : 'New connection'}
      subtitle="URI is encrypted on this device. Browse stays read-only."
      onClose={closeSheet}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={closeSheet}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              if (!name.trim()) return toast.error('Name is required');
              if (!existing && !uri.trim()) return toast.error('Connection string is required');
              setBusy(true);
              try {
                const body = { name, color, id: existing?.id };
                if (uri.trim()) body.uri = uri.trim();
                const saved = await API.connections.save(body);
                const result = await API.connections.test({ id: saved.id });
                toast.success(result.version ? `Connected · MongoDB ${result.version}` : 'Connected');
                await refresh();
                closeSheet();
              } catch (err) {
                toast.error(err.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Saving…' : 'Save & test'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Production Atlas" autoFocus />
        </Field>
        <Field
          label="Connection string"
          hint={
            existing
              ? `Saved: ${existing.uriMasked}. Leave blank to keep it.`
              : 'mongodb+srv://user:pass@host — stored encrypted locally.'
          }
        >
          <Input
            value={uri}
            onChange={(e) => setUri(e.target.value)}
            placeholder="mongodb+srv://user:pass@cluster/db"
            autoComplete="off"
          />
        </Field>
        <Field label="Accent">
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-14 cursor-pointer rounded-lg border border-line bg-transparent"
            />
            <span className="font-mono text-xs text-mist">{color}</span>
          </div>
        </Field>
        <Button
          onClick={async () => {
            try {
              const result = await API.connections.test(uri.trim() ? { uri } : { id: existing?.id });
              setTest(result);
              toast.success(result.version ? `Ping ok · ${result.version}` : 'Ping ok');
            } catch (err) {
              setTest(null);
              toast.error(err.message);
            }
          }}
        >
          Test without saving
        </Button>
        {test?.ok ? (
          <p className="rounded-xl border border-leaf/30 bg-leaf/10 px-3 py-2 text-sm text-leaf">
            Reachable{test.version ? ` · MongoDB ${test.version}` : ''}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
