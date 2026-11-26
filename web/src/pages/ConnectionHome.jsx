import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Activity, CalendarClock, CircleAlert, Cpu, FolderArchive, Globe, HardDrive, KeyRound, Layers, Plus, RefreshCw, Server, ShieldCheck, Sparkles, Table2 } from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { API } from '../api.js';
import { bytes, compact, relativeTime, verificationTone } from '../lib/format.js';
import { engineOf } from '../lib/engines.js';
import { backupsPath, explorePath, rememberConnection, rotatePath } from '../lib/paths.js';
import { Badge, Button, Card, CardHeader, CopyUri, Empty, PageHeader, Select, Skeleton, StatusDot } from '../components/ui.jsx';
import { EngineLogo } from '../components/EngineLogo.jsx';
import { cn } from '../lib/cn.js';
import { useConnectionActivity } from './Connections.jsx';

const DAY = 86_400_000;

export function ConnectionHomePage() {
  const { connectionId } = useParams();
  const { connections, jobs, records, health, checkHealth, openSheet, openAssistant, loading } = useApp();
  const navigate = useNavigate();
  const conn = connections.find((c) => c.id === connectionId);
  const [writes, setWrites] = useState([]);
  const [checking, setChecking] = useState(false);
  const [insight, setInsight] = useState(null);
  const [insightDb, setInsightDb] = useState('');
  const [insightErr, setInsightErr] = useState('');
  const [insightBusy, setInsightBusy] = useState(false);

  useEffect(() => {
    if (connectionId) rememberConnection(connectionId);
  }, [connectionId]);

  const scopedJobs = jobs.filter((j) => j.connectionId === connectionId);
  const scopedRecords = records.filter((r) => r.connectionId === connectionId);
  const activity = useConnectionActivity(scopedRecords);

  useEffect(() => {
    if (!connectionId) return;
    setInsight(null);
    setInsightErr('');
    setInsightBusy(true);
    API.connections
      .insight(connectionId)
      .then((row) => {
        setInsight(row);
        setInsightDb(row.database || '');
      })
      .catch((err) => setInsightErr(err.message))
      .finally(() => setInsightBusy(false));
  }, [connectionId]);

  useEffect(() => {
    if (!connectionId) return;
    Promise.all([API.writeAudit().catch(() => []), API.rotate.audit().catch(() => [])]).then(([restores, rotations]) => {
      const rot = rotations
        .filter((r) => r.connectionId === connectionId)
        .map((r) => ({ at: r.at, kind: 'rotate', database: `${r.database}.${r.collection}`, connectionName: r.connectionName, user: r.email || r.userId }));
      const scopedRestores = restores.filter((r) => r.connectionId === connectionId);
      setWrites([...scopedRestores, ...rot].sort((a, b) => new Date(b.at) - new Date(a.at)));
    });
  }, [connectionId, scopedRecords.length]);

  if (loading) return null;
  if (!connections.length) return <Navigate to="/" replace />;
  if (!conn) return <Navigate to="/" replace />;

  const recent = scopedRecords.filter((r) => Date.now() - new Date(r.startedAt).getTime() < 14 * DAY);
  const okRecent = recent.filter((r) => r.status === 'success').length;
  const rate = recent.length ? Math.round((okRecent / recent.length) * 100) : null;
  const stored = scopedRecords.filter((r) => r.exists && !r.pruned).reduce((s, r) => s + (r.size || 0), 0);
  const verified = scopedRecords.filter((r) => r.verification?.status === 'verified').length;
  const upcoming = scopedJobs.filter((j) => j.enabled && j.nextRunAt).sort((a, b) => new Date(a.nextRunAt) - new Date(b.nextRunAt)).slice(0, 5);
  const max = Math.max(1, ...activity.map((b) => b.ok + b.fail));
  const h = health[conn.id];
  const mongo = (conn.engine || 'mongodb') === 'mongodb';
  const info = engineOf(conn.engine);

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 px-5 py-6 md:px-8">
      <PageHeader
        eyebrow={info.label}
        title={conn.name}
        subtitle={`${conn.environment || 'production'} · Explore, back up${mongo ? ', seed and rotate' : ' and seed'} from this connection.`}
        actions={
          <>
            <Button onClick={() => openAssistant({ connectionId: conn.id })}>
              <Sparkles size={14} className="text-primary" /> Ask
            </Button>
            <Button onClick={() => navigate(explorePath(conn.id))}>
              <Table2 size={14} /> Explore
            </Button>
            {mongo ? (
              <Button onClick={() => navigate(rotatePath(conn.id))}>
                <KeyRound size={14} /> Rotate
              </Button>
            ) : null}
            <Button variant="primary" onClick={() => openSheet({ type: 'job', job: { connectionId: conn.id }, lockConnection: true })}>
              <Plus size={15} /> New backup
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={ShieldCheck}
          label="Reachable"
          value={h ? (h.ok ? `${h.latencyMs} ms` : 'Down') : '…'}
          hint={h?.version ? `${info.label} ${h.version}` : info.label}
          tone={h ? (h.ok ? 'ok' : 'fail') : 'muted'}
        />
        <Kpi icon={FolderArchive} label="Backups · 14 days" value={recent.length} hint={rate == null ? 'no runs yet' : `${rate}% succeeded`} tone={rate == null || rate === 100 ? 'ok' : 'warn'} />
        <Kpi icon={ShieldCheck} label="Verified files" value={verified} hint={`of ${scopedRecords.filter((r) => r.status === 'success').length} successful`} tone="ok" />
        <Kpi icon={HardDrive} label="Stored on disk" value={bytes(stored)} hint={`${scopedJobs.filter((j) => j.enabled).length} of ${scopedJobs.length} jobs live`} />
      </div>

      <ClusterInsight
        conn={conn}
        insight={insight}
        insightDb={insightDb}
        insightErr={insightErr}
        insightBusy={insightBusy}
        onRefresh={() => {
          setInsightBusy(true);
          API.connections
            .insight(conn.id, insightDb || undefined)
            .then((row) => {
              setInsight(row);
              if (row.database) setInsightDb(row.database);
            })
            .catch((err) => setInsightErr(err.message))
            .finally(() => setInsightBusy(false));
        }}
        onDatabase={(db) => {
          setInsightDb(db);
          setInsightBusy(true);
          API.connections
            .insight(conn.id, db)
            .then(setInsight)
            .catch((err) => setInsightErr(err.message))
            .finally(() => setInsightBusy(false));
        }}
      />

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader
            title="Activity"
            subtitle="Backups per day, last 14 days"
            action={
              <div className="flex items-center gap-3 text-[11.5px] text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm bg-primary" /> success
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm bg-danger" /> failed
                </span>
              </div>
            }
          />
          <div className="mt-5 flex h-44 items-end gap-1.5">
            {activity.map((b) => {
              const total = b.ok + b.fail;
              const d = new Date(b.start);
              return (
                <div key={b.start} className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={`${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: ${b.ok} ok, ${b.fail} failed · ${bytes(b.size)}`}>
                  <span className="num text-[10px] text-subtle opacity-0 transition group-hover:opacity-100">{total || ''}</span>
                  <div className="flex w-full max-w-7 flex-col-reverse overflow-hidden rounded-[5px] bg-surface-2" style={{ height: `${Math.max(4, (total / max) * 100)}%` }}>
                    <div className="bg-primary transition-all group-hover:brightness-110" style={{ height: `${total ? (b.ok / total) * 100 : 0}%` }} />
                    <div className="bg-danger" style={{ height: `${total ? (b.fail / total) * 100 : 0}%` }} />
                  </div>
                  <span className="text-[10px] text-subtle">{d.getDate()}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader
            title="This connection"
            subtitle="Live reachability"
            action={
              <Button
                size="sm"
                variant="ghost"
                loading={checking}
                onClick={async () => {
                  setChecking(true);
                  await checkHealth();
                  setChecking(false);
                }}
              >
                <RefreshCw size={13} /> Check
              </Button>
            }
          />
          <div className="mt-3 min-w-0 space-y-3">
            <div className="flex min-w-0 items-center gap-3">
              <EngineLogo engine={conn.engine} size={20} tile />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{conn.name}</div>
                <CopyUri value={conn.uriMasked} className="mt-0.5 w-full text-[11.5px]" />
              </div>
            </div>
            <div className={cn('inline-flex items-center gap-1.5 text-[12.5px]', h?.ok ? 'text-muted' : 'text-danger')}>
              <StatusDot tone={h?.ok ? 'ok' : h ? 'fail' : 'muted'} />
              {h?.ok ? `Reachable in ${h.latencyMs} ms` : h?.error || 'Not checked yet'}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" onClick={() => openSheet({ type: 'connection', connection: conn })}>
                Privileges
              </Button>
              <Button size="sm" onClick={() => navigate(explorePath(conn.id))}>
                Browse data
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent backups"
            action={
              <Button size="sm" variant="ghost" onClick={() => navigate(backupsPath(conn.id))}>
                All backups
              </Button>
            }
          />
          <div className="mt-2 divide-y divide-line">
            {scopedRecords.slice(0, 6).map((r) => {
              const v = verificationTone(r.verification);
              return (
                <button key={r.id} type="button" onClick={() => openSheet({ type: 'record', record: r })} className="flex w-full items-center gap-3 py-2.5 text-left">
                  <EngineLogo engine={r.engine} size={16} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{r.jobName}</div>
                    <div className="truncate text-[11.5px] text-subtle">
                      {r.database} · {compact(r.documentCount)} records
                    </div>
                  </div>
                  <span className="num hidden text-[12px] text-muted sm:block">{r.sizeLabel}</span>
                  {r.status === 'success' ? <Badge tone={v.tone}>{v.label}</Badge> : <Badge tone="fail">{r.status}</Badge>}
                  <span className="w-24 text-right text-[11.5px] text-subtle">{relativeTime(r.finishedAt || r.startedAt)}</span>
                </button>
              );
            })}
            {!scopedRecords.length ? (
              <Empty
                icon={FolderArchive}
                title="No backups on this connection"
                body="Create a job to snapshot a database on a schedule."
                action={
                  <Button size="sm" variant="primary" onClick={() => openSheet({ type: 'job', job: { connectionId: conn.id }, lockConnection: true })}>
                    New backup
                  </Button>
                }
              />
            ) : null}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Up next" icon={CalendarClock} />
            <div className="mt-3 space-y-2">
              {upcoming.map((j) => (
                <button key={j.id} type="button" onClick={() => openSheet({ type: 'job', job: j, lockConnection: true })} className="flex w-full items-center justify-between gap-2 rounded-md border border-line bg-surface-2/50 px-3 py-2 text-left hover:border-line-strong">
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium">{j.name}</span>
                    <span className="block text-[11px] text-subtle">{j.intervalLabel}</span>
                  </span>
                  <span className="text-[11.5px] text-muted">{j.nextRunLabel}</span>
                </button>
              ))}
              {!upcoming.length ? <p className="text-[12.5px] text-subtle">No scheduled jobs on this connection.</p> : null}
              <Button size="sm" className="w-full" onClick={() => openSheet({ type: 'job', job: { connectionId: conn.id }, lockConnection: true })}>
                <Plus size={13} /> Add backup job
              </Button>
            </div>
          </Card>
          <Card>
            <CardHeader title="Writes" subtitle="Restores and rotations on this connection" icon={CircleAlert} />
            <div className="mt-3 space-y-2">
              {writes.slice(0, 4).map((w, i) => (
                <div key={i} className="text-[12px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">
                      {w.kind === 'restore' ? 'Restore' : 'Rotate'} → {w.database}
                    </span>
                    <span className="shrink-0 text-subtle">{relativeTime(w.at)}</span>
                  </div>
                  <div className="truncate text-subtle">
                    {w.inserted != null ? `${compact(w.inserted)} records` : ''}
                    {w.user ? ` · ${w.user}` : ''}
                  </div>
                </div>
              ))}
              {!writes.length ? <p className="text-[12.5px] text-subtle">No writes yet. Backups and browsing never write.</p> : null}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function uptimeLabel(sec) {
  if (sec == null) return '—';
  const d = Math.floor(Number(sec) / 86400);
  const h = Math.floor((Number(sec) % 86400) / 3600);
  const m = Math.floor((Number(sec) % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function ClusterInsight({ conn, insight, insightDb, insightErr, insightBusy, onRefresh, onDatabase }) {
  const objects = insight?.objects || [];
  const dbs = insight?.databases || [];
  const region = insight?.region;
  const current = insight?.connections?.current;
  const available = insight?.connections?.available;
  const cap = insight?.connections?.max ?? (current != null && available != null ? current + available : null);
  const opened = insight?.history?.opened;
  const info = engineOf(conn.engine);
  const maxRows = Math.max(1, ...objects.map((o) => o.rows || 0));

  return (
    <Card>
      <CardHeader
        title="Live cluster"
        subtitle="Database metadata from this connection — read-only"
        icon={Server}
        action={
          <div className="flex items-center gap-2">
            {dbs.length > 1 ? (
              <Select value={insightDb} onChange={(e) => onDatabase(e.target.value)} className="h-8 w-44 text-[12.5px]">
                {dbs.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </Select>
            ) : null}
            <Button size="sm" variant="ghost" loading={insightBusy} onClick={onRefresh}>
              <RefreshCw size={13} />
            </Button>
          </div>
        }
      />
      {insightErr ? <p className="mt-3 text-[12.5px] text-danger">{insightErr}</p> : null}
      {!insight && !insightErr ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : null}
      {insight ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              <MetaChip icon={Server} label={insight.instanceType || insight.topology || info.label} />
              {insight.version ? <MetaChip icon={Layers} label={`${info.label} ${insight.version}`} /> : null}
              {insight.atlas ? <MetaChip icon={Globe} label="MongoDB Atlas" /> : null}
              {insight.replicaSet ? <MetaChip icon={Activity} label={insight.replicaSet} /> : null}
              {insight.process ? <MetaChip icon={Cpu} label={insight.process} /> : null}
              {insight.storageEngine ? <MetaChip label={insight.storageEngine} /> : null}
              {insight.host ? <MetaChip icon={Globe} label={insight.host} /> : null}
              {insight.os?.name || insight.os?.type ? <MetaChip label={[insight.os.name, insight.os.type].filter(Boolean).join(' · ')} /> : null}
              {insight.uptimeSec != null ? <MetaChip label={`up ${uptimeLabel(insight.uptimeSec)}`} /> : null}
              {region ? (
                <MetaChip
                  label={`${region.flag || ''} ${region.city || region.country || region.code || ''}`.trim()}
                  hint={[region.provider, region.country].filter(Boolean).join(' · ')}
                />
              ) : null}
              {insight.provider && !region?.provider ? <MetaChip label={insight.provider} /> : null}
              {insight.cpu?.cores ? <MetaChip icon={Cpu} label={`${insight.cpu.cores} cores`} /> : null}
            </div>
            {insight.members?.length > 1 ? (
              <div className="flex flex-wrap gap-1.5">
                {insight.members.map((m) => (
                  <span key={m.host} className="inline-flex items-center gap-1 rounded-sm border border-line px-2 py-1 text-[11.5px] text-muted">
                    {m.region?.flag || ''}
                    <span className="font-mono">{m.host.split('.')[0]}</span>
                    {m.me ? <Badge tone="ok">me</Badge> : null}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MiniKpi label="Databases" value={dbs.length} hint={insight.dataSize ? bytes(insight.dataSize) : info.label} />
              <MiniKpi label={info.objects[0].toUpperCase() + info.objects.slice(1)} value={objects.length} hint={insight.database || 'this database'} />
              <MiniKpi
                label="Open now"
                value={current ?? '—'}
                hint={available != null ? `${available} free` : 'connections'}
              />
              <MiniKpi
                label="Opened · 24h"
                value={opened == null ? '—' : compact(opened)}
                hint={insight.history?.samples > 1 ? 'since last samples on this device' : 'sample this page again later'}
              />
            </div>
            {current != null && cap ? (
              <div>
                <div className="mb-1 flex justify-between text-[11.5px] text-subtle">
                  <span>Connection slots</span>
                  <span className="num">
                    {current} / {cap}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-sm bg-surface-2">
                  <div className="h-full bg-primary" style={{ width: `${Math.min(100, (current / cap) * 100)}%` }} />
                </div>
              </div>
            ) : null}
          </div>
          <div className="overflow-hidden rounded-md border border-line">
            <div className="border-b border-line bg-surface-2 px-3 py-2 text-[12px] font-medium">
              {insight.database || 'Objects'}
            </div>
            <div className="max-h-56 overflow-auto">
              {objects.slice(0, 12).map((o) => (
                <div key={o.name} className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-line px-3 py-1.5 text-[12px] last:border-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <Table2 size={12} className="shrink-0 text-subtle" />
                    <span className="truncate font-mono">{o.name}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="hidden h-1 w-16 overflow-hidden rounded-sm bg-surface-2 sm:block">
                      <span className="block h-full bg-primary/80" style={{ width: `${Math.max(6, ((o.rows || 0) / maxRows) * 100)}%` }} />
                    </span>
                    <span className="num w-14 text-right text-muted">{compact(o.rows || 0)}</span>
                  </span>
                </div>
              ))}
              {!objects.length ? <p className="px-3 py-4 text-[12px] text-subtle">No {info.objects} listed.</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function MetaChip({ icon: Icon, label, hint }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-sm border border-line bg-surface-2/60 px-2 py-1 text-[12px]" title={hint || label}>
      {Icon ? <Icon size={12} className="shrink-0 text-subtle" /> : null}
      <span className="truncate">{label}</span>
    </span>
  );
}

function MiniKpi({ label, value, hint }) {
  return (
    <div className="rounded-md border border-dashed border-line px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="num mt-0.5 text-[18px] font-semibold tracking-[-0.02em]">{value}</div>
      <div className="truncate text-[11px] text-subtle">{hint}</div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, hint, tone }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-muted">{label}</span>
        <Icon size={15} className="text-subtle" />
      </div>
      <div className="num mt-2 text-[26px] font-semibold tracking-[-0.02em]">{value}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-subtle">
        {tone ? <StatusDot tone={tone} /> : null}
        {hint}
      </div>
    </Card>
  );
}
