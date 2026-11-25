import { Handle, Position } from '@xyflow/react';
import { Archive, CalendarClock, HardDrive, Lock, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { EngineLogo } from '../EngineLogo.jsx';
import { Badge, StatusDot } from '../ui.jsx';
import { engineOf } from '../../lib/engines.js';
import { relativeTime } from '../../lib/format.js';
import { cn } from '../../lib/cn.js';

function Frame({ children, selected, accent, className, step }) {
  return (
    <div
      className={cn('w-[250px] rounded-[14px] border bg-surface p-3.5 shadow-[var(--shadow)] transition', className)}
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
      <div className="mt-2.5 truncate font-mono text-[10.5px] text-subtle">{conn.uriMasked}</div>
      <div className="mt-2 flex items-center gap-1.5">
        <span className="h-1.5 w-6 rounded-full" style={{ background: conn.color }} />
        <span className="text-[11px] text-muted">
          {jobs} job{jobs === 1 ? '' : 's'}
        </span>
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
    <div className="w-[220px] cursor-pointer rounded-[14px] border border-dashed border-line-strong bg-transparent p-3.5 text-center text-[12.5px] text-muted hover:border-primary hover:text-primary">
      <Handle type="target" position={Position.Left} />
      <Plus size={16} className="mx-auto mb-1" />
      Add a backup job for {data.conn.name}
    </div>
  );
}

export const nodeTypes = {
  source: SourceNode,
  snapshot: SnapshotNode,
  storage: StorageNode,
  retention: RetentionNode,
  ghost: GhostNode,
};
