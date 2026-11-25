import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarClock, CircleAlert, Database, FolderArchive, HardDrive, Plus, RefreshCw, ShieldCheck, Sparkles, Workflow } from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { API } from '../api.js';
import { bytes, compact, relativeTime, verificationTone } from '../lib/format.js';
import { engineOf } from '../lib/engines.js';
import { Badge, Button, Card, CardHeader, Empty, PageHeader, StatusDot } from '../components/ui.jsx';
import { EngineLogo } from '../components/EngineLogo.jsx';
import { cn } from '../lib/cn.js';

const DAY = 86_400_000;

function useActivity(records, days = 14) {
  return useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const buckets = Array.from({ length: days }, (_, i) => {
      const start = today.getTime() - (days - 1 - i) * DAY;
      return { start, ok: 0, fail: 0, size: 0 };
    });
    for (const r of records) {
      const t = new Date(r.startedAt).getTime();
      const idx = Math.floor((t - buckets[0].start) / DAY);
      if (idx < 0 || idx >= days) continue;
      if (r.status === 'success') {
        buckets[idx].ok += 1;
        buckets[idx].size += r.size || 0;
      } else buckets[idx].fail += 1;
    }
    return buckets;
  }, [records, days]);
}

export function OverviewPage() {
  const { meta, connections, jobs, records, health, checkHealth, openSheet, openAssistant } = useApp();
  const navigate = useNavigate();
  const [writes, setWrites] = useState([]);
  const [checking, setChecking] = useState(false);
  const activity = useActivity(records);

  useEffect(() => {
    Promise.all([API.writeAudit().catch(() => []), API.rotate.audit().catch(() => [])]).then(([restores, rotations]) => {
      const rot = rotations.map((r) => ({ at: r.at, kind: 'rotate', database: `${r.database}.${r.collection}`, connectionName: r.connectionName, user: r.email || r.userId }));
      setWrites([...restores, ...rot].sort((a, b) => new Date(b.at) - new Date(a.at)));
    });
  }, [records.length]);

  const recent = records.filter((r) => Date.now() - new Date(r.startedAt).getTime() < 14 * DAY);
  const okRecent = recent.filter((r) => r.status === 'success').length;
  const rate = recent.length ? Math.round((okRecent / recent.length) * 100) : null;
  const stored = records.filter((r) => r.exists && !r.pruned).reduce((s, r) => s + (r.size || 0), 0);
  const verified = records.filter((r) => r.verification?.status === 'verified').length;
  const healthy = connections.filter((c) => health[c.id]?.ok).length;
  const upcoming = jobs.filter((j) => j.enabled && j.nextRunAt).sort((a, b) => new Date(a.nextRunAt) - new Date(b.nextRunAt)).slice(0, 5);
  const max = Math.max(1, ...activity.map((b) => b.ok + b.fail));

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 px-5 py-6 md:px-8">
      <PageHeader
        eyebrow={meta.device ? `On ${meta.device}` : 'This device'}
        title="Your databases, backed up"
        subtitle="Read-only snapshots of MongoDB, PostgreSQL, MySQL, MariaDB, SQLite and SQL Server, kept on this machine, verified and ready to restore."
        actions={
          <>
            <Button onClick={() => openAssistant({})}>
              <Sparkles size={14} className="text-primary" /> Ask your data
            </Button>
            <Button variant="primary" onClick={() => openSheet({ type: 'connection' })}>
              <Plus size={15} /> New connection
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Database} label="Connections" value={connections.length} hint={connections.length ? `${healthy} reachable` : 'none yet'} tone={healthy === connections.length ? 'ok' : 'warn'} />
        <Kpi icon={FolderArchive} label="Backups · 14 days" value={recent.length} hint={rate == null ? 'no runs yet' : `${rate}% succeeded`} tone={rate == null || rate === 100 ? 'ok' : 'warn'} />
        <Kpi icon={ShieldCheck} label="Verified files" value={verified} hint={`of ${records.filter((r) => r.status === 'success').length} successful`} tone="ok" />
        <Kpi icon={HardDrive} label="Stored on disk" value={bytes(stored)} hint={`${jobs.filter((j) => j.enabled).length} of ${jobs.length} jobs live`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
        <Card>
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

        <Card>
          <CardHeader
            title="Connections"
            subtitle="Live reachability check"
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
          <div className="mt-3 divide-y divide-line">
            {connections.slice(0, 6).map((c) => {
              const h = health[c.id];
              return (
                <button key={c.id} type="button" onClick={() => navigate(`/browse/${c.id}`)} className="flex w-full items-center gap-3 py-2.5 text-left hover:opacity-90">
                  <EngineLogo engine={c.engine} size={16} tile />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{c.name}</div>
                    <div className="truncate text-[11.5px] text-subtle">
                      {engineOf(c.engine).label}
                      {h?.version ? ` ${h.version}` : ''} · {c.environment || 'production'}
                    </div>
                  </div>
                  {h ? (
                    <span className={cn('inline-flex items-center gap-1.5 text-[11.5px]', h.ok ? 'text-muted' : 'text-danger')} title={h.error || ''}>
                      <StatusDot tone={h.ok ? 'ok' : 'fail'} />
                      {h.ok ? `${h.latencyMs} ms` : 'unreachable'}
                    </span>
                  ) : (
                    <StatusDot tone="muted" />
                  )}
                </button>
              );
            })}
            {!connections.length ? (
              <Empty
                icon={Database}
                title="No connections yet"
                body="Paste a MongoDB, PostgreSQL, MySQL, MariaDB, SQLite or SQL Server URI."
                action={
                  <Button size="sm" variant="primary" onClick={() => openSheet({ type: 'connection' })}>
                    Add connection
                  </Button>
                }
              />
            ) : null}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent backups"
            action={
              <Button size="sm" variant="ghost" onClick={() => navigate('/backups')}>
                All backups <ArrowRight size={13} />
              </Button>
            }
          />
          <div className="mt-2 divide-y divide-line">
            {records.slice(0, 6).map((r) => {
              const v = verificationTone(r.verification);
              return (
                <button key={r.id} type="button" onClick={() => openSheet({ type: 'record', record: r })} className="flex w-full items-center gap-3 py-2.5 text-left">
                  <EngineLogo engine={r.engine} size={16} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{r.jobName}</div>
                    <div className="truncate text-[11.5px] text-subtle">
                      {r.connectionName} · {r.database} · {compact(r.documentCount)} records
                    </div>
                  </div>
                  <span className="num hidden text-[12px] text-muted sm:block">{r.sizeLabel}</span>
                  {r.status === 'success' ? <Badge tone={v.tone}>{v.label}</Badge> : <Badge tone="fail">{r.status}</Badge>}
                  <span className="w-24 text-right text-[11.5px] text-subtle">{relativeTime(r.finishedAt || r.startedAt)}</span>
                </button>
              );
            })}
            {!records.length ? <p className="py-8 text-center text-[13px] text-subtle">No backups yet. Create a job and press Run now.</p> : null}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Up next" icon={CalendarClock} />
            <div className="mt-3 space-y-2">
              {upcoming.map((j) => (
                <button key={j.id} type="button" onClick={() => openSheet({ type: 'job', job: j })} className="flex w-full items-center justify-between gap-2 rounded-md border border-line bg-surface-2/50 px-3 py-2 text-left hover:border-line-strong">
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium">{j.name}</span>
                    <span className="block text-[11px] text-subtle">{j.intervalLabel}</span>
                  </span>
                  <span className="text-[11.5px] text-muted">{j.nextRunLabel}</span>
                </button>
              ))}
              {!upcoming.length ? <p className="text-[12.5px] text-subtle">No scheduled jobs.</p> : null}
              <Button size="sm" className="w-full" onClick={() => navigate('/flow')}>
                <Workflow size={13} /> View pipeline
              </Button>
            </div>
          </Card>
          <Card>
            <CardHeader title="Writes" subtitle="Restores and rotations on this device" icon={CircleAlert} />
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
                    {w.connectionName}
                    {w.inserted != null ? ` · ${compact(w.inserted)} records` : ''}
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
