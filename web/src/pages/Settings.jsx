import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Bot, Check, Info, Mail, Palette, Power, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { API } from '../api.js';
import { useApp } from '../state/AppState.jsx';
import { useTheme } from '../state/Theme.jsx';
import { Badge, Button, Card, CardHeader, Field, Input, KeyValue, PageHeader, Switch } from '../components/ui.jsx';
import { THEME_CHOICES } from '../lib/themes.js';
import { cn } from '../lib/cn.js';
import { formatWhen } from '../lib/format.js';

function sqliteReady(v) {
  const [a, b] = String(v).split('.').map(Number);
  return a > 22 || (a === 22 && b >= 13);
}

const MODELS = [
  ['deepseek/deepseek-v4.1-flash', 'DeepSeek V4.1 Flash · default, cheapest'],
  ['deepseek/deepseek-chat-v3.1', 'DeepSeek V3.1'],
  ['google/gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite'],
  ['openai/gpt-4.1-mini', 'GPT-4.1 mini'],
];

export function SettingsPage() {
  const { meta, refresh } = useApp();
  const { pref, setPref } = useTheme();
  const location = useLocation();
  const [settings, setSettings] = useState(null);
  const [autostart, setAutostart] = useState(null);
  const [to, setTo] = useState('');
  const [rounds, setRounds] = useState(10);
  const [aiKey, setAiKey] = useState('');
  const [model, setModel] = useState('');
  const [testing, setTesting] = useState(false);

  const load = async () => {
    const [s, a] = await Promise.all([API.settings.get(), API.autostart.get()]);
    setSettings(s);
    setAutostart(a);
    setRounds(s.hash?.rounds || 10);
    setModel(s.ai?.model || MODELS[0][0]);
  };

  useEffect(() => {
    load().catch((err) => toast.error(err.message));
  }, []);

  useEffect(() => {
    if (location.hash && settings) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
  }, [location.hash, settings]);

  const save = async (patch, msg = 'Saved') => {
    try {
      setSettings(await API.settings.save(patch));
      toast.success(msg);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const ai = settings?.ai || {};

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-5 py-6 md:px-8">
      <PageHeader title="Settings" subtitle="Device-local options. Secrets stay in .env and the encrypted data folder on this machine." />

      <Card>
        <CardHeader title="Appearance" icon={Palette} subtitle="Each brand has its own type, radius, stroke and buttons — not just colour. Saved on this device." />
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {THEME_CHOICES.map((item) => {
            const active = item.id === pref;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setPref(item.id)}
                className={cn(
                  'border border-theme p-2.5 text-left',
                  active ? 'border-fg bg-surface-2' : 'border-line-strong hover:border-fg',
                )}
              >
                <span className="flex h-8 overflow-hidden border border-theme border-line-strong">
                  <span className="flex-1" style={{ background: item.swatch.bg }} />
                  <span className="flex-1" style={{ background: item.swatch.surface }} />
                  <span className="w-2" style={{ background: item.swatch.fg }} />
                </span>
                <span className="mt-2 flex items-center gap-1.5 text-[12.5px] font-medium">
                  {item.label}
                  {active ? <Check size={12} /> : null}
                </span>
                <span className="block text-[11px] text-subtle">{item.note}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card id="assistant">
        <CardHeader
          title="Assistant"
          icon={Bot}
          subtitle="Optional. Drafts read-only queries and explains schemas through OpenRouter."
          action={ai.hasKey ? <Badge tone="ok" dot>{ai.keySource === 'env' ? 'key from .env' : 'key saved'}</Badge> : <Badge>off</Badge>}
        />
        <div className="mt-4 space-y-4">
          {ai.keySource === 'env' ? (
            <p className="rounded-md border border-line bg-surface-2/60 px-3 py-2 text-[12.5px] text-muted">
              Using <code className="font-mono">OPENROUTER_API_KEY</code> from .env. Remove it there to manage the key here instead.
            </p>
          ) : (
            <Field
              label="OpenRouter API key"
              hint="Stored encrypted with this device's master key and never sent back to the browser."
              info="Used for the assistant, schema tours, and Analytics dashboards. Row data is not sent; only table/column names and your prompt."
            >
              <div className="flex gap-2">
                <Input type="password" value={aiKey} onChange={(e) => setAiKey(e.target.value)} placeholder={ai.hasKey ? '•••••••• saved' : 'sk-or-…'} autoComplete="off" />
                <Button
                  variant="primary"
                  disabled={!aiKey.trim()}
                  onClick={async () => {
                    await save({ aiKey }, 'Key saved');
                    setAiKey('');
                  }}
                >
                  Save
                </Button>
                {ai.hasKey ? (
                  <Button variant="ghost" className="text-danger" onClick={() => save({ aiKey: '' }, 'Key removed')}>
                    Remove
                  </Button>
                ) : null}
              </div>
            </Field>
          )}
          <Field label="Model" hint="Any OpenRouter model id works. Flash models cost a fraction of a cent per question.">
            <div className="flex gap-2">
              <Input list="ai-models" value={model} onChange={(e) => setModel(e.target.value)} className="font-mono text-[12.5px]" />
              <datalist id="ai-models">
                {MODELS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </datalist>
              <Button disabled={!model.trim() || model === ai.model} onClick={() => save({ ai: { model: model.trim() } }, 'Model saved')}>
                Save
              </Button>
              <Button
                variant="ghost"
                loading={testing}
                disabled={!ai.hasKey}
                onClick={async () => {
                  setTesting(true);
                  try {
                    const r = await API.ai.test();
                    toast.success(`${r.model} replied in ${r.latencyMs} ms`);
                  } catch (err) {
                    toast.error(err.message);
                  } finally {
                    setTesting(false);
                  }
                }}
              >
                Test
              </Button>
            </div>
          </Field>
          <p className="flex items-start gap-2 text-[12px] text-subtle">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-ok" />
            Only table, column and type names are sent. Row data never leaves this device, and drafted queries pass the same read-only check as anything you type.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Password rotation" icon={ShieldCheck} subtitle="Hashing used by the Rotate module (MongoDB only)." />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label="Bcrypt rounds"
            hint="Same as Bahri-MOC-PCR by default (10)."
            info="Higher is slower and harder to brute-force. Rotate writes password hashes only — it never stores the new password."
          >
            <Input
              type="number"
              min="8"
              max="14"
              value={rounds}
              onChange={(e) => setRounds(Number(e.target.value))}
              onBlur={() => save({ hash: { algorithm: 'bcrypt', rounds } }, 'Hash settings saved')}
            />
          </Field>
          <KeyValue items={[['Algorithm', `bcrypt · ${rounds} rounds`]]} />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Start on boot"
          icon={Power}
          subtitle={autostart ? `${autostart.kind} · ${autostart.name}${autostart.note ? ` · ${autostart.note}` : ''}` : 'Checking…'}
          action={autostart?.enabled ? <Badge tone="ok" dot>enabled</Badge> : <Badge tone="warn">off</Badge>}
        />
        <div className="mt-4">
          <Switch
            checked={Boolean(autostart?.enabled)}
            label="Run the backup service when this device starts"
            hint="Schedules only run while the service is running."
            onChange={async (on) => {
              try {
                if (on) await API.autostart.enable();
                else await API.autostart.disable();
                toast.success(on ? 'Autostart enabled' : 'Autostart disabled');
                await load();
                await refresh();
              } catch (err) {
                toast.error(err.message);
              }
            }}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Email" icon={Mail} subtitle={`Backup and rotation notices are sent from ${meta.fromEmail || 'the address in .env'} through Amazon SES.`} />
        <Field className="mt-4" label="Send a test email to">
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
      </Card>

      <Card>
        <CardHeader title="About" icon={Info} />
        <KeyValue
          className="mt-2"
          items={[
            ['Device', meta.device],
            ['Platform', meta.platform],
            ['Node.js', meta.node ? `${meta.node}${sqliteReady(meta.node) ? '' : ' · SQLite connections need 22.13 or newer'}` : '—'],
            ['Engines', (meta.engines || []).map((e) => e.label).join(', ')],
            ['Settings saved', settings?.updatedAt ? formatWhen(settings.updatedAt) : '—'],
          ]}
        />
      </Card>
    </div>
  );
}
