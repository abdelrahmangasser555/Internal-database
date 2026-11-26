import { Handle, Position } from '@xyflow/react';
import { Archive, BarChart3, CalendarClock, HardDrive, Lock, ShieldCheck, Sprout, Trash2 } from 'lucide-react';
import { EngineLogo } from '../EngineLogo.jsx';
import { Badge, CopyUri, StatusDot } from '../ui.jsx';
import { engineOf } from '../../lib/engines.js';
import { relativeTime } from '../../lib/format.js';
import { cn } from '../../lib/cn.js';

function Frame({ children, selected, accent, className, step }) {
  return (
    <div
      className={cn('w-[250px] rounded-md border border-theme bg-surface p-3.5 shadow-card transition', className)}
      style={{ borderColor: selected ? accent || 'var(--primary)' : 'var(--line)', boxShadow: selected ? `0 0 0 3px color-mix(in oklab, ${accent || 'var(--primary)'} 22%, transparent)` : undefined }}
    >
      {step ? <div className="mb-2 text-[10.5px] font-medium uppercase tracking-[0.08em] text-subtle">{step}</div> : null}
      {children}
    </div>
  );
}

function Line({ icon: Icon, children, tone }) {
  return (
    <div className={cn('flex items-center gap-1.5 text-[11.5px]', tone || 'text-muted')}>
      {Icon ? <Icon size={12} className="shrink-0" /> : null}
      <span className="truncate">{children}</span>
    </div>
  );
}

export function SourceNode({ data, selected }) {
  const { conn, jobs } = data;
  const info = engineOf(conn.engine);
  return (
    <Frame selected={selected} accent={conn.color} step="Source">
      <div className="flex items-center gap-2.5">
        <EngineLogo engine={conn.engine} size={18} tile />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{conn.name}</div>
          <div className="text-[11px] text-subtle">
            {info.label} · {conn.environment || 'production'}
          </div>
        </div>
      </div>
      <CopyUri value={conn.uriMasked} className="mt-2.5 w-full text-[10.5px]" />
      <div className="mt-2 flex items-center gap-1.5">
        <span className="h-1.5 w-6" style={{ background: conn.color }} />
        <span className="text-[11px] text-muted">
          {jobs} job{jobs === 1 ? '' : 's'}
        </span>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-1 border-t border-theme border-line pt-2">
        <Action icon={Archive} label="Backup" onClick={() => data.onAddJob?.(conn)} />
        <Action icon={BarChart3} label="Chart" onClick={() => data.onAddDashboard?.(conn)} />
        <Action icon={Sprout} label="Seed" onClick={() => data.onPinSeed?.(conn)} />
      </div>
      <Handle type="source" position={Position.Right} />
    </Frame>
  );
}

export function SnapshotNode({ data, selected }) {
  const { job, latest } = data;
  return (
    <Frame selected={selected} step="Snapshot">
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-[13px] font-semibold">{job.name}</div>
        {job.running ? (
          <Badge tone="primary" dot pulse>
            running
          </Badge>
        ) : (
          <Badge tone={job.enabled ? 'ok' : 'muted'}>{job.enabled ? 'live' : 'paused'}</Badge>
        )}
      </div>
      <div className="mt-2 space-y-1">
        <Line icon={CalendarClock}>
          {job.intervalLabel} · {job.enabled ? `next ${job.nextRunLabel}` : 'paused'}
        </Line>
        <Line icon={Archive}>
          {job.database} · {job.allCollections ? 'everything' : `${(job.collections || []).length} selected`}
        </Line>
        {latest ? (
          <Line icon={null} tone={latest.status === 'success' ? 'text-muted' : 'text-danger'}>
            <StatusDot tone={latest.status === 'success' ? 'ok' : 'fail'} className="mr-1" />
            last {latest.status} {relativeTime(latest.finishedAt || latest.startedAt)}
          </Line>
        ) : (
          <Line>never run</Line>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </Frame>
  );
}

export function StorageNode({ data, selected }) {
  const { job, latest, files, totalSize, verification } = data;
  return (
    <Frame selected={selected} step="Storage">
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2">
        <HardDrive size={15} className="text-primary" />
        <div className="truncate text-[13px] font-semibold">
          {files} file{files === 1 ? '' : 's'} · {totalSize}
        </div>
      </div>
      <div className="mt-1.5 truncate font-mono text-[10.5px] text-subtle" title={job.targetPath}>
        {job.targetPath}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {job.encrypt ? (
          <Badge tone="primary">
            <Lock size={10} /> AES-256
          </Badge>
        ) : (
          <Badge>zip</Badge>
        )}
        {latest ? <Badge tone={verification.tone}>{verification.label}</Badge> : null}
      </div>
      <Handle type="source" position={Position.Right} />
    </Frame>
  );
}

export function RetentionNode({ data, selected }) {
  const { job, files, pruned } = data;
  const r = job.retention || {};
  const active = r.keepLast || r.maxAgeDays;
  return (
    <Frame selected={selected} step="Retention">
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2">
        <Trash2 size={14} className={active ? 'text-warn' : 'text-subtle'} />
        <div className="text-[13px] font-semibold">{active ? [r.keepLast ? `Keep last ${r.keepLast}` : null, r.maxAgeDays ? `${r.maxAgeDays} days` : null].filter(Boolean).join(' · ') : 'Keep everything'}</div>
      </div>
      <div className="mt-2 space-y-1">
        <Line icon={ShieldCheck}>{job.verifyAfter ? 'Verify after each run' : 'Verify on demand'}</Line>
        <Line>
          {files} kept{pruned ? ` · ${pruned} pruned` : ''}
        </Line>
      </div>
    </Frame>
  );
}

export function GhostNode({ data }) {
  return (
    <div className="w-[220px] cursor-pointer rounded-md border border-theme border-line-strong bg-transparent p-3.5 text-center text-[12.5px] text-muted hover:border-primary hover:text-primary">
      <Handle type="target" position={Position.Left} />
      <Archive size={16} className="mx-auto mb-1" />
      Add a backup job for {data.conn.name}
    </div>
  );
}

export function DashboardNode({ data, selected }) {
  const { dashboard } = data;
  return (
    <Frame selected={selected} step="Visual dashboard">
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2">
        <BarChart3 size={15} />
        <div className="truncate text-[13px] font-semibold">{dashboard.name}</div>
      </div>
      <div className="mt-1 truncate text-[11px] text-subtle">{dashboard.database}</div>
      <div className="mt-2 text-[11px] text-muted">Open to rerun the charts</div>
    </Frame>
  );
}

export function SeedLinkNode({ data, selected }) {
  const { seed, binding } = data;
  return (
    <Frame selected={selected} step="Pinned seed">
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2">
        <Sprout size={15} />
        <div className="truncate text-[13px] font-semibold">{seed.name}</div>
      </div>
      <div className="mt-1 truncate font-mono text-[11px] text-subtle">{binding.database}</div>
      <div className="mt-2 text-[11px] text-muted">Open to simulate and rerun</div>
    </Frame>
  );
}

function Action({ icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      className="btn flex flex-col items-center gap-0.5 border border-line px-1 py-1 text-[10px] text-muted hover:border-fg hover:text-fg"
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

export const nodeTypes = {
  source: SourceNode,
  snapshot: SnapshotNode,
  storage: StorageNode,
  retention: RetentionNode,
  ghost: GhostNode,
  dashboard: DashboardNode,
  seedlink: SeedLinkNode,
};
