import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Check, CheckCircle2, Copy, FlaskConical, Plus, Shield, Sprout, Trash2, Upload, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { API } from '../api.js';
import { useApp } from '../state/AppState.jsx';
import { Badge, Button, Card, Confirm, Empty, Field, InfoTip, Input, PageHeader, Select, Switch, Tabs, Textarea } from '../components/ui.jsx';
import { EngineLogo } from '../components/EngineLogo.jsx';
import { engineOf } from '../lib/engines.js';
import { cn } from '../lib/cn.js';
import { rememberConnection, seedsPath } from '../lib/paths.js';

export function SeedsPage() {
  const { seedId, connectionId: routeConnectionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const target = location.state || (routeConnectionId ? { connectionId: routeConnectionId } : null);
  const { connections } = useApp();
  const [tab, setTab] = useState('library');
  const [seeds, setSeeds] = useState([]);
  const [skills, setSkills] = useState([]);
  const [selected, setSelected] = useState(null);
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (id) => {
    const list = await API.seeds.list();
    setSeeds(list);
    const pick = id || seedId || list[0]?.id;
    if (pick) {
      const full = await API.seeds.get(pick);
      setSelected(full);
      navigate(routeConnectionId ? seedsPath(routeConnectionId, full.id) : `/seeds/${full.id}`, { replace: true });
    } else setSelected(null);
  };

  useEffect(() => {
    load(seedId).catch((err) => toast.error(err.message));
    API.seeds.skills().then(setSkills).catch(() => {});
  }, []);

  useEffect(() => {
    if (seedId && selected?.id !== seedId) {
      API.seeds
        .get(seedId)
        .then(setSelected)
        .catch(() => {});
    }
  }, [seedId]);

  const importJson = async (raw) => {
    setBusy(true);
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const checked = await API.seeds.validate(parsed);
      if (!checked.ok) {
        const first = (checked.issues || []).find((i) => i.level === 'error');
        throw new Error(first?.message || 'Seed JSON is not valid');
      }
      const saved = await API.seeds.save({ payload: parsed, name: parsed.name, description: parsed.description });
      toast.success(`Imported ${saved.name}`);
      setPaste('');
      await load(saved.id);
      setTab('library');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1200px] space-y-5 px-5 py-6 md:px-8">
      <PageHeader
        title="Import seeds"
        subtitle="Store a portable fixture, simulate it against any connection, then insert — optionally wiping the listed objects first."
        actions={
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'library', label: 'Library', count: seeds.length },
              { id: 'skills', label: 'Export skills' },
            ]}
          />
        }
      />

      {tab === 'skills' ? <SkillsPanel skills={skills} /> : null}

      {tab === 'library' ? (
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <div className="space-y-3">
            <Card padded={false} className="overflow-hidden">
              {seeds.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    navigate(routeConnectionId ? seedsPath(routeConnectionId, s.id) : `/seeds/${s.id}`);
                    API.seeds.get(s.id).then(setSelected).catch((err) => toast.error(err.message));
                  }}
                  className={cn(
                    'flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-surface-2/70',
                    selected?.id === s.id && 'bg-primary/8',
                  )}
                >
                  <EngineLogo engine={s.engine === 'any' ? 'mongodb' : s.engine} size={16} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{s.name}</span>
                    <span className="block text-[11.5px] text-subtle">
                      {s.objectCount} objects · {s.recordCount} rows
                    </span>
                  </span>
                </button>
              ))}
              {!seeds.length ? <p className="px-4 py-8 text-center text-[12px] text-subtle">No seeds yet.</p> : null}
            </Card>
            <Button className="w-full" onClick={() => setTab('import')}>
              <Upload size={14} /> Import JSON
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={async () => {
                try {
                  await importJson(await API.seeds.example());
                } catch (err) {
                  toast.error(err.message);
                }
              }}
            >
              <Plus size={14} /> Load example seed
            </Button>
          </div>
          {selected ? (
            <SeedDetail
              seed={selected}
              connections={connections}
              target={target}
              onUpdated={(row) => setSelected(row)}
              onDeleted={async () => {
                await load();
              }}
            />
          ) : (
            <Empty icon={Sprout} title="Import a seed" body="Paste JSON from the export skill, or load the example to see users → observations." />
          )}
        </div>
      ) : null}

      {tab === 'import' ? (
        <Card>
          <Field
            label="Seed JSON"
            info="Must be format backup-service-seed-v1. Copy an export skill, run it in your project, then paste the JSON here."
          >
            <Textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={16} placeholder='{ "format": "backup-service-seed-v1", ... }' />
          </Field>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" loading={busy} onClick={() => importJson(paste)}>
              Validate & save
            </Button>
            <Button variant="ghost" onClick={() => setTab('library')}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function SkillsPanel({ skills }) {
  const [copied, setCopied] = useState(null);
  const copy = async (skill) => {
    await navigator.clipboard.writeText(skill.prompt);
    setCopied(skill.id);
    toast.success(`Copied ${skill.title}`);
    setTimeout(() => setCopied(null), 1500);
  };
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {skills.map((skill) => (
        <Card key={skill.id}>
          <div className="flex items-start gap-3">
            <EngineLogo engine={skill.engine === 'any' ? 'mongodb' : skill.engine} size={18} tile />
            <div className="min-w-0 flex-1">
              <h3 className="text-[14px] font-semibold">{skill.title}</h3>
              <p className="mt-1 text-[12.5px] leading-5 text-muted">{skill.subtitle}</p>
            </div>
            <Button size="sm" onClick={() => copy(skill)}>
              {copied === skill.id ? <Check size={14} /> : <Copy size={14} />} Copy
            </Button>
          </div>
          <pre className="mt-3 max-h-40 overflow-auto rounded-md border border-line bg-bg-2 p-3 font-mono text-[11px] leading-4 text-muted">
            {skill.prompt.slice(0, 700)}
            {skill.prompt.length > 700 ? '…' : ''}
          </pre>
        </Card>
      ))}
    </div>
  );
}

function SeedDetail({ seed, connections, target, onDeleted, onUpdated }) {
  const [connectionId, setConnectionId] = useState(target?.connectionId || connections[0]?.id || '');
  const [database, setDatabase] = useState(target?.database || '');
  const [dbs, setDbs] = useState([]);
  const [wipe, setWipe] = useState(false);
  const [createMissing, setCreateMissing] = useState(true);
  const [sim, setSim] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!connectionId && connections[0]?.id) setConnectionId(connections[0].id);
  }, [connections, connectionId]);

  const conn = connections.find((c) => c.id === connectionId);
  const info = engineOf(conn?.engine);

  useEffect(() => {
    if (target?.connectionId) setConnectionId(target.connectionId);
    if (target?.database) setDatabase(target.database);
  }, [target?.connectionId, target?.database]);

  useEffect(() => {
    if (!connectionId) return;
    let cancelled = false;
    API.connections
      .databases(connectionId)
      .then((list) => {
        if (cancelled) return;
        setDbs(list);
        setDatabase((d) => d || (list.find((x) => x.primary) || list[0])?.name || (conn?.engine === 'sqlite' ? 'main' : ''));
      })
      .catch(() => {
        if (!cancelled) setDbs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  const compatible = useMemo(() => {
    if (!seed.engine || seed.engine === 'any' || !conn) return true;
    const fam = (e) => (e === 'mariadb' ? 'mysql' : e);
    return fam(seed.engine) === fam(conn.engine);
  }, [seed.engine, conn]);

  const runSim = async () => {
    if (!connectionId || !database) return toast.error('Pick a connection and database');
    setBusy(true);
    try {
      setSim(await API.seeds.simulate({ seedId: seed.id, connectionId, database, wipe, createMissing }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-semibold">{seed.name}</h2>
            <p className="mt-1 max-w-2xl text-[13px] text-muted">{seed.description || 'No description.'}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone="primary">{seed.engine === 'any' ? 'any engine' : engineOf(seed.engine).label}</Badge>
              <Badge>{seed.objectCount} objects</Badge>
              <Badge>{seed.recordCount} records</Badge>
            </div>
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={async () => {
              await API.seeds.remove(seed.id);
              toast.success('Seed removed');
              onDeleted();
            }}
          >
            <Trash2 size={14} /> Remove
          </Button>
        </div>
        <div className="mt-4 space-y-2">
          {(seed.objects || []).map((o) => (
            <div key={o.name} className="rounded-md border border-line bg-surface-2/40 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[13px] font-medium">{o.name}</span>
                <Badge>{o.records} rows</Badge>
                {o.rules?.allowOrphan ? <Badge tone="warn">orphans allowed</Badge> : <Badge tone="ok">no orphans</Badge>}
              </div>
              {o.refs?.length ? (
                <ul className="mt-1.5 space-y-1 text-[12.5px] text-muted">
                  {o.refs.map((r) => (
                    <li key={`${r.field}-${r.target}`}>
                      <span className="font-mono text-fg">{r.field}</span> → {r.target}.{r.targetField}{' '}
                      <span className={r.required ? 'text-danger' : 'text-subtle'}>{r.required ? 'required' : 'optional'}</span>
                      {r.note ? ` · ${r.note}` : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-[12px] text-subtle">Root object. No parent required.</p>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex items-center gap-2 text-[14px] font-semibold">
          Apply to a connection
          <InfoTip text="Simulation is read-only. Apply is a write: it can create missing tables/collections, optionally delete existing rows in listed objects, then insert seed records in parent-first order." />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Connection">
            <Select
              value={connectionId}
              disabled={Boolean(target?.connectionId)}
              onChange={(e) => {
                setConnectionId(e.target.value);
                setDatabase('');
                setSim(null);
              }}
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {engineOf(c.engine).label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Database">
            {dbs.length ? (
              <Select value={database} onChange={(e) => setDatabase(e.target.value)}>
                {dbs.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Input value={database} onChange={(e) => setDatabase(e.target.value)} className="font-mono" />
            )}
          </Field>
        </div>
        {!compatible ? (
          <p className="mt-3 text-[12.5px] text-danger">This seed is for {engineOf(seed.engine).label}. Pick a matching connection or re-export with engine "any".</p>
        ) : null}
        <div className="mt-3 space-y-2">
          <Switch
            checked={wipe}
            onChange={setWipe}
            label="Remove old data in listed objects"
            hint="Deletes every row in the seed's tables/collections on the target, then inserts. Other objects are left alone."
          />
          <Switch
            checked={createMissing}
            onChange={setCreateMissing}
            label="Create missing tables/collections"
            hint="If an object in the seed is not on the target, create it from the declared columns."
          />
        </div>
        {(seed.bindings || []).length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {seed.bindings.map((binding) => {
              const name = connections.find((c) => c.id === binding.connectionId)?.name || 'connection';
              return (
                <button
                  key={`${binding.connectionId}-${binding.database}`}
                  type="button"
                  className="border border-dashed border-line-strong px-2 py-1 text-left text-[11.5px] hover:border-fg"
                  onClick={() => {
                    setConnectionId(binding.connectionId);
                    setDatabase(binding.database);
                    setSim(null);
                  }}
                >
                  <span className="block text-subtle">{name}</span>
                  <span className="font-mono">{binding.database}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button loading={busy && !confirmOpen} onClick={runSim} disabled={!connectionId || !database || !compatible}>
            <FlaskConical size={14} /> Run simulation
          </Button>
          <Button variant="primary" disabled={!sim?.canApply} onClick={() => setConfirmOpen(true)}>
            Seed {info.objects || 'data'}
          </Button>
          <Button
            disabled={!connectionId || !database}
            onClick={async () => {
              try {
                const bindings = [...(seed.bindings || [])];
                if (!bindings.some((b) => b.connectionId === connectionId && b.database === database)) {
                  bindings.push({ connectionId, database });
                }
                const saved = await API.seeds.save({
                  id: seed.id,
                  name: seed.name,
                  description: seed.description,
                  notes: seed.notes,
                  payload: seed.payload,
                  bindings,
                });
                onUpdated?.(saved);
                toast.success('Pinned on the pipeline. Open Flow and click the seed node to come back.');
              } catch (err) {
                toast.error(err.message);
              }
            }}
          >
            Pin to this database
          </Button>
        </div>

        {sim ? <SimReport sim={sim} /> : null}
      </Card>

      <Confirm
        open={confirmOpen}
        danger={wipe}
        title={wipe ? `Wipe and seed ${database}?` : `Seed ${database}?`}
        body={
          wipe
            ? `This deletes existing rows in ${sim?.objects?.filter((o) => o.willWipe).length || 0} objects, then inserts ${sim?.totals?.insert || 0} records.`
            : `This inserts ${sim?.totals?.insert || 0} records into ${database} on ${conn?.name}.`
        }
        typeToConfirm={database}
        confirmLabel={wipe ? 'Wipe and seed' : 'Insert seed'}
        busy={busy}
        onClose={() => setConfirmOpen(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            const result = await API.seeds.apply({ seedId: seed.id, connectionId, database, wipe, createMissing, confirm: database });
            toast.success(`Inserted ${result.inserted} records`);
            setConfirmOpen(false);
            await runSim();
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

function objectTone(o, issues) {
  if (o.action === 'blocked' || issues.some((i) => i.level === 'error')) return 'fail';
  if (o.willCreate || issues.some((i) => i.level === 'warn')) return 'warn';
  return 'ok';
}

function SimReport({ sim }) {
  const errors = sim.issues.filter((i) => i.level === 'error');
  const warns = sim.issues.filter((i) => i.level === 'warn');
  const okCount = sim.objects.filter((o) => objectTone(o, sim.issues.filter((i) => i.object === o.name)) === 'ok').length;
  const failCount = sim.objects.filter((o) => objectTone(o, sim.issues.filter((i) => i.object === o.name)) === 'fail').length;
  const warnCount = sim.objects.length - okCount - failCount;
  const maxLive = Math.max(1, ...sim.objects.map((o) => o.liveRows || 0), ...sim.objects.map((o) => o.seedRecords || 0));

  return (
    <div className="mt-5 space-y-4">
      <div className="grid gap-2 sm:grid-cols-4">
        <SimStat
          icon={sim.canApply ? CheckCircle2 : XCircle}
          tone={sim.canApply ? 'ok' : 'fail'}
          label={sim.canApply ? 'Ready to apply' : 'Blocked'}
          value={sim.canApply ? 'Pass' : `${errors.length} error${errors.length === 1 ? '' : 's'}`}
        />
        <SimStat icon={Sprout} tone="muted" label="Will insert" value={sim.totals?.insert || 0} />
        <SimStat icon={Trash2} tone={sim.wipe ? 'warn' : 'muted'} label="Will wipe" value={sim.wipe ? sim.totals?.wipe || 0 : 0} />
        <SimStat icon={Shield} tone="muted" label="Privileges" value={sim.permissions?.user || 'unknown'} hint={`read ${sim.permissions?.canRead ? 'yes' : 'no'} · write ${sim.permissions?.canWrite ? 'yes' : 'no'} · create ${sim.permissions?.canCreate ? 'yes' : 'no'}`} />
      </div>

      <div className="flex flex-wrap gap-2 text-[11.5px]">
        <Badge tone="ok" dot>
          {okCount} ready
        </Badge>
        {warnCount ? (
          <Badge tone="warn" dot>
            {warnCount} warnings
          </Badge>
        ) : null}
        {failCount ? (
          <Badge tone="fail" dot>
            {failCount} blocked
          </Badge>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-md border border-line">
        {sim.objects.map((o) => {
          const issues = sim.issues.filter((i) => i.object === o.name);
          const tone = objectTone(o, issues);
          const Icon = tone === 'fail' ? XCircle : tone === 'warn' ? AlertTriangle : CheckCircle2;
          const toneClass = tone === 'fail' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-ok';
          return (
            <div key={o.name} className="border-b border-line px-3 py-3 last:border-0">
              <div className="flex items-start gap-3">
                <Icon size={16} className={cn('mt-0.5 shrink-0', toneClass)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[13px] font-medium">{o.name}</span>
                    <Badge tone={tone === 'fail' ? 'fail' : tone === 'warn' ? 'warn' : 'ok'}>{o.action}</Badge>
                    {o.willCreate ? <Badge tone="warn">will create</Badge> : null}
                    {o.willWipe ? <Badge tone="warn">will wipe</Badge> : null}
                    {o.missingColumns?.length ? <Badge tone="fail">{o.missingColumns.length} missing columns</Badge> : null}
                  </div>
                  <div className="mt-2 grid gap-1.5">
                    <BarRow label="On target" value={o.exists ? o.liveRows : 0} max={maxLive} empty={!o.exists} emptyLabel="missing" />
                    <BarRow label="In seed" value={o.seedRecords || 0} max={maxLive} />
                  </div>
                  {issues.length ? (
                    <ul className="mt-2 space-y-1">
                      {issues.map((i, idx) => (
                        <li key={idx} className={cn('text-[12px]', i.level === 'error' ? 'text-danger' : 'text-warn')}>
                          {i.message}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-[12px] text-subtle">Checks passed. {o.seedRecords || 0} records will insert{o.willWipe ? ' after wipe' : ''}.</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {!sim.objects.length ? <p className="px-3 py-4 text-[12.5px] text-subtle">No objects in this seed.</p> : null}
      </div>

      {sim.issues.filter((i) => !i.object).length ? (
        <ul className="space-y-1 text-[12.5px]">
          {sim.issues
            .filter((i) => !i.object)
            .map((i, idx) => (
              <li key={idx} className={i.level === 'error' ? 'text-danger' : 'text-warn'}>
                {i.message}
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}

function SimStat({ icon: Icon, tone, label, value, hint }) {
  return (
    <div className="rounded-md border border-dashed border-line px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 text-[11.5px] text-muted">
        {label}
        <Icon size={14} className={tone === 'ok' ? 'text-ok' : tone === 'fail' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-subtle'} />
      </div>
      <div className="mt-1 truncate text-[15px] font-semibold tracking-[-0.02em]">{value}</div>
      {hint ? <div className="mt-0.5 truncate text-[11px] text-subtle">{hint}</div> : null}
    </div>
  );
}

function BarRow({ label, value, max, empty, emptyLabel }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-[11.5px]">
      <span className="text-subtle">{label}</span>
      <div className="h-1.5 overflow-hidden rounded-sm bg-surface-2">
        <div className={cn('h-full', empty ? 'bg-danger/70' : 'bg-primary')} style={{ width: empty ? '100%' : `${Math.max(4, (Number(value) / max) * 100)}%`, opacity: empty ? 0.35 : 1 }} />
      </div>
      <span className="num text-muted">{empty ? emptyLabel : Number(value).toLocaleString()}</span>
    </div>
  );
}
