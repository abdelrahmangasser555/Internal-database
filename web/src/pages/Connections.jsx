import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, FolderArchive, KeyRound, Plus, RefreshCw } from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { bytes, compact, relativeTime, verificationTone } from '../lib/format.js';
import { engineOf } from '../lib/engines.js';
import { connectionPath, explorePath, rememberConnection, rotatePath } from '../lib/paths.js';
import { Badge, Button, Card, Empty, PageHeader, StatusDot } from '../components/ui.jsx';
import { EngineLogo } from '../components/EngineLogo.jsx';
import { cn } from '../lib/cn.js';

export function ConnectionsPage() {
  const { meta, connections, jobs, records, health, checkHealth, openSheet } = useApp();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);

  const stored = records.filter((r) => r.exists && !r.pruned).reduce((s, r) => s + (r.size || 0), 0);
  const liveJobs = jobs.filter((j) => j.enabled).length;

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 px-5 py-6 md:px-8">
      <PageHeader
        eyebrow={meta.device ? `On ${meta.device}` : 'This device'}
        title="Connections"
        subtitle="Every backup, query, seed, dashboard and password rotation lives on a connection. Open one to work with it."
        actions={
          <>
            <Button
              loading={checking}
              onClick={async () => {
                setChecking(true);
                await checkHealth();
                setChecking(false);
              }}
            >
              <RefreshCw size={14} /> Check all
            </Button>
            <Button variant="primary" onClick={() => openSheet({ type: 'connection' })}>
              <Plus size={15} /> New connection
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap gap-3 text-[12.5px] text-muted">
        <span>
          {connections.length} connection{connections.length === 1 ? '' : 's'}
        </span>
        <span className="text-subtle">·</span>
        <span>
          {liveJobs} of {jobs.length} jobs live
        </span>
        <span className="text-subtle">·</span>
        <span>{bytes(stored)} on disk</span>
      </div>

      {connections.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {connections.map((c) => (
            <ConnectionCard
              key={c.id}
              conn={c}
              health={health[c.id]}
              jobs={jobs.filter((j) => j.connectionId === c.id)}
              records={records.filter((r) => r.connectionId === c.id)}
              onOpen={() => {
                rememberConnection(c.id);
                navigate(connectionPath(c.id));
              }}
            />
          ))}
          <button
            type="button"
            onClick={() => openSheet({ type: 'connection' })}
            className="flex min-h-[168px] items-center justify-center gap-2 border border-theme border-line-strong p-4 text-[13px] text-muted hover:border-primary hover:text-primary"
          >
            <Plus size={15} /> New connection
          </button>
        </div>
      ) : (
        <Card>
          <Empty
            icon={Plus}
            title="Add a database connection"
            body="Paste a MongoDB, PostgreSQL, MySQL, MariaDB, SQLite or SQL Server URI. Backups, explore, seeds and rotate all hang off that connection."
            action={
              <Button variant="primary" onClick={() => openSheet({ type: 'connection' })}>
                Add connection
              </Button>
            }
          />
        </Card>
      )}
    </div>
  );
}

function ConnectionCard({ conn, health, jobs, records, onOpen }) {
  const { openSheet } = useApp();
  const navigate = useNavigate();
  const last = records[0];
  const v = last ? verificationTone(last.verification) : null;
  const live = jobs.filter((j) => j.enabled).length;
  const mongo = (conn.engine || 'mongodb') === 'mongodb';

  return (
    <Card className="flex flex-col gap-3.5 p-4">
      <button type="button" onClick={onOpen} className="flex items-start gap-3 text-left">
        <EngineLogo engine={conn.engine} size={18} tile />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold">{conn.name}</span>
          <span className="block truncate text-[12px] text-subtle">
            {engineOf(conn.engine).label}
            {health?.version ? ` ${health.version}` : ''} · {conn.environment || 'production'}
          </span>
        </span>
        {health ? (
          <span className={cn('inline-flex items-center gap-1.5 text-[11.5px]', health.ok ? 'text-muted' : 'text-danger')} title={health.error || ''}>
            <StatusDot tone={health.ok ? 'ok' : 'fail'} />
            {health.ok ? `${health.latencyMs} ms` : 'unreachable'}
          </span>
        ) : (
          <StatusDot tone="muted" />
        )}
      </button>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-muted">
        <span>
          {live} of {jobs.length} jobs live
        </span>
        <span className="truncate">
          {last ? (
            <>
              Last {last.status} {relativeTime(last.finishedAt || last.startedAt)}
            </>
          ) : (
            'No backups yet'
          )}
        </span>
        {last?.status === 'success' && v ? (
          <span className="col-span-2">
            <Badge tone={v.tone}>{v.label}</Badge>
            <span className="ml-2 text-subtle">
              {compact(last.documentCount)} records · {last.sizeLabel}
            </span>
          </span>
        ) : null}
      </div>

      <div className="mt-auto flex flex-wrap gap-1.5">
        <Button size="sm" variant="primary" onClick={onOpen}>
          Open <ArrowRight size={13} />
        </Button>
        <Button
          size="sm"
          onClick={() => {
            rememberConnection(conn.id);
            navigate(explorePath(conn.id));
          }}
        >
          Explore
        </Button>
        <Button
          size="sm"
          onClick={() => {
            rememberConnection(conn.id);
            openSheet({ type: 'job', job: { connectionId: conn.id }, lockConnection: true });
          }}
        >
          <FolderArchive size={13} /> Backup
        </Button>
        {mongo ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              rememberConnection(conn.id);
              navigate(rotatePath(conn.id));
            }}
          >
            <KeyRound size={13} /> Rotate
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

export function useConnectionActivity(records, days = 14) {
  return useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const DAY = 86_400_000;
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
