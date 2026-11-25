import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { API } from '../api.js';
import { useApp } from '../state/AppState.jsx';
import { Badge, Button, Card, Field, Input } from '../components/ui.jsx';

export function SettingsPage() {
  const { meta, refresh } = useApp();
  const [settings, setSettings] = useState(null);
  const [autostart, setAutostart] = useState(null);
  const [to, setTo] = useState('');
  const [rounds, setRounds] = useState(10);

  const load = async () => {
    const [s, a] = await Promise.all([API.settings.get(), API.autostart.get()]);
    setSettings(s);
    setAutostart(a);
    setRounds(s.hash?.rounds || 10);
  };

  useEffect(() => {
    load().catch((err) => toast.error(err.message));
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-mist">Device-local options. Secrets stay in `.env` and `data/`.</p>
      </div>
      <Card className="space-y-4">
        <Row k="Device" v={meta.device} />
        <Row k="From email" v={meta.fromEmail} />
        <Row k="Password hash" v={`bcrypt, ${rounds} salt rounds (same as Bahri-MOC-PCR)`} />
        <Field label="Bcrypt rounds">
          <Input
            type="number"
            min="8"
            max="14"
            value={rounds}
            onChange={async (e) => {
              const value = Number(e.target.value);
              setRounds(value);
              try {
                await API.settings.save({ hash: { algorithm: 'bcrypt', rounds: value } });
                toast.success('Hash settings saved');
              } catch (err) {
                toast.error(err.message);
              }
            }}
          />
        </Field>
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm">
            Autostart{' '}
            {autostart?.enabled ? <Badge tone="ok">enabled</Badge> : <Badge tone="warn">off</Badge>}
          </div>
          <p className="text-xs text-mist">
            {autostart?.kind} · {autostart?.name}
            {autostart?.note ? ` · ${autostart.note}` : ''}
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  await API.autostart.enable();
                  toast.success('Autostart enabled');
                  await load();
                  await refresh();
                } catch (err) {
                  toast.error(err.message);
                }
              }}
            >
              Enable on boot
            </Button>
            <Button
              onClick={async () => {
                await API.autostart.disable();
                await load();
                await refresh();
              }}
            >
              Disable
            </Button>
          </div>
        </div>
        <Field label="Send a test email to">
          <div className="flex gap-2">
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@company.com" />
            <Button
              onClick={async () => {
                try {
                  await API.testEmail(to);
                  toast.success('Test email sent');
                } catch (err) {
                  toast.error(err.message);
                }
              }}
            >
              Send
            </Button>
          </div>
        </Field>
        {settings?.updatedAt ? <p className="text-xs text-mist">Last saved {settings.updatedAt}</p> : null}
      </Card>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.14em] text-mist">{k}</div>
      <code className="mt-1 block text-sm text-leaf">{v || '—'}</code>
    </div>
  );
}
